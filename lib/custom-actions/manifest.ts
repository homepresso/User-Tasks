/**
 * Custom workflow action manifests: validation (parseActionManifest, strict —
 * for uploads, packages and the gallery) and the lenient reading of what is
 * stored on an activity row (actionManifestOf — legacy activities with a
 * top-level `inputs` / `outputs` become one `run` operation).
 *
 * Also the typed-value helpers the engine and the designer share: input
 * coercion and validation against the declared field types, and the output
 * schema the data picker shows.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { SchemaField, SchemaNode } from '@/lib/response-schema'
import { isSemver, normalizeHosts, normalizeIcon } from '@/lib/forms/custom-controls/manifest'
import {
  ACTION_FIELD_TYPES,
  ACTION_LIMITS,
  ACTION_MANIFEST_VERSION,
  type ActionCapabilities,
  type ActionField,
  type ActionFieldType,
  type ActionManifest,
  type ActionOperation,
  type ActionSecretSpec,
} from './contract'

export class ActionManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ActionManifestError'
  }
}

export const ACTION_KEY_RE = /^[a-z][a-z0-9_]{1,62}$/
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/
const OPERATION_ID_RE = /^[a-z][a-z0-9_]{0,62}$/
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Same rule as lib/secret-fields isSensitiveKey (kept here so this module
 * stays client-safe; __tests__/custom-action-manifest checks they agree).
 */
export function looksLikeCredentialName(key: string): boolean {
  const k = key.toLowerCase()
  return k.includes('password') || k.includes('secret') || k.includes('private_key') || k.includes('account_key') || k.includes('service_account')
    || k === 'token' || k.endsWith('_token') || k === 'api_key' || k.endsWith('_api_key') || k === 'key_value' || k === 'webhook_url'
    || k.includes('passphrase') || k === 'connection_string'
}

export function isValidActionKey(key: unknown): key is string {
  return typeof key === 'string' && ACTION_KEY_RE.test(key)
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

function humanize(name: string): string {
  return name.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())
}

function fieldType(value: unknown): ActionFieldType | null {
  const t = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if ((ACTION_FIELD_TYPES as readonly string[]).includes(t)) return t as ActionFieldType
  // Legacy activity manifests used a few other spellings.
  const aliases: Record<string, ActionFieldType> = { list: 'array', any: 'json', float: 'number', int: 'integer', bool: 'boolean', textarea: 'text', enum: 'select' }
  return aliases[t] ?? null
}

/** One field; `strict` throws on problems, otherwise they are repaired or dropped. */
function parseField(raw: unknown, where: string, strict: boolean, depth = 0): ActionField | null {
  const fail = (message: string): null => {
    if (strict) throw new ActionManifestError(`${where}: ${message}`)
    return null
  }
  if (!isPlainObject(raw)) return fail('must be an object')
  const name = String(raw.name ?? raw.key ?? raw.id ?? '').trim()
  if (!FIELD_NAME_RE.test(name)) return fail(`name "${name.slice(0, 40)}" must start with a letter and use letters, digits and underscores (max 64)`)
  const type = fieldType(raw.type ?? 'string')
  if (!type) return fail(`type must be one of ${ACTION_FIELD_TYPES.join(', ')}`)
  // Config as code and packages blank values under credential-looking keys (input mappings, samples): pick another name.
  if (strict && looksLikeCredentialName(name)) return fail(`"${name}" looks like a credential name (password, secret, token, api_key…), which exports and packages blank — rename it (e.g. jwt, signature) and use capabilities.credentials for real secrets`)
  const field: ActionField = { name, type, label: text(raw.label, 120) ?? humanize(name) }
  const description = text(raw.description, 1000)
  if (description) field.description = description
  if (raw.required === true) field.required = true
  const dflt = raw.default !== undefined ? raw.default : raw.defaultValue
  if (dflt !== undefined) field.default = dflt
  if (raw.example !== undefined) field.example = raw.example
  const placeholder = text(raw.placeholder, 200)
  if (placeholder) field.placeholder = placeholder
  if (type === 'select') {
    const options = Array.isArray(raw.options) ? raw.options : Array.isArray(raw.enum) ? raw.enum : []
    field.options = options
      .map((option: unknown) => (isPlainObject(option)
        ? { value: String(option.value ?? ''), ...(text(option.label, 120) ? { label: text(option.label, 120) } : {}) }
        : { value: String(option ?? '') }))
      .filter((option: { value: string }) => option.value !== '')
      .slice(0, 200)
    if (!field.options.length) return fail('a select needs options')
  }
  if (depth < 3) {
    if (type === 'array' && isPlainObject(raw.items)) {
      const itemType = fieldType(raw.items.type ?? 'json')
      if (!itemType) return fail('items.type is not a known type')
      field.items = { type: itemType }
      if (Array.isArray(raw.items.fields)) field.items.fields = parseFields(raw.items.fields, `${where}.items`, strict, depth + 1)
    }
    if (type === 'object' && Array.isArray(raw.fields)) field.fields = parseFields(raw.fields, where, strict, depth + 1)
  }
  return field
}

