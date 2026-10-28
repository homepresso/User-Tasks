import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { PostgrestClient } from '@supabase/postgrest-js'
import pg from 'pg'
import { createPgQuery, type Identity, type PgQuery } from '../../src/index'

/**
 * Conformance harness: the same postgrest-js query runs against the local
 * Supabase stack's real PostgREST and against pg-query (same role and JWT
 * claims), and the whole `{ data, error, count, status, statusText }` result
 * must match. Runs only when EVENT_STREAM_DB_URL points at the local stack.
 */

export const DB_URL = process.env.EVENT_STREAM_DB_URL
export const API_URL = process.env.PGQ_CONFORMANCE_API_URL ?? 'http://127.0.0.1:54321'
const JWT_SECRET = process.env.PGQ_CONFORMANCE_JWT_SECRET ?? 'super-secret-jwt-token-with-at-least-32-characters-long'

export const T = 'c0f00000-0000-4000-8000-000000000001'
export const ALICE = 'a1f00000-0000-4000-8000-0000000000a1'
export const BOB = 'b2f00000-0000-4000-8000-0000000000b2'
export const CAROL = 'c3f00000-0000-4000-8000-0000000000c3'
/** Fixture ids: `id(0x301)` → c0f00000-0000-4000-8000-000000000301. */
export const id = (n: number) => `c0f00000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

export type Who = 'service' | 'alice' | 'bob' | 'carol' | 'anon'

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
function sign(payload: Record<string, unknown>): string {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64(payload)
  return `${h}.${p}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')}`
}

const userClaims = (sub: string, email: string) => ({
  aud: 'authenticated',
  exp: 2000000000,
  iat: 1700000000,
  sub,
  email,
  role: 'authenticated',
  app_metadata: { provider: 'email' },
  user_metadata: {},
  is_anonymous: false,
})

export const CLAIMS: Record<Who, Record<string, unknown>> = {
  service: { iss: 'supabase-demo', role: 'service_role', exp: 1983812996 },
  anon: { iss: 'supabase-demo', role: 'anon', exp: 1983812996 },
  alice: userClaims(ALICE, 'alice@pgq.test'),
  bob: userClaims(BOB, 'bob@pgq.test'),
  carol: userClaims(CAROL, 'carol@pgq.test'),
}

export type Db = PostgrestClient
export type Run = (db: Db) => PromiseLike<unknown>

export interface Case {
  name: string
  /** Real call site the query was taken from (documentation). */
  from?: string
  as?: Who[]
  run: Run
  /** Compare arrays in order (default: order-normalised). */
  ordered?: boolean
  /** Keys whose values legitimately differ between runs (e.g. now()). */
  volatile?: string[]
  /** Write cases: SQL run before each side (and after the case). */
  reset?: string
  /** Write cases: SQL whose result (the resulting state) must also match. */
  after?: string
}

export interface Sides {
  rest: Record<Who, Db>
  pgq: Record<Who, Db>
  engine: PgQuery
  pool: pg.Pool
  admin: pg.Client
}

export async function setup(): Promise<Sides> {
  const admin = new pg.Client({ connectionString: DB_URL })
  await admin.connect()
  const dir = path.dirname(new URL(import.meta.url).pathname)
  await admin.query(readFileSync(path.join(dir, 'cleanup.sql'), 'utf8'))
  await admin.query(readFileSync(path.join(dir, 'fixtures.sql'), 'utf8'))
  const pool = new pg.Pool({ connectionString: DB_URL, max: 4 })
  // Same max_rows as the local stack's PostgREST (supabase/config.toml).
  const engine = createPgQuery({ pool, maxRows: 1000 })
  const serviceKey = sign(CLAIMS.service)
  const rest = {} as Record<Who, Db>
  const pgq = {} as Record<Who, Db>
  for (const who of Object.keys(CLAIMS) as Who[]) {
    const token = sign(CLAIMS[who])
    rest[who] = new PostgrestClient(`${API_URL}/rest/v1`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } })
    const identity: Identity = { role: String(CLAIMS[who].role), claims: CLAIMS[who] }
    pgq[who] = engine.client(identity)
  }
  return { rest, pgq, engine, pool, admin }
}

export async function teardown(s: Sides | undefined) {
  if (!s) return
  const dir = path.dirname(new URL(import.meta.url).pathname)
  await s.admin.query(readFileSync(path.join(dir, 'cleanup.sql'), 'utf8')).catch(() => undefined)
  await s.admin.end()
  await s.pool.end()
}

function canonical(value: unknown, sortArrays: boolean, volatile: Set<string>): unknown {
  if (Array.isArray(value)) {
    const items = value.map((v) => canonical(v, sortArrays, volatile))
    return sortArrays ? items.sort((a, b) => (JSON.stringify(a) < JSON.stringify(b) ? -1 : JSON.stringify(a) > JSON.stringify(b) ? 1 : 0)) : items
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(value).sort()) {
      out[k] = volatile.has(k) ? '<volatile>' : canonical((value as Record<string, unknown>)[k], sortArrays, volatile)
    }
    return out
  }
  return value
}

/**
 * PostgREST adds "Perhaps you meant ..." hints from a fuzzy search over the
 * schema cache for unknown tables / functions / relationships; pg-query
 * leaves them out (documented difference), so they aren't compared.
 */
const FUZZY_HINT_CODES = new Set(['PGRST200', 'PGRST202', 'PGRST205'])

export function normalise(result: unknown, c: Case): unknown {
  const out = canonical(result, !c.ordered, new Set(c.volatile ?? [])) as { error?: { code?: string; hint?: unknown } | null }
  if (out && typeof out === 'object' && out.error && FUZZY_HINT_CODES.has(String(out.error.code))) out.error.hint = '<fuzzy hint not compared>'
  return out
}

export async function runBoth(s: Sides, c: Case, who: Who): Promise<{ rest: unknown; pgq: unknown; restAfter?: unknown; pgqAfter?: unknown }> {
  const once = async (db: Db) => {
    if (c.reset) await s.admin.query(c.reset)
    const result = await c.run(db)
    const after = c.after ? (await s.admin.query(c.after)).rows : undefined
    return { result, after }
  }
  const r = await once(s.rest[who])
  const p = await once(s.pgq[who])
  if (c.reset) await s.admin.query(c.reset)
  return {
    rest: normalise(r.result, c),
    pgq: normalise(p.result, c),
    restAfter: r.after && normalise(r.after, c),
    pgqAfter: p.after && normalise(p.after, c),
  }
}
