import { NextRequest, NextResponse } from 'next/server'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { executeWorkflow } from '@/lib/workflow-engine'
import { enqueueResume } from '@/lib/workflow-resume-queue'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { canAccessTaskAsUser } from '@/lib/api-key-permissions'
import { findOpenWorkflowTaskForEvent, USER_TASK_EVENT_MESSAGE } from '@/lib/task-authz'
import { resolveAgentToolContext } from '@/lib/agent-tool-auth'
import { getUserPermissions } from '@/lib/permissions-server'
import { isServiceError, type ServiceContext } from '@/lib/services/context'
import { completeWorkflowTaskAction, respondToWorkflowTask } from '@/lib/services/task-actions'

function fieldValuesFromBody(body: Record<string, unknown>): Record<string, unknown> | null {
  const values = body?.values
  return values && typeof values === 'object' && !Array.isArray(values) ? (values as Record<string, unknown>) : null
}

function canAccessWorkflowForAgent(outputConfig: ReturnType<typeof normalizeAgentOutputConfig>, workflowId: string) {
  if (!outputConfig.workflow_access) return false
  if (outputConfig.workflow_scope.mode !== 'selected') return true
  return outputConfig.workflow_scope.workflow_ids.includes(workflowId)
}

async function canAccessTaskForAgent(
  supabase: any,
  tenantId: string,
  userId: string | null,
  outputConfig: ReturnType<typeof normalizeAgentOutputConfig>,
  taskId: string,
) {
  if (!outputConfig.task_access) {
    return { allowed: false, reason: 'Task access is disabled for this agent' as const, task: null }
  }
  // Per-user ownership gate only applies when there is an acting user (session
  // path, or processor path with acting_user_id). On the processor path without
  // an acting user (e.g. queue), skip the per-user gate and rely on the agent's
  // task_scope gate below.
  if (userId && !(await canAccessTaskAsUser(supabase, tenantId, userId, taskId))) {
    return { allowed: false, reason: 'This user cannot access that task' as const, task: null }
  }

  const { data: task, error } = await supabase
    .from('tasks')
    .select('id, title, status, priority, due_date, completed_at, assignee_id, assigned_team_id, is_workflow_task, workflow_id, event_id')
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single()

  if (error || !task) {
    return { allowed: false, reason: 'Task not found' as const, task: null }
  }

  if (outputConfig.task_scope.mode !== 'selected') {
    return { allowed: true, reason: null, task }
  }

  const teamIds = new Set(outputConfig.task_scope.team_ids)
  const workflowIds = new Set(outputConfig.task_scope.workflow_ids)
  if (teamIds.size === 0 && workflowIds.size === 0) {
    return { allowed: false, reason: 'Task is not in this agent’s approved task scope' as const, task }
  }

  if ((task as any).assigned_team_id && teamIds.has(String((task as any).assigned_team_id))) {
    return { allowed: true, reason: null, task }
  }
  if ((task as any).workflow_id && workflowIds.has(String((task as any).workflow_id))) {
    return { allowed: true, reason: null, task }
  }

  return { allowed: false, reason: 'Task is not in this agent’s approved task scope' as const, task }
}

/**
 * What a signed-in user calling these tools directly (the session path, not
 * the agent executor's processor secret) needs: testing agents, plus what the
 * action itself does. The agent's output_config alone would otherwise let any
 * member start workflows or act on tasks through an agent.
 */
