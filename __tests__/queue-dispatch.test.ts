/**
 * Perf phase 2 queue dispatch (engine mocked):
 *  - kickQueueProcessor sends the processor secret the processor accepts
 *    (WORKFLOW_PROCESSOR_SECRET ?? CRON_SECRET) and coalesces bursts;
 *  - inside the queue worker a kick only flags the running processor;
 *  - processWorkflowQueueBatch claims in batches (claim_jobs, falling back to
 *    claim_next_job), runs at most WORKFLOW_CONCURRENCY jobs at once, stores
 *    slim results and releases unstarted claims when its budget runs out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
const executeWorkflowMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/workflow-engine', () => ({
  executeWorkflow: executeWorkflowMock,
  resumeTimedPause: vi.fn(),
}))

import { coalescedKick, kickQueueProcessor, queueWorkerContext, resetQueueKickState } from '@/lib/process-queue'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { createFakeSupabase, type FakeSupabase } from './helpers/fake-supabase'

const ENV_KEYS = ['WORKFLOW_PROCESSOR_SECRET', 'CRON_SECRET', 'NEXT_PUBLIC_APP_URL', 'WORKFLOW_CONCURRENCY'] as const
const savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) { savedEnv[key] = process.env[key]; delete process.env[key] }
  process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
  resetQueueKickState()
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function stubFetch(handler?: () => Promise<Response>) {
  const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(handler ?? (async () => new Response('{}')))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
const sentSecret = (fetchMock: ReturnType<typeof stubFetch>, call = 0) =>
  ((fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>)['X-Processor-Secret']

describe('kickQueueProcessor', () => {
  it('sends CRON_SECRET when it is the only secret set (the processor accepts it)', async () => {
    process.env.CRON_SECRET = 'cron-only'
    const fetchMock = stubFetch()
    await coalescedKick()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('http://app.test/api/workflows/process')
    expect(sentSecret(fetchMock)).toBe('cron-only')
  })

  it('prefers WORKFLOW_PROCESSOR_SECRET, like the processor check', async () => {
    process.env.CRON_SECRET = 'cron'
    process.env.WORKFLOW_PROCESSOR_SECRET = 'processor'
    const fetchMock = stubFetch()
    await coalescedKick()
    expect(sentSecret(fetchMock)).toBe('processor')
  })

  it('sends no secret header when none is configured (the processor then refuses)', async () => {
    const fetchMock = stubFetch()
    await coalescedKick()
    expect(sentSecret(fetchMock)).toBeUndefined()
  })

  it('coalesces a burst: one request in flight, one follow-up for everything that arrived meanwhile', async () => {
    let release!: () => void
    const fetchMock = stubFetch(() => new Promise<Response>((resolve) => { release = () => resolve(new Response('{}')) }))
    const first = coalescedKick()
    for (let i = 0; i < 200; i++) kickQueueProcessor()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    release()
    await first
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Idle again: the next kick sends a new request.
    fetchMock.mockImplementation(async () => new Response('{}'))
    await coalescedKick()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('never rejects when the processor is unreachable', async () => {
    stubFetch(async () => { throw new TypeError('fetch failed') })
    await expect(coalescedKick()).resolves.toBeUndefined()
  })

  it('inside the queue worker only flags the running processor', async () => {
    const fetchMock = stubFetch()
    const store = { kicked: false }
    await queueWorkerContext.run(store, async () => { kickQueueProcessor() })
    expect(store.kicked).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── Processor ────────────────────────────────────────────────────────────────

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const WF = '0e000000-0000-4000-8000-0000000000a1'

function queueFake(jobCount: number, opts: { batchRpc?: boolean } = {}) {
  const fake = createFakeSupabase({
    workflow_queue: Array.from({ length: jobCount }, (_, i) => ({
      id: `job-${i}`, workflow_id: WF, tenant_id: TENANT, status: 'pending', attempts: 0,
      priority: 0, scheduled_for: new Date(Date.UTC(2026, 9, 24, 0, 0, i)).toISOString(), trigger_data: { n: i },
    })),
  })
  const claim = (workerId: unknown, limit: number) => {
    const picked = fake.tables.workflow_queue.filter((j) => j.status === 'pending').slice(0, limit)
    for (const job of picked) Object.assign(job, { status: 'processing', locked_by: workerId, attempts: Number(job.attempts) + 1 })
    return picked.map((j) => ({ ...j }))
  }
  if (opts.batchRpc !== false) {
    fake.rpcs.claim_jobs = (args) => ({ data: claim(args.p_worker_id, Number(args.p_limit)) })
    fake.rpcs.release_jobs = (args) => {
      const ids = args.p_job_ids as string[]
      const rows = fake.tables.workflow_queue.filter((j) => ids.includes(String(j.id)) && j.locked_by === args.p_worker_id)
      for (const job of rows) Object.assign(job, { status: 'pending', locked_by: null, attempts: Number(job.attempts) - 1 })
      return { data: rows.length }
    }
  }
  fake.rpcs.claim_next_job = (args) => ({ data: claim(args.p_worker_id, 1)[0] ?? null })
  fake.rpcs.complete_job = (args) => {
    Object.assign(fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)!, { status: 'completed', result: args.p_result })
    return {}
  }
  fake.rpcs.fail_job = (args) => {
    Object.assign(fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)!, { status: 'failed', error: args.p_error })
    return {}
  }
  createClientMock.mockImplementation(() => fake.client)
  return fake
}

/** executeWorkflow that takes `ms` (fake timers) and records peak concurrency. */
function slowRuns(ms: number) {
  const stats = { running: 0, peak: 0 }
  executeWorkflowMock.mockImplementation(async (_wf: string, _task: unknown, _test: boolean, trigger: { n: number }) => {
    stats.running++
    stats.peak = Math.max(stats.peak, stats.running)
    await new Promise((resolve) => setTimeout(resolve, ms))
    stats.running--
    return { status: 'completed', run_id: `run-${trigger.n}`, node_results: { a: { status: 'success', output: 'x'.repeat(10_000), duration_ms: 3 } }, logs: [] }
  })
  return stats
}

