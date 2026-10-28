/**
 * Autocomplete / lookup fields: the field type that suggests values from a
 * data table or an integration reference as the assignee types.
 *
 * The config lives on the field (`field.lookup`), so it travels with the
 * form (node config, reusable form, task metadata, manifests and packages —
 * `table_id` / `reference_id` / `integration_id` are remapped by the
 * generic id remap). At runtime the server reads the config from the TASK's
 * stored form (never from the browser) and runs only that query: the
 * configured table / reference, columns / fields and filters
 * (lib/services/form-lookup.ts).
 *
 * Stored value: the selected item's value (or an array of values when
 * `multiple`) in `task_data.<key>`, plus the selected item(s) — their
 * configured display / value / fill fields only — in `task_data.<key>_item`
 * (computed by the server on save, never taken from the client). "Fill
 * other fields" targets are filled by the server from that verified item
 * too (lib/forms/task-values.ts) — read-only targets always, editable ones
 * when left empty.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export type LookupSource = 'table' | 'reference'

export type LookupFilterOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'is_set' | 'is_not_set'
export const LOOKUP_FILTER_OPERATORS: LookupFilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'is_set', 'is_not_set']
export const LOOKUP_FILTER_OPERATOR_LABELS: Record<LookupFilterOperator, string> = {
  eq: 'equals', neq: 'does not equal', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most',
  contains: 'contains', is_set: 'has a value', is_not_set: 'is empty',
}

export interface LookupFilter {
  column: string
  operator: LookupFilterOperator
  /** Fixed text, or a template: {{task_data.<key>}} (other form fields), {{task.title}}, workflow {{variables}} (resolved when the task is created). */
  value?: string
}

export interface LookupFill {
  /** Item column / field (path) to copy… */
  from: string
  /** …into this other form field. */
  to: string
}

export interface LookupConfig {
  source: LookupSource
  // ── Data table ──
  table_id?: string
  /** Columns the typed text is matched against (case-insensitive). */
  search_columns?: string[]
  /** `contains` (default) or `prefix` (starts with). */
  match?: 'contains' | 'prefix'
  /** Columns shown in a suggestion: the first is the primary text, the rest the secondary line. */
  display_columns?: string[]
  /** Column stored as the value; `row_id` (default) is the row's own id. */
  value_column?: string
  filters?: LookupFilter[]
  sort?: { column: string; direction: 'asc' | 'desc' }
  // ── API reference ──
  integration_id?: string
  reference_id?: string
  /** Reference input name → template ({{search}} = the typed text, {{task_data.<key>}} = another field). */
  input_mappings?: Record<string, string>
  /** Path of the results array in the response ('' = the response itself is the array). */
  results_path?: string
  /** Item fields shown in a suggestion (first = primary). */
  display_fields?: string[]
  /** Item field stored as the value. */
  value_field?: string
  /** Wait this long after the last keystroke before calling the API (ms). */
  debounce_ms?: number
  /** Reuse a response for the same inputs for this long (seconds, 0 = no cache). */
  cache_ttl_s?: number
  // ── Both ──
  max_results?: number
  min_chars?: number
  multiple?: boolean
  allow_free_text?: boolean
  fill?: LookupFill[]
}

/** One suggestion as the browser receives it. */
export interface LookupItem {
  value: string
  label: string
  /** Secondary display text (other display columns, joined). */
  description?: string
  /** The item's configured fields (display, value and fill fields only). */
  fields: Record<string, unknown>
}

export const LOOKUP_LIMITS = {
  maxResults: 50,
  defaultMaxResults: 10,
  defaultMinChars: 1,
  maxMinChars: 10,
  maxColumns: 10,
  maxFilters: 10,
  maxFill: 20,
  maxQuery: 200,
  maxSelections: 50,
  defaultDebounceMs: 300,
  maxDebounceMs: 2000,
  maxCacheTtlS: 3600,
  maxTemplate: 500,
} as const

/** A data table row's own id, as a lookup column (rows read as `{ row_id, ...data }`). */
export const LOOKUP_ROW_ID = 'row_id'

