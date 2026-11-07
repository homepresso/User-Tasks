/**
 * A custom form control placed on a form: the `custom` config of a
 * TaskFieldDef whose type is 'custom'. It references the control by tag and
 * pins a version, and keeps a snapshot of what the server needs without a
 * database round trip — the value type and value schema it validates every
 * submission against, the display formatter for read-only views, size and
 * accessibility hints — taken from that version's manifest when the
 * designer places (or upgrades) the control. The bundle itself is never
 * copied into the form: it is loaded from the workspace's library at render
 * time (lib/forms/custom-controls/frame.ts).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import {
  CONTROL_CAPABILITIES, CONTROL_DISPLAY_FORMATS, CONTROL_VALUE_TYPES, PACKAGE_LIMITS,
  type ControlAccessibilitySpec, type ControlCapability, type ControlDisplaySpec, type ControlOutputSpec, type ControlSizeSpec, type ControlValueSchema,
  type ControlValueType, type FormControlManifest,
} from './contract'
import { normalizeOutputSpec, outputDisplayText, outputSchemaType } from './output'
import { normalizeValueSchema, validateAgainstSchema } from './json-schema'
import { isSemver, isValidTag, normalizeIcon, resolveControlProps } from './manifest'

export interface CustomControlFieldConfig {
  /** The control's tag (its identity in the workspace library). */
  tag: string
  /** Pinned version. */
  version: string
  /** Display name and icon (palette, properties panel) — a snapshot. */
  name?: string
  icon?: string
  value_type: ControlValueType
  value_schema?: ControlValueSchema
  /** Designer property values (validated against the manifest's props). */
  props?: Record<string, unknown>
  /** Context name the control declared → the field key whose value it receives. */
  context_map?: Record<string, string>
  display?: ControlDisplaySpec
  accessibility?: ControlAccessibilitySpec
  size?: ControlSizeSpec
  capabilities?: ControlCapability[]
  /** What the workflow receives (lib/forms/custom-controls/output.ts) — a snapshot of the manifest's `output`. */
  output?: ControlOutputSpec
  /** The main output the form author chose (one of output.choices). */
  output_choice?: string
}

export const MAX_CUSTOM_VALUE_BYTES = 256 * 1024
const KEY_RE = /^[a-z0-9][a-z0-9_]*$/

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

/** Clean a stored `custom` config (null when it can't identify a control). */
export function normalizeCustomControlConfig(raw: unknown): CustomControlFieldConfig | null {
  if (!isPlainObject(raw)) return null
  const tag = typeof raw.tag === 'string' ? raw.tag.trim() : ''
  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  if (!isValidTag(tag) || !isSemver(version)) return null
  const valueType = (CONTROL_VALUE_TYPES as readonly unknown[]).includes(raw.value_type) ? raw.value_type as ControlValueType : 'json'
  const config: CustomControlFieldConfig = { tag, version, value_type: valueType }
  const name = cleanText(raw.name, 120)
  if (name) config.name = name
  const icon = normalizeIcon(raw.icon)
  if (icon) config.icon = icon
  try {
    const schema = normalizeValueSchema(raw.value_schema)
    if (schema && Object.keys(schema).length && JSON.stringify(schema).length <= PACKAGE_LIMITS.valueSchemaBytes) config.value_schema = schema
  } catch {
    // A pattern the safe-regex rules refuse: drop the schema (the type check still applies).
  }
  if (isPlainObject(raw.props)) {
    const props: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(raw.props).slice(0, PACKAGE_LIMITS.props)) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) && value !== undefined) props[key] = value
    }
    if (JSON.stringify(props).length <= 64 * 1024 && Object.keys(props).length) config.props = props
  }
  if (isPlainObject(raw.context_map)) {
    const map: Record<string, string> = {}
    for (const [name, key] of Object.entries(raw.context_map).slice(0, PACKAGE_LIMITS.context)) {
      if (/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name) && typeof key === 'string' && KEY_RE.test(key)) map[name] = key
    }
    if (Object.keys(map).length) config.context_map = map
  }
  if (isPlainObject(raw.display)) {
    const template = cleanText(raw.display.template, 500)
    const format = (CONTROL_DISPLAY_FORMATS as readonly unknown[]).includes(raw.display.format) ? raw.display.format as ControlDisplaySpec['format'] : undefined
    if (template || format) config.display = { ...(template ? { template } : {}), ...(format ? { format } : {}) }
  }
  if (isPlainObject(raw.accessibility)) {
    const a: ControlAccessibilitySpec = {}
    const role = cleanText(raw.accessibility.role, 40)
    const keyboard = cleanText(raw.accessibility.keyboard, 500)
    if (role && /^[a-z]+$/.test(role)) a.role = role
    if (keyboard) a.keyboard = keyboard
    if (typeof raw.accessibility.labelled_by_host === 'boolean') a.labelled_by_host = raw.accessibility.labelled_by_host
    if (Object.keys(a).length) config.accessibility = a
  }
  if (isPlainObject(raw.size)) {
    const s: ControlSizeSpec = {}
    for (const key of ['default_height', 'min_height', 'max_height'] as const) {
      const n = raw.size[key]
      if (typeof n === 'number' && Number.isFinite(n)) s[key] = Math.round(Math.min(2000, Math.max(24, n)))
    }
    if (raw.size.full_width === true) s.full_width = true
    if (Object.keys(s).length) config.size = s
  }
  if (Array.isArray(raw.capabilities)) {
    const caps = raw.capabilities.filter((c): c is ControlCapability => (CONTROL_CAPABILITIES as readonly unknown[]).includes(c))
    if (caps.length) config.capabilities = [...new Set(caps)]
  }
  const output = normalizeOutputSpec(raw.output, valueType)
  if (output) {
    config.output = output
    if (typeof raw.output_choice === 'string' && output.choices?.some((c) => c.value === raw.output_choice)) config.output_choice = raw.output_choice
  }
  return config
}

