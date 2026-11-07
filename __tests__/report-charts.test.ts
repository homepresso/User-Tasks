import { describe, expect, it } from 'vitest'

import {
  MAX_REPORT_CHARTS, aggregateReportChart, bucketKey, describeReportChart, measureValue, normalizeReportCharts,
  reportChartIssues, validTimeZone, validateReportChart, windowStart, type ReportChartSpec,
} from '@/lib/report-charts'
import { normalizeReportConfig } from '@/lib/report-config'

const count = { fn: 'count' as const }
const chart = (over: Partial<ReportChartSpec>): ReportChartSpec => ({ id: 'c', title: 'C', type: 'column', measure: count, ...over } as ReportChartSpec)

describe('report config: summary charts normalisation', () => {
  it('leaves configs without charts exactly as they were (back-compat)', () => {
    const raw = { data_source: 'tasks', columns: ['id'], filters: [], visualization: 'table' }
    expect(normalizeReportConfig(raw)).toEqual(raw)
    expect('charts' in normalizeReportConfig(raw)).toBe(false)
  })

  it('drops an empty or non-array charts key', () => {
    expect('charts' in normalizeReportConfig({ data_source: 'tasks', charts: [] })).toBe(false)
    expect('charts' in normalizeReportConfig({ data_source: 'tasks', charts: 'nope' })).toBe(false)
  })

  it('keeps valid charts, drops invalid ones, caps at 8, fills and dedupes ids', () => {
    const valid = { id: 'a', title: 'Total', type: 'number', measure: { fn: 'count' } }
    const charts = normalizeReportConfig({
      data_source: 'tasks',
      charts: [
        valid,
        { ...valid }, // duplicate id → a_2
        { title: 'No id', type: 'number' }, // id filled, measure defaults to count
        { id: 'bad', title: 'Line without bucket', type: 'line', dimension: { field: 'status' } },
        { id: 'bad2', title: 'Avg without field', type: 'number', measure: { fn: 'avg' } },
        { id: 'bad3', type: 'number' }, // no title
        ...Array.from({ length: 10 }, (_, i) => ({ ...valid, id: `x${i}` })),
      ],
    }).charts!
    expect(charts).toHaveLength(MAX_REPORT_CHARTS)
    expect(charts.map((c) => c.id).slice(0, 3)).toEqual(['a', 'a_2', 'chart_3'])
    expect(charts[2].measure).toEqual({ fn: 'count' })
    expect(charts.some((c) => c.id.startsWith('bad'))).toBe(false)
  })

  it('validates in plain words and against the report columns', () => {
    expect(validateReportChart(chart({ type: 'line', dimension: { field: 'created_at' } }))).toContain('Line and area charts need a date column split by time')
    expect(validateReportChart(chart({ type: 'column' }))).toContain('Choose what the chart splits by')
    expect(validateReportChart(chart({ type: 'number', measure: { fn: 'sum' } }))).toContain('Total needs a numeric column')
    expect(validateReportChart(chart({ dimension: { field: 'nope' } }), ['created_at'])).toEqual(['Unknown column "nope"'])
    expect(validateReportChart(chart({ dimension: { field: 'created_at', bucket: 'day' } }), ['created_at'])).toEqual([])
    expect(reportChartIssues(Array.from({ length: 9 }, () => ({ id: 'a', title: 'T', type: 'number' })))[0]).toMatch(/at most 8 charts/)
    expect(reportChartIssues([{ title: 'Bad', type: 'pie' }])).toEqual(['Chart 1 ("Bad"): Choose what the chart splits by'])
    expect(reportChartIssues(undefined)).toEqual([])
  })

  it('describes charts in plain language', () => {
    const label = (k: string) => ({ created_at: 'Created', data_score: 'Score', data_status: 'Status' }[k] ?? k)
    expect(describeReportChart(chart({ dimension: { field: 'created_at', bucket: 'day' }, range_days: 30 }), label, 'responses')).toBe('Count of responses by day (Created), last 30 days')
    expect(describeReportChart(chart({ type: 'bar', measure: { fn: 'avg', field: 'data_score' }, dimension: { field: 'data_status' } }), label)).toBe('Average of Score by Status')
    expect(describeReportChart(chart({ type: 'number' }), label, 'responses')).toBe('Count of responses')
  })
})

