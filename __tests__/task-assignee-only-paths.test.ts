/**
 * Assignee-only workflow tasks on every surface (lib/task-authz.ts +
 * lib/services/task-actions.ts):
 *   server actions (outcome buttons, form buttons, Save), POST /api/v1/tasks/{id}/action,
 *   PATCH /api/v1/tasks/{id} values, MCP task tools, agent action tools,
 *   events/complete + v1 workflows/events/complete (user-task events refused).
 * Matrix: assignee OK · other member 403 · manager on behalf OK (audited,
 * notified, recorded) · manager without on_behalf 403 · non-manager on
 * behalf 403 · other tenant 404 · completed 409.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'alice' } as { id: string } | null,
  perms: new Set<string>(['tasks.complete', 'tasks.view_own', 'agents.test', 'workflows.activate']),
  serviceCall: false,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/email', () => ({ sendEmail: vi.fn(async () => ({ success: true })) }))
vi.mock('@/lib/process-queue', () => ({ kickQueueProcessor: vi.fn() }))
vi.mock('@/lib/workflow-resume-queue', () => ({ enqueueResume: vi.fn(async () => ({ run_id: 'run-1', workflow_id: 'wf-1', job_id: 'job-1', resumed: 'queued' })) }))
vi.mock('@/lib/workflow-engine', () => ({ executeWorkflow: vi.fn(), resumeWorkflow: vi.fn(async () => ({ status: 'completed' })) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getCachedUser: vi.fn(async () => state.user),
  createClientWithUser: vi.fn(),
}))
vi.mock('@/lib/permissions-server', () => ({
  getUserPermissions: vi.fn(async () => state.perms),
  requirePermission: vi.fn(async (perm: string) => { if (!state.perms.has(perm)) throw new Error(`Forbidden: ${perm}`) }),
}))
vi.mock('@/lib/integrations/auth', () => ({ getCurrentTenantId: vi.fn(async () => 'ta') }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn(), isAuthorizedServiceCall: vi.fn(() => state.serviceCall) }))
vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})

import { NextRequest } from 'next/server'
import { createClient, createClientWithUser } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/cron-auth'
import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { sendEmail } from '@/lib/email'
import { enqueueResume } from '@/lib/workflow-resume-queue'
import { completeWorkflowTask, completeTaskWithFormButton, saveWorkflowTaskDraft } from '@/app/actions/task-queue'
import { saveTaskFieldValues } from '@/app/actions/tasks'
import { POST as taskAction } from '@/app/api/v1/tasks/[id]/action/route'
import { PATCH as patchTask } from '@/app/api/v1/tasks/[id]/route'
import { POST as actionTool } from '@/app/api/agents/action-tool/route'
import { POST as completeEvent } from '@/app/api/events/complete/route'
import { POST as completeEventV1 } from '@/app/api/v1/workflows/events/[id]/complete/route'
import { registerTaskTools } from '@/lib/mcp/tools/tasks'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows and loose results */

let admin: ReturnType<typeof createMemorySupabase>

