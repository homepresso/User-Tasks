/**
 * Workflow run management: pause / resume / cancel and "go to" (resume at a
 * chosen node). One implementation behind the queue UI
 * (app/api/workflows/manage), POST /api/v1/workflows/runs/{id}/action and
 * the MCP workflows_run_action tool, which used to drift apart (the UI route
 * had no permission check; MCP resume was a no-op and MCP cancel left the
 * pause state behind).
 *
 * Rules: `workflows.activate`; the run must belong to ctx.tenantId (and the
 * credential's workflow allowlist); every action is audited.
 *  - pause: status → paused, pause state (event_id, paused_node_id,
 *    pause_variables) kept so resume can restore it. Finished runs refused.
 *  - resume: a paused run that was waiting on an event goes back to
 *    waiting_for_event (its task/timer resumes it as usual). Otherwise the
 *    engine resumes it now (resumeWorkflow) with the given return variables.
 *  - goto: resume at `gotoNodeId` of the run's own version — also from a
 *    paused-while-waiting run (that path used to ignore the target node).
 *  - cancel: status → failed / "Manually cancelled", pause state cleared.
 *    Finished runs refused.
 * Resume/goto/cancel close the run's open user task(s) for the event it was
 * waiting on — once the run has moved on, completing them can never resume
 * it (the event id is gone), so they would linger as orphans.
 */

import { requirePerm, ServiceError, type ServiceContext } from './context'
import { audit, dbError } from './_shared'
import { RunNotResumableError } from '@/lib/workflow-run-errors'

/* eslint-disable @typescript-eslint/no-explicit-any -- workflow_runs rows are untyped here */

export type WorkflowRunAction = 'pause' | 'resume' | 'cancel'

export interface WorkflowRunRef {
  runId?: string | null
  /** Queue UI only: look the run up by the event it waits on. */
  eventId?: string | null
}

export interface WorkflowRunActionInput {
  action: WorkflowRunAction
  /** Resume: variables handed back to the run (override its saved variables). */
  variables?: Record<string, unknown> | null
  /** Resume: continue at this node of the run's version instead of the paused one. */
  gotoNodeId?: string | null
}

export type WorkflowRunActionResult =
  | { action: 'paused'; run_id: string; previous_status: string }
  | { action: 'unpaused'; run_id: string; status: 'waiting_for_event' }
  | { action: 'resumed'; run_id: string; status: string; goto_node_id?: string; closed_task_ids: string[] }
  | { action: 'cancelled'; run_id: string; closed_task_ids: string[] }

export const CANCELLED_RUN_ERROR = 'Manually cancelled'

const FINISHED = new Set(['completed', 'failed', 'cancelled', 'canceled'])
const RESUMABLE = ['waiting_for_event', 'paused']
const OPEN_TASK_STATUSES = ['draft', 'todo', 'in_progress', 'blocked']
const RUN_COLUMNS = 'id, status, event_id, paused_node_id, workflow_id, version_id'

const RESUME_NOTES: Record<ServiceContext['source'], string> = {
  ui: 'Manually resumed from queue',
  api: 'Resumed via API',
  mcp: 'Resumed via MCP',
  job: 'Resumed from queue (bulk)',
}

function requireWorkflowScope(ctx: ServiceContext, workflowId: string | null) {
  const allow = ctx.resourceScopes?.workflow_ids
  if (allow?.length && (!workflowId || !allow.includes(workflowId))) {
    throw ServiceError.forbidden('This API key is not allowed to access that workflow')
  }
}

async function loadRun(ctx: ServiceContext, ref: WorkflowRunRef) {
  if (!ref.runId && !ref.eventId) throw ServiceError.validation('run_id or event_id required')
  let query = (ctx.supabase as any).from('workflow_runs').select(RUN_COLUMNS).eq('tenant_id', ctx.tenantId)
  query = ref.runId ? query.eq('id', ref.runId) : query.eq('event_id', ref.eventId)
  const { data, error } = await query.maybeSingle()
  if (error && error.code !== 'PGRST116' && !/invalid input syntax/i.test(error.message ?? '')) throw dbError(error)
  if (!data) throw ServiceError.notFound('Run not found')
  requireWorkflowScope(ctx, data.workflow_id ?? null)
  return data as { id: string; status: string; event_id: string | null; paused_node_id: string | null; workflow_id: string | null; version_id: string | null }
}

