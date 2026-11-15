'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import { markAllTasksRead as markAllService, markTaskRead as markReadService, markTaskUnread as markUnreadService } from '@/lib/services/task-reads'

/*
 * Unread tasks: opening a task marks it read; "Mark as unread" on a task;
 * "Mark all as read" on the lists. Thin wrappers over
 * lib/services/task-reads (visibility checks there and in task_reads' RLS).
 */

export async function markTaskRead(taskId: string): Promise<ActionResult<{ task_id: string; unread: boolean }>> {
  return runAction('markTaskRead', 'Could not mark the task as read.', async () => markReadService(await fromSession(), taskId))
}

export async function markTaskUnread(taskId: string): Promise<ActionResult<{ task_id: string; unread: boolean }>> {
  return runAction('markTaskUnread', 'Could not mark the task as unread.', async () => markUnreadService(await fromSession(), taskId))
}

export async function markAllTasksRead(): Promise<ActionResult<{ marked: number }>> {
  return runAction('markAllTasksRead', 'Could not mark your tasks as read.', async () => markAllService(await fromSession()))
}
