/**
 * Write kinds of custom references (Create, Update, Upsert, Delete, Execute):
 * validation of the write settings, the REST request body builder, the
 * "identifies the record" rule, success criteria and the output shape.
 *
 * Safety rules enforced here (at save, and again at run time):
 *  - Update / Delete always have a WHERE: database sources need key columns
 *    or filter conditions; REST sources need an operation parameter that
 *    identifies the record (a path parameter, else a mapped parameter).
 *    A blank key value at run time refuses the call (never "update all").
 *  - Max affected rows defaults to 1 and is capped at 1,000.
 *  - Column / parameter names must come from introspection; values are only
 *    ever `{{input.x}}` tokens or constants (bound as driver parameters).
 *
 * Pure and client-safe (the builder previews the request body live).
 */

import { isSensitiveKey } from '@/lib/secret-keys'
import { CustomReferenceError, renderTemplateValue, templateInputNames } from './inputs'
import {
  KIND_INFO,
  WRITE_HTTP_METHODS,
  WRITE_LIMITS,
  isWriteKind,
  wholeInputToken,
  type BodyField,
  type BodyFieldType,
  type CustomInput,
  type CustomKind,
  type CustomReferenceConfig,
  type CustomSource,
  type WriteColumn,
  type WriteConfig,
  type WriteHttpMethod,
} from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- write configs arrive as free-form JSON */

const fail = (message: string): never => { throw new CustomReferenceError(message) }
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : v === undefined || v === null ? '' : String(v).slice(0, max))
const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)

const BODY_SEGMENT = /^[A-Za-z0-9_$@-]{1,64}$/
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const BODY_TYPES: readonly BodyFieldType[] = ['auto', 'string', 'number', 'boolean', 'json', 'null']
/** Headers an idempotency key may not be sent as. */
const RESERVED_HEADERS = new Set(['authorization', 'cookie', 'host', 'content-type', 'content-length', 'proxy-authorization'])

export const DEFAULT_IDEMPOTENCY_HEADER = 'Idempotency-Key'

/** The REST method a write kind sends by default. */
export function defaultMethodFor(kind: CustomKind): WriteHttpMethod | undefined {
  return KIND_INFO[kind]?.method
}

/** Max affected rows of a config (default 1, at most 1,000). */
export function maxAffectedOf(config: Pick<CustomReferenceConfig, 'write'>): number {
  const n = Number(config.write?.max_affected)
  return Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), WRITE_LIMITS.maxAffected) : WRITE_LIMITS.defaultMaxAffected
}

// ─── Validation ─────────────────────────────────────────────────────────

/** A value template: a constant or `{{input.x}}` tokens (checked against declared inputs later). */
function valueTemplate(raw: unknown): string {
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
  return str(raw, 2000)
}

function normalizeColumns(raw: unknown, columnNames: Set<string>, what: string, max: number, table: string): WriteColumn[] {
  const list = Array.isArray(raw) ? raw : []
  if (list.length > max) fail(`At most ${max} ${what}`)
  const seen = new Set<string>()
  return list.map((item: any) => {
    const column = str(item?.column, 128)
    if (!columnNames.has(column)) fail(`"${column}" is not a column of ${table}`)
    if (seen.has(column)) fail(`Column "${column}" is listed twice in ${what}`)
    seen.add(column)
    return { column, value: valueTemplate(item?.value) }
  })
}

