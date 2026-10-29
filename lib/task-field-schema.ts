import { taskDataFieldSlug } from '@/lib/task-data'
import { isPlainObject } from '@/lib/utils/guards'
import { compileUserRegex, MAX_REGEX_PATTERN_LENGTH } from '@/lib/safe-regex'
import { LOOKUP_LIMITS, lookupConfigProblem, lookupItemKey, lookupValues, normalizeLookupConfig, type LookupConfig } from '@/lib/forms/lookup'
import {
  attachmentsConfigProblem, attachmentsCountKey, attachmentsValueError, attachmentUploadsInFlight, normalizeAttachmentsConfig, normalizeAttachmentValue,
  type AttachmentFile, type AttachmentsConfig,
} from '@/lib/forms/attachments'

/**
 * User Task `fields` — the inputs a User Task node (or a reusable Form) asks
 * the assignee to fill in. Values live in task `metadata.template_values`
 * (surfaced as `task.data.<key>`) and are handed to the resumed workflow as
 * `task_data.<key>`. Isomorphic: used by the engine, server actions, API
 * routes, MCP tools, the form designer and the task screen.
 *
 * Backward compatible: the original five types (text, number, date,
 * boolean, choice) and their stored shape are unchanged; every newer
 * property is optional and only emitted when set. Layout (the grid) lives
 * beside the field list — see lib/forms/layout.ts.
 */

export type TaskFieldType =
  | 'text' | 'textarea' | 'number' | 'currency' | 'email' | 'phone' | 'url'
  | 'date' | 'datetime' | 'boolean' | 'choice' | 'multi_choice' | 'user'
  | 'lookup' | 'attachments' | 'heading' | 'divider'

export const TASK_FIELD_TYPES: TaskFieldType[] = [
  'text', 'textarea', 'number', 'currency', 'email', 'phone', 'url',
  'date', 'datetime', 'boolean', 'choice', 'multi_choice', 'user',
  'lookup', 'attachments', 'heading', 'divider',
]

/** Display-only elements: placed on the grid, never hold a value. */
export const DISPLAY_FIELD_TYPES: ReadonlySet<TaskFieldType> = new Set(['heading', 'divider'])

export const TASK_FIELD_TYPE_LABELS: Record<TaskFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  currency: 'Currency',
  email: 'Email',
  phone: 'Phone',
  url: 'URL',
  date: 'Date',
  datetime: 'Date & time',
  boolean: 'Checkbox (yes/no)',
  choice: 'Single select',
  multi_choice: 'Multi-select',
  user: 'Person',
  lookup: 'Autocomplete / lookup',
  attachments: 'Attachments',
  heading: 'Section heading',
  divider: 'Divider',
}

/**
 * Keys a field may not use: prototype names (values are merged into plain
 * objects) and names the resume payload / task object already own.
 */
export const RESERVED_FIELD_KEYS: ReadonlySet<string> = new Set([
  '__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof',
  'outcome', 'outcome_notes', 'outcome_counts', 'actioned_by', 'actioned_by_name',
  'actioned_on_behalf_of', 'actioned_on_behalf_of_name', 'on_behalf_note',
  'response_count', 'user_task_id', 'task', 'task_id', 'task_data', 'id', 'tenant_id',
])

export type VisibleWhenOperator = 'equals' | 'not_equals' | 'is_set' | 'is_not_set' | 'contains'
export const VISIBLE_WHEN_OPERATORS: VisibleWhenOperator[] = ['equals', 'not_equals', 'is_set', 'is_not_set', 'contains']

export interface VisibleWhen {
  field: string
  operator: VisibleWhenOperator
  value?: string
}

export interface OptionsSource {
  /** Data table id (custom_tables). */
  table_id: string
  /** Column whose distinct values become the options. */
  column: string
}

