/**
 * Field-change filters for record-change triggers (client-safe, pure).
 *
 * A trigger that reports a record's values before and after a change (a
 * SharePoint list item, a CRM record, a data-table row …) can offer the
 * designer's filter builder (manifest `contributes.triggers[].filters`) and
 * evaluate the saved filter with `evaluateFieldFilters` in its `matches()`:
 *
 *   { match: 'all', rules: [
 *       { field: 'Status', op: 'changed_to', value: 'Submitted' },   // when Status changes to Submitted
 *       { field: 'Amount', op: 'gt', value: 1000, changed: true },   // when Amount (> 1000) changes
 *   ] }
 *
 * Operators by field type (fieldFilterOperators):
 *   changed, changed_to, changed_from      the field changed (to / from a value)
 *   eq, ne, gt, gte, lt, lte               the value after the change (numbers, dates; eq / ne for all)
 *   contains, not_contains                 text contains / multi-value contains
 *   empty, not_empty
 * `changed: true` on a comparison also requires the field to have changed.
 *
 * Values are compared by type: numbers numerically, dates as instants (a
 * date-only value matches the whole day), booleans from true/false/yes/no/1/0,
 * text case-insensitively. Structured values (people, lookups, terms) match
 * when any of their parts match (`comparableParts` — or the trigger's own
 * `parts` function).
 */

export const FIELD_FILTER_TYPES = ['string', 'number', 'date', 'boolean', 'choice', 'multichoice', 'user', 'lookup'] as const
export type FieldFilterType = (typeof FIELD_FILTER_TYPES)[number]

export const FIELD_FILTER_OPERATORS = [
  'changed', 'changed_to', 'changed_from', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains', 'empty', 'not_empty',
] as const
export type FieldFilterOperator = (typeof FIELD_FILTER_OPERATORS)[number]

export const FIELD_FILTER_OPERATOR_LABELS: Record<FieldFilterOperator, string> = {
  changed: 'changes', changed_to: 'changes to', changed_from: 'changes from',
  eq: 'is', ne: 'is not', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most',
  contains: 'contains', not_contains: 'does not contain', empty: 'is empty', not_empty: 'is not empty',
}

/** A field the filter builder offers (from the trigger's `fieldsFrom` data source). */
export interface FieldFilterField {
  name: string
  label?: string
  type: FieldFilterType
  /** choice / multichoice: the values offered. */
  choices?: string[]
}

export interface FieldFilterRule {
  field: string
  op: FieldFilterOperator
  value?: unknown
  /** Comparisons: also require the field to have changed. */
  changed?: boolean
  /** The field's type when the rule was written (the builder saves it); used when `types` does not say. */
  type?: FieldFilterType
}

export interface FieldFilterGroup {
  match: 'all' | 'any'
  rules: FieldFilterRule[]
}

export interface FieldChange {
  before: Record<string, unknown> | null | undefined
  after: Record<string, unknown> | null | undefined
  /** Names of the fields that changed; derived from before / after when omitted. */
  changed?: string[] | null
}

const VALUE_OPS = new Set<FieldFilterOperator>(['changed_to', 'changed_from', 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'not_contains'])

/** Does this operator take a value? */
export function fieldFilterNeedsValue(op: FieldFilterOperator): boolean {
  return VALUE_OPS.has(op)
}

