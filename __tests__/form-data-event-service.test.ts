/**
 * "Map to data event" service (lib/services/form-data-event.ts): what each
 * permission unlocks (options hidden when the person can't use them), the
 * workflow it creates (a draft, from the editor's form, new tables first,
 * refused while the plan has errors, rolled back on failure), bound workflows
 * as a data event, and the per-item rule step on the server (the item comes
 * from the submitted values, never from the event).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- stubs */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceContext } from '@/lib/services/context'

const ORDERS = '0f000000-0000-4000-8000-0000000b0001'
const LINES = '0f000000-0000-4000-8000-0000000b0002'
const REF = '0f000000-0000-4000-8000-0000000b0003'
const FORM = '0f000000-0000-4000-8000-0000000b0004'
const OTHER_FORM = '0f000000-0000-4000-8000-0000000b0005'

const store = vi.hoisted(() => ({ tables: [] as any[], workflows: [] as any[], created: [] as any[], audits: [] as any[], removed: [] as string[], failWorkflow: false }))

const FORM_ROW = {
  id: '0f000000-0000-4000-8000-0000000b0004', name: 'Order form', version: 2,
  fields: [
    { key: 'customer', label: 'Customer', type: 'text', required: true },
    { key: 'total', label: 'Total', type: 'currency', currency: 'USD' },
    { key: 'lines', label: 'Lines', type: 'repeating_section', repeating_section: { fields: [{ key: 'sku', label: 'SKU', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }] } },
  ],
}

vi.mock('@/lib/services/forms', () => ({ getForm: vi.fn(async () => ({ ...FORM_ROW })) }))
vi.mock('@/lib/services/data-tables', () => ({
  createDataTable: vi.fn(async (_ctx: unknown, input: any) => { const row = { id: `0f000000-0000-4000-8000-00000000c00${store.created.length + 1}`, ...input }; store.created.push(row); return row }),
}))
vi.mock('@/lib/services/workflows', () => ({
  createWorkflow: vi.fn(async (_ctx: unknown, input: any) => { if (store.failWorkflow) throw new Error('boom'); store.workflows.push(input); return { workflow_id: 'w1', name: input.name } }),
}))
vi.mock('@/lib/services/_shared', async (orig) => ({
  ...(await orig<typeof import('@/lib/services/_shared')>()),
  audit: vi.fn(async (_ctx: unknown, row: unknown) => { store.audits.push(row) }),
  serviceRoleClient: vi.fn(async () => ({ from: () => { const q: any = { delete: () => q, eq: (_c: string, v: string) => { if (_c === 'id') store.removed.push(v); return q }, then: (r: any) => r({ data: null, error: null }) }; return q } })),
}))

const { getDataEventOptions, createDataEventWorkflow, planDataEventWorkflow, planDataEventRule, getDataEventStatus, dataEventDestinations, dataEventPermissions } = await import('@/lib/services/form-data-event')

function stubDb() {
  const rows: Record<string, () => any[]> = {
    custom_tables: () => store.tables,
    integration_references: () => [{ id: REF, name: 'Create deal', method: 'POST', inputs: [{ name: 'name', required: true }], integration: { id: 'i1', name: 'CRM' } }],
    workflows: () => [
      { id: 'w-bound', name: 'Save orders', nodes: [{ id: 't', type: 'form_submitted', config: { form_id: FORM } }] },
      { id: 'w-other', name: 'Other', nodes: [{ id: 't', type: 'form_submitted', config: { form_id: OTHER_FORM } }] },
      { id: 'w-task', name: 'Task flow', nodes: [{ id: 't', type: 'user_task', config: { form_id: FORM } }] },
    ],
  }
  return {
    from: (table: string) => {
      const q: any = { select: () => q, eq: () => q, order: () => q, limit: () => q, then: (r: any) => r({ data: (rows[table] ?? (() => []))(), error: null }) }
      return q
    },
  }
}

function ctx(perms: string[]): ServiceContext {
  return { supabase: stubDb() as never, tenantId: 't1', actorId: 'u1', permissions: new Set(perms), authKind: 'session', source: 'ui' } as ServiceContext
}

const ALL = ['forms.view', 'forms.edit', 'data.view', 'data.manage_rows', 'data.create', 'integrations.view', 'integrations.test', 'workflows.create']

const plan = {
  destination: 'workflow',
  steps: [
    { id: 'step_1', target: { kind: 'table', id: ORDERS, name: 'Orders' }, source: '', map: { customer: { kind: 'field', key: 'customer' } } },
    { id: 'step_2', target: { kind: 'table', id: LINES, name: 'Lines' }, source: 'lines', map: { order_id: { kind: 'parent', step: 'step_1' }, sku: { kind: 'field', key: 'sku' } } },
  ],
}

