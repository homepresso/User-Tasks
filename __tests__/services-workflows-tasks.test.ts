import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/data-table-workflow-triggers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data-table-workflow-triggers')>()
  return { ...actual, invalidateDataTableTriggerCache: vi.fn() }
})
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
}))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { writeAudit } from '@/lib/audit-log'
import { invalidateDataTableTriggerCache } from '@/lib/data-table-workflow-triggers'
import { enqueueDeletionJob } from '@/lib/deletion-queue'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import * as decisionTables from '@/lib/services/decision-tables'
import * as tasks from '@/lib/services/tasks'
import * as workflows from '@/lib/services/workflows'
import { DELETE as deleteWorkflowRoute } from '@/app/api/v1/workflows/[id]/route'
import { POST as activateRoute } from '@/app/api/v1/workflows/[id]/activate/route'
import { POST as deactivateRoute } from '@/app/api/v1/workflows/[id]/deactivate/route'
import { GET as versionsRoute } from '@/app/api/v1/workflows/[id]/versions/route'
import { GET as versionRoute } from '@/app/api/v1/workflows/[id]/versions/[versionId]/route'
import { PATCH as patchTaskRoute } from '@/app/api/v1/tasks/[id]/route'
import { POST as taskActionRoute } from '@/app/api/v1/tasks/[id]/action/route'
import { GET as exportDtRoute } from '@/app/api/v1/decision-tables/[id]/export/route'
import { POST as importDtRoute } from '@/app/api/v1/decision-tables/import/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

/* eslint-disable @typescript-eslint/no-explicit-any -- memory rows */

const FIELDS = [
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'reason', label: 'Reason', type: 'text' },
]

// A designed form (grid fields of the newer types).
const FORM_FIELDS = [
  { key: 'email', label: 'Work email', type: 'email', required: true },
  { key: 'total', label: 'Total', type: 'currency', max: 1000 },
  { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] },
]

function seed() {
  return createMemorySupabase({
    workflows: [
      { id: 'wf-a', tenant_id: 'tenant-a', name: 'Approve', is_active: false },
      { id: 'wf-a2', tenant_id: 'tenant-a', name: 'Other', is_active: true },
      { id: 'wf-b', tenant_id: 'tenant-b', name: 'Foreign', is_active: true },
    ],
    workflow_versions: [
      { id: 'v1', workflow_id: 'wf-a', tenant_id: 'tenant-a', version_number: 1, nodes: [{ id: 'n1' }], edges: [], trigger_type: 'manual', is_active: false },
      { id: 'v2', workflow_id: 'wf-a', tenant_id: 'tenant-a', version_number: 2, nodes: [{ id: 'n1' }, { id: 'n2' }], edges: [], trigger_type: 'manual', is_active: true },
      { id: 'vb', workflow_id: 'wf-b', tenant_id: 'tenant-b', version_number: 1, nodes: [], edges: [], trigger_type: 'manual', is_active: true },
    ],
    tasks: [
      { id: 'task-a', tenant_id: 'tenant-a', title: 'Review', status: 'todo', priority: 'medium', assignee_id: 'user-1', deleted_at: null, metadata: { fields: FIELDS, template_values: { reason: 'draft' } } },
      { id: 'task-other', tenant_id: 'tenant-a', title: 'Not mine', status: 'todo', assignee_id: 'user-2', deleted_at: null, metadata: {} },
      { id: 'task-done', tenant_id: 'tenant-a', title: 'Done', status: 'completed', assignee_id: 'user-1', deleted_at: null, metadata: { fields: FIELDS } },
      { id: 'task-b', tenant_id: 'tenant-b', title: 'Foreign', status: 'todo', deleted_at: null, metadata: {} },
      { id: 'task-form', tenant_id: 'tenant-a', title: 'Expense', status: 'todo', assignee_id: 'user-1', deleted_at: null, is_workflow_task: false, metadata: { fields: FORM_FIELDS, template_values: {} } },
    ],
    task_assignees: [],
    decision_tables: [
      { id: 'dt-a', tenant_id: 'tenant-a', name: 'Risk', description: 'Scores', inputs: [{ id: 'i1', key: 'amount', label: 'Amount', type: 'number' }], outputs: [{ id: 'o1', key: 'tier', label: 'Tier', type: 'text' }], rules: [{ id: 'r1', label: '', enabled: true, conditions: [{ id: 'c1', inputKey: 'amount', operator: 'greater_than', value: '10' }], outputs: { tier: 'gold' } }] },
      { id: 'dt-b', tenant_id: 'tenant-b', name: 'Foreign', inputs: [], outputs: [], rules: [] },
    ],
  })
}
type Db = ReturnType<typeof seed>

