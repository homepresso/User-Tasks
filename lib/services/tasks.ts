/**
 * Task updates for PATCH /api/v1/tasks/{id}.
 *
 * Same rules as the task UI: the inline editors' field allowlist
 * (UPDATABLE_TASK_FIELDS + validateTaskFieldValue) and the draft save of
 * User Task field values (mergeTaskFieldValues, partial, refused once the
 * task is closed), both under tasks.complete. Completing goes through
 * POST /tasks/{id}/action (it records the outcome and resumes workflows), so
 * status 'completed' is refused here. User-bound credentials only reach
 * tasks assigned to (or shared with) their user.
 */

import { canAccessTaskAsUser } from '@/lib/api-key-permissions'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { normalizeTaskFieldValue, UPDATABLE_TASK_FIELDS, validateTaskFieldValue } from '@/lib/task-fields'
import { withDescriptionText } from '@/lib/task-description-format'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { SUBTASK_MAX_DEPTH, validateSubtaskInput, type SubtaskInput } from '@/lib/tasks/subtask-input'
import { dbError } from './_shared'
import { canReachTask } from '@/lib/task-authz'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata is free-form jsonb */

export interface TaskUpdateInput {
  title?: string
  description?: string | null
  status?: string
  priority?: string
  due_date?: string | null
  progress_pct?: number | null
  estimated_completion?: string | null
  tags?: string[] | null
  /** User Task field values (merged into metadata.template_values). */
  values?: Record<string, unknown>
  /** Save a workflow task's values for its assignee (manager / tasks.complete_any). */
  on_behalf?: boolean
  on_behalf_note?: string
}

export async function updateTask(ctx: ServiceContext, taskId: string, input: TaskUpdateInput) {
  requirePerm(ctx, 'tasks.complete')
  if (ctx.actorId && ctx.source !== 'ui' && !(await canAccessTaskAsUser(ctx.supabase, ctx.tenantId, ctx.actorId, taskId))) {
    throw ServiceError.forbidden('Forbidden: this user-bound credential cannot update that task')
  }

  const { values, on_behalf: onBehalf, on_behalf_note: onBehalfNote, ...fields } = input
  const updates: Record<string, unknown> = {}
  const errors: Record<string, string> = {}
  for (const [field, value] of Object.entries(fields)) {
    if (value === undefined) continue
    if (!UPDATABLE_TASK_FIELDS.has(field)) { errors[field] = `Field "${field}" cannot be updated`; continue }
    const problem = validateTaskFieldValue(field, value)
    if (problem) { errors[field] = problem; continue }
    updates[field] = normalizeTaskFieldValue(field, value)
  }
  if (updates.status === 'completed') errors.status = 'Use POST /tasks/{id}/action with action "complete" to complete a task (it records the outcome and resumes its workflow)'
  if (typeof updates.title === 'string' && !updates.title.trim()) errors.title = 'Title cannot be empty'
  if (Object.keys(errors).length) throw ServiceError.validation(`Invalid task update: ${Object.values(errors).join('; ')}`, { errors })
  if (Object.keys(updates).length === 0 && !values) throw ServiceError.validation('No fields to update')

  await requireTaskReach(ctx, taskId)
  const { data: task, error: loadError } = await (ctx.supabase as any).from('tasks')
    .select('id, status, metadata, is_workflow_task, event_id').eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (loadError) throw dbError(loadError)
  if (!task) throw ServiceError.notFound('Task not found')

  // A workflow task's form values: its assignee (or their manager on behalf).
  if (values && task.is_workflow_task && task.event_id) {
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw ServiceError.conflict('This task is closed and its field values can no longer be edited')
    }
    const { saveWorkflowTaskValues } = await import('./task-actions')
    const saved = await saveWorkflowTaskValues(ctx, taskId, values, { onBehalf, onBehalfNote: onBehalfNote ?? null })
    if (!saved.success) throw ServiceError.validation(`Invalid field values: ${Object.values(saved.errors).join('; ')}`, { errors: saved.errors })
    if (Object.keys(updates).length === 0) {
      const { data: fresh, error: freshError } = await (ctx.supabase as any).from('tasks').select('*').eq('id', taskId).eq('tenant_id', ctx.tenantId).single()
      if (freshError || !fresh) throw dbError(freshError, 'Failed to load the task')
      return withDescriptionText(fresh)
    }
  } else if (values) {
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw ServiceError.conflict('This task is closed and its field values can no longer be edited')
    }
    const metadata = (task.metadata ?? {}) as Record<string, unknown>
    const merged = await mergeTaskFieldValuesChecked(ctx.supabase, ctx.tenantId, metadata, values, { partial: true, taskId })
    if (Object.keys(merged.errors).length) {
      throw ServiceError.validation(`Invalid field values: ${Object.values(merged.errors).join('; ')}`, { errors: merged.errors })
    }
    updates.metadata = { ...metadata, template_values: merged.templateValues }
  }
  updates.updated_at = new Date().toISOString()

  const { data, error } = await (ctx.supabase as any).from('tasks')
    .update(updates).eq('id', taskId).eq('tenant_id', ctx.tenantId).select('*').single()
  if (error || !data) throw dbError(error, 'Failed to update task')
  return withDescriptionText(data)
}

