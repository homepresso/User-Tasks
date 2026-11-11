/**
 * The Agent keeps working when the panel closes (server only).
 *
 * Every chat turn is a `public.user_jobs` row of kind `agent.turn`, created
 * when the turn starts and run by the chat request's own invocation, NOT by
 * the browser's connection:
 *
 *  - The route (app/api/assistants/chat) runs the turn independently of the
 *    SSE response and keeps the invocation alive with next/server after()
 *    (up to the route's maxDuration). The SSE stream is a live view of it.
 *  - The browser drops the live view (the tab closed, reloaded or navigated
 *    away): the turn is moved to the background (at most
 *    AGENT_BACKGROUND_LIMIT per person; beyond that it stops as before).
 *    Closing the panel while the tab stays open asks for the same thing
 *    (POST /api/assistants/jobs/{id} {action: 'background'}), and the live
 *    view goes on.
 *  - While it runs the invocation polls the row every AGENT_JOB_POLL_MS:
 *    a cancel request (the panel's Stop, the Jobs panel's Cancel) aborts
 *    the turn at its next step; a backgrounded turn writes its progress
 *    ("Creating form “Patient intake” — 3 of 8 items") for the Jobs panel.
 *  - When it ends, a turn the browser received in full and that was never
 *    backgrounded is deleted (normal turns leave nothing behind). Otherwise
 *    the row keeps the transcript — the replayable events and the messages
 *    to append, size-capped, secrets masked — in `checkpoint` (never part of
 *    the job view or the jobs API), and a backgrounded turn notifies the
 *    bell: finished, needs your confirmation, or stopped. The browser merges
 *    the transcript into the conversation (idempotent by turn id) and
 *    acknowledges it, which clears the transcript; the row itself expires
 *    after AGENT_TRANSCRIPT_TTL_HOURS (purgeExpiredUserJobs).
 *  - An invocation that dies mid-turn leaves a running row whose lease
 *    expires; the job runner then fails it with a notification (the
 *    `agent.turn` kind, lib/user-jobs/kinds/agent.ts).
 *
 * Privacy: rows are written with the service role; the owner reads their own
 * (RLS, and every helper here filters by tenant + user); workspace admins do
 * not see other people's Agent jobs (migration 20261231000002).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { redactSecrets } from '@/lib/agents/safety'
import type { TurnResult } from './engine'
import type { AssistantEvent, ChatMessage } from './types'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role rows */

export const AGENT_JOB_KIND = 'agent.turn'
/** Background Agent jobs one person may have running at once. */
export const AGENT_BACKGROUND_LIMIT = 2
export const AGENT_JOB_POLL_MS = 2_000
/** Poll interval of running turns (tests shorten it). */
export const agentJobTiming = { pollMs: AGENT_JOB_POLL_MS }
/** Longer than the chat route's maxDuration (300 s): the lease only expires when the invocation died. */
export const AGENT_JOB_LEASE_MS = 330_000
export const AGENT_TRANSCRIPT_TTL_HOURS = 24
export const MAX_TRANSCRIPT_EVENTS_CHARS = 256 * 1024
export const MAX_TRANSCRIPT_MESSAGES_CHARS = 768 * 1024
const TOOL_CONTENT_WHEN_CAPPED = 2_000

export type AgentOutcome = TurnResult['status']

/** What the browser merges into the conversation. */
export interface AgentTranscript {
  v: 1
  turn_id: string
  conversation_id: string
  outcome: AgentOutcome
  /** Replayable panel events (text deltas coalesced; no `messages` / `done`). */
  events: AssistantEvent[]
  /** The messages to append to the conversation (what the `messages` event carries). */
  messages: ChatMessage[]
  error: string | null
  /** Events were dropped to fit the cap (the messages are kept). */
  truncated?: boolean
}

