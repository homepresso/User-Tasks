/**
 * Typed test inputs for Extensibility: the generated form on a workflow
 * action's Test tab (one field per declared input of the chosen function)
 * and on a form control's Try it dialog (one field per declared property).
 *
 * Both declarations are mapped to one `TestField` model the form renders
 * (components/extensibility/test-input-form.tsx); validation reuses the
 * runtime's own rules (checkActionInput for actions, coercePropValue for
 * control props) so the form flags exactly what a run would refuse.
 *
 * Secrets: an input whose name looks like a credential (legacy activities;
 * strict manifests refuse such names and use capabilities.credentials) is
 * masked, left out of the JSON view and of remembered inputs, and its value
 * is redacted from results.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { ActionField, ActionOperation } from '@/lib/custom-actions/contract'
import { actionFieldTypeLabel, checkActionInput, looksLikeCredentialName } from '@/lib/custom-actions/manifest'
import type { ControlPropSpec } from '@/lib/forms/custom-controls/contract'
import { coercePropValue } from '@/lib/forms/custom-controls/manifest'

export type TestFieldKind =
  | 'string' | 'text' | 'secret' | 'number' | 'integer' | 'boolean' | 'date' | 'datetime'
  | 'select' | 'color' | 'list' | 'object' | 'keyvalue' | 'objectList' | 'json' | 'file'

export type ListItemKind = 'string' | 'number' | 'integer' | 'boolean'

export interface TestField {
  name: string
  label: string
  kind: TestFieldKind
  /** The declared type, for the type hint ("number", "list of strings", …). */
  typeLabel: string
  required: boolean
  description?: string
  placeholder?: string
  default?: unknown
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
  step?: number | 'any'
  /** kind list: the item type. */
  itemKind?: ListItemKind
  /** kind object / objectList: the nested fields. */
  fields?: TestField[]
}

const SCALAR_ITEM: Record<string, ListItemKind> = { string: 'string', text: 'string', select: 'string', date: 'string', datetime: 'string', number: 'number', integer: 'integer', boolean: 'boolean' }
const NESTED_KINDS: TestFieldKind[] = ['string', 'text', 'number', 'integer', 'boolean', 'date', 'datetime', 'select']

/** A declared action input → the form field that edits it. */
export function actionFieldToTestField(field: ActionField, depth = 0): TestField {
  const base = {
    name: field.name,
    label: field.label || field.name,
    typeLabel: actionFieldTypeLabel(field),
    required: field.required === true,
    ...(field.description ? { description: field.description } : {}),
    ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    ...(field.default !== undefined ? { default: field.default } : {}),
  }
  switch (field.type) {
    case 'string':
      return { ...base, kind: depth === 0 && looksLikeCredentialName(field.name) ? 'secret' : 'string' }
    case 'text': return { ...base, kind: 'text' }
    case 'number': return { ...base, kind: 'number', step: 'any' }
    case 'integer': return { ...base, kind: 'integer', step: 1 }
    case 'boolean': return { ...base, kind: 'boolean' }
    case 'date': return { ...base, kind: 'date' }
    case 'datetime': return { ...base, kind: 'datetime' }
    case 'select': return { ...base, kind: 'select', options: (field.options ?? []).map((o) => ({ value: o.value, label: o.label ?? o.value })) }
    case 'file': return { ...base, kind: 'file' }
    case 'array': {
      const item = field.items
      if (item && SCALAR_ITEM[item.type]) return { ...base, kind: 'list', itemKind: SCALAR_ITEM[item.type] }
      if (item?.type === 'object' && item.fields?.length && depth < 2) {
        const fields = item.fields.map((f) => actionFieldToTestField(f, depth + 1))
        if (fields.every((f) => NESTED_KINDS.includes(f.kind))) return { ...base, kind: 'objectList', fields }
      }
      return { ...base, kind: 'json' }
    }
    case 'object': {
      if (field.fields?.length && depth < 2) {
        const fields = field.fields.map((f) => actionFieldToTestField(f, depth + 1))
        if (fields.every((f) => NESTED_KINDS.includes(f.kind) || f.kind === 'list')) return { ...base, kind: 'object', fields }
        return { ...base, kind: 'json' }
      }
      return { ...base, kind: depth === 0 && !field.fields?.length ? 'keyvalue' : 'json' }
    }
    default:
      return { ...base, kind: 'json' }
  }
}

