import { createHash } from 'node:crypto'

/**
 * Short-lived idempotency claims in the cache store (lib/providers/cache).
 * A request carrying an idempotency key claims it before creating anything;
 * a concurrent request with the same key finds it claimed and waits for the
 * first one's result instead of creating a duplicate. With a shared store
 * (postgres / redis) this holds across replicas; with the memory store
 * within one instance. The database row stays the source of truth — the
 * claim only closes the window between "not found" and "inserted".
 *
 * If the store can't be reached the claim is granted (the request proceeds
 * as it did before claims existed).
 */

export const IDEMPOTENCY_CLAIM_TTL_MS = 30_000

export function idempotencyClaimKey(scope: string, tenantId: string, key: string): string {
  return `idem:${scope}:${tenantId}:${createHash('sha256').update(key).digest('hex').slice(0, 32)}`
}

export async function claimIdempotencyKey(claimKey: string, ttlMs = IDEMPOTENCY_CLAIM_TTL_MS): Promise<boolean> {
  try {
    const { getCacheStore } = await import('@/lib/providers/cache')
    return await (await getCacheStore()).setIfAbsent(claimKey, String(Date.now()), ttlMs)
  } catch (error) {
    console.warn(`[idempotency] claim not checked: ${(error as Error).message}`)
    return true
  }
}

export async function releaseIdempotencyKey(claimKey: string): Promise<void> {
  try {
    const { getCacheStore } = await import('@/lib/providers/cache')
    await (await getCacheStore()).delete(claimKey)
  } catch {
    // Expires on its own.
  }
}

/** Poll `find` while another request holds the claim (default up to ~3 s). */
export async function waitForIdempotentResult<T>(find: () => Promise<T | null>, { attempts = 15, delayMs = 200 } = {}): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    const found = await find()
    if (found) return found
  }
  return null
}
