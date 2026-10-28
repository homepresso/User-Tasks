/**
 * The engine runs with a service-role client, so task ids that reach it
 * (a start's task_id, an Auto Action's target expression) must stay in the
 * workflow's tenant: startWorkflow refuses a foreign task_id, the run's
 * {{task.*}} never loads another tenant's task, and Update Task / Auto Action
 * never write one. Real engine over the in-memory Supabase fake.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/audit-log', () => ({ writeAudit: vi.fn(async () => {}) }))

import { executeWorkflow } from '@/lib/workflow-engine'
import { resetQueueKickState } from '@/lib/process-queue'
import { startWorkflow } from '@/lib/services/workflow-start'
import type { ServiceContext } from '@/lib/services/context'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const A = '0e000000-0000-4000-8000-00000000000a'
const B = '0e000000-0000-4000-8000-00000000000b'
const WF = '0e000000-0000-4000-8000-0000000000a1'
const AUTO_WF = '0e000000-0000-4000-8000-0000000000a2'
const UPDATE_WF = '0e000000-0000-4000-8000-0000000000a3'
const TASK_A = '0e000000-0000-4000-8000-0000000000c1'
const TASK_B = '0e000000-0000-4000-8000-0000000000c2'
const OWNER = '0e000000-0000-4000-8000-0000000000b1'

const wf = (id: string, node: Record<string, unknown>) => ({
  id, tenant_id: A, name: `WF ${id.slice(-2)}`, is_active: true, trigger_type: 'manual', run_count: 0,
  published_version_id: null, user_variables: [], created_by: OWNER,
  nodes: [{ id: 'start', type: 'manual', label: 'Start', config: {} }, { label: 'Step', ...node }],
  edges: [{ id: 'e1', source: 'start', target: node.id }],
})

function seed() {
  const fake = createFakeSupabase({
    workflows: [
      wf(WF, { id: 'peek', type: 'set_variable', config: { name: 'peek', expression: '[{{task.title}}]' } }),
      wf(AUTO_WF, { id: 'auto', type: 'auto_action', config: { target_task_id: '{{target}}', status: 'completed' } }),
      wf(UPDATE_WF, { id: 'upd', type: 'update_task', config: { field: 'title', value: 'pwned' } }),
    ],
    workflow_runs: [],
    workflow_queue: [],
    tasks: [
      { id: TASK_A, tenant_id: A, title: 'Ours', status: 'open' },
      { id: TASK_B, tenant_id: B, title: 'Secret of B', status: 'open' },
    ],
  })
  fake.rpcs.record_workflow_run = () => ({})
  createClientMock.mockImplementation(() => fake.client)
  return fake
}

const ctxOf = (supabase: any): ServiceContext => ({
  supabase, tenantId: A, actorId: OWNER, permissions: new Set(['workflows.activate']), authKind: 'api_key', source: 'api',
})

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= 'http://127.0.0.1:54321'
  resetQueueKickState()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}')))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('startWorkflow task_id', () => {
  it('404s a task of another tenant (sync and async), before anything runs', async () => {
    const fake = seed()
    await expect(startWorkflow(ctxOf(fake.client), { workflow_id: WF, task_id: TASK_B })).rejects.toMatchObject({ code: 'not_found' })
    await expect(startWorkflow(ctxOf(fake.client), { workflow_id: WF, task_id: TASK_B, async: true })).rejects.toMatchObject({ code: 'not_found' })
    expect(fake.tables.workflow_runs).toHaveLength(0)
  })

  it('runs on a task of the caller\'s tenant', async () => {
    const fake = seed()
    const result = await startWorkflow(ctxOf(fake.client), { workflow_id: WF, task_id: TASK_A })
    expect(result.mode).toBe('sync')
    expect((result as any).node_results.peek.output.value).toBe('[Ours]')
  })
})

describe('engine', () => {
  it('never loads another tenant\'s task as {{task.*}}', async () => {
    const fake = seed()
    const result = await executeWorkflow(WF, TASK_B)
    expect(JSON.stringify(result.node_results)).not.toContain('Secret of B')
    expect(fake.tables.tasks.find((t) => t.id === TASK_B)!.title).toBe('Secret of B')
  })

  it('Update Task never writes another tenant\'s task', async () => {
    const fake = seed()
    await executeWorkflow(UPDATE_WF, TASK_B)
    expect(fake.tables.tasks.find((t) => t.id === TASK_B)!.title).toBe('Secret of B')
    await executeWorkflow(UPDATE_WF, TASK_A)
    expect(fake.tables.tasks.find((t) => t.id === TASK_A)!.title).toBe('pwned')
  })

  it('Auto Action fails on a task id of another tenant and leaves it alone', async () => {
    const fake = seed()
    const foreign = await executeWorkflow(AUTO_WF, undefined, false, { target: TASK_B })
    expect(foreign.status).toBe('failed')
    expect(JSON.stringify(foreign)).toContain('not found in this workspace')
    expect(fake.tables.tasks.find((t) => t.id === TASK_B)!.status).toBe('open')

    const own = await executeWorkflow(AUTO_WF, undefined, false, { target: TASK_A })
    expect(own.status).toBe('completed')
    expect(fake.tables.tasks.find((t) => t.id === TASK_A)!.status).toBe('completed')
  })
})
