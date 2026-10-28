import { z } from 'zod'
import { getProviderConfig } from '@/lib/config'
import { ConfigError } from '@/lib/config/schema'
import { isSecretRef, resolveSecretRef, secretTtlMs } from '@/lib/config/secret-refs'

/**
 * SSO identity providers (AUTH_SSO_PROVIDERS / instance setting
 * `auth.sso_providers`): a JSON array, one entry per IdP. Used by the builtin
 * provider (alongside passwords) and by AUTH_PROVIDER=oidc / saml (SSO only).
 *
 *   [{ "id": "entra", "type": "oidc", "preset": "entra", "tenantId": "…",
 *      "clientId": "…", "clientSecret": "secret://entra-client-secret",
 *      "allowedDomains": ["example.com"], "defaultOrg": "acme", "defaultRole": "member",
 *      "roleMapping": { "<group object id>": "admin" } },
 *    { "id": "adfs", "type": "saml", "preset": "adfs",
 *      "metadataUrl": "https://adfs.example.com/FederationMetadata/2007-06/FederationMetadata.xml" }]
 *
 * Presets fill in issuers / attribute names for the common IdPs; anything a
 * preset sets can be overridden. Redirect URIs to register at the IdP:
 * Amazon Cognito: { "id": "cognito", "type": "oidc", "preset": "cognito",
 * "userPoolId": "eu-west-1_AbCdEf", "domain": "acme.auth.eu-west-1.amazoncognito.com",
 * "clientId": "…", "clientSecret": "secret://cognito-client-secret",
 * "roleMapping": { "admins": "admin" } } — groups come from cognito:groups.
 *
 *   OIDC  <APP_URL>/auth/sso/<id>/callback
 *   SAML  ACS <APP_URL>/auth/saml/<id>/acs, entity id / metadata <APP_URL>/auth/saml/<id>/metadata
 */

export const OIDC_PRESETS = [
  'generic', 'entra', 'entra_multitenant', 'entra_external_id', 'google', 'okta', 'auth0',
  'keycloak', 'authentik', 'zitadel', 'dex', 'adfs', 'cognito',
] as const
export const SAML_PRESETS = ['generic', 'adfs', 'entra', 'okta', 'google', 'keycloak', 'shibboleth', 'onelogin', 'pingfederate'] as const

const idSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'ids are lowercase letters, digits, - and _ (max 40)')
const stringList = z.union([z.array(z.string()), z.string().transform((s) => s.split(/[\s,]+/).filter(Boolean))])

/** Account linking and just-in-time provisioning, shared by OIDC and SAML. */
const provisioningFields = {
  name: z.string().max(60).optional(),
  /** Create accounts on first sign-in (default true). */
  jit: z.boolean().default(true),
  /**
   * Only these email domains may sign in / be provisioned (default: any). For
   * directory IdPs that don't attest email ownership themselves (SAML, Entra
   * ID, AD FS) it is also what makes their emails trusted for linking and JIT.
   */
  allowedDomains: stringList.optional(),
  /** Trust the IdP's email as verified even without a claim saying so (or allowedDomains). */
  trustEmail: z.boolean().optional(),
  /** Sign in as an existing account with the same (verified) email (default true). */
  linkByEmail: z.boolean().default(true),
  /** Organisation (tenant slug) new accounts join; without one they get a personal workspace only. */
  defaultOrg: z.string().optional(),
  /** System role for new accounts in defaultOrg (default viewer). */
  defaultRole: z.string().default('viewer'),
  /** Claim / attribute that lists the user's groups or roles. */
  groupsClaim: z.string().optional(),
  /** IdP group value → system role slug in defaultOrg; applied on every sign-in (highest role wins). */
  roleMapping: z.record(z.string(), z.string()).optional(),
}

