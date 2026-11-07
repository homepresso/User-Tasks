/**
 * Home (/home): the signed-in person's start page, and its REST / MCP / CLI
 * twins (lib/api-schemas/home.ts, lib/mcp/tools/home.ts).
 *
 *  - Metrics (one read per card): my tasks, my submissions, runs I follow.
 *  - My tasks: open tasks assigned to me (process, stage, due, priority);
 *    the app's list (include_queued) also has the queued ones.
 *  - Queued (the API's queue list): tasks I can take — waiting for my
 *    acceptance (assigned to me or as a collaborator), and unassigned tasks
 *    of my teams (Claim). The app shows them in My tasks with status Queued.
 *  - Following: runs I follow (run_followers) with where they are and who
 *    has them. Runs I start — form submissions included — are followed
 *    automatically unless my auto_follow_runs preference is off.
 *  - My submissions: forms I submitted with the run each one started.
 *  - Run progress: the submitter-safe flow view of one run (step names,
 *    statuses, assignees, dates; never configs, outputs, variables or form
 *    values).
 *  - Favourite forms: starred forms I can still open.
 *  - Layout: my Home grid (widget order, sizes, hidden ones) per workspace.
 *
 * Access: everything is the caller's own (ctx.actorId). Runs follow
 * can_view_run_progress (started it, their submission started it, they had a
 * task in it, or workflows.view_runs); forms follow can_open_form
 * (forms.submit). Reads use the service-role client with explicit tenant /
 * user filters (the SQL functions also refuse a signed-in caller asking for
 * someone else); writes check access explicitly first.
 */

import { audit, dbError, ilikeTerm, serviceRoleClient, type Page } from './_shared'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'
import type { RunTask } from '@/lib/run-tasks'
import { submissionMetaFromRow, type SubmissionMeta } from '@/lib/forms/submission-meta'
import { CLAIM_CANDIDATE_ROLE, queueActionFor, type QueueScope } from '@/lib/tasks/unified-list'
import {
  OPEN_TASK_STATUSES, isLiveRunStatus, peopleInvolved, progressLabel, progressStatus, safeEdge, safeNode, safeOverlay, safeSection,
  type ProgressStatus, type RunStage, type SafeEdge, type SafeNode, type SafeOverlay,
} from '@/lib/home/progress'
import {
  DESKTOP_COLS, GAP_PX, HOME_WIDGETS, MAX_LAYOUT_BYTES, ROW_PX, canUseWidget, defaultHomeLayout, homeLayoutInputSchema, normaliseHomeLayout,
  type HomeLayout, type HomeWidgetDef, type HomeWidgetId,
} from '@/lib/home/layout'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function actor(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('Home is personal: use a credential bound to a user')
  return ctx.actorId
}

function pageArgs(page: Page): { limit: number; offset: number } {
  return { limit: Math.min(Math.max(page.limit ?? 25, 1), 100), offset: Math.max(page.offset, 0) }
}

/* ── Metrics ─────────────────────────────────────────────────────────── */

export interface TaskMetrics { open: number; overdue: number; sla_breached: number; completed_30d: number; queue: number }
export interface SubmissionMetrics { in_progress: number; completed_30d: number; submitted_30d: number }
export interface FollowMetrics { active: number; updated_today: number; total: number }

async function metrics<T>(ctx: ServiceContext, fn: string): Promise<T> {
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).rpc(fn, { p_tenant_id: ctx.tenantId, p_user_id: actor(ctx) })
  if (error) throw dbError(error)
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries((data ?? {}) as Record<string, unknown>)) out[k] = Number(v) || 0
  return out as T
}

/** My tasks card (tasks.view_own). */
export async function getTaskMetrics(ctx: ServiceContext): Promise<TaskMetrics> {
  requirePerm(ctx, 'tasks.view_own')
  return metrics<TaskMetrics>(ctx, 'home_task_metrics')
}

/** My submissions card (forms.submit). */
export async function getSubmissionMetrics(ctx: ServiceContext): Promise<SubmissionMetrics> {
  requirePerm(ctx, 'forms.submit')
  return metrics<SubmissionMetrics>(ctx, 'home_submission_metrics')
}

/** Following card. */
export async function getFollowMetrics(ctx: ServiceContext): Promise<FollowMetrics> {
  return metrics<FollowMetrics>(ctx, 'home_follow_metrics')
}

/** All three cards at once (REST / MCP); a card the caller has no permission for is null. */
export async function getHomeMetrics(ctx: ServiceContext): Promise<{ tasks: TaskMetrics | null; submissions: SubmissionMetrics | null; following: FollowMetrics }> {
  actor(ctx)
  const [tasks, submissions, following] = await Promise.all([
    hasPerm(ctx, 'tasks.view_own') ? getTaskMetrics(ctx) : Promise.resolve(null),
    hasPerm(ctx, 'forms.submit') ? getSubmissionMetrics(ctx) : Promise.resolve(null),
    getFollowMetrics(ctx),
  ])
  return { tasks, submissions, following }
}

/* ── Side menu badges ────────────────────────────────────────────────── */

/**
 * The side menu's pending counts in one read (nav_task_counts):
 *  - my_tasks: = the My tasks card's `open` (assigned to me, not awaiting my acceptance);
 *  - queue:    = the card's `queue` (awaiting my acceptance, or my teams' unassigned tasks);
 *  - tracker:  Task Tracker's default view ("Assigned by me"), open tasks only.
 * A count the caller can't see (no permission for that menu item) is 0.
 */
export interface NavCounts { my_tasks: number; queue: number; tracker: number }

export async function getNavCounts(ctx: ServiceContext): Promise<NavCounts> {
  actor(ctx)
  const none: NavCounts = { my_tasks: 0, queue: 0, tracker: 0 }
  const own = hasPerm(ctx, 'tasks.view_own')
  const tracker = hasPerm(ctx, 'tasks.view_all')
  if (!own && !tracker) return none
  const counts = await metrics<NavCounts>(ctx, 'nav_task_counts')
  return {
    my_tasks: own ? counts.my_tasks ?? 0 : 0,
    queue: own ? counts.queue ?? 0 : 0,
    tracker: tracker ? counts.tracker ?? 0 : 0,
  }
}

/* ── Step labels, stages and people ──────────────────────────────────── */

type LabelKey = string
const labelKey = (versionId: string | null | undefined, workflowId: string | null | undefined, nodeId: string): LabelKey =>
  versionId ? `v:${versionId}:${nodeId}` : `w:${workflowId ?? ''}:${nodeId}`

/** Step labels (never configs) of these versions / drafts. */
async function nodeLabels(db: AnySupabaseClient, tenantId: string, versionIds: string[], workflowIds: string[]): Promise<Map<LabelKey, string>> {
  const out = new Map<LabelKey, string>()
  const versions = [...new Set(versionIds.filter(Boolean))]
  const workflows = [...new Set(workflowIds.filter(Boolean))]
  if (!versions.length && !workflows.length) return out
  const { data, error } = await (db as any).rpc('workflow_node_labels', { p_tenant_id: tenantId, p_version_ids: versions, p_workflow_ids: workflows })
  if (error) throw dbError(error)
  for (const row of (data ?? []) as any[]) {
    if (!row.node_id) continue
    out.set(labelKey(row.version_id, row.workflow_id, row.node_id), String(row.label || row.node_type || 'Step'))
  }
  return out
}

