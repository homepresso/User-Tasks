/**
 * Grouping and child records of data tables — the database half (the pure
 * logic is lib/grid/grouping.ts). Shared by the Data grid's reads
 * (lib/services/ui-reads/data.ts: the session client, RLS applies),
 * /api/v1/data-tables/{id}/rows/groups and …/rows/{rowId}/children, and the
 * MCP data_rows_groups / data_rows_children tools (the API / MCP client is
 * the service role, so every query is ALSO limited to the caller's tenant
 * and the key's table scope).
 *
 *  - Groups come from data_table_row_groups (migration
 *    20270119090000_data_table_grouping) over every row that passes the
 *    search and filters. Until the migration is applied they are computed
 *    in memory from the newest GROUP_SCAN rows (`exact: false`,
 *    `truncated` when the table holds more).
 *  - A group's rows (and the top level of a same-table hierarchy) come from
 *    data_table_rows_page, with the same fallback.
 *  - Child rows are read with an exact `data->>lookup = value` filter
 *    (no migration needed); child counts use data_table_row_groups with an
 *    `in` filter, else a capped read of the lookup cells.
 *  - Child relations (custom_tables.child_relations) are saved with the
 *    table's schema (data.edit_schema) and checked against the child tables.
 */

import {
  GROUPING_LIMITS, buildGroupTree, childRelationProblems, filterRoots, groupRowsInMemory, splitRootFilter, isSafeColumnKey, normalizeChildRelations, parentLinkValue,
  relationLookupColumn, rowMatchesFilters, rowMatchesSearch, sortRowsLikeDatabase,
  type ChildRelation, type GroupFlat, type GroupNode, type GroupRowFilter,
} from '@/lib/grid/grouping'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
import { GRID_LIMITS, gridTimeoutError, isGridTimeout, withGridGuard } from './data-table-guard'

/* eslint-disable @typescript-eslint/no-explicit-any -- jsonb rows */

/** Rows the in-memory fallback scans (newest first). */
export const GROUP_SCAN = 2000
const ROW_COLUMNS = 'id, table_id, tenant_id, data, created_at, updated_at, created_by, updated_by, retention_policy_id, retention_applied_at'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const GROUPING_MIGRATION = '20270119090000_data_table_grouping'

/** The RPC (or column) is not there yet: the migration is not applied. */
export function isMissingObject(error: any): boolean {
  if (!error) return false
  const code = String(error.code ?? '')
  if (code === 'PGRST202' || code === '42883' || code === '42703' || code === 'PGRST204') return true
  return /could not find the function|function .* does not exist|schema cache/i.test(String(error.message ?? ''))
}

const MISSING_RPC = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }

const GRID_RPCS = new Set(['data_table_rows_page', 'data_table_row_groups'])

/**
 * Call an RPC; a client without RPCs (or a database without the function) answers PGRST202.
 * The expensive grid RPCs run under the concurrency / time caps (lib/services/data-table-guard):
 * `workspace` keys the per-workspace cap (else the call's tenant, else the table).
 */
async function callRpc(db: any, fn: string, args: Record<string, unknown>, workspace?: string | null): Promise<{ data: any; error: any }> {
  if (typeof db?.rpc !== 'function') return MISSING_RPC
  if (!GRID_RPCS.has(fn)) return db.rpc(fn, args)
  return withGridGuard(workspace || (args.p_tenant_id as string | null) || `table:${String(args.p_table_id)}`, async () => {
    let res = await db.rpc(fn, { ...args, p_timeout_ms: GRID_LIMITS.timeoutMs })
    // Before migration 20270131140000 the function has no p_timeout_ms.
    if (res.error && isMissingObject(res.error)) res = await db.rpc(fn, args)
    if (res.error && isGridTimeout(res.error)) throw gridTimeoutError()
    return res
  })
}

function scoped(query: any, tenantId: string | null | undefined) {
  return tenantId ? query.eq('tenant_id', tenantId) : query
}

/** The newest rows of a table for the in-memory fallback. */
async function scanRows(db: any, tableId: string, tenantId: string | null | undefined, extra?: (q: any) => any) {
  let query = scoped(db.from('custom_table_rows').select(ROW_COLUMNS).eq('table_id', tableId), tenantId)
  if (extra) query = extra(query)
  const { data, error } = await query.order('updated_at', { ascending: false, nullsFirst: false }).limit(GROUP_SCAN)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  return { rows, truncated: rows.length >= GROUP_SCAN }
}

/* ── Groups ──────────────────────────────────────────────────────────── */