function ctx(db: Db, permissions: string[] | null = null, extra: Partial<ServiceContext> = {}): ServiceContext {
  return {
    supabase: db as unknown as ServiceContext['supabase'], tenantId: 'tenant-a', actorId: null,
    permissions: permissions ? new Set(permissions) : null, authKind: 'api_key', source: 'api', ...extra,
  }
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
  vi.mocked(enqueueDeletionJob).mockClear()
})

describe('workflows service', () => {
  it('deletes through the deletion queue with audit + sync, and is tenant/scope bound', async () => {
    const db = seed()
    await workflows.deleteWorkflow(ctx(db, ['workflows.delete']), 'wf-a')
    expect(enqueueDeletionJob).toHaveBeenCalledWith(db, expect.objectContaining({ targetType: 'workflow', targetId: 'wf-a', tenantId: 'tenant-a' }))
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'workflow', action: 'delete' }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'workflow', assetId: 'wf-a', action: 'delete' }))
    await expect(workflows.deleteWorkflow(ctx(db, ['workflows.edit']), 'wf-a')).rejects.toMatchObject({ status: 403 })
    await expect(workflows.deleteWorkflow(ctx(db), 'wf-b')).rejects.toMatchObject({ status: 404 })
    await expect(workflows.deleteWorkflow(ctx(db, null, { resourceScopes: { workflow_ids: ['wf-a2'], table_ids: [] } }), 'wf-a')).rejects.toMatchObject({ status: 403 })
  })

  it('activates / deactivates (workflows.activate) and audits real changes only', async () => {
    const db = seed()
    await expect(workflows.setWorkflowActive(ctx(db, ['workflows.edit']), 'wf-a', true)).rejects.toMatchObject({ status: 403 })
    expect(await workflows.setWorkflowActive(ctx(db, ['workflows.activate']), 'wf-a', true)).toEqual({ id: 'wf-a', is_active: true })
    expect(db.tables.workflows.find((w) => w.id === 'wf-a')!.is_active).toBe(true)
    await workflows.setWorkflowActive(ctx(db), 'wf-a', true)
    expect(writeAudit).toHaveBeenCalledTimes(1)
    await workflows.setWorkflowActive(ctx(db), 'wf-a', false)
    expect(db.tables.workflows.find((w) => w.id === 'wf-a')!.is_active).toBe(false)
  })

  it('drops the tenant\'s cached data-table trigger set on activate, deactivate and delete', async () => {
    const db = seed()
    vi.mocked(invalidateDataTableTriggerCache).mockClear()
    await workflows.setWorkflowActive(ctx(db), 'wf-a', true)
    await workflows.setWorkflowActive(ctx(db), 'wf-a', false)
    await workflows.deleteWorkflow(ctx(db), 'wf-a')
    expect(vi.mocked(invalidateDataTableTriggerCache).mock.calls).toEqual([['tenant-a'], ['tenant-a'], ['tenant-a']])
    // Denied changes don't touch the cache.
    await expect(workflows.setWorkflowActive(ctx(db, ['workflows.edit']), 'wf-a', true)).rejects.toMatchObject({ status: 403 })
    expect(invalidateDataTableTriggerCache).toHaveBeenCalledTimes(3)
  })

  it('lists versions newest first and returns one with its definition', async () => {
    const db = seed()
    const { versions, total } = await workflows.listWorkflowVersions(ctx(db), 'wf-a', { limit: 50, offset: 0 })
    expect(versions.map((v) => v.version_number)).toEqual([2, 1])
    expect(total).toBe(2)
    expect((await workflows.getWorkflowVersion(ctx(db), 'wf-a', 'v2')).nodes).toHaveLength(2)
    await expect(workflows.getWorkflowVersion(ctx(db), 'wf-a', 'vb')).rejects.toMatchObject({ status: 404 })
    await expect(workflows.listWorkflowVersions(ctx(db), 'wf-b', { limit: 50, offset: 0 })).rejects.toMatchObject({ status: 404 })
  })
})

