import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/workflow-engine', async () => {
  const { RunNotResumableError } = await import('@/lib/workflow-run-errors')
  return { resumeWorkflow: vi.fn(async () => ({ status: 'waiting_for_event', node_results: {} })), executeWorkflow: vi.fn(), RunNotResumableError }
})

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit-log'
import { resumeWorkflow } from '@/lib/workflow-engine'
import type { ServiceContext } from '@/lib/services/context'
import { listLiveInstances, migrateInstances, planInstanceMigration, MIGRATION_CAP } from '@/lib/services/workflow-runs'
import { listWorkflowVersions } from '@/lib/services/workflows'
import { missingVariables, resolveTargetNode, userVariableDefaults, migratableNodes, isTriggerNodeType } from '@/lib/workflow-migration'
import { POST as migrateRoute } from '@/app/api/v1/workflows/[id]/instances/migrate/route'
import { GET as instancesRoute } from '@/app/api/v1/workflows/[id]/instances/route'
import { expandScopes } from '@/lib/oauth/scopes'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const V1_NODES = [
  { id: 'start', type: 'schedule', label: 'Start' },
  { id: 'A', type: 'user_task', label: 'Approve' },
  { id: 'old', type: 'delay', label: 'Wait' },
  { id: 'done', type: 'log', label: 'Log' },
]
const V2_NODES = [
  { id: 'start', type: 'schedule', label: 'Start' },
  { id: 'A', type: 'user_task', label: 'Approve' },
  { id: 'B', type: 'log', label: 'Notify', config: { message: 'Hi {{customer}} {{region}} {{task.title}} {{notify_status}}' } },
  { id: 'done', type: 'log', label: 'Log' },
]
const V2_EDGES = [{ source: 'start', target: 'A' }, { source: 'A', target: 'B' }, { source: 'B', target: 'done' }]

function seed() {
  const db = createMemorySupabase({
    workflows: [
      { id: 'wf', tenant_id: 't1', name: 'Invoices', published_version_id: 'v2', nodes: [], edges: [] },
      { id: 'wf-x', tenant_id: 't2', name: 'Foreign', published_version_id: null, nodes: [], edges: [] },
    ],
    workflow_versions: [
      { id: 'v1', workflow_id: 'wf', tenant_id: 't1', version_number: 1, nodes: V1_NODES, edges: [], user_variables: [] },
      { id: 'v2', workflow_id: 'wf', tenant_id: 't1', version_number: 2, nodes: V2_NODES, edges: V2_EDGES, user_variables: [{ name: 'region', type: 'string', defaultValue: 'EU' }] },
    ],
    workflow_runs: [
      { id: 'r-a', tenant_id: 't1', workflow_id: 'wf', version_id: 'v1', status: 'waiting_for_event', event_id: 'ev-a', paused_node_id: 'A', started_at: '2026-10-01', pause_variables: { customer: 'Ann' } },
      { id: 'r-old', tenant_id: 't1', workflow_id: 'wf', version_id: 'v1', status: 'paused', event_id: 'delay_x', paused_node_id: 'old', started_at: '2026-10-02', pause_variables: {} },
      { id: 'r-done', tenant_id: 't1', workflow_id: 'wf', version_id: 'v1', status: 'completed', event_id: null, paused_node_id: null, started_at: '2026-10-03' },
      { id: 'r-v2', tenant_id: 't1', workflow_id: 'wf', version_id: 'v2', status: 'waiting_for_event', event_id: 'ev-v2', paused_node_id: 'A', started_at: '2026-10-04', pause_variables: {} },
      { id: 'r-x', tenant_id: 't2', workflow_id: 'wf-x', version_id: null, status: 'waiting_for_event', event_id: 'ev-x', paused_node_id: 'A', started_at: '2026-10-05' },
    ],
    tasks: [
      { id: 'task-a', tenant_id: 't1', event_id: 'ev-a', status: 'todo', title: 'Approve INV', assignee_id: 'u1', assigned_team_id: null },
      { id: 'task-done', tenant_id: 't1', event_id: 'ev-a', status: 'completed', title: 'Old' },
    ],
    users: [{ id: 'u1', tenant_id: 't1', display_name: 'Ann Approver', email: 'ann@example.com' }],
    workflow_queue: [
      { id: 'job-1', tenant_id: 't1', workflow_id: 'wf', status: 'pending', trigger_type: 'delay_resume', trigger_data: { _resume_run_id: 'r-old', _resume_event_id: 'delay_x' } },
    ],
  }) as any
  db.rpc = vi.fn(async (name: string, args: any) => {
    if (name === 'workflow_live_instance_counts') {
      const counts = new Map<string | null, number>()
      for (const r of db.tables.workflow_runs) {
        if (r.tenant_id === args.p_tenant_id && r.workflow_id === args.p_workflow_id && ['waiting_for_event', 'paused'].includes(r.status)) counts.set(r.version_id, (counts.get(r.version_id) ?? 0) + 1)
      }
      return { data: [...counts].map(([version_id, instances]) => ({ version_id, instances })), error: null }
    }
    if (name === 'migrate_workflow_instance') {
      const run = db.tables.workflow_runs.find((r: any) => r.id === args.p_run_id && r.tenant_id === args.p_tenant_id)
      if (!run || !['waiting_for_event', 'paused'].includes(run.status) || run.event_id !== args.p_expected_event_id || run.version_id !== args.p_from_version_id) {
        return { data: { ok: false, conflict: true, reason: 'Run moved on' }, error: null }
      }
      const newId = `new-${run.id}`
      db.tables.workflow_runs.push({ id: newId, tenant_id: run.tenant_id, workflow_id: run.workflow_id, version_id: args.p_to_version_id, status: 'paused', paused_node_id: args.p_target_node_id, pause_variables: { ...args.p_variable_defaults, ...run.pause_variables }, migrated_from_run_id: run.id })
      Object.assign(run, { status: 'migrated', migrated_to_run_id: newId, event_id: null, paused_node_id: null, pause_variables: null })
      return { data: { ok: true, new_run_id: newId, closed_task_ids: ['task-a'], cancelled_job_ids: [] }, error: null }
    }
    return { data: null, error: { message: `unknown rpc ${name}` } }
  })
  return db
}

