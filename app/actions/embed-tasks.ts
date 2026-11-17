'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { parseTaskListOptions, taskListQuery, type TaskListOptions } from '@/lib/embed/task-list'
import { fromSession } from '@/lib/services/context'

/*
 * The embeddable task list (/embed/tasks): its read and its row actions.
 * Thin wrappers: the list is lib/services/embed-tasks; actions are the app's
 * own (completeWorkflowTask / respondToTask, home.claimTask / unclaimTask),
 * so permissions, validation and audit are exactly the app's.
 */

export async function listEmbedTasks(options: TaskListOptions) {
  // Re-parse: the browser's options go through the same bounds as the URL's.
  const clean = parseTaskListOptions(new URLSearchParams(taskListQuery(options)))
  return runAction('listEmbedTasks', 'Could not load your tasks.', async () => {
    const svc = await import('@/lib/services/embed-tasks')
    return svc.listEmbedTab(await fromSession(), clean)
  })
}

/** Filter choices (workflows, people) — loaded when the filter menu first opens. */
export async function embedTaskFacets() {
  return runAction('embedTaskFacets', 'Could not load the filters.', async () => {
    const svc = await import('@/lib/services/embed-tasks')
    return svc.embedTaskFacets(await fromSession())
  })
}

export type EmbedTaskAction =
  | { kind: 'outcome'; outcome: string; comment?: string | null }
  | { kind: 'accept' }
  | { kind: 'decline'; comment: string }
  | { kind: 'claim' }
  | { kind: 'unclaim' }

/** One row action; `{ ok: false, error }` carries the app's own message (e.g. "A comment is required…"). */
export async function actOnEmbedTask(taskId: string, action: EmbedTaskAction): Promise<ActionResult<{ done: string }>> {
  if (typeof taskId !== 'string' || !taskId) return { ok: false, error: 'Task not found' }
  if (action.kind === 'outcome') {
    const { completeWorkflowTask } = await import('@/app/actions/task-queue')
    const result = await completeWorkflowTask(taskId, String(action.outcome ?? ''), action.comment?.trim() || undefined)
    if (!result.success) {
      if (result.status === 'invalid') return { ok: false, error: 'This task needs its form filled in — open it.' }
      return { ok: false, error: result.error ?? 'Could not complete the task.' }
    }
    const { kickQueueProcessor } = await import('@/lib/process-queue')
    kickQueueProcessor()
    return { ok: true, data: { done: result.status === 'waiting' ? `Response recorded (${result.responses} of ${result.needed})` : 'Done' } }
  }
  if (action.kind === 'accept' || action.kind === 'decline') {
    const { respondToTask } = await import('@/app/actions/task-queue')
    const result = await respondToTask(taskId, action.kind === 'accept' ? 'accepted' : 'rejected', action.kind === 'decline' ? action.comment : undefined)
    return result.success ? { ok: true, data: { done: action.kind === 'accept' ? 'Accepted' : 'Declined' } } : { ok: false, error: result.error }
  }
  if (action.kind === 'claim' || action.kind === 'unclaim') {
    const kind = action.kind
    return runAction(kind === 'claim' ? 'claimTask' : 'unclaimTask', kind === 'claim' ? 'Could not claim the task.' : 'Could not give the task back.', async () => {
      const home = await import('@/lib/services/home')
      const ctx = await fromSession()
      if (kind === 'claim') await home.claimTask(ctx, taskId)
      else await home.unclaimTask(ctx, taskId)
      return { done: kind === 'claim' ? 'Claimed' : 'Given back to the team' }
    })
  }
  return { ok: false, error: 'Unknown action' }
}
