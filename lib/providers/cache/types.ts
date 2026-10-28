/**
 * CacheStore: small shared state that used to live in a per-process Map —
 * rate-limit windows, invalidation generations (credential and config
 * caches), short-lived claims (idempotency). Values are short strings; the
 * store is never the source of truth for anything, so losing it (a restart
 * of the memory store, an evicted Redis key, an UNLOGGED table after a
 * crash) only resets windows and forces cache reloads.
 *
 * Keys are namespaced by the caller (`rl:…`, `gen:…`, `idem:…`); shared
 * stores add `cache.key_prefix` (default `usertasks:`) so several instances
 * can share one Redis.
 */

export interface RateLimitResult {
  ok: boolean
  remaining: number
  retryAfterMs: number
}

export interface RateLimitOptions {
  max: number
  windowMs: number
}

export interface CacheStore {
  readonly id: string
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  /** State is shared by every process using the store (false: this process only). */
  readonly shared: boolean
  /** How often shared invalidation generations are re-read (ms; 0 = every check). */
  readonly invalidationCheckMs: number
  get(key: string): Promise<string | null>
  /** Set a value, expiring after ttlMs (no expiry without it). */
  set(key: string, value: string, ttlMs?: number): Promise<void>
  /** Set only when absent (or expired); true when this call set it. */
  setIfAbsent(key: string, value: string, ttlMs: number): Promise<boolean>
  delete(key: string): Promise<void>
  /**
   * Record a hit in a fixed window that starts at the key's first hit and
   * lasts windowMs: ok while the window holds at most `max` hits.
   */
  hit(key: string, options: RateLimitOptions): Promise<RateLimitResult>
  /** Atomically increment a counter (no expiry); returns the new value. */
  incr(key: string): Promise<number>
  /** Round trip to the backend; resolves with a one-line description. */
  ping(): Promise<string>
  /** Release connections (CLI, tests). */
  close?(): Promise<void>
}

export class CacheStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CacheStoreError'
  }
}

/** The result of a hit counted `count` times in a window with `ttlMs` left. */
export function windowResult(count: number, ttlMs: number, max: number): RateLimitResult {
  if (count > max) return { ok: false, remaining: 0, retryAfterMs: Math.max(0, ttlMs) }
  return { ok: true, remaining: max - count, retryAfterMs: 0 }
}

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.split('\n')[0].slice(0, 300)
}
