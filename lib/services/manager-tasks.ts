/**
 * Reporting lines and the manager view ("My team" under Tasks,
 * GET /api/v1/tasks?scope=reports, /api/v1/users/{id}/manager and
 * /reports, the MCP users_* / tasks_list tools, the CLI).
 *
 * The relationship lives on user_memberships (manager_user_id, per
 * workspace; lib/reporting-lines.ts). Anyone may read their own reports;
 * reading or changing anyone's reporting line needs team.change_roles
 * (team.view_members to read). Directory sync writes it with
 * manager_source 'directory'.
 *
 * Reads and writes use the service-role client with explicit tenant
 * filters, after the checks here.
 */

import { listReports, loadReportingIndex, managerChain, wouldCreateCycle, isInManagerChain, MAX_REPORTING_DEPTH, type ReportingIndex } from '@/lib/reporting-lines'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { audit, dbError, serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows */

export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'draft'] as const
export const REPORT_TASK_LIMIT = 500

export interface PersonSummary { id: string; display_name: string | null; email: string | null }

async function people(db: AnySupabaseClient, ids: string[]): Promise<Map<string, PersonSummary>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (!unique.length) return new Map()
  const { data, error } = await (db as any).from('users').select('id, display_name, email').in('id', unique)
  if (error) throw dbError(error)
  return new Map(((data ?? []) as any[]).map((u) => [String(u.id), { id: String(u.id), display_name: u.display_name ?? null, email: u.email ?? null }]))
}

async function requireMember(db: AnySupabaseClient, tenantId: string, userId: string) {
  const { data, error } = await (db as any).from('user_memberships')
    .select('user_id, manager_user_id, manager_source, manager_updated_at, is_active')
    .eq('tenant_id', tenantId).eq('user_id', userId).maybeSingle()
  if (error) throw dbError(error)
  if (!data || data.is_active === false) throw ServiceError.notFound('User is not a member of this workspace')
  return data as { user_id: string; manager_user_id: string | null; manager_source: string | null; manager_updated_at: string | null }
}

/** Is the caller a manager here (at least one direct report)? */
export async function isManager(ctx: ServiceContext): Promise<boolean> {
  if (!ctx.actorId) return false
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('user_memberships')
    .select('user_id').eq('tenant_id', ctx.tenantId).eq('manager_user_id', ctx.actorId).eq('is_active', true).limit(1)
  if (error) return false
  return (data ?? []).length > 0
}

/* ── Reporting lines ── */

export interface ReportingLineView {
  user: PersonSummary
  manager: PersonSummary | null
  manager_source: string | null
  manager_updated_at: string | null
  direct_reports: PersonSummary[]
  /** Managers above, nearest first. */
  chain: PersonSummary[]
}

/** One member's manager, chain and direct reports. Own line: anyone; others: team.view_members. */
export async function getReportingLine(ctx: ServiceContext, userId: string): Promise<ReportingLineView> {
  if (userId !== ctx.actorId) requirePerm(ctx, 'team.view_members')
  const db = await serviceRoleClient(ctx)
  const row = await requireMember(db, ctx.tenantId, userId)
  const index = await loadReportingIndex(db, ctx.tenantId)
  const chain = managerChain(index, userId)
  const direct = listReports(index, userId).map((r) => r.user_id)
  const byId = await people(db, [userId, ...chain, ...direct])
  const person = (id: string): PersonSummary => byId.get(id) ?? { id, display_name: null, email: null }
  return {
    user: person(userId),
    manager: row.manager_user_id ? person(row.manager_user_id) : null,
    manager_source: row.manager_source ?? null,
    manager_updated_at: row.manager_updated_at ?? null,
    direct_reports: direct.map(person),
    chain: chain.map(person),
  }
}

/**
 * Set (or clear, with null) a member's manager in this workspace
 * (team.change_roles). Refuses non-members, self and loops.
 */