export interface TaskFieldDef {
  key: string
  label: string
  type: TaskFieldType
  required?: boolean
  /** Option values (choice / multi_choice). */
  options?: string[]
  /** Display label per option value, when it differs from the value. */
  option_labels?: Record<string, string>
  /** Options read from a data table column when the task is created. */
  options_source?: OptionsSource
  /** choice only: dropdown (default) or radio buttons. */
  display?: 'dropdown' | 'radio'
  placeholder?: string
  default?: string
  help_text?: string
  read_only?: boolean
  /** number / currency: value bounds; multi_choice: selection count bounds. */
  min?: number
  max?: number
  /** Text-like: length bounds. */
  min_length?: number
  max_length?: number
  /** Text-like: a pattern the value must match (safe-regex checked). */
  pattern?: string
  pattern_message?: string
  /** date / datetime bounds (YYYY-MM-DD or ISO). */
  min_date?: string
  max_date?: string
  /** currency: ISO 4217 code (default USD). */
  currency?: string
  visible_when?: VisibleWhen
  /** lookup only: where suggestions come from and what is stored (lib/forms/lookup.ts). */
  lookup?: LookupConfig
  /** attachments only: counts, sizes and allowed types (lib/forms/attachments.ts). */
  attachments?: AttachmentsConfig
}

export type TaskFieldValue = string | number | boolean | string[] | AttachmentFile[] | null

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/
const DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+?[0-9 ()./-]{5,30}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CURRENCY_RE = /^[A-Z]{3}$/
const MAX_OPTIONS = 500
const MAX_TEXT = 50_000

function isTaskFieldType(value: unknown): value is TaskFieldType {
  return typeof value === 'string' && (TASK_FIELD_TYPES as string[]).includes(value)
}

export function isDisplayField(field: Pick<TaskFieldDef, 'type'>): boolean {
  return DISPLAY_FIELD_TYPES.has(field.type)
}

/** Fields that hold a value (headings and dividers excluded). */
export function valueFields(fields: TaskFieldDef[]): TaskFieldDef[] {
  return fields.filter((field) => !isDisplayField(field))
}

const TEXT_LIKE: ReadonlySet<TaskFieldType> = new Set(['text', 'textarea', 'email', 'phone', 'url'])
const NUMERIC: ReadonlySet<TaskFieldType> = new Set(['number', 'currency'])
const CHOICE_TYPES: ReadonlySet<TaskFieldType> = new Set(['choice', 'multi_choice'])

/** snake_case key from a label (the designer's auto key). */
export function fieldKeyFromLabel(label: string): string {
  return taskDataFieldSlug(String(label ?? '')).slice(0, 64)
}

/**
 * Problem with a key (null = fine): empty, not snake_case, reserved, or
 * already used by another field (`others` = the other fields' keys).
 */
export function fieldKeyProblem(key: string, others: Iterable<string> = []): string | null {
  const k = String(key ?? '')
  if (!k) return 'Key is required'
  if (k.length > 64) return 'Key must be 64 characters or fewer'
  if (!/^[a-z0-9][a-z0-9_]*$/.test(k)) return 'Use lowercase letters, digits and underscores'
  if (RESERVED_FIELD_KEYS.has(k)) return `"${k}" is reserved`
  for (const other of others) if (other === k) return `Key "${k}" is used by another field`
  return null
}

