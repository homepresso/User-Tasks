/**
 * lib/services/data-import against an in-memory database: insert (ID
 * numbering, Date Created), upsert on a key column, replace (typed
 * confirmation, audited), validation gate / skip_invalid, dry runs,
 * workflow triggers on / off, permissions and tenant / table scoping,
 * limits, resumable batches and gzip uploads.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gzipSync } from 'node:zlib'

const spy = vi.hoisted(() => ({ events: [] as any[], audits: [] as any[], queued: [] as any[], columnUpdates: [] as any[] }))

vi.mock('@/lib/data-table-workflow-triggers', async (orig) => ({
  ...(await orig<any>()),
  enqueueDataTableEvents: vi.fn(async (p: any) => { spy.events.push(...p.events); return p.events.length }),
}))
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig<any>()),
  audit: vi.fn(async (_ctx: any, entry: any) => { spy.audits.push(entry) }),
  queueDeletions: vi.fn(async (_ctx: any, type: string, items: any[]) => { spy.queued.push(...items.map((i) => ({ type, ...i }))) }),
}))
vi.mock('@/lib/services/data-tables', async (orig) => ({
  ...(await orig<any>()),
  updateDataTable: vi.fn(async (ctx: any, tableId: string, input: any) => {
    spy.columnUpdates.push(input)
    const { data: table } = await ctx.supabase.from('custom_tables').select('*').eq('id', tableId).maybeSingle()
    const system = (table.columns ?? []).filter((c: any) => c.key === 'id' || c.key === 'date_created')
    await ctx.supabase.from('custom_tables').update({ columns: [...system, ...input.columns] }).eq('id', tableId)
    return table
  }),
}))

import { importRowsNow, planImport, runImport, unpackUpload, type DataImportOptions } from '@/lib/services/data-import'
import { DATA_IMPORT_LIMITS } from '@/lib/data-import/parse'
import type { ServiceContext } from '@/lib/services/context'
import { createImportFakeDb, type ImportFakeDb } from './helpers/data-import-fake-db'

/* eslint-disable @typescript-eslint/no-explicit-any */

const TABLE = '20000000-0000-4000-8000-000000000001'
const OTHER_TENANT_TABLE = '20000000-0000-4000-8000-000000000002'
const COLUMNS = [
  { id: 'c1', key: 'id', name: 'ID', type: 'number' },
  { id: 'c2', key: 'date_created', name: 'Date Created', type: 'date' },
  { id: 'c3', key: 'order_no', name: 'Order No', type: 'text', required: true },
  { id: 'c4', key: 'amount', name: 'Amount', type: 'number' },
  { id: 'c5', key: 'status', name: 'Status', type: 'select', options: ['Open', 'Paid'] },
  { id: 'c6', key: 'note', name: 'Note', type: 'text' },
]

let db: ImportFakeDb
const enc = (s: string) => new TextEncoder().encode(s)
const ctx = (perms = ['data.manage_rows', 'data.edit_schema'], extra: Partial<ServiceContext> = {}): ServiceContext => ({
  supabase: db.client, tenantId: 't1', actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui', ...extra,
})
const rowsOf = () => (db.tables.custom_table_rows ?? []).filter((r) => r.table_id === TABLE)
const opts = (o: Partial<DataImportOptions> = {}): DataImportOptions => ({ file_name: 'orders.csv', ...o })

const CSV = 'Order No,Amount,Status\nINV-1,"$1,200.00",Open\nINV-2,$35.50,paid\n'

beforeEach(() => {
  spy.events = []; spy.audits = []; spy.queued = []; spy.columnUpdates = []
  db = createImportFakeDb({
    custom_tables: [
      { id: TABLE, tenant_id: 't1', name: 'Orders', columns: COLUMNS },
      { id: OTHER_TENANT_TABLE, tenant_id: 't2', name: 'Theirs', columns: COLUMNS },
    ],
    custom_table_rows: [
      { table_id: TABLE, tenant_id: 't1', data: { id: 7, order_no: 'INV-1', amount: 1, status: 'Open', note: 'keep me' } },
    ],
  })
})

describe('insert', () => {
  it('adds every row, numbers IDs after the newest row, stamps Date Created, converts values', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc(CSV), opts())
    expect(r.imported).toBe(true)
    expect(r.counts).toMatchObject({ rows: 2, valid: 2, invalid: 0, inserted: 2, updated: 0, skipped: 0, failed: 0 })
    const added = rowsOf().slice(1).map((row) => row.data)
    expect(added).toEqual([
      expect.objectContaining({ id: 8, order_no: 'INV-1', amount: 1200, status: 'Open', date_created: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }),
      expect.objectContaining({ id: 9, order_no: 'INV-2', amount: 35.5, status: 'Paid' }),
    ])
    expect(rowsOf()[1]).toMatchObject({ tenant_id: 't1', created_by: 'u1' })
    // One insert call for the batch; audited start + finish.
    expect(db.ops.filter((o) => o.op === 'insert')).toEqual([{ table: 'custom_table_rows', op: 'insert', size: 2 }])
    expect(spy.audits.map((a) => a.action)).toEqual(['import_started', 'import'])
  })

  it('a batch that fails is retried row by row: the bad row fails, the rest are saved', async () => {
    db.failInsertWhen = (row) => row.data?.order_no === 'INV-2'
    const r = await importRowsNow(ctx(), TABLE, enc(CSV), opts())
    expect(r.counts).toMatchObject({ inserted: 1, failed: 1 })
    expect(r.errors[0]).toMatchObject({ row: 3, reason: expect.stringMatching(/Could not be saved/) })
  })
})

