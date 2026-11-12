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
import { groupConditions, normalizeConditionGroup, type DataTableConditionGroup } from './data-table'
import type { RuleScope } from './form-rules'
import { ROW_ORIGINAL_KEY, rowDraftState } from './row-markers'
import { CELL_RULE_LIMIT, NO_ROW_STYLE, ROW_STYLE_LIMIT, mergeStyles, normalizeConditionalStyle, type ListCellRule, type ListRowStyle, type RowStyleResult } from './conditional-style'
import { normalizeControlTextStyle, type ControlTextStyle } from './text-style'
import { describeSignature, normalizeSignatureConfig, normalizeSignatureValue, signatureValueError, type SignatureFieldConfig, type SignatureValue } from './media-fields'

/**
 * `field` is internal: a repeating section seen as a List (lib/forms/repeating-section.ts)
 * keeps a control the List columns don't model (rich text, files, people…) as it is.
 * Never offered in the designer (not in LIST_COLUMN_TYPES), never kept by normalizeListConfig.
 *
 * `signature`: an electronic signature per row (each line item / approver signs
 * their own row) — the same value as a Signature field (lib/forms/media-fields.ts
 * SignatureValue: the PNG's file object, method, typed name, signed_at and the
 * server-stamped signer). Its PNG is uploaded under the column's upload key
 * (listUploadKey: `<list>.<column>`, `<list>.<child>.<column>` in nested Lists),
 * re-read from the server's upload records on submit and stamped by the server.
 */
export type ListColumnType = 'text' | 'textarea' | 'number' | 'currency' | 'date' | 'choice' | 'boolean' | 'email' | 'lookup' | 'calculated' | 'list' | 'signature' | 'field'
export const LIST_COLUMN_TYPES: ListColumnType[] = ['text', 'textarea', 'number', 'currency', 'date', 'choice', 'boolean', 'email', 'lookup', 'calculated', 'signature', 'list']
export const LIST_COLUMN_TYPE_LABELS: Record<ListColumnType, string> = {
  text: 'Text', textarea: 'Long text', number: 'Number', currency: 'Currency', date: 'Date', choice: 'Choice', boolean: 'Yes / no', email: 'Email', lookup: 'Lookup (table / API)', calculated: 'Calculated', list: 'Nested list', signature: 'Signature', field: 'Form control',
}

/**
 * The upload key of a List signature column: the List's key and the column
 * path (`approvals.signature`; a nested List's `orders.lines.signed`). Field
 * keys have no dots, so it never names a form field. Row indexes are not part
 * of it: every row's signature is an upload of the same column.
 */
export function listUploadKey(listKey: string, columnPath: string[]): string {
  return [listKey, ...columnPath].join('.')
}

/** Every signature column of a config with its path (`signed`, `lines.signed`), any level. */
export function listSignatureColumns(config: ListFieldConfig | undefined, prefix: string[] = []): Array<{ column: ListColumn; path: string[] }> {
  const out: Array<{ column: ListColumn; path: string[] }> = []
  for (const c of config?.columns ?? []) {
    if (c.type === 'signature') out.push({ column: c, path: [...prefix, c.key] })
    else if (c.type === 'list' && c.list) out.push(...listSignatureColumns(c.list, [...prefix, c.key]))
  }
  return out
}

/** Whether a List (or a List nested in it) has a signature column. */
export function hasSignatureColumns(config: ListFieldConfig | undefined): boolean {
  return listSignatureColumns(config).length > 0
}

/** The signature column a column path names inside a List (`signature`, `lines.signed`), or null. */
export function signatureColumnAt(listConfig: ListFieldConfig | undefined, columnPath: string[]): ListColumn | null {
  if (!listConfig || !columnPath.length) return null
  let at: ListFieldConfig | undefined = listConfig
  for (const [i, step] of columnPath.entries()) {
    const column: ListColumn | undefined = at?.columns.find((c) => c.key === step)
    if (!column) return null
    if (i === columnPath.length - 1) return column.type === 'signature' ? column : null
    if (column.type !== 'list') return null
    at = column.list
  }
  return null
}

/**
 * Nested Lists: a column of type `list` holds, in each row, rows of its own
 * (`list` = the child List's config: columns of any type — itself possibly
 * nested — totals, min / max rows). The top List is level 1; at most
 * LIST_MAX_DEPTH levels. The value nests the same way:
 *
 *   [{ customer: 'Acme', lines: [{ sku: 'A-1', qty: 2, price: 1250, amount: 2500 }] }]
 *
 * Every rule of a level (types, required, read-only, min / max rows,
 * calculated columns, blank rows dropped) applies inside each parent row; a
 * value holds at most LIST_LIMITS.nestedRows rows over all levels.
 */
export const LIST_MAX_DEPTH = 3

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
  /**
   * list (a nested List): the child List's config — columns, totals,
   * min_rows / max_rows (also display, key_column, on_submit_pending,
   * row_commit_controls). `required` = each parent row needs a child row.
   */
  list?: ListFieldConfig
  /**
   * Validation (InfoPath's validation on a repeating field): when a
   * condition holds, its message shows on this cell and the row does not
   * pass. Subjects: `row.<column>` (this row, typed), `parent.<column>` (the
   * parent row of a nested List), `form.<field>`, `user.*`. Checked in the
   * browser and again on the server (checkListValue).
   */
  validations?: ListValidation[]
  /** Text styling (lib/forms/text-style.ts): `label` = the header (and the label in the row pop-out), `value` = the cells. */
  text_style?: ControlTextStyle
  /**
   * signature: draw / type / both, the statement shown above the pad and
   * capture_audit (the signer's IP address and browser, server-set) — the
   * Signature field's config (lib/forms/media-fields.ts; resign_on_change
   * does not apply to a cell).
   */
  signature?: SignatureFieldConfig
}

/** A List column's validation: the message shows on the cell while `if` holds. */
export interface ListValidation {
  if: DataTableConditionGroup
  /** The error text; `{{row.<column>}}`, `{{form.<field>}}` placeholders are filled in. */
  message: string
}

/** A row-level validation: the message shows on the row (or on `column`'s cell) while `if` holds. */
export interface ListRowValidation extends ListValidation {
  column?: string
}

/** Where a row-level error without a column sits in a row's errors (never a column key: those start with a letter). */
export const LIST_ROW_ERROR_KEY = '_row'

/**
 * What List validations read besides the row: the form's values
 * (`form.<field>`), the signed-in person (`user.*`) and, in a nested List,
 * the parent row (`parent.<column>`). Without it (a row checked on its own)
 * validations do not run.
 */
