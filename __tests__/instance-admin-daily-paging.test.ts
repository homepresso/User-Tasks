import { describe, expect, it, vi } from 'vitest'

// instance_admin_daily_counts returns a row per day x workspace x status; one
// PostgREST response is cut at max_rows (1,000), which made the overview's
// 7-day totals silently low with ~200+ workspaces. dailyCounts now pages.
const rows = Array.from({ length: 2300 }, (_, i) => ({ day: '2026-11-20', tenant_id: `t${i}`, status: 'completed', n: 1, amount: null }))
const ranges: Array<[number, number]> = []
vi.mock('@/lib/services/instance-admin/access', () => ({
  instanceDb: () => ({
    rpc: () => {
      const b: any = { order: () => b, range: (from: number, to: number) => { ranges.push([from, to]); return Promise.resolve({ data: rows.slice(from, Math.min(to + 1, from + 1000)), error: null }) } }
      return b
    },
  }),
}))

describe('instance admin daily counts', () => {
  it('reads every grouped row, not the first 1,000', async () => {
    const { dailyCounts } = await import('@/lib/services/instance-admin/stats')
    const res = await dailyCounts('runs', new Date('2026-11-18'), new Date('2026-11-25'))
    expect(res.rows).toHaveLength(2300)
    expect(res.rows.reduce((s, r) => s + r.n, 0)).toBe(2300)
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
  })
})
