import { createHash } from 'node:crypto'
import type { CacheProvider, Profile, SAML as SamlClass, SamlConfig } from '@node-saml/node-saml'
import { isMissingSdkError } from '@/lib/providers/storage/optional-sdk'
import { optionalPackageInstallHint } from '@/lib/optional-drivers'
import { sanitizeRedirect } from '@/lib/safe-redirect'
import { authDb } from '../builtin/db'
import { hashToken, randomToken, rememberOnce, saveFlowState, takeFlowState } from '../builtin/store'
import { AuthError } from '../types'
import { samlAttributeNames, type SamlIdpConfig } from './config'
import type { ExternalIdentity } from './accounts'

/**
 * SAML 2.0 service provider (SP-initiated and IdP-initiated SSO) on
 * @node-saml/node-saml (optional dependency, loaded on first use).
 *
 *  - Signed assertions required (wantAssertionsSigned, default true); the
 *    IdP certificate(s) come from config or the IdP metadata.
 *  - Audience = our SP entity id; NotBefore / NotOnOrAfter / SubjectConfirmation
 *    checked with acceptedClockSkewMs (default 60 s).
 *  - SP-initiated: the AuthnRequest id is stored (app_auth.flow_states) and the
 *    response's InResponseTo must match one, once. IdP-initiated responses (no
 *    InResponseTo) are accepted only with allowIdpInitiated.
 *  - Replay: every assertion id is remembered until it expires
 *    (app_auth.replay_cache); a second use is refused.
 *  - Email from the preset's attribute, else a NameID that is an email.
 *
 * The ACS receives a cross-site POST from the IdP, so it can't rely on
 * cookies (SameSite=Lax); RelayState carries a single-use server-side flow
 * id instead.
 */

const FLOW_TTL_MS = 10 * 60_000
const METADATA_TTL_MS = 60 * 60_000
const REPLAY_TTL_MS = 24 * 3600_000

export function samlAcsUrl(origin: string, idp: { id: string }): string {
  return `${origin}/auth/saml/${encodeURIComponent(idp.id)}/acs`
}

export function samlSpEntityId(origin: string, idp: SamlIdpConfig): string {
  return idp.spEntityId ?? `${origin}/auth/saml/${encodeURIComponent(idp.id)}/metadata`
}

async function loadNodeSaml(): Promise<typeof import('@node-saml/node-saml')> {
  try {
    return await import('@node-saml/node-saml')
  } catch (error) {
    if (isMissingSdkError(error, '@node-saml/node-saml')) {
      throw new AuthError('not_supported', `SAML sign-in needs the optional package @node-saml/node-saml: ${optionalPackageInstallHint('@node-saml/node-saml')}.`)
    }
    throw error
  }
}

// ── IdP metadata ─────────────────────────────────────────────────────────────

export interface IdpMetadata {
  entityId: string | null
  ssoRedirectUrl: string | null
  signingCerts: string[]
}

/** Minimal, namespace-agnostic reader for the IdP metadata fields we use. */
export function parseIdpMetadata(xml: string): IdpMetadata {
  const entity = /<(?:\w+:)?EntityDescriptor\b[^>]*\bentityID="([^"]+)"/.exec(xml)
  const idpDescriptor = /<(?:\w+:)?IDPSSODescriptor\b[\s\S]*?<\/(?:\w+:)?IDPSSODescriptor>/.exec(xml)?.[0] ?? xml
  let ssoRedirectUrl: string | null = null
  for (const m of idpDescriptor.matchAll(/<(?:\w+:)?SingleSignOnService\b([^>]*)\/?>/g)) {
    const attrs = m[1]
    const binding = /\bBinding="([^"]+)"/.exec(attrs)?.[1] ?? ''
    const location = /\bLocation="([^"]+)"/.exec(attrs)?.[1] ?? null
    if (location && binding.endsWith(':HTTP-Redirect')) { ssoRedirectUrl = location; break }
    if (location && !ssoRedirectUrl) ssoRedirectUrl = location
  }
  const signingCerts: string[] = []
  for (const m of idpDescriptor.matchAll(/<(?:\w+:)?KeyDescriptor\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?KeyDescriptor>/g)) {
    const use = /\buse="([^"]+)"/.exec(m[1])?.[1]
    if (use && use !== 'signing') continue
    for (const c of m[2].matchAll(/<(?:\w+:)?X509Certificate>([\s\S]*?)<\/(?:\w+:)?X509Certificate>/g)) {
      const cert = c[1].replace(/\s+/g, '')
      if (cert && !signingCerts.includes(cert)) signingCerts.push(cert)
    }
  }
  return { entityId: entity?.[1] ?? null, ssoRedirectUrl: ssoRedirectUrl?.replace(/&amp;/g, '&') ?? null, signingCerts }
}

