import { describe, expect, it } from 'vitest'
import { AGGREGATE_ROW_CAP, serverRowCap } from '@/lib/services/app-widgets'

// Widgets report `truncated` as rows.length >= AGGREGATE_ROW_CAP. With a cap
// above the server's max_rows (1,000) that can never be true: counts were cut
// silently. The cap follows the server's.
describe('AGGREGATE_ROW_CAP follows the server row cap', () => {
  it('is at most the default PostgREST max_rows (1,000)', () => {
    if (process.env.DB_MAX_ROWS === undefined || process.env.DB_MAX_ROWS === '') expect(AGGREGATE_ROW_CAP).toBe(1000)
    expect(AGGREGATE_ROW_CAP).toBeLessThanOrEqual(5000)
  })
  it('reads DB_MAX_ROWS (0 = no cap)', () => {
    expect(serverRowCap({})).toBe(1000)
    expect(serverRowCap({ DB_MAX_ROWS: '2500' })).toBe(2500)
    expect(serverRowCap({ DB_MAX_ROWS: '0' })).toBe(Number.POSITIVE_INFINITY)
    expect(Math.min(5000, serverRowCap({ DB_MAX_ROWS: '0' }))).toBe(5000)
  })
})
