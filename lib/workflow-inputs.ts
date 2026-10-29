/**
 * Workflow input parameters: the form a manual / API start fills in.
 *
 * A workflow's inputs are its `user_variables` (workflow variables), taken
 * from the published version — the definition new runs use — or from the
 * draft while the workflow has never been published. Each variable becomes a
 * field:
 *
 *   { id, name, type: 'string'|'number'|'boolean'|'object', defaultValue, description,
 *     // optional, set in the designer's variable editor:
 *     label?, required?, format?: 'text'|'date'|'datetime'|'email'|'url'|'select', options? }
 *   Attachments: `{ type: 'array', format: 'attachments', attachments?: { max_files, … } }`
 *   — a list of uploaded files (the start form uploads them; API callers
 *   pass file ids from POST /api/v1/files/uploads). The start service
 *   rebuilds the list from the upload records (lib/services/form-files.ts).
 *
 * `validateWorkflowInputs` checks a submitted `variables` object against the
 * fields: required fields need a value (a default counts), values are coerced
 * to the field type (strings from forms / the CLI become numbers, booleans,
 * JSON), and keys that are not declared inputs pass through unchanged with a
 * warning (API callers have always been able to pass any variable). A
 * workflow without declared inputs accepts anything, as before.
 *
 * Pure: shared by the start service (REST, MCP, server action), the Run
 * dialog and its tests.
 */

import { normalizeAttachmentsConfig, normalizeAttachmentValue, type AttachmentsConfig } from '@/lib/forms/attachments'

export const WORKFLOW_INPUT_TYPES = ['text', 'number', 'boolean', 'date', 'datetime', 'json', 'select', 'email', 'url', 'attachments'] as const
export type WorkflowInputType = (typeof WORKFLOW_INPUT_TYPES)[number]

export interface WorkflowInputOption {
  value: string
  label: string
}

export interface WorkflowInputField {
  key: string
  label: string
  type: WorkflowInputType
  required: boolean
  /** Default (typed), or null when the variable has none. */
  default: unknown
  description: string | null
  /** Choices of a `select` field. */
  options: WorkflowInputOption[] | null
  /** `attachments` fields: counts, sizes and types (lib/forms/attachments.ts). */
  attachments?: AttachmentsConfig
}

export interface WorkflowInputSchema {
  workflow_id: string
  workflow_name: string
  is_active: boolean
  /** Whether the workflow has a published version (runs use it). */
  published: boolean
  /** Where the fields come from: the published version, or the draft when never published. */
  source: 'published' | 'draft'
  version_id: string | null
  version_number: number | null
  fields: WorkflowInputField[]
  /**
   * The start form's grid and resolved mini theme (form designer; the
   * trigger node's `start_form`), or null for the plain one-column form.
   * Layout cells reference field keys.
   */
  start_form?: { layout: { rows: Array<{ columns: number; cells: Array<{ field_key: string; span: number }> }> } | null; theme: Record<string, unknown> | null } | null
}

export interface WorkflowInputError {
  field: string
  message: string
}

export interface WorkflowInputValidation {
  ok: boolean
  /** Submitted values coerced to their field types; undeclared keys pass through. Empty optional values are dropped (the default applies). */
  values: Record<string, unknown>
  errors: WorkflowInputError[]
  warnings: string[]
}

/* eslint-disable @typescript-eslint/no-explicit-any -- user_variables are loose JSON */

const FORMAT_TYPES = new Set<WorkflowInputType>(['text', 'date', 'datetime', 'email', 'url', 'select'])

/** user_variables `type` (+ optional `format` / `options`) → input field type. */
export function inputTypeOf(variable: { type?: unknown; format?: unknown; options?: unknown }): WorkflowInputType {
  const type = String(variable.type ?? 'string').toLowerCase()
  const format = typeof variable.format === 'string' ? variable.format.toLowerCase() : ''
  if (type === 'number' || type === 'integer' || type === 'float') return 'number'
  if (type === 'boolean' || type === 'bool') return 'boolean'
  if ((type === 'array' || type === 'attachments') && format === 'attachments') return 'attachments'
  if (type === 'object' || type === 'array' || type === 'json') return 'json'
  if ((WORKFLOW_INPUT_TYPES as readonly string[]).includes(type) && type !== 'text') return type as WorkflowInputType
  // string / text / anything unknown: a text field, refined by `format`, or a select when it lists options.
  if (FORMAT_TYPES.has(format as WorkflowInputType)) return format as WorkflowInputType
  if (normalizeOptions(variable.options)?.length) return 'select'
  return 'text'
}

