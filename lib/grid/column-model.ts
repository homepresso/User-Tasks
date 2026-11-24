/**
 * The shared column model and cell rules of every editable grid: the Data
 * table control on forms (lib/forms/data-table.ts, `field.data_table`) and
 * the Data section's table grid views (custom_tables.views,
 * lib/services/data-table-views.ts). One definition per column:
 *
 *   { key, label, width, control, control_options, binding, editable,
 *     required, hidden, format }
 *
 *  - `control`: how the cell is shown and edited — the form controls that
 *    make sense in a cell (GRID_CONTROLS). Inferred from the column's data
 *    type (inferGridControl) until the designer picks another.
 *  - `binding` (dropdown, autocomplete, multi-select, lookup): the options
 *    come from a data table or an API reference — the Autocomplete field's
 *    lookup config (lib/forms/lookup.ts: filters with {{row.<column>}} /
 *    {{form.x}} values for cascading, sort, value and display columns, a
 *    display template, server-side search, response caching). The server
 *    runs it (lib/services/form-lookup.ts) — never the browser.
 *  - `editable` / `required` / `hidden`: what inline editing may change and
 *    must fill in. The server re-checks every write against the saved
 *    definition (gridCellWrite): a read-only, hidden, calculated or unknown
 *    column is refused even when the browser sends it.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { normalizeCellFormat, type CellFormat, type CellFormatKind } from '@/lib/formatting/cell-format'
import { normalizeLookupConfig, displayTemplateFields, type LookupConfig } from '@/lib/forms/lookup'
import { normalizeSignatureConfig, normalizeSignatureValue, type SignatureFieldConfig } from '@/lib/forms/media-fields'
import { normalizePeopleValue, type PersonRef } from '@/lib/forms/people-field'
import { sanitizeRichText, richTextPlainText } from '@/lib/forms/rich-text'
import { calculateColumn, type ListColumn } from '@/lib/forms/list-field'
import { GROUPABLE_TYPES, normalizeGroupBy } from '@/lib/grid/grouping'

/* ── Controls ────────────────────────────────────────────────────────── */

export type GridControl =
  | 'text' | 'multiline' | 'number' | 'currency' | 'date' | 'datetime' | 'boolean'
  | 'dropdown' | 'autocomplete' | 'multiselect' | 'people' | 'lookup'
  | 'signature' | 'file' | 'link' | 'rich_text' | 'display'

export const GRID_CONTROLS: GridControl[] = [
  'text', 'multiline', 'number', 'currency', 'date', 'datetime', 'boolean',
  'dropdown', 'autocomplete', 'multiselect', 'people', 'lookup',
  'signature', 'file', 'link', 'rich_text', 'display',
]

export const GRID_CONTROL_LABELS: Record<GridControl, string> = {
  text: 'Text', multiline: 'Multi-line text', number: 'Number', currency: 'Currency', date: 'Date', datetime: 'Date & time',
  boolean: 'Yes / no', dropdown: 'Dropdown', autocomplete: 'Autocomplete', multiselect: 'Multi-select', people: 'People picker',
  lookup: 'Lookup (search, two lines)', signature: 'Signature pad', file: 'File / attachment', link: 'Link', rich_text: 'Rich text',
  display: 'Calculated / read-only display',
}

/** Controls whose options may come from a data table or an API reference. */
export const BOUND_CONTROLS: ReadonlySet<GridControl> = new Set(['dropdown', 'autocomplete', 'multiselect', 'lookup'])
/** Controls that search the source as people type (server-side; large sources). */
export const SEARCH_CONTROLS: ReadonlySet<GridControl> = new Set(['autocomplete', 'lookup'])
/** Controls never written by inline editing. */
export const READ_ONLY_CONTROLS: ReadonlySet<GridControl> = new Set(['display'])
/** Controls whose value is an object or an array (stored as JSON). */
export const STRUCTURED_CONTROLS: ReadonlySet<GridControl> = new Set(['multiselect', 'people', 'signature', 'file'])

export function isGridControl(value: unknown): value is GridControl {
  return typeof value === 'string' && (GRID_CONTROLS as string[]).includes(value)
}

export const GRID_LIMITS = {
  columns: 40,
  views: 20,
  viewName: 80,
  choices: 200,
  choiceText: 200,
  multiselect: 50,
  text: 5000,
  richText: 20000,
  url: 2000,
  formula: 200,
  pageSize: 500,
  defaultPageSize: 100,
} as const

export interface GridChoice { value: string; label?: string }

