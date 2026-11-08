import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The agents follow-ups (migration 20261124000000):
 *  1. per-table data grants, none by default, legacy "all tables" kept;
 *  2. cost: price table layers, cost per call / run, "cost unknown", budgets;
 *  3. streaming: SSE framing, OpenAI and Anthropic stream assembly incl.
 *     tool-call deltas, errors mid-stream, fallback, cancellation;
 *  4. run visibility: realtime routing, report sources, run page route;
 *  5. agent version pins in published workflows.
 */

vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({ enqueueDeletionJob: vi.fn(async () => {}), kickDeletionProcessor: vi.fn() }))
vi.mock('@/lib/process-queue', () => ({ kickAgentQueueProcessor: vi.fn(), kickQueueProcessor: vi.fn() }))
vi.mock('@/lib/config/instance-settings', () => ({ getInstanceSetting: vi.fn(async () => hoisted.instancePrices) }))
const hoisted = vi.hoisted(() => ({ instancePrices: undefined as unknown }))

import { agentDataOperations, agentTableAllows, getAgentBuiltinToolNames, normalizeAgentOutputConfig, normalizeDataAccess } from '@/lib/agent-knowledge'
import { runDataTool } from '@/lib/agents/tools/data'
import type { AgentToolRuntime } from '@/lib/agents/tools/runtime'
import { createAgent, restoreAgentVersion, updateAgent } from '@/lib/services/agents'
import { costOf, DEFAULT_MODEL_PRICES, formatCost, normalizeModelId, normalizePriceList, resolvePrice, summarizeUsage, type ModelPrice } from '@/lib/agents/pricing'
import { checkBudgets, priceRunResult, BudgetExceededError, priceRun } from '@/lib/agents/costs'
import { ChatStreamAssembler, DeltaCoalescer, SseParser, StreamProviderError } from '@/lib/agents/stream'
import { executeAgent, type AgentConfig } from '@/lib/agent-executor'
import { agentPins, pinAgentVersions, pinWorkflowAgents, unpinAgentVersions } from '@/lib/agents/pins'
import { loadAgentForRun } from '@/lib/agents/prepare'
import { getWorkflowAgentPins, updatePinnedAgentVersion } from '@/lib/services/workflows'
import { rowVisible, type Audience } from '@/lib/realtime/events'
import { assertReportSourceAccess } from '@/lib/mcp/tools/reports'
import { canAccessPath } from '@/lib/route-permissions'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows / provider JSON */

const T1 = '0a000000-0000-4000-8000-0000000000c1'
const T2 = '0a000000-0000-4000-8000-0000000000c2'
const TB = '0a000000-0000-4000-8000-0000000000cb'

/* ── 1. Data grants ── */

