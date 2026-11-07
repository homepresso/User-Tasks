/**
 * Dynamic properties: a field property (choice options, default, min / max,
 * earliest / latest date, placeholder, help text, label, required) or a
 * custom control prop takes its value from a SOURCE instead of the static
 * value the designer typed:
 *
 *   expr       a placeholder expression — {{param.x}}, {{var.x}},
 *              {{form.x}}, {{control.x.*}}, {{user.*}}, {{today+7d}}… One
 *              whole placeholder keeps its raw value (a number, a list).
 *              Resolved in the browser, again whenever what it reads
 *              changes; the server resolves it again on submit (against
 *              the server-validated parameters / variables).
 *   table      a workspace data table query: the columns to read (value /
 *              label for options, or a row list), a base filter (values may
 *              be placeholders), a sort and a limit.
 *   reference  an API reference / connector operation: inputs mapped from
 *              placeholders, the rows list in the response and the fields
 *              to keep.
 *
 * Stored on the field as `dynamic: { <property>: <binding> }` (custom
 * control props as `props.<name>`), beside the static value — which stays
 * the designer's preview and the fallback. So bindings travel wherever the
 * field goes (versions, exports / imports, packages — `table_id` /
 * `reference_id` are remapped by the generic id remap — the REST API, MCP,
 * config-as-code), and a form without `dynamic` behaves exactly as before.
 *
 * Security model (lib/services/form-dynamic-values.ts):
 *  - table / reference bindings run on the SERVER and only as declared in
 *    the saved form (the browser names a field and a property, never a
 *    source, a projection or a filter);
 *  - the reader's access applies like a Data table field's (data.view and
 *    row-level security as the user; "open access" lets the form authorise
 *    the read; anonymous visitors only with the binding's own
 *    `anonymous_read`), placeholders are quoted values that only narrow the
 *    base filter, rows are capped and projected to the declared columns;
 *  - on submit the server re-resolves options (and bounds / required) for
 *    that submission's context and validates against them — never the
 *    browser's list.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import {
  DATA_TABLE_LIMITS, groupConditions, normalizeConditionGroup, resolveDataTableTemplate, templatePaths,
  type DataTableColumnType, type DataTableConditionGroup, type DataTableFieldConfig, type DataTableScope, type DataTableSort,
} from './data-table'
import { CONTROLS_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY } from './form-params'
import { isCollectionPath, normalizeCollectionPath } from '@/lib/response-collections'
import type { ControlPropSpec, ControlPropType } from './custom-controls/contract'

export type DynamicBindingKind = 'expr' | 'table' | 'reference'
export const DYNAMIC_BINDING_KINDS: DynamicBindingKind[] = ['expr', 'table', 'reference']
export const DYNAMIC_BINDING_KIND_LABELS: Record<DynamicBindingKind, string> = { expr: 'Expression', table: 'Data table', reference: 'API reference' }

/** What a property expects (the binding's result is coerced to it, or refused). */
export type DynamicValueType = 'string' | 'number' | 'boolean' | 'date' | 'options' | 'string_list' | 'list' | 'object' | 'any'
export const DYNAMIC_VALUE_TYPE_LABELS: Record<DynamicValueType, string> = {
  string: 'text', number: 'a number', boolean: 'yes / no', date: 'a date', options: 'a list of options { value, label }',
  string_list: 'a list of text', list: 'a list of objects', object: 'an object', any: 'any JSON value',
}

/** A column (table) or field path (API item) a source binding reads, with an optional output name. */
export interface DynamicColumn { key: string; as?: string }

interface SourceShape {
  /** options: the option value; scalars / text lists: the value read. */
  value?: string
  /** options: the option label (default: the value). */
  label?: string
  /** list / object: the columns (paths) each item keeps, renamed by `as`. */
  columns?: DynamicColumn[]
  base_filter?: DataTableConditionGroup
  sort?: DataTableSort[]
  /** Rows read (capped by DYNAMIC_LIMITS). */
  limit?: number
  /** Anonymous forms (/p/<token>): visitors may read this source (the declared columns within the filter). */
  anonymous_read?: boolean
  /** options: refuse a submitted value outside the resolved list (default true). */
  restrict?: boolean
}

