import { describe, expect, it } from 'vitest'

import { executeReportCharts } from '@/lib/report-charts-server'
import type { ReportConfig } from '@/lib/report-sources'

/**
 * A minimal PostgREST stand-in for one data table: custom_tables (the
 * source lookup) and custom_table_rows (eq / neq / gte / lte / in on
 * columns and data->>key, order, limit, range). It records every rows read
 * so the tests can see how many reads (and pages) the charts took.
 */
function mockSupabase(rows: Array<{ id: string; created_at: string; data: Record<string, unknown> }>, maxRows = 1000) {
  const reads: Array<{ filters: string[]; range?: [number, number]; limit?: number }> = []
  const table = { id: 'tbl', name: 'Survey responses', tenant_id: 't1', columns: [{ key: 'status', name: 'Status', type: 'select' }, { key: 'score', name: 'Score', type: 'number' }] }
  const read = (row: any, col: string) => (col === 'table_id' ? 'tbl' : col.startsWith('data->>') ? row.data?.[col.slice(7)] : row[col])
  const from = (name: string) => {
    const preds: Array<(row: any) => boolean> = []
    const labels: string[] = []
    const orders: Array<{ col: string; asc: boolean }> = []
    let limit: number | undefined
    let range: [number, number] | undefined
    let single = false
    const q: any = {
      select: () => q,
      eq: (col: string, v: unknown) => { labels.push(`${col}=${v}`); preds.push((r) => String(read(r, col)) === String(v)); return q },
      neq: (col: string, v: unknown) => { labels.push(`${col}!=${v}`); preds.push((r) => String(read(r, col)) !== String(v)); return q },
      gte: (col: string, v: string) => { labels.push(`${col}>=${v}`); preds.push((r) => String(read(r, col) ?? '') >= v); return q },
      lte: (col: string, v: string) => { labels.push(`${col}<=${v}`); preds.push((r) => String(read(r, col) ?? '') <= v); return q },
      in: (col: string, vs: unknown[]) => { labels.push(`${col} in`); preds.push((r) => vs.map(String).includes(String(read(r, col)))); return q },
      is: () => q,
      not: () => q,
      order: (col: string, o: { ascending: boolean }) => { orders.push({ col, asc: o.ascending }); return q },
      limit: (n: number) => { limit = n; return q },
      range: (a: number, b: number) => { range = [a, b]; return q },
      single: () => { single = true; return q },
      maybeSingle: () => { single = true; return q },
      then: (resolve: any, reject: any) => {
        try {
          if (name === 'custom_tables') return resolve({ data: single ? table : [table], error: null })
          let out = rows.filter((r) => preds.every((p) => p(r)))
          out = [...out].sort((a: any, b: any) => {
            for (const o of orders) {
              const av = read(a, o.col); const bv = read(b, o.col)
              if (av === bv) continue
              return (av > bv ? 1 : -1) * (o.asc ? 1 : -1)
            }
            return 0
          })
          reads.push({ filters: [...labels], range, limit })
          const start = range ? range[0] : 0
          const size = Math.min(range ? range[1] - range[0] + 1 : (limit ?? maxRows), maxRows)
          return resolve({ data: out.slice(start, start + size), error: null })
        } catch (e) { return reject(e) }
      },
    }
    return q
  }
  return { client: { from }, reads }
}

const rows = [
  { id: 'r1', created_at: '2026-11-02T20:30:00Z', data: { status: 'Approved', score: 8 } }, // Tue 09:30 NZDT
  { id: 'r2', created_at: '2026-11-03T01:00:00Z', data: { status: 'Approved', score: 6 } }, // Tue 14:00 NZDT
  { id: 'r3', created_at: '2026-11-05T22:00:00Z', data: { status: 'Declined', score: 2 } }, // Fri 11:00 NZDT
  { id: 'r4', created_at: '2026-09-01T00:00:00Z', data: { status: 'Pending', score: 10 } }, // old
]

const base: Partial<ReportConfig> = {
  data_source: 'custom_table_tbl', columns: ['created_at', 'data_status'], filters: [], visualization: 'table', row_limit: 1,
}
const now = new Date('2026-11-06T03:00:00Z') // Fri 6 Nov 16:00 NZDT

