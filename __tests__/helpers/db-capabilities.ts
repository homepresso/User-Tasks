import { Client } from 'pg'

/**
 * What the database behind EVENT_STREAM_DB_URL offers, for the DB-backed
 * suites. They run against the local Supabase stack (the default) and
 * against plain PostgreSQL migrated with `usertasks-admin db migrate` (the
 * Supabase-free configuration). Tests of Supabase services — Auth's admin
 * API, Storage, PostgREST itself, pg_cron, Vault — skip on plain Postgres:
 * the stack's services don't front that database. Everything else runs.
 *
 * Use with top-level await:  const caps = await dbCapabilities()
 */
export interface DbCapabilities {
  /** A Supabase database: its Auth / Storage / PostgREST at the stack URL serve it. */
  supabase: boolean
  pgCron: boolean
  vault: boolean
  /**
   * service_role has BYPASSRLS (Supabase, or a superuser ran the migrations).
   * Managed Postgres may not allow it; the app then runs service-role
   * requests as the schema owner (pg-query), which tests mirror with
   * setRoleSql().
   */
  serviceRoleBypassesRls: boolean
}

const cache = new Map<string, Promise<DbCapabilities>>()

export function dbCapabilities(url = process.env.EVENT_STREAM_DB_URL): Promise<DbCapabilities | null> {
  if (!url) return Promise.resolve(null)
  let probe = cache.get(url)
  if (!probe) {
    probe = (async () => {
      const db = new Client({ connectionString: url })
      await db.connect()
      try {
        const { rows } = await db.query<DbCapabilities>(`
          SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') AS supabase,
                 to_regclass('cron.job') IS NOT NULL AS "pgCron",
                 to_regclass('vault.secrets') IS NOT NULL AS vault,
                 coalesce((SELECT rolbypassrls FROM pg_roles WHERE rolname = 'service_role'), false) AS "serviceRoleBypassesRls"`)
        return rows[0]
      } finally {
        await db.end()
      }
    })()
    cache.set(url, probe)
  }
  return probe
}

/** Data API for suites that pick a db provider: PostgREST on Supabase, pg-query elsewhere. */
export function dataApiProvider(caps: DbCapabilities | null): 'supabase' | 'postgres' {
  return caps?.supabase ? 'supabase' : 'postgres'
}

/** `SET LOCAL ROLE <role>` — for service_role without BYPASSRLS, the session (owner) role, as pg-query does. */
export function setRoleSql(role: string, caps: DbCapabilities | null): string {
  return role === 'service_role' && caps && !caps.serviceRoleBypassesRls ? 'SET LOCAL ROLE NONE' : `SET LOCAL ROLE ${role}`
}
