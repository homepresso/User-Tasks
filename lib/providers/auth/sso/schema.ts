import { z } from 'zod'

/**
 * The SSO identity provider schemas and presets (auth.sso_providers), with
 * no server imports, so client components (the setup wizard) and the
 * install profile can validate entries. ./config re-exports everything here
 * and adds the server-side lookups.
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
  /**
   * With roleMapping: a sign-in whose groups map to no role sets the account
   * back to defaultRole in defaultOrg (default false: a mapped role is only
   * ever raised or replaced by another mapped role, so removing someone from
   * the AD group does not take admin away until an admin changes the role).
   */
  enforceRoleMapping: z.boolean().default(false),
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
