import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/workflow-engine', async () => {
  const { RunNotResumableError } = await import('@/lib/workflow-run-errors')
  return { resumeWorkflow: vi.fn(async () => ({ status: 'completed', node_results: {} })), executeWorkflow: vi.fn(), RunNotResumableError }
})
vi.mock('@/lib/services/context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/context')>()
  return { ...actual, fromSession: vi.fn() }
})
vi.mock('@/lib/cron-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cron-auth')>()
  return { ...actual, createServiceClient: vi.fn() }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit-log'
import { resumeWorkflow } from '@/lib/workflow-engine'
import { RunNotResumableError } from '@/lib/workflow-run-errors'
import { fromSession, ServiceError, type ServiceContext } from '@/lib/services/context'
import { createServiceClient } from '@/lib/cron-auth'
import { actOnWorkflowRun, CANCELLED_RUN_ERROR } from '@/lib/services/workflow-runs'
import { createMcpServer } from '@/lib/mcp/server'
import { POST as v1ActionRoute } from '@/app/api/v1/workflows/runs/[id]/action/route'
import { POST as manageRoute } from '@/app/api/workflows/manage/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const NODES = [{ id: 'start' }, { id: 'approve' }, { id: 'review' }]

function seed() {
  return createMemorySupabase({
    workflows: [
      { id: 'wf-a', tenant_id: 'tenant-a', name: 'Approve', nodes: [{ id: 'draft-only' }] },
      { id: 'wf-b', tenant_id: 'tenant-b', name: 'Foreign', nodes: [] },
    ],
    workflow_versions: [{ id: 'v1', workflow_id: 'wf-a', tenant_id: 'tenant-a', nodes: NODES }],
    workflow_runs: [
      { id: 'run-wait', tenant_id: 'tenant-a', workflow_id: 'wf-a', version_id: 'v1', status: 'waiting_for_event', event_id: 'ev-1', paused_node_id: 'approve', pause_variables: { a: 1 } },
      { id: 'run-paused', tenant_id: 'tenant-a', workflow_id: 'wf-a', version_id: 'v1', status: 'paused', event_id: 'ev-2', paused_node_id: 'approve', pause_variables: { a: 2 } },
      { id: 'run-paused-bare', tenant_id: 'tenant-a', workflow_id: 'wf-a', version_id: 'v1', status: 'paused', event_id: null, paused_node_id: null },
      { id: 'run-done', tenant_id: 'tenant-a', workflow_id: 'wf-a', version_id: 'v1', status: 'completed', event_id: null, paused_node_id: null },
      { id: 'run-legacy', tenant_id: 'tenant-a', workflow_id: 'wf-a', version_id: null, status: 'waiting_for_event', event_id: 'ev-3', paused_node_id: 'draft-only' },
      { id: 'run-b', tenant_id: 'tenant-b', workflow_id: 'wf-b', version_id: null, status: 'waiting_for_event', event_id: 'ev-b', paused_node_id: 'x' },
    ],
    tasks: [
      { id: 'task-open', tenant_id: 'tenant-a', event_id: 'ev-1', status: 'todo' },
      { id: 'task-open-2', tenant_id: 'tenant-a', event_id: 'ev-1', status: 'in_progress' },
      { id: 'task-done', tenant_id: 'tenant-a', event_id: 'ev-1', status: 'completed' },
      { id: 'task-paused', tenant_id: 'tenant-a', event_id: 'ev-2', status: 'todo' },
      { id: 'task-foreign', tenant_id: 'tenant-b', event_id: 'ev-1', status: 'todo' },
    ],
  })
}
type Db = ReturnType<typeof seed>

const ALL = ['workflows.view', 'workflows.view_runs', 'workflows.activate']

function ctx(db: Db, permissions: string[] | null = ALL, extra: Partial<ServiceContext> = {}): ServiceContext {
  return {
    supabase: db as unknown as ServiceContext['supabase'], tenantId: 'tenant-a', actorId: 'user-1',
    permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api', ...extra,
  }
}
const row = (db: Db, table: string, id: string) => (db.tables[table] as any[]).find((r) => r.id === id)