describe('upsert', () => {
  it('updates rows whose key matches (other cells kept), inserts the rest', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'upsert', key_column: 'Order No' }))
    expect(r.counts).toMatchObject({ inserted: 1, updated: 1 })
    expect(r.key_column).toBe('order_no')
    const [first, second] = rowsOf()
    expect(first.data).toEqual({ id: 7, order_no: 'INV-1', amount: 1200, status: 'Open', note: 'keep me' })
    expect(first.updated_by).toBe('u1')
    expect(second.data).toMatchObject({ order_no: 'INV-2', id: 8 })
  })

  it('needs a mapped key column; repeated keys in the file are row errors', async () => {
    await expect(importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'upsert' }))).rejects.toThrow(/key_column/)
    await expect(importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'upsert', key_column: 'note' }))).rejects.toThrow(/must be mapped/)
    const dup = await importRowsNow(ctx(), TABLE, enc('Order No,Amount\nINV-9,1\ninv-9,2\n'), opts({ mode: 'upsert', key_column: 'order_no', dry_run: true }))
    expect(dup.errors[0]).toMatchObject({ row: 3, reason: expect.stringMatching(/Duplicate key/) })
  })
})

describe('replace', () => {
  it('needs the table name typed as confirmation', async () => {
    await expect(importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'replace' }))).rejects.toThrow(/confirm_replace/)
    await expect(importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'replace', confirm_replace: 'Order' }))).rejects.toThrow(/confirm_replace/)
    expect(rowsOf()).toHaveLength(1)
  })

  it('deletes the existing rows (queued for files / deleted workflows), audits, then inserts; IDs restart', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'replace', confirm_replace: ' orders ' }))
    expect(r.counts).toMatchObject({ deleted: 1, inserted: 2 })
    expect(rowsOf().map((row) => row.data.order_no)).toEqual(['INV-1', 'INV-2'])
    expect(rowsOf().map((row) => row.data.id)).toEqual([1, 2])
    expect(spy.queued).toEqual([expect.objectContaining({ type: 'data_row', payload: expect.objectContaining({ table_id: TABLE }) })])
    expect(spy.audits.find((a) => a.action === 'replace_rows')).toMatchObject({ metadata: expect.objectContaining({ deleted: 1 }) })
  })

  it('without triggers, only rows holding stored files are queued', async () => {
    db.tables.custom_table_rows.push({ id: 'f1', created_at: '2025-01-01', table_id: TABLE, tenant_id: 't1', data: { order_no: 'F', file: { path: 'p/x.pdf', url: 'u' } } })
    await importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'replace', confirm_replace: 'Orders', fire_triggers: false }))
    expect(spy.queued.map((q) => q.id)).toEqual(['f1'])
    expect(spy.events).toEqual([])
  })
})

describe('validation gate', () => {
  const BAD = 'Order No,Amount,Status\nINV-1,10,Open\nINV-2,ten,Open\n,5,Lost\n'

  it('with errors nothing is written, and the error lists rows', async () => {
    const err: any = await importRowsNow(ctx(), TABLE, enc(BAD), opts()).catch((e) => e)
    expect(err.message).toMatch(/2 of 3 rows have errors; nothing was imported/)
    expect(err.details.errors.map((e: any) => e.row)).toEqual([3, 4, 4])
    expect(rowsOf()).toHaveLength(1)
  })

  it('skip_invalid imports the valid rows and counts the rest as skipped', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc(BAD), opts({ skip_invalid: true }))
    expect(r.counts).toMatchObject({ inserted: 1, skipped: 2, invalid: 2 })
    expect(r.errors).toHaveLength(3)
  })

  it('dry_run writes nothing and reports mapping, counts, preview', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc(BAD), opts({ dry_run: true }))
    expect(r).toMatchObject({ dry_run: true, imported: false, mapping: { 'Order No': 'order_no', Amount: 'amount', Status: 'status' } })
    expect(r.counts).toMatchObject({ valid: 1, invalid: 2, inserted: 0 })
    expect(r.preview).toEqual([{ order_no: 'INV-1', amount: 10, status: 'Open' }])
    expect(db.ops.filter((o) => o.op !== 'select')).toEqual([])
    expect(spy.audits).toEqual([])
  })

  it('no mapped column at all is refused', async () => {
    await expect(planImport(ctx(), TABLE, enc('Foo,Bar\n1,2'), opts())).rejects.toThrow(/No file column is mapped/)
  })
})

