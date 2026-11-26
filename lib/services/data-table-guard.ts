/**
 * Protection for the expensive data-table grid queries (data_table_rows_page /
 * data_table_row_groups: sorts, filters, searches and group counts that must
 * read every row of a large table). Under load ~10-20 of them at once used all
 * of the database's CPU and held its connections, so every other request
 * queued behind them (QA perf pass, Phase B).
 *
 *  - Concurrency cap: at most GRID_LIMITS.perInstance at once in this process
 *    and GRID_LIMITS.perWorkspace per workspace. The workspace slots live in
 *    the cache provider (setIfAbsent with a TTL), so they hold across replicas
 *    when the cache store is shared (postgres / redis); with the default memory
 *    store they are per instance. A caller waits up to GRID_LIMITS.queueMs for
 *    a slot, then gets a 429 "busy" with Retry-After.
 *  - Time cap: the SQL functions take p_timeout_ms (GRID_LIMITS.timeoutMs) and
 *    stop at the deadline with SQLSTATE 57014; that (or a statement timeout)
 *    becomes a clear message, never a 500.
 *  - Exact totals of plain pages on large tables are cached briefly
 *    (GRID_LIMITS.totalTtlMs), dropped on this service's own row writes.
 *
 * Env: DATA_GRID_QUERY_TIMEOUT_MS (8000), DATA_GRID_MAX_CONCURRENT (4 per
 * instance), DATA_GRID_MAX_CONCURRENT_PER_WORKSPACE (2), DATA_GRID_QUEUE_MS
 * (2000), DATA_GRID_TOTAL_CACHE_MS (45000), DATA_GRID_TOTAL_CACHE_MIN_ROWS (10000),
 * DATA_GRID_SLOT_WAIT_MS (1000: a cache store slower than this counts as down).
 */

import { getCacheStore } from '@/lib/providers/cache'
import { ServiceError } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- database errors */

function envInt(name: string, fallback: number, min = 0): number {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback
}

export const GRID_LIMITS = {
  get timeoutMs() { return Math.min(60_000, envInt('DATA_GRID_QUERY_TIMEOUT_MS', 8_000, 1_000)) },
  get perInstance() { return envInt('DATA_GRID_MAX_CONCURRENT', 4, 1) },
  get perWorkspace() { return envInt('DATA_GRID_MAX_CONCURRENT_PER_WORKSPACE', 2, 1) },
  get queueMs() { return envInt('DATA_GRID_QUEUE_MS', 2_000, 0) },
  get totalTtlMs() { return envInt('DATA_GRID_TOTAL_CACHE_MS', 45_000, 0) },
  get totalMinRows() { return envInt('DATA_GRID_TOTAL_CACHE_MIN_ROWS', 10_000, 0) },
  get slotWaitMs() { return envInt('DATA_GRID_SLOT_WAIT_MS', 1_000, 50) },
}

export const GRID_TIMEOUT_MESSAGE = 'This table is large; narrow the filter or try again.'
export const GRID_BUSY_MESSAGE = 'This table is busy with other large queries; try again in a moment.'

/** A grid query that hit its time cap (our deadline, or a role / server statement timeout). */
export function isGridTimeout(error: any): boolean {
  if (!error) return false
  return String(error.code ?? '') === '57014' || /data_table_grid_timeout|statement timeout|canceling statement/i.test(String(error.message ?? ''))
}

export function gridTimeoutError(): ServiceError {
  return new ServiceError('rate_limited', GRID_TIMEOUT_MESSAGE, { status: 503, details: { reason: 'timeout', retry_after: 5 } })
}

export function gridBusyError(retryAfterSeconds = 2): ServiceError {
  return new ServiceError('rate_limited', GRID_BUSY_MESSAGE, { status: 429, details: { reason: 'busy', retry_after: retryAfterSeconds } })
}

/* ── Concurrency ─────────────────────────────────────────────────────── */

let running = 0
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** Test hook. */
export function gridGuardStateForTests() {
  return { running }
}

