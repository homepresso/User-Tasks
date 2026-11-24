/**
 * Report rollups — reads (supabase/migrations/20270123100000_report_rollups.sql).
 *
 * Report metrics read flat per-day rollup tables instead of aggregating raw
 * runs / tasks / submissions on every load. The rollups are maintained in
 * the same transaction as each change (delta triggers), so they include
 * today; partial days at the edges of a window are aggregated live by the
 * SQL, so any window is exact. Durations p50 / p95 come from histograms
 * (lib/report-rollups/hist: within 9.1%).
 *
 * Every function here returns null when the rollups can't answer — the
 * migration isn't applied, REPORT_ROLLUPS=off, or the tenant isn't
 * backfilled far enough back for the window — and the caller then uses its
 * live path (the RPCs of before), with the reason as the flag
 * ({ ok: false, reason }).
 *
 * Access: these functions only read what they're given. The callers check
 * permissions and pass the viewer's scope (workflow ids, task scope) — the
 * same rules as their live paths (lib/services/run-visibility, the widget
 * task scope, forms.edit); the RPCs are SECURITY INVOKER, so a signed-in
 * caller's session client also gets the rollup tables' RLS on top.
 */

import type { AnySupabaseClient } from './context'
import { histQuantile, mergeHists } from '@/lib/report-rollups/hist'

/* eslint-disable @typescript-eslint/no-explicit-any -- rpc payloads */

export type RollupReason = 'disabled' | 'not_installed' | 'not_backfilled' | 'not_covered' | 'forbidden' | 'error'
export type RollupResult<T> = { ok: true; value: T } | { ok: false; reason: RollupReason }

const MISSING = new Set(['PGRST202', '42883', '42P01'])
let missingUntil = 0

/** REPORT_ROLLUPS=off forces the live path everywhere (ops switch). */
export function rollupsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !/^(off|false|0|no)$/i.test(String(env.REPORT_ROLLUPS ?? '').trim())
}

/** Tests: forget that the functions were missing. */
export function resetRollupAvailability(): void {
  missingUntil = 0
}

async function call(db: AnySupabaseClient, fn: string, args: Record<string, unknown>): Promise<RollupResult<any>> {
  if (!rollupsEnabled()) return { ok: false, reason: 'disabled' }
  if (Date.now() < missingUntil) return { ok: false, reason: 'not_installed' }
  let res: { data: any; error: any }
  try {
    res = await (db as any).rpc(fn, args)
  } catch {
    return { ok: false, reason: 'error' }
  }
  if (res.error) {
    if (MISSING.has(String(res.error.code ?? ''))) {
      missingUntil = Date.now() + 5 * 60_000
      return { ok: false, reason: 'not_installed' }
    }
    console.warn(`[report-rollups] ${fn} failed, using the live path: ${res.error.message}`)
    return { ok: false, reason: 'error' }
  }
  const data = res.data
  if (!data || data.ok !== true) return { ok: false, reason: (data?.reason as RollupReason) ?? 'error' }
  return { ok: true, value: data }
}

const num = (v: unknown) => Number(v ?? 0) || 0
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(String(v)).toISOString())
const ids = (v: readonly string[] | null | undefined) => (v ? [...new Set(v.map(String))] : null)

function zip(cols: string[], row: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  cols.forEach((c, i) => { out[c] = row[i] })
  return out
}

/* ── Runs ─────────────────────────────────────────────────────────────── */

export interface RunDayRow {
  workflow_id: string
  /** YYYY-MM-DD (UTC). */
  day: string
  /** Started that day: */
  runs: number
  st_completed: number
  st_failed: number
  st_cancel_manual: number
  st_cancelled: number
  st_running: number
  st_waiting_for_event: number
  st_paused: number
  st_pending: number
  st_waiting: number
  done_n: number
  done_ms: number
  timed_n: number
  timed_ms: number
  node_visits: number
  edge_traversals: number
  last_started_at: string | null
  last_completed_at: string | null
  /** Completed that day: */
  fin_n: number
  fin_on_time: number
  fin_late: number
  fin_no_due: number
  fin_ms: number
}

export interface RunWindow {
  since: string | null
  /** Exclusive end; null / within a minute of now = up to now. */
  until?: string | null
  /** null = every workflow of the tenant. */
  workflowIds?: readonly string[] | null
  /** false: one row per workflow (day ''), totals only. */
  byDay?: boolean
}

