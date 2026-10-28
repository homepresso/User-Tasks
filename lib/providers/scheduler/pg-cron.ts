/**
 * pg_cron scheduler (the default): installs, inspects and removes the
 * pg_cron jobs that drive the app, exactly as the migrations schedule them
 * (20261103100000_cron_consolidation.sql, 20261109500000_instance_housekeeping.sql):
 *
 *   usertasks-tick               * * * * *     POST /api/cron/tick via
 *                                              app_cron.invoke_endpoint (pg_net)
 *   usertasks-housekeeping       every 15 min  app_cron.run_housekeeping()
 *                                              (runs when housekeeping.interval_minutes is due)
 *   usertasks-cron-housekeeping  30 3 * * *    the daily, forced housekeeping pass
 *
 * plus, when given, the two Vault secrets invoke_endpoint reads at call time
 * (`app_base_url`, `cron_secret`). Idempotent: every `usertasks-*` job is
 * unscheduled first and secrets are created or updated in place, all in one
 * transaction. Runs over a direct Postgres connection (DATABASE_URL) with a
 * role that may use cron.* and vault.* (postgres on Supabase).
 *
 * The other scheduler providers don't need any of this; switching away from
 * pg_cron = uninstallPgCron() (or the jobs keep calling the tick, which the
 * app reports).
 */

export interface PgCronJobSpec {
  name: string
  schedule: string
  command: string
}

export const PG_CRON_JOBS: readonly PgCronJobSpec[] = [
  {
    name: 'usertasks-tick',
    schedule: '* * * * *',
    command: `select app_cron.invoke_endpoint('/api/cron/tick', 'POST', jsonb_build_object('minute', date_trunc('minute', now())), 55000)`,
  },
  {
    name: 'usertasks-housekeeping',
    schedule: '*/15 * * * *',
    command: 'select app_cron.run_housekeeping()',
  },
  {
    name: 'usertasks-cron-housekeeping',
    schedule: '30 3 * * *',
    command: `select app_cron.run_housekeeping('pg_cron-daily', true, false, null, 120000, 400)`,
  },
]

export const VAULT_BASE_URL_SECRET = 'app_base_url'
export const VAULT_CRON_SECRET = 'cron_secret'

/** pg client surface used here (pg.Client / PoolClient). */
export interface SqlClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

export interface PgCronInstallOptions {
  /** Base URL the database calls (stored in Vault as app_base_url). */
  baseUrl?: string
  /** Bearer secret for the tick (stored in Vault as cron_secret). */
  secret?: string
}

export type PgCronJob = {
  jobname: string
  schedule: string
  command: string
  active: boolean
}

export interface PgCronStatus {
  installed: boolean
  jobs: PgCronJob[]
  /** Whether each Vault secret exists (values are never read back). */
  vault: { app_base_url: boolean; cron_secret: boolean } | null
}

async function hasSchema(client: SqlClient, name: string): Promise<boolean> {
  const { rows } = await client.query<{ ok: boolean }>('SELECT to_regnamespace($1) IS NOT NULL AS ok', [name])
  return rows[0]?.ok === true
}

async function upsertVaultSecret(client: SqlClient, name: string, value: string, description: string): Promise<'created' | 'updated'> {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM vault.secrets WHERE name = $1', [name])
  if (rows[0]) {
    await client.query('SELECT vault.update_secret($1::uuid, $2)', [rows[0].id, value])
    return 'updated'
  }
  await client.query('SELECT vault.create_secret($1, $2, $3)', [value, name, description])
  return 'created'
}

/** The usertasks-* pg_cron jobs and whether the Vault secrets exist. */
export async function pgCronStatus(client: SqlClient): Promise<PgCronStatus> {
  if (!(await hasSchema(client, 'cron'))) return { installed: false, jobs: [], vault: null }
  const { rows } = await client.query<PgCronJob>(
    `SELECT jobname, schedule, command, active FROM cron.job WHERE jobname LIKE 'usertasks-%' ORDER BY jobname`,
  )
  let vault: PgCronStatus['vault'] = null
  if (await hasSchema(client, 'vault')) {
    const names = await client.query<{ name: string }>('SELECT name FROM vault.secrets WHERE name = ANY($1::text[])', [
      [VAULT_BASE_URL_SECRET, VAULT_CRON_SECRET],
    ])
    const found = new Set(names.rows.map((row) => row.name))
    vault = { app_base_url: found.has(VAULT_BASE_URL_SECRET), cron_secret: found.has(VAULT_CRON_SECRET) }
  }
  return { installed: rows.length > 0, jobs: rows, vault }
}

/**
 * (Re)installs the pg_cron jobs and, when given, the Vault secrets.
 * Caller-owned transaction: wraps itself in BEGIN/COMMIT unless `inTransaction`.
 */
export async function installPgCron(
  client: SqlClient,
  options: PgCronInstallOptions = {},
  { inTransaction = false }: { inTransaction?: boolean } = {},
): Promise<{ jobs: string[]; vault: Record<string, 'created' | 'updated'> }> {
  if (!(await hasSchema(client, 'cron'))) throw new Error('pg_cron is not installed in this database (CREATE EXTENSION pg_cron)')
  if (!(await hasSchema(client, 'app_cron'))) throw new Error('app_cron schema missing: apply the database migrations first')
  const { rows: fn } = await client.query<{ ok: boolean }>(
    `SELECT to_regprocedure('app_cron.run_housekeeping(text, boolean, boolean, text, integer, integer)') IS NOT NULL AS ok`,
  )
  if (!fn[0]?.ok) throw new Error('app_cron.run_housekeeping missing: apply the database migrations first (20261109500000)')
  const vault: Record<string, 'created' | 'updated'> = {}
  if (!inTransaction) await client.query('BEGIN')
  try {
    if ((options.baseUrl || options.secret) && !(await hasSchema(client, 'vault'))) {
      throw new Error('Supabase Vault is not installed: the pg_cron scheduler reads its base URL and secret from Vault')
    }
    if (options.baseUrl) {
      vault[VAULT_BASE_URL_SECRET] = await upsertVaultSecret(client, VAULT_BASE_URL_SECRET, options.baseUrl.replace(/\/+$/, ''), 'Canonical app URL, reachable from the database')
    }
    if (options.secret) {
      vault[VAULT_CRON_SECRET] = await upsertVaultSecret(client, VAULT_CRON_SECRET, options.secret, 'Bearer secret for usertasks cron endpoints')
    }
    await client.query(`SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'usertasks-%'`)
    for (const job of PG_CRON_JOBS) {
      await client.query('SELECT cron.schedule($1, $2, $3)', [job.name, job.schedule, job.command])
    }
    if (!inTransaction) await client.query('COMMIT')
  } catch (error) {
    if (!inTransaction) await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
  return { jobs: PG_CRON_JOBS.map((job) => job.name), vault }
}

/** Unschedules every usertasks-* pg_cron job. Vault secrets are left alone. */
export async function uninstallPgCron(client: SqlClient): Promise<string[]> {
  if (!(await hasSchema(client, 'cron'))) return []
  const { rows } = await client.query<{ jobname: string }>(
    `SELECT jobname FROM cron.job WHERE jobname LIKE 'usertasks-%' ORDER BY jobname`,
  )
  for (const row of rows) await client.query('SELECT cron.unschedule($1)', [row.jobname])
  return rows.map((row) => row.jobname)
}