/*
 * Task detail / list actions the browser used to write directly (status
 * toggles, standard-task completion, comments). Same permission as the
 * inline editors (tasks.complete), scoped to ctx.tenantId — the session
 * adapter acts in the task's own workspace.
 */

/**
 * 404 unless the caller may change this task: tasks.view_all, its assigner,
 * someone who can see it (assignee, collaborator, team, manager) or who can
 * reach its parent (lib/task-authz canReachTask). Not found rather than
 * forbidden, so task ids can't be probed.
 */
export async function requireTaskReach(ctx: ServiceContext, taskId: string): Promise<void> {
  if (ctx.permissions === null || ctx.permissions.has('tasks.view_all')) return
  // Tenant-wide credentials (no user) are bounded by their explicit permission list.
  if (!ctx.actorId) return
  // The caller's own client: the task, its collaborators, teams and reporting
  // lines are readable to workspace members (RLS), and the service role isn't
  // needed for a yes / no on the caller's own reach.
  const ok = await canReachTask(ctx.supabase, { tenantId: ctx.tenantId, taskId, actorId: ctx.actorId, permissions: ctx.permissions })
  if (!ok) throw ServiceError.notFound('Task not found')
}

async function loadScopedTask(ctx: ServiceContext, taskId: string, columns: string) {
  requirePerm(ctx, 'tasks.complete')
  const { data, error } = await (ctx.supabase as any).from('tasks')
    .select(columns).eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Task not found')
  await requireTaskReach(ctx, taskId)
  return data as Record<string, any>
}

/**
 * Complete a standard (non-workflow) task with an outcome. Workflow tasks
 * complete through completeWorkflowTask, which records the response and
 * resumes the run; they are refused here.
 */
