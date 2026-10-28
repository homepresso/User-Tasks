import { createClient as createSupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js'
import { activeDbProvider, lazyPostgresFetch } from '@/lib/providers/db'

/**
 * createClient for the DB-backed tests. With the default provider it is
 * supabase-js against the local stack's PostgREST, as before. With
 * DB_PROVIDER=postgres the same client's REST calls are served by pg-query
 * (lib/providers/db/postgres): the bearer token decides the identity exactly
 * as PostgREST would (service key → service_role, user sessions verified
 * against Supabase Auth's JWKS, anon key → anon), so these suites exercise
 * RLS and the services through the postgres provider. Auth and storage calls
 * still go to the stack.
 *
 * PostgREST on the local stack verifies the stack's API keys with the
 * stack's well-known JWT secret; pg-query needs that same secret to accept
 * them, so it defaults to it here (as CI sets it) unless one is configured.
 */
const LOCAL_STACK_JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createClient(url: string, key: string, options: SupabaseClientOptions<any> = {}) {
  if (activeDbProvider() !== 'postgres') return createSupabaseClient(url, key, options)
  process.env.SUPABASE_JWT_SECRET ||= LOCAL_STACK_JWT_SECRET
  return createSupabaseClient(url, key, { ...options, global: { ...options.global, fetch: lazyPostgresFetch('session') } })
}