function parseFields(raw: unknown, where: string, strict: boolean, depth = 0): ActionField[] {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) {
    if (strict) throw new ActionManifestError(`${where} must be a list`)
    return []
  }
  if (raw.length > ACTION_LIMITS.fieldsPerOperation && strict) throw new ActionManifestError(`${where}: at most ${ACTION_LIMITS.fieldsPerOperation} fields`)
  const seen = new Set<string>()
  const out: ActionField[] = []
  raw.slice(0, ACTION_LIMITS.fieldsPerOperation).forEach((entry, index) => {
    const field = parseField(entry, `${where}[${index}]`, strict, depth)
    if (!field) return
    if (seen.has(field.name)) {
      if (strict) throw new ActionManifestError(`${where}: duplicate field "${field.name}"`)
      return
    }
    seen.add(field.name)
    out.push(field)
  })
  return out
}

function parseOperation(raw: unknown, index: number, strict: boolean): ActionOperation | null {
  const where = `operations[${index}]`
  if (!isPlainObject(raw)) {
    if (strict) throw new ActionManifestError(`${where} must be an object`)
    return null
  }
  const id = String(raw.id ?? '').trim()
  if (!OPERATION_ID_RE.test(id)) {
    if (strict) throw new ActionManifestError(`${where}.id "${id.slice(0, 40)}" must be lowercase letters, digits and underscores`)
    return null
  }
  const operation: ActionOperation = {
    id,
    label: text(raw.label, 120) ?? humanize(id),
    inputs: parseFields(raw.inputs, `${where}.inputs`, strict),
    outputs: parseFields(raw.outputs, `${where}.outputs`, strict),
  }
  const description = text(raw.description, 1000)
  if (description) operation.description = description
  if (isPlainObject(raw.sample)) operation.sample = raw.sample
  if (strict && operation.outputs.length === 0) throw new ActionManifestError(`${where} (${id}) declares no outputs`)
  return operation
}

function parseSecrets(raw: unknown, strict: boolean): ActionSecretSpec[] {
  if (!Array.isArray(raw)) return []
  const out: ActionSecretSpec[] = []
  for (const entry of raw.slice(0, 20)) {
    const spec = typeof entry === 'string' ? { name: entry } : isPlainObject(entry) ? entry : null
    const name = String(spec?.name ?? '').trim()
    if (!spec || !ACTION_KEY_RE.test(name)) {
      if (strict) throw new ActionManifestError(`capabilities.credentials: "${name.slice(0, 40)}" must be lowercase letters, digits and underscores`)
      continue
    }
    if (out.some((s) => s.name === name)) continue
    out.push({
      name,
      label: text(spec.label, 120) ?? humanize(name),
      ...(text(spec.description, 500) ? { description: text(spec.description, 500) } : {}),
      ...(spec.required === true ? { required: true } : {}),
    })
  }
  return out
}