/** Column keys / item field paths: plain identifiers (dotted for nested item fields). */
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const PATH_RE = /^[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,7}$/
const FIELD_KEY_RE = /^[a-z0-9][a-z0-9_]{0,63}$/

export function isLookupColumn(value: unknown): value is string {
  return typeof value === 'string' && COLUMN_RE.test(value)
}

export function isLookupPath(value: unknown): value is string {
  return typeof value === 'string' && PATH_RE.test(value)
}

/** `task_data.<key>_item` key of a lookup field. */
export function lookupItemKey(key: string): string {
  return `${key}_item`
}

function columnList(raw: unknown, valid: (v: unknown) => v is string): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    const s = typeof entry === 'string' ? entry.trim() : ''
    if (valid(s) && !out.includes(s) && out.length < LOOKUP_LIMITS.maxColumns) out.push(s)
  }
  return out
}

function intIn(raw: unknown, min: number, max: number): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n)) return undefined
  return Math.min(max, Math.max(min, n))
}

function template(raw: unknown): string {
  return typeof raw === 'string' ? raw.slice(0, LOOKUP_LIMITS.maxTemplate) : raw === undefined || raw === null ? '' : String(raw).slice(0, LOOKUP_LIMITS.maxTemplate)
}

/** Clean a stored / submitted lookup config (unknown props dropped, columns validated, bounds clamped). */
export function normalizeLookupConfig(raw: unknown): LookupConfig {
  const src = isPlainObject(raw) ? raw : {}
  const source: LookupSource = src.source === 'reference' ? 'reference' : 'table'
  const out: LookupConfig = { source }
  if (source === 'table') {
    if (typeof src.table_id === 'string' && src.table_id.trim()) out.table_id = src.table_id.trim().slice(0, 64)
    const search = columnList(src.search_columns, isLookupColumn)
    const display = columnList(src.display_columns, isLookupColumn)
    if (search.length) out.search_columns = search
    if (display.length) out.display_columns = display
    if (src.match === 'prefix') out.match = 'prefix'
    if (isLookupColumn(src.value_column) && src.value_column !== LOOKUP_ROW_ID) out.value_column = src.value_column
    if (Array.isArray(src.filters)) {
      const filters: LookupFilter[] = []
      for (const f of src.filters) {
        if (!isPlainObject(f) || !isLookupColumn(f.column)) continue
        const operator = LOOKUP_FILTER_OPERATORS.includes(f.operator as LookupFilterOperator) ? f.operator as LookupFilterOperator : 'eq'
        const filter: LookupFilter = { column: f.column, operator }
        if (operator !== 'is_set' && operator !== 'is_not_set') filter.value = template(f.value)
        if (filters.length < LOOKUP_LIMITS.maxFilters) filters.push(filter)
      }
      if (filters.length) out.filters = filters
    }
    if (isPlainObject(src.sort) && isLookupColumn(src.sort.column)) {
      out.sort = { column: src.sort.column, direction: src.sort.direction === 'desc' ? 'desc' : 'asc' }
    }
  } else {
    if (typeof src.integration_id === 'string' && src.integration_id.trim()) out.integration_id = src.integration_id.trim().slice(0, 64)
    if (typeof src.reference_id === 'string' && src.reference_id.trim()) out.reference_id = src.reference_id.trim().slice(0, 64)
    if (isPlainObject(src.input_mappings)) {
      const mappings: Record<string, string> = {}
      for (const [name, value] of Object.entries(src.input_mappings).slice(0, 30)) {
        if (!/^[A-Za-z0-9_.$-]{1,100}$/.test(name) || name === '__proto__') continue
        const t = template(value)
        if (t) mappings[name] = t
      }
      if (Object.keys(mappings).length) out.input_mappings = mappings
    }
    const path = typeof src.results_path === 'string' ? src.results_path.trim().replace(/\[\]$/, '').replace(/\.$/, '') : ''
    if (path && isLookupPath(path)) out.results_path = path
    const display = columnList(src.display_fields, isLookupPath)
    if (display.length) out.display_fields = display
    if (isLookupPath(src.value_field)) out.value_field = src.value_field
    const debounce = intIn(src.debounce_ms, 0, LOOKUP_LIMITS.maxDebounceMs)
    if (debounce !== undefined && debounce !== LOOKUP_LIMITS.defaultDebounceMs) out.debounce_ms = debounce
    const ttl = intIn(src.cache_ttl_s, 0, LOOKUP_LIMITS.maxCacheTtlS)
    if (ttl) out.cache_ttl_s = ttl
  }
  const max = intIn(src.max_results, 1, LOOKUP_LIMITS.maxResults)
  if (max !== undefined && max !== LOOKUP_LIMITS.defaultMaxResults) out.max_results = max
  const minChars = intIn(src.min_chars, 0, LOOKUP_LIMITS.maxMinChars)
  if (minChars !== undefined && minChars !== LOOKUP_LIMITS.defaultMinChars) out.min_chars = minChars
  if (src.multiple === true) out.multiple = true
  if (src.allow_free_text === true) out.allow_free_text = true
  if (Array.isArray(src.fill)) {
    const fill: LookupFill[] = []
    for (const f of src.fill) {
      if (!isPlainObject(f)) continue
      const from = typeof f.from === 'string' ? f.from.trim() : ''
      const to = typeof f.to === 'string' ? f.to.trim() : ''
      const fromOk = source === 'table' ? isLookupColumn(from) : isLookupPath(from)
      if (fromOk && FIELD_KEY_RE.test(to) && !fill.some((x) => x.to === to) && fill.length < LOOKUP_LIMITS.maxFill) fill.push({ from, to })
    }
    if (fill.length) out.fill = fill
  }
  return out
}