/** A declared form control property → the form field that edits it. */
export function controlPropToTestField(prop: ControlPropSpec): TestField {
  const base = {
    name: prop.name,
    label: prop.label || prop.name,
    typeLabel: prop.type === 'string[]' ? 'list of strings' : prop.type === 'select' ? 'choice' : prop.type,
    required: prop.required === true,
    ...(prop.description ? { description: prop.description } : {}),
    ...(prop.default !== undefined ? { default: prop.default } : {}),
  }
  switch (prop.type) {
    case 'text': return { ...base, kind: 'text' }
    case 'number': return { ...base, kind: 'number', step: 'any', ...(prop.min !== undefined ? { min: prop.min } : {}), ...(prop.max !== undefined ? { max: prop.max } : {}) }
    case 'boolean': return { ...base, kind: 'boolean' }
    case 'select': return { ...base, kind: 'select', options: (prop.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value })) }
    case 'color': return { ...base, kind: 'color' }
    case 'string[]': return { ...base, kind: 'list', itemKind: 'string' }
    case 'json': return { ...base, kind: 'json' }
    default: return { ...base, kind: 'string' }
  }
}

export function isSecretField(field: TestField): boolean {
  return field.kind === 'secret'
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)
}

/** Starting values: each field's default, then the sample / examples over them (what Test always used). */
export function defaultTestValues(fields: TestField[], sample?: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (sample && Object.prototype.hasOwnProperty.call(sample, f.name) && sample[f.name] !== undefined) out[f.name] = sample[f.name]
    else if (f.default !== undefined) out[f.name] = f.default
  }
  return out
}

/** The sample an action operation declares (else its fields' examples). */
export function operationSample(operation: ActionOperation | null | undefined): Record<string, unknown> {
  if (!operation) return {}
  return operation.sample ?? Object.fromEntries(operation.inputs.filter((f) => f.example !== undefined).map((f) => [f.name, f.example]))
}

/**
 * The values sent to a run / shown in the JSON view: declared fields only,
 * blanks dropped (the runtime fills defaults). `withSecrets: false` drops
 * secret fields too (the JSON view and remembered inputs).
 */
export function testInputsOf(fields: TestField[], values: Record<string, unknown>, opts: { withSecrets?: boolean } = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (opts.withSecrets === false && isSecretField(f)) continue
    const v = values[f.name]
    if (isBlank(v)) continue
    out[f.name] = v
  }
  return out
}

/**
 * JSON view → form: the parsed object becomes the form's values; secret
 * fields keep what the form had (the JSON view never shows them). Unknown
 * keys are kept so nothing typed is lost (the runtime ignores them).
 */
export function mergeJsonIntoValues(fields: TestField[], current: Record<string, unknown>, parsed: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed }
  for (const f of fields) {
    if (isSecretField(f)) {
      delete out[f.name]
      if (current[f.name] !== undefined) out[f.name] = current[f.name]
    }
  }
  return out
}

/** Parse the JSON view's text: an object, or an error message (the form keeps its state). */
export function parseTestJson(text: string): { value: Record<string, unknown> } | { error: string } {
  const s = text.trim()
  if (!s) return { value: {} }
  let parsed: unknown
  try { parsed = JSON.parse(s) } catch (e) { return { error: `Not valid JSON: ${(e as Error).message}` } }
  if (!isPlainObject(parsed)) return { error: 'Inputs must be a JSON object ({ "name": value })' }
  return { value: parsed as Record<string, unknown> }
}

// ── Validation ──────────────────────────────────────────────────────────────

/** Errors by field name for an action function's inputs: the runtime's own checks (checkActionInput). */
export function validateActionInputs(operation: ActionOperation, values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of operation.inputs) {
    const result = checkActionInput(field, values[field.name])
    if ('error' in result) errors[field.name] = `${field.label ?? field.name} ${result.error}`
  }
  return errors
}

/** Errors by prop name for a form control's properties (coercePropValue refuses the value, or a required one is blank). */
export function validateControlProps(props: ControlPropSpec[], values: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const prop of props) {
    const label = prop.label ?? prop.name
    const value = values[prop.name]
    if (isBlank(value)) {
      if (prop.required && prop.default === undefined) errors[prop.name] = `${label} is required`
      continue
    }
    if (coercePropValue(prop, value) === undefined) {
      errors[prop.name] = prop.type === 'select' ? `${label} must be one of the choices`
        : prop.type === 'color' ? `${label} must be a colour (#RRGGBB, rgb() or hsl())`
          : prop.type === 'number' ? `${label} must be a number`
            : prop.type === 'json' ? `${label} must be valid JSON (at most 32 KB)`
              : `${label} is not valid`
      continue
    }
    if (prop.type === 'number') {
      const n = Number(value)
      if (prop.min !== undefined && n < prop.min) errors[prop.name] = `${label} must be at least ${prop.min}`
      else if (prop.max !== undefined && n > prop.max) errors[prop.name] = `${label} must be at most ${prop.max}`
    }
  }
  return errors
}

/** Props sent to the control preview: what the form renders on a real form (coerced, defaults applied). */
export function previewPropsOf(props: ControlPropSpec[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const prop of props) {
    const v = coercePropValue(prop, values[prop.name])
    if (v !== undefined) out[prop.name] = v
    else if (prop.default !== undefined) out[prop.name] = prop.default
  }
  return out
}

/**
 * Which fields a run's "Invalid inputs: A is required; B must be a number"
 * error names (by label or name), so the form can highlight them.
 */