const MANAGE = ['workflows.view', 'workflows.view_runs', 'workflows.manage_runs']
function ctx(db: any, permissions: string[] = MANAGE, extra: Partial<ServiceContext> = {}): ServiceContext {
  return { supabase: db, tenantId: 't1', actorId: 'user-1', permissions: new Set(permissions), authKind: 'api_key', source: 'api', ...extra }
}

beforeEach(() => {
  vi.mocked(resumeWorkflow).mockClear()
  vi.mocked(resumeWorkflow).mockResolvedValue({ status: 'waiting_for_event', node_results: {} })
  vi.mocked(writeAudit).mockClear()
})

describe('workflow-migration helpers', () => {
  it('resolves the target node: map → default → same id', () => {
    const ids = new Set(['A', 'B'])
    expect(resolveTargetNode('A', { targetNodeIds: ids })).toEqual({ nodeId: 'A', via: 'same_id' })
    expect(resolveTargetNode('A', { targetNodeIds: ids, nodeMap: { A: 'B' } })).toEqual({ nodeId: 'B', via: 'map' })
    expect(resolveTargetNode('A', { targetNodeIds: ids, defaultTargetNodeId: 'B' })).toEqual({ nodeId: 'B', via: 'default' })
    expect(resolveTargetNode('gone', { targetNodeIds: ids })).toEqual({ nodeId: null, via: null })
    expect(resolveTargetNode(null, { targetNodeIds: ids })).toEqual({ nodeId: null, via: null })
  })

  it('computes user-variable defaults like the engine', () => {
    expect(userVariableDefaults([
      { name: 'n', type: 'number', defaultValue: '4' }, { name: 'b', type: 'boolean', defaultValue: 'true' },
      { name: 'o', type: 'object', defaultValue: '{"a":1}' }, { name: 'bad', type: 'object', defaultValue: '{' }, { name: 's', defaultValue: 'x' }, { type: 'string' },
    ])).toEqual({ n: 4, b: true, o: { a: 1 }, bad: {}, s: 'x' })
  })

  it('flags variables the target path references but the instance lacks', () => {
    const missing = missingVariables({ nodes: V2_NODES, edges: V2_EDGES, startNodeId: 'B', available: ['region'] })
    expect(missing).toEqual([{ name: 'customer', nodes: ['Notify'] }])
    // Upstream of the start node is not checked; node output prefixes count as produced.
    expect(missingVariables({ nodes: V2_NODES, edges: V2_EDGES, startNodeId: 'done', available: [] })).toEqual([])
  })

  it('only offers steps as targets', () => {
    expect(isTriggerNodeType('schedule')).toBe(true)
    expect(isTriggerNodeType('log')).toBe(false)
    expect(migratableNodes(V2_NODES).map((n) => n.id)).toEqual(['A', 'B', 'done'])
  })
})

