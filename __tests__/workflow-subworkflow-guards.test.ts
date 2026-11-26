/**
 * Call Sub-workflow guards (2026-11 QA pass), real engine over the in-memory
 * Supabase fake:
 *  - the sub-workflow must belong to the parent run's tenant. The engine's
 *    client is service-role and executeWorkflow loaded any id, so a node
 *    config naming another workspace's workflow id ran it (with the parent's
 *    variables) and returned its node results to the caller.
 *  - nesting is capped: a workflow calling itself started runs without end.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))

import { executeWorkflow } from '@/lib/workflow-engine'
import { createFakeSupabase } from './helpers/fake-supabase'

const A = '0e5e0000-0000-4000-8000-00000000000a'
const B = '0e5e0000-0000-4000-8000-00000000000b'
const PARENT = '0e5e0000-0000-4000-8000-0000000000a1'
const CHILD_A = '0e5e0000-0000-4000-8000-0000000000a2'
const SELF = '0e5e0000-0000-4000-8000-0000000000a3'
const FOREIGN = '0e5e0000-0000-4000-8000-0000000000b1'

const start = { id: 'start', type: 'manual', label: 'Start', config: {} }
const call = (target: string) => ({ id: 'call', type: 'call_sub_workflow', label: 'Call', config: { sub_workflow_id: target, sub_workflow_name: 'Child' } })
const wf = (id: string, tenant: string, nodes: unknown[], edges: unknown[]) =>
  ({ id, tenant_id: tenant, name: id.slice(-2), trigger_type: 'manual', nodes, edges, run_count: 0, published_version_id: null })

function seed(parentTarget: string) {
  return createFakeSupabase({
    workflows: [
      wf(PARENT, A, [start, call(parentTarget)], [{ id: 'e1', source: 'start', target: 'call' }]),
      wf(CHILD_A, A, [start, { id: 'secret', type: 'set_variable', label: 'S', config: { name: 'x', expression: 'child-a' } }], [{ id: 'e1', source: 'start', target: 'secret' }]),
      wf(FOREIGN, B, [start, { id: 'secret', type: 'set_variable', label: 'S', config: { name: 'x', expression: 'tenant-b-secret' } }], [{ id: 'e1', source: 'start', target: 'secret' }]),
      wf(SELF, A, [start, call(SELF)], [{ id: 'e1', source: 'start', target: 'call' }]),
    ],
  })
}

describe('Call Sub-workflow guards', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    delete process.env.WORKFLOW_MAX_SUBWORKFLOW_DEPTH
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  })

  it('runs a sub-workflow of the same tenant', async () => {
    const fake = seed(CHILD_A)
    const result = await executeWorkflow(PARENT, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('completed')
    expect(JSON.stringify(result.node_results)).toBeTruthy()
  })

  it('refuses a sub-workflow of another tenant and never runs it', async () => {
    const fake = seed(FOREIGN)
    const result = await executeWorkflow(PARENT, undefined, false, { secret_input: 'from-a' }, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/Workflow not found/)
    expect(JSON.stringify(result)).not.toContain('tenant-b-secret')
    expect(fake.tables.workflow_runs.some((r) => r.workflow_id === FOREIGN)).toBe(false)
  })

  it('a workflow calling itself stops at the nesting limit', async () => {
    process.env.WORKFLOW_MAX_SUBWORKFLOW_DEPTH = '4'
    const fake = seed(CHILD_A)
    const result = await executeWorkflow(SELF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/nesting is deeper than 4 levels/)
    // The top run plus 4 nested ones, no more.
    expect(fake.tables.workflow_runs.filter((r) => r.workflow_id === SELF)).toHaveLength(5)
  })

  it('a start variable cannot lower the depth below zero', async () => {
    process.env.WORKFLOW_MAX_SUBWORKFLOW_DEPTH = '2'
    const fake = seed(CHILD_A)
    const result = await executeWorkflow(SELF, undefined, false, { _subworkflow_depth: -1000 }, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(fake.tables.workflow_runs.filter((r) => r.workflow_id === SELF)).toHaveLength(3)
  })
})
