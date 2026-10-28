/**
 * forms.lookup — suggestions for Autocomplete / lookup fields
 * (lib/forms/lookup.ts), and the server-side check of what was selected.
 *
 * Security model:
 *  - Authorised by the TASK, not by data-table / integration permissions:
 *    the caller must hold tasks.complete and be able to act on that open
 *    task (assignee, collaborator, member of the assigned team, or a queue
 *    manager). Tenant API keys with tasks.complete act on any task of their
 *    tenant, like POST /tasks/{id}/action.
 *  - The field config is read from the task's stored form
 *    (metadata.fields), never from the request. The request only carries
 *    the field key, the typed text and the form's current values (used for
 *    {{task_data.<key>}} placeholders in filters / reference inputs;
 *    read-only fields use their stored value).
 *  - Only the configured source is queried, only on the configured
 *    columns / filters, and results are trimmed to the configured display /
 *    value / fill fields. Column names are validated against the table's
 *    columns and an identifier pattern; the typed text is escaped.
 *  - Integration credentials stay on the server (lib/reference-executor).
 *  - Tenant-scoped; rate limited per user (LOOKUP_RATE); 5 s / 8 s timeouts;
 *    friendly errors (no internal detail).
 *  - Designer preview (`previewLookup`): the config comes from the designer
 *    (it is not saved yet), so it requires workflows.edit or forms.edit —
 *    the people who could put the same query into a workflow anyway.
 *
 * Reference responses are cached per `cache_ttl_s` (in-process, bounded).
 * Items served to a task's form are remembered for 24 h (cache store) so
 * completion can confirm a reference value without calling the API again.
 */

import { createHash } from 'node:crypto'
import {
  LOOKUP_LIMITS, LOOKUP_ROW_ID, isLookupColumn, lookupFillValues, lookupItemKey, lookupMaxResults, lookupMinChars, lookupResultsArray,
  lookupTableColumns, lookupValueField, lookupValues, normalizeLookupConfig, resolveLookupTemplate, toLookupItem,
  type LookupConfig, type LookupFilter, type LookupItem,
} from '@/lib/forms/lookup'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata and table rows are free-form JSON */

export const LOOKUP_RATE = { max: 120, windowMs: 60_000 } as const
const TABLE_TIMEOUT_MS = 5000
const REFERENCE_TIMEOUT_MS = 8000
const SERVED_TTL_MS = 24 * 60 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface LookupInput {
  field_key: string
  query?: string
  /** The form's current values (for {{task_data.<key>}} in filters / inputs). */
  values?: Record<string, unknown>
}

export interface LookupResult {
  items: LookupItem[]
  /** More rows matched than were returned. */
  truncated?: boolean
  /** The reference response came from the cache. */
  cached?: boolean
  /** Fewer characters than the field's minimum: nothing was queried. */
  too_short?: boolean
}

/* ── Typed text ──────────────────────────────────────────────────────── */

/**
 * The typed text, cleaned: control characters and PostgREST's `*` wildcard
 * alias (which no escaping turns off) replaced by spaces, whitespace
 * collapsed, length-capped. LIKE wildcards are escaped where the text
 * becomes a pattern (likeEscape) and the `or` filter quotes it, so commas,
 * parentheses and quotes match literally.
 */
