/**
 * Queue suite (needs the app running — see run.ts --app-dir/--app-url):
 * enqueue jobs with enqueue_workflow and measure enqueue → start/complete
 * latency (from workflow_queue timestamps) under today's dispatch:
 *  - kick: the app's own kickQueueProcessor() (lib/process-queue) after each
 *    enqueue — since phase 2 coalesced (one request in flight per process, one
 *    follow-up) and sent with CRON_SECRET only, the documented setup;
 *  - cron: pg_cron's every-minute POST {batch_size: 20}, simulated here at
 *    each wall-clock minute (same endpoint, same batch) — only with --slow;
 *  - direct: the processor route invoked and awaited by the caller.
 */
import { Pool } from 'pg'
import { applyAppEnv, benchEnv, readState, type BenchState } from '../lib/env'
import { summarize, type SuiteResult } from '../lib/results'

interface Ctx { db: Pool; state: BenchState; appUrl: string; secret: string; kick: () => void }

/** Settled for this run: done, dead, or failed and waiting for a retry (counted as failed). */
const TERMINAL = `status IN ('completed', 'dead', 'failed')`

async function enqueue(ctx: Ctx, count: number, afterEach?: () => void): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < count; i++) {
    const { rows } = await ctx.db.query<{ id: string }>(
      `SELECT public.enqueue_workflow($1, $2, NULL, 'webhook_received', $3, 0, 0) AS id`,
      [ctx.state.workflowIds.queueSmall, ctx.state.tenantId, JSON.stringify({ _version_id: ctx.state.versionIds.queueSmall, n: i })],
    )
    ids.push(rows[0].id)
    afterEach?.()
  }
  return ids
}

