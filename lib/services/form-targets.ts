/**
 * Form data targets at run time (lib/forms/data-target.ts): the core side of
 * forms bound to records an extension provides (ServerExtension.formTargets).
 *
 *  - prepareFormTarget   the form page opens: the provider loads the record
 *                        (values, version) and refreshes external field
 *                        properties; Person values arrive as e-mails and are
 *                        mapped to workspace members here. A display form
 *                        (`mode: 'display'`) gets every field read-only, and
 *                        its submissions are refused.
 *  - submitFormTarget    after core checked the values: the provider writes
 *                        the record. Its errors become ServiceErrors (field
 *                        errors per field, 409 / 412 a conflict).
 *  - assertTargetBinding saving a form: adding or changing a binding needs
 *                        the provider to exist and the editor to hold its
 *                        bindPermission.
 *  - formTargetSaved / formTargetDeleted / checkFormTarget: the provider's
 *                        bookkeeping and designer warnings. Saved / deleted
 *                        run after the response (next/server after()), so a
 *                        save or publish never waits for the provider (whose
 *                        clean-up may call the external system); outside a
 *                        request they run before returning.
 *
 * A binding is "the same" across a save when the provider's `identity` of its
 * config is unchanged (e.g. same list): editing the form's fields changes
 * the config, but is not an unbind + bind.
 *
 * Every hook first checks the workspace may use the extension (enabled,
 * licensed, the target's licence feature). Server-only.
 */

import { applyFieldPatches, isEmailPerson, layoutDataTarget, normalizeDataTarget, normalizeFieldPatches, normalizeTargetLinks, sameDataTarget, type FormDataTargetRef, type FormDataTargetState } from '@/lib/forms/data-target'
import { isDisplayField, normalizeTaskFields, TASK_FIELD_TYPES, type TaskFieldDef, type TaskFieldType } from '@/lib/task-field-schema'
import { cleanReturnUrl, cleanTargetUrl, normalizeFormButtons } from '@/lib/forms/buttons'
import { isPlainObject } from '@/lib/utils/guards'
import { hasPerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { isExtensionError, type FormTarget, type FormTargetDescription, type FormTargetSaveAction, type FormTargetForm, type FormTargetPerson, type FormTargetProblem, type FormTargetSourceField } from '@/lib/extensions/sdk'

const TASK_FIELD_TYPE_SET = new Set<string>(TASK_FIELD_TYPES)

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
  return { id: form.id, name: form.name, version: form.version, config: ref.config, fields: form.fields, writes: ref.writes ?? null }
}

/** A provider's ExtensionError → the ServiceError the caller sees (messages are the provider's, prefixed with the target). */
/**
 * A provider error → a service error. `formUser`: the form page (prepare /
 * submit / delete) — an upstream failure (5xx) is said in plain words and its
 * raw text (status lines, API paths) goes to the server log only; designers
 * (check / describe / bind / actions) keep the provider's message.
 */
export function targetError(error: unknown, label: string, options: { formUser?: boolean } = {}): unknown {
  if (!isExtensionError(error)) return error
  const details: Record<string, unknown> = { ...(error.details ?? {}), code: error.code }
  const fields = isPlainObject(details.fields) ? Object.fromEntries(Object.entries(details.fields).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, String(v).slice(0, 500)])) : null
  if (error.status === 409 || error.status === 412) return new ServiceError('conflict', error.message, { status: error.status, details })
  if (error.status === 404) return new ServiceError('not_found', error.message, { details })
  if (error.status === 401 || error.status === 403) return new ServiceError('forbidden', `${label}: ${error.message}`, { details })
  if (error.status === 402) return new ServiceError('payment_required', error.message, { details })
  if (error.status >= 500) {
    if (!options.formUser) return new ServiceError('validation_error', `${label} failed: ${error.message}`, { status: 502, details })
    console.error(`[form target] ${label}: ${error.code}: ${error.message}`)
    return new ServiceError('validation_error', `${label} couldn't be reached to save this. Try again in a moment; if it keeps happening, tell your administrator.`, { status: 502, details: { code: error.code } })
  }
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
  /** The record's values for {{target.<name>}} (the provider's prepare `context`; submit only). */
  context?: Record<string, string | number | boolean | null>
}