export function lookupSearchTerm(raw: unknown): string {
  return String(raw ?? '')
    .slice(0, LOOKUP_LIMITS.maxQuery)
    .replace(/[\u0000-\u001f\u007f*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** LIKE wildcards (and the escape character) of user text made literal. */
function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}

/** A value inside a PostgREST `or=(…)` list: double-quoted, `\` and `"` backslash-escaped. */
function orValue(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/* ── Data table queries ──────────────────────────────────────────────── */

export interface TableQueryPlan {
  /** PostgREST `or` filter for the search (null = no search text). */
  search: string | null
  filters: Array<{ column: string; op: string; value: unknown }>
  sort: { column: string; ascending: boolean } | null
  limit: number
}

function columnRef(column: string): string {
  return column === LOOKUP_ROW_ID ? 'id' : `data->>${column}`
}

/**
 * The query a table lookup runs (pure, so tests can assert it): only the
 * configured search columns, filters (templates resolved against the form's
 * values) and sort. Throws on a column the table doesn't have.
 */
export function buildTableQueryPlan(
  config: LookupConfig,
  tableColumns: string[],
  input: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null },
  options: { byValues?: string[] } = {},
): TableQueryPlan {
  const known = new Set([...tableColumns, LOOKUP_ROW_ID])
  for (const column of lookupTableColumns(config)) {
    if (!isLookupColumn(column) || !known.has(column)) throw ServiceError.validation(`The lookup refers to a column "${column}" the table does not have`)
  }
  const filters: TableQueryPlan['filters'] = []
  for (const f of config.filters ?? []) filters.push(filterClause(f, input))
  let search: string | null = null
  if (options.byValues) {
    const valueColumn = lookupValueField(config)
    const values = valueColumn === LOOKUP_ROW_ID ? options.byValues.filter((v) => UUID_RE.test(v)) : options.byValues
    filters.push({ column: columnRef(valueColumn), op: 'in', value: values })
  } else if (input.search) {
    const pattern = config.match === 'prefix' ? `${likeEscape(input.search)}%` : `%${likeEscape(input.search)}%`
    const columns = (config.search_columns ?? []).filter((c) => c !== LOOKUP_ROW_ID)
    if (columns.length) search = columns.map((c) => `${columnRef(c)}.ilike.${orValue(pattern)}`).join(',')
  }
  const sort = config.sort ? { column: columnRef(config.sort.column), ascending: config.sort.direction !== 'desc' } : null
  const limit = options.byValues ? Math.max(1, options.byValues.length) : lookupMaxResults(config) + 1
  return { search, filters, sort, limit }
}

function filterClause(filter: LookupFilter, input: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null }) {
  const column = columnRef(filter.column)
  if (filter.operator === 'is_set') return { column, op: 'not_null', value: null }
  if (filter.operator === 'is_not_set') return { column, op: 'is_null', value: null }
  const resolved = resolveLookupTemplate(filter.value ?? '', { search: input.search, values: input.values, task: input.task })
  const text = resolved === null || resolved === undefined ? '' : typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved)
  if (filter.operator === 'contains') return { column, op: 'ilike', value: `%${likeEscape(lookupSearchTerm(text))}%` }
  return { column, op: filter.operator, value: text }
}

function applyPlan(query: any, plan: TableQueryPlan): any {
  let q = query
  for (const f of plan.filters) {
    switch (f.op) {
      case 'eq': q = q.eq(f.column, f.value); break
      case 'neq': q = q.neq(f.column, f.value); break
      case 'gt': q = q.gt(f.column, f.value); break
      case 'gte': q = q.gte(f.column, f.value); break
      case 'lt': q = q.lt(f.column, f.value); break
      case 'lte': q = q.lte(f.column, f.value); break
      case 'ilike': q = q.ilike(f.column, f.value); break
      case 'not_null': q = q.not(f.column, 'is', null); break
      case 'is_null': q = q.is(f.column, null); break
      case 'in': q = q.in(f.column, f.value as string[]); break
    }
  }
  if (plan.search) q = q.or(plan.search)
  q = plan.sort ? q.order(plan.sort.column, { ascending: plan.sort.ascending }) : q.order('created_at', { ascending: true })
  return q.limit(plan.limit)
}

async function tableColumnsOf(db: AnySupabaseClient, tenantId: string, tableId: string): Promise<string[]> {
  const { data } = await (db as any).from('custom_tables').select('columns').eq('tenant_id', tenantId).eq('id', tableId).maybeSingle()
  if (!data) throw ServiceError.notFound('The lookup\'s data table no longer exists')
  const raw = Array.isArray(data.columns) ? data.columns : isPlainObject(data.columns) ? Object.keys(data.columns).map((key) => ({ key })) : []
  return raw.map((c: any) => String(c?.key ?? c?.name ?? '')).filter(Boolean)
}