describe('live instances', () => {
  it('lists waiting/paused runs with current node, version, open task and counts', async () => {
    const list = await listLiveInstances(ctx(seed()), 'wf')
    expect(list.total).toBe(3)
    expect(list.instances.map((i) => i.run_id)).toEqual(['r-a', 'r-old', 'r-v2'])
    expect(list.instances[0]).toMatchObject({ version_number: 1, current_node_label: 'Approve', current_node_type: 'user_task', open_task: { id: 'task-a', assignee_name: 'Ann Approver' } })
    expect(list.on_older_versions).toBe(2)
    expect(list.versions).toEqual([
      { version_id: 'v2', version_number: 2, is_published: true, instances: 1 },
      { version_id: 'v1', version_number: 1, is_published: false, instances: 2 },
    ])
  })

  it('needs workflows.view_runs and stays in the tenant / key scope', async () => {
    await expect(listLiveInstances(ctx(seed(), ['workflows.view']), 'wf')).rejects.toMatchObject({ status: 403 })
    await expect(listLiveInstances(ctx(seed()), 'wf-x')).rejects.toMatchObject({ code: 'not_found' })
    await expect(listLiveInstances(ctx(seed(), MANAGE, { resourceScopes: { workflow_ids: ['other'], table_ids: [] } }), 'wf')).rejects.toMatchObject({ status: 403 })
  })

  it('versions list carries active_instances', async () => {
    const { versions } = await listWorkflowVersions(ctx(seed()), 'wf', { limit: 10, offset: 0 })
    expect(Object.fromEntries(versions.map((v: any) => [v.id, v.active_instances]))).toEqual({ v1: 2, v2: 1 })
  })
})

