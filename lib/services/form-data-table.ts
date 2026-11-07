/**
 * forms.dataTable — the rows of a Data table field (lib/forms/data-table.ts):
 * search, column filters, sort and paging run here, never in the browser;
 * and the server-side check of a submitted selection / change set.
 *
 * Security model:
 *  - The source is resolved from the SAVED form definition (a task's stored
 *    form, or a reusable form's latest version) by field key. The browser
 *    never names a table, reference, column projection or base filter; a
 *    request for a field that isn't a Data table on that form is refused.
 *    Only the designer preview sends an (unsaved) config, and it needs
 *    forms.edit or workflows.edit — plus data.view for a data table.
 *  - Authorised like a lookup: task forms need tasks.complete and a task the
 *    caller can act on; reusable forms (/f/<id>, start form pages) need
 *    forms.submit.
 *  - Data tables: by default the reader also needs data.view and the query
 *    runs with the caller's own database client — the signed-in user's
 *    session, so row-level security applies to them; tenant API keys are
 *    filtered by tenant and their table allowlist. With the author's
 *    "open access" switch the form's own definition authorises the read
 *    (as a lookup does) for people without data.view; the projection and the
 *    base filter still bound what they see.
 *  - The author's base filter is applied first and the user's filters and
 *    search are ANDed onto it (buildTablePlan) — users can narrow, never
 *    widen. User filters / sorts are accepted only on columns the author
 *    marked filterable / sortable. Rows are projected to the selected
 *    columns before they leave the server (projectRow) — nothing else is
 *    returned, for API sources too.
 *  - API references run on the server (lib/reference-executor); credentials
 *    never reach the browser. Requests are capped (page size ≤ 100, fetched
 *    API rows ≤ 1000), rate limited per user and time-limited.
 */