export interface ListCheckContext {
  form?: Record<string, unknown> | null
  /** The person; null = nobody signed in (no roles); undefined = not known here — validations reading `user.*` are skipped (the server judges them with its own user). */
  user?: Record<string, unknown> | null
  parent?: Record<string, unknown> | null
  /** Columns a form rule hides in every row (`column:<list>.<column>` — ruleHiddenColumns): not required, not checked. */
  hiddenColumns?: ReadonlySet<string> | null
}

/**
 * The form rules' condition evaluator (lib/forms/form-rules.ts registers it
 * when it loads — list-field cannot import it: form-rules → field-buttons →
 * list-field). One evaluator for rules and List validations alike.
 */
type RuleJudge = { conditionsMet: (group: DataTableConditionGroup | undefined, scope: RuleScope) => boolean; template: (text: string | undefined, scope: RuleScope) => unknown }
let judge: RuleJudge | null = null
export function registerListRuleJudge(next: RuleJudge): void { judge = next }
function ruleJudge(): RuleJudge {
  // Every caller that checks List validations has loaded the form rules (task-field-schema, the rules runtime, field-buttons' callers).
  if (!judge) throw new Error('List validations need lib/forms/form-rules (its condition evaluator) to be loaded')
  return judge
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
  /** Row-level validations (any level): the message shows on the row, or on `column`'s cell. */
  row_validations?: ListRowValidation[]
  /**
   * How an editable List's rows are edited: 'inline' (cells in place only),
   * 'popout' (each row opens as a form in a dialog — Add row too) or 'both'
   * (the default: cells in place, plus an "Open row" icon per row and "Add in
   * form"). Phones use the pop-out whenever it is allowed ('both' / 'popout').
   * Read-only Lists always offer "View row" (row_form.hide_view_icon hides it).
   */
  row_editing?: ListRowEditing
  /** The row pop-out (lib/forms/list-row-form.ts): its title, field order and sections. */
  row_form?: ListRowFormConfig
  /**
   * Conditional styling (any level; lib/forms/conditional-style.ts): while a
   * style's condition holds for a row, the row — or `column`'s cell — takes
   * its tone / emphasis. Same subjects as validations. Presentation only.
   */
  row_styles?: ListRowStyle<DataTableConditionGroup>[]
  /**
   * Cell rules (any level; InfoPath's hide / disable on a control in a
   * repeating table): while a rule's condition holds for a row, that row's
   * `column` cell is hidden (empty; the header stays) and / or read only.
   * Same subjects as validations. A hidden cell is not required or checked;
   * a read-only cell is not required, cannot be edited in the table or the
   * row pop-out, and the server keeps its stored value (keepLockedListCells).
   */
  cell_rules?: ListCellRule<DataTableConditionGroup>[]
}

export type ListRowEditing = 'inline' | 'popout' | 'both'
export const LIST_ROW_EDITINGS: ListRowEditing[] = ['both', 'inline', 'popout']
export const LIST_ROW_EDITING_LABELS: Record<ListRowEditing, string> = {
  both: 'In the table and in a pop-out form',
  inline: 'In the table only',
  popout: 'In a pop-out form only',
}

/** One entry of a row form's layout: a column (in this order) or a section heading. */
export type ListRowFormItem = { column: string } | { section: string }

/** The row pop-out's settings. */
export interface ListRowFormConfig {
  /** The dialog's title; `{{row.<column>}}` and `{{row_number}}` are filled in ("Expense: {{row.description}}"). */
  title?: string
  /** The columns in order, with optional section headings; columns left out follow at the end. */
  layout?: ListRowFormItem[]
  /** Read-only Lists: no "View row" icon. */
  hide_view_icon?: boolean
}

/** Stored row-form settings → clean ones (known columns once each, short headings), or undefined when empty. */
export function normalizeRowForm(raw: unknown, columnKeys: ReadonlySet<string>): ListRowFormConfig | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: ListRowFormConfig = {}
  const title = cleanText(raw.title, 200)
  if (title) out.title = title
  const layout: ListRowFormItem[] = []
  const used = new Set<string>()
  for (const entry of Array.isArray(raw.layout) ? raw.layout : []) {
    if (layout.length >= LIST_LIMITS.columns * 2) break
    if (typeof entry === 'string' && columnKeys.has(entry) && !used.has(entry)) { used.add(entry); layout.push({ column: entry }); continue }
    if (!isPlainObject(entry)) continue
    if (typeof entry.column === 'string' && columnKeys.has(entry.column) && !used.has(entry.column)) { used.add(entry.column); layout.push({ column: entry.column }); continue }
    const section = cleanText(entry.section, 120)
    if (section && entry.column === undefined) layout.push({ section })
  }
  if (layout.some((item) => 'column' in item)) out.layout = layout
  if (raw.hide_view_icon === true) out.hide_view_icon = true
  return Object.keys(out).length ? out : undefined
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
  // Nested Lists: a parent row matched by its key has its child rows checked the same way (their own key column).
  const nested = childListColumns(config).filter((c) => !c.read_only && hasReadOnlyColumns(c.list))
  if (!config || (!readOnly.length && !nested.length) || !key || !Array.isArray(submitted)) return { rows: submitted, restored: [] }
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
    for (const c of nested) {
      const inner = keepReadOnlyListColumns(c.list, next[c.key], original[c.key])
      next[c.key] = inner.rows
      for (const r of inner.restored) restored.add(`${c.key}.${r}`)
    }
    return next
  })
  return { rows, restored: [...restored] }
}

/**
 * Server merge for cell rules (list.cell_rules with read_only, any level):
 * a submitted row that is a row the form opened with keeps the stored value
 * of every cell that was read only when the form opened AND is read only for
 * the submitted values — whatever the browser sent. Rows are matched by the
 * List's key column; a List without one is matched by position, and only
 * while the row count is unchanged (a row removed and another added in the
 * same session cannot be told apart from an edit: set a key column for
 * Lists whose rows can be removed). A new row takes its locked cells as sent
 * (a default or a rule fills them, like a read-only column's first commit).
 * `ctx.skip`: columns a form rule writes (a rule may fill a read-only cell).
 * `ctx`: the form's values now (`form`) and as stored (`storedForm`), the
 * person as the server sees them (null = nobody). Returns the rows and the
 * cells put back (`column` / `child.column`) for a logged warning.
 */
