/**
 * SQL-level checks for supabase/migrations/20261026000000_queue_dispatch.sql:
 * claim_jobs (batch claim, SKIP LOCKED between concurrent workers, same
 * predicate/order/bookkeeping as claim_next_job), release_jobs, slim
 * complete_job, enqueue_workflow_batch tenant checks, purge_queue_history and
 * the grants.
 *
 * Runs only against a LOCAL Supabase stack — set EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npx vitest run __tests__/queue-dispatch-db.test.ts
 * The concurrency test commits its rows (two connections) and deletes them
 * afterwards; its jobs use a priority far above anything else so the claims
 * only ever pick them. Everything else runs in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities, setRoleSql } from './helpers/db-capabilities'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = await dbCapabilities()

const TENANT = '0c000000-0000-4000-8000-00000000000a'
const OTHER_TENANT = '0c000000-0000-4000-8000-00000000000b'
const USER = '0c000000-0000-4000-8000-000000000001'
const WF = '0c000000-0000-4000-8000-0000000000a1'
const OTHER_WF = '0c000000-0000-4000-8000-0000000000b1'
const TOP_PRIORITY = 1_000_000

const WORKER_FNS = [
  'public.claim_jobs(text, integer)',
  'public.release_jobs(uuid[], text)',
  'public.complete_job(uuid, jsonb)',
  'public.purge_queue_history(timestamp with time zone, integer)',
]

async function seedTenants(db: Client) {
  await db.query(
    `INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Queue A', 'queue-a'), ($2, 'Queue B', 'queue-b')`,
    [TENANT, OTHER_TENANT],
  )
  await db.query(
    `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type)
     VALUES ($1, $2, 'A', true, 'manual'), ($3, $4, 'B', true, 'manual')`,
    [WF, TENANT, OTHER_WF, OTHER_TENANT],
  )
}

async function insertJobs(db: Client, n: number, extra: { status?: string; priority?: number; scheduledOffset?: string; attempts?: number; nextRetry?: string; createdAt?: string } = {}) {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.workflow_queue (workflow_id, tenant_id, trigger_type, status, priority, scheduled_for, attempts, next_retry_at, created_at)
     SELECT $1, $2, 'manual', $3, $4, now() + $5::interval + (g || ' milliseconds')::interval, $6, $7::timestamptz, coalesce($8::timestamptz, now())
     FROM generate_series(1, $9) g
     RETURNING id`,
    [WF, TENANT, extra.status ?? 'pending', extra.priority ?? TOP_PRIORITY, extra.scheduledOffset ?? '-1 minute', extra.attempts ?? 0, extra.nextRetry ?? null, extra.createdAt ?? null, n],
  )
  return rows.map((r) => r.id)
}

describe.skipIf(!DB_URL)('queue dispatch RPCs (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })

  beforeEach(async () => {
    await db.query('BEGIN')
    await seedTenants(db)
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  async function as(role: 'anon' | 'authenticated' | 'service_role', sql: string, params: unknown[] = []) {
    await db.query('SAVEPOINT caller')
    try {
      await db.query(setRoleSql(role, CAPS))
      const claims = role === 'authenticated' ? { sub: USER, role } : { role }
      await db.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)])
      const { rows } = await db.query(sql, params)
      await db.query('RELEASE SAVEPOINT caller')
      return { rows, error: null as null | { code?: string; message: string } }
    } catch (e) {
      await db.query('ROLLBACK TO SAVEPOINT caller')
      const err = e as { code?: string; message: string }
      return { rows: [], error: { code: err.code, message: err.message } }
    } finally {
      await db.query('RESET ROLE')
      await db.query(`SELECT set_config('request.jwt.claims', '', true)`)
    }
  }

  it('grants: worker RPCs and enqueue_workflow_batch are service_role only', async () => {
    for (const fn of WORKER_FNS) {
      const { rows } = await db.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [fn])
      expect(rows[0], fn).toEqual({ anon: false, auth: false, service: true })
    }
    const { rows } = await db.query(
      `SELECT has_function_privilege('anon', 'public.enqueue_workflow_batch(uuid, jsonb)', 'EXECUTE') AS anon,
              has_function_privilege('authenticated', 'public.enqueue_workflow_batch(uuid, jsonb)', 'EXECUTE') AS auth`)
    expect(rows[0]).toEqual({ anon: false, auth: false })
    expect((await as('authenticated', `SELECT * FROM public.claim_jobs('w', 1)`)).error?.message).toMatch(/permission denied/)
  })

  it('claim_jobs: runnable jobs only, by priority then scheduled_for, with claim_next_job bookkeeping', async () => {
    const [first, second] = await insertJobs(db, 2)
    const [urgent] = await insertJobs(db, 1, { priority: TOP_PRIORITY + 1 })
    const [retry] = await insertJobs(db, 1, { status: 'failed', attempts: 1, nextRetry: '2000-01-01' })
    const notRunnable = [
      ...await insertJobs(db, 1, { scheduledOffset: '1 hour' }), // delayed (e.g. delay_resume) — not yet
      ...await insertJobs(db, 1, { status: 'failed', attempts: 3, nextRetry: '2000-01-01' }), // out of attempts
      ...await insertJobs(db, 1, { status: 'failed', attempts: 1, nextRetry: '2999-01-01' }), // retry not due
    ]

    // Exactly as many as are runnable here: top priority, so other rows in the
    // local DB are never picked ahead of them.
    const { rows, error } = await as('service_role', `SELECT * FROM public.claim_jobs('worker-1', 4)`)
    expect(error).toBeNull()
    expect(rows.map((r) => r.id).sort()).toEqual([urgent, first, second, retry].sort())
    for (const row of rows) {
      expect(row).toMatchObject({ status: 'processing', locked_by: 'worker-1' })
      expect(row.locked_at).not.toBeNull()
      expect(row.started_at).not.toBeNull()
    }
    expect(rows.find((r) => r.id === retry)!.attempts).toBe(2)
    expect(rows.find((r) => r.id === first)!.attempts).toBe(1)
    // Same order claim_next_job would have picked them in.
    const { rows: ordered } = await db.query(
      `SELECT id FROM public.workflow_queue WHERE id = ANY($1) ORDER BY priority DESC, scheduled_for ASC`, [rows.map((r) => r.id)])
    expect(ordered[0].id).toBe(urgent)
    // A further claim does not pick the non-runnable ones.
    await as('service_role', `SELECT * FROM public.claim_jobs('worker-1', 10)`)
    const { rows: untouched } = await db.query(`SELECT status, locked_by FROM public.workflow_queue WHERE id = ANY($1)`, [notRunnable])
    expect(untouched.every((r) => r.status !== 'processing' && r.locked_by === null)).toBe(true)
  })

  it('claim_jobs uses the claim index', async () => {
    await db.query('SET LOCAL enable_seqscan = off')
    const { rows } = await db.query(
      `EXPLAIN SELECT id FROM public.workflow_queue
       WHERE ((status = 'pending' AND scheduled_for <= now()) OR (status = 'failed' AND attempts < max_attempts AND next_retry_at <= now()))
       ORDER BY priority DESC, scheduled_for ASC LIMIT 10`)
    expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toContain('idx_queue_claim')
  })

  it('release_jobs hands back only the worker\'s own claims, without counting the attempt', async () => {
    const ids = await insertJobs(db, 3)
    await as('service_role', `SELECT * FROM public.claim_jobs('worker-1', 3)`)
    const other = await as('service_role', `SELECT public.release_jobs($1, 'worker-2') AS n`, [ids])
    expect(other.rows[0].n).toBe(0)
    const own = await as('service_role', `SELECT public.release_jobs($1, 'worker-1') AS n`, [ids.slice(0, 2)])
    expect(own.rows[0].n).toBe(2)
    const { rows } = await db.query(`SELECT id, status, attempts, locked_by, started_at FROM public.workflow_queue WHERE id = ANY($1)`, [ids])
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
    expect(byId[ids[0]]).toMatchObject({ status: 'pending', attempts: 0, locked_by: null, started_at: null })
    expect(byId[ids[2]]).toMatchObject({ status: 'processing', attempts: 1, locked_by: 'worker-1' })
  })

  it('complete_job stores only the slim result', async () => {
    const [id] = await insertJobs(db, 1)
    await as('service_role', `SELECT public.complete_job($1, $2::jsonb)`, [id, JSON.stringify({
      status: 'completed', run_id: 'r1', node_results: { big: 'x'.repeat(10_000) }, logs: [1, 2, 3],
    })])
    const { rows } = await db.query(`SELECT status, result, completed_at FROM public.workflow_queue WHERE id = $1`, [id])
    expect(rows[0].status).toBe('completed')
    expect(rows[0].result).toEqual({ status: 'completed', run_id: 'r1' })
  })

  it('enqueue_workflow_batch: service role only (20261118000000), every workflow must belong to the tenant', async () => {
    await db.query(
      `INSERT INTO auth.users (id, email, instance_id, aud, role)
       VALUES ($1, 'queue@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [USER])
    await db.query(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member')`, [USER, TENANT])
    await db.query(`UPDATE public.users SET current_tenant_id = $2 WHERE id = $1`, [USER, TENANT])
    const jobs = (wf: string, n: number) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ workflow_id: wf, trigger_type: 'data_table_event', trigger_data: { n: i } })))

    // Members can no longer call it directly (the app enqueues with the service role).
    expect((await as('authenticated', `SELECT public.enqueue_workflow_batch($1, $2::jsonb)`, [TENANT, jobs(WF, 1)])).error?.message).toMatch(/permission denied/)
    const ok = await as('service_role', `SELECT public.enqueue_workflow_batch($1, $2::jsonb) AS n`, [TENANT, jobs(WF, 3)])
    expect(ok.error).toBeNull()
    expect(ok.rows[0].n).toBe(3)
    const { rows } = await db.query(`SELECT trigger_type, trigger_data, status FROM public.workflow_queue WHERE tenant_id = $1 ORDER BY trigger_data->>'n'`, [TENANT])
    expect(rows.map((r) => [r.trigger_type, r.trigger_data.n, r.status])).toEqual([['data_table_event', 0, 'pending'], ['data_table_event', 1, 'pending'], ['data_table_event', 2, 'pending']])

    expect((await as('service_role', `SELECT public.enqueue_workflow_batch($1, $2::jsonb)`, [TENANT, jobs(OTHER_WF, 1)])).error?.code).toBe('P0002')
    expect((await as('anon', `SELECT public.enqueue_workflow_batch($1, $2::jsonb)`, [TENANT, jobs(WF, 1)])).error?.message).toMatch(/permission denied/)
    expect((await as('service_role', `SELECT public.enqueue_workflow_batch($1, $2::jsonb) AS n`, [OTHER_TENANT, jobs(OTHER_WF, 2)])).rows[0].n).toBe(2)
    expect((await as('service_role', `SELECT public.enqueue_workflow_batch($1, '[]'::jsonb) AS n`, [TENANT])).rows[0].n).toBe(0)
  })

  it('purge_queue_history deletes finished rows before the cutoff in batches', async () => {
    const old = '2000-01-01T00:00:00Z'
    const done = await insertJobs(db, 3, { status: 'completed', createdAt: old })
    const dead = await insertJobs(db, 1, { status: 'dead', createdAt: old })
    const keepPending = await insertJobs(db, 1, { status: 'pending', createdAt: old })
    const keepRetry = await insertJobs(db, 1, { status: 'failed', attempts: 1, createdAt: old })
    const keepRecent = await insertJobs(db, 1, { status: 'completed' })

    const cutoff = '2000-06-01T00:00:00Z'
    const first = await as('service_role', `SELECT public.purge_queue_history($1, 2) AS r`, [cutoff])
    expect(first.rows[0].r.workflow_queue).toBe(2)
    const second = await as('service_role', `SELECT public.purge_queue_history($1, 10) AS r`, [cutoff])
    expect(second.rows[0].r.workflow_queue).toBe(2)
    const { rows } = await db.query(`SELECT id FROM public.workflow_queue WHERE id = ANY($1)`, [[...done, ...dead, ...keepPending, ...keepRetry, ...keepRecent]])
    expect(rows.map((r) => r.id).sort()).toEqual([...keepPending, ...keepRetry, ...keepRecent].sort())
  })
})

describe.skipIf(!DB_URL)('claim_jobs under concurrent workers (local DB, committed rows)', () => {
  const a = new Client({ connectionString: DB_URL })
  const b = new Client({ connectionString: DB_URL })
  let ids: string[] = []

  beforeAll(async () => {
    await Promise.all([a.connect(), b.connect()])
    await seedTenants(a)
    ids = await insertJobs(a, 40)
  })
  afterAll(async () => {
    await a.query(`DELETE FROM public.workflow_queue WHERE tenant_id IN ($1, $2)`, [TENANT, OTHER_TENANT])
    await a.query(`DELETE FROM public.workflows WHERE tenant_id IN ($1, $2)`, [TENANT, OTHER_TENANT])
    await a.query(`DELETE FROM public.tenants WHERE id IN ($1, $2)`, [TENANT, OTHER_TENANT])
    await Promise.all([a.end(), b.end()])
  })

  it('two workers claiming at the same time never get the same job (SKIP LOCKED)', async () => {
    // Worker A holds its claim open; worker B claims meanwhile.
    await a.query('BEGIN')
    await b.query('BEGIN')
    const { rows: claimedA } = await a.query(`SELECT id FROM public.claim_jobs('worker-a', 15)`)
    const { rows: claimedB } = await b.query(`SELECT id FROM public.claim_jobs('worker-b', 15)`)
    await Promise.all([a.query('COMMIT'), b.query('COMMIT')])
    expect(claimedA).toHaveLength(15)
    expect(claimedB).toHaveLength(15)
    const overlap = claimedA.filter((r) => claimedB.some((s) => s.id === r.id))
    expect(overlap).toEqual([])

    // Racing claims for the rest: every job claimed exactly once.
    const rounds = await Promise.all([
      a.query(`SELECT id FROM public.claim_jobs('worker-a', 5)`),
      b.query(`SELECT id FROM public.claim_jobs('worker-b', 5)`),
    ])
    const all = [...claimedA, ...claimedB, ...rounds[0].rows, ...rounds[1].rows].map((r) => r.id)
    expect(new Set(all).size).toBe(all.length)
    expect(all.sort()).toEqual([...ids].sort())
  })
})
