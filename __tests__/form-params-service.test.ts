import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'
import { FORM_PARAMS_KEY, FORM_VARS_KEY } from '@/lib/forms/form-params'
import { buildTablePlan, dataTableDependencies, normalizeDataTableConfig, normalizeUserQuery } from '@/lib/forms/data-table'

/* eslint-disable @typescript-eslint/no-explicit-any -- fake rows */

/**
 * Form parameters and variables on the server (lib/forms/form-params.ts):
 * Data table queries, API reference calls and rule actions re-validate them
 * against the SAVED form; a crafted value can only fill a placeholder — it
 * can't drop the base filter, widen the projection or reach another
 * reference / URL / header.
 */

const TENANT = 'cccccccc-0000-4000-8000-000000000001'
const FORM = 'cccccccc-0000-4000-8000-000000000002'
const TABLE = 'cccccccc-0000-4000-8000-000000000003'
const TASK = 'cccccccc-0000-4000-8000-000000000004'

const ORDERS = {
  key: 'orders', label: 'Orders', type: 'data_table',
  data_table: {
    source: 'table', table_id: TABLE, mode: 'display', key_column: 'OrderID',
    columns: [{ key: 'OrderID', label: 'Order', type: 'number' }, { key: 'CustomerID', label: 'Customer', type: 'text' }],
    base_filter: { match: 'all', conditions: [{ column: 'CustomerID', operator: 'eq', value: '{{param.customer}}' }, { column: 'ShipRegion', operator: 'eq', value: '{{param.region}}' }] },
  },
}
const LINES = {
  key: 'lines', label: 'Lines', type: 'data_table',
  data_table: {
    source: 'reference', reference_id: 'ref-lines', mode: 'display', key_column: 'id', results_path: 'data',
    input_mappings: { order: '{{var.selected_order}}', customer: '{{param.customer}}' },
    columns: [{ key: 'id', label: 'Id', type: 'text' }, { key: 'product', label: 'Product', type: 'text' }],
  },
}
const BY_CLICK = {
  key: 'by_click', label: 'Same customer', type: 'data_table',
  data_table: {
    source: 'table', table_id: TABLE, mode: 'display', key_column: 'OrderID',
    columns: [{ key: 'OrderID', label: 'Order', type: 'number' }, { key: 'CustomerID', label: 'Customer', type: 'text' }],
    base_filter: { match: 'all', conditions: [{ column: 'CustomerID', operator: 'eq', value: '{{control.orders.last_clicked_row.CustomerID}}' }] },
  },
}
const LAYOUT = {
  rows: [{ columns: 1, cells: [{ field_key: 'orders', span: 1 }] }, { columns: 1, cells: [{ field_key: 'lines', span: 1 }] }],
  params: [
    { name: 'customer', type: 'text', source: 'url', required: true },
    { name: 'region', type: 'text', source: 'url', default: 'EU', allowed: ['EU', 'US'] },
  ],
  variables: [{ name: 'selected_order', type: 'number' }, { name: 'total', type: 'number' }],
  rules: [{ id: 'r_ask', event: 'row_click', target: 'orders', then: [{ type: 'prompt', text: 'Load the total?', prompt: { id: 'load_total', preset: 'yes_no', buttons: [
    { value: 'yes', label: 'Yes', then: [{ type: 'call_reference', reference_id: 'ref-branch', inputs: { order: '{{var.selected_order}}', customer: '{{param.customer}}' }, results: { total: 'var.total' } }] },
    { value: 'no', label: 'No', then: [] },
  ] } }] }, { id: 'r_call', event: 'row_click', target: 'orders', then: [{ type: 'call_reference', reference_id: 'ref-total', inputs: { order: '{{var.selected_order}}' }, results: { total: 'var.total', secret: 'var.not_declared' } }] }],
}

let forms: Record<string, any>
let tasks: Record<string, any>
let orCalls: string[]
let refCalls: any[]

function fakeDb() {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const api: any = {
        select() { return api }, eq(f: string, v: unknown) { filters.push([f, v]); return api }, in() { return api }, order() { return api }, is() { return api },
        range() { return api }, limit() { return api }, abortSignal() { return api }, maybeSingle() { return api },
        or(expr: string) { orCalls.push(expr); return api },
        then(resolve: (v: unknown) => unknown) {
          const get = (f: string) => filters.find(([k]) => k === f)?.[1]
          if (table === 'forms') return Promise.resolve({ data: get('tenant_id') === TENANT ? forms[String(get('id'))] ?? null : null, error: null }).then(resolve)
          if (table === 'tasks') return Promise.resolve({ data: get('tenant_id') === TENANT ? tasks[String(get('id'))] ?? null : null, error: null }).then(resolve)
          if (table === 'custom_tables') return Promise.resolve({ data: { columns: [{ key: 'OrderID', type: 'number' }, { key: 'CustomerID', type: 'text' }, { key: 'ShipRegion', type: 'text' }, { key: 'Secret', type: 'text' }] }, error: null }).then(resolve)
          if (table === 'custom_table_rows') return Promise.resolve({ data: [{ id: 'r1', data: { OrderID: 10248, CustomerID: 'ALFKI', Secret: 'S' } }], count: 1, error: null }).then(resolve)
          return Promise.resolve({ data: null, error: null }).then(resolve)
        },
      }
      return api
    },
  }
}

