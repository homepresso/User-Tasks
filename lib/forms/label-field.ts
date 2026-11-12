/**
 * Label fields (field type `label`): display text on the form — a styled
 * value with a caption, an optional prefix / suffix and a display format
 * (lib/formatting/cell-format.ts). Not an input: the person never edits it.
 *
 * Where the value comes from, in this order:
 *
 *   expression   `label_config.expression`, a formula in the existing
 *                expression engine (lib/expression-functions.ts — the same
 *                language as a workflow's {{= … }}), recomputed whenever
 *                what it reads changes. Written without the {{= }}:
 *                  {{form.qty}} * {{form.price}}
 *                  ROUND(({{form.a}} + {{form.b}}) / {{form.c}}, 2)
 *                  SUMPRODUCT(control.lines.rows, "qty", "price")
 *                  SUM(MAP(control.lines.rows, "qty * price * (1 - discount)"))
 *                  SUMIF(control.lines.rows, "status", "open", "amount")
 *                  CONCAT(form.first, " ", form.last)
 *   rules        Set value / Copy values / Call an API reference (a label
 *                without an expression is a rule target, like a read-only
 *                field);
 *   default      `default` (a constant or {{param.x}} / workflow variables).
 *
 * Rows of a Data table field, for aggregates ({{control.<table>.*}}):
 *
 *   rows           the rows the table holds in the browser — the loaded
 *                  page with the person's edits applied, new rows first,
 *                  deleted rows left out (at most CONTROL_LIMITS.rows);
 *   added_rows / changed_rows / deleted_rows
 *                  the change set (editable tables);
 *   selected_rows  the selection (select tables).
 *
 * Every value is typed by its column (numbers are numbers): nothing parses
 * locale-formatted text, so "1.234,5" never becomes a number by accident.
 *
 * "Include in submission" (`label_config.include`): the value is stored
 * like a field ({{form.<key>}}, task_data.<key>). The server never takes
 * the browser's value: an expression is recomputed from the submitted (and
 * server-checked) values — `rows` rebuilt from the table's saved source
 * (its first page, as the form loads it) with the verified change set
 * applied; a rule-filled label is kept only when a rule of the saved form
 * could have produced it (ruleWrittenReadOnlyValues, the same gate as
 * read-only fields); otherwise the server's own default stands.
 *
 * Events: "Label changes" (`label_change`) fires when a label's value
 * changes — from a rule, an expression or a parameter — once it has settled
 * (debounced), with {{event.value}} and {{event.previous_value}}. A label
 * whose rule changes another label (and so on) runs at most
 * LABEL_LIMITS.chain rounds (LabelCascade); labelLoops finds such loops in
 * the saved rules so the designer can warn before anyone fills the form.
 *
 * Evaluation is the engine's own: no eval / Function, a bounded expression
 * length, bounded rows (MAP_LIMITS), and no clock or random functions (a
 * label must give the same value for the same inputs). Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { FUNCTION_CATALOG, evaluateFunction } from '@/lib/expression-functions'
import { normalizeCellFormat, formatCellValue, type CellFormat, type FormattedCell } from '@/lib/formatting/cell-format'
import { dataTableKeyColumn, isChangeSet, type DataTableChangeSet, type DataTableFieldConfig } from './data-table'
import { CONTROLS_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY } from './form-params'
import { layoutFormRules, resolveRuleTemplate, ruleClaimGate, ruleWrittenReadOnlyValues, type FormRule } from './form-rules'
import { allActions } from './field-buttons'

/* ── Config ─────────────────────────────────────────────────────────── */

export type LabelSize = 'sm' | 'md' | 'lg' | 'xl'
export type LabelEmphasis = 'normal' | 'strong' | 'muted'
export type LabelAlign = 'left' | 'center' | 'right'

export interface LabelFieldConfig {
  /** A formula (the {{= … }} language, without the braces). */
  expression?: string
  /** How the value shows (number, currency, percent, date, text, badge…). */
  format?: CellFormat
  prefix?: string
  suffix?: string
  align?: LabelAlign
  size?: LabelSize
  emphasis?: LabelEmphasis
  /** Shown while there is no value (default "—"). */
  empty_text?: string
  /** Store the value with the submission (recomputed by the server). */
  include?: boolean
  /** Show the caption to screen readers only. */
  hide_caption?: boolean
}

export const LABEL_LIMITS = { expression: 1000, affix: 40, empty: 80, text: 5000, chain: 5, debounceMs: 150 } as const
export const LABEL_SIZES: LabelSize[] = ['sm', 'md', 'lg', 'xl']
export const LABEL_SIZE_LABELS: Record<LabelSize, string> = { sm: 'Small', md: 'Normal', lg: 'Large', xl: 'Extra large' }
export const LABEL_EMPHASES: LabelEmphasis[] = ['normal', 'strong', 'muted']
export const LABEL_EMPHASIS_LABELS: Record<LabelEmphasis, string> = { normal: 'Normal', strong: 'Bold', muted: 'Muted' }
/** The display formats a Label offers (a subset of the cell formats). */
export const LABEL_FORMAT_KINDS = ['text', 'number', 'integer', 'currency', 'percent', 'date', 'datetime', 'badge', 'boolean'] as const