export async function setManager(ctx: ServiceContext, userId: string, managerUserId: string | null, options: { source?: 'manual' | 'directory' } = {}) {
  requirePerm(ctx, 'team.change_roles')
  const db = await serviceRoleClient(ctx)
  const row = await requireMember(db, ctx.tenantId, userId)
  const next = managerUserId ? String(managerUserId) : null
  if (next) {
    if (next === userId) throw ServiceError.validation('A member cannot be their own manager')
    await requireMember(db, ctx.tenantId, next).catch(() => { throw ServiceError.validation('The manager must be an active member of this workspace') })
    const index = await loadReportingIndex(db, ctx.tenantId)
    if (wouldCreateCycle(index, userId, next)) throw ServiceError.validation('That manager reports to this member (directly or indirectly) — it would create a loop')
  }
  const { error } = await (db as any).from('user_memberships')
    .update({ manager_user_id: next, manager_source: next ? (options.source ?? 'manual') : null, manager_updated_at: new Date().toISOString() })
    .eq('tenant_id', ctx.tenantId).eq('user_id', userId)
  if (error) {
    if (/manager_cycle|manager_not_member/.test(error.message ?? '')) throw ServiceError.validation(error.message.replace(/^.*?: /, ''))
    throw dbError(error)
  }
  await audit(ctx, {
    objectType: 'member', objectId: userId, action: 'update',
    summary: next ? 'Set manager' : 'Cleared manager',
    diff: { manager_user_id: { before: row.manager_user_id ?? null, after: next } },
  })
  return getReportingLine(ctx, userId)
}

/** Reports of a member (own: anyone; others: team.view_members). */
export async function listReportsOf(ctx: ServiceContext, managerId: string, options: { indirect?: boolean } = {}) {
  if (managerId !== ctx.actorId) requirePerm(ctx, 'team.view_members')
  const db = await serviceRoleClient(ctx)
  const index = await loadReportingIndex(db, ctx.tenantId)
  const reports = listReports(index, managerId, { indirect: options.indirect })
  const byId = await people(db, reports.map((r) => r.user_id))
  return {
    manager_user_id: managerId,
    indirect: options.indirect === true,
    max_depth: options.indirect ? MAX_REPORTING_DEPTH : 1,
    reports: reports.map((r) => ({ ...(byId.get(r.user_id) ?? { id: r.user_id, display_name: null, email: null }), depth: r.depth, manager_user_id: r.manager_user_id })),
  }
}

/** Every member's manager in the workspace (Settings → Team). team.view_members. */
export async function listReportingLines(ctx: ServiceContext) {
  requirePerm(ctx, 'team.view_members')
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('user_memberships')
    .select('user_id, manager_user_id, manager_source').eq('tenant_id', ctx.tenantId).eq('is_active', true)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const byId = await people(db, rows.map((r) => String(r.user_id)))
  const reportCount = new Map<string, number>()
  for (const r of rows) if (r.manager_user_id) reportCount.set(String(r.manager_user_id), (reportCount.get(String(r.manager_user_id)) ?? 0) + 1)
  return rows
    .map((r) => ({
      user_id: String(r.user_id),
      display_name: byId.get(String(r.user_id))?.display_name ?? null,
      email: byId.get(String(r.user_id))?.email ?? null,
      manager_user_id: r.manager_user_id ? String(r.manager_user_id) : null,
      manager_source: r.manager_source ?? null,
      direct_reports: reportCount.get(String(r.user_id)) ?? 0,
    }))
    .sort((a, b) => String(a.display_name ?? a.email ?? '').localeCompare(String(b.display_name ?? b.email ?? '')))
}

/* ── The manager view ── */

export interface ReportTaskFilters {
  indirect?: boolean
  /** One report's tasks only. */
  person?: string | null
  status?: string[] | null
  priority?: string[] | null
  workflow_id?: string | null
  overdue?: boolean
  sla_breached?: boolean
  limit?: number | null
}

export interface ReportTaskRow {
  id: string
  title: string
  status: string
  priority: string | null
  due_date: string | null
  created_at: string
  assignee_id: string
  assignee: PersonSummary | null
  is_workflow_task: boolean
  workflow_id: string | null
  workflow_name: string | null
  event_id: string | null
  available_outcomes: string[] | null
  acceptance_status: string | null
  allow_reassign: boolean
  is_overdue: boolean
  sla_breached: boolean
  depth: number
}

export interface ReportWorkload {
  user: PersonSummary
  depth: number
  manager_user_id: string
  open: number
  overdue: number
  sla_breached: number
  due_soon: number
}

/**
 * Open tasks of the caller's reports (direct; all levels with `indirect`),
 * with per-person workload counts. Needs an acting user; no permission
 * beyond being their manager (and tasks.view_own to see tasks at all).
 */
