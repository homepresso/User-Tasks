/**
 * SQL checks for supabase/migrations/20270125100000_run_checkpoints.sql:
 * checkpoint_run_step merges completed / started steps only into the running
 * segment, complete_leased_job keeps a request/response run's HTTP response
 * (capped), the effects / relay tables are service role only, and the purge
 * functions delete old rows. LOCAL database only (EVENT_STREAM_DB_URL); runs
 * in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const TENANT = '0e100000-0000-4000-8000-00000000000a'
const WF = '0e100000-0000-4000-8000-0000000000a1'
const RUN = '0e100000-0000-4000-8000-0000000000c1'

describe.skipIf(!DB_URL)('run checkpoints (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })
  beforeEach(async () => {
    await db.query('BEGIN')
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'CP', 'cp-test')`, [TENANT])
    await db.query(`INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type) VALUES ($1, $2, 'cp', true, 'manual')`, [WF, TENANT])
    await db.query(
      `INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status, checkpoint) VALUES ($1, $2, $3, 'running', $4)`,
      [RUN, WF, TENANT, JSON.stringify({ v: 1, segment: 'seg-1', base: { kind: 'start' }, completed: {}, started: {} })],
    )
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  const checkpoint = async () => (await db.query(`SELECT checkpoint FROM public.workflow_runs WHERE id = $1`, [RUN])).rows[0].checkpoint

  it('checkpoint_run_step merges steps into the running segment only', async () => {
    const step = async (segment: string, completed: unknown, started: unknown) =>
      (await db.query(`SELECT public.checkpoint_run_step($1, $2, $3, $4) AS ok`, [RUN, segment, completed && JSON.stringify(completed), started && JSON.stringify(started)])).rows[0].ok
    expect(await step('seg-1', null, { 'a#1': 't1' })).toBe(true)
    expect(await step('seg-1', { 'a#1': { o: 1, d: {} } }, { 'b#1': 't2' })).toBe(true)
    expect(await step('seg-other', { 'x#1': { o: 2, d: {} } }, null)).toBe(false)
    expect(await checkpoint()).toMatchObject({ segment: 'seg-1', completed: { 'a#1': { o: 1 } }, started: { 'a#1': 't1', 'b#1': 't2' } })
    expect((await checkpoint()).completed['x#1']).toBeUndefined()
    await db.query(`UPDATE public.workflow_runs SET status = 'completed' WHERE id = $1`, [RUN])
    expect(await step('seg-1', { 'c#1': { o: 3, d: {} } }, null)).toBe(false)
  })

  it('complete_leased_job keeps the HTTP response (up to 4 MB)', async () => {
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO public.workflow_queue (workflow_id, tenant_id, trigger_type, status, locked_by, locked_at) VALUES ($1, $2, 'engine_call', 'processing', 'w1', now()) RETURNING id`, [WF, TENANT])
    const response = { statusCode: 201, headers: { 'x-a': '1' }, bodyType: 'json', body: { ok: true } }
    await db.query(`SELECT public.complete_leased_job($1, 'w1', $2)`, [id, JSON.stringify({ status: 'completed', run_id: RUN, response, node_results: { big: 1 } })])
    const { rows: [row] } = await db.query(`SELECT result FROM public.workflow_queue WHERE id = $1`, [id])
    expect(row.result).toEqual({ status: 'completed', run_id: RUN, response })
  })

  it('effects and relay tables: service role only; purges delete old rows', async () => {
    for (const table of ['workflow_step_effects', 'workflow_run_event_relay']) {
      const { rows: [g] } = await db.query(
        `SELECT has_table_privilege('authenticated', $1, 'SELECT') AS auth, has_table_privilege('anon', $1, 'SELECT') AS anon, has_table_privilege('service_role', $1, 'INSERT') AS service`, [`public.${table}`])
      expect(g, table).toEqual({ auth: false, anon: false, service: true })
    }
    await db.query(`INSERT INTO public.workflow_step_effects (key, tenant_id, kind, created_at) VALUES ('old', $1, 'send_email', now() - interval '40 days'), ('new', $1, 'send_email', now())`, [TENANT])
    expect((await db.query(`SELECT public.purge_step_effects(now() - interval '30 days') AS n`)).rows[0].n).toBe(1)
    await db.query(`INSERT INTO public.workflow_run_event_relay (job_id, seq, event, created_at) VALUES ($1, 1, '{}', now() - interval '2 days')`, [RUN])
    expect((await db.query(`SELECT public.purge_run_event_relay(now() - interval '1 day') AS n`)).rows[0].n).toBeGreaterThanOrEqual(1)
  })
})
