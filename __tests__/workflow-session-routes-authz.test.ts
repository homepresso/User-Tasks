/**
 * Session routes / actions next to the workflow runtime that act with a
 * service-role client: they must check the caller's permission (and tenant),
 * not just that someone is signed in.
 *  - POST /api/events/complete (session path): workflows.activate
 *  - POST /api/workflows/cleanup-test: workflows.edit or workflows.activate,
 *    runs of the caller's tenant only; a waiting run that is not the
 *    caller's own test run needs workflows.activate; `{ workflow_id }`
 *    cancels only the caller's own waiting test runs (and their tasks)
 *  - POST /api/agents/action-tool (session path): agents.test + the action's own permission
 *  - saveWorkflow: only the designer's fields reach the update
 *  - getWorkflowPackageBlock: scoped to the workflow's (RLS-visible) tenant
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: { id: 'user-1' } as { id: string } | null,
  perms: new Set<string>(),
  serviceCall: false,
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/data-table-workflow-triggers', () => ({ invalidateDataTableTriggerCache: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(), getCachedUser: vi.fn(async () => state.user) }))
vi.mock('@/lib/permissions-server', () => ({
  getUserPermissions: vi.fn(async () => state.perms),
  requirePermission: vi.fn(async (perm: string) => { if (!state.perms.has(perm)) throw new Error('Forbidden') }),
}))
vi.mock('@/lib/integrations/auth', () => ({ getCurrentTenantId: vi.fn(async () => 'tenant-a') }))
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: vi.fn(), isAuthorizedServiceCall: vi.fn(() => state.serviceCall) }))
vi.mock('@/lib/workflow-resume-queue', () => ({ enqueueResume: vi.fn(async () => ({ run_id: 'run-a', resumed: true })) }))
vi.mock('@/lib/workflow-engine', () => ({ executeWorkflow: vi.fn(async () => ({ status: 'completed', node_results: {} })) }))

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/cron-auth'
import { enqueueResume } from '@/lib/workflow-resume-queue'
import { executeWorkflow } from '@/lib/workflow-engine'
import { POST as completeEvent } from '@/app/api/events/complete/route'
import { POST as cleanupTest } from '@/app/api/workflows/cleanup-test/route'
import { POST as actionTool } from '@/app/api/agents/action-tool/route'
import { getWorkflowPackageBlock, saveWorkflow } from '@/app/actions/automations'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

let admin: ReturnType<typeof createMemorySupabase>
let session: ReturnType<typeof createMemorySupabase>

beforeEach(() => {
  vi.clearAllMocks()
  state.user = { id: 'user-1' }
  state.perms = new Set()
  state.serviceCall = false
  admin = createMemorySupabase({
    workflow_runs: [
      { id: 'run-a', tenant_id: 'tenant-a', workflow_id: 'wf-a', status: 'waiting_for_event', event_id: 'evt-a', pause_variables: { workflow_started_via: 'test', workflow_started_by: 'user-1' } },
      { id: 'run-b', tenant_id: 'tenant-b', workflow_id: 'wf-b', status: 'waiting_for_event', event_id: 'evt-b' },
    ],
    tasks: [{ id: 'task-a', tenant_id: 'tenant-a', event_id: 'evt-a', status: 'todo' }],
    workflow_logs: [{ id: 'log-a', run_id: 'run-a' }, { id: 'log-b', run_id: 'run-b' }],
    workflows: [
      { id: 'wf-a', tenant_id: 'tenant-a', name: 'A', is_active: true },
      { id: 'wf-b', tenant_id: 'tenant-b', name: 'B', is_active: true },
    ],
    agents: [{ id: 'agent-a', tenant_id: 'tenant-a', output_config: { workflow_access: true, workflow_scope: { mode: 'all' } } }],
    users: [{ id: 'user-1', tenant_id: 'tenant-a', current_tenant_id: 'tenant-a' }],
    package_install_assets: [],
  })
  // The caller's RLS view: their tenant only.
  session = createMemorySupabase({
    workflows: [{ id: 'wf-a', tenant_id: 'tenant-a', name: 'A', is_active: false, created_by: 'owner' }],
    users: [{ id: 'user-1', tenant_id: 'tenant-a', current_tenant_id: 'tenant-a' }],
    agents: [{ id: 'agent-a', tenant_id: 'tenant-a', output_config: { workflow_access: true, workflow_scope: { mode: 'all' } } }],
  })
  vi.mocked(createServiceClient).mockImplementation(() => admin as any)
  vi.mocked(createClient).mockImplementation(async () => session as any)
})

const post = (path: string, body: unknown) => new NextRequest(`http://localhost${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /api/events/complete (session)', () => {
  it('401 signed out', async () => {
    state.user = null
    expect((await completeEvent(post('/api/events/complete', { event_id: 'evt-a' }))).status).toBe(401)
  })

  it('403 without workflows.activate — a member cannot resume someone else\'s waiting task', async () => {
    state.perms = new Set(['tasks.complete'])
    expect((await completeEvent(post('/api/events/complete', { event_id: 'evt-a', outcome: 'approved' }))).status).toBe(403)
    expect(enqueueResume).not.toHaveBeenCalled()
  })

  it('resumes an event of the caller\'s tenant with workflows.activate; another tenant\'s is 404', async () => {
    state.perms = new Set(['workflows.activate'])
    expect((await completeEvent(post('/api/events/complete', { event_id: 'evt-b' }))).status).toBe(404)
    expect(enqueueResume).not.toHaveBeenCalled()
    expect((await completeEvent(post('/api/events/complete', { event_id: 'evt-a' }))).status).toBe(200)
    expect(enqueueResume).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/workflows/cleanup-test', () => {
  it('401 signed out', async () => {
    state.user = null
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-a' }))).status).toBe(401)
  })

  it('403 without workflows.edit / workflows.activate', async () => {
    state.perms = new Set(['workflows.view'])
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-a' }))).status).toBe(403)
    expect(admin.tables.workflow_runs).toHaveLength(2)
  })

  it('deletes a run of the caller\'s tenant with workflows.edit; another tenant\'s run is 404', async () => {
    state.perms = new Set(['workflows.edit'])
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-b' }))).status).toBe(404)
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-a' }))).status).toBe(200)
    expect(admin.tables.workflow_runs.map((r: any) => r.id)).toEqual(['run-b'])
    expect(admin.tables.workflow_logs.map((r: any) => r.id)).toEqual(['log-b'])
    // The waiting test run's open task was cancelled before the run went.
    expect(admin.tables.tasks[0].status).toBe('cancelled')
  })

  it('a waiting production run (or someone else\'s test run) needs workflows.activate to delete', async () => {
    admin.tables.workflow_runs.push(
      { id: 'run-prod', tenant_id: 'tenant-a', workflow_id: 'wf-a', status: 'waiting_for_event', event_id: 'evt-p', pause_variables: { workflow_started_via: 'ui', workflow_started_by: 'user-1' } },
      { id: 'run-theirs', tenant_id: 'tenant-a', workflow_id: 'wf-a', status: 'paused', event_id: 'evt-t', pause_variables: { workflow_started_via: 'test', workflow_started_by: 'user-2' } },
      { id: 'run-done', tenant_id: 'tenant-a', workflow_id: 'wf-a', status: 'completed', event_id: null },
    )
    state.perms = new Set(['workflows.edit'])
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-prod' }))).status).toBe(403)
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-theirs' }))).status).toBe(403)
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-done' }))).status).toBe(200)
    state.perms = new Set(['workflows.activate'])
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { run_id: 'run-prod' }))).status).toBe(200)
    expect(admin.tables.workflow_runs.map((r: any) => r.id).sort()).toEqual(['run-a', 'run-b', 'run-theirs'])
  })

  it('{ workflow_id } cancels only the caller\'s own waiting test runs of that workflow', async () => {
    admin.tables.workflow_runs.push(
      { id: 'run-prod', tenant_id: 'tenant-a', workflow_id: 'wf-a', status: 'waiting_for_event', event_id: 'evt-p', pause_variables: { workflow_started_via: 'ui', workflow_started_by: 'user-1' } },
    )
    const WF = '00000000-0000-4000-8000-00000000000a'
    for (const r of admin.tables.workflow_runs) if (r.workflow_id === 'wf-a') r.workflow_id = WF
    state.perms = new Set(['workflows.activate'])
    expect((await cleanupTest(post('/api/workflows/cleanup-test', { workflow_id: WF }))).status).toBe(403)
    state.perms = new Set(['workflows.edit'])
    const res = await cleanupTest(post('/api/workflows/cleanup-test', { workflow_id: WF }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, cancelled_runs: ['run-a'], cancelled_tasks: ['task-a'] })
    const runs = Object.fromEntries(admin.tables.workflow_runs.map((r: any) => [r.id, r.status]))
    expect(runs).toEqual({ 'run-a': 'failed', 'run-b': 'waiting_for_event', 'run-prod': 'waiting_for_event' })
  })
})

describe('POST /api/agents/action-tool (session path)', () => {
  const start = () => actionTool(post('/api/agents/action-tool', { action: 'start_workflow_run', agent_id: 'agent-a', workflow_id: 'wf-a' }))

  it('401 signed out', async () => {
    state.user = null
    expect((await start()).status).toBe(401)
  })

  it('403 without agents.test, and without the action\'s own permission', async () => {
    state.perms = new Set(['workflows.activate'])
    expect((await start()).status).toBe(403)
    state.perms = new Set(['agents.test'])
    expect((await start()).status).toBe(403)
    expect(executeWorkflow).not.toHaveBeenCalled()
  })

  it('passes the permission gate with agents.test + workflows.activate', async () => {
    state.perms = new Set(['agents.test', 'workflows.activate'])
    expect((await start()).status).not.toBe(403)
  })
})

describe('saveWorkflow / getWorkflowPackageBlock', () => {
  it('saveWorkflow writes only the designer fields', async () => {
    state.perms = new Set(['workflows.edit'])
    await saveWorkflow('wf-a', {
      nodes: [{ id: 'n' }], edges: [], name: 'Renamed',
      is_active: true, tenant_id: 'tenant-b', created_by: 'attacker', published_version_id: 'v-x',
    } as any)
    const row = session.tables.workflows.find((w: any) => w.id === 'wf-a')
    expect(row).toMatchObject({ name: 'Renamed', nodes: [{ id: 'n' }], is_active: false, tenant_id: 'tenant-a', created_by: 'owner', has_unpublished_changes: true })
    expect(row?.published_version_id).toBeUndefined()
  })

  it('getWorkflowPackageBlock says nothing about a workflow the caller cannot see', async () => {
    state.perms = new Set(['workflows.view'])
    admin.tables.package_install_assets.push({ install_id: 'inst-b', tenant_id: 'tenant-b', asset_type: 'workflow', local_id: 'wf-b', status: 'needs_config', blocked_by: [] })
    admin.tables.package_installs = [{ id: 'inst-b', name: 'Secret package', version: '1.0.0', requirements: [] }]
    expect(await getWorkflowPackageBlock('wf-b')).toBeNull()
  })
})
