import type { SupabaseClient } from '@supabase/supabase-js'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { assertSafeEgressUrl } from '@/lib/egress-guard'

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
}

// Refresh when the access token has less than this much life left.
const REFRESH_SKEW_MS = 60_000

export async function getFreshConnectorToken({ supabase, connectorId }: GetFreshConnectorTokenParams): Promise<string> {
  const { data, error } = await (supabase as any)
    .from('tenant_connectors')
    .select('id, tenant_id, connector_key, config, credentials')
    .eq('id', connectorId)
    .maybeSingle()
  if (error) throw new Error(`OAuth connector load failed: ${error.message}`)
  if (!data) throw new Error('OAuth connector not found')

  const config = (data.config ?? {}) as Record<string, any>
  const credentials = decryptSensitiveFields((data.credentials ?? {}) as Record<string, any>) as Record<string, any>

  const accessToken = String(credentials.access_token ?? '')
  const expiresAtMs = config.expires_at ? Date.parse(String(config.expires_at)) : NaN

  // Still comfortably valid — reuse the cached access token.
  if (accessToken && Number.isFinite(expiresAtMs) && expiresAtMs - Date.now() > REFRESH_SKEW_MS) {
    return accessToken
  }

  const tokenUrl = String(config.token_url ?? '')
  const refreshToken = String(credentials.refresh_token ?? '')
  const clientId = String(config.client_id ?? credentials.client_id ?? '')
  const clientSecret = String(credentials.client_secret ?? config.client_secret ?? '')

  if (!refreshToken) {
    // No refresh token: a long-lived / non-refreshable access token — best-effort reuse.
    if (accessToken) return accessToken
    throw new Error('OAuth connector has no refresh token — reconnect the integration.')
  }
  if (!tokenUrl) throw new Error('OAuth connector is missing token_url — reconnect the integration.')
  await assertSafeEgressUrl(tokenUrl)

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  })
  if (clientId) body.set('client_id', clientId)
  if (clientSecret) body.set('client_secret', clientSecret)

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  })

  if (!res.ok) {
    let detail = String(res.status)
    try {
      const payload = await res.json()
      detail = payload?.error_description || payload?.error || detail
    } catch { /* keep status code */ }
    throw new Error(`OAuth token refresh failed (${detail}) — reconnect the integration.`)
  }

  const payload = await res.json()
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
