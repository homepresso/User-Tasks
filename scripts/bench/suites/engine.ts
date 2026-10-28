/**
 * Engine suite: runs the bench workflows in-process through executeWorkflow
 * (the queue processor's call shape, pinned published version) with a fetch
 * wrapper counting Supabase round trips, rows written and DB wait time.
 */
import { Client } from 'pg'
import { applyAppEnv, benchEnv, readState } from '../lib/env'
import { startEchoServer } from '../lib/echo-server'
import { FetchCounter, type FetchStats } from '../lib/fetch-counter'
import { median, summarize, type SuiteResult } from '../lib/results'
import { ensureBenchWorkflows } from '../lib/workflows'

/** Queue kicks from the engine land here and are answered in-process. */
export const KICK_SINK = 'http://127.0.0.1:9/bench-kick-sink'

const CASES: Array<{ key: string; label: string }> = [
  { key: 'linear50', label: '50-node linear' },
  { key: 'loop500', label: 'loop ×500 (set_variable + condition + functions)' },
  { key: 'dataTable500', label: '500 data-table inserts (+ active data_table_event workflow)' },
  { key: 'decision200', label: 'decision table in loop ×200' },
  { key: 'callRef100', label: 'call_reference ×100 (local echo)' },
]

type ExecuteWorkflow = typeof import('../../../lib/workflow-engine').executeWorkflow

export interface EngineSample { wallMs: number; status: string; error?: string; stats: FetchStats; nodeResults: number }

/** Shared setup for in-process suites: env, fetch counter, engine import. */
export async function engineHarness() {
  const env = benchEnv()
  const state = readState()
  applyAppEnv(env, KICK_SINK)
  const counter = new FetchCounter(env.supabaseUrl, KICK_SINK)
  counter.install()
  const { executeWorkflow } = await import('../../../lib/workflow-engine')
  const db = new Client({ connectionString: env.dbUrl })
  await db.connect()
  await ensureBenchWorkflows(db, state.tenantId, state.ownerId, {
    eventsTableId: state.eventsTableId, decisionTableId: state.decisionTableId, referenceId: state.referenceId,
  })
  return { env, state, counter, executeWorkflow: executeWorkflow as ExecuteWorkflow, db }
}

export async function runOnce(
  executeWorkflow: ExecuteWorkflow, counter: FetchCounter, workflowId: string, versionId: string,
): Promise<EngineSample> {
  counter.reset()
  const started = performance.now()
  let status = 'error'
  let error: string | undefined
  let nodeResults = 0
  try {
    const result = await executeWorkflow(workflowId, undefined, false, {}, undefined, versionId)
    status = result.status
    error = result.error
    nodeResults = Object.keys(result.node_results ?? {}).length
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  const wallMs = performance.now() - started
  // flushLogs / run_count updates are fire-and-forget today: let them land so
  // they are counted, but outside the wall time.
  await counter.idle()
  return { wallMs, status, error, stats: counter.snapshot(), nodeResults }
}

export async function runEngine(opts: { reps: number }): Promise<SuiteResult> {
  const { state, counter, executeWorkflow, db } = await engineHarness()
  const echo = await startEchoServer(state.echoPort)
  const data: Record<string, unknown> = {}
  const rows: Array<Array<string | number | null>> = []
  const opRows: Array<Array<string | number | null>> = []
  const notes: string[] = []
  try {
    for (const c of CASES) {
      const wf = state.workflowIds[c.key]
      const ver = state.versionIds[c.key]
      process.stdout.write(`  engine ${c.key} `)
      await runOnce(executeWorkflow, counter, wf, ver) // warm-up (JIT, connection pool)
      const samples: EngineSample[] = []
      for (let i = 0; i < opts.reps; i++) {
        samples.push(await runOnce(executeWorkflow, counter, wf, ver))
        process.stdout.write('.')
      }
      console.log('')
      const wall = summarize(samples.map((s) => s.wallMs))
      const last = samples[samples.length - 1]
      const failed = samples.filter((s) => s.status !== 'completed')
      if (failed.length) notes.push(`${c.key}: ${failed.length}/${samples.length} runs not completed — ${failed[0].status}: ${failed[0].error ?? ''}`)
      data[c.key] = {
        label: c.label,
        wall_ms: wall,
        db_round_trips: median(samples.map((s) => s.stats.dbRoundTrips)),
        db_time_ms: median(samples.map((s) => s.stats.dbTimeMs)),
        rows_written: median(samples.map((s) => s.stats.rowsWritten)),
        external_calls: median(samples.map((s) => s.stats.externalCalls)),
        queue_kicks: median(samples.map((s) => s.stats.queueKicks)),
        node_results: last.nodeResults,
        by_op: last.stats.byOp,
        statuses: samples.map((s) => s.status),
      }
      rows.push([c.label, wall.p50, wall.max, last.stats.dbRoundTrips, last.stats.dbTimeMs, last.stats.rowsWritten, last.stats.externalCalls, last.stats.queueKicks])
      const top = Object.entries(last.stats.byOp).sort((a, b) => b[1] - a[1]).slice(0, 6)
      opRows.push([c.key, top.map(([op, n]) => `${op} ×${n}`).join(', ')])
    }

    // Row writes enqueue one data_table_event job each; drop them so the
    // queue suite starts from an empty queue, and clear the bench rows.
    const { rowCount } = await db.query(
      `DELETE FROM public.workflow_queue WHERE workflow_id = $1 AND status IN ('pending', 'failed')`, [state.workflowIds.onRowCreated],
    )
    await db.query('DELETE FROM public.custom_table_rows WHERE table_id = $1', [state.eventsTableId])
    notes.push(`dataTable500 enqueued ${rowCount ?? 0} data_table_event jobs over ${opts.reps + 1} runs (deleted afterwards, not executed).`)
    notes.push(`Echo server received ${echo.requests()} requests.`)
    notes.push('wall = executeWorkflow call; DB round trips include fire-and-forget writes that settle after it returns. DB time sums request durations (parallel requests overlap).')
  } finally {
    await echo.close()
    await db.end()
    counter.uninstall()
  }
  return {
    data,
    tables: [
      {
        title: `Engine (in-process executeWorkflow, ${opts.reps} reps after 1 warm-up)`,
        columns: ['case', 'wall p50 ms', 'wall max ms', 'DB round trips', 'DB time ms', 'rows written', 'external calls', 'queue kicks'],
        rows,
      },
      { title: 'Most frequent DB operations (last rep)', columns: ['case', 'ops'], rows: opRows },
    ],
    notes,
  }
}