/** Node ids of the definition the run executes (its version, else the draft for pre-versioning runs). */
async function runNodeIds(ctx: ServiceContext, run: { workflow_id: string | null; version_id: string | null }): Promise<Set<string>> {
  const { data } = run.version_id
    ? await (ctx.supabase as any).from('workflow_versions').select('nodes').eq('id', run.version_id).eq('tenant_id', ctx.tenantId).maybeSingle()
    : await (ctx.supabase as any).from('workflows').select('nodes').eq('id', run.workflow_id).eq('tenant_id', ctx.tenantId).maybeSingle()
  const nodes = Array.isArray(data?.nodes) ? data.nodes : []
  return new Set(nodes.map((n: any) => String(n?.id ?? '')).filter(Boolean))
}

/** Cancel the open tasks waiting on `eventId` (the tasks trigger logs the lifecycle event). */
async function closeOpenTasks(ctx: ServiceContext, eventId: string | null): Promise<string[]> {
  if (!eventId) return []
  const { data, error } = await (ctx.supabase as any).from('tasks')
    .update({ status: 'cancelled' })
    .eq('tenant_id', ctx.tenantId)
    .eq('event_id', eventId)
    .in('status', OPEN_TASK_STATUSES)
    .select('id')
  if (error) {
    console.error('[workflow-runs] closing open tasks failed:', error.message)
    return []
  }
  return ((data ?? []) as Array<{ id: string }>).map((t) => String(t.id))
}

function auditRun(ctx: ServiceContext, run: { id: string; workflow_id: string | null }, summary: string, metadata: Record<string, unknown>) {
  return audit(ctx, { objectType: 'workflow_run', objectId: run.id, action: 'update', summary, metadata: { workflow_id: run.workflow_id, ...metadata } })
}

export async function actOnWorkflowRun(ctx: ServiceContext, ref: WorkflowRunRef, input: WorkflowRunActionInput): Promise<WorkflowRunActionResult> {
  requirePerm(ctx, 'workflows.activate')
  const run = await loadRun(ctx, ref)
  const db = ctx.supabase as any

  switch (input.action) {
    case 'pause': {
      if (FINISHED.has(run.status)) throw ServiceError.validation('Cannot pause a finished workflow')
      // Pause state (event_id, paused_node_id, pause_variables) is kept so
      // resume can restore the run exactly.
      const { data, error } = await db.from('workflow_runs')
        .update({ status: 'paused', paused_at: new Date().toISOString() })
        .eq('id', run.id).eq('tenant_id', ctx.tenantId).eq('status', run.status)
        .select('id')
      if (error) throw dbError(error)
      if (!data?.length) throw ServiceError.conflict('The run changed state; reload and try again')
      await auditRun(ctx, run, 'Paused workflow run', { action: 'pause', previous_status: run.status })
      return { action: 'paused', run_id: run.id, previous_status: run.status }
    }

    case 'resume': {
      const gotoNodeId = input.gotoNodeId ? String(input.gotoNodeId) : null
      if (!RESUMABLE.includes(run.status)) {
        throw ServiceError.conflict(`Run is ${run.status}; only waiting or paused runs can be resumed`)
      }
      if (gotoNodeId && !(await runNodeIds(ctx, run)).has(gotoNodeId)) {
        throw ServiceError.validation(`Go To node ${gotoNodeId} not found in this run's workflow version`)
      }

      // Manually paused while waiting on a task/timer: restore the wait so the
      // normal resume path picks it up.
      if (!gotoNodeId && run.status === 'paused' && run.event_id && run.paused_node_id) {
        const { data, error } = await db.from('workflow_runs')
          .update({ status: 'waiting_for_event', paused_at: null })
          .eq('id', run.id).eq('tenant_id', ctx.tenantId).eq('status', 'paused')
          .select('id')
        if (error) throw dbError(error)
        if (!data?.length) throw ServiceError.conflict('The run changed state; reload and try again')
        await auditRun(ctx, run, 'Unpaused workflow run (waiting again)', { action: 'resume', previous_status: run.status })
        return { action: 'unpaused', run_id: run.id, status: 'waiting_for_event' }
      }

      const supplied = (input.variables ?? {}) as Record<string, unknown>
      const variables: Record<string, unknown> = {
        ...supplied,
        outcome: supplied.outcome ?? 'resumed',
        outcome_notes: supplied.outcome_notes ?? RESUME_NOTES[ctx.source],
      }
      if (gotoNodeId) variables._goto_node_id = gotoNodeId
      else delete variables._goto_node_id

      let result: { status: string }
      try {
        // Loaded lazily: pause/cancel (and schema scripts) don't need the engine.
        const { resumeWorkflow } = await import('@/lib/workflow-engine')
        // Claims the run only while it still waits on the event we looked at.
        result = await resumeWorkflow(run.id, variables, undefined, run.event_id ? { eventId: run.event_id } : undefined)
      } catch (error) {
        if (error instanceof RunNotResumableError) throw ServiceError.conflict('The run is no longer waiting or paused')
        throw new ServiceError('internal', `Resume failed: ${error instanceof Error ? error.message : String(error)}`)
      }
      const closed = await closeOpenTasks(ctx, run.event_id)
      await auditRun(ctx, run, gotoNodeId ? `Moved workflow run to node ${gotoNodeId}` : 'Resumed workflow run', {
        action: gotoNodeId ? 'goto' : 'resume', previous_status: run.status, status: result.status,
        ...(gotoNodeId ? { goto_node_id: gotoNodeId, paused_node_id: run.paused_node_id } : {}),
        closed_task_ids: closed,
      })
      return { action: 'resumed', run_id: run.id, status: result.status, ...(gotoNodeId ? { goto_node_id: gotoNodeId } : {}), closed_task_ids: closed }
    }

    case 'cancel': {
      if (FINISHED.has(run.status)) throw ServiceError.validation('Cannot cancel a finished workflow')
      const { data, error } = await db.from('workflow_runs')
        .update({
          status: 'failed',
          error: CANCELLED_RUN_ERROR,
          completed_at: new Date().toISOString(),
          event_id: null,
          paused_at: null,
          paused_node_id: null,
          pause_variables: null,
        })
        .eq('id', run.id).eq('tenant_id', ctx.tenantId).eq('status', run.status)
        .select('id')
      if (error) throw dbError(error)
      if (!data?.length) throw ServiceError.conflict('The run changed state; reload and try again')
      const closed = await closeOpenTasks(ctx, run.event_id)
      await auditRun(ctx, run, 'Cancelled workflow run', { action: 'cancel', previous_status: run.status, closed_task_ids: closed })
      return { action: 'cancelled', run_id: run.id, closed_task_ids: closed }
    }

    default:
      throw ServiceError.validation(`Unknown action: ${String((input as { action?: unknown }).action)}`)
  }
}

