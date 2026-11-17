/**
 * Event waits for extension steps (ctx.runs.waitFor / ctx.runs.resume):
 * the run pauses with an indexed wait row, a non-matching event (other match
 * key, unmet condition) leaves it waiting, a matching one resumes it through
 * the signed resume queue, a timeout follows the "Timed out" branch (or
 * fails), cancelling removes the wait, and everything needed lives in the
 * database (restart-safe).
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

import exampleDefinition from '@/extensions/example-hello/manifest'
import exampleServer from '@/extensions/example-hello/server'
import { registerExtensionsForTest, resetExtensionsForTest } from '@/lib/extensions/testing'
import { invalidateTenantExtensions } from '@/lib/extensions/state'
import { createExtensionContext } from '@/lib/extensions/host'
import { matchKey, waitRequest } from '@/lib/extensions/event-waits'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-0000000e7001'
const WF = '0e000000-0000-4000-8000-0000000e7c01'
let waitInput: Record<string, unknown> = {}

// The example extension's "greet" step, made to wait for an event.
const waitingServer = { ...exampleServer, nodes: { ...exampleServer.nodes, greet: async ({ ctx }: any) => ctx.runs.waitFor(waitInput) } } as any

const nodes = [
  { id: 'trigger', type: 'ext.example-hello.greeting_received', label: 'Greeting received', position: { x: 0, y: 0 }, config: {} },
  { id: 'wait', type: 'ext.example-hello.greet', label: 'Wait for approval', position: { x: 0, y: 100 }, config: { _output_prefix: 'w', input_mappings: { name: 'x' } } },
  { id: 'done', type: 'set_variable', label: 'Done', position: { x: 0, y: 200 }, config: { name: 'status_seen', expression: '{{w_event.Status}}' } },
  { id: 'late', type: 'set_variable', label: 'Late', position: { x: 300, y: 200 }, config: { name: 'late', expression: 'yes' } },
]
const edges = [
  { id: 'e1', source: 'trigger', target: 'wait' },
  { id: 'e2', source: 'wait', target: 'done' },
  { id: 'e3', source: 'wait', target: 'late', label: 'Timed out' },
]

function seed() {
  const fake = createFakeSupabase({
    workflows: [{ id: WF, tenant_id: TENANT, name: 'Waits', trigger_type: 'ext.example-hello.greeting_received', nodes, edges, user_variables: [], run_count: 0, published_version_id: null }],
    workflow_runs: [],
    workflow_event_waits: [],
    workflow_queue: [],
    tenant_extensions: [{ tenant_id: TENANT, extension_id: 'example-hello', enabled: true, config: { greeting_word: 'Hello' }, secrets: {}, config_version: 1 }],
  })
  fake.rpcs.record_workflow_run = () => ({})
  const queued: any[] = []
  fake.rpcs.enqueue_workflow = (args) => { queued.push(args); return { data: `job-${queued.length}` } }
  db.current = fake.client
  invalidateTenantExtensions()
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test'
  return { fake, queued }
}

const start = async (fake: any) => {
  const { executeWorkflow } = await import('@/lib/workflow-engine')
  return executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } }) as Promise<any>
}
const extCtx = () => createExtensionContext({ extensionId: 'example-hello', tenantId: TENANT, actorId: null, db: db.current })
/** Run the queued resume job the way the queue worker does. */
const drain = async (fake: any, queued: any[]) => {
  const { runQueuedResume } = await import('@/lib/workflow-resume-queue')
  const at = queued.findIndex((j) => j.p_trigger_data?._task_resume)
  const [job] = queued.splice(at, 1)
  return runQueuedResume(job.p_trigger_data._task_resume, { workflowId: job.p_workflow_id, tenantId: job.p_tenant_id }, { supabase: fake.client })
}

beforeEach(() => {
  registerExtensionsForTest({ definitions: [exampleDefinition], servers: [waitingServer] })
  waitInput = { key: 'item_update', match: { list: 'L1', item: 4 }, conditions: { rules: [{ field: 'Status', operator: 'equals', value: 'Approved' }] }, description: 'Status = Approved on item 4' }
})
afterEach(() => { resetExtensionsForTest(); db.current = null })

