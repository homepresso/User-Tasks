import { describe, expect, it } from 'vitest'
import { WIDGET_CONFIG_SCHEMAS } from '@/lib/apps/schema'
import { boundFilters, resolveBindings, rowDate, rowFiltersOf } from '@/lib/apps/widgets'

const TABLE = '0b1e6a52-1c0f-4c8e-9a51-5d1f0c2b7e10'

describe('data table row conditions (where) and date columns', () => {
  it('accepts where and date_field on table_rows charts, metrics and data widgets', () => {
    const where = [{ column: 'stage', op: 'not_equals', value: 'Closed lost' }, { column: 'region', value: { filter: 'region' } }]
    for (const type of ['metric', 'kpi', 'goal', 'gauge', 'chart', 'pivot'] as const) {
      const parsed = WIDGET_CONFIG_SCHEMAS[type].safeParse({ source: 'table_rows', table_id: TABLE, where, date_field: 'close_date' })
      expect(parsed.success, type).toBe(true)
    }
    for (const type of ['data_grid', 'card_view', 'filtered_list', 'table_view'] as const) {
      expect(WIDGET_CONFIG_SCHEMAS[type].safeParse({ table_id: TABLE, where }).success, type).toBe(true)
    }
    // Unknown operators and over-long lists are refused.
    expect(WIDGET_CONFIG_SCHEMAS.chart.safeParse({ where: [{ column: 'a', op: 'like', value: 'x' }] }).success).toBe(false)
    expect(WIDGET_CONFIG_SCHEMAS.chart.safeParse({ where: Array.from({ length: 11 }, () => ({ column: 'a', value: 'x' })) }).success).toBe(false)
  })

  it('binds condition values to page filters, parameters and system values; empty values skip the condition', () => {
    const config = WIDGET_CONFIG_SCHEMAS.chart.parse({
      source: 'table_rows', table_id: TABLE, group_by: 'field', field: 'stage',
      where: [{ column: 'region', value: { filter: 'region' } }, { column: 'owner', value: { filter: 'sys.user.name' } }, { column: 'stage', op: 'not_equals', value: 'Closed lost' }],
    })
    expect(boundFilters(config as Record<string, unknown>).sort()).toEqual(['region', 'sys.user.name'])
    const resolved = resolveBindings('chart', config, { region: 'West', 'sys.user.name': '' })
    expect(resolved.where).toEqual([{ column: 'region', op: 'equals', value: 'West' }, { column: 'owner', op: 'equals', value: null }, { column: 'stage', op: 'not_equals', value: 'Closed lost' }])
    expect(rowFiltersOf(resolved.where)).toEqual([{ field: 'region', operator: 'equals', value: 'West' }, { field: 'stage', operator: 'not_equals', value: 'Closed lost' }])
    // A date range in a text condition does not fit: the condition is skipped, the rest of the config stays.
    const odd = resolveBindings('chart', config, { region: { preset: '30d' } })
    expect(odd.field).toBe('stage')
    expect(rowFiltersOf(odd.where)).toEqual([{ field: 'stage', operator: 'not_equals', value: 'Closed lost' }])
    expect(rowFiltersOf([{ column: 'notes', op: 'is_empty' }, { column: 'amount', op: 'gt', value: 0 }])).toEqual([{ field: 'notes', operator: 'is_empty' }, { field: 'amount', operator: 'gt', value: '0' }])
    expect(rowFiltersOf(null)).toEqual([])
  })

  it('counts a row on its date column when it has one, else when it was created', () => {
    const row = { created_at: '2026-11-20T10:00:00Z', data: { close_date: '2026-07-14', bad: 'soon' } }
    expect(rowDate(row, 'close_date')).toBe('2026-07-14')
    expect(rowDate(row, 'bad')).toBe('2026-11-20T10:00:00Z')
    expect(rowDate(row, null)).toBe('2026-11-20T10:00:00Z')
    expect(rowDate({ created_at: '2026-11-20T10:00:00Z', data: null }, 'close_date')).toBe('2026-11-20T10:00:00Z')
  })
})

describe('row filter comparisons', () => {
  it('compares numbers by value and ISO dates by date (gt / gte / lt / lte)', async () => {
    const { compareOrdered } = await import('@/lib/services/data-tables')
    expect(compareOrdered(12, '9', (d) => d > 0)).toBe(true)
    expect(compareOrdered('2026-12-03', '2026-11-30', (d) => d > 0)).toBe(true)
    expect(compareOrdered('2026-11-30', '2026-11-30T23:59:00Z', (d) => d <= 0)).toBe(true)
    expect(compareOrdered('2026-11-05', '2026-11-30', (d) => d >= 0)).toBe(false)
    expect(compareOrdered('soon', '2026-11-30', (d) => d < 0)).toBe(false)
    expect(compareOrdered(undefined, 3, (d) => d < 0)).toBe(false)
  })
})

describe('chart groups in choice order', () => {
  it('orders field groups by the column’s choices (a funnel in stage order), unknown values last', async () => {
    const { orderByChoices } = await import('@/lib/services/app-widgets')
    const points = [{ key: 'Proposal', value: 9 }, { key: 'Other', value: 8 }, { key: 'Prospecting', value: 4 }, { key: 'Negotiation', value: 7 }]
    expect(orderByChoices(points, ['Prospecting', 'Qualification', 'Proposal', 'Negotiation']).map((p) => p.key)).toEqual(['Prospecting', 'Proposal', 'Negotiation', 'Other'])
  })
})

describe('headline currency', () => {
  it('shows millions compact, whole units from 1,000 and cents below', async () => {
    const { formatCurrencyHeadline } = await import('@/lib/format/number')
    expect(formatCurrencyHeadline(4439382, 'USD', { locale: 'en-US' })).toBe('$4.44M')
    expect(formatCurrencyHeadline(73989.7, 'USD', { locale: 'en-US' })).toBe('$73,990')
    expect(formatCurrencyHeadline(42.5, 'USD', { locale: 'en-US' })).toBe('$42.50')
    expect(formatCurrencyHeadline(null, 'USD')).toBe('—')
  })
})
