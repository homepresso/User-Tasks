/**
 * Server-side task value checks every write path runs (task screen save /
 * complete, REST /tasks/{id}/action and PATCH /tasks/{id}, MCP tasks_*,
 * CLI via REST): the pure type / required / validation rules of
 * mergeTaskFieldValues, plus what needs the database — a Person field must
 * name an active member of the task's workspace, and an Autocomplete /
 * lookup field's value must exist in its source (unless it allows free
 * text); the selected item is stored as `<key>_item` (computed here, never
 * taken from the client); an Attachments field's files are rebuilt from the
 * server's upload records (lib/services/form-files.ts) — only files
 * uploaded into this task / form by this submitter — with `<key>_count`.
 * Never trust the client.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { FileValueContext } from '@/lib/services/form-files'
import { coerceTaskFieldValues, mergeTaskFieldValues, normalizeTaskFields, usesFileUploads } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { isPeopleList, normalizePeopleValue } from './people-field'
import { CONTROLS_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY, hasFormContext, includedFormContext, serverFormContext, stripFormContext } from './form-params'
import { serverControlEntries } from './rule-variables'
import { readsTableRows } from './label-field'
import { loadRuleUser } from '@/lib/services/form-rule-user'
import { innerFieldsDeep } from '@/lib/forms/repeating-section'
import { holdsNestedSignatures } from '@/lib/forms/signature-cells'

/** Whether a form's rules, sections or List validations read the user (`user.*`): the server then loads its own view of the submitter. */
export function readsRuleUser(metadata: Record<string, unknown> | null | undefined): boolean {
  const layout = isPlainObject(metadata?.form_layout) ? metadata!.form_layout as Record<string, unknown> : null
  const reads = (v: unknown) => v !== undefined && v !== null && /["{\s.]user\.|"user"/.test(JSON.stringify(v))
  if (layout && reads(layout.rules)) return true
  return normalizeTaskFields(metadata?.fields).some((f) => f.type === 'list' && reads(f.list))
}

/* eslint-disable @typescript-eslint/no-explicit-any -- user_memberships is read untyped */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * "Fill other fields from the selected item": the values come from the
 * server-verified item (resolveLookupSelections), coerced to each target's
 * type. Every target — read-only or editable — always gets the item's
 * value, whatever the client sent: the selected item is the source of truth
 * for the fields it fills (mergeTaskFieldValues drops read-only values, which
 * is why fills used to be lost).
 */
function lookupFillTargets(fields: ReturnType<typeof normalizeTaskFields>, fills: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fills)) {
    const target = fields.find((f) => f.key === key)
    if (!target || target.type === 'lookup' || target.type === 'attachments') continue
    Object.assign(out, coerceTaskFieldValues([target], { [key]: value }))
  }
  return out
}

export interface CheckOptions {
  partial?: boolean
  taskId?: string | null
  task?: Record<string, unknown> | null
  /** Where attachment uploads must come from (default: the task `taskId`). */
  files?: FileValueContext | null
  /** The submitter, for Data table checks (their read access applies; without it, a tenant-scoped read bounded by the field's base filter). */
  ctx?: import('@/lib/services/context').ServiceContext | null
  actorId?: string | null
  /**
   * Parameters come from the values' reserved key (a reusable form's submission, already
   * re-validated by the caller). Default: a task's — what its workflow passed when it
   * created the task (`metadata.form_params`), never the client's.
   */
  contextFromValues?: boolean
  /**
   * The bar buttons the submission counts as (the pressed one): a
   * Before-submit rule aimed at another button does not apply. Absent: every
   * rule applies.
   */
  buttonIds?: readonly string[] | null
  /** Where the form's rule steps run (a task, or a reusable form): rule-loaded options are checked against what they served. */
  ruleTarget?: { task_id: string } | { form_id: string } | null
  /** The context that check runs as (default `ctx`): a task's completer. */
  ruleCtx?: import('@/lib/services/context').ServiceContext | null
}

