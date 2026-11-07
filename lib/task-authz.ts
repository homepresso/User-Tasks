/**
 * Who may action a task — the one rule every surface uses (task screen and
 * form buttons, POST /api/v1/tasks/{id}/action, PATCH values, MCP task
 * tools, the CLI through REST, agent action tools).
 *
 * Workflow tasks (a paused run waits on them) are actioned by their
 * assignee only:
 *  - the individual assignee, or a collaborator on a collaborative task;
 *  - a team task with no individual assignee: a member of that team (the
 *    team is the assignee; its completion rule counts every member);
 *  - a manager acting ON BEHALF of the assignee: anyone in the assignee's
 *    manager chain in this workspace (user_memberships.manager_user_id,
 *    direct or indirect), with a note. The response counts as the
 *    assignee's; the task records actioned_by = manager and
 *    actioned_on_behalf_of = assignee;
 *  - a WORKFLOW MANAGER acting on behalf: someone holding an explicit Edit
 *    grant on the task's workflow (object_permissions can_edit, naming them,
 *    a role they hold or a team they are in — lib/workflow-grants.ts), with
 *    a note. Recorded like a manager's on-behalf action, with
 *    on_behalf_basis = 'workflow_manager' in the task history and audit;
 *  - break-glass: `tasks.complete_any` (Owner only by default) lets someone
 *    outside the chain act on behalf, also with a note, audited as such.
 *    Credentials with no person behind them (tenant API keys, ungated
 *    automation) need it too.
 * There is no admin override beyond that.
 *
 * Standard (non-workflow) tasks keep their earlier rules: the caller's
 * tasks.complete permission, and for user-bound credentials the task must be
 * theirs (or a report's).
 */

import { isInManagerChain, loadReportingIndex, type ReportingIndex } from '@/lib/reporting-lines'
import { isWorkflowManager } from '@/lib/workflow-grants'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export const COMPLETE_ANY_PERMISSION = 'tasks.complete_any'
export const ON_BEHALF_NOTE_MAX = 2000

export interface AuthzTask {
  id: string
  tenant_id: string
  status?: string | null
  is_workflow_task?: boolean | null
  event_id?: string | null
  assignee_id?: string | null
  assigned_team_id?: string | null
  assignment_mode?: string | null
  deleted_at?: string | null
  workflow_id?: string | null
  workflow_run_id?: string | null
}

/** Facts about one actor and one task, loaded once (loadTaskActorFacts). */
export interface TaskActorFacts {
  /** Individual assignee, or a collaborator (task_assignees). */
  isAssignee: boolean
  /** Member of the assigned team of a team task with no individual assignee. */
  isTeamMember: boolean
  /** People the task is assigned to (assignee + collaborators). */
  assigneeIds: string[]
  /** The assignee this actor manages (manager chain), when any. */
  managedAssigneeId: string | null
  /** Holds an explicit Edit grant on the task's workflow (workflow manager). */
  isWorkflowManager?: boolean
}

export type TaskActMode = 'assignee' | 'on_behalf' | 'break_glass' | 'credential'
/** Why someone not assigned may act on behalf: manager chain, workflow manager grant, or break-glass. */
export type OnBehalfBasis = 'manager' | 'workflow_manager' | 'break_glass'

export type TaskActDecision =
  | { allowed: true; mode: TaskActMode; onBehalfOf: string | null; basis?: OnBehalfBasis | null }
  | { allowed: false; status: 400 | 403 | 409; code: 'forbidden' | 'validation_error' | 'conflict'; message: string }

export function isWorkflowTask(task: AuthzTask): boolean {
  return Boolean(task.is_workflow_task && task.event_id)
}

export function isClosedTask(task: AuthzTask): boolean {
  return task.status === 'completed' || task.status === 'cancelled'
}

function hasPermission(permissions: ReadonlySet<string> | null, key: string) {
  return permissions === null || permissions.has(key)
}

/**
 * The rule itself (pure). `onBehalf` is the caller's explicit request to act
 * for the assignee; `note` its reason (required for people acting on behalf).
 */
