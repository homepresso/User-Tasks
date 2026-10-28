'use server'

import { createClient } from '@/lib/supabase/server'
import { getServiceDb } from '@/lib/providers/db'
import { requirePermission } from '@/lib/permissions-server'
import { writeAudit } from '@/lib/audit-log'
import { generateOAuthToken, hashOAuthToken } from '@/lib/oauth/tokens'
import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { OAUTH_SCOPES, withoutFirstPartyScopes } from '@/lib/oauth/scopes'
import { isRegistrableRedirectUri } from '@/lib/oauth/redirect'
import { requireTenant } from '@/lib/actions/require-tenant'

/**
 * OAuth app (client) management. Mirrors the API-keys settings surface:
 * per-tenant registration, show-once secrets, revoke-all-tokens.
 * Writes use the service client (oauth_clients rows for DCR clients are
 * tenant-NULL, and hashes must never transit RLS-readable selects).
 */

function service() {
  return getServiceDb()
}

export interface OAuthClientSummary {
  id: string
  client_id: string
  name: string
  client_type: 'confidential' | 'public'
  grant_types: string[]
  redirect_uris: string[]
  allowed_scopes: string[]
  is_dynamic: boolean
  created_at: string
  revoked_at: string | null
  active_tokens: number
  last_used_at: string | null
}

export async function listOAuthClients(): Promise<OAuthClientSummary[]> {
  await requirePermission('settings.manage_api_keys')
  const { tenantId } = await requireTenant()
  const supabase = service()

  const { data: clients } = await (supabase as any)
    .from('oauth_clients')
    .select('id, client_id, name, client_type, grant_types, redirect_uris, allowed_scopes, is_dynamic, created_at, revoked_at')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(100)

  const rows = (clients ?? []) as any[]
  if (rows.length === 0) return []

  const { data: tokenStats } = await (supabase as any)
    .from('oauth_tokens')
    .select('client_id, last_used_at')
    .in('client_id', rows.map((c) => c.client_id))
    .is('revoked_at', null)
    .gt('expires_at', new Date().toISOString())

  const stats = new Map<string, { count: number; last: string | null }>()
  for (const token of (tokenStats ?? []) as any[]) {
    const entry = stats.get(token.client_id) ?? { count: 0, last: null }
    entry.count += 1
    if (token.last_used_at && (!entry.last || token.last_used_at > entry.last)) entry.last = token.last_used_at
    stats.set(token.client_id, entry)
  }

  return rows.map((client) => ({
    ...client,
    active_tokens: stats.get(client.client_id)?.count ?? 0,
    last_used_at: stats.get(client.client_id)?.last ?? null,
  })) as OAuthClientSummary[]
}

export async function createOAuthClient(input: {
  name: string
  clientType: 'confidential' | 'public'
  grantTypes: string[]
  redirectUris: string[]
  allowedScopes: string[]
}): Promise<{ clientId: string; clientSecret: string | null }> {
  await requirePermission('settings.manage_api_keys')
  const { user, tenantId } = await requireTenant()
  const supabase = service()

  const name = input.name.trim()
  if (!name) throw new Error('App name is required')

  const grantTypes = input.grantTypes.filter((grant) =>
    ['authorization_code', 'client_credentials', 'refresh_token'].includes(grant))
  if (grantTypes.length === 0) throw new Error('Choose at least one grant type')
  if (grantTypes.includes('client_credentials') && input.clientType !== 'confidential') {
    throw new Error('Client credentials requires a confidential client')
  }

  const redirectUris = input.redirectUris.map((uri) => uri.trim()).filter(Boolean)
  if (grantTypes.includes('authorization_code')) {
    if (redirectUris.length === 0) throw new Error('Authorization code flow requires at least one redirect URI')
    const bad = redirectUris.find((uri) => !isRegistrableRedirectUri(uri))
    if (bad) throw new Error(`Redirect URI must be https (or http://localhost): ${bad}`)
  }

  // First-party-only scopes (keys:write) can't be granted to tenant-registered apps.
  const allowedScopes = withoutFirstPartyScopes(input.allowedScopes).filter((scope) => OAUTH_SCOPES.includes(scope))
  if (allowedScopes.length === 0) throw new Error('Choose at least one scope')

  const clientId = generateOAuthToken('uocid_')
  const clientSecret = input.clientType === 'confidential' ? generateOAuthToken('uocs_') : null

  const { error } = await (supabase as any).from('oauth_clients').insert({
    tenant_id: tenantId,
    client_id: clientId,
    client_secret_hash: clientSecret ? hashOAuthToken(clientSecret) : null,
    name,
    client_type: input.clientType,
    grant_types: grantTypes,
    redirect_uris: redirectUris,
    allowed_scopes: allowedScopes,
    created_by: user.id,
  })
  if (error) throw new Error(error.message)

  await writeAudit({
    supabase: supabase as any, tenantId, actorId: user.id,
    objectType: 'oauth_client', objectId: clientId,
    action: 'create', summary: `Registered OAuth app "${name}" (${input.clientType}, ${grantTypes.join('/')})`,
    metadata: { scopes: allowedScopes },
  })

  // Secret is shown ONCE — never persisted in plaintext.
  return { clientId, clientSecret }
}