// ─── Live instances and migration between versions ───
//
// A live instance is a run waiting on an event or paused. Migrating one to
// another version closes it out (status `migrated`, its open task cancelled,
// its queued resumes killed) and starts a new run on the target version at a
// chosen node, carrying its variables, trace, task and SLA — all in the
// migrate_workflow_instance RPC (atomic and conditional on the run still
// waiting on the same event/version), then the engine's go-to resume starts
// the new run at its node (a User Task there creates a fresh task).
// Listing needs workflows.view_runs; planning and migrating need
// workflows.manage_runs.

export const LIVE_RUN_STATUSES = ['waiting_for_event', 'paused'] as const
export const MIGRATION_CAP = 500

const LIVE_RUN_COLUMNS = 'id, workflow_id, version_id, status, event_id, paused_node_id, paused_at, started_at, title, task_id, trace_id, pause_variables'

interface LiveRunRow {
  id: string
  workflow_id: string
  version_id: string | null
  status: string
  event_id: string | null
  paused_node_id: string | null
  paused_at: string | null
  started_at: string | null
  title: string | null
  task_id: string | null
  trace_id: string | null
  pause_variables: Record<string, unknown> | null
}

interface GraphNode { id: string; type: string; label?: string; config?: Record<string, any> }
interface Graph { nodes: GraphNode[]; edges: Array<{ source: string; target: string }>; user_variables: any[] }

async function loadOwnedWorkflow(ctx: ServiceContext, workflowId: string) {
  requireWorkflowScope(ctx, workflowId)
  const { data, error } = await (ctx.supabase as any).from('workflows')
    .select('id, name, published_version_id, nodes, edges, user_variables')
    .eq('id', workflowId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error && !/invalid input syntax/i.test(error.message ?? '')) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workflow not found')
  return data as { id: string; name: string; published_version_id: string | null; nodes: any; edges: any; user_variables: any }
}

function asGraph(row: { nodes?: unknown; edges?: unknown; user_variables?: unknown } | null | undefined): Graph {
  return {
    nodes: Array.isArray(row?.nodes) ? (row!.nodes as GraphNode[]).filter((n) => n && n.id) : [],
    edges: Array.isArray(row?.edges) ? (row!.edges as Graph['edges']) : [],
    user_variables: Array.isArray(row?.user_variables) ? (row!.user_variables as any[]) : [],
  }
}

