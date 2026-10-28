import { createHash } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { randomToken, saveFlowState, takeFlowState } from '../builtin/store'
import { AuthError } from '../types'
import { cognitoEndpoints, oidcGroupsClaim, oidcIssuer, oidcScopes, resolveSsoSecret, type OidcIdpConfig } from './config'
import type { ExternalIdentity } from './accounts'

/**
 * OpenID Connect relying party (authorization code flow with PKCE S256,
 * state and nonce), for any spec-compliant IdP:
 *
 *  - discovery from <issuer>/.well-known/openid-configuration (cached 1 h);
 *  - state: single-use, stored server-side (app_auth.flow_states, 10 min) and
 *    bound to the browser that started the flow by a random cookie whose
 *    hash travels with the state — a callback replayed in another browser, or
 *    one the user didn't start (login CSRF), is refused;
 *  - ID token: signature via the IdP's JWKS (RS*, PS*, ES*, EdDSA; HS256
 *    only with a client secret), iss, aud (= client id), azp, exp / iat /
 *    nbf with 60 s skew, nonce;
 *  - userinfo merged when the IdP has the endpoint (sub must match);
 *  - Entra multi-tenant: issuer checked against the token's own tid (and the
 *    allowedTenants list); Google Workspace: hd enforced.
 */

const FLOW_TTL_MS = 10 * 60_000
const DISCOVERY_TTL_MS = 60 * 60_000
const CLOCK_TOLERANCE_S = 60
const ASYMMETRIC_ALGS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']

interface Discovery {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  jwks_uri: string
  userinfo_endpoint?: string
  token_endpoint_auth_methods_supported?: string[]
}

const discoveryCache = new Map<string, { at: number; doc: Discovery; jwks: JWTVerifyGetKey }>()

/** Tests: forget cached discovery documents / key sets. */
export function clearOidcCache(): void {
  discoveryCache.clear()
}

export async function discover(idp: OidcIdpConfig, fetchImpl: typeof fetch = fetch): Promise<{ doc: Discovery; jwks: JWTVerifyGetKey }> {
  const issuer = oidcIssuer(idp)
  const url = idp.discoveryUrl ?? `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
  const endpoints = cognitoEndpoints(idp)
  // Two Cognito IdPs on one pool may use different domains.
  const cacheKey = endpoints ? `${url}#${endpoints.authorization_endpoint}` : url
  const hit = discoveryCache.get(cacheKey)
  if (hit && Date.now() - hit.at < DISCOVERY_TTL_MS) return hit
  const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }).catch((error: Error) => {
    throw new AuthError('sso_failed', `Could not reach the identity provider (${error.message})`)
  })
  if (!res.ok) throw new AuthError('sso_failed', `Identity provider discovery failed (HTTP ${res.status})`)
  const doc = (await res.json()) as Discovery
  for (const field of ['issuer', 'authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
    if (typeof doc[field] !== 'string' || !doc[field]) throw new AuthError('sso_failed', `Identity provider discovery document has no ${field}`)
  }
  // The document must describe the issuer we were configured with (multi-tenant
  // Entra publishes a {tenantid} template instead).
  if (idp.preset !== 'entra_multitenant' && trimSlash(doc.issuer) !== trimSlash(issuer)) {
    throw new AuthError('sso_failed', `Identity provider issuer mismatch: expected ${issuer}, discovery says ${doc.issuer}`)
  }
  if (endpoints) Object.assign(doc, endpoints)
  const entry = { at: Date.now(), doc, jwks: createRemoteJWKSet(new URL(doc.jwks_uri), { timeoutDuration: 10_000 }) }
  discoveryCache.set(cacheKey, entry)
  return entry
}

const trimSlash = (s: string) => s.replace(/\/+$/, '')

function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function oidcRedirectUri(origin: string, idp: { id: string }): string {
  return `${origin}/auth/sso/${encodeURIComponent(idp.id)}/callback`
}

