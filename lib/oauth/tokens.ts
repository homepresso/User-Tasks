import { createHash, randomBytes } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'

/**
 * Opaque OAuth artifacts: 256-bit random values, SHA-256 hashed at rest with
 * a UNIQUE index for direct lookup. No bcrypt on the request hot path —
 * full-entropy tokens cannot be brute-forced regardless of hash speed
 * (bcrypt's slowness only defends low-entropy human passwords).
 *
 * Prefix conventions (checked at the validateApiKey choke point):
 *   uoa_  access token          uor_  refresh token
 *   uoc_  authorization code    uocs_ client secret
 *   uocid_ client id (public, not secret)
 */

export type OAuthTokenPrefix = 'uoa_' | 'uor_' | 'uoc_' | 'uocs_' | 'uocid_' | 'uost_'

export function generateOAuthToken(prefix: OAuthTokenPrefix): string {
  return prefix + randomBytes(32).toString('base64url')
}

/** Hex SHA-256 of the FULL token string (prefix included). */
export function hashOAuthToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex')
}

/** Display-only prefix for admin lists — never used for lookup. */
export function displayPrefix(raw: string): string {
  return raw.slice(0, 12)
}

export interface OAuthTokenRow {
  id: string
  tenant_id: string
  token_type: 'access' | 'refresh'
  client_id: string
  user_id: string | null
  grant_type: string
  scopes: string[]
  refresh_parent: string | null
  expires_at: string
  revoked_at: string | null
}

/** Direct indexed lookup by hash. Returns null on miss. */
export async function lookupOAuthToken(
  supabase: SupabaseClient,
  raw: string,
  tokenType: 'access' | 'refresh',
): Promise<OAuthTokenRow | null> {
  const { data } = await (supabase as any)
    .from('oauth_tokens')
    .select('id, tenant_id, token_type, client_id, user_id, grant_type, scopes, refresh_parent, expires_at, revoked_at')
    .eq('token_hash', hashOAuthToken(raw))
    .eq('token_type', tokenType)
    .maybeSingle()
  return (data as OAuthTokenRow | null) ?? null
}

export interface IssuedToken {
  raw: string
  id: string
}

export async function insertToken(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    tokenType: 'access' | 'refresh'
    clientId: string
    userId?: string | null
    grantType: string
    scopes: string[]
    ttlSeconds: number
    refreshParent?: string | null
  },
): Promise<IssuedToken> {
  const raw = generateOAuthToken(params.tokenType === 'access' ? 'uoa_' : 'uor_')
  const { data, error } = await (supabase as any)
    .from('oauth_tokens')
    .insert({
      tenant_id: params.tenantId,
      token_type: params.tokenType,
      token_hash: hashOAuthToken(raw),
      token_prefix: displayPrefix(raw),
      client_id: params.clientId,
      user_id: params.userId ?? null,
      grant_type: params.grantType,
      scopes: params.scopes,
      refresh_parent: params.refreshParent ?? null,
      expires_at: new Date(Date.now() + params.ttlSeconds * 1000).toISOString(),
    })
    .select('id')
    .single()
  if (error) throw new Error(`token insert failed: ${error.message}`)
  return { raw, id: String((data as any).id) }
}

/**
 * Revoke a refresh token's whole rotation chain (descendants) — used when a
 * revoked refresh token is REPLAYED (theft signal) and by RFC 7009 revoke.
 */
export async function revokeRefreshChain(supabase: SupabaseClient, rootId: string): Promise<number> {
  let revoked = 0
  let frontier = [rootId]
  // Chains are short (one link per refresh); bounded walk.
  for (let depth = 0; depth < 50 && frontier.length > 0; depth++) {
    await (supabase as any)
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', frontier)
      .is('revoked_at', null)
    revoked += frontier.length
    const { data: children } = await (supabase as any)
      .from('oauth_tokens')
      .select('id')
      .in('refresh_parent', frontier)
    frontier = ((children ?? []) as any[]).map((row) => String(row.id))
  }
  await invalidateCredentialCache()
  return revoked
}
