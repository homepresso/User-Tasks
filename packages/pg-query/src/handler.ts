import { fromPgError, PgrstError, unsupported, type ErrorBody } from './errors'
import { parseQueryParams, type QueryParams } from './parse'
import {
  buildReadPlan,
  callToQuery,
  mainCall,
  mainRead,
  mainWrite,
  mutationToQuery,
  type BodyHandler,
} from './plan'
import type { PgFunction, SchemaCache, SchemaStore } from './schema'
import { SqlBuilder } from './sql'

/**
 * One PostgREST request, answered in-process: parse → plan → one SQL
 * statement inside a transaction that carries the caller's role and JWT
 * claims → PostgREST-shaped status, headers and body.
 */

export interface Identity {
  /** Database role to impersonate (anon / authenticated / service_role). */
  role: string
  /** JWT claims exposed to SQL as request.jwt.claims (auth.uid() reads `sub`). */
  claims: Record<string, unknown>
}

export interface PgQueryRequest {
  method: string
  /** Resource path below the REST prefix: `tasks` or `rpc/fn_name`. */
  path: string
  search: URLSearchParams
  headers: Headers
  body: string | null
}

export interface PgQueryResponse {
  status: number
  statusText: string
  headers: Record<string, string>
  body: string | null
}

export interface TxClient {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

export interface TxRunner {
  /** Runs `fn` in one transaction with the identity applied; `fn` returning `rollback: true` rolls back. */
  run<T>(opts: { readOnly: boolean; identity: Identity; request: PgQueryRequest; cache: SchemaCache }, fn: (tx: TxClient) => Promise<{ value: T; rollback: boolean }>): Promise<T>
}

export interface HandlerOptions {
  schemas: SchemaStore
  tx: TxRunner
  aggregatesEnabled?: boolean
  /** PostgREST db-max-rows (Supabase API max_rows, default 1000 there). */
  maxRows?: number | null
}

const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  204: 'No Content',
  206: 'Partial Content',
  300: 'Multiple Choices',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  406: 'Not Acceptable',
  409: 'Conflict',
  413: 'Payload Too Large',
  416: 'Requested Range Not Satisfiable',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
}

const JSON_CT = 'application/json; charset=utf-8'

const STALE_CACHE_CODES = new Set(['PGRST200', 'PGRST204'])

function respond(status: number, body: string | null, headers: Record<string, string> = {}): PgQueryResponse {
  const h = { ...headers }
  if (body !== null && body !== '' && !h['content-type']) h['content-type'] = JSON_CT
  return { status, statusText: STATUS_TEXT[status] ?? '', headers: h, body: status === 204 ? null : body }
}

export function errorResponse(err: PgrstError): PgQueryResponse {
  const body: ErrorBody = { code: err.body.code, details: err.body.details ?? null, hint: err.body.hint ?? null, message: err.body.message }
  const headers: Record<string, string> = { 'proxy-status': `PostgREST; error=${body.code}` }
  if (err.status === 401) headers['www-authenticate'] = 'Bearer'
  return respond(err.status, JSON.stringify(body), headers)
}

interface Prefer {
  return: 'representation' | 'minimal' | 'headers-only' | null
  count: 'exact' | 'planned' | 'estimated' | null
  resolution: 'merge' | 'ignore' | null
  missing: 'default' | 'null' | null
  handling: 'strict' | 'lenient' | null
  maxAffected: number | null
}