describe('report summary charts on the server', () => {
  it('returns nothing (and reads nothing) without charts', async () => {
    const { client, reads } = mockSupabase(rows)
    expect(await executeReportCharts(client, 't1', base)).toEqual([])
    expect(reads).toHaveLength(0)
  })

  it('aggregates every chart from the report rows, ignoring the report row limit, in the viewer zone', async () => {
    const { client, reads } = mockSupabase(rows)
    const results = await executeReportCharts(client, 't1', {
      ...base,
      charts: [
        { id: 'total', title: 'Total', type: 'number', measure: { fn: 'count' } },
        { id: 'dow', title: 'By weekday', type: 'column', dimension: { field: 'created_at', bucket: 'day_of_week' }, measure: { fn: 'count' } },
        { id: 'status', title: 'By status', type: 'donut', dimension: { field: 'data_status' }, measure: { fn: 'count' } },
        { id: 'avg', title: 'Average score', type: 'number', measure: { fn: 'avg', field: 'data_score' } },
        { id: 'week', title: 'Last 7 days', type: 'area', dimension: { field: 'created_at', bucket: 'day' }, measure: { fn: 'count' }, range_days: 7 },
      ],
    }, { timezone: 'Pacific/Auckland', now, permissions: ['reports.view', 'data.view'] })

    const byId = Object.fromEntries(results.map((r) => [r.id, r]))
    expect(results.map((r) => r.id)).toEqual(['total', 'dow', 'status', 'avg', 'week'])
    expect(byId.total.value).toBe(4)
    expect(byId.avg.value).toBe(6.5)
    expect(byId.dow.points!.map((p) => p.value)).toEqual([0, 3, 0, 0, 1, 0, 0]) // 1 Sep 00:00 UTC is a Tuesday noon in NZ too
    expect(byId.status.points!.map((p) => [p.label, p.value])).toEqual([['Approved', 2], ['Declined', 1], ['Pending', 1]])
    expect(byId.week.points!.map((p) => p.value)).toEqual([0, 0, 0, 2, 0, 0, 1]) // 31 Oct … 6 Nov NZ
    expect(byId.week.timezone).toBe('Pacific/Auckland')
    // Charts with the same filters share one read; the 7-day window is its own (filtered on the server).
    expect(reads).toHaveLength(2)
    expect(reads.some((r) => r.filters.some((f) => f.startsWith('created_at>=2026-10-30T11:00:00.000Z')))).toBe(true)
  })

  it('applies the report filters and the chart own filters', async () => {
    const { client } = mockSupabase(rows)
    const [onlyApproved, approvedHigh] = await executeReportCharts(client, 't1', {
      ...base,
      filters: [{ field: 'data_status', operator: 'eq', value: 'Approved' }],
      charts: [
        { id: 'a', title: 'A', type: 'number', measure: { fn: 'count' } },
        { id: 'b', title: 'B', type: 'number', measure: { fn: 'count' }, filters: [{ field: 'data_score', operator: 'gte', value: '7' }] },
      ],
    }, { now })
    expect(onlyApproved.value).toBe(2)
    expect(approvedHigh.value).toBe(1)
  })

  it('enforces the source permission (data tables need data.view) on every chart', async () => {
    const { client, reads } = mockSupabase(rows)
    const results = await executeReportCharts(client, 't1', { ...base, charts: [{ id: 'a', title: 'A', type: 'number', measure: { fn: 'count' } }] }, { permissions: ['reports.view'] })
    expect(results[0].error).toMatch(/needs the 'data.view' permission/)
    expect(results[0].value).toBeUndefined()
    expect(reads).toHaveLength(0)
  })

  it("honours an API key's data table scope", async () => {
    const { client } = mockSupabase(rows)
    const results = await executeReportCharts(client, 't1', { ...base, charts: [{ id: 'a', title: 'A', type: 'number', measure: { fn: 'count' } }] }, { scopedTableIds: ['other-table'] })
    expect(results[0].error).toMatch(/not allowed to access that table/)
  })

  it('pages past the 1000-row PostgREST cap and flags a truncated read', async () => {
    const many = Array.from({ length: 2600 }, (_, i) => ({ id: `r${String(i).padStart(5, '0')}`, created_at: new Date(Date.UTC(2026, 10, 1) + i * 60_000).toISOString(), data: { status: 'A' } }))
    const { client, reads } = mockSupabase(many)
    const [all] = await executeReportCharts(client, 't1', { ...base, charts: [{ id: 'a', title: 'A', type: 'number', measure: { fn: 'count' } }] })
    expect(all.value).toBe(2600)
    expect(all.truncated).toBe(false)
    expect(reads.filter((r) => r.range).length).toBe(3)

    const capped = mockSupabase(many)
    const [part] = await executeReportCharts(capped.client, 't1', { ...base, charts: [{ id: 'a', title: 'A', type: 'number', measure: { fn: 'count' } }] }, { rowCap: 1500 })
    expect(part.value).toBe(1500)
    expect(part.truncated).toBe(true)
  })
})
