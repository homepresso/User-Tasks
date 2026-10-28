/**
 * Who may call POST /api/cron/tick (lib/scheduler/tick-auth.ts): the shared
 * cron secret, Google Cloud Scheduler OIDC ID tokens and Entra ID managed
 * identity tokens. Tokens are signed with a throwaway RSA key and verified
 * against a JWKS served by a local HTTP server (the "issuer"); a second key
 * that is not in the JWKS stands in for a forger.
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'
import { SignJWT, createRemoteJWKSet, exportJWK, generateKeyPair, type CryptoKey, type JWTPayload } from 'jose'
import {
  authorizeTickRequest,
  cognitoIssuer,
  entraIssuers,
  tickTokenConfig,
  verifyTickToken,
  type TickAuthDeps,
  type TickTokenConfig,
} from '@/lib/scheduler/tick-auth'

const TENANT = '11111111-2222-3333-4444-555555555555'
const MI_OID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const AUD = 'https://app.example.com/api/cron/tick'
const SA = 'scheduler@my-project.iam.gserviceaccount.com'

let server: http.Server
let jwksUrl = ''
let key: CryptoKey
let forgerKey: CryptoKey
let deps: TickAuthDeps

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  key = pair.privateKey
  forgerKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
  server = http.createServer((_req, res) => {
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  jwksUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/jwks`
  const jwks = createRemoteJWKSet(new URL(jwksUrl))
  // Every issuer's JWKS URL is answered by the local server.
  deps = { jwks: () => jwks }
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

const config: TickTokenConfig = {
  google: { audiences: [AUD], serviceAccounts: [SA] },
  entra: { tenantId: TENANT, audiences: ['api://usertasks-tick', 'c0ffee00-0000-0000-0000-000000000001'], principals: [MI_OID] },
}

async function token(claims: JWTPayload, opts: { signer?: CryptoKey; expiresIn?: string | number; iat?: number } = {}) {
  const jwt = new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test-key' }).setIssuedAt(opts.iat)
  jwt.setExpirationTime(opts.expiresIn ?? '5m')
  return jwt.sign(opts.signer ?? key)
}

const google = (overrides: JWTPayload = {}, opts?: Parameters<typeof token>[1]) =>
  token({ iss: 'https://accounts.google.com', aud: AUD, email: SA, email_verified: true, sub: '1234', ...overrides }, opts)
const entra = (overrides: JWTPayload = {}, opts?: Parameters<typeof token>[1]) =>
  token({ iss: `https://sts.windows.net/${TENANT}/`, aud: 'api://usertasks-tick', tid: TENANT, oid: MI_OID, appid: 'mi-client-id', ...overrides }, opts)

describe('Google Cloud Scheduler OIDC tokens', () => {
  it('accepts a valid token from an allowed service account', async () => {
    expect(await verifyTickToken(await google(), config, deps)).toEqual({ method: 'google_oidc', subject: SA })
    // Both issuer spellings Google uses.
    expect((await verifyTickToken(await google({ iss: 'accounts.google.com' }), config, deps)).method).toBe('google_oidc')
  })

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000)
    await expect(verifyTickToken(await google({}, { iat: now - 7200, expiresIn: now - 3600 }), config, deps)).rejects.toThrow(/exp/)
  })

  it('rejects the wrong audience', async () => {
    await expect(verifyTickToken(await google({ aud: 'https://other.example.com/api/cron/tick' }), config, deps)).rejects.toThrow(/aud/)
  })

  it('rejects an untrusted issuer', async () => {
    await expect(verifyTickToken(await google({ iss: 'https://evil.example.com' }), config, deps)).rejects.toThrow(/untrusted issuer/)
  })

  it('rejects other accounts, unverified emails and forged signatures', async () => {
    await expect(verifyTickToken(await google({ email: 'someone@gmail.com' }), config, deps)).rejects.toThrow(/not allowed/)
    await expect(verifyTickToken(await google({ email_verified: false }), config, deps)).rejects.toThrow(/verified email/)
    await expect(verifyTickToken(await google({}, { signer: forgerKey }), config, deps)).rejects.toThrow(/signature/)
  })

  it('is not accepted unless configured', async () => {
    await expect(verifyTickToken(await google(), { entra: config.entra }, deps)).rejects.toThrow(/untrusted issuer/)
  })
})

describe('Entra ID managed identity tokens', () => {
  it('accepts v1 and v2 tokens for a configured audience from an allowed principal', async () => {
    expect(await verifyTickToken(await entra(), config, deps)).toEqual({ method: 'entra', subject: MI_OID })
    const v2 = await entra({ iss: entraIssuers(TENANT)[0], aud: 'c0ffee00-0000-0000-0000-000000000001', appid: undefined, azp: 'mi-client-id' })
    expect((await verifyTickToken(v2, config, deps)).method).toBe('entra')
  })

  it('rejects expired tokens, wrong audiences, other tenants and other principals', async () => {
    const now = Math.floor(Date.now() / 1000)
    await expect(verifyTickToken(await entra({}, { iat: now - 7200, expiresIn: now - 3600 }), config, deps)).rejects.toThrow(/exp/)
    await expect(verifyTickToken(await entra({ aud: 'https://graph.microsoft.com' }), config, deps)).rejects.toThrow(/aud/)
    await expect(verifyTickToken(await entra({ iss: 'https://sts.windows.net/99999999-0000-0000-0000-000000000000/' }), config, deps)).rejects.toThrow(/untrusted issuer/)
    await expect(verifyTickToken(await entra({ tid: '99999999-0000-0000-0000-000000000000' }), config, deps)).rejects.toThrow(/tenant/)
    await expect(verifyTickToken(await entra({ oid: 'ffffffff-0000-0000-0000-000000000000', appid: 'other-app' }), config, deps)).rejects.toThrow(/principal/)
  })
})

const POOL = 'eu-west-1_AbCdEf123'
const COGNITO_ISS = 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_AbCdEf123'
const cognitoConfig: TickTokenConfig = { cognito: { issuer: COGNITO_ISS, clients: ['eventbridge-client'], scope: 'usertasks/tick' } }
const cognito = (overrides: JWTPayload = {}, opts?: Parameters<typeof token>[1]) =>
  token({ iss: COGNITO_ISS, token_use: 'access', client_id: 'eventbridge-client', sub: 'eventbridge-client', scope: 'usertasks/tick', ...overrides }, opts)

describe('Cognito access tokens (EventBridge API destination, OAuth client credentials)', () => {
  it('accepts an access token of the pool for an allowed client with the scope', async () => {
    expect(cognitoIssuer(POOL)).toBe(COGNITO_ISS)
    expect(await verifyTickToken(await cognito(), cognitoConfig, deps)).toEqual({ method: 'cognito', subject: 'eventbridge-client' })
    expect(await verifyTickToken(await cognito({ scope: 'other usertasks/tick' }), cognitoConfig, deps)).toMatchObject({ method: 'cognito' })
  })

  it('rejects ID tokens, other clients, a missing scope, other pools, expired and forged tokens', async () => {
    await expect(verifyTickToken(await cognito({ token_use: 'id', aud: 'eventbridge-client' }), cognitoConfig, deps)).rejects.toThrow(/not a Cognito access token/)
    await expect(verifyTickToken(await cognito({ client_id: 'someone-else' }), cognitoConfig, deps)).rejects.toThrow(/client not allowed/)
    await expect(verifyTickToken(await cognito({ scope: 'usertasks/read' }), cognitoConfig, deps)).rejects.toThrow(/scope/)
    await expect(verifyTickToken(await cognito({ iss: 'https://cognito-idp.eu-west-1.amazonaws.com/eu-west-1_Other' }), cognitoConfig, deps)).rejects.toThrow(/untrusted issuer/)
    const now = Math.floor(Date.now() / 1000)
    await expect(verifyTickToken(await cognito({}, { iat: now - 7200, expiresIn: now - 3600 }), cognitoConfig, deps)).rejects.toThrow(/exp/)
    await expect(verifyTickToken(await cognito({}, { signer: forgerKey }), cognitoConfig, deps)).rejects.toThrow()
    // Without a scope requirement any allowed client's access token passes.
    expect((await verifyTickToken(await cognito({ scope: undefined }), { cognito: { issuer: COGNITO_ISS, clients: ['eventbridge-client'] } }, deps)).method).toBe('cognito')
  })
})

describe('tickTokenConfig', () => {
  it('enables a method only when its allow-list is configured', () => {
    expect(tickTokenConfig({}, 'https://app.example.com')).toEqual({})
    expect(tickTokenConfig({ oidc_audience: AUD }, 'https://app.example.com')).toEqual({})
    expect(tickTokenConfig({ oidc_service_accounts: `${SA.toUpperCase()}, other@x.iam.gserviceaccount.com` }, 'https://app.example.com/')).toEqual({
      google: { audiences: [AUD], serviceAccounts: [SA, 'other@x.iam.gserviceaccount.com'] },
    })
    expect(tickTokenConfig({ entra_tenant_id: TENANT, entra_audience: 'api://x' }, undefined)).toEqual({})
    expect(tickTokenConfig({ entra_tenant_id: TENANT, entra_audience: 'api://x', entra_allowed_principals: MI_OID.toUpperCase() }, undefined)).toEqual({
      entra: { tenantId: TENANT, audiences: ['api://x'], principals: [MI_OID] },
    })
    // Cognito needs the pool and a client allow-list (its access tokens have no audience).
    expect(tickTokenConfig({ cognito_user_pool_id: POOL }, undefined)).toEqual({})
    expect(tickTokenConfig({ cognito_user_pool_id: 'not-a-pool', cognito_allowed_clients: 'c' }, undefined)).toEqual({})
    expect(tickTokenConfig({ cognito_user_pool_id: POOL, cognito_allowed_clients: 'a, b', cognito_scope: 'usertasks/tick' }, undefined)).toEqual({
      cognito: { issuer: COGNITO_ISS, clients: ['a', 'b'], scope: 'usertasks/tick' },
    })
  })
})

describe('authorizeTickRequest', () => {
  const ORIGINAL = { ...process.env }
  beforeEach(() => {
    process.env.CRON_SECRET = 'tick-secret'
    delete process.env.WORKFLOW_PROCESSOR_SECRET
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.restoreAllMocks()
  })

  const request = (headers: Record<string, string> = {}) => new NextRequest('https://app.example.com/api/cron/tick', { method: 'POST', headers })
  const status = (result: Awaited<ReturnType<typeof authorizeTickRequest>>) => (result instanceof NextResponse ? result.status : 200)

  it('accepts the shared secret either way, as before', async () => {
    expect(await authorizeTickRequest(request({ authorization: 'Bearer tick-secret' }), { config: {} })).toEqual({ method: 'secret' })
    expect(await authorizeTickRequest(request({ 'x-processor-secret': 'tick-secret' }), { config: {} })).toEqual({ method: 'secret' })
  })

  it('accepts a valid OIDC or Entra token in place of the secret', async () => {
    expect(await authorizeTickRequest(request({ authorization: `Bearer ${await google()}` }), { ...deps, config })).toMatchObject({ method: 'google_oidc' })
    expect(await authorizeTickRequest(request({ authorization: `Bearer ${await entra()}` }), { ...deps, config })).toMatchObject({ method: 'entra' })
  })

  it('rejects bad tokens, wrong secrets and anonymous calls with 401', async () => {
    expect(status(await authorizeTickRequest(request({ authorization: `Bearer ${await google({ aud: 'x' })}` }), { ...deps, config }))).toBe(401)
    expect(status(await authorizeTickRequest(request({ authorization: 'Bearer nope' }), { ...deps, config }))).toBe(401)
    expect(status(await authorizeTickRequest(request(), { ...deps, config }))).toBe(401)
    // A valid token is ignored when token auth isn't configured.
    expect(status(await authorizeTickRequest(request({ authorization: `Bearer ${await google()}` }), { ...deps, config: {} }))).toBe(401)
  })

  it('fails closed with 503 only when neither a secret nor token auth is configured', async () => {
    delete process.env.CRON_SECRET
    expect(status(await authorizeTickRequest(request({ authorization: 'Bearer x' }), { config: {} }))).toBe(503)
    // Token auth alone is a valid configuration.
    expect(status(await authorizeTickRequest(request({ authorization: `Bearer ${await google()}` }), { ...deps, config }))).toBe(200)
    expect(status(await authorizeTickRequest(request({ authorization: 'Bearer x' }), { ...deps, config }))).toBe(401)
  })

  it('reads the configuration from the environment', async () => {
    process.env.APP_URL = 'https://app.example.com'
    process.env.SCHEDULER_OIDC_SERVICE_ACCOUNTS = SA
    expect(await authorizeTickRequest(request({ authorization: `Bearer ${await google()}` }), deps)).toMatchObject({ method: 'google_oidc', subject: SA })
  })
})

describe('POST /api/cron/tick with token auth', () => {
  const ORIGINAL = { ...process.env }
  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.doUnmock('@/lib/jobs/tick')
    vi.restoreAllMocks()
  })

  it('does not run the tick for a token from an untrusted issuer, even with OIDC configured', async () => {
    vi.resetModules()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    process.env.CRON_SECRET = 'tick-secret'
    process.env.APP_URL = 'https://app.example.com'
    process.env.SCHEDULER_OIDC_SERVICE_ACCOUNTS = SA
    const runTick = vi.fn(async () => ({ ok: true }))
    vi.doMock('@/lib/jobs/tick', () => ({ runTick }))
    const route = await import('@/app/api/cron/tick/route')
    const response = await route.POST(new NextRequest('https://app.example.com/api/cron/tick', {
      method: 'POST', headers: { authorization: `Bearer ${await google({ iss: 'https://evil.example.com' })}` },
    }))
    expect(response.status).toBe(401)
    expect(runTick).not.toHaveBeenCalled()
  })
})
