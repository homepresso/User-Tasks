/**
 * Grouping and child records on the server (lib/services/data-table-grouping.ts)
 * and their API: GET /api/v1/data-tables/{id}/rows/groups, GET …/rows/{rowId}/children,
 * child_relations on PATCH /api/v1/data-tables/{id}, the grid's reads
 * (data.rowGroups / data.rowPage filters / data.childCounts / data.childRows)
 * and the MCP tools. The API / MCP client is the service role, so every query
 * must be limited to the caller's tenant and the key's table scope: another
 * workspace's tables and rows never count, link or show.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/data-table-workflow-triggers', () => ({ enqueueDataTableEvents: vi.fn(async () => 0) }))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import type { ServiceContext } from '@/lib/services/context'
import { computeChildCounts, groupRows, loadChildRows, queryFilteredRows, rowChildren } from '@/lib/services/data-table-grouping'
import { updateDataTable } from '@/lib/services/data-tables'
import { runUiRead } from '@/lib/services/ui-reads'
import { GET as groupsRoute } from '@/app/api/v1/data-tables/[id]/rows/groups/route'
import { GET as childrenRoute } from '@/app/api/v1/data-tables/[id]/rows/[rowId]/children/route'
import { PATCH as patchTableRoute } from '@/app/api/v1/data-tables/[id]/route'
import { createMcpServer } from '@/lib/mcp/server'
import { createMemorySupabase } from './fixtures/supabase-memory'

const T = 'tenant-a'
const ORDERS = '0f000000-0000-4000-8000-00000000e001'
const LINES = '0f000000-0000-4000-8000-00000000e002'
const TASKS = '0f000000-0000-4000-8000-00000000e003'
const FOREIGN = '0f000000-0000-4000-8000-00000000e009'
const O1 = '0f000000-0000-4000-8000-00000000f001'
const O2 = '0f000000-0000-4000-8000-00000000f002'
const O3 = '0f000000-0000-4000-8000-00000000f003'
const TK1 = '0f000000-0000-4000-8000-00000000f101'
const TK2 = '0f000000-0000-4000-8000-00000000f102'
const TK3 = '0f000000-0000-4000-8000-00000000f103'
const ALL = ['data.view', 'data.edit_schema', 'data.manage_rows']

const orderColumns = [{ key: 'id', name: 'ID', type: 'number' }, { key: 'order_no', name: 'Order No', type: 'text' }, { key: 'status', name: 'Status', type: 'select' }, { key: 'region', name: 'Region', type: 'text' }, { key: 'total', name: 'Total', type: 'number' }]
const lineColumns = [{ key: 'id', name: 'ID', type: 'number' }, { key: 'order', name: 'Order', type: 'lookup', lookup: { sourceTableId: ORDERS, sourceColumn: 'Order No' } }, { key: 'qty', name: 'Qty', type: 'number' }]
const taskColumns = [{ key: 'title', name: 'Title', type: 'text' }, { key: 'parent', name: 'Parent', type: 'lookup', lookup: { sourceTableId: TASKS, sourceColumn: 'title' } }]

function seed(opts: { relations?: boolean } = {}) {
  const rel = opts.relations === false ? {} : { child_relations: [{ id: 'r_lines', table_id: LINES, lookup_column: 'order', label: 'Lines' }] }
  const row = (id: string, table: string, data: object, tenant = T, created = '2026-11-01T00:00:00Z') => ({ id, table_id: table, tenant_id: tenant, data, created_at: created, updated_at: created })
  return createMemorySupabase({
    custom_tables: [
      { id: ORDERS, tenant_id: T, name: 'Orders', slug: 'orders', columns: orderColumns, views: [], ...rel },
      { id: LINES, tenant_id: T, name: 'Order lines', slug: 'order-lines', columns: lineColumns, views: [], child_relations: [] },
      { id: TASKS, tenant_id: T, name: 'Tasks', slug: 'tasks', columns: taskColumns, views: [], child_relations: [{ id: 'r_sub', table_id: TASKS, lookup_column: 'parent', roots_only: true }] },
      { id: FOREIGN, tenant_id: 'tenant-b', name: 'Foreign lines', slug: 'foreign', columns: [{ key: 'order', name: 'Order', type: 'lookup', lookup: { sourceTableId: ORDERS, sourceColumn: 'Order No' } }], views: [], child_relations: [] },
    ],
    custom_table_rows: [
      row(O1, ORDERS, { id: 1, order_no: 'A-1', status: 'open', region: 'east', total: 100 }),
      row(O2, ORDERS, { id: 2, order_no: 'A-2', status: 'open', region: 'west', total: 50.5 }),
      row(O3, ORDERS, { id: 3, order_no: '', status: 'closed', total: 'n/a' }),
      row('l1', LINES, { id: 1, order: 'A-1', qty: 2 }, T, '2026-11-02T00:00:00Z'),
      row('l2', LINES, { id: 2, order: 'A-1', qty: 3 }, T, '2026-11-03T00:00:00Z'),
      row('l3', LINES, { id: 3, order: 'A-2', qty: 1 }),
      row('lb', LINES, { id: 9, order: 'A-1', qty: 99 }, 'tenant-b'),
      row('fb', FOREIGN, { order: 'A-1' }, 'tenant-b'),
      row('ob', ORDERS, { order_no: 'B-1', status: 'open', total: 1000 }, 'tenant-b'),
      row(TK1, TASKS, { title: 'Launch' }),
      row(TK2, TASKS, { title: 'Design', parent: 'Launch' }),
      row(TK3, TASKS, { title: 'Loop', parent: 'Loop' }),
    ],
  })
}
type Db = ReturnType<typeof seed>

function ctx(db: Db, permissions: string[] = ALL, tableIds: string[] = []): ServiceContext {
  return {
    supabase: db as unknown as ServiceContext['supabase'], tenantId: T, actorId: 'u1',
    permissions: new Set(permissions), resourceScopes: { workflow_ids: [], table_ids: tableIds }, authKind: 'api_key', source: 'api',
  }
}

describe('groups (in-memory fallback until the migration is applied)', () => {
  it('groups the whole table of the caller\'s workspace, with sums; never another workspace\'s rows', async () => {
    const db = seed()
    const res = await groupRows(ctx(db), ORDERS, { group_by: ['status'], sum: ['total'] })
    expect(res.exact).toBe(false)
    expect(res.groups.map((g) => [g.value, g.count, g.sums.total])).toEqual([['closed', 1, undefined], ['open', 2, 150.5]])
    expect(res.total).toBe(3)
  })

  it('needs data.view, the key\'s table scope and a table of this workspace; group_by must name a column', async () => {
    const db = seed()
    await expect(groupRows(ctx(db, []), ORDERS, { group_by: ['status'] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(groupRows(ctx(db, ALL, [LINES]), ORDERS, { group_by: ['status'] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(groupRows(ctx(db), FOREIGN, { group_by: ['order'] })).rejects.toMatchObject({ code: 'not_found' })
    await expect(groupRows(ctx(db), ORDERS, { group_by: ['bad key!'] })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('uses data_table_row_groups when it exists, scoped to the caller\'s tenant', async () => {
    const db = seed()
    const rpc = vi.fn(async () => ({ data: [{ g1: 'east', g2: 'open', row_count: 1, sums: { total: 100 } }, { g1: null, g2: 'closed', row_count: 4, sums: {} }], error: null }))
    ;(db as any).rpc = rpc
    const res = await groupRows(ctx(db), ORDERS, { group_by: ['region', 'status'], search: ' acme ', sum: ['total'], filters: [{ field: 'total', operator: 'gt', value: 1 }] })
    expect(rpc).toHaveBeenCalledWith('data_table_row_groups', expect.objectContaining({ p_table_id: ORDERS, p_group_by: ['region', 'status'], p_search: 'acme', p_tenant_id: T, p_sum: ['total'], p_filters: [{ field: 'total', operator: 'gt', value: 1 }] }))
    expect(res.exact).toBe(true)
    expect(res.groups).toEqual([
      { value: null, count: 4, sums: {}, groups: [{ value: 'closed', count: 4, sums: {} }] },
      { value: 'east', count: 1, sums: { total: 100 }, groups: [{ value: 'open', count: 1, sums: { total: 100 } }] },
    ])
  })

  it('reads a group\'s rows exactly through data_table_rows_page, else filters the newest rows', async () => {
    const db = seed()
    const fallback = await queryFilteredRows(db as any, ORDERS, { filters: [{ field: 'status', operator: 'in', value: ['open'] }], sort: 'total', dir: 'asc', limit: 10, offset: 0 }, T)
    expect(fallback.rows.map((r) => r.id)).toEqual([O2, O1])
    expect(fallback.total).toBe(2)
    const rpc = vi.fn(async () => ({ data: [{ id: O1, data: {}, _total: 7 }], error: null }))
    ;(db as any).rpc = rpc
    const exact = await queryFilteredRows(db as any, ORDERS, { filters: [{ field: 'status', operator: 'is_empty' }], sort: "x'; drop", limit: 1, offset: 0 }, T)
    expect(rpc).toHaveBeenCalledWith('data_table_rows_page', expect.objectContaining({ p_sort: '_updated_at', p_tenant_id: T }))
    expect(exact).toEqual({ rows: [{ id: O1, data: {} }], total: 7, truncated: false })
  })
})

describe('child relations (saved with the schema)', () => {
  it('saves a relation to a lookup column that points here; refuses everything else', async () => {
    const db = seed({ relations: false })
    const saved = await updateDataTable(ctx(db), ORDERS, { child_relations: [{ table_id: LINES, lookup_column: 'order', label: 'Lines' }] })
    expect((saved as any).child_relations).toEqual([expect.objectContaining({ table_id: LINES, lookup_column: 'order', label: 'Lines', id: expect.stringMatching(/^r_/) })])
    await expect(updateDataTable(ctx(db), ORDERS, { child_relations: [{ table_id: LINES, lookup_column: 'qty' }] })).rejects.toThrow(/not a lookup column/)
    await expect(updateDataTable(ctx(db), ORDERS, { child_relations: [{ table_id: TASKS, lookup_column: 'parent' }] })).rejects.toThrow(/does not look up this table/)
    // Another workspace's table can't be a child (it is not found).
    await expect(updateDataTable(ctx(db), ORDERS, { child_relations: [{ table_id: FOREIGN, lookup_column: 'order' }] })).rejects.toThrow(/was not found/)
    await expect(updateDataTable(ctx(db), ORDERS, { child_relations: [{ table_id: LINES }] as never })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(updateDataTable(ctx(db), ORDERS, { child_relations: Array.from({ length: 6 }, () => ({ table_id: LINES, lookup_column: 'order' })) })).rejects.toThrow(/At most 5/)
    await expect(updateDataTable(ctx(db, ['data.view', 'data.manage_rows']), ORDERS, { child_relations: [] })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(updateDataTable(ctx(db, ALL, [ORDERS]), ORDERS, { child_relations: [{ table_id: LINES, lookup_column: 'order' }] })).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('checks a same-table relation against the columns being saved', async () => {
    const db = seed()
    await updateDataTable(ctx(db), TASKS, { child_relations: [{ id: 'r_sub', table_id: TASKS, lookup_column: 'parent', roots_only: true }] })
    await expect(updateDataTable(ctx(db), TASKS, {
      columns: [{ key: 'title', name: 'Title', type: 'text' }, { key: 'parent', name: 'Parent', type: 'text' }],
      child_relations: [{ table_id: TASKS, lookup_column: 'parent' }],
    })).rejects.toThrow(/not a lookup column/)
  })

  it('says which migration is missing when the column is not there yet', async () => {
    const db = seed({ relations: false })
    const original = db.from.bind(db)
    ;(db as any).from = (table: string) => {
      const b = original(table)
      const select = b.select.bind(b)
      b.select = (cols?: string, o?: any) => (cols?.includes('child_relations') ? Object.assign(Promise.resolve({ data: null, error: { code: '42703', message: 'column custom_tables.child_relations does not exist' } }), { single: () => Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } }) }) : select(cols, o))
      return b
    }
    await expect(updateDataTable(ctx(db), ORDERS, { child_relations: [{ table_id: LINES, lookup_column: 'order' }] })).rejects.toThrow(/20270119090000/)
  })
})

describe('child rows and counts', () => {
  it('counts each parent\'s children in this workspace only (another workspace\'s rows with the same value never count)', async () => {
    const db = seed()
    const res = await computeChildCounts(db as any, ORDERS, [{ id: O1, data: { order_no: 'A-1' } }, { id: O2, data: { order_no: 'A-2' } }, { id: O3, data: { order_no: '' } }], T)
    expect(res.relations.map((r) => [r.id, r.table_name])).toEqual([['r_lines', 'Order lines']])
    expect(res.counts.r_lines).toEqual({ [O1]: 2, [O2]: 1, [O3]: 0 })
  })

  it('lists a parent\'s child rows oldest first with the link value and the child table', async () => {
    const db = seed()
    const res = await loadChildRows(db as any, ORDERS, O1, 'r_lines', { limit: 50, offset: 0 }, T)
    expect(res.rows.map((r) => r.id)).toEqual(['l1', 'l2'])
    expect(res.total).toBe(2)
    expect(res.link_value).toBe('A-1')
    expect(res.lookup_column).toBe('order')
    expect(res.table.name).toBe('Order lines')
    // A parent without a link value has no children.
    expect((await loadChildRows(db as any, ORDERS, O3, 'r_lines', { limit: 50, offset: 0 }, T)).rows).toEqual([])
    await expect(loadChildRows(db as any, ORDERS, 'ob', 'r_lines', { limit: 50, offset: 0 }, T)).rejects.toMatchObject({ code: 'not_found' })
    await expect(loadChildRows(db as any, ORDERS, O1, 'r_nope', { limit: 50, offset: 0 }, T)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('nests a same-table hierarchy and never lists or counts a row as its own child', async () => {
    const db = seed()
    const counts = await computeChildCounts(db as any, TASKS, [{ id: TK1, data: { title: 'Launch' } }, { id: TK3, data: { title: 'Loop', parent: 'Loop' } }], T)
    expect(counts.counts.r_sub).toEqual({ [TK1]: 1, [TK3]: 0 })
    expect((await loadChildRows(db as any, TASKS, TK1, 'r_sub', { limit: 50, offset: 0 }, T)).rows.map((r) => r.id)).toEqual([TK2])
    const loop = await loadChildRows(db as any, TASKS, TK3, 'r_sub', { limit: 50, offset: 0 }, T)
    expect(loop.rows).toEqual([])
    expect(loop.total).toBe(0)
  })
})

describe('API', () => {
  const mockedValidate = vi.mocked(validateApiKey)
  function authAs(db: Db, permissions = ALL, tableIds: string[] = []) {
    mockedValidate.mockResolvedValue({
      success: true, tenantId: T, keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
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
  beforeEach(() => mockedValidate.mockReset())

  it('GET /rows/groups groups by one or two comma-separated columns with sums and filters', async () => {
    const db = seed()
    authAs(db)
    const filters = encodeURIComponent(JSON.stringify([{ field: 'status', operator: 'equals', value: 'open' }]))
    const res = await groupsRoute(req(`/data-tables/${ORDERS}/rows/groups?group_by=status,region&sum=total&filters=${filters}&group_order=desc`), params({ id: ORDERS }))
    expect(res.status).toBe(200)
    const body = (await res.json()).data
    expect(body.group_by).toEqual(['status', 'region'])
    expect(body.groups).toEqual([{ value: 'open', count: 2, sums: { total: 150.5 }, groups: [{ value: 'west', count: 1, sums: { total: 50.5 } }, { value: 'east', count: 1, sums: { total: 100 } }] }])
    expect((await groupsRoute(req(`/data-tables/${ORDERS}/rows/groups`), params({ id: ORDERS }))).status).toBe(400)
    authAs(db, ['data.manage_rows'])
    expect((await groupsRoute(req(`/data-tables/${ORDERS}/rows/groups?group_by=status`), params({ id: ORDERS }))).status).toBe(403)
  })

  it('GET /rows/{rowId}/children lists a relation\'s rows, or the counts per relation', async () => {
    const db = seed()
    authAs(db)
    // One relation: its rows without naming it.
    const only = (await (await childrenRoute(req(`/data-tables/${ORDERS}/rows/${O1}/children`), params({ id: ORDERS, rowId: O1 }))).json()).data
    expect(only.rows.map((r: any) => r.id)).toEqual(['l1', 'l2'])
    const rows = (await (await childrenRoute(req(`/data-tables/${ORDERS}/rows/${O1}/children?relation=r_lines&limit=1`), params({ id: ORDERS, rowId: O1 }))).json()).data
    expect(rows).toMatchObject({ link_value: 'A-1', lookup_column: 'order', total: 2, child_table: { id: LINES, name: 'Order lines' } })
    expect(rows.rows).toHaveLength(1)
    // A key limited to the parent table can't read the child table's rows.
    authAs(db, ALL, [ORDERS])
    expect((await childrenRoute(req(`/data-tables/${ORDERS}/rows/${O1}/children?relation=r_lines`), params({ id: ORDERS, rowId: O1 }))).status).toBe(404)
    const scoped = (await (await childrenRoute(req(`/data-tables/${ORDERS}/rows/${O1}/children`), params({ id: ORDERS, rowId: O1 }))).json()).data
    expect(scoped.relations).toEqual([])
  })

  it('PATCH /data-tables/{id} saves child_relations', async () => {
    const db = seed({ relations: false })
    authAs(db)
    const res = await patchTableRoute(req(`/data-tables/${ORDERS}`, { method: 'PATCH', body: { child_relations: [{ table_id: LINES, lookup_column: 'order' }] } }), params({ id: ORDERS }))
    expect(res.status).toBe(200)
    expect(db.tables.custom_tables.find((t) => t.id === ORDERS)!.child_relations).toEqual([expect.objectContaining({ table_id: LINES, lookup_column: 'order' })])
    const bad = await patchTableRoute(req(`/data-tables/${ORDERS}`, { method: 'PATCH', body: { child_relations: [{ table_id: LINES, lookup_column: 'qty' }] } }), params({ id: ORDERS }))
    expect(bad.status).toBe(400)
  })
})

describe('grid reads and MCP', () => {
  const sessionCtx = (db: Db): ServiceContext => ({ ...ctx(db), authKind: 'session', source: 'ui' } as ServiceContext)

  it('data.rowGroups / data.rowPage filters / data.childCounts / data.childRows', async () => {
    const db = seed()
    const groups = await runUiRead(sessionCtx(db), { name: 'data.rowGroups', args: { tableId: ORDERS, groupBy: ['status'], sum: ['total'] } })
    expect(groups.ok && (groups.data as any).groups.map((g: any) => g.value)).toEqual(['closed', 'open'])
    expect(groups.ok && (groups.data as any).group_by).toBeUndefined()
    // A hierarchy's top level: no parent, or a parent that names no other row (TK3 is its own parent).
    const page = await runUiRead(sessionCtx(db), { name: 'data.rowPage', args: { tableId: TASKS, filters: [{ field: 'parent', operator: 'is_root', value: 'title' }] } })
    expect(page.ok && (page.data as any).rows.map((r: any) => r.id).sort()).toEqual([TK1, TK3].sort())
    const counts = await runUiRead(sessionCtx(db), { name: 'data.childCounts', args: { tableId: ORDERS, rowIds: [O1, O2] } })
    expect(counts.ok && (counts.data as any).counts.r_lines).toMatchObject({ [O1]: expect.any(Number), [O2]: expect.any(Number) })
    const children = await runUiRead(sessionCtx(db), { name: 'data.childRows', args: { tableId: ORDERS, rowId: O2, relationId: 'r_lines' } })
    expect(children.ok && (children.data as any).rows.map((r: any) => r.id)).toEqual(['l3'])
  })

  it('MCP data_rows_groups and data_rows_children', async () => {
    const db = seed()
    const server = createMcpServer({ tenantId: T, supabase: db, actingUserId: null, keyType: 'tenant', scopes: { workflow_ids: [], table_ids: [] } } as any)
    const call = async (name: string, args: object) => JSON.parse(((await server.callTool(name, args)) as any).content[0].text)
    const groups = await call('data_rows_groups', { table_id: ORDERS, group_by: ['status'], sum: ['total'] })
    expect(groups.groups.map((g: any) => [g.value, g.count])).toEqual([['closed', 1], ['open', 2]])
    const children = await call('data_rows_children', { table_id: ORDERS, row_id: O1, relation: 'r_lines' })
    expect(children.rows.map((r: any) => r.id)).toEqual(['l1', 'l2'])
  })
})