function lookupLabel(labels: Map<LabelKey, string>, versionId: string | null | undefined, workflowId: string | null | undefined, nodeId: string | null | undefined): string | null {
  if (!nodeId) return null
  return labels.get(labelKey(versionId, workflowId, nodeId)) ?? (versionId ? labels.get(labelKey(null, workflowId, nodeId)) : undefined) ?? null
}

async function userNames(db: AnySupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('users').select('id, display_name, email').in('id', unique)
  for (const u of (data ?? []) as any[]) out.set(u.id, String(u.display_name || (u.email ? String(u.email).split('@')[0] : '') || 'Someone'))
  void tenantId
  return out
}

async function teamNames(db: AnySupabaseClient, tenantId: string, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  const out = new Map<string, string>()
  if (!unique.length) return out
  const { data } = await (db as any).from('teams').select('id, name').eq('tenant_id', tenantId).in('id', unique)
  for (const t of (data ?? []) as any[]) out.set(t.id, String(t.name ?? 'Team'))
  return out
}

export interface RunRef {
  run_id: string
  run_status: string | null
  workflow_id: string | null
  version_id: string | null
  event_id: string | null
  paused_node_id: string | null
  wait_node_ids: string[] | null
  updated_at: string | null
}

/**
 * Where each live run is: its open tasks (step label, assignee / team,
 * since, due), else the step(s) it waits on. Finished runs have no stages.
 */
