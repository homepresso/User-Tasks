/**
 * A custom control's OUTPUT: what the workflow, the data picker, emails and
 * rules receive for the field — a primitive of the declared type — as
 * opposed to the control's VALUE (what it stores for itself and is handed
 * back when the form opens again). Declared in the manifest (`output`,
 * lib/forms/custom-controls/contract.ts) and snapshotted on the field.
 *
 *   <key>          the main output: `primary` (a dot path) or `template`
 *                  (text) of the value, coerced to `type`; HTML sanitised
 *   <key>_raw      the whole value (when the main output is a projection
 *                  of it) — the shape workflows read before outputs existed
 *   <key>_<extra>  each `extras` entry (a dot path, '' = the whole value)
 *
 * Without `output` (controls built before it, pinned older versions) the
 * value is the output, exactly as before. The server always recomputes the
 * outputs from a validated value: nothing the frame claims about types is
 * trusted. Pure and isomorphic (the browser validates with it too).
 */

import { htmlToPlainText, looksLikeHtml, sanitizeHtml, escapeHtml } from '@/lib/html-sanitize'
import { isPlainObject } from '@/lib/utils/guards'
import {
  CONTROL_OUTPUT_TYPES, OUTPUT_LIMITS,
  type ControlOutputChoice, type ControlOutputSpec, type ControlOutputType, type ControlValueSchema, type ControlValueType,
} from './contract'

/** What a field needs to compute outputs (a CustomControlFieldConfig fits). */
export interface OutputConfig {
  value_type: ControlValueType
  value_schema?: ControlValueSchema
  output?: ControlOutputSpec
  /** The main output the form author chose (a choice's value). */
  output_choice?: string
  props?: Record<string, unknown>
}

const PATH_RE = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/
const SUFFIX_RE = /^[a-z][a-z0-9_]{0,30}$/
const CHOICE_RE = /^[a-z][a-z0-9_]{0,30}$/
/** Sibling suffixes the form already uses for other fields (lookups, attachments, sections) or reserves. */
export const RESERVED_OUTPUT_SUFFIXES: ReadonlySet<string> = new Set(['raw', 'item', 'label', 'count', 'included'])
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/

export class OutputSpecError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputSpecError'
  }
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

function cleanChoice(raw: unknown, where: string): ControlOutputChoice {
  if (!isPlainObject(raw)) throw new OutputSpecError(`${where} must be an object`)
  const value = typeof raw.value === 'string' ? raw.value.trim() : ''
  if (!CHOICE_RE.test(value)) throw new OutputSpecError(`${where}.value must be a short lowercase name (e.g. html)`)
  const label = cleanText(raw.label, 60) ?? value
  const choice: ControlOutputChoice = { value, label }
  const primary = typeof raw.primary === 'string' ? raw.primary.trim() : ''
  const template = cleanText(raw.template, 500)
  if (primary && !PATH_RE.test(primary)) throw new OutputSpecError(`${where}.primary must be a dot path into the value (e.g. text)`)
  if (primary && template) throw new OutputSpecError(`${where}: use primary or template, not both`)
  if (primary) choice.primary = primary
  if (template) choice.template = template
  if (raw.html === true) choice.html = true
  return choice
}

/**
 * Validate a manifest's `output` against its value type (throws
 * OutputSpecError with a readable message). `undefined` → no output.
 */
