/**
 * Task effort: time entries (manual log and timer), effort estimates, the
 * remaining-effort plan and the estimated completion date — the writes the
 * task detail's effort box, timer and inline work plan used to make from
 * the browser. Each write also records the same lifecycle event the browser
 * wrote, so the activity timeline is unchanged.
 *
 * All under tasks.complete (every system role holds it; the browser path was
 * gated by tenant membership only) and scoped to ctx.tenantId — the session
 * adapter acts in the task's own workspace (fromSession({ tenantId })), so
 * tasks opened from the unified view keep working.
 */

import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { getDb, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- task metadata is free-form jsonb */

/** Largest single effort entry or estimate, in minutes (one year). */
export const MAX_EFFORT_MINUTES = 525_600

interface EffortTask {
  id: string
  tenant_id: string
  actual_effort: number | null
  metadata: Record<string, any> | null
}

function requireActor(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: effort is recorded against a user')
  return ctx.actorId
}

function wholeMinutes(value: unknown, field: string, options: { allowZero?: boolean } = {}): number {
  const n = Number(value)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < (options.allowZero ? 0 : 1) || n > MAX_EFFORT_MINUTES) {
    throw ServiceError.validation(`${field} must be a whole number of minutes between ${options.allowZero ? 0 : 1} and ${MAX_EFFORT_MINUTES}`)
  }
  return n
}

function optionalTimestamp(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) throw ServiceError.validation(`${field} must be a date/time`)
  return date.toISOString()
}

function hours(minutes: number): string {
  return (minutes / 60).toFixed(1)
}

async function loadTask(ctx: ServiceContext, taskId: string): Promise<EffortTask> {
  requirePerm(ctx, 'tasks.complete')
  const { data, error } = await (getDb(ctx) as any).from('tasks')
    .select('id, tenant_id, actual_effort, metadata')
    .eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Task not found')
  return data as EffortTask
}

async function patchTask(ctx: ServiceContext, taskId: string, patch: Record<string, unknown>) {
  const { error } = await (getDb(ctx) as any).from('tasks')
    .update(patch).eq('id', taskId).eq('tenant_id', ctx.tenantId)
  if (error) throw dbError(error, 'Failed to update the task')
}

async function insertEffortRecord(ctx: ServiceContext, task: EffortTask, row: Record<string, unknown>) {
  const { error } = await (getDb(ctx) as any).from('effort_records').insert({
    tenant_id: task.tenant_id,
    task_id: task.id,
    user_id: requireActor(ctx),
    ...row,
  })
  if (error) throw dbError(error, 'Failed to record effort')
}

/** Add minutes to tasks.actual_effort (read-modify-write, as the browser did). */
async function addActualEffort(ctx: ServiceContext, task: EffortTask, minutes: number): Promise<number> {
  const actual = (task.actual_effort ?? 0) + minutes
  await patchTask(ctx, task.id, { actual_effort: actual })
  return actual
}

function lifecycle(ctx: ServiceContext, task: EffortTask, eventType: 'started' | 'comment_added', metadata: Record<string, unknown>) {
  return writeLifecycleEvent({ supabase: getDb(ctx), tenantId: task.tenant_id, taskId: task.id, eventType, actorId: ctx.actorId, metadata })
}

export interface ManualEffortInput {
  /** Hours and minutes as typed (decimals allowed); the entry is their rounded total. */
  hours?: number | null
  minutes?: number | null
  notes?: string | null
  /** Day the work was done (YYYY-MM-DD), shown on the timeline. */
  logDate?: string | null
  /** Entry timestamp (the browser's local time on logDate). Defaults to now. */
  entryAt?: string | null
}

/** "Log effort": an `actual` effort record, added to the task's actual effort. */
export async function logManualEffort(ctx: ServiceContext, taskId: string, input: ManualEffortInput) {
  const h = Number(input.hours ?? 0)
  const m = Number(input.minutes ?? 0)
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || m < 0) throw ServiceError.validation('Hours and minutes must be positive numbers')
  const total = wholeMinutes(Math.round(h * 60 + m), 'Effort')
  const notes = typeof input.notes === 'string' && input.notes.trim() ? input.notes.slice(0, 2000) : null
  const logDate = typeof input.logDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.logDate) ? input.logDate : null
  const entryAt = optionalTimestamp(input.entryAt, 'entryAt') ?? new Date().toISOString()

  const task = await loadTask(ctx, taskId)
  await insertEffortRecord(ctx, task, {
    record_type: 'actual',
    minutes: total,
    notes: notes || `Manual: ${h}h ${m}m`,
    created_at: entryAt,
  })
  const actualEffort = await addActualEffort(ctx, task, total)
  await lifecycle(ctx, task, 'started', { source: 'effort_log', minutes: total, hours: hours(total), notes, log_date: logDate })
  return { minutes: total, actual_effort: actualEffort }
}