function parsePrefer(headers: Headers): Prefer {
  const prefs: Prefer = { return: null, count: null, resolution: null, missing: null, handling: null, maxAffected: null }
  const tokens = (headers.get('prefer') ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
  for (const t of tokens) {
    const [k, v] = t.split('=').map((x) => x.trim())
    if (k === 'return' && !prefs.return && (v === 'representation' || v === 'minimal' || v === 'headers-only')) prefs.return = v
    else if (k === 'count' && !prefs.count && (v === 'exact' || v === 'planned' || v === 'estimated')) prefs.count = v
    else if (k === 'resolution' && !prefs.resolution && (v === 'merge-duplicates' || v === 'ignore-duplicates')) prefs.resolution = v === 'merge-duplicates' ? 'merge' : 'ignore'
    else if (k === 'missing' && !prefs.missing && (v === 'default' || v === 'null')) prefs.missing = v
    else if (k === 'handling' && !prefs.handling && (v === 'strict' || v === 'lenient')) prefs.handling = v
    else if (k === 'max-affected' && prefs.maxAffected === null && /^\d+$/.test(v ?? '')) prefs.maxAffected = Number(v)
  }
  return prefs
}

type MediaKind = 'json' | 'single'

function acceptKind(headers: Headers): MediaKind {
  const accept = headers.get('accept')
  if (!accept) return 'json'
  const types = accept.split(',').map((t) => t.split(';')[0].trim().toLowerCase())
  for (const t of types) {
    if (t === 'application/vnd.pgrst.object+json' || t === 'application/vnd.pgrst.object') return 'single'
    if (t === 'application/json' || t === '*/*' || t === 'application/*' || t === 'application/vnd.pgrst.array+json') return 'json'
  }
  throw new PgrstError(406, {
    code: 'PGRST107',
    message: `None of these media types are available: ${types.join(', ')}`,
    details: null,
    hint: null,
  })
}

interface Payload {
  body: string
  isObject: boolean
  keys: string[]
}

function invalidBody(message: string): PgrstError {
  return new PgrstError(400, { code: 'PGRST102', message, details: null, hint: null })
}

/** getPayload / payloadAttributes from ApiRequest/Payload.hs. */
function readPayload(raw: string | null, columns: string[] | null, isRpc: boolean): Payload {
  const text = raw ?? ''
  const isObject = text.replace(/^[ \t\n\r]+/, '').startsWith('{')
  if (columns) return { body: text, isObject, keys: [...new Set(columns)].sort() }
  let json: unknown
  if (text === '' && isRpc) json = {}
  else {
    try {
      json = JSON.parse(text)
    } catch {
      throw invalidBody('Empty or invalid json')
    }
  }
  const body = text === '' ? '{}' : text
  if (Array.isArray(json)) {
    if (json.length === 0) return { body: '[]', isObject: false, keys: [] }
    const first = json[0]
    if (!first || typeof first !== 'object' || Array.isArray(first)) throw invalidBody('All object keys must match')
    const keys = Object.keys(first).sort()
    const uniform = json.every(
      (x) => x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === keys.length && keys.every((k) => k in x),
    )
    if (!uniform) throw invalidBody('All object keys must match')
    return { body, isObject: false, keys }
  }
  if (json && typeof json === 'object') return { body, isObject: true, keys: Object.keys(json).sort() }
  return { body: '[]', isObject: false, keys: [] }
}

function contentRange(lower: number, upper: number, total: number | null): string {
  const totalNotZero = total !== 0
  const range = totalNotZero && lower <= upper ? `${lower}-${upper}` : '*'
  return `${range}/${total === null ? '*' : total}`
}

function rangeStatus(lower: number, upper: number, total: number | null): number {
  if (total === null) return 200
  if (lower > total) return 416
  if (1 + upper - lower < total) return 206
  return 200
}

function outOfRange(offset: number, total: number | null): PgrstError {
  return new PgrstError(416, {
    code: 'PGRST103',
    message: 'Requested range not satisfiable',
    details: `An offset of ${offset} was requested, but there are only ${total ?? 0} rows.`,
    hint: null,
  })
}

function singularity(n: number): PgrstError {
  return new PgrstError(406, {
    code: 'PGRST116',
    message: 'Cannot coerce the result to a single JSON object',
    details: `The result contains ${n} rows`,
    hint: null,
  })
}

interface MainRow {
  total_result_set: string | null
  page_total: string
  body: string | null
  response_inserted: string | null
}

function tableNotFound(schema: string, name: string): PgrstError {
  return new PgrstError(404, {
    code: 'PGRST205',
    message: `Could not find the table '${schema}.${name}' in the schema cache`,
    details: null,
    hint: null,
  })
}

function findProc(fns: PgFunction[], keys: string[], isPost: boolean): PgFunction | 'none' | PgFunction[] {
  const keySet = new Set(keys)
  const matches = (fn: PgFunction) => {
    const params = fn.params
    if (params.length === 0) return keySet.size === 0
    const req = params.filter((p) => p.required).map((p) => p.name)
    const opt = new Set(params.filter((p) => !p.required).map((p) => p.name))
    if (opt.size === 0) return keySet.size === req.length && req.every((r) => keySet.has(r))
    if (req.length === 0) return [...keySet].every((k) => opt.has(k))
    const rest = [...keySet].filter((k) => !opt.has(k))
    return rest.length === req.length && req.every((r) => rest.includes(r))
  }
  const singleUnnamed = (fn: PgFunction) => isPost && fn.params.length === 1 && fn.params[0].name === '' && ['json', 'jsonb'].includes(fn.params[0].type)
  const named = fns.filter(matches)
  const fallback = fns.filter((f) => !matches(f) && singleUnnamed(f))
  if (named.length === 1) return named[0]
  if (named.length > 1) return named
  if (fallback.length === 1) return fallback[0]
  if (fallback.length > 1) return fallback
  return 'none'
}

function noRpc(schema: string, name: string, keys: string[], isPost: boolean): PgrstError {
  const prms = keys.join(', ')
  const msgPrms = keys.length === 0 ? ' without parameters' : `(${prms})`
  const detPrms = keys.length === 0 ? ' without parameters' : ` with parameter${keys.length > 1 ? 's' : ''} ${prms}`
  return new PgrstError(404, {
    code: 'PGRST202',
    message: `Could not find the function ${schema}.${name}${msgPrms} in the schema cache`,
    details: `Searched for the function ${schema}.${name}${detPrms}${isPost ? ' or with a single unnamed json/jsonb parameter' : ''}, but no matches were found in the schema cache.`,
    hint: null,
  })
}

function ambiguousRpc(fns: PgFunction[]): PgrstError {
  return new PgrstError(300, {
    code: 'PGRST203',
    message: `Could not choose the best candidate function between: ${fns
      .map((f) => `${f.schema}.${f.name}(${f.params.map((p) => `${p.name} => ${p.type}`).join(', ')})`)
      .join(', ')}`,
    details: null,
    hint: 'Try renaming the parameters or the function itself in the database so function overloading can be resolved',
  })
}

export class RequestHandler {
  constructor(private readonly opts: HandlerOptions) {}

  async handle(req: PgQueryRequest, identity: Identity): Promise<PgQueryResponse> {
    try {
      try {
        return await this.dispatch(req, identity)
      } catch (err) {
        // Unknown column / relationship: the schema may have changed since it was cached.
        if (err instanceof PgrstError && STALE_CACHE_CODES.has(err.body.code) && (await this.opts.schemas.refreshAfterMiss())) {
          return await this.dispatch(req, identity)
        }
        throw err
      }
    } catch (err) {
      return errorResponse(fromPgError(err, identity.role !== 'anon'))
    }
  }

  private async cacheWith<T>(lookup: (c: SchemaCache) => T | undefined): Promise<{ cache: SchemaCache; hit: T | undefined }> {
    let cache = await this.opts.schemas.get()
    let hit = lookup(cache)
    if (hit === undefined) {
      const fresh = await this.opts.schemas.refreshAfterMiss()
      if (fresh) {
        cache = fresh
        hit = lookup(cache)
      }
    }
    return { cache, hit }
  }

  private async dispatch(req: PgQueryRequest, identity: Identity): Promise<PgQueryResponse> {
    const method = req.method.toUpperCase()
    const segments = req.path.split('/').filter(Boolean).map(decodeURIComponent)
    const isRpc = segments.length === 2 && segments[0] === 'rpc'
    if (!(segments.length === 1 || isRpc)) {
      throw new PgrstError(404, { code: 'PGRST125', message: 'Invalid path specified in request URL', details: null, hint: null })
    }
    const base = await this.opts.schemas.get()
    const profile = ['GET', 'HEAD'].includes(method) ? req.headers.get('accept-profile') : req.headers.get('content-profile')
    if (profile && profile !== base.schema) {
      throw new PgrstError(406, { code: 'PGRST106', message: `Invalid schema: ${profile}`, details: null, hint: `Only the following schemas are exposed: ${base.schema}` })
    }
    const prefer = parsePrefer(req.headers)
    const media = acceptKind(req.headers)
    if (isRpc) {
      if (!['GET', 'HEAD', 'POST'].includes(method)) {
        throw new PgrstError(405, { code: 'PGRST101', message: `Cannot use the ${method} method on RPC`, details: null, hint: null })
      }
      return this.call(req, identity, segments[1], method, prefer, media)
    }
    const qp = parseQueryParams(req.search, false)
    const { cache, hit: table } = await this.cacheWith((c) => c.tables.get(segments[0]))
    if (!table) throw tableNotFound(cache.schema, segments[0])
    if (method === 'GET' || method === 'HEAD') return this.read(req, identity, cache, table.name, qp, prefer, media, method === 'HEAD')
    if (method === 'POST' || method === 'PATCH' || method === 'DELETE') return this.mutate(req, identity, cache, table.name, qp, prefer, media, method)
    if (method === 'PUT') throw unsupported('PUT (single-row upsert)')
    throw new PgrstError(405, { code: 'PGRST117', message: `Unsupported HTTP method: ${method}`, details: null, hint: null })
  }

  private topRange(qp: QueryParams) {
    const r = qp.ranges.get('') ?? { offset: 0, limit: null }
    if (r.limit === 0) {
      qp.ranges.set('', { offset: 0, limit: 0 })
      return { offset: 0, limit: 0 }
    }
    return r
  }

  private async read(req: PgQueryRequest, identity: Identity, cache: SchemaCache, table: string, qp: QueryParams, prefer: Prefer, media: MediaKind, head: boolean) {
    const range = this.topRange(qp)
    const plan = buildReadPlan({ cache, rootName: table, action: 'read', params: qp, aggregatesEnabled: !!this.opts.aggregatesEnabled, maxRows: this.opts.maxRows })
    const sql = new SqlBuilder()
    const count = prefer.count !== null
    const handler: BodyHandler = head ? 'none' : media === 'single' ? 'single' : 'array'
    const text = mainRead(sql, plan, count, handler)
    const row = await this.opts.tx.run({ readOnly: true, identity, request: req, cache }, async (tx) => {
      const { rows } = await tx.query<MainRow>(text, sql.params)
      const r = rows[0]
      if (media === 'single' && Number(r.page_total) !== 1) throw singularity(Number(r.page_total))
      return { value: r, rollback: false }
    })
    const pageTotal = Number(row.page_total)
    const total = row.total_result_set === null ? null : Number(row.total_result_set)
    const lower = range.offset
    const upper = lower + pageTotal - 1
    const status = rangeStatus(lower, upper, total)
    const headers: Record<string, string> = { 'content-range': contentRange(lower, upper, total) }
    if (count) headers['preference-applied'] = `count=${prefer.count}`
    if (status === 416) return { ...errorResponse(outOfRange(range.offset, total)), headers: { ...headers, 'content-type': JSON_CT } }
    if (head) return respond(status, '', headers)
    if (media === 'single') headers['content-type'] = 'application/vnd.pgrst.object+json; charset=utf-8'
    return respond(status, row.body ?? '', headers)
  }

  private async mutate(req: PgQueryRequest, identity: Identity, cache: SchemaCache, tableName: string, qp: QueryParams, prefer: Prefer, media: MediaKind, method: string) {
    const table = cache.tables.get(tableName)!
    const kind = method === 'POST' ? 'insert' : method === 'PATCH' ? 'update' : 'delete'
    const payload = kind === 'delete' ? null : readPayload(req.body, qp.columns, false)
    const representation = prefer.return === 'representation'
    const rootFilters = qp.filters.filter(([p]) => p.length === 0).map(([, f]) => f)
    const rootLogic = qp.logic.filter(([p]) => p.length === 0).map(([, t]) => t)
    const plan = buildReadPlan({ cache, rootName: tableName, action: 'mutate', params: qp, aggregatesEnabled: !!this.opts.aggregatesEnabled, maxRows: this.opts.maxRows })
    const sql = new SqlBuilder()
    const mutation = mutationToQuery(
      sql,
      {
        kind,
        table,
        columns: payload?.keys ?? [],
        body: payload?.body ?? null,
        bodyIsObject: payload?.isObject ?? false,
        resolution: kind === 'insert' ? prefer.resolution : null,
        onConflict: qp.onConflict,
        filters: rootFilters,
        logic: rootLogic,
        returnRepresentation: representation,
        applyDefaults: prefer.missing === 'default',
      },
      plan,
      cache.schema,
    )
    // Supabase loads pg-safeupdate for PostgREST's sessions: an UPDATE or
    // DELETE without filters fails instead of touching every row. Checked
    // after planning, so an unknown column still reports PGRST204 first.
    if ((kind === 'delete' || (kind === 'update' && payload && payload.keys.length > 0)) && rootFilters.length === 0 && rootLogic.length === 0) {
      throw new PgrstError(400, { code: '21000', message: `${kind.toUpperCase()} requires a WHERE clause`, details: null, hint: null })
    }
    const handler: BodyHandler = !representation ? 'none' : media === 'single' ? 'single' : 'array'
    const upsertMerge = kind === 'insert' && prefer.resolution === 'merge'
    const text = mainWrite(sql, mutation, plan, handler, upsertMerge)
    const row = await this.opts.tx.run({ readOnly: false, identity, request: req, cache }, async (tx) => {
      const { rows } = await tx.query<MainRow>(text, sql.params)
      const r = rows[0]
      const n = Number(r.page_total)
      if (media === 'single' && n !== 1) throw singularity(n)
      if (prefer.handling === 'strict' && prefer.maxAffected !== null && kind !== 'insert' && n > prefer.maxAffected) {
        throw new PgrstError(400, { code: 'PGRST124', message: 'Query result exceeds max-affected preference constraint', details: `The query affects ${n} rows`, hint: null })
      }
      return { value: r, rollback: false }
    })
    const n = Number(row.page_total)
    const countTotal = prefer.count !== null ? n : null
    const headers: Record<string, string> = {}
    const applied: string[] = []
    if (kind === 'insert' && prefer.resolution && (table.primaryKey.length > 0 || qp.onConflict)) applied.push(`resolution=${prefer.resolution}-duplicates`)
    if (prefer.return) applied.push(`return=${prefer.return}`)
    if (prefer.count) applied.push(`count=${prefer.count}`)
    if (applied.length) headers['preference-applied'] = applied.join(', ')
    const body = representation ? (row.body ?? '') : null
    if (media === 'single' && representation) headers['content-type'] = 'application/vnd.pgrst.object+json; charset=utf-8'
    if (kind === 'insert') {
      headers['content-range'] = contentRange(1, 0, countTotal)
      const inserted = row.response_inserted === null || row.response_inserted === '' ? null : Number(row.response_inserted)
      const status = prefer.resolution === 'merge' && inserted !== null && inserted <= 0 ? 200 : 201
      return respond(status, body, headers)
    }
    if (kind === 'update') headers['content-range'] = contentRange(0, n - 1, countTotal)
    else headers['content-range'] = contentRange(1, 0, countTotal)
    return representation ? respond(200, body, headers) : respond(204, null, headers)
  }

  private async call(req: PgQueryRequest, identity: Identity, name: string, method: string, prefer: Prefer, media: MediaKind) {
    const isPost = method === 'POST'
    const qp = parseQueryParams(req.search, !isPost)
    const payload = isPost ? readPayload(req.body, qp.columns, true) : null
    const keys = isPost ? payload!.keys : [...new Set(qp.rpcArgs.map(([k]) => k))].sort()
    const { cache, hit } = await this.cacheWith((c) => {
      const fns = c.functions.get(name)
      if (!fns) return undefined
      const found = findProc(fns, keys, isPost)
      return found === 'none' ? undefined : found
    })
    if (!hit) throw noRpc(cache.schema, name, keys, isPost)
    if (Array.isArray(hit)) throw ambiguousRpc(hit)
    const fn = hit
    const range = this.topRange(qp)
    const rootName = fn.returnsComposite ? fn.returnTypeName : fn.name
    const plan = buildReadPlan({ cache, rootName, action: 'call', params: qp, aggregatesEnabled: !!this.opts.aggregatesEnabled, maxRows: this.opts.maxRows })
    const keySet = new Set(keys)
    const onePos = fn.params.length === 1 && fn.params[0].name === ''
    const sql = new SqlBuilder()
    const call = callToQuery(
      sql,
      {
        fn,
        params: onePos ? fn.params : fn.params.filter((p) => keySet.has(p.name)),
        jsonBody: payload?.body ?? null,
        bodyIsObject: payload?.isObject ?? true,
        directArgs: isPost ? null : new Map(qp.rpcArgs),
      },
      plan,
    )
    const head = method === 'HEAD'
    const count = prefer.count !== null
    const handler: BodyHandler = head ? 'none' : media === 'single' ? 'single' : 'array'
    const text = mainCall(sql, call, plan, fn, count, handler)
    const readOnly = !isPost || fn.volatility !== 'v'
    const row = await this.opts.tx.run({ readOnly, identity, request: req, cache }, async (tx) => {
      const { rows } = await tx.query<MainRow>(text, sql.params)
      const r = rows[0]
      if (media === 'single' && Number(r.page_total) !== 1) throw singularity(Number(r.page_total))
      return { value: r, rollback: false }
    })
    const pageTotal = Number(row.page_total)
    const total = row.total_result_set === null ? null : Number(row.total_result_set)
    const lower = range.offset
    const upper = lower + pageTotal - 1
    const status = rangeStatus(lower, upper, total)
    const headers: Record<string, string> = { 'content-range': contentRange(lower, upper, total) }
    if (count) headers['preference-applied'] = `count=${prefer.count}`
    const returnsVoid = !fn.returnsSet && !fn.returnsComposite && fn.returnTypeName === 'void'
    if (returnsVoid) return respond(204, null, headers)
    if (status === 416) return { ...errorResponse(outOfRange(range.offset, total)), headers: { ...headers, 'content-type': JSON_CT } }
    if (media === 'single') headers['content-type'] = 'application/vnd.pgrst.object+json; charset=utf-8'
    return respond(status, head ? '' : (row.body ?? ''), headers)
  }
}
