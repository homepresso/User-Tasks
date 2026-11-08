/**
 * The Agent keeps working when its panel closes (lib/assistants/background.ts,
 * app/api/assistants/chat + /api/assistants/jobs): every turn is an
 * `agent.turn` job run by the chat request's invocation, not the browser's
 * connection. The provider is always a mocked fetch; the database is the
 * in-memory fake. (RLS on the real database: user-jobs-db.test.ts.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const afterTasks: Promise<unknown>[] = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => Promise<unknown>) => { afterTasks.push(task()) },
}))
let fake: FakeSupabase
vi.mock('@/lib/cron-auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/cron-auth')>()), createServiceClient: () => fake.client }))
vi.mock('@/lib/supabase/server', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/supabase/server')>()), getCachedUser: vi.fn(async () => ({ id: USER })) }))
const T = '0c000000-0000-4000-8000-00000000000a'
const USER = '0c000000-0000-4000-8000-000000000001'
const OTHER = '0c000000-0000-4000-8000-000000000002'
let actor = USER
vi.mock('@/lib/services/context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/services/context')>()),
  fromSession: vi.fn(async () => ({ db: fake.client, supabase: fake.client, tenantId: T, actorId: actor, permissions: new Set(['workflows.view']), authKind: 'session', source: 'ui' })),
}))

/** The mocked provider: replies in order, each after `delayMs`. */
let llm: { replies: Array<{ content?: string | null; tool_calls?: any[]; httpStatus?: number }>; delayMs: number; calls: number }
const fetchImpl = (async (_url: any, init: any) => {
  const reply = llm.replies[Math.min(llm.calls++, llm.replies.length - 1)]
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, llm.delayMs)
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(Object.assign(new Error('aborted'), { name: 'AbortError' })) })
  })
  if (reply.httpStatus) return new Response(JSON.stringify({ error: { message: 'Provider is down' } }), { status: reply.httpStatus, headers: { 'content-type': 'application/json' } })
  return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls }, finish_reason: reply.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as unknown as typeof fetch
const call = (id: string, name: string, args: unknown = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

vi.mock('@/lib/assistants/chat', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/assistants/chat')>()
  const { runAssistantTurn } = await import('@/lib/assistants/engine')
  const { askUserTool } = await import('@/lib/assistants/tools/ask-user')
  return {
    ...real,
    prepareAssistantTurn: vi.fn(async () => ({
      capability: 'designer', profile: null, instructions: 'TEST', context: null,
      connection: { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: {}, baseUrl: 'https://llm.test' },
      limits: { maxIterations: 6, maxTokens: 100_000, maxOutputTokens: 1000, timeoutMs: 30_000 },
      tools: [
        { name: 'slow_step', description: 'A step', parameters: { type: 'object', properties: {} }, mode: 'read', label: (): string => 'Working on a step', run: async () => { await new Promise((r) => setTimeout(r, 30)); return { result: { ok: true } } } },
        { name: 'forms_create', description: 'Create a form', parameters: { type: 'object', properties: {} }, mode: 'write', label: (): string => 'Creating a form', confirm: async () => ({ title: 'Create form “Intake”', lines: ['A new form'], warnings: [] }), run: async () => ({ result: { ok: true } }) },
        askUserTool(),
      ],
    })),
    runPreparedTurn: vi.fn(async (_ctx: any, prepared: any, request: any, deps: any) => runAssistantTurn({
      connection: prepared.connection, instructions: prepared.instructions, context: null, history: request.messages, tools: prepared.tools,
      decision: request.decision, limits: prepared.limits, onEvent: deps.onEvent, signal: deps.signal, fetchImpl,
    })),
  }
})

import { POST as chatRoute } from '@/app/api/assistants/chat/route'
import { GET as listRoute } from '@/app/api/assistants/jobs/route'
import { POST as jobRoute } from '@/app/api/assistants/jobs/[id]/route'
import {
  AGENT_BACKGROUND_LIMIT, AGENT_JOB_KIND, AgentJob, agentJobTiming, buildPlanTotal, capTranscript, MAX_TRANSCRIPT_EVENTS_CHARS, MAX_TRANSCRIPT_MESSAGES_CHARS,
  ProgressTracker, TranscriptRecorder, ackAgentJob, cancelAgentJob, listAgentJobs, setAgentJobBackground, turnSummary,
} from '@/lib/assistants/background'
import { getJobKind, isUiJobKind } from '@/lib/user-jobs/kinds'
import { toJobView } from '@/lib/user-jobs/view'
import { cancelJob, listJobs } from '@/lib/services/user-jobs'
import { SseParser } from '@/lib/agents/stream'
import type { AssistantEvent } from '@/lib/assistants/types'

