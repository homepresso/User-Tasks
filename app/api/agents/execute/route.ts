import { createClient, getCachedUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getUserPermissions } from '@/lib/permissions-server'
import { agentExecutionRateLimit } from '@/lib/rate-limit'
import { createServiceClient } from '@/lib/cron-auth'
import { AgentRunError } from '@/lib/agents/prepare'
import { loadAndRunAgent } from '@/lib/agents/run'
import { newTraceId } from '@/lib/trace'
import { coalescedAgentEvents } from '@/lib/agents/stream'

// Vercel's default function timeout (10-15s) is far shorter than an agent run
// can take. 60 is the Hobby-plan ceiling; raise to 300 once on a Pro+ plan.
export const maxDuration = 60

/**
 * The agent test console (designer playground): runs the saved agent as the
 * signed-in user and streams the loop's events as SSE — including the model's
 * reply token by token (`delta` events, `delta_reset` when a call is retried
 * after an error mid-stream). Closing the request cancels the run. `history`
 * carries the console conversation's earlier turns (multi-turn testing).
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile, error: profileError } = await supabase.from('users').select('current_tenant_id, tenant_id').eq('id', user.id).single()
  if (profileError || !profile) return NextResponse.json({ error: 'User profile not found' }, { status: 400 })
  const tenantId = String(profile.current_tenant_id ?? profile.tenant_id ?? '')
  if (!tenantId) return NextResponse.json({ error: 'No tenant' }, { status: 400 })

  // Running an agent is a privileged action (spends tokens, invokes tools).
  const perms = await getUserPermissions()
  if (!perms.has('agents.test')) {
    return NextResponse.json({ error: "Forbidden: the 'agents.test' permission is required to run agents" }, { status: 403 })
  }

  // Rate limit to bound LLM cost from a single actor / tenant.
  const throttled = await agentExecutionRateLimit(tenantId, user.id)
  if (throttled) {
    return NextResponse.json({ error: throttled.message }, { status: 429, headers: { 'Retry-After': String(Math.ceil(throttled.retryAfterMs / 1000)) } })
  }

  const body = await request.json().catch(() => ({}))
  const agentId = String(body?.agent_id ?? '').trim()
  const message = String(body?.message ?? '')
  if (!agentId || !message.trim()) {
    return NextResponse.json({ error: 'Missing agent_id or message' }, { status: 400 })
  }
  const history = Array.isArray(body?.history)
    ? body.history
        .filter((t: any) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
        .slice(-20)
        .map((t: any) => ({ role: t.role as 'user' | 'assistant', content: String(t.content).slice(0, 20_000) }))
    : []

  const db = createServiceClient()
  const encoder = new TextEncoder()
  const abort = new AbortController()
  request.signal?.addEventListener('abort', () => abort.abort())
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch { /* client gone */ }
      }
      // Streamed reply: text deltas coalesced; held back while the browser reads slowly (backpressure).
      const relay = coalescedAgentEvents<any>(send, () => (controller.desiredSize ?? 1) > 0)
      try {
        const outcome = await loadAndRunAgent({
          db, tenantId, agentId, message, history, actingUserId: user.id,
          callerType: 'manual', traceId: newTraceId(), signal: abort.signal,
          stream: body?.stream !== false,
          onEvent: (event) => relay.onEvent(event),
        })
        relay.close()
        const { result, runId } = outcome
        const cost = runId ? (await db.from('agent_runs').select('cost_amount, cost_currency, cost_status').eq('id', runId).maybeSingle()).data : null
        if (result.status === 'failed') {
          send({ type: 'error', error: result.error ?? 'Agent execution failed', run_id: runId })
        } else if (result.status === 'awaiting_approval') {
          send({ type: 'awaiting_approval', run_id: runId, task_id: outcome.approval?.taskId ?? null, pending: result.pending })
        } else {
          send({
            type: 'done', run_id: runId,
            result: { response: result.response, outputs: result.outputs ?? null, usage: result.usage, iterations: result.iterations, duration_ms: result.duration_ms, parse_warning: result.parse_warning ?? null, files: result.files ?? [], cost: cost ?? null, streamed: result.steps.some((st) => st.type === 'llm' && st.streamed) },
          })
        }
      } catch (err: any) {
        relay.close()
        send({ type: 'error', error: err instanceof AgentRunError ? err.message : (err?.message ?? 'Agent execution failed') })
      } finally {
        try { controller.close() } catch { /* closed */ }
      }
    },
    cancel() { abort.abort() },
  })

  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  })
}
