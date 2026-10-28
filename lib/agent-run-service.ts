import type { SupabaseClient } from '@supabase/supabase-js'
import type { AgentResult } from '@/lib/agent-executor'
import { writeAudit } from '@/lib/audit-log'

/**
 * Persists an agent execution to `agent_runs` with the correct status (completed
 * vs failed — see the executor's AgentResult.status) and emits a fire-and-forget
 * audit row. Centralizes what used to be five near-identical insert blocks across
 * the execute / widget-chat / v1 / queue callers so failure semantics, the
 * structured `outputs` column, and auditing stay consistent.
 *
 * Never throws — a run-record failure must not break the caller's response.
 */
export interface RecordAgentRunParams {
  supabase: SupabaseClient<any, any, any>
  tenantId: string
  agentId: string
  result: AgentResult
  model: string
  inputMessage: string
  actorId?: string | null
  callerType: 'manual' | 'embedded_widget' | 'api' | 'queued' | 'workflow_node'
  callerId?: string | null
  traceId?: string | null
  context?: any
  /** epoch ms the run started; defaults to now − result.duration_ms. */
  startedAtMs?: number
  /** Links the run back to its agent_queue job (queue path only). */
  queueJobId?: string | null
  /** When true, also write an audit row (default true). */
  audit?: boolean
}

/** Returns the inserted agent_runs id (or null on failure), for queue linkage. */
export async function recordAgentRun(params: RecordAgentRunParams): Promise<string | null> {
  const {
    supabase, tenantId, agentId, result, model, inputMessage,
    actorId = null, callerType, callerId = null, traceId = null, context = null, startedAtMs, queueJobId = null, audit = true,
  } = params

  const startIso = new Date(startedAtMs ?? (Date.now() - (result.duration_ms ?? 0))).toISOString()

  let runId: string | null = null
  try {
    const { data } = await (supabase as any).from('agent_runs').insert({
      agent_id: agentId,
      tenant_id: tenantId,
      actor_id: actorId,
      input_message: inputMessage,
      output_response: result.status === 'failed' ? null : result.response,
      outputs: result.outputs ?? null,
      iterations: result.iterations,
      tool_calls: result.toolCalls,
      usage: result.usage,
      duration_ms: result.duration_ms,
      status: result.status,
      error: result.error ?? null,
      model,
      total_tokens: (result.usage as any)?.total_tokens ?? null,
      input_tokens: (result.usage as any)?.prompt_tokens ?? null,
      output_tokens: (result.usage as any)?.completion_tokens ?? null,
      caller_type: callerType,
      caller_id: callerId,
      trace_id: traceId ?? callerId,
      context,
      ...(queueJobId ? { queue_job_id: queueJobId } : {}),
      started_at: startIso,
      completed_at: new Date().toISOString(),
    }).select('id').single()
    runId = (data as any)?.id ?? null
  } catch (err: any) {
    console.error('[agent-run-service] failed to persist agent_run:', err?.message)
  }

  if (audit) {
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
        total_tokens: (result.usage as any)?.total_tokens ?? null,
        iterations: result.iterations,
        status: result.status,
      },
    })
  }

  return runId
}
