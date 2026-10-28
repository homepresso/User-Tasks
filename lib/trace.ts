/**
 * Trace ID helpers for cross-entity correlation.
 *
 * A trace_id is generated at the top of a chain (workflow trigger, manual agent
 * execution, MCP call) and propagated to every downstream entity so
 * the unified trace viewer can stitch them together:
 *
 *   workflow_run.trace_id  →  agent_runs.trace_id  →  integration_call_logs.trace_id
 *
 * Conventions:
 *   - If a caller already has a trace id, pass it through (don't mint a new one).
 *   - If not, mint one at the entry point and pass it everywhere.
 *   - Callers that don't care about tracing can ignore this entirely — all
 *     trace_id columns are nullable.
 */

/** Mint a fresh trace id. Use at the entry point of a chain. */
export function newTraceId(): string {
  // Node and modern browsers both have crypto.randomUUID
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback — unlikely to hit this in production but keeps the helper pure
  return 'trace-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36)
}

/** Use an existing trace id if provided, otherwise mint a new one. */
export function ensureTraceId(existing?: string | null): string {
  return existing && typeof existing === 'string' && existing.length > 0 ? existing : newTraceId()
}

/**
 * Caller context for downstream entities (integration calls, agent runs).
 * Attach this to every write so the trace viewer can reconstruct the call graph.
 */
export interface CallerContext {
  traceId: string
  /** Entity type that initiated the call. */
  callerType: 'workflow_node' | 'form_submit' | 'form_lookup' | 'mcp' | 'manual_test' | 'agent_tool' | 'api' | 'cron'
  /** ID of the calling entity (workflow_run_id, form_submission_id, agent_run_id, etc.) */
  callerId?: string | null
  /** If the caller is a workflow node, the node id — used to link back to a specific step. */
  callerNodeId?: string | null
}
