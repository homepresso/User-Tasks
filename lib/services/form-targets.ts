/**
 * Form data targets at run time (lib/forms/data-target.ts): the core side of
 * forms bound to records an extension provides (ServerExtension.formTargets).
 *
 *  - prepareFormTarget   the form page opens: the provider loads the record
 *                        (values, version) and refreshes external field
 *                        properties; Person values arrive as e-mails and are
 *                        mapped to workspace members here.
 *  - submitFormTarget    after core checked the values: the provider writes
 *                        the record. Its errors become ServiceErrors (field
 *                        errors per field, 409 / 412 a conflict).
 *  - assertTargetBinding saving a form: adding or changing a binding needs
 *                        the provider to exist and the editor to hold its
 *                        bindPermission.
 *  - formTargetSaved / formTargetDeleted / checkFormTarget: the provider's
 *                        bookkeeping and designer warnings.
 *
 * Every hook first checks the workspace may use the extension (enabled,
 * licensed, the target's licence feature). Server-only.
 */

import { applyFieldPatches, isEmailPerson, layoutDataTarget, normalizeFieldPatches, sameDataTarget, type FormDataTargetRef, type FormDataTargetState } from '@/lib/forms/data-target'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { isExtensionError, type FormTarget, type FormTargetForm, type FormTargetPerson, type FormTargetProblem } from '@/lib/extensions/sdk'

/* eslint-disable @typescript-eslint/no-explicit-any -- users / memberships are read loosely */

export interface TargetForm { id: string | null; name: string; version: number | null; fields: TaskFieldDef[]; layout: unknown }

/** Test seam: the provider registry and the access gate. */
export const formTargetDeps = {
  async provider(ref: FormDataTargetRef): Promise<FormTarget | null> {
    const { getServerExtension } = await import('@/lib/extensions/server-registry')
    return getServerExtension(ref.extension)?.formTargets?.[ref.key] ?? null
  },
  async assertAccess(tenantId: string, ref: FormDataTargetRef, feature?: string): Promise<void> {
    const { extensionAccess, extensionAccessError } = await import('@/lib/extensions/state')
    const access = await extensionAccess(tenantId, ref.extension, feature)
    if (!access.usable) throw extensionAccessError(access, ref.extension, feature)
  },
  async context(ctx: ServiceContext, ref: FormDataTargetRef, db: AnySupabaseClient) {
    const { createExtensionContext } = await import('@/lib/extensions/host')
    return createExtensionContext({ extensionId: ref.extension, tenantId: ctx.tenantId, actorId: ctx.actorId, db, permissions: ctx.permissions })
  },
  async serviceDb(ctx: ServiceContext): Promise<AnySupabaseClient> {
    const { serviceRoleClient } = await import('./_shared')
    return serviceRoleClient(ctx)
  },
}

async function resolve(ctx: ServiceContext, ref: FormDataTargetRef): Promise<FormTarget> {
  const target = await formTargetDeps.provider(ref)
  if (!target) throw new ServiceError('not_found', `This form is bound to "${ref.label ?? `${ref.extension}/${ref.key}`}", which is not available in this build`, { details: { code: 'data_target_unavailable', extension_id: ref.extension } })
  await formTargetDeps.assertAccess(ctx.tenantId, ref, target.feature)
  return target
}

function hookForm(form: TargetForm, ref: FormDataTargetRef): FormTargetForm {
  return { id: form.id, name: form.name, version: form.version, config: ref.config, fields: form.fields }
}

/** A provider's ExtensionError → the ServiceError the caller sees (messages are the provider's, prefixed with the target). */
export function targetError(error: unknown, label: string): unknown {
  if (!isExtensionError(error)) return error
  const details: Record<string, unknown> = { ...(error.details ?? {}), code: error.code }
  const fields = isPlainObject(details.fields) ? Object.fromEntries(Object.entries(details.fields).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 500)])) : null
  if (error.status === 409 || error.status === 412) return new ServiceError('conflict', error.message, { status: error.status, details })
  if (error.status === 404) return new ServiceError('not_found', error.message, { details })
  if (error.status === 401 || error.status === 403) return new ServiceError('forbidden', `${label}: ${error.message}`, { details })
  if (error.status === 402) return new ServiceError('payment_required', error.message, { details })
  if (error.status >= 500) return new ServiceError('validation_error', `${label} failed: ${error.message}`, { status: 502, details })
  return new ServiceError('validation_error', error.message, { details: fields ? { ...details, fields } : details })
}

