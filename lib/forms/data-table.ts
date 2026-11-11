/**
 * Data table fields (field type `data_table`): a table on the form whose rows
 * come from a workspace data table or an API reference / connector
 * operation, with search, per-column filters, sort and paging — run on the
 * server — and three modes:
 *
 *   display   read-only rows (the field holds no value)
 *   select    pick one or several rows: the value is the selected rows
 *   edit      inline cell edit, add / delete rows: the value is the change set
 *             `{ added, updated: [{ key, before, after, changed_fields }], deleted }`
 *
 * The config lives on the field (`field.data_table`), so it travels with the
 * form (versions, exports, packages; `table_id` / `reference_id` /
 * `integration_id` are remapped by the generic id remap). The author decides
 * everything the server runs:
 *
 *  - the columns fetched (projection) — nothing else ever leaves the server;
 *  - which columns end users may filter and sort on;
 *  - a base filter (AND / OR groups of conditions; values are constants or
 *    {{form.x}}, {{user.id|email|name}}, {{today}}, {{now}}, {{today+7d}}…);
 *  - the default sort (several columns) and the page size.
 *
 * The browser only sends the field key, the typed search, its own column
 * filters / sort / page and the form's values (for {{form.x}}). The server
 * reads the config from the SAVED form (lib/services/form-data-table.ts) and
 * ANDs the user's conditions onto the base filter, so a user can only
 * narrow the results, never widen them.
 *
 * Pure and isomorphic: config, query normalization, filter building, local
 * query evaluation (API sources), change-set validation and formatting.
 */

import { rowDraftState } from './row-markers'
import { isPlainObject } from '@/lib/utils/guards'
import { pathValue } from './lookup'
import { CONTROLS_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY, formContextPath } from './form-params'
import { isCollectionPath, normalizeCollectionPath } from '@/lib/response-collections'
import { defaultFormatKind, formatCellValue, isLocale, normalizeCellFormat, type CellFormat, type CellFormatKind, type FormattedCell } from '@/lib/formatting/cell-format'

export type DataTableSource = 'table' | 'reference'
export type DataTableMode = 'display' | 'select' | 'edit'
export type DataTableColumnType = 'text' | 'number' | 'date' | 'datetime' | 'choice' | 'boolean'

export const DATA_TABLE_MODES: DataTableMode[] = ['display', 'select', 'edit']
export const DATA_TABLE_MODE_LABELS: Record<DataTableMode, string> = { display: 'Read-only', select: 'Select rows', edit: 'Editable' }
export const DATA_TABLE_COLUMN_TYPES: DataTableColumnType[] = ['text', 'number', 'date', 'datetime', 'choice', 'boolean']
export const DATA_TABLE_COLUMN_TYPE_LABELS: Record<DataTableColumnType, string> = { text: 'Text', number: 'Number', date: 'Date', datetime: 'Date & time', choice: 'Choice', boolean: 'Yes / no' }

export interface DataTableColumn {
  /** Data table column key, or the item field path of an API result. */
  key: string
  label: string
  /** The value's type (editing, filtering, sorting, validation). */
  type: DataTableColumnType
  /** How the value is shown (display only — lib/formatting/cell-format.ts); default from the type. */
  format?: CellFormat
  /** Fetched (usable in the value, rules, workflows) but not drawn. */
  hidden?: boolean
  /** End users may sort on it. */
  sortable?: boolean
  /** End users may filter on it. */
  filterable?: boolean
  /**
   * Edit mode: read-only when editing — an existing row's cell can't be
   * changed (inline, by rules, or in what the browser sends: the server keeps
   * the stored value). A new row gets it only from the column's default.
   */
  read_only?: boolean
  /** Edit mode: what a rule's "New row" fills in (a constant or a template: {{form.x}}, {{today}}, {{user.id}}). */
  default?: string
  /** Edit mode: added / edited rows need a value. */
  required?: boolean
  /** choice: allowed values. */
  options?: string[]
  min?: number
  max?: number
  max_length?: number
  /** Width in px (a hint). */
  width?: number
}

export type DataTableOperator = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'starts_with' | 'ends_with' | 'in' | 'is_set' | 'is_not_set'
export const DATA_TABLE_OPERATORS: DataTableOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'starts_with', 'ends_with', 'in', 'is_set', 'is_not_set']
export const DATA_TABLE_OPERATOR_LABELS: Record<DataTableOperator, string> = {
  eq: 'equals', neq: 'does not equal', gt: 'greater than', gte: 'at least', lt: 'less than', lte: 'at most',
  contains: 'contains', starts_with: 'starts with', ends_with: 'ends with', in: 'is one of', is_set: 'is not empty', is_not_set: 'is empty',
}
/** Operators an end user's column filter may use (per column type). */
export function userOperatorsFor(type: DataTableColumnType): DataTableOperator[] {
  if (type === 'number' || type === 'date' || type === 'datetime') return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_set', 'is_not_set']
  if (type === 'boolean') return ['eq']
  if (type === 'choice') return ['eq', 'neq', 'is_set', 'is_not_set']
  return ['contains', 'eq', 'neq', 'starts_with', 'is_set', 'is_not_set']
}

export interface DataTableCondition {
  column: string
  operator: DataTableOperator
  /** A constant or a template: {{form.x}}, {{user.id}}, {{today-7d}}… (`in`: comma-separated). */
  value?: string
}

export interface DataTableConditionGroup {
  match: 'all' | 'any'
  conditions: Array<DataTableCondition | DataTableConditionGroup>
}

export interface DataTableSort { column: string; direction: 'asc' | 'desc' }

export interface DataTableFieldConfig {
  source: DataTableSource
  mode: DataTableMode
  // ── Data table ──
  table_id?: string
  // ── API reference / connector operation ──
  integration_id?: string
  reference_id?: string
  /**
   * Reference input → template. Besides {{form.x}} / {{user.*}} / dates, a
   * mapping may pass the table's state: {{search}}, {{page}} (1-based),
   * {{page_size}}, {{offset}}, {{sort}}, {{sort_dir}}, {{filter.<column>}}.
   * What isn't mapped is applied by the server to the fetched rows.
   */
  input_mappings?: Record<string, string>
  /** Path of the rows array in the response ('' = the response itself). */
  results_path?: string
  /** Path of the total row count in the response (paging done by the API). */
  total_path?: string
  // ── Both ──
  columns: DataTableColumn[]
  /** The column that identifies a row (`row_id` = a data table row's own id). */
  key_column?: string
  base_filter?: DataTableConditionGroup
  sort?: DataTableSort[]
  page_size?: number
  /** Show the search box (default true). */
  searchable?: boolean
  /** A fixed locale for formatting (default: the viewer's). */
  locale?: string
  /** select: several rows. */
  multiple?: boolean
  /** edit: people may add / delete rows. */
  allow_add?: boolean
  allow_delete?: boolean
  /** select: at most this many rows; edit: at most this many changes. */
  max_rows?: number
  /**
   * Data table source: people who may fill in the form see these rows even
   * without the data.view permission (the form's author allows it, like a
   * lookup). Off: reading needs data.view, and the user's own access (RLS)
   * applies.
   */
  open_access?: boolean
  /**
   * Anonymous forms (/p/<token>): visitors who are not signed in may read
   * this field's rows — the declared columns within the base filter, page
   * sizes capped. Off (default): an anonymous visitor gets nothing from this
   * source (lib/services/anonymous-forms.ts).
   */
  anonymous_read?: boolean
  /**
   * Full width: the form this table sits on uses at least the wide card
   * (lib/forms/form-width.ts), so a table with many columns has room. The
   * table always scrolls sideways inside the card when it is wider still.
   */
  full_width?: boolean
  /** Edit mode: pending rows at submit (rows a rule made / changed and didn't commit) — see ListFieldConfig.on_submit_pending. */
  on_submit_pending?: 'exclude' | 'block' | 'commit'
  /** Edit mode: pending rows show ✓ Commit and ✕ Discard on the row. */
  row_commit_controls?: boolean
}