/** Per-control options (only the ones the control reads are kept). */
export interface GridControlOptions {
  /** dropdown / multiselect without a binding: the allowed values (and labels). */
  choices?: GridChoice[]
  /** currency: ISO 4217 code (default USD). */
  currency?: string
  /** number / currency: bounds; text / multiline: length bounds (max = max_length). */
  min?: number
  max?: number
  max_length?: number
  /** number / currency: decimal places kept. */
  decimals?: number
  /** boolean: a checkbox (default) or a switch. */
  boolean_style?: 'checkbox' | 'toggle'
  /** people: several people / teams too. */
  multiple?: boolean
  allow_teams?: boolean
  /** display: arithmetic over the row's number columns (`quantity * unit_price`); empty = the stored value. */
  formula?: string
  placeholder?: string
  /** signature: draw / type / both, statement. */
  signature?: SignatureFieldConfig
}

/** One column of an editable grid (a Data grid view's column; a form Data table column maps onto it). */
export interface GridColumnDef {
  /** The data table column key (or an API item path on forms). */
  key: string
  label: string
  /** Width in px (a hint). */
  width?: number
  control: GridControl
  control_options?: GridControlOptions
  /** dropdown / autocomplete / multiselect / lookup: options from a data table or an API reference. */
  binding?: LookupConfig
  /** Inline editing may change it (default true; display columns never). */
  editable?: boolean
  required?: boolean
  /** Not drawn (kept for rules / bindings). */
  hidden?: boolean
  /** How the value is shown (lib/formatting/cell-format.ts); default from the control. */
  format?: CellFormat
}

/* ── Inference ───────────────────────────────────────────────────────── */

/**
 * The control a data type gets by default: Data table column types (text,
 * longtext, number, date, boolean, select, file, lookup), the form Data
 * table column types (choice, datetime) and response-model hints.
 */
export function inferGridControl(type: string | undefined): GridControl {
  switch (String(type ?? '').toLowerCase()) {
    case 'longtext': case 'textarea': case 'multiline': return 'multiline'
    case 'number': case 'integer': case 'float': case 'decimal': return 'number'
    case 'currency': case 'money': return 'currency'
    case 'date': return 'date'
    case 'datetime': case 'timestamp': case 'date-time': return 'datetime'
    case 'boolean': case 'bool': return 'boolean'
    case 'select': case 'choice': case 'enum': return 'dropdown'
    case 'multiselect': case 'multi_select': case 'array': return 'multiselect'
    case 'file': case 'attachment': return 'file'
    case 'lookup': return 'dropdown'
    case 'url': case 'link': case 'email': return 'link'
    case 'signature': return 'signature'
    case 'user': case 'people': case 'person': return 'people'
    case 'rich_text': case 'html': return 'rich_text'
    default: return 'text'
  }
}

/** The controls that suit a data type (the designer offers these first; any control may be picked). */
export function controlsForType(type: string | undefined): GridControl[] {
  const inferred = inferGridControl(type)
  const byFamily: Record<string, GridControl[]> = {
    text: ['text', 'multiline', 'dropdown', 'autocomplete', 'lookup', 'link', 'rich_text', 'display'],
    multiline: ['multiline', 'text', 'rich_text', 'display'],
    number: ['number', 'currency', 'dropdown', 'autocomplete', 'display'],
    currency: ['currency', 'number', 'display'],
    date: ['date', 'datetime', 'display'],
    datetime: ['datetime', 'date', 'display'],
    boolean: ['boolean', 'display'],
    dropdown: ['dropdown', 'autocomplete', 'lookup', 'multiselect', 'text', 'display'],
    multiselect: ['multiselect', 'display'],
    file: ['file', 'signature', 'display'],
    link: ['link', 'text', 'display'],
    signature: ['signature', 'display'],
    people: ['people', 'display'],
    rich_text: ['rich_text', 'multiline', 'display'],
  }
  return byFamily[inferred] ?? [inferred]
}

/** The display format a control gets when none is picked. */
export function defaultControlFormat(control: GridControl): CellFormatKind {
  switch (control) {
    case 'number': return 'number'
    case 'currency': return 'currency'
    case 'date': return 'date'
    case 'datetime': return 'datetime'
    case 'boolean': return 'boolean'
    case 'link': return 'link'
    default: return 'text'
  }
}

/**
 * A Data table "lookup" column's legacy config (components/data/lookup-config.ts:
 * sourceTableId, sourceColumn, filters, sortBy) as a binding: the source
 * column is both the value and the display.
 */
