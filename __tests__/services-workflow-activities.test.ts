import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
  processDeletionQueueBatch: vi.fn(async () => ({ processed: 0, results: [] })),
}))

import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { enqueueDeletionJob, processDeletionQueueBatch } from '@/lib/deletion-queue'
import { createMcpServer } from '@/lib/mcp/server'
import { __testing } from '@/lib/workflow-engine'
import type { ServiceContext } from '@/lib/services/context'
import * as activities from '@/lib/services/workflow-activities'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = ['extensibility.view', 'extensibility.create', 'extensibility.edit', 'extensibility.delete']
const page = { limit: 50, offset: 0 }
const SOURCE = 'async function run(inputs) { return { outputs: { score: Number(inputs.amount ?? 0) * 2 } } }'
const MANIFEST = { inputs: [{ name: 'amount', type: 'number', required: true }], outputs: [{ name: 'score', type: 'number' }] }

function context(supabase: ReturnType<typeof createMemorySupabase>, permissions: string[] = ALL): ServiceContext {
  return {
    supabase: supabase as unknown as ServiceContext['supabase'],
    tenantId: 'tenant-a',
    actorId: 'user-1',
    permissions: new Set(permissions),
    authKind: 'api_key',
    source: 'api',
  }
}

function seed() {
  return createMemorySupabase({
    custom_workflow_activities: [
      { id: 'act-a', tenant_id: 'tenant-a', name: 'Scorer', key: 'scorer', status: 'active', source_kind: 'inline', source_code: SOURCE, manifest: MANIFEST, tags: ['risk'], demo_inputs: {} },
      { id: 'act-b', tenant_id: 'tenant-b', name: 'Foreign', key: 'foreign', status: 'active', source_kind: 'inline', source_code: SOURCE, manifest: MANIFEST, tags: [], demo_inputs: {} },
    ],
  })
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
  vi.mocked(enqueueDeletionJob).mockClear()
  vi.mocked(processDeletionQueueBatch).mockClear()
})
afterEach(() => vi.unstubAllEnvs())

describe('workflow activity services: permissions', () => {
  it.each([
    ['list', (ctx: ServiceContext) => activities.listWorkflowActivities(ctx, {}, page)],
    ['get', (ctx: ServiceContext) => activities.getWorkflowActivity(ctx, 'act-a')],
    ['create', (ctx: ServiceContext) => activities.createWorkflowActivity(ctx, { name: 'X', source_code: SOURCE, manifest: MANIFEST })],
    ['update', (ctx: ServiceContext) => activities.updateWorkflowActivity(ctx, 'act-a', { name: 'Y' })],
    ['delete', (ctx: ServiceContext) => activities.deleteWorkflowActivity(ctx, 'act-a')],
    ['export', (ctx: ServiceContext) => activities.exportWorkflowActivity(ctx, 'act-a')],
    ['import', (ctx: ServiceContext) => activities.importWorkflowActivity(ctx, '{}')],
  ])('%s throws 403 without its extensibility.* permission and touches nothing', async (_name, call) => {
    const supabase = seed()
    await expect(call(context(supabase, []))).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(supabase.calls).toEqual([])
    expect(enqueueDeletionJob).not.toHaveBeenCalled()
  })

  it('delete needs extensibility.delete, not just edit', async () => {
    await expect(activities.deleteWorkflowActivity(context(seed(), ['extensibility.edit']), 'act-a')).rejects.toMatchObject({ status: 403 })
  })
})