export async function loadRunStages(db: AnySupabaseClient, tenantId: string, runs: RunRef[]): Promise<Map<string, RunStage[]>> {
  const out = new Map<string, RunStage[]>()
  const live = runs.filter((r) => isLiveRunStatus(r.run_status))
  if (!live.length) return out
  const runIds = live.map((r) => r.run_id)
  const eventIds = live.map((r) => r.event_id).filter((e): e is string => !!e)
  const byEvent = new Map(live.filter((r) => r.event_id).map((r) => [r.event_id!, r.run_id]))
  const filter = [`workflow_run_id.in.(${runIds.join(',')})`, ...(eventIds.length ? [`event_id.in.(${eventIds.map((e) => `"${e.replace(/"/g, '')}"`).join(',')})`] : [])].join(',')
  const { data: taskRows, error } = await (db as any).from('tasks')
    .select('id, workflow_run_id, event_id, workflow_step_id, workflow_id, assignee_id, assigned_team_id, created_at, due_date')
    .eq('tenant_id', tenantId).is('deleted_at', null).in('status', [...OPEN_TASK_STATUSES]).or(filter).order('created_at').order('id').limit(500)
  if (error) throw dbError(error)
  const tasks = ((taskRows ?? []) as any[]).map((t) => ({ ...t, run: t.workflow_run_id ?? byEvent.get(t.event_id) ?? null })).filter((t) => t.run && runIds.includes(t.run))

  // Collaborative tasks (no single assignee, no team): their collaborators.
  const collabTaskIds = tasks.filter((t) => !t.assignee_id && !t.assigned_team_id).map((t) => t.id)
  const collaborators = new Map<string, string[]>()
  if (collabTaskIds.length) {
    const { data } = await (db as any).from('task_assignees').select('task_id, user_id').eq('tenant_id', tenantId).in('task_id', collabTaskIds)
    for (const row of (data ?? []) as any[]) collaborators.set(row.task_id, [...(collaborators.get(row.task_id) ?? []), row.user_id])
  }
  const runById = new Map(live.map((r) => [r.run_id, r]))
  const [names, teams, labels] = await Promise.all([
    userNames(db, tenantId, [...tasks.map((t) => t.assignee_id), ...[...collaborators.values()].flat()]),
    teamNames(db, tenantId, tasks.map((t) => t.assigned_team_id)),
    nodeLabels(db, tenantId, live.map((r) => r.version_id ?? ''), live.filter((r) => !r.version_id).map((r) => r.workflow_id ?? '')),
  ])
  for (const t of tasks) {
    const run = runById.get(t.run)!
    const ids: string[] = t.assignee_id ? [t.assignee_id] : (collaborators.get(t.id) ?? [])
    const stage: RunStage = {
      node_id: t.workflow_step_id ?? null,
      name: lookupLabel(labels, run.version_id, run.workflow_id, t.workflow_step_id) ?? 'Task',
      assignees: ids.map((id) => ({ id, name: names.get(id) ?? 'Someone' })),
      team: t.assigned_team_id ? (teams.get(t.assigned_team_id) ?? 'A team') : null,
      since: t.created_at ?? null,
      due_date: t.due_date ?? null,
    }
    out.set(run.run_id, [...(out.get(run.run_id) ?? []), stage])
  }
  // Waiting with no open task (a timer, an event, an e-signature…): the step(s) it waits on.
  for (const run of live) {
    if (out.has(run.run_id) || run.run_status === 'running') continue
    const nodeIds = [...new Set([...(run.wait_node_ids ?? []), ...(run.paused_node_id ? [run.paused_node_id] : [])].filter(Boolean))]
    const stages = nodeIds.map((nodeId): RunStage => ({
      node_id: nodeId, name: lookupLabel(labels, run.version_id, run.workflow_id, nodeId) ?? 'A step', assignees: [], team: null, since: run.updated_at, due_date: null,
    }))
    if (stages.length) out.set(run.run_id, stages)
  }
  return out
}

/* ── My tasks / Task queue ───────────────────────────────────────────── */

export interface HomeTask {
  id: string
  title: string
  status: string
  priority: string
  due_date: string | null
  overdue: boolean
  sla_status: string | null
  /** When it reached me (accepted, else created). */
  assigned_at: string | null
  process: { workflow_id: string; name: string } | null
  stage: string | null
  acceptance_status: string | null
  team: string | null
  /** The workflow run the task belongs to (Process view), if any. */
  run_id: string | null
  /** Queue: what I can do with it. */
  action?: 'accept' | 'claim'
}

const TASK_COLUMNS = 'id, title, status, priority, due_date, created_at, accepted_at, acceptance_status, workflow_id, workflow_step_id, workflow_run_id, event_id, assigned_team_id, workflow:workflows(id, name)'

async function shapeTasks(db: AnySupabaseClient, tenantId: string, rows: any[]): Promise<HomeTask[]> {
  const runIds = rows.map((r) => r.workflow_run_id).filter(Boolean)
  const eventIds = rows.filter((r) => !r.workflow_run_id && r.event_id).map((r) => r.event_id)
  const runs = new Map<string, any>()
  if (runIds.length || eventIds.length) {
    const filter = [...(runIds.length ? [`id.in.(${runIds.join(',')})`] : []), ...(eventIds.length ? [`event_id.in.(${eventIds.map((e: string) => `"${String(e).replace(/"/g, '')}"`).join(',')})`] : [])].join(',')
    const { data } = await (db as any).from('workflow_runs').select('id, workflow_id, version_id, event_id, sla_status').eq('tenant_id', tenantId).or(filter)
    for (const r of (data ?? []) as any[]) { runs.set(r.id, r); if (r.event_id) runs.set(`e:${r.event_id}`, r) }
  }
  const runOf = (t: any) => (t.workflow_run_id ? runs.get(t.workflow_run_id) : t.event_id ? runs.get(`e:${t.event_id}`) : null) ?? null
  const [labels, teams] = await Promise.all([
    nodeLabels(db, tenantId,
      rows.map((t) => runOf(t)?.version_id ?? ''),
      rows.filter((t) => t.workflow_id && !runOf(t)?.version_id).map((t) => t.workflow_id)),
    teamNames(db, tenantId, rows.map((t) => t.assigned_team_id)),
  ])
  const now = Date.now()
  return rows.map((t): HomeTask => {
    const run = runOf(t)
    return {
      id: t.id,
      title: String(t.title ?? ''),
      status: t.status,
      priority: t.priority,
      due_date: t.due_date ?? null,
      overdue: !!t.due_date && new Date(t.due_date).getTime() < now,
      sla_status: run?.sla_status && run.sla_status !== 'none' ? run.sla_status : null,
      assigned_at: t.accepted_at ?? t.created_at ?? null,
      process: t.workflow?.id ? { workflow_id: t.workflow.id, name: String(t.workflow.name ?? 'Workflow') } : null,
      stage: t.workflow_step_id ? lookupLabel(labels, run?.version_id, t.workflow_id, t.workflow_step_id) : null,
      acceptance_status: t.acceptance_status ?? null,
      team: t.assigned_team_id ? (teams.get(t.assigned_team_id) ?? null) : null,
      run_id: t.workflow_run_id ?? run?.id ?? null,
    }
  })
}

export type TaskSort = 'due' | 'priority' | 'newest'

/** The app's column sort (Home My tasks headers): column and direction. */
export type TaskColumnSort = { key: 'title' | 'status' | 'priority' | 'due' | 'assigned'; dir: 'asc' | 'desc' }
const COLUMN_SORT: Record<TaskColumnSort['key'], string> = { title: 'title', status: 'status', priority: 'priority', due: 'due_date', assigned: 'created_at' }

/**
 * Open tasks assigned to me (accepted or not asked), soonest due first.
 * With include_queued (the app's unified My tasks list) also the tasks
 * queued for me — awaiting my acceptance (mine or as a collaborator) or my
 * teams' unclaimed ones — each with its action (accept / claim); queued_only
 * lists just those (= listQueueTasks).
 */
export async function listMyTasks(ctx: ServiceContext, input: {
  search?: string | null; sort?: TaskSort | null; include_queued?: boolean; queued_only?: boolean
  /** A column sort (overrides `sort`); paging follows it. */
  column_sort?: TaskColumnSort | null
  /** Completed / cancelled tasks too ("Show completed"). */
  include_closed?: boolean
}, page: Page): Promise<{ tasks: HomeTask[]; total: number }> {
  if (input.queued_only) return listQueueTasks(ctx, { search: input.search }, page)
  requirePerm(ctx, 'tasks.view_own')
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  const { limit, offset } = pageArgs(page)
  let scope: QueueScope | null = null
  let query = (db as any).from('tasks').select(`${TASK_COLUMNS}, assignee_id`, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId).is('deleted_at', null).is('parent_task_id', null)
  if (!input.include_closed) query = query.in('status', [...OPEN_TASK_STATUSES])
  if (input.include_queued) {
    const { teams, collabIds, candidateIds } = await queueSources(db, ctx.tenantId, me)
    scope = { userId: me, teamIds: new Set(teams), collabPendingIds: new Set(collabIds), claimCandidateIds: new Set(candidateIds) }
    query = query.or(queueOrParts(me, teams, collabIds, true).join(','))
  } else {
    query = query.eq('assignee_id', me).neq('acceptance_status', 'pending')
  }
  if (input.search?.trim()) query = query.ilike('title', `%${ilikeTerm(input.search)}%`)
  const sort = input.sort ?? 'due'
  const column = input.column_sort && COLUMN_SORT[input.column_sort.key]
  if (column) query = query.order(column, { ascending: input.column_sort!.dir !== 'desc', nullsFirst: false }).order('due_date', { ascending: true, nullsFirst: false })
  else if (sort === 'priority') query = query.order('priority', { ascending: true }).order('due_date', { ascending: true, nullsFirst: false })
  else if (sort === 'newest') query = query.order('created_at', { ascending: false })
  else query = query.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  const { data, count, error } = await query.order('id').range(offset, offset + limit - 1)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const shaped = await shapeTasks(db, ctx.tenantId, rows)
  if (!scope) return { tasks: shaped, total: count ?? 0 }
  const queueScope = scope
  return {
    tasks: shaped.map((t, i) => {
      const action = queueActionFor(rows[i], queueScope)
      return action ? { ...t, action } : t
    }),
    total: count ?? 0,
  }
}

/** My teams and my pending collaborations in this workspace (the queue's sources). */
async function queueSources(db: AnySupabaseClient, tenantId: string, me: string): Promise<{ teams: string[]; collabIds: string[]; candidateIds: string[] }> {
  const [teams, { data: collab }] = await Promise.all([
    myTeams(db, tenantId, me),
    (db as any).from('task_assignees').select('task_id, role').eq('tenant_id', tenantId).eq('user_id', me).eq('acceptance_status', 'pending').limit(500),
  ])
  const rows = ((collab ?? []) as any[]).filter((c) => typeof c.task_id === 'string' && UUID_RE.test(c.task_id))
  return {
    teams: teams.filter((t) => UUID_RE.test(t)),
    collabIds: rows.map((c) => c.task_id as string),
    // AAD group claim candidates (lib/tasks/aad-group-runtime.ts): Claim, not Accept.
    candidateIds: rows.filter((c) => c.role === CLAIM_CANDIDATE_ROLE).map((c) => c.task_id as string),
  }
}

/** PostgREST or() parts: queued for me (pending mine, my teams' unclaimed, pending collaborations), plus all mine when `allMine`. */
function queueOrParts(me: string, teams: string[], collabIds: string[], allMine: boolean): string[] {
  const parts = [allMine ? `assignee_id.eq.${me}` : `and(assignee_id.eq.${me},acceptance_status.eq.pending)`]
  if (teams.length) parts.push(`and(assignee_id.is.null,assigned_team_id.in.(${teams.join(',')}))`)
  if (collabIds.length) parts.push(`id.in.(${collabIds.join(',')})`)
  return parts
}

/** The teams I belong to in this workspace (user_teams, plus the legacy users.team_id). */
async function myTeams(db: AnySupabaseClient, tenantId: string, userId: string): Promise<string[]> {
  const [{ data: memberships }, { data: profile }] = await Promise.all([
    (db as any).from('user_teams').select('team_id, team:teams!inner(tenant_id)').eq('user_id', userId).eq('team.tenant_id', tenantId),
    (db as any).from('users').select('team_id').eq('id', userId).maybeSingle(),
  ])
  const ids = new Set<string>(((memberships ?? []) as any[]).map((m) => m.team_id))
  if (profile?.team_id) {
    const { data: team } = await (db as any).from('teams').select('id').eq('id', profile.team_id).eq('tenant_id', tenantId).maybeSingle()
    if (team) ids.add(team.id)
  }
  return [...ids]
}

/**
 * Tasks I can take: waiting for my acceptance (mine, or as a collaborator)
 * → Accept; unassigned tasks of a team I belong to → Claim. Oldest due first.
 * The tasks the app shows as Queued (My tasks with include_queued has them too).
 */
export async function listQueueTasks(ctx: ServiceContext, input: { search?: string | null }, page: Page): Promise<{ tasks: HomeTask[]; total: number }> {
  requirePerm(ctx, 'tasks.view_own')
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  const { limit, offset } = pageArgs(page)
  const { teams, collabIds, candidateIds } = await queueSources(db, ctx.tenantId, me)
  let query = (db as any).from('tasks').select(`${TASK_COLUMNS}, assignee_id`, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId).is('deleted_at', null).is('parent_task_id', null)
    .in('status', [...OPEN_TASK_STATUSES]).or(queueOrParts(me, teams, collabIds, false).join(','))
  if (input.search?.trim()) query = query.ilike('title', `%${ilikeTerm(input.search)}%`)
  const { data, count, error } = await query
    .order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false }).order('id')
    .range(offset, offset + limit - 1)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const shaped = await shapeTasks(db, ctx.tenantId, rows)
  const collabSet = new Set(collabIds)
  const candidateSet = new Set(candidateIds)
  return {
    tasks: shaped.map((t, i) => ({
      ...t,
      action: rows[i].assignee_id === me || (collabSet.has(t.id) && !(candidateSet.has(t.id) && !rows[i].assignee_id)) ? 'accept' as const : 'claim' as const,
    })),
    total: count ?? 0,
  }
}