/** A provider's record values → bounded scalars by token name. */
function normalizeTargetContext(raw: unknown): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  if (!isPlainObject(raw)) return out
  for (const [k, v] of Object.entries(raw).slice(0, 60)) {
    if (!/^[a-z][a-z0-9_]{0,40}$/.test(k)) continue
    if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v as never
    else if (typeof v === 'string') out[k] = v.slice(0, 2000)
  }
  return out
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
    throw targetError(error, label, { formUser: true })
  }
  const display = prepared?.mode === 'display'
  if (display && purpose === 'submit') throw new ServiceError('validation_error', `This form shows a record of ${label}; it can't be submitted`, { details: { code: 'display_form' } })
  const patched = applyFieldPatches(form.fields, normalizeFieldPatches(prepared?.fields, form.fields))
  // Display forms: everything read-only (static content stays as it is).
  const fields = display ? patched.map((f) => (isDisplayField(f) ? f : { ...f, read_only: true, required: false })) : patched
  if (purpose === 'submit') return { fields, state: null, context: normalizeTargetContext(prepared?.context) }
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
      mode: display ? 'display' : record ? 'edit' : 'create',
      record,
      values: mapped.values,
      version: display ? null : typeof prepared?.version === 'string' && prepared.version ? prepared.version.slice(0, 200) : null,
      notice: notices.join(' ') || null,
      return_url: cleanReturnUrl(prepared?.returnUrl),
      can_delete: Boolean(record && target.remove && prepared?.canDelete === true),
      ...(isPlainObject(prepared?.urls) ? { urls: Object.fromEntries(Object.entries(prepared!.urls!).filter(([k]) => /^[a-z][a-z0-9_]{0,40}$/.test(k)).slice(0, 20).map(([k, v]) => [k, cleanTargetUrl(v)]).filter((e): e is [string, string] => Boolean(e[1]))) } : {}),
      ...(prepared?.actions ? { actions: normalizeTargetLinks(prepared.actions) } : {}),
      ...(prepared?.files ? { files: normalizeTargetLinks(prepared.files, { httpOnly: true }) } : {}),
    },
  }
}

export interface SubmittedTarget {
  label: string
  record: { id: string; label: string | null; url: string | null }
  version: string | null
  message: string | null
  /** {{target.return_url}} after this submission (provider-vetted http(s)). */
  returnUrl: string | null
}

/** Write the record through the provider (after core validated `values`). */
export async function submitFormTarget(ctx: ServiceContext, form: TargetForm, values: Record<string, unknown>, input: { params?: unknown; version?: string | null; action?: FormTargetSaveAction }): Promise<SubmittedTarget | null> {
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
      ...(input.action ? { action: input.action } : {}),
    })
  } catch (error) {
    throw targetError(error, label, { formUser: true })
  }
  if (!result?.record || typeof result.record.id !== 'string' || !result.record.id) throw new ServiceError('validation_error', `${label} did not report the record it wrote`, { status: 502 })
  return {
    label,
    record: { id: result.record.id.slice(0, 200), label: result.record.label ? String(result.record.label).slice(0, 300) : null, url: typeof result.record.url === 'string' && /^https?:\/\//i.test(result.record.url) ? result.record.url.slice(0, 2000) : null },
    version: typeof result.version === 'string' ? result.version.slice(0, 200) : null,
    message: result.message ? String(result.message).slice(0, 1000) : null,
    returnUrl: cleanReturnUrl(result.returnUrl),
  }
}

