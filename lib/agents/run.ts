/**
 * Running a prepared agent end to end (server only): execute, record the
 * run, pause for approval, and — for a Run Agent step that waits (approval
 * or queued mode) — resume the workflow with the agent's variables.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { executeAgent, type AgentResult, type ApprovalDecision, type ExecuteAgentOptions } from '@/lib/agent-executor'
import { agentOutputPrefix, type NormalizedAgentOutputConfig } from '@/lib/agent-knowledge'
import { recordAgentRun, type AgentCallerType } from '@/lib/agent-run-service'
import { pauseForApproval, type AgentPausedContext, type AgentWorkflowLink } from './approval'
import { buildAgentRun, checkDailyBudget, loadAgentForRun, type LoadedAgent } from './prepare'

export interface RunAgentParams {
  db: SupabaseClient
  tenantId: string
  loaded: LoadedAgent
  message: string
  actingUserId: string | null
  callerType: AgentCallerType
  callerId?: string | null
  traceId?: string | null
  workflow?: AgentWorkflowLink | null
  includeSharedContext?: boolean
  sharedContext?: ExecuteAgentOptions['sharedContext']
  history?: ExecuteAgentOptions['history']
  attachments?: ExecuteAgentOptions['attachments']
  overrides?: { maxIterations?: unknown; maxDurationMs?: unknown }
  onEvent?: ExecuteAgentOptions['onEvent']
  signal?: AbortSignal
  mode?: 'live' | 'eval'
  queueJobId?: string | null
  /** Skip the daily-budget check (resumes: the run was already admitted). */
  skipBudget?: boolean
  /** Continue a paused run. */
  resume?: { runId: string; paused: AgentPausedContext; decision: ApprovalDecision }
  /** Persist the run (default true; evals record their own). */
  record?: boolean
  /** Who started the run (workflow initiator, console / API user); defaults to the acting user. */
  initiatedBy?: string | null
  /** Stream the model's reply as delta events through onEvent (console, Save & Test, REST `stream`). */
  stream?: boolean
}

