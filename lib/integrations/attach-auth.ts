import type { SupabaseClient } from '@supabase/supabase-js'
import { getFreshConnectorToken } from '@/lib/oauth/client-token'
import { stripHeaderBreaks } from './request-template'
import {
  mintBoxToken,
  mintClientCredentialsToken,
  mintFromRefreshToken,
  mintGoogleServiceAccountToken,
  mintMicrosoftToken,
} from './token-mint'

/**
 * Single source of truth for turning an integration's `auth_config` into
 * outbound HTTP auth (headers, or a query parameter for `api_key` with
 * add_to = 'query'). Used by the reference executor, the workflow engine and
 * the integration test routes.
 *
 * bearer:   static token, or a minted one by auth_config._executor —
 *           google_service_account | ms_client_credentials | box_ccg |
 *           client_credentials (token_url + client creds, optional scope/audience) |
 *           oauth_refresh (refresh_token + token_url + client creds).
 * oauth2:   authorization-code connector tokens with auto-refresh (needs ctx.supabase;
 *           the token store must belong to ctx.tenantId).
 * api_key:  header (default) or query parameter.
 * basic:    username/password; ukg_pro adds US-Customer-Api-Key.
 */

export interface AttachAuthContext {
  supabase?: SupabaseClient
  integrationId?: string | null
  /** Tenant that owns the integration — scopes oauth2 token-store lookups and token caches. */
  tenantId?: string | null
}

export interface AppliedAuth {
  /** Cache key of a minted token — pass to invalidateMintedToken after a 401 to force a fresh mint. */
  mintedTokenKey?: string
}

export async function applyAuthHeaders(
  integrationConfig: any,
  headers: Record<string, string>,
  ctx?: AttachAuthContext,
  query?: Record<string, string>,
): Promise<AppliedAuth> {
  const authCfg = integrationConfig?.auth_config ?? {}
  const tenantId = ctx?.tenantId ?? null
  const setHeader = (name: string, value: string) => { headers[name] = stripHeaderBreaks(value) }

  if (integrationConfig?.auth_type === 'bearer') {
    const executor = authCfg?._executor
    if (executor === 'google_service_account' && authCfg?.service_account_json) {
      const minted = await mintGoogleServiceAccountToken(authCfg, tenantId)
      setHeader('Authorization', `Bearer ${minted.token}`)
      return { mintedTokenKey: minted.cacheKey }
    }
    if (executor === 'ms_client_credentials') {
      const minted = await mintMicrosoftToken(authCfg, tenantId)
      setHeader('Authorization', `Bearer ${minted.token}`)
      return { mintedTokenKey: minted.cacheKey }
    }
    if (executor === 'box_ccg') {
      const minted = await mintBoxToken(authCfg, tenantId)
      setHeader('Authorization', `Bearer ${minted.token}`)
      return { mintedTokenKey: minted.cacheKey }
    }
    if (executor === 'client_credentials') {
      const minted = await mintClientCredentialsToken(authCfg, tenantId)
      setHeader('Authorization', `Bearer ${minted.token}`)
      return { mintedTokenKey: minted.cacheKey }
    }
    if (executor === 'oauth_refresh' && authCfg?.refresh_token && authCfg?.token_url) {
      const minted = await mintFromRefreshToken(authCfg, tenantId)
      setHeader('Authorization', `Bearer ${minted.token}`)
      return { mintedTokenKey: minted.cacheKey }
    }
    if (authCfg?.token) setHeader('Authorization', `Bearer ${authCfg.token}`)
    return {}
  }

  if (integrationConfig?.auth_type === 'oauth2') {
    if (!ctx?.supabase) throw new Error('OAuth2 auth requires a Supabase context')
    const connectorId = authCfg?.connector_id
      ? String(authCfg.connector_id)
      : await resolveConnectorId(ctx.supabase, ctx.integrationId, tenantId)
    if (!connectorId) throw new Error('OAuth2 integration has no linked connector — reconnect the integration.')
    const token = await getFreshConnectorToken({ supabase: ctx.supabase, connectorId, tenantId })
    setHeader('Authorization', `Bearer ${token}`)
    return {}
  }

  if (integrationConfig?.auth_type === 'api_key' && authCfg?.key_value) {
    const addTo = authCfg.add_to ?? 'header'
    const keyName = String(authCfg.key_name || (addTo === 'query' ? 'api_key' : 'X-API-Key'))
    if (addTo === 'query') {
      if (query) query[keyName] = String(authCfg.key_value)
      return {}
    }
    let value = String(authCfg.key_value)
    // An "API key" aimed at the Authorization header is a bearer token in
    // disguise (common OpenAPI idiom). Sending it raw yields "malformed
    // Authorization header" 401s — add the scheme unless one is present.
    if (keyName.toLowerCase() === 'authorization' && !/^\s*(bearer|basic|token|sharedkey|apikey|api-key)\s/i.test(value)) {
      value = `Bearer ${value}`
    }
    setHeader(keyName, value)
    return {}
  }

  if (integrationConfig?.auth_type === 'basic' && authCfg?.username) {
    setHeader('Authorization', `Basic ${Buffer.from(`${authCfg.username}:${authCfg.password ?? ''}`).toString('base64')}`)
    if (authCfg._executor === 'ukg_pro' && authCfg.customer_api_key) {
      setHeader('US-Customer-Api-Key', String(authCfg.customer_api_key))
    }
  }
  return {}
}

/** Fall back to the connector linked to this integration when auth_config omits connector_id. */
async function resolveConnectorId(supabase: SupabaseClient, integrationId?: string | null, tenantId?: string | null): Promise<string | null> {
  if (!integrationId) return null
  let query = (supabase as any)
    .from('tenant_connectors')
    .select('id')
    .eq('integration_id', integrationId)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data } = await query.maybeSingle()
  return data?.id ? String(data.id) : null
}
