/**
 * Agent token efficiency: history compaction (pairing kept, writes kept),
 * the build reference tool, compact reads, deferred tool groups, the token
 * budget (unlimited by default; a set limit stops resumably before the call),
 * the price table for current models (cache reads / writes), and Anthropic's
 * native Messages API (request / response mapping, streaming, cache_control
 * placement, fallback to the compatibility endpoint). All HTTP is mocked.
 */
import { describe, expect, it, vi } from 'vitest'
import { addUsage, type AgentUsage } from '@/lib/agent-executor'
import { budgetTokens, buildModelMessages, CONTEXT_OPEN, KEEP_RECENT_RESULTS, resumableStopText, runAssistantTurn, STUB_MIN, type AssistantToolDef, type HistoryCompaction } from '@/lib/assistants/engine'
import { ANTHROPIC_VERSION, fromMessagesResponse, messagesHeaders, messagesUrl, toMessagesBody, useAnthropicNative } from '@/lib/agents/anthropic-messages'
import { costOf, DEFAULT_MODEL_PRICES, resolvePrice, normalizePriceList } from '@/lib/agents/pricing'
import { compactCatalog, compactRead, summarizeForm, summarizeWorkflow } from '@/lib/assistants/tools/compact-reads'
import { buildReference, nodeReference, referenceKindOf, NODE_REFERENCE_TOOL } from '@/lib/assistants/tools/node-reference'
import { designerTools, LOAD_TOOLS, PARAM_DESCRIPTION_MAX, toolGroupOf } from '@/lib/assistants/tools/designer'
import { CAPABILITY_LIMITS, parseChatRequest, prepareAssistantTurn } from '@/lib/assistants/chat'
import { normalizeLimits } from '@/lib/assistants/config'
import { assistantInstructions } from '@/lib/assistants/prompts'
import type { ChatMessage } from '@/lib/assistants/types'
import type { AssistantConnection } from '@/lib/assistants/settings'
import type { ServiceContext } from '@/lib/services/context'

/* eslint-disable @typescript-eslint/no-explicit-any */

const conn: AssistantConnection = { provider: 'openai', model: 'gpt-4.1', url: 'https://llm.test/v1/chat/completions', headers: { 'Content-Type': 'application/json' }, baseUrl: 'https://llm.test' }
const claude: AssistantConnection = { provider: 'anthropic', model: 'claude-sonnet-5-5', url: 'https://api.anthropic.com/v1/chat/completions', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sk-ant-test-key' }, baseUrl: 'https://api.anthropic.com' }
const call = (id: string, name: string, args: unknown) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } })
const ALL_BUILD = ['workflows.view', 'workflows.create', 'workflows.edit', 'forms.view', 'forms.edit', 'data.view', 'data.create', 'data.edit_schema', 'data.manage_rows', 'extensibility.view', 'extensibility.create', 'extensibility.edit']

function provider(...replies: Array<{ content?: string | null; tool_calls?: any[]; usage?: any }>) {
  const bodies: any[] = []
  const urls: string[] = []
  const fetchImpl = vi.fn(async (url: any, init: any) => {
    urls.push(String(url))
    bodies.push(JSON.parse(init.body))
    const msg = replies[Math.min(bodies.length - 1, replies.length - 1)]
    return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls }, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage: msg.usage ?? { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { fetchImpl: fetchImpl as unknown as typeof fetch, bodies, urls }
}

const big = (label: string) => JSON.stringify({ tool: 'x', untrusted_data: true, result: JSON.stringify({ name: label, nodes: Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, config: { text: 'lorem ipsum dolor sit amet' } })) }) })

/* ── History compaction ── */

