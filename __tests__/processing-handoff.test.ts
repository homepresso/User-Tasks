/**
 * Processing hand-off (lib/processing/handoff.ts, dispatch.ts) with the
 * engine mocked:
 *  - without a provider everything runs in the web app (today's behaviour);
 *  - in queue mode starts / resumes enqueue a signed engine call and never
 *    execute inline; callers that need the result wait (bounded, clear
 *    timeout); kicks only wake the workers;
 *  - designer test runs stay in the web app unless the provider says
 *    "test runs on workers";
 *  - inside a processor process work runs locally;
 *  - engine calls are verified (tenant / workflow bound) before the worker runs them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const executeWorkflowMock = vi.hoisted(() => vi.fn())
const resumeWorkflowMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/workflow-engine', () => ({ executeWorkflow: executeWorkflowMock, resumeWorkflow: resumeWorkflowMock }))
const createServiceClientMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/cron-auth', () => ({ createServiceClient: createServiceClientMock, getProcessorSecret: () => 'secret' }))

import {
  __setProcessingProviderForTests, invalidateProcessingHandoff, markProcessorProcess, processingHandoff, testRunsOnWorkers,
} from '@/lib/processing/handoff'
import {
  ENGINE_CALL_KEY, QueuedRunTimeoutError, resumeRun, runEngineCall, signEngineCall, startRun, verifyEngineCall,
} from '@/lib/processing/dispatch'
import { kickAgentQueueProcessor, kickQueueProcessor, resetQueueKickState } from '@/lib/process-queue'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = '0a000000-0000-4000-8000-00000000000a'
const WF = '0a000000-0000-4000-8000-0000000000a1'
const RUN = '0a000000-0000-4000-8000-0000000000c1'

const notify = vi.fn(async () => {})
function useProvider(mode: 'web' | 'queue', opts: { testRuns?: boolean; throws?: boolean } = {}) {
  __setProcessingProviderForTests({
    extensionId: 'processing',
    ctx: {} as any,
    provider: {
      handoff: async () => { if (opts.throws) throw new Error('boom'); return mode },
      testRunsOnWorkers: async () => opts.testRuns === true,
      notify,
    },
  })
}

/** A fake DB whose queue "worker" completes each enqueued job at once with `result`. */
function queueDb(result: Record<string, unknown> | null = { status: 'completed', run_id: RUN }) {
  const fake = createFakeSupabase({
    workflow_queue: [],
    workflow_runs: [{ id: RUN, tenant_id: TENANT, workflow_id: WF, status: 'completed', node_results: { a: { status: 'success' } }, error: null }],
    workflow_run_event_relay: [],
  })
  fake.rpcs.enqueue_workflow = (args) => {
    const id = `job-${fake.tables.workflow_queue.length + 1}`
    fake.tables.workflow_queue.push({
      id, workflow_id: args.p_workflow_id, tenant_id: args.p_tenant_id, trigger_type: args.p_trigger_type,
      trigger_data: args.p_trigger_data, priority: args.p_priority, attempts: result ? 1 : 0, max_attempts: 3,
      status: result ? 'completed' : 'pending', result, error: null,
    })
    return { data: id }
  }
  createServiceClientMock.mockReturnValue(fake.client)
  return fake
}

beforeEach(() => {
  executeWorkflowMock.mockReset().mockResolvedValue({ status: 'completed', run_id: 'local-run', node_results: {} })
  resumeWorkflowMock.mockReset().mockResolvedValue({ status: 'completed', node_results: {} })
  notify.mockClear()
  resetQueueKickState()
  process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
  process.env.WORKFLOW_SIGNING_SECRET = 'test-signing-secret-for-engine-calls-0123456789'
})
afterEach(() => {
  __setProcessingProviderForTests(undefined)
  markProcessorProcess(false)
  vi.unstubAllGlobals()
})