export interface RunAgentOutcome {
  result: AgentResult
  runId: string | null
  outputConfig: NormalizedAgentOutputConfig
  model: string
  /** Provider kind (prices the run). */
  provider: string
  approval?: { taskId: string | null; eventId: string }
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentOutcome> {
  const { db, tenantId, loaded } = params
  const agentId = String(loaded.agent.id)
  const prepared = await buildAgentRun({
    db, tenantId, loaded, actingUserId: params.actingUserId,
    includeSharedContext: params.includeSharedContext,
    overrides: params.resume
      ? { maxIterations: params.resume.paused.max_iterations, maxDurationMs: params.resume.paused.max_duration_ms }
      : params.overrides,
    traceId: params.traceId ?? null, signal: params.signal,
  })
  if (!params.skipBudget && !params.resume) await checkDailyBudget(db, tenantId, agentId, prepared.outputConfig)

  const result = await executeAgent(prepared.config, params.message, {
    ...prepared.options,
    onEvent: params.onEvent,
    sharedContext: params.sharedContext,
    history: params.history,
    attachments: params.attachments,
    signal: params.signal,
    stream: Boolean(params.stream && params.onEvent),
    mode: params.mode ?? 'live',
    ...(params.resume ? { resume: { state: params.resume.paused.state, decision: params.resume.decision } } : {}),
  })

  const provider = prepared.provider
  const agentVersion = Number(loaded.agent.version) || null
  if (params.record === false) return { result, runId: params.resume?.runId ?? null, outputConfig: prepared.outputConfig, model: prepared.config.model, provider }

  const workflow = params.workflow ?? params.resume?.paused.workflow ?? null
  const actingUserId = params.resume?.paused.acting_user_id ?? params.actingUserId
  const callerType = params.resume?.paused.caller_type ?? params.callerType
  const traceId = params.resume?.paused.trace_id ?? params.traceId ?? null

  if (result.status === 'awaiting_approval') {
    const paused = await pauseForApproval({
      db, tenantId, agent: loaded.agent, result, model: prepared.config.model, inputMessage: params.message,
      actingUserId, callerType, callerId: params.callerId ?? workflow?.run_id ?? null, traceId, workflow,
      runId: params.resume?.runId ?? null, queueJobId: params.queueJobId ?? null,
      maxDurationMs: prepared.options.maxDurationMs, maxIterations: prepared.config.maxIterations,
      provider, agentVersion, initiatedBy: params.initiatedBy ?? null,
    })
    return { result, runId: paused.runId, outputConfig: prepared.outputConfig, model: prepared.config.model, provider, approval: { taskId: paused.taskId, eventId: paused.eventId } }
  }

  const runId = await recordAgentRun({
    supabase: db, tenantId, agentId, result, model: prepared.config.model, inputMessage: params.message,
    actorId: actingUserId, callerType, callerId: params.callerId ?? workflow?.run_id ?? null, traceId,
    workflowRunId: workflow?.run_id ?? null, queueJobId: params.queueJobId ?? null, runId: params.resume?.runId ?? null,
    provider, agentVersion, initiatedBy: params.initiatedBy ?? null,
  })
  return { result, runId, outputConfig: prepared.outputConfig, model: prepared.config.model, provider }
}

/** Load + run in one step (REST / console callers). */
export async function loadAndRunAgent(params: Omit<RunAgentParams, 'loaded'> & { agentId: string }): Promise<RunAgentOutcome> {
  const loaded = await loadAgentForRun(params.db, params.tenantId, params.agentId)
  return runAgent({ ...params, loaded })
}

/**
 * The workflow variables a Run Agent step sets from a finished agent run —
 * identical for an inline step and one resumed after approval / queueing.
 */
export function agentWorkflowVariables(result: AgentResult, link: Pick<AgentWorkflowLink, 'output_variable' | 'output_prefix' | 'share_context' | 'agent_context' | 'user_message' | 'node_label'>, outputConfig: NormalizedAgentOutputConfig, agentName: string): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const outputVar = link.output_variable || 'agent_response'
  out[outputVar] = result.response
  out[`${outputVar}_iterations`] = result.iterations
  out[`${outputVar}_tool_calls`] = result.toolCalls.length
  out[`${outputVar}_usage`] = result.usage
  out[`${outputVar}_status`] = result.status
  out[`${outputVar}_duration_ms`] = result.duration_ms
  if (result.outputs) out[`${outputVar}_outputs`] = result.outputs
  if (result.files?.length) out[`${outputVar}_files`] = result.files
  if (result.outputs && outputConfig.variables.length > 0) {
    const prefix = link.output_prefix || agentOutputPrefix(agentName)
    for (const v of outputConfig.variables) {
      const key = String(v?.name ?? '').trim()
      if (!key) continue
      out[key] = result.outputs[key]
      out[`${prefix}_${key}`] = result.outputs[key]
    }
  }
  if (link.share_context) {
    const context = link.agent_context ?? { messages: [], facts: {} }
    const now = new Date().toISOString()
    out.agent_context = {
      ...context,
      messages: [
        ...(context.messages ?? []),
        { role: 'user', content: link.user_message, agent: link.node_label, timestamp: now },
        { role: 'assistant', content: result.response, agent: link.node_label, timestamp: now },
      ],
    }
  }
  return out
}

/** Compact node output for the run trace. */
export function agentNodeOutput(result: AgentResult, runId: string | null): Record<string, unknown> {
  return {
    response: result.response.slice(0, 500),
    iterations: result.iterations,
    tool_calls: result.toolCalls.length,
    tokens: result.usage.total_tokens,
    duration_ms: result.duration_ms,
    ...(runId ? { agent_run_id: runId } : {}),
    ...(result.outputs ? { outputs: result.outputs } : {}),
    ...(result.parse_warning ? { parse_warning: result.parse_warning } : {}),
    ...(result.files?.length ? { generated_files: result.files.map((f) => f.name) } : {}),
  }
}

/**
 * A Run Agent step was waiting on this agent (approval / queued mode):
 * resume its workflow run with the agent's variables, or fail the step.
 */
export async function resumeLinkedWorkflow(params: {
  db: SupabaseClient
  tenantId: string
  link: AgentWorkflowLink
  outcome: RunAgentOutcome
  agentName: string
}): Promise<void> {
  const { link, outcome } = params
  const { enqueueResume } = await import('@/lib/workflow-resume-queue')
  const variables = outcome.result.status === 'completed'
    ? { ...agentWorkflowVariables(outcome.result, link, outcome.outputConfig, params.agentName), _agent_node_output: agentNodeOutput(outcome.result, outcome.runId) }
    : { _agent_node_error: `Agent execution failed: ${outcome.result.error ?? 'unknown error'}`, _agent_node_output: agentNodeOutput(outcome.result, outcome.runId) }
  await enqueueResume({ tenantId: params.tenantId, eventId: link.event_id, variables, supabase: params.db })
}