const SESSION_ACTION_PERMISSIONS: Record<string, readonly string[]> = {
  get_task_status: [],
  respond_to_task: ['tasks.complete'],
  complete_task: ['tasks.complete'],
  complete_workflow_task: ['tasks.complete'],
  escalate_task: ['tasks.escalate'],
  redirect_task: ['tasks.redirect'],
  start_workflow_run: ['workflows.activate'],
  get_workflow_run_status: ['workflows.view_runs'],
  complete_server_event: ['workflows.activate'],
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}))
  const ctx = await resolveAgentToolContext(request, body)
  if ('error' in ctx) return ctx.error
  const { tenantId, actingUserId, supabase } = ctx

  const action = String(body.action ?? '').trim()
  if (ctx.via === 'session') {
    const permissions = await getUserPermissions()
    const missing = ['agents.test', ...(SESSION_ACTION_PERMISSIONS[action] ?? [])].find((perm) => !permissions.has(perm))
    if (missing) return NextResponse.json({ error: `Forbidden: you lack the '${missing}' permission` }, { status: 403 })
  }
  const agentId = String(request.headers.get('x-agent-id') ?? body.agent_id ?? '').trim()

  // Workflow tasks go through the shared task service (assignee only, or a
  // manager on behalf). The processor path without a user is the agent's
  // own configured task scope (checked above each action).
  const sessionPermissions = ctx.via === 'session' ? await getUserPermissions() : null
  const serviceCtx = (): ServiceContext => ({
    db: supabase as any, supabase: supabase as any, tenantId, actorId: actingUserId,
    permissions: sessionPermissions, authKind: ctx.via === 'session' ? 'session' : 'job', source: ctx.via === 'session' ? 'ui' : 'api',
  })
  const onBehalfArgs = { onBehalf: body.on_behalf === true, onBehalfNote: typeof body.on_behalf_note === 'string' ? body.on_behalf_note : null }
  const completeViaService = async (taskId: string, outcome: string, notes: string) => {
    try {
      const result = await completeWorkflowTaskAction(serviceCtx(), taskId, { outcome, notes: notes || null, values: fieldValuesFromBody(body), ...onBehalfArgs }, { via: 'agent' })
      if (result.status === 'invalid') return NextResponse.json({ error: 'Invalid field values', errors: result.errors }, { status: 400 })
      if (result.status === 'waiting') return NextResponse.json({ completed: false, status: 'waiting', task_id: taskId, responses: result.responses, needed: result.needed })
      return NextResponse.json({
        completed: true, task_id: taskId, outcome: result.outcome, workflow_resumed: result.workflow_resumed, workflow_event_completed: true,
        ...(result.workflow_resumed ? { workflow_status: 'queued', run_id: result.run_id, resumed: 'queued' } : { workflow_error: result.workflow_error }),
        acted_as: result.acted_as, on_behalf_of: result.on_behalf_of,
      })
    } catch (error) {
      if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
      throw error
    }
  }

  let outputConfig = normalizeAgentOutputConfig({})
  if (agentId) {
    const { data: agent } = await (supabase as any).from('agents').select('output_config').eq('id', agentId).eq('tenant_id', tenantId).single()
    if (agent) outputConfig = normalizeAgentOutputConfig((agent as any).output_config)
  }

  if (action === 'get_task_status') {
    const taskId = String(body.task_id ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
    const access = await canAccessTaskForAgent(supabase, tenantId, actingUserId, outputConfig, taskId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.reason === 'Task not found' ? 404 : 403 })
    }
    return NextResponse.json({ task: access.task })
  }

  if (action === 'respond_to_task') {
    const taskId = String(body.task_id ?? '').trim()
    const response = String(body.response ?? '').trim()
    const comment = String(body.comment ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
    if (!['accepted', 'held', 'rejected'].includes(response)) {
      return NextResponse.json({ error: 'response must be accepted, held, or rejected' }, { status: 400 })
    }
    const access = await canAccessTaskForAgent(supabase, tenantId, actingUserId, outputConfig, taskId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.reason === 'Task not found' ? 404 : 403 })
    }

    if ((access.task as any)?.is_workflow_task && (access.task as any)?.event_id) {
      try {
        const result = await respondToWorkflowTask(serviceCtx(), taskId, response as 'accepted' | 'held' | 'rejected', { comment: comment || null, ...onBehalfArgs, via: 'agent' })
        return NextResponse.json({ responded: true, task_id: taskId, response, comment: comment || null, acted_as: result.acted_as, on_behalf_of: result.on_behalf_of })
      } catch (error) {
        if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
        throw error
      }
    }

    // Parity with the UI/API: accepting starts the task, rejecting cancels it.
    const updates: Record<string, any> = { acceptance_status: response }
    if (response === 'accepted') {
      updates.accepted_at = new Date().toISOString()
      const currentStatus = String((access.task as any)?.status ?? '')
      if (currentStatus === 'todo' || currentStatus === 'draft' || currentStatus === '') updates.status = 'in_progress'
    }
    if (response === 'rejected') updates.status = 'cancelled'

    const { error: updateError } = await supabase.from('tasks')
      .update(updates)
      .eq('id', taskId)
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    await writeLifecycleEvent({
      supabase,
      tenantId,
      taskId,
      eventType: `task_${response}` as any,
      actorId: actingUserId,
      metadata: { comment: comment || null, source: 'agent_action_tool' },
    })

    return NextResponse.json({ responded: true, task_id: taskId, response, comment: comment || null })
  }

  if (action === 'complete_task') {
    const taskId = String(body.task_id ?? '').trim()
    const outcome = String(body.outcome ?? 'completed').trim() || 'completed'
    const outcomeNotes = String(body.outcome_notes ?? body.notes ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
    const access = await canAccessTaskForAgent(supabase, tenantId, actingUserId, outputConfig, taskId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.reason === 'Task not found' ? 404 : 403 })
    }

    // Workflow tasks must go through the completion engine — completing them
    // with a bare update left the paused run stuck in waiting_for_event and
    // ignored multi-assignee completion rules.
    if ((access.task as any)?.is_workflow_task && (access.task as any)?.event_id) {
      return completeViaService(taskId, outcome, outcomeNotes)
    }

    const { error: updateError } = await supabase.from('tasks').update({
      status: 'completed',
      outcome,
      outcome_notes: outcomeNotes || null,
      completed_at: new Date().toISOString(),
      actioned_by: actingUserId,
      actioned_at: new Date().toISOString(),
    }).eq('id', taskId).eq('tenant_id', tenantId).is('deleted_at', null)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
    await writeLifecycleEvent({
      supabase,
      tenantId,
      taskId,
      eventType: 'completed',
      actorId: actingUserId,
      metadata: { outcome, outcome_notes: outcomeNotes || null, source: 'agent_action_tool' },
    })

    return NextResponse.json({ completed: true, task_id: taskId, outcome, outcome_notes: outcomeNotes || null })
  }

  if (action === 'complete_workflow_task') {
    const taskId = String(body.task_id ?? '').trim()
    const outcome = String(body.outcome ?? '').trim()
    const notes = String(body.notes ?? body.outcome_notes ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
    if (!outcome) return NextResponse.json({ error: 'outcome is required' }, { status: 400 })
    const access = await canAccessTaskForAgent(supabase, tenantId, actingUserId, outputConfig, taskId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.reason === 'Task not found' ? 404 : 403 })
    }
    const task = access.task
    if (!(task as any).is_workflow_task) {
      return NextResponse.json({ error: 'Task is not a workflow task' }, { status: 400 })
    }

    if (!(task as any).event_id) return NextResponse.json({ error: 'Task is not waiting on a workflow' }, { status: 400 })
    return completeViaService(taskId, outcome, notes)
  }

  if (action === 'escalate_task') {
    const taskId = String(body.task_id ?? '').trim()
    const escalateTo = String(body.escalate_to ?? '').trim()
    const reason = String(body.reason ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
    if (!escalateTo) return NextResponse.json({ error: 'escalate_to is required' }, { status: 400 })
    const access = await canAccessTaskForAgent(supabase, tenantId, actingUserId, outputConfig, taskId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.reason === 'Task not found' ? 404 : 403 })
    }

    const { error: updateError } = await supabase.from('tasks').update({
      assignee_id: escalateTo,
      acceptance_status: 'pending',
    }).eq('id', taskId).eq('tenant_id', tenantId).is('deleted_at', null)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    await writeLifecycleEvent({
      supabase,
      tenantId,
      taskId,
      eventType: 'task_escalated',
      actorId: actingUserId,
      metadata: { to_user_id: escalateTo, reason: reason || null, source: 'agent_action_tool' },
    })

    return NextResponse.json({ escalated: true, task_id: taskId, escalated_to: escalateTo, reason: reason || null })
  }

  if (action === 'redirect_task') {
    const taskId = String(body.task_id ?? '').trim()
    const redirectTo = String(body.redirect_to ?? '').trim()
    const reason = String(body.reason ?? '').trim()
    if (!taskId) return NextResponse.json({ error: 'task_id is required' }, { status: 400 })
    if (!redirectTo) return NextResponse.json({ error: 'redirect_to is required' }, { status: 400 })
    const access = await canAccessTaskForAgent(supabase, tenantId, actingUserId, outputConfig, taskId)
    if (!access.allowed) {
      return NextResponse.json({ error: access.reason }, { status: access.reason === 'Task not found' ? 404 : 403 })
    }

    const { error: updateError } = await supabase.from('tasks').update({
      assignee_id: redirectTo,
      acceptance_status: 'pending',
    }).eq('id', taskId).eq('tenant_id', tenantId).is('deleted_at', null)
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

    await writeLifecycleEvent({
      supabase,
      tenantId,
      taskId,
      eventType: 'task_redirected',
      actorId: actingUserId,
      metadata: { to_user_id: redirectTo, reason: reason || null, source: 'agent_action_tool' },
    })

    return NextResponse.json({ redirected: true, task_id: taskId, redirected_to: redirectTo, reason: reason || null })
  }

  if (action === 'start_workflow_run') {
    if (!outputConfig.workflow_access) {
      return NextResponse.json({ error: 'Workflow access is disabled for this agent' }, { status: 403 })
    }
    const workflowId = String(body.workflow_id ?? '').trim()
    if (!workflowId) return NextResponse.json({ error: 'workflow_id is required' }, { status: 400 })
    if (!canAccessWorkflowForAgent(outputConfig, workflowId)) {
      return NextResponse.json({ error: 'Workflow is not in this agent’s approved workflow scope' }, { status: 403 })
    }
    const { data: workflow } = await supabase
      .from('workflows')
      .select('id, name, is_active, published_version_id')
      .eq('id', workflowId)
      .eq('tenant_id', tenantId)
      .single()
    if (!workflow) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 })
    if (!(workflow as any).is_active) return NextResponse.json({ error: 'Workflow is not active' }, { status: 400 })

    const result = await executeWorkflow(
      workflowId,
      undefined,
      false,
      body.variables && typeof body.variables === 'object' ? body.variables : undefined,
      undefined,
      (workflow as any).published_version_id ?? undefined,
      undefined,
      // The agent's acting user starts the run (workflow_started_by).
      { initiator: { userId: actingUserId ?? null, via: 'agent' } },
    )
    return NextResponse.json({
      run: {
        workflow_id: workflowId,
        workflow_name: (workflow as any).name,
        run_id: result.run_id,
        status: result.status,
        error: result.error ?? null,
      },
    })
  }

  if (action === 'get_workflow_run_status') {
    if (!outputConfig.workflow_access) {
      return NextResponse.json({ error: 'Workflow access is disabled for this agent' }, { status: 403 })
    }
    const runId = String(body.run_id ?? '').trim()
    if (!runId) return NextResponse.json({ error: 'run_id is required' }, { status: 400 })
    const { data: run, error } = await (supabase as any)
      .from('workflow_runs')
      .select('id, workflow_id, status, error, started_at, completed_at, title')
      .eq('id', runId)
      .eq('tenant_id', tenantId)
      .single()
    if (error || !run) return NextResponse.json({ error: 'Workflow run not found' }, { status: 404 })
    if (!canAccessWorkflowForAgent(outputConfig, String((run as any).workflow_id ?? ''))) {
      return NextResponse.json({ error: 'Workflow run is not in this agent’s approved workflow scope' }, { status: 403 })
    }
    return NextResponse.json({ run })
  }

  if (action === 'complete_server_event') {
    if (!outputConfig.workflow_access) {
      return NextResponse.json({ error: 'Workflow access is disabled for this agent' }, { status: 403 })
    }
    const eventId = String(body.event_id ?? '').trim()
    const variables = body.variables && typeof body.variables === 'object' ? body.variables : {}
    if (!eventId) return NextResponse.json({ error: 'event_id is required' }, { status: 400 })

    const { data: run } = await (supabase as any)
      .from('workflow_runs')
      .select('id, workflow_id, tenant_id, status, event_id')
      .eq('event_id', eventId)
      .eq('tenant_id', tenantId)
      .in('status', ['waiting_for_event', 'paused'])
      .single()
    if (!run) {
      return NextResponse.json({ error: 'No waiting workflow found for this event_id. It may have already been completed or cancelled.' }, { status: 404 })
    }
    if (!canAccessWorkflowForAgent(outputConfig, String((run as any).workflow_id ?? ''))) {
      return NextResponse.json({ error: 'Workflow is not in this agent’s approved workflow scope' }, { status: 403 })
    }
    const userTaskId = await findOpenWorkflowTaskForEvent(supabase, tenantId, String((run as any).event_id ?? eventId))
    if (userTaskId) return NextResponse.json({ error: USER_TASK_EVENT_MESSAGE, task_id: userTaskId }, { status: 409 })

    const queued = await enqueueResume({ tenantId, eventId: String((run as any).event_id ?? eventId), variables })
    return NextResponse.json({
      success: true,
      event_id: eventId,
      run_id: queued.run_id,
      workflow_id: (run as any).workflow_id,
      status: 'queued',
      resumed: queued.resumed,
      variables_received: Object.keys(variables),
    })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