export function keepLockedListCells(
  config: ListFieldConfig | undefined, submitted: unknown, stored: unknown,
  ctx: { form?: Record<string, unknown> | null; storedForm?: Record<string, unknown> | null; user?: Record<string, unknown> | null; parent?: Record<string, unknown> | null; storedParent?: Record<string, unknown> | null; skip?: ReadonlySet<string> } = {},
): { rows: unknown; restored: string[] } {
  if (!config || !Array.isArray(submitted) || !hasLockRules(config)) return { rows: submitted, restored: [] }
  const before = rawListRows(stored)
  if (!before.length) return { rows: submitted, restored: [] }
  const key = config.key_column
  const byKey = new Map<string, Record<string, unknown>>()
  if (key) for (const row of before) { const k = row[key]; if (k !== null && k !== undefined && k !== '') byKey.set(String(k), row) }
  const positional = !key && submitted.length === before.length
  const user = ctx.user ?? null
  const nested = childListColumns(config).filter((c) => hasLockRules(c.list))
  const restored = new Set<string>()
  const rows = submitted.map((row, i) => {
    if (!isPlainObject(row)) return row
    const k = key ? row[key] : undefined
    const original = key ? (k === null || k === undefined || k === '' ? undefined : byKey.get(String(k))) : positional ? before[i] : undefined
    if (!original) return row
    const next: Record<string, unknown> = { ...row }
    const now = listCellStates(config, row, { form: ctx.form ?? {}, user, parent: ctx.parent ?? null }).locked
    const then = listCellStates(config, original, { form: ctx.storedForm ?? ctx.form ?? {}, user, parent: ctx.storedParent ?? ctx.parent ?? null }).locked
    for (const col of Object.keys(now)) {
      if (!then[col] || ctx.skip?.has(col)) continue
      const column = config.columns.find((c) => c.key === col)
      if (!column || column.type === 'calculated') continue
      if (JSON.stringify(next[col] ?? null) !== JSON.stringify(original[col] ?? null)) restored.add(col)
      next[col] = original[col] ?? null
      if (column.type === 'lookup') next[listLabelKey(col)] = original[listLabelKey(col)] ?? null
    }
    for (const c of nested) {
      const inner = keepLockedListCells(c.list, next[c.key], original[c.key], { ...ctx, parent: coerceListRow(config, next), storedParent: coerceListRow(config, original) })
      next[c.key] = inner.rows
      for (const r of inner.restored) restored.add(`${c.key}.${r}`)
    }
    return next
  })
  return { rows, restored: [...restored] }
}

/** Whether a config (or a List nested in it) has read-only cell rules. */
function hasLockRules(config: ListFieldConfig | undefined): boolean {
  return Boolean(config && ((config.cell_rules ?? []).some((r) => r.read_only) || config.columns.some((c) => c.type === 'list' && hasLockRules(c.list))))
}

/** Whether a config (or a List nested in it) has read-only columns. */
function hasReadOnlyColumns(config: ListFieldConfig | undefined): boolean {
  return Boolean(config?.columns.some((c) => c.read_only || (c.type === 'list' && hasReadOnlyColumns(c.list))))
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

/** A typed cell: a nested List column holds its child rows. */
/** A typed cell: a signature column holds the Signature field's value object. */
export type ListCell = string | number | boolean | null | ListRow[] | SignatureValue
export type ListRow = { [key: string]: ListCell }

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

/** Per level: columns / rows / options…; `nestedRows`: rows over every level of one List value (the parent rows included). */
export const LIST_LIMITS = { columns: 30, rows: 500, options: 200, text: 5000, formula: 300, nestedRows: 2000, validations: 10, message: 300 } as const

const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CURRENCY_RE = /^[A-Z]{3}$/
const RESERVED_COLUMN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const NUMERIC_COLUMNS: ReadonlySet<ListColumnType> = new Set(['number', 'currency', 'calculated'])
const TEXT_COLUMNS: ReadonlySet<ListColumnType> = new Set(['text', 'textarea', 'email'])

/** The nested List columns of a config. */
export function childListColumns(config: ListFieldConfig | undefined): ListColumn[] {
  return (config?.columns ?? []).filter((c) => c.type === 'list' && c.list)
}

/** Levels a config spans (1 = no nested Lists). */
export function listDepth(config: ListFieldConfig | undefined): number {
  return 1 + Math.max(0, ...childListColumns(config).map((c) => listDepth(c.list)))
}

/**
 * A nested List by its path (`lines`, or `lines.serials` for level 3): the
 * column at each step and the child config at the end; null when a step is
 * not a nested List column.
 */
export function childListAt(config: ListFieldConfig | undefined, path: string | string[]): { config: ListFieldConfig; columns: ListColumn[] } | null {
  const steps = (Array.isArray(path) ? path : String(path ?? '').split('.')).map((s) => s.trim()).filter(Boolean)
  if (!steps.length || !config) return null
  let at: ListFieldConfig = config
  const columns: ListColumn[] = []
  for (const step of steps) {
    const column = at.columns.find((c) => c.key === step && c.type === 'list' && c.list)
    if (!column?.list) return null
    columns.push(column)
    at = column.list
  }
  return { config: at, columns }
}

/**
 * Where a nested List of one parent row lives while the form is open — the
 * key its rows / current row / selection are kept under by the row rules:
 * `orders.1.lines` (the Lines of row 2 of Orders; level 3:
 * `orders.1.lines.0.serials`). Not a field key (field keys have no dots).
 */
export function nestedListKey(listKey: string, indexes: number[], steps: string[]): string {
  return [listKey, ...steps.flatMap((step, i) => [String(indexes[i]), step])].join('.')
}

/** The raw rows of a nested List under the parent rows `indexes` (0-based, one per level) of a List value. */
export function nestedRowsIn(value: unknown, indexes: number[], steps: string[]): Record<string, unknown>[] {
  let rows = rawListRows(value)
  for (const [i, step] of steps.entries()) {
    const row = rows[indexes[i]]
    if (!row) return []
    rows = rawListRows(row[step])
  }
  return rows
}

/** A List value with the nested List under `indexes` replaced by `childRows` (other rows as they were). */
export function withNestedRows(value: unknown, indexes: number[], steps: string[], childRows: unknown): Record<string, unknown>[] {
  const rows = rawListRows(value)
  if (!steps.length) return rawListRows(childRows)
  const [at, ...restIdx] = indexes
  const [step, ...restSteps] = steps
  if (!rows[at]) return rows
  return rows.map((row, i) => (i === at ? { ...row, [step]: restSteps.length ? withNestedRows(row[step], restIdx, restSteps, childRows) : rawListRows(childRows) } : row))
}

/** Every nested List path of a config (`lines`, `lines.serials`), outer ones first. */
export function childListPaths(config: ListFieldConfig | undefined, prefix: string[] = []): string[][] {
  const out: string[][] = []
  for (const c of childListColumns(config)) {
    const path = [...prefix, c.key]
    out.push(path, ...childListPaths(c.list, path))
  }
  return out
}

/** The row keys derived inside each parent row for its nested Lists: `<child>_count` and `<child>_<total|avg|count>_<column>`. */
export function childRowDerivedKeys(config: ListFieldConfig | undefined): string[] {
  return childListColumns(config).flatMap((c) => [listCountKey(c.key), ...(c.list!.totals ?? []).map((t) => listTotalKey(c.key, t))])
}

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

const VALIDATION_SUBJECT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z0-9_$-]{1,64}){0,8}$/

