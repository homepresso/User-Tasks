/**
 * The Agent turn with a flaky provider (lib/assistants/engine + chat):
 * transient failures are retried with a status event for the panel, a tool
 * that already ran is never re-run when the next model call is retried, a
 * failure after the retries ends the turn with the friendly view (never the
 * raw body), and a turn the provider never answered is not usage. Mocked
 * provider and sleep; no real calls.
 */
import { describe, expect, it, vi } from 'vitest'
import { runAssistantTurn, type AssistantToolDef } from '@/lib/assistants/engine'
import { runPreparedTurn, type PreparedTurn } from '@/lib/assistants/chat'
import type { AssistantEvent } from '@/lib/assistants/types'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, baseUrl: 'https://llm.test' }
const OWNER_BODY = '{"error":{"message":"Rate limit exceeded","type":"rate_limit_error","param":null,"code":"rate_limit_exceeded"}}'

const answer = (msg: { content?: string | null; tool_calls?: any[] }, usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }) =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage }), { status: 200, headers: { 'content-type': 'application/json' } })
const err = (status: number, body = '{"error":{"message":"x"}}', headers: Record<string, string> = {}) => new Response(body, { status, headers: { 'content-type': 'application/json', ...headers } })
const toolCall = (id: string, name: string, args: unknown) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })

function scripted(...responses: Array<Response | (() => Response)>) {
  const queue = [...responses]
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift()
    if (!next) throw new Error('unexpected provider call')
    return typeof next === 'function' ? next() : next
  })
  return fetchImpl as unknown as typeof fetch & { mock: { calls: unknown[] } }
}

function countingTool(): AssistantToolDef & { runs: number } {
  const tool: AssistantToolDef & { runs: number } = {
    runs: 0, name: 'read_thing', description: 'Reads', parameters: { type: 'object', properties: {} }, mode: 'read',
    label: () => 'Reading the form',
    run: async () => { tool.runs++; return { result: { ok: true } } },
  }
  return tool
}

const sleeps: number[] = []
const sleep = async (ms: number) => { sleeps.push(ms) }

describe('retries inside a turn', () => {
  it('429 then an answer: a server-side retry event (logs / job progress; the chat route never sends it) and the reply', async () => {
    sleeps.length = 0
    const events: AssistantEvent[] = []
    const fetchImpl = scripted(err(429, OWNER_BODY, { 'retry-after': '6' }), answer({ content: 'Done' }))
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: (e) => events.push(e), fetchImpl, sleep })
    expect(r.status).toBe('completed')
    expect(r.retries).toBe(1)
    expect(r.lastRetry).toEqual({ code: 'rate_limited', status: 429 })
    expect(r.llmCalls).toBe(1)
    const retry = events.find((e) => e.type === 'retry') as Extract<AssistantEvent, { type: 'retry' }>
    expect(retry).toMatchObject({ attempt: 2, max_attempts: 4, code: 'rate_limited' })
    expect(retry.delay_ms).toBe(6_000)
    expect(retry.message).toBe('The AI provider is busy — retrying in 6 s (attempt 2 of 4)…')
    expect(sleeps[0]).toBe(retry.delay_ms)
  })

  it('a tool that ran is not re-run when the next model call is retried', async () => {
    sleeps.length = 0
    const tool = countingTool()
    const fetchImpl = scripted(answer({ content: null, tool_calls: [toolCall('c1', 'read_thing', {})] }), err(503), err(529), answer({ content: 'All done' }))
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'go' }], tools: [tool], onEvent: () => {}, fetchImpl, sleep })
    expect(r.status).toBe('completed')
    expect(tool.runs).toBe(1)
    expect(r.toolCalls).toBe(1)
    expect(r.retries).toBe(2)
    expect(fetchImpl.mock.calls).toHaveLength(4)
  })

  it('the owner\'s 429 four times: the friendly rate-limit failure, no raw JSON, no usage counted', async () => {
    sleeps.length = 0
    const events: AssistantEvent[] = []
    const fetchImpl = scripted(err(429, OWNER_BODY, { 'x-request-id': 'req_42' }), err(429, OWNER_BODY), err(429, OWNER_BODY), err(429, OWNER_BODY))
    const r = await runAssistantTurn({ connection: { ...conn, provider: 'baseten' }, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: (e) => events.push(e), fetchImpl, sleep })
    expect(r.status).toBe('failed')
    expect(r.error).toBe('The AI provider is busy right now (too many requests for this key). I tried 4 times. Please try again in a minute — or ask your admin to raise the provider\'s rate limit.')
    expect(r.failure).toMatchObject({ code: 'rate_limited', retryable: true, details: { provider: 'Baseten', status: 429, error_code: 'rate_limit_exceeded', attempts: 4 } })
    expect(r.error).not.toContain('{')
    expect(r.llmCalls).toBe(0)
    expect(events.filter((e) => e.type === 'retry')).toHaveLength(3)
    // The technical detail is kept for logs only.
    expect(r.failureDetail).toMatch(/^Provider 429/)
  })

  it('401 fails at once with the key message (no retry)', async () => {
    sleeps.length = 0
    const fetchImpl = scripted(err(401, '{"error":{"message":"Incorrect API key provided: sk-abcdefghijklmnopqrstuvwx","code":"invalid_api_key"}}'))
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: () => {}, fetchImpl, sleep })
    expect(r.failure).toMatchObject({ code: 'auth', admin_fix: true, retryable: false })
    expect(sleeps).toEqual([])
    expect(JSON.stringify(r.failure)).not.toContain('sk-abcdefghijklmnop')
  })
})

