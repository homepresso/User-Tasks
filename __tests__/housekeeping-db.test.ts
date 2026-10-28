/**
 * SQL-level checks for supabase/migrations/20261109500000_instance_housekeeping.sql:
 * app_cron.run_housekeeping() reads the `housekeeping.*` settings, purges in
 * batches within its budget, skips when disabled / not due / busy, records
 * its passes, and its RPCs are service_role only.
 *
 * Runs against the local Supabase stack or plain PostgreSQL — set
 * EVENT_STREAM_DB_URL. pg_cron / pg_net cases skip where those aren't
 * installed. Everything runs inside one transaction that is rolled back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities, setRoleSql } from './helpers/db-capabilities'
import { PG_CRON_JOBS } from '@/lib/providers/scheduler/pg-cron'
import { sqlHousekeeping } from '@/lib/admin/housekeeping'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()

type Run = { status: string; reason?: string; deleted: Record<string, number>; notes: Record<string, string>; more: boolean }

describe.skipIf(!DB_URL)('instance housekeeping (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const other = new Client({ connectionString: DB_URL })
  let hasNet = false

  // Another pass (the stack's own pg_cron job, a parallel test file) can hold
  // the pass lock for a moment: wait for it rather than see 'busy'.
  const run = async (args: string): Promise<Run> => {
    for (let attempt = 0; ; attempt++) {
      const r: Run = (await db.query(`SELECT app_cron.run_housekeeping(${args}) AS r`)).rows[0].r
      if (r.reason !== 'busy' || attempt >= 40) return r
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const setting = async (key: string, value: unknown) => {
    await db.query(
      `INSERT INTO public.instance_settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, JSON.stringify(value)],
    )
  }
  const count = async (sql: string) => Number((await db.query(sql)).rows[0].n)

  beforeAll(async () => {
    await db.connect()
    await other.connect()
    await db.query('BEGIN')
    // A clean slate: no recorded passes (the stack's own pg_cron passes are rolled back with us).
    await db.query('DELETE FROM app_cron.housekeeping_runs')
    await db.query(`DELETE FROM public.instance_settings WHERE key LIKE 'housekeeping.%'`)
    hasNet = (await db.query(`SELECT to_regclass('net._http_response') IS NOT NULL AS ok`)).rows[0].ok
  })

  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
    await other.end()
  })

  it('defaults: on, hourly, 1 day of cron history, 1 hour of responses', async () => {
    const { rows: [row] } = await db.query('SELECT app_cron.housekeeping_settings() AS s')
    expect(row.s).toEqual({ enabled: true, interval_minutes: 60, cron_history_hours: 24, http_response_minutes: 60 })
    await setting('housekeeping.cron_history_hours', 0)
    await setting('housekeeping.interval_minutes', '30')
    await setting('housekeeping.enabled', 'nonsense')
    expect((await db.query('SELECT app_cron.housekeeping_settings() AS s')).rows[0].s)
      .toEqual({ enabled: true, interval_minutes: 30, cron_history_hours: 24, http_response_minutes: 60 })
    await db.query(`DELETE FROM public.instance_settings WHERE key LIKE 'housekeeping.%'`)
  })

  it('the key check accepts housekeeping.* and still refuses unknown namespaces', async () => {
    await db.query('SAVEPOINT k')
    await expect(db.query(`INSERT INTO public.instance_settings (key, value) VALUES ('nonsense.key', '1')`)).rejects.toMatchObject({ code: '23514' })
    await db.query('ROLLBACK TO SAVEPOINT k')
  })

  it.skipIf(!CAPS?.pgCron)('purges cron.job_run_details by the configured retention, in batches', async () => {
    await db.query(`DELETE FROM cron.job_run_details WHERE command LIKE 'hk-test %'`)
    // 12,000 rows 30 h old, 5 rows 10 h old, 1 row 50 h old with no end_time.
    await db.query(`
      INSERT INTO cron.job_run_details (runid, jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
      SELECT 9100000000 + g, 0, 0, 'postgres', 'postgres', 'hk-test old', 'succeeded', '', now() - interval '30 hours', now() - interval '30 hours'
        FROM generate_series(1, 12000) g
      UNION ALL
      SELECT 9100100000 + g, 0, 0, 'postgres', 'postgres', 'hk-test recent', 'succeeded', '', now() - interval '10 hours', now() - interval '10 hours'
        FROM generate_series(1, 5) g
      UNION ALL
      SELECT 9100200000, 0, 0, 'postgres', 'postgres', 'hk-test noend', 'running', '', now() - interval '50 hours', NULL`)
    const left = (label: string) => count(`SELECT count(*) AS n FROM cron.job_run_details WHERE command = 'hk-test ${label}'`)

    // Retention 48 h: only the 50 h row goes.
    await setting('housekeeping.cron_history_hours', 48)
    const dry = await run(`'cli', true, true`)
    expect(dry.deleted['cron.job_run_details']).toBeGreaterThanOrEqual(1)
    expect(await left('noend')).toBe(1) // a dry run deletes nothing
    await run(`'cli', true, false`)
    expect([await left('old'), await left('recent'), await left('noend')]).toEqual([12000, 5, 0])

    // Back to the default (24 h): the 30 h rows go, 5,000 per statement;
    // with two batches allowed the pass stops with more to do.
    await db.query(`DELETE FROM public.instance_settings WHERE key = 'housekeeping.cron_history_hours'`)
    // A shared local stack also holds real pg_cron history older than 24 h,
    // which the same batches may purge first.
    const otherOld = () => count(`SELECT count(*) AS n FROM cron.job_run_details WHERE command NOT LIKE 'hk-test %' AND end_time < now() - interval '24 hours'`)
    const otherOldBefore = await otherOld()
    const partial = await run(`'cli', true, false, 'test', 20000, 2`)
    expect(partial).toMatchObject({ status: 'partial', more: true })
    expect(partial.notes['cron.job_run_details']).toBe('budget')
    expect(partial.deleted['cron.job_run_details']).toBe(10000)
    expect((await left('old')) + (await otherOld())).toBe(2000 + otherOldBefore)
    const rest = await run(`'cli', true, false, 'test', 20000, 2`)
    expect(rest.deleted['cron.job_run_details']).toBeGreaterThanOrEqual(2000)
    expect(rest.more).toBe(false)
    expect([await left('old'), await left('recent')]).toEqual([0, 5])
  })

  it.skipIf(!CAPS?.pgCron)('pg_cron schedules the pass and the daily catch-up exactly as lib/providers/scheduler/pg-cron.ts says', async () => {
    const { rows } = await db.query<{ jobname: string; schedule: string; command: string }>(
      `SELECT jobname, schedule, command FROM cron.job WHERE jobname IN ('usertasks-housekeeping', 'usertasks-cron-housekeeping') ORDER BY jobname`,
    )
    const expected = PG_CRON_JOBS.filter((j) => j.name !== 'usertasks-tick').map((j) => [j.name, j.schedule, j.command]).sort()
    expect(rows.map((r) => [r.jobname, r.schedule, r.command])).toEqual(expected)
    // The scheduled command itself runs (and, with a pass just recorded, is not due).
    const { rows: [scheduled] } = await db.query(rows.find((r) => r.jobname === 'usertasks-housekeeping')!.command.replace(/^select /, 'SELECT ') + ' AS r')
    expect(scheduled.r).toMatchObject({ status: 'skipped', reason: 'not_due' })
  })

  it.skipIf(!CAPS?.pgCron)('purges net._http_response by its retention, or reports it not applicable', async () => {
    if (!hasNet) {
      expect((await run(`'cli', true, true`)).notes['net._http_response']).toBe('not_installed')
      return
    }
    await db.query(`INSERT INTO net._http_response (id, status_code, created) VALUES (9100000001, 200, now() - interval '3 hours'), (9100000002, 200, now() - interval '5 minutes')`)
    await setting('housekeeping.http_response_minutes', 120)
    await run(`'cli', true, false`)
    const { rows } = await db.query(`SELECT id::text FROM net._http_response WHERE id IN (9100000001, 9100000002)`)
    expect(rows.map((r) => r.id)).toEqual(['9100000002'])
  })

  it('reports pg_net / pg_cron as not installed where they are missing', async () => {
    const result = await run(`'cli', true, true`)
    if (!CAPS?.pgCron) expect(result.notes['cron.job_run_details']).toBe('not_installed')
    if (!hasNet) expect(result.notes['net._http_response']).toBe('not_installed')
    expect(result.status).toBe('ok')
  })

  it('purges expired cache-store and built-in auth rows, keeping live ones', async () => {
    await db.query(`INSERT INTO app_cache.entries (key, value, expires_at) VALUES
      ('hk-test:expired', 'x', clock_timestamp() - interval '1 minute'),
      ('hk-test:live', 'x', clock_timestamp() + interval '1 hour'),
      ('hk-test:forever', 'x', NULL)`)
    await db.query(`INSERT INTO app_auth.replay_cache (key, expires_at) VALUES
      ('hk-test:old', now() - interval '1 minute'), ('hk-test:new', now() + interval '1 hour')`)
    await run(`'ui', true, false, 'ops@example.com'`)
    expect((await db.query(`SELECT key FROM app_cache.entries WHERE key LIKE 'hk-test:%' ORDER BY key`)).rows.map((r) => r.key))
      .toEqual(['hk-test:forever', 'hk-test:live'])
    expect((await db.query(`SELECT key FROM app_auth.replay_cache WHERE key LIKE 'hk-test:%'`)).rows.map((r) => r.key)).toEqual(['hk-test:new'])
  })

  it('records passes (not dry runs) and scheduled passes wait for the interval', async () => {
    const before = await count('SELECT count(*) AS n FROM app_cron.housekeeping_runs')
    await run(`'cli', true, true`)
    expect(await count('SELECT count(*) AS n FROM app_cron.housekeeping_runs')).toBe(before)
    const { rows: [last] } = await db.query(`SELECT trigger, actor, status FROM app_cron.housekeeping_runs ORDER BY started_at DESC, id DESC LIMIT 1`)
    expect(last).toMatchObject({ trigger: 'ui', actor: 'ops@example.com', status: 'ok' })

    expect(await run(`'pg_cron'`)).toMatchObject({ status: 'skipped', reason: 'not_due' })
    expect(await run(`'tick'`)).toMatchObject({ status: 'skipped', reason: 'not_due' })
    // Once the interval has passed, a scheduled pass runs.
    await db.query(`UPDATE app_cron.housekeeping_runs SET started_at = started_at - interval '2 hours'`)
    expect((await run(`'tick'`)).status).toBe('ok')
    // A shorter interval: due again after 15 (less 2) minutes.
    await setting('housekeeping.interval_minutes', 15)
    await db.query(`UPDATE app_cron.housekeeping_runs SET started_at = started_at - interval '14 minutes'`)
    expect((await run(`'pg_cron'`)).status).toBe('ok')
  })

  it('disabled stops scheduled passes; an operator run still runs', async () => {
    await setting('housekeeping.enabled', false)
    expect(await run(`'pg_cron', true`)).toMatchObject({ status: 'skipped', reason: 'disabled' })
    expect(await run(`'tick-daily', true`)).toMatchObject({ status: 'skipped', reason: 'disabled' })
    expect((await run(`'cli', true`)).status).toBe('ok')
    await setting('housekeeping.enabled', true)
  })

  it('a pass already running makes others skip (advisory lock)', async () => {
    // This session holds the pass lock until it rolls back.
    const { rows: [row] } = await other.query(`SELECT app_cron.run_housekeeping('cli', true, true) AS r`)
    expect(row.r).toMatchObject({ status: 'skipped', reason: 'busy' })
  })

  it('rejects unknown triggers', async () => {
    await db.query('SAVEPOINT t')
    await expect(run(`'cron-job-from-elsewhere'`)).rejects.toMatchObject({ code: '22023' })
    await db.query('ROLLBACK TO SAVEPOINT t')
  })

  it('status reports settings, tables and passes; the admin client reads it', async () => {
    const status = await sqlHousekeeping(db).status()
    expect(status.settings).toMatchObject({ enabled: true, interval_minutes: 15 })
    expect(status.stored.map((s) => s.key)).toEqual(expect.arrayContaining(['housekeeping.enabled', 'housekeeping.interval_minutes']))
    const tables = Object.fromEntries(status.tables.map((t) => [t.table, t]))
    expect(tables['app_cache.entries']).toMatchObject({ installed: true, purged_by: 'housekeeping' })
    expect(tables['public.event_stream']).toMatchObject({ installed: true, purged_by: 'cleanup-logs' })
    expect(tables['public.instance_provider_switches']).toMatchObject({ purged_by: 'kept' })
    expect(tables['cron.job_run_details'].installed).toBe(Boolean(CAPS?.pgCron))
    expect(status.runs[0]).toMatchObject({ trigger: expect.any(String), status: expect.stringMatching(/ok|partial/) })
    expect(status.pg_cron_jobs === null).toBe(!CAPS?.pgCron)
  })

  it('RPCs are service_role only', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const sql of [`SELECT public.instance_housekeeping_status()`, `SELECT public.instance_housekeeping_run('ui', true, true)`, `SELECT app_cron.run_housekeeping('cli', true, true)`]) {
        await db.query('SAVEPOINT grants')
        await db.query(`SET LOCAL ROLE ${role}`)
        await expect(db.query(sql), `${role}: ${sql}`).rejects.toMatchObject({ code: '42501' })
        await db.query('ROLLBACK TO SAVEPOINT grants')
      }
    }
    await db.query('SAVEPOINT grants')
    await db.query(setRoleSql('service_role', CAPS))
    const { rows: [row] } = await db.query(`SELECT public.instance_housekeeping_run('ui', true, true, 'svc') AS r, public.instance_housekeeping_status() IS NOT NULL AS ok`)
    expect(row.r.status).toBe('ok')
    expect(row.ok).toBe(true)
    await db.query('ROLLBACK TO SAVEPOINT grants')
  })
})
