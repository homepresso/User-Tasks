'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSessionForTask } from '@/lib/actions/task-context'
import { fromSession } from '@/lib/services/context'
import * as activity from '@/lib/services/activity'

/* Activity reads (lib/services/activity): task timelines and the audit feed. */

/** A task's newest lifecycle events, read in the task's own workspace. */
export async function listTaskEvents(taskId: string): Promise<ActionResult<Array<Record<string, unknown>>>> {
  return runAction('listTaskEvents', 'Could not load the activity.', async () => activity.listTaskEvents(await fromSessionForTask(taskId), taskId))
}

export async function listAuditActivity(query: activity.AuditActivityQuery): Promise<ActionResult<{ rows: Array<Record<string, unknown>>; total: number }>> {
  return runAction('listAuditActivity', 'Could not load the activity.', async () => activity.listAuditActivity(await fromSession(), query))
}
