import { createServerClient } from "@supabase/ssr"
import { supabaseAnonKey, supabaseUrl } from "@/lib/config/bootstrap"
import { activeDbProvider, lazyPostgresFetch } from "@/lib/providers/db"
import { activeAuthProviderId, resolveAuthProvider, type SessionUser } from "@/lib/providers/auth"
import { authCookieOptions } from "@/lib/providers/auth/cookies"
import { cookies } from "next/headers"
import { cache } from "react"
import type { Database } from "@/lib/database.types"

/**
 * Supabase Auth's cookie-bound client (@supabase/ssr). The session lives in
 * httpOnly sb-* cookies written here (sign-in server actions, the OAuth
 * callback) and refreshed by the proxy (./middleware). Only the Supabase
 * AuthProvider (lib/providers/auth/supabase) and the session database client
 * below use it.
 */
export async function createSupabaseAuthClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(
    supabaseUrl()!,
    supabaseAnonKey()!,
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — can be ignored
            // if middleware refreshes the session
          }
        },
      },
      auth: {
        suppressGetSessionWarning: true,
      } as any,
      // DB_PROVIDER=postgres: REST queries run in-process (lib/providers/db/postgres)
      // with this session's verified access token as the RLS identity.
      ...(activeDbProvider() === "postgres" ? { global: { fetch: lazyPostgresFetch("session") } } : {}),
    }
  )
}

type SessionClient = Awaited<ReturnType<typeof createSupabaseAuthClient>>

/**
 * Database client for the current request's user (RLS applies).
 *
 * Supabase Auth: the @supabase/ssr client above, as always. Built-in / OIDC /
 * SAML auth: a client whose requests carry the built-in session's identity
 * (lib/providers/db getIdentityDb: pg-query claims, or a short-lived JWT for
 * PostgREST). Either way, identity comes from getCachedUser() — never call
 * `.auth.getUser()` on this client.
 */
export async function createClient(): Promise<SessionClient> {
  const authId = await activeAuthProviderId()
  if (authId === "supabase") return createSupabaseAuthClient()
  const provider = resolveAuthProvider(authId)
  const user = await provider.getSessionUser()
  const { getIdentityDb } = await import("@/lib/providers/db")
  return (await getIdentityDb(user ? provider.getDbIdentity(user) : null)) as unknown as SessionClient
}

/**
 * Request-scoped cached user fetch.
 *
 * React's `cache()` wrapper memoizes within a single server request, so if
 * multiple server actions / API routes / server components all call
 * `getCachedUser()` during the same request, we hit Supabase's auth
 * endpoint exactly ONCE. This is the fix for the "over_request_rate_limit"
 * 429 errors — previously every server action independently called
 * `supabase.auth.getUser()` which validates the JWT server-side on every
 * call and counts against the per-IP rate limit.
 *
 * Usage in server actions (replaces `const { data: { user } } = await supabase.auth.getUser()`):
 *
 *   const user = await getCachedUser()
 *   if (!user) throw new Error('Not authenticated')
 *
 * Returns null for unauthenticated requests (matches the old behavior of
 * `getUser().data.user`). With built-in / OIDC / SAML auth the user comes from
 * the built-in session store instead (lib/providers/auth).
 */
export const getCachedUser = cache(async (): Promise<SessionUser | null> => {
  const authId = await activeAuthProviderId()
  if (authId !== "supabase") return resolveAuthProvider(authId).getSessionUser()
  const supabase = await createSupabaseAuthClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/**
 * The session's user without a round trip to Supabase Auth (a local cookie
 * read, like `auth.getSession()`): for cheap checks that only need to know
 * whether someone is signed in (heartbeat, home-page redirect). Built-in
 * sessions are always verified (a single indexed lookup).
 */
export async function getSessionUserFast(): Promise<SessionUser | null> {
  const authId = await activeAuthProviderId()
  if (authId !== "supabase") return getCachedUser()
  const supabase = await createSupabaseAuthClient()
  const { data: { session } } = await supabase.auth.getSession()
  return session?.user ?? null
}

/**
 * Convenience helper that pairs the cached user with a fresh Supabase
 * client. Most server actions follow the pattern:
 *
 *   const supabase = await createClient()
 *   const user = await getCachedUser()
 *
 * This returns both in a single call. The client itself is not cached —
 * each call returns a new client bound to the current cookie state —
 * but the `getUser()` result is deduped across the request.
 */
export async function createClientWithUser() {
  const [supabase, user] = await Promise.all([createClient(), getCachedUser()])
  return { supabase, user }
}