const CONV = 'conv1'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const jobs = () => (fake.tables.user_jobs ?? []) as any[]
const notes = () => (fake.tables.notifications ?? []) as any[]

beforeEach(() => {
  fake = createFakeSupabase({ user_jobs: [], notifications: [] })
  actor = USER
  afterTasks.length = 0
  agentJobTiming.pollMs = 25
  llm = { replies: [{ content: 'Hello' }], delayMs: 5, calls: 0 }
})
afterEach(async () => { await Promise.allSettled(afterTasks) })

/** Start a chat turn; returns the reader of its live view and a way to drop it. */
async function startTurn(body: Record<string, unknown> = {}) {
  const browser = new AbortController()
  const turnId = crypto.randomUUID()
  const request = new NextRequest('https://app.test/api/assistants/chat', {
    method: 'POST', signal: browser.signal,
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Build a patient intake process' }], turn_id: turnId, conversation_id: CONV, ...body }),
  })
  const response = await chatRoute(request)
  expect(response.status).toBe(200)
  const reader = response.body!.getReader()
  const parser = new SseParser()
  const events: AssistantEvent[] = []
  const readUntil = async (pred: (e: AssistantEvent) => boolean) => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return null
      for (const ev of parser.push(value)) {
        const event = JSON.parse(ev.data) as AssistantEvent
        events.push(event)
        if (pred(event)) return event
      }
    }
  }
  const disconnect = () => { browser.abort(); void reader.cancel().catch(() => undefined) }
  const finished = async () => { await Promise.allSettled(afterTasks) }
  return { turnId, events, readUntil, disconnect, finished }
}