export async function rollupRunDays(db: AnySupabaseClient, tenantId: string, w: RunWindow): Promise<RollupResult<RunDayRow[]>> {
  const r = await call(db, 'report_rollup_run_days', { p_tenant_id: tenantId, p_since: w.since, p_until: w.until ?? null, p_workflow_ids: ids(w.workflowIds), ...(w.byDay === false ? { p_by_day: false } : {}) })
  if (!r.ok) return r
  const cols = r.value.cols as string[]
  const rows = (r.value.rows as unknown[][]).map((row) => {
    const o = zip(cols, row)
    const out: any = { workflow_id: String(o.workflow_id), day: o.day === null ? '' : String(o.day), last_started_at: iso(o.last_started_at), last_completed_at: iso(o.last_completed_at) }
    for (const c of cols) if (!(c in out)) out[c] = num(o[c])
    return out as RunDayRow
  })
  return { ok: true, value: rows }
}

export interface HistRow { key: string | null; n: number; hist: number[] }

export async function rollupRunHists(db: AnySupabaseClient, tenantId: string, w: RunWindow & { side: 'started' | 'completed'; group: 'workflow' | 'day' | 'all' }): Promise<RollupResult<HistRow[]>> {
  const r = await call(db, 'report_rollup_run_hists', { p_tenant_id: tenantId, p_since: w.since, p_until: w.until ?? null, p_workflow_ids: ids(w.workflowIds), p_side: w.side, p_group: w.group })
  if (!r.ok) return r
  return { ok: true, value: (r.value.rows as unknown[][]).map((row) => ({ key: row[0] === null ? null : String(row[0]), n: num(row[1]), hist: (row[2] as number[]) ?? [] })) }
}

export async function rollupNodeVisits(db: AnySupabaseClient, tenantId: string, w: { workflowIds: readonly string[]; since?: string | null; until?: string | null }): Promise<RollupResult<Array<{ workflow_id: string; node_id: string; visits: number }>>> {
  const r = await call(db, 'report_rollup_node_visits', { p_tenant_id: tenantId, p_workflow_ids: ids(w.workflowIds), p_since: w.since ?? null, p_until: w.until ?? null })
  if (!r.ok) return r
  return { ok: true, value: (r.value.rows as unknown[][]).map((row) => ({ workflow_id: String(row[0]), node_id: String(row[1]), visits: num(row[2]) })) }
}

export async function rollupRunNow(db: AnySupabaseClient, tenantId: string, workflowIds: readonly string[]): Promise<RollupResult<Map<string, { running: number; waiting: number; queued: number }>>> {
  const r = await call(db, 'report_rollup_run_now', { p_tenant_id: tenantId, p_workflow_ids: ids(workflowIds) })
  if (!r.ok) return r
  return { ok: true, value: new Map((r.value.rows as unknown[][]).map((row) => [String(row[0]), { running: num(row[1]), waiting: num(row[2]), queued: num(row[3]) }])) }
}

/** Legacy workflow_run_daily_stats rows (reports hub) from rollup days. */
export function toDailyStats(rows: readonly RunDayRow[]) {
  return rows.filter((r) => r.runs > 0).map((r) => ({
    workflow_id: r.workflow_id,
    day: r.day,
    runs: r.runs,
    active: r.st_running + r.st_waiting_for_event + r.st_paused + r.st_pending,
    errors: r.st_failed,
    completed: r.done_n,
    completed_ms: r.done_ms,
    timed: r.timed_n,
    timed_ms: r.timed_ms,
    node_visits: r.node_visits,
    edge_traversals: r.edge_traversals,
    last_started_at: r.last_started_at,
    last_completed_at: r.last_completed_at,
  }))
}

