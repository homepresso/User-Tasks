/**
 * "Get rows from an API": the pure model behind the guided picker that binds
 * an API reference to a form Data table (its rows) or to a Data grid / Data
 * table column (its dropdown or autocomplete options).
 *
 *  - detectRowArrays: every list in a test response, scored, and the most
 *    likely list of records picked (no JSON paths to type);
 *  - responseBadges: the response as a tree of draggable badges ("invoices ·
 *    6 rows", "lines · items (per row)", fields with a type icon) and what
 *    each badge can do (badgeActions);
 *  - generateColumns: columns from sample rows with sensible types, formats
 *    and labels — the designer only ticks which to show;
 *  - the drop actions: what a badge dropped (or its menu item chosen) does to
 *    a Data table config (applyRowsPath, addFieldColumn) or a column binding
 *    (bindingUseRows, bindingSetValue, bindingSetLabel). Both write the
 *    existing models: DataTableFieldConfig and LookupConfig (the
 *    datatable-columns binding model) — no second binding model;
 *  - suggestInputMappings / pagingSupport: parameters filled in from their
 *    names (search, page, page size, a form field of the same name);
 *  - explainApiError: a failed test call in plain words, with the fix;
 *  - parseApiAddress: a pasted API address split into a connection and an
 *    operation (inline "create a reference").
 *
 * Pure and isomorphic.
 */

import { inferSchema, splitPath, type ResponseSchema, type SchemaNode } from '@/lib/response-schema'
import { collectionAt, collectionItemFields, findCollections, isCollectionPath, normalizeCollectionPath, pagingHints, runtimeView, schemaAtCollectionPath } from '@/lib/response-collections'
import { DATA_TABLE_LIMITS, type DataTableColumn, type DataTableColumnType, type DataTableFieldConfig } from '@/lib/forms/data-table'
import type { CellFormat } from '@/lib/formatting/cell-format'
import type { LookupConfig } from '@/lib/forms/lookup'

/* ── The response ─────────────────────────────────────────────────────── */

/** A test response as the runtime reads it: the model's root and its sample (executor wrappers unwrapped). */
export function responseView(schema: ResponseSchema | null | undefined): { root: SchemaNode | null; sample: unknown } {
  const view = runtimeView(schema)
  if (view.root && view.root.type !== 'any') return { root: view.root, sample: view.sample }
  if (view.sample !== undefined && view.sample !== null) return { root: inferSchema(view.sample), sample: view.sample }
  return { root: null, sample: undefined }
}

/* ── Which list holds the records ─────────────────────────────────────── */

export interface RowArrayCandidate {
  /** Collection path ('' = the response itself). */
  path: string
  /** Items in the test response (the stored sample keeps at most 20). */
  count?: number
  /** Items are records (objects with fields). */
  objectItems: boolean
  /** Inside a record of another list (`orders[].lines`): one row per sub-item. */
  nested: boolean
  score: number
}

/** List names that usually hold the records. */
const ROW_NAMES = /^(items|data|results?|records|rows|value|values|entries|list|hits|nodes|objects|content|contents|elements|collection|docs|documents)$/i
/** List names that usually don't (links, errors, metadata). */
const NOT_ROW_NAMES = /^(links|_links|errors|warnings|messages|tags|labels|scopes|roles|permissions|headers|cookies|meta|_meta|facets|aggregations|included)$/i

function lastName(path: string): string {
  const parts = splitPath(path).filter((p) => p !== '[]' && !/^\d+$/.test(p))
  return parts[parts.length - 1] ?? ''
}

/**
 * Every list in a response, most likely first: lists of records beat lists of
 * values, top-level lists beat lists inside records, bigger and
 * conventionally named lists (items, data, results…) win ties.
 * `best` is the list a designer starts with (null when the response has none).
 */
