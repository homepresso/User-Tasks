/**
 * SQL-level checks for supabase/migrations/20270123100000_report_rollups.sql
 * on generated data:
 *
 *  - the delta triggers keep report_rollup_runs / _nodes / _tasks /
 *    _submissions equal to the raw aggregates (report_rollup_*_agg) through
 *    inserts, status transitions, trace appends and rewrites, node_results
 *    changes, reassignment, moves between workflows / days, soft and hard
 *    deletes and retries that write the same values;
 *  - the reads agree with the live RPCs of before: workflow_run_daily_stats
 *    (exact), workflow_run_duration_stats (counts / avg exact, p50 / p95
 *    within the documented histogram tolerance), workflow_run_stats,
 *    workflow_node_visit_stats, form_submission_stats;
 *  - windows with partial edge days are exact (today included);
 *  - backfill: history written with the triggers off is wrong until the
 *    backfill reaches it, reads say not_covered until then, the backfill
 *    resumes in chunks and is exact; the dirty queue rebuilds requested
 *    ranges in batches; 'defer' mode queues days instead of deltas;
 *  - RLS: rollup rows are visible to workflows.view_runs holders only.
 *
 * Runs against the local Supabase stack or plain PostgreSQL — set
 * EVENT_STREAM_DB_URL. Everything runs inside one transaction that is rolled back.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Client } from 'pg'
import { HIST_RELATIVE_ERROR } from '@/lib/report-rollups/hist'
import { rollupRunDays, rollupRunHists, rollupRunStats, rollupSubmissionStats, toDailyStats, toDurationStats } from '@/lib/services/report-rollups'

const DB_URL = process.env.EVENT_STREAM_DB_URL

const hex = (n: number) => n.toString(16).padStart(12, '0')
const uid = (n: number) => `0f000000-0000-4000-8000-${hex(n)}`
const T1 = uid(1)
const T2 = uid(2)
const WF = [uid(0x101), uid(0x102), uid(0x103)]
const WX = uid(0x109) // tenant 2
const FORMS = [uid(0x201), uid(0x202)]
const TEAM = uid(0x301)
const U1 = 'a1f00001-0000-4000-8000-000000000401'
const U2 = 'a1f00002-0000-4000-8000-000000000402'
const DAY = 86_400_000

/* Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = rng(42)
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]

const STATUSES = ['completed', 'completed', 'completed', 'failed', 'running', 'paused', 'waiting_for_event', 'pending', 'cancelled'] as const

function trace(nodes: number): unknown[] {
  const out: unknown[] = []
  for (let i = 0; i < nodes; i++) {
    out.push({ type: 'node', node_id: `n${Math.floor(rand() * 5)}` })
    if (rand() < 0.7) out.push({ type: 'edge', from: 'a', to: 'b' })
  }
  return out
}

describe.skipIf(!DB_URL)('report rollups (local DB)', () => {
  const db = new Client({ connectionString: DB_URL })
  const q = (sql: string, params: unknown[] = []) => db.query(sql, params)
  /** supabase-js-like rpc over pg (named arguments, one jsonb / scalar result). */
  const rpcDb = {
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      const keys = Object.keys(args)
      try {
        const { rows } = await q(`SELECT public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`, keys.map((k) => args[k]))
        return { data: rows[0]?.r ?? null, error: null }
      } catch (e) {
        return { data: null, error: { message: (e as Error).message, code: (e as { code?: string }).code } }
      }
    },
  }
  const now = Date.now()
  const today0 = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate())
  const iso = (ms: number) => new Date(ms).toISOString()

  /** Rollup rows (shards summed) vs the raw aggregate, for the whole tenant. */
  async function compareAll(tenant: string) {
    const trim = `(SELECT coalesce(array_agg(x ORDER BY i), '{}') FROM unnest(h) WITH ORDINALITY u(x, i) WHERE i <= coalesce((SELECT max(j) FROM unnest(h) WITH ORDINALITY v(y, j) WHERE y <> 0), 0))`
    const runCols = 'runs, st_completed, st_failed, st_cancel_manual, st_cancelled, st_running, st_waiting_for_event, st_paused, st_pending, st_waiting, done_n, round(done_ms::numeric, 3) AS done_ms, timed_n, round(timed_ms::numeric, 3) AS timed_ms, node_visits, edge_traversals, fin_n, fin_on_time, fin_late, fin_no_due, round(fin_ms::numeric, 3) AS fin_ms'
    const { rows: rolled } = await q(`
      WITH g AS (SELECT workflow_id, day, sum(runs) runs, sum(st_completed) st_completed, sum(st_failed) st_failed, sum(st_cancel_manual) st_cancel_manual,
          sum(st_cancelled) st_cancelled, sum(st_running) st_running, sum(st_waiting_for_event) st_waiting_for_event, sum(st_paused) st_paused,
          sum(st_pending) st_pending, sum(st_waiting) st_waiting, sum(done_n) done_n, sum(done_ms) done_ms, sum(timed_n) timed_n, sum(timed_ms) timed_ms,
          sum(node_visits) node_visits, sum(edge_traversals) edge_traversals, sum(fin_n) fin_n, sum(fin_on_time) fin_on_time, sum(fin_late) fin_late,
          sum(fin_no_due) fin_no_due, sum(fin_ms) fin_ms, public.report_rollup_hist_sum(hist) hist, public.report_rollup_hist_sum(fin_hist) fin_hist
        FROM public.report_rollup_runs WHERE tenant_id = $1 GROUP BY 1, 2)
      SELECT workflow_id, day::text, ${runCols}, (SELECT ${trim} FROM (SELECT g.hist AS h) z) AS hist, (SELECT ${trim} FROM (SELECT g.fin_hist AS h) z) AS fin_hist
        FROM g WHERE runs <> 0 OR fin_n <> 0 ORDER BY 1, 2`, [tenant])
    const { rows: raw } = await q(`
      SELECT workflow_id, day::text, ${runCols}, (SELECT ${trim} FROM (SELECT a.hist AS h) z) AS hist, (SELECT ${trim} FROM (SELECT a.fin_hist AS h) z) AS fin_hist
        FROM public.report_rollup_runs_agg($1, '-infinity', 'infinity') a ORDER BY 1, 2`, [tenant])
    expect(rolled).toEqual(raw)

    const { rows: nRolled } = await q(`SELECT workflow_id, day::text, node_id, sum(visits)::bigint AS v FROM public.report_rollup_nodes WHERE tenant_id = $1 GROUP BY 1, 2, 3 HAVING sum(visits) <> 0 ORDER BY 1, 2, 3`, [tenant])
    const { rows: nRaw } = await q(`SELECT workflow_id, day::text, node_id, visits::bigint AS v FROM public.report_rollup_nodes_agg($1, '-infinity', 'infinity') ORDER BY 1, 2, 3`, [tenant])
    expect(nRolled).toEqual(nRaw)

    const taskCols = 'cr_total, cr_draft, cr_todo, cr_in_progress, cr_blocked, cr_completed, cr_cancelled, done_n, done_on_time, done_late, done_no_due, round(done_ms::numeric, 3) AS done_ms'
    const { rows: tRolled } = await q(`SELECT day::text, workflow_id, team_id, assignee_id, ${taskCols} FROM public.report_rollup_tasks WHERE tenant_id = $1 AND (cr_total <> 0 OR done_n <> 0) ORDER BY 1, 2, 3, 4`, [tenant])
    const { rows: tRaw } = await q(`SELECT day::text, workflow_id, team_id, assignee_id, ${taskCols} FROM public.report_rollup_tasks_agg($1, '-infinity', 'infinity') ORDER BY 1, 2, 3, 4`, [tenant])
    expect(tRolled).toEqual(tRaw)

    const { rows: sRolled } = await q(`SELECT form_id, day::text, sum(submissions)::bigint AS n FROM public.report_rollup_submissions WHERE tenant_id = $1 GROUP BY 1, 2 HAVING sum(submissions) <> 0 ORDER BY 1, 2`, [tenant])
    const { rows: sRaw } = await q(`SELECT form_id, day::text, submissions::bigint AS n FROM public.report_rollup_submissions_agg($1, '-infinity', 'infinity') ORDER BY 1, 2`, [tenant])
    expect(sRolled).toEqual(sRaw)
  }

  const runIds: string[] = []
  const taskIds: string[] = []

  async function addRun(tenant: string, wf: string, opts: { daysAgo: number }) {
    // Today's runs stay inside today's UTC day: run just after midnight UTC (as
    // CI did at 00:44), a 6-hour jitter put nearly all of them on yesterday.
    const jitter = opts.daysAgo === 0 ? Math.min(6 * 3600_000, now % DAY) : 6 * 3600_000
    const started = now - opts.daysAgo * DAY - Math.floor(rand() * jitter)
    const status = pick(STATUSES)
    const dur = Math.floor(10 ** (1 + rand() * 6)) // 10 ms … 10^7 ms
    const done = ['completed', 'failed', 'cancelled'].includes(status)
    const completed = done ? Math.min(started + dur, now - 1000) : null
    const tr = rand() < 0.15 ? [] : trace(1 + Math.floor(rand() * 6))
    const results = Object.fromEntries((tr as Array<{ type: string; node_id?: string }>).filter((e) => e.type === 'node').map((e) => [e.node_id!, { ok: true }]))
    if (tr.length === 0 && rand() < 0.5) results.only_result = { ok: true }
    const due = rand() < 0.5 ? iso(started + Math.floor(rand() * 2 * dur)) : null
    const error = status === 'failed' && rand() < 0.3 ? 'Manually cancelled' : null
    const { rows } = await q(`INSERT INTO public.workflow_runs (tenant_id, workflow_id, status, started_at, completed_at, execution_trace, node_results, sla_due_at, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`, [tenant, wf, status, iso(started), completed ? iso(completed) : null, JSON.stringify(tr), JSON.stringify(results), due, error])
    if (tenant === T1) runIds.push(rows[0].id)
  }

  async function addTask(tenant: string, opts: { daysAgo: number }) {
    const created = now - opts.daysAgo * DAY - Math.floor(rand() * 6 * 3600_000)
    const status = pick(['todo', 'in_progress', 'blocked', 'completed', 'completed', 'cancelled', 'draft'] as const)
    const completed = status === 'completed' ? Math.min(created + Math.floor(rand() * 3 * DAY), now - 1000) : null
    const due = rand() < 0.6 ? iso(created + Math.floor(rand() * 2 * DAY)) : null
    const { rows } = await q(`INSERT INTO public.tasks (tenant_id, title, status, assignee_id, assigned_team_id, workflow_id, created_at, completed_at, due_date)
      VALUES ($1, 'Rollup task', $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [tenant, status, pick([U1, U2, null]), rand() < 0.4 ? TEAM : null, tenant === T1 ? pick([...WF, null]) : null, iso(created), completed ? iso(completed) : null, due])
    if (tenant === T1) taskIds.push(rows[0].id)
  }

  beforeAll(async () => {
    await db.connect()
    await q('BEGIN')
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Rollups A', 'rollups-a-test')`, [T1])
    await q(`INSERT INTO public.tenants (id, name, slug) VALUES ($1, 'Rollups B', 'rollups-b-test')`, [T2])
    for (const u of [U1, U2]) {
      await q(`INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES ($1, $2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated')`, [u, `r${u.slice(-4)}.${Date.now().toString(36)}@rollups.test`])
      await q(`INSERT INTO public.user_memberships (user_id, tenant_id, role) VALUES ($1, $2, 'member') ON CONFLICT (user_id, tenant_id) DO NOTHING`, [u, T1])
    }
    await q(`INSERT INTO public.teams (id, tenant_id, name) VALUES ($1, $2, 'Desk')`, [TEAM, T1])
    for (const [i, w] of WF.entries()) await q(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type) VALUES ($1, $2, $3, 'manual')`, [w, T1, `W${i}`])
    await q(`INSERT INTO public.workflows (id, tenant_id, name, trigger_type) VALUES ($1, $2, 'X', 'manual')`, [WX, T2])
    for (const f of FORMS) await q(`INSERT INTO public.forms (id, tenant_id, name) VALUES ($1, $2, 'Form')`, [f, T1])

    // History before the "install": triggers off (as if the rows predate the migration).
    await q(`SET LOCAL usertasks.report_rollups = 'off'`)
    for (let i = 0; i < 160; i++) await addRun(T1, pick(WF), { daysAgo: 3 + Math.floor(rand() * 40) })
    for (let i = 0; i < 60; i++) await addTask(T1, { daysAgo: 3 + Math.floor(rand() * 40) })
    for (let i = 0; i < 40; i++) await q(`INSERT INTO public.form_submissions (tenant_id, form_id, form_name, values, created_at) VALUES ($1, $2, 'f', '{}', $3)`, [T1, pick(FORMS), iso(now - (3 + rand() * 40) * DAY)])
    await q(`SET LOCAL usertasks.report_rollups = ''`)
    // Recent activity with the triggers on (today included).
    for (let i = 0; i < 120; i++) await addRun(T1, pick(WF), { daysAgo: Math.floor(rand() * 4) })
    for (let i = 0; i < 10; i++) await addRun(T2, WX, { daysAgo: Math.floor(rand() * 4) })
    for (let i = 0; i < 50; i++) await addTask(T1, { daysAgo: Math.floor(rand() * 4) })
    for (let i = 0; i < 30; i++) await q(`INSERT INTO public.form_submissions (tenant_id, form_id, form_name, values, created_at) VALUES ($1, $2, 'f', '{}', $3)`, [T1, pick(FORMS), iso(now - rand() * 3 * DAY)])
  }, 120_000)

  afterAll(async () => {
    await q('ROLLBACK').catch(() => undefined)
    await db.end()
  })

  it('reads say not_backfilled before the backfill, and history rows are not trusted', async () => {
    const r = await rpcDb.rpc('report_rollup_run_days', { p_tenant_id: T1, p_since: iso(today0 - 10 * DAY) })
    expect(r.data).toMatchObject({ ok: false, reason: 'not_backfilled' })
    expect((await rollupRunDays(rpcDb as never, T1, { since: iso(today0 - 10 * DAY) })).ok).toBe(false)
  })

  it('backfill resumes in chunks, reports coverage, and ends exact', async () => {
    const first = await rpcDb.rpc('report_rollup_backfill_next', { p_tenant_id: T1, p_days: 5 })
    expect(first.data.done).toBe(false)
    const coveredFrom = first.data.covered_from as string
    expect(coveredFrom).toBe(new Date(today0 - 4 * DAY).toISOString().slice(0, 10))
    // A window inside the covered days is answered; one reaching further back is not.
    expect((await rpcDb.rpc('report_rollup_run_days', { p_tenant_id: T1, p_since: iso(today0 - 3 * DAY) })).data.ok).toBe(true)
    expect((await rpcDb.rpc('report_rollup_run_days', { p_tenant_id: T1, p_since: iso(today0 - 10 * DAY) })).data).toMatchObject({ ok: false, reason: 'not_covered' })
    let steps = 1
    for (;;) {
      const r = await rpcDb.rpc('report_rollup_backfill_next', { p_tenant_id: T1, p_days: 7 })
      steps++
      expect(r.error).toBeNull()
      if (r.data.done) break
      expect(steps).toBeLessThan(20)
    }
    expect(steps).toBeGreaterThan(3)
    await rpcDb.rpc('report_rollup_backfill_next', { p_tenant_id: T2, p_days: 30 })
    await compareAll(T1)
    await compareAll(T2)
  })

  it('delta triggers stay exact through transitions, appends, rewrites, moves, retries and deletes', async () => {
    const some = (n: number) => runIds.slice(-n)
    for (const id of some(40)) {
      const op = rand()
      if (op < 0.25) {
        await q(`UPDATE public.workflow_runs SET status = 'completed', completed_at = greatest(started_at + interval '5 seconds', completed_at) WHERE id = $1`, [id])
      } else if (op < 0.45) {
        await q(`UPDATE public.workflow_runs SET execution_trace = execution_trace || $2::jsonb, node_results = node_results || '{"n7": {}}'::jsonb WHERE id = $1`, [id, JSON.stringify(trace(2))])
      } else if (op < 0.55) {
        await q(`UPDATE public.workflow_runs SET execution_trace = $2::jsonb WHERE id = $1`, [id, JSON.stringify(trace(1))]) // rewrite (capped)
      } else if (op < 0.65) {
        await q(`UPDATE public.workflow_runs SET workflow_id = $2 WHERE id = $1`, [id, pick(WF)])
      } else if (op < 0.72) {
        await q(`UPDATE public.workflow_runs SET started_at = started_at - interval '2 days' WHERE id = $1`, [id])
      } else if (op < 0.8) {
        await q(`UPDATE public.workflow_runs SET status = status, execution_trace = execution_trace WHERE id = $1`, [id]) // retry: same values
      } else if (op < 0.88) {
        await q(`UPDATE public.workflow_runs SET status = 'failed', error = 'Manually cancelled', completed_at = now() WHERE id = $1`, [id])
      } else {
        await q(`DELETE FROM public.workflow_runs WHERE id = $1`, [id])
      }
    }
    // A history run (pre-install, now backfilled) completing today.
    await q(`UPDATE public.workflow_runs SET status = 'completed', completed_at = now() WHERE id = $1`, [runIds[3]])
    for (const id of taskIds.slice(-30)) {
      const op = rand()
      if (op < 0.3) await q(`UPDATE public.tasks SET status = 'completed', completed_at = now() WHERE id = $1`, [id])
      else if (op < 0.5) await q(`UPDATE public.tasks SET assignee_id = $2, assigned_team_id = NULL WHERE id = $1`, [id, U2])
      else if (op < 0.6) await q(`UPDATE public.tasks SET deleted_at = now() WHERE id = $1`, [id])
      else if (op < 0.7) await q(`UPDATE public.tasks SET due_date = now() - interval '1 day' WHERE id = $1`, [id])
      else if (op < 0.8) await q(`DELETE FROM public.tasks WHERE id = $1`, [id])
      else await q(`UPDATE public.tasks SET status = status WHERE id = $1`, [id])
    }
    await q(`DELETE FROM public.form_submissions WHERE id IN (SELECT id FROM public.form_submissions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 3)`, [T1])
    await q(`UPDATE public.form_submissions SET created_at = created_at - interval '1 day' WHERE id IN (SELECT id FROM public.form_submissions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 2)`, [T1])
    await compareAll(T1)
    // Busy buckets are sharded: today's runs of a workflow spread over several rows.
    const { rows } = await q(`SELECT count(DISTINCT shard)::int AS n FROM public.report_rollup_runs WHERE tenant_id = $1 AND day = public.report_rollup_day(now())`, [T1])
    expect(rows[0].n).toBeGreaterThan(1)
  })

  it('daily stats equal workflow_run_daily_stats; durations within the histogram tolerance', async () => {
    const since = iso(today0 - 30 * DAY)
    const { rows: live } = await q(`SELECT workflow_id, day::text AS day, runs, active, errors, completed, round(completed_ms::numeric, 2) AS completed_ms, timed, round(timed_ms::numeric, 2) AS timed_ms, node_visits::int AS node_visits, edge_traversals::int AS edge_traversals
      FROM public.workflow_run_daily_stats($1) WHERE workflow_id = ANY($2) ORDER BY 2, 1`, [since, WF])
    const rolled = await rollupRunDays(rpcDb as never, T1, { since })
    expect(rolled).toMatchObject({ ok: true })
    const shaped = toDailyStats(rolled.ok ? rolled.value : []).map((r) => ({
      workflow_id: r.workflow_id, day: r.day, runs: r.runs, active: r.active, errors: r.errors, completed: r.completed,
      completed_ms: r.completed_ms, timed: r.timed, timed_ms: r.timed_ms, node_visits: r.node_visits, edge_traversals: r.edge_traversals,
    })).sort((a, b) => a.day.localeCompare(b.day) || a.workflow_id.localeCompare(b.workflow_id))
    // Counts are exact; millisecond sums are double precision added in a
    // different order (per shard, then summed), so they agree to float error,
    // not to the cent ("262992715.80" vs "…79" on CI).
    const ms = (v: unknown) => Number(v)
    expect(shaped.map(({ completed_ms: _c, timed_ms: _t, ...rest }) => rest)).toEqual(live.map(({ completed_ms: _c, timed_ms: _t, ...rest }) => rest))
    shaped.forEach((r, i) => {
      for (const k of ['completed_ms', 'timed_ms'] as const) expect(Math.abs(ms(r[k]) - ms(live[i][k]))).toBeLessThanOrEqual(0.011 + Math.abs(ms(live[i][k])) * 1e-12)
    })

    const { rows: dur } = await q(`SELECT * FROM public.workflow_run_duration_stats($1, $2)`, [since, WF])
    const [days, hists] = await Promise.all([rollupRunDays(rpcDb as never, T1, { since, workflowIds: WF, byDay: false }), rollupRunHists(rpcDb as never, T1, { since, workflowIds: WF, side: 'started', group: 'workflow' })])
    const stats = toDurationStats(days.ok ? days.value : [], hists.ok ? hists.value : [])
    for (const live of dur) {
      const mine = stats.find((s) => s.workflow_id === live.workflow_id)!
      expect([mine.runs, mine.completed, mine.failed, mine.active]).toEqual([live.runs, live.completed, live.failed, live.active])
      expect(mine.avg_ms).toBeCloseTo(live.avg_ms, 3)
      for (const k of ['p50_ms', 'p95_ms'] as const) {
        if (live[k] === null) { expect(mine[k]).toBeNull(); continue }
        // Each rank's value is replaced by its bucket midpoint (≤ 9.05% off); the run duration
        // test data starts at 10 ms, so the < 1 ms bucket is not involved.
        expect(Math.abs(mine[k]! - live[k]) / live[k]).toBeLessThanOrEqual(HIST_RELATIVE_ERROR + 1e-9)
      }
    }
  })

  it('windows with partial edge days are exact (live edges + rollup days)', async () => {
    for (const [since, until] of [[now - 3.4 * DAY, now - 1.3 * DAY], [now - 0.4 * DAY, null], [today0 + 3600_000, now - 60 * 60_000], [now - 20.5 * DAY, null]] as Array<[number, number | null]>) {
      const r = await rollupRunDays(rpcDb as never, T1, { since: iso(since), until: until ? iso(until) : null })
      expect(r.ok).toBe(true)
      const sum = (r.ok ? r.value : []).reduce((a, x) => ({ runs: a.runs + x.runs, fin: a.fin + x.fin_n, nv: a.nv + x.node_visits }), { runs: 0, fin: 0, nv: 0 })
      const { rows } = await q(`SELECT coalesce(sum(runs), 0)::int AS runs, coalesce(sum(fin_n), 0)::int AS fin, coalesce(sum(node_visits), 0)::int AS nv FROM public.report_rollup_runs_agg($1, $2, $3)`, [T1, iso(since), until ? iso(until) : 'infinity'])
      expect(sum).toEqual(rows[0])
    }
  })

  it('node visits, run stats and submission stats agree with the live RPCs', async () => {
    const { rows: liveNodes } = await q(`SELECT workflow_id, node_id, visits::int AS visits FROM public.workflow_node_visit_stats($1, NULL, 10000) ORDER BY 1, 2`, [WF])
    const nodes = await rpcDb.rpc('report_rollup_node_visits', { p_tenant_id: T1, p_workflow_ids: WF })
    expect((nodes.data.rows as unknown[][]).map((r) => ({ workflow_id: r[0], node_id: r[1], visits: Number(r[2]) }))).toEqual(liveNodes)

    const since = iso(today0 - 14 * DAY)
    const until = iso(now)
    const { rows: [{ r: liveStats }] } = await q(`SELECT public.workflow_run_stats($1, $2::uuid[], $3, $4) AS r`, [T1, WF, since, until])
    const mine = await rollupRunStats(rpcDb as never, T1, { workflowIds: WF, since, until })
    expect(mine).not.toBeNull()
    for (const w of liveStats.workflows) {
      const m = mine!.workflows.find((x) => x.workflow_id === w.workflow_id)!
      expect([m.started, m.completed, m.failed, m.cancelled, m.running, m.waiting, m.queued]).toEqual([w.started, w.completed, w.failed, w.cancelled, w.running, w.waiting, w.queued])
      // Averages are rounded double-precision sums added in a different order
      // (per shard): equal to within a millisecond, not always to the digit (260822 vs 260821 on CI).
      const close = (a: number | null, b: unknown) => (b === null ? a === null : a !== null && Math.abs(a - Number(b)) <= 1)
      expect(close(m.avg_ms, w.avg_ms), `avg_ms ${m.avg_ms} vs ${w.avg_ms}`).toBe(true)
      expect(m.per_day.map(({ avg_ms: _a, ...rest }: { avg_ms: number | null }) => rest)).toEqual(w.per_day.map(({ avg_ms: _a, ...rest }: { avg_ms: unknown }) => rest))
      m.per_day.forEach((d: { avg_ms: number | null }, i: number) => expect(close(d.avg_ms, w.per_day[i].avg_ms), `per_day[${i}].avg_ms`).toBe(true))
      if (w.p95_ms !== null) expect(Math.abs(m.p95_ms! - Number(w.p95_ms)) / Number(w.p95_ms)).toBeLessThanOrEqual(HIST_RELATIVE_ERROR + 0.01)
    }
    expect(mine!.total.started).toEqual(liveStats.total.started)

    const { rows: [{ r: liveSubs }] } = await q(`SELECT public.form_submission_stats($1, $2::uuid[], $3, $4) AS r`, [T1, FORMS, since, until])
    const subs = await rollupSubmissionStats(rpcDb as never, T1, { formIds: FORMS, since, until })
    for (const f of liveSubs.forms) {
      const m = subs!.find((x) => x.form_id === f.form_id)!
      expect(m.total).toEqual(Number(f.total))
      expect(m.per_day).toEqual(f.per_day)
      expect(new Date(m.last_at!).getTime()).toEqual(new Date(f.last_at).getTime())
    }
  })

  it('task days honour the viewer scope and filters exactly', async () => {
    const since = iso(today0 - 60 * DAY)
    const scoped = await rpcDb.rpc('report_rollup_task_days', { p_tenant_id: T1, p_since: since, p_scope_user: U1, p_scope_teams: [TEAM] })
    const created = (scoped.data.rows as unknown[][]).reduce((a, r) => a + Number(r[3]), 0)
    const { rows } = await q(`SELECT count(*)::int AS n FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND parent_task_id IS NULL AND created_at >= $2 AND (assignee_id = $3 OR assigned_team_id = $4)`, [T1, since, U1, TEAM])
    expect(created).toBe(rows[0].n)
    const all = await rpcDb.rpc('report_rollup_task_days', { p_tenant_id: T1, p_since: since, p_workflow_id: WF[0] })
    const { rows: wf } = await q(`SELECT count(*)::int AS n FROM public.tasks WHERE tenant_id = $1 AND deleted_at IS NULL AND parent_task_id IS NULL AND created_at >= $2 AND workflow_id = $3`, [T1, since, WF[0]])
    expect((all.data.rows as unknown[][]).reduce((a, r) => a + Number(r[3]), 0)).toBe(wf[0].n)
  })

  it('dirty queue: requested ranges and deferred trigger work are rebuilt in batches', async () => {
    // Corrupt some history, queue a rebuild of it, drain in 3-day batches.
    await q(`UPDATE public.report_rollup_runs SET runs = runs + 5 WHERE tenant_id = $1 AND day BETWEEN public.report_rollup_day(now()) - 12 AND public.report_rollup_day(now()) - 5`, [T1])
    await rpcDb.rpc('report_rollup_request_rebuild', { p_tenant_id: T1, p_from: new Date(today0 - 12 * DAY).toISOString().slice(0, 10), p_to: new Date(today0 - 5 * DAY).toISOString().slice(0, 10) })
    let batches = 0
    for (;;) {
      const r = await rpcDb.rpc('report_rollup_drain_next', { p_days: 3 })
      if (r.data.idle) break
      batches++
    }
    expect(batches).toBe(3)
    await compareAll(T1)

    // Deferred mode: deltas become queued days; the drain makes them exact.
    await q(`SET LOCAL usertasks.report_rollups = 'defer'`)
    await addRun(T1, WF[1], { daysAgo: 1 })
    await q(`UPDATE public.workflow_runs SET status = 'completed', completed_at = now() WHERE id = $1`, [runIds[runIds.length - 1]])
    await q(`SET LOCAL usertasks.report_rollups = ''`)
    const pending = await rpcDb.rpc('report_rollup_pending', {})
    expect(pending.data.dirty).toBe(true)
    const fresh = await rpcDb.rpc('report_rollup_tenant_freshness', { p_tenant_id: T1 })
    expect(Number(fresh.data.dirty_ranges)).toBeGreaterThan(0)
    while (!(await rpcDb.rpc('report_rollup_drain_next', { p_days: 31 })).data.idle) { /* drain */ }
    await compareAll(T1)
  })

  it('reconcile rebuilds today and yesterday and compacts their shards', async () => {
    const r = await rpcDb.rpc('report_rollup_reconcile_next', { p_min_age_minutes: 0, p_tenant_id: T1 })
    expect(r.data.rebuilt.days).toBe(2)
    const { rows } = await q(`SELECT count(*)::int AS n FROM public.report_rollup_runs WHERE tenant_id = $1 AND day >= public.report_rollup_day(now()) - 1 AND shard <> 0`, [T1])
    expect(rows[0].n).toBe(0)
    await compareAll(T1)
  })

  it('a deleted workflow takes its rollup rows with it', async () => {
    await q(`DELETE FROM public.workflows WHERE id = $1`, [WF[2]])
    const { rows } = await q(`SELECT count(*)::int AS n FROM public.report_rollup_runs WHERE tenant_id = $1 AND workflow_id = $2`, [T1, WF[2]])
    expect(rows[0].n).toBe(0)
    await compareAll(T1)
  })

  it('RLS: rollup rows only for workflows.view_runs holders; state is service only', async () => {
    const asUser = async (sql: string, params: unknown[] = []) => {
      await q('SAVEPOINT rls')
      try {
        await q(`SET LOCAL ROLE authenticated`)
        await q(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U1, role: 'authenticated' })])
        return (await q(sql, params)).rows
      } catch (e) {
        return `err:${(e as { code?: string }).code}`
      } finally {
        await q('ROLLBACK TO SAVEPOINT rls')
      }
    }
    // U1 is a member (role "member" holds no workflows.view_runs by default).
    const { rows: perms } = await q(`SELECT bool_or('workflows.view_runs' = ANY (r.permissions)) AS ok FROM public.user_roles ur JOIN public.roles r ON r.id = ur.role_id WHERE ur.user_id = $1 AND ur.tenant_id = $2`, [U1, T1])
    const seen = await asUser(`SELECT count(*)::int AS n FROM public.report_rollup_runs WHERE tenant_id = $1`, [T1])
    if (perms[0]?.ok) expect((seen as Array<{ n: number }>)[0].n).toBeGreaterThan(0)
    else expect(seen).toEqual([{ n: 0 }])
    expect(await asUser(`SELECT count(*) FROM public.report_rollup_runs WHERE tenant_id = $1`, [T2])).toEqual([{ count: '0' }])
    expect(await asUser(`SELECT * FROM public.report_rollup_state`)).toBe('err:42501')
    // The DEFINER helpers answer a signed-in caller only for their own workspaces (U1 is a member of T1, not T2).
    expect(await asUser(`SELECT ok, reason FROM public.report_rollup_window($1, now() - interval '3 days', NULL)`, [T2])).toEqual([{ ok: false, reason: 'forbidden' }])
    expect(await asUser(`SELECT public.report_rollup_tenant_freshness($1) AS r`, [T2])).toEqual([{ r: null }])
    expect(await asUser(`SELECT ok FROM public.report_rollup_window($1, now() - interval '3 days', NULL)`, [T1])).toEqual([{ ok: true }])
    expect((await asUser(`SELECT public.report_rollup_tenant_freshness($1) AS r`, [T1]) as Array<{ r: { done: boolean } }>)[0].r.done).toBe(true)
    expect(await asUser(`SELECT public.report_rollup_run_days($1, now() - interval '3 days') AS r`, [T2])).toEqual([{ r: { ok: false, reason: 'forbidden' } }])
    expect(await asUser(`SELECT public.report_rollup_rebuild($1, current_date, current_date)`, [T1])).toBe('err:42501')
  })
})