describe('data grants', () => {
  it('normalises: absent → none; old selected → read/insert/update; all → legacy; empty grants dropped', () => {
    expect(normalizeDataAccess(undefined)).toEqual({ mode: 'none', table_ids: [], grants: [] })
    expect(normalizeAgentOutputConfig({}).data_access.mode).toBe('none')
    expect(normalizeDataAccess({ mode: 'selected', table_ids: [T1] })).toEqual({ mode: 'selected', table_ids: [T1], grants: [{ table_id: T1, read: true, insert: true, update: true, delete: false }] })
    expect(normalizeDataAccess({ mode: 'all' })).toEqual({ mode: 'all', table_ids: [], grants: [], legacy: true })
    expect(normalizeDataAccess({ grants: [{ table_id: T1, read: false }, { table_id: T2, delete: true }] })).toEqual({ mode: 'selected', table_ids: [T2], grants: [{ table_id: T2, read: false, insert: false, update: false, delete: true }] })
  })

  it('gives the model only the data tools for the granted operations', () => {
    expect(getAgentBuiltinToolNames(normalizeAgentOutputConfig({}))).toEqual(['calculate', 'current_datetime'])
    const readOnly = normalizeAgentOutputConfig({ data_access: { grants: [{ table_id: T1, read: true }] } })
    expect(getAgentBuiltinToolNames(readOnly)).toEqual(['calculate', 'current_datetime', 'query_data_table'])
    const mixed = normalizeAgentOutputConfig({ data_access: { grants: [{ table_id: T1, read: true }, { table_id: T2, update: true, delete: true }] } })
    expect(getAgentBuiltinToolNames(mixed)).toEqual(['calculate', 'current_datetime', 'query_data_table', 'update_data_rows', 'delete_data_rows'])
    expect([...agentDataOperations(normalizeDataAccess({ mode: 'all' }))]).toEqual(['read', 'insert', 'update'])
    expect(agentTableAllows(normalizeDataAccess({ mode: 'all' }), T1, 'delete')).toBe(false)
  })

  let db: ReturnType<typeof createMemorySupabase>
  const rt = (config: Record<string, unknown>, actingUserId: string | null = null, perms: string[] = []): AgentToolRuntime => ({
    tenantId: 'ta', agentId: 'agent-1', actingUserId, outputConfig: normalizeAgentOutputConfig(config),
    db: () => db as any, permissions: async () => (actingUserId ? new Set(perms) : null), allowedHosts: [], generatedFiles: [],
  })
  beforeEach(() => {
    db = createMemorySupabase({
      custom_tables: [{ id: T1, tenant_id: 'ta', name: 'Orders' }, { id: T2, tenant_id: 'ta', name: 'Refunds' }, { id: TB, tenant_id: 'tb', name: 'Theirs' }],
      custom_table_rows: [
        { id: 'r1', tenant_id: 'ta', table_id: T1, data: { status: 'open' } },
        { id: 'r2', tenant_id: 'ta', table_id: T2, data: { status: 'void' } },
        { id: 'r3', tenant_id: 'ta', table_id: T2, data: { status: 'ok' } },
      ],
    })
  })

  it('enforces each operation per table, incl. delete', async () => {
    const runtime = rt({ data_access: { grants: [{ table_id: T1, read: true }, { table_id: T2, read: true, delete: true }] } })
    await expect(runDataTool(runtime, 'query_data_table', { table_name: 'Orders' })).resolves.toMatchObject({ count: 1 })
    await expect(runDataTool(runtime, 'insert_data_row', { table_name: 'Orders', data: { a: 1 } })).rejects.toThrow(/may not add rows to table "Orders"/)
    await expect(runDataTool(runtime, 'delete_data_rows', { table_name: 'Orders', filter_column: 'status', filter_value: 'open' })).rejects.toThrow(/may not delete rows from/)
    await expect(runDataTool(runtime, 'delete_data_rows', { table_name: 'Refunds', filter_column: 'status', filter_value: 'void' })).resolves.toEqual({ success: true, table: 'Refunds', deleted: 1 })
    expect((await db.from('custom_table_rows').select('*').eq('table_id', T2)).data).toHaveLength(1)
    await expect(runDataTool(runtime, 'query_data_table', { table_name: 'Theirs' })).rejects.toThrow(/not found/)
    // No grants at all: no data tools.
    await expect(runDataTool(rt({}), 'query_data_table', { table_name: 'Orders' })).rejects.toThrow(/Data access is disabled/)
    // An acting person still needs data.manage_rows to delete.
    await expect(runDataTool(rt({ data_access: { grants: [{ table_id: T2, delete: true }] } }, 'bob', ['data.view']), 'delete_data_rows', { table_name: 'Refunds', filter_column: 'status', filter_value: 'ok' })).rejects.toThrow(/data.manage_rows/)
  })
})

describe('data grants in the agent service', () => {
  let db: any
  const ctx = () => ({ db, supabase: db, tenantId: 'ta', actorId: 'alice', permissions: new Set(['agents.view', 'agents.create', 'agents.edit']), authKind: 'api_key' as const, source: 'api' as const })
  beforeEach(() => {
    db = createMemorySupabase({
      custom_tables: [{ id: T1, tenant_id: 'ta', name: 'Orders' }, { id: TB, tenant_id: 'tb', name: 'Theirs' }],
      user_memberships: [{ tenant_id: 'ta', user_id: 'alice', is_active: true }],
    }, { uuids: true })
  })

  it('new agents have no table access and cannot be given "all tables"; foreign tables are dropped', async () => {
    const agent = await createAgent(ctx() as any, { name: 'New' })
    expect(agent.output_config.data_access).toEqual({ mode: 'none', table_ids: [], grants: [] })
    await expect(createAgent(ctx() as any, { name: 'Broad', output_config: { data_access: { mode: 'all' } } })).rejects.toThrow(/no longer available/)
    await expect(updateAgent(ctx() as any, agent.id, { output_config: { data_access: { mode: 'all' } } })).rejects.toThrow(/no longer available/)
    const granted = await updateAgent(ctx() as any, agent.id, { output_config: { data_access: { grants: [{ table_id: T1, read: true }, { table_id: TB, read: true }] } } })
    expect(granted.output_config.data_access).toEqual({ mode: 'selected', table_ids: [T1], grants: [{ table_id: T1, read: true, insert: false, update: false, delete: false }] })
  })

  it('a legacy "all tables" agent keeps it on save, and restoring an old version never re-broadens a narrowed agent', async () => {
    const agent = await createAgent(ctx() as any, { name: 'Legacy' })
    // As migrated: legacy all tables.
    await db.from('agents').update({ output_config: { ...agent.output_config, data_access: { mode: 'all', table_ids: [], grants: [], legacy: true } } }).eq('id', agent.id)
    const kept = await updateAgent(ctx() as any, agent.id, { role: 'still broad', output_config: { data_access: { mode: 'all' } } })
    expect(kept.output_config.data_access.mode).toBe('all')
    const narrowed = await updateAgent(ctx() as any, agent.id, { output_config: { data_access: { grants: [{ table_id: T1, read: true }] } } })
    expect(narrowed.output_config.data_access.mode).toBe('selected')
    const restored = await restoreAgentVersion(ctx() as any, agent.id, kept.version)
    expect(restored.output_config.data_access.grants).toEqual([{ table_id: T1, read: true, insert: false, update: false, delete: false }])
    expect(restored.role).toBe('still broad')
  })
})

