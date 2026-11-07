/**
 * Server side of the queue rules (lib/tasks/queue-rules.ts): load the
 * assignees' preferences (and time zones) and decide the acceptance_status
 * of a task landing with them. Org conditions (manager chain, reports, the
 * assigner's teams / org units / projects) load the minimal org data once
 * per batch, and only when someone's rules use them. A missing or
 * unreadable profile falls back to the default rules (the legacy 'high'
 * threshold), as the workflow engine always did; missing org data means
 * org conditions don't match.
 */

import { buildReportingIndex, listReports, managerChain, type ReportingLine } from '@/lib/reporting-lines'
import {
  decideAcceptance, queueRulesOrgNeeds, resolveQueueRules,
  type QueueEvalContext, type QueueOrgContext, type QueueTaskFacts,
} from './queue-rules'

/* eslint-disable @typescript-eslint/no-explicit-any -- any Supabase-shaped client */

export interface AssigneeProfile {
  preferences: unknown
  timeZone: string | null
}

const uniqueIds = (ids: ReadonlyArray<string | null | undefined>) =>
  [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))]

/** Each assignee's users.preferences and time zone (one read). Unknown ids are absent. */
export async function loadAssigneeProfiles(db: any, assigneeIds: ReadonlyArray<string | null | undefined>): Promise<Map<string, AssigneeProfile>> {
  const ids = uniqueIds(assigneeIds)
  const out = new Map<string, AssigneeProfile>()
  if (!ids.length) return out
  try {
    const { data, error } = await db.from('users').select('id, preferences, timezone').in('id', ids)
    if (error) throw error
    for (const row of (data ?? []) as Array<{ id: string; preferences: unknown; timezone?: string | null }>) {
      out.set(String(row.id), { preferences: row.preferences ?? null, timeZone: row.timezone ?? null })
    }
  } catch {
    // Older schemas without users.timezone: preferences only.
    try {
      const { data } = await db.from('users').select('id, preferences').in('id', ids)
      for (const row of (data ?? []) as Array<{ id: string; preferences: unknown }>) out.set(String(row.id), { preferences: row.preferences ?? null, timeZone: null })
    } catch { /* default rules */ }
  }
  return out
}

/** Each assignee's users.preferences (one read). Unknown ids map to null. */
export async function loadAssigneePreferences(db: any, assigneeIds: Array<string | null | undefined>): Promise<Map<string, unknown>> {
  const profiles = await loadAssigneeProfiles(db, assigneeIds)
  return new Map([...profiles].map(([id, p]) => [id, p.preferences]))
}

async function rows(query: PromiseLike<{ data: any; error: any }>): Promise<any[]> {
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as any[]
}

/**
 * The org context each assignee's rules need, loaded once: reporting lines
 * for the workspace (one read), and the assigner's teams, org units (plus
 * every unit above them) and projects (direct, or through one of their
 * teams). Null for everyone when there's no workspace or the reads fail.
 */
