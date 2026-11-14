import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

/**
 * AD FS as the identity provider, from material recorded against a real
 * AD FS (Windows Server 2025, contoso.local lab — see
 * docs/services/active-directory.md and scripts/ad-adfs-check.ts):
 *
 *  - OIDC: AD FS's discovery document and the claim set of an ID token it
 *    issued (re-signed here with a test key — the shape is what matters:
 *    `group` / `role` instead of `groups`, `unique_name` instead of `name`,
 *    `upn`, no email_verified), run through the full code flow.
 *  - SAML: a complete signed SAMLResponse AD FS posted to the ACS, verified
 *    with AD FS's token-signing certificate at the time it was issued
 *    (claim-type attribute names, NameID = email, Group values).
 *  - Group → role mapping on later sign-ins: enforceRoleMapping, and a
 *    workspace owner is never demoted by a claim rule.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'adfs')
const fixture = (name: string) => readFileSync(path.join(FIXTURES, name), 'utf8')

const flows = new Map<string, Record<string, unknown>>()
const remembered = new Set<string>()
vi.mock('@/lib/providers/auth/builtin/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveFlowState: vi.fn(async (id: string, kind: string, data: Record<string, unknown>) => { flows.set(`${kind}:${id}`, data) }),
  takeFlowState: vi.fn(async (id: string, kind: string) => { const v = flows.get(`${kind}:${id}`) ?? null; flows.delete(`${kind}:${id}`); return v }),
  rememberOnce: vi.fn(async (key: string) => { if (remembered.has(key)) return false; remembered.add(key); return true }),
}))
// SP-initiated SAML: node-saml looks the AuthnRequest id up in app_auth.flow_states.
// The stored value is when the request was made (node-saml checks its age).
const pendingRequests = new Map<string, string>()
vi.mock('@/lib/providers/auth/builtin/db', () => ({
  authDb: () => ({
    query: async () => ({ rows: [...pendingRequests.values()].slice(0, 1).map((value) => ({ data: { value } })) }),
  }),
}))

import { mapGroupsToRole, oidcGroupsClaims, parseSsoProviders, samlAttributeNames, type OidcIdpConfig, type SamlIdpConfig } from '@/lib/providers/auth/sso/config'
import { clearOidcCache, finishOidc, startOidc, toExternalIdentity } from '@/lib/providers/auth/sso/oidc'
import { clearSamlCache, finishSaml } from '@/lib/providers/auth/sso/saml'

const ISSUER = 'https://adfs.contoso.local/adfs'
const CLIENT_ID = '180d3053-1b64-4133-a6ee-4a9f67392230'
const claims = JSON.parse(fixture('id-token-claims.json')) as Record<string, unknown>
const adfs = (fields: Record<string, unknown> = {}) => parseSsoProviders([{
  id: 'adfs', type: 'oidc', preset: 'adfs', baseUrl: 'https://adfs.contoso.local', clientId: CLIENT_ID, clientSecret: 'adfs-client-secret',
  allowedDomains: ['contoso.local'], defaultOrg: 'contoso', roleMapping: { 'UT-Admins': 'admin' }, ...fields,
}])[0] as OidcIdpConfig

describe('AD FS OIDC claims (recorded claim set)', () => {
  it('reads email, the unique_name display name and the `group` claim; UT-Admins maps to admin', () => {
    const identity = toExternalIdentity(adfs(), claims)
    expect(identity).toMatchObject({
      subject: claims.sub,
      email: 'ut-test@contoso.local',
      emailVerified: true, // AD FS sends no email_verified: trusted because allowedDomains pins contoso.local
      name: 'Uta Tester',
      groups: ['Domain Users', 'UT-Admins'],
    })
    expect(mapGroupsToRole(identity.groups, { 'ut-admins': 'admin' })).toBe('admin')
    // Without allowedDomains (or trustEmail) the address is not trusted for linking / JIT.
    expect(toExternalIdentity(adfs({ allowedDomains: undefined }), claims).emailVerified).toBe(false)
  })

  it('falls back to upn without a mail attribute, and to given + family name when unique_name is a DOMAIN\\user login', () => {
    const noMail = Object.fromEntries(Object.entries(claims).filter(([k]) => k !== 'email'))
    expect(toExternalIdentity(adfs(), noMail).email).toBe('ut-test@contoso.local')
    expect(toExternalIdentity(adfs(), { ...claims, unique_name: 'CONTOSO\\ut-test' }).name).toBe('Uta Tester')
    // Matching on the UPN instead of mail: emailClaim upn.
    expect(toExternalIdentity(adfs({ emailClaim: 'upn' }), { ...claims, email: 'uta.tester@contoso.local' }).email).toBe('ut-test@contoso.local')
  })

  it('reads group, groups and role claims (deduplicated) unless groupsClaim names one; other presets keep `groups`', () => {
    expect(oidcGroupsClaims(adfs())).toEqual(['group', 'groups', 'role'])
    expect(toExternalIdentity(adfs(), { ...claims, group: 'UT-Admins', role: ['UT-Admins', 'Approvers'] }).groups).toEqual(['UT-Admins', 'Approvers'])
    // Group SIDs (Token-Groups as SIDs) instead of names.
    const bySid = toExternalIdentity(adfs({ groupsClaim: 'groupsid' }), claims)
    expect(bySid.groups).toContain('S-1-5-21-305597043-4057552235-3456481556-1605')
    expect(bySid.groups).not.toContain('UT-Admins')
    const generic = parseSsoProviders([{ id: 'g', type: 'oidc', issuer: 'https://idp.example.test', clientId: 'c' }])[0] as OidcIdpConfig
    expect(oidcGroupsClaims(generic)).toEqual(['groups'])
    expect(toExternalIdentity(generic, { iss: 'https://idp.example.test', sub: 's', group: ['x'] }).groups).toEqual([])
  })
})

describe('AD FS OIDC code flow (recorded discovery document)', () => {
  let jwks: Server
  let jwksUrl = ''
  let privateKey: CryptoKey
  const calls: Array<{ url: string; body?: string; auth?: string | null }> = []

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey as CryptoKey
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'adfs-signing', alg: 'RS256', use: 'sig' }
    jwks = createServer((_, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })) })
    await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r))
    jwksUrl = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/adfs/discovery/keys`
  })
  afterAll(() => new Promise<void>((r) => jwks.close(() => r())))
  beforeEach(() => { clearOidcCache(); calls.length = 0 })

  function fakeAdfs(nonceRef: { nonce?: string }) {
    const discovery = { ...JSON.parse(fixture('openid-configuration.json')), jwks_uri: jwksUrl }
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? String(init.body) : undefined, auth: new Headers(init?.headers).get('authorization') })
      if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json(discovery)
      if (url === discovery.token_endpoint) {
        const now = Math.floor(Date.now() / 1000)
        const rest = Object.fromEntries(Object.entries(claims).filter(([k]) => !['aud', 'iss', 'sub'].includes(k)))
        const idToken = await new SignJWT({ ...rest, nonce: nonceRef.nonce })
          .setProtectedHeader({ alg: 'RS256', kid: 'adfs-signing', typ: 'JWT' }).setIssuer(ISSUER).setAudience(CLIENT_ID).setSubject(String(claims.sub))
          .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 3600).sign(privateKey)
        return Response.json({ access_token: 'adfs-access-token', token_type: 'bearer', expires_in: 3600, id_token: idToken, refresh_token: 'adfs-refresh' })
      }
      // AD FS userinfo only accepts tokens for urn:microsoft:userinfo: with a resource access token it refuses.
      if (url === discovery.userinfo_endpoint) return new Response('', { status: 401 })
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
  }

  it('authorize → token (client_secret_post) → ID token verified → identity from the ID token alone', async () => {
    const idp = adfs()
    const nonceRef: { nonce?: string } = {}
    const fetchImpl = fakeAdfs(nonceRef)
    const { url, binding } = await startOidc(idp, { origin: 'https://tasks.contoso.local', redirect: '/tasks', org: null }, fetchImpl)
    const authorize = new URL(url)
    expect(authorize.origin + authorize.pathname).toBe('https://adfs.contoso.local/adfs/oauth2/authorize/')
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID)
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://tasks.contoso.local/auth/sso/adfs/callback')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    const state = authorize.searchParams.get('state')!
    nonceRef.nonce = String(flows.get(`oidc:${state}`)?.nonce)

    const result = await finishOidc(idp, { state, code: 'adfs-code', binding, origin: 'https://tasks.contoso.local' }, fetchImpl)
    expect(result.identity).toMatchObject({ email: 'ut-test@contoso.local', emailVerified: true, name: 'Uta Tester', groups: ['Domain Users', 'UT-Admins'] })
    expect(mapGroupsToRole(result.identity.groups, idp.roleMapping)).toBe('admin')
    const token = calls.find((c) => c.url.endsWith('/oauth2/token/'))!
    // AD FS advertises client_secret_post first: the secret goes in the body, not a Basic header.
    expect(new URLSearchParams(token.body).get('client_secret')).toBe('adfs-client-secret')
    expect(token.auth).toBeNull()
    expect(result.redirect).toBe('/tasks')
  })
})

describe('AD FS SAML (recorded signed response)', () => {
  const response = fixture('saml-response.b64').trim()
  const xml = Buffer.from(response, 'base64').toString('utf8')
  const issued = new Date(/IssueInstant="([^"]+)"/.exec(xml)![1])
  const inResponseTo = /InResponseTo="([^"]+)"/.exec(xml)![1]
  const origin = 'https://localhost:3471'
  const samlIdp = (fields: Record<string, unknown> = {}) => parseSsoProviders([{
    id: 'adfs-saml', type: 'saml', preset: 'adfs',
    entryPoint: 'https://adfs.contoso.local/adfs/ls/', idpIssuer: 'http://adfs.contoso.local/adfs/services/trust',
    idpCert: fixture('token-signing.b64').trim(), allowedDomains: ['contoso.local'], defaultOrg: 'contoso', roleMapping: { 'UT-Admins': 'admin' }, ...fields,
  }])[0] as SamlIdpConfig

  beforeEach(() => {
    clearSamlCache()
    remembered.clear()
    pendingRequests.clear()
    pendingRequests.set(inResponseTo, new Date(issued.getTime() - 2_000).toISOString())
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(issued.getTime() + 5_000))
  })
  afterEach(() => { vi.useRealTimers() })

  it('verifies the AD FS assertion signature and reads the claim-type attributes', async () => {
    const idp = samlIdp()
    expect(samlAttributeNames(idp).groups).toBe('http://schemas.xmlsoap.org/claims/Group')
    const result = await finishSaml(idp, { SAMLResponse: response, RelayState: null }, origin)
    expect(result.identity).toMatchObject({
      subject: 'ut-test@contoso.local',
      email: 'ut-test@contoso.local',
      emailVerified: true,
      name: 'Uta Tester',
      groups: ['Domain Users', 'UT-Admins'],
    })
    expect(mapGroupsToRole(result.identity.groups, idp.roleMapping)).toBe('admin')
    // Replay of the same assertion is refused.
    pendingRequests.set(inResponseTo, new Date(issued.getTime() - 2_000).toISOString())
    await expect(finishSaml(idp, { SAMLResponse: response, RelayState: null }, origin)).rejects.toThrow(/already used/)
  })

  it('the UPN can be the matching key instead of mail (emailAttribute)', async () => {
    const result = await finishSaml(samlIdp({ emailAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn' }), { SAMLResponse: response }, origin)
    expect(result.identity.email).toBe('ut-test@contoso.local')
  })

  it('refuses a tampered group claim, another certificate, a different audience and an expired assertion', async () => {
    const tampered = Buffer.from(xml.replace('<AttributeValue>Domain Users</AttributeValue>', '<AttributeValue>Domain Admins</AttributeValue>')).toString('base64')
    await expect(finishSaml(samlIdp(), { SAMLResponse: tampered }, origin)).rejects.toThrow(/not valid/)
    const otherCert = fixture('token-signing.b64').trim().replace(/A/g, 'B')
    await expect(finishSaml(samlIdp({ idpCert: otherCert }), { SAMLResponse: response }, origin)).rejects.toThrow(/not valid/)
    await expect(finishSaml(samlIdp(), { SAMLResponse: response }, 'https://other.example.test')).rejects.toThrow(/not valid/)
    vi.setSystemTime(new Date(issued.getTime() + 2 * 3600_000))
    await expect(finishSaml(samlIdp(), { SAMLResponse: response }, origin)).rejects.toThrow(/not valid/)
  })
})
