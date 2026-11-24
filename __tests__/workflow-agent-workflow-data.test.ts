/**
 * Run Agent "Use this workflow's data as context", end to end against the
 * in-memory Supabase fake and a mocked model provider (no real LLM calls):
 * the real engine, runAgent, executeAgent, agent queue and resume queue run;
 * only the network and agent-run recording are faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
  kickAgentQueueProcessor: () => {},
}))
const recordAgentRun = vi.hoisted(() => vi.fn(async (_params: Record<string, any>) => crypto.randomUUID()))
vi.mock('@/lib/agent-run-service', () => ({ recordAgentRun }))

/** Every chat request the provider got. */
const requests = vi.hoisted(() => [] as Array<{ messages: Array<{ role: string; content: unknown }> }>)

function fakeProvider() {
  return async (input: unknown, init?: { body?: unknown }) => {
    if (!String(input).startsWith('https://api.openai.com/')) return new Response('not found', { status: 404 })
    const body = JSON.parse(String(init?.body ?? '{}'))
    requests.push(body)
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'Claim EXP-1042 is within policy.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

import { executeWorkflow } from '@/lib/workflow-engine'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { processAgentQueueBatch } from '@/lib/jobs/agent-queue'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000001a'
const WF = '0e000000-0000-4000-8000-0000000001c1'
const AGENT = 'reviewer'

type Node = { id: string; type: string; label: string; config: Record<string, unknown> }
const trigger: Node = { id: 'start', type: 'schedule', label: 'Start', config: {} }
const setLimit: Node = { id: 'limit', type: 'set_variable', label: 'Set policy limit', config: { name: 'policy_limit', expression: '500' } }
const reviewer = (config: Record<string, unknown> = {}): Node =>
  ({ id: 'review', type: 'run_agent', label: 'Review claim', config: { agent_id: AGENT, user_message: 'Review the claim against policy.', output_variable: 'review', ...config } })

function seed(agentConfig: Record<string, unknown>) {
  const nodes = [trigger, setLimit, reviewer(agentConfig)]
  const edges = [{ id: 'e1', source: 'start', target: 'limit' }, { id: 'e2', source: 'limit', target: 'review' }]
  const fake = createFakeSupabase({
    workflows: [{ id: WF, tenant_id: TENANT, name: 'Expense approval', trigger_type: 'schedule', nodes, edges, run_count: 0, published_version_id: null }],
  })
  fake.rpcs.enqueue_workflow = (args) => {
    const id = crypto.randomUUID()
    fake.tables.workflow_queue ??= []
    fake.tables.workflow_queue.push({
      id, workflow_id: args.p_workflow_id, tenant_id: args.p_tenant_id, task_id: args.p_task_id ?? null,
      trigger_type: args.p_trigger_type, trigger_data: args.p_trigger_data, status: 'pending', scheduled_for: Date.now(),
    })
    return { data: id }
  }
  fake.rpcs.claim_next_job = () => {
    const job = (fake.tables.workflow_queue ?? []).find((j) => j.status === 'pending')
    if (!job) return { data: null }
    job.status = 'running'
    return { data: { ...job } }
  }
  fake.rpcs.complete_job = (args) => { Object.assign(fake.tables.workflow_queue.find((j) => j.id === args.p_job_id) ?? {}, { status: 'completed' }); return {} }
  fake.rpcs.fail_job = (args) => { Object.assign(fake.tables.workflow_queue.find((j) => j.id === args.p_job_id) ?? {}, { status: 'failed', error: args.p_error }); return {} }
  fake.rpcs.record_workflow_run = () => ({})
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
  const INTEGRATION = '0e000000-0000-4000-8000-0000000001d1'
  fake.tables.integrations = [{ id: INTEGRATION, tenant_id: TENANT, type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com/v1', auth_config: { key_value: 'sk-test' } } }]
  fake.tables.agents = [{
    id: AGENT, tenant_id: TENANT, name: 'Claims reviewer', version: 1, is_active: true, integration_id: INTEGRATION, model: 'gpt-4.1',
    system_prompt: 'You review expense claims.', output_config: {}, max_iterations: 5, tools: [],
  }]
  return fake
}

/** Start data of the run (what a form or the API would pass). */
const START = {
  claim_id: 'EXP-1042', amount: 482.5, currency: 'USD', description: 'Client dinner, Seattle',
  api_key: 'must-not-leak', _resume_event_id: 'must-not-leak-either',
}

const run = (fake: FakeSupabase) => executeWorkflow(WF, undefined, false, START, undefined, undefined, undefined, { supabase: fake.client })
const runRow = (fake: FakeSupabase, runId?: string) => fake.tables.workflow_runs.find((r) => r.id === runId) as any
const userTurn = () => {
  const content = requests.at(-1)?.messages.find((m) => m.role === 'user')?.content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

beforeEach(() => {
  requests.length = 0
  recordAgentRun.mockClear()
  createClientMock.mockReset()
  createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
  vi.stubGlobal('fetch', vi.fn(fakeProvider()))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('Run Agent with "Use this workflow\'s data as context"', () => {
  it('puts the run\'s data before the prompt, records only its summary, and says so in the run', async () => {
    const fake = seed({ include_workflow_data: true })
    const result = await run(fake)
    expect(result.status).toBe('completed')

    const turn = userTurn()
    expect(turn.startsWith('## Workflow context')).toBe(true)
    expect(turn).toContain('inside the workflow "Expense approval" as the step "Review claim"')
    expect(turn).toContain(`(run ${result.run_id})`)
    const data = JSON.parse(/<workflow_data>\n([\s\S]*)\n<\/workflow_data>/.exec(turn)![1])
    expect(data.workflow).toMatchObject({ id: WF, name: 'Expense approval', run_id: result.run_id, step: 'Review claim' })
    expect(data.trigger).toEqual({ type: 'schedule', data: { claim_id: 'EXP-1042', amount: 482.5, currency: 'USD', description: 'Client dinner, Seattle' } })
    expect(data.variables.policy_limit).toBe('500')
    expect(data.steps).toEqual([expect.objectContaining({ step: 'Set policy limit', type: 'set_variable', status: 'completed' })])
    expect(turn.endsWith('## Your task\nReview the claim against policy.')).toBe(true)
    expect(turn).not.toContain('must-not-leak')

    // The stored input is the step's prompt; the run carries the summary only.
    expect(recordAgentRun).toHaveBeenCalledTimes(1)
    const recorded = recordAgentRun.mock.calls[0][0]
    expect(recorded.inputMessage).toBe('Review the claim against policy.')
    expect(recorded.context.workflow_data).toMatchObject({ scope: 'all', trigger_fields: 4, steps: 1, truncated: false })
    expect(JSON.stringify(recorded.context)).not.toContain('EXP-1042')

    const row = runRow(fake, result.run_id)
    expect(row.node_results.review.output.workflow_data).toMatchObject({ scope: 'all', trigger_fields: 4 })
    expect(row.node_results.review.output.workflow_data.bytes).toBeGreaterThan(0)
    const logs = (fake.tables.workflow_logs ?? []).map((l: any) => String(l.message))
    expect(logs.some((m: string) => /^Workflow data passed as context \(.+: trigger data \(4 fields\), \d+ variables?, 1 earlier step\)$/.test(m))).toBe(true)
  })

  it('a saved step without the property (and a step with it off) sends only its prompt', async () => {
    for (const config of [{}, { include_workflow_data: false }]) {
      requests.length = 0
      recordAgentRun.mockClear()
      const fake = seed(config)
      const result = await run(fake)
      expect(result.status).toBe('completed')
      expect(userTurn()).toBe('Review the claim against policy.')
      expect(recordAgentRun.mock.calls[0][0].context).toBeNull()
      expect(runRow(fake, result.run_id).node_results.review.output.workflow_data).toBeUndefined()
    }
  })

  it('"Only the fields I pick" passes just those', async () => {
    const fake = seed({ include_workflow_data: true, workflow_data_scope: 'fields', workflow_data_fields: 'claim_id, amount' })
    const result = await run(fake)
    expect(result.status).toBe('completed')
    const data = JSON.parse(/<workflow_data>\n([\s\S]*)\n<\/workflow_data>/.exec(userTurn())![1])
    expect(data.selected).toEqual({ claim_id: 'EXP-1042', amount: 482.5 })
    expect(data.variables).toBeUndefined()
    expect(userTurn()).not.toContain('Client dinner')
  })

  it('queued mode carries the block on the queue job and the summary back to the step', async () => {
    const fake = seed({ include_workflow_data: true, execution_mode: 'queued' })
    const result = await run(fake)
    expect(result.status).toBe('waiting_for_event')
    const job = fake.tables.agent_queue[0] as any
    expect(job.input_message).toBe('Review the claim against policy.')
    expect(job.options.workflow_data.text).toContain('EXP-1042')
    expect(job.options.workflow_data.text).not.toContain('must-not-leak')
    expect(job.options.workflow.workflow_data).toMatchObject({ scope: 'all', trigger_fields: 4 })

    createClientMock.mockImplementation(() => fake.client)
    await processAgentQueueBatch({ supabase: fake.client, batchSize: 1 })
    expect(userTurn()).toContain('<workflow_data>')
    expect(userTurn()).toContain('"claim_id":"EXP-1042"')
    expect(recordAgentRun.mock.calls[0][0].context.workflow_data).toMatchObject({ trigger_fields: 4 })

    for (let i = 0; i < 5 && (fake.tables.workflow_queue ?? []).some((j) => j.status === 'pending'); i++) {
      await processWorkflowQueueBatch({ batchSize: 5 })
    }
    const row = runRow(fake, result.run_id)
    expect(row.status).toBe('completed')
    expect(row.node_results.review.output.workflow_data).toMatchObject({ trigger_fields: 4 })
  })
})
