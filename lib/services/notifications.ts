/**
 * The signed-in user's notification inbox (header bell): list, mark read /
 * unread, mark all read and delete. Notifications belong to a user, not a
 * workspace, so every query filters on ctx.actorId (across workspaces, as the
 * unified inbox always showed) and runs as that user, so the notifications
 * RLS policies still apply.
 */

import { getDb, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- notification rows */

export const NOTIFICATION_LIST_LIMIT = 30
const MAX_IDS = 500

function requireUser(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('Forbidden: notifications belong to a signed-in user')
  return ctx.actorId
}

function cleanIds(ids: string[]): string[] {
  return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => String(id).trim()).filter(Boolean))).slice(0, MAX_IDS)
}

/** Newest notifications first (the bell shows 30). */
export async function listNotifications(ctx: ServiceContext, limit = NOTIFICATION_LIST_LIMIT) {
  const userId = requireUser(ctx)
  const { data, error } = await (getDb(ctx) as any).from('notifications')
    .select('*').eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit) || NOTIFICATION_LIST_LIMIT, 1), 100))
  if (error) throw dbError(error)
  return (data ?? []) as Array<Record<string, any>>
}

export async function setNotificationsRead(ctx: ServiceContext, ids: string[], read: boolean) {
  const userId = requireUser(ctx)
  const list = cleanIds(ids)
  if (list.length === 0) return { updated: 0 }
  const { data, error } = await (getDb(ctx) as any).from('notifications')
    .update({ is_read: Boolean(read) }).eq('user_id', userId).in('id', list).select('id')
  if (error) throw dbError(error)
  return { updated: (data ?? []).length }
}

export async function markAllNotificationsRead(ctx: ServiceContext) {
  const userId = requireUser(ctx)
  const { data, error } = await (getDb(ctx) as any).from('notifications')
    .update({ is_read: true }).eq('user_id', userId).eq('is_read', false).select('id')
  if (error) throw dbError(error)
  return { updated: (data ?? []).length }
}

/**
 * Delete notifications. Runs as the user, so the notifications_delete RLS
 * policy (20261103200000) applies: only the user's own notifications in
 * workspaces they are an active member of. RLS filters silently, so the ids
 * that actually went are returned for the caller to compare.
 */
export async function deleteNotifications(ctx: ServiceContext, ids: string[]) {
  const userId = requireUser(ctx)
  const list = cleanIds(ids)
  if (list.length === 0) return { deleted: 0, ids: [] as string[] }
  const { data, error } = await (getDb(ctx) as any).from('notifications')
    .delete().eq('user_id', userId).in('id', list).select('id')
  if (error) throw dbError(error)
  const deletedIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
  return { deleted: deletedIds.length, ids: deletedIds }
}
