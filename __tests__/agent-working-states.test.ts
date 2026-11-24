/**
 * The Agent panel's working / error states (components/assistants/agent-store):
 * "Working on it…" the moment a message is sent, then "Thinking…", the
 * tool's label and streamed text (automatic retries are quiet: still
 * "working", never a countdown); Stop cancels; a failed
 * turn leaves a friendly error bubble whose Retry asks again (the same
 * message, or from the steps already done) without re-adding the message.
 * fetch is mocked; no React rendering.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

;(globalThis as any).window = {
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => true,
  sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
}
if (typeof (globalThis as any).CustomEvent === 'undefined') {
  ;(globalThis as any).CustomEvent = class extends Event { detail: unknown; constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail } }
}

const chatBodies: any[] = []
const posts: any[] = []
const chatStream: { controller: ReadableStreamDefaultController<Uint8Array> | null; signal: AbortSignal | null } = { controller: null, signal: null }
let refuse: { status: number; body: any } | null = null
const enc = new TextEncoder()
const sse = (event: unknown) => enc.encode(`data: ${JSON.stringify(event)}\n\n`)

globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
  const u = String(url)
  if (u === '/api/assistants/chat') {
    chatBodies.push(JSON.parse(init.body))
    if (refuse) { const r = refuse; refuse = null; return new Response(JSON.stringify(r.body), { status: r.status }) }
    chatStream.signal = init.signal ?? null
    const body = new ReadableStream<Uint8Array>({ start(c) { chatStream.controller = c } })
    init.signal?.addEventListener('abort', () => { try { chatStream.controller?.error(Object.assign(new Error('aborted'), { name: 'AbortError' })) } catch { /* closed */ } })
    return new Response(body, { status: 200 })
  }
  if (u.startsWith('/api/assistants/jobs?')) return new Response(JSON.stringify({ jobs: [] }), { status: 200 })
  if (u.startsWith('/api/assistants/jobs/')) { posts.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }) }
  throw new Error(`unexpected fetch ${u}`)
}) as any

import { clearAgentConversation, retryAgent, sendAgentMessage, setAgentAvailability, setAgentOpen, stopAgent, useAgentState } from '@/components/assistants/agent-store'
import { activityText } from '@/lib/assistants/activity'
import { describeFailure, forViewer } from '@/lib/agents/errors'

vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  return { ...real, useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }
})
// eslint-disable-next-line react-hooks/rules-of-hooks -- the store read outside React (useSyncExternalStore is mocked)
const state = () => useAgentState()
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
const JOB = '0d000000-0000-4000-8000-0000000000aa'
let keyN = 0

beforeEach(() => {
  chatBodies.length = 0
  posts.length = 0
  refuse = null
  clearAgentConversation()
  setAgentAvailability({ agent: true, form_read: false, form: false, task: false, designer: true, admin: false, history_key: `w${++keyN}` })
  setAgentOpen(true)
})
afterEach(async () => {
  try { chatStream.controller?.close() } catch { /* closed */ }
  await tick()
})

const rateLimitFailure = forViewer(describeFailure({ kind: 'rate_limited', status: 429, message: 'Provider 429', body: '{"error":{"message":"Rate limit exceeded","type":"rate_limit_error","param":null,"code":"rate_limit_exceeded"}}', attempts: 4, provider: 'baseten', requestId: 'req_1' }), false)