export interface ExprBinding { kind: 'expr'; expr: string; expects?: DynamicValueType }
export interface TableBinding extends SourceShape {
  kind: 'table'
  table_id: string
  /** People who may fill in the form read it without data.view (like a Data table field's open access). */
  open_access?: boolean
  expects?: DynamicValueType
}
export interface ReferenceBinding extends SourceShape {
  kind: 'reference'
  reference_id: string
  integration_id?: string
  input_mappings?: Record<string, string>
  /** Path of the rows list in the response ('' = the response itself). */
  results_path?: string
  expects?: DynamicValueType
}
export type DynamicBinding = ExprBinding | TableBinding | ReferenceBinding
export type SourceBinding = TableBinding | ReferenceBinding
export type DynamicBindings = Record<string, DynamicBinding>

export const DYNAMIC_LIMITS = {
  bindings: 40,
  expr: 2000,
  columns: 20,
  options: 500,
  rows: 1000,
  defaultRows: 100,
  text: 10_000,
  json: 64 * 1024,
} as const

/** Field properties that may be bound, by field type (custom control props: `props.<name>`). */
export const DYNAMIC_FIELD_PROPS = ['options', 'default', 'min', 'max', 'min_date', 'max_date', 'placeholder', 'help_text', 'label', 'required'] as const
export type DynamicFieldProp = (typeof DYNAMIC_FIELD_PROPS)[number]
export const DYNAMIC_PROP_LABELS: Record<DynamicFieldProp, string> = {
  options: 'Options', default: 'Default value', min: 'Minimum', max: 'Maximum', min_date: 'Earliest', max_date: 'Latest',
  placeholder: 'Placeholder', help_text: 'Help text', label: 'Label', required: 'Required',
}
/** Properties the server resolves again on submit (they decide validation). */
export const VALIDATING_PROPS: ReadonlySet<string> = new Set(['options', 'min', 'max', 'min_date', 'max_date', 'required'])

const TEXT_LIKE = new Set(['text', 'textarea', 'email', 'phone', 'url'])
const NO_VALUE = new Set(['heading', 'divider', 'button'])
const COLUMN_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const PATH_RE = /^[A-Za-z0-9_$-]{1,64}(?:\.[A-Za-z0-9_$-]{1,64}){0,7}$/
const AS_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const INPUT_NAME_RE = /^[A-Za-z0-9_.$-]{1,100}$/
const PROP_KEY_RE = /^props\.[A-Za-z_][A-Za-z0-9_]{0,63}$/
const UNSAFE = /(^|\.)(__proto__|constructor|prototype)(\.|$)/

interface FieldLike { key?: string; type: string; display?: string; custom?: { props?: Record<string, unknown> } | null }

/** The type a built-in property expects on a field of this type (null: not bindable there). */
export function fieldPropType(field: FieldLike, prop: string): DynamicValueType | null {
  const t = field.type
  if (NO_VALUE.has(t)) return null
  // Label fields (lib/forms/label-field.ts) display a value: their caption, help text and default may be dynamic —
  // never options, bounds or required (their value comes from the expression / rules / default).
  if (t === 'label' && prop !== 'label' && prop !== 'help_text' && prop !== 'default') return null
  switch (prop) {
    case 'label': case 'help_text': return 'string'
    case 'required': return 'boolean'
    case 'placeholder':
      return TEXT_LIKE.has(t) || t === 'number' || t === 'currency' || t === 'date' || t === 'lookup' || t === 'user' || (t === 'choice' && field.display !== 'radio') ? 'string' : null
    case 'default':
      if (t === 'attachments' || t === 'custom' || t === 'data_table' || t === 'lookup') return null
      return t === 'multi_choice' ? 'string_list' : t === 'number' || t === 'currency' ? 'number' : t === 'boolean' ? 'boolean' : t === 'date' ? 'date' : 'string'
    case 'options': return t === 'choice' || t === 'multi_choice' ? 'options' : null
    case 'min': case 'max': return t === 'number' || t === 'currency' || t === 'multi_choice' ? 'number' : null
    case 'min_date': case 'max_date': return t === 'date' || t === 'datetime' ? 'date' : null
    default: return null
  }
}

