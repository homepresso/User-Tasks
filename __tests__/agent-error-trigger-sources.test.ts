/**
 * Where the Agent error trigger is reported from: lib/agents/run.ts
 * (workflow agents and agent runs started elsewhere, incl. "not configured")
 * and lib/assistants/chat.ts (the in-product Agent). Fires on a FINAL
 * failure only — never on a retry that later succeeded, a stop, an
 * evaluation; test runs are flagged (the dispatcher skips them).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ reports: [] as any[], result: null as any, loadError: null as any }))
vi.mock('@/lib/agents/error-trigger-dispatch', () => ({
  reportAgentError: vi.fn(async (_db: unknown, event: any) => { hoisted.reports.push(event); return { started: 1, suppressed: 0 } }),
}))
vi.mock('@/lib/agent-executor', async (importOriginal) => ({ ...(await importOriginal<any>()), executeAgent: vi.fn(async () => hoisted.result) }))
vi.mock('@/lib/agent-run-service', () => ({ recordAgentRun: vi.fn(async () => 'agent-run-9') }))
vi.mock('@/lib/agents/prepare', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  buildAgentRun: vi.fn(async () => ({ config: { model: 'gpt-x', maxIterations: 3 }, options: { maxDurationMs: 1000 }, outputConfig: { variables: [] }, provider: 'openai' })),
  checkDailyBudget: vi.fn(async () => {}),
  loadAgentForRun: vi.fn(async () => { if (hoisted.loadError) throw hoisted.loadError; return { agent: { id: 'agent-1', name: 'Triage', version: 1 }, integration: { id: 'i', type: 'openai', config: {} } } }),
}))

import { runAgent, loadAndRunAgent } from '@/lib/agents/run'
import { AgentRunError } from '@/lib/agents/prepare'
import { runPreparedTurn, type PreparedTurn } from '@/lib/assistants/chat'
import { describeFailure } from '@/lib/agents/errors'
import type { AssistantConnection } from '@/lib/assistants/settings'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fakes */

const SECRET_BODY = '{"error":{"message":"Rate limit exceeded for sk-live-abcdefghijklmnopqrstuvwx","type":"rate_limit_error","code":"rate_limit_exceeded"}}'
const view = describeFailure({ kind: 'rate_limited', status: 429, message: `Provider 429: ${SECRET_BODY}`, body: SECRET_BODY, attempts: 4, provider: 'openai', requestId: 'req_7' }, { audience: 'agent' })
const failed = (over: Record<string, unknown> = {}) => ({ status: 'failed', error: `${view.message} — Details: Provider 429: ${SECRET_BODY}`, failure: view, error_kind: 'rate_limited', response: '', iterations: 1, toolCalls: [], messages: [], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, duration_ms: 5, steps: [], ...over })
const completed = () => ({ ...failed(), status: 'completed', error: undefined, failure: undefined, error_kind: undefined, response: 'ok', steps: [{ type: 'llm', attempts: 3 }] })
const loaded = { agent: { id: 'agent-1', name: 'Triage', version: 1 }, integration: { id: 'i', type: 'openai', config: {} } } as any
const LINK = (over: Record<string, unknown> = {}) => ({
  run_id: 'wf-run-1', workflow_id: 'wf-1', event_id: 'agent_wait_x', node_id: 'n1', node_label: 'Triage step',
  output_variable: 'triage', output_prefix: 'triage', share_context: false, agent_context: null, user_message: 'hi', ...over,
})
const db: any = { from: () => { throw new Error('no db in this test') } }
const base = { db, tenantId: 't1', loaded, message: 'Process refund 42', actingUserId: 'u1', initiatedBy: 'u1' }

beforeEach(() => { hoisted.reports.length = 0; hoisted.loadError = null })

