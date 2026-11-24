/**
 * Field-change audit trail of data tables (opt-in per table, migration
 * 20270128090000_data_table_change_audit; __tests__/data-table-audit.test.ts).
 *
 * With `audit_changes` on a table, a database trigger records every changed
 * field of every row update (old and new value, who, when) in
 * custom_table_row_changes — whatever wrote it (the grid, a form, the API,
 * a workflow). Reads here go through the rows' own RLS (a person sees the
 * history of rows they can read) and need data.view. Before the migration
 * is applied the history is simply unavailable (no error).
 */
import { requirePerm, ServiceError, type ServiceContext } from './context'
import { isMissingObject } from './data-table-grouping'
import { dbError } from './_shared'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped rows until db:types runs after the migration */

export const AUDIT_MIGRATION = '20270128090000_data_table_change_audit'
export const MAX_ROW_CHANGES = 200

export interface RowChange {
  field: string
  label: string
  old_value: unknown
  new_value: unknown
  changed_by: string | null
  changed_by_name: string | null
  changed_at: string
}

export function auditUnavailable(): ServiceError {
  return new ServiceError('internal', `Change history needs database migration ${AUDIT_MIGRATION}: ask an administrator to apply it`, { status: 503 })
}

/** A missing table / column (migration not applied yet), as PostgREST reports it. */
export function isAuditMissing(error: any): boolean {
  if (!error) return false
  return isMissingObject(error) || String(error.code ?? '') === '42P01' || String(error.code ?? '') === 'PGRST205' || /custom_table_row_changes|audit_changes/i.test(String(error.message ?? ''))
}

/** Stored changes + the table's columns + people → what the history shows (newest first; labels from the columns). */
export function shapeChanges(rows: any[], columns: any[], people: Map<string, string>): RowChange[] {
  const labels = new Map((Array.isArray(columns) ? columns : []).filter((c) => c?.key).map((c) => [String(c.key), String(c.name ?? c.label ?? c.key)]))
  return rows.map((r) => ({
    field: String(r.field),
    label: labels.get(String(r.field)) ?? String(r.field),
    old_value: r.old_value ?? null,
    new_value: r.new_value ?? null,
    changed_by: r.changed_by ?? null,
    changed_by_name: r.changed_by ? people.get(String(r.changed_by)) ?? null : null,
    changed_at: String(r.changed_at),
  }))
}

/** The change history of one row (newest first): { available: false } until the migration is applied. */
export async function listRowChanges(ctx: ServiceContext, tableId: string, rowId: string, opts: { limit?: number; table?: any } = {}): Promise<{ available: boolean; audited: boolean; changes: RowChange[] }> {
  requirePerm(ctx, 'data.view')
  const db = ctx.supabase as any
  const table = opts.table ?? (await db.from('custom_tables').select('*').eq('id', tableId).eq('tenant_id', ctx.tenantId).maybeSingle()).data
  if (!table) throw ServiceError.notFound('Data table not found')
  if (!('audit_changes' in table)) return { available: false, audited: false, changes: [] }
  const limit = Math.max(1, Math.min(MAX_ROW_CHANGES, Math.floor(Number(opts.limit ?? 50)) || 50))
  const { data, error } = await db.from('custom_table_row_changes')
    .select('field, old_value, new_value, changed_by, changed_at')
    .eq('tenant_id', ctx.tenantId).eq('table_id', tableId).eq('row_id', rowId)
    .order('changed_at', { ascending: false }).order('id', { ascending: false }).limit(limit)
  if (error) {
    if (isAuditMissing(error)) return { available: false, audited: false, changes: [] }
    throw dbError(error)
  }
  const ids = [...new Set(((data ?? []) as any[]).map((r) => r.changed_by).filter(Boolean))]
  const people = new Map<string, string>()
  if (ids.length) {
    const { data: users } = await db.from('users').select('id, display_name, email').in('id', ids)
    for (const u of (users ?? []) as any[]) people.set(String(u.id), String(u.display_name || u.email || ''))
  }
  return { available: true, audited: !!table.audit_changes, changes: shapeChanges(data ?? [], table.columns, people) }
}