/** Functions a label may not use: their value changes on its own (a label gives the same value for the same inputs). */
export const VOLATILE_FUNCTIONS: ReadonlySet<string> = new Set(['NOW', 'RANDOM', 'GUID'])
/** Function names the engine evaluates besides its catalog (arithmetic / comparison helpers). */
const ENGINE_EXTRAS = ['ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ']
export const LABEL_FUNCTIONS: ReadonlySet<string> = new Set([...FUNCTION_CATALOG.map((f) => f.name), ...ENGINE_EXTRAS].filter((n) => !VOLATILE_FUNCTIONS.has(n)))

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return s.trim() ? s.slice(0, max) : undefined
}

/** Clean a stored / submitted config (unknown props dropped, bounds applied). */
export function normalizeLabelConfig(raw: unknown): LabelFieldConfig {
  const r = isPlainObject(raw) ? raw : {}
  const out: LabelFieldConfig = {}
  const expression = cleanText(r.expression, LABEL_LIMITS.expression)
  if (expression) out.expression = expressionBody(expression)
  if (!out.expression) delete out.expression
  if (isPlainObject(r.format)) out.format = normalizeCellFormat(r.format, 'text')
  // Shorthand: format: "currency" with currency / decimals beside it.
  else if (typeof r.format === 'string' && (LABEL_FORMAT_KINDS as readonly string[]).includes(r.format)) out.format = normalizeCellFormat({ kind: r.format, currency: r.currency, decimals: r.decimals }, 'text')
  const prefix = cleanText(r.prefix, LABEL_LIMITS.affix)
  if (prefix) out.prefix = prefix
  const suffix = cleanText(r.suffix, LABEL_LIMITS.affix)
  if (suffix) out.suffix = suffix
  if (r.align === 'left' || r.align === 'center' || r.align === 'right') out.align = r.align
  if (LABEL_SIZES.includes(r.size as LabelSize) && r.size !== 'md') out.size = r.size as LabelSize
  if (LABEL_EMPHASES.includes(r.emphasis as LabelEmphasis) && r.emphasis !== 'normal') out.emphasis = r.emphasis as LabelEmphasis
  const empty = cleanText(r.empty_text, LABEL_LIMITS.empty)
  if (empty) out.empty_text = empty
  if (r.include === true) out.include = true
  if (r.hide_caption === true) out.hide_caption = true
  return out
}

interface LabelLike { key: string; type: string; label?: string; default?: string; label_config?: LabelFieldConfig }
interface FieldLike { key: string; type: string; label?: string; data_table?: DataTableFieldConfig; default?: string; label_config?: LabelFieldConfig }

export const isLabel = (f: { type: string }): boolean => f.type === 'label'
/** Labels whose value is stored with the submission. */
export const isIncludedLabel = (f: { type: string; label_config?: LabelFieldConfig }): boolean => f.type === 'label' && f.label_config?.include === true

/* ── Expressions: reading ───────────────────────────────────────────── */

/** The formula itself: a pasted `{{= … }}` or a leading `=` unwrapped. */
export function expressionBody(text: string): string {
  let s = String(text ?? '').trim()
  const wrapped = /^\{\{=([\s\S]*)\}\}$/.exec(s)
  if (wrapped && !wrapped[1].includes('}}')) s = wrapped[1].trim()
  else if (s.startsWith('=')) s = s.slice(1).trim()
  return s
}

/** `{{a.b}}` placeholders → bare paths (the engine reads both). */
function stripBraces(body: string): string {
  return body.replace(/\{\{\s*([\w.\-[\]]+)\s*\}\}/g, '$1')
}

interface Lexed { paths: string[]; functions: string[]; problem: string | null }

/** Paths and function names a formula reads (quoted text skipped), and a syntax problem. */
function lex(body: string): Lexed {
  const src = stripBraces(body)
  const paths: string[] = []
  const functions: string[] = []
  let depth = 0
  let problem: string | null = null
  for (let i = 0; i < src.length;) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < src.length && src[j] !== ch) j += src[j] === '\\' ? 2 : 1
      if (j >= src.length) { problem = problem ?? 'A quote is not closed'; break }
      i = j + 1
      continue
    }
    if (ch === '(') { depth++; i++; continue }
    if (ch === ')') { depth--; if (depth < 0) problem = problem ?? 'There is a ")" without its "("'; i++; continue }
    const m = /^[A-Za-z_]\w*(?:\.\w+|\[\d+\])*/.exec(src.slice(i))
    if (m && !/[\w.]/.test(src[i - 1] ?? '')) {
      let k = i + m[0].length
      while (src[k] === ' ') k++
      if (src[k] === '(') functions.push(m[0])
      else if (!['true', 'false', 'null'].includes(m[0])) paths.push(m[0])
      i += m[0].length
      continue
    }
    i++
  }
  if (!problem && depth > 0) problem = 'A "(" is not closed'
  return { paths, functions, problem }
}

/** The paths a formula reads (fields, form.x, param.x, var.x, control.x…). */
export function expressionPaths(body: string | undefined): string[] {
  return body ? [...new Set(lex(body).paths)] : []
}

