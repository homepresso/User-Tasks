/**
 * A small, safe JSON Schema subset for custom form control values: what a
 * control's manifest may declare in `value.schema` and what the server
 * enforces on every submission (never trusting the control or the browser).
 *
 * Supported: type (incl. integer and type lists), enum, const, minimum,
 * maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, minLength,
 * maxLength, pattern (safe-regex checked), format (date, date-time, email,
 * uri), items, minItems, maxItems, uniqueItems, properties, required,
 * additionalProperties, plus title / description (ignored). Unknown keywords
 * are dropped by normalizeValueSchema, so a schema never means more than it
 * says. Depth and size are bounded. Pure.
 */

import { compileUserRegex, MAX_REGEX_PATTERN_LENGTH } from '@/lib/safe-regex'
import { isPlainObject } from '@/lib/utils/guards'
import type { ControlValueSchema } from './contract'

const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'] as const
type SchemaType = (typeof TYPES)[number]
const FORMATS = ['date', 'date-time', 'email', 'uri'] as const
const MAX_DEPTH = 8
const MAX_ENUM = 500
const MAX_PROPERTIES = 200

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function nonNeg(value: unknown): number | undefined {
  const n = num(value)
  return n !== undefined && n >= 0 ? Math.floor(n) : undefined
}

/**
 * Clean a declared schema: unknown keywords dropped, numbers checked, the
 * pattern compiled with the safe-regex rules. Throws on a pattern that is
 * not allowed (the manifest is refused with that message).
 */
export function normalizeValueSchema(raw: unknown, depth = 0): ControlValueSchema | undefined {
  if (!isPlainObject(raw) || depth > MAX_DEPTH) return undefined
  const out: ControlValueSchema = {}
  if (typeof raw.type === 'string' && (TYPES as readonly string[]).includes(raw.type)) out.type = raw.type as SchemaType
  else if (Array.isArray(raw.type)) {
    const list = raw.type.filter((t): t is SchemaType => typeof t === 'string' && (TYPES as readonly string[]).includes(t))
    if (list.length) out.type = [...new Set(list)]
  }
  if (Array.isArray(raw.enum)) out.enum = raw.enum.slice(0, MAX_ENUM)
  if ('const' in raw) out.const = raw.const
  for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum'] as const) {
    const n = num(raw[key])
    if (n !== undefined) out[key] = n
  }
  const multipleOf = num(raw.multipleOf)
  if (multipleOf !== undefined && multipleOf > 0) out.multipleOf = multipleOf
  for (const key of ['minLength', 'maxLength', 'minItems', 'maxItems'] as const) {
    const n = nonNeg(raw[key])
    if (n !== undefined) out[key] = n
  }
  if (typeof raw.pattern === 'string' && raw.pattern) {
    if (raw.pattern.length > MAX_REGEX_PATTERN_LENGTH) throw new Error('value.schema.pattern is too long')
    compileUserRegex(raw.pattern)
    out.pattern = raw.pattern
  }
  if (typeof raw.format === 'string' && (FORMATS as readonly string[]).includes(raw.format)) out.format = raw.format as ControlValueSchema['format']
  if (raw.uniqueItems === true) out.uniqueItems = true
  const items = normalizeValueSchema(raw.items, depth + 1)
  if (items) out.items = items
  if (isPlainObject(raw.properties)) {
    const props: Record<string, ControlValueSchema> = {}
    for (const [name, sub] of Object.entries(raw.properties).slice(0, MAX_PROPERTIES)) {
      if (name === '__proto__' || name === 'constructor' || name === 'prototype') continue
      const clean = normalizeValueSchema(sub, depth + 1)
      if (clean) props[name] = clean
    }
    out.properties = props
  }
  if (Array.isArray(raw.required)) out.required = raw.required.filter((r): r is string => typeof r === 'string').slice(0, MAX_PROPERTIES)
  if (typeof raw.additionalProperties === 'boolean') out.additionalProperties = raw.additionalProperties
  else {
    const additional = normalizeValueSchema(raw.additionalProperties, depth + 1)
    if (additional) out.additionalProperties = additional
  }
  if (typeof raw.title === 'string') out.title = raw.title.slice(0, 200)
  if (typeof raw.description === 'string') out.description = raw.description.slice(0, 1000)
  return out
}