/** The field config for a manifest (designer: place a control, or switch its version — prop values are kept where they still fit). */
export function customConfigFromManifest(manifest: FormControlManifest, previous?: CustomControlFieldConfig | null): CustomControlFieldConfig {
  const config: CustomControlFieldConfig = {
    tag: manifest.tag,
    version: manifest.version,
    name: manifest.name,
    value_type: manifest.value.type,
  }
  if (manifest.icon) config.icon = manifest.icon
  if (manifest.value.schema) config.value_schema = manifest.value.schema
  const props = resolveControlProps(manifest, previous?.props)
  if (Object.keys(props).length) config.props = props
  if (previous?.context_map) {
    const names = new Set(manifest.context.map((c) => c.name))
    const kept = Object.fromEntries(Object.entries(previous.context_map).filter(([name]) => names.has(name)))
    if (Object.keys(kept).length) config.context_map = kept
  }
  if (manifest.display) config.display = manifest.display
  if (manifest.accessibility) config.accessibility = manifest.accessibility
  if (Object.keys(manifest.size).length) config.size = manifest.size
  if (manifest.capabilities.length) config.capabilities = manifest.capabilities
  if (manifest.output) {
    config.output = manifest.output
    // The author's choice of main output carries over to a new version that still offers it.
    if (previous?.output_choice && manifest.output.choices?.some((c) => c.value === previous.output_choice)) config.output_choice = previous.output_choice
  }
  return config
}

/** Designer problem with a config (null = fine): context mapped to a missing field. */
export function customControlConfigProblem(config: CustomControlFieldConfig | undefined, otherKeys: string[]): string | null {
  if (!config) return 'Choose a custom control'
  for (const [name, key] of Object.entries(config.context_map ?? {})) {
    if (!otherKeys.includes(key)) return `Context "${name}" refers to an unknown field "${key}"`
  }
  return null
}

