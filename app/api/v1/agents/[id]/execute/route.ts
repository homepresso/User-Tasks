import { NextRequest } from 'next/server'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { agentExecutionRateLimit } from '@/lib/rate-limit'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { enqueueAgentRun } from '@/lib/services/agents'
import { AgentRunError } from '@/lib/agents/prepare'
import { loadAndRunAgent } from '@/lib/agents/run'
import { newTraceId } from '@/lib/trace'
import { coalescedAgentEvents } from '@/lib/agents/stream'

// Vercel's default function timeout (10-15s) is far shorter than an agent run
// can take. 60 is the Hobby-plan ceiling; raise to 300 once on a Pro+ plan.
export const maxDuration = 60

/**
 * POST /api/v1/agents/{id}/execute — run an agent as the credential's user
 * (tenant keys: no acting user, so task / workflow write tools are refused).
 * Sync by default; `async: true` queues it (poll GET /agents/queue/{job_id});
 * `stream: true` streams Server-Sent Events (reply tokens as `delta`).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const { tenantId, supabase } = auth
  // Executing an agent requires the same permission as MCP agents_execute.
  const forbidden = requireApiPermission(auth, 'agents.test')
  if (forbidden) return forbidden
  const { id } = await params

  // Bound LLM cost per API key / tenant.
  const throttled = await agentExecutionRateLimit(String(tenantId), auth.keyId)
  if (throttled) return err(throttled.message, 429)

  const body = await request.json().catch(() => ({}))
  const message = String(body?.message ?? '')
  if (!message.trim()) return err('message is required')
  if (message.length > 100_000) return err('message exceeds the maximum length of 100000 characters')

  if (body.async) {
    try {
      return ok(await enqueueAgentRun(fromApiAuth(auth), id, { message, shared_context: body.shared_context, max_iterations: body.max_iterations }), 202)
    } catch (error) {
      if (isServiceError(error)) return err(error.message, error.status)
      return err(`Failed to enqueue: ${(error as Error)?.message}`, 500)
    }
  }

  const history = Array.isArray(body.history)
    ? body.history.filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string').slice(-20)
    : undefined

  // `stream: true` (or Accept: text/event-stream): Server-Sent Events — the
  // loop's events and the reply token by token (delta), then one `done` /
  // `error` / `awaiting_approval` event. Disconnecting cancels the run.
  const wantsStream = body.stream === true || (request.headers.get('accept') ?? '').includes('text/event-stream')
  if (wantsStream) {
    const encoder = new TextEncoder()
    const abort = new AbortController()
    request.signal?.addEventListener('abort', () => abort.abort())
    const sse = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch { /* client gone */ } }
        const relay = coalescedAgentEvents<any>(send, () => (controller.desiredSize ?? 1) > 0)
        try {
          const outcome = await loadAndRunAgent({
            db: supabase, tenantId: String(tenantId), agentId: id, message, history,
            actingUserId: auth.actingUserId ?? null, callerType: 'api', callerId: auth.keyId ?? null, traceId: newTraceId(),
            sharedContext: body.shared_context && typeof body.shared_context === 'object' ? body.shared_context : undefined,
            includeSharedContext: Boolean(body.shared_context),
            overrides: { maxIterations: body.max_iterations },
            stream: true, signal: abort.signal, onEvent: (event) => relay.onEvent(event),
          })
          relay.close()
          const { result, runId } = outcome
          if (result.status === 'awaiting_approval') send({ type: 'awaiting_approval', run_id: runId, approval_task_id: outcome.approval?.taskId ?? null, pending: result.pending })
          else if (result.status === 'failed') send({ type: 'error', run_id: runId, error: `Agent execution failed: ${result.error ?? 'unknown error'}` })
          else send({ type: 'done', run_id: runId, response: result.response, outputs: result.outputs ?? null, usage: result.usage, iterations: result.iterations, duration_ms: result.duration_ms })
        } catch (e: any) {
          relay.close()
          send({ type: 'error', error: e instanceof AgentRunError ? e.message : `Agent execution failed: ${e?.message ?? 'error'}` })
        } finally {
          try { controller.close() } catch { /* closed */ }
        }
      },
      cancel() { abort.abort() },
    })
    return new Response(sse, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
  }

  try {
    const outcome = await loadAndRunAgent({
      db: supabase, tenantId: String(tenantId), agentId: id, message, history,
      actingUserId: auth.actingUserId ?? null, callerType: 'api', callerId: auth.keyId ?? null, traceId: newTraceId(),
      sharedContext: body.shared_context && typeof body.shared_context === 'object' ? body.shared_context : undefined,
      includeSharedContext: Boolean(body.shared_context),
      overrides: { maxIterations: body.max_iterations },
    })
    const { result, runId } = outcome
    if (result.status === 'awaiting_approval') {
      return ok({ status: 'awaiting_approval', run_id: runId, approval_task_id: outcome.approval?.taskId ?? null, pending: result.pending }, 202)
    }
    // A real failure is a 502, not a 200 with an error string in the body.
    if (result.status === 'failed') {
      return err(`Agent execution failed: ${result.error ?? 'unknown error'}`, 502)
    }
    return ok({
      status: 'completed',
      run_id: runId,
      response: result.response,
      outputs: result.outputs ?? null,
      parse_warning: result.parse_warning ?? null,
      iterations: result.iterations,
      tool_calls: result.toolCalls.map((t) => ({ toolName: t.toolName, arguments: t.arguments, status: t.status, duration_ms: t.duration_ms })),
      usage: result.usage,
      duration_ms: result.duration_ms,
      files: result.files ?? [],
    })
  } catch (e: any) {
    if (e instanceof AgentRunError) return err(e.message, e.status)
    return err(`Agent execution failed: ${e?.message ?? 'error'}`, 500)
  }
}
