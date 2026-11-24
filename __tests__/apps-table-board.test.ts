/**
 * Kanban boards of data table rows (kanban source "table"): lanes by a
 * column's value, governance (read the table; drag only with Manage rows and
 * an acting app role) and the lane list.
 */
import { describe, expect, it } from 'vitest'
import { presentLayout, widgetBindings, type ObjectFacts } from '@/lib/apps/governance'
import { WIDGET_CONFIG_SCHEMAS, normalisePageLayout, type AppWidget } from '@/lib/apps/schema'
import { boardLanes } from '@/lib/services/app-widgets-more'

const TABLE = '0f000000-0000-4000-8000-0000000000d1'
const board = {
  id: 'pipeline', type: 'kanban', w: 12, h: 10,
  config: {
    source: 'table', table_id: TABLE, lane_column: 'stage', lanes: ['Prospecting', 'Qualification', 'Proposal', 'Negotiation'],
    template: { title: 'name', subtitle: 'account', badge: 'forecast', fields: [{ key: 'amount', label: 'Amount' }] },
    sum_field: 'amount', sum_format: 'currency', where: [{ column: 'owner', value: { filter: 'owner' } }],
  },
}
const facts = (perms: string[]): ObjectFacts => ({
  can: (p) => perms.includes(p),
  formGrants: new Set(),
  exists: { form: new Set(), workflow: new Set(), data_table: new Set([TABLE]), report: new Set() },
  visibleReports: new Set(),
})

describe('Kanban board of data table rows', () => {
  it('parses, and task boards keep their old shape', () => {
    const parsed = WIDGET_CONFIG_SCHEMAS.kanban.parse(board.config)
    expect(parsed).toMatchObject({ source: 'table', lane_column: 'stage', allow_drag: true, per_column: 20, sum_format: 'currency' })
    expect(Object.keys(WIDGET_CONFIG_SCHEMAS.kanban.parse({})).sort()).toEqual(['allow_drag', 'columns', 'per_column', 'scope'])
    expect(WIDGET_CONFIG_SCHEMAS.kanban.safeParse({ source: 'table', lanes: Array.from({ length: 11 }, (_, i) => `L${i}`) }).success).toBe(false)
  })

  it('binds the table (view, and edit to move cards) instead of tasks', () => {
    const widget = normalisePageLayout({ widgets: [board] }).widgets[0] as AppWidget
    const { objects, sources } = widgetBindings(widget)
    expect(sources).toEqual([])
    expect(objects.map((o) => [o.kind, o.need, !!o.optional])).toEqual([['data_table', 'view', false], ['data_table', 'edit', true]])
    const tasks = normalisePageLayout({ widgets: [{ id: 'b', type: 'kanban', w: 12, h: 10, config: {} }] }).widgets[0] as AppWidget
    expect(widgetBindings(tasks).sources.map((s) => s.source)).toEqual(['tasks'])
  })

  it('lets contributors who may manage rows drag; viewers and readers see a fixed board', () => {
    const layout = normalisePageLayout({ widgets: [board] })
    const drag = (perms: string[], role: 'viewer' | 'contributor') => (presentLayout(layout, facts(perms), role).widgets[0]?.config as { allow_drag?: boolean } | undefined)?.allow_drag
    expect(drag(['data.view', 'data.manage_rows'], 'contributor')).toBe(true)
    expect(drag(['data.view'], 'contributor')).toBe(false)
    expect(drag(['data.view', 'data.manage_rows'], 'viewer')).toBe(false)
    expect(presentLayout(layout, facts([]), 'contributor').widgets).toEqual([])
  })

  it('takes its lanes from the widget, else the lane column’s choices', () => {
    const columns = [{ key: 'stage', type: 'select', options: ['Lead', { value: 'Won' }, { label: 'Lost' }] }]
    expect(boardLanes({ lanes: ['A', 'B'], lane_column: 'stage' }, columns)).toEqual(['A', 'B'])
    expect(boardLanes({ lane_column: 'stage' }, columns)).toEqual(['Lead', 'Won', 'Lost'])
    expect(boardLanes({ lane_column: 'missing' }, columns)).toEqual([])
  })
})