export const DATA_TABLE_LIMITS = {
  columns: 30,
  defaultPageSize: 10,
  maxPageSize: 100,
  maxPage: 1000,
  userFilters: 10,
  conditions: 20,
  sorts: 3,
  defaultMaxSelected: 50,
  maxSelected: 100,
  defaultMaxChanges: 100,
  maxChanges: 200,
  referenceRows: 1000,
  template: 500,
  search: 200,
  cellText: 5000,
  options: 200,
} as const

/** A data table row's own id, as a column / key. */
export const DATA_TABLE_ROW_ID = 'row_id'

const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const PATH_RE = /^[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,7}$/
const INPUT_NAME_RE = /^[A-Za-z0-9_.$-]{1,100}$/

export function isDataTableColumnKey(source: DataTableSource, value: unknown): value is string {
  return typeof value === 'string' && (source === 'table' ? COLUMN_RE.test(value) : PATH_RE.test(value)) && !/(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(value)
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

function finite(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

function intIn(raw: unknown, min: number, max: number): number | undefined {
  const n = finite(raw)
  return n === undefined ? undefined : Math.min(max, Math.max(min, Math.floor(n)))
}

function template(raw: unknown): string {
  if (raw === undefined || raw === null) return ''
  return String(raw).slice(0, DATA_TABLE_LIMITS.template)
}

function normalizeColumn(raw: unknown, source: DataTableSource): DataTableColumn | null {
  if (!isPlainObject(raw) || !isDataTableColumnKey(source, raw.key)) return null
  const key = raw.key as string
  const type: DataTableColumnType = DATA_TABLE_COLUMN_TYPES.includes(raw.type as DataTableColumnType) ? raw.type as DataTableColumnType : 'text'
  const col: DataTableColumn = { key, label: str(raw.label, 120) ?? key, type }
  if (raw.format !== undefined && raw.format !== null) {
    const format = normalizeCellFormat(raw.format, defaultColumnFormat(type))
    if (format.kind !== defaultColumnFormat(type) || Object.keys(format).length > 1) col.format = format
  }
  if (raw.hidden === true) col.hidden = true
  if (raw.sortable === true) col.sortable = true
  if (raw.filterable === true) col.filterable = true
  if (raw.read_only === true) col.read_only = true
  if (raw.required === true) col.required = true
  { const def = raw.default === true || raw.default === false || typeof raw.default === 'number' ? String(raw.default) : str(raw.default, DATA_TABLE_LIMITS.template); if (def) col.default = def }
  if (type === 'choice' && Array.isArray(raw.options)) {
    const options = [...new Set(raw.options.map((o) => String(o ?? '').trim()).filter(Boolean))].slice(0, DATA_TABLE_LIMITS.options)
    if (options.length) col.options = options.map((o) => o.slice(0, 200))
  }
  if (type === 'number') {
    const min = finite(raw.min); const max = finite(raw.max)
    if (min !== undefined) col.min = min
    if (max !== undefined) col.max = max
  }
  if (type === 'text') {
    const maxLength = intIn(raw.max_length, 1, DATA_TABLE_LIMITS.cellText)
    if (maxLength !== undefined) col.max_length = maxLength
  }
  const width = intIn(raw.width, 40, 800)
  if (width !== undefined) col.width = width
  return col
}

function normalizeCondition(raw: unknown): DataTableCondition | null {
  if (!isPlainObject(raw) || typeof raw.column !== 'string' || !raw.column) return null
  const operator = DATA_TABLE_OPERATORS.includes(raw.operator as DataTableOperator) ? raw.operator as DataTableOperator : 'eq'
  const out: DataTableCondition = { column: raw.column.slice(0, 600), operator }
  if (operator !== 'is_set' && operator !== 'is_not_set') out.value = template(raw.value)
  return out
}

/** A condition group (one nested level), bounded to DATA_TABLE_LIMITS.conditions conditions in all. */
export function normalizeConditionGroup(raw: unknown, depth = 0, budget = { left: DATA_TABLE_LIMITS.conditions as number }): DataTableConditionGroup | undefined {
  if (!isPlainObject(raw) || !Array.isArray(raw.conditions)) return undefined
  const group: DataTableConditionGroup = { match: raw.match === 'any' ? 'any' : 'all', conditions: [] }
  for (const entry of raw.conditions) {
    if (budget.left <= 0) break
    if (isPlainObject(entry) && Array.isArray(entry.conditions)) {
      if (depth >= 1) continue
      const inner = normalizeConditionGroup(entry, depth + 1, budget)
      if (inner && inner.conditions.length) group.conditions.push(inner)
      continue
    }
    const condition = normalizeCondition(entry)
    if (condition) { group.conditions.push(condition); budget.left-- }
  }
  return group.conditions.length ? group : undefined
}

export function isConditionGroup(entry: DataTableCondition | DataTableConditionGroup): entry is DataTableConditionGroup {
  return Array.isArray((entry as DataTableConditionGroup).conditions)
}

/** Every condition of a group (nested ones included). */
export function groupConditions(group: DataTableConditionGroup | undefined): DataTableCondition[] {
  if (!group) return []
  return group.conditions.flatMap((c) => (isConditionGroup(c) ? groupConditions(c) : [c]))
}

/** Clean a stored / submitted config (unknown props dropped, keys validated, bounds clamped). */
export function normalizeDataTableConfig(raw: unknown): DataTableFieldConfig {
  const src = isPlainObject(raw) ? raw : {}
  const source: DataTableSource = src.source === 'reference' ? 'reference' : 'table'
  const mode: DataTableMode = DATA_TABLE_MODES.includes(src.mode as DataTableMode) ? src.mode as DataTableMode : 'display'
  const out: DataTableFieldConfig = { source, mode, columns: [] }
  if (source === 'table') {
    const tableId = str(src.table_id, 64)
    if (tableId) out.table_id = tableId
  } else {
    const integrationId = str(src.integration_id, 64)
    const referenceId = str(src.reference_id, 64)
    if (integrationId) out.integration_id = integrationId
    if (referenceId) out.reference_id = referenceId
    if (isPlainObject(src.input_mappings)) {
      const mappings: Record<string, string> = {}
      for (const [name, value] of Object.entries(src.input_mappings).slice(0, 30)) {
        if (!INPUT_NAME_RE.test(name) || name === '__proto__') continue
        const t = template(value)
        if (t) mappings[name] = t
      }
      if (Object.keys(mappings).length) out.input_mappings = mappings
    }
    // The rows list may sit at any depth (`data.items`, `value[0].children`, `orders[].lines`).
    const results = typeof src.results_path === 'string' ? normalizeCollectionPath(src.results_path) : ''
    if (results && isCollectionPath(results)) out.results_path = results
    const total = typeof src.total_path === 'string' ? src.total_path.trim().replace(/\.$/, '') : ''
    if (total && PATH_RE.test(total)) out.total_path = total
  }
  const seen = new Set<string>()
  if (Array.isArray(src.columns)) {
    for (const entry of src.columns) {
      const col = normalizeColumn(entry, source)
      if (!col || seen.has(col.key) || out.columns.length >= DATA_TABLE_LIMITS.columns) continue
      seen.add(col.key)
      out.columns.push(col)
    }
  }
  const keyColumn = typeof src.key_column === 'string' ? src.key_column.trim() : ''
  if (keyColumn && (keyColumn === DATA_TABLE_ROW_ID ? source === 'table' : isDataTableColumnKey(source, keyColumn))) out.key_column = keyColumn
  const base = normalizeConditionGroup(src.base_filter)
  if (base) out.base_filter = base
  if (Array.isArray(src.sort)) {
    const sort: DataTableSort[] = []
    for (const s of src.sort) {
      if (!isPlainObject(s) || typeof s.column !== 'string' || !s.column || sort.some((x) => x.column === s.column)) continue
      if (sort.length < DATA_TABLE_LIMITS.sorts) sort.push({ column: s.column.slice(0, 600), direction: s.direction === 'desc' ? 'desc' : 'asc' })
    }
    if (sort.length) out.sort = sort
  }
  const pageSize = intIn(src.page_size, 1, DATA_TABLE_LIMITS.maxPageSize)
  if (pageSize !== undefined && pageSize !== DATA_TABLE_LIMITS.defaultPageSize) out.page_size = pageSize
  if (src.searchable === false) out.searchable = false
  if (isLocale(src.locale)) out.locale = src.locale
  if (mode === 'select' && src.multiple === true) out.multiple = true
  if (mode === 'edit') {
    if (src.allow_add === true) out.allow_add = true
    if (src.allow_delete === true) out.allow_delete = true
    if (src.on_submit_pending === 'exclude' || src.on_submit_pending === 'commit') out.on_submit_pending = src.on_submit_pending
    if (src.row_commit_controls === true) out.row_commit_controls = true
  }
  if (mode !== 'display') {
    const cap = mode === 'select' ? DATA_TABLE_LIMITS.maxSelected : DATA_TABLE_LIMITS.maxChanges
    const maxRows = intIn(src.max_rows, 1, cap)
    if (maxRows !== undefined) out.max_rows = maxRows
  }
  if (source === 'table' && src.open_access === true) out.open_access = true
  if (src.anonymous_read === true) out.anonymous_read = true
  if (src.full_width === true) out.full_width = true
  return out
}

export function dataTablePageSize(config: DataTableFieldConfig): number {
  return config.page_size ?? DATA_TABLE_LIMITS.defaultPageSize
}

/** The key column (`row_id` by default for a data table). */
export function dataTableKeyColumn(config: DataTableFieldConfig): string {
  return config.key_column ?? (config.source === 'table' ? DATA_TABLE_ROW_ID : config.columns[0]?.key ?? '')
}

export function dataTableMaxRows(config: DataTableFieldConfig): number {
  return config.max_rows ?? (config.mode === 'select' ? DATA_TABLE_LIMITS.defaultMaxSelected : DATA_TABLE_LIMITS.defaultMaxChanges)
}

/** Keys a row carries (the projection): the declared columns plus the key column. */
export function projectedKeys(config: DataTableFieldConfig): string[] {
  const keys = config.columns.map((c) => c.key)
  const key = dataTableKeyColumn(config)
  if (key && !keys.includes(key)) keys.push(key)
  return keys
}

/** The columns the author's config touches (projection, key, base filter, sort) — checked against the table's columns. */
export function referencedColumns(config: DataTableFieldConfig): string[] {
  const out = new Set<string>([...projectedKeys(config), ...groupConditions(config.base_filter).map((c) => c.column), ...(config.sort ?? []).map((s) => s.column)])
  out.delete(DATA_TABLE_ROW_ID)
  return [...out]
}

/**
 * Problems the designer flags (and saves refuse): no source, no columns,
 * unknown columns in the key / base filter / sort, an editable table
 * without a key.
 */
export function dataTableConfigProblem(config: DataTableFieldConfig | undefined): string | null {
  if (!config) return 'Choose where the rows come from'
  if (config.source === 'table' && !config.table_id) return 'Choose a data table'
  if (config.source === 'reference' && !config.reference_id) return 'Choose an API reference'
  if (!config.columns.length) return 'Choose at least one column'
  if (!config.columns.some((c) => !c.hidden)) return 'Show at least one column'
  const known = new Set([...config.columns.map((c) => c.key), ...(config.source === 'table' ? [DATA_TABLE_ROW_ID] : [])])
  const key = dataTableKeyColumn(config)
  if (config.mode !== 'display' && !key) return 'Choose the column that identifies a row'
  if (config.source === 'reference' && key && !known.has(key)) return `The key column "${key}" must be one of the columns`
  for (const c of groupConditions(config.base_filter)) {
    if (config.source === 'reference' && !known.has(c.column)) return `The base filter uses "${c.column}", which is not one of the columns`
  }
  for (const s of config.sort ?? []) {
    if (config.source === 'reference' && !known.has(s.column)) return `The sort uses "${s.column}", which is not one of the columns`
  }
  for (const c of config.columns) {
    if (c.type === 'choice' && config.mode === 'edit' && !c.read_only && !(c.options ?? []).length) return `Column "${c.label}": add the choices`
    if (c.min !== undefined && c.max !== undefined && c.min > c.max) return `Column "${c.label}": minimum is greater than maximum`
  }
  return null
}

/* ── Templates ───────────────────────────────────────────────────────── */

const TEMPLATE_RE = /\{\{\s*([\w.\-+[\]]+)\s*\}\}/g

export interface DataTableScope {
  /** The form's current values ({{form.x}} / {{task_data.x}}). */
  values: Record<string, unknown>
  /** The signed-in user ({{user.id}}, {{user.email}}, {{user.name}}). */
  user?: { id?: string | null; email?: string | null; name?: string | null } | null
  /** "Now" for date expressions (tests pin it). */
  now?: Date
  /** API sources: the table's own state. */
  state?: { search?: string; page?: number; page_size?: number; sort?: string; sort_dir?: string; filters?: Record<string, string> }
  task?: Record<string, unknown> | null
}

/** Paths resolved when the table is queried (everything else is a workflow variable, resolved when the task is created). */
export function isDataTableTimePath(path: string): boolean {
  return /^(search|page|page_size|offset|sort|sort_dir|filter|form|task_data|task|user|param|var|control|today|now|start_of_month|start_of_year)(\.|[+-]|$)/.test(path)
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** {{today}}, {{today+7d}}, {{today-1m}}, {{now}}, {{start_of_month}}, {{start_of_year}} → ISO text (dates in UTC). */
export function dateExpression(path: string, now: Date = new Date()): string | undefined {
  const m = /^(today|now|start_of_month|start_of_year)(?:([+-])(\d{1,4})([dwmy]))?$/.exec(path)
  if (!m) return undefined
  const d = new Date(now.getTime())
  if (m[1] === 'start_of_month') d.setUTCDate(1)
  if (m[1] === 'start_of_year') { d.setUTCMonth(0, 1) }
  if (m[2]) {
    const n = Number(m[3]) * (m[2] === '-' ? -1 : 1)
    if (m[4] === 'd') d.setUTCDate(d.getUTCDate() + n)
    if (m[4] === 'w') d.setUTCDate(d.getUTCDate() + n * 7)
    if (m[4] === 'm') d.setUTCMonth(d.getUTCMonth() + n)
    if (m[4] === 'y') d.setUTCFullYear(d.getUTCFullYear() + n)
  }
  return m[1] === 'now' ? d.toISOString() : isoDate(d)
}

function scopeLookup(path: string, scope: DataTableScope): unknown {
  const st = scope.state ?? {}
  if (path === 'search') return st.search ?? ''
  if (path === 'page') return st.page ?? 1
  if (path === 'page_size') return st.page_size ?? DATA_TABLE_LIMITS.defaultPageSize
  if (path === 'offset') return ((st.page ?? 1) - 1) * (st.page_size ?? DATA_TABLE_LIMITS.defaultPageSize)
  if (path === 'sort') return st.sort ?? ''
  if (path === 'sort_dir') return st.sort_dir ?? ''
  let m = /^filter\.(.+)$/.exec(path)
  if (m) return st.filters?.[m[1]] ?? ''
  m = /^(?:task_data|form|task\.data)\.(.+)$/.exec(path)
  if (m) return pathValue(scope.values, m[1])
  // {{param.x}} / {{var.x}}: the form's parameters and variables, validated by the server (lib/forms/form-params.ts).
  const context = formContextPath(path)
  if (context) return pathValue(scope.values, context)
  m = /^user\.(id|email|name)$/.exec(path)
  if (m) return scope.user?.[m[1] as 'id' | 'email' | 'name'] ?? ''
  m = /^task\.(.+)$/.exec(path)
  if (m && scope.task) return pathValue(scope.task, m[1])
  const date = dateExpression(path, scope.now)
  if (date !== undefined) return date
  return undefined
}

/** Resolve a template: one whole reference keeps its raw value; mixed text is interpolated; unknown paths → ''. */
export function resolveDataTableTemplate(text: string | undefined, scope: DataTableScope): unknown {
  if (typeof text !== 'string' || !text.includes('{{')) return text ?? ''
  const whole = /^\{\{\s*([\w.\-+[\]]+)\s*\}\}$/.exec(text.trim())
  if (whole) {
    const v = scopeLookup(whole[1], scope)
    return v === undefined || v === null ? '' : v
  }
  return text.replace(TEMPLATE_RE, (_m, path: string) => {
    const v = scopeLookup(path, scope)
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

export function templateText(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return '' } }
  return String(value)
}

/** Placeholders a template uses (paths). */
export function templatePaths(text: string | undefined): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(TEMPLATE_RE)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

/**
 * Value keys the config's templates read — form fields ({{form.x}}), and the
 * parameters / variables ({{param.x}}, {{var.x}}: their reserved keys) —
 * sent with each query; the table queries again when they change.
 */
export function dataTableDependencies(config: DataTableFieldConfig): string[] {
  const texts = [...groupConditions(config.base_filter).map((c) => c.value ?? ''), ...Object.values(config.input_mappings ?? {})]
  const out: string[] = []
  for (const t of texts) {
    for (const path of templatePaths(t)) {
      const m = /^(?:task_data|form|task\.data)\.([a-z0-9_]+)/.exec(path)
      if (m && !out.includes(m[1])) out.push(m[1])
      const context = /^(param|var|control)(\.|$)/.exec(path)
      const key = context ? (context[1] === 'param' ? FORM_PARAMS_KEY : context[1] === 'var' ? FORM_VARS_KEY : CONTROLS_KEY) : null
      if (key && !out.includes(key)) out.push(key)
    }
  }
  return out
}

/** Replace workflow-variable parts of the config's templates (task creation) while keeping query-time ones. */
export function preResolveDataTableConfig(config: DataTableFieldConfig, resolve: (path: string) => unknown): DataTableFieldConfig {
  const fix = (text: string | undefined) => {
    if (!text || !text.includes('{{')) return text
    return text.replace(TEMPLATE_RE, (whole, path: string) => {
      if (isDataTableTimePath(path)) return whole
      const v = resolve(path)
      return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    })
  }
  const fixGroup = (g: DataTableConditionGroup): DataTableConditionGroup => ({
    match: g.match,
    conditions: g.conditions.map((c) => (isConditionGroup(c) ? fixGroup(c) : c.value === undefined ? c : { ...c, value: fix(c.value) })),
  })
  const out: DataTableFieldConfig = { ...config }
  if (config.base_filter) out.base_filter = fixGroup(config.base_filter)
  if (config.input_mappings) out.input_mappings = Object.fromEntries(Object.entries(config.input_mappings).map(([k, v]) => [k, fix(v) ?? '']))
  return out
}

/** Which parts of the table's state an API source's mappings pass to the API (the rest the server applies to the fetched rows). */
export function remoteCapabilities(config: DataTableFieldConfig): { search: boolean; sort: boolean; page: boolean; filters: string[] } {
  const paths = Object.values(config.input_mappings ?? {}).flatMap(templatePaths)
  return {
    search: paths.includes('search'),
    sort: paths.includes('sort') || paths.includes('sort_dir'),
    page: paths.includes('page') || paths.includes('offset'),
    filters: paths.filter((p) => p.startsWith('filter.')).map((p) => p.slice(7)),
  }
}

/* ── The end user's query ────────────────────────────────────────────── */

export interface DataTableUserFilter { column: string; operator: DataTableOperator; value?: string }

export interface DataTableQuery {
  search?: string
  filters?: DataTableUserFilter[]
  sort?: DataTableSort[]
  page?: number
  page_size?: number
}

/** The typed search, cleaned (control characters and PostgREST's `*` alias removed, capped). */
export function cleanSearch(raw: unknown): string {
  return String(raw ?? '')
    .slice(0, DATA_TABLE_LIMITS.search)
    .replace(/[\u0000-\u001f\u007f*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export class DataTableQueryError extends Error {}

/**
 * The browser's query, bounded by the author's config: filters only on
 * columns marked filterable (with operators that suit the column), sort
 * only on sortable columns, search only when the table is searchable,
 * page size at most the configured one (and DATA_TABLE_LIMITS.maxPageSize).
 * A filter on any other column throws (no silent widening or guessing).
 */
export function normalizeUserQuery(config: DataTableFieldConfig, raw: unknown): Required<Pick<DataTableQuery, 'search' | 'filters' | 'page' | 'page_size'>> & { sort: DataTableSort[] } {
  const q = isPlainObject(raw) ? raw : {}
  const byKey = new Map(config.columns.map((c) => [c.key, c]))
  const filters: DataTableUserFilter[] = []
  if (Array.isArray(q.filters)) {
    for (const f of q.filters.slice(0, DATA_TABLE_LIMITS.userFilters)) {
      if (!isPlainObject(f) || typeof f.column !== 'string') continue
      const col = byKey.get(f.column)
      if (!col || !col.filterable) throw new DataTableQueryError(`You can't filter on "${String(f.column).slice(0, 64)}"`)
      const operator = f.operator as DataTableOperator
      if (!userOperatorsFor(col.type).includes(operator)) throw new DataTableQueryError(`That filter is not available on "${col.label}"`)
      const filter: DataTableUserFilter = { column: col.key, operator }
      if (operator !== 'is_set' && operator !== 'is_not_set') {
        // The user's value is literal: never a template.
        filter.value = String(f.value ?? '').slice(0, DATA_TABLE_LIMITS.search).replace(/[\u0000-\u001f\u007f]/g, '')
        if (!filter.value.trim()) continue
      }
      filters.push(filter)
    }
  }
  let sort: DataTableSort[] = []
  if (Array.isArray(q.sort)) {
    for (const s of q.sort.slice(0, DATA_TABLE_LIMITS.sorts)) {
      if (!isPlainObject(s) || typeof s.column !== 'string') continue
      const col = byKey.get(s.column)
      if (!col || !col.sortable) throw new DataTableQueryError(`You can't sort on "${String(s.column).slice(0, 64)}"`)
      if (!sort.some((x) => x.column === col.key)) sort.push({ column: col.key, direction: s.direction === 'desc' ? 'desc' : 'asc' })
    }
  }
  if (!sort.length) sort = config.sort ?? []
  const maxSize = dataTablePageSize(config)
  const page_size = intIn(q.page_size, 1, Math.max(maxSize, Math.min(DATA_TABLE_LIMITS.maxPageSize, maxSize))) ?? maxSize
  const page = intIn(q.page, 1, DATA_TABLE_LIMITS.maxPage) ?? 1
  const search = config.searchable === false ? '' : cleanSearch(q.search)
  return { search, filters, sort, page, page_size }
}

/** Columns the search runs over: the visible text / choice / number columns. */
export function searchColumns(config: DataTableFieldConfig): DataTableColumn[] {
  return config.columns.filter((c) => !c.hidden && (c.type === 'text' || c.type === 'choice'))
}

/* ── Data table (PostgREST) filters ──────────────────────────────────── */

/** LIKE wildcards (and the escape character) of user text made literal. */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&')
}

/** A value inside a PostgREST logic tree: double-quoted, `\` and `"` escaped. */
export function quoteValue(value: string): string {
  return `"${value.replace(/[\\"]/g, '\\$&')}"`
}

/** The column reference: the row id, a cell as text (`->>`) or as JSON (`->`, numeric / boolean compare and sort). */
export function cellRef(column: string, asJson: boolean): string {
  if (column === DATA_TABLE_ROW_ID) return 'id'
  return `data${asJson ? '->' : '->>'}${column}`
}

function numberText(value: string): string | null {
  const n = Number(String(value).trim().replace(/,/g, ''))
  return Number.isFinite(n) && String(value).trim() !== '' ? String(n) : null
}

/**
 * One condition as a PostgREST logic-tree term (`data->>name.ilike."*acme*"`).
 * The value is already resolved (no templates). Numbers and booleans compare
 * as JSON (numeric order), text and dates as text (ISO dates sort as text).
 * Throws DataTableQueryError on a value that doesn't fit the column type.
 */
export function conditionTerm(column: string, type: DataTableColumnType, operator: DataTableOperator, value: string): string {
  const numeric = type === 'number'
  const bool = type === 'boolean'
  if (operator === 'is_set') return `${cellRef(column, true)}.not.is.null`
  if (operator === 'is_not_set') return `${cellRef(column, true)}.is.null`
  if (operator === 'contains' || operator === 'starts_with' || operator === 'ends_with') {
    const term = likeEscape(cleanSearch(value))
    return `${cellRef(column, false)}.ilike.${quoteValue(operator === 'contains' ? `*${term}*` : operator === 'ends_with' ? `*${term}` : `${term}*`)}`
  }
  if (operator === 'in') {
    const list = value.split(',').map((v) => v.trim()).filter(Boolean).slice(0, 50)
    if (!list.length) return `${cellRef(column, false)}.in.("")`
    if (numeric) {
      const nums = list.map(numberText)
      if (nums.some((n) => n === null)) throw new DataTableQueryError('A value in the list is not a number')
      return `${cellRef(column, true)}.in.(${nums.join(',')})`
    }
    return `${cellRef(column, false)}.in.(${list.map(quoteValue).join(',')})`
  }
  if (numeric) {
    const n = numberText(value)
    if (n === null) throw new DataTableQueryError('Enter a number')
    return `${cellRef(column, true)}.${operator}.${n}`
  }
  if (bool) {
    const b = ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase())
    return operator === 'neq' ? `${cellRef(column, true)}.neq.${b}` : `${cellRef(column, true)}.eq.${b}`
  }
  if (column === DATA_TABLE_ROW_ID) {
    if (!/^[0-9a-f-]{36}$/i.test(value.trim())) return 'id.is.null'
    return `id.${operator === 'neq' ? 'neq' : 'eq'}.${value.trim()}`
  }
  return `${cellRef(column, false)}.${operator}.${quoteValue(value)}`
}

/** The column type of a key (row_id → text; an undeclared column of the base filter → text). */
function typeOf(config: DataTableFieldConfig, column: string, tableTypes?: Record<string, DataTableColumnType>): DataTableColumnType {
  return config.columns.find((c) => c.key === column)?.type ?? tableTypes?.[column] ?? 'text'
}

/** The base filter as a logic tree, values resolved against the scope. */
export function baseFilterTerm(config: DataTableFieldConfig, scope: DataTableScope, tableTypes?: Record<string, DataTableColumnType>): string | null {
  const group = config.base_filter
  if (!group) return null
  const build = (g: DataTableConditionGroup): string | null => {
    const parts: string[] = []
    for (const c of g.conditions) {
      if (isConditionGroup(c)) { const inner = build(c); if (inner) parts.push(inner); continue }
      const value = c.operator === 'is_set' || c.operator === 'is_not_set' ? '' : templateText(resolveDataTableTemplate(c.value ?? '', scope))
      try {
        parts.push(conditionTerm(c.column, typeOf(config, c.column, tableTypes), c.operator, value))
      } catch (error) {
        // A value that doesn't fit (e.g. a number field left empty on the form): the condition
        // matches nothing — never dropped, so the base filter can't be widened by leaving it blank.
        if (!(error instanceof DataTableQueryError)) throw error
        parts.push('id.is.null')
      }
    }
    if (!parts.length) return null
    return `${g.match === 'any' ? 'or' : 'and'}(${parts.join(',')})`
  }
  return build(group)
}

export interface TablePlan {
  /** One logic tree: base filter AND user filters AND search (null = all rows). */
  where: string | null
  order: Array<{ column: string; ascending: boolean }>
  offset: number
  limit: number
}

/**
 * The query a data-table source runs (pure, so tests can assert it): the
 * author's base filter first, then — ANDed onto it — the user's filters and
 * search. The browser's input can only add terms, never remove the base.
 */
export function buildTablePlan(
  config: DataTableFieldConfig,
  query: ReturnType<typeof normalizeUserQuery>,
  scope: DataTableScope,
  tableTypes?: Record<string, DataTableColumnType>,
): TablePlan {
  const terms: string[] = []
  const base = baseFilterTerm(config, scope, tableTypes)
  if (base) terms.push(base)
  for (const f of query.filters) terms.push(conditionTerm(f.column, typeOf(config, f.column), f.operator, f.value ?? ''))
  if (query.search) {
    const columns = searchColumns(config)
    if (columns.length) terms.push(`or(${columns.map((c) => conditionTerm(c.key, 'text', 'contains', query.search)).join(',')})`)
  }
  const where = terms.length ? `and(${terms.join(',')})` : null
  const order = query.sort.map((s) => ({ column: s.column === DATA_TABLE_ROW_ID ? 'id' : `data->${s.column}`, ascending: s.direction !== 'desc' }))
  return { where, order, offset: (query.page - 1) * query.page_size, limit: query.page_size }
}

/* ── Rows ────────────────────────────────────────────────────────────── */

export interface DataTableRow {
  /** The row's key (the key column's value as text). */
  key: string
  /** The declared columns only (plus the key column). */
  values: Record<string, unknown>
}

function boundedCell(value: unknown): unknown {
  if (value === undefined) return null
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, DATA_TABLE_LIMITS.cellText)
  try {
    const json = JSON.stringify(value)
    return json.length <= 4000 ? JSON.parse(json) : null
  } catch { return null }
}

/**
 * Project a source record onto the declared columns (the only thing that
 * leaves the server). A data table record is `{ row_id, ...data }`; an API
 * record is read by each column's path. Null when the row has no key.
 */
export function projectRow(config: DataTableFieldConfig, record: unknown): DataTableRow | null {
  if (!isPlainObject(record)) return null
  const values: Record<string, unknown> = {}
  for (const key of projectedKeys(config)) values[key] = boundedCell(config.source === 'table' ? record[key] : pathValue(record, key))
  const keyColumn = dataTableKeyColumn(config)
  const keyValue = keyColumn ? values[keyColumn] : null
  if (keyValue === null || keyValue === undefined || keyValue === '' || typeof keyValue === 'object') {
    // Display tables don't need keys: fall back to the position.
    if (config.mode !== 'display') return null
    return { key: '', values }
  }
  return { key: String(keyValue), values }
}

/* ── Local evaluation (API sources: what the API doesn't do itself) ──── */

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '' } }
  return String(v)
}

function compareCells(a: unknown, b: unknown, type: DataTableColumnType): number {
  const blankA = a === null || a === undefined || a === ''
  const blankB = b === null || b === undefined || b === ''
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1
  if (type === 'number') return Number(a) - Number(b)
  if (type === 'boolean') return (a === true ? 1 : 0) - (b === true ? 1 : 0)
  return cellText(a).localeCompare(cellText(b), undefined, { numeric: true, sensitivity: 'base' })
}

/** Whether one row meets one resolved condition (local evaluation). */
export function rowMeets(values: Record<string, unknown>, column: string, type: DataTableColumnType, operator: DataTableOperator, value: string): boolean {
  const cell = values[column]
  const blank = cell === null || cell === undefined || cell === ''
  if (operator === 'is_set') return !blank
  if (operator === 'is_not_set') return blank
  const left = cellText(cell).toLowerCase()
  const right = String(value ?? '').toLowerCase().trim()
  switch (operator) {
    case 'contains': return left.includes(right)
    case 'starts_with': return left.startsWith(right)
    case 'ends_with': return left.endsWith(right)
    case 'in': return right.split(',').map((v) => v.trim()).filter(Boolean).includes(left)
    case 'eq':
      if (type === 'number') return !blank && Number(cell) === Number(value)
      if (type === 'boolean') return (cell === true || ['true', '1', 'yes'].includes(left)) === ['true', '1', 'yes', 'on'].includes(right)
      return left === right
    case 'neq':
      if (type === 'number') return blank || Number(cell) !== Number(value)
      return left !== right
    default: {
      if (blank || String(value ?? '').trim() === '') return false
      const cmp = type === 'number' ? Number(cell) - Number(value) : left.localeCompare(right, undefined, { numeric: true })
      if (Number.isNaN(cmp)) return false
      return operator === 'gt' ? cmp > 0 : operator === 'gte' ? cmp >= 0 : operator === 'lt' ? cmp < 0 : cmp <= 0
    }
  }
}

/** Whether a row meets the base filter (local evaluation, values resolved). */
export function rowMeetsGroup(config: DataTableFieldConfig, values: Record<string, unknown>, group: DataTableConditionGroup | undefined, scope: DataTableScope): boolean {
  if (!group) return true
  const results = group.conditions.map((c) => {
    if (isConditionGroup(c)) return rowMeetsGroup(config, values, c, scope)
    const value = templateText(resolveDataTableTemplate(c.value ?? '', scope))
    return rowMeets(values, c.column, typeOf(config, c.column), c.operator, value)
  })
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/**
 * Apply what an API didn't (base filter always; search, filters, sort and
 * paging when not passed to the API) to the fetched rows.
 */
export function applyLocally(
  config: DataTableFieldConfig,
  rows: DataTableRow[],
  query: ReturnType<typeof normalizeUserQuery>,
  scope: DataTableScope,
  remote: ReturnType<typeof remoteCapabilities>,
): { rows: DataTableRow[]; total: number | null; local: string[] } {
  const local: string[] = []
  let out = rows.filter((r) => rowMeetsGroup(config, r.values, config.base_filter, scope))
  const localFilters = query.filters.filter((f) => !remote.filters.includes(f.column))
  if (localFilters.length) {
    local.push('filters')
    out = out.filter((r) => localFilters.every((f) => rowMeets(r.values, f.column, typeOf(config, f.column), f.operator, f.value ?? '')))
  }
  if (query.search && !remote.search) {
    local.push('search')
    const term = query.search.toLowerCase()
    const cols = searchColumns(config)
    out = out.filter((r) => cols.some((c) => cellText(r.values[c.key]).toLowerCase().includes(term)))
  }
  if (query.sort.length && !remote.sort) {
    local.push('sort')
    out = [...out].sort((a, b) => {
      for (const s of query.sort) {
        const cmp = compareCells(a.values[s.column], b.values[s.column], typeOf(config, s.column))
        if (cmp) return s.direction === 'desc' ? -cmp : cmp
      }
      return 0
    })
  }
  if (remote.page) return { rows: out.slice(0, query.page_size), total: null, local }
  local.push('page')
  const offset = (query.page - 1) * query.page_size
  return { rows: out.slice(offset, offset + query.page_size), total: out.length, local }
}

/* ── Values: selections and change sets ──────────────────────────────── */

export interface DataTableChange {
  key: string
  before: Record<string, unknown>
  after: Record<string, unknown>
  changed_fields: string[]
  /** Pending (changed by a rule's "Set row values", not committed yet) — browser state; the server settles it. */
  draft?: boolean
  /** A failed "Commit row": column → message (browser state). */
  errors?: Record<string, string>
}

export interface DataTableChangeSet {
  added: Array<Record<string, unknown>>
  updated: DataTableChange[]
  deleted: Array<{ key: string; before: Record<string, unknown> }>
}

export function emptyChangeSet(): DataTableChangeSet {
  return { added: [], updated: [], deleted: [] }
}

export function isChangeSet(value: unknown): value is DataTableChangeSet {
  return isPlainObject(value) && (Array.isArray(value.added) || Array.isArray(value.updated) || Array.isArray(value.deleted))
}

export function changeCount(value: unknown): number {
  if (!isChangeSet(value)) return 0
  return (value.added?.length ?? 0) + (value.updated?.length ?? 0) + (value.deleted?.length ?? 0)
}

/** Coerce one cell to its column type; returns an error message instead when it doesn't fit. */
export function coerceCell(col: DataTableColumn, raw: unknown): { value: unknown } | { error: string } {
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return col.type === 'boolean' ? { value: false } : { value: null }
  }
  switch (col.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(/,/g, ''))
      if (!Number.isFinite(n)) return { error: `${col.label} must be a number` }
      if (col.min !== undefined && n < col.min) return { error: `${col.label} must be at least ${col.min}` }
      if (col.max !== undefined && n > col.max) return { error: `${col.label} must be at most ${col.max}` }
      return { value: n }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw }
      const s = String(raw).trim().toLowerCase()
      if (['true', '1', 'yes', 'y', 'on'].includes(s)) return { value: true }
      if (['false', '0', 'no', 'n', 'off'].includes(s)) return { value: false }
      return { error: `${col.label} must be yes or no` }
    }
    case 'datetime': {
      const d = new Date(String(raw).trim())
      return Number.isNaN(d.getTime()) ? { error: `${col.label} must be a date and time` } : { value: d.toISOString() }
    }
    case 'date': {
      const s = String(raw).trim()
      if (columnFormat(col).kind === 'datetime') {
        const d = new Date(s)
        return Number.isNaN(d.getTime()) ? { error: `${col.label} must be a date and time` } : { value: d.toISOString() }
      }
      if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(new Date(s.slice(0, 10)).getTime())) return { error: `${col.label} must be a date (YYYY-MM-DD)` }
      return { value: s.slice(0, 10) }
    }
    case 'choice': {
      const s = String(raw).trim()
      if (col.options?.length && !col.options.includes(s)) return { error: `${col.label} must be one of: ${col.options.join(', ')}` }
      return { value: s.slice(0, 200) }
    }
    default: {
      if (typeof raw === 'object') return { error: `${col.label} has an invalid value` }
      const s = String(raw)
      if (s.length > (col.max_length ?? DATA_TABLE_LIMITS.cellText)) return { error: `${col.label} is too long` }
      return { value: s }
    }
  }
}

