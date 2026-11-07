import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Tool-call approval end to end, with a mocked provider and an in-memory
 * database: the run pauses → an Approve / Reject task for the reviewer →
 * completing the task (the shared task service) claims the run and queues a
 * resume job → the agent queue continues the run (the approved tool runs, or
 * the model is told it was rejected) → the Run Agent step's workflow resumes
 * with the agent's variables. Plus queued Run Agent mode, budgets and the
 * tenant checks of the run preparation.
 */

const hoisted = vi.hoisted(() => ({ db: null as any }))
vi.mock('@/lib/process-queue', () => ({ kickAgentQueueProcessor: vi.fn(), kickQueueProcessor: vi.fn() }))
vi.mock('@/lib/workflow-resume-queue', () => ({ enqueueResume: vi.fn(async () => ({ run_id: 'wf-run-1', workflow_id: 'wf-1', job_id: 'q', resumed: 'queued' })) }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn(() => hoisted.db), isAuthorizedServiceCall: vi.fn(() => false) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))

import { enqueueResume } from '@/lib/workflow-resume-queue'
import { loadAndRunAgent } from '@/lib/agents/run'
import { AgentRunError, loadAgentForRun, buildAgentRun } from '@/lib/agents/prepare'
import { processAgentQueueBatch } from '@/lib/jobs/agent-queue'
import { completeWorkflowTaskAction } from '@/lib/services/task-actions'
import { AGENT_WAIT_EVENT_PREFIX } from '@/lib/agents/approval'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

function withRpc(db: any) {
  db.rpc = async (name: string, args: any) => {
    if (name === 'claim_next_agent_job') {
      const { data: jobs } = await db.from('agent_queue').select('*').eq('status', 'pending')
      const job = (jobs ?? [])[0]
      if (!job) return { data: null, error: null }
      const { data } = await db.from('agent_queue').update({ status: 'processing', attempts: (job.attempts ?? 0) + 1, locked_by: args.p_worker_id }).eq('id', job.id).select('*').single()
      return { data, error: null }
    }
    if (name === 'complete_agent_job') {
      await db.from('agent_queue').update({ status: 'completed', result: args.p_result, run_id: args.p_run_id }).eq('id', args.p_job_id)
      return { data: null, error: null }
    }
    return { data: null, error: { message: `rpc ${name} not mocked` } }
  }
  return db
}

const LINK = (over: Record<string, unknown> = {}) => ({
  run_id: 'wf-run-1', workflow_id: 'wf-1', event_id: `${AGENT_WAIT_EVENT_PREFIX}abc`, node_id: 'n1', node_label: 'Triage',
  output_variable: 'triage', output_prefix: 'triager', share_context: false, agent_context: null, user_message: 'Process refund 42', ...over,
})

let llmReplies: any[]
let llmBodies: any[]
let hookCalls: any[]
function stubFetch() {
  llmBodies = []
  hookCalls = []
  vi.stubGlobal('fetch', vi.fn(async (url: any, init: any) => {
    const u = String(url)
    if (u.includes('/chat/completions')) {
      llmBodies.push(JSON.parse(init.body))
      const reply = llmReplies.shift() ?? { content: 'done' }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply.content ?? null, ...(reply.tool_calls ? { tool_calls: reply.tool_calls } : {}) } }], usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 } }), { status: 200 })
    }
    hookCalls.push({ url: u, body: init?.body })
    return new Response('{"refunded":true}', { status: 200 })
  }))
}