export async function mergeTaskFieldValuesChecked(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  metadata: Record<string, unknown> | null | undefined,
  values: Record<string, unknown> | null | undefined,
  options: CheckOptions = {},
): Promise<{ errors: Record<string, string>; templateValues: Record<string, unknown> }> {
  // Parameters / variables (lib/forms/form-params.ts): re-validated against the saved layout; the
  // ones marked "Include in submission" are stored beside the fields under their names.
  const layout = metadata?.form_layout
  let included: Record<string, unknown> = {}
  // {{control.*}}: the controls' state rebuilt from the values (declared controls and columns only).
  const controls = values ? serverControlEntries(layout, normalizeTaskFields(metadata?.fields), values) : {}
  if (hasFormContext(layout) && values) {
    const stored = isPlainObject(metadata?.form_params) ? metadata!.form_params : {}
    const context = serverFormContext(layout, { values }, { storedParams: options.contextFromValues ? null : stored })
    values = { ...stripFormContext(values), ...context.entries, ...controls }
    included = includedFormContext(layout, context, normalizeTaskFields(metadata?.fields).map((f) => f.key))
  } else if (values) {
    values = { ...stripFormContext(values), ...controls }
  }
  // Dynamic properties (lib/forms/dynamic-values.ts): options, bounds and required re-resolved on the
  // server for this submission's context — what is judged is the server's list, never the browser's.
  let dynamicErrors: Record<string, string> = {}
  if (!options.partial && values) {
    const fields = normalizeTaskFields(metadata?.fields)
    const { needsDynamicValidation, resolveDynamicFields } = await import('@/lib/services/form-dynamic-values')
    if (needsDynamicValidation(fields)) {
      const existing = isPlainObject(metadata?.template_values) ? metadata!.template_values as Record<string, unknown> : {}
      const resolved = await resolveDynamicFields(options.ctx ?? null, tenantId, fields, { ...existing, ...values }, { actorId: options.actorId ?? options.ctx?.actorId ?? null, task: options.task ?? null })
      metadata = { ...(metadata ?? {}), fields: resolved.fields }
      dynamicErrors = resolved.errors
    }
  }
  const checked = await checkedValues(supabase, tenantId, metadata, values, options)
  const result = Object.keys(dynamicErrors).length ? { errors: { ...checked.errors, ...dynamicErrors }, templateValues: checked.templateValues } : checked
  return Object.keys(included).length ? { errors: result.errors, templateValues: { ...result.templateValues, ...included } } : result
}