describe('usage', () => {
  /** A tiny assistant_usage sink. */
  function usageDb() {
    const rows: any[] = []
    const client: any = {
      from: (table: string) => ({
        insert: async (row: any) => { if (table === 'assistant_usage') rows.push(row); return { error: null } },
        select: () => { const q: any = { eq: () => q, gte: () => q, is: () => q, in: () => q, limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }), then: (f: any) => f({ data: [], error: null }) }; return q },
      }),
    }
    return { rows, client }
  }
  const ctx = (db: any): ServiceContext => ({ db, supabase: db, tenantId: 't1', actorId: 'u1', permissions: new Set(), authKind: 'session', source: 'ui' } as any)
  const prepared: PreparedTurn = {
    capability: 'designer', profile: null, instructions: 'I', context: null, tools: [],
    limits: { maxIterations: 2, maxTokens: 0, maxOutputTokens: 100, timeoutMs: 120_000 },
    connection: conn,
  }

  it('a turn the provider never answered (failed after its retries) is not usage', async () => {
    const db = usageDb()
    const fetchImpl = scripted(err(500), err(500), err(500), err(500))
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1_000 })
    try {
      const done = runPreparedTurn(ctx(db.client), prepared, { messages: [{ role: 'user', content: 'hello' }] }, { serviceDb: db.client, onEvent: () => {}, fetchImpl })
      await vi.runAllTimersAsync()
      const r = await done
      expect(r.status).toBe('failed')
      expect(r.failure?.code).toBe('overloaded')
    } finally { vi.useRealTimers() }
    expect(db.rows).toEqual([])
  })

  it('an answered turn after retries is usage once, with its tokens only', async () => {
    const db = usageDb()
    const fetchImpl = scripted(err(503), answer({ content: 'hi' }, { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }))
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1_000 })
    try {
      const done = runPreparedTurn(ctx(db.client), prepared, { messages: [{ role: 'user', content: 'hello' }] }, { serviceDb: db.client, onEvent: () => {}, fetchImpl })
      await vi.runAllTimersAsync()
      await done
    } finally { vi.useRealTimers() }
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({ llm_calls: 1, total_tokens: 5, status: 'completed' })
  })
})
