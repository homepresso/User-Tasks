/**
 * List fields (field type `list`, "Repeating rows"): rows the person adds on
 * the form itself — line items, attendees, expenses — that live only in the
 * submission (no data table behind them). The value is an array of row
 * objects keyed by the columns, typed:
 *
 *   [{ item: 'Laptop', quantity: 2, unit_price: 1250, total: 2500 }, …]
 *
 * numbers as numbers, dates as YYYY-MM-DD, booleans as true / false, choices
 * as their option value; a `calculated` column (e.g. `quantity * unit_price`)
 * is worked out here, never taken from the browser. Fully blank rows are
 * dropped. The value is kept in drafts / autosave like any other field and
 * reaches the workflow as `{{form.<key>}}` / `{{task_data.<key>}}`: a Loop
 * over it gives `{{item.<column>}}` and `{{index}}`.
 *
 * Beside the rows the run carries `<key>_count` (number of rows) and, per
 * configured total, `<key>_total_<column>` (sum), `<key>_avg_<column>`
 * (average) or `<key>_count_<column>` (rows with a value) — recomputed by
 * the server from the checked rows (listDerivedValues).
 *
 * The field is the list view: the rows (a table, cards on phones), Remove
 * per row, totals underneath. Rows get there by a form rule — "Add row to
 * list" (lib/forms/field-buttons.ts) maps the form's own inputs to the
 * columns, checks them, appends the row and clears the inputs; it usually
 * runs on an in-form Button ("Add item"). "Remove row from list" and "Clear
 * list" go with it. The designer's "Add inputs and an Add button" helper
 * (listEntryKit) creates the inputs, the button and the rule in one click.
 * `entry_mode: 'inline'` instead makes the rows editable in place (Add row
 * appends a blank row).
 *
 * Pure and isomorphic: normalisation, config problems, coercion, validation
 * (the browser's Add check and the server's submit check share it), totals,
 * derived run values and formatting.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { normalizeLookupConfig, type LookupConfig } from './lookup'
import { ROW_ORIGINAL_KEY, rowDraftState } from './row-markers'

export type ListColumnType = 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'choice' | 'boolean' | 'email' | 'lookup' | 'calculated'
export const LIST_COLUMN_TYPES: ListColumnType[] = ['text', 'textarea', 'number', 'currency', 'date', 'choice', 'boolean', 'email', 'lookup', 'calculated']
export const LIST_COLUMN_TYPE_LABELS: Record<ListColumnType, string> = {
  text: 'Text', textarea: 'Long text', number: 'Number', currency: 'Currency', date: 'Date', choice: 'Choice', boolean: 'Yes / no', email: 'Email', lookup: 'Lookup (table / API)', calculated: 'Calculated',
}

/** `view` (default): the rows, filled by "Add row to list" rules; `inline`: the rows edited in place. */
export type ListEntryMode = 'view' | 'inline'
export const LIST_ENTRY_MODES: ListEntryMode[] = ['view', 'inline']
export const LIST_ENTRY_MODE_LABELS: Record<ListEntryMode, string> = { view: 'List view (rows added by a rule)', inline: 'Editable table' }

/** How rows show: a table (cards on phones), always a table, always cards. */
export type ListDisplay = 'auto' | 'table' | 'cards'
export const LIST_DISPLAYS: ListDisplay[] = ['auto', 'table', 'cards']
export const LIST_DISPLAY_LABELS: Record<ListDisplay, string> = { auto: 'Table (cards on phones)', table: 'Always a table', cards: 'Always cards' }

export type ListTotalFn = 'sum' | 'avg' | 'count'
export const LIST_TOTAL_FNS: ListTotalFn[] = ['sum', 'avg', 'count']
export const LIST_TOTAL_FN_LABELS: Record<ListTotalFn, string> = { sum: 'Sum', avg: 'Average', count: 'Count' }

export interface ListColumn {
  /** snake_case; the row object's key. */
  key: string
  label: string
  type: ListColumnType
  required?: boolean
  /** The value a new row starts with (text; typed like the column). */
  default?: string
  placeholder?: string
  help_text?: string
  /** number / currency / calculated: value bounds; text-like: length bounds. */
  min?: number
  max?: number
  /** choice: allowed values (and their labels when they differ). */
  options?: string[]
  option_labels?: Record<string, string>
  /** currency: ISO 4217 code (default USD). */
  currency?: string
  /** calculated: arithmetic over the row's number columns, e.g. `quantity * unit_price`. */
  formula?: string
  /** Kept in the row (a link key a rule sets — e.g. the id of a row of another List) but not shown. */
  hidden?: boolean
  /**
   * Read-only when editing: a row already in the list keeps this column's
   * value — inline cells don't edit it, an "Edit row" input mapped to it is
   * locked, and rules (Set row values, Update a row) leave it alone. A new
   * row may still get it from its default or a rule before its first commit.
   */
  read_only?: boolean
  /**
   * lookup: the source (a data table or an API reference — the Autocomplete
   * field's config, lib/forms/lookup.ts). The cell stores the value (row id or
   * the value column) and `<column>_label` beside it; filters / inputs may
   * read the same row ({{row.<column>}}) or the form ({{form.x}}).
   */
  lookup?: LookupConfig
}

/** The key a lookup column's display label is kept under in the row (`product` → `product_label`). */
export function listLabelKey(column: string): string {
  return `${column}_label`
}

/** A button on every row of the list view: pressing it fires the rule event "List: row button clicked" with the row ({{row.*}}). */
export interface ListRowButton {
  id: string
  label: string
  style?: 'default' | 'danger'
}

export interface ListTotal {
  /** A number / currency / calculated column (any column for count). */
  column: string
  fn: ListTotalFn
  label?: string
}

