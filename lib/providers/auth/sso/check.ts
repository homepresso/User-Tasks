import { X509Certificate } from 'node:crypto'
import { oidcIssuer, type OidcIdpConfig, type SamlIdpConfig, type SsoIdpConfig } from './config'
import { discover, oidcRedirectUri } from './oidc'
import { parseIdpMetadata, samlAcsUrl, samlSpEntityId } from './saml'

/**
 * Configuration check of one SSO identity provider, for `usertasks-admin
 * doctor` and Settings → Infrastructure (no sign-in, no state):
 *
 *  - OIDC: fresh discovery (issuer must match the configured / preset one,
 *    the usual endpoints present), the signing key set (JWKS) has keys, and
 *    the redirect URI to register at the IdP.
 *  - SAML: IdP metadata (URL or XML) or explicit settings give a sign-on URL
 *    and signing certificates; certificates that have expired or expire
 *    within 30 days are reported; an http:// ACS is flagged (AD FS drops
 *    non-HTTPS endpoints from a relying party trust without an error).
 */

export interface SsoCheckResult {
  id: string
  type: 'oidc' | 'saml'
  ok: boolean
  detail: string
  warnings: string[]
}

const EXPIRY_WARNING_MS = 30 * 24 * 3600_000

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function checkOidc(idp: OidcIdpConfig, origin: string, fetchImpl: typeof fetch): Promise<SsoCheckResult> {
  const warnings: string[] = []
  const issuer = oidcIssuer(idp)
  const { doc } = await discover(idp, fetchImpl, { fresh: true })
  const res = await fetchImpl(doc.jwks_uri, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`signing keys (${doc.jwks_uri}) returned HTTP ${res.status}`)
  const jwks = (await res.json().catch(() => null)) as { keys?: unknown[] } | null
  const keys = Array.isArray(jwks?.keys) ? jwks.keys.length : 0
  if (keys === 0) throw new Error(`the signing key set at ${doc.jwks_uri} has no keys`)
  if (!idp.clientSecret) warnings.push('No clientSecret: the IdP must treat this client as public (PKCE only); AD FS server applications need their secret.')
  if (idp.roleMapping && !idp.defaultOrg) warnings.push('roleMapping has no effect without defaultOrg.')
  return {
    id: idp.id,
    type: 'oidc',
    ok: true,
    detail: `discovery OK (${issuer}, ${keys} signing key${keys === 1 ? '' : 's'}); redirect URI ${oidcRedirectUri(origin, idp)}`,
    warnings,
  }
}

async function checkSaml(idp: SamlIdpConfig, origin: string, fetchImpl: typeof fetch): Promise<SsoCheckResult> {
  const warnings: string[] = []
  let meta: ReturnType<typeof parseIdpMetadata> | null = null
  if (idp.metadataXml) meta = parseIdpMetadata(idp.metadataXml)
  else if (idp.metadataUrl) {
    const res = await fetchImpl(idp.metadataUrl, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`IdP metadata (${idp.metadataUrl}) returned HTTP ${res.status}`)
    meta = parseIdpMetadata(await res.text())
  }
  const certs = idp.idpCert ? (Array.isArray(idp.idpCert) ? idp.idpCert : [idp.idpCert]) : meta?.signingCerts ?? []
  const entryPoint = idp.entryPoint ?? meta?.ssoRedirectUrl ?? null
  if (!entryPoint) throw new Error('no sign-on URL (entryPoint, or IdP metadata with a SingleSignOnService)')
  if (certs.length === 0) throw new Error('no IdP signing certificate (idpCert, or IdP metadata with a signing KeyDescriptor)')

  let usable = 0
  for (const cert of certs) {
    try {
      const pem = cert.includes('BEGIN CERTIFICATE') ? cert : `-----BEGIN CERTIFICATE-----\n${cert.replace(/\s+/g, '').replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`
      const x509 = new X509Certificate(pem)
      const expires = new Date(x509.validTo).getTime()
      const subject = x509.subject.split('\n').find((part) => part.startsWith('CN=')) ?? x509.subject.replace(/\n/g, ', ')
      if (expires <= Date.now()) warnings.push(`Signing certificate ${subject} expired on ${new Date(expires).toISOString().slice(0, 10)}.`)
      else {
        usable++
        if (expires - Date.now() < EXPIRY_WARNING_MS) warnings.push(`Signing certificate ${subject} expires on ${new Date(expires).toISOString().slice(0, 10)}.`)
      }
    } catch {
      warnings.push('A configured signing certificate could not be parsed (PEM or base64 DER expected).')
    }
  }
  if (usable === 0) throw new Error('no valid IdP signing certificate (every certificate has expired or is unreadable)')

  const acs = samlAcsUrl(origin, idp)
  if (!acs.startsWith('https://')) {
    warnings.push(`The ACS URL ${acs} is not https: AD FS (and most IdPs) accept only https endpoints — AD FS silently drops an http ACS from the relying party trust. Serve UserTasks over https (APP_URL).`)
  }
  if (idp.roleMapping && !idp.defaultOrg) warnings.push('roleMapping has no effect without defaultOrg.')
  return {
    id: idp.id,
    type: 'saml',
    ok: true,
    detail: `IdP ${idp.idpIssuer ?? meta?.entityId ?? '(entity id not set)'} sign-on ${entryPoint}, ${usable} valid signing certificate${usable === 1 ? '' : 's'}; ACS ${acs}, SP entity id / metadata ${samlSpEntityId(origin, idp)}`,
    warnings,
  }
}

export async function checkSsoProvider(idp: SsoIdpConfig, origin: string, fetchImpl: typeof fetch = fetch): Promise<SsoCheckResult> {
  try {
    return idp.type === 'oidc' ? await checkOidc(idp, origin, fetchImpl) : await checkSaml(idp, origin, fetchImpl)
  } catch (error) {
    return { id: idp.id, type: idp.type, ok: false, detail: message(error), warnings: [] }
  }
}