beforeEach(() => {
  store.tables = [
    { id: ORDERS, name: 'Orders', columns: [{ key: 'id', name: 'ID', type: 'number' }, { key: 'customer', name: 'Customer', type: 'text', required: true }] },
    { id: LINES, name: 'Lines', columns: [{ key: 'order_id', name: 'Order id', type: 'text' }, { key: 'sku', name: 'SKU', type: 'text' }] },
  ]
  store.workflows = []; store.created = []; store.audits = []; store.removed = []; store.failWorkflow = false
})

describe('permissions: hide what the person cannot use', () => {
  it('each destination needs its permissions', () => {
    const d = (perms: string[]) => dataEventDestinations(dataEventPermissions(ctx(perms)))
    expect(d(ALL)).toEqual({ direct: true, workflow: true })
    expect(d(['forms.view'])).toEqual({ direct: false, workflow: false })
    // Writing tables from a rule: data.view + data.manage_rows; references: integrations.view + integrations.test.
    expect(d(['forms.edit', 'data.view'])).toEqual({ direct: false, workflow: false })
    expect(d(['forms.edit', 'data.view', 'data.manage_rows'])).toEqual({ direct: true, workflow: false })
    expect(d(['forms.edit', 'integrations.view', 'integrations.test'])).toEqual({ direct: true, workflow: false })
    // A workflow: workflows.create (or edit) and something to write to.
    expect(d(['forms.edit', 'workflows.create', 'data.view'])).toEqual({ direct: false, workflow: true })
    expect(d(['forms.edit', 'workflows.edit', 'data.create'])).toEqual({ direct: false, workflow: true })
    expect(d(['forms.edit', 'workflows.create'])).toEqual({ direct: false, workflow: false })
    // Never without forms.edit.
    expect(d(ALL.filter((x) => x !== 'forms.edit'))).toEqual({ direct: false, workflow: false })
  })

  it('options list only what the person may see, and the form\'s bound workflows', async () => {
    const all = await getDataEventOptions(ctx(ALL), { form_id: FORM })
    expect(all.tables.map((t) => t.name)).toEqual(['Orders', 'Lines'])
    expect(all.tables[0].columns.find((c) => c.key === 'customer')).toMatchObject({ required: true })
    expect(all.references).toMatchObject([{ id: REF, writes: true, integration_id: 'i1', columns: [{ key: 'name', required: true }] }])
    expect(all.bound_workflows).toEqual([{ workflow_id: 'w-bound', workflow_name: 'Save orders', node_type: 'form_submitted' }])
    const none = await getDataEventOptions(ctx(['forms.view']), { form_id: FORM })
    expect(none.tables).toEqual([])
    expect(none.references).toEqual([])
    expect(none.destinations).toEqual({ direct: false, workflow: false })
    await expect(getDataEventOptions(ctx([]))).rejects.toThrow(/forms\.view/)
  })
})