function sameCell(a: unknown, b: unknown): boolean {
  if ((a === null || a === undefined || a === '') && (b === null || b === undefined || b === '')) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return cellText(a) === cellText(b)
}

/** Fields whose value differs between two rows (the editable columns only). */
export function changedFields(config: DataTableFieldConfig, before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return editableColumns(config).filter((c) => Object.prototype.hasOwnProperty.call(after, c.key) && !sameCell(before[c.key], after[c.key])).map((c) => c.key)
}

/** Columns people may change on an existing row (not read-only, not hidden, not the key column). */
export function editableColumns(config: DataTableFieldConfig): DataTableColumn[] {
  const key = dataTableKeyColumn(config)
  return config.columns.filter((c) => !c.read_only && !c.hidden && c.key !== key)
}

/** Columns people may fill on a new row (not read-only, not hidden; the key column too). */
export function addableColumns(config: DataTableFieldConfig): DataTableColumn[] {
  return config.columns.filter((c) => !c.read_only && !c.hidden)
}

/** Columns a new row may carry: the addable ones, plus read-only / hidden columns a default fills ("New row"). */
export function insertableColumns(config: DataTableFieldConfig): DataTableColumn[] {
  return config.columns.filter((c) => (!c.read_only && !c.hidden) || c.default !== undefined)
}

