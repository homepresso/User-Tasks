import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // 32-byte key so encryptSensitiveFields really encrypts in these tests.
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64')
})

vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
  processDeletionQueueBatch: vi.fn(async () => ({ processed: 0, results: [] })),
}))
vi.mock('@/lib/reference-executor', () => ({
  executeReference: vi.fn(async () => ({ status: 200, data: { ok: true } })),
}))

import { writeAudit } from '@/lib/audit-log'
import { recordAssetChange } from '@/lib/github-sync/enqueue'
import { enqueueDeletionJob, processDeletionQueueBatch } from '@/lib/deletion-queue'
import { executeReference as runReference } from '@/lib/reference-executor'
import { encryptSensitiveFields } from '@/lib/secret-fields'
import { createMcpServer } from '@/lib/mcp/server'
import type { ServiceContext } from '@/lib/services/context'
import * as integrations from '@/lib/services/integrations'
import * as references from '@/lib/services/references'
import * as objects from '@/lib/services/objects'
import * as connectors from '@/lib/services/connectors'
import { createMemorySupabase } from './fixtures/supabase-memory'

const ALL = [
  'integrations.view', 'integrations.create', 'integrations.edit', 'integrations.test',
  'integrations.delete', 'integrations.manage_references',
]

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

const page = { limit: 50, offset: 0 }

function seed() {
  return createMemorySupabase({
    integrations: [
      {
        id: 'int-a', tenant_id: 'tenant-a', name: 'ERP', type: 'rest_api', is_active: true,
        config: encryptSensitiveFields({ base_url: 'https://erp.example.com', auth_type: 'bearer', auth_config: { token: 'tok-plain' } }),
      },
      { id: 'int-b', tenant_id: 'tenant-b', name: 'Other', type: 'rest_api', is_active: true, config: { base_url: 'https://b.example.com' } },
    ],
    integration_references: [
      { id: 'ref-a', tenant_id: 'tenant-a', integration_id: 'int-a', name: 'Get orders', request_config: { method: 'GET', path_template: '/orders' } },
      { id: 'ref-b', tenant_id: 'tenant-b', integration_id: 'int-b', name: 'Foreign', request_config: {} },
    ],
    tenant_connectors: [
      {
        id: 'conn-a', tenant_id: 'tenant-a', connector_key: 'openai', display_name: 'OpenAI', integration_id: 'int-a', is_enabled: true,
        config: { default_model: 'gpt-4o-mini' }, credentials: encryptSensitiveFields({ api_key: 'sk-live-secret' }),
      },
      { id: 'conn-gh', tenant_id: 'tenant-a', connector_key: 'github_sync', is_enabled: true, config: {}, credentials: { token: 'ghp' } },
    ],
  })
}

beforeEach(() => {
  vi.mocked(writeAudit).mockClear()
  vi.mocked(recordAssetChange).mockClear()
  vi.mocked(enqueueDeletionJob).mockClear()
  vi.mocked(processDeletionQueueBatch).mockClear()
  vi.mocked(runReference).mockClear()
})

describe('integration services: permissions', () => {
  it.each([
    ['listIntegrations', (ctx: ServiceContext) => integrations.listIntegrations(ctx, {}, page)],
    ['createIntegration', (ctx: ServiceContext) => integrations.createIntegration(ctx, { name: 'X', type: 'rest_api', config: { base_url: 'https://x.test' } })],
    ['deleteIntegration', (ctx: ServiceContext) => integrations.deleteIntegration(ctx, 'int-a')],
    ['createReference', (ctx: ServiceContext) => references.createReference(ctx, 'int-a', { name: 'r' })],
    ['executeReference', (ctx: ServiceContext) => references.executeReference(ctx, 'ref-a', {})],
    ['createObject', (ctx: ServiceContext) => objects.createObject(ctx, { name: 'o', sources: [] })],
    ['createConnector', (ctx: ServiceContext) => connectors.createConnector(ctx, { connector_key: 'openai' })],
    ['regenerateConnectorReferences', (ctx: ServiceContext) => connectors.regenerateConnectorReferences(ctx, 'conn-a')],
  ])('%s throws 403 without its permission and touches nothing', async (_name, call) => {
    const supabase = seed()
    await expect(call(context(supabase, []))).rejects.toMatchObject({ code: 'forbidden', status: 403 })
    expect(supabase.calls).toEqual([])
  })

  it('regenerating references needs manage_references, not just edit', async () => {
    const supabase = seed()
    await expect(connectors.regenerateConnectorReferences(context(supabase, ['integrations.edit']), 'conn-a'))
      .rejects.toMatchObject({ status: 403 })
  })
})

