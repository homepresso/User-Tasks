/**
 * Repeating sections (field type `repeating_section`) — InfoPath's repeating
 * section: a group of ANY form controls (text, numbers, currency, dates,
 * dropdowns bound to a data table / API, people, rich text, attachments,
 * signatures, labels, nested Lists and nested repeating sections…) laid out
 * on their own grid and repeated once per item. "Add" appends an item; each
 * item is a card with Remove / Move up / Move down / Collapse.
 *
 *   {
 *     key: 'expenses', label: 'Expenses', type: 'repeating_section',
 *     repeating_section: {
 *       fields: [ { key: 'description', label: 'Description', type: 'text', required: true },
 *                 { key: 'category', label: 'Category', type: 'choice', options: [], dynamic: { options: { kind: 'table', … } } },
 *                 { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true },
 *                 { key: 'spent_on', label: 'Date', type: 'date', default: '{{today}}' } ],
 *       layout: { rows: [ { columns: 2, cells: [ { field_key: 'description', span: 2 } ] },
 *                         { columns: 3, cells: [ { field_key: 'category', span: 1 }, { field_key: 'amount', span: 1 }, { field_key: 'spent_on', span: 1 } ] } ],
 *                 sections?: [...], rules?: [...] },
 *       add_label: 'Add expense', item_title: 'Expense {{index}}: {{item.description}}',
 *       min_items: 1, max_items: 20, start_items: 1, totals: [ { field: 'amount', fn: 'sum' } ],
 *     },
 *   }
 *
 * The VALUE is the same shape as a List's: an array of item objects keyed
 * by the inner fields' keys ([{ description, category, amount, spent_on }, …]),
 * so `{{form.expenses}}`, a workflow Loop over it ({{item.amount}},
 * {{index}}), the data picker and the derived values work like a List's:
 * `<key>_count` and per total `<key>_total_<field>` / `<key>_avg_<field>` /
 * `<key>_count_<field>`.
 *
 * Inner fields are full TaskFieldDefs, normalised, validated and coerced by
 * the form's own engine (lib/task-field-schema.ts) once per item — every
 * field type's rules apply exactly as on the form. Errors carry the item's
 * path (`expenses[1].amount`, `trips[0].legs[2].from`) beside a summary on
 * the field (`expenses`).
 *
 * Rules inside an item: the inner layout's own `rules` (FormRule, the same
 * shape as the form's) run per item — Always rules (show / hide, required,
 * read only, set_style, field_error…) and event rules (value changes →
 * set values) — with `{{item.<key>}}` / `{{row.<key>}}` = this item,
 * `{{parent.<key>}}` = the item that holds it (nested sections) and
 * `{{form.<key>}}` = the form's fields. A bound dropdown inside an item reads
 * the same scope (a cascade on `{{item.country}}`).
 *
 * The form's own List rules (Add row to list, New row, Set row values,
 * Update / Delete a row, Clear list, Commit row, data / API outputs into
 * rows) accept a repeating section as their List: rules see it as a List
 * whose columns are the inner fields (repeatingListConfig).
 *
 * Inner keys are unique over the whole form (they never collide with a
 * top-level key or another section's key), so a key names one control.
 * Nesting: a repeating section may hold Lists and repeating sections down to
 * REPEATING_MAX_DEPTH levels (the top section is level 1).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { normalizeFormLayout, type FormLayout, type FormRow, type FormSection } from './layout'
import type { FormRule } from './form-rules'
import { listTotalValue, rawListRows, LIST_TOTAL_FNS, type ListColumn, type ListColumnType, type ListFieldConfig, type ListTotalFn } from './list-field'
import { CONTROLS_KEY, FORM_PARAMS_KEY, FORM_VARS_KEY } from './form-params'
import type { TaskFieldDef, TaskFieldType } from '@/lib/task-field-schema'

export const REPEATING_MAX_DEPTH = 3

export const REPEATING_LIMITS = {
  /** Inner fields per level. */
  fields: 60,
  /** The hard cap on items per section (max_items may only lower it). */
  items: 200,
  /** max_items when the author sets none. */
  defaultMaxItems: 50,
  /** Items over every level of one value (nested sections included). */
  totalItems: 2000,
  title: 200,
  addLabel: 80,
  totals: 10,
} as const