export function lookupMaxResults(config: LookupConfig): number {
  return config.max_results ?? LOOKUP_LIMITS.defaultMaxResults
}

export function lookupMinChars(config: LookupConfig): number {
  return config.min_chars ?? LOOKUP_LIMITS.defaultMinChars
}

export function lookupDebounceMs(config: LookupConfig): number {
  return config.source === 'reference' ? (config.debounce_ms ?? LOOKUP_LIMITS.defaultDebounceMs) : 200
}

/** Display fields (columns or paths) of the config, in order. */
export function lookupDisplayFields(config: LookupConfig): string[] {
  return (config.source === 'table' ? config.display_columns : config.display_fields) ?? []
}

/** The field stored as the value (`row_id` = the data table row's id). */
export function lookupValueField(config: LookupConfig): string {
  return config.source === 'table' ? (config.value_column ?? LOOKUP_ROW_ID) : (config.value_field ?? '')
}

/** Every item field the server may return: display + value + fill sources (nothing else leaves the server). */
export function lookupItemFields(config: LookupConfig): string[] {
  const out: string[] = []
  for (const f of [...lookupDisplayFields(config), lookupValueField(config), ...(config.fill ?? []).map((x) => x.from)]) {
    if (f && !out.includes(f)) out.push(f)
  }
  return out
}

/** Columns the config touches (for validating against the table's columns). */
export function lookupTableColumns(config: LookupConfig): string[] {
  const out = new Set<string>([...(config.search_columns ?? []), ...(config.display_columns ?? []), ...(config.filters ?? []).map((f) => f.column), ...(config.fill ?? []).map((f) => f.from)])
  if (config.value_column) out.add(config.value_column)
  if (config.sort) out.add(config.sort.column)
  out.delete(LOOKUP_ROW_ID)
  return [...out]
}

/**
 * Problems with a lookup config the designer flags (and saves refuse):
 * missing source, columns or fields. `otherKeys` = the form's other value
 * field keys (fill targets must be one of them).
 */
