'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as ownership from '@/lib/services/task-ownership'

/*
 * Take ownership of a task / (re)assign it (task page, process view, the
 * queue page's Active tasks tab). Thin wrappers over
 * lib/services/task-ownership (authorisation: lib/task-authz.ts
 * decideTaskAssignment).
 */

export async function takeTaskOwnership(taskId: string, reason?: string | null): Promise<ActionResult<ownership.AssignmentResult>> {
  return runAction('takeTaskOwnership', 'Could not take ownership of the task.', async () => ownership.takeTaskOwnership(await fromSession(), taskId, { reason: reason ?? null, via: 'ui' }))
}

export async function assignTaskTo(taskId: string, input: { targetUserId?: string | null; targetTeamId?: string | null; reason?: string | null }): Promise<ActionResult<ownership.AssignmentResult>> {
  return runAction('assignTaskTo', 'Could not reassign the task.', async () => ownership.assignTask(await fromSession(), taskId, {
    target_user_id: input.targetUserId ?? null, target_team_id: input.targetTeamId ?? null, reason: input.reason ?? null, via: 'ui',
  }))
}

export async function bulkAssignTasks(taskIds: string[], targetUserId: string, reason?: string | null) {
  return runAction('bulkAssignTasks', 'Could not reassign the tasks.', async () => ownership.bulkAssignTasks(await fromSession(), taskIds, { target_user_id: targetUserId, reason: reason ?? null, via: 'ui' }))
}