async function runTable(db: AnySupabaseClient, tenantId: string, config: LookupConfig, input: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null }, byValues?: string[]): Promise<{ items: LookupItem[]; truncated: boolean }> {
  if (!config.table_id) throw ServiceError.validation('The lookup has no data table')
  const columns = await tableColumnsOf(db, tenantId, config.table_id)
  const plan = buildTableQueryPlan(config, columns, input, { byValues })
  if (byValues && (plan.filters.at(-1)?.value as string[] | undefined)?.length === 0) return { items: [], truncated: false }
  const base = (db as any).from('custom_table_rows').select('id, data').eq('tenant_id', tenantId).eq('table_id', config.table_id)
  let query = applyPlan(base, plan)
  if (typeof query.abortSignal === 'function') query = query.abortSignal(AbortSignal.timeout(TABLE_TIMEOUT_MS))
  const { data, error } = await query
  if (error) {
    if (/abort/i.test(String(error.message ?? ''))) throw new ServiceError('internal', 'The lookup took too long — try again', { status: 504 })
    console.error('[forms.lookup] table query failed:', error.message)
    throw new ServiceError('internal', 'The lookup is not available right now', { status: 502 })
  }
  const rows = (data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>
  const max = byValues ? rows.length : lookupMaxResults(config)
  const items: LookupItem[] = []
  for (const row of rows.slice(0, max)) {
    const item = toLookupItem(config, { ...(isPlainObject(row.data) ? row.data : {}), [LOOKUP_ROW_ID]: row.id })
    if (item) items.push(item)
  }
  return { items, truncated: rows.length > max }
}

/* ── Reference queries ───────────────────────────────────────────────── */

const responseCache = new Map<string, { expires: number; items: LookupItem[]; truncated: boolean }>()
const RESPONSE_CACHE_MAX = 500

/** Test hook. */
export function clearLookupCache() {
  responseCache.clear()
}

function cacheKey(tenantId: string, config: LookupConfig, inputs: Record<string, string>): string {
  return createHash('sha256').update(JSON.stringify([tenantId, config.reference_id, inputs, config.results_path ?? '', config.display_fields ?? [], config.value_field ?? '', config.fill ?? [], lookupMaxResults(config)])).digest('hex')
}

/** Reference inputs for a lookup: each mapping resolved ({{search}}, {{task_data.<key>}}). */
export function referenceLookupInputs(config: LookupConfig, input: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [name, templateText] of Object.entries(config.input_mappings ?? {})) {
    const v = resolveLookupTemplate(templateText, input)
    out[name] = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
  return out
}

/** Executor seam (tests replace it). */
export const lookupDeps = {
  executeReference: async (opts: Parameters<typeof import('@/lib/reference-executor').executeReference>[0]) => (await import('@/lib/reference-executor')).executeReference(opts),
  now: () => Date.now(),
}

async function runReference(db: AnySupabaseClient, tenantId: string, config: LookupConfig, input: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null }, callerId: string | null): Promise<{ items: LookupItem[]; truncated: boolean; cached: boolean }> {
  if (!config.reference_id) throw ServiceError.validation('The lookup has no API reference')
  const inputs = referenceLookupInputs(config, input)
  const ttl = (config.cache_ttl_s ?? 0) * 1000
  const key = ttl > 0 ? cacheKey(tenantId, config, inputs) : ''
  if (key) {
    const hit = responseCache.get(key)
    if (hit && hit.expires > lookupDeps.now()) return { items: hit.items, truncated: hit.truncated, cached: true }
    if (hit) responseCache.delete(key)
  }
  let data: unknown
  let status = 200
  try {
    const { newTraceId } = await import('@/lib/trace')
    const result = await lookupDeps.executeReference({
      supabase: db as any,
      referenceId: config.reference_id,
      inputValues: inputs,
      timeout: REFERENCE_TIMEOUT_MS,
      expectedTenantId: tenantId,
      caller: { traceId: newTraceId(), callerType: 'form_lookup', callerId },
    })
    data = result.data
    status = result.status ?? 200
  } catch (error: any) {
    const message = String(error?.message ?? '')
    if (/reference not found/i.test(message)) throw ServiceError.notFound('The lookup\'s API reference no longer exists')
    if (/abort|timed? ?out/i.test(message)) throw new ServiceError('internal', 'The lookup took too long — try again', { status: 504 })
    console.warn('[forms.lookup] reference call failed:', message.slice(0, 300))
    throw new ServiceError('internal', 'The lookup service is not available right now', { status: 502 })
  }
  if (status >= 400) throw new ServiceError('internal', 'The lookup service is not available right now', { status: 502 })
  const max = lookupMaxResults(config)
  const results = lookupResultsArray(config, data)
  const items: LookupItem[] = []
  for (const record of results) {
    const item = toLookupItem(config, record)
    if (item && !items.some((i) => i.value === item.value)) items.push(item)
    if (items.length > max) break
  }
  const out = { items: items.slice(0, max), truncated: items.length > max }
  if (key) {
    if (responseCache.size >= RESPONSE_CACHE_MAX) {
      const oldest = responseCache.keys().next().value
      if (oldest !== undefined) responseCache.delete(oldest)
    }
    responseCache.set(key, { expires: lookupDeps.now() + ttl, ...out })
  }
  return { ...out, cached: false }
}