export async function listReportTasks(ctx: ServiceContext, filters: ReportTaskFilters = {}) {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: the manager view needs a user (a user-bound credential)')
  if (!hasPerm(ctx, 'tasks.view_own') && !hasPerm(ctx, 'tasks.view_all')) requirePerm(ctx, 'tasks.view_own')
  const db = await serviceRoleClient(ctx)
  const index = await loadReportingIndex(db, ctx.tenantId)
  const reports = listReports(index, ctx.actorId, { indirect: filters.indirect })
  const depthOf = new Map(reports.map((r) => [r.user_id, r]))
  const byId = await people(db, reports.map((r) => r.user_id))
  const empty = { manager_user_id: ctx.actorId, indirect: filters.indirect === true, reports: [] as ReportWorkload[], tasks: [] as ReportTaskRow[], truncated: false }
  if (!reports.length) return empty

  let ids = reports.map((r) => r.user_id)
  if (filters.person) {
    if (!depthOf.has(filters.person)) throw ServiceError.validation('That person is not one of your reports')
    ids = [filters.person]
  }
  const limit = Math.max(1, Math.min(Number(filters.limit ?? REPORT_TASK_LIMIT), REPORT_TASK_LIMIT))
  const statuses = (filters.status?.length ? filters.status : [...OPEN_TASK_STATUSES]).filter((s) => s !== 'completed' && s !== 'cancelled')
  let query = (db as any).from('tasks')
    .select('id, title, status, priority, due_date, created_at, assignee_id, is_workflow_task, workflow_id, event_id, available_outcomes, acceptance_status, allow_reassign')
    .eq('tenant_id', ctx.tenantId)
    .is('deleted_at', null)
    .in('assignee_id', ids)
    .in('status', statuses.length ? statuses : [...OPEN_TASK_STATUSES])
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(limit + 1)
  if (filters.priority?.length) query = query.in('priority', filters.priority)
  if (filters.workflow_id) query = query.eq('workflow_id', filters.workflow_id)
  const { data, error } = await query
  if (error) throw dbError(error)
  let rows = (data ?? []) as any[]
  const truncated = rows.length > limit
  rows = rows.slice(0, limit)

  // SLA: the waiting run's SLA breached, or a task escalation fired.
  const eventIds = rows.map((t) => t.event_id).filter(Boolean)
  const breachedEvents = new Set<string>()
  if (eventIds.length) {
    const { data: runs } = await (db as any).from('workflow_runs')
      .select('event_id, sla_status, sla_due_at').eq('tenant_id', ctx.tenantId).in('event_id', eventIds)
    const now = Date.now()
    for (const run of (runs ?? []) as any[]) {
      if (run.sla_status === 'breached' || (run.sla_due_at && new Date(run.sla_due_at).getTime() < now)) breachedEvents.add(String(run.event_id))
    }
  }
  const taskIds = rows.map((t) => t.id)
  const escalated = new Set<string>()
  if (taskIds.length) {
    const { data: esc } = await (db as any).from('task_escalations').select('task_id, is_escalated').eq('tenant_id', ctx.tenantId).in('task_id', taskIds)
    for (const e of (esc ?? []) as any[]) if (e.is_escalated) escalated.add(String(e.task_id))
  }
  const workflowIds = Array.from(new Set(rows.map((t) => t.workflow_id).filter(Boolean)))
  const workflowName = new Map<string, string>()
  if (workflowIds.length) {
    const { data: wfs } = await (db as any).from('workflows').select('id, name').eq('tenant_id', ctx.tenantId).in('id', workflowIds)
    for (const w of (wfs ?? []) as any[]) workflowName.set(String(w.id), w.name)
  }

  const now = Date.now()
  const soon = now + 2 * 24 * 3600 * 1000
  let tasks: ReportTaskRow[] = rows.map((t) => {
    const due = t.due_date ? new Date(t.due_date).getTime() : null
    return {
      id: t.id, title: t.title, status: t.status, priority: t.priority ?? null, due_date: t.due_date ?? null, created_at: t.created_at,
      assignee_id: t.assignee_id, assignee: byId.get(String(t.assignee_id)) ?? null,
      is_workflow_task: Boolean(t.is_workflow_task), workflow_id: t.workflow_id ?? null, workflow_name: t.workflow_id ? workflowName.get(String(t.workflow_id)) ?? null : null,
      event_id: t.event_id ?? null, available_outcomes: Array.isArray(t.available_outcomes) ? t.available_outcomes : null,
      acceptance_status: t.acceptance_status ?? null, allow_reassign: t.allow_reassign === true,
      is_overdue: due !== null && due < now,
      sla_breached: (t.event_id && breachedEvents.has(String(t.event_id))) || escalated.has(String(t.id)),
      depth: depthOf.get(String(t.assignee_id))?.depth ?? 1,
    }
  })

  const workload = new Map<string, ReportWorkload>()
  for (const r of reports) {
    if (filters.person && r.user_id !== filters.person) continue
    workload.set(r.user_id, { user: byId.get(r.user_id) ?? { id: r.user_id, display_name: null, email: null }, depth: r.depth, manager_user_id: r.manager_user_id, open: 0, overdue: 0, sla_breached: 0, due_soon: 0 })
  }
  for (const t of tasks) {
    const w = workload.get(t.assignee_id)
    if (!w) continue
    w.open++
    if (t.is_overdue) w.overdue++
    if (t.sla_breached) w.sla_breached++
    const due = t.due_date ? new Date(t.due_date).getTime() : null
    if (due !== null && due >= now && due <= soon) w.due_soon++
  }
  if (filters.overdue) tasks = tasks.filter((t) => t.is_overdue)
  if (filters.sla_breached) tasks = tasks.filter((t) => t.sla_breached)

  return { manager_user_id: ctx.actorId, indirect: filters.indirect === true, reports: [...workload.values()], tasks, truncated }
}