/** An Agent job as the panel sees it (GET /api/assistants/jobs). */
export interface AgentJobView {
  id: string
  turn_id: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  background: boolean
  title: string
  message: string | null
  progress: number
  error: string | null
  created_at: string
  finished_at: string | null
  /** Finished and not yet merged. */
  transcript: AgentTranscript | null
}

const hoursFromNow = (now: number, hours: number) => new Date(now + hours * 3_600_000).toISOString()
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** "Build a patient intake process" → the job title's short summary of the request. */
export function turnSummary(history: ChatMessage[], decision?: { approved: boolean } | null, max = 60): string {
  if (decision) {
    const last = [...history].reverse().find((m) => m.role === 'user')
    const base = last ? turnSummary([last], null, max - 12) : 'your change'
    return decision.approved ? `${base} (confirmed)` : base
  }
  const last = [...history].reverse().find((m) => m.role === 'user')
  let text = String(last?.content ?? '').replace(/\s+/g, ' ').trim()
  if (!text && last?.attachments?.length) text = 'the attached file(s)'
  if (!text) return 'your request'
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text
}

/** Items a confirmed build plan will create (for "3 of 8 items"), else null. */
export function buildPlanTotal(history: ChatMessage[], decision?: { tool_call_id: string; approved: boolean } | null): number | null {
  if (!decision?.approved) return null
  for (let i = history.length - 1; i >= 0; i--) {
    const call = history[i].tool_calls?.find((c) => c.id === decision.tool_call_id)
    if (!call) continue
    if (call.function.name !== 'build_plan' && call.function.name !== 'build_plan_continue') return null
    try {
      const args = JSON.parse(call.function.arguments || '{}')
      const items = Array.isArray(args.items) ? args.items.length : 0
      const created = Array.isArray(args.created) ? args.created.length : 0
      return items > created ? items - created : null
    } catch { return null }
  }
  return null
}

/** The Jobs panel's progress line, from the turn's events. */
export class ProgressTracker {
  private label: string | null = null
  private created = 0
  private started = 0
  constructor(private readonly total: number | null = null) {}

  /** The new progress line (and percent), or null when unchanged. */
  onEvent(event: AssistantEvent): { message: string; percent: number | null } | null {
    if (event.type === 'tool_start') { this.label = event.label; this.started++ }
    else if (event.type === 'changed' && event.action === 'created') this.created++
    else if (event.type === 'confirm') this.label = 'Waiting for your confirmation'
    else if (event.type === 'choice') this.label = 'Waiting for your answer'
    else return null
    return this.current()
  }

  current(): { message: string; percent: number | null } {
    const label = this.label ?? 'Thinking'
    if (this.total) {
      const done = Math.min(this.created, this.total)
      return { message: `${label} — ${Math.min(done + 1, this.total)} of ${this.total} items`, percent: Math.round((done / this.total) * 100) }
    }
    return { message: `${label}…`.replace(/……$/, '…'), percent: null }
  }
}

/** Collects the turn's events for replay: deltas coalesced, secrets masked. */
export class TranscriptRecorder {
  readonly events: AssistantEvent[] = []

  push(event: AssistantEvent) {
    if (event.type === 'messages' || event.type === 'done' || event.type === 'job' || event.type === 'error') return
    const last = this.events[this.events.length - 1]
    if (event.type === 'delta' && last?.type === 'delta') { last.text += event.text; return }
    this.events.push(event.type === 'delta' ? { type: 'delta', text: event.text } : event)
  }

  transcript(input: { turnId: string; conversationId: string; result: TurnResult | null; error?: string | null }): AgentTranscript {
    return capTranscript({
      v: 1,
      turn_id: input.turnId,
      conversation_id: input.conversationId,
      outcome: input.result?.status ?? 'failed',
      events: redactSecrets(this.events),
      messages: input.result?.newMessages ?? [],
      error: input.error ?? input.result?.error ?? null,
    })
  }
}

