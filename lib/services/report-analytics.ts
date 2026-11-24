/**
 * Workflow report analytics: wrappers over the SQL aggregates the reports
 * views called from the browser (supabase/migrations/20261028000000_perf_api_reports.sql).
 * The functions are SECURITY INVOKER, so they run as the session user and
 * RLS scopes the runs; workflows.view_runs is required on top (workspace-wide run analytics; governance audit 2026-11).
 *
 * Daily stats, duration stats and node visits read the report rollups
 * (lib/services/report-rollups.ts, migration 20270123100000) when they can
 * answer — same output shapes; p50 / p95 from histograms (within 9.1%) — and
 * the live RPCs above otherwise (migration not applied, tenant not
 * backfilled yet, REPORT_ROLLUPS=off). view_runs sees every run of the
 * workspace, so the rollups are read for the whole workspace (ctx.tenantId)
 * with no further per-workflow scoping; results are cached briefly per
 * tenant + query (lib/report-rollups/cache.ts).
 */

import { getDb, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
import { rollupNodeVisits, rollupRunDays, rollupRunHists, rollupsAllowed, toDailyStats, toDurationStats } from './report-rollups'
import { cachedAggregate } from '@/lib/report-rollups/cache'
import { readWithDataSource, resolveDataSource } from '@/lib/reports/data-source'
import './query-settings-loader'

/* eslint-disable @typescript-eslint/no-explicit-any -- rpc rows */

/** One workflow × UTC day bucket from workflow_run_daily_stats. */
export interface RunDailyStat {
  workflow_id: string
  /** YYYY-MM-DD (UTC). */
  day: string
  runs: number
  active: number
  errors: number
  completed: number
  completed_ms: number
  /** Runs with completed_at after started_at, and their total duration. */
  timed: number
  timed_ms: number
  node_visits: number
  edge_traversals: number
  last_started_at: string | null
  last_completed_at: string | null
}

/** workflow_run_duration_stats row; workflow_id null = all workflows. */
export interface RunDurationStat {
  workflow_id: string | null
  runs: number
  completed: number
  failed: number
  active: number
  avg_ms: number | null
  p50_ms: number | null
  p95_ms: number | null
}

export interface NodeVisitStat { workflow_id: string; node_id: string; visits: number }

const MAX_WORKFLOWS = 200
const MAX_RUNS = 5000

function since(value: unknown, field = 'since'): string {
  const date = new Date(String(value ?? ''))
  if (Number.isNaN(date.getTime())) throw ServiceError.validation(`${field} must be a date/time`)
  return date.toISOString()
}

function optionalSince(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : since(value)
}

function workflowIds(ids: unknown, required: boolean): string[] | undefined {
  if (ids === undefined || ids === null) {
    if (required) throw ServiceError.validation('workflowIds is required')
    return undefined
  }
  if (!Array.isArray(ids) || ids.length > MAX_WORKFLOWS) throw ServiceError.validation(`workflowIds must be an array of at most ${MAX_WORKFLOWS} ids`)
  return ids.map((id) => String(id))
}

function runLimit(value: unknown, fallback: number): number {
  const n = Math.trunc(Number(value ?? fallback))
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), MAX_RUNS) : fallback
}

async function call<T>(ctx: ServiceContext, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await (getDb(ctx) as any).rpc(fn, args)
  if (error) throw dbError(error)
  return (data ?? []) as T[]
}

/** Scope of every read here: workflows.view_runs = every run of the workspace. */
const RUNS_SCOPE = 'runs:view_runs:all'

/** Settings → Query service of a read: the API / MCP endpoints, or the reports pages. */
const serviceOf = (ctx: ServiceContext) => (ctx.source === 'api' || ctx.source === 'mcp' ? 'api_reports' as const : 'reports_hub' as const)

