import { ScimError } from './errors'
import {
  CORE_GROUP_SCHEMA,
  CORE_USER_SCHEMA,
  getProp,
  matchesFilter,
  parseAttrPath,
  parseFilter,
  type AttrPath,
  type ScimFilter,
} from './filter'

/**
 * SCIM PATCH (RFC 7644 §3.5.2) applied to a resource's JSON. Handles what
 * Microsoft Entra ID and Okta actually send, not only the RFC's examples:
 *
 *  - op names in any case ("Replace", "Add", "remove");
 *  - no path + an object value whose keys are attributes or full paths
 *    ({"active": false}, {"name.givenName": "Ada"}, {"urn:…:User:department": "R&D"});
 *  - booleans as strings ("True" / "False") for active and primary;
 *  - value filters: emails[type eq "work"].value — replace/add on a filter
 *    that matches nothing creates the element ({type: "work", value});
 *  - members: add [{value}] (deduplicated), remove with a value array and
 *    path "members" (Entra) or path members[value eq "…"] (Okta, RFC);
 *  - read-only attributes (id, meta, schemas, groups) are ignored.
 */

export const PATCH_OP_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'

type Json = Record<string, unknown>
export interface PatchOperation { op: 'add' | 'replace' | 'remove'; path: string | null; value: unknown }

const READ_ONLY = new Set(['id', 'meta', 'schemas', 'groups'])
const BOOLEAN_ATTRS = new Set(['active', 'primary'])
const MAX_OPERATIONS = 1000
const CORE_SCHEMA_URNS = [CORE_USER_SCHEMA, CORE_GROUP_SCHEMA].map((s) => s.toLowerCase())

/** A schema URN itself (…:2.0:User), as opposed to an attribute in one (…:2.0:User:department). */
function isSchemaUrn(name: string): boolean {
  return /^urn:/i.test(name) && /:(User|Group)$/.test(name)
}

interface PatchPath {
  path: AttrPath
  filter: ScimFilter | null
  /** Sub-attribute after a value filter: emails[type eq "work"].value */
  sub: string | null
}

export function parsePatchPath(raw: string): PatchPath {
  const open = raw.indexOf('[')
  if (open === -1) return { path: parseAttrPath(raw), filter: null, sub: null }
  const close = raw.lastIndexOf(']')
  if (close < open) throw ScimError.badRequest(`Invalid path "${raw}"`, 'invalidPath')
  const path = parseAttrPath(raw.slice(0, open))
  if (path.sub) throw ScimError.badRequest(`Invalid path "${raw}"`, 'invalidPath')
  const rest = raw.slice(close + 1)
  if (rest && !/^\.[A-Za-z$][\w$-]*$/.test(rest)) throw ScimError.badRequest(`Invalid path "${raw}"`, 'invalidPath')
  return { path, filter: parseFilter(raw.slice(open + 1, close)), sub: rest ? rest.slice(1) : null }
}

/** Validate a PatchOp request body into operations. */
export function parsePatchRequest(body: unknown): PatchOperation[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw ScimError.badRequest('PATCH body must be a PatchOp object', 'invalidSyntax')
  const ops = getProp(body, 'Operations')
  if (!Array.isArray(ops) || ops.length === 0) throw ScimError.badRequest('PATCH body needs a non-empty Operations array', 'invalidSyntax')
  if (ops.length > MAX_OPERATIONS) throw new ScimError(413, `At most ${MAX_OPERATIONS} operations per PATCH`, 'tooMany')
  return ops.map((raw) => {
    const opName = String(getProp(raw, 'op') ?? '').toLowerCase()
    if (opName !== 'add' && opName !== 'replace' && opName !== 'remove') throw ScimError.badRequest(`Unknown PATCH op "${String(getProp(raw, 'op'))}"`, 'invalidSyntax')
    const path = getProp(raw, 'path')
    if (path !== undefined && path !== null && typeof path !== 'string') throw ScimError.badRequest('PATCH path must be a string', 'invalidPath')
    const trimmed = typeof path === 'string' && path.trim() ? path.trim() : null
    if (opName === 'remove' && !trimmed) throw ScimError.badRequest('remove needs a path', 'noTarget')
    return { op: opName, path: trimmed, value: getProp(raw, 'value') }
  })
}

function coerce(attr: string, value: unknown): unknown {
  if (BOOLEAN_ATTRS.has(attr.toLowerCase()) && typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true
    if (value.toLowerCase() === 'false') return false
  }
  if (Array.isArray(value)) return value.map((item) => coerceDeep(item))
  return coerceDeep(value)
}