/** `base`, or `base_2`, `base_3`… — the first not in `taken` and not reserved. */
export function uniqueFieldKey(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let root = fieldKeyFromLabel(base) || 'field'
  if (!/^[a-z0-9]/.test(root)) root = `field_${root}`
  if (RESERVED_FIELD_KEYS.has(root)) root = `${root}_field`
  if (!used.has(root)) return root
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${root}_${i}`
    if (!used.has(candidate)) return candidate
  }
  return `${root}_${Date.now()}`
}

function finite(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : undefined
}

function nonNegInt(value: unknown): number | undefined {
  const n = finite(value)
  return n === undefined || n < 0 ? undefined : Math.floor(n)
}

function cleanString(value: unknown, max = 500): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

function normalizeOptions(raw: unknown): { options: string[]; labels: Record<string, string> } {
  const options: string[] = []
  const labels: Record<string, string> = {}
  if (!Array.isArray(raw)) return { options, labels }
  for (const entry of raw) {
    let value: string
    let label: string | undefined
    if (isPlainObject(entry)) {
      value = String(entry.value ?? entry.label ?? '').trim()
      label = typeof entry.label === 'string' ? entry.label.trim() : undefined
    } else {
      value = String(entry ?? '').trim()
    }
    if (!value || options.includes(value) || options.length >= MAX_OPTIONS) continue
    options.push(value)
    if (label && label !== value) labels[value] = label.slice(0, 200)
  }
  return { options, labels }
}

function normalizeVisibleWhen(raw: unknown): VisibleWhen | undefined {
  if (!isPlainObject(raw)) return undefined
  const field = typeof raw.field === 'string' ? taskDataFieldSlug(raw.field) : ''
  const operator = VISIBLE_WHEN_OPERATORS.includes(raw.operator as VisibleWhenOperator) ? raw.operator as VisibleWhenOperator : 'equals'
  if (!field) return undefined
  const out: VisibleWhen = { field, operator }
  if (operator !== 'is_set' && operator !== 'is_not_set') out.value = raw.value === undefined || raw.value === null ? '' : String(raw.value).slice(0, 500)
  return out
}

/**
 * Normalize raw node config into a clean field list: the key falls back to a
 * slug of the label, duplicate / reserved keys and entries without a usable
 * key/label are dropped, unknown types become `text`, and choice options are
 * trimmed/deduped. Properties that do not apply to a type are dropped.
 */
export function normalizeTaskFields(raw: unknown): TaskFieldDef[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: TaskFieldDef[] = []
  for (const entry of raw) {
    if (!isPlainObject(entry)) continue
    const label = typeof entry.label === 'string' ? entry.label.trim() : ''
    const rawKey = typeof entry.key === 'string' ? entry.key.trim() : ''
    const type: TaskFieldType = isTaskFieldType(entry.type) ? entry.type : 'text'
    const key = taskDataFieldSlug(rawKey || label).slice(0, 64)
    if (!key || seen.has(key) || RESERVED_FIELD_KEYS.has(key)) continue
    seen.add(key)
    const field: TaskFieldDef = { key, label: label || key, type }
    if (isDisplayField(field)) {
      if (type === 'heading') {
        const help = cleanString(entry.help_text, 2000)
        if (help) field.help_text = help
      }
      out.push(field)
      continue
    }
    if (entry.required === true) field.required = true
    if (CHOICE_TYPES.has(type)) {
      const { options, labels } = normalizeOptions(entry.options)
      field.options = options
      if (Object.keys(labels).length) field.option_labels = labels
      if (isPlainObject(entry.options_source) && typeof entry.options_source.table_id === 'string' && typeof entry.options_source.column === 'string'
        && entry.options_source.table_id && entry.options_source.column) {
        field.options_source = { table_id: entry.options_source.table_id, column: String(entry.options_source.column).slice(0, 120) }
      }
      if (type === 'choice' && entry.display === 'radio') field.display = 'radio'
    }
    if (type === 'lookup') field.lookup = normalizeLookupConfig(entry.lookup)
    if (type === 'attachments') {
      const config = normalizeAttachmentsConfig(entry.attachments)
      if (Object.keys(config).length) field.attachments = config
    }
    if (typeof entry.placeholder === 'string' && entry.placeholder.trim()) {
      field.placeholder = entry.placeholder
    }
    if (type !== 'attachments' && entry.default !== undefined && entry.default !== null && String(entry.default) !== '') {
      field.default = Array.isArray(entry.default) ? entry.default.map(String).join(',') : String(entry.default)
    }
    const help = cleanString(entry.help_text, 2000)
    if (help) field.help_text = help
    if (entry.read_only === true) field.read_only = true
    if (NUMERIC.has(type) || type === 'multi_choice') {
      const min = finite(entry.min)
      const max = finite(entry.max)
      if (min !== undefined) field.min = min
      if (max !== undefined) field.max = max
    }
    if (TEXT_LIKE.has(type)) {
      const minLength = nonNegInt(entry.min_length)
      const maxLength = nonNegInt(entry.max_length)
      if (minLength !== undefined) field.min_length = minLength
      if (maxLength !== undefined) field.max_length = maxLength
      const pattern = typeof entry.pattern === 'string' ? entry.pattern.trim() : ''
      if (pattern && pattern.length <= MAX_REGEX_PATTERN_LENGTH) {
        field.pattern = pattern
        const message = cleanString(entry.pattern_message, 200)
        if (message) field.pattern_message = message
      }
    }
    if (type === 'date' || type === 'datetime') {
      const minDate = cleanString(entry.min_date, 40)
      const maxDate = cleanString(entry.max_date, 40)
      if (minDate && DATE_RE.test(minDate)) field.min_date = minDate
      if (maxDate && DATE_RE.test(maxDate)) field.max_date = maxDate
    }
    if (type === 'currency') {
      const code = typeof entry.currency === 'string' ? entry.currency.trim().toUpperCase() : ''
      if (CURRENCY_RE.test(code)) field.currency = code
    }
    const visible = normalizeVisibleWhen(entry.visible_when)
    if (visible && visible.field !== key) field.visible_when = visible
    out.push(field)
  }
  return out
}

/** Problems with a field definition the designer should flag (key → message). */
export function fieldDefinitionProblems(fields: TaskFieldDef[]): Record<string, string> {
  const problems: Record<string, string> = {}
  const keys = new Set(fields.map((f) => f.key))
  const valueKeys = valueFields(fields).map((f) => f.key)
  for (const field of fields) {
    const lookupProblem = field.type === 'lookup' ? lookupConfigProblem(field.lookup, field.key, valueKeys.filter((k) => k !== field.key)) : null
    if (lookupProblem) {
      problems[field.key] = lookupProblem
    } else if (field.type === 'lookup' && keys.has(lookupItemKey(field.key))) {
      problems[field.key] = `Another field uses the key "${lookupItemKey(field.key)}" (this lookup stores its selected item there)`
    } else if (field.type === 'attachments' && (attachmentsConfigProblem(field.attachments) || keys.has(attachmentsCountKey(field.key)))) {
      problems[field.key] = attachmentsConfigProblem(field.attachments) ?? `Another field uses the key "${attachmentsCountKey(field.key)}" (this field stores its file count there)`
    } else if (CHOICE_TYPES.has(field.type) && !(field.options ?? []).length && !field.options_source) {
      problems[field.key] = 'Add at least one option'
    } else if (field.pattern) {
      try { compileUserRegex(field.pattern) } catch (err) { problems[field.key] = err instanceof Error ? err.message : 'Invalid pattern' }
    } else if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      problems[field.key] = 'Minimum is greater than maximum'
    } else if (field.min_length !== undefined && field.max_length !== undefined && field.min_length > field.max_length) {
      problems[field.key] = 'Minimum length is greater than maximum length'
    } else if (field.visible_when && !keys.has(field.visible_when.field)) {
      problems[field.key] = `"Visible when" refers to an unknown field "${field.visible_when.field}"`
    }
  }
  return problems
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const s = String(value ?? '').trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'off', ''].includes(s)) return false
  return null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const s = String(value ?? '').trim().replace(/,/g, '')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Multi-select value → array of strings (array, JSON array text or comma list). */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean)
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return []
    if (s.startsWith('[')) {
      try {
        const parsed = JSON.parse(s)
        if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean)
      } catch { /* comma list */ }
    }
    return s.split(',').map((v) => v.trim()).filter(Boolean)
  }
  if (value === undefined || value === null) return []
  return [String(value)]
}

function validDate(s: string): boolean {
  return DATE_RE.test(s) && !Number.isNaN(new Date(s).getTime())
}

function dateKey(s: string): number {
  const m = DATE_ONLY_RE.exec(s)
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(s).getTime()
}

function isSet(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return !isBlank(value)
}

/** Whether `visible_when` shows the field for these values (no condition → visible). */
export function isFieldVisible(field: TaskFieldDef, values: Record<string, unknown> | null | undefined): boolean {
  const cond = field.visible_when
  if (!cond) return true
  const other = (values ?? {})[cond.field]
  const target = String(cond.value ?? '').trim().toLowerCase()
  const asText = (v: unknown) => (typeof v === 'boolean' ? String(v) : String(v ?? '').trim().toLowerCase())
  switch (cond.operator) {
    case 'is_set': return isSet(other)
    case 'is_not_set': return !isSet(other)
    case 'contains':
      return Array.isArray(other) ? other.some((v) => asText(v) === target) : asText(other).includes(target)
    case 'not_equals':
      return Array.isArray(other) ? !other.some((v) => asText(v) === target) : asText(other) !== target
    case 'equals':
    default:
      if (typeof other === 'boolean' || ['true', 'false'].includes(target)) return toBoolean(other) === toBoolean(target)
      return Array.isArray(other) ? other.some((v) => asText(v) === target) : asText(other) === target
  }
}

/** Display text for an option value. */
export function optionLabel(field: TaskFieldDef, value: string): string {
  return field.option_labels?.[value] ?? value
}

/**
 * Validate submitted values against the field list. Returns a map of
 * field key → error message; empty when everything is valid. Keys not in the
 * field list are ignored, as are display elements, read-only fields and
 * fields hidden by `visible_when`. A required boolean must be true (a
 * checkbox the assignee has to tick).
 */
export function validateTaskFieldValues(
  fields: TaskFieldDef[],
  values: Record<string, unknown> | null | undefined,
  options: { partial?: boolean } = {},
): Record<string, string> {
  const errors: Record<string, string> = {}
  const vals = values ?? {}
  for (const field of fields) {
    if (isDisplayField(field) || field.read_only) continue
    // Partial saves (drafts) only check the keys that were sent and skip
    // required checks; completion validates the full set.
    if (options.partial && !Object.prototype.hasOwnProperty.call(vals, field.key)) continue
    const visible = isFieldVisible(field, vals)
    const required = field.required && !options.partial && visible
    const value = vals[field.key]
    // In the browser: files still uploading would be left out of the submission.
    if (field.type === 'attachments' && attachmentUploadsInFlight(field.key) > 0) {
      errors[field.key] = `${field.label}: wait for the files to finish uploading`
      continue
    }
    if (field.type === 'boolean') {
      if (!isBlank(value) && toBoolean(value) === null) {
        errors[field.key] = `${field.label} must be true or false`
      } else if (required && toBoolean(value) !== true) {
        errors[field.key] = `${field.label} is required`
      }
      continue
    }
    if (isBlank(value)) {
      if (required) errors[field.key] = `${field.label} is required`
      continue
    }
    if (!visible) continue
    const error = valueError(field, value)
    if (error) errors[field.key] = error
  }
  return errors
}

function valueError(field: TaskFieldDef, value: unknown): string | null {
  const label = field.label
  if (field.type === 'attachments') return attachmentsValueError(field, value)
  if (field.type === 'lookup') {
    if (field.lookup?.multiple) {
      if (!Array.isArray(value) && typeof value !== 'string') return `${label} has an invalid value`
      const list = lookupValues(value, true)
      if (list.length > LOOKUP_LIMITS.maxSelections) return `${label}: choose at most ${LOOKUP_LIMITS.maxSelections}`
      if (list.some((v) => v.length > 1000)) return `${label} has an invalid value`
      return null
    }
    if (typeof value === 'object') return `${label} has an invalid value`
    return String(value).length > 1000 ? `${label} is too long` : null
  }
  if (field.type === 'multi_choice') {
    const list = toStringArray(value)
    const allowed = field.options ?? []
    const bad = list.filter((v) => !allowed.includes(v))
    if (bad.length) return `${label} must be from: ${allowed.join(', ')}`
    if (field.min !== undefined && list.length < field.min) return `${label}: choose at least ${field.min}`
    if (field.max !== undefined && list.length > field.max) return `${label}: choose at most ${field.max}`
    return null
  }
  if (typeof value === 'object') return `${label} has an invalid value`
  const s = String(value).trim()
  switch (field.type) {
    case 'number':
    case 'currency': {
      const n = toNumber(value)
      if (n === null) return `${label} must be a number`
      if (field.min !== undefined && n < field.min) return `${label} must be at least ${field.min}`
      if (field.max !== undefined && n > field.max) return `${label} must be at most ${field.max}`
      return null
    }
    case 'date':
    case 'datetime': {
      if (!validDate(s)) return field.type === 'date' ? `${label} must be a date (YYYY-MM-DD)` : `${label} must be a date and time (ISO 8601)`
      if (field.min_date && dateKey(s) < dateKey(field.min_date)) return `${label} must be on or after ${field.min_date}`
      if (field.max_date && dateKey(s) > dateKey(field.max_date)) return `${label} must be on or before ${field.max_date}`
      return null
    }
    case 'choice': {
      const options = field.options ?? []
      if (!options.includes(s)) return `${label} must be one of: ${options.join(', ')}`
      return null
    }
    case 'user':
      return UUID_RE.test(s) ? null : `${label} must be a person in this workspace`
    default:
      break
  }
  // Text-like.
  if (s.length > MAX_TEXT) return `${label} is too long`
  if (field.type === 'email' && !EMAIL_RE.test(s)) return `${label} must be an email address`
  if (field.type === 'phone' && !PHONE_RE.test(s)) return `${label} must be a phone number`
  if (field.type === 'url') {
    try {
      const url = new URL(s)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return `${label} must be an http(s) URL`
    } catch {
      return `${label} must be an http(s) URL`
    }
  }
  if (field.min_length !== undefined && s.length < field.min_length) return `${label} must be at least ${field.min_length} characters`
  if (field.max_length !== undefined && s.length > field.max_length) return `${label} must be at most ${field.max_length} characters`
  if (field.pattern) {
    let re: RegExp
    try { re = compileUserRegex(field.pattern) } catch { return null }
    if (!re.test(s)) return field.pattern_message ? `${label}: ${field.pattern_message}` : `${label} is not in the expected format`
  }
  return null
}

/**
 * Coerce submitted values to their stored types: blank → null, number /
 * currency → Number, boolean → true/false, multi-select → string[],
 * datetime → ISO string, everything else → string. Only value fields in the
 * list are returned. Call after validateTaskFieldValues.
 */
export function coerceTaskFieldValues(
  fields: TaskFieldDef[],
  values: Record<string, unknown> | null | undefined,
): Record<string, TaskFieldValue> {
  const out: Record<string, TaskFieldValue> = {}
  const vals = values ?? {}
  for (const field of fields) {
    if (isDisplayField(field)) continue
    if (!Object.prototype.hasOwnProperty.call(vals, field.key)) continue
    out[field.key] = coerceOne(field, vals[field.key])
  }
  return out
}

function coerceOne(field: TaskFieldDef, value: unknown): TaskFieldValue {
  if (field.type === 'boolean') return toBoolean(value) ?? false
  if (field.type === 'multi_choice') return toStringArray(value)
  if (field.type === 'lookup' && field.lookup?.multiple) return lookupValues(value, true)
  if (field.type === 'attachments') return normalizeAttachmentValue(value)
  if (isBlank(value)) return null
  if (field.type === 'number' || field.type === 'currency') return toNumber(value)
  if (field.type === 'datetime') {
    const d = new Date(String(value).trim())
    return Number.isNaN(d.getTime()) ? String(value) : d.toISOString()
  }
  if (field.type === 'date') {
    const s = String(value).trim()
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s
  }
  return typeof value === 'string' ? value : String(value)
}

/** Initial values for a field list: each field's default (or a type-appropriate blank). */
export function defaultTaskFieldValues(
  fields: TaskFieldDef[],
  resolve: (value: string) => unknown = (v) => v,
): Record<string, TaskFieldValue> {
  const raw: Record<string, unknown> = {}
  for (const field of fields) {
    if (isDisplayField(field)) continue
    if (field.default !== undefined) raw[field.key] = resolve(field.default)
    else raw[field.key] = field.type === 'boolean' ? false : field.type === 'multi_choice' || field.type === 'attachments' || (field.type === 'lookup' && field.lookup?.multiple) ? [] : null
  }
  return coerceTaskFieldValues(fields, raw)
}

/**
 * Apply submitted values to a task's metadata: validates against
 * `metadata.fields` and returns the merged `template_values` (existing values
 * overlaid with the coerced submission). Only declared, editable field keys
 * are taken from `values` — read-only fields keep their stored value. On
 * completion (`partial: false`) the merged set is validated, so values saved
 * earlier as a draft count toward required fields. Never trust the client:
 * every surface (UI action, REST, MCP, CLI) goes through here.
 */
export function mergeTaskFieldValues(
  metadata: Record<string, unknown> | null | undefined,
  values: Record<string, unknown> | null | undefined,
  options: { partial?: boolean } = {},
): { errors: Record<string, string>; templateValues: Record<string, unknown> } {
  const meta = metadata ?? {}
  const fields = normalizeTaskFields(meta.fields)
  const existing = isPlainObject(meta.template_values) ? meta.template_values : {}
  const editable = fields.filter((field) => !field.read_only && !isDisplayField(field))
  const submitted: Record<string, unknown> = {}
  for (const field of editable) {
    if (values && Object.prototype.hasOwnProperty.call(values, field.key)) submitted[field.key] = values[field.key]
  }
  const errors = options.partial
    ? validateTaskFieldValues(fields, submitted, { partial: true })
    : validateTaskFieldValues(fields, { ...existing, ...submitted })
  return { errors, templateValues: { ...existing, ...coerceTaskFieldValues(editable, submitted) } }
}

/** Data picker type of a field's value. */
export function fieldValueSchemaType(type: TaskFieldType): 'string' | 'number' | 'boolean' | 'array' {
  if (type === 'number' || type === 'currency') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'multi_choice' || type === 'attachments') return 'array'
  return 'string'
}
