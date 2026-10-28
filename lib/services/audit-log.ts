/**
 * Read access to the unified object audit log (object_audit_log, written by
 * lib/audit-log.ts and every service). Backs GET /api/v1/audit-log and the
 * MCP object_audit_log_query tool. Needs settings.view, like the /activity
 * feed in the UI.
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { applyPage, dbError, type Page } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- object_audit_log rows */

const COLUMNS = 'id, object_type, object_id, action, summary, diff, metadata, actor_id, created_at'

export interface AuditLogFilters {
  object_type?: string
  object_id?: string
  actor_id?: string
  action?: string
  /** ISO timestamp: events at or after. */
  from?: string
  /** ISO timestamp: events at or before. */
  to?: string
}

function checkTimestamp(value: string | undefined, name: string) {
  if (value !== undefined && Number.isNaN(Date.parse(value))) throw ServiceError.validation(`${name} must be an ISO timestamp`)
}

export async function listAuditLog(ctx: ServiceContext, filters: AuditLogFilters = {}, page: Page) {
  requirePerm(ctx, 'settings.view')
  checkTimestamp(filters.from, 'from')
  checkTimestamp(filters.to, 'to')
  let query = (ctx.supabase as any).from('object_audit_log')
    .select(COLUMNS, { count: 'exact' }).eq('tenant_id', ctx.tenantId)
    .order('created_at', { ascending: false })
  if (filters.object_type) query = query.eq('object_type', filters.object_type)
  if (filters.object_id) query = query.eq('object_id', filters.object_id)
  if (filters.actor_id) query = query.eq('actor_id', filters.actor_id)
  if (filters.action) query = query.eq('action', filters.action)
  if (filters.from) query = query.gte('created_at', filters.from)
  if (filters.to) query = query.lte('created_at', filters.to)
  const { data, count, error } = await applyPage(query, page)
  if (error) throw dbError(error)
  const events = (data ?? []) as Array<Record<string, any>>
  return { events, total: (count ?? events.length) as number }
}
