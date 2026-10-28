import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/api-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-auth')>()
  return { ...actual, validateApiKey: vi.fn() }
})
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))
vi.mock('@/lib/github-sync/enqueue', () => ({ recordAssetChange: vi.fn(async () => {}) }))
vi.mock('@/lib/deletion-queue', () => ({
  enqueueDeletionJob: vi.fn(async () => {}),
  kickDeletionProcessor: vi.fn(),
  processDeletionQueueBatch: vi.fn(async () => ({ processed: 0, results: [] })),
}))

import { validateApiKey, type ApiKeySuccessResult } from '@/lib/api-auth'
import { prepareRoundTripBody } from '@/lib/api-schemas/registry'
import { decisionTableUpdateBody } from '@/lib/api-schemas/decision-tables'
import { PERMISSION_KEYS } from '@/lib/permissions'
import * as workflowsRoute from '@/app/api/v1/workflows/[id]/route'
import * as workflowDefinitionRoute from '@/app/api/v1/workflows/[id]/definition/route'
import * as workflowPublishRoute from '@/app/api/v1/workflows/[id]/publish/route'
import * as workflowCollectionRoute from '@/app/api/v1/workflows/route'
import * as integrationRoute from '@/app/api/v1/integrations/[id]/route'
import * as referenceRoute from '@/app/api/v1/references/[id]/route'
import * as objectRoute from '@/app/api/v1/objects/[id]/route'
import * as decisionTableRoute from '@/app/api/v1/decision-tables/[id]/route'
import * as emailTemplateRoute from '@/app/api/v1/email-templates/[id]/route'
import * as activityRoute from '@/app/api/v1/workflow-activities/[id]/route'
import * as dataTableRoute from '@/app/api/v1/data-tables/[id]/route'
import * as webhookRoute from '@/app/api/v1/webhooks/[id]/route'
import * as agentRoute from '@/app/api/v1/agents/[id]/route'
import * as reportRoute from '@/app/api/v1/reports/[id]/route'
import * as retentionRoute from '@/app/api/v1/retention-policies/[id]/route'
import { createMcpServer } from '@/lib/mcp/server'
import { createMemorySupabase } from './fixtures/supabase-memory'

/**
 * Edit round trip: what a GET returns must be accepted, unedited, by the
 * matching update and change nothing (and an edit to it must stick). This is
 * the `usertasks <resource> get <id> -o json > x.json` → `update <id> -f x.json` flow.
 */

const mockedValidate = vi.mocked(validateApiKey)
type Memory = ReturnType<typeof createMemorySupabase>