/* ── Task row details (an expanded My tasks / Task queue row) ────────── */

export interface HomeSubtask {
  id: string
  title: string
  status: string
  due_date: string | null
  overdue: boolean
  assignee: string | null
  /** Its own subtasks, completed of total (0 / 0 when it has none). */
  completed: number
  total: number
}

export interface HomeTaskDetails {
  id: string
  /** Plain-text description, trimmed to DESCRIPTION_MAX characters. */
  description: string | null
  /** Up to FIELD_MAX filled-in form fields, in form order. */
  fields: Array<{ key: string; label: string; value: string }>
  subtasks: HomeSubtask[]
  /** Direct subtasks completed of total. */
  completed: number
  total: number
}

const DESCRIPTION_MAX = 280
const FIELD_MAX = 6
const SUBTASK_MAX = 20

/** A field value as one short line ("" when there is nothing to show: empty, files, objects). */
export function fieldValueText(value: unknown, optionLabels?: Record<string, string>): string {
  const one = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
    if (typeof v === 'string') return optionLabels?.[v] ?? v
    return ''
  }
  const text = Array.isArray(value) ? value.map(one).filter(Boolean).join(', ') : one(value)
  return text.length > 120 ? `${text.slice(0, 119)}…` : text
}

/** HTML or text description → one plain paragraph of at most DESCRIPTION_MAX characters. */
export function descriptionExcerpt(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > DESCRIPTION_MAX ? `${text.slice(0, DESCRIPTION_MAX - 1)}…` : text
}

/** Pure shaping of a task row, its direct subtasks and their own children (unit-tested). */
export function shapeTaskDetails(
  task: { id: string; description?: unknown; metadata?: unknown },
  subtasks: Array<{ id: string; title?: unknown; status: string; due_date?: string | null; assignee_id?: string | null }>,
  children: Array<{ parent_task_id: string; status: string }>,
  names: ReadonlyMap<string, string>,
  normalizeFields: (raw: unknown) => Array<{ key: string; label: string; type: string; option_labels?: Record<string, string> }>,
  now = Date.now(),
): HomeTaskDetails {
  const meta = (task.metadata && typeof task.metadata === 'object' ? task.metadata : {}) as Record<string, unknown>
  const values = (meta.template_values && typeof meta.template_values === 'object' ? meta.template_values : {}) as Record<string, unknown>
  const skip = new Set(['heading', 'divider', 'button', 'attachments', 'custom', 'data_table'])
  const fields: HomeTaskDetails['fields'] = []
  for (const f of normalizeFields(meta.fields)) {
    if (fields.length >= FIELD_MAX) break
    if (skip.has(f.type)) continue
    const value = fieldValueText(values[f.key], f.option_labels)
    if (value) fields.push({ key: f.key, label: f.label || f.key, value })
  }
  const done = (s: string) => s === 'completed'
  const counts = new Map<string, { completed: number; total: number }>()
  for (const c of children) {
    const n = counts.get(c.parent_task_id) ?? { completed: 0, total: 0 }
    n.total += 1
    if (done(c.status)) n.completed += 1
    counts.set(c.parent_task_id, n)
  }
  const shaped = subtasks.map((s): HomeSubtask => ({
    id: s.id,
    title: String(s.title ?? ''),
    status: s.status,
    due_date: s.due_date ?? null,
    overdue: !!s.due_date && !done(s.status) && s.status !== 'cancelled' && new Date(s.due_date).getTime() < now,
    assignee: s.assignee_id ? (names.get(s.assignee_id) ?? null) : null,
    completed: counts.get(s.id)?.completed ?? 0,
    total: counts.get(s.id)?.total ?? 0,
  }))
  return {
    id: task.id,
    description: descriptionExcerpt(task.description),
    fields,
    subtasks: shaped.slice(0, SUBTASK_MAX),
    completed: shaped.filter((s) => done(s.status)).length,
    total: shaped.length,
  }
}

/**
 * One task's details for its expanded Home row: description, key form
 * fields and direct subtasks. Same visibility as My tasks / Task queue:
 * the task is mine (assignee or assigner), I'm a collaborator on it, it's an
 * unassigned task of one of my teams, or I have tasks.view_all.
 */