function seed(agentOver: Record<string, unknown> = {}) {
  hoisted.db = withRpc(createMemorySupabase({
    agents: [{
      id: 'ag1', tenant_id: 'ta', name: 'Refund agent', created_by: 'alice', integration_id: 'int1', model: 'gpt-4.1', is_active: true, version: 1,
      role: 'a refunds assistant', task: 'Process refunds', boundaries: '', system_prompt: '', temperature: 0, max_tokens: 500, max_iterations: 5,
      tools: [{ id: 't-post', type: 'builtin', name: 'http_post', description: 'post' }],
      output_config: { variables: [{ name: 'refund_id', type: 'string' }], approval: { tools: ['http_post'] }, egress: { allowed_hosts: ['93.184.216.34'] } },
      ...agentOver,
    }, { id: 'ag-b', tenant_id: 'tb', name: 'Other tenant agent', integration_id: 'int1', is_active: true, tools: [], output_config: {} }],
    integrations: [
      { id: 'int1', tenant_id: 'ta', type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com', auth_type: 'bearer', auth_config: { token: 'sk-a' } } },
      { id: 'int-b', tenant_id: 'tb', type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com', auth_config: { token: 'sk-b' } } },
    ],
    users: [{ id: 'alice', tenant_id: 'ta', current_tenant_id: 'ta', display_name: 'Alice', email: 'a@x.test' }, { id: 'bob', tenant_id: 'ta', current_tenant_id: 'ta', display_name: 'Bob', email: 'b@x.test' }],
    user_memberships: [{ tenant_id: 'ta', user_id: 'alice', is_active: true }, { tenant_id: 'ta', user_id: 'bob', is_active: true }],
    task_assignees: [], task_responses: [], user_teams: [],
  }, { uuids: true }))
  return hoisted.db
}

const postCall = { id: 'c1', type: 'function', function: { name: 'http_post', arguments: JSON.stringify({ url: 'https://93.184.216.34/refund', body: { order: 42 } }) } }
const svcCtx = (actorId: string) => ({ db: hoisted.db, supabase: hoisted.db, tenantId: 'ta', actorId, permissions: new Set(['tasks.complete']), authKind: 'api_key' as const, source: 'api' as const })

describe('approval flow', () => {
  beforeEach(() => { vi.clearAllMocks(); stubFetch() })

  it('pause → reviewer task → approve → queue resume runs the tool → workflow resumes with the outputs', async () => {
    const db = seed()
    llmReplies = [{ tool_calls: [postCall] }, { content: 'Refund sent.\n```json\n{"refund_id":"R-42"}\n```' }]
    const outcome = await loadAndRunAgent({ db, tenantId: 'ta', agentId: 'ag1', message: 'Process refund 42', actingUserId: 'bob', callerType: 'workflow_node', callerId: 'wf-run-1', workflow: LINK() })
    expect(outcome.result.status).toBe('awaiting_approval')
    expect(hookCalls).toHaveLength(0) // nothing sent before approval

    const { data: runs } = await db.from('agent_runs').select('*')
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ status: 'awaiting_approval', workflow_run_id: 'wf-run-1', caller_type: 'workflow_node' })
    expect(runs[0].approval_event_id).toMatch(/^agentappr_/)
    const { data: tasks } = await db.from('tasks').select('*')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ assignee_id: 'alice', is_workflow_task: true, available_outcomes: ['Approve', 'Reject'], event_id: runs[0].approval_event_id })
    expect(tasks[0].description).toContain('93.184.216.34/refund')

    // Bob is not the reviewer.
    await expect(completeWorkflowTaskAction(svcCtx('bob') as any, tasks[0].id, { outcome: 'Approve' }, { via: 'api' })).rejects.toThrow()
    const done = await completeWorkflowTaskAction(svcCtx('alice') as any, tasks[0].id, { outcome: 'Approve', notes: 'Fine' }, { via: 'api' })
    expect(done).toMatchObject({ status: 'completed', run_id: runs[0].id })
    // The workflow does NOT resume yet (the agent has not finished).
    expect(enqueueResume).not.toHaveBeenCalled()
    const { data: jobs } = await db.from('agent_queue').select('*')
    expect(jobs).toEqual([expect.objectContaining({ kind: 'resume', resume_run_id: runs[0].id, status: 'pending' })])

    const processed = await processAgentQueueBatch({ supabase: db })
    expect(processed.results[0]).toMatchObject({ status: 'completed', run_id: runs[0].id })
    expect(hookCalls).toHaveLength(1)
    expect(JSON.parse(hookCalls[0].body)).toEqual({ order: 42 })

    const { data: after } = await db.from('agent_runs').select('*').eq('id', runs[0].id).single()
    expect(after).toMatchObject({ status: 'completed', outputs: { refund_id: 'R-42' }, paused_context: null })
    expect(after.tool_calls[0]).toMatchObject({ toolName: 'http_post', status: 'ok', approval: { approved: true, by: 'alice', notes: 'Fine' } })
    expect(after.steps.map((s: any) => s.type)).toEqual(['llm', 'approval_requested', 'tool', 'llm'])

    expect(enqueueResume).toHaveBeenCalledTimes(1)
    const resume = vi.mocked(enqueueResume).mock.calls[0][0]
    expect(resume).toMatchObject({ tenantId: 'ta', eventId: LINK().event_id })
    expect(resume.variables).toMatchObject({ triage: expect.stringContaining('Refund sent'), refund_id: 'R-42', triager_refund_id: 'R-42', triage_status: 'completed', _agent_node_output: expect.objectContaining({ agent_run_id: runs[0].id }) })
  })

  it('reject → the model is told, the tool never runs', async () => {
    const db = seed()
    llmReplies = [{ tool_calls: [postCall] }, { content: 'Understood, not sent.\n```json\n{"refund_id":null}\n```' }]
    await loadAndRunAgent({ db, tenantId: 'ta', agentId: 'ag1', message: 'Process refund 42', actingUserId: 'bob', callerType: 'manual' })
    const { data: tasks } = await db.from('tasks').select('*')
    await completeWorkflowTaskAction(svcCtx('alice') as any, tasks[0].id, { outcome: 'Reject', notes: 'Wrong amount' }, { via: 'api' })
    await processAgentQueueBatch({ supabase: db })
    expect(hookCalls).toHaveLength(0)
    const { data: runs } = await db.from('agent_runs').select('*')
    expect(runs[0]).toMatchObject({ status: 'completed', output_response: expect.stringContaining('Understood, not sent.'), outputs: { refund_id: null } })
    const lastToolMsg = llmBodies.at(-1).messages.find((m: any) => m.role === 'tool')
    expect(lastToolMsg.content).toContain('Wrong amount')
    expect(enqueueResume).not.toHaveBeenCalled() // no workflow linked
  })

  it('a second completion of the same approval cannot resume twice', async () => {
    const db = seed()
    llmReplies = [{ tool_calls: [postCall] }]
    await loadAndRunAgent({ db, tenantId: 'ta', agentId: 'ag1', message: 'x', actingUserId: 'bob', callerType: 'manual' })
    const { handleAgentApprovalCompletion } = await import('@/lib/agents/approval')
    const { data: runs } = await db.from('agent_runs').select('*')
    await handleAgentApprovalCompletion({ db, tenantId: 'ta', eventId: runs[0].approval_event_id, outcome: 'Approve', notes: null, actionedBy: 'alice' })
    await expect(handleAgentApprovalCompletion({ db, tenantId: 'ta', eventId: runs[0].approval_event_id, outcome: 'Approve', notes: null, actionedBy: 'alice' })).rejects.toThrow(/No agent run is waiting/)
    await expect(handleAgentApprovalCompletion({ db, tenantId: 'tb', eventId: runs[0].approval_event_id, outcome: 'Approve', notes: null, actionedBy: 'alice' })).rejects.toThrow()
  })
})