describe('migration plan', () => {
  it('plans each instance: same id, removed node, finished, already on target, unknown', async () => {
    const plan = await planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a', 'r-old', 'r-done', 'r-v2', 'nope', 'r-x'] })
    const byId = Object.fromEntries(plan.items.map((i) => [i.run_id, i]))
    expect(byId['r-a']).toMatchObject({
      ok: true, target_node_id: 'A', target_via: 'same_id', from_version_number: 1,
      close: { status: 'migrated', open_task_ids: ['task-a'], queued_job_ids: [] },
      create: { version_id: 'v2', start_node_id: 'A', creates_task: true, carried_variables: 1, defaulted_variables: ['region'] },
    })
    expect(byId['r-old']).toMatchObject({ ok: false, blocked_reason: expect.stringMatching(/does not exist in v2/), close: { queued_job_ids: ['job-1'] } })
    expect(byId['r-done'].blocked_reason).toMatch(/completed/)
    expect(byId['r-v2'].blocked_reason).toMatch(/Already on the target version/)
    expect(byId.nope.blocked_reason).toMatch(/not found/)
    expect(byId['r-x'].blocked_reason).toMatch(/not found/)
    expect(plan.summary).toEqual({ total: 6, ready: 1, blocked: 5, with_warnings: 1 })
  })

  it('node_map and default target fix removed nodes; warnings for missing variables and timed waits', async () => {
    const plan = await planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2', fromVersionId: 'v1', nodeMap: { old: 'B' } })
    expect(plan.items.map((i) => i.run_id)).toEqual(['r-a', 'r-old'])
    const old = plan.items[1]
    expect(old).toMatchObject({ ok: true, target_node_id: 'B', target_via: 'map', create: expect.objectContaining({ creates_task: false }) })
    expect(old.warnings.join(' | ')).toMatch(/Variable "customer" is used by Notify/)
    expect(old.warnings.join(' | ')).toMatch(/timed wait/)
    const viaDefault = await planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2', allActive: true, defaultTargetNodeId: 'B' })
    expect(viaDefault.items.map((i) => [i.run_id, i.target_node_id, i.target_via])).toEqual([['r-a', 'B', 'default'], ['r-old', 'B', 'default']])
  })

  it('blocks trigger targets and validates the request', async () => {
    const plan = await planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a'], nodeMap: { A: 'start' } })
    expect(plan.items[0].blocked_reason).toMatch(/trigger/)
    await expect(planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2' })).rejects.toMatchObject({ code: 'validation_error' })
    await expect(planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v9', runIds: ['r-a'] })).rejects.toMatchObject({ code: 'not_found' })
    await expect(planInstanceMigration(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2', runIds: Array.from({ length: MIGRATION_CAP + 1 }, (_, i) => `r${i}`) }))
      .rejects.toMatchObject({ code: 'validation_error' })
  })

  it('needs workflows.manage_runs (also for dry runs)', async () => {
    const db = seed()
    await expect(migrateInstances(ctx(db, ['workflows.view', 'workflows.view_runs', 'workflows.activate']), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a'], dryRun: true }))
      .rejects.toMatchObject({ status: 403, message: expect.stringMatching(/workflows.manage_runs/) })
    expect(db.rpc).not.toHaveBeenCalledWith('migrate_workflow_instance', expect.anything())
  })
})

describe('migrateInstances', () => {
  it('dry run changes nothing', async () => {
    const db = seed()
    const out = await migrateInstances(ctx(db), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a'], dryRun: true })
    expect(out).toMatchObject({ dry_run: true, results: [] })
    expect(db.rpc).not.toHaveBeenCalledWith('migrate_workflow_instance', expect.anything())
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('migrates per instance with partial results, starts the new run at its node and audits both runs', async () => {
    const db = seed()
    const out = await migrateInstances(ctx(db), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a', 'r-done'] })
    expect(out.summary).toEqual({ migrated: 1, skipped: 1, failed: 0 })
    expect(out.results[0]).toMatchObject({ run_id: 'r-a', ok: true, new_run_id: 'new-r-a', new_status: 'waiting_for_event', target_node_id: 'A', closed_task_ids: ['task-a'] })
    expect(out.results[1]).toMatchObject({ run_id: 'r-done', ok: false })
    expect(db.rpc).toHaveBeenCalledWith('migrate_workflow_instance', expect.objectContaining({
      p_tenant_id: 't1', p_run_id: 'r-a', p_expected_event_id: 'ev-a', p_from_version_id: 'v1', p_to_version_id: 'v2', p_target_node_id: 'A', p_variable_defaults: { region: 'EU' },
    }))
    expect(resumeWorkflow).toHaveBeenCalledWith('new-r-a', { _goto_node_id: 'A' }, undefined, { migrated: true })
    const audited = vi.mocked(writeAudit).mock.calls.map(([entry]) => entry.objectId)
    expect(audited).toEqual(['r-a', 'new-r-a'])
  })

  it('reports a run that changed meanwhile as a conflict and leaves it alone', async () => {
    const db = seed()
    const real = db.rpc.getMockImplementation()
    db.rpc.mockImplementation(async (name: string, args: any) => {
      if (name === 'migrate_workflow_instance') db.tables.workflow_runs.find((r: any) => r.id === 'r-a').event_id = 'ev-new'
      return real(name, args)
    })
    const out = await migrateInstances(ctx(db), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a'] })
    expect(out.results[0]).toMatchObject({ ok: false, conflict: true })
    expect(out.summary).toEqual({ migrated: 0, skipped: 0, failed: 1 })
    expect(resumeWorkflow).not.toHaveBeenCalled()
  })

  it('keeps the migration when starting the new run fails, and says so', async () => {
    vi.mocked(resumeWorkflow).mockRejectedValueOnce(new Error('boom'))
    const out = await migrateInstances(ctx(seed()), { workflowId: 'wf', toVersionId: 'v2', runIds: ['r-a'] })
    expect(out.results[0]).toMatchObject({ ok: true, new_run_id: 'new-r-a', new_status: 'paused', error: 'Started with an error: boom' })
  })
})

describe('REST + OAuth', () => {
  function auth(db: any, permissions: string[]): ApiKeySuccessResult {
    return { success: true, tenantId: 't1', supabase: db, permissions, scopes: { workflow_ids: [], table_ids: [] }, keyType: 'tenant' } as any
  }
  const post = (body: unknown) => new NextRequest('http://x/api/v1/workflows/wf/instances/migrate', { method: 'POST', body: JSON.stringify(body) })

  it('POST /instances/migrate: 403 without manage_runs, dry-run plan with it, 400 on bad bodies', async () => {
    const db = seed()
    vi.mocked(validateApiKey).mockResolvedValue(auth(db, ['workflows.view', 'workflows.activate']))
    const denied = await migrateRoute(post({ to_version_id: 'v2', run_ids: ['r-a'], dry_run: true }), { params: Promise.resolve({ id: 'wf' }) })
    expect(denied.status).toBe(403)
    vi.mocked(validateApiKey).mockResolvedValue(auth(db, MANAGE))
    const ok = await migrateRoute(post({ to_version_id: 'v2', run_ids: ['r-a'], node_map: { A: 'B' }, dry_run: true }), { params: Promise.resolve({ id: 'wf' }) })
    const json = await ok.json()
    expect(ok.status).toBe(200)
    expect(json.data.plan.items[0]).toMatchObject({ target_node_id: 'B', target_via: 'map' })
    const bad = await migrateRoute(post({ run_ids: ['r-a'] }), { params: Promise.resolve({ id: 'wf' }) })
    expect(bad.status).toBe(400)
  })

  it('GET /instances filters by version', async () => {
    vi.mocked(validateApiKey).mockResolvedValue(auth(seed(), MANAGE))
    const res = await instancesRoute(new NextRequest('http://x/api/v1/workflows/wf/instances?version_id=v2'), { params: Promise.resolve({ id: 'wf' }) })
    const json = await res.json()
    expect(json.data.instances.map((i: any) => i.run_id)).toEqual(['r-v2'])
  })

  it('workflows:write grants workflows.manage_runs', () => {
    expect(expandScopes(['workflows:write'])).toContain('workflows.manage_runs')
    expect(expandScopes(['workflows:read'])).not.toContain('workflows.manage_runs')
  })
})