/** Workspace members by e-mail (lower-case) → id + name. */
async function membersByEmail(db: AnySupabaseClient, tenantId: string, emails: string[]): Promise<Map<string, { id: string; name: string | null }>> {
  const out = new Map<string, { id: string; name: string | null }>()
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))].slice(0, 500)
  if (!wanted.length) return out
  const { data: users } = await (db as any).from('users').select('id, email, display_name').in('email', wanted)
  const rows = (users ?? []) as Array<{ id: string; email: string | null; display_name: string | null }>
  if (!rows.length) return out
  const { data: members } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).in('user_id', rows.map((r) => r.id))
  const allowed = new Set(((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id))
  for (const row of rows) if (row.email && allowed.has(row.id)) out.set(row.email.toLowerCase(), { id: row.id, name: row.display_name })
  return out
}

/**
 * Person values a provider returned as `{ email }` (or arrays) → the field's
 * value shape: a user id (single), or PersonRef[] (multiple / teams). People
 * who are not members are left out and listed in `missing`.
 */
export async function mapPeopleValues(db: AnySupabaseClient, tenantId: string, fields: TaskFieldDef[], values: Record<string, unknown>): Promise<{ values: Record<string, unknown>; missing: string[] }> {
  const people = fields.filter((f) => f.type === 'user' && values[f.key] !== undefined)
  if (!people.length) return { values, missing: [] }
  const emails: string[] = []
  for (const f of people) for (const v of [values[f.key]].flat()) if (isEmailPerson(v)) emails.push(v.email)
  const byEmail = await membersByEmail(db, tenantId, emails)
  const out = { ...values }
  const missing: string[] = []
  for (const f of people) {
    const list = [values[f.key]].flat().filter((v) => v !== null && v !== undefined && v !== '')
    const refs: Array<{ kind: 'user'; id: string; name?: string }> = []
    for (const v of list) {
      if (isEmailPerson(v)) {
        const hit = byEmail.get(v.email.trim().toLowerCase())
        if (hit) refs.push({ kind: 'user', id: hit.id, ...(hit.name ? { name: hit.name } : {}) })
        else missing.push(v.name ? `${v.name} <${v.email}>` : v.email)
      } else if (typeof v === 'string') refs.push({ kind: 'user', id: v })
    }
    const multi = Boolean(f.user_config?.multiple || f.user_config?.allow_teams)
    out[f.key] = multi ? refs : refs[0]?.id ?? null
  }
  return { values: out, missing }
}

/** The people of the Person fields in `values`, by user id (members of the workspace only). */
async function peopleOf(db: AnySupabaseClient, tenantId: string, fields: TaskFieldDef[], values: Record<string, unknown>): Promise<Record<string, FormTargetPerson>> {
  const ids = new Set<string>()
  for (const f of fields) {
    if (f.type !== 'user') continue
    for (const v of [values[f.key]].flat()) {
      if (typeof v === 'string' && v) ids.add(v)
      else if (isPlainObject(v) && v.kind === 'user' && typeof v.id === 'string') ids.add(v.id)
    }
  }
  if (!ids.size) return {}
  const { data } = await (db as any).from('users').select('id, email, display_name').in('id', [...ids].slice(0, 500))
  const { data: members } = await (db as any).from('user_memberships').select('user_id').eq('tenant_id', tenantId).in('user_id', [...ids].slice(0, 500))
  const allowed = new Set(((members ?? []) as Array<{ user_id: string }>).map((m) => m.user_id))
  const out: Record<string, FormTargetPerson> = {}
  for (const row of (data ?? []) as Array<{ id: string; email: string | null; display_name: string | null }>) {
    if (allowed.has(row.id)) out[row.id] = { id: row.id, name: row.display_name ?? null, email: row.email ?? null }
  }
  return out
}

export interface PreparedTarget {
  fields: TaskFieldDef[]
  state: FormDataTargetState | null
}

