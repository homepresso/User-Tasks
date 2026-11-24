#!/usr/bin/env node
/**
 * Benchmark: report metrics from the flat rollup tables vs live aggregation
 * (migration 20270123100000_report_rollups.sql), and the write overhead of
 * the delta triggers.
 *
 * THROWAWAY DATABASES ONLY: it creates a "bench" workspace with ~200k runs
 * (plus tasks and submissions) and deletes it at the end (--keep to leave it).
 *
 *   BENCH_DB_URL=postgresql://postgres:postgres@127.0.0.1:57152/postgres node scripts/bench-report-rollups.mjs [--runs 200000] [--keep]
 *
 * Reports, as medians of 5 runs, both sides serialised to JSON in the database
 * (superuser connection: RLS excluded on both sides):
 *  - reads: reports hub (180 days, every workflow), duration stats (90 days),
 *    compare page node visits (2 workflows), extension run stats (30 days,
 *    10 workflows), widget-style series (runs / tasks / submissions per day, 90 days)
 *  - writes: per run transition (insert running → complete with a trace),
 *    with the triggers on vs off, median / p95
 *  - backfill time of the whole history
 */
import pg from 'pg'

const url = process.env.BENCH_DB_URL
if (!url) { console.error('Set BENCH_DB_URL (a throwaway database).'); process.exit(2) }
if (/supabase\.co|amazonaws|azure|neon\.tech/.test(url) && !process.argv.includes('--i-know')) { console.error('That looks like a hosted database; refusing (pass --i-know if it is a throwaway one).'); process.exit(2) }
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt }
const RUNS = Number(arg('runs', 200000))
const KEEP = process.argv.includes('--keep')

const db = new pg.Client({ connectionString: url })
await db.connect()
const q = (sql, params) => db.query(sql, params)
const T = '0b000000-0000-4000-8000-00000000be01'
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))] }
const fmt = (n) => (n < 10 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toString())

async function timeIt(sql, params, n = 5) {
  await q(sql, params) // warm
  const out = []
  for (let i = 0; i < n; i++) { const t0 = process.hrtime.bigint(); await q(sql, params); out.push(ms(t0)) }
  return median(out)
}

