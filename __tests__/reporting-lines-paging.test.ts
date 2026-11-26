import { describe, expect, it } from 'vitest'
import { isInManagerChain, loadReportingIndex, loadReportingLines } from '@/lib/reporting-lines'
import { createMemorySupabase } from './fixtures/supabase-memory'

/** A memory client that, like PostgREST, never returns more than 1,000 rows per request. */
function capped(db: any, maxRows = 1000) {
  const from = db.from.bind(db)
  db.from = (table: string) => {
    const q: any = from(table)
    const then = q.then.bind(q)
    q.then = (resolve: any, reject: any) => then((res: any) => resolve(Array.isArray(res?.data) ? { ...res, data: res.data.slice(0, maxRows) } : res), reject)
    return q
  }
  return db
}

describe('reporting lines in workspaces over max_rows', () => {
  it('reads every active member (2,500) and finds a manager chain past row 1,000', async () => {
    const T = 'tenant-a'
    const pad = (i: number) => `u${String(i).padStart(5, '0')}`
    const rows = Array.from({ length: 2500 }, (_, i) => ({ tenant_id: T, user_id: pad(i), manager_user_id: i > 0 ? pad(i - 1) : null, is_active: true }))
    const db = capped(createMemorySupabase({ user_memberships: [...rows, { tenant_id: T, user_id: 'gone', manager_user_id: null, is_active: false }] }))
    const lines = await loadReportingLines(db, T)
    expect(lines).toHaveLength(2500)
    const index = await loadReportingIndex(db, T)
    expect(isInManagerChain(index, pad(2399), pad(2400))).toBe(true) // u02400 reports to u02399: unknown when only 1,000 rows were read
  })
})