/** The type a custom control prop expects (from its manifest type). */
export function controlPropType(type: ControlPropType): DynamicValueType {
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'string[]') return 'string_list'
  if (type === 'json') return 'any'
  return 'string'
}

/**
 * Whether a manifest prop may be bound: `bindable: true` / `false` decides;
 * without it, data-shaped props (text, number, yes / no, lists, JSON) are
 * bindable and choices / colours are not.
 */
export function isBindableProp(prop: Pick<ControlPropSpec, 'type'> & { bindable?: boolean }): boolean {
  if (prop.bindable === true || prop.bindable === false) return prop.bindable
  return prop.type !== 'select' && prop.type !== 'color'
}

/** The expected type of a binding key on this field (custom props: the binding's own `expects`, a snapshot of the manifest). */
export function expectedType(field: FieldLike, key: string, binding?: DynamicBinding): DynamicValueType | null {
  if (PROP_KEY_RE.test(key)) return field.type === 'custom' ? binding?.expects ?? 'any' : null
  return fieldPropType(field, key)
}

/* ── Normalisation ───────────────────────────────────────────────────── */

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

function sourceKey(kind: 'table' | 'reference', raw: unknown): string | undefined {
  const s = str(raw, 200)
  if (!s || UNSAFE.test(s)) return undefined
  return (kind === 'table' ? COLUMN_RE : PATH_RE).test(s) ? s : undefined
}

function intIn(raw: unknown, min: number, max: number): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : undefined
}

function normalizeExpects(raw: unknown): DynamicValueType | undefined {
  return typeof raw === 'string' && raw in DYNAMIC_VALUE_TYPE_LABELS ? raw as DynamicValueType : undefined
}

function normalizeShape(kind: 'table' | 'reference', src: Record<string, unknown>, out: SourceShape) {
  const value = sourceKey(kind, src.value)
  const label = sourceKey(kind, src.label)
  if (value) out.value = value
  if (label) out.label = label
  if (Array.isArray(src.columns)) {
    const cols: DynamicColumn[] = []
    for (const c of src.columns.slice(0, DYNAMIC_LIMITS.columns)) {
      const key = sourceKey(kind, isPlainObject(c) ? c.key : c)
      if (!key || cols.some((x) => x.key === key)) continue
      const as = isPlainObject(c) ? str(c.as, 64) : undefined
      cols.push(as && AS_RE.test(as) && as !== key ? { key, as } : { key })
    }
    if (cols.length) out.columns = cols
  }
  const base = normalizeConditionGroup(src.base_filter)
  if (base) {
    // Only columns of the source: a table's column keys, an API item's paths.
    const ok = groupConditions(base).every((c) => sourceKey(kind, c.column) === c.column || (kind === 'table' && c.column === 'row_id'))
    if (ok) out.base_filter = base
  }
  if (Array.isArray(src.sort)) {
    const sort: DataTableSort[] = []
    for (const s of src.sort.slice(0, DATA_TABLE_LIMITS.sorts)) {
      const column = isPlainObject(s) ? sourceKey(kind, s.column) : undefined
      if (column && !sort.some((x) => x.column === column)) sort.push({ column, direction: isPlainObject(s) && s.direction === 'desc' ? 'desc' : 'asc' })
    }
    if (sort.length) out.sort = sort
  }
  const limit = intIn(src.limit, 1, DYNAMIC_LIMITS.rows)
  if (limit !== undefined) out.limit = limit
  if (src.anonymous_read === true) out.anonymous_read = true
  if (src.restrict === false) out.restrict = false
}

