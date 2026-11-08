/**
 * The Agent panel's side of background work (components/assistants/agent-store):
 * closing the panel mid-turn moves the job to the background instead of
 * aborting (with a toast), Stop cancels the job before dropping the stream,
 * and finished jobs merge into the conversation once per turn, replacing what
 * was shown live. fetch is mocked; no React.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const listeners = new Map<string, Array<(e: any) => void>>()
const toasts: any[] = []
;(globalThis as any).window = {
  addEventListener: (name: string, fn: (e: any) => void) => listeners.set(name, [...(listeners.get(name) ?? []), fn]),
  removeEventListener: () => undefined,
  dispatchEvent: (e: any) => { if (e.type === 'usertasks:jobs-toast') toasts.push(e.detail); for (const fn of listeners.get(e.type) ?? []) fn(e); return true },
  sessionStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined },
  localStorage: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, key: () => null, length: 0 },
}
if (typeof (globalThis as any).CustomEvent === 'undefined') {
  ;(globalThis as any).CustomEvent = class extends Event { detail: unknown; constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail } }
}

const posts: Array<{ url: string; body: any }> = []
let jobList: any[] = []
let chatStream: { controller: ReadableStreamDefaultController<Uint8Array> | null; signal: AbortSignal | null } = { controller: null, signal: null }
let backgroundReply: { status: number; body: any } = { status: 200, body: { background: true } }
const enc = new TextEncoder()
const sse = (event: unknown) => enc.encode(`data: ${JSON.stringify(event)}\n\n`)

globalThis.fetch = vi.fn(async (url: any, init: any = {}) => {
  const u = String(url)
  if (u === '/api/assistants/chat') {
    chatStream.signal = init.signal ?? null
    const body = new ReadableStream<Uint8Array>({ start(c) { chatStream.controller = c } })
    init.signal?.addEventListener('abort', () => { try { chatStream.controller?.error(Object.assign(new Error('aborted'), { name: 'AbortError' })) } catch { /* closed */ } })
    return new Response(body, { status: 200 })
  }
  if (u.startsWith('/api/assistants/jobs?')) return new Response(JSON.stringify({ jobs: jobList }), { status: 200 })
  if (u.startsWith('/api/assistants/jobs/')) {
    const body = JSON.parse(init.body)
    posts.push({ url: u, body })
    if (body.action === 'background') return new Response(JSON.stringify(backgroundReply.body), { status: backgroundReply.status })
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }
  throw new Error(`unexpected fetch ${u}`)
}) as any

import {
  mergeAgentTranscript, sendAgentMessage, setAgentAvailability, setAgentOpen, stopAgent, syncAgentJobs, useAgentState, clearAgentConversation,
} from '@/components/assistants/agent-store'
import type { AgentTranscript } from '@/lib/assistants/background'

// The store's state outside React: read it through the hook's getter.
vi.mock('react', async (importOriginal) => {
  const real = await importOriginal<typeof import('react')>()
  return { ...real, useSyncExternalStore: (_s: unknown, get: () => unknown) => get() }
})
const state = () => useAgentState()
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms))
let keyN = 0

beforeEach(() => {
  posts.length = 0
  toasts.length = 0
  jobList = []
  backgroundReply = { status: 200, body: { background: true } }
  clearAgentConversation()
  setAgentAvailability({ agent: true, form_read: false, form: false, task: false, designer: true, admin: false, history_key: `k${++keyN}` })
  setAgentOpen(true)
})
afterEach(async () => {
  try { chatStream.controller?.close() } catch { /* closed */ }
  await tick()
})

const transcript = (turnId: string, text = 'Built it.'): AgentTranscript => ({
  v: 1, turn_id: turnId, conversation_id: state().conversationId!, outcome: 'completed', error: null,
  events: [{ type: 'tool_start', id: 't1', name: 'forms_create', label: 'Creating form' }, { type: 'tool_end', id: 't1', name: 'forms_create', ok: true, label: 'Creating form' }, { type: 'delta', text }],
  messages: [{ role: 'assistant', content: text }],
})