export async function completeStandardTask(ctx: ServiceContext, taskId: string, input: { outcome: string; notes?: string | null; via?: 'agent' | null; onBehalf?: { of: string | null; note: string | null; basis: string | null } | null }) {
  const outcome = typeof input.outcome === 'string' ? input.outcome.trim() : ''
  if (!outcome || outcome.length > 200) throw ServiceError.validation('outcome is required (at most 200 characters)')
  const task = await loadScopedTask(ctx, taskId, 'id, tenant_id, is_workflow_task, event_id')
  if (task.is_workflow_task && task.event_id) throw ServiceError.conflict('Workflow tasks complete through their workflow step')
  const notes = typeof input.notes === 'string' && input.notes ? input.notes.slice(0, 10_000) : null

  const { error } = await (ctx.supabase as any).from('tasks')
    .update({ status: 'completed', outcome, outcome_notes: notes })
    .eq('id', taskId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to complete the task')
  // The Agent (on the person's confirmation) and acting for the assignee are recorded in the history.
  const extra = {
    ...(input.via === 'agent' ? { via: 'agent' } : {}),
    ...(input.onBehalf ? { on_behalf_of: input.onBehalf.of, on_behalf_note: input.onBehalf.note, on_behalf_basis: input.onBehalf.basis } : {}),
  }
  await writeLifecycleEvent({ supabase: ctx.supabase, tenantId: task.tenant_id, taskId, eventType: 'completed', actorId: ctx.actorId, metadata: { outcome, notes, ...extra } })
  return { status: 'completed' as const, outcome }
}

/** Reopen a completed task: back to todo with the outcome cleared. */
export async function reopenTask(ctx: ServiceContext, taskId: string) {
  await loadScopedTask(ctx, taskId, 'id')
  const { error } = await (ctx.supabase as any).from('tasks')
    .update({ status: 'todo', outcome: null, outcome_notes: null })
    .eq('id', taskId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to reopen the task')
  return { status: 'todo' as const }
}

/**
 * Tick / untick a subtask. With `logToTaskId` (the task tree's root task) a
 * completed/reopened event naming the subtask goes on that task's timeline.
 */
export async function setSubtaskCompleted(ctx: ServiceContext, subtaskId: string, completed: boolean, options: { logToTaskId?: string | null } = {}) {
  const subtask = await loadScopedTask(ctx, subtaskId, 'id, title')
  const status = completed ? 'completed' : 'todo'
  const { error } = await (ctx.supabase as any).from('tasks')
    .update({ status, completed_at: completed ? new Date().toISOString() : null })
    .eq('id', subtaskId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to update the subtask')
  if (options.logToTaskId) {
    const root = await loadScopedTask(ctx, options.logToTaskId, 'id, tenant_id')
    await writeLifecycleEvent({
      supabase: ctx.supabase, tenantId: root.tenant_id, taskId: root.id,
      eventType: completed ? 'completed' : 'reopened', actorId: ctx.actorId,
      metadata: { subtask_id: subtaskId, subtask_title: subtask.title ?? '', source: 'subtask_toggle' },
    })
  }
  return { status }
}

export { SUBTASK_TITLE_MAX } from '@/lib/tasks/subtask-input'

/** The columns a subtask comes back with (service, REST, MCP, Agent). */
const SUBTASK_COLUMNS = 'id, tenant_id, parent_task_id, title, subtitle, description, status, priority, due_date, sequence, tags, assignee_id, assigner_id, estimated_effort_assigner, estimated_effort_assignee, actual_effort, child_count, completed_child_count, completed_at, created_at'

export interface SubtaskRecord {
  id: string
  parent_task_id: string
  title: string
  subtitle: string | null
  description: string | null
  status: string
  priority: string
  due_date: string | null
  sequence: number
  tags: string[]
  assignee_id: string | null
  /** The working estimate in minutes (the assignee's, else the creator's), null when none. */
  estimated_effort_minutes: number | null
  /** Effort logged, in minutes. */
  actual_effort_minutes: number
  child_count: number
  completed_child_count: number
  created_at: string | null
}

export function toSubtaskRecord(row: Record<string, any>): SubtaskRecord {
  return {
    id: String(row.id),
    parent_task_id: String(row.parent_task_id ?? ''),
    title: String(row.title ?? ''),
    subtitle: row.subtitle ?? null,
    description: row.description ?? null,
    status: String(row.status ?? 'todo'),
    priority: String(row.priority ?? 'medium'),
    due_date: row.due_date ?? null,
    sequence: Number(row.sequence ?? 0),
    tags: Array.isArray(row.tags) ? row.tags.map(String) : [],
    assignee_id: row.assignee_id ?? null,
    estimated_effort_minutes: Number(row.estimated_effort_assignee || 0) || Number(row.estimated_effort_assigner || 0) || null,
    actual_effort_minutes: Number(row.actual_effort ?? 0) || 0,
    child_count: Number(row.child_count ?? 0) || 0,
    completed_child_count: Number(row.completed_child_count ?? 0) || 0,
    created_at: row.created_at ?? null,
  }
}

/**
 * Who may add subtasks (the rule every surface shows and the service
 * enforces): someone who can work on the task — tasks.complete AND able to
 * reach it (assignee, collaborator, member of its team, the assignee's
 * manager acting on their behalf, its assigner / creator, or tasks.view_all
 * oversight such as an admin; lib/task-authz canReachTask) — while it is
 * open and not already SUBTASK_MAX_DEPTH levels down. Workflow tasks
 * included: subtasks are a personal checklist under them and never touch the
 * workflow (they aren't workflow tasks, and the parent never auto-completes
 * from them — 20270104000000_task_subtask_fields.sql). Viewers (no
 * tasks.complete) and people who can't reach the task cannot.
 */
export function canAddSubtask(input: { canComplete: boolean; reachable: boolean; closed: boolean; depth?: number }): boolean {
  return input.canComplete && input.reachable && !input.closed && (input.depth ?? 0) < SUBTASK_MAX_DEPTH
}

/** How many levels down a task is (0 = a top-level task). */
export async function taskDepth(ctx: ServiceContext, task: { tenant_id: string; parent_task_id?: string | null }): Promise<number> {
  let depth = 0
  let parentId = task.parent_task_id ?? null
  while (parentId && depth <= SUBTASK_MAX_DEPTH) {
    depth += 1
    const { data } = await (ctx.supabase as any).from('tasks').select('parent_task_id')
      .eq('id', parentId).eq('tenant_id', task.tenant_id).maybeSingle()
    parentId = data?.parent_task_id ?? null
  }
  return depth
}

function invalidSubtask(errors: Record<string, string>): never {
  throw ServiceError.validation(`Invalid subtask: ${Object.values(errors).join('; ')}`, { errors })
}

/**
 * Add a subtask (canAddSubtask decides who): title plus optional subtitle,
 * description, estimate, due date, priority and tags (lib/tasks/subtask-input).
 * The subtask goes to the parent's assignee (else the caller), with the
 * parent's priority unless one is given, at the end of its subtasks, already
 * accepted (it is part of work they have). The parent's timeline records it;
 * its progress (child_count / completed_child_count) follows from the
 * tasks trigger.
 */
export async function addSubtask(ctx: ServiceContext, parentTaskId: string, input: SubtaskInput) {
  const checked = validateSubtaskInput(input)
  if (!checked.ok) invalidSubtask(checked.errors)
  const values = checked.values
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: subtasks are added by a user')
  const parent = await loadScopedTask(ctx, parentTaskId, 'id, tenant_id, status, priority, assignee_id, parent_task_id')
  if (parent.status === 'completed' || parent.status === 'cancelled') throw ServiceError.conflict('This task is closed — reopen it to add subtasks')
  if (parent.parent_task_id && (await taskDepth(ctx, parent as any)) >= SUBTASK_MAX_DEPTH) {
    throw ServiceError.validation(`Subtasks go at most ${SUBTASK_MAX_DEPTH} levels deep`)
  }

  const { data: last } = await (ctx.supabase as any).from('tasks').select('sequence')
    .eq('tenant_id', parent.tenant_id).eq('parent_task_id', parentTaskId).is('deleted_at', null)
    .order('sequence', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  const sequence = Number(last?.sequence ?? 0) + 1

  const { data, error } = await (ctx.supabase as any).from('tasks').insert({
    tenant_id: parent.tenant_id,
    parent_task_id: parentTaskId,
    title: values.title,
    subtitle: values.subtitle ?? null,
    description: values.description ?? null,
    status: 'todo',
    priority: values.priority ?? parent.priority ?? 'medium',
    // Assigning subtasks to other people comes later (SubtaskInput.assignee_id).
    assignee_id: parent.assignee_id ?? ctx.actorId,
    assigner_id: ctx.actorId,
    acceptance_status: 'accepted',
    sequence,
    due_date: values.due_date ?? null,
    estimated_effort_assigner: values.estimated_effort_assigner ?? null,
    tags: values.tags ?? null,
  }).select(SUBTASK_COLUMNS).single()
  if (error) throw dbError(error, 'Failed to add the subtask')
  await writeLifecycleEvent({
    supabase: ctx.supabase, tenantId: parent.tenant_id, taskId: parentTaskId, eventType: 'comment_added', actorId: ctx.actorId,
    metadata: { message: `Added subtask “${values.title}”`, subtask_id: data.id, source: 'subtask_added' },
  })
  return toSubtaskRecord(data)
}

/**
 * Edit a subtask's fields (any of addSubtask's; the estimate is the
 * creator's estimate). Same people as adding: tasks.complete and a task they
 * can reach (reaching the parent reaches its subtasks).
 */
export async function updateSubtask(ctx: ServiceContext, subtaskId: string, input: SubtaskInput, options: { parentTaskId?: string } = {}) {
  const checked = validateSubtaskInput(input, { partial: true })
  if (!checked.ok) invalidSubtask(checked.errors)
  if (Object.keys(checked.values).length === 0) throw ServiceError.validation('No fields to update')
  const subtask = await loadScopedTask(ctx, subtaskId, 'id, tenant_id, parent_task_id')
  if (!subtask.parent_task_id || (options.parentTaskId && subtask.parent_task_id !== options.parentTaskId)) throw ServiceError.notFound('Subtask not found')
  const { data, error } = await (ctx.supabase as any).from('tasks')
    .update({ ...checked.values, updated_at: new Date().toISOString() })
    .eq('id', subtaskId).eq('tenant_id', subtask.tenant_id).select(SUBTASK_COLUMNS).single()
  if (error || !data) throw dbError(error, 'Failed to update the subtask')
  return toSubtaskRecord(data)
}

/** A task's direct subtasks, in order, with whether the caller may add more. */
export async function listSubtasks(ctx: ServiceContext, parentTaskId: string) {
  requirePerm(ctx, 'tasks.view_own')
  const { data: parent, error: parentError } = await (ctx.supabase as any).from('tasks').select('id, tenant_id, status, parent_task_id')
    .eq('id', parentTaskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (parentError) throw dbError(parentError)
  if (!parent) throw ServiceError.notFound('Task not found')
  await requireTaskReach(ctx, parentTaskId)
  const { data, error } = await (ctx.supabase as any).from('tasks').select(SUBTASK_COLUMNS)
    .eq('tenant_id', parent.tenant_id).eq('parent_task_id', parentTaskId).is('deleted_at', null)
    .order('sequence', { ascending: true }).order('created_at', { ascending: true }).limit(500)
  if (error) throw dbError(error)
  const subtasks = ((data ?? []) as any[]).map(toSubtaskRecord)
  const depth = parent.parent_task_id ? await taskDepth(ctx, parent) : 0
  return {
    task_id: parentTaskId,
    subtasks,
    total: subtasks.length,
    completed: subtasks.filter((s) => s.status === 'completed').length,
    can_add: canAddSubtask({ canComplete: hasPerm(ctx, 'tasks.complete'), reachable: true, closed: parent.status === 'completed' || parent.status === 'cancelled', depth }),
  }
}

/** Activity timeline comment. */
export async function addTaskComment(ctx: ServiceContext, taskId: string, message: string) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) throw ServiceError.validation('Comment cannot be empty')
  if (text.length > 10_000) throw ServiceError.validation('Comment is too long (10,000 characters at most)')
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: comments are posted by a user')
  // Workers on the task (tasks.complete + reach) and invited viewers (read + comment): lib/services/task-viewers.
  const { data: task, error: taskError } = await (ctx.supabase as any).from('tasks')
    .select('id, tenant_id').eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (taskError) throw dbError(taskError)
  if (!task) throw ServiceError.notFound('Task not found')
  await (await import('./task-viewers')).requireTaskComment(ctx, taskId)
  // Inserted directly (not writeLifecycleEvent, which swallows errors): the
  // UI keeps the draft when the comment isn't saved.
  const { error } = await (ctx.supabase as any).from('lifecycle_events').insert({
    tenant_id: task.tenant_id,
    task_id: taskId,
    event_type: 'comment_added',
    actor_id: ctx.actorId,
    metadata: { message: text, source: 'user' },
  })
  if (error) throw dbError(error, 'Failed to post the comment')
  return { message: text }
}

/**
 * Task with its subtask tree (get_task_tree). The function itself checks
 * access (workspace member, assignee or assigner); null when not visible.
 */
export async function getTaskTree(ctx: ServiceContext, taskId: string) {
  // get_task_tree only checks workspace membership: a person with own-task
  // access sees their own tasks (and subtasks of them); tasks.view_all sees any.
  if (!ctx.permissions?.has('tasks.view_own') && !ctx.permissions?.has('tasks.view_all') && ctx.permissions !== null) return null
  // Read access: anyone who can reach it, or an invited viewer (read only).
  try { await (await import('./task-viewers')).requireTaskView(ctx, taskId) } catch { return null }
  const { data, error } = await (ctx.supabase as any).rpc('get_task_tree', { p_task_id: taskId })
  if (error) throw dbError(error)
  const tree = data as { task: Record<string, any> | null; subtasks: Record<string, any>[]; total_count: number; completed_count: number } | null
  return tree?.task ? tree : null
}
