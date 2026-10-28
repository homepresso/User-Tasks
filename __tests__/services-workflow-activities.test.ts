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

describe('custom activity code gate', () => {
  it('saving reports whether execution is enabled and never runs the code', async () => {
    const supabase = seed()
    const created = await activities.createWorkflowActivity(context(supabase), {
      name: 'Side effect', source_code: 'globalThis.__ranActivity = true\nasync function run() { return {} }', manifest: MANIFEST,
    })
    expect(created.code_execution_enabled).toBe(false)
    expect((globalThis as Record<string, unknown>).__ranActivity).toBeUndefined()
    vi.stubEnv('ENABLE_CUSTOM_ACTIVITY_CODE', 'true')
    expect((await activities.getWorkflowActivity(context(supabase), created.id)).code_execution_enabled).toBe(true)
  })

  it('the engine refuses to execute activity code unless ENABLE_CUSTOM_ACTIVITY_CODE=true', async () => {
    vi.stubEnv('ENABLE_CUSTOM_ACTIVITY_CODE', '')
    const node = {
      id: 'n1', type: 'custom_activity', label: 'Scorer', position: { x: 0, y: 0 },
      config: { custom_activity_id: 'act-a', source_code: SOURCE, manifest: MANIFEST },
    }
    const ctx = {
      supabase: seed(), tenantId: 'tenant-a', variables: {}, liveBindings: {}, nodeResults: {} as Record<string, unknown>,
      executedNodes: new Set<string>(), executionTrace: [], logs: [], onEvent: () => {},
    }
    await expect(__testing.executeNode(node as never, [node as never], [], ctx as never)).rejects.toThrow('Custom activity code execution is disabled')
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
