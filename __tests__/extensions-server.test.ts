/**
 * Extension framework, server contribution points, with the example
 * extension registered: node dispatch in the engine, node validation and
 * data picker, the generic trigger API with dedupe, the access gate
 * (enabled / licensed via the entitlement port), the REST and public route
 * dispatchers, OpenAPI merge, jobs and event subscriptions, MCP tools and
 * authz, the connector transport hook and dynamic permissions.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
}))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))
const apiAuth = vi.hoisted(() => ({ result: null as any }))
vi.mock('@/lib/api-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-auth')>()),
  validateApiKey: async () => apiAuth.result,
}))

import { NextRequest } from 'next/server'
import exampleDefinition from '@/extensions/example-hello/manifest'
import exampleServer from '@/extensions/example-hello/server'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { setEntitlementPort } from '@/lib/extensions/entitlement-port'
import { extensionAccess, invalidateTenantExtensions } from '@/lib/extensions/state'
import { startExtensionTrigger, invalidateExtensionTriggerCache } from '@/lib/extensions/triggers'
import { dispatchExtensionApi, dispatchPublicRoute, extensionEndpointDefs, matchPath, publicRate } from '@/lib/extensions/api'
import { createExtensionContext } from '@/lib/extensions/host'
import { extensionJobDefinitions, dispatchExtensionEvents } from '@/lib/extensions/jobs'
import { extensionCatalogEntry, extensionNodeCatalog, isExtensionTriggerType } from '@/lib/extensions/nodes'
import { runExtensionNode } from '@/lib/extensions/node-runtime'
import { resolveTransportFetch } from '@/lib/integrations/transports'
import { connectorFetch } from '@/lib/integrations/http'
import { connectorCatalogWith, getConnectorDefinition } from '@/lib/connectors/registry'
import { expandPermissions, holdsPermission, isStorablePermission, permissionGroupsWithExtensions } from '@/lib/permissions'
import { nodeCatalogEntry, isTriggerNodeType, fullNodeCatalog, NODE_CATALOG } from '@/lib/workflow-schema'
import { validateNode } from '@/lib/workflow-validation'
import { rootsForNode } from '@/lib/workflow-data-picker'
import { buildOpenApiDocument } from '@/lib/api-schemas/openapi'
import { createMcpServer } from '@/lib/mcp/server'
import { requiredToolPermission } from '@/lib/mcp/authz'
import { createMemorySupabase } from './fixtures/supabase-memory'

const TENANT = '0e000000-0000-4000-8000-0000000e0001'
const OTHER = '0e000000-0000-4000-8000-0000000e0002'
const USER = '0e000000-0000-4000-8000-0000000e00aa'

function seed(extra: Record<string, any[]> = {}) {
  const mem = createMemorySupabase({
    tenant_extensions: [{ tenant_id: TENANT, extension_id: 'example-hello', enabled: true, config: { greeting_word: 'Kia ora', default_punctuation: '.' }, secrets: {}, config_version: 1 }],
    ext_example_hello__greetings: [],
    event_stream: [],
    ...extra,
  }, { uuids: true }) as any
  mem.rpcCalls = [] as any[]
  mem.rpc = async (name: string, args: any) => { mem.rpcCalls.push({ name, args }); return { data: crypto.randomUUID(), error: null } }
  db.current = mem
  return mem
}

beforeEach(() => {
  registerExtensionsForTest({ definitions: [exampleDefinition], servers: [exampleServer] })
  invalidateExtensionTriggerCache()
})
afterEach(() => {
  resetExtensionsForTest()
  vi.unstubAllGlobals()
})

describe('workflow nodes', () => {
  it('derives catalog entries (node + trigger) from the manifest field model', () => {
    const catalog = extensionNodeCatalog()
    expect(catalog.map((e) => [e.type, e.category])).toEqual([
      ['ext.example-hello.greeting_received', 'trigger'],
      ['ext.example-hello.greet', 'action'],
    ])
    const greet = extensionCatalogEntry('ext.example-hello.greet')!
    expect(greet.inputs.map((f) => f.name)).toEqual(['name', 'punctuation', 'repeat'])
    expect(greet.icon).toBe('Hand')
    expect(nodeCatalogEntry('ext.example-hello.greet')?.label).toBe('Say Hello')
    expect(isTriggerNodeType('ext.example-hello.greeting_received')).toBe(true)
    expect(isExtensionTriggerType('ext.example-hello.greet')).toBe(false)
    expect(fullNodeCatalog().length).toBe(NODE_CATALOG.length + 2)
  })

  it('validates required inputs and unknown extension node types', () => {
    const node = (type: string, config: any) => ({ id: 'n', type, label: 'n', position: { x: 0, y: 0 }, config }) as any
    expect(validateNode(node('ext.example-hello.greet', { input_mappings: {} }))).toEqual(['Name is required'])
    expect(validateNode(node('ext.example-hello.greet', { input_mappings: { name: '{{form.name}}' } }))).toEqual([])
    expect(validateNode(node('ext.missing-ext.thing', {}))[0]).toMatch(/not installed/)
  })

  it('offers typed outputs and trigger variables in the data picker', () => {
    const roots = rootsForNode({ id: 'n', type: 'ext.example-hello.greet', label: 'Hello', config: { _output_prefix: 'hello' } } as any)
    expect(roots.map((r) => r.path)).toEqual(['hello_greeting', 'hello_length'])
    const triggerRoots = rootsForNode({ id: 't', type: 'ext.example-hello.greeting_received', label: 'Greeting', config: {} } as any)
    expect(triggerRoots.map((r) => r.path)).toEqual(['greeting_name', 'greeting_text'])
  })

  it('runs a node through the single dispatch: inputs resolved and coerced, outputs set as variables', async () => {
    seed()
    const variables: Record<string, unknown> = {}
    const result = await runExtensionNode({
      node: { id: 'n1', type: 'ext.example-hello.greet', label: 'Greet', config: { input_mappings: { name: '{{who}}', repeat: '2' } } },
      tenantId: TENANT, supabase: db.current, runId: 'r1', workflowId: 'w1', isTest: false, variables, actorId: USER,
      resolve: (expr) => (expr === '{{who}}' ? 'Ada' : expr),
      setVar: (name, value) => { variables[`greet_${name}`] = value; variables[name] = value },
      prefix: 'greet', log: () => {},
    })
    expect(result.outputs).toEqual({ greeting: 'Kia ora, Ada! Kia ora, Ada!', length: 27 })
    expect(variables.greet_greeting).toBe('Kia ora, Ada! Kia ora, Ada!')
    expect(variables.greet_outputs).toEqual(result.outputs)
  })

  it('refuses to run when the workspace has not enabled the extension', async () => {
    seed({ tenant_extensions: [] })
    await expect(runExtensionNode({
      node: { id: 'n1', type: 'ext.example-hello.greet', label: 'Greet', config: { input_mappings: { name: 'Ada' } } },
      tenantId: TENANT, supabase: db.current, runId: null, workflowId: null, isTest: true, variables: {}, actorId: null,
      resolve: (e) => e, setVar: () => {}, prefix: 'greet', log: () => {},
    })).rejects.toThrow(/not enabled in this workspace/)
  })

  it('refuses invalid inputs with the field rules', async () => {
    seed()
    await expect(runExtensionNode({
      node: { id: 'n1', type: 'ext.example-hello.greet', label: 'Greet', config: { input_mappings: { name: 'Ada', repeat: 'lots' } } },
      tenantId: TENANT, supabase: db.current, runId: null, workflowId: null, isTest: true, variables: {}, actorId: null,
      resolve: (e) => e, setVar: () => {}, prefix: 'greet', log: () => {},
    })).rejects.toThrow(/Repeat/)
  })
})

describe('access gate (entitlement port)', () => {
  it('free + enabled = usable; disabled = 403; unlicensed paid = 402', async () => {
    seed()
    expect((await extensionAccess(TENANT, 'example-hello')).usable).toBe(true)
    expect((await extensionAccess(OTHER, 'example-hello')).status).toBe(403)
    setEntitlementPort({ check: async () => ({ allowed: false, state: 'expired', reason: 'Licence expired 24 hours ago' }) })
    invalidateTenantExtensions()
    const denied = await extensionAccess(TENANT, 'example-hello')
    expect(denied).toMatchObject({ usable: false, status: 402, code: 'extension_licence_expired', reason: 'Licence expired 24 hours ago' })
    expect((await extensionAccess(TENANT, 'not-there')).status).toBe(404)
  })

  it('passes features to the port', async () => {
    seed()
    const calls: any[] = []
    setEntitlementPort({ check: async (input) => { calls.push(input); return { allowed: input.feature !== 'digest', state: 'licensed' } } })
    expect((await extensionAccess(TENANT, 'example-hello', 'greetings')).usable).toBe(true)
    expect((await extensionAccess(TENANT, 'example-hello', 'digest')).usable).toBe(false)
    expect(calls.map((c) => c.feature)).toEqual(['greetings', 'digest'])
  })
})

describe('generic trigger API with dedupe', () => {
  const workflow = (id: string, nameFilter?: string) => ({
    id, tenant_id: TENANT, is_active: true, trigger_type: 'ext.example-hello.greeting_received', published_version_id: null,
    nodes: [{ id: 't', type: 'ext.example-hello.greeting_received', config: nameFilter ? { name_filter: nameFilter } : {} }],
  })

  it('starts matching workflows once per dedupe key', async () => {
    const mem = seed({ workflows: [workflow('w1'), workflow('w2', 'ada'), workflow('w3', 'grace')], extension_trigger_dedupe: [] })
    const first = await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: { greeting_name: 'Ada', greeting_text: 'Hi' }, dedupeKey: 'evt-1' })
    expect(first).toEqual({ started: 2, duplicate: false })
    expect(mem.rpcCalls.map((c: any) => c.args.p_workflow_id).sort()).toEqual(['w1', 'w2'])
    expect(mem.rpcCalls[0].args.p_trigger_type).toBe('ext.example-hello.greeting_received')
    expect(mem.rpcCalls[0].args.p_trigger_data).toMatchObject({ greeting_name: 'Ada', _extension: 'example-hello', _dedupe_key: 'evt-1' })
    const again = await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: { greeting_name: 'Ada' }, dedupeKey: 'evt-1' })
    expect(again).toEqual({ started: 0, duplicate: true })
    expect(mem.rpcCalls).toHaveLength(2)
  })

  it('starts nothing for a workspace without the extension', async () => {
    seed({ tenant_extensions: [], workflows: [workflow('w1')] })
    const result = await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: {} })
    expect(result.started).toBe(0)
    expect(result.skipped).toMatch(/not enabled/)
  })

  it('a hand start records the person (signed initiator); a payload can never set it', async () => {
    vi.stubEnv('WORKFLOW_SIGNING_SECRET', 'test-signing-secret-0123456789abcdef')
    const mem = seed({ workflows: [workflow('w1')], extension_trigger_dedupe: [] })
    const { readQueuedInitiator } = await import('@/lib/workflow-initiator')
    const USER = '0e000000-0000-4000-8000-0000000f0101'
    await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: { greeting_name: 'Ada', _started_by: { user_id: 'forged' } }, workflowId: 'w1', startedBy: USER })
    const data = mem.rpcCalls[0].args.p_trigger_data
    expect(readQueuedInitiator(data, { tenantId: TENANT, workflowId: 'w1' })).toMatchObject({ userId: USER, via: 'ui' })
    await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: { _started_by: { user_id: 'forged' } } })
    expect(mem.rpcCalls[1].args.p_trigger_data).not.toHaveProperty('_started_by')
    vi.unstubAllEnvs()
  })

  it('hand-start inputs: listed from the published version, validated server-side, passed as start variables', async () => {
    const W = '0e000000-0000-4000-8000-0000000e0901'
    const V = '0e000000-0000-4000-8000-0000000e0902'
    const USER = '0e000000-0000-4000-8000-0000000e0903'
    const vars = [
      { id: 'a', name: 'amount', type: 'number', label: 'Amount', required: true, defaultValue: '' },
      { id: 'b', name: 'urgent', type: 'boolean', defaultValue: 'false', description: 'Ask for a reply today' },
      { id: 'c', name: 'due', type: 'string', format: 'date', defaultValue: '' },
      { id: 'd', name: 'region', type: 'string', format: 'select', options: ['North', 'South'], defaultValue: 'North' },
      { id: 'e', name: 'proof', type: 'array', format: 'attachments', defaultValue: '' },
    ]
    const mem = seed({
      workflows: [{ ...workflow(W), user_variables: [{ id: 'x', name: 'draft_only', type: 'string', defaultValue: '' }], published_version_id: V }],
      workflow_versions: [{ id: V, workflow_id: W, user_variables: vars, nodes: workflow(W).nodes }],
      extension_trigger_dedupe: [],
    })
    const ctx = createExtensionContext({ extensionId: 'example-hello', tenantId: TENANT, actorId: USER, permissions: ['workflows.start'] } as any)
    const inputs = await ctx.workflows.inputs(W)
    expect(inputs.map((i) => [i.key, i.type, i.required, i.supported])).toEqual([['amount', 'number', true, true], ['urgent', 'boolean', false, true], ['due', 'date', false, true], ['region', 'select', false, true], ['proof', 'attachments', false, false]])
    expect(inputs[1]).toMatchObject({ label: 'Urgent', default: false, help: 'Ask for a reply today' })
    expect(inputs[3].options).toEqual([{ value: 'North', label: 'North' }, { value: 'South', label: 'South' }])
    expect(await createExtensionContext({ extensionId: 'example-hello', tenantId: TENANT, actorId: USER, permissions: [] } as any).workflows.inputs(W)).toEqual([])

    // Required, types and choices are checked; nothing starts on an error.
    await expect(ctx.workflows.trigger('greeting_received', { greeting_name: 'Ada' }, { workflowId: W, byPerson: true })).rejects.toMatchObject({ status: 400, code: 'invalid_inputs', details: { fields: { amount: 'Amount is required' } } })
    await expect(ctx.workflows.trigger('greeting_received', {}, { workflowId: W, byPerson: true, inputs: { amount: 'lots', region: 'East', due: '2026-02-30' } })).rejects.toMatchObject({ details: { fields: { amount: 'Amount must be a number', region: expect.stringMatching(/one of: North, South/), due: expect.stringMatching(/date/) } } })
    await expect(ctx.workflows.trigger('greeting_received', {}, { workflowId: W, byPerson: true, inputs: { amount: 5, proof: ['f1'] } })).rejects.toMatchObject({ details: { fields: { proof: expect.stringMatching(/can't be given here/) } } })
    expect(mem.rpcCalls).toHaveLength(0)

    // Valid: coerced, only declared keys, a declared input wins over a payload field of the same name.
    const r = await ctx.workflows.trigger('greeting_received', { greeting_name: 'Ada', amount: 'from-item' }, { workflowId: W, byPerson: true, inputs: { amount: '12.5', urgent: 'true', due: '2026-12-01', region: 'South', _version_id: 'forged', other: 'x' } })
    expect(r.started).toBe(1)
    const data = mem.rpcCalls[0].args.p_trigger_data
    expect(data).toMatchObject({ greeting_name: 'Ada', amount: 12.5, urgent: true, due: '2026-12-01', region: 'South' })
    expect(data).not.toHaveProperty('other')
    expect(data._version_id).not.toBe('forged')
    // Not one of its own workflows: 404; inputs without a workflow: 400.
    await expect(ctx.workflows.inputs('0e000000-0000-4000-8000-0000000e0999')).rejects.toMatchObject({ status: 404 })
    await expect(ctx.workflows.trigger('greeting_received', {}, { inputs: { amount: 1 } })).rejects.toMatchObject({ status: 400 })
  })

  it('the engine receives the start inputs as run variables (queued job → executeWorkflow)', async () => {
    const { runJob } = await import('@/lib/workflow-queue-processor')
    const engine = await import('@/lib/workflow-engine')
    const spy = vi.spyOn(engine, 'executeWorkflow').mockResolvedValue({ status: 'completed', run_id: 'r1', node_results: {} } as any)
    const job: any = { id: 'j1', workflow_id: 'w1', tenant_id: TENANT, task_id: null, trigger_type: 'ext.example-hello.greeting_received', trigger_data: { greeting_name: 'Ada', amount: 12.5, urgent: true, _version_id: 'v1' }, attempts: 0, max_attempts: 3 }
    await runJob(db.current ?? seed(), job).catch(() => undefined)
    expect(spy).toHaveBeenCalled()
    expect(spy.mock.calls[0][3]).toMatchObject({ greeting_name: 'Ada', amount: 12.5, urgent: true })
    expect(spy.mock.calls[0][3]).not.toHaveProperty('_version_id')
    spy.mockRestore()
  })

  it('rejects unknown triggers', async () => {
    seed()
    await expect(startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'nope', payload: {} })).rejects.toThrow(/no trigger/)
  })

  it('starts one chosen workflow without matches() (a person starting it on a record)', async () => {
    const mem = seed({ workflows: [workflow('w1'), workflow('w2', 'grace')], extension_trigger_dedupe: [] })
    const result = await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: { greeting_name: 'Ada' }, workflowId: 'w2' })
    expect(result).toEqual({ started: 1, duplicate: false })
    expect(mem.rpcCalls.map((c: any) => c.args.p_workflow_id)).toEqual(['w2'])
    const none = await startExtensionTrigger({ tenantId: TENANT, extensionId: 'example-hello', key: 'greeting_received', payload: {}, workflowId: 'not-a-listener' })
    expect(none.started).toBe(0)
  })

  it('forWorkspace: instance contexts only, and only where the extension is usable', async () => {
    seed()
    const instance = createExtensionContext({ extensionId: 'example-hello', tenantId: null })
    const scoped = await instance.forWorkspace(TENANT)
    expect(scoped.tenantId).toBe(TENANT)
    expect(scoped.actorId).toBeNull()
    await expect(instance.forWorkspace(OTHER)).rejects.toMatchObject({ status: 403 })
    await expect(instance.forWorkspace('not-a-uuid')).rejects.toMatchObject({ status: 400 })
    await expect(scoped.forWorkspace(OTHER)).rejects.toThrow(/instance-level/)
  })
})

function authAs(permissions: string[], tenantId = TENANT) {
  apiAuth.result = { success: true, tenantId, keyType: 'user', keyId: 'k1', userId: USER, permissions, supabase: db.current, scopes: { workflow_ids: [], table_ids: [] } }
}

describe('public route rate limits', () => {
  it('uses the route rate within bounds, else the default', () => {
    expect(publicRate({})).toEqual({ max: 120, windowMs: 60_000 })
    expect(publicRate({ rateLimit: { max: 600, windowMs: 60_000 } })).toEqual({ max: 600, windowMs: 60_000 })
    expect(publicRate({ rateLimit: { max: 1e9, windowMs: 1 } })).toEqual({ max: 6000, windowMs: 1000 })
  })
})

describe('REST endpoints (/api/v1/ext/<id>/…)', () => {
  it('matches OpenAPI-style paths', () => {
    expect(matchPath('/greetings/{id}', '/greetings/abc')).toEqual({ id: 'abc' })
    expect(matchPath('/greetings/{id}', '/greetings')).toBeNull()
    expect(matchPath('/greetings', '/other')).toBeNull()
  })

  it('creates and lists greetings through the standard pipeline', async () => {
    const mem = seed({ workflows: [], extension_trigger_dedupe: [] })
    authAs(expandPermissions(['settings.edit', 'tasks.view_own']))
    const post = await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings', { method: 'POST', body: JSON.stringify({ name: 'Ada' }) }), 'example-hello', ['greetings'])
    expect(post.status).toBe(201)
    const body = await post.json()
    expect(body.data.greeting.greeting).toBe('Kia ora, Ada.')
    expect(mem.tables.event_stream[0]).toMatchObject({ type: 'ext.example_hello.greeting.sent', category: 'system', source_table: 'extension' })
    const list = await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings?limit=5'), 'example-hello', ['greetings'])
    expect((await list.json()).data.greetings).toHaveLength(1)
  })

  it('enforces the endpoint permission, validation, 404, 405, 403 and 402', async () => {
    seed()
    authAs(['tasks.view_own'])
    const forbidden = await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings', { method: 'POST', body: '{"name":"A"}' }), 'example-hello', ['greetings'])
    expect(forbidden.status).toBe(403)
    authAs(expandPermissions(['settings.edit']))
    const invalid = await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings', { method: 'POST', body: '{}' }), 'example-hello', ['greetings'])
    expect(invalid.status).toBe(400)
    expect((await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/nope'), 'example-hello', ['nope'])).status).toBe(404)
    expect((await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings', { method: 'DELETE' }), 'example-hello', ['greetings'])).status).toBe(405)
    authAs(expandPermissions(['tasks.view_own']), OTHER)
    const disabled = await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings'), 'example-hello', ['greetings'])
    expect(disabled.status).toBe(403)
    expect((await disabled.json()).code).toBe('extension_disabled')
    setEntitlementPort({ check: async () => ({ allowed: false, state: 'unlicensed', reason: 'Needs a licence' }) })
    authAs(expandPermissions(['tasks.view_own']))
    const unlicensed = await dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings'), 'example-hello', ['greetings'])
    expect(unlicensed.status).toBe(402)
    expect((await unlicensed.json()).code).toBe('extension_not_licensed')
  })

  it('is merged, namespaced, into the served OpenAPI document', () => {
    const defs = extensionEndpointDefs()
    expect(defs.map((d) => `${d.method} ${d.path} ${d.operationId}`)).toEqual([
      'GET /ext/example-hello/greetings ext_example_hello_listGreetings',
      'POST /ext/example-hello/greetings ext_example_hello_createGreeting',
      'GET /ext/example-hello/greetings/{id} ext_example_hello_getGreeting',
    ])
    const doc = buildOpenApiDocument(defs) as any
    expect(doc.paths['/ext/example-hello/greetings'].post['x-usertasks-extension']).toBe('example-hello')
    expect(doc.paths['/ext/example-hello/greetings'].post['x-permission']).toBe('ext.example-hello.manage')
    expect(doc.paths['/ext/example-hello/greetings'].get['x-usertasks-cli'].resource).toBe('ext-example-hello-hello')
  })
})

describe('public routes (/ext-public/<id>/…)', () => {
  it('serves a declared route without auth', async () => {
    seed()
    const res = await dispatchPublicRoute(new NextRequest('http://x/ext-public/example-hello/ping'), 'example-hello', ['ping'])
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, extension: 'example-hello' })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('checks the HMAC signature with the workspace secret and resolves the tenant', async () => {
    const { encryptSecret } = await import('@/lib/secret-crypto')
    const mem = seed({ workflows: [], extension_trigger_dedupe: [], object_audit_log: [] })
    process.env.ENCRYPTION_KEY ??= 'a'.repeat(64)
    mem.tables.tenant_extensions[0].secrets = { signing_secret: encryptSecret('s3cret') }
    const body = JSON.stringify({ name: 'Grace', id: 'hook-1' })
    const url = `http://x/ext-public/example-hello/hooks/greeting?workspace=${TENANT}`
    const bad = await dispatchPublicRoute(new NextRequest(url, { method: 'POST', body, headers: { 'x-hello-signature': 'sha256=00' } }), 'example-hello', ['hooks', 'greeting'])
    expect(bad.status).toBe(401)
    const signature = `sha256=${createHmac('sha256', 's3cret').update(body).digest('hex')}`
    const ok = await dispatchPublicRoute(new NextRequest(url, { method: 'POST', body, headers: { 'x-hello-signature': signature } }), 'example-hello', ['hooks', 'greeting'])
    expect(ok.status).toBe(202)
    expect(mem.tables.ext_example_hello__greetings[0]).toMatchObject({ tenant_id: TENANT, name: 'Grace', source: 'webhook' })
    expect(mem.tables.object_audit_log.some((r: any) => r.object_type === 'extension')).toBe(true)
  })

  it('404s undeclared routes and 405s wrong methods', async () => {
    seed()
    expect((await dispatchPublicRoute(new NextRequest('http://x/ext-public/example-hello/secret'), 'example-hello', ['secret'])).status).toBe(404)
    expect((await dispatchPublicRoute(new NextRequest('http://x/ext-public/example-hello/ping', { method: 'POST' }), 'example-hello', ['ping'])).status).toBe(405)
    expect((await dispatchPublicRoute(new NextRequest('http://x/ext-public/other/ping'), 'other', ['ping'])).status).toBe(404)
  })
})

describe('jobs and event subscriptions', () => {
  it('registers ext.<id>.<name> jobs and the event dispatcher', () => {
    const jobs = extensionJobDefinitions()
    expect(jobs.map((j) => j.name)).toEqual(['ext.example-hello.digest', 'extension-events'])
    expect(jobs[0].cadence).toEqual({ every: 60 })
  })

  it('runs tenant jobs per enabled workspace', async () => {
    const mem = seed()
    mem.tables.ext_example_hello__greetings.push({ id: 'g1', tenant_id: TENANT, name: 'A', greeting: 'Hi A', source: 'ui', created_at: new Date().toISOString() })
    const [digest] = extensionJobDefinitions()
    expect(await digest.isEnabled({} as any)).toBe(true)
    const result = await digest.run({ supabase: mem, minute: new Date(), deadline: Date.now() + 5000, probe: async () => ({}) }) as any
    expect(result[TENANT]).toEqual({ count: 1 })
    expect(mem.tables.event_stream.at(-1)).toMatchObject({ type: 'ext.example_hello.digest.ready' })
  })

  it('skips unlicensed workspaces, except jobs marked runWhenUnlicensed (licence-lapse housekeeping)', async () => {
    const mem = seed()
    const ran: string[] = []
    registerExtensionsForTest({ definitions: [exampleDefinition], servers: [{ ...exampleServer, jobs: [
      { name: 'normal', cadence: { every: 5 }, run: async ({ ctx }) => { ran.push(`normal:${ctx.tenantId}`) } },
      { name: 'lapse', cadence: { every: 5 }, runWhenUnlicensed: true, run: async ({ ctx }) => { ran.push(`lapse:${ctx.tenantId}`) } },
    ] }] })
    setEntitlementPort({ check: async () => ({ allowed: false, state: 'expired', reason: 'Trial ended' }) })
    const jobs = extensionJobDefinitions()
    for (const job of jobs.filter((j) => j.name.startsWith('ext.'))) await job.run({ supabase: mem, minute: new Date(), deadline: Date.now() + 5000, probe: async () => ({}) })
    expect(ran).toEqual([`lapse:${TENANT}`])
  })

  it('delivers outbox events after the cursor to subscribers of enabled workspaces', async () => {
    const mem = seed({ extension_event_cursors: [], extension_trigger_dedupe: [] })
    const seen: any[] = []
    registerExtensionsForTest({ definitions: [exampleDefinition], servers: [{ ...exampleServer, events: [{ pattern: 'task.*', handler: async ({ event, ctx }) => { seen.push([event.type, ctx.tenantId]) } }] }] })
    await dispatchExtensionEvents({ deadline: Date.now() + 5000, minute: new Date('2027-01-01T00:05:00Z'), db: mem })
    mem.tables.event_stream.push(
      { id: 1, tenant_id: TENANT, type: 'task.completed', category: 'task', message: 'm', occurred_at: 'now', attributes: {} },
      { id: 2, tenant_id: TENANT, type: 'workflow.run.completed', category: 'workflow', message: 'm', occurred_at: 'now', attributes: {} },
      { id: 3, tenant_id: OTHER, type: 'task.created', category: 'task', message: 'm', occurred_at: 'now', attributes: {} },
    )
    await dispatchExtensionEvents({ deadline: Date.now() + 5000, minute: new Date('2027-01-01T00:06:00Z'), db: mem })
    expect(seen).toEqual([['task.completed', TENANT]])
    expect(Number(mem.tables.extension_event_cursors[0].last_event_id)).toBe(2)
    await dispatchExtensionEvents({ deadline: Date.now() + 5000, minute: new Date('2027-01-01T00:07:00Z'), db: mem })
    expect(seen).toHaveLength(1)
  })
})

describe('MCP tools', () => {
  it('registers core extension tools and namespaced extension tools with permissions', async () => {
    const mem = seed()
    const server = createMcpServer({ tenantId: TENANT, supabase: mem, actingUserId: USER, permissions: expandPermissions(['tasks.view_own']) })
    const names = server.getRegisteredTools().map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['extensions_list', 'extensions_enable', 'extensions_settings_update', 'ext_example_hello_greet', 'ext_example_hello_send']))
    expect(requiredToolPermission('ext_example_hello_greet')).toBe('ext.example-hello.view')
    expect(requiredToolPermission('ext_example_hello_unknown')).toBeUndefined()
    const greet = await server.callTool('ext_example_hello_greet', { name: 'Ada' })
    expect(JSON.parse(greet.content[0].text)).toEqual({ greeting: 'Kia ora, Ada.' })
    const send = await server.callTool('ext_example_hello_send', { name: 'Ada' })
    expect(send.isError).toBe(true)
    expect(send.content[0].text).toMatch(/ext.example-hello.manage/)
  })

  it('refuses extension tools in a workspace without the extension', async () => {
    const mem = seed()
    const server = createMcpServer({ tenantId: OTHER, supabase: mem, actingUserId: USER, permissions: expandPermissions(['tasks.view_own']) })
    const result = await server.callTool('ext_example_hello_greet', { name: 'Ada' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/not enabled/)
  })
})

describe('connectors and the transport hook', () => {
  it('appends namespaced extension connectors to the catalog', () => {
    expect(getConnectorDefinition('ext.example-hello.echo')?.name).toBe('Hello Echo')
    expect(connectorCatalogWith([]).some((c) => c.key.startsWith('ext.'))).toBe(false)
    expect(connectorCatalogWith(['example-hello']).some((c) => c.key === 'ext.example-hello.echo')).toBe(true)
  })

  it('routes a connection through the extension transport (egress guard and retries stay in core)', async () => {
    seed()
    const config = getConnectorDefinition('ext.example-hello.echo')!.buildIntegrationConfig({ base_url: 'https://echo.example.com' }, {})
    const transport = await resolveTransportFetch({ tenantId: TENANT, integrationConfig: config })
    expect(transport).toBeTypeOf('function')
    const res = await connectorFetch('https://8.8.8.8/echo', { method: 'POST', body: JSON.stringify({ message: 'hi' }) }, { fetchImpl: transport, skipEgressCheck: true })
    expect(await res.json()).toMatchObject({ message: 'hi', transport: 'loopback' })
    await expect(connectorFetch('http://169.254.169.254/latest', {}, { fetchImpl: transport })).rejects.toThrow()
  })

  it('never falls back to a plain request when the transport is unavailable', async () => {
    seed({ tenant_extensions: [] })
    await expect(resolveTransportFetch({ tenantId: TENANT, integrationConfig: { auth_config: { _transport: 'ext.example-hello.loopback' } } })).rejects.toThrow(/not enabled/)
    await expect(resolveTransportFetch({ tenantId: TENANT, integrationConfig: { auth_config: { _transport: 'ntlm' } } })).rejects.toThrow(/not available/)
    expect(await resolveTransportFetch({ tenantId: TENANT, integrationConfig: { auth_config: {} } })).toBeUndefined()
  })
})

describe('dynamic permissions', () => {
  it('adds extension permissions implied by core permissions (no role edits needed)', () => {
    expect(expandPermissions(['tasks.view_own'])).toContain('ext.example-hello.view')
    expect(expandPermissions(['settings.edit'])).toContain('ext.example-hello.manage')
    expect(expandPermissions(['reports.view'])).not.toContain('ext.example-hello.view')
    expect(holdsPermission(new Set(['settings.edit']), 'ext.example-hello.manage')).toBe(true)
    expect(holdsPermission(new Set(['reports.view']), 'ext.example-hello.manage')).toBe(false)
  })

  it('stores extension keys on roles (and keeps keys of extensions not in the build)', () => {
    expect(isStorablePermission('ext.example-hello.view')).toBe(true)
    expect(isStorablePermission('ext.removed-ext.view')).toBe(true)
    expect(isStorablePermission('ext.Bad.view')).toBe(false)
    expect(isStorablePermission('tasks.view_own')).toBe(true)
    expect(isStorablePermission('made.up')).toBe(false)
    const groups = permissionGroupsWithExtensions()
    expect(groups.at(-1)).toMatchObject({ key: 'ext.example-hello', label: 'Hello (example extension)' })
  })

  it('is a no-op without extensions', () => {
    resetExtensionsForTest()
    expect(expandPermissions(['tasks.view_own'])).toEqual(['tasks.view_own'])
    expect(permissionGroupsWithExtensions().some((g) => g.key.startsWith('ext.'))).toBe(false)
  })
})

describe('engine dispatch (executeWorkflow)', () => {
  it('starts at an extension trigger and runs an extension node through the generic hook', async () => {
    const { createFakeSupabase } = await import('./helpers/fake-supabase')
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    const WF = '0e000000-0000-4000-8000-0000000e0b01'
    const nodes = [
      { id: 'trigger', type: 'ext.example-hello.greeting_received', label: 'Greeting received', position: { x: 0, y: 0 }, config: {} },
      { id: 'greet', type: 'ext.example-hello.greet', label: 'Say hello', position: { x: 0, y: 100 }, config: { _output_prefix: 'hello', input_mappings: { name: '{{greeting_name}}' } } },
      { id: 'after', type: 'set_variable', label: 'Keep', position: { x: 0, y: 200 }, config: { name: 'kept', expression: '{{hello_greeting}}' } },
    ]
    const edges = [{ id: 'e1', source: 'trigger', target: 'greet' }, { id: 'e2', source: 'greet', target: 'after' }]
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'Hello', trigger_type: 'ext.example-hello.greeting_received', nodes, edges, user_variables: [], run_count: 0, published_version_id: null }],
      tenant_extensions: [{ tenant_id: TENANT, extension_id: 'example-hello', enabled: true, config: { greeting_word: 'Hello' }, config_version: 1 }],
    })
    fake.rpcs.record_workflow_run = () => ({})
    db.current = fake.client
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test'
    const result = await executeWorkflow(WF, undefined, false, { greeting_name: 'Ada' }, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
    expect(result.status, JSON.stringify(result.node_results)).toBe('completed')
    expect(result.node_results.greet.output.outputs).toEqual({ greeting: 'Hello, Ada!', length: 11 })
    expect(Object.keys(result.node_results)).toEqual(['trigger', 'greet', 'after'])
  }, 30_000)
})