export async function getTaskDetails(ctx: ServiceContext, taskId: string): Promise<HomeTaskDetails> {
  requirePerm(ctx, 'tasks.view_own')
  const me = actor(ctx)
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const db = await serviceRoleClient(ctx)
  const { data: task, error } = await (db as any).from('tasks')
    .select('id, tenant_id, description, metadata, assignee_id, assigner_id, assigned_team_id')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  let allowed = task.assignee_id === me || task.assigner_id === me || hasPerm(ctx, 'tasks.view_all')
  if (!allowed) {
    const { data: collab } = await (db as any).from('task_assignees').select('task_id').eq('task_id', taskId).eq('user_id', me).limit(1)
    allowed = ((collab ?? []) as any[]).length > 0
  }
  if (!allowed && !task.assignee_id && task.assigned_team_id) {
    allowed = (await myTeams(db, ctx.tenantId, me)).includes(task.assigned_team_id)
  }
  if (!allowed) throw ServiceError.notFound('Task not found')

  const { data: subs, error: subError } = await (db as any).from('tasks')
    .select('id, title, status, due_date, assignee_id, sequence, created_at')
    .eq('tenant_id', ctx.tenantId).eq('parent_task_id', taskId).is('deleted_at', null)
    .order('sequence', { ascending: true }).order('created_at', { ascending: true }).limit(100)
  if (subError) throw dbError(subError)
  const subtasks = (subs ?? []) as any[]
  const subIds = subtasks.map((s) => s.id)
  const assigneeIds = [...new Set(subtasks.map((s) => s.assignee_id).filter(Boolean))]
  const [{ data: children }, { data: users }] = await Promise.all([
    subIds.length
      ? (db as any).from('tasks').select('parent_task_id, status').eq('tenant_id', ctx.tenantId).in('parent_task_id', subIds).is('deleted_at', null)
      : Promise.resolve({ data: [] }),
    assigneeIds.length
      ? (db as any).from('users').select('id, display_name').in('id', assigneeIds)
      : Promise.resolve({ data: [] }),
  ])
  const names = new Map<string, string>(((users ?? []) as any[]).map((u) => [u.id, String(u.display_name ?? '')]))
  const { normalizeTaskFields } = await import('@/lib/task-field-schema')
  return shapeTaskDetails(task, subtasks, (children ?? []) as any[], names, normalizeTaskFields as any)
}

/**
 * Claim an unassigned team task (a member of its team) or AAD group task (a
 * claim candidate, task_assignees role candidate) — the claimer becomes its assignee
 * (atomically — someone else's claim first wins, 409). tasks.complete.
 */
export async function claimTask(ctx: ServiceContext, taskId: string): Promise<{ claimed: true; task_id: string }> {
  requirePerm(ctx, 'tasks.complete')
  const me = actor(ctx)
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const db = await serviceRoleClient(ctx)
  const { data: task, error } = await (db as any).from('tasks').select('id, title, status, assignee_id, assigned_team_id, assignment_type, deleted_at')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!task || task.deleted_at) throw ServiceError.notFound('Task not found')
  // AAD group tasks (lib/tasks/aad-group-runtime.ts): the group's members are claim candidates.
  const groupTask = !task.assigned_team_id && task.assignment_type === 'aad_group'
  if (!task.assigned_team_id && !groupTask) throw ServiceError.validation('Only team or group tasks can be claimed')
  if (task.assignee_id === me) return { claimed: true, task_id: taskId }
  if (task.assignee_id) throw new ServiceError('conflict', 'Someone has already claimed this task')
  const { data: candidates } = groupTask
    ? await (db as any).from('task_assignees').select('user_id').eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('role', CLAIM_CANDIDATE_ROLE)
    : { data: [] }
  const candidateIds = ((candidates ?? []) as any[]).map((row) => String(row.user_id))
  if (!['todo', 'in_progress', 'blocked'].includes(task.status)) throw new ServiceError('conflict', 'This task is closed')
  if (task.assigned_team_id) {
    const teams = await myTeams(db, ctx.tenantId, me)
    if (!teams.includes(task.assigned_team_id)) throw ServiceError.forbidden('Only members of the task\'s team can claim it')
  } else if (!candidateIds.includes(me)) {
    throw ServiceError.forbidden('Only members of the task\'s group can claim it')
  }
  const now = new Date().toISOString()
  const { data: updated, error: updateError } = await (db as any).from('tasks')
    .update({ assignee_id: me, acceptance_status: 'accepted', accepted_at: now, status: task.status === 'todo' ? 'in_progress' : task.status, started_at: now })
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('assignee_id', null).select('id')
  if (updateError) throw dbError(updateError)
  if (!updated?.length) throw new ServiceError('conflict', 'Someone has already claimed this task')
  if (candidateIds.length) {
    // The claimer is now the only assignee: the other candidates drop out of their queues.
    await (db as any).from('task_assignees').delete().eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('role', CLAIM_CANDIDATE_ROLE).neq('user_id', me)
    await (db as any).from('task_assignees').update({ role: 'lead', acceptance_status: 'accepted', accepted_at: now }).eq('tenant_id', ctx.tenantId).eq('task_id', taskId).eq('user_id', me)
  }
  void audit(ctx, { objectType: 'task' as any, objectId: taskId, action: 'update', summary: `Claimed ${task.assigned_team_id ? 'team' : 'group'} task "${String(task.title ?? '').slice(0, 120)}"`, metadata: { claimed: true, team_id: task.assigned_team_id, ...(candidateIds.length ? { aad_group: true } : {}) } })
  return { claimed: true, task_id: taskId }
}

/* ── Following ───────────────────────────────────────────────────────── */

export type ProgressFilter = 'all' | 'active' | 'completed' | 'failed'

export interface FollowedRun {
  run_id: string
  process: { workflow_id: string | null; name: string }
  title: string | null
  status: ProgressStatus
  status_label: string
  stages: RunStage[]
  people: string[]
  started_at: string | null
  completed_at: string | null
  updated_at: string | null
  followed_at: string
  follow_source: 'manual' | 'auto'
  form_submission_id: string | null
}