export interface ListFieldConfig {
  columns: ListColumn[]
  min_rows?: number
  max_rows?: number
  /** 'inline': rows edited in place; absent: the list view (rows added by rules). */
  entry_mode?: 'inline'
  totals?: ListTotal[]
  display?: ListDisplay
  /** Buttons on each row (list view): rules react with event list_row_button (event.button = the id). */
  row_buttons?: ListRowButton[]
  /** A click on a row fires "List: row clicked" (event list_row_click; e.g. load it back into the inputs to edit). */
  row_click?: boolean
  /** List view: the cells are editable in place (no Add row; rows come from rules). */
  inline_edit?: boolean
  /**
   * Row selection (list view): 'single' (a click / tap / Space selects a row)
   * or 'multiple' (checkboxes, select-all). With selection on, a click selects
   * — row_click does not fire; editing stays a button. UI state only: rules
   * read {{form.<list>_selected}} (row numbers), {{form.<list>_selected_row.<column>}}
   * and {{form.<list>_selected_count}}; never submitted.
   */
  selectable?: 'single' | 'multiple'
  /**
   * Rows a rule created ("New row") or changed ("Set row values") stay
   * pending until "Commit row". At submit, pending rows are: 'block' (the
   * default — the submission stops: commit or discard them first),
   * 'exclude' (new ones dropped, changed ones back to what they were) or
   * 'commit' (taken as they are).
   */
  on_submit_pending?: ListPendingMode
  /** Pending rows show a ✓ Commit and ✕ Discard on the row itself. */
  row_commit_controls?: boolean
  /**
   * The column that identifies a row (an order line's id): on submit, a row
   * whose key matches a row the form opened with keeps that row's read-only
   * columns — whatever the browser sent.
   */
  key_column?: string
}

export type ListPendingMode = 'exclude' | 'block' | 'commit'
export const LIST_PENDING_MODES: ListPendingMode[] = ['block', 'exclude', 'commit']
export const LIST_PENDING_MODE_LABELS: Record<ListPendingMode, string> = {
  block: 'Stop the submission (commit or discard first)',
  exclude: 'Leave them out (changes undone)',
  commit: 'Submit them as they are',
}

export { ROW_DRAFT_KEY, ROW_ORIGINAL_KEY, ROW_ERRORS_KEY, rowDraftState, rowCellErrors, stripRowMarkers, type RowDraftState } from './row-markers'

/** Columns that are read-only when editing a row already in the list. */
export function listReadOnlyColumns(config: ListFieldConfig | undefined): string[] {
  return (config?.columns ?? []).filter((c) => c.read_only).map((c) => c.key)
}

/** Whether a rule / an input may write a column of this row: read-only columns only on a new row not yet committed. */
export function listColumnWritable(config: ListFieldConfig | undefined, column: string, row: Record<string, unknown> | null | undefined): boolean {
  const col = config?.columns.find((c) => c.key === column)
  if (!col) return false
  if (col.type === 'calculated') return false
  return !col.read_only || !row || rowDraftState(row) === 'new'
}

/** How many rows are pending (new or changed since their last commit). */
export function pendingListRows(value: unknown): number {
  return rawListRows(value).filter((r) => rowDraftState(r) !== null).length
}

/**
 * The rows a submission takes, with the List's pending rule applied:
 * 'exclude' drops new drafts and puts edited rows back as they were;
 * 'commit' and 'block' keep them (block is reported by checkListValue).
 */
export function settleListRows(config: ListFieldConfig | undefined, value: unknown): Record<string, unknown>[] {
  const rows = rawListRows(value)
  if ((config?.on_submit_pending ?? 'block') !== 'exclude') return rows
  const out: Record<string, unknown>[] = []
  for (const row of rows) {
    const state = rowDraftState(row)
    if (state === 'new') continue
    if (state === 'edited' && isPlainObject(row[ROW_ORIGINAL_KEY])) { out.push(row[ROW_ORIGINAL_KEY] as Record<string, unknown>); continue }
    out.push(row)
  }
  return out
}

/**
 * Server merge: a submitted row whose key (config.key_column) matches a row
 * the form opened with keeps that row's read-only columns. Returns the rows
 * and the columns that were put back (a logged warning, not an error).
 */
export function keepReadOnlyListColumns(config: ListFieldConfig | undefined, submitted: unknown, stored: unknown): { rows: unknown; restored: string[] } {
  const readOnly = listReadOnlyColumns(config)
  const key = config?.key_column
  if (!config || !readOnly.length || !key || !Array.isArray(submitted)) return { rows: submitted, restored: [] }
  const before = new Map<string, Record<string, unknown>>()
  for (const row of rawListRows(stored)) { const k = row[key]; if (k !== null && k !== undefined && k !== '') before.set(String(k), row) }
  const restored = new Set<string>()
  const rows = submitted.map((row) => {
    if (!isPlainObject(row)) return row
    const k = row[key]
    const original = k === null || k === undefined || k === '' ? undefined : before.get(String(k))
    if (!original) return row
    const next: Record<string, unknown> = { ...row }
    for (const col of readOnly) {
      if (JSON.stringify(next[col] ?? null) !== JSON.stringify(original[col] ?? null)) restored.add(col)
      next[col] = original[col] ?? null
      if (config.columns.find((c) => c.key === col)?.type === 'lookup') next[listLabelKey(col)] = original[listLabelKey(col)] ?? null
    }
    return next
  })
  return { rows, restored: [...restored] }
}

/** Where the selected rows of each List live in the values ({ <list>: [0-based indexes] }); never stored. */
export const LIST_SELECT_KEY = '__list_select'

/** The selected rows (0-based, ascending) of a List. */
export function listSelection(values: Record<string, unknown> | null | undefined, list: string): number[] {
  const all = values?.[LIST_SELECT_KEY]
  const raw = isPlainObject(all) ? all[list] : undefined
  return Array.isArray(raw) ? [...new Set(raw.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0))].sort((a, b) => a - b) : []
}

/** The selection marker with one List's selection set (an empty list removes it). */
export function withListSelected(values: Record<string, unknown> | null | undefined, list: string, indexes: number[]): Record<string, unknown> {
  const current = isPlainObject(values?.[LIST_SELECT_KEY]) ? { ...(values![LIST_SELECT_KEY] as Record<string, unknown>) } : {}
  const clean = [...new Set(indexes.filter((i) => Number.isInteger(i) && i >= 0))].sort((a, b) => a - b)
  if (clean.length) current[list] = clean
  else delete current[list]
  return current
}

/** Row indexes after some rows were removed: removed ones dropped, later ones moved up. */
export function remapAfterRemoval(indexes: number[], removed: ReadonlySet<number>): number[] {
  return indexes.filter((i) => !removed.has(i)).map((i) => i - [...removed].filter((r) => r < i).length)
}

/** The keys a List's selection is read under by rules (`<list>_selected`, `_selected_row`, `_selected_count`). */
export function listSelectionKeys(list: string): string[] {
  return [`${list}_selected`, `${list}_selected_row`, `${list}_selected_count`]
}

/**
 * What rules read about each selectable List's selection: the selected row
 * numbers (1-based), the first selected row's values and the count. Added to
 * the values rules and buttons judge (in the browser, and on the server from
 * the sent marker) — never stored.
 */