export function parseOutputSpec(raw: unknown, valueType: ControlValueType): ControlOutputSpec | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!isPlainObject(raw)) throw new OutputSpecError('output must be an object')
  const type = raw.type
  if (typeof type !== 'string' || !(CONTROL_OUTPUT_TYPES as readonly string[]).includes(type)) {
    throw new OutputSpecError(`output.type must be one of ${CONTROL_OUTPUT_TYPES.join(', ')}`)
  }
  const spec: ControlOutputSpec = { type: type as ControlOutputType }
  const primary = typeof raw.primary === 'string' ? raw.primary.trim() : ''
  const template = cleanText(raw.template, 500)
  if (primary && !PATH_RE.test(primary)) throw new OutputSpecError('output.primary must be a dot path into the value (e.g. html)')
  if (primary && template) throw new OutputSpecError('output: use primary or template, not both')
  if (primary) spec.primary = primary
  if (template) spec.template = template
  if (raw.html === true) spec.html = true
  if (raw.extras !== undefined) {
    if (!isPlainObject(raw.extras)) throw new OutputSpecError('output.extras must map suffixes to paths')
    const entries = Object.entries(raw.extras)
    if (entries.length > OUTPUT_LIMITS.extras) throw new OutputSpecError(`output.extras: at most ${OUTPUT_LIMITS.extras}`)
    const extras: Record<string, string> = {}
    for (const [suffix, path] of entries) {
      if (!SUFFIX_RE.test(suffix)) throw new OutputSpecError(`output.extras: "${suffix}" must be a short lowercase name`)
      if (RESERVED_OUTPUT_SUFFIXES.has(suffix)) throw new OutputSpecError(`output.extras: "${suffix}" is reserved`)
      if (typeof path !== 'string' || (path !== '' && !PATH_RE.test(path))) throw new OutputSpecError(`output.extras.${suffix} must be a dot path into the value ('' for the whole value)`)
      extras[suffix] = path
    }
    if (Object.keys(extras).length) spec.extras = extras
  }
  if (raw.choices !== undefined) {
    if (!Array.isArray(raw.choices)) throw new OutputSpecError('output.choices must be a list')
    if (raw.choices.length > OUTPUT_LIMITS.choices) throw new OutputSpecError(`output.choices: at most ${OUTPUT_LIMITS.choices}`)
    const seen = new Set<string>()
    const choices = raw.choices.map((c, i) => cleanChoice(c, `output.choices[${i}]`))
    for (const c of choices) {
      if (seen.has(c.value)) throw new OutputSpecError(`output.choices: "${c.value}" appears twice`)
      seen.add(c.value)
    }
    if (choices.length) spec.choices = choices
  }
  const description = cleanText(raw.description, 300)
  if (description) spec.description = description

  // Consistency with what the control stores.
  const variants = [spec, ...(spec.choices ?? [])]
  if (variants.some((v) => v.html) && spec.type !== 'string') throw new OutputSpecError('output.html needs output.type "string"')
  if (variants.some((v) => v.template) && spec.type !== 'string') throw new OutputSpecError('output.template gives text: it needs output.type "string"')
  if (valueType === 'files' && spec.type !== 'array') throw new OutputSpecError('A files control outputs its file list: output.type must be "array"')
  const structured = valueType === 'json' || valueType === 'array' || valueType === 'files'
  if (structured && spec.type !== 'object' && spec.type !== 'array') {
    const projects = (v: { primary?: string; template?: string }) => Boolean(v.primary || v.template)
    if (!projects(spec) && !(spec.choices?.length && spec.choices.every(projects))) {
      throw new OutputSpecError(`The value is structured (${valueType}): a "${spec.type}" output needs output.primary or output.template`)
    }
  }
  if (!structured && (spec.primary || Object.values(spec.extras ?? {}).some(Boolean))) {
    throw new OutputSpecError(`The value is a ${valueType}: output.primary and extras paths only apply to structured values`)
  }
  return spec
}

/** A stored spec, leniently (an invalid one is dropped: the value stays the output). */
export function normalizeOutputSpec(raw: unknown, valueType: ControlValueType): ControlOutputSpec | undefined {
  try { return parseOutputSpec(raw, valueType) } catch { return undefined }
}

/** The main output in effect: the author's choice, else the first choice, else the spec itself. */
export function activeOutput(config: OutputConfig): { type: ControlOutputType; primary?: string; template?: string; html?: boolean; choice?: string } | null {
  const spec = config.output
  if (!spec) return null
  const choice = spec.choices?.find((c) => c.value === config.output_choice) ?? spec.choices?.[0]
  if (choice && (choice.primary || choice.template)) return { type: spec.type, primary: choice.primary, template: choice.template, html: choice.html, choice: choice.value }
  return { type: spec.type, primary: spec.primary, template: spec.template, html: spec.html ?? choice?.html, choice: choice?.value }
}

function pathValue(root: unknown, path: string): unknown {
  if (!path) return root
  let current: unknown = root
  for (const part of path.split('.')) {
    if (current === null || current === undefined) return undefined
    if (Array.isArray(current) && /^\d+$/.test(part)) current = current[Number(part)]
    else if (isPlainObject(current) && Object.prototype.hasOwnProperty.call(current, part)) current = current[part]
    else return undefined
  }
  return current
}

function plain(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(plain).join(', ')
  try { return JSON.stringify(value) } catch { return String(value) }
}

