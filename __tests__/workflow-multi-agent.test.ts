/**
 * Multi-agent workflows: several Run Agent steps in one run, against the
 * in-memory Supabase fake and a scripted (mocked) model provider — no real
 * LLM calls. The real engine, runAgent, executeAgent, tool loop, agent queue
 * processor and resume queue run; only the network (the model provider)
 * and agent-run recording are faked.
 *
 * Covers: sequential handoff, agents in parallel branches (inline and
 * queued) overlapping in time, live shared facts between running agents,
 * the merged agent_context a join / Done step sees, failures, and the trace.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
  kickAgentQueueProcessor: () => {},
}))
vi.mock('@/lib/agent-run-service', () => ({
  recordAgentRun: vi.fn(async () => crypto.randomUUID()),
}))

type Step =
  | { delay?: number; tool: string; args?: Record<string, unknown> }
  | { delay?: number; final: (seen: unknown[]) => string }
interface Script { steps: Step[]; fail?: boolean }
const hoisted = vi.hoisted(() => ({
  scripts: {} as Record<string, Script>,
  spans: [] as Array<{ agent: string; start: number; end: number }>,
}))

/**
 * The scripted model: every agent's system prompt carries `AGENT:<id>`; each
 * chat request answers the agent's next scripted step (after its delay).
 * vitest note: the engine imports agent modules dynamically and concurrently
 * (one per branch), and concurrent dynamic imports of a vi.mock'ed module
 * resolve to the real module after the first — so agents are real rows in
 * the fake database and only the network (fetch) is faked.
 */
