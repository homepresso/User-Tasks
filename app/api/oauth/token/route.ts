import { NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/providers/db'
import { rateLimit } from '@/lib/rate-limit'
import { hashOAuthToken, insertToken, lookupOAuthToken, revokeRefreshChain } from '@/lib/oauth/tokens'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { parseScopeParam, scopesAllowed } from '@/lib/oauth/scopes'
import { verifyPkce } from '@/lib/oauth/pkce'
import { appBaseUrl } from '@/lib/oauth/redirect'
import { oauthError, oauthJson, oauthOptions } from '@/lib/oauth/errors'
import { auditOAuthEvent, grantName } from '@/lib/oauth/audit'

export const dynamic = 'force-dynamic'

const ACCESS_TTL_SECONDS = 3600           // 1 hour
const REFRESH_TTL_SECONDS = 30 * 86400    // 30 days

// Note: in-memory limiter is per-instance (interim, documented in
// lib/rate-limit.ts). Acceptable here — all secrets are full-entropy — this
// throttles abuse/cost, not brute force. Graduates to Redis with rate-limit.ts.
const RATE_MAX = 30
const RATE_WINDOW_MS = 60_000

function service() {
  return getServiceDb()
}

/** Client auth via client_secret_basic (RFC 6749 required) or client_secret_post. */
function extractClientAuth(request: NextRequest, form: URLSearchParams): { clientId: string; clientSecret: string | null } {
  const header = request.headers.get('Authorization')
  if (header?.startsWith('Basic ')) {
    try {
      const [id, ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')
      return { clientId: decodeURIComponent(id ?? ''), clientSecret: decodeURIComponent(rest.join(':') ?? '') || null }
    } catch { /* fall through to post */ }
  }
  return { clientId: form.get('client_id') ?? '', clientSecret: form.get('client_secret') }
}

/** RFC 8707 resource parameter: if present it must name our API/MCP surface. */
function resourceAllowed(form: URLSearchParams): boolean {
  const resource = form.get('resource')
  if (!resource) return true
  const base = appBaseUrl()
  return resource === base || resource.startsWith(`${base}/api/`)
}

export async function OPTIONS() {
  return oauthOptions()
}

export async function POST(request: NextRequest) {
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await request.text())
  } catch {
    return oauthError('invalid_request', 'Body must be application/x-www-form-urlencoded')
  }

  const grantType = form.get('grant_type') ?? ''
  const { clientId, clientSecret } = extractClientAuth(request, form)
  if (!clientId) return oauthError('invalid_client')

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!(await rateLimit(`oauth-token:${clientId}:${ip}`, { max: RATE_MAX, windowMs: RATE_WINDOW_MS })).ok) {
    return oauthError('invalid_request', 'Rate limit exceeded — retry later')
  }
  if (!resourceAllowed(form)) return oauthError('invalid_target')

  const supabase = service()
  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('id, tenant_id, client_id, client_secret_hash, client_type, grant_types, allowed_scopes, revoked_at, created_by')
    .eq('client_id', clientId)
    .maybeSingle()

  // Identical response for unknown client vs wrong secret (no enumeration).
  if (!client || client.revoked_at) return oauthError('invalid_client')

  const isConfidential = client.client_type === 'confidential'
  if (isConfidential) {
    if (!clientSecret || !client.client_secret_hash) return oauthError('invalid_client')
    if (hashOAuthToken(clientSecret) !== client.client_secret_hash) return oauthError('invalid_client')
  }

  const grantTypes: string[] = Array.isArray(client.grant_types) ? client.grant_types : []

  // ── client_credentials ──────────────────────────────────────────────────
  if (grantType === 'client_credentials') {
    // Machine tokens require a confidential, tenant-bound client.
    if (!isConfidential || !client.tenant_id) return oauthError('unauthorized_client')
    if (!grantTypes.includes('client_credentials')) return oauthError('unauthorized_client')

    const requested = parseScopeParam(form.get('scope'))
    const scopes = requested.length > 0 ? requested : (client.allowed_scopes ?? [])
    if (!scopesAllowed(scopes, client.allowed_scopes ?? [])) return oauthError('invalid_scope')

    const access = await insertToken(supabase, {
      tenantId: client.tenant_id,
      tokenType: 'access',
      clientId: client.client_id,
      grantType: 'client_credentials',
      scopes,
      ttlSeconds: ACCESS_TTL_SECONDS,
    })
    await auditOAuthEvent({
      supabase, tenantId: client.tenant_id, actorId: null, clientId: client.client_id,
      event: 'token_issued', action: 'grant', grantType: 'client_credentials', scopes,
      summary: 'Issued an OAuth access token (client_credentials)',
    })
    return oauthJson({
      access_token: access.raw,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      scope: scopes.join(' '),
    })
  }

  // ── authorization_code ──────────────────────────────────────────────────
  if (grantType === 'authorization_code') {
    if (!grantTypes.includes('authorization_code')) return oauthError('unauthorized_client')
    const code = form.get('code') ?? ''
    const redirectUri = form.get('redirect_uri') ?? ''
    const codeVerifier = form.get('code_verifier') ?? ''
    if (!code || !redirectUri || !codeVerifier) return oauthError('invalid_request')

    const { data: codeRow } = await (supabase as any)
      .from('oauth_authorization_codes')
      .select('*')
      .eq('code_hash', hashOAuthToken(code))
      .maybeSingle()

    // All grant failures collapse to invalid_grant — never reveal which check failed.
    if (!codeRow || codeRow.client_id !== client.client_id || codeRow.redirect_uri !== redirectUri) {
      return oauthError('invalid_grant')
    }
    if (codeRow.consumed_at) {
      // Replayed code: revoke everything issued from it (theft signal).
      await (supabase as any)
        .from('oauth_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('client_id', client.client_id)
        .eq('grant_type', `authorization_code:${codeRow.id}`)
        .is('revoked_at', null)
      await invalidateCredentialCache()
      await auditOAuthEvent({
        supabase, tenantId: codeRow.tenant_id, actorId: codeRow.user_id, clientId: client.client_id,
        event: 'code_replay', action: 'revoke',
        summary: 'OAuth authorization code replay detected — issued tokens revoked',
      })
      return oauthError('invalid_grant')
    }
    if (new Date(codeRow.expires_at) < new Date()) return oauthError('invalid_grant')
    if (!verifyPkce(codeVerifier, codeRow.code_challenge, codeRow.code_challenge_method)) {
      return oauthError('invalid_grant')
    }

    // Atomic single-use: only proceed if WE consumed it.
    const { data: consumed } = await (supabase as any)
      .from('oauth_authorization_codes')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', codeRow.id)
      .is('consumed_at', null)
      .select('id')
    if (!consumed || consumed.length === 0) return oauthError('invalid_grant')

    const scopes: string[] = Array.isArray(codeRow.scopes) ? codeRow.scopes : []
    const access = await insertToken(supabase, {
      tenantId: codeRow.tenant_id,
      tokenType: 'access',
      clientId: client.client_id,
      userId: codeRow.user_id,
      grantType: `authorization_code:${codeRow.id}`,
      scopes,
      ttlSeconds: ACCESS_TTL_SECONDS,
    })
    const refresh = await insertToken(supabase, {
      tenantId: codeRow.tenant_id,
      tokenType: 'refresh',
      clientId: client.client_id,
      userId: codeRow.user_id,
      grantType: `authorization_code:${codeRow.id}`,
      scopes,
      ttlSeconds: REFRESH_TTL_SECONDS,
    })
    await auditOAuthEvent({
      supabase, tenantId: codeRow.tenant_id, actorId: codeRow.user_id, clientId: client.client_id,
      event: 'token_issued', action: 'grant', grantType: 'authorization_code', scopes,
      summary: 'Issued OAuth access and refresh tokens (authorization_code)',
    })
    return oauthJson({
      access_token: access.raw,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh.raw,
      scope: scopes.join(' '),
    })
  }

  // ── refresh_token (rotation + reuse detection) ──────────────────────────
  if (grantType === 'refresh_token') {
    if (!grantTypes.includes('refresh_token')) return oauthError('unauthorized_client')
    const presented = form.get('refresh_token') ?? ''
    if (!presented.startsWith('uor_')) return oauthError('invalid_grant')

    const row = await lookupOAuthToken(supabase, presented, 'refresh')
    if (!row || row.client_id !== client.client_id) return oauthError('invalid_grant')

    if (row.revoked_at) {
      // Reuse of a rotated/revoked refresh token — revoke the whole chain.
      await revokeRefreshChain(supabase, row.id)
      await auditOAuthEvent({
        supabase, tenantId: row.tenant_id, actorId: row.user_id, clientId: client.client_id,
        event: 'refresh_reuse', action: 'revoke', grantType: grantName(row.grant_type),
        summary: 'OAuth refresh token reuse detected — token chain revoked',
      })
      return oauthError('invalid_grant')
    }
    if (new Date(row.expires_at) < new Date()) return oauthError('invalid_grant')

    // Rotate: revoke the presented token, issue a fresh pair linked to it.
    await (supabase as any)
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', row.id)

    const scopes = row.scopes ?? []
    const access = await insertToken(supabase, {
      tenantId: row.tenant_id,
      tokenType: 'access',
      clientId: client.client_id,
      userId: row.user_id,
      grantType: row.grant_type,
      scopes,
      ttlSeconds: ACCESS_TTL_SECONDS,
      refreshParent: row.id,
    })
    const refresh = await insertToken(supabase, {
      tenantId: row.tenant_id,
      tokenType: 'refresh',
      clientId: client.client_id,
      userId: row.user_id,
      grantType: row.grant_type,
      scopes,
      ttlSeconds: REFRESH_TTL_SECONDS,
      refreshParent: row.id,
    })
    await auditOAuthEvent({
      supabase, tenantId: row.tenant_id, actorId: row.user_id, clientId: client.client_id,
      event: 'token_issued', action: 'grant', grantType: 'refresh_token', scopes: scopes as string[],
      summary: 'Refreshed OAuth tokens (refresh_token)',
    })
    return oauthJson({
      access_token: access.raw,
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refresh.raw,
      scope: (scopes as string[]).join(' '),
    })
  }

  return oauthError('unsupported_grant_type')
}
