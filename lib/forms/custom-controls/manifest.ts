/**
 * Custom form control manifests: parse and validate `manifest.json` into a
 * clean FormControlManifest (lib/forms/custom-controls/contract.ts), and
 * semver helpers for the version list. Unknown keys are dropped; anything
 * that would change what the host does (tag, value type, capabilities,
 * hosts) is validated strictly and refused with a readable message. Pure.
 */

import { isPlainObject } from '@/lib/utils/guards'
import {
  CONTROL_CAPABILITIES, CONTROL_DISPLAY_FORMATS, CONTROL_PROP_TYPES, CONTROL_VALUE_TYPES, FORM_CONTROL_MANIFEST_VERSION,
  PACKAGE_LIMITS, RESERVED_ELEMENT_PROPERTIES,
  type ControlCapability, type ControlContextSpec, type ControlDisplayFormat, type ControlEventSpec, type ControlPropSpec, type ControlPropType,
  type ControlValueType, type FormControlManifest,
} from './contract'
import { normalizeValueSchema, validateAgainstSchema } from './json-schema'
import { parseOutputSpec } from './output'

export class ManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ManifestError'
  }
}

/** Valid custom element name: lowercase, starts with a letter, contains a hyphen, not a reserved SVG/MathML name. */
const TAG_RE = /^[a-z][a-z0-9._]*-[a-z0-9._-]*$/
const RESERVED_TAGS = new Set([
  'annotation-xml', 'color-profile', 'font-face', 'font-face-src', 'font-face-uri', 'font-face-format', 'font-face-name', 'missing-glyph',
])
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const PROP_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const ICON_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const HOST_RE = /^(\*\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(:\d{1,5})?$/
const MAX_ICON_DATA_URI = 8 * 1024

export function isValidTag(tag: unknown): tag is string {
  return typeof tag === 'string' && tag.length <= 100 && TAG_RE.test(tag) && !RESERVED_TAGS.has(tag)
}

export function isSemver(version: unknown): version is string {
  return typeof version === 'string' && version.length <= 64 && SEMVER_RE.test(version)
}

/** Compare two semver strings (-1, 0, 1). Pre-releases sort before their release; build metadata is ignored. */
export function compareSemver(a: string, b: string): number {
  const pa = SEMVER_RE.exec(a)
  const pb = SEMVER_RE.exec(b)
  if (!pa || !pb) return a < b ? -1 : a > b ? 1 : 0
  for (let i = 1; i <= 3; i++) {
    const d = Number(pa[i]) - Number(pb[i])
    if (d) return d < 0 ? -1 : 1
  }
  const ra = pa[4]
  const rb = pb[4]
  if (!ra && !rb) return 0
  if (!ra) return 1
  if (!rb) return -1
  const xa = ra.split('.')
  const xb = rb.split('.')
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined) return -1
    if (xb[i] === undefined) return 1
    const na = /^\d+$/.test(xa[i]) ? Number(xa[i]) : null
    const nb = /^\d+$/.test(xb[i]) ? Number(xb[i]) : null
    if (na !== null && nb !== null && na !== nb) return na < nb ? -1 : 1
    if (na !== null && nb === null) return -1
    if (na === null && nb !== null) return 1
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1
  }
  return 0
}

/** Highest version of a list (null when empty). */
export function latestVersion(versions: string[]): string | null {
  return versions.reduce<string | null>((best, v) => (best === null || compareSemver(v, best) > 0 ? v : best), null)
}

function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  return s ? s.slice(0, max) : undefined
}

/** Icon: a Lucide name in kebab case or a small SVG data URI. */
export function normalizeIcon(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const s = value.trim()
  if (ICON_NAME_RE.test(s) && s.length <= 60) return s
  if (s.startsWith('data:image/svg+xml') && s.length <= MAX_ICON_DATA_URI) return s
  return undefined
}

/** Host allowlist entries: `api.example.com`, `*.example.com`, optional port; lowercase; no schemes or paths. */
export function normalizeHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const entry of raw) {
    const host = String(entry ?? '').trim().toLowerCase()
    if (!HOST_RE.test(host) || out.includes(host) || out.length >= 20) continue
    out.push(host)
  }
  return out
}

