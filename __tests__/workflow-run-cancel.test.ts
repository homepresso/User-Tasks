/**
 * Runs → Cancel on a run that is RUNNING (not waiting): the worker stops at
 * its next step and the cancelled row is not overwritten. Before (2026-11 QA
 * pass) the engine never looked: it kept running steps, side effects
 * included, and its final write turned "failed / Manually cancelled" back
 * into "completed".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { executeWorkflow, RUN_CANCELLED_ERROR } from '@/lib/workflow-engine'
import { CANCELLED_RUN_ERROR } from '@/lib/services/workflow-runs'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e5d0000-0000-4000-8000-00000000000a'
const WF = '0e5d0000-0000-4000-8000-0000000000a1'

const nodes = [
  { id: 'start', type: 'manual', label: 'Start', config: {} },
  { id: 'loop', type: 'loop_n_times', label: 'Loop', config: { count: 6 } },
  { id: 'wait', type: 'delay', label: 'Wait', config: { duration: 1, unit: 'seconds' } },
  { id: 'mark', type: 'set_variable', label: 'Mark', config: { name: 'last', expression: '{{i}}' } },
]
const edges = [
  { id: 'e1', source: 'start', target: 'loop' },
  { id: 'e2', source: 'loop', target: 'wait', label: 'Each Item' },
  { id: 'e3', source: 'wait', target: 'mark' },
]

describe('cancelling a running run', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  })

  it('the engine constant matches the service', () => {
    expect(RUN_CANCELLED_ERROR).toBe(CANCELLED_RUN_ERROR)
  })

  it('stops at the next step and keeps the cancelled row', async () => {
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'Cancel', trigger_type: 'manual', nodes, edges, run_count: 0, published_version_id: null }],
    })
    const running = executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    await new Promise((r) => setTimeout(r, 2500))
    const row = fake.tables.workflow_runs[0] as Record<string, unknown>
    expect(row.status).toBe('running')
    // What actOnWorkflowRun({ action: 'cancel' }) writes.
    Object.assign(row, { status: 'failed', error: CANCELLED_RUN_ERROR, completed_at: new Date().toISOString() })

    const result = await running
    expect(result.status).toBe('failed')
    expect(result.error).toBe(CANCELLED_RUN_ERROR)
    // Stopped early: not all 6 iterations ran.
    expect((result.node_results.mark?.output as { value?: number } | undefined)?.value ?? -1).toBeLessThan(5)
    const after = fake.tables.workflow_runs[0] as Record<string, unknown>
    expect(after.status).toBe('failed')
    expect(after.error).toBe(CANCELLED_RUN_ERROR)
  }, 20_000)

  it('a short run that is not cancelled completes as before', async () => {
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'Cancel', trigger_type: 'manual', nodes: nodes.filter((n) => n.id !== 'wait'), edges: [edges[0], { id: 'e3', source: 'loop', target: 'mark', label: 'Each Item' }], run_count: 0, published_version_id: null }],
    })
    const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('completed')
    expect((fake.tables.workflow_runs[0] as Record<string, unknown>).status).toBe('completed')
  })
})