export const OidcIdpSchema = z.object({
  id: idSchema,
  type: z.literal('oidc'),
  preset: z.enum(OIDC_PRESETS).default('generic'),
  /** Issuer (discovery at <issuer>/.well-known/openid-configuration); presets derive it. */
  issuer: z.string().url().optional(),
  discoveryUrl: z.string().url().optional(),
  clientId: z.string().min(1),
  /** Confidential clients; public clients rely on PKCE alone. May be a secret:// reference. */
  clientSecret: z.string().optional(),
  scopes: stringList.optional(),
  /** Entra ID: directory (tenant) id or verified domain. */
  tenantId: z.string().optional(),
  /** entra_multitenant: accept only these directory ids (default: any work/school account). */
  allowedTenants: stringList.optional(),
  /** entra_external_id: the <subdomain>.ciamlogin.com part. */
  tenantSubdomain: z.string().optional(),
  /**
   * okta / auth0 / zitadel: the org domain (e.g. acme.okta.com). cognito: the
   * hosted UI / managed login domain (acme.auth.eu-west-1.amazoncognito.com or
   * a custom domain); sign-in, token and userinfo go there.
   */
  domain: z.string().optional(),
  /** cognito: the user pool id (eu-west-1_AbCdEf); the issuer is derived from it. */
  userPoolId: z.string().regex(/^[a-z]{2}(-gov)?-[a-z]+-\d_[0-9A-Za-z]+$/, 'a Cognito user pool id, e.g. eu-west-1_AbCdEf').optional(),
  /** cognito: region of the user pool (default: the user pool id's prefix). */
  region: z.string().optional(),
  /** okta: custom authorization server id (e.g. "default"); unset = org server. */
  authorizationServerId: z.string().optional(),
  /** keycloak / authentik / dex / adfs: base URL of the server. */
  baseUrl: z.string().url().optional(),
  /** keycloak realm. */
  realm: z.string().optional(),
  /** authentik application slug. */
  slug: z.string().optional(),
  /** google: Workspace domain(s) — sent as `hd` and enforced on the ID token's hd claim. */
  hostedDomain: stringList.optional(),
  /** Claims for email / name (defaults email / name). */
  emailClaim: z.string().default('email'),
  nameClaim: z.string().default('name'),
  /** Fetch the userinfo endpoint and merge its claims (default true). */
  userinfo: z.boolean().default(true),
  ...provisioningFields,
})

export const SamlIdpSchema = z.object({
  id: idSchema,
  type: z.literal('saml'),
  preset: z.enum(SAML_PRESETS).default('generic'),
  /** IdP metadata (URL or XML); fills entryPoint / idpCert / idpIssuer when they are unset. */
  metadataUrl: z.string().url().optional(),
  metadataXml: z.string().optional(),
  /** IdP single sign-on URL (HTTP-Redirect binding). */
  entryPoint: z.string().url().optional(),
  /** IdP signing certificate(s), PEM or base64. */
  idpCert: z.union([z.string(), z.array(z.string())]).optional(),
  idpIssuer: z.string().optional(),
  /** SP entity id (default <APP_URL>/auth/saml/<id>/metadata). */
  spEntityId: z.string().optional(),
  /** Assertions must be signed (default true; set false only if the whole response is signed). */
  wantAssertionsSigned: z.boolean().default(true),
  /** The Response envelope must be signed too (default false). */
  wantAuthnResponseSigned: z.boolean().default(false),
  /** Accept unsolicited (IdP-initiated) responses (default true). */
  allowIdpInitiated: z.boolean().default(true),
  acceptedClockSkewMs: z.number().int().min(0).max(600_000).default(60_000),
  identifierFormat: z.string().optional(),
  /** Attribute names; presets set the usual ones. NameID is used for email when it is one. */
  emailAttribute: z.string().optional(),
  nameAttribute: z.string().optional(),
  ...provisioningFields,
})

export const SsoIdpSchema = z.discriminatedUnion('type', [OidcIdpSchema, SamlIdpSchema])
export type OidcIdpConfig = z.infer<typeof OidcIdpSchema>
export type SamlIdpConfig = z.infer<typeof SamlIdpSchema>
export type SsoIdpConfig = z.infer<typeof SsoIdpSchema>

const SAML_ATTRIBUTE_PRESETS: Record<(typeof SAML_PRESETS)[number], { email?: string; name?: string; groups?: string }> = {
  generic: { email: 'email', name: 'name', groups: 'groups' },
  adfs: {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    name: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
    groups: 'http://schemas.xmlsoap.org/claims/Group',
  },
  entra: {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    name: 'http://schemas.microsoft.com/identity/claims/displayname',
    groups: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
  },
  okta: { email: 'email', name: 'name', groups: 'groups' },
  google: { email: 'email', name: 'name', groups: 'groups' },
  keycloak: { email: 'email', name: 'name', groups: 'groups' },
  shibboleth: { email: 'urn:oid:0.9.2342.19200300.100.1.3', name: 'urn:oid:2.16.840.1.113730.3.1.241', groups: 'urn:oid:1.3.6.1.4.1.5923.1.5.1.1' },
  onelogin: { email: 'User.email', name: 'User.FirstName', groups: 'memberOf' },
  pingfederate: { email: 'mail', name: 'cn', groups: 'memberOf' },
}

