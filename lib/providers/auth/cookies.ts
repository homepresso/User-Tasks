import { configuredAppUrl, readEnv } from '@/lib/config/bootstrap'
import { baseDomainFromEnv, canShareCookies, isUnderBaseDomain } from '@/lib/workspace-address'

/**
 * Cookie flags for every auth cookie the server sets (the Supabase session
 * cookies, the built-in session cookie and short-lived SSO flow cookies):
 * HttpOnly (the browser never reads them), SameSite=Lax (sent on top-level
 * navigations such as an IdP redirect back, never on cross-site POSTs) and
 * Secure unless the app runs on plain http (local development).
 */

export function authCookieSecure(): boolean {
  const override = readEnv('AUTH_COOKIE_SECURE')?.trim().toLowerCase()
  if (override && ['1', 'true', 'yes', 'on'].includes(override)) return true
  if (override && ['0', 'false', 'no', 'off'].includes(override)) return false
  const appUrl = configuredAppUrl()?.trim()
  if (appUrl) return !appUrl.toLowerCase().startsWith('http://')
  return readEnv('NODE_ENV') === 'production'
}

export interface AuthCookieOptions {
  httpOnly: true
  secure: boolean
  sameSite: 'lax'
  path: '/'
  maxAge?: number
  domain?: string
  /** Supabase only: the session cookie's name (storage key); unset = @supabase/ssr's default `sb-<ref>-auth-token`. */
  name?: string
}

/**
 * Cookie flags. `domain` (from sharedCookieDomain) scopes the cookie to the
 * base domain and all its workspace subdomains; without it the cookie is
 * host-only, as before.
 */
export function authCookieOptions(maxAgeSeconds?: number, domain?: string): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds !== undefined ? { maxAge: Math.max(0, Math.floor(maxAgeSeconds)) } : {}),
    ...(domain ? { domain } : {}),
  }
}

/*
 * Sessions across workspace subdomains (acme.usertasks.com).
 *
 * Without workspace subdomains every session cookie is host-only, exactly as
 * before (`__Host-ut_session`, `sb-<ref>-auth-token`). With them, a request
 * on the base domain or one of its subdomains gets cookies scoped to the base
 * domain (`Domain=usertasks.com`), so one sign-in works on every workspace
 * address and one sign-out clears it everywhere:
 *  - built-in auth: `__Secure-ut_session` (a `__Host-` cookie can't carry a
 *    Domain; `__Secure-` still forces Secure), HttpOnly, SameSite=Lax;
 *  - Supabase Auth: `__Secure-sb-ut-auth-token` (+ chunks), HttpOnly,
 *    SameSite=Lax. The proxy moves an existing host-only session over once
 *    (lib/supabase/middleware.ts), so nobody is signed out by the switch.
 * Only when the base domain has a dot and cookies are Secure (browsers
 * don't share `Domain=localhost` cookies with `*.localhost`; local http
 * development signs in on each host instead). Requests on any other host
 * (a preview URL) keep host-only cookies.
 *
 * Trade-off: every host under the base domain receives the session cookie,
 * so nothing but this app may be served from the base domain's subdomains
 * (docs/self-hosting.md "Workspace addresses").
 */

/** The cookie Domain for a request on `host`, or undefined for a host-only cookie. */
export function sharedCookieDomain(host: string | null | undefined, secure = authCookieSecure()): string | undefined {
  const base = baseDomainFromEnv()
  if (!canShareCookies(base, secure) || !isUnderBaseDomain(host, base)) return undefined
  return base ?? undefined
}

/** sharedCookieDomain for the current request (server components, actions, route handlers). */
export async function requestCookieDomain(): Promise<string | undefined> {
  if (!baseDomainFromEnv()) return undefined
  try {
    const { headers } = await import('next/headers')
    const h = await headers()
    return sharedCookieDomain(h.get('x-forwarded-host') ?? h.get('host'))
  } catch {
    return undefined
  }
}

/** The Supabase session cookie name when it is shared across subdomains. */
export const SHARED_SUPABASE_COOKIE = '__Secure-sb-ut-auth-token'

/** Supabase cookie options for a request whose shared Domain is `domain` (undefined = host-only, the default name). */
export function supabaseCookieOptions(domain: string | undefined): AuthCookieOptions {
  return domain ? { ...authCookieOptions(undefined, domain), name: SHARED_SUPABASE_COOKIE } : authCookieOptions()
}

/** Whether a cookie name is a Supabase session cookie (host-only default or shared). */
export function isSupabaseCookieName(name: string): boolean {
  return name.startsWith('sb-') || name.startsWith(SHARED_SUPABASE_COOKIE)
}

/**
 * The built-in session cookie: `__Secure-ut_session` with a shared Domain;
 * otherwise `__Host-` (Secure, Path=/, no Domain: bound to this exact
 * origin) whenever the cookie is Secure; plain http can't use a prefix.
 */
export function sessionCookieName(secure = authCookieSecure(), shared = false): string {
  if (shared && secure) return '__Secure-ut_session'
  return secure ? '__Host-ut_session' : 'ut_session'
}

/** Every spelling (shared first), so a flag change doesn't strand a session. */
export const SESSION_COOKIE_NAMES = ['__Secure-ut_session', '__Host-ut_session', 'ut_session'] as const

/** Short-lived cookie that binds an SSO round trip to the browser that started it. */
export function ssoFlowCookieName(secure = authCookieSecure()): string {
  return secure ? '__Host-ut_sso' : 'ut_sso'
}

export const SSO_FLOW_COOKIE_NAMES = ['__Host-ut_sso', 'ut_sso'] as const
