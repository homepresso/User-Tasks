import { Pool } from 'pg'
import { createPgQuery, decodeJwtPayload, JwtVerifier, type Identity, type PgQuery } from '@usertasks/pg-query'
import { databaseUrl, readEnv, supabaseAnonKey, supabaseJwtSecret, supabaseServiceRoleKey, supabaseUrl } from '@/lib/config/bootstrap'
import { ConfigError } from '@/lib/config/schema'
import { pgConnectionConfig } from './pg-auth'

/**
 * Postgres DbProvider runtime (server only; loaded lazily by ./index so `pg`
 * never reaches a client bundle).
 *
 * The supabase-js clients stay — their `.from()` / `.rpc()` requests are
 * answered in-process by @usertasks/pg-query over a `pg` Pool on
 * DATABASE_URL instead of over HTTP by PostgREST. Every query runs in its
 * own transaction as the same role with the same JWT claims PostgREST would
 * use, so RLS policies and auth.uid() apply unchanged:
 *  - service clients: service_role;
 *  - session clients: the caller's access token, verified like PostgREST
 *    verifies it (JWKS from Supabase Auth, or SUPABASE_JWT_SECRET for HS256,
 *    falling back to Supabase Auth's /user endpoint), else the anon role.
 * Auth, storage and functions calls still go to Supabase (until their own
 * provider phases).
 */

interface Runtime {
  url: string
  secret: string | undefined
  pool: Pool
  engine: PgQuery
  verifier: JwtVerifier
}

const globalRef = globalThis as typeof globalThis & { __usertasksPgQuery?: Runtime }

function runtime(): Runtime {
  const url = databaseUrl()
  if (!url) throw new ConfigError('DB_PROVIDER=postgres requires DATABASE_URL')
  const secret = supabaseJwtSecret()
  const current = globalRef.__usertasksPgQuery
  if (current && current.url === url && current.secret === secret) return current
  if (current) void current.pool.end().catch(() => undefined)
  const pool = new Pool(pgConnectionConfig(url, { max: Number(readEnv('DATABASE_POOL_MAX')) || 10, application_name: 'usertasks' }))
  // An idle client erroring (server restart) must not crash the process.
  pool.on('error', () => undefined)
  const authUrl = supabaseUrl()?.replace(/\/+$/, '')
  const verifier = new JwtVerifier({
    secret,
    jwksUrl: authUrl ? `${authUrl}/auth/v1/.well-known/jwks.json` : undefined,
    fallbackVerify: authUrl ? (token) => verifyWithSupabaseAuth(authUrl, token) : undefined,
  })
  // PostgREST's db-max-rows: Supabase caps every read at the project's API
  // max_rows (1000 unless changed); DB_MAX_ROWS mirrors it (0 = no cap).
  const maxRowsEnv = readEnv('DB_MAX_ROWS')
  const maxRows = maxRowsEnv === undefined || maxRowsEnv === '' ? 1000 : Number(maxRowsEnv) || null
  const next: Runtime = { url, secret, pool, engine: createPgQuery({ pool, maxRows }), verifier }
  globalRef.__usertasksPgQuery = next
  return next
}

/** HS256 tokens without a configured secret: Supabase Auth checks them for us. */
async function verifyWithSupabaseAuth(authUrl: string, token: string): Promise<boolean> {
  const apikey = supabaseAnonKey() ?? supabaseServiceRoleKey() ?? ''
  const res = await fetch(`${authUrl}/auth/v1/user`, { headers: { apikey, Authorization: `Bearer ${token}` } }).catch(() => null)
  return Boolean(res?.ok)
}

function keyIdentity(key: string | undefined, role: 'anon' | 'service_role'): Identity {
  // Configured API keys are trusted as-is; legacy ones are JWTs whose payload
  // PostgREST would expose as the claims.
  const payload = key ? decodeJwtPayload(key) : null
  return { role, claims: payload && payload.role === role ? payload : { role } }
}

export function serviceIdentity(): Identity {
  return keyIdentity(supabaseServiceRoleKey(), 'service_role')
}

/** Identity for a request's bearer token, as PostgREST would derive it. */
export async function identityForToken(token: string | null): Promise<Identity> {
  const anonKey = supabaseAnonKey()
  if (!token || token === anonKey) return keyIdentity(anonKey, 'anon')
  if (token === supabaseServiceRoleKey()) return serviceIdentity()
  // Opaque (non-JWT) API keys such as sb_publishable_* act as anon.
  if (token.split('.').length !== 3) return keyIdentity(undefined, 'anon')
  return runtime().verifier.identity(token)
}

function bearer(headers: Headers): string | null {
  const auth = headers.get('authorization')
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null
  return m ? m[1] : null
}

/** fetch for supabase-js clients: REST in-process, everything else to Supabase. */
export function postgresFetch(kind: 'service' | 'anon' | 'session'): typeof fetch {
  const { engine } = runtime()
  if (kind === 'service') return engine.fetch(() => serviceIdentity())
  if (kind === 'anon') return engine.fetch(() => keyIdentity(supabaseAnonKey(), 'anon'))
  return engine.fetch((headers) => identityForToken(bearer(headers)))
}

/** fetch for a built-in auth session client: a fixed identity (anon when null). */
export function postgresIdentityFetch(identity: Identity | null): typeof fetch {
  const { engine } = runtime()
  return engine.fetch(() => identity ?? keyIdentity(supabaseAnonKey(), 'anon'))
}

export function pgQueryEngine(): PgQuery {
  return runtime().engine
}

/** Close the pool (tests and scripts; the app keeps it for the process lifetime). */
export async function closePostgresDb(): Promise<void> {
  const current = globalRef.__usertasksPgQuery
  globalRef.__usertasksPgQuery = undefined
  if (current) await current.pool.end()
}

