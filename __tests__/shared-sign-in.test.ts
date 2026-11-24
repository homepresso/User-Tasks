/**
 * The workspace sign-in page shared by forms and apps
 * (docs/changes/shared-sign-in.md):
 *  - return paths: form links and app paths of this host only (never another
 *    workspace's address or an external site);
 *  - the toggles (use_for_forms / use_for_apps) and the per-app override;
 *  - /sign-in for apps (workspace address, ?org= on the main address, none),
 *    the embedded variant, and /form-login still working for form links;
 *  - friendly app links /app/<slug>[/<page>] on a workspace address and the
 *    main address;
 *  - the dashboard layout's check for /apps/<slug> pages;
 *  - share links and the app sign-in choice in the app schema.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

class Redirect extends Error { constructor(public url: string) { super(`redirect ${url}`) } }
class NotFound extends Error { constructor() { super('not found') } }
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Redirect(url) },
  permanentRedirect: (url: string) => { throw new Redirect(url) },
  notFound: () => { throw new NotFound() },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const A = { id: 'tenant-a', name: 'Acme', slug: 'acme', subdomain: 'acme' }

const state = vi.hoisted(() => ({
  host: { kind: 'none' } as Record<string, unknown>,
  hostWorkspace: { kind: 'none' } as Record<string, unknown>,
  frame: 'top' as string,
  embed: false,
  path: '/',
  user: null as { id: string } | null,
  settings: {} as Record<string, unknown>,
  app: null as { choice: 'workspace' | 'standard' | null; color: string | null } | null,
  bySlug: {} as Record<string, { id: string; slug: string }>,
  loaded: [] as Array<{ tenantId: string | null; appSlug: string | null }>,
  member: true,
  current: 'tenant-x',
  switched: [] as string[],
}))

vi.mock('@/lib/forms/form-link-visitor', () => ({
  formLinkVisitor: async () => ({ host: state.host, frame: state.frame, embed: state.embed, path: state.path }),
  formLinkUser: async (v: { host: { kind: string }; frame: string }) => (v.frame === 'cross-origin-frame' || v.host.kind === 'signed_out' ? null : state.user),
  requestFrameContext: async () => state.frame,
}))
vi.mock('@/lib/workspace-host', () => ({
  enforceHostWorkspace: async () => state.host,
  getHostWorkspace: async () => state.hostWorkspace,
  requestPath: async () => state.path,
  loginUrlFor: (tenant: { subdomain: string }, path: string) => `https://usertasks.test/login?redirect=${encodeURIComponent(`/ws/${tenant.subdomain}${path}`)}`,
}))
vi.mock('@/app/actions/auth', () => ({
  getLoginOptions: async () => ({ provider: 'builtin', password: true, sso: [] }),
  signInAction: vi.fn(), startSsoAction: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ getCachedUser: async () => state.user, getSessionUserFast: async () => state.user }))
vi.mock('@/lib/services/workspace-address', () => ({
  isActiveMember: async () => state.member,
  storedWorkspaceOf: async () => ({ current: state.current, home: state.current }),
}))
vi.mock('@/lib/providers/db/session', () => ({
  getSessionDb: async () => ({ rpc: async (_fn: string, args: { p_tenant_id: string }) => { state.switched.push(args.p_tenant_id); return { error: null } } }),
}))
vi.mock('@/lib/services/form-sign-in-page', async () => {
  const { parseFormSignInSettings } = await import('@/lib/forms/sign-in-page')
  return {
    tenantOfForm: async () => null,
    tenantBySlug: async (slug: string) => state.bySlug[slug] ?? null,
    loadPublicSignInPage: async (tenantId: string | null, options: { appSlug?: string | null } = {}) => {
      state.loaded.push({ tenantId, appSlug: options.appSlug ?? null })
      return {
        settings: parseFormSignInSettings(state.settings),
        workspace: tenantId ? { name: 'Acme', slug: 'acme' } : null,
        theme: null,
        app: options.appSlug ? state.app : null,
      }
    },
  }
})

import SignInPage from '@/app/sign-in/page'
import FormLoginPage from '@/app/form-login/page'
import FriendlyAppPage from '@/app/app/[slug]/[[...page]]/page'
import { appSignInRedirect, enforceAppVisitor } from '@/lib/apps/sign-in-server'
import { appLinks } from '@/lib/apps/links'
import { appUpdateSchema } from '@/lib/apps/schema'
import { UNVERSIONED_SETTINGS } from '@/lib/apps/versions'
import {
  APP_DEFAULT_SUBHEADING, DEFAULT_SIGN_IN_SETTINGS, appOfReturnPath, parseFormSignInSettings, returnPathKind, sanitizeSignInReturnPath,
  settingsForApp, signInPageUrl, signInSettingsFromTenantSettings, usesWorkspaceSignIn,
} from '@/lib/forms/sign-in-page'

async function attempt(fn: () => Promise<unknown>): Promise<ReactElement | Redirect | NotFound> {
  try { return (await fn()) as ReactElement } catch (e) { if (e instanceof Redirect || e instanceof NotFound) return e; throw e }
}
const signIn = (query: Record<string, string>) => attempt(() => SignInPage({ searchParams: Promise.resolve(query) }))
const formLogin = (query: Record<string, string>) => attempt(() => FormLoginPage({ searchParams: Promise.resolve(query) }))
const friendly = (slug: string, page: string[] | undefined, query: Record<string, string> = {}) =>
  attempt(() => FriendlyAppPage({ params: Promise.resolve({ slug, page }), searchParams: Promise.resolve(query) }))
const urlOf = (r: unknown) => (r as Redirect).url

beforeEach(() => {
  state.host = { kind: 'none' }
  state.hostWorkspace = { kind: 'none' }
  state.frame = 'top'
  state.embed = false
  state.path = '/'
  state.user = null
  state.settings = {}
  state.app = null
  state.bySlug = {}
  state.loaded = []
  state.member = true
  state.current = 'tenant-x'
  state.switched = []
})

describe('settings model', () => {
  it('reads sign_in, falls back to the older forms.sign_in, and the toggles default on (app colour off)', () => {
    expect(signInSettingsFromTenantSettings({ sign_in: { design: 3 }, forms: { sign_in: { design: 7 } } }).design).toBe(3)
    expect(signInSettingsFromTenantSettings({ forms: { sign_in: { design: 7 } } }).design).toBe(7)
    expect(signInSettingsFromTenantSettings({})).toEqual(DEFAULT_SIGN_IN_SETTINGS)
    expect(parseFormSignInSettings({})).toMatchObject({ use_for_forms: true, use_for_apps: true, use_app_color: false })
    expect(parseFormSignInSettings({ use_for_forms: false, use_for_apps: 'no' })).toMatchObject({ use_for_forms: false, use_for_apps: true })
  })

  it('which visits use the page: form links follow use_for_forms; apps their own choice, else use_for_apps', () => {
    const on = { use_for_forms: true, use_for_apps: true }
    const off = { use_for_forms: false, use_for_apps: false }
    expect(usesWorkspaceSignIn(on, 'form')).toBe(true)
    expect(usesWorkspaceSignIn(off, 'form')).toBe(false)
    expect(usesWorkspaceSignIn(on, 'app')).toBe(true)
    expect(usesWorkspaceSignIn(off, 'app')).toBe(false)
    expect(usesWorkspaceSignIn(off, 'app', 'workspace')).toBe(true)
    expect(usesWorkspaceSignIn(on, 'app', 'standard')).toBe(false)
    expect(usesWorkspaceSignIn(off, null)).toBe(true)
  })

  it('an app page words the untouched default welcome message for apps', () => {
    expect(settingsForApp(DEFAULT_SIGN_IN_SETTINGS).subheading).toBe(APP_DEFAULT_SUBHEADING)
    expect(settingsForApp({ ...DEFAULT_SIGN_IN_SETTINGS, subheading: 'Staff only' }).subheading).toBe('Staff only')
  })
})

describe('return paths', () => {
  it('accepts form links and app paths on this host', () => {
    for (const ok of ['/f/11111111-2222-3333-4444-555555555555', '/form/contact-us?a=1', '/apps/crm', '/apps/crm/deals?p.region=west', '/app/crm', '/app/crm/deals?org=acme', '/embed/apps/crm/deals?menu=0']) {
      expect(sanitizeSignInReturnPath(ok), ok).toBe(ok)
    }
    expect(appOfReturnPath('/app/crm/deals?x=1')).toEqual({ route: 'app', slug: 'crm', page: 'deals' })
    expect(appOfReturnPath('/embed/apps/crm')).toEqual({ route: 'embed', slug: 'crm', page: null })
    expect(returnPathKind('/apps/crm')).toBe('app')
    expect(returnPathKind('/form/x')).toBe('form')
    expect(returnPathKind('/settings')).toBeNull()
  })

  it('refuses other hosts, other workspaces’ addresses, external sites and anything else in the app', () => {
    for (const bad of [
      'https://evil.example/apps/crm', '//evil.example/apps/crm', '/\\evil.example', 'https://other.usertasks.com/app/crm', '/ws/other/apps/crm',
      '/apps', '/apps/', '/apps/CRM', '/apps/crm/deals/extra', '/apps/../settings', '/apps/%2e%2e', '/apps/crm#x', '/apps/crm?next=https://evil.example',
      '/apps/crm\r\nSet-Cookie:a', '/settings', '/home', '/embed/tasks/x', '/application/x', 'apps/crm', '', null, 42,
    ]) {
      expect(sanitizeSignInReturnPath(bad as string), String(bad)).toBeNull()
    }
  })

  it('signInPageUrl keeps only a safe return path, a valid org and embed', () => {
    expect(signInPageUrl('/apps/crm/deals')).toBe('/sign-in?redirect=%2Fapps%2Fcrm%2Fdeals')
    expect(signInPageUrl('/app/crm', { org: 'Acme', embed: true })).toBe('/sign-in?redirect=%2Fapp%2Fcrm&org=acme&embed=1')
    expect(signInPageUrl('https://evil.example/apps/crm', { org: 'bad org!' })).toBe('/sign-in')
  })
})

describe('/sign-in for apps', () => {
  it('on a workspace address: the workspace design, worded for the app, back to the app afterwards', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    const page = await signIn({ redirect: '/apps/crm/deals' }) as ReactElement
    expect(state.loaded).toEqual([{ tenantId: 'tenant-a', appSlug: 'crm' }])
    expect(page).not.toBeInstanceOf(Redirect)
    const html = renderToStaticMarkup(page)
    expect(html).toContain(APP_DEFAULT_SUBHEADING)
    expect(html).toContain('data-sign-in-form')
  })

  it('a signed-in visitor goes straight back to the app — never elsewhere', async () => {
    state.user = { id: 'u1' }
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    expect(urlOf(await signIn({ redirect: '/app/crm?x=1' }))).toBe('/app/crm?x=1')
    expect(await signIn({ redirect: 'https://evil.example/apps/crm' })).not.toBeInstanceOf(Redirect)
  })

  it('apps turned off (use_for_apps false): the standard sign-in with the same return path', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    state.settings = { use_for_apps: false }
    expect(urlOf(await signIn({ redirect: '/apps/crm' }))).toBe(`https://usertasks.test/login?redirect=${encodeURIComponent('/ws/acme/apps/crm')}`)
  })

  it('the app overrides the workspace: standard when the page is on, the workspace page when apps are off', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    state.app = { choice: 'standard', color: null }
    expect(urlOf(await signIn({ redirect: '/apps/crm' }))).toContain('/login?redirect=')
    state.settings = { use_for_apps: false }
    state.app = { choice: 'workspace', color: null }
    expect(await signIn({ redirect: '/apps/crm' })).not.toBeInstanceOf(Redirect)
  })

  it('the app colour tints the accent only when the workspace asks for it', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    state.app = { choice: null, color: '#16a34a' }
    const plain = renderToStaticMarkup(await signIn({ redirect: '/apps/crm' }) as ReactElement)
    expect(plain).not.toContain('#16a34a')
    state.settings = { use_app_color: true }
    const tinted = renderToStaticMarkup(await signIn({ redirect: '/apps/crm' }) as ReactElement)
    expect(tinted).toContain('#16a34a')
  })

  it('the main address: ?org= names the workspace; without one, the standard /login as before', async () => {
    expect(urlOf(await signIn({ redirect: '/apps/crm' }))).toBe('/login?redirect=%2Fapps%2Fcrm')
    state.bySlug = { acme: { id: 'tenant-a', slug: 'acme' } }
    const page = await signIn({ redirect: '/app/crm?org=acme', org: 'acme' })
    expect(page).not.toBeInstanceOf(Redirect)
    expect(state.loaded.at(-1)).toEqual({ tenantId: 'tenant-a', appSlug: 'crm' })
    // An unknown workspace: the standard sign-in, with the org hint.
    expect(urlOf(await signIn({ redirect: '/app/crm', org: 'nobody' }))).toBe('/login?redirect=%2Fapp%2Fcrm&org=nobody')
  })

  it('embedded in another site: the compact design with "Open the app in a new tab"', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    state.frame = 'cross-origin-frame'
    state.embed = true
    const html = renderToStaticMarkup(await signIn({ redirect: '/embed/apps/crm?embed=1&menu=0', embed: '1' }) as ReactElement)
    expect(html).toContain('data-sign-in-design="compact"')
    expect(html).toContain('Open the app in a new tab')
    expect(html).toContain('href="/embed/apps/crm?menu=0"')
    expect(html).not.toContain('data-sign-in-submit')
  })
})

describe('/form-login keeps working for form links', () => {
  it('renders the same page for a form link', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    const page = await formLogin({ redirect: '/form/contact-us' })
    expect(page).not.toBeInstanceOf(Redirect)
    expect(state.loaded).toEqual([{ tenantId: 'tenant-a', appSlug: null }])
  })

  it('form links turned off (use_for_forms false): the standard sign-in', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    state.settings = { use_for_forms: false }
    expect(urlOf(await formLogin({ redirect: '/form/contact-us' }))).toBe(`https://usertasks.test/login?redirect=${encodeURIComponent('/ws/acme/form/contact-us')}`)
    // …while apps still use it.
    expect(await signIn({ redirect: '/apps/crm' })).not.toBeInstanceOf(Redirect)
  })
})

describe('friendly app links: /app/<slug>[/<page>]', () => {
  it('workspace address, signed out: the workspace sign-in page, back to the friendly link', async () => {
    state.host = { kind: 'signed_out', tenant: A }
    expect(urlOf(await friendly('crm', ['deals'], { 'p.region': 'west' }))).toBe(`/sign-in?redirect=${encodeURIComponent('/app/crm/deals?p.region=west')}`)
  })

  it('workspace address, member: on to the app (query kept), ?embed=1 to the full-screen view', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    expect(urlOf(await friendly('crm', undefined, { 'p.x': '1' }))).toBe('/apps/crm?p.x=1')
    expect(urlOf(await friendly('crm', ['deals'], { embed: '1', menu: '0' }))).toBe('/embed/apps/crm/deals?menu=0')
  })

  it('signed in elsewhere but not a member of this address: no access', async () => {
    state.host = { kind: 'non_member', tenant: A, userId: 'u9' }
    expect(urlOf(await friendly('crm', undefined))).toBe('/no-access')
  })

  it('not an app address: 404 (reserved words, bad characters, extra segments)', async () => {
    state.host = { kind: 'member', tenant: A, userId: 'u1' }
    for (const [slug, page] of [['new', undefined], ['spec', undefined], ['CRM', undefined], ['crm', ['a', 'b']], ['crm', ['Bad!']]] as const) {
      expect(await friendly(slug, page as string[] | undefined), `${slug}/${page}`).toBeInstanceOf(NotFound)
    }
  })

  it('main address, signed out: the sign-in page when ?org= names the workspace, else the standard /login', async () => {
    expect(urlOf(await friendly('crm', undefined))).toBe('/login?redirect=%2Fapp%2Fcrm')
    expect(urlOf(await friendly('crm', undefined, { org: 'acme' }))).toBe(`/sign-in?redirect=${encodeURIComponent('/app/crm?org=acme')}&org=acme`)
  })

  it('main address, signed in with ?org=: opens that workspace for its members, then the app (without org)', async () => {
    state.user = { id: 'u1' }
    state.bySlug = { acme: { id: 'tenant-a', slug: 'acme' } }
    expect(urlOf(await friendly('crm', ['deals'], { org: 'acme', q: '1' }))).toBe('/apps/crm/deals?q=1')
    expect(state.switched).toEqual(['tenant-a'])
    // Not a member: nothing switches (the app resolves in their current workspace and its audience check applies).
    state.switched = []
    state.member = false
    expect(urlOf(await friendly('crm', undefined, { org: 'acme' }))).toBe('/apps/crm')
    expect(state.switched).toEqual([])
    // Already current: no switch.
    state.member = true
    state.current = 'tenant-a'
    await friendly('crm', undefined, { org: 'acme' })
    expect(state.switched).toEqual([])
  })
})

describe('app pages in the dashboard (/apps/<slug>…)', () => {
  const visit = () => attempt(async () => { await enforceAppVisitor(); return null })

  it('signed out on a workspace address: the workspace sign-in page', async () => {
    state.path = '/apps/crm/deals?p.x=1'
    state.hostWorkspace = { kind: 'workspace', tenant: A }
    expect(urlOf(await visit())).toBe(`/sign-in?redirect=${encodeURIComponent('/apps/crm/deals?p.x=1')}`)
  })

  it('signed out on the main address: ?org= → the sign-in page; none → the standard /login', async () => {
    state.path = '/apps/crm?org=acme'
    expect(urlOf(await visit())).toBe(`/sign-in?redirect=${encodeURIComponent('/apps/crm?org=acme')}&org=acme`)
    state.path = '/apps/crm'
    expect(urlOf(await visit())).toBe('/login?redirect=%2Fapps%2Fcrm')
  })

  it('signed in, other pages, and unknown addresses: nothing (the audience check and enforceHostWorkspace carry on)', async () => {
    state.path = '/apps/crm'
    state.user = { id: 'u1' }
    expect(await visit()).toBeNull()
    state.user = null
    for (const p of ['/apps', '/tasks', '/settings?tab=sign-in']) { state.path = p; expect(await visit(), p).toBeNull() }
    state.path = '/apps/crm'
    state.hostWorkspace = { kind: 'unknown', label: 'nope' }
    expect(await visit()).toBeNull()
  })

  it('embedded apps sign in on the workspace page too (top level / new tab)', () => {
    expect(appSignInRedirect('/embed/apps/crm?menu=0', { onWorkspaceAddress: true })).toBe(`/sign-in?redirect=${encodeURIComponent('/embed/apps/crm?menu=0')}`)
    expect(appSignInRedirect('/embed/apps/crm', { org: 'acme' })).toBe(`/sign-in?redirect=${encodeURIComponent('/embed/apps/crm')}&org=acme`)
    expect(appSignInRedirect('/embed/apps/crm', {})).toBe('/login?redirect=%2Fembed%2Fapps%2Fcrm')
  })
})

describe('share links and the app’s own choice', () => {
  it('the friendly link uses the workspace address, else the main address with ?org=', () => {
    expect(appLinks({ slug: 'crm', workspaceUrl: 'https://acme.usertasks.com', mainOrigin: 'https://usertasks.com', workspaceSlug: 'acme' })).toEqual({
      friendly_url: 'https://acme.usertasks.com/app/crm', embed_url: 'https://acme.usertasks.com/embed/apps/crm', app_url: 'https://acme.usertasks.com/apps/crm', workspace_url: 'https://acme.usertasks.com',
    })
    expect(appLinks({ slug: 'crm', workspaceUrl: null, mainOrigin: 'https://usertasks.com/', workspaceSlug: 'acme' }).friendly_url).toBe('https://usertasks.com/app/crm?org=acme')
  })

  it('sign_in_page: workspace, standard or null; live (never versioned)', () => {
    for (const v of ['workspace', 'standard', null]) expect(appUpdateSchema.safeParse({ sign_in_page: v }).success, String(v)).toBe(true)
    expect(appUpdateSchema.safeParse({ sign_in_page: 'custom' }).success).toBe(false)
    expect((UNVERSIONED_SETTINGS as readonly string[]).includes('sign_in_page')).toBe(true)
  })
})
