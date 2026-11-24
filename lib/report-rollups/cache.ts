/**
 * Short per-query cache for report / widget aggregates (report rollups).
 *
 * Keyed by tenant + a hash of the viewer's SCOPE (what they may see: "every
 * run", "these granted workflows", "tasks of user U and teams T", …) + a
 * hash of the query (function and arguments). Two viewers share an entry
 * only when their scope strings are identical, so a cached value can never
 * show someone counts outside their own access.
 *
 * Stored in the cache provider (lib/providers/cache: memory, postgres or
 * redis), so replicas share it when a shared store is configured. TTL:
 * REPORT_ROLLUP_CACHE_TTL_MS (default 20 s; 0 turns the cache off). The
 * rollups are kept current by triggers, so the TTL is only there to absorb
 * bursts (a page of widgets, a dashboard on a wall screen). A per-tenant
 * generation (rr:gen:<tenant>) is bumped when the maintenance job rebuilds
 * a tenant's days, which drops that tenant's entries at once.
 *
 * Values over MAX_VALUE_BYTES are not cached. Any cache failure falls
 * through to the loader.
 */

import { createHash } from 'node:crypto'
import { getCacheStore } from '@/lib/providers/cache'

export const DEFAULT_TTL_MS = 20_000
const MAX_VALUE_BYTES = 512 * 1024

interface MinimalStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string, ttlMs?: number): Promise<void>
  incr(key: string): Promise<number>
}

let storeOverride: (() => Promise<MinimalStore>) | null = null

/** Tests: use this store instead of the configured provider (null resets). */
export function setRollupCacheStoreForTests(get: (() => Promise<MinimalStore>) | null): void {
  storeOverride = get
}

export function rollupCacheTtlMs(env: Record<string, string | undefined> = process.env): number {
  const raw = env.REPORT_ROLLUP_CACHE_TTL_MS
  if (raw === undefined || raw === '') return DEFAULT_TTL_MS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.min(n, 300_000) : DEFAULT_TTL_MS
}

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex').slice(0, 32)

/** The cache key for a query (exported for tests). */
export function rollupCacheKey(tenantId: string, generation: string, scope: string, query: unknown): string {
  return `rr:v1:${tenantId}:${generation}:${hash(scope)}:${hash(query)}`
}

const genKey = (tenantId: string) => `rr:gen:${tenantId}`

async function store(): Promise<MinimalStore> {
  return storeOverride ? storeOverride() : getCacheStore()
}

/**
 * The cached value of `load()` for this tenant / scope / query, or a fresh
 * one. `scope` must describe everything that limits what the viewer sees.
 */
export async function cachedAggregate<T>(tenantId: string, scope: string, query: unknown, load: () => Promise<T>, ttlMs = rollupCacheTtlMs()): Promise<T> {
  if (!ttlMs || !tenantId) return load()
  let s: MinimalStore
  let key: string
  try {
    s = await store()
    const generation = (await s.get(genKey(tenantId))) ?? '0'
    key = rollupCacheKey(tenantId, generation, scope, query)
    const hit = await s.get(key)
    if (hit !== null) return JSON.parse(hit) as T
  } catch {
    return load()
  }
  const value = await load()
  try {
    const text = JSON.stringify(value)
    if (text !== undefined && text.length <= MAX_VALUE_BYTES) await s.set(key, text, ttlMs)
  } catch { /* cache is best effort */ }
  return value
}

/** Drop a tenant's cached aggregates (after the job rebuilt some of its days). */
export async function bumpRollupGeneration(tenantId: string): Promise<void> {
  try {
    await (await store()).incr(genKey(tenantId))
  } catch { /* entries expire with their TTL anyway */ }
}
