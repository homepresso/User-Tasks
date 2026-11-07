/**
 * The Task completed screen on the server (lib/tasks/completion-screen.ts
 * has the model and the wording):
 *
 *  - the workspace setting, tenants.settings.tasks.completion_screen (any
 *    member reads it — every task page needs it; settings.edit changes it,
 *    audited). REST GET / PATCH /workspace/task-completion, MCP
 *    task_completion_settings_get / _update, `usertasks task-completion`.
 *  - what happens next after a task is actioned: the run's state and the
 *    tasks it created (the Home run-progress reads: workflow_runs,
 *    tasks.workflow_run_id, loadRunStages). Names and step labels only,
 *    never data. Returned by the completion responses (REST / MCP) and
 *    GET /tasks/{id}/next.
 *  - the next task: the caller's next open task by the Home "My tasks"
 *    order (soonest due first).
 *
 * Access: the next step is for people involved in the task (its assignee,
 * a collaborator, whoever actioned it) or tasks.view_all; the run itself
 * follows can_view_run_progress (or workflows.view_runs). Someone who may
 * act on the task but not see the run (a manager acting on behalf) gets
 * `unknown`: the screen then shows a neutral line.
 */

import { audit, dbError, serviceRoleClient } from './_shared'
import { getDb, hasPerm, requirePerm, ServiceError, type AnySupabaseClient, type ServiceContext } from './context'
import { isLiveRunStatus } from '@/lib/home/progress'
import {
  NO_NEXT_STEP, parseTaskCompletionSettings, pickNextTask, taskCompletionFromTenantSettings, taskCompletionInputProblem,
  type TaskCompletionSettings, type TaskNextStep,
} from '@/lib/tasks/completion-screen'

/* eslint-disable @typescript-eslint/no-explicit-any -- tenants.settings / run rows are untyped JSON */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/* ── The workspace setting ───────────────────────────────────────────── */

export async function readTaskCompletionSettings(db: AnySupabaseClient, tenantId: string): Promise<TaskCompletionSettings> {
  try {
    const { data, error } = await (db as any).from('tenants').select('settings').eq('id', tenantId).maybeSingle()
    if (error) return parseTaskCompletionSettings(null)
    return taskCompletionFromTenantSettings(data?.settings)
  } catch {
    return parseTaskCompletionSettings(null)
  }
}

/** The workspace's Task completed screen settings (any member). */
export async function getTaskCompletionSettings(ctx: ServiceContext): Promise<TaskCompletionSettings> {
  return readTaskCompletionSettings(await serviceRoleClient(ctx), ctx.tenantId)
}

/** Change some of the settings (settings.edit); the rest, and other `settings` keys, are kept. Audited. */
export async function setTaskCompletionSettings(ctx: ServiceContext, input: Partial<Record<keyof TaskCompletionSettings, unknown>>): Promise<TaskCompletionSettings> {
  requirePerm(ctx, 'settings.edit')
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const problem = taskCompletionInputProblem(raw)
  if (problem) throw ServiceError.validation(problem)
  const db = await serviceRoleClient(ctx)
  const { data, error } = await (db as any).from('tenants').select('id, settings').eq('id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Workspace not found')
  const settings = data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings) ? { ...data.settings } : {}
  const before = taskCompletionFromTenantSettings(settings)
  const patch = Object.fromEntries(Object.entries(raw).filter(([key, value]) => value !== undefined && key in before))
  const next = parseTaskCompletionSettings({ ...before, ...patch })
  const tasks = settings.tasks && typeof settings.tasks === 'object' && !Array.isArray(settings.tasks) ? { ...settings.tasks } : {}
  tasks.completion_screen = next
  settings.tasks = tasks
  const { error: updateError } = await (db as any).from('tenants').update({ settings }).eq('id', ctx.tenantId)
  if (updateError) throw dbError(updateError)
  const changed = (Object.keys(next) as Array<keyof TaskCompletionSettings>).filter((k) => next[k] !== before[k])
  await audit(ctx, {
    objectType: 'workspace', objectId: ctx.tenantId, action: 'update',
    summary: changed.length ? `Changed the Task completed screen (${changed.join(', ')})` : 'Saved the Task completed screen (no change)',
    diff: { 'tasks.completion_screen': { before, after: next } },
  })
  return next
}

/* ── What happens next ───────────────────────────────────────────────── */

const TASK_COLUMNS = 'id, tenant_id, title, status, outcome, completed_at, available_outcomes, assignee_id, actioned_by, workflow_run_id, workflow_id, workflow_step_id, event_id'