/* ── Served items (reference values confirmed at completion) ─────────── */

function servedKey(taskId: string, fieldKey: string, value: string): string {
  return `lookup:served:${createHash('sha256').update(`${taskId}\u0000${fieldKey}\u0000${value}`).digest('hex')}`
}

async function rememberServed(taskId: string, fieldKey: string, items: LookupItem[]) {
  try {
    const store = await (await import('@/lib/providers/cache')).getCacheStore()
    await Promise.all(items.map(async (item) => {
      const json = JSON.stringify(item)
      if (json.length <= 4096) await store.set(servedKey(taskId, fieldKey, item.value), json, SERVED_TTL_MS)
    }))
  } catch { /* best effort: completion re-queries instead */ }
}

async function recallServed(taskId: string, fieldKey: string, value: string): Promise<LookupItem | null> {
  try {
    const store = await (await import('@/lib/providers/cache')).getCacheStore()
    const json = await store.get(servedKey(taskId, fieldKey, value))
    if (!json) return null
    const item = JSON.parse(json)
    return isPlainObject(item) && item.value === value ? item as unknown as LookupItem : null
  } catch {
    return null
  }
}

/* ── Running a lookup ────────────────────────────────────────────────── */

/** Form values for placeholders: the submitted values of editable fields over the stored ones. */
export function lookupScopeValues(fields: TaskFieldDef[], stored: Record<string, unknown>, submitted: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored }
  if (!submitted) return out
  for (const field of fields) {
    if (field.read_only || field.type === 'heading' || field.type === 'divider') continue
    if (Object.prototype.hasOwnProperty.call(submitted, field.key)) out[field.key] = submitted[field.key]
  }
  return out
}

async function runLookup(db: AnySupabaseClient, tenantId: string, config: LookupConfig, input: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null }, callerId: string | null): Promise<LookupResult> {
  if (input.search.length < lookupMinChars(config)) return { items: [], too_short: true }
  if (config.source === 'reference') {
    const { items, truncated, cached } = await runReference(db, tenantId, config, input, callerId)
    return { items, ...(truncated ? { truncated } : {}), ...(cached ? { cached } : {}) }
  }
  const { items, truncated } = await runTable(db, tenantId, config, input)
  return { items, ...(truncated ? { truncated } : {}) }
}

async function rateLimited(ctx: ServiceContext) {
  const { rateLimit } = await import('@/lib/rate-limit')
  const who = ctx.actorId ?? ctx.credentialId ?? 'tenant'
  const hit = await rateLimit(`form-lookup:${ctx.tenantId}:${who}`, LOOKUP_RATE)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many lookups — wait a moment and try again', { details: { retry_after_ms: hit.retryAfterMs } })
}

const TASK_COLUMNS = 'id, tenant_id, title, status, priority, assignee_id, assigned_team_id, metadata, deleted_at'

/**
 * Load a task the caller may run lookups on: tasks.complete, same tenant,
 * open, and (for a user) assignee / collaborator / team member / queue
 * manager.
 */
export async function loadLookupTask(ctx: ServiceContext, db: AnySupabaseClient, taskId: string): Promise<Record<string, any>> {
  requirePerm(ctx, 'tasks.complete')
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const { data: task } = await (db as any).from('tasks').select(TASK_COLUMNS).eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (!task) throw ServiceError.notFound('Task not found')
  if (task.status === 'completed' || task.status === 'cancelled') throw ServiceError.conflict('This task is closed')
  if (ctx.actorId && !(await canActOnTask(ctx, db, task))) throw ServiceError.forbidden('Forbidden: you cannot act on that task')
  return task
}

async function canActOnTask(ctx: ServiceContext, db: AnySupabaseClient, task: Record<string, any>): Promise<boolean> {
  const userId = ctx.actorId!
  if (task.assignee_id === userId) return true
  if (ctx.permissions !== null && hasPerm(ctx, 'tasks.manage_queue')) return true
  const { data: collaborator } = await (db as any).from('task_assignees').select('task_id').eq('tenant_id', ctx.tenantId).eq('task_id', task.id).eq('user_id', userId).maybeSingle()
  if (collaborator) return true
  if (task.assigned_team_id) {
    const { data: member } = await (db as any).from('user_teams').select('user_id').eq('team_id', task.assigned_team_id).eq('user_id', userId).maybeSingle()
    if (member) return true
  }
  return false
}

