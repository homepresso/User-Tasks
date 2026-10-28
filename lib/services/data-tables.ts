/**
 * Custom data tables (schemas) and their rows. Shared by /api/v1/data-tables
 * (+ /rows), the MCP data_tables_* / data_rows_* tools and, where cheap, the
 * data-store server actions.
 *
 * Permissions: data.view (reads), data.create, data.edit_schema, data.delete
 * (tables), data.manage_rows (row writes). Keys restricted to specific tables
 * (resource scopes) only reach those tables and can't create new ones.
 *
 * Rows behave exactly like the data grid writes them (app/actions/data-store):
 *  - cells are validated against the declared columns (unknown keys → 400) and
 *    stored under canonical column keys (lib/data-table-cells);
 *  - inserts auto-number the system `id` column and stamp `date_created`;
 *  - created / updated rows fire data_table_event workflows
 *    (lib/data-table-workflow-triggers); deletes go through the deletion
 *    queue, which removes stored files and fires the `deleted` event.
 */

import { columnKey, normalizeRowData, slugifyColumnName, type CellColumn } from '@/lib/data-table-cells'
import { enqueueDataTableEvents, type DataTableEvent } from '@/lib/data-table-workflow-triggers'
import { initiatorFromContext } from '@/lib/workflow-initiator'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, queueDeletion, queueDeletions, syncChange, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- jsonb columns and row data are free-form */

export const DATA_ROW_LIMITS = { bulk: 500, scan: 500 } as const
const SYSTEM_KEYS = new Set(['id', 'date_created'])
const TABLE_COLUMNS = 'id, name, slug, description, columns, retention_policy_id, created_at, updated_at'
const ROW_COLUMNS = 'id, table_id, data, created_at, updated_at, created_by, updated_by'

export interface DataColumnInput {
  id?: string
  key?: string
  name: string
  type: string
  required?: boolean
  options?: string[]
  lookup?: Record<string, unknown>
  [extra: string]: unknown
}

export type RowFilterOperator =
  | 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'not_empty'

export interface RowFilter { field: string; operator: RowFilterOperator; value?: unknown }

// ─── Access ─────────────────────────────────────────────────────────────────

function tableScope(ctx: ServiceContext): string[] {
  return ctx.resourceScopes?.table_ids ?? []
}

function requireTableScope(ctx: ServiceContext, tableId: string) {
  const allow = tableScope(ctx)
  if (allow.length && !allow.includes(tableId)) {
    throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
  }
}

async function loadTable(ctx: ServiceContext, tableId: string, columns = TABLE_COLUMNS) {
  requireTableScope(ctx, tableId)
  const { data, error } = await (ctx.supabase as any).from('custom_tables')
    .select(columns).eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Table not found')
  return data as any
}

const tableSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'table'

function conflictOr(error: any, fallback: string): Error {
  if (error?.code === '23505') return ServiceError.conflict('A table with this name already exists')
  return dbError(error, fallback)
}

// ─── Tables ─────────────────────────────────────────────────────────────────

