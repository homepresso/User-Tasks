import { z } from 'zod'
import type { RunTask } from '@/lib/run-tasks'
import { getDb } from '../context'
import { getDirectoryCapabilities, searchDirectoryEntraGroups } from '../directory-groups'
import { applyScope, queueJobInScope, resolveRunScope, runInScope, runScopeFilter } from '../run-visibility'
import { fetchLiveInstanceCounts } from '@/lib/workflow-live-counts'
import { normalizeScheduleConfig, type ScheduleConfig } from '@/lib/workflow-schedule'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'
import { applyWorkflowListQuery, MAX_WORKFLOW_SEARCH } from '@/lib/automations/workflow-list-page'
import { MAX_QUEUE_SEARCH, STATUS_CHIPS, TRIGGER_GROUPS, type QueueTriggerGroup } from '@/lib/automations/queue-filters'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/**
 * Automations: workflow list/builder/runs/queue/schedules, business rules,
 * the workflow designer's pickers, and the live log tail's polling fallback.
 * Every /automations route requires workflows.view (lib/route-permissions);
 * the queue requires workflows.view_runs.
 */

const VIEW = 'workflows.view'
/** Run history/detail pages sit under /automations (workflows.view); view_runs also reads runs. */
const RUNS = ['workflows.view', 'workflows.view_runs'] as const
/** Queue / run lists: view_queue (involved + granted) or view_runs (all; implies view_queue). */
const QUEUE = ['workflows.view_queue', 'workflows.view_runs'] as const

const RUNS_PAGE_SIZE = 25

/** List columns only: definitions (nodes/edges) stay on the server — node_count is maintained by a trigger, run_count by the engine. */
const WORKFLOW_LIST_COLUMNS = 'id, name, description, trigger_type, is_active, run_count, last_run_at, node_count, tags, published_version_id, created_at, updated_at'

const uuidList = z.array(z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)).max(100).optional()
/** Queue page arguments (lib/automations/queue-filters QueueReadFilters + paging). */
const QUEUE_LIST_ARGS = z.object({
  view: z.enum(['active', 'attention', 'completed', 'all']).default('active'),
  statuses: z.array(z.enum(STATUS_CHIPS.map((c) => c.value) as [string, ...string[]])).max(20).optional(),
  search: z.string().max(MAX_QUEUE_SEARCH).optional(),
  workflowIds: uuidList,
  startedBy: uuidList,
  assigneeIds: uuidList,
  dateField: z.enum(['created', 'started', 'updated']).optional(),
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
  sla: z.array(z.enum(['on_track', 'warning', 'breached'])).max(3).optional(),
  triggers: z.array(z.enum(TRIGGER_GROUPS.map((g) => g.value) as [QueueTriggerGroup, ...QueueTriggerGroup[]])).max(10).optional(),
  versionIds: uuidList,
  hasErrors: z.boolean().optional(),
  sort: z.enum(['created_at', 'started_at', 'status']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  page: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
}).optional()

/** Selects the designer's retention-policy pickers use (fixed list, not free text). */
const ACTIVE_TASK_ARGS = z.object({
  search: z.string().max(200).optional(),
  assignee: z.string().uuid().nullable().optional(),
  workflow: z.string().uuid().nullable().optional(),
  waiting: z.enum(['1d', '3d', '1w']).nullable().optional(),
  sla: z.enum(['overdue', 'due_soon', 'on_track', 'none']).nullable().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).nullable().optional(),
  unassigned: z.boolean().optional(),
  page: z.number().int().min(1).max(10_000).optional(),
  pageSize: z.number().int().min(1).max(100).optional(),
}).optional()

const RETENTION_POLICY_SELECTS = [
  'id, name, description, applies_to',
  'id, name, description, policy_mode, applies_to',
  'id, name, description, policy_mode, duration_value, duration_unit, exact_date, applies_to',
] as const

/**
 * Log sources the live tail polls (hooks/use-live-logs): table + the
 * timestamp column used for ordering and the `since` window. Not every log
 * table has `created_at`: integration_call_logs uses `started_at` (HTTP call
 * start), and agent_runs prefers `started_at` for parity with its detail page.
 */