function authAs(supabase: Memory, permissions: string[] = [...PERMISSION_KEYS]) {
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
type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>

const NODES = [
  { id: 'trigger', type: 'manual', label: 'Manual', position: { x: 0, y: 0 }, config: {}, width: 220 },
  { id: 'log-1', type: 'log', label: 'Log', position: { x: 0, y: 120 }, config: { message: 'hi', level: 'info' } },
]
const EDGES = [{ id: 'e1', source: 'trigger', target: 'log-1' }]

function seed(): Memory {
  return createMemorySupabase({
    workflows: [{
      id: 'wf-a', tenant_id: 'tenant-a', name: 'Approve', description: null, trigger_type: 'manual', trigger_config: null,
      nodes: NODES, edges: EDGES, user_variables: [{ id: 'v1', name: 'amount', type: 'number', defaultValue: '0', description: '' }],
      swimlanes: null, sections: null, tags: null, is_active: false, has_unpublished_changes: false, published_version_id: null,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }],
    workflow_runs: [],
    workflow_versions: [],
    integrations: [{ id: 'int-a', tenant_id: 'tenant-a', name: 'ERP', type: 'rest_api', is_active: true, tags: null, config: { base_url: 'https://erp.example.com', auth_type: 'bearer', auth_config: { token: 'plain-token' } }, created_at: '2026-10-01T00:00:00Z' }],
    integration_references: [{ id: 'ref-a', tenant_id: 'tenant-a', integration_id: 'int-a', name: 'Orders', description: null, request_config: { method: 'GET', path: '/orders' }, inputs: [], outputs: [], tags: null }],
    integration_objects: [{ id: 'obj-a', tenant_id: 'tenant-a', name: 'Orders view', description: null, config: {} }],
    integration_object_sources: [{ id: 'src-a', object_id: 'obj-a', source_type: 'table', table_id: 'tbl-a', reference_id: null, alias: 'orders', is_primary: true, join_type: null, join_on_local: null, join_on_foreign: null, join_to_alias: null, sort_order: 0 }],
    custom_tables: [{ id: 'tbl-a', tenant_id: 'tenant-a', name: 'Orders', slug: 'orders', description: null, columns: [{ id: 'col-id', key: 'id', name: 'ID', type: 'text', system: true }, { key: 'amount', name: 'Amount', type: 'number' }, { id: 'col-dc', key: 'date_created', name: 'Date Created', type: 'date', system: true }], created_at: '2026-10-01T00:00:00Z' }],
    decision_tables: [{
      id: 'dt-a', tenant_id: 'tenant-a', name: 'Discount', description: null, created_by: null,
      inputs: [{ id: 'i1', key: 'amount', label: 'Amount', type: 'number' }],
      outputs: [{ id: 'o1', key: 'discount', label: 'Discount', type: 'number' }],
      rules: [{ id: 'r1', label: 'Big', enabled: true, conditions: [{ id: 'c1', inputKey: 'amount', operator: 'greater_than', value: '100' }], outputs: { discount: 10 } }],
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    }],
    email_templates: [{ id: 'tpl-a', tenant_id: 'tenant-a', name: 'Welcome', description: null, is_default: false, subject: 'Hi {{name}}', html_body: '<p>Hi {{name}}</p>', text_body: 'Hi {{name}}' }],
    custom_workflow_activities: [{
      id: 'act-a', tenant_id: 'tenant-a', name: 'Echo', key: 'echo', description: null, status: 'active', source_kind: 'inline', version: '1.0.0',
      source_code: 'async function run(inputs) { return { outputs: { echo: inputs.text } } }', source_filename: null,
      manifest: { inputs: [{ name: 'text' }], outputs: [{ name: 'echo' }] }, tags: [], demo_inputs: {}, icon_name: null, color: null,
    }],
    workflow_webhooks: [{ id: 'wh-a', tenant_id: 'tenant-a', workflow_id: 'wf-a', slug: 'orders-in', api_key_prefix: 'abcd1234', api_key_hash: 'hash', is_active: true, payload_mapping: [], receive_count: 0, last_received_at: null, created_at: '2026-10-01T00:00:00Z' }],
    agents: [{ id: 'ag-a', tenant_id: 'tenant-a', name: 'Helper', description: null, model: 'claude', system_prompt: 'Be brief', tools: [], output_config: null, temperature: 0.2, is_active: true }],
    reports: [{ id: 'rep-a', tenant_id: 'tenant-a', name: 'Open tasks', description: null, category: null, is_shared: false, config: { data_source: 'tasks', columns: [] } }],
  })
}

/** GET → `data` → update unedited → assert success, then the stored row is unchanged apart from timestamps. */
async function roundTrip(options: {
  memory: Memory
  table: string
  id: string
  path: string
  get: Handler
  update: Handler
  method?: 'PATCH' | 'PUT'
  getPath?: string
  /**
   * The fixture row predates normalisation (missing column ids, manifest
   * defaults, agent output_config): the first save fills those in, so check
   * that a second round trip is a no-op.
   */
  settle?: boolean
}) {
  const { memory, table, id } = options
  authAs(memory)
  if (options.settle) {
    const first = await (await options.get(req(options.getPath ?? options.path), params({ id }))).json()
    await options.update(req(options.path, { method: options.method ?? 'PATCH', body: first.data }), params({ id }))
  }
  const before = await memory.from(table).select('*').eq('id', id).single()
  const got = await options.get(req(options.getPath ?? options.path), params({ id }))
  expect(got.status, `GET ${options.path}`).toBe(200)
  const { data } = await got.json()
  const res = await options.update(req(options.path, { method: options.method ?? 'PATCH', body: data }), params({ id }))
  const json = await res.json()
  expect(res.status, `${options.method ?? 'PATCH'} ${options.path}: ${JSON.stringify(json)}`).toBe(200)
  const after = await memory.from(table).select('*').eq('id', id).single()
  const strip = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'updated_at'))
  expect(strip(after.data)).toEqual(strip(before.data))
  return { data, json }
}