/** Definitions of the given versions (null = the draft, for runs started before versioning / test runs). */
async function loadGraphs(ctx: ServiceContext, workflow: { id: string; nodes: any; edges: any; user_variables: any }, versionIds: Array<string | null>) {
  const graphs = new Map<string | null, Graph & { version_number: number | null }>()
  const ids = [...new Set(versionIds.filter((v): v is string => !!v))]
  if (ids.length) {
    const { data, error } = await (ctx.supabase as any).from('workflow_versions')
      .select('id, version_number, nodes, edges, user_variables')
      .eq('workflow_id', workflow.id).eq('tenant_id', ctx.tenantId).in('id', ids)
    if (error) throw dbError(error)
    for (const v of (data ?? []) as any[]) graphs.set(v.id, { ...asGraph(v), version_number: v.version_number ?? null })
  }
  if (versionIds.includes(null)) graphs.set(null, { ...asGraph(workflow), version_number: null })
  return graphs
}

interface OpenTaskRow { id: string; title: string | null; status: string; event_id: string; assignee_id: string | null; assigned_team_id: string | null; created_at: string | null }

async function loadOpenTasks(ctx: ServiceContext, eventIds: string[]): Promise<Map<string, OpenTaskRow[]>> {
  const byEvent = new Map<string, OpenTaskRow[]>()
  if (!eventIds.length) return byEvent
  const { data, error } = await (ctx.supabase as any).from('tasks')
    .select('id, title, status, event_id, assignee_id, assigned_team_id, created_at')
    .eq('tenant_id', ctx.tenantId).in('event_id', eventIds).in('status', OPEN_TASK_STATUSES)
  if (error) throw dbError(error)
  for (const t of (data ?? []) as OpenTaskRow[]) byEvent.set(t.event_id, [...(byEvent.get(t.event_id) ?? []), t])
  return byEvent
}

/** Pending delay_resume / task_resume jobs of the workflow, by run id. */
async function loadQueuedResumes(ctx: ServiceContext, workflowId: string): Promise<Map<string, Array<{ id: string; trigger_type: string }>>> {
  const byRun = new Map<string, Array<{ id: string; trigger_type: string }>>()
  const { data, error } = await (ctx.supabase as any).from('workflow_queue')
    .select('id, trigger_type, trigger_data')
    .eq('tenant_id', ctx.tenantId).eq('workflow_id', workflowId).eq('status', 'pending')
    .in('trigger_type', ['delay_resume', 'task_resume'])
  if (error) throw dbError(error)
  for (const job of (data ?? []) as any[]) {
    const runId = job.trigger_type === 'delay_resume' ? job.trigger_data?._resume_run_id : job.trigger_data?._task_resume?.run_id
    if (typeof runId !== 'string') continue
    byRun.set(runId, [...(byRun.get(runId) ?? []), { id: String(job.id), trigger_type: job.trigger_type }])
  }
  return byRun
}

/** Live instance counts per version of the workflow (null key = no version). */
export async function liveInstanceCounts(ctx: ServiceContext, workflowId: string): Promise<Map<string | null, number>> {
  const { data, error } = await (ctx.supabase as any).rpc('workflow_live_instance_counts', { p_tenant_id: ctx.tenantId, p_workflow_id: workflowId })
  if (error) throw dbError(error)
  return new Map(((data ?? []) as Array<{ version_id: string | null; instances: number }>).map((r) => [r.version_id ?? null, Number(r.instances) || 0]))
}

export interface LiveInstance {
  run_id: string
  workflow_id: string
  status: string
  title: string | null
  version_id: string | null
  version_number: number | null
  current_node_id: string | null
  current_node_label: string | null
  current_node_type: string | null
  waiting_since: string | null
  started_at: string | null
  task_id: string | null
  trace_id: string | null
  open_task: { id: string; title: string | null; status: string; assignee_id: string | null; assignee_name: string | null; team_id: string | null; team_name: string | null } | null
}

export interface ListLiveInstancesInput {
  status?: 'active' | 'waiting_for_event' | 'paused' | null
  versionId?: string | null
  limit?: number | null
  offset?: number | null
}