const LOG_SOURCES = {
  workflow: { table: 'workflow_logs', ts: 'created_at' },
  audit: { table: 'object_audit_log', ts: 'created_at' },
  integration: { table: 'integration_call_logs', ts: 'started_at' },
  agent: { table: 'agent_runs', ts: 'started_at' },
} as const

function extractScheduleConfig(nodes: unknown): ScheduleConfig | null {
  if (!Array.isArray(nodes)) return null
  const trigger = nodes.find((node: any) => node && typeof node === 'object' && node.type === 'schedule') as { config?: unknown } | undefined
  return normalizeScheduleConfig(trigger?.config)
}

export const reads = {
  /** Agent versions the published workflow's Run Agent steps are pinned to (designer badge). */
  'automations.agentPins': defineRead({
    args: z.object({ workflowId: id }),
    perm: VIEW,
    run: async (ctx, { workflowId }) => {
      const { getWorkflowAgentPins } = await import('@/lib/services/workflows')
      return getWorkflowAgentPins(ctx, workflowId)
    },
  }),

  // ─── Workflow list / builder ───

  'automations.list': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('workflows')
        // List columns only: definitions (nodes/edges) stay on the server —
        // node_count is maintained by a trigger, run_count by the engine.
        .select(WORKFLOW_LIST_COLUMNS)
        .order('updated_at', { ascending: false })
      return ((data ?? []) as any[]).map((wf) => ({ ...wf, tags: wf.tags ?? null }))
    },
  }),

  /**
   * One page of the Workflows list (lib/automations/workflow-list-page.ts):
   * search / status / trigger / tag filters, sort, .range() and an exact count.
   */
  'automations.listPage': defineRead({
    args: z.object({
      q: z.string().max(MAX_WORKFLOW_SEARCH).optional(),
      status: z.enum(['all', 'active', 'inactive']).optional(),
      trigger: z.string().regex(/^[a-z0-9_]{1,80}$/).nullish(),
      tag: z.string().min(1).max(80).nullish(),
      sort: z.enum(['name', 'updated_at', 'run_count', 'status', 'trigger_type', 'nodes']).optional(),
      dir: z.enum(['asc', 'desc']).optional(),
      page: z.number().int().min(1).max(100_000),
      size: z.number().int().min(1).max(100),
    }),
    perm: VIEW,
    run: async (ctx, args) => {
      const db = getDb(ctx) as any
      const base = db.from('workflows').select(WORKFLOW_LIST_COLUMNS, { count: 'exact' })
      const { data, count, error } = await applyWorkflowListQuery(base, args)
      if (error) {
        // Past the last page (e.g. after a delete): no rows, and the total so the list can step back.
        if (error.code !== 'PGRST103') throw new Error(error.message)
        const { count: total } = await applyWorkflowListQuery(db.from('workflows').select('id', { count: 'exact', head: true }), { ...args, page: 1 })
        return { rows: [] as any[], total: (total ?? 0) as number, page: args.page, size: args.size }
      }
      const rows = ((data ?? []) as any[]).map((wf) => ({ ...wf, tags: wf.tags ?? null }))
      return { rows, total: (count ?? rows.length) as number, page: args.page, size: args.size }
    },
  }),

  /** The Workflows list's filter options over every workflow: tags, trigger types and the total. */
  'automations.listFacets': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data, error } = await (getDb(ctx) as any).from('workflows').select('trigger_type, tags')
      if (error) throw new Error(error.message)
      const tags = new Set<string>()
      const triggers = new Set<string>()
      for (const wf of (data ?? []) as any[]) {
        if (wf.trigger_type) triggers.add(String(wf.trigger_type))
        for (const tag of Array.isArray(wf.tags) ? wf.tags : []) tags.add(String(tag))
      }
      return { tags: [...tags].sort(), triggers: [...triggers].sort(), total: (data ?? []).length as number }
    },
  }),

  'automations.tagDefinitions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('tag_definitions').select('id, name, color').order('name')
      return (data ?? []) as any[]
    },
  }),

  /** The builder page: workflow, recent runs, custom activities, published version, live instance badge. */
  'automations.builder': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id }) => {
      const db = getDb(ctx) as any
      const { data: workflow } = await db.from('workflows').select('*').eq('id', id).maybeSingle()
      if (!workflow) return null

      const publishedVersionId = workflow.published_version_id
      const [{ data: runs }, { data: customActivities }, versionResult, liveCounts] = await Promise.all([
        // The builder only shows a run count; never pull node_results/execution_trace here.
        db.from('workflow_runs').select('id, status, started_at, completed_at').eq('workflow_id', id).order('started_at', { ascending: false }).limit(10),
        // No source code: steps run the action from the library, never from the designer.
        db.from('custom_workflow_activities').select('id, name, description, key, status, enabled, runtime, version, icon_name, color, manifest, signature, tags').eq('status', 'active').order('name'),
        publishedVersionId
          ? db.from('workflow_versions').select('version_number').eq('id', publishedVersionId).maybeSingle()
          : Promise.resolve({ data: null }),
        // Live (waiting / paused) instances per version, for the header badge.
        fetchLiveInstanceCounts(db, workflow.tenant_id, id),
      ])
      const publishedVersionNumber = (versionResult?.data?.version_number ?? null) as number | null
      const liveInstances = liveCounts.reduce((sum, r) => sum + r.instances, 0)
      const liveOnOlder = liveCounts.filter((r) => r.version_id !== publishedVersionId).reduce((sum, r) => sum + r.instances, 0)
      return { workflow: workflow as any, runs: (runs ?? []) as any[], customActivities: (customActivities ?? []) as any[], publishedVersionNumber, liveInstances, liveOnOlder }
    },
  }),

  'automations.scheduled': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('workflows')
        .select('id, name, is_active, nodes, published_version_id, schedule_last_fired_at, updated_at')
        .eq('trigger_type', 'schedule')
        .order('name')
      // Only the schedule trigger's config goes back, not the whole definition.
      return ((data ?? []) as any[]).map(({ nodes, ...wf }) => ({ ...wf, config: extractScheduleConfig(nodes) })) as Array<{
        id: string; name: string; is_active: boolean | null; published_version_id: string | null
        schedule_last_fired_at: string | null; updated_at: string | null; config: ScheduleConfig | null
      }>
    },
  }),

  /** What a workflow touches: run/task/webhook counts and the tables, references and child workflows its nodes name. */
  'automations.dependencies': defineRead({
    args: z.object({ workflowId: id }),
    perm: VIEW,
    run: async (ctx, { workflowId }) => {
      const db = getDb(ctx) as any
      const deps = {
        runs: 0, tasks: 0, webhooks: 0,
        customTables: [] as { id: string; name: string }[],
        references: [] as { id: string; name: string }[],
        childWorkflows: [] as { id: string; name: string }[],
      }
      const [{ count: runCount }, { count: taskCount }, { count: whCount }, { data: definition }] = await Promise.all([
        db.from('workflow_runs').select('id', { count: 'exact', head: true }).eq('workflow_id', workflowId),
        db.from('tasks').select('id', { count: 'exact', head: true }).eq('source_workflow_id', workflowId),
        db.from('workflow_webhooks').select('id', { count: 'exact', head: true }).eq('workflow_id', workflowId),
        db.from('workflows').select('nodes').eq('id', workflowId).maybeSingle(),
      ])
      deps.runs = runCount ?? 0
      deps.tasks = taskCount ?? 0
      deps.webhooks = whCount ?? 0
      const workflowNodes: any[] = Array.isArray(definition?.nodes) ? definition.nodes : []

      const tableIds = new Set<string>()
      const refIds = new Set<string>()
      const childWfIds = new Set<string>()
      for (const node of workflowNodes) {
        const config = node?.config ?? {}
        if (config.table_id) tableIds.add(config.table_id)
        if (config.reference_id) refIds.add(config.reference_id)
        if (node.type === 'trigger_workflow' && config.workflow_id) childWfIds.add(config.workflow_id)
        if (node.type === 'call_reference' && config.referenceId) refIds.add(config.referenceId)
        if (node.type === 'update_data_table' && config.tableId) tableIds.add(config.tableId)
      }

      const [tables, refs, children] = await Promise.all([
        tableIds.size > 0 ? db.from('custom_tables').select('id, name').in('id', [...tableIds]) : { data: [] },
        refIds.size > 0 ? db.from('integration_references').select('id, name').in('id', [...refIds]) : { data: [] },
        childWfIds.size > 0 ? db.from('workflows').select('id, name').in('id', [...childWfIds]) : { data: [] },
      ])
      deps.customTables = tables.data ?? []
      deps.references = refs.data ?? []
      deps.childWorkflows = children.data ?? []
      return deps
    },
  }),

  'automations.webhook': defineRead({
    args: z.object({ workflowId: id }),
    perm: VIEW,
    run: async (ctx, { workflowId }) => {
      const { data } = await (getDb(ctx) as any).from('workflow_webhooks')
        .select('*')
        .eq('workflow_id', workflowId)
        .limit(1)
        .maybeSingle()
      return data as any
    },
  }),

  /** The signed-in user's current workspace (current_tenant_id ?? tenant_id), as the session resolved it. */
  'automations.currentTenant': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => ({ tenantId: ctx.tenantId }),
  }),

  'automations.nodeFavorites': defineRead({
    args: z.object({ tenantId: id }),
    perm: VIEW,
    run: async (ctx, { tenantId }) => {
      const { data } = await (getDb(ctx) as any).from('node_favorites').select('node_type').eq('tenant_id', tenantId)
      return ((data ?? []) as Array<{ node_type: string }>).map((r) => r.node_type)
    },
  }),

  /** All published versions, newest first, with live instance counts per version. */
  'automations.versionHistory': defineRead({
    args: z.object({ workflowId: id }),
    perm: VIEW,
    run: async (ctx, { workflowId }) => {
      const db = getDb(ctx) as any
      const { data } = await db.from('workflow_versions')
        .select('*')
        .eq('workflow_id', workflowId)
        .order('version_number', { ascending: false })
      const versions = (data ?? []) as any[]
      const tenantId = (versions[0] as { tenant_id?: string } | undefined)?.tenant_id
      const counts = tenantId ? await fetchLiveInstanceCounts(db, tenantId, workflowId) : []
      return {
        versions,
        liveCounts: Object.fromEntries(counts.filter((r) => r.version_id).map((r) => [r.version_id as string, r.instances])) as Record<string, number>,
      }
    },
  }),

  /** Versions a live instance can be migrated to (migration wizard). */
  'automations.migrationVersions': defineRead({
    args: z.object({ workflowId: id }),
    perm: VIEW,
    run: async (ctx, { workflowId }) => {
      const { data } = await (getDb(ctx) as any).from('workflow_versions')
        .select('id, version_number, is_active, published_at, nodes, edges')
        .eq('workflow_id', workflowId)
        .order('version_number', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  // ─── Runs ───

  'automations.workflowMeta': defineRead({
    args: z.object({ id }),
    perm: RUNS,
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('workflows')
        .select('id, name, trigger_type, is_active')
        .eq('id', id)
        .maybeSingle()
      return data as { id: string; name: string; trigger_type: string; is_active: boolean | null } | null
    },
  }),

  'automations.workflowRuns': defineRead({
    args: z.object({
      workflowId: id,
      status: z.string().max(50).optional(),
      sortKey: z.enum(['started_at', 'duration', 'status']),
      sortDir: z.enum(['asc', 'desc']),
      page: z.number().int().min(0).max(10_000),
    }),
    perm: RUNS,
    run: async (ctx, { workflowId, status, sortKey, sortDir, page }) => {
      let query = (getDb(ctx) as any).from('workflow_runs')
        .select('id, status, title, error, started_at, completed_at, task_id, trace_id, sla_label, sla_due_at, sla_status, started_via', { count: 'exact' })
        .eq('workflow_id', workflowId)
        .range(page * RUNS_PAGE_SIZE, page * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE - 1)
      if (status) query = query.eq('status', status)
      // duration is computed in the browser (completed_at - started_at), so it orders by started_at here.
      query = query.order(sortKey === 'status' ? 'status' : 'started_at', { ascending: sortDir === 'asc' })
      const { data, count } = await query
      return { rows: (data ?? []) as any[], total: (count ?? 0) as number }
    },
  }),

  /** Quick stats over the workflow's latest 1000 runs (computed here, not in the browser). */
  'automations.workflowRunStats': defineRead({
    args: z.object({ workflowId: id }),
    perm: RUNS,
    run: async (ctx, { workflowId }) => {
      const { data } = await (getDb(ctx) as any).from('workflow_runs')
        .select('status, started_at, completed_at, sla_due_at, sla_status')
        .eq('workflow_id', workflowId)
        .limit(1000)
      const rows = (data ?? []) as Array<{ status: string; started_at: string | null; completed_at: string | null }>
      const completed = rows.filter((r) => r.status === 'completed').length
      const failed = rows.filter((r) => r.status === 'failed').length
      const running = rows.filter((r) => r.status === 'running' || r.status === 'processing').length
      // Average duration for completed runs only
      const durations = rows
        .filter((r) => r.status === 'completed' && r.started_at && r.completed_at)
        .map((r) => new Date(r.completed_at!).getTime() - new Date(r.started_at!).getTime())
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0
      const successRate = (completed + failed) > 0 ? Math.round((completed / (completed + failed)) * 100) : 0
      return { total: rows.length, completed, failed, running, avgDuration, successRate }
    },
  }),

  /**
   * Run detail (process viewer): the run (or, for a queue job id, the
   * workflow's latest run), the definition of the version it executes, its
   * logs, and the closest-duration completed sibling run for comparison.
   */
  'automations.processView': defineRead({
    args: z.object({ id }),
    // The run (or queue job) must be in the person's run scope (run-visibility).
    perm: QUEUE,
    run: async (ctx, { id }) => {
      const db = getDb(ctx) as any
      const scope = await resolveRunScope(ctx)
      let run: any = null
      let workflow: any = null
      let logs: any[] = []
      let compareRun: any = null

      const { data: runData } = await db.from('workflow_runs').select('*, workflow:workflows(*)').eq('id', id).maybeSingle()
      if (runData) {
        if (!runInScope(scope, runData)) return null
        run = runData
        workflow = runData.workflow
      } else {
        const { data: job } = await db.from('workflow_queue').select('*, workflow:workflows(*)').eq('id', id).maybeSingle()
        if (job && !queueJobInScope(scope, job)) return null
        if (job) {
          workflow = job.workflow
          const { data: jobRun } = await applyScope(db.from('workflow_runs')
            .select('*')
            .eq('workflow_id', job.workflow_id), runScopeFilter(scope))
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          run = jobRun
        }
      }

      if (!workflow) return null

      // Draw the definition the run executes (its version), not the current draft.
      let versionNumber: number | null = null
      if (run?.version_id) {
        const { data: versionRow } = await db.from('workflow_versions')
          .select('id, version_number, nodes, edges, swimlanes, sections')
          .eq('id', run.version_id)
          .maybeSingle()
        if (versionRow) {
          versionNumber = versionRow.version_number
          workflow = { ...workflow, nodes: versionRow.nodes ?? [], edges: versionRow.edges ?? [], swimlanes: versionRow.swimlanes ?? workflow.swimlanes, sections: versionRow.sections ?? workflow.sections }
        }
      }

      if (run) {
        const [{ data: logData }, { data: siblingRuns }] = await Promise.all([
          db.from('workflow_logs').select('*').eq('run_id', run.id).order('created_at', { ascending: true }),
          applyScope(db.from('workflow_runs')
            .select('id, workflow_id, status, started_at, completed_at, error, title, execution_trace, node_results')
            .eq('workflow_id', run.workflow_id), runScopeFilter(scope))
            .neq('id', run.id)
            .eq('status', 'completed')
            .not('completed_at', 'is', null)
            .order('started_at', { ascending: false })
            .limit(25),
        ])
        logs = logData ?? []

        const durationFor = (candidate: any) => {
          if (!candidate?.started_at || !candidate?.completed_at) return null
          return new Date(candidate.completed_at).getTime() - new Date(candidate.started_at).getTime()
        }
        const currentDuration = durationFor(run)
        if (siblingRuns && siblingRuns.length > 0) {
          const candidates = (siblingRuns as any[])
            .map((candidate) => ({ candidate, duration: durationFor(candidate) }))
            .filter((entry) => entry.duration != null)
          if (candidates.length > 0) {
            compareRun = candidates.sort((a, b) => {
              const aDelta = Math.abs((a.duration ?? 0) - (currentDuration ?? a.duration ?? 0))
              const bDelta = Math.abs((b.duration ?? 0) - (currentDuration ?? b.duration ?? 0))
              return aDelta - bDelta
            })[0]?.candidate ?? null
          } else {
            compareRun = siblingRuns[0] ?? null
          }
        }
      }

      // The run's User Tasks: who has each, history, and per task whether
      // this viewer may open / act on it (lib/services/run-tasks.ts).
      let tasks: RunTask[] = []
      if (run) {
        const { loadRunTasks, labelsOf } = await import('../run-tasks')
        tasks = await loadRunTasks(ctx, { id: run.id, workflow_id: run.workflow_id ?? null }, { labels: labelsOf(workflow.nodes ?? []) })
      }

      return { workflow, run, logs, compareRun, versionNumber, tasks }
    },
  }),

  /**
   * Queue page: one page of queue items for a view + filters (filtered,
   * sorted and paged in the database), view counts and status totals
   * (lib/services/workflow-queue-list).
   */
  'automations.queue': defineRead({
    args: QUEUE_LIST_ARGS,
    // Everything with view_runs; involved runs + granted workflows with
    // view_queue (lib/services/run-visibility — the one scoping rule).
    perm: QUEUE,
    run: async (ctx, args) => {
      const { listQueuePage } = await import('../workflow-queue-list')
      return listQueuePage(ctx, args ?? { view: 'active' })
    },
  }),

  /**
   * Queue page → Active tasks: open human tasks in the person's scope
   * (everything with tasks.view_all; else their own, their reporting chain's
   * and the workflows they manage — lib/services/active-tasks), with what
   * they may do on each (take ownership, reassign).
   */
  'automations.activeTasks': defineRead({
    args: ACTIVE_TASK_ARGS,
    perm: ['tasks.view_own', 'tasks.view_all', 'workflows.view_queue', 'workflows.view_runs'],
    run: async (ctx, args) => {
      const { listActiveTasks } = await import('../active-tasks')
      return listActiveTasks(ctx, args ?? {})
    },
  }),

  /** The queue's advanced filter options: workflows, versions, starters and assignees in the person's scope. */
  'automations.queueFacets': defineRead({
    args: NO_ARGS,
    perm: QUEUE,
    run: async (ctx) => {
      const { queueFacets } = await import('../workflow-queue-list')
      return queueFacets(ctx)
    },
  }),

  /** Nodes of the version a run executes, else the workflow's draft (queue "go to node"). */
  'automations.definitionNodes': defineRead({
    args: z.object({ workflowId: id, versionId: id.optional() }),
    perm: 'workflows.view_runs',
    run: async (ctx, { workflowId, versionId }) => {
      const db = getDb(ctx) as any
      const { data } = versionId
        ? await db.from('workflow_versions').select('nodes').eq('id', versionId).maybeSingle()
        : await db.from('workflows').select('nodes').eq('id', workflowId).maybeSingle()
      return (Array.isArray(data?.nodes) ? data.nodes : null) as any[] | null
    },
  }),

  // ─── Business rules ───

  'automations.decisionTables': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('decision_tables').select('*').order('updated_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  'automations.decisionTable': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('decision_tables').select('*').eq('id', id).maybeSingle()
      return data as any
    },
  }),

  // ─── Designer pickers (node config panel) ───

  'automations.workflowOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('workflows').select('id, name, trigger_type, user_variables, is_active').order('name')
      return (data ?? []) as { id: string; name: string; trigger_type: string; user_variables: any; is_active: boolean | null }[]
    },
  }),

  /** Workflows an error / SLA trigger can watch (all but other triggers of that kind). */
  'automations.triggerSourceWorkflows': defineRead({
    args: z.object({ exclude: z.enum(['workflow_error', 'workflow_sla']) }),
    perm: VIEW,
    run: async (ctx, { exclude }) => {
      const { data } = await (getDb(ctx) as any).from('workflows')
        .select('id, name, trigger_type, is_active')
        .neq('trigger_type', exclude)
        .order('name')
      return (data ?? []) as any[]
    },
  }),

  /** id + name of the tenant's data tables (RLS scoped), for designer / viewer card summaries. Any page with a workflow canvas needs it. */
  'automations.dataTableNames': defineRead({
    args: NO_ARGS,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('custom_tables').select('id, name')
      return (data ?? []) as { id: string; name: string }[]
    },
  }),

  'automations.decisionTableOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('decision_tables').select('id, name, description, inputs, outputs').order('name')
      return (data ?? []) as any[]
    },
  }),

  'automations.userOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('users').select('id, display_name, email').order('display_name')
      return (data ?? []) as any[]
    },
  }),

  'automations.teamOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('teams').select('id, name').order('name')
      return (data ?? []) as any[]
    },
  }),

  /** User Task "AAD Group" assignment: offered only when Entra ID is configured (lib/services/directory-groups). */
  'directory.capabilities': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: (ctx) => getDirectoryCapabilities(ctx),
  }),

  /** The AAD group picker: synced Entra groups, else a live Microsoft Graph search. */
  'directory.entraGroups': defineRead({
    args: z.object({ search: z.string().max(100).optional(), cursor: z.string().max(4000).nullish() }),
    // Searching the directory through the workspace's Graph credentials is a design-time picker.
    perm: ['workflows.edit', 'workflows.create', 'settings.view'],
    run: (ctx, args) => searchDirectoryEntraGroups(ctx, { search: args.search ?? null, cursor: args.cursor ?? null, limit: 25 }),
  }),

  'automations.roleOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('roles').select('id, name, slug, is_system').order('is_system', { ascending: false }).order('name')
      return (data ?? []) as any[]
    },
  }),

  'automations.emailTemplateOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('email_templates').select('id, name, subject').order('name')
      return (data ?? []) as Array<{ id: string; name: string; subject: string }>
    },
  }),

  'automations.agentOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('agents').select('id, name, is_active, integration_id, model, output_config, version').order('name')
      return (data ?? []) as any[]
    },
  }),

  'automations.retentionPolicyOptions': defineRead({
    args: z.object({ select: z.enum(RETENTION_POLICY_SELECTS) }),
    perm: VIEW,
    run: async (ctx, { select }) => {
      const { data } = await (getDb(ctx) as any).from('retention_policies').select(select).order('name').limit(200)
      return (data ?? []) as any[]
    },
  }),

  /** Data tables by name, optionally with their column definitions. */
  'automations.tableOptions': defineRead({
    args: z.object({ columns: z.boolean().optional(), limit: z.number().int().min(1).max(1000).optional() }).optional(),
    perm: VIEW,
    run: async (ctx, args) => {
      let query = (getDb(ctx) as any).from('custom_tables').select(args?.columns ? 'id, name, columns' : 'id, name').order('name')
      if (args?.limit) query = query.limit(args.limit)
      const { data } = await query
      return (data ?? []) as any[]
    },
  }),

  /** Latest rows of a data table (row pickers). */
  'automations.tableRows': defineRead({
    args: z.object({ tableId: id, withCreatedAt: z.boolean().optional(), limit: z.number().int().min(1).max(500) }),
    perm: 'data.view', // table rows are data (was workflows.view)
    run: async (ctx, { tableId, withCreatedAt, limit }) => {
      const { data } = await (getDb(ctx) as any).from('custom_table_rows')
        .select(withCreatedAt ? 'id, data, created_at' : 'id, data')
        .eq('table_id', tableId)
        .order('created_at', { ascending: false })
        .limit(limit)
      return (data ?? []) as any[]
    },
  }),

  'automations.referenceInputs': defineRead({
    args: z.object({ id }),
    perm: VIEW,
    run: async (ctx, { id }) => {
      const { data } = await (getDb(ctx) as any).from('integration_references').select('id, inputs').eq('id', id).maybeSingle()
      return (data ?? null) as any
    },
  }),

  /** Integrations + references for the server-event reference picker. */
  'automations.referencePicker': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [intRes, refRes] = await Promise.all([
        db.from('integrations').select('id, name, type, is_active').order('name'),
        db.from('integration_references').select('id, name, integration_id, request_config').order('name'),
      ])
      return { integrations: (intRes.data ?? []) as any[], references: (refRes.data ?? []) as any[] }
    },
  }),

  /**
   * Templates of an e-signature integration (the E-signature steps' template
   * picker): a searchable page from the provider, through the same adapter
   * as the actions. The integration must belong to the current workspace.
   */
  'automations.esignTemplates': defineRead({
    args: z.object({ integration_id: id, search: z.string().max(200).optional(), cursor: z.string().max(500).optional() }),
    perm: VIEW,
    run: async (ctx, args) => {
      const { loadEsignIntegration } = await import('@/lib/esign/service')
      const { EsignError } = await import('@/lib/esign/types')
      try {
        const loaded = await loadEsignIntegration(getDb(ctx) as any, ctx.tenantId, args.integration_id, { timeoutMs: 20_000 })
        const page = await loaded.adapter.listTemplates(loaded.ctx, { search: args.search, cursor: args.cursor ?? null, page_size: 50 })
        return { ok: true as const, provider: loaded.provider, ...page }
      } catch (error) {
        if (error instanceof EsignError) return { ok: false as const, error: error.message, templates: [], next_cursor: null }
        throw error
      }
    },
  }),

  /** Active integrations + every reference, for the call-reference node. */
  'automations.callReferenceOptions': defineRead({
    args: NO_ARGS,
    perm: VIEW,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [intRes, refRes] = await Promise.all([
        db.from('integrations').select('id, name, type, is_active, config, tags').eq('is_active', true).order('name'),
        db.from('integration_references').select('*').order('name'),
      ])
      return { integrations: (intRes.data ?? []) as any[], references: (refRes.data ?? []) as any[] }
    },
  }),

  // ─── Live log tail (settings → logs) ───

  /** Polling fallback for the live log tail: one source's rows since the tail started. */
  /** The form a workflow starts from: the draft (Test runner, workflows.edit) or the published version (Run dialog). */
  'automations.startForm': defineRead({
    args: z.object({ workflow_id: id, draft: z.boolean().optional() }),
    perm: VIEW,
    run: async (ctx, args) => (await import('../workflow-start-form')).getWorkflowStartForm(ctx, args.workflow_id, { draft: args.draft === true }),
  }),

  /** The forms that start a workflow (trigger form + button "Start workflow" actions), with their page paths. */
  'automations.workflowForms': defineRead({
    args: z.object({ workflow_id: id }),
    perm: VIEW,
    run: async (ctx, args) => (await import('../workflow-start-form')).getWorkflowFormEntries(ctx, args.workflow_id),
  }),

  'automations.liveLogs': defineRead({
    args: z.object({
      source: z.enum(Object.keys(LOG_SOURCES) as [keyof typeof LOG_SOURCES, ...(keyof typeof LOG_SOURCES)[]]),
      since: z.string().max(40),
    }),
    perm: 'settings.view',
    run: async (ctx, { source, since }) => {
      const { table, ts } = LOG_SOURCES[source]
      return check(await (getDb(ctx) as any).from(table)
        .select('*')
        .gte(ts, since)
        .order(ts, { ascending: false })
        .limit(100)) as any[] ?? []
    },
  }),
} satisfies Record<string, UiRead<any, any>>