describe('workflow agents and agent runs (lib/agents/run.ts)', () => {
  it('a Run Agent step whose agent failed for good: source workflow, with the step, run and loop-guard depth', async () => {
    hoisted.result = failed()
    await runAgent({ ...base, callerType: 'workflow_node', workflow: LINK({ agent_error_depth: 1 }) as any })
    expect(hoisted.reports).toHaveLength(1)
    expect(hoisted.reports[0]).toMatchObject({
      tenantId: 't1', source: 'workflow', code: 'rate_limited', agentId: 'agent-1', agentName: 'Triage', workflowId: 'wf-1', runId: 'wf-run-1',
      stepLabel: 'Triage step', stepId: 'n1', agentRunId: 'agent-run-9', attempts: 4, requestId: 'req_7', depth: 1, test: false, model: 'gpt-x',
    })
    expect(hoisted.reports[0].message).toBe(view.message)
    // Never the provider's raw body, keys or the prompt.
    const text = JSON.stringify(hoisted.reports[0])
    expect(text).not.toMatch(/sk-live|Rate limit exceeded for|Process refund 42|"error":\{/)
  })

  it('an agent run started elsewhere (console, API, MCP, queue): source agent_run', async () => {
    hoisted.result = failed()
    await runAgent({ ...base, callerType: 'manual' })
    expect(hoisted.reports[0]).toMatchObject({ source: 'agent_run', workflowId: null, runId: null })
  })

  it('a failure without a provider view gets a fixed reason (no model output)', async () => {
    hoisted.result = failed({ failure: undefined, error_kind: 'max_iterations', error: 'secret model output' })
    await runAgent({ ...base, callerType: 'api' })
    expect(hoisted.reports[0]).toMatchObject({ code: 'unknown', message: 'The agent stopped: it reached its step limit.', summary: 'max_iterations' })
    expect(JSON.stringify(hoisted.reports[0])).not.toContain('secret model output')
  })

  it('never on a run that succeeded after retries, a stop or an evaluation', async () => {
    hoisted.result = completed()
    await runAgent({ ...base, callerType: 'workflow_node', workflow: LINK() as any })
    hoisted.result = failed({ error_kind: 'cancelled', failure: undefined })
    await runAgent({ ...base, callerType: 'manual' })
    hoisted.result = failed()
    await runAgent({ ...base, callerType: 'eval', mode: 'eval' })
    expect(hoisted.reports).toEqual([])
  })

  it('a Save & Test run is flagged as a test (the dispatcher skips it)', async () => {
    hoisted.result = failed()
    await runAgent({ ...base, callerType: 'workflow_node', workflow: LINK({ test: true }) as any })
    expect(hoisted.reports[0].test).toBe(true)
  })

  it('an agent without a provider connection or key: not_configured; other load errors are not agent errors', async () => {
    hoisted.loadError = new AgentRunError('No API key found', 400, 'no_key')
    await expect(loadAndRunAgent({ db, tenantId: 't1', agentId: 'agent-1', message: 'x', actingUserId: 'u1', callerType: 'api' })).rejects.toThrow('No API key')
    expect(hoisted.reports[0]).toMatchObject({ source: 'agent_run', code: 'not_configured', summary: 'no_key', agentId: 'agent-1' })
    hoisted.reports.length = 0
    hoisted.loadError = new AgentRunError('Agent not found', 404, 'not_found')
    await expect(loadAndRunAgent({ db, tenantId: 't1', agentId: 'agent-1', message: 'x', actingUserId: 'u1', callerType: 'api' })).rejects.toThrow()
    expect(hoisted.reports).toEqual([])
  })
})

describe('the in-product Agent (lib/assistants/chat.ts)', () => {
  const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, baseUrl: 'https://llm.test' }
  const sink: any = {
    from: () => ({
      insert: async () => ({ error: null }),
      select: () => { const q: any = { eq: () => q, gte: () => q, is: () => q, in: () => q, limit: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }), then: (f: any) => f({ data: [], error: null }) }; return q },
    }),
  }
  const ctx: any = { db: sink, supabase: sink, tenantId: 't1', actorId: 'u1', permissions: new Set(), authKind: 'session', source: 'ui' }
  const prepared: PreparedTurn = {
    capability: 'designer', profile: { id: 'hr', name: 'HR' } as any, instructions: 'I', context: null, tools: [],
    limits: { maxIterations: 2, maxTokens: 0, maxOutputTokens: 100, timeoutMs: 120_000 } as any, connection: conn,
  }
  const answer = () => new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  const err = (status: number, body = SECRET_BODY) => new Response(body, { status, headers: { 'content-type': 'application/json' } })
  const scripted = (...responses: Array<() => Response>) => { const q = [...responses]; return vi.fn(async () => q.shift()!()) as unknown as typeof fetch }
  const run = async (fetchImpl: typeof fetch, signal?: AbortSignal) => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1_000 })
    try {
      const done = runPreparedTurn(ctx, prepared, { messages: [{ role: 'user', content: 'hello there' }] } as any, { serviceDb: sink, onEvent: () => {}, fetchImpl, conversationId: 'conv-1', signal })
      await vi.runAllTimersAsync()
      return await done
    } finally { vi.useRealTimers() }
  }

  it('a final failure (after its retries): source system_agent, with the profile, conversation and user id', async () => {
    const r = await run(scripted(() => err(500), () => err(500), () => err(500), () => err(500)))
    expect(r.status).toBe('failed')
    expect(hoisted.reports).toHaveLength(1)
    expect(hoisted.reports[0]).toMatchObject({ tenantId: 't1', source: 'system_agent', code: 'overloaded', profileId: 'hr', profileName: 'HR', conversationId: 'conv-1', userId: 'u1', attempts: 4, model: 'gpt-4.1' })
    expect(JSON.stringify(hoisted.reports[0])).not.toMatch(/sk-live|hello there/)
  })

  it('not for a turn answered after a retry', async () => {
    const r = await run(scripted(() => err(503), answer))
    expect(r.status).toBe('completed')
    expect(hoisted.reports).toEqual([])
  })

  it('not for a stopped turn', async () => {
    const abort = new AbortController()
    abort.abort()
    const r = await run(scripted(answer), abort.signal)
    expect(r.status).toBe('cancelled')
    expect(hoisted.reports).toEqual([])
  })
})
