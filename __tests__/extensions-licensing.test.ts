/**
 * Licensing wired into the extension framework (lib/extensions/licensing-wiring):
 * a paid variant of the example extension decided by real licence files
 * (throwaway Ed25519 keys generated here) through the entitlement port —
 * valid licence allowed; within 24 hours of expiry still allowed with the
 * warning; past the cutoff 402 extension_licence_expired (distinct from
 * extension_not_licensed) on REST, public routes and MCP; publish refused;
 * new runs refused; a running workflow reaching the step is parked (retryable,
 * data kept) and resumes after renewal.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ current: null as any }))
vi.mock('@/lib/providers/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/providers/db')>()),
  getServiceDb: () => db.current,
  hasServiceDb: () => false,
}))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))
vi.mock('@/lib/audit-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/audit-log')>()),
  writeAudit: vi.fn(async () => {}),
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
import { getEntitlementPort, defaultEntitlementPort } from '@/lib/extensions/entitlement-port'
import { wireLicensingEntitlements } from '@/lib/extensions/licensing-wiring'
import { extensionAccess, invalidateTenantExtensions } from '@/lib/extensions/state'
import { runExtensionNode } from '@/lib/extensions/node-runtime'
import { dispatchExtensionApi, dispatchPublicRoute } from '@/lib/extensions/api'
import { expandPermissions } from '@/lib/permissions'
import { createMemorySupabase } from './fixtures/supabase-memory'
import { assertWorkflowExtensionsPublishable, workflowExtensionPublishBlock } from '@/lib/extensions/workflow-gate'
import { invalidateLicenceCache, licensingDeps, type LicensingDeps } from '@/lib/licensing/service'
import { EXPIRY_CUTOFF_MS } from '@/lib/licensing/format'
import { createMcpServer } from '@/lib/mcp/server'
import { createFakeSupabase } from './helpers/fake-supabase'
import { makeLicence, throwawayKey } from './helpers/licence-fixtures'

// Captured before any test hook runs: what importing the server modules installed.
const PORT_AT_IMPORT = getEntitlementPort()

const TENANT = '0e000000-0000-4000-8000-0000000e1001'
const USER = '0e000000-0000-4000-8000-0000000e10aa'
const KEY = throwawayKey('test-ext-1')
const IDENTITY = { instanceId: 'inst_abcdefghijklmnopqrstuvwx', hostnames: ['usertasks.corp.example'] }
const EXPIRES = '2027-11-01T00:00:00.000Z'
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms)
const VALID = plus(EXPIRES, -30 * 86_400_000)
const IN_WINDOW = plus(EXPIRES, 23 * 3600_000)
const PAST_CUTOFF = plus(EXPIRES, EXPIRY_CUTOFF_MS + 60_000)

const paidDefinition = {
  ...exampleDefinition,
  manifest: { ...(exampleDefinition as any).manifest, licence: { tier: 'paid', sku: 'example-hello', features: ['greetings', 'digest'] } },
} as typeof exampleDefinition

const licenceFor = (expires = EXPIRES) => makeLicence(KEY.pem, 'test-ext-1', {
  licence_id: `lic_hello_${expires.slice(0, 4)}`,
  expires_at: expires,
  extensions: [{ id: 'example-hello', features: ['greetings', 'digest'] }],
})

let clock = VALID
let licences: unknown[] = []
let saved: Partial<LicensingDeps> = {}

function setDeps() {
  saved = { ...licensingDeps }
  Object.assign(licensingDeps, {
    now: () => clock,
    keyring: () => [KEY.entry],
    identity: async () => IDENTITY,
    licences: async () => licences.map((raw) => ({ source: 'setting' as const, raw })),
    tenantEntitlements: async () => [],
    audit: async () => {},
    shouldAuditDenial: async () => false,
  } satisfies Partial<LicensingDeps>)
  invalidateLicenceCache()
}

const tenantExtensions = () => [{ tenant_id: TENANT, extension_id: 'example-hello', enabled: true, config: { greeting_word: 'Hello' }, secrets: {}, config_version: 1 }]

beforeEach(() => {
  registerExtensionsForTest({ definitions: [paidDefinition], servers: [exampleServer] })
  // registerExtensionsForTest leaves the port alone; resetExtensionsForTest (afterEach) restores the default.
  wireLicensingEntitlements()
  setDeps()
  clock = VALID
  licences = [licenceFor()]
  db.current = createFakeSupabase({ tenant_extensions: tenantExtensions() }).client
  invalidateTenantExtensions()
})
afterEach(() => {
  Object.assign(licensingDeps, saved)
  invalidateLicenceCache()
  resetExtensionsForTest()
})

const greetNode = { id: 'n1', type: 'ext.example-hello.greet', label: 'Greet', config: { input_mappings: { name: 'Ada' } } }
const runGreet = () => runExtensionNode({
  node: greetNode, tenantId: TENANT, supabase: db.current, runId: null, workflowId: null, isTest: true, variables: {}, actorId: null,
  resolve: (e) => e, setVar: () => {}, prefix: 'greet', log: () => {},
})

describe('entitlement port wiring', () => {
  it('importing the server registry installs the licensing port (not the manifest-only default)', async () => {
    expect(PORT_AT_IMPORT).not.toBe(defaultEntitlementPort)
    expect(getEntitlementPort()).toBe(PORT_AT_IMPORT)
    // The default would deny every paid extension; the licence allows it.
    expect((await defaultEntitlementPort.check({ tenantId: TENANT, extensionId: 'example-hello' })).allowed).toBe(false)
  })

  it('paid extension with a valid licence: allowed', async () => {
    const access = await extensionAccess(TENANT, 'example-hello', 'greetings')
    expect(access).toMatchObject({ usable: true, status: 200, code: null, entitlement: { allowed: true, state: 'licensed' } })
    expect((await runGreet()).outputs).toMatchObject({ greeting: 'Hello, Ada!' })
  })

  it('expired less than 24 hours ago: still allowed, with the cutoff warning', async () => {
    clock = IN_WINDOW
    const access = await extensionAccess(TENANT, 'example-hello')
    expect(access.usable).toBe(true)
    expect(access.entitlement.state).toBe('licensed')
    expect(access.entitlement.reason).toMatch(/stops at .* \(24 hours after expiry\)/)
  })

  it('past the 24-hour cutoff: denied with extension_licence_expired (402), distinct from not licensed', async () => {
    clock = PAST_CUTOFF
    const expired = await extensionAccess(TENANT, 'example-hello')
    expect(expired).toMatchObject({ usable: false, status: 402, code: 'extension_licence_expired', entitlement: { state: 'expired' } })
    licences = []
    invalidateLicenceCache()
    const missing = await extensionAccess(TENANT, 'example-hello')
    expect(missing).toMatchObject({ usable: false, status: 402, code: 'extension_not_licensed', entitlement: { state: 'unlicensed' } })
    // Disabled stays 403 extension_disabled.
    db.current = createFakeSupabase({ tenant_extensions: [] }).client
    invalidateTenantExtensions()
    expect(await extensionAccess(TENANT, 'example-hello')).toMatchObject({ status: 403, code: 'extension_disabled' })
  })

  it('node execution past the cutoff throws the retryable LicenceExpiredError', async () => {
    clock = PAST_CUTOFF
    await expect(runGreet()).rejects.toMatchObject({ code: 'extension_licence_expired', status: 402, retryable: true, extensionId: 'example-hello' })
    licences = []
    invalidateLicenceCache()
    await expect(runGreet()).rejects.toMatchObject({ code: 'extension_not_licensed', retryable: false })
  })
})

describe('API, public route and MCP answers', () => {
  let mem: any
  beforeEach(() => {
    mem = createMemorySupabase({ tenant_extensions: tenantExtensions(), ext_example_hello__greetings: [], event_stream: [] }, { uuids: true }) as any
    mem.rpc = async () => ({ data: null, error: null })
    db.current = mem
    invalidateTenantExtensions()
    apiAuth.result = { success: true, tenantId: TENANT, keyType: 'user', keyId: 'k1', userId: USER, permissions: expandPermissions(['tasks.view_own']), supabase: mem, scopes: { workflow_ids: [], table_ids: [] } }
  })
  const list = () => dispatchExtensionApi(new NextRequest('http://x/api/v1/ext/example-hello/greetings?limit=5'), 'example-hello', ['greetings'])

  it('REST: allowed while licensed; 402 extension_licence_expired past the cutoff; extension_not_licensed without a licence', async () => {
    expect((await list()).status).toBe(200)
    clock = PAST_CUTOFF
    const expired = await list()
    expect(expired.status).toBe(402)
    expect(await expired.json()).toMatchObject({ code: 'extension_licence_expired' })
    licences = []
    invalidateLicenceCache()
    const missing = await list()
    expect(missing.status).toBe(402)
    expect(await missing.json()).toMatchObject({ code: 'extension_not_licensed' })
  })

  it('public route without a workspace: 402 once the instance licence is past the cutoff', async () => {
    const ping = () => dispatchPublicRoute(new NextRequest('http://x/ext-public/example-hello/ping'), 'example-hello', ['ping'])
    expect((await ping()).status).toBe(200)
    clock = PAST_CUTOFF
    const res = await ping()
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({ code: 'extension_licence_expired' })
  })

  it('MCP: the extension tool answers with the expired code', async () => {
    const server = createMcpServer({ tenantId: TENANT, supabase: mem, actingUserId: USER, permissions: expandPermissions(['tasks.view_own']) })
    expect((await server.callTool('ext_example_hello_greet', { name: 'Ada' })).isError).toBeFalsy()
    clock = PAST_CUTOFF
    const result = await server.callTool('ext_example_hello_greet', { name: 'Ada' })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/\[extension_licence_expired\]/)
  })
})

describe('workflow publish gate', () => {
  const nodes = [
    { id: 'start', type: 'manual', label: 'Start', config: {} },
    { id: 'greet', type: 'ext.example-hello.greet', label: 'Say hello', config: { input_mappings: { name: 'Ada' } } },
  ]

  it('publishes while licensed (and within the 24-hour window)', async () => {
    await expect(assertWorkflowExtensionsPublishable(TENANT, nodes)).resolves.toBeUndefined()
    clock = IN_WINDOW
    expect(await workflowExtensionPublishBlock(TENANT, nodes)).toBeNull()
  })

  it('blocks publish past the cutoff, without a licence, when disabled and when not installed', async () => {
    const notInstalled = [{ id: 'x', type: 'ext.not-here.thing', label: 'X' }]
    clock = PAST_CUTOFF
    await expect(assertWorkflowExtensionsPublishable(TENANT, nodes)).rejects.toMatchObject({ code: 'extension_licence_expired', status: 402 })
    expect(await workflowExtensionPublishBlock(TENANT, nodes)).toMatch(/Cannot publish: step "Say hello"/)
    licences = []
    invalidateLicenceCache()
    await expect(assertWorkflowExtensionsPublishable(TENANT, nodes)).rejects.toMatchObject({ code: 'extension_not_licensed', status: 402 })
    licences = [licenceFor()]
    invalidateLicenceCache()
    db.current = createFakeSupabase({ tenant_extensions: [] }).client
    invalidateTenantExtensions()
    await expect(assertWorkflowExtensionsPublishable(TENANT, nodes)).rejects.toMatchObject({ status: 403, details: { code: 'extension_disabled' } })
    await expect(assertWorkflowExtensionsPublishable(TENANT, notInstalled)).rejects.toMatchObject({ status: 400 })
  })

  it('publishWorkflow (service) refuses a graph with an expired extension', async () => {
    const WF = '0e000000-0000-4000-8000-0000000e1b01'
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'Hello', trigger_type: 'manual', nodes, edges: [{ id: 'e1', source: 'start', target: 'greet' }], user_variables: [], run_count: 0, published_version_id: null }],
      workflow_versions: [],
      tenant_extensions: tenantExtensions(),
      package_installs: [],
    })
    db.current = fake.client
    invalidateTenantExtensions()
    clock = PAST_CUTOFF
    const { publishWorkflow } = await import('@/lib/services/workflows')
    const ctx = { supabase: fake.client, tenantId: TENANT, actorId: USER, permissions: new Set(['workflows.activate']), authKind: 'api_key', source: 'api' } as any
    await expect(publishWorkflow(ctx, WF)).rejects.toMatchObject({ code: 'extension_licence_expired', status: 402 })
    expect(fake.tables.workflow_versions).toHaveLength(0)
  })
})

describe('workflow engine', () => {
  const WF = '0e000000-0000-4000-8000-0000000e1c01'
  const nodes = [
    { id: 'trigger', type: 'ext.example-hello.greeting_received', label: 'Greeting received', position: { x: 0, y: 0 }, config: {} },
    { id: 'before', type: 'set_variable', label: 'Before', position: { x: 0, y: 50 }, config: { name: 'before', expression: 'kept-{{greeting_name}}' } },
    { id: 'greet', type: 'ext.example-hello.greet', label: 'Say hello', position: { x: 0, y: 100 }, config: { _output_prefix: 'hello', input_mappings: { name: '{{greeting_name}}' } } },
    { id: 'after', type: 'set_variable', label: 'After', position: { x: 0, y: 200 }, config: { name: 'kept', expression: '{{hello_greeting}}' } },
  ]
  const edges = [
    { id: 'e1', source: 'trigger', target: 'before' },
    { id: 'e2', source: 'before', target: 'greet' },
    { id: 'e3', source: 'greet', target: 'after' },
  ]
  function seedEngine() {
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'Hello', trigger_type: 'ext.example-hello.greeting_received', nodes, edges, user_variables: [], run_count: 0, published_version_id: null }],
      workflow_runs: [],
      tenant_extensions: tenantExtensions(),
    })
    fake.rpcs.record_workflow_run = () => ({})
    db.current = fake.client
    invalidateTenantExtensions()
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test'
    return fake
  }
  const start = async (fake: ReturnType<typeof createFakeSupabase>) => {
    const { executeWorkflow } = await import('@/lib/workflow-engine')
    return executeWorkflow(WF, undefined, false, { greeting_name: 'Ada' }, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
  }

  it('refuses a new run past the cutoff (no run row) with extension_licence_expired', async () => {
    const fake = seedEngine()
    clock = PAST_CUTOFF
    await expect(start(fake)).rejects.toMatchObject({ code: 'extension_licence_expired', status: 402, retryable: true })
    expect(fake.tables.workflow_runs).toHaveLength(0)
    licences = []
    invalidateLicenceCache()
    await expect(start(fake)).rejects.toMatchObject({ code: 'extension_not_licensed' })
  }, 30_000)

  it('a running workflow reaching the step after the cutoff is parked (retryable, data kept) and resumes after renewal', async () => {
    const fake = seedEngine()
    // Licensed when the run starts; the cutoff passes before the step runs.
    fake.rpcs.record_workflow_run = () => { clock = PAST_CUTOFF; return {} }
    const result: any = await start(fake)
    expect(result.status, JSON.stringify(result.node_results)).toBe('paused')
    expect(result).toMatchObject({ error_code: 'extension_licence_expired', retryable: true, paused_node_id: 'greet' })
    expect(result.node_results.before.status).toBe('success')
    expect(result.node_results.greet).toMatchObject({ status: 'error', code: 'extension_licence_expired', retryable: true })
    expect(result.node_results.after).toBeUndefined()
    const run: any = fake.tables.workflow_runs[0]
    expect(run).toMatchObject({ status: 'paused', paused_node_id: 'greet' })
    expect(run.error).toMatch(/expired/)
    expect(run.pause_variables).toMatchObject({ greeting_name: 'Ada', before: 'kept-Ada', _licence_blocked_node_id: 'greet' })

    // Renewed: resuming re-runs the refused step and continues.
    const { resumeWorkflow } = await import('@/lib/workflow-engine')
    clock = PAST_CUTOFF
    licences = [licenceFor('2028-11-01T00:00:00.000Z')]
    invalidateLicenceCache()
    const resumed: any = await resumeWorkflow(run.id, {}, undefined, { supabase: fake.client })
    expect(resumed.status, JSON.stringify(resumed)).toBe('completed')
    expect(resumed.node_results.greet.output.outputs).toEqual({ greeting: 'Hello, Ada!', length: 11 })
    expect(resumed.node_results.after.status).toBe('success')
    expect(fake.tables.workflow_runs[0]).toMatchObject({ status: 'completed', error: null })
  }, 30_000)

  it('resuming before renewal parks the run again', async () => {
    const fake = seedEngine()
    fake.rpcs.record_workflow_run = () => { clock = PAST_CUTOFF; return {} }
    await start(fake)
    const run: any = fake.tables.workflow_runs[0]
    const { resumeWorkflow } = await import('@/lib/workflow-engine')
    const again: any = await resumeWorkflow(run.id, {}, undefined, { supabase: fake.client })
    expect(again).toMatchObject({ status: 'paused', error_code: 'extension_licence_expired' })
    expect(fake.tables.workflow_runs[0]).toMatchObject({ status: 'paused', paused_node_id: 'greet' })
  }, 30_000)
})