beforeEach(() => {
  vi.mocked(resumeWorkflow).mockClear()
  vi.mocked(resumeWorkflow).mockResolvedValue({ status: 'completed', node_results: {} })
  vi.mocked(writeAudit).mockClear()
})

describe('workflow-runs service: permissions and lookup', () => {
  it('requires workflows.activate', async () => {
    await expect(actOnWorkflowRun(ctx(seed(), ['workflows.view']), { runId: 'run-wait' }, { action: 'pause' }))
      .rejects.toMatchObject({ code: 'forbidden', status: 403 })
  })

  it('only reaches runs of the caller’s tenant and allowed workflows', async () => {
    const db = seed()
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-b' }, { action: 'cancel' })).rejects.toMatchObject({ code: 'not_found' })
    expect(row(db, 'workflow_runs', 'run-b').status).toBe('waiting_for_event')
    await expect(actOnWorkflowRun(ctx(db, ALL, { resourceScopes: { workflow_ids: ['wf-other'], table_ids: [] } }), { runId: 'run-wait' }, { action: 'pause' }))
      .rejects.toMatchObject({ code: 'forbidden' })
    await expect(actOnWorkflowRun(ctx(db), {}, { action: 'resume' })).rejects.toMatchObject({ code: 'validation_error' })
  })
})

describe('workflow-runs service: actions', () => {
  it('pause keeps the wait state and refuses finished runs', async () => {
    const db = seed()
    expect(await actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'pause' }))
      .toEqual({ action: 'paused', run_id: 'run-wait', previous_status: 'waiting_for_event' })
    expect(row(db, 'workflow_runs', 'run-wait')).toMatchObject({ status: 'paused', event_id: 'ev-1', paused_node_id: 'approve', pause_variables: { a: 1 } })
    expect(row(db, 'workflow_runs', 'run-wait').paused_at).toBeTruthy()
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-done' }, { action: 'pause' })).rejects.toMatchObject({ status: 400, message: 'Cannot pause a finished workflow' })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'workflow_run', objectId: 'run-wait', metadata: expect.objectContaining({ action: 'pause' }) }))
  })

  it('resume of a run paused while waiting restores the wait (no engine call, tasks kept)', async () => {
    const db = seed()
    expect(await actOnWorkflowRun(ctx(db), { runId: 'run-paused' }, { action: 'resume' }))
      .toEqual({ action: 'unpaused', run_id: 'run-paused', status: 'waiting_for_event' })
    expect(row(db, 'workflow_runs', 'run-paused')).toMatchObject({ status: 'waiting_for_event', paused_at: null, event_id: 'ev-2' })
    expect(resumeWorkflow).not.toHaveBeenCalled()
    expect(row(db, 'tasks', 'task-paused').status).toBe('todo')
  })

  it('resume of a waiting run drives the engine and closes the orphaned open tasks', async () => {
    const db = seed()
    const result = await actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'resume', variables: { outcome: 'Approved', amount: 5 } })
    expect(result).toEqual({ action: 'resumed', run_id: 'run-wait', status: 'completed', closed_task_ids: ['task-open', 'task-open-2'] })
    expect(resumeWorkflow).toHaveBeenCalledWith('run-wait', { outcome: 'Approved', amount: 5, outcome_notes: 'Resumed via API' }, undefined, { eventId: 'ev-1' })
    expect(row(db, 'tasks', 'task-open').status).toBe('cancelled')
    expect(row(db, 'tasks', 'task-done').status).toBe('completed')
    expect(row(db, 'tasks', 'task-foreign').status).toBe('todo')
  })

  it('resume of a bare paused run forces it on with default variables', async () => {
    const db = seed()
    await actOnWorkflowRun(ctx(db, ALL, { source: 'ui' }), { runId: 'run-paused-bare' }, { action: 'resume' })
    expect(resumeWorkflow).toHaveBeenCalledWith('run-paused-bare', { outcome: 'resumed', outcome_notes: 'Manually resumed from queue' }, undefined, undefined)
  })

  it('resume refuses runs that are not waiting/paused and maps engine claim failures to 409', async () => {
    const db = seed()
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-done' }, { action: 'resume' })).rejects.toMatchObject({ status: 409 })
    vi.mocked(resumeWorkflow).mockRejectedValueOnce(new RunNotResumableError())
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'resume' })).rejects.toMatchObject({ status: 409 })
    expect(row(db, 'tasks', 'task-open').status).toBe('todo')
    vi.mocked(resumeWorkflow).mockRejectedValueOnce(new Error('boom'))
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'resume' })).rejects.toMatchObject({ status: 500, message: 'Resume failed: boom' })
  })

  it('goto validates the node against the run’s version and wins over unpause', async () => {
    const db = seed()
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'resume', gotoNodeId: 'draft-only' }))
      .rejects.toMatchObject({ status: 400 })
    expect(resumeWorkflow).not.toHaveBeenCalled()
    const result = await actOnWorkflowRun(ctx(db), { runId: 'run-paused' }, { action: 'resume', gotoNodeId: 'review' })
    expect(result).toMatchObject({ action: 'resumed', goto_node_id: 'review', closed_task_ids: ['task-paused'] })
    expect(resumeWorkflow).toHaveBeenCalledWith('run-paused', expect.objectContaining({ _goto_node_id: 'review' }), undefined, { eventId: 'ev-2' })
    // Pre-versioning runs use the draft definition.
    await actOnWorkflowRun(ctx(db), { runId: 'run-legacy' }, { action: 'resume', gotoNodeId: 'draft-only' })
    expect(resumeWorkflow).toHaveBeenLastCalledWith('run-legacy', expect.objectContaining({ _goto_node_id: 'draft-only' }), undefined, { eventId: 'ev-3' })
  })

  it('a caller-supplied _goto_node_id variable is not a back door', async () => {
    const db = seed()
    await actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'resume', variables: { _goto_node_id: 'nope' } })
    expect(vi.mocked(resumeWorkflow).mock.calls[0][1]).not.toHaveProperty('_goto_node_id')
  })

  it('cancel clears the pause state, closes open tasks and refuses finished runs', async () => {
    const db = seed()
    expect(await actOnWorkflowRun(ctx(db), { runId: 'run-wait' }, { action: 'cancel' }))
      .toEqual({ action: 'cancelled', run_id: 'run-wait', closed_task_ids: ['task-open', 'task-open-2'] })
    expect(row(db, 'workflow_runs', 'run-wait')).toMatchObject({
      status: 'failed', error: CANCELLED_RUN_ERROR, event_id: null, paused_node_id: null, paused_at: null, pause_variables: null,
    })
    expect(row(db, 'tasks', 'task-open-2').status).toBe('cancelled')
    await expect(actOnWorkflowRun(ctx(db), { runId: 'run-done' }, { action: 'cancel' })).rejects.toMatchObject({ status: 400 })
    expect(row(db, 'workflow_runs', 'run-done').status).toBe('completed')
  })
})

