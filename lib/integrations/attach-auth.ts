import { JWT } from 'google-auth-library'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getFreshConnectorToken } from '@/lib/oauth/client-token'

/**
 * Single source of truth for turning an integration's `auth_config` into
 * outbound HTTP auth headers. Consolidates the previously-duplicated
 * bearer / google_service_account / api_key / basic logic and adds the
 * `oauth2` client branch (authorization-code + auto-refresh).
 *
 * The bearer branch preserves the Google service-account JWT mint verbatim.
 * `oauth2` needs a Supabase client (to load the connector row and write back
 * refreshed tokens) — pass it via `ctx`.
 */

export interface AttachAuthContext {
  supabase?: SupabaseClient
  integrationId?: string | null
}

export async function applyAuthHeaders(
  integrationConfig: any,
  headers: Record<string, string>,
  ctx?: AttachAuthContext,
): Promise<void> {
  const authCfg = integrationConfig?.auth_config

  if (integrationConfig?.auth_type === 'bearer') {
    if (authCfg?._executor === 'google_service_account' && authCfg?.service_account_json) {
      const serviceAccount = JSON.parse(authCfg.service_account_json)
      if (!serviceAccount?.client_email || !serviceAccount?.private_key) {
        throw new Error('Service account JSON is missing client_email or private_key')
      }
      const jwt = new JWT({
        email: serviceAccount.client_email,
        key: serviceAccount.private_key,
        scopes: Array.isArray(authCfg.scopes) ? authCfg.scopes : [],
        subject: authCfg.impersonate_email || undefined,
      })
      const token = await jwt.authorize()
      if (!token.access_token) throw new Error('Google access token acquisition failed')
      headers['Authorization'] = `Bearer ${token.access_token}`
    } else if (authCfg?.token) {
      headers['Authorization'] = `Bearer ${authCfg.token}`
    }
  } else if (integrationConfig?.auth_type === 'oauth2') {
    if (!ctx?.supabase) throw new Error('OAuth2 auth requires a Supabase context')
    const connectorId = authCfg?.connector_id
      ? String(authCfg.connector_id)
      : await resolveConnectorId(ctx.supabase, ctx.integrationId)
    if (!connectorId) throw new Error('OAuth2 integration has no linked connector — reconnect the integration.')
    const token = await getFreshConnectorToken({ supabase: ctx.supabase, connectorId })
    headers['Authorization'] = `Bearer ${token}`
  } else if (integrationConfig?.auth_type === 'api_key' && authCfg?.key_value) {
    const addTo = authCfg.add_to ?? 'header'
    if (addTo === 'header') {
      const keyName = authCfg.key_name || 'X-API-Key'
      let value = String(authCfg.key_value)
      // An "API key" aimed at the Authorization header is a bearer token in
      // disguise (common OpenAPI idiom). Sending it raw yields "malformed
      // Authorization header" 401s — add the scheme unless one is present.
      if (keyName.toLowerCase() === 'authorization' && !/^\s*(bearer|basic|token|sharedkey|apikey)\s/i.test(value)) {
        value = `Bearer ${value}`
      }
      headers[keyName] = value
    }
  } else if (integrationConfig?.auth_type === 'basic' && authCfg?.username) {
    headers['Authorization'] = `Basic ${Buffer.from(`${authCfg.username}:${authCfg.password ?? ''}`).toString('base64')}`
  }
}

/** Fall back to the connector linked to this integration when auth_config omits connector_id. */
async function resolveConnectorId(supabase: SupabaseClient, integrationId?: string | null): Promise<string | null> {
  if (!integrationId) return null
  const { data } = await (supabase as any)
    .from('tenant_connectors')
    .select('id')
    .eq('integration_id', integrationId)
    .maybeSingle()
  return data?.id ? String(data.id) : null
}
