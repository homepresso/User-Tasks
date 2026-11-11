'use server'

import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSessionForTask } from '@/lib/actions/task-context'
import * as viewers from '@/lib/services/task-viewers'

/**
 * Invite (read only): the task page and list panel's Invite dialog. The rules
 * live in lib/services/task-viewers.ts (who may invite / remove: the people
 * working on the task, its assigner, their managers, a manager of the
 * workflow, admins).
 */

export async function inviteTaskViewers(
  taskId: string,
  input: { principals: Array<{ type: 'user' | 'team' | 'role'; id: string }>; note?: string | null; include_subtasks?: boolean },
): Promise<ActionResult<viewers.AddViewersResult>> {
  return runAction('inviteTaskViewers', 'Could not invite', async () => {
    const result = await viewers.addTaskViewers(await fromSessionForTask(taskId), taskId, { ...input, via: 'ui' })
    revalidatePath(`/tasks/${taskId}`)
    return result
  })
}

export async function removeTaskViewer(taskId: string, viewerId: string): Promise<ActionResult<{ task_id: string; removed: viewers.TaskViewer }>> {
  return runAction('removeTaskViewer', 'Could not remove the invite', async () => {
    const result = await viewers.removeTaskViewer(await fromSessionForTask(taskId), taskId, viewerId, { via: 'ui' })
    revalidatePath(`/tasks/${taskId}`)
    return result
  })
}