/** A Delete button: the provider deletes the record the (re-validated) params name. */
export async function deleteFormTargetRecord(ctx: ServiceContext, form: TargetForm, input: { params?: unknown; version?: string | null }): Promise<{ label: string; record: { id: string; label: string | null } | null; message: string | null; returnUrl: string | null }> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) throw new ServiceError('validation_error', 'This form is not bound to an external record')
  const target = await resolve(ctx, ref)
  const label = ref.label ?? target.label
  if (!target.remove) throw new ServiceError('validation_error', `${label} records can't be deleted from a form`)
  const db = await formTargetDeps.serviceDb(ctx)
  const { serverFormContext } = await import('@/lib/forms/form-params')
  const params = serverFormContext(form.layout, { params: isPlainObject(input.params) ? input.params : {} }).params
  let result
  try {
    result = await target.remove({ ctx: await formTargetDeps.context(ctx, ref, db), form: hookForm(form, ref), params, version: typeof input.version === 'string' && input.version ? input.version.slice(0, 200) : null })
  } catch (error) {
    throw targetError(error, label, { formUser: true })
  }
  const record = result?.record && typeof result.record.id === 'string' && result.record.id ? { id: result.record.id.slice(0, 200), label: result.record.label ? String(result.record.label).slice(0, 300) : null } : null
  return { label, record, message: result?.message ? String(result.message).slice(0, 1000) : null, returnUrl: cleanReturnUrl(result?.returnUrl) }
}

/**
 * Saving a form: a binding that is new or changed needs its provider (present
 * and usable here) and the editor's bindPermission. Unchanged bindings pass
 * (an editor who may not bind can still rearrange a bound form).
 */
export async function assertTargetBinding(ctx: ServiceContext, layout: unknown, previous: unknown): Promise<void> {
  const ref = layoutDataTarget(layout)
  const before = layoutDataTarget(previous)
  if (!ref || sameDataTarget(ref, before)) return
  const target = await resolve(ctx, ref)
  if (before && sameIdentity(target, ref, before)) return
  if (target.bindPermission && !hasPerm(ctx, target.bindPermission)) {
    throw ServiceError.forbidden(`Forbidden: binding a form to ${ref.label ?? target.label} needs the '${target.bindPermission}' permission`)
  }
}

/**
 * The same binding with another config (fields added / removed …): same
 * extension and key, and the provider's identity of both configs is equal.
 * Providers without `identity` treat every config change as a new binding.
 */
export function sameIdentity(target: Pick<FormTarget, 'identity'> | null, a: FormDataTargetRef, b: FormDataTargetRef): boolean {
  if (a.extension !== b.extension || a.key !== b.key) return false
  if (sameDataTarget(a, b)) return true
  if (!target?.identity) return false
  try {
    return target.identity(a.config) === target.identity(b.config)
  } catch {
    return false
  }
}

/**
 * Run a provider hook after the response (it may call the external system:
 * the caller never waits for it); outside a request scope (scripts, tests,
 * the worker) it runs before returning. Errors are logged.
 */
export async function afterResponse(label: string, run: () => Promise<void>): Promise<void> {
  const guarded = () => run().catch((error) => { console.warn(`[forms] ${label} failed:`, error instanceof Error ? error.message : error) })
  try {
    const { after } = await import('next/server')
    after(guarded)
    return
  } catch {
    // No request scope: run it now.
  }
  await guarded()
}

/** After a save: tell the provider (best effort, after the response; a removed / rebound binding tells the old one it was dropped). */
export async function formTargetSaved(ctx: ServiceContext, form: TargetForm & { id: string }, previousLayout: unknown = null): Promise<void> {
  const ref = layoutDataTarget(form.layout)
  const before = layoutDataTarget(previousLayout)
  if (!ref && !before) return
  await afterResponse('data target saved hook', async () => {
    let target: FormTarget | null = null
    let failure: unknown = null
    if (ref) try { target = await resolve(ctx, ref) } catch (error) { failure = error }
    const kept = Boolean(ref && before && sameIdentity(target, ref, before))
    // A provider that can't be asked (unavailable here, not licensed) keeps its own binding: only a binding that
    // moved to another target (or was removed) tells the old one.
    const sameProvider = Boolean(ref && before && ref.extension === before.extension && ref.key === before.key)
    if (before && !kept && !(failure && sameProvider)) await targetDeleted(ctx, form.id, before)
    if (failure) throw failure
    if (!ref || !target?.saved) return
    const db = await formTargetDeps.serviceDb(ctx)
    await target.saved({ ctx: await formTargetDeps.context(ctx, ref, db), form: { ...hookForm(form, ref), id: form.id }, previousConfig: kept && before ? before.config : null })
  })
}

