'use server'

import { createClient } from '@/lib/supabase/server'
import { getUserPermissions, requirePermission } from '@/lib/permissions-server'
import { fromSession } from '@/lib/services/context'
import * as service from '@/lib/services/object-permissions'

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

/** Besides Manage roles, who may read an object's grants: the people who can edit it. */
const GRANT_READ_PERMISSION: Record<string, string> = {
  workflow: 'workflows.edit', form: 'forms.edit', data_table: 'data.edit_schema', agent: 'agents.edit',
  integration: 'integrations.edit', report: 'reports.edit_own', api_key: 'settings.manage_api_keys',
}

export async function getObjectPermissions(objectType: string, objectId: string): Promise<ObjectPermission[]> {
  // Grantees' names and emails: the people who manage grants (Manage roles)
  // or can edit the object (its Access panel / availability hint).
  const perms = await getUserPermissions()
  const editPerm = GRANT_READ_PERMISSION[objectType]
  if (!perms.has('team.change_roles') && !(editPerm && perms.has(editPerm))) throw new Error('Forbidden')
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

function toGrant(params: { objectType: string; objectId: string; roleId?: string; userId?: string; teamId?: string; canView: boolean; canEdit: boolean; canDelete: boolean; canExecute: boolean }) {
  return {
    object_type: params.objectType, object_id: params.objectId,
    role_id: params.roleId ?? null, user_id: params.userId ?? null, team_id: params.teamId ?? null,
    can_view: params.canView, can_edit: params.canEdit, can_delete: params.canDelete, can_execute: params.canExecute,
  }
}

/** Service errors become plain Errors with their message (the panel shows it). */
async function withService<T>(fn: (ctx: Awaited<ReturnType<typeof fromSession>>) => Promise<T>): Promise<T> {
  await requirePermission('team.change_roles')
  const ctx = await fromSession()
  try {
    return await fn(ctx)
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not update the permissions')
  }
}

/** Add or change one grantee's grant (lib/services/object-permissions: checks and audit). */
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
  await withService((ctx) => service.setObjectPermission(ctx, toGrant(params)))
}

export async function removeObjectPermission(permissionId: string) {
  await withService((ctx) => service.removeObjectPermission(ctx, permissionId))
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
  await withService(async (ctx) => {
    for (const objectId of params.objectIds) await service.setObjectPermission(ctx, toGrant({ ...params, objectId }))
  })
}

export async function removeAllObjectPermissions(objectType: string, objectId: string) {
  await withService((ctx) => service.removeAllObjectPermissions(ctx, objectType, objectId))
}