const db = fakeDb()
vi.mock('@/lib/services/_shared', async (orig) => ({ ...(await orig() as object), serviceRoleClient: async () => db, audit: async () => {} }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: async () => ({ ok: true }) }))
vi.mock('@/lib/providers/cache', () => ({ getCacheStore: async () => null }))

const { queryDataTable, dataTableDeps } = await import('@/lib/services/form-data-table')
const { runRuleAction, ruleActionDeps } = await import('@/lib/services/form-rule-actions')

const ctx = (perms: string[]): ServiceContext => ({ supabase: db as any, tenantId: TENANT, actorId: null, permissions: new Set(perms), authKind: 'api_key', source: 'api' })
const SUBMIT = ctx(['forms.submit', 'data.view', 'tasks.complete'])

beforeEach(() => {
  forms = { [FORM]: { id: FORM, name: 'Customer orders', fields: [ORDERS, LINES, BY_CLICK], layout: LAYOUT } }
  tasks = { [TASK]: { id: TASK, tenant_id: TENANT, title: 'Review', status: 'open', priority: 'normal', metadata: { fields: [ORDERS, LINES], form_layout: LAYOUT, form_params: { customer: 'ANATR' }, template_values: {} } } }
  orCalls = []
  refCalls = []
  const execute = async (opts: any) => {
    refCalls.push(opts)
    return { status: 200, data: { data: [{ id: 'l1', product: 'Chai', secret: 'LEAK' }], total: 42, secret: 'LEAK' } } as any
  }
  dataTableDeps.executeReference = execute
  ruleActionDeps.executeReference = execute
})

describe('Data table base filters with {{param.x}}', () => {
  it('a URL parameter narrows the author’s base filter (default for the rest)', async () => {
    const res = await queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'orders', params: { customer: 'ALFKI' } })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq."ALFKI",data->>ShipRegion.eq."EU"))'])
    expect(res.rows).toEqual([{ key: '10248', values: { OrderID: 10248, CustomerID: 'ALFKI' } }])
    expect(JSON.stringify(res)).not.toContain('Secret')
  })

  it('the values’ reserved key works too (the browser sends it with the form values)', async () => {
    await queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'orders', values: { [FORM_PARAMS_KEY]: { customer: 'BONAP', region: 'US' } } })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq."BONAP",data->>ShipRegion.eq."US"))'])
  })

  it('a crafted value stays one quoted value: it cannot close the term, add an OR or drop the base filter', async () => {
    const crafted = 'ALFKI"),or(id.not.is.null),and(id.eq.x'
    await queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'orders', params: { customer: crafted } })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq."ALFKI\\"),or(id.not.is.null),and(id.eq.x",data->>ShipRegion.eq."EU"))'])
    // Pure plan: same thing, base filter first and whole.
    const config = normalizeDataTableConfig(ORDERS.data_table)!
    const plan = buildTablePlan(config, normalizeUserQuery(config, {}), { values: { [FORM_PARAMS_KEY]: { customer: crafted } } })
    expect(plan.where!.startsWith('and(and(data->>CustomerID.eq."ALFKI\\"')).toBe(true)
  })

  it('a value outside the declared rules is refused, never queried; a missing required one stops the query', async () => {
    await expect(queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'orders', params: { customer: 'ALFKI', region: 'ANY' } })).rejects.toThrow(/"region": .*allowed/)
    await expect(queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'orders' })).rejects.toThrow(/needs the form parameter "customer"/)
    expect(orCalls).toEqual([])
  })

  it('unknown parameters are ignored: they can’t name a table, a filter or a column', async () => {
    await queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'orders', params: { customer: 'ALFKI', table_id: 'other', base_filter: 'none', columns: 'Secret' } as any })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq."ALFKI",data->>ShipRegion.eq."EU"))'])
  })

  it('a task form uses the parameters the workflow passed; the request’s are ignored', async () => {
    await queryDataTable(SUBMIT, { task_id: TASK }, { field_key: 'orders', params: { customer: 'EVILX' }, values: { [FORM_PARAMS_KEY]: { customer: 'EVILX' } } })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq."ANATR",data->>ShipRegion.eq."EU"))'])
  })

  it('the table re-queries when a parameter or variable it reads changes (they are its dependencies)', () => {
    expect(dataTableDependencies(normalizeDataTableConfig(ORDERS.data_table)!)).toEqual([FORM_PARAMS_KEY])
    expect(dataTableDependencies(normalizeDataTableConfig(LINES.data_table)!)).toEqual([FORM_VARS_KEY, FORM_PARAMS_KEY])
  })
})

