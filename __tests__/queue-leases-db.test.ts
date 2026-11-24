/**
 * SQL-level checks for supabase/migrations/20270124090000_queue_leases.sql:
 * leases on claim, renewal, expired-lease recovery (requeue with back-off /
 * dead after max_attempts / resume jobs whose run moved on), the recovery
 * run by claim_jobs, the lease fence on complete / fail, the queue UI's
 * recover_queue_job, get_queue_health, grants, and no double processing with
 * two workers recovering and claiming at the same time.
 *
 * Runs only against a LOCAL database with the migrations applied (Supabase
 * stack or plain PostgreSQL via usertasks-admin db migrate) — set
 * EVENT_STREAM_DB_URL, e.g.
 *   EVENT_STREAM_DB_URL=postgresql://postgres:postgres@127.0.0.1:<port>/postgres npx vitest run __tests__/queue-leases-db.test.ts
 * Never point it at a shared or live database: the concurrency test commits
 * rows (deleted afterwards) and recover_expired_jobs acts on every stuck job
 * in the database. Everything else runs in a rolled-back transaction.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { dbCapabilities, setRoleSql } from './helpers/db-capabilities'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const CAPS = DB_URL ? await dbCapabilities() : null

const TENANT = '0d000000-0000-4000-8000-00000000000a'
const WF = '0d000000-0000-4000-8000-0000000000a1'
const RUN = '0d000000-0000-4000-8000-0000000000c1'
const TOP_PRIORITY = 2_000_000

const NEW_FNS = [
  'public.claim_jobs(text, integer, integer)',
  'public.renew_job_leases(text, uuid[], integer)',
  'public.recover_expired_jobs(integer)',
  'public.complete_leased_job(uuid, text, jsonb)',
  'public.fail_leased_job(uuid, text, text)',
  'public.recover_queue_job(uuid, uuid, text, boolean)',
  'public.get_queue_health(uuid)',
  'public.claim_next_job(text)',
  'public.fail_job(uuid, text)',
]

async function seed(db: Client) {
  await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Leases', 'leases-test')`, [TENANT])
  await db.query(
    `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type) VALUES ($1, $2, 'L', true, 'manual')`,
    [WF, TENANT],
  )
  await db.query(
    `INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status) VALUES ($1, $2, $3, 'running')`,
    [RUN, WF, TENANT],
  )
}

type JobOpts = {
  status?: string
  lockedBy?: string | null
  lockedAgo?: string | null
  leaseIn?: string | null
  attempts?: number
  maxAttempts?: number
  runId?: string | null
  triggerData?: Record<string, unknown>
  priority?: number
}

async function insertJob(db: Client, o: JobOpts = {}): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO public.workflow_queue
       (workflow_id, tenant_id, trigger_type, trigger_data, status, priority, scheduled_for, attempts, max_attempts,
        locked_by, locked_at, lease_expires_at, run_id)
     VALUES ($1, $2, 'manual', $3, $4, $5, now() - interval '1 minute', $6, $7,
        $8, CASE WHEN $9::interval IS NULL THEN NULL ELSE now() - $9::interval END,
        CASE WHEN $10::interval IS NULL THEN NULL ELSE now() + $10::interval END, $11)
     RETURNING id`,
    [WF, TENANT, JSON.stringify(o.triggerData ?? {}), o.status ?? 'pending', o.priority ?? TOP_PRIORITY,
      o.attempts ?? 0, o.maxAttempts ?? 3, o.lockedBy ?? null, o.lockedAgo ?? null, o.leaseIn ?? null, o.runId ?? null],
  )
  return rows[0].id
}

const processing = (o: JobOpts = {}): JobOpts => ({ status: 'processing', lockedBy: 'worker-x', lockedAgo: '5 minutes', attempts: 1, ...o })

describe.skipIf(!DB_URL)('queue leases (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  beforeAll(async () => { await db.connect() })
  afterAll(async () => { await db.end() })
  beforeEach(async () => {
    await db.query('BEGIN')
    await seed(db)
  })
  afterEach(async () => { await db.query('ROLLBACK') })

  const job = async (id: string) => (await db.query(`SELECT * FROM public.workflow_queue WHERE id = $1`, [id])).rows[0]
  const run = async () => (await db.query(`SELECT status, error FROM public.workflow_runs WHERE id = $1`, [RUN])).rows[0]

  it('grants: the new worker / admin RPCs are service_role only', async () => {
    for (const fn of NEW_FNS) {
      const { rows } = await db.query(
        `SELECT has_function_privilege('anon', $1, 'EXECUTE') AS anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') AS auth,
                has_function_privilege('service_role', $1, 'EXECUTE') AS service`, [fn])
      expect(rows[0], fn).toEqual({ anon: false, auth: false, service: true })
    }
    await db.query('SAVEPOINT s')
    await db.query(setRoleSql('authenticated', CAPS!))
    await expect(db.query(`SELECT public.recover_queue_job($1, $2, 'retry', true)`, [RUN, TENANT])).rejects.toThrow(/permission denied/)
    await db.query('ROLLBACK TO SAVEPOINT s')
    await db.query('RESET ROLE')
  })

  it('claim_jobs sets a lease when asked, none for two-argument callers', async () => {
    const a = await insertJob(db)
    const { rows: leased } = await db.query(`SELECT * FROM public.claim_jobs('w1', 1, 60)`)
    expect(leased[0].id).toBe(a)
    const { rows: [{ secs }] } = await db.query(`SELECT extract(epoch FROM lease_expires_at - now())::int AS secs FROM public.workflow_queue WHERE id = $1`, [a])
    expect(secs).toBe(60)
    expect(leased[0].last_lease_owner).toBe('w1')
    const b = await insertJob(db)
    const { rows: legacy } = await db.query(`SELECT * FROM public.claim_jobs('w2', 1)`)
    expect(legacy[0].id).toBe(b)
    expect(legacy[0].lease_expires_at).toBeNull()
  })

  it('renew_job_leases extends only the leases the worker holds', async () => {
    const mine = await insertJob(db, processing({ lockedBy: 'w1', leaseIn: '5 seconds' }))
    const theirs = await insertJob(db, processing({ lockedBy: 'w2', leaseIn: '5 seconds' }))
    const done = await insertJob(db, { status: 'completed', lockedBy: 'w1' })
    const { rows } = await db.query(`SELECT * FROM public.renew_job_leases('w1', $1, 300)`, [[mine, theirs, done]])
    expect(rows.map((r) => Object.values(r)[0])).toEqual([mine])
    const { rows: [m] } = await db.query(`SELECT extract(epoch FROM lease_expires_at - now())::int AS secs FROM public.workflow_queue WHERE id = $1`, [mine])
    expect(m.secs).toBe(300)
    expect((await job(theirs)).lease_expires_at.getTime()).toBeLessThan(Date.now() + 60_000)
  })

  it('recover_expired_jobs: requeues with back-off, dead after max attempts, leaves live and fresh legacy jobs alone', async () => {
    const expired = await insertJob(db, processing({ leaseIn: '-1 second', attempts: 1 }))
    const exhausted = await insertJob(db, processing({ leaseIn: '-1 second', attempts: 3, runId: RUN }))
    const legacyStuck = await insertJob(db, processing({ lockedAgo: '20 minutes', attempts: 1 }))
    const legacyFresh = await insertJob(db, processing({ lockedAgo: '5 minutes', attempts: 1 }))
    const live = await insertJob(db, processing({ leaseIn: '1 minute', attempts: 1 }))

    const { rows: [{ out }] } = await db.query(`SELECT public.recover_expired_jobs(100) AS out`)
    expect(out.requeued).toBe(2)
    expect(out.dead).toBe(1)

    const e = await job(expired)
    expect(e).toMatchObject({ status: 'failed', locked_by: null, lease_expires_at: null, lease_lost_count: 1, last_lease_owner: 'worker-x' })
    expect(e.error).toMatch(/^Worker lost: worker-x stopped renewing its lease .* Retrying\.$/)
    expect(e.next_retry_at.getTime()).toBeGreaterThan(Date.now() + 20_000)

    const x = await job(exhausted)
    expect(x.status).toBe('dead')
    expect(x.error).toMatch(/Gave up: no attempts left\./)
    expect(await run()).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Interrupted\. Worker lost/) })

    expect((await job(legacyStuck)).status).toBe('failed')
    expect((await job(legacyFresh)).status).toBe('processing')
    expect((await job(live)).status).toBe('processing')
  })

  it('a resume job whose run was already running again: dead (20270124090000) / requeued for checkpoint recovery (20270125100000)', async () => {
    const { rows: [{ checkpoints }] } = await db.query(
      `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'workflow_runs' AND column_name = 'checkpoint') AS checkpoints`)
    const resume = await insertJob(db, processing({ leaseIn: '-1 second', triggerData: { _task_resume: { run_id: RUN } } }))
    await db.query(`SELECT public.recover_expired_jobs(100)`)
    const r = await job(resume)
    if (checkpoints) {
      // The processor continues the run from its checkpoint, or fails it as interrupted.
      expect(r.status).toBe('failed')
      expect(r.error).toMatch(/Retrying\.$/)
      expect((await run()).status).toBe('running')
    } else {
      expect(r.status).toBe('dead')
      expect(r.error).toMatch(/interrupted while resuming/)
      expect((await run()).status).toBe('failed')
    }
  })

  it('claim_jobs recovers stuck jobs first; the retry is claimed again once due', async () => {
    const stuck = await insertJob(db, processing({ leaseIn: '-1 second' }))
    const { rows: claimed } = await db.query(`SELECT id FROM public.claim_jobs('w1', 10, 60)`)
    expect(claimed.map((r) => r.id)).not.toContain(stuck)
    expect((await job(stuck)).status).toBe('failed')
    await db.query(`UPDATE public.workflow_queue SET next_retry_at = now() - interval '1 second' WHERE id = $1`, [stuck])
    const { rows: again } = await db.query(`SELECT id, attempts, locked_by FROM public.claim_jobs('w1', 10, 60)`)
    expect(again.find((r) => r.id === stuck)).toMatchObject({ attempts: 2, locked_by: 'w1' })
  })

  it('complete_leased_job / fail_leased_job only apply for the lease holder', async () => {
    const id = await insertJob(db, processing({ lockedBy: 'w2', leaseIn: '1 minute' }))
    const { rows: [r1] } = await db.query(`SELECT public.complete_leased_job($1, 'w1', '{"status":"completed"}') AS ok`, [id])
    expect(r1.ok).toBe(false)
    const { rows: [r2] } = await db.query(`SELECT public.fail_leased_job($1, 'w1', 'boom') AS ok`, [id])
    expect(r2.ok).toBe(false)
    expect((await job(id)).status).toBe('processing')
    const { rows: [r3] } = await db.query(`SELECT public.complete_leased_job($1, 'w2', $2) AS ok`, [id, JSON.stringify({ status: 'completed', run_id: RUN, node_results: { big: 1 } })])
    expect(r3.ok).toBe(true)
    expect(await job(id)).toMatchObject({ status: 'completed', run_id: RUN, result: { status: 'completed', run_id: RUN }, lease_expires_at: null })
    const failing = await insertJob(db, processing({ lockedBy: 'w2', leaseIn: '1 minute', attempts: 3 }))
    await db.query(`SELECT public.fail_leased_job($1, 'w2', 'boom')`, [failing])
    expect(await job(failing)).toMatchObject({ status: 'dead', error: 'boom' })
  })

  it('recover_queue_job: retry / cancel a stuck job; a live one only force-cancelled', async () => {
    const live = await insertJob(db, processing({ leaseIn: '1 minute', runId: RUN }))
    const q = async (id: string, action: string, force = false, tenant = TENANT) =>
      (await db.query(`SELECT public.recover_queue_job($1, $2, $3, $4) AS out`, [id, tenant, action, force])).rows[0].out

    expect(await q(live, 'retry', true)).toMatchObject({ ok: false, reason: 'lease_active' })
    expect(await q(live, 'cancel')).toMatchObject({ ok: false, reason: 'lease_active' })
    expect(await q(live, 'cancel', true, '0d000000-0000-4000-8000-0000000000ff')).toMatchObject({ ok: false, reason: 'not_found' })
    expect(await q(live, 'cancel', true)).toMatchObject({ ok: true, lease_expired: false, run_id: RUN })
    expect(await job(live)).toMatchObject({ status: 'dead', error: 'Force-cancelled while a worker was processing it' })
    expect((await run()).status).toBe('failed')
    // The worker's late result is fenced out.
    expect((await db.query(`SELECT public.complete_leased_job($1, 'worker-x', '{}') AS ok`, [live])).rows[0].ok).toBe(false)

    const stuck = await insertJob(db, processing({ leaseIn: '-1 second', attempts: 2 }))
    expect(await q(stuck, 'retry')).toMatchObject({ ok: true, lease_expired: true })
    expect(await job(stuck)).toMatchObject({ status: 'pending', attempts: 0, locked_by: null, lease_lost_count: 1 })
    expect(await q(stuck, 'retry')).toMatchObject({ ok: false, reason: 'not_processing', status: 'pending' })
  })

  it('the tick probe sees a queue that holds only a stuck job (so the claim runs and recovers it)', async () => {
    await db.query(`UPDATE public.workflow_queue SET status = 'completed' WHERE status IN ('pending', 'failed', 'processing')`)
    expect((await db.query(`SELECT public.cron_tick_probe()->>'workflow_queue' AS v`)).rows[0].v).toBe('false')
    await insertJob(db, processing({ leaseIn: '1 minute' }))
    expect((await db.query(`SELECT public.cron_tick_probe()->>'workflow_queue' AS v`)).rows[0].v).toBe('false')
    await insertJob(db, processing({ leaseIn: '-1 second' }))
    expect((await db.query(`SELECT public.cron_tick_probe()->>'workflow_queue' AS v`)).rows[0].v).toBe('true')
  })

  it('get_queue_health counts due, processing and stuck jobs and the oldest due age', async () => {
    await insertJob(db)
    await insertJob(db, processing({ leaseIn: '1 minute' }))
    await insertJob(db, processing({ leaseIn: '-1 minute' }))
    const { rows: [{ h }] } = await db.query(`SELECT public.get_queue_health($1) AS h`, [TENANT])
    expect(h).toMatchObject({ due: 1, processing: 2, stuck: 1 })
    expect(h.oldest_due_seconds).toBeGreaterThanOrEqual(59)
  })
})

describe.skipIf(!DB_URL)('lease recovery under concurrent workers (local DB, committed rows)', () => {
  const a = new Client({ connectionString: DB_URL })
  const b = new Client({ connectionString: DB_URL })
  let ids: string[] = []

  beforeAll(async () => {
    await Promise.all([a.connect(), b.connect()])
    await seed(a)
    ids = []
    for (let i = 0; i < 20; i++) ids.push(await insertJob(a, processing({ leaseIn: '-1 second', attempts: 1 })))
  })
  afterAll(async () => {
    await a.query(`DELETE FROM public.workflow_queue WHERE tenant_id = $1`, [TENANT])
    await a.query(`DELETE FROM public.workflow_runs WHERE tenant_id = $1`, [TENANT])
    await a.query(`DELETE FROM public.workflows WHERE tenant_id = $1`, [TENANT])
    await a.query(`DELETE FROM public.tenants WHERE id = $1`, [TENANT])
    await Promise.all([a.end(), b.end()])
  })

  it('two workers recovering and claiming at once: each stuck job recovered once, then claimed by exactly one worker', async () => {
    await Promise.all([
      a.query(`SELECT public.recover_expired_jobs(100)`),
      b.query(`SELECT public.recover_expired_jobs(100)`),
    ])
    const { rows } = await a.query(`SELECT status, lease_lost_count FROM public.workflow_queue WHERE id = ANY($1)`, [ids])
    expect(rows.every((r) => r.status === 'failed' && r.lease_lost_count === 1)).toBe(true)

    await a.query(`UPDATE public.workflow_queue SET next_retry_at = now() - interval '1 second' WHERE id = ANY($1)`, [ids])
    const claims: string[] = []
    for (let round = 0; round < 6; round++) {
      const [ra, rb] = await Promise.all([
        a.query(`SELECT id FROM public.claim_jobs('worker-a', 4, 60)`),
        b.query(`SELECT id FROM public.claim_jobs('worker-b', 4, 60)`),
      ])
      claims.push(...ra.rows.map((r) => r.id), ...rb.rows.map((r) => r.id))
    }
    const ours = claims.filter((id) => ids.includes(id))
    expect(new Set(ours).size).toBe(ours.length)
    expect(ours.sort()).toEqual([...ids].sort())
  })
})
