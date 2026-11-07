import { createServerClient } from "@supabase/ssr"
import { supabaseAnonKey, supabaseUrl } from "@/lib/config/bootstrap"
import { isSupabaseCookieName, SHARED_SUPABASE_COOKIE, sharedCookieDomain, supabaseCookieOptions, authCookieOptions } from "@/lib/providers/auth/cookies"
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
  const hasSupabaseCookies = request.cookies.getAll().some(c => isSupabaseCookieName(c.name))
  if (!hasSupabaseCookies) {
    return supabaseResponse
  }

  // Workspace subdomains: on the base domain the session cookie is shared
  // (Domain=<base>, lib/providers/auth/cookies.ts). A host-only session from
  // before is moved over once, so the switch signs nobody out.
  const domain = sharedCookieDomain(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))
  const moved = domain ? adoptHostOnlySession(request) : []
  if (moved.length) supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    supabaseUrl()!,
    supabaseAnonKey()!,
    {
      // Same flags as the sign-in path (lib/supabase/server): httpOnly — the
      // browser never reads the session.
      cookieOptions: supabaseCookieOptions(domain),
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

  if (moved.length) {
    // Write the shared copies (unless the refresh above already rewrote them) and expire the host-only originals.
    for (const { from, to, value } of moved) {
      if (!supabaseResponse.cookies.get(to)) supabaseResponse.cookies.set(to, value, authCookieOptions(400 * 86_400, domain))
      supabaseResponse.cookies.set(from, '', authCookieOptions(0))
    }
  }

  return supabaseResponse
}

const HOST_ONLY_SESSION_RE = /^sb-[a-z0-9]+-auth-token((?:\.\d+)?)$/i

/**
 * Copy a host-only Supabase session (`sb-<ref>-auth-token`, `.0`, `.1`, …)
 * onto the shared cookie name for this request, when there is no shared
 * session yet. Returns the cookies to rewrite on the response.
 */
function adoptHostOnlySession(request: NextRequest): Array<{ from: string; to: string; value: string }> {
  const all = request.cookies.getAll()
  if (all.some((c) => c.name.startsWith(SHARED_SUPABASE_COOKIE))) return []
  const moved: Array<{ from: string; to: string; value: string }> = []
  for (const c of all) {
    const match = HOST_ONLY_SESSION_RE.exec(c.name)
    if (!match || !c.value) continue
    moved.push({ from: c.name, to: `${SHARED_SUPABASE_COOKIE}${match[1]}`, value: c.value })
  }
  for (const m of moved) request.cookies.set(m.to, m.value)
  return moved
}