function processorCall(ctx: Ctx, batchSize: number): Promise<Response> {
  return fetch(`${ctx.appUrl}/api/workflows/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-processor-secret': ctx.secret },
    body: JSON.stringify({ batch_size: batchSize }),
  })
}

const kick = (ctx: Ctx) => ctx.kick()

/** pg_cron 'usertasks-process-workflows': POST {batch_size: 20} at every minute boundary. */
function startCron(ctx: Ctx): () => void {
  let timer: NodeJS.Timeout
  const schedule = () => {
    timer = setTimeout(() => { void processorCall(ctx, 20).then((r) => r.text()).catch(() => {}); schedule() }, 60_000 - (Date.now() % 60_000))
  }
  schedule()
  return () => clearTimeout(timer)
}

interface JobTimes { startMs: number; completeMs: number }

async function waitDone(ctx: Ctx, ids: string[], timeoutMs: number): Promise<{ jobs: JobTimes[]; spanMs: number; timedOut: boolean; failed: number; errors: string[] }> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const { rows } = await ctx.db.query<{ done: string }>(`SELECT count(*) AS done FROM public.workflow_queue WHERE id = ANY($1) AND (${TERMINAL})`, [ids])
    const done = Number(rows[0].done) === ids.length
    if (done || Date.now() > deadline) {
      const { rows: jobs } = await ctx.db.query<{ status: string; error: string | null; start_ms: number | null; complete_ms: number | null; span_ms: number | null }>(
        `SELECT status, error,
                extract(epoch FROM started_at - created_at) * 1000 AS start_ms,
                extract(epoch FROM completed_at - created_at) * 1000 AS complete_ms,
                extract(epoch FROM max(completed_at) OVER () - min(created_at) OVER ()) * 1000 AS span_ms
         FROM public.workflow_queue WHERE id = ANY($1)`, [ids],
      )
      return {
        jobs: jobs.filter((j) => j.start_ms !== null && j.complete_ms !== null).map((j) => ({ startMs: Number(j.start_ms), completeMs: Number(j.complete_ms) })),
        spanMs: Math.round(Number(jobs[0]?.span_ms ?? 0)),
        timedOut: !done,
        failed: jobs.filter((j) => j.status !== 'completed').length,
        errors: [...new Set(jobs.map((j) => j.error).filter((e): e is string => Boolean(e)))].slice(0, 5),
      }
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

async function clearQueue(ctx: Ctx) {
  await ctx.db.query(`DELETE FROM public.workflow_queue WHERE workflow_id = $1`, [ctx.state.workflowIds.queueSmall])
}

type Row = Array<string | number | null>

export async function runQueue(opts: { appUrl: string; secret: string; slow: boolean; samples?: number }): Promise<SuiteResult> {
  const env = benchEnv()
  const db = new Pool({ connectionString: env.dbUrl, max: 6 })
  // The app's dispatch code, configured like a deployment that only sets
  // CRON_SECRET (kicks used to be sent without a secret then → 401).
  applyAppEnv(env, opts.appUrl)
  process.env.CRON_SECRET = opts.secret
  delete process.env.WORKFLOW_PROCESSOR_SECRET
  const { kickQueueProcessor } = await import('../../../lib/process-queue')
  const ctx: Ctx = { db, state: readState(), appUrl: opts.appUrl, secret: opts.secret, kick: kickQueueProcessor }
  const samples = opts.samples ?? 10
  const data: Record<string, unknown> = {}
  const single: Row[] = []
  const burst: Row[] = []
  const notes: string[] = []

  const { rows: [pending] } = await db.query<{ n: string }>(`SELECT count(*) AS n FROM public.workflow_queue WHERE status IN ('pending', 'processing')`)
  if (Number(pending.n) > 0) notes.push(`${pending.n} other pending/processing jobs were in the queue at start.`)

  try {
    await clearQueue(ctx)
    // Warm the route (first request compiles/loads the processor module).
    await enqueue(ctx, 1)
    await (await processorCall(ctx, 5)).text()

    const singleCase = async (key: string, label: string, go: (ids: string[]) => Promise<void>, enqueueThenKick: boolean) => {
      process.stdout.write(`  queue ${key} `)
      const starts: number[] = []
      const completes: number[] = []
      for (let i = 0; i < samples; i++) {
        await clearQueue(ctx)
        const ids = await enqueue(ctx, 1, enqueueThenKick ? () => kick(ctx) : undefined)
        await go(ids)
        const r = await waitDone(ctx, ids, 120_000)
        if (r.jobs[0]) { starts.push(r.jobs[0].startMs); completes.push(r.jobs[0].completeMs) }
        process.stdout.write('.')
      }
      console.log('')
      const s = summarize(starts)
      const c = summarize(completes)
      data[key] = { start_ms: s, complete_ms: c }
      single.push([label, s.p50, s.p95, s.max, c.p50, c.max])
    }

    await singleCase('single_kick', '1 job, enqueue + kickQueueProcessor()', async () => {}, true)
    await singleCase('single_direct', '1 job, processor invoked directly', async () => { await (await processorCall(ctx, 1)).text() }, false)

    if (opts.slow) {
      process.stdout.write('  queue single_cron (≤ 60 s) ')
      await clearQueue(ctx)
      const stop = startCron(ctx)
      const ids = await enqueue(ctx, 1)
      const r = await waitDone(ctx, ids, 90_000)
      stop()
      console.log(`${Math.round(r.jobs[0]?.startMs ?? -1)} ms`)
      data.single_cron = { start_ms: r.jobs[0]?.startMs ?? null, complete_ms: r.jobs[0]?.completeMs ?? null }
      single.push(['1 job, pg_cron only (no kick; 1 sample)', Math.round(r.jobs[0]?.startMs ?? 0), null, null, Math.round(r.jobs[0]?.completeMs ?? 0), null])
    } else {
      single.push(['1 job, pg_cron only (no kick) — expected', 30_000, 57_000, 60_000, null, null])
      notes.push('pg_cron-only single-job latency is not measured without --slow: a job waits for the next minute tick (uniform 0–60 s, mean 30 s).')
    }

    const burstCase = async (key: string, label: string, run: (ids: string[]) => Promise<void>, kickEach: boolean, timeoutMs: number, cron: boolean) => {
      process.stdout.write(`  queue ${key} … `)
      await clearQueue(ctx)
      const stopCron = cron ? startCron(ctx) : () => {}
      const started = Date.now()
      const ids = await enqueue(ctx, 200, kickEach ? () => kick(ctx) : undefined)
      const enqueueMs = Date.now() - started
      const runner = run(ids)
      const r = await waitDone(ctx, ids, timeoutMs)
      stopCron()
      await runner
      const s = summarize(r.jobs.map((j) => j.startMs))
      console.log(`${(r.spanMs / 1000).toFixed(1)} s${r.timedOut ? ' (timed out)' : ''}`)
      data[key] = { span_ms: r.spanMs, enqueue_ms: enqueueMs, start_ms: s, failed: r.failed, errors: r.errors, timed_out: r.timedOut, completed: r.jobs.length }
      if (r.failed) notes.push(`${key}: ${r.failed} jobs failed — ${r.errors.join(' | ')}`)
      burst.push([label, r.timedOut ? `> ${timeoutMs / 1000} s (timed out, ${r.jobs.length}/200 done)` : r.spanMs, r.jobs.length ? Math.round((r.jobs.length / Math.max(r.spanMs, 1)) * 1000 * 10) / 10 : 0, s.p50, s.max, r.failed])
    }

    const drain = (workers: number) => async (ids: string[]) => {
      const worker = async () => {
        for (;;) {
          const res = await processorCall(ctx, 20)
          const body = (await res.json().catch(() => ({}))) as { processed?: number }
          if (!body.processed) {
            const { rows } = await db.query<{ left: string }>(`SELECT count(*) AS left FROM public.workflow_queue WHERE id = ANY($1) AND NOT (${TERMINAL})`, [ids])
            if (Number(rows[0].left) === 0) return
          }
        }
      }
      await Promise.all([...Array(workers)].map(worker))
    }

    await burstCase('burst_kick_each', '200 jobs, kickQueueProcessor() after each enqueue (+ cron)', async () => {}, true, 600_000, true)
    if (opts.slow) {
      await burstCase('burst_one_kick_cron', '200 jobs, one kick then pg_cron', async () => { kick(ctx) }, false, 900_000, true)
    } else {
      // Since phase 2 one kick drains the burst by itself (the processor
      // re-kicks while work is left), so this no longer needs the cron.
      await burstCase('burst_one_kick', '200 jobs, one kickQueueProcessor() after the last enqueue (no cron)', async () => { kick(ctx) }, false, 600_000, false)
    }
    await burstCase('burst_direct_1', '200 jobs, processor direct, 1 worker (batch 20)', drain(1), false, 600_000, false)
    await burstCase('burst_direct_4', '200 jobs, processor direct, 4 concurrent workers', drain(4), false, 600_000, false)
  } finally {
    await clearQueue(ctx)
    await db.end()
  }

  notes.push('Latencies come from workflow_queue timestamps (created_at → started_at / completed_at), so they include claim and run time but not the enqueue round trip.')
  return {
    data,
    tables: [
      { title: `Single job latency (${samples} samples unless noted, ms)`, columns: ['scenario', 'start p50', 'start p95', 'start max', 'complete p50', 'complete max'], rows: single },
      { title: '200-job burst (5-node workflow)', columns: ['scenario', 'enqueue → all done ms', 'jobs/s', 'start p50 ms', 'start max ms', 'failed'], rows: burst },
    ],
    notes,
  }
}