/** `{{value.path}}` / `{{props.name}}` → text (no HTML, no expressions). */
export function renderOutputTemplate(template: string, value: unknown, props: Record<string, unknown> | undefined): string {
  return template.replace(/\{\{\s*(value|props)((?:\.[A-Za-z0-9_]+)*)\s*\}\}/g, (_m, root: string, path: string) =>
    plain(root === 'value' ? pathValue(value, path.slice(1)) : pathValue(props ?? {}, path.slice(1))))
}

/** Coerce to the declared output type (null when there is nothing; an error when it cannot be). */
export function coerceOutput(type: ControlOutputType, value: unknown, html = false): { value: unknown; error?: string } {
  if (value === undefined || value === null) return { value: null }
  switch (type) {
    case 'string': {
      let s: string
      if (typeof value === 'string') s = value
      else if (typeof value === 'number' || typeof value === 'boolean') s = String(value)
      else return { value: null, error: 'is not text' }
      if (html) s = sanitizeHtml(s)
      if (s.length > OUTPUT_LIMITS.stringChars) return { value: null, error: 'is too long' }
      return { value: s }
    }
    case 'number': {
      const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value.trim()) : NaN
      return Number.isFinite(n) ? { value: n } : { value: null, error: 'is not a number' }
    }
    case 'boolean':
      if (typeof value === 'boolean') return { value }
      if (value === 'true' || value === 'false') return { value: value === 'true' }
      return { value: null, error: 'is not true or false' }
    case 'date':
      return typeof value === 'string' && DATE_RE.test(value.trim()) && !Number.isNaN(new Date(value.trim()).getTime())
        ? { value: value.trim() } : { value: null, error: 'is not a date' }
    case 'object':
      return isPlainObject(value) ? { value } : { value: null, error: 'is not an object' }
    case 'array':
      return Array.isArray(value) ? { value } : { value: null, error: 'is not a list' }
    default:
      return { value: null, error: 'has an unknown output type' }
  }
}

/** The main output of a value (no output declared: the value itself). */
export function projectOutput(config: OutputConfig, value: unknown): { value: unknown; error?: string } {
  const active = activeOutput(config)
  if (!active) return { value: value ?? null }
  if (value === null || value === undefined) return { value: null }
  const picked = active.template ? (renderOutputTemplate(active.template, value, config.props).trim() || null) : pathValue(value, active.primary ?? '')
  return coerceOutput(active.type, picked, Boolean(active.html))
}

/** Paths of the value that hold HTML (sanitised in `<key>_raw` too). */
function htmlPaths(spec: ControlOutputSpec): string[] {
  const paths = [spec.html && spec.primary ? spec.primary : '', ...(spec.choices ?? []).map((c) => (c.html && c.primary ? c.primary : ''))]
  return [...new Set(paths.filter(Boolean))]
}

function withSanitizedHtml(value: unknown, paths: string[]): unknown {
  if (!paths.length || !isPlainObject(value)) return value
  const copy: Record<string, unknown> = structuredClone(value)
  for (const path of paths) {
    const parts = path.split('.')
    let node: unknown = copy
    for (const part of parts.slice(0, -1)) node = isPlainObject(node) ? node[part] : undefined
    const last = parts[parts.length - 1]
    if (isPlainObject(node) && typeof node[last] === 'string') node[last] = sanitizeHtml(node[last])
  }
  return copy
}

/** Whether the main output is a projection (so the value is kept under `<key>_raw`). */
export function keepsRaw(config: OutputConfig): boolean {
  const active = activeOutput(config)
  return Boolean(active && (active.primary || active.template) && (config.value_type === 'json' || config.value_type === 'array'))
}

export function outputExtraKeys(config: OutputConfig): Array<{ suffix: string; path: string }> {
  return Object.entries(config.output?.extras ?? {}).map(([suffix, path]) => ({ suffix, path }))
}

/**
 * What the form stores (and the workflow receives) for a control field with
 * an output: `{ key: main, key_raw?: value, key_<extra>: … }`. Without an
 * output: `{ key: value }`. `value` must already be the validated value.
 */
export function customOutputEntries(key: string, config: OutputConfig, value: unknown): Record<string, unknown> {
  if (!config.output) return { [key]: value ?? null }
  const clean = withSanitizedHtml(value, htmlPaths(config.output))
  const main = projectOutput(config, clean)
  const out: Record<string, unknown> = { [key]: main.error ? null : main.value }
  if (keepsRaw(config)) out[`${key}_raw`] = clean ?? null
  for (const { suffix, path } of outputExtraKeys(config)) {
    const extra = clean === null || clean === undefined ? null : pathValue(clean, path)
    out[`${key}_${suffix}`] = extra === undefined ? null : extra
  }
  return out
}