/** Legacy workflow_run_duration_stats rows (per workflow + overall, workflow_id null). */
export function toDurationStats(rows: readonly RunDayRow[], hists: readonly HistRow[]) {
  type Acc = { runs: number; completed: number; failed: number; active: number; done_n: number; done_ms: number }
  const per = new Map<string, Acc>()
  const total: Acc = { runs: 0, completed: 0, failed: 0, active: 0, done_n: 0, done_ms: 0 }
  for (const r of rows) {
    if (r.runs <= 0) continue
    const a = per.get(r.workflow_id) ?? { runs: 0, completed: 0, failed: 0, active: 0, done_n: 0, done_ms: 0 }
    for (const acc of [a, total]) {
      acc.runs += r.runs
      acc.completed += r.st_completed
      acc.failed += r.st_failed
      acc.active += r.st_running + r.st_waiting_for_event + r.st_paused + r.st_pending
      acc.done_n += r.done_n
      acc.done_ms += r.done_ms
    }
    per.set(r.workflow_id, a)
  }
  const histBy = new Map(hists.map((h) => [h.key, h.hist]))
  const shape = (workflowId: string | null, a: Acc, hist: number[] | undefined) => ({
    workflow_id: workflowId,
    runs: a.runs, completed: a.completed, failed: a.failed, active: a.active,
    avg_ms: a.done_n ? a.done_ms / a.done_n : null,
    p50_ms: histQuantile(hist, 0.5),
    p95_ms: histQuantile(hist, 0.95),
  })
  const out = [...per.entries()].map(([id, a]) => shape(id, a, histBy.get(id)))
  out.push(shape(null, total, mergeHists(...hists.map((h) => h.hist))))
  return out
}

interface RunStatsCounts {
  started: number; completed: number; failed: number; cancelled: number
  avg_ms: number | null; p95_ms: number | null
  running: number; waiting: number; queued: number
  per_day: Array<{ day: string; started: number; completed: number; failed: number; avg_ms: number | null }>
}

/** Legacy workflow_run_stats jsonb (extension pages) from rollup days, histograms and the "now" counts. */
export function toRunStats(workflowIds: readonly string[], rows: readonly RunDayRow[], hists: readonly HistRow[], now: Map<string, { running: number; waiting: number; queued: number }>): { workflows: Array<RunStatsCounts & { workflow_id: string }>; total: RunStatsCounts } {
  type Acc = { started: number; completed: number; failed: number; cancelled: number; done_n: number; done_ms: number; days: Map<string, { started: number; completed: number; failed: number; n: number; ms: number }> }
  const empty = (): Acc => ({ started: 0, completed: 0, failed: 0, cancelled: 0, done_n: 0, done_ms: 0, days: new Map() })
  const wanted = [...new Set(workflowIds)]
  const per = new Map(wanted.map((id) => [id, empty()]))
  const total = empty()
  for (const r of rows) {
    if (r.runs <= 0) continue
    for (const acc of [per.get(r.workflow_id), total]) {
      if (!acc) continue
      acc.started += r.runs
      acc.completed += r.st_completed
      acc.failed += r.st_failed - r.st_cancel_manual
      acc.cancelled += r.st_cancel_manual + r.st_cancelled
      acc.done_n += r.done_n
      acc.done_ms += r.done_ms
      const d = acc.days.get(r.day) ?? { started: 0, completed: 0, failed: 0, n: 0, ms: 0 }
      d.started += r.runs
      d.completed += r.st_completed
      d.failed += r.st_failed + r.st_cancelled
      d.n += r.done_n
      d.ms += r.done_ms
      acc.days.set(r.day, d)
    }
  }
  const histBy = new Map(hists.map((h) => [h.key, h.hist]))
  const round = (v: number | null) => (v === null ? null : Math.round(v))
  const finish = (acc: Acc, hist: number[] | undefined, live: { running: number; waiting: number; queued: number }): RunStatsCounts => ({
    started: acc.started, completed: acc.completed, failed: acc.failed, cancelled: acc.cancelled,
    avg_ms: round(acc.done_n ? acc.done_ms / acc.done_n : null),
    p95_ms: round(histQuantile(hist, 0.95)),
    running: live.running, waiting: live.waiting, queued: live.queued,
    per_day: [...acc.days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, started: d.started, completed: d.completed, failed: d.failed, avg_ms: d.n ? Math.round(d.ms / d.n) : null })),
  })
  const zero = { running: 0, waiting: 0, queued: 0 }
  const liveTotal = { running: 0, waiting: 0, queued: 0 }
  for (const id of wanted) { const l = now.get(id); if (l) { liveTotal.running += l.running; liveTotal.waiting += l.waiting; liveTotal.queued += l.queued } }
  return {
    workflows: wanted.map((id) => ({ workflow_id: id, ...finish(per.get(id)!, histBy.get(id), now.get(id) ?? zero) })),
    total: finish(total, mergeHists(...wanted.map((id) => histBy.get(id))), liveTotal),
  }
}

