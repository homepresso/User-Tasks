import { Pool, type PoolClient, type QueryResultRow } from 'pg'
import { databaseUrl, readEnv } from '@/lib/config/bootstrap'
import { ConfigError } from '@/lib/config/schema'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'

/**
 * Direct Postgres access for the built-in auth store (schema app_auth,
 * migration 20261106100000). The schema is never exposed through PostgREST
 * or granted to anon/authenticated, so it is reached over DATABASE_URL (the
 * same connection the postgres db provider and the SSE realtime hub use).
 * One small pool per process; tests inject their own.
 */

export interface AuthDb {
  query<R extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>
  /** Run `fn` in one transaction (BEGIN … COMMIT / ROLLBACK). */
  transaction<T>(fn: (db: AuthDb) => Promise<T>): Promise<T>
}

const globalRef = globalThis as typeof globalThis & { __usertasksAuthDb?: { url: string; pool: Pool } | null; __usertasksAuthDbOverride?: AuthDb | null }

function clientDb(client: PoolClient): AuthDb {
  return {
    query: (sql, params) => client.query(sql, params as unknown[]) as never,
    transaction: (fn) => fn(clientDb(client)),
  }
}

export function poolAuthDb(pool: Pool): AuthDb {
  return {
    query: (sql, params) => pool.query(sql, params as unknown[]) as never,
    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(clientDb(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export function authDb(): AuthDb {
  if (globalRef.__usertasksAuthDbOverride) return globalRef.__usertasksAuthDbOverride
  const url = readEnv('AUTH_DATABASE_URL') || databaseUrl()
  if (!url) throw new ConfigError('Built-in, OIDC and SAML auth store users and sessions in Postgres: set DATABASE_URL (or AUTH_DATABASE_URL)')
  const current = globalRef.__usertasksAuthDb
  if (current && current.url === url) return poolAuthDb(current.pool)
  if (current) void current.pool.end().catch(() => undefined)
  const pool = new Pool(pgConnectionConfig(url, { max: Number(readEnv('AUTH_DATABASE_POOL_MAX')) || 5, application_name: 'usertasks-auth' }))
  pool.on('error', () => undefined)
  globalRef.__usertasksAuthDb = { url, pool }
  return poolAuthDb(pool)
}

/** Tests: route the store through `db` (null restores the pool). */
export function setAuthDbForTests(db: AuthDb | null): void {
  globalRef.__usertasksAuthDbOverride = db
}

export async function closeAuthDb(): Promise<void> {
  const current = globalRef.__usertasksAuthDb
  globalRef.__usertasksAuthDb = null
  if (current) await current.pool.end()
}
