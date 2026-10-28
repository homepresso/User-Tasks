/**
 * Built-in auth building blocks that need no database: cookie flags, the
 * database identity (claims and the HS256 token minted for PostgREST /
 * Realtime), password policy and settings defaults.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { jwtVerify } from 'jose'
import { authCookieOptions, authCookieSecure, sessionCookieName } from '@/lib/providers/auth/cookies'
import { dbIdentityFor, mintSupabaseAccessToken } from '@/lib/providers/auth/db-identity'
import { checkPasswordPolicy } from '@/lib/providers/auth/builtin/passwords'
import { authSettings } from '@/lib/providers/auth/options'

const ENV = ['APP_URL', 'AUTH_COOKIE_SECURE', 'SUPABASE_JWT_SECRET', 'NODE_ENV'] as const
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete (process.env as Record<string, string | undefined>)[k]
    else (process.env as Record<string, string | undefined>)[k] = saved[k]
  }
})

describe('auth cookies', () => {
  it('HttpOnly + SameSite=Lax always; Secure unless APP_URL is plain http; __Host- prefix when Secure', () => {
    process.env.APP_URL = 'https://tasks.example.com'
    delete process.env.AUTH_COOKIE_SECURE
    expect(authCookieSecure()).toBe(true)
    expect(authCookieOptions(60)).toEqual({ httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: 60 })
    expect(sessionCookieName()).toBe('__Host-ut_session')
    process.env.APP_URL = 'http://localhost:3100'
    expect(authCookieSecure()).toBe(false)
    expect(sessionCookieName()).toBe('ut_session')
    process.env.AUTH_COOKIE_SECURE = 'true'
    expect(authCookieSecure()).toBe(true)
  })
})

describe('database identity', () => {
  it('claims mirror a Supabase session; minted tokens are HS256, short-lived and need the secret', async () => {
    const identity = dbIdentityFor({ id: 'u-1', email: 'a@x.test' }, 's-1')
    expect(identity).toMatchObject({ role: 'authenticated', claims: { sub: 'u-1', role: 'authenticated', aud: 'authenticated', email: 'a@x.test', session_id: 's-1' } })
    delete process.env.SUPABASE_JWT_SECRET
    await expect(mintSupabaseAccessToken(identity)).rejects.toThrow(/SUPABASE_JWT_SECRET/)
    process.env.SUPABASE_JWT_SECRET = 'x'.repeat(40)
    const { token, expiresAt } = await mintSupabaseAccessToken(identity, { ttlSeconds: 120 })
    const { payload, protectedHeader } = await jwtVerify(token, new TextEncoder().encode('x'.repeat(40)), { audience: 'authenticated' })
    expect(protectedHeader.alg).toBe('HS256')
    expect(payload).toMatchObject({ sub: 'u-1', role: 'authenticated', iss: 'usertasks' })
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(120_000)
  })
})

describe('password policy and settings', () => {
  it('enforces the minimum length and bcrypt’s 72-byte limit', () => {
    expect(() => checkPasswordPolicy('short', 8)).toThrow(/at least 8/)
    expect(() => checkPasswordPolicy('é'.repeat(37), 8)).toThrow(/72 bytes/)
    expect(() => checkPasswordPolicy('long-enough', 8)).not.toThrow()
  })

  it('defaults: invite-only, confirmation required, 7-day idle / 30-day sessions, lockout after 10', () => {
    expect(authSettings({})).toEqual({
      allowSignup: false, requireEmailConfirmation: true, sessionIdleMs: 168 * 3600_000, sessionMaxMs: 30 * 86_400_000,
      lockoutThreshold: 10, lockoutMs: 15 * 60_000, passwordMinLength: 8,
    })
    expect(authSettings({ allow_signup: 'true', lockout_threshold: '3', password_min_length: '2' })).toMatchObject({ allowSignup: true, lockoutThreshold: 3, passwordMinLength: 8 })
  })
})
