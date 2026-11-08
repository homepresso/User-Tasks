import { after, NextRequest, NextResponse } from 'next/server'
import { getCachedUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/cron-auth'
import { fromSession, isServiceError, type ServiceContext } from '@/lib/services/context'
import { fromSessionForTask } from '@/lib/actions/task-context'
import { AssistantRequestError, parseChatRequest, prepareAssistantTurn, runPreparedTurn } from '@/lib/assistants/chat'
import { DeltaCoalescer } from '@/lib/agents/stream'
import type { AssistantEvent } from '@/lib/assistants/types'
import type { TurnResult } from '@/lib/assistants/engine'
import { AgentJob, ProgressTracker, TranscriptRecorder, buildPlanTotal, isUuid, turnSummary } from '@/lib/assistants/background'

// A designer turn can make several model and tool calls (the engine's own budget is 240s).
export const maxDuration = 300

// Attached images travel as data URLs (lib/assistants/attachments-core caps each; the panel sends image bytes only for its latest messages).
const MAX_BODY_BYTES = 30_000_000

/**
 * The Agent's chat (the Agent panel — one assistant; form, task and building
 * assistants). Signed-in session only. Everything is decided server-side in
 * lib/assistants/chat.ts — availability for this person, limits, the
 * provider key, the instructions, the untrusted context and the tools — and
 * the turn is streamed back as Server-Sent Events (lib/assistants/types
 * AssistantEvent): text deltas, tool activity, value proposals, drafts,
 * confirmation cards, changed items, then the messages to keep and `done`.
 *
 * The turn runs independently of this response (lib/assistants/background.ts):
 * it is an `agent.turn` job, its first event names the job, and when the
 * browser goes away (or the panel closes) it continues in the background
 * and the bell tells the person when it is done. Stop is an explicit cancel
 * (POST /api/assistants/jobs/{id} {action: 'cancel'}).
 */
export async function POST(request: NextRequest) {
  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'The conversation is too long — start a new conversation' }, { status: 413 })
  }
  const text = await request.text().catch(() => '')
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'The conversation is too long — start a new conversation' }, { status: 413 })
  let body: unknown
  try { body = JSON.parse(text || '{}') } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  let chat: ReturnType<typeof parseChatRequest>
  let ctx: ServiceContext
  let prepared: Awaited<ReturnType<typeof prepareAssistantTurn>>
  const serviceDb = createServiceClient()
  try {
    chat = parseChatRequest(body)
    // A task acts in the task's own workspace (the person must be a member and see it).
    ctx = chat.context?.task_id ? await fromSessionForTask(chat.context.task_id) : await fromSession()
    prepared = await prepareAssistantTurn(ctx, chat, { serviceDb })
  } catch (error) {
    if (error instanceof AssistantRequestError) {
      return NextResponse.json({ error: error.message, code: error.code }, {
        status: error.status,
        ...(error.retryAfterMs ? { headers: { 'Retry-After': String(Math.ceil(error.retryAfterMs / 1000)) } } : {}),
      })
    }
    if (isServiceError(error)) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[assistants] prepare failed', error)
    return NextResponse.json({ error: 'The Agent could not start' }, { status: 500 })
  }

  // The turn runs on its own (lib/assistants/background.ts): the response is a live view of it.
  const b = body as Record<string, unknown>
  const turnId = isUuid(b.turn_id) ? b.turn_id : crypto.randomUUID()
  const conversationId = typeof b.conversation_id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(b.conversation_id) ? b.conversation_id : 'default'
  const jobStart = AgentJob.start(serviceDb, {
    tenantId: ctx.tenantId, userId: ctx.actorId!, turnId, conversationId, summary: turnSummary(chat.messages, chat.decision),
  }).catch(() => null)

  const encoder = new TextEncoder()
  const abort = new AbortController()
  const recorder = new TranscriptRecorder()
  const progress = new ProgressTracker(buildPlanTotal(chat.messages, chat.decision))
  let job: AgentJob | null = null
  const view: { controller: ReadableStreamDefaultController<Uint8Array> | null } = { controller: null }
  /** The browser's live view is gone (tab closed, reload, navigation). */
  let gone = false
  const sendRaw = (event: AssistantEvent) => {
    if (gone || !view.controller) return
    try { view.controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)) } catch { gone = true }
  }
  // Text deltas batched (fewer, larger events; held back while the browser reads slowly).
  const deltas = new DeltaCoalescer((t) => sendRaw({ type: 'delta', text: t }), { ready: () => gone || (view.controller?.desiredSize ?? 1) > 0 })
  const sendLive = (event: AssistantEvent) => {
    if (event.type === 'delta') { deltas.text(event.text); return }
    deltas.flush()
    sendRaw(event)
  }
  // No live view any more: the turn continues in the background (or stops, when it can't: no job, or the person's limit).
  const onDisconnect = () => {
    if (gone) return
    gone = true
    void jobStart.then(async (j) => {
      if (!j) { abort.abort(); return }
      const moved = await j.backgroundOnDisconnect().catch(() => ({ ok: false }))
      if (!moved.ok) abort.abort()
    })
  }
  request.signal?.addEventListener('abort', onDisconnect)
  const stream = new ReadableStream<Uint8Array>({
    start(c) { view.controller = c },
    cancel() { onDisconnect() },
  })

  void jobStart.then((j) => {
    job = j
    if (!j) return
    sendLive({ type: 'job', id: j.id, turn_id: turnId })
    j.watch(abort)
  })
  const onEvent = (event: AssistantEvent) => {
    recorder.push(event)
    const line = progress.onEvent(event)
    if (line) job?.noteProgress(line)
    sendLive(event)
  }
  const turn = (async () => {
    let result: TurnResult | null = null
    let failure: string | null = null
    try {
      result = await runPreparedTurn(ctx, prepared, chat, { serviceDb, onEvent, signal: abort.signal })
      deltas.close()
      sendLive({ type: 'messages', messages: result.newMessages })
      if (result.status === 'failed' || result.status === 'cancelled') sendLive({ type: 'error', error: result.error ?? 'The Agent failed', code: result.status })
      else sendLive({ type: 'done', status: result.status })
    } catch (error) {
      deltas.close()
      console.error('[assistants] turn failed', error)
      failure = 'The Agent failed — try again'
      sendLive({ type: 'error', error: failure })
    } finally {
      const delivered = !gone
      try { view.controller?.close() } catch { /* closed */ }
      const j = await jobStart
      if (j) await j.finish(result, recorder.transcript({ turnId, conversationId, result, error: failure }), { delivered }).catch((error) => console.error('[assistants] could not finish the job', error))
    }
  })()
  // Keep the invocation alive until the turn is done, even when the browser has gone.
  try { after(() => turn) } catch { /* no request scope (tests): the turn runs unawaited */ }
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' },
  })
}