function cleanRow(config: DataTableFieldConfig, raw: unknown, errors: string[], label: string, keep: 'editable' | 'addable' | 'all', requireAll: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const row = isPlainObject(raw) ? raw : {}
  const cols = keep === 'editable' ? editableColumns(config) : keep === 'addable' ? insertableColumns(config) : config.columns
  for (const col of cols) {
    if (!Object.prototype.hasOwnProperty.call(row, col.key)) {
      if (requireAll && col.required) errors.push(`${label}: ${col.label} is required`)
      continue
    }
    const coerced = coerceCell(col, row[col.key])
    if ('error' in coerced) { errors.push(`${label}: ${coerced.error}`); continue }
    if (col.required && (coerced.value === null || coerced.value === '')) errors.push(`${label}: ${col.label} is required`)
    out[col.key] = coerced.value
  }
  return out
}

function cleanKey(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  return s && s.length <= 200 ? s : null
}

/**
 * Validate a submitted change set against the declared columns and key
 * (pure): unknown columns dropped, cells typed and checked (required,
 * bounds, choices), keys required and unique, adds / deletes only when the
 * author allows them, at most max_rows changes. `before` values are kept
 * only as a hint — the server recomputes them from the source where it can
 * (lib/services/form-data-table.ts) and never trusts them for authorisation.
 */