function jsonSize(value: unknown): number {
  try { return JSON.stringify(value)?.length ?? 0 } catch { return Infinity }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/

/** Is a value blank for a custom control (required check)? */
export function isBlankCustomValue(type: ControlValueType, value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (type === 'boolean') return value !== true
  if (type === 'json' && isPlainObject(value)) return Object.keys(value).length === 0
  return false
}

/** Coerce a submitted value to the control's value type (numbers from numeric strings, JSON text parsed). Unconvertible values pass through for the validator to reject. */
export function coerceCustomValue(config: CustomControlFieldConfig, value: unknown): unknown {
  if (value === undefined || value === null) return null
  switch (config.value_type) {
    case 'number': {
      if (typeof value === 'number') return value
      if (typeof value === 'string' && value.trim() !== '') {
        const n = Number(value.trim())
        return Number.isFinite(n) ? n : value
      }
      return value
    }
    case 'boolean':
      if (value === 'true') return true
      if (value === 'false') return false
      return value
    case 'string':
      return typeof value === 'number' || typeof value === 'boolean' ? String(value) : value
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : value
    case 'json':
    case 'array':
    case 'files':
      if (typeof value === 'string') {
        const s = value.trim()
        if (s.startsWith('{') || s.startsWith('[')) {
          try { return JSON.parse(s) } catch { return value }
        }
      }
      return value
    default:
      return value
  }
}

/**
 * Server-side value check for a custom control (after coercion): the value
 * type, the size cap and the manifest's value schema. Message is prefixed
 * with the field label. Blank values are the caller's (required) concern.
 */
export function customValueError(label: string, config: CustomControlFieldConfig, value: unknown): string | null {
  if (jsonSize(value) > MAX_CUSTOM_VALUE_BYTES) return `${label} is too large`
  switch (config.value_type) {
    case 'string':
      if (typeof value !== 'string') return `${label} must be text`
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return `${label} must be a number`
      break
    case 'boolean':
      if (typeof value !== 'boolean') return `${label} must be true or false`
      break
    case 'date':
      if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(new Date(value).getTime())) return `${label} must be a date`
      break
    case 'array':
      if (!Array.isArray(value)) return `${label} must be a list`
      break
    case 'files':
      if (!Array.isArray(value) || !value.every((f) => isPlainObject(f) && typeof f.id === 'string')) return `${label} must be a list of uploaded files`
      break
    case 'json':
    default:
      if (value === undefined || typeof value === 'function') return `${label} has an invalid value`
  }
  const problem = validateAgainstSchema(value, config.value_schema)
  return problem ? `${label}: ${problem}` : null
}

