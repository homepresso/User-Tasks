/**
 * Roles, user role assignments and the user directory. Shared by
 * /api/v1/roles, /api/v1/users, the MCP roles/users tools and the governance
 * server actions.
 *
 * Permissions match the governance UI: reading roles and users needs
 * team.view_members, every change needs team.change_roles. System roles
 * (seeded per tenant) keep their name and cannot be deleted; their
 * description and permissions stay editable, as in the role editor.
 * Permission lists are filtered to known PERMISSION_KEYS.
 *
 * Role changes write both the governance log (permission_audit_log, shown on
 * the governance page) and the unified object audit log, and roles are a
 * GitHub-sync asset.
 */

import { invalidateCredentialCache } from '@/lib/api-auth-cache'
import { PERMISSION_KEYS } from '@/lib/permissions'
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, audit, dbError, ilikeTerm, syncChange, type Page } from './_shared'
import { toKeySlug } from '@/lib/utils/slug'

/* eslint-disable @typescript-eslint/no-explicit-any -- roles/user_roles are not in the generated Database types */

const ROLE_COLUMNS = 'id, name, slug, description, permissions, is_system, base_role, created_at, updated_at'
const USER_COLUMNS = 'id, display_name, email, role, timezone, available_hours_week, created_at'
const VALID_PERMISSIONS = new Set<string>(PERMISSION_KEYS)
export const BULK_ROLE_LIMIT = 500

export interface RoleRow {
  id: string
  name: string
  slug: string
  description: string | null
  permissions: string[]
  is_system: boolean
  base_role: string | null
  created_at: string
  updated_at: string
}

export interface RoleInput {
  name: string
  description?: string | null
  permissions?: string[]
}

export type RoleUpdateInput = Partial<RoleInput>

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!name) throw ServiceError.validation('Role name is required')
  if (name.length > 100) throw ServiceError.validation('Role name too long (max 100 characters)')
  return name
}

/** Known permission keys only, de-duplicated (unknown keys are dropped, as in the UI). */
export function cleanPermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return Array.from(new Set(raw.map((p) => String(p ?? '').trim()).filter((p) => VALID_PERMISSIONS.has(p))))
}

const isUniqueViolation = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === '23505' || /unique|duplicate/i.test(error.message ?? '')))

/** Governance log row (permission_audit_log needs a user actor; skipped for tenant keys). */
async function governanceLog(ctx: ServiceContext, action: string, fields: { targetUserId?: string; roleId?: string; details?: unknown }) {
  const actorId = ctx.actorId ?? ctx.credentialOwnerId ?? null
  if (!actorId) return
  try {
    await (ctx.supabase as any).from('permission_audit_log').insert({
      tenant_id: ctx.tenantId,
      actor_id: actorId,
      action,
      target_user_id: fields.targetUserId ?? null,
      role_id: fields.roleId ?? null,
      details: fields.details ?? null,
    })
  } catch (error) {
    console.warn('[roles] permission_audit_log insert failed:', error)
  }
}