export async function listDataTables(ctx: ServiceContext, filters: { search?: string } = {}, page: Page) {
  requirePerm(ctx, 'data.view')
  let query = (ctx.supabase as any).from('custom_tables')
    .select('id, name, slug, description, columns, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('name')
  const allow = tableScope(ctx)
  if (allow.length) query = query.in('id', allow)
  if (filters.search?.trim()) query = query.ilike('name', `%${ilikeTerm(filters.search)}%`)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  return { data_tables: (data ?? []) as any[], total: (count ?? (data ?? []).length) as number }
}

export async function getDataTable(ctx: ServiceContext, tableId: string) {
  requirePerm(ctx, 'data.view')
  return loadTable(ctx, tableId, '*')
}

/**
 * Custom columns with stable ids and keys: an explicit id/key is kept, a
 * column whose key (or name) matches an existing column keeps that column's
 * id and key, otherwise both are derived (key = slug of the name).
 */
function normalizeColumns(input: DataColumnInput[], existing: any[] = []): any[] {
  const byKey = new Map(existing.map((col) => [String(col?.key ?? ''), col]))
  const byName = new Map(existing.map((col) => [String(col?.name ?? ''), col]))
  const seen = new Set<string>()
  return input.map((column) => {
    const name = String(column.name ?? '').trim()
    if (!name) throw ServiceError.validation('Every column needs a name')
    const previous = (column.key ? byKey.get(column.key) : undefined) ?? (column.id ? existing.find((col) => col?.id === column.id) : undefined) ?? byName.get(name)
    const key = column.key?.trim() || previous?.key || slugifyColumnName(name)
    if (!key) throw ServiceError.validation(`Column "${name}" needs a key`)
    if (SYSTEM_KEYS.has(key)) throw ServiceError.validation(`"${key}" is a system column`)
    if (seen.has(key)) throw ServiceError.validation(`Duplicate column key "${key}"`)
    seen.add(key)
    const { required, options, lookup } = column
    const rest = Object.fromEntries(Object.entries(column).filter(([field]) => !['id', 'key', 'name', 'type', 'required', 'options', 'lookup'].includes(field)))
    return {
      ...rest,
      id: column.id ?? previous?.id ?? crypto.randomUUID(),
      key,
      name,
      type: column.type,
      required: required ?? false,
      ...(options ? { options } : {}),
      ...(lookup ? { lookup } : {}),
    }
  })
}

export interface DataTableCreateInput { name: string; description?: string | null; columns?: DataColumnInput[] }

export async function createDataTable(ctx: ServiceContext, input: DataTableCreateInput) {
  requirePerm(ctx, 'data.create')
  if (tableScope(ctx).length) throw ServiceError.forbidden('Forbidden: creating tables is not allowed for table-scoped credentials')
  const name = String(input.name ?? '').trim()
  if (!name) throw ServiceError.validation('Table name is required')
  const columns = [
    { id: crypto.randomUUID(), key: 'id', name: 'ID', type: 'number' },
    { id: crypto.randomUUID(), key: 'date_created', name: 'Date Created', type: 'date' },
    ...normalizeColumns(input.columns ?? []),
  ]
  const { data, error } = await (ctx.supabase as any).from('custom_tables').insert({
    tenant_id: ctx.tenantId,
    name,
    slug: tableSlug(name),
    description: input.description?.trim() || null,
    columns,
    created_by: ctx.actorId,
  }).select(TABLE_COLUMNS).single()
  if (error || !data) throw conflictOr(error, 'Failed to create table')
  await audit(ctx, { objectType: 'data_table', objectId: data.id, action: 'create', summary: `Created data table "${name}"`, metadata: { columns: columns.length } })
  await syncChange(ctx, 'data_table', data)
  return data
}

export interface DataTableUpdateInput { name?: string; description?: string | null; columns?: DataColumnInput[] }

/** Rename / describe / replace the custom columns (the system ID and Date Created columns are kept). */
export async function updateDataTable(ctx: ServiceContext, tableId: string, input: DataTableUpdateInput) {
  requirePerm(ctx, 'data.edit_schema')
  const existing = await loadTable(ctx, tableId)
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw ServiceError.validation('Table name cannot be empty')
    updates.name = name
    updates.slug = tableSlug(name)
  }
  if (input.description !== undefined) updates.description = input.description?.trim() || null
  if (input.columns !== undefined) {
    const current = Array.isArray(existing.columns) ? existing.columns : []
    const system = current.filter((col: any) => SYSTEM_KEYS.has(String(col?.key ?? '')))
    // System columns are always kept as stored; ones sent back from a GET are ignored.
    const custom = input.columns.filter((col) => !SYSTEM_KEYS.has(String(col?.key ?? '')))
    updates.columns = [...system, ...normalizeColumns(custom, current)]
  }
  if (Object.keys(updates).length === 0) throw ServiceError.validation('No fields to update')
  updates.updated_at = new Date().toISOString()

  const { data, error } = await (ctx.supabase as any).from('custom_tables')
    .update(updates).eq('id', tableId).eq('tenant_id', ctx.tenantId).select(TABLE_COLUMNS).single()
  if (error || !data) throw conflictOr(error, 'Failed to update table')
  await audit(ctx, {
    objectType: 'data_table', objectId: tableId, action: 'update',
    summary: `Updated data table "${data.name}"`,
    metadata: { fields: Object.keys(updates).filter((key) => key !== 'updated_at' && key !== 'slug') },
  })
  await syncChange(ctx, 'data_table', data)
  return data
}

