import { cacheNumberOption, DEFAULT_INVALIDATION_CHECK_MS, keyPrefix, type CacheOptions } from './options'
import { CacheStoreError, describeError, windowResult, type CacheStore } from './types'

/**
 * postgres: the app database itself — an UNLOGGED table (app_cache.entries,
 * migration 20261108000000) behind SECURITY DEFINER functions that only the
 * service role may execute. No extra service; every replica, the worker and
 * the admin CLI share it. Each operation is one statement (row lock on the
 * key), so concurrent hits from several processes never lose a count.
 *
 * Expired rows are ignored when read and deleted by the `cache-sweep` job
 * (lib/jobs/registry.ts). UNLOGGED: not WAL-logged or replicated, and
 * emptied after a crash — fine for windows and generations.
 *
 * The functions are reached through a CacheSql: the service database client
 * (the app: PostgREST or pg-query, whichever db provider is active) or a
 * direct pg connection (the admin CLI).
 */

export interface CacheSql {
  /** Call public.<fn>(named args); rows of the function's result table. */
  call<R extends Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<R[]>
}

interface QueryClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

const FUNCTIONS = new Set(['app_cache_get', 'app_cache_set', 'app_cache_delete', 'app_cache_hit', 'app_cache_incr', 'app_cache_sweep'])

/** A CacheSql over a direct pg connection. */
export function pgCacheSql(client: QueryClient): CacheSql {
  return {
    async call(fn, args) {
      if (!FUNCTIONS.has(fn)) throw new CacheStoreError(`Unknown cache function ${fn}`)
      const names = Object.keys(args)
      for (const name of names) if (!/^p_[a-z_]+$/.test(name)) throw new CacheStoreError(`Invalid argument ${name}`)
      const { rows } = await client.query(`SELECT * FROM public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')})`, names.map((name) => args[name]))
      return rows as never
    },
  }
}

/** A CacheSql over the service database client (supabase-js RPC). */
export function serviceDbCacheSql(): CacheSql {
  return {
    async call(fn, args) {
      const { getServiceDb } = await import('@/lib/providers/db')
      const { data, error } = await getServiceDb().rpc(fn, args)
      if (error) throw new Error(error.message)
      return (Array.isArray(data) ? data : data === null || data === undefined ? [] : [data]) as never
    },
  }
}

export function createPostgresCacheStore(options: CacheOptions, deps: { sql?: CacheSql } = {}): CacheStore {
  const sql = deps.sql ?? serviceDbCacheSql()
  const prefix = keyPrefix(options)
  const k = (key: string) => `${prefix}${key}`

  async function call<R extends Record<string, unknown>>(fn: string, args: Record<string, unknown>): Promise<R[]> {
    try {
      return await sql.call<R>(fn, args)
    } catch (error) {
      const message = describeError(error)
      const missing = /app_cache_|does not exist|schema cache/i.test(message) && /function|does not exist|could not find/i.test(message)
      throw new CacheStoreError(missing
        ? `the postgres cache store needs migration 20261108000000_cache_store (usertasks-admin db migrate): ${message}`
        : `postgres cache ${fn.replace('app_cache_', '')}: ${message}`)
    }
  }

  return {
    id: 'postgres',
    onPrem: true,
    shared: true,
    invalidationCheckMs: cacheNumberOption(options, 'invalidation_check_ms', DEFAULT_INVALIDATION_CHECK_MS),
    async get(key) {
      const rows = await call<{ value: string | null }>('app_cache_get', { p_key: k(key) })
      return rows[0]?.value ?? null
    },
    async set(key, value, ttlMs) {
      await call('app_cache_set', { p_key: k(key), p_value: value, p_ttl_ms: ttlMs === undefined ? null : Math.max(1, Math.ceil(ttlMs)), p_nx: false })
    },
    async setIfAbsent(key, value, ttlMs) {
      const rows = await call<{ stored: boolean }>('app_cache_set', { p_key: k(key), p_value: value, p_ttl_ms: Math.max(1, Math.ceil(ttlMs)), p_nx: true })
      return rows[0]?.stored === true
    },
    async delete(key) {
      await call('app_cache_delete', { p_key: k(key) })
    },
    async hit(key, { max, windowMs }) {
      const rows = await call<{ hits: number | string; ttl_ms: number | string }>('app_cache_hit', { p_key: k(key), p_window_ms: Math.max(1, Math.ceil(windowMs)) })
      const count = Number(rows[0]?.hits)
      if (!Number.isFinite(count)) throw new CacheStoreError('postgres cache returned an unexpected rate-limit row')
      return windowResult(count, Number(rows[0]?.ttl_ms ?? 0), max)
    },
    async incr(key) {
      const rows = await call<{ value: number | string }>('app_cache_incr', { p_key: k(key) })
      return Number(rows[0]?.value)
    },
    async ping() {
      await call('app_cache_get', { p_key: k('ping') })
      return 'app_cache.entries reachable (UNLOGGED table in the app database)'
    },
  }
}

/** Delete up to `limit` expired rows (the cache-sweep job). */
export async function sweepPostgresCache(sql: CacheSql = serviceDbCacheSql(), limit = 5_000): Promise<number> {
  const rows = await sql.call<{ deleted: number | string }>('app_cache_sweep', { p_limit: limit })
  return Number(rows[0]?.deleted ?? 0)
}