export function listSelectionEntries(fields: Array<{ key: string; type: string; list?: ListFieldConfig }>, values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (f.type !== 'list' || !f.list?.selectable) continue
    const rows = rawListRows(values[f.key])
    const selected = listSelection(values, f.key).filter((i) => i < rows.length)
    out[`${f.key}_selected`] = selected.map((i) => i + 1)
    out[`${f.key}_selected_row`] = selected.length ? rows[selected[0]] : null
    out[`${f.key}_selected_count`] = selected.length
  }
  return out
}

/**
 * Editing a row that is already in the list (the "Edit" pattern): values
 * hold, under this key, the row each List is editing ({ <list>: index });
 * "Add row to list" then replaces that row instead of appending, and
 * "Cancel editing" forgets it. Never stored with a submission.
 */
export const LIST_EDIT_KEY = '__list_edit'

/** The row (0-based) a List is editing, or null. */
export function listEditingRow(values: Record<string, unknown> | null | undefined, list: string): number | null {
  const all = values?.[LIST_EDIT_KEY]
  const at = isPlainObject(all) ? all[list] : undefined
  return typeof at === 'number' && Number.isInteger(at) && at >= 0 ? at : null
}

/** The edit marker with one List's entry set (index) or removed (null). */
export function withListEditing(values: Record<string, unknown> | null | undefined, list: string, index: number | null): Record<string, unknown> {
  const current = isPlainObject(values?.[LIST_EDIT_KEY]) ? { ...(values![LIST_EDIT_KEY] as Record<string, unknown>) } : {}
  if (index === null) delete current[list]
  else current[list] = index
  return current
}

export type ListRow = Record<string, string | number | boolean | null>

/** A new List field in the designer: line items with a calculated total. */
export const DEFAULT_LIST_CONFIG: ListFieldConfig = {
  columns: [
    { key: 'item', label: 'Item', type: 'text', required: true },
    { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, default: '1' },
    { key: 'unit_price', label: 'Unit price', type: 'currency', currency: 'USD' },
    { key: 'total', label: 'Total', type: 'calculated', formula: 'quantity * unit_price', currency: 'USD' },
  ],
  totals: [{ column: 'total', fn: 'sum' }],
}

export const LIST_LIMITS = { columns: 30, rows: 500, options: 200, text: 5000, formula: 300 } as const

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CURRENCY_RE = /^[A-Z]{3}$/
const RESERVED_COLUMN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const NUMERIC_COLUMNS: ReadonlySet<ListColumnType> = new Set(['number', 'currency', 'calculated'])
const TEXT_COLUMNS: ReadonlySet<ListColumnType> = new Set(['text', 'textarea', 'email'])

export function isNumericColumn(column: Pick<ListColumn, 'type'>): boolean {
  return NUMERIC_COLUMNS.has(column.type)
}

/** Columns the person fills in (calculated ones are worked out). */
export function inputColumns(config: ListFieldConfig | undefined): ListColumn[] {
  return (config?.columns ?? []).filter((c) => c.type !== 'calculated')
}

/** Columns shown in the list view (hidden link keys left out). */
export function shownColumns(config: ListFieldConfig | undefined): ListColumn[] {
  return (config?.columns ?? []).filter((c) => !c.hidden)
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'c_$1').slice(0, 64)
}

function finite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function cleanText(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined
  const s = String(value).trim()
  return s ? s.slice(0, max) : undefined
}

function normalizeColumn(raw: unknown, seen: Set<string>): ListColumn | null {
  if (!isPlainObject(raw)) return null
  const label = cleanText(raw.label, 120) ?? ''
  const key = slug(cleanText(raw.key, 64) ?? label)
  if (!key || !KEY_RE.test(key) || seen.has(key) || RESERVED_COLUMN_KEYS.has(key)) return null
  seen.add(key)
  const rawType = raw.type === 'select' ? 'choice' : raw.type === 'checkbox' ? 'boolean' : raw.type === 'formula' ? 'calculated' : raw.type
  const type: ListColumnType = (LIST_COLUMN_TYPES as string[]).includes(rawType as string) ? rawType as ListColumnType : 'text'
  const column: ListColumn = { key, label: label || key, type }
  if (raw.required === true && type !== 'calculated' && type !== 'boolean') column.required = true
  const placeholder = cleanText(raw.placeholder, 200)
  if (placeholder && type !== 'boolean' && type !== 'calculated') column.placeholder = placeholder
  const help = cleanText(raw.help_text, 500)
  if (help) column.help_text = help
  if (raw.hidden === true) column.hidden = true
  if (raw.read_only === true && type !== 'calculated') column.read_only = true
  if (type !== 'calculated') {
    const def = raw.default === true || raw.default === false ? String(raw.default) : cleanText(raw.default, 500)
    if (def !== undefined) column.default = def
  }
  if (NUMERIC_COLUMNS.has(type) || TEXT_COLUMNS.has(type)) {
    const min = finite(raw.min)
    const max = finite(raw.max)
    if (min !== undefined) column.min = TEXT_COLUMNS.has(type) ? Math.max(0, Math.floor(min)) : min
    if (max !== undefined) column.max = TEXT_COLUMNS.has(type) ? Math.max(0, Math.floor(max)) : max
  }
  if (type === 'choice') {
    const options: string[] = []
    const labels: Record<string, string> = {}
    for (const entry of Array.isArray(raw.options) ? raw.options : []) {
      const value = isPlainObject(entry) ? cleanText(entry.value ?? entry.label, 200) : cleanText(entry, 200)
      if (!value || options.includes(value) || options.length >= LIST_LIMITS.options) continue
      options.push(value)
      const shown = isPlainObject(entry) ? cleanText(entry.label, 200) : undefined
      if (shown && shown !== value) labels[value] = shown
    }
    if (isPlainObject(raw.option_labels)) {
      for (const [value, shown] of Object.entries(raw.option_labels)) {
        const text = cleanText(shown, 200)
        if (options.includes(value) && text && text !== value) labels[value] = text
      }
    }
    column.options = options
    if (Object.keys(labels).length) column.option_labels = labels
  }
  if (type === 'currency' || (type === 'calculated' && typeof raw.currency === 'string')) {
    const code = typeof raw.currency === 'string' ? raw.currency.trim().toUpperCase() : ''
    if (CURRENCY_RE.test(code)) column.currency = code
  }
  if (type === 'calculated') {
    const formula = cleanText(raw.formula ?? raw.expression, LIST_LIMITS.formula)
    if (formula) column.formula = formula
  }
  if (type === 'lookup') column.lookup = { ...normalizeLookupConfig(raw.lookup), multiple: undefined } as LookupConfig
  return column
}

