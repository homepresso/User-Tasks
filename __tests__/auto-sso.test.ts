import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { authorizeAtMockIdp, startMockOidcIdp, type MockOidcIdp } from './helpers/mock-oidc-idp'
import { cookieWrites, jar, resetRequest } from './helpers/next-headers-mock'

/**
 * Automatic (silent) SSO — lib/providers/auth/sso/auto.ts: the settings,
 * which IdP a workspace uses, the passive OIDC round trip against a mock IdP
 * (prompt=none, login_required → interactive restart or return-to-target),
 * the frame flow's SameSite=None binding cookie, SAML NoPassive, and that
 * nothing the launching system sends can pick who is signed in.
 */

vi.mock('next/headers', () => import('./helpers/next-headers-mock'))

// Flow state in memory (the real store is app_auth.flow_states).
const flows = new Map<string, { kind: string; data: Record<string, unknown> }>()
vi.mock('@/lib/providers/auth/builtin/store', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/providers/auth/builtin/store')>()
  return {
    ...real,
    randomToken: (bytes = 32) => randomBytes(bytes).toString('base64url'),
    saveFlowState: async (id: string, kind: string, data: Record<string, unknown>) => { flows.set(id, { kind, data }) },
    takeFlowState: async (id: string, kind: string) => {
      const hit = flows.get(id)
      if (!hit || hit.kind !== kind) return null
      flows.delete(id)
      return hit.data
    },
  }
})

const auto = await import('@/lib/providers/auth/sso/auto')
const { parseSsoProviders } = await import('@/lib/providers/auth/sso/config')
const oidc = await import('@/lib/providers/auth/sso/oidc')

describe('workspace settings', () => {
  it('defaults: automatic sign-in on, SSO only off, IdP automatic — also for malformed values', () => {
    expect(auto.workspaceSsoFromTenantSettings(null)).toEqual({ auto_sign_in: true, sso_only: false, idp: null })
    expect(auto.workspaceSsoFromTenantSettings({ sso: { auto_sign_in: 'yes', sso_only: 1, idp: 'Not An Id!' } })).toEqual({ auto_sign_in: true, sso_only: false, idp: null })
    expect(auto.workspaceSsoFromTenantSettings({ sso: { auto_sign_in: false, sso_only: true, idp: 'adfs' } })).toEqual({ auto_sign_in: false, sso_only: true, idp: 'adfs' })
  })

  it('validates patches and applies only what is sent', () => {
    expect(auto.workspaceSsoPatchProblem({ auto_sign_in: 'no' })).toMatch(/true or false/)
    expect(auto.workspaceSsoPatchProblem({ idp: 'Bad Id' })).toMatch(/identity provider id/)
    expect(auto.workspaceSsoPatchProblem({ other: true })).toMatch(/Unknown setting/)
    expect(auto.workspaceSsoPatchProblem([])).toBeTruthy()
    expect(auto.workspaceSsoPatchProblem({ idp: null, sso_only: true })).toBeNull()
    const before = { auto_sign_in: true, sso_only: false, idp: 'adfs' }
    expect(auto.applyWorkspaceSsoPatch(before, { sso_only: true })).toEqual({ auto_sign_in: true, sso_only: true, idp: 'adfs' })
    expect(auto.applyWorkspaceSsoPatch(before, { idp: '' })).toEqual({ auto_sign_in: true, sso_only: false, idp: null })
  })
})

describe('which IdP a workspace signs in with', () => {
  const settings = auto.DEFAULT_WORKSPACE_SSO
  const adfs = { id: 'adfs', name: 'AD FS', defaultOrg: 'contoso' }
  const entra = { id: 'entra', name: 'Microsoft', defaultOrg: 'fabrikam' }

  it('the chosen one, if it exists', () => {
    expect(auto.chooseAutoIdp([adfs, entra], { ...settings, idp: 'entra' }, 'contoso', true)?.id).toBe('entra')
    expect(auto.chooseAutoIdp([adfs], { ...settings, idp: 'gone' }, 'contoso', true)).toBeNull()
  })

  it('automatic: the IdP provisioning into the workspace, else the only one, else none', () => {
    expect(auto.chooseAutoIdp([adfs, entra], settings, 'contoso', true)?.id).toBe('adfs')
    expect(auto.chooseAutoIdp([adfs, entra], settings, 'other', true)).toBeNull()
    expect(auto.chooseAutoIdp([adfs], settings, 'other', true)?.id).toBe('adfs')
    expect(auto.chooseAutoIdp([adfs], settings, null, true)?.id).toBe('adfs')
  })

  it('Supabase Auth buttons are never chosen implicitly', () => {
    const microsoft = { id: 'microsoft', name: 'Microsoft' }
    expect(auto.chooseAutoIdp([microsoft], settings, 'acme', false)).toBeNull()
    expect(auto.chooseAutoIdp([microsoft], { ...settings, idp: 'microsoft' }, 'acme', false)?.id).toBe('microsoft')
  })
})

