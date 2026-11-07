/**
 * Summary charts UI, rendered statically: the viewer's chart grid (number
 * cards, chart cards, heatmap, loading / error / empty states, the time zone
 * note) and the builder's Charts panel (plain-language rows, validation,
 * presets). Static markup has no layout, so the recharts plots themselves
 * are not drawn here — the browser check covers those.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { ReportSummaryCharts, formatChartValue } from '@/components/reports/report-summary-charts'
import { ReportChartsEditor, chartPresets, validCharts } from '@/components/reports/report-charts-editor'
import type { ReportChartResult, ReportChartSpec } from '@/lib/report-charts'

const specs: ReportChartSpec[] = [
  { id: 'total', title: 'Total responses', type: 'number', measure: { fn: 'count' } },
  { id: 'nps', title: 'Recommend: NPS', type: 'number', measure: { fn: 'nps', field: 'data_nps' } },
  { id: 'over_time', title: 'Responses over time', type: 'area', dimension: { field: 'created_at', bucket: 'day' }, measure: { fn: 'count' }, range_days: 90 },
  { id: 'status', title: 'By status', type: 'donut', dimension: { field: 'data_status' }, measure: { fn: 'count' } },
  { id: 'when', title: 'When', type: 'heatmap', dimension: { field: 'created_at' }, measure: { fn: 'count' } },
  { id: 'broken', title: 'Broken', type: 'column', dimension: { field: 'x' }, measure: { fn: 'count' } },
]
const base = { rows: 3, truncated: false, timezone: 'Pacific/Auckland' }
const results: ReportChartResult[] = [
  { id: 'total', type: 'number', title: 'Total responses', value: 1234, ...base },
  { id: 'nps', type: 'number', title: 'Recommend: NPS', value: 42, ...base },
  { id: 'over_time', type: 'area', title: 'Responses over time', points: [{ key: '2026-11-05', label: '5 Nov', value: 1 }, { key: '2026-11-06', label: '6 Nov', value: 2 }], ...base },
  { id: 'status', type: 'donut', title: 'By status', points: [{ key: 'Approved', label: 'Approved', value: 2 }, { key: 'Pending', label: 'Pending', value: 1 }], ...base },
  { id: 'when', type: 'heatmap', title: 'When', cells: Array.from({ length: 168 }, (_, i) => ({ dow: Math.floor(i / 24), hour: i % 24, value: i === 33 ? 3 : 0 })), ...base },
  { id: 'broken', type: 'column', title: 'Broken', rows: 0, truncated: false, timezone: 'Pacific/Auckland', error: "The custom_table_x source needs the 'data.view' permission" },
]

describe('report summary charts: viewer grid', () => {
  it('renders number cards, chart cards, the heatmap and errors', () => {
    const html = renderToStaticMarkup(createElement(ReportSummaryCharts, { specs, results }))
    expect(html).toContain('data-report-summary-charts')
    expect(html).toMatch(/data-chart-value[^>]*>1,234</)
    expect(html).toMatch(/data-chart-value[^>]*>\+42</) // NPS keeps its sign
    for (const title of ['Responses over time', 'By status', 'When']) expect(html).toContain(title)
    expect(html).toContain('Last 90 days')
    // Donut legend: label, value and share.
    expect(html).toContain('Approved')
    expect(html).toContain('67%')
    // Heatmap: 168 focusable cells with their values.
    expect(html.match(/role="gridcell"/g)).toHaveLength(168)
    expect(html).toContain('Tue 09:00 — 3')
    expect(html).toContain("Couldn&#x27;t draw this chart")
    expect(html).toContain('Times are in Pacific/Auckland.')
    // Time series and heatmaps span the grid.
    expect(html.match(/md:col-span-2/g)).toHaveLength(2)
  })

  it('shows loading placeholders before the series arrive', () => {
    const html = renderToStaticMarkup(createElement(ReportSummaryCharts, { specs, results: null, loading: true }))
    expect(html).toContain('aria-busy="true"')
    expect(html).not.toContain('data-chart-value')
  })

  it('an empty result says there is nothing to chart; a truncated read says so', () => {
    const html = renderToStaticMarkup(createElement(ReportSummaryCharts, {
      specs: [specs[3]],
      results: [{ id: 'status', type: 'donut', title: 'By status', points: [], rows: 0, truncated: true, timezone: 'UTC' }],
    }))
    expect(html).toContain('Nothing to chart yet')
    expect(html).toContain('newest 10,000 rows')
  })

  it('renders nothing without charts', () => {
    expect(renderToStaticMarkup(createElement(ReportSummaryCharts, { specs: [] }))).toBe('')
  })

  it('formats values', () => {
    expect(formatChartValue(null)).toBe('—')
    expect(formatChartValue(-12, 'nps')).toBe('-12')
    expect(formatChartValue(3.14159)).toBe('3.14')
  })
})

describe('report builder: Charts panel', () => {
  const columns = [
    { key: 'id', label: 'Row ID', type: 'text' },
    { key: 'created_at', label: 'Created', type: 'date' },
    { key: 'data_status', label: 'Status', type: 'text' },
    { key: 'data_score', label: 'Score', type: 'number' },
  ]

  it('lists charts in plain words and flags invalid ones', () => {
    const charts: ReportChartSpec[] = [
      { id: 'a', title: 'Over time', type: 'line', dimension: { field: 'created_at', bucket: 'week' }, measure: { fn: 'count' } },
      { id: 'b', title: 'Avg score', type: 'bar', dimension: { field: 'data_status' }, measure: { fn: 'avg', field: 'data_score' } },
      { id: 'c', title: 'Gone', type: 'column', dimension: { field: 'data_removed' }, measure: { fn: 'count' } },
    ]
    const html = renderToStaticMarkup(createElement(ReportChartsEditor, { charts, onChange: () => {}, columns, noun: 'responses' }))
    expect(html).toContain('Count of responses by week (Created)')
    expect(html).toContain('Average of Score by Status')
    expect(html).toContain('Unknown column &quot;data_removed&quot;')
    expect(html).toContain('Add chart')
    expect(validCharts(charts, columns.map((c) => c.key)).map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('offers presets from the report columns, all valid', () => {
    const presets = chartPresets(columns, 'responses')
    expect(presets.map((p) => p.label)).toEqual([
      'Total responses', 'Count of responses by day', 'Count of responses by day of the week', 'Count of responses by hour of the day',
      'Day × hour heatmap', 'Count of responses by Status', 'Average of Score',
    ])
    const charts = presets.map((p, i) => ({ ...p.chart, id: `p${i}` })) as ReportChartSpec[]
    expect(validCharts(charts, columns.map((c) => c.key))).toHaveLength(presets.length)
  })

  it('disables Add chart at 8 charts', () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, title: 'T', type: 'number', measure: { fn: 'count' } })) as ReportChartSpec[]
    const html = renderToStaticMarkup(createElement(ReportChartsEditor, { charts: eight, onChange: () => {}, columns }))
    expect(html).toContain('8 charts at most')
  })
})
