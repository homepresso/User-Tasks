/**
 * In-process cache for API credential validation (lib/api-auth).
 *
 * Validating an API key costs a bcrypt compare plus permission lookups; an
 * OAuth access token costs four queries. Successful validations are cached
 * here, keyed by SHA-256 of the presented token (the token itself is never
 * stored), for at most CREDENTIAL_CACHE_TTL_MS and never past the credential's
 * own expiry. Failures are not cached.
 *
 * Staleness bound: anything that can revoke or narrow a credential (key
 * revoke/delete, OAuth token/client revocation, role or permission changes,
 * membership deactivation) calls invalidateCredentialCache(), which empties
 * the cache on THIS instance immediately. With the default memory cache
 * store other server instances pick the change up within the TTL; with a
 * shared store (CACHE_PROVIDER=postgres|redis) the call also bumps the
 * shared `credentials` generation, and syncCredentialCache() — run before
 * every cache lookup — empties every other instance's cache within
 * cache.invalidation_check_ms (default 1 s). The entries themselves never
 * leave the process. The store is a Map with no timers (serverless-friendly).
 */

import { createHash } from 'crypto'
import { GenerationWatcher, publishInvalidation } from '@/lib/providers/cache/invalidation'

export const CREDENTIAL_CACHE_TTL_MS = 60_000
export const CREDENTIAL_CACHE_MAX_ENTRIES = 1_000
/** last_used_at is written at most once per credential per this interval. */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000

interface Entry<T> {
  value: T
  expiresAt: number
}

const entries = new Map<string, Entry<unknown>>()
const lastUsedWrites = new Map<string, number>()
let generation = 0

export function credentialCacheKey(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Current invalidation generation; pass it back to setCachedCredential. */
export function credentialCacheGeneration(): number {
  return generation
}

export function getCachedCredential<T>(key: string, now = Date.now()): T | null {
  const entry = entries.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    entries.delete(key)
    return null
  }
  // Map keeps insertion order: re-insert so the oldest entry is the least recently used.
  entries.delete(key)
  entries.set(key, entry)
  return entry.value as T
}

/**
 * Cache a successful validation. `startedAt` is the generation read before
 * the validation began: if an invalidation happened meanwhile, the result may
 * predate it and is dropped. `credentialExpiresAt` caps the entry lifetime.
 */
export function setCachedCredential<T>(
  key: string,
  value: T,
  options: { startedAt: number; credentialExpiresAt?: string | null; now?: number },
): void {
  if (options.startedAt !== generation) return
  const now = options.now ?? Date.now()
  let expiresAt = now + CREDENTIAL_CACHE_TTL_MS
  if (options.credentialExpiresAt) {
    const credentialExpiry = Date.parse(options.credentialExpiresAt)
    if (Number.isFinite(credentialExpiry)) expiresAt = Math.min(expiresAt, credentialExpiry)
  }
  if (expiresAt <= now) return
  entries.delete(key)
  entries.set(key, { value, expiresAt })
  while (entries.size > CREDENTIAL_CACHE_MAX_ENTRIES) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

function clearLocal(): void {
  generation += 1
  entries.clear()
}

/**
 * Drop every cached validation on this instance at once, and on the others
 * through the shared cache store (the returned promise; never rejects).
 * Called after anything that revokes or narrows a credential; cheap enough
 * that callers need not work out which entries are affected.
 */
export function invalidateCredentialCache(): Promise<void> {
  clearLocal()
  return publishInvalidation('credentials')
}

const sharedGeneration = new GenerationWatcher('credentials')

/**
 * Empty this instance's cache when another instance invalidated since the
 * last check (shared cache store only; a no-op with the memory store). An
 * unreadable store also empties it: validations then hit the database.
 */
export async function syncCredentialCache(): Promise<void> {
  let store
  try {
    store = await (await import('@/lib/providers/cache')).getCacheStore()
  } catch {
    clearLocal()
    return
  }
  if (await sharedGeneration.check(store)) clearLocal()
}

/**
 * True when last_used_at for `credentialId` should be written now (at most
 * once per LAST_USED_WRITE_INTERVAL_MS per instance), recording the write.
 */
export function shouldWriteLastUsed(credentialId: string, now = Date.now()): boolean {
  const last = lastUsedWrites.get(credentialId)
  if (last !== undefined && now - last < LAST_USED_WRITE_INTERVAL_MS) return false
  lastUsedWrites.delete(credentialId)
  lastUsedWrites.set(credentialId, now)
  if (lastUsedWrites.size > CREDENTIAL_CACHE_MAX_ENTRIES * 5) {
    for (const [id, at] of lastUsedWrites) {
      if (now - at < LAST_USED_WRITE_INTERVAL_MS) break
      lastUsedWrites.delete(id)
    }
  }
  return true
}

/** Test helper: forget cached validations and last_used_at bookkeeping. */
export function resetCredentialCacheForTests(): void {
  clearLocal()
  lastUsedWrites.clear()
  sharedGeneration.reset()
}

export function credentialCacheSize(): number {
  return entries.size
}