/**
 * Field types a repeating section cannot hold: they need a form-level
 * identity on the server — a Data table's queries and change sets, a custom
 * control's frame, a Signature's server-stamped signer / time.
 */
export const REPEATING_EXCLUDED_TYPES: ReadonlySet<TaskFieldType> = new Set<TaskFieldType>(['data_table', 'custom', 'signature'])

/** Keys an inner field may not use: the item scope's own names. */
export const ITEM_SCOPE_NAMES: ReadonlySet<string> = new Set(['item', 'row', 'parent', 'index', 'form'])

export interface RepeatingSectionTotal {
  /** A number / currency inner field (any value field for count). */
  field: string
  fn: ListTotalFn
  label?: string
}

/** The inner form's grid: rows of 1–4 columns (cells name inner field keys), sections, and the per-item rules. */
export interface RepeatingSectionLayout {
  rows: FormRow[]
  sections?: FormSection[]
  rules?: FormRule[]
}

export interface RepeatingSectionConfig {
  /** The controls of one item (any field type but data_table / custom / signature; nested list / repeating_section within the depth cap). */
  fields: TaskFieldDef[]
  /** Their grid (no pages); absent = one full-width row per field. */
  layout?: RepeatingSectionLayout
  /** The Add button's text (default "Add <singular label>"). */
  add_label?: string
  /** Each card's title: `{{index}}` (1-based) and `{{item.<key>}}` (default "<singular label> {{index}}"). */
  item_title?: string
  min_items?: number
  /** Default REPEATING_LIMITS.defaultMaxItems; at most REPEATING_LIMITS.items. */
  max_items?: number
  /** Items a new form starts with (blank items with the inner defaults). */
  start_items?: number
  /** Stored only when false (default true). */
  allow_remove?: boolean
  allow_reorder?: boolean
  collapsible?: boolean
  /** Ask before removing an item. */
  confirm_remove?: boolean
  totals?: RepeatingSectionTotal[]
  /**
   * The inner control that identifies an item (an order line's id): on
   * submit, an item whose key matches an item the form opened with keeps the
   * stored value of every control an item rule makes read only (Always rules)
   * — whatever the browser sent. Without one, items are matched by position
   * only when they cannot be reordered (allow_reorder false) and the count is
   * unchanged.
   */
  key_field?: string
}

type FieldsNormalizer = (raw: unknown) => TaskFieldDef[]