/** The field / label key a path is about (form.qty → qty, control.lines.rows → lines), or null (params, vars, dates). */
export function pathKey(path: string): string | null {
  if (path.startsWith('param.') || path.startsWith('var.') || path === 'param' || path === 'var' || path === 'row') return null
  const m = /^(?:form\.|task_data\.|control\.)?([A-Za-z0-9_]+)/.exec(path)
  return m ? m[1] : null
}

/** Does this label's expression read a Data table's browser rows (`control.<table>.rows`)? */
export function readsTableRows(field: Pick<LabelLike, 'label_config'>, tableKey?: string): string[] {
  const out = new Set<string>()
  for (const p of expressionPaths(field.label_config?.expression)) {
    const m = /^control\.([A-Za-z0-9_]+)\.rows\b/.exec(p)
    if (m && (!tableKey || m[1] === tableKey)) out.add(m[1])
  }
  return [...out]
}

/** Tables whose loaded rows any label reads (the table reports them to the form). */
export function tablesReadByLabels(fields: readonly FieldLike[]): Set<string> {
  const out = new Set<string>()
  for (const f of fields) if (isLabel(f)) for (const t of readsTableRows(f)) out.add(t)
  return out
}

export interface ExpressionKnown {
  /** Every field key of the form. */
  fields: ReadonlySet<string>
  /** Data tables → their column keys. */
  tables: ReadonlyMap<string, readonly string[]>
  /** Label keys. */
  labels: ReadonlySet<string>
  /** Lookup (autocomplete) keys. */
  lookups?: ReadonlySet<string>
  /** Section keys (control.<section>.included / visible). */
  sections?: ReadonlySet<string>
  params: ReadonlySet<string>
  variables: ReadonlySet<string>
  /** The label being checked (it may not read itself). */
  self?: string
}

const TABLE_PARTS = new Set(['rows', 'added_rows', 'changed_rows', 'deleted_rows', 'selected_rows', 'selected_row', 'selected_row_id', 'selected_count', 'last_clicked_row', 'last_clicked_row_id', 'row_count', 'changes_count'])

/** What's wrong with a formula (empty list: fine): syntax, unknown names, functions, volatile functions. */
export function expressionProblems(body: string | undefined, known: ExpressionKnown): string[] {
  if (!body || !body.trim()) return []
  const out: string[] = []
  if (body.length > LABEL_LIMITS.expression) out.push(`The expression is longer than ${LABEL_LIMITS.expression} characters`)
  const { paths, functions, problem } = lex(body)
  if (problem) out.push(problem)
  for (const fn of new Set(functions)) {
    if (VOLATILE_FUNCTIONS.has(fn)) out.push(`${fn}() changes every time, so a label can't use it (use TODAY() for the date)`)
    else if (!LABEL_FUNCTIONS.has(fn)) out.push(/^[A-Z_][A-Z0-9_]*$/.test(fn) ? `Unknown function ${fn}()` : `Functions are written in capitals: ${fn.toUpperCase()}()`)
  }
  for (const path of new Set(paths)) {
    const issue = pathProblem(path, known)
    if (issue) out.push(issue)
  }
  return [...new Set(out)]
}

function pathProblem(path: string, known: ExpressionKnown): string | null {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.')
  if (parts[0] === 'param') return parts[1] && !known.params.has(parts[1]) ? `No parameter "${parts[1]}" (declare it on the Data tab)` : null
  if (parts[0] === 'var') return parts[1] && !known.variables.has(parts[1]) ? `No variable "${parts[1]}" (declare it on the Data tab)` : null
  if (parts[0] === 'control') {
    const key = parts[1] ?? ''
    if (known.self && key === known.self) return 'A label can\'t read its own value'
    if (known.tables.has(key)) {
      if (parts[2] && !TABLE_PARTS.has(parts[2])) return `"${parts[2]}" is not part of the table "${key}" (rows, selected_rows, added_rows…)`
      const cols = known.tables.get(key) ?? []
      if ((parts[2] === 'selected_row' || parts[2] === 'last_clicked_row') && parts[3] && cols.length && !cols.includes(parts[3])) return `The table "${key}" has no column "${parts[3]}"`
      return null
    }
    if (known.labels.has(key) || known.lookups?.has(key) || known.sections?.has(key) || key === 'form') return null
    return `No control "${key}" on this form`
  }
  const key = parts[0] === 'form' || parts[0] === 'task_data' ? parts[1] : parts[0]
  if (!key) return null
  if (known.self && key === known.self) return 'A label can\'t read its own value'
  if (known.fields.has(key) || known.fields.has(key.replace(/_(label|item|count|included)$/, ''))) return null
  return `Unknown name "${path}" (pick a field, parameter or control with {x})`
}

/* ── Expressions: evaluating ────────────────────────────────────────── */

export interface LabelEvaluation {
  value: unknown
  /** The expression gave no usable value (shown as a hint, never thrown). */
  warning?: string
  /** It could not be evaluated at all. */
  error?: string
  ms?: number
}

/**
 * The scope a formula reads: the field keys themselves and `form.<key>` /
 * `task_data.<key>`, `param.*`, `var.*` and `control.*`. Number / currency
 * fields are numbers (no locale parsing: a typed "1,234.5" is read with
 * comma thousands, anything else that isn't plain is left as text).
 */