describe('history compaction', () => {
  const compact: HistoryCompaction = { keepRecent: 2, compactable: (n) => !/_create$|^build_plan/.test(n) }
  const history: ChatMessage[] = [
    { role: 'user', content: 'Build a leave process' },
    { role: 'assistant', content: null, tool_calls: [call('r1', 'workflows_get_definition', { workflow_id: 'w1' }), call('r2', 'forms_get', { form_id: 'f1' })] },
    { role: 'tool', tool_call_id: 'r1', name: 'workflows_get_definition', content: big('Purchase request') },
    { role: 'tool', tool_call_id: 'r2', name: 'forms_get', content: big('Expense form') },
    { role: 'assistant', content: null, tool_calls: [call('w1', 'build_plan', { items: Array.from({ length: 40 }, (_, i) => ({ key: `k${i}`, kind: 'form', name: `Form ${i}`, args: { name: `Form ${i}` } })) })] },
    { role: 'tool', tool_call_id: 'w1', name: 'build_plan', content: JSON.stringify({ result: JSON.stringify({ status: 'completed', created: [{ key: 'k1', id: 'id-1' }], pad: 'x'.repeat(3000) }) }) },
    { role: 'assistant', content: 'Built it.' },
    { role: 'user', content: 'And another one' },
    { role: 'assistant', content: null, tool_calls: [call('r3', 'workflows_catalog', {})] },
    { role: 'tool', tool_call_id: 'r3', name: 'workflows_catalog', content: big('catalog') },
    { role: 'assistant', content: null, tool_calls: [call('r4', 'data_tables_list', {})] },
    { role: 'tool', tool_call_id: 'r4', name: 'data_tables_list', content: big('tables') },
  ]

  it('keeps every tool call paired with its reply; old reads become stubs, recent ones and writes stay', () => {
    const msgs = buildModelMessages('X', history, { screen: 'Workflows' }, { compact })
    const callIds = msgs.flatMap((m: any) => (m.tool_calls ?? []).map((c: any) => c.id))
    const replyIds = msgs.filter((m) => m.role === 'tool').map((m: any) => m.tool_call_id)
    expect(replyIds).toEqual(callIds)
    // Each reply directly follows its assistant message's calls.
    msgs.forEach((m: any, i) => { if (m.role === 'tool') expect(['assistant', 'tool']).toContain(msgs[i - 1].role) })
    const reply = (id: string) => String(msgs.find((m: any) => m.tool_call_id === id)!.content)
    expect(reply('r1')).toMatch(/"omitted":true/)
    expect(reply('r1')).toMatch(/workflows_get_definition \(workflow_id w1 · “Purchase request”\)/)
    expect(reply('r1')).toMatch(/Call the tool again/)
    expect(reply('r2')).toMatch(/"omitted":true/)
    // The two most recent results stay in full.
    expect(reply('r3')).toBe(history[9].content)
    expect(reply('r4')).toBe(history[11].content)
    // A write's result (created ids) is never stubbed.
    expect(reply('w1')).toContain('id-1')
  })

  it('compacts big arguments of calls that went through in earlier turns only; keeps declined / failed ones', () => {
    const msgs = buildModelMessages('X', history, null, { compact })
    const args = (id: string) => msgs.flatMap((m: any) => m.tool_calls ?? []).find((c: any) => c.id === id).function.arguments
    expect(JSON.parse(args('w1'))._omitted).toMatch(/already ran/)
    const failed = history.map((m) => (m.tool_call_id === 'w1' ? { ...m, content: JSON.stringify({ result: JSON.stringify({ status: 'failed', created: [] }) }) } : m))
    expect(JSON.parse(buildModelMessages('X', failed, null, { compact }).flatMap((m: any) => m.tool_calls ?? []).find((c: any) => c.id === 'w1').function.arguments).items).toHaveLength(40)
    const declined = history.map((m) => (m.tool_call_id === 'w1' ? { ...m, content: JSON.stringify({ result: JSON.stringify({ declined: true }) }) } : m))
    expect(JSON.parse(buildModelMessages('X', declined, null, { compact }).flatMap((m: any) => m.tool_calls ?? []).find((c: any) => c.id === 'w1').function.arguments).items).toHaveLength(40)
    // In the current turn (after the last user message) arguments stay whole.
    const current: ChatMessage[] = [history[0], history[4], history[5]]
    expect(JSON.parse(buildModelMessages('X', current, null, { compact }).flatMap((m: any) => m.tool_calls ?? [])[0].function.arguments).items).toHaveLength(40)
  })

  it('the context block stays on the latest user message only; without compaction nothing changes', () => {
    const msgs = buildModelMessages('X', history, { screen: 'Workflows' }, { compact })
    const users = msgs.filter((m) => m.role === 'user').map((m) => String(m.content))
    expect(users[0]).not.toContain(CONTEXT_OPEN)
    expect(users[1]).toContain(CONTEXT_OPEN)
    const plain = buildModelMessages('X', history, null)
    expect(plain.find((m: any) => m.tool_call_id === 'r1')!.content).toBe(history[2].content)
    expect(STUB_MIN).toBeGreaterThan(500)
  })

  it('the engine compacts what it sends but never what it keeps (pending confirmation state)', async () => {
    const reads = Array.from({ length: KEEP_RECENT_RESULTS + 2 }, (_, i) => ({ tool_calls: [call(`c${i}`, 'read_big', {})] }))
    const { fetchImpl, bodies } = provider(...reads, { content: null, tool_calls: [call('w', 'make_it', { name: 'x' })] })
    const readTool: AssistantToolDef = { name: 'read_big', description: 'r', parameters: { type: 'object', properties: {} }, mode: 'read', label: () => 'r', run: async () => ({ result: { blob: 'y'.repeat(5000) } }) }
    const writeTool: AssistantToolDef = { name: 'make_it', description: 'w', parameters: { type: 'object', properties: {} }, mode: 'write', label: () => 'w', confirm: async () => ({ title: 'Make', lines: [], warnings: [] }), run: async () => ({ result: { ok: true } }) }
    const result = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'go' }], tools: [readTool, writeTool], onEvent: () => {}, fetchImpl, limits: { maxIterations: 20 } })
    expect(result.status).toBe('awaiting_confirmation')
    const lastBody = bodies[bodies.length - 1]
    expect(lastBody.messages.filter((m: any) => m.role === 'tool' && /"omitted":true/.test(m.content))).toHaveLength(2)
    // The browser keeps the full results.
    expect(result.newMessages.filter((m) => m.role === 'tool').every((m) => String(m.content).length > 4000)).toBe(true)
  })
})

