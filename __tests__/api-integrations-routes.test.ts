import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/reference-executor', () => ({
  executeReference: vi.fn(async () => ({ status: 201, data: { echoed: true } })),
}))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { GET as listIntegrations, POST as createIntegration } from '@/app/api/v1/integrations/route'
import { PATCH as patchIntegration } from '@/app/api/v1/integrations/[id]/route'
import { POST as importOpenApi } from '@/app/api/v1/integrations/import-openapi/route'
import { GET as listReferences } from '@/app/api/v1/integrations/[id]/references/route'
import { POST as executeReference } from '@/app/api/v1/references/[id]/execute/route'
import { POST as bulkDelete } from '@/app/api/v1/references/bulk-delete/route'
import { GET as connectorCatalog } from '@/app/api/v1/connectors/catalog/route'
import { GET as getConnector } from '@/app/api/v1/connectors/[id]/route'
import { POST as disableConnector } from '@/app/api/v1/connectors/[id]/disable/route'
import { createMemorySupabase } from './fixtures/supabase-memory'

const mockedValidate = vi.mocked(validateApiKey)
const ALL = [
  'integrations.view', 'integrations.create', 'integrations.edit', 'integrations.test',
  'integrations.delete', 'integrations.manage_references',
]

function authAs(supabase: ReturnType<typeof createMemorySupabase>, permissions = ALL) {
  mockedValidate.mockResolvedValue({
    success: true, tenantId: 'tenant-a', keyId: 'key-1', keyType: 'tenant', createdBy: 'u1', actingUserId: null,
    scopes: { workflow_ids: [], table_ids: [] }, permissions,
    supabase: supabase as unknown as ApiKeySuccessResult['supabase'], authKind: 'api_key', expiresAt: null,
  })
}

function req(path: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(`https://app.test/api/v1${path}`, {
    method: init?.method ?? 'GET',
    headers: { authorization: 'Bearer ut_test', 'content-type': 'application/json' },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  })
}
const params = (p: Record<string, string>) => ({ params: Promise.resolve(p) })

function seed() {
  return createMemorySupabase({
    integrations: [{ id: 'int-a', tenant_id: 'tenant-a', name: 'ERP', type: 'rest_api', config: { base_url: 'https://erp.example.com', auth_type: 'bearer', auth_config: { token: 'plain-token' } } }],
    integration_references: [{ id: 'ref-a', tenant_id: 'tenant-a', integration_id: 'int-a', name: 'Orders', request_config: {} }],
    tenant_connectors: [{ id: 'conn-a', tenant_id: 'tenant-a', connector_key: 'openai', display_name: 'OpenAI', integration_id: 'int-a', is_enabled: true, config: {}, credentials: { api_key: 'sk-secret' } }],
  })
}

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Echo API', version: '1' },
  servers: [{ url: 'https://echo.example.com' }],
  paths: { '/echo': { post: { operationId: 'echo', responses: { 200: { description: 'ok' } } } } },
}

beforeEach(() => mockedValidate.mockReset())

describe('/api/v1 integrations routes', () => {
  it('401 when the credential is rejected', async () => {
    mockedValidate.mockResolvedValue({ success: false, response: NextResponse.json({ success: false, error: 'Invalid API key' }, { status: 401 }) })
    const res = await listIntegrations(req('/integrations'))
    expect(res.status).toBe(401)
  })

  it('403 without the endpoint permission', async () => {
    authAs(seed(), ['integrations.view'])
    const res = await createIntegration(req('/integrations', { method: 'POST', body: { name: 'X', type: 'rest_api', config: {} } }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ success: false, code: 'forbidden' })
  })

  it('400 with field details for an invalid body', async () => {
    authAs(seed())
    const res = await createIntegration(req('/integrations', { method: 'POST', body: { name: '', type: 'ftp' } }))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.code).toBe('validation_error')
    expect(json.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['body.name', 'body.type', 'body.config']))
  })

  it('lists and creates integrations without leaking config', async () => {
    const supabase = seed()
    authAs(supabase)
    const created = await createIntegration(req('/integrations', {
      method: 'POST', body: { name: 'CRM', type: 'rest_api', config: { base_url: 'https://crm.example.com', auth_type: 'bearer', auth_config: { token: 't' } } },
    }))
    expect(created.status).toBe(201)
    expect((await created.json()).data.integration).toMatchObject({ name: 'CRM', type: 'rest_api' })

    const list = await listIntegrations(req('/integrations?limit=10'))
    const json = await list.json()
    expect(json.data.total).toBe(2)
    expect(JSON.stringify(json)).not.toContain('plain-token')
  })

  it('PATCH returns 404 for unknown ids', async () => {
    authAs(seed())
    const res = await patchIntegration(req('/integrations/nope', { method: 'PATCH', body: { name: 'x' } }), params({ id: 'nope' }))
    expect(res.status).toBe(404)
  })

  it('imports a raw OpenAPI document body with query overrides', async () => {
    const supabase = seed()
    authAs(supabase)
    const res = await importOpenApi(req('/integrations/import-openapi?name=Echo', { method: 'POST', body: SPEC }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data).toMatchObject({ integration: { name: 'Echo', type: 'rest_api' }, references_created: 1 })

    const wrapped = await importOpenApi(req('/integrations/import-openapi', { method: 'POST', body: { spec: SPEC, tags: [1] } }))
    expect(wrapped.status).toBe(400)
  })

  it('lists references, executes one and bulk-deletes', async () => {
    authAs(seed())
    const list = await listReferences(req('/integrations/int-a/references'), params({ id: 'int-a' }))
    expect((await list.json()).data).toMatchObject({ references: [{ id: 'ref-a' }], total: 1 })

    const exec = await executeReference(req('/references/ref-a/execute', { method: 'POST', body: { inputs: { a: 1 } } }), params({ id: 'ref-a' }))
    expect((await exec.json()).data).toMatchObject({ status: 201, data: { echoed: true } })

    const del = await bulkDelete(req('/references/bulk-delete', { method: 'POST', body: { ids: ['ref-a', 'ref-x'] } }))
    expect((await del.json()).data).toEqual({ deleted: 1, ids: ['ref-a'] })
  })

  it('serves the catalog, masks connector credentials and toggles state', async () => {
    const supabase = seed()
    authAs(supabase)
    const catalog = await (await connectorCatalog(req('/connectors/catalog?category=ai'))).json()
    expect(catalog.data.connectors.some((c: { key: string }) => c.key === 'openai')).toBe(true)

    const got = await getConnector(req('/connectors/conn-a'), params({ id: 'conn-a' }))
    const text = await got.text()
    expect(text).not.toContain('sk-secret')
    expect(text).not.toContain('plain-token')
    expect(JSON.parse(text).data.connector.credentials).toEqual({ api_key: '__SECRET__' })

    const off = await disableConnector(req('/connectors/conn-a/disable', { method: 'POST' }), params({ id: 'conn-a' }))
    expect((await off.json()).data).toEqual({ id: 'conn-a', enabled: false })
    expect(supabase.tables.integrations[0].is_active).toBe(false)
  })
})