/** Live (waiting / paused) runs of a workflow with their current node and open task, plus counts per version. */
export async function listLiveInstances(ctx: ServiceContext, workflowId: string, input: ListLiveInstancesInput = {}) {
  requirePerm(ctx, 'workflows.view_runs')
  const workflow = await loadOwnedWorkflow(ctx, workflowId)
  const statuses = !input.status || input.status === 'active' ? [...LIVE_RUN_STATUSES] : [input.status]
  const limit = Math.min(Math.max(input.limit ?? 50, 1), MIGRATION_CAP)
  const offset = Math.max(input.offset ?? 0, 0)

  let query = (ctx.supabase as any).from('workflow_runs')
    .select(LIVE_RUN_COLUMNS, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId).eq('workflow_id', workflowId).in('status', statuses)
    .order('started_at', { ascending: true })
  if (input.versionId) query = query.eq('version_id', input.versionId)
  query = offset > 0 ? query.range(offset, offset + limit - 1) : query.limit(limit)
  const [{ data, count, error }, counts] = await Promise.all([query, liveInstanceCounts(ctx, workflowId)])
  if (error) throw dbError(error)
  const runs = (data ?? []) as LiveRunRow[]

  const graphs = await loadGraphs(ctx, workflow, [...new Set([...runs.map((r) => r.version_id), ...counts.keys()])])
  const tasks = await loadOpenTasks(ctx, runs.map((r) => r.event_id).filter((e): e is string => !!e))
  const allTasks = [...tasks.values()].flat()
  const userIds = [...new Set(allTasks.map((t) => t.assignee_id).filter((v): v is string => !!v))]
  const teamIds = [...new Set(allTasks.map((t) => t.assigned_team_id).filter((v): v is string => !!v))]
  const [users, teams] = await Promise.all([
    userIds.length ? (ctx.supabase as any).from('users').select('id, display_name, email').eq('tenant_id', ctx.tenantId).in('id', userIds) : { data: [] },
    teamIds.length ? (ctx.supabase as any).from('teams').select('id, name').eq('tenant_id', ctx.tenantId).in('id', teamIds) : { data: [] },
  ])
  const userName = new Map(((users.data ?? []) as any[]).map((u) => [u.id, u.display_name || u.email || null]))
  const teamName = new Map(((teams.data ?? []) as any[]).map((t) => [t.id, t.name ?? null]))

  const instances: LiveInstance[] = runs.map((run) => {
    const graph = graphs.get(run.version_id ?? null)
    const node = run.paused_node_id ? graph?.nodes.find((n) => n.id === run.paused_node_id) : undefined
    const task = run.event_id ? tasks.get(run.event_id)?.[0] : undefined
    return {
      run_id: run.id,
      workflow_id: run.workflow_id,
      status: run.status,
      title: run.title,
      version_id: run.version_id,
      version_number: graph?.version_number ?? null,
      current_node_id: run.paused_node_id,
      current_node_label: node?.label ?? null,
      current_node_type: node?.type ?? null,
      waiting_since: run.paused_at,
      started_at: run.started_at,
      task_id: run.task_id,
      trace_id: run.trace_id,
      open_task: task ? {
        id: task.id, title: task.title, status: task.status,
        assignee_id: task.assignee_id, assignee_name: task.assignee_id ? userName.get(task.assignee_id) ?? null : null,
        team_id: task.assigned_team_id, team_name: task.assigned_team_id ? teamName.get(task.assigned_team_id) ?? null : null,
      } : null,
    }
  })

  const versions = [...counts.entries()]
    .map(([versionId, instances]) => ({
      version_id: versionId,
      version_number: graphs.get(versionId)?.version_number ?? null,
      is_published: !!versionId && versionId === workflow.published_version_id,
      instances,
    }))
    .sort((a, b) => (b.version_number ?? -1) - (a.version_number ?? -1))
  const onOlderVersions = versions.filter((v) => !v.is_published).reduce((sum, v) => sum + v.instances, 0)

  return {
    instances,
    total: (count ?? instances.length) as number,
    published_version_id: workflow.published_version_id,
    versions,
    on_older_versions: onOlderVersions,
  }
}

export interface InstanceMigrationInput {
  workflowId: string
  toVersionId: string
  /** Explicit runs (at most MIGRATION_CAP). */
  runIds?: string[] | null
  /** Every live run on this version (combine with allActive or alone). */
  fromVersionId?: string | null
  /** Every live run of the workflow not already on the target version. */
  allActive?: boolean | null
  /** Source node id → target node id. */
  nodeMap?: Record<string, string> | null
  /** Target for instances whose node is not in nodeMap (else: the node with the same id). */
  defaultTargetNodeId?: string | null
}