function coerceDeep(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.fromEntries(Object.entries(value as Json).map(([k, v]) => [k, coerce(k, v)]))
}

/** Exact (case-insensitive) key in `obj` for `name`, or `name` when absent. */
function keyFor(obj: Json, name: string): string {
  if (name in obj) return name
  const lower = name.toLowerCase()
  return Object.keys(obj).find((k) => k.toLowerCase() === lower) ?? name
}

function containerForWrite(resource: Json, path: AttrPath, create: boolean): Json | null {
  if (!path.urn) return resource
  const key = keyFor(resource, path.urn)
  const existing = resource[key]
  if (existing && typeof existing === 'object' && !Array.isArray(existing)) return existing as Json
  if (!create) return null
  const created: Json = {}
  resource[key] = created
  return created
}

function sameMultiValue(a: unknown, b: unknown): boolean {
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const av = getProp(a, 'value')
    const bv = getProp(b, 'value')
    if (av !== undefined && bv !== undefined) return String(av) === String(bv)
  }
  return JSON.stringify(a) === JSON.stringify(b)
}

function setAttr(resource: Json, path: AttrPath, value: unknown, op: 'add' | 'replace'): void {
  if (!path.urn && READ_ONLY.has(path.attr.toLowerCase())) return
  const container = containerForWrite(resource, path, true)!
  const key = keyFor(container, path.attr)
  const v = coerce(path.sub ?? path.attr, value)
  if (path.sub) {
    const current = container[key]
    if (Array.isArray(current)) {
      // name.sub on a multi-valued attribute: apply to every element.
      for (const item of current) if (item && typeof item === 'object') (item as Json)[keyFor(item as Json, path.sub)] = v
      return
    }
    const target = current && typeof current === 'object' ? (current as Json) : {}
    target[keyFor(target, path.sub)] = v
    container[key] = target
    return
  }
  const current = container[key]
  if (op === 'add' && Array.isArray(current)) {
    const additions = Array.isArray(v) ? v : [v]
    const merged = [...current]
    for (const item of additions) if (!merged.some((existing) => sameMultiValue(existing, item))) merged.push(item)
    container[key] = merged
    return
  }
  if (op === 'add' && current && typeof current === 'object' && !Array.isArray(current) && v && typeof v === 'object' && !Array.isArray(v)) {
    container[key] = { ...(current as Json), ...(v as Json) }
    return
  }
  container[key] = v
}

function removeAttr(resource: Json, path: AttrPath, value: unknown): void {
  if (!path.urn && READ_ONLY.has(path.attr.toLowerCase())) return
  const container = containerForWrite(resource, path, false)
  if (!container) return
  const key = keyFor(container, path.attr)
  if (!(key in container)) return
  if (path.sub) {
    const current = container[key]
    for (const item of Array.isArray(current) ? current : [current]) {
      if (item && typeof item === 'object') delete (item as Json)[keyFor(item as Json, path.sub)]
    }
    return
  }
  // Entra: {"op":"Remove","path":"members","value":[{"value":"<id>"}]} removes those members only.
  if (Array.isArray(container[key]) && Array.isArray(value) && value.length > 0) {
    container[key] = (container[key] as unknown[]).filter((item) => !value.some((v) => sameMultiValue(item, v)))
    return
  }
  delete container[key]
}

/** Seed a new element for add/replace on a filter that matched nothing (type eq "work" → {type: "work"}). */
function seedFromFilter(filter: ScimFilter): Json | null {
  if (filter.kind === 'compare' && filter.op === 'eq' && !filter.path.sub && !filter.path.urn) return { [filter.path.attr]: filter.value }
  if (filter.kind === 'and') {
    const left = seedFromFilter(filter.left)
    const right = seedFromFilter(filter.right)
    return left && right ? { ...left, ...right } : null
  }
  return null
}