/** Fit the transcript into the caps: drop events first (keep the messages), then shorten tool results. */
export function capTranscript(t: AgentTranscript): AgentTranscript {
  let out = t
  if (JSON.stringify(out.events).length > MAX_TRANSCRIPT_EVENTS_CHARS) {
    // Keep the cards (confirmations, changes, questions) and the final text; drop the rest.
    const keep = out.events.filter((e) => e.type === 'confirm' || e.type === 'changed' || e.type === 'choice' || e.type === 'proposal' || e.type === 'draft' || e.type === 'outcome_suggestion' || e.type === 'info_card')
    const events = JSON.stringify(keep).length > MAX_TRANSCRIPT_EVENTS_CHARS ? keep.filter((e) => e.type === 'confirm') : keep
    out = { ...out, events, truncated: true }
  }
  if (JSON.stringify(out.messages).length > MAX_TRANSCRIPT_MESSAGES_CHARS) {
    const messages = out.messages.map((m) => (m.role === 'tool' && (m.content?.length ?? 0) > TOOL_CONTENT_WHEN_CAPPED
      ? { ...m, content: `${m.content!.slice(0, TOOL_CONTENT_WHEN_CAPPED)}… [the rest of this result was too long to keep]` }
      : m))
    out = { ...out, messages, truncated: true }
  }
  if (JSON.stringify(out.messages).length > MAX_TRANSCRIPT_MESSAGES_CHARS) {
    // Still too big (long answers): keep the final assistant answer only.
    const final = [...out.messages].reverse().find((m) => m.role === 'assistant' && !m.tool_calls?.length)
    out = { ...out, messages: final ? [{ role: 'assistant', content: String(final.content ?? '').slice(0, 100_000) }] : [], truncated: true }
  }
  return out
}

// ── The running turn's job ──────────────────────────────────────────────────

export interface StartAgentJobInput {
  tenantId: string
  userId: string
  turnId: string
  conversationId: string
  summary: string
}

interface JobFlags { cancel: boolean; background: boolean }

/** The job of a turn running in this invocation (the chat route). */
export class AgentJob {
  background = false
  cancelRequested = false
  private timer: ReturnType<typeof setInterval> | null = null
  private lastProgress: string | null = null
  private pendingProgress: { message: string; percent: number | null } | null = null
  private finished = false

  constructor(
    private readonly db: SupabaseClient,
    readonly id: string,
    readonly holder: string,
    readonly input: StartAgentJobInput,
    private readonly now: () => number = Date.now,
  ) {}

  /** Create the job row (running, leased to this invocation). Null when user_jobs is unavailable. */
  static async start(db: SupabaseClient, input: StartAgentJobInput, now: () => number = Date.now): Promise<AgentJob | null> {
    const id = crypto.randomUUID()
    const holder = `agent-${crypto.randomUUID().slice(0, 12)}`
    const t = now()
    const { error } = await (db as any).from('user_jobs').insert({
      id,
      tenant_id: input.tenantId,
      user_id: input.userId,
      kind: AGENT_JOB_KIND,
      title: `Agent: ${input.summary}`.slice(0, 200),
      params: { turn_id: input.turnId, conversation_id: input.conversationId, background: false },
      origin: { source: 'ui', auth_kind: 'session' },
      status: 'running',
      message: 'Thinking…',
      // The runner fails the job (with a notification) if this invocation dies: one claim, no retry.
      attempts: 0,
      max_attempts: 1,
      lease_owner: holder,
      lease_expires_at: new Date(t + AGENT_JOB_LEASE_MS).toISOString(),
      heartbeat_at: new Date(t).toISOString(),
      started_at: new Date(t).toISOString(),
      idempotency_key: input.turnId,
      expires_at: hoursFromNow(t, AGENT_TRANSCRIPT_TTL_HOURS),
    })
    if (error) {
      console.warn('[assistants] background job unavailable:', error.message)
      return null
    }
    return new AgentJob(db, id, holder, input, now)
  }