function parseCapabilities(raw: unknown, strict: boolean): ActionCapabilities {
  if (!isPlainObject(raw)) return {}
  const caps: ActionCapabilities = {}
  for (const key of Object.keys(raw)) {
    if (strict && key === 'secrets') throw new ActionManifestError('declare secrets as capabilities.credentials (config as code and packages blank anything under a key named like a secret)')
    if (strict && !['http', 'data', 'files', 'credentials'].includes(key)) throw new ActionManifestError(`capabilities.${key} is not a known capability (http, data, files, credentials)`)
  }
  if (raw.http !== undefined && raw.http !== false) {
    const rawHosts = isPlainObject(raw.http) ? raw.http.hosts : undefined
    const hosts = normalizeHosts(rawHosts)
    if (strict && Array.isArray(rawHosts) && hosts.length !== rawHosts.length) throw new ActionManifestError('capabilities.http.hosts: each host is a hostname like api.example.com or *.example.com (no scheme or path)')
    if (strict && hosts.length === 0) throw new ActionManifestError('capabilities.http.hosts must list the hosts the action calls')
    if (hosts.length) caps.http = { hosts }
  }
  if (isPlainObject(raw.data)) {
    const read = raw.data.read === true
    const write = raw.data.write === true
    if (read || write) caps.data = { ...(read ? { read: true } : {}), ...(write ? { write: true } : {}) }
  }
  if (raw.files === true) caps.files = true
  const credentials = parseSecrets(raw.credentials ?? (strict ? undefined : raw.secrets), strict)
  if (credentials.length) caps.credentials = credentials
  return caps
}

export function clampLimits(raw: unknown): { timeout_ms: number; memory_mb: number } {
  const src = isPlainObject(raw) ? raw : {}
  const num = (v: unknown, d: number, lo: number, hi: number) => {
    const n = Number(v)
    return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, Math.round(n))) : d
  }
  return {
    timeout_ms: num(src.timeout_ms, ACTION_LIMITS.defaultTimeoutMs, ACTION_LIMITS.minTimeoutMs, ACTION_LIMITS.maxTimeoutMs),
    memory_mb: num(src.memory_mb, ACTION_LIMITS.defaultMemoryMb, ACTION_LIMITS.minMemoryMb, ACTION_LIMITS.maxMemoryMb),
  }
}

/** Strict validation (uploads, packages, the gallery). Throws ActionManifestError. */
export function parseActionManifest(raw: unknown): ActionManifest {
  let value = raw
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      throw new ActionManifestError('manifest is not valid JSON')
    }
  }
  if (!isPlainObject(value)) throw new ActionManifestError('manifest must be a JSON object')
  if (JSON.stringify(value).length > ACTION_LIMITS.manifestBytes) throw new ActionManifestError(`manifest is larger than ${ACTION_LIMITS.manifestBytes / 1024} KB`)
  if (value.manifest_version !== undefined && value.manifest_version !== ACTION_MANIFEST_VERSION) throw new ActionManifestError(`manifest_version must be ${ACTION_MANIFEST_VERSION}`)
  const key = String(value.key ?? '').trim()
  if (!isValidActionKey(key)) throw new ActionManifestError('key must be 2–63 lowercase letters, digits and underscores, starting with a letter (e.g. acme_math)')
  const name = text(value.name, 120)
  if (!name) throw new ActionManifestError('name is required')
  if (!isSemver(value.version)) throw new ActionManifestError('version must be semver, e.g. 1.0.0')
  if (!Array.isArray(value.operations) || value.operations.length === 0) throw new ActionManifestError('operations must list at least one function')
  if (value.operations.length > ACTION_LIMITS.operations) throw new ActionManifestError(`at most ${ACTION_LIMITS.operations} operations`)
  const operations = value.operations.map((op, index) => parseOperation(op, index, true)!) as ActionOperation[]
  const ids = new Set<string>()
  for (const op of operations) {
    if (ids.has(op.id)) throw new ActionManifestError(`duplicate operation id "${op.id}"`)
    ids.add(op.id)
  }
  if (value.color !== undefined && !(typeof value.color === 'string' && COLOR_RE.test(value.color))) throw new ActionManifestError('color must be #RRGGBB')
  const manifest: ActionManifest = {
    manifest_version: ACTION_MANIFEST_VERSION,
    key,
    name,
    version: value.version as string,
    operations,
    capabilities: parseCapabilities(value.capabilities, true),
    limits: clampLimits(value.limits),
  }
  const optional: Array<[keyof ActionManifest, number]> = [['description', 2000], ['category', 60], ['entry', 200], ['summary', 1000], ['purpose', 500], ['recommended_for', 300], ['author', 200], ['license', 60], ['homepage', 500]]
  for (const [k, max] of optional) {
    const v = text(value[k], max)
    if (v) (manifest as unknown as Record<string, unknown>)[k] = v
  }
  const icon = normalizeIcon(value.icon)
  if (icon) manifest.icon = icon
  if (typeof value.color === 'string') manifest.color = value.color
  if (Array.isArray(value.setup_notes)) manifest.setup_notes = value.setup_notes.map((n) => String(n ?? '').trim()).filter(Boolean).slice(0, 10)
  if (Array.isArray(value.tags)) manifest.tags = value.tags.map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean).slice(0, 20)
  return manifest
}