const metadataCache = new Map<string, { at: number; meta: IdpMetadata }>()

export function clearSamlCache(): void {
  metadataCache.clear()
}

async function idpMetadata(idp: SamlIdpConfig, fetchImpl: typeof fetch): Promise<IdpMetadata | null> {
  if (idp.metadataXml) return parseIdpMetadata(idp.metadataXml)
  if (!idp.metadataUrl) return null
  const hit = metadataCache.get(idp.metadataUrl)
  if (hit && Date.now() - hit.at < METADATA_TTL_MS) return hit.meta
  const res = await fetchImpl(idp.metadataUrl, { signal: AbortSignal.timeout(10_000) }).catch((error: Error) => {
    throw new AuthError('sso_failed', `Could not fetch the SAML IdP metadata (${error.message})`)
  })
  if (!res.ok) throw new AuthError('sso_failed', `Could not fetch the SAML IdP metadata (HTTP ${res.status})`)
  const meta = parseIdpMetadata(await res.text())
  metadataCache.set(idp.metadataUrl, { at: Date.now(), meta })
  return meta
}

// ── node-saml wiring ─────────────────────────────────────────────────────────

/** InResponseTo store: AuthnRequest ids in app_auth.flow_states, per IdP. */
function requestIdCache(idp: SamlIdpConfig): CacheProvider {
  const kind = `saml_request:${idp.id}`
  const db = () => authDb()
  return {
    async saveAsync(key, value) {
      await saveFlowState(key, kind, { value }, FLOW_TTL_MS)
      return { value, createdAt: Date.now() }
    },
    async getAsync(key) {
      const { rows } = await db().query<{ data: { value: string } }>(
        'SELECT data FROM app_auth.flow_states WHERE id = $1 AND kind = $2 AND expires_at > now()',
        [hashToken(key), kind],
      )
      return rows[0]?.data.value ?? null
    },
    async removeAsync(key) {
      if (!key) return null
      const data = await takeFlowState(key, kind)
      return (data?.value as string | undefined) ?? null
    },
  }
}

const toPem = (cert: string) => cert.includes('BEGIN CERTIFICATE') ? cert : cert.replace(/\s+/g, '')

export async function samlClient(idp: SamlIdpConfig, origin: string, fetchImpl: typeof fetch = fetch): Promise<SamlClass> {
  const { SAML, ValidateInResponseTo } = await loadNodeSaml()
  const meta = await idpMetadata(idp, fetchImpl)
  const certs = idp.idpCert ? (Array.isArray(idp.idpCert) ? idp.idpCert : [idp.idpCert]) : meta?.signingCerts ?? []
  const entryPoint = idp.entryPoint ?? meta?.ssoRedirectUrl ?? undefined
  if (certs.length === 0) throw new AuthError('sso_failed', `SAML provider "${idp.id}" has no IdP signing certificate (idpCert or metadata)`)
  if (!entryPoint) throw new AuthError('sso_failed', `SAML provider "${idp.id}" has no entryPoint (or metadata)`)
  const config: SamlConfig = {
    callbackUrl: samlAcsUrl(origin, idp),
    entryPoint,
    issuer: samlSpEntityId(origin, idp),
    audience: samlSpEntityId(origin, idp),
    idpCert: certs.map(toPem),
    idpIssuer: idp.idpIssuer ?? meta?.entityId ?? undefined,
    wantAssertionsSigned: idp.wantAssertionsSigned,
    wantAuthnResponseSigned: idp.wantAuthnResponseSigned,
    acceptedClockSkewMs: idp.acceptedClockSkewMs,
    identifierFormat: idp.identifierFormat ?? null,
    validateInResponseTo: idp.allowIdpInitiated ? ValidateInResponseTo.ifPresent : ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: FLOW_TTL_MS,
    cacheProvider: requestIdCache(idp),
    disableRequestedAuthnContext: true,
    signatureAlgorithm: 'sha256',
    maxAssertionAgeMs: 0,
  }
  return new SAML(config)
}