export async function loadQueueOrgContexts(db: any, input: {
  tenantId: string | null | undefined
  assignerId: string | null | undefined
  assigneeIds: ReadonlyArray<string>
  needs: { reporting: boolean; teams: boolean; units: boolean; projects: boolean }
}): Promise<Map<string, QueueOrgContext> | null> {
  const { tenantId, assignerId, needs } = input
  if (!tenantId) return null
  try {
    const [lines, teamRows, unitRows, unitTree, projectRows] = await Promise.all([
      needs.reporting
        ? rows(db.from('user_memberships').select('user_id, manager_user_id').eq('tenant_id', tenantId).eq('is_active', true))
        : Promise.resolve([]),
      (needs.teams || needs.projects) && assignerId
        ? rows(db.from('user_teams').select('team_id').eq('user_id', assignerId))
        : Promise.resolve([]),
      needs.units && assignerId
        ? rows(db.from('org_unit_members').select('org_unit_id').eq('tenant_id', tenantId).eq('user_id', assignerId))
        : Promise.resolve([]),
      needs.units && assignerId
        ? rows(db.from('org_units').select('id, parent_id').eq('tenant_id', tenantId))
        : Promise.resolve([]),
      needs.projects && assignerId
        ? rows(db.from('project_members').select('project_id').eq('tenant_id', tenantId).eq('user_id', assignerId))
        : Promise.resolve([]),
    ])
    const assignerTeams = new Set(teamRows.map((r) => String(r.team_id)))
    const assignerProjects = new Set(projectRows.map((r) => String(r.project_id)))
    if (needs.projects && assignerTeams.size) {
      const viaTeams = await rows(db.from('project_teams').select('project_id').eq('tenant_id', tenantId).in('team_id', [...assignerTeams]))
      for (const r of viaTeams) assignerProjects.add(String(r.project_id))
    }
    // A member of a unit is in every unit above it (cycle-safe walk).
    const parentOf = new Map(unitTree.map((u) => [String(u.id), u.parent_id ? String(u.parent_id) : null]))
    const assignerUnits = new Set<string>()
    for (const r of unitRows) {
      let id: string | null = String(r.org_unit_id)
      let depth = 0
      while (id && !assignerUnits.has(id) && depth++ < 64) { assignerUnits.add(id); id = parentOf.get(id) ?? null }
    }
    const index = buildReportingIndex(lines.map((l): ReportingLine => ({ user_id: String(l.user_id), manager_user_id: l.manager_user_id ? String(l.manager_user_id) : null })))
    const out = new Map<string, QueueOrgContext>()
    for (const id of input.assigneeIds) {
      out.set(id, {
        managerChain: needs.reporting ? managerChain(index, id) : [],
        directReports: new Set(needs.reporting ? listReports(index, id).map((r) => r.user_id) : []),
        allReports: new Set(needs.reporting ? listReports(index, id, { indirect: true }).map((r) => r.user_id) : []),
        assignerTeams, assignerUnits, assignerProjects,
      })
    }
    return out
  } catch {
    return null
  }
}

/**
 * 'pending' (Queued) or 'accepted' for each assignee of one task: profiles
 * in one read, the org context once (only when some rules need it). The
 * node override wins over everyone's rules.
 */
export async function decideAcceptanceForAssignees(db: any, input: {
  tenantId?: string | null
  assigneeIds: ReadonlyArray<string | null | undefined>
  facts: QueueTaskFacts
  override?: unknown
}): Promise<Map<string, 'pending' | 'accepted'>> {
  const ids = uniqueIds(input.assigneeIds)
  const out = new Map<string, 'pending' | 'accepted'>()
  if (!ids.length) return out
  const profiles = await loadAssigneeProfiles(db, ids)
  const needs = { reporting: false, teams: false, units: false, projects: false }
  for (const id of ids) {
    const n = queueRulesOrgNeeds(resolveQueueRules(profiles.get(id)?.preferences ?? null))
    needs.reporting ||= n.reporting; needs.teams ||= n.teams; needs.units ||= n.units; needs.projects ||= n.projects
  }
  const anyNeeds = needs.reporting || needs.teams || needs.units || needs.projects
  const org = anyNeeds
    ? await loadQueueOrgContexts(db, { tenantId: input.tenantId, assignerId: input.facts.assigned_by_user_id ?? null, assigneeIds: ids, needs })
    : null
  for (const id of ids) {
    const profile = profiles.get(id)
    const context: QueueEvalContext = { assigneeId: id, org: org?.get(id) ?? null, timeZone: profile?.timeZone ?? null }
    out.set(id, decideAcceptance({ preferences: profile?.preferences ?? null, facts: input.facts, override: input.override, context }))
  }
  return out
}

/** 'pending' (Queued) or 'accepted' for a task assigned to this person. */
export async function acceptanceForAssignee(
  db: any,
  assigneeId: string | null | undefined,
  facts: QueueTaskFacts,
  override?: unknown,
  options: { tenantId?: string | null } = {},
): Promise<'pending' | 'accepted'> {
  if (!assigneeId) return decideAcceptance({ preferences: null, facts, override })
  const decided = await decideAcceptanceForAssignees(db, { tenantId: options.tenantId, assigneeIds: [assigneeId], facts, override })
  return decided.get(assigneeId) ?? decideAcceptance({ preferences: null, facts, override, context: { assigneeId } })
}