export function legacyLookupBinding(raw: unknown): LookupConfig | undefined {
  if (!isPlainObject(raw) || typeof raw.sourceTableId !== 'string' || typeof raw.sourceColumn !== 'string') return undefined
  const ops: Record<string, string> = { equals: 'eq', not_equals: 'neq', contains: 'contains', is_empty: 'is_not_set', not_empty: 'is_set' }
  const column = slug(raw.sourceColumn)
  const filters = Array.isArray(raw.filters)
    ? raw.filters.filter(isPlainObject).filter((f) => typeof f.column === 'string' && ops[String(f.operator)]).map((f) => ({ column: slug(String(f.column)), operator: ops[String(f.operator)], value: f.value }))
    : []
  return normalizeLookupConfig({
    source: 'table', table_id: raw.sourceTableId, value_column: column, display_columns: [column], search_columns: [column],
    filters, sort: typeof raw.sortBy === 'string' && raw.sortBy ? { column: slug(raw.sortBy), direction: raw.sortDir === 'desc' ? 'desc' : 'asc' } : { column, direction: 'asc' },
    min_chars: 0, max_results: 50,
  })
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

/** A Data table schema column (custom_tables.columns entry) as seen by the grid. */
export interface TableSchemaColumn {
  key: string
  name: string
  type: string
  options?: string[]
  required?: boolean
  lookup?: unknown
}

/** System columns the grid shows in its own Row / Last edited columns, never as editable cells. */
export const SYSTEM_COLUMN_KEYS: ReadonlySet<string> = new Set(['id', 'date_created'])

/** custom_tables.columns → schema columns (canonical keys; legacy name-only columns get the slug). */
export function schemaColumns(raw: unknown): TableSchemaColumn[] {
  if (!Array.isArray(raw)) return []
  const out: TableSchemaColumn[] = []
  for (const c of raw) {
    if (!isPlainObject(c)) continue
    const name = String(c.name ?? c.label ?? c.key ?? '').trim()
    const key = String(c.key ?? '').trim() || slug(name)
    if (!key || out.some((x) => x.key === key)) continue
    out.push({
      key, name: name || key, type: String(c.type ?? 'text'),
      ...(Array.isArray(c.options) ? { options: c.options.map(String) } : {}),
      ...(c.required === true ? { required: true } : {}),
      ...(c.lookup !== undefined ? { lookup: c.lookup } : {}),
    })
  }
  return out
}

/** The column a schema column gets by default (control inferred, select choices / lookup binding carried over, editable). */
export function inferredColumn(col: TableSchemaColumn): GridColumnDef {
  const control = inferGridControl(col.type)
  const out: GridColumnDef = { key: col.key, label: col.name, control }
  if (control === 'dropdown' && col.options?.length) out.control_options = { choices: col.options.slice(0, GRID_LIMITS.choices).map((value) => ({ value })) }
  if (col.type === 'lookup') { const binding = legacyLookupBinding(col.lookup); if (binding) out.binding = binding }
  if (col.required) out.required = true
  if (SYSTEM_COLUMN_KEYS.has(col.key)) out.editable = false
  return out
}

/** Every custom column of a table, inferred (the default view). */
export function defaultGridColumns(columns: TableSchemaColumn[]): GridColumnDef[] {
  return columns.filter((c) => !SYSTEM_COLUMN_KEYS.has(c.key)).slice(0, GRID_LIMITS.columns).map(inferredColumn)
}

/* ── Normalisation ───────────────────────────────────────────────────── */

function finite(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function text(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

/** Clean control options: only what `control` reads, bounded. */
export function normalizeControlOptions(control: GridControl, raw: unknown): GridControlOptions | undefined {
  const src = isPlainObject(raw) ? raw : {}
  const out: GridControlOptions = {}
  if ((control === 'dropdown' || control === 'multiselect') && Array.isArray(src.choices)) {
    const seen = new Set<string>()
    const choices: GridChoice[] = []
    for (const c of src.choices) {
      const value = typeof c === 'string' || typeof c === 'number' ? String(c).trim() : isPlainObject(c) ? String(c.value ?? '').trim() : ''
      if (!value || seen.has(value) || choices.length >= GRID_LIMITS.choices) continue
      seen.add(value)
      const label = isPlainObject(c) ? text(c.label, GRID_LIMITS.choiceText) : undefined
      choices.push({ value: value.slice(0, GRID_LIMITS.choiceText), ...(label && label !== value ? { label } : {}) })
    }
    if (choices.length) out.choices = choices
  }
  if (control === 'currency') {
    const code = typeof src.currency === 'string' ? src.currency.trim().toUpperCase() : ''
    if (/^[A-Z]{3}$/.test(code) && code !== 'USD') out.currency = code
  }
  if (control === 'number' || control === 'currency') {
    const min = finite(src.min); const max = finite(src.max)
    if (min !== undefined) out.min = min
    if (max !== undefined) out.max = max
    const decimals = finite(src.decimals)
    if (decimals !== undefined) out.decimals = Math.min(10, Math.max(0, Math.floor(decimals)))
  }
  if (control === 'text' || control === 'multiline' || control === 'link') {
    const maxLength = finite(src.max_length)
    if (maxLength !== undefined) out.max_length = Math.min(GRID_LIMITS.text, Math.max(1, Math.floor(maxLength)))
  }
  if (control === 'boolean' && src.boolean_style === 'toggle') out.boolean_style = 'toggle'
  if (control === 'people') {
    if (src.multiple === true) out.multiple = true
    if (src.allow_teams === true) out.allow_teams = true
  }
  if (control === 'display') {
    const formula = text(src.formula, GRID_LIMITS.formula)
    if (formula && /^[\w\s+\-*/().]+$/.test(formula)) out.formula = formula
  }
  if (control === 'signature' && src.signature !== undefined) {
    const sig = normalizeSignatureConfig(src.signature)
    if (Object.keys(sig).length) out.signature = sig
  }
  const placeholder = text(src.placeholder, 120)
  if (placeholder && control !== 'boolean' && control !== 'display' && control !== 'signature') out.placeholder = placeholder
  return Object.keys(out).length ? out : undefined
}

/** Clean a binding: the lookup config (lib/forms/lookup.ts); null when it names no source. */
export function normalizeBinding(raw: unknown): LookupConfig | undefined {
  if (!isPlainObject(raw)) return undefined
  const config = normalizeLookupConfig(raw)
  // A connected list (an extension's lookup source, e.g. a SharePoint list) needs its extension, provider and list.
  if (config.source === 'table' ? !config.table_id : config.source === 'extension' ? !(config.extension && config.provider && config.source_id) : !config.reference_id) return undefined
  return config
}

/**
 * A binding as its control uses it: a dropdown / multi-select lists the
 * source's options without typing (min_chars 0, up to 50 at once); an
 * autocomplete / lookup searches as people type (its own minimum).
 */
export function bindingForControl(control: GridControl, binding: LookupConfig | undefined): LookupConfig | undefined {
  if (!binding) return undefined
  if (control === 'dropdown' || control === 'multiselect') return { ...binding, min_chars: 0, max_results: binding.max_results ?? 50, multiple: undefined, fill: undefined }
  return { ...binding, multiple: undefined, fill: undefined }
}

const KEY_RE = /^[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,7}$/

/** Clean one column definition (unknown props dropped, bounded). Null when the key is invalid. */
export function normalizeGridColumn(raw: unknown, options: { fallbackControl?: GridControl } = {}): GridColumnDef | null {
  if (!isPlainObject(raw) || typeof raw.key !== 'string' || !KEY_RE.test(raw.key) || /(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(raw.key)) return null
  const control: GridControl = isGridControl(raw.control) ? raw.control : options.fallbackControl ?? 'text'
  const col: GridColumnDef = { key: raw.key, label: text(raw.label, 120) ?? raw.key, control }
  const width = finite(raw.width)
  if (width !== undefined) col.width = Math.min(800, Math.max(40, Math.floor(width)))
  const opts = normalizeControlOptions(control, raw.control_options)
  if (opts) col.control_options = opts
  if (BOUND_CONTROLS.has(control)) {
    const binding = bindingForControl(control, normalizeBinding(raw.binding))
    if (binding) col.binding = JSON.parse(JSON.stringify(binding))
  }
  if (raw.editable === false || READ_ONLY_CONTROLS.has(control)) col.editable = false
  if (raw.required === true && !READ_ONLY_CONTROLS.has(control)) col.required = true
  if (raw.hidden === true) col.hidden = true
  if (raw.format !== undefined && raw.format !== null) {
    const format = normalizeCellFormat(raw.format, defaultControlFormat(control))
    if (format.kind !== defaultControlFormat(control) || Object.keys(format).length > 1) col.format = format
  }
  return col
}

/* ── Data grid views ─────────────────────────────────────────────────── */

/** A saved view of a Data table's grid (custom_tables.views). */
export interface GridViewConfig {
  /** Stable id (`v_…`). */
  id: string
  name: string
  columns: GridColumnDef[]
  /** Allow inline editing (all rows): cells of editable columns edit in place, saved per cell. */
  inline_edit?: boolean
  /** With inline editing: the grid opens in "Edit all rows" mode (every row's cells editable at once, saved as one batch). */
  open_in_edit_mode?: boolean
  /** Add / delete rows from the grid. */
  allow_add?: boolean
  allow_delete?: boolean
  /** Rows per page (server-side paging). */
  page_size?: number
  /** The view the grid opens on. */
  default?: boolean
  /** Group the rows by these column keys (up to two levels; lib/grid/grouping.ts). */
  group_by?: string[]
}

const VIEW_ID_RE = /^[A-Za-z0-9_-]{1,40}$/

/** A new view id. */
export function newViewId(): string {
  return `v_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

/**
 * Clean a table's views: ids unique, columns limited to the table's
 * columns (a column removed from the schema drops out), one default.
 * `tableColumns` omitted: the column keys are not checked (tests, imports).
 */
export function normalizeGridViews(raw: unknown, tableColumns?: TableSchemaColumn[]): GridViewConfig[] {
  if (!Array.isArray(raw)) return []
  const known = tableColumns ? new Map(tableColumns.map((c) => [c.key, c])) : null
  const out: GridViewConfig[] = []
  const ids = new Set<string>()
  for (const entry of raw) {
    if (!isPlainObject(entry) || out.length >= GRID_LIMITS.views) continue
    const id = typeof entry.id === 'string' && VIEW_ID_RE.test(entry.id) && !ids.has(entry.id) ? entry.id : newViewId()
    ids.add(id)
    const columns: GridColumnDef[] = []
    for (const c of Array.isArray(entry.columns) ? entry.columns : []) {
      const schema = known && isPlainObject(c) ? known.get(String(c.key)) : undefined
      if (known && !schema) continue
      const col = normalizeGridColumn(c, { fallbackControl: schema ? inferGridControl(schema.type) : undefined })
      if (!col || columns.some((x) => x.key === col.key) || columns.length >= GRID_LIMITS.columns) continue
      if (schema && SYSTEM_COLUMN_KEYS.has(schema.key)) col.editable = false
      columns.push(col)
    }
    const view: GridViewConfig = { id, name: text(entry.name, GRID_LIMITS.viewName) ?? 'View', columns }
    if (entry.inline_edit === true) view.inline_edit = true
    if (entry.inline_edit === true && entry.open_in_edit_mode === true) view.open_in_edit_mode = true
    if (entry.allow_add === true) view.allow_add = true
    if (entry.allow_delete === true) view.allow_delete = true
    const pageSize = finite(entry.page_size)
    if (pageSize !== undefined && pageSize !== GRID_LIMITS.defaultPageSize) view.page_size = Math.min(GRID_LIMITS.pageSize, Math.max(10, Math.floor(pageSize)))
    if (entry.default === true && !out.some((v) => v.default)) view.default = true
    const groupBy = normalizeGroupBy(entry.group_by, known ? new Set([...known.values()].filter((c) => GROUPABLE_TYPES.has(c.type)).map((c) => c.key)) : undefined)
    if (groupBy.length) view.group_by = groupBy
    out.push(view)
  }
  return out
}

/** The default view of a table without saved views: every custom column, inferred; inline editing off. */
export function builtInView(tableColumns: TableSchemaColumn[]): GridViewConfig {
  return { id: 'default', name: 'All columns', columns: defaultGridColumns(tableColumns) }
}

/** The view to show: the one asked for, else the default one, else the first, else the built-in one. */
export function pickView(views: GridViewConfig[], viewId: string | null | undefined, tableColumns: TableSchemaColumn[]): GridViewConfig {
  return views.find((v) => v.id === viewId) ?? views.find((v) => v.default) ?? views[0] ?? builtInView(tableColumns)
}

/** Whether people may change this column's cells inline. */
export function isColumnEditable(col: Pick<GridColumnDef, 'control' | 'editable' | 'hidden'>): boolean {
  return col.editable !== false && !col.hidden && !READ_ONLY_CONTROLS.has(col.control)
}

/** Problems the designer flags (and saves refuse). */
export function gridColumnProblem(col: GridColumnDef): string | null {
  if (BOUND_CONTROLS.has(col.control) && !col.binding && col.control !== 'autocomplete' && col.control !== 'lookup' && !(col.control_options?.choices ?? []).length) {
    return `Column "${col.label}": add the choices or bind it to a data table or an API reference`
  }
  if ((col.control === 'autocomplete' || col.control === 'lookup') && !col.binding) return `Column "${col.label}": bind it to a data table or an API reference`
  const o = col.control_options
  if (o?.min !== undefined && o?.max !== undefined && o.min > o.max) return `Column "${col.label}": minimum is greater than maximum`
  return null
}

export function gridViewProblem(view: GridViewConfig): string | null {
  if (!view.columns.length) return `View "${view.name}": choose at least one column`
  for (const col of view.columns) {
    const problem = gridColumnProblem(col)
    if (problem) return `View "${view.name}": ${problem}`
  }
  return null
}

/* ── Bindings ────────────────────────────────────────────────────────── */

const ROW_TEMPLATE_RE = /\{\{\s*row\.([A-Za-z0-9_$.-]+)\s*\}\}/g

/** Columns of the same row a binding reads ({{row.<column>}}): a change to them re-queries (cascading) and clears this cell. */
export function bindingRowDependencies(binding: LookupConfig | undefined): string[] {
  if (!binding) return []
  const texts = [...(binding.filters ?? []).map((f) => f.value ?? ''), ...Object.values(binding.input_mappings ?? {})]
  const out: string[] = []
  for (const t of texts) for (const m of String(t).matchAll(ROW_TEMPLATE_RE)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Form fields a binding reads ({{form.x}} / {{task_data.x}}): sent with each query. */
export function bindingFormDependencies(binding: LookupConfig | undefined): string[] {
  if (!binding) return []
  const texts = [...(binding.filters ?? []).map((f) => f.value ?? ''), ...Object.values(binding.input_mappings ?? {})]
  const out: string[] = []
  for (const t of texts) for (const m of String(t).matchAll(/\{\{\s*(?:form|task_data)\.([a-z0-9_]+)/g)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/** Columns that depend on `changed` (directly) — cleared when it changes. */
export function dependentColumns(columns: GridColumnDef[], changed: string): string[] {
  return columns.filter((c) => c.key !== changed && bindingRowDependencies(c.binding).includes(changed)).map((c) => c.key)
}

/** A stable cache key for one binding query (the column, its row / form inputs and the typed text). */
export function bindingCacheKey(scope: string, column: string, binding: LookupConfig | undefined, inputs: Record<string, unknown>, query: string): string {
  return JSON.stringify([scope, column, binding?.source, binding?.table_id ?? binding?.reference_id ?? '', inputs, query])
}

/** How long a binding's options are reused in the browser (ms): the reference's cache_ttl_s, else 60 s. */
export function bindingClientTtl(binding: LookupConfig | undefined): number {
  return Math.max(5, binding?.cache_ttl_s ?? 60) * 1000
}

/** Display columns / fields a binding shows (template placeholders included). */
export function bindingDisplayFields(binding: LookupConfig | undefined): string[] {
  if (!binding) return []
  const shown = binding.source === 'reference' ? binding.display_fields ?? [] : binding.display_columns ?? []
  return [...new Set([...shown, ...displayTemplateFields(binding.label_template)])]
}

/** Whether a control holds several values. */
export function isMultiValue(col: Pick<GridColumnDef, 'control' | 'control_options'>): boolean {
  return col.control === 'multiselect' || (col.control === 'people' && col.control_options?.multiple === true)
}

/* ── Values ──────────────────────────────────────────────────────────── */

/** A file a cell holds (a Data table upload { name, url, size, path } or a form attachment). */
export interface GridFileValue { name: string; url: string; size?: number; path?: string; id?: string; mime_type?: string }

export function normalizeFileValue(raw: unknown): GridFileValue | null {
  if (!isPlainObject(raw)) return null
  const url = typeof raw.url === 'string' ? raw.url.trim() : ''
  if (!url || url.length > GRID_LIMITS.url || !(url.startsWith('/') || /^https?:\/\//i.test(url)) || url.startsWith('//')) return null
  const out: GridFileValue = { name: String(raw.name ?? 'File').slice(0, 255), url }
  const size = finite(raw.size)
  if (size !== undefined && size >= 0) out.size = Math.floor(size)
  if (typeof raw.path === 'string' && raw.path.length <= 1000) out.path = raw.path
  if (typeof raw.id === 'string' && raw.id.length <= 64) out.id = raw.id
  if (typeof raw.mime_type === 'string' && raw.mime_type.length <= 200) out.mime_type = raw.mime_type
  return out
}

/**
 * A signature a cell holds: the form Signature value (its PNG an upload of
 * the form, stamped by the server) or, in the Data grid, the PNG stored as
 * a table file with who signed and when.
 */
export interface GridSignatureValue {
  file: GridFileValue
  method: 'draw' | 'type'
  typed_name?: string
  signed_at: string
  user_id?: string
  user_name?: string
}

export function normalizeGridSignature(raw: unknown): GridSignatureValue | null {
  const formSig = normalizeSignatureValue(raw)
  if (formSig) return formSig as unknown as GridSignatureValue
  let v = raw
  if (typeof v === 'string' && v.trim().startsWith('{')) { try { v = JSON.parse(v) } catch { return null } }
  if (!isPlainObject(v)) return null
  const file = normalizeFileValue(v.file)
  if (!file || (v.method !== 'draw' && v.method !== 'type')) return null
  const out: GridSignatureValue = { file, method: v.method, signed_at: typeof v.signed_at === 'string' ? v.signed_at.slice(0, 40) : '' }
  const typed = text(v.typed_name, 200)
  if (typed) out.typed_name = typed
  for (const key of ['user_id', 'user_name'] as const) { const t = text(v[key], 200); if (t) out[key] = t }
  return out
}

function isBlank(raw: unknown): boolean {
  return raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '') || (Array.isArray(raw) && raw.length === 0)
}

/** A safe link: http(s), mailto: or tel: (no scripts, no protocol-relative). */
export function safeLink(raw: string): string | null {
  const s = raw.trim()
  if (!s || s.length > GRID_LIMITS.url) return null
  if (/^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s)) return s
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(s)) return s
  if (/^tel:\+?[0-9 ()-]{3,30}$/i.test(s)) return s
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(s)) return `https://${s}`
  return null
}

/**
 * One cell coerced to its control's value, or the error people see. Blank →
 * null (false for a yes / no); `required` blank → error. A bound value is
 * only shape-checked here — the server confirms it is one of the source's
 * options (lib/services/data-table-views.ts, verifyBoundCells).
 */
export function coerceGridValue(col: GridColumnDef, raw: unknown): { value: unknown } | { error: string } {
  const label = col.label
  const o = col.control_options ?? {}
  if (READ_ONLY_CONTROLS.has(col.control)) return { error: `${label} is calculated and can't be edited` }
  if (isBlank(raw)) {
    if (col.control === 'boolean') return { value: false }
    if (col.required) return { error: `${label} is required` }
    return { value: col.control === 'multiselect' ? [] : null }
  }
  switch (col.control) {
    case 'text': case 'multiline': {
      if (typeof raw === 'object') return { error: `${label} has an invalid value` }
      const s = String(raw)
      if (s.length > (o.max_length ?? GRID_LIMITS.text)) return { error: `${label} is too long` }
      return { value: col.control === 'text' ? s.replace(/[\r\n]+/g, ' ') : s }
    }
    case 'link': {
      if (typeof raw !== 'string') return { error: `${label} must be a link` }
      const href = safeLink(raw)
      if (!href) return { error: `${label} must be a web address (https://…), an email or a phone number` }
      if (href.length > (o.max_length ?? GRID_LIMITS.url)) return { error: `${label} is too long` }
      return { value: href }
    }
    case 'number': case 'currency': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/[,\s]/g, '').replace(/^[$€£¥]/, ''))
      if (!Number.isFinite(n)) return { error: `${label} must be a number` }
      if (o.min !== undefined && n < o.min) return { error: `${label} must be at least ${o.min}` }
      if (o.max !== undefined && n > o.max) return { error: `${label} must be at most ${o.max}` }
      const decimals = o.decimals ?? (col.control === 'currency' ? 2 : undefined)
      return { value: decimals === undefined ? n : Math.round(n * 10 ** decimals) / 10 ** decimals }
    }
    case 'date': {
      const s = String(raw).trim()
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(new Date(s.slice(0, 10)).getTime())) return { error: `${label} must be a date (YYYY-MM-DD)` }
      return { value: s.slice(0, 10) }
    }
    case 'datetime': {
      const d = new Date(String(raw).trim())
      return Number.isNaN(d.getTime()) ? { error: `${label} must be a date and time` } : { value: d.toISOString() }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw }
      const s = String(raw).trim().toLowerCase()
      if (['true', '1', 'yes', 'y', 'on'].includes(s)) return { value: true }
      if (['false', '0', 'no', 'n', 'off'].includes(s)) return { value: false }
      return { error: `${label} must be yes or no` }
    }
    case 'dropdown': case 'autocomplete': case 'lookup': {
      if (typeof raw === 'object') return { error: `${label} has an invalid value` }
      const s = String(raw).trim().slice(0, 1000)
      if (!col.binding && o.choices?.length && !o.choices.some((c) => c.value === s)) return { error: `${label} must be one of: ${o.choices.map((c) => c.label ?? c.value).join(', ')}` }
      return { value: typeof raw === 'number' && !col.binding ? raw : s }
    }
    case 'multiselect': {
      const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [raw]
      const values = [...new Set(list.map((v) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '')).filter(Boolean))]
      if (values.length !== list.filter((v) => !(typeof v === 'string' && !v.trim())).length && list.some((v) => typeof v === 'object')) return { error: `${label} has an invalid value` }
      if (values.length > GRID_LIMITS.multiselect) return { error: `${label}: choose at most ${GRID_LIMITS.multiselect}` }
      if (!col.binding && o.choices?.length) {
        const bad = values.find((v) => !o.choices!.some((c) => c.value === v))
        if (bad) return { error: `${label}: "${bad.slice(0, 60)}" is not one of the choices` }
      }
      if (col.required && !values.length) return { error: `${label} is required` }
      return { value: values.map((v) => v.slice(0, 1000)) }
    }
    case 'people': {
      const refs: PersonRef[] = normalizePeopleValue(raw)
      if (!refs.length) return { error: `${label} must name a person` }
      if (!o.allow_teams && refs.some((r) => r.kind === 'team')) return { error: `${label} takes people, not teams` }
      if (!o.multiple) return { value: refs.slice(0, 1) }
      return { value: refs.slice(0, 100) }
    }
    case 'signature': {
      const sig = normalizeGridSignature(raw)
      return sig ? { value: sig } : { error: `${label} is not a valid signature` }
    }
    case 'file': {
      const file = normalizeFileValue(raw)
      return file ? { value: file } : { error: `${label} is not a valid file` }
    }
    case 'rich_text': {
      const html = sanitizeRichText(raw)
      if (html.length > GRID_LIMITS.richText) return { error: `${label} is too long` }
      if (col.required && !richTextPlainText(html)) return { error: `${label} is required` }
      return { value: html || null }
    }
    default:
      return { error: `${label} has an invalid value` }
  }
}

