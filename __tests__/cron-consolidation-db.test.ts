/**
 * SQL-level checks for supabase/migrations/20261103100000_cron_consolidation.sql:
 * it leaves exactly two usertasks-* pg_cron jobs, purges old run history, and
 * its tick RPCs behave (lease, history, probe, grants).
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/cron-consolidation-db.test.ts
 * Everything runs inside one transaction that is rolled back, so the stack's
 * own cron jobs and history are left as they were.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()
const MIGRATION = readFileSync(path.join(process.cwd(), 'supabase/migrations/20261103100000_cron_consolidation.sql'), 'utf8')

// pg_cron is optional off Supabase (the worker / external schedulers replace it).
describe.skipIf(!DB_URL || !CAPS?.pgCron)('cron consolidation migration (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => {
    await db.connect()
    await db.query('BEGIN')
    // A legacy usertasks job plus one that is not ours.
    await db.query(`SELECT cron.schedule('usertasks-legacy-test', '*/7 * * * *', 'select 1')`)
    await db.query(`SELECT cron.schedule('other-app-test-job', '0 0 * * *', 'select 1')`)
    // Run history: 3 old, 1 old with no end_time, 2 recent (explicit runids:
    // postgres may not use cron.runid_seq).
    await db.query(`
      INSERT INTO cron.job_run_details (runid, jobid, job_pid, database, username, command, status, return_message, start_time, end_time)
      SELECT 9000000000 + row_number() OVER (), 0, 0, 'postgres', 'postgres', 'consolidation-test ' || label, 'succeeded', '', s, e
        FROM (VALUES
          ('old-1', now() - interval '30 days', now() - interval '30 days'),
          ('old-2', now() - interval '3 days',  now() - interval '3 days'),
          ('old-3', now() - interval '49 hours', now() - interval '49 hours'),
          ('old-noend', now() - interval '5 days', NULL::timestamptz),
          ('new-1', now() - interval '47 hours', now() - interval '47 hours'),
          ('new-2', now() - interval '1 minute', now())
        ) AS v(label, s, e)`)
    await db.query(MIGRATION)
  })

  afterAll(async () => {
    await db.query('ROLLBACK')
    await db.end()
  })

  const jobs = async () =>
    (await db.query<{ jobname: string; schedule: string; command: string }>(
      `SELECT jobname, schedule, command FROM cron.job WHERE jobname LIKE 'usertasks-%' ORDER BY jobname`,
    )).rows

  it('leaves exactly the tick and the housekeeping job', async () => {
    const rows = await jobs()
    expect(rows.map((r) => [r.jobname, r.schedule])).toEqual([
      ['usertasks-cron-housekeeping', '30 3 * * *'],
      ['usertasks-tick', '* * * * *'],
    ])
    expect(rows.find((r) => r.jobname === 'usertasks-tick')?.command).toContain(`app_cron.invoke_endpoint('/api/cron/tick', 'POST'`)
    expect(rows.find((r) => r.jobname === 'usertasks-cron-housekeeping')?.command).toBe('select app_cron.housekeeping()')
  })

  it('does not touch other applications’ jobs', async () => {
    const { rowCount } = await db.query(`SELECT 1 FROM cron.job WHERE jobname = 'other-app-test-job'`)
    expect(rowCount).toBe(1)
  })

  it('purged run history older than 2 days and kept the rest', async () => {
    const { rows } = await db.query<{ command: string }>(
      `SELECT command FROM cron.job_run_details WHERE command LIKE 'consolidation-test %' ORDER BY command`,
    )
    expect(rows.map((r) => r.command)).toEqual(['consolidation-test new-1', 'consolidation-test new-2'])
    const { rows: [old] } = await db.query(`SELECT count(*)::int AS n FROM cron.job_run_details WHERE end_time < now() - interval '2 days'`)
    expect(old.n).toBe(0)
  })

  it('is idempotent', async () => {
    await db.query(MIGRATION)
    expect((await jobs()).map((r) => r.jobname)).toEqual(['usertasks-cron-housekeeping', 'usertasks-tick'])
  })

  it('housekeeping returns what it purged', async () => {
    const { rows: [row] } = await db.query(`SELECT app_cron.housekeeping() AS r`)
    expect(row.r).toEqual({ job_run_details: 0, http_responses: expect.any(Number) })
  })

  it('tick lease: one holder at a time, released by its holder only', async () => {
    const acquire = async (holder: string) => (await db.query(`SELECT public.cron_tick_acquire($1, 55) AS r`, [holder])).rows[0].r
    await db.query(`UPDATE app_cron.tick_lock SET locked_until = '-infinity'`)
    expect(await acquire('t1')).toMatchObject({ acquired: true })
    expect(await acquire('t2')).toEqual({ acquired: false })
    await db.query(`SELECT public.cron_tick_release('t2')`)
    expect(await acquire('t3')).toEqual({ acquired: false })
    await db.query(`SELECT public.cron_tick_release('t1')`)
    expect(await acquire('t4')).toMatchObject({ acquired: true })
    await db.query(`SELECT public.cron_tick_release('t4')`)
  })

  it('tick history: record then read back through acquire', async () => {
    await db.query(`SELECT public.cron_tick_record($1::jsonb)`, [JSON.stringify([
      { job_name: 'consolidation-test-job', last_started_at: '2026-10-25T03:00:00Z' },
    ])])
    await db.query(`SELECT public.cron_tick_record($1::jsonb)`, [JSON.stringify([
      { job_name: 'consolidation-test-job', last_started_at: '2026-10-25T03:00:00Z', last_finished_at: '2026-10-25T03:00:04Z', last_status: 'ok', last_duration_ms: 4000 },
    ])])
    const { rows: [run] } = await db.query(`SELECT * FROM app_cron.tick_runs WHERE job_name = 'consolidation-test-job'`)
    expect(run).toMatchObject({ last_status: 'ok', last_duration_ms: 4000 })
    const { rows: [acq] } = await db.query(`SELECT public.cron_tick_acquire('t5', 55) AS r`)
    expect(acq.r.last_started['consolidation-test-job']).toMatch(/^2026-10-25T03:00:00/)
    await db.query(`SELECT public.cron_tick_release('t5')`)
  })

  it('probe answers every isEnabled key with a boolean', async () => {
    const { rows: [row] } = await db.query(`SELECT public.cron_tick_probe() AS r`)
    expect(Object.keys(row.r).sort()).toEqual([
      'agent_queue', 'deletions', 'directory_sync', 'escalations', 'github_deployments', 'github_sync',
      'log_destinations', 'oauth_connectors', 'reminders', 'schedules', 'sla', 'workflow_queue',
    ])
    for (const value of Object.values(row.r)) expect(typeof value).toBe('boolean')
  })

  it('tick RPCs are service_role only', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.query('SAVEPOINT grants')
      await db.query(`SET LOCAL ROLE ${role}`)
      await expect(db.query(`SELECT public.cron_tick_probe()`)).rejects.toMatchObject({ code: '42501' })
      await db.query('ROLLBACK TO SAVEPOINT grants')
      await db.query('SAVEPOINT grants')
      await db.query(`SET LOCAL ROLE ${role}`)
      await expect(db.query(`SELECT public.cron_tick_acquire('x', 1)`)).rejects.toMatchObject({ code: '42501' })
      await db.query('ROLLBACK TO SAVEPOINT grants')
    }
    await db.query('SAVEPOINT grants')
    await db.query(`SET LOCAL ROLE service_role`)
    const { rows: [row] } = await db.query(`SELECT public.cron_tick_probe() IS NOT NULL AS ok`)
    expect(row.ok).toBe(true)
    await db.query('ROLLBACK TO SAVEPOINT grants')
  })
})
