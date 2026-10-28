'use server'

import { revalidatePath } from 'next/cache'
import { fromSession } from '@/lib/services/context'
import * as roles from '@/lib/services/roles'

/*
 * Governance server actions: thin wrappers over lib/services/roles (shared
 * with /api/v1/roles, /api/v1/users and the MCP roles tools), which owns the
 * permission checks, tenant filtering, system-role protection and audit.
 */

export async function createRole(input: { name: string; description?: string; permissions: string[] }) {
  const role = await roles.createRole(await fromSession(), input)
  revalidatePath('/settings')
  return { id: role.id }
}

export async function updateRole(roleId: string, input: { name?: string; description?: string; permissions?: string[] }) {
  await roles.updateRole(await fromSession(), roleId, input)
  revalidatePath('/settings')
}

export async function deleteRole(roleId: string) {
  await roles.deleteRole(await fromSession(), roleId)
  revalidatePath('/settings')
}

export async function assignRole(userId: string, roleId: string) {
  await roles.assignRole(await fromSession(), userId, roleId)
  revalidatePath('/settings')
}

export async function removeUserRole(userId: string, roleId: string) {
  await roles.removeUserRole(await fromSession(), userId, roleId)
  revalidatePath('/settings')
}

/** Bulk-assign a role (≤ 500 users, all in the tenant); existing assignments are skipped. */
export async function bulkAssignRole(userIds: string[], roleId: string): Promise<{ assigned: number; skipped: number }> {
  const result = await roles.bulkAssignRole(await fromSession(), userIds, roleId)
  revalidatePath('/settings')
  return result
}

/** Bulk-remove a role from up to 500 users. */
export async function bulkRemoveUserRole(userIds: string[], roleId: string): Promise<{ removed: number }> {
  const result = await roles.bulkRemoveUserRole(await fromSession(), userIds, roleId)
  revalidatePath('/settings')
  return result
}