/* ── 2. Cost ── */

const price = (over: Partial<ModelPrice> = {}): ModelPrice => ({ provider: 'openai', model: 'gpt-4.1', input_per_1m: 2, output_per_1m: 8, cached_input_per_1m: 0.5, currency: 'USD', effective_date: '2026-01-01', ...over })

describe('pricing', () => {
  it('ships list prices only for verified models, dated, and leaves the rest unknown', () => {
    // Every row is dated (announced vendor increases are later-dated rows) and in USD.
    expect(DEFAULT_MODEL_PRICES.every((p) => p.effective_date >= '2026-10-29' && p.currency === 'USD')).toBe(true)
    expect(resolvePrice({}, 'openai', 'gpt-4.1')).toMatchObject({ input_per_1m: 2, output_per_1m: 8, source: 'default' })
    expect(resolvePrice({}, 'anthropic', 'claude-haiku-4-5-20251001')).toMatchObject({ model: 'claude-haiku-4-5' })
    expect(resolvePrice({}, 'deepseek', 'deepseek-chat')).toBeNull()
    // Azure OpenAI: the OpenAI list price by model name (a deployment named after its model); other deployment names stay unknown.
    expect(resolvePrice({}, 'azure_openai', 'gpt-4.1')).toMatchObject({ input_per_1m: 2, output_per_1m: 8 })
    expect(resolvePrice({}, 'azure_openai', 'my-prod-deployment')).toBeNull()
    expect(normalizeModelId('models/Gemini-2.5-Flash')).toBe('gemini-2.5-flash')
  })

  it('workspace overrides instance overrides defaults; the latest effective date on or before the run applies', () => {
    const layers = {
      workspace: [price({ input_per_1m: 1, effective_date: '2026-06-01' })],
      instance: [price({ input_per_1m: 1.5 }), price({ provider: '*', model: 'my-model', input_per_1m: 3, output_per_1m: 3 })],
    }
    expect(resolvePrice(layers, 'openai', 'gpt-4.1', '2026-07-01')).toMatchObject({ input_per_1m: 1, source: 'workspace' })
    expect(resolvePrice(layers, 'openai', 'gpt-4.1', '2026-05-01')).toMatchObject({ input_per_1m: 1.5, source: 'instance' })
    expect(resolvePrice(layers, 'ollama', 'my-model')).toMatchObject({ input_per_1m: 3, source: 'instance' })
  })

  it('costs cached input at its own price and validates price lists', () => {
    // 1M prompt of which 400k cached, 100k completion: 0.6×2 + 0.4×0.5 + 0.1×8 = 2.2
    expect(costOf({ prompt_tokens: 1_000_000, cached_tokens: 400_000, completion_tokens: 100_000 }, price())).toBeCloseTo(2.2, 10)
    expect(costOf({ prompt_tokens: 1000, completion_tokens: 0 }, price({ cached_input_per_1m: null }))).toBeCloseTo(0.002, 10)
    expect(normalizePriceList([{ model: 'x', input_per_1m: -1, output_per_1m: 1 }]).errors[0]).toMatch(/input and output prices/)
    expect(normalizePriceList([{ model: 'x', input_per_1m: 1, output_per_1m: 1, currency: 'EURO' }]).errors[0]).toMatch(/currency/)
    expect(normalizePriceList([{ model: 'x', input_per_1m: 1, output_per_1m: 2, currency: 'eur', effective_date: '2026-02-01' }]).prices[0]).toMatchObject({ provider: '*', currency: 'EUR' })
    expect(formatCost(0.01234, 'USD')).toBe('$0.0123')
    expect(formatCost(null, 'USD')).toBe('cost unknown')
  })

  it('prices each LLM call and the run; unknown model or missing usage → cost unknown, never zero', () => {
    const steps: any[] = [
      { type: 'llm', iteration: 1, usage: { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1100 } },
      { type: 'tool', iteration: 1, tool: 'x' },
      { type: 'llm', iteration: 2, usage: { prompt_tokens: 2000, completion_tokens: 200, total_tokens: 2200 } },
    ]
    const usage = { prompt_tokens: 3000, completion_tokens: 300, total_tokens: 3300 }
    const priced = priceRunResult({ usage, steps }, 'openai', 'gpt-4.1', { workspace: [], instance: [], defaults: DEFAULT_MODEL_PRICES })
    expect(priced).toMatchObject({ status: 'priced', currency: 'USD', snapshot: { model: 'gpt-4.1', source: 'default', effective_date: '2026-10-29' } })
    expect(priced.amount).toBeCloseTo((3000 * 2 + 300 * 8) / 1e6, 10)
    expect((priced.steps[0] as any).cost.amount).toBeCloseTo((1000 * 2 + 100 * 8) / 1e6, 10)
    expect((priced.steps[1] as any).cost).toBeUndefined()
    expect(priceRunResult({ usage, steps }, 'openai', 'gpt-unknown', { workspace: [], instance: [], defaults: DEFAULT_MODEL_PRICES })).toMatchObject({ status: 'unknown', amount: null })
    const noUsage = priceRunResult({ usage, steps: [{ type: 'llm', iteration: 1 } as any] }, 'openai', 'gpt-4.1', { workspace: [], instance: [], defaults: DEFAULT_MODEL_PRICES })
    expect(noUsage.status).toBe('unknown')
  })

  it('uses the instance price table setting', async () => {
    hoisted.instancePrices = [{ provider: 'openai', model: 'gpt-4.1', input_per_1m: 1, output_per_1m: 1, currency: 'EUR', effective_date: '2026-01-01' }]
    const db = createMemorySupabase({})
    const cost = await priceRun(db as any, 'ta', { usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 }, steps: [] }, 'openai', 'gpt-4.1')
    expect(cost).toMatchObject({ status: 'priced', amount: 1, currency: 'EUR', snapshot: { source: 'instance' } })
    hoisted.instancePrices = undefined
  })

  it('summarises usage per day, last 24 hours and this month, per currency', () => {
    const now = Date.parse('2026-10-29T12:00:00Z')
    const s = summarizeUsage([
      { started_at: '2026-10-29T10:00:00Z', total_tokens: 100, status: 'completed', cost_amount: '0.5', cost_currency: 'USD', cost_status: 'priced' },
      { started_at: '2026-10-29T11:00:00Z', total_tokens: 50, status: 'failed', cost_status: 'unknown' },
      { started_at: '2026-10-02T10:00:00Z', total_tokens: 10, cost_amount: 1, cost_currency: 'EUR', cost_status: 'priced' },
      { started_at: '2026-09-30T10:00:00Z', total_tokens: 7, cost_amount: 9, cost_currency: 'USD', cost_status: 'priced' },
    ], now)
    expect(s.tokens_last_24h).toBe(150)
    expect(s.cost_last_24h).toEqual({ USD: 0.5 })
    expect(s.cost_this_month).toEqual({ USD: 0.5, EUR: 1 })
    expect(s.tokens_this_month).toBe(160)
    expect(s.unpriced_runs).toBe(1)
    expect(s.days.find((d) => d.day === '2026-10-29')).toMatchObject({ runs: 2, failed: 1, tokens: 150, cost: { USD: 0.5 }, unpriced_runs: 1 })
  })

  it('refuses runs when an agent or workspace budget (tokens or cost, day or month) is spent', async () => {
    const now = new Date().toISOString()
    const db = createMemorySupabase({
      agent_runs: [
        { tenant_id: 'ta', agent_id: 'a1', started_at: now, total_tokens: 500, cost_amount: 1.25, cost_currency: 'USD', cost_status: 'priced' },
        { tenant_id: 'ta', agent_id: 'a2', started_at: now, total_tokens: 900, cost_status: 'unknown' },
        { tenant_id: 'tb', agent_id: 'b1', started_at: now, total_tokens: 99_999, cost_amount: 999, cost_currency: 'USD', cost_status: 'priced' },
      ],
      agent_cost_settings: [],
    })
    const cfg = (limits: Record<string, unknown>) => normalizeAgentOutputConfig({ limits })
    await expect(checkBudgets(db as any, 'ta', 'a1', cfg({ daily_cost_budget: 2 }))).resolves.toBeUndefined()
    await expect(checkBudgets(db as any, 'ta', 'a1', cfg({ daily_cost_budget: 1 }))).rejects.toThrow(/spent \$1\.25 in the last 24 hours — its daily budget is \$1\.00/)
    await expect(checkBudgets(db as any, 'ta', 'a1', cfg({ monthly_token_budget: 400 }))).rejects.toThrow(/500 tokens this month/)
    // A EUR budget does not count USD runs.
    await expect(checkBudgets(db as any, 'ta', 'a1', cfg({ daily_cost_budget: 1, budget_currency: 'EUR' }))).resolves.toBeUndefined()
    await db.from('agent_cost_settings').insert({ tenant_id: 'ta', model_prices: [], budgets: { monthly_token_budget: 1000 } })
    await expect(checkBudgets(db as any, 'ta', 'a1', cfg({}))).rejects.toThrow(/workspace's agents used 1,400 tokens this month/)
    await expect(checkBudgets(db as any, 'ta', 'a1', cfg({}))).rejects.toBeInstanceOf(BudgetExceededError)
  })
})