/**
 * Run the provider's `prepare` for a form with a data target (a no-op for
 * other forms). `params` are re-validated against the form's declared
 * parameters before the provider sees them.
 */
export async function prepareFormTarget(ctx: ServiceContext, form: TargetForm, rawParams: unknown, purpose: 'render' | 'submit'): Promise<PreparedTarget> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) return { fields: form.fields, state: null }
  const target = await resolve(ctx, ref)
  const label = ref.label ?? target.label
  const { serverFormContext } = await import('@/lib/forms/form-params')
  const params = serverFormContext(form.layout, { params: isPlainObject(rawParams) ? rawParams : {} }).params
  if (!target.prepare) return { fields: form.fields, state: { label, mode: 'create', record: null, values: {}, version: null, notice: null } }
  const db = await formTargetDeps.serviceDb(ctx)
  let prepared
  try {
    prepared = await target.prepare({ ctx: await formTargetDeps.context(ctx, ref, db), form: hookForm(form, ref), params, purpose })
  } catch (error) {
    throw targetError(error, label)
  }
  const fields = applyFieldPatches(form.fields, normalizeFieldPatches(prepared?.fields, form.fields))
  if (purpose === 'submit') return { fields, state: null }
  const known = new Set(fields.map((f) => f.key))
  const raw = isPlainObject(prepared?.values) ? Object.fromEntries(Object.entries(prepared!.values!).filter(([k]) => known.has(k))) : {}
  const mapped = await mapPeopleValues(db, ctx.tenantId, fields, raw)
  const record = prepared?.record && typeof prepared.record.id === 'string' && prepared.record.id
    ? { id: prepared.record.id.slice(0, 200), label: prepared.record.label ? String(prepared.record.label).slice(0, 300) : null, url: typeof prepared.record.url === 'string' && /^https?:\/\//i.test(prepared.record.url) ? prepared.record.url.slice(0, 2000) : null }
    : null
  const notices = [prepared?.notice ? String(prepared.notice).slice(0, 1000) : '', mapped.missing.length ? `Not in this workspace, so not shown: ${mapped.missing.slice(0, 10).join(', ')}${mapped.missing.length > 10 ? '…' : ''}.` : ''].filter(Boolean)
  return {
    fields,
    state: {
      label,
      mode: record ? 'edit' : 'create',
      record,
      values: mapped.values,
      version: typeof prepared?.version === 'string' && prepared.version ? prepared.version.slice(0, 200) : null,
      notice: notices.join(' ') || null,
    },
  }
}

export interface SubmittedTarget {
  label: string
  record: { id: string; label: string | null; url: string | null }
  version: string | null
  message: string | null
}

/** Write the record through the provider (after core validated `values`). */
export async function submitFormTarget(ctx: ServiceContext, form: TargetForm, values: Record<string, unknown>, input: { params?: unknown; version?: string | null }): Promise<SubmittedTarget | null> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) return null
  const target = await resolve(ctx, ref)
  const label = ref.label ?? target.label
  const db = await formTargetDeps.serviceDb(ctx)
  const { serverFormContext } = await import('@/lib/forms/form-params')
  const params = serverFormContext(form.layout, { params: isPlainObject(input.params) ? input.params : {} }).params
  const people = await peopleOf(db, ctx.tenantId, form.fields, values)
  const { holdsFiles } = await import('@/lib/task-field-schema')
  const fileFields = form.fields.filter((f) => holdsFiles(f) || f.type === 'image')
  const allowedIds = new Set<string>()
  for (const f of fileFields) for (const v of [values[f.key]].flat()) if (isPlainObject(v) && typeof v.id === 'string') allowedIds.add(v.id)
  const readFile = async (file: unknown) => {
    if (!isPlainObject(file) || typeof file.id !== 'string' || !allowedIds.has(file.id)) return null
    const { readWorkflowFile } = await import('./form-files')
    const read = await readWorkflowFile(db, ctx.tenantId, file)
    return read ? { name: read.name, contentType: read.mime_type || 'application/octet-stream', bytes: read.bytes } : null
  }
  let result
  try {
    result = await target.submit({
      ctx: await formTargetDeps.context(ctx, ref, db),
      form: hookForm(form, ref),
      values,
      params,
      version: typeof input.version === 'string' && input.version ? input.version.slice(0, 200) : null,
      people,
      readFile,
    })
  } catch (error) {
    throw targetError(error, label)
  }
  if (!result?.record || typeof result.record.id !== 'string' || !result.record.id) throw new ServiceError('validation_error', `${label} did not report the record it wrote`, { status: 502 })
  return {
    label,
    record: { id: result.record.id.slice(0, 200), label: result.record.label ? String(result.record.label).slice(0, 300) : null, url: typeof result.record.url === 'string' && /^https?:\/\//i.test(result.record.url) ? result.record.url.slice(0, 2000) : null },
    version: typeof result.version === 'string' ? result.version.slice(0, 200) : null,
    message: result.message ? String(result.message).slice(0, 1000) : null,
  }
}

