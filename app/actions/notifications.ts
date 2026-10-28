'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession } from '@/lib/services/context'
import * as notifications from '@/lib/services/notifications'

/* Notification bell: the signed-in user's own notifications (lib/services/notifications). */

export async function listMyNotifications(): Promise<ActionResult<Array<Record<string, unknown>>>> {
  return runAction('listMyNotifications', 'Could not load notifications.', async () => notifications.listNotifications(await fromSession()))
}

export async function setNotificationsRead(ids: string[], read: boolean): Promise<ActionResult<{ updated: number }>> {
  return runAction('setNotificationsRead', 'Could not update notifications.', async () => notifications.setNotificationsRead(await fromSession(), ids, read))
}

export async function markAllNotificationsRead(): Promise<ActionResult<{ updated: number }>> {
  return runAction('markAllNotificationsRead', 'Could not update notifications.', async () => notifications.markAllNotificationsRead(await fromSession()))
}

export async function deleteNotifications(ids: string[]): Promise<ActionResult<{ deleted: number; ids: string[] }>> {
  return runAction('deleteNotifications', 'Could not delete notifications.', async () => notifications.deleteNotifications(await fromSession(), ids))
}