export async function formTargetDeleted(ctx: ServiceContext, formId: string, layout: unknown): Promise<void> {
  const ref = layoutDataTarget(layout)
  if (!ref) return
  await afterResponse('data target deleted hook', () => targetDeleted(ctx, formId, ref))
}

async function targetDeleted(ctx: ServiceContext, formId: string, ref: FormDataTargetRef): Promise<void> {
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

/* ── the designer: describe, bind, actions ───────────────────────────── */

const SOURCE_LIMITS = { fields: 500, facts: 20, notes: 50, options: 20, actions: 10, text: 500 } as const
const txt = (v: unknown, max: number = SOURCE_LIMITS.text) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').slice(0, max) : '')

/** A provider's description → bounded, typed, plain (no unknown field types, http(s) links only). */
export function normalizeTargetDescription(raw: unknown): FormTargetDescription | null {
  if (!isPlainObject(raw) || typeof raw.title !== 'string') return null
  const isTaskFieldType = (t: string) => TASK_FIELD_TYPE_SET.has(t)
  const fields = (Array.isArray(raw.sourceFields) ? raw.sourceFields : []).filter(isPlainObject).slice(0, SOURCE_LIMITS.fields).flatMap((f): FormTargetSourceField[] => {
    if (typeof f.key !== 'string' || !f.key) return []
    return [{
      key: txt(f.key, 200), label: txt(f.label) || txt(f.key, 200), typeLabel: txt(f.typeLabel, 80),
      fieldTypes: (Array.isArray(f.fieldTypes) ? f.fieldTypes : []).filter((t): t is TaskFieldType => typeof t === 'string' && isTaskFieldType(t)),
      ...(f.required === true ? { required: true } : {}), ...(f.readOnly === true ? { readOnly: true } : {}), ...(f.multi === true ? { multi: true } : {}),
      ...(Array.isArray(f.choices) ? { choices: f.choices.filter((c): c is string => typeof c === 'string').slice(0, 200).map((c) => txt(c, 200)) } : {}),
      ...(typeof f.lookup === 'string' ? { lookup: txt(f.lookup, 200) } : {}),
      ...(typeof f.help === 'string' ? { help: txt(f.help) } : {}),
      ...(typeof f.group === 'string' && f.group ? { group: txt(f.group, 40) } : {}),
      ...(f.isNew === true ? { isNew: true } : {}),
    }]
  })
  const linkUrl = isPlainObject(raw.link) ? cleanReturnUrl(raw.link.url) : null
  return {
    title: txt(raw.title, 200),
    link: linkUrl && isPlainObject(raw.link) ? { label: txt(raw.link.label, 120) || 'Open', url: linkUrl } : null,
    facts: (Array.isArray(raw.facts) ? raw.facts : []).filter(isPlainObject).slice(0, SOURCE_LIMITS.facts).map((f) => ({ label: txt(f.label, 120), value: txt(f.value), ...(typeof f.help === 'string' ? { help: txt(f.help) } : {}) })).filter((f) => f.label),
    sourceFields: fields,
    mappings: (Array.isArray(raw.mappings) ? raw.mappings : []).filter(isPlainObject).slice(0, SOURCE_LIMITS.fields).flatMap((m) => (typeof m.field === 'string' ? [{ field: m.field, source: typeof m.source === 'string' ? m.source : null, ...(m.locked === true ? { locked: true } : {}), ...(typeof m.note === 'string' ? { note: txt(m.note) } : {}) }] : [])),
    notes: (Array.isArray(raw.notes) ? raw.notes : []).filter(isPlainObject).slice(0, SOURCE_LIMITS.notes).map((n) => ({ severity: (n.severity === 'error' || n.severity === 'info' ? n.severity : 'warning') as 'error' | 'warning' | 'info', message: txt(n.message) })).filter((n) => n.message),
    options: (Array.isArray(raw.options) ? raw.options : []).filter(isPlainObject).slice(0, SOURCE_LIMITS.options).flatMap((o) => (typeof o.key === 'string' && (o.type === 'boolean' || o.type === 'select') ? [{
      key: txt(o.key, 64), label: txt(o.label, 120), ...(typeof o.help === 'string' ? { help: txt(o.help) } : {}), type: o.type as 'boolean' | 'select',
      value: typeof o.value === 'boolean' ? o.value : txt(o.value, 200),
      ...(Array.isArray(o.choices) ? { choices: o.choices.filter(isPlainObject).slice(0, 50).map((c) => ({ value: txt(c.value, 200), label: txt(c.label, 200) })) } : {}),
    }] : [])),
    actions: (Array.isArray(raw.actions) ? raw.actions : []).filter(isPlainObject).slice(0, SOURCE_LIMITS.actions).flatMap((a) => (typeof a.id === 'string' && typeof a.label === 'string' ? [{ id: txt(a.id, 64), label: txt(a.label, 120), ...(typeof a.help === 'string' ? { help: txt(a.help) } : {}), ...(typeof a.confirm === 'string' ? { confirm: txt(a.confirm) } : {}), tone: (a.tone === 'danger' ? 'danger' : 'default') as 'danger' | 'default' }] : [])),
    ...defaultButtonsOf(raw),
    ...saveInfoOf(raw),
    tokens: isPlainObject(raw.tokens) ? Object.fromEntries(Object.entries(raw.tokens).filter(([k, v]) => /^(return_url|url\.[a-z][a-z0-9_]{0,40})$/.test(k) && typeof v === 'string').map(([k, v]) => [k, txt(v, 120)])) : {},
  }
}


/** The provider's "Save to …" description, bounded. */
function saveInfoOf(raw: Record<string, unknown>): Pick<FormTargetDescription, 'save'> {
  if (!isPlainObject(raw.save) || typeof raw.save.label !== 'string') return {}
  const s = raw.save
  const txt = (v: unknown, max = 300) => String(v ?? '').slice(0, max)
  const operations = (Array.isArray(s.operations) ? s.operations : []).filter(isPlainObject).filter((o) => o.value === '' || o.value === 'create' || o.value === 'update').slice(0, 3)
    .map((o) => ({ value: o.value as '' | 'create' | 'update', label: txt(o.label, 120), ...(typeof o.help === 'string' ? { help: txt(o.help) } : {}) }))
  const options = (Array.isArray(s.options) ? s.options : []).filter(isPlainObject).filter((o) => typeof o.key === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(o.key) && typeof o.label === 'string').slice(0, 10)
    .map((o) => ({ key: String(o.key), label: txt(o.label, 120), ...(typeof o.help === 'string' ? { help: txt(o.help) } : {}), type: 'boolean' as const, value: o.value === true }))
  return { save: { label: txt(s.label, 160), operations, conflict: s.conflict === true, options } }
}

/** The provider's default buttons (normalized like stored buttons; only the ids it gave) and what they are called. */
function defaultButtonsOf(raw: Record<string, unknown>): Pick<FormTargetDescription, 'defaultButtons' | 'defaultsLabel'> {
  if (!Array.isArray(raw.defaultButtons) || !raw.defaultButtons.length) return {}
  const ids = new Set(raw.defaultButtons.filter(isPlainObject).map((b) => String(b.id ?? '')))
  const buttons = normalizeFormButtons(raw.defaultButtons.slice(0, 12)).filter((b) => ids.has(b.id))
  if (!buttons.length) return {}
  return { defaultButtons: buttons as unknown as Array<Record<string, unknown>>, defaultsLabel: typeof raw.defaultsLabel === 'string' && raw.defaultsLabel.trim() ? raw.defaultsLabel.trim().slice(0, 60) : 'default' }
}

/**
 * The designer's "Connected to …" panel / Data panel: the provider's
 * description of the binding for the form as it is in the designer (unsaved
 * fields and layout). Null for unbound forms or providers without `describe`.
 */
export async function describeFormTarget(ctx: ServiceContext, form: TargetForm): Promise<{ label: string; description: FormTargetDescription | null; actions: boolean; bind: boolean }> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) return { label: '', description: null, actions: false, bind: false }
  const target = await resolve(ctx, ref)
  const label = ref.label ?? target.label
  if (!target.describe) return { label, description: null, actions: false, bind: Boolean(target.bind) }
  const db = await formTargetDeps.serviceDb(ctx)
  let raw
  try {
    raw = await target.describe({ ctx: await formTargetDeps.context(ctx, ref, db), form: hookForm(form, ref) })
  } catch (error) {
    throw targetError(error, label)
  }
  return { label, description: normalizeTargetDescription(raw), actions: Boolean(target.runAction), bind: Boolean(target.bind) }
}