/** Queue the table (and every row and stored file) for deletion. */
export async function deleteDataTable(ctx: ServiceContext, tableId: string) {
  requirePerm(ctx, 'data.delete')
  const table = await loadTable(ctx, tableId, 'id, name')
  await queueDeletion(ctx, 'data_table', tableId, { name: table.name ?? null })
  await audit(ctx, { objectType: 'data_table', objectId: tableId, action: 'delete', summary: `Queued deletion for data table "${table.name}"` })
  await syncChange(ctx, 'data_table', table, 'delete')
  return { deleted: true as const, id: tableId, queued: true }
}

// ─── Row reads ──────────────────────────────────────────────────────────────

function fieldValue(row: any, field: string) {
  if (field === 'id' || field === 'row_id') return row.id
  if (field === 'created_at' || field === '_created_at') return row.created_at
  if (field === 'updated_at' || field === '_updated_at') return row.updated_at
  if (field === 'created_by') return row.created_by
  const data = row.data && typeof row.data === 'object' ? row.data as Record<string, any> : {}
  if (field in data) return data[field]
  const slug = slugifyColumnName(field)
  for (const [key, value] of Object.entries(data)) if (slugifyColumnName(key) === slug) return value
  return undefined
}

function searchable(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(searchable).join(' ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function matchesFilter(row: any, filter: RowFilter) {
  const raw = fieldValue(row, filter.field)
  const left = searchable(raw).toLowerCase()
  const right = searchable(filter.value).toLowerCase()
  switch (filter.operator) {
    case 'equals': return left === right
    case 'not_equals': return left !== right
    case 'contains': return left.includes(right)
    case 'starts_with': return left.startsWith(right)
    case 'ends_with': return left.endsWith(right)
    case 'gt': return Number(raw) > Number(filter.value)
    case 'gte': return Number(raw) >= Number(filter.value)
    case 'lt': return Number(raw) < Number(filter.value)
    case 'lte': return Number(raw) <= Number(filter.value)
    case 'is_empty': return left.trim().length === 0
    case 'not_empty': return left.trim().length > 0
    default: return true
  }
}

function compareRows(a: any, b: any, field: string, direction: 'asc' | 'desc') {
  const left = fieldValue(a, field)
  const right = fieldValue(b, field)
  const l = Number(left)
  const r = Number(right)
  const result = !Number.isNaN(l) && !Number.isNaN(r) && left !== '' && right !== '' && left != null && right != null
    ? l - r
    : searchable(left).localeCompare(searchable(right), undefined, { numeric: true, sensitivity: 'base' })
  return direction === 'desc' ? -result : result
}

export interface RowQuery {
  search?: string
  filters?: RowFilter[]
  /** Row field, column key or system field (id, created_at, updated_at). Default created_at. */
  sort_field?: string
  sort_direction?: 'asc' | 'desc'
}

/** Parse `order=field`, `order=-field` or `order=field.desc` / `field:asc`. */
export function parseRowOrder(order: string | undefined): Pick<RowQuery, 'sort_field' | 'sort_direction'> {
  const value = order?.trim()
  if (!value) return {}
  if (value.startsWith('-')) return { sort_field: value.slice(1), sort_direction: 'desc' }
  const match = value.match(/^(.+?)[.:](asc|desc)$/i)
  if (match) return { sort_field: match[1], sort_direction: match[2].toLowerCase() as 'asc' | 'desc' }
  return { sort_field: value, sort_direction: 'asc' }
}

/**
 * Rows of a table. Plain pages (no search/filters, system sort) are read
 * straight from the database with an exact total; search, filters and
 * sorting by a cell scan the newest DATA_ROW_LIMITS.scan rows in memory and
 * report `truncated` when the table holds more than that.
 */
export async function queryRows(ctx: ServiceContext, tableId: string, query: RowQuery, page: { limit: number; offset: number }) {
  requirePerm(ctx, 'data.view')
  await loadTable(ctx, tableId, 'id')
  const limit = Math.max(1, page.limit)
  const offset = Math.max(0, page.offset)
  const direction = query.sort_direction ?? 'desc'
  const systemSort = !query.sort_field || ['created_at', 'updated_at', 'id', 'row_id'].includes(query.sort_field)
  const local = Boolean(query.search) || Boolean(query.filters?.length) || !systemSort

  if (!local) {
    const { data, count, error } = await (ctx.supabase as any).from('custom_table_rows')
      .select(ROW_COLUMNS, { count: 'exact' })
      .eq('table_id', tableId)
      .eq('tenant_id', ctx.tenantId)
      .order(query.sort_field === 'updated_at' ? 'updated_at' : 'created_at', { ascending: direction === 'asc' })
      .range(offset, offset + limit - 1)
    if (error) throw dbError(error)
    return { rows: (data ?? []) as any[], total: (count ?? (data ?? []).length) as number, truncated: false, limit, offset }
  }

  const cap = Math.min(Math.max(limit + offset, 200), DATA_ROW_LIMITS.scan)
  const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
    .select(ROW_COLUMNS)
    .eq('table_id', tableId)
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .limit(cap)
  if (error) throw dbError(error)
  let rows = (data ?? []) as any[]
  const truncated = rows.length >= cap
  if (query.search) {
    const q = query.search.toLowerCase()
    rows = rows.filter((row) => String(row.id).toLowerCase().includes(q)
      || (row.created_by && String(row.created_by).toLowerCase().includes(q))
      || searchable(row.data).toLowerCase().includes(q))
  }
  if (query.filters?.length) rows = rows.filter((row) => query.filters!.every((filter) => matchesFilter(row, filter)))
  rows = [...rows].sort((a, b) => compareRows(a, b, query.sort_field ?? 'created_at', direction))
  return { rows: rows.slice(offset, offset + limit), total: rows.length, truncated, limit, offset }
}

export async function getRow(ctx: ServiceContext, tableId: string, rowId: string) {
  requirePerm(ctx, 'data.view')
  await loadTable(ctx, tableId, 'id')
  return loadRow(ctx, tableId, rowId)
}

async function loadRow(ctx: ServiceContext, tableId: string, rowId: string) {
  const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
    .select(ROW_COLUMNS).eq('id', rowId).eq('table_id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Row not found in this table')
  return data as any
}

// ─── Row writes ─────────────────────────────────────────────────────────────

/** Reject cells that don't belong to a declared column, then key them canonically. */
function prepareCells(columns: any[], data: Record<string, unknown>): Record<string, any> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw ServiceError.validation('Row data must be an object')
  const cellColumns: CellColumn[] = columns.filter((col) => col && (col.key || col.name)).map((col) => ({ key: col.key, name: String(col.name ?? col.key) }))
  const valid = new Set<string>()
  for (const col of cellColumns) {
    const key = columnKey(col)
    valid.add(key)
    valid.add(slugifyColumnName(key))
    valid.add(slugifyColumnName(col.name))
  }
  if (valid.size > 0) {
    const unknown = Object.keys(data).filter((key) => !valid.has(key) && !valid.has(slugifyColumnName(key)))
    if (unknown.length) {
      throw ServiceError.validation(`Unknown column(s) for this table: ${unknown.join(', ')}. Use the table schema to see valid column keys.`, { unknown })
    }
  }
  return normalizeRowData(data as Record<string, any>, cellColumns)
}