describe('workflow activity services: behaviour', () => {
  it('lists without source code and isolates tenants', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const { workflow_activities: rows, total } = await activities.listWorkflowActivities(ctx, {}, page)
    expect(rows.map((row) => row.id)).toEqual(['act-a'])
    expect(total).toBe(1)
    expect(rows[0].manifest_summary).toMatchObject({ input_count: 1, output_count: 1 })
    await expect(activities.getWorkflowActivity(ctx, 'act-b')).rejects.toMatchObject({ status: 404 })
    await expect(activities.updateWorkflowActivity(ctx, 'act-b', { name: 'pwn' })).rejects.toMatchObject({ status: 404 })
    await expect(activities.deleteWorkflowActivity(ctx, 'act-b')).rejects.toMatchObject({ status: 404 })
    await expect(activities.exportWorkflowActivity(ctx, 'act-b')).rejects.toMatchObject({ status: 404 })
    expect(enqueueDeletionJob).not.toHaveBeenCalled()
  })

  it('creates with defaults, audit and sync capture', async () => {
    const supabase = seed()
    const created = await activities.createWorkflowActivity(context(supabase), { name: 'Risk Calculator', source_code: SOURCE, manifest: MANIFEST, tags: [' Risk ', ''] })
    expect(created).toMatchObject({ name: 'Risk Calculator', key: 'risk_calculator', status: 'draft', source_kind: 'inline', version: '1.0.0', tags: ['risk'] })
    expect(supabase.tables.custom_workflow_activities.find((row) => row.id === created.id)).toMatchObject({ tenant_id: 'tenant-a', created_by: 'user-1' })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ objectType: 'workflow_activity', action: 'create', objectId: created.id }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'workflow_activity', assetId: created.id, action: 'save' }))
  })

  it.each([
    ['no entry point', { source_code: 'const x = 1' }, 'source_code must expose'],
    ['no inputs', { manifest: { outputs: MANIFEST.outputs } }, 'manifest.inputs'],
    ['no outputs', { manifest: { inputs: MANIFEST.inputs } }, 'manifest.outputs'],
    ['bad status', { status: 'live' as never }, 'status must be one of'],
  ])('rejects %s with 400', async (_name, patch, message) => {
    const supabase = seed()
    await expect(activities.createWorkflowActivity(context(supabase), { name: 'Bad', source_code: SOURCE, manifest: MANIFEST, ...patch }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining(message) })
    expect(supabase.calls).toEqual([])
  })

  it('accepts the editor’s body-style source (top-level return)', async () => {
    const created = await activities.createWorkflowActivity(context(seed()), {
      name: 'Body style', source_code: "const band = 'green'\nreturn { outputs: { band } }", manifest: MANIFEST,
    })
    expect(created.key).toBe('body_style')
  })

  it('maps a duplicate key to 409', async () => {
    const supabase = seed()
    const failing = {
      from(table: string) {
        const query = supabase.from(table)
        if (table !== 'custom_workflow_activities') return query
        return { ...query, insert: () => ({ select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate key' } }) }) }) }
      },
    }
    const ctx = { ...context(supabase), supabase: failing as unknown as ServiceContext['supabase'] }
    await expect(activities.createWorkflowActivity(ctx, { name: 'Scorer', source_code: SOURCE, manifest: MANIFEST }))
      .rejects.toMatchObject({ status: 409, message: expect.stringContaining('"scorer"') })
  })

  it('updates only the given fields', async () => {
    const supabase = seed()
    const updated = await activities.updateWorkflowActivity(context(supabase), 'act-a', { description: 'Doubles the amount' })
    expect(updated).toMatchObject({ name: 'Scorer', key: 'scorer', status: 'active', description: 'Doubles the amount', source_code: SOURCE })
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'act-a', action: 'save' }))
  })

  it('deletes through the deletion queue with audit and sync', async () => {
    const supabase = seed()
    await expect(activities.deleteWorkflowActivity(context(supabase), 'act-a')).resolves.toEqual({ deleted: true, id: 'act-a' })
    expect(enqueueDeletionJob).toHaveBeenCalledWith(supabase, expect.objectContaining({ tenantId: 'tenant-a', targetType: 'workflow_activity', targetId: 'act-a' }))
    expect(processDeletionQueueBatch).toHaveBeenCalled()
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', objectId: 'act-a' }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetId: 'act-a', action: 'delete' }))

    vi.mocked(processDeletionQueueBatch).mockClear()
    await activities.deleteWorkflowActivity(context(supabase), 'act-a', { processInline: false })
    expect(processDeletionQueueBatch).not.toHaveBeenCalled()
  })

  it('bulk delete ignores ids outside the tenant', async () => {
    const result = await activities.bulkDeleteWorkflowActivities(context(seed()), ['act-a', 'act-b', 'nope'])
    expect(result).toEqual({ deleted: 1, ids: ['act-a'] })
    expect(enqueueDeletionJob).toHaveBeenCalledTimes(1)
  })

  it('round-trips export → import (JSON text or object, publish flag)', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const exported = await activities.exportWorkflowActivity(ctx, 'act-a')
    expect(exported).toMatchObject({ version: 1, asset_type: 'workflow_activity', workflow_activity: { name: 'Scorer', key: 'scorer', source_code: SOURCE } })
    expect(JSON.stringify(exported)).not.toContain('tenant-a')
    expect(JSON.stringify(exported)).not.toContain('act-a')

    // Import into another tenant (as a dev → prod copy would).
    const other = { ...ctx, tenantId: 'tenant-c' }
    const imported = await activities.importWorkflowActivity(other, exported)
    expect(imported).toMatchObject({ name: 'Scorer', key: 'scorer', status: 'active', source_code: SOURCE, tenant_id: 'tenant-c' })
    expect(imported.manifest.inputs.map((field: { name: string }) => field.name)).toEqual(['amount'])
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', metadata: expect.objectContaining({ imported: true }) }))

    const draft = await activities.importWorkflowActivity(other, JSON.stringify({ ...exported.workflow_activity, key: 'scorer_2', status: 'draft' }))
    expect(draft.status).toBe('draft')
    const published = await activities.importWorkflowActivity(other, { ...exported, workflow_activity: { ...exported.workflow_activity, key: 'scorer_3', status: 'draft' } }, { publish: true })
    expect(published.status).toBe('active')

    await expect(activities.importWorkflowActivity(ctx, 'not json')).rejects.toMatchObject({ status: 400 })
  })
})

