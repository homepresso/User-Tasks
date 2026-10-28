import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/cron-auth'
import { decryptSensitiveFields, encryptSensitiveFields } from '@/lib/secret-fields'
import { hashOAuthToken } from '@/lib/oauth/tokens'
import { appBaseUrl } from '@/lib/oauth/redirect'
import { assertSafeEgressUrl } from '@/lib/egress-guard'

/**
 * OAuth CLIENT callback (Phase 2): the external provider redirects the browser
 * here with ?code&state. Public GET (no API key) — the one-time `state` is the
 * credential. We exchange the code for tokens and stash them (encrypted) on the
 * linked tenant_connectors row, then bounce the user back to the integration
 * settings page with a success/error flag. Never 500 to the user.
 */

function settleRedirect(target: string, flag: 'connected' | 'error', detail?: string): NextResponse {
  const base = appBaseUrl()
  // target is an app-relative path we control (from the state payload); default safe.
  const path = target && target.startsWith('/') ? target : '/integrations'
  const url = new URL(`${base}${path}`)
  url.searchParams.set('oauth', flag)
  if (detail) url.searchParams.set('oauth_error', detail.slice(0, 200))
  return NextResponse.redirect(url.toString())
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const providerError = searchParams.get('error')
  const providerErrorDesc = searchParams.get('error_description')

  // Provider-side denial/error. We still require state below so forged callback
  // URLs cannot inject error messages or leave a real authorization state live.
  if (providerError) {
    if (!state) return settleRedirect('/integrations', 'error', 'Missing OAuth state')
  }
  if ((!code && !providerError) || !state) {
    return settleRedirect('/integrations', 'error', 'Missing authorization code or state')
  }

  const supabase = createServiceClient()

  try {
    // Atomically consume the single-use state (unconsumed + unexpired).
    const nowIso = new Date().toISOString()
    const { data: stateRow } = await (supabase as any)
      .from('oauth_connect_states')
      .update({ consumed_at: nowIso })
      .eq('state_hash', hashOAuthToken(state))
      .eq('kind', 'connector_authorize')
      .is('consumed_at', null)
      .gt('expires_at', nowIso)
      .select('id, tenant_id, payload')
      .maybeSingle()

    if (!stateRow) {
      return settleRedirect('/integrations', 'error', 'This authorization link has expired or was already used')
    }

    const payload = decryptSensitiveFields((stateRow.payload ?? {}) as Record<string, any>) as Record<string, any>
    const connectorId = String(payload.connector_id ?? '')
    const codeVerifier = String(payload.code_verifier_secret ?? '')
    const redirectAfter = String(payload.redirect_after ?? '/integrations')

    if (providerError) {
      return settleRedirect(redirectAfter, 'error', providerErrorDesc || providerError)
    }
    // The initial request validation guarantees a code on non-error callbacks.
    const authorizationCode = code as string

    if (!connectorId || !codeVerifier) {
      return settleRedirect(redirectAfter, 'error', 'Malformed authorization state')
    }

    // Load the connector (token store) for the token endpoint + client creds.
    const { data: connector } = await (supabase as any)
      .from('tenant_connectors')
      .select('id, tenant_id, connector_key, config, credentials')
      .eq('id', connectorId)
      .eq('tenant_id', stateRow.tenant_id)
      .maybeSingle()

    if (!connector) {
      return settleRedirect(redirectAfter, 'error', 'Connector not found')
    }

    const connectorConfig = (connector.config ?? {}) as Record<string, any>
    const connectorCreds = decryptSensitiveFields((connector.credentials ?? {}) as Record<string, any>) as Record<string, any>

    const tokenUrl = String(connectorConfig.token_url ?? '')
    const clientId = String(connectorConfig.client_id ?? '')
    const clientSecret = String(connectorCreds.client_secret ?? '')
    if (!tokenUrl) {
      return settleRedirect(redirectAfter, 'error', 'Connector is missing token URL')
    }

    await assertSafeEgressUrl(tokenUrl)

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: `${appBaseUrl()}/api/connectors/oauth/callback`,
      code_verifier: codeVerifier,
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
        const errPayload = await res.json()
        detail = errPayload?.error_description || errPayload?.error || detail
      } catch { /* keep status */ }
      return settleRedirect(redirectAfter, 'error', `Token exchange failed: ${detail}`)
    }

    const tokenPayload = await res.json()
    const accessToken = String(tokenPayload?.access_token ?? '')
    if (!accessToken) {
      return settleRedirect(redirectAfter, 'error', 'Provider returned no access token')
    }
    const refreshToken = tokenPayload?.refresh_token ? String(tokenPayload.refresh_token) : undefined
    const expiresIn = Number(tokenPayload?.expires_in ?? 3600)
    const expiresAt = new Date(Date.now() + Math.max(expiresIn, 0) * 1000).toISOString()

    // Persist tokens (encrypted) + expiry via the race-free merge RPCs.
    const credentialPatch = encryptSensitiveFields(
      refreshToken
        ? { access_token: accessToken, refresh_token: refreshToken }
        : { access_token: accessToken },
    ) as Record<string, any>

    const { error: credErr } = await (supabase as any).rpc('merge_tenant_connector_credentials', {
      p_connector_id: connectorId,
      p_patch: credentialPatch,
    })
    if (credErr) {
      return settleRedirect(redirectAfter, 'error', 'Failed to store tokens')
    }

    await (supabase as any).rpc('merge_tenant_connector_config', {
      p_tenant_id: connector.tenant_id,
      p_connector_key: connector.connector_key,
      p_patch: { expires_at: expiresAt },
    })

    return settleRedirect(redirectAfter, 'connected')
  } catch (e: any) {
    return settleRedirect('/integrations', 'error', e?.message ?? 'OAuth callback failed')
  }
}