/** SP-initiated: redirect URL to the IdP (HTTP-Redirect binding). */
export async function startSaml(
  idp: SamlIdpConfig,
  { origin, redirect, org }: { origin: string; redirect: string; org: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const saml = await samlClient(idp, origin, fetchImpl)
  const relayState = randomToken()
  await saveFlowState(relayState, `saml_relay:${idp.id}`, { redirect, org }, FLOW_TTL_MS)
  return saml.getAuthorizeUrlAsync(relayState, undefined, {})
}

export async function samlMetadataXml(idp: SamlIdpConfig, origin: string): Promise<string> {
  const { generateServiceProviderMetadata } = await loadNodeSaml()
  return generateServiceProviderMetadata({
    issuer: samlSpEntityId(origin, idp),
    callbackUrl: samlAcsUrl(origin, idp),
    identifierFormat: idp.identifierFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    wantAssertionsSigned: idp.wantAssertionsSigned,
    decryptionCert: null,
    publicCerts: null,
  } as never)
}

function attribute(profile: Profile, name: string): unknown {
  return (profile as Record<string, unknown>)[name]
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) return firstString(value[0])
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Validate an ACS POST (SAMLResponse + RelayState). */
export async function finishSaml(
  idp: SamlIdpConfig,
  body: { SAMLResponse?: string | null; RelayState?: string | null },
  origin: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ identity: ExternalIdentity; redirect: string; org: string | null }> {
  if (!body.SAMLResponse) throw new AuthError('sso_failed', 'Missing SAMLResponse')
  const saml = await samlClient(idp, origin, fetchImpl)
  let profile: Profile | null
  try {
    ;({ profile } = await saml.validatePostResponseAsync({ SAMLResponse: body.SAMLResponse }))
  } catch (error) {
    throw new AuthError('sso_failed', `The SAML response is not valid (${(error as Error).message})`)
  }
  if (!profile) throw new AuthError('sso_failed', 'The SAML response has no assertion')

  // Replay protection: each assertion is accepted once.
  const assertionXml = profile.getAssertionXml?.() ?? ''
  const assertionId = /<(?:\w+:)?Assertion\b[^>]*\bID="([^"]+)"/.exec(assertionXml)?.[1] ?? createHash('sha256').update(assertionXml).digest('hex')
  const fresh = await rememberOnce(`saml:${idp.id}:${assertionId}`, new Date(Date.now() + REPLAY_TTL_MS))
  if (!fresh) throw new AuthError('sso_failed', 'This SAML assertion was already used.')

  // Where to go: the SP-initiated flow's stored target, or an IdP-initiated
  // RelayState that is a safe local path.
  let redirect = '/tasks'
  let org: string | null = null
  const relay = body.RelayState ?? null
  const flow = relay ? await takeFlowState(relay, `saml_relay:${idp.id}`) : null
  if (flow) {
    redirect = String(flow.redirect ?? '/tasks')
    org = typeof flow.org === 'string' && flow.org ? flow.org : null
  } else {
    if (!idp.allowIdpInitiated) throw new AuthError('sso_failed', 'Unsolicited SAML responses are not accepted.')
    if (relay && relay.startsWith('/')) redirect = sanitizeRedirect(relay)
  }

  const names = samlAttributeNames(idp)
  const nameId = profile.nameID ?? null
  let email = firstString(attribute(profile, names.email)) ?? firstString(profile.email) ?? firstString(profile.mail)
  if (!email && nameId && nameId.includes('@')) email = nameId
  if (email && !email.includes('@')) email = null
  const groupsRaw = attribute(profile, names.groups)
  const groups = Array.isArray(groupsRaw) ? groupsRaw.map(String) : typeof groupsRaw === 'string' ? [groupsRaw] : []

  return {
    identity: {
      idp,
      subject: nameId ?? email ?? assertionId,
      email,
      // The assertion is signed by the configured IdP, but its admins can put any
      // address in it: trusted for linking / JIT only when allowedDomains pins
      // the domains the directory owns (checked on every sign-in), or with trustEmail.
      emailVerified: Boolean(email) && Boolean(idp.allowedDomains?.length || idp.trustEmail),
      name: firstString(attribute(profile, names.name)),
      groups,
      claims: { iss: profile.issuer, nameID: nameId, nameIDFormat: profile.nameIDFormat, sessionIndex: profile.sessionIndex },
    },
    redirect,
    org,
  }
}