/* ── Build reference ── */

describe('workflow_node_reference', () => {
  it('returns settings, required fields, outputs and an example per node type', () => {
    const ut = nodeReference('user_task')!
    expect(ut).toMatchObject({ type: 'user_task', label: expect.any(String), purpose: expect.any(String) })
    expect(String(ut.settings)).toContain('outcomes')
    expect(String(ut.settings)).not.toMatch(/\]\(\/docs/)
    expect(ut.required).toEqual(expect.arrayContaining([expect.stringMatching(/title/i)]))
    expect(String(ut.sets)).toContain('task_data')
    const form = nodeReference('form_submitted')!
    expect(form.example).toMatchObject({ type: 'form_submitted', config: { form_id: expect.any(String) } })
  })

  it('only the requested types; unknown types get suggestions; items return the create tool schema', () => {
    const r: any = buildReference({ types: ['update_data_table', 'user_tasks'], items: ['form'] }, { itemSchema: (t) => (t === 'forms_create' ? { description: 'Create a form', parameters: { type: 'object', properties: { fields: { type: 'array' } } } } : null) })
    expect(r.nodes.map((n: any) => n.type)).toEqual(['update_data_table'])
    expect(r.unknown_types[0]).toMatchObject({ type: 'user_tasks', did_you_mean: expect.arrayContaining(['user_task']) })
    expect(r.items.form).toMatchObject({ create_tool: 'forms_create', arguments: { properties: { fields: { type: 'array' } } } })
    expect(r.workflow_shape).toMatch(/edges/)
    expect(buildReference({}, { itemSchema: () => null })).toHaveProperty('error')
    expect(referenceKindOf('forms_update')).toBe('form')
    expect(referenceKindOf('data_tables_update_schema')).toBe('data_table')
    expect(referenceKindOf('workflows_list')).toBe('workflow')
  })

  it('the designer offers it; long help texts are shortened in the tool list and returned in full by the reference', async () => {
    const tools = designerTools({ server: { getHandler: () => undefined } as any, permissions: new Set(ALL_BUILD) })
    const ref = tools.find((t) => t.name === NODE_REFERENCE_TOOL)!
    expect(ref.mode).toBe('read')
    const formsCreate = tools.find((t) => t.name === 'forms_create')!
    const fieldsDesc = String((formsCreate.parameters as any).properties.fields.description)
    expect(fieldsDesc.length).toBeLessThanOrEqual(PARAM_DESCRIPTION_MAX + 80)
    expect(fieldsDesc).toContain(`${NODE_REFERENCE_TOOL} items ["form"]`)
    const out: any = (await ref.run({ items: ['form'], types: ['user_task'] }, { emit: () => {}, toolCallId: 't' })).result
    expect(String(out.items.form.arguments.properties.fields.description).length).toBeGreaterThan(2000)
    expect(out.nodes[0].type).toBe('user_task')
    // The tool list the model sees on every call stays small.
    const offered = tools.filter((t) => !t.group)
    expect(JSON.stringify(offered.map((t) => ({ n: t.name, d: t.description.slice(0, 1024), p: t.parameters }))).length).toBeLessThan(40_000)
  })

  it('the prompt steers to the reference and to build_plan, away from reading workflows to learn the format', () => {
    const text = assistantInstructions({ groups: ['designer'], canBuild: true })
    expect(text).toContain('workflow_node_reference')
    expect(text).toMatch(/Don't read existing workflows or forms to learn the format/)
    expect(text).toMatch(/then call build_plan ONCE/)
    expect(text).toContain('detail: true')
  })
})

/* ── Compact reads ── */

describe('compact reads', () => {
  const definition = {
    workflow_id: 'w1',
    definition: {
      name: 'Purchase request', trigger_type: 'form_submitted', trigger_config: {},
      nodes: [
        { id: 't', type: 'form_submitted', label: 'Submitted', position: { x: 10, y: 20 }, config: { form_id: 'f1', form_name: 'PR', fields: [{ key: 'amount' }, { key: 'reason' }], _ref_response_schema: { big: true } } },
        { id: 'a', type: 'user_task', label: 'Approve', position: { x: 10, y: 120 }, config: { task_title: 'Approve {{form.amount}}', outcomes: ['Approve', 'Reject'], task_description: 'd'.repeat(600) } },
      ],
      edges: [{ id: 'e1', source: 't', target: 'a' }, { id: 'e2', source: 'a', target: 'end', label: 'Approve' }],
    },
  }

  it('a workflow summary: steps with key config, edges as text; no positions, cached form fields or private keys', () => {
    const s = summarizeWorkflow(definition)
    const text = JSON.stringify(s)
    expect(s.steps).toHaveLength(2)
    expect(s.steps[1]).toMatchObject({ id: 'a', type: 'user_task', label: 'Approve', config: { outcomes: ['Approve', 'Reject'] } })
    expect(String(s.steps[1].config.task_description).length).toBeLessThan(130)
    expect(s.edges).toEqual(['t → a', 'a → end (Approve)'])
    expect(text).not.toContain('"position":')
    expect(text).not.toContain('_ref_response_schema')
    expect(s.steps[0].config).toEqual({ form_id: 'f1', form_name: 'PR' })
    expect(s.note).toMatch(/detail: true/)
    // node_ids: those steps' full config (still without noise).
    expect(summarizeWorkflow(definition, ['a']).steps[1].config.task_description).toHaveLength(600)
  })

  it('detail: true returns the item unchanged; forms summarise fields; the catalog drops recipes', () => {
    expect(compactRead('workflows_get_definition', { detail: true }, definition)).toBe(definition)
    const form = summarizeForm({ form: { id: 'f', name: 'F', fields: [{ key: 'kind', label: 'Kind', type: 'choice', required: true, options: ['a', 'b'], help_text: 'h'.repeat(300) }], layout: { pages: [{ title: 'One' }] } } })
    expect(form.form.fields[0]).toEqual({ key: 'kind', label: 'Kind', type: 'choice', required: true, options: ['a', 'b'] })
    expect(form.form.sections).toEqual(['One'])
    const cat = compactCatalog({ trigger_types: [{ type: 'schedule', label: 'Schedule', description: 'On a schedule' }], node_types: [{ type: 'user_task', label: 'User Task', category: 'action', description: 'A task' }], recipes: [{ big: 'x'.repeat(5000) }], guidance: { notes: ['n'] } })
    expect(JSON.stringify(cat)).not.toContain('recipes')
    expect(cat.node_types.action).toEqual(['user_task — User Task: A task'])
    expect(cat.note).toContain('workflow_node_reference')
  })

  it('the designer tool summarises by default, passes no wrapper arguments to the MCP tool, and returns the full item on detail', async () => {
    const handler = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(definition) }] }))
    const tools = designerTools({ server: { getHandler: () => handler } as any, permissions: new Set(ALL_BUILD) })
    const get = tools.find((t) => t.name === 'workflows_get_definition')!
    expect(Object.keys((get.parameters as any).properties)).toEqual(expect.arrayContaining(['detail', 'node_ids']))
    const summary: any = (await get.run({ workflow_id: 'w1' }, { emit: () => {}, toolCallId: 't' })).result
    expect(summary.summary).toBe(true)
    const full: any = (await get.run({ workflow_id: 'w1', detail: true, node_ids: ['a'] }, { emit: () => {}, toolCallId: 't' })).result
    expect(full.definition.nodes[0].position).toEqual({ x: 10, y: 20 })
    expect(handler).toHaveBeenLastCalledWith({ workflow_id: 'w1' })
  })
})

