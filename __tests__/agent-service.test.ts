import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({ db: null as any, background: [] as Promise<unknown>[] }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({ enqueueDeletionJob: vi.fn(async () => {}), kickDeletionProcessor: vi.fn() }))
vi.mock('@/lib/process-queue', () => ({ kickAgentQueueProcessor: vi.fn(), kickQueueProcessor: vi.fn() }))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { hoisted.background.push(Promise.resolve(fn())) } }))

import { enqueueDeletionJob } from '@/lib/deletion-queue'
import { createAgent, deleteAgent, enqueueAgentRun, listAgentVersions, restoreAgentVersion, saveEvalCase, startEvalRun, updateAgent, validateTools, getAgentRun } from '@/lib/services/agents'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const REF_A = '0a000000-0000-4000-8000-0000000000a1'
const REF_B = '0a000000-0000-4000-8000-0000000000b1'
const MCP_A = '0a000000-0000-4000-8000-0000000000a2'
const MCP_B = '0a000000-0000-4000-8000-0000000000b2'

function seed() {
  hoisted.db = createMemorySupabase({
    integrations: [{ id: 'int-a', tenant_id: 'ta', type: 'openai', is_active: true, config: { base_url: 'https://api.openai.com', auth_config: { token: 'sk' } } }, { id: 'int-b', tenant_id: 'tb', type: 'openai', config: {} }],
    integration_references: [
      { id: REF_A, tenant_id: 'ta', name: 'Create Refund', description: 'Refund an order', inputs: [{ name: 'order_id', type: 'string', required: true, description: 'Order' }, { name: 'amount', type: 'number' }] },
      { id: REF_B, tenant_id: 'tb', name: 'Other', inputs: [] },
    ],
    mcp_servers: [{ id: MCP_A, tenant_id: 'ta', name: 'Docs' }, { id: MCP_B, tenant_id: 'tb', name: 'Theirs' }],
    custom_tables: [{ id: '0a000000-0000-4000-8000-0000000000c1', tenant_id: 'ta', name: 'Orders' }, { id: '0a000000-0000-4000-8000-0000000000c2', tenant_id: 'tb', name: 'B' }],
    user_memberships: [{ tenant_id: 'ta', user_id: 'alice', is_active: true }],
  }, { uuids: true })
  return hoisted.db
}
const ctx = (perms: string[] = ['agents.view', 'agents.create', 'agents.edit', 'agents.delete', 'agents.test']) => ({
  db: hoisted.db, supabase: hoisted.db, tenantId: 'ta', actorId: 'alice', permissions: new Set(perms), authKind: 'api_key' as const, source: 'api' as const,
})

describe('agent tool validation', () => {
  beforeEach(() => { seed() })

  it('fills a reference tool\'s parameters from the reference inputs (they used to be empty)', async () => {
    const tools = await validateTools(hoisted.db, 'ta', [{ type: 'reference', referenceId: REF_A }])
    expect(tools[0]).toMatchObject({ type: 'reference', name: 'create_refund', description: 'Refund an order' })
    expect(tools[0].inputSchema).toEqual([{ name: 'order_id', type: 'string', description: 'Order', required: true }, { name: 'amount', type: 'number', description: 'amount' }])
    // Legacy MCP shape: a bare reference id.
    expect((await validateTools(hoisted.db, 'ta', [REF_A]))[0].referenceId).toBe(REF_A)
  })

  it('refuses another workspace\'s reference / MCP server, unknown builtins, duplicate names and bad types', async () => {
    await expect(validateTools(hoisted.db, 'ta', [{ type: 'reference', referenceId: REF_B }])).rejects.toThrow(/not a reference of this workspace/)
    await expect(validateTools(hoisted.db, 'ta', [{ type: 'mcp', mcpServerId: MCP_B, mcpToolName: 'x' }])).rejects.toThrow(/not an MCP server of this workspace/)
    await expect(validateTools(hoisted.db, 'ta', [{ type: 'builtin', name: 'rm_rf' }])).rejects.toThrow(/Unknown built-in/)
    await expect(validateTools(hoisted.db, 'ta', [{ type: 'builtin', name: 'calculate' }, { type: 'builtin', name: 'calculate' }])).rejects.toThrow(/must be unique/)
    await expect(validateTools(hoisted.db, 'ta', [{ type: 'workflow', name: 'x' }])).rejects.toThrow(/not supported/)
    expect((await validateTools(hoisted.db, 'ta', [{ type: 'mcp', mcpServerId: MCP_A, mcpToolName: 'Search Docs', requiresApproval: true }]))[0]).toMatchObject({ name: 'search_docs', requiresApproval: true })
  })
})

