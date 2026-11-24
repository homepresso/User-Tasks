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
import { dbBlackboard, type RunBlackboard } from './blackboard'
import type { WorkflowDataSummary } from './workflow-data'
import { reportAgentError } from './error-trigger-dispatch'
import { agentFailureReason } from './error-trigger'
import { technicalSummary } from './errors'
import { mergeAgentContexts, normalizeAgentContext, type AgentContext, type FactWriter, type SharedMessage } from './shared-context'

/** The live blackboard of a Run Agent step's run (Share context on, saved run), else none. */
export function workflowBlackboard(db: SupabaseClient, tenantId: string, link: AgentWorkflowLink | null | undefined): RunBlackboard | undefined {
  if (!link?.share_context || !link.run_id) return undefined
  return dbBlackboard(db, tenantId, link.run_id)
}

const writerOf = (link: AgentWorkflowLink | null | undefined): Omit<FactWriter, 'at'> | undefined =>
  link ? { agent: link.node_label || null, node_id: link.node_id || null, branch: link.branch ?? null } : undefined

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
  /**
   * The run's shared-facts blackboard. Default: for a Run Agent step with
   * Share context in a saved run, the run's blackboard in the database.
   */
  blackboard?: RunBlackboard | null
  /**
   * Run Agent's "Use this workflow's data as context": the block the agent
   * gets before the prompt and its summary (stored on the run as
   * `context.workflow_data`; the block itself is not stored).
   */
  workflowData?: { text: string; summary: WorkflowDataSummary } | null
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

  const link = params.workflow ?? params.resume?.paused.workflow ?? null
  const blackboard = params.blackboard === null ? undefined : (params.blackboard ?? workflowBlackboard(db, tenantId, link))
  const result = await executeAgent(prepared.config, params.message, {
    ...prepared.options,
    blackboard,
    factWriter: writerOf(link),
    onEvent: params.onEvent,
    sharedContext: params.sharedContext,
    history: params.history,
    attachments: params.attachments,
    ...(params.workflowData?.text && !params.resume ? { workflowContext: params.workflowData.text } : {}),
    signal: params.signal,
    stream: Boolean(params.stream && params.onEvent),
    mode: params.mode ?? 'live',
    ...(params.resume ? { resume: { state: params.resume.paused.state, decision: params.resume.decision } } : {}),
  })

  // Fold in what other agents of the run wrote (also facts this agent never read),
  // so the step's agent_context carries every fact of the run so far.
  if (blackboard?.shared && result.status !== 'awaiting_approval') {
    try {
      const snap = await blackboard.read()
      const merged = mergeAgentContexts(
        { messages: [], facts: snap.facts, fact_writers: snap.writers },
        { messages: [], facts: result.shared_facts?.facts ?? {}, fact_writers: result.shared_facts?.writers ?? {} },
      )
      result.shared_facts = { facts: merged.facts, writers: (merged.fact_writers ?? {}) as Record<string, FactWriter> }
    } catch (error) {
      console.warn('[agents] could not read the run\'s shared facts:', (error as Error)?.message)
    }
  }

  const provider = prepared.provider
  const agentVersion = Number(loaded.agent.version) || null
  if (params.record === false) return { result, runId: params.resume?.runId ?? null, outputConfig: prepared.outputConfig, model: prepared.config.model, provider }

  const workflow = params.workflow ?? params.resume?.paused.workflow ?? null
  const runContext = params.workflowData?.summary ? { workflow_data: params.workflowData.summary } : null
  const actingUserId = params.resume?.paused.acting_user_id ?? params.actingUserId
  const callerType = params.resume?.paused.caller_type ?? params.callerType
  const traceId = params.resume?.paused.trace_id ?? params.traceId ?? null

  if (result.status === 'awaiting_approval') {
    const paused = await pauseForApproval({
      db, tenantId, agent: loaded.agent, result, model: prepared.config.model, inputMessage: params.message,
      actingUserId, callerType, callerId: params.callerId ?? workflow?.run_id ?? null, traceId, workflow,
      runId: params.resume?.runId ?? null, queueJobId: params.queueJobId ?? null,
      maxDurationMs: prepared.options.maxDurationMs, maxIterations: prepared.config.maxIterations,
      provider, agentVersion, initiatedBy: params.initiatedBy ?? null, context: runContext,
    })
    return { result, runId: paused.runId, outputConfig: prepared.outputConfig, model: prepared.config.model, provider, approval: { taskId: paused.taskId, eventId: paused.eventId } }
  }

  const runId = await recordAgentRun({
    supabase: db, tenantId, agentId, result, model: prepared.config.model, inputMessage: params.message,
    actorId: actingUserId, callerType, callerId: params.callerId ?? workflow?.run_id ?? null, traceId,
    workflowRunId: workflow?.run_id ?? null, queueJobId: params.queueJobId ?? null, runId: params.resume?.runId ?? null,
    provider, agentVersion, initiatedBy: params.initiatedBy ?? null, context: runContext,
  })
  // A final failure (retries exhausted, or none could help) starts the workspace's Agent error workflows; never a stop, an eval or a test run.
  if (result.status === 'failed' && result.error_kind !== 'cancelled' && params.mode !== 'eval' && callerType !== 'eval') {
    await reportAgentError(db, agentErrorEventFor({
      tenantId, result, agentId, agentName: String(loaded.agent.name ?? ''), provider, model: prepared.config.model,
      workflow, agentRunId: runId, userId: params.initiatedBy ?? actingUserId ?? null,
    }))
  }
  return { result, runId, outputConfig: prepared.outputConfig, model: prepared.config.model, provider }
}