async function checkedValues(
  supabase: SupabaseClient<any, any, any>,
  tenantId: string,
  metadata: Record<string, unknown> | null | undefined,
  values: Record<string, unknown> | null | undefined,
  options: CheckOptions,
): Promise<{ errors: Record<string, string>; templateValues: Record<string, unknown> }> {
  // Labels stored with the submission that add up a table's rows: the server reads those rows itself (lib/forms/label-field.ts).
  const allFields = normalizeTaskFields(metadata?.fields)
  const rowTables = options.partial || !values ? [] : [...new Set(allFields.filter((f) => f.type === 'label' && f.label_config?.include && f.label_config.expression).flatMap((f) => readsTableRows(f)))]
  let labelRows: Record<string, Array<Record<string, unknown>>> | undefined
  if (rowTables.length) {
    const { serverLabelRows } = await import('@/lib/services/form-data-table')
    const read = await serverLabelRows(options.ctx ?? null, tenantId, allFields, rowTables, values ?? {}, options.actorId ?? options.ctx?.actorId ?? null)
    if (Object.keys(read.errors).length) return { errors: read.errors, templateValues: {} }
    labelRows = read.rows
  }
  // Rules / List validations reading the user (`user.*`, roles, teams): the server's own view of the submitter, never the browser's.
  // Known submitter → their roles / teams; a public link (anonymous) → empty ones; an unknown caller (a workspace API key) → not judged (as before).
  const actor = options.actorId ?? options.ctx?.actorId ?? null
  const anonymous = !actor && options.ctx?.authKind === 'anonymous'
  const ruleUser = !options.partial && values && (actor || anonymous) && readsRuleUser(metadata) ? await loadRuleUser(supabase, tenantId, actor) : undefined
  const merged = mergeTaskFieldValues(metadata, values, { ...options, labelRows, ...(ruleUser ? { ruleUser: ruleUser as unknown as Record<string, unknown> } : {}) })
  if (Object.keys(merged.errors).length > 0) return merged
  const fields = allFields
  const errors: Record<string, string> = {}
  // {{param.x}} / {{var.x}} in lookup filters and Data table base filters: the server-validated
  // parameters / variables the caller put into the values (serverFormContext) — never stored.
  const context: Record<string, unknown> = {}
  for (const key of [FORM_PARAMS_KEY, FORM_VARS_KEY, CONTROLS_KEY]) if (values && Object.prototype.hasOwnProperty.call(values, key)) context[key] = values[key]

  // Lookups: confirm the values, store `<key>_item`. On drafts only the
  // submitted lookups are resolved; completion checks every lookup.
  const lookups = fields.filter((f) => f.type === 'lookup' && !f.read_only)
  const lookupKeys = options.partial
    ? lookups.filter((f) => values && Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => f.key)
    : lookups.map((f) => f.key)
  let templateValues = merged.templateValues
  if (lookupKeys.length) {
    const { resolveLookupSelections } = await import('@/lib/services/form-lookup')
    const { createServiceClient } = await import('@/lib/cron-auth')
    const existing = isPlainObject(metadata?.template_values) ? metadata!.template_values as Record<string, unknown> : {}
    const resolved = await resolveLookupSelections(createServiceClient(), tenantId, fields, { ...merged.templateValues, ...context }, {
      strict: !options.partial,
      taskId: options.taskId ?? null,
      task: options.task ?? null,
      previous: existing,
      keys: lookupKeys,
    })
    Object.assign(errors, resolved.errors)
    templateValues = { ...templateValues, ...resolved.items, ...lookupFillTargets(fields, resolved.fills ?? {}) }
  }
  // List lookup cells (lib/forms/list-field.ts): each confirmed in its column's source, labels from the source.
  const lists = fields.filter((f) => f.type === 'list' && !f.read_only && f.list?.columns.some((c) => c.type === 'lookup'))
  const listKeys = options.partial ? lists.filter((f) => values && Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => f.key) : lists.map((f) => f.key)
  if (listKeys.length) {
    const { verifyListLookups } = await import('@/lib/services/form-lookup')
    const { createServiceClient } = await import('@/lib/cron-auth')
    const verified = await verifyListLookups(createServiceClient(), tenantId, fields, { ...templateValues, ...context }, { strict: !options.partial, taskId: options.taskId ?? null, task: options.task ?? null, keys: listKeys })
    Object.assign(errors, verified.errors)
    templateValues = { ...templateValues, ...verified.values }
  }
  // Choices whose options a rule loads (lib/forms/data-actions.ts): the value must be one the person was offered.
  const ruleCtx = options.ruleCtx ?? options.ctx
  if (!options.partial && ruleCtx && options.ruleTarget) {
    const { ruleOptionFields } = await import('@/lib/forms/data-actions')
    const { allActions } = await import('@/lib/forms/field-buttons')
    const { layoutFormRules } = await import('@/lib/forms/form-rules')
    const loose = ruleOptionFields(layoutFormRules(metadata?.form_layout).flatMap((r) => allActions(r.then)))
    if (loose.size) {
      const { verifyRuleOptions } = await import('@/lib/services/form-rule-actions')
      try {
        Object.assign(errors, await verifyRuleOptions(ruleCtx, options.ruleTarget, templateValues, [...loose]))
      } catch (error) {
        // The form / task can't be read as the checker: the rule-loaded value can't be confirmed.
        console.warn('[forms] rule-loaded options check skipped:', error instanceof Error ? error.message : error)
      }
    }
  }
  // Data tables: selections re-read from the source, change sets validated
  // and their `before` re-read (lib/services/form-data-table.ts).
  const tables = fields.filter((f) => f.type === 'data_table' && f.data_table && f.data_table.mode !== 'display' && !f.read_only)
  const tableKeys = options.partial
    ? tables.filter((f) => values && Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => f.key)
    : tables.map((f) => f.key)
  if (tableKeys.length) {
    const { resolveDataTableValues } = await import('@/lib/services/form-data-table')
    const resolved = await resolveDataTableValues(options.ctx ?? null, tenantId, fields, { ...templateValues, ...context }, { keys: tableKeys, strict: !options.partial, actorId: options.actorId ?? options.ctx?.actorId ?? null })
    Object.assign(errors, resolved.errors)
    templateValues = { ...templateValues, ...resolved.values }
  }
  // Attachments and file-valued custom controls (signature, PDF viewer
  // uploads): the files are re-read from the upload records (this task's,
  // or this submitter's uploads to this form); `<key>_count` added.
  // …and repeating sections with file controls inside their items (lib/forms/repeating-section.ts).
  // …and Lists with signature columns (each row's signature; lib/forms/signature-cells.ts).
  const attachments = fields.filter((f) => (usesFileUploads(f) || (f.type === 'repeating_section' && innerFieldsDeep([f]).some((x) => usesFileUploads(x.field))) || holdsNestedSignatures(f)) && !f.read_only)
  const attachmentKeys = options.partial
    ? attachments.filter((f) => values && Object.prototype.hasOwnProperty.call(values, f.key)).map((f) => f.key)
    : attachments.map((f) => f.key)
  if (attachmentKeys.length) {
    const { resolveAttachmentValues } = await import('@/lib/services/form-files')
    const { createServiceClient } = await import('@/lib/cron-auth')
    const context: FileValueContext | null = options.files
      ?? (options.taskId && UUID_RE.test(options.taskId) ? { kind: 'task', taskId: options.taskId } : null)
    // A task's saved values: files it already holds for a control (a signature carried over from an earlier task) stay valid.
    const stored = context?.kind === 'task' && isPlainObject(metadata?.template_values) ? metadata!.template_values as Record<string, unknown> : null
    const resolved = await resolveAttachmentValues(createServiceClient(), tenantId, fields, templateValues, context, attachmentKeys, stored)
    Object.assign(errors, resolved.errors)
    templateValues = { ...templateValues, ...resolved.values }
  }
  // Signatures (lib/services/form-signatures.ts): who signed, when, and (capture_audit) from where — the server's facts only.
  // …in repeating sections' items and List rows too (each one stamped like a field).
  const signatureKeys = attachmentKeys.filter((key) => fields.some((f) => f.key === key && (f.type === 'signature' || holdsNestedSignatures(f))))
  if (signatureKeys.length && !Object.keys(errors).some((key) => signatureKeys.includes(key) || signatureKeys.some((k) => key.startsWith(`${k}[`)))) {
    const { stampSignatureValues } = await import('@/lib/services/form-signatures')
    const { createServiceClient } = await import('@/lib/cron-auth')
    const existing = isPlainObject(metadata?.template_values) ? metadata!.template_values as Record<string, unknown> : {}
    const stamped = await stampSignatureValues(createServiceClient(), fields, templateValues, { actorId: options.actorId ?? options.ctx?.actorId ?? null, previous: existing, keys: signatureKeys })
    templateValues = { ...templateValues, ...stamped }
  }
  if (!values) return { errors, templateValues }
  const people = fields.filter((f) => f.type === 'user' && !f.read_only && !isPeopleList(f))
  const wanted = new Map<string, string>()
  for (const field of people) {
    const value = values[field.key]
    if (typeof value === 'string' && value.trim()) wanted.set(field.key, value.trim())
  }
  // People lists (lib/forms/people-field.ts): every user / team in this workspace; names set from the workspace, never the browser's.
  const peopleLists = fields.filter((f) => isPeopleList(f) && !f.read_only && Object.prototype.hasOwnProperty.call(values, f.key) && !errors[f.key])
  const listRefs = new Map(peopleLists.map((f) => [f.key, normalizePeopleValue(templateValues[f.key] ?? values[f.key])]))
  const listUserIds = [...new Set([...listRefs.values()].flat().filter((r) => r.kind === 'user').map((r) => r.id))]
  const teamIds = [...new Set([...listRefs.values()].flat().filter((r) => r.kind === 'team').map((r) => r.id))]
  const userNames = new Map<string, string>()
  const teamNames = new Map<string, string>()
  if (listUserIds.length) {
    const { data } = await (supabase as any).from('users').select('id, display_name, email').in('id', listUserIds)
    for (const u of (data ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) userNames.set(String(u.id), u.display_name || u.email || 'A person')
  }
  if (teamIds.length) {
    const { data } = await (supabase as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', teamIds)
    for (const t of (data ?? []) as Array<{ id: string; name: string | null }>) teamNames.set(String(t.id), t.name || 'A team')
  }
  if (wanted.size > 0 || listUserIds.length) {
    const ids = [...new Set([...wanted.values(), ...listUserIds])]
    const { data } = await (supabase as any).from('user_memberships')
      .select('user_id').eq('tenant_id', tenantId).eq('is_active', true).in('user_id', ids)
    const members = new Set(((data ?? []) as Array<{ user_id: string }>).map((r) => String(r.user_id)))
    const missing = ids.filter((id) => !members.has(id))
    if (missing.length) {
      // Home-workspace users may have no membership row.
      const { data: home } = await (supabase as any).from('users').select('id').eq('tenant_id', tenantId).in('id', missing)
      for (const row of (home ?? []) as Array<{ id: string }>) members.add(String(row.id))
    }
    for (const field of people) {
      const id = wanted.get(field.key)
      if (id && !members.has(id)) errors[field.key] = `${field.label} must be a person in this workspace`
    }
    for (const id of [...userNames.keys()]) if (!members.has(id)) userNames.delete(id)
  }
  for (const field of peopleLists) {
    const refs = listRefs.get(field.key) ?? []
    const unknown = refs.filter((r) => !(r.kind === 'team' ? teamNames : userNames).has(r.id))
    if (unknown.length) {
      errors[field.key] = `${field.label} must be ${field.user_config?.allow_teams ? 'people or teams' : 'people'} in this workspace`
      continue
    }
    templateValues = { ...templateValues, [field.key]: refs.map((r) => ({ kind: r.kind, id: r.id, name: (r.kind === 'team' ? teamNames : userNames).get(r.id)! })) }
  }
  return { errors, templateValues }
}