describe('the chat route runs the turn as a job', () => {
  it('a normal turn streams as before and leaves nothing behind', async () => {
    const turn = await startTurn()
    await turn.readUntil((e) => e.type === 'done')
    await turn.finished()
    const types = turn.events.map((e) => e.type)
    expect(types).toContain('job')
    expect(types.slice(-2)).toEqual(['messages', 'done'])
    expect(jobs()).toEqual([]) // delivered, never backgrounded: deleted
    expect(notes()).toEqual([])
  })

  it('closing the tab mid-turn does not abort: the job continues in the background, keeps its transcript and notifies', async () => {
    llm = { replies: [{ content: 'Let me work.', tool_calls: [call('c1', 'slow_step')] }, { content: 'All built.' }], delayMs: 120, calls: 0 }
    const turn = await startTurn()
    const jobEvent = await turn.readUntil((e) => e.type === 'job') as Extract<AssistantEvent, { type: 'job' }>
    turn.disconnect()
    await sleep(30)
    expect(jobs()[0]).toMatchObject({ id: jobEvent.id, kind: AGENT_JOB_KIND, status: 'running', params: { background: true, turn_id: turn.turnId, conversation_id: CONV } })
    await turn.finished()
    const row = jobs()[0]
    expect(row.status).toBe('succeeded')
    expect(row.checkpoint.agent.outcome).toBe('completed')
    expect(row.checkpoint.agent.messages.map((m: any) => m.role)).toEqual(['assistant', 'tool', 'assistant'])
    expect(row.checkpoint.agent.events.some((e: any) => e.type === 'tool_end' && e.ok)).toBe(true)
    expect(llm.calls).toBe(2) // the model was called again after the disconnect
    expect(notes()).toEqual([expect.objectContaining({ user_id: USER, type: 'agent_done', title: 'Agent finished: Build a patient intake process', job_id: row.id })])
  })

  it('closing the panel (tab open) moves it to the background; the live view still gets the result', async () => {
    llm = { replies: [{ tool_calls: [call('c1', 'slow_step')] }, { content: 'Done.' }], delayMs: 80, calls: 0 }
    const turn = await startTurn()
    const jobEvent = await turn.readUntil((e) => e.type === 'job') as Extract<AssistantEvent, { type: 'job' }>
    const res = await jobRoute(new NextRequest(`https://app.test/api/assistants/jobs/${jobEvent.id}`, { method: 'POST', body: JSON.stringify({ action: 'background' }) }), { params: Promise.resolve({ id: jobEvent.id }) })
    expect(await res.json()).toMatchObject({ background: true })
    await sleep(60)
    expect(jobs()[0].message).toMatch(/Working on a step|Thinking/) // progress for the Jobs panel
    await turn.readUntil((e) => e.type === 'done')
    await turn.finished()
    expect(turn.events.find((e) => e.type === 'messages')).toBeTruthy()
    expect(jobs()[0].status).toBe('succeeded')
    expect(notes()).toHaveLength(1)
  })

  it('Stop cancels: the cancel lands before the connection drops, so the turn stops and is not backgrounded', async () => {
    llm = { replies: [{ tool_calls: [call('c1', 'slow_step')] }, { tool_calls: [call('c2', 'slow_step')] }, { content: 'never' }], delayMs: 150, calls: 0 }
    const turn = await startTurn()
    const jobEvent = await turn.readUntil((e) => e.type === 'job') as Extract<AssistantEvent, { type: 'job' }>
    expect(await cancelAgentJob(fake.client, { tenantId: T, userId: USER, jobId: jobEvent.id })).toBe(true)
    turn.disconnect()
    await turn.finished()
    expect(llm.calls).toBeLessThanOrEqual(1)
    expect(jobs()).toEqual([]) // stopped while watched: nothing kept
    expect(notes()).toEqual([])
  })

  it('cancel from the Jobs panel stops a background job at its next step (no notification)', async () => {
    llm = { replies: [{ tool_calls: [call('c1', 'slow_step')] }, { tool_calls: [call('c2', 'slow_step')] }, { content: 'never' }], delayMs: 150, calls: 0 }
    const turn = await startTurn()
    const jobEvent = await turn.readUntil((e) => e.type === 'job') as Extract<AssistantEvent, { type: 'job' }>
    turn.disconnect()
    await sleep(30)
    await cancelJob({ db: fake.client, supabase: fake.client, tenantId: T, actorId: USER, permissions: new Set(), authKind: 'session', source: 'ui' } as any, jobEvent.id)
    await turn.finished()
    expect(jobs()[0]).toMatchObject({ status: 'cancelled' })
    expect(jobs()[0].checkpoint.agent.outcome).toBe('cancelled')
    expect(llm.calls).toBeLessThan(3)
    expect(notes()).toEqual([])
  })

  it('a confirmation reached in the background ends as "needs your confirmation" with the card in the transcript', async () => {
    llm = { replies: [{ content: 'Here is the plan.', tool_calls: [call('c1', 'forms_create', { name: 'Intake' })] }], delayMs: 60, calls: 0 }
    const turn = await startTurn()
    await turn.readUntil((e) => e.type === 'job')
    turn.disconnect()
    await turn.finished()
    const row = jobs()[0]
    expect(row).toMatchObject({ status: 'succeeded', result: { summary: 'Waiting for your confirmation' } })
    expect(row.checkpoint.agent.events.find((e: any) => e.type === 'confirm').card.title).toBe('Create form “Intake”')
    expect(notes()[0]).toMatchObject({ type: 'agent_confirm', title: 'Agent needs your confirmation: Build a patient intake process' })
  })

  it('a question with answer buttons reached in the background ends as "Waiting for your answer" with a bell notification', async () => {
    llm = { replies: [{ content: 'One question first.', tool_calls: [call('c1', 'ask_user', { question: 'Who should the approval go to?', options: [{ label: 'Assign to me for testing', value: '@me' }, { label: "The submitter's manager" }] })] }], delayMs: 60, calls: 0 }
    const turn = await startTurn()
    await turn.readUntil((e) => e.type === 'job')
    turn.disconnect()
    await turn.finished()
    const row = jobs()[0]
    expect(row).toMatchObject({ status: 'succeeded', message: 'Waiting for your answer', result: { summary: 'Waiting for your answer' } })
    const choice = row.checkpoint.agent.events.find((e: any) => e.type === 'choice')
    expect(choice).toMatchObject({ question: 'Who should the approval go to?', options: [{ label: 'Assign to me for testing', reply: 'Assign to me for testing (@me)' }, { label: "The submitter's manager" }] })
    expect(llm.calls).toBe(1) // the turn stopped at the question
    expect(notes()[0]).toMatchObject({ type: 'agent_question', title: 'Agent needs your answer: Build a patient intake process', body: 'Open the Agent and choose an answer.' })
  })

  it('a failure in the background notifies "Agent stopped: …"', async () => {
    // The step limit is a resumable stop now (not a failure); a provider error is a failure.
    llm = { replies: [{ tool_calls: [call('c1', 'slow_step')] }, { httpStatus: 400 }], delayMs: 60, calls: 0 }
    const turn = await startTurn()
    await turn.readUntil((e) => e.type === 'job')
    turn.disconnect()
    await turn.finished()
    expect(jobs()[0].status).toBe('failed')
    expect(notes()[0]).toMatchObject({ type: 'agent_failed' })
    expect(notes()[0].title).toMatch(/^Agent stopped: /)
  })

  it(`at most ${AGENT_BACKGROUND_LIMIT} background jobs per person: a third stops when its tab closes`, async () => {
    for (let i = 0; i < AGENT_BACKGROUND_LIMIT; i++) {
      fake.tables.user_jobs.push({ id: crypto.randomUUID(), tenant_id: T, user_id: USER, kind: AGENT_JOB_KIND, status: 'running', params: { background: true, turn_id: `t${i}`, conversation_id: 'x' } })
    }
    llm = { replies: [{ tool_calls: [call('c1', 'slow_step')] }, { content: 'never' }], delayMs: 120, calls: 0 }
    const turn = await startTurn()
    const jobEvent = await turn.readUntil((e) => e.type === 'job') as Extract<AssistantEvent, { type: 'job' }>
    turn.disconnect()
    await turn.finished()
    expect(jobs().find((j) => j.id === jobEvent.id)).toBeUndefined() // aborted as before, nothing kept
    expect(llm.calls).toBe(1)
  })
})

