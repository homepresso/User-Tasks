/**
 * Extension SDK additions: ctx.connections (the extension's own connector
 * connections, origin-bound fetch through the connection's transport and
 * auth, anonymous probes), the licence helpers (assert, limit with usage
 * counters and units, assertLimit), per-endpoint / per-tool licence
 * features, ExtensionError mapping, design-time node options (optionsFrom)
 * and generated API references (toOpenApiDocument).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))
const apiAuth = vi.hoisted(() => ({ result: null as any }))
vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  validateApiKey: async () => apiAuth.result,
}))

import { NextRequest } from 'next/server'
import { defineEndpoint, defineExtension, defineServerExtension, ExtensionError, z } from '@user-tasks/extension-sdk'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { createExtensionContext } from '@/lib/extensions/host'
import { dispatchExtensionApi } from '@/lib/extensions/api'
import { extensionProblems } from '@/lib/extensions/server-registry'
import { guardsReferencing } from '@/lib/extensions/ui-server'
import { parseExtensionManifest } from '@/lib/extensions/manifest'
import { extensionCatalogEntry } from '@/lib/extensions/nodes'
import { registerTransport, resolveTransportFetch, TransportUnavailableError } from '@/lib/integrations/transports'
import { resolveConnectionUrl } from '@/lib/extensions/connections'
import { toOpenApiDocument, type ApiReferenceDoc } from '@/lib/extensions/api-reference'
import { usageFor, unregisterUsageCounter } from '@/lib/licensing/limits'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000a0001'
const OTHER_TENANT = '0e000000-0000-4000-8000-0000000a0002'
const CONN = '0e000000-0000-4000-8000-0000000ac001'
const PLAIN = '0e000000-0000-4000-8000-0000000ac002'
const FOREIGN = '0e000000-0000-4000-8000-0000000ac003'
const ELSEWHERE = '0e000000-0000-4000-8000-0000000ac004'

const manifest = {
  manifest_version: 1, id: 'acme', name: 'Acme', version: '1.0.0', publisher: { id: 'acme', name: 'Acme' },
  engines: { usertasks: '>=0.1.0 <2.0.0', extension_sdk: '^1.0.0' },
  licence: { tier: 'paid', sku: 'acme-pro', features: ['core', 'extra'] },
  deployments: ['cloud', 'self_hosted'],
  permissions: [{ key: 'use', label: 'Use acme', default_roles: ['owner'], implied_by: ['settings.edit'] }],
  contributes: {
    nodes: [{ key: 'step', label: 'Step', description: 'An acme step', feature: 'core', optionsFrom: { target: 'targets' }, inputs: [{ name: 'target', type: 'string' }], outputs: [] }],
    connectors: ['api'],
  },
}

const sent: Array<{ url: string; headers: Record<string, string> }> = []
registerTransport('testloop', async () => (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  sent.push({ url, headers: Object.fromEntries(new Headers(init?.headers).entries()) })
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
}) as typeof fetch)

const counted = { farms: new Set(['farm-a']) }
const definition = defineExtension({ manifest, connectors: [{ key: 'api', name: 'Acme API', description: 'x', category: 'productivity', icon: 'Box', color: '#000000', fields: [], credentialFields: [], referenceTemplates: [], buildIntegrationConfig: () => ({ base_url: 'https://acme.example', auth_type: 'none', auth_config: {} }) }] })
const server = defineServerExtension({
  id: 'acme',
  nodes: { step: async () => ({}) },
  usageCounters: {
    'acme.farms': async ({ unit }) => new Set([...counted.farms, ...(unit ? [unit] : [])]).size,
  },
  endpoints: [
    {
      feature: 'extra',
      endpoint: defineEndpoint({ method: 'GET', path: '/extra', operationId: 'extra', tags: ['Acme'], summary: 'Needs the extra feature', permission: null }),
      handler: async () => ({ ok: true }),
    },
    {
      endpoint: defineEndpoint({ method: 'POST', path: '/boom', operationId: 'boom', tags: ['Acme'], summary: 'Fails', permission: null, body: z.object({ status: z.number() }) }),
      handler: async ({ body }) => { throw new ExtensionError('precondition_failed', 'Changed since read', body.status, { field: 'x' }) },
    },
  ],
  ui: { data: { targets: async () => ({ options: [{ value: 'a', label: 'A' }] }) } },
})

let decision: any = { allowed: true, state: 'licensed', limits: { 'acme.farms': 2 } }
const deniedFeatures = new Set<string>()

beforeEach(() => {
  sent.length = 0
  counted.farms = new Set(['farm-a'])
  decision = { allowed: true, state: 'licensed', limits: { 'acme.farms': 2 } }
  deniedFeatures.clear()
  db.current = createMemorySupabase({
    tenant_extensions: [{ tenant_id: TENANT, extension_id: 'acme', enabled: true, config: {}, secrets: {}, config_version: 1 }],
    integrations: [
      { id: CONN, tenant_id: TENANT, name: 'B conn', type: 'ext.acme.api', is_active: true, config: { base_url: 'https://acme.example/root', auth_type: 'bearer', auth_config: { token: 'secret-token', mode: 'ntlm', username: 'CORP\\svc', _transport: 'testloop' }, headers: { 'X-Default': 'yes', db_type: 'skip' } } },
      { id: PLAIN, tenant_id: TENANT, name: 'A plain', type: 'ext.acme.api', is_active: true, config: { base_url: 'https://plain.example', auth_type: 'bearer', auth_config: { token: 't2' } } },
      { id: FOREIGN, tenant_id: TENANT, name: 'Slack', type: 'slack', is_active: true, config: { base_url: 'https://slack.com', auth_type: 'bearer', auth_config: { token: 'x' } } },
      { id: ELSEWHERE, tenant_id: OTHER_TENANT, name: 'Other ws', type: 'ext.acme.api', is_active: true, config: { base_url: 'https://acme.example' } },
    ],
  }, { uuids: true })
  registerExtensionsForTest({ definitions: [definition], servers: [server] })
  setEntitlementPort({ async check({ feature }) { return feature && deniedFeatures.has(feature) ? { allowed: false, state: 'unlicensed', reason: `no ${feature}` } : decision } })
})
afterEach(() => {
  resetExtensionsForTest()
  unregisterUsageCounter('acme.farms')
})

const ctx = () => createExtensionContext({ extensionId: 'acme', tenantId: TENANT, actorId: null })

describe('ctx.connections', () => {
  it('lists and gets only this extension\'s connections in the workspace, without secrets', async () => {
    const list = await ctx().connections.list()
    expect(list.map((c) => c.id)).toEqual([PLAIN, CONN])
    const conn = list.find((c) => c.id === CONN)!
    expect(conn).toMatchObject({ connector: 'ext.acme.api', baseUrl: 'https://acme.example/root', authType: 'bearer', transport: 'testloop', authSummary: { mode: 'ntlm', username: 'CORP\\svc' } })
    expect(JSON.stringify(conn)).not.toContain('secret-token')
    expect(await ctx().connections.get(FOREIGN)).toBeNull()
    expect(await ctx().connections.get(ELSEWHERE)).toBeNull()
    expect(await ctx().connections.get('not-a-uuid')).toBeNull()
    expect((await ctx().connections.list({ connector: 'api' })).length).toBe(2)
  })

  it('fetches through the connection transport with its auth and default headers, bound to its origin', async () => {
    const res = await ctx().connections.fetch(CONN, '/_api/web?x=1', { headers: { Accept: 'application/json' } })
    expect(res.status).toBe(200)
    expect(sent[0].url).toBe('https://acme.example/root/_api/web?x=1')
    expect(sent[0].headers).toMatchObject({ authorization: 'Bearer secret-token', 'x-default': 'yes', accept: 'application/json' })
    expect(sent[0].headers.db_type).toBeUndefined()
    await ctx().connections.fetch(CONN, 'https://acme.example/other')
    expect(sent[1].url).toBe('https://acme.example/other')
    await expect(ctx().connections.fetch(CONN, 'https://evil.example/x')).rejects.toThrow(/only sent to https:\/\/acme\.example/)
    await expect(ctx().connections.fetch(FOREIGN, '/x')).rejects.toThrow(/not found/)
  })

  it('anonymous probes send no credentials and refuse transports that cannot do it', async () => {
    await expect(ctx().connections.fetch(CONN, '/probe', {}, { anonymous: true })).rejects.toBeInstanceOf(TransportUnavailableError)
    const fetchSpy = vi.fn(async () => new Response('', { status: 401, headers: { 'www-authenticate': 'Bearer realm="r"' } }))
    vi.stubGlobal('fetch', fetchSpy)
    try {
      const res = await ctx().connections.fetch(PLAIN, '/probe', { headers: { Authorization: 'Bearer' } }, { anonymous: true, retry: 'never' })
      expect(res.status).toBe(401)
      const headers = new Headers((fetchSpy.mock.calls[0] as any)[1].headers)
      expect(headers.get('authorization')).toBe('Bearer')
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('windows connections can be probed anonymously without a password', async () => {
    const f = await resolveTransportFetch({ tenantId: null, integrationConfig: { base_url: 'https://sp.example', auth_type: 'windows', auth_config: { mode: 'ntlm' } }, anonymous: true })
    expect(typeof f).toBe('function')
    await expect(resolveTransportFetch({ tenantId: null, integrationConfig: { base_url: 'https://sp.example', auth_type: 'windows', auth_config: { mode: 'ntlm' } } })).rejects.toThrow(/username is required/)
  })

  it('resolves relative URLs against the base path', () => {
    expect(resolveConnectionUrl('https://a.example/sites/x', '_api/web').href).toBe('https://a.example/sites/x/_api/web')
    expect(resolveConnectionUrl('https://a.example/sites/x/', '/_api/web').href).toBe('https://a.example/sites/x/_api/web')
  })
})

describe('ctx.can', () => {
  it('checks the caller\'s permissions (implied extension permissions included); system callers hold everything', () => {
    expect(createExtensionContext({ extensionId: 'acme', tenantId: TENANT, permissions: ['ext.acme.use'] }).can('ext.acme.use')).toBe(true)
    expect(createExtensionContext({ extensionId: 'acme', tenantId: TENANT, permissions: new Set(['tasks.view_own']) }).can('ext.acme.use')).toBe(false)
    expect(createExtensionContext({ extensionId: 'acme', tenantId: TENANT, permissions: ['settings.edit'] }).can('ext.acme.use')).toBe(true)
    expect(ctx().can('anything')).toBe(true)
  })
})

describe('ctx.licence', () => {
  it('assert throws the 402 licence errors', async () => {
    await expect(ctx().licence.assert('core')).resolves.toBeUndefined()
    deniedFeatures.add('extra')
    await expect(ctx().licence.assert('extra')).rejects.toMatchObject({ code: 'extension_not_licensed', status: 402 })
    decision = { allowed: false, state: 'expired', reason: 'expired' }
    await expect(ctx().licence.assert()).rejects.toMatchObject({ code: 'extension_licence_expired', retryable: true })
  })

  it('limits count with the registered counter; a unit already counted adds nothing', async () => {
    expect(await ctx().licence.limit('acme.farms', { adding: 0 })).toMatchObject({ allowed: true, usage: 1, limit: 2 })
    counted.farms.add('farm-b')
    expect(await ctx().licence.limit('acme.farms', { unit: 'farm-a' })).toMatchObject({ allowed: true, usage: 2 })
    await expect(ctx().licence.assertLimit('acme.farms', { unit: 'farm-c' })).rejects.toMatchObject({ code: 'extension_limit_reached', status: 402 })
    expect(await ctx().licence.assertLimit('acme.farms', { unit: 'farm-b' })).toMatchObject({ allowed: true })
    await expect(ctx().licence.limit('other.farms')).rejects.toThrow(/namespaced/)
    expect(await usageFor(['acme.farms'])).toEqual({ 'acme.farms': 2 })
  })
})

describe('REST: features and ExtensionError', () => {
  function call(method: string, path: string, body?: unknown) {
    apiAuth.result = { success: true, tenantId: TENANT, userId: null, permissions: null, scopes: null, supabase: db.current, keyId: 'k', credentialOwnerId: null }
    return dispatchExtensionApi(new NextRequest(`http://localhost/api/v1/ext/acme${path}`, { method, headers: { authorization: 'Bearer x', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), 'acme', path.slice(1).split('/'))
  }

  it('checks the endpoint feature with the workspace gate', async () => {
    expect((await call('GET', '/extra')).status).toBe(200)
    deniedFeatures.add('extra')
    const res = await call('GET', '/extra')
    expect(res.status).toBe(402)
    expect((await res.json()).code).toBe('extension_not_licensed')
  })

  it('maps ExtensionError to its status and code', async () => {
    const res = await call('POST', '/boom', { status: 412 })
    expect(res.status).toBe(412)
    expect(await res.json()).toMatchObject({ success: false, code: 'precondition_failed', error: 'Changed since read' })
  })
})

describe('structural checks and node options', () => {
  it('flags undeclared features and un-namespaced counters', () => {
    registerExtensionsForTest({ definitions: [definition], servers: [{ ...server, usageCounters: { farms: async () => 1 }, endpoints: [{ ...server.endpoints![0], feature: 'nope' }] }] })
    const problems = extensionProblems().join('\n')
    expect(problems).toMatch(/feature "nope" is not declared/)
    expect(problems).toMatch(/usage counter "farms" must be named "acme\.<name>"/)
  })

  it('validates optionsFrom and lets workflow editors read the source', () => {
    expect(() => parseExtensionManifest({ ...manifest, contributes: { ...manifest.contributes, nodes: [{ ...manifest.contributes.nodes[0], optionsFrom: { missing: 'targets' } }] } })).toThrow(/optionsFrom names "missing"/)
    const parsed = parseExtensionManifest(manifest)
    expect(extensionCatalogEntry('ext.acme.step')?.optionsFrom).toEqual({ target: 'targets' })
    expect(guardsReferencing(parsed, { kind: 'data', name: 'targets' })).toEqual([{ anyPermission: ['workflows.edit', 'workflows.create'], feature: 'core' }])
  })
})

describe('generated API references', () => {
  it('exports OpenAPI 3.0 with typed schemas and parameters', () => {
    const doc: ApiReferenceDoc = {
      title: 'Orders', version: '3', baseUrl: '/api/v1/ext/acme/lists/1',
      groups: [{ id: 'items', title: 'Items', operations: [
        { id: 'get_item', method: 'GET', path: '/items/{id}', summary: 'Get', params: [{ name: 'id', in: 'path', type: 'integer', required: true }, { name: 'select', in: 'query', type: 'string' }], responseSchema: 'Item' },
        { id: 'create_item', method: 'POST', path: '/items', summary: 'Create', params: [{ name: 'fields', in: 'body', type: 'object', required: true }], requestExample: { fields: { Title: 'x' } } },
      ] }],
      schemas: [{ name: 'Item', fields: [{ name: 'Title', type: 'string', required: true }, { name: 'Total', type: 'number', readOnly: true }, { name: 'Tags', type: 'array', items: 'string', enum: ['a', 'b'] }] }],
    }
    const out = toOpenApiDocument(doc) as any
    expect(out.openapi).toBe('3.0.3')
    expect(out.servers).toEqual([{ url: '/api/v1/ext/acme/lists/1' }])
    expect(out.paths['/items/{id}'].get.parameters).toEqual([
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'select', in: 'query', required: false, schema: { type: 'string' } },
    ])
    expect(out.paths['/items'].post.requestBody.content['application/json'].schema.required).toEqual(['fields'])
    expect(out.components.schemas.Item).toEqual({ type: 'object', properties: { Title: { type: 'string' }, Total: { type: 'number', readOnly: true }, Tags: { type: 'array', items: { type: 'string', enum: ['a', 'b'] } } }, required: ['Title'] })
  })
})
