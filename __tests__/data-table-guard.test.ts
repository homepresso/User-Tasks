import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetMemoryCacheForTests } from '@/lib/providers/cache/memory'
import { cachedTableTotal, forgetTableTotal, GRID_BUSY_MESSAGE, GRID_TIMEOUT_MESSAGE, gridGuardStateForTests, rememberTableTotal, withGridGuard } from '@/lib/services/data-table-guard'
import { queryFilteredRowsExact } from '@/lib/services/data-table-grouping'
import { apiError } from '@/lib/api/route'

// Large-table grid protection (QA perf Phase B): ~10-20 concurrent full-table
// grid queries used all of Postgres' CPU and its connections. Caps: 4 per
// instance, 2 per workspace (queue briefly, then 429 busy); per-query time
// cap with a clear message; short-lived exact totals.
const env = { ...process.env }
afterEach(() => { process.env = { ...env }; resetMemoryCacheForTests() })

const slow = (ms: number, value = 'ok') => () => new Promise<string>((r) => setTimeout(() => r(value), ms))

describe('grid query concurrency cap', () => {
  it('runs at most 2 per workspace at once and at most 4 per instance', async () => {
    process.env.DATA_GRID_QUEUE_MS = '5000'
    let inA = 0, maxA = 0, maxAll = 0
    const job = (ws: string) => withGridGuard(ws, async () => {
      if (ws === 'A') { inA++; maxA = Math.max(maxA, inA) }
      maxAll = Math.max(maxAll, gridGuardStateForTests().running)
      await new Promise((r) => setTimeout(r, 40))
      if (ws === 'A') inA--
      return ws
    })
    const results = await Promise.all([...Array(6)].map(() => job('A')).concat([...Array(6)].map((_, i) => job(`W${i}`))))
    expect(results).toHaveLength(12)
    expect(maxA).toBe(2)
    expect(maxAll).toBeLessThanOrEqual(4)
    expect(gridGuardStateForTests().running).toBe(0)
  })

  it('answers 429 busy (with a retry hint) when no slot frees within the queue time, and frees slots after errors', async () => {
    process.env.DATA_GRID_QUEUE_MS = '100'
    const long = [withGridGuard('B', slow(400)), withGridGuard('B', slow(400))]
    await new Promise((r) => setTimeout(r, 30)) // both hold their slots
    await expect(withGridGuard('B', slow(1))).rejects.toMatchObject({ status: 429, message: GRID_BUSY_MESSAGE, details: { reason: 'busy' } })
    await Promise.all(long)
    await expect(withGridGuard('B', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await expect(withGridGuard('B', slow(1, 'after'))).resolves.toBe('after')
    const res = apiError(GRID_BUSY_MESSAGE, 429, 'rate_limited', { reason: 'busy', retry_after: 2 })
    expect(res.status).toBe(429)
    expect(res.headers.get('Retry-After')).toBe('2')
  })
})

describe('grid query time cap', () => {
  it('sends p_timeout_ms and turns a timeout into a clear 503, never a 500', async () => {
    process.env.DATA_GRID_QUERY_TIMEOUT_MS = '5000'
    const rpc = vi.fn(async () => ({ data: null, error: { code: '57014', message: 'data_table_grid_timeout' } }))
    await expect(queryFilteredRowsExact({ rpc } as any, 't1', { limit: 10, offset: 0, workspace: 'ws' })).rejects.toMatchObject({ status: 503, message: GRID_TIMEOUT_MESSAGE })
    expect(rpc).toHaveBeenCalledWith('data_table_rows_page', expect.objectContaining({ p_timeout_ms: 5000 }))
  })

  it('works before migration 20270131140000 (retries without p_timeout_ms)', async () => {
    const rpc = vi.fn(async (_fn: string, args: any) => 'p_timeout_ms' in args
      ? { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
      : { data: [{ id: 'r1', data: {}, _total: 3 }], error: null })
    await expect(queryFilteredRowsExact({ rpc } as any, 't1', { limit: 10, offset: 0 })).resolves.toEqual({ rows: [{ id: 'r1', data: {} }], total: 3, truncated: false })
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})

describe('cached exact totals', () => {
  it('keeps totals of large tables only, and forgets them on write', async () => {
    process.env.DATA_GRID_TOTAL_CACHE_MIN_ROWS = '10000'
    await rememberTableTotal('ws:small', 500)
    await rememberTableTotal('ws:big', 200_000)
    expect(await cachedTableTotal('ws:small')).toBeNull()
    expect(await cachedTableTotal('ws:big')).toBe(200_000)
    await forgetTableTotal('ws:big')
    expect(await cachedTableTotal('ws:big')).toBeNull()
  })
})