describe('the panel\'s job requests', () => {
  const owner = { tenantId: T, userId: USER }
  const seedRunning = (n: number, extra: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => {
    const row = { id: crypto.randomUUID(), tenant_id: T, user_id: USER, kind: AGENT_JOB_KIND, status: 'running', params: { background: false, turn_id: `t${i}`, conversation_id: CONV }, created_at: `2026-11-07T00:00:0${i}Z`, ...extra }
    fake.tables.user_jobs.push(row)
    return row
  })

  it('background is capped per person and owner-only; foreground undoes it', async () => {
    const [a, b, c] = seedRunning(3)
    expect(await setAgentJobBackground(fake.client, { ...owner, jobId: a.id, background: true })).toMatchObject({ background: true })
    expect(await setAgentJobBackground(fake.client, { ...owner, jobId: b.id, background: true })).toMatchObject({ background: true })
    expect(await setAgentJobBackground(fake.client, { ...owner, jobId: c.id, background: true })).toMatchObject({ background: false, refused: 'limit' })
    expect(await setAgentJobBackground(fake.client, { tenantId: T, userId: OTHER, jobId: c.id, background: true })).toMatchObject({ refused: 'not_found' })
    expect(await setAgentJobBackground(fake.client, { ...owner, jobId: a.id, background: false })).toMatchObject({ background: false })
    expect(await setAgentJobBackground(fake.client, { ...owner, jobId: c.id, background: true })).toMatchObject({ background: true })

    actor = USER
    const res = await jobRoute(new NextRequest(`https://app.test/x`, { method: 'POST', body: JSON.stringify({ action: 'background' }) }), { params: Promise.resolve({ id: a.id }) })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('limit')
  })

  it('lists running and finished-unmerged jobs; merging is acknowledged once (idempotent) and only by the owner', async () => {
    const transcript = { v: 1, turn_id: 'done1', conversation_id: CONV, outcome: 'completed', events: [{ type: 'delta', text: 'Hi' }], messages: [{ role: 'assistant', content: 'Hi' }], error: null }
    fake.tables.user_jobs.push({ id: crypto.randomUUID(), tenant_id: T, user_id: USER, kind: AGENT_JOB_KIND, status: 'succeeded', params: { background: true, turn_id: 'done1', conversation_id: CONV }, checkpoint: { agent: transcript }, created_at: '2026-11-07T00:00:00Z' })
    fake.tables.user_jobs.push({ id: crypto.randomUUID(), tenant_id: T, user_id: USER, kind: AGENT_JOB_KIND, status: 'failed', error: 'The Agent stopped before it finished', params: { background: true, turn_id: 'died', conversation_id: CONV }, checkpoint: null, created_at: '2026-11-07T00:00:01Z' })
    fake.tables.user_jobs.push({ id: crypto.randomUUID(), tenant_id: T, user_id: USER, kind: AGENT_JOB_KIND, status: 'succeeded', params: { background: true, turn_id: 'other', conversation_id: 'another' }, checkpoint: { agent: transcript } })
    const [running] = seedRunning(1)
    fake.tables.notifications.push({ id: 'n1', user_id: USER, job_id: jobs()[0].id, is_read: false })

    const list = await listAgentJobs(fake.client, { ...owner, conversationId: CONV })
    expect(list.map((j) => [j.turn_id, j.status, Boolean(j.transcript)])).toEqual([['done1', 'succeeded', true], ['died', 'failed', true], ['t0', 'running', false]])
    expect(list[1].transcript).toMatchObject({ outcome: 'failed', error: 'The Agent stopped before it finished', messages: [] })
    expect(await listAgentJobs(fake.client, { tenantId: T, userId: OTHER, conversationId: CONV })).toEqual([])

    expect(await ackAgentJob(fake.client, { tenantId: T, userId: OTHER, jobId: list[0].id })).toBe(false)
    expect(await ackAgentJob(fake.client, { ...owner, jobId: list[0].id, read: true })).toBe(true)
    expect(await ackAgentJob(fake.client, { ...owner, jobId: list[1].id })).toBe(true)
    expect(await ackAgentJob(fake.client, { ...owner, jobId: running.id })).toBe(false) // still running
    expect(notes()[0].is_read).toBe(true)
    const again = await listAgentJobs(fake.client, { ...owner, conversationId: CONV })
    expect(again.map((j) => j.turn_id)).toEqual(['t0'])

    const res = await listRoute(new NextRequest(`https://app.test/api/assistants/jobs?conversation_id=${CONV}`))
    expect((await res.json()).jobs.map((j: any) => j.turn_id)).toEqual(['t0'])
    expect((await listRoute(new NextRequest('https://app.test/api/assistants/jobs'))).status).toBe(400)
  })

  it('the Jobs panel lists Agent jobs only once backgrounded, never in the workspace view, and never with the transcript', async () => {
    const [fg, bg] = seedRunning(2)
    bg.params = { ...bg.params, background: true }
    ;(bg as any).checkpoint = { agent: { secret: 'transcript' } }
    fake.tables.user_jobs.push({ id: crypto.randomUUID(), tenant_id: T, user_id: OTHER, kind: 'config.export', status: 'succeeded', params: {}, title: 'Export' })
    const ctx = (userId: string, perms: string[] = []) => ({ db: fake.client, supabase: fake.client, tenantId: T, actorId: userId, permissions: new Set(perms), authKind: 'session', source: 'ui' }) as any
    const mine = await listJobs(ctx(USER))
    expect(mine.jobs.map((j) => j.id)).toEqual([bg.id])
    expect(JSON.stringify(mine)).not.toContain('transcript')
    const tenant = await listJobs(ctx(OTHER, ['settings.edit']), { scope: 'tenant' })
    expect(tenant.jobs.map((j) => j.kind)).toEqual(['config.export'])
    expect(fg).toBeTruthy()
  })
})

