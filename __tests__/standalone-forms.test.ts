/**
 * Standalone, embeddable form links and the form sign-in page
 * (docs/changes/standalone-forms.md):
 *  - /f/<id> renders on its own (no dashboard shell), signed-out visitors go
 *    to /form-login, in a cross-origin frame the visitor counts as signed out;
 *  - framing: form link pages frameable (frame-ancestors *, no
 *    X-Frame-Options), every other route DENY;
 *  - the embed helpers (resize message, snippets);
 *  - /form-login's return path is a same-host form path only;
 *  - sign-in page settings validation;
 *  - each of the ten designs renders (static markup).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

class Redirect extends Error { constructor(public url: string) { super(`redirect ${url}`) } }
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Redirect(url) },
  permanentRedirect: (url: string) => { throw new Redirect(url) },
  notFound: () => { throw new Error('not found') },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const state = vi.hoisted(() => ({
  host: { kind: 'none' } as Record<string, unknown>,
  frame: 'top' as string,
  embed: false,
  path: '/f/11111111-2222-3333-4444-555555555555',
  user: null as { id: string } | null,
  tenantOfForm: null as string | null,
  loaded: [] as Array<string | null>,
}))

vi.mock('@/lib/forms/form-link-visitor', () => ({
  formLinkVisitor: async () => ({ host: state.host, frame: state.frame, embed: state.embed, path: state.path }),
  formLinkUser: async (v: { host: { kind: string }; frame: string }) => (v.frame === 'cross-origin-frame' || v.host.kind === 'signed_out' ? null : state.user),
  requestFrameContext: async () => state.frame,
}))
const Member = vi.hoisted(() => function MemberFormPageStub() { return null })
vi.mock('@/components/forms/form-link-page', () => ({ MemberFormPage: Member }))
vi.mock('@/app/actions/auth', () => ({
  getLoginOptions: async () => ({ provider: 'builtin', password: true, sso: [{ id: 'okta', name: 'Okta', kind: 'oidc' }] }),
  signInAction: vi.fn(), startSsoAction: vi.fn(),
}))
vi.mock('@/lib/services/form-sign-in-page', async () => {
  const { DEFAULT_SIGN_IN_SETTINGS } = await import('@/lib/forms/sign-in-page')
  return {
    tenantOfForm: async () => state.tenantOfForm,
    loadPublicSignInPage: async (tenantId: string | null) => {
      state.loaded.push(tenantId)
      return { settings: { ...DEFAULT_SIGN_IN_SETTINGS, design: 2, heading: 'Welcome to Acme forms' }, workspace: tenantId ? { name: 'Acme', slug: 'acme' } : null, theme: null }
    },
  }
})

import FormLinkPage from '@/app/f/[id]/page'
import FormLoginPage from '@/app/form-login/page'
import { FormSignInScreen } from '@/components/forms/sign-in/form-sign-in-screen'
import { buildContentSecurityPolicy } from '@/lib/csp'
import { signInThemeStyle } from '@/lib/forms/sign-in-theme'
import {
  embedUrl, frameAncestorsFor, frameContext, iframeSnippet, isFrameableFormPath, isResizeMessage, resizeMessage, resizeScriptSnippet, wantsEmbed,
} from '@/lib/forms/embed'
import {
  DEFAULT_SIGN_IN_SETTINGS, SIGN_IN_DESIGNS, applyFormSignInPatch, contrast, formIdOfReturnPath, formLoginUrl, formSignInInputProblem,
  parseFormSignInSettings, sanitizeFormReturnPath, signInColors, signInSettingsFromTenantSettings,
} from '@/lib/forms/sign-in-page'

const FORM_ID = '11111111-2222-3333-4444-555555555555'
const A = { id: 'tenant-a', name: 'Acme', slug: 'acme', subdomain: 'acme' }

async function attempt(fn: () => Promise<unknown>): Promise<ReactElement | Redirect> {
  try { return (await fn()) as ReactElement } catch (e) { if (e instanceof Redirect) return e; throw e }
}
const openForm = (query: Record<string, string> = {}) => attempt(() => FormLinkPage({ params: Promise.resolve({ id: FORM_ID }), searchParams: Promise.resolve(query) }))
const openLogin = (query: Record<string, string> = {}) => attempt(() => FormLoginPage({ searchParams: Promise.resolve(query) }))

beforeEach(() => {
  state.host = { kind: 'none' }
  state.frame = 'top'
  state.embed = false
  state.path = `/f/${FORM_ID}`
  state.user = null
  state.tenantOfForm = null
  state.loaded = []
})

describe('/f/<id>: the form on its own page', () => {
  it('lives outside the dashboard route group and never imports the shell', () => {
    const root = process.cwd()
    expect(existsSync(path.join(root, 'app/f/[id]/page.tsx'))).toBe(true)
    expect(existsSync(path.join(root, 'app/(dashboard)/f'))).toBe(false)
    for (const file of ['app/f/[id]/page.tsx', 'app/form/[name]/page.tsx', 'components/forms/form-link-page.tsx', 'app/form-login/page.tsx']) {
      const src = readFileSync(path.join(root, file), 'utf8')
      expect(src, file).not.toMatch(/\(dashboard\)\/layout|DashboardShell|dashboard-shell/)
    }
    // The in-app page (opened from the app's own menus) keeps the shell.
    expect(existsSync(path.join(root, 'app/(dashboard)/fill/[id]/page.tsx'))).toBe(true)
  })

  it('a signed-in member gets the standalone form page', async () => {
    state.user = { id: 'u1' }
    const page = await openForm({ customer: 'ALFKI' }) as ReactElement
    expect(page.type).toBe(Member)
    expect(page.props).toMatchObject({ formId: FORM_ID, query: { customer: 'ALFKI' }, embed: false, userId: 'u1' })
  })

  it('a visitor who is not signed in goes to the form sign-in page and back', async () => {
    expect(((await openForm()) as Redirect).url).toBe(`/form-login?redirect=${encodeURIComponent(`/f/${FORM_ID}`)}`)
    state.embed = true
    expect(((await openForm({ embed: '1' })) as Redirect).url).toBe(`/form-login?redirect=${encodeURIComponent(`/f/${FORM_ID}`)}&embed=1`)
  })

  it('in a frame from another origin the session is never used', async () => {
    state.user = { id: 'u1' }
    state.frame = 'cross-origin-frame'
    state.embed = true
    expect(await openForm()).toBeInstanceOf(Redirect)
  })

  it('a signed-in non-member of the address has no access', async () => {
    state.host = { kind: 'non_member', tenant: A, userId: 'u9' }
    state.user = { id: 'u9' }
    expect(((await openForm()) as Redirect).url).toBe('/no-access')
  })
})

describe('framing', () => {
  it('only form link pages are frameable', () => {
    for (const p of ['/f/abc', `/f/${FORM_ID}`, '/form/employee-onboarding', '/p/tok_123', '/form-login']) {
      expect(isFrameableFormPath(p), p).toBe(true)
      expect(frameAncestorsFor(p)).toBe('*')
    }
    for (const p of ['/', '/tasks', '/fill/abc', '/files/logos/x.png', '/f', '/f/a/b', '/form-controls/frame/x', '/settings', '/login', '/api/public/forms/x', '/packages/x', '/formx/a']) {
      expect(isFrameableFormPath(p), p).toBe(false)
      expect(frameAncestorsFor(p)).toBe("'none'")
    }
  })

  it('the CSP says frame-ancestors * only when asked', () => {
    expect(buildContentSecurityPolicy({ supabaseUrl: 'https://x.supabase.co', isDev: false })).toContain("frame-ancestors 'none'")
    expect(buildContentSecurityPolicy({ supabaseUrl: 'https://x.supabase.co', isDev: false, frameAncestors: '*' })).toContain('frame-ancestors *')
  })

  it('next.config drops X-Frame-Options for form link pages only', async () => {
    const config = (await import('@/next.config')).default
    const rules = await config.headers!()
    const xfo = (source: string) => rules.find((r) => r.source === source)?.headers.some((h) => h.key === 'X-Frame-Options')
    const general = rules.find((r) => r.source.startsWith('/((?!'))!
    expect(general.headers.some((h) => h.key === 'X-Frame-Options' && h.value === 'DENY')).toBe(true)
    const re = new RegExp(`^${general.source.replace('/((?!', '/(?!(?:').replace(').*)', ')).*')}$`)
    expect(re.test('/tasks')).toBe(true)
    expect(re.test('/fill/x')).toBe(true)
    expect(re.test('/f/x')).toBe(false)
    expect(re.test('/form/x')).toBe(false)
    expect(re.test('/p/x')).toBe(false)
    expect(re.test('/form-login')).toBe(false)
    for (const source of ['/f/:path*', '/form/:path*', '/p/:path*', '/form-login']) expect(xfo(source), source).toBe(false)
  })

  it('reads where the page is shown from Fetch Metadata', () => {
    const h = (o: Record<string, string>) => (n: string) => o[n] ?? null
    expect(frameContext(h({}))).toBe('top')
    expect(frameContext(h({ 'sec-fetch-dest': 'document', 'sec-fetch-site': 'cross-site' }))).toBe('top')
    expect(frameContext(h({ 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-origin' }))).toBe('same-origin-frame')
    expect(frameContext(h({ 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'same-site' }))).toBe('cross-origin-frame')
    expect(frameContext(h({ 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site' }))).toBe('cross-origin-frame')
    expect(frameContext(h({ 'sec-fetch-dest': 'iframe' }))).toBe('cross-origin-frame')
  })
})

describe('embedding', () => {
  it('?embed=1 asks for the embedded look', () => {
    expect(wantsEmbed({ embed: '1' })).toBe(true)
    expect(wantsEmbed(new URLSearchParams('embed=true'))).toBe(true)
    expect(wantsEmbed({ embed: '0' })).toBe(false)
    expect(wantsEmbed({})).toBe(false)
  })

  it('posts { type: "usertasks:resize", height } to the host page', () => {
    const msg = resizeMessage(812.3, '/f/x')
    expect(msg).toEqual({ type: 'usertasks:resize', height: 813, path: '/f/x' })
    expect(isResizeMessage(msg)).toBe(true)
    expect(isResizeMessage({ type: 'usertasks:resize', height: 'x' })).toBe(false)
    expect(isResizeMessage({ type: 'other', height: 1 })).toBe(false)
    expect(resizeMessage(Number.NaN, '/').height).toBe(0)
  })

  it('builds an escaped iframe snippet with ?embed=1 and an origin-checked resize script', () => {
    expect(embedUrl('https://acme.usertasks.com/form/x?a=1')).toBe('https://acme.usertasks.com/form/x?a=1&embed=1')
    const snippet = iframeSnippet('https://usertasks.com/f/abc', 'Say "hi" <now>')
    expect(snippet).toContain('src="https://usertasks.com/f/abc?embed=1"')
    expect(snippet).toContain('title="Say &quot;hi&quot; &lt;now&gt;"')
    expect(snippet).toContain('data-usertasks-form')
    const script = resizeScriptSnippet('https://acme.usertasks.com/')
    expect(script).toContain('e.origin !== "https://acme.usertasks.com"')
    expect(script).toContain('usertasks:resize')
    expect(script).toContain('f.contentWindow === e.source')
  })

  it('the page body posts its height when embedded (EmbedFrame wiring)', () => {
    const src = readFileSync(path.join(process.cwd(), 'components/forms/embed-frame.tsx'), 'utf8')
    expect(src).toMatch(/window\.parent\.postMessage\(resizeMessage\(/)
    expect(src).toMatch(/ResizeObserver/)
  })
})

describe('/form-login: the return path', () => {
  it('accepts only form link paths on this host', () => {
    expect(sanitizeFormReturnPath(`/f/${FORM_ID}`)).toBe(`/f/${FORM_ID}`)
    expect(sanitizeFormReturnPath('/form/employee-onboarding?customer=ALFKI&embed=1')).toBe('/form/employee-onboarding?customer=ALFKI&embed=1')
    for (const bad of [
      'https://evil.example/f/x', '//evil.example/f/x', '/\\evil.example', '/\\/evil', 'javascript:alert(1)', '/settings', '/home', '/f/', '/f/a/b',
      '/f/..', '/f/%2e%2e', '/form/a%2Fb', '/f/x\r\nSet-Cookie:a', '/p/token', '', '   ', '/fill/x', 'f/x', '/form/x#frag', null, 42,
    ]) {
      expect(sanitizeFormReturnPath(bad as string), String(bad)).toBeNull()
    }
  })

  it('formLoginUrl / formIdOfReturnPath', () => {
    expect(formLoginUrl('/form/x?a=1', { embed: true })).toBe('/form-login?redirect=%2Fform%2Fx%3Fa%3D1&embed=1')
    expect(formLoginUrl('https://evil.example')).toBe('/form-login')
    expect(formIdOfReturnPath(`/f/${FORM_ID}?a=1`)).toBe(FORM_ID)
    expect(formIdOfReturnPath('/form/x')).toBeNull()
  })

  it('a signed-in visitor goes straight back to the form — never to another site', async () => {
    state.user = { id: 'u1' }
    expect(((await openLogin({ redirect: `/f/${FORM_ID}` })) as Redirect).url).toBe(`/f/${FORM_ID}`)
    const page = await openLogin({ redirect: 'https://evil.example/f/x' })
    expect(page).not.toBeInstanceOf(Redirect)
  })

  it('renders the workspace design: the address’s workspace, else the /f/ form’s', async () => {
    state.tenantOfForm = 'tenant-f'
    const page = await openLogin({ redirect: `/f/${FORM_ID}` }) as ReactElement
    expect(state.loaded).toEqual(['tenant-f'])
    const html = renderToStaticMarkup(page)
    expect(html).toContain('Welcome to Acme forms')
    expect(html).toContain('data-sign-in-design="split"')
    expect(html).toContain('Continue with Okta')
    // The UserTasks look (the workspace hasn't turned on its theme): scoped tokens, no theme object.
    expect(html).toContain('data-sign-in-theme="usertasks"')
    expect(html).toContain('[data-fsi-root]{')
    state.loaded = []
    state.host = { kind: 'signed_out', tenant: A }
    await openLogin({ redirect: '/form/contact-us' })
    expect(state.loaded).toEqual(['tenant-a'])
    state.loaded = []
    state.host = { kind: 'none' }
    await openLogin({ redirect: '/form/contact-us' })
    expect(state.loaded).toEqual([null])
  })

  it('embedded: the compact design with "Open the form in a new tab" (no sign-in in third-party frames)', async () => {
    state.embed = true
    state.frame = 'cross-origin-frame'
    const html = renderToStaticMarkup(await openLogin({ redirect: '/form/contact-us?embed=1&a=1', embed: '1' }) as ReactElement)
    expect(html).toContain('data-sign-in-design="compact"')
    expect(html).toContain('data-sign-in-open-tab')
    expect(html).toContain('href="/form/contact-us?a=1"')
    expect(html).not.toContain('data-sign-in-submit')
  })
})

describe('sign-in page settings', () => {
  it('validates design 1–10, text lengths, links, colours and unknown keys', () => {
    expect(formSignInInputProblem({ design: 1 })).toBeNull()
    expect(formSignInInputProblem({ design: 10 })).toBeNull()
    for (const design of [0, 11, 2.5, '3', null]) expect(formSignInInputProblem({ design }), String(design)).toMatch(/design/)
    expect(formSignInInputProblem({ heading: '' })).toMatch(/Heading/)
    expect(formSignInInputProblem({ heading: 'x'.repeat(81) })).toMatch(/80/)
    expect(formSignInInputProblem({ subheading: 'x'.repeat(301) })).toMatch(/300/)
    expect(formSignInInputProblem({ button_label: 'x'.repeat(41) })).toMatch(/40/)
    expect(formSignInInputProblem({ footer_text: 'x'.repeat(300) })).toBeNull()
    expect(formSignInInputProblem({ support_link_url: 'javascript:alert(1)' })).toMatch(/Support link/)
    expect(formSignInInputProblem({ support_link_url: 'mailto:help@acme.com' })).toBeNull()
    expect(formSignInInputProblem({ support_link_url: 'https://help.acme.com/forms' })).toBeNull()
    expect(formSignInInputProblem({ support_link_url: '' })).toBeNull()
    expect(formSignInInputProblem({ accent_color: 'red' })).toMatch(/hex/)
    expect(formSignInInputProblem({ accent_color: '#0F766E' })).toBeNull()
    expect(formSignInInputProblem({ logo_url: 'x'.repeat(501) })).toMatch(/logo/)
    expect(formSignInInputProblem({ colour: '#000' })).toMatch(/Unknown/)
    expect(formSignInInputProblem({ use_workspace_theme: true })).toBeNull()
    expect(formSignInInputProblem({ use_workspace_theme: false })).toBeNull()
    expect(formSignInInputProblem({ use_workspace_theme: 'yes' })).toMatch(/use_workspace_theme/)
    expect(formSignInInputProblem(null)).toMatch(/object/)
  })

  it('stored values are normalised leniently (bad ones fall back) and patches clear with ""', () => {
    expect(parseFormSignInSettings(null)).toEqual(DEFAULT_SIGN_IN_SETTINGS)
    expect(parseFormSignInSettings({ design: 99, heading: 'x'.repeat(200), support_link_url: 'javascript:x', accent_color: 'nope' }))
      .toMatchObject({ design: 1, heading: DEFAULT_SIGN_IN_SETTINGS.heading, support_link_url: null, accent_color: null })
    expect(signInSettingsFromTenantSettings({ forms: { sign_in: { design: 7 }, anonymous: { enabled: true } } }).design).toBe(7)
    // Off unless explicitly true (existing workspaces keep the UserTasks look).
    expect(parseFormSignInSettings({}).use_workspace_theme).toBe(false)
    expect(parseFormSignInSettings({ use_workspace_theme: 'true' }).use_workspace_theme).toBe(false)
    expect(parseFormSignInSettings({ use_workspace_theme: true }).use_workspace_theme).toBe(true)
    expect(applyFormSignInPatch(DEFAULT_SIGN_IN_SETTINGS, { use_workspace_theme: true }).use_workspace_theme).toBe(true)
    const set = applyFormSignInPatch(DEFAULT_SIGN_IN_SETTINGS, { design: 4, accent_color: '#0F766E', support_link_url: 'https://x.test' })
    expect(set).toMatchObject({ design: 4, accent_color: '#0f766e', support_link_url: 'https://x.test' })
    expect(applyFormSignInPatch(set, { accent_color: '', support_link_url: '' })).toMatchObject({ accent_color: null, support_link_url: null, design: 4 })
  })

  it('accent colours stay legible (AA) whatever the accent', () => {
    for (const accent of ['#ffff00', '#4f46e5', '#0f766e', '#f97316', '#111111', '#e5e7eb', null]) {
      const c = signInColors(accent)
      expect(contrast(c.accent, c.onAccent), `${accent} on-accent`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.accentInk, '#ffffff'), `${accent} ink`).toBeGreaterThanOrEqual(4.5)
      expect(contrast(c.accentOnDark, '#0b0f19'), `${accent} on dark`).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('the ten designs render', () => {
  const base = {
    logoUrl: null, workspace: { name: 'Acme', slug: 'acme' }, themeStyle: signInThemeStyle({ use_workspace_theme: false, accent_color: '#4f46e5' }, null),
    options: { provider: 'builtin' as const, password: true, sso: [{ id: 'google', name: 'Google', kind: 'google' as const }] },
    returnPath: `/f/${FORM_ID}`, ssoStart: null, openUrl: `/f/${FORM_ID}`, embed: false,
  }
  it.each(SIGN_IN_DESIGNS.map((d) => [d.id, d.key] as const))('design %i (%s)', (id, key) => {
    const settings = { ...DEFAULT_SIGN_IN_SETTINGS, design: id, heading: 'Staff sign-in', button_label: 'Let me in', footer_text: 'Need access? Ask IT.', support_link_label: 'Help desk', support_link_url: 'https://help.acme.test' }
    const html = renderToStaticMarkup(createElement(FormSignInScreen, { ...base, settings }))
    expect(html).toContain(`data-sign-in-design="${key}"`)
    expect(html).toContain(`data-sign-in-design-id="${id}"`)
    expect(html).toMatch(/<h1[^>]*>Staff sign-in<\/h1>/)
    expect(html).toContain('Let me in')
    // Labelled fields; the organisation is known on a workspace's page, so it isn't asked.
    expect(html).toContain('for="fsi-email"')
    expect(html).toContain('for="fsi-password"')
    expect(html).not.toContain('for="fsi-org"')
    expect(html).toContain('Continue with Google')
    expect(html).toContain('href="https://help.acme.test"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).toContain('Acme')
  })

  it('asks for the organisation when the link names no workspace, and shows the logo when set', () => {
    const html = renderToStaticMarkup(createElement(FormSignInScreen, { ...base, workspace: null, logoUrl: '/files/logos/t/form-sign-in.png', settings: DEFAULT_SIGN_IN_SETTINGS }))
    expect(html).toContain('for="fsi-org"')
    expect(html).toContain('src="/files/logos/t/form-sign-in.png"')
    // The workspace's logo replaces the UserTasks one.
    expect(html).not.toContain('data-sign-in-usertasks-logo')
  })

  it('the default design is the UserTasks look: UserTasks logo, palette and Fraunces headline', () => {
    const themeStyle = signInThemeStyle(DEFAULT_SIGN_IN_SETTINGS, null)
    const html = renderToStaticMarkup(createElement(FormSignInScreen, { ...base, themeStyle, settings: DEFAULT_SIGN_IN_SETTINGS }))
    expect(DEFAULT_SIGN_IN_SETTINGS.design).toBe(1)
    expect(html).toContain('data-sign-in-design-id="1"')
    expect(html).toContain('data-sign-in-usertasks-logo')
    expect(html).toContain('aria-label="UserTasks"')
    expect(html).toContain('data-sign-in-theme="usertasks"')
    expect(html).toMatch(/--theme-surface:#FAF8F3/i)
    expect(html).toMatch(/<h1[^>]*class="[^"]*font-display/)
    // The workspace it signs in to is named.
    expect(html).toContain('data-sign-in-workspace')
    expect(html).toContain('Acme')
    // Ink buttons (the UserTasks accent) when no accent colour is set.
    expect(themeStyle.accent).toBe('#17150f')
  })
})

describe('sign-in page look (lib/forms/sign-in-theme.ts)', () => {
  async function customTheme() {
    const { defaultWorkspaceTheme } = await import('@/lib/theme/presets')
    const theme = defaultWorkspaceTheme()
    return { ...theme, meta: { ...theme.meta, mode: 'light' as const }, colors: { ...theme.colors, light: { ...theme.colors.light, primary: '#0F766E', surface: '#ECFDF5' } } }
  }
  const base = {
    logoUrl: null, workspace: { name: 'Acme', slug: 'acme' },
    options: { provider: 'builtin' as const, password: true, sso: [] },
    returnPath: `/f/${FORM_ID}`, ssoStart: null, openUrl: `/f/${FORM_ID}`, embed: false,
  }

  it('off: the UserTasks palette with the accent colour setting', () => {
    const style = signInThemeStyle({ use_workspace_theme: false, accent_color: '#c2410c' }, null)
    expect(style).toMatchObject({ source: 'usertasks', accent: '#c2410c', headings: 'display', fontsHref: null })
    expect(style.css.startsWith('[data-fsi-root]{')).toBe(true)
    expect(style.css).toMatch(/--theme-primary:#17150F/i)
  })

  it('on: the workspace theme tokens and its primary; the accent setting is ignored', async () => {
    const theme = await customTheme()
    const style = signInThemeStyle({ use_workspace_theme: true, accent_color: '#c2410c' }, theme)
    expect(style).toMatchObject({ source: 'workspace', accent: '#0f766e' })
    expect(style.css).toMatch(/--theme-primary:#0F766E/i)
    expect(style.css).toMatch(/--theme-surface:#ECFDF5/i)
    // Off again: back to the defaults even with the theme at hand.
    expect(signInThemeStyle({ use_workspace_theme: false, accent_color: null }, theme).css).not.toMatch(/#ECFDF5/i)
    // On, but no workspace (a /form/<name> link on the main address): the UserTasks look.
    expect(signInThemeStyle({ use_workspace_theme: true, accent_color: null }, null).source).toBe('usertasks')
  })

  it('a dark workspace theme draws dark, and the page renders the theme variables', async () => {
    const { defaultWorkspaceTheme } = await import('@/lib/theme/presets')
    const theme = defaultWorkspaceTheme()
    const dark = { ...theme, meta: { ...theme.meta, mode: 'dark' as const } }
    const darkStyle = signInThemeStyle({ use_workspace_theme: true, accent_color: null }, dark)
    expect(darkStyle.css).toContain(`--theme-surface:${dark.colors.dark.surface}`)
    const settings = { ...DEFAULT_SIGN_IN_SETTINGS, use_workspace_theme: true }
    const html = renderToStaticMarkup(createElement(FormSignInScreen, { ...base, settings, themeStyle: signInThemeStyle(settings, await customTheme()) }))
    expect(html).toContain('data-sign-in-theme="workspace"')
    expect(html).toMatch(/--theme-primary:#0F766E/i)
  })
})