/** The Agent error trigger's event for a failed agent run (sanitised: the friendly message and technical summary only). */
export function agentErrorEventFor(input: {
  tenantId: string; result: Pick<AgentResult, 'failure' | 'error_kind'>; agentId: string; agentName: string | null
  provider: string | null; model: string | null; workflow: AgentWorkflowLink | null | undefined; agentRunId: string | null; userId: string | null
}): Parameters<typeof reportAgentError>[1] {
  const view = input.result.failure
  const reason = view ? null : agentFailureReason(input.result.error_kind)
  const w = input.workflow
  return {
    tenantId: input.tenantId,
    source: w ? 'workflow' : 'agent_run',
    code: view?.code ?? reason!.code,
    message: view?.message ?? reason!.message,
    summary: view ? technicalSummary(view) : reason!.summary,
    provider: view?.details.provider ?? input.provider, model: input.model,
    agentId: input.agentId, agentName: input.agentName,
    workflowId: w?.workflow_id ?? null, runId: w?.run_id || null, stepLabel: w?.node_label ?? null, stepId: w?.node_id ?? null,
    agentRunId: input.agentRunId, userId: input.userId,
    attempts: view?.details.attempts ?? null, requestId: view?.details.request_id ?? null,
    depth: w?.agent_error_depth ?? 0, test: Boolean(w?.test),
  }
}

/** An agent that can't start for want of a provider connection / key (AgentRunError no_integration / no_key): reported as not_configured. */
export async function reportAgentNotConfigured(db: SupabaseClient, input: { tenantId: string; agentId: string; agentName?: string | null; workflow?: AgentWorkflowLink | null; userId?: string | null }, error: unknown): Promise<void> {
  const code = (error as { code?: string } | null)?.code
  if ((error as Error)?.name !== 'AgentRunError' || (code !== 'no_integration' && code !== 'no_key')) return
  const reason = agentFailureReason('not_configured')
  const w = input.workflow ?? null
  await reportAgentError(db, {
    tenantId: input.tenantId, source: w ? 'workflow' : 'agent_run', code: reason.code, message: reason.message, summary: code,
    agentId: input.agentId, agentName: input.agentName ?? null,
    workflowId: w?.workflow_id ?? null, runId: w?.run_id || null, stepLabel: w?.node_label ?? null, stepId: w?.node_id ?? null,
    userId: input.userId ?? null, depth: w?.agent_error_depth ?? 0, test: Boolean(w?.test),
  })
}

