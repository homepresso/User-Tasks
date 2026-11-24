/**
 * Two processor hosts (lib/processing/processor-host — what `node worker.cjs
 * --processor` runs on) draining the same queue at once against a LOCAL
 * stack: every job runs exactly once (one run per job, no double
 * processing), leases are set while claimed and cleared when done.
 *
 * Needs EVENT_STREAM_DB_URL + NEXT_PUBLIC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY of a throwaway stack (never a shared or live
 * one); run the queue DB suites with --no-file-parallelism. Rows are
 * committed and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'

const DB_URL = process.env.EVENT_STREAM_DB_URL
const ENABLED = Boolean(DB_URL && process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

const TENANT = '0d8e0000-0000-4000-8000-00000000000a'
const WF = '0d8e0000-0000-4000-8000-0000000000a1'
const JOBS = 24

async function cleanup(db: Client) {
  for (const table of ['workflow_logs', 'workflow_queue', 'workflow_runs', 'workflows']) {
    await db.query(`DELETE FROM public.${table} WHERE tenant_id = $1`, [TENANT]).catch(() => undefined)
  }
  await db.query('DELETE FROM public.tenants WHERE id = $1', [TENANT]).catch(() => undefined)
}

describe.skipIf(!ENABLED)('processor hosts draining one queue (local stack)', () => {
  const db = new Client({ connectionString: DB_URL })

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'http://127.0.0.1:9'
    await db.connect()
    await cleanup(db)
    await db.query(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Processors', 'processors-test')`, [TENANT])
    await db.query(
      `INSERT INTO public.workflows (id, tenant_id, name, is_active, trigger_type, nodes, edges) VALUES ($1, $2, 'Drain me', true, 'manual', $3, $4)`,
      [WF, TENANT,
        JSON.stringify([{ id: 'start', type: 'manual', label: 'Start', config: {} }, { id: 'set', type: 'set_variable', label: 'Set', config: { name: 'n', expression: '{{n}}' } }]),
        JSON.stringify([{ id: 'e1', source: 'start', target: 'set' }])],
    )
    await db.query(
      `INSERT INTO public.workflow_queue (workflow_id, tenant_id, trigger_type, trigger_data, priority, scheduled_for)
       SELECT $1, $2, 'manual', jsonb_build_object('n', g), 4000000, now() - interval '1 second' FROM generate_series(1, $3) g`,
      [WF, TENANT, JOBS],
    )
  })

  afterAll(async () => {
    await cleanup(db)
    await db.end()
  })

  it('every job runs exactly once with two hosts claiming concurrently', async () => {
    const { createProcessorHost } = await import('@/lib/processing/processor-host')
    const { markProcessorProcess } = await import('@/lib/processing/handoff')
    const hosts = await Promise.all([createProcessorHost({ workerId: 'test-host-a' }), createProcessorHost({ workerId: 'test-host-b' })])
    const ran: Record<string, string[]> = { 'test-host-a': [], 'test-host-b': [] }
    const drain = async (host: (typeof hosts)[number]) => {
      for (let idle = 0; idle < 3;) {
        const jobs = (await host.workflows.claim(3)).filter((j) => j.tenant_id === TENANT)
        if (!jobs.length) { idle++; continue }
        idle = 0
        // Claimed with a lease.
        const { rows } = await db.query(`SELECT count(*)::int AS n FROM public.workflow_queue WHERE id = ANY($1) AND lease_expires_at > now() AND locked_by = $2`, [jobs.map((j) => j.id), host.workerId])
        expect(rows[0].n).toBe(jobs.length)
        const results = await Promise.all(jobs.map((job) => host.workflows.run(job)))
        expect(results.every((r) => r.status === 'completed')).toBe(true)
        ran[host.workerId].push(...jobs.map((j) => j.id))
      }
    }
    try {
      await Promise.all(hosts.map(drain))
    } finally {
      await Promise.all(hosts.map((h) => h.close()))
      markProcessorProcess(false)
    }
    const all = [...ran['test-host-a'], ...ran['test-host-b']]
    expect(new Set(all).size).toBe(JOBS)
    expect(all).toHaveLength(JOBS)
    expect(ran['test-host-a'].length).toBeGreaterThan(0)
    expect(ran['test-host-b'].length).toBeGreaterThan(0)
    const { rows: jobs } = await db.query(`SELECT status, run_id, lease_expires_at, locked_by FROM public.workflow_queue WHERE tenant_id = $1`, [TENANT])
    expect(jobs.every((j) => j.status === 'completed' && j.lease_expires_at === null && j.locked_by === null)).toBe(true)
    expect(new Set(jobs.map((j) => j.run_id)).size).toBe(JOBS)
    const { rows: [runs] } = await db.query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'completed')::int AS done FROM public.workflow_runs WHERE tenant_id = $1`, [TENANT])
    expect(runs).toEqual({ n: JOBS, done: JOBS })
  }, 120_000)
})