describe('integration services: tenant isolation', () => {
  it('lists only the caller tenant', async () => {
    const result = await integrations.listIntegrations(context(seed()), {}, page)
    expect(result.integrations.map((row) => row.id)).toEqual(['int-a'])
    expect(result.total).toBe(1)
  })

  it('treats another tenant’s rows as not found', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await expect(integrations.getIntegration(ctx, 'int-b')).rejects.toMatchObject({ status: 404 })
    await expect(integrations.updateIntegration(ctx, 'int-b', { name: 'pwn' })).rejects.toMatchObject({ status: 404 })
    await expect(references.createReference(ctx, 'int-b', { name: 'x' })).rejects.toMatchObject({ status: 404 })
    await expect(references.executeReference(ctx, 'ref-b', {})).rejects.toMatchObject({ status: 404 })
    expect(runReference).not.toHaveBeenCalled()
    expect(supabase.tables.integrations.find((row) => row.id === 'int-b')?.name).toBe('Other')
  })

  it('bulk delete ignores ids from other tenants', async () => {
    const supabase = seed()
    const result = await references.bulkDeleteReferences(context(supabase), ['ref-a', 'ref-b', 'ref-a'])
    expect(result).toEqual({ deleted: 1, ids: ['ref-a'] })
    expect(supabase.tables.integration_references.map((row) => row.id)).toEqual(['ref-b'])
  })

  it('hides the GitHub-sync connection from connector endpoints', async () => {
    const ctx = context(seed())
    const listed = await connectors.listConnectors(ctx, {}, page)
    expect(listed.connectors.map((row) => row.id)).toEqual(['conn-a'])
    await expect(connectors.getConnector(ctx, 'conn-gh')).rejects.toMatchObject({ status: 404 })
    await expect(connectors.deleteConnector(ctx, 'conn-gh')).rejects.toMatchObject({ status: 404 })
  })

  it('executes references pinned to the caller tenant', async () => {
    const result = await references.executeReference(context(seed()), 'ref-a', { id: '1' })
    expect(result).toMatchObject({ status: 200, data: { ok: true } })
    expect(runReference).toHaveBeenCalledWith(expect.objectContaining({ referenceId: 'ref-a', expectedTenantId: 'tenant-a' }))
  })
})