async function loadRole(ctx: ServiceContext, roleId: string, select = ROLE_COLUMNS): Promise<RoleRow> {
  const { data, error } = await (ctx.supabase as any).from('roles')
    .select(select).eq('id', roleId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Role not found')
  return data as RoleRow
}

async function loadTenantUser(ctx: ServiceContext, userId: string) {
  const { data, error } = await (ctx.supabase as any).from('users')
    .select('id, display_name, email').eq('id', userId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('User not found')
  return data as { id: string; display_name: string | null; email: string | null }
}

/* ── Roles ── */

export async function listRoles(ctx: ServiceContext) {
  requirePerm(ctx, 'team.view_members')
  const { data, error } = await (ctx.supabase as any).from('roles')
    .select(ROLE_COLUMNS).eq('tenant_id', ctx.tenantId)
    .order('is_system', { ascending: false }).order('name')
  if (error) throw dbError(error)
  const roles = (data ?? []) as RoleRow[]
  return { roles, total: roles.length }
}

export async function getRole(ctx: ServiceContext, roleId: string) {
  requirePerm(ctx, 'team.view_members')
  return loadRole(ctx, roleId)
}

export async function createRole(ctx: ServiceContext, input: RoleInput) {
  requirePerm(ctx, 'team.change_roles')
  const name = cleanName(input.name)
  const permissions = cleanPermissions(input.permissions)
  const { data, error } = await (ctx.supabase as any).from('roles').insert({
    tenant_id: ctx.tenantId,
    name,
    slug: toKeySlug(name),
    description: String(input.description ?? '').trim() || null,
    permissions,
    is_system: false,
  }).select(ROLE_COLUMNS).single()
  if (isUniqueViolation(error)) throw ServiceError.conflict('A role with that name already exists')
  if (error || !data) throw dbError(error, 'Failed to create role')
  const role = data as RoleRow
  await governanceLog(ctx, 'role_created', { roleId: role.id, details: { name, permissions } })
  await audit(ctx, { objectType: 'role', objectId: role.id, action: 'create', summary: `Created role "${name}"`, metadata: { permissions } })
  await syncChange(ctx, 'role', role)
  return role
}

export async function updateRole(ctx: ServiceContext, roleId: string, input: RoleUpdateInput) {
  requirePerm(ctx, 'team.change_roles')
  const existing = await loadRole(ctx, roleId)
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = cleanName(input.name)
    if (name !== existing.name) {
      if (existing.is_system) throw ServiceError.validation('System role names cannot be changed')
      updates.name = name
      updates.slug = toKeySlug(name)
    }
  }
  if (input.description !== undefined) updates.description = String(input.description ?? '').trim() || null
  if (input.permissions !== undefined) updates.permissions = cleanPermissions(input.permissions)
  if (Object.keys(updates).length === 0) return existing
  updates.updated_at = new Date().toISOString()

  const { data, error } = await (ctx.supabase as any).from('roles')
    .update(updates).eq('id', roleId).eq('tenant_id', ctx.tenantId).select(ROLE_COLUMNS).single()
  if (isUniqueViolation(error)) throw ServiceError.conflict('A role with that name already exists')
  if (error || !data) throw dbError(error, 'Failed to update role')
  await invalidateCredentialCache()
  const role = data as RoleRow
  const fields = Object.keys(updates).filter((key) => key !== 'updated_at' && key !== 'slug')
  await governanceLog(ctx, 'role_updated', { roleId, details: updates })
  await audit(ctx, {
    objectType: 'role', objectId: roleId, action: 'update', summary: `Updated role "${role.name}"`,
    metadata: { fields },
    ...(updates.permissions ? { diff: { permissions: { before: existing.permissions, after: role.permissions } } } : {}),
  })
  await syncChange(ctx, 'role', role)
  return role
}

export async function deleteRole(ctx: ServiceContext, roleId: string) {
  requirePerm(ctx, 'team.change_roles')
  const role = await loadRole(ctx, roleId, 'id, name, is_system')
  if (role.is_system) throw ServiceError.conflict('System roles cannot be deleted')
  const unassign = await (ctx.supabase as any).from('user_roles').delete().eq('role_id', roleId).eq('tenant_id', ctx.tenantId)
  if (unassign.error) throw dbError(unassign.error)
  const { error } = await (ctx.supabase as any).from('roles').delete().eq('id', roleId).eq('tenant_id', ctx.tenantId)
  await invalidateCredentialCache()
  if (error) throw dbError(error, 'Failed to delete role')
  await governanceLog(ctx, 'role_deleted', { roleId, details: { name: role.name } })
  await audit(ctx, { objectType: 'role', objectId: roleId, action: 'delete', summary: `Deleted role "${role.name}"` })
  await syncChange(ctx, 'role', role, 'delete')
  return { deleted: true as const, id: roleId }
}

/* ── Assignments ── */

/** Give `userId` the role. Idempotent: an existing assignment returns `already_assigned`. */
export async function assignRole(ctx: ServiceContext, userId: string, roleId: string) {
  requirePerm(ctx, 'team.change_roles')
  const role = await loadRole(ctx, roleId, 'id, name')
  await loadTenantUser(ctx, userId)
  const { data: existing } = await (ctx.supabase as any).from('user_roles')
    .select('id').eq('tenant_id', ctx.tenantId).eq('user_id', userId).eq('role_id', roleId).maybeSingle()
  if (existing) return { assigned: true, already_assigned: true, user_id: userId, role_id: roleId }
  const { error } = await (ctx.supabase as any).from('user_roles').insert({ tenant_id: ctx.tenantId, user_id: userId, role_id: roleId })
  if (isUniqueViolation(error)) return { assigned: true, already_assigned: true, user_id: userId, role_id: roleId }
  if (error) throw dbError(error, 'Failed to assign role')
  await invalidateCredentialCache()
  await governanceLog(ctx, 'user_role_assigned', { targetUserId: userId, roleId })
  await audit(ctx, { objectType: 'role', objectId: roleId, action: 'grant', summary: `Assigned role "${role.name}"`, metadata: { user_id: userId } })
  return { assigned: true, already_assigned: false, user_id: userId, role_id: roleId }
}

export async function removeUserRole(ctx: ServiceContext, userId: string, roleId: string) {
  requirePerm(ctx, 'team.change_roles')
  const role = await loadRole(ctx, roleId, 'id, name')
  const { data, error } = await (ctx.supabase as any).from('user_roles')
    .delete().eq('tenant_id', ctx.tenantId).eq('user_id', userId).eq('role_id', roleId).select('id')
  if (error) throw dbError(error, 'Failed to remove role')
  await invalidateCredentialCache()
  const removed = (data ?? []).length > 0
  if (removed) {
    await governanceLog(ctx, 'user_role_removed', { targetUserId: userId, roleId })
    await audit(ctx, { objectType: 'role', objectId: roleId, action: 'revoke', summary: `Removed role "${role.name}"`, metadata: { user_id: userId } })
  }
  return { removed, user_id: userId, role_id: roleId }
}

function checkBulkIds(userIds: string[]): string[] {
  const ids = Array.from(new Set((userIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)))
  if (ids.length === 0) throw ServiceError.validation('Select at least one user')
  if (ids.length > BULK_ROLE_LIMIT) throw ServiceError.validation(`Too many users — select ${BULK_ROLE_LIMIT} or fewer at a time`)
  return ids
}

/** Assign a role to many users; every user must belong to the tenant. */
export async function bulkAssignRole(ctx: ServiceContext, userIds: string[], roleId: string) {
  requirePerm(ctx, 'team.change_roles')
  const ids = checkBulkIds(userIds)
  const role = await loadRole(ctx, roleId, 'id, name')
  const { data: validUsers, error: validError } = await (ctx.supabase as any).from('users')
    .select('id').in('id', ids).eq('tenant_id', ctx.tenantId)
  if (validError) throw dbError(validError)
  const valid = new Set((validUsers ?? []).map((u: any) => u.id))
  const bad = ids.filter((id) => !valid.has(id))
  if (bad.length > 0) throw ServiceError.validation(`${bad.length} selected user${bad.length !== 1 ? 's' : ''} are not in your tenant`)

  const { data: existing } = await (ctx.supabase as any).from('user_roles')
    .select('user_id').eq('tenant_id', ctx.tenantId).eq('role_id', roleId).in('user_id', ids)
  const already = new Set((existing ?? []).map((r: any) => r.user_id))
  const toInsert = ids.filter((id) => !already.has(id))
  if (toInsert.length === 0) return { assigned: 0, skipped: ids.length }

  const { error } = await (ctx.supabase as any).from('user_roles')
    .insert(toInsert.map((userId) => ({ tenant_id: ctx.tenantId, user_id: userId, role_id: roleId })))
  if (error) throw dbError(error, 'Failed to assign role')
  await invalidateCredentialCache()
  await governanceLog(ctx, 'user_role_bulk_assigned', { roleId, details: { role_name: role.name, user_ids: toInsert, count: toInsert.length } })
  await audit(ctx, { objectType: 'role', objectId: roleId, action: 'grant', summary: `Assigned role "${role.name}" to ${toInsert.length} users`, metadata: { user_ids: toInsert } })
  return { assigned: toInsert.length, skipped: already.size }
}

export async function bulkRemoveUserRole(ctx: ServiceContext, userIds: string[], roleId: string) {
  requirePerm(ctx, 'team.change_roles')
  const ids = checkBulkIds(userIds)
  const role = await loadRole(ctx, roleId, 'id, name')
  const { data, error } = await (ctx.supabase as any).from('user_roles')
    .delete().eq('tenant_id', ctx.tenantId).eq('role_id', roleId).in('user_id', ids).select('user_id')
  if (error) throw dbError(error, 'Failed to remove role')
  await invalidateCredentialCache()
  const removed = (data ?? []).map((r: any) => r.user_id as string)
  await governanceLog(ctx, 'user_role_bulk_removed', { roleId, details: { role_name: role.name, user_ids: removed, count: removed.length } })
  if (removed.length) {
    await audit(ctx, { objectType: 'role', objectId: roleId, action: 'revoke', summary: `Removed role "${role.name}" from ${removed.length} users`, metadata: { user_ids: removed } })
  }
  return { removed: removed.length }
}

/* ── Users ── */

export interface UserListFilters {
  search?: string
  include_roles?: boolean
  include_teams?: boolean
}

/** Users of the tenant (optionally with their roles and teams). */
export async function listUsers(ctx: ServiceContext, filters: UserListFilters = {}, page: Page) {
  requirePerm(ctx, 'team.view_members')
  let query = (ctx.supabase as any).from('users')
    .select(USER_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .order('display_name')
  if (filters.search?.trim()) {
    const term = ilikeTerm(filters.search)
    query = query.or(`display_name.ilike.%${term}%,email.ilike.%${term}%`)
  }
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const users = (data ?? []) as Array<Record<string, any>>
  const ids = users.map((user) => user.id)

  const rolesByUser = new Map<string, any[]>()
  if (filters.include_roles && ids.length) {
    const { data: assignments, error: roleError } = await (ctx.supabase as any).from('user_roles')
      .select('user_id, role_id, role:roles(id, name, slug, is_system)').eq('tenant_id', ctx.tenantId).in('user_id', ids)
    if (roleError) throw dbError(roleError)
    for (const a of assignments ?? []) {
      const role = Array.isArray(a.role) ? a.role[0] : a.role
      rolesByUser.set(a.user_id, [...(rolesByUser.get(a.user_id) ?? []), role ?? { id: a.role_id }])
    }
  }
  const teamsByUser = new Map<string, any[]>()
  if (filters.include_teams && ids.length) {
    // user_teams has no tenant column: restrict to this tenant's teams.
    const { data: teams, error: teamError } = await (ctx.supabase as any).from('teams').select('id, name').eq('tenant_id', ctx.tenantId)
    if (teamError) throw dbError(teamError)
    const teamById = new Map<string, any>((teams ?? []).map((t: any) => [t.id, t]))
    if (teamById.size) {
      const { data: memberships, error: memberError } = await (ctx.supabase as any).from('user_teams')
        .select('user_id, team_id, role').in('user_id', ids).in('team_id', [...teamById.keys()])
      if (memberError) throw dbError(memberError)
      for (const m of memberships ?? []) {
        teamsByUser.set(m.user_id, [...(teamsByUser.get(m.user_id) ?? []), { ...teamById.get(m.team_id), member_role: m.role ?? 'member' }])
      }
    }
  }

  return {
    users: users.map((user) => ({
      ...user,
      ...(filters.include_roles ? { roles: rolesByUser.get(user.id) ?? [] } : {}),
      ...(filters.include_teams ? { teams: teamsByUser.get(user.id) ?? [] } : {}),
    })),
    total: (count ?? users.length) as number,
  }
}

/** Governance-page shape: every user with their role assignment rows. */
export async function listUserRoleAssignments(ctx: ServiceContext) {
  requirePerm(ctx, 'team.view_members')
  const { data: users, error } = await (ctx.supabase as any).from('users')
    .select('id, display_name, email, role').eq('tenant_id', ctx.tenantId).order('display_name')
  if (error) throw dbError(error)
  const { data: assignments, error: assignmentError } = await (ctx.supabase as any).from('user_roles')
    .select('id, user_id, role_id, role:roles(id, name, slug, is_system)').eq('tenant_id', ctx.tenantId)
  if (assignmentError) throw dbError(assignmentError)
  const byUser = new Map<string, any[]>()
  for (const a of assignments ?? []) byUser.set(a.user_id, [...(byUser.get(a.user_id) ?? []), a])
  return (users ?? []).map((u: any) => ({ ...u, assignments: byUser.get(u.id) ?? [] }))
}

/** Live role permissions of a tenant user (union of their roles). */
export async function userRolePermissions(ctx: ServiceContext, userId: string): Promise<Set<string>> {
  const { data, error } = await (ctx.supabase as any).from('user_roles')
    .select('role_id, role:roles(permissions)').eq('tenant_id', ctx.tenantId).eq('user_id', userId)
  if (error) throw dbError(error)
  const out = new Set<string>()
  const roleIds: string[] = []
  for (const row of data ?? []) {
    const roles = Array.isArray(row?.role) ? row.role : row?.role ? [row.role] : []
    if (roles.length === 0 && row?.role_id) roleIds.push(row.role_id)
    for (const role of roles) for (const p of role?.permissions ?? []) out.add(String(p))
  }
  // Clients that don't embed (test doubles) fall back to a direct lookup.
  if (roleIds.length) {
    const { data: roles } = await (ctx.supabase as any).from('roles').select('id, permissions').eq('tenant_id', ctx.tenantId).in('id', roleIds)
    for (const role of roles ?? []) for (const p of role?.permissions ?? []) out.add(String(p))
  }
  return out
}

/* ── Governance log ── */

/** permission_audit_log rows (role and assignment changes), newest first. Needs team.change_roles, as on the governance page. */
export async function listGovernanceLog(ctx: ServiceContext, filters: { action?: string; limit?: number } = {}) {
  requirePerm(ctx, 'team.change_roles')
  let query = (ctx.supabase as any).from('permission_audit_log')
    .select('id, action, actor_id, target_user_id, role_id, details, created_at')
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .limit(Math.max(1, Math.min(filters.limit ?? 50, 500)))
  if (filters.action) query = query.eq('action', filters.action)
  const { data, error } = await query
  if (error) throw dbError(error)
  return (data ?? []) as Array<Record<string, any>>
}