function taskScope(task: Record<string, any>) {
  return { id: task.id, title: task.title, priority: task.priority, status: task.status }
}

/** Suggestions for a lookup field of a task's form (task screen, REST, MCP). */
export async function lookupTaskField(ctx: ServiceContext, taskId: string, input: LookupInput): Promise<LookupResult> {
  const db = await serviceRoleClient(ctx)
  const task = await loadLookupTask(ctx, db, taskId)
  const meta = (task.metadata ?? {}) as Record<string, any>
  const fields = normalizeTaskFields(meta.fields)
  const field = fields.find((f) => f.key === input.field_key && f.type === 'lookup')
  if (!field?.lookup) throw ServiceError.notFound(`The task's form has no lookup field "${String(input.field_key).slice(0, 64)}"`)
  await rateLimited(ctx)
  const stored = isPlainObject(meta.template_values) ? meta.template_values : {}
  const values = lookupScopeValues(fields, stored, isPlainObject(input.values) ? input.values : undefined)
  const result = await runLookup(db, ctx.tenantId, field.lookup, { search: lookupSearchTerm(input.query), values, task: taskScope(task) }, task.id)
  if (field.lookup.source === 'reference' && result.items.length) void rememberServed(task.id, field.key, result.items)
  return result
}

/**
 * Suggestions on a reusable form's own page (/f/<id>): authorised by
 * forms.submit, the config read from the stored form (latest version), the
 * same limits as task lookups. Items served are remembered per form and
 * submitter, so the submission confirms reference values like a task does.
 */