export interface RowGroupsQuery {
  group_by: string[]
  search?: string
  filters?: GroupRowFilter[]
  /** Number columns to sum per group. */
  sum?: string[]
  /** Per level: the order of the groups (default ascending; blank first). */
  direction?: Array<'asc' | 'desc'>
  /** The caller's workspace: keys the per-workspace cap on expensive grid queries (lib/services/data-table-guard). */
  workspace?: string | null
}

export interface RowGroupsResult {
  group_by: string[]
  groups: GroupNode[]
  /** Rows in all groups. */
  total: number
  /** Counted over every row (false: the newest GROUP_SCAN rows — the migration is not applied). */
  exact: boolean
  /** The table holds more rows than were scanned (exact: false only). */
  truncated: boolean
  /** More group combinations than GROUPING_LIMITS.groups: the rest are left out. */
  groups_truncated: boolean
}

/** Group a table's rows (the whole filtered result). `tenantId`: limit to that workspace (service-role clients). */
export async function computeRowGroups(db: any, tableId: string, query: RowGroupsQuery, tenantId?: string | null): Promise<RowGroupsResult> {
  const groupBy = query.group_by.filter(isSafeColumnKey).slice(0, GROUPING_LIMITS.levels)
  if (!groupBy.length) throw ServiceError.validation('group_by: name one or two columns')
  const sum = (query.sum ?? []).filter(isSafeColumnKey).slice(0, GROUPING_LIMITS.sums)
  let flat: GroupFlat[]
  let exact = true
  let truncated = false
  const { filters, root } = splitRootFilter(query.filters)
  const { data, error } = await callRpc(db, 'data_table_row_groups', {
    p_table_id: tableId, p_group_by: groupBy, p_search: query.search?.trim() || null, p_filters: filters, p_sum: sum,
    p_tenant_id: tenantId ?? null, p_limit: GROUPING_LIMITS.groups,
    ...(root ? { p_root_field: root.field, p_root_source: root.source } : {}),
  }, query.workspace)
  if (error && !isMissingObject(error)) throw dbError(error)
  if (!error) {
    flat = ((data ?? []) as any[]).map((r) => ({ g1: r.g1 ?? null, g2: r.g2 ?? null, row_count: Number(r.row_count) || 0, sums: r.sums ?? {} }))
  } else {
    const scan = await scanRows(db, tableId, tenantId)
    exact = false
    truncated = scan.truncated
    const rows = (root ? filterRoots(scan.rows, root) : scan.rows).filter((row) => rowMatchesSearch(row, query.search) && rowMatchesFilters(row, filters))
    flat = groupRowsInMemory(rows, groupBy, sum)
  }
  const groupsTruncated = flat.length >= GROUPING_LIMITS.groups
  const groups = buildGroupTree(flat.slice(0, GROUPING_LIMITS.groups), groupBy.length, query.direction)
  return { group_by: groupBy, groups, total: groups.reduce((n, g) => n + g.count, 0), exact, truncated, groups_truncated: groupsTruncated }
}

/* ── Filtered pages (a group's rows, a hierarchy's top level) ────────── */

export interface FilteredPageQuery {
  search?: string
  filters?: GroupRowFilter[]
  sort?: string
  dir?: 'asc' | 'desc'
  limit: number
  offset: number
  /** The caller's workspace: keys the per-workspace cap on expensive grid queries (lib/services/data-table-guard). */
  workspace?: string | null
}

/** One page of rows passing the filters, with the exact total (or over the newest GROUP_SCAN rows until the migration is applied). */
export async function queryFilteredRows(db: any, tableId: string, query: FilteredPageQuery, tenantId?: string | null): Promise<{ rows: any[]; total: number; truncated: boolean }> {
  const exact = await queryFilteredRowsExact(db, tableId, query, tenantId)
  if (exact) return exact
  const sort = query.sort && (query.sort.startsWith('_') || isSafeColumnKey(query.sort)) ? query.sort : '_updated_at'
  const { filters, root } = splitRootFilter(query.filters)
  const scan = await scanRows(db, tableId, tenantId)
  const rows = sortRowsLikeDatabase((root ? filterRoots(scan.rows, root) : scan.rows).filter((row) => rowMatchesSearch(row, query.search) && rowMatchesFilters(row, filters)), sort, query.dir ?? 'desc')
  return { rows: rows.slice(query.offset, query.offset + query.limit), total: rows.length, truncated: scan.truncated }
}

