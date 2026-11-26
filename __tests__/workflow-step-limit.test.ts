/**
 * Per-run step budget (ENGINE_LIMITS.maxStepsPerRun, env
 * WORKFLOW_MAX_STEPS_PER_RUN). Before it, a Go To cycle with no exit ran
 * until the worker process ran out of memory (4 GB heap, OOM crash taking
 * every other job on that worker down; the recovered job then crashed the
 * next worker), and a Loop N Times of a huge count allocated its whole index
 * list and held a worker slot for hours. Found in the 2026-11 QA pass.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { executeWorkflow, ENGINE_LIMITS } from '@/lib/workflow-engine'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e5c0000-0000-4000-8000-00000000000a'
const WF = '0e5c0000-0000-4000-8000-0000000000a1'

type Node = { id: string; type: string; label: string; config: Record<string, unknown>; onError?: string }

function seed(nodes: Node[], edges: unknown[]) {
  return createFakeSupabase({
    workflows: [{ id: WF, tenant_id: TENANT, name: 'Step limit', trigger_type: 'manual', nodes, edges, run_count: 0, published_version_id: null }],
  })
}

const start: Node = { id: 'start', type: 'manual', label: 'Start', config: {} }
const setVar = (id: string, name: string, expression: string, extra: Partial<Node> = {}): Node =>
  ({ id, type: 'set_variable', label: `Set ${name}`, config: { name, expression }, ...extra })

describe('per-run step budget', () => {
  const prev = process.env.WORKFLOW_MAX_STEPS_PER_RUN
  beforeEach(() => {
    process.env.WORKFLOW_MAX_STEPS_PER_RUN = '500'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  })
  afterEach(() => {
    if (prev === undefined) delete process.env.WORKFLOW_MAX_STEPS_PER_RUN
    else process.env.WORKFLOW_MAX_STEPS_PER_RUN = prev
  })

  it('defaults to 200,000 steps', () => {
    delete process.env.WORKFLOW_MAX_STEPS_PER_RUN
    expect(ENGINE_LIMITS.maxStepsPerRun).toBe(200_000)
  })

  it('a Go To cycle with no exit fails the run instead of running forever', async () => {
    const fake = seed(
      [start, setVar('a', 'x', '1'), { id: 'g', type: 'goto_activity', label: 'Again', config: { target_node_id: 'a' } }],
      [{ id: 'e1', source: 'start', target: 'a' }, { id: 'e2', source: 'a', target: 'g' }],
    )
    const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(String(result.error)).toMatch(/Step limit reached: this run took more than 500 steps/)
    const run = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as { status: string }
    expect(run.status).toBe('failed')
  })

  it('onError=continue does not continue past the step limit', async () => {
    const fake = seed(
      [start, setVar('a', 'x', '1', { onError: 'continue' }), { id: 'g', type: 'goto_activity', label: 'Again', config: { target_node_id: 'a' }, onError: 'continue' }],
      [{ id: 'e1', source: 'start', target: 'a' }, { id: 'e2', source: 'a', target: 'g' }],
    )
    const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(String(result.error)).toMatch(/Step limit reached/)
  })

  it('Loop N Times over the budget is refused up front (no huge allocation)', async () => {
    const fake = seed(
      [start, { id: 'l', type: 'loop_n_times', label: 'Loop', config: { count: '{{n}}' } }, setVar('v', 'last', '{{i}}')],
      [{ id: 'e1', source: 'start', target: 'l' }, { id: 'e2', source: 'l', target: 'v', label: 'Each Item' }],
    )
    const result = await executeWorkflow(WF, undefined, false, { n: 5e9 }, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(String(result.error)).toMatch(/Step limit reached/)
  })

  it('a loop that fits the budget still completes', async () => {
    const fake = seed(
      [start, { id: 'l', type: 'loop_n_times', label: 'Loop', config: { count: '{{n}}' } }, setVar('v', 'last', '{{i}}')],
      [{ id: 'e1', source: 'start', target: 'l' }, { id: 'e2', source: 'l', target: 'v', label: 'Each Item' }],
    )
    const result = await executeWorkflow(WF, undefined, false, { n: 400 }, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('completed')
    expect(result.node_results.v?.output).toEqual({ variable: 'last', value: 399 })
  })

  it('a loop over the budget fails the run', async () => {
    const fake = seed(
      [start, { id: 'l', type: 'loop', label: 'Each', config: { items: '{{items}}' } }, setVar('v', 'last', '{{item}}'), setVar('w', 'again', '{{item}}')],
      [{ id: 'e1', source: 'start', target: 'l' }, { id: 'e2', source: 'l', target: 'v', label: 'Each Item' }, { id: 'e3', source: 'v', target: 'w' }],
    )
    const items = Array.from({ length: 300 }, (_, i) => i) // 600 body steps > 500
    const result = await executeWorkflow(WF, undefined, false, { items }, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(String(result.error)).toMatch(/Step limit reached/)
  })

  it('a run segment over WORKFLOW_MAX_RUN_MS fails with a time limit', async () => {
    process.env.WORKFLOW_MAX_RUN_MS = '1500'
    process.env.WORKFLOW_MAX_STEPS_PER_RUN = '100000'
    try {
      const fake = seed(
        [start, { id: 'l', type: 'loop_n_times', label: 'Loop', config: { count: 5 } }, { id: 'w', type: 'delay', label: 'Wait', config: { duration: 1, unit: 'seconds' } }],
        [{ id: 'e1', source: 'start', target: 'l' }, { id: 'e2', source: 'l', target: 'w', label: 'Each Item' }],
      )
      const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
      expect(result.status).toBe('failed')
      expect(String(result.error)).toMatch(/Time limit reached/)
    } finally {
      delete process.env.WORKFLOW_MAX_RUN_MS
    }
  }, 20_000)
})
