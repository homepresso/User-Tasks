/**
 * The workflow queue page's read: one page of queue items for a view and
 * filters, filtered, sorted and paged in the database
 * (public.workflow_queue_list, migration 20270101000000), with view counts,
 * status totals for the stat cards and — on request — the advanced filter
 * pickers' options.
 *
 * Visibility tiers (lib/services/run-visibility) are passed to the RPC as the
 * scope: everything with workflows.view_runs; otherwise granted workflows,
 * involved runs and jobs the person queued.
 *
 * Before the migration is applied the read falls back to the previous
 * behaviour (the newest 200 jobs and middleware runs) and filters those with
 * the TypeScript mirror of the rules (lib/automations/queue-filters);
 * `partial: true` tells the page.
 */

import { getDb, type ServiceContext } from './context'
import { dbError } from './_shared'
import { applyScope, queueScopeFilter, resolveRunScope, runScopeFilter, type RunScope } from './run-visibility'
import {
  effectiveQueueStatus, matchesQueueFilters, sortQueueItems, toRpcFilters, viewCountsOf,
  type QueueFacets, type QueueItem, type QueuePerson, type QueueReadFilters, type QueueSortDir, type QueueSortField, type QueueViewCounts,
} from '@/lib/automations/queue-filters'

export type { QueueFacets }

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped RPC / rows */

export interface QueueListArgs extends QueueReadFilters {
  sort?: QueueSortField
  dir?: QueueSortDir
  page?: number
  pageSize?: number
}

export interface QueueListPage {
  rows: QueueItem[]
  total: number
  page: number
  pageSize: number
  viewCounts: QueueViewCounts
  /** Items per effective status over everything the person can see (stat cards). */
  statusCounts: Record<string, number>
  /** True when only the newest items could be searched (migration not applied yet). */
  partial: boolean
}

const MISSING_FUNCTION = new Set(['PGRST202', '42883'])
const LEGACY_LIMIT = 200

function rpcScope(scope: RunScope): Record<string, unknown> | null {
  if (scope.kind === 'all') return null
  return { workflow_ids: scope.workflowIds, run_ids: scope.runIds, user_id: scope.userId }
}

async function callList(ctx: ServiceContext, scope: RunScope, filters: Record<string, unknown>, args: { sort: string; dir: string; limit: number; offset: number }) {
  const { data, error } = await (getDb(ctx) as any).rpc('workflow_queue_list', {
    p_tenant_id: ctx.tenantId ?? null,
    p_filters: filters,
    p_scope: rpcScope(scope),
    p_sort: args.sort,
    p_dir: args.dir,
    p_limit: args.limit,
    p_offset: args.offset,
  })
  if (error) {
    if (MISSING_FUNCTION.has(String(error.code))) return null
    throw dbError(error)
  }
  return data as any
}

export async function listQueuePage(ctx: ServiceContext, args: QueueListArgs): Promise<QueueListPage> {
  const scope = await resolveRunScope(ctx)
  const page = Math.max(1, Math.floor(args.page ?? 1))
  const pageSize = Math.min(100, Math.max(1, Math.floor(args.pageSize ?? 25)))
  const sort = args.sort ?? 'created_at'
  const dir = args.dir ?? 'desc'
  const data = await callList(ctx, scope, toRpcFilters(args), { sort, dir, limit: pageSize, offset: (page - 1) * pageSize })
  if (data) {
    return {
      rows: (data.rows ?? []) as QueueItem[],
      total: Number(data.total ?? 0),
      page,
      pageSize,
      viewCounts: { active: 0, attention: 0, completed: 0, all: 0, ...(data.view_counts ?? {}) },
      statusCounts: data.status_counts ?? {},
      partial: false,
    }
  }
  // Fallback: the newest items, filtered here.
  const items = await legacyQueueItems(ctx, scope)
  const matching = sortQueueItems(items.filter((item) => matchesQueueFilters(item, args)), sort, dir)
  const statusCounts: Record<string, number> = {}
  for (const item of items) statusCounts[item.effective_status] = (statusCounts[item.effective_status] ?? 0) + 1
  return {
    rows: matching.slice((page - 1) * pageSize, page * pageSize),
    total: matching.length,
    page,
    pageSize,
    viewCounts: viewCountsOf(items, args),
    statusCounts,
    partial: items.length >= LEGACY_LIMIT,
  }
}

export async function queueFacets(ctx: ServiceContext): Promise<QueueFacets> {
  const scope = await resolveRunScope(ctx)
  const data = await callList(ctx, scope, toRpcFilters({ view: 'all' }, true), { sort: 'created_at', dir: 'desc', limit: 0, offset: 0 })
  if (data?.facets) {
    return {
      workflows: data.facets.workflows ?? [],
      versions: data.facets.versions ?? [],
      starters: data.facets.starters ?? [],
      assignees: data.facets.assignees ?? [],
    }
  }
  const items = await legacyQueueItems(ctx, scope)
  const workflows = new Map<string, string>()
  const starters = new Map<string, QueuePerson>()
  for (const item of items) {
    workflows.set(item.workflow_id, item.workflow?.name ?? 'Unknown')
    if (item.started_by) starters.set(item.started_by.id, item.started_by)
  }
  return {
    workflows: [...workflows].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    versions: [],
    starters: [...starters.values()],
    assignees: [],
  }
}

