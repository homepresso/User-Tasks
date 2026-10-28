import { configuredAppUrl, readEnv } from '@/lib/config/bootstrap'

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
}

export function authCookieOptions(maxAgeSeconds?: number): AuthCookieOptions {
  return {
    httpOnly: true,
    secure: authCookieSecure(),
    sameSite: 'lax',
    path: '/',
    ...(maxAgeSeconds !== undefined ? { maxAge: Math.max(0, Math.floor(maxAgeSeconds)) } : {}),
  }
}

/**
 * The built-in session cookie. `__Host-` (Secure, Path=/, no Domain: bound to
 * this exact origin) whenever the cookie is Secure; plain http can't use the
 * prefix.
 */
export function sessionCookieName(secure = authCookieSecure()): string {
  return secure ? '__Host-ut_session' : 'ut_session'
}

/** Both spellings, so a flag change doesn't strand a session. */
export const SESSION_COOKIE_NAMES = ['__Host-ut_session', 'ut_session'] as const

/** Short-lived cookie that binds an SSO round trip to the browser that started it. */
export function ssoFlowCookieName(secure = authCookieSecure()): string {
  return secure ? '__Host-ut_sso' : 'ut_sso'
}

export const SSO_FLOW_COOKIE_NAMES = ['__Host-ut_sso', 'ut_sso'] as const