export function labelScope(fields: readonly FieldLike[], values: Record<string, unknown>): Record<string, unknown> {
  const own: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values ?? {})) if (k !== CONTROLS_KEY && k !== FORM_PARAMS_KEY && k !== FORM_VARS_KEY) own[k] = v
  for (const f of fields) {
    if ((f.type === 'number' || f.type === 'currency') && typeof own[f.key] === 'string') {
      const n = plainNumber(own[f.key] as string)
      if (n !== null) own[f.key] = n
    }
  }
  const obj = (k: string) => (isPlainObject(values?.[k]) ? values[k] as Record<string, unknown> : {})
  return { ...own, form: own, task_data: own, param: obj(FORM_PARAMS_KEY), var: obj(FORM_VARS_KEY), control: obj(CONTROLS_KEY) }
}

/** Plain numeric text ("12", "-3.5", "1,234.50") → a number; anything else (locale formats, units) → null. */
export function plainNumber(text: string): number | null {
  const s = String(text ?? '').trim()
  if (!s || !/^-?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?$/.test(s) || s === '-') return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

/** Evaluate a label's formula in a scope (labelScope). Never throws. */
export function evaluateLabelExpression(body: string | undefined, scope: Record<string, unknown>): LabelEvaluation {
  const formula = expressionBody(body ?? '')
  if (!formula) return { value: null }
  if (formula.length > LABEL_LIMITS.expression) return { value: null, error: `The expression is longer than ${LABEL_LIMITS.expression} characters` }
  const { functions, problem } = lex(formula)
  if (problem) return { value: null, error: problem }
  const volatile = functions.find((fn) => VOLATILE_FUNCTIONS.has(fn))
  if (volatile) return { value: null, error: `${volatile}() can't be used in a label` }
  const started = Date.now()
  let raw: unknown
  const stripped = stripBraces(formula)
  try {
    raw = evaluateFunction(stripped, scope)
  } catch {
    return { value: null, error: 'The expression could not be worked out' }
  }
  const ms = Date.now() - started
  // The engine hands back the text it couldn't read (an unknown name, a dangling operator).
  if (typeof raw === 'string' && raw === stripped && !/^\s*(["']).*\1\s*$/.test(stripped)) {
    return { value: null, error: 'The expression could not be worked out — check the names and operators', ms }
  }
  return { ...settle(raw), ms }
}

/** A raw result as a label value: numbers finite, lists joined, rows refused, text bounded. */
function settle(raw: unknown): LabelEvaluation {
  if (raw === undefined || raw === null) return { value: null, warning: 'No value for this data (a value it reads is empty, or a division by zero)' }
  if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { value: null, warning: 'No value: division by zero' }
  if (typeof raw === 'boolean') return { value: raw }
  if (typeof raw === 'string') return { value: raw.length > LABEL_LIMITS.text ? raw.slice(0, LABEL_LIMITS.text) : raw }
  if (Array.isArray(raw)) {
    if (raw.some((v) => v !== null && typeof v === 'object')) return { value: null, error: 'The expression gives a list of rows: add them up (SUM(rows, "column")) or count them (COUNT(rows))' }
    return { value: raw.map((v) => (v === null || v === undefined ? '' : String(v))).join(', ').slice(0, LABEL_LIMITS.text) }
  }
  return { value: null, error: 'The expression gives a whole row: pick one of its values (row.column)' }
}

/* ── Data table rows ────────────────────────────────────────────────── */

function typedCell(config: DataTableFieldConfig, key: string, value: unknown): unknown {
  const col = config.columns.find((c) => c.key === key)
  if (col?.type === 'number' && typeof value === 'string') return plainNumber(value) ?? (value.trim() === '' ? null : value)
  return value
}

function typedRow(config: DataTableFieldConfig, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) out[k] = typedCell(config, k, v)
  return out
}

/**
 * The rows a table holds now: the loaded rows with the change set applied —
 * new rows first (as the grid shows them), changed cells over the loaded
 * values, deleted rows left out. Cells typed by their column.
 */
export function workingRows(config: DataTableFieldConfig, loaded: readonly Record<string, unknown>[], changes: unknown, limit = 1000): Array<Record<string, unknown>> {
  const keyColumn = dataTableKeyColumn(config)
  const set: DataTableChangeSet | null = config.mode === 'edit' && isChangeSet(changes) ? changes : null
  const deleted = new Set((set?.deleted ?? []).map((d) => String(d.key)))
  const updates = new Map((set?.updated ?? []).map((u) => [String(u.key), u.after]))
  const out: Array<Record<string, unknown>> = []
  for (const r of set?.added ?? []) if (isPlainObject(r)) out.push(typedRow(config, r))
  for (const r of loaded) {
    if (!isPlainObject(r)) continue
    const key = String(r[keyColumn] ?? '')
    if (deleted.has(key)) continue
    const after = updates.get(key)
    out.push(typedRow(config, after ? { ...r, ...after } : r))
  }
  return out.slice(0, limit)
}

/** The change set as row lists (editable tables): added, changed (before + after) and deleted rows. */
export function changeRows(config: DataTableFieldConfig, changes: unknown): { added_rows: Array<Record<string, unknown>>; changed_rows: Array<Record<string, unknown>>; deleted_rows: Array<Record<string, unknown>> } {
  const keyColumn = dataTableKeyColumn(config)
  const set = config.mode === 'edit' && isChangeSet(changes) ? changes : null
  return {
    added_rows: (set?.added ?? []).filter(isPlainObject).map((r) => typedRow(config, r)),
    changed_rows: (set?.updated ?? []).filter((u) => isPlainObject(u)).map((u) => typedRow(config, { ...(isPlainObject(u.before) ? u.before : {}), ...(isPlainObject(u.after) ? u.after : {}), [keyColumn]: u.key })),
    deleted_rows: (set?.deleted ?? []).filter((d) => isPlainObject(d)).map((d) => typedRow(config, { ...(isPlainObject(d.before) ? d.before : {}), [keyColumn]: d.key })),
  }
}

/* ── Order and loops ────────────────────────────────────────────────── */

/** The label keys a label's expression reads (directly). */
function labelDeps(field: LabelLike, labels: ReadonlySet<string>): string[] {
  return expressionPaths(field.label_config?.expression).map(pathKey).filter((k): k is string => Boolean(k) && labels.has(k!) && k !== field.key)
}

/**
 * Labels in the order they can be worked out (a label after the labels its
 * expression reads), and the labels on a circular chain (A reads B reads A),
 * which get no value.
 */
export function labelOrder(fields: readonly LabelLike[]): { order: LabelLike[]; cyclic: Set<string> } {
  const labels = fields.filter(isLabel)
  const keys = new Set(labels.map((l) => l.key))
  const byKey = new Map(labels.map((l) => [l.key, l]))
  const state = new Map<string, 'visiting' | 'done'>()
  const order: LabelLike[] = []
  const cyclic = new Set<string>()
  const visit = (key: string, stack: string[]) => {
    if (state.get(key) === 'done') return
    if (state.get(key) === 'visiting') { for (const k of stack.slice(stack.indexOf(key))) cyclic.add(k); return }
    state.set(key, 'visiting')
    const field = byKey.get(key)!
    // A label reading itself (it would never settle).
    if (expressionPaths(field.label_config?.expression).some((p) => pathKey(p) === key)) cyclic.add(key)
    for (const dep of labelDeps(field, keys)) visit(dep, [...stack, key])
    state.set(key, 'done')
    order.push(field)
  }
  for (const l of labels) visit(l.key, [])
  return { order, cyclic }
}

/** The keys a rule's actions write (Set / Copy / Clear values, an API reference's results). */
export function ruleWrites(rule: Pick<FormRule, 'then'>): string[] {
  const out = new Set<string>()
  for (const a of allActions(rule.then)) {
    if ((a.type === 'set_values' || a.type === 'copy_values') && a.assign) for (const k of Object.keys(a.assign)) out.add(k)
    if (a.type === 'clear_values') for (const k of a.fields ?? []) out.add(k)
    if (a.type === 'call_reference') for (const k of Object.values(a.results ?? {})) if (!k.startsWith('var.')) out.add(k)
  }
  return [...out]
}

/**
 * Loops through "Label changes" rules: a label's rule writes a value that
 * (through other labels' expressions and rules) changes that label again —
 * Total → Discount → Total. Each loop once, as the keys along it.
 */
export function labelLoops(fields: readonly FieldLike[], layout: unknown): string[][] {
  const labels = fields.filter(isLabel) as LabelLike[]
  if (!labels.length) return []
  const edges = new Map<string, Set<string>>()
  const add = (from: string, to: string) => { if (!edges.has(from)) edges.set(from, new Set()); edges.get(from)!.add(to) }
  // An expression: what it reads → the label.
  for (const l of labels) for (const p of expressionPaths(l.label_config?.expression)) { const k = pathKey(p); if (k && k !== l.key) add(k, l.key) }
  const eventEdges = new Set<string>()
  for (const r of layoutFormRules(layout)) {
    if (r.disabled || (r.event !== 'label_change' && r.event !== 'value_change')) continue
    const sources = r.target ? [r.target] : r.event === 'label_change' ? labels.map((l) => l.key) : []
    for (const from of sources) for (const to of ruleWrites(r)) { add(from, to); if (r.event === 'label_change') eventEdges.add(`${from}>${to}`) }
  }
  const loops: string[][] = []
  const seen = new Set<string>()
  const labelKeys = new Set(labels.map((l) => l.key))
  for (const start of labelKeys) {
    // Shortest path back to the start (BFS), through at least one Label-changes rule.
    const prev = new Map<string, string>()
    const queue: string[] = [start]
    const visited = new Set<string>([start])
    let found = false
    while (queue.length && !found) {
      const cur = queue.shift()!
      for (const next of edges.get(cur) ?? []) {
        if (next === start) { prev.set(`${start}#end`, cur); found = true; break }
        if (visited.has(next)) continue
        visited.add(next); prev.set(next, cur); queue.push(next)
      }
    }
    if (!found) continue
    const path: string[] = [start]
    let cur = prev.get(`${start}#end`)!
    const back: string[] = []
    while (cur !== start) { back.push(cur); cur = prev.get(cur)! }
    path.push(...back.reverse(), start)
    const hasEvent = path.slice(0, -1).some((k, i) => eventEdges.has(`${k}>${path[i + 1]}`))
    if (!hasEvent) continue
    const id = [...new Set(path.slice(0, -1))].sort().join('|')
    if (seen.has(id)) continue
    seen.add(id)
    loops.push(path)
  }
  return loops
}

/** Designer warnings for label loops (one line per loop). */
export function labelLoopWarnings(fields: readonly FieldLike[], layout: unknown): string[] {
  const name = (k: string) => fields.find((f) => f.key === k)?.label || k
  return labelLoops(fields, layout).map((path) => `"Label changes" rules go round in a loop: ${path.map(name).join(' → ')}. The form stops after ${LABEL_LIMITS.chain} rounds; change one rule so the chain ends.`)
}

/* ── Values ─────────────────────────────────────────────────────────── */

function same(a: unknown, b: unknown): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === ''
  if (blank(a) && blank(b)) return true
  if (typeof a === 'number' && typeof b === 'number') return a === b
  return JSON.stringify(a) === JSON.stringify(b)
}
export { same as sameLabelValue }

/** A label value as stored: numbers / booleans kept, text bounded, numeric formats read numbers from plain text; rows refused. */
export function coerceLabelValue(field: Pick<LabelLike, 'label_config'>, value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    if (!value.trim()) return null
    const kind = field.label_config?.format?.kind
    if (kind === 'number' || kind === 'integer' || kind === 'currency' || kind === 'percent') { const n = plainNumber(value); if (n !== null) return n }
    return value.slice(0, LABEL_LIMITS.text)
  }
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== 'object')) return value.map((v) => String(v ?? '')).join(', ').slice(0, LABEL_LIMITS.text)
  return null
}