function fakeProvider() {
  const turns: Record<string, number> = {}
  return async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input)
    if (!url.startsWith('https://api.openai.com/')) return new Response('not found', { status: 404 })
    const body = JSON.parse(String(init?.body ?? '{}'))
    const system = String(body.messages?.[0]?.content ?? '')
    const agentId = /AGENT:([\w-]+)/.exec(system)?.[1] ?? '?'
    const script = hoisted.scripts[agentId]
    const turn = (turns[agentId] = (turns[agentId] ?? -1) + 1)
    let span = hoisted.spans.find((x) => x.agent === agentId)
    if (!span) { span = { agent: agentId, start: Date.now(), end: 0 }; hoisted.spans.push(span) }
    const step = script.steps[Math.min(turn, script.steps.length - 1)]
    if (step.delay) await new Promise((r) => setTimeout(r, step.delay))
    if (script.fail && turn >= script.steps.length - 1) {
      span.end = Date.now()
      return new Response('bad request', { status: 400 })
    }
    const seen = (body.messages as Array<{ role: string; content: string }>)
      .filter((m) => m.role === 'tool')
      .map((m) => { try { return JSON.parse(JSON.parse(m.content).result) } catch { return m.content } })
    const isTool = 'tool' in step
    const message = isTool
      ? { role: 'assistant', content: null, tool_calls: [{ id: `c${turn}`, type: 'function', function: { name: step.tool, arguments: JSON.stringify(step.args ?? {}) } }] }
      : { role: 'assistant', content: step.final(seen) }
    if (!isTool) span.end = Date.now()
    return new Response(JSON.stringify({
      choices: [{ message, finish_reason: isTool ? 'tool_calls' : 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

import { executeWorkflow } from '@/lib/workflow-engine'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { processAgentQueueBatch } from '@/lib/jobs/agent-queue'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'
import { BUILTIN_TOOL_DEFS } from '@/lib/agent-tool-defs'

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const WF = '0e000000-0000-4000-8000-0000000000c1'

type Node = { id: string; type: string; label: string; config: Record<string, unknown>; onError?: 'stop' | 'continue' }
type Edge = { id: string; source: string; target: string; label?: string }
const trigger: Node = { id: 'start', type: 'schedule', label: 'Start', config: {} }
const parallel = (id: string, branches: string[]): Node =>
  ({ id, type: 'parallel', label: `Parallel ${id}`, config: { mode: 'parallel', branches: branches.map((label, order) => ({ label, order })) } })
const agent = (id: string, agentId: string, extra: Record<string, unknown> = {}): Node =>
  ({ id, type: 'run_agent', label: `Agent ${id}`, config: { agent_id: agentId, user_message: `Task for ${id}`, output_variable: `${id}_response`, ...extra } })
const setVar = (id: string, name: string, expression: string): Node =>
  ({ id, type: 'set_variable', label: `Set ${id}`, config: { name, expression } })
let edgeSeq = 0
const e = (source: string, target: string, label?: string): Edge => ({ id: `e${++edgeSeq}`, source, target, ...(label ? { label } : {}) })

function seed(nodes: Node[], edges: Edge[]) {
  const fake = createFakeSupabase({
    workflows: [{ id: WF, tenant_id: TENANT, name: 'Multi-agent test', trigger_type: 'schedule', nodes, edges, run_count: 0, published_version_id: null }],
  })
  fake.rpcs.enqueue_workflow = (args) => {
    const id = crypto.randomUUID()
    fake.tables.workflow_queue ??= []
    fake.tables.workflow_queue.push({
      id, workflow_id: args.p_workflow_id, tenant_id: args.p_tenant_id, task_id: args.p_task_id ?? null,
      trigger_type: args.p_trigger_type, trigger_data: args.p_trigger_data, status: 'pending',
      scheduled_for: Date.now() + Number(args.p_delay_seconds ?? 0) * 1000,
    })
    return { data: id }
  }
  fake.rpcs.claim_next_job = () => {
    const job = (fake.tables.workflow_queue ?? []).find((j) => j.status === 'pending' && Number(j.scheduled_for) <= Date.now())
    if (!job) return { data: null }
    job.status = 'running'
    return { data: { ...job } }
  }
  fake.rpcs.complete_job = (args) => { Object.assign(fake.tables.workflow_queue.find((j) => j.id === args.p_job_id) ?? {}, { status: 'completed' }); return {} }
  fake.rpcs.fail_job = (args) => { Object.assign(fake.tables.workflow_queue.find((j) => j.id === args.p_job_id) ?? {}, { status: 'failed', error: args.p_error }); return {} }
  fake.rpcs.record_workflow_run = () => ({})
  // Agent queue: SKIP LOCKED claim (one job per call), completion.
  fake.rpcs.claim_next_agent_job = (args) => {
    const job = (fake.tables.agent_queue ?? []).find((j) => j.status === 'pending')
    if (!job) return { data: null }
    Object.assign(job, { status: 'processing', locked_by: args.p_worker_id, attempts: Number(job.attempts ?? 0) + 1 })
    return { data: { ...job } }
  }
  fake.rpcs.complete_agent_job = (args) => {
    Object.assign(fake.tables.agent_queue.find((j) => j.id === args.p_job_id) ?? {}, { status: 'completed', result: args.p_result })
    return {}
  }
  const INTEGRATION = '0e000000-0000-4000-8000-0000000000d1'
  fake.tables.integrations = [{ id: INTEGRATION, tenant_id: TENANT, type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com/v1', auth_config: { key_value: 'sk-test' } } }]
  fake.tables.agents = Object.entries(hoisted.scripts).map(([id, script]) => ({
    id, tenant_id: TENANT, name: id, version: 1, is_active: true, integration_id: INTEGRATION, model: 'gpt-4.1',
    system_prompt: `AGENT:${id}`, output_config: {}, max_iterations: 10,
    tools: BUILTIN_TOOL_DEFS.filter((t) => script.steps.some((st) => 'tool' in st && st.tool === t.name)),
  }))
  return fake
}

const run = async (fake: FakeSupabase, vars: Record<string, unknown> = {}) => {
  const out = await executeWorkflow(WF, undefined, false, vars, undefined, undefined, undefined, { supabase: fake.client })
  if (process.env.MA_DEBUG) console.info('[run]', out.status, (out as any).error ?? '', JSON.stringify(Object.fromEntries(Object.entries(out.node_results ?? {}).map(([k, v]: any) => [k, v.status + (v.error ? ':' + v.error : '')]))))
  return out
}

type StoredRun = {
  status: string
  error?: string
  node_results: Record<string, { status: string; output?: Record<string, any>; error?: string }>
  variables?: Record<string, any>
  execution_trace: Array<Record<string, unknown>>
}
const runRow = (fake: FakeSupabase, runId?: string) => fake.tables.workflow_runs.find((r) => r.id === runId) as unknown as StoredRun

const overlap = (a: string, b: string) => {
  const x = hoisted.spans.find((s) => s.agent === a)!
  const y = hoisted.spans.find((s) => s.agent === b)!
  return Math.min(x.end, y.end) - Math.max(x.start, y.start)
}
const timings = () => {
  const t0 = Math.min(...hoisted.spans.map((s) => s.start))
  return hoisted.spans.map((s) => `${s.agent}: ${s.start - t0}–${s.end - t0} ms`).join(', ')
}

/** Run the workflow queue until no resume is pending. */
async function drainResumes(fake: FakeSupabase) {
  for (let i = 0; i < 10 && (fake.tables.workflow_queue ?? []).some((j) => j.status === 'pending'); i++) {
    // A resume re-queued for later (its run was busy) is due now.
    for (const j of fake.tables.workflow_queue) if (j.status === 'pending') j.scheduled_for = Date.now()
    await processWorkflowQueueBatch({ batchSize: 5 })
  }
}

const say = (text: string): Step => ({ final: () => text })
/** A step that snapshots agent_context (stored run variables are trimmed for reports). */
const snap: Node = { id: 'snap', type: 'set_variable', label: 'Snapshot', config: { name: 'ctx_json', expression: '{{=TO_JSON(agent_context)}}' } }
const contextOf = (row: StoredRun) => {
  const v = row.node_results.snap?.output?.value
  if (process.env.MA_DEBUG) console.info('[snap]', typeof v, String(JSON.stringify(v)).slice(0, 300))
  return typeof v === 'string' ? JSON.parse(v) : v
}

beforeEach(() => {
  edgeSeq = 0
  hoisted.scripts = {}
  hoisted.spans = []
  createClientMock.mockReset()
  createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
  vi.stubGlobal('fetch', vi.fn(fakeProvider()))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('sequential handoff (baseline)', () => {
  it('the second agent sees the first agent\'s messages and facts; the context keeps both turns', async () => {
    hoisted.scripts.researcher = { steps: [{ tool: 'write_shared_fact', args: { key: 'topic', value: 'solar' } }, say('Researched solar')] }
    hoisted.scripts.writer = { steps: [{ tool: 'read_shared_facts' }, { final: (seen) => `Writing about ${JSON.stringify(seen.at(-1))}` }] }
    const nodes = [trigger, agent('r', 'researcher'), agent('w', 'writer'), snap]
    const fake = seed(nodes, [e('start', 'r'), e('r', 'w'), e('w', 'snap')])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.w.output?.response).toContain('solar')
    const ctx = contextOf(row)
    expect(ctx.facts.topic).toBe('solar')
    expect(ctx.messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.content)).toEqual(['Researched solar', expect.stringContaining('solar')])
  })
})

describe('parallel agents, inline', () => {
  const build = () => {
    const nodes = [
      trigger, parallel('p', ['A', 'B', 'C']),
      agent('a', 'alpha'), agent('b', 'beta'), agent('c', 'gamma'),
      setVar('join', 'summary', '{{a_response}}|{{b_response}}|{{c_response}}'), snap,
    ]
    const edges = [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B'), e('p', 'c', 'C'), e('a', 'join'), e('b', 'join'), e('c', 'join'), e('join', 'snap')]
    return seed(nodes, edges)
  }

  it('three agents in three branches run at the same time (overlapping in time)', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 150, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ delay: 150, final: () => 'beta done' }] }
    hoisted.scripts.gamma = { steps: [{ delay: 150, final: () => 'gamma done' }] }
    const fake = build()
    const started = Date.now()
    const result = await run(fake)
    const elapsed = Date.now() - started
    expect(result.status).toBe('completed')
    console.info(`[multi-agent] inline ×3: ${timings()}; run took ${elapsed} ms`)
    expect(overlap('alpha', 'beta')).toBeGreaterThan(100)
    expect(overlap('beta', 'gamma')).toBeGreaterThan(100)
    expect(elapsed).toBeLessThan(400) // sequential would be ≥ 450 ms
    expect(runRow(fake, result.run_id).node_results.join.output?.value).toBe('alpha done|beta done|gamma done')
  })

  it('a join after them sees every agent\'s messages in agent_context, tagged with agent and branch', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 60, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ delay: 20, final: () => 'beta done' }] }
    hoisted.scripts.gamma = { steps: [{ delay: 40, final: () => 'gamma done' }] }
    const fake = build()
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const ctx = contextOf(runRow(fake, result.run_id))
    const replies = ctx.messages.filter((m: any) => m.role === 'assistant')
    expect(replies.map((m: any) => m.content).sort()).toEqual(['alpha done', 'beta done', 'gamma done'])
    expect(replies.map((m: any) => m.branch).sort()).toEqual(['A', 'B', 'C'])
    expect(replies.find((m: any) => m.content === 'beta done')).toMatchObject({ agent: 'Agent b', node_id: 'b' })
    // Ordered by when they finished (beta 20 ms, gamma 40 ms, alpha 60 ms).
    expect(replies.map((m: any) => m.content)).toEqual(['beta done', 'gamma done', 'alpha done'])
  })

  it('agents see each other\'s facts while they are both running, and the join sees all facts', async () => {
    // alpha writes early; beta reads after alpha wrote, then writes; alpha reads after that.
    hoisted.scripts.alpha = { steps: [
      { tool: 'write_shared_fact', args: { key: 'from_alpha', value: 'A1' } },
      { delay: 120, tool: 'read_shared_facts' },
      { final: (seen) => `alpha saw ${JSON.stringify((seen.at(-1) as any)?.facts ?? {})}` },
    ] }
    hoisted.scripts.beta = { steps: [
      { delay: 40, tool: 'read_shared_facts' },
      { tool: 'write_shared_fact', args: { key: 'from_beta', value: 'B1' } },
      { final: (seen) => `beta saw ${JSON.stringify((seen[0] as any)?.facts ?? {})}` },
    ] }
    hoisted.scripts.gamma = { steps: [{ final: () => 'gamma done' }] }
    const fake = build()
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.b.output?.response).toContain('"from_alpha":"A1"')
    expect(row.node_results.a.output?.response).toContain('"from_beta":"B1"')
    const ctx = contextOf(row)
    expect(ctx.facts).toMatchObject({ from_alpha: 'A1', from_beta: 'B1' })
  })

  it('a Done step after the Parallel reads the merged agent_context', async () => {
    hoisted.scripts.alpha = { steps: [{ tool: 'write_shared_fact', args: { key: 'x', value: '1' } }, { delay: 30, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ tool: 'write_shared_fact', args: { key: 'y', value: '2' } }, { delay: 10, final: () => 'beta done' }] }
    const nodes = [trigger, parallel('p', ['A', 'B']), agent('a', 'alpha'), agent('b', 'beta'),
      setVar('done', 'n', '{{agent_context.messages.length}}:{{agent_context.facts.x}}{{agent_context.facts.y}}')]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B'), e('p', 'done', 'Done')])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(runRow(fake, result.run_id).node_results.done.output?.value).toBe('4:12')
  })

  it('a failed agent fails its branch (and the run); the other agent still finishes intact', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 10, final: () => '' }], fail: true }
    hoisted.scripts.beta = { steps: [{ tool: 'write_shared_fact', args: { key: 'ok', value: 'yes' } }, { delay: 60, final: () => 'beta done' }] }
    const nodes = [trigger, parallel('p', ['A', 'B']), agent('a', 'alpha'), agent('b', 'beta')]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B')])
    const result = await run(fake)
    expect(result.status).toBe('failed')
    const row = runRow(fake, result.run_id)
    expect(row.node_results.a.status).toBe('error')
    expect(row.node_results.b.status).toBe('success')
    expect(row.node_results.b.output?.response).toBe('beta done')
  })

  it('a failed agent with continue-on-error lets the run finish with the other agent\'s context', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 10, final: () => '' }], fail: true }
    hoisted.scripts.beta = { steps: [{ delay: 30, final: () => 'beta done' }] }
    const nodes = [trigger, parallel('p', ['A', 'B']), { ...agent('a', 'alpha'), onError: 'continue' as const }, agent('b', 'beta'),
      setVar('done', 'n', '{{agent_context.messages.length}}')]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B'), e('p', 'done', 'Done')])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(String(runRow(fake, result.run_id).node_results.done.output?.value)).toBe('2')
  })

  it('one agent waits for a fact another agent writes later (wait_for_shared_fact)', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 150, tool: 'write_shared_fact', args: { key: 'draft', value: 'v1' } }, say('alpha wrote the draft')] }
    hoisted.scripts.beta = { steps: [
      { tool: 'wait_for_shared_fact', args: { key: 'draft', timeout_seconds: 10 } },
      { final: (seen) => `beta reviewed ${JSON.stringify(seen.at(-1))}` },
    ] }
    const nodes = [trigger, parallel('p', ['A', 'B']), agent('a', 'alpha'), agent('b', 'beta')]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B')])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const response = String(runRow(fake, result.run_id).node_results.b.output?.response)
    expect(response).toContain('"found":true')
    expect(response).toContain('"value":"v1"')
    expect(response).toContain('"written_by":"Agent a"')
  })

  it('the run log says which agents run at the same time', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 40, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ delay: 40, final: () => 'beta done' }] }
    const nodes = [trigger, parallel('p', ['A', 'B']), agent('a', 'alpha'), agent('b', 'beta')]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B')])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const messages = (fake.tables.workflow_logs ?? []).map((l) => String(l.message))
    expect(messages.some((m) => /started on branch B — running at the same time as Agent a/.test(m))).toBe(true)
  })

  it('Sequential mode runs the agents one after another; each sees the previous agent\'s turn', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 40, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ delay: 40, final: () => 'beta done' }] }
    const nodes = [trigger, { ...parallel('p', ['A', 'B']), config: { mode: 'sequential', branches: [{ label: 'A', order: 0 }, { label: 'B', order: 1 }] } }, agent('a', 'alpha'), agent('b', 'beta'), snap]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B'), e('p', 'snap', 'Done')])
    const result = await run(fake)
    expect(result.status).toBe('completed')
    expect(overlap('alpha', 'beta')).toBeLessThanOrEqual(0)
    const ctx = contextOf(runRow(fake, result.run_id))
    expect(ctx.messages.filter((m: any) => m.role === 'assistant').map((m: any) => m.content)).toEqual(['alpha done', 'beta done'])
  })

  it('the trace shows the agents running concurrently (started_at / finished_at overlap)', async () => {
    hoisted.scripts.alpha = { steps: [{ delay: 80, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ delay: 80, final: () => 'beta done' }] }
    const nodes = [trigger, parallel('p', ['A', 'B']), agent('a', 'alpha'), agent('b', 'beta')]
    const fake = seed(nodes, [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B')])
    const result = await run(fake)
    const row = runRow(fake, result.run_id)
    const a = row.node_results.a.output!
    const b = row.node_results.b.output!
    expect(a.branch).toBe('A')
    expect(b.branch).toBe('B')
    const startA = Date.parse(a.started_at); const endA = Date.parse(a.finished_at)
    const startB = Date.parse(b.started_at); const endB = Date.parse(b.finished_at)
    expect(Math.min(endA, endB) - Math.max(startA, startB)).toBeGreaterThan(40)
  })
})

