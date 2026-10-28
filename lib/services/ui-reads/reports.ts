import { z } from 'zod'
import { getDb, type ServiceContext } from '../context'
import * as analytics from '../report-analytics'
import { check, defineRead, id, NO_ARGS, type UiRead } from './define'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser read them */

/**
 * Reports: saved reports, the individual report, the pre-built task /
 * integration / retention / business-rules reports, and the workflow reports
 * (hub, process overview, compare). The whole /reports tree is gated on
 * reports.view (lib/route-permissions.ts), as are the run aggregates.
 */

const PERM = 'reports.view'

/** An ISO date/time from the browser (window starts it computed locally). */
const isoDate = z.string().min(1).max(40).refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')

const TASK_REPORT_COLUMNS = 'id, title, status, priority, due_date, created_at, started_at, completed_at, updated_at, actual_effort, estimated_effort_assignee, estimated_effort_assigner, is_workflow_task, workflow_id, workflow_source_id, workflow_step_id, progress_pct, actioned_by, outcome, workflow:workflows!tasks_workflow_id_fkey(id, name), workflow_source:workflow_sources(id, display_name, engine_type)'

/**
 * Effort records collapsed to per-task estimate/actual totals — the only use
 * the task report makes of them (its estimated-vs-actual scatter, tasks with
 * both > 0). Same sums as the browser computed, one record of each kind.
 */
export function collapseEffortRecords(records: Array<{ task_id: string; minutes: number; record_type: string }>) {
  const taskEffort = new Map<string, { estimated: number; actual: number }>()
  records.forEach((r) => {
    if (!taskEffort.has(r.task_id)) taskEffort.set(r.task_id, { estimated: 0, actual: 0 })
    const e = taskEffort.get(r.task_id)!
    if (r.record_type === 'assigner_estimate') e.estimated += r.minutes
    else if (r.record_type === 'actual' || r.record_type === 'timer_entry') e.actual += r.minutes
  })
  return [...taskEffort.entries()]
    .filter(([, e]) => e.estimated > 0 && e.actual > 0)
    .flatMap(([task_id, e]) => [
      { task_id, minutes: e.estimated, record_type: 'assigner_estimate' },
      { task_id, minutes: e.actual, record_type: 'actual' },
    ])
}

/** Run summaries/visit stats where a failure shows as "no runs" (compare page). */
async function orEmpty<T>(load: () => Promise<T[]>): Promise<T[]> {
  try { return await load() } catch { return [] }
}

async function workflowOverview(ctx: ServiceContext, workflowId: string) {
  const db = getDb(ctx) as any
  const [workflowResult, runs, queueResult] = await Promise.all([
    db.from('workflows')
      .select('id, name, description, trigger_type, trigger_config, is_active, user_variables, nodes, edges, swimlanes, created_at')
      .eq('id', workflowId)
      .maybeSingle(),
    // Run rows without traces (trace-derived counts come from SQL).
    analytics.runSummaries(ctx, { workflowIds: [workflowId], limit: 2000 }),
    db.from('workflow_queue')
      .select('id, workflow_id, status, trigger_data, created_at')
      .eq('workflow_id', workflowId)
      .in('status', ['pending', 'running']),
  ])
  const workflow = check(workflowResult) as any
  const queueStats = check(queueResult) as any[] | null

  const parsedNodes = Array.isArray(workflow?.nodes)
    ? workflow.nodes
    : typeof workflow?.nodes === 'string'
      ? JSON.parse(workflow.nodes)
      : []
  const workflowAgentIds = [...new Set(
    ((parsedNodes ?? []) as any[])
      .filter((node) => node?.type === 'run_agent' && node?.config?.agent_id)
      .map((node) => node.config.agent_id as string),
  )]
  const taskIds = [...new Set(runs.map((r) => r.task_id).filter(Boolean))]
  const runIds = [...new Set(runs.map((r) => r.id).filter(Boolean))]

  // Originator column: run → task → assigner display name.
  const loadTasks = async () => {
    if (taskIds.length === 0) return {}
    const { data: tasks } = await db.from('tasks').select('id, title, assigner_id').in('id', taskIds)
    const userIds = [...new Set(((tasks ?? []) as any[]).map((t) => t.assigner_id).filter(Boolean))]
    let userById: Record<string, any> = {}
    if (userIds.length > 0) {
      const { data: users } = await db.from('users').select('id, display_name, email').in('id', userIds)
      userById = Object.fromEntries(((users ?? []) as any[]).map((u) => [u.id, u]))
    }
    return Object.fromEntries(((tasks ?? []) as any[]).map((t) => [t.id, { ...t, creator: userById[t.assigner_id] }]))
  }
  const loadAgentRuns = async () => {
    if (runIds.length === 0) return {}
    const { data: agentRuns } = await db.from('agent_runs')
      .select('id, caller_id, agent_id, status, duration_ms, total_tokens, started_at, completed_at, agent:agents(id, name)')
      .eq('caller_type', 'workflow_node')
      .in('caller_id', runIds)
      .order('started_at', { ascending: true })
    return ((agentRuns ?? []) as any[]).reduce((acc: Record<string, any[]>, run) => {
      const key = String(run.caller_id ?? '').trim()
      if (!key) return acc
      if (!acc[key]) acc[key] = []
      acc[key].push(run)
      return acc
    }, {})
  }
  const loadAgentNames = async () => {
    if (workflowAgentIds.length === 0) return {}
    const { data: agents } = await db.from('agents').select('id, name').in('id', workflowAgentIds)
    return Object.fromEntries(((agents ?? []) as any[]).map((agent) => [agent.id, agent.name as string]))
  }
  const [taskById, agentRunsByRunId, agentNameById] = await Promise.all([loadTasks(), loadAgentRuns(), loadAgentNames()])

  return {
    workflow,
    runs: runs as any[],
    queueStats: (queueStats ?? []) as any[],
    taskById: taskById as Record<string, any>,
    agentRunsByRunId: agentRunsByRunId as Record<string, any[]>,
    agentNameById: agentNameById as Record<string, string>,
  }
}