/** A calculated display column's value for a row (null when the formula can't be worked out or there is none). */
export function calculatedValue(col: GridColumnDef, row: Record<string, unknown>): number | null {
  const formula = col.control === 'display' ? col.control_options?.formula : undefined
  if (!formula) return null
  return calculateColumn({ key: col.key, label: col.label, type: 'calculated', formula } as ListColumn, row)
}

/** Same value (blank equals blank; numbers by value; the rest by JSON). */
export function sameGridValue(a: unknown, b: unknown): boolean {
  if (isBlank(a) && isBlank(b)) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  return String(a) === String(b)
}

/* ── Inline writes (server-enforced) ─────────────────────────────────── */

export interface GridCellWriteResult {
  /** The coerced cells to store (canonical keys). */
  cells: Record<string, unknown>
  /** column key → message (read-only, unknown, invalid). */
  errors: Record<string, string>
}

/**
 * Check one row's inline edit against the saved view (the server's gate):
 * the view must allow inline editing; every cell must be a column of the
 * view that is editable (not read-only, hidden or calculated) and must fit
 * its control. Anything else is refused — never silently written.
 */
export function gridCellWrite(view: Pick<GridViewConfig, 'columns' | 'inline_edit'>, cells: Record<string, unknown>): GridCellWriteResult {
  const errors: Record<string, string> = {}
  const out: Record<string, unknown> = {}
  if (!isPlainObject(cells)) return { cells: {}, errors: { _: 'The cells are not in the expected shape' } }
  if (!view.inline_edit) return { cells: {}, errors: { _: 'Inline editing is turned off for this view' } }
  const byKey = new Map(view.columns.map((c) => [c.key, c]))
  const keys = Object.keys(cells)
  if (!keys.length) return { cells: {}, errors: { _: 'No cells to save' } }
  if (keys.length > GRID_LIMITS.columns) return { cells: {}, errors: { _: 'Too many cells at once' } }
  for (const key of keys) {
    const col = byKey.get(key)
    if (!col) { errors[key] = `"${key.slice(0, 64)}" is not a column of this view`; continue }
    if (!isColumnEditable(col) || SYSTEM_COLUMN_KEYS.has(col.key)) { errors[key] = `${col.label} is read-only`; continue }
    const coerced = coerceGridValue(col, cells[key])
    if ('error' in coerced) { errors[key] = coerced.error; continue }
    out[key] = coerced.value
  }
  return { cells: out, errors }
}

