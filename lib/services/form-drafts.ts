/**
 * Form drafts (public.form_drafts, migration 20261218000000): a person's
 * saved, unsent answers to a reusable form — the Save draft icon in the
 * form's top-right corner on /f/<id> and in the Run dialog of a workflow
 * that starts from the form (lib/forms/form-actions.ts).
 *
 *  - One draft per person per form; saving again replaces it.
 *  - Only the form's own values are kept (value fields, lookups' items,
 *    attachments' counts, optional sections' `<key>_included`); the URL
 *    parameters ride along in `params`.
 *  - Files: references, never bytes. Each attachment is re-read from
 *    form_files (it must be the person's own pending upload into this form)
 *    and its pending window is stretched to FORM_DRAFT_FILE_DAYS so it is
 *    still there when they come back; a file that has gone is dropped from
 *    the draft when it is read back.
 *  - Bounded: FORM_DRAFT_MAX_BYTES of values + parameters (the table checks
 *    the same).
 *  - Deleted when the person submits the form (submitForm), or chooses
 *    "Start fresh".
 *
 * Access: the caller's own drafts only (ctx.actorId), forms.submit, a form
 * of the current workspace. Reads and writes use the service-role client
 * with explicit tenant / user filters; RLS (own rows, can_open_form) is the
 * second line for signed-in clients.
 */

import { dbError, serviceRoleClient } from './_shared'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { draftBytes, FORM_DRAFT_MAX_BYTES } from '@/lib/forms/form-actions'
import { holdsFiles, valueFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { attachmentsCountKey } from '@/lib/forms/attachments'
import { isPlainObject } from '@/lib/utils/guards'
import { SUBMISSION_META_KEY } from '@/lib/forms/submission-meta'

/* eslint-disable @typescript-eslint/no-explicit-any -- form_drafts is not in the generated Database types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** How long a draft's uploaded files are kept pending (days). */
export const FORM_DRAFT_FILE_DAYS = 30
/** Most parameters kept with a draft. */
const MAX_PARAMS = 50

export interface FormDraft {
  form_id: string
  /** The form version the answers were given against. */
  version: number | null
  values: Record<string, unknown>
  params: Record<string, unknown> | null
  updated_at: string
}

export interface FormDraftSummary { form_id: string; form_name: string; updated_at: string }

function actor(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('Drafts are personal: use a credential bound to a user')
  return ctx.actorId
}

async function loadForm(db: AnySupabaseClient, tenantId: string, formId: string) {
  if (!UUID_RE.test(formId)) throw ServiceError.notFound('Form not found')
  const { data, error } = await (db as any).from('forms').select('id, name, fields, layout, version').eq('id', formId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  const def = normalizeFormDefinition(data)
  return { row: data as Record<string, any>, fields: def.fields, layout: def.layout }
}

/** The form's own values, never the reserved run variable `submission` (lib/forms/submission-meta.ts) a client might send. */
async function draftValues(fields: TaskFieldDef[], raw: unknown, layout: unknown): Promise<Record<string, unknown>> {
  const { storedValues } = await import('./form-submissions')
  const kept = storedValues(fields, isPlainObject(raw) ? raw : {}, layout)
  delete kept[SUBMISSION_META_KEY]
  return kept
}

/** URL parameters kept with a draft: plain scalars / short lists, by name. */
function cleanParams(raw: unknown): Record<string, unknown> | null {
  if (!isPlainObject(raw)) return null
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(raw).slice(0, MAX_PARAMS)) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/.test(name) || name === SUBMISSION_META_KEY) continue
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) out[name] = value
    else if (Array.isArray(value)) out[name] = value.filter((v) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, 100)
  }
  return Object.keys(out).length ? out : null
}

/**
 * The draft's file fields as the server knows them: each file must still be
 * the person's pending upload into this form. `strict` refuses a bad file
 * (saving); otherwise the field is dropped (reading back an old draft).
 */
async function checkFiles(db: AnySupabaseClient, ctx: ServiceContext, formId: string, fields: TaskFieldDef[], values: Record<string, unknown>, strict: boolean): Promise<Record<string, unknown>> {
  const fileFields = valueFields(fields).filter((f) => holdsFiles(f) && values[f.key] !== undefined && values[f.key] !== null)
  if (!fileFields.length) return values
  const { resolveAttachmentValues } = await import('./form-files')
  const out = { ...values }
  const { errors, values: rebuilt } = await resolveAttachmentValues(db, ctx.tenantId, fields, values, { kind: 'form', formId, actorId: ctx.actorId }, fileFields.map((f) => f.key))
  for (const field of fileFields) {
    if (errors[field.key]) {
      if (strict) throw ServiceError.validation(errors[field.key], { fields: { [field.key]: errors[field.key] } })
      delete out[field.key]
      delete out[attachmentsCountKey(field.key)]
      continue
    }
    out[field.key] = rebuilt[field.key]
    out[attachmentsCountKey(field.key)] = rebuilt[attachmentsCountKey(field.key)]
  }
  return out
}