/** Is this stored manifest a v1 action manifest (vs a legacy activity manifest)? */
export function isActionManifest(raw: unknown): boolean {
  return isPlainObject(raw) && raw.manifest_version === ACTION_MANIFEST_VERSION && Array.isArray(raw.operations)
}

/**
 * The manifest of a stored activity, leniently: a v1 manifest as stored, or
 * a legacy activity manifest (top-level inputs / outputs) as one `run`
 * operation. Never throws.
 */
export function actionManifestOf(activity: { manifest?: unknown; key?: string | null; name?: string | null; version?: string | null; description?: string | null } | null | undefined): ActionManifest {
  const raw = isPlainObject(activity?.manifest) ? activity!.manifest as Record<string, unknown> : {}
  if (isActionManifest(raw)) {
    const operations = (raw.operations as unknown[]).map((op, i) => parseOperation(op, i, false)).filter(Boolean) as ActionOperation[]
    return {
      ...(raw as unknown as ActionManifest),
      operations,
      capabilities: parseCapabilities(raw.capabilities, false),
      limits: clampLimits(raw.limits),
    }
  }
  const key = String(activity?.key ?? '').trim() || 'custom_action'
  return {
    manifest_version: ACTION_MANIFEST_VERSION,
    key,
    name: String(raw.display_name ?? raw.displayName ?? activity?.name ?? key),
    version: String(activity?.version ?? '1.0.0'),
    ...(activity?.description ? { description: activity.description } : {}),
    operations: [{
      id: 'run',
      label: 'Run',
      inputs: parseFields(raw.inputs, 'inputs', false),
      outputs: parseFields(raw.outputs, 'outputs', false),
    }],
    capabilities: {},
    limits: clampLimits(raw.limits),
    ...(typeof raw.summary === 'string' ? { summary: raw.summary } : {}),
    ...(typeof raw.purpose === 'string' ? { purpose: raw.purpose } : {}),
  }
}

/** The operation a node runs: the configured one, else the first. */
export function operationOf(manifest: ActionManifest, operationId: unknown): ActionOperation | null {
  const id = typeof operationId === 'string' ? operationId.trim() : ''
  if (id) return manifest.operations.find((op) => op.id === id) ?? null
  return manifest.operations[0] ?? null
}

// ── Typed values ───────────────────────────────────────────────────────────