/** Per workflow × UTC day run aggregates since `since` (reports hub). */
export async function runDailyStats(ctx: ServiceContext, input: { since: string; workflowIds?: string[] | null }) {
  requirePerm(ctx, 'workflows.view_runs')
  const ids = workflowIds(input.workflowIds, false)
  const sinceValue = since(input.since)
  const ds = await resolveDataSource(ctx, { service: serviceOf(ctx) })
  const db = getDb(ctx)
  return cachedAggregate(ctx.tenantId, `${RUNS_SCOPE}:${ds.mode}`, ['runDailyStats', sinceValue, ids ? [...ids].sort() : null], () => readWithDataSource(ctx, ds,
    async () => {
      if (!(await rollupsAllowed(db, ctx.tenantId, ds.mode))) return null
      const rolled = await rollupRunDays(db, ctx.tenantId, { since: sinceValue, workflowIds: ids })
      return rolled.ok ? toDailyStats(rolled.value) as RunDailyStat[] : null
    },
    () => call<RunDailyStat>(ctx, 'workflow_run_daily_stats', { p_since: sinceValue, ...(ids ? { p_workflow_ids: ids } : {}) }),
  ), ds.cacheTtlMs)
}

/** Status counts and avg/p50/p95 completed durations since `since`. */
export async function runDurationStats(ctx: ServiceContext, input: { since: string; workflowIds?: string[] | null }) {
  requirePerm(ctx, 'workflows.view_runs')
  const ids = workflowIds(input.workflowIds, false)
  const sinceValue = since(input.since)
  const ds = await resolveDataSource(ctx, { service: serviceOf(ctx) })
  const db = getDb(ctx)
  return cachedAggregate(ctx.tenantId, `${RUNS_SCOPE}:${ds.mode}`, ['runDurationStats', sinceValue, ids ? [...ids].sort() : null], () => readWithDataSource(ctx, ds,
    async () => {
      if (!(await rollupsAllowed(db, ctx.tenantId, ds.mode))) return null
      const [days, hists] = await Promise.all([
        rollupRunDays(db, ctx.tenantId, { since: sinceValue, workflowIds: ids, byDay: false }),
        rollupRunHists(db, ctx.tenantId, { since: sinceValue, workflowIds: ids, side: 'started', group: 'workflow' }),
      ])
      return days.ok && hists.ok ? toDurationStats(days.value, hists.value) as RunDurationStat[] : null
    },
    () => call<RunDurationStat>(ctx, 'workflow_run_duration_stats', { p_since: sinceValue, ...(ids ? { p_workflow_ids: ids } : {}) }),
  ), ds.cacheTtlMs)
}

/** Run rows without traces (newest first) for the given workflows. */
export async function runSummaries(ctx: ServiceContext, input: { workflowIds: string[]; since?: string | null; limit?: number }) {
  requirePerm(ctx, 'workflows.view_runs')
  const sinceValue = optionalSince(input.since)
  return call<Record<string, any>>(ctx, 'workflow_run_summaries', {
    p_workflow_ids: workflowIds(input.workflowIds, true), ...(sinceValue ? { p_since: sinceValue } : {}), p_limit: runLimit(input.limit, 2000),
  })
}

/**
 * Per-node visit counts. Live path: over the newest `limit` runs. Rollups:
 * over every run started in the period (since NULL: all time) — the same
 * numbers whenever the period holds at most `limit` runs, and complete
 * instead of truncated when it holds more.
 */
export async function nodeVisitStats(ctx: ServiceContext, input: { workflowIds: string[]; since?: string | null; limit?: number }) {
  requirePerm(ctx, 'workflows.view_runs')
  const sinceValue = optionalSince(input.since)
  const ids = workflowIds(input.workflowIds, true)!
  const limit = runLimit(input.limit, 5000)
  const ds = await resolveDataSource(ctx, { service: serviceOf(ctx) })
  const db = getDb(ctx)
  return cachedAggregate(ctx.tenantId, `${RUNS_SCOPE}:${ds.mode}`, ['nodeVisitStats', sinceValue ?? null, [...ids].sort(), limit], () => readWithDataSource(ctx, ds,
    async () => {
      if (!(await rollupsAllowed(db, ctx.tenantId, ds.mode))) return null
      const rolled = await rollupNodeVisits(db, ctx.tenantId, { workflowIds: ids, since: sinceValue ?? null })
      return rolled.ok ? rolled.value as NodeVisitStat[] : null
    },
    () => call<NodeVisitStat>(ctx, 'workflow_node_visit_stats', { p_workflow_ids: ids, ...(sinceValue ? { p_since: sinceValue } : {}), p_limit: limit }),
  ), ds.cacheTtlMs)
}