export async function listFollowedRuns(ctx: ServiceContext, input: { search?: string | null; status?: ProgressFilter | null }, page: Page): Promise<{ runs: FollowedRun[]; total: number }> {
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  const { limit, offset } = pageArgs(page)
  const { data, error } = await (db as any).rpc('list_followed_runs', {
    p_tenant_id: ctx.tenantId, p_user_id: me, p_search: input.search?.trim() || null, p_status: input.status ?? 'all', p_limit: limit, p_offset: offset,
  })
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const stages = await loadRunStages(db, ctx.tenantId, rows)
  return {
    runs: rows.map((r): FollowedRun => {
      const status = progressStatus(r.run_status)
      const s = stages.get(r.run_id) ?? []
      return {
        run_id: r.run_id,
        process: { workflow_id: r.workflow_id ?? null, name: String(r.workflow_name ?? 'Workflow') },
        title: r.run_title ?? null,
        status,
        status_label: progressLabel(status, s),
        stages: s,
        people: peopleInvolved(s),
        started_at: r.started_at ?? null,
        completed_at: r.completed_at ?? null,
        updated_at: r.updated_at ?? null,
        followed_at: r.followed_at,
        follow_source: r.follow_source === 'auto' ? 'auto' : 'manual',
        form_submission_id: r.form_submission_id ?? null,
      }
    }),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

/** Can I see this run's progress (and so follow it)? */
async function canViewRun(db: AnySupabaseClient, runId: string, userId: string): Promise<boolean> {
  const { data, error } = await (db as any).rpc('can_view_run_progress', { p_run_id: runId, p_user_id: userId })
  if (error) throw dbError(error)
  return data === true
}

/** The run, in this workspace, that I can see — else not found. */
async function visibleRun(ctx: ServiceContext, db: AnySupabaseClient, runId: string, me: string): Promise<{ id: string; tenant_id: string }> {
  if (!UUID_RE.test(runId)) throw ServiceError.notFound('Run not found')
  const { data, error } = await (db as any).from('workflow_runs').select('id, tenant_id').eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data || !(await canViewRun(db, runId, me))) throw ServiceError.notFound('Run not found')
  return data
}

/** Follow (true) or unfollow (false) a run I can see. Idempotent. */
export async function setRunFollowed(ctx: ServiceContext, runId: string, follow: boolean): Promise<{ run_id: string; following: boolean }> {
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  if (!follow) {
    if (!UUID_RE.test(runId)) throw ServiceError.notFound('Run not found')
    const { error } = await (db as any).from('run_followers').delete().eq('user_id', me).eq('run_id', runId).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
    return { run_id: runId, following: false }
  }
  await visibleRun(ctx, db, runId, me)
  const { error } = await (db as any).from('run_followers').upsert({ tenant_id: ctx.tenantId, user_id: me, run_id: runId, source: 'manual' }, { onConflict: 'user_id,run_id', ignoreDuplicates: true })
  if (error) throw dbError(error)
  return { run_id: runId, following: true }
}

/** Which of these runs I follow. */
export async function followedRunIds(ctx: ServiceContext, runIds: string[]): Promise<string[]> {
  const me = actor(ctx)
  const ids = runIds.filter((id) => UUID_RE.test(id)).slice(0, 200)
  if (!ids.length) return []
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('run_followers').select('run_id').eq('tenant_id', ctx.tenantId).eq('user_id', me).in('run_id', ids)
  if (error) throw dbError(error)
  return ((data ?? []) as any[]).map((r) => r.run_id)
}

/* ── My submissions ──────────────────────────────────────────────────── */

export interface MySubmission {
  submission_id: string
  form: { id: string; name: string }
  source: string
  submitted_at: string
  /** The run it started (a live one first), if any. */
  run_id: string | null
  /** How many runs it started. */
  run_count: number
  process: { workflow_id: string; name: string } | null
  status: ProgressStatus
  status_label: string
  stages: RunStage[]
  people: string[]
  started_at: string | null
  completed_at: string | null
  updated_at: string | null
  following: boolean
  /** The submission metadata, as workflows see it ({{submission.*}}; lib/forms/submission-meta.ts). */
  submission: SubmissionMeta
}

export async function listMySubmissions(ctx: ServiceContext, input: { search?: string | null; status?: ProgressFilter | null }, page: Page): Promise<{ submissions: MySubmission[]; total: number }> {
  requirePerm(ctx, 'forms.submit')
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  const { limit, offset } = pageArgs(page)
  const { data, error } = await (db as any).rpc('list_my_submissions', {
    p_tenant_id: ctx.tenantId, p_user_id: me, p_search: input.search?.trim() || null, p_status: input.status ?? 'all', p_limit: limit, p_offset: offset,
  })
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const runRows = rows.filter((r) => r.run_id)
  const [stages, followed] = await Promise.all([
    loadRunStages(db, ctx.tenantId, runRows),
    runRows.length
      ? (db as any).from('run_followers').select('run_id').eq('tenant_id', ctx.tenantId).eq('user_id', me).in('run_id', runRows.map((r) => r.run_id))
      : Promise.resolve({ data: [] }),
  ])
  const following = new Set(((followed.data ?? []) as any[]).map((r) => r.run_id))
  const metaOf = await mySubmissionMeta(db, ctx.tenantId, me, rows)
  return {
    submissions: rows.map((r): MySubmission => {
      const status = progressStatus(r.run_status, r.queued === true)
      const s = r.run_id ? (stages.get(r.run_id) ?? []) : []
      return {
        submission_id: r.submission_id,
        form: { id: r.form_id, name: String(r.form_name ?? 'Form') },
        source: r.source,
        submitted_at: r.submitted_at,
        run_id: r.run_id ?? null,
        run_count: Number(r.run_count ?? 0),
        process: r.workflow_id ? { workflow_id: r.workflow_id, name: String(r.workflow_name ?? 'Workflow') } : null,
        status,
        status_label: progressLabel(status, s),
        stages: s,
        people: peopleInvolved(s),
        started_at: r.started_at ?? null,
        completed_at: r.completed_at ?? null,
        updated_at: r.updated_at ?? null,
        following: r.run_id ? following.has(r.run_id) : false,
        submission: metaOf(r),
      }
    }),
    total: Number(rows[0]?.total_count ?? 0),
  }
}

/** The rows' metadata: the stored version / surface (one read for the page) and my profile. */
async function mySubmissionMeta(db: any, tenantId: string, me: string, rows: any[]): Promise<(r: any) => SubmissionMeta> {
  const ids = rows.map((r) => r.submission_id).filter(Boolean)
  const [stored, profile] = await Promise.all([
    ids.length ? db.from('form_submissions').select('id, form_version, button_id, outcome, task_id, surface:result->>surface').eq('tenant_id', tenantId).in('id', ids) : Promise.resolve({ data: [] }),
    db.from('users').select('display_name, email').eq('id', me).maybeSingle(),
  ])
  const byId = new Map<string, any>(((stored.data ?? []) as any[]).map((s) => [s.id, s]))
  const who = { name: profile.data?.display_name ?? null, email: profile.data?.email ?? null }
  return (r) => {
    const s = byId.get(r.submission_id) ?? {}
    return submissionMetaFromRow({
      id: r.submission_id, created_at: r.submitted_at, submitted_by: me, form_id: r.form_id, form_name: r.form_name ?? 'Form',
      form_version: s.form_version ?? null, source: r.source, button_id: s.button_id ?? null, outcome: s.outcome ?? null, task_id: s.task_id ?? null,
      result: { surface: s.surface ?? null },
    }, who)
  }
}

/* ── Run progress (submitter-safe flow view) ─────────────────────────── */

export interface RunProgressStep {
  node_id: string
  name: string
  status: 'completed' | 'current' | 'failed' | 'skipped'
  assignees: string[]
  team: string | null
  started_at: string | null
  completed_at: string | null
  due_date: string | null
}

export interface RunProgress {
  run: {
    id: string
    status: ProgressStatus
    status_label: string
    started_at: string | null
    completed_at: string | null
    updated_at: string | null
  }
  process: { name: string }
  /** The diagram: nodes stripped to what draws the card, edges, sections. */
  flow: { nodes: SafeNode[]; edges: SafeEdge[]; sections: Record<string, unknown>[]; overlay: SafeOverlay }
  /** Where it is now. */
  stages: RunStage[]
  /** The run's tasks, oldest first: step, status, who, when. */
  steps: RunProgressStep[]
  submission: { id: string; form_id: string; form_name: string; submitted_at: string } | null
  following: boolean
  /** The caller may open the full run view (/automations/runs/<id>). */
  can_view_full: boolean
  /**
   * The run's User Tasks for this caller (lib/run-tasks.ts): who has each,
   * status per person, who completed it and when, history (details only
   * where the caller may open the task), and can_open / can_act per task.
   */
  tasks: RunTask[]
}

/**
 * One run's progress for someone allowed to see it (can_view_run_progress):
 * the flow diagram with completed / current steps, step names, assignees
 * and dates. Never configs, outputs, errors, variables or form values.
 */
export async function getRunProgress(ctx: ServiceContext, runId: string): Promise<RunProgress> {
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  await visibleRun(ctx, db, runId, me)
  const { data: run, error } = await (db as any).from('workflow_runs')
    .select('id, workflow_id, version_id, status, started_at, completed_at, paused_at, paused_node_id, event_id, node_results, execution_trace, form_submission_id, waits:pause_variables->_parallel->waits')
    .eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!run) throw ServiceError.notFound('Run not found')

  const [{ data: workflow }, versionResult, followRow, submissionResult, taskResult] = await Promise.all([
    (db as any).from('workflows').select('id, name, nodes, edges, sections').eq('id', run.workflow_id).eq('tenant_id', ctx.tenantId).maybeSingle(),
    run.version_id
      ? (db as any).from('workflow_versions').select('nodes, edges, sections').eq('id', run.version_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    (db as any).from('run_followers').select('run_id').eq('user_id', me).eq('run_id', runId).maybeSingle(),
    run.form_submission_id
      ? (db as any).from('form_submissions').select('id, form_id, form_name, created_at, submitted_by').eq('id', run.form_submission_id).eq('tenant_id', ctx.tenantId).maybeSingle()
      : Promise.resolve({ data: null }),
    (db as any).from('tasks').select('id, workflow_step_id, status, assignee_id, assigned_team_id, created_at, completed_at, due_date')
      .eq('tenant_id', ctx.tenantId).eq('workflow_run_id', runId).is('deleted_at', null).order('created_at', { ascending: true }).limit(200),
  ])
  const def = versionResult.data ?? workflow ?? {}
  const rawNodes: any[] = Array.isArray(def.nodes) ? def.nodes : []
  const rawEdges: any[] = Array.isArray(def.edges) ? def.edges : []
  const nodes = rawNodes.map(safeNode).filter((n): n is SafeNode => !!n)
  const edges = rawEdges.map(safeEdge).filter((e): e is SafeEdge => !!e)
  const sections = (Array.isArray(def.sections) ? def.sections : []).map(safeSection).filter((s: unknown): s is Record<string, unknown> => !!s)
  const live = isLiveRunStatus(run.status)
  const pausedId = live ? run.paused_node_id ?? null : null
  const trace: any[] = Array.isArray(run.execution_trace) ? run.execution_trace : []
  const visits: Record<string, number> = {}
  for (const entry of trace) if (entry?.type === 'node' && (entry.phase === 'enter' || entry.phase === 'resume') && entry.node_id) visits[entry.node_id] = (visits[entry.node_id] ?? 0) + 1
  const migration = trace.find((entry) => entry?.type === 'migrated')
  const overlay = computeRunOverlay({
    nodes, edges,
    nodeResults: (run.node_results && typeof run.node_results === 'object' ? run.node_results : {}) as any,
    pausedNodeId: pausedId,
    runWaiting: !!pausedId,
    entryNodeId: migration?.node_id ? String(migration.node_id) : null,
    visits,
  })

  const ref: RunRef = {
    run_id: run.id, run_status: run.status, workflow_id: run.workflow_id, version_id: run.version_id, event_id: run.event_id,
    paused_node_id: run.paused_node_id, wait_node_ids: Array.isArray(run.waits) ? run.waits.map((w: any) => w?.node_id).filter(Boolean) : null,
    updated_at: run.paused_at ?? run.started_at,
  }
  const stages = (await loadRunStages(db, ctx.tenantId, [ref])).get(run.id) ?? []
  const tasks = (taskResult.data ?? []) as any[]
  const [names, teams] = await Promise.all([
    userNames(db, ctx.tenantId, tasks.map((t) => t.assignee_id)),
    teamNames(db, ctx.tenantId, tasks.map((t) => t.assigned_team_id)),
  ])
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]))
  const { loadRunTasks } = await import('./run-tasks')
  const runTasks = await loadRunTasks(ctx, { id: run.id, workflow_id: run.workflow_id ?? null }, { labels: labelOf, db })
  const steps = tasks.map((t): RunProgressStep => ({
    node_id: t.workflow_step_id ?? '',
    name: labelOf.get(t.workflow_step_id) ?? 'Task',
    status: t.status === 'completed' ? 'completed' : t.status === 'cancelled' ? 'skipped' : 'current',
    assignees: t.assignee_id ? [names.get(t.assignee_id) ?? 'Someone'] : [],
    team: t.assigned_team_id ? (teams.get(t.assigned_team_id) ?? 'A team') : null,
    started_at: t.created_at ?? null,
    completed_at: t.completed_at ?? null,
    due_date: t.due_date ?? null,
  }))
  const status = progressStatus(run.status)
  // The submission is shown to its submitter only (others see the run, not whose form it was).
  const sub = submissionResult.data && submissionResult.data.submitted_by === me ? submissionResult.data : null
  return {
    run: {
      id: run.id, status, status_label: progressLabel(status, stages),
      started_at: run.started_at ?? null, completed_at: run.completed_at ?? null,
      updated_at: [run.started_at, run.paused_at, run.completed_at].filter(Boolean).sort().pop() ?? null,
    },
    process: { name: String(workflow?.name ?? 'Workflow') },
    flow: { nodes, edges, sections, overlay: safeOverlay(overlay) },
    stages,
    steps,
    submission: sub ? { id: sub.id, form_id: sub.form_id, form_name: String(sub.form_name ?? 'Form'), submitted_at: sub.created_at } : null,
    following: !!followRow.data,
    can_view_full: hasPerm(ctx, 'workflows.view_runs'),
    tasks: runTasks,
  }
}