describe('workflow-runs surfaces', () => {
  const mockedValidate = vi.mocked(validateApiKey)
  function authAs(db: Db, permissions: string[]) {
    mockedValidate.mockResolvedValue({
      success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
      scopes: { workflow_ids: [], table_ids: [] }, permissions,
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    })
  }
  const v1 = (id: string, body: unknown) => v1ActionRoute(
    new NextRequest(`https://app.test/api/v1/workflows/runs/${id}/action`, { method: 'POST', headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    { params: Promise.resolve({ id }) },
  )

  it('v1 action route keeps its response shapes', async () => {
    const db = seed()
    authAs(db, ['workflows.view'])
    expect((await v1('run-wait', { action: 'pause' })).status).toBe(403)
    authAs(db, ALL)
    expect(await (await v1('run-wait', { action: 'pause' })).json()).toEqual({ success: true, data: { action: 'paused', run_id: 'run-wait', previous_status: 'waiting_for_event' } })
    expect((await (await v1('run-wait', { action: 'resume' })).json()).data).toMatchObject({ action: 'unpaused', status: 'waiting_for_event' })
    expect((await (await v1('run-wait', { action: 'resume', return_variables: { outcome: 'Approved' }, goto_node_id: 'review' })).json()).data)
      .toMatchObject({ action: 'resumed', status: 'completed' })
    expect((await (await v1('run-paused', { action: 'cancel' })).json()).data).toMatchObject({ action: 'cancelled' })
    const missing = await v1('run-b', { action: 'cancel' })
    expect(missing.status).toBe(404)
    expect(await missing.json()).toEqual({ success: false, error: 'Run not found' })
    expect((await v1('run-done', { action: 'pause' })).status).toBe(400)
  })

  it('MCP workflows_run_action: resume actually resumes, goto and cancel use the shared rules', async () => {
    const db = seed()
    const server = createMcpServer({ tenantId: 'tenant-a', supabase: db, actingUserId: null, keyType: 'tenant', permissions: ALL, scopes: { workflow_ids: [], table_ids: [] } } as any)
    const call = async (args: Record<string, unknown>) => {
      const res = await server.callTool('workflows_run_action', args)
      return { isError: Boolean((res as any).isError), body: (res as any).content[0].text as string }
    }
    const resumed = await call({ run_id: 'run-wait', action: 'resume', variables: { outcome: 'Approved' } })
    expect(JSON.parse(resumed.body)).toMatchObject({ action: 'resume', run_id: 'run-wait', success: true, result: 'resumed', status: 'completed', closed_task_ids: ['task-open', 'task-open-2'] })
    expect(resumeWorkflow).toHaveBeenCalledWith('run-wait', expect.objectContaining({ outcome: 'Approved', outcome_notes: 'Resumed via MCP' }), undefined, { eventId: 'ev-1' })

    await call({ run_id: 'run-paused', action: 'resume', goto_node_id: 'review' })
    expect(resumeWorkflow).toHaveBeenLastCalledWith('run-paused', expect.objectContaining({ _goto_node_id: 'review' }), undefined, { eventId: 'ev-2' })

    await call({ run_id: 'run-legacy', action: 'cancel' })
    expect(row(db, 'workflow_runs', 'run-legacy')).toMatchObject({ status: 'failed', error: CANCELLED_RUN_ERROR, event_id: null, paused_node_id: null })
    expect(await call({ run_id: 'run-b', action: 'pause' })).toMatchObject({ isError: true })

    const denied = createMcpServer({ tenantId: 'tenant-a', supabase: db, actingUserId: null, keyType: 'tenant', permissions: ['workflows.view'], scopes: { workflow_ids: [], table_ids: [] } } as any)
    expect((await denied.callTool('workflows_run_action', { run_id: 'run-paused-bare', action: 'resume' }) as any).isError).toBe(true)
    expect(row(db, 'workflow_runs', 'run-paused-bare').status).toBe('paused')
  })

  it('queue UI route requires workflows.activate and keeps { ok, action } responses', async () => {
    const db = seed()
    vi.mocked(createServiceClient).mockReturnValue(db as any)
    const session = (permissions: string[]) => vi.mocked(fromSession).mockResolvedValue({
      supabase: {} as any, tenantId: 'tenant-a', actorId: 'user-1', permissions: new Set(permissions), authKind: 'session', source: 'ui',
    })
    const manage = (body: unknown) => manageRoute(new NextRequest('https://app.test/api/workflows/manage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

    session(['workflows.view'])
    const denied = await manage({ action: 'cancel', run_id: 'run-wait' })
    expect(denied.status).toBe(403)
    expect(row(db, 'workflow_runs', 'run-wait').status).toBe('waiting_for_event')

    session(ALL)
    expect(await (await manage({ action: 'pause', run_id: 'run-wait' })).json()).toEqual({ ok: true, action: 'paused', run_id: 'run-wait', previous_status: 'waiting_for_event' })
    expect(await (await manage({ action: 'resume', event_id: 'ev-1' })).json()).toMatchObject({ ok: true, action: 'unpaused' })
    expect(await (await manage({ action: 'resume', run_id: 'run-wait', event_id: 'ev-1', goto_node_id: 'review' })).json()).toMatchObject({ ok: true, action: 'resumed', status: 'completed' })
    expect((await manage({ action: 'cancel' })).status).toBe(400)
    expect((await manage({ action: 'explode', run_id: 'run-wait' })).status).toBe(400)
    expect((await manage({ action: 'cancel', run_id: 'run-b' })).status).toBe(404)

    vi.mocked(fromSession).mockRejectedValue(new ServiceError('unauthorized', 'Not authenticated'))
    expect((await manage({ action: 'pause', run_id: 'run-wait' })).status).toBe(401)
  })
})