export function validateChangeSet(config: DataTableFieldConfig, raw: unknown): { changes: DataTableChangeSet; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const changes = emptyChangeSet()
  if (raw === null || raw === undefined || raw === '') return { changes, errors, warnings }
  if (!isPlainObject(raw)) return { changes, errors: ['The table changes are not in the expected shape'], warnings }
  let added = Array.isArray(raw.added) ? raw.added : []
  let updated = Array.isArray(raw.updated) ? raw.updated : []
  const deleted = Array.isArray(raw.deleted) ? raw.deleted : []
  // Pending rows (rule-made, not committed — lib/forms/row-rules.ts): block (default), leave out, or take as they are.
  const pending = added.filter((r) => isPlainObject(r) && rowDraftState(r) !== null).length + updated.filter((u) => isPlainObject(u) && u.draft === true).length
  const pendingMode = config.on_submit_pending ?? 'block'
  if (pending && pendingMode === 'block') errors.push(`Commit or discard the ${pending === 1 ? 'pending row' : `${pending} pending rows`} first`)
  if (pending && pendingMode === 'exclude') {
    added = added.filter((r) => !(isPlainObject(r) && rowDraftState(r) !== null))
    updated = updated.filter((u) => !(isPlainObject(u) && u.draft === true))
  }
  // Read-only columns (lib/forms/row-rules.ts): an existing row's read-only cell never changes. A change the
  // browser marked as such (changed_fields naming it) is tampering — refused; any other stray value is dropped (warned).
  const locked = config.columns.filter((c) => c.read_only || c.hidden).map((c) => c.key)
  const keyCol = dataTableKeyColumn(config)
  updated.forEach((entry) => {
    if (!isPlainObject(entry) || !isPlainObject(entry.after)) return
    const before = isPlainObject(entry.before) ? entry.before : {}
    const named = Array.isArray(entry.changed_fields) ? entry.changed_fields.filter((k): k is string => typeof k === 'string') : []
    for (const col of [...locked, keyCol]) {
      if (!Object.prototype.hasOwnProperty.call(entry.after, col)) continue
      if (named.includes(col)) { errors.push(`Row ${String(entry.key ?? '').slice(0, 60)}: ${config.columns.find((c) => c.key === col)?.label ?? col} is read-only`); continue }
      if (!sameCell(before[col], entry.after[col])) warnings.push(`Row ${String(entry.key ?? '').slice(0, 60)}: a change to read-only column "${col}" was ignored`)
    }
  })
  const insertable = new Set(insertableColumns(config).map((c) => c.key))
  added.forEach((row, i) => {
    if (!isPlainObject(row)) return
    for (const c of config.columns) if (!insertable.has(c.key) && row[c.key] !== undefined && row[c.key] !== null && row[c.key] !== '') warnings.push(`New row ${i + 1}: read-only column "${c.key}" was ignored`)
  })
  const total = added.length + updated.length + deleted.length
  if (total > dataTableMaxRows(config)) return { changes, warnings, errors: [`At most ${dataTableMaxRows(config)} row changes at a time (${total} sent)`] }
  if (added.length && !config.allow_add) errors.push('Adding rows is not allowed on this table')
  if (deleted.length && !config.allow_delete) errors.push('Deleting rows is not allowed on this table')
  const keys = new Set<string>()
  added.forEach((row, i) => {
    const values = cleanRow(config, row, errors, `New row ${i + 1}`, 'addable', true)
    changes.added.push(values)
  })
  updated.forEach((entry, i) => {
    const key = isPlainObject(entry) ? cleanKey(entry.key) : null
    if (!key) { errors.push(`Changed row ${i + 1} has no key`); return }
    if (keys.has(key)) { errors.push(`Row "${key}" is changed twice`); return }
    keys.add(key)
    const after = cleanRow(config, isPlainObject(entry) ? entry.after : null, errors, `Row ${key}`, 'editable', false)
    const before = cleanRow(config, isPlainObject(entry) ? entry.before : null, [], `Row ${key}`, 'all', false)
    const changed = changedFields(config, before, after)
    if (!changed.length) return
    changes.updated.push({ key, before, after, changed_fields: changed })
  })
  deleted.forEach((entry, i) => {
    const key = isPlainObject(entry) ? cleanKey(entry.key) : cleanKey(entry)
    if (!key) { errors.push(`Deleted row ${i + 1} has no key`); return }
    if (keys.has(key)) { errors.push(`Row "${key}" is both changed and deleted`); return }
    keys.add(key)
    const before = cleanRow(config, isPlainObject(entry) ? entry.before : null, [], `Row ${key}`, 'all', false)
    changes.deleted.push({ key, before })
  })
  return { changes, errors, warnings }
}