/* ── Deferred tool groups ── */

describe('deferred tool groups', () => {
  it('rarely needed tools stay out of the tool list until load_tools, earlier use or their builder area', async () => {
    const tools = designerTools({ server: { getHandler: () => vi.fn(async () => ({ content: [{ type: 'text', text: '{"rows":[]}' }] })) } as any, permissions: new Set(ALL_BUILD) })
    expect(toolGroupOf('data_rows_create')).toBe('rows')
    expect(tools.find((t) => t.name === 'data_rows_query')!.group).toBe('rows')
    expect(tools.find((t) => t.name === 'workflows_create')!.group).toBeUndefined()
    const { fetchImpl, bodies } = provider({ tool_calls: [call('l', LOAD_TOOLS, { groups: ['rows'] })] }, { content: 'ok' })
    await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'add sample rows' }], tools, onEvent: () => {}, fetchImpl })
    const names = (b: any) => b.tools.map((t: any) => t.function.name)
    expect(names(bodies[0])).not.toContain('data_rows_create')
    expect(names(bodies[0])).toContain(LOAD_TOOLS)
    expect(names(bodies[1])).toContain('data_rows_create')
    // Used earlier in the conversation: offered from the start.
    const used = provider({ content: 'ok' })
    await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: null, tool_calls: [call('q', 'data_rows_query', { table_id: 't' })] }, { role: 'tool', tool_call_id: 'q', name: 'data_rows_query', content: '{}' }, { role: 'assistant', content: 'done' }, { role: 'user', content: 'more' }], tools, onEvent: () => {}, fetchImpl: used.fetchImpl })
    expect(names(used.bodies[0])).toContain('data_rows_create')
    // The data builder open: rows tools from the start.
    const data = designerTools({ server: { getHandler: () => undefined } as any, permissions: new Set(ALL_BUILD), area: 'data' })
    expect(data.find((t) => t.name === 'data_rows_create')!.group).toBeUndefined()
  })
})