function pathValue(root: unknown, path: string): unknown {
  let current: unknown = root
  for (const part of path.split('.').filter(Boolean)) {
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

/**
 * A matrix answer (`props.statements` = the rows, value = { <statement key>: n })
 * as one "Statement: n" line per row instead of JSON — the Likert control's
 * shape (keys: lowercase, other characters → _, duplicates _2, _3 …).
 */
function statementLines(config: CustomControlFieldConfig | undefined, value: unknown): string | null {
  const statements = config?.props?.statements
  if (!Array.isArray(statements) || !statements.length || !statements.every((s) => typeof s === 'string') || !isPlainObject(value)) return null
  const seen = new Map<string, number>()
  const lines: string[] = []
  for (const statement of statements as string[]) {
    const base = statement.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'statement'
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    const key = n === 1 ? base : `${base}_${n}`
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue
    const answer = value[key]
    lines.push(`${statement}: ${answer === 0 ? 'N/A' : plain(answer)}`)
  }
  return lines.length ? lines.join('\n') : null
}

/**
 * Read-only text of a custom control's value (completed tasks, mobile,
 * submissions): the manifest's display template (`{{value}}`,
 * `{{value.path}}`, `{{props.name}}` — plain text), else its format, else
 * a sensible default per value type.
 */
export function formatCustomValue(config: CustomControlFieldConfig | undefined, value: unknown): string {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) return '—'
  // A stored output (`<key>` holds the main output, the value is under `<key>_raw`): its text.
  const output = config ? outputDisplayText(config, value) : null
  if (output !== null) return output || '—'
  const display = config?.display
  if (display?.template) {
    const props = config?.props ?? {}
    return display.template.replace(/\{\{\s*(value|props)((?:\.[A-Za-z0-9_]+)*)\s*\}\}/g, (_m, root: string, path: string) =>
      plain(root === 'value' ? pathValue(value, path) : pathValue(props, path.slice(1))))
  }
  const format = display?.format ?? (config?.value_type === 'json' ? 'json' : config?.value_type === 'array' ? 'list' : config?.value_type === 'date' ? 'date' : 'text')
  if (config?.value_type === 'files' && Array.isArray(value)) return value.map((f) => (isPlainObject(f) ? String(f.name ?? f.id ?? '') : String(f))).join(', ')
  switch (format) {
    case 'json': {
      const statements = statementLines(config, value)
      if (statements) return statements
      try { return JSON.stringify(value, null, 2) } catch { return String(value) }
    }
    case 'list':
      return Array.isArray(value) ? value.map(plain).join(', ') : plain(value)
    case 'number':
      return typeof value === 'number' ? value.toLocaleString() : plain(value)
    case 'date': {
      const d = new Date(String(value))
      return Number.isNaN(d.getTime()) ? plain(value) : /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? d.toLocaleDateString(undefined, { timeZone: 'UTC' }) : d.toLocaleString()
    }
    default:
      if (typeof value === 'boolean') return value ? 'Yes' : 'No'
      return plain(value)
  }
}

/** Data-picker / JSON-schema type of the stored value. */
export function customValueSchemaType(config: CustomControlFieldConfig | undefined): 'string' | 'number' | 'boolean' | 'array' | 'object' {
  if (config?.output) return outputSchemaType(config.output.type)
  switch (config?.value_type) {
    case 'number': return 'number'
    case 'boolean': return 'boolean'
    case 'array':
    case 'files': return 'array'
    case 'json': return config.value_schema?.type === 'array' ? 'array' : 'object'
    default: return 'string'
  }
}

export interface CustomControlRef { tag: string; version: string; field_key: string }

/** Custom controls a raw field list uses (stored forms, node configs, task metadata). */
export function customControlRefs(fields: unknown): CustomControlRef[] {
  if (!Array.isArray(fields)) return []
  const out: CustomControlRef[] = []
  for (const field of fields) {
    if (!isPlainObject(field) || field.type !== 'custom' || !isPlainObject(field.custom)) continue
    const tag = typeof field.custom.tag === 'string' ? field.custom.tag : ''
    const version = typeof field.custom.version === 'string' ? field.custom.version : ''
    if (tag) out.push({ tag, version, field_key: String(field.key ?? '') })
  }
  return out
}

/** Custom controls a workflow definition uses: form-carrying nodes' fields and the start form (custom inputs). */
export function workflowCustomControlRefs(nodes: unknown, userVariables?: unknown): Array<CustomControlRef & { node_id: string | null; node_label: string }> {
  const out: Array<CustomControlRef & { node_id: string | null; node_label: string }> = []
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!isPlainObject(node) || !isPlainObject(node.config)) continue
    for (const ref of customControlRefs(node.config.fields)) out.push({ ...ref, node_id: String(node.id ?? ''), node_label: String(node.label ?? node.type ?? '') })
  }
  for (const variable of Array.isArray(userVariables) ? userVariables : []) {
    if (!isPlainObject(variable) || variable.format !== 'custom' || !isPlainObject(variable.custom)) continue
    const tag = typeof variable.custom.tag === 'string' ? variable.custom.tag : ''
    if (tag) out.push({ tag, version: String(variable.custom.version ?? ''), field_key: String(variable.name ?? ''), node_id: null, node_label: 'Start form' })
  }
  return out
}

/**
 * Validity a control reported (ut-validity) for the field key, in this
 * browser tab: the form's own validation shows it and holds the submit.
 * Like attachments still uploading, it exists only in the browser — the
 * server re-validates the value itself.
 */
const reportedValidity = new Map<string, string>()

export function setCustomControlValidity(fieldKey: string, message: string | null): void {
  if (message) reportedValidity.set(fieldKey, message)
  else reportedValidity.delete(fieldKey)
}

export function customControlValidityMessage(fieldKey: string): string | null {
  return reportedValidity.get(fieldKey) ?? null
}

/**
 * File ids a control may read (`file` request): the files in its own value
 * and in its declared context values (an Attachments field mapped as
 * context). The host downloads them with the user's own session, so a
 * control can only ever read files the form already gave it — and only
 * those the user may open.
 */
export function readableFileIds(value: unknown, contextFields: Record<string, unknown> | null | undefined): Set<string> {
  const ids = new Set<string>()
  const collect = (v: unknown) => {
    if (!Array.isArray(v)) return
    for (const f of v.slice(0, 200)) if (isPlainObject(f) && typeof f.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(f.id)) ids.add(f.id)
  }
  collect(value)
  for (const v of Object.values(contextFields ?? {})) collect(v)
  return ids
}

/** The saved report a `reports` control shows: its `report_id` prop (a uuid), else null. */
export function controlReportId(config: Pick<CustomControlFieldConfig, 'props' | 'capabilities'> | null | undefined): string | null {
  if (!config?.capabilities?.includes('reports')) return null
  const id = config.props?.report_id
  return typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id.trim()) ? id.trim().toLowerCase() : null
}
