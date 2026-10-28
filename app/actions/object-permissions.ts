'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { requirePermission } from '@/lib/permissions-server'

export interface ObjectPermission {
  id: string
  object_type: string
  object_id: string
  role_id: string | null
  user_id: string | null
  team_id: string | null
  can_view: boolean
  can_edit: boolean
  can_delete: boolean
  can_execute: boolean
  granted_by: string | null
  created_at: string
  role?: { id: string; name: string; slug: string } | null
  user?: { id: string; display_name: string; email: string } | null
  team?: { id: string; name: string } | null
}

export async function getObjectPermissions(objectType: string, objectId: string): Promise<ObjectPermission[]> {
  const supabase = await createClient()
  const { data, error } = await (supabase as any)
    .from('object_permissions')
    .select('*, role:roles(id, name, slug), user:users!object_permissions_user_id_fkey(id, display_name, email), team:teams!object_permissions_team_id_fkey(id, name)')
    .eq('object_type', objectType)
    .eq('object_id', objectId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return data ?? []
}

export async function setObjectPermission(params: {
  objectType: string
  objectId: string
  roleId?: string
  userId?: string
  teamId?: string
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  canExecute: boolean
}) {
  await requirePermission('team.change_roles')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')
  const { data: profile } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (!tenantId) throw new Error('No tenant')

  const row: any = {
    tenant_id: tenantId,
    object_type: params.objectType,
    object_id: params.objectId,
    can_view: params.canView,
    can_edit: params.canEdit,
    can_delete: params.canDelete,
    can_execute: params.canExecute,
    granted_by: user.id,
  }
  if (params.roleId) row.role_id = params.roleId
  if (params.userId) row.user_id = params.userId
  if (params.teamId) row.team_id = params.teamId

  // Upsert: update if exists, insert if new
  const matchCol = params.roleId ? 'role_id' : params.teamId ? 'team_id' : 'user_id'
  const matchVal = params.roleId ?? params.teamId ?? params.userId

  const { data: existing } = await (supabase as any)
    .from('object_permissions')
    .select('id')
    .eq('object_type', params.objectType)
    .eq('object_id', params.objectId)
    .eq(matchCol, matchVal)
    .maybeSingle()

  if (existing) {
    const { error } = await (supabase as any)
      .from('object_permissions')
      .update({
        can_view: params.canView,
        can_edit: params.canEdit,
        can_delete: params.canDelete,
        can_execute: params.canExecute,
        granted_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    if (error) throw new Error(error.message)
  } else {
    const { error } = await (supabase as any)
      .from('object_permissions')
      .insert(row)
    if (error) throw new Error(error.message)
  }
}

export async function removeObjectPermission(permissionId: string) {
  await requirePermission('team.change_roles')
  const supabase = await createClient()
  const { error } = await (supabase as any)
    .from('object_permissions')
    .delete()
    .eq('id', permissionId)
  if (error) throw new Error(error.message)
}

export async function bulkSetObjectPermissions(params: {
  objectType: string
  objectIds: string[]
  roleId?: string
  userId?: string
  teamId?: string
  canView: boolean
  canEdit: boolean
  canDelete: boolean
  canExecute: boolean
}) {
  await requirePermission('team.change_roles')
  for (const objectId of params.objectIds) {
    await setObjectPermission({ ...params, objectId })
  }
}

export async function removeAllObjectPermissions(objectType: string, objectId: string) {
  await requirePermission('team.change_roles')
  const supabase = await createClient()
  const { error } = await (supabase as any)
    .from('object_permissions')
    .delete()
    .eq('object_type', objectType)
    .eq('object_id', objectId)
  if (error) throw new Error(error.message)
}
