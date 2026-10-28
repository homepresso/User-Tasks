import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
}))
vi.mock('@/lib/data-table-workflow-triggers', () => ({ enqueueDataTableEvents: vi.fn(async () => 0) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { enqueueDeletionJob } from '@/lib/deletion-queue'
import { enqueueDataTableEvents } from '@/lib/data-table-workflow-triggers'

/** One entry per row event queued, with the call's tenant/table. */
const firedEvents = () => vi.mocked(enqueueDataTableEvents).mock.calls.flatMap(([p]) =>
  p.events.map((event) => ({ tenantId: p.tenantId, tableId: p.tableId, ...event })))
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import * as data from '@/lib/services/data-tables'
import { GET as listTablesRoute, POST as createTableRoute } from '@/app/api/v1/data-tables/route'
import { PATCH as patchTableRoute } from '@/app/api/v1/data-tables/[id]/route'
import { GET as listRowsRoute, POST as upsertRowsRoute } from '@/app/api/v1/data-tables/[id]/rows/route'
import { DELETE as deleteRowRoute, PATCH as patchRowRoute } from '@/app/api/v1/data-tables/[id]/rows/[rowId]/route'
import { POST as bulkDeleteRoute } from '@/app/api/v1/data-tables/[id]/rows/bulk-delete/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const ALL = ['data.view', 'data.create', 'data.edit_schema', 'data.manage_rows', 'data.delete']
const COLUMNS = [
  { id: 'c-id', key: 'id', name: 'ID', type: 'number' },
  { id: 'c-dc', key: 'date_created', name: 'Date Created', type: 'date' },
  { id: 'c-name', key: 'order_no', name: 'Order No', type: 'text' },
  { id: 'c-status', key: 'status', name: 'Status', type: 'select', options: ['open', 'closed'] },
  { id: 'c-amount', key: 'amount', name: 'Amount', type: 'number' },
]

function seed() {
  return createMemorySupabase({
    custom_tables: [
      { id: 'tbl-a', tenant_id: 'tenant-a', name: 'Orders', slug: 'orders', description: null, columns: COLUMNS },
      { id: 'tbl-a2', tenant_id: 'tenant-a', name: 'Other', slug: 'other', description: null, columns: COLUMNS.slice(0, 2) },
      { id: 'tbl-b', tenant_id: 'tenant-b', name: 'Foreign', slug: 'foreign', description: null, columns: COLUMNS },
    ],
    custom_table_rows: [
      { id: 'row-1', table_id: 'tbl-a', tenant_id: 'tenant-a', data: { id: 1, 'Order No': 'A-1', status: 'open', amount: 5 }, created_at: '2026-01-01' },
      { id: 'row-2', table_id: 'tbl-a', tenant_id: 'tenant-a', data: { id: 2, order_no: 'A-2', status: 'closed', amount: 50 }, created_at: '2026-01-02' },
      { id: 'row-b', table_id: 'tbl-b', tenant_id: 'tenant-b', data: { id: 1, order_no: 'B-1' }, created_at: '2026-01-01' },
    ],
  })
}
type Db = ReturnType<typeof seed>

function ctx(db: Db, permissions: string[] = ALL, tableIds: string[] = []): ServiceContext {
  return {
    supabase: db as unknown as ServiceContext['supabase'], tenantId: 'tenant-a', actorId: null,
    permissions: new Set(permissions), resourceScopes: { workflow_ids: [], table_ids: tableIds }, authKind: 'api_key', source: 'api',
  }
}
const page = { limit: 50, offset: 0 }
const rowsOf = (db: Db, tableId: string) => (db.tables.custom_table_rows ?? []).filter((r) => r.table_id === tableId)

beforeEach(() => {
  vi.mocked(enqueueDataTableEvents).mockClear()
  vi.mocked(enqueueDeletionJob).mockClear()
  vi.mocked(recordAssetChange).mockClear()
})

describe('data tables service: access', () => {
  it.each([
    ['listDataTables', (c: ServiceContext) => data.listDataTables(c, {}, page)],
    ['createDataTable', (c: ServiceContext) => data.createDataTable(c, { name: 'X' })],
    ['updateDataTable', (c: ServiceContext) => data.updateDataTable(c, 'tbl-a', { name: 'X' })],
    ['deleteDataTable', (c: ServiceContext) => data.deleteDataTable(c, 'tbl-a')],
    ['queryRows', (c: ServiceContext) => data.queryRows(c, 'tbl-a', {}, page)],
    ['upsertRows', (c: ServiceContext) => data.upsertRows(c, 'tbl-a', [{ data: { status: 'open' } }])],
    ['deleteRows', (c: ServiceContext) => data.deleteRows(c, 'tbl-a', ['row-1'])],
  ])('%s throws 403 without its permission and writes nothing', async (_name, call) => {
    const db = seed()
    await expect(call(ctx(db, []))).rejects.toMatchObject({ status: 403 })
    expect(db.calls).toEqual([])
  })

  it('row writes need data.manage_rows, not just data.view', async () => {
    await expect(data.upsertRows(ctx(seed(), ['data.view']), 'tbl-a', [{ data: {} }])).rejects.toMatchObject({ status: 403 })
  })

  it('treats other tenants’ tables and rows as not found', async () => {
    const db = seed()
    await expect(data.getDataTable(ctx(db), 'tbl-b')).rejects.toMatchObject({ status: 404 })
    await expect(data.upsertRows(ctx(db), 'tbl-b', [{ data: { status: 'x' } }])).rejects.toMatchObject({ status: 404 })
    await expect(data.updateRow(ctx(db), 'tbl-a', 'row-b', { status: 'pwn' })).rejects.toMatchObject({ status: 404 })
    expect((await data.deleteRows(ctx(db), 'tbl-a', ['row-b', 'row-1'])).ids).toEqual(['row-1'])
    expect(db.tables.custom_table_rows.find((r) => r.id === 'row-b')!.data.order_no).toBe('B-1')
  })

  it('table-scoped credentials only reach their tables and cannot create tables', async () => {
    const db = seed()
    const scoped = ctx(db, ALL, ['tbl-a'])
    expect((await data.listDataTables(scoped, {}, page)).data_tables.map((t) => t.id)).toEqual(['tbl-a'])
    await expect(data.getDataTable(scoped, 'tbl-a2')).rejects.toMatchObject({ status: 403 })
    await expect(data.upsertRows(scoped, 'tbl-a2', [{ data: {} }])).rejects.toMatchObject({ status: 403 })
    await expect(data.createDataTable(scoped, { name: 'New' })).rejects.toMatchObject({ status: 403 })
    expect((await data.queryRows(scoped, 'tbl-a', {}, page)).rows).toHaveLength(2)
  })
})

describe('data tables service: schema', () => {
  it('creates with system columns, keeps column identity on schema edits and syncs', async () => {
    const db = seed()
    const table = await data.createDataTable(ctx(db), { name: 'Tickets', columns: [{ name: 'Subject Line', type: 'text' }] })
    expect(table.columns.map((c: any) => c.key)).toEqual(['id', 'date_created', 'subject_line'])
    expect(table.slug).toBe('tickets')
    const subjectId = table.columns[2].id
    const updated = await data.updateDataTable(ctx(db), table.id, { columns: [{ key: 'subject_line', name: 'Subject', type: 'text' }, { name: 'Priority', type: 'select', options: ['p1'] }] })
    expect(updated.columns.map((c: any) => [c.key, c.name])).toEqual([['id', 'ID'], ['date_created', 'Date Created'], ['subject_line', 'Subject'], ['priority', 'Priority']])
    expect(updated.columns[2].id).toBe(subjectId)
    await expect(data.updateDataTable(ctx(db), table.id, { columns: [{ name: 'A', key: 'a', type: 'text' }, { name: 'B', key: 'a', type: 'text' }] })).rejects.toMatchObject({ status: 400 })
    // System columns sent back from a GET are ignored (kept as stored), so the fetched schema round-trips.
    const again = await data.updateDataTable(ctx(db), table.id, { columns: [{ name: 'ID', key: 'id', type: 'number' }, ...updated.columns.slice(2)] })
    expect(again.columns).toEqual(updated.columns)
    expect(vi.mocked(recordAssetChange).mock.calls.map(([p]) => `${p.assetType}:${p.action}`)).toEqual(['data_table:save', 'data_table:save', 'data_table:save'])
  })

  it('deletes through the deletion queue', async () => {
    const db = seed()
    await data.deleteDataTable(ctx(db), 'tbl-a')
    expect(enqueueDeletionJob).toHaveBeenCalledWith(db, expect.objectContaining({ tenantId: 'tenant-a', targetType: 'data_table', targetId: 'tbl-a' }))
    expect(db.tables.custom_tables.some((t) => t.id === 'tbl-a')).toBe(true) // the queue does the hard delete
  })
})

describe('data tables service: rows', () => {
  it('inserts with canonical keys, auto-numbers ID, stamps Date Created and fires "created" workflows', async () => {
    const db = seed()
    const [result] = await data.upsertRows(ctx(db), 'tbl-a', [{ data: { 'Order No': 'A-3', Status: 'open' } }])
    expect(result.action).toBe('created')
    const stored = rowsOf(db, 'tbl-a').find((r) => r.id === result.row_id)!
    expect(stored.data).toMatchObject({ order_no: 'A-3', status: 'open', id: 3 })
    expect(stored.data.date_created).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(stored.data['Order No']).toBeUndefined()
    expect(firedEvents()).toEqual([expect.objectContaining({ tenantId: 'tenant-a', tableId: 'tbl-a', rowId: result.row_id, eventType: 'created', rowData: stored.data })])
  })

  it('rejects unknown columns before writing anything (bulk is all-or-nothing)', async () => {
    const db = seed()
    const before = db.calls.length
    await expect(data.upsertRows(ctx(db), 'tbl-a', [{ data: { status: 'open' } }, { data: { bogus: 1 } }]))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('rows[1]: Unknown column(s) for this table: bogus') })
    expect(db.calls.slice(before).filter((c) => c.op !== 'select')).toEqual([])
    expect(enqueueDataTableEvents).not.toHaveBeenCalled()
  })

  it('bulk upsert replaces by row_id (keeping system cells) and inserts the rest', async () => {
    const db = seed()
    const results = await data.upsertRows(ctx(db), 'tbl-a', [
      { row_id: 'row-1', data: { order_no: 'A-1b', status: 'closed' } },
      { data: { order_no: 'A-4' } },
      { data: { order_no: 'A-5' } },
    ])
    expect(results.map((r) => r.action)).toEqual(['updated', 'created', 'created'])
    expect(rowsOf(db, 'tbl-a').find((r) => r.id === 'row-1')!.data).toEqual({ order_no: 'A-1b', status: 'closed', id: 1 })
    expect(rowsOf(db, 'tbl-a').filter((r) => ['A-4', 'A-5'].includes(r.data.order_no)).map((r) => r.data.id)).toEqual([3, 4])
    expect(firedEvents().map((e) => e.eventType)).toEqual(['updated', 'created', 'created'])
    expect(enqueueDataTableEvents).toHaveBeenCalledTimes(1) // one batch per write
    await expect(data.upsertRows(ctx(db), 'tbl-a', [{ row_id: 'row-b', data: {} }])).rejects.toMatchObject({ status: 404 })
  })

  it('PATCH merges cells, converging legacy name-keyed cells, and fires "updated"', async () => {
    const db = seed()
    const row = await data.updateRow(ctx(db), 'tbl-a', 'row-1', { amount: 7 })
    expect(row.data).toEqual({ id: 1, order_no: 'A-1', status: 'open', amount: 7 })
    expect(firedEvents()).toContainEqual(expect.objectContaining({ rowId: 'row-1', eventType: 'updated' }))
  })

  it('deletes rows through the deletion queue (which fires "deleted" workflows)', async () => {
    const db = seed()
    await data.deleteRow(ctx(db), 'tbl-a', 'row-2')
    expect(enqueueDeletionJob).toHaveBeenCalledWith(db, expect.objectContaining({ targetType: 'data_row', targetId: 'row-2', payload: { table_id: 'tbl-a', row_data: expect.objectContaining({ order_no: 'A-2' }) } }))
    await expect(data.deleteRow(ctx(db), 'tbl-a', 'nope')).rejects.toMatchObject({ status: 404 })
  })

  it('queries with search, filters and cell order', async () => {
    const db = seed()
    expect((await data.queryRows(ctx(db), 'tbl-a', {}, page)).total).toBe(2)
    const filtered = await data.queryRows(ctx(db), 'tbl-a', { filters: [{ field: 'amount', operator: 'gt', value: 10 }] }, page)
    expect(filtered.rows.map((r) => r.id)).toEqual(['row-2'])
    expect((await data.queryRows(ctx(db), 'tbl-a', { search: 'a-1' }, page)).rows.map((r) => r.id)).toEqual(['row-1'])
    const ordered = await data.queryRows(ctx(db), 'tbl-a', data.parseRowOrder('-amount'), page)
    expect(ordered.rows.map((r) => r.id)).toEqual(['row-2', 'row-1'])
    expect(data.parseRowOrder('amount.asc')).toEqual({ sort_field: 'amount', sort_direction: 'asc' })
  })
})

describe('/api/v1/data-tables routes', () => {
  const mockedValidate = vi.mocked(validateApiKey)
  function authAs(db: Db, permissions = ALL, tableIds: string[] = []) {
    mockedValidate.mockResolvedValue({
      success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: [], table_ids: tableIds }, permissions,
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    })
  }
  const req = (path: string, init?: { method?: string; body?: unknown }) => new NextRequest(`https://app.test/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

  it('lists and creates tables (403 without data.create)', async () => {
    const db = seed()
    authAs(db)
    const list = await (await listTablesRoute(req('/data-tables'))).json()
    expect(list.data.data_tables.map((t: any) => t.id).sort()).toEqual(['tbl-a', 'tbl-a2'])
    authAs(db, ['data.view'])
    expect((await createTableRoute(req('/data-tables', { method: 'POST', body: { name: 'X' } }))).status).toBe(403)
    authAs(db)
    const created = await createTableRoute(req('/data-tables', { method: 'POST', body: { name: 'X', columns: [{ name: 'A', type: 'text' }] } }))
    expect(created.status).toBe(201)
    const bad = await createTableRoute(req('/data-tables', { method: 'POST', body: { name: 'X', columns: [{ name: 'A', type: 'nope' }] } }))
    expect(bad.status).toBe(400)
  })

  it('patches the schema', async () => {
    const db = seed()
    authAs(db)
    const res = await patchTableRoute(req('/data-tables/tbl-a2', { method: 'PATCH', body: { name: 'Renamed' } }), params({ id: 'tbl-a2' }))
    expect((await res.json()).data.data_table).toMatchObject({ name: 'Renamed', slug: 'renamed' })
  })

  it('upserts single and bulk rows, lists with filters, patches and deletes', async () => {
    const db = seed()
    authAs(db)
    const single = await (await upsertRowsRoute(req('/data-tables/tbl-a/rows', { method: 'POST', body: { data: { order_no: 'S-1' } } }), params({ id: 'tbl-a' }))).json()
    expect(single.data).toMatchObject({ created: 1, updated: 0 })
    const bulk = await (await upsertRowsRoute(req('/data-tables/tbl-a/rows', { method: 'POST', body: { rows: [{ row_id: 'row-2', data: { status: 'open' } }, { data: { order_no: 'S-2' } }] } }), params({ id: 'tbl-a' }))).json()
    expect(bulk.data).toMatchObject({ created: 1, updated: 1 })
    const neither = await upsertRowsRoute(req('/data-tables/tbl-a/rows', { method: 'POST', body: {} }), params({ id: 'tbl-a' }))
    expect(neither.status).toBe(400)

    const filters = encodeURIComponent(JSON.stringify([{ field: 'status', operator: 'equals', value: 'open' }]))
    const listed = await (await listRowsRoute(req(`/data-tables/tbl-a/rows?filters=${filters}&order=-amount`), params({ id: 'tbl-a' }))).json()
    expect(listed.data.rows.map((r: any) => r.id)).toContain('row-2')
    expect((await listRowsRoute(req('/data-tables/tbl-a/rows?filters=nope'), params({ id: 'tbl-a' }))).status).toBe(400)

    const patched = await (await patchRowRoute(req('/data-tables/tbl-a/rows/row-1', { method: 'PATCH', body: { data: { amount: 9 } } }), params({ id: 'tbl-a', rowId: 'row-1' }))).json()
    expect(patched.data.row.data.amount).toBe(9)
    expect((await deleteRowRoute(req('/data-tables/tbl-a/rows/row-1', { method: 'DELETE' }), params({ id: 'tbl-a', rowId: 'row-1' }))).status).toBe(200)
    const bulkDelete = await (await bulkDeleteRoute(req('/data-tables/tbl-a/rows/bulk-delete', { method: 'POST', body: { row_ids: ['row-2', 'row-b'] } }), params({ id: 'tbl-a' }))).json()
    expect(bulkDelete.data).toEqual({ deleted: 1, ids: ['row-2'] })
  })

  it('403 for tables outside the key’s resource scope', async () => {
    const db = seed()
    authAs(db, ALL, ['tbl-a2'])
    const res = await upsertRowsRoute(req('/data-tables/tbl-a/rows', { method: 'POST', body: { data: { status: 'open' } } }), params({ id: 'tbl-a' }))
    expect(res.status).toBe(403)
  })
})

describe('MCP data tools (service wrappers)', () => {
  const mcp = (db: Db, extra: Record<string, unknown> = {}) => createMcpServer({ tenantId: 'tenant-a', supabase: db, actingUserId: null, keyType: 'tenant', scopes: { workflow_ids: [], table_ids: [] }, ...extra } as any)
  const json = (result: any) => JSON.parse(result.content[0].text)

  it('keeps the tool shapes and now fires row workflows', async () => {
    const db = seed()
    const server = mcp(db)
    const created = json(await server.callTool('data_rows_upsert', { table_id: 'tbl-a', data: { order_no: 'M-1' } }))
    expect(created).toEqual({ created: true, row_id: expect.any(String) })
    expect(firedEvents()).toContainEqual(expect.objectContaining({ eventType: 'created' }))
    expect(json(await server.callTool('data_rows_upsert', { table_id: 'tbl-a', row_id: 'row-1', data: { order_no: 'A-1' } }))).toEqual({ updated: true, row_id: 'row-1' })
    const query = json(await server.callTool('data_rows_query', { table_id: 'tbl-a', limit: 1 }))
    expect(query).toMatchObject({ count: 1, limit: 1, offset: 0 })
    expect(json(await server.callTool('data_tables_list', {})).tables.map((t: any) => t.id).sort()).toEqual(['tbl-a', 'tbl-a2'])
    expect(json(await server.callTool('data_rows_delete', { row_id: 'row-2' }))).toEqual({ deleted: true, row_id: 'row-2' })
    expect(enqueueDeletionJob).toHaveBeenCalledWith(db, expect.objectContaining({ targetType: 'data_row', targetId: 'row-2' }))
  })

  it('denies writes without permission and outside table scopes', async () => {
    const db = seed()
    const denied = await mcp(db, { permissions: ['data.view'] }).callTool('data_rows_upsert', { table_id: 'tbl-a', data: { status: 'x' } })
    expect(denied.isError).toBe(true)
    const scoped = await mcp(db, { scopes: { workflow_ids: [], table_ids: ['tbl-a2'] } }).callTool('data_rows_delete', { row_id: 'row-1' })
    expect(scoped.isError).toBe(true)
    expect(enqueueDeletionJob).not.toHaveBeenCalled()
  })
})