/** Same rule as the reports_select RLS policy: your own reports, or shared ones. */
function visibleTo(ctx: { actorId: string | null }): string {
  return ctx.actorId ? `created_by.eq.${ctx.actorId},is_shared.eq.true` : 'is_shared.eq.true'
}

export const reads = {
  'reports.list': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('reports')
        .select('id, name, description, category, is_favorite, is_shared, config, updated_at, created_by')
        .or(visibleTo(ctx))
        .order('updated_at', { ascending: false })
      return (data ?? []) as any[]
    },
  }),

  'reports.get': defineRead({
    args: z.object({ id }),
    perm: PERM,
    run: async (ctx, { id }) => {
      const { data, error } = await (getDb(ctx) as any).from('reports').select('*').eq('id', id).or(visibleTo(ctx)).maybeSingle()
      return error || !data ? null : data as any
    },
  }),

  /** The signed-in user's own report (assigned/completed tasks, escalations, activity). */
  'reports.individual': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const me = ctx.actorId
      const [
        { data: assignedTasks },
        { data: completedTasks },
        { data: escalations },
        { data: lifecycleEvents },
      ] = await Promise.all([
        db.from('tasks').select(TASK_REPORT_COLUMNS)
          .eq('assignee_id', me)
          .is('deleted_at', null)
          .order('updated_at', { ascending: false })
          .limit(2000),
        db.from('tasks').select(TASK_REPORT_COLUMNS)
          .eq('actioned_by', me)
          .not('completed_at', 'is', null)
          .is('deleted_at', null)
          .order('completed_at', { ascending: false })
          .limit(2000),
        db.from('task_escalations')
          .select('id, created_at, escalated_at, is_escalated, escalation_type, escalate_after_minutes, task:tasks(id, title, status, priority, due_date, assignee_id, completed_at)')
          .eq('user_id', me)
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('lifecycle_events')
          .select('id, created_at, event_type, metadata, task_id, task:tasks(id, title, status)')
          .eq('actor_id', me)
          .order('created_at', { ascending: false })
          .limit(500),
      ])
      return {
        assignedTasks: (assignedTasks ?? []) as any[],
        completedTasks: (completedTasks ?? []) as any[],
        escalations: (escalations ?? []) as any[],
        lifecycleEvents: (lifecycleEvents ?? []) as any[],
      }
    },
  }),

  /** Task report. Effort records arrive collapsed per task (collapseEffortRecords). */
  'reports.tasks': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const now = new Date()
      const thirtyDaysAgo = new Date(now)
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
      const twelveWeeksAgo = new Date(now)
      twelveWeeksAgo.setDate(twelveWeeksAgo.getDate() - 84)

      const [
        { data: allTasks },
        { data: completedRecent },
        { data: effortRecords },
        { data: overdueTasks },
        { data: recentCompleted },
      ] = await Promise.all([
        // Only the columns the report reads (counts by status/priority/assignee, completion time).
        db.from('tasks').select('id, status, priority, created_at, completed_at, assignee_id')
          .is('deleted_at', null).is('parent_task_id', null),
        db.from('tasks').select('id, completed_at')
          .eq('status', 'completed').is('deleted_at', null)
          .gte('completed_at', twelveWeeksAgo.toISOString()),
        db.from('effort_records').select('task_id, minutes, record_type'),
        db.from('tasks').select('id, title, priority, due_date, status, assignee_id')
          .lt('due_date', now.toISOString()).in('status', ['todo', 'in_progress', 'blocked']).is('deleted_at', null),
        db.from('tasks').select('id, title, priority, status, created_at, completed_at, assignee_id')
          .eq('status', 'completed').is('deleted_at', null)
          .gte('completed_at', thirtyDaysAgo.toISOString())
          .order('completed_at', { ascending: false }).limit(50),
      ])

      // Assignee names for the recent-completed and overdue tasks.
      const assigneeIds = [...new Set([...(recentCompleted ?? []), ...(overdueTasks ?? [])].map((t: any) => t.assignee_id).filter(Boolean))]
      const { data: users } = assigneeIds.length
        ? await db.from('users').select('id, display_name').in('id', assigneeIds)
        : { data: [] }
      const userMap = new Map<string, string>(((users ?? []) as any[]).map((u) => [u.id, u.display_name]))

      return {
        allTasks: (allTasks ?? []) as any[],
        completedRecent: (completedRecent ?? []) as any[],
        effortRecords: collapseEffortRecords(effortRecords ?? []),
        overdueTasks: (overdueTasks ?? []) as any[],
        recentCompleted: ((recentCompleted ?? []) as any[]).map((t) => ({ ...t, assignee_name: userMap.get(t.assignee_id) ?? '—' })),
        userMap: Object.fromEntries(userMap) as Record<string, string>,
      }
    },
  }),

  'reports.integrations': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [{ data: integrations }, { data: references }, { data: connectors }] = await Promise.all([
        db.from('integrations').select('id, name, type, is_active, last_test_status, last_tested_at, created_at, updated_at'),
        db.from('integration_references').select('id, integration_id, name'),
        db.from('tenant_connectors').select('id, integration_id, connector_key, is_enabled'),
      ])
      return {
        integrations: (integrations ?? []) as any[],
        references: (references ?? []) as any[],
        connectors: (connectors ?? []) as any[],
      }
    },
  }),

  /** Retention report. Governed assets are counted per policy, so their row data isn't sent. */
  'reports.retention': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [
        { data: policies },
        { data: reviews },
        { data: executions },
        { data: tables },
        { data: rows },
        { data: roles },
      ] = await Promise.all([
        db.from('retention_policies').select('id, name, policy_mode, applies_to, exact_date, duration_value, duration_unit, created_at, updated_at').order('name'),
        db.from('retention_review_events').select('id, retention_policy_id, target_type, asset_name, review_date, status, workflow_triggered_at, retention_policy:retention_policies!retention_review_events_retention_policy_id_fkey(id, name)').order('review_date', { ascending: true }).limit(5000),
        db.from('retention_execution_events').select('id, retention_policy_id, action_type, target_type, asset_name, result_status, executed_at, retention_policy:retention_policies!retention_execution_events_retention_policy_id_fkey(id, name)').order('executed_at', { ascending: false }).limit(5000),
        db.from('custom_tables').select('id, name, retention_policy_id').not('retention_policy_id', 'is', null).limit(5000),
        db.from('custom_table_rows').select('id, retention_policy_id').not('retention_policy_id', 'is', null).limit(5000),
        db.from('roles').select('id, name, retention_policy_id').not('retention_policy_id', 'is', null).limit(5000),
      ])
      return {
        policies: (policies ?? []) as any[],
        reviews: (reviews ?? []) as any[],
        executions: (executions ?? []) as any[],
        tables: (tables ?? []) as any[],
        rows: (rows ?? []) as any[],
        roles: (roles ?? []) as any[],
      }
    },
  }),

  /** Business-rules report. Log metadata is cut down to the fields the report reads. */
  'reports.businessRules': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const db = getDb(ctx) as any
      const [{ data: logs }, { data: tables }] = await Promise.all([
        db.from('workflow_logs')
          .select('id, workflow_id, run_id, node_type, node_label, duration_ms, created_at, metadata, workflow:workflows(id, name), run:workflow_runs(id, title, status)')
          .eq('node_type', 'decision_table')
          .order('created_at', { ascending: false })
          .limit(5000),
        db.from('decision_tables')
          .select('id, name, description, updated_at, created_at')
          .order('name'),
      ])
      return {
        logs: ((logs ?? []) as any[]).map((log) => {
          const m = log.metadata
          return {
            ...log,
            metadata: m && typeof m === 'object'
              ? { matched: m.matched, decision_table_id: m.decision_table_id, decision_table_name: m.decision_table_name, rule_label: m.rule_label }
              : m,
          }
        }),
        tables: (tables ?? []) as any[],
      }
    },
  }),

  /** Workflow reports hub: workflows, per-day run aggregates since `since`, live queue. */
  'reports.workflowHub': defineRead({
    args: z.object({ since: isoDate }),
    perm: PERM,
    run: async (ctx, { since }) => {
      const db = getDb(ctx) as any
      const [workflows, daily, queue] = await Promise.all([
        db.from('workflows')
          .select('id, name, description, trigger_type, is_active, run_count, last_run_at, created_at, user_variables')
          .order('name'),
        analytics.runDailyStats(ctx, { since }),
        db.from('workflow_queue')
          .select('id, workflow_id, status')
          .in('status', ['pending', 'running']),
      ])
      return {
        workflows: (workflows.data ?? []) as any[],
        daily,
        queueStats: (queue.data ?? []) as any[],
      }
    },
  }),

  /** Process overview for one workflow (definition, runs, live queue, originators, agent runs). */
  'reports.workflowOverview': defineRead({
    args: z.object({ id }),
    perm: PERM,
    run: async (ctx, { id }) => workflowOverview(ctx, id),
  }),

  'reports.workflowOptions': defineRead({
    args: NO_ARGS,
    perm: PERM,
    run: async (ctx) => {
      const { data } = await (getDb(ctx) as any).from('workflows').select('id, name').order('name')
      return (data ?? []) as any[]
    },
  }),

  /** Side-by-side compare of two workflows over runs since `since` (newest 5000). */
  'reports.workflowCompare': defineRead({
    args: z.object({ a: id, b: id, since: isoDate }),
    perm: PERM,
    run: async (ctx, { a, b, since }) => {
      const db = getDb(ctx) as any
      const ids = [a, b]
      const [{ data: workflows }, runs, { data: queueStats }, nodeVisits] = await Promise.all([
        db.from('workflows')
          .select('id, name, description, trigger_type, is_active, user_variables, nodes, edges')
          .in('id', ids),
        // As before, a failed aggregate shows as no runs rather than an error.
        orEmpty(() => analytics.runSummaries(ctx, { workflowIds: ids, since, limit: 5000 })),
        db.from('workflow_queue')
          .select('id, workflow_id, status')
          .in('workflow_id', ids)
          .in('status', ['pending', 'running']),
        orEmpty(() => analytics.nodeVisitStats(ctx, { workflowIds: ids, since, limit: 5000 })),
      ])
      const visitsFor = (workflowId: string): Record<string, number> => Object.fromEntries(
        nodeVisits.filter((row) => row.workflow_id === workflowId).map((row) => [row.node_id, Number(row.visits)]),
      )
      return {
        workflowA: (((workflows ?? []) as any[]).find((w) => w.id === a) ?? null) as any,
        workflowB: (((workflows ?? []) as any[]).find((w) => w.id === b) ?? null) as any,
        runsA: runs.filter((run) => run.workflow_id === a) as any[],
        runsB: runs.filter((run) => run.workflow_id === b) as any[],
        queueA: ((queueStats ?? []) as any[]).filter((row) => row.workflow_id === a),
        queueB: ((queueStats ?? []) as any[]).filter((row) => row.workflow_id === b),
        visitsA: visitsFor(a),
        visitsB: visitsFor(b),
      }
    },
  }),
} satisfies Record<string, UiRead<any, any>>
