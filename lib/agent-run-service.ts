import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentResult } from '@/lib/agent-executor'
import { writeAudit } from '@/lib/audit-log'
import { forStorage } from '@/lib/agents/safety'

/**
 * Persists an agent execution to `agent_runs` with the correct status
 * (completed / failed / awaiting_approval — see the executor's
 * AgentResult.status) and emits a fire-and-forget audit row. Every caller
 * (test console, REST, queue, Run Agent step, evaluations, approval resumes)
 * goes through here so failure semantics, the structured `outputs` column,
 * the step trace and auditing stay consistent.
 *
 * Writes need the service role (agent_runs has no client write grants since
 * 20261122000000): callers pass a service client.
 *
 * Tool-call arguments / results are stored redacted and bounded
 * (lib/agents/safety.ts forStorage); file contents never are.
 *
 * Never throws — a run-record failure must not break the caller's response.
 */
export type AgentCallerType = 'manual' | 'embedded_widget' | 'api' | 'queued' | 'workflow_node' | 'mcp' | 'eval'

export interface RecordAgentRunParams {
  supabase: SupabaseClient<any, any, any>
  tenantId: string
  agentId: string
  result: AgentResult
  model: string
  inputMessage: string
  actorId?: string | null
  callerType: AgentCallerType
  callerId?: string | null
  traceId?: string | null
  workflowRunId?: string | null
  context?: any
  /** epoch ms the run started; defaults to now − result.duration_ms. */
  startedAtMs?: number
  /** Links the run back to its agent_queue job (queue path only). */
  queueJobId?: string | null
  /** Update this run (an approval resume) instead of inserting a new one. */
  runId?: string | null
  /** Stored as paused_context while the run waits for approval (see lib/agents/approval.ts). */
  pausedContext?: Record<string, unknown> | null
  /** When true, also write an audit row (default true). */
  audit?: boolean
  /** Provider kind (lib/agents/provider.ts) — prices the run (lib/agents/costs.ts); absent = cost unknown. */
  provider?: string | null
  /** The agent version that ran (a published workflow's pin, else the current one). */
  agentVersion?: number | null
  /** Who started the run (may differ from the acting user); can read their own run without agents.view. */
  initiatedBy?: string | null
}

/** Tool calls as stored: redacted, bounded results. */
export function storedToolCalls(result: AgentResult) {
  return (result.toolCalls ?? []).map((t) => ({
    toolName: t.toolName,
    toolId: t.toolId,
    arguments: forStorage(t.arguments, 4_000),
    result: forStorage(t.result, 8_000),
    duration_ms: t.duration_ms,
    status: t.status ?? ((t.result && typeof t.result === 'object' && 'error' in t.result) ? 'error' : 'ok'),
    ...(t.approval ? { approval: t.approval } : {}),
  }))
}

/** Returns the agent_runs id (or null on failure), for queue linkage. */
export async function recordAgentRun(params: RecordAgentRunParams): Promise<string | null> {
  const {
    supabase, tenantId, agentId, result, model, inputMessage,
    actorId = null, callerType, callerId = null, traceId = null, workflowRunId = null, context = null, startedAtMs, queueJobId = null, audit = true,
  } = params

  const startIso = new Date(startedAtMs ?? (Date.now() - (result.duration_ms ?? 0))).toISOString()
  const waiting = result.status === 'awaiting_approval'
  // Cost at the prices in effect today, stored with the price used (never recomputed).
  const { priceRun } = await import('@/lib/agents/costs')
  const cost = await priceRun(supabase as any, tenantId, result, params.provider, model)
  const row: Record<string, unknown> = {
    output_response: result.status === 'completed' ? result.response : null,
    outputs: result.outputs ?? null,
    iterations: result.iterations,
    tool_calls: storedToolCalls(result),
    steps: cost.steps,
    usage: result.usage,
    cost_amount: cost.amount,
    cost_currency: cost.currency,
    cost_status: cost.status,
    price: cost.snapshot,
    duration_ms: result.duration_ms,
    status: result.status,
    error: result.error ?? null,
    model,
    total_tokens: result.usage?.total_tokens ?? null,
    input_tokens: result.usage?.prompt_tokens ?? null,
    output_tokens: result.usage?.completion_tokens ?? null,
    files: result.files?.length ? result.files : null,
    paused_at: waiting ? new Date().toISOString() : null,
    paused_context: waiting ? (params.pausedContext ?? null) : null,
    approval_event_id: waiting ? ((params.pausedContext as any)?.approval_event_id ?? null) : null,
    completed_at: waiting ? null : new Date().toISOString(),
  }

  let runId: string | null = params.runId ?? null
  const insertRow: Record<string, unknown> = {
    ...row,
    agent_id: agentId,
    tenant_id: tenantId,
    actor_id: actorId,
    input_message: inputMessage,
    caller_type: callerType,
    caller_id: callerId,
    trace_id: traceId ?? (callerId && /^[0-9a-f-]{36}$/i.test(callerId) ? callerId : null),
    workflow_run_id: workflowRunId,
    context,
    initiated_by: params.initiatedBy ?? actorId ?? null,
    ...(params.agentVersion != null ? { agent_version: params.agentVersion } : {}),
    ...(queueJobId ? { queue_job_id: queueJobId } : {}),
    started_at: startIso,
  }
  // Until migration 20261124000000 is applied the cost / initiator columns don't exist: write without them.
  const withoutNewColumns = (r: Record<string, unknown>) => {
    const { cost_amount: _a, cost_currency: _c, cost_status: _s, price: _p, initiated_by: _i, ...rest } = r
    return rest
  }
  const missingColumn = (error: any) => error?.code === 'PGRST204' || error?.code === '42703' || /column .*(cost_|price|initiated_by)/i.test(String(error?.message ?? ''))
  try {
    if (params.runId) {
      let { error } = await (supabase as any).from('agent_runs').update(row).eq('id', params.runId).eq('tenant_id', tenantId)
      if (error && missingColumn(error)) ({ error } = await (supabase as any).from('agent_runs').update(withoutNewColumns(row)).eq('id', params.runId).eq('tenant_id', tenantId))
      if (error) throw error
    } else {
      let { data, error } = await (supabase as any).from('agent_runs').insert(insertRow).select('id').single()
      if (error && missingColumn(error)) ({ data, error } = await (supabase as any).from('agent_runs').insert(withoutNewColumns(insertRow)).select('id').single())
      if (error) throw error
      runId = (data as any)?.id ?? null
    }
  } catch (err: any) {
    console.error('[agent-run-service] failed to persist agent_run:', err?.message)
  }

  if (audit && !waiting) {
    // Fire-and-forget — writeAudit never throws.
    void writeAudit({
      supabase,
      tenantId,
      actorId,
      objectType: 'agent_run',
      objectId: agentId,
      action: 'execute',
      summary: `Agent execution ${result.status}${result.error ? `: ${result.error}` : ''}`,
      metadata: {
        caller_type: callerType,
        model,
        total_tokens: result.usage?.total_tokens ?? null,
        ...(cost.status === 'priced' ? { cost_amount: cost.amount, cost_currency: cost.currency } : {}),
        iterations: result.iterations,
        status: result.status,
        ...(runId ? { agent_run_id: runId } : {}),
      },
    })
  }

  return runId
}
