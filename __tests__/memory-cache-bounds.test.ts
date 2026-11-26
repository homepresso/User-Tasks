import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryCacheStore, memoryHit, MEMORY_CACHE_LIMITS, resetMemoryCacheForTests } from '@/lib/providers/cache/memory'

// The default (memory) cache backs report-rollup values (up to 512 KB) and
// rate-limit buckets. It had no size cap, and once past 1,000 live entries
// every set / hit swept the whole map (20k sets over 5k live entries: 10.6 s).
describe('memory cache store bounds', () => {
  afterEach(() => resetMemoryCacheForTests())

  it('does not sweep on every write (20k sets over 5k live entries stay fast)', async () => {
    const s = createMemoryCacheStore()
    for (let i = 0; i < 5000; i++) await s.set(`k${i}`, 'x'.repeat(100), 60_000)
    const t = performance.now()
    for (let i = 0; i < 20_000; i++) await s.set(`n${i}`, 'v', 60_000)
    expect(performance.now() - t).toBeLessThan(3000)
  })

  it('is an LRU capped by entries and bytes', async () => {
    const s = createMemoryCacheStore()
    await s.set('keep', 'k', 60_000)
    for (let i = 0; i < MEMORY_CACHE_LIMITS.values + 50; i++) {
      if (i % 1000 === 0) await s.get('keep') // recently read: survives
      await s.set(`v${i}`, 'x', 60_000)
    }
    expect(await s.get('keep')).toBe('k')
    expect(await s.get('v0')).toBeNull()
    const big = 'y'.repeat(1024 * 1024)
    for (let i = 0; i < 100; i++) await s.set(`big${i}`, big, 60_000)
    expect(await s.get('big99')).toBe(big)
    expect(await s.get('big0')).toBeNull()
    expect(Number((await s.ping()).match(/\((\d+) entries\)/)![1])).toBeLessThanOrEqual(MEMORY_CACHE_LIMITS.values)
  })

  it('a flood of new rate-limit keys cannot evict a busy key\'s window', () => {
    const opts = { max: 3, windowMs: 60_000 }
    for (let i = 0; i < 3; i++) memoryHit('victim', opts)
    expect(memoryHit('victim', opts).ok).toBe(false)
    for (let i = 0; i < MEMORY_CACHE_LIMITS.buckets + 10; i++) {
      memoryHit(`flood${i}`, opts)
      if (i % 5000 === 0) memoryHit('victim', opts) // still active
    }
    expect(memoryHit('victim', opts).ok).toBe(false)
  })
})
