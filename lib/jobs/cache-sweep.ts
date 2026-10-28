import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import type { CacheSql } from '@/lib/providers/cache/postgres'

/**
 * Deletes expired rows of the postgres cache store (app_cache.entries,
 * migration 20261108000000) in batches until none are left or the deadline
 * passes. Reads already ignore expired rows; this only reclaims space.
 * Registered as the `cache-sweep` job (every 10 minutes, enabled when
 * CACHE_PROVIDER=postgres).
 */

const BATCH = 5_000
const MAX_BATCHES = 50

export async function sweepCacheStore(options: { supabase?: SupabaseClient; deadline?: number } = {}): Promise<{ deleted: number }> {
  const supabase = options.supabase ?? createServiceClient()
  const sql: CacheSql = {
    async call(fn, args) {
      const { data, error } = await supabase.rpc(fn, args)
      if (error) throw new Error(error.message)
      return (Array.isArray(data) ? data : []) as never
    },
  }
  const { sweepPostgresCache } = await import('@/lib/providers/cache/postgres')
  let deleted = 0
  for (let i = 0; i < MAX_BATCHES; i++) {
    const n = await sweepPostgresCache(sql, BATCH)
    deleted += n
    if (n < BATCH || (options.deadline && Date.now() > options.deadline)) break
  }
  return { deleted }
}