/**
 * The designer changed the mapping / options or adds source fields: the
 * provider returns the binding's new config (and new fields). Nothing is
 * saved here — the designer puts the result in its state and the normal
 * form save stores it. The binding must keep its identity (an update, never
 * an unbind).
 */
export async function bindFormTarget(ctx: ServiceContext, form: TargetForm, input: { mappings?: Array<{ field: string; source: string | null }>; add?: string[]; options?: Record<string, string | boolean> }): Promise<{ layout: Record<string, unknown>; fields: TaskFieldDef[] }> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) throw new ServiceError('validation_error', 'This form is not bound to an external record')
  const target = await resolve(ctx, ref)
  const label = ref.label ?? target.label
  if (!target.bind) throw new ServiceError('validation_error', `${label}: the binding can't be changed here`)
  if (target.bindPermission && !hasPerm(ctx, target.bindPermission)) throw ServiceError.forbidden(`Forbidden: changing the binding to ${label} needs the '${target.bindPermission}' permission`)
  const db = await formTargetDeps.serviceDb(ctx)
  let result
  try {
    result = await target.bind({
      ctx: await formTargetDeps.context(ctx, ref, db), form: hookForm(form, ref),
      mappings: (input.mappings ?? []).slice(0, SOURCE_LIMITS.fields).map((m) => ({ field: String(m.field), source: m.source === null ? null : String(m.source) })),
      add: (input.add ?? []).slice(0, 50).map(String),
      options: input.options ?? {},
    })
  } catch (error) {
    throw targetError(error, label)
  }
  const next = normalizeDataTarget({ ...ref, config: result?.config ?? {} })
  if (!next || !sameIdentity(target, ref, next)) throw new ServiceError('validation_error', `${label}: that change would connect the form to something else`)
  const known = new Set(form.fields.map((f) => f.key))
  const added = normalizeTaskFields(result?.fields ?? []).filter((f) => !known.has(f.key))
  const layout = { ...(isPlainObject(form.layout) ? form.layout : {}), data_target: next }
  return { layout, fields: added }
}

/** A description action (acts at once, as the person) on a saved form. */
export async function runFormTargetAction(ctx: ServiceContext, form: TargetForm & { id: string }, action: string): Promise<{ message: string | null }> {
  const ref = layoutDataTarget(form.layout)
  if (!ref) throw new ServiceError('validation_error', 'This form is not bound to an external record')
  const target = await resolve(ctx, ref)
  const label = ref.label ?? target.label
  if (!target.runAction) throw new ServiceError('validation_error', `${label} has no actions`)
  const db = await formTargetDeps.serviceDb(ctx)
  try {
    const out = await target.runAction({ ctx: await formTargetDeps.context(ctx, ref, db), form: { ...hookForm(form, ref), id: form.id }, action: String(action).slice(0, 64) })
    return { message: out?.message ? String(out.message).slice(0, 1000) : null }
  } catch (error) {
    throw targetError(error, label)
  }
}
