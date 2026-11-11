/**
 * Active tasks: every open human task (workflow User Tasks not completed or
 * cancelled — queued, accepted, held, team and unassigned ones) the caller
 * may see, for the workflow queue page's "Active tasks" tab and the Agent's
 * task tools (find_active_tasks).
 *
 * Visibility (service-role reads, tenant-filtered, after these checks):
 *  - tasks.view_all: every active task in the workspace;
 *  - otherwise the union of: tasks they are on (assignee, collaborator, a
 *    team they are in), tasks of anyone in their reporting chain (direct or
 *    indirect reports, lib/reporting-lines.ts), and every task of a workflow
 *    they manage (explicit Edit grant, lib/workflow-grants.ts).
 * Per row, what the caller may do (lib/task-authz.ts decideTaskAssignment):
 * take ownership, reassign; bulk reassign is for tasks.complete_any holders.
 */

import { decideTaskAssignment, type AuthzTask, type TaskActorFacts } from '@/lib/task-authz'
import { isInManagerChain, listReports, loadReportingIndex } from '@/lib/reporting-lines'
import { workflowGrantIds } from '@/lib/workflow-grants'
import { slaStatus, WAITING_TIME_MS, type WaitingSla, type ActiveTaskFilters } from '@/lib/automations/active-task-filters'
import { CLAIM_CANDIDATE_ROLE } from '@/lib/tasks/unified-list'
import { escapeLikePattern } from '@/lib/utils'
import { hasPerm, requireAny, ServiceError, type ServiceContext } from './context'
import { dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const OPEN_WAITING_STATUSES = ['todo', 'in_progress', 'blocked'] as const
/** Ids gathered per visibility tier (a non-admin's scope). */
const SCOPE_CAP = 5000

export type WaitingState = 'assigned' | 'queued' | 'held' | 'team' | 'claim' | 'unassigned'

export interface ActiveTask {
  id: string
  title: string
  status: string
  state: WaitingState
  priority: string | null
  due_date: string | null
  sla: WaitingSla
  created_at: string | null
  waiting_since: string | null
  workflow: { id: string; name: string } | null
  run_id: string | null
  /** When the workflow run behind the task was started. */
  run_started_at: string | null
  assignee: { id: string; name: string } | null
  team: { id: string; name: string } | null
  /** Collaborators / claim candidates besides the assignee. */
  others: number
  can_take_ownership: boolean
  can_reassign: boolean
}

export interface ActiveTasksPage {
  tasks: ActiveTask[]
  total: number
  /** Workflows with active tasks in the caller's scope (the Workflow filter). */
  workflows: Array<{ id: string; name: string }>
  /** Every active task in the workspace (tasks.view_all), or a narrower scope. */
  scope: 'all' | 'mine'
  /** tasks.complete_any: may bulk reassign. */
  can_bulk_reassign: boolean
}

const has = (ctx: ServiceContext, key: string) => hasPerm(ctx, key)

const TASK_SELECT = 'id, tenant_id, title, status, priority, due_date, created_at, accepted_at, acceptance_status, assignee_id, assigned_team_id, assignment_mode, assignment_type, workflow_id, workflow_run_id, is_workflow_task, event_id, allow_reassign'

function openTasks(db: any, tenantId: string, columns = 'id', options?: { count: 'exact' }) {
  return db.from('tasks').select(columns, options).eq('tenant_id', tenantId).eq('is_workflow_task', true)
    .in('status', [...OPEN_WAITING_STATUSES]).is('deleted_at', null)
}

/** The ids a non-admin may see (null = everything: tasks.view_all). */
async function visibleTaskIds(ctx: ServiceContext, db: any): Promise<{ ids: Set<string> | null; reports: string[]; teams: string[]; managedWorkflows: Set<string> }> {
  const me = ctx.actorId!
  const tenantId = ctx.tenantId
  const [index, teamsResult, managed] = await Promise.all([
    loadReportingIndex(db, tenantId),
    db.from('user_teams').select('team_id').eq('user_id', me),
    workflowGrantIds(db, tenantId, me, 'can_edit'),
  ])
  const reports = listReports(index, me, { indirect: true }).map((r) => r.user_id)
  // Teams of this workspace only (user_teams has no tenant column).
  const myTeamIds = ((teamsResult.data ?? []) as any[]).map((t) => String(t.team_id)).filter(Boolean)
  const { data: tenantTeams } = myTeamIds.length ? await db.from('teams').select('id').eq('tenant_id', tenantId).in('id', myTeamIds) : { data: [] }
  const teams = ((tenantTeams ?? []) as any[]).map((t) => String(t.id))
  const managedWorkflows = new Set(managed)
  if (has(ctx, 'tasks.view_all')) return { ids: null, reports, teams, managedWorkflows }
  const people = [me, ...reports]
  const [byAssignee, byTeam, byWorkflow, byCollab] = await Promise.all([
    openTasks(db, tenantId).in('assignee_id', people).limit(SCOPE_CAP),
    teams.length ? openTasks(db, tenantId).in('assigned_team_id', teams).limit(SCOPE_CAP) : Promise.resolve({ data: [] }),
    managedWorkflows.size ? openTasks(db, tenantId).in('workflow_id', [...managedWorkflows]).limit(SCOPE_CAP) : Promise.resolve({ data: [] }),
    db.from('task_assignees').select('task_id').eq('tenant_id', tenantId).in('user_id', people).limit(SCOPE_CAP),
  ])
  for (const r of [byAssignee, byTeam, byWorkflow, byCollab] as any[]) if (r.error) throw dbError(r.error)
  const ids = new Set<string>()
  for (const r of [byAssignee, byTeam, byWorkflow] as any[]) for (const t of r.data ?? []) ids.add(String(t.id))
  for (const a of (byCollab.data ?? []) as any[]) ids.add(String(a.task_id))
  return { ids, reports, teams, managedWorkflows }
}

/** One page of active tasks for the caller's scope and filters. */
export async function listActiveTasks(ctx: ServiceContext, filters: Partial<ActiveTaskFilters> & { ids?: string[] | null } = {}): Promise<ActiveTasksPage> {
  requireAny(ctx, ['tasks.view_own', 'tasks.view_all', 'workflows.view_queue', 'workflows.view_runs'])
  if (!ctx.actorId) throw ServiceError.forbidden('Active tasks need a signed-in person')
  const me = ctx.actorId
  const db = await serviceRoleClient(ctx) as any
  const scope = await visibleTaskIds(ctx, db)
  const page = Math.max(1, Math.floor(filters.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(filters.pageSize ?? 25)))
  const canBulk = has(ctx, 'tasks.complete_any')
  const empty: ActiveTasksPage = { tasks: [], total: 0, workflows: [], scope: scope.ids ? 'mine' : 'all', can_bulk_reassign: canBulk }

  let ids: string[] | null = scope.ids ? [...scope.ids] : null
  if (filters.ids?.length) ids = ids ? ids.filter((id) => filters.ids!.includes(id)) : filters.ids
  if (ids && !ids.length) return empty

  // The Workflow filter's options: the workflows of every active task in scope.
  let wfQuery = openTasks(db, ctx.tenantId, 'workflow_id').limit(SCOPE_CAP)
  if (ids) wfQuery = wfQuery.in('id', ids)
  const now = Date.now()
  let q = openTasks(db, ctx.tenantId, TASK_SELECT, { count: 'exact' })
  if (ids) q = q.in('id', ids)
  if (filters.search?.trim()) q = q.ilike('title', `%${escapeLikePattern(filters.search.trim())}%`)
  if (filters.assignee) q = q.eq('assignee_id', filters.assignee)
  if (filters.workflow) q = q.eq('workflow_id', filters.workflow)
  if (filters.priority) q = q.eq('priority', filters.priority)
  if (filters.unassigned) q = q.is('assignee_id', null).is('assigned_team_id', null)
  if (filters.waiting) q = q.lt('created_at', new Date(now - WAITING_TIME_MS[filters.waiting]).toISOString())
  if (filters.sla === 'overdue') q = q.lt('due_date', new Date(now).toISOString())
  else if (filters.sla === 'due_soon') q = q.gte('due_date', new Date(now).toISOString()).lt('due_date', new Date(now + 86_400_000).toISOString())
  else if (filters.sla === 'on_track') q = q.gte('due_date', new Date(now + 86_400_000).toISOString())
  else if (filters.sla === 'none') q = q.is('due_date', null)
  q = q.order('created_at', { ascending: true }).range((page - 1) * pageSize, page * pageSize - 1)

  const [{ data: rows, error, count }, wfRows] = await Promise.all([q, wfQuery])
  if (error) throw dbError(error)
  const tasks = (rows ?? []) as any[]
  const workflowIds = [...new Set([...((wfRows.data ?? []) as any[]).map((r) => r.workflow_id).filter(Boolean), ...tasks.map((t) => t.workflow_id)].filter(Boolean).map(String))]
  const taskIds = tasks.map((t) => String(t.id))
  const runIds = [...new Set(tasks.map((t) => t.workflow_run_id).filter(Boolean).map(String))]
  const [workflowsResult, collabResult, reporting, runsResult] = await Promise.all([
    workflowIds.length ? db.from('workflows').select('id, name').eq('tenant_id', ctx.tenantId).in('id', workflowIds) : Promise.resolve({ data: [] }),
    taskIds.length ? db.from('task_assignees').select('task_id, user_id, role').eq('tenant_id', ctx.tenantId).in('task_id', taskIds) : Promise.resolve({ data: [] }),
    loadReportingIndex(db, ctx.tenantId),
    runIds.length ? db.from('workflow_runs').select('id, started_at').in('id', runIds) : Promise.resolve({ data: [] }),
  ])
  const runStarted = new Map(((runsResult.data ?? []) as any[]).map((r) => [String(r.id), r.started_at ? String(r.started_at) : null]))
  const collabs = new Map<string, any[]>()
  for (const c of (collabResult.data ?? []) as any[]) collabs.set(String(c.task_id), [...(collabs.get(String(c.task_id)) ?? []), c])
  const teamIds = [...new Set(tasks.map((t) => t.assigned_team_id).filter(Boolean).map(String))]
  const personIds = [...new Set([...tasks.map((t) => t.assignee_id), ...[...collabs.values()].flat().map((c) => c.user_id)].filter(Boolean).map(String))]
  const [usersResult, teamsResult] = await Promise.all([
    personIds.length ? db.from('users').select('id, display_name, email').in('id', personIds) : Promise.resolve({ data: [] }),
    teamIds.length ? db.from('teams').select('id, name').eq('tenant_id', ctx.tenantId).in('id', teamIds) : Promise.resolve({ data: [] }),
  ])
  const names = new Map(((usersResult.data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')]))
  const teamNames = new Map(((teamsResult.data ?? []) as any[]).map((t) => [String(t.id), String(t.name ?? 'Team')]))
  const wfNames = new Map(((workflowsResult.data ?? []) as any[]).map((w) => [String(w.id), String(w.name ?? 'Workflow')]))
  const myTeams = new Set(scope.teams)

  const out: ActiveTask[] = tasks.map((t) => {
    const id = String(t.id)
    const people = collabs.get(id) ?? []
    const assigneeIds = [...new Set([...(t.assignee_id ? [String(t.assignee_id)] : []), ...people.filter((c) => c.role !== CLAIM_CANDIDATE_ROLE).map((c) => String(c.user_id))])]
    const candidates = people.filter((c) => c.role === CLAIM_CANDIDATE_ROLE)
    const isAssignee = assigneeIds.includes(me)
    const isTeamMember = !isAssignee && !t.assignee_id && Boolean(t.assigned_team_id) && myTeams.has(String(t.assigned_team_id))
    const managedAssigneeId = !isAssignee && !isTeamMember ? assigneeIds.find((uid) => isInManagerChain(reporting, me, uid)) ?? null : null
    const isWorkflowManager = !isAssignee && !isTeamMember && !managedAssigneeId && Boolean(t.workflow_id) && scope.managedWorkflows.has(String(t.workflow_id))
    // Claim candidates count as "on the task" (not unassigned) — they claim it.
    const facts: TaskActorFacts = { isAssignee, isTeamMember, assigneeIds: [...assigneeIds, ...candidates.map((c) => String(c.user_id))], managedAssigneeId, isWorkflowManager }
    const decide = (action: 'take' | 'assign') => has(ctx, 'tasks.complete') && decideTaskAssignment({ task: t as AuthzTask, actorId: me, permissions: ctx.permissions, facts, action }).allowed
    const state: WaitingState = t.assignee_id
      ? (t.acceptance_status === 'pending' || t.acceptance_status === 'queued' ? 'queued' : t.acceptance_status === 'held' ? 'held' : 'assigned')
      : t.assigned_team_id ? 'team' : candidates.length ? 'claim' : assigneeIds.length ? 'assigned' : 'unassigned'
    return {
      id,
      title: String(t.title ?? 'Task'),
      status: String(t.status),
      state,
      priority: t.priority ?? null,
      due_date: t.due_date ?? null,
      sla: slaStatus(t.due_date, now),
      created_at: t.created_at ?? null,
      waiting_since: t.created_at ?? null,
      workflow: t.workflow_id ? { id: String(t.workflow_id), name: wfNames.get(String(t.workflow_id)) ?? 'Workflow' } : null,
      run_id: t.workflow_run_id ? String(t.workflow_run_id) : null,
      run_started_at: t.workflow_run_id ? runStarted.get(String(t.workflow_run_id)) ?? null : null,
      assignee: t.assignee_id ? { id: String(t.assignee_id), name: names.get(String(t.assignee_id)) ?? 'Someone' } : null,
      team: t.assigned_team_id ? { id: String(t.assigned_team_id), name: teamNames.get(String(t.assigned_team_id)) ?? 'A team' } : null,
      others: Math.max(0, assigneeIds.length + candidates.length - (t.assignee_id ? 1 : 0)),
      can_take_ownership: decide('take'),
      can_reassign: decide('assign'),
    }
  })
  return {
    tasks: out,
    total: count ?? out.length,
    workflows: workflowIds.map((id) => ({ id, name: wfNames.get(id) ?? 'Workflow' })).sort((a, b) => a.name.localeCompare(b.name)),
    scope: scope.ids ? 'mine' : 'all',
    can_bulk_reassign: canBulk,
  }
}
