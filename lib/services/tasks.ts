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
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
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

async function loadScopedTask(ctx: ServiceContext, taskId: string, columns: string) {
  requirePerm(ctx, 'tasks.complete')
  const { data, error } = await (ctx.supabase as any).from('tasks')
    .select(columns).eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Task not found')
  return data as Record<string, any>
}

/**
 * Complete a standard (non-workflow) task with an outcome. Workflow tasks
 * complete through completeWorkflowTask, which records the response and
 * resumes the run; they are refused here.
 */
export async function completeStandardTask(ctx: ServiceContext, taskId: string, input: { outcome: string; notes?: string | null }) {
  const outcome = typeof input.outcome === 'string' ? input.outcome.trim() : ''
  if (!outcome || outcome.length > 200) throw ServiceError.validation('outcome is required (at most 200 characters)')
  const task = await loadScopedTask(ctx, taskId, 'id, tenant_id, is_workflow_task, event_id')
  if (task.is_workflow_task && task.event_id) throw ServiceError.conflict('Workflow tasks complete through their workflow step')
  const notes = typeof input.notes === 'string' && input.notes ? input.notes.slice(0, 10_000) : null

  const { error } = await (ctx.supabase as any).from('tasks')
    .update({ status: 'completed', outcome, outcome_notes: notes })
    .eq('id', taskId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to complete the task')
  await writeLifecycleEvent({ supabase: ctx.supabase, tenantId: task.tenant_id, taskId, eventType: 'completed', actorId: ctx.actorId, metadata: { outcome, notes } })
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

/** Activity timeline comment. */
export async function addTaskComment(ctx: ServiceContext, taskId: string, message: string) {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) throw ServiceError.validation('Comment cannot be empty')
  if (text.length > 10_000) throw ServiceError.validation('Comment is too long (10,000 characters at most)')
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: comments are posted by a user')
  const task = await loadScopedTask(ctx, taskId, 'id, tenant_id')
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
  const { data, error } = await (ctx.supabase as any).rpc('get_task_tree', { p_task_id: taskId })
  if (error) throw dbError(error)
  const tree = data as { task: Record<string, any> | null; subtasks: Record<string, any>[]; total_count: number; completed_count: number } | null
  return tree?.task ? tree : null
}