function normalizeOptions(raw: unknown): WorkflowInputOption[] | null {
  let list: unknown = raw
  if (typeof raw === 'string') list = raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  if (!Array.isArray(list)) return null
  const options: WorkflowInputOption[] = []
  for (const item of list) {
    if (item && typeof item === 'object') {
      const value = (item as any).value ?? (item as any).label
      if (value === undefined || value === null || value === '') continue
      options.push({ value: String(value), label: String((item as any).label ?? value) })
    } else if (item !== undefined && item !== null && item !== '') {
      options.push({ value: String(item), label: String(item) })
    }
  }
  return options
}

/** "customer_name" / "customerName" → "Customer name". */
export function humanizeKey(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key
}

const isTrue = (value: unknown) => value === true || value === 'true' || value === 1 || value === '1'

/** Typed default of a variable (null when it has none). */
function defaultOf(variable: any, type: WorkflowInputType): unknown {
  const raw = variable.defaultValue ?? variable.default
  if (raw === undefined || raw === null || raw === '') return type === 'boolean' && raw === '' ? false : null
  const coerced = coerceValue(type, raw, null)
  return coerced.ok ? coerced.value : null
}

/** Input fields from a version's (or the draft's) user_variables. Variables without a name are skipped. */
export function deriveInputFields(userVariables: unknown): WorkflowInputField[] {
  if (!Array.isArray(userVariables)) return []
  const seen = new Set<string>()
  const fields: WorkflowInputField[] = []
  for (const variable of userVariables) {
    if (!variable || typeof variable !== 'object') continue
    const key = String((variable as any).name ?? (variable as any).key ?? '').trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    const type = inputTypeOf(variable as any)
    const options = type === 'select' ? normalizeOptions((variable as any).options) ?? [] : null
    const label = typeof (variable as any).label === 'string' && (variable as any).label.trim() ? (variable as any).label.trim() : humanizeKey(key)
    const description = typeof (variable as any).description === 'string' && (variable as any).description.trim() ? (variable as any).description.trim() : null
    fields.push({
      key, label, type, required: isTrue((variable as any).required), default: type === 'attachments' ? null : defaultOf(variable, type), description, options,
      ...(type === 'attachments' ? { attachments: normalizeAttachmentsConfig((variable as any).attachments) } : {}),
    })
  }
  return fields
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** True when a submitted value counts as "not provided". */
export function isEmptyInput(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && (value.trim() === '' || value.trim() === '[]')) || (Array.isArray(value) && value.length === 0)
}

type Coerced = { ok: true; value: unknown } | { ok: false; message: string }

