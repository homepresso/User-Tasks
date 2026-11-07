import { createHash } from 'node:crypto'
import { JWT } from 'google-auth-library'
import { connectorFetch, providerErrorMessage, readCappedText } from './http'

/**
 * Short-lived access tokens minted from stored connector credentials:
 *  - ms_client_credentials: Microsoft Entra client-credentials grant
 *    (Graph, Dataverse) — POST {authority}/{tenant}/oauth2/v2.0/token.
 *  - box_ccg: Box Client Credentials Grant (enterprise or user subject).
 *  - google_service_account: Google service-account JWT (optional
 *    domain-wide delegation subject).
 *  - oauth_refresh: a stored refresh token exchanged at token_url
 *    (Salesforce, Dropbox, DocuSign, Workday …).
 *
 * Tokens are cached in process until shortly before expiry, keyed by the
 * tenant plus a hash of the credential material (so two tenants never share
 * an entry and a rotated secret never reuses an old token), and concurrent
 * callers share one in-flight mint. invalidateMintedToken drops an entry
 * after the provider answers 401.
 */

interface CachedToken { token: string; expiresAt: number }

const cache = new Map<string, CachedToken>()
const inflight = new Map<string, Promise<string>>()
const SKEW_MS = 60_000
const MAX_CACHE_ENTRIES = 2_000
const TOKEN_TIMEOUT_MS = 15_000

function cacheKey(kind: string, tenantId: string | null | undefined, parts: unknown[]): string {
  const digest = createHash('sha256').update(JSON.stringify(parts)).digest('hex')
  return `${kind}:${tenantId ?? '-'}:${digest}`
}

async function cached(key: string, mint: () => Promise<{ token: string; expiresInSec: number }>): Promise<string> {
  const hit = cache.get(key)
  if (hit && hit.expiresAt - SKEW_MS > Date.now()) return hit.token
  const pending = inflight.get(key)
  if (pending) return pending
  const p = (async () => {
    try {
      const { token, expiresInSec } = await mint()
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const now = Date.now()
        for (const [k, v] of cache) if (v.expiresAt <= now) cache.delete(k)
        if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value as string)
      }
      cache.set(key, { token, expiresAt: Date.now() + Math.max(expiresInSec, 0) * 1000 })
      return token
    } finally {
      inflight.delete(key)
    }
  })()
  inflight.set(key, p)
  return p
}

export function invalidateMintedToken(key: string | null | undefined): void {
  if (key) cache.delete(key)
}

/** Test hook. */
export function clearMintedTokenCache(): void {
  cache.clear()
  inflight.clear()
}

async function postTokenForm(url: string, form: Record<string, string>, label: string, fetchImpl?: typeof fetch) {
  const res = await connectorFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  }, { timeoutMs: TOKEN_TIMEOUT_MS, fetchImpl, maxAttempts: 2 })
  const raw = await readCappedText(res, 1024 * 1024)
  let payload: any = null
  try { payload = JSON.parse(raw) } catch { /* non-JSON error page */ }
  if (!res.ok || !payload?.access_token) {
    const detail = providerErrorMessage(payload) ?? `HTTP ${res.status}`
    throw new Error(`${label} token request failed: ${detail}`)
  }
  return {
    token: String(payload.access_token),
    expiresInSec: Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600,
    payload,
  }
}

export interface MintResult { token: string; cacheKey: string }

const MS_AUTHORITY_HOSTS = new Set([
  'login.microsoftonline.com', // global
  'login.microsoftonline.us', // US Government
  'login.partner.microsoftonline.cn', // China (21Vianet)
  'login.chinacloudapi.cn',
])

export async function mintMicrosoftToken(authCfg: Record<string, any>, tenantId?: string | null, fetchImpl?: typeof fetch): Promise<MintResult> {
  const directoryId = String(authCfg.tenant_id ?? '').trim()
  const clientId = String(authCfg.client_id ?? '').trim()
  const clientSecret = String(authCfg.client_secret ?? '')
  if (!directoryId || !clientId || !clientSecret) {
    throw new Error('Microsoft connector is missing tenant ID, client ID or client secret')
  }
  if (!/^[A-Za-z0-9.-]+$/.test(directoryId)) throw new Error('Microsoft tenant ID is not valid')
  const authority = String(authCfg.authority_host ?? 'login.microsoftonline.com').trim().toLowerCase()
  if (!MS_AUTHORITY_HOSTS.has(authority)) throw new Error(`Unsupported Microsoft authority host: ${authority}`)
  const scope = String(authCfg.scope || 'https://graph.microsoft.com/.default')
  const key = cacheKey('ms', tenantId, [authority, directoryId, clientId, clientSecret, scope])
  const token = await cached(key, () => postTokenForm(
    `https://${authority}/${encodeURIComponent(directoryId)}/oauth2/v2.0/token`,
    { grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret, scope },
    'Microsoft', fetchImpl,
  ))
  return { token, cacheKey: key }
}

export async function mintBoxToken(authCfg: Record<string, any>, tenantId?: string | null, fetchImpl?: typeof fetch): Promise<MintResult> {
  const clientId = String(authCfg.client_id ?? '').trim()
  const clientSecret = String(authCfg.client_secret ?? '')
  const subjectType = authCfg.box_subject_type === 'user' ? 'user' : 'enterprise'
  const subjectId = String((subjectType === 'user' ? authCfg.box_subject_id : authCfg.enterprise_id ?? authCfg.box_subject_id) ?? '').trim()
  if (!clientId || !clientSecret || !subjectId) throw new Error('Box connector is missing client ID, client secret or enterprise ID')
  const key = cacheKey('box', tenantId, [clientId, clientSecret, subjectType, subjectId])
  const token = await cached(key, () => postTokenForm('https://api.box.com/oauth2/token', {
    grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret,
    box_subject_type: subjectType, box_subject_id: subjectId,
  }, 'Box', fetchImpl))
  return { token, cacheKey: key }
}

