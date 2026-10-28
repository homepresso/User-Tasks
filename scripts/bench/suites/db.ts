/**
 * DB suite: EXPLAIN (ANALYZE, BUFFERS) of hot queries on the seeded data, as
 * an end user through RLS (SET ROLE authenticated + request.jwt.claims, the
 * way PostgREST does it) and as service_role. Plans are saved under
 * results/<label>/plans/; the summary records execution time, seq scans,
 * rows touched and user-function calls (via pg_stat_xact_user_functions,
 * which needs a superuser session for track_functions — the local
 * supabase_admin role; skipped if unavailable). Everything is rolled back.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client, escapeLiteral } from 'pg'
import { benchEnv, readState, RESULTS_DIR } from '../lib/env'
import type { SuiteResult } from '../lib/results'

interface PlanNode {
  'Node Type': string
  'Relation Name'?: string
  'Index Name'?: string
  'Actual Rows'?: number
  'Actual Loops'?: number
  'Rows Removed by Filter'?: number
  Plans?: PlanNode[]
}

interface QueryDef { key: string; label: string; rls: string | null; service: string }

function queries(cursor: string): QueryDef[] {
  const s = readState()
  const t = escapeLiteral(s.tenantId)
  const wf = escapeLiteral(s.busyWorkflowId)
  const run = escapeLiteral(s.sampleRunId)
  const member = escapeLiteral(s.memberId)
  return [
    {
      key: 'tasks_list',
      label: 'tasks list for a user (newest 50)',
      rls: `SELECT * FROM public.tasks WHERE parent_task_id IS NULL AND deleted_at IS NULL AND acceptance_status <> 'pending' ORDER BY created_at DESC LIMIT 50`,
      service: `SELECT * FROM public.tasks WHERE tenant_id = ${t} AND assignee_id = ${member} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 50`,
    },
    {
      key: 'runs_by_workflow',
      label: 'runs list by workflow, newest 50 (select *)',
      rls: `SELECT * FROM public.workflow_runs WHERE workflow_id = ${wf} ORDER BY started_at DESC LIMIT 50`,
      service: `SELECT * FROM public.workflow_runs WHERE workflow_id = ${wf} ORDER BY started_at DESC LIMIT 50`,
    },
    {
      key: 'queue_claim',
      label: 'queue claim (claim_next_job SELECT … FOR UPDATE SKIP LOCKED)',
      rls: null,
      service: `SELECT * FROM public.workflow_queue WHERE ((status = 'pending' AND scheduled_for <= now()) OR (status = 'failed' AND attempts < max_attempts AND next_retry_at <= now())) ORDER BY priority DESC, scheduled_for ASC LIMIT 1 FOR UPDATE SKIP LOCKED`,
    },
    {
      key: 'task_search',
      label: "task title ILIKE '%invoice 4%' (20)",
      rls: `SELECT id, title, status FROM public.tasks WHERE title ILIKE '%invoice 4%' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
      service: `SELECT id, title, status FROM public.tasks WHERE tenant_id = ${t} AND title ILIKE '%invoice 4%' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`,
    },
    {
      key: 'logs_by_run',
      label: 'workflow_logs for one run',
      rls: `SELECT * FROM public.workflow_logs WHERE run_id = ${run} ORDER BY created_at`,
      service: `SELECT * FROM public.workflow_logs WHERE run_id = ${run} ORDER BY created_at`,
    },
    {
      key: 'event_cursor',
      label: 'event_stream cursor read (101 after cursor)',
      rls: `SELECT * FROM public.event_stream WHERE tenant_id = ${t} AND id > ${cursor} ORDER BY id LIMIT 101`,
      service: `SELECT * FROM public.event_stream WHERE tenant_id = ${t} AND id > ${cursor} ORDER BY id LIMIT 101`,
    },
  ]
}

function walk(node: PlanNode, visit: (n: PlanNode) => void) {
  visit(node)
  for (const child of node.Plans ?? []) walk(child, visit)
}

/** Superuser URL for the local stack (track_functions is superuser-only). */
function adminUrl(dbUrl: string): string {
  if (process.env.BENCH_ADMIN_DB_URL) return process.env.BENCH_ADMIN_DB_URL
  const url = new URL(dbUrl)
  url.username = 'supabase_admin'
  return url.toString()
}