describe('parallel agents, queued', () => {
  const build = () => {
    const nodes = [
      trigger, parallel('p', ['A', 'B']),
      agent('a', 'alpha', { execution_mode: 'queued' }), agent('b', 'beta', { execution_mode: 'queued' }),
      setVar('join', 'summary', '{{a_response}}|{{b_response}}|{{agent_context.messages.length}}|{{agent_context.facts.from_alpha}}{{agent_context.facts.from_beta}}'),
    ]
    const edges = [e('start', 'p'), e('p', 'a', 'A'), e('p', 'b', 'B'), e('a', 'join'), e('b', 'join')]
    return seed(nodes, edges)
  }

  it('one worker batch runs both queued agents at the same time; both results are applied and merged', async () => {
    hoisted.scripts.alpha = { steps: [{ tool: 'write_shared_fact', args: { key: 'from_alpha', value: 'A1' } }, { delay: 150, final: () => 'alpha done' }] }
    hoisted.scripts.beta = { steps: [{ tool: 'write_shared_fact', args: { key: 'from_beta', value: 'B1' } }, { delay: 150, final: () => 'beta done' }] }
    const fake = build()
    const result = await run(fake)
    expect(result.status).toBe('waiting_for_event')
    expect(fake.tables.agent_queue).toHaveLength(2)
    createClientMock.mockImplementation(() => fake.client)

    const started = Date.now()
    const batch = await processAgentQueueBatch({ supabase: fake.client, batchSize: 5 })
    const elapsed = Date.now() - started
    console.info(`[multi-agent] queued ×2 (one batch): ${timings()}; batch took ${elapsed} ms`)
    expect(batch.processed).toBe(2)
    expect(overlap('alpha', 'beta')).toBeGreaterThan(100)

    await drainResumes(fake)
    const row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.join.output?.value).toBe('alpha done|beta done|4|A1B1')
  })

  it('queued agents see each other\'s facts while running (run blackboard)', async () => {
    hoisted.scripts.alpha = { steps: [
      { tool: 'write_shared_fact', args: { key: 'from_alpha', value: 'A1' } },
      { delay: 120, tool: 'read_shared_facts' },
      { final: (seen) => `alpha saw ${JSON.stringify((seen.at(-1) as any)?.facts ?? {})}` },
    ] }
    hoisted.scripts.beta = { steps: [
      { delay: 40, tool: 'read_shared_facts' },
      { tool: 'write_shared_fact', args: { key: 'from_beta', value: 'B1' } },
      { final: (seen) => `beta saw ${JSON.stringify((seen[0] as any)?.facts ?? {})}` },
    ] }
    const fake = build()
    const result = await run(fake)
    createClientMock.mockImplementation(() => fake.client)
    // Two workers (two kicks), each claiming one job.
    await Promise.all([
      processAgentQueueBatch({ supabase: fake.client, batchSize: 1 }),
      processAgentQueueBatch({ supabase: fake.client, batchSize: 1 }),
    ])
    expect(overlap('alpha', 'beta')).toBeGreaterThan(20)
    await drainResumes(fake)
    if (process.env.MA_DEBUG) console.info('[queued]', JSON.stringify(fake.tables.workflow_queue.map((j) => [j.trigger_type, j.status, j.error])), JSON.stringify(fake.tables.agent_queue.map((j) => [j.status, j.error])), JSON.stringify(runRow(fake, result.run_id)), )
    const row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.b.output?.response).toContain('"from_alpha":"A1"')
    expect(row.node_results.a.output?.response).toContain('"from_beta":"B1"')
  })
})
