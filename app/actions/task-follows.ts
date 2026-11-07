'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import { setTaskFollowed as setTaskFollowedService } from '@/lib/services/task-follows'

/*
 * Task tracker → Following: follow / unfollow a task (the bell on tracker
 * rows and the task page). A thin wrapper over lib/services/task-follows
 * (the visibility check lives there and in the table's RLS).
 */

export async function setTaskFollowed(taskId: string, follow: boolean): Promise<ActionResult<{ task_id: string; following: boolean }>> {
  return runAction('setTaskFollowed', follow ? 'Could not follow the task.' : 'Could not unfollow the task.', async () =>
    setTaskFollowedService(await fromSession(), taskId, follow))
}