/** Clean one stored binding (null when it can't be used). */
export function normalizeDynamicBinding(raw: unknown): DynamicBinding | null {
  if (!isPlainObject(raw)) return null
  const expects = normalizeExpects(raw.expects)
  if (raw.kind === 'expr') {
    const expr = typeof raw.expr === 'string' ? raw.expr.slice(0, DYNAMIC_LIMITS.expr) : ''
    if (!expr.trim()) return null
    return { kind: 'expr', expr, ...(expects ? { expects } : {}) }
  }
  if (raw.kind === 'table') {
    const tableId = str(raw.table_id, 64)
    if (!tableId) return null
    const out: TableBinding = { kind: 'table', table_id: tableId }
    normalizeShape('table', raw, out)
    if (raw.open_access === true) out.open_access = true
    if (expects) out.expects = expects
    return out
  }
  if (raw.kind === 'reference') {
    const referenceId = str(raw.reference_id, 64)
    if (!referenceId) return null
    const out: ReferenceBinding = { kind: 'reference', reference_id: referenceId }
    const integrationId = str(raw.integration_id, 64)
    if (integrationId) out.integration_id = integrationId
    if (isPlainObject(raw.input_mappings)) {
      const mappings: Record<string, string> = {}
      for (const [name, value] of Object.entries(raw.input_mappings).slice(0, 30)) {
        if (!INPUT_NAME_RE.test(name) || UNSAFE.test(name)) continue
        const t = typeof value === 'string' ? value.slice(0, DATA_TABLE_LIMITS.template) : ''
        if (t.trim()) mappings[name] = t
      }
      if (Object.keys(mappings).length) out.input_mappings = mappings
    }
    const results = typeof raw.results_path === 'string' ? normalizeCollectionPath(raw.results_path) : ''
    if (results && isCollectionPath(results)) out.results_path = results
    normalizeShape('reference', raw, out)
    if (expects) out.expects = expects
    return out
  }
  return null
}

/**
 * The bindings of a field, cleaned: only properties bindable on its type
 * (custom control props: names the control could have), each a valid binding.
 * Undefined when there are none (the stored field stays as it was).
 */
export function normalizeDynamicBindings(raw: unknown, field: FieldLike): DynamicBindings | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: DynamicBindings = {}
  for (const [key, value] of Object.entries(raw).slice(0, DYNAMIC_LIMITS.bindings)) {
    const binding = normalizeDynamicBinding(value)
    if (!binding) continue
    if (PROP_KEY_RE.test(key) ? field.type !== 'custom' : !fieldPropType(field, key)) continue
    // Built-in properties: the type is the property's (a stored `expects` never changes it).
    if (!PROP_KEY_RE.test(key)) delete binding.expects
    out[key] = binding
  }
  return Object.keys(out).length ? out : undefined
}

export function isSourceBinding(binding: DynamicBinding | null | undefined): binding is SourceBinding {
  return binding?.kind === 'table' || binding?.kind === 'reference'
}

/** Problems the designer flags for a field's bindings (key → message; none = {}). */
export function dynamicBindingProblems(field: FieldLike & { dynamic?: DynamicBindings }): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, b] of Object.entries(field.dynamic ?? {})) {
    const expects = expectedType(field, key, b)
    if (!expects) { out[key] = 'This property cannot be dynamic on this field'; continue }
    if (b.kind === 'expr') continue
    const needsValue = expects !== 'list' && expects !== 'object' && expects !== 'any'
    if (needsValue && !b.value) out[key] = expects === 'options' ? 'Choose the column holding the option value' : 'Choose the column to read the value from'
    else if (!needsValue && !b.value && !b.columns?.length) out[key] = 'Choose the columns each item keeps'
  }
  return out
}

/* ── Dependencies, templates ─────────────────────────────────────────── */

function bindingTexts(binding: DynamicBinding): string[] {
  if (binding.kind === 'expr') return [binding.expr]
  const texts = groupConditions(binding.base_filter).map((c) => c.value ?? '')
  if (binding.kind === 'reference') texts.push(...Object.values(binding.input_mappings ?? {}))
  return texts
}

/**
 * Value keys a binding reads — form fields ({{form.x}} / {{x}}), and the
 * parameters / variables / controls (their reserved keys): it resolves
 * again when one of them changes.
 */
export function bindingDependencies(binding: DynamicBinding): string[] {
  const out: string[] = []
  const add = (k: string) => { if (!out.includes(k)) out.push(k) }
  for (const text of bindingTexts(binding)) {
    for (const path of templatePaths(text)) {
      const context = /^(param|var|control)(\.|$)/.exec(path)
      if (context) { add(context[1] === 'param' ? FORM_PARAMS_KEY : context[1] === 'var' ? FORM_VARS_KEY : CONTROLS_KEY); continue }
      const m = /^(?:task_data|form|task\.data)\.([a-z0-9_]+)/.exec(path) ?? /^([a-z0-9][a-z0-9_]*)$/.exec(path)
      if (m && !/^(today|now|start_of_month|start_of_year|user)$/.test(m[1])) add(m[1])
    }
  }
  return out
}

