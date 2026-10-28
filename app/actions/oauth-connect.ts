'use server'

import { randomBytes } from 'crypto'
import { createClient, getCachedUser } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/permissions-server'
import { getCurrentTenantId, getOwnedIntegration } from '@/lib/integrations/auth'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { generateOAuthToken, hashOAuthToken } from '@/lib/oauth/tokens'
import { computeS256Challenge } from '@/lib/oauth/pkce'
import { appBaseUrl } from '@/lib/oauth/redirect'
import { assertSafeEgressUrl } from '@/lib/egress-guard'

/**
 * Phase-2 OAuth CLIENT connect flow: kick off the authorization-code grant so a
 * tenant integration can authenticate to an EXTERNAL system. Tokens land on a
 * linked `tenant_connectors` row (the token store); the PKCE verifier is parked
 * (encrypted) in `oauth_connect_states` keyed by a hashed one-time state.
 */

const CALLBACK_PATH = '/api/connectors/oauth/callback'

/** RFC 7636 verifier: 43–128 chars of [A-Za-z0-9-._~]. base64url of 48 bytes = 64 chars. */
function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url')
}

function normalizeScopes(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((s) => String(s)).filter(Boolean)
  if (typeof raw === 'string') return raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean)
  return []
}

export async function startConnectorOAuth(integrationId: string): Promise<string> {
  await requirePermission('integrations.edit')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const tenantId = await getCurrentTenantId(supabase, user.id)
  if (!tenantId) throw new Error('No tenant')

  const integration = await getOwnedIntegration(supabase, tenantId, integrationId)
  const config = decryptSensitiveFields((integration as any).config ?? {}) as Record<string, any>
  const authCfg = (config.auth_config ?? {}) as Record<string, any>

  const authorizeUrl = String(authCfg.authorize_url ?? '').trim()
  const tokenUrl = String(authCfg.token_url ?? '').trim()
  const clientId = String(authCfg.client_id ?? '').trim()
  const clientSecret = String(authCfg.client_secret ?? '')
  const scopes = normalizeScopes(authCfg.scopes)
  const provider = String(authCfg.provider ?? '').trim().toLowerCase()

  if (!authorizeUrl) throw new Error('OAuth authorize URL is required')
  if (!tokenUrl) throw new Error('OAuth token URL is required')
  if (!clientId) throw new Error('OAuth client ID is required')

  // Both endpoints are tenant-controlled. The authorize endpoint is opened in
  // the browser, while token_url is called by our servers during exchange and
  // refresh, so validate both up front and re-check token_url at fetch time.
  await assertSafeEgressUrl(authorizeUrl)
  await assertSafeEgressUrl(tokenUrl)

  // Find or create the tenant_connectors row that will hold the tokens.
  const { data: existingConnector } = await (supabase as any)
    .from('tenant_connectors')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('integration_id', integrationId)
    .maybeSingle()

  const connectorConfig = {
    authorize_url: authorizeUrl,
    token_url: tokenUrl,
    client_id: clientId,
    scopes,
    provider,
  }
  const connectorCredentials = encryptSensitiveFields(
    clientSecret ? { client_secret: clientSecret } : {},
  ) as Record<string, any>

  let connectorId: string
  if (existingConnector?.id) {
    connectorId = String(existingConnector.id)
    // Merge the latest OAuth params (client_id / urls / scopes may have been edited).
    await (supabase as any).rpc('merge_tenant_connector_config', {
      p_tenant_id: tenantId,
      p_connector_key: `oauth2:${integrationId}`,
      p_patch: connectorConfig,
    })
    // The config merge targets by connector_key — also patch the row directly by id
    // in case this connector predates the oauth2 key (e.g. a preset connector).
    await (supabase as any)
      .from('tenant_connectors')
      .update({ config: connectorConfig, updated_at: new Date().toISOString() })
      .eq('id', connectorId)
      .eq('tenant_id', tenantId)
    if (clientSecret) {
      await (supabase as any).rpc('merge_tenant_connector_credentials', {
        p_connector_id: connectorId,
        p_patch: connectorCredentials,
      })
    }
  } else {
    const { data: created, error: createErr } = await (supabase as any)
      .from('tenant_connectors')
      .insert({
        tenant_id: tenantId,
        connector_key: `oauth2:${integrationId}`,
        display_name: `${(integration as any).name ?? 'Integration'} (OAuth)`,
        config: connectorConfig,
        credentials: connectorCredentials,
        integration_id: integrationId,
        is_enabled: true,
        created_by: user.id,
      })
      .select('id')
      .single()
    if (createErr) throw new Error(`Failed to create OAuth connector: ${createErr.message}`)
    connectorId = String(created.id)
  }

  // One-time state + PKCE. The verifier is parked (encrypted) DB-side, not in a
  // cookie — serverless has no session affinity across the external redirect.
  const state = generateOAuthToken('uost_')
  const codeVerifier = generateCodeVerifier()
  const codeChallenge = computeS256Challenge(codeVerifier)

  const payload = encryptSensitiveFields({
    integration_id: integrationId,
    connector_id: connectorId,
    // Key name ends in "_secret" so isSensitiveKey encrypts it at rest.
    code_verifier_secret: codeVerifier,
    redirect_after: `/integrations/${integrationId}`,
  })

  const { error: stateErr } = await (supabase as any)
    .from('oauth_connect_states')
    .insert({
      tenant_id: tenantId,
      kind: 'connector_authorize',
      state_hash: hashOAuthToken(state),
      payload,
      user_id: user.id,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
  if (stateErr) throw new Error(`Failed to start OAuth flow: ${stateErr.message}`)

  // Build the provider authorize URL.
  const url = new URL(authorizeUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', `${appBaseUrl()}${CALLBACK_PATH}`)
  if (scopes.length > 0) url.searchParams.set('scope', scopes.join(' '))
  url.searchParams.set('state', state)
  url.searchParams.set('code_challenge', codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')

  // Provider-configurable extras. Google needs offline access + a forced consent
  // prompt to return a refresh token.
  const extraParams: Record<string, string> = {}
  if (provider === 'google') {
    extraParams.access_type = 'offline'
    extraParams.prompt = 'consent'
  }
  if (authCfg.extra_authorize_params && typeof authCfg.extra_authorize_params === 'object') {
    for (const [k, v] of Object.entries(authCfg.extra_authorize_params as Record<string, unknown>)) {
      extraParams[k] = String(v)
    }
  }
  for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, v)

  return url.toString()
}