/** Coerce one value to a field type (strings from forms and the CLI are parsed). */
export function coerceValue(type: WorkflowInputType, value: unknown, options: WorkflowInputOption[] | null): Coerced {
  switch (type) {
    case 'number': {
      if (typeof value === 'number') return Number.isFinite(value) ? { ok: true, value } : { ok: false, message: 'must be a number' }
      if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value.trim()))) return { ok: true, value: Number(value.trim()) }
      return { ok: false, message: 'must be a number' }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value }
      const text = String(value).trim().toLowerCase()
      if (['true', '1', 'yes', 'y', 'on'].includes(text)) return { ok: true, value: true }
      if (['false', '0', 'no', 'n', 'off'].includes(text)) return { ok: true, value: false }
      return { ok: false, message: 'must be true or false' }
    }
    case 'json': {
      if (typeof value !== 'string') return { ok: true, value }
      try {
        return { ok: true, value: JSON.parse(value) }
      } catch {
        return { ok: false, message: 'must be valid JSON' }
      }
    }
    case 'date': {
      const text = String(value).trim()
      const match = DATE_RE.exec(text)
      const valid = match && (() => {
        const d = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
        return d.getUTCFullYear() === Number(match[1]) && d.getUTCMonth() === Number(match[2]) - 1 && d.getUTCDate() === Number(match[3])
      })()
      return valid ? { ok: true, value: text } : { ok: false, message: 'must be a date (YYYY-MM-DD)' }
    }
    case 'datetime': {
      const text = String(value).trim()
      return text && !Number.isNaN(Date.parse(text)) ? { ok: true, value: text } : { ok: false, message: 'must be a date and time (ISO 8601)' }
    }
    case 'email': {
      const text = String(value).trim()
      return EMAIL_RE.test(text) ? { ok: true, value: text } : { ok: false, message: 'must be an email address' }
    }
    case 'url': {
      const text = String(value).trim()
      try {
        const url = new URL(text)
        if (url.protocol === 'http:' || url.protocol === 'https:') return { ok: true, value: text }
      } catch { /* fall through */ }
      return { ok: false, message: 'must be an http(s) URL' }
    }
    case 'attachments': {
      // File objects, or file ids (API callers); the server re-reads them from the upload records.
      let list: unknown = value
      if (typeof value === 'string') {
        const text = value.trim()
        if (text.startsWith('[') || text.startsWith('{')) { try { list = JSON.parse(text) } catch { return { ok: false, message: 'must be a list of files' } } }
        else list = text.split(',').map((s) => s.trim()).filter(Boolean)
      }
      const raw = Array.isArray(list) ? list : [list]
      const files = normalizeAttachmentValue(raw)
      return files.length === raw.length ? { ok: true, value: files } : { ok: false, message: 'must be a list of uploaded files' }
    }
    case 'select': {
      const text = typeof value === 'string' ? value : String(value)
      if (options && options.length && !options.some((o) => o.value === text)) {
        return { ok: false, message: `must be one of: ${options.map((o) => o.value).join(', ')}` }
      }
      return { ok: true, value: text }
    }
    default: {
      if (typeof value === 'string') return { ok: true, value }
      if (typeof value === 'number' || typeof value === 'boolean') return { ok: true, value: String(value) }
      return { ok: false, message: 'must be text' }
    }
  }
}

/**
 * Validate and coerce submitted variables against the input fields. Required
 * fields need a value or a default; empty optional values are dropped so the
 * default applies; keys that are not inputs pass through (warned, except
 * internal `_`-prefixed keys).
 */
export function validateWorkflowInputs(fields: readonly WorkflowInputField[], submitted: Record<string, unknown> | null | undefined): WorkflowInputValidation {
  const input = submitted ?? {}
  const values: Record<string, unknown> = {}
  const errors: WorkflowInputError[] = []
  const warnings: string[] = []
  const declared = new Set(fields.map((f) => f.key))

  for (const field of fields) {
    const raw = input[field.key]
    const empty = isEmptyInput(raw) && !(field.type === 'text' && raw === '' && !field.required)
    if (empty) {
      if (field.required && isEmptyInput(field.default)) errors.push({ field: field.key, message: `${field.label} is required` })
      continue
    }
    if (field.type === 'text' && raw === '') {
      values[field.key] = ''
      continue
    }
    const coerced = coerceValue(field.type, raw, field.options)
    if (coerced.ok) values[field.key] = coerced.value
    else errors.push({ field: field.key, message: `${field.label} ${coerced.message}` })
  }

  if (fields.length > 0) {
    const unknown = Object.keys(input).filter((key) => !declared.has(key) && !key.startsWith('_'))
    if (unknown.length) warnings.push(`Not declared as workflow inputs (passed through unchanged): ${unknown.join(', ')}`)
  }
  for (const [key, value] of Object.entries(input)) if (!declared.has(key)) values[key] = value

  return { ok: errors.length === 0, values, errors, warnings }
}

/** One-line summary of field errors ("amount: Amount must be a number; name: Name is required"). */
export function formatInputErrors(errors: readonly WorkflowInputError[]): string {
  return errors.map((e) => `${e.field}: ${e.message}`).join('; ')
}

/** Initial form values: the defaults as the form controls hold them (strings / booleans). */
export function initialFormValues(fields: readonly WorkflowInputField[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {}
  for (const field of fields) {
    const value = field.default
    if (field.type === 'boolean') out[field.key] = value === true
    else if (value === null || value === undefined) out[field.key] = ''
    else if (field.type === 'json') out[field.key] = JSON.stringify(value, null, 2)
    else out[field.key] = String(value)
  }
  return out
}