  /** Poll for cancel / background until finish(); a cancel aborts the turn. */
  watch(abort: AbortController, intervalMs = agentJobTiming.pollMs) {
    if (this.timer || this.finished) return
    this.timer = setInterval(() => {
      void this.refresh().then((flags) => {
        if (flags.cancel) abort.abort()
        else void this.flushProgress()
      }).catch(() => undefined)
    }, intervalMs)
    ;(this.timer as any).unref?.()
  }

  async refresh(): Promise<JobFlags> {
    const { data } = await (this.db as any).from('user_jobs').select('cancel_requested_at, params, status').eq('id', this.id).maybeSingle()
    if (data) {
      this.cancelRequested = Boolean(data.cancel_requested_at)
      this.background = data.params?.background === true
    }
    return { cancel: this.cancelRequested, background: this.background }
  }

  /** Remember the latest progress; written while backgrounded (at most once per poll). */
  noteProgress(progress: { message: string; percent: number | null }) {
    this.pendingProgress = progress
  }

  private async flushProgress() {
    const p = this.pendingProgress
    if (!this.background || !p || p.message === this.lastProgress || this.finished) return
    this.lastProgress = p.message
    await (this.db as any).from('user_jobs').update({
      message: p.message.slice(0, 500),
      ...(p.percent !== null ? { progress: Math.max(0, Math.min(99, p.percent)) } : {}),
      heartbeat_at: new Date(this.now()).toISOString(),
    }).eq('id', this.id).eq('lease_owner', this.holder)
  }

  /** The browser dropped the live view: continue in the background if the person has room. */
  async backgroundOnDisconnect(): Promise<{ ok: boolean; reason?: string }> {
    // Stop sends its cancel before dropping the connection: a stopped turn is not moved to the background.
    if ((await this.refresh().catch(() => ({ cancel: false }))).cancel) return { ok: false, reason: 'cancelled' }
    const result = await setAgentJobBackground(this.db, { tenantId: this.input.tenantId, userId: this.input.userId, jobId: this.id, background: true })
    if (result.background) { this.background = true; await this.flushProgress().catch(() => undefined) }
    return { ok: result.background, reason: result.refused }
  }

  /**
   * The turn ended. `delivered`: the browser's live view got the final
   * messages. A delivered, never-backgrounded turn (and a turn the person
   * stopped while watching) leaves nothing; otherwise the transcript is kept
   * for the browser to merge and a backgrounded turn notifies the bell.
   */
  async finish(result: TurnResult | null, transcript: AgentTranscript, opts: { delivered: boolean }): Promise<'deleted' | 'kept'> {
    this.finished = true
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    await this.refresh().catch(() => undefined)
    const outcome: AgentOutcome = result?.status ?? 'failed'
    const status = outcome === 'cancelled' ? 'cancelled' : outcome === 'failed' ? 'failed' : 'succeeded'
    if (!this.background && (opts.delivered || outcome === 'cancelled')) {
      await (this.db as any).from('user_jobs').delete().eq('id', this.id).eq('lease_owner', this.holder)
      return 'deleted'
    }
    const t = this.now()
    const error = status === 'failed' ? (transcript.error ?? 'The Agent failed') : null
    const question = awaitingAnswer(outcome, transcript)
    const summary = outcome === 'awaiting_confirmation' ? 'Waiting for your confirmation'
      : question ? 'Waiting for your answer'
      : outcome === 'completed' ? completedSummary(transcript)
      : outcome === 'cancelled' ? 'Stopped'
      : null
    const { data } = await (this.db as any).from('user_jobs').update({
      status,
      progress: status === 'succeeded' ? 100 : undefined,
      message: (summary ?? error ?? '').slice(0, 500) || null,
      result: summary ? { summary } : null,
      error: error ? error.slice(0, 2_000) : null,
      checkpoint: { agent: transcript },
      finished_at: new Date(t).toISOString(),
      expires_at: hoursFromNow(t, AGENT_TRANSCRIPT_TTL_HOURS),
      lease_owner: null,
      lease_expires_at: null,
    }).eq('id', this.id).eq('lease_owner', this.holder).select('id').maybeSingle()
    if (data && this.background && status !== 'cancelled') {
      await notifyAgentOutcome(this.db, { ...this.input, jobId: this.id, outcome, error, question }).catch(() => undefined)
    }
    return 'kept'
  }
}