/** A clean List config: columns (deduped snake_case keys, known types), row limits, entry mode, totals, display. */
export function normalizeListConfig(raw: unknown): ListFieldConfig {
  const r = isPlainObject(raw) ? raw : {}
  const seen = new Set<string>()
  const columns: ListColumn[] = []
  for (const entry of Array.isArray(r.columns) ? r.columns : []) {
    if (columns.length >= LIST_LIMITS.columns) break
    const column = normalizeColumn(entry, seen)
    if (column) columns.push(column)
  }
  const config: ListFieldConfig = { columns }
  const minRows = finite(r.min_rows)
  const maxRows = finite(r.max_rows)
  if (minRows !== undefined && minRows > 0) config.min_rows = Math.min(LIST_LIMITS.rows, Math.floor(minRows))
  if (maxRows !== undefined && maxRows > 0) config.max_rows = Math.min(LIST_LIMITS.rows, Math.floor(maxRows))
  if (r.entry_mode === 'inline') config.entry_mode = 'inline'
  if (r.display === 'table' || r.display === 'cards' || r.display === 'auto') config.display = r.display
  const keys = new Set(columns.map((c) => c.key))
  const totals: ListTotal[] = []
  for (const entry of Array.isArray(r.totals) ? r.totals : []) {
    if (!isPlainObject(entry)) continue
    const column = typeof entry.column === 'string' ? entry.column : ''
    const fn: ListTotalFn = entry.fn === 'avg' || entry.fn === 'count' ? entry.fn : 'sum'
    if (!keys.has(column) || totals.some((t) => t.column === column && t.fn === fn)) continue
    const total: ListTotal = { column, fn }
    const label = cleanText(entry.label, 80)
    if (label) total.label = label
    totals.push(total)
  }
  if (totals.length) config.totals = totals
  const buttons: ListRowButton[] = []
  for (const b of Array.isArray(r.row_buttons) ? r.row_buttons : []) {
    if (!isPlainObject(b) || buttons.length >= 4) continue
    const label = cleanText(b.label, 40)
    const id = slug(cleanText(b.id, 40) ?? label ?? '')
    if (!label || !id || buttons.some((x) => x.id === id)) continue
    buttons.push({ id, label, ...(b.style === 'danger' ? { style: 'danger' as const } : {}) })
  }
  if (buttons.length) config.row_buttons = buttons
  if (r.row_click === true) config.row_click = true
  if (r.inline_edit === true) config.inline_edit = true
  if (r.selectable === 'single' || r.selectable === 'multiple') config.selectable = r.selectable
  if (r.on_submit_pending === 'exclude' || r.on_submit_pending === 'commit') config.on_submit_pending = r.on_submit_pending
  if (r.row_commit_controls === true) config.row_commit_controls = true
  if (typeof r.key_column === 'string' && keys.has(r.key_column)) config.key_column = r.key_column
  return config
}

export function listEntryMode(config: ListFieldConfig | undefined): ListEntryMode {
  return config?.entry_mode === 'inline' ? 'inline' : 'view'
}

/* ── Calculated columns: + - * / ( ) over number columns ─────────────── */

type Token = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string }

function tokenize(formula: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < formula.length) {
    const ch = formula[i]
    if (/\s/.test(ch)) { i++; continue }
    if ('+-*/()'.includes(ch)) { out.push({ t: 'op', v: ch }); i++; continue }
    const num = /^(?:\d+(?:\.\d+)?|\.\d+)/.exec(formula.slice(i))
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue }
    const id = /^[a-z_][a-z0-9_]*/i.exec(formula.slice(i))
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue }
    return null
  }
  return out
}

type Expr = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'neg'; e: Expr } | { k: 'bin'; op: string; a: Expr; b: Expr }

function parseFormula(formula: string): Expr | null {
  const tokens = tokenize(formula)
  if (!tokens || !tokens.length) return null
  let pos = 0
  const peek = () => tokens[pos]
  const expr = (): Expr | null => {
    let left = term()
    while (left && peek()?.t === 'op' && (peek()!.v === '+' || peek()!.v === '-')) {
      const op = (tokens[pos++] as { v: string }).v
      const right = term()
      if (!right) return null
      left = { k: 'bin', op, a: left, b: right }
    }
    return left
  }
  const term = (): Expr | null => {
    let left = factor()
    while (left && peek()?.t === 'op' && (peek()!.v === '*' || peek()!.v === '/')) {
      const op = (tokens[pos++] as { v: string }).v
      const right = factor()
      if (!right) return null
      left = { k: 'bin', op, a: left, b: right }
    }
    return left
  }
  const factor = (): Expr | null => {
    const tok = tokens[pos++]
    if (!tok) return null
    if (tok.t === 'num') return { k: 'num', v: tok.v }
    if (tok.t === 'id') return { k: 'id', v: tok.v }
    if (tok.v === '-') { const e = factor(); return e ? { k: 'neg', e } : null }
    if (tok.v === '(') {
      const e = expr()
      if (!e || tokens[pos]?.t !== 'op' || tokens[pos].v !== ')') return null
      pos++
      return e
    }
    return null
  }
  const tree = expr()
  return tree && pos === tokens.length ? tree : null
}

function formulaNames(tree: Expr, out: Set<string> = new Set()): Set<string> {
  if (tree.k === 'id') out.add(tree.v)
  else if (tree.k === 'neg') formulaNames(tree.e, out)
  else if (tree.k === 'bin') { formulaNames(tree.a, out); formulaNames(tree.b, out) }
  return out
}

function evaluate(tree: Expr, row: Record<string, unknown>): number | null {
  switch (tree.k) {
    case 'num': return tree.v
    case 'id': { const n = toNumber(row[tree.v]); return n === null ? 0 : n }
    case 'neg': { const v = evaluate(tree.e, row); return v === null ? null : -v }
    case 'bin': {
      const a = evaluate(tree.a, row)
      const b = evaluate(tree.b, row)
      if (a === null || b === null) return null
      if (tree.op === '/') return b === 0 ? null : a / b
      return tree.op === '+' ? a + b : tree.op === '-' ? a - b : a * b
    }
  }
}