describe('hand-off mode', () => {
  it('is web without a provider (public build)', async () => {
    __setProcessingProviderForTests(null)
    expect(await processingHandoff()).toBe('web')
    expect(await testRunsOnWorkers()).toBe(false)
  })

  it('follows the provider, and falls back to web when it fails', async () => {
    useProvider('queue')
    expect(await processingHandoff()).toBe('queue')
    useProvider('queue', { throws: true })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await processingHandoff()).toBe('web')
    warn.mockRestore()
  })

  it('caches the answer briefly; invalidate forgets it', async () => {
    const handoff = vi.fn(async () => 'queue' as const)
    __setProcessingProviderForTests({ extensionId: 'p', ctx: {} as any, provider: { handoff } })
    await processingHandoff(); await processingHandoff()
    expect(handoff).toHaveBeenCalledTimes(1)
    invalidateProcessingHandoff()
    await processingHandoff()
    expect(handoff).toHaveBeenCalledTimes(2)
  })
})

describe('startRun / resumeRun', () => {
  it('web mode runs in this process', async () => {
    __setProcessingProviderForTests(null)
    const fake = queueDb()
    const outcome = await startRun({ workflowId: WF, tenantId: TENANT, variables: { a: 1 }, initiator: { userId: 'u1', via: 'api' } })
    expect(outcome.run_id).toBe('local-run')
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1)
    expect(fake.tables.workflow_queue).toHaveLength(0)
  })

  it('queue mode enqueues a signed engine call, never executes inline, and waits for the result', async () => {
    useProvider('queue')
    const fake = queueDb()
    const outcome = await startRun({ workflowId: WF, tenantId: TENANT, variables: { a: 1 }, versionId: 'v1', initiator: { userId: 'u1', via: 'api' } })
    expect(executeWorkflowMock).not.toHaveBeenCalled()
    const job = fake.tables.workflow_queue[0]
    expect(job.trigger_type).toBe('engine_call')
    expect(verifyEngineCall(TENANT, WF, (job.trigger_data as any)[ENGINE_CALL_KEY])).toMatchObject({ op: 'start', variables: { a: 1 }, version_id: 'v1', initiator: { userId: 'u1', via: 'api' } })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'workflows' }))
    expect(outcome).toMatchObject({ status: 'completed', run_id: RUN, node_results: { a: { status: 'success' } }, queued: { job_id: job.id } })
  })

  it('queue mode: a wait that runs out is a clear timeout naming the job', async () => {
    useProvider('queue')
    queueDb(null)
    const error = await startRun({ workflowId: WF, tenantId: TENANT, timeoutMs: 1000 }).catch((e) => e)
    expect(error).toBeInstanceOf(QueuedRunTimeoutError)
    expect(error.message).toMatch(/did not finish within 1 s.*queue job job-1/)
  }, 10_000)

  it('queue mode with wait: false returns at once', async () => {
    useProvider('queue')
    queueDb(null)
    expect(await startRun({ workflowId: WF, tenantId: TENANT, wait: false })).toMatchObject({ status: 'queued', queued: { job_id: 'job-1' } })
  })

  it('queue mode resume carries the event id and maps "no longer waiting" to RunNotResumableError', async () => {
    useProvider('queue')
    const fake = queueDb({ status: 'skipped', run_id: RUN, reason: 'run_not_resumable' })
    const error = await resumeRun({ runId: RUN, tenantId: TENANT, workflowId: WF, variables: { outcome: 'ok' }, eventId: 'evt-1' }).catch((e) => e)
    expect(error?.name).toBe('RunNotResumableError')
    expect(verifyEngineCall(TENANT, WF, (fake.tables.workflow_queue[0].trigger_data as any)[ENGINE_CALL_KEY])).toMatchObject({ op: 'resume', run_id: RUN, event_id: 'evt-1' })
    expect(resumeWorkflowMock).not.toHaveBeenCalled()
  })

  it('designer test runs stay in the web app unless the provider runs test runs on workers', async () => {
    useProvider('queue', { testRuns: false })
    const fake = queueDb()
    await startRun({ workflowId: WF, tenantId: TENANT, test: true, onEvent: () => {} })
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1)
    expect(fake.tables.workflow_queue).toHaveLength(0)

    useProvider('queue', { testRuns: true })
    executeWorkflowMock.mockClear()
    await startRun({ workflowId: WF, tenantId: TENANT, test: true, onEvent: () => {} })
    expect(executeWorkflowMock).not.toHaveBeenCalled()
    const job = fake.tables.workflow_queue[0]
    expect(job.priority).toBe(100)
    expect(verifyEngineCall(TENANT, WF, (job.trigger_data as any)[ENGINE_CALL_KEY])).toMatchObject({ op: 'start', test: true, relay: true })
  })

  it('inside a processor process work runs locally even in queue mode', async () => {
    useProvider('queue', { testRuns: true })
    markProcessorProcess(true)
    queueDb()
    await startRun({ workflowId: WF, tenantId: TENANT })
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1)
  })
})

