import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'

/**
 * The Amazon Cognito OIDC preset: issuer from the user pool id, the hosted
 * UI / managed login domain for the OAuth endpoints, and cognito:groups →
 * roles. The full code flow runs against a fake Cognito (discovery at the
 * cognito-idp issuer, token and userinfo at the domain, JWKS on a local
 * server).
 */

const flows = new Map<string, Record<string, unknown>>()
vi.mock('@/lib/providers/auth/builtin/store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  saveFlowState: vi.fn(async (id: string, kind: string, data: Record<string, unknown>) => { flows.set(`${kind}:${id}`, data) }),
  takeFlowState: vi.fn(async (id: string, kind: string) => { const v = flows.get(`${kind}:${id}`) ?? null; flows.delete(`${kind}:${id}`); return v }),
}))

import { mapGroupsToRole, oidcGroupsClaim, oidcIssuer, parseSsoProviders, ssoDisplay, type OidcIdpConfig } from '@/lib/providers/auth/sso/config'
import { clearOidcCache, discover, finishOidc, startOidc, toExternalIdentity } from '@/lib/providers/auth/sso/oidc'

const POOL = 'eu-west-1_AbCdEf123'
const ISSUER = `https://cognito-idp.eu-west-1.amazonaws.com/${POOL}`
const DOMAIN = 'acme.auth.eu-west-1.amazoncognito.com'
const cognito = (fields: Record<string, unknown> = {}) => parseSsoProviders([{ id: 'cognito', type: 'oidc', preset: 'cognito', userPoolId: POOL, clientId: 'app-client', clientSecret: 'cognito-client-secret', ...fields }])[0] as OidcIdpConfig

describe('Cognito preset config', () => {
  it('derives the issuer from the user pool id (region from its prefix, or region)', () => {
    expect(oidcIssuer(cognito())).toBe(ISSUER)
    expect(oidcIssuer(cognito({ userPoolId: 'us-gov-west-1_Xyz', region: 'us-gov-west-1' }))).toBe('https://cognito-idp.us-gov-west-1.amazonaws.com/us-gov-west-1_Xyz')
    expect(() => parseSsoProviders([{ id: 'c', type: 'oidc', preset: 'cognito', clientId: 'x' }])).toThrow(/needs "userPoolId"/)
    expect(() => parseSsoProviders([{ id: 'c', type: 'oidc', preset: 'cognito', clientId: 'x', userPoolId: 'not-a-pool' }])).toThrow(/user pool id/)
  })

  it('groups come from cognito:groups unless groupsClaim says otherwise; the button says Amazon Cognito', () => {
    expect(oidcGroupsClaim(cognito())).toBe('cognito:groups')
    expect(oidcGroupsClaim(cognito({ groupsClaim: 'custom:roles' }))).toBe('custom:roles')
    expect(ssoDisplay(cognito())).toEqual({ name: 'Amazon Cognito', kind: 'oidc' })
    const identity = toExternalIdentity(cognito(), { iss: ISSUER, sub: 'u-1', email: 'a@acme.test', email_verified: 'true', 'cognito:groups': ['Admins', 'staff'] })
    expect(identity).toMatchObject({ subject: 'u-1', email: 'a@acme.test', emailVerified: true, groups: ['Admins', 'staff'] })
    expect(mapGroupsToRole(identity.groups, { admins: 'admin', staff: 'member' })).toBe('admin')
    // An unverified Cognito email is not trusted for linking.
    expect(toExternalIdentity(cognito(), { iss: ISSUER, sub: 'u-2', email: 'b@acme.test', email_verified: false }).emailVerified).toBe(false)
  })
})