/** Problem with a calculated column's formula (null = fine): syntax, unknown or non-number columns. */
export function formulaProblem(column: ListColumn, columns: ListColumn[]): string | null {
  if (!column.formula) return `Column "${column.label}": add a formula (e.g. quantity * unit_price)`
  const tree = parseFormula(column.formula)
  if (!tree) return `Column "${column.label}": the formula can use numbers, column keys, + - * / and brackets`
  const numeric = new Map(columns.filter((c) => c.key !== column.key).map((c) => [c.key, c]))
  for (const name of formulaNames(tree)) {
    const other = numeric.get(name)
    if (!other) return `Column "${column.label}": the formula reads an unknown column "${name}"`
    if (other.type !== 'number' && other.type !== 'currency') return `Column "${column.label}": "${name}" is not a number column`
  }
  return null
}

/** A calculated column's value for a row (rounded to 6 decimals); null when it can't be worked out. */
export function calculateColumn(column: ListColumn, row: Record<string, unknown>): number | null {
  const tree = column.formula ? parseFormula(column.formula) : null
  if (!tree) return null
  const v = evaluate(tree, row)
  return v === null || !Number.isFinite(v) ? null : Math.round(v * 1e6) / 1e6
}

/* ── Config problems ─────────────────────────────────────────────────── */

/** The designer's / server's blocking problem with a List config (null = fine). */
export function listConfigProblem(config: ListFieldConfig | undefined): string | null {
  if (!config || !config.columns.length) return 'Add at least one column'
  if (!inputColumns(config).length) return 'Add a column people fill in (not only calculated ones)'
  for (const column of config.columns) {
    if (column.type === 'choice' && !(column.options ?? []).length) return `Column "${column.label}": add at least one option`
    if (column.type === 'lookup' && !(column.lookup?.source === 'reference' ? column.lookup.reference_id : column.lookup?.table_id)) return `Column "${column.label}": choose the lookup's ${column.lookup?.source === 'reference' ? 'API reference' : 'data table'}`
    if (column.type === 'calculated') { const p = formulaProblem(column, config.columns); if (p) return p }
    if (column.min !== undefined && column.max !== undefined && column.min > column.max) return `Column "${column.label}": the minimum is greater than the maximum`
  }
  if (config.min_rows !== undefined && config.max_rows !== undefined && config.min_rows > config.max_rows) return 'At least (rows) is greater than at most (rows)'
  for (const total of config.totals ?? []) {
    const column = config.columns.find((c) => c.key === total.column)
    if (column && total.fn !== 'count' && !isNumericColumn(column)) return `Total of "${column.label}": only number, currency and calculated columns add up`
  }
  return null
}

/* ── Values ──────────────────────────────────────────────────────────── */

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean' || value === null || value === undefined) return null
  const s = String(value).trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value ?? '').trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'off', ''].includes(s)) return false
  return null
}

function blankCell(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** The submitted value as a list of row objects (an array, or JSON text of one); anything else → []. */
export function rawListRows(value: unknown): Record<string, unknown>[] {
  let list: unknown = value
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s.startsWith('[')) return []
    try { list = JSON.parse(s) } catch { return [] }
  }
  if (!Array.isArray(list)) return []
  return list.filter(isPlainObject) as Record<string, unknown>[]
}

/** A row nobody filled in: every input column blank (booleans unticked). */
export function isBlankListRow(config: ListFieldConfig, row: Record<string, unknown>): boolean {
  return inputColumns(config).every((c) => (c.type === 'boolean' ? toBoolean(row[c.key]) !== true : blankCell(row[c.key])))
}

function coerceCell(column: ListColumn, value: unknown): string | number | boolean | null {
  switch (column.type) {
    case 'number':
    case 'currency':
      return toNumber(value)
    case 'boolean':
      return toBoolean(value) ?? false
    case 'date': {
      if (blankCell(value)) return null
      const s = String(value).trim()
      return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
    }
    default:
      if (blankCell(value)) return null
      return (typeof value === 'string' ? value : String(value)).slice(0, LIST_LIMITS.text)
  }
}

/** One row typed: the columns only (unknown keys dropped), calculated columns worked out. */
export function coerceListRow(config: ListFieldConfig, row: Record<string, unknown>): ListRow {
  const out: ListRow = {}
  for (const column of config.columns) if (column.type !== 'calculated') out[column.key] = coerceCell(column, row[column.key])
  for (const column of config.columns) if (column.type === 'calculated') out[column.key] = calculateColumn(column, out)
  // A lookup cell keeps its display label beside the value (`product_label`; the server re-reads it on submit).
  for (const column of config.columns) {
    if (column.type !== 'lookup') continue
    const label = row[listLabelKey(column.key)]
    out[listLabelKey(column.key)] = out[column.key] === null ? null : typeof label === 'string' && label.trim() ? label.slice(0, 500) : out[column.key] === null ? null : String(out[column.key])
  }
  return out
}

/** The stored value: typed rows, blank rows dropped, at most the hard limit. */
export function coerceListRows(config: ListFieldConfig | undefined, value: unknown): ListRow[] {
  if (!config) return []
  // Pending rows (lib/forms/row-rules.ts): left out or taken as they are (the List's on_submit_pending).
  return settleListRows(config, value).filter((row) => !isBlankListRow(config, row)).slice(0, LIST_LIMITS.rows).map((row) => coerceListRow(config, row))
}

/** A new row: each input column's default (typed), calculated columns worked out. */
export function blankListRow(config: ListFieldConfig): ListRow {
  const seed: Record<string, unknown> = {}
  for (const column of inputColumns(config)) seed[column.key] = column.default ?? (column.type === 'boolean' ? false : null)
  return coerceListRow(config, seed)
}

/** What the inputs hold for a row while editing (text the inputs show). */
export function listRowDraft(config: ListFieldConfig, row?: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of inputColumns(config)) {
    const v = row ? row[column.key] : (column.default ?? (column.type === 'boolean' ? false : ''))
    out[column.key] = column.type === 'boolean' ? toBoolean(v) === true : v === null || v === undefined ? '' : v
  }
  return out
}

