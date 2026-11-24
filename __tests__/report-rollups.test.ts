/**
 * Report rollups, without a database: histogram percentiles within the
 * documented tolerance, the shapes the services return (same as the live
 * RPCs), the per-query cache (keyed per tenant + viewer scope + query, TTL,
 * generation bump), the Settings → Query resolver (inheritance, fixed
 * real-time services, per-widget overrides only when allowed) and the
 * real-time fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HIST_RELATIVE_ERROR, bucketMidpointMs, histCount, histQuantile, mergeHists, msBucket } from '@/lib/report-rollups/hist'
import { bumpRollupGeneration, cachedAggregate, rollupCacheKey, rollupCacheTtlMs, setRollupCacheStoreForTests } from '@/lib/report-rollups/cache'
import { toDailyStats, toDurationStats, toRunStats, rollupsEnabled, type RunDayRow } from '@/lib/services/report-rollups'
import {
  DEFAULT_QUERY_SETTINGS, querySettingsFromTenantSettings, querySettingsSchema, queryTimings, readWithDataSource, resolveFromSettings,
} from '@/lib/reports/data-source'

function percentileCont(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

function histOf(values: number[]): number[] {
  const h: number[] = []
  for (const v of values) { const b = msBucket(v); while (h.length < b) h.push(0); h[b - 1]++ }
  return h
}

describe('histogram percentiles', () => {
  it('bucket midpoints are within 2^(1/8) of every value in the bucket', () => {
    for (const ms of [1, 1.5, 7, 100, 999, 12_345, 3_600_000, 86_400_000 * 30]) {
      const mid = bucketMidpointMs(msBucket(ms))
      expect(Math.max(mid / ms, ms / mid)).toBeLessThanOrEqual(1 + HIST_RELATIVE_ERROR + 1e-12)
    }
    expect(msBucket(0.4)).toBe(1)
    expect(bucketMidpointMs(1)).toBe(0)
  })

  it('p50 / p90 / p95 stay within the tolerance of percentile_cont on varied distributions', () => {
    let seed = 7
    const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const dists: Array<() => number> = [
      () => 1 + rand() * 1000, // uniform
      () => Math.exp(2 + rand() * 12), // log-uniform
      () => (rand() < 0.9 ? 50 + rand() * 50 : 1e6 + rand() * 1e6), // bimodal
      () => 3_600_000 * (1 + rand() * 48), // hours
    ]
    for (const dist of dists) {
      for (const n of [1, 2, 3, 10, 101, 2000]) {
        const values = Array.from({ length: n }, dist).sort((a, b) => a - b)
        const h = histOf(values)
        expect(histCount(h)).toBe(n)
        for (const q of [0.5, 0.9, 0.95]) {
          const exact = percentileCont(values, q)
          expect(Math.abs(histQuantile(h, q)! - exact) / exact).toBeLessThanOrEqual(HIST_RELATIVE_ERROR + 1e-9)
        }
      }
    }
  })

  it('merges element-wise and is empty-safe', () => {
    expect(mergeHists([1, 2], [0, 1, 3], undefined)).toEqual([1, 3, 3])
    expect(histQuantile([], 0.5)).toBeNull()
    expect(histQuantile(null, 0.5)).toBeNull()
  })
})

const row = (o: Partial<RunDayRow>): RunDayRow => ({
  workflow_id: 'w1', day: '2026-11-20', runs: 0, st_completed: 0, st_failed: 0, st_cancel_manual: 0, st_cancelled: 0, st_running: 0,
  st_waiting_for_event: 0, st_paused: 0, st_pending: 0, st_waiting: 0, done_n: 0, done_ms: 0, timed_n: 0, timed_ms: 0,
  node_visits: 0, edge_traversals: 0, last_started_at: null, last_completed_at: null, fin_n: 0, fin_on_time: 0, fin_late: 0, fin_no_due: 0, fin_ms: 0, ...o,
})

describe('shapes (same as the live RPCs)', () => {
  const rows = [
    row({ runs: 5, st_completed: 3, st_failed: 1, st_cancel_manual: 1, st_running: 1, done_n: 3, done_ms: 300, timed_n: 4, timed_ms: 400, node_visits: 9, edge_traversals: 4, last_started_at: '2026-11-20T10:00:00.000Z' }),
    row({ day: '2026-11-21', runs: 2, st_paused: 1, st_cancelled: 1, fin_n: 1 }),
    row({ workflow_id: 'w2', runs: 0, fin_n: 2 }), // completed-side only: not a daily-stats row
  ]
  it('daily stats: active = running + waiting_for_event + paused + pending, errors = failed', () => {
    expect(toDailyStats(rows)).toEqual([
      expect.objectContaining({ workflow_id: 'w1', day: '2026-11-20', runs: 5, active: 1, errors: 1, completed: 3, completed_ms: 300, timed: 4, timed_ms: 400, node_visits: 9 }),
      expect.objectContaining({ day: '2026-11-21', runs: 2, active: 1, errors: 0 }),
    ])
  })
  it('duration stats: per workflow + overall, avg exact, percentiles from histograms', () => {
    const stats = toDurationStats(rows, [{ key: 'w1', n: 3, hist: histOf([90, 100, 110]) }])
    expect(stats.find((s) => s.workflow_id === 'w1')).toMatchObject({ runs: 7, completed: 3, failed: 1, active: 2, avg_ms: 100 })
    expect(stats.find((s) => s.workflow_id === null)).toMatchObject({ runs: 7 })
    expect(Math.abs(stats[0].p50_ms! - 100) / 100).toBeLessThanOrEqual(HIST_RELATIVE_ERROR)
  })
  it('run stats: manual cancellations count as cancelled, per-day failed includes cancelled', () => {
    const s = toRunStats(['w1', 'w3'], rows, [], new Map([['w1', { running: 1, waiting: 2, queued: 3 }]]))
    expect(s.workflows[0]).toMatchObject({ workflow_id: 'w1', started: 7, completed: 3, failed: 0, cancelled: 2, running: 1, waiting: 2, queued: 3, avg_ms: 100 })
    expect(s.workflows[0].per_day).toEqual([
      { day: '2026-11-20', started: 5, completed: 3, failed: 1, avg_ms: 100 },
      { day: '2026-11-21', started: 2, completed: 0, failed: 1, avg_ms: null },
    ])
    expect(s.workflows[1]).toMatchObject({ workflow_id: 'w3', started: 0, per_day: [] })
    expect(s.total).toMatchObject({ started: 7, running: 1, queued: 3 })
  })
  it('REPORT_ROLLUPS=off disables the rollups', () => {
    expect(rollupsEnabled({ REPORT_ROLLUPS: 'off' })).toBe(false)
    expect(rollupsEnabled({})).toBe(true)
  })
})

describe('per-query cache', () => {
  let values: Map<string, { v: string; exp: number }>
  beforeEach(() => {
    values = new Map()
    setRollupCacheStoreForTests(async () => ({
      async get(k) { const e = values.get(k); return e && e.exp > Date.now() ? e.v : null },
      async set(k, v, ttl) { values.set(k, { v, exp: Date.now() + (ttl ?? 1e9) }) },
      async incr(k) { const n = Number(values.get(k)?.v ?? 0) + 1; values.set(k, { v: String(n), exp: Infinity }); return n },
    }))
  })
  afterEach(() => { setRollupCacheStoreForTests(null); vi.useRealTimers() })

  it('keys differ per tenant, scope and query', () => {
    const k = rollupCacheKey('t1', '0', 'runs:all', ['q', 1])
    expect(rollupCacheKey('t2', '0', 'runs:all', ['q', 1])).not.toBe(k)
    expect(rollupCacheKey('t1', '0', 'runs:wf:a', ['q', 1])).not.toBe(k)
    expect(rollupCacheKey('t1', '0', 'runs:all', ['q', 2])).not.toBe(k)
    expect(rollupCacheKey('t1', '1', 'runs:all', ['q', 1])).not.toBe(k)
  })

  it('never serves one scope another scope\'s value', async () => {
    const load = vi.fn(async () => 'all-runs')
    expect(await cachedAggregate('t1', 'runs:all', ['x'], load)).toBe('all-runs')
    expect(await cachedAggregate('t1', 'runs:all', ['x'], load)).toBe('all-runs')
    expect(load).toHaveBeenCalledTimes(1)
    expect(await cachedAggregate('t1', 'runs:wf:a', ['x'], async () => 'granted-only')).toBe('granted-only')
    expect(await cachedAggregate('t1', 'tasks:u:u1:t:', ['x'], async () => 'mine')).toBe('mine')
  })

  it('expires after the TTL; 0 turns it off; a generation bump drops a tenant\'s entries', async () => {
    let n = 0
    const load = async () => ++n
    expect(await cachedAggregate('t1', 's', ['q'], load, 50)).toBe(1)
    expect(await cachedAggregate('t1', 's', ['q'], load, 50)).toBe(1)
    await new Promise((r) => setTimeout(r, 70))
    expect(await cachedAggregate('t1', 's', ['q'], load, 50)).toBe(2)
    expect(await cachedAggregate('t1', 's', ['q'], load, 0)).toBe(3) // off: always loads
    expect(await cachedAggregate('t1', 's', ['q'], load, 10_000)).toBe(2) // the entry cached at 2 is still fresh
    await bumpRollupGeneration('t1')
    expect(await cachedAggregate('t1', 's', ['q'], load, 10_000)).toBe(4)
    expect(rollupCacheTtlMs({ REPORT_ROLLUP_CACHE_TTL_MS: '0' })).toBe(0)
    expect(rollupCacheTtlMs({})).toBe(20_000)
  })

  it('falls through to the loader when the store fails', async () => {
    setRollupCacheStoreForTests(async () => { throw new Error('down') })
    expect(await cachedAggregate('t1', 's', ['q'], async () => 'fresh')).toBe('fresh')
  })
})

describe('Settings → Query resolver', () => {
  const APP = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'
  it('defaults to auto and the 20 s cache', () => {
    expect(resolveFromSettings(DEFAULT_QUERY_SETTINGS, { service: 'reports_hub' })).toEqual({ service: 'reports_hub', mode: 'auto', level: 'workspace', cacheTtlMs: 20_000 })
  })
  it('workspace → service → app → widget, each inheriting unless set', () => {
    const s = querySettingsSchema.parse({
      default_mode: 'rollup', default_cache_ttl_seconds: 30, allow_widget_override: false,
      services: { app_widgets: { mode: 'live', cache_ttl_seconds: 0 }, reports_hub: { mode: 'inherit', cache_ttl_seconds: 60 } },
      apps: { [APP]: 'auto' },
    })
    expect(resolveFromSettings(s, { service: 'reports_hub' })).toMatchObject({ mode: 'rollup', level: 'workspace', cacheTtlMs: 60_000 })
    expect(resolveFromSettings(s, { service: 'app_widgets' })).toMatchObject({ mode: 'live', level: 'service', cacheTtlMs: 0 })
    expect(resolveFromSettings(s, { service: 'app_widgets', appId: APP })).toMatchObject({ mode: 'auto', level: 'app' })
    // Widget overrides are ignored until the workspace allows them.
    expect(resolveFromSettings(s, { service: 'app_widgets', appId: APP, widgetMode: 'live' })).toMatchObject({ mode: 'auto', level: 'app' })
    const allowed = { ...s, allow_widget_override: true }
    expect(resolveFromSettings(allowed, { service: 'app_widgets', appId: APP, widgetMode: 'live' })).toMatchObject({ mode: 'live', level: 'widget' })
    expect(resolveFromSettings(allowed, { service: 'app_widgets', appId: APP, widgetMode: 'inherit' })).toMatchObject({ mode: 'auto', level: 'app' })
  })
  it('services the rollups cannot answer are always real time', () => {
    const s = querySettingsSchema.parse({ default_mode: 'rollup', services: { home_stats: { mode: 'rollup' } } })
    for (const service of ['home_stats', 'report_charts', 'task_sla'] as const) expect(resolveFromSettings(s, { service })).toMatchObject({ mode: 'live', level: 'fixed' })
  })
  it('invalid stored settings fall back to the defaults', () => {
    expect(querySettingsFromTenantSettings({ query: { default_mode: 'bogus' } })).toEqual(DEFAULT_QUERY_SETTINGS)
    expect(querySettingsFromTenantSettings(null)).toEqual(DEFAULT_QUERY_SETTINGS)
    expect(querySettingsSchema.safeParse({ services: { nope: { mode: 'live' } } }).success).toBe(false)
  })
  it('real time is the fallback of every mode, and timings are recorded per path', async () => {
    const ctx = { tenantId: 'tenant-x' }
    const ds = resolveFromSettings(DEFAULT_QUERY_SETTINGS, { service: 'reports_hub' })
    const live = vi.fn(async () => 'live')
    expect(await readWithDataSource(ctx, ds, async () => 'flat', live)).toBe('flat')
    expect(live).not.toHaveBeenCalled()
    expect(await readWithDataSource(ctx, ds, async () => null, live)).toBe('live')
    const rollup = vi.fn(async () => 'flat')
    expect(await readWithDataSource(ctx, { ...ds, mode: 'live' }, rollup, live)).toBe('live')
    expect(rollup).not.toHaveBeenCalled()
    const t = queryTimings('tenant-x', 'reports_hub')
    expect(t.rollup?.samples).toBe(1)
    expect(t.live?.samples).toBe(2)
  })
})