describe('integration services: secrets', () => {
  it('encrypts credentials at rest on create', async () => {
    const supabase = seed()
    await integrations.createIntegration(context(supabase), {
      name: 'Billing', type: 'rest_api',
      config: { base_url: 'https://billing.example.com/', auth_type: 'api_key', auth_config: { key_name: 'X-Key', key_value: 'k-plain' } },
    })
    const row = supabase.tables.integrations.find((r) => r.name === 'Billing')!
    expect(row.config.base_url).toBe('https://billing.example.com')
    expect(row.config.auth_config.key_name).toBe('X-Key')
    expect(row.config.auth_config.key_value).toMatch(/^enc:v1:/)
    expect(JSON.stringify(row)).not.toContain('k-plain')
  })

  it('masks integration config and keeps the stored secret when the mask is sent back', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const got = await integrations.getIntegration(ctx, 'int-a')
    expect(got.config).toEqual({ base_url: 'https://erp.example.com', auth_type: 'bearer', auth_config: { token: '__SECRET__' } })
    expect(got.references.map((ref: { id: string }) => ref.id)).toEqual(['ref-a'])

    const before = supabase.tables.integrations.find((r) => r.id === 'int-a')!.config.auth_config.token
    await integrations.updateIntegration(ctx, 'int-a', { config: { ...got.config, headers: { 'X-Trace': '1' } } })
    const after = supabase.tables.integrations.find((r) => r.id === 'int-a')!.config
    expect(after.auth_config.token).toBe(before)
    expect(after.headers).toEqual({ 'X-Trace': '1' })
  })

  it('never returns connector credentials, decrypted or encrypted', async () => {
    const ctx = context(seed())
    const got = await connectors.getConnector(ctx, 'conn-a')
    expect(got.connector.credentials).toEqual({ api_key: '__SECRET__' })
    expect(got.connector.config).toEqual({ default_model: 'gpt-4o-mini' })
    const listed = await connectors.listConnectors(ctx, {}, page)
    for (const payload of [got, listed]) {
      const text = JSON.stringify(payload)
      expect(text).not.toContain('sk-live-secret')
      expect(text).not.toContain('enc:v1:')
    }
  })

  it('merges connector credentials on update and keeps masked values', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    await connectors.updateConnector(ctx, 'conn-a', { credentials: { api_key: '__SECRET__' }, config: { default_max_tokens: '2048' } })
    const row = supabase.tables.tenant_connectors.find((r) => r.id === 'conn-a')!
    expect(row.config).toEqual({ default_model: 'gpt-4o-mini', default_max_tokens: '2048' })
    expect(row.credentials.api_key).toMatch(/^enc:v1:/)
    const integration = supabase.tables.integrations.find((r) => r.id === 'int-a')!
    expect(JSON.stringify(integration.config)).not.toContain('sk-live-secret')
  })

  it('rejects connectors with missing required credentials', async () => {
    await expect(connectors.createConnector(context(seed()), { connector_key: 'openai', credentials: {} }))
      .rejects.toMatchObject({ status: 400 })
    await expect(connectors.createConnector(context(seed()), { connector_key: 'nope' }))
      .rejects.toMatchObject({ status: 400, message: 'Unknown connector: nope' })
  })
})

