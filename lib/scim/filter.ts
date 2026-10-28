import { ScimError } from './errors'

/**
 * SCIM filters (RFC 7644 §3.4.2.2) and attribute paths (§3.10), shared by
 * list queries and PATCH.
 *
 *   filter    = attrExp / logExp / valuePath / "not" "(" filter ")" / "(" filter ")"
 *   attrExp   = attrPath "pr" / attrPath compareOp compValue
 *   valuePath = attrPath "[" valFilter "]"          (emails[type eq "work"])
 *   compareOp = eq ne co sw ew gt lt ge le          (case-insensitive keywords)
 *
 * "and" binds tighter than "or". Attribute names are case-insensitive;
 * string comparisons are too, except for case-exact attributes (id,
 * externalId, meta.version). Attribute paths may carry a schema URN
 * (urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber);
 * the core schema URNs are optional prefixes.
 */

export const CORE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const CORE_GROUP_SCHEMA = 'urn:ietf:params:scim:schemas:core:2.0:Group'
export const ENTERPRISE_USER_SCHEMA = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'

const CORE_SCHEMAS = [CORE_USER_SCHEMA, CORE_GROUP_SCHEMA].map((s) => s.toLowerCase())
const CASE_EXACT = new Set(['id', 'externalid', 'meta.version'])

export interface AttrPath {
  /** Extension schema URN (null: core schema). */
  urn: string | null
  attr: string
  sub: string | null
}

export type CompareOp = 'eq' | 'ne' | 'co' | 'sw' | 'ew' | 'gt' | 'lt' | 'ge' | 'le'
type Value = string | number | boolean | null

export type ScimFilter =
  | { kind: 'and' | 'or'; left: ScimFilter; right: ScimFilter }
  | { kind: 'not'; filter: ScimFilter }
  | { kind: 'compare'; path: AttrPath; op: CompareOp; value: Value }
  | { kind: 'present'; path: AttrPath }
  | { kind: 'valuePath'; path: AttrPath; filter: ScimFilter }

const COMPARE_OPS = new Set(['eq', 'ne', 'co', 'sw', 'ew', 'gt', 'lt', 'ge', 'le'])
const MAX_FILTER_LENGTH = 4096
const MAX_DEPTH = 32

/** `name.givenName`, `urn:…:User:manager.value` → parts. */
export function parseAttrPath(raw: string): AttrPath {
  let text = raw.trim()
  if (!text) throw ScimError.badRequest('Empty attribute path', 'invalidPath')
  let urn: string | null = null
  if (/^urn:/i.test(text)) {
    const colon = text.lastIndexOf(':')
    urn = text.slice(0, colon)
    text = text.slice(colon + 1)
    if (CORE_SCHEMAS.includes(urn.toLowerCase())) urn = null
    if (!text) throw ScimError.badRequest(`Invalid attribute path "${raw}"`, 'invalidPath')
  }
  const [attr, sub, ...rest] = text.split('.')
  if (rest.length > 0 || !/^[A-Za-z$][\w$-]*$/.test(attr) || (sub !== undefined && !/^[A-Za-z$][\w$-]*$/.test(sub))) {
    throw ScimError.badRequest(`Invalid attribute path "${raw}"`, 'invalidPath')
  }
  return { urn, attr, sub: sub ?? null }
}

export function attrPathKey(path: AttrPath): string {
  return `${path.urn ? `${path.urn.toLowerCase()}:` : ''}${path.attr.toLowerCase()}${path.sub ? `.${path.sub.toLowerCase()}` : ''}`
}

// ── Tokenizer ────────────────────────────────────────────────────────────────

type Token =
  | { t: 'word'; v: string }
  | { t: 'string'; v: string }
  | { t: '(' | ')' | '[' | ']' }

function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    const ch = input[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '(' || ch === ')' || ch === '[' || ch === ']') { tokens.push({ t: ch }); i++; continue }
    if (ch === '"') {
      let j = i + 1
      let escaped = false
      for (; j < input.length; j++) {
        if (escaped) { escaped = false; continue }
        if (input[j] === '\\') { escaped = true; continue }
        if (input[j] === '"') break
      }
      if (j >= input.length) throw ScimError.badRequest('Unterminated string in filter', 'invalidFilter')
      try {
        tokens.push({ t: 'string', v: JSON.parse(input.slice(i, j + 1)) as string })
      } catch {
        throw ScimError.badRequest('Invalid string in filter', 'invalidFilter')
      }
      i = j + 1
      continue
    }
    let j = i
    while (j < input.length && !/[\s()[\]"]/.test(input[j])) j++
    if (j === i) throw ScimError.badRequest(`Unexpected character "${ch}" in filter`, 'invalidFilter')
    tokens.push({ t: 'word', v: input.slice(i, j) })
    i = j
  }
  return tokens
}

