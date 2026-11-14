import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseSsoProviders, type OidcIdpConfig, type SamlIdpConfig } from '@/lib/providers/auth/sso/config'
import { checkSsoProvider } from '@/lib/providers/auth/sso/check'
import { clearOidcCache } from '@/lib/providers/auth/sso/oidc'

/**
 * The SSO configuration check behind `usertasks-admin doctor` and Settings →
 * Infrastructure, with AD FS's recorded discovery document and token-signing
 * certificate (__tests__/fixtures/adfs): fresh discovery and the signing key
 * set for OIDC; sign-on URL, signing certificates and an https ACS for SAML.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'adfs')
const discovery = JSON.parse(readFileSync(path.join(FIXTURES, 'openid-configuration.json'), 'utf8'))
const signingCert = readFileSync(path.join(FIXTURES, 'token-signing.b64'), 'utf8').trim()

const oidc = (fields: Record<string, unknown> = {}) => parseSsoProviders([{ id: 'adfs', type: 'oidc', preset: 'adfs', baseUrl: 'https://adfs.contoso.local', clientId: 'c', clientSecret: 's', ...fields }])[0] as OidcIdpConfig
const metadataXml = (cert: string) =>
  `<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="http://adfs.contoso.local/adfs/services/trust"><IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">` +
  `<KeyDescriptor use="signing"><KeyInfo xmlns="http://www.w3.org/2000/09/xmldsig#"><X509Data><X509Certificate>${cert}</X509Certificate></X509Data></KeyInfo></KeyDescriptor>` +
  `<SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://adfs.contoso.local/adfs/ls/"/>` +
  `</IDPSSODescriptor></EntityDescriptor>`
const saml = (fields: Record<string, unknown> = {}) => parseSsoProviders([{ id: 'adfs-saml', type: 'saml', preset: 'adfs', metadataXml: metadataXml(signingCert), ...fields }])[0] as SamlIdpConfig

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request) => routes[String(input)]?.() ?? new Response('not found', { status: 404 })) as unknown as typeof fetch
}

beforeEach(() => clearOidcCache())

describe('OIDC check', () => {
  it('reports discovery, the signing keys and the redirect URI', async () => {
    const result = await checkSsoProvider(oidc(), 'https://tasks.contoso.local', fakeFetch({
      'https://adfs.contoso.local/adfs/.well-known/openid-configuration': () => Response.json(discovery),
      [discovery.jwks_uri]: () => Response.json({ keys: [{ kty: 'RSA', kid: 'k' }] }),
    }))
    expect(result).toMatchObject({ ok: true, warnings: [] })
    expect(result.detail).toBe('discovery OK (https://adfs.contoso.local/adfs, 1 signing key); redirect URI https://tasks.contoso.local/auth/sso/adfs/callback')
  })

  it('fails on an issuer mismatch, a missing key set, and warns about a missing client secret', async () => {
    const wrongBase = await checkSsoProvider(oidc({ baseUrl: 'https://sts.contoso.local' }), 'https://t', fakeFetch({
      'https://sts.contoso.local/adfs/.well-known/openid-configuration': () => Response.json(discovery),
    }))
    expect(wrongBase).toMatchObject({ ok: false, detail: expect.stringContaining('issuer mismatch') })
    const noKeys = await checkSsoProvider(oidc(), 'https://t', fakeFetch({
      'https://adfs.contoso.local/adfs/.well-known/openid-configuration': () => Response.json(discovery),
      [discovery.jwks_uri]: () => Response.json({ keys: [] }),
    }))
    expect(noKeys).toMatchObject({ ok: false, detail: expect.stringContaining('has no keys') })
    const publicClient = await checkSsoProvider(oidc({ clientSecret: undefined }), 'https://t', fakeFetch({
      'https://adfs.contoso.local/adfs/.well-known/openid-configuration': () => Response.json(discovery),
      [discovery.jwks_uri]: () => Response.json({ keys: [{ kty: 'RSA' }] }),
    }))
    expect(publicClient.ok).toBe(true)
    expect(publicClient.warnings.join(' ')).toMatch(/No clientSecret/)
  })
})

describe('SAML check', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-01-15T00:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  it('reads the IdP metadata: sign-on URL, valid signing certificate, ACS and SP entity id', async () => {
    const result = await checkSsoProvider(saml(), 'https://tasks.contoso.local', fakeFetch({}))
    expect(result).toMatchObject({ ok: true, warnings: [] })
    expect(result.detail).toContain('sign-on https://adfs.contoso.local/adfs/ls/, 1 valid signing certificate')
    expect(result.detail).toContain('ACS https://tasks.contoso.local/auth/saml/adfs-saml/acs')
  })

  it('warns about an http ACS (AD FS drops it) and a certificate about to expire; fails without a usable certificate', async () => {
    const http = await checkSsoProvider(saml(), 'http://tasks.contoso.local', fakeFetch({}))
    expect(http.ok).toBe(true)
    expect(http.warnings.join(' ')).toMatch(/not https: AD FS .* silently drops/)
    vi.setSystemTime(new Date('2028-11-01T00:00:00Z'))
    const expiring = await checkSsoProvider(saml(), 'https://t', fakeFetch({}))
    expect(expiring.warnings.join(' ')).toMatch(/CN=adfs.Signing expires on 2028-11-12/)
    vi.setSystemTime(new Date('2029-01-01T00:00:00Z'))
    expect(await checkSsoProvider(saml(), 'https://t', fakeFetch({}))).toMatchObject({ ok: false, detail: expect.stringContaining('no valid IdP signing certificate') })
    expect(await checkSsoProvider(saml({ metadataXml: metadataXml('bm90IGEgY2VydA==') }), 'https://t', fakeFetch({}))).toMatchObject({ ok: false })
  })

  it('fetches metadata from metadataUrl and reports HTTP failures', async () => {
    const url = 'https://adfs.contoso.local/FederationMetadata/2007-06/FederationMetadata.xml'
    const ok = await checkSsoProvider(saml({ metadataXml: undefined, metadataUrl: url }), 'https://t', fakeFetch({ [url]: () => new Response(metadataXml(signingCert)) }))
    expect(ok.ok).toBe(true)
    const down = await checkSsoProvider(saml({ metadataXml: undefined, metadataUrl: url }), 'https://t', fakeFetch({ [url]: () => new Response('', { status: 503 }) }))
    expect(down).toMatchObject({ ok: false, detail: expect.stringContaining('HTTP 503') })
  })
})