export function lookupConfigProblem(config: LookupConfig | undefined, ownKey: string, otherKeys: string[]): string | null {
  if (!config) return 'Choose where the suggestions come from'
  if (config.source === 'table') {
    if (!config.table_id) return 'Choose a data table'
    if (!config.search_columns?.length) return 'Choose at least one column to search'
    if (!config.display_columns?.length) return 'Choose at least one column to show'
  } else {
    if (!config.reference_id) return 'Choose an API reference'
    if (!config.display_fields?.length) return 'Choose at least one field to show'
    if (!config.value_field) return 'Choose the field to store as the value'
  }
  for (const fill of config.fill ?? []) {
    if (fill.to === ownKey) return 'A lookup cannot fill itself'
    if (!otherKeys.includes(fill.to)) return `"Fill other fields" targets an unknown field "${fill.to}"`
  }
  return null
}

/* ── Items ───────────────────────────────────────────────────────────── */

/** Value at a dotted path of an object. */
export function pathValue(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const segment of path.split('.')) {
    if (!segment) continue
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let cursor = target
  for (let i = 0; i < parts.length - 1; i++) {
    const next = cursor[parts[i]]
    if (!isPlainObject(next)) cursor[parts[i]] = {}
    cursor = cursor[parts[i]] as Record<string, unknown>
  }
  cursor[parts[parts.length - 1]] = value
}

function scalar(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return typeof value === 'string' ? value.slice(0, 2000) : value
  }
  // Objects / arrays at a configured path: kept, size-bounded.
  try {
    const json = JSON.stringify(value)
    return json.length <= 4000 ? JSON.parse(json) : null
  } catch {
    return null
  }
}

export function displayText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') {
    try { return JSON.stringify(value).slice(0, 200) } catch { return '' }
  }
  return String(value).slice(0, 500)
}

/**
 * A suggestion from a source record (a data table row's `{ row_id, ...data }`, or
 * one API item): only the configured fields are kept. Null when the record
 * has no usable value.
 */
export function toLookupItem(config: LookupConfig, record: unknown): LookupItem | null {
  if (!isPlainObject(record)) {
    // An API returning a list of strings / numbers: the item is its own value and label.
    if (config.source === 'reference' && (typeof record === 'string' || typeof record === 'number')) {
      const s = String(record)
      return { value: s, label: s, fields: { value: record } }
    }
    return null
  }
  const valueField = lookupValueField(config)
  const rawValue = valueField ? pathValue(record, valueField) : undefined
  if (rawValue === null || rawValue === undefined || rawValue === '' || typeof rawValue === 'object') return null
  const fields: Record<string, unknown> = {}
  for (const path of lookupItemFields(config)) setPath(fields, path, scalar(pathValue(record, path)))
  const display = lookupDisplayFields(config)
  const texts = display.map((path) => displayText(pathValue(record, path))).filter(Boolean)
  const value = String(rawValue)
  const item: LookupItem = { value, label: texts[0] ?? value, fields }
  if (texts.length > 1) item.description = texts.slice(1).join(' · ')
  return item
}

/** The results array of a reference response (`results_path`, or the response / its first array). */
export function lookupResultsArray(config: LookupConfig, data: unknown): unknown[] {
  const at = config.results_path ? pathValue(data, config.results_path) : data
  if (Array.isArray(at)) return at
  // A single object at the path: one result.
  if (isPlainObject(at) && config.results_path) return [at]
  return []
}

/**
 * Values to fill into other fields from a selected item. Single lookups
 * only (a multi-select fills from the most recently added item).
 */
export function lookupFillValues(config: LookupConfig, item: LookupItem | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const fill of config.fill ?? []) {
    const v = item ? pathValue(item.fields, fill.from) : null
    out[fill.to] = v === undefined || v === null ? null : typeof v === 'object' ? displayText(v) : v
  }
  return out
}

/** Selected value(s) as a list (a single value, an array, JSON array text or a comma list for multi). */
export function lookupValues(value: unknown, multiple: boolean | undefined): string[] {
  if (value === null || value === undefined || value === '') return []
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    if (multiple && s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
      } catch { /* not JSON */ }
    }
    return [s]
  }
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)]
  return []
}