export function samlAttributeNames(idp: SamlIdpConfig): { email: string; name: string; groups: string } {
  const preset = SAML_ATTRIBUTE_PRESETS[idp.preset]
  return {
    email: idp.emailAttribute ?? preset.email ?? 'email',
    name: idp.nameAttribute ?? preset.name ?? 'name',
    groups: idp.groupsClaim ?? preset.groups ?? 'groups',
  }
}

const trimSlash = (url: string) => url.replace(/\/+$/, '')

/** The issuer an OIDC IdP is discovered from (preset-derived unless set). */
export function oidcIssuer(idp: OidcIdpConfig): string {
  if (idp.issuer) return idp.issuer
  const need = (value: string | undefined, field: string) => {
    if (!value) throw new ConfigError(`SSO provider "${idp.id}" (${idp.preset}) needs "${field}" (or an explicit "issuer")`)
    return value
  }
  switch (idp.preset) {
    case 'entra':
      return `https://login.microsoftonline.com/${need(idp.tenantId, 'tenantId')}/v2.0`
    case 'entra_multitenant':
      return 'https://login.microsoftonline.com/organizations/v2.0'
    case 'entra_external_id':
      return `https://${need(idp.tenantSubdomain, 'tenantSubdomain')}.ciamlogin.com/${need(idp.tenantId, 'tenantId')}/v2.0`
    case 'google':
      return 'https://accounts.google.com'
    case 'okta': {
      const base = `https://${need(idp.domain, 'domain').replace(/^https?:\/\//, '')}`
      return idp.authorizationServerId ? `${trimSlash(base)}/oauth2/${idp.authorizationServerId}` : trimSlash(base)
    }
    case 'auth0':
      return `https://${need(idp.domain, 'domain').replace(/^https?:\/\//, '').replace(/\/+$/, '')}/`
    case 'keycloak':
      return `${trimSlash(need(idp.baseUrl, 'baseUrl'))}/realms/${need(idp.realm, 'realm')}`
    case 'authentik':
      return `${trimSlash(need(idp.baseUrl, 'baseUrl'))}/application/o/${need(idp.slug, 'slug')}/`
    case 'zitadel':
      return `https://${need(idp.domain, 'domain').replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
    case 'adfs':
      return `${trimSlash(need(idp.baseUrl, 'baseUrl'))}/adfs`
    case 'dex':
      return trimSlash(need(idp.baseUrl, 'baseUrl'))
    case 'cognito': {
      const pool = need(idp.userPoolId, 'userPoolId')
      return `https://cognito-idp.${idp.region ?? pool.split('_')[0]}.amazonaws.com/${pool}`
    }
    default:
      return need(undefined, 'issuer')
  }
}

/** The claim that lists the user's groups: groupsClaim, else the preset's (Cognito: cognito:groups), else groups. */
export function oidcGroupsClaim(idp: OidcIdpConfig): string {
  return idp.groupsClaim ?? (idp.preset === 'cognito' ? 'cognito:groups' : 'groups')
}

/**
 * Cognito: the hosted UI / managed login domain serves the OAuth endpoints
 * (`domain`, when set; otherwise discovery's own, which name the pool's
 * default domain).
 */