describe('integration services: side effects', () => {
  it('audits and queues GitHub sync on create, and uses the deletion queue on delete', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const created = await integrations.createIntegration(ctx, { name: 'CRM', type: 'rest_api', config: { base_url: 'https://crm.example.com' } })
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-a', actorId: 'user-1', objectType: 'integration', objectId: created.id, action: 'create',
      metadata: expect.objectContaining({ via: 'api' }),
    }))
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'integration', assetId: created.id, action: 'save' }))

    await integrations.deleteIntegration(ctx, created.id)
    expect(enqueueDeletionJob).toHaveBeenCalledWith(supabase, expect.objectContaining({ tenantId: 'tenant-a', targetType: 'integration', targetId: created.id }))
    expect(processDeletionQueueBatch).toHaveBeenCalled()
    expect(recordAssetChange).toHaveBeenCalledWith(expect.objectContaining({ assetType: 'integration', assetId: created.id, action: 'delete' }))
  })

  it('syncs references and puts method into request_config', async () => {
    const supabase = seed()
    const ctx = context(supabase)
    const ref = await references.createReference(ctx, 'int-a', { name: 'Create order', method: 'post', path_template: '/orders' })
    expect(supabase.tables.integration_references.find((r) => r.id === ref.id)!.request_config).toMatchObject({ method: 'POST', path_template: '/orders' })
    await references.updateReference(ctx, ref.id, { method: 'put' })
    expect(supabase.tables.integration_references.find((r) => r.id === ref.id)!.request_config).toMatchObject({ method: 'PUT', path_template: '/orders' })
    await references.deleteReference(ctx, ref.id)
    expect(vi.mocked(recordAssetChange).mock.calls.map(([p]) => `${p.assetType}:${p.action}`)).toEqual(['reference:save', 'reference:save', 'reference:delete'])
    expect(vi.mocked(writeAudit).mock.calls.map(([p]) => `${p.objectType}:${p.action}`))
      .toEqual(['integration_reference:create', 'integration_reference:update', 'integration_reference:delete'])
  })

  it('imports an OpenAPI document into an integration with references', async () => {
    const supabase = seed()
    const result = await integrations.importOpenApi(context(supabase), {
      spec: {
        openapi: '3.0.0', info: { title: 'Pets', version: '1' }, servers: [{ url: 'https://pets.example.com' }],
        paths: { '/pets': { get: { operationId: 'listPets', responses: { 200: { description: 'ok' } } } }, '/pets/{id}': { get: { operationId: 'getPet', responses: {} } } },
      },
      selected_reference_indexes: [1],
    })
    expect(result.integration).toMatchObject({ name: 'Pets', type: 'rest_api' })
    expect(result.references_created).toBe(1)
    expect(supabase.tables.integration_references.filter((r) => r.integration_id === result.integration.id)).toHaveLength(1)
    await expect(integrations.importOpenApi(context(supabase), { spec: 'not a spec' })).rejects.toMatchObject({ status: 400 })
  })

  it('rejects insecure base URLs and blocks private egress on test', async () => {
    const ctx = context(seed())
    await expect(integrations.createIntegration(ctx, { name: 'X', type: 'rest_api', config: { base_url: 'http://example.com' } }))
      .rejects.toMatchObject({ status: 400 })
    const supabase = createMemorySupabase({
      integrations: [{ id: 'int-meta', tenant_id: 'tenant-a', name: 'Meta', type: 'rest_api', config: { base_url: 'http://169.254.169.254/latest' } }],
    })
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const result = await integrations.testIntegration(context(supabase), 'int-meta')
    expect(result).toMatchObject({ status: 'error', reachable: false })
    expect(result.message).toMatch(/not allowed/)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(supabase.tables.integrations[0].last_test_status).toBe('error')
    fetchSpy.mockRestore()
  })

  it('validates object sources and their tenant ownership', async () => {
    const supabase = createMemorySupabase({ custom_tables: [{ id: 'tbl-b', tenant_id: 'tenant-b', columns: [] }] })
    const ctx = context(supabase)
    await expect(objects.createObject(ctx, { name: 'o', sources: [{ sourceType: 'table', tableId: 'tbl-b', alias: 'a', isPrimary: true }] }))
      .rejects.toMatchObject({ status: 400, message: 'Data table not found: tbl-b' })
    await expect(objects.createObject(ctx, { name: 'o', sources: [{ source_type: 'table', table_id: 'tbl-b', alias: 'a' }] }))
      .rejects.toMatchObject({ message: 'Exactly one primary source is required' })
  })
})

describe('MCP integration tools on services', () => {
  it('audits a mutation once (in the service, not again in authz)', async () => {
    const supabase = seed()
    const server = createMcpServer({
      tenantId: 'tenant-a', supabase, actingUserId: 'user-1', keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] }, permissions: ALL,
    })
    const result = await server.callTool('integrations_create', {
      name: 'Via MCP', type: 'rest_api', config: JSON.stringify({ base_url: 'https://mcp.example.com' }),
    })
    expect(result?.isError).not.toBe(true)
    expect(writeAudit).toHaveBeenCalledTimes(1)
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ via: 'mcp' }) }))
  })

  it('denies mutations and reads without the permission; reads need integrations.view', async () => {
    const server = createMcpServer({
      tenantId: 'tenant-a', supabase: seed(), actingUserId: 'user-1', keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] }, permissions: [],
    })
    const denied = await server.callTool('references_delete', { reference_id: 'ref-a' })
    expect(denied?.isError).toBe(true)
    const deniedRead = await server.callTool('connectors_get', { connector_id: 'conn-a' })
    expect(deniedRead?.isError).toBe(true)
    expect(deniedRead!.content[0].text).toContain('integrations.view')

    const viewer = createMcpServer({
      tenantId: 'tenant-a', supabase: seed(), actingUserId: 'user-1', keyType: 'tenant',
      scopes: { workflow_ids: [], table_ids: [] }, permissions: ['integrations.view'],
    })
    const read = await viewer.callTool('connectors_get', { connector_id: 'conn-a' })
    expect(read?.isError).not.toBe(true)
    const text = read!.content[0].text as string
    expect(text).not.toContain('sk-live-secret')
    expect(JSON.parse(text).connector.credentials).toEqual({ api_key: '__SECRET__' })
  })
})