/* ── Token budget ── */

const ON_ROW = { tenant_id: 't1', provider: 'ollama', key_source: 'key', api_key: null, base_url: null, model: 'llama3.1', capabilities: { version: 2, enabled: true }, limits: {} }
function rowsDb(tables: Record<string, any[]>) {
  const from = (table: string) => {
    const filters: Array<(r: any) => boolean> = []
    let single = false
    const run = () => { const list = (tables[table] ?? []).filter((r) => filters.every((f) => f(r))); return { data: single ? list[0] ?? null : list, error: null, count: list.length } }
    const api: any = {
      select: () => api, eq: (c: string, v: any) => { filters.push((r) => r[c] === v); return api }, in: () => api, gte: () => api, is: () => api, order: () => api, limit: () => api, ilike: () => api, or: () => api,
      maybeSingle: () => { single = true; return Promise.resolve(run()) }, then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    }
    return api
  }
  return { from } as any
}
const ctx: ServiceContext = { tenantId: 't1', actorId: 'u1', permissions: new Set(['workflows.view', 'workflows.create', 'forms.view', 'forms.edit']), supabase: {} as any, authKind: 'session', source: 'ui' }

describe('token budget', () => {
  it('is unlimited by default; a set limit from Settings reaches the turn; old rows mean unlimited', async () => {
    for (const l of Object.values(CAPABILITY_LIMITS)) expect(l.maxTokens).toBe(0)
    expect(normalizeLimits({}).max_request_tokens).toBe(0)
    expect(normalizeLimits({ max_request_tokens: 250_000 }).max_request_tokens).toBe(250_000)
    expect(normalizeLimits({ max_request_tokens: 500 }).max_request_tokens).toBe(10_000)
    expect(normalizeLimits({ max_request_tokens: -3 }).max_request_tokens).toBe(0)
    const req = parseChatRequest({ messages: [{ role: 'user', content: 'hi' }] })
    const unlimited = await prepareAssistantTurn(ctx, req, { serviceDb: rowsDb({ assistant_settings: [ON_ROW] }), skipBurst: true })
    expect(unlimited.limits.maxTokens).toBe(0)
    const limited = await prepareAssistantTurn(ctx, req, { serviceDb: rowsDb({ assistant_settings: [{ ...ON_ROW, limits: { max_request_tokens: 300_000 } }] }), skipBurst: true })
    expect(limited.limits.maxTokens).toBe(300_000)
  })

  it('without a limit, a request runs however many tokens it uses', async () => {
    const heavy = { prompt_tokens: 500_000, completion_tokens: 10, total_tokens: 500_010 }
    const { fetchImpl, bodies } = provider({ tool_calls: [call('a', 'noop', {})], usage: heavy }, { tool_calls: [call('b', 'noop', {})], usage: heavy }, { content: 'done', usage: heavy })
    const noop: AssistantToolDef = { name: 'noop', description: 'n', parameters: { type: 'object', properties: {} }, mode: 'read', label: () => 'n', run: async () => ({ result: {} }) }
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'go' }], tools: [noop], onEvent: () => {}, fetchImpl, limits: { maxIterations: 10 } })
    expect(r.status).toBe('completed')
    expect(r.stopReason).toBeUndefined()
    expect(bodies).toHaveLength(3)
  })

  it('a set limit stops BEFORE the call that would pass it, resumably, with every call answered', async () => {
    const usage = { prompt_tokens: 40_000, completion_tokens: 100, total_tokens: 40_100 }
    const { fetchImpl, bodies } = provider({ tool_calls: [call('a', 'noop', {})], usage }, { tool_calls: [call('b', 'noop', {})], usage }, { content: 'never', usage })
    const noop: AssistantToolDef = { name: 'noop', description: 'n', parameters: { type: 'object', properties: {} }, mode: 'read', label: () => 'n', run: async () => ({ result: {} }) }
    const events: any[] = []
    const r = await runAssistantTurn({ connection: conn, instructions: 'X', context: null, history: [{ role: 'user', content: 'go' }], tools: [noop], onEvent: (e) => events.push(e), fetchImpl, limits: { maxIterations: 10, maxTokens: 100_000 } })
    expect(bodies).toHaveLength(2)
    expect(r.status).toBe('completed')
    expect(r.stopReason).toBe('budget')
    const last = r.newMessages[r.newMessages.length - 1]
    expect(last).toEqual({ role: 'assistant', content: resumableStopText('budget', 100_000) })
    expect(last.content).toMatch(/continue/)
    // Every call has its reply: the next request can carry on.
    const ids = r.newMessages.flatMap((m) => (m.tool_calls ?? []).map((c) => c.id))
    expect(r.newMessages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id)).toEqual(ids)
    expect(events.some((e) => e.type === 'delta' && /continue/.test(e.text))).toBe(true)
  })

  it('cache reads count a tenth against the budget', () => {
    expect(budgetTokens({ prompt_tokens: 100_000, completion_tokens: 1000, total_tokens: 101_000, cached_tokens: 90_000 })).toBe(20_000)
    expect(budgetTokens({ prompt_tokens: 100, completion_tokens: 0, total_tokens: 100 })).toBe(100)
  })
})