/**
 * Saving a form: a binding that is new or changed needs its provider (present
 * and usable here) and the editor's bindPermission. Unchanged bindings pass
 * (an editor who may not bind can still rearrange a bound form).
 */
export async function assertTargetBinding(ctx: ServiceContext, layout: unknown, previous: unknown): Promise<void> {
  const ref = layoutDataTarget(layout)
  if (!ref || sameDataTarget(ref, layoutDataTarget(previous))) return
  const target = await resolve(ctx, ref)
  if (target.bindPermission && !hasPerm(ctx, target.bindPermission)) {
    throw ServiceError.forbidden(`Forbidden: binding a form to ${ref.label ?? target.label} needs the '${target.bindPermission}' permission`)
  }
}

/** After a save: tell the provider (best effort; a removed / changed binding tells the old one it was dropped). */
export async function formTargetSaved(ctx: ServiceContext, form: TargetForm & { id: string }, previousLayout: unknown = null): Promise<void> {
  const ref = layoutDataTarget(form.layout)
  const before = layoutDataTarget(previousLayout)
  if (before && !sameDataTarget(ref, before)) await formTargetDeleted(ctx, form.id, previousLayout)
  if (!ref) return
  try {
    const target = await resolve(ctx, ref)
    if (!target.saved) return
    const db = await formTargetDeps.serviceDb(ctx)
    await target.saved({ ctx: await formTargetDeps.context(ctx, ref, db), form: { ...hookForm(form, ref), id: form.id } })
  } catch (error) {
    console.warn('[forms] data target saved hook failed:', error instanceof Error ? error.message : error)
  }
}

export async function formTargetDeleted(ctx: ServiceContext, formId: string, layout: unknown): Promise<void> {
  const ref = layoutDataTarget(layout)
  if (!ref) return
  try {
    const target = await formTargetDeps.provider(ref)
    if (!target?.deleted) return
    const db = await formTargetDeps.serviceDb(ctx)
    await target.deleted({ ctx: await formTargetDeps.context(ctx, ref, db), formId, config: ref.config })
  } catch (error) {
    console.warn('[forms] data target deleted hook failed:', error instanceof Error ? error.message : error)
  }
}

/** Designer warnings for a bound form (empty for other forms; a failing provider is one error line). */
export async function checkFormTarget(ctx: ServiceContext, form: TargetForm): Promise<{ label: string | null; problems: FormTargetProblem[] }> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) return { label: null, problems: [] }
  let label = ref.label ?? `${ref.extension}/${ref.key}`
  try {
    const target = await resolve(ctx, ref)
    label = ref.label ?? target.label
    if (!target.check) return { label, problems: [] }
    const db = await formTargetDeps.serviceDb(ctx)
    const problems = await target.check({ ctx: await formTargetDeps.context(ctx, ref, db), form: hookForm(form, ref) })
    const known = new Set(form.fields.map((f) => f.key))
    return {
      label,
      problems: (Array.isArray(problems) ? problems : []).slice(0, 100).map((p): FormTargetProblem => ({
        severity: p.severity === 'error' || p.severity === 'info' ? p.severity : 'warning',
        message: String(p.message ?? '').slice(0, 500),
        ...(typeof p.field === 'string' && known.has(p.field) ? { field: p.field } : {}),
      })).filter((p) => p.message),
    }
  } catch (error) {
    const mapped = targetError(error, label)
    return { label, problems: [{ severity: 'error', message: mapped instanceof Error ? mapped.message : String(mapped) }] }
  }
}