/** Per-column problems with one row (column key → message); empty when the row is fine. */
export function listRowErrors(config: ListFieldConfig, row: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const column of config.columns) {
    const value = column.type === 'calculated' ? calculateColumn(column, coerceListRow(config, row)) : row[column.key]
    const name = column.label
    if (column.type === 'calculated') {
      if (value === null) continue
      if (column.min !== undefined && (value as number) < column.min) errors[column.key] = `${name} must be at least ${column.min}`
      else if (column.max !== undefined && (value as number) > column.max) errors[column.key] = `${name} must be at most ${column.max}`
      continue
    }
    if (column.type === 'boolean') {
      if (!blankCell(value) && toBoolean(value) === null) errors[column.key] = `${name} must be yes or no`
      continue
    }
    if (blankCell(value)) {
      if (column.required) errors[column.key] = `${name} is required`
      continue
    }
    if (typeof value === 'object') { errors[column.key] = `${name} has an invalid value`; continue }
    const s = String(value).trim()
    switch (column.type) {
      case 'number':
      case 'currency': {
        const n = toNumber(value)
        if (n === null) errors[column.key] = `${name} must be a number`
        else if (column.min !== undefined && n < column.min) errors[column.key] = `${name} must be at least ${column.min}`
        else if (column.max !== undefined && n > column.max) errors[column.key] = `${name} must be at most ${column.max}`
        break
      }
      case 'date':
        if (!DATE_RE.test(s.slice(0, 10)) || Number.isNaN(new Date(s.slice(0, 10)).getTime())) errors[column.key] = `${name} must be a date (YYYY-MM-DD)`
        break
      case 'choice':
        if (!(column.options ?? []).includes(s)) errors[column.key] = `${name} must be one of: ${(column.options ?? []).join(', ')}`
        break
      default:
        if (s.length > LIST_LIMITS.text) errors[column.key] = `${name} is too long`
        else if (column.type === 'email' && !EMAIL_RE.test(s)) errors[column.key] = `${name} must be an email address`
        else if (column.min !== undefined && s.length < column.min) errors[column.key] = `${name} must be at least ${column.min} characters`
        else if (column.max !== undefined && s.length > column.max) errors[column.key] = `${name} must be at most ${column.max} characters`
    }
  }
  return errors
}

export interface ListValueCheck {
  /** Problems, worded for the person ("Row 2: Quantity is required"). */
  errors: string[]
  /** Per row (index in the submitted, non-blank rows) → column → message. */
  rowErrors: Record<number, Record<string, string>>
  /** The rows counted (blank rows left out). */
  count: number
}

/**
 * Check a submitted List value: an array of row objects; every row's
 * columns (required, types, bounds, options); the row count against
 * min / max rows and the hard limit; `required` = at least one row.
 */
export function checkListValue(config: ListFieldConfig | undefined, value: unknown, required = false): ListValueCheck {
  const out: ListValueCheck = { errors: [], rowErrors: {}, count: 0 }
  if (!config) { out.errors.push('the list is not configured'); return out }
  const blank = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  if (!blank && !Array.isArray(value) && !(typeof value === 'string' && value.trim().startsWith('['))) { out.errors.push('has an invalid value (a list of rows is expected)'); return out }
  const list = blank ? [] : typeof value === 'string' ? (() => { try { const p = JSON.parse(value); return Array.isArray(p) ? p : null } catch { return null } })() : value as unknown[]
  if (list === null) { out.errors.push('has an invalid value (a list of rows is expected)'); return out }
  if (list.some((row) => !isPlainObject(row))) { out.errors.push('has an invalid row'); return out }
  // Pending rows: 'block' stops the submission until they are committed or discarded; 'exclude' leaves them out.
  const pending = (list as Record<string, unknown>[]).filter((row) => rowDraftState(row) !== null).length
  if (pending && (config.on_submit_pending ?? 'block') === 'block') out.errors.push(`commit or discard the ${pending === 1 ? 'pending row' : `${pending} pending rows`} first`)
  const rows = settleListRows(config, list).filter((row) => !isBlankListRow(config, row))
  out.count = rows.length
  if (rows.length > LIST_LIMITS.rows) { out.errors.push(`at most ${LIST_LIMITS.rows} rows`); return out }
  rows.forEach((row, i) => {
    const problems = listRowErrors(config, row)
    if (Object.keys(problems).length) {
      out.rowErrors[i] = problems
      out.errors.push(`row ${i + 1}: ${Object.values(problems)[0]}`)
    }
  })
  const min = Math.max(config.min_rows ?? 0, required ? 1 : 0)
  if (rows.length < min) out.errors.push(min === 1 ? 'add at least one row' : `add at least ${min} rows`)
  if (config.max_rows !== undefined && rows.length > config.max_rows) out.errors.push(`at most ${config.max_rows} ${config.max_rows === 1 ? 'row' : 'rows'}`)
  return out
}

/* ── Totals and the run's derived values ─────────────────────────────── */

export function listCountKey(fieldKey: string): string {
  return `${fieldKey}_count`
}

export function listTotalKey(fieldKey: string, total: Pick<ListTotal, 'column' | 'fn'>): string {
  return `${fieldKey}_${total.fn === 'sum' ? 'total' : total.fn}_${total.column}`
}

/** Every key the field adds beside its rows: `<key>_count` and one per total. */
export function listDerivedKeys(fieldKey: string, config: ListFieldConfig | undefined): string[] {
  // A selectable List also owns the keys rules read its selection under.
  return [listCountKey(fieldKey), ...(config?.totals ?? []).map((t) => listTotalKey(fieldKey, t)), ...(config?.selectable ? listSelectionKeys(fieldKey).filter((k) => k !== listCountKey(fieldKey)) : [])]
}

/** A total over typed rows (sum / average rounded to 6 decimals; count = rows with a value). */
export function listTotalValue(total: ListTotal, rows: ListRow[]): number | null {
  const values = rows.map((r) => r[total.column])
  if (total.fn === 'count') return values.filter((v) => !(v === null || v === undefined || v === '' || v === false)).length
  const numbers = values.map((v) => toNumber(v)).filter((n): n is number => n !== null)
  if (!numbers.length) return total.fn === 'sum' ? 0 : null
  const sum = numbers.reduce((a, b) => a + b, 0)
  return Math.round((total.fn === 'sum' ? sum : sum / numbers.length) * 1e6) / 1e6
}

/** `<key>_count` and the configured totals, from the typed rows (what the run and the submission carry). */
export function listDerivedValues(fieldKey: string, config: ListFieldConfig | undefined, rows: unknown): Record<string, number | null> {
  const typed = config ? coerceListRows(config, rows) : []
  const out: Record<string, number | null> = { [listCountKey(fieldKey)]: typed.length }
  for (const total of config?.totals ?? []) out[listTotalKey(fieldKey, total)] = listTotalValue(total, typed)
  return out
}