async function fireTriggers(ctx: ServiceContext, tableId: string, events: DataTableEvent[]) {
  if (events.length) await enqueueDataTableEvents({ supabase: ctx.supabase as any, tenantId: ctx.tenantId, tableId, events, initiator: initiatorFromContext(ctx) })
}

export interface RowUpsertInput {
  /** Existing row to replace; omit to insert. */
  row_id?: string
  data: Record<string, unknown>
}

export interface RowWriteResult { row_id: string; action: 'created' | 'updated'; row: any }

/**
 * Insert rows, or replace the data of existing ones (`row_id`), up to
 * DATA_ROW_LIMITS.bulk per call. All rows are validated before anything is
 * written. Replacing keeps the system ID / Date Created cells when omitted.
 */
export async function upsertRows(ctx: ServiceContext, tableId: string, rows: RowUpsertInput[]): Promise<RowWriteResult[]> {
  requirePerm(ctx, 'data.manage_rows')
  if (!rows.length) throw ServiceError.validation('No rows given')
  if (rows.length > DATA_ROW_LIMITS.bulk) throw ServiceError.validation(`At most ${DATA_ROW_LIMITS.bulk} rows per request`)
  const table = await loadTable(ctx, tableId, 'id, columns')
  const columns = Array.isArray(table.columns) ? table.columns : []
  const prepared = rows.map((row, index) => {
    try {
      return { row_id: row.row_id, data: prepareCells(columns, row.data) }
    } catch (error) {
      if (rows.length > 1 && error instanceof ServiceError) throw ServiceError.validation(`rows[${index}]: ${error.message}`, error.details)
      throw error
    }
  })

  // Existing rows must belong to THIS table (not just the tenant).
  const updateIds = [...new Set(prepared.map((row) => row.row_id).filter(Boolean) as string[])]
  const existing = new Map<string, any>()
  if (updateIds.length) {
    const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
      .select('id, data').eq('table_id', tableId).eq('tenant_id', ctx.tenantId).in('id', updateIds)
    if (error) throw dbError(error)
    for (const row of data ?? []) existing.set(String(row.id), row)
    const missing = updateIds.filter((id) => !existing.has(id))
    if (missing.length) throw ServiceError.notFound(`Row not found in this table: ${missing.join(', ')}`)
  }

  // System cells, as the data grid fills them in.
  const idColumn = columns.some((col: any) => col?.key === 'id' && col?.type === 'number')
  const dateColumn = columns.some((col: any) => col?.key === 'date_created')
  let nextNumber: number | null = null
  if (idColumn && prepared.some((row) => !row.row_id && (row.data.id === undefined || row.data.id === null || row.data.id === ''))) {
    const { data: latest } = await (ctx.supabase as any).from('custom_table_rows')
      .select('data').eq('table_id', tableId).eq('tenant_id', ctx.tenantId).order('created_at', { ascending: false }).limit(1)
    nextNumber = (Array.isArray(latest) && latest.length ? Number(latest[0]?.data?.id) || 0 : 0) + 1
  }
  const today = new Date().toISOString().split('T')[0]

  const results: RowWriteResult[] = []
  // data_table_event workflows are queued once for the whole call — also for
  // the rows written before a failure.
  const events: DataTableEvent[] = []
  try {
    for (const row of prepared) {
      if (row.row_id) {
        const before = existing.get(row.row_id)?.data ?? {}
        const data: Record<string, any> = { ...row.data }
        for (const key of SYSTEM_KEYS) if (data[key] === undefined && before[key] !== undefined) data[key] = before[key]
        const { data: updated, error } = await (ctx.supabase as any).from('custom_table_rows')
          .update({ data, updated_by: ctx.actorId, updated_at: new Date().toISOString() })
          .eq('id', row.row_id).eq('table_id', tableId).eq('tenant_id', ctx.tenantId)
          .select(ROW_COLUMNS).single()
        if (error || !updated) throw dbError(error, 'Failed to update row')
        events.push({ rowId: row.row_id, rowData: data, eventType: 'updated' })
        results.push({ row_id: row.row_id, action: 'updated', row: updated })
        continue
      }
      const data: Record<string, any> = { ...row.data }
      if (nextNumber !== null && (data.id === undefined || data.id === null || data.id === '')) data.id = nextNumber++
      if (dateColumn && !data.date_created) data.date_created = today
      const { data: inserted, error } = await (ctx.supabase as any).from('custom_table_rows').insert({
        table_id: tableId,
        tenant_id: ctx.tenantId,
        data,
        created_by: ctx.actorId,
        updated_by: ctx.actorId,
      }).select(ROW_COLUMNS).single()
      if (error || !inserted) throw dbError(error, 'Failed to insert row')
      events.push({ rowId: inserted.id, rowData: data, eventType: 'created' })
      results.push({ row_id: inserted.id, action: 'created', row: inserted })
    }
  } finally {
    await fireTriggers(ctx, tableId, events)
  }
  return results
}