/** The task, in this workspace, if the caller was involved in it (or may see every task) — else not found. */
async function involvedTask(ctx: ServiceContext, db: AnySupabaseClient, taskId: string): Promise<any> {
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const { data: task, error } = await (db as any).from('tasks').select(TASK_COLUMNS).eq('id', taskId).eq('tenant_id', ctx.tenantId).is('deleted_at', null).maybeSingle()
  if (error) throw dbError(error)
  if (!task) throw ServiceError.notFound('Task not found')
  if (hasPerm(ctx, 'tasks.view_all')) return task
  const me = ctx.actorId
  if (me && (task.assignee_id === me || task.actioned_by === me)) return task
  if (me) {
    const [{ data: collaborator }, { data: response }] = await Promise.all([
      (db as any).from('task_assignees').select('task_id').eq('task_id', taskId).eq('user_id', me).limit(1).maybeSingle(),
      (db as any).from('task_responses').select('task_id').eq('task_id', taskId).eq('user_id', me).limit(1).maybeSingle(),
    ])
    if (collaborator || response) return task
  }
  throw ServiceError.notFound('Task not found')
}

/** Which run view the caller may open: the full one (workflows.view_runs), the submitter-safe one, or neither. */
async function runViewFor(ctx: ServiceContext, db: AnySupabaseClient, runId: string): Promise<'full' | 'progress' | null> {
  if (hasPerm(ctx, 'workflows.view_runs')) return 'full'
  if (!ctx.actorId) return null
  const { data, error } = await (db as any).rpc('can_view_run_progress', { p_run_id: runId, p_user_id: ctx.actorId })
  if (error) throw dbError(error)
  return data === true ? 'progress' : null
}

/** Is a resume of this run still on the queue (not yet run)? */
async function resumeQueued(db: AnySupabaseClient, tenantId: string, runId: string): Promise<boolean> {
  const { data, error } = await (db as any).from('workflow_queue').select('id')
    .eq('tenant_id', tenantId).eq('trigger_type', 'task_resume').in('status', ['pending', 'processing'])
    .eq('trigger_data->_task_resume->>run_id', runId).limit(1)
  if (error) return false
  return ((data ?? []) as any[]).length > 0
}

/**
 * Where the task's run is now (after the task was actioned): who has it,
 * what it waits on, whether it finished — or `processing` while the resume
 * is still queued. See TaskNextStep (lib/tasks/completion-screen.ts).
 */
export async function getTaskNextStep(ctx: ServiceContext, taskId: string): Promise<TaskNextStep> {
  const db = await serviceRoleClient(ctx)
  const task = await involvedTask(ctx, db, taskId)
  return nextStepOf(ctx, db, task)
}

async function nextStepOf(ctx: ServiceContext, db: AnySupabaseClient, task: any): Promise<TaskNextStep> {
  // The run: by id, else (older tasks) by the event the run waited on.
  let runId: string | null = task.workflow_run_id ?? null
  if (!runId && task.event_id) {
    const { data } = await (db as any).from('workflow_runs').select('id').eq('tenant_id', ctx.tenantId).eq('event_id', task.event_id).limit(1).maybeSingle()
    runId = data?.id ?? null
  }
  if (!runId) return { ...NO_NEXT_STEP }
  const view = await runViewFor(ctx, db, runId)
  if (!view) return { state: 'unknown', run_id: null, steps: [], process: null, run_view: null }

  const { data: run, error } = await (db as any).from('workflow_runs')
    .select('id, workflow_id, version_id, status, started_at, paused_at, paused_node_id, event_id, waits:pause_variables->_parallel->waits')
    .eq('id', runId).eq('tenant_id', ctx.tenantId).maybeSingle()
  if (error) throw dbError(error)
  if (!run) return { state: 'unknown', run_id: null, steps: [], process: null, run_view: null }
  const { data: workflow } = await (db as any).from('workflows').select('name').eq('id', run.workflow_id).eq('tenant_id', ctx.tenantId).maybeSingle()
  const base = { run_id: run.id as string, process: { name: String(workflow?.name ?? 'Workflow') }, run_view: view }

  if (run.status === 'completed') return { ...base, state: 'complete', steps: [] }
  if (['failed', 'cancelled', 'canceled'].includes(run.status)) return { ...base, state: 'stopped', steps: [] }
  // Still on the queue, running, or paused where this task left it (the resume hasn't been picked up yet).
  const stale = task.status === 'completed' && run.event_id && run.event_id === task.event_id && run.paused_node_id && run.paused_node_id === task.workflow_step_id
  if (run.status === 'running' || stale || (await resumeQueued(db, ctx.tenantId, run.id))) return { ...base, state: 'processing', steps: [] }
  if (!isLiveRunStatus(run.status)) return { ...base, state: 'unknown', steps: [] }

  const { loadRunStages } = await import('./home')
  const stages = (await loadRunStages(db, ctx.tenantId, [{
    run_id: run.id, run_status: run.status, workflow_id: run.workflow_id, version_id: run.version_id, event_id: run.event_id,
    paused_node_id: run.paused_node_id, wait_node_ids: Array.isArray(run.waits) ? run.waits.map((w: any) => w?.node_id).filter(Boolean) : null,
    updated_at: run.paused_at ?? run.started_at,
  }])).get(run.id) ?? []
  const steps = stages.map((s) => ({ name: s.name, assignees: s.assignees.map((a) => a.name), team: s.team }))
  const withSomeone = stages.some((s) => s.assignees.length > 0 || s.team)
  return { ...base, state: withSomeone ? 'assigned' : 'waiting', steps }
}