/** A row's version for the last-write-wins check (updated_at, else created_at), as epoch ms; null when unknown. */
export function rowVersion(row: { updated_at?: string | null; created_at?: string | null } | null | undefined): number | null {
  const raw = row?.updated_at ?? row?.created_at
  if (!raw) return null
  const t = Date.parse(String(raw))
  return Number.isNaN(t) ? null : t
}

/** Whether the row changed since the browser read it (`expected` = the updated_at it read). */
export function isStaleWrite(expected: string | null | undefined, current: { updated_at?: string | null; created_at?: string | null }): boolean {
  if (!expected) return false
  const want = Date.parse(expected)
  const have = rowVersion(current)
  if (Number.isNaN(want) || have === null) return false
  return want !== have
}

/** The friendly conflict message (who changed it, when known). */
export function conflictMessage(by?: string | null): string {
  return `${by ? `${by} changed` : 'Someone else changed'} this row after you opened it. Your edit was not saved — the latest values are shown; make your change again.`
}

/* ── Forms: a Data table column as a grid column ─────────────────────── */

/** The minimal shape of a form Data table column (lib/forms/data-table.ts) the engine reads. */
export interface FormTableColumnLike {
  key: string
  label: string
  type: string
  control?: GridControl
  control_options?: GridControlOptions
  binding?: LookupConfig
  read_only?: boolean
  required?: boolean
  hidden?: boolean
  options?: string[]
  min?: number
  max?: number
  max_length?: number
  width?: number
  format?: CellFormat
}