export function detectRowArrays(root: SchemaNode | null | undefined, sample?: unknown): { best: string | null; candidates: RowArrayCandidate[] } {
  if (!root) return { best: null, candidates: [] }
  const candidates = findCollections(root, sample).map((c) => {
    const name = lastName(c.path)
    let score = c.objectItems ? 100 : 10
    if (!c.nested) score += 50
    if (c.count !== undefined) score += Math.min(c.count, 50) / 5 + (c.count === 0 ? -5 : 0)
    if (ROW_NAMES.test(name)) score += 20
    if (NOT_ROW_NAMES.test(name)) score -= 60
    // Plural nouns (invoices, customers) read as records too.
    if (/[a-z]s$/i.test(name) && !NOT_ROW_NAMES.test(name)) score += 5
    score -= c.depth * 3
    return { path: c.path, ...(c.count !== undefined ? { count: c.count } : {}), objectItems: c.objectItems, nested: c.nested, score }
  })
  candidates.sort((a, b) => b.score - a.score)
  return { best: candidates[0]?.path ?? null, candidates }
}

/** The rows of a list in a sample (flattening `a[].b`), as plain records. */
export function sampleRows(sample: unknown, path: string | undefined | null): Array<Record<string, unknown>> {
  if (sample === undefined || sample === null) return []
  const rows = collectionAt(sample, path ?? '')
  return rows.map((r) => (r !== null && typeof r === 'object' && !Array.isArray(r) ? r as Record<string, unknown> : { value: r }))
}

/* ── Badges ───────────────────────────────────────────────────────────── */

export type BadgeKind = 'rows' | 'sublist' | 'object' | 'field'
export type BadgeIcon = 'list' | 'object' | 'text' | 'number' | 'boolean' | 'date'

