/**
 * Task and workflow tools of an agent (server only): get_task_status,
 * respond_to_task, complete_task, complete_workflow_task, escalate_task,
 * redirect_task, start_workflow_run, get_workflow_run_status,
 * complete_server_event.
 *
 * Three gates, all server-side:
 *  1. the agent's own scope (output_config task_access / task_scope,
 *     workflow_access / workflow_scope) — set by someone with agents.edit;
 *  2. the acting person's permission for the action (the same keys the UI
 *     needs) — and write actions need an acting person at all;
 *  3. for workflow tasks, the task service's assignee / manager-on-behalf
 *     rule (lib/task-authz.ts via completeWorkflowTaskAction).
 */
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { acceptanceForAssignee } from '@/lib/tasks/queue-rules-server'
import { QUEUE_TASK_COLUMNS, queueFactsFromTask } from '@/lib/tasks/queue-rules'
import { canAccessTaskAsUser } from '@/lib/api-key-permissions'
import { findOpenWorkflowTaskForEvent, USER_TASK_EVENT_MESSAGE } from '@/lib/task-authz'
import { isServiceError, type ServiceContext } from '@/lib/services/context'
import type { NormalizedAgentOutputConfig } from '@/lib/agent-knowledge'
import { AgentToolError, requireActingPermission, type AgentToolRuntime, type ToolResult } from './runtime'

/** Permission the acting person needs per action ([] = read; `write` = needs a person). */
export const ACTION_PERMISSIONS: Record<string, { perms: readonly string[]; write: boolean }> = {
  get_task_status: { perms: [], write: false },
  respond_to_task: { perms: ['tasks.complete'], write: true },
  complete_task: { perms: ['tasks.complete'], write: true },
  complete_workflow_task: { perms: ['tasks.complete'], write: true },
  escalate_task: { perms: ['tasks.escalate'], write: true },
  redirect_task: { perms: ['tasks.redirect'], write: true },
  start_workflow_run: { perms: ['workflows.activate'], write: true },
  get_workflow_run_status: { perms: ['workflows.view_runs'], write: false },
  complete_server_event: { perms: ['workflows.activate'], write: true },
}

export const ACTION_TOOL_NAMES = Object.keys(ACTION_PERMISSIONS)

function canAccessWorkflowForAgent(outputConfig: NormalizedAgentOutputConfig, workflowId: string) {
  if (!outputConfig.workflow_access) return false
  if (outputConfig.workflow_scope.mode !== 'selected') return true
  return outputConfig.workflow_scope.workflow_ids.includes(workflowId)
}

async function taskForAgent(runtime: AgentToolRuntime, taskId: string) {
  const { outputConfig, tenantId, actingUserId } = runtime
  const db = runtime.db() as any
  if (!outputConfig.task_access) throw new AgentToolError('Task access is disabled for this agent', 403)
  if (!taskId) throw new AgentToolError('task_id is required')
  if (actingUserId && !(await canAccessTaskAsUser(db, tenantId, actingUserId, taskId))) {
    throw new AgentToolError('The person this agent acts for cannot access that task', 403)
  }
  const { data: task } = await db
    .from('tasks')
    .select(`id, status, completed_at, assignee_id, event_id, ${QUEUE_TASK_COLUMNS}`)
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle()
  if (!task) throw new AgentToolError('Task not found', 404)
  if (outputConfig.task_scope.mode !== 'selected') return task
  const teamIds = new Set(outputConfig.task_scope.team_ids)
  const workflowIds = new Set(outputConfig.task_scope.workflow_ids)
  if (task.assigned_team_id && teamIds.has(String(task.assigned_team_id))) return task
  if (task.workflow_id && workflowIds.has(String(task.workflow_id))) return task
  throw new AgentToolError('Task is not in this agent’s approved task scope', 403)
}

async function requireTenantMember(runtime: AgentToolRuntime, userId: string, label: string) {
  const db = runtime.db() as any
  const { data } = await db.from('user_memberships').select('user_id, is_active')
    .eq('tenant_id', runtime.tenantId).eq('user_id', userId).maybeSingle()
  if (!data || data.is_active === false) throw new AgentToolError(`${label} must be an active member of this workspace`, 400)
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim()
}

