/**
 * Data store dashboard reads (providers phase 4): permission gates, argument
 * validation, table/rows by id (rows hydrated with policy and users), and
 * lookup options filtered/sorted/de-duplicated server-side.
 */
import { describe, expect, it, vi } from 'vitest'
import { runUiRead } from '@/lib/services/ui-reads'
import type { ServiceContext } from '@/lib/services/context'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function ctx(db: any, permissions: string[]): ServiceContext {
  return { db, supabase: db, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui' }
}

const db = () => createMemorySupabase({
  custom_tables: [
    { id: 'tb1', name: 'Orders', columns: [], updated_at: '2026-10-01' },
    { id: 'tb2', name: 'Customers', columns: [], updated_at: '2026-10-05' },
  ],
  custom_table_rows: [
    { id: 'r1', table_id: 'tb1', data: { city: 'Wellington', status: 'open' }, updated_at: '2026-10-01', created_by: 'user-1', updated_by: 'user-2', retention_policy_id: 'p1' },
    { id: 'r2', table_id: 'tb1', data: { city: 'Auckland', status: 'open' }, updated_at: '2026-10-03', created_by: 'user-2', updated_by: null, retention_policy_id: null },
    { id: 'r3', table_id: 'tb1', data: { city: 'auckland', status: 'closed' }, updated_at: '2026-10-02', created_by: null, updated_by: null, retention_policy_id: null },
    { id: 'r4', table_id: 'tb1', data: { city: '', status: 'open' }, updated_at: '2026-10-02', created_by: null, updated_by: null, retention_policy_id: null },
    { id: 'r5', table_id: 'tb2', data: { city: 'Dunedin' }, updated_at: '2026-10-04', created_by: null, updated_by: null, retention_policy_id: null },
  ],
  retention_policies: [{ id: 'p1', name: 'Keep 1y', policy_mode: 'purge_on' }],
  users: [
    { id: 'user-1', display_name: 'Ann', email: 'a@x' },
    { id: 'user-2', display_name: 'Bob', email: 'b@x' },
  ],
})

const VIEW = ['data.view']
const LOOKUP = { sourceTableId: 'tb1', sourceColumn: 'city' }

describe('data reads: permissions and args', () => {
  it.each([
    ['data.tables', undefined],
    ['data.table', { id: 'tb1' }],
    ['data.rows', { tableId: 'tb1' }],
    ['data.lookupTables', undefined],
    ['data.rowData', { id: 'r1' }],
    ['data.lookupOptions', LOOKUP],
  ])('%s needs data.view', async (name, args) => {
    const memory = db()
    const from = vi.spyOn(memory, 'from')
    expect(await runUiRead(ctx(memory, ['integrations.view']), { name, args })).toMatchObject({ ok: false, status: 403 })
    expect(from).not.toHaveBeenCalled()
    expect(await runUiRead(ctx(db(), VIEW), { name, args })).toMatchObject({ ok: true })
  })

  it('validates ids and lookup config', async () => {
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.table', args: { id: '' } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.rows', args: {} })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.lookupOptions', args: { sourceTableId: 'tb1' } })).toMatchObject({ ok: false, status: 400 })
    expect(await runUiRead(ctx(db(), VIEW), {
      name: 'data.lookupOptions',
      args: { ...LOOKUP, filters: [{ column: 'status', operator: 'drop_table' }] },
    })).toMatchObject({ ok: false, status: 400 })
  })
})

describe('data reads: data', () => {
  it('lists tables newest first; one table by id (missing → null)', async () => {
    const list = await runUiRead(ctx(db(), VIEW), { name: 'data.tables' }) as any
    expect(list.data.map((t: any) => t.id)).toEqual(['tb2', 'tb1'])
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.table', args: { id: 'tb1' } })).toMatchObject({ ok: true, data: { id: 'tb1', name: 'Orders' } })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.table', args: { id: 'nope' } })).toEqual({ ok: true, data: null })
  })

  it("returns only that table's rows, newest first, hydrated with policy and users", async () => {
    const res = await runUiRead(ctx(db(), VIEW), { name: 'data.rows', args: { tableId: 'tb1' } }) as any
    expect(res.data.map((r: any) => r.id)).toEqual(['r2', 'r3', 'r4', 'r1'])
    expect(res.data.find((r: any) => r.id === 'r1')).toMatchObject({
      retention_policy: { id: 'p1' }, creator: { id: 'user-1', display_name: 'Ann' }, updater: { id: 'user-2' },
    })
    expect(res.data.find((r: any) => r.id === 'r2')).toMatchObject({ retention_policy: null, creator: { id: 'user-2' }, updater: null })
  })

  it("returns a row's data only", async () => {
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.rowData', args: { id: 'r5' } })).toEqual({ ok: true, data: { city: 'Dunedin' } })
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.rowData', args: { id: 'nope' } })).toEqual({ ok: true, data: null })
  })

  it('computes lookup options server-side: source table only, blanks dropped, sorted', async () => {
    expect(await runUiRead(ctx(db(), VIEW), { name: 'data.lookupOptions', args: LOOKUP })).toEqual({
      ok: true,
      data: ['Auckland', 'auckland', 'Wellington'].map((v) => ({ value: v, label: v })),
    })
  })

  it('applies lookup filters, descending sort and distinct', async () => {
    const res = await runUiRead(ctx(db(), VIEW), {
      name: 'data.lookupOptions',
      args: { ...LOOKUP, filters: [{ id: 'f1', column: 'status', operator: 'equals', value: 'OPEN' }], sortDir: 'desc' },
    }) as any
    expect(res.data.map((o: any) => o.value)).toEqual(['Wellington', 'Auckland'])
    const distinct = await runUiRead(ctx(db(), VIEW), { name: 'data.lookupOptions', args: { ...LOOKUP, distinct: true } }) as any
    expect(distinct.data.map((o: any) => o.value)).toEqual(['Auckland', 'Wellington'])
  })
})