console.log(`Seeding ${RUNS.toLocaleString('en-US')} runs …`)
await q(`DELETE FROM public.tenants WHERE id = $1`, [T])
await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Rollup bench', 'rollup-bench')`, [T])
const WF = Array.from({ length: 20 }, (_, i) => `0b000000-0000-4000-8000-0000000b${String(i).padStart(4, '0')}`)
for (const [i, w] of WF.entries()) await q(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type) VALUES ($1, $2, $3, 'manual')`, [w, T, `Bench ${i}`])
const FORMS = ['0b000000-0000-4000-8000-0000000bf001', '0b000000-0000-4000-8000-0000000bf002']
for (const f of FORMS) await q(`INSERT INTO public.forms (id, tenant_id, name) VALUES ($1, $2, 'Bench form')`, [f, T])

// History with the triggers off (as rows that predate the migration), in SQL.
const seedT0 = process.hrtime.bigint()
await q('BEGIN')
await q(`SET LOCAL usertasks.report_rollups = 'off'`)
await q(`
  INSERT INTO public.workflow_runs (tenant_id, workflow_id, status, started_at, completed_at, execution_trace, node_results, sla_due_at)
  SELECT $1, ($2::uuid[])[1 + (g % 20)],
         s.status,
         s.started,
         CASE WHEN s.status IN ('completed', 'failed') THEN s.started + (exp(3 + random() * 10) || ' milliseconds')::interval END,
         (SELECT jsonb_agg(jsonb_build_object('type', CASE WHEN k % 2 = 0 THEN 'node' ELSE 'edge' END, 'node_id', 'n' || (k % 7), 'at', s.started)) FROM generate_series(0, 4 + (g % 9)) k),
         (SELECT jsonb_object_agg('n' || k, jsonb_build_object('ok', true)) FROM generate_series(0, 2 + (g % 5)) k),
         CASE WHEN g % 3 = 0 THEN s.started + interval '1 hour' END
    FROM generate_series(1, $3) g
    CROSS JOIN LATERAL (SELECT now() - (random() * 180 || ' days')::interval AS started,
                               (ARRAY['completed','completed','completed','completed','failed','running','paused','waiting_for_event'])[1 + (g % 8)] AS status) s`, [T, WF, RUNS])
await q(`
  INSERT INTO public.tasks (tenant_id, title, status, workflow_id, created_at, completed_at, due_date)
  SELECT $1, 'Bench task', s.status::public.task_status, ($2::uuid[])[1 + (g % 20)], s.created,
         CASE WHEN s.status = 'completed' THEN s.created + (random() * 72 || ' hours')::interval END,
         CASE WHEN g % 2 = 0 THEN s.created + interval '24 hours' END
    FROM generate_series(1, $3) g
    CROSS JOIN LATERAL (SELECT now() - (random() * 180 || ' days')::interval AS created, (ARRAY['todo','in_progress','completed','completed','cancelled'])[1 + (g % 5)] AS status) s`, [T, WF, Math.round(RUNS / 4)])
await q(`
  INSERT INTO public.form_submissions (tenant_id, form_id, form_name, values, created_at)
  SELECT $1, ($2::uuid[])[1 + (g % 2)], 'Bench form', '{}', now() - (random() * 180 || ' days')::interval FROM generate_series(1, $3) g`, [T, FORMS, Math.round(RUNS / 10)])
await q('COMMIT')
await q('ANALYZE public.workflow_runs; ANALYZE public.tasks; ANALYZE public.form_submissions')
console.log(`Seeded in ${fmt(ms(seedT0) / 1000)} s`)

// Backfill.
const bfT0 = process.hrtime.bigint()
let steps = 0
for (;;) {
  const { rows } = await q(`SELECT public.report_rollup_backfill_next($1, 31) AS r`, [T])
  steps++
  if (rows[0].r.done) break
}
const backfillS = ms(bfT0) / 1000
await q('ANALYZE public.report_rollup_runs; ANALYZE public.report_rollup_nodes; ANALYZE public.report_rollup_tasks; ANALYZE public.report_rollup_submissions')
const { rows: [counts] } = await q(`SELECT (SELECT count(*) FROM public.report_rollup_runs WHERE tenant_id = $1) runs, (SELECT count(*) FROM public.report_rollup_nodes WHERE tenant_id = $1) nodes,
  (SELECT count(*) FROM public.report_rollup_tasks WHERE tenant_id = $1) tasks, (SELECT count(*) FROM public.report_rollup_submissions WHERE tenant_id = $1) subs`, [T])
console.log(`Backfill: ${fmt(backfillS)} s in ${steps} steps → rollup rows runs ${counts.runs}, nodes ${counts.nodes}, tasks ${counts.tasks}, submissions ${counts.subs}`)

const day0 = (d) => { const x = new Date(); x.setUTCHours(0, 0, 0, 0); x.setUTCDate(x.getUTCDate() - (d - 1)); return x.toISOString() }
const rows = []
const bench = async (name, liveSql, liveParams, rollSql, rollParams) => {
  // Both sides serialised to JSON in the database (the rollup reads return json; the API sends JSON either way).
  const live = await timeIt(`SELECT json_agg(x) FROM (${liveSql}) x`, liveParams)
  const roll = await timeIt(rollSql, rollParams)
  rows.push({ name, live, roll })
  console.log(`  ${name.padEnd(46)} live ${fmt(live).padStart(7)} ms   rollup ${fmt(roll).padStart(6)} ms   ×${fmt(live / roll)}`)
}
console.log('Reads (median of 5):')
await bench('Reports hub: daily stats, 180 days, all workflows',
  `SELECT * FROM public.workflow_run_daily_stats($1) WHERE workflow_id = ANY($2)`, [day0(180), WF],
  `SELECT public.report_rollup_run_days($1, $2)`, [T, day0(180)])
await bench('Duration stats (p50/p95), 90 days',
  `SELECT * FROM public.workflow_run_duration_stats($1, $2)`, [day0(90), WF],
  `SELECT public.report_rollup_run_days($1, $2, NULL, $3, false), public.report_rollup_run_hists($1, $2, NULL, $3, 'started', 'workflow')`, [T, day0(90), WF])
await bench('Compare page: node visits, 2 workflows',
  `SELECT * FROM public.workflow_node_visit_stats($1, NULL, 5000)`, [WF.slice(0, 2)],
  `SELECT public.report_rollup_node_visits($1, $2)`, [T, WF.slice(0, 2)])
await bench('Extension stats: 10 workflows, 30 days',
  `SELECT public.workflow_run_stats($1, $2, $3, now())`, [T, WF.slice(0, 10), day0(30)],
  `SELECT public.report_rollup_run_days($1, $3, NULL, $2), public.report_rollup_run_hists($1, $3, NULL, $2, 'started', 'workflow'), public.report_rollup_run_now($1, $2)`, [T, WF.slice(0, 10), day0(30)])
await bench('Widget: runs per day × status, 90 days (rolling)',
  `SELECT (started_at AT TIME ZONE 'UTC')::date, status, count(*) FROM public.workflow_runs WHERE tenant_id = $1 AND started_at >= now() - interval '90 days' GROUP BY 1, 2`, [T],
  `SELECT public.report_rollup_run_days($1, now() - interval '90 days')`, [T])
await bench('Widget: tasks created per day, 90 days',
  `SELECT (created_at AT TIME ZONE 'UTC')::date, status, count(*) FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND parent_task_id IS NULL AND created_at >= $2 GROUP BY 1, 2`, [T, day0(90)],
  `SELECT public.report_rollup_task_days($1, $2)`, [T, day0(90)])
await bench('Widget: cycle time histogram, tasks, 90 days',
  `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY completed_at - created_at), percentile_cont(0.9) WITHIN GROUP (ORDER BY completed_at - created_at) FROM public.tasks WHERE tenant_id = $1 AND status = 'completed' AND completed_at >= $2 AND deleted_at IS NULL AND parent_task_id IS NULL`, [T, day0(90)],
  `SELECT public.report_rollup_task_hists($1, $2, NULL, NULL, NULL, NULL, NULL, NULL, 'all')`, [T, day0(90)])
await bench('Widget: submissions per day, 90 days',
  `SELECT form_id, (created_at AT TIME ZONE 'UTC')::date, count(*) FROM public.form_submissions WHERE tenant_id = $1 AND created_at >= $2 GROUP BY 1, 2`, [T, day0(90)],
  `SELECT public.report_rollup_submission_days($1, $2)`, [T, day0(90)])

// Writes: one run transition = insert (running) + update (completed with a trace), autocommit each.
console.log('Writes (per statement, autocommit):')
const N = Number(arg('writes', 1000))
const trace = JSON.stringify(Array.from({ length: 12 }, (_, k) => ({ type: k % 2 ? 'edge' : 'node', node_id: `n${k % 7}` })))
const results = JSON.stringify({ n0: {}, n2: {}, n4: {} })
const writeBench = async (mode) => {
  await q(`SET usertasks.report_rollups = '${mode}'`)
  const ins = []
  const upd = []
  for (let i = 0; i < N; i++) {
    let t0 = process.hrtime.bigint()
    const { rows: [r] } = await q(`INSERT INTO public.workflow_runs (tenant_id, workflow_id, status) VALUES ($1, $2, 'running') RETURNING id`, [T, WF[i % 4]])
    ins.push(ms(t0))
    t0 = process.hrtime.bigint()
    await q(`UPDATE public.workflow_runs SET status = 'completed', completed_at = now(), execution_trace = $2, node_results = $3 WHERE id = $1`, [r.id, trace, results])
    upd.push(ms(t0))
  }
  await q(`RESET usertasks.report_rollups`)
  return { ins, upd }
}
const off = await writeBench('off')
const on = await writeBench('')
const line = (label, a, b) => console.log(`  ${label.padEnd(40)} off ${fmt(median(a))} / p95 ${fmt(pct(a, 0.95))} ms   on ${fmt(median(b))} / p95 ${fmt(pct(b, 0.95))} ms   added median ${fmt(median(b) - median(a))} ms`)
line('insert run (running)', off.ins, on.ins)
line('complete run (status + 12-entry trace)', off.upd, on.upd)

// Correctness spot check after the writes.
const { rows: [chk] } = await q(`SELECT (SELECT sum(runs) FROM public.report_rollup_runs WHERE tenant_id = $1) AS rolled, (SELECT count(*) FROM public.workflow_runs WHERE tenant_id = $1) AS raw`, [T])
console.log(`Check: rollup runs ${chk.rolled} vs raw ${chk.raw} (triggers off for ${N} runs, so they differ by ${N} until the next reconcile)`)

if (!KEEP) {
  await q(`DELETE FROM public.tenants WHERE id = $1`, [T])
  console.log('Bench workspace deleted.')
}
await db.end()