async function acquireWorkspaceSlot(workspace: string, token: string): Promise<string | null> {
  const store = await getCacheStore()
  const ttl = GRID_LIMITS.timeoutMs + 5_000 // a crashed holder's slot expires on its own
  for (let i = 0; i < GRID_LIMITS.perWorkspace; i++) {
    const key = `grid:slot:${workspace}:${i}`
    if (await store.setIfAbsent(key, token, ttl)) return key
  }
  return null
}

/**
 * The workspace slot, bounded in time: a cache store that does not answer
 * (database cache blocked behind a lock, Redis unreachable without an error)
 * must not hold the grid query forever. Past slotWaitMs it counts as down and
 * only the instance cap applies, like a store error.
 */
async function acquireWorkspaceSlotBounded(workspace: string, token: string): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const attempt = acquireWorkspaceSlot(workspace, token)
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cache store did not answer')), GRID_LIMITS.slotWaitMs) })
  try {
    return await Promise.race([attempt, timeout])
  } catch (error) {
    // A slot taken after we gave up is released, never leaked until its TTL.
    void attempt.then(async (key) => { if (key) await (await getCacheStore()).delete(key) }).catch(() => undefined)
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Run an expensive grid query under the caps: wait (up to queueMs) for an
 * instance slot and a workspace slot, run it, release both. Throws 429 "busy"
 * when no slot frees in time, and maps a timeout to the clear message.
 */
export async function withGridGuard<T>(workspace: string, run: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + GRID_LIMITS.queueMs
  const token = `${process.pid}:${Math.random().toString(36).slice(2)}`
  let slotKey: string | null = null
  let holdsInstance = false
  try {
    for (let wait = 25; ; wait = Math.min(wait * 2, 250)) {
      if (!holdsInstance && running < GRID_LIMITS.perInstance) { running++; holdsInstance = true }
      if (holdsInstance) {
        try {
          slotKey = await acquireWorkspaceSlotBounded(workspace, token)
        } catch {
          slotKey = '' // cache store down: the instance cap still applies
        }
        if (slotKey !== null) break
        running--; holdsInstance = false // let another workspace use the instance slot while we wait
      }
      if (Date.now() + wait > deadline) throw gridBusyError(Math.max(1, Math.ceil(GRID_LIMITS.timeoutMs / 4000)))
      await sleep(wait)
    }
    return await run()
  } catch (error) {
    if (error instanceof ServiceError) throw error
    if (isGridTimeout(error)) throw gridTimeoutError()
    throw error
  } finally {
    if (holdsInstance) running--
    if (slotKey) {
      const key = slotKey
      await withinCacheWait<void>(async () => { await (await getCacheStore()).delete(key) }, undefined) // else it expires by TTL
    }
  }
}

/* ── Cached totals ───────────────────────────────────────────────────── */

/** `work`, or `fallback` when it takes longer than the cache wait (a store that does not answer counts as down). */
async function withinCacheWait<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work().catch(() => fallback),
      new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback), GRID_LIMITS.slotWaitMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const totalKey = (tableId: string) => `grid:total:${tableId}`

/** A plain page's exact total from the cache (large tables only), or null. */
export async function cachedTableTotal(tableId: string): Promise<number | null> {
  if (GRID_LIMITS.totalTtlMs <= 0) return null
  const raw = await withinCacheWait<string | null>(async () => (await getCacheStore()).get(totalKey(tableId)), null)
  const n = raw === null ? NaN : Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Remember a plain page's exact total when the table is large enough to be worth it. */
export async function rememberTableTotal(tableId: string, total: number): Promise<void> {
  if (GRID_LIMITS.totalTtlMs <= 0 || total < GRID_LIMITS.totalMinRows) return
  await withinCacheWait<void>(async () => { await (await getCacheStore()).set(totalKey(tableId), String(total), GRID_LIMITS.totalTtlMs) }, undefined)
}

/** Drop a table's cached total (after rows were written / deleted through the service). */
export async function forgetTableTotal(tableId: string): Promise<void> {
  await withinCacheWait<void>(async () => { await (await getCacheStore()).delete(totalKey(tableId)) }, undefined) // else it expires by TTL
}