/** Stored validations → clean ones (a condition and a message each; at most LIST_LIMITS.validations). */
function normalizeValidations(raw: unknown, columnKeys?: ReadonlySet<string>): ListRowValidation[] {
  const out: ListRowValidation[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (out.length >= LIST_LIMITS.validations) break
    if (!isPlainObject(entry)) continue
    const group = normalizeConditionGroup(entry.if ?? entry.when)
    if (!group || !groupConditions(group).every((c) => VALIDATION_SUBJECT_RE.test(c.column))) continue
    const message = cleanText(entry.message, LIST_LIMITS.message)
    if (!message) continue
    const v: ListRowValidation = { if: group, message }
    if (columnKeys && typeof entry.column === 'string' && columnKeys.has(entry.column)) v.column = entry.column
    out.push(v)
  }
  return out
}

/** Stored row styles → clean ones (a condition and a style each; `column` kept only when it is one of the List's). */
function normalizeRowStyles(raw: unknown, columnKeys: ReadonlySet<string>): ListRowStyle<DataTableConditionGroup>[] {
  const out: ListRowStyle<DataTableConditionGroup>[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (out.length >= ROW_STYLE_LIMIT) break
    if (!isPlainObject(entry)) continue
    const group = normalizeConditionGroup(entry.if ?? entry.when)
    if (!group || !groupConditions(group).every((c) => VALIDATION_SUBJECT_RE.test(c.column))) continue
    const style = normalizeConditionalStyle(entry.style)
    if (!style) continue
    const s: ListRowStyle<DataTableConditionGroup> = { if: group, style }
    if (typeof entry.column === 'string' && entry.column) {
      if (!columnKeys.has(entry.column)) continue
      s.column = entry.column
    }
    out.push(s)
  }
  return out
}

/** Stored cell rules → clean ones (a condition, one of the List's columns, and hide and / or read only). */
function normalizeCellRules(raw: unknown, columnKeys: ReadonlySet<string>): ListCellRule<DataTableConditionGroup>[] {
  const out: ListCellRule<DataTableConditionGroup>[] = []
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (out.length >= CELL_RULE_LIMIT) break
    if (!isPlainObject(entry)) continue
    const group = normalizeConditionGroup(entry.if ?? entry.when)
    if (!group || !groupConditions(group).every((c) => VALIDATION_SUBJECT_RE.test(c.column))) continue
    if (typeof entry.column !== 'string' || !columnKeys.has(entry.column)) continue
    const hide = entry.hide === true || entry.effect === 'hide'
    const readOnly = entry.read_only === true || entry.effect === 'read_only' || entry.effect === 'lock'
    if (!hide && !readOnly) continue
    out.push({ if: group, column: entry.column, ...(hide ? { hide: true } : {}), ...(readOnly ? { read_only: true } : {}) })
  }
  return out
}