/** The turn ended on a question with answer buttons (ask_user / ask_where_to_build): it waits for the person's answer. */
export function awaitingAnswer(outcome: AgentOutcome, t: Pick<AgentTranscript, 'events'>): boolean {
  if (outcome !== 'completed') return false
  const cards = t.events.filter((e) => e.type === 'choice' || e.type === 'confirm' || e.type === 'changed')
  return cards[cards.length - 1]?.type === 'choice'
}

function completedSummary(t: AgentTranscript): string {
  const changed = t.events.filter((e) => e.type === 'changed').length
  return changed ? `Done — ${changed} item${changed === 1 ? '' : 's'} changed` : 'Done'
}

/** The bell: "Agent finished: …", "Agent needs your confirmation: …", "Agent needs your answer: …" or "Agent stopped: …". */
export async function notifyAgentOutcome(db: SupabaseClient, input: StartAgentJobInput & { jobId: string; outcome: AgentOutcome; error: string | null; question?: boolean }) {
  const type = input.question ? 'agent_question' : input.outcome === 'completed' ? 'agent_done' : input.outcome === 'awaiting_confirmation' ? 'agent_confirm' : 'agent_failed'
  const title = input.question ? `Agent needs your answer: ${input.summary}`
    : input.outcome === 'completed' ? `Agent finished: ${input.summary}`
    : input.outcome === 'awaiting_confirmation' ? `Agent needs your confirmation: ${input.summary}`
    : `Agent stopped: ${input.error ?? 'something went wrong'}`
  await (db as any).from('notifications').insert({
    user_id: input.userId,
    tenant_id: input.tenantId,
    type,
    title: title.slice(0, 300),
    body: input.outcome === 'failed' ? input.summary : input.question ? 'Open the Agent and choose an answer.' : 'Open the Agent to see the result.',
    job_id: input.jobId,
  })
}

// ── The panel's requests (/api/assistants/jobs) ─────────────────────────────

export interface AgentJobOwner { tenantId: string; userId: string }

async function ownRow(db: SupabaseClient, owner: AgentJobOwner, jobId: string, columns = 'id, status, params, cancel_requested_at'): Promise<any | null> {
  if (!isUuid(jobId)) return null
  const { data } = await (db as any).from('user_jobs').select(columns)
    .eq('id', jobId).eq('tenant_id', owner.tenantId).eq('user_id', owner.userId).eq('kind', AGENT_JOB_KIND).maybeSingle()
  return data ?? null
}

/** Running background Agent jobs of a person (other than `exceptId`). */
export async function countBackgroundAgentJobs(db: SupabaseClient, owner: AgentJobOwner, exceptId?: string): Promise<number> {
  const { data } = await (db as any).from('user_jobs').select('id')
    .eq('user_id', owner.userId).eq('kind', AGENT_JOB_KIND).eq('status', 'running').eq('params->>background', 'true')
    .limit(AGENT_BACKGROUND_LIMIT + 5)
  return ((data ?? []) as Array<{ id: string }>).filter((r) => r.id !== exceptId).length
}

export const BACKGROUND_LIMIT_MESSAGE = `You already have ${AGENT_BACKGROUND_LIMIT} Agent jobs running in the background. Wait for one to finish, or keep the Agent open.`