describe('tasks service: updateTask', () => {
  it('updates allowlisted fields and merges field values (partial, type-checked)', async () => {
    const db = seed()
    const task = await tasks.updateTask(ctx(db, ['tasks.complete']), 'task-a', { title: 'Review PO', priority: 'high', values: { amount: '42' } })
    expect(task).toMatchObject({ title: 'Review PO', priority: 'high' })
    expect(task.metadata.template_values).toEqual({ reason: 'draft', amount: 42 })
    await expect(tasks.updateTask(ctx(db), 'task-a', { values: { amount: 'lots' } })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects non-allowlisted fields, bad values, completion and closed tasks', async () => {
    const db = seed()
    await expect(tasks.updateTask(ctx(db), 'task-a', { assignee_id: 'user-9' } as any)).rejects.toMatchObject({ status: 400 })
    await expect(tasks.updateTask(ctx(db), 'task-a', { priority: 'urgent' })).rejects.toMatchObject({ status: 400 })
    await expect(tasks.updateTask(ctx(db), 'task-a', { status: 'completed' })).rejects.toMatchObject({ status: 400 })
    await expect(tasks.updateTask(ctx(db), 'task-done', { values: { amount: 1 } })).rejects.toMatchObject({ status: 409 })
    await expect(tasks.updateTask(ctx(db), 'task-a', {})).rejects.toMatchObject({ status: 400 })
    expect(db.tables.tasks.find((t) => t.id === 'task-a')!.assignee_id).toBe('user-1')
  })

  it('needs tasks.complete; user-bound credentials only reach their own tasks; other tenants are 404', async () => {
    const db = seed()
    await expect(tasks.updateTask(ctx(db, ['tasks.view_all']), 'task-a', { title: 'x' })).rejects.toMatchObject({ status: 403 })
    const bound = ctx(db, ['tasks.complete'], { actorId: 'user-1' })
    expect((await tasks.updateTask(bound, 'task-a', { title: 'Mine' })).title).toBe('Mine')
    await expect(tasks.updateTask(bound, 'task-other', { title: 'pwn' })).rejects.toMatchObject({ status: 403 })
    await expect(tasks.updateTask(ctx(db), 'task-b', { title: 'pwn' })).rejects.toMatchObject({ status: 404 })
    expect(db.tables.tasks.find((t) => t.id === 'task-b')!.title).toBe('Foreign')
  })
})

describe('decision tables service: export / import', () => {
  it('round-trips an export into a new table (ids kept) with audit + sync', async () => {
    const db = seed()
    const exported = await decisionTables.exportDecisionTable(ctx(db, ['workflows.view']), 'dt-a')
    expect(exported).toMatchObject({ version: 1, asset_type: 'decision_table', decision_table: { name: 'Risk', description: 'Scores' } })
    const imported = await decisionTables.importDecisionTable(ctx(db, ['workflows.create']), { payload: exported, name_override: 'Risk (copy)' })
    expect(imported).toMatchObject({ name: 'Risk (copy)', description: 'Scores', rule_count: 1, input_count: 1 })
    expect(imported.rules[0]).toEqual((exported.decision_table.rules as any[])[0])
    expect(imported.id).not.toBe('dt-a')
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'decision_table', assetId: imported.id }))
  })

  it('validates, gates and isolates', async () => {
    const db = seed()
    await expect(decisionTables.exportDecisionTable(ctx(db), 'dt-b')).rejects.toMatchObject({ status: 404 })
    await expect(decisionTables.importDecisionTable(ctx(db, ['workflows.view']), { payload: { name: 'x' } })).rejects.toMatchObject({ status: 403 })
    await expect(decisionTables.importDecisionTable(ctx(db), { payload: { inputs: [] } })).rejects.toMatchObject({ status: 400 })
    await expect(decisionTables.importDecisionTable(ctx(db), { payload: { name: 'x', inputs: [{ label: 'no key' }] } })).rejects.toMatchObject({ status: 400 })
    const minimal = await decisionTables.importDecisionTable(ctx(db), { payload: { name: 'Bare', rules: [{ conditions: [{ inputKey: 'a', operator: 'equals', value: 3 }] }] } })
    expect(minimal.rules[0]).toMatchObject({ enabled: true, conditions: [{ inputKey: 'a', value: '3', id: expect.any(String) }] })
  })

  it('MCP export/import keep their shapes', async () => {
    const db = seed()
    const server = createMcpServer({ tenantId: 'tenant-a', supabase: db, actingUserId: null, keyType: 'tenant', scopes: { workflow_ids: [], table_ids: [] } } as any)
    const exported = JSON.parse((await server.callTool('decision_tables_export', { decision_table_id: 'dt-a' })).content[0].text)
    expect(exported).toMatchObject({ exported: true, export: { asset_type: 'decision_table' } })
    const imported = JSON.parse((await server.callTool('decision_tables_import', { import_json: JSON.stringify(exported.export) })).content[0].text)
    expect(imported).toMatchObject({ imported: true, decision_table: { name: 'Risk' } })
    const bad = await server.callTool('decision_tables_import', { import_json: '{' })
    expect(bad).toMatchObject({ isError: true, content: [{ text: 'Error: import_json must be valid JSON' }] })
  })
})

