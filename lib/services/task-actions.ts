/**
 * Actioning workflow tasks — the one implementation behind the task screen
 * (outcome buttons, form buttons, Save), POST /api/v1/tasks/{id}/action,
 * PATCH /api/v1/tasks/{id} values, the MCP task tools, the CLI (through
 * REST) and agent action tools.
 *
 * Authorisation is lib/task-authz.ts (assignee only, or a manager / the
 * break-glass tasks.complete_any holder acting on behalf with a note).
 * Writes use the service-role client after that check: end-user database
 * callers can no longer complete workflow tasks directly
 * (20261118000000_manager_tasks.sql).
 *
 * Acting on behalf records actioned_by = the manager and
 * actioned_on_behalf_of = the assignee on the task, the same on the
 * task_response lifecycle event (event stream / log export), an audit row,
 * and notifies the assignee (notification + email).
 */

import { authorizeTaskAction, isWorkflowTask, TaskAuthzError, type AuthorizedTaskAction } from '@/lib/task-authz'
import { recordTaskResponse } from '@/lib/task-completion'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { writeAudit } from '@/lib/audit-log'
import { requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { serviceRoleClient } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- task rows are untyped here */

export type TaskActionVia = 'ui' | 'api' | 'mcp' | 'agent'

export interface OnBehalfInput {
  /** Act for the assignee (managers, break-glass). */
  onBehalf?: boolean | null
  /** Why — required when acting on behalf. */
  onBehalfNote?: string | null
}

export function toServiceError(error: unknown): unknown {
  if (error instanceof TaskAuthzError) return new ServiceError(error.code, error.message, { status: error.status })
  return error
}

/** Authorise `ctx.actorId` on a task of ctx.tenantId (ServiceError on refusal). */
export async function authorizeTaskForContext(ctx: ServiceContext, db: AnySupabaseClient, taskId: string, input: OnBehalfInput & { requireNote?: boolean; allowClosed?: boolean; columns?: string } = {}): Promise<AuthorizedTaskAction> {
  try {
    return await authorizeTaskAction(db, {
      tenantId: ctx.tenantId,
      taskId,
      actorId: ctx.actorId,
      permissions: ctx.permissions,
      onBehalf: input.onBehalf === true,
      note: input.onBehalfNote ?? null,
      requireNote: input.requireNote,
      allowClosed: input.allowClosed,
      columns: input.columns,
    })
  } catch (error) {
    throw toServiceError(error)
  }
}

function behalfOf(access: AuthorizedTaskAction, actorId: string | null) {
  if ((access.mode === 'on_behalf' || access.mode === 'break_glass') && actorId && access.onBehalfOf) {
    return { actorId, note: access.note, actedAs: access.mode }
  }
  return null
}

export interface CompleteWorkflowTaskInput extends OnBehalfInput {
  outcome: string
  notes?: string | null
  values?: Record<string, unknown> | null
  buttonId?: string | null
}

export type CompleteWorkflowTaskResult =
  | { status: 'invalid'; errors: Record<string, string> }
  | { status: 'waiting'; responses: number; needed: number; acted_as: string; on_behalf_of: string | null }
  | {
      status: 'completed'; outcome: string; responses: number
      workflow_resumed: boolean; workflow_error: string | null; run_id: string | null
      acted_as: string; on_behalf_of: string | null
    }

/**
 * Record a response on a workflow task (completing it when its completion
 * rule is met) and queue the resume of the paused run.
 */
export async function completeWorkflowTaskAction(ctx: ServiceContext, taskId: string, input: CompleteWorkflowTaskInput, options: { via: TaskActionVia; notifyAssigner?: boolean }): Promise<CompleteWorkflowTaskResult> {
  requirePerm(ctx, 'tasks.complete')
  const outcome = typeof input.outcome === 'string' ? input.outcome.trim() : ''
  if (!outcome || outcome.length > 200) throw ServiceError.validation('outcome is required (at most 200 characters)')
  const db = await serviceRoleClient(ctx)
  const access = await authorizeTaskForContext(ctx, db, taskId, { ...input, columns: '*' })
  const task = access.task
  if (!isWorkflowTask(task)) throw ServiceError.validation('Not a workflow task — complete it as a standard task')
  const outcomes = Array.isArray(task.available_outcomes) ? (task.available_outcomes as string[]) : []
  if (outcomes.length && !outcomes.includes(outcome)) throw ServiceError.validation(`"${outcome}" is not an outcome of this task`)

  const onBehalf = behalfOf(access, ctx.actorId)
  const responder = onBehalf ? access.onBehalfOf : ctx.actorId
  const result = await recordTaskResponse({
    supabase: db as any,
    task,
    userId: responder,
    outcome,
    outcomeNotes: input.notes ?? null,
    values: input.values ?? null,
    source: options.via === 'mcp' ? 'api' : options.via,
    buttonId: input.buttonId ?? null,
    onBehalf,
    actedAs: access.mode === 'credential' ? 'credential' : null,
  })
  if (result.status === 'invalid') return result

  if (onBehalf) await afterOnBehalf(ctx, db, task, onBehalf, { onBehalfOf: access.onBehalfOf, outcome: result.status === 'completed' ? result.outcome : outcome, completed: result.status === 'completed', via: options.via })

  if (result.status === 'waiting') {
    return { status: 'waiting', responses: result.responses, needed: result.needed, acted_as: access.mode, on_behalf_of: onBehalf ? access.onBehalfOf : null }
  }

  let workflowResumed = true
  let workflowError: string | null = null
  let runId: string | null = null
  try {
    const { enqueueResume } = await import('@/lib/workflow-resume-queue')
    const queued = await enqueueResume({ tenantId: String(task.tenant_id), eventId: String(task.event_id), variables: { ...result.resume } })
    runId = queued.run_id
  } catch (error) {
    workflowResumed = false
    workflowError = error instanceof Error ? error.message : 'Failed to queue the workflow resume'
  }

  if (options.notifyAssigner && task.assigner_id && task.assigner_id !== ctx.actorId) {
    await (db as any).from('notifications').insert({
      user_id: task.assigner_id,
      tenant_id: task.tenant_id,
      type: 'task_completed',
      title: `Task completed: ${result.outcome}`,
      body: `"${task.title}" was completed with outcome: ${result.outcome} (${result.responses} response${result.responses !== 1 ? 's' : ''})`,
      task_id: taskId,
    })
  }

  return {
    status: 'completed', outcome: result.outcome, responses: result.responses,
    workflow_resumed: workflowResumed, workflow_error: workflowError, run_id: runId,
    acted_as: access.mode, on_behalf_of: onBehalf ? access.onBehalfOf : null,
  }
}

/**
 * Save draft values of a workflow task's form (partial; refused once the
 * task is closed). Managers may save on behalf (no note needed for a draft).
 */
export async function saveWorkflowTaskValues(ctx: ServiceContext, taskId: string, values: Record<string, unknown>, input: OnBehalfInput = {}): Promise<{ success: true } | { success: false; errors: Record<string, string> }> {
  requirePerm(ctx, 'tasks.complete')
  const db = await serviceRoleClient(ctx)
  const access = await authorizeTaskForContext(ctx, db, taskId, { ...input, requireNote: false, columns: 'metadata, title' })
  const task = access.task
  const metadata = (task.metadata ?? {}) as Record<string, unknown>
  const { errors, templateValues } = await mergeTaskFieldValuesChecked(db as any, String(task.tenant_id), metadata, values, { partial: true, taskId })
  if (Object.keys(errors).length > 0) return { success: false, errors }
  const { error } = await (db as any).from('tasks')
    .update({ metadata: { ...metadata, template_values: templateValues }, updated_at: new Date().toISOString() })
    .eq('id', taskId).eq('tenant_id', task.tenant_id)
  if (error) throw new ServiceError('internal', error.message)
  const onBehalf = behalfOf(access, ctx.actorId)
  await writeLifecycleEvent({
    supabase: db as any, tenantId: String(task.tenant_id), taskId, eventType: 'task_data_saved', actorId: ctx.actorId,
    metadata: { fields: Object.keys(values), ...(onBehalf ? { on_behalf_of: access.onBehalfOf, on_behalf_note: onBehalf.note, acted_as: onBehalf.actedAs } : {}) },
  })
  return { success: true }
}

/** Accept / hold / reject a workflow task from the queue (REST, MCP, agents). */
export async function respondToWorkflowTask(ctx: ServiceContext, taskId: string, response: 'accepted' | 'held' | 'rejected', input: OnBehalfInput & { comment?: string | null; via: TaskActionVia }) {
  requirePerm(ctx, 'tasks.complete')
  const db = await serviceRoleClient(ctx)
  const access = await authorizeTaskForContext(ctx, db, taskId, { ...input, columns: 'title, assigner_id' })
  const task = access.task
  const updates: Record<string, unknown> = { acceptance_status: response }
  if (response === 'accepted') {
    updates.accepted_at = new Date().toISOString()
    if (['todo', 'draft', 'blocked', '', null, undefined].includes(task.status as any)) updates.status = 'in_progress'
  }
  if (response === 'rejected') updates.status = 'cancelled'
  const { error } = await (db as any).from('tasks').update(updates).eq('id', taskId).eq('tenant_id', task.tenant_id)
  if (error) throw new ServiceError('internal', error.message)
  const onBehalf = behalfOf(access, ctx.actorId)
  await writeLifecycleEvent({
    supabase: db as any, tenantId: String(task.tenant_id), taskId, eventType: `task_${response}`, actorId: ctx.actorId,
    metadata: { comment: input.comment ?? null, via: input.via, ...(onBehalf ? { on_behalf_of: access.onBehalfOf, on_behalf_note: onBehalf.note, acted_as: onBehalf.actedAs } : access.mode === 'credential' ? { acted_as: 'credential' } : {}) },
  })
  if (onBehalf) await afterOnBehalf(ctx, db, task, onBehalf, { onBehalfOf: access.onBehalfOf, outcome: response, completed: response === 'rejected', via: input.via })
  return { response, acted_as: access.mode, on_behalf_of: onBehalf ? access.onBehalfOf : null }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

/** Audit + tell the assignee that someone acted for them. Never throws. */
async function afterOnBehalf(ctx: ServiceContext, db: AnySupabaseClient, task: Record<string, any>, onBehalf: { actorId: string; note: string | null; actedAs: string }, info: { onBehalfOf: string | null; outcome: string; completed: boolean; via: TaskActionVia }) {
  try {
    const target = info.onBehalfOf ?? ''
    const { data: people } = await (db as any).from('users').select('id, display_name, email')
      .in('id', [onBehalf.actorId, target].filter(Boolean))
    const byId = new Map(((people ?? []) as any[]).map((p) => [String(p.id), p]))
    const actor = byId.get(onBehalf.actorId)
    const actorName = actor?.display_name || actor?.email || 'Your manager'
    const breakGlass = onBehalf.actedAs === 'break_glass'

    await writeAudit({
      supabase: db as any,
      tenantId: String(task.tenant_id),
      actorId: onBehalf.actorId,
      objectType: 'task',
      objectId: String(task.id),
      action: breakGlass ? 'break_glass' : 'act_on_behalf',
      summary: `${breakGlass ? 'Break-glass: ' : ''}${actorName} actioned "${task.title ?? 'task'}" (${info.outcome}) on behalf of the assignee`,
      metadata: { on_behalf_of: target || null, note: onBehalf.note, outcome: info.outcome, via: info.via },
    })

    if (!target || target === onBehalf.actorId) return
    const verb = info.completed ? 'completed' : 'actioned'
    const title = `${actorName} ${verb} your task on your behalf`
    const body = `"${task.title ?? 'Task'}" — ${info.outcome}${onBehalf.note ? `. Note: ${onBehalf.note}` : ''}`
    await (db as any).from('notifications').insert({
      user_id: target,
      tenant_id: task.tenant_id,
      type: 'task_actioned_on_behalf',
      title,
      body: body.slice(0, 1000),
      task_id: task.id,
    })
    const assignee = byId.get(target)
    if (assignee?.email) {
      const [{ sendEmail }, { appUrlOrLocalhost }] = await Promise.all([import('@/lib/email'), import('@/lib/config/bootstrap')])
      const link = `${appUrlOrLocalhost().replace(/\/$/, '')}/tasks/${task.id}`
      await sendEmail({
        to: assignee.email,
        subject: title,
        body: `<p>${escapeHtml(actorName)} ${verb} <strong>${escapeHtml(String(task.title ?? 'a task'))}</strong> on your behalf (outcome: ${escapeHtml(info.outcome)}).</p>`
          + (onBehalf.note ? `<p>Note: ${escapeHtml(onBehalf.note)}</p>` : '')
          + `<p><a href="${escapeHtml(link)}">Open the task</a></p>`,
      })
    }
  } catch (error) {
    console.warn('[task-actions] on-behalf follow-up failed:', error instanceof Error ? error.message : error)
  }
}
