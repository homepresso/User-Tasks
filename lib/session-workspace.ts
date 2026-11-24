import { cache } from 'react'
import { createClient, getCachedUser } from '@/lib/supabase/server'

/**
 * The signed-in user's current and home workspace (users.current_tenant_id
 * and tenant_id), read once per request with the session client. null when
 * signed out or the read fails. Server only.
 *
 * The dashboard layout uses it for the workspace theme and to tell the
 * browser which workspace its cached role and permissions must belong to
 * (lib/dashboard-auth-cache.ts).
 */
export const loadSessionWorkspace = cache(async (): Promise<{ current: string | null; home: string | null } | null> => {
  try {
    const user = await getCachedUser()
    if (!user) return null
    const supabase = await createClient()
    const { data, error } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).maybeSingle()
    if (error || !data) return null
    const row = data as { current_tenant_id?: string | null; tenant_id?: string | null }
    return { current: row.current_tenant_id ?? null, home: row.tenant_id ?? null }
  } catch {
    return null
  }
})