/** workflow_run_stats from the rollups, or null (caller: the live RPC). */
export async function rollupRunStats(db: AnySupabaseClient, tenantId: string, w: { workflowIds: readonly string[]; since: string; until: string }) {
  const [days, hists, now] = await Promise.all([
    rollupRunDays(db, tenantId, w),
    rollupRunHists(db, tenantId, { ...w, side: 'started', group: 'workflow' }),
    rollupRunNow(db, tenantId, w.workflowIds),
  ])
  if (!days.ok || !hists.ok || !now.ok) return null
  return toRunStats(w.workflowIds, days.value, hists.value, now.value)
}

/* ── Tasks ────────────────────────────────────────────────────────────── */

export interface TaskDayRow {
  day: string
  workflow_id: string | null
  assignee_id: string | null
  cr_total: number; cr_draft: number; cr_todo: number; cr_in_progress: number; cr_blocked: number; cr_completed: number; cr_cancelled: number
  done_n: number; done_on_time: number; done_late: number; done_no_due: number; done_ms: number
}

/** Zero uuid: how the rollup stores "no workflow / team / assignee". */
export const NONE_ID = '00000000-0000-0000-0000-000000000000'

export interface TaskQuery {
  since: string | null
  until?: string | null
  /** Viewer scope: null = every task (tasks.view_all); else theirs and their teams' queues. */
  scope: { userId: string; teams: readonly string[] } | null
  workflowId?: string | null
  assigneeId?: string | null
  /** Teams filter (null = any). */
  teamIds?: readonly string[] | null
}

function taskArgs(tenantId: string, q: TaskQuery) {
  return {
    p_tenant_id: tenantId, p_since: q.since, p_until: q.until ?? null,
    p_workflow_id: q.workflowId ?? null, p_assignee_id: q.assigneeId ?? null, p_team_ids: ids(q.teamIds),
    p_scope_user: q.scope?.userId ?? null, p_scope_teams: q.scope ? ids(q.scope.teams) ?? [] : null,
  }
}

export async function rollupTaskDays(db: AnySupabaseClient, tenantId: string, q: TaskQuery & { byWorkflow?: boolean; byAssignee?: boolean }): Promise<RollupResult<TaskDayRow[]>> {
  const r = await call(db, 'report_rollup_task_days', { ...taskArgs(tenantId, q), p_by_workflow: !!q.byWorkflow, p_by_assignee: !!q.byAssignee })
  if (!r.ok) return r
  const cols = r.value.cols as string[]
  const nullable = (v: unknown) => (v === null || v === undefined || v === NONE_ID ? null : String(v))
  return {
    ok: true,
    value: (r.value.rows as unknown[][]).map((row) => {
      const o = zip(cols, row)
      const out: any = { day: String(o.day), workflow_id: nullable(o.workflow_id), assignee_id: nullable(o.assignee_id) }
      for (const c of cols) if (!(c in out)) out[c] = num(o[c])
      return out as TaskDayRow
    }),
  }
}

export async function rollupTaskHists(db: AnySupabaseClient, tenantId: string, q: TaskQuery & { group: 'day' | 'all' }): Promise<RollupResult<HistRow[]>> {
  const r = await call(db, 'report_rollup_task_hists', { ...taskArgs(tenantId, q), p_group: q.group })
  if (!r.ok) return r
  return { ok: true, value: (r.value.rows as unknown[][]).map((row) => ({ key: row[0] === null ? null : String(row[0]), n: num(row[1]), hist: (row[2] as number[]) ?? [] })) }
}

/* ── Submissions ──────────────────────────────────────────────────────── */

export async function rollupSubmissionDays(db: AnySupabaseClient, tenantId: string, w: { since: string | null; until?: string | null; formIds?: readonly string[] | null }): Promise<RollupResult<Array<{ form_id: string; day: string; n: number }>>> {
  const r = await call(db, 'report_rollup_submission_days', { p_tenant_id: tenantId, p_since: w.since, p_until: w.until ?? null, p_form_ids: ids(w.formIds) })
  if (!r.ok) return r
  return { ok: true, value: (r.value.rows as unknown[][]).map((row) => ({ form_id: String(row[0]), day: String(row[1]), n: num(row[2]) })) }
}