/** Validate a selection (select mode): rows with keys, unique, within max_rows; cells cleaned to the declared columns. */
export function validateSelection(config: DataTableFieldConfig, raw: unknown): { rows: Array<Record<string, unknown>>; errors: string[] } {
  if (raw === null || raw === undefined || raw === '') return { rows: [], errors: [] }
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) ? [raw] : null
  if (!list) return { rows: [], errors: ['The selection is not in the expected shape'] }
  const max = config.multiple ? dataTableMaxRows(config) : 1
  if (list.length > max) return { rows: [], errors: [config.multiple ? `Choose at most ${max} rows` : 'Choose one row'] }
  const keyColumn = dataTableKeyColumn(config)
  const rows: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const entry of list) {
    if (!isPlainObject(entry)) return { rows: [], errors: ['The selection is not in the expected shape'] }
    const key = cleanKey(entry[keyColumn])
    if (!key) return { rows: [], errors: ['A selected row has no key'] }
    if (seen.has(key)) continue
    seen.add(key)
    const values: Record<string, unknown> = { [keyColumn]: entry[keyColumn] }
    for (const col of config.columns) values[col.key] = boundedCell(entry[col.key])
    rows.push(values)
  }
  return { rows, errors: [] }
}

/** Keys of selected rows. */
export function selectionKeys(config: DataTableFieldConfig, value: unknown): string[] {
  const keyColumn = dataTableKeyColumn(config)
  return (Array.isArray(value) ? value : []).map((r) => (isPlainObject(r) ? cleanKey(r[keyColumn]) : null)).filter((k): k is string => Boolean(k))
}