export interface MigrationPlanItem {
  run_id: string
  title: string | null
  status: string | null
  ok: boolean
  blocked_reason: string | null
  warnings: string[]
  from_version_id: string | null
  from_version_number: number | null
  source_node_id: string | null
  source_node_label: string | null
  target_node_id: string | null
  target_node_label: string | null
  target_node_type: string | null
  target_via: 'map' | 'default' | 'same_id' | null
  /** What happens to the old instance. */
  close: { status: 'migrated'; open_task_ids: string[]; queued_job_ids: string[] }
  /** What the new instance gets. */
  create: { version_id: string; start_node_id: string | null; creates_task: boolean; carried_variables: number; defaulted_variables: string[] }
}

export interface MigrationPlan {
  workflow_id: string
  to_version: { id: string; version_number: number | null }
  items: MigrationPlanItem[]
  summary: { total: number; ready: number; blocked: number; with_warnings: number }
  /** More live instances match than one request handles (MIGRATION_CAP): run again for the rest. */
  truncated: boolean
}

interface PreparedPlan {
  plan: MigrationPlan
  runs: Map<string, LiveRunRow>
  defaults: Record<string, unknown>
}

async function preparePlan(ctx: ServiceContext, input: InstanceMigrationInput): Promise<PreparedPlan> {
  requirePerm(ctx, 'workflows.manage_runs')
  if (!input.toVersionId) throw ServiceError.validation('to_version_id is required')
  const runIds = input.runIds ? [...new Set(input.runIds.map(String).filter(Boolean))] : null
  if (!runIds?.length && !input.fromVersionId && !input.allActive) {
    throw ServiceError.validation('Choose the instances: run_ids, from_version_id or all_active')
  }
  if (runIds && runIds.length > MIGRATION_CAP) throw ServiceError.validation(`At most ${MIGRATION_CAP} runs per request`)

  const workflow = await loadOwnedWorkflow(ctx, input.workflowId)
  const { data: target, error: targetError } = await (ctx.supabase as any).from('workflow_versions')
    .select('id, version_number, nodes, edges, user_variables')
    .eq('id', input.toVersionId).eq('workflow_id', workflow.id).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (targetError && !/invalid input syntax/i.test(targetError.message ?? '')) throw dbError(targetError)
  if (!target) throw ServiceError.notFound('Target version not found for this workflow')
  const targetGraph = asGraph(target)
  const targetNodes = new Map(targetGraph.nodes.map((n) => [n.id, n]))
  const { isTriggerNodeType, missingVariables, resolveTargetNode, userVariableDefaults } = await import('@/lib/workflow-migration')
  const defaults = userVariableDefaults(targetGraph.user_variables)

  let query = (ctx.supabase as any).from('workflow_runs').select(LIVE_RUN_COLUMNS)
    .eq('tenant_id', ctx.tenantId).eq('workflow_id', workflow.id)
  if (runIds?.length) {
    query = query.in('id', runIds)
  } else {
    query = query.in('status', [...LIVE_RUN_STATUSES]).neq('version_id', input.toVersionId)
    if (input.fromVersionId) query = query.eq('version_id', input.fromVersionId)
    query = query.order('started_at', { ascending: true }).limit(MIGRATION_CAP + 1)
  }
  const { data, error } = await query
  if (error && !/invalid input syntax/i.test(error.message ?? '')) throw dbError(error)
  let rows = (data ?? []) as LiveRunRow[]
  // .neq() drops runs without a version (pre-versioning / test runs); all_active includes them.
  if (!runIds?.length && !input.fromVersionId) {
    const { data: unversioned } = await (ctx.supabase as any).from('workflow_runs').select(LIVE_RUN_COLUMNS)
      .eq('tenant_id', ctx.tenantId).eq('workflow_id', workflow.id).in('status', [...LIVE_RUN_STATUSES]).is('version_id', null)
      .order('started_at', { ascending: true }).limit(MIGRATION_CAP + 1)
    const seen = new Set(rows.map((r) => r.id))
    rows = [...rows, ...((unversioned ?? []) as LiveRunRow[]).filter((r) => !seen.has(r.id))]
  }
  const truncated = !runIds?.length && rows.length > MIGRATION_CAP
  rows = rows.slice(0, MIGRATION_CAP)
  const runs = new Map(rows.map((r) => [r.id, r]))

  const [graphs, tasks, jobs] = await Promise.all([
    loadGraphs(ctx, workflow, rows.map((r) => r.version_id)),
    loadOpenTasks(ctx, rows.map((r) => r.event_id).filter((e): e is string => !!e)),
    loadQueuedResumes(ctx, workflow.id),
  ])

  const ordered = runIds?.length ? runIds : rows.map((r) => r.id)
  const items: MigrationPlanItem[] = ordered.map((runId) => {
    const run = runs.get(runId)
    const blank = (reason: string): MigrationPlanItem => ({
      run_id: runId, title: run?.title ?? null, status: run?.status ?? null, ok: false, blocked_reason: reason, warnings: [],
      from_version_id: run?.version_id ?? null, from_version_number: run ? graphs.get(run.version_id ?? null)?.version_number ?? null : null,
      source_node_id: run?.paused_node_id ?? null, source_node_label: null,
      target_node_id: null, target_node_label: null, target_node_type: null, target_via: null,
      close: { status: 'migrated', open_task_ids: [], queued_job_ids: [] },
      create: { version_id: target.id, start_node_id: null, creates_task: false, carried_variables: 0, defaulted_variables: [] },
    })
    if (!run) return blank('Run not found in this workflow')
    const sourceGraph = graphs.get(run.version_id ?? null)
    const sourceNode = run.paused_node_id ? sourceGraph?.nodes.find((n) => n.id === run.paused_node_id) : undefined
    const item = blank('')
    item.source_node_label = sourceNode?.label ?? null
    item.close.open_task_ids = run.event_id ? (tasks.get(run.event_id) ?? []).map((t) => t.id) : []
    const queued = jobs.get(run.id) ?? []
    item.close.queued_job_ids = queued.map((j) => j.id)

    if (!(LIVE_RUN_STATUSES as readonly string[]).includes(run.status)) {
      item.blocked_reason = `Run is ${run.status}; only waiting or paused runs can be migrated`
      return item
    }
    if (run.version_id === target.id) {
      item.blocked_reason = 'Already on the target version (use Go To to move it within its version)'
      return item
    }
    const resolved = resolveTargetNode(run.paused_node_id, { nodeMap: input.nodeMap, defaultTargetNodeId: input.defaultTargetNodeId, targetNodeIds: new Set(targetNodes.keys()) })
    item.target_via = resolved.via
    if (!resolved.nodeId) {
      item.blocked_reason = run.paused_node_id
        ? `Node "${sourceNode?.label ?? run.paused_node_id}" does not exist in v${target.version_number}; choose a target node`
        : 'The run has no current node; choose a target node'
      return item
    }
    const targetNode = targetNodes.get(resolved.nodeId)
    item.target_node_id = resolved.nodeId
    if (!targetNode) {
      item.blocked_reason = `Target node ${resolved.nodeId} does not exist in v${target.version_number}`
      return item
    }
    item.target_node_label = targetNode.label ?? null
    item.target_node_type = targetNode.type
    if (isTriggerNodeType(targetNode.type) || targetNode.type === 'section_group') {
      item.blocked_reason = `"${targetNode.label ?? targetNode.id}" is a ${targetNode.type === 'section_group' ? 'section' : 'trigger'}; choose a step`
      return item
    }

    const carried = run.pause_variables ?? {}
    item.create = {
      version_id: target.id,
      start_node_id: targetNode.id,
      creates_task: targetNode.type === 'user_task',
      carried_variables: Object.keys(carried).length,
      defaulted_variables: Object.keys(defaults).filter((name) => !(name in carried)),
    }
    for (const missing of missingVariables({ nodes: targetGraph.nodes, edges: targetGraph.edges, startNodeId: targetNode.id, available: [...Object.keys(carried), ...Object.keys(defaults)] })) {
      item.warnings.push(`Variable "${missing.name}" is used by ${missing.nodes.slice(0, 3).join(', ')} but this instance does not have it`)
    }
    if (queued.some((j) => j.trigger_type === 'task_resume')) {
      item.warnings.push('Its task was already completed and a resume is queued; migrating discards that resume')
    }
    if (queued.some((j) => j.trigger_type === 'delay_resume')) {
      item.warnings.push('It is in a timed wait; the remaining delay is not carried over')
    }
    if (item.close.open_task_ids.length) {
      item.warnings.push(`${item.close.open_task_ids.length} open task${item.close.open_task_ids.length === 1 ? '' : 's'} will be cancelled`)
    }
    item.ok = true
    item.blocked_reason = null
    return item
  })

  const ready = items.filter((i) => i.ok).length
  return {
    plan: {
      workflow_id: workflow.id,
      to_version: { id: target.id, version_number: target.version_number ?? null },
      items,
      summary: { total: items.length, ready, blocked: items.length - ready, with_warnings: items.filter((i) => i.ok && i.warnings.length).length },
      truncated,
    },
    runs,
    defaults,
  }
}