export async function lookupFormField(ctx: ServiceContext, formId: string, input: LookupInput): Promise<LookupResult> {
  requirePerm(ctx, 'forms.submit')
  if (!UUID_RE.test(formId)) throw ServiceError.notFound('Form not found')
  const db = await serviceRoleClient(ctx)
  const { data: form } = await (db as any).from('forms').select('id, fields').eq('id', formId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (!form) throw ServiceError.notFound('Form not found')
  const fields = normalizeTaskFields(form.fields)
  const field = fields.find((f) => f.key === input.field_key && f.type === 'lookup')
  if (!field?.lookup) throw ServiceError.notFound(`The form has no lookup field "${String(input.field_key).slice(0, 64)}"`)
  await rateLimited(ctx)
  const values = lookupScopeValues(fields, {}, isPlainObject(input.values) ? input.values : undefined)
  const scope = formLookupScope(formId, ctx.actorId)
  const result = await runLookup(db, ctx.tenantId, field.lookup, { search: lookupSearchTerm(input.query), values, task: null }, scope)
  if (field.lookup.source === 'reference' && result.items.length) void rememberServed(scope, field.key, result.items)
  return result
}

/** The served-items scope of a standalone form (form + submitter), used instead of a task id. */
export function formLookupScope(formId: string, actorId: string | null): string {
  return `form:${formId}:${actorId ?? 'tenant'}`
}

/**
 * Designer preview: the real lookup on a config that isn't saved yet.
 * Requires workflows.edit or forms.edit; tenant-scoped; rate limited.
 */
export async function previewLookup(ctx: ServiceContext, input: { field: unknown; query?: string; values?: Record<string, unknown> }): Promise<LookupResult> {
  if (!hasPerm(ctx, 'workflows.edit') && !hasPerm(ctx, 'forms.edit')) {
    throw ServiceError.forbidden("Forbidden: previewing a lookup needs the 'workflows.edit' or 'forms.edit' permission")
  }
  const [field] = normalizeTaskFields([input.field])
  if (!field || field.type !== 'lookup' || !field.lookup) throw ServiceError.validation('Not a lookup field')
  await rateLimited(ctx)
  const db = await serviceRoleClient(ctx)
  const values = isPlainObject(input.values) ? input.values : {}
  return runLookup(db, ctx.tenantId, field.lookup, { search: lookupSearchTerm(input.query), values, task: null }, null)
}

/* ── Completion: confirm selections, compute `<key>_item` ───────────── */

export interface LookupSelectionResult {
  errors: Record<string, string>
  /** `<key>_item` values to store (object, array or null). */
  items: Record<string, unknown>
  /**
   * "Fill other fields" values from the server-verified item (target key →
   * raw value, null when nothing is selected / the value was not found). A
   * multi-select fills from its last item, like the browser does.
   */
  fills: Record<string, unknown>
}

function fillsFrom(config: LookupConfig, item: unknown): Record<string, unknown> {
  return lookupFillValues(config, isPlainObject(item) ? { value: '', label: '', fields: item } : null)
}

function itemFields(item: LookupItem): Record<string, unknown> {
  return item.fields
}

/**
 * Check every lookup field's value against its source (re-query by value
 * with the same config and the final form values) and build the stored
 * `<key>_item`. `strict` (completion) turns a value that is not in the
 * source into an error unless the field allows free text; drafts only
 * resolve what they can. A value unchanged since the last save keeps its
 * stored item without a query.
 */
export async function resolveLookupSelections(
  db: AnySupabaseClient,
  tenantId: string,
  fields: TaskFieldDef[],
  values: Record<string, unknown>,
  options: { strict: boolean; taskId?: string | null; previous?: Record<string, unknown>; task?: Record<string, unknown> | null; keys?: string[] },
): Promise<LookupSelectionResult> {
  const errors: Record<string, string> = {}
  const items: Record<string, unknown> = {}
  const fills: Record<string, unknown> = {}
  const lastItem = (stored: unknown) => (Array.isArray(stored) ? stored[stored.length - 1] : stored)
  for (const field of fields) {
    if (field.type !== 'lookup' || !field.lookup) continue
    if (options.keys && !options.keys.includes(field.key)) continue
    const config = normalizeLookupConfig(field.lookup)
    const selected = lookupValues(values[field.key], config.multiple)
    const itemKey = lookupItemKey(field.key)
    if (!selected.length) { items[itemKey] = config.multiple ? [] : null; Object.assign(fills, fillsFrom(config, null)); continue }
    const prevValues = lookupValues(options.previous?.[field.key], config.multiple)
    const prevItem = options.previous?.[itemKey]
    if (prevItem !== undefined && prevValues.length === selected.length && prevValues.every((v, i) => v === selected[i])) {
      items[itemKey] = prevItem
      Object.assign(fills, fillsFrom(config, lastItem(prevItem)))
      continue
    }
    let found = new Map<string, LookupItem>()
    try {
      found = await findByValues(db, tenantId, field, config, selected, values, options)
    } catch (error) {
      if (options.strict && !config.allow_free_text) {
        errors[field.key] = `${field.label}: ${error instanceof ServiceError ? error.message : 'the lookup could not confirm the value'}`
      }
      items[itemKey] = config.multiple ? [] : null
      Object.assign(fills, fillsFrom(config, null))
      continue
    }
    const missing = selected.filter((v) => !found.has(v))
    if (missing.length && options.strict && !config.allow_free_text) {
      errors[field.key] = selected.length > 1
        ? `${field.label}: "${missing[0].slice(0, 80)}" is not one of the available options`
        : `${field.label}: choose one of the suggestions`
    }
    const chosen = selected.map((v) => found.get(v)).filter((i): i is LookupItem => Boolean(i)).map(itemFields)
    items[itemKey] = config.multiple ? chosen : (chosen[0] ?? null)
    Object.assign(fills, fillsFrom(config, config.multiple ? chosen[chosen.length - 1] : chosen[0]))
  }
  return { errors, items, fills }
}

async function findByValues(db: AnySupabaseClient, tenantId: string, field: TaskFieldDef, config: LookupConfig, selected: string[], values: Record<string, unknown>, options: { taskId?: string | null; task?: Record<string, unknown> | null }): Promise<Map<string, LookupItem>> {
  const found = new Map<string, LookupItem>()
  if (config.source === 'table') {
    const { items } = await runTable(db, tenantId, config, { search: '', values, task: options.task ?? null }, selected)
    for (const item of items) if (selected.includes(item.value)) found.set(item.value, item)
    return found
  }
  // Reference: items this task's form was served, else ask the API with the value as the search text.
  for (const value of selected) {
    const served = options.taskId ? await recallServed(options.taskId, field.key, value) : null
    if (served) { found.set(value, served); continue }
    const { items } = await runReference(db, tenantId, config, { search: value, values, task: options.task ?? null }, options.taskId ?? null)
    const hit = items.find((i) => i.value === value)
    if (hit) found.set(value, hit)
  }
  return found
}