/** h:mm:ss / m:ss, as the timer widget displays it. */
export function formatTimerDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Stopped timer: a `timer_entry` record (minutes rounded up), added to actual effort. */
export async function logTimerEntry(ctx: ServiceContext, taskId: string, input: { elapsedSeconds: number; startedAt?: string | null }) {
  const elapsed = Number(input.elapsedSeconds)
  if (!Number.isInteger(elapsed) || elapsed < 1 || elapsed > MAX_EFFORT_MINUTES * 60) throw ServiceError.validation('elapsedSeconds must be a positive whole number')
  const minutes = Math.ceil(elapsed / 60)
  const duration = formatTimerDuration(elapsed)

  const task = await loadTask(ctx, taskId)
  await insertEffortRecord(ctx, task, {
    record_type: 'timer_entry',
    minutes,
    timer_start: optionalTimestamp(input.startedAt, 'startedAt'),
    timer_end: new Date().toISOString(),
    notes: `Timer: ${duration}`,
  })
  const actualEffort = await addActualEffort(ctx, task, minutes)
  await lifecycle(ctx, task, 'started', { source: 'timer_entry', minutes, hours: hours(minutes), duration })
  return { minutes, actual_effort: actualEffort }
}

/**
 * Assigner or assignee (execution) estimate. The assignee estimate is also
 * kept as an `assignee_estimate` effort record (estimate history).
 */
export async function setEffortEstimate(ctx: ServiceContext, taskId: string, kind: 'assigner' | 'assignee', minutesInput: number) {
  if (kind !== 'assigner' && kind !== 'assignee') throw ServiceError.validation('kind must be assigner or assignee')
  const minutes = wholeMinutes(minutesInput, 'Estimate', { allowZero: true })
  const task = await loadTask(ctx, taskId)
  await patchTask(ctx, task.id, kind === 'assigner' ? { estimated_effort_assigner: minutes } : { estimated_effort_assignee: minutes })
  await lifecycle(ctx, task, 'comment_added', { source: `${kind}_estimate`, minutes, hours: hours(minutes) })
  if (kind === 'assignee') {
    await insertEffortRecord(ctx, task, { record_type: 'assignee_estimate', minutes })
  }
  return { minutes }
}

function remainingMetadata(ctx: ServiceContext, task: EffortTask, minutes: number | null) {
  return {
    ...(task.metadata ?? {}),
    remaining_effort_minutes: minutes,
    remaining_effort_updated_at: new Date().toISOString(),
    remaining_effort_updated_by: ctx.actorId,
  }
}

/** Manual remaining-effort plan (null = back to the calculated value). */
export async function setRemainingEffort(ctx: ServiceContext, taskId: string, minutesInput: number | null) {
  const minutes = minutesInput === null ? null : wholeMinutes(minutesInput, 'Remaining effort', { allowZero: true })
  const task = await loadTask(ctx, taskId)
  await patchTask(ctx, task.id, { metadata: remainingMetadata(ctx, task, minutes) })
  await lifecycle(ctx, task, 'comment_added', { source: 'remaining_effort', minutes, hours: minutes != null ? hours(minutes) : null })
  return { minutes }
}

export async function setEstimatedCompletion(ctx: ServiceContext, taskId: string, value: string | null) {
  const estimatedCompletion = optionalTimestamp(value, 'Estimated completion')
  const task = await loadTask(ctx, taskId)
  await patchTask(ctx, task.id, { estimated_completion: estimatedCompletion })
  await lifecycle(ctx, task, 'comment_added', { source: 'estimated_completion', estimated_completion: estimatedCompletion })
  return { estimated_completion: estimatedCompletion }
}

export interface WorkPlanInput {
  estimatedEffortAssigner: number | null
  estimatedEffortAssignee: number | null
  remainingEffortMinutes: number | null
  estimatedCompletion: string | null
}

/** Inline work plan (task lists): estimates, remaining plan and ETA in one save. */
export async function saveWorkPlan(ctx: ServiceContext, taskId: string, input: WorkPlanInput) {
  const optionalMinutes = (value: number | null, field: string) => value === null || value === undefined ? null : wholeMinutes(value, field, { allowZero: true })
  const assigner = optionalMinutes(input.estimatedEffortAssigner, 'Assigner estimate')
  const assignee = optionalMinutes(input.estimatedEffortAssignee, 'Assignee estimate')
  const remaining = optionalMinutes(input.remainingEffortMinutes, 'Remaining effort')
  const estimatedCompletion = optionalTimestamp(input.estimatedCompletion, 'Estimated completion')

  const task = await loadTask(ctx, taskId)
  await patchTask(ctx, task.id, {
    estimated_effort_assigner: assigner,
    estimated_effort_assignee: assignee,
    estimated_completion: estimatedCompletion,
    metadata: remainingMetadata(ctx, task, remaining),
  })
  await lifecycle(ctx, task, 'comment_added', {
    source: 'inline_work_plan',
    estimated_effort_assigner: assigner,
    estimated_effort_assignee: assignee,
    remaining_effort_minutes: remaining,
    estimated_completion: estimatedCompletion,
  })
  return { estimated_effort_assigner: assigner, estimated_effort_assignee: assignee, remaining_effort_minutes: remaining, estimated_completion: estimatedCompletion }
}