/**
 * Reassign a report's open task to another of the caller's reports or to
 * the caller (tasks.assign). Workflow tasks keep their step's rule: only
 * when the step allows redirect (allow_reassign).
 */
export async function reassignReportTask(ctx: ServiceContext, taskId: string, input: { target_user_id: string; comment?: string | null }, options: { index?: ReportingIndex } = {}) {
  requirePerm(ctx, 'tasks.assign')
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: reassigning a report\'s task needs a user')
  const target = String(input.target_user_id ?? '').trim()
  if (!target) throw ServiceError.validation('target_user_id is required')
  const db = await serviceRoleClient(ctx)
  const { data: task, error } = await (db as any).from('tasks')
    .select('id, tenant_id, title, status, assignee_id, assigned_team_id, is_workflow_task, event_id, allow_reassign')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  if (task.status === 'completed' || task.status === 'cancelled') throw ServiceError.conflict('This task is already closed')
  if (!task.assignee_id) throw ServiceError.validation('This task has no individual assignee to reassign from')
  const index = options.index ?? await loadReportingIndex(db, ctx.tenantId)
  if (!isInManagerChain(index, ctx.actorId, String(task.assignee_id))) {
    throw ServiceError.forbidden('Forbidden: you can only reassign tasks of your reports')
  }
  if (target !== ctx.actorId && !isInManagerChain(index, ctx.actorId, target)) {
    throw ServiceError.validation('Reassign to yourself or to one of your reports')
  }
  if (target === task.assignee_id) throw ServiceError.validation('The task is already assigned to that person')
  if (task.is_workflow_task && task.event_id && task.allow_reassign !== true) {
    throw ServiceError.conflict('This workflow step does not allow reassigning its task')
  }
  await requireMember(db, ctx.tenantId, target)

  const { error: updateError } = await (db as any).from('tasks')
    .update({ assignee_id: target, acceptance_status: 'pending' })
    .eq('id', taskId).eq('tenant_id', ctx.tenantId)
  if (updateError) throw dbError(updateError)
  const comment = typeof input.comment === 'string' && input.comment.trim() ? input.comment.trim().slice(0, 2000) : null
  await writeLifecycleEvent({
    supabase: db as any, tenantId: ctx.tenantId, taskId, eventType: 'reassigned', actorId: ctx.actorId,
    metadata: { old_assignee: task.assignee_id, new_assignee: target, comment, via: ctx.source, acted_as: 'manager' },
  })
  const names = await people(db, [ctx.actorId])
  const actorName = names.get(ctx.actorId)?.display_name ?? 'Your manager'
  const notes = [
    { user_id: target, title: `Reassigned to you: ${task.title}`, body: comment || `${actorName} reassigned this task to you.` },
    ...(task.assignee_id !== ctx.actorId ? [{ user_id: task.assignee_id, title: `Reassigned: ${task.title}`, body: `${actorName} reassigned this task${comment ? `: ${comment}` : '.'}` }] : []),
  ].filter((n) => n.user_id !== ctx.actorId)
  if (notes.length) {
    await (db as any).from('notifications').insert(notes.map((n) => ({ ...n, tenant_id: ctx.tenantId, type: 'task_assigned', task_id: taskId })))
  }
  await audit(ctx, { objectType: 'task', objectId: taskId, action: 'reassign', summary: `Reassigned "${task.title}" from a report`, metadata: { from: task.assignee_id, to: target } })
  return { task_id: taskId, previous_assignee_id: String(task.assignee_id), assignee_id: target }
}