describe('custom action execution (sandboxed)', () => {
  const engineCtx = (supabase: ReturnType<typeof createMemorySupabase>) => ({
    supabase, tenantId: 'tenant-a', variables: {} as Record<string, unknown>, liveBindings: {}, nodeResults: {} as Record<string, unknown>,
    executedNodes: new Set<string>(), executionTrace: [], logs: [] as Array<{ message: string }>, onEvent: () => {},
  })

  it('saving never runs the code; execution is on unless the operator switches it off', async () => {
    const supabase = seed()
    const created = await activities.createWorkflowActivity(context(supabase), {
      name: 'Side effect', source_code: 'globalThis.__ranActivity = true\nasync function run() { return {} }', manifest: MANIFEST,
    })
    expect(created.code_execution_enabled).toBe(true)
    expect((globalThis as Record<string, unknown>).__ranActivity).toBeUndefined()
    vi.stubEnv('CUSTOM_ACTIONS_DISABLED', 'true')
    expect((await activities.getWorkflowActivity(context(supabase), created.id)).code_execution_enabled).toBe(false)
  })

  it('the engine runs legacy activity code from the library in the sandbox — never the code in the node config', async () => {
    const supabase = seed()
    const node = {
      id: 'n1', type: 'custom_activity', label: 'Scorer', position: { x: 0, y: 0 },
      config: { custom_activity_id: 'act-a', source_code: 'async function run() { return { outputs: { score: -1 } } }', manifest: MANIFEST, input_mappings: { amount: '21' }, _output_prefix: 'scorer' },
    }
    const ctx = engineCtx(supabase)
    await __testing.executeNode(node as never, [node as never], [], ctx as never)
    const out = (ctx.nodeResults.n1 as { output: Record<string, unknown> }).output
    expect(out).toMatchObject({ activity_key: 'scorer', outputs: { score: 42 } })
    expect(ctx.variables.scorer_score).toBe(42)
  })

  it('a disabled action (kill switch) or CUSTOM_ACTIONS_DISABLED fails the step', async () => {
    const supabase = seed()
    supabase.tables.custom_workflow_activities[0].enabled = false
    const node = { id: 'n1', type: 'custom_activity', label: 'Scorer', position: { x: 0, y: 0 }, config: { custom_activity_id: 'act-a', input_mappings: { amount: '1' } } }
    await expect(__testing.executeNode(node as never, [node as never], [], engineCtx(supabase) as never)).rejects.toThrow(/disabled/)
    supabase.tables.custom_workflow_activities[0].enabled = true
    vi.stubEnv('CUSTOM_ACTIONS_DISABLED', 'true')
    await expect(__testing.executeNode(node as never, [node as never], [], engineCtx(supabase) as never)).rejects.toThrow(/switched off/)
  })

  it('legacy code cannot reach process or the host', async () => {
    const supabase = seed()
    supabase.tables.custom_workflow_activities[0].source_code = 'async function run() { return { outputs: { score: typeof process + typeof require + (() => { try { return typeof (0).constructor.constructor("return process")() } catch (e) { return "x" } })() } } }'
    const node = { id: 'n1', type: 'custom_activity', label: 'Scorer', position: { x: 0, y: 0 }, config: { custom_activity_id: 'act-a', input_mappings: { amount: '1' } } }
    const ctx = engineCtx(supabase)
    await __testing.executeNode(node as never, [node as never], [], ctx as never)
    const out = (ctx.nodeResults.n1 as { output: { outputs: Record<string, unknown> } }).output
    // The guest's own Function has no `process` either (ReferenceError → 'x').
    expect(out.outputs.score).toMatch(/^undefinedundefined(undefined|x)$/)
  })
})

