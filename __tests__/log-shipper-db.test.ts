/**
 * SQL-level checks for supabase/migrations/20261024000003_log_shipper.sql:
 * claim_next_log_destination leasing under concurrency, purge marks, grants
 * (incl. the worker RPC revokes) and the pg_cron schedule.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/log-shipper-db.test.ts
 * Concurrency needs committed rows: the test tenant is created up front and
 * deleted (cascading to its destinations, events and marks) at the end.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities } from './helpers/db-capabilities'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()

const TENANT = '0f000000-0000-4000-8000-000000000001'
const D1 = '0f000000-0000-4000-8000-0000000000d1'
const D2 = '0f000000-0000-4000-8000-0000000000d2'

describe.skipIf(!DB_URL)('log shipper SQL (local DB)', () => {
  const a = new Client({ connectionString: DB_URL })
  const b = new Client({ connectionString: DB_URL })

  beforeAll(async () => {
    await a.connect()
    await b.connect()
    await a.query(`DELETE FROM public.tenants WHERE id = $1`, [TENANT])
    await a.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Shipper Test', 'shipper-test')`, [TENANT])
    // Other destinations on the stack must not interfere with claims here.
    await a.query(`UPDATE public.log_destinations SET next_attempt_at = now() + interval '1 hour' WHERE tenant_id <> $1 AND enabled`, [TENANT])
  })

  afterAll(async () => {
    await a.query(`DELETE FROM public.tenants WHERE id = $1`, [TENANT])
    await a.end()
    await b.end()
  })

  beforeEach(async () => {
    await a.query(`DELETE FROM public.log_destinations WHERE tenant_id = $1`, [TENANT])
    await a.query(
      `INSERT INTO public.log_destinations (id, tenant_id, name, type, config, next_attempt_at)
       VALUES ($1, $3, 'one', 'webhook', '{"url":"https://example.com/a"}', now() - interval '1 second'),
              ($2, $3, 'two', 'webhook', '{"url":"https://example.com/b"}', now() - interval '1 second')`,
      [D1, D2, TENANT],
    )
  })

  const claim = async (client: Client, worker: string, lockSeconds = 120) =>
    (await client.query(`SELECT public.claim_next_log_destination($1, $2) AS row`, [worker, lockSeconds])).rows[0].row as Record<string, unknown> | null

  it('concurrent claims never return the same destination (SKIP LOCKED)', async () => {
    await a.query('BEGIN')
    const first = await claim(a, 'worker-a')
    // b runs while a still holds the row lock.
    const second = await claim(b, 'worker-b')
    await a.query('COMMIT')
    const third = await claim(b, 'worker-c')
    expect(first?.id).toBeDefined()
    expect(second?.id).toBeDefined()
    expect(second?.id).not.toBe(first?.id)
    expect(third).toBeNull()
    expect(first).toMatchObject({ locked_by: 'worker-a', purged_through: 0 })

    // Both connections racing (each client runs its queries in order).
    const results = await Promise.all([a, b].map(async (client, i) => {
      const out: Array<Record<string, unknown> | null> = []
      for (let k = 0; k < 3; k++) out.push(await claim(client, `w${i}-${k}`))
      return out
    }))
    expect(results.flat().every((r) => r === null)).toBe(true)
  })

  it('honours enabled, next_attempt_at and lease expiry', async () => {
    await a.query(`UPDATE public.log_destinations SET enabled = false WHERE id = $1`, [D1])
    await a.query(`UPDATE public.log_destinations SET next_attempt_at = now() + interval '1 minute' WHERE id = $1`, [D2])
    expect(await claim(a, 'w')).toBeNull()

    await a.query(`UPDATE public.log_destinations SET next_attempt_at = NULL WHERE id = $1`, [D2])
    expect((await claim(a, 'w'))?.id).toBe(D2)
    expect(await claim(a, 'w2')).toBeNull() // leased

    await a.query(`UPDATE public.log_destinations SET locked_at = now() - interval '200 seconds' WHERE id = $1`, [D2])
    expect((await claim(a, 'w3'))?.locked_by).toBe('w3') // lease expired
  })

  it('leasing does not bump updated_at; config changes do', async () => {
    const before = (await a.query(`SELECT updated_at FROM public.log_destinations WHERE id = $1`, [D1])).rows[0].updated_at
    await a.query(`UPDATE public.log_destinations SET locked_by = 'x', locked_at = now(), cursor = 5 WHERE id = $1`, [D1])
    const leased = (await a.query(`SELECT updated_at FROM public.log_destinations WHERE id = $1`, [D1])).rows[0].updated_at
    expect(leased.getTime()).toBe(before.getTime())
    await a.query(`UPDATE public.log_destinations SET name = 'renamed' WHERE id = $1`, [D1])
    const renamed = (await a.query(`SELECT updated_at FROM public.log_destinations WHERE id = $1`, [D1])).rows[0].updated_at
    expect(renamed.getTime()).toBeGreaterThanOrEqual(before.getTime())
  })

  it('purge_event_stream records the purge mark returned by claims', async () => {
    const ids = (await a.query(
      `INSERT INTO public.event_stream (tenant_id, occurred_at, type, category, message, source_table)
       VALUES ($1, now() - interval '10 days', 'task.created', 'task', 'old', 'test'),
              ($1, now() - interval '9 days', 'task.created', 'task', 'old', 'test'),
              ($1, now(), 'task.created', 'task', 'new', 'test')
       RETURNING id`, [TENANT],
    )).rows.map((r) => Number(r.id))
    const deleted = (await a.query(`SELECT public.purge_event_stream($1, now() - interval '1 day', 100) AS n`, [TENANT])).rows[0].n
    expect(deleted).toBe(2)
    const mark = (await a.query(`SELECT purged_through FROM public.event_stream_purge_marks WHERE tenant_id = $1`, [TENANT])).rows[0]
    expect(Number(mark.purged_through)).toBe(ids[1])
    const claimed = await claim(a, 'w')
    expect(Number(claimed?.purged_through)).toBe(ids[1])
  })

  it('the claim RPC and the queue worker RPCs are service_role only', async () => {
    const fns = [
      `public.claim_next_log_destination('x', 1)`,
      `public.claim_next_job('x')`,
      `public.complete_job(gen_random_uuid(), '{}'::jsonb)`,
      `public.fail_job(gen_random_uuid(), 'x')`,
      `public.claim_next_agent_job('x')`,
      `public.complete_agent_job(gen_random_uuid(), '{}'::jsonb, NULL)`,
      `public.fail_agent_job(gen_random_uuid(), 'x')`,
      `public.claim_next_deletion_job('x')`,
      `public.complete_deletion_job(gen_random_uuid())`,
      `public.fail_deletion_job(gen_random_uuid(), 'x')`,
    ]
    for (const role of ['anon', 'authenticated']) {
      for (const fn of fns) {
        await a.query('BEGIN')
        await a.query(`SET LOCAL ROLE ${role}`)
        await expect(a.query(`SELECT ${fn}`), `${role} ${fn}`).rejects.toThrow(/permission denied/)
        await a.query('ROLLBACK')
      }
    }
    for (const fn of ['claim_next_log_destination(text,integer)', 'claim_next_job(text)', 'fail_deletion_job(uuid,text)']) {
      const { rows } = await a.query(`SELECT has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') AS ok`)
      expect(rows[0].ok, fn).toBe(true)
    }
    const { rows } = await a.query(`SELECT has_table_privilege('authenticated', 'public.event_stream_purge_marks', 'SELECT') AS ok`)
    expect(rows[0].ok).toBe(false)
  })

  // 20261103100000_cron_consolidation.sql replaces the job with the
  // per-minute scheduler tick, which runs ship-events (lib/jobs/registry.ts).
  it.skipIf(!CAPS?.pgCron)('ships every minute (usertasks-ship-events, or the consolidated usertasks-tick)', async () => {
    const { rows } = await a.query(
      `SELECT jobname, schedule, command FROM cron.job WHERE jobname IN ('usertasks-ship-events', 'usertasks-tick')`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].schedule).toBe('* * * * *')
    expect(rows[0].command).toContain(rows[0].jobname === 'usertasks-tick' ? '/api/cron/tick' : '/api/cron/ship-events')
  })
})