function int(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.floor(n) : undefined
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

/**
 * A clean config. `normalizeFields` is the form's own normaliser
 * (normalizeTaskFields — passed in, it calls back here for nested sections);
 * `depth` the section's level (1 = a top-level section). Beyond the depth
 * cap, nested Lists / repeating sections are dropped; data_table and custom
 * controls are never kept inside an item.
 */
export function normalizeRepeatingSectionConfig(raw: unknown, normalizeFields: FieldsNormalizer, depth = 1): RepeatingSectionConfig {
  const r = isPlainObject(raw) ? raw : {}
  const level = Number.isInteger(depth) && depth >= 1 ? depth : 1
  const fields = normalizeFields(r.fields)
    .filter((f) => !REPEATING_EXCLUDED_TYPES.has(f.type) && !ITEM_SCOPE_NAMES.has(f.key))
    .filter((f) => level < REPEATING_MAX_DEPTH || (f.type !== 'repeating_section' && f.type !== 'list'))
    .slice(0, REPEATING_LIMITS.fields)
  const config: RepeatingSectionConfig = { fields }
  const keys = fields.map((f) => f.key)
  if (isPlainObject(r.layout)) {
    const layout = normalizeInnerLayout(r.layout, keys)
    if (layout) config.layout = layout
  }
  const add = cleanText(r.add_label, REPEATING_LIMITS.addLabel)
  if (add) config.add_label = add
  const title = cleanText(r.item_title, REPEATING_LIMITS.title)
  if (title) config.item_title = title
  const max = int(r.max_items)
  if (max !== undefined && max >= 1) config.max_items = Math.min(REPEATING_LIMITS.items, max)
  const ceiling = config.max_items ?? REPEATING_LIMITS.defaultMaxItems
  const min = int(r.min_items)
  if (min !== undefined && min >= 1) config.min_items = Math.min(ceiling, min)
  const start = int(r.start_items)
  if (start !== undefined && start >= 1) config.start_items = Math.min(ceiling, start)
  if (r.allow_remove === false) config.allow_remove = false
  if (r.allow_reorder === false) config.allow_reorder = false
  if (r.collapsible === false) config.collapsible = false
  if (r.confirm_remove === true) config.confirm_remove = true
  const totals: RepeatingSectionTotal[] = []
  const byKey = new Map(fields.map((f) => [f.key, f]))
  for (const entry of Array.isArray(r.totals) ? r.totals : []) {
    if (!isPlainObject(entry) || totals.length >= REPEATING_LIMITS.totals) continue
    const field = typeof entry.field === 'string' ? entry.field : typeof entry.column === 'string' ? entry.column : ''
    const fn: ListTotalFn = (LIST_TOTAL_FNS as string[]).includes(entry.fn as string) ? entry.fn as ListTotalFn : 'sum'
    const inner = byKey.get(field)
    if (!inner || (fn !== 'count' && !isNumericField(inner)) || totals.some((t) => t.field === field && t.fn === fn)) continue
    const total: RepeatingSectionTotal = { field, fn }
    const label = cleanText(entry.label, 80)
    if (label) total.label = label
    totals.push(total)
  }
  if (totals.length) config.totals = totals
  if (typeof r.key_field === 'string' && byKey.has(r.key_field) && !['list', 'repeating_section'].includes(byKey.get(r.key_field)!.type)) config.key_field = r.key_field
  return config
}

function isNumericField(field: Pick<TaskFieldDef, 'type'>): boolean {
  return field.type === 'number' || field.type === 'currency' || field.type === 'rating' || field.type === 'slider' || field.type === 'nps' || field.type === 'csat'
}

/** The inner grid, cleaned against the inner keys: rows, sections and rules only (no pages, buttons bar, params…). */
export function normalizeInnerLayout(raw: unknown, innerKeys: string[]): RepeatingSectionLayout | undefined {
  if (!isPlainObject(raw)) return undefined
  // Pages are not a thing inside an item: their rows are flattened (normalizeFormLayout keeps single-mode rows).
  const flat = { rows: raw.rows, sections: raw.sections, rules: raw.rules, ...(Array.isArray(raw.pages) && !Array.isArray(raw.rows) ? { pages: raw.pages } : {}) }
  const layout = normalizeFormLayout(flat, innerKeys)
  if (!layout) return undefined
  const out: RepeatingSectionLayout = { rows: layout.mode && layout.mode !== 'single' ? (layout.pages ?? []).flatMap((p) => p.rows) : layout.rows }
  if (layout.sections?.length) out.sections = layout.sections
  if (layout.rules?.length) out.rules = layout.rules
  return out
}

/** The inner form's layout as the form renderer / validator take it (one full-width row per field when none is stored). */
export function innerFormLayout(config: RepeatingSectionConfig | undefined): FormLayout {
  const keys = (config?.fields ?? []).map((f) => f.key)
  const stored = config?.layout
  if (!stored) return { rows: keys.map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] })) }
  // Fields the stored grid misses still show (a row of their own at the end).
  const placed = new Set(stored.rows.flatMap((r) => r.cells.map((c) => c.field_key)))
  const rows = [...stored.rows, ...keys.filter((k) => !placed.has(k)).map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] }))]
  return { rows, ...(stored.sections ? { sections: stored.sections } : {}), ...(stored.rules ? { rules: stored.rules } : {}) }
}