describe('agent saves', () => {
  beforeEach(() => { seed() })

  it('keeps only agent fields, checks the integration\'s workspace, clamps numbers', async () => {
    await expect(createAgent(ctx() as any, { name: 'A', integration_id: 'int-b' })).rejects.toThrow(/not an integration of this workspace/)
    const agent = await createAgent(ctx() as any, { name: 'Triage', integration_id: 'int-a', temperature: 0, tenant_id: 'tb', created_by: 'mallory' } as any)
    expect(agent).toMatchObject({ tenant_id: 'ta', created_by: 'alice', temperature: 0, version: 1 })
    await expect(updateAgent(ctx() as any, agent.id, { max_iterations: 500 })).rejects.toThrow(/max_iterations must be 1–50/)
    await expect(updateAgent(ctx() as any, agent.id, { temperature: 3 })).rejects.toThrow(/temperature/)
    await expect(createAgent(ctx(['agents.view']) as any, { name: 'x' })).rejects.toThrow(/agents.create/)
  })

  it('drops foreign table ids from scopes and checks the approval reviewer', async () => {
    const agent = await createAgent(ctx() as any, { name: 'Scoped' })
    const updated = await updateAgent(ctx() as any, agent.id, { output_config: { data_access: { mode: 'selected', table_ids: ['0a000000-0000-4000-8000-0000000000c1', '0a000000-0000-4000-8000-0000000000c2'] } } })
    expect(updated.output_config.data_access.table_ids).toEqual(['0a000000-0000-4000-8000-0000000000c1'])
    await expect(updateAgent(ctx() as any, agent.id, { output_config: { approval: { tools: ['*'], assignee_user_id: 'stranger' } } })).rejects.toThrow(/reviewer must be a member/)
  })

  it('every change is a version; restore saves an old snapshot as the newest version', async () => {
    const agent = await createAgent(ctx() as any, { name: 'V', role: 'first role' })
    await updateAgent(ctx() as any, agent.id, { role: 'second role' })
    const unchanged = await updateAgent(ctx() as any, agent.id, { role: 'second role' })
    expect(unchanged.version).toBe(2)
    const { current_version, versions } = await listAgentVersions(ctx() as any, agent.id)
    expect(current_version).toBe(2)
    expect(versions.map((v: any) => [v.version, v.snapshot.role])).toEqual([[2, 'second role'], [1, 'first role']])
    const restored = await restoreAgentVersion(ctx() as any, agent.id, 1)
    expect(restored).toMatchObject({ version: 3, role: 'first role' })
    await expect(restoreAgentVersion(ctx() as any, agent.id, 99)).rejects.toThrow(/Version 99 not found/)
  })

  it('deletes are queued on every surface', async () => {
    const agent = await createAgent(ctx() as any, { name: 'Gone' })
    await expect(deleteAgent(ctx() as any, agent.id)).resolves.toMatchObject({ deleted: true, queued: true })
    expect(enqueueDeletionJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ targetType: 'agent', targetId: agent.id }))
  })

  it('queued runs act as the caller (created_by and options.acting_user_id set by the server)', async () => {
    const agent = await createAgent(ctx() as any, { name: 'Q' })
    const queued = await enqueueAgentRun(ctx() as any, agent.id, { message: 'go' })
    const { data } = await hoisted.db.from('agent_queue').select('*').eq('id', queued.job_id).single()
    expect(data).toMatchObject({ created_by: 'alice', kind: 'run', options: { acting_user_id: 'alice' } })
  })

  it('a run read never returns the paused conversation, only the pending call', async () => {
    await hoisted.db.from('agent_runs').insert({ id: 'run-1', tenant_id: 'ta', agent_id: 'x', status: 'awaiting_approval', paused_context: { state: { messages: ['secret convo'] }, pending: { tool: 'http_post', arguments: { url: 'u' } }, approval_task_id: 'task-1' } })
    const { run } = await getAgentRun(ctx() as any, 'run-1')
    expect(run.paused_context).toBeUndefined()
    expect(run.pending_approval).toEqual({ tool: 'http_post', arguments: { url: 'u' }, task_id: 'task-1' })
  })
})

