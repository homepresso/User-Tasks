/**
 * "Edit all rows" batch save (lib/services/data-table-views.ts
 * writeGridRows, PATCH /api/v1/data-tables/{id}/rows/cells): every row is
 * checked like a single inline write and gets its own outcome (saved,
 * unchanged, invalid with per-cell errors, conflict with the current row,
 * not found); read-only cells are refused per row; new rows need the view's
 * Add rows and every required column; nothing is rolled back; and the
 * data_table_event workflows fire exactly once per changed row (the real
 * enqueue path, jobs counted).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: vi.fn(async () => ({ ok: true })) }))
const kick = vi.hoisted(() => vi.fn())
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: kick }))
// enqueue_workflow_batch runs on the service client: the jobs it receives are counted here.
const jobs = vi.hoisted(() => [] as Array<Record<string, any>>)
vi.mock('@/lib/cron-auth', () => ({
  createServiceClient: () => ({ rpc: async (_name: string, args: any) => { jobs.push(...args.p_jobs); return { data: args.p_jobs.length, error: null } } }),
}))

import type { ServiceContext } from '@/lib/services/context'
import { writeGridCells, writeGridRows } from '@/lib/services/data-table-views'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T = 'tenant-a'
const INVOICES = '0f000000-0000-4000-8000-00000000e001'
const R1 = '0f000000-0000-4000-8000-00000000e101'
const R2 = '0f000000-0000-4000-8000-00000000e102'
const R3 = '0f000000-0000-4000-8000-00000000e103'
const R4 = '0f000000-0000-4000-8000-00000000e104'
const MISSING = '0f000000-0000-4000-8000-00000000e1ff'
const USER = '0f000000-0000-4000-8000-00000000d001'
const STAMP = '2026-11-15T10:00:00.000Z'
const ALL = ['data.view', 'data.edit_schema', 'data.manage_rows']

const VIEW = {
  id: 'v_edit', name: 'Edit', inline_edit: true, allow_add: true, default: true,
  columns: [
    { key: 'id', label: 'ID', control: 'number' },
    { key: 'vendor', label: 'Vendor', control: 'text', required: true },
    { key: 'amount', label: 'Amount', control: 'currency' },
    { key: 'status', label: 'Status', control: 'dropdown', control_options: { choices: ['open', 'paid'] } },
    { key: 'approved_by', label: 'Approved by', control: 'text', editable: false },
  ],
}

function seed(views: unknown[] = [VIEW], workflows: Array<Record<string, any>> = []) {
  const row = (id: string, n: number, vendor: string, amount: number) => ({ id, table_id: INVOICES, tenant_id: T, data: { id: n, vendor, amount, status: 'open', approved_by: 'Ana Admin' }, created_at: `2026-11-0${n}T00:00:00Z`, updated_at: STAMP })
  return createMemorySupabase({
    custom_tables: [{
      id: INVOICES, tenant_id: T, name: 'Invoices', slug: 'invoices', views,
      columns: [
        { key: 'id', name: 'ID', type: 'number' }, { key: 'vendor', name: 'Vendor', type: 'text' }, { key: 'amount', name: 'Amount', type: 'number' },
        { key: 'status', name: 'Status', type: 'select', options: ['open', 'paid'] }, { key: 'approved_by', name: 'Approved by', type: 'text' }, { key: 'date_created', name: 'Date Created', type: 'date' },
      ],
    }],
    custom_table_rows: [row(R1, 1, 'Acme Supplies', 1250), row(R2, 2, 'Apex Office', 480.5), row(R3, 3, 'Blue Harbor', 960), row(R4, 4, 'Cobalt Freight', 75)],
    workflows,
    workflow_versions: [],
    users: [{ id: USER, display_name: 'Ana Admin', email: 'ana@example.com' }],
    user_memberships: [{ user_id: USER, tenant_id: T, is_active: true }],
    teams: [],
    integration_references: [],
  })
}
type Db = ReturnType<typeof seed>
function ctx(db: Db, permissions: string[] = ALL): ServiceContext {
  return { supabase: db as unknown as ServiceContext['supabase'], tenantId: T, actorId: USER, permissions: new Set(permissions), resourceScopes: { workflow_ids: [], table_ids: [] }, authKind: 'api_key', source: 'api' }
}
const data = (db: Db, id: string) => db.tables.custom_table_rows.find((r: any) => r.id === id)!.data

beforeEach(() => { jobs.length = 0; kick.mockClear(); invalidateDataTableTriggerCache() })

describe('writeGridRows: partial failures', () => {
  it('saves the good rows, refuses the bad ones per cell, reports conflicts and unknown rows — nothing rolled back', async () => {
    const db = seed()
    const res = await writeGridRows(ctx(db), INVOICES, {
      view_id: 'v_edit',
      rows: [
        { row_id: R1, cells: { amount: 1300, status: 'paid' }, expected_updated_at: STAMP },
        { row_id: R2, cells: { vendor: '' }, expected_updated_at: STAMP },
        { row_id: R3, cells: { amount: 999 }, expected_updated_at: '2026-11-14T00:00:00.000Z' },
        { row_id: R4, cells: { amount: 75 }, expected_updated_at: STAMP },
        { row_id: MISSING, cells: { amount: 1 } },
      ],
    })
    const by = Object.fromEntries(res.rows.map((r) => [r.row_id, r]))
    expect(by[R1]).toMatchObject({ status: 'saved', changed: ['amount', 'status'] })
    expect(by[R2]).toMatchObject({ status: 'invalid', cells: { vendor: 'Vendor is required' } })
    expect(by[R3]).toMatchObject({ status: 'conflict', current: expect.objectContaining({ id: R3 }) })
    expect((by[R3] as any).error).toMatch(/changed this row after you opened it/)
    expect(by[R4]).toMatchObject({ status: 'unchanged', changed: [] })
    expect(by[MISSING]).toMatchObject({ status: 'not_found' })
    expect(res.saved).toBe(1)
    expect(res.failed).toBe(3)
    expect(data(db, R1)).toMatchObject({ amount: 1300, status: 'paid' })
    expect(data(db, R2).vendor).toBe('Apex Office')
    expect(data(db, R3).amount).toBe(960)
  })

  it('a retry of only the failed rows saves them (saved rows are not re-sent)', async () => {
    const db = seed()
    const first = await writeGridRows(ctx(db), INVOICES, { view_id: 'v_edit', rows: [{ row_id: R1, cells: { amount: 10 }, expected_updated_at: STAMP }, { row_id: R2, cells: { status: 'void' }, expected_updated_at: STAMP }] })
    expect(first.rows.map((r) => r.status)).toEqual(['saved', 'invalid'])
    const retry = await writeGridRows(ctx(db), INVOICES, { view_id: 'v_edit', rows: [{ row_id: R2, cells: { status: 'paid' }, expected_updated_at: STAMP }] })
    expect(retry.rows).toEqual([expect.objectContaining({ row_id: R2, status: 'saved' })])
  })
})

describe('writeGridRows: the view is enforced per row', () => {
  it('refuses read-only, system and unknown columns even when a client sends them', async () => {
    const db = seed()
    const res = await writeGridRows(ctx(db), INVOICES, {
      view_id: 'v_edit',
      rows: [
        { row_id: R1, cells: { approved_by: 'Mallory' } },
        { row_id: R2, cells: { id: 99 } },
        { row_id: R3, cells: { ghost: 'x' } },
        { row_id: R4, cells: { amount: 80, approved_by: 'Mallory' } },
      ],
    })
    expect(res.rows.map((r) => r.status)).toEqual(['invalid', 'invalid', 'invalid', 'invalid'])
    expect((res.rows[0] as any).cells).toEqual({ approved_by: 'Approved by is read-only' })
    expect((res.rows[1] as any).cells).toEqual({ id: 'ID is read-only' })
    expect((res.rows[2] as any).cells.ghost).toMatch(/not a column of this view/)
    // A row with one refused cell writes none of its cells.
    expect(data(db, R4)).toMatchObject({ amount: 75, approved_by: 'Ana Admin' })
    expect(data(db, R1).approved_by).toBe('Ana Admin')
  })

  it('needs data.manage_rows and a view with inline editing; validates the request', async () => {
    const db = seed([{ ...VIEW, inline_edit: false }])
    await expect(writeGridRows(ctx(db, ['data.view']), INVOICES, { view_id: 'v_edit', rows: [{ row_id: R1, cells: { amount: 1 } }] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(writeGridRows(ctx(db), INVOICES, { view_id: 'v_edit', rows: [{ row_id: R1, cells: { amount: 1 } }] })).rejects.toThrow(/turned off/)
    const db2 = seed()
    await expect(writeGridRows(ctx(db2), INVOICES, { view_id: 'v_edit' })).rejects.toThrow('No rows to save')
    await expect(writeGridRows(ctx(db2), INVOICES, { view_id: 'v_edit', rows: [{ row_id: R1, cells: {} }, { row_id: R1, cells: {} }] })).rejects.toThrow(/more than once/)
    await expect(writeGridRows(ctx(db2), INVOICES, { view_id: 'v_edit', rows: Array.from({ length: 501 }, (_, i) => ({ row_id: `r${i}`, cells: {} })) })).rejects.toThrow(/At most 500/)
    await expect(writeGridRows(ctx(db2), INVOICES, { view_id: 'nope', rows: [{ row_id: R1, cells: { amount: 1 } }] })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('writeGridRows: new rows', () => {
  it('inserts rows with the system cells, refuses ones missing a required column, echoes client ids', async () => {
    const db = seed()
    const res = await writeGridRows(ctx(db), INVOICES, {
      view_id: 'v_edit',
      inserts: [{ client_id: 'new:1', cells: { vendor: 'Delta Paper', amount: 312.25 } }, { client_id: 'new:2', cells: { amount: 5 } }],
    })
    expect(res.inserts[0]).toMatchObject({ client_id: 'new:1', status: 'saved' })
    expect(res.inserts[1]).toMatchObject({ client_id: 'new:2', status: 'invalid', cells: { vendor: 'Vendor is required' } })
    const added = db.tables.custom_table_rows.find((r: any) => r.data.vendor === 'Delta Paper')!
    expect(added.data).toMatchObject({ id: 5, amount: 312.25 })
    expect(added.data.date_created).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('needs the view\'s Add rows', async () => {
    const db = seed([{ ...VIEW, allow_add: false }])
    const res = await writeGridRows(ctx(db), INVOICES, { view_id: 'v_edit', inserts: [{ client_id: 'a', cells: { vendor: 'X' } }] })
    expect(res.inserts[0]).toMatchObject({ status: 'forbidden', error: 'This view does not allow adding rows' })
    expect(db.tables.custom_table_rows).toHaveLength(4)
  })
})

describe('workflows: data_table_event fires once per changed row', () => {
  const trigger = [{ id: 't', type: 'data_table_event', config: { table_id: INVOICES } }]
  const wf = { id: 'wf-invoices', tenant_id: T, is_active: true, trigger_type: 'data_table_event', nodes: trigger, published_version_id: null }

  it('a batch queues one "updated" job per changed row, one "created" per new row — unchanged, refused and conflicting rows fire nothing', async () => {
    const db = seed([VIEW], [wf])
    await writeGridRows(ctx(db), INVOICES, {
      view_id: 'v_edit',
      rows: [
        { row_id: R1, cells: { amount: 1300 }, expected_updated_at: STAMP },
        { row_id: R2, cells: { status: 'paid', amount: 500 }, expected_updated_at: STAMP },
        { row_id: R3, cells: { amount: 960 }, expected_updated_at: STAMP },
        { row_id: R4, cells: { vendor: '' }, expected_updated_at: STAMP },
      ],
      inserts: [{ client_id: 'new:1', cells: { vendor: 'Delta Paper' } }],
    })
    const updated = jobs.filter((j) => j.trigger_data.data_event === 'updated').map((j) => j.trigger_data.row_id)
    const created = jobs.filter((j) => j.trigger_data.data_event === 'created')
    expect(updated.sort()).toEqual([R1, R2].sort())
    expect(created).toHaveLength(1)
    expect(jobs).toHaveLength(3)
    expect(kick).toHaveBeenCalledTimes(1)
    // The job carries the saved row.
    expect(jobs.find((j) => j.trigger_data.row_id === R2)!.trigger_data.row).toMatchObject({ status: 'paid', amount: 500 })
  })

  it('the same edits one row at a time fire the same jobs (a batch neither double-fires nor skips)', async () => {
    const db = seed([VIEW], [wf])
    await writeGridCells(ctx(db), INVOICES, R1, { view_id: 'v_edit', cells: { amount: 1300 } })
    await writeGridCells(ctx(db), INVOICES, R2, { view_id: 'v_edit', cells: { status: 'paid', amount: 500 } })
    await writeGridCells(ctx(db), INVOICES, R3, { view_id: 'v_edit', cells: { amount: 960 } })
    expect(jobs.map((j) => j.trigger_data.row_id).sort()).toEqual([R1, R2].sort())
  })
})