function normalizeBody(raw: any, kind: CustomKind): WriteConfig['body'] {
  const modes = ['source', 'none', 'inputs', 'mapped'] as const
  const mode = (modes as readonly string[]).includes(raw?.mode) ? raw.mode as (typeof modes)[number] : kind === 'delete' ? 'none' : 'source'
  if (mode !== 'mapped') return { mode }
  const list = Array.isArray(raw?.fields) ? raw.fields : []
  if (list.length > WRITE_LIMITS.maxBodyFields) fail(`At most ${WRITE_LIMITS.maxBodyFields} body fields`)
  const seen = new Set<string>()
  const fields: BodyField[] = list.map((f: any) => {
    const path = str(f?.path, 400)
    const parts = path.split('.')
    if (!path || parts.some((p) => !BODY_SEGMENT.test(p) || FORBIDDEN.has(p))) fail(`Body field "${path}" is not a valid JSON path (letters, digits, _ $ @ -, separated by dots)`)
    if (parts.length > WRITE_LIMITS.bodyDepth) fail(`Body field "${path}" is nested more than ${WRITE_LIMITS.bodyDepth} levels`)
    if (seen.has(path)) fail(`Body field "${path}" is set twice`)
    for (const other of seen) if (other.startsWith(`${path}.`) || path.startsWith(`${other}.`)) fail(`Body fields "${other}" and "${path}" overlap`)
    seen.add(path)
    const type = (BODY_TYPES as readonly string[]).includes(f?.type) ? (f.type as BodyFieldType) : 'auto'
    const value = type === 'null' ? undefined : typeof f?.value === 'number' || typeof f?.value === 'boolean' ? f.value : str(f?.value, 10000)
    if (type === 'json' && typeof value === 'string' && !wholeInputToken(value) && !/\{\{/.test(value)) {
      try { JSON.parse(value) } catch { fail(`Body field "${path}": the value is not valid JSON`) }
    }
    return { path, ...(value !== undefined && value !== '' ? { value } : {}), ...(type !== 'auto' ? { type } : {}) }
  })
  return { mode, fields }
}

/** Parse "200-299,304" into ranges (throws on nonsense). */
export function parseStatusRanges(text: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const part of text.split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([1-5]\d\d)(?:\s*-\s*([1-5]\d\d))?$/.exec(part)
    if (!m) fail(`Success statuses: "${part}" is not a status or a range like 200-299`)
    const lo = Number(m![1])
    const hi = Number(m![2] ?? m![1])
    if (hi < lo) fail(`Success statuses: "${part}" is backwards`)
    out.push([lo, hi])
  }
  if (!out.length) fail('Success statuses: give at least one status or range')
  return out
}

export function isSuccessStatus(status: number, statuses: string | undefined): boolean {
  if (!statuses) return status >= 200 && status < 300
  return parseStatusRanges(statuses).some(([lo, hi]) => status >= lo && status <= hi)
}

/** Operation parameters that identify the record (REST Update / Delete): mapped path parameters, else every mapped parameter. */
export function identifyingParams(source: CustomSource): string[] {
  if (source.type !== 'operation') return []
  const mapped = new Set(source.params.map((p) => p.name))
  const pathParams = source.inputs.filter((i) => i.location === 'path' && mapped.has(i.name)).map((i) => i.name)
  return pathParams.length ? pathParams : Array.from(mapped)
}

export interface NormalizeWriteContext {
  kind: CustomKind
  source: CustomSource
  inputs: CustomInput[]
  /** True when the config has at least one filter condition (DB WHERE conditions). */
  hasConditions: boolean
}

/** Validate the write settings of a write-kind config (returns undefined for Read / List). */
export function normalizeWriteConfig(raw: any, ctx: NormalizeWriteContext): WriteConfig | undefined {
  const { kind, source, inputs } = ctx
  if (!isWriteKind(kind)) return undefined
  const r = raw && typeof raw === 'object' ? raw : {}
  const out: WriteConfig = {}
  const inputNames = new Set(inputs.map((i) => i.name))

  if (source.type === 'operation') {
    const method = str(r.method, 10).toUpperCase()
    out.method = (WRITE_HTTP_METHODS as readonly string[]).includes(method) ? (method as WriteHttpMethod) : defaultMethodFor(kind)
    out.body = normalizeBody(r.body, kind)
    const statuses = str(r.success_statuses, 100)
    if (statuses) { parseStatusRanges(statuses); out.success_statuses = statuses }
    if ((kind === 'update' || kind === 'delete') && !identifyingParams(source).length) {
      fail(`${KIND_INFO[kind].label} needs the operation parameter that identifies the record (e.g. the id in the path) — map it to an input`)
    }
  } else {
    const columnNames = new Set(source.columns.map((c) => c.name))
    if (kind === 'execute') {
      const p = r.procedure
      const name = str(p?.name, 128)
      if (!name) fail('Pick the stored procedure or function to run')
      const params = (Array.isArray(p?.params) ? p.params : []).slice(0, WRITE_LIMITS.maxProcedureParams + 1)
      if (params.length > WRITE_LIMITS.maxProcedureParams) fail(`At most ${WRITE_LIMITS.maxProcedureParams} parameters`)
      const seen = new Set<string>()
      out.procedure = {
        ...(p?.schema ? { schema: str(p.schema, 128) } : {}),
        name,
        routine_type: p?.routine_type === 'procedure' ? 'procedure' : 'function',
        params: params.map((param: any) => {
          const pname = str(param?.name, 128)
          if (!/^@?[A-Za-z_][A-Za-z0-9_$#]{0,127}$/.test(pname)) fail(`"${pname}" is not a valid parameter name`)
          if (seen.has(pname)) fail(`Parameter "${pname}" is listed twice`)
          seen.add(pname)
          return {
            name: pname,
            ...(param?.type ? { type: str(param.type, 60) } : {}),
            ...(param?.is_output ? { is_output: true } : {}),
            ...(!param?.is_output && !isBlank(param?.value) ? { value: valueTemplate(param.value) } : {}),
          }
        }),
      }
    } else {
      if (kind !== 'delete') {
        out.set = normalizeColumns(r.set, columnNames, 'columns to write', WRITE_LIMITS.maxSetColumns, source.table)
        if (!out.set.length && kind !== 'update') fail(`${KIND_INFO[kind].label}: choose the columns to write`)
        if (!out.set.length && kind === 'update') fail('Update: choose the columns to SET')
      }
      if (kind !== 'create') {
        out.key = normalizeColumns(r.key, columnNames, 'key columns', WRITE_LIMITS.maxKeyColumns, source.table)
        if (kind === 'upsert' && !out.key.length) fail('Upsert: choose the key columns that decide insert or update (they need a unique constraint)')
        if ((kind === 'update' || kind === 'delete') && !out.key.length && !ctx.hasConditions) {
          fail(`${KIND_INFO[kind].label} needs a WHERE: choose key columns or add filter conditions — an unbounded ${kind} is not allowed`)
        }
        if (kind === 'upsert') {
          const setNames = new Set((out.set ?? []).map((c) => c.column))
          for (const k of out.key) if (setNames.has(k.column)) fail(`Upsert: "${k.column}" is a key column — set its value as a key, not in the columns to write`)
        }
      }
      if (r.returning) out.returning = true
      if (kind !== 'create') {
        const max = Number(r.max_affected)
        if (r.max_affected !== undefined && r.max_affected !== null && r.max_affected !== '') {
          if (!Number.isFinite(max) || max < 1) fail('Max affected rows must be at least 1')
          if (max > WRITE_LIMITS.maxAffected) fail(`Max affected rows is at most ${WRITE_LIMITS.maxAffected}`)
          out.max_affected = Math.floor(max)
        }
      }
    }
  }

  if (kind === 'update' || kind === 'delete') out.not_found = r.not_found === 'noop' ? 'noop' : 'error'

  if (r.idempotency && typeof r.idempotency === 'object' && str(r.idempotency.input, 64)) {
    if (kind !== 'create' && kind !== 'execute') fail('An idempotency key applies to Create and Execute')
    const input = str(r.idempotency.input, 64)
    if (!inputNames.has(input)) fail(`The idempotency key input "${input}" is not declared`)
    const header = str(r.idempotency.header, 64) || DEFAULT_IDEMPOTENCY_HEADER
    if (!HEADER_NAME.test(header) || RESERVED_HEADERS.has(header.toLowerCase())) fail(`"${header}" cannot carry the idempotency key`)
    out.idempotency = { input, ...(header !== DEFAULT_IDEMPOTENCY_HEADER ? { header } : {}) }
  }

  const idField = str(r.id_field, 128)
  if (idField) {
    if (!/^[A-Za-z0-9_$@-]{1,64}(\.[A-Za-z0-9_$@-]{1,64}){0,2}$/.test(idField)) fail(`Id field "${idField}" is not a valid path`)
    out.id_field = idField
  }
  return out
}

/** Every `{{input.x}}` a write config mentions (for the declared-input check). */
export function writeInputsMentioned(write: WriteConfig | undefined): string[] {
  if (!write) return []
  const out: string[] = []
  for (const c of [...(write.set ?? []), ...(write.key ?? [])]) out.push(...templateInputNames(c.value))
  for (const p of write.procedure?.params ?? []) out.push(...templateInputNames(p.value))
  for (const f of write.body?.fields ?? []) out.push(...templateInputNames(f.value))
  return out
}

// ─── REST request body ──────────────────────────────────────────────────

function typedValue(field: BodyField, values: Record<string, unknown>): unknown {
  const type = field.type ?? 'auto'
  if (type === 'null') return null
  const raw = renderTemplateValue(field.value ?? '', values)
  switch (type) {
    case 'string': return raw === undefined || raw === null ? '' : typeof raw === 'object' ? JSON.stringify(raw) : String(raw)
    case 'number': {
      if (isBlank(raw)) return undefined
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
      if (!Number.isFinite(n)) throw new CustomReferenceError(`Body field "${field.path}" must be a number`)
      return n
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      if (isBlank(raw)) return undefined
      const s = String(raw).trim().toLowerCase()
      if (['true', '1', 'yes'].includes(s)) return true
      if (['false', '0', 'no'].includes(s)) return false
      throw new CustomReferenceError(`Body field "${field.path}" must be true or false`)
    }
    case 'json': {
      if (typeof raw !== 'string') return raw
      if (!raw.trim()) return undefined
      try { return JSON.parse(raw) } catch { throw new CustomReferenceError(`Body field "${field.path}" must be valid JSON`) }
    }
    default: return raw
  }
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const parts = path.split('.')
  let node: Record<string, unknown> = target
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const next = Object.prototype.hasOwnProperty.call(node, key) ? node[key] : undefined
    if (!next || typeof next !== 'object' || Array.isArray(next)) node[key] = Object.create(null)
    node = node[key] as Record<string, unknown>
  }
  node[parts[parts.length - 1]] = value
}

/** A plain JSON copy (objects built with a null prototype become ordinary ones). */
const plain = (v: unknown) => JSON.parse(JSON.stringify(v ?? null))

/**
 * The request body of a REST write (undefined = keep the operation's own
 * body template / send none). Blank optional values are left out; values
 * are data and never re-rendered as templates.
 */
export function buildRequestBody(config: CustomReferenceConfig, values: Record<string, unknown>, sensitive: Set<string> = new Set()): Record<string, unknown> | undefined {
  const body = config.write?.body
  if (!body || body.mode === 'source' || body.mode === 'none') return undefined
  if (body.mode === 'inputs') {
    const out: Record<string, unknown> = {}
    const skip = new Set([config.write?.idempotency?.input, 'page', 'limit'].filter(Boolean) as string[])
    for (const input of config.inputs) {
      if (skip.has(input.name) || sensitive.has(input.name) || (input.fixed_setting && isSensitiveKey(input.fixed_setting))) continue
      const v = values[input.name]
      if (!isBlank(v)) out[input.name] = v
    }
    return out
  }
  const out: Record<string, unknown> = Object.create(null)
  for (const field of body.fields ?? []) {
    const value = typedValue(field, values)
    if (value === undefined || (value === '' && (field.type ?? 'auto') === 'auto' && wholeInputToken(field.value))) continue
    setPath(out, field.path, value)
  }
  return plain(out)
}

/** The method a REST write sends. */
export function writeMethodOf(config: CustomReferenceConfig, sourceMethod?: string): string {
  return config.write?.method ?? defaultMethodFor(config.kind) ?? String(sourceMethod ?? 'POST').toUpperCase()
}

/**
 * REST Update / Delete: every identifying parameter must have a value at
 * run time (a blank id must never reach a collection endpoint).
 */
export function assertIdentified(config: CustomReferenceConfig, apiValues: Record<string, unknown>): void {
  if (config.kind !== 'update' && config.kind !== 'delete') return
  if (config.source.type !== 'operation') return
  const params = identifyingParams(config.source)
  if (!params.length) throw new CustomReferenceError(`${KIND_INFO[config.kind].label} needs a parameter that identifies the record`)
  for (const name of params) {
    if (isBlank(apiValues[name])) throw new CustomReferenceError(`${KIND_INFO[config.kind].label} refused: "${name}" (which identifies the record) is empty`)
  }
}

// ─── Output ─────────────────────────────────────────────────────────────

/** The id output: `id_field` of the record, else its `id`, else the first key value. */
export function recordId(config: CustomReferenceConfig, record: unknown, values: Record<string, unknown>): unknown {
  const rec = record && typeof record === 'object' && !Array.isArray(record) ? (record as Record<string, unknown>) : null
  const path = config.write?.id_field
  if (rec && path) {
    let node: unknown = rec
    for (const part of path.split('.')) node = node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined
    if (node !== undefined) return node
  }
  if (rec && rec.id !== undefined) return rec.id
  const key = config.write?.key?.[0]
  if (key) {
    if (rec && rec[key.column] !== undefined) return rec[key.column]
    const v = renderTemplateValue(key.value, values)
    if (!isBlank(v)) return v
  }
  return null
}

export interface WriteOutput {
  status: number
  affected_rows: number
  id: unknown
  record: Record<string, unknown> | null
}

/**
 * "For each changed row" → a write reference: each input gets the row
 * column of the same name (case and `_` / `-` / space insensitive) as
 * `{{row.<column>}}`; inputs already mapped are kept.
 */
export function mapRowColumnsToInputs(inputNames: string[], columnKeys: string[], current: Record<string, string> = {}): Record<string, string> {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '')
  const byNorm = new Map(columnKeys.map((k) => [norm(k), k]))
  const out: Record<string, string> = { ...current }
  for (const name of inputNames) {
    if (out[name]) continue
    const column = byNorm.get(norm(name))
    if (column) out[name] = `{{row.${column}}}`
  }
  return out
}

/** Names of the fixed output fields of write kinds (record columns come under `record`). */
export const WRITE_OUTPUT_FIELDS = ['status', 'affected_rows', 'id', 'record'] as const

/** Plain-language summary of a write (builder "Where it runs"). */
export function describeWrite(config: CustomReferenceConfig): { api: string[]; server: string[] } {
  const w = config.write ?? {}
  const label = KIND_INFO[config.kind]?.label ?? config.kind
  const api: string[] = []
  const server: string[] = []
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (config.source.type === 'table') {
    const target = config.source.schema ? `${config.source.schema}.${config.source.table}` : config.source.table
    if (config.kind === 'execute') {
      api.push(`In the database: call ${w.procedure?.name ?? 'the procedure'} (${plural((w.procedure?.params ?? []).length, 'parameter')}, bound) in a transaction`)
    } else {
      const verbs: Record<string, string> = { create: 'INSERT INTO', update: 'UPDATE', upsert: 'Upsert into', delete: 'DELETE FROM' }
      api.push(`In the database: ${verbs[config.kind] ?? label} ${target} — one parameterised statement in a transaction`)
      if (w.key?.length) api.push(`${config.kind === 'upsert' ? 'Match on' : 'WHERE'} ${w.key.map((k) => k.column).join(' AND ')}`)
      if (config.kind !== 'create') server.push(`Roll back when more than ${plural(maxAffectedOf(config), 'row')} would change`)
    }
  } else {
    const fields = (w.body?.fields ?? []).length
    const body = w.body?.mode === 'mapped' ? `a body of ${plural(fields, 'mapped field')}` : w.body?.mode === 'inputs' ? 'the input object as the body' : w.body?.mode === 'none' ? 'no body' : "the operation's own body"
    api.push(`${writeMethodOf(config)} with ${body}`)
    if (w.idempotency) api.push(`Idempotency key in the ${w.idempotency.header ?? DEFAULT_IDEMPOTENCY_HEADER} header`)
    server.push(`Success: HTTP ${w.success_statuses || '200-299'}`)
  }
  if (w.idempotency) server.push('A retry with the same key returns the first result')
  if (config.kind === 'update' || config.kind === 'delete') server.push(`Nothing matched: ${w.not_found === 'noop' ? 'succeed (no-op)' : 'fail (404)'}`)
  server.push('Output: status, affected_rows, id, record')
  return { api, server }
}
