import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { databaseUrl, getEnvProviderOverrides, supabaseAnonKey, supabaseServiceRoleKey, supabaseUrl } from '@/lib/config/bootstrap'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import type { Database } from '@/lib/database.types'

/**
 * Database client seam (server side).
 *
 * Every privileged and cookie-bound database client is created here. With
 * the default Supabase provider these are the same supabase-js clients the
 * call sites used to build themselves. With DB_PROVIDER=postgres they are
 * still supabase-js clients (same API, auth and storage still on Supabase),
 * but their REST requests are served in-process by @usertasks/pg-query over
 * DATABASE_URL (./postgres) instead of by PostgREST.
 *
 *  - getServiceDb()  service-role client (bypasses RLS). Internal jobs,
 *                    API/MCP credential paths, OAuth server. Callers filter
 *                    tenant_id explicitly.
 *  - getSessionDb()  cookie-bound client for the signed-in user (RLS applies),
 *                    in ./session (next/headers must stay out of this module:
 *                    shared modules that client components import use it).
 *  - getBrowserDb()  client components, in ./browser.
 *
 * A fresh client per call, as before: supabase-js clients are cheap, and the
 * few call sites that kept one per process still do so themselves.
 */

// Service-role REST clients were untyped at every call site; typed callers opt in.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceDb<DB = any> = SupabaseClient<DB>

export interface ServiceDbOptions {
  /**
   * Fall back to the anon key when no service-role key is configured. Kept
   * only for the call sites that always behaved this way (the workflow
   * engine, SLA scheduler, inbound webhooks, profile/last-seen updates).
   */
  anonFallback?: boolean
}

/**
 * Active db provider. Environment only (DB_PROVIDER): the database can't
 * hold the setting that says how to reach it, and this is read synchronously
 * on every client creation.
 */
export function activeDbProvider(): ProviderId<'db'> {
  return getEnvProviderOverrides().db ?? DEFAULT_PROVIDERS.db
}

// supabase-js needs a URL and key even when only REST is used (postgres
// provider without a Supabase project configured).
const PLACEHOLDER_URL = 'http://localhost'
const PLACEHOLDER_KEY = 'pg-query'

/**
 * fetch that serves REST requests from pg-query. The runtime (and `pg`) is
 * imported on first use, and never in a browser bundle: some modules that
 * client components import also import this one.
 */
export function lazyPostgresFetch(kind: 'service' | 'anon' | 'session', identity?: DbIdentityClaims | null): typeof fetch {
  let real: typeof fetch | null = null
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (!real) {
      const mod = typeof window === 'undefined' ? await import('./postgres') : null
      if (!mod) throw new Error('The postgres database provider runs on the server only')
      real = identity !== undefined ? mod.postgresIdentityFetch(identity) : mod.postgresFetch(kind)
    }
    return real(input, init)
  }) as typeof fetch
}

/** A database identity: role + JWT claims (lib/providers/auth DbIdentity). */
export interface DbIdentityClaims {
  role: string
  claims: Record<string, unknown> & { sub: string }
}

/**
 * Client for a user signed in through the built-in session store (builtin /
 * oidc / saml auth); null = anonymous. RLS sees the same claims a Supabase
 * session would carry:
 *  - postgres: pg-query runs every request with `identity` (no token at all);
 *  - supabase: PostgREST gets a short-lived HS256 JWT for it, signed with
 *    SUPABASE_JWT_SECRET (lib/providers/auth/db-identity).
 * The client has no auth session of its own (`.auth` is unusable by design).
 */
export async function getIdentityDb(identity: DbIdentityClaims | null): Promise<ServiceDb<Database>> {
  const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  if (activeDbProvider() === 'postgres') {
    return createClient<Database>(supabaseUrl() || PLACEHOLDER_URL, supabaseAnonKey() || PLACEHOLDER_KEY, {
      auth,
      global: { fetch: lazyPostgresFetch('session', identity) },
    }) as unknown as ServiceDb<Database>
  }
  if (!identity) return createClient<Database>(supabaseUrl() as string, supabaseAnonKey() as string, { auth }) as unknown as ServiceDb<Database>
  const { mintSupabaseAccessToken } = await import('@/lib/providers/auth/db-identity')
  const { token } = await mintSupabaseAccessToken(identity as Parameters<typeof mintSupabaseAccessToken>[0])
  return createClient<Database>(supabaseUrl() as string, supabaseAnonKey() as string, {
    auth,
    global: { headers: { Authorization: `Bearer ${token}` } },
  }) as unknown as ServiceDb<Database>
}

/** True when a service-role client can be created (URL and key configured; DATABASE_URL for postgres). */
export function hasServiceDb(): boolean {
  if (activeDbProvider() === 'postgres') return Boolean(databaseUrl())
  return Boolean(supabaseUrl() && supabaseServiceRoleKey())
}

/**
 * Service-role client. Like the call sites it replaces, it doesn't pre-check
 * the config: a missing URL/key fails inside supabase-js when the client is
 * created. Use requireServiceDb() for a descriptive error instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getServiceDb<DB = any>(options: ServiceDbOptions = {}): ServiceDb<DB> {
  const key = supabaseServiceRoleKey() || (options.anonFallback ? supabaseAnonKey() : undefined)
  if (activeDbProvider() === 'postgres') {
    // Same anon fallback as before: without a service key those callers ran as anon.
    const kind = !supabaseServiceRoleKey() && key ? 'anon' : 'service'
    return createClient<DB>(supabaseUrl() || PLACEHOLDER_URL, key || PLACEHOLDER_KEY, {
      global: { fetch: lazyPostgresFetch(kind) },
    }) as unknown as ServiceDb<DB>
  }
  return createClient<DB>(supabaseUrl() as string, key as string) as unknown as ServiceDb<DB>
}

/** Service-role client that throws `message` when the URL or key is missing (no anon fallback). */
export function requireServiceDb(
  message = 'Service database client: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY must be set',
): ServiceDb {
  if (!hasServiceDb()) throw new Error(message)
  return getServiceDb()
}

/** Typed service-role client (generated Database types). */
export function getTypedServiceDb(options: ServiceDbOptions = {}): ServiceDb<Database> {
  return getServiceDb<Database>(options)
}
