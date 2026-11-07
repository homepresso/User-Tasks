import { isFileRef, referenceInputText } from '@/lib/reference-input-utils'

/**
 * Renders reference request templates ({{input}} placeholders) with the
 * escaping each position needs, so an input value can never change the
 * request's structure:
 *
 *  - path segments: percent-encoded per segment ('/' kept so multi-segment
 *    inputs such as folder paths or object keys still work); '.' / '..'
 *    segments are refused (no traversal to other API resources).
 *  - query string (after '?'): values percent-encoded, so '&', '=', '#' or
 *    '+' inside a value stay data. A `name={{input}}` pair whose
 *    placeholders all resolve empty is dropped instead of sending `name=`.
 *    A bare `{{input}}` piece is a caller-supplied query string: it is
 *    re-serialised pair by pair.
 *  - JSON bodies: string values are JSON-escaped inside string literals;
 *    unquoted placeholders get a JSON literal (number, boolean, object,
 *    array, null or a quoted string) — never raw text that could break or
 *    extend the document.
 *  - form-urlencoded bodies: like the query string.
 *  - XML bodies: XML-escaped.
 *  - header values: CR/LF removed (no header injection).
 */

export type TemplateValues = Record<string, unknown>

const PLACEHOLDER_RE = /\{\{(\w+)\}\}/g

export class TemplateInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TemplateInputError'
  }
}

export function templateMentions(template: unknown, name: string): boolean {
  return typeof template === 'string' && template.includes(`{{${name}}}`)
}

function has(values: TemplateValues, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(values, name)
}

function text(value: unknown): string {
  return referenceInputText(value)
}

// RFC 3986 pchar keeps sub-delims, ':' and '@' literal in a path segment.
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%(3A|40|21|24|26|27|28|29|2A|2B|2C|3B|3D)/gi, (m) => decodeURIComponent(m))
}

/** A value for a query/form position: every delimiter encoded, a few harmless characters kept readable. */
export function encodeQueryValue(value: string): string {
  return encodeURIComponent(value).replace(/%(2C|3A|2F|40|24|28|29|27|2A|21)/gi, (m) => decodeURIComponent(m))
}

