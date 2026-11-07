/**
 * Human approval of agent tool calls (server only).
 *
 * An agent lists tools that need approval (output_config.approval.tools, or
 * `*` for every tool except read-only built-ins). When the model calls one,
 * the executor stops with status 'awaiting_approval' and the resumable
 * state. Then:
 *
 *  1. pauseForApproval() stores the run (agent_runs.status
 *     'awaiting_approval', paused_context = state + what to do afterwards)
 *     and creates a workflow-style task for the reviewer — outcomes
 *     Approve / Reject, event id `agentappr_…`, the tool and its arguments
 *     in the description. Reviewer: the configured user, else team, else the
 *     agent's creator.
 *  2. Completing that task (any surface — task screen, REST, MCP; through
 *     completeWorkflowTaskAction) calls handleAgentApprovalCompletion(),
 *     which claims the run (status → 'running', once) and queues an
 *     agent_queue job of kind 'resume' with the decision.
 *  3. The queue worker (lib/jobs/agent-queue.ts) continues the run: an
 *     approved call runs; a rejected one is answered "rejected by a
 *     reviewer" (with the reviewer's notes) and the model carries on.
 *  4. When the run finishes and was started by a Run Agent step, the
 *     paused workflow resumes with the agent's variables (or fails with the
 *     agent's error).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentPendingApproval, AgentResult } from '@/lib/agent-executor'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { recordAgentRun, type AgentCallerType } from '@/lib/agent-run-service'
import { forStorage } from './safety'

export const AGENT_APPROVAL_EVENT_PREFIX = 'agentappr_'
/** Workflow event id a Run Agent step waits on (approval / queued mode). */
export const AGENT_WAIT_EVENT_PREFIX = 'agentwait_'
export const APPROVE_OUTCOME = 'Approve'
export const REJECT_OUTCOME = 'Reject'

export function isAgentApprovalEvent(eventId: unknown): boolean {
  return typeof eventId === 'string' && eventId.startsWith(AGENT_APPROVAL_EVENT_PREFIX)
}

/** Events an agent owns (its Run Agent step's wait, its approval tasks): never completed from outside. */
export const AGENT_EVENT_MESSAGE = 'This event belongs to an AI agent step — it resumes by itself when the agent finishes (or when its approval task is completed)'
export function isAgentManagedEvent(eventId: unknown): boolean {
  return typeof eventId === 'string' && (eventId.startsWith(AGENT_WAIT_EVENT_PREFIX) || eventId.startsWith(AGENT_APPROVAL_EVENT_PREFIX))
}

