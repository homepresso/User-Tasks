/**
 * Unread tasks (task_reads, migration 20270115300000): per-person read
 * state behind the dot + bold title on task lists and the unread count next
 * to My tasks. The rule lives in the database (task_unread_ids) and is
 * restated in lib/tasks/unread.ts.
 *
 *  - unreadTaskIds / withUnread: which rows of one list page are unread
 *    for the caller — one indexed query per page (no per-row reads). No
 *    person (a tenant-wide key) or no migration yet: nothing is unread.
 *  - markTaskRead: opening a task (its page, the inline panel, the form).
 *  - markTaskUnread: "Mark as unread" (forgets the read; the task shows as
 *    unread again only while the rule says the person holds it and it is
 *    open).
 *  - markAllTasksRead: "Mark all as read" on lists, in the current
 *    workspace (session: the unified view = every member workspace).
 *  - countUnreadTasks: top-level unread tasks, as My tasks lists them.
 *
 * Personal: everything is the caller's own (ctx.actorId). Session callers
 * run on their RLS client (task_reads policies: own rows, member
 * workspaces, a task they can see); API / MCP callers on their workspace's
 * service-role client with the same checks here.
 */

import { getDb, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose PostgREST rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Ids per task_unread_ids call (longer lists are checked in batches). */
export const MAX_UNREAD_ID_BATCH = 500

export interface TaskReadState { task_id: string; unread: boolean }

function actor(ctx: ServiceContext): string {
  if (!ctx.actorId) throw ServiceError.forbidden('Read state is personal: use a credential bound to a user')
  return ctx.actorId
}

const isSession = (ctx: ServiceContext) => ctx.authKind === 'session'

/** API / MCP: the credential's workspace. Session: the current workspace (null = unified view). */
async function scopeTenant(ctx: ServiceContext, me: string): Promise<string | null> {
  if (!isSession(ctx)) return ctx.tenantId
  const { data } = await (getDb(ctx) as any).from('users').select('current_tenant_id').eq('id', me).maybeSingle()
  return (data as { current_tenant_id?: string | null } | null)?.current_tenant_id ?? null
}

/**
 * Which of these tasks are unread for the caller. Never throws for a
 * missing person or a database without the migration: the lists then show
 * everything as read.
 */
export async function unreadTaskIds(ctx: ServiceContext, taskIds: Array<string | null | undefined>): Promise<Set<string>> {
  const me = ctx.actorId
  if (!me) return new Set()
  const ids = Array.from(new Set(taskIds.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))))
  if (!ids.length) return new Set()
  const db = getDb(ctx) as any
  if (typeof db.rpc !== 'function') return new Set()
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += MAX_UNREAD_ID_BATCH) {
    const { data, error } = await db.rpc('task_unread_ids', {
      p_user_id: me, p_tenant_id: isSession(ctx) ? null : ctx.tenantId, p_task_ids: ids.slice(i, i + MAX_UNREAD_ID_BATCH),
    })
    if (error || !Array.isArray(data)) return out
    for (const row of data) {
      const id = String(typeof row === 'string' ? row : row?.task_id)
      if (UUID_RE.test(id)) out.add(id)
    }
  }
  return out
}

/** Rows with `unread` (true / false) for the caller — one query for the page. */
export async function withUnread<T extends { id?: unknown }>(ctx: ServiceContext, rows: T[]): Promise<Array<T & { unread: boolean }>> {
  if (!rows.length) return rows as Array<T & { unread: boolean }>
  const unread = await unreadTaskIds(ctx, rows.map((row) => (typeof row?.id === 'string' ? row.id : null)))
  return rows.map((row) => ({ ...row, unread: unread.has(String(row?.id)) }))
}

/** One task's `unread` for the caller (task get responses). */
export async function isTaskUnreadFor(ctx: ServiceContext, taskId: string): Promise<boolean> {
  return (await unreadTaskIds(ctx, [taskId])).has(taskId)
}

/** The task (not deleted) if I can see it — else "Task not found" (no probing). */
async function visibleTask(ctx: ServiceContext, db: AnySupabaseClient, taskId: string, me: string): Promise<{ id: string; tenant_id: string }> {
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  let query = (db as any).from('tasks').select('id, tenant_id').eq('id', taskId).is('deleted_at', null)
  if (!isSession(ctx)) query = query.eq('tenant_id', ctx.tenantId)
  const { data, error } = await query.maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Task not found')
  const { data: visible, error: accessError } = await (db as any).rpc('task_view_access', { p_task_id: taskId, p_user_id: me })
  if (accessError) throw dbError(accessError)
  if (visible !== true) throw ServiceError.notFound('Task not found')
  return { id: String(data.id), tenant_id: String(data.tenant_id) }
}

/** Mark a task I can see as read (opening it). Idempotent. */
export async function markTaskRead(ctx: ServiceContext, taskId: string): Promise<TaskReadState> {
  const me = actor(ctx)
  const db = getDb(ctx)
  const task = await visibleTask(ctx, db, taskId, me)
  // Database time (seen_at = now(), as routed_at), so app / database clock skew can't leave it unread.
  // Only tasks the rule calls unread get a row (a task I don't hold is never unread).
  const { error } = await (db as any).rpc('mark_tasks_read', {
    p_user_id: me, p_tenant_id: isSession(ctx) ? null : ctx.tenantId, p_task_ids: [task.id],
  })
  if (error) throw dbError(error)
  return { task_id: task.id, unread: false }
}

/**
 * Mark a task I can see as unread (forget the read). Reports the state the
 * rule then gives: a task I don't hold, or a closed one, stays read.
 */
export async function markTaskUnread(ctx: ServiceContext, taskId: string): Promise<TaskReadState> {
  const me = actor(ctx)
  const db = getDb(ctx)
  const task = await visibleTask(ctx, db, taskId, me)
  const { error } = await (db as any).from('task_reads').delete().eq('task_id', task.id).eq('user_id', me)
  if (error) throw dbError(error)
  return { task_id: task.id, unread: await isTaskUnreadFor(ctx, task.id) }
}

/** Mark every task that is unread for me as read (the workspace in scope). */
export async function markAllTasksRead(ctx: ServiceContext): Promise<{ marked: number }> {
  const me = actor(ctx)
  const tenantId = await scopeTenant(ctx, me)
  const { data, error } = await (getDb(ctx) as any).rpc('mark_tasks_read', { p_user_id: me, p_tenant_id: tenantId, p_task_ids: null })
  if (error) throw dbError(error)
  return { marked: Number(data) || 0 }
}

/** How many top-level tasks are unread for me (the workspace in scope). 0 without the migration. */
export async function countUnreadTasks(ctx: ServiceContext): Promise<{ unread: number }> {
  const me = actor(ctx)
  const tenantId = await scopeTenant(ctx, me)
  const { data, error } = await (getDb(ctx) as any).rpc('task_unread_count', { p_user_id: me, p_tenant_id: tenantId, p_top_level: true })
  if (error) return { unread: 0 }
  return { unread: Number(data) || 0 }
}
