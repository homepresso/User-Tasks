/**
 * Workflow report analytics: wrappers over the SQL aggregates the reports
 * views called from the browser (supabase/migrations/20261028000000_perf_api_reports.sql).
 * The functions are SECURITY INVOKER, so they run as the session user and
 * RLS scopes the runs; reports.view is required on top, as for the pages.
 */

import { getDb, requirePerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'

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

/** Per workflow × UTC day run aggregates since `since` (reports hub). */
export async function runDailyStats(ctx: ServiceContext, input: { since: string; workflowIds?: string[] | null }) {
  requirePerm(ctx, 'reports.view')
  const ids = workflowIds(input.workflowIds, false)
  return call<RunDailyStat>(ctx, 'workflow_run_daily_stats', { p_since: since(input.since), ...(ids ? { p_workflow_ids: ids } : {}) })
}

/** Status counts and avg/p50/p95 completed durations since `since`. */
export async function runDurationStats(ctx: ServiceContext, input: { since: string; workflowIds?: string[] | null }) {
  requirePerm(ctx, 'reports.view')
  const ids = workflowIds(input.workflowIds, false)
  return call<RunDurationStat>(ctx, 'workflow_run_duration_stats', { p_since: since(input.since), ...(ids ? { p_workflow_ids: ids } : {}) })
}

/** Run rows without traces (newest first) for the given workflows. */
export async function runSummaries(ctx: ServiceContext, input: { workflowIds: string[]; since?: string | null; limit?: number }) {
  requirePerm(ctx, 'reports.view')
  const sinceValue = optionalSince(input.since)
  return call<Record<string, any>>(ctx, 'workflow_run_summaries', {
    p_workflow_ids: workflowIds(input.workflowIds, true), ...(sinceValue ? { p_since: sinceValue } : {}), p_limit: runLimit(input.limit, 2000),
  })
}

/** Per-node visit counts over the same newest runs. */
export async function nodeVisitStats(ctx: ServiceContext, input: { workflowIds: string[]; since?: string | null; limit?: number }) {
  requirePerm(ctx, 'reports.view')
  const sinceValue = optionalSince(input.since)
  return call<NodeVisitStat>(ctx, 'workflow_node_visit_stats', {
    p_workflow_ids: workflowIds(input.workflowIds, true), ...(sinceValue ? { p_since: sinceValue } : {}), p_limit: runLimit(input.limit, 5000),
  })
}