describe('routes: workflows lifecycle, task update, decision-table import/export', () => {
  const mockedValidate = vi.mocked(validateApiKey)
  function authAs(db: Db, permissions: string[], actingUserId: string | null = null) {
    mockedValidate.mockResolvedValue({
      success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: actingUserId ? 'user' : 'tenant', createdBy: 'u1', actingUserId,
      scopes: { workflow_ids: [], table_ids: [] }, permissions,
      supabase: db as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
    })
  }
  const req = (path: string, init?: { method?: string; body?: unknown }) => new NextRequest(`https://app.test/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const params = <P extends Record<string, string>>(p: P) => ({ params: Promise.resolve(p) })

  it('workflow activate / deactivate / versions / delete', async () => {
    const db = seed()
    authAs(db, ['workflows.view'])
    expect((await activateRoute(req('/workflows/wf-a/activate', { method: 'POST' }), params({ id: 'wf-a' }))).status).toBe(403)
    authAs(db, ['workflows.view', 'workflows.activate', 'workflows.delete'])
    expect((await (await activateRoute(req('/workflows/wf-a/activate', { method: 'POST' }), params({ id: 'wf-a' }))).json()).data).toEqual({ id: 'wf-a', is_active: true })
    expect((await (await deactivateRoute(req('/workflows/wf-a/deactivate', { method: 'POST' }), params({ id: 'wf-a' }))).json()).data).toEqual({ id: 'wf-a', is_active: false })
    const versions = await (await versionsRoute(req('/workflows/wf-a/versions?limit=1'), params({ id: 'wf-a' }))).json()
    expect(versions.data).toMatchObject({ total: 2, versions: [{ id: 'v2' }] })
    expect((await versionRoute(req('/workflows/wf-a/versions/v1'), params({ id: 'wf-a', versionId: 'v1' }))).status).toBe(200)
    expect((await deleteWorkflowRoute(req('/workflows/wf-b', { method: 'DELETE' }), params({ id: 'wf-b' }))).status).toBe(404)
    const deleted = await deleteWorkflowRoute(req('/workflows/wf-a', { method: 'DELETE' }), params({ id: 'wf-a' }))
    expect((await deleted.json()).data).toMatchObject({ deleted: true, id: 'wf-a' })
  })

  it('PATCH /tasks/{id}: 400 on unknown fields, 403 for other users’ tasks, 200 otherwise', async () => {
    const db = seed()
    authAs(db, ['tasks.complete'])
    expect((await patchTaskRoute(req('/tasks/task-a', { method: 'PATCH', body: { assignee_id: 'x' } }), params({ id: 'task-a' }))).status).toBe(400)
    expect((await patchTaskRoute(req('/tasks/task-a', { method: 'PATCH', body: { status: 'completed' } }), params({ id: 'task-a' }))).status).toBe(400)
    const ok = await patchTaskRoute(req('/tasks/task-a', { method: 'PATCH', body: { due_date: '2026-12-01T00:00:00Z', values: { reason: 'ok' } } }), params({ id: 'task-a' }))
    expect((await ok.json()).data.task).toMatchObject({ due_date: '2026-12-01T00:00:00Z', metadata: { template_values: { reason: 'ok' } } })
    authAs(db, ['tasks.complete'], 'user-1')
    expect((await patchTaskRoute(req('/tasks/task-other', { method: 'PATCH', body: { title: 'x' } }), params({ id: 'task-other' }))).status).toBe(403)
  })

  it('task form values are validated server-side on PATCH and on completion (REST)', async () => {
    const db = seed()
    authAs(db, ['tasks.complete'])
    const badPatch = await patchTaskRoute(req('/tasks/task-form', { method: 'PATCH', body: { values: { email: 'nope', total: 5000, tags: ['zzz'] } } }), params({ id: 'task-form' }))
    expect(badPatch.status).toBe(400)
    const badPatchBody = await badPatch.json()
    expect(JSON.stringify(badPatchBody)).toMatch(/Work email must be an email address/)
    const missing = await taskActionRoute(req('/tasks/task-form/action', { method: 'POST', body: { action: 'complete', outcome: 'done', values: { total: 10 } } }), params({ id: 'task-form' }))
    expect(missing.status).toBe(400)
    expect(JSON.stringify(await missing.json())).toMatch(/Work email is required/)
    const tooBig = await taskActionRoute(req('/tasks/task-form/action', { method: 'POST', body: { action: 'complete', outcome: 'done', values: { email: 'a@b.co', total: 5000 } } }), params({ id: 'task-form' }))
    expect(tooBig.status).toBe(400)
    const done = await taskActionRoute(req('/tasks/task-form/action', { method: 'POST', body: { action: 'complete', outcome: 'done', values: { email: 'a@b.co', total: '12.5', tags: 'a,b' } } }), params({ id: 'task-form' }))
    expect(done.status).toBe(200)
    const row = db.tables.tasks.find((t: any) => t.id === 'task-form') as any
    expect(row.status).toBe('completed')
    expect(row.metadata.template_values).toMatchObject({ email: 'a@b.co', total: 12.5, tags: ['a', 'b'] })
  })

  it('decision-table export → import', async () => {
    const db = seed()
    authAs(db, ['workflows.view', 'workflows.create'])
    const exported = (await (await exportDtRoute(req('/decision-tables/dt-a/export'), params({ id: 'dt-a' }))).json()).data
    const res = await importDtRoute(req('/decision-tables/import', { method: 'POST', body: { ...exported, name_override: 'Copy' } }))
    expect(res.status).toBe(201)
    expect((await res.json()).data.decision_table).toMatchObject({ name: 'Copy', rule_count: 1 })
    authAs(db, ['workflows.view'])
    expect((await importDtRoute(req('/decision-tables/import', { method: 'POST', body: exported }))).status).toBe(403)
  })
})