describe('queued Run Agent mode and failures', () => {
  beforeEach(() => { vi.clearAllMocks(); stubFetch() })

  it('a queued job linked to a step resumes the workflow; a failing agent fails the step (once, no re-run)', async () => {
    const db = seed({ output_config: {}, tools: [] })
    await db.from('agent_queue').insert({ agent_id: 'ag1', tenant_id: 'ta', input_message: 'hello', status: 'pending', kind: 'run', options: { workflow: LINK(), acting_user_id: null } })
    llmReplies = [{ content: 'hi there' }]
    await processAgentQueueBatch({ supabase: db })
    expect(vi.mocked(enqueueResume).mock.calls[0][0].variables).toMatchObject({ triage: 'hi there', triage_status: 'completed' })

    vi.clearAllMocks()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })))
    await db.from('agent_queue').insert({ agent_id: 'ag1', tenant_id: 'ta', input_message: 'hello', status: 'pending', kind: 'run', options: { workflow: LINK({ event_id: 'agentwait_two' }) } })
    const out = await processAgentQueueBatch({ supabase: db })
    expect(out.results[0]).toMatchObject({ status: 'failed' })
    expect(vi.mocked(enqueueResume).mock.calls[0][0]).toMatchObject({ eventId: 'agentwait_two', variables: { _agent_node_error: expect.stringContaining('Agent execution failed') } })
    const again = await processAgentQueueBatch({ supabase: db })
    expect(again.processed).toBe(0) // the failed job is terminal
  })

  it('the queue never runs another tenant\'s agent for a job', async () => {
    const db = seed()
    await db.from('agent_queue').insert({ agent_id: 'ag-b', tenant_id: 'ta', input_message: 'steal', status: 'pending', kind: 'run', options: {} })
    const out = await processAgentQueueBatch({ supabase: db })
    expect(out.results[0]).toMatchObject({ status: 'failed', error: 'Agent not found' })
  })
})

describe('run preparation', () => {
  beforeEach(() => { vi.clearAllMocks(); stubFetch() })

  it('refuses an agent whose integration belongs to another workspace', async () => {
    const db = seed({ integration_id: 'int-b' })
    await expect(loadAgentForRun(db, 'ta', 'ag1')).rejects.toThrow(/not found in this workspace/)
  })

  it('keeps temperature 0, clamps iterations, defaults the model per provider, builds tools once', async () => {
    const db = seed({ temperature: 0, max_iterations: 999, model: '', tools: [{ id: 'x', type: 'builtin', name: 'calculate', description: 'c' }] })
    const prepared = await buildAgentRun({ db, tenantId: 'ta', loaded: await loadAgentForRun(db, 'ta', 'ag1'), actingUserId: null })
    expect(prepared.config.temperature).toBe(0)
    expect(prepared.config.maxIterations).toBe(50)
    expect(prepared.config.model).toBe('gpt-4.1')
    expect(prepared.config.tools.filter((t) => t.name === 'calculate')).toHaveLength(1)
    expect(prepared.config.endpoint?.url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('enforces the daily token budget', async () => {
    const db = seed({ output_config: { limits: { daily_token_budget: 100 } } })
    await db.from('agent_runs').insert({ tenant_id: 'ta', agent_id: 'ag1', total_tokens: 150, started_at: new Date().toISOString(), status: 'completed' })
    await expect(loadAndRunAgent({ db, tenantId: 'ta', agentId: 'ag1', message: 'x', actingUserId: null, callerType: 'api' })).rejects.toBeInstanceOf(AgentRunError)
  })
})