function typeOf(value: unknown): SchemaType {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  if (typeof value === 'string' || typeof value === 'boolean') return value === true || value === false ? 'boolean' : 'string'
  return 'object'
}

function matchesType(value: unknown, type: SchemaType): boolean {
  const actual = typeOf(value)
  if (type === 'number') return actual === 'number' || actual === 'integer'
  return actual === type
}

/** Stable JSON for equality (enum, const, uniqueItems). */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`
  return JSON.stringify(value) ?? 'undefined'
}

function validDate(s: string, withTime: boolean): boolean {
  if (!(withTime ? DATE_TIME_RE : DATE_RE).test(s)) return false
  return !Number.isNaN(new Date(withTime ? s : `${s}T00:00:00Z`).getTime())
}

/**
 * Validate `value` against `schema`. Returns the first problem as a short
 * message with its path (`items[2]: must be at most 5`), or null.
 */
export function validateAgainstSchema(value: unknown, schema: ControlValueSchema | undefined, path = '', depth = 0): string | null {
  if (!schema || depth > MAX_DEPTH) return null
  const at = (message: string) => (path ? `${path}: ${message}` : message)
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some((t) => matchesType(value, t))) return at(`must be ${types.join(' or ')}`)
  }
  if (schema.const !== undefined && canonical(value) !== canonical(schema.const)) return at('has an unexpected value')
  if (schema.enum && !schema.enum.some((option) => canonical(option) === canonical(value))) {
    return at(`must be one of: ${schema.enum.slice(0, 10).map((o) => (typeof o === 'string' ? o : JSON.stringify(o))).join(', ')}`)
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) return at(`must be at least ${schema.minimum}`)
    if (schema.maximum !== undefined && value > schema.maximum) return at(`must be at most ${schema.maximum}`)
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) return at(`must be greater than ${schema.exclusiveMinimum}`)
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) return at(`must be less than ${schema.exclusiveMaximum}`)
    if (schema.multipleOf !== undefined) {
      const ratio = value / schema.multipleOf
      if (Math.abs(ratio - Math.round(ratio)) > 1e-9) return at(`must be a multiple of ${schema.multipleOf}`)
    }
  }
  if (typeof value === 'string') {
    const length = [...value].length
    if (schema.minLength !== undefined && length < schema.minLength) return at(`must be at least ${schema.minLength} characters`)
    if (schema.maxLength !== undefined && length > schema.maxLength) return at(`must be at most ${schema.maxLength} characters`)
    if (schema.pattern) {
      let re: RegExp | null = null
      try { re = compileUserRegex(schema.pattern) } catch { re = null }
      if (re && !re.test(value)) return at('is not in the expected format')
    }
    if (schema.format === 'date' && !validDate(value, false)) return at('must be a date (YYYY-MM-DD)')
    if (schema.format === 'date-time' && !validDate(value, true)) return at('must be a date and time (ISO 8601)')
    if (schema.format === 'email' && !EMAIL_RE.test(value)) return at('must be an email address')
    if (schema.format === 'uri') {
      try {
        const url = new URL(value)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return at('must be an http(s) URL')
      } catch {
        return at('must be a URL')
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return at(`must have at least ${schema.minItems} items`)
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return at(`must have at most ${schema.maxItems} items`)
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) return at('must not repeat items')
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const problem = validateAgainstSchema(value[i], schema.items, `${path}[${i}]`, depth + 1)
        if (problem) return problem
      }
    }
  }
  if (isPlainObject(value)) {
    for (const name of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, name) || value[name] === undefined) return at(`${name} is required`)
    }
    const props = schema.properties ?? {}
    for (const [name, sub] of Object.entries(value)) {
      const child = path ? `${path}.${name}` : name
      if (Object.prototype.hasOwnProperty.call(props, name)) {
        const problem = validateAgainstSchema(sub, props[name], child, depth + 1)
        if (problem) return problem
      } else if (schema.additionalProperties === false) {
        return `${child}: is not allowed`
      } else if (isPlainObject(schema.additionalProperties)) {
        const problem = validateAgainstSchema(sub, schema.additionalProperties, child, depth + 1)
        if (problem) return problem
      }
    }
  }
  return null
}
