/**
 * Data table widgets: a second column as a chart's series (`series_field`),
 * period-named column values read in time order, and the pivot's options.
 * (Row conditions: __tests__/apps-row-conditions.test.ts.)
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- stubbed rows */
import { describe, expect, it, vi } from 'vitest'

const ROWS = [
  { id: 'r1', created_at: '2026-11-01T00:00:00Z', data: { bu: 'Operations', fy: '2026', period: '2026-03', kind: 'Actual', amount: 100 } },
  { id: 'r2', created_at: '2026-11-01T00:00:00Z', data: { bu: 'Operations', fy: '2026', period: '2026-01', kind: 'Plan', amount: 300 } },
  { id: 'r3', created_at: '2026-11-01T00:00:00Z', data: { bu: 'Retail', fy: '2027', period: '2026-02', kind: 'Actual', amount: 50 } },
  { id: 'r4', created_at: '2026-11-01T00:00:00Z', data: { bu: 'Retail', fy: '2026', period: '2026-01', kind: 'Actual', amount: 20 } },
]

vi.mock('@/lib/services/data-tables', async (orig) => {
  const real: any = await orig()
  return { ...real, queryRows: vi.fn(async () => ({ rows: ROWS, total: ROWS.length, truncated: false })), getDataTable: vi.fn(async () => ({ id: 't', name: 'T', columns: [] })) }
})

import type { ServiceContext } from '@/lib/services/context'
import { arePeriodKeys, groupFacts, widgetData } from '@/lib/services/app-widgets'
import { WIDGET_CONFIG_SCHEMAS } from '@/lib/apps/schema'

const TABLE = '0d000000-0000-4000-8000-000000000001'
const ctx = { db: {}, supabase: {}, tenantId: 'tenant-a', actorId: '0a000000-0000-4000-8000-000000000001', permissions: new Set(['data.view']), authKind: 'session', source: 'ui' } as unknown as ServiceContext
const parse = (type: keyof typeof WIDGET_CONFIG_SCHEMAS, config: unknown) => WIDGET_CONFIG_SCHEMAS[type].parse(config) as any

describe('charts over two columns and periods', () => {
  it('period-named values read in time order; other values largest first', () => {
    expect(arePeriodKeys(['2026-03', '2026-01', '—'])).toBe(true)
    expect(arePeriodKeys(['FY2027-Q2', '2026-Q1', '2026'])).toBe(true)
    expect(arePeriodKeys(['Retail', '2026-01'])).toBe(false)
    const facts = ROWS.map((r) => ({ at: r.created_at, status: null, workflow: null, form: null, person: null, data: r.data }))
    expect(groupFacts(facts, { by: 'field', field: 'period', interval: 'month', how: 'sum', valueField: 'amount', maxGroups: 2 }).map((p) => p.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(groupFacts(facts, { by: 'field', field: 'bu', interval: 'month', how: 'sum', valueField: 'amount', maxGroups: 8 }).map((p) => p.key)).toEqual(['Operations', 'Retail'])
  })

  it('a stacked chart groups by one column and stacks by another (series_field)', async () => {
    const data: any = await widgetData(ctx, 'chart', parse('chart', { source: 'table_rows', table_id: TABLE, chart: 'stacked_bar', group_by: 'field', field: 'period', series_by: 'field', series_field: 'kind', aggregate: 'sum', value_field: 'amount' }))
    expect(data.series.map((s: any) => s.key).sort()).toEqual(['Actual', 'Plan'])
    expect(data.points.map((p: any) => [p.key, p.values])).toEqual([['2026-01', { Actual: 20, Plan: 300 }], ['2026-02', { Actual: 50, Plan: 0 }], ['2026-03', { Actual: 100, Plan: 0 }]])
    // Without series_field both dimensions are the same column: a plain chart, as before.
    const plain: any = await widgetData(ctx, 'chart', parse('chart', { source: 'table_rows', table_id: TABLE, chart: 'stacked_bar', group_by: 'field', field: 'period', series_by: 'field', aggregate: 'sum', value_field: 'amount' }))
    expect(plain.series).toBeUndefined()
  })

  it('a pivot keeps period columns in order (heat and format are display options)', async () => {
    const data: any = await widgetData(ctx, 'pivot', parse('pivot', { source: 'table_rows', table_id: TABLE, rows: 'field', row_field: 'bu', columns: 'field', column_field: 'period', aggregate: 'sum', value_field: 'amount', heat: true, format: 'currency' }))
    expect(data.cols.map((c: any) => c.key)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(data.total).toBe(470)
  })
})