export async function mintGoogleServiceAccountToken(authCfg: Record<string, any>, tenantId?: string | null): Promise<MintResult> {
  let serviceAccount: { client_email?: string; private_key?: string; token_uri?: string }
  try {
    serviceAccount = typeof authCfg.service_account_json === 'string'
      ? JSON.parse(authCfg.service_account_json)
      : authCfg.service_account_json
  } catch {
    throw new Error('Service account JSON is not valid JSON')
  }
  if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
    throw new Error('Service account JSON is missing client_email or private_key')
  }
  const scopes: string[] = Array.isArray(authCfg.scopes) ? authCfg.scopes.map(String) : []
  const subject = authCfg.impersonate_email ? String(authCfg.impersonate_email) : undefined
  const key = cacheKey('gsa', tenantId, [serviceAccount.client_email, serviceAccount.private_key, scopes, subject ?? ''])
  const token = await cached(key, async () => {
    const jwt = new JWT({ email: serviceAccount.client_email, key: serviceAccount.private_key, scopes, subject })
    let creds
    try {
      creds = await jwt.authorize()
    } catch (error: any) {
      // google-auth-library errors carry the OAuth error body, never the key.
      const detail = error?.response?.data?.error_description ?? error?.response?.data?.error ?? error?.message ?? 'unknown error'
      throw new Error(`Google service account token request failed: ${detail}`)
    }
    if (!creds.access_token) throw new Error('Google access token acquisition failed')
    const expiresInSec = creds.expiry_date ? Math.floor((creds.expiry_date - Date.now()) / 1000) : 3600
    return { token: creds.access_token, expiresInSec }
  })
  return { token, cacheKey: key }
}

/**
 * Refresh-token grant for bearer connectors that store a refresh token with
 * their client credentials. Providers that rotate refresh tokens hand back a
 * new one; it is used for the rest of this process's cache lifetime (the
 * stored one keeps working for providers that do not revoke on rotation).
 */
export async function mintFromRefreshToken(authCfg: Record<string, any>, tenantId?: string | null, fetchImpl?: typeof fetch): Promise<MintResult> {
  const tokenUrl = String(authCfg.token_url ?? '').trim()
  const refreshToken = String(authCfg.refresh_token ?? '')
  const clientId = String(authCfg.client_id ?? '')
  const clientSecret = String(authCfg.client_secret ?? '')
  if (!tokenUrl || !refreshToken) throw new Error('Connector has no refresh token or token URL — reconnect it')
  const key = cacheKey('refresh', tenantId, [tokenUrl, refreshToken, clientId, clientSecret])
  const token = await cached(key, async () => {
    const form: Record<string, string> = { grant_type: 'refresh_token', refresh_token: refreshToken }
    if (clientId) form.client_id = clientId
    if (clientSecret) form.client_secret = clientSecret
    const result = await postTokenForm(tokenUrl, form, 'OAuth refresh', fetchImpl)
    // Salesforce returns no expires_in; its session lifetime defaults to 2h — refresh hourly.
    return { token: result.token, expiresInSec: Number(result.payload?.expires_in) > 0 ? Number(result.payload.expires_in) : 3600 }
  })
  return { token, cacheKey: key }
}

/**
 * Generic OAuth 2.0 client-credentials grant (SAP BTP XSUAA, ServiceNow,
 * Auth0-style APIs …): token_url + client_id + client_secret, optional
 * scope / audience. Client authentication: HTTP Basic (RFC 6749 §2.3.1).
 */
export async function mintClientCredentialsToken(authCfg: Record<string, any>, tenantId?: string | null, fetchImpl?: typeof fetch): Promise<MintResult> {
  const tokenUrl = String(authCfg.token_url ?? '').trim()
  const clientId = String(authCfg.client_id ?? '')
  const clientSecret = String(authCfg.client_secret ?? '')
  if (!tokenUrl || !clientId || !clientSecret) throw new Error('Client-credentials auth needs a token URL, client ID and client secret')
  const scope = authCfg.scope ? String(authCfg.scope) : ''
  const audience = authCfg.audience ? String(authCfg.audience) : ''
  const key = cacheKey('cc', tenantId, [tokenUrl, clientId, clientSecret, scope, audience])
  const token = await cached(key, async () => {
    const form: Record<string, string> = { grant_type: 'client_credentials' }
    if (scope) form.scope = scope
    if (audience) form.audience = audience
    const res = await connectorFetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`).toString('base64')}`,
      },
      body: new URLSearchParams(form).toString(),
    }, { timeoutMs: TOKEN_TIMEOUT_MS, fetchImpl, maxAttempts: 2 })
    const raw = await readCappedText(res, 1024 * 1024)
    let payload: any = null
    try { payload = JSON.parse(raw) } catch { /* non-JSON */ }
    if (!res.ok || !payload?.access_token) {
      throw new Error(`Client-credentials token request failed: ${providerErrorMessage(payload) ?? `HTTP ${res.status}`}`)
    }
    return { token: String(payload.access_token), expiresInSec: Number(payload.expires_in) > 0 ? Number(payload.expires_in) : 3600 }
  })
  return { token, cacheKey: key }
}
