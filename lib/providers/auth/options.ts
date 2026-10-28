/**
 * Auth provider options (`auth.<option>` instance settings, or the environment
 * variables below, which win). Any option can be a secret reference
 * (`secret://<name>`); inside `sso_providers`, client secrets can be too.
 *
 * builtin / oidc / saml:
 *   sso_providers               JSON array of OIDC / SAML IdPs (lib/providers/auth/sso/config.ts)
 *   allow_signup                anyone may create a password account (default
 *                               false: only invited emails, as on Supabase)
 *   require_email_confirmation  send a confirmation link before the first
 *                               sign-in (default true; skipped when the user
 *                               arrives with a matching invite token)
 *   session_idle_hours          rolling idle timeout (default 168 = 7 days)
 *   session_max_days            absolute session lifetime (default 30)
 *   lockout_threshold           failed passwords before a lockout (default 10)
 *   lockout_minutes             lockout duration (default 15)
 *   password_min_length         default 8
 *
 * AUTH_COOKIE_SECURE (environment only, read on every response) forces the
 * Secure cookie flag on/off; by default it is on unless APP_URL is plain http.
 */

export const AUTH_OPTION_ENV: Record<string, string> = {
  sso_providers: 'AUTH_SSO_PROVIDERS',
  allow_signup: 'AUTH_ALLOW_SIGNUP',
  require_email_confirmation: 'AUTH_REQUIRE_EMAIL_CONFIRMATION',
  session_idle_hours: 'AUTH_SESSION_IDLE_HOURS',
  session_max_days: 'AUTH_SESSION_MAX_DAYS',
  lockout_threshold: 'AUTH_LOCKOUT_THRESHOLD',
  lockout_minutes: 'AUTH_LOCKOUT_MINUTES',
  password_min_length: 'AUTH_PASSWORD_MIN_LENGTH',
}

/** `sso_providers` carries client secrets: store it encrypted, or use secret:// refs inside it. */
export const AUTH_SECRET_OPTIONS = new Set(['sso_providers'])

export interface AuthSettings {
  allowSignup: boolean
  requireEmailConfirmation: boolean
  sessionIdleMs: number
  sessionMaxMs: number
  lockoutThreshold: number
  lockoutMs: number
  passwordMinLength: number
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  const text = String(value ?? '').trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}

function num(value: unknown, fallback: number, min: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n >= min ? n : fallback
}

export function authSettings(options: Record<string, unknown>): AuthSettings {
  return {
    allowSignup: bool(options.allow_signup, false),
    requireEmailConfirmation: bool(options.require_email_confirmation, true),
    sessionIdleMs: num(options.session_idle_hours, 168, 0.1) * 3600_000,
    sessionMaxMs: num(options.session_max_days, 30, 0.01) * 86_400_000,
    lockoutThreshold: Math.floor(num(options.lockout_threshold, 10, 1)),
    lockoutMs: num(options.lockout_minutes, 15, 0) * 60_000,
    passwordMinLength: Math.floor(num(options.password_min_length, 8, 6)),
  }
}
