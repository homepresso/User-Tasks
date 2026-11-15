/**
 * Trusted embedding (lib/embedding.ts): the origin list (parsing, env vs
 * instance setting), the frame-ancestors the proxy sends on /embed/ routes
 * (and only there), SameSite=None session cookies only with origins + https,
 * and the CSRF guard that strips session cookies from the cross-site
 * requests SameSite=Lax would not have carried them on.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import {
  EMBED_FRAME_ANCESTORS_SETTING, embedFrameAncestors, framedSessionsEnabled, normaliseEmbedList, parseFrameAncestor,
  resolveEmbedPolicy, sessionCookiesAllowed, validateEmbedSetting,
} from '@/lib/embedding'
import { buildContentSecurityPolicy, frameAncestorsSource } from '@/lib/csp'
import { sessionCookieOptions, authCookieOptions } from '@/lib/providers/auth/cookies'
import { writeSettingsCache, readSettingsCacheStale } from '@/lib/config/settings-cache'
import { extensionManifestSchema } from '@/lib/extensions/manifest'

const ENV_KEYS = ['EMBED_FRAME_ANCESTORS', 'APP_URL', 'NEXT_PUBLIC_APP_URL', 'AUTH_COOKIE_SECURE'] as const
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  writeSettingsCache(null)
})

describe('origin list', () => {
  it('normalises origins and refuses anything that could widen framing', () => {
    expect(parseFrameAncestor('https://Intranet.Contoso.com/')).toEqual({ origin: 'https://intranet.contoso.com' })
    expect(parseFrameAncestor('https://sp.contoso.com:443')).toEqual({ origin: 'https://sp.contoso.com' })
    expect(parseFrameAncestor('http://spsites:80')).toEqual({ origin: 'http://spsites' })
    expect(parseFrameAncestor('https://sp.contoso.com:8443')).toEqual({ origin: 'https://sp.contoso.com:8443' })
    expect(parseFrameAncestor('https://*.contoso.com')).toEqual({ origin: 'https://*.contoso.com' })
    for (const bad of ['*', 'https://*', 'https:', 'https://*.com', 'sp.contoso.com', 'https://sp.contoso.com/sites/a', "'self'", 'https://a.com https://b.com', 'https://a.com;script-src *', 'javascript://x', 'https://u:p@host']) {
      expect('error' in parseFrameAncestor(bad), bad).toBe(true)
    }
  })

  it('environment wins over the instance setting; bad entries are reported, not used', () => {
    const settings = new Map<string, unknown>([[EMBED_FRAME_ANCESTORS_SETTING, ['https://sp.contoso.com']]])
    expect(resolveEmbedPolicy({}, settings)).toEqual({ origins: ['https://sp.contoso.com'], source: 'setting', invalid: [] })
    const env = resolveEmbedPolicy({ EMBED_FRAME_ANCESTORS: 'https://a.example.com, *  http://b' }, settings)
    expect(env.source).toBe('env')
    expect(env.origins).toEqual(['https://a.example.com', 'http://b'])
    expect(env.invalid).toHaveLength(1)
    expect(resolveEmbedPolicy({}, null)).toEqual({ origins: [], source: 'none', invalid: [] })
  })

  it('stored values must be normalised lists', () => {
    expect(normaliseEmbedList(['https://A.com/', 'https://a.com'])).toEqual(['https://a.com'])
    expect(() => validateEmbedSetting(EMBED_FRAME_ANCESTORS_SETTING, ['https://a.com'])).not.toThrow()
    expect(() => validateEmbedSetting(EMBED_FRAME_ANCESTORS_SETTING, ['https://A.com'])).toThrow(/store/)
    expect(() => validateEmbedSetting(EMBED_FRAME_ANCESTORS_SETTING, ['*'])).toThrow()
    expect(() => validateEmbedSetting(EMBED_FRAME_ANCESTORS_SETTING, 'https://a.com')).toThrow(/list/)
    expect(() => validateEmbedSetting('instance.other', 'x')).not.toThrow()
  })
})

describe('frame-ancestors', () => {
  it("is 'self' + the origins, or 'none' without any", () => {
    expect(embedFrameAncestors({ origins: ['https://a.com', 'http://spsites'], source: 'env', invalid: [] })).toBe("'self' https://a.com http://spsites")
    expect(embedFrameAncestors({ origins: [], source: 'none', invalid: [] })).toBe("'none'")
  })

  it('the CSP builder only accepts well-formed source lists', () => {
    expect(frameAncestorsSource("'self' https://a.com https://*.b.com:8443")).toBe("'self' https://a.com https://*.b.com:8443")
    expect(frameAncestorsSource('*')).toBe('*')
    expect(frameAncestorsSource("'self' https://a.com; script-src *")).toBe("'none'")
    expect(frameAncestorsSource(undefined)).toBe("'none'")
    expect(buildContentSecurityPolicy({ supabaseUrl: undefined, isDev: false, frameAncestors: "'self' https://a.com" })).toContain("frame-ancestors 'self' https://a.com")
  })
})

describe('framed sessions (SameSite=None)', () => {
  it('only with origins configured and Secure cookies', () => {
    const policy = { origins: ['https://sp.contoso.com'], source: 'env' as const, invalid: [] }
    expect(framedSessionsEnabled(true, policy)).toBe(true)
    expect(framedSessionsEnabled(false, policy)).toBe(false)
    expect(framedSessionsEnabled(true, { origins: [], source: 'none', invalid: [] })).toBe(false)
  })

  it('session cookies switch, flow cookies stay Lax', () => {
    process.env.APP_URL = 'https://ut.example.com'
    delete process.env.EMBED_FRAME_ANCESTORS
    expect(sessionCookieOptions(60).sameSite).toBe('lax')
    process.env.EMBED_FRAME_ANCESTORS = 'https://sp.contoso.com'
    expect(sessionCookieOptions(60)).toMatchObject({ sameSite: 'none', secure: true, httpOnly: true })
    expect(authCookieOptions(60).sameSite).toBe('lax')
    process.env.APP_URL = 'http://localhost:3000'
    expect(sessionCookieOptions(60).sameSite).toBe('lax')
  })

  it('reads the instance setting from the shared settings cache', () => {
    process.env.APP_URL = 'https://ut.example.com'
    delete process.env.EMBED_FRAME_ANCESTORS
    writeSettingsCache(new Map([[EMBED_FRAME_ANCESTORS_SETTING, ['https://sp.contoso.com']]]))
    expect(readSettingsCacheStale()?.get(EMBED_FRAME_ANCESTORS_SETTING)).toEqual(['https://sp.contoso.com'])
    expect(sessionCookieOptions(60).sameSite).toBe('none')
  })
})

describe('CSRF guard (what SameSite=Lax used to do)', () => {
  const req = (method: string, pathname: string, headers: Record<string, string>) => ({ method, pathname, get: (n: string) => headers[n.toLowerCase()] ?? null })
  const cross = (mode: string, dest: string) => ({ 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': mode, 'sec-fetch-dest': dest })

  it('keeps same-origin, same-site and user-initiated requests', () => {
    expect(sessionCookiesAllowed(req('POST', '/tasks', { 'sec-fetch-site': 'same-origin' }))).toBe(true)
    expect(sessionCookiesAllowed(req('POST', '/tasks', { 'sec-fetch-site': 'same-site' }))).toBe(true)
    expect(sessionCookiesAllowed(req('GET', '/tasks', { 'sec-fetch-site': 'none' }))).toBe(true)
  })

  it('cross-site: top-level GET navigations and framed embeddable pages only', () => {
    expect(sessionCookiesAllowed(req('GET', '/tasks', cross('navigate', 'document')))).toBe(true)
    expect(sessionCookiesAllowed(req('GET', '/embed/x/acme/launch', cross('navigate', 'iframe')))).toBe(true)
    expect(sessionCookiesAllowed(req('GET', '/tasks', cross('navigate', 'iframe')))).toBe(false)
    expect(sessionCookiesAllowed(req('POST', '/embed/x/acme/launch', cross('navigate', 'iframe')))).toBe(false)
    expect(sessionCookiesAllowed(req('POST', '/tasks', cross('navigate', 'document')))).toBe(false)
    expect(sessionCookiesAllowed(req('GET', '/api/v1/tasks', cross('cors', 'empty')))).toBe(false)
    expect(sessionCookiesAllowed(req('GET', '/embed/x/acme/launch', cross('no-cors', 'image')))).toBe(false)
  })

  it('browsers without Fetch Metadata: unsafe requests from another origin lose the session', () => {
    expect(sessionCookiesAllowed(req('POST', '/tasks', { origin: 'https://evil.example', host: 'ut.example.com' }))).toBe(false)
    expect(sessionCookiesAllowed(req('POST', '/tasks', { origin: 'https://ut.example.com', host: 'ut.example.com' }))).toBe(true)
    expect(sessionCookiesAllowed(req('POST', '/tasks', { origin: 'null', host: 'ut.example.com' }))).toBe(false)
    expect(sessionCookiesAllowed(req('GET', '/tasks', {}))).toBe(true)
  })
})

describe('proxy', () => {
  async function run(url: string, init: { method?: string; headers?: Record<string, string> } = {}) {
    const { proxy } = await import('@/proxy')
    const u = new URL(url)
    return proxy(new NextRequest(url, { method: init.method ?? 'GET', headers: { host: u.host, ...(init.headers ?? {}) } }))
  }

  it('embeddable routes: approved origins, no X-Frame-Options; everything else stays DENY', async () => {
    process.env.EMBED_FRAME_ANCESTORS = 'https://sp.contoso.com'
    const embed = await run('https://ut.example.com/embed/x/acme/launch')
    expect(embed.headers.get('content-security-policy')).toContain("frame-ancestors 'self' https://sp.contoso.com")
    expect(embed.headers.get('x-frame-options')).toBeNull()
    const other = await run('https://ut.example.com/x/acme/launch')
    expect(other.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(other.headers.get('x-frame-options')).toBe('DENY')
  })

  it('without origins, /embed/ is not framable either', async () => {
    delete process.env.EMBED_FRAME_ANCESTORS
    const embed = await run('https://ut.example.com/embed/x/acme/launch')
    expect(embed.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    expect(embed.headers.get('x-frame-options')).toBe('DENY')
  })

  it('strips the session cookie from a cross-site POST when framed sessions are on, keeps it otherwise', async () => {
    process.env.APP_URL = 'https://ut.example.com'
    process.env.EMBED_FRAME_ANCESTORS = 'https://sp.contoso.com'
    const cookie = '__Host-ut_session=abc; theme=dark'
    const forwarded = (res: Response) => res.headers.get('x-middleware-request-cookie')
    const post = await run('https://ut.example.com/tasks', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } })
    expect(forwarded(post)).not.toContain('ut_session')
    expect(forwarded(post)).toContain('theme=dark')
    const framed = await run('https://ut.example.com/embed/x/acme/launch', { headers: { cookie, 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' } })
    expect(forwarded(framed) ?? cookie).toContain('__Host-ut_session=abc')
    delete process.env.EMBED_FRAME_ANCESTORS
    const lax = await run('https://ut.example.com/tasks', { method: 'POST', headers: { cookie, 'sec-fetch-site': 'cross-site' } })
    expect(forwarded(lax) ?? cookie).toContain('__Host-ut_session=abc')
  })
})

describe('manifest', () => {
  it('pages may declare themselves embeddable', () => {
    const base = {
      manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' }, engines: { usertasks: '>=0.1.0' },
      licence: { tier: 'free' }, contributes: { ui: { pages: [{ path: 'launch', title: 'Launch', embeddable: true }] } },
    }
    const parsed = extensionManifestSchema.parse(base)
    expect(parsed.contributes.ui.pages[0].embeddable).toBe(true)
  })
})