/* ── Favourite forms ─────────────────────────────────────────────────── */

export interface FavoriteForm { id: string; name: string; description: string | null; favorited_at: string; system_name?: string | null }

/** My favourite forms that I can still open, alphabetical. */
export async function listFavoriteForms(ctx: ServiceContext): Promise<FavoriteForm[]> {
  const me = actor(ctx)
  if (!hasPerm(ctx, 'forms.submit')) return []
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).rpc('list_favorite_forms', { p_tenant_id: ctx.tenantId, p_user_id: me })
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  // System names: the friendly /form/<name> link on a workspace address.
  const names = new Map<string, string>()
  if (rows.length) {
    const { data: forms } = await (db as any).from('forms').select('id, system_name').eq('tenant_id', ctx.tenantId).in('id', rows.map((f) => f.id))
    for (const f of (forms ?? []) as any[]) if (f.system_name) names.set(String(f.id), String(f.system_name))
  }
  return rows.map((f) => ({ id: f.id, name: String(f.name), description: f.description ?? null, favorited_at: f.favorited_at, system_name: names.get(String(f.id)) ?? null }))
}

/** Star (true) or unstar (false) a form I can open. Idempotent. */
export async function setFormFavorite(ctx: ServiceContext, formId: string, favorite: boolean): Promise<{ form_id: string; favorite: boolean }> {
  const me = actor(ctx)
  if (!UUID_RE.test(formId)) throw ServiceError.notFound('Form not found')
  const db = await serviceRoleClient(ctx)
  if (!favorite) {
    const { error } = await (db as any).from('form_favorites').delete().eq('user_id', me).eq('form_id', formId).eq('tenant_id', ctx.tenantId)
    if (error) throw dbError(error)
    return { form_id: formId, favorite: false }
  }
  requirePerm(ctx, 'forms.submit')
  const { data: form, error } = await (db as any).from('forms').select('id').eq('id', formId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!form) throw ServiceError.notFound('Form not found')
  const { data: canOpen, error: checkError } = await (db as any).rpc('can_open_form', { p_form_id: formId, p_user_id: me })
  if (checkError) throw dbError(checkError)
  if (canOpen !== true) throw ServiceError.notFound('Form not found')
  const { error: insertError } = await (db as any).from('form_favorites').upsert({ tenant_id: ctx.tenantId, user_id: me, form_id: formId }, { onConflict: 'user_id,form_id', ignoreDuplicates: true })
  if (insertError) throw dbError(insertError)
  return { form_id: formId, favorite: true }
}

