/**
 * Grouping and child records of a Data table grid — the pure half (no
 * database): shared by the server (lib/services/data-table-grouping.ts),
 * the grid (components/data/data-grid.tsx) and the tests.
 *
 * Grouping
 *  - a view groups its rows by up to GROUPING_LIMITS.levels column keys
 *    (GridViewConfig.group_by); groups are computed over the WHOLE filtered
 *    result on the server (data_table_row_groups, or in memory over the
 *    newest rows until that migration is applied — `groupRowsInMemory`
 *    mirrors the SQL exactly);
 *  - a group's key is the cell's text (numbers as written, true / false);
 *    a blank cell (missing, null, only spaces) is the `null` group, shown as
 *    "(empty)";
 *  - group headers carry the row count and the sums of the view's number /
 *    currency columns; a group's rows are fetched with `groupFilters`.
 *
 * Child records
 *  - a table declares child relations (custom_tables.child_relations): rows
 *    of `table_id` (another table, or this one for a hierarchy) whose
 *    `lookup_column` points at a row of this table;
 *  - a lookup cell stores the parent's value of the lookup's source column
 *    (components/data/lookup-config.ts), so a parent row's children are the
 *    child rows whose lookup cell equals `parentLinkValue(parent, …)`;
 *  - a same-table hierarchy nests (`roots_only` shows only rows without a
 *    parent at the top); `nextAncestors` stops cycles.
 */

import { getCellByIdentifier } from '@/lib/data-table-cells'
import { isPlainObject } from '@/lib/utils/guards'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form jsonb */

export const GROUPING_LIMITS = {
  /** Nested group levels. */
  levels: 2,
  /** Groups (level-1 × level-2 combinations) one call returns. */
  groups: 2000,
  /** Number columns summed per group. */
  sums: 10,
  /** Child relations per table. */
  relations: 5,
  /** Hierarchy depth drawn (same-table relations). */
  depth: 6,
  /** Parent rows whose child counts one call returns. */
  countParents: 500,
  /** Child rows one call returns. */
  childRows: 200,
  /** Relation label length. */
  label: 80,
} as const

/** The label of the blank group. */
export const EMPTY_GROUP_LABEL = '(empty)'

const KEY_RE = /^[A-Za-z0-9_$.-]{1,200}$/
const RELATION_ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/* ── Filters (the same semantics as data_table_row_matches) ─────────── */

export type GroupFilterOperator =
  | 'equals' | 'not_equals' | 'contains' | 'starts_with' | 'ends_with'
  | 'gt' | 'gte' | 'lt' | 'lte' | 'is_empty' | 'not_empty' | 'in'
  /** Top level of a same-table hierarchy: `field` blank, or naming no OTHER row by its `value` column (needs the whole table: see splitRootFilter). */
  | 'is_root'

export interface GroupRowFilter { field: string; operator: GroupFilterOperator; value?: string | number | boolean | string[] }

