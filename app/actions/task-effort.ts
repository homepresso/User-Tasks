'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSessionForTask } from '@/lib/actions/task-context'
import * as effort from '@/lib/services/task-effort'

/*
 * Task effort server actions (effort box, timer, manual entry, inline work
 * plan): thin wrappers over lib/services/task-effort, acting in the task's
 * own workspace. Failures come back as { ok: false, error }. No
 * revalidatePath: the task views are client-rendered and refresh their
 * React Query caches themselves, as before.
 */

function run<T>(label: string, taskId: string, fn: (ctx: Awaited<ReturnType<typeof fromSessionForTask>>) => Promise<T>): Promise<ActionResult<T>> {
  return runAction(label, 'Could not save the effort change.', async () => fn(await fromSessionForTask(taskId)))
}

export async function logManualEffort(taskId: string, input: effort.ManualEffortInput) {
  return run('logManualEffort', taskId, (ctx) => effort.logManualEffort(ctx, taskId, input))
}

export async function logTimerEntry(taskId: string, input: { elapsedSeconds: number; startedAt?: string | null }) {
  return run('logTimerEntry', taskId, (ctx) => effort.logTimerEntry(ctx, taskId, input))
}

export async function setEffortEstimate(taskId: string, kind: 'assigner' | 'assignee', minutes: number) {
  return run('setEffortEstimate', taskId, (ctx) => effort.setEffortEstimate(ctx, taskId, kind, minutes))
}

export async function setRemainingEffort(taskId: string, minutes: number | null) {
  return run('setRemainingEffort', taskId, (ctx) => effort.setRemainingEffort(ctx, taskId, minutes))
}

export async function setEstimatedCompletion(taskId: string, value: string | null) {
  return run('setEstimatedCompletion', taskId, (ctx) => effort.setEstimatedCompletion(ctx, taskId, value))
}

export async function saveTaskWorkPlan(taskId: string, input: effort.WorkPlanInput) {
  return run('saveTaskWorkPlan', taskId, (ctx) => effort.saveWorkPlan(ctx, taskId, input))
}
