import { describe, expect, it, vi } from 'vitest'

// A cache store that never answers (the database cache blocked behind a lock,
// a Redis that accepts and stalls): grid queries must still run, under the
// instance cap only, instead of waiting forever (0.4.1 CI: every grid read
// hung on a postgres cache store behind an open migration transaction).
const never = () => new Promise<never>(() => {})
vi.mock('@/lib/providers/cache', () => ({
  getCacheStore: async () => ({ id: 'postgres', setIfAbsent: never, get: never, set: never, delete: never }),
}))

import { cachedTableTotal, forgetTableTotal, rememberTableTotal, withGridGuard } from '@/lib/services/data-table-guard'

describe('grid guard with a cache store that does not answer', () => {
  it('runs the query after the slot wait, and the cached-total helpers give up quietly', async () => {
    vi.stubEnv('DATA_GRID_SLOT_WAIT_MS', '100')
    vi.stubEnv('DATA_GRID_QUEUE_MS', '5000')
    const t0 = Date.now()
    await expect(withGridGuard('ws', async () => 'ran')).resolves.toBe('ran')
    expect(await cachedTableTotal('t')).toBeNull()
    await rememberTableTotal('t', 1_000_000)
    await forgetTableTotal('t')
    expect(Date.now() - t0).toBeLessThan(2_000)
    vi.unstubAllEnvs()
  })
})