// ── Parser ───────────────────────────────────────────────────────────────────

export function parseFilter(input: string): ScimFilter {
  if (input.length > MAX_FILTER_LENGTH) throw new ScimError(400, 'Filter is too long', 'invalidFilter')
  const tokens = tokenize(input)
  let pos = 0
  let depth = 0
  const peek = () => tokens[pos]
  const isWord = (tok: Token | undefined, word: string) => tok?.t === 'word' && tok.v.toLowerCase() === word

  const expect = (type: Token['t']) => {
    const tok = tokens[pos++]
    if (!tok || tok.t !== type) throw ScimError.badRequest(`Expected "${type}" in filter`, 'invalidFilter')
    return tok
  }

  function parseOr(): ScimFilter {
    let left = parseAnd()
    while (isWord(peek(), 'or')) { pos++; left = { kind: 'or', left, right: parseAnd() } }
    return left
  }

  function parseAnd(): ScimFilter {
    let left = parseUnary()
    while (isWord(peek(), 'and')) { pos++; left = { kind: 'and', left, right: parseUnary() } }
    return left
  }

  function parseUnary(): ScimFilter {
    if (++depth > MAX_DEPTH) throw ScimError.badRequest('Filter is nested too deeply', 'invalidFilter')
    try {
      const tok = peek()
      if (!tok) throw ScimError.badRequest('Incomplete filter', 'invalidFilter')
      if (isWord(tok, 'not') && tokens[pos + 1]?.t === '(') {
        pos++
        expect('(')
        const inner = parseOr()
        expect(')')
        return { kind: 'not', filter: inner }
      }
      if (tok.t === '(') {
        pos++
        const inner = parseOr()
        expect(')')
        return inner
      }
      if (tok.t !== 'word') throw ScimError.badRequest('Expected an attribute in filter', 'invalidFilter')
      pos++
      const path = parseAttrPathOrFilterError(tok.v)
      if (peek()?.t === '[') {
        pos++
        const inner = parseOr()
        expect(']')
        return { kind: 'valuePath', path, filter: inner }
      }
      const opTok = tokens[pos++]
      if (!opTok || opTok.t !== 'word') throw ScimError.badRequest(`Expected an operator after "${tok.v}"`, 'invalidFilter')
      const op = opTok.v.toLowerCase()
      if (op === 'pr') return { kind: 'present', path }
      if (!COMPARE_OPS.has(op)) throw ScimError.badRequest(`Unknown operator "${opTok.v}"`, 'invalidFilter')
      const valueTok = tokens[pos++]
      if (!valueTok) throw ScimError.badRequest(`Missing value after "${opTok.v}"`, 'invalidFilter')
      return { kind: 'compare', path, op: op as CompareOp, value: literal(valueTok) }
    } finally {
      depth--
    }
  }

  const filter = parseOr()
  if (pos !== tokens.length) throw ScimError.badRequest('Unexpected input after the filter', 'invalidFilter')
  return filter
}

function parseAttrPathOrFilterError(raw: string): AttrPath {
  try {
    return parseAttrPath(raw)
  } catch {
    throw ScimError.badRequest(`Invalid attribute "${raw}" in filter`, 'invalidFilter')
  }
}

function literal(tok: Token): Value {
  if (tok.t === 'string') return tok.v
  if (tok.t !== 'word') throw ScimError.badRequest('Expected a value in filter', 'invalidFilter')
  const lower = tok.v.toLowerCase()
  if (lower === 'true') return true
  if (lower === 'false') return false
  if (lower === 'null') return null
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(tok.v)) return Number(tok.v)
  throw ScimError.badRequest(`Invalid value "${tok.v}" in filter`, 'invalidFilter')
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/** Case-insensitive property read. */
export function getProp(obj: unknown, name: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined
  const record = obj as Record<string, unknown>
  if (name in record) return record[name]
  const lower = name.toLowerCase()
  const key = Object.keys(record).find((k) => k.toLowerCase() === lower)
  return key === undefined ? undefined : record[key]
}