function seed() {
  const base = { tenant_id: 'ta', is_workflow_task: true, status: 'todo', available_outcomes: ['approved', 'rejected'], metadata: { completion_rule: 'first_response' }, title: 'Approve invoice', assigner_id: 'carl', deleted_at: null }
  return createMemorySupabase({
    tasks: [
      { ...base, id: 't1', event_id: 'evt-1', assignee_id: 'alice' },
      { ...base, id: 't-done', event_id: 'evt-2', assignee_id: 'alice', status: 'completed' },
      { ...base, id: 't-b', tenant_id: 'tb', event_id: 'evt-3', assignee_id: 'alice' },
      { ...base, id: 't-form', event_id: 'evt-4', assignee_id: 'alice', metadata: { completion_rule: 'first_response', form_buttons: [{ id: 'b-ok', label: 'Approve', kind: 'outcome', outcome: 'approved' }, { id: 'b-draft', label: 'Save', kind: 'draft' }] } },
    ],
    users: [
      { id: 'alice', tenant_id: 'ta', display_name: 'Alice Report', email: 'alice@example.test', current_tenant_id: 'ta' },
      { id: 'mia', tenant_id: 'ta', display_name: 'Mia Manager', email: 'mia@example.test', current_tenant_id: 'ta' },
      { id: 'bob', tenant_id: 'ta', display_name: 'Bob Peer', email: 'bob@example.test', current_tenant_id: 'ta' },
      { id: 'carl', tenant_id: 'ta', display_name: 'Carl', email: 'carl@example.test', current_tenant_id: 'ta' },
    ],
    user_memberships: [
      { tenant_id: 'ta', user_id: 'alice', manager_user_id: 'mia', is_active: true },
      { tenant_id: 'ta', user_id: 'mia', manager_user_id: null, is_active: true },
      { tenant_id: 'ta', user_id: 'bob', manager_user_id: null, is_active: true },
      { tenant_id: 'ta', user_id: 'carl', manager_user_id: null, is_active: true },
      { tenant_id: 'tb', user_id: 'alice', manager_user_id: null, is_active: true },
    ],
    workflow_runs: [
      { id: 'run-1', tenant_id: 'ta', workflow_id: 'wf-1', status: 'waiting_for_event', event_id: 'evt-1' },
    ],
    task_assignees: [], user_teams: [], task_responses: [], lifecycle_events: [], notifications: [], object_audit_log: [],
  })
}

function sessionAs(userId: string) {
  state.user = { id: userId }
  const session: any = createMemorySupabase({})
  // The cookie client reads the same rows (RLS: the caller's tenants).
  const view: any = new Proxy(admin, {
    get(target: any, prop) {
      if (prop === 'rpc') {
        return async (name: string) => name === 'get_user_tenant_ids'
          ? { data: ['ta'], error: null }
          : { data: [...state.perms], error: null }
      }
      if (prop === 'from') return (table: string) => {
        const q = target.from(table)
        return table === 'tasks' ? q.eq('tenant_id', 'ta') : q
      }
      return target[prop]
    },
  })
  void session
  vi.mocked(createClient).mockImplementation(async () => view)
  vi.mocked(createClientWithUser).mockImplementation(async () => ({ supabase: view, user: { id: userId } } as any))
}

function apiAs(userId: string | null, permissions: string[] = ['tasks.complete', 'tasks.view_own', 'tasks.view_all']) {
  vi.mocked(validateApiKey).mockResolvedValue({
    success: true, tenantId: 'ta', keyId: 'key-1', keyType: userId ? 'user' : 'tenant', createdBy: 'carl', actingUserId: userId,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: admin as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  } as any)
}