/**
 * What a source binding sends with each request: the values of the keys it
 * reads (its re-query key — a change to any of them fetches again; any
 * other change to the form doesn't).
 */
export function bindingInputs(binding: DynamicBinding, values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(bindingDependencies(binding).map((k) => [k, values[k] ?? null]))
}

/** Whether a binding reads {{user.*}} (resolved in the browser from the signed-in user). */
export function bindingReadsUser(binding: DynamicBinding): boolean {
  return bindingTexts(binding).some((t) => templatePaths(t).some((p) => p.startsWith('user.')))
}

/**
 * Resolve an expression: the Data table placeholder rules ({{form.x}},
 * {{param.x}}, {{var.x}}, {{control.x.*}}, {{user.*}}, dates) — and a bare
 * {{field_key}} reads that field. One whole placeholder keeps its raw value.
 */
export function resolveExpression(expr: string, scope: DataTableScope): unknown {
  const bare = expr.replace(/\{\{\s*([a-z0-9][a-z0-9_]*)\s*\}\}/g, (whole, key: string) =>
    /^(today|now|start_of_month|start_of_year|search|page|sort|offset)$/.test(key) ? whole : `{{form.${key}}}`)
  return resolveDataTableTemplate(bare, scope)
}

/* ── Type checks / coercion ──────────────────────────────────────────── */

export interface DynamicOption { value: string; label: string }
export type Coerced = { ok: true; value: unknown } | { ok: false; error: string }

function parseJson(text: string): unknown {
  const s = text.trim()
  if (!(s.startsWith('[') || s.startsWith('{'))) return undefined
  try { return JSON.parse(s) } catch { return undefined }
}

function scalarText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '' } }
  return String(v)
}

function toOptions(raw: unknown, valueKey = 'value', labelKey = 'label'): DynamicOption[] | null {
  let list: unknown = raw
  if (typeof raw === 'string') list = parseJson(raw) ?? raw.split(',').map((s) => s.trim()).filter(Boolean)
  if (!Array.isArray(list)) return null
  const out: DynamicOption[] = []
  for (const item of list) {
    let value: string
    let label: string
    if (isPlainObject(item)) {
      value = scalarText(item[valueKey] ?? item.value ?? item[labelKey] ?? item.label).trim()
      label = scalarText(item[labelKey] ?? item.label ?? '').trim() || value
    } else {
      value = scalarText(item).trim()
      label = value
    }
    if (!value || value.length > 500 || out.some((o) => o.value === value)) continue
    out.push({ value, label: label.slice(0, 200) })
    if (out.length >= DYNAMIC_LIMITS.options) break
  }
  return out
}

function jsonSized(value: unknown): boolean {
  try { return JSON.stringify(value).length <= DYNAMIC_LIMITS.json } catch { return false }
}

/** Coerce a resolved value to what the property expects — or say why it doesn't fit. Blank → { ok, value: undefined }. */
export function coerceDynamicValue(expects: DynamicValueType, raw: unknown): Coerced {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: undefined }
  switch (expects) {
    case 'string':
      if (typeof raw === 'object') return { ok: false, error: 'Expected text, got a list or object' }
      return { ok: true, value: String(raw).slice(0, DYNAMIC_LIMITS.text) }
    case 'number': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim().replace(/,/g, '')) : NaN
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, error: `Expected a number, got ${JSON.stringify(scalarText(raw).slice(0, 40))}` }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw }
      if (typeof raw === 'number') return { ok: true, value: raw !== 0 }
      const s = String(raw).trim().toLowerCase()
      if (['true', '1', 'yes', 'y', 'on'].includes(s)) return { ok: true, value: true }
      if (['false', '0', 'no', 'n', 'off'].includes(s)) return { ok: true, value: false }
      return { ok: false, error: 'Expected yes / no (true or false)' }
    }
    case 'date': {
      const s = String(raw).trim()
      if (/^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(new Date(s).getTime())) return { ok: true, value: s.slice(0, 10) === s ? s : s.slice(0, 25) }
      return { ok: false, error: 'Expected a date (YYYY-MM-DD)' }
    }
    case 'options': {
      const list = toOptions(raw)
      return list ? { ok: true, value: list } : { ok: false, error: 'Expected a list of options' }
    }
    case 'string_list': {
      const list = toOptions(raw)
      return list ? { ok: true, value: list.map((o) => o.value).slice(0, 200) } : { ok: false, error: 'Expected a list of text' }
    }
    case 'list': {
      const v = typeof raw === 'string' ? parseJson(raw) : raw
      if (!Array.isArray(v)) return { ok: false, error: 'Expected a list' }
      return jsonSized(v) ? { ok: true, value: v.slice(0, DYNAMIC_LIMITS.rows) } : { ok: false, error: 'The list is too large' }
    }
    case 'object': {
      const v = typeof raw === 'string' ? parseJson(raw) : raw
      if (!isPlainObject(v)) return { ok: false, error: 'Expected an object' }
      return jsonSized(v) ? { ok: true, value: v } : { ok: false, error: 'The object is too large' }
    }
    case 'any':
    default: {
      const v = typeof raw === 'string' ? parseJson(raw) ?? raw : raw
      return jsonSized(v) ? { ok: true, value: v } : { ok: false, error: 'The value is too large' }
    }
  }
}