/* ── Formatting ──────────────────────────────────────────────────────── */

/** "3 rows" (the one-line summary for tables, reports and the timeline). */
export function describeListValue(value: unknown): string {
  const n = rawListRows(value).length
  return n === 0 ? '—' : `${n} ${n === 1 ? 'row' : 'rows'}`
}

/** A cell as the person reads it (currency formatted, Yes / No, option labels). */
export function formatListCell(column: ListColumn, value: unknown, row?: Record<string, unknown>): string {
  if (value === null || value === undefined || value === '') return '—'
  if (column.type === 'lookup') { const label = row?.[listLabelKey(column.key)]; return typeof label === 'string' && label ? label : String(value) }
  if (column.type === 'boolean') return toBoolean(value) ? 'Yes' : 'No'
  if (column.type === 'choice') return column.option_labels?.[String(value)] ?? String(value)
  if (column.type === 'currency' || (column.type === 'calculated' && column.currency)) {
    const n = toNumber(value)
    if (n === null) return String(value)
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: column.currency ?? 'USD' }).format(n) } catch { return String(n) }
  }
  if (isNumericColumn(column)) {
    const n = toNumber(value)
    return n === null ? String(value) : new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(n)
  }
  return String(value)
}

/** A total as shown under the list. */
export function formatListTotal(config: ListFieldConfig, total: ListTotal, value: number | null): string {
  if (value === null) return '—'
  if (total.fn === 'count') return String(value)
  const column = config.columns.find((c) => c.key === total.column)
  return column ? formatListCell(column, value) : String(value)
}

export function listTotalLabel(config: ListFieldConfig, total: ListTotal): string {
  if (total.label) return total.label
  const column = config.columns.find((c) => c.key === total.column)
  const name = column?.label ?? total.column
  if (total.fn === 'sum' && /^(total|sum|amount)\b/i.test(name)) return name
  return total.fn === 'sum' ? `Total ${name.toLowerCase()}` : total.fn === 'avg' ? `Average ${name.toLowerCase()}` : `${name} (count)`
}

/** Rows as plain text, one per line (CSV / copy / Agent snapshots). */
export function listValueText(config: ListFieldConfig | undefined, value: unknown): string {
  if (!config) return describeListValue(value)
  return rawListRows(value).map((row, i) => `${i + 1}. ${config.columns.map((c) => `${c.label}: ${formatListCell(c, row[c.key], row)}`).join(', ')}`).join('\n')
}

/* ── The designer's "Add inputs and an Add button" helper ─────────────── */

/** An input field the kit creates for a column (a task field definition). */
export interface ListKitField {
  key: string
  label: string
  type: string
  required?: boolean
  options?: Array<string | { value: string; label: string }>
  min?: number
  max?: number
  min_length?: number
  max_length?: number
  currency?: string
  placeholder?: string
  default?: string
  help_text?: string
  button?: { style: 'primary' | 'secondary' | 'danger'; icon: 'plus' | 'x' | 'pencil' | 'minus' | 'rotate-ccw'; actions: []; requires_selection?: string; confirm?: string }
  lookup?: LookupConfig
  visible_when?: { field: string; operator: 'equals'; value: string }
}

type KitRule = { id: string; name: string; event: 'button_click' | 'list_row_button' | 'list_row_click'; target: string; if?: Record<string, unknown>; then: Array<Record<string, unknown>> }

export interface ListEntryKit {
  /** One input per column people fill in, the Add button and (with editing) the Cancel button. */
  fields: ListKitField[]
  /** The "Add row to list" rule on the button's click (it updates the row being edited, if any). */
  rule: KitRule
  /** Editing: load a row back into the inputs (its Edit button / a row click), and Cancel. */
  editRules: KitRule[]
  /** The state flag the editing rules set (declare it on the layout). */
  flag: string | null
  /** The List's own change (an Edit row button). */
  listPatch: Partial<ListFieldConfig>
}

const KIT_TYPE: Record<Exclude<ListColumnType, 'calculated'>, string> = {
  text: 'text', textarea: 'textarea', number: 'number', currency: 'currency', date: 'date', choice: 'choice', boolean: 'boolean', email: 'email', lookup: 'lookup',
}

/**
 * The fields and rule behind the user's pattern — inputs, an "Add" button,
 * and a rule that turns the inputs into a row of the list: one input per
 * column (key `<list>_<column>`, a unique key when taken), a button and an
 * "Add row to list" rule (values `{{<input>}}`, required columns required,
 * the inputs cleared after adding). The author can change all of it.
 */