const req = (path: string, body: unknown, method = 'POST') => new NextRequest(`https://app.test${path}`, {
  method, headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const params = (id: string) => ({ params: Promise.resolve({ id }) })
const task = (id: string) => (admin as any).from('tasks').select('*').eq('id', id).maybeSingle().then((r: any) => r.data)

function mcpTools(actingUserId: string | null, permissions?: string[]) {
  const tools = new Map<string, (args: any) => Promise<any>>()
  registerTaskTools({ tool: (name: string, _d: string, _s: unknown, handler: any) => { tools.set(name, handler) } } as any, { tenantId: 'ta', supabase: admin, actingUserId, permissions } as any)
  const parse = (text: string) => { try { return JSON.parse(text) } catch { return { error: text } } }
  return (name: string, args: any) => tools.get(name)!(args).then((r: any) => ({ isError: Boolean(r.isError), body: parse(r.content[0].text) }))
}

beforeEach(() => {
  vi.clearAllMocks()
  admin = seed()
  state.perms = new Set(['tasks.complete', 'tasks.view_own', 'agents.test', 'workflows.activate'])
  state.serviceCall = false
  vi.mocked(createServiceClient).mockImplementation(() => admin as any)
  sessionAs('alice')
})

describe('server actions (task screen)', () => {
  it('assignee completes; the run resumes; actioned_by is the assignee', async () => {
    const result = await completeWorkflowTask('t1', 'approved')
    expect(result).toMatchObject({ success: true, status: 'completed', outcome: 'approved', workflowResumed: true, onBehalfOf: null })
    expect(await task('t1')).toMatchObject({ status: 'completed', outcome: 'approved', actioned_by: 'alice', actioned_on_behalf_of: null })
    expect(enqueueResume).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'ta', eventId: 'evt-1' }))
  })

  it('another member is refused (403) and nothing changes', async () => {
    sessionAs('bob')
    const result = await completeWorkflowTask('t1', 'approved')
    expect(result).toMatchObject({ success: false, status: 'error', code: 'forbidden' })
    expect((await task('t1')).status).toBe('todo')
    expect(enqueueResume).not.toHaveBeenCalled()
  })

  it('a manager completes on behalf with a note: recorded, audited, assignee notified + emailed', async () => {
    sessionAs('mia')
    expect(await completeWorkflowTask('t1', 'approved')).toMatchObject({ success: false, code: 'forbidden' })
    expect(await completeWorkflowTask('t1', 'approved', undefined, undefined, { onBehalf: true })).toMatchObject({ success: false, code: 'validation_error' })
    const result = await completeWorkflowTask('t1', 'approved', 'ok', undefined, { onBehalf: true, onBehalfNote: 'Alice is on leave' })
    expect(result).toMatchObject({ success: true, status: 'completed', onBehalfOf: 'alice' })
    expect(await task('t1')).toMatchObject({ status: 'completed', actioned_by: 'mia', actioned_on_behalf_of: 'alice' })
    const tables = (admin as any)
    const { data: responses } = await tables.from('task_responses').select('*')
    expect(responses).toEqual([expect.objectContaining({ task_id: 't1', user_id: 'alice', actioned_by: 'mia' })])
    const { data: events } = await tables.from('lifecycle_events').select('*').eq('event_type', 'task_response')
    expect(events[0]).toMatchObject({ actor_id: 'mia', metadata: expect.objectContaining({ on_behalf_of: 'alice', on_behalf_note: 'Alice is on leave', acted_as: 'on_behalf', via: 'ui' }) })
    const { data: audit } = await tables.from('object_audit_log').select('*')
    expect(audit).toEqual([expect.objectContaining({ object_type: 'task', object_id: 't1', action: 'act_on_behalf', actor_id: 'mia' })])
    const { data: notes } = await tables.from('notifications').select('*').eq('user_id', 'alice')
    expect(notes).toEqual([expect.objectContaining({ type: 'task_actioned_on_behalf', task_id: 't1' })])
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.test' }))
    // The resume carries who acted for whom.
    expect(vi.mocked(enqueueResume).mock.calls[0][0].variables).toMatchObject({
      actioned_by: 'mia', actioned_by_name: 'Mia Manager', actioned_on_behalf_of: 'alice', actioned_on_behalf_of_name: 'Alice Report', on_behalf_note: 'Alice is on leave',
    })
  })

  it('a non-manager asking for on_behalf is still refused', async () => {
    sessionAs('bob')
    expect(await completeWorkflowTask('t1', 'approved', undefined, undefined, { onBehalf: true, onBehalfNote: 'trust me' })).toMatchObject({ success: false, code: 'forbidden' })
  })

  it('completed task → 409, another tenant → not found', async () => {
    expect(await completeWorkflowTask('t-done', 'approved')).toMatchObject({ success: false, code: 'conflict' })
    await expect(completeWorkflowTask('t-b', 'approved')).rejects.toThrow('Task not found')
  })

  it('form buttons and Save follow the same rule', async () => {
    sessionAs('bob')
    expect(await completeTaskWithFormButton('t-form', 'b-ok', {})).toMatchObject({ success: false })
    expect((await task('t-form')).status).toBe('todo')
    expect(await saveTaskFieldValues('t-form', {})).toMatchObject({ success: false })
    expect(await saveWorkflowTaskDraft('t-form', {})).toMatchObject({ success: false })

    sessionAs('mia')
    expect(await saveWorkflowTaskDraft('t-form', {}, { onBehalf: true })).toEqual({ success: true })
    sessionAs('alice')
    const pressed = await completeWorkflowTask('t-form', 'approved', undefined, {}, { buttonId: 'b-ok' })
    expect(pressed).toMatchObject({ success: true, status: 'completed' })
  })
})