/** A problem with a (valid) value's output — the field-level message, or null. */
export function customOutputError(label: string, config: OutputConfig, value: unknown): string | null {
  if (!config.output || value === null || value === undefined) return null
  const main = projectOutput(config, value)
  return main.error ? `${label} ${main.error}` : null
}

/** Does a value have the control's own shape (rather than its projected output)? */
export function isControlValueShape(config: Pick<OutputConfig, 'value_type' | 'value_schema'>, value: unknown): boolean {
  switch (config.value_type) {
    case 'json': return config.value_schema?.type === 'array' ? Array.isArray(value) : isPlainObject(value) || Array.isArray(value)
    case 'array':
    case 'files': return Array.isArray(value)
    default: return true
  }
}

function sameOutput(a: unknown, b: unknown): boolean {
  if (a === b) return true
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return false }
}

/**
 * A value from its main output when no `<key>_raw` is around (an API caller
 * sets `desc: "<p>…</p>"`): structured values whose output is one top-level
 * property — rich text's `{ html, text }` is rebuilt from HTML or text.
 */
function valueFromOutput(config: OutputConfig, output: unknown): unknown {
  if (config.value_type !== 'json' || typeof output !== 'string' || !config.output) return output
  const spec = config.output
  const variants = [{ primary: spec.primary, html: spec.html }, ...(spec.choices ?? [])]
  const htmlPath = variants.find((v) => v.html && v.primary && !v.primary.includes('.'))?.primary
  const textPath = spec.extras?.text && !spec.extras.text.includes('.') ? spec.extras.text : variants.find((v) => !v.html && v.primary && !v.primary.includes('.') && v.primary !== htmlPath)?.primary
  if (htmlPath) {
    const html = sanitizeHtml(looksLikeHtml(output) ? output : output.split('\n').map((line) => `<p>${escapeHtml(line) || '<br>'}</p>`).join(''))
    return { [htmlPath]: html, ...(textPath ? { [textPath]: htmlToPlainText(html) } : {}) }
  }
  const active = activeOutput(config)
  if (active?.primary && !active.primary.includes('.')) return { [active.primary]: output }
  return output
}

/**
 * The control's value for a field, from values that may hold its output
 * instead (a stored form opened again holds `<key>` = output and `<key>_raw`
 * = value): the value itself when it has the control's shape; else
 * `<key>_raw` (submitted, or stored before) when its output is that one;
 * else rebuilt from the output where possible. Used by the form (what the
 * control is given), the validator and the server, in the same way.
 */
export function nativeCustomValue(config: OutputConfig | undefined, key: string, values: Record<string, unknown> | null | undefined, previous?: Record<string, unknown> | null): unknown {
  const value = values?.[key]
  if (!config?.output || value === null || value === undefined) return value
  if (isControlValueShape(config, value)) return value
  for (const raw of [values?.[`${key}_raw`], previous?.[`${key}_raw`]]) {
    if (raw !== null && raw !== undefined && isControlValueShape(config, raw) && sameOutput(projectOutput(config, raw).value, typeof value === 'string' && activeOutput(config)?.html ? sanitizeHtml(value) : value)) return raw
  }
  return valueFromOutput(config, value)
}

/** Data-picker / JSON-schema type of the main output. */
export function outputSchemaType(type: ControlOutputType): 'string' | 'number' | 'boolean' | 'array' | 'object' {
  return type === 'date' ? 'string' : type
}

/** Plain text of a stored output, for read-only views (HTML → text). */
export function outputDisplayText(config: OutputConfig, value: unknown): string | null {
  if (!config.output || typeof value !== 'string' || isControlValueShape(config, value) && config.value_type !== 'string') return null
  return activeOutput(config)?.html ? htmlToPlainText(value) : value
}

/** The sibling keys a control field's outputs use (`<key>_raw`, `<key>_<extra>`), for code that copies a form's values by field. */
export function customOutputSiblingKeys(field: { key: string; type?: string; custom?: OutputConfig | null }): string[] {
  const config = field.custom
  if (field.type !== 'custom' || !config?.output) return []
  return [...(keepsRaw(config) ? [`${field.key}_raw`] : []), ...outputExtraKeys(config).map((e) => `${field.key}_${e.suffix}`)]
}