describe('kicks in queue mode', () => {
  it('kickQueueProcessor only wakes the workers (no self-call)', async () => {
    useProvider('queue')
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    kickQueueProcessor()
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'workflows' })))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kickAgentQueueProcessor only wakes the workers', async () => {
    useProvider('queue')
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    kickAgentQueueProcessor(1)
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agents' })))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('web mode still self-calls /api/workflows/process', async () => {
    __setProcessingProviderForTests(null)
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    kickQueueProcessor()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('http://app.test/api/workflows/process', expect.anything()))
    expect(notify).not.toHaveBeenCalled()
  })
})

describe('engine calls (worker side)', () => {
  it('refuses a call signed for another tenant or workflow, or tampered with', () => {
    const signed = signEngineCall(TENANT, WF, { op: 'start', variables: {} })
    expect(verifyEngineCall(TENANT, WF, signed)).toMatchObject({ op: 'start' })
    expect(verifyEngineCall('0a000000-0000-4000-8000-0000000000ff', WF, signed)).toBeNull()
    expect(verifyEngineCall(TENANT, '0a000000-0000-4000-8000-0000000000ff', signed)).toBeNull()
    expect(verifyEngineCall(TENANT, WF, { ...signed, call: signed.call.replace('{}', '{"x":1}') })).toBeNull()
  })

  it('runs a verified start with its initiator and version, and encodes a file response', async () => {
    const fake = queueDb()
    executeWorkflowMock.mockResolvedValue({ status: 'completed', run_id: RUN, node_results: {}, response: { statusCode: 200, headers: {}, bodyType: 'file', body: Buffer.from('PDF') } })
    const signed = signEngineCall(TENANT, WF, { op: 'start', variables: { a: 1 }, version_id: 'v1', initiator: { userId: 'u1', via: 'webhook' } })
    const result = await runEngineCall(fake.client, { id: 'job-1', workflow_id: WF, tenant_id: TENANT }, signed)
    const call = executeWorkflowMock.mock.calls[0]
    expect(call[0]).toBe(WF)
    expect(call[3]).toEqual({ a: 1 })
    expect(call[5]).toBe('v1')
    expect(call[7]).toMatchObject({ initiator: { userId: 'u1', via: 'webhook' } })
    expect((result.response as any).body).toEqual({ __base64: Buffer.from('PDF').toString('base64') })
  })

  it('skips an engine call whose signature does not verify', async () => {
    const fake = queueDb()
    const result = await runEngineCall(fake.client, { id: 'job-1', workflow_id: WF, tenant_id: TENANT }, { call: '{"op":"start"}', sig: '0'.repeat(64) })
    expect(result).toMatchObject({ status: 'skipped', reason: 'Engine call signature is invalid' })
    expect(executeWorkflowMock).not.toHaveBeenCalled()
  })
})