/** Authorization URL + the browser-binding cookie value for the flow. */
export async function startOidc(
  idp: OidcIdpConfig,
  { origin, redirect, org }: { origin: string; redirect: string; org: string | null },
  fetchImpl: typeof fetch = fetch,
): Promise<{ url: string; binding: string }> {
  const { doc } = await discover(idp, fetchImpl)
  const state = randomToken()
  const nonce = randomToken()
  const verifier = randomToken(48)
  const binding = randomToken()
  await saveFlowState(state, 'oidc', { idp: idp.id, nonce, verifier, redirect, org, binding: s256(binding) }, FLOW_TTL_MS)

  const url = new URL(doc.authorization_endpoint)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', idp.clientId)
  url.searchParams.set('redirect_uri', oidcRedirectUri(origin, idp))
  url.searchParams.set('scope', oidcScopes(idp).join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('code_challenge', s256(verifier))
  url.searchParams.set('code_challenge_method', 'S256')
  if (idp.preset === 'google' && idp.hostedDomain?.length === 1) url.searchParams.set('hd', idp.hostedDomain[0])
  return { url: url.toString(), binding }
}

export interface OidcCallbackInput {
  state: string | null
  code: string | null
  error?: string | null
  errorDescription?: string | null
  /** Value of the browser-binding cookie. */
  binding: string | null
  origin: string
}

/** Validate the callback and return the external identity plus where to go next. */
export async function finishOidc(
  idp: OidcIdpConfig,
  input: OidcCallbackInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ identity: ExternalIdentity; redirect: string; org: string | null }> {
  if (!input.state) throw new AuthError('sso_failed', 'Missing state')
  const flow = await takeFlowState(input.state, 'oidc')
  if (!flow || flow.idp !== idp.id) throw new AuthError('sso_failed', 'This sign-in link has expired or was already used. Please try again.')
  if (!input.binding || s256(input.binding) !== flow.binding) {
    throw new AuthError('sso_failed', 'This sign-in was started in another browser. Please try again.')
  }
  if (input.error) throw new AuthError('sso_failed', `Sign-in was cancelled or refused: ${input.errorDescription || input.error}`)
  if (!input.code) throw new AuthError('sso_failed', 'Missing authorization code')

  const { doc, jwks } = await discover(idp, fetchImpl)
  const clientSecret = await resolveSsoSecret(idp.clientSecret, `sso_providers.${idp.id}.clientSecret`)

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: oidcRedirectUri(input.origin, idp),
    code_verifier: String(flow.verifier),
  })
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  const methods = doc.token_endpoint_auth_methods_supported ?? ['client_secret_basic']
  if (clientSecret && methods.includes('client_secret_basic') && !methods.includes('client_secret_post')) {
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(idp.clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`
  } else {
    body.set('client_id', idp.clientId)
    if (clientSecret) body.set('client_secret', clientSecret)
  }
  const tokenRes = await fetchImpl(doc.token_endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) }).catch((error: Error) => {
    throw new AuthError('sso_failed', `Could not reach the identity provider (${error.message})`)
  })
  const tokens = (await tokenRes.json().catch(() => ({}))) as { id_token?: string; access_token?: string; error?: string; error_description?: string }
  if (!tokenRes.ok || !tokens.id_token) {
    throw new AuthError('sso_failed', `Token exchange failed: ${tokens.error_description || tokens.error || `HTTP ${tokenRes.status}`}`)
  }

  const claims = await verifyIdToken(idp, doc, jwks, tokens.id_token, String(flow.nonce), clientSecret)
  let merged: Record<string, unknown> = { ...claims }
  if (idp.userinfo && doc.userinfo_endpoint && tokens.access_token) {
    const res = await fetchImpl(doc.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}`, accept: 'application/json' }, signal: AbortSignal.timeout(10_000) }).catch(() => null)
    if (res?.ok) {
      const info = (await res.json().catch(() => null)) as Record<string, unknown> | null
      // Only trust userinfo about the same subject; ID token claims win.
      if (info && info.sub === claims.sub) merged = { ...info, ...claims }
    }
  }

  return {
    identity: toExternalIdentity(idp, merged),
    redirect: String(flow.redirect ?? '/tasks'),
    org: typeof flow.org === 'string' && flow.org ? flow.org : null,
  }
}