/** The section's level-by-level depth (1 = no nested section / List inside). */
export function repeatingDepth(config: RepeatingSectionConfig | undefined): number {
  let deepest = 0
  for (const f of config?.fields ?? []) {
    if (f.type === 'repeating_section') deepest = Math.max(deepest, repeatingDepth(f.repeating_section))
    if (f.type === 'list') deepest = Math.max(deepest, 1)
  }
  return 1 + deepest
}

/** Every field inside a section, nested sections' included (depth-first), each with the section keys above it. */
export function innerFieldsDeep(fields: TaskFieldDef[], trail: string[] = []): Array<{ field: TaskFieldDef; sections: string[] }> {
  const out: Array<{ field: TaskFieldDef; sections: string[] }> = []
  for (const f of fields) {
    if (f.type !== 'repeating_section') continue
    for (const inner of f.repeating_section?.fields ?? []) {
      out.push({ field: inner, sections: [...trail, f.key] })
      if (inner.type === 'repeating_section') out.push(...innerFieldsDeep([inner], [...trail, f.key]))
    }
  }
  return out
}

/** A field by key anywhere in the form (top level first, then inside repeating sections), with its sections path. */
export function findFieldDeep(fields: TaskFieldDef[], key: string): { field: TaskFieldDef; sections: string[] } | null {
  const top = fields.find((f) => f.key === key)
  if (top) return { field: top, sections: [] }
  return innerFieldsDeep(fields).find((x) => x.field.key === key) ?? null
}

/** The repeating section a key lives in (the closest one), or null for a top-level key. */
export function sectionOfField(fields: TaskFieldDef[], key: string): TaskFieldDef | null {
  const found = findFieldDeep(fields, key)
  if (!found || !found.sections.length) return null
  const path = found.sections
  let level: TaskFieldDef[] = fields
  let section: TaskFieldDef | null = null
  for (const k of path) {
    section = level.find((f) => f.key === k) ?? null
    level = section?.repeating_section?.fields ?? []
  }
  return section
}

/** Problems with a section's config the designer flags (null = fine). `topKeys`: the other keys of the form. */
export function repeatingConfigProblem(config: RepeatingSectionConfig | undefined, topKeys: Iterable<string> = []): string | null {
  if (!config || !config.fields.length) return 'Add at least one control to the repeating section'
  const values = config.fields.filter((f) => !['heading', 'divider', 'button', 'display_image'].includes(f.type))
  if (!values.length) return 'Add at least one control that holds a value'
  if (config.min_items !== undefined && config.max_items !== undefined && config.min_items > config.max_items) return 'Minimum items is greater than maximum items'
  if (repeatingDepth(config) > REPEATING_MAX_DEPTH) return `Repeating sections and Lists nest at most ${REPEATING_MAX_DEPTH} levels deep`
  const taken = new Set(topKeys)
  for (const { field } of innerFieldsDeep([{ key: '_', label: '_', type: 'repeating_section', repeating_section: config } as TaskFieldDef])) {
    if (taken.has(field.key)) return `The inner control key "${field.key}" is used elsewhere on the form (keys must be unique)`
    taken.add(field.key)
  }
  return null
}

/* ── Items ──────────────────────────────────────────────────────────── */

/** The items of a value (an array of objects, or JSON text of one). */
export function repeatingItems(value: unknown): Record<string, unknown>[] {
  return rawListRows(value)
}

export function maxItems(config: RepeatingSectionConfig | undefined): number {
  return Math.min(REPEATING_LIMITS.items, config?.max_items ?? REPEATING_LIMITS.defaultMaxItems)
}