/** The operators offered for a field type. */
export function fieldFilterOperators(type: FieldFilterType | string): FieldFilterOperator[] {
  const change: FieldFilterOperator[] = ['changed', 'changed_to', 'changed_from']
  switch (type) {
    case 'number':
    case 'date':
      return [...change, 'eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'not_empty']
    case 'boolean':
      return [...change, 'eq', 'ne']
    case 'choice':
      return [...change, 'eq', 'ne', 'empty', 'not_empty']
    case 'multichoice':
    case 'user':
    case 'lookup':
      return [...change, 'contains', 'not_contains', 'empty', 'not_empty']
    default:
      return [...change, 'eq', 'ne', 'contains', 'not_contains', 'empty', 'not_empty']
  }
}

const MAX_RULES = 20

/** A saved filter (object or JSON text) → a clean group, or null when there is none. */
export function parseFieldFilters(raw: unknown): FieldFilterGroup | null {
  let value = raw
  if (typeof value === 'string') {
    if (!value.trim()) return null
    try { value = JSON.parse(value) } catch { return null }
  }
  if (Array.isArray(value)) value = { match: 'all', rules: value }
  if (!value || typeof value !== 'object') return null
  const v = value as { match?: unknown; rules?: unknown }
  const rules = (Array.isArray(v.rules) ? v.rules : [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object')
    .map((r): FieldFilterRule => ({
      field: String(r.field ?? '').slice(0, 200),
      op: (FIELD_FILTER_OPERATORS as readonly string[]).includes(String(r.op)) ? r.op as FieldFilterOperator : 'changed',
      ...(r.value !== undefined && r.value !== null && r.value !== '' ? { value: r.value } : {}),
      ...(r.changed === true || r.changed === 'true' ? { changed: true } : {}),
      ...((FIELD_FILTER_TYPES as readonly string[]).includes(String(r.type)) ? { type: r.type as FieldFilterType } : {}),
    }))
    .filter((r) => r.field)
    .slice(0, MAX_RULES)
  if (!rules.length) return null
  return { match: v.match === 'any' ? 'any' : 'all', rules }
}

/** The field names a filter uses (e.g. to record which fields a workflow depends on). */
export function fieldFilterFields(raw: unknown): string[] {
  return [...new Set((parseFieldFilters(raw)?.rules ?? []).map((r) => r.field))]
}

/* ── comparison ─────────────────────────────────────────────────────── */

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)
}

/**
 * The comparable parts of a value: arrays → their items' parts; objects →
 * their scalar members (e.g. a person { id, name, email, login }); scalars →
 * themselves.
 */
export function comparableParts(value: unknown): unknown[] {
  if (isEmpty(value)) return []
  if (Array.isArray(value)) return value.flatMap((v) => comparableParts(v))
  if (typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).filter((v) => v !== null && v !== undefined && v !== '' && typeof v !== 'object')
  }
  return [value]
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function asInstant(value: unknown): number | null {
  if (value instanceof Date) return value.getTime()
  if (typeof value !== 'string' || !value.trim()) return null
  const t = Date.parse(DATE_ONLY.test(value.trim()) ? `${value.trim()}T00:00:00Z` : value)
  return Number.isNaN(t) ? null : t
}

function asBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  const s = String(value ?? '').trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(s)) return true
  if (['false', 'no', 'n', '0'].includes(s)) return false
  return null
}

function text(value: unknown): string {
  return String(value ?? '').trim().toLowerCase()
}

type Parts = (value: unknown) => unknown[]

/** a == b for the field type (any part of a structured value). */
function equals(type: FieldFilterType | string, actual: unknown, expected: unknown, parts: Parts): boolean {
  if (isEmpty(expected)) return isEmpty(actual)
  if (type === 'number') {
    const e = asNumber(expected)
    return e !== null && parts(actual).some((p) => asNumber(p) === e)
  }
  if (type === 'date') {
    const e = asInstant(expected)
    if (e === null) return false
    const dayOnly = typeof expected === 'string' && DATE_ONLY.test(expected.trim())
    return parts(actual).some((p) => {
      const a = asInstant(p)
      if (a === null) return false
      return dayOnly ? a >= e && a < e + 86_400_000 : a === e
    })
  }
  if (type === 'boolean') {
    const e = asBoolean(expected)
    return e !== null && parts(actual).some((p) => asBoolean(p) === e)
  }
  const e = text(expected)
  return parts(actual).some((p) => text(p) === e)
}

function compare(type: FieldFilterType | string, actual: unknown, expected: unknown, parts: Parts): number | null {
  const pick = (v: unknown) => (type === 'date' ? asInstant(v) : asNumber(v))
  const e = pick(expected)
  const a = pick(parts(actual)[0])
  if (e === null || a === null) return null
  return a - e
}

function contains(actual: unknown, expected: unknown, parts: Parts): boolean {
  const e = text(expected)
  if (!e) return false
  if (typeof actual === 'string') return actual.toLowerCase().includes(e)
  return parts(actual).some((p) => text(p) === e || (typeof p === 'string' && p.toLowerCase().includes(e)))
}