describe('workflow triggers', () => {
  it('on by default: created and updated events are queued', async () => {
    await importRowsNow(ctx(), TABLE, enc(CSV), opts({ mode: 'upsert', key_column: 'order_no' }))
    expect(spy.events.map((e) => e.eventType).sort()).toEqual(['created', 'updated'])
  })

  it('fire_triggers: false writes silently', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc(CSV), opts({ fire_triggers: false }))
    expect(r.fire_triggers).toBe(false)
    expect(spy.events).toEqual([])
  })
})

describe('new columns', () => {
  it('adds columns first (data.edit_schema) and fills them', async () => {
    const r = await importRowsNow(ctx(), TABLE, enc('Order No,Region\nINV-5,West\n'), opts({ new_columns: [{ header: 'Region', type: 'select', options: ['West', 'East'] }] }))
    expect(r.columns_created).toEqual(['region'])
    expect(spy.columnUpdates[0].columns.at(-1)).toMatchObject({ key: 'region', name: 'Region', type: 'select', options: ['West', 'East'] })
    expect(rowsOf().at(-1)!.data).toMatchObject({ order_no: 'INV-5', region: 'West' })
  })
})

describe('permissions and scoping', () => {
  it('needs data.manage_rows (dry runs too)', async () => {
    await expect(importRowsNow(ctx(['data.view']), TABLE, enc(CSV), opts({ dry_run: true }))).rejects.toMatchObject({ status: 403 })
  })
  it('new_columns needs data.edit_schema', async () => {
    await expect(importRowsNow(ctx(['data.manage_rows']), TABLE, enc(CSV), opts({ new_columns: [{ header: 'Status' }] }))).rejects.toThrow(/data\.edit_schema/)
  })
  it('a credential scoped to other tables is refused', async () => {
    await expect(importRowsNow(ctx(undefined, { resourceScopes: { workflow_ids: [], table_ids: ['someone-else'] } }), TABLE, enc(CSV), opts())).rejects.toMatchObject({ status: 403 })
  })
  it("another workspace's table is not found, and nothing is written there", async () => {
    await expect(importRowsNow(ctx(), OTHER_TENANT_TABLE, enc(CSV), opts())).rejects.toMatchObject({ status: 404 })
    expect((db.tables.custom_table_rows ?? []).filter((r) => r.table_id === OTHER_TENANT_TABLE)).toEqual([])
  })
})

describe('limits and background batches', () => {
  const big = (n: number) => 'Order No,Amount\n' + Array.from({ length: n }, (_, i) => `INV-${i},${i}.50`).join('\n')

  it(`inline calls refuse more than ${DATA_IMPORT_LIMITS.syncRows} rows (async needed)`, async () => {
    await expect(importRowsNow(ctx(), TABLE, enc(big(DATA_IMPORT_LIMITS.syncRows + 1)), opts())).rejects.toThrow(/async=true/)
    expect(rowsOf()).toHaveLength(1)
  })

  it('hands back when time runs low and resumes from the state to the same totals', async () => {
    const bytes = enc(big(1_200))
    let calls = 0
    // Enough time for one batch per invocation.
    const timeLeft = () => (calls++ % 2 === 0 ? 60_000 : 1_000)
    let step = await runImport(ctx(), TABLE, bytes, opts(), null, { timeLeft })
    let invocations = 1
    while (!step.done) {
      expect(step.state.offset % DATA_IMPORT_LIMITS.batchSize).toBe(0)
      expect(step.progress).toBeGreaterThan(0)
      step = await runImport(ctx(), TABLE, bytes, opts(), step.state, { timeLeft })
      invocations++
    }
    expect(invocations).toBe(3)
    expect(step.report.counts).toMatchObject({ inserted: 1_200, failed: 0 })
    expect(rowsOf()).toHaveLength(1_201)
    const ids = rowsOf().slice(1).map((r) => r.data.id)
    expect(new Set(ids).size).toBe(1_200)
    expect(spy.audits.filter((a) => a.action === 'import_started')).toHaveLength(1)
  })

  it('gzip uploads are unpacked (the wizard compresses CSV)', async () => {
    expect(new TextDecoder().decode(unpackUpload(gzipSync(Buffer.from(CSV))))).toBe(CSV)
    const r = await importRowsNow(ctx(), TABLE, new Uint8Array(gzipSync(Buffer.from(CSV))), opts())
    expect(r.counts.inserted).toBe(2)
    expect(() => unpackUpload(new Uint8Array(gzipSync(Buffer.alloc(DATA_IMPORT_LIMITS.maxBytes + 10, 0x41))))).toThrow(/larger than 10 MB/)
  })

  it('unsupported files get a clear message', async () => {
    await expect(planImport(ctx(), TABLE, enc('x'), opts({ file_name: 'old.xls' }))).rejects.toThrow(/Only \.csv, \.tsv and \.xlsx/)
  })
})