function encodePathValue(name: string, value: unknown, encode: boolean): string {
  const raw = text(value)
  return raw.split('/').map((segment) => {
    if (segment === '.' || segment === '..') {
      throw new TemplateInputError(`Input "${name}" contains a relative path segment ("${segment}"), which is not allowed`)
    }
    if (!encode && /[?#]/.test(segment)) {
      throw new TemplateInputError(`Input "${name}" contains "?" or "#", which is not allowed in a path`)
    }
    return encode ? encodePathSegment(segment) : segment
  }).join('/')
}

function safeDecode(value: string): string {
  try { return decodeURIComponent(value.replace(/\+/g, '%20')) } catch { return value }
}

/** Re-serialise a caller-supplied query string (`a=1&b=x y`) with proper encoding. */
function normaliseQueryString(raw: string): string {
  return raw.replace(/^[?&]+/, '').split('&').filter(Boolean).map((pair) => {
    const eq = pair.indexOf('=')
    if (eq < 0) return encodeQueryValue(safeDecode(pair))
    return `${encodeQueryValue(safeDecode(pair.slice(0, eq)))}=${encodeQueryValue(safeDecode(pair.slice(eq + 1)))}`
  }).join('&')
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** Render `a=1&b={{x}}&{{raw}}` — shared by the URL query and form bodies. */
function renderPairs(template: string, values: TemplateValues): string {
  const out: string[] = []
  for (const piece of template.split('&')) {
    if (!piece) continue
    const names = [...piece.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((n) => has(values, n))
    if (names.length === 0) { out.push(piece); continue }
    const whole = /^\{\{(\w+)\}\}$/.exec(piece)
    if (whole && has(values, whole[1])) {
      const raw = text(values[whole[1]])
      if (raw.trim()) out.push(normaliseQueryString(raw))
      continue
    }
    const eq = piece.indexOf('=')
    const key = eq < 0 ? piece : piece.slice(0, eq)
    const valueTemplate = eq < 0 ? '' : piece.slice(eq + 1)
    const valueNames = [...valueTemplate.matchAll(PLACEHOLDER_RE)].map((m) => m[1]).filter((n) => has(values, n))
    const onlyPlaceholders = valueTemplate.replace(PLACEHOLDER_RE, '').trim() === ''
    if (valueNames.length > 0 && onlyPlaceholders && valueNames.every((n) => isEmpty(values[n]))) continue
    const sub = (s: string) => s.replace(PLACEHOLDER_RE, (m, n) => (has(values, n) ? encodeQueryValue(text(values[n])) : m))
    out.push(eq < 0 ? sub(key) : `${sub(key)}=${sub(valueTemplate)}`)
  }
  return out.join('&')
}

/**
 * Path template (with optional query part) → URL path + query.
 * `encodePath: false` leaves path values unencoded (still traversal-checked)
 * for executors that sign and encode the path themselves (S3 SigV4).
 */
export function renderPathTemplate(template: string, values: TemplateValues, options: { encodePath?: boolean } = {}): string {
  if (!template) return ''
  const encode = options.encodePath !== false
  const q = template.indexOf('?')
  const pathPart = q < 0 ? template : template.slice(0, q)
  const queryPart = q < 0 ? null : template.slice(q + 1)
  const path = pathPart.replace(PLACEHOLDER_RE, (m, name) => (has(values, name) ? encodePathValue(name, values[name], encode) : m))
  if (queryPart === null) return path
  const query = renderPairs(queryPart, values)
  return query ? `${path}?${query}` : path
}

/**
 * Header value: placeholders as text, CR/LF stripped. A JSON header template
 * (Dropbox-API-Arg and similar: starts with '{' or '[') is rendered like a
 * JSON body — values escaped, so a path cannot add fields — with non-ASCII
 * escaped as \uXXXX (HTTP header values must be ASCII).
 */
export function renderHeaderTemplate(template: string, values: TemplateValues, types?: Record<string, string>): string {
  if (/^\s*[[{]/.test(template)) {
    const json = renderJsonBody(template, values, types)
    return json.replace(/[\u007f-\uffff]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`).replace(/[\r\n]+/g, ' ')
  }
  return template.replace(PLACEHOLDER_RE, (m, name) => (has(values, name) ? text(values[name]) : m)).replace(/[\r\n]+/g, ' ')
}

export function stripHeaderBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ')
}

function jsonLiteral(value: unknown): string {
  if (value === undefined || value === null) return 'null'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null'
  if (typeof value === 'boolean') return String(value)
  if (isFileRef(value)) return JSON.stringify(text(value))
  if (typeof value === 'object') return text(value)
  const s = String(value)
  const trimmed = s.trim()
  if (trimmed === '') return 'null'
  // Text that already is a JSON value (a number, true, an array…) keeps its
  // type, as the template author expects for `"limit": {{limit}}`.
  try { JSON.parse(trimmed); return trimmed } catch { return JSON.stringify(s) }
}

// Marks an unquoted placeholder that resolved empty: its object member is
// dropped (many APIs reject null for optional fields); in an array it is null.
const OMIT = '\u0000omit\u0000'

function dropOmitted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === OMIT ? null : dropOmitted(v)))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) if (v !== OMIT) out[k] = dropOmitted(v)
    return out
  }
  return value
}

/** Declared input types that must stay JSON strings when written unquoted. */
const STRING_TYPES = new Set(['string', 'text', 'textarea', 'email', 'url', 'date', 'datetime', 'time', 'phone', 'id', 'select'])

function renderJsonBody(template: string, values: TemplateValues, types?: Record<string, string>): string {
  const rendered = renderJsonBodyRaw(template, values, types)
  const marker = JSON.stringify(OMIT)
  if (!rendered.includes(marker)) return rendered
  try {
    return JSON.stringify(dropOmitted(JSON.parse(rendered)))
  } catch {
    return rendered.split(marker).join('null')
  }
}

function renderJsonBodyRaw(template: string, values: TemplateValues, types?: Record<string, string>): string {
  // Whole body is one placeholder: the caller supplies the document.
  const whole = /^\s*\{\{(\w+)\}\}\s*$/.exec(template)
  if (whole && has(values, whole[1])) {
    const v = values[whole[1]]
    if (isFileRef(v)) return text(v)
    if (v !== null && typeof v === 'object') return JSON.stringify(v)
    return text(v)
  }
  let out = ''
  let inString = false
  let i = 0
  while (i < template.length) {
    const ch = template[i]
    if (ch === '{' && template[i + 1] === '{') {
      const m = /^\{\{(\w+)\}\}/.exec(template.slice(i))
      if (m && has(values, m[1])) {
        const v = values[m[1]]
        const token = m[0]
        if (inString) {
          const wholeString = template[i - 1] === '"' && template[i + token.length] === '"'
          if (wholeString && v !== null && typeof v === 'object' && !isFileRef(v)) {
            // "{{obj}}" with an object/array value: the field holds the JSON value itself.
            out = out.slice(0, -1) + JSON.stringify(v)
            i += token.length + 1
            inString = false
            continue
          }
          out += JSON.stringify(text(v)).slice(1, -1)
        } else {
          const declared = types?.[m[1]]?.toLowerCase()
          out += isEmpty(v)
            ? JSON.stringify(OMIT)
            : declared && STRING_TYPES.has(declared) && typeof v === 'string'
              ? JSON.stringify(v)
              : jsonLiteral(v)
        }
        i += token.length
        continue
      }
    }
    if (inString && ch === '\\') { out += ch + (template[i + 1] ?? ''); i += 2; continue }
    if (ch === '"') inString = !inString
    out += ch
    i++
  }
  return out
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

export type BodyKind = 'json' | 'form' | 'xml' | 'text'

export function bodyKindFor(contentType: string | undefined, template: string): BodyKind {
  const ct = String(contentType ?? '').toLowerCase()
  if (ct.includes('x-www-form-urlencoded')) return 'form'
  // Multipart uploads described as JSON (file part + metadata) are rendered as JSON.
  if (ct.startsWith('multipart/') && /^\s*\{/.test(template)) return 'json'
  if (ct.includes('json')) return 'json'
  if (ct.includes('xml') || ct.includes('soap')) return 'xml'
  if (!ct && /^\s*[[{]/.test(template)) return 'json'
  return 'text'
}

/**
 * Body template → body text for the given content type. `types` (input name
 * → declared type) makes unquoted JSON placeholders type-aware: a string
 * input stays a JSON string ("123" is not turned into 123). Connector
 * templates opt in (request_config.typed_placeholders); hand-built
 * references keep the untyped behaviour.
 */
export function renderBodyTemplate(template: string, values: TemplateValues, contentType?: string, types?: Record<string, string>): string {
  if (!template) return template
  switch (bodyKindFor(contentType, template)) {
    case 'json': return renderJsonBody(template, values, types)
    case 'form': return renderPairs(template, values)
    case 'xml': {
      const whole = /^\s*\{\{(\w+)\}\}\s*$/.exec(template)
      if (whole && has(values, whole[1])) return text(values[whole[1]])
      return template.replace(PLACEHOLDER_RE, (m, name) => (has(values, name) ? xmlEscape(text(values[name])) : m))
    }
    default:
      return template.replace(PLACEHOLDER_RE, (m, name) => (has(values, name) ? text(values[name]) : m))
  }
}