/** Dry run: what migrating the chosen instances would do, per instance. Changes nothing. */
export async function planInstanceMigration(ctx: ServiceContext, input: InstanceMigrationInput): Promise<MigrationPlan> {
  return (await preparePlan(ctx, input)).plan
}

export interface MigrationResult {
  run_id: string
  ok: boolean
  /** The run changed state since the plan (resumed, cancelled, moved on): nothing was changed. */
  conflict?: boolean
  error?: string
  new_run_id?: string
  /** The new run's status after starting at its node (waiting_for_event at a User Task, completed, failed…). */
  new_status?: string
  target_node_id?: string
  closed_task_ids?: string[]
  cancelled_job_ids?: string[]
}

export interface MigrationOutcome {
  dry_run: boolean
  plan: MigrationPlan
  results: MigrationResult[]
  summary: { migrated: number; skipped: number; failed: number }
}

/**
 * Migrate the chosen instances (or only plan them with dryRun). Per-instance
 * results: blocked instances are skipped, a run that changed meanwhile is a
 * conflict, the rest are migrated one by one.
 */
export async function migrateInstances(ctx: ServiceContext, input: InstanceMigrationInput & { dryRun?: boolean | null }): Promise<MigrationOutcome> {
  const { plan, runs, defaults } = await preparePlan(ctx, input)
  if (input.dryRun) {
    return { dry_run: true, plan, results: [], summary: { migrated: 0, skipped: plan.summary.blocked, failed: 0 } }
  }

  const results: MigrationResult[] = []
  for (const item of plan.items) {
    const run = runs.get(item.run_id)
    if (!item.ok || !run || !item.target_node_id) {
      results.push({ run_id: item.run_id, ok: false, error: item.blocked_reason ?? 'Not migratable' })
      continue
    }
    const { data, error } = await (ctx.supabase as any).rpc('migrate_workflow_instance', {
      p_tenant_id: ctx.tenantId,
      p_run_id: run.id,
      p_expected_event_id: run.event_id,
      p_from_version_id: run.version_id,
      p_to_version_id: plan.to_version.id,
      p_target_node_id: item.target_node_id,
      p_variable_defaults: defaults,
      p_trace: { via: ctx.source, actor_id: ctx.actorId },
    })
    if (error) {
      results.push({ run_id: run.id, ok: false, error: `Migration failed: ${error.message}` })
      continue
    }
    const outcome = (data ?? {}) as { ok?: boolean; conflict?: boolean; reason?: string; new_run_id?: string; closed_task_ids?: string[]; cancelled_job_ids?: string[] }
    if (!outcome.ok || !outcome.new_run_id) {
      results.push({ run_id: run.id, ok: false, conflict: !!outcome.conflict, error: outcome.reason ?? 'The run changed state; reload and try again' })
      continue
    }

    const newRunId = String(outcome.new_run_id)
    let newStatus = 'paused'
    let startError: string | undefined
    try {
      const { resumeWorkflow } = await import('@/lib/workflow-engine')
      const started = await resumeWorkflow(newRunId, { _goto_node_id: item.target_node_id }, undefined, { migrated: true })
      newStatus = started.status
      if (started.error) startError = started.error
    } catch (e) {
      // The old run is closed either way; the new one stays paused at its
      // node (resume it with Go To) or was failed by the engine.
      startError = e instanceof Error ? e.message : String(e)
    }

    const closed = (outcome.closed_task_ids ?? []).map(String)
    const killed = (outcome.cancelled_job_ids ?? []).map(String)
    const meta = {
      action: 'migrate', from_run_id: run.id, to_run_id: newRunId,
      from_version_id: run.version_id, to_version_id: plan.to_version.id,
      source_node_id: run.paused_node_id, target_node_id: item.target_node_id,
    }
    await auditRun(ctx, run, `Migrated workflow run to v${plan.to_version.version_number ?? '?'} (run ${newRunId})`, {
      ...meta, previous_status: run.status, closed_task_ids: closed, cancelled_job_ids: killed,
    })
    await auditRun(ctx, { id: newRunId, workflow_id: run.workflow_id }, `Created by migrating run ${run.id}`, { ...meta, status: newStatus })
    results.push({
      run_id: run.id, ok: true, new_run_id: newRunId, new_status: newStatus, target_node_id: item.target_node_id,
      closed_task_ids: closed, cancelled_job_ids: killed, ...(startError ? { error: `Started with an error: ${startError}` } : {}),
    })
  }

  const migrated = results.filter((r) => r.ok).length
  return {
    dry_run: false,
    plan,
    results,
    summary: { migrated, skipped: plan.items.filter((i) => !i.ok).length, failed: results.filter((r) => !r.ok).length - plan.items.filter((i) => !i.ok).length },
  }
}