describe('job kind and view', () => {
  it('agent.turn is not startable from the browser, refuses enqueueing and is not retryable', async () => {
    expect(isUiJobKind(AGENT_JOB_KIND)).toBe(false)
    const kind = getJobKind(AGENT_JOB_KIND)!
    expect(() => kind.authorize({ authKind: 'session' } as any, {})).toThrow(/Agent panel/)
    await expect(kind.run({} as any)).rejects.toThrow(/stopped before it finished/)
    const view = toJobView({ id: 'j', tenant_id: T, user_id: USER, kind: AGENT_JOB_KIND, title: 'Agent: x', status: 'failed', progress: 0, message: null, result: null, error: 'x', attempts: 1, max_attempts: 1, created_at: '', updated_at: '', started_at: null, finished_at: null, expires_at: null, cancel_requested_at: null } as any)
    expect(view.retryable).toBe(false)
  })
})

describe('transcript and progress', () => {
  it('coalesces deltas, masks secrets and skips turn-level events', () => {
    const r = new TranscriptRecorder()
    for (const e of [{ type: 'delta', text: 'Hel' }, { type: 'delta', text: 'lo' }, { type: 'tool_start', id: 'a', name: 'x', label: 'Using api_key sk-abcdefghijklmnopqrstuvwxyz123456' }, { type: 'messages', messages: [] }, { type: 'done', status: 'completed' }, { type: 'job', id: 'j', turn_id: 't' }] as AssistantEvent[]) r.push(e)
    const t = r.transcript({ turnId: 't', conversationId: 'c', result: { status: 'completed', newMessages: [], usage: {} as any, llmCalls: 1, toolCalls: 0, usageMissing: false } })
    expect(t.events.map((e) => e.type)).toEqual(['delta', 'tool_start'])
    expect((t.events[0] as any).text).toBe('Hello')
    expect(JSON.stringify(t.events)).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456')
  })

  it('caps the size: events first, then tool results', () => {
    const big = 'x'.repeat(50_000)
    const t = capTranscript({
      v: 1, turn_id: 't', conversation_id: 'c', outcome: 'completed', error: null,
      events: [...Array.from({ length: 10 }, () => ({ type: 'delta', text: big }) as AssistantEvent), { type: 'confirm', card: { tool_call_id: 'c', tool: 'x', title: 'T', lines: [], warnings: [] } }],
      messages: Array.from({ length: 40 }, (_, i) => ({ role: 'tool' as const, tool_call_id: `c${i}`, content: big })),
    })
    expect(t.truncated).toBe(true)
    expect(JSON.stringify(t.events).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_EVENTS_CHARS)
    expect(t.events.map((e) => e.type)).toEqual(['confirm'])
    expect(JSON.stringify(t.messages).length).toBeLessThanOrEqual(MAX_TRANSCRIPT_MESSAGES_CHARS)
    expect(t.messages).toHaveLength(40)
  })

  it('build plan progress reads "… — 3 of 8 items"; summaries are short', () => {
    const history = [
      { role: 'user' as const, content: 'Build the patient process' },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'p1', type: 'function' as const, function: { name: 'build_plan', arguments: JSON.stringify({ items: Array.from({ length: 8 }, (_, i) => ({ key: `k${i}` })) }) } }] },
    ]
    expect(buildPlanTotal(history, { tool_call_id: 'p1', approved: true })).toBe(8)
    expect(buildPlanTotal(history, { tool_call_id: 'p1', approved: false })).toBeNull()
    const p = new ProgressTracker(8)
    p.onEvent({ type: 'changed', kind: 'data_table', id: '1', title: 'A', href: null, action: 'created' })
    p.onEvent({ type: 'changed', kind: 'form', id: '2', title: 'B', href: null, action: 'created' })
    expect(p.onEvent({ type: 'tool_start', id: 'x', name: 'forms_create', label: 'Creating form “Patient intake”' })).toEqual({ message: 'Creating form “Patient intake” — 3 of 8 items', percent: 25 })
    expect(turnSummary([{ role: 'user', content: 'a'.repeat(100) }])).toHaveLength(60)
    expect(turnSummary(history, { approved: true })).toBe('Build the patient process (confirmed)')
  })

  it('a job row that cannot be created falls back to the old behaviour (null)', async () => {
    const broken = { from: () => ({ insert: async () => ({ error: { message: 'relation "user_jobs" does not exist' } }) }) } as any
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(await AgentJob.start(broken, { tenantId: T, userId: USER, turnId: 't', conversationId: 'c', summary: 's' })).toBeNull()
    warn.mockRestore()
  })
})