/* ── Source bindings: the query and the shaping of its rows ──────────── */

/** The row cap of a source binding for what it feeds. */
export function bindingRowLimit(binding: SourceBinding, expects: DynamicValueType): number {
  if (expects === 'object' || expects === 'string' || expects === 'number' || expects === 'boolean' || expects === 'date') return 1
  const cap = expects === 'options' || expects === 'string_list' ? DYNAMIC_LIMITS.options : DYNAMIC_LIMITS.rows
  return Math.min(cap, binding.limit ?? (expects === 'options' || expects === 'string_list' ? DYNAMIC_LIMITS.options : DYNAMIC_LIMITS.defaultRows))
}

/** The columns a source binding reads (its projection): value, label and the item columns. */
export function bindingColumns(binding: SourceBinding): string[] {
  const out: string[] = []
  for (const k of [binding.value, binding.label, ...(binding.columns ?? []).map((c) => c.key)]) if (k && !out.includes(k)) out.push(k)
  return out
}

/**
 * The binding as a read-only Data table config, so the Data table field's
 * query service (base filter, projection, reference call, anonymous and
 * open-access rules) runs it unchanged.
 */
export function bindingQueryConfig(binding: SourceBinding, types?: Record<string, DataTableColumnType>): DataTableFieldConfig {
  const columns = bindingColumns(binding).map((key) => ({ key, label: key, type: types?.[key] ?? 'text' as DataTableColumnType }))
  const out: DataTableFieldConfig = { source: binding.kind, mode: 'display', columns }
  if (binding.kind === 'table') {
    out.table_id = binding.table_id
    if (binding.open_access) out.open_access = true
  } else {
    out.reference_id = binding.reference_id
    if (binding.integration_id) out.integration_id = binding.integration_id
    if (binding.input_mappings) out.input_mappings = binding.input_mappings
    if (binding.results_path) out.results_path = binding.results_path
  }
  if (binding.base_filter) out.base_filter = binding.base_filter
  if (binding.sort) out.sort = binding.sort
  if (binding.anonymous_read) out.anonymous_read = true
  return out
}

/** Rows (projected records) → the property's value. */
export function shapeRows(binding: SourceBinding, rows: Array<Record<string, unknown>>, expects: DynamicValueType): Coerced {
  const valueKey = binding.value ?? binding.columns?.[0]?.key
  if (expects === 'options') {
    return { ok: true, value: toOptions(rows.map((r) => ({ value: valueKey ? r[valueKey] : undefined, label: binding.label ? r[binding.label] : undefined }))) ?? [] }
  }
  if (expects === 'string_list') return { ok: true, value: (toOptions(rows.map((r) => (valueKey ? r[valueKey] : undefined))) ?? []).map((o) => o.value) }
  const item = (r: Record<string, unknown>) => {
    const cols: DynamicColumn[] = binding.columns?.length ? binding.columns : [binding.value, binding.label].filter(Boolean).map((key) => ({ key: key! }))
    return Object.fromEntries(cols.map((c) => [c.as ?? c.key, r[c.key] ?? null]))
  }
  if (expects === 'list' || expects === 'any') return coerceDynamicValue('list', rows.map(item))
  if (expects === 'object') return rows.length ? coerceDynamicValue('object', item(rows[0])) : { ok: true, value: undefined }
  return coerceDynamicValue(expects, rows.length && valueKey ? rows[0][valueKey] : undefined)
}