export function decideTaskAction(input: {
  task: AuthzTask
  actorId: string | null
  permissions: ReadonlySet<string> | null
  facts: TaskActorFacts
  onBehalf?: boolean
  note?: string | null
  /** Draft saves don't need a note. */
  requireNote?: boolean
  /** Allow actioning a closed task (never for completion). */
  allowClosed?: boolean
}): TaskActDecision {
  const { task, actorId, permissions, facts } = input
  const onBehalf = input.onBehalf === true
  const note = typeof input.note === 'string' ? input.note.trim() : ''
  const requireNote = input.requireNote !== false

  if (!input.allowClosed && isClosedTask(task)) {
    return { allowed: false, status: 409, code: 'conflict', message: 'This task is already closed' }
  }

  // No person behind the call (tenant API key, automation).
  if (!actorId) {
    if (hasPermission(permissions, COMPLETE_ANY_PERMISSION)) return { allowed: true, mode: 'credential', onBehalfOf: facts.assigneeIds[0] ?? null }
    return {
      allowed: false, status: 403, code: 'forbidden',
      message: `Forbidden: workflow tasks are actioned by their assignee. A credential with no user needs the '${COMPLETE_ANY_PERMISSION}' permission`,
    }
  }

  const isOwnTask = facts.isAssignee || facts.isTeamMember
  if (isOwnTask) {
    if (onBehalf) return { allowed: false, status: 400, code: 'validation_error', message: 'This task is assigned to you — act on it directly, not on behalf' }
    return { allowed: true, mode: 'assignee', onBehalfOf: null }
  }

  const target = facts.managedAssigneeId ?? facts.assigneeIds[0] ?? null
  const viaManager = Boolean(facts.managedAssigneeId)
  const viaWorkflowManager = !viaManager && facts.isWorkflowManager === true
  const viaBreakGlass = !viaManager && !viaWorkflowManager && hasPermission(permissions, COMPLETE_ANY_PERMISSION)

  if (!viaManager && !viaWorkflowManager && !viaBreakGlass) {
    return { allowed: false, status: 403, code: 'forbidden', message: 'Forbidden: only the assignee (or their manager, or a manager of the workflow, acting on their behalf) can action this task' }
  }
  if (!target) {
    return { allowed: false, status: 403, code: 'forbidden', message: 'Forbidden: this task has no individual assignee to act on behalf of' }
  }
  if (!onBehalf) {
    return {
      allowed: false, status: 403, code: 'forbidden',
      message: 'Forbidden: this task is not assigned to you. To act for the assignee, act on behalf (on_behalf=true) with a note',
    }
  }
  if (requireNote && !note) {
    return { allowed: false, status: 400, code: 'validation_error', message: 'A note is required when acting on behalf of the assignee' }
  }
  if (note.length > ON_BEHALF_NOTE_MAX) {
    return { allowed: false, status: 400, code: 'validation_error', message: `The on-behalf note is too long (${ON_BEHALF_NOTE_MAX} characters at most)` }
  }
  return {
    allowed: true, mode: viaBreakGlass ? 'break_glass' : 'on_behalf', onBehalfOf: target,
    basis: viaManager ? 'manager' : viaWorkflowManager ? 'workflow_manager' : 'break_glass',
  }
}

/** Load the facts decideTaskAction needs (tenant-filtered reads). */
export async function loadTaskActorFacts(db: any, task: AuthzTask, actorId: string | null, options: { index?: ReportingIndex; workflowManagerOf?: boolean } = {}): Promise<TaskActorFacts> {
  const tenantId = String(task.tenant_id)
  const { data: collaborators } = await db
    .from('task_assignees')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('task_id', task.id)
  const assigneeIds = Array.from(new Set([
    ...(task.assignee_id ? [String(task.assignee_id)] : []),
    ...((collaborators ?? []) as any[]).map((row) => String(row.user_id ?? '')).filter(Boolean),
  ]))

  if (!actorId) return { isAssignee: false, isTeamMember: false, assigneeIds, managedAssigneeId: null }

  const isAssignee = assigneeIds.includes(actorId)
  let isTeamMember = false
  if (!isAssignee && task.assigned_team_id && !task.assignee_id) {
    const { data: member } = await db
      .from('user_teams')
      .select('user_id')
      .eq('team_id', task.assigned_team_id)
      .eq('user_id', actorId)
      .maybeSingle()
    isTeamMember = Boolean(member)
  }

  let managedAssigneeId: string | null = null
  if (!isAssignee && !isTeamMember && assigneeIds.length) {
    const index = options.index ?? await loadReportingIndex(db, tenantId)
    managedAssigneeId = assigneeIds.find((id) => isInManagerChain(index, actorId, id)) ?? null
  }
  let workflowManager = false
  if (!isAssignee && !isTeamMember && !managedAssigneeId) {
    // Callers that already know (the run read, batched) pass workflowManagerOf.
    workflowManager = options.workflowManagerOf ?? await isWorkflowManager(db, tenantId, actorId, await taskWorkflowId(db, task))
  }
  return { isAssignee, isTeamMember, assigneeIds, managedAssigneeId, isWorkflowManager: workflowManager }
}

