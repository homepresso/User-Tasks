import { createClient, getCachedUser } from '@/lib/supabase/server'

/**
 * Session user and their current tenant for server actions (falls back to the
 * home tenant). Throws when signed out or tenant-less. Not a server action
 * itself: import it from 'use server' modules.
 */
export async function requireTenant() {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id')
    .eq('id', user.id)
    .single()
  const tenantId = (profile as { current_tenant_id?: string | null; tenant_id?: string | null } | null)?.current_tenant_id
    ?? (profile as { tenant_id?: string | null } | null)?.tenant_id
  if (!tenantId) throw new Error('No tenant')
  return { supabase, user, tenantId: String(tenantId) }
}
