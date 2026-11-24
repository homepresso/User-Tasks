/**
 * Data grid bulk selection: select several rows, then delete them (opt-in,
 * contributors with Manage rows) or run a "Grid row action" rule once per
 * selected row. Governance turns deleting off for anyone who may not write
 * the table (as it does in-place editing); the server re-checks the widget,
 * the app role and Manage rows, and only deletes rows of the grid's table.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { presentLayout, widgetBindings, type ObjectFacts } from '@/lib/apps/governance'
import { WIDGET_CONFIG_SCHEMAS, normalisePageLayout, type AppWidget } from '@/lib/apps/schema'
import { RULE_TRIGGERS, TRIGGER_PAYLOAD, appRuleSchema, ruleMatches, type AppRule } from '@/lib/apps/rules'
import { rowActionEvents } from '@/lib/apps/events'

const TABLE = '0f000000-0000-4000-8000-0000000000d1'
const ROW1 = '0f000000-0000-4000-8000-0000000000e1'
const ROW2 = '0f000000-0000-4000-8000-0000000000e2'

const mocks = vi.hoisted(() => ({
  presented: null as unknown,
  role: 'contributor' as 'viewer' | 'contributor' | 'editor',
  deleteRows: vi.fn(async (_ctx: unknown, _table: string, ids: string[]) => ({ deleted: ids.length, ids })),
}))
vi.mock('@/lib/services/apps', () => ({
  getPresentedPage: vi.fn(async () => mocks.presented),
  getViewerAppRole: vi.fn(async () => mocks.role),
  getAppPageView: vi.fn(),
}))
vi.mock('@/lib/services/data-tables', () => ({ updateRow: vi.fn(), deleteRows: mocks.deleteRows }))
vi.mock('@/lib/services/home', () => ({ claimTask: vi.fn(), myTeams: vi.fn() }))
vi.mock('@/lib/services/tasks', () => ({ completeStandardTask: vi.fn(), updateTask: vi.fn() }))
vi.mock('@/lib/services/agents', () => ({ enqueueAgentRun: vi.fn(), getAgentQueueJob: vi.fn() }))

import { deleteGridRows } from '@/lib/services/app-widget-actions'

const grid = { id: 'deals', type: 'data_grid', w: 12, h: 8, config: { table_id: TABLE, allow_delete: true, row_actions: [{ label: 'Mark won' }, { label: 'Send reminder' }] } }
const facts = (perms: string[]): ObjectFacts => ({
  can: (p) => perms.includes(p),
  formGrants: new Set(),
  exists: { form: new Set(), workflow: new Set(), data_table: new Set([TABLE]), report: new Set() },
  visibleReports: new Set(),
})
const ctx = { authKind: 'session', tenantId: 't1', actorId: 'u1', permissions: new Set(['data.view', 'data.manage_rows']) } as never

describe('data grid bulk selection', () => {
  beforeEach(() => { mocks.deleteRows.mockClear(); mocks.role = 'contributor'; mocks.presented = { layout: normalisePageLayout({ widgets: [grid] }) } })

  it('parses delete and row actions; existing grids keep their shape', () => {
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.parse(grid.config)).toMatchObject({ allow_delete: true, row_actions: [{ label: 'Mark won' }, { label: 'Send reminder' }] })
    expect(Object.keys(WIDGET_CONFIG_SCHEMAS.data_grid.parse({}))).not.toContain('allow_delete')
    expect(WIDGET_CONFIG_SCHEMAS.data_grid.safeParse({ row_actions: Array.from({ length: 5 }, (_, i) => ({ label: `A${i}` })) }).success).toBe(false)
  })

  it('binds the table for writing when rows can be deleted; governance turns deleting off for readers and viewers', () => {
    const widget = normalisePageLayout({ widgets: [grid] }).widgets[0] as AppWidget
    expect(widgetBindings(widget).objects.map((o) => [o.need, !!o.optional])).toEqual([['view', false], ['edit', true]])
    const layout = normalisePageLayout({ widgets: [grid] })
    const del = (perms: string[], role: 'viewer' | 'contributor') => (presentLayout(layout, facts(perms), role).widgets[0]?.config as { allow_delete?: boolean }).allow_delete
    expect(del(['data.view', 'data.manage_rows'], 'contributor')).toBe(true)
    expect(del(['data.view'], 'contributor')).toBe(false)
    expect(del(['data.view', 'data.manage_rows'], 'viewer')).toBe(false)
  })

  it('a row action rule runs once per selected row, matched by widget and action', () => {
    expect(RULE_TRIGGERS).toContain('row_action')
    expect(TRIGGER_PAYLOAD.row_action).toEqual(expect.arrayContaining(['event.row.id', 'event.label', 'event.count']))
    const rule = appRuleSchema.parse({ id: 'won', when: { type: 'row_action', widget: 'deals', button: 0 }, then: [{ type: 'refresh' }] }) as AppRule
    const events = rowActionEvents('deals', 0, 'Mark won', [{ id: ROW1, name: 'Acme' }, { id: ROW2, name: 'Globex' }])
    expect(events).toHaveLength(2)
    expect(events[1]).toMatchObject({ type: 'row_action', widget: 'deals', button: 0, payload: { widget: 'deals', index: 0, label: 'Mark won', value: ROW2, row: { id: ROW2, name: 'Globex' }, count: 2, position: 2 } })
    expect(events.every((e) => ruleMatches(rule, e))).toBe(true)
    expect(ruleMatches(rule, rowActionEvents('deals', 1, 'Send reminder', [{ id: ROW1 }])[0])).toBe(false)
    expect(ruleMatches(rule, rowActionEvents('other', 0, 'Mark won', [{ id: ROW1 }])[0])).toBe(false)
  })

  it('deletes the selected rows of the grid’s table for a contributor', async () => {
    await expect(deleteGridRows(ctx, { app: 'crm', page: 'deals', widget_id: 'deals', row_ids: [ROW1, ROW2, ROW1] })).resolves.toEqual({ deleted: 2, ids: [ROW1, ROW2] })
    expect(mocks.deleteRows).toHaveBeenCalledWith(ctx, TABLE, [ROW1, ROW2])
  })

  it('refuses viewers, grids without delete, other widgets, bad ids and API keys', async () => {
    mocks.role = 'viewer'
    await expect(deleteGridRows(ctx, { app: 'crm', page: 'deals', widget_id: 'deals', row_ids: [ROW1] })).rejects.toThrow(/Viewers/)
    mocks.role = 'contributor'
    mocks.presented = { layout: normalisePageLayout({ widgets: [{ ...grid, config: { table_id: TABLE } }] }) }
    await expect(deleteGridRows(ctx, { app: 'crm', page: 'deals', widget_id: 'deals', row_ids: [ROW1] })).rejects.toThrow(/can’t delete/)
    await expect(deleteGridRows(ctx, { app: 'crm', page: 'deals', widget_id: 'nope', row_ids: [ROW1] })).rejects.toThrow(/not found/i)
    mocks.presented = { layout: normalisePageLayout({ widgets: [grid] }) }
    await expect(deleteGridRows(ctx, { app: 'crm', page: 'deals', widget_id: 'deals', row_ids: ['x; drop'] })).rejects.toThrow(/Choose/)
    await expect(deleteGridRows(ctx, { app: 'crm', page: 'deals', widget_id: 'deals', row_ids: Array.from({ length: 101 }, () => ROW1).map((r, i) => r.slice(0, -3) + String(i).padStart(3, '0')) })).rejects.toThrow(/At most/)
    await expect(deleteGridRows({ ...(ctx as object), authKind: 'api_key' } as never, { app: 'crm', page: 'deals', widget_id: 'deals', row_ids: [ROW1] })).rejects.toThrow(/signed-in/)
    expect(mocks.deleteRows).not.toHaveBeenCalled()
  })
})
