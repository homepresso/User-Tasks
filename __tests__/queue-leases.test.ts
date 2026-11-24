/**
 * Workflow queue leases and stuck-job recovery in the processor (engine
 * mocked; SQL in queue-leases-db.test.ts):
 *  - claims carry a lease (WORKFLOW_LEASE_SECONDS) and fall back without one
 *    before migration 20270124090000;
 *  - leases are renewed while jobs run; a job the renewal no longer returns
 *    is lost and its result is not written (fenced complete / fail);
 *  - the run a job starts is recorded on the job (onRunCreated);
 *  - a job retried after its worker was lost closes the run it left
 *    `running` (Interrupted) before running again; a resume job then fails
 *    instead of resuming a pause that no longer exists.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
const executeWorkflowMock = vi.hoisted(() => vi.fn())
const recoverRunMock = vi.hoisted(() => vi.fn(async () => null))
const runQueuedResumeMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/workflow-engine', () => ({
  executeWorkflow: executeWorkflowMock,
  resumeTimedPause: vi.fn(),
  recoverRunFromCheckpoint: recoverRunMock,
}))
vi.mock('@/lib/workflow-resume-queue', () => ({ runQueuedResume: runQueuedResumeMock }))

import { closeInterruptedRun, leaseSeconds, processWorkflowQueueBatch, startLeaseKeeper, type JobLease } from '@/lib/workflow-queue-processor'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const TENANT = '0f000000-0000-4000-8000-00000000000a'
const WF = '0f000000-0000-4000-8000-0000000000a1'
const RUN = '0f000000-0000-4000-8000-0000000000c1'

const savedEnv = { ...process.env }
beforeEach(() => {
  executeWorkflowMock.mockReset()
  runQueuedResumeMock.mockReset()
  process.env.NEXT_PUBLIC_APP_URL = 'http://app.test'
  delete process.env.WORKFLOW_LEASE_SECONDS
})
afterEach(() => {
  process.env = { ...savedEnv }
  vi.useRealTimers()
})

function leasedQueue(jobs: Array<Record<string, unknown>>, opts: { fenced?: boolean } = {}) {
  const fake = createFakeSupabase({
    workflow_queue: jobs.map((j, i) => ({
      workflow_id: WF, tenant_id: TENANT, status: 'pending', attempts: 0, priority: 0,
      scheduled_for: new Date(Date.UTC(2026, 10, 22, 0, 0, i)).toISOString(), trigger_data: {}, ...j,
    })),
    workflow_runs: [{ id: RUN, tenant_id: TENANT, workflow_id: WF, status: 'running' }],
  })
  fake.rpcs.claim_jobs = (args) => {
    const picked = fake.tables.workflow_queue.filter((j) => j.status === 'pending').slice(0, Number(args.p_limit))
    for (const job of picked) {
      Object.assign(job, {
        status: 'processing', locked_by: args.p_worker_id, attempts: Number(job.attempts) + 1,
        lease_expires_at: args.p_lease_seconds ? new Date(Date.now() + Number(args.p_lease_seconds) * 1000).toISOString() : null,
      })
    }
    return { data: picked.map((j) => ({ ...j })) }
  }
  if (opts.fenced !== false) {
    fake.rpcs.complete_leased_job = (args) => {
      const job = fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)!
      if (job.status !== 'processing' || job.locked_by !== args.p_worker_id) return { data: false }
      Object.assign(job, { status: 'completed', result: args.p_result, locked_by: null })
      return { data: true }
    }
    fake.rpcs.fail_leased_job = (args) => {
      const job = fake.tables.workflow_queue.find((j) => j.id === args.p_job_id)!
      if (job.status !== 'processing' || job.locked_by !== args.p_worker_id) return { data: false }
      Object.assign(job, { status: 'failed', error: args.p_error, locked_by: null })
      return { data: true }
    }
  }
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

describe('lease settings', () => {
  it('WORKFLOW_LEASE_SECONDS defaults to 120 and is clamped to 15–3600', () => {
    expect(leaseSeconds()).toBe(120)
    process.env.WORKFLOW_LEASE_SECONDS = '5'
    expect(leaseSeconds()).toBe(15)
    process.env.WORKFLOW_LEASE_SECONDS = '99999'
    expect(leaseSeconds()).toBe(3600)
    process.env.WORKFLOW_LEASE_SECONDS = 'abc'
    expect(leaseSeconds()).toBe(120)
  })
})

describe('processWorkflowQueueBatch with leases', () => {
  it('claims with a lease and completes through the fenced RPC', async () => {
    const fake = leasedQueue([{ id: 'job-1' }])
    executeWorkflowMock.mockResolvedValue({ status: 'completed', run_id: RUN, node_results: {} })
    const result = await processWorkflowQueueBatch({ batchSize: 5 })
    expect(result.processed).toBe(1)
    const claim = fake.calls.find((c) => c.rpc === 'claim_jobs')!
    expect(claim.args).toMatchObject({ p_lease_seconds: 120 })
    expect(fake.calls.some((c) => c.rpc === 'complete_leased_job')).toBe(true)
    expect(fake.calls.some((c) => c.rpc === 'complete_job')).toBe(false)
    expect(fake.tables.workflow_queue[0]).toMatchObject({ status: 'completed', result: { status: 'completed', run_id: RUN } })
  })

  it('claims without a lease and completes unfenced before the migration', async () => {
    const fake = leasedQueue([{ id: 'job-1' }], { fenced: false })
    const legacyClaim = fake.rpcs.claim_jobs
    fake.rpcs.claim_jobs = (args) => ('p_lease_seconds' in args
      ? { error: { code: 'PGRST202', message: 'Could not find the function public.claim_jobs(p_lease_seconds, p_limit, p_worker_id)' } }
      : legacyClaim(args))
    executeWorkflowMock.mockResolvedValue({ status: 'completed', run_id: RUN, node_results: {} })
    const result = await processWorkflowQueueBatch({ batchSize: 5 })
    expect(result.processed).toBe(1)
    expect(fake.tables.workflow_queue[0].status).toBe('completed')
    expect(fake.calls.some((c) => c.rpc === 'complete_job')).toBe(true)
  })

  it('records the run a job started on the job as soon as it exists', async () => {
    const fake = leasedQueue([{ id: 'job-1' }])
    executeWorkflowMock.mockImplementation(async (...args: any[]) => {
      await args[7].onRunCreated(RUN)
      expect(fake.tables.workflow_queue[0].run_id).toBe(RUN)
      return { status: 'completed', run_id: RUN, node_results: {} }
    })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1)
    expect(fake.tables.workflow_queue[0].run_id).toBe(RUN)
  })

  it('discards the result of a job whose lease was taken over while it ran (no double write)', async () => {
    const fake = leasedQueue([{ id: 'job-1' }])
    executeWorkflowMock.mockImplementation(async () => {
      // Recovery took the job over meanwhile (another worker claimed it).
      Object.assign(fake.tables.workflow_queue[0], { locked_by: 'worker-other' })
      return { status: 'completed', run_id: RUN, node_results: {} }
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await processWorkflowQueueBatch({ batchSize: 5 })
    warn.mockRestore()
    expect(result.lease_lost).toBe(1)
    expect(result.results[0]).toMatchObject({ status: 'lease_lost' })
    expect(fake.tables.workflow_queue[0]).toMatchObject({ status: 'processing', locked_by: 'worker-other' })
  })

  it('a failed run of a lost job is not written either', async () => {
    const fake = leasedQueue([{ id: 'job-1' }])
    executeWorkflowMock.mockImplementation(async () => {
      Object.assign(fake.tables.workflow_queue[0], { status: 'dead', locked_by: null })
      throw new Error('boom')
    })
    const result = await processWorkflowQueueBatch({ batchSize: 5 })
    expect(result.results[0]).toMatchObject({ status: 'lease_lost', error: 'boom' })
    expect(fake.tables.workflow_queue[0].status).toBe('dead')
    expect(fake.tables.workflow_queue[0].error).toBeUndefined()
  })

  it('a start job retried after its worker was lost closes the interrupted run, then starts a new one', async () => {
    const fake = leasedQueue([{ id: 'job-1', run_id: RUN, lease_lost_count: 1, attempts: 1 }])
    executeWorkflowMock.mockResolvedValue({ status: 'completed', run_id: 'new-run', node_results: {} })
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(fake.tables.workflow_runs[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/^Interrupted/) })
    expect(executeWorkflowMock).toHaveBeenCalledTimes(1)
    expect(fake.tables.workflow_queue[0]).toMatchObject({ status: 'completed', result: { run_id: 'new-run' } })
  })

  it('a resume job whose run was interrupted mid-resume fails cleanly instead of resuming', async () => {
    const fake = leasedQueue([{ id: 'job-1', lease_lost_count: 1, trigger_type: 'task_resume', trigger_data: { _task_resume: { run_id: RUN } } }])
    await processWorkflowQueueBatch({ batchSize: 5 })
    expect(runQueuedResumeMock).not.toHaveBeenCalled()
    expect(fake.tables.workflow_runs[0].status).toBe('failed')
    expect(fake.tables.workflow_queue[0]).toMatchObject({ status: 'completed', result: { status: 'failed', run_id: RUN } })
  })

  it('a first attempt never touches a running run', async () => {
    const fake = leasedQueue([])
    expect(await closeInterruptedRun(fake.client, { id: 'j', workflow_id: WF, tenant_id: TENANT, run_id: RUN, lease_lost_count: 0 })).toBeNull()
    expect(fake.tables.workflow_runs[0].status).toBe('running')
  })
})

describe('lease keeper', () => {
  it('renews held leases every quarter lease and marks the ones it no longer holds as lost', async () => {
    vi.useFakeTimers()
    const fake = leasedQueue([])
    const held = new Set(['job-1', 'job-2'])
    fake.rpcs.renew_job_leases = (args) => ({ data: (args.p_job_ids as string[]).filter((id) => held.has(id)) })
    const leases = new Map<string, JobLease>([['job-1', { workerId: 'w1' }], ['job-2', { workerId: 'w1' }]])
    const state = { batchRpc: true, leases: true, leaseSeconds: 120, fenced: true }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const keeper = startLeaseKeeper(fake.client, 'w1', leases, state)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(fake.calls.filter((c) => c.rpc === 'renew_job_leases')).toHaveLength(1)
    expect(fake.calls.find((c) => c.rpc === 'renew_job_leases')!.args).toEqual({ p_worker_id: 'w1', p_job_ids: ['job-1', 'job-2'], p_lease_seconds: 120 })
    held.delete('job-2')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(leases.get('job-1')!.lost).toBeUndefined()
    expect(leases.get('job-2')!.lost).toBe(true)
    // A lost lease is not renewed again.
    await vi.advanceTimersByTimeAsync(30_000)
    expect((fake.calls.filter((c) => c.rpc === 'renew_job_leases').at(-1)!.args as any).p_job_ids).toEqual(['job-1'])
    keeper.stop()
    warn.mockRestore()
  })

  it('stops renewing (no leases to renew) before the migration', async () => {
    const fake = leasedQueue([])
    const leases = new Map<string, JobLease>([['job-1', { workerId: 'w1' }]])
    const state = { batchRpc: true, leases: true, leaseSeconds: 120, fenced: true }
    const keeper = startLeaseKeeper(fake.client, 'w1', leases, state)
    await keeper.renewNow()
    expect(state.leases).toBe(false)
    await keeper.renewNow()
    expect(fake.calls.filter((c) => c.rpc === 'renew_job_leases')).toHaveLength(1)
    keeper.stop()
  })
})