/**
 * The browser's label values for these values: each label with an
 * expression, worked out in dependency order (a label reading another sees
 * its new value). Labels without an expression are left to rules / defaults.
 */
export function computeLabelValues(fields: readonly FieldLike[], values: Record<string, unknown>): Record<string, { value: unknown; evaluation: LabelEvaluation }> {
  const out: Record<string, { value: unknown; evaluation: LabelEvaluation }> = {}
  const { order, cyclic } = labelOrder(fields as LabelLike[])
  if (!order.some((l) => l.label_config?.expression)) return out
  let current = values
  for (const label of order) {
    if (!label.label_config?.expression) continue
    if (cyclic.has(label.key)) { out[label.key] = { value: null, evaluation: { value: null, error: 'This label\'s expression reads itself (through other labels)' } }; continue }
    const evaluation = evaluateLabelExpression(label.label_config.expression, labelScope(fields, current))
    const value = coerceLabelValue(label, evaluation.value)
    out[label.key] = { value, evaluation }
    current = withLabelControl({ ...current, [label.key]: value }, label.key, value)
  }
  return out
}

/** The values with `control.<label>.value` set (the label's control state). */
function withLabelControl(values: Record<string, unknown>, key: string, value: unknown): Record<string, unknown> {
  const controls = isPlainObject(values[CONTROLS_KEY]) ? values[CONTROLS_KEY] as Record<string, unknown> : {}
  return { ...values, [CONTROLS_KEY]: { ...controls, [key]: { value } } }
}