const claimCalls = (fake: FakeSupabase, name: string) => fake.calls.filter((c) => c.rpc === name)

describe('processWorkflowQueueBatch', () => {
  beforeEach(() => { executeWorkflowMock.mockReset() })

  it('claims in batches and runs at most WORKFLOW_CONCURRENCY jobs at once', async () => {
    process.env.WORKFLOW_CONCURRENCY = '3'
    const fake = queueFake(10)
    const stats = slowRuns(5)
    const result = await processWorkflowQueueBatch({ batchSize: 50 })
    expect(result.processed).toBe(10)
    expect(stats.peak).toBe(3)
    expect(fake.tables.workflow_queue.every((j) => j.status === 'completed')).toBe(true)
    // 2 × concurrency per claim: 6 + 4 (short batch → queue empty, no further claim).
    expect(claimCalls(fake, 'claim_jobs').map((c) => (c.args as { p_limit: number }).p_limit)).toEqual([6, 6])
    expect(claimCalls(fake, 'claim_next_job')).toHaveLength(0)
  })

  it('stops at batch_size jobs', async () => {
    const fake = queueFake(10)
    slowRuns(1)
    const result = await processWorkflowQueueBatch({ batchSize: 4, concurrency: 2 })
    expect(result.processed).toBe(4)
    expect(fake.tables.workflow_queue.filter((j) => j.status === 'pending')).toHaveLength(6)
  })

  it('stores a slim result {status, run_id} instead of the node results', async () => {
    const fake = queueFake(1)
    slowRuns(1)
    await processWorkflowQueueBatch({ batchSize: 5 })
    const complete = claimCalls(fake, 'complete_job')[0].args as { p_result: unknown }
    expect(complete.p_result).toEqual({ status: 'completed', run_id: 'run-0' })
    expect(fake.tables.workflow_queue[0].result).toEqual({ status: 'completed', run_id: 'run-0' })
  })

  it('releases claimed jobs it did not start once the time budget is spent', async () => {
    const fake = queueFake(10)
    slowRuns(30)
    const result = await processWorkflowQueueBatch({ batchSize: 50, concurrency: 2, budgetMs: 20 })
    expect(result.budget_exhausted).toBe(true)
    // First claim took 4 (2 × concurrency); 2 started, 2 handed back.
    expect(result.processed).toBe(2)
    expect(result.released).toBe(2)
    const released = claimCalls(fake, 'release_jobs')[0].args as { p_job_ids: string[]; p_worker_id: string }
    expect(released.p_job_ids).toEqual(['job-2', 'job-3'])
    expect(released.p_worker_id).toBe(result.worker_id)
    expect(fake.tables.workflow_queue.filter((j) => j.status === 'pending')).toHaveLength(8)
    expect(fake.tables.workflow_queue.find((j) => j.id === 'job-2')!.attempts).toBe(0)
  })

  it('falls back to claim_next_job while claim_jobs is not migrated', async () => {
    const fake = queueFake(3, { batchRpc: false })
    slowRuns(1)
    const result = await processWorkflowQueueBatch({ batchSize: 10, concurrency: 2 })
    expect(result.processed).toBe(3)
    expect(claimCalls(fake, 'claim_jobs')).toHaveLength(1) // probed once
    expect(claimCalls(fake, 'claim_next_job').length).toBeGreaterThanOrEqual(3)
  })

  it('claims again when a running job enqueued (kicked) a follow-up', async () => {
    const fake = queueFake(1)
    executeWorkflowMock.mockImplementation(async (_wf: string, _t: unknown, _x: boolean, trigger: { n: number }) => {
      if (trigger.n === 0) {
        fake.tables.workflow_queue.push({ id: 'job-follow', workflow_id: WF, tenant_id: TENANT, status: 'pending', attempts: 0, priority: 0, scheduled_for: '', trigger_data: { n: 1 } })
        kickQueueProcessor()
      }
      return { status: 'completed', run_id: `run-${trigger.n}`, node_results: {} }
    })
    const fetchMock = stubFetch()
    const result = await processWorkflowQueueBatch({ batchSize: 10 })
    expect(result.processed).toBe(2)
    expect(fake.tables.workflow_queue.find((j) => j.id === 'job-follow')!.status).toBe('completed')
    expect(fetchMock).not.toHaveBeenCalled() // no HTTP kick from inside the worker
  })

  it('fails the job (retry semantics unchanged) when the run throws', async () => {
    const fake = queueFake(1)
    executeWorkflowMock.mockRejectedValue(new Error('boom'))
    const result = await processWorkflowQueueBatch({ batchSize: 5 })
    expect(result.results[0]).toMatchObject({ status: 'failed', error: 'boom' })
    expect(fake.tables.workflow_queue[0]).toMatchObject({ status: 'failed', error: 'boom' })
  })
})

describe('processWorkflowQueueBatch: leftover work', () => {
  beforeEach(() => { executeWorkflowMock.mockReset() })

  it('reports more work when it stopped at batch_size on a full claim, and none when the queue drained', async () => {
    queueFake(10)
    slowRuns(1)
    expect((await processWorkflowQueueBatch({ batchSize: 4, concurrency: 2 })).more).toBe(true)
    expect((await processWorkflowQueueBatch({ batchSize: 50, concurrency: 2 })).more).toBe(false)
  })
})
