import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { completeBetaSignup, loginHref, postSignupDestination, safeReturnPath, signupHref } from '@/lib/signup-link'

// The login page's server dependencies (host lookup, auth options) and the
// client form's router hooks, so the page renders outside Next.
const nav = vi.hoisted(() => ({ search: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.search,
  useRouter: () => ({ push: vi.fn() }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND') },
  redirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) },
  permanentRedirect: (url: string) => { throw new Error(`NEXT_REDIRECT ${url}`) },
}))
const host = vi.hoisted(() => ({ value: { kind: 'apex' } as Record<string, unknown> }))
vi.mock('@/lib/workspace-host', () => ({
  getHostWorkspace: async () => host.value,
  loginUrlFor: (_tenant: unknown, back: string) => `/login?redirect=${encodeURIComponent(back)}`,
  originForSubdomain: () => null,
}))
vi.mock('@/app/actions/auth', () => ({
  getLoginOptions: async () => ({ provider: 'supabase', password: true, sso: [] }),
  signInAction: vi.fn(),
  startSsoAction: vi.fn(),
}))
vi.mock('@/app/actions/session', () => ({ getMySession: vi.fn() }))
// First-run setup reads the service database when one is configured (the
// DB suites set DATABASE_URL); an empty one would send self-hosted sign-in to
// /setup. That path has its own tests (setup-routes, setup-db): here the
// install is already set up.
vi.mock('@/lib/setup/server', () => ({
  redirectToSetupIfNeeded: async () => {},
  singleOrganisation: async () => null,
  setupNeeded: async () => false,
}))

/** What the authorize route sends an unauthenticated CLI login to (`?redirect=` value). */
const AUTHORIZE = `/api/oauth/authorize?${new URLSearchParams({
  response_type: 'code',
  client_id: 'usertasks-cli',
  redirect_uri: 'http://127.0.0.1:53111/callback',
  scope: 'tasks:read workflows:read',
  state: 'abc',
  code_challenge: 'xyz',
  code_challenge_method: 'S256',
})}`

async function renderLogin(query: Record<string, string>) {
  nav.search = new URLSearchParams(query)
  const { default: LoginPage } = await import('@/app/(auth)/login/page')
  const element = await LoginPage({ searchParams: Promise.resolve(query) })
  return renderToStaticMarkup(element)
}

beforeEach(() => { host.value = { kind: 'apex' } })
afterEach(() => { vi.unstubAllEnvs() })

describe('safe redirect (sanitizeRedirect, shared by login and sign-up)', () => {
  it.each([
    AUTHORIZE,
    '/tasks',
    '/home',
    '/automations/forms?import=infopath',
    '/tasks/123#comments',
  ])('accepts the same-origin path %s', (value) => {
    expect(sanitizeRedirect(value)).toBe(value)
    expect(safeReturnPath(value)).toBe(value)
  })

  it.each([
    'https://evil.com',
    'http://evil.com/api/oauth/authorize',
    '//evil.com',
    '//evil.com/path',
    '/\\evil.com',
    '\\\\evil.com',
    '/tasks\\..\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    '/path\r\nSet-Cookie: x',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,hi',
    'tasks',
    '/redirect?to=https://evil.com',
    '',
  ])('rejects %j', (value) => {
    expect(sanitizeRedirect(value)).toBe('/home')
    expect(safeReturnPath(value)).toBeNull()
  })

  it('ignores repeated (array) values', () => {
    expect(safeReturnPath(['/tasks', '/home'])).toBeNull()
  })
})

describe('sign-up ↔ sign-in links keep the redirect', () => {
  it('passes a safe redirect through to /start and back to /login', () => {
    expect(signupHref(AUTHORIZE)).toBe(`/start?redirect=${encodeURIComponent(AUTHORIZE)}`)
    expect(new URL(signupHref(AUTHORIZE), 'https://usertasks.com').searchParams.get('redirect')).toBe(AUTHORIZE)
    expect(loginHref(AUTHORIZE)).toBe(`/login?redirect=${encodeURIComponent(AUTHORIZE)}`)
  })

  it('drops an unsafe or missing redirect', () => {
    expect(signupHref('//evil.com')).toBe('/start')
    expect(signupHref(undefined)).toBe('/start')
    expect(loginHref('https://evil.com')).toBe('/login')
    expect(loginHref(null)).toBe('/login')
  })
})

