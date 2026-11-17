/**
 * Data grid views and inline cell writes (lib/services/data-table-views.ts,
 * /api/v1/data-tables/{id}/views, …/rows/{rowId}/cells, …/views/{viewId}/options):
 * view saves (permissions, normalisation, binding checks), the server-side
 * enforcement of read-only columns, bound values confirmed in their source
 * (table binding, cascading {{row.x}}), the updated_at conflict, people and
 * signature settling, and options run from the SAVED binding.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/data-table-workflow-triggers', () => ({ enqueueDataTableEvents: vi.fn(async () => 0) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }))

import { enqueueDataTableEvents } from '@/lib/data-table-workflow-triggers'
import type { ServiceContext } from '@/lib/services/context'
import { getTableViews, gridColumnOptions, saveTableViews, writeGridCells } from '@/lib/services/data-table-views'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T = 'tenant-a'
const ORDERS = '0f000000-0000-4000-8000-00000000b001'
const REGIONS = '0f000000-0000-4000-8000-00000000b002'
const FOREIGN = '0f000000-0000-4000-8000-00000000b003'
const ROW = '0f000000-0000-4000-8000-00000000c001'
const R_NORTH = '0f000000-0000-4000-8000-00000000c101'
const R_SOUTH = '0f000000-0000-4000-8000-00000000c102'
const R_AU = '0f000000-0000-4000-8000-00000000c103'
const USER = '0f000000-0000-4000-8000-00000000d001'
const OUTSIDER = '0f000000-0000-4000-8000-00000000d002'
const STAMP = '2026-11-15T10:00:00.000Z'

const ALL = ['data.view', 'data.edit_schema', 'data.manage_rows']

const VIEW = {
  id: 'v_main', name: 'Main', inline_edit: true, default: true,
  columns: [
    { key: 'title', label: 'Title', control: 'text', required: true },
    { key: 'amount', label: 'Amount', control: 'currency', editable: false },
    { key: 'country', label: 'Country', control: 'dropdown', control_options: { choices: ['NZ', 'AU'] } },
    { key: 'region', label: 'Region', control: 'dropdown', binding: { source: 'table', table_id: REGIONS, value_column: 'code', display_columns: ['name'], filters: [{ column: 'country', operator: 'eq', value: '{{row.country}}' }] } },
    { key: 'owner', label: 'Owner', control: 'people' },
    { key: 'signed', label: 'Signed', control: 'signature' },
  ],
}

function seed(views: unknown[] = [VIEW]) {
  return createMemorySupabase({
    custom_tables: [
      {
        id: ORDERS, tenant_id: T, name: 'Orders', slug: 'orders', views,
        columns: [
          { key: 'id', name: 'ID', type: 'number' }, { key: 'title', name: 'Title', type: 'text' }, { key: 'amount', name: 'Amount', type: 'number' },
          { key: 'country', name: 'Country', type: 'select', options: ['NZ', 'AU'] }, { key: 'region', name: 'Region', type: 'text' },
          { key: 'owner', name: 'Owner', type: 'text' }, { key: 'signed', name: 'Signed', type: 'file' },
        ],
      },
      { id: REGIONS, tenant_id: T, name: 'Regions', slug: 'regions', views: [], columns: [{ key: 'code', name: 'Code', type: 'text' }, { key: 'name', name: 'Name', type: 'text' }, { key: 'country', name: 'Country', type: 'text' }] },
      { id: FOREIGN, tenant_id: 'tenant-b', name: 'Foreign', slug: 'foreign', views: [], columns: [] },
    ],
    custom_table_rows: [
      { id: ROW, table_id: ORDERS, tenant_id: T, data: { id: 1, title: 'A', amount: 10, country: 'NZ', region: 'N' }, created_at: '2026-11-01T00:00:00Z', updated_at: STAMP },
      { id: R_NORTH, table_id: REGIONS, tenant_id: T, data: { code: 'N', name: 'North', country: 'NZ' }, created_at: '2026-01-01T00:00:00Z' },
      { id: R_SOUTH, table_id: REGIONS, tenant_id: T, data: { code: 'S', name: 'South', country: 'NZ' }, created_at: '2026-01-02T00:00:00Z' },
      { id: R_AU, table_id: REGIONS, tenant_id: T, data: { code: 'Q', name: 'Queensland', country: 'AU' }, created_at: '2026-01-03T00:00:00Z' },
    ],
    user_memberships: [{ user_id: USER, tenant_id: T, is_active: true }],
    users: [{ id: USER, display_name: 'Ana Admin', email: 'ana@example.com' }, { id: OUTSIDER, display_name: 'Out', email: 'o@example.com' }],
    teams: [],
    integration_references: [],
  })
}
type Db = ReturnType<typeof seed>

function ctx(db: Db, permissions: string[] = ALL, tableIds: string[] = []): ServiceContext {
  return {
    supabase: db as unknown as ServiceContext['supabase'], tenantId: T, actorId: USER,
    permissions: new Set(permissions), resourceScopes: { workflow_ids: [], table_ids: tableIds }, authKind: 'api_key', source: 'api',
  }
}
const rowData = (db: Db) => db.tables.custom_table_rows.find((r) => r.id === ROW)!.data

beforeEach(() => vi.mocked(enqueueDataTableEvents).mockClear())

describe('views', () => {
  it('reads the saved views normalised against the table (data.view)', async () => {
    const db = seed()
    const res = await getTableViews(ctx(db, ['data.view']), ORDERS)
    expect(res.views[0].columns.map((c) => c.key)).toEqual(['title', 'amount', 'country', 'region', 'owner', 'signed'])
    expect(res.default_view.id).toBe('v_main')
    await expect(getTableViews(ctx(db, []), ORDERS)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(getTableViews(ctx(db), FOREIGN)).rejects.toMatchObject({ code: 'not_found' })
    await expect(getTableViews(ctx(db, ALL, [REGIONS]), ORDERS)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('saves views with data.edit_schema: unknown columns dropped, problems refused, bindings checked', async () => {
    const db = seed([])
    await expect(saveTableViews(ctx(db, ['data.view', 'data.manage_rows']), ORDERS, [VIEW])).rejects.toMatchObject({ code: 'forbidden' })
    const saved = await saveTableViews(ctx(db), ORDERS, [{ ...VIEW, columns: [...VIEW.columns, { key: 'ghost', control: 'text' }] }])
    expect(saved.views[0].columns.map((c) => c.key)).not.toContain('ghost')
    expect(db.tables.custom_tables.find((t) => t.id === ORDERS)!.views[0].inline_edit).toBe(true)
    await expect(saveTableViews(ctx(db), ORDERS, [{ name: 'Bad', columns: [{ key: 'title', control: 'dropdown' }] }])).rejects.toMatchObject({ code: 'validation_error', message: expect.stringMatching(/add the choices or bind/) })
    await expect(saveTableViews(ctx(db), ORDERS, [{ name: 'X', columns: [{ key: 'region', control: 'dropdown', binding: { source: 'table', table_id: FOREIGN } }] }])).rejects.toThrow(/does not exist in this workspace/)
    await expect(saveTableViews(ctx(db), ORDERS, { not: 'an array' })).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('inline cell writes', () => {
  it('writes an editable cell, guarded by updated_at, and fires the "updated" workflows', async () => {
    const db = seed()
    const res = await writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { title: 'B' }, expected_updated_at: STAMP })
    expect(res.changed).toEqual(['title'])
    expect(rowData(db)).toMatchObject({ title: 'B', amount: 10 })
    expect(res.updated_at).not.toBe(STAMP)
    expect(vi.mocked(enqueueDataTableEvents)).toHaveBeenCalledWith(expect.objectContaining({ tableId: ORDERS, events: [expect.objectContaining({ rowId: ROW, eventType: 'updated' })] }))
  })

  it('refuses read-only and unknown columns even when the client sends them (nothing written)', async () => {
    const db = seed()
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { amount: 999, title: 'Z' } })).rejects.toMatchObject({ code: 'validation_error', message: 'Amount is read-only', details: { cells: { amount: 'Amount is read-only' } } })
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { id: 7 } })).rejects.toThrow(/not a column of this view/)
    expect(rowData(db)).toMatchObject({ title: 'A', amount: 10, id: 1 })
  })

  it('needs data.manage_rows, a saved view with inline editing on, and valid values', async () => {
    const db = seed([{ ...VIEW, inline_edit: false }])
    await expect(writeGridCells(ctx(db, ['data.view']), ORDERS, ROW, { view_id: 'v_main', cells: { title: 'B' } })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { title: 'B' } })).rejects.toThrow(/turned off/)
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'nope', cells: { title: 'B' } })).rejects.toMatchObject({ code: 'not_found' })
    const db2 = seed()
    await expect(writeGridCells(ctx(db2), ORDERS, ROW, { view_id: 'v_main', cells: { title: '' } })).rejects.toThrow('Title is required')
    await expect(writeGridCells(ctx(db2), ORDERS, ROW, { view_id: 'v_main', cells: { country: 'US' } })).rejects.toThrow(/must be one of/)
  })

  it('answers a friendly 409 with the current row when the row changed since it was read', async () => {
    const db = seed()
    const err = await writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { title: 'Mine' }, expected_updated_at: '2026-11-14T00:00:00Z' }).catch((e) => e)
    expect(err).toMatchObject({ code: 'conflict', status: 409 })
    expect(err.message).toMatch(/changed this row after you opened it/)
    expect(err.details.row.data.title).toBe('A')
    expect(rowData(db).title).toBe('A')
  })

  it('confirms a bound value in its source, with the row as {{row.<column>}} (cascading)', async () => {
    const db = seed()
    await writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { region: 'S' } })
    expect(rowData(db).region).toBe('S')
    // Queensland is an AU region: not an option while the row's country is NZ.
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { region: 'Q' } })).rejects.toThrow('Region: "Q" is not one of the options')
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { region: 'NOPE' } })).rejects.toThrow(/not one of the options/)
  })

  it('people: workspace members only, names set by the server', async () => {
    const db = seed()
    await writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { owner: [{ kind: 'user', id: USER, name: 'Fake name' }] } })
    expect(rowData(db).owner).toEqual([{ kind: 'user', id: USER, name: 'Ana Admin' }])
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { owner: [{ kind: 'user', id: OUTSIDER }] } })).rejects.toThrow(/not in this workspace/)
  })

  it('signatures: the PNG must be a file of this table; the signer and time are stamped by the server', async () => {
    const db = seed()
    const sig = { file: { name: 'signature.png', url: 'https://files.example/s.png', path: `data-tables/${ORDERS}/s.png` }, method: 'draw', signed_at: '1999-01-01T00:00:00Z', user_name: 'Someone else' }
    await writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { signed: sig } })
    expect(rowData(db).signed).toMatchObject({ method: 'draw', user_id: USER, user_name: 'Ana Admin' })
    expect(rowData(db).signed.signed_at).not.toBe('1999-01-01T00:00:00Z')
    const other = { ...sig, file: { ...sig.file, url: 'https://files.example/x.png', path: `data-tables/${REGIONS}/x.png` } }
    await expect(writeGridCells(ctx(db), ORDERS, ROW, { view_id: 'v_main', cells: { signed: other } })).rejects.toThrow(/upload the file to this table first/)
  })
})

describe('bound options', () => {
  it('runs the SAVED binding with the row scope (cascading) and resolves labels', async () => {
    const db = seed()
    const nz = await gridColumnOptions(ctx(db, ['data.view']), ORDERS, 'v_main', { column: 'region', row: { country: 'NZ' } })
    expect(nz.items.map((i) => [i.value, i.label])).toEqual([['N', 'North'], ['S', 'South']])
    const au = await gridColumnOptions(ctx(db, ['data.view']), ORDERS, 'v_main', { column: 'region', row: { country: 'AU' } })
    expect(au.items.map((i) => i.value)).toEqual(['Q'])
    const labels = await gridColumnOptions(ctx(db, ['data.view']), ORDERS, 'v_main', { column: 'region', resolve: ['S'], row: { country: 'NZ' } })
    expect(labels.items).toEqual([expect.objectContaining({ value: 'S', label: 'South' })])
  })

  it('refuses unbound columns, unknown views and a key scoped away from the bound table', async () => {
    const db = seed()
    await expect(gridColumnOptions(ctx(db), ORDERS, 'v_main', { column: 'title' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(gridColumnOptions(ctx(db), ORDERS, 'nope', { column: 'region' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(gridColumnOptions(ctx(db, ALL, [ORDERS]), ORDERS, 'v_main', { column: 'region' })).rejects.toMatchObject({ code: 'forbidden' })
  })
})
