/**
 * workflow_error handlers are enqueued (a queue job with a lease and
 * retries), and the failing run waits for the enqueue — before, they started
 * as an unawaited run inside the failing worker, which a serverless
 * invocation could end before it finished (2026-11 QA pass).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({ ...(await importOriginal<object>()), kickQueueProcessor: vi.fn() }))

import { executeWorkflow } from '@/lib/workflow-engine'
import { createFakeSupabase } from './helpers/fake-supabase'

const T = '0e600000-0000-4000-8000-00000000000a'
const FAILING = '0e600000-0000-4000-8000-0000000000a1'
const HANDLER = '0e600000-0000-4000-8000-0000000000a2'

describe('workflow_error triggers', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  })

  it('are enqueued with the error details before the failed run returns', async () => {
    const fake = createFakeSupabase({
      workflows: [
        { id: FAILING, tenant_id: T, name: 'Failing', trigger_type: 'manual', is_active: true, run_count: 0, published_version_id: null,
          nodes: [{ id: 's', type: 'manual', label: 'S', config: {} }, { id: 'end', type: 'end_workflow', label: 'Boom', config: { status: 'failed', reason: 'boom' } }],
          edges: [{ id: 'e', source: 's', target: 'end' }] },
        { id: HANDLER, tenant_id: T, name: 'Handler', trigger_type: 'workflow_error', is_active: true, run_count: 0, published_version_id: null,
          nodes: [{ id: 'e', type: 'workflow_error', label: 'On error', config: {} }], edges: [] },
      ],
    })
    const jobs: Array<Record<string, unknown>> = []
    fake.rpcs.enqueue_workflow = (args) => { jobs.push(args); return { data: 'job-1' } }
    const result = await executeWorkflow(FAILING, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ p_workflow_id: HANDLER, p_tenant_id: T, p_trigger_type: 'workflow_error' })
    expect(jobs[0].p_trigger_data).toMatchObject({ error_workflow_id: FAILING, error_message: 'boom', error_node: 'Boom' })
    // Not also run inline.
    expect(fake.tables.workflow_runs.filter((r) => r.workflow_id === HANDLER)).toHaveLength(0)
  })
})