/** Coerce a resolved input to its declared type; returns { value } or { error }. */
export function coerceActionValue(field: ActionField, value: unknown): { value: unknown } | { error: string } {
  if (value === undefined || value === null || value === '') return { value: value === '' && (field.type === 'string' || field.type === 'text') ? '' : null }
  const parseJson = (v: unknown) => {
    if (typeof v !== 'string') return v
    const s = v.trim()
    if (!s) return null
    try { return JSON.parse(s) } catch { return undefined }
  }
  switch (field.type) {
    case 'string': case 'text':
      return { value: typeof value === 'string' ? value : typeof value === 'object' ? JSON.stringify(value) : String(value) }
    case 'select': {
      const s = String(value)
      if (field.options?.length && !field.options.some((o) => o.value === s)) return { error: `must be one of ${field.options.map((o) => o.value).join(', ')}` }
      return { value: s }
    }
    case 'number': case 'integer': {
      const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim().replace(/,(?=\d{3}\b)/g, '')) : typeof value === 'boolean' ? Number(value) : NaN
      if (!Number.isFinite(n)) return { error: 'must be a number' }
      if (field.type === 'integer' && !Number.isInteger(n)) return { error: 'must be a whole number' }
      return { value: n }
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { value }
      const s = String(value).trim().toLowerCase()
      if (['true', 'yes', '1', 'on', 'y'].includes(s)) return { value: true }
      if (['false', 'no', '0', 'off', 'n'].includes(s)) return { value: false }
      return { error: 'must be true or false' }
    }
    case 'date': case 'datetime': {
      const s = value instanceof Date ? value.toISOString() : String(value).trim()
      if (Number.isNaN(Date.parse(s.length === 10 ? `${s}T00:00:00Z` : s))) return { error: 'must be a date (YYYY-MM-DD or ISO 8601)' }
      return { value: s }
    }
    case 'array': {
      const v = parseJson(value)
      let list: unknown[] | null = Array.isArray(v) ? v : null
      if (!list && typeof value === 'string' && v === undefined) list = value.split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean)
      if (!list && v !== undefined && v !== null && typeof v !== 'object') list = [v]
      if (!list) return { error: 'must be a list' }
      // Scalar item types are coerced too ("1, 2, 3" → [1, 2, 3] for a list of numbers).
      const itemType = field.items?.type
      if (itemType && ['number', 'integer', 'boolean', 'string'].includes(itemType)) {
        const out: unknown[] = []
        for (const [i, item] of list.entries()) {
          // Structured items stay as they are (the action decides what it accepts).
          if (item !== null && typeof item === 'object') { out.push(item); continue }
          const r = coerceActionValue({ name: `${field.name}[${i}]`, type: itemType }, item)
          if ('error' in r) return { error: `item ${i + 1} ${r.error}` }
          out.push(r.value)
        }
        return { value: out }
      }
      return { value: list }
    }
    case 'object': {
      const v = parseJson(value)
      if (isPlainObject(v)) return { value: v }
      return { error: 'must be an object' }
    }
    case 'json': {
      const v = parseJson(value)
      return { value: v === undefined ? value : v }
    }
    case 'file':
      return { value }
    default:
      return { value }
  }
}

/** Resolve + coerce + check required for an operation's inputs. */
export function prepareActionInputs(operation: ActionOperation, raw: Record<string, unknown>): { inputs: Record<string, unknown>; errors: string[] } {
  const inputs: Record<string, unknown> = {}
  const errors: string[] = []
  for (const field of operation.inputs) {
    let value = raw[field.name]
    if (value === undefined || value === null || value === '') value = field.default ?? value
    const result = coerceActionValue(field, value)
    if ('error' in result) {
      errors.push(`${field.label ?? field.name} ${result.error}`)
      continue
    }
    if (field.required && (result.value === null || result.value === undefined || result.value === '' || (Array.isArray(result.value) && result.value.length === 0 && field.type !== 'array'))) {
      errors.push(`${field.label ?? field.name} is required`)
      continue
    }
    inputs[field.name] = result.value ?? null
  }
  return { inputs, errors }
}

