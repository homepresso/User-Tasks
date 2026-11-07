import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { connectorFetch, providerErrorMessage, readCappedText } from '@/lib/integrations/http'

/**
 * OAuth 2.0 CLIENT token refresh for tenant connectors that authenticate to an
 * EXTERNAL system (Google, Microsoft, Salesforce, generic OAuth2) via the
 * authorization-code grant. Tokens live on the linked `tenant_connectors` row:
 *
 *   credentials (encrypted at rest): access_token, refresh_token, client_secret
 *   config      (plaintext):         authorize_url, token_url, client_id,
 *                                    scopes, provider, expires_at
 *
 * Writeback uses the race-free jsonb-merge RPCs (an interactive refresh and a
 * background refresh can overlap; last-write-wins on a merge never drops
 * sibling keys). Providers that don't rotate the refresh token keep the old one.
 */

export interface GetFreshConnectorTokenParams {
  supabase: SupabaseClient
  connectorId: string
  /**
   * Tenant that must own the token store. The connector id can come from a
   * tenant-editable integration config, so without this check one tenant
   * could point its integration at another tenant's tokens. Background jobs
   * that iterate all connectors pass null.
   */
  tenantId?: string | null
  /** Refresh when less than this much validity is left (default 60s). */
  minValidityMs?: number
}

// Concurrent refreshes of one connector share a single token request:
// providers that rotate refresh tokens (Microsoft, Box …) reject the second
// use of the old one, which would otherwise break the connector.
const inflightRefresh = new Map<string, Promise<string>>()

// Refresh when the access token has less than this much life left.
const REFRESH_SKEW_MS = 60_000

export async function getFreshConnectorToken(params: GetFreshConnectorTokenParams): Promise<string> {
  const key = `${params.tenantId ?? '*'}:${params.connectorId}`
  const pending = inflightRefresh.get(key)
  if (pending) return pending
  const p = loadOrRefresh(params).finally(() => inflightRefresh.delete(key))
  inflightRefresh.set(key, p)
  return p
}

async function loadOrRefresh({ supabase, connectorId, tenantId, minValidityMs }: GetFreshConnectorTokenParams): Promise<string> {
  let query = (supabase as any)
    .from('tenant_connectors')
    .select('id, tenant_id, connector_key, config, credentials')
    .eq('id', connectorId)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data, error } = await query.maybeSingle()
  if (error) throw new Error(`OAuth connector load failed: ${error.message}`)
  if (!data) throw new Error('OAuth connector not found')

  const config = (data.config ?? {}) as Record<string, any>
  const credentials = decryptSensitiveFields((data.credentials ?? {}) as Record<string, any>) as Record<string, any>

  const accessToken = String(credentials.access_token ?? '')
  const expiresAtMs = config.expires_at ? Date.parse(String(config.expires_at)) : NaN

  // Still comfortably valid — reuse the cached access token.
  if (accessToken && Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > (minValidityMs ?? REFRESH_SKEW_MS)) {
    return accessToken
  }

  // Some providers refresh at another endpoint (Adobe Acrobat Sign /oauth/v2/refresh).
  const tokenUrl = String(config.refresh_url || config.token_url || '')
  const refreshToken = String(credentials.refresh_token ?? '')
  const clientId = String(config.client_id ?? credentials.client_id ?? '')
  const clientSecret = String(credentials.client_secret ?? config.client_secret ?? '')

  if (!refreshToken) {
    // No refresh token: a long-lived / non-refreshable access token — best-effort reuse.
    if (accessToken) return accessToken
    throw new Error('OAuth connector has no refresh token — reconnect the integration.')
  }
  if (!tokenUrl) throw new Error('OAuth connector is missing token_url — reconnect the integration.')

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  const basicAuth = config.client_auth === 'basic' && clientId
  if (clientId) body.set('client_id', clientId)
  if (clientSecret && !basicAuth) body.set('client_secret', clientSecret)

  // Egress-guarded on every hop (token_url is tenant-supplied), bounded, retried on 429.
  const res = await connectorFetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      ...(basicAuth ? { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` } : {}),
    },
    body: body.toString(),
  }, { timeoutMs: 15_000, maxAttempts: 2 })

  const raw = await readCappedText(res, 1024 * 1024)
  let payload: any = null
  try { payload = JSON.parse(raw) } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const detail = providerErrorMessage(payload) ?? String(res.status)
    // invalid_grant = the refresh token was revoked or expired: flag the
    // connector so the UI shows "reconnect" instead of failing silently.
    if (payload?.error === 'invalid_grant') {
      await (supabase as any).from('tenant_connectors')
        .update({ last_test_status: 'error', last_test_message: 'OAuth authorization was revoked or expired — reconnect the integration.', last_tested_at: new Date().toISOString() })
        .eq('id', String(data.id)).eq('tenant_id', String(data.tenant_id))
        .then(() => undefined, () => undefined)
    }
    throw new Error(`OAuth token refresh failed (${detail}) — reconnect the integration.`)
  }

  const newAccessToken = String(payload?.access_token ?? '')
  if (!newAccessToken) throw new Error('OAuth token refresh returned no access_token.')
  // Some providers (e.g. Google) omit refresh_token on refresh — keep the old one.
  const newRefreshToken = payload?.refresh_token ? String(payload.refresh_token) : refreshToken
  const expiresIn = Number(payload?.expires_in ?? 3600)
  const newExpiresAt = new Date(Date.now() + Math.max(expiresIn, 0) * 1000).toISOString()

  // Encrypt the fresh tokens before persisting, then merge (race-free).
  const credentialPatch = encryptSensitiveFields({
    access_token: newAccessToken,
    refresh_token: newRefreshToken,
  }) as Record<string, any>

  const { error: credErr } = await (supabase as any).rpc('merge_tenant_connector_credentials', {
    p_connector_id: String(data.id),
    p_patch: credentialPatch,
  })
  if (credErr) throw new Error(`OAuth token writeback failed: ${credErr.message}`)

  await (supabase as any).rpc('merge_tenant_connector_config', {
    p_tenant_id: String(data.tenant_id),
    p_connector_key: String(data.connector_key),
    p_patch: { expires_at: newExpiresAt },
  })

  return newAccessToken
}
