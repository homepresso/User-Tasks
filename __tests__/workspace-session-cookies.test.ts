/**
 * Sessions across workspace subdomains (lib/providers/auth/cookies.ts):
 *  - built-in auth on the base domain or a workspace address sets
 *    `__Secure-ut_session; Domain=<base>` (HttpOnly, Secure, SameSite=Lax),
 *    so one sign-in works on every address; other hosts keep the host-only
 *    `__Host-ut_session`, local http keeps `ut_session`;
 *  - sign-out revokes the session and clears the shared cookie on its
 *    Domain (every subdomain at once) plus the host-only spellings;
 *  - Supabase Auth: the shared cookie name and Domain, and the proxy moving a
 *    host-only `sb-<ref>-auth-token` session over without signing anyone out.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { cookieWrites, jar, requestHeaders, resetRequest } from './helpers/next-headers-mock'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

const store = vi.hoisted(() => ({ revoked: [] as string[] }))
vi.mock('@/lib/providers/auth/builtin/store', () => ({
  createSession: async () => ({ id: 's1', token: 'session-token-1', expiresAt: new Date(Date.now() + 3600_000) }),
  findSession: async (token: string) => (token === 'session-token-1'
    ? { id: 's1', user_id: 'u1', email: 'ada@example.test', last_seen_at: new Date().toISOString() }
    : null),
  revokeSession: async (token: string) => { store.revoked.push(token) },
  revokeUserSessions: async () => {},
  touchSession: async () => {},
  purgeExpired: async () => {},
}))
vi.mock('@/lib/config', () => ({ getProviderConfig: async () => ({ id: 'builtin', options: {} }) }))

import { createBuiltinAuthProvider, startBuiltinSession } from '@/lib/providers/auth/builtin'
import { SHARED_SUPABASE_COOKIE, sharedCookieDomain, supabaseCookieOptions, sessionCookieName } from '@/lib/providers/auth/cookies'

const ENV = { APP_URL: process.env.APP_URL, DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE, APP_BASE_DOMAIN: process.env.APP_BASE_DOMAIN, AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE, NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }

function onHost(host: string) {
  resetRequest()
  requestHeaders.set('host', host)
}

beforeEach(() => {
  process.env.APP_URL = 'https://usertasks.test'
  process.env.DEPLOYMENT_MODE = 'cloud'
  delete process.env.APP_BASE_DOMAIN
  delete process.env.AUTH_COOKIE_SECURE
  store.revoked = []
})

afterAll(() => {
  for (const [k, v] of Object.entries(ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

describe('cookie domain', () => {
  it('shared on the base domain and its subdomains only', () => {
    expect(sharedCookieDomain('usertasks.test')).toBe('usertasks.test')
    expect(sharedCookieDomain('acme.usertasks.test')).toBe('usertasks.test')
    expect(sharedCookieDomain('www.usertasks.test:443')).toBe('usertasks.test')
    expect(sharedCookieDomain('my-preview.vercel.app')).toBeUndefined()
    expect(sharedCookieDomain('evilusertasks.test')).toBeUndefined()
  })

  it('never over plain http, never for a single-label base, never with subdomains off', () => {
    expect(sharedCookieDomain('acme.usertasks.test', false)).toBeUndefined()
    process.env.APP_URL = 'http://localhost:3100'
    process.env.APP_BASE_DOMAIN = 'localhost'
    expect(sharedCookieDomain('acme.localhost:3100')).toBeUndefined()
    process.env.APP_URL = 'https://usertasks.test'
    process.env.APP_BASE_DOMAIN = 'off'
    expect(sharedCookieDomain('acme.usertasks.test')).toBeUndefined()
    delete process.env.APP_BASE_DOMAIN
    process.env.DEPLOYMENT_MODE = 'self_hosted'
    expect(sharedCookieDomain('acme.usertasks.test')).toBeUndefined()
  })

  it('names: __Secure- for the shared cookie (a __Host- cookie cannot carry a Domain)', () => {
    expect(sessionCookieName(true, true)).toBe('__Secure-ut_session')
    expect(sessionCookieName(true, false)).toBe('__Host-ut_session')
    expect(sessionCookieName(false, true)).toBe('ut_session')
    expect(supabaseCookieOptions('usertasks.test')).toMatchObject({ name: SHARED_SUPABASE_COOKIE, domain: 'usertasks.test', httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(supabaseCookieOptions(undefined)).not.toHaveProperty('name')
    expect(supabaseCookieOptions(undefined)).not.toHaveProperty('domain')
  })
})

describe('built-in auth sessions', () => {
  it('a sign-in on a workspace address sets the shared cookie on the base domain', async () => {
    onHost('acme.usertasks.test')
    await startBuiltinSession('u1', 'password')
    const write = cookieWrites.find((w) => w.name === '__Secure-ut_session' && w.value)
    expect(write?.value).toBe('session-token-1')
    expect(write?.options).toMatchObject({ domain: 'usertasks.test', httpOnly: true, secure: true, sameSite: 'lax', path: '/' })
    expect(cookieWrites.some((w) => w.name === '__Host-ut_session' && w.value)).toBe(false)
    // The same cookie is read back on any address.
    const provider = createBuiltinAuthProvider('builtin')
    expect((await provider.getSessionUser())?.id).toBe('u1')
  })

  it('sign-out revokes the session and clears the shared cookie on its Domain (every subdomain)', async () => {
    onHost('acme.usertasks.test')
    jar.set('__Secure-ut_session', 'session-token-1')
    await createBuiltinAuthProvider('builtin').signOut()
    expect(store.revoked).toEqual(['session-token-1'])
    const cleared = cookieWrites.find((w) => w.name === '__Secure-ut_session')
    expect(cleared).toMatchObject({ value: '', options: { domain: 'usertasks.test', maxAge: 0 } })
    for (const name of ['__Host-ut_session', 'ut_session']) {
      const w = cookieWrites.find((c) => c.name === name)
      expect(w?.value).toBe('')
      expect(w?.options.domain).toBeUndefined()
    }
    expect(jar.size).toBe(0)
  })

  it('a host outside the base domain keeps the host-only __Host- cookie', async () => {
    onHost('my-preview.vercel.app')
    await startBuiltinSession('u1', 'password')
    const write = cookieWrites.find((w) => w.value)
    expect(write?.name).toBe('__Host-ut_session')
    expect(write?.options.domain).toBeUndefined()
  })

  it('local http keeps ut_session, host-only', async () => {
    process.env.APP_URL = 'http://localhost:3100'
    process.env.APP_BASE_DOMAIN = 'localhost'
    onHost('acme.localhost:3100')
    await startBuiltinSession('u1', 'password')
    const write = cookieWrites.find((w) => w.value)
    expect(write?.name).toBe('ut_session')
    expect(write?.options.domain).toBeUndefined()
    expect(write?.options.secure).toBe(false)
  })
})

describe('Supabase Auth sessions (proxy refresh)', () => {
  const session = {
    access_token: 'header.eyJzdWIiOiJ1MSIsImV4cCI6NDEwMjQ0NDgwMH0.sig',
    refresh_token: 'refresh-1',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 4102444800,
    user: { id: 'u1', aud: 'authenticated', email: 'ada@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
  }
  const value = `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`

  it('moves a host-only sb-<ref>-auth-token session onto the shared cookie, once', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon'
    const { updateSession } = await import('@/lib/supabase/middleware')
    const request = new NextRequest('https://acme.usertasks.test/home', { headers: { host: 'acme.usertasks.test', cookie: `sb-127-auth-token=${value}` } })
    const response = await updateSession(request)
    const setCookies = response.headers.getSetCookie()
    const shared = setCookies.find((c) => c.startsWith(`${SHARED_SUPABASE_COOKIE}=`))
    expect(shared).toBeDefined()
    expect(shared).toMatch(/Domain=usertasks\.test/i)
    expect(shared).toMatch(/HttpOnly/i)
    expect(shared).toMatch(/Secure/i)
    expect(shared).toMatch(/SameSite=lax/i)
    const old = setCookies.find((c) => c.startsWith('sb-127-auth-token='))
    expect(old).toMatch(/Max-Age=0/i)
    expect(old).not.toMatch(/Domain=/i)
    // The request carries the shared name upstream for this render.
    expect(response.headers.get('x-middleware-request-cookie') ?? '').toContain(`${SHARED_SUPABASE_COOKIE}=`)

    // With the shared cookie present nothing is moved again.
    const again = await updateSession(new NextRequest('https://acme.usertasks.test/home', { headers: { host: 'acme.usertasks.test', cookie: `${SHARED_SUPABASE_COOKIE}=${value}` } }))
    expect(again.headers.getSetCookie().some((c) => c.startsWith('sb-127-auth-token='))).toBe(false)
  })

  it('off the base domain the host-only session is left alone', async () => {
    const { updateSession } = await import('@/lib/supabase/middleware')
    const response = await updateSession(new NextRequest('https://my-preview.vercel.app/home', { headers: { host: 'my-preview.vercel.app', cookie: `sb-127-auth-token=${value}` } }))
    expect(response.headers.getSetCookie().some((c) => c.startsWith(SHARED_SUPABASE_COOKIE))).toBe(false)
  })
})