describe('POST /api/v1/tasks/{id}/action', () => {
  const act = (id: string, body: unknown) => taskAction(req(`/api/v1/tasks/${id}/action`, body), params(id))

  it('user-bound key: assignee 200, other member 403, manager on behalf 200', async () => {
    apiAs('bob')
    expect((await act('t1', { action: 'complete', outcome: 'approved' })).status).toBe(403)
    apiAs('mia')
    expect((await act('t1', { action: 'complete', outcome: 'approved' })).status).toBe(403)
    expect((await act('t1', { action: 'complete', outcome: 'approved', on_behalf: true })).status).toBe(400)
    const res = await act('t1', { action: 'complete', outcome: 'approved', on_behalf: true, on_behalf_note: 'Covering' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ action: 'completed', acted_as: 'on_behalf', on_behalf_of: 'alice' })
    expect(await task('t1')).toMatchObject({ actioned_by: 'mia', actioned_on_behalf_of: 'alice' })
  })

  it('assignee 200; completed 409; other tenant 404', async () => {
    apiAs('alice')
    const res = await act('t1', { action: 'complete', outcome: 'approved' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ acted_as: 'assignee', workflow_resumed: true, run_id: 'run-1' })
    expect((await act('t1', { action: 'complete', outcome: 'approved' })).status).toBe(409)
    expect((await act('t-b', { action: 'complete', outcome: 'approved' })).status).toBe(404)
  })

  it('accept / hold / reject on a workflow task: same rule', async () => {
    apiAs('bob')
    expect((await act('t1', { action: 'reject', comment: 'no' })).status).toBe(403)
    apiAs('alice')
    expect((await act('t1', { action: 'accept' })).status).toBe(200)
    expect((await task('t1')).acceptance_status).toBe('accepted')
  })

  it('a workspace key (no user) needs tasks.complete_any', async () => {
    apiAs(null)
    expect((await act('t1', { action: 'complete', outcome: 'approved' })).status).toBe(403)
    apiAs(null, ['tasks.complete', 'tasks.complete_any'])
    const res = await act('t1', { action: 'complete', outcome: 'approved' })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ acted_as: 'credential' })
  })

  it('PATCH values on a workflow task: assignee or manager on behalf only', async () => {
    const patch = (body: unknown) => patchTask(req('/api/v1/tasks/t1', body, 'PATCH'), params('t1'))
    apiAs('bob')
    expect((await patch({ values: {} })).status).toBe(403)
    apiAs('mia')
    expect((await patch({ values: {} })).status).toBe(403)
    expect((await patch({ values: {}, on_behalf: true })).status).toBe(200)
    apiAs('alice')
    expect((await patch({ values: {} })).status).toBe(200)
  })
})

