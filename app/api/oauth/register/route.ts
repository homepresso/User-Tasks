import { NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/providers/db'
import { generateOAuthToken } from '@/lib/oauth/tokens'
import { OAUTH_SCOPES, requestsFirstPartyScope, withoutFirstPartyScopes } from '@/lib/oauth/scopes'
import { isRegistrableRedirectUri } from '@/lib/oauth/redirect'
import { oauthError, oauthJson, oauthOptions, OAUTH_CORS_HEADERS } from '@/lib/oauth/errors'

export const dynamic = 'force-dynamic'

/**
 * RFC 7591 Dynamic Client Registration — for MCP clients (claude.ai) that
 * self-register. Registered clients are PKCE-only PUBLIC clients (no secret),
 * restricted to authorization_code + refresh_token, and TENANT-NULL until a
 * user consents (consent pins the tenant on the issued code/tokens). They can
 * never obtain client_credentials, the `admin` scope or first-party-only
 * scopes (`keys:write`).
 *
 * Rate limited via DB row counts (per-IP and global hourly) since it PERSISTS
 * rows — a per-instance in-memory limiter would multiply by instance count.
 */

const PER_IP_HOURLY = 5
const GLOBAL_HOURLY = 200

function service() {
  return getServiceDb()
}

export async function OPTIONS() {
  return oauthOptions()
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return oauthError('invalid_request', 'Body must be JSON')
  }

  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const supabase = service()
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()

  const [{ count: perIp }, { count: global }] = await Promise.all([
    (supabase as any).from('oauth_clients').select('*', { count: 'exact', head: true })
      .eq('is_dynamic', true).eq('created_ip', ip).gt('created_at', hourAgo),
    (supabase as any).from('oauth_clients').select('*', { count: 'exact', head: true })
      .eq('is_dynamic', true).gt('created_at', hourAgo),
  ])
  if ((perIp ?? 0) >= PER_IP_HOURLY || (global ?? 0) >= GLOBAL_HOURLY) {
    return new Response(JSON.stringify({ error: 'invalid_request', error_description: 'Registration rate limit exceeded' }), {
      status: 429,
      headers: { ...OAUTH_CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const name = String(body.client_name ?? '').trim() || 'MCP client'
  const redirectUris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris.map((u: unknown) => String(u)) : []
  if (redirectUris.length === 0) return oauthError('invalid_request', 'redirect_uris is required')
  const badUri = redirectUris.find((u) => !isRegistrableRedirectUri(u))
  if (badUri) return oauthError('invalid_request', `redirect_uri must be https (or http://localhost): ${badUri}`)

  // Restrict grants: DCR clients are auth-code + refresh only.
  const requestedGrants: string[] = Array.isArray(body.grant_types) ? body.grant_types : ['authorization_code']
  const grantTypes = requestedGrants.filter((g) => ['authorization_code', 'refresh_token'].includes(g))
  if (!grantTypes.includes('authorization_code')) grantTypes.push('authorization_code')

  // Scopes: requested ∩ known, minus admin. Explicitly asking for a
  // first-party-only scope is an error (not silently dropped) so the client
  // knows it will never get it.
  const requestedScopes = String(body.scope ?? '').split(/\s+/).filter(Boolean)
  if (requestsFirstPartyScope(requestedScopes)) {
    return oauthError('invalid_client_metadata', 'keys:write is only available to first-party clients')
  }
  const allowedScopes = withoutFirstPartyScopes(requestedScopes.length > 0 ? requestedScopes : OAUTH_SCOPES)
    .filter((s) => OAUTH_SCOPES.includes(s) && s !== 'admin')
  if (allowedScopes.length === 0) allowedScopes.push('mcp')

  const clientId = generateOAuthToken('uocid_')
  const { error } = await (supabase as any).from('oauth_clients').insert({
    tenant_id: null,
    client_id: clientId,
    client_secret_hash: null,
    name,
    client_type: 'public',
    grant_types: grantTypes,
    redirect_uris: redirectUris,
    allowed_scopes: allowedScopes,
    is_dynamic: true,
    created_ip: ip,
  })
  if (error) return oauthError('server_error', 'Registration failed')

  return oauthJson({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: allowedScopes.join(' '),
  }, 201)
}