/* ── Formatting ──────────────────────────────────────────────────────── */

/** The display format a column type gets when the author picks none. */
export function defaultColumnFormat(type: DataTableColumnType): CellFormatKind {
  return defaultFormatKind(type)
}

/** A column's display format (its own, else the type's default). */
export function columnFormat(col: DataTableColumn): CellFormat {
  return col.format ?? { kind: defaultColumnFormat(col.type) }
}

/** One cell for display (formatting only — the value itself is never changed). */
export function formatCell(col: DataTableColumn, value: unknown, options: { locale?: string; now?: Date } = {}): FormattedCell {
  return formatCellValue(value, columnFormat(col), options)
}

/** A short text of a stored value (read-only views, summaries). */
export function describeDataTableValue(config: DataTableFieldConfig | undefined, value: unknown): string {
  if (!config) return '—'
  if (config.mode === 'select') {
    const n = Array.isArray(value) ? value.length : 0
    return n ? `${n} row${n === 1 ? '' : 's'} selected` : '—'
  }
  if (config.mode === 'edit') {
    if (!isChangeSet(value) || !changeCount(value)) return 'No changes'
    const parts: string[] = []
    if (value.added?.length) parts.push(`${value.added.length} added`)
    if (value.updated?.length) parts.push(`${value.updated.length} changed`)
    if (value.deleted?.length) parts.push(`${value.deleted.length} deleted`)
    return parts.join(', ')
  }
  return '—'
}
