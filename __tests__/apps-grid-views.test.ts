/**
 * App data grids: header sorting (server-side) and personal saved views
 * (sort, search, columns, "equals" filters) kept in the person's own
 * users.preferences per workspace, app page and widget.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WIDGET_CONFIG_SCHEMAS, normalisePageLayout } from '@/lib/apps/schema'
import { MAX_GRID_VIEWS, nextSort, readViews, stateParams, upsertView, viewColumns, viewsKey, writeViews, type GridView } from '@/lib/apps/grid-views'

const TABLE = '0f000000-0000-4000-8000-0000000000d1'

const mocks = vi.hoisted(() => ({
  presented: null as unknown,
  prefs: {} as Record<string, unknown>,
  updates: [] as unknown[],
  table: null as unknown,
  queryRows: vi.fn(async (_ctx: unknown, _table: string, _q: unknown, _p: unknown) => ({ rows: [], total: 0, truncated: false })),
}))
vi.mock('@/lib/services/apps', () => ({
  getPresentedPage: vi.fn(async () => mocks.presented),
  getViewerAppRole: vi.fn(async () => 'contributor'),
  getAppPageView: vi.fn(),
}))
vi.mock('@/lib/services/home', () => ({ claimTask: vi.fn(), myTeams: vi.fn() }))
vi.mock('@/lib/services/tasks', () => ({ completeStandardTask: vi.fn(), updateTask: vi.fn() }))
vi.mock('@/lib/services/agents', () => ({ enqueueAgentRun: vi.fn(), getAgentQueueJob: vi.fn() }))
vi.mock('@/lib/services/data-tables', async (orig) => ({ ...(await orig() as object), updateRow: vi.fn(), deleteRows: vi.fn(), queryRows: mocks.queryRows, getDataTable: vi.fn(async () => mocks.table) }))
vi.mock('@/lib/services/context', async (orig) => {
  const real = await orig() as Record<string, unknown>
  const users = {
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { preferences: mocks.prefs }, error: null }) }) }),
    update: (row: { preferences: Record<string, unknown> }) => ({ eq: async (_c: string, id: string) => { mocks.updates.push(id); mocks.prefs = row.preferences; return { error: null } } }),
  }
  return { ...real, getDb: () => ({ from: (t: string) => (t === 'users' ? users : null) }) }
})

import { deleteGridView, listGridViews, saveGridView } from '@/lib/services/app-widget-actions'
import { moreWidgetData } from '@/lib/services/app-widgets-more'

const ctx = { authKind: 'session', tenantId: 't1', actorId: 'u1', permissions: new Set(['data.view']) } as never
const grid = (config: Record<string, unknown>) => ({ layout: normalisePageLayout({ widgets: [{ id: 'deals', type: 'data_grid', w: 12, h: 8, config: { table_id: TABLE, ...config } }] }) })
const ref = { app: 'crm', page: 'pipeline', widget_id: 'deals' }

describe('grid sorting and views (pure)', () => {
  it('the schema takes a default sort and the personal views switch', () => {
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.parse({ sort: 'close_date', sort_dir: 'desc', personal_views: true })).toMatchObject({ sort: 'close_date', sort_dir: 'desc', personal_views: true })
    expect(Object.keys(WIDGET_CONFIG_SCHEMAS.data_grid.parse({}))).not.toContain('personal_views')
  })
  it('a header click cycles ascending → descending → the grid’s own order; another column starts ascending', () => {
    expect(nextSort({ sort: null, dir: 'asc' }, 'amount')).toEqual({ sort: 'amount', dir: 'asc' })
    expect(nextSort({ sort: 'amount', dir: 'asc' }, 'amount')).toEqual({ sort: 'amount', dir: 'desc' })
    expect(nextSort({ sort: 'amount', dir: 'desc' }, 'amount')).toEqual({ sort: null, dir: 'asc' })
    expect(nextSort({ sort: 'amount', dir: 'desc' }, 'name')).toEqual({ sort: 'name', dir: 'asc' })
  })
  it('a view’s columns are a subset of the grid’s own (in the view’s order); none left → the grid’s', () => {
    expect(viewColumns(['a', 'b', 'c'], { columns: ['c', 'a', 'secret', 'a'] })).toEqual(['c', 'a'])
    expect(viewColumns(['a', 'b'], { columns: ['secret'] })).toEqual(['a', 'b'])
    expect(viewColumns(['a', 'b'], null)).toEqual(['a', 'b'])
  })
  it('stores views per key without touching other preferences; drops invalid entries; caps the count', () => {
    const key = viewsKey('t1', 'crm', 'pipeline', 'deals')
    const v: GridView = { id: 'v-1', name: 'My big deals', sort: 'amount', dir: 'desc', filters: [{ column: 'owner', value: 'Maya Patel' }] }
    const prefs = writeViews({ theme: 'dark', app_grid_views: { other: [{ id: 'x', name: 'X' }] } }, key, [v])
    expect(prefs.theme).toBe('dark')
    expect(readViews(prefs, key)).toEqual([v])
    expect(readViews(prefs, 'other')).toHaveLength(1)
    expect(readViews({ app_grid_views: { [key]: [v, { id: 'BAD ID', name: '' }] } }, key)).toEqual([v])
    expect((writeViews(prefs, key, []).app_grid_views as Record<string, unknown>)[key]).toBeUndefined()
    // Same name replaces (keeping the id); past the cap is refused.
    expect(upsertView([v], { id: 'v-2', name: 'my BIG deals', sort: 'name' })).toEqual([{ id: 'v-1', name: 'my BIG deals', sort: 'name' }])
    const full = Array.from({ length: MAX_GRID_VIEWS }, (_, i) => ({ id: `v-${i}`, name: `V${i}` }))
    expect(() => upsertView(full, { id: 'v-new', name: 'One more' })).toThrow(/At most/)
  })
  it('request params carry only what differs from the grid', () => {
    expect(stateParams({ sort: null, dir: 'asc', search: '', columns: null, filters: [] })).toEqual({})
    expect(stateParams({ sort: 'amount', dir: 'desc', search: 'x', columns: ['a'], filters: [{ column: 'stage', value: 'Proposal' }] })).toEqual({ sort: 'amount', dir: 'desc', cols: ['a'], eq: [{ column: 'stage', value: 'Proposal' }] })
  })
})

describe('personal saved views (service)', () => {
  beforeEach(() => { mocks.prefs = { theme: 'dark' }; mocks.updates = []; mocks.presented = grid({ personal_views: true }) })

  it('saves, lists and deletes the signed-in person’s own views', async () => {
    expect((await listGridViews(ctx, ref)).views).toEqual([])
    const { views } = await saveGridView(ctx, { ...ref, view: { id: 'v-1', name: 'Closing soon', sort: 'close_date', dir: 'asc' } })
    expect(views.map((v) => v.name)).toEqual(['Closing soon'])
    expect(mocks.updates).toEqual(['u1'])
    expect(mocks.prefs.theme).toBe('dark')
    expect((await listGridViews(ctx, ref)).views[0]).toMatchObject({ sort: 'close_date' })
    expect((await deleteGridView(ctx, { ...ref, id: 'v-1' })).views).toEqual([])
  })
  it('refuses grids without personal views, invalid views and non-session callers', async () => {
    mocks.presented = grid({})
    await expect(listGridViews(ctx, ref)).rejects.toThrow(/no saved views/)
    mocks.presented = grid({ personal_views: true })
    await expect(saveGridView(ctx, { ...ref, view: { id: 'v-1', name: '' } })).rejects.toThrow(/name/)
    await expect(listGridViews({ ...(ctx as object), authKind: 'api_key' } as never, ref)).rejects.toThrow(/signed-in/)
  })
})

describe('grid data: sort, columns and view filters on the server', () => {
  const config = (c: Record<string, unknown> = {}) => WIDGET_CONFIG_SCHEMAS.data_grid.parse({ table_id: TABLE, columns: ['name', 'stage', 'amount'], where: [{ column: 'region', value: 'West' }], ...c })
  const extra = (params: Record<string, unknown>) => ({ params, filters: {}, role: 'viewer' as const, widgetKey: 'k', preview: false })
  const table = { id: TABLE, name: 'Deals', columns: [{ key: 'name', name: 'Name' }, { key: 'stage', name: 'Stage' }, { key: 'amount', name: 'Amount', type: 'number' }, { key: 'region', name: 'Region' }, { key: 'secret', name: 'Secret', hidden: true }] }

  it('sorts by the header column, else the grid default; narrows with view filters on its own columns; shows a column subset', async () => {
    mocks.table = table
    mocks.queryRows.mockClear()
    const d1: any = await moreWidgetData(ctx, 'data_grid', config({ sort: 'amount', sort_dir: 'desc' }), extra({}))
    expect(mocks.queryRows.mock.calls[0][2]).toMatchObject({ sort_field: 'amount', sort_direction: 'desc', filters: [{ field: 'region', operator: 'equals', value: 'West' }] })
    expect([d1.sort, d1.dir, d1.personal_views]).toEqual(['amount', 'desc', false])
    const d2: any = await moreWidgetData(ctx, 'data_grid', config({ sort: 'amount' }), extra({ sort: 'name', dir: 'asc', cols: ['amount', 'name', 'secret'], eq: [{ column: 'stage', value: 'Proposal' }, { column: 'secret', value: 'x' }] }))
    expect(mocks.queryRows.mock.calls[1][2]).toMatchObject({ sort_field: 'name', sort_direction: 'asc', filters: [{ field: 'region', operator: 'equals', value: 'West' }, { field: 'stage', operator: 'equals', value: 'Proposal' }] })
    expect(d2.columns.map((c: any) => c.key)).toEqual(['amount', 'name'])
    expect(d2.grid_columns.map((c: any) => c.key)).toEqual(['name', 'stage', 'amount'])
    // A column the table doesn't show can't be sorted on.
    await moreWidgetData(ctx, 'data_grid', config(), extra({ sort: 'secret' }))
    expect(mocks.queryRows.mock.calls[2][2]).not.toHaveProperty('sort_field')
  })
})