/** Load + run in one step (REST / console callers). */
export async function loadAndRunAgent(params: Omit<RunAgentParams, 'loaded'> & { agentId: string }): Promise<RunAgentOutcome> {
  let loaded: LoadedAgent
  try {
    loaded = await loadAgentForRun(params.db, params.tenantId, params.agentId)
  } catch (error) {
    if (params.mode !== 'eval' && params.callerType !== 'eval') await reportAgentNotConfigured(params.db, { tenantId: params.tenantId, agentId: params.agentId, workflow: params.workflow, userId: params.initiatedBy ?? params.actingUserId }, error)
    throw error
  }
  return runAgent({ ...params, loaded })
}

/**
 * The workflow variables a Run Agent step sets from a finished agent run —
 * identical for an inline step and one resumed after approval / queueing.
 */
export function agentWorkflowVariables(result: AgentResult, link: Pick<AgentWorkflowLink, 'output_variable' | 'output_prefix' | 'share_context' | 'agent_context' | 'user_message' | 'node_label'> & Partial<Pick<AgentWorkflowLink, 'node_id' | 'branch' | 'started_at'>>, outputConfig: NormalizedAgentOutputConfig, agentName: string): Record<string, unknown> {
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
    // The step's copy of the context: the one it started with, its own turn
    // (tagged with the agent, step and branch) and the run's shared facts.
    // The engine merges it into agent_context (never overwrites it).
    const now = new Date().toISOString()
    const tag = { agent: link.node_label, node_id: link.node_id ?? null, branch: link.branch ?? null }
    const turn: SharedMessage[] = [
      { id: crypto.randomUUID(), role: 'user', content: link.user_message, ...tag, timestamp: link.started_at ?? now },
      { id: crypto.randomUUID(), role: 'assistant', content: result.response, ...tag, timestamp: now },
    ]
    const started = normalizeAgentContext(link.agent_context)
    out.agent_context = mergeAgentContexts(started, {
      messages: turn,
      facts: result.shared_facts?.facts ?? started.facts,
      fact_writers: result.shared_facts?.writers ?? started.fact_writers ?? {},
    } satisfies AgentContext)
  }
  return out
}

/** Compact node output for the run trace. */
export function agentNodeOutput(result: AgentResult, runId: string | null, link?: (Pick<AgentWorkflowLink, 'branch'> & Partial<Pick<AgentWorkflowLink, 'workflow_data'>>) | null): Record<string, unknown> {
  const finished = Date.now()
  return {
    // When the agent ran (agents in parallel branches overlap) and on which branch.
    started_at: new Date(finished - Math.max(0, result.duration_ms || 0)).toISOString(),
    finished_at: new Date(finished).toISOString(),
    ...(link?.branch ? { branch: link.branch } : {}),
    response: result.response.slice(0, 500),
    iterations: result.iterations,
    tool_calls: result.toolCalls.length,
    tokens: result.usage.total_tokens,
    duration_ms: result.duration_ms,
    ...(runId ? { agent_run_id: runId } : {}),
    ...(result.outputs ? { outputs: result.outputs } : {}),
    ...(result.parse_warning ? { parse_warning: result.parse_warning } : {}),
    ...(result.files?.length ? { generated_files: result.files.map((f) => f.name) } : {}),
    // "Use this workflow's data as context": its size and what it held (no values).
    ...(link?.workflow_data ? { workflow_data: link.workflow_data } : {}),
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
    ? { ...agentWorkflowVariables(outcome.result, link, outcome.outputConfig, params.agentName), _agent_node_output: agentNodeOutput(outcome.result, outcome.runId, link) }
    : { _agent_node_error: `Agent execution failed: ${outcome.result.error ?? 'unknown error'}`, _agent_node_output: agentNodeOutput(outcome.result, outcome.runId, link) }
  await enqueueResume({ tenantId: params.tenantId, eventId: link.event_id, variables, supabase: params.db })
}