/** The workflow a task belongs to: tasks.workflow_id, else its run's workflow. */
export async function taskWorkflowId(db: any, task: AuthzTask): Promise<string | null> {
  const tenantId = String(task.tenant_id)
  let workflowId = task.workflow_id ?? null
  let runId = task.workflow_run_id ?? null
  if (!workflowId && (task.workflow_id === undefined || task.workflow_run_id === undefined)) {
    const { data } = await db.from('tasks').select('workflow_id, workflow_run_id').eq('id', task.id).eq('tenant_id', tenantId).maybeSingle()
    workflowId = data?.workflow_id ?? null
    runId = data?.workflow_run_id ?? runId
  }
  if (!workflowId && runId) {
    const { data } = await db.from('workflow_runs').select('workflow_id').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
    workflowId = data?.workflow_id ?? null
  }
  return workflowId ? String(workflowId) : null
}

const AUTHZ_TASK_COLUMNS = 'id, tenant_id, status, is_workflow_task, event_id, assignee_id, assigned_team_id, assignment_mode, deleted_at, workflow_id, workflow_run_id'

export class TaskAuthzError extends Error {
  readonly status: 400 | 403 | 404 | 409
  readonly code: 'forbidden' | 'validation_error' | 'conflict' | 'not_found'
  constructor(status: 400 | 403 | 404 | 409, code: TaskAuthzError['code'], message: string) {
    super(message)
    this.name = 'TaskAuthzError'
    this.status = status
    this.code = code
  }
}

export interface AuthorizedTaskAction {
  task: AuthzTask & Record<string, any>
  mode: TaskActMode
  onBehalfOf: string | null
  note: string | null
  /** Why an on-behalf action was allowed (manager / workflow_manager / break_glass). */
  basis: OnBehalfBasis | null
}

/**
 * Load the task (404 unless it is a live task of `tenantId`) and apply the
 * rule. Throws TaskAuthzError (403 / 400 / 404 / 409).
 *
 * `db` must be able to read the task, its collaborators, the team
 * membership and the workspace's reporting lines — the service-role client
 * on the server (every read is tenant-filtered).
 */
export async function authorizeTaskAction(db: any, params: {
  tenantId: string
  taskId: string
  actorId: string | null
  permissions: ReadonlySet<string> | null
  onBehalf?: boolean
  note?: string | null
  requireNote?: boolean
  allowClosed?: boolean
  /** Extra columns to load with the task. '*' loads the whole row. */
  columns?: string
}): Promise<AuthorizedTaskAction> {
  const columns = params.columns === '*' ? '*' : params.columns ? `${AUTHZ_TASK_COLUMNS}, ${params.columns}` : AUTHZ_TASK_COLUMNS
  const { data: task, error } = await db
    .from('tasks')
    .select(columns)
    .eq('id', params.taskId)
    .eq('tenant_id', params.tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!task) throw new TaskAuthzError(404, 'not_found', 'Task not found')

  const facts = await loadTaskActorFacts(db, task, params.actorId)
  const decision = decideTaskAction({
    task, actorId: params.actorId, permissions: params.permissions, facts,
    onBehalf: params.onBehalf, note: params.note, requireNote: params.requireNote, allowClosed: params.allowClosed,
  })
  if (!decision.allowed) throw new TaskAuthzError(decision.status, decision.code, decision.message)
  const note = typeof params.note === 'string' && params.note.trim() ? params.note.trim() : null
  return { task, mode: decision.mode, onBehalfOf: decision.onBehalfOf, note, basis: decision.basis ?? null }
}

/**
 * Read access for user-bound credentials (tasks_get, PATCH of a standard
 * task): the user's own tasks (assignee, collaborator, team) and their
 * reports' tasks, and the tasks of workflows they manage (explicit Edit grant).
 */