/* ── Preferences ─────────────────────────────────────────────────────── */

export interface HomePreferences {
  /** Follow the runs I start (form submissions included). Default on. */
  auto_follow_runs: boolean
  /** Follow the run of a workflow task I complete or respond to (acting on behalf included). Default on. */
  auto_follow_acted_runs: boolean
}

function preferencesOf(prefs: unknown): HomePreferences {
  const p = (prefs ?? {}) as Record<string, unknown>
  return { auto_follow_runs: p.auto_follow_runs !== false, auto_follow_acted_runs: p.auto_follow_acted_runs !== false }
}

export async function getHomePreferences(ctx: ServiceContext): Promise<HomePreferences> {
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('users').select('preferences').eq('id', me).maybeSingle()
  if (error) throw dbError(error)
  return preferencesOf(data?.preferences)
}

export async function setHomePreferences(ctx: ServiceContext, input: Partial<HomePreferences>): Promise<HomePreferences> {
  const me = actor(ctx)
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('users').select('preferences').eq('id', me).maybeSingle()
  if (error) throw dbError(error)
  const prefs = { ...((data?.preferences as Record<string, unknown> | null) ?? {}) }
  if (typeof input.auto_follow_runs === 'boolean') prefs.auto_follow_runs = input.auto_follow_runs
  if (typeof input.auto_follow_acted_runs === 'boolean') prefs.auto_follow_acted_runs = input.auto_follow_acted_runs
  const { error: updateError } = await (db as any).from('users').update({ preferences: prefs }).eq('id', me)
  if (updateError) throw dbError(updateError)
  return preferencesOf(prefs)
}

/* ── Layout ──────────────────────────────────────────────────────────── */

/*
 * The Home grid (lib/home/layout.ts): stored in users.preferences.home_layout,
 * keyed by workspace, so it follows the person across devices and each
 * workspace keeps its own. No key for a workspace = the default layout.
 * Reads normalise what is stored (removed widgets dropped, sizes clamped,
 * new widgets in their default spot); writes accept known widgets only.
 */

export interface HomeLayoutWidget {
  id: HomeWidgetId
  title: string
  group: HomeWidgetDef['group']
  /** False when the person lacks the permission it needs (it isn't shown). */
  available: boolean
  default: { w: number; h: number }
  min: { w: number; h: number }
  max: { w: number; h: number }
}

export interface HomeLayoutResult {
  layout: HomeLayout
  /** False: the default layout (nothing saved for this workspace). */
  customised: boolean
  updated_at: string | null
  grid: { columns: number; row_px: number; gap_px: number }
  widgets: HomeLayoutWidget[]
}

function layoutResult(ctx: ServiceContext, stored: unknown): HomeLayoutResult {
  const can = (perm: string) => hasPerm(ctx, perm)
  const saved = stored && typeof stored === 'object' ? (stored as { updated_at?: unknown }) : null
  return {
    layout: saved ? normaliseHomeLayout(saved) : defaultHomeLayout(can),
    customised: !!saved,
    updated_at: typeof saved?.updated_at === 'string' ? saved.updated_at : null,
    grid: { columns: DESKTOP_COLS, row_px: ROW_PX, gap_px: GAP_PX },
    widgets: HOME_WIDGETS.map((d) => ({
      id: d.id, title: d.title, group: d.group, available: canUseWidget(d.id, can),
      default: { w: d.w, h: d.h }, min: { w: d.minW, h: d.minH }, max: { w: d.maxW, h: d.maxH },
    })),
  }
}

async function readPreferences(ctx: ServiceContext, me: string): Promise<{ db: AnySupabaseClient; prefs: Record<string, unknown> }> {
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('users').select('preferences').eq('id', me).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('User not found')
  const raw = data.preferences
  return { db, prefs: raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {} }
}

function layoutsOf(prefs: Record<string, unknown>): Record<string, unknown> {
  const all = prefs.home_layout
  return all && typeof all === 'object' && !Array.isArray(all) ? { ...(all as Record<string, unknown>) } : {}
}

/** My Home layout in this workspace (the default when I haven't saved one). */
export async function getHomeLayout(ctx: ServiceContext): Promise<HomeLayoutResult> {
  const { prefs } = await readPreferences(ctx, actor(ctx))
  return layoutResult(ctx, layoutsOf(prefs)[ctx.tenantId])
}

/** Save my Home layout for this workspace (validated, then normalised). */
export async function setHomeLayout(ctx: ServiceContext, input: unknown): Promise<HomeLayoutResult> {
  const me = actor(ctx)
  let bytes: number
  try { bytes = JSON.stringify(input ?? null).length } catch { throw ServiceError.validation('The layout is not valid JSON') }
  if (bytes > MAX_LAYOUT_BYTES) throw ServiceError.validation(`The layout is too large (at most ${MAX_LAYOUT_BYTES} bytes)`)
  const parsed = homeLayoutInputSchema.safeParse(input)
  if (!parsed.success) {
    throw ServiceError.validation('Invalid layout', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  const { db, prefs } = await readPreferences(ctx, me)
  const layouts = layoutsOf(prefs)
  const stored = { ...normaliseHomeLayout(parsed.data), updated_at: new Date().toISOString() }
  layouts[ctx.tenantId] = stored
  const { error } = await (db as any).from('users').update({ preferences: { ...prefs, home_layout: layouts } }).eq('id', me)
  if (error) throw dbError(error)
  return layoutResult(ctx, stored)
}

/** Back to the default layout in this workspace (other workspaces keep theirs). */
export async function resetHomeLayout(ctx: ServiceContext): Promise<HomeLayoutResult> {
  const me = actor(ctx)
  const { db, prefs } = await readPreferences(ctx, me)
  const layouts = layoutsOf(prefs)
  if (ctx.tenantId in layouts) {
    delete layouts[ctx.tenantId]
    const next = { ...prefs }
    if (Object.keys(layouts).length) next.home_layout = layouts
    else delete next.home_layout
    const { error } = await (db as any).from('users').update({ preferences: next }).eq('id', me)
    if (error) throw dbError(error)
  }
  return layoutResult(ctx, null)
}