describe('ctx.runs.waitFor / resume', () => {
  it('validates the request', () => {
    expect(() => waitRequest({ key: 'bad key!', match: { a: 1 }, description: 'x' } as any)).toThrow(/key/)
    expect(() => waitRequest({ key: 'k', match: {}, description: 'x' } as any)).toThrow(/match/)
    expect(matchKey({ item: 4, list: 'L1' })).toBe(matchKey({ list: 'L1', item: '4' }))
  })

  it('pauses with an indexed wait, ignores non-matching events, resumes on a match', async () => {
    const { fake, queued } = seed()
    const result = await start(fake)
    expect(result.status, JSON.stringify(result)).toBe('waiting_for_event')
    const run: any = fake.tables.workflow_runs[0]
    expect(run).toMatchObject({ status: 'waiting_for_event', paused_node_id: 'wait' })
    expect(run.event_id).toMatch(/^delay_extwait_/)
    expect(fake.tables.workflow_event_waits).toEqual([expect.objectContaining({ tenant_id: TENANT, extension_id: 'example-hello', wait_key: 'item_update', match_key: matchKey({ list: 'L1', item: 4 }), node_id: 'wait', event_id: run.event_id })])
    expect(result.node_results.wait).toMatchObject({ status: 'waiting', output: { waiting_for: 'Status = Approved on item 4' } })

    // Another item, then the right item with an unmet condition: still waiting.
    expect(await extCtx().runs.resume({ key: 'item_update', match: { list: 'L1', item: 5 }, data: { Status: 'Approved' } })).toEqual({ resumed: 0, waiting: 0 })
    expect(await extCtx().runs.resume({ key: 'item_update', match: { list: 'L1', item: 4 }, data: { Status: 'Draft' } })).toEqual({ resumed: 0, waiting: 1 })
    expect(queued).toHaveLength(0)

    // The match: queued, then the worker resumes the run (from the database only: restart-safe).
    expect(await extCtx().runs.resume({ key: 'item_update', match: { list: 'L1', item: 4 }, data: { Status: 'Approved' } })).toEqual({ resumed: 1, waiting: 0 })
    expect(fake.tables.workflow_event_waits).toHaveLength(0)
    const resumed: any = await drain(fake, queued)
    expect(resumed.status, JSON.stringify(resumed)).toBe('completed')
    expect(resumed.node_results.wait).toMatchObject({ status: 'success', output: { timed_out: false, event: { Status: 'Approved' } } })
    expect(resumed.node_results.done.status).toBe('success')
    expect(resumed.node_results.late).toBeUndefined()
    // A second event for the same item finds no waiter.
    expect(await extCtx().runs.resume({ key: 'item_update', match: { list: 'L1', item: 4 }, data: { Status: 'Approved' } })).toEqual({ resumed: 0, waiting: 0 })
  }, 30_000)

  it('times out onto the "Timed out" branch, or fails', async () => {
    const { fake } = seed()
    waitInput = { ...waitInput, timeoutMinutes: 60, onTimeout: 'branch' }
    await start(fake)
    const run: any = fake.tables.workflow_runs[0]
    expect(fake.tables.workflow_event_waits[0].expires_at).toBeTruthy()
    const { resumeTimedPause } = await import('@/lib/workflow-engine')
    const timed: any = await resumeTimedPause(run.id, run.event_id, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })
    expect(timed.status, JSON.stringify(timed)).toBe('completed')
    expect(timed.node_results.wait.output).toMatchObject({ timed_out: true, event: null })
    expect(timed.node_results.late.status).toBe('success')
    expect(timed.node_results.done).toBeUndefined()
    expect(fake.tables.workflow_event_waits).toHaveLength(0)

    const second = seed()
    waitInput = { ...waitInput, timeoutMinutes: 60, onTimeout: 'fail' }
    await start(second.fake)
    const r2: any = second.fake.tables.workflow_runs[0]
    const failed: any = await resumeTimedPause(r2.id, r2.event_id, { workflowId: WF, tenantId: TENANT }, { supabase: second.fake.client })
    expect(failed.status).toBe('failed')
    expect(String(failed.error)).toMatch(/timed out waiting for Status = Approved/)
  }, 30_000)

  it('a resumed wait ignores its later timeout; cancelling a run removes its wait', async () => {
    const { fake, queued } = seed()
    waitInput = { ...waitInput, timeoutMinutes: 60 }
    await start(fake)
    const run: any = fake.tables.workflow_runs[0]
    const eventId = run.event_id
    await extCtx().runs.resume({ key: 'item_update', match: { list: 'L1', item: 4 }, data: { Status: 'Approved' } })
    expect(queued.map((j) => j.p_trigger_type)).toEqual(['delay_resume', 'task_resume'])
    expect((await drain(fake, queued) as any).status).toBe('completed')
    const { resumeTimedPause } = await import('@/lib/workflow-engine')
    expect(await resumeTimedPause(run.id, eventId, { workflowId: WF, tenantId: TENANT }, { supabase: fake.client })).toMatchObject({ status: 'skipped' })

    const other = seed()
    await start(other.fake)
    const r: any = other.fake.tables.workflow_runs[0]
    const { actOnWorkflowRun } = await import('@/lib/services/workflow-runs')
    const ctx = { supabase: other.fake.client, tenantId: TENANT, actorId: null, permissions: null, authKind: 'api_key', source: 'api' } as any
    await actOnWorkflowRun(ctx, { runId: r.id } as any, { action: 'cancel' } as any)
    expect(other.fake.tables.workflow_event_waits).toHaveLength(0)
    expect(await createExtensionContext({ extensionId: 'example-hello', tenantId: TENANT, actorId: null, db: other.fake.client }).runs.resume({ key: 'item_update', match: { list: 'L1', item: 4 }, data: { Status: 'Approved' } })).toEqual({ resumed: 0, waiting: 0 })
  }, 30_000)
})