/** Merge cells into one row (other cells are kept). */
export async function updateRow(ctx: ServiceContext, tableId: string, rowId: string, cells: Record<string, unknown>) {
  requirePerm(ctx, 'data.manage_rows')
  const table = await loadTable(ctx, tableId, 'id, columns')
  const prepared = prepareCells(Array.isArray(table.columns) ? table.columns : [], cells)
  const existing = await loadRow(ctx, tableId, rowId)
  const columns: CellColumn[] = (Array.isArray(table.columns) ? table.columns : []).filter((col: any) => col && (col.key || col.name)).map((col: any) => ({ key: col.key, name: String(col.name ?? col.key) }))
  // Legacy name-keyed cells converge onto canonical keys as the grid does.
  const data = { ...normalizeRowData(existing.data ?? {}, columns), ...prepared }
  const { data: updated, error } = await (ctx.supabase as any).from('custom_table_rows')
    .update({ data, updated_by: ctx.actorId, updated_at: new Date().toISOString() })
    .eq('id', rowId).eq('table_id', tableId).eq('tenant_id', ctx.tenantId)
    .select(ROW_COLUMNS).single()
  if (error || !updated) throw dbError(error, 'Failed to update row')
  await fireTriggers(ctx, tableId, [{ rowId, rowData: data, eventType: 'updated' }])
  return updated
}