describe('API reference mappings with {{var.x}} / {{param.x}}', () => {
  it('only the declared reference is called, with the values in the mapped inputs only', async () => {
    const res = await queryDataTable(SUBMIT, { form_id: FORM }, {
      field_key: 'lines',
      params: { customer: 'ALFKI', url: 'https://evil.example', headers: 'x' } as any,
      variables: { selected_order: '10248', reference_id: 'ref-admin' } as any,
    })
    expect(refCalls).toHaveLength(1)
    expect(refCalls[0].referenceId).toBe('ref-lines')
    expect(refCalls[0].inputValues).toEqual({ order: '10248', customer: 'ALFKI' })
    expect(refCalls[0].expectedTenantId).toBe(TENANT)
    expect(JSON.stringify(res)).not.toContain('LEAK')
  })

  it('a variable of the wrong type or size is dropped, not passed through', async () => {
    await queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'lines', params: { customer: 'ALFKI' }, variables: { selected_order: '1; DROP TABLE x' } })
    expect(refCalls[0].inputValues.order).toBe('')
  })
})

describe('rule actions', () => {
  it('Call an API reference: the saved rule’s reference and mapping; results only into declared variables', async () => {
    const res = await runRuleAction(SUBMIT, { form_id: FORM }, {
      rule_id: 'r_call', action_index: 0, idempotency_key: 'key-12345678',
      values: { [FORM_VARS_KEY]: { selected_order: 10248 }, [FORM_PARAMS_KEY]: { customer: 'ALFKI' } },
      event: { row: { OrderID: 10248 }, reference_id: 'ref-admin' },
    })
    expect(refCalls[0].referenceId).toBe('ref-total')
    expect(refCalls[0].inputValues).toEqual({ order: '10248' })
    expect(res.vars).toEqual({ total: 42 })
    expect(res.values).toEqual({})
  })

  it('inside a question\'s Yes branch: the server finds the step by { response, index }, resolves {{var.x}} / {{param.x}}, writes declared variables', async () => {
    const res = await runRuleAction(SUBMIT, { form_id: FORM }, {
      rule_id: 'r_ask', action_index: 0, branch: { response: 'yes', index: 0 }, idempotency_key: 'key-branch-1',
      values: { [FORM_VARS_KEY]: { selected_order: 10248 }, [FORM_PARAMS_KEY]: { customer: 'ALFKI', evil: 'x' } },
    } as any)
    expect(refCalls[0].referenceId).toBe('ref-branch')
    expect(refCalls[0].inputValues).toEqual({ order: '10248', customer: 'ALFKI' })
    expect(res.vars).toEqual({ total: 42 })
    await expect(runRuleAction(SUBMIT, { form_id: FORM }, { rule_id: 'r_ask', action_index: 0, branch: { response: 'no', index: 0 }, idempotency_key: 'key-branch-2' } as any)).rejects.toThrow(/no server action/)
  })
})

describe('control variables in server queries', () => {
  it('{{control.<table>.last_clicked_row.<column>}} narrows another table; only declared columns survive, unknown controls are dropped', async () => {
    await queryDataTable(SUBMIT, { form_id: FORM }, {
      field_key: 'by_click',
      values: { __form_controls: { orders: { last_clicked_row: { CustomerID: 'ALFKI', Secret: 'S' }, last_clicked_row_id: '10248' }, ghost: { x: 1 } } } as any,
    })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq."ALFKI"))'])
    orCalls = []
    // A column the Orders table doesn't declare can't be used to smuggle a value in.
    forms[FORM].fields[2] = { ...BY_CLICK, data_table: { ...BY_CLICK.data_table, base_filter: { match: 'all', conditions: [{ column: 'CustomerID', operator: 'eq', value: '{{control.orders.last_clicked_row.Secret}}' }] } } }
    await queryDataTable(SUBMIT, { form_id: FORM }, { field_key: 'by_click', values: { __form_controls: { orders: { last_clicked_row: { CustomerID: 'ALFKI', Secret: 'S' } } } } as any })
    expect(orCalls).toEqual(['and(and(data->>CustomerID.eq.""))'])
  })
})