function propType(value: unknown): ControlPropType | null {
  return typeof value === 'string' && (CONTROL_PROP_TYPES as readonly string[]).includes(value) ? value as ControlPropType : null
}

/** A prop value coerced to its declared type (undefined when it can't be). */
export function coercePropValue(prop: ControlPropSpec, value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  switch (prop.type) {
    case 'number': {
      const n = typeof value === 'number' ? value : Number(String(value).trim())
      if (!Number.isFinite(n) || String(value).trim() === '') return undefined
      return Math.min(prop.max ?? Infinity, Math.max(prop.min ?? -Infinity, n))
    }
    case 'boolean':
      if (typeof value === 'boolean') return value
      if (value === 'true') return true
      if (value === 'false') return false
      return undefined
    case 'select': {
      const s = String(value)
      return (prop.options ?? []).some((o) => (typeof o === 'string' ? o : o.value) === s) ? s : undefined
    }
    case 'string[]':
      if (Array.isArray(value)) return value.map((v) => String(v ?? '')).filter(Boolean).slice(0, 200)
      if (typeof value === 'string') return value.split(/[\n,]/).map((v) => v.trim()).filter(Boolean).slice(0, 200)
      return undefined
    case 'json':
      try {
        const json = typeof value === 'string' ? JSON.parse(value) : value
        return JSON.stringify(json).length <= 32 * 1024 ? json : undefined
      } catch {
        return undefined
      }
    case 'color': {
      const s = String(value).trim()
      return /^#[0-9a-fA-F]{3,8}$/.test(s) || /^(rgb|hsl)a?\([\d\s.,%/]+\)$/.test(s) ? s : undefined
    }
    default:
      return typeof value === 'string' ? value.slice(0, prop.type === 'text' ? 10_000 : 1000) : String(value).slice(0, 1000)
  }
}

function normalizeProp(raw: unknown, seen: Set<string>): ControlPropSpec {
  if (!isPlainObject(raw)) throw new ManifestError('Each entry of props must be an object')
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!PROP_NAME_RE.test(name)) throw new ManifestError(`Prop name "${name}" must be a JavaScript identifier (letters, digits, underscores)`)
  if (RESERVED_ELEMENT_PROPERTIES.has(name)) throw new ManifestError(`Prop name "${name}" is reserved by the host`)
  if (seen.has(name)) throw new ManifestError(`Prop "${name}" is declared twice`)
  seen.add(name)
  const type = propType(raw.type ?? 'string')
  if (!type) throw new ManifestError(`Prop "${name}" has an unknown type "${String(raw.type)}" (use ${CONTROL_PROP_TYPES.join(', ')})`)
  const prop: ControlPropSpec = { name, type }
  const label = text(raw.label, 120)
  if (label) prop.label = label
  const description = text(raw.description, 500)
  if (description) prop.description = description
  if (type === 'select') {
    const options = Array.isArray(raw.options) ? raw.options : []
    prop.options = options.slice(0, 200).flatMap((o): Array<string | { value: string; label?: string }> => {
      if (typeof o === 'string' && o.trim()) return [o.trim()]
      if (isPlainObject(o) && typeof o.value === 'string' && o.value.trim()) {
        const optionLabel = text(o.label, 120)
        return [optionLabel ? { value: o.value.trim(), label: optionLabel } : { value: o.value.trim() }]
      }
      return []
    })
    if (!prop.options.length) throw new ManifestError(`Prop "${name}" (select) needs options`)
  }
  if (type === 'number') {
    if (typeof raw.min === 'number' && Number.isFinite(raw.min)) prop.min = raw.min
    if (typeof raw.max === 'number' && Number.isFinite(raw.max)) prop.max = raw.max
  }
  if (raw.required === true) prop.required = true
  if (typeof raw.bindable === 'boolean') prop.bindable = raw.bindable
  if (raw.default !== undefined) {
    const value = coercePropValue(prop, raw.default)
    if (value !== undefined) prop.default = value
  }
  return prop
}

function valueType(value: unknown): ControlValueType | null {
  return typeof value === 'string' && (CONTROL_VALUE_TYPES as readonly string[]).includes(value) ? value as ControlValueType : null
}