/* ── Prices ── */

describe('prices for current models', () => {
  it('Claude 5.x, GPT-5.x and Grok have list prices (cache reads; Claude cache writes)', () => {
    for (const model of ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-4-8']) {
      expect(resolvePrice({ workspace: [], instance: [] }, 'anthropic', model), model).not.toBeNull()
    }
    expect(resolvePrice({}, 'anthropic', 'claude-sonnet-5-5')).toMatchObject({ input_per_1m: 2, output_per_1m: 10, cached_input_per_1m: 0.1, cache_write_per_1m: 2.5 })
    expect(resolvePrice({}, 'anthropic', 'claude-fable-5-1')).toMatchObject({ input_per_1m: 10, output_per_1m: 50, cached_input_per_1m: 0.25 })
    expect(resolvePrice({}, 'anthropic', 'claude-haiku-5-5')).toMatchObject({ input_per_1m: 0.1, output_per_1m: 0.5, cached_input_per_1m: 0.01 })
    expect(resolvePrice({}, 'openai', 'gpt-5.5')).toMatchObject({ input_per_1m: 5, output_per_1m: 30 })
    expect(resolvePrice({}, 'xai', 'grok-4.7')).toMatchObject({ input_per_1m: 2, output_per_1m: 6 })
    expect(DEFAULT_MODEL_PRICES.filter((p) => p.provider === 'anthropic').every((p) => p.cache_write_per_1m === p.input_per_1m * 1.25)).toBe(true)
  })

  it('cost: cache reads and writes at their own prices; the price list keeps cache_write_per_1m', () => {
    const price = resolvePrice({}, 'anthropic', 'claude-sonnet-5-5')!
    // 1M prompt = 0.6M read + 0.3M written + 0.1M plain; 0.1M output.
    expect(costOf({ prompt_tokens: 1_000_000, completion_tokens: 100_000, cached_tokens: 600_000, cache_write_tokens: 300_000 }, price)).toBeCloseTo(0.06 + 0.75 + 0.2 + 1, 6)
    expect(normalizePriceList([{ provider: 'anthropic', model: 'm', input_per_1m: 1, output_per_1m: 2, cache_write_per_1m: 1.25 }]).prices[0].cache_write_per_1m).toBe(1.25)
  })

  it('usage: Anthropic cache reads / writes are recorded (native shape and the mapped shape)', () => {
    const total: AgentUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
    addUsage(total, { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 10 })
    expect(total).toMatchObject({ prompt_tokens: 1050, completion_tokens: 10, total_tokens: 1060, cached_tokens: 900, cache_write_tokens: 50 })
    addUsage(total, fromMessagesResponse({ type: 'message', content: [], usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } }).usage)
    expect(total).toMatchObject({ prompt_tokens: 1150, cached_tokens: 990 })
  })
})