export interface ResponseBadge {
  /** Path in the response (collection syntax: `data.invoices`, `data.invoices[].customer.name`). */
  path: string
  /** For something inside the chosen rows: its path inside one row (`customer.name`) — what a column stores. */
  rowPath?: string
  kind: BadgeKind
  name: string
  /** What the badge says: "invoices · 6 rows", "lines · items (per row)", "amount_usd". */
  label: string
  icon: BadgeIcon
  count?: number
  /** The list the designer starts with (most likely records). */
  recommended?: boolean
  /** The rows currently in use. */
  selected?: boolean
  /** A field's example from the test call. */
  example?: string
  depth: number
  children: ResponseBadge[]
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/

function iconFor(node: SchemaNode): BadgeIcon {
  if (node.type === 'array') return 'list'
  if (node.type === 'object') return 'object'
  if (node.type === 'number' || node.type === 'integer') return 'number'
  if (node.type === 'boolean') return 'boolean'
  if (node.format === 'date' || node.format === 'date-time' || (typeof node.example === 'string' && (DATE_RE.test(node.example) || DATETIME_RE.test(node.example)))) return 'date'
  return 'text'
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function exampleText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.length > 40 ? `${text.slice(0, 39)}…` : text
}

/** The label a list badge carries. */
export function listBadgeLabel(name: string, node: SchemaNode, count: number | undefined, nested: boolean): string {
  if (nested) return `${name} · items (per row)`
  const records = node.items?.type === 'object'
  if (count === undefined) return `${name} · ${records ? 'rows' : 'values'}`
  return `${name} · ${records ? plural(count, 'row', 'rows') : plural(count, 'value', 'values')}`
}

/**
 * The response as badges: every list (rows, or "items (per row)" inside a
 * record), every object and every field. Fields inside the chosen rows carry
 * their path inside a row (rowPath): those can become columns, values or
 * labels. Bounded (depth 8, 400 badges).
 */
export function responseBadges(root: SchemaNode, sample: unknown, rowsPath?: string | null): ResponseBadge {
  const { best, candidates } = detectRowArrays(root, sample)
  const counts = new Map(candidates.map((c) => [c.path, c.count]))
  const rows = rowsPath === undefined || rowsPath === null ? null : normalizeCollectionPath(rowsPath)
  let budget = 400
  const visit = (node: SchemaNode, path: string, name: string, depth: number, nested: boolean): ResponseBadge => {
    budget--
    // Inside the chosen rows: `rows[].a.b` → `a.b` (the rows themselves: path === rows).
    const inRows = rows !== null && path !== rows && (rows === '' ? path.startsWith('[].') : path.startsWith(`${rows}[].`))
    const rowPath = inRows ? path.slice(rows === '' ? 3 : rows.length + 3) : undefined
    const badge: ResponseBadge = { path, name, kind: 'field', label: name, icon: iconFor(node), depth, children: [] }
    if (rowPath !== undefined && !rowPath.includes('[]')) badge.rowPath = rowPath
    if (node.type === 'array') {
      const count = nested ? undefined : counts.get(path)
      badge.kind = nested ? 'sublist' : 'rows'
      badge.label = listBadgeLabel(depth === 0 ? 'response' : name, node, count, nested)
      if (count !== undefined) badge.count = count
      if (path === best) badge.recommended = true
      if (rows !== null && path === rows) badge.selected = true
      if (depth < 8 && budget > 0 && node.items?.type === 'object') {
        for (const f of node.items.fields ?? []) if (budget > 0) badge.children.push(visit(f, `${path}[].${f.name}`, f.name, depth + 1, true))
      }
    } else if (node.type === 'object') {
      badge.kind = 'object'
      badge.label = depth === 0 ? 'response' : name
      if (depth < 8 && budget > 0) for (const f of node.fields ?? []) if (budget > 0) badge.children.push(visit(f, path ? `${path}.${f.name}` : f.name, f.name, depth + 1, nested))
    } else {
      const ex = exampleText(node.example)
      if (ex !== undefined) badge.example = ex
    }
    return badge
  }
  return visit(root, '', 'response', 0, false)
}

export type BadgeAction = 'use_rows' | 'add_column' | 'add_columns' | 'set_value' | 'set_label' | 'use_total'

export const BADGE_ACTION_LABELS: Record<BadgeAction, string> = {
  use_rows: 'Use as rows',
  add_column: 'Add as column',
  add_columns: 'Add its fields as columns',
  set_value: 'Use as the stored value',
  set_label: 'Use as the label people see',
  use_total: 'Use as the total row count',
}

/**
 * What a badge can do where it is: a list → rows; a field of the rows →
 * a column (rows mode) or the value / label (options mode); an object in the
 * rows → its fields as columns; a number outside the rows → the total count.
 */
export function badgeActions(badge: ResponseBadge, mode: 'rows' | 'options'): BadgeAction[] {
  if (badge.kind === 'rows' || badge.kind === 'sublist') return badge.selected ? [] : ['use_rows']
  if (badge.rowPath !== undefined) {
    if (badge.kind === 'object') return mode === 'rows' ? ['add_columns'] : []
    return mode === 'rows' ? ['add_column'] : ['set_value', 'set_label']
  }
  if (mode === 'rows' && badge.kind === 'field' && badge.icon === 'number' && badge.depth > 0) return ['use_total']
  return []
}

/** Flatten a badge tree (depth-first) — for lookups and tests. */
export function flattenBadges(root: ResponseBadge): ResponseBadge[] {
  const out: ResponseBadge[] = []
  const walk = (b: ResponseBadge) => { out.push(b); b.children.forEach(walk) }
  walk(root)
  return out
}

/* ── Drag payload ─────────────────────────────────────────────────────── */

/** The drag type a response badge carries (its payload: ResponseDragPayload as JSON). */
export const RESPONSE_DRAG_TYPE = 'application/x-usertasks-response-node'

export interface ResponseDragPayload { path: string; kind: BadgeKind; rowPath?: string }

const FIELD_PATH_RE = /^[A-Za-z0-9_$@-]{1,100}(\.[A-Za-z0-9_$@-]{1,100}){0,5}$/

export function encodeBadgeDrag(badge: Pick<ResponseBadge, 'path' | 'kind' | 'rowPath'>): string {
  return JSON.stringify({ path: badge.path, kind: badge.kind, ...(badge.rowPath !== undefined ? { rowPath: badge.rowPath } : {}) })
}

/** A dropped payload, checked (anything else dropped is ignored). */
export function decodeBadgeDrag(raw: string | null | undefined): ResponseDragPayload | null {
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== 'object') return null
  const v = value as Record<string, unknown>
  if (typeof v.path !== 'string' || !['rows', 'sublist', 'object', 'field'].includes(String(v.kind))) return null
  if (v.path && !isCollectionPath(v.path)) return null
  if (v.rowPath !== undefined && (typeof v.rowPath !== 'string' || !FIELD_PATH_RE.test(v.rowPath))) return null
  return { path: v.path, kind: v.kind as BadgeKind, ...(typeof v.rowPath === 'string' ? { rowPath: v.rowPath } : {}) }
}

