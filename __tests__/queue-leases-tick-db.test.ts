/**
 * Stuck-job recovery end to end in web mode, through the scheduler tick:
 * a job left `processing` by a worker that died (expired lease) is seen by
 * the tick's probe, recovered by the claim (back to `failed` with back-off
 * and a "Worker lost" error), and run again once due — the run it left
 * `running` is closed as interrupted and a new run completes.
 *
 * Runs only against a LOCAL stack (never a shared or live one): set
 * EVENT_STREAM_DB_URL (direct Postgres) and NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY (the engine's API), e.g. the throwaway stack's
 * env file. Rows are committed and deleted afterwards. Run the queue DB
 * suites with --no-file-parallelism: recovery acts on every stuck job in the
 * database, so a parallel suite's recovery can take this test's job.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const API_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ENABLED = Boolean(DB_URL && API_URL && SERVICE_KEY)

const TENANT = '0d7e0000-0000-4000-8000-00000000000a'
const WF = '0d7e0000-0000-4000-8000-0000000000a1'
const RUN = '0d7e0000-0000-4000-8000-0000000000c1'

const nodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  { id: 'set', type: 'set_variable', label: 'Set greeting', config: { name: 'greeting', expression: 'hello' } },
]
const edges = [{ id: 'e1', source: 'start', target: 'set' }]

async function cleanup(db: Client) {
  for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'workflows']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT]).catch(() => undefined)
}

describe.skipIf(!ENABLED)('stuck-job recovery through the tick (web mode, local stack)', () => {
  const db = new Client({ connectionString: DB_URL })
  let jobId = ''

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:9' // kicks go nowhere
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Tick recovery', 'tick-recovery-test')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges)
       VALUES ($1, $2, 'Recover me', true, 'manual', $3, $4)`,
      [WF, TENANT, JSON.stringify(nodes), JSON.stringify(edges)],
    )
    await db.query(`INSERT INTO public.workflow_runs (id, workflow_id, tenant_id, status) VALUES ($1, $2, $3, 'running')`, [RUN, WF, TENANT])
    // A worker claimed it 10 minutes ago, ran it for a while, then died.
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO public.workflow_queue
         (workflow_id, tenant_id, trigger_type, trigger_data, status, priority, scheduled_for, attempts,
          locked_by, locked_at, lease_expires_at, run_id, started_at)
       VALUES ($1, $2, 'manual', '{}', 'processing', 3000000, now() - interval '10 minutes', 1,
          'worker-that-died', now() - interval '10 minutes', now() - interval '1 minute', $3, now() - interval '10 minutes')
       RETURNING id`,
      [WF, TENANT, RUN],
    )
    jobId = rows[0].id
  })

  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  const job = async () => (await db.query(`SELECT * FROM public.workflow_queue WHERE id = $1`, [jobId])).rows[0]

  it('the tick sees the stuck job, recovers it, and the retry finishes with a new run', async () => {
    const [{ runTick }, { JOBS }, { getServiceDb }] = await Promise.all([
      import('@/lib/jobs/tick'),
      import('@/lib/jobs/registry'),
      import('@/lib/providers/db'),
    ])
    const supabase = getServiceDb()
    const probe = await supabase.rpc('cron_tick_probe')
    expect((probe.data as Record<string, unknown>).workflow_queue).toBe(true)

    const tickJobs = JOBS.filter((j) => j.name === 'process-workflows')
    const first = await runTick({ supabase, jobs: tickJobs, minute: new Date(Date.UTC(2031, 0, 1, 0, 1)), holder: 'test-tick-1' })
    expect(first.jobs.find((j) => j.name === 'process-workflows')?.status).toBe('ok')

    const recovered = await job()
    expect(recovered).toMatchObject({ status: 'failed', locked_by: null, lease_expires_at: null, lease_lost_count: 1, last_lease_owner: 'worker-that-died' })
    expect(recovered.error).toMatch(/^Worker lost: worker-that-died/)

    // Once the back-off is over, the next tick runs it again.
    await db.query(`UPDATE public.workflow_queue SET next_retry_at = now() - interval '1 second' WHERE id = $1`, [jobId])
    await runTick({ supabase, jobs: tickJobs, minute: new Date(Date.UTC(2031, 0, 1, 0, 2)), holder: 'test-tick-2' })

    const done = await job()
    expect(done).toMatchObject({ status: 'completed', attempts: 2, locked_by: null, lease_expires_at: null })
    expect(done.result.status).toBe('completed')
    expect(done.result.run_id).not.toBe(RUN)
    const { rows: runs } = await db.query(`SELECT id, status, error FROM public.workflow_runs WHERE tenant_id = $1 ORDER BY started_at`, [TENANT])
    expect(runs.find((r) => r.id === RUN)).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Interrupted/) })
    expect(runs.find((r) => r.id === done.result.run_id)?.status).toBe('completed')
  })
})