/* ── Applying resolved values to a field ─────────────────────────────── */

/**
 * The field with resolved values in place of its static ones — the
 * applied bindings removed (so validation judges the resolved values, and
 * an unresolved binding stays visible as such). `undefined` (blank /
 * nothing found) keeps the static value except for options, which become
 * empty (a source that found no options offers none).
 */
export function applyDynamicValues<T extends FieldLike & { dynamic?: DynamicBindings; options?: string[]; option_labels?: Record<string, string> }>(
  field: T, resolved: Record<string, unknown>,
): T {
  const keys = Object.keys(resolved).filter((k) => field.dynamic?.[k])
  if (!keys.length) return field
  const out: T = { ...field }
  const dynamic = { ...(field.dynamic ?? {}) }
  for (const key of keys) {
    const value = resolved[key]
    delete dynamic[key]
    if (PROP_KEY_RE.test(key)) {
      const name = key.slice(6)
      const custom = { ...((out.custom ?? {}) as Record<string, unknown>) }
      const props = { ...((custom.props ?? {}) as Record<string, unknown>) }
      if (value !== undefined) props[name] = value
      custom.props = props
      ;(out as Record<string, unknown>).custom = custom
      continue
    }
    if (key === 'options') {
      const list = Array.isArray(value) ? value as DynamicOption[] : []
      out.options = list.map((o) => o.value)
      const labels = Object.fromEntries(list.filter((o) => o.label && o.label !== o.value).map((o) => [o.value, o.label]))
      if (Object.keys(labels).length) out.option_labels = labels
      else delete out.option_labels
      continue
    }
    if (value === undefined) continue
    if (key === 'default') {
      (out as Record<string, unknown>).default = Array.isArray(value) ? value.join(',') : String(value)
      continue
    }
    if (key === 'required') {
      if (value === true) (out as Record<string, unknown>).required = true
      else delete (out as Record<string, unknown>).required
      continue
    }
    (out as Record<string, unknown>)[key] = value
  }
  if (Object.keys(dynamic).length) out.dynamic = dynamic
  else delete out.dynamic
  return out
}

/** Whether a choice field's options come from a binding that has not been applied (validation can't judge membership yet). */
export function hasUnresolvedOptions(field: { dynamic?: DynamicBindings }): boolean {
  return Boolean(field.dynamic?.options)
}

/** Whether an options binding restricts submitted values to the resolved list (default yes). */
export function restrictsToList(binding: DynamicBinding | undefined): boolean {
  return !binding || binding.kind === 'expr' || binding.restrict !== false
}

/** Source bindings an anonymous visitor would not get (designer warnings; lib/forms/anonymous.ts). */
export function anonymousDynamicSources(fields: Array<FieldLike & { key: string; label?: string; dynamic?: DynamicBindings }>): Array<{ key: string; label: string; prop: string; allowed: boolean }> {
  const out: Array<{ key: string; label: string; prop: string; allowed: boolean }> = []
  for (const f of fields) {
    for (const [prop, b] of Object.entries(f.dynamic ?? {})) {
      if (isSourceBinding(b)) out.push({ key: f.key, label: f.label || f.key, prop, allowed: b.anonymous_read === true })
    }
  }
  return out
}

/** A short description of a binding (designer chips, read-outs). */
export function describeBinding(binding: DynamicBinding, names: { table?: string; reference?: string } = {}): string {
  if (binding.kind === 'expr') return binding.expr.length > 60 ? `${binding.expr.slice(0, 57)}…` : binding.expr
  const what = binding.kind === 'table' ? `table ${names.table ?? binding.table_id.slice(0, 8)}` : `API ${names.reference ?? binding.reference_id.slice(0, 8)}`
  const cols = bindingColumns(binding)
  const filtered = binding.base_filter ? ', filtered' : ''
  return `${what}${cols.length ? ` · ${cols.join(', ')}` : ''}${filtered}`
}