describe('evaluation suites', () => {
  beforeEach(() => { seed() })

  it('runs every case in eval mode (side effects simulated) and records per-check results', async () => {
    const agent = await createAgent(ctx() as any, {
      name: 'Classifier', integration_id: 'int-a', model: 'gpt-4.1',
      tools: [{ type: 'builtin', name: 'http_post' }],
      output_config: { variables: [{ name: 'category', type: 'string', enum: ['billing', 'tech'] }] },
    })
    await saveEvalCase(ctx() as any, agent.id, { name: 'Billing question', input_message: 'Why was I charged twice?', expected: { contains: ['refund'], outputs: { category: 'billing' }, tools_called: ['http_post'] } })
    await saveEvalCase(ctx() as any, agent.id, { name: 'Tech question', input_message: 'App crashes', expected: { outputs: { category: 'tech' } } })
    const posts: string[] = []
    let n = 0
    const fetchImpl = vi.fn(async (url: any, init: any) => {
      if (!String(url).includes('/chat/completions')) { posts.push(String(url)); return new Response('{}') }
      n++
      const body = JSON.parse(init.body)
      const user = body.messages.find((m: any) => m.role === 'user')?.content
      const reply = String(user).includes('charged')
        ? (n === 1 ? { tool_calls: [{ id: 'p', type: 'function', function: { name: 'http_post', arguments: '{"url":"https://93.184.216.34/x"}' } }] } : { content: 'We will refund you.\n```json\n{"category":"billing"}\n```' })
        : { content: 'Restart it.\n```json\n{"category":"billing"}\n```' }
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: (reply as any).content ?? null, ...((reply as any).tool_calls ? { tool_calls: (reply as any).tool_calls } : {}) } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }))
    })
    vi.stubGlobal('fetch', fetchImpl)
    const { run } = await startEvalRun(ctx() as any, agent.id)
    expect(run.status).toBe('running')
    await Promise.all(hoisted.background) // the suite runs after the response (next/server after())
    const { data: evalRun } = await hoisted.db.from('agent_eval_runs').select('*').eq('id', run.id).single()
    expect(evalRun).toMatchObject({ status: 'completed', total: 2, passed: 1, failed: 1 })
    const tech = evalRun.results.find((r: any) => r.name === 'Tech question')
    expect(tech.checks.find((c: any) => !c.passed)).toMatchObject({ check: 'output category = "tech"', detail: 'was "billing"' })
    const billing = evalRun.results.find((r: any) => r.name === 'Billing question')
    expect(billing.passed).toBe(true)
    expect(posts).toEqual([]) // the side-effecting tool was simulated
    const { data: runs } = await hoisted.db.from('agent_runs').select('caller_type, eval_run_id')
    expect(runs.every((r: any) => r.caller_type === 'eval' && r.eval_run_id === run.id)).toBe(true)
    vi.unstubAllGlobals()
  })
})