/* ── Columns from sample rows ─────────────────────────────────────────── */

const ACRONYMS = new Set(['id', 'url', 'uri', 'usd', 'eur', 'gbp', 'api', 'sku', 'vat', 'gst', 'ip', 'po', 'uuid', 'iso', 'html', 'pdf', 'csv'])

/** A field path as a column label: `customer.name` → "Customer name", `amount_usd` → "Amount USD", `dueDate` → "Due date". */
export function humanizeLabel(path: string): string {
  const words = path
    .split('.')
    .join(' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-$@]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()))
  if (!words.length) return path
  // "Customer name" (not "Customer Name"); a repeated word ("customer customer_id") once.
  const deduped = words.filter((w, i) => i === 0 || w !== words[i - 1])
  const [first, ...rest] = deduped
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

const MONEY_NAME = /(amount|price|total|cost|balance|fee|salary|revenue|subtotal|tax|usd|payment|paid_amount|budget|spend)/i
const ID_NAME = /^(id|_id|uuid|key|code|number|no|sku)$|(_id|Id|_key|_code|_number|_no)$/
const LABEL_NAME = /^(name|title|display_?name|label|full_?name|subject|description|summary)$/i
const CHOICE_NAME = /(status|state|type|category|kind|stage|priority|level|tier|region|country)$/i

export interface GeneratedColumn {
  /** Path inside one row (`customer.name`). */
  key: string
  label: string
  type: DataTableColumnType
  format?: CellFormat
  /** Choice columns: the values seen. */
  options?: string[]
  /** Ticked to show by default. */
  show: boolean
  example?: unknown
}

function flattenRecord(row: Record<string, unknown>, prefix: string, depth: number, out: Map<string, unknown[]>): void {
  for (const [k, v] of Object.entries(row)) {
    if (!/^[A-Za-z0-9_$@-]{1,100}$/.test(k)) continue
    const path = prefix ? `${prefix}.${k}` : k
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && depth < 2) { flattenRecord(v as Record<string, unknown>, path, depth + 1, out); continue }
    if (Array.isArray(v) || (v !== null && typeof v === 'object')) continue
    if (!out.has(path)) out.set(path, [])
    out.get(path)!.push(v)
  }
}

/** A column type from a field's sample values. */
export function inferColumnType(name: string, values: unknown[]): { type: DataTableColumnType; format?: CellFormat; options?: string[] } {
  const present = values.filter((v) => v !== null && v !== undefined && v !== '')
  if (!present.length) return { type: 'text' }
  if (present.every((v) => typeof v === 'boolean')) return { type: 'boolean' }
  if (present.every((v) => typeof v === 'number')) {
    if (MONEY_NAME.test(name) && !ID_NAME.test(lastSegment(name))) return { type: 'number', format: { kind: 'currency', currency: 'USD' } }
    return { type: 'number' }
  }
  if (present.every((v) => typeof v === 'string')) {
    const strings = present as string[]
    if (strings.every((s) => DATE_RE.test(s))) return { type: 'date' }
    if (strings.every((s) => DATETIME_RE.test(s) && !Number.isNaN(Date.parse(s)))) return { type: 'datetime' }
    if (strings.every((s) => /^https?:\/\//i.test(s))) return { type: 'text', format: { kind: 'link' } }
    if (strings.every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) return { type: 'text', format: { kind: 'link', link_type: 'email' } }
    const distinct = [...new Set(strings)]
    if (CHOICE_NAME.test(lastSegment(name)) && distinct.length <= 12 && strings.every((s) => s.length <= 40)) return { type: 'choice', options: distinct.sort() }
  }
  return { type: 'text' }
}

function lastSegment(path: string): string {
  const parts = path.split('.')
  return parts[parts.length - 1]
}

/**
 * The API's own field order for the rows at a path (from the model, whose
 * field lists keep it — a sample stored as JSONB comes back with its keys
 * reordered).
 */
export function rowFieldOrder(root: SchemaNode | null | undefined, path: string | undefined | null): string[] {
  if (!root) return []
  const list = schemaAtCollectionPath(root, normalizeCollectionPath(path ?? ''))
  const item = list?.type === 'array' ? list.items : list?.type === 'object' ? list : null
  return collectionItemFields(item).filter((f) => !f.container).map((f) => f.path)
}

/**
 * Columns for the fields of some sample rows (nested objects flattened two
 * levels: `customer.name`), in the API's order (`order`, else first seen).
 * The first `showFirst` (default 6) are ticked.
 */
export function generateColumns(rows: Array<Record<string, unknown>>, options: { showFirst?: number; order?: string[] } = {}): GeneratedColumn[] {
  const showFirst = options.showFirst ?? 6
  const found = new Map<string, unknown[]>()
  for (const row of rows.slice(0, 50)) flattenRecord(row, '', 0, found)
  const rank = new Map((options.order ?? []).map((k, i) => [k, i]))
  const fields = [...found].map(([k, v], i) => ({ k, v, i })).sort((a, b) => (rank.get(a.k) ?? 1e6 + a.i) - (rank.get(b.k) ?? 1e6 + b.i)).map(({ k, v }) => [k, v] as const)
  const out: GeneratedColumn[] = []
  for (const [key, values] of fields) {
    if (out.length >= DATA_TABLE_LIMITS.columns) break
    const inferred = inferColumnType(key, values)
    const example = values.find((v) => v !== null && v !== undefined && v !== '')
    out.push({ key, label: humanizeLabel(key), ...inferred, show: out.length < showFirst, ...(example !== undefined ? { example } : {}) })
  }
  return out
}

/** A generated column as a Data table column (sortable; filterable unless yes / no). */
export function toDataTableColumn(g: GeneratedColumn, hidden?: boolean): DataTableColumn {
  return {
    key: g.key, label: g.label, type: g.type, sortable: true,
    ...(g.type !== 'boolean' ? { filterable: true } : {}),
    ...(g.format ? { format: g.format } : {}),
    ...(g.options?.length ? { options: g.options } : {}),
    ...(hidden ? { hidden: true } : {}),
  }
}

/** The field that identifies a row (id, *_id, key, code, number…), if any. */
export function suggestKeyField(keys: string[]): string | null {
  const top = keys.filter((k) => !k.includes('.'))
  return top.find((k) => k === 'id') ?? top.find((k) => /^(_id|uuid|key)$/.test(k)) ?? top.find((k) => ID_NAME.test(k)) ?? null
}

/** For a dropdown: the field stored (an id) and the one people see (a name / title). */
export function suggestValueLabel(columns: Array<Pick<GeneratedColumn, 'key' | 'type'>>): { value: string | null; label: string | null } {
  const keys = columns.map((c) => c.key)
  const value = suggestKeyField(keys) ?? keys[0] ?? null
  const label = keys.find((k) => LABEL_NAME.test(lastSegment(k)) && k !== value)
    ?? columns.find((c) => c.type === 'text' && c.key !== value)?.key
    ?? value
  return { value, label }
}

/* ── Drop actions: a form Data table ──────────────────────────────────── */

/**
 * Use a list as the table's rows: the rows path, columns generated from the
 * sample (the ticked ones shown, a key column kept hidden when it isn't
 * shown), the key column and the API's total count when the response has one.
 */
export function applyRowsPath(config: DataTableFieldConfig, path: string, root: SchemaNode | null, sample: unknown): DataTableFieldConfig {
  const rowsPath = normalizeCollectionPath(path)
  const generated = generateColumns(sampleRows(sample, rowsPath), { order: rowFieldOrder(root, rowsPath) })
  const columns = generated.filter((g) => g.show).map((g) => toDataTableColumn(g))
  const key = suggestKeyField(generated.map((g) => g.key))
  if (key && !columns.some((c) => c.key === key)) {
    const g = generated.find((x) => x.key === key)
    if (g && columns.length < DATA_TABLE_LIMITS.columns) columns.push(toDataTableColumn(g, true))
  }
  const total = rowsPath === '' ? undefined : pagingHints(root).find((h) => h.kind === 'total')?.path
  const next: DataTableFieldConfig = { ...config, source: 'reference', results_path: rowsPath || undefined, columns, key_column: key ?? undefined, base_filter: undefined, sort: undefined }
  if (total) next.total_path = total
  else delete next.total_path
  return next
}

/** Add one field of the rows as a column (typed from the sample); no-op when it is already a column. */
export function addFieldColumn(config: DataTableFieldConfig, rowPath: string, sample: unknown): DataTableFieldConfig {
  if (!FIELD_PATH_RE.test(rowPath)) return config
  const existing = config.columns.find((c) => c.key === rowPath)
  if (existing) return existing.hidden ? { ...config, columns: config.columns.map((c) => (c.key === rowPath ? { ...c, hidden: undefined } : c)) } : config
  if (config.columns.length >= DATA_TABLE_LIMITS.columns) return config
  const values = sampleRows(sample, config.results_path).map((r) => valueAt(r, rowPath))
  const inferred = inferColumnType(rowPath, values)
  const g: GeneratedColumn = { key: rowPath, label: humanizeLabel(rowPath), ...inferred, show: true }
  return { ...config, columns: [...config.columns, toDataTableColumn(g)] }
}

/** Show exactly these generated columns (in the generated order), keeping settings of columns already there. */
export function setShownColumns(config: DataTableFieldConfig, generated: GeneratedColumn[], shown: string[]): DataTableFieldConfig {
  const want = new Set(shown)
  const keep = new Map(config.columns.map((c) => [c.key, c]))
  const columns: DataTableColumn[] = []
  for (const g of generated) {
    const prior = keep.get(g.key)
    if (want.has(g.key)) columns.push(prior ? { ...prior, hidden: undefined } : toDataTableColumn(g))
    else if (g.key === config.key_column) columns.push(prior ? { ...prior, hidden: true } : toDataTableColumn(g, true))
  }
  // Columns added by hand (not in the sample) stay.
  for (const c of config.columns) if (!generated.some((g) => g.key === c.key)) columns.push(c)
  return { ...config, columns: columns.slice(0, DATA_TABLE_LIMITS.columns) }
}

function valueAt(record: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = record
  for (const part of path.split('.')) cursor = cursor !== null && typeof cursor === 'object' ? (cursor as Record<string, unknown>)[part] : undefined
  return cursor
}

/* ── Drop actions: a column binding (dropdown / autocomplete options) ── */

/** Use a list as the options: rows path, and the value / label fields suggested from the sample. */
export function bindingUseRows(binding: LookupConfig, path: string, sample: unknown, root?: SchemaNode | null): LookupConfig {
  const rowsPath = normalizeCollectionPath(path)
  const generated = generateColumns(sampleRows(sample, rowsPath), { order: rowFieldOrder(root, rowsPath) })
  const { value, label } = suggestValueLabel(generated)
  return {
    ...binding, source: 'reference', results_path: rowsPath || undefined,
    value_field: value ?? undefined, display_fields: label ? [label] : undefined, fill: undefined,
  }
}

export function bindingSetValue(binding: LookupConfig, rowPath: string): LookupConfig {
  return FIELD_PATH_RE.test(rowPath) ? { ...binding, value_field: rowPath } : binding
}

/** The label people see: first among the shown fields. */
export function bindingSetLabel(binding: LookupConfig, rowPath: string): LookupConfig {
  if (!FIELD_PATH_RE.test(rowPath)) return binding
  return { ...binding, display_fields: [rowPath, ...(binding.display_fields ?? []).filter((f) => f !== rowPath)].slice(0, 10) }
}

/* ── Parameters ───────────────────────────────────────────────────────── */

export interface RefInputLike { name: string; required?: boolean; default_value?: unknown; description?: string; location?: string }

const SEARCH_INPUT = /^(search|q|query|keyword|keywords|term|text|filter|name_contains)$/i
const PAGE_INPUT = /^(page|page_?number|pageno|p)$/i
const SIZE_INPUT = /^(page_?size|per_?page|limit|size|top|\$top|count|max_?results|pagesize)$/i
const OFFSET_INPUT = /^(offset|skip|\$skip|start|from)$/i
const SORT_INPUT = /^(sort|sort_?by|order_?by|orderby|\$orderby)$/i
const DIR_INPUT = /^(sort_?dir|direction|dir|order|sort_?order)$/i

function norm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * Mappings suggested for a reference's inputs from their names: the table's
 * search / paging / sort ({{search}}, {{page}}, {{page_size}}, {{offset}},
 * {{sort}}, {{sort_dir}}) and a form field with the same name or label
 * ({{form.<key>}}, or `fieldPrefix`). Only inputs not mapped yet.
 */
export function suggestInputMappings(inputs: RefInputLike[], fields: Array<{ key: string; label?: string }>, existing: Record<string, string> = {}, options: { fieldPrefix?: string; tableState?: boolean } = {}): Record<string, string> {
  const prefix = options.fieldPrefix ?? 'form'
  const tableState = options.tableState !== false
  const out: Record<string, string> = {}
  for (const input of inputs) {
    if (!input?.name || existing[input.name]) continue
    const n = input.name
    if (SEARCH_INPUT.test(n)) out[n] = '{{search}}'
    else if (tableState && PAGE_INPUT.test(n)) out[n] = '{{page}}'
    else if (tableState && SIZE_INPUT.test(n)) out[n] = '{{page_size}}'
    else if (tableState && OFFSET_INPUT.test(n)) out[n] = '{{offset}}'
    else if (tableState && SORT_INPUT.test(n)) out[n] = '{{sort}}'
    else if (tableState && DIR_INPUT.test(n)) out[n] = '{{sort_dir}}'
    else {
      const field = fields.find((f) => norm(f.key) === norm(n)) ?? fields.find((f) => f.label && norm(f.label) === norm(n))
      if (field) out[n] = `{{${prefix}.${field.key}}}`
    }
  }
  return out
}

/** Whether the API pages its results (a page or offset input is passed the table's page). */
export function pagingSupport(inputs: RefInputLike[], mappings: Record<string, string> | undefined): { possible: boolean; on: boolean } {
  const possible = inputs.some((i) => PAGE_INPUT.test(i.name) || OFFSET_INPUT.test(i.name))
  const on = Object.values(mappings ?? {}).some((v) => /\{\{\s*(page|offset)\s*\}\}/.test(v))
  return { possible, on }
}

/** Turn API paging on (page / size / offset inputs mapped) or off (those mappings removed). */
export function setPaging(inputs: RefInputLike[], mappings: Record<string, string> | undefined, on: boolean): Record<string, string> | undefined {
  const next: Record<string, string> = { ...(mappings ?? {}) }
  for (const input of inputs) {
    const paging = PAGE_INPUT.test(input.name) ? '{{page}}' : SIZE_INPUT.test(input.name) ? '{{page_size}}' : OFFSET_INPUT.test(input.name) ? '{{offset}}' : null
    if (!paging) continue
    if (on) next[input.name] = paging
    else if (next[input.name] === paging) delete next[input.name]
  }
  return Object.keys(next).length ? next : undefined
}

/* ── Errors in plain words ────────────────────────────────────────────── */

export interface ApiErrorHelp {
  title: string
  fix: string
  /** The fix is in the reference's (or its connection's) settings. */
  settings?: boolean
}

/** A failed test call (the server's message) in plain words, with what to do. */
export function explainApiError(message: string | null | undefined): ApiErrorHelp {
  const text = String(message ?? '')
  const status = /answered (\d{3})/.exec(text)?.[1]
  if (status === '401' || status === '403' || /unauthori[sz]ed|forbidden|api key|credential/i.test(text)) {
    return { title: 'The API needs a key or a sign-in', fix: 'Open the reference settings and add the API key or sign-in details to its connection, then test again.', settings: true }
  }
  if (status === '404') return { title: 'The API address was not found', fix: 'Check the address (path) in the reference settings, and any values passed into it.', settings: true }
  if (status === '400' || status === '422') return { title: 'The API did not accept the request', fix: 'Check the parameters above: a required one may be empty or in the wrong format.' }
  if (status === '429') return { title: 'The API is limiting requests', fix: 'Wait a moment and test again.' }
  if (status && status.startsWith('5')) return { title: 'The API had a problem', fix: 'Try again in a moment. If it keeps failing, the service may be down.' }
  if (/egress|blocked|not allowed|private address|https/i.test(text)) return { title: 'This address is blocked by the workspace’s network rules', fix: 'Use an https address, or ask an admin to allow this host.', settings: true }
  if (/empty response/i.test(text)) return { title: 'The API returned nothing', fix: 'Check the parameters: with these values there may be no data.' }
  if (/timed? ?out|timeout|ECONN|ENOTFOUND|fetch failed|call failed/i.test(text)) return { title: 'The API could not be reached', fix: 'Check the address in the connection settings, then test again.', settings: true }
  if (/permission/i.test(text)) return { title: 'You can’t run test calls', fix: 'Ask an admin for the “Test integrations” permission.' }
  return { title: 'The test call failed', fix: text || 'Try again, or open the reference settings.' }
}

/* ── A pasted address ─────────────────────────────────────────────────── */

export interface ParsedApiAddress {
  /** The connection's base URL (an existing connection's when one matches). */
  baseUrl: string
  /** The path after the base URL (`/invoices`). */
  path: string
  /** Query parameters → reference inputs (their values become the defaults). */
  params: Array<{ name: string; value: string }>
  /** An existing connection whose base URL starts the address. */
  connectionId?: string
  /** A suggested reference name ("Invoices"). */
  name: string
}

/**
 * Split a pasted API address into a connection and an operation: the
 * longest existing connection base URL that starts it (else the origin),
 * the path, and the query parameters as inputs. Null when it isn't an
 * http(s) address without credentials.
 */
export function parseApiAddress(address: string, connections: Array<{ id: string; base_url?: string | null }> = []): ParsedApiAddress | null {
  let url: URL
  try { url = new URL(address.trim()) } catch { return null }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
  const full = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  const match = connections
    .filter((c) => c.base_url && /^https?:\/\//i.test(c.base_url))
    .map((c) => ({ id: c.id, base: String(c.base_url).replace(/\/+$/, '') }))
    .filter((c) => full === c.base || full.startsWith(`${c.base}/`))
    .sort((a, b) => b.base.length - a.base.length)[0]
  const baseUrl = match?.base ?? url.origin
  const path = full.slice(baseUrl.length) || '/'
  const params: Array<{ name: string; value: string }> = []
  for (const [name, value] of url.searchParams) if (/^[A-Za-z0-9_.$-]{1,100}$/.test(name) && !params.some((p) => p.name === name)) params.push({ name, value })
  const segments = path.split('/').filter((s) => s && !/^\d+$/.test(s) && !/^v\d+$/i.test(s))
  const name = humanizeLabel(segments[segments.length - 1] ?? url.hostname.split('.')[0] ?? 'API')
  return { baseUrl, path, params, ...(match ? { connectionId: match.id } : {}), name }
}

/* ── Refresh ──────────────────────────────────────────────────────────── */

export type RefreshChoice = 'on_open' | 'on_change' | 'button'

/** The refresh choices a Data table config makes (on open always). */
export function refreshChoices(config: Pick<DataTableFieldConfig, 'refresh_on_change' | 'refresh_button'>): RefreshChoice[] {
  return ['on_open', ...(config.refresh_on_change !== false ? ['on_change' as const] : []), ...(config.refresh_button ? ['button' as const] : [])]
}