export function newEventId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replace(/-/g, '')}`
}

/** The Run Agent step a run belongs to (to resume the workflow when the agent finishes). */
export interface AgentWorkflowLink {
  run_id: string
  workflow_id: string | null
  event_id: string
  node_id: string
  node_label: string
  output_variable: string
  output_prefix: string
  share_context: boolean
  agent_context?: { messages: any[]; facts: Record<string, any> } | null
  user_message: string
}

/** What the queue worker needs to continue a paused run. */
export interface AgentPausedContext {
  state: NonNullable<AgentResult['state']>
  pending: AgentPendingApproval
  approval_event_id: string
  approval_task_id: string | null
  acting_user_id: string | null
  caller_type: AgentCallerType
  trace_id: string | null
  workflow?: AgentWorkflowLink | null
  max_duration_ms?: number
  max_iterations?: number
}

function describeArgs(args: Record<string, unknown>): string {
  const safe = forStorage(args, 6_000)
  const text = typeof safe === 'string' ? safe : JSON.stringify(safe, null, 2)
  return text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string)
}

/**
 * Store the paused run and create the reviewer's task. Returns the run id
 * and task id. `runId` updates an existing run (a resumed run pausing again).
 */
export async function pauseForApproval(params: {
  db: SupabaseClient
  tenantId: string
  agent: Record<string, any>
  result: AgentResult
  model: string
  inputMessage: string
  actingUserId: string | null
  callerType: AgentCallerType
  callerId?: string | null
  traceId?: string | null
  workflow?: AgentWorkflowLink | null
  runId?: string | null
  queueJobId?: string | null
  maxDurationMs?: number
  maxIterations?: number
  provider?: string | null
  agentVersion?: number | null
  initiatedBy?: string | null
}): Promise<{ runId: string | null; taskId: string | null; eventId: string }> {
  const { db, tenantId, agent, result } = params
  if (result.status !== 'awaiting_approval' || !result.pending || !result.state) throw new Error('Run is not waiting for approval')
  const eventId = newEventId(AGENT_APPROVAL_EVENT_PREFIX)
  const approval = normalizeAgentOutputConfig(agent.output_config).approval

  const paused: AgentPausedContext = {
    state: result.state,
    pending: { ...result.pending, arguments: forStorage(result.pending.arguments, 20_000) as any },
    approval_event_id: eventId,
    approval_task_id: null,
    acting_user_id: params.actingUserId,
    caller_type: params.callerType,
    trace_id: params.traceId ?? null,
    workflow: params.workflow ?? null,
    max_duration_ms: params.maxDurationMs,
    max_iterations: params.maxIterations,
  }
  // The state keeps the raw arguments: they are what will run once approved.
  paused.state = { ...result.state }

  const runId = await recordAgentRun({
    supabase: db, tenantId, agentId: String(agent.id), result, model: params.model, inputMessage: params.inputMessage,
    actorId: params.actingUserId, callerType: params.callerType, callerId: params.callerId ?? null, traceId: params.traceId ?? null,
    workflowRunId: params.workflow?.run_id ?? null, runId: params.runId ?? null, queueJobId: params.queueJobId ?? null, pausedContext: paused as any,
    provider: params.provider ?? null, agentVersion: params.agentVersion ?? null, initiatedBy: params.initiatedBy ?? null,
  })

  // Reviewer: configured user → configured team → the agent's creator → the acting person.
  let assigneeId: string | null = approval.assignee_user_id
  const teamId: string | null = assigneeId ? null : approval.assignee_team_id
  if (!assigneeId && !teamId) assigneeId = agent.created_by ?? params.actingUserId ?? null

  const toolLabel = result.pending.tool
  const description = [
    `<p>The agent <strong>${String(agent.name ?? 'Agent').replace(/[&<>]/g, '')}</strong> wants to run the tool <code>${toolLabel}</code>. Approve to let it run, or reject (add a note to tell the agent why).</p>`,
    `<p><strong>Arguments</strong></p><pre>${describeArgs(result.pending.arguments)}</pre>`,
    params.workflow ? `<p>Started by a Run Agent step of a workflow run (${params.workflow.run_id}).</p>` : '',
    runId ? `<p><a href="/agents/${agent.id}/runs/${runId}">Open the agent run</a></p>` : '',
  ].filter(Boolean).join('\n')

  const { data: task, error } = await (db as any).from('tasks').insert({
    tenant_id: tenantId,
    title: `Approve ${toolLabel} for agent "${String(agent.name ?? 'Agent').slice(0, 80)}"`,
    description,
    priority: 'high',
    assignee_id: assigneeId,
    assigned_team_id: teamId,
    assignment_type: teamId ? 'team' : 'individual',
    assignment_mode: teamId ? 'team' : 'single',
    acceptance_status: 'accepted',
    is_workflow_task: true,
    event_id: eventId,
    available_outcomes: [APPROVE_OUTCOME, REJECT_OUTCOME],
    workflow_id: params.workflow?.workflow_id ?? null,
    status: 'todo',
    metadata: {
      completion_rule: 'first_response',
      agent_approval: { agent_id: agent.id, agent_run_id: runId, tool: toolLabel, tool_call_id: result.pending.tool_call_id },
    },
  }).select('id').single()
  if (error) {
    // No reviewer task: the run cannot continue — fail it rather than leave it waiting forever.
    if (runId) {
      await (db as any).from('agent_runs').update({ status: 'failed', error: `Could not create the approval task: ${error.message}`, paused_context: null, paused_at: null, completed_at: new Date().toISOString() })
        .eq('id', runId).eq('tenant_id', tenantId)
    }
    throw new Error(`Could not create the approval task: ${error.message}`)
  }
  const taskId = (task as any)?.id ?? null
  if (runId && taskId) {
    await (db as any).from('agent_runs').update({ paused_context: { ...paused, approval_task_id: taskId } }).eq('id', runId).eq('tenant_id', tenantId)
  }
  if (assigneeId && taskId) {
    await (db as any).from('notifications').insert({
      user_id: assigneeId, tenant_id: tenantId, type: 'task_assigned',
      title: `Approval needed: ${toolLabel}`, body: `The agent "${String(agent.name ?? 'Agent')}" is waiting for your approval to run ${toolLabel}.`, task_id: taskId,
    }).then(() => {}, () => {})
  }
  return { runId, taskId, eventId }
}

/**
 * The approval task was completed: claim the paused run and queue its
 * resume. Returns the agent run id (or throws when nothing is waiting).
 */
export async function handleAgentApprovalCompletion(params: {
  db: SupabaseClient
  tenantId: string
  eventId: string
  outcome: string
  notes: string | null
  actionedBy: string | null
}): Promise<{ agent_run_id: string; job_id: string | null; approved: boolean }> {
  const { db, tenantId, eventId } = params
  const approved = String(params.outcome ?? '').trim().toLowerCase() === APPROVE_OUTCOME.toLowerCase()
  // Claim once: only the update that flips awaiting_approval → running resumes.
  const { data: run } = await (db as any).from('agent_runs')
    .update({ status: 'running', paused_at: null })
    .eq('tenant_id', tenantId).eq('status', 'awaiting_approval')
    .eq('approval_event_id', eventId)
    .select('id, agent_id').maybeSingle()
  if (!run) throw new Error('No agent run is waiting on this approval')
  const { data: job, error } = await (db as any).from('agent_queue').insert({
    agent_id: run.agent_id,
    tenant_id: tenantId,
    input_message: '(resume after approval)',
    status: 'pending',
    kind: 'resume',
    resume_run_id: run.id,
    options: { decision: { approved, by: params.actionedBy, notes: params.notes ?? null } },
    priority: 5,
  }).select('id').single()
  if (error) {
    await (db as any).from('agent_runs').update({ status: 'awaiting_approval', paused_at: new Date().toISOString() }).eq('id', run.id)
    throw new Error(`Could not queue the agent resume: ${error.message}`)
  }
  const { kickAgentQueueProcessor } = await import('@/lib/process-queue')
  kickAgentQueueProcessor(1)
  return { agent_run_id: run.id, job_id: (job as any)?.id ?? null, approved }
}