describe('hints and paths', () => {
  it('builds the automatic sign-in URL with local targets only', () => {
    expect(auto.autoSsoPath({ redirect: '/x/sharepoint/launch?a=1', org: 'contoso' })).toBe('/auth/auto-sso?redirect=%2Fx%2Fsharepoint%2Flaunch%3Fa%3D1&org=contoso')
    expect(auto.autoSsoPath({ redirect: '/embed/auth/sso-done', mode: 'frame', purpose: 'login' })).toBe('/auth/auto-sso?redirect=%2Fembed%2Fauth%2Fsso-done&mode=frame&for=login')
    expect(auto.withSsoError('/embed/auth/sso-done', 'login_required')).toBe('/embed/auth/sso-done?sso_error=login_required')
    expect(auto.withSsoError('/x/a?b=1', 'no_invite')).toBe('/x/a?b=1&sso_error=no_invite')
  })

  it('workspace and login hints are shape-checked (they never name who signs in)', () => {
    expect(auto.cleanOrgHint('Contoso')).toBe('contoso')
    expect(auto.cleanOrgHint(['acme-1'])).toBe('acme-1')
    expect(auto.cleanOrgHint('../evil')).toBeNull()
    expect(auto.cleanOrgHint(undefined)).toBeNull()
    expect(auto.cleanLoginHint('anab@contoso.local')).toBe('anab@contoso.local')
    expect(auto.cleanLoginHint('a b')).toBeNull()
    expect(auto.cleanLoginHint('<script>')).toBeNull()
  })
})

describe('passive OIDC round trip (mock IdP)', () => {
  let idp: MockOidcIdp
  let config: ReturnType<typeof parseSsoProviders>[0] & { type: 'oidc' }

  beforeAll(async () => {
    idp = await startMockOidcIdp({ clientId: 'ut', clientSecret: 's' })
    config = parseSsoProviders([{ id: 'mock', type: 'oidc', issuer: idp.issuer, clientId: 'ut', clientSecret: 's', domainHint: 'contoso.com' }])[0] as typeof config
  })
  afterAll(() => idp.close())
  beforeEach(() => { idp.needsInteraction = false; idp.prompts.length = 0; flows.clear(); oidc.clearOidcCache() })

  async function roundTrip(start: Parameters<typeof oidc.startOidc>[1]) {
    const { url, binding } = await oidc.startOidc(config, start)
    const callback = await authorizeAtMockIdp(url)
    const p = callback.searchParams
    return { url: new URL(url), finish: () => oidc.finishOidc(config, { state: p.get('state'), code: p.get('code'), error: p.get('error'), binding, origin: 'https://app.test' }) }
  }

  it('asks with prompt=none (and the domain hint), and signs in silently when the IdP can', async () => {
    const { url, finish } = await roundTrip({ origin: 'https://app.test', redirect: '/x/sharepoint/launch', org: 'contoso', passive: true })
    expect(url.searchParams.get('prompt')).toBe('none')
    expect(url.searchParams.get('domain_hint')).toBe('contoso.com')
    const result = await finish()
    expect(result.identity.subject).toBe('mock-user')
    expect(result).toMatchObject({ redirect: '/x/sharepoint/launch', org: 'contoso', flow: { passive: true, fallback: 'interactive' } })
  })

  it('login_required on a passive flow → InteractionRequired carrying the flow (target, workspace, fallback)', async () => {
    idp.needsInteraction = true
    const { finish } = await roundTrip({ origin: 'https://app.test', redirect: '/embed/auth/sso-done', org: 'contoso', passive: true, fallback: 'return', loginHint: 'anab@contoso.local' })
    const error = await finish().catch((e) => e)
    expect(auto.isInteractionRequired(error)).toBe(true)
    expect(error.flow).toEqual({ idp: 'mock', redirect: '/embed/auth/sso-done', org: 'contoso', passive: true, fallback: 'return', loginHint: 'anab@contoso.local' })
  })

  it('an interactive flow sends no prompt, and an IdP error there is a plain failure (no loop)', async () => {
    const { url } = await roundTrip({ origin: 'https://app.test', redirect: '/home', org: null })
    expect(url.searchParams.has('prompt')).toBe(false)
    // An attacker-crafted error on a non-passive flow is not "interaction required".
    const { url: started, binding } = await oidc.startOidc(config, { origin: 'https://app.test', redirect: '/home', org: null })
    const state = new URL(started).searchParams.get('state')
    const error = await oidc.finishOidc(config, { state, code: null, error: 'login_required', binding, origin: 'https://app.test' }).catch((e) => e)
    expect(auto.isInteractionRequired(error)).toBe(false)
    expect(auto.flowOf(error)?.passive).toBe(false)
  })

  it('a passive error from another browser (no binding) is refused before anything else', async () => {
    idp.needsInteraction = true
    const { url } = await oidc.startOidc(config, { origin: 'https://app.test', redirect: '/home', org: null, passive: true })
    const callback = await authorizeAtMockIdp(url)
    const error = await oidc.finishOidc(config, { state: callback.searchParams.get('state'), code: null, error: 'login_required', binding: 'not-this-browser', origin: 'https://app.test' }).catch((e) => e)
    expect(auto.isInteractionRequired(error)).toBe(false)
    expect(String(error.message)).toMatch(/another browser/)
  })
})

