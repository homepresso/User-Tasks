import type { SupabaseClient } from '@supabase/supabase-js'
import { generateOAuthToken, hashOAuthToken } from './tokens'

/**
 * Provider-side helpers shared by the authorize endpoint and the consent
 * server actions. Consent requests are stored server-side (oauth_connect_states,
 * kind='provider_consent') and referenced only by an opaque single-use id —
 * the consent form never carries client_id/scope/redirect_uri, so it can't be
 * forged or replayed.
 */

export interface ConsentPayload {
  client_id: string
  client_name: string
  /** Shown on the consent screen (verified badge / unverified label). Absent on pre-existing requests. */
  client_first_party?: boolean
  client_dynamic?: boolean
  redirect_uri: string
  scopes: string[]
  state: string | null
  code_challenge: string
  code_challenge_method: string
  tenant_id: string
  resource: string | null
}

/**
 * Determine the tenant a consent binds to, and verify the user may act there.
 * - Tenant-bound client: the user MUST be an active member of the client's
 *   tenant; the code is pinned to it (a tenant-An app can't mint tenant-B tokens).
 * - Tenant-less client (dynamic DCR clients and the first-party CLI): bind to
 *   the user's current workspace; issued codes/tokens carry that tenant.
 * Returns null when the user isn't authorized for the required tenant.
 */
export async function resolveConsentTenant(
  supabase: SupabaseClient,
  client: { tenant_id: string | null; is_dynamic: boolean },
  userId: string,
): Promise<string | null> {
  const { data: userRow } = await (supabase as any)
    .from('users')
    .select('id, tenant_id, current_tenant_id')
    .eq('id', userId)
    .maybeSingle()
  if (!userRow) return null
  const homeTenant = (userRow as any).current_tenant_id ?? (userRow as any).tenant_id

  if (!client.tenant_id) {
    // Tenant-less client: the consenting user's active workspace.
    return homeTenant ? String(homeTenant) : null
  }

  // Tenant-bound client: require active membership (or it being the home tenant).
  const target = String(client.tenant_id)
  if (String(homeTenant) === target) return target
  const { data: membership } = await (supabase as any)
    .from('user_memberships')
    .select('id')
    .eq('user_id', userId)
    .eq('tenant_id', target)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  return membership ? target : null
}

/** Store a validated authorize request; return the opaque request id. */
export async function createConsentRequest(
  supabase: SupabaseClient,
  userId: string,
  payload: ConsentPayload,
): Promise<string> {
  const requestId = generateOAuthToken('uost_')
  await (supabase as any).from('oauth_connect_states').insert({
    tenant_id: payload.tenant_id,
    kind: 'provider_consent',
    state_hash: hashOAuthToken(requestId),
    payload,
    user_id: userId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  return requestId
}

/** Load an unconsumed, unexpired consent request that belongs to this user. */
export async function loadConsentRequest(
  supabase: SupabaseClient,
  requestId: string,
  userId: string,
): Promise<{ id: string; payload: ConsentPayload } | null> {
  const { data } = await (supabase as any)
    .from('oauth_connect_states')
    .select('id, payload, user_id, expires_at, consumed_at')
    .eq('state_hash', hashOAuthToken(requestId))
    .eq('kind', 'provider_consent')
    .maybeSingle()
  if (!data) return null
  if ((data as any).user_id !== userId) return null
  if ((data as any).consumed_at) return null
  if (new Date((data as any).expires_at) < new Date()) return null
  return { id: String((data as any).id), payload: (data as any).payload as ConsentPayload }
}

/** Atomically mark a consent request consumed. Returns false if already used. */
export async function consumeConsentRequest(supabase: SupabaseClient, id: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from('oauth_connect_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', id)
    .is('consumed_at', null)
    .select('id')
  return Boolean(data && data.length > 0)
}

/** Issue a single-use authorization code bound to the consent. */
export async function issueAuthorizationCode(
  supabase: SupabaseClient,
  payload: ConsentPayload,
  userId: string,
): Promise<string> {
  const code = generateOAuthToken('uoc_')
  await (supabase as any).from('oauth_authorization_codes').insert({
    tenant_id: payload.tenant_id,
    code_hash: hashOAuthToken(code),
    client_id: payload.client_id,
    user_id: userId,
    redirect_uri: payload.redirect_uri,
    scopes: payload.scopes,
    code_challenge: payload.code_challenge,
    code_challenge_method: payload.code_challenge_method,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  })
  return code
}

/** Build a redirect back to the client with query params appended safely. */
export function buildClientRedirect(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries(params)) {
    if (value != null) url.searchParams.set(key, value)
  }
  return url.toString()
}