/** The page through data_table_rows_page (exact), or null when the function is not there (migration not applied). */
export async function queryFilteredRowsExact(db: any, tableId: string, query: FilteredPageQuery, tenantId?: string | null): Promise<{ rows: any[]; total: number; truncated: false } | null> {
  const sort = query.sort && (query.sort.startsWith('_') || isSafeColumnKey(query.sort)) ? query.sort : '_updated_at'
  const dir = query.dir ?? 'desc'
  const { filters, root } = splitRootFilter(query.filters)
  const args = {
    p_table_id: tableId, p_search: query.search?.trim() || null, p_filters: filters, p_sort: sort, p_dir: dir,
    p_limit: query.limit, p_offset: query.offset, p_tenant_id: tenantId ?? null,
    ...(root ? { p_root_field: root.field, p_root_source: root.source } : {}),
  }
  const { data, error } = await callRpc(db, 'data_table_rows_page', args, query.workspace)
  if (error && !isMissingObject(error)) throw dbError(error)
  if (!error) {
    const list = ((data ?? []) as any[]).map((r) => (typeof r === 'string' ? JSON.parse(r) : r))
    let total = list.length ? Number(list[0]._total) || 0 : 0
    if (!list.length && query.offset > 0) {
      const probe = await callRpc(db, 'data_table_rows_page', { ...args, p_limit: 1, p_offset: 0 }, query.workspace)
      if (probe.error) throw dbError(probe.error)
      const first = ((probe.data ?? []) as any[])[0]
      total = first ? Number((typeof first === 'string' ? JSON.parse(first) : first)._total) || 0 : 0
    }
    return { rows: list.map(({ _total, ...row }) => row), total, truncated: false }
  }
  return null
}

/* ── Child relations ─────────────────────────────────────────────────── */

/** A table's child relations ([] until the migration is applied — `available: false`). */
export async function loadChildRelations(db: any, tableId: string, tenantId?: string | null): Promise<{ relations: ChildRelation[]; available: boolean; table: any | null }> {
  const { data, error } = await scoped(db.from('custom_tables').select('id, name, columns, child_relations').eq('id', tableId), tenantId).maybeSingle()
  if (error && isMissingObject(error)) {
    const fallback = await scoped(db.from('custom_tables').select('id, name, columns').eq('id', tableId), tenantId).maybeSingle()
    if (fallback.error) throw dbError(fallback.error)
    return { relations: [], available: false, table: fallback.data ?? null }
  }
  if (error) throw dbError(error)
  return { relations: normalizeChildRelations(data?.child_relations), available: true, table: data ?? null }
}

async function loadTables(db: any, ids: string[], tenantId?: string | null): Promise<Map<string, any>> {
  const valid = [...new Set(ids)].filter((id) => UUID_RE.test(id))
  if (!valid.length) return new Map()
  const { data, error } = await scoped(db.from('custom_tables').select('id, name, columns, views').in('id', valid), tenantId)
  if (error && isMissingObject(error)) {
    const fallback = await scoped(db.from('custom_tables').select('id, name, columns').in('id', valid), tenantId)
    if (fallback.error) throw dbError(fallback.error)
    return new Map(((fallback.data ?? []) as any[]).map((t) => [String(t.id), t]))
  }
  if (error) throw dbError(error)
  return new Map(((data ?? []) as any[]).map((t) => [String(t.id), t]))
}

/**
 * Check relations against the child tables (this workspace, readable by the
 * caller; `allowTable` refuses tables outside a key's scope).
 * `parentColumns`: the parent table's columns as they will be saved (a same-table relation checks those).
 */