/**
 * The previous read: the newest 200 jobs (matched to their runs) and
 * middleware runs without a job, shaped as queue items.
 */
export async function legacyQueueItems(ctx: ServiceContext, scope: RunScope): Promise<QueueItem[]> {
  const db = getDb(ctx) as any
  const jobScope = queueScopeFilter(scope)
  const runScope = runScopeFilter(scope)
  const [jobsResult, middlewareRunsResult] = await Promise.all([
    applyScope(db.from('workflow_queue')
      .select('*, workflow:workflows!workflow_queue_workflow_id_fkey(id, name, trigger_type)'), jobScope)
      .order('created_at', { ascending: false })
      .limit(LEGACY_LIMIT),
    applyScope(db.from('workflow_runs')
      .select('id, workflow_id, version_id, status, event_id, paused_node_id, started_at, completed_at, error, title, sla_label, sla_due_at, sla_warning_at, sla_status, workflow:workflows(id, name, trigger_type)'), runScope)
      .order('started_at', { ascending: false })
      .limit(LEGACY_LIMIT),
  ])

  const jobs = (jobsResult.data ?? []) as any[]
  const workflowIds = [...new Set(jobs.map((j) => j.workflow_id))]
  const runs: Record<string, any> = {}
  const runsByWorkflow: Record<string, any[]> = {}
  if (workflowIds.length > 0) {
    const { data: runData } = await applyScope(db.from('workflow_runs')
      .select('id, workflow_id, version_id, status, event_id, paused_node_id, started_at, title, error, started_by, sla_label, sla_due_at, sla_warning_at, sla_status')
      .in('workflow_id', workflowIds), runScope)
      .order('started_at', { ascending: false })
      .limit(LEGACY_LIMIT)
    for (const r of (runData ?? []) as any[]) {
      runs[r.id] = r
      ;(runsByWorkflow[r.workflow_id] ??= []).push(r)
    }
  }

  // Match each job without a run id to the run that started within 30s of it.
  for (const job of jobs) {
    if (job.result?.run_id && runs[job.result.run_id]) continue
    const workflowRuns = runsByWorkflow[job.workflow_id] ?? []
    if (workflowRuns.length > 0 && job.started_at) {
      const jobStart = new Date(job.started_at).getTime()
      let bestRun = workflowRuns[0]
      let bestDiff = Math.abs(new Date(bestRun.started_at).getTime() - jobStart)
      for (const r of workflowRuns) {
        const diff = Math.abs(new Date(r.started_at).getTime() - jobStart)
        if (diff < bestDiff) { bestRun = r; bestDiff = diff }
      }
      if (bestDiff < 30000) job.result = { ...(job.result ?? {}), run_id: bestRun.id }
    }
  }

  const summary = (r: any) => r ? ({
    id: r.id, workflow_id: r.workflow_id, version_id: r.version_id ?? null, status: r.status, event_id: r.event_id ?? null,
    paused_node_id: r.paused_node_id ?? null, started_at: r.started_at ?? null, title: r.title ?? null,
    sla_label: r.sla_label ?? null, sla_due_at: r.sla_due_at ?? null, sla_warning_at: r.sla_warning_at ?? null,
    sla_status: r.sla_due_at ? (r.sla_status ?? 'on_track') : null,
  }) : null

  const queueRunIds = new Set(jobs.map((job) => job.result?.run_id).filter(Boolean))
  const items: QueueItem[] = jobs.map((job) => {
    const run = job.result?.run_id ? runs[job.result.run_id] : null
    const starter = run?.started_by ?? job.trigger_data?._started_by?.user_id ?? null
    return {
      id: job.id,
      job_id: job.id,
      synthetic_run: false,
      workflow_id: job.workflow_id,
      workflow: { id: job.workflow?.id ?? job.workflow_id, name: job.workflow?.name ?? 'Unknown', trigger_type: job.workflow?.trigger_type ?? null },
      status: job.status,
      effective_status: effectiveQueueStatus(job.status, run?.status),
      trigger_type: job.trigger_type ?? null,
      trigger_data: job.trigger_data?.task_id ? { task_id: job.trigger_data.task_id } : null,
      result: job.result ?? null,
      error: job.error || run?.error || null,
      created_at: job.created_at,
      started_at: job.started_at ?? null,
      completed_at: job.completed_at ?? null,
      updated_at: job.completed_at ?? job.started_at ?? job.created_at,
      run: summary(run),
      step_label: null,
      started_by: starter ? { id: String(starter), name: null, email: null } : null,
      assignee: null,
    }
  })
  for (const run of (middlewareRunsResult.data ?? []) as any[]) {
    if (run.workflow?.trigger_type !== 'middleware_received' || queueRunIds.has(run.id)) continue
    items.push({
      id: `run:${run.id}`,
      job_id: null,
      synthetic_run: true,
      workflow_id: run.workflow_id,
      workflow: { id: run.workflow?.id ?? run.workflow_id, name: run.workflow?.name ?? 'Unknown', trigger_type: 'middleware_received' },
      status: run.status,
      effective_status: run.status,
      trigger_type: 'middleware_received',
      trigger_data: null,
      result: { run_id: run.id },
      error: run.error ?? null,
      created_at: run.started_at,
      started_at: run.started_at,
      completed_at: run.completed_at ?? null,
      updated_at: run.completed_at ?? run.started_at,
      run: summary(run),
      step_label: null,
      started_by: null,
      assignee: null,
    })
  }
  return items
}