describe('MCP task tools', () => {
  it('tasks_complete_workflow: assignee OK, others refused, manager on behalf OK', async () => {
    expect((await mcpTools('bob', ['tasks.complete'])('tasks_complete_workflow', { task_id: 't1', outcome: 'approved' })).isError).toBe(true)
    expect((await mcpTools('mia', ['tasks.complete'])('tasks_complete_workflow', { task_id: 't1', outcome: 'approved' })).isError).toBe(true)
    const ok = await mcpTools('mia', ['tasks.complete'])('tasks_complete_workflow', { task_id: 't1', outcome: 'approved', on_behalf: true, on_behalf_note: 'Leave' })
    expect(ok).toMatchObject({ isError: false, body: { completed: true, acted_as: 'on_behalf', on_behalf_of: 'alice' } })
  })

  it('tasks_complete on a workflow task goes through the same service', async () => {
    expect((await mcpTools('bob', ['tasks.complete'])('tasks_complete', { task_id: 't1', outcome: 'approved' })).isError).toBe(true)
    expect((await task('t1')).status).toBe('todo')
    expect((await mcpTools('alice', ['tasks.complete'])('tasks_complete', { task_id: 't1', outcome: 'approved' })).body).toMatchObject({ completed: true, acted_as: 'assignee' })
  })

  it('tasks_respond and tasks_update cannot complete someone else\'s workflow task', async () => {
    expect((await mcpTools('bob', ['tasks.complete'])('tasks_respond', { task_id: 't1', response: 'rejected' })).isError).toBe(true)
    expect((await mcpTools('alice', ['tasks.manage_queue'])('tasks_update', { task_id: 't1', status: 'completed' })).isError).toBe(true)
    expect((await task('t1')).status).toBe('todo')
  })

  it('other tenant and closed tasks', async () => {
    expect((await mcpTools('alice', ['tasks.complete'])('tasks_complete_workflow', { task_id: 't-b', outcome: 'approved' })).body).toMatchObject({ error: expect.stringContaining('Task not found') })
    expect((await mcpTools('alice', ['tasks.complete'])('tasks_complete_workflow', { task_id: 't-done', outcome: 'approved' })).isError).toBe(true)
  })
})

describe('agent action tools (session)', () => {
  const tool = (body: unknown) => actionTool(req('/api/agents/action-tool', body))
  beforeEach(async () => {
    admin = seed()
    await (admin as any).from('agents').insert({ id: 'agent-1', tenant_id: 'ta', output_config: { task_access: true, task_scope: { mode: 'all' } } })
    vi.mocked(createServiceClient).mockImplementation(() => admin as any)
  })

  it('complete_workflow_task: the session user must be the assignee (or manager on behalf)', async () => {
    sessionAs('bob')
    expect((await tool({ action: 'complete_workflow_task', task_id: 't1', outcome: 'approved', agent_id: 'agent-1' })).status).toBe(403)
    sessionAs('mia')
    expect((await tool({ action: 'complete_workflow_task', task_id: 't1', outcome: 'approved', agent_id: 'agent-1' })).status).toBe(403)
    const res = await tool({ action: 'complete_workflow_task', task_id: 't1', outcome: 'approved', agent_id: 'agent-1', on_behalf: true, on_behalf_note: 'Leave' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ completed: true, acted_as: 'on_behalf' })
  })

  it('complete_server_event refuses a user task\'s event', async () => {
    sessionAs('alice')
    await (admin as any).from('agents').update({ output_config: { task_access: true, workflow_access: true, workflow_scope: { mode: 'all' } } }).eq('id', 'agent-1')
    const res = await tool({ action: 'complete_server_event', event_id: 'evt-1', agent_id: 'agent-1' })
    expect(res.status).toBe(409)
    expect(enqueueResume).not.toHaveBeenCalled()
  })
})

describe('resuming a user task\'s event directly is refused', () => {
  it('POST /api/events/complete (session) → 409', async () => {
    sessionAs('bob')
    const res = await completeEvent(req('/api/events/complete', { event_id: 'evt-1', outcome: 'approved' }))
    expect(res.status).toBe(409)
    expect(enqueueResume).not.toHaveBeenCalled()
  })

  it('POST /api/v1/workflows/events/{id}/complete → 409', async () => {
    apiAs(null, ['workflows.activate'])
    const res = await completeEventV1(req('/api/v1/workflows/events/evt-1/complete', { return_variables: { outcome: 'approved' } }), params('evt-1'))
    expect(res.status).toBe(409)
  })
})