function normalizeColumn(raw: unknown, seen: Set<string>, depth: number): ListColumn | null {
  if (!isPlainObject(raw)) return null
  const label = cleanText(raw.label, 120) ?? ''
  const key = slug(cleanText(raw.key, 64) ?? label)
  if (!key || !KEY_RE.test(key) || seen.has(key) || RESERVED_COLUMN_KEYS.has(key)) return null
  seen.add(key)
  const rawType = raw.type === 'select' ? 'choice' : raw.type === 'checkbox' ? 'boolean' : raw.type === 'formula' ? 'calculated' : raw.type === 'nested_list' || raw.type === 'repeating' ? 'list' : raw.type
  const type: ListColumnType = (LIST_COLUMN_TYPES as string[]).includes(rawType as string) ? rawType as ListColumnType : 'text'
  const column: ListColumn = { key, label: label || key, type }
  if (raw.required === true && type !== 'calculated' && type !== 'boolean') column.required = true
  const placeholder = cleanText(raw.placeholder, 200)
  if (placeholder && type !== 'boolean' && type !== 'calculated' && type !== 'list' && type !== 'signature') column.placeholder = placeholder
  const help = cleanText(raw.help_text, 500)
  if (help) column.help_text = help
  if (raw.hidden === true) column.hidden = true
  if (raw.read_only === true && type !== 'calculated') column.read_only = true
  if (type !== 'calculated' && type !== 'list' && type !== 'signature') {
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
  if (type === 'signature') {
    // A cell's pad: draw / type / both, the statement, audit capture (re-sign on change is a form-level behaviour).
    const config = normalizeSignatureConfig(raw.signature)
    delete config.resign_on_change
    if (Object.keys(config).length) column.signature = config
  }
  // A nested List: its own config, one level down (beyond the cap: kept empty, and listConfigProblem says why).
  if (type === 'list') column.list = depth < LIST_MAX_DEPTH ? normalizeListConfig(raw.list ?? { columns: raw.columns }, depth + 1) : { columns: [] }
  const validations = normalizeValidations(raw.validations).map(({ if: cond, message }) => ({ if: cond, message }))
  if (validations.length) column.validations = validations
  const textStyle = normalizeControlTextStyle(raw.text_style)
  if (textStyle) column.text_style = textStyle
  return column
}

/**
 * A clean List config: columns (deduped snake_case keys, known types), row
 * limits, entry mode, totals, display. `depth`: the level (1 = the field's
 * List); a nested List (level 2+) keeps its columns, totals, row limits,
 * display, key column, pending-row, row pop-out and row style settings only.
 */
export function normalizeListConfig(raw: unknown, depth = 1): ListFieldConfig {
  const r = isPlainObject(raw) ? raw : {}
  const level = Number.isInteger(depth) && depth >= 1 ? depth : 1
  const seen = new Set<string>()
  const columns: ListColumn[] = []
  for (const entry of Array.isArray(r.columns) ? r.columns : []) {
    if (columns.length >= LIST_LIMITS.columns) break
    const column = normalizeColumn(entry, seen, level)
    if (column) columns.push(column)
  }
  const config: ListFieldConfig = { columns }
  const minRows = finite(r.min_rows)
  const maxRows = finite(r.max_rows)
  if (minRows !== undefined && minRows > 0) config.min_rows = Math.min(LIST_LIMITS.rows, Math.floor(minRows))
  if (maxRows !== undefined && maxRows > 0) config.max_rows = Math.min(LIST_LIMITS.rows, Math.floor(maxRows))
  if (r.entry_mode === 'inline' && level === 1) config.entry_mode = 'inline'
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
  const rowValidations = normalizeValidations(r.row_validations, keys)
  if (rowValidations.length) config.row_validations = rowValidations
  const rowStyles = normalizeRowStyles(r.row_styles, keys)
  if (rowStyles.length) config.row_styles = rowStyles
  const cellRules = normalizeCellRules(r.cell_rules, keys)
  if (cellRules.length) config.cell_rules = cellRules
  // The row pop-out (any level): how rows are edited and the form's title / layout.
  if (r.row_editing === 'inline' || r.row_editing === 'popout') config.row_editing = r.row_editing
  const rowForm = normalizeRowForm(r.row_form, keys)
  if (rowForm) config.row_form = rowForm
  if (level > 1) {
    if (r.on_submit_pending === 'exclude' || r.on_submit_pending === 'commit') config.on_submit_pending = r.on_submit_pending
    if (r.row_commit_controls === true) config.row_commit_controls = true
    if (typeof r.key_column === 'string' && keys.has(r.key_column) && columns.find((c) => c.key === r.key_column)?.type !== 'signature') config.key_column = r.key_column
    return config
  }
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
  if (typeof r.key_column === 'string' && keys.has(r.key_column) && columns.find((c) => c.key === r.key_column)?.type !== 'signature') config.key_column = r.key_column
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

/** The designer's / server's blocking problem with a List config (null = fine); nested Lists checked too (`depth`: the level). */
export function listConfigProblem(config: ListFieldConfig | undefined, depth = 1): string | null {
  if (!config || !config.columns.length) return 'Add at least one column'
  if (!inputColumns(config).length) return 'Add a column people fill in (not only calculated ones)'
  const derived = new Set(childRowDerivedKeys(config))
  for (const column of config.columns) {
    if (derived.has(column.key) || (column.type === 'lookup' && derived.has(listLabelKey(column.key)))) return `Column "${column.label}": its key is taken by a nested list's count / total (${column.key})`
    if (column.type === 'list') {
      if (depth >= LIST_MAX_DEPTH) return `Column "${column.label}": lists nest at most ${LIST_MAX_DEPTH} levels deep`
      const inner = listConfigProblem(column.list, depth + 1)
      if (inner) return `Column "${column.label}": ${inner.charAt(0).toLowerCase()}${inner.slice(1)}`
      continue
    }
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
  if (config.key_column && childListColumns(config).some((c) => c.key === config.key_column)) return 'The key column cannot be a nested list'
  if (config.key_column && config.columns.some((c) => c.key === config.key_column && c.type === 'signature')) return 'The key column cannot be a signature'
  const keys = new Set(config.columns.flatMap((c) => [c.key, ...(c.type === 'lookup' ? [listLabelKey(c.key)] : []), ...(c.type === 'list' ? childRowDerivedKeys({ columns: [c] }) : [])]))
  for (const [where, v] of [...config.columns.flatMap((c) => (c.validations ?? []).map((x) => [`Column "${c.label}"`, x] as const)), ...(config.row_validations ?? []).map((x) => ['Row check', x] as const), ...(config.row_styles ?? []).map((x) => ['Row style', x] as const), ...(config.cell_rules ?? []).map((x) => ['Cell rule', x] as const)]) {
    for (const c of groupConditions(v.if)) {
      const m = /^row\.([a-z][a-z0-9_]*)/.exec(c.column)
      if (m && !keys.has(m[1])) return `${where}: the validation reads an unknown column "${m[1]}"`
      if (c.column.startsWith('parent.') && depth === 1) return `${where}: parent.* is for nested lists (this list has no parent row)`
    }
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

/** A row nobody filled in: every input column blank (booleans unticked, nested Lists without a filled row). */
export function isBlankListRow(config: ListFieldConfig, row: Record<string, unknown>): boolean {
  return inputColumns(config).every((c) => (c.type === 'boolean' ? toBoolean(row[c.key]) !== true : c.type === 'list' ? !c.list || rawListRows(row[c.key]).every((r) => isBlankListRow(c.list!, r)) : blankCell(row[c.key])))
}

/** Rows still allowed over every level of one List value (LIST_LIMITS.nestedRows). */
type RowBudget = { left: number }

function coerceCell(column: ListColumn, value: unknown, budget?: RowBudget): ListCell {
  switch (column.type) {
    case 'field':
      // A repeating section's control (lib/forms/repeating-section.ts): kept as it is; the form's engine types it on submit.
      return blankCell(value) ? null : value as ListCell
    case 'list':
      return column.list ? coerceRows(column.list, value, budget ?? { left: LIST_LIMITS.nestedRows }) : []
    case 'signature':
      // The Signature field's value (lib/forms/media-fields.ts), cleaned; anything else → no signature.
      return normalizeSignatureValue(value)
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

/**
 * One row typed: the columns only (unknown keys dropped), calculated columns
 * worked out; a nested List column's rows typed the same way, with its count
 * and totals beside it in the row (`<child>_count`, `<child>_total_<column>`).
 */
export function coerceListRow(config: ListFieldConfig, row: Record<string, unknown>, budget?: RowBudget): ListRow {
  const out: ListRow = {}
  for (const column of config.columns) if (column.type !== 'calculated') out[column.key] = coerceCell(column, row[column.key], budget)
  for (const column of config.columns) if (column.type === 'calculated') out[column.key] = calculateColumn(column, out)
  for (const column of childListColumns(config)) {
    const rows = Array.isArray(out[column.key]) ? out[column.key] as ListRow[] : []
    out[listCountKey(column.key)] = rows.length
    for (const total of column.list!.totals ?? []) out[listTotalKey(column.key, total)] = listTotalValue(total, rows)
  }
  // A lookup cell keeps its display label beside the value (`product_label`; the server re-reads it on submit).
  for (const column of config.columns) {
    if (column.type !== 'lookup') continue
    const label = row[listLabelKey(column.key)]
    out[listLabelKey(column.key)] = out[column.key] === null ? null : typeof label === 'string' && label.trim() ? label.slice(0, 500) : out[column.key] === null ? null : String(out[column.key])
  }
  return out
}

/** The stored value: typed rows, blank rows dropped, at most the hard limits (per level, and LIST_LIMITS.nestedRows over all levels). */
export function coerceListRows(config: ListFieldConfig | undefined, value: unknown): ListRow[] {
  if (!config) return []
  return coerceRows(config, value, { left: LIST_LIMITS.nestedRows })
}

function coerceRows(config: ListFieldConfig, value: unknown, budget: RowBudget): ListRow[] {
  // Pending rows (lib/forms/row-rules.ts): left out or taken as they are (the List's on_submit_pending).
  const rows = settleListRows(config, value).filter((row) => !isBlankListRow(config, row)).slice(0, LIST_LIMITS.rows)
  const out: ListRow[] = []
  for (const row of rows) {
    if (budget.left <= 0) break
    budget.left -= 1
    out.push(coerceListRow(config, row, budget))
  }
  return out
}

/** Rows over every level of a List value (the parent rows included). */
export function nestedRowCount(config: ListFieldConfig | undefined, value: unknown): number {
  const rows = rawListRows(value)
  const children = childListColumns(config)
  return rows.length + rows.reduce((n, row) => n + children.reduce((m, c) => m + nestedRowCount(c.list, row[c.key]), 0), 0)
}

/** A new row: each input column's default (typed), calculated columns worked out, nested Lists empty. */
export function blankListRow(config: ListFieldConfig): ListRow {
  const seed: Record<string, unknown> = {}
  for (const column of inputColumns(config)) seed[column.key] = column.type === 'list' ? [] : column.default ?? (column.type === 'boolean' ? false : null)
  return coerceListRow(config, seed)
}

/** What the inputs hold for a row while editing (text the inputs show). */
export function listRowDraft(config: ListFieldConfig, row?: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const column of inputColumns(config)) {
    if (column.type === 'list') { out[column.key] = row ? rawListRows(row[column.key]) : []; continue }
    if (column.type === 'signature') { out[column.key] = row ? normalizeSignatureValue(row[column.key]) : null; continue }
    const v = row ? row[column.key] : (column.default ?? (column.type === 'boolean' ? false : ''))
    out[column.key] = column.type === 'boolean' ? toBoolean(v) === true : v === null || v === undefined ? '' : v
  }
  return out
}

/**
 * The List's validations for one row (column → message; LIST_ROW_ERROR_KEY
 * for a row-level one without a column): each column's `validations` and
 * the config's `row_validations` whose condition holds — judged by the form
 * rules' evaluator (lib/forms/form-rules.ts) with `row.*` = the typed row,
 * `parent.*` = the parent row (nested Lists), `form.*` and `user.*` from the
 * context. A cell that already has an error keeps it.
 */
export function listValidationErrors(config: ListFieldConfig, row: Record<string, unknown>, ctx: ListCheckContext): Record<string, string> {
  const out: Record<string, string> = {}
  const rules = [
    ...config.columns.flatMap((c) => (c.validations ?? []).map((v) => ({ ...v, column: c.key }))),
    ...(config.row_validations ?? []),
  ]
  if (!rules.length) return out
  const typed = coerceListRow(config, row)
  const event: Record<string, unknown> = { row: typed, ...(ctx.parent ? { parent: ctx.parent } : {}) }
  const scope = { values: ctx.form ?? {}, user: ctx.user ?? null, event }
  const { conditionsMet, template } = ruleJudge()
  for (const v of rules) {
    const at = v.column ?? LIST_ROW_ERROR_KEY
    if (ctx.user === undefined && readsUser(v.if)) continue
    if (out[at] || !conditionsMet(v.if, scope)) continue
    const text = template(v.message, scope)
    out[at] = String(text ?? '').trim() || 'Check this row'
  }
  return out
}

/**
 * A row's conditional styles (list.row_styles): each style whose condition
 * holds — judged like the List's validations (`row.*` typed, `parent.*`,
 * `form.*`, `user.*`; one that reads the user is skipped when the user is
 * not known here) — merged in order, the later one winning per property: the
 * whole row's, and each styled column's cell.
 */
export function listRowStyles(config: ListFieldConfig | undefined, row: Record<string, unknown>, ctx: ListCheckContext = {}): RowStyleResult {
  const list = config?.row_styles
  if (!config || (!list?.length && !config.cell_rules?.length) || !judge) return NO_ROW_STYLE
  const typed = coerceListRow(config, row)
  const scope = { values: ctx.form ?? {}, user: ctx.user ?? null, event: { row: typed, ...(ctx.parent ? { parent: ctx.parent } : {}) } }
  let whole: RowStyleResult['row'] = null
  const cells: RowStyleResult['cells'] = {}
  for (const s of list ?? []) {
    if (ctx.user === undefined && readsUser(s.if)) continue
    if (!judge.conditionsMet(s.if, scope)) continue
    if (s.column) cells[s.column] = mergeStyles(cells[s.column], s.style)!
    else whole = mergeStyles(whole, s.style)
  }
  const { hidden, locked } = cellStates(config, scope, ctx.user === undefined)
  return whole || Object.keys(cells).length || Object.keys(hidden).length || Object.keys(locked).length ? { row: whole, cells, hidden, locked } : NO_ROW_STYLE
}

function cellStates(config: ListFieldConfig, scope: RuleScope, skipUser: boolean): { hidden: Record<string, true>; locked: Record<string, true> } {
  const hidden: Record<string, true> = {}
  const locked: Record<string, true> = {}
  for (const r of config.cell_rules ?? []) {
    if (skipUser && readsUser(r.if)) continue
    if (!judge!.conditionsMet(r.if, scope)) continue
    if (r.hide) hidden[r.column] = true
    if (r.read_only) locked[r.column] = true
  }
  return { hidden, locked }
}

/**
 * A row's hidden and read-only cells (list.cell_rules), judged like the
 * List's validations (`row.*` typed, `parent.*`, `form.*`, `user.*`). On the
 * server pass the user (null = nobody: no roles) — a rule reading the user
 * is skipped only when `ctx.user` is undefined (not known here).
 */
export function listCellStates(config: ListFieldConfig | undefined, row: Record<string, unknown>, ctx: ListCheckContext = {}): { hidden: Record<string, true>; locked: Record<string, true> } {
  if (!config?.cell_rules?.length || !judge) return { hidden: {}, locked: {} }
  const scope = { values: ctx.form ?? {}, user: ctx.user ?? null, event: { row: coerceListRow(config, row), ...(ctx.parent ? { parent: ctx.parent } : {}) } }
  return cellStates(config, scope, ctx.user === undefined)
}

/** Whether a validation's condition reads the user (`user.*` as a subject or a placeholder). */
function readsUser(group: DataTableConditionGroup): boolean {
  return groupConditions(group).some((c) => c.column === 'user' || c.column.startsWith('user.') || /\{\{\s*user[.}\s]/.test(String(c.value ?? '')))
}

/** Whether a List config (or a List nested in it) has validations. */
export function hasListValidations(config: ListFieldConfig | undefined): boolean {
  return Boolean(config && ((config.row_validations?.length ?? 0) > 0 || config.columns.some((c) => (c.validations?.length ?? 0) > 0 || (c.type === 'list' && hasListValidations(c.list)))))
}

/**
 * Per-column problems with one row (column key → message; LIST_ROW_ERROR_KEY
 * for a row-level validation); empty when the row is fine. With `ctx` the
 * List's validations run too (listValidationErrors).
 */
export function listRowErrors(config: ListFieldConfig, row: Record<string, unknown>, ctx?: ListCheckContext | null): Record<string, string> {
  const errors: Record<string, string> = {}
  // Cell rules and hidden columns (with a context only): a hidden cell is not checked at all (a hidden field's
  // semantics); a read-only cell is not required (the person can't fill it in) — every other check still runs.
  const states = ctx ? listCellStates(config, row, ctx) : { hidden: {} as Record<string, true>, locked: {} as Record<string, true> }
  for (const column of config.columns) {
    if (states.hidden[column.key] || ctx?.hiddenColumns?.has(column.key)) continue
    const unlockedRequired = column.required && !states.locked[column.key]
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
    if (column.type === 'list') {
      // A nested List: its own rows' checks, min / max rows; required = at least one row.
      const inner = checkListValue(column.list, value, Boolean(unlockedRequired), 2, ctx ? { ...ctx, hiddenColumns: null, parent: coerceListRow(config, row) } : null)
      if (inner.errors.length) errors[column.key] = `${name}: ${inner.errors[0]}`
      continue
    }
    if (column.type === 'signature') {
      // An electronic signature per row: the Signature field's shape rules (its PNG is re-read and stamped on the server).
      if (blankCell(value)) { if (unlockedRequired) errors[column.key] = `${name}: please sign`; continue }
      const problem = signatureValueError({ label: name, signature: column.signature }, value)
      if (problem) errors[column.key] = problem
      continue
    }
    if (blankCell(value)) {
      if (unlockedRequired) errors[column.key] = `${name} is required`
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
  if (ctx) for (const [at, text] of Object.entries(listValidationErrors(config, row, ctx))) if (!errors[at] && !states.hidden[at] && !ctx.hiddenColumns?.has(at)) errors[at] = text
  return errors
}

export interface ListValueCheck {
  /** Problems, worded for the person ("Row 2: Quantity is required"). */
  errors: string[]
  /** Per row (index in the submitted, non-blank rows) → column → message. */
  rowErrors: Record<number, Record<string, string>>
  /**
   * Every problem by its path under the List: `[1].qty`, a nested List's
   * `[1].lines[0].qty` (or `[1].lines` for its row count); '' = the List
   * itself. Prefix the field key for the full address (`orders[1].lines[0].qty`).
   */
  paths: Record<string, string>
  /** The rows counted (blank rows left out). */
  count: number
}

/**
 * Check a submitted List value: an array of row objects; every row's
 * columns (required, types, bounds, options); the row count against
 * min / max rows and the hard limit; `required` = at least one row.
 */
export function checkListValue(config: ListFieldConfig | undefined, value: unknown, required = false, level = 1, ctx: ListCheckContext | null = null): ListValueCheck {
  const out: ListValueCheck = { errors: [], rowErrors: {}, paths: {}, count: 0 }
  const listError = (text: string) => { out.errors.push(text); if (!('' in out.paths)) out.paths[''] = text }
  if (!config) { listError('the list is not configured'); return out }
  const blank = value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
  if (!blank && !Array.isArray(value) && !(typeof value === 'string' && value.trim().startsWith('['))) { listError('has an invalid value (a list of rows is expected)'); return out }
  const list = blank ? [] : typeof value === 'string' ? (() => { try { const p = JSON.parse(value); return Array.isArray(p) ? p : null } catch { return null } })() : value as unknown[]
  if (list === null) { listError('has an invalid value (a list of rows is expected)'); return out }
  if (list.some((row) => !isPlainObject(row))) { listError('has an invalid row'); return out }
  // Pending rows: 'block' stops the submission until they are committed or discarded; 'exclude' leaves them out.
  const pending = (list as Record<string, unknown>[]).filter((row) => rowDraftState(row) !== null).length
  if (pending && (config.on_submit_pending ?? 'block') === 'block') listError(`commit or discard the ${pending === 1 ? 'pending row' : `${pending} pending rows`} first`)
  const rows = settleListRows(config, list).filter((row) => !isBlankListRow(config, row))
  out.count = rows.length
  if (rows.length > LIST_LIMITS.rows) { listError(`at most ${LIST_LIMITS.rows} rows`); return out }
  // Nested Lists: at most LIST_LIMITS.nestedRows rows over every level of the value.
  if (level === 1 && childListColumns(config).length && nestedRowCount(config, rows) > LIST_LIMITS.nestedRows) { listError(`at most ${LIST_LIMITS.nestedRows} rows in all (nested lists included)`); return out }
  rows.forEach((row, i) => {
    const problems = listRowErrors(config, row, ctx)
    if (Object.keys(problems).length) {
      out.rowErrors[i] = problems
      out.errors.push(`row ${i + 1}: ${Object.values(problems)[0]}`)
      for (const [column, text] of Object.entries(problems)) {
        // A row-level validation without a column: the row's own path ([i]).
        if (column === LIST_ROW_ERROR_KEY) { out.paths[`[${i}]`] = text; continue }
        const nested = config.columns.find((c) => c.key === column && c.type === 'list')
        if (!nested) { out.paths[`[${i}].${column}`] = text; continue }
        // A nested List's own problems, each at its path ([i].lines[0].qty; [i].lines for its row count).
        const inner = checkListValue(nested.list, row[column], Boolean(nested.required) && !(ctx ? listCellStates(config, row, ctx).locked[column] : false), level + 1, ctx ? { ...ctx, hiddenColumns: null, parent: coerceListRow(config, row) } : null)
        for (const [path, message] of Object.entries(inner.paths)) out.paths[`[${i}].${column}${path}`] = message
      }
    }
  })
  const min = Math.max(config.min_rows ?? 0, required ? 1 : 0)
  if (rows.length < min) listError(min === 1 ? 'add at least one row' : `add at least ${min} rows`)
  if (config.max_rows !== undefined && rows.length > config.max_rows) listError(`at most ${config.max_rows} ${config.max_rows === 1 ? 'row' : 'rows'}`)
  return out
}

/** A List value's problems by their full address (`orders[1].lines[0].qty`; `orders` for the List itself). */
export function listValuePathErrors(fieldKey: string, config: ListFieldConfig | undefined, value: unknown, required = false, ctx: ListCheckContext | null = null): Record<string, string> {
  const check = checkListValue(config, value, required, 1, ctx)
  return Object.fromEntries(Object.entries(check.paths).map(([path, text]) => [`${fieldKey}${path}`, text]))
}

/* ── Totals and the run's derived values ─────────────────────────────── */

export function listCountKey(fieldKey: string): string {
  return `${fieldKey}_count`
}

export function listTotalKey(fieldKey: string, total: Pick<ListTotal, 'column' | 'fn'>): string {
  return `${fieldKey}_${total.fn === 'sum' ? 'total' : total.fn}_${total.column}`
}

/**
 * Every key the field adds beside its rows: `<key>_count` and one per total;
 * per nested List (path P = its column keys joined by `_`: `lines`,
 * `lines_serials`): `<key>_<P>_count` (its rows under every parent),
 * `<key>_<P>_counts` (per top-level row, in order) and per child total
 * `<key>_<total|avg|count>_<P>_<column>` (over every parent row).
 */
export function listDerivedKeys(fieldKey: string, config: ListFieldConfig | undefined): string[] {
  // A selectable List also owns the keys rules read its selection under.
  const nested = childListPaths(config).flatMap((path) => {
    const p = `${fieldKey}_${path.join('_')}`
    return [listCountKey(p), `${p}_counts`, ...(childListAt(config, path)!.config.totals ?? []).map((t) => listTotalKey(fieldKey, { ...t, column: `${path.join('_')}_${t.column}` }))]
  })
  return [listCountKey(fieldKey), ...(config?.totals ?? []).map((t) => listTotalKey(fieldKey, t)), ...nested, ...(config?.selectable ? listSelectionKeys(fieldKey).filter((k) => k !== listCountKey(fieldKey)) : [])]
}

/** The rows of a nested List under every row, in order (`lines` of every order; `lines.serials` of every line of every order). */
export function nestedRowsAt(rows: ListRow[], path: string[]): ListRow[] {
  if (!path.length) return rows
  const [head, ...rest] = path
  return nestedRowsAt(rows.flatMap((r) => (Array.isArray(r[head]) ? r[head] as ListRow[] : [])), rest)
}

/** A total over typed rows (sum / average rounded to 6 decimals; count = rows with a value). */
export function listTotalValue(total: ListTotal, rows: ListRow[]): number | null {
  const values = rows.map((r) => r[total.column])
  if (total.fn === 'count') return values.filter((v) => !(v === null || v === undefined || v === '' || v === false || (Array.isArray(v) && !v.length))).length
  const numbers = values.map((v) => toNumber(v)).filter((n): n is number => n !== null)
  if (!numbers.length) return total.fn === 'sum' ? 0 : null
  const sum = numbers.reduce((a, b) => a + b, 0)
  return Math.round((total.fn === 'sum' ? sum : sum / numbers.length) * 1e6) / 1e6
}

/** `<key>_count` and the configured totals, from the typed rows (what the run and the submission carry). */
export function listDerivedValues(fieldKey: string, config: ListFieldConfig | undefined, rows: unknown): Record<string, number | null | number[]> {
  const typed = config ? coerceListRows(config, rows) : []
  const out: Record<string, number | null | number[]> = { [listCountKey(fieldKey)]: typed.length }
  for (const total of config?.totals ?? []) out[listTotalKey(fieldKey, total)] = listTotalValue(total, typed)
  // Nested Lists: their rows over every parent (count, grand totals) and the count under each top-level row.
  for (const path of childListPaths(config)) {
    const p = `${fieldKey}_${path.join('_')}`
    const all = nestedRowsAt(typed, path)
    out[listCountKey(p)] = all.length
    out[`${p}_counts`] = typed.map((row) => nestedRowsAt([row], path).length)
    for (const total of childListAt(config, path)!.config.totals ?? []) out[listTotalKey(fieldKey, { ...total, column: `${path.join('_')}_${total.column}` })] = listTotalValue(total, all)
  }
  return out
}

/* ── Formatting ──────────────────────────────────────────────────────── */

/**
 * "3 rows" (the one-line summary for tables, reports and the timeline); with
 * nested Lists their rows under every parent too: "3 rows (7 lines)". The
 * config names them (its column labels); without it, array-of-row keys do.
 */
export function describeListValue(value: unknown, config?: ListFieldConfig): string {
  const rows = rawListRows(value)
  const n = rows.length
  if (n === 0) return '—'
  const base = `${n} ${n === 1 ? 'row' : 'rows'}`
  const nested: Array<{ label: string; count: number }> = config
    ? childListColumns(config).map((c) => ({ label: c.label, count: rows.reduce((m, r) => m + rawListRows(r[c.key]).filter((x) => !isBlankListRow(c.list!, x)).length, 0) }))
    : [...new Set(rows.flatMap((r) => Object.keys(r).filter((k) => Array.isArray(r[k]) && (r[k] as unknown[]).some(isPlainObject))))]
      .map((k) => ({ label: k.replace(/_/g, ' '), count: rows.reduce((m, r) => m + rawListRows(r[k]).length, 0) }))
  const parts = nested.map(({ label, count }) => `${count} ${countNoun(label, count)}`)
  return parts.length ? `${base} (${parts.join(', ')})` : base
}

/** "lines" / "line" for a nested List's label. */
function countNoun(label: string, count: number): string {
  const plural = label.trim().toLowerCase() || 'rows'
  return count === 1 ? singular(plural) || plural : plural
}

/** A cell as the person reads it (currency formatted, Yes / No, option labels). */
export function formatListCell(column: ListColumn, value: unknown, row?: Record<string, unknown>): string {
  if (column.type === 'list') { const n = rawListRows(value).length; return n ? `${n} ${countNoun(column.label, n)}` : '—' }
  if (value === null || value === undefined || value === '') return '—'
  if (column.type === 'signature') return normalizeSignatureValue(value) ? describeSignature(value) : '—'
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

/** Rows as plain text, one per line (CSV / copy / Agent snapshots); a nested List's rows indented under their row. */
export function listValueText(config: ListFieldConfig | undefined, value: unknown, indent = ''): string {
  if (!config) return describeListValue(value)
  return rawListRows(value).map((row, i) => {
    const line = `${indent}${i + 1}. ${config.columns.map((c) => `${c.label}: ${formatListCell(c, row[c.key], row)}`).join(', ')}`
    const nested = childListColumns(config).map((c) => (rawListRows(row[c.key]).length ? `\n${indent}   ${c.label}:\n${listValueText(c.list, row[c.key], `${indent}   `)}` : '')).join('')
    return line + nested
  }).join('\n')
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

const KIT_TYPE: Record<Exclude<ListColumnType, 'calculated' | 'list' | 'field' | 'signature'>, string> = {
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
  // A nested List column is edited in the list itself (its rows under each row), not from an input;
  // a signature column is signed in its row (the cell or the row pop-out) — a form input's PNG belongs to that input.
  const kitColumns = inputColumns(config).filter((c) => !c.hidden && c.type !== 'list' && c.type !== 'signature')
  const keyOf = new Map(kitColumns.map((c) => [c.key, unique(`${listKey}_${c.key}`)]))
  for (const column of kitColumns) {
    const key = keyOf.get(column.key)!
    const field: ListKitField = { key, label: column.label, type: KIT_TYPE[column.type as Exclude<ListColumnType, 'calculated' | 'list' | 'field' | 'signature'>] ?? 'text' }
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
