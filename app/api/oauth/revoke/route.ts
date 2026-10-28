import { NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/providers/db'
import { hashOAuthToken, lookupOAuthToken, revokeRefreshChain } from '@/lib/oauth/tokens'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { oauthError, oauthJson, oauthOptions } from '@/lib/oauth/errors'
import { auditOAuthEvent, grantName } from '@/lib/oauth/audit'

export const dynamic = 'force-dynamic'

/**
 * RFC 7009 token revocation. Client-authenticated; always returns 200 for a
 * valid client (even if the token is unknown/already-revoked) so callers can't
 * probe token validity. Revoking a refresh token cascades its rotation chain.
 */

function service() {
  return getServiceDb()
}

export async function OPTIONS() {
  return oauthOptions()
}

export async function POST(request: NextRequest) {
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await request.text())
  } catch {
    return oauthError('invalid_request')
  }

  // Client auth: Basic header or form fields.
  let clientId = form.get('client_id') ?? ''
  let clientSecret = form.get('client_secret')
  const header = request.headers.get('Authorization')
  if (header?.startsWith('Basic ')) {
    try {
      const [id, ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':')
      clientId = decodeURIComponent(id ?? '')
      clientSecret = decodeURIComponent(rest.join(':') ?? '') || null
    } catch { /* fall through */ }
  }
  if (!clientId) return oauthError('invalid_client')

  const supabase = service()
  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('client_id, tenant_id, client_secret_hash, client_type')
    .eq('client_id', clientId)
    .maybeSingle()
  if (!client) return oauthError('invalid_client')
  if (client.client_type === 'confidential') {
    if (!clientSecret || !client.client_secret_hash || hashOAuthToken(clientSecret) !== client.client_secret_hash) {
      return oauthError('invalid_client')
    }
  }

  const rawToken = form.get('token') ?? ''
  if (!rawToken) return oauthJson({}) // nothing to do; still 200

  // Only revoke tokens belonging to THIS client.
  const type = rawToken.startsWith('uor_') ? 'refresh' : 'access'
  const row = await lookupOAuthToken(supabase, rawToken, type)
  if (row && row.client_id === client.client_id && !row.revoked_at) {
    if (type === 'refresh') {
      await revokeRefreshChain(supabase, row.id)
    } else {
      await (supabase as any).from('oauth_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', row.id)
      await invalidateCredentialCache()
    }
    await auditOAuthEvent({
      supabase: supabase as any, tenantId: row.tenant_id, actorId: row.user_id, clientId: client.client_id,
      event: 'token_revoked', action: 'revoke', tokenType: type, grantType: grantName(row.grant_type),
      summary: `Revoked an OAuth ${type} token`,
    })
  }

  return oauthJson({})
}