export function cognitoEndpoints(idp: OidcIdpConfig): { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string } | null {
  if (idp.preset !== 'cognito' || !idp.domain) return null
  const base = `https://${idp.domain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  return { authorization_endpoint: `${base}/oauth2/authorize`, token_endpoint: `${base}/oauth2/token`, userinfo_endpoint: `${base}/oauth2/userInfo` }
}

export function oidcScopes(idp: OidcIdpConfig): string[] {
  const scopes = new Set(idp.scopes?.length ? idp.scopes : ['openid', 'email', 'profile'])
  scopes.add('openid')
  if (idp.preset === 'dex' && idp.groupsClaim) scopes.add('groups')
  return [...scopes]
}

/** Login button label and icon. */
export function ssoDisplay(idp: SsoIdpConfig): { name: string; kind: 'google' | 'microsoft' | 'oidc' | 'saml' } {
  if (idp.type === 'oidc') {
    if (idp.preset === 'google') return { name: idp.name ?? 'Google', kind: 'google' }
    if (idp.preset.startsWith('entra')) return { name: idp.name ?? 'Microsoft', kind: 'microsoft' }
    const names: Partial<Record<(typeof OIDC_PRESETS)[number], string>> = {
      okta: 'Okta', auth0: 'Auth0', keycloak: 'Keycloak', authentik: 'Authentik', zitadel: 'ZITADEL', dex: 'Dex', adfs: 'AD FS', cognito: 'Amazon Cognito',
    }
    return { name: idp.name ?? names[idp.preset] ?? 'Single sign-on', kind: 'oidc' }
  }
  if (idp.preset === 'entra') return { name: idp.name ?? 'Microsoft', kind: 'microsoft' }
  if (idp.preset === 'google') return { name: idp.name ?? 'Google', kind: 'google' }
  return { name: idp.name ?? 'Single sign-on (SAML)', kind: 'saml' }
}

export function parseSsoProviders(raw: unknown): SsoIdpConfig[] {
  if (raw === undefined || raw === null || raw === '') return []
  let value = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      throw new ConfigError('AUTH_SSO_PROVIDERS (auth.sso_providers) is not valid JSON')
    }
  }
  const list = Array.isArray(value) ? value : [value]
  const parsed = z.array(SsoIdpSchema).safeParse(list)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new ConfigError(`AUTH_SSO_PROVIDERS: ${issue?.path.join('.') || 'entry'}: ${issue?.message ?? 'invalid'}`)
  }
  const ids = new Set<string>()
  for (const idp of parsed.data) {
    if (ids.has(idp.id)) throw new ConfigError(`AUTH_SSO_PROVIDERS: duplicate id "${idp.id}"`)
    ids.add(idp.id)
    if (idp.type === 'oidc') oidcIssuer(idp)
  }
  return parsed.data
}

/** The IdPs this instance offers, for the configured auth provider. */
export async function getSsoProviders(): Promise<SsoIdpConfig[]> {
  const config = await getProviderConfig('auth')
  if (config.id === 'supabase') return []
  const all = parseSsoProviders(config.options.sso_providers)
  if (config.id === 'oidc') return all.filter((idp) => idp.type === 'oidc')
  if (config.id === 'saml') return all.filter((idp) => idp.type === 'saml')
  return all
}

export async function getSsoProvider(id: string): Promise<SsoIdpConfig | null> {
  return (await getSsoProviders()).find((idp) => idp.id === id) ?? null
}

/** A config value that may be a secret:// reference (client secrets inside sso_providers). */
export async function resolveSsoSecret(value: string | undefined, label: string): Promise<string | undefined> {
  if (!value || !isSecretRef(value)) return value
  const secrets = await getProviderConfig('secrets')
  const { secretStoreFor } = await import('@/lib/providers/secrets')
  return resolveSecretRef(value, secretStoreFor(secrets.id, secrets.options), { label, ttlMs: secretTtlMs(secrets.options) })
}

/** Email domain allowlist check (case-insensitive; subdomains don't match implicitly). */
export function emailDomainAllowed(email: string, allowed: string[] | undefined): boolean {
  if (!allowed?.length) return true
  const domain = email.split('@').pop()?.toLowerCase() ?? ''
  return allowed.some((d) => d.toLowerCase().replace(/^@/, '') === domain)
}

const ROLE_RANK = ['viewer', 'member', 'manager', 'admin', 'owner']

/** Highest role the user's groups map to (unknown role slugs rank lowest), or null. */
export function mapGroupsToRole(groups: string[], mapping: Record<string, string> | undefined): string | null {
  if (!mapping || groups.length === 0) return null
  const lower = new Map(Object.entries(mapping).map(([k, v]) => [k.toLowerCase(), v]))
  let best: string | null = null
  for (const group of groups) {
    const role = lower.get(group.toLowerCase())
    if (role && (best === null || ROLE_RANK.indexOf(role) > ROLE_RANK.indexOf(best))) best = role
  }
  return best
}
