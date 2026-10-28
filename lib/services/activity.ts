/**
 * Activity reads: a task's lifecycle timeline and the workspace audit feed
 * (/activity). Same rows, joins and ordering the views read from the browser;
 * tenant-scoped and permission-checked here, with RLS still applying (the
 * session adapter passes the user's client).
 */

import { getDb, hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- event / audit rows */

export const TASK_EVENT_LIMIT = 20
export const AUDIT_PAGE_SIZE = 50

/** A task's newest lifecycle events with their actor (task detail timeline). */
export async function listTaskEvents(ctx: ServiceContext, taskId: string, limit = TASK_EVENT_LIMIT) {
  if (!hasPerm(ctx, 'tasks.view_own') && !hasPerm(ctx, 'tasks.view_all')) requirePerm(ctx, 'tasks.view_own')
  const { data, error } = await (getDb(ctx) as any).from('lifecycle_events')
    .select('*, actor:users!lifecycle_events_actor_id_fkey(display_name, avatar_url)')
    .eq('task_id', taskId).eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Math.max(Math.trunc(limit) || TASK_EVENT_LIMIT, 1), 200))
  if (error) throw dbError(error)
  const events = (data ?? []) as Array<Record<string, any>>
  // On-behalf actions name the assignee the actor acted for.
  const behalfIds = Array.from(new Set(events.map((e) => e.metadata?.on_behalf_of).filter((v): v is string => typeof v === 'string' && v.length > 0)))
  if (behalfIds.length) {
    const { data: people } = await (getDb(ctx) as any).from('users').select('id, display_name, email').in('id', behalfIds)
    const nameById = new Map(((people ?? []) as any[]).map((p) => [String(p.id), p.display_name || p.email || null]))
    for (const e of events) if (e.metadata?.on_behalf_of) e.on_behalf_of_name = nameById.get(String(e.metadata.on_behalf_of)) ?? null
  }
  return events
}

export interface AuditActivityQuery {
  objectType?: string | null
  action?: string | null
  /** Zero-based page of AUDIT_PAGE_SIZE rows. */
  page?: number
}

/** Workspace audit feed, newest first, with an exact total (settings.view). */
export async function listAuditActivity(ctx: ServiceContext, query: AuditActivityQuery = {}) {
  requirePerm(ctx, 'settings.view')
  const page = Math.max(Math.trunc(Number(query.page ?? 0)) || 0, 0)
  if (page > 10_000) throw ServiceError.validation('page is too large')
  let request = (getDb(ctx) as any).from('object_audit_log')
    .select('*, actor:users!object_audit_log_actor_id_fkey(id, display_name)', { count: 'exact' })
    .eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
    .range(page * AUDIT_PAGE_SIZE, page * AUDIT_PAGE_SIZE + AUDIT_PAGE_SIZE - 1)
  if (query.objectType) request = request.eq('object_type', String(query.objectType))
  if (query.action) request = request.eq('action', String(query.action))
  const { data, error, count } = await request
  if (error) throw dbError(error)
  return { rows: (data ?? []) as Array<Record<string, any>>, total: count ?? 0 }
}
