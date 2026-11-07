/**
 * The reporting-line view of team tasks ("Group by reporting line" on My
 * team and on the Task tracker's Team members tab): the viewer's org tree
 * from reporting lines — level 1 their direct reports, each with their open
 * task counts (own, and rolled up over everyone below them) — so a CEO sees
 * their VPs, expands a VP to see their directors, and so on. Each person's
 * own tasks load when their node opens (tasks.reports with root + person).
 *
 * One load per request: the people snapshot (lib/org/load) and one task
 * query over the whole subtree (counts only) — no per-person reads.
 *
 * Scope: the caller's own reporting subtree. Someone else as the root needs
 * tasks.view_all, or must be in the caller's subtree. Needs a user and
 * tasks.view_own (or tasks.view_all), like the manager view.
 */

import { loadPeople } from '@/lib/org/load'
import { reportingIndexOf, subordinatesOf } from '@/lib/org/structure'
import { isInManagerChain } from '@/lib/reporting-lines'
import { HIERARCHY_TASK_LIMIT, rollupCounts, type HierarchyNode, type TaskCounts, type TeamHierarchy } from '@/lib/tasks/hierarchy'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'
import { OPEN_TASK_STATUSES } from './manager-tasks'

export type { HierarchyNode, TaskCounts, TeamHierarchy }

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

function nameOf(p: { display_name?: string | null; email?: string | null } | undefined, id: string): string {
  return p?.display_name || p?.email || id.slice(0, 8)
}

export async function getTeamHierarchy(ctx: ServiceContext, input: { root?: string | null; search?: string | null } = {}): Promise<TeamHierarchy> {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: the reporting-line view needs a user (a user-bound credential)')
  if (!hasPerm(ctx, 'tasks.view_own') && !hasPerm(ctx, 'tasks.view_all')) requirePerm(ctx, 'tasks.view_own')
  const db = await serviceRoleClient(ctx)
  const people = await loadPeople(db, ctx.tenantId)
  const byId = new Map(people.map((p) => [p.id, p]))
  const index = reportingIndexOf(people)
  const viewAll = hasPerm(ctx, 'tasks.view_all')

  const root = input.root && input.root !== ctx.actorId ? String(input.root) : ctx.actorId
  if (root !== ctx.actorId) {
    if (!byId.has(root)) throw ServiceError.notFound('That person is not a member of this workspace')
    if (!viewAll && !isInManagerChain(index, ctx.actorId, root)) throw ServiceError.validation('That person is not in your reporting line')
  }

  const subs = subordinatesOf(index, root, { depth: 'all' })
  const ids = subs.map((s) => s.user_id)
  const depth = new Map(subs.map((s) => [s.user_id, s.depth]))

  // One read: open tasks of everyone in the subtree (counts and search).
  const own = new Map<string, TaskCounts>()
  const taskMatch = new Set<string>()
  const term = input.search?.trim().toLowerCase() ?? ''
  let truncated = false
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await (db as any).from('tasks')
      .select('assignee_id, title, due_date, acceptance_status')
      .eq('tenant_id', ctx.tenantId).is('deleted_at', null)
      .in('assignee_id', ids.slice(i, i + 200)).in('status', [...OPEN_TASK_STATUSES])
      .limit(HIERARCHY_TASK_LIMIT)
    if (error) throw dbError(error)
    const rows = (data ?? []) as any[]
    if (rows.length >= HIERARCHY_TASK_LIMIT) truncated = true
    const now = Date.now()
    for (const t of rows) {
      const who = String(t.assignee_id)
      const c = own.get(who) ?? { open: 0, overdue: 0, queued: 0 }
      c.open++
      if (t.due_date && new Date(t.due_date).getTime() < now) c.overdue++
      if (t.acceptance_status === 'pending') c.queued++
      own.set(who, c)
      if (term && String(t.title ?? '').toLowerCase().includes(term)) taskMatch.add(who)
    }
  }
  const rollup = rollupCounts(index, ids, own)

  const byName = (a: string, b: string) => nameOf(byId.get(a), a).localeCompare(nameOf(byId.get(b), b))
  const nodes: Record<string, HierarchyNode> = {}
  for (const id of ids) {
    const p = byId.get(id)
    const reports = (index.reportsOf.get(id) ?? []).filter((r) => depth.has(r)).sort(byName)
    const personMatch = Boolean(term) && [p?.display_name, p?.email, p?.job_title].some((v) => String(v ?? '').toLowerCase().includes(term))
    nodes[id] = {
      id, name: nameOf(p, id), email: p?.email ?? null, avatar_url: p?.avatar_url ?? null, job_title: p?.job_title ?? null,
      manager_user_id: p?.manager_user_id ?? null, depth: depth.get(id) ?? 1, reports,
      own: own.get(id) ?? { open: 0, overdue: 0, queued: 0 }, rollup: rollup.get(id) ?? { open: 0, overdue: 0, queued: 0 }, match: personMatch || taskMatch.has(id),
    }
  }

  const rootOptions = viewAll
    ? people.filter((p) => (index.reportsOf.get(p.id) ?? []).length > 0).map((p) => ({ id: p.id, name: nameOf(p, p.id) })).sort((a, b) => a.name.localeCompare(b.name))
    : null

  return {
    root: { id: root, name: nameOf(byId.get(root), root) },
    top: (index.reportsOf.get(root) ?? []).filter((r) => depth.get(r) === 1).sort(byName),
    nodes,
    rootOptions,
    truncated,
  }
}