export async function validateChildRelations(db: any, parentTableId: string, input: unknown, opts: { tenantId?: string | null; parentColumns?: unknown; allowTable?: (id: string) => boolean } = {}): Promise<ChildRelation[]> {
  if (input !== null && input !== undefined && !Array.isArray(input)) throw ServiceError.validation('child_relations must be an array')
  const raw = (input ?? []) as unknown[]
  if (raw.length > GROUPING_LIMITS.relations) throw ServiceError.validation(`At most ${GROUPING_LIMITS.relations} child relations per table`)
  const relations = normalizeChildRelations(raw)
  if (relations.length !== raw.length) throw ServiceError.validation('Child records: each relation needs a table_id and a lookup_column (and no duplicates)')
  for (const rel of relations) if (opts.allowTable && !opts.allowTable(rel.table_id)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
  const tables = await loadTables(db, relations.map((r) => r.table_id).filter((id) => id !== parentTableId), opts.tenantId)
  if (relations.some((r) => r.table_id === parentTableId)) {
    let columns = opts.parentColumns
    if (columns === undefined) {
      const { data, error } = await scoped(db.from('custom_tables').select('id, name, columns').eq('id', parentTableId), opts.tenantId).maybeSingle()
      if (error) throw dbError(error)
      columns = data?.columns
      if (data) tables.set(parentTableId, { ...data, columns })
    } else {
      tables.set(parentTableId, { id: parentTableId, name: 'this table', columns })
    }
  }
  const problems = childRelationProblems(parentTableId, relations, tables)
  if (problems.length) throw ServiceError.validation(problems[0], { problems })
  return relations
}

export function childRelationsUnavailable(): ServiceError {
  return new ServiceError('internal', `Child records need database migration ${GROUPING_MIGRATION} — ask an administrator to apply it`, { status: 503 })
}

/** Child counts per relation and parent row: { [relationId]: { [parentRowId]: count } }. */
export async function computeChildCounts(db: any, parentTableId: string, parents: Array<{ id: string; data: any }>, tenantId?: string | null): Promise<{ relations: Array<ChildRelation & { table_name: string }>; counts: Record<string, Record<string, number>>; exact: boolean }> {
  const { relations } = await loadChildRelations(db, parentTableId, tenantId)
  if (!relations.length || !parents.length) return { relations: [], counts: {}, exact: true }
  const tables = await loadTables(db, relations.map((r) => r.table_id), tenantId)
  const out: Record<string, Record<string, number>> = {}
  const visible: Array<ChildRelation & { table_name: string }> = []
  let exact = true
  for (const rel of relations) {
    const child = tables.get(rel.table_id)
    if (!child) continue
    const lookup = relationLookupColumn(rel, parentTableId, child)
    if (!lookup) continue
    visible.push({ ...rel, table_name: String(child.name ?? '') })
    const byValue = new Map<string, string[]>()
    for (const p of parents.slice(0, GROUPING_LIMITS.countParents)) {
      const value = parentLinkValue(p.data, lookup.sourceColumn)
      if (value === null) continue
      byValue.set(value, [...(byValue.get(value) ?? []), p.id])
    }
    const counts: Record<string, number> = {}
    out[rel.id] = counts
    for (const p of parents) counts[p.id] = 0
    if (!byValue.size) continue
    const values = [...byValue.keys()]
    const perValue = new Map<string, number>()
    const { data, error } = await callRpc(db, 'data_table_row_groups', {
      p_table_id: rel.table_id, p_group_by: [lookup.key], p_search: null, p_filters: [{ field: lookup.key, operator: 'in', value: values }],
      p_sum: [], p_tenant_id: tenantId ?? null, p_limit: GROUPING_LIMITS.groups,
    })
    if (error && !isMissingObject(error)) throw dbError(error)
    if (!error) {
      for (const r of (data ?? []) as any[]) if (r.g1 !== null && r.g1 !== undefined) perValue.set(String(r.g1), Number(r.row_count) || 0)
    } else {
      const res = await scoped(db.from('custom_table_rows').select('id, data').eq('table_id', rel.table_id).in(`data->>${lookup.key}`, values), tenantId).limit(10_000)
      if (res.error) throw dbError(res.error)
      const rows = (res.data ?? []) as any[]
      if (rows.length >= 10_000) exact = false
      for (const row of rows) {
        const v = row?.data?.[lookup.key]
        const text = v === null || v === undefined ? null : typeof v === 'string' ? v : String(v)
        if (text !== null && byValue.has(text)) perValue.set(text, (perValue.get(text) ?? 0) + 1)
      }
    }
    for (const [value, ids] of byValue) for (const id of ids) counts[id] = perValue.get(value) ?? 0
    // A hierarchy row that names itself as its parent is not its own child.
    if (rel.table_id === parentTableId) {
      for (const p of parents) {
        const own = p.data?.[lookup.key]
        if (counts[p.id] && own !== null && own !== undefined && String(own) === parentLinkValue(p.data, lookup.sourceColumn)) counts[p.id]--
      }
    }
  }
  return { relations: visible, counts: out, exact }
}

export interface ChildRowsResult {
  relation: ChildRelation & { table_name: string }
  table: { id: string; name: string; columns: any[]; views: any[] }
  /** The value the children store in their lookup cell (and a new child gets). */
  link_value: string | null
  lookup_column: string
  rows: any[]
  total: number
}

/** A parent row's child rows of one relation (exact; RLS / tenant applies to both tables). */
export async function loadChildRows(db: any, parentTableId: string, parentRowId: string, relationId: string, page: { limit: number; offset: number }, tenantId?: string | null): Promise<ChildRowsResult> {
  const { relations } = await loadChildRelations(db, parentTableId, tenantId)
  const rel = relations.find((r) => r.id === relationId)
  if (!rel) throw ServiceError.notFound('Child relation not found')
  const tables = await loadTables(db, [rel.table_id], tenantId)
  const child = tables.get(rel.table_id)
  if (!child) throw ServiceError.notFound('Child table not found')
  const lookup = relationLookupColumn(rel, parentTableId, child)
  if (!lookup) throw ServiceError.validation('The child relation no longer matches a lookup column of the child table')
  const parent = await scoped(db.from('custom_table_rows').select('id, data').eq('id', parentRowId).eq('table_id', parentTableId), tenantId).maybeSingle()
  if (parent.error) throw dbError(parent.error)
  if (!parent.data) throw ServiceError.notFound('Row not found in this table')
  const value = parentLinkValue(parent.data.data, lookup.sourceColumn)
  const base = { relation: { ...rel, table_name: String(child.name ?? '') }, table: { id: child.id, name: child.name, columns: Array.isArray(child.columns) ? child.columns : [], views: Array.isArray(child.views) ? child.views : [] }, link_value: value, lookup_column: lookup.key }
  if (value === null) return { ...base, rows: [], total: 0 }
  const limit = Math.max(1, Math.min(GROUPING_LIMITS.childRows, page.limit))
  const offset = Math.max(0, page.offset)
  const { data, count, error } = await scoped(db.from('custom_table_rows').select(ROW_COLUMNS, { count: 'exact' }).eq('table_id', rel.table_id).eq(`data->>${lookup.key}`, value), tenantId)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw dbError(error)
  // A row can't be its own child (a hierarchy row pointing at itself).
  const rows = ((data ?? []) as any[]).filter((r) => !(rel.table_id === parentTableId && r.id === parentRowId))
  return { ...base, rows, total: Math.max(0, (count ?? rows.length) - (((data ?? []) as any[]).length - rows.length)) }
}

/* ── Service-context wrappers (API / MCP) ────────────────────────────── */

function requireScope(ctx: ServiceContext, tableId: string) {
  const allow = ctx.resourceScopes?.table_ids ?? []
  if (allow.length && !allow.includes(tableId)) throw ServiceError.forbidden('Forbidden: this credential is not allowed to access that table')
}

async function requireTable(ctx: ServiceContext, tableId: string) {
  requireScope(ctx, tableId)
  if (!UUID_RE.test(tableId)) throw ServiceError.notFound('Table not found')
  const { data, error } = await (ctx.supabase as any).from('custom_tables').select('id').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Table not found')
}

/** GET /data-tables/{id}/rows/groups. */
export async function groupRows(ctx: ServiceContext, tableId: string, query: RowGroupsQuery) {
  requirePerm(ctx, 'data.view')
  await requireTable(ctx, tableId)
  return { table_id: tableId, ...(await computeRowGroups(ctx.supabase as any, tableId, query, ctx.tenantId)) }
}

/** GET /data-tables/{id}/rows/{rowId}/children. Without `relation`: the counts of every relation for that row. */
export async function rowChildren(ctx: ServiceContext, tableId: string, rowId: string, input: { relation?: string; limit?: number; offset?: number }) {
  requirePerm(ctx, 'data.view')
  await requireTable(ctx, tableId)
  const db = ctx.supabase as any
  const { relations } = await loadChildRelations(db, tableId, ctx.tenantId)
  const allowed = relations.filter((r) => { try { requireScope(ctx, r.table_id); return true } catch { return false } })
  const relation = input.relation ? allowed.find((r) => r.id === input.relation) : allowed.length === 1 ? allowed[0] : undefined
  if (input.relation && !relation) throw ServiceError.notFound('Child relation not found')
  if (!relation) {
    const parent = await db.from('custom_table_rows').select('id, data').eq('id', rowId).eq('table_id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()
    if (parent.error) throw dbError(parent.error)
    if (!parent.data) throw ServiceError.notFound('Row not found in this table')
    const { relations: visible, counts } = await computeChildCounts(db, tableId, [parent.data], ctx.tenantId)
    return { table_id: tableId, row_id: rowId, relations: visible.filter((r) => allowed.some((a) => a.id === r.id)).map((r) => ({ ...r, count: counts[r.id]?.[rowId] ?? 0 })) }
  }
  const result = await loadChildRows(db, tableId, rowId, relation.id, { limit: input.limit ?? 50, offset: input.offset ?? 0 }, ctx.tenantId)
  return { table_id: tableId, row_id: rowId, relation: result.relation, child_table: { id: result.table.id, name: result.table.name, columns: result.table.columns }, link_value: result.link_value, lookup_column: result.lookup_column, rows: result.rows, total: result.total }
}
