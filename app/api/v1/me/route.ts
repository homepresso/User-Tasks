import { apiRoute } from '@/lib/api/route'
import { meEndpoint, type MeResponse } from '@/lib/api-schemas/identity'

/** GET /api/v1/me — who am I: tenant, bound user, credential kind and permissions. */
export const GET = apiRoute(meEndpoint, async ({ auth }): Promise<MeResponse> => {
  const supabase = auth.supabase
  const [{ data: tenant }, { data: user }] = await Promise.all([
    supabase.from('tenants').select('id, name, slug').eq('id', auth.tenantId).maybeSingle(),
    auth.actingUserId
      ? supabase.from('users').select('id, email').eq('id', auth.actingUserId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  return {
    tenant: { id: auth.tenantId, name: tenant?.name ?? null, slug: tenant?.slug ?? null },
    user: auth.actingUserId ? { id: auth.actingUserId, email: user?.email ?? null } : null,
    auth: {
      kind: auth.authKind ?? 'api_key',
      key_type: auth.keyType,
      oauth_scopes: auth.authKind === 'oauth' ? (auth.oauthScopes ?? []) : null,
      expires_at: auth.expiresAt ?? null,
    },
    permissions: [...auth.permissions].sort(),
    resource_scopes: auth.scopes,
  }
})
