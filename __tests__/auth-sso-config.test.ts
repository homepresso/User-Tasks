/**
 * SSO building blocks that need no database: config parsing and presets
 * (Entra ID, Entra External ID, Google Workspace, Okta, Auth0, Keycloak,
 * Authentik, ZITADEL, Dex, AD FS; SAML attribute presets), email-trust rules
 * per IdP, group → role mapping, the domain allowlist and SAML IdP metadata
 * parsing.
 */
import { describe, expect, it } from 'vitest'
import {
  emailDomainAllowed,
  mapGroupsToRole,
  oidcIssuer,
  oidcScopes,
  parseSsoProviders,
  samlAttributeNames,
  ssoDisplay,
  type OidcIdpConfig,
  type SamlIdpConfig,
} from '@/lib/providers/auth/sso/config'
import { toExternalIdentity } from '@/lib/providers/auth/sso/oidc'
import { parseIdpMetadata } from '@/lib/providers/auth/sso/saml'

const oidc = (fields: Record<string, unknown>) => parseSsoProviders([{ id: 'x', type: 'oidc', clientId: 'c', ...fields }])[0] as OidcIdpConfig
const saml = (fields: Record<string, unknown>) => parseSsoProviders([{ id: 'x', type: 'saml', ...fields }])[0] as SamlIdpConfig

describe('SSO provider config', () => {
  it('parses JSON, applies defaults and rejects bad entries', () => {
    const [idp] = parseSsoProviders(JSON.stringify([{ id: 'kc', type: 'oidc', preset: 'keycloak', baseUrl: 'https://sso.example.com/', realm: 'corp', clientId: 'app' }]))
    expect(idp).toMatchObject({ jit: true, linkByEmail: true, defaultRole: 'viewer', userinfo: true })
    expect(parseSsoProviders(undefined)).toEqual([])
    expect(() => parseSsoProviders('{nope')).toThrow(/not valid JSON/)
    expect(() => parseSsoProviders([{ id: 'Bad Id', type: 'oidc', clientId: 'c', issuer: 'https://i.test' }])).toThrow(/ids are lowercase/)
    expect(() => parseSsoProviders([{ id: 'a', type: 'oidc', clientId: 'c', issuer: 'https://i.test' }, { id: 'a', type: 'saml' }])).toThrow(/duplicate id/)
    expect(() => parseSsoProviders([{ id: 'e', type: 'oidc', preset: 'entra', clientId: 'c' }])).toThrow(/needs "tenantId"/)
    expect(() => parseSsoProviders([{ id: 'g', type: 'oidc', clientId: 'c' }])).toThrow(/needs "issuer"/)
  })

  it('derives issuers for the presets', () => {
    expect(oidcIssuer(oidc({ preset: 'entra', tenantId: 'contoso.onmicrosoft.com' }))).toBe('https://login.microsoftonline.com/contoso.onmicrosoft.com/v2.0')
    expect(oidcIssuer(oidc({ preset: 'entra_multitenant' }))).toBe('https://login.microsoftonline.com/organizations/v2.0')
    expect(oidcIssuer(oidc({ preset: 'entra_external_id', tenantSubdomain: 'contosoid', tenantId: '11111111-2222-3333-4444-555555555555' })))
      .toBe('https://contosoid.ciamlogin.com/11111111-2222-3333-4444-555555555555/v2.0')
    expect(oidcIssuer(oidc({ preset: 'google' }))).toBe('https://accounts.google.com')
    expect(oidcIssuer(oidc({ preset: 'okta', domain: 'acme.okta.com' }))).toBe('https://acme.okta.com')
    expect(oidcIssuer(oidc({ preset: 'okta', domain: 'https://acme.okta.com', authorizationServerId: 'default' }))).toBe('https://acme.okta.com/oauth2/default')
    expect(oidcIssuer(oidc({ preset: 'auth0', domain: 'acme.eu.auth0.com' }))).toBe('https://acme.eu.auth0.com/')
    expect(oidcIssuer(oidc({ preset: 'keycloak', baseUrl: 'https://kc.internal/', realm: 'corp' }))).toBe('https://kc.internal/realms/corp')
    expect(oidcIssuer(oidc({ preset: 'authentik', baseUrl: 'https://ak.internal', slug: 'usertasks' }))).toBe('https://ak.internal/application/o/usertasks/')
    expect(oidcIssuer(oidc({ preset: 'zitadel', domain: 'acme.zitadel.cloud' }))).toBe('https://acme.zitadel.cloud')
    expect(oidcIssuer(oidc({ preset: 'dex', baseUrl: 'https://dex.internal/dex' }))).toBe('https://dex.internal/dex')
    expect(oidcIssuer(oidc({ preset: 'adfs', baseUrl: 'https://adfs.corp.local' }))).toBe('https://adfs.corp.local/adfs')
    expect(oidcIssuer(oidc({ preset: 'keycloak', issuer: 'https://explicit.test/realms/x' }))).toBe('https://explicit.test/realms/x')
  })

  it('always requests openid; Dex asks for groups when they are mapped', () => {
    expect(oidcScopes(oidc({ issuer: 'https://i.test', scopes: 'email profile' }))).toEqual(['email', 'profile', 'openid'])
    expect(oidcScopes(oidc({ preset: 'dex', baseUrl: 'https://dex.test', groupsClaim: 'groups' }))).toContain('groups')
  })

  it('login buttons show names and icons only', () => {
    expect(ssoDisplay(oidc({ preset: 'google' }))).toEqual({ name: 'Google', kind: 'google' })
    expect(ssoDisplay(oidc({ preset: 'entra', tenantId: 't' }))).toEqual({ name: 'Microsoft', kind: 'microsoft' })
    expect(ssoDisplay(oidc({ preset: 'okta', domain: 'a.okta.com', name: 'Acme Okta' }))).toEqual({ name: 'Acme Okta', kind: 'oidc' })
    expect(ssoDisplay(saml({ preset: 'adfs' }))).toEqual({ name: 'Single sign-on (SAML)', kind: 'saml' })
  })

  it('SAML presets name the usual attributes', () => {
    expect(samlAttributeNames(saml({ preset: 'adfs' })).email).toBe('http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress')
    expect(samlAttributeNames(saml({ preset: 'entra' })).groups).toBe('http://schemas.microsoft.com/ws/2008/06/identity/claims/groups')
    expect(samlAttributeNames(saml({ preset: 'shibboleth' })).email).toBe('urn:oid:0.9.2342.19200300.100.1.3')
    expect(samlAttributeNames(saml({ preset: 'okta', emailAttribute: 'mail' })).email).toBe('mail')
  })

  it('group → role mapping picks the highest mapped role, case-insensitively', () => {
    const mapping = { Staff: 'member', 'IT-Admins': 'admin', Readers: 'viewer' }
    expect(mapGroupsToRole(['readers', 'staff'], mapping)).toBe('member')
    expect(mapGroupsToRole(['STAFF', 'it-admins'], mapping)).toBe('admin')
    expect(mapGroupsToRole(['other'], mapping)).toBeNull()
    expect(mapGroupsToRole(['staff'], undefined)).toBeNull()
  })

  it('domain allowlist matches the exact domain', () => {
    expect(emailDomainAllowed('a@Example.com', ['example.com'])).toBe(true)
    expect(emailDomainAllowed('a@sub.example.com', ['example.com'])).toBe(false)
    expect(emailDomainAllowed('a@evil-example.com', ['@example.com'])).toBe(false)
    expect(emailDomainAllowed('a@anything.test', undefined)).toBe(true)
  })
})

