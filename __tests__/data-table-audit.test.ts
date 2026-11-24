/**
 * Field-change audit trail of data tables (opt-in per table; migration
 * 20270128090000_data_table_change_audit): the shapes the history shows,
 * reads before and after the migration, and the migration's guarantees.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- recorded query chains */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAuditMissing, listRowChanges, shapeChanges } from '@/lib/services/data-table-audit'
import { auditValueText } from '@/lib/data-table-audit-format'
import { WIDGET_CONFIG_SCHEMAS } from '@/lib/apps/schema'
import { dataTableUpdateBody } from '@/lib/api-schemas/data-tables'

const TABLE = '0f000000-0000-4000-8000-0000000000d1'
const ROW = '0f000000-0000-4000-8000-0000000000e1'
const MAYA = '0a000000-0000-4000-8000-0000000000a1'

/** A PostgREST stand-in: per table, the result of the chain (and the calls made). */
function db(results: Record<string, { data: unknown; error: unknown }>) {
  const calls: Array<[string, string, ...unknown[]]> = []
  const from = (table: string) => {
    const chain: any = new Proxy({}, {
      get(_t, prop: string) {
        if (prop === 'then') return (resolve: any) => resolve(results[table] ?? { data: null, error: null })
        if (prop === 'maybeSingle') return async () => results[table] ?? { data: null, error: null }
        return (...args: unknown[]) => { calls.push([table, prop, ...args]); return chain }
      },
    })
    return chain
  }
  return { client: { from }, calls }
}
const ctx = (client: any, perms = ['data.view']) => ({ supabase: client, db: client, tenantId: 't1', actorId: MAYA, permissions: new Set(perms), authKind: 'session', source: 'ui' }) as any

describe('data table change history', () => {
  it('shapes changes with column labels and people; automation writes have no person', () => {
    const rows = [
      { field: 'stage', old_value: 'Proposal', new_value: 'Negotiation', changed_by: MAYA, changed_at: '2026-11-23T10:00:00Z' },
      { field: 'amount', old_value: 1000, new_value: null, changed_by: null, changed_at: '2026-11-22T10:00:00Z' },
    ]
    const out = shapeChanges(rows, [{ key: 'stage', name: 'Stage' }], new Map([[MAYA, 'Maya Patel']]))
    expect(out[0]).toMatchObject({ label: 'Stage', changed_by_name: 'Maya Patel' })
    expect(out[1]).toMatchObject({ label: 'amount', changed_by: null, changed_by_name: null, new_value: null })
    expect([auditValueText(null), auditValueText(''), auditValueText(true), auditValueText({ name: 'Acme' }), auditValueText(['a', 'b']), auditValueText(5)]).toEqual(['(empty)', '(empty)', 'Yes', 'Acme', 'a, b', '5'])
  })

  it('reads a row’s history newest first, scoped to the workspace, table and row', async () => {
    const { client, calls } = db({
      custom_tables: { data: { id: TABLE, columns: [{ key: 'stage', name: 'Stage' }], audit_changes: true }, error: null },
      custom_table_row_changes: { data: [{ field: 'stage', old_value: 'A', new_value: 'B', changed_by: MAYA, changed_at: '2026-11-23T10:00:00Z' }], error: null },
      users: { data: [{ id: MAYA, display_name: 'Maya Patel' }], error: null },
    })
    const r = await listRowChanges(ctx(client), TABLE, ROW, { limit: 999 })
    expect(r).toMatchObject({ available: true, audited: true, changes: [{ label: 'Stage', changed_by_name: 'Maya Patel' }] })
    const q = calls.filter((c) => c[0] === 'custom_table_row_changes')
    expect(q).toEqual(expect.arrayContaining([['custom_table_row_changes', 'eq', 'tenant_id', 't1'], ['custom_table_row_changes', 'eq', 'table_id', TABLE], ['custom_table_row_changes', 'eq', 'row_id', ROW], ['custom_table_row_changes', 'limit', 200]]))
  })

  it('before the migration: unavailable, never an error; without data.view: refused', async () => {
    const before = db({ custom_tables: { data: { id: TABLE, columns: [] }, error: null } })
    expect(await listRowChanges(ctx(before.client), TABLE, ROW)).toEqual({ available: false, audited: false, changes: [] })
    const missing = db({ custom_tables: { data: { id: TABLE, columns: [], audit_changes: false }, error: null }, custom_table_row_changes: { data: null, error: { code: '42P01', message: 'relation "custom_table_row_changes" does not exist' } } })
    expect((await listRowChanges(ctx(missing.client), TABLE, ROW)).available).toBe(false)
    expect(isAuditMissing({ code: '42703', message: 'column custom_tables.audit_changes does not exist' })).toBe(true)
    expect(isAuditMissing({ code: '23505', message: 'duplicate key' })).toBe(false)
    await expect(listRowChanges(ctx(before.client, []), TABLE, ROW)).rejects.toThrow()
  })

  it('settings: the table switch (API) and the record card’s history option', () => {
    expect(dataTableUpdateBody.parse({ audit_changes: true }).audit_changes).toBe(true)
    expect(WIDGET_CONFIG_SCHEMAS.record_card.parse({ show_history: true }).show_history).toBe(true)
  })

  it('the migration: opt-in column, history cascades with the row (retention), RLS through the rows, trigger-only writes', () => {
    const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20270128090000_data_table_change_audit.sql'), 'utf8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS audit_changes boolean NOT NULL DEFAULT false/)
    expect(sql).toMatch(/row_id uuid NOT NULL REFERENCES public\.custom_table_rows\(id\) ON DELETE CASCADE/)
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/EXISTS \(SELECT 1 FROM public\.custom_table_rows r WHERE r\.id = custom_table_row_changes\.row_id\)/)
    expect(sql).toMatch(/GRANT SELECT ON public\.custom_table_row_changes TO authenticated/)
    expect(sql).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL) ON public\.custom_table_row_changes TO authenticated/)
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/AFTER UPDATE OF data ON public\.custom_table_rows/)
    expect(sql).toMatch(/t\.audit_changes/)
  })
})
