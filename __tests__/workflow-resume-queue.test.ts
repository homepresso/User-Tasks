/**
 * Perf phase 2 resume contracts (real engine, in-memory Supabase fake):
 *  - resumeWorkflow claims the run atomically, so a double submit resumes it
 *    once;
 *  - task completion enqueues a signed task_resume job and returns the run id
 *    at once; the queue worker resumes the run; a forged, replayed or
 *    cross-tenant job is skipped.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { resumeWorkflow, RunNotResumableError } from '@/lib/workflow-engine'
import { enqueueResume, runQueuedResume, signResume } from '@/lib/workflow-resume-queue'
import { processWorkflowQueueBatch } from '@/lib/workflow-queue-processor'
import { resetQueueKickState } from '@/lib/process-queue'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000000a'
const OTHER_TENANT = '0e000000-0000-4000-8000-00000000000b'
const WF = '0e000000-0000-4000-8000-0000000000a1'
const RUN = '0e000000-0000-4000-8000-0000000000c1'
const EVENT = 'evt_task_1'

function seed() {
  const fake = createFakeSupabase({
    workflows: [{
      id: WF, tenant_id: TENANT, name: 'Approval', run_count: 0, published_version_id: null,
      nodes: [
        { id: 'start', type: 'schedule', label: 'Start', config: {} },
        { id: 'ut', type: 'user_task', label: 'Approve', config: { outcomes: ['approved', 'rejected'] } },
        { id: 'yes', type: 'set_variable', label: 'Yes', config: { name: 'result', expression: 'yes {{note}}' } },
        { id: 'no', type: 'set_variable', label: 'No', config: { name: 'result', expression: 'no' } },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'ut' },
        { id: 'e2', source: 'ut', target: 'yes', label: 'approved' },
        { id: 'e3', source: 'ut', target: 'no', label: 'rejected' },
      ],
    }],
    workflow_runs: [{
      id: RUN, workflow_id: WF, tenant_id: TENANT, task_id: null, status: 'waiting_for_event',
      event_id: EVENT, paused_at: '2026-10-24T10:00:00Z', paused_node_id: 'ut', pause_variables: { note: 'from pause' },
      version_id: null, trace_id: null, execution_trace: [],
      node_results: { start: { status: 'success' }, ut: { status: 'waiting' } },
    }],
  })
  fake.rpcs.record_workflow_run = () => ({})
  fake.rpcs.enqueue_workflow = (args) => {
    const id = crypto.randomUUID()
    ;(fake.tables.workflow_queue ??= []).push({
      id, workflow_id: args.p_workflow_id, tenant_id: args.p_tenant_id, trigger_type: args.p_trigger_type,
      trigger_data: structuredClone(args.p_trigger_data), status: 'pending', attempts: 0, priority: 0,
    })
    return { data: id }
  }
  fake.rpcs.claim_jobs = (args) => {
    const picked = (fake.tables.workflow_queue ?? []).filter((j) => j.status === 'pending').slice(0, Number(args.p_limit))
    for (const job of picked) job.status = 'processing'
    return { data: picked.map((j) => structuredClone(j)) }
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- fake rows
const runRow = (fake: ReturnType<typeof seed>): any => fake.tables.workflow_runs.find((r) => r.id === RUN)!

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  resetQueueKickState()
  fetchMock = vi.fn(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('resumeWorkflow', () => {
  it('a double submit resumes the run once', async () => {
    const fake = seed()
    const [first, second] = await Promise.allSettled([
      resumeWorkflow(EVENT, { outcome: 'approved' }, undefined, { supabase: fake.client }),
      resumeWorkflow(EVENT, { outcome: 'rejected' }, undefined, { supabase: fake.client }),
    ])
    expect(first).toMatchObject({ status: 'fulfilled', value: { status: 'completed' } })
    expect(second.status).toBe('rejected')
    expect((second as PromiseRejectedResult).reason).toBeInstanceOf(RunNotResumableError)

    const row = runRow(fake)
    expect(row.status).toBe('completed')
    expect(row.node_results.yes.status).toBe('success')
    expect(row.node_results.no).toBeUndefined()
    expect(row.event_id).toBeNull()
    expect(row.paused_node_id).toBeNull()
    // One claim UPDATE matched; the loser's matched nothing.
    expect(fake.count('workflow_runs', 'select')).toBe(0)
  })

  it('only resumes while the run waits on the expected event', async () => {
    const fake = seed()
    await expect(resumeWorkflow(RUN, {}, undefined, { supabase: fake.client, eventId: 'evt_other' }))
      .rejects.toBeInstanceOf(RunNotResumableError)
    expect(runRow(fake).status).toBe('waiting_for_event')
  })

  it('fails a claimed run whose workflow can no longer be loaded instead of leaving it running', async () => {
    const fake = seed()
    fake.tables.workflows = []
    await expect(resumeWorkflow(EVENT, {}, undefined, { supabase: fake.client })).rejects.toThrow('Workflow not found')
    expect(runRow(fake)).toMatchObject({ status: 'failed', error: 'Workflow not found' })
  })
})

describe('queued resume (task_resume jobs)', () => {
  it('enqueue returns the run id at once; the worker resumes the run with the payload', async () => {
    const fake = seed()
    const queued = await enqueueResume({ tenantId: TENANT, eventId: EVENT, variables: { outcome: 'approved', note: 'ok' } })
    expect(queued).toMatchObject({ run_id: RUN, workflow_id: WF, resumed: 'queued' })
    expect(runRow(fake).status).toBe('waiting_for_event') // not run inline
    const [job] = fake.tables.workflow_queue as Array<{ trigger_type: string; trigger_data: { _task_resume: unknown } }>
    expect(job.trigger_type).toBe('task_resume')
    expect(job.trigger_data._task_resume).toMatchObject({ run_id: RUN, event_id: EVENT, payload: JSON.stringify({ outcome: 'approved', note: 'ok' }) })
    // The processor was kicked.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))

    const batch = await processWorkflowQueueBatch({ batchSize: 5 })
    expect(batch.processed).toBe(1)
    expect(runRow(fake).status).toBe('completed')
    expect(runRow(fake).node_results.yes.output.value).toBe('yes ok')
    expect((fake.tables.workflow_queue[0] as { result: unknown }).result).toEqual({ status: 'completed', run_id: RUN })
  })

  it('a second resume job for the same event is skipped (no double resume)', async () => {
    const fake = seed()
    await enqueueResume({ tenantId: TENANT, eventId: EVENT, variables: { outcome: 'approved' } })
    await enqueueResume({ tenantId: TENANT, eventId: EVENT, variables: { outcome: 'rejected' } })
    await processWorkflowQueueBatch({ batchSize: 5, concurrency: 1 })
    expect(fake.tables.workflow_queue.map((j) => (j.result as { status: string }).status)).toEqual(['completed', 'skipped'])
    expect(runRow(fake).node_results.no).toBeUndefined()
  })

  it('refuses when no run of the tenant waits on the event', async () => {
    seed()
    await expect(enqueueResume({ tenantId: OTHER_TENANT, eventId: EVENT, variables: {} })).rejects.toBeInstanceOf(RunNotResumableError)
    await expect(enqueueResume({ tenantId: TENANT, eventId: 'evt_missing', variables: {} })).rejects.toBeInstanceOf(RunNotResumableError)
  })

  it('skips forged jobs: bad signature, tampered payload, or another tenant/workflow', async () => {
    const fake = seed()
    const target = { tenantId: TENANT, workflowId: WF, runId: RUN, eventId: EVENT, payload: '{"outcome":"approved"}' }
    const sig = signResume(target)
    const job = { workflowId: WF, tenantId: TENANT }
    const resume = { run_id: RUN, event_id: EVENT, payload: target.payload, sig }

    expect(await runQueuedResume({ ...resume, sig: 'f'.repeat(64) }, job, { supabase: fake.client }))
      .toMatchObject({ status: 'skipped', reason: 'Resume job signature is invalid' })
    expect(await runQueuedResume({ ...resume, payload: '{"outcome":"rejected"}' }, job, { supabase: fake.client }))
      .toMatchObject({ status: 'skipped', reason: 'Resume job signature is invalid' })
    expect(await runQueuedResume(resume, { ...job, tenantId: OTHER_TENANT }, { supabase: fake.client }))
      .toMatchObject({ status: 'skipped' })
    expect(await runQueuedResume({ run_id: RUN }, job, { supabase: fake.client }))
      .toMatchObject({ status: 'skipped', reason: 'Malformed resume job' })
    expect(runRow(fake).status).toBe('waiting_for_event')

    expect(await runQueuedResume(resume, job, { supabase: fake.client })).toMatchObject({ status: 'completed', run_id: RUN })
  })
})