export async function runDb(opts: { label: string }): Promise<SuiteResult> {
  const env = benchEnv()
  const state = readState()
  let db = new Client({ connectionString: adminUrl(env.dbUrl) })
  let countFunctions = true
  try {
    await db.connect()
  } catch {
    db = new Client({ connectionString: env.dbUrl })
    await db.connect()
    countFunctions = false
  }
  const planDir = join(RESULTS_DIR, opts.label, 'plans')
  mkdirSync(planDir, { recursive: true })
  const claims = JSON.stringify({ sub: state.memberId, role: 'authenticated', aud: 'authenticated' })
  const data: Record<string, unknown> = {}
  const rows: Array<Array<string | number | null>> = []

  // Cursor in the middle of the tenant's stream (a shipper catching up).
  const { rows: [mid] } = await db.query<{ id: string }>(
    'SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY id) AS id FROM public.event_stream WHERE tenant_id = $1', [state.tenantId],
  )
  const cursor = String(Number(mid?.id ?? 0))

  try {
    for (const q of queries(cursor)) {
      for (const role of ['authenticated', 'service_role'] as const) {
        const sql = role === 'authenticated' ? q.rls : q.service
        const key = `${q.key}.${role}`
        if (!sql) { rows.push([q.label, role, 'n/a (service only)', null, null, null, null]); continue }
        await db.query('BEGIN')
        try {
          if (countFunctions) await db.query("SET LOCAL track_functions = 'all'")
          await db.query(`SET LOCAL ROLE ${role}`)
          if (role === 'authenticated') await db.query(`SELECT set_config('request.jwt.claims', ${escapeLiteral(claims)}, true)`)
          await db.query(sql) // warm-up
          const before = countFunctions ? await functionCalls(db) : {}
          const { rows: [explain] } = await db.query<{ 'QUERY PLAN': Array<{ Plan: PlanNode; 'Execution Time': number; 'Planning Time': number }> }>(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
          )
          const after = countFunctions ? await functionCalls(db) : {}
          const { rows: text } = await db.query<{ 'QUERY PLAN': string }>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`)
          writeFileSync(join(planDir, `${key}.txt`), `-- ${q.label} as ${role}\n${sql}\n\n${text.map((r) => r['QUERY PLAN']).join('\n')}\n`)

          const plan = explain['QUERY PLAN'][0]
          const seqScans: string[] = []
          let scanned = 0
          walk(plan.Plan, (n) => {
            const loops = n['Actual Loops'] ?? 1
            if (n['Node Type'] === 'Seq Scan') seqScans.push(`${n['Relation Name']}`)
            if (n['Relation Name']) scanned += ((n['Actual Rows'] ?? 0) + (n['Rows Removed by Filter'] ?? 0)) * loops
          })
          const returned = plan.Plan['Actual Rows'] ?? 0
          const calls: Record<string, number> = {}
          for (const [fn, n] of Object.entries(after)) {
            const delta = n - (before[fn] ?? 0)
            if (delta > 0) calls[fn] = delta
          }
          const totalCalls = Object.values(calls).reduce((a, b) => a + b, 0)
          data[key] = {
            execution_ms: Math.round(plan['Execution Time'] * 100) / 100,
            planning_ms: Math.round(plan['Planning Time'] * 100) / 100,
            seq_scans: seqScans,
            rows_scanned: scanned,
            rows_returned: returned,
            function_calls: countFunctions ? calls : null,
          }
          const topCalls = Object.entries(calls).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([fn, n]) => `${fn}×${n}`).join(', ')
          rows.push([
            q.label, role, Math.round(plan['Execution Time'] * 100) / 100,
            seqScans.length ? seqScans.join(', ') : 'none',
            `${scanned} / ${returned}`,
            countFunctions ? totalCalls : null,
            countFunctions ? (scanned ? Math.round((totalCalls / scanned) * 100) / 100 : 0) + (topCalls ? ` (${topCalls})` : '') : null,
          ])
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          data[key] = { error: message }
          rows.push([q.label, role, `error: ${message}`, null, null, null, null])
        } finally {
          await db.query('ROLLBACK')
        }
      }
    }
  } finally {
    await db.end()
  }

  return {
    data,
    tables: [{
      title: 'Query plans (EXPLAIN ANALYZE, warm cache; authenticated = a member via RLS)',
      columns: ['query', 'role', 'exec ms', 'seq scans', 'rows scanned / returned', 'fn calls', 'fn calls per scanned row (top)'],
      rows,
    }],
    notes: [
      `Plans saved in scripts/bench/results/${opts.label}/plans/.`,
      countFunctions ? 'Function calls = pg_stat_xact_user_functions delta (track_functions = all) for the EXPLAIN ANALYZE run.' : 'Function calls not counted (no superuser connection for track_functions).',
    ],
  }
}

async function functionCalls(db: Client): Promise<Record<string, number>> {
  const { rows } = await db.query<{ fn: string; calls: string }>(
    `SELECT schemaname || '.' || funcname AS fn, calls FROM pg_stat_xact_user_functions`,
  )
  return Object.fromEntries(rows.map((r) => [r.fn, Number(r.calls)]))
}