export async function runActionTool(runtime: AgentToolRuntime, action: string, args: Record<string, any>): Promise<ToolResult> {
  const spec = ACTION_PERMISSIONS[action]
  if (!spec) throw new AgentToolError(`Unknown action: ${action}`)
  await requireActingPermission(runtime, spec.perms, { requireUser: spec.write, what: `"${action}"` })

  const { tenantId, actingUserId, outputConfig } = runtime
  const db = runtime.db() as any
  const permissions = await runtime.permissions()
  const serviceCtx = (): ServiceContext => ({
    db, supabase: db, tenantId, actorId: actingUserId,
    permissions: permissions ?? new Set<string>(), authKind: 'job', source: 'api',
  })
  const viaService = async <T,>(fn: () => Promise<T>): Promise<T> => {
    try { return await fn() } catch (error) {
      if (isServiceError(error)) throw new AgentToolError(error.message, error.status)
      throw error
    }
  }
  // Managers may act for the assignee (with a note), exactly as in the UI.
  const onBehalf = { onBehalf: args.on_behalf === true, onBehalfNote: typeof args.on_behalf_note === 'string' ? args.on_behalf_note : null }
  const completeViaService = async (taskId: string, outcome: string, notes: string): Promise<ToolResult> => {
    const { completeWorkflowTaskAction } = await import('@/lib/services/task-actions')
    const result = await viaService(() => completeWorkflowTaskAction(serviceCtx(), taskId, { outcome, notes: notes || null, values: args.values && typeof args.values === 'object' && !Array.isArray(args.values) ? args.values : null, ...onBehalf }, { via: 'agent' }))
    if (result.status === 'invalid') return { error: 'Invalid field values', errors: result.errors }
    if (result.status === 'waiting') return { completed: false, status: 'waiting', task_id: taskId, responses: result.responses, needed: result.needed }
    return {
      completed: true, task_id: taskId, outcome: result.outcome, workflow_resumed: result.workflow_resumed,
      ...(result.workflow_resumed ? { workflow_status: 'queued', run_id: result.run_id } : { workflow_error: result.workflow_error }),
      acted_as: result.acted_as, on_behalf_of: result.on_behalf_of,
    }
  }

  switch (action) {
    case 'get_task_status': {
      const task = await taskForAgent(runtime, str(args.task_id))
      return { task }
    }

    case 'respond_to_task': {
      const taskId = str(args.task_id)
      const response = str(args.response)
      const comment = str(args.comment)
      if (!['accepted', 'held', 'rejected'].includes(response)) throw new AgentToolError('response must be accepted, held, or rejected')
      const task = await taskForAgent(runtime, taskId)
      if (task.is_workflow_task && task.event_id) {
        const { respondToWorkflowTask } = await import('@/lib/services/task-actions')
        const result = await viaService(() => respondToWorkflowTask(serviceCtx(), taskId, response as 'accepted' | 'held' | 'rejected', { comment: comment || null, ...onBehalf, via: 'agent' }))
        return { responded: true, task_id: taskId, response, acted_as: result.acted_as, on_behalf_of: result.on_behalf_of }
      }
      const updates: Record<string, unknown> = { acceptance_status: response }
      if (response === 'accepted') {
        updates.accepted_at = new Date().toISOString()
        if (['todo', 'draft', ''].includes(String(task.status ?? ''))) updates.status = 'in_progress'
      }
      if (response === 'rejected') updates.status = 'cancelled'
      const { error } = await db.from('tasks').update(updates).eq('id', taskId).eq('tenant_id', tenantId).is('deleted_at', null)
      if (error) throw new AgentToolError(error.message, 500)
      await writeLifecycleEvent({ supabase: db, tenantId, taskId, eventType: `task_${response}` as any, actorId: actingUserId, metadata: { comment: comment || null, source: 'agent' } })
      return { responded: true, task_id: taskId, response }
    }

    case 'complete_task': {
      const taskId = str(args.task_id)
      const outcome = str(args.outcome) || 'completed'
      const notes = str(args.outcome_notes ?? args.notes)
      const task = await taskForAgent(runtime, taskId)
      if (task.is_workflow_task && task.event_id) return completeViaService(taskId, outcome, notes)
      const now = new Date().toISOString()
      const { error } = await db.from('tasks').update({
        status: 'completed', outcome, outcome_notes: notes || null, completed_at: now, actioned_by: actingUserId, actioned_at: now,
      }).eq('id', taskId).eq('tenant_id', tenantId).is('deleted_at', null)
      if (error) throw new AgentToolError(error.message, 500)
      await writeLifecycleEvent({ supabase: db, tenantId, taskId, eventType: 'completed', actorId: actingUserId, metadata: { outcome, outcome_notes: notes || null, source: 'agent' } })
      return { completed: true, task_id: taskId, outcome }
    }

    case 'complete_workflow_task': {
      const taskId = str(args.task_id)
      const outcome = str(args.outcome)
      if (!outcome) throw new AgentToolError('outcome is required')
      const task = await taskForAgent(runtime, taskId)
      if (!task.is_workflow_task) throw new AgentToolError('Task is not a workflow task')
      if (!task.event_id) throw new AgentToolError('Task is not waiting on a workflow')
      return completeViaService(taskId, outcome, str(args.notes ?? args.outcome_notes))
    }

    case 'escalate_task':
    case 'redirect_task': {
      const taskId = str(args.task_id)
      const target = str(action === 'escalate_task' ? args.escalate_to : args.redirect_to)
      const reason = str(args.reason)
      if (!target) throw new AgentToolError(`${action === 'escalate_task' ? 'escalate_to' : 'redirect_to'} is required`)
      const task = await taskForAgent(runtime, taskId)
      await requireTenantMember(runtime, target, 'The new assignee')
      // The new assignee's queue rules: Queued (pending) or added (accepted).
      const acceptance = await acceptanceForAssignee(db, target,
        queueFactsFromTask(task, { assignedBy: actingUserId ?? null, origins: ['agent', action === 'escalate_task' ? 'escalation' : 'redirect'] }),
        undefined, { tenantId })
      const { error } = await db.from('tasks').update({ assignee_id: target, acceptance_status: acceptance })
        .eq('id', taskId).eq('tenant_id', tenantId).is('deleted_at', null)
      if (error) throw new AgentToolError(error.message, 500)
      await writeLifecycleEvent({
        supabase: db, tenantId, taskId, eventType: action === 'escalate_task' ? 'task_escalated' : 'task_redirected', actorId: actingUserId,
        metadata: { to_user_id: target, reason: reason || null, source: 'agent' },
      })
      return action === 'escalate_task' ? { escalated: true, task_id: taskId, escalated_to: target } : { redirected: true, task_id: taskId, redirected_to: target }
    }

    case 'start_workflow_run': {
      if (!outputConfig.workflow_access) throw new AgentToolError('Workflow access is disabled for this agent', 403)
      const workflowId = str(args.workflow_id)
      if (!workflowId) throw new AgentToolError('workflow_id is required')
      if (!canAccessWorkflowForAgent(outputConfig, workflowId)) throw new AgentToolError('Workflow is not in this agent’s approved workflow scope', 403)
      const { data: workflow } = await db.from('workflows').select('id, name, is_active, published_version_id').eq('id', workflowId).eq('tenant_id', tenantId).maybeSingle()
      if (!workflow) throw new AgentToolError('Workflow not found', 404)
      if (!workflow.is_active) throw new AgentToolError('Workflow is not active')
      const { executeWorkflow } = await import('@/lib/workflow-engine')
      const variables = args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables) ? args.variables : undefined
      const result = await executeWorkflow(workflowId, undefined, false, variables, undefined, workflow.published_version_id ?? undefined, undefined,
        { initiator: { userId: actingUserId ?? null, via: 'agent' } })
      return { run: { workflow_id: workflowId, workflow_name: workflow.name, run_id: result.run_id, status: result.status, error: result.error ?? null } }
    }

    case 'get_workflow_run_status': {
      if (!outputConfig.workflow_access) throw new AgentToolError('Workflow access is disabled for this agent', 403)
      const runId = str(args.run_id)
      if (!runId) throw new AgentToolError('run_id is required')
      const { data: run } = await db.from('workflow_runs').select('id, workflow_id, status, error, started_at, completed_at, title').eq('id', runId).eq('tenant_id', tenantId).maybeSingle()
      if (!run) throw new AgentToolError('Workflow run not found', 404)
      if (!canAccessWorkflowForAgent(outputConfig, String(run.workflow_id ?? ''))) throw new AgentToolError('Workflow run is not in this agent’s approved workflow scope', 403)
      return { run }
    }

    case 'complete_server_event': {
      if (!outputConfig.workflow_access) throw new AgentToolError('Workflow access is disabled for this agent', 403)
      const eventId = str(args.event_id)
      const variables = args.variables && typeof args.variables === 'object' && !Array.isArray(args.variables) ? args.variables : {}
      if (!eventId) throw new AgentToolError('event_id is required')
      const { data: run } = await db.from('workflow_runs').select('id, workflow_id, event_id')
        .eq('event_id', eventId).eq('tenant_id', tenantId).in('status', ['waiting_for_event', 'paused']).maybeSingle()
      if (!run) throw new AgentToolError('No waiting workflow found for this event_id. It may have already been completed or cancelled.', 404)
      if (!canAccessWorkflowForAgent(outputConfig, String(run.workflow_id ?? ''))) throw new AgentToolError('Workflow is not in this agent’s approved workflow scope', 403)
      const { isAgentManagedEvent, AGENT_EVENT_MESSAGE } = await import('@/lib/agents/approval')
      if (isAgentManagedEvent(eventId)) throw new AgentToolError(AGENT_EVENT_MESSAGE, 409)
      const { isMediaManagedEvent, MEDIA_EVENT_MESSAGE } = await import('@/lib/media/jobs')
      if (isMediaManagedEvent(eventId)) throw new AgentToolError(MEDIA_EVENT_MESSAGE, 409)
      const { isEsignManagedEvent, ESIGN_EVENT_MESSAGE } = await import('@/lib/esign/waits')
      if (isEsignManagedEvent(eventId)) throw new AgentToolError(ESIGN_EVENT_MESSAGE, 409)
      const userTaskId = await findOpenWorkflowTaskForEvent(db, tenantId, String(run.event_id ?? eventId))
      if (userTaskId) throw new AgentToolError(USER_TASK_EVENT_MESSAGE, 409)
      const { enqueueResume } = await import('@/lib/workflow-resume-queue')
      const queued = await enqueueResume({ tenantId, eventId: String(run.event_id ?? eventId), variables })
      return { success: true, event_id: eventId, run_id: queued.run_id, workflow_id: run.workflow_id, status: 'queued' }
    }
  }
  throw new AgentToolError(`Unknown action: ${action}`)
}
