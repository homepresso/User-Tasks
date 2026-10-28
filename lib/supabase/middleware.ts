import { createServerClient } from "@supabase/ssr"
import { supabaseAnonKey, supabaseUrl } from "@/lib/config/bootstrap"
import { authCookieOptions } from "@/lib/providers/auth/cookies"
import { NextResponse, type NextRequest } from "next/server"

/**
 * Middleware session refresh.
 *
 * Runs on every request via proxy.ts. Its only job is to refresh the Supabase
 * access token: the SSR client reads the sb-* cookies and writes refreshed
 * ones back to the response, which keeps long sessions alive. Requests without
 * sb-* cookies (public pages, static assets, anonymous API calls) skip the
 * auth client entirely. Identity is validated lazily in server code via
 * getCachedUser() (lib/supabase/server.ts), deduped per request.
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // Fast path: no Supabase auth cookies means nothing to refresh.
  const hasSupabaseCookies = request.cookies.getAll().some(c => c.name.startsWith('sb-'))
  if (!hasSupabaseCookies) {
    return supabaseResponse
  }

  const supabase = createServerClient(
    supabaseUrl()!,
    supabaseAnonKey()!,
    {
      // Same flags as the sign-in path (lib/supabase/server): httpOnly — the
      // browser never reads the session.
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getSession() reads the token from cookies and triggers a background
  // refresh if the access token is expired — critically it does NOT hit
  // the Supabase auth endpoint for JWT validation (unlike getUser()), so
  // it doesn't count against the auth rate limit. We use it instead of
  // getUser() here because all we want is token refresh; server-side
  // identity validation happens lazily inside server actions via
  // getCachedUser() (which uses React cache() to dedupe within a request).
  await supabase.auth.getSession()

  return supabaseResponse
}