export async function canUserSeeTask(db: any, tenantId: string, userId: string, taskId: string): Promise<boolean> {
  const { data: task } = await db
    .from('tasks')
    .select(AUTHZ_TASK_COLUMNS)
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!task) return false
  const facts = await loadTaskActorFacts(db, task, userId)
  return facts.isAssignee || facts.isTeamMember || Boolean(facts.managedAssigneeId) || facts.isWorkflowManager === true
}

/**
 * May this person change a task (edit fields, tick, reopen, comment, log
 * effort, reorder)? Governance audit 2026-11: tasks.complete alone let anyone
 * edit any task in the workspace by id. Allowed when they hold
 * tasks.view_all (task oversight), assigned it (assigner), can see it as
 * assignee / collaborator / team member / manager of the assignee
 * (canUserSeeTask), or can reach its parent task (subtasks of their task).
 * `permissions` null = an unrestricted (internal) context.
 */
export async function canReachTask(db: any, params: { tenantId: string; taskId: string; actorId: string | null; permissions: ReadonlySet<string> | null }, depth = 0): Promise<boolean> {
  if (params.permissions === null || params.permissions.has('tasks.view_all')) return true
  if (!params.actorId) return false
  const { data: task } = await db.from('tasks').select('id, assigner_id, parent_task_id')
    .eq('id', params.taskId).eq('tenant_id', params.tenantId).is('deleted_at', null).maybeSingle()
  if (!task) return false
  if (task.assigner_id && task.assigner_id === params.actorId) return true
  if (await canUserSeeTask(db, params.tenantId, params.actorId, params.taskId)) return true
  if (task.parent_task_id && depth < 5) return canReachTask(db, { ...params, taskId: task.parent_task_id }, depth + 1)
  return false
}

/**
 * The open workflow task a run is waiting on for `eventId`, if any. Resuming
 * such an event directly (events/complete, complete_server_event) would
 * skip the assignee rule, so those paths refuse it and point at the task.
 */
export async function findOpenWorkflowTaskForEvent(db: any, tenantId: string | null, eventId: string): Promise<string | null> {
  let query = db.from('tasks').select('id, status')
    .eq('event_id', eventId)
    .eq('is_workflow_task', true)
    .is('deleted_at', null)
  if (tenantId) query = query.eq('tenant_id', tenantId)
  const { data } = await query.limit(5)
  const open = ((data ?? []) as any[]).find((t) => !isClosedTask(t))
  return open ? String(open.id) : null
}

export const USER_TASK_EVENT_MESSAGE = 'This event belongs to an open user task — complete the task instead (POST /api/v1/tasks/{id}/action; its assignee, or their manager on behalf)'

export interface TaskAccessSummary {
  /** How the user may act now: as the assignee, on behalf (manager / break-glass), or not at all. */
  mode: 'assignee' | 'on_behalf' | 'break_glass' | 'none'
  workflowTask: boolean
  closed: boolean
  /** The assignee an on-behalf action is for. */
  onBehalfOf: string | null
  /** Why on behalf is allowed (null for assignee / none). */
  basis?: OnBehalfBasis | null
}

/** What the task screen should offer the signed-in user (the server re-checks on every action). */
export async function describeTaskAccess(db: any, params: { tenantId: string; taskId: string; actorId: string; permissions: ReadonlySet<string> | null }): Promise<TaskAccessSummary | null> {
  const { data: task } = await db.from('tasks').select(AUTHZ_TASK_COLUMNS)
    .eq('id', params.taskId).eq('tenant_id', params.tenantId).is('deleted_at', null).maybeSingle()
  if (!task) return null
  const facts = await loadTaskActorFacts(db, task, params.actorId)
  const base = { workflowTask: isWorkflowTask(task), closed: isClosedTask(task) }
  if (facts.isAssignee || facts.isTeamMember) return { ...base, mode: 'assignee', onBehalfOf: null, basis: null }
  const target = facts.managedAssigneeId ?? facts.assigneeIds[0] ?? null
  if (facts.managedAssigneeId) return { ...base, mode: 'on_behalf', onBehalfOf: facts.managedAssigneeId, basis: 'manager' }
  if (target && facts.isWorkflowManager) return { ...base, mode: 'on_behalf', onBehalfOf: target, basis: 'workflow_manager' }
  if (target && hasPermission(params.permissions, COMPLETE_ANY_PERMISSION)) return { ...base, mode: 'break_glass', onBehalfOf: target, basis: 'break_glass' }
  return { ...base, mode: 'none', onBehalfOf: null, basis: null }
}