function applyFiltered(resource: Json, target: PatchPath, op: PatchOperation): void {
  const { path, filter, sub } = target
  if (!path.urn && READ_ONLY.has(path.attr.toLowerCase())) return
  const container = containerForWrite(resource, path, op.op !== 'remove')
  if (!container) return
  const key = keyFor(container, path.attr)
  const current = Array.isArray(container[key]) ? [...(container[key] as unknown[])] : []
  const matches = (item: unknown) => Boolean(item && typeof item === 'object' && matchesFilter(item as Json, filter!))

  if (op.op === 'remove') {
    if (sub) {
      for (const item of current) if (matches(item)) delete (item as Json)[keyFor(item as Json, sub)]
      container[key] = current
    } else {
      container[key] = current.filter((item) => !matches(item))
    }
    return
  }

  let matched = false
  const next = current.map((item) => {
    if (!matches(item)) return item
    matched = true
    if (sub) return { ...(item as Json), [keyFor(item as Json, sub)]: coerce(sub, op.value) }
    return op.op === 'replace' ? coerceDeep(op.value) : { ...(item as Json), ...((coerceDeep(op.value) as Json) ?? {}) }
  })
  if (!matched) {
    const seed = seedFromFilter(filter!)
    if (!seed) throw ScimError.badRequest(`No value matched "${op.path}"`, 'noTarget')
    next.push(sub ? { ...seed, [sub]: coerce(sub, op.value) } : { ...seed, ...((coerceDeep(op.value) as Json) ?? {}) })
  }
  container[key] = next
}

/** Apply operations to a copy of `resource`. */
export function applyPatch(resource: Json, operations: PatchOperation[]): Json {
  const out = structuredClone(resource)
  for (const op of operations) {
    if (!op.path) {
      if (!op.value || typeof op.value !== 'object' || Array.isArray(op.value)) throw ScimError.badRequest(`${op.op} without a path needs an object value`, 'invalidValue')
      for (const [name, value] of Object.entries(op.value as Json)) {
        if (READ_ONLY.has(name.toLowerCase())) continue
        // Keys may be attribute paths themselves ("name.givenName", "urn:…:department").
        if (isSchemaUrn(name) && value && typeof value === 'object' && !Array.isArray(value)) {
          // A whole extension object: {"urn:…:enterprise:2.0:User": {department: "x"}}.
          const core = CORE_SCHEMA_URNS.includes(name.toLowerCase())
          const container = core ? out : containerForWrite(out, { urn: name, attr: '_', sub: null }, true)!
          for (const [attr, v] of Object.entries(value as Json)) setAttr(container, { urn: null, attr, sub: null }, v, op.op === 'remove' ? 'replace' : op.op)
          continue
        }
        const target = name.includes('[') ? parsePatchPath(name) : { path: parseAttrPath(name), filter: null, sub: null }
        if (target.filter) applyFiltered(out, target, { ...op, value })
        else setAttr(out, target.path, value, op.op === 'remove' ? 'replace' : op.op)
      }
      continue
    }
    const target = parsePatchPath(op.path)
    if (target.filter) applyFiltered(out, target, op)
    else if (op.op === 'remove') removeAttr(out, target.path, op.value)
    else setAttr(out, target.path, op.value, op.op)
  }
  return out
}

/**
 * Members-only operations (the common group PATCH): the ids to add and to
 * remove, without loading the group. null when any operation does more.
 */
export function memberChanges(operations: PatchOperation[]): { add: string[]; remove: string[]; replace: string[] | null } | null {
  const add: string[] = []
  const remove: string[] = []
  let replace: string[] | null = null
  const ids = (value: unknown): string[] | null => {
    const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value]
    const out: string[] = []
    for (const item of list) {
      const id = item && typeof item === 'object' ? getProp(item, 'value') : item
      if (typeof id !== 'string' || !id) return null
      out.push(id)
    }
    return out
  }
  for (const op of operations) {
    if (!op.path) {
      // {"op":"add","value":{"members":[…]}} — only when members is the sole key.
      const keys = op.value && typeof op.value === 'object' && !Array.isArray(op.value) ? Object.keys(op.value as Json) : []
      if (keys.length !== 1 || keys[0].toLowerCase() !== 'members' || op.op === 'remove') return null
      const list = ids(getProp(op.value, 'members'))
      if (!list) return null
      if (op.op === 'add') add.push(...list)
      else { replace = list; add.length = 0; remove.length = 0 }
      continue
    }
    if (op.path.toLowerCase() === 'members') {
      const list = ids(op.value)
      if (!list) return null
      if (op.op === 'add') add.push(...list)
      else if (op.op === 'remove') {
        if (list.length === 0) { replace = []; add.length = 0; remove.length = 0 } else remove.push(...list)
      } else { replace = list; add.length = 0; remove.length = 0 }
      continue
    }
    const m = /^members\[\s*value\s+eq\s+"((?:[^"\\]|\\.)*)"\s*\]$/i.exec(op.path)
    if (m && op.op === 'remove') {
      remove.push(JSON.parse(`"${m[1]}"`) as string)
      continue
    }
    return null
  }
  return { add, remove, replace }
}