describe('report charts: time buckets and time zones', () => {
  // 2026-11-02 20:30 UTC = Tuesday 3 Nov 09:30 in Auckland (NZDT, +13).
  const instant = new Date('2026-11-02T20:30:00Z')

  it('buckets in UTC', () => {
    expect(bucketKey(instant, 'day', 'UTC')).toBe('2026-11-02')
    expect(bucketKey(instant, 'week', 'UTC')).toBe('2026-11-02') // a Monday
    expect(bucketKey(instant, 'month', 'UTC')).toBe('2026-11')
    expect(bucketKey(instant, 'day_of_week', 'UTC')).toBe('0') // Monday
    expect(bucketKey(instant, 'hour_of_day', 'UTC')).toBe('20')
  })

  it('buckets in the viewer time zone', () => {
    expect(bucketKey(instant, 'day', 'Pacific/Auckland')).toBe('2026-11-03')
    expect(bucketKey(instant, 'week', 'Pacific/Auckland')).toBe('2026-11-02')
    expect(bucketKey(instant, 'day_of_week', 'Pacific/Auckland')).toBe('1') // Tuesday
    expect(bucketKey(instant, 'hour_of_day', 'Pacific/Auckland')).toBe('9')
    // 31 Oct 12:00 UTC is already 1 November in Auckland.
    expect(bucketKey(new Date('2026-10-31T12:00:00Z'), 'month', 'Pacific/Auckland')).toBe('2026-11')
    expect(bucketKey(new Date('2026-10-31T12:00:00Z'), 'month', 'UTC')).toBe('2026-10')
    // A Sunday rolls back to its Monday.
    expect(bucketKey(new Date('2026-11-08T10:00:00Z'), 'week', 'UTC')).toBe('2026-11-02')
  })

  it('accepts only real zones (else UTC)', () => {
    expect(validTimeZone('Pacific/Auckland')).toBe('Pacific/Auckland')
    expect(validTimeZone('Mars/Olympus')).toBeNull()
    expect(validTimeZone('x; drop table')).toBeNull()
    const result = aggregateReportChart([{ t: instant.toISOString() }], chart({ dimension: { field: 't', bucket: 'hour_of_day' } }), { timezone: 'Not/AZone' })
    expect(result.timezone).toBe('UTC')
  })

  it('starts "last N days" at local midnight', () => {
    const now = new Date('2026-11-06T03:00:00Z') // 6 Nov 16:00 NZDT
    expect(windowStart(7, 'UTC', now)).toBe('2026-10-31T00:00:00.000Z')
    expect(windowStart(1, 'Pacific/Auckland', now)).toBe('2026-11-05T11:00:00.000Z') // 6 Nov 00:00 NZDT
    expect(windowStart(1, 'Asia/Kolkata', now)).toBe('2026-11-05T18:30:00.000Z') // half-hour offset
  })

  it('fills every day of the window, counting zero for empty days', () => {
    const now = new Date('2026-11-06T12:00:00Z')
    const rows = [
      { created_at: '2026-11-06T09:00:00Z' }, { created_at: '2026-11-06T10:00:00Z' },
      { created_at: '2026-11-03T09:00:00Z' },
      { created_at: '2026-10-01T09:00:00Z' }, // outside the window
    ]
    const r = aggregateReportChart(rows, chart({ type: 'area', dimension: { field: 'created_at', bucket: 'day' }, range_days: 7 }), { now })
    expect(r.points!.map((p) => p.key)).toEqual(['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'])
    expect(r.points!.map((p) => p.value)).toEqual([0, 0, 0, 1, 0, 0, 2])
    expect(r.points![6].label).toBe('6 Nov')
    expect(r.rows).toBe(3)
  })

  it('weekday and hour charts always show every bucket in order', () => {
    const rows = [{ t: '2026-11-02T20:30:00Z' }, { t: '2026-11-02T21:00:00Z' }]
    const dow = aggregateReportChart(rows, chart({ dimension: { field: 't', bucket: 'day_of_week' } }), { timezone: 'Pacific/Auckland' })
    expect(dow.points!.map((p) => p.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(dow.points![1].value).toBe(2)
    const hour = aggregateReportChart(rows, chart({ dimension: { field: 't', bucket: 'hour_of_day' } }), { timezone: 'Pacific/Auckland' })
    expect(hour.points).toHaveLength(24)
    expect(hour.points![9]).toEqual({ key: '9', label: '09:00', value: 1 })
    expect(hour.points![10].value).toBe(1)
  })

  it('months fill gaps between the first and last month', () => {
    const rows = [{ t: '2026-08-10T00:00:00Z' }, { t: '2026-10-10T00:00:00Z' }]
    const r = aggregateReportChart(rows, chart({ type: 'line', dimension: { field: 't', bucket: 'month' } }))
    expect(r.points!.map((p) => [p.label, p.value])).toEqual([['Aug 2026', 1], ['Sep 2026', 0], ['Oct 2026', 1]])
  })

  it('reads a bare date as that calendar day in every zone', () => {
    const r = aggregateReportChart([{ d: '2026-11-03' }], chart({ dimension: { field: 'd', bucket: 'day' } }), { timezone: 'Pacific/Honolulu' })
    expect(r.points!.map((p) => p.key)).toEqual(['2026-11-03'])
  })

  it('heatmap: 7 × 24 cells by day of week and hour', () => {
    const rows = [{ t: '2026-11-02T20:30:00Z' }, { t: '2026-11-02T20:45:00Z' }, { t: 'garbage' }]
    const r = aggregateReportChart(rows, chart({ type: 'heatmap', dimension: { field: 't' } }), { timezone: 'UTC' })
    expect(r.cells).toHaveLength(168)
    expect(r.cells!.find((c) => c.dow === 0 && c.hour === 20)!.value).toBe(2)
    expect(r.rows).toBe(2)
  })
})

describe('report charts: measures and categories', () => {
  const rows = [
    { s: 'Approved', n: '10' }, { s: 'Approved', n: 20 }, { s: 'Declined', n: '' }, { s: '', n: 'x' }, { s: null, n: 6 },
  ]

  it('count / sum / avg / min / max skip blanks and non-numbers', () => {
    const read = (r: any) => r.n
    expect(measureValue(rows, 'count', read)).toBe(5)
    expect(measureValue(rows, 'sum', read)).toBe(36)
    expect(measureValue(rows, 'avg', read)).toBe(12)
    expect(measureValue(rows, 'min', read)).toBe(6)
    expect(measureValue(rows, 'max', read)).toBe(20)
    expect(measureValue([{ n: '' }], 'avg', read)).toBeNull()
  })

  it('NPS: % promoters (9–10) − % detractors (0–6), as the survey stats', () => {
    const scores = [10, 9, 9, 8, 7, 6, 0, 3, 10, 10].map((n) => ({ n }))
    expect(measureValue(scores, 'nps', (r: any) => r.n)).toBe(20) // 5 promoters, 3 detractors of 10
    expect(measureValue([{ n: 11 }], 'nps', (r: any) => r.n)).toBeNull()
  })

  it('number cards over all rows, or the last N days of a date column', () => {
    const now = new Date('2026-11-06T12:00:00Z')
    const dated = [{ t: '2026-11-05T00:00:00Z', n: 4 }, { t: '2026-01-01T00:00:00Z', n: 8 }]
    expect(aggregateReportChart(dated, chart({ type: 'number', measure: { fn: 'avg', field: 'n' } })).value).toBe(6)
    expect(aggregateReportChart(dated, chart({ type: 'number', measure: { fn: 'avg', field: 'n' }, range_days: 7, window_field: 't' }), { now }).value).toBe(4)
  })

  it('categories: largest first, blanks grouped, fixed order with zeros, top N + Other', () => {
    const byStatus = aggregateReportChart(rows, chart({ type: 'donut', dimension: { field: 's' } }))
    expect(byStatus.points!.map((p) => [p.label, p.value])).toEqual([['(blank)', 2], ['Approved', 2], ['Declined', 1]])
    const fixed = aggregateReportChart(rows, chart({ type: 'donut', dimension: { field: 's' }, categories: ['Pending', 'Approved', 'Declined'] }))
    expect(fixed.points!.map((p) => [p.label, p.value])).toEqual([['Pending', 0], ['Approved', 2], ['Declined', 1], ['(blank)', 2]])
    const top = aggregateReportChart(rows, chart({ type: 'bar', dimension: { field: 's' }, top_n: 1 }))
    expect(top.points!.map((p) => [p.label, p.value])).toEqual([['(blank)', 2], ['Other', 3]])
    const avg = aggregateReportChart(rows, chart({ type: 'bar', dimension: { field: 's' }, measure: { fn: 'avg', field: 'n' }, sort: 'label' }))
    expect(avg.points!.map((p) => [p.label, p.value])).toEqual([['(blank)', 6], ['Approved', 15], ['Declined', null]])
  })

  it('label sort is numeric-aware (scores)', () => {
    const r = aggregateReportChart([{ v: 10 }, { v: 9 }, { v: 2 }], chart({ dimension: { field: 'v' }, sort: 'label' }))
    expect(r.points!.map((p) => p.label)).toEqual(['2', '9', '10'])
  })
})
