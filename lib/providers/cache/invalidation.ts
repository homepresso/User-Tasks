import { readEnv } from '@/lib/config/bootstrap'
import type { CacheStore } from './types'

/**
 * Cache invalidation across processes. Each in-process cache keeps working
 * as before (and is cleared at once on the process that made the change);
 * with a shared cache store the change also bumps a generation counter
 * (`gen:<channel>`), and every other process re-reads that counter at most
 * every `cache.invalidation_check_ms` (default 1 s) before trusting its
 * cache. With the memory store nothing is shared and other processes catch
 * up through their caches' TTLs, exactly as before.
 *
 *  - credentials  lib/api-auth-cache (API keys / OAuth tokens validated in
 *                 the last 60 s): revocations reach every replica within ~1 s
 *  - config       lib/config/instance-settings (30 s settings cache): a
 *                 setting changed by the app or `usertasks-admin` is seen
 *                 everywhere within ~1 s
 *
 * Reading the counter failing (store down) counts as "changed": the caller
 * reloads from the database rather than trust a cache it can't verify.
 */

export type InvalidationChannel = 'credentials' | 'config'

export const generationKey = (channel: InvalidationChannel) => `gen:${channel}`

let warned = false
function warnOnce(message: string) {
  if (warned) return
  warned = true
  console.warn(`[cache] ${message}`)
}

/** Bump a channel on a shared store (no-op on a process-local one). Never throws. */
export async function publishInvalidation(channel: InvalidationChannel, store?: CacheStore | null): Promise<void> {
  try {
    const target = store ?? (await (await import('./index')).getCacheStore())
    if (!target.shared) return
    await target.incr(generationKey(channel))
  } catch (error) {
    warnOnce(`could not publish a ${channel} cache invalidation to other processes: ${(error as Error).message}`)
  }
}

export class GenerationWatcher {
  private seen: string | null | undefined = undefined
  private checkedAt = Number.NEGATIVE_INFINITY

  constructor(readonly channel: InvalidationChannel) {}

  /**
   * True when another process bumped the channel since the last check (or
   * the store couldn't be read). The first check only records the value.
   */
  async check(store: CacheStore, now = Date.now()): Promise<boolean> {
    if (!store.shared) return false
    if (now - this.checkedAt < store.invalidationCheckMs) return false
    this.checkedAt = now
    let value: string | null
    try {
      value = await store.get(generationKey(this.channel))
    } catch (error) {
      warnOnce(`could not read the ${this.channel} invalidation generation: ${(error as Error).message}`)
      this.seen = undefined
      return true
    }
    const changed = this.seen !== undefined && value !== this.seen
    this.seen = value
    return changed
  }

  reset(): void {
    this.seen = undefined
    this.checkedAt = Number.NEGATIVE_INFINITY
  }
}

const configWatcher = new GenerationWatcher('config')
let checkingConfig = false

/**
 * The shared store named by a settings snapshot (null for memory). Resolved
 * from the snapshot itself, not through getConfig(): this runs inside the
 * settings loader.
 */
async function storeForSettings(values: Map<string, unknown>): Promise<CacheStore | null> {
  const id = readEnv('CACHE_PROVIDER')?.trim().toLowerCase() || values.get('providers.cache')
  if (!id || id === 'memory') return null
  const { resolveInstanceConfig, resolveProviderSecretRefs } = await import('@/lib/config')
  const config = resolveInstanceConfig(values)
  if (config.providers.cache.id === 'memory') return null
  const resolved = await resolveProviderSecretRefs(config, 'cache')
  const { cacheStoreFor } = await import('./index')
  return cacheStoreFor(resolved.id, resolved.options)
}

/**
 * Whether the settings in `values` may be stale because another process
 * changed instance settings. Called by the settings loader with its cached
 * snapshot (and with the previous one before a reload, which records the
 * generation the new load corresponds to).
 */
export async function configChangedElsewhere(values: Map<string, unknown>): Promise<boolean> {
  if (checkingConfig) return false
  checkingConfig = true
  try {
    const store = await storeForSettings(values)
    return store ? await configWatcher.check(store) : false
  } catch (error) {
    warnOnce(`config invalidation check skipped: ${(error as Error).message}`)
    return false
  } finally {
    checkingConfig = false
  }
}

/** Test helper. */
export function resetInvalidationWatchersForTests(): void {
  configWatcher.reset()
  warned = false
}
