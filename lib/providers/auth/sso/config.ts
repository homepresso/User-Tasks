import { z } from 'zod'
import { getProviderConfig } from '@/lib/config'
import { ConfigError } from '@/lib/config/schema'
import { isSecretRef, resolveSecretRef, secretTtlMs } from '@/lib/config/secret-refs'
import { writeSsoFrameSources } from './frame-sources'

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

export {
  OIDC_PRESETS, SAML_PRESETS, OidcIdpSchema, SamlIdpSchema, SsoIdpSchema,
  type OidcIdpConfig, type SamlIdpConfig, type SsoIdpConfig,
} from './schema'
import { OIDC_PRESETS, SAML_PRESETS, SsoIdpSchema, type OidcIdpConfig, type SamlIdpConfig, type SsoIdpConfig } from './schema'

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
  return idp.groupsClaim ?? (idp.preset === 'cognito' ? 'cognito:groups' : idp.preset === 'adfs' ? 'group' : 'groups')
}

/**
 * Every claim group values are read from. AD FS writes the
 * http://schemas.xmlsoap.org/claims/Group claim type as `group` and the role
 * claim type as `role` in its JWTs (rules issuing either are common), so the
 * adfs preset reads both, plus `groups`, unless groupsClaim names one.
 */
export function oidcGroupsClaims(idp: OidcIdpConfig): string[] {
  if (idp.groupsClaim) return [idp.groupsClaim]
  if (idp.preset === 'adfs') return ['group', 'groups', 'role']
  return [oidcGroupsClaim(idp)]
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
  const offered = config.id === 'oidc' ? all.filter((idp) => idp.type === 'oidc') : config.id === 'saml' ? all.filter((idp) => idp.type === 'saml') : all
  // Their sign-in origins, for embeddable pages' frame-src (automatic sign-in in a frame).
  writeSsoFrameSources(offered.flatMap(ssoFrameUrls))
  return offered
}

/** The URLs an IdP's sign-in starts at (known from config; discovery / metadata add theirs). */
export function ssoFrameUrls(idp: SsoIdpConfig): string[] {
  if (idp.type === 'saml') return [idp.entryPoint, idp.metadataUrl].filter((u): u is string => Boolean(u))
  const urls: string[] = []
  try { urls.push(oidcIssuer(idp)) } catch { /* misconfigured: reported elsewhere */ }
  const cognito = cognitoEndpoints(idp)
  if (cognito) urls.push(cognito.authorization_endpoint)
  return urls
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