/**
 * Queue rows of a table for deletion (stored files removed, `deleted`
 * workflows fired by the queue). Ids of other tables/tenants are ignored.
 */
export async function deleteRows(ctx: ServiceContext, tableId: string, rowIds: string[]) {
  requirePerm(ctx, 'data.manage_rows')
  await loadTable(ctx, tableId, 'id')
  const unique = [...new Set(rowIds.map((id) => String(id).trim()).filter(Boolean))]
  if (unique.length > DATA_ROW_LIMITS.bulk) throw ServiceError.validation(`At most ${DATA_ROW_LIMITS.bulk} rows per request`)
  if (!unique.length) return { deleted: 0, ids: [] as string[] }
  const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
    .select('id, data').eq('table_id', tableId).eq('tenant_id', ctx.tenantId).in('id', unique)
  if (error) throw dbError(error)
  const rows = (data ?? []) as Array<{ id: string; data: Record<string, unknown> | null }>
  // One queue insert and one processor kick for the batch (was one each per row).
  await queueDeletions(ctx, 'data_row', rows.map((row) => ({ id: String(row.id), payload: { table_id: tableId, row_data: row.data ?? {} } })))
  const ids = rows.map((row) => String(row.id))
  return { deleted: ids.length, ids }
}

export async function deleteRow(ctx: ServiceContext, tableId: string, rowId: string) {
  const result = await deleteRows(ctx, tableId, [rowId])
  if (!result.deleted) throw ServiceError.notFound('Row not found in this table')
  return { deleted: true as const, id: rowId, queued: true }
}

/** Delete a row by id alone (MCP data_rows_delete): resolves its table first. */
export async function deleteRowById(ctx: ServiceContext, rowId: string) {
  requirePerm(ctx, 'data.manage_rows')
  const { data, error } = await (ctx.supabase as any).from('custom_table_rows')
    .select('table_id').eq('id', rowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data?.table_id) throw ServiceError.notFound('Row not found')
  return deleteRow(ctx, String(data.table_id), rowId)
}