describe('callback fallbacks (lib/providers/auth/sso/flow.ts)', () => {
  let idp: MockOidcIdp
  const saved: Record<string, string | undefined> = {}
  const KEYS = ['AUTH_PROVIDER', 'AUTH_SSO_PROVIDERS', 'APP_URL', 'DATABASE_URL', 'SUPABASE_URL', 'DB_PROVIDER'] as const

  beforeAll(async () => {
    idp = await startMockOidcIdp({ clientId: 'ut', clientSecret: 's' })
    for (const k of KEYS) saved[k] = process.env[k]
    process.env.AUTH_PROVIDER = 'builtin'
    process.env.APP_URL = 'https://app.test'
    process.env.AUTH_SSO_PROVIDERS = JSON.stringify([{ id: 'mock', type: 'oidc', issuer: idp.issuer, clientId: 'ut', clientSecret: 's' }])
  })
  afterAll(async () => {
    await idp.close()
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  })
  beforeEach(() => { resetRequest(); flows.clear(); idp.needsInteraction = true; idp.prompts.length = 0; oidc.clearOidcCache() })

  async function passiveCallback(options: { fallback: 'interactive' | 'return'; frame?: boolean }) {
    const { getAuthProvider } = await import('@/lib/providers/auth')
    const provider = await getAuthProvider()
    const url = await provider.startSso('mock', { redirect: '/x/sharepoint/launch?l=1', org: null, origin: 'https://app.test', passive: true, fallback: options.fallback, frame: options.frame })
    const binding = cookieWrites.find((w) => w.name === '__Host-ut_sso')
    const callback = await authorizeAtMockIdp(url)
    const { completeOidcCallback } = await import('@/lib/providers/auth/sso/flow')
    return { binding, target: await completeOidcCallback('mock', new Request(callback.toString()), { ip: null, userAgent: 'vitest' }) }
  }

  it('top level: a passive miss goes straight to the IdP\'s interactive sign-in — not the UserTasks sign-in page', async () => {
    const { binding, target } = await passiveCallback({ fallback: 'interactive' })
    expect(binding?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax' })
    expect(target.startsWith(`${idp.issuer}/authorize?`)).toBe(true)
    const restart = new URL(target)
    expect(restart.searchParams.has('prompt')).toBe(false)
    expect(idp.prompts).toEqual(['none'])
    // A new browser binding for the interactive flow.
    expect(jar.get('__Host-ut_sso')).toBeTruthy()
    expect(jar.get('__Host-ut_sso')).not.toBe(binding?.value)
  })

  it('frame: the binding cookie is SameSite=None (Secure) and a passive miss returns to the target with sso_error', async () => {
    const { binding, target } = await passiveCallback({ fallback: 'return', frame: true })
    expect(binding?.options).toMatchObject({ httpOnly: true, secure: true, sameSite: 'none' })
    expect(target).toBe('/x/sharepoint/launch?l=1&sso_error=login_required')
  })
})

describe('SAML passive', () => {
  it('builds an AuthnRequest with IsPassive only for passive flows', async () => {
    const { samlClient } = await import('@/lib/providers/auth/sso/saml')
    const cert = 'MIIBszCCAVmgAwIBAgIUQ'
    const idp = parseSsoProviders([{ id: 's', type: 'saml', entryPoint: 'https://idp.test/sso', idpCert: cert }])[0] as never
    const inflate = async (url: string) => {
      const { inflateRawSync } = await import('node:zlib')
      return inflateRawSync(Buffer.from(new URL(url).searchParams.get('SAMLRequest') ?? '', 'base64')).toString('utf8')
    }
    const passive = await (await samlClient(idp, 'https://app.test', fetch, { passive: true })).getAuthorizeUrlAsync('r', undefined, {})
    const normal = await (await samlClient(idp, 'https://app.test', fetch)).getAuthorizeUrlAsync('r', undefined, {})
    expect(await inflate(passive)).toMatch(/IsPassive="true"/)
    expect(await inflate(normal)).not.toMatch(/IsPassive="true"/)
  })

  it('a NoPassive answer to a passive flow → InteractionRequired; to any other flow → a failure', async () => {
    const saml = await import('@/lib/providers/auth/sso/saml')
    const idp = parseSsoProviders([{ id: 's', type: 'saml', entryPoint: 'https://idp.test/sso', idpCert: 'MIIBszCCAVmgAwIBAgIUQ' }])[0] as never
    const noPassive = Buffer.from('<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r" Version="2.0" IssueInstant="2026-11-14T00:00:00Z"><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Responder"><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:NoPassive"/></samlp:StatusCode></samlp:Status></samlp:Response>').toString('base64')
    flows.set('relay-passive', { kind: 'saml_relay:s', data: { redirect: '/x/sp/launch', org: 'contoso', passive: true, fallback: 'interactive' } })
    const error = await saml.finishSaml(idp, { SAMLResponse: noPassive, RelayState: 'relay-passive' }, 'https://app.test').catch((e) => e)
    expect(auto.isInteractionRequired(error)).toBe(true)
    expect(error.flow).toMatchObject({ idp: 's', redirect: '/x/sp/launch', org: 'contoso', fallback: 'interactive' })
    flows.set('relay-normal', { kind: 'saml_relay:s', data: { redirect: '/home', org: null } })
    const plain = await saml.finishSaml(idp, { SAMLResponse: noPassive, RelayState: 'relay-normal' }, 'https://app.test').catch((e) => e)
    expect(auto.isInteractionRequired(plain)).toBe(false)
    expect(plain.code).toBe('sso_failed')
    // Without this browser's RelayState, nothing at all.
    const unsolicited = await saml.finishSaml(idp, { SAMLResponse: noPassive, RelayState: null }, 'https://app.test').catch((e) => e)
    expect(auto.isInteractionRequired(unsolicited)).toBe(false)
  })
})

describe('frame-src for embeddable pages (the hidden frame goes to the IdP)', () => {
  it('collects IdP sign-in origins: configured, then discovered; forgets discovered ones when the IdPs change', async () => {
    const fs = await import('@/lib/providers/auth/sso/frame-sources')
    fs.writeSsoFrameSources(['https://adfs.contoso.local/adfs', 'javascript:alert(1)', 'https://u:p@evil.test/'])
    fs.addSsoFrameSources(['https://login.contoso.local/authorize'])
    expect(fs.readSsoFrameSources()).toEqual(['https://adfs.contoso.local', 'https://login.contoso.local'])
    fs.writeSsoFrameSources(['https://adfs.contoso.local/adfs'])
    expect(fs.readSsoFrameSources()).toEqual(['https://adfs.contoso.local', 'https://login.contoso.local'])
    fs.writeSsoFrameSources(['https://idp.fabrikam.test'])
    expect(fs.readSsoFrameSources()).toEqual(['https://idp.fabrikam.test'])
    expect(fs.embedFrameSrc()).toBe("'self' https://idp.fabrikam.test")
  })

  it('the CSP takes frame-src only as \'self\' plus origins', async () => {
    const { buildContentSecurityPolicy } = await import('@/lib/csp')
    const csp = (frameSrc?: string) => buildContentSecurityPolicy({ supabaseUrl: undefined, isDev: false, frameSrc })
    expect(csp("'self' https://adfs.contoso.local")).toContain("frame-src 'self' https://adfs.contoso.local;")
    expect(csp("'self' *")).toContain("frame-src 'self';")
    expect(csp()).not.toContain('frame-src')
  })
})