beforeEach(() => mockedValidate.mockReset())

describe('prepareRoundTripBody', () => {
  it('unwraps the GET item, drops nulls the schema cannot take, keeps nullable nulls', () => {
    const body = prepareRoundTripBody(decisionTableUpdateBody, { unwrap: 'decision_table' }, {
      decision_table: { id: 'dt-a', name: null, description: null, rule_count: 1, rules: [] },
    })
    expect(body).toEqual({ id: 'dt-a', description: null, rule_count: 1, rules: [] })
    expect(decisionTableUpdateBody.parse(body)).toEqual({ description: null, rules: [] })
  })

  it('leaves bodies alone that are already in update shape', () => {
    expect(prepareRoundTripBody(decisionTableUpdateBody, { unwrap: 'decision_table' }, { name: 'X' })).toEqual({ name: 'X' })
    expect(prepareRoundTripBody(undefined, { unwrap: 'agent' }, [1])).toEqual([1])
  })
})

describe('edit round trip: GET output is a valid unedited update', () => {
  it('workflows: /definition → PATCH reports changed: false and keeps the draft clean', async () => {
    const memory = seed()
    const { json } = await roundTrip({ memory, table: 'workflows', id: 'wf-a', path: '/workflows/wf-a', getPath: '/workflows/wf-a/definition', get: workflowDefinitionRoute.GET as unknown as Handler, update: workflowsRoute.PATCH as unknown as Handler })
    expect(json.data).toMatchObject({ changed: false, updated_fields: [], published: false })
  })

  it('workflows: GET ?include_definition=true → PATCH is accepted unchanged', async () => {
    const memory = seed()
    const { data, json } = await roundTrip({ memory, table: 'workflows', id: 'wf-a', path: '/workflows/wf-a', getPath: '/workflows/wf-a?include_definition=true', get: workflowsRoute.GET as unknown as Handler, update: workflowsRoute.PATCH as unknown as Handler })
    expect(data.definition).toMatchObject({ name: 'Approve', trigger_type: 'manual', nodes: NODES, edges: EDGES })
    expect(json.data.changed).toBe(false)
  })

  it('workflows: an edited definition (new node + edge) saves the draft, keeps unknown node keys, then publishes', async () => {
    const memory = seed()
    authAs(memory)
    const definition = (await (await workflowDefinitionRoute.GET(req('/workflows/wf-a/definition'), params({ id: 'wf-a' }))).json()).data
    definition.nodes.push({ id: 'log-2', type: 'log', label: 'Second', position: { x: 0, y: 240 }, config: { message: 'two' } })
    definition.edges.push({ id: 'e2', source: 'log-1', target: 'log-2' })
    const saved = await (await workflowsRoute.PATCH(req('/workflows/wf-a', { method: 'PATCH', body: definition }), params({ id: 'wf-a' }))).json()
    expect(saved.data).toMatchObject({ changed: true, updated_fields: ['nodes', 'edges'], published: false })
    const row = (await memory.from('workflows').select('*').eq('id', 'wf-a').single()).data
    expect(row.has_unpublished_changes).toBe(true)
    expect(row.nodes[0].width).toBe(220)
    expect(row.nodes.map((n: { id: string }) => n.id)).toEqual(['trigger', 'log-1', 'log-2'])

    const published = await workflowPublishRoute.POST(req('/workflows/wf-a/publish', { method: 'POST', body: { notes: 'add log-2' } }), params({ id: 'wf-a' }))
    expect(published.status).toBe(200)
    expect((await published.json()).data).toMatchObject({ published: true, version_number: 1 })
    const version = (await memory.from('workflow_versions').select('*').eq('workflow_id', 'wf-a').single()).data
    expect(version.nodes.map((n: { id: string }) => n.id)).toEqual(['trigger', 'log-1', 'log-2'])
    const after = (await memory.from('workflows').select('*').eq('id', 'wf-a').single()).data
    expect(after).toMatchObject({ has_unpublished_changes: false, is_active: true, published_version_id: version.id })
  })

  it('workflows: rejects an edge to a missing node and publishing without workflows.activate', async () => {
    const memory = seed()
    authAs(memory)
    const bad = await workflowsRoute.PATCH(req('/workflows/wf-a', { method: 'PATCH', body: { edges: [...EDGES, { id: 'e9', source: 'log-1', target: 'nope' }] } }), params({ id: 'wf-a' }))
    expect(bad.status).toBe(400)
    authAs(memory, ['workflows.view', 'workflows.edit'])
    const denied = await workflowPublishRoute.POST(req('/workflows/wf-a/publish', { method: 'POST', body: {} }), params({ id: 'wf-a' }))
    expect(denied.status).toBe(403)
    const deniedFlag = await workflowsRoute.PATCH(req('/workflows/wf-a', { method: 'PATCH', body: { publish: true } }), params({ id: 'wf-a' }))
    expect(deniedFlag.status).toBe(403)
    const deniedCreate = await workflowCollectionRoute.POST(req('/workflows', { method: 'POST', body: { name: 'x', trigger_type: 'manual', nodes: NODES, edges: EDGES, publish: true } }))
    expect(deniedCreate.status).toBe(403)
  })

  it('workflows: a fetched definition creates a copy via POST /workflows', async () => {
    const memory = seed()
    authAs(memory)
    const definition = (await (await workflowDefinitionRoute.GET(req('/workflows/wf-a/definition'), params({ id: 'wf-a' }))).json()).data
    const res = await workflowCollectionRoute.POST(req('/workflows', { method: 'POST', body: { ...definition, name: 'Approve (copy)' } }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.published).toBe(false)
    const copy = (await memory.from('workflows').select('*').eq('id', data.workflow_id).single()).data
    expect(copy).toMatchObject({ name: 'Approve (copy)', nodes: NODES, edges: EDGES, has_unpublished_changes: true })
  })

  it('workflows: POST /workflows with publish: true creates and publishes version 1', async () => {
    const memory = seed()
    authAs(memory)
    const definition = (await (await workflowDefinitionRoute.GET(req('/workflows/wf-a/definition'), params({ id: 'wf-a' }))).json()).data
    const res = await workflowCollectionRoute.POST(req('/workflows', { method: 'POST', body: { ...definition, name: 'Published copy', publish: true, publish_notes: 'v1' } }))
    expect(res.status).toBe(201)
    const { data } = await res.json()
    expect(data.published).toBe(true)
    const copy = (await memory.from('workflows').select('*').eq('id', data.workflow_id).single()).data
    expect(copy).toMatchObject({ name: 'Published copy', is_active: true, has_unpublished_changes: false })
    expect(copy.published_version_id).toBeTruthy()
  })

  it('workflows: POST /workflows needs workflows.edit or workflows.create', async () => {
    const memory = seed()
    authAs(memory, ['workflows.view'])
    const body = { name: 'x', trigger_type: 'manual', nodes: NODES, edges: EDGES }
    expect((await workflowCollectionRoute.POST(req('/workflows', { method: 'POST', body }))).status).toBe(403)
  })

  it('integrations (masked secrets are kept)', async () => {
    const memory = seed()
    const { data } = await roundTrip({ memory, table: 'integrations', id: 'int-a', path: '/integrations/int-a', get: integrationRoute.GET as unknown as Handler, update: integrationRoute.PATCH as unknown as Handler })
    expect(JSON.stringify(data)).not.toContain('plain-token')
  })

  it('references', async () => {
    await roundTrip({ memory: seed(), table: 'integration_references', id: 'ref-a', path: '/references/ref-a', get: referenceRoute.GET as unknown as Handler, update: referenceRoute.PATCH as unknown as Handler })
  })

  it('objects (changed: false)', async () => {
    const { json } = await roundTrip({ memory: seed(), table: 'integration_objects', id: 'obj-a', path: '/objects/obj-a', get: objectRoute.GET as unknown as Handler, update: objectRoute.PATCH as unknown as Handler })
    expect(json.data.changed).toBe(false)
  })

  it('decision tables via PUT and PATCH (changed: false)', async () => {
    const memory = seed()
    const put = await roundTrip({ memory, table: 'decision_tables', id: 'dt-a', path: '/decision-tables/dt-a', method: 'PUT', get: decisionTableRoute.GET as unknown as Handler, update: decisionTableRoute.PUT as unknown as Handler })
    expect(put.json.data.changed).toBe(false)
    const patch = await roundTrip({ memory, table: 'decision_tables', id: 'dt-a', path: '/decision-tables/dt-a', get: decisionTableRoute.GET as unknown as Handler, update: decisionTableRoute.PATCH as unknown as Handler })
    expect(patch.json.data.changed).toBe(false)
  })

  it('email templates', async () => {
    await roundTrip({ memory: seed(), table: 'email_templates', id: 'tpl-a', path: '/email-templates/tpl-a', get: emailTemplateRoute.GET as unknown as Handler, update: emailTemplateRoute.PATCH as unknown as Handler })
  })

  it('workflow activities', async () => {
    await roundTrip({ memory: seed(), table: 'custom_workflow_activities', id: 'act-a', path: '/workflow-activities/act-a', get: activityRoute.GET as unknown as Handler, update: activityRoute.PATCH as unknown as Handler, settle: true })
  })

  it('data tables', async () => {
    await roundTrip({ memory: seed(), table: 'custom_tables', id: 'tbl-a', path: '/data-tables/tbl-a', get: dataTableRoute.GET as unknown as Handler, update: dataTableRoute.PATCH as unknown as Handler, settle: true })
  })

  it('webhooks (changed: false)', async () => {
    const { json } = await roundTrip({ memory: seed(), table: 'workflow_webhooks', id: 'wh-a', path: '/webhooks/wh-a', get: webhookRoute.GET as unknown as Handler, update: webhookRoute.PATCH as unknown as Handler })
    expect(json.data.changed).toBe(false)
  })

  it.each([
    ['agents', 'agents', 'ag-a', agentRoute],
    ['reports', 'reports', 'rep-a', reportRoute],
  ] as const)('%s via PUT and PATCH (legacy routes unwrap the GET item)', async (_label, table, id, route) => {
    const memory = seed()
    const path = `/${table}/${id}`
    await roundTrip({ memory, table, id, path, method: 'PUT', get: route.GET as unknown as Handler, update: route.PUT as unknown as Handler, settle: table === 'agents' })
    await roundTrip({ memory, table, id, path, get: route.GET as unknown as Handler, update: route.PATCH as unknown as Handler })
  })

  it('an edit made to the GET output sticks (email template subject)', async () => {
    const memory = seed()
    authAs(memory)
    const { data } = await (await emailTemplateRoute.GET(req('/email-templates/tpl-a'), params({ id: 'tpl-a' }))).json()
    data.email_template.subject = 'Welcome aboard {{name}}'
    const res = await emailTemplateRoute.PATCH(req('/email-templates/tpl-a', { method: 'PATCH', body: data }), params({ id: 'tpl-a' }))
    expect(res.status).toBe(200)
    expect((await memory.from('email_templates').select('*').eq('id', 'tpl-a').single()).data.subject).toBe('Welcome aboard {{name}}')
  })

  it('retention policies: PATCH is the same handler as PUT', () => {
    expect(retentionRoute.PATCH).toBe(retentionRoute.PUT)
  })
})

describe('edit round trip over MCP', () => {
  const mcp = (memory: Memory) => createMcpServer({ tenantId: 'tenant-a', supabase: memory, permissions: [...PERMISSION_KEYS], scopes: { workflow_ids: [], table_ids: [] } } as never)
  const payload = (result: { content?: Array<{ text?: string }>; isError?: boolean }) => {
    expect(result.isError, result.content?.[0]?.text).toBeFalsy()
    return JSON.parse(result.content?.[0]?.text ?? 'null')
  }

  it('workflows_get_definition → workflows_update { definition } is a no-op; an edit saves the draft; publish versions it', async () => {
    const memory = seed()
    const server = mcp(memory)
    const { definition } = payload(await server.callTool('workflows_get_definition', { workflow_id: 'wf-a' }))
    expect(payload(await server.callTool('workflows_update', { workflow_id: 'wf-a', definition }))).toMatchObject({ changed: false })
    // workflows_get output is accepted as the definition too
    const flat = payload(await server.callTool('workflows_get', { workflow_id: 'wf-a' }))
    expect(payload(await server.callTool('workflows_update', { workflow_id: 'wf-a', definition: JSON.stringify(flat) }))).toMatchObject({ changed: false })

    definition.nodes.push({ id: 'log-2', type: 'log', label: 'Second', position: { x: 0, y: 240 }, config: { message: 'two' } })
    definition.edges.push({ id: 'e2', source: 'log-1', target: 'log-2' })
    expect(payload(await server.callTool('workflows_update', { workflow_id: 'wf-a', definition }))).toMatchObject({ changed: true, updated_fields: ['nodes', 'edges'] })
    expect(payload(await server.callTool('workflows_publish', { workflow_id: 'wf-a', notes: 'v1' }))).toMatchObject({ published: true, version: 1 })
    const { versions } = payload(await server.callTool('workflows_versions_list', { workflow_id: 'wf-a' }))
    const { version } = payload(await server.callTool('workflows_version_get', { workflow_id: 'wf-a', version_id: versions[0].id }))
    expect(version.nodes.map((n: { id: string }) => n.id)).toEqual(['trigger', 'log-1', 'log-2'])
  })

  it('decision_tables_get → decision_tables_update with the same fields reports updated: false', async () => {
    const server = mcp(seed())
    const { decision_table: table } = payload(await server.callTool('decision_tables_get', { decision_table_id: 'dt-a' }))
    const result = payload(await server.callTool('decision_tables_update', {
      decision_table_id: 'dt-a', name: table.name, inputs: table.inputs, outputs: table.outputs, rules: table.rules,
    }))
    expect(result.updated).toBe(false)
  })

  it('webhooks and objects round-trip through their update tools', async () => {
    const server = mcp(seed())
    const { webhook } = payload(await server.callTool('webhooks_get', { webhook_id: 'wh-a' }))
    expect(payload(await server.callTool('webhooks_update', { webhook_id: 'wh-a', slug: webhook.slug, payload_mapping: webhook.payload_mapping, is_active: webhook.is_active }))).toMatchObject({ changed: false })
    const object = payload(await server.callTool('objects_get', { object_id: 'obj-a' }))
    const target = object.object ?? object
    expect(payload(await server.callTool('objects_update', { object_id: 'obj-a', name: target.name, sources: target.sources }))).toMatchObject({ updated: false })
  })
})