export function minItems(config: RepeatingSectionConfig | undefined, required = false): number {
  return Math.max(config?.min_items ?? 0, required ? 1 : 0)
}

export function canAddItem(config: RepeatingSectionConfig | undefined, count: number): boolean {
  return count < maxItems(config)
}

export function canRemoveItem(config: RepeatingSectionConfig | undefined, count: number, required = false): boolean {
  return config?.allow_remove !== false && count > minItems(config, required)
}

/**
 * A new item: each value field's default (templates like `{{today}}`
 * resolved by `resolve` — the form's own resolver), booleans false, lists /
 * nested sections empty (a nested section's start_items blank items).
 */
export function newItem(config: RepeatingSectionConfig | undefined, resolve: (text: string) => unknown = (t) => t): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of config?.fields ?? []) {
    if (['heading', 'divider', 'button', 'display_image'].includes(f.type)) continue
    if (f.type === 'label' && !f.label_config?.include) continue
    if (f.type === 'repeating_section') { out[f.key] = startItems(f.repeating_section, resolve); continue }
    if (f.type === 'list') { out[f.key] = []; continue }
    if (f.default !== undefined) {
      // {{today}} / {{now}} are known wherever an item is made (a form page leaves other placeholders to `resolve`).
      const now = new Date()
      const dated = f.default.replace(/\{\{\s*today\s*\}\}/g, isoDay(now)).replace(/\{\{\s*now\s*\}\}/g, now.toISOString())
      out[f.key] = dated.includes('{{') ? resolve(dated) : dated
      continue
    }
    out[f.key] = f.type === 'boolean' ? false
      : f.type === 'multi_choice' || f.type === 'attachments' || f.type === 'text_list' || (f.type === 'lookup' && f.lookup?.multiple) ? []
      : null
  }
  return out
}

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The items a new form starts with (start_items, at least min_items). */
export function startItems(config: RepeatingSectionConfig | undefined, resolve?: (text: string) => unknown): Record<string, unknown>[] {
  const n = Math.min(maxItems(config), Math.max(config?.start_items ?? 0, config?.min_items ?? 0))
  return Array.from({ length: n }, () => newItem(config, resolve))
}

export function addItem(config: RepeatingSectionConfig | undefined, items: Record<string, unknown>[], item: Record<string, unknown>, at?: number): Record<string, unknown>[] {
  if (!canAddItem(config, items.length)) return items
  const next = [...items]
  next.splice(at === undefined ? next.length : Math.max(0, Math.min(at, next.length)), 0, item)
  return next
}

export function removeItem(config: RepeatingSectionConfig | undefined, items: Record<string, unknown>[], index: number, required = false): Record<string, unknown>[] {
  if (index < 0 || index >= items.length || !canRemoveItem(config, items.length, required)) return items
  return items.filter((_, i) => i !== index)
}

/** Move an item by `delta` places (clamped); unchanged when reordering is off. */
export function moveItem(config: RepeatingSectionConfig | undefined, items: Record<string, unknown>[], index: number, delta: number): Record<string, unknown>[] {
  if (config?.allow_reorder === false) return items
  const to = Math.max(0, Math.min(items.length - 1, index + delta))
  if (index < 0 || index >= items.length || to === index) return items
  const next = [...items]
  const [moved] = next.splice(index, 1)
  next.splice(to, 0, moved)
  return next
}