/** Response-schema node (lib/response-schema) for a declared field — the data picker's model. */
export function actionFieldSchema(field: ActionField): SchemaNode {
  const desc = field.description ? { description: field.description } : {}
  const fieldsOf = (fields: ActionField[] | undefined): SchemaField[] => (fields ?? []).map((f) => ({ ...actionFieldSchema(f), name: f.name }))
  switch (field.type) {
    case 'string': case 'text': case 'select': return { type: 'string', ...desc }
    case 'date': return { type: 'string', format: 'date', ...desc }
    case 'datetime': return { type: 'string', format: 'date-time', ...desc }
    case 'number': return { type: 'number', ...desc }
    case 'integer': return { type: 'integer', ...desc }
    case 'boolean': return { type: 'boolean', ...desc }
    case 'object': return { type: 'object', ...desc, ...(field.fields?.length ? { fields: fieldsOf(field.fields) } : {}) }
    case 'array': {
      const item = field.items
      const items: SchemaNode = !item ? { type: 'any' }
        : item.type === 'object' ? { type: 'object', ...(item.fields?.length ? { fields: fieldsOf(item.fields) } : {}) }
          : actionFieldSchema({ name: 'item', type: item.type })
      return { type: 'array', ...desc, items }
    }
    case 'file': return { type: 'object', ...desc, fields: [{ name: 'name', type: 'string' }, { name: 'url', type: 'string' }, { name: 'mime_type', type: 'string' }, { name: 'size', type: 'integer' }] }
    default: return { type: 'any', ...desc }
  }
}

/** Type label for the designer ("number", "list of objects", …). */
export function actionFieldTypeLabel(field: ActionField): string {
  if (field.type === 'array') return field.items ? `list of ${field.items.type === 'object' ? 'objects' : `${field.items.type}s`}` : 'list'
  if (field.type === 'datetime') return 'date & time'
  if (field.type === 'select') return 'choice'
  return field.type
}

/** Check returned outputs against the declared ones: problems are warnings (the values are still kept). */
export function checkActionOutputs(operation: ActionOperation, outputs: Record<string, unknown>): string[] {
  const warnings: string[] = []
  for (const field of operation.outputs) {
    if (!(field.name in outputs)) {
      if (field.required) warnings.push(`did not return required output "${field.name}"`)
      continue
    }
    const value = outputs[field.name]
    if (value === null || value === undefined) continue
    const actual = Array.isArray(value) ? 'array' : typeof value
    const expected: Record<string, string[]> = {
      string: ['string'], text: ['string'], select: ['string'], date: ['string'], datetime: ['string'],
      number: ['number'], integer: ['number'], boolean: ['boolean'], object: ['object'], array: ['array'],
      json: ['string', 'number', 'boolean', 'object', 'array'], file: ['object', 'string'],
    }
    if (!(expected[field.type] ?? []).includes(actual)) warnings.push(`output "${field.name}" should be ${actionFieldTypeLabel(field)} but is ${actual}`)
    else if (field.type === 'integer' && !Number.isInteger(value)) warnings.push(`output "${field.name}" should be a whole number`)
  }
  for (const name of Object.keys(outputs)) {
    if (!operation.outputs.some((f) => f.name === name)) warnings.push(`returned undeclared output "${name}" (kept)`)
  }
  return warnings
}

/**
 * Custom action steps with their function's outputs filled in from the
 * installed action (steps made by an API, a package or before the designer
 * opened them carry no snapshot): what the data picker and the Variables
 * panel read. Other nodes are returned as they are.
 */
export function withActionOutputs<N extends { type: string; config: Record<string, unknown> }>(nodes: N[], activities: Array<{ id: string; key?: string | null; manifest?: unknown; name?: string | null; version?: string | null }>): N[] {
  if (!activities.length) return nodes
  return nodes.map((node) => {
    if (node.type !== 'custom_activity') return node
    const c = (node.config ?? {}) as Record<string, unknown>
    const activity = activities.find((a) => a.id === c.custom_activity_id) ?? activities.find((a) => c.custom_activity_key && a.key === c.custom_activity_key)
    if (!activity) return node
    const operation = operationOf(actionManifestOf(activity), c.operation)
    if (!operation) return node
    return { ...node, config: { ...c, _action_outputs: operation.outputs, operation_label: c.operation_label ?? operation.label } }
  })
}