/** A cell as the database's `data->>key` text: strings as is, numbers / booleans written out, objects as JSON, null for missing. */
export function cellText(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** A column key safe to send to the database (`data->>key`). */
export function isSafeColumnKey(key: unknown): key is string {
  return typeof key === 'string' && KEY_RE.test(key)
}

/** Spaces trimmed (as Postgres btrim does — tabs / newlines are kept). */
const btrim = (text: string) => text.replace(/^ +| +$/g, '')

function numberOf(text: string | null): number | null {
  if (text === null) return null
  return /^\s*[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?\s*$/.test(text) ? Number(text) : null
}

/** The text of a row field: a column key, or id / created_at / updated_at / created_by. */
export function rowFieldText(row: { id?: unknown; data?: unknown; created_at?: unknown; updated_at?: unknown; created_by?: unknown }, field: string): string | null {
  if (field === 'id' || field === 'row_id' || field === '_row_id') return row.id == null ? null : String(row.id)
  if (field === 'created_at' || field === '_created_at') return row.created_at == null ? null : String(row.created_at)
  if (field === 'updated_at' || field === '_updated_at') return row.updated_at == null ? null : String(row.updated_at)
  if (field === 'created_by') return row.created_by == null ? null : String(row.created_by)
  const data = isPlainObject(row.data) ? row.data : {}
  return cellText(data[field])
}

/** Whether a row passes every filter (data_table_row_matches in memory). */
export function rowMatchesFilters(row: any, filters: GroupRowFilter[] | undefined): boolean {
  for (const f of filters ?? []) {
    if (!f?.field) continue
    const raw = rowFieldText(row, f.field)
    const left = (raw ?? '').toLowerCase()
    const right = (f.value === undefined || f.value === null ? '' : (cellText(f.value) ?? '')).toLowerCase()
    switch (f.operator) {
      case 'equals': if (left !== right) return false; break
      case 'not_equals': if (left === right) return false; break
      case 'contains': if (!left.includes(right)) return false; break
      case 'starts_with': if (!left.startsWith(right)) return false; break
      case 'ends_with': if (right && !left.endsWith(right)) return false; break
      case 'gt': case 'gte': case 'lt': case 'lte': {
        const l = numberOf(raw)
        const r = numberOf(f.value === undefined || f.value === null ? null : cellText(f.value))
        if (l === null || r === null) return false
        if (f.operator === 'gt' && !(l > r)) return false
        if (f.operator === 'gte' && !(l >= r)) return false
        if (f.operator === 'lt' && !(l < r)) return false
        if (f.operator === 'lte' && !(l <= r)) return false
        break
      }
      case 'is_empty': if (btrim(left) !== '') return false; break
      case 'not_empty': if (btrim(left) === '') return false; break
      case 'in': if (raw === null || !Array.isArray(f.value) || !f.value.some((v) => cellText(v) === raw)) return false; break
      default: break
    }
  }
  return true
}

/** Separate the hierarchy's `is_root` filter (the database / caller resolves it over the table) from the per-row filters. */
export function splitRootFilter(filters: GroupRowFilter[] | undefined): { filters: GroupRowFilter[]; root: { field: string; source: string } | null } {
  const list = filters ?? []
  const rootFilter = list.find((f) => f.operator === 'is_root' && isSafeColumnKey(f.field) && isSafeColumnKey(f.value))
  return { filters: list.filter((f) => f.operator !== 'is_root'), root: rootFilter ? { field: rootFilter.field, source: String(rootFilter.value) } : null }
}

/** Keep the top-level rows of a hierarchy among `rows` (the whole table): parent blank, or no OTHER row carries that value. */
export function filterRoots<R extends { id?: unknown; data?: unknown }>(rows: R[], root: { field: string; source: string }): R[] {
  const owners = new Map<string, Set<string>>()
  for (const row of rows) {
    const v = rowFieldText(row as never, root.source)
    if (v === null) continue
    const set = owners.get(v) ?? new Set<string>()
    set.add(String(row.id))
    owners.set(v, set)
  }
  return rows.filter((row) => {
    const parent = rowFieldText(row as never, root.field)
    if (parent === null || btrim(parent) === '') return true
    const set = owners.get(parent)
    return !set || [...set].every((id) => id === String(row.id))
  })
}

/** Whether a row matches a grid search (row id or any cell, case-insensitive). */
export function rowMatchesSearch(row: any, search: string | undefined): boolean {
  const term = search?.trim().toLowerCase()
  if (!term) return true
  return String(row.id ?? '').toLowerCase().includes(term) || JSON.stringify(row.data ?? {}).toLowerCase().includes(term)
}

/* ── Group by ──────────────────────────────────────────────────────── */

/** A view's group_by, cleaned: up to `levels` distinct safe column keys (known ones only when `known` is given). */
export function normalizeGroupBy(raw: unknown, known?: ReadonlySet<string>): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? raw.split(',') : []
  const out: string[] = []
  for (const entry of list) {
    const key = typeof entry === 'string' ? entry.trim() : ''
    if (!isSafeColumnKey(key) || out.includes(key) || (known && !known.has(key))) continue
    out.push(key)
    if (out.length >= GROUPING_LIMITS.levels) break
  }
  return out
}

/** Column types a grid can group by (scalar cells). */
export const GROUPABLE_TYPES: ReadonlySet<string> = new Set(['text', 'number', 'date', 'boolean', 'select', 'lookup'])

/** The group key of a cell: its text, or null when blank. */
export function groupKeyOf(value: unknown): string | null {
  const text = cellText(value)
  return text === null || btrim(text) === '' ? null : text
}

export interface GroupNode {
  /** The cell text (null: the "(empty)" group). */
  value: string | null
  count: number
  /** Column key → sum of its numeric cells (columns without numbers are left out). */
  sums: Record<string, number>
  /** Second-level groups (grouped by two columns). */
  groups?: GroupNode[]
}

export interface GroupFlat { g1: string | null; g2: string | null; row_count: number; sums: Record<string, number> | null }

/** Rows grouped in memory, as data_table_row_groups returns them (flat, one entry per combination). */
export function groupRowsInMemory(rows: any[], groupBy: string[], sum: string[] = []): GroupFlat[] {
  const map = new Map<string, GroupFlat>()
  for (const row of rows) {
    const data = isPlainObject(row?.data) ? row.data : {}
    const g1 = groupKeyOf(data[groupBy[0]])
    const g2 = groupBy.length > 1 ? groupKeyOf(data[groupBy[1]]) : null
    const id = JSON.stringify([g1, g2])
    let entry = map.get(id)
    if (!entry) { entry = { g1, g2, row_count: 0, sums: {} }; map.set(id, entry) }
    entry.row_count++
    for (const col of sum) {
      const n = numberOf(cellText(data[col]))
      if (n !== null) entry.sums![col] = (entry.sums![col] ?? 0) + n
    }
  }
  return [...map.values()]
}

/** Compare two group values: blank first, numbers numerically, then text (natural order, case-insensitive). */
export function compareGroupValues(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null) return -1
  if (b === null) return 1
  const na = numberOf(a)
  const nb = numberOf(b)
  if (na !== null && nb !== null) return na - nb
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

const round = (n: number) => Math.round(n * 1e6) / 1e6

/** Flat combinations → the group tree (level-1 counts and sums add up their level-2 groups), sorted. */
export function buildGroupTree(flat: GroupFlat[], levels: number, direction: Array<'asc' | 'desc'> = []): GroupNode[] {
  const top = new Map<string, GroupNode>()
  for (const entry of flat) {
    const id = JSON.stringify(entry.g1)
    let node = top.get(id)
    if (!node) { node = { value: entry.g1, count: 0, sums: {}, ...(levels > 1 ? { groups: [] } : {}) }; top.set(id, node) }
    const count = Number(entry.row_count) || 0
    node.count += count
    const sums: Record<string, number> = {}
    for (const [col, v] of Object.entries(entry.sums ?? {})) {
      const n = typeof v === 'number' ? v : Number(v)
      if (!Number.isFinite(n)) continue
      sums[col] = n
      node.sums[col] = round((node.sums[col] ?? 0) + n)
    }
    if (levels > 1) node.groups!.push({ value: entry.g2, count, sums })
  }
  const sorted = (nodes: GroupNode[], level: number) => {
    const dir = direction[level] === 'desc' ? -1 : 1
    return nodes.sort((a, b) => dir * compareGroupValues(a.value, b.value))
  }
  const out = sorted([...top.values()], 0)
  for (const node of out) if (node.groups) sorted(node.groups, 1)
  return out
}

/** The filters that select one group's rows: `path` holds the group values from the top level down. */
export function groupFilters(groupBy: string[], path: Array<string | null>): GroupRowFilter[] {
  return path.slice(0, groupBy.length).map((value, i) => (value === null
    ? { field: groupBy[i], operator: 'is_empty' as const }
    : { field: groupBy[i], operator: 'in' as const, value: [value] }))
}

/** A stable id of a group (for expand / collapse state). */
export function groupId(path: Array<string | null>): string {
  return JSON.stringify(path)
}

/** A group's label: its value, a yes / no for booleans, "(empty)" for blanks. */
export function groupLabel(value: string | null, type?: string): string {
  if (value === null) return EMPTY_GROUP_LABEL
  if (type === 'boolean') return value === 'true' ? 'Yes' : value === 'false' ? 'No' : value
  return value
}

/** Sort rows in memory the way data_table_rows_page sorts them. */
export function sortRowsLikeDatabase(rows: any[], sort: string | undefined, dir: 'asc' | 'desc' = 'desc'): any[] {
  const field = sort || '_updated_at'
  const sign = dir === 'asc' ? 1 : -1
  const system = field === '_updated_at' || field === '_created_at'
  return [...rows].sort((a, b) => {
    if (system) {
      const av = rowFieldText(a, field) ?? ''
      const bv = rowFieldText(b, field) ?? ''
      if (av !== bv) return av < bv ? -sign : sign
      return 0
    }
    if (field !== '_row_id') {
      const an = numberOf(rowFieldText(a, field))
      const bn = numberOf(rowFieldText(b, field))
      if (an !== null || bn !== null) {
        if (an === null) return 1
        if (bn === null) return -1
        if (an !== bn) return sign * (an - bn)
      }
    }
    const at = rowFieldText(a, field)?.toLowerCase() ?? null
    const bt = rowFieldText(b, field)?.toLowerCase() ?? null
    if (at === bt) return 0
    if (at === null) return 1
    if (bt === null) return -1
    return sign * (at < bt ? -1 : 1)
  })
}

/* ── Child relations ───────────────────────────────────────────────── */

export interface ChildRelation {
  /** Stable id (`r_…`). */
  id: string
  /** The child table (this table's own id for a hierarchy). */
  table_id: string
  /** Key of the child table's `lookup` column that points at this table. */
  lookup_column: string
  /** Shown on the chevron / panel (default: the child table's name). */
  label?: string
  /** Same-table hierarchy: the grid shows only rows without a parent at the top level. */
  roots_only?: boolean
}

/** A new relation id. */
export function newRelationId(): string {
  return `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/** Relations, cleaned (shape only: ids unique, at most `relations`, keys safe). Use `childRelationProblems` to check them against the tables. */
export function normalizeChildRelations(raw: unknown): ChildRelation[] {
  if (!Array.isArray(raw)) return []
  const out: ChildRelation[] = []
  const ids = new Set<string>()
  for (const entry of raw) {
    if (!isPlainObject(entry) || out.length >= GROUPING_LIMITS.relations) continue
    const tableId = typeof entry.table_id === 'string' ? entry.table_id.trim() : ''
    const lookup = typeof entry.lookup_column === 'string' ? entry.lookup_column.trim() : ''
    if (!tableId || !isSafeColumnKey(lookup)) continue
    if (out.some((r) => r.table_id === tableId && r.lookup_column === lookup)) continue
    const id = typeof entry.id === 'string' && RELATION_ID_RE.test(entry.id) && !ids.has(entry.id) ? entry.id : newRelationId()
    ids.add(id)
    const rel: ChildRelation = { id, table_id: tableId, lookup_column: lookup }
    const label = typeof entry.label === 'string' ? entry.label.trim().slice(0, GROUPING_LIMITS.label) : ''
    if (label) rel.label = label
    if (entry.roots_only === true) rel.roots_only = true
    out.push(rel)
  }
  return out
}

interface TableLike { id: string; name?: string; columns: unknown }

function columnsOf(table: TableLike): Array<{ key: string; name: string; type: string; lookup?: any }> {
  if (!Array.isArray(table.columns)) return []
  return table.columns.filter(isPlainObject).map((c) => ({
    key: String(c.key ?? '').trim() || String(c.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
    name: String(c.name ?? c.key ?? ''),
    type: String(c.type ?? 'text'),
    lookup: c.lookup,
  }))
}

/** The child table's lookup column of a relation, when it is a lookup column pointing at the parent table. */
export function relationLookupColumn(relation: Pick<ChildRelation, 'lookup_column'>, parentTableId: string, childTable: TableLike) {
  const col = columnsOf(childTable).find((c) => c.key === relation.lookup_column)
  if (!col || col.type !== 'lookup' || !isPlainObject(col.lookup)) return null
  if (String(col.lookup.sourceTableId ?? '') !== parentTableId) return null
  const sourceColumn = typeof col.lookup.sourceColumn === 'string' ? col.lookup.sourceColumn : ''
  if (!sourceColumn) return null
  return { key: col.key, name: col.name, sourceColumn }
}

/** Why relations can't be saved (empty: they can). `tables` holds the child tables by id (missing: not found or not visible). */
export function childRelationProblems(parentTableId: string, relations: ChildRelation[], tables: Map<string, TableLike>): string[] {
  const problems: string[] = []
  for (const rel of relations) {
    const child = tables.get(rel.table_id)
    if (!child) { problems.push(`Child records: table ${rel.table_id} was not found`); continue }
    const name = child.name ?? rel.table_id
    const col = columnsOf(child).find((c) => c.key === rel.lookup_column)
    if (!col) { problems.push(`Child records: "${name}" has no column "${rel.lookup_column}"`); continue }
    if (col.type !== 'lookup') { problems.push(`Child records: "${name}" column "${col.name}" is not a lookup column`); continue }
    if (!relationLookupColumn(rel, parentTableId, child)) problems.push(`Child records: "${name}" column "${col.name}" does not look up this table`)
    if (rel.roots_only && rel.table_id !== parentTableId) problems.push('Child records: "Only top-level rows" applies to a relation of the table with itself')
  }
  return problems
}

/** Lookup columns of `childTable` that point at `parentTableId` (the designer's choices). */
export function lookupColumnsTo(parentTableId: string, childTable: TableLike) {
  return columnsOf(childTable).filter((c) => c.type === 'lookup' && isPlainObject(c.lookup) && String(c.lookup.sourceTableId ?? '') === parentTableId && c.lookup.sourceColumn)
}

/** The value a parent row's children store in their lookup cell (null: the parent has none — no children). */
export function parentLinkValue(parentData: Record<string, unknown> | null | undefined, sourceColumn: string): string | null {
  return groupKeyOf(getCellByIdentifier(parentData ?? {}, sourceColumn))
}

/** The ancestors a nested child level carries (hierarchy cycle guard): null when `rowId` is already an ancestor or the depth is reached. */
export function nextAncestors(ancestors: readonly string[], rowId: string): string[] | null {
  if (ancestors.includes(rowId) || ancestors.length >= GROUPING_LIMITS.depth) return null
  return [...ancestors, rowId]
}

/**
 * The filter that keeps only the top-level rows of a same-table hierarchy:
 * rows whose parent cell is blank or names no other row (a missing parent,
 * or a row that is its own parent, still shows). `columns`: the table's
 * columns (the lookup's source column, stored as a name, resolved to its key).
 */
export function rootsOnlyFilter(relations: ChildRelation[], tableId: string, columns: unknown): GroupRowFilter[] {
  const table = { id: tableId, columns }
  const out: GroupRowFilter[] = []
  for (const rel of relations) {
    if (!rel.roots_only || rel.table_id !== tableId) continue
    const lookup = relationLookupColumn(rel, tableId, table)
    if (!lookup) continue
    const source = columnsOf(table).find((c) => c.key === lookup.sourceColumn || c.name === lookup.sourceColumn)
    if (source && isSafeColumnKey(source.key)) out.push({ field: rel.lookup_column, operator: 'is_root', value: source.key })
    if (out.length) break
  }
  return out
}

/* ── Expand / collapse state (per user, per view; localStorage) ──── */

export function expandStateKey(kind: 'groups' | 'children', tableId: string, viewId: string, userId: string | null | undefined): string {
  return `ut-dt-${kind}:${userId ?? 'anon'}:${tableId}:${viewId}`
}

/** Parse a stored expand state (ids that are open), tolerating junk. */
export function parseExpandState(raw: string | null | undefined, max = 500): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string').slice(-max) : []
  } catch {
    return []
  }
}
