/**
 * App widget aggregates from the report rollups (lib/services/report-rollups.ts).
 *
 * Metric / KPI / goal / gauge / chart / pivot / throughput / submission
 * trend widgets aggregate "facts" (lib/services/app-widgets.ts facts()):
 * today they read up to AGGREGATE_ROW_CAP raw rows and count them in memory.
 * When the widget only groups by dimensions the rollups keep, the facts come
 * from the rollups instead — one weighted fact per (UTC day, status,
 * workflow / form / assignee) with its count in `n` — so the numbers are
 * complete (no row cap) and the read is a handful of rollup rows. Cycle
 * time, SLA trend and throughput's completed side read the completed-day
 * counters and histograms (cycle time median / p90 within 9.1%).
 *
 * Rollups are used only when they can reproduce the viewer's access
 * exactly, else null and the caller reads rows as before:
 *  - runs: workflows.view_runs (every run), or view_queue with only granted
 *    workflows in scope (filtered to those workflow ids BEFORE summing). A
 *    scope that includes runs the person is merely involved in (started,
 *    submitted, assigned) is per run, not per workflow → live. Neither
 *    permission (own runs only) → live. A person filter (started_by) → live.
 *  - tasks: tasks.view_all, or the viewer's own and their teams' queues —
 *    the rollup is keyed by assignee and team, so the same filter applies.
 *  - submissions: forms.edit (all); own-only viewers → live. A person
 *    filter or grouping by outcome → live.
 * Results are cached briefly per tenant + scope + query (lib/report-rollups/cache.ts).
 */

import { hasPerm, getDb, type ServiceContext } from './context'
import { resolveRunScope } from './run-visibility'
import { rollupRunDays, rollupRunHists, rollupSubmissionDays, rollupTaskDays, rollupTaskHists, type TaskQuery } from './report-rollups'
import { cachedAggregate } from '@/lib/report-rollups/cache'
import { mergeHists } from '@/lib/report-rollups/hist'
import type { DataSource } from '@/lib/apps/schema'
import type { ResolvedRange } from '@/lib/apps/widgets'
import { asId, me, taskScope, type Common, type Fact } from './app-widgets'
import { recordQueryTiming, resolveDataSource, type ResolvedDataSource } from '@/lib/reports/data-source'
import { rollupsAllowed } from './report-rollups'
import './query-settings-loader'

/* eslint-disable @typescript-eslint/no-explicit-any -- widget configs */

export type FactDim = 'time' | 'status' | 'workflow' | 'form' | 'assignee'

/** The Settings → Query data source of a widget read, carried on its context. */
const widgetSources = new WeakMap<object, ResolvedDataSource>()

/** A copy of ctx that carries the widget's resolved data source. */
export function withWidgetDataSource<T extends ServiceContext>(ctx: T, ds: ResolvedDataSource): T {
  const copy = { ...ctx }
  widgetSources.set(copy, ds)
  return copy
}

async function dataSourceOf(ctx: ServiceContext): Promise<ResolvedDataSource> {
  return widgetSources.get(ctx) ?? resolveDataSource(ctx, { service: 'app_widgets' })
}

/** May this widget read try the rollups (mode + workspace freshness)? */
async function allowed(ctx: ServiceContext): Promise<ResolvedDataSource | null> {
  const ds = await dataSourceOf(ctx)
  return (await rollupsAllowed(getDb(ctx), ctx.tenantId, ds.mode)) ? ds : null
}

