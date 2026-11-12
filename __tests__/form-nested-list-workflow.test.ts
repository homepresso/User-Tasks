/**
 * Nested Lists in workflows: a Loop over {{form.orders}} with a Loop over
 * {{item.lines}} inside — the inner loop sees its line as {{item}} and the
 * order as {{parent_item}} (also with distinct item variables, order / line),
 * the outer item comes back after the inner loop; the data picker offers the
 * nested fields and the wiring check accepts them.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import { normalizeTaskFields } from '@/lib/task-field-schema'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { buildDataTree } from '@/lib/workflow-data-picker'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { executeWorkflow } from '@/lib/workflow-engine'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000030a'
const WF = '0e000000-0000-4000-8000-0000000003b1'
const LINES = '0e000000-0000-4000-8000-0000000003c2'
const FORM = '0e000000-0000-4000-8000-0000000003d1'

const FIELDS = normalizeTaskFields([
  {
    key: 'orders', label: 'Orders', type: 'list', list: {
      columns: [
        { key: 'customer', label: 'Customer', type: 'text', required: true },
        { key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'sku', label: 'SKU', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'price', label: 'Price', type: 'currency', currency: 'USD' }, { key: 'amount', label: 'Amount', type: 'calculated', formula: 'qty * price', currency: 'USD' }], totals: [{ column: 'amount', fn: 'sum' }] } },
      ],
    },
  },
])

const VALUES = {
  orders: [
    { customer: 'Acme', lines: [{ sku: 'A-1', qty: 2, price: 1250 }, { sku: 'A-2', qty: 1, price: 99.5 }] },
    { customer: 'Globex', lines: [{ sku: 'B-1', qty: 3, price: 10 }] },
  ],
}

function graph(outerVar: string, innerVar: string) {
  const inner = innerVar === 'item' ? 'item' : innerVar
  const nodes = [
    { id: 'trigger', type: 'form_submitted', label: 'Orders submitted', position: { x: 0, y: 0 }, config: { form_id: FORM, form_name: 'Orders', fields: FIELDS } },
    { id: 'orders', type: 'loop', label: 'Each order', position: { x: 0, y: 100 }, config: { items: '{{form.orders}}', item_var: outerVar, index_var: 'index' } },
    { id: 'lines', type: 'loop', label: 'Each line', position: { x: 0, y: 200 }, config: { items: `{{${outerVar}.lines}}`, item_var: innerVar, index_var: 'line_index' } },
    { id: 'insert', type: 'update_data_table', label: 'Insert line', position: { x: 0, y: 300 }, config: { table_id: LINES, table_name: 'Lines', operation: 'insert', column_values: { customer: '{{parent_item.customer}}', order_total: '{{parent_item.lines_total_amount}}', sku: `{{${inner}.sku}}`, amount: `{{${inner}.amount}}`, order_no: '{{parent_index}}', line_no: '{{line_index}}' } } },
    { id: 'after', type: 'update_data_table', label: 'Order done', position: { x: 0, y: 400 }, config: { table_id: LINES, table_name: 'Lines', operation: 'insert', column_values: { customer: `{{${outerVar}.customer}}`, sku: 'ORDER', order_no: '{{index}}', amount: `{{${outerVar}.lines_count}}` } } },
  ]
  const edges = [
    { id: 'e1', source: 'trigger', target: 'orders' },
    { id: 'e2', source: 'orders', target: 'lines', label: 'Each Item' },
    { id: 'e3', source: 'lines', target: 'insert', label: 'Each Item' },
    { id: 'e4', source: 'lines', target: 'after', label: 'Done' },
  ]
  return { nodes, edges }
}

describe('data picker and wiring for nested loops', () => {
  it('offers item.lines in the outer loop, the line\'s columns and parent_item in the inner loop', () => {
    const { nodes, edges } = graph('item', 'item')
    const outerGroups = buildDataTree({ nodes, edges, currentNodeId: 'lines' } as any)
    const outerItem = outerGroups.find((g) => g.kind === 'loop')!.roots.find((r) => r.path === 'item')!
    const lines = outerItem.schema?.fields?.find((f) => f.name === 'lines')
    expect(lines?.type).toBe('array')
    expect(lines?.items?.fields?.map((f) => f.name)).toEqual(['sku', 'qty', 'price', 'amount'])
    expect(outerItem.schema?.fields?.map((f) => f.name)).toEqual(expect.arrayContaining(['customer', 'lines', 'lines_count', 'lines_total_amount']))
    const innerGroups = buildDataTree({ nodes, edges, currentNodeId: 'insert' } as any)
    const current = innerGroups.find((g) => g.kind === 'loop' && g.label === 'Current item')!
    expect(current.roots.find((r) => r.path === 'item')!.schema?.fields?.map((f) => f.name)).toEqual(['sku', 'qty', 'price', 'amount'])
    expect(current.roots.find((r) => r.path === 'parent_item')!.schema?.fields?.map((f) => f.name)).toContain('customer')
    const form = innerGroups.find((g) => g.kind === 'form')!
    expect(form.roots.map((r) => r.path)).toEqual(expect.arrayContaining(['form.orders_lines_count', 'form.orders_lines_counts', 'form.orders_total_lines_amount']))
  })

  it('wiring: no warnings for item.lines, parent_item.* and the nested totals', () => {
    for (const [outer, inner] of [['item', 'item'], ['order', 'line']]) {
      const { nodes, edges } = graph(outer, inner)
      expect(validateWorkflowWiring({ nodes, edges })).toEqual([])
    }
  })
})

describe('engine: a loop inside a loop over a nested List', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is disabled in this test') }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  for (const [outer, inner] of [['item', 'item'], ['order', 'line']]) {
    it(`inner loop sees the line as ${inner} and the order as parent_item; the outer ${outer} comes back after it`, async () => {
      const { nodes, edges } = graph(outer, inner)
      const col = (key: string, type = 'text') => ({ id: `c_${key}`, key, name: key, type, required: false })
      const fake = createFakeSupabase({
        workflows: [{ id: WF, tenant_id: TENANT, name: 'Orders', trigger_type: 'form_submitted', nodes, edges, user_variables: [], run_count: 0, published_version_id: null }],
        custom_tables: [{ id: LINES, tenant_id: TENANT, name: 'Lines', columns: [col('customer'), col('order_total', 'number'), col('sku'), col('amount', 'number'), col('order_no', 'number'), col('line_no', 'number')] }],
        custom_table_rows: [],
      })
      fake.rpcs.record_workflow_run = () => ({})
      fake.rpcs.enqueue_workflow = () => ({ data: crypto.randomUUID() })
      const payload = buildFormSubmittedPayload({ form: { id: FORM, name: 'Orders', version: 1 }, fields: FIELDS, values: VALUES, submission: { id: 's1', created_at: '2026-11-11T00:00:00Z', source: 'standalone' }, submitter: { id: null } })
      expect(payload.form).toMatchObject({ orders_count: 2, orders_lines_count: 3, orders_lines_counts: [2, 1], orders_total_lines_amount: 2629.5 })
      const result = await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
      const run = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as any
      expect(result.status, run?.error).toBe('completed')
      const rows = (fake.tables.custom_table_rows as any[]).map((r) => r.data)
      expect(rows.map((r) => [r.customer, r.sku, Number(r.amount), Number(r.order_no), r.line_no === undefined || r.line_no === null || r.line_no === '' ? null : Number(r.line_no)])).toEqual([
        ['Acme', 'A-1', 2500, 0, 0], ['Acme', 'A-2', 99.5, 0, 1], ['Acme', 'ORDER', 2, 0, null],
        ['Globex', 'B-1', 30, 1, 0], ['Globex', 'ORDER', 1, 1, null],
      ])
      expect(Number(rows[0].order_total)).toBe(2599.5)
    }, 30_000)
  }
})