/**
 * The next step, waiting briefly (bounded) while the queue processes the
 * resume: the REST / MCP completion responses use it so API callers get
 * "what happens next" too. Still `processing` after `timeoutMs`: ask
 * GET /tasks/{id}/next again.
 */
export async function waitForTaskNextStep(ctx: ServiceContext, taskId: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<TaskNextStep> {
  const timeout = Math.min(Math.max(options.timeoutMs ?? 3000, 0), 10_000)
  const interval = Math.max(options.intervalMs ?? 400, 50)
  const until = Date.now() + timeout
  let next = await getTaskNextStep(ctx, taskId)
  while (next.state === 'processing' && Date.now() + interval <= until) {
    await new Promise((resolve) => setTimeout(resolve, interval))
    next = await getTaskNextStep(ctx, taskId)
  }
  return next
}

/** For a completion response: the next step, or null when it can't be read (never fails the completion). */
export async function nextStepForResponse(ctx: ServiceContext, taskId: string): Promise<TaskNextStep | null> {
  try {
    return await waitForTaskNextStep(ctx, taskId)
  } catch {
    return null
  }
}

/* ── The next task and the screen's read ─────────────────────────────── */

export interface NextTaskRef { id: string; title: string; process: string | null; due_date: string | null }

/** The caller's next open task by the Home "My tasks" order (soonest due first), not this one. */
export async function getNextTask(ctx: ServiceContext, currentTaskId: string): Promise<NextTaskRef | null> {
  if (!ctx.actorId || !hasPerm(ctx, 'tasks.view_own')) return null
  const { listMyTasks } = await import('./home')
  const { tasks } = await listMyTasks(ctx, { sort: 'due' }, { limit: 2, offset: 0 })
  const next = pickNextTask(tasks, currentTaskId)
  return next ? { id: next.id, title: next.title, process: next.process?.name ?? null, due_date: next.due_date } : null
}

export interface TaskCompletedScreen {
  settings: TaskCompletionSettings
  task: { id: string; title: string; status: string; outcome: string | null; completed_at: string | null; available_outcomes: string[] }
  next: TaskNextStep
  next_task: NextTaskRef | null
  user: { name: string | null }
}

/** Everything the Task completed screen shows, for the person who just actioned the task. */
export async function getTaskCompletedScreen(ctx: ServiceContext, taskId: string): Promise<TaskCompletedScreen> {
  const db = await serviceRoleClient(ctx)
  const task = await involvedTask(ctx, db, taskId)
  const [settings, next, nextTask, profile] = await Promise.all([
    readTaskCompletionSettings(db, ctx.tenantId),
    nextStepOf(ctx, db, task),
    getNextTask(ctx, taskId),
    ctx.actorId ? (db as any).from('users').select('display_name, email').eq('id', ctx.actorId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const name = profile?.data?.display_name || (profile?.data?.email ? String(profile.data.email).split('@')[0] : null)
  return {
    settings,
    task: {
      id: task.id, title: String(task.title ?? ''), status: task.status, outcome: task.outcome ?? null, completed_at: task.completed_at ?? null,
      available_outcomes: Array.isArray(task.available_outcomes) ? (task.available_outcomes as unknown[]).map(String) : [],
    },
    next,
    next_task: nextTask,
    user: { name: name ?? null },
  }
}

/** The session's task's own workspace (the unified view opens any of the user's tenants). */
export async function contextForTask(ctx: ServiceContext, taskId: string): Promise<ServiceContext> {
  if (!UUID_RE.test(taskId)) throw ServiceError.notFound('Task not found')
  const { data } = await (getDb(ctx) as any).from('tasks').select('tenant_id').eq('id', taskId).maybeSingle()
  if (!data) throw ServiceError.notFound('Task not found')
  if (String(data.tenant_id) === ctx.tenantId) return ctx
  const { fromSession } = await import('./context')
  return fromSession({ tenantId: String(data.tenant_id) })
}