export interface ServerLabelOptions {
  /** What the browser sent (a label's own claimed value). */
  sent: Record<string, unknown>
  /** Values stored before (a task's template_values). */
  stored?: Record<string, unknown>
  /** Data tables' source rows, rebuilt by the server (the first page, as the form loads it). */
  rows?: Record<string, Array<Record<string, unknown>>>
}

/**
 * The server's label values (every label, so rules judged at submit read
 * the right ones): an expression recomputed from `values` (server-checked)
 * with each table's `rows` rebuilt from `options.rows` and the change set;
 * a label without one keeps the sent value only when a rule of the saved
 * form could have produced it, else the stored value or its default. The
 * browser's value for an expression label is never used.
 */
export function serverLabelValues(fields: readonly FieldLike[], layout: unknown, values: Record<string, unknown>, options: ServerLabelOptions): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {}
  const { order, cyclic } = labelOrder(fields as LabelLike[])
  if (!order.length) return out
  // Tables' rows as the server sees them (never the browser's report).
  const controls: Record<string, unknown> = { ...(isPlainObject(values[CONTROLS_KEY]) ? values[CONTROLS_KEY] as Record<string, unknown> : {}) }
  for (const f of fields) {
    if (f.type !== 'data_table' || !f.data_table) continue
    const mine = isPlainObject(controls[f.key]) ? controls[f.key] as Record<string, unknown> : {}
    const changes = values[f.key]
    controls[f.key] = { ...mine, rows: workingRows(f.data_table, options.rows?.[f.key] ?? [], changes), ...changeRows(f.data_table, changes) }
  }
  let current: Record<string, unknown> = { ...values, [CONTROLS_KEY]: controls }
  const sent = options.sent ?? {}
  const stored = options.stored ?? {}
  const gate = ruleClaimGate(current)
  const apiFilled = new Set(layoutFormRules(layout).filter((r) => !r.disabled && r.event !== 'always' && r.event !== 'after_submit' && gate(r))
    .flatMap((r) => allActions(r.then).filter((a) => a.type === 'call_reference').flatMap((a) => Object.values(a.results ?? {}))))
  for (const label of order) {
    let value: unknown
    if (label.label_config?.expression) {
      value = cyclic.has(label.key) ? null : evaluateLabelExpression(label.label_config.expression, labelScope(fields, current)).value
    } else {
      const fallback = Object.prototype.hasOwnProperty.call(stored, label.key) ? stored[label.key] : label.default !== undefined ? resolveRuleTemplate(label.default, { values: current }) : null
      const claimed = Object.prototype.hasOwnProperty.call(sent, label.key) ? sent[label.key] : undefined
      value = fallback
      if (claimed !== undefined && !same(claimed, fallback)) {
        // A rule of the saved form could have written it (Set / Copy / Clear values: the same gate as read-only fields)…
        const written = ruleWrittenReadOnlyValues(layout, [label.key], { ...current, [label.key]: claimed }, { [label.key]: fallback })
        // …or an API reference's result (trusted like a click when its rule passes the gate: the server can't replay the call).
        if (Object.prototype.hasOwnProperty.call(written, label.key) || apiFilled.has(label.key)) value = claimed
      }
    }
    const typed = coerceLabelValue(label, value)
    out[label.key] = typed
    current = withLabelControl({ ...current, [label.key]: typed }, label.key, typed)
  }
  return out
}

