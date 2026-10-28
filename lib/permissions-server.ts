import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import type { Permission } from './permissions'

/** Server-side: fetch user permissions (cached per request via React cache()) */
export const getUserPermissions = cache(async (): Promise<Set<string>> => {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_user_permissions' as any)
  if (error) {
    console.error('[permissions] Failed to fetch user permissions:', error.message)
    return new Set()
  }
  return new Set((data as string[] | null) ?? [])
})

/** Server action guard — throws if the user lacks the required permission */
export async function requirePermission(permission: Permission): Promise<void> {
  const perms = await getUserPermissions()
  if (!perms.has(permission)) {
    throw new Error('Forbidden')
  }
}