describe('Cognito code flow (fake Cognito)', () => {
  let jwks: Server
  let jwksUrl = ''
  let privateKey: CryptoKey
  const calls: string[] = []

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256')
    privateKey = pair.privateKey as CryptoKey
    const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
    jwks = createServer((_, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ keys: [jwk] })) })
    await new Promise<void>((r) => jwks.listen(0, '127.0.0.1', r))
    jwksUrl = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/.well-known/jwks.json`
  })
  afterAll(() => new Promise<void>((r) => jwks.close(() => r())))
  beforeEach(() => { clearOidcCache(); calls.length = 0 })

  function fakeCognito(nonceRef: { nonce?: string }) {
    return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      calls.push(url)
      if (url === `${ISSUER}/.well-known/openid-configuration`) {
        // Real Cognito discovery names the pool's default domain; the preset's `domain` replaces it.
        return Response.json({
          issuer: ISSUER, jwks_uri: jwksUrl,
          authorization_endpoint: 'https://default-domain.auth.eu-west-1.amazoncognito.com/oauth2/authorize',
          token_endpoint: 'https://default-domain.auth.eu-west-1.amazoncognito.com/oauth2/token',
          userinfo_endpoint: 'https://default-domain.auth.eu-west-1.amazoncognito.com/oauth2/userInfo',
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        })
      }
      if (url === `https://${DOMAIN}/oauth2/token`) {
        const body = new URLSearchParams(String(init?.body))
        expect(body.get('client_secret')).toBe('cognito-client-secret')
        const now = Math.floor(Date.now() / 1000)
        const idToken = await new SignJWT({ email: 'owner@acme.test', email_verified: true, 'cognito:groups': ['Admins'], 'cognito:username': 'owner', nonce: nonceRef.nonce, token_use: 'id' })
          .setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience('app-client').setSubject('sub-owner').setIssuedAt(now).setExpirationTime(now + 3600)
          .sign(privateKey)
        return Response.json({ id_token: idToken, access_token: 'cognito-access-token', token_type: 'Bearer', expires_in: 3600 })
      }
      if (url === `https://${DOMAIN}/oauth2/userInfo`) return Response.json({ sub: 'sub-owner', email: 'owner@acme.test', email_verified: 'true', name: 'Olive Owner' })
      return new Response('not found', { status: 404 })
    }) as unknown as typeof fetch
  }

  it('discovery keeps the pool issuer and points the OAuth endpoints at the hosted UI domain', async () => {
    const { doc } = await discover(cognito({ domain: DOMAIN }), fakeCognito({}))
    expect(doc.issuer).toBe(ISSUER)
    expect(doc.authorization_endpoint).toBe(`https://${DOMAIN}/oauth2/authorize`)
    expect(doc.token_endpoint).toBe(`https://${DOMAIN}/oauth2/token`)
    // Without `domain`, discovery's own endpoints are used (cached separately).
    const plain = await discover(cognito(), fakeCognito({}))
    expect(plain.doc.authorization_endpoint).toBe('https://default-domain.auth.eu-west-1.amazoncognito.com/oauth2/authorize')
  })

  it('sign-in: authorize at the domain, token exchange, ID token verified, cognito:groups mapped', async () => {
    const idp = cognito({ domain: `https://${DOMAIN}/`, roleMapping: { Admins: 'admin' }, defaultOrg: 'acme' })
    const nonceRef: { nonce?: string } = {}
    const fetchImpl = fakeCognito(nonceRef)
    const { url, binding } = await startOidc(idp, { origin: 'https://tasks.acme.test', redirect: '/tasks', org: null }, fetchImpl)
    const authorize = new URL(url)
    expect(authorize.origin + authorize.pathname).toBe(`https://${DOMAIN}/oauth2/authorize`)
    expect(authorize.searchParams.get('redirect_uri')).toBe('https://tasks.acme.test/auth/sso/cognito/callback')
    expect(authorize.searchParams.get('scope')).toBe('openid email profile')
    const state = authorize.searchParams.get('state')!
    nonceRef.nonce = String(flows.get(`oidc:${state}`)?.nonce)

    const result = await finishOidc(idp, { state, code: 'auth-code', binding, origin: 'https://tasks.acme.test' }, fetchImpl)
    expect(result.identity).toMatchObject({ subject: 'sub-owner', email: 'owner@acme.test', emailVerified: true, name: 'Olive Owner', groups: ['Admins'] })
    expect(mapGroupsToRole(result.identity.groups, idp.roleMapping)).toBe('admin')
    expect(calls).toContain(`https://${DOMAIN}/oauth2/token`)
    expect(calls.some((c) => c.includes('default-domain'))).toBe(false)
  })

  it('an ID token issued by another user pool is refused', async () => {
    const other = `https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Other`
    const idp = cognito({ domain: DOMAIN, userPoolId: 'eu-west-1_Other' })
    const nonceRef: { nonce?: string } = {}
    const base = fakeCognito(nonceRef)
    // Discovery for the configured pool is genuine; the token endpoint hands back a token from ISSUER's pool.
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) === `${other}/.well-known/openid-configuration`) {
        return Response.json({ issuer: other, jwks_uri: jwksUrl, authorization_endpoint: 'https://x/oauth2/authorize', token_endpoint: 'https://x/oauth2/token', token_endpoint_auth_methods_supported: ['client_secret_post'] })
      }
      return base(input, init)
    }) as unknown as typeof fetch
    const { url, binding } = await startOidc(idp, { origin: 'https://tasks.acme.test', redirect: '/tasks', org: null }, fetchImpl)
    const state = new URL(url).searchParams.get('state')!
    nonceRef.nonce = String(flows.get(`oidc:${state}`)?.nonce)
    await expect(finishOidc(idp, { state, code: 'c', binding, origin: 'https://tasks.acme.test' }, fetchImpl)).rejects.toThrow(/issuer mismatch/)
  })
})