/** My draft of this form, or null (forms.submit). Files that have gone are left out. */
export async function getFormDraft(ctx: ServiceContext, formId: string): Promise<FormDraft | null> {
  const me = actor(ctx)
  if (!hasPerm(ctx, 'forms.submit')) return null
  if (!UUID_RE.test(formId)) return null
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('form_drafts').select('form_id, version, values, params, updated_at')
    .eq('tenant_id', ctx.tenantId).eq('user_id', me).eq('form_id', formId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) return null
  const { fields, layout } = await loadForm(db, ctx.tenantId, formId)
  const kept = await draftValues(fields, data.values, layout)
  const values = await checkFiles(db, ctx, formId, fields, kept, false)
  return { form_id: data.form_id, version: data.version ?? null, values, params: isPlainObject(data.params) ? data.params : null, updated_at: data.updated_at }
}

/** Save (replace) my draft of this form: forms.submit; only the form's own values; files by reference; bounded. */
export async function saveFormDraft(ctx: ServiceContext, formId: string, input: { values?: unknown; params?: unknown }): Promise<{ form_id: string; updated_at: string; bytes: number }> {
  const me = actor(ctx)
  requirePerm(ctx, 'forms.submit')
  const db = await serviceRoleClient(ctx)
  const { row, fields, layout } = await loadForm(db, ctx.tenantId, formId)
  const kept = await draftValues(fields, input.values, layout)
  const values = await checkFiles(db, ctx, formId, fields, kept, true)
  const params = cleanParams(input.params)
  const bytes = draftBytes(values, params)
  if (bytes > FORM_DRAFT_MAX_BYTES) throw ServiceError.validation(`This draft is too large to save (${Math.ceil(bytes / 1024)} KB; the limit is ${FORM_DRAFT_MAX_BYTES / 1024} KB)`)
  const { data, error } = await (db as any).from('form_drafts').upsert({
    tenant_id: ctx.tenantId,
    user_id: me,
    form_id: formId,
    version: Number.isInteger(row.version) ? row.version : null,
    values,
    params,
  }, { onConflict: 'user_id,form_id' }).select('form_id, updated_at').single()
  if (error) throw dbError(error)
  // The draft's files stay until the person is back (the cleanup job deletes expired pending uploads).
  const { attachmentIdsIn } = await import('./form-files')
  const ids = attachmentIdsIn(fields, values)
  if (ids.length) {
    const until = new Date(Date.now() + FORM_DRAFT_FILE_DAYS * 86_400_000).toISOString()
    const { error: keepError } = await (db as any).from('form_files').update({ expires_at: until })
      .eq('tenant_id', ctx.tenantId).eq('uploaded_by', me).eq('form_id', formId).eq('status', 'pending').in('id', ids)
    if (keepError) console.warn('[form-drafts] could not keep the draft files:', keepError.message)
  }
  return { form_id: data.form_id, updated_at: data.updated_at, bytes }
}

/** Delete my draft of this form (Start fresh; idempotent). */
export async function deleteFormDraft(ctx: ServiceContext, formId: string): Promise<{ form_id: string; deleted: boolean }> {
  const me = actor(ctx)
  if (!UUID_RE.test(formId)) return { form_id: formId, deleted: false }
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('form_drafts').delete().eq('tenant_id', ctx.tenantId).eq('user_id', me).eq('form_id', formId).select('form_id')
  if (error) throw dbError(error)
  return { form_id: formId, deleted: (data ?? []).length > 0 }
}

/** After a successful submission: the submitter's draft of the form goes (never throws). */
export async function clearDraftAfterSubmit(db: AnySupabaseClient, tenantId: string, userId: string | null, formId: string): Promise<void> {
  if (!userId) return
  try {
    const { error } = await (db as any).from('form_drafts').delete().eq('tenant_id', tenantId).eq('user_id', userId).eq('form_id', formId)
    if (error) console.warn('[form-drafts] could not delete the draft after submit:', error.message)
  } catch (error) {
    console.warn('[form-drafts] could not delete the draft after submit:', error instanceof Error ? error.message : error)
  }
}

/** My drafts in this workspace, newest first (Home → Drafts, the Forms menu's marks). */
export async function listMyFormDrafts(ctx: ServiceContext): Promise<FormDraftSummary[]> {
  const me = actor(ctx)
  if (!hasPerm(ctx, 'forms.submit')) return []
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('form_drafts').select('form_id, updated_at, form:forms(name)')
    .eq('tenant_id', ctx.tenantId).eq('user_id', me).order('updated_at', { ascending: false }).limit(50)
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).map((d) => ({ form_id: d.form_id, form_name: String(d.form?.name ?? 'Form'), updated_at: d.updated_at }))
}
