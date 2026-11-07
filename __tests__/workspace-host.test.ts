/**
 * Host → workspace resolution (lib/workspace-host.ts) and the proxy's part
 * (proxy.ts): unknown address → 404, retired address → redirect, signed out →
 * sign in and back, non-member → no access, member → their workspace made
 * current through switch_tenant, the apex unchanged; the proxy drops spoofed
 * host headers and only hops /ws/<label> to our own subdomains.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { requestHeaders, resetRequest } from './helpers/next-headers-mock'

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

class Redirect extends Error { constructor(public url: string, public permanent = false) { super(`redirect ${url}`) } }
class NotFound extends Error { constructor() { super('not found') } }
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Redirect(url) },
  permanentRedirect: (url: string) => { throw new Redirect(url, true) },
  notFound: () => { throw new NotFound() },
}))

const state = vi.hoisted(() => ({
  resolved: new Map<string, unknown>(),
  members: new Set<string>(),
  current: new Map<string, string | null>(),
  user: null as { id: string; email?: string } | null,
  switched: [] as string[],
}))

vi.mock('@/lib/services/workspace-address', () => ({
  resolveSubdomain: async (label: string) => state.resolved.get(label) ?? { kind: 'unknown' },
  isActiveMember: async (userId: string, tenantId: string) => state.members.has(`${userId}:${tenantId}`),
  storedWorkspaceOf: async (userId: string) => ({ current: state.current.get(userId) ?? null, home: 'home-tenant' }),
}))
vi.mock('@/lib/supabase/server', () => ({ getCachedUser: async () => state.user }))
vi.mock('@/lib/providers/db/session', () => ({
  getSessionDb: async () => ({
    rpc: async (_fn: string, args: { p_tenant_id: string }) => {
      state.switched.push(args.p_tenant_id)
      if (state.user) state.current.set(state.user.id, args.p_tenant_id)
      return { error: null }
    },
  }),
}))

const ACME = { id: 'tenant-acme', name: 'Acme', slug: 'acme-corp', subdomain: 'acme' }
const ENV = { APP_URL: process.env.APP_URL, DEPLOYMENT_MODE: process.env.DEPLOYMENT_MODE, APP_BASE_DOMAIN: process.env.APP_BASE_DOMAIN, AUTH_COOKIE_SECURE: process.env.AUTH_COOKIE_SECURE }

function onHost(label: string | null, path = '/home') {
  resetRequest()
  if (label) requestHeaders.set('x-ut-host-workspace', label)
  requestHeaders.set('x-ut-request-path', path)
}

async function enforce(options?: { allowSignedOut?: boolean }) {
  const { enforceHostWorkspace } = await import('@/lib/workspace-host')
  return enforceHostWorkspace(options)
}

async function caught(p: Promise<unknown>): Promise<unknown> {
  try { await p } catch (e) { return e }
  throw new Error('expected a redirect / not found')
}

beforeEach(() => {
  process.env.APP_URL = 'https://usertasks.test'
  process.env.DEPLOYMENT_MODE = 'cloud'
  delete process.env.APP_BASE_DOMAIN
  delete process.env.AUTH_COOKIE_SECURE
  state.resolved = new Map([['acme', { kind: 'workspace', tenant: ACME }], ['old-acme', { kind: 'moved', subdomain: 'acme' }]])
  state.members = new Set(['u-member:tenant-acme'])
  state.current = new Map()
  state.user = null
  state.switched = []
})

afterAll(() => {
  for (const [k, v] of Object.entries(ENV)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
})

describe('enforceHostWorkspace', () => {
  it('apex (no workspace header) and subdomains off: nothing changes', async () => {
    onHost(null)
    expect(await enforce()).toEqual({ kind: 'none' })
    onHost('acme')
    process.env.APP_BASE_DOMAIN = 'off'
    expect(await enforce()).toEqual({ kind: 'none' })
  })

  it('unknown or impossible address → 404', async () => {
    onHost('nobody')
    expect(await caught(enforce())).toBeInstanceOf(NotFound)
    onHost('!')
    expect(await caught(enforce())).toBeInstanceOf(NotFound)
  })

  it('a retired address redirects permanently to the same path on the current one', async () => {
    onHost('old-acme', '/form/onboarding?x=1')
    const e = await caught(enforce()) as Redirect
    expect(e.url).toBe('https://acme.usertasks.test/form/onboarding?x=1')
    expect(e.permanent).toBe(true)
  })

  it('signed out → the apex login with a /ws/ return path and the organisation pre-filled', async () => {
    onHost('acme', '/form/employee-onboarding')
    const e = await caught(enforce()) as Redirect
    expect(e.url).toBe(`https://usertasks.test/login?redirect=${encodeURIComponent('/ws/acme/form/employee-onboarding')}&org=acme-corp`)
  })

  it('signed out on local http (*.localhost, host-only cookies) → the address’s own /login', async () => {
    process.env.APP_URL = 'http://localhost:3100'
    process.env.APP_BASE_DOMAIN = 'localhost'
    onHost('acme', '/tasks')
    const e = await caught(enforce()) as Redirect
    expect(e.url).toBe(`/login?redirect=${encodeURIComponent('/tasks')}&org=acme-corp`)
  })

  it('signed out with allowSignedOut: the page decides', async () => {
    onHost('acme', '/form/x')
    expect(await enforce({ allowSignedOut: true })).toEqual({ kind: 'signed_out', tenant: ACME })
  })

  it('signed in, not a member → no access (or non_member for a page that allows visitors)', async () => {
    state.user = { id: 'u-stranger' }
    onHost('acme')
    expect(((await caught(enforce())) as Redirect).url).toBe('/no-access')
    expect(await enforce({ allowSignedOut: true })).toEqual({ kind: 'non_member', tenant: ACME, userId: 'u-stranger' })
    expect(state.switched).toEqual([])
  })

  it('a member already in the workspace: no switch', async () => {
    state.user = { id: 'u-member' }
    state.current.set('u-member', 'tenant-acme')
    onHost('acme')
    expect(await enforce()).toEqual({ kind: 'member', tenant: ACME, userId: 'u-member' })
    expect(state.switched).toEqual([])
  })

  it('a member in another workspace (or the unified view): switch once through switch_tenant and reload', async () => {
    state.user = { id: 'u-member' }
    state.current.set('u-member', 'tenant-other')
    onHost('acme', '/tasks?view=mine')
    expect(((await caught(enforce())) as Redirect).url).toBe('/tasks?view=mine')
    expect(state.switched).toEqual(['tenant-acme'])
    // The reload finds the workspace current.
    expect(await enforce()).toEqual({ kind: 'member', tenant: ACME, userId: 'u-member' })
    expect(state.switched).toEqual(['tenant-acme'])

    state.current.set('u-member', null)
    expect(((await caught(enforce())) as Redirect).url).toBe('/tasks?view=mine')
  })
})

describe('proxy', () => {
  async function run(url: string, headers: Record<string, string> = {}) {
    const { proxy } = await import('@/proxy')
    const u = new URL(url)
    return proxy(new NextRequest(url, { headers: { host: u.host, ...headers } }))
  }
  const upstream = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`)

  it('tells the server the workspace label and drops a spoofed one', async () => {
    const res = await run('https://acme.usertasks.test/home', { 'x-ut-host-workspace': 'victim' })
    expect(upstream(res, 'x-ut-host-workspace')).toBe('acme')
    expect(upstream(res, 'x-ut-request-path')).toBe('/home')
  })

  it('the apex carries no workspace, even when the client sends one', async () => {
    const res = await run('https://usertasks.test/home', { 'x-ut-host-workspace': 'victim' })
    expect(upstream(res, 'x-ut-host-workspace')).toBeNull()
    const www = await run('https://www.usertasks.test/home')
    expect(upstream(www, 'x-ut-host-workspace')).toBeNull()
  })

  it('reserved or nested labels are marked invalid (404 on the server)', async () => {
    expect(upstream(await run('https://api.usertasks.test/'), 'x-ut-host-workspace')).toBe('!')
    expect(upstream(await run('https://a.b.usertasks.test/'), 'x-ut-host-workspace')).toBe('!')
  })

  it('/ws/<label>/<path> on the apex hops to that workspace address only', async () => {
    const res = await run('https://usertasks.test/ws/acme/form/employee-onboarding?ref=qr')
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://acme.usertasks.test/form/employee-onboarding?ref=qr')
    for (const bad of ['/ws/evil.com/x', '/ws/acme//evil.com', '/ws/www/', '/ws/a.b/x']) {
      const r = await run(`https://usertasks.test${bad}`)
      expect(r.headers.get('location'), bad).toBeNull()
    }
    // Not on a workspace host or a foreign host.
    expect((await run('https://acme.usertasks.test/ws/other/x')).headers.get('location')).toBeNull()
    expect((await run('https://evil.example/ws/acme/x')).headers.get('location')).toBeNull()
  })

  it('a friendly form link for a visitor without a session gets the public-form headers', async () => {
    const res = await run('https://acme.usertasks.test/form/contact-us')
    expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    expect(res.headers.get('content-security-policy')).toContain('challenges.cloudflare.com')
    const signedIn = await run('https://acme.usertasks.test/form/contact-us', { cookie: '__Secure-ut_session=abc' })
    expect(signedIn.headers.get('referrer-policy')).toBeNull()
    expect(signedIn.headers.get('content-security-policy')).not.toContain('challenges.cloudflare.com')
    // Form link pages may be embedded by any site (lib/forms/embed.ts); the page never uses a session in a cross-origin frame.
    expect(signedIn.headers.get('content-security-policy')).toContain('frame-ancestors *')
    expect(signedIn.headers.get('x-frame-options')).toBeNull()
  })

  it('every other page stays unframeable', async () => {
    const res = await run('https://acme.usertasks.test/tasks')
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})