/* ── 3. Streaming ── */

const enc = new TextEncoder()
function sseBody(chunks: string[], opts: { failAfter?: number } = {}): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (opts.failAfter !== undefined && i === opts.failAfter) { controller.error(new TypeError('socket hang up')); return }
      if (i >= chunks.length) { controller.close(); return }
      controller.enqueue(enc.encode(chunks[i++]))
    },
  })
}
const sseResponse = (chunks: string[], opts: { failAfter?: number } = {}) => new Response(sseBody(chunks, opts), { status: 200, headers: { 'content-type': 'text/event-stream' } })
const data = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`

describe('SSE parsing and stream assembly', () => {
  it('frames events split anywhere (mid-line, CRLF split, multi-byte characters), skips comments', () => {
    const p = new SseParser()
    const raw = enc.encode(': keep-alive\r\nevent: message\r\ndata: {"a":"é"}\r\n\r\ndata: one\ndata: two\n\n')
    const out: any[] = []
    for (let i = 0; i < raw.length; i += 3) out.push(...p.push(raw.subarray(i, i + 3)))
    out.push(...p.end())
    expect(out).toEqual([{ event: 'message', data: '{"a":"é"}' }, { event: null, data: 'one\ntwo' }])
  })

  it('assembles OpenAI-style text and tool-call deltas (by index, arguments in pieces) with usage', () => {
    const a = new ChatStreamAssembler()
    const events = [
      { choices: [{ delta: { role: 'assistant', content: 'Look' } }] },
      { choices: [{ delta: { content: 'ing…' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', type: 'function', function: { name: 'query_data_table', arguments: '{"table_' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, id: 'c2', function: { name: 'calculate', arguments: '{"expression":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'name":"Orders"}' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '"1+1"}' } }] }, finish_reason: 'tool_calls' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
    ]
    const deltas = events.flatMap((e) => a.push({ event: null, data: JSON.stringify(e) }))
    a.push({ event: null, data: '[DONE]' })
    expect(a.done).toBe(true)
    expect(deltas.filter((d) => d.text).map((d) => d.text).join('')).toBe('Looking…')
    const r = a.result()
    expect(r.choices[0].message.tool_calls).toEqual([
      { id: 'c1', type: 'function', function: { name: 'query_data_table', arguments: '{"table_name":"Orders"}' } },
      { id: 'c2', type: 'function', function: { name: 'calculate', arguments: '{"expression":"1+1"}' } },
    ])
    expect(r.choices[0].finish_reason).toBe('tool_calls')
    expect(r.usage).toEqual({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 })
  })

  it('assembles Anthropic Messages events (text, tool_use input_json_delta, stop reason, usage incl. cache reads)', () => {
    const a = new ChatStreamAssembler()
    const ev = (event: string, obj: unknown) => a.push({ event, data: JSON.stringify(obj) })
    ev('message_start', { type: 'message_start', message: { model: 'claude-sonnet-4-6', usage: { input_tokens: 20, cache_read_input_tokens: 80 } } })
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Checking' } })
    ev('content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tu_1', name: 'calculate' } })
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"expression"' } })
    ev('content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':"2*3"}' } })
    ev('ping', { type: 'ping' })
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 12 } })
    ev('message_stop', { type: 'message_stop' })
    const r = a.result()
    expect(r.choices[0]).toEqual({ message: { role: 'assistant', content: 'Checking', tool_calls: [{ id: 'tu_1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"2*3"}' } }] }, finish_reason: 'tool_calls' })
    expect(r.usage).toEqual({ prompt_tokens: 100, completion_tokens: 12, total_tokens: 112, prompt_tokens_details: { cached_tokens: 80 } })
    expect(a.done).toBe(true)
  })

  it('turns an error payload mid-stream into a StreamProviderError (retryable when transient)', () => {
    const a = new ChatStreamAssembler()
    expect(() => a.push({ event: 'error', data: JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }) })).toThrow(StreamProviderError)
    try { a.push({ event: null, data: JSON.stringify({ error: { message: 'Invalid model', code: 'invalid_request' } }) }) } catch (e) { expect((e as StreamProviderError).retryable).toBe(false) }
  })

  it('coalesces text deltas and holds them while the consumer is behind', async () => {
    vi.useFakeTimers()
    const out: string[] = []
    let ready = false
    const c = new DeltaCoalescer((t) => out.push(t), { intervalMs: 10, maxChars: 1000, ready: () => ready })
    c.text('a'); c.text('b')
    await vi.advanceTimersByTimeAsync(30)
    expect(out).toEqual([])
    ready = true
    c.text('c')
    await vi.advanceTimersByTimeAsync(30)
    expect(out).toEqual(['abc'])
    c.text('d'); c.close()
    expect(out).toEqual(['abc', 'd'])
    vi.useRealTimers()
  })
})

const baseConfig: AgentConfig = {
  baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'gpt-4.1', systemPrompt: 'Be helpful', temperature: null, maxTokens: 100, maxIterations: 5,
  tools: [{ id: 'calc', type: 'builtin', name: 'calculate', description: 'math', inputSchema: [{ name: 'expression', type: 'string', description: 'e', required: true }] }],
  provider: 'openai', endpoint: { url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' } },
}

describe('executeAgent streaming', () => {
  it('streams text and tool-call deltas, runs the assembled tool call, and records usage', async () => {
    const bodies: any[] = []
    const replies = [
      sseResponse([
        data({ choices: [{ delta: { content: 'Let me ' } }] }),
        data({ choices: [{ delta: { content: 'calculate.' } }] }).slice(0, 10), data({ choices: [{ delta: { content: 'calculate.' } }] }).slice(10),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'calculate', arguments: '{"expr' } }] } }] }),
        data({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'ession":"6*7"}' } }] }, finish_reason: 'tool_calls' }] }),
        data({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }),
        'data: [DONE]\n\n',
      ]),
      sseResponse([data({ choices: [{ delta: { content: 'It is 42.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 70, completion_tokens: 5, total_tokens: 75 } }), 'data: [DONE]\n\n']),
    ]
    const fetchImpl = vi.fn(async (_url: any, init: any) => { bodies.push(JSON.parse(init.body)); return replies.shift()! })
    const events: any[] = []
    const result = await executeAgent(baseConfig, 'what is 6*7?', { stream: true, onEvent: (e) => events.push(e), fetchImpl: fetchImpl as any, sleep: async () => {} })
    expect(result.status).toBe('completed')
    expect(result.response).toBe('It is 42.')
    expect(bodies[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } })
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Let me calculate.It is 42.')
    expect(events.some((e) => e.type === 'tool_call_delta' && e.toolCallDelta.name === 'calculate')).toBe(true)
    expect(result.toolCalls[0]).toMatchObject({ toolName: 'calculate', arguments: { expression: '6*7' }, result: { result: 42 } })
    expect(result.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 15, total_tokens: 135 })
    expect(result.steps.filter((s) => s.type === 'llm').every((s: any) => s.streamed === true)).toBe(true)
  })

  it('an error mid-stream resets the partial reply and retries; a provider rejecting streaming falls back to a normal request', async () => {
    const replies: Response[] = [
      sseResponse([data({ choices: [{ delta: { content: 'Half an ans' } }] })], { failAfter: 1 }),
      sseResponse([data({ choices: [{ delta: { content: 'Whole answer.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })]),
    ]
    const events: any[] = []
    const r1 = await executeAgent({ ...baseConfig, tools: [] }, 'hi', { stream: true, onEvent: (e) => events.push(e), fetchImpl: (async () => replies.shift()!) as any, sleep: async () => {} })
    expect(r1.response).toBe('Whole answer.')
    const kinds = events.map((e) => e.type)
    expect(kinds.indexOf('delta_reset')).toBeGreaterThan(kinds.indexOf('delta'))
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text)).toEqual(['Half an ans', 'Whole answer.'])

    const seen: any[] = []
    const fallback = vi.fn(async (_u: any, init: any) => {
      const body = JSON.parse(init.body)
      seen.push(body)
      if (body.stream) return new Response('{"error":{"message":"stream is not supported for this model"}}', { status: 400 })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'plain' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const r2 = await executeAgent({ ...baseConfig, tools: [] }, 'hi', { stream: true, onEvent: () => {}, fetchImpl: fallback as any, sleep: async () => {} })
    expect(r2).toMatchObject({ status: 'completed', response: 'plain' })
    expect(seen.map((b) => Boolean(b.stream))).toEqual([true, false])
    expect((r2.steps[0] as any).streamed).toBe(false)
    expect((r2.steps[0] as any).attempts).toBe(1)
  })

  it('drops only stream_options when that is what the provider rejects; non-streaming callers never send stream', async () => {
    const seen: any[] = []
    const impl = vi.fn(async (_u: any, init: any) => {
      const body = JSON.parse(init.body)
      seen.push(body)
      if (body.stream_options) return new Response('Unrecognized request argument supplied: stream_options', { status: 400 })
      return sseResponse([data({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] })])
    })
    const r = await executeAgent({ ...baseConfig, tools: [] }, 'hi', { stream: true, onEvent: () => {}, fetchImpl: impl as any, sleep: async () => {} })
    expect(r.response).toBe('ok')
    expect(seen.map((b) => [Boolean(b.stream), Boolean(b.stream_options)])).toEqual([[true, true], [true, false]])
    // No usage in the stream: the step has none (the run's cost is then unknown, never zero).
    expect((r.steps[0] as any).usage).toBeUndefined()

    const plain: any[] = []
    await executeAgent({ ...baseConfig, tools: [] }, 'hi', { fetchImpl: (async (_u: any, init: any) => { plain.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }), { headers: { 'content-type': 'application/json' } }) }) as any })
    expect(plain[0].stream).toBeUndefined()
  })

  it('cancellation stops a stream in flight', async () => {
    const abort = new AbortController()
    const impl = vi.fn(async (_u: any, init: any) => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(enc.encode(data({ choices: [{ delta: { content: 'partial' } }] })))
        init.signal.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')))
      },
    }), { headers: { 'content-type': 'text/event-stream' } }))
    const events: any[] = []
    const run = executeAgent({ ...baseConfig, tools: [] }, 'hi', { stream: true, signal: abort.signal, onEvent: (e) => { events.push(e); if (e.type === 'delta') abort.abort() }, fetchImpl: impl as any, sleep: async () => {} })
    const result = await run
    expect(result).toMatchObject({ status: 'failed', error_kind: 'cancelled' })
    expect(events.some((e) => e.type === 'delta' && e.text === 'partial')).toBe(true)
  })
})

/* ── 4. Run visibility ── */

describe('run visibility outside RLS', () => {
  it('realtime: every run with agents.view, else only runs the user acted for / started', () => {
    const me = 'u-me'
    const aud: Audience = { userId: me, visible: new Set(['ta']), current: 'ta', agent: new Set(), agentMember: new Set(['ta']), member: new Set(['ta']) }
    const row = (cols: Record<string, string[]>, tenant = 'ta') => ({ id: 'r', tenant_id: tenant, cols })
    expect(rowVisible('agent_runs', row({ actor_id: ['other'], initiated_by: [] }), aud)).toBe(false)
    expect(rowVisible('agent_runs', row({ actor_id: [], initiated_by: [me] }), aud)).toBe(true)
    expect(rowVisible('agent_runs', row({ actor_id: [me] }, 'tb'), aud)).toBe(false)
    expect(rowVisible('agent_runs', row({}), { ...aud, agent: new Set(['ta']) })).toBe(true)
  })

  it('report sources: agent_runs (also as a join) needs agents.view for service-role callers', () => {
    expect(() => assertReportSourceAccess({ data_source: 'agent_runs' } as any, ['reports.view'])).toThrow(/agents.view/)
    expect(() => assertReportSourceAccess({ data_source: 'tasks', joins: [{ source: 'agent_runs' }] } as any, ['reports.view', 'tasks.view_all'])).toThrow(/agents.view/)
    expect(() => assertReportSourceAccess({ data_source: 'agent_runs' } as any, ['reports.view', 'agents.view'])).not.toThrow()
    expect(() => assertReportSourceAccess({ data_source: 'agent_runs' } as any, null)).not.toThrow() // session callers: RLS decides
  })

  it('the run page opens for anyone signed in (RLS decides); the rest of /agents needs agents.view', () => {
    const run = '/agents/0a000000-0000-4000-8000-000000000001/runs/0a000000-0000-4000-8000-000000000002'
    expect(canAccessPath(run, [])).toBe(true)
    expect(canAccessPath('/agents/0a000000-0000-4000-8000-000000000001/runs', [])).toBe(false)
    expect(canAccessPath('/agents/costs', [])).toBe(false)
    expect(canAccessPath('/agents/costs', ['agents.view'])).toBe(true)
  })
})

/* ── 5. Version pins ── */

const AG = '0a000000-0000-4000-8000-0000000000a9'
const WF = '0a000000-0000-4000-8000-0000000000f1'

describe('agent version pins', () => {
  const nodes = [
    { id: 'start', type: 'manual', config: {} },
    { id: 'n1', type: 'run_agent', label: 'Triage', config: { agent_id: AG, user_message: 'x' } },
    { id: 'n2', type: 'run_agent', label: 'Other', config: { agent_id: 'gone' } },
  ]

  it('pins Run Agent steps to their agents\' versions and strips pins for drafts', async () => {
    const pinned = pinAgentVersions(nodes, new Map([[AG, 3]]))
    expect(agentPins(pinned)).toEqual([
      { node_id: 'n1', node_label: 'Triage', agent_id: AG, version: 3 },
      { node_id: 'n2', node_label: 'Other', agent_id: 'gone', version: null },
    ])
    expect(unpinAgentVersions(pinned)).toEqual(nodes)
    const db = createMemorySupabase({ agents: [{ id: AG, tenant_id: 'ta', version: 5 }, { id: AG.replace('a9', 'b9'), tenant_id: 'tb', version: 9 }] })
    expect(agentPins(await pinWorkflowAgents(db as any, 'ta', nodes))[0].version).toBe(5)
    expect(agentPins(await pinWorkflowAgents(db as any, 'tb', nodes))[0].version).toBeNull() // another workspace's agent is never pinned
  })

  let db: any
  beforeEach(() => {
    db = createMemorySupabase({
      agents: [{ id: AG, tenant_id: 'ta', name: 'Triage agent', version: 5, is_active: true, role: 'v5 role', model: 'gpt-4.1', integration_id: 'int-a', created_by: 'alice' }],
      agent_versions: [
        { tenant_id: 'ta', agent_id: AG, version: 3, snapshot: { name: 'Triage agent', role: 'v3 role', model: 'gpt-4o-mini', integration_id: 'int-a' } },
        { tenant_id: 'ta', agent_id: AG, version: 5, snapshot: { name: 'Triage agent', role: 'v5 role', model: 'gpt-4.1', integration_id: 'int-a' } },
      ],
      integrations: [{ id: 'int-a', tenant_id: 'ta', type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com', auth_config: { token: 'sk' } } }],
      workflows: [{ id: WF, tenant_id: 'ta', name: 'Support', published_version_id: 'v-1', is_active: true }],
      workflow_versions: [{ id: 'v-1', workflow_id: WF, tenant_id: 'ta', version_number: 1, nodes: pinAgentVersions(nodes, new Map([[AG, 3]])), edges: [], trigger_type: 'manual', is_active: true, publish_notes: 'first' }],
    }, { uuids: true })
  })

  it('a pinned run uses the version snapshot; the live row keeps id / active flag; unknown pins fail clearly', async () => {
    const pinned = await loadAgentForRun(db, 'ta', AG, { version: 3 })
    expect(pinned.agent).toMatchObject({ id: AG, role: 'v3 role', model: 'gpt-4o-mini', version: 3, is_active: true, created_by: 'alice' })
    expect((await loadAgentForRun(db, 'ta', AG)).agent).toMatchObject({ role: 'v5 role', version: 5 })
    await expect(loadAgentForRun(db, 'ta', AG, { version: 4 })).rejects.toThrow(/Version 4 of agent "Triage agent" \(pinned by the published workflow\) was not found/)
    await db.from('agents').update({ is_active: false }).eq('id', AG)
    await expect(loadAgentForRun(db, 'ta', AG, { version: 3 })).rejects.toThrow(/inactive/)
  })

  it('shows pins with the current version and re-pins the published version without publishing the draft', async () => {
    const ctx: any = { db, supabase: db, tenantId: 'ta', actorId: 'alice', permissions: new Set(['workflows.view', 'workflows.activate']), authKind: 'api_key', source: 'api' }
    const view = await getWorkflowAgentPins(ctx, WF)
    expect(view.pins.find((p: any) => p.node_id === 'n1')).toMatchObject({ version: 3, current_version: 5 })
    const result = await updatePinnedAgentVersion(ctx, WF, 'n1')
    expect(result).toMatchObject({ updated: true, version_number: 2, changes: [{ node_id: 'n1', from: 3, to: 5 }] })
    const { data: versions } = await db.from('workflow_versions').select('*').eq('workflow_id', WF)
    const live = versions.find((v: any) => v.is_active)
    expect(live).toMatchObject({ version_number: 2, publish_notes: expect.stringContaining('Triage: v3 → v5') })
    expect(agentPins(live.nodes)[0].version).toBe(5)
    expect((await db.from('workflows').select('published_version_id').eq('id', WF).single()).data.published_version_id).toBe(live.id)
    // Nothing more to update.
    expect(await updatePinnedAgentVersion(ctx, WF, 'n1')).toMatchObject({ updated: false })
    await expect(updatePinnedAgentVersion({ ...ctx, permissions: new Set(['workflows.view']) }, WF, 'n1')).rejects.toThrow(/workflows.activate/)
  })
})
