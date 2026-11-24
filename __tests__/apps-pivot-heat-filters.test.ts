import { describe, expect, it } from 'vitest'
import { WIDGET_CONFIG_SCHEMAS, normalisePageFilters } from '@/lib/apps/schema'
import { groupFacts } from '@/lib/services/app-widgets'

describe('pivot heat map, text filter choices', () => {
  it('pivot heat map and totals options', () => {
    expect(WIDGET_CONFIG_SCHEMAS.pivot.parse({ heat: true, totals: false })).toMatchObject({ heat: true, totals: false })
    expect(WIDGET_CONFIG_SCHEMAS.pivot.parse({}).heat).toBeUndefined()
  })
  it('text filters may list their choices', () => {
    const [filter] = normalisePageFilters([{ id: 'dept', kind: 'text', label: 'Department', options: ['Engineering', 'Sales'] }])
    expect(filter.options).toEqual(['Engineering', 'Sales'])
  })
  it('a line over a column keeps its groups in natural order', () => {
    const rows = [['Q3 2026', 9], ['Q1 2026', 5], ['Q2 2026', 7]].map(([q, v]) => ({ at: '2026-01-01', status: null, workflow: null, form: null, person: null, data: { q, v } }))
    expect(groupFacts(rows, { by: 'field', field: 'q', interval: 'day', how: 'sum', valueField: 'v', maxGroups: 8, byLabel: true }).map((p) => p.key)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026'])
    expect(groupFacts(rows, { by: 'field', field: 'q', interval: 'day', how: 'sum', valueField: 'v', maxGroups: 8 }).map((p) => p.key)).toEqual(['Q3 2026', 'Q2 2026', 'Q1 2026'])
  })
})