function sameValue(type: FieldFilterType | string, a: unknown, b: unknown, parts: Parts): boolean {
  if (isEmpty(a) || isEmpty(b)) return isEmpty(a) && isEmpty(b)
  const pa = parts(a)
  const pb = parts(b)
  if (type === 'number') return pa.length === pb.length && pa.every((x, i) => asNumber(x) === asNumber(pb[i]))
  if (type === 'date') return pa.length === pb.length && pa.every((x, i) => asInstant(x) === asInstant(pb[i]))
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Did this field change (by the `changed` list when given, else by value)? */
function fieldChanged(field: string, change: FieldChange, type: FieldFilterType | string, parts: Parts): boolean {
  if (Array.isArray(change.changed)) return change.changed.some((f) => f.toLowerCase() === field.toLowerCase())
  return !sameValue(type, change.before?.[field], change.after?.[field], parts)
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/** A type from the values themselves (numbers, booleans, ISO dates; else text). */
function inferType(...values: unknown[]): FieldFilterType {
  const v = values.find((x) => !isEmpty(x))
  if (typeof v === 'number') return 'number'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'string' && ISO_DATE.test(v.trim())) return 'date'
  return 'string'
}

/**
 * One rule. The field type comes from `types` (field name → type), else the
 * rule's saved `type`, else the values (numbers, booleans, ISO dates, text).
 */
export function evaluateFieldFilterRule(rule: FieldFilterRule, change: FieldChange, options: { types?: Record<string, FieldFilterType | string>; parts?: Parts } = {}): boolean {
  const parts = options.parts ?? comparableParts
  const before = change.before?.[rule.field]
  const after = change.after?.[rule.field]
  const type = options.types?.[rule.field] ?? rule.type ?? inferType(after, before)
  const changed = fieldChanged(rule.field, change, type, parts)
  if (rule.changed && !changed) return false
  switch (rule.op) {
    case 'changed': return changed
    case 'changed_to': return changed && equals(type, after, rule.value, parts) && !equals(type, before, rule.value, parts)
    case 'changed_from': return changed && equals(type, before, rule.value, parts) && !equals(type, after, rule.value, parts)
    case 'eq': return equals(type, after, rule.value, parts)
    case 'ne': return !equals(type, after, rule.value, parts)
    case 'gt': { const c = compare(type, after, rule.value, parts); return c !== null && c > 0 }
    case 'gte': { const c = compare(type, after, rule.value, parts); return c !== null && c >= 0 }
    case 'lt': { const c = compare(type, after, rule.value, parts); return c !== null && c < 0 }
    case 'lte': { const c = compare(type, after, rule.value, parts); return c !== null && c <= 0 }
    case 'contains': return contains(after, rule.value, parts)
    case 'not_contains': return !contains(after, rule.value, parts)
    case 'empty': return isEmpty(after)
    case 'not_empty': return !isEmpty(after)
    default: return false
  }
}

/**
 * Does the change pass the filter? No filter (null / empty) passes. `types`
 * gives each field's type (FieldFilterField.type); `parts` overrides how a
 * structured value is split into comparable parts.
 */
export function evaluateFieldFilters(raw: unknown, change: FieldChange, options: { types?: Record<string, FieldFilterType | string>; parts?: Parts } = {}): boolean {
  const group = parseFieldFilters(raw)
  if (!group) return true
  const results = group.rules.map((rule) => evaluateFieldFilterRule(rule, change, options))
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

/** A readable sentence for a filter ("Status changes to Submitted and Amount is greater than 1000 (when it changes)"). */
export function describeFieldFilters(raw: unknown, labels: Record<string, string> = {}): string {
  const group = parseFieldFilters(raw)
  if (!group) return ''
  return group.rules.map((r) => {
    const value = fieldFilterNeedsValue(r.op) ? ` ${Array.isArray(r.value) ? r.value.join(', ') : String(r.value ?? '')}` : ''
    return `${labels[r.field] ?? r.field} ${FIELD_FILTER_OPERATOR_LABELS[r.op]}${value}${r.changed && r.op !== 'changed' ? ' (when it changes)' : ''}`
  }).join(group.match === 'any' ? ' or ' : ' and ')
}
