import { cacheNumberOption, DEFAULT_INVALIDATION_CHECK_MS, type CacheOptions } from './options'
import type { CacheStore, RateLimitOptions, RateLimitResult } from './types'

/**
 * memory (default): this process only — exactly the per-instance Maps the
 * app used before the cache provider existed. With several replicas every
 * limit is effectively multiplied by the replica count and invalidations
 * reach other replicas only through their TTLs; use postgres or redis there.
 *
 * Timer-free (serverless-friendly): expired entries are evicted when read,
 * and in a full sweep once a map grows past SWEEP_THRESHOLD.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()
const values = new Map<string, { value: string; expiresAt: number | null }>()

// Full-sweep threshold: lazy per-key eviction only clears the entry being
// checked, so expired entries for keys never seen again (e.g. one-shot IPs)
// would accumulate. Past this size every expired entry is swept inline.
const SWEEP_THRESHOLD = 1_000

function sweepBuckets(now: number) {
  for (const [key, bucket] of buckets) {
    if (now > bucket.resetAt) buckets.delete(key)
  }
}

function sweepValues(now: number) {
  for (const [key, entry] of values) {
    if (entry.expiresAt !== null && entry.expiresAt <= now) values.delete(key)
  }
}

/**
 * Record a hit against `key` (the original lib/rate-limit algorithm): ok:false
 * once `max` hits occur within `windowMs` of the first; a refused hit is not
 * counted.
 */
export function memoryHit(key: string, opts: RateLimitOptions): RateLimitResult {
  const now = Date.now()
  if (buckets.size > SWEEP_THRESHOLD) sweepBuckets(now)
  const entry = buckets.get(key)
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs })
    return { ok: true, remaining: opts.max - 1, retryAfterMs: 0 }
  }
  if (entry.count >= opts.max) {
    return { ok: false, remaining: 0, retryAfterMs: Math.max(0, entry.resetAt - now) }
  }
  entry.count += 1
  return { ok: true, remaining: opts.max - entry.count, retryAfterMs: 0 }
}

function live(key: string, now: number): string | null {
  const entry = values.get(key)
  if (!entry) return null
  if (entry.expiresAt !== null && entry.expiresAt <= now) {
    values.delete(key)
    return null
  }
  return entry.value
}

function put(key: string, value: string, ttlMs: number | undefined, now: number) {
  if (values.size > SWEEP_THRESHOLD) sweepValues(now)
  values.set(key, { value, expiresAt: ttlMs === undefined ? null : now + ttlMs })
}

export function createMemoryCacheStore(options: CacheOptions = {}): CacheStore {
  return {
    id: 'memory',
    onPrem: true,
    shared: false,
    invalidationCheckMs: cacheNumberOption(options, 'invalidation_check_ms', DEFAULT_INVALIDATION_CHECK_MS),
    async get(key) {
      return live(key, Date.now())
    },
    async set(key, value, ttlMs) {
      put(key, value, ttlMs, Date.now())
    },
    async setIfAbsent(key, value, ttlMs) {
      const now = Date.now()
      if (live(key, now) !== null) return false
      put(key, value, ttlMs, now)
      return true
    },
    async delete(key) {
      values.delete(key)
      buckets.delete(key)
    },
    async hit(key, opts) {
      return memoryHit(key, opts)
    },
    async incr(key) {
      const now = Date.now()
      const next = (Number(live(key, now)) || 0) + 1
      put(key, String(next), undefined, now)
      return next
    },
    async ping() {
      return `in-process (${buckets.size + values.size} entries)`
    },
  }
}

/** Test helper: forget every window and value. */
export function resetMemoryCacheForTests(): void {
  buckets.clear()
  values.clear()
}