/** "Expenses" → "Expense" (the Add button, card titles, counts). */
export function singularLabel(label: string): string {
  const words = String(label ?? '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return 'Item'
  const last = words.pop()!
  const one = /ies$/i.test(last) ? last.replace(/ies$/i, 'y') : /(ss|us|is)$/i.test(last) ? last : /(sses|ches|shes|xes)$/i.test(last) ? last.replace(/es$/i, '') : last.replace(/s$/i, '')
  return [...words, one].join(' ')
}

export function addItemLabel(field: Pick<TaskFieldDef, 'label' | 'repeating_section'>): string {
  return field.repeating_section?.add_label || `Add ${singularLabel(field.label).toLowerCase()}`
}

/** A card's title: the item_title template ({{index}}, {{item.<key>}}), else "<Singular> <n>". */
export function itemTitle(field: Pick<TaskFieldDef, 'label' | 'repeating_section'>, item: Record<string, unknown>, index: number): string {
  const template = field.repeating_section?.item_title
  if (!template) return `${singularLabel(field.label)} ${index + 1}`
  const text = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    if (path === 'index') return String(index + 1)
    const key = path.replace(/^(item|row)\./, '')
    const v = item[key]
    if (v === null || v === undefined) return ''
    if (typeof v === 'object') return ''
    return String(v)
  }).replace(/\s*[:·–-]\s*$/, '').trim()
  return text.slice(0, REPEATING_LIMITS.title) || `${singularLabel(field.label)} ${index + 1}`
}

/** "3 expenses" — the one-line summary (tables, reports, the timeline). */
export function describeRepeatingValue(value: unknown, field?: Pick<TaskFieldDef, 'label'>): string {
  const n = repeatingItems(value).length
  if (!n) return '—'
  const plural = (field?.label ?? '').trim().toLowerCase() || 'items'
  return `${n} ${n === 1 ? singularLabel(plural) : plural}`
}

/* ── Rule scope ──────────────────────────────────────────────────────── */

/**
 * The values an item's controls, rules and bindings read: the form's
 * values (its reserved runtime keys left out, but parameters, variables and
 * control state kept), then the item's own over them, and `item` / `row`
 * (this item) and `parent` (the item holding this section, nested).
 */
export function itemScopeValues(form: Record<string, unknown> | null | undefined, item: Record<string, unknown>, parent?: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(form ?? {})) {
    if (k.startsWith('__') && k !== FORM_PARAMS_KEY && k !== FORM_VARS_KEY && k !== CONTROLS_KEY) continue
    if (k === 'item' || k === 'row' || k === 'parent') continue
    out[k] = v
  }
  Object.assign(out, item)
  out.item = item
  out.row = item
  if (parent) out.parent = parent
  else delete out.parent
  return out
}

/** The item's own entries in a scope written back (scope keys, form keys dropped). */
export function isItemKey(config: RepeatingSectionConfig | undefined, key: string): boolean {
  if (key.startsWith('__')) return true
  return (config?.fields ?? []).some((f) => key === f.key || key.startsWith(`${f.key}_`))
}

/* ── Derived values ─────────────────────────────────────────────────── */

export function repeatingCountKey(fieldKey: string): string {
  return `${fieldKey}_count`
}

export function repeatingTotalKey(fieldKey: string, total: Pick<RepeatingSectionTotal, 'field' | 'fn'>): string {
  return `${fieldKey}_${total.fn === 'sum' ? 'total' : total.fn}_${total.field}`
}

/** Keys the section adds beside its items: `<key>_count` and one per total. */
export function repeatingDerivedKeys(fieldKey: string, config: RepeatingSectionConfig | undefined): string[] {
  return [repeatingCountKey(fieldKey), ...(config?.totals ?? []).map((t) => repeatingTotalKey(fieldKey, t))]
}

/** `<key>_count` and the totals, from the (checked) items. */
export function repeatingDerivedValues(fieldKey: string, config: RepeatingSectionConfig | undefined, value: unknown): Record<string, number | null> {
  const items = repeatingItems(value)
  const out: Record<string, number | null> = { [repeatingCountKey(fieldKey)]: items.length }
  for (const total of config?.totals ?? []) {
    out[repeatingTotalKey(fieldKey, total)] = listTotalValue({ column: total.field, fn: total.fn }, items as never)
  }
  return out
}

/* ── As a List (for the form's List rules) ───────────────────────────── */