/** Record the rollup read time (Settings → Query timings) and pass the value through. */
async function timed<T>(ctx: ServiceContext, ds: ResolvedDataSource, fn: () => Promise<T | null>): Promise<T | null> {
  const t0 = performance.now()
  const value = await fn()
  if (value !== null) recordQueryTiming(ctx.tenantId, ds.service, 'rollup', performance.now() - t0)
  return value
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RUN_DIMS: ReadonlySet<string> = new Set(['time', 'status', 'workflow'])
const TASK_DIMS: ReadonlySet<string> = new Set(['time', 'status', 'workflow', 'assignee'])
const SUBMISSION_DIMS: ReadonlySet<string> = new Set(['time', 'form'])

const RUN_STATUS_COLS: Array<[string, string]> = [
  ['completed', 'st_completed'], ['failed', 'st_failed'], ['cancelled', 'st_cancelled'], ['running', 'st_running'],
  ['waiting_for_event', 'st_waiting_for_event'], ['paused', 'st_paused'], ['pending', 'st_pending'], ['waiting', 'st_waiting'],
]
const RUN_OPEN = new Set(['running', 'waiting_for_event', 'paused', 'pending'])
const TASK_STATUS_COLS: Array<[string, string]> = [
  ['draft', 'cr_draft'], ['todo', 'cr_todo'], ['in_progress', 'cr_in_progress'], ['blocked', 'cr_blocked'], ['completed', 'cr_completed'], ['cancelled', 'cr_cancelled'],
]
const TASK_OPEN = new Set(['todo', 'in_progress', 'blocked'])

const dayStart = (day: string) => `${day}T00:00:00.000Z`
const iso = (d: Date | null) => (d ? d.toISOString() : null)

/** Run scope as rollup filter: null (every workflow), workflow ids, or 'live' (can't be reproduced). */
export async function runRollupScope(ctx: ServiceContext): Promise<{ workflowIds: string[] | null } | 'live'> {
  if (hasPerm(ctx, 'workflows.view_runs')) return { workflowIds: null }
  if (!hasPerm(ctx, 'workflows.view_queue')) return 'live'
  const scope = await resolveRunScope(ctx)
  if (scope.kind === 'all') return { workflowIds: null }
  if (scope.runIds.length) return 'live'
  return { workflowIds: scope.workflowIds.filter((id) => UUID_RE.test(id)) }
}

/** Intersect the scope with the widget's workflow filter (empty = nothing visible). */
function workflowFilter(scopeIds: string[] | null, configWorkflow: unknown): string[] | null {
  const wanted = asId(configWorkflow)
  if (!wanted) return scopeIds
  if (scopeIds && !scopeIds.includes(wanted)) return []
  return [wanted]
}

function runScopeKey(ids: string[] | null) {
  return ids ? `runs:wf:${[...ids].sort().join(',')}` : 'runs:all'
}

/** The widget's task filters + the viewer's task scope as a rollup query; null = nothing matches. */
async function taskRollupQuery(ctx: ServiceContext, config: Common & { scope?: string }, range: ResolvedRange): Promise<{ q: TaskQuery; scopeKey: string } | 'none'> {
  const db = getDb(ctx)
  const scope = await taskScope(ctx, db)
  const listScope = config.scope ?? 'all'
  let assignee: string | null = null
  if (listScope === 'mine') assignee = scope.userId
  const configured = config.assignee === 'me' ? scope.userId : asId(config.assignee)
  if (configured) {
    if (assignee && assignee !== configured) return 'none'
    assignee = configured
  }
  let teamIds: string[] | null = null
  if (listScope === 'team' || config.team) {
    teamIds = config.team === 'my_teams' || (!config.team && listScope === 'team') ? [...scope.teams] : [asId(config.team)].filter((t): t is string => !!t)
    if (!teamIds.length) return 'none'
  }
  const q: TaskQuery = {
    since: iso(range.from), until: iso(range.to),
    scope: scope.all ? null : { userId: scope.userId, teams: scope.teams },
    workflowId: asId(config.workflow_id), assigneeId: assignee, teamIds,
  }
  return { q, scopeKey: scope.all ? 'tasks:all' : `tasks:u:${scope.userId}:t:${[...scope.teams].sort().join(',')}` }
}

/**
 * Facts for a metric / chart from the rollups, or null (use rows). `dims`:
 * the dimensions the caller groups by (time is always available).
 */
export async function rollupFacts(ctx: ServiceContext, source: DataSource, config: Common & { scope?: string; person?: unknown }, range: ResolvedRange, dims: readonly string[]): Promise<{ rows: Fact[]; truncated: boolean } | null> {
  if (source !== 'runs' && source !== 'tasks' && source !== 'submissions') return null
  const ds = await allowed(ctx)
  if (!ds) return null
  return timed(ctx, ds, () => rollupFactsFor(ctx, ds, source, config, range, dims))
}

async function rollupFactsFor(ctx: ServiceContext, ds: ResolvedDataSource, source: DataSource, config: Common & { scope?: string; person?: unknown }, range: ResolvedRange, dims: readonly string[]): Promise<{ rows: Fact[]; truncated: boolean } | null> {
  if (source === 'runs') {
    if (dims.some((d) => !RUN_DIMS.has(d))) return null
    if (config.person || config.assignee) return null
    me(ctx)
    const scope = await runRollupScope(ctx)
    if (scope === 'live') return null
    const workflowIds = workflowFilter(scope.workflowIds, config.workflow_id)
    if (workflowIds && !workflowIds.length) return { rows: [], truncated: false }
    const status = typeof config.status === 'string' ? config.status : 'all'
    const query = { since: iso(range.from), until: iso(range.to), workflowIds }
    const rows = await cachedAggregate(ctx.tenantId, `${runScopeKey(scope.workflowIds)}:${ds.mode}`, ['widget.runDays', query], async () => {
      const r = await rollupRunDays(getDb(ctx), ctx.tenantId, query)
      return r.ok ? r.value : null
    }, ds.cacheTtlMs)
    if (!rows) return null
    const facts: Fact[] = []
    for (const r of rows) {
      if (r.runs <= 0) continue
      let known = 0
      for (const [label, col] of RUN_STATUS_COLS) {
        const n = Number((r as any)[col]) || 0
        known += n
        if (!n) continue
        if (status === 'open' && !RUN_OPEN.has(label)) continue
        if (status === 'completed' && label !== 'completed') continue
        facts.push({ at: dayStart(r.day), status: label, workflow: r.workflow_id, form: null, person: null, data: null, n })
      }
      const other = r.runs - known
      if (other > 0 && status === 'all') facts.push({ at: dayStart(r.day), status: 'other', workflow: r.workflow_id, form: null, person: null, data: null, n: other })
    }
    return { rows: facts, truncated: false }
  }

  if (source === 'tasks') {
    if (dims.some((d) => !TASK_DIMS.has(d))) return null
    const built = await taskRollupQuery(ctx, config, range)
    if (built === 'none') return { rows: [], truncated: false }
    const status = typeof config.status === 'string' ? config.status : 'all'
    const args = { ...built.q, byWorkflow: dims.includes('workflow'), byAssignee: dims.includes('assignee') }
    const rows = await cachedAggregate(ctx.tenantId, `${built.scopeKey}:${ds.mode}`, ['widget.taskDays', args], async () => {
      const r = await rollupTaskDays(getDb(ctx), ctx.tenantId, args)
      return r.ok ? r.value : null
    }, ds.cacheTtlMs)
    if (!rows) return null
    const facts: Fact[] = []
    for (const r of rows) {
      for (const [label, col] of TASK_STATUS_COLS) {
        const n = Number((r as any)[col]) || 0
        if (!n) continue
        if (status === 'open' && !TASK_OPEN.has(label)) continue
        if (status === 'completed' && label !== 'completed') continue
        facts.push({ at: dayStart(r.day), status: label, workflow: r.workflow_id, form: null, person: r.assignee_id, data: null, n })
      }
    }
    return { rows: facts, truncated: false }
  }

  if (source === 'submissions') {
    if (dims.some((d) => !SUBMISSION_DIMS.has(d))) return null
    if (config.person || config.assignee) return null
    me(ctx)
    if (!hasPerm(ctx, 'forms.edit')) return null
    const form = asId(config.form_id)
    const query = { since: iso(range.from), until: iso(range.to), formIds: form ? [form] : null }
    const rows = await cachedAggregate(ctx.tenantId, `${'subs:all'}:${ds.mode}`, ['widget.submissionDays', query], async () => {
      const r = await rollupSubmissionDays(getDb(ctx), ctx.tenantId, query)
      return r.ok ? r.value : null
    }, ds.cacheTtlMs)
    if (!rows) return null
    return { rows: rows.map((r) => ({ at: dayStart(r.day), status: null, workflow: null, form: r.form_id, person: null, data: null, n: r.n })), truncated: false }
  }

  return null
}

export interface FinishedDay { day: string; n: number; onTime: number; late: number; hist: number[] }

/**
 * Items finished in the widget's range per UTC completion day (tasks:
 * completed tasks against due_date; runs: completed runs against
 * sla_due_at), with time-to-finish histograms; null = read rows. On time
 * counts items without a due date, as the row path's onTime().
 */
export async function rollupFinished(ctx: ServiceContext, c: Common & { source?: string; scope?: string; person?: unknown }, range: ResolvedRange, withHist: boolean): Promise<FinishedDay[] | null> {
  const ds = await allowed(ctx)
  if (!ds) return null
  return timed(ctx, ds, () => rollupFinishedFor(ctx, ds, c, range, withHist))
}

async function rollupFinishedFor(ctx: ServiceContext, ds: ResolvedDataSource, c: Common & { source?: string; scope?: string; person?: unknown }, range: ResolvedRange, withHist: boolean): Promise<FinishedDay[] | null> {
  if (c.source === 'runs') {
    if (c.person || c.assignee) return null
    me(ctx)
    const scope = await runRollupScope(ctx)
    if (scope === 'live') return null
    const workflowIds = workflowFilter(scope.workflowIds, c.workflow_id)
    if (workflowIds && !workflowIds.length) return []
    const query = { since: iso(range.from), until: iso(range.to), workflowIds }
    return cachedAggregate(ctx.tenantId, `${runScopeKey(scope.workflowIds)}:${ds.mode}`, ['widget.runFinished', query, withHist], async () => {
      const db = getDb(ctx)
      const [days, hists] = await Promise.all([
        rollupRunDays(db, ctx.tenantId, query),
        withHist ? rollupRunHists(db, ctx.tenantId, { ...query, side: 'completed', group: 'day' }) : Promise.resolve({ ok: true as const, value: [] }),
      ])
      if (!days.ok || !hists.ok) return null
      const histBy = new Map(hists.value.map((h) => [h.key, h.hist]))
      const by = new Map<string, FinishedDay>()
      for (const r of days.value) {
        if (r.fin_n <= 0) continue
        const d = by.get(r.day) ?? { day: r.day, n: 0, onTime: 0, late: 0, hist: histBy.get(r.day) ?? [] }
        d.n += r.fin_n
        d.onTime += r.fin_on_time + r.fin_no_due
        d.late += r.fin_late
        by.set(r.day, d)
      }
      return [...by.values()].sort((a, b) => a.day.localeCompare(b.day))
    }, ds.cacheTtlMs)
  }
  const built = await taskRollupQuery(ctx, { ...c, status: 'completed' }, range)
  if (built === 'none') return []
  return cachedAggregate(ctx.tenantId, `${built.scopeKey}:${ds.mode}`, ['widget.taskFinished', built.q, withHist], async () => {
    const db = getDb(ctx)
    const [days, hists] = await Promise.all([
      rollupTaskDays(db, ctx.tenantId, built.q),
      withHist ? rollupTaskHists(db, ctx.tenantId, { ...built.q, group: 'day' }) : Promise.resolve({ ok: true as const, value: [] }),
    ])
    if (!days.ok || !hists.ok) return null
    const histBy = new Map(hists.value.map((h) => [h.key, h.hist]))
    return days.value.filter((r) => r.done_n > 0).map((r) => ({
      day: r.day, n: r.done_n, onTime: r.done_on_time + r.done_no_due, late: r.done_late, hist: histBy.get(r.day) ?? [],
    }))
  }, ds.cacheTtlMs)
}

/** Merge the histograms of the days whose key (via `keyOf`) is `key`. */
export function histFor(days: readonly FinishedDay[], keyOf: (day: string) => string, key?: string): number[] {
  return mergeHists(...days.filter((d) => key === undefined || keyOf(d.day) === key).map((d) => d.hist))
}