describe('MCP workflow activity tools (service-backed)', () => {
  it('denies mutations without extensibility.* and audits once via the service', async () => {
    const supabase = seed()
    const mcp = createMcpServer({
      tenantId: 'tenant-a', supabase: supabase as never, actingUserId: 'user-1', keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] }, permissions: ['extensibility.view'],
    })
    const denied = await mcp.callTool('workflow_activities_delete', { workflow_activity_id: 'act-a' })
    expect(denied.isError).toBe(true)
    expect(denied.content[0].text).toContain('extensibility.delete')
    expect(enqueueDeletionJob).not.toHaveBeenCalled()

    const writer = createMcpServer({
      tenantId: 'tenant-a', supabase: supabase as never, actingUserId: 'user-1', keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] }, permissions: ALL,
    })
    const result = await writer.callTool('workflow_activities_delete', { workflow_activity_id: 'act-a' })
    expect(JSON.parse(result.content[0].text)).toEqual({ deleted: true, workflow_activity_id: 'act-a' })
    expect(vi.mocked(writeAudit).mock.calls.filter(([entry]) => entry.objectId === 'act-a')).toHaveLength(1)
  })
})

describe('packaged workflow actions (manifest v1)', () => {
  const V1 = (version = '1.0.0', extra: Record<string, unknown> = {}) => ({
    manifest_version: 1, key: 'acme_math', name: 'Acme math', version,
    operations: [{ id: 'add', sample: { a: 1, b: 2 }, inputs: [{ name: 'a', type: 'number', required: true }, { name: 'b', type: 'number', required: true }], outputs: [{ name: 'sum', type: 'number' }] }],
    ...extra,
  })
  const MOD = 'export default { operations: { add: (i, ctx) => ({ sum: i.a + i.b }) } }'

  it('upload creates the action, identical re-upload is unchanged, changed bytes for the same version are refused, a new version replaces', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const first = await activities.uploadWorkflowAction(ctx, { module: MOD, manifest: V1() })
    expect(first).toMatchObject({ outcome: 'created', version: '1.0.0', workflow_activity: { key: 'acme_math', runtime: 'module', enabled: true } })
    expect(supabase.tables.custom_workflow_activity_versions).toHaveLength(1)
    expect((await activities.uploadWorkflowAction(ctx, { module: MOD, manifest: V1() })).outcome).toBe('unchanged')
    await expect(activities.uploadWorkflowAction(ctx, { module: `${MOD}\n// v2`, manifest: V1() })).rejects.toMatchObject({ status: 409 })
    const second = await activities.uploadWorkflowAction(ctx, { module: `${MOD}\n// v2`, manifest: V1('1.1.0') })
    expect(second).toMatchObject({ outcome: 'version', workflow_activity: { version: '1.1.0' } })
    expect(supabase.tables.custom_workflow_activity_versions.map((v) => v.version).sort()).toEqual(['1.0.0', '1.1.0'])
  })

  it('upload refuses a module missing a declared operation', async () => {
    await expect(activities.uploadWorkflowAction(context(seed()), { module: 'export default { operations: { other: () => ({}) } } // add', manifest: V1() }))
      .rejects.toMatchObject({ status: 400, message: expect.stringContaining('operation "add" has no function') })
  })

  it('test runs the sample in the sandbox; kill switch and grants are checked', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const { workflow_activity: action } = await activities.uploadWorkflowAction(ctx, { module: MOD, manifest: V1('1.0.0', { capabilities: { http: { hosts: ['api.example.com'] }, data: { read: true } } }) })
    const result = await activities.testWorkflowActivity(ctx, action.id, {})
    expect(result).toMatchObject({ ok: true, operation: 'add', outputs: { sum: 3 } })
    await expect(activities.updateWorkflowActivity(ctx, action.id, { approved_hosts: ['evil.example.net'] })).rejects.toMatchObject({ status: 400 })
    const approved = await activities.updateWorkflowActivity(ctx, action.id, { approved_hosts: ['api.example.com'] })
    expect(approved.approved_hosts).toEqual(['api.example.com'])
    await expect(activities.updateWorkflowActivity(ctx, action.id, { data_grants: [{ table_id: 'nope', access: 'write' }] })).rejects.toMatchObject({ status: 400 })
    const disabled = await activities.updateWorkflowActivity(ctx, action.id, { enabled: false })
    expect(disabled.enabled).toBe(false)
    const node = { id: 'n1', type: 'custom_activity', label: 'Add', position: { x: 0, y: 0 }, config: { custom_activity_id: action.id, operation: 'add', input_mappings: { a: '1', b: '2' } } }
    const engineCtx = { supabase, tenantId: 'tenant-a', variables: {}, liveBindings: {}, nodeResults: {} as Record<string, unknown>, executedNodes: new Set<string>(), executionTrace: [], logs: [], onEvent: () => {} }
    await expect(__testing.executeNode(node as never, [node as never], [], engineCtx as never)).rejects.toThrow(/disabled/)
  })

  it('secrets: only declared names, encrypted, never returned', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const { workflow_activity: action } = await activities.uploadWorkflowAction(ctx, { module: MOD, manifest: V1('1.0.0', { capabilities: { credentials: [{ name: 'api_key' }] } }) })
    await expect(activities.setWorkflowActivitySecrets(ctx, action.id, { other: 'x' })).rejects.toMatchObject({ status: 400 })
    const { installEncryptionKey } = await import('@/lib/secret-crypto')
    installEncryptionKey('a'.repeat(64))
    const saved = await activities.setWorkflowActivitySecrets(ctx, action.id, { api_key: 'plain-value' })
    expect(saved.secrets).toEqual([{ name: 'api_key', label: 'Api key', set: true }])
    const stored = supabase.tables.custom_workflow_activity_secrets[0]
    expect(String(stored.value)).toMatch(/^enc:v/)
    expect(JSON.stringify(await activities.getWorkflowActivity(ctx, action.id))).not.toContain('plain-value')
  })

  it('delete is refused while a workflow uses the action', async () => {
    const supabase = seed()
    supabase.tables.workflows = [{ id: 'wf-1', tenant_id: 'tenant-a', name: 'Quotes', nodes: [{ id: 'n', type: 'custom_activity', label: 'Score', config: { custom_activity_id: 'act-a' } }] }]
    const usages = await activities.getWorkflowActivityUsages(context(supabase), 'act-a')
    expect(usages).toEqual([expect.objectContaining({ kind: 'workflow', id: 'wf-1', where: 'draft', node_label: 'Score' })])
    await expect(activities.deleteWorkflowActivity(context(supabase), 'act-a')).rejects.toMatchObject({ status: 409 })
    expect(enqueueDeletionJob).not.toHaveBeenCalled()
  })
})