async function verifyIdToken(
  idp: OidcIdpConfig,
  doc: Discovery,
  jwks: JWTVerifyGetKey,
  idToken: string,
  nonce: string,
  clientSecret: string | undefined,
): Promise<JWTPayload> {
  let payload: JWTPayload
  try {
    const header = JSON.parse(Buffer.from(idToken.split('.')[0] ?? '', 'base64url').toString('utf8')) as { alg?: string }
    if (header.alg === 'HS256') {
      if (!clientSecret) throw new Error('HS256 ID tokens need a client secret')
      ;({ payload } = await jwtVerify(idToken, new TextEncoder().encode(clientSecret), { algorithms: ['HS256'], audience: idp.clientId, clockTolerance: CLOCK_TOLERANCE_S }))
    } else {
      ;({ payload } = await jwtVerify(idToken, jwks, { algorithms: ASYMMETRIC_ALGS, audience: idp.clientId, clockTolerance: CLOCK_TOLERANCE_S }))
    }
  } catch (error) {
    throw new AuthError('sso_failed', `The identity provider's ID token is not valid (${(error as Error).message})`)
  }

  const iss = String(payload.iss ?? '')
  if (idp.preset === 'entra_multitenant') {
    const tid = String(payload.tid ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(tid) || iss !== `https://login.microsoftonline.com/${tid}/v2.0`) {
      throw new AuthError('sso_failed', 'ID token issuer does not match its tenant')
    }
    if (idp.allowedTenants?.length && !idp.allowedTenants.map((t) => t.toLowerCase()).includes(tid.toLowerCase())) {
      throw new AuthError('sso_failed', 'Your organisation is not allowed to sign in here.')
    }
  } else if (trimSlash(iss) !== trimSlash(doc.issuer)) {
    throw new AuthError('sso_failed', 'ID token issuer mismatch')
  }
  if (payload.nonce !== nonce) throw new AuthError('sso_failed', 'ID token nonce mismatch')
  if (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== idp.clientId) {
    throw new AuthError('sso_failed', 'ID token azp mismatch')
  }
  if (typeof payload.sub !== 'string' || !payload.sub) throw new AuthError('sso_failed', 'ID token has no subject')
  if (idp.preset === 'google' && idp.hostedDomain?.length) {
    const hd = String(payload.hd ?? '').toLowerCase()
    if (!idp.hostedDomain.map((d) => d.toLowerCase()).includes(hd)) {
      throw new AuthError('sso_failed', 'Sign in with your organisation’s Google Workspace account.')
    }
  }
  return payload
}

function claimString(claims: Record<string, unknown>, name: string): string | null {
  const value = claims[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function claimList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v)).filter(Boolean)
  if (typeof value === 'string' && value.trim()) return value.split(/[,\s]+/).filter(Boolean)
  return []
}

/** Claims → ExternalIdentity, with the per-IdP email-trust rules. */
export function toExternalIdentity(idp: OidcIdpConfig, claims: Record<string, unknown>): ExternalIdentity {
  const issuer = String(claims.iss ?? '')
  // Subject is unique per issuer; multi-tenant Entra issuers differ per tenant.
  const subject = idp.preset === 'entra_multitenant' ? `${claims.tid}:${claims.oid ?? claims.sub}` : String(claims.sub)
  let email = claimString(claims, idp.emailClaim)
  if (!email && idp.preset.startsWith('entra')) email = claimString(claims, 'preferred_username')
  if (email && !email.includes('@')) email = null

  let emailVerified = claims.email_verified === true || claims.email_verified === 'true'
  // Entra ID / AD FS send no email_verified: the directory's admins can set any
  // address on an account, including another organisation's. Their emails are
  // trusted only when allowedDomains pins them to the domains the directory
  // owns (enforced for every sign-in), or with trustEmail. Multi-tenant Entra
  // additionally accepts xms_edov (a domain-verified email).
  if (idp.preset === 'entra' || idp.preset === 'adfs' || idp.preset === 'entra_external_id') {
    emailVerified = emailVerified || (claims.email_verified === undefined && Boolean(idp.allowedDomains?.length))
  }
  if (idp.preset === 'entra_multitenant') emailVerified = claims.xms_edov === true || claims.xms_edov === '1'
  if (idp.trustEmail) emailVerified = true

  return {
    idp,
    subject: subject || `${issuer}:${String(claims.sub)}`,
    email,
    emailVerified,
    name: claimString(claims, idp.nameClaim) ?? claimString(claims, 'preferred_username'),
    groups: claimList(claims[oidcGroupsClaim(idp)]),
    claims,
  }
}