/** form_submission_stats from the rollups (+ the newest submission per form), or null. */
export async function rollupSubmissionStats(db: AnySupabaseClient, tenantId: string, w: { formIds: readonly string[]; since: string; until: string }) {
  const [days, last] = await Promise.all([
    rollupSubmissionDays(db, tenantId, w),
    call(db, 'report_rollup_form_last', { p_tenant_id: tenantId, p_form_ids: ids(w.formIds) }),
  ])
  if (!days.ok || !last.ok) return null
  const lastBy = new Map((last.value.rows as unknown[][]).map((row) => [String(row[0]), iso(row[1])]))
  return [...new Set(w.formIds)].map((id) => {
    const perDay = days.value.filter((d) => d.form_id === id).map((d) => ({ day: d.day, count: d.n }))
    return { form_id: id, total: perDay.reduce((a, d) => a + d.count, 0), last_at: lastBy.get(id) ?? null, per_day: perDay }
  })
}

/* ── Status ───────────────────────────────────────────────────────────── */

export interface RollupStatus {
  installed: boolean
  tenants: number
  backfilled: number
  in_progress: number
  not_started: number
  dirty_ranges: number
  oldest_dirty_at: string | null
  last_refresh_at: string | null
  oldest_reconciled_at: string | null
  newest_delta_at: string | null
  rows: { runs: number; nodes: number; tasks: number; submissions: number }
  tenants_detail: Array<{ tenant_id: string; name: string; covered_from: string | null; oldest_day: string | null; done: boolean; days_rebuilt: number; started_at: string | null; completed_at: string | null; last_refresh_at: string | null; last_reconciled_at: string | null }>
}

/** Instance-wide rollup status (service-role client). null when the migration isn't applied. */
export async function rollupStatus(serviceDb: AnySupabaseClient): Promise<RollupStatus | null> {
  const { data, error } = await (serviceDb as any).rpc('report_rollup_status')
  if (error) {
    if (MISSING.has(String(error.code ?? ''))) return null
    throw new Error(error.message)
  }
  return data as RollupStatus
}

/* ── Mode gate (Settings → Query) ─────────────────────────────────────── */

export interface TenantFreshness {
  installed: boolean
  covered_from: string | null
  oldest_day: string | null
  done: boolean
  started: boolean
  days_rebuilt: number
  last_refresh_at: string | null
  last_reconciled_at: string | null
  dirty_ranges: number
  newest_delta_at: string | null
}

const freshCache = new Map<string, { at: number; value: TenantFreshness | null }>()

/** One workspace's rollup coverage and queue (cached 30 s per process); null when not installed / unreadable. */
export async function rollupTenantFreshness(db: AnySupabaseClient, tenantId: string, opts: { fresh?: boolean } = {}): Promise<TenantFreshness | null> {
  const hit = freshCache.get(tenantId)
  if (!opts.fresh && hit && hit.at > Date.now() - 30_000) return hit.value
  let value: TenantFreshness | null = null
  try {
    const { data, error } = await (db as any).rpc('report_rollup_tenant_freshness', { p_tenant_id: tenantId })
    if (!error && data) value = { ...(data as TenantFreshness), dirty_ranges: num((data as any).dirty_ranges), days_rebuilt: num((data as any).days_rebuilt) }
  } catch { /* not installed */ }
  freshCache.set(tenantId, { at: Date.now(), value })
  if (freshCache.size > 1000) freshCache.delete(freshCache.keys().next().value as string)
  return value
}

/**
 * Whether a read in `mode` may try the rollups: never in 'live'; always in
 * 'rollup' (the read functions still fall back when the window isn't
 * covered); in 'auto' only when nothing is queued for the workspace
 * (queued rebuilds mean deferred work: the rollups may lag).
 */
export async function rollupsAllowed(db: AnySupabaseClient, tenantId: string, mode: 'auto' | 'rollup' | 'live'): Promise<boolean> {
  if (mode === 'live' || !rollupsEnabled()) return false
  if (mode === 'rollup') return true
  const f = await rollupTenantFreshness(db, tenantId)
  return !f || f.dirty_ranges === 0
}