export async function rotateOAuthClientSecret(clientId: string): Promise<{ clientSecret: string }> {
  await requirePermission('settings.manage_api_keys')
  const { user, tenantId } = await requireTenant()
  const supabase = service()

  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('id, name, client_type')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!client) throw new Error('OAuth app not found')
  if (client.client_type !== 'confidential') throw new Error('Public clients have no secret')

  const clientSecret = generateOAuthToken('uocs_')
  const { error } = await (supabase as any)
    .from('oauth_clients')
    .update({ client_secret_hash: hashOAuthToken(clientSecret) })
    .eq('id', client.id)
  if (error) throw new Error(error.message)

  await writeAudit({
    supabase: supabase as any, tenantId, actorId: user.id,
    objectType: 'oauth_client', objectId: clientId,
    action: 'update', summary: `Rotated client secret for OAuth app "${client.name}"`,
  })
  return { clientSecret }
}

export async function revokeOAuthClient(clientId: string): Promise<void> {
  await requirePermission('settings.manage_api_keys')
  const { user, tenantId } = await requireTenant()
  const supabase = service()

  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!client) throw new Error('OAuth app not found')

  const now = new Date().toISOString()
  await (supabase as any).from('oauth_clients').update({ revoked_at: now }).eq('id', client.id)
  // Belt and braces: validation checks client.revoked_at too, but revoking
  // the rows keeps admin token counts honest.
  await (supabase as any).from('oauth_tokens').update({ revoked_at: now }).eq('client_id', clientId).is('revoked_at', null)
  await invalidateCredentialCache()
  await (supabase as any).from('oauth_authorization_codes').update({ consumed_at: now }).eq('client_id', clientId).is('consumed_at', null)

  await writeAudit({
    supabase: supabase as any, tenantId, actorId: user.id,
    objectType: 'oauth_client', objectId: clientId,
    action: 'revoke', summary: `Revoked OAuth app "${client.name}" and all its tokens`,
  })
}

export async function revokeOAuthClientTokens(clientId: string): Promise<{ revoked: number }> {
  await requirePermission('settings.manage_api_keys')
  const { user, tenantId } = await requireTenant()
  const supabase = service()

  const { data: client } = await (supabase as any)
    .from('oauth_clients')
    .select('id, name')
    .eq('tenant_id', tenantId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!client) throw new Error('OAuth app not found')

  const { data: revoked } = await (supabase as any)
    .from('oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .select('id')
  await invalidateCredentialCache()

  await writeAudit({
    supabase: supabase as any, tenantId, actorId: user.id,
    objectType: 'oauth_client', objectId: clientId,
    action: 'revoke', summary: `Revoked all active tokens for OAuth app "${client.name}"`,
  })
  return { revoked: (revoked ?? []).length }
}