/* ── Templates (filters, reference inputs) ───────────────────────────── */

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]]+)\s*\}\}/g

/** Paths resolved at lookup time (the form's own values, the search text, the task); everything else is a workflow variable resolved when the task is created. */
export function isLookupTimePath(path: string): boolean {
  return /^(search|query|task_data|task|form)(\.|$)/.test(path)
}

/** Field keys a template refers to as {{task_data.<key>}} / {{form.<key>}} / {{task.data.<key>}}. */
export function templateFieldKeys(text: string): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(TEMPLATE_RE)) {
    const hit = /^(?:task_data|form|task\.data)\.([a-z0-9_]+)/.exec(m[1])
    if (hit && !out.includes(hit[1])) out.push(hit[1])
  }
  return out
}

/**
 * Replace the workflow-variable parts of a lookup template ({{order_region}},
 * {{=FUNC()}} are left to the caller's resolver via `resolve`) while keeping
 * lookup-time references ({{search}}, {{task_data.x}}…) for the lookup.
 * Used by the engine when it creates the task.
 */
export function preResolveLookupTemplate(text: string, resolve: (path: string) => unknown): string {
  if (!text || !text.includes('{{')) return text
  return text.replace(TEMPLATE_RE, (whole, path: string) => {
    if (isLookupTimePath(path)) return whole
    const value = resolve(path)
    if (value === undefined || value === null) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
}

/** Workflow-variable templates of a config resolved (see preResolveLookupTemplate). */
export function preResolveLookupConfig(config: LookupConfig, resolve: (path: string) => unknown): LookupConfig {
  const out: LookupConfig = { ...config }
  if (config.filters) out.filters = config.filters.map((f) => (f.value === undefined ? f : { ...f, value: preResolveLookupTemplate(f.value, resolve) }))
  if (config.input_mappings) {
    out.input_mappings = Object.fromEntries(Object.entries(config.input_mappings).map(([k, v]) => [k, preResolveLookupTemplate(v, resolve)]))
  }
  return out
}

/**
 * Resolve a lookup-time template against the search text and the form's
 * values: {{search}} / {{query}}, {{task_data.<key>}} / {{form.<key>}} /
 * {{task.data.<key>}}, {{task.<column>}} (title, id, priority…). A template
 * that is exactly one reference returns the raw value; unknown paths → ''.
 */
export function resolveLookupTemplate(text: string, scope: { search: string; values: Record<string, unknown>; task?: Record<string, unknown> | null }): unknown {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  const lookup = (path: string): unknown => {
    if (path === 'search' || path === 'query') return scope.search
    let m = /^(?:task_data|form|task\.data)\.(.+)$/.exec(path)
    if (m) return pathValue(scope.values, m[1])
    m = /^task\.(.+)$/.exec(path)
    if (m && scope.task) return pathValue(scope.task, m[1])
    return undefined
  }
  const whole = /^\{\{\s*([\w.\-[\]]+)\s*\}\}$/.exec(text.trim())
  if (whole) {
    const v = lookup(whole[1])
    return v === undefined ? '' : v
  }
  return text.replace(TEMPLATE_RE, (_m, path: string) => {
    const v = lookup(path)
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** Display label of a stored item (`<key>_item` entry): its first display field, else the value. */
export function storedItemLabel(config: LookupConfig | undefined, item: unknown, value: string): string {
  if (!config || !isPlainObject(item)) return value
  const texts = lookupDisplayFields(config).map((path) => displayText(pathValue(item, path))).filter(Boolean)
  return texts[0] ?? value
}

/** Stored `<key>_item` entries (object or array) by value. */
export function storedItemsByValue(config: LookupConfig | undefined, stored: unknown): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>()
  if (!config) return out
  const valueField = lookupValueField(config)
  for (const entry of Array.isArray(stored) ? stored : stored ? [stored] : []) {
    if (!isPlainObject(entry)) continue
    const v = pathValue(entry, valueField)
    if (v !== undefined && v !== null && typeof v !== 'object') out.set(String(v), entry)
  }
  return out
}