/** Move a running turn to the background (capped per person) or back (the panel is open again). */
export async function setAgentJobBackground(db: SupabaseClient, input: AgentJobOwner & { jobId: string; background: boolean }): Promise<{ background: boolean; status: string | null; refused?: string }> {
  const row = await ownRow(db, input, input.jobId)
  if (!row) return { background: false, status: null, refused: 'not_found' }
  if (row.status !== 'running') return { background: row.params?.background === true, status: row.status }
  if (row.params?.background === input.background) return { background: input.background, status: row.status }
  if (input.background && await countBackgroundAgentJobs(db, input, row.id) >= AGENT_BACKGROUND_LIMIT) {
    return { background: false, status: row.status, refused: 'limit' }
  }
  await (db as any).from('user_jobs').update({ params: { ...(row.params ?? {}), background: input.background } })
    .eq('id', row.id).eq('status', 'running')
  return { background: input.background, status: row.status }
}

/** Stop a running turn at its next step (the panel's Stop; the Jobs panel uses cancelJob). */
export async function cancelAgentJob(db: SupabaseClient, input: AgentJobOwner & { jobId: string }): Promise<boolean> {
  const row = await ownRow(db, input, input.jobId)
  if (!row || row.status !== 'running') return false
  await (db as any).from('user_jobs').update({ cancel_requested_at: new Date().toISOString(), message: 'Stopping…' })
    .eq('id', row.id).eq('status', 'running')
  return true
}

/** The browser merged the transcript: drop it (the row stays for the Jobs panel until it expires). */
export async function ackAgentJob(db: SupabaseClient, input: AgentJobOwner & { jobId: string; read?: boolean }): Promise<boolean> {
  const row = await ownRow(db, input, input.jobId)
  if (!row || row.status === 'running' || row.status === 'queued') return false
  if (row.params?.background === true) {
    await (db as any).from('user_jobs').update({ checkpoint: { acked: true } }).eq('id', row.id)
  } else {
    // Never shown in the Jobs panel: nothing to keep.
    await (db as any).from('user_jobs').delete().eq('id', row.id)
  }
  if (input.read) {
    await (db as any).from('notifications').update({ is_read: true }).eq('user_id', input.userId).eq('job_id', row.id).eq('is_read', false)
  }
  return true
}

/** The person's Agent jobs for one conversation: running ones, and finished ones not merged yet (with the transcript). */
export async function listAgentJobs(db: SupabaseClient, input: AgentJobOwner & { conversationId: string }): Promise<AgentJobView[]> {
  const { data, error } = await (db as any).from('user_jobs')
    .select('id, status, params, title, message, progress, error, created_at, finished_at, checkpoint, cancel_requested_at')
    .eq('tenant_id', input.tenantId).eq('user_id', input.userId).eq('kind', AGENT_JOB_KIND)
    .eq('params->>conversation_id', input.conversationId)
    .order('created_at', { ascending: true }).limit(20)
  if (error) return []
  const out: AgentJobView[] = []
  for (const row of (data ?? []) as any[]) {
    const active = row.status === 'running' || row.status === 'queued'
    let transcript = (row.checkpoint?.agent ?? null) as AgentTranscript | null
    // Failed by the job runner (the invocation died mid-turn): nothing to merge but the error.
    if (!active && !transcript && row.status === 'failed' && !row.checkpoint?.acked) {
      transcript = { v: 1, turn_id: String(row.params?.turn_id ?? ''), conversation_id: input.conversationId, outcome: 'failed', events: [], messages: [], error: row.error ?? 'The Agent stopped before it finished' }
    }
    if (!active && !transcript) continue
    out.push({
      id: row.id,
      turn_id: String(row.params?.turn_id ?? ''),
      status: row.status,
      background: row.params?.background === true,
      title: row.title,
      message: row.message,
      progress: row.progress ?? 0,
      error: row.error,
      created_at: row.created_at,
      finished_at: row.finished_at,
      transcript: active ? null : transcript,
    })
  }
  return out
}