/** Parse manifest JSON (text or object) into a validated manifest. Throws ManifestError. */
export function parseFormControlManifest(raw: unknown): FormControlManifest {
  let data: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length > PACKAGE_LIMITS.manifestBytes) throw new ManifestError('manifest.json is too large (64 KB at most)')
    try { data = JSON.parse(raw) } catch { throw new ManifestError('manifest.json is not valid JSON') }
  }
  if (!isPlainObject(data)) throw new ManifestError('The manifest must be a JSON object')
  const m = data
  const manifestVersion = m.manifest_version === undefined ? FORM_CONTROL_MANIFEST_VERSION : Number(m.manifest_version)
  if (manifestVersion !== FORM_CONTROL_MANIFEST_VERSION) throw new ManifestError(`manifest_version ${String(m.manifest_version)} is not supported (use ${FORM_CONTROL_MANIFEST_VERSION})`)

  const tag = typeof m.tag === 'string' ? m.tag.trim() : ''
  if (!isValidTag(tag)) throw new ManifestError(`tag "${tag}" is not a valid custom element name (lowercase, starts with a letter, contains a hyphen — e.g. acme-star-rating)`)
  const name = text(m.name, 120)
  if (!name) throw new ManifestError('name is required')
  const version = typeof m.version === 'string' ? m.version.trim() : ''
  if (!isSemver(version)) throw new ManifestError(`version "${version}" is not a semantic version (e.g. 1.0.0)`)

  const rawValue = isPlainObject(m.value) ? m.value : { type: m.value_type }
  const type = valueType(rawValue.type ?? 'string')
  if (!type) throw new ManifestError(`value.type must be one of ${CONTROL_VALUE_TYPES.join(', ')}`)
  let schema
  try {
    schema = normalizeValueSchema(rawValue.schema)
  } catch (e) {
    throw new ManifestError(`value.schema: ${e instanceof Error ? e.message : 'invalid'}`)
  }
  if (schema && JSON.stringify(schema).length > PACKAGE_LIMITS.valueSchemaBytes) throw new ManifestError('value.schema is too large (16 KB at most)')
  const manifest: FormControlManifest = {
    manifest_version: FORM_CONTROL_MANIFEST_VERSION,
    tag,
    name,
    version,
    value: { type },
    props: [],
    events: [],
    validation: {},
    size: {},
    capabilities: [],
    context: [],
  }
  if (schema && Object.keys(schema).length) manifest.value.schema = schema
  if (rawValue.default !== undefined) {
    const problem = schema ? validateAgainstSchema(rawValue.default, schema) : null
    if (problem) throw new ManifestError(`value.default ${problem}`)
    manifest.value.default = rawValue.default
  }
  const description = text(m.description, 2000)
  if (description) manifest.description = description
  const icon = normalizeIcon(m.icon)
  if (icon) manifest.icon = icon
  const entry = text(m.entry, 200)
  if (entry) {
    if (!/^[A-Za-z0-9._/-]+\.m?js$/.test(entry) || entry.includes('..') || entry.startsWith('/')) throw new ManifestError('entry must be a relative .js / .mjs path inside the package')
    manifest.entry = entry
  }

  const props = Array.isArray(m.props) ? m.props : []
  if (props.length > PACKAGE_LIMITS.props) throw new ManifestError(`At most ${PACKAGE_LIMITS.props} props`)
  const seen = new Set<string>()
  manifest.props = props.map((p) => normalizeProp(p, seen))

  manifest.events = (Array.isArray(m.events) ? m.events : []).slice(0, 50).flatMap((e): ControlEventSpec[] => {
    const eventName = isPlainObject(e) ? text(e.name, 80) : text(e, 80)
    if (!eventName) return []
    const eventDescription = isPlainObject(e) ? text(e.description, 500) : undefined
    return [eventDescription ? { name: eventName, description: eventDescription } : { name: eventName }]
  })

  if (isPlainObject(m.validation) && m.validation.reports_validity === true) manifest.validation.reports_validity = true

  if (isPlainObject(m.size)) {
    const size = m.size
    const px = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(2000, Math.max(24, v))) : undefined)
    const def = px(size.default_height)
    const min = px(size.min_height)
    const max = px(size.max_height)
    if (def !== undefined) manifest.size.default_height = def
    if (min !== undefined) manifest.size.min_height = min
    if (max !== undefined) manifest.size.max_height = max
    if (min !== undefined && max !== undefined && min > max) throw new ManifestError('size.min_height is greater than size.max_height')
    if (size.full_width === true) manifest.size.full_width = true
  }

  const capabilities = Array.isArray(m.capabilities) ? m.capabilities : []
  for (const cap of capabilities) {
    if (!(CONTROL_CAPABILITIES as readonly unknown[]).includes(cap)) throw new ManifestError(`Unknown capability "${String(cap)}" (use ${CONTROL_CAPABILITIES.join(', ')})`)
  }
  manifest.capabilities = [...new Set(capabilities as ControlCapability[])]
  if (manifest.capabilities.includes('files') && type !== 'files') throw new ManifestError('The files capability needs value.type "files"')
  if (manifest.capabilities.includes('network')) {
    const hosts = normalizeHosts(isPlainObject(m.network) ? m.network.allowed_hosts : undefined)
    if (!hosts.length) throw new ManifestError('The network capability needs network.allowed_hosts (host names, e.g. api.example.com)')
    manifest.network = { allowed_hosts: hosts }
  }

  const context = Array.isArray(m.context) ? m.context : []
  if (context.length > PACKAGE_LIMITS.context) throw new ManifestError(`At most ${PACKAGE_LIMITS.context} context entries`)
  const contextNames = new Set<string>()
  manifest.context = context.flatMap((c): ControlContextSpec[] => {
    const contextName = isPlainObject(c) ? text(c.name, 64) : text(c, 64)
    if (!contextName || !PROP_NAME_RE.test(contextName) || contextNames.has(contextName)) return []
    contextNames.add(contextName)
    const out: ControlContextSpec = { name: contextName }
    if (isPlainObject(c)) {
      const label = text(c.label, 120)
      const contextDescription = text(c.description, 500)
      if (label) out.label = label
      if (contextDescription) out.description = contextDescription
    }
    return [out]
  })

  if (isPlainObject(m.display)) {
    const template = text(m.display.template, 500)
    const format = typeof m.display.format === 'string' && (CONTROL_DISPLAY_FORMATS as readonly string[]).includes(m.display.format) ? m.display.format as ControlDisplayFormat : undefined
    if (template || format) manifest.display = { ...(template ? { template } : {}), ...(format ? { format } : {}) }
  }
  try {
    const output = parseOutputSpec(m.output, type)
    if (output) manifest.output = output
  } catch (e) {
    throw new ManifestError(e instanceof Error ? e.message : 'output is invalid')
  }
  if (isPlainObject(m.accessibility)) {
    const a = m.accessibility
    const role = text(a.role, 40)
    const keyboard = text(a.keyboard, 500)
    const access: NonNullable<FormControlManifest['accessibility']> = {}
    if (role && /^[a-z]+$/.test(role)) access.role = role
    if (keyboard) access.keyboard = keyboard
    if (typeof a.labelled_by_host === 'boolean') access.labelled_by_host = a.labelled_by_host
    if (Object.keys(access).length) manifest.accessibility = access
  }
  if (isPlainObject(m.dependencies)) {
    const deps: Record<string, string> = {}
    for (const [dep, v] of Object.entries(m.dependencies).slice(0, 100)) {
      const depVersion = text(v, 60)
      if (/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(dep) && depVersion) deps[dep] = depVersion
    }
    if (Object.keys(deps).length) manifest.dependencies = deps
  }
  const author = text(m.author, 200)
  if (author) manifest.author = author
  const license = text(m.license, 60)
  if (license) manifest.license = license
  const homepage = text(m.homepage, 500)
  if (homepage && /^https:\/\//.test(homepage)) manifest.homepage = homepage
  return manifest
}

/** Designer property values cleaned against the manifest (unknown names dropped, defaults applied). */
export function resolveControlProps(manifest: Pick<FormControlManifest, 'props'>, stored: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const prop of manifest.props) {
    const value = stored && Object.prototype.hasOwnProperty.call(stored, prop.name) ? coercePropValue(prop, stored[prop.name]) : undefined
    if (value !== undefined) out[prop.name] = value
    else if (prop.default !== undefined) out[prop.name] = prop.default
  }
  return out
}