describe('Send to a workflow', () => {
  it('plans without storing anything: outline, no errors, no wiring warnings', async () => {
    const out = await planDataEventWorkflow(ctx(ALL), { form_id: FORM, plan })
    expect(out.problems.filter((p) => p.severity === 'error')).toEqual([])
    expect(out.errors).toEqual([])
    expect(out.warnings).toEqual([])
    expect(out.workflow.outline.map((l) => l.kind)).toEqual(['trigger', 'insert', 'loop', 'insert', 'end'])
    expect(store.workflows).toEqual([])
  })

  it('creates a draft bound to the form (workflows.create)', async () => {
    const out = await createDataEventWorkflow(ctx(ALL), { form_id: FORM, plan })
    expect(out.workflow).toEqual({ id: 'w1', name: 'Order form: save submissions', is_active: false })
    expect(store.workflows).toHaveLength(1)
    const wf = store.workflows[0]
    expect(wf.is_active).toBe(false)
    expect(wf.publish).toBeUndefined()
    expect(wf.trigger_type).toBe('form_submitted')
    expect(wf.nodes[0].config).toMatchObject({ form_id: FORM, form_name: 'Order form', form_cached_version: 2 })
    expect(wf.outline).toBeUndefined()
    expect(store.audits).toHaveLength(1)
  })

  it('creates new tables from the form first and points the steps at them', async () => {
    const out = await createDataEventWorkflow(ctx(ALL), {
      form_id: FORM,
      plan: { destination: 'workflow', steps: [
        { id: 'step_1', target: { kind: 'table', id: 'new:form', name: 'Order form submissions', new_table: true }, source: '', map: { customer: { kind: 'field', key: 'customer' } } },
        { id: 'step_2', target: { kind: 'table', id: 'new:lines', name: 'Order form — Lines', new_table: true }, source: 'lines', map: { parent_row_id: { kind: 'parent', step: 'step_1' }, sku: { kind: 'field', key: 'sku' } } },
      ] },
      new_tables: [
        { source: '', name: 'Order form submissions', columns: [{ key: 'customer', name: 'Customer', type: 'text' }, { key: 'id', name: 'ID', type: 'number' }] },
        { source: 'lines', name: 'Order form — Lines', columns: [{ key: 'parent_row_id', name: 'Parent row', type: 'text' }, { key: 'sku', name: 'SKU', type: 'evil' }] },
      ],
    })
    expect(store.created.map((t) => t.name)).toEqual(['Order form submissions', 'Order form — Lines'])
    // System columns dropped, unknown types become text.
    expect(store.created[0].columns.map((c: any) => c.key)).toEqual(['customer'])
    expect(store.created[1].columns.find((c: any) => c.key === 'sku').type).toBe('text')
    expect(out.tables.map((t) => t.source)).toEqual(['', 'lines'])
    const nodes = store.workflows[0].nodes
    expect(nodes.find((n: any) => n.id === 'step_1').config.table_id).toBe(store.created[0].id)
    expect(nodes.find((n: any) => n.id === 'step_2').config.column_values.parent_row_id).toBe('{{order_form_submission_id}}')
  })

  it('new tables need data.create; a workflow needs workflows.create / edit; the form forms.edit', async () => {
    const withNew = { form_id: FORM, plan: { destination: 'workflow', steps: [{ id: 'step_1', target: { kind: 'table', id: 'new:form', name: 'T', new_table: true }, source: '', map: { customer: { kind: 'field', key: 'customer' } } }] }, new_tables: [{ source: '', name: 'T', columns: [{ key: 'customer', name: 'Customer', type: 'text' }] }] }
    await expect(createDataEventWorkflow(ctx(ALL.filter((x) => x !== 'data.create')), withNew)).rejects.toThrow(/data\.create/)
    await expect(createDataEventWorkflow(ctx(ALL.filter((x) => x !== 'workflows.create')), { form_id: FORM, plan })).rejects.toThrow(/workflows\.edit/)
    await expect(createDataEventWorkflow(ctx(ALL.filter((x) => x !== 'forms.edit')), { form_id: FORM, plan })).rejects.toThrow(/forms\.edit/)
    await expect(createDataEventWorkflow(ctx(ALL.filter((x) => x !== 'data.view')), { form_id: FORM, plan })).rejects.toThrow(/data\.view/)
    expect(store.workflows).toEqual([])
    expect(store.created).toEqual([])
  })

  it('refuses a plan with errors and rolls back new tables when the workflow fails', async () => {
    const bad = { ...plan, steps: [plan.steps[1], plan.steps[0]] }
    // autoOrder fixes the order itself; an unknown field is an error.
    await expect(createDataEventWorkflow(ctx(ALL), { form_id: FORM, plan: { ...bad, steps: [{ ...plan.steps[0], map: { customer: { kind: 'field', key: 'nope' } } }] } })).rejects.toThrow(/not a field/)
    store.failWorkflow = true
    await expect(createDataEventWorkflow(ctx(ALL), {
      form_id: FORM,
      plan: { destination: 'workflow', steps: [{ id: 'step_1', target: { kind: 'table', id: 'new:form', name: 'T', new_table: true }, source: '', map: { customer: { kind: 'field', key: 'customer' } } }] },
      new_tables: [{ source: '', name: 'T', columns: [{ key: 'customer', name: 'Customer', type: 'text' }] }],
    })).rejects.toThrow('boom')
    expect(store.removed).toEqual([store.created[0].id])
  })
})

describe('status and Write directly (the agent / MCP path)', () => {
  it('a workflow bound by its Form submitted trigger is a data event', async () => {
    const status = await getDataEventStatus(ctx(ALL), FORM)
    expect(status.has_data_event).toBe(true)
    expect(status.events.map((e) => e.kind)).toEqual(['workflow'])
    expect(status.sources.map((x) => x.key)).toEqual(['', 'lines'])
  })

  it('compiles the rule (parent first, child per item) and needs the rights the saved rule needs', async () => {
    const direct = { ...plan, destination: 'direct', steps: [plan.steps[1], plan.steps[0]] }
    const out = await planDataEventRule(ctx(ALL), { form_id: FORM, plan: direct })
    expect(out.problems.filter((p) => p.severity === 'error')).toEqual([])
    expect(out.rule).toMatchObject({ event: 'after_submit', server_steps: true })
    expect(out.rule.then.map((a) => [a.type, a.table_id ?? null, a.each_item ?? null])).toEqual([['table_create', ORDERS, null], ['table_create', LINES, 'lines']])
    expect(out.rule.then[1].column_values).toEqual({ order_id: '{{var.order_id}}', sku: '{{row.sku}}' })
    expect(out.variables.map((v) => v.name)).toEqual(['order_id'])
    await expect(planDataEventRule(ctx(ALL.filter((x) => x !== 'data.manage_rows')), { form_id: FORM, plan: direct })).rejects.toThrow(/data\.manage_rows/)
    await expect(planDataEventRule(ctx(ALL.filter((x) => x !== 'integrations.test')), { form_id: FORM, plan: { destination: 'direct', steps: [{ id: 'step_1', target: { kind: 'reference', id: REF, name: 'Create deal' }, source: '', map: { name: { kind: 'field', key: 'customer' } } }] } })).rejects.toThrow(/integrations\.test/)
  })
})