/** The container holding `path.attr` (the resource, or its extension object). */
export function containerFor(resource: Record<string, unknown>, path: AttrPath): unknown {
  return path.urn ? getProp(resource, path.urn) : resource
}

/** Values at a path, flattened over multi-valued attributes. */
function valuesAt(resource: Record<string, unknown>, path: AttrPath): unknown[] {
  const top = getProp(containerFor(resource, path), path.attr)
  if (top === undefined || top === null) return []
  const items = Array.isArray(top) ? top : [top]
  if (path.sub) return items.map((item) => getProp(item, path.sub!)).filter((v) => v !== undefined && v !== null)
  // A complex multi-valued attribute compared directly means its `value`.
  return items.map((item) => (item && typeof item === 'object' && !Array.isArray(item) ? getProp(item, 'value') : item))
    .filter((v) => v !== undefined && v !== null)
}

function compareOne(actual: unknown, op: CompareOp, expected: Value, caseExact: boolean): boolean {
  if (expected === null) return op === 'ne' ? actual !== null && actual !== undefined : false
  if (typeof expected === 'boolean') {
    const a = typeof actual === 'string' ? actual.toLowerCase() === 'true' : Boolean(actual)
    if (op === 'eq') return a === expected
    if (op === 'ne') return a !== expected
    return false
  }
  if (typeof expected === 'number') {
    const a = Number(actual)
    if (!Number.isFinite(a)) return op === 'ne'
    switch (op) {
      case 'eq': return a === expected
      case 'ne': return a !== expected
      case 'gt': return a > expected
      case 'ge': return a >= expected
      case 'lt': return a < expected
      case 'le': return a <= expected
      default: return false
    }
  }
  if (typeof actual !== 'string' && typeof actual !== 'number' && typeof actual !== 'boolean') return op === 'ne'
  let a = String(actual)
  let e = expected
  if (!caseExact) { a = a.toLowerCase(); e = e.toLowerCase() }
  switch (op) {
    case 'eq': return a === e
    case 'ne': return a !== e
    case 'co': return a.includes(e)
    case 'sw': return a.startsWith(e)
    case 'ew': return a.endsWith(e)
    case 'gt': return a > e
    case 'ge': return a >= e
    case 'lt': return a < e
    case 'le': return a <= e
  }
}

export function matchesFilter(resource: Record<string, unknown>, filter: ScimFilter): boolean {
  switch (filter.kind) {
    case 'and': return matchesFilter(resource, filter.left) && matchesFilter(resource, filter.right)
    case 'or': return matchesFilter(resource, filter.left) || matchesFilter(resource, filter.right)
    case 'not': return !matchesFilter(resource, filter.filter)
    case 'present': {
      const values = valuesAt(resource, filter.path)
      return values.some((v) => v !== '' && !(Array.isArray(v) && v.length === 0))
    }
    case 'compare': {
      const values = valuesAt(resource, filter.path)
      const caseExact = !filter.path.urn && CASE_EXACT.has(`${filter.path.attr.toLowerCase()}${filter.path.sub ? `.${filter.path.sub.toLowerCase()}` : ''}`)
      if (filter.op === 'ne') return values.length === 0 || values.every((v) => compareOne(v, 'ne', filter.value, caseExact))
      return values.some((v) => compareOne(v, filter.op, filter.value, caseExact))
    }
    case 'valuePath': {
      const top = getProp(containerFor(resource, filter.path), filter.path.attr)
      const items = Array.isArray(top) ? top : top === undefined || top === null ? [] : [top]
      return items.some((item) => item && typeof item === 'object' && matchesFilter(item as Record<string, unknown>, filter.filter))
    }
  }
}

/**
 * An equality on a top-level attribute the store can look up directly
 * (userName, externalId, id, displayName, …), found at the filter's root or
 * in an AND branch. The full filter is still evaluated on the candidates.
 */
export function indexableEquality(filter: ScimFilter, attributes: readonly string[]): { attr: string; value: string } | null {
  if (filter.kind === 'compare' && filter.op === 'eq' && !filter.path.urn && !filter.path.sub && typeof filter.value === 'string') {
    const attr = attributes.find((a) => a.toLowerCase() === filter.path.attr.toLowerCase())
    return attr ? { attr, value: filter.value } : null
  }
  if (filter.kind === 'and') return indexableEquality(filter.left, attributes) ?? indexableEquality(filter.right, attributes)
  return null
}