describe('closing the panel mid-turn', () => {
  it('moves the job to the background (no abort) and tells the person; Stop cancels', async () => {
    sendAgentMessage('Build a patient intake process')
    await tick()
    chatStream.controller!.enqueue(sse({ type: 'job', id: '0d000000-0000-4000-8000-000000000001', turn_id: state().job!.turnId }))
    await tick()
    setAgentOpen(false)
    await tick()
    expect(posts).toEqual([{ url: '/api/assistants/jobs/0d000000-0000-4000-8000-000000000001', body: { action: 'background' } }])
    expect(chatStream.signal!.aborted).toBe(false)
    expect(state().job).toMatchObject({ live: true, background: true })
    expect(toasts[0].title).toBe('Agent is still working on “Build a patient intake process”')
    expect(toasts[0].body).toBe("You'll get a notification when it's done.")
    expect(toasts[0].action.label).toBe('View')

    await stopAgent()
    await tick()
    expect(posts.at(-1)!.body).toEqual({ action: 'cancel' })
    expect(chatStream.signal!.aborted).toBe(true)
    expect(state().busy).toBe(false)
    expect(state().items.at(-1)).toMatchObject({ kind: 'error', text: 'Stopped.' })
  })

  it('the panel closed before the job is known: backgrounds once the job event arrives; refused beyond the limit', async () => {
    backgroundReply = { status: 409, body: { error: 'You already have 2 Agent jobs running in the background.', code: 'limit' } }
    sendAgentMessage('Another long one')
    await tick()
    setAgentOpen(false)
    expect(posts).toEqual([])
    chatStream.controller!.enqueue(sse({ type: 'job', id: '0d000000-0000-4000-8000-000000000002', turn_id: state().job!.turnId }))
    await tick()
    expect(posts.map((p) => p.body.action)).toEqual(['background'])
    expect(toasts[0].title).toBe('The Agent keeps working while this tab is open')
    expect(state().job?.background).toBe(false)
    // The turn still finishes here.
    chatStream.controller!.enqueue(sse({ type: 'delta', text: 'Done' }))
    chatStream.controller!.enqueue(sse({ type: 'messages', messages: [{ role: 'assistant', content: 'Done' }] }))
    chatStream.controller!.enqueue(sse({ type: 'done', status: 'completed' }))
    chatStream.controller!.close()
    await tick()
    expect(state().busy).toBe(false)
    expect(state().messages.at(-1)).toEqual({ role: 'assistant', content: 'Done' })
  })
})

describe('merging finished background jobs', () => {
  it('merges a transcript once per turn, replacing what was shown live for that turn', async () => {
    sendAgentMessage('Build it')
    await tick()
    const turnId = state().job!.turnId
    chatStream.controller!.enqueue(sse({ type: 'job', id: '0d000000-0000-4000-8000-000000000003', turn_id: turnId }))
    chatStream.controller!.enqueue(sse({ type: 'delta', text: 'Partial…' }))
    await tick()
    expect(state().items.map((i) => i.kind)).toEqual(['user', 'assistant'])
    chatStream.controller!.close() // the live view broke without the result
    await tick()
    // Not aborted: the panel follows the job instead.
    expect(state().job).toMatchObject({ live: false, id: '0d000000-0000-4000-8000-000000000003' })
    expect(state().busy).toBe(true)

    mergeAgentTranscript(transcript(turnId))
    mergeAgentTranscript(transcript(turnId)) // again: no duplicates
    expect(state().items.map((i) => i.kind)).toEqual(['user', 'tool', 'assistant'])
    expect(state().items.at(-1)).toMatchObject({ kind: 'assistant', text: 'Built it.' })
    expect(state().messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(state().merged).toContain(turnId)
    expect(state().pendingTurn).toBeNull()
    jobList = []
    await syncAgentJobs() // the followed job is done
    expect(state().busy).toBe(false)
  })

  it('on open / load: merges finished jobs in order and acknowledges them; follows a running one until it finishes', async () => {
    jobList = [
      { id: '0d000000-0000-4000-8000-00000000000a', turn_id: 'a', status: 'succeeded', transcript: transcript('a', 'First.') },
      { id: '0d000000-0000-4000-8000-00000000000b', turn_id: 'b', status: 'running', background: true, message: 'Creating form “Intake” — 3 of 8 items', transcript: null },
    ]
    await syncAgentJobs()
    expect(state().messages.map((m) => m.content)).toEqual(['First.'])
    expect(posts).toEqual([{ url: '/api/assistants/jobs/0d000000-0000-4000-8000-00000000000a', body: { action: 'ack', read: true } }])
    expect(state().busy).toBe(true)
    expect(state().job).toMatchObject({ live: false, turnId: 'b' })
    expect(state().status).toBe('Working in the background: Creating form “Intake” — 3 of 8 items')

    // A repeat sync (the ack raced) does not merge twice; the running job finished.
    jobList = [
      { id: '0d000000-0000-4000-8000-00000000000a', turn_id: 'a', status: 'succeeded', transcript: transcript('a', 'First.') },
      { id: '0d000000-0000-4000-8000-00000000000b', turn_id: 'b', status: 'succeeded', transcript: { ...transcript('b', 'Second.'), outcome: 'awaiting_confirmation', events: [{ type: 'confirm', card: { tool_call_id: 'c1', tool: 'build_plan', title: 'Build plan', lines: [], warnings: [] } }] } },
    ]
    await syncAgentJobs()
    expect(state().messages.map((m) => m.content)).toEqual(['First.', 'Second.'])
    expect(state().items.some((i) => i.kind === 'confirm' && i.state === 'pending')).toBe(true)
    expect(state().busy).toBe(false)
    expect(state().job).toBeNull()
  })
})