/** A form Data table column as a grid column (its control, or the one its type implies). */
export function gridColumnFromForm(col: FormTableColumnLike): GridColumnDef {
  const control = col.control ?? inferGridControl(col.type)
  const fromType: GridControlOptions = {}
  if (col.options?.length) fromType.choices = col.options.map((value) => ({ value }))
  if (col.min !== undefined) fromType.min = col.min
  if (col.max !== undefined) fromType.max = col.max
  if (col.max_length !== undefined) fromType.max_length = col.max_length
  const options = { ...fromType, ...(col.control_options ?? {}) }
  return {
    key: col.key, label: col.label, control,
    ...(Object.keys(options).length ? { control_options: options } : {}),
    ...(col.binding ? { binding: col.binding } : {}),
    ...(col.read_only ? { editable: false } : {}),
    ...(col.required ? { required: true } : {}),
    ...(col.hidden ? { hidden: true } : {}),
    ...(col.width ? { width: col.width } : {}),
    ...(col.format ? { format: col.format } : {}),
  }
}

/** Whether a form column's control differs from what its type implies (the engine then decides editing and coercion). */
export function hasCustomControl(col: Pick<FormTableColumnLike, 'type' | 'control'>): boolean {
  return Boolean(col.control) && col.control !== inferGridControl(col.type)
}