/* ── Display ────────────────────────────────────────────────────────── */

/** The currency labels fall back to when nothing they read names one (no form / workspace currency exists). */
export const LABEL_DEFAULT_CURRENCY = 'USD'

/** Functions whose result is a count or text, never an amount (a label using one isn't defaulted to currency). */
const NOT_AN_AMOUNT = /^(COUNT\w*|CONCAT|TEXT\w*|LEN|JOIN|UPPER|LOWER|TRIM|PROPER|LEFT|RIGHT|MID|SUBSTITUTE|REPLACE|FORMAT\w*|DATE\w*|DAYS?|YEAR|MONTH|WEEKDAY|TODAY|IS\w+|NOT|AND|OR|EQ|NEQ|GT|GTE|LT|LTE)$/

interface FormatSourceField {
  key: string
  type: string
  currency?: string
  label_config?: LabelFieldConfig
  list?: { columns?: ReadonlyArray<{ key: string; type: string; currency?: string }> }
  repeating_section?: { fields?: ReadonlyArray<FormatSourceField> }
  data_table?: { columns?: ReadonlyArray<{ key: string; format?: CellFormat }> }
}

/** The currency code of a child (List column / repeating section inner field / Data table column), or null. */
function childCurrency(container: FormatSourceField, child: string): string | null {
  const col = container.list?.columns?.find((c) => c.key === child)
  if (col) return col.type === 'currency' || (col.type === 'calculated' && col.currency) ? (col.currency ?? LABEL_DEFAULT_CURRENCY) : null
  const inner = container.repeating_section?.fields?.find((f) => f.key === child)
  if (inner) return inner.type === 'currency' ? (inner.currency ?? LABEL_DEFAULT_CURRENCY) : null
  const dt = container.data_table?.columns?.find((c) => c.key === child)
  if (dt?.format?.kind === 'currency') return dt.format.currency ?? LABEL_DEFAULT_CURRENCY
  return null
}

/**
 * The display format a label takes when its author set none: currency when
 * the expression adds up money — currency fields, a List / Repeating
 * section's currency column or its `<key>_total_<column>`, a Data table's
 * currency column, or another currency label — in that currency (one code;
 * mixed codes give no default). Counts and text functions never default to
 * currency. Null: no default (numbers show as plain numbers).
 */
export function inferLabelFormat(field: Pick<FormatSourceField, 'key' | 'label_config'>, fields: readonly FormatSourceField[], depth = 0): CellFormat | null {
  const body = field.label_config?.expression
  if (!body || depth > 5) return null
  // A hand-written "$" / "USD" prefix or suffix already says it: don't add a symbol twice.
  if (field.label_config?.prefix || field.label_config?.suffix) return null
  const { paths, functions } = lex(body)
  if (functions.some((fn) => NOT_AN_AMOUNT.test(fn))) return null
  const byKey = new Map(fields.map((f) => [f.key, f]))
  // Column names quoted in the formula (SUM(PLUCK(form.x, "amount")), SUM(MAP(rows, "qty * price"))…).
  const quoted = new Set<string>()
  for (const m of stripBraces(body).matchAll(/"([^"]*)"|'([^']*)'/g)) for (const w of (m[1] ?? m[2] ?? '').match(/[A-Za-z_]\w*/g) ?? []) quoted.add(w)
  const codes = new Set<string>()
  for (const path of paths) {
    const key = pathKey(path)
    if (!key || key === field.key) continue
    const f = byKey.get(key)
    if (f) {
      if (f.type === 'currency') codes.add(f.currency ?? LABEL_DEFAULT_CURRENCY)
      else if (f.type === 'label') {
        const fmt = f.label_config?.format ?? inferLabelFormat(f, fields, depth + 1)
        if (fmt?.kind === 'currency') codes.add(fmt.currency ?? LABEL_DEFAULT_CURRENCY)
      } else if (f.list || f.repeating_section || f.data_table) {
        for (const w of quoted) { const c = childCurrency(f, w); if (c) codes.add(c) }
      }
      continue
    }
    // A List / Repeating section's stored total (<key>_total_<column>, <key>_avg_<column>).
    for (const c of fields) {
      if (!(c.list || c.repeating_section)) continue
      const m = new RegExp(`^${c.key}_(?:total|avg)_(\\w+)$`).exec(key)
      const code = m ? childCurrency(c, m[1]) : null
      if (code) codes.add(code)
    }
  }
  return codes.size === 1 ? { kind: 'currency', currency: [...codes][0] } : null
}