describe('OIDC claims → identity (email trust)', () => {
  it('trusts email_verified; Entra ID / AD FS emails only when pinned by allowedDomains (or trustEmail)', () => {
    expect(toExternalIdentity(oidc({ preset: 'google' }), { iss: 'https://accounts.google.com', sub: '1', email: 'a@x.test', email_verified: true }))
      .toMatchObject({ subject: '1', email: 'a@x.test', emailVerified: true })
    expect(toExternalIdentity(oidc({ preset: 'google' }), { sub: '1', email: 'a@x.test', email_verified: false }).emailVerified).toBe(false)
    // A tenant admin can set any address: without allowedDomains it is not trusted for linking / JIT.
    expect(toExternalIdentity(oidc({ preset: 'entra', tenantId: 't' }), { sub: 's', preferred_username: 'ceo@other-org.com' }))
      .toMatchObject({ email: 'ceo@other-org.com', emailVerified: false })
    expect(toExternalIdentity(oidc({ preset: 'entra', tenantId: 't', allowedDomains: ['contoso.com'] }), { sub: 's', preferred_username: 'a@contoso.com' }))
      .toMatchObject({ email: 'a@contoso.com', emailVerified: true })
    expect(toExternalIdentity(oidc({ preset: 'adfs', baseUrl: 'https://adfs.test', trustEmail: true }), { sub: 's', email: 'a@corp.test' }).emailVerified).toBe(true)
    expect(toExternalIdentity(oidc({ issuer: 'https://i.test', trustEmail: true }), { sub: 's', email: 'a@x.test' }).emailVerified).toBe(true)
  })

  it('multi-tenant Entra: any tenant admin can set an email, so only domain-verified (xms_edov) emails count; subject is tenant-scoped', () => {
    const idp = oidc({ preset: 'entra_multitenant' })
    const claims = { iss: 'https://login.microsoftonline.com/tid-1/v2.0', tid: 'tid-1', oid: 'obj-1', sub: 'pairwise', email: 'ceo@victim.com' }
    expect(toExternalIdentity(idp, claims)).toMatchObject({ subject: 'tid-1:obj-1', emailVerified: false })
    expect(toExternalIdentity(idp, { ...claims, xms_edov: true }).emailVerified).toBe(true)
  })

  it('reads groups from the configured claim', () => {
    expect(toExternalIdentity(oidc({ issuer: 'https://i.test', groupsClaim: 'roles' }), { sub: 's', roles: ['a', 'b'] }).groups).toEqual(['a', 'b'])
    expect(toExternalIdentity(oidc({ issuer: 'https://i.test' }), { sub: 's', groups: 'x y' }).groups).toEqual(['x', 'y'])
  })
})

describe('SAML IdP metadata', () => {
  it('reads entity id, redirect SSO URL and signing certificates (namespace-agnostic)', () => {
    const xml = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="http://adfs.corp.local/adfs/services/trust">
  <md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="encryption"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>ENC</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:KeyDescriptor use="signing"><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:X509Data><ds:X509Certificate>
      MIIC SIGN
    </ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="https://adfs.corp.local/adfs/ls/post"/>
    <md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="https://adfs.corp.local/adfs/ls/?a=1&amp;b=2"/>
  </md:IDPSSODescriptor>
</md:EntityDescriptor>`
    expect(parseIdpMetadata(xml)).toEqual({
      entityId: 'http://adfs.corp.local/adfs/services/trust',
      ssoRedirectUrl: 'https://adfs.corp.local/adfs/ls/?a=1&b=2',
      signingCerts: ['MIICSIGN'],
    })
  })
})
