import type { SupabaseClient } from '@supabase/supabase-js'
import {
  EntraGroupsUnavailableError,
  entraGroupCapabilities,
  resolveEntraGroupAssignees,
  syncedTeamIds,
} from '@/lib/directory-sync/entra-groups'
import { aadGroupConfigOf, type AadGroupMode } from '@/lib/tasks/aad-group-assignment'

/* eslint-disable @typescript-eslint/no-explicit-any -- service-role rows */

/**
 * Run time of a User Task assigned to an AAD (Entra ID) group: who gets the
 * task. The engine (lib/workflow-engine.ts, user_task) creates the task from
 * the plan:
 *
 *  - claim:     one unassigned task; every member gets a task_assignees row
 *               (role 'candidate', pending) and sees it Queued with Claim —
 *               the first claim wins (lib/services/home.ts claimTask) and the
 *               other candidates are removed;
 *  - everyone:  one collaborative task, every member an assignee (lead = the
 *               first); the node's completion_rule decides when it is done;
 *  - single:    exactly one member resolved — assigned to them directly;
 *  - team:      Graph could not be reached but directory sync keeps a team
 *               for the group — given to that team (claim) instead;
 *  - unassigned: no Entra connection, no group, or nobody resolved — the
 *               node's no-assignee behaviour (the task is created unassigned).
 *
 * `logs` are run-log lines for the engine to record (warnings explain every
 * skip and fallback).
 */

export type AadGroupPlan =
  | { kind: 'unassigned' }
  | { kind: 'single'; userId: string }
  | { kind: 'claim'; userIds: string[] }
  | { kind: 'everyone'; userIds: string[] }
  | { kind: 'team'; teamId: string }

export interface AadGroupPlanResult {
  plan: AadGroupPlan
  logs: Array<{ level: 'info' | 'warn'; message: string }>
  /** Stored on the task (metadata.aad_group). */
  metadata: {
    group_id: string
    group_name: string | null
    mode: AadGroupMode
    include_nested: boolean
    member_count: number | null
    assigned_count: number
    skipped_count: number
    fallback: string | null
  }
}

export async function planAadGroupAssignment(
  db: SupabaseClient,
  tenantId: string,
  config: Record<string, unknown>,
  opts: { resolve?: typeof resolveEntraGroupAssignees } = {},
): Promise<AadGroupPlanResult> {
  const c = aadGroupConfigOf(config)
  const label = c.groupName ? `"${c.groupName}"` : c.groupId || '(none)'
  const logs: AadGroupPlanResult['logs'] = []
  const metadata: AadGroupPlanResult['metadata'] = {
    group_id: c.groupId,
    group_name: c.groupName || null,
    mode: c.mode,
    include_nested: c.includeNested,
    member_count: null,
    assigned_count: 0,
    skipped_count: 0,
    fallback: null,
  }
  const unassigned = (reason: string): AadGroupPlanResult => {
    logs.push({ level: 'warn', message: `AAD group assignment: ${reason} — the task was created unassigned.` })
    metadata.fallback = 'unassigned'
    return { plan: { kind: 'unassigned' }, logs, metadata }
  }

  if (!c.groupId) return unassigned('no AAD group is configured on this step')
  const capabilities = await entraGroupCapabilities(db, tenantId)
  if (!capabilities.entraGroups) return unassigned('Entra ID is not configured for this workspace (no enabled directory connection)')

  let userIds: string[]
  try {
    const resolved = await (opts.resolve ?? resolveEntraGroupAssignees)(db, tenantId, c.groupId, { includeNested: c.includeNested })
    userIds = resolved.userIds
    metadata.member_count = resolved.memberCount
    metadata.skipped_count = resolved.skippedNoAccount + resolved.skippedNotMember + resolved.skippedOverLimit
    const skipped: string[] = []
    if (resolved.skippedNoAccount) skipped.push(`${resolved.skippedNoAccount} without a UserTasks account`)
    if (resolved.skippedNotMember) skipped.push(`${resolved.skippedNotMember} not members of this workspace`)
    if (resolved.skippedOverLimit) skipped.push(`${resolved.skippedOverLimit} over the ${userIds.length}-person limit`)
    if (skipped.length) {
      logs.push({ level: 'warn', message: `AAD group ${label}: skipped ${metadata.skipped_count} of ${resolved.memberCount} member${resolved.memberCount === 1 ? '' : 's'} (${skipped.join(', ')}).` })
    }
    logs.push({
      level: 'info',
      message: `AAD group ${label}: ${userIds.length} assignee${userIds.length === 1 ? '' : 's'} from ${resolved.memberCount} member${resolved.memberCount === 1 ? '' : 's'}${c.includeNested ? ' (nested groups included)' : ''}${resolved.cached ? ' (cached)' : ''}.`,
    })
  } catch (error) {
    if (error instanceof EntraGroupsUnavailableError) return unassigned('Entra ID is not configured for this workspace')
    const message = error instanceof Error ? error.message : String(error)
    // Graph unreachable / refused: a team the sync keeps for the group still knows its members.
    const teamId = (await syncedTeamIds(db, tenantId, [c.groupId]).catch(() => new Map<string, string>())).get(c.groupId)
    if (teamId) {
      metadata.fallback = 'synced_team'
      if (c.mode === 'claim') {
        logs.push({ level: 'warn', message: `AAD group ${label}: Microsoft Graph failed (${message}) — given to the group's synced team instead.` })
        return { plan: { kind: 'team', teamId }, logs, metadata }
      }
      const members = await syncedTeamMembers(db, tenantId, teamId)
      if (members.length) {
        logs.push({ level: 'warn', message: `AAD group ${label}: Microsoft Graph failed (${message}) — assigned to the ${members.length} member${members.length === 1 ? '' : 's'} of the group's synced team instead.` })
        metadata.assigned_count = members.length
        return { plan: members.length === 1 ? { kind: 'single', userId: members[0] } : { kind: 'everyone', userIds: members }, logs, metadata }
      }
    }
    return unassigned(`could not read the members of AAD group ${label} from Microsoft Graph (${message})`)
  }

  if (!userIds.length) return unassigned(`no member of AAD group ${label} has an active membership in this workspace`)
  metadata.assigned_count = userIds.length
  if (userIds.length === 1) return { plan: { kind: 'single', userId: userIds[0] }, logs, metadata }
  return { plan: c.mode === 'everyone' ? { kind: 'everyone', userIds } : { kind: 'claim', userIds }, logs, metadata }
}

async function syncedTeamMembers(db: SupabaseClient, tenantId: string, teamId: string): Promise<string[]> {
  const { data } = await (db as any).from('user_teams').select('user_id').eq('team_id', teamId)
  const ids = [...new Set(((data ?? []) as any[]).map((r) => String(r.user_id)).filter(Boolean))]
  if (!ids.length) return []
  const { data: memberships } = await (db as any).from('user_memberships').select('user_id, is_active').eq('tenant_id', tenantId).in('user_id', ids)
  const active = new Set(((memberships ?? []) as any[]).filter((m) => m.is_active !== false).map((m) => String(m.user_id)))
  return ids.filter((id) => active.has(id))
}