import { columnKey } from '@/lib/data-table-cells'
import {
  DATA_TABLE_LIMITS, DATA_TABLE_ROW_ID, DataTableQueryError, applyLocally, buildTablePlan, dataTableKeyColumn, editableColumns, normalizeUserQuery,
  projectRow, referencedColumns, remoteCapabilities, resolveDataTableTemplate, templateText, validateChangeSet, validateSelection,
  type DataTableChangeSet, type DataTableColumnType, type DataTableFieldConfig, type DataTableRow, type DataTableScope,
} from '@/lib/forms/data-table'
import { pathValue } from '@/lib/forms/lookup'
import { contextReferences, hasFormContext, serverFormContext } from '@/lib/forms/form-params'
import { serverControlEntries } from '@/lib/forms/rule-variables'
import { collectionAt } from '@/lib/response-collections'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { getDb, hasPerm, isAnonymous, rateSubject, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata and table rows are free-form JSON */

export const DATA_TABLE_RATE = { max: 180, windowMs: 60_000 } as const
const TABLE_TIMEOUT_MS = 6000
const REFERENCE_TIMEOUT_MS = 10_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type DataTableTarget = { task_id: string } | { form_id: string } | { preview_field: unknown }

export interface DataTableQueryInput {
  field_key?: string
  /** search, filters, sort, page, page_size (bounded by the field's config). */
  query?: unknown
  /** The form's current values ({{form.<key>}} in the base filter / API inputs). */
  values?: Record<string, unknown>
  /** The form's parameters by name ({{param.<name>}}; a task form's come from the task, never from here). */
  params?: Record<string, unknown>
  /** The form's variables by name ({{var.<name>}}). */
  variables?: Record<string, unknown>
}

export interface DataTableQueryResult {
  rows: DataTableRow[]
  /** Rows matching (null: the API doesn't say). */
  total: number | null
  page: number
  page_size: number
  /** More rows after this page (when the total is unknown). */
  has_more?: boolean
  /** API sources: what the server applied to the fetched rows (the API didn't). */
  applied_locally?: string[]
  /** API sources: the fetched rows were capped. */
  truncated?: boolean
}

/** Test seams. */
export const dataTableDeps = {
  executeReference: async (opts: Parameters<typeof import('@/lib/reference-executor').executeReference>[0]) => (await import('@/lib/reference-executor')).executeReference(opts),
  now: () => new Date(),
}

/* ── Source resolution ───────────────────────────────────────────────── */

interface ResolvedField {
  field: TaskFieldDef
  config: DataTableFieldConfig
  /** Values stored on the task (read-only fields keep these). */
  stored: Record<string, unknown>
  fields: TaskFieldDef[]
  task: Record<string, unknown> | null
  preview: boolean
  /** The saved layout (parameter / variable declarations). */
  layout?: unknown
  /** A task form: the parameters the workflow passed when it created the task. */
  storedParams?: Record<string, unknown> | null
}

function dataTableField(fields: TaskFieldDef[], key: unknown, where: string): TaskFieldDef & { data_table: DataTableFieldConfig } {
  const field = fields.find((f) => f.key === key && f.type === 'data_table')
  if (!field?.data_table) throw ServiceError.notFound(`${where} has no Data table field "${String(key ?? '').slice(0, 64)}"`)
  return field as TaskFieldDef & { data_table: DataTableFieldConfig }
}

/** The field and its config, from the saved definition (or the designer's unsaved field for a preview). */
export async function resolveDataTableSource(ctx: ServiceContext, target: DataTableTarget, fieldKey: string | undefined): Promise<ResolvedField> {
  const db = await serviceRoleClient(ctx)
  if ('task_id' in target) {
    const { loadLookupTask } = await import('./form-lookup')
    const task = await loadLookupTask(ctx, db, target.task_id)
    const meta = (task.metadata ?? {}) as Record<string, any>
    const fields = normalizeTaskFields(meta.fields)
    const field = dataTableField(fields, fieldKey, "The task's form")
    return {
      field, config: field.data_table, stored: isPlainObject(meta.template_values) ? meta.template_values : {}, fields, task: { id: task.id, title: task.title, priority: task.priority, status: task.status }, preview: false,
      layout: meta.form_layout, storedParams: isPlainObject(meta.form_params) ? meta.form_params : {},
    }
  }
  if ('form_id' in target) {
    requirePerm(ctx, 'forms.submit')
    if (!UUID_RE.test(target.form_id)) throw ServiceError.notFound('Form not found')
    const { data: form } = await (db as any).from('forms').select('id, fields, layout').eq('id', target.form_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (!form) throw ServiceError.notFound('Form not found')
    const fields = normalizeTaskFields(form.fields)
    const field = dataTableField(fields, fieldKey, 'The form')
    // Anonymous visitors: only this link's form, only a field opened with "Allow anonymous read", pages capped.
    if (isAnonymous(ctx)) {
      if (ctx.anonymous.formId !== target.form_id) throw ServiceError.notFound('Form not found')
      if (field.data_table.anonymous_read !== true) throw ServiceError.forbidden('This table is not available on a public form')
      const { ANONYMOUS_LIMITS } = await import('@/lib/forms/anonymous')
      const config = { ...field.data_table, page_size: Math.min(field.data_table.page_size ?? DATA_TABLE_LIMITS.defaultPageSize, ANONYMOUS_LIMITS.maxPageSize) }
      return { field: { ...field, data_table: config }, config, stored: {}, fields, task: null, preview: false, layout: form.layout, storedParams: null }
    }
    return { field, config: field.data_table, stored: {}, fields, task: null, preview: false, layout: form.layout, storedParams: null }
  }
  if (!hasPerm(ctx, 'workflows.edit') && !hasPerm(ctx, 'forms.edit')) {
    throw ServiceError.forbidden("Forbidden: previewing a Data table needs the 'workflows.edit' or 'forms.edit' permission")
  }
  const [field] = normalizeTaskFields([target.preview_field])
  if (!field || field.type !== 'data_table' || !field.data_table) throw ServiceError.validation('Not a Data table field')
  return { field, config: field.data_table, stored: {}, fields: [field], task: null, preview: true }
}

/** Form values for {{form.<key>}}: the submitted values of editable fields over the stored ones. */
export function scopeValues(fields: TaskFieldDef[], stored: Record<string, unknown>, submitted: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...stored }
  if (!submitted) return out
  for (const field of fields) {
    if (field.read_only || field.type === 'heading' || field.type === 'divider' || field.type === 'button') continue
    if (Object.prototype.hasOwnProperty.call(submitted, field.key)) out[field.key] = submitted[field.key]
  }
  return out
}

/**
 * The parameters / variables a query resolves placeholders with (lib/forms/form-params.ts
 * serverFormContext): declared names only, typed, validated, bounded. A parameter the
 * config reads that is missing or refused stops the query (nothing is guessed).
 */
export function contextEntries(config: DataTableFieldConfig, layout: unknown, request: { values?: unknown; params?: unknown; variables?: unknown }, storedParams?: Record<string, unknown> | null, fields: TaskFieldDef[] = []): Record<string, unknown> {
  // {{control.*}}: rebuilt from the request (declared controls, declared columns, bounded).
  const controls = serverControlEntries(layout, fields, request.values)
  if (!hasFormContext(layout)) return controls
  const context = serverFormContext(layout, request, { storedParams: storedParams ?? null, now: dataTableDeps.now() })
  const texts = [...groupTemplates(config.base_filter), ...Object.values(config.input_mappings ?? {})]
  for (const ref of texts.flatMap(contextReferences)) {
    if (ref.kind !== 'param') continue
    if (context.missing.includes(ref.name)) throw ServiceError.validation(`The table needs the form parameter "${ref.name}"`)
    if (context.errors[ref.name]) throw ServiceError.validation(`The form parameter "${ref.name}": ${context.errors[ref.name]}`)
  }
  return { ...context.entries, ...controls }
}

function groupTemplates(group: DataTableFieldConfig['base_filter']): string[] {
  if (!group) return []
  return group.conditions.flatMap((c) => ('conditions' in c ? groupTemplates(c as DataTableFieldConfig['base_filter']) : [String((c as { value?: string }).value ?? '')]))
}

export async function userScope(db: AnySupabaseClient, actorId: string | null): Promise<DataTableScope['user']> {
  if (!actorId) return null
  const { data } = await (db as any).from('users').select('id, email, display_name').eq('id', actorId).maybeSingle()
  return { id: actorId, email: data?.email ?? null, name: data?.display_name ?? null }
}

export async function rateLimited(ctx: ServiceContext) {
  const { rateLimit } = await import('@/lib/rate-limit')
  const who = rateSubject(ctx)
  const hit = await rateLimit(`form-data-table:${ctx.tenantId}:${who}`, DATA_TABLE_RATE)
  if (!hit.ok) throw new ServiceError('rate_limited', 'Too many table requests — wait a moment and try again', { details: { retry_after_ms: hit.retryAfterMs } })
}

/**
 * The database client a data-table read uses. Default: data.view, the
 * caller's own client (RLS for a session), the credential's table allowlist.
 * Open access: the form authorises the read (service client, tenant-scoped).
 */
export async function readClient(ctx: ServiceContext, config: DataTableFieldConfig, preview: boolean): Promise<AnySupabaseClient> {
  if (config.open_access && !preview) return serviceRoleClient(ctx)
  // Anonymous: the author's "Allow anonymous read" authorises the read (tenant-scoped, the field's projection and base filter).
  if (isAnonymous(ctx)) {
    if (config.anonymous_read === true && !preview) return serviceRoleClient(ctx)
    throw ServiceError.forbidden('This table is not available on a public form')
  }
  requirePerm(ctx, 'data.view')
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (config.table_id && allow.length && !allow.includes(config.table_id)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
  return getDb(ctx)
}

/* ── Data tables ─────────────────────────────────────────────────────── */

const COLUMN_TYPE: Record<string, DataTableColumnType> = { number: 'number', boolean: 'boolean', date: 'date', datetime: 'datetime', select: 'choice' }

export async function tableColumnTypes(db: AnySupabaseClient, tenantId: string, tableId: string): Promise<Record<string, DataTableColumnType>> {
  if (!UUID_RE.test(tableId)) throw ServiceError.notFound("The table's data table no longer exists")
  const { data } = await (db as any).from('custom_tables').select('columns').eq('tenant_id', tenantId).eq('id', tableId).maybeSingle()
  if (!data) throw ServiceError.notFound("The Data table field's data table no longer exists (or you can't see it)")
  const out: Record<string, DataTableColumnType> = {}
  for (const c of Array.isArray(data.columns) ? data.columns : []) {
    const key = c?.key ? String(c.key) : c?.name ? columnKey({ name: String(c.name) }) : ''
    if (key) out[key] = COLUMN_TYPE[String(c?.type ?? '')] ?? 'text'
  }
  return out
}

function checkColumns(config: DataTableFieldConfig, types: Record<string, DataTableColumnType>) {
  for (const column of referencedColumns(config)) {
    if (!Object.prototype.hasOwnProperty.call(types, column)) throw ServiceError.validation(`The Data table field refers to a column "${column}" the table does not have`)
  }
}

export function friendlyDbError(error: any): ServiceError {
  if (/abort/i.test(String(error?.message ?? ''))) return new ServiceError('internal', 'The table took too long — try again', { status: 504 })
  console.error('[forms.dataTable] table query failed:', error?.message)
  return new ServiceError('internal', 'The table is not available right now', { status: 502 })
}

async function runTableQuery(db: AnySupabaseClient, tenantId: string, config: DataTableFieldConfig, rawQuery: unknown, scope: DataTableScope): Promise<DataTableQueryResult> {
  if (!config.table_id) throw ServiceError.validation('The Data table field has no data table')
  const types = await tableColumnTypes(db, tenantId, config.table_id)
  checkColumns(config, types)
  const query = normalizeUserQuery(config, rawQuery)
  const plan = buildTablePlan(config, query, scope, types)
  let q = (db as any).from('custom_table_rows').select('id, data', { count: 'exact' }).eq('tenant_id', tenantId).eq('table_id', config.table_id)
  if (plan.where) q = q.or(plan.where)
  for (const o of plan.order) q = q.order(o.column, { ascending: o.ascending, nullsFirst: false })
  q = q.order('created_at', { ascending: true }).order('id', { ascending: true }).range(plan.offset, plan.offset + plan.limit - 1)
  if (typeof q.abortSignal === 'function') q = q.abortSignal(AbortSignal.timeout(TABLE_TIMEOUT_MS))
  const { data, count, error } = await q
  if (error) {
    // An offset past the end is "no rows", not an error.
    if (error.code === 'PGRST103') return { rows: [], total: count ?? 0, page: query.page, page_size: query.page_size }
    throw friendlyDbError(error)
  }
  const rows: DataTableRow[] = []
  for (const r of (data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>) {
    const row = projectRow(config, { ...(isPlainObject(r.data) ? r.data : {}), [DATA_TABLE_ROW_ID]: r.id })
    if (row) rows.push(row)
  }
  return { rows, total: typeof count === 'number' ? count : null, page: query.page, page_size: query.page_size }
}

/* ── API references ──────────────────────────────────────────────────── */

export async function callReference(db: AnySupabaseClient, tenantId: string, config: DataTableFieldConfig, scope: DataTableScope, callerId: string | null): Promise<unknown> {
  if (!config.reference_id) throw ServiceError.validation('The Data table field has no API reference')
  const inputs: Record<string, string> = {}
  for (const [name, t] of Object.entries(config.input_mappings ?? {})) inputs[name] = templateText(resolveDataTableTemplate(t, scope))
  try {
    const { newTraceId } = await import('@/lib/trace')
    const result = await dataTableDeps.executeReference({
      supabase: db as any,
      referenceId: config.reference_id,
      inputValues: inputs,
      timeout: REFERENCE_TIMEOUT_MS,
      expectedTenantId: tenantId,
      caller: { traceId: newTraceId(), callerType: 'form_lookup', callerId },
      readOnly: true,
    })
    if ((result.status ?? 200) >= 400) throw new ServiceError('internal', 'The table\'s API is not available right now', { status: 502 })
    return result.data
  } catch (error: any) {
    if (error instanceof ServiceError) throw error
    const message = String(error?.message ?? '')
    if (/reference not found/i.test(message)) throw ServiceError.notFound("The Data table field's API reference no longer exists")
    if (/abort|timed? ?out/i.test(message)) throw new ServiceError('internal', 'The table\'s API took too long — try again', { status: 504 })
    console.warn('[forms.dataTable] reference call failed:', message.slice(0, 300))
    throw new ServiceError('internal', 'The table\'s API is not available right now', { status: 502 })
  }
}

/** The rows array of a response (`results_path` — any depth, `[0]` / `[]` — or the response itself); see lib/response-collections. */
export function responseRows(config: DataTableFieldConfig, data: unknown): unknown[] {
  return collectionAt(data, config.results_path)
}

async function runReferenceQuery(db: AnySupabaseClient, tenantId: string, config: DataTableFieldConfig, rawQuery: unknown, scope: DataTableScope, callerId: string | null): Promise<DataTableQueryResult> {
  const query = normalizeUserQuery(config, rawQuery)
  const remote = remoteCapabilities(config)
  const filters: Record<string, string> = {}
  for (const f of query.filters) if (remote.filters.includes(f.column) && f.value !== undefined) filters[f.column] = f.value
  const callScope: DataTableScope = {
    ...scope,
    state: { search: query.search, page: query.page, page_size: query.page_size, sort: query.sort[0]?.column ?? '', sort_dir: query.sort[0]?.direction ?? '', filters },
  }
  const data = await callReference(db, tenantId, config, callScope, callerId)
  const records = responseRows(config, data)
  const truncated = records.length > DATA_TABLE_LIMITS.referenceRows
  const projected: DataTableRow[] = []
  for (const record of records.slice(0, DATA_TABLE_LIMITS.referenceRows)) {
    const row = projectRow(config, record)
    if (row) projected.push(row)
  }
  const local = applyLocally(config, projected, query, scope, remote)
  let total = local.total
  let hasMore: boolean | undefined
  if (remote.page) {
    const t = config.total_path ? Number(pathValue(data, config.total_path)) : NaN
    // The API's total no longer holds when the server narrowed its page (base filter, unmapped filters / search).
    const narrowed = local.rows.length < records.length || local.local.includes('filters') || local.local.includes('search')
    total = Number.isFinite(t) && !narrowed ? t : null
    if (total === null) hasMore = Number.isFinite(t) ? query.page * query.page_size < t : records.length >= query.page_size
  }
  return {
    rows: local.rows, total, page: query.page, page_size: query.page_size,
    ...(hasMore !== undefined ? { has_more: hasMore } : {}),
    ...(local.local.length ? { applied_locally: local.local } : {}),
    ...(truncated ? { truncated } : {}),
  }
}

/* ── Querying ────────────────────────────────────────────────────────── */

/**
 * One page of a Data table field's rows, for a task's form, a reusable
 * form's page or the designer's preview. See the security model above.
 */
export async function queryDataTable(ctx: ServiceContext, target: DataTableTarget, input: DataTableQueryInput): Promise<DataTableQueryResult> {
  const resolved = await resolveDataTableSource(ctx, target, input.field_key)
  const { config } = resolved
  await rateLimited(ctx)
  // A preview has no saved form around the field: the designer's preview values are taken as they are.
  const submitted = isPlainObject(input.values) ? input.values : undefined
  const values = resolved.preview ? { ...(submitted ?? {}) } : scopeValues(resolved.fields, resolved.stored, submitted)
  // {{param.x}} / {{var.x}}: re-validated against the saved declarations (a task's parameters from the task).
  if (!resolved.preview) Object.assign(values, contextEntries(config, resolved.layout, { values: submitted, params: input.params, variables: input.variables }, resolved.storedParams, resolved.fields))
  const sys = await serviceRoleClient(ctx)
  const scope: DataTableScope = { values, user: await userScope(sys, ctx.actorId), now: dataTableDeps.now(), task: resolved.task }
  try {
    if (config.source === 'reference') {
      if (resolved.preview && !hasPerm(ctx, 'integrations.view')) throw ServiceError.forbidden("Forbidden: previewing an API source needs the 'integrations.view' permission")
      return await runReferenceQuery(sys, ctx.tenantId, config, input.query, scope, resolved.task ? String(resolved.task.id) : 'form')
    }
    const db = await readClient(ctx, config, resolved.preview)
    return await runTableQuery(db, ctx.tenantId, config, input.query, scope)
  } catch (error) {
    if (error instanceof DataTableQueryError) throw ServiceError.validation(error.message)
    throw error
  }
}

/* ── Submissions: verify selections, recompute change sets ──────────── */

/** Rows of a data table by key (the key column, or the row id), within the author's base filter, projected. */
async function rowsByKey(db: AnySupabaseClient, tenantId: string, config: DataTableFieldConfig, keys: string[], scope: DataTableScope): Promise<Map<string, DataTableRow>> {
  const out = new Map<string, DataTableRow>()
  if (!keys.length || !config.table_id) return out
  const types = await tableColumnTypes(db, tenantId, config.table_id)
  checkColumns(config, types)
  const keyColumn = dataTableKeyColumn(config)
  const plan = buildTablePlan(config, { search: '', filters: [], sort: [], page: 1, page_size: keys.length }, scope, types)
  let q = (db as any).from('custom_table_rows').select('id, data').eq('tenant_id', tenantId).eq('table_id', config.table_id)
  if (plan.where) q = q.or(plan.where)
  if (keyColumn === DATA_TABLE_ROW_ID) q = q.in('id', keys.filter((k) => UUID_RE.test(k)))
  else q = q.in(`data->>${keyColumn}`, keys)
  const { data, error } = await q.limit(Math.min(keys.length * 2, 1000))
  if (error) throw friendlyDbError(error)
  for (const r of (data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>) {
    const row = projectRow(config, { ...(isPlainObject(r.data) ? r.data : {}), [DATA_TABLE_ROW_ID]: r.id })
    if (row && keys.includes(row.key) && !out.has(row.key)) out.set(row.key, row)
  }
  return out
}

/**
 * Server-side check of Data table values before they are stored:
 *  - select: data-table rows are re-read by key (within the base filter and
 *    the reader's access) and the stored row is the server's copy — a row
 *    the reader can't see is an error; API rows are cleaned to the declared
 *    columns (the API is not re-called).
 *  - edit: the change set is validated against the declared columns; for a
 *    data table, `before` is re-read from the table (never the client's),
 *    `changed_fields` recomputed, and an updated / deleted row the reader
 *    can't see (outside the base filter or their access) is an error.
 * `ctx` is the submitter (the read rules of queryDataTable apply).
 */
export async function resolveDataTableValues(
  ctx: ServiceContext | null,
  tenantId: string,
  fields: TaskFieldDef[],
  values: Record<string, unknown>,
  options: { keys?: string[]; strict: boolean; actorId?: string | null } = { strict: true },
): Promise<{ errors: Record<string, string>; values: Record<string, unknown> }> {
  const errors: Record<string, string> = {}
  const out: Record<string, unknown> = {}
  const tables = fields.filter((f) => f.type === 'data_table' && f.data_table && f.data_table.mode !== 'display' && !f.read_only)
  for (const field of tables) {
    if (options.keys && !options.keys.includes(field.key)) continue
    const config = field.data_table!
    if (!Object.prototype.hasOwnProperty.call(values, field.key)) continue
    try {
      if (config.mode === 'select') {
        const { rows, errors: problems } = validateSelection(config, values[field.key])
        if (problems.length) { errors[field.key] = `${field.label}: ${problems[0]}`; continue }
        if (config.source !== 'table' || !rows.length) { out[field.key] = rows; continue }
        const keyColumn = dataTableKeyColumn(config)
        const keys = rows.map((r) => String(r[keyColumn]))
        const found = await rowsByKeyFor(ctx, tenantId, config, keys, values, options.actorId ?? ctx?.actorId ?? null)
        const missing = keys.filter((k) => !found.has(k))
        if (missing.length && options.strict) { errors[field.key] = `${field.label}: a selected row is no longer available`; continue }
        out[field.key] = keys.filter((k) => found.has(k)).map((k) => found.get(k)!.values)
        continue
      }
      const { changes, errors: problems } = validateChangeSet(config, values[field.key])
      if (problems.length) { errors[field.key] = `${field.label}: ${problems.slice(0, 3).join('; ')}`; continue }
      if (config.source === 'table') {
        const keys = [...changes.updated.map((u) => u.key), ...changes.deleted.map((d) => d.key)]
        const found = await rowsByKeyFor(ctx, tenantId, config, keys, values, options.actorId ?? ctx?.actorId ?? null)
        const missing = keys.filter((k) => !found.has(k))
        if (missing.length) { errors[field.key] = `${field.label}: row "${missing[0].slice(0, 60)}" is no longer available`; continue }
        out[field.key] = recomputeChanges(config, changes, found)
      } else {
        out[field.key] = changes
      }
    } catch (error) {
      errors[field.key] = `${field.label}: ${error instanceof ServiceError ? error.message : 'the table could not be checked'}`
    }
  }
  return { errors, values: out }
}

/**
 * Labels that are stored and read `control.<table>.rows` (lib/forms/label-field.ts):
 * the server's own rows for each such table — the first page as the form
 * loads it (the author's base filter, projection and default sort, no
 * search / user filters, the configured page size), read with the
 * submitter's access like a query. The label's value is then recomputed
 * from these rows with the verified change set applied; the browser's
 * reported rows are never used. A table that can't be read is an error.
 */
export async function serverLabelRows(
  ctx: ServiceContext | null,
  tenantId: string,
  fields: TaskFieldDef[],
  tableKeys: string[],
  values: Record<string, unknown>,
  actorId: string | null,
): Promise<{ rows: Record<string, Array<Record<string, unknown>>>; errors: Record<string, string> }> {
  const rows: Record<string, Array<Record<string, unknown>>> = {}
  const errors: Record<string, string> = {}
  const { createServiceClient } = await import('@/lib/cron-auth')
  const sys = createServiceClient() as AnySupabaseClient
  const scope: DataTableScope = { values, user: await userScope(sys, actorId), now: dataTableDeps.now() }
  for (const key of tableKeys) {
    const field = fields.find((f) => f.key === key && f.type === 'data_table' && f.data_table)
    if (!field?.data_table) continue
    const config = field.data_table
    try {
      const result = config.source === 'reference'
        ? await runReferenceQuery(sys, tenantId, config, { page: 1 }, scope, 'form')
        : await runTableQuery(!ctx || config.open_access ? sys : await readClient(ctx, config, false), tenantId, config, { page: 1 }, scope)
      rows[key] = result.rows.map((r) => r.values)
    } catch (error) {
      errors[key] = `${field.label}: its rows could not be read to work out a total (${error instanceof ServiceError ? error.message : 'the table is not available'})`
    }
  }
  return { rows, errors }
}

async function rowsByKeyFor(ctx: ServiceContext | null, tenantId: string, config: DataTableFieldConfig, keys: string[], values: Record<string, unknown>, actorId: string | null) {
  // The reader's access: open access or a context-less (system) check reads tenant-scoped; otherwise the submitter's own client.
  let db: AnySupabaseClient
  if (!ctx || config.open_access) {
    const { createServiceClient } = await import('@/lib/cron-auth')
    db = createServiceClient() as AnySupabaseClient
  } else {
    db = await readClient(ctx, config, false)
  }
  const { createServiceClient } = await import('@/lib/cron-auth')
  const user = await userScope(createServiceClient() as AnySupabaseClient, actorId)
  return rowsByKey(db, tenantId, config, keys, { values, user, now: dataTableDeps.now() })
}

/** `before` from the source, `after` = before + the edited cells, `changed_fields` recomputed; rows with no real change dropped. */
export function recomputeChanges(config: DataTableFieldConfig, changes: DataTableChangeSet, found: Map<string, DataTableRow>): DataTableChangeSet {
  const editable = new Set(editableColumns(config).map((c) => c.key))
  const updated: DataTableChangeSet['updated'] = []
  for (const u of changes.updated) {
    const before = found.get(u.key)!.values
    const after: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(u.after)) if (editable.has(k)) after[k] = v
    const changed = Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null) && !(before[k] == null && after[k] === ''))
    if (changed.length) updated.push({ key: u.key, before, after: Object.fromEntries(changed.map((k) => [k, after[k]])), changed_fields: changed })
  }
  return {
    added: changes.added,
    updated,
    deleted: changes.deleted.map((d) => ({ key: d.key, before: found.get(d.key)!.values })),
  }
}
