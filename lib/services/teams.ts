/**
 * Teams and team membership. Shared by /api/v1/teams, the MCP teams_* tools
 * and the team server actions.
 *
 * Permissions match the team UI: viewing needs team.view_members, creating /
 * renaming a team and adding members needs team.invite, deleting a team and
 * removing members needs team.remove. `user_teams` has no tenant column, so
 * both the team and the user are checked against the tenant before any
 * membership change.
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- teams/user_teams rows */

const TEAM_COLUMNS = 'id, name, description, parent_id, created_at, updated_at'

export interface TeamInput {
  name: string
  description?: string | null
  parent_id?: string | null
}

export type TeamUpdateInput = Partial<TeamInput>

function cleanName(raw: unknown): string {
  const name = String(raw ?? '').trim()
  if (!name) throw ServiceError.validation('Team name is required')
  if (name.length > 200) throw ServiceError.validation('Team name too long (max 200 characters)')
  return name
}

async function loadTeam(ctx: ServiceContext, teamId: string, select = TEAM_COLUMNS) {
  const { data, error } = await (ctx.supabase as any).from('teams')
    .select(select).eq('id', teamId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Team not found')
  return data as Record<string, any>
}

async function checkParent(ctx: ServiceContext, parentId: string | null | undefined, selfId?: string) {
  if (!parentId) return null
  if (parentId === selfId) throw ServiceError.validation('A team cannot be its own parent')
  await loadTeam(ctx, parentId, 'id').catch(() => { throw ServiceError.validation('Parent team not found') })
  return parentId
}

export async function listTeams(ctx: ServiceContext) {
  requirePerm(ctx, 'team.view_members')
  const { data, error } = await (ctx.supabase as any).from('teams')
    .select(TEAM_COLUMNS).eq('tenant_id', ctx.tenantId).order('name')
  if (error) throw dbError(error)
  const teams = (data ?? []) as Array<Record<string, any>>
  const counts = new Map<string, number>()
  if (teams.length) {
    const { data: memberships, error: memberError } = await (ctx.supabase as any).from('user_teams')
      .select('team_id').in('team_id', teams.map((t) => t.id))
    if (memberError) throw dbError(memberError)
    for (const m of memberships ?? []) counts.set(m.team_id, (counts.get(m.team_id) ?? 0) + 1)
  }
  return { teams: teams.map((t) => ({ ...t, member_count: counts.get(t.id) ?? 0 })), total: teams.length }
}

/** A team with its members (id, display name, email, member role). */
export async function getTeam(ctx: ServiceContext, teamId: string) {
  requirePerm(ctx, 'team.view_members')
  const team = await loadTeam(ctx, teamId)
  const { data: memberships, error } = await (ctx.supabase as any).from('user_teams')
    .select('user_id, role, created_at').eq('team_id', teamId)
  if (error) throw dbError(error)
  const ids = (memberships ?? []).map((m: any) => m.user_id)
  const users = new Map<string, any>()
  if (ids.length) {
    const { data, error: userError } = await (ctx.supabase as any).from('users')
      .select('id, display_name, email').in('id', ids).eq('tenant_id', ctx.tenantId)
    if (userError) throw dbError(userError)
    for (const u of data ?? []) users.set(u.id, u)
  }
  const members = (memberships ?? [])
    .filter((m: any) => users.has(m.user_id))
    .map((m: any) => ({ ...users.get(m.user_id), member_role: m.role ?? 'member', added_at: m.created_at ?? null }))
  return { ...team, members, member_count: members.length }
}

export async function createTeam(ctx: ServiceContext, input: TeamInput) {
  requirePerm(ctx, 'team.invite')
  const name = cleanName(input.name)
  const parentId = await checkParent(ctx, input.parent_id)
  const { data, error } = await (ctx.supabase as any).from('teams').insert({
    tenant_id: ctx.tenantId,
    name,
    description: String(input.description ?? '').trim() || null,
    parent_id: parentId,
  }).select(TEAM_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to create team')
  await audit(ctx, { objectType: 'team', objectId: data.id, action: 'create', summary: `Created team "${name}"` })
  return data as Record<string, any>
}

export async function updateTeam(ctx: ServiceContext, teamId: string, input: TeamUpdateInput) {
  requirePerm(ctx, 'team.invite')
  await loadTeam(ctx, teamId, 'id')
  const updates: Record<string, unknown> = {}
  if (input.name !== undefined) updates.name = cleanName(input.name)
  if (input.description !== undefined) updates.description = String(input.description ?? '').trim() || null
  if (input.parent_id !== undefined) updates.parent_id = await checkParent(ctx, input.parent_id, teamId)
  if (Object.keys(updates).length === 0) throw ServiceError.validation('No fields to update')
  updates.updated_at = new Date().toISOString()
  const { data, error } = await (ctx.supabase as any).from('teams')
    .update(updates).eq('id', teamId).eq('tenant_id', ctx.tenantId).select(TEAM_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to update team')
  await audit(ctx, {
    objectType: 'team', objectId: teamId, action: 'update', summary: `Updated team "${data.name}"`,
    metadata: { fields: Object.keys(updates).filter((key) => key !== 'updated_at') },
  })
  return data as Record<string, any>
}

export async function deleteTeam(ctx: ServiceContext, teamId: string) {
  requirePerm(ctx, 'team.remove')
  const team = await loadTeam(ctx, teamId, 'id, name')
  const members = await (ctx.supabase as any).from('user_teams').delete().eq('team_id', teamId)
  if (members.error) throw dbError(members.error)
  const { error } = await (ctx.supabase as any).from('teams').delete().eq('id', teamId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to delete team')
  await audit(ctx, { objectType: 'team', objectId: teamId, action: 'delete', summary: `Deleted team "${team.name}"` })
  return { deleted: true as const, id: teamId }
}

/** Add a tenant user to a team. Idempotent (`already_member`). */
export async function addTeamMember(ctx: ServiceContext, teamId: string, userId: string, role = 'member') {
  requirePerm(ctx, 'team.invite')
  const team = await loadTeam(ctx, teamId, 'id, name')
  const { data: user, error: userError } = await (ctx.supabase as any).from('users')
    .select('id').eq('id', userId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (userError) throw dbError(userError)
  if (!user) throw ServiceError.notFound('User not found')
  const memberRole = String(role || 'member').trim().slice(0, 50) || 'member'

  const { data: existing } = await (ctx.supabase as any).from('user_teams')
    .select('id').eq('team_id', teamId).eq('user_id', userId).maybeSingle()
  if (existing) return { added: true, already_member: true, team_id: teamId, user_id: userId }
  const { error } = await (ctx.supabase as any).from('user_teams').insert({ team_id: teamId, user_id: userId, role: memberRole })
  if (error && /unique|duplicate/i.test(error.message ?? '')) return { added: true, already_member: true, team_id: teamId, user_id: userId }
  if (error) throw dbError(error, 'Failed to add team member')
  await audit(ctx, { objectType: 'team', objectId: teamId, action: 'grant', summary: `Added a member to team "${team.name}"`, metadata: { user_id: userId, role: memberRole } })
  return { added: true, already_member: false, team_id: teamId, user_id: userId }
}

export async function removeTeamMember(ctx: ServiceContext, teamId: string, userId: string) {
  requirePerm(ctx, 'team.remove')
  const team = await loadTeam(ctx, teamId, 'id, name')
  const { data, error } = await (ctx.supabase as any).from('user_teams')
    .delete().eq('team_id', teamId).eq('user_id', userId).select('id')
  if (error) throw dbError(error, 'Failed to remove team member')
  const removed = (data ?? []).length > 0
  if (removed) await audit(ctx, { objectType: 'team', objectId: teamId, action: 'revoke', summary: `Removed a member from team "${team.name}"`, metadata: { user_id: userId } })
  return { removed, team_id: teamId, user_id: userId }
}