export function fieldsNamedInError(fields: TestField[], message: string | null | undefined): string[] {
  if (!message) return []
  const body = message.replace(/^Invalid inputs:\s*/i, '')
  const parts = body.split(/;\s*/)
  const hits = new Set<string>()
  for (const part of parts) {
    // Longest label first: "Amount due" before "Amount".
    const match = [...fields].sort((a, b) => b.label.length - a.label.length).find((f) => part.startsWith(`${f.label} `) || part.startsWith(`${f.name} `))
    if (match) hits.add(match.name)
  }
  return [...hits]
}

// ── Secrets ─────────────────────────────────────────────────────────────────

export const REDACTED = '••••••••'

/** Secret values the user typed (non-trivial ones only: a 1–2 character value would redact noise). */
export function secretValuesOf(fields: TestField[], values: Record<string, unknown>): string[] {
  return fields.filter(isSecretField).map((f) => values[f.name]).filter((v): v is string => typeof v === 'string' && v.length >= 3)
}

/** Replace every occurrence of a secret value in a result (outputs, logs, error text) with •••. */
export function redactSecrets<T>(value: T, secrets: string[]): T {
  if (!secrets.length) return value
  const scrub = (v: unknown): unknown => {
    if (typeof v === 'string') return secrets.reduce((s, secret) => s.split(secret).join(REDACTED), v)
    if (Array.isArray(v)) return v.map(scrub)
    if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]))
    return v
  }
  return scrub(value) as T
}

// ── Remembered inputs (local storage) ───────────────────────────────────────

export function testInputsStorageKey(scope: 'action' | 'control', id: string, part?: string): string {
  return `ut:ext-test:${scope}:${id}${part ? `:${part}` : ''}`
}

function safeStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

/** Remember inputs (never secrets). */
export function rememberTestInputs(key: string, fields: TestField[], values: Record<string, unknown>, storage: Storage | null = safeStorage()): void {
  if (!storage) return
  try { storage.setItem(key, JSON.stringify(testInputsOf(fields, values, { withSecrets: false }))) } catch { /* full or blocked */ }
}

/** The remembered inputs for a key (declared, non-secret fields only), or null. */
export function recallTestInputs(key: string, fields: TestField[], storage: Storage | null = safeStorage()): Record<string, unknown> | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!isPlainObject(parsed)) return null
    const out: Record<string, unknown> = {}
    for (const f of fields) if (!isSecretField(f) && parsed[f.name] !== undefined) out[f.name] = parsed[f.name]
    return out
  } catch {
    return null
  }
}

export function forgetTestInputs(key: string, storage: Storage | null = safeStorage()): void {
  try { storage?.removeItem(key) } catch { /* blocked */ }
}

// ── Display helpers ─────────────────────────────────────────────────────────

/** ISO instant / local string → the value a datetime-local input shows (local time, minutes). */
export function toLocalDateTimeInput(value: unknown): string {
  if (typeof value !== 'string' || !value) return ''
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A datetime-local value → an ISO 8601 instant (what the runtime and actions expect). */
export function fromLocalDateTimeInput(value: string): string | undefined {
  if (!value) return undefined
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? value : d.toISOString()
}

/** A list item typed in the chip editor → its declared item type (left as text when it doesn't parse, so validation can say why). */
export function coerceListItem(kind: ListItemKind | undefined, text: string): unknown {
  const s = text.trim()
  if (kind === 'number' || kind === 'integer') {
    const n = Number(s)
    return s !== '' && Number.isFinite(n) ? n : s
  }
  if (kind === 'boolean') {
    if (/^(true|yes|1|on|y)$/i.test(s)) return true
    if (/^(false|no|0|off|n)$/i.test(s)) return false
    return s
  }
  return s
}

/** One output row of a result: declared outputs in order, then undeclared ones. */
export interface OutputRow { name: string; type: string; value: unknown; declared: boolean; missing: boolean }

export function outputRows(declared: ActionField[], outputs: Record<string, unknown> | null | undefined): OutputRow[] {
  const values = isPlainObject(outputs) ? outputs : {}
  const rows: OutputRow[] = declared.map((f) => ({ name: f.name, type: actionFieldTypeLabel(f), value: values[f.name], declared: true, missing: !(f.name in values) }))
  for (const [name, value] of Object.entries(values)) {
    if (!declared.some((f) => f.name === name)) rows.push({ name, type: valueTypeOf(value), value, declared: false, missing: false })
  }
  return rows
}

export function valueTypeOf(value: unknown): string {
  if (value === null || value === undefined) return 'empty'
  if (Array.isArray(value)) return 'list'
  return typeof value === 'object' ? 'object' : typeof value
}

/** An output value as display text, and whether it is long enough to collapse. */
export function formatOutputValue(value: unknown): { text: string; long: boolean } {
  const text = value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return { text, long: text.length > 160 || text.split('\n').length > 4 }
}
