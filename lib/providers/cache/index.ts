import { getProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { createMemoryCacheStore } from './memory'
import type { CacheOptions } from './options'
import { createPostgresCacheStore, type CacheSql } from './postgres'
import { createRedisCacheStore } from './redis'
import type { CacheStore as BaseCacheStore } from './types'

/**
 * CacheStore provider: where rate-limit windows, cache-invalidation
 * generations and short-lived claims live.
 *
 *  - memory (default)  this process only — the per-instance Maps of before
 *  - postgres          the app database (UNLOGGED app_cache.entries)
 *  - redis             Redis / Valkey / KeyDB / Dragonfly, Azure Cache for
 *                      Redis, Memorystore, ElastiCache (TLS, ACL users,
 *                      Entra ID and IAM token auth)
 *
 * Selected by CACHE_PROVIDER or the `providers.cache` instance setting;
 * options in ./options. Users: lib/rate-limit (API, OAuth, login, agent
 * and signup limits), lib/api-auth-cache (credential-cache invalidation
 * across replicas), lib/config/instance-settings (config-cache
 * invalidation), the task-ingest idempotency claim.
 */

export type CacheStore = BaseCacheStore & { readonly id: ProviderId<'cache'> }
export type { CacheOptions } from './options'
export { CacheStoreError, type RateLimitOptions, type RateLimitResult } from './types'

export function resolveCacheStore(id: ProviderId<'cache'> = DEFAULT_PROVIDERS.cache, options: CacheOptions = {}, deps: { sql?: CacheSql } = {}): CacheStore {
  return pickProvider<'cache', BaseCacheStore>('cache', id, {
    memory: () => createMemoryCacheStore(options),
    postgres: () => createPostgresCacheStore(options, deps),
    redis: () => createRedisCacheStore(options),
  }) as CacheStore
}

// One store per configuration (the Redis connection is reused).
let cached: { signature: string; store: CacheStore } | null = null

/** The store for a cache provider config (cached by id + options). */
export function cacheStoreFor(id: ProviderId<'cache'>, options: CacheOptions): CacheStore {
  const signature = JSON.stringify([id, options])
  if (cached?.signature !== signature) {
    const previous = cached?.store
    cached = { signature, store: resolveCacheStore(id, options) }
    void previous?.close?.().catch(() => undefined)
  }
  return cached.store
}

export async function getCacheStore(): Promise<CacheStore> {
  const config = await getProviderConfig('cache')
  return cacheStoreFor(config.id, config.options)
}
