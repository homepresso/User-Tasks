/**
 * Ids in node configs (API reference, data table, row) must stay in the run's
 * tenant: the engine's client is service-role, and before the 2026-11 QA pass
 * Call Reference loaded any reference by id (running it with that workspace's
 * decrypted integration credentials) and Update Data Table read / updated /
 * deleted rows by id with no tenant filter. Real engine, in-memory fake.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

import { executeWorkflow } from '@/lib/workflow-engine'
import { createFakeSupabase } from './helpers/fake-supabase'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

const A = '0e5f0000-0000-4000-8000-00000000000a'
const B = '0e5f0000-0000-4000-8000-00000000000b'
const WF = '0e5f0000-0000-4000-8000-0000000000a1'
const REF_B = '0e5f0000-0000-4000-8000-0000000000b1'
const INT_B = '0e5f0000-0000-4000-8000-0000000000b2'
const TABLE_A = '0e5f0000-0000-4000-8000-0000000000a3'
const TABLE_B = '0e5f0000-0000-4000-8000-0000000000b3'
const ROW_B = '0e5f0000-0000-4000-8000-0000000000b4'

const start = { id: 'start', type: 'manual', label: 'Start', config: {} }

function seed(node: Record<string, unknown>) {
  return createFakeSupabase({
    workflows: [{ id: WF, tenant_id: A, name: 'Refs', trigger_type: 'manual', nodes: [start, node], edges: [{ id: 'e1', source: 'start', target: node.id }], run_count: 0, published_version_id: null }],
    integrations: [{ id: INT_B, tenant_id: B, name: 'B ERP', type: 'rest', config: { base_url: 'https://erp-b.example.com', auth_type: 'bearer', token: 'b-secret-token' } }],
    integration_references: [{ id: REF_B, tenant_id: B, integration_id: INT_B, name: 'B vendors', request_config: { method: 'GET', path_template: '/vendors' }, inputs: [], outputs: [], integration: { id: INT_B, tenant_id: B, name: 'B ERP', config: { base_url: 'https://erp-b.example.com', auth_type: 'none' } } }],
    custom_tables: [
      { id: TABLE_A, tenant_id: A, name: 'A table', columns: [{ key: 'name', label: 'Name' }] },
      { id: TABLE_B, tenant_id: B, name: 'B table', columns: [{ key: 'salary', label: 'Salary' }] },
    ],
    custom_table_rows: [{ id: ROW_B, tenant_id: B, table_id: TABLE_B, data: { salary: 250000 }, created_at: '2026-01-01', updated_at: '2026-01-01' }],
  } as any)
}

describe('engine: config ids stay in the run\'s tenant', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
  })

  it('Call Reference with another tenant\'s reference id fails without calling it', async () => {
    const fetchMock = vi.fn(async () => new Response('{"vendors":["secret"]}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const fake = seed({ id: 'ref', type: 'call_reference', label: 'Ref', config: { reference_id: REF_B } })
      const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
      expect(result.status).toBe('failed')
      expect(result.error).toMatch(/Reference not found/)
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('Update Data Table refuses another tenant\'s table', async () => {
    const fake = seed({ id: 'dt', type: 'update_data_table', label: 'DT', config: { table_id: TABLE_B, operation: 'list' } })
    const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(result.status).toBe('failed')
    expect(result.error).toMatch(/Data table not found/)
    expect(JSON.stringify(result)).not.toContain('250000')
  })

  it.each(['get', 'update', 'delete'])('%s by a row id of another tenant (own table) never touches it', async (operation) => {
    const fake = seed({ id: 'dt', type: 'update_data_table', label: 'DT', config: { table_id: TABLE_A, operation, row_id: ROW_B, column_values: { salary: '1' } } })
    const result = await executeWorkflow(WF, undefined, false, {}, undefined, undefined, undefined, { supabase: fake.client })
    expect(JSON.stringify(result)).not.toContain('250000')
    const row = (fake.tables.custom_table_rows as any[]).find((r) => r.id === ROW_B)
    expect(row).toBeTruthy()
    expect(row.data).toEqual({ salary: 250000 })
  })

  it('User Task: an assignee of another workspace is dropped (task created unassigned, warning logged)', async () => {
    const OUTSIDER = '0e5f0000-0000-4000-8000-0000000000c9'
    const MEMBER = '0e5f0000-0000-4000-8000-0000000000c1'
    const node = { id: 'ut', type: 'user_task', label: 'Approve', config: { task_title: 'Approve', assignee_variable: '{{who}}', outcomes: ['OK'] } }
    for (const [who, expected] of [[OUTSIDER, null], [MEMBER, MEMBER]] as const) {
      const fake = seed(node)
      ;(fake.tables as any).users = [{ id: OUTSIDER, tenant_id: B }, { id: MEMBER, tenant_id: A }]
      ;(fake.tables as any).user_memberships = [{ user_id: OUTSIDER, tenant_id: B, is_active: true }]
      const result = await executeWorkflow(WF, undefined, false, { who }, undefined, undefined, undefined, { supabase: fake.client })
      expect(result.status).toBe('waiting_for_event')
      const task = (fake.tables as any).tasks.find((t: any) => t.workflow_step_id === 'ut')
      expect(task.assignee_id ?? null).toBe(expected)
      if (!expected) expect(JSON.stringify(result.logs)).toMatch(/not a member of this workspace/)
    }
  })
})