describe('working states', () => {
  it('"Working on it…" at once, then Thinking, the tool, then streamed text — a retry changes nothing on screen', async () => {
    sendAgentMessage('Build an expense form')
    // Synchronously after sending: busy with the placeholder.
    expect(state().busy).toBe(true)
    expect(state().activity?.phase).toBe('working')
    expect(activityText(state().activity)?.text).toBe('Working on it…')
    expect(state().status).toBe('Working on it…')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'job', id: JOB, turn_id: state().job!.turnId }))
    await tick()
    expect(state().activity?.phase).toBe('thinking')
    expect(state().status).toBe('Thinking…')

    chatStream.controller!.enqueue(sse({ type: 'tool_start', id: 't1', name: 'forms_create', label: 'Drafting your app' }))
    await tick()
    expect(activityText(state().activity)?.text).toBe('Drafting your app…')
    chatStream.controller!.enqueue(sse({ type: 'tool_end', id: 't1', name: 'forms_create', ok: true, label: 'Drafting your app' }))
    await tick()
    expect(state().activity?.phase).toBe('thinking')

    // The chat route never sends retries; even if a server did, the panel stays on its working state.
    const before = state().activity!
    chatStream.controller!.enqueue(sse({ type: 'retry', attempt: 2, max_attempts: 4, delay_ms: 6_000, code: 'rate_limited', message: 'The AI provider is busy — retrying in 6 s (attempt 2 of 4)…' }))
    await tick()
    const a = state().activity!
    expect(a).toEqual(before)
    expect(state().status).toBe('Thinking…')
    // The timing hints keep counting from the last real change of phase.
    expect(activityText(a, a.since + 9_000)?.text).toBe('Still working…')
    expect(activityText(a, a.since + 26_000)?.text).toBe('This is taking longer than usual…')
    const shown = JSON.stringify([state().status, state().items, activityText(a), activityText(a, a.since + 26_000)])
    expect(shown).not.toMatch(/provider|retry|retrying|attempt|rate limit/i)
    // Nothing was added to the conversation for the retry.
    expect(state().items.some((it) => it.kind === 'error')).toBe(false)

    chatStream.controller!.enqueue(sse({ type: 'delta', text: 'Here it is' }))
    await tick()
    expect(state().activity?.phase).toBe('writing')
    expect(activityText(state().activity)).toBeNull()
    chatStream.controller!.enqueue(sse({ type: 'messages', messages: [{ role: 'assistant', content: 'Here it is' }] }))
    chatStream.controller!.enqueue(sse({ type: 'done', status: 'completed' }))
    chatStream.controller!.close()
    await tick()
    expect(state().busy).toBe(false)
    expect(state().activity).toBeNull()
  })

  it('an admin\'s finished turn carries its retries for the Details (the route sends them to admins only)', async () => {
    sendAgentMessage('Summarise my tasks')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'job', id: JOB, turn_id: state().job!.turnId }))
    chatStream.controller!.enqueue(sse({ type: 'delta', text: 'You have 3 tasks.' }))
    chatStream.controller!.enqueue(sse({ type: 'messages', messages: [{ role: 'assistant', content: 'You have 3 tasks.' }] }))
    chatStream.controller!.enqueue(sse({ type: 'done', status: 'completed', retries: { retries: 2, code: 'rate_limited', status: 429, provider: 'Anthropic' } }))
    chatStream.controller!.close()
    await tick()
    expect(state().items.at(-1)).toMatchObject({ kind: 'assistant', text: 'You have 3 tasks.', retries: { retries: 2, code: 'rate_limited' } })
  })

  it('a member\'s finished turn has no retry note', async () => {
    sendAgentMessage('Summarise my tasks')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'delta', text: 'You have 3 tasks.' }))
    chatStream.controller!.enqueue(sse({ type: 'done', status: 'completed' }))
    chatStream.controller!.close()
    await tick()
    expect(state().items.at(-1)).toMatchObject({ kind: 'assistant', text: 'You have 3 tasks.' })
    expect((state().items.at(-1) as any).retries).toBeUndefined()
  })

  it('a long wait says "Still working…" then "This is taking longer than usual…"', () => {
    const since = 1_000_000
    expect(activityText({ phase: 'thinking', since }, since + 2_000)?.text).toBe('Thinking…')
    expect(activityText({ phase: 'working', since }, since + 8_500)?.text).toBe('Still working…')
    expect(activityText({ phase: 'thinking', since }, since + 26_000)?.text).toBe('This is taking longer than usual…')
    expect(activityText({ phase: 'tool', label: 'Reading the form', since }, since + 9_000)).toEqual({ text: 'Reading the form…', hint: 'Still working…' })
  })

  it('Stop cancels the turn (the job, then the stream)', async () => {
    sendAgentMessage('Long one')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'job', id: JOB, turn_id: state().job!.turnId }))
    await tick()
    await stopAgent()
    await tick()
    expect(posts.at(-1)).toEqual({ action: 'cancel' })
    expect(chatStream.signal!.aborted).toBe(true)
    expect(state().busy).toBe(false)
    expect(state().activity).toBeNull()
    expect(state().items.at(-1)).toMatchObject({ kind: 'error', text: 'Stopped.', stopped: true })
  })
})

describe('friendly errors and Retry', () => {
  it('a provider failure leaves the friendly bubble; Retry asks again from the same conversation (the message is not re-added)', async () => {
    sendAgentMessage('Summarise this task')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'messages', messages: [] }))
    chatStream.controller!.enqueue(sse({ type: 'error', error: rateLimitFailure.message, code: 'failed', failure: rateLimitFailure }))
    chatStream.controller!.close()
    await tick()
    const item = state().items.at(-1) as any
    expect(item).toMatchObject({ kind: 'error', text: rateLimitFailure.message, retry: 'resume', failure: { code: 'rate_limited' } })
    expect(item.text).not.toContain('{')
    expect(JSON.stringify(item.failure)).not.toContain('Rate limit exceeded')
    expect(state().busy).toBe(false)

    const userItems = state().items.filter((it) => it.kind === 'user').length
    retryAgent(item.id)
    await tick()
    expect(chatBodies).toHaveLength(2)
    // The same conversation goes again: it ends with the unanswered message, sent once.
    expect(chatBodies[1].messages).toEqual([{ role: 'user', content: 'Summarise this task' }])
    expect(state().items.filter((it) => it.kind === 'user')).toHaveLength(userItems)
    expect((state().items.find((it) => it.id === item.id) as any).retried).toBe(true)
    expect(state().activity?.phase).toBe('working')
  })

  it('a request refused before it started: Retry sends the same message again', async () => {
    refuse = { status: 429, body: { error: 'Too many Agent messages — wait a moment and try again.', code: 'rate_limited', failure: { code: 'limit', message: 'Too many Agent messages — wait a moment and try again.', retryable: true, details: {} } } }
    sendAgentMessage('Hello there')
    await tick()
    const item = state().items.at(-1) as any
    expect(item).toMatchObject({ kind: 'error', retry: 'resend', resend: { text: 'Hello there' } })
    expect(state().messages).toEqual([])
    retryAgent(item.id)
    await tick()
    expect(chatBodies.at(-1).messages).toEqual([{ role: 'user', content: 'Hello there' }])
  })

  it('no Retry when retrying can\'t help (out of credit), or once the conversation moved on', async () => {
    const quota = forViewer(describeFailure({ kind: 'quota', status: 402, message: 'Provider 402', body: 'Payment Required', attempts: 1, provider: 'openai' }), true)
    sendAgentMessage('Hi')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'error', error: quota.message, code: 'failed', failure: quota }))
    chatStream.controller!.close()
    await tick()
    const item = state().items.at(-1) as any
    expect(item.retry).toBeUndefined()
    expect(item.failure.settings_href).toBe('/settings/assistants')
    retryAgent(item.id)
    await tick()
    expect(chatBodies).toHaveLength(1)
  })
})