/* ── Native Anthropic Messages API ── */

describe('Anthropic Messages adapter', () => {
  it('is used for provider anthropic on api.anthropic.com only, unless turned off', () => {
    expect(useAnthropicNative('anthropic', claude.url, {})).toBe(true)
    expect(useAnthropicNative('anthropic', claude.url, { AGENT_ANTHROPIC_NATIVE: 'off' })).toBe(false)
    expect(useAnthropicNative('anthropic', 'https://gateway.example.com/v1/chat/completions', {})).toBe(false)
    expect(useAnthropicNative('openai', 'https://api.anthropic.com/v1/chat/completions', {})).toBe(false)
    expect(messagesUrl(claude.url)).toBe('https://api.anthropic.com/v1/messages')
    const h = messagesHeaders(claude.headers)
    expect(h).toMatchObject({ 'x-api-key': 'sk-ant-test-key', 'anthropic-version': ANTHROPIC_VERSION, 'Content-Type': 'application/json' })
    expect(h).not.toHaveProperty('Authorization')
    expect(messagesHeaders({ Authorization: 'Bearer k', 'anthropic-version': '2026-10-21' })['anthropic-version']).toBe('2026-10-21')
  })

  it('maps the request: system hoisted and cached, tools as input_schema, tool calls / results as blocks, images, the last block cached', () => {
    const body = toMessagesBody({
      model: 'claude-sonnet-5-5', max_completion_tokens: 16384, temperature: 0.2,
      tools: [{ type: 'function', function: { name: 'forms_get', description: 'Get a form', parameters: { type: 'object', properties: { form_id: { type: 'string' } } } } }],
      messages: [
        { role: 'system', content: 'You are the Agent.' },
        { role: 'user', content: [{ type: 'text', text: 'Look at this' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] },
        { role: 'assistant', content: 'Reading both.', tool_calls: [call('t1', 'forms_get', { form_id: 'a' }), call('t2', 'forms_get', { form_id: 'b' })] },
        { role: 'tool', tool_call_id: 't1', name: 'forms_get', content: '{"form":"a"}' },
        { role: 'tool', tool_call_id: 't2', name: 'forms_get', content: '{"form":"b"}' },
        { role: 'assistant', content: '' },
      ],
    }) as any
    expect(body.system).toEqual([{ type: 'text', text: 'You are the Agent.', cache_control: { type: 'ephemeral' } }])
    expect(body.tools).toEqual([{ name: 'forms_get', description: 'Get a form', input_schema: { type: 'object', properties: { form_id: { type: 'string' } } } }])
    expect(body.max_tokens).toBe(16384)
    expect(body.temperature).toBe(0.2)
    expect(body).not.toHaveProperty('max_completion_tokens')
    expect(body.messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } })
    expect(body.messages[1].content).toEqual([{ type: 'text', text: 'Reading both.' }, { type: 'tool_use', id: 't1', name: 'forms_get', input: { form_id: 'a' } }, { type: 'tool_use', id: 't2', name: 'forms_get', input: { form_id: 'b' } }])
    // Both results in ONE user message; the conversation's last block carries the second breakpoint.
    expect(body.messages[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '{"form":"a"}' },
      { type: 'tool_result', tool_use_id: 't2', content: '{"form":"b"}', cache_control: { type: 'ephemeral' } },
    ])
    expect(JSON.stringify(body).match(/cache_control/g)).toHaveLength(2)
  })

  it('maps a non-streamed response (text, tool_use, stop reason, cache usage)', () => {
    const json = fromMessagesResponse({ type: 'message', model: 'claude-sonnet-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'tu1', name: 'forms_get', input: { form_id: 'a' } }], stop_reason: 'tool_use', usage: { input_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 30, output_tokens: 7 } })
    expect(json.choices[0]).toEqual({ message: { role: 'assistant', content: 'On it.', tool_calls: [{ id: 'tu1', type: 'function', function: { name: 'forms_get', arguments: '{"form_id":"a"}' } }] }, finish_reason: 'tool_calls' })
    expect(json.usage).toEqual({ prompt_tokens: 1050, completion_tokens: 7, total_tokens: 1057, prompt_tokens_details: { cached_tokens: 1000, cache_write_tokens: 30 } })
    expect(fromMessagesResponse({ type: 'message', content: [{ type: 'text', text: 'x' }], stop_reason: 'max_tokens' }).choices[0].finish_reason).toBe('length')
  })

  it('the turn goes to /v1/messages, streams Messages events and records cached tokens', async () => {
    const sse = [
      { type: 'message_start', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 12, cache_read_input_tokens: 4000, cache_creation_input_tokens: 100, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } },
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
      { type: 'message_stop' },
    ].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('')
    const requests: Array<{ url: string; headers: any; body: any }> = []
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      requests.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) })
      return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    }) as unknown as typeof fetch
    const events: any[] = []
    const r = await runAssistantTurn({ connection: claude, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: (e) => events.push(e), fetchImpl })
    expect(r.status).toBe('completed')
    expect(requests[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(requests[0].headers['x-api-key']).toBe('sk-ant-test-key')
    expect(requests[0].body.stream).toBe(true)
    expect(requests[0].body).not.toHaveProperty('stream_options')
    expect(requests[0].body).not.toHaveProperty('temperature') // Sonnet 5.5 takes no sampling parameters
    expect(events.filter((e) => e.type === 'delta').map((e) => e.text).join('')).toBe('Hello')
    expect(r.usage).toMatchObject({ prompt_tokens: 4112, completion_tokens: 9, cached_tokens: 4000, cache_write_tokens: 100 })
  })

  it('falls back to the compatibility endpoint for the turn when a native request is rejected', async () => {
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: any) => {
      urls.push(String(url))
      if (String(url).endsWith('/messages')) return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}', { status: 400, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await runAssistantTurn({ connection: claude, instructions: 'X', context: null, history: [{ role: 'user', content: 'hi' }], tools: [], onEvent: () => {}, fetchImpl })
    warn.mockRestore()
    expect(r.status).toBe('completed')
    expect(urls).toEqual(['https://api.anthropic.com/v1/messages', 'https://api.anthropic.com/v1/chat/completions'])
  })

  it('a tool loop over the native API keeps tool_use / tool_result pairing across calls', async () => {
    const replies = [
      { content: [{ type: 'tool_use', id: 'tu1', name: 'noop', input: {} }], stop_reason: 'tool_use' },
      { content: [{ type: 'text', text: 'done' }], stop_reason: 'end_turn' },
    ]
    const bodies: any[] = []
    const fetchImpl = vi.fn(async (_url: any, init: any) => {
      bodies.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ type: 'message', ...replies[bodies.length - 1], usage: { input_tokens: 5, output_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    }) as unknown as typeof fetch
    const noop: AssistantToolDef = { name: 'noop', description: 'n', parameters: { type: 'object', properties: {} }, mode: 'read', label: () => 'n', run: async () => ({ result: { fine: true } }) }
    const r = await runAssistantTurn({ connection: claude, instructions: 'X', context: null, history: [{ role: 'user', content: 'go' }], tools: [noop], onEvent: () => {}, fetchImpl })
    expect(r.status).toBe('completed')
    expect(bodies[1].messages.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(bodies[1].messages[1].content[0]).toMatchObject({ type: 'tool_use', id: 'tu1', name: 'noop' })
    expect(bodies[1].messages[2].content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu1' })
    expect(bodies[1].tools[0]).toMatchObject({ name: 'noop', input_schema: { type: 'object' } })
  })
})
