import { describe, expect, it } from 'vitest'

import {
  getDerivedReportColumnKeys,
  normalizeReportConfig,
} from '@/lib/report-config'

describe('report config normalization', () => {
  it('normalizes legacy scaffold aliases into report config fields', () => {
    const config = normalizeReportConfig({
      source: 'workflow_runs',
      chart_type: 'bar',
      groupBy: ['status'],
      rowLimit: 250,
      chartStyle: { chart_title: 'Runs by Status' },
      drillTarget: { href_template: '/automations/runs/{id}' },
      dateRange: { field: 'created_at', preset: 'last_30_days' },
      sorting: { field: 'COUNT_id', direction: 'desc' },
    })

    expect(config.data_source).toBe('workflow_runs')
    expect(config.visualization).toBe('bar')
    expect(config.group_by).toEqual(['status'])
    expect(config.row_limit).toBe(250)
    expect(config.chart_style).toEqual({ chart_title: 'Runs by Status' })
    expect(config.drill_target).toEqual({ href_template: '/automations/runs/{id}' })
    expect(config.date_range).toEqual({ field: 'created_at', preset: 'last_30_days' })
    expect(config.sort).toEqual({ field: 'COUNT_id', direction: 'desc' })
  })

  it('rewrites legacy source-prefixed _count references to the derived COUNT alias when available', () => {
    const config = normalizeReportConfig({
      data_source: 'workflow_runs',
      columns: ['status', 'workflow_runs._count'],
      filters: [{ field: 'workflow_runs._count', operator: 'gte', value: 2 }],
      sort: { field: 'workflow_runs._count', direction: 'desc' },
      group_by: ['status'],
      aggregations: [{ fn: 'COUNT', field: 'id' }],
    })

    expect(config.columns).toEqual(['status', 'COUNT_id'])
    expect(config.filters?.[0]?.field).toBe('COUNT_id')
    expect(config.sort?.field).toBe('COUNT_id')
    expect(getDerivedReportColumnKeys(config)).toEqual(new Set(['COUNT_id', '_count']))
  })

  it('falls back to _count when no explicit COUNT aggregation alias exists', () => {
    const config = normalizeReportConfig({
      data_source: 'workflow_runs',
      columns: ['workflow_runs._count'],
      group_by: ['status'],
      aggregations: [{ fn: 'SUM', field: 'duration_ms' }],
    })

    expect(config.columns).toEqual(['_count'])
    expect(getDerivedReportColumnKeys(config)).toEqual(new Set(['SUM_duration_ms', '_count']))
  })

  it('keeps canonical configs stable once they are normalized', () => {
    const canonical = normalizeReportConfig({
      data_source: 'workflow_runs',
      columns: ['COUNT_id'],
      group_by: ['status'],
      aggregations: [{ fn: 'COUNT', field: 'id' }],
    })

    expect(normalizeReportConfig(canonical)).toEqual(canonical)
  })
})