const COLUMN_TYPE: Partial<Record<TaskFieldType, ListColumnType>> = {
  text: 'text', textarea: 'textarea', email: 'email', number: 'number', currency: 'currency', date: 'date', boolean: 'boolean', choice: 'choice',
}

/**
 * The section seen as a List (columns = its value fields): the List rules
 * (Add row to list, New row, Set row values, Update / Delete a row, Clear,
 * Commit) and data / API outputs work on it unchanged. Simple types map to
 * their List column; every other control is a pass-through `field` column
 * (its value kept as it is — the form's engine checks it on submit); a
 * nested section becomes a nested List.
 */
export function repeatingListConfig(config: RepeatingSectionConfig | undefined): ListFieldConfig {
  const columns: ListColumn[] = []
  for (const f of config?.fields ?? []) {
    if (['heading', 'divider', 'button', 'display_image'].includes(f.type)) continue
    if (f.type === 'label' && !f.label_config?.include) continue
    const type: ListColumnType = f.type === 'repeating_section' ? 'list' : f.type === 'list' ? 'list' : COLUMN_TYPE[f.type] ?? 'field'
    const column: ListColumn = { key: f.key, label: f.label, type }
    if (f.required && type !== 'boolean') column.required = true
    if (f.read_only) column.read_only = true
    if (f.default !== undefined && !f.default.includes('{{') && type !== 'list') column.default = f.default
    if (f.options && type === 'choice') { column.options = f.options; if (f.option_labels) column.option_labels = f.option_labels }
    if (type === 'currency') column.currency = f.currency ?? 'USD'
    if ((type === 'number' || type === 'currency') && f.min !== undefined) column.min = f.min
    if ((type === 'number' || type === 'currency') && f.max !== undefined) column.max = f.max
    if (f.type === 'repeating_section') column.list = repeatingListConfig(f.repeating_section)
    if (f.type === 'list' && f.list) column.list = f.list
    columns.push(column)
  }
  const out: ListFieldConfig = { columns, entry_mode: 'inline' }
  if (config?.min_items) out.min_rows = config.min_items
  out.max_rows = maxItems(config)
  if (config?.totals?.length) out.totals = config.totals.map((t) => ({ column: t.field, fn: t.fn, ...(t.label ? { label: t.label } : {}) }))
  return out
}

/** A repeating section as the List rules see it (other fields unchanged). */
export function asListField<T extends Pick<TaskFieldDef, 'type' | 'repeating_section'>>(field: T): T {
  if (field.type !== 'repeating_section') return field
  return { ...field, type: 'list', list: repeatingListConfig(field.repeating_section) }
}

/**
 * A List / repeating section field as it shows while form rules hide some
 * of its columns (`column:<field>.<column>` — ruleHiddenColumns): a List's
 * hidden columns are marked `hidden` (no header, no cells, left out of the
 * row pop-out; the values stay in the rows), a repeating section's hidden
 * controls are left out of every item's grid (their values kept). The field
 * itself when nothing is hidden.
 */
export function withHiddenColumns<T extends Pick<TaskFieldDef, 'type' | 'list' | 'repeating_section'>>(field: T, hidden: ReadonlySet<string> | undefined | null): T {
  if (!hidden?.size) return field
  if (field.type === 'list' && field.list) {
    if (!field.list.columns.some((c) => hidden.has(c.key) && !c.hidden)) return field
    return { ...field, list: { ...field.list, columns: field.list.columns.map((c) => (hidden.has(c.key) ? { ...c, hidden: true } : c)) } }
  }
  if (field.type === 'repeating_section' && field.repeating_section) {
    const config = field.repeating_section
    const layout = innerFormLayout(config)
    const rows = layout.rows.map((r) => ({ ...r, cells: r.cells.filter((c) => !hidden.has(c.field_key)) })).filter((r) => r.cells.length > 0 || r.section !== undefined)
    return { ...field, repeating_section: { ...config, layout: { ...(config.layout ?? {}), rows } } }
  }
  return field
}