export function listEntryKit(listKey: string, listLabel: string, config: ListFieldConfig, taken: Iterable<string>, options: { ruleId?: string; buttonLabel?: string; edit?: 'button' | 'row_click' | false; ruleIds?: string[]; selection?: 'single' | 'multiple' } = {}): ListEntryKit {
  const used = new Set(taken)
  const unique = (base: string) => {
    let key = base.slice(0, 64)
    for (let i = 2; used.has(key); i++) key = `${base.slice(0, 60)}_${i}`
    used.add(key)
    return key
  }
  const fields: ListKitField[] = []
  const values: Record<string, string> = {}
  const require: string[] = []
  const kitColumns = inputColumns(config).filter((c) => !c.hidden)
  const keyOf = new Map(kitColumns.map((c) => [c.key, unique(`${listKey}_${c.key}`)]))
  for (const column of kitColumns) {
    const key = keyOf.get(column.key)!
    const field: ListKitField = { key, label: column.label, type: KIT_TYPE[column.type as Exclude<ListColumnType, 'calculated'>] ?? 'text' }
    // Options with their labels (a choice field reads labels from { value, label } entries).
    if (column.options) field.options = column.options.map((v) => (column.option_labels?.[v] ? { value: v, label: column.option_labels[v] } : v))
    const numeric = column.type === 'number' || column.type === 'currency'
    if (column.min !== undefined) { if (numeric) field.min = column.min; else field.min_length = column.min }
    if (column.max !== undefined) { if (numeric) field.max = column.max; else field.max_length = column.max }
    if (column.currency) field.currency = column.currency
    if (column.placeholder) field.placeholder = column.placeholder
    if (column.default !== undefined) field.default = column.default
    if (column.help_text) field.help_text = column.help_text
    // A lookup depending on its row ({{row.country}}) reads the matching input instead ({{task_data.<list>_country}}).
    if (column.lookup) field.lookup = JSON.parse(JSON.stringify(column.lookup).replace(/\{\{\s*row\.([A-Za-z0-9_]+)\s*\}\}/g, (whole: string, c: string) => (keyOf.has(c) ? `{{task_data.${keyOf.get(c)}}}` : whole)))
    fields.push(field)
    values[column.key] = `{{${key}}}`
    if (column.required) require.push(key)
  }
  const buttonKey = unique(`${listKey}_add`)
  const buttonLabel = options.buttonLabel ?? `Add ${singular(listLabel).toLowerCase() || 'row'}`
  fields.push({ key: buttonKey, label: buttonLabel, type: 'button', button: { style: 'primary', icon: 'plus', actions: [] } })
  const action: Record<string, unknown> = { type: 'add_list_row', list_field: listKey, values }
  if (require.length) action.require = require
  // Row selection: Edit / Delete selected and Clear list buttons (editing works on the selection, not a row button / click).
  const edit = options.selection ? 'selected' : options.edit === undefined ? 'button' : options.edit
  const flag = edit ? `editing_${listKey}`.slice(0, 40) : null
  const ids = options.ruleIds ?? []
  const rule: KitRule = { id: options.ruleId ?? `r_add_${listKey}`.slice(0, 40), name: `${buttonLabel}: add a row to ${listLabel}`, event: 'button_click', target: buttonKey, then: flag ? [action, { type: 'set_state', flag, state_value: 'false' }] : [action] }
  if (!edit || !flag) return { fields, rule, editRules: [], flag: null, listPatch: {} }
  // Edit: the row's values back into the inputs ({{row.<column>}}), the List remembers the row; Add then updates it.
  const inputs = Object.entries(values).map(([column, template]) => ({ column, input: template.slice(2, -2) }))
  const assign = Object.fromEntries(inputs.map(({ column, input }) => [input, `{{row.${column}}}`]))
  const cancelKey = unique(`${listKey}_cancel`)
  fields.push({ key: cancelKey, label: 'Cancel editing', type: 'button', button: { style: 'secondary', icon: 'x', actions: [] }, visible_when: { field: `state.${flag}`, operator: 'equals', value: 'true' } })
  if (edit === 'selected') {
    const one = singular(listLabel).toLowerCase() || 'row'
    const editKey = unique(`${listKey}_edit_selected`)
    const deleteKey = unique(`${listKey}_delete_selected`)
    const clearKey = unique(`${listKey}_clear`)
    fields.push(
      { key: editKey, label: `Edit selected ${one}`, type: 'button', button: { style: 'secondary', icon: 'pencil', actions: [], requires_selection: listKey } },
      { key: deleteKey, label: 'Delete selected', type: 'button', button: { style: 'danger', icon: 'minus', actions: [], requires_selection: listKey } },
      { key: clearKey, label: 'Clear list', type: 'button', button: { style: 'secondary', icon: 'rotate-ccw', actions: [] } },
    )
    const empty = `Select a row of ${listLabel} first`
    const rules: KitRule[] = [
      { id: ids[0] ?? `r_edit_${listKey}`.slice(0, 40), name: `Edit the selected row of ${listLabel}`, event: 'button_click', target: editKey, then: [{ type: 'edit_list_row', list_field: listKey, row: 'selected', assign, empty_text: empty }, { type: 'set_state', flag, state_value: 'true' }] },
      { id: ids[1] ?? `r_cancel_${listKey}`.slice(0, 40), name: `Cancel editing ${listLabel}`, event: 'button_click', target: cancelKey, then: [{ type: 'cancel_list_edit', list_field: listKey, fields: inputs.map((i) => i.input) }, { type: 'set_state', flag, state_value: 'false' }] },
      { id: ids[2] ?? `r_delete_${listKey}`.slice(0, 40), name: `Delete the selected rows of ${listLabel}`, event: 'button_click', target: deleteKey, then: [{ type: 'remove_list_row', list_field: listKey, row: 'selected', confirm_text: 'Delete {{count}} selected row(s)?', empty_text: empty }] },
      { id: ids[3] ?? `r_clear_${listKey}`.slice(0, 40), name: `Clear ${listLabel}`, event: 'button_click', target: clearKey, then: [{ type: 'clear_list', list_field: listKey, confirm_text: 'Clear all rows?' }, { type: 'cancel_list_edit', list_field: listKey, fields: inputs.map((i) => i.input) }, { type: 'set_state', flag, state_value: 'false' }] },
    ]
    return { fields, rule, editRules: rules, flag, listPatch: { selectable: options.selection } }
  }
  const editRule: KitRule = edit === 'row_click'
    ? { id: ids[0] ?? `r_edit_${listKey}`.slice(0, 40), name: `Edit a row of ${listLabel}`, event: 'list_row_click', target: listKey, then: [] }
    : { id: ids[0] ?? `r_edit_${listKey}`.slice(0, 40), name: `Edit a row of ${listLabel}`, event: 'list_row_button', target: listKey, if: { match: 'all', conditions: [{ column: 'event.button', operator: 'eq', value: 'edit' }] }, then: [] }
  editRule.then = [{ type: 'edit_list_row', list_field: listKey, row: '{{event.row_number}}', assign }, { type: 'set_state', flag, state_value: 'true' }]
  const cancelRule: KitRule = { id: ids[1] ?? `r_cancel_${listKey}`.slice(0, 40), name: `Cancel editing ${listLabel}`, event: 'button_click', target: cancelKey, then: [{ type: 'cancel_list_edit', list_field: listKey, fields: inputs.map((i) => i.input) }, { type: 'set_state', flag, state_value: 'false' }] }
  const listPatch: Partial<ListFieldConfig> = edit === 'row_click'
    ? { row_click: true }
    : { row_buttons: [...(config.row_buttons ?? []).filter((b) => b.id !== 'edit'), { id: 'edit', label: 'Edit' }] }
  return { fields, rule, editRules: [editRule, cancelRule], flag, listPatch }
}

function singular(label: string): string {
  const words = label.trim().split(/\s+/)
  const last = words.pop() ?? ''
  const one = /ies$/i.test(last) ? last.replace(/ies$/i, 'y') : /ss$/i.test(last) ? last : last.replace(/s$/i, '')
  // "Line items" → "item"; a single word → itself, singular.
  return words.length && /^(line|order|expense)$/i.test(words[words.length - 1]) ? one : [...words, one].join(' ')
}