/** The format a label shows its value in: the author's, else the inferred default (inferLabelFormat), else none. */
export function labelDisplayFormat(field: Pick<FormatSourceField, 'key' | 'label_config'>, fields: readonly FormatSourceField[]): CellFormat | undefined {
  return field.label_config?.format ?? inferLabelFormat(field, fields) ?? undefined
}

/** The value as shown: formatted (cell formats), with the prefix / suffix; the empty text when there's no value. `inferred`: the default format when the config has none (labelDisplayFormat), used for numbers. */
export function formatLabelValue(config: LabelFieldConfig | undefined, value: unknown, options: { locale?: string; inferred?: CellFormat | null } = {}): FormattedCell & { prefix?: string; suffix?: string } {
  const format = config?.format ?? (options.inferred && typeof value === 'number' ? options.inferred : { kind: typeof value === 'number' ? 'number' as const : 'text' as const })
  const cell = formatCellValue(value, format, { locale: options.locale, placeholder: config?.empty_text ?? '—' })
  if (cell.empty) return cell
  return { ...cell, ...(config?.prefix ? { prefix: config.prefix } : {}), ...(config?.suffix ? { suffix: config.suffix } : {}) }
}

/** Is a label dynamic (its value can change while the form is open): an expression, or a rule writes it. */
export function isDynamicLabel(field: Pick<LabelLike, 'key' | 'label_config'>, layout: unknown): boolean {
  if (field.label_config?.expression) return true
  return layoutFormRules(layout).some((r) => !r.disabled && ruleWrites(r).includes(field.key))
}

/* ── Events: the "Label changes" cascade guard ──────────────────────── */

/**
 * Bounds chains of "Label changes" rules: a change noticed while a label's
 * rules run (or right after) continues the chain; any other change starts
 * a new one. Past LABEL_LIMITS.chain rounds the event is not dispatched.
 */
export class LabelCascade {
  private depth = 0
  private running = 0
  private lastEnd = Number.NEGATIVE_INFINITY
  constructor(private readonly max: number = LABEL_LIMITS.chain, private readonly settleMs = 60, private readonly now: () => number = () => Date.now()) {}

  /** A label changed: is it part of the running chain? */
  note(): boolean {
    return this.running > 0 || this.now() - this.lastEnd <= this.settleMs
  }

  /** Start a round (false: the chain is too long — don't dispatch). */
  begin(chained: boolean): boolean {
    if (!chained) this.depth = 0
    if (this.depth >= this.max) return false
    this.depth++
    this.running++
    return true
  }

  end(): void {
    this.running = Math.max(0, this.running - 1)
    this.lastEnd = this.now()
  }

  get rounds(): number { return this.depth }
}

/* ── Designer ───────────────────────────────────────────────────────── */

/** A formula with a field key renamed (as a name, `form.<key>`, `task_data.<key>`, `control.<key>`, `{{…}}` alike); quoted text untouched. */
export function renameExpressionKey(body: string, from: string, to: string): string {
  if (!body || from === to) return body
  let out = ''
  for (let i = 0; i < body.length;) {
    const ch = body[i]
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < body.length && body[j] !== ch) j += body[j] === '\\' ? 2 : 1
      out += body.slice(i, j + 1)
      i = j + 1
      continue
    }
    const m = /^[A-Za-z_]\w*(?:\.\w+)*/.exec(body.slice(i))
    if (m && !/[\w.]/.test(body[i - 1] ?? '')) {
      const parts = m[0].split('.')
      const at = ['form', 'task_data', 'control'].includes(parts[0]) && parts.length > 1 ? 1 : 0
      let k = i + m[0].length
      while (body[k] === ' ') k++
      if (parts[at] === from && body[k] !== '(') parts[at] = to
      out += parts.join('.')
      i += m[0].length
      continue
    }
    out += ch
    i++
  }
  return out
}

/** What a label's expression may read in this designer state (for expressionProblems). */
export function expressionKnown(fields: readonly FieldLike[], layout: unknown, self?: string): ExpressionKnown {
  const l = isPlainObject(layout) ? layout : {}
  const names = (list: unknown) => new Set((Array.isArray(list) ? list : []).filter(isPlainObject).map((p) => String(p.name ?? '')).filter(Boolean))
  return {
    fields: new Set(fields.map((f) => f.key)),
    tables: new Map(fields.filter((f) => f.type === 'data_table' && f.data_table).map((f) => [f.key, f.data_table!.columns.map((c) => c.key)])),
    labels: new Set(fields.filter(isLabel).map((f) => f.key)),
    lookups: new Set(fields.filter((f) => f.type === 'lookup').map((f) => f.key)),
    sections: new Set((Array.isArray(l.sections) ? l.sections : []).filter(isPlainObject).map((s) => String(s.key ?? ''))),
    params: names(l.params),
    variables: names(l.variables),
    ...(self ? { self } : {}),
  }
}