describe('login page sign-up link', () => {
  it('cloud: shows "Create a free workspace" linking to /start with the redirect', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    const html = await renderLogin({ redirect: AUTHORIZE })
    expect(html).toContain('Create a free workspace')
    const href = html.match(/href="(\/start[^"]*)"/)![1].replace(/&amp;/g, '&')
    expect(new URL(href, 'https://usertasks.com').searchParams.get('redirect')).toBe(AUTHORIZE)
  })

  it('cloud: plain /start when there is no (safe) redirect', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    expect(await renderLogin({})).toContain('href="/start"')
    expect(await renderLogin({ redirect: '//evil.com' })).toContain('href="/start"')
  })

  it('self-hosted: no sign-up link (invite-only), the page as before', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    const html = await renderLogin({ redirect: AUTHORIZE })
    expect(html).not.toContain('Create a free workspace')
    expect(html).not.toContain('/start')
    expect(html).toContain('If you have an invitation, your account is created automatically.')
  })

  it('cloud: a workspace’s own sign-in page has no sign-up link', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    host.value = { kind: 'workspace', tenant: { slug: 'acme' } }
    const html = await renderLogin({})
    expect(html).not.toContain('Create a free workspace')
  })
})

describe('/start keeps the redirect', () => {
  it('the sign-in link on the sign-up page carries it', async () => {
    const { StartPage } = await import('@/components/marketing/start-page')
    const html = renderToStaticMarkup(createElement(StartPage, { email: '', redirect: AUTHORIZE }))
    expect(html).toContain(`href="/login?redirect=${encodeURIComponent(AUTHORIZE)}"`)
    expect(renderToStaticMarkup(createElement(StartPage, { email: '' }))).toContain('href="/login"')
  })
})

describe('beta sign-up returns to the redirect', () => {
  const form = { fullName: 'Ada', email: ' ada@example.com ', password: 'long-enough', company: 'Example' }
  const ok = () => ({
    signup: vi.fn(async () => ({ ok: true })),
    signIn: vi.fn(async () => ({ ok: true })),
  })

  it('signs in, then goes to the safe redirect (the CLI authorize URL)', async () => {
    const actions = ok()
    const outcome = await completeBetaSignup(form, { redirect: AUTHORIZE }, actions)
    expect(outcome).toEqual({ kind: 'signed_in', href: AUTHORIZE })
    expect(actions.signIn).toHaveBeenCalledWith('ada@example.com', 'long-enough')
    // Sign-up first, then sign-in (which sets the session cookie), then the redirect.
    expect(actions.signup.mock.invocationCallOrder[0]).toBeLessThan(actions.signIn.mock.invocationCallOrder[0])
  })

  it('falls back to today’s behaviour for an unsafe or missing redirect', async () => {
    expect(await completeBetaSignup(form, { redirect: 'https://evil.com' }, ok())).toEqual({ kind: 'signed_in', href: '/tasks' })
    expect(await completeBetaSignup(form, { redirect: '//evil.com', next: 'infopath' }, ok())).toEqual({ kind: 'signed_in', href: '/automations/forms?import=infopath' })
    expect(await completeBetaSignup(form, {}, ok())).toEqual({ kind: 'signed_in', href: '/tasks' })
    expect(postSignupDestination(null, 'constructor')).toBe('/tasks')
    expect(postSignupDestination(AUTHORIZE, 'infopath')).toBe(AUTHORIZE)
  })

  it('a failed sign-in after sign-up goes to /login, keeping the redirect', async () => {
    const outcome = await completeBetaSignup(form, { redirect: AUTHORIZE }, { ...ok(), signIn: vi.fn(async () => ({ ok: false })) })
    expect(outcome).toEqual({ kind: 'sign_in', href: loginHref(AUTHORIZE) })
  })

  it('a failed sign-up reports the error and never signs in', async () => {
    const signIn = vi.fn(async () => ({ ok: true }))
    const outcome = await completeBetaSignup(form, { redirect: AUTHORIZE }, { signup: async () => ({ ok: false, error: 'Too many signups' }), signIn })
    expect(outcome).toEqual({ kind: 'error', error: 'Too many signups' })
    expect(signIn).not.toHaveBeenCalled()
  })
})

describe('authorization-server metadata advertises self-signup (CLI hint)', () => {
  async function metadata() {
    const { GET } = await import('@/app/.well-known/oauth-authorization-server/route')
    const { NextRequest } = await import('next/server')
    return (await GET(new NextRequest('http://localhost:3000/.well-known/oauth-authorization-server'))).json()
  }

  it('cloud: usertasks_signup_url is <base>/start', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'cloud')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://usertasks.com')
    expect((await metadata()).usertasks_signup_url).toBe('https://usertasks.com/start')
  })

  it('self-hosted: no usertasks_signup_url', async () => {
    vi.stubEnv('DEPLOYMENT_MODE', 'self_hosted')
    expect(await metadata()).not.toHaveProperty('usertasks_signup_url')
  })
})
