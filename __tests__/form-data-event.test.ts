/**
 * "Map to data event" (lib/forms/data-event.ts, lib/forms/data-event-workflow.ts):
 * detecting a form's data events, the sources (form, repeating sections,
 * Lists), auto-mapping fields to columns with type fit, ordering parent before
 * child with the parent's id fed to the children, the Before submit rule it
 * compiles to (per-item child writes, variables), and the generated workflow
 * (validates, no wiring warnings, loops over repeating sections / Lists).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import {
  autoMap, autoOrder, compileDirectRule, dataEventSources, fieldColumnFit, formDataEvents, hasDataEvent, idFeeds, isDataEventAction,
  moveStep, normalizeDataEventPlan, planProblems, proposeTable, proposedStep, proposedTarget, suggestParentLink, columnTypeFor,
  type DataEventPlan, type DataEventStep, type DataEventTarget,
} from '@/lib/forms/data-event'
import { buildDataEventWorkflow } from '@/lib/forms/data-event-workflow'
import { SERVER_RULE_ACTIONS, normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { TABLE_ACTION_TYPES } from '@/lib/forms/data-actions'
import { describeRuleAction, formRuleProblem, normalizeFormRules } from '@/lib/forms/form-rules'
import { designerRuleProblems, designerStateFrom } from '@/lib/forms/designer-state'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import { validateWorkflow } from '@/lib/workflow-validation'
import { formatWiringWarning, validateWorkflowWiring } from '@/lib/workflow-wiring'

const ORDERS = '0f000000-0000-4000-8000-0000000a0001'
const LINES = '0f000000-0000-4000-8000-0000000a0002'
const SERIALS = '0f000000-0000-4000-8000-0000000a0003'
const CRM_REF = '0f000000-0000-4000-8000-0000000a0004'
const WORKFLOW = '0f000000-0000-4000-8000-0000000a0005'
const FORM_ID = '0f000000-0000-4000-8000-0000000a0006'

const FIELDS: TaskFieldDef[] = normalizeTaskFields([
  { key: 'customer', label: 'Customer', type: 'text', required: true },
  { key: 'order_date', label: 'Order date', type: 'date' },
  { key: 'total', label: 'Total', type: 'currency', currency: 'USD' },
  { key: 'owner', label: 'Owner', type: 'user' },
  { key: 'contract', label: 'Contract', type: 'attachments' },
  { key: 'intro', label: 'Intro', type: 'heading' },
  {
    key: 'lines', label: 'Order lines', type: 'repeating_section',
    repeating_section: {
      fields: [
        { key: 'sku', label: 'SKU', type: 'text', required: true },
        { key: 'qty', label: 'Quantity', type: 'number' },
        { key: 'unit_price', label: 'Unit price', type: 'currency', currency: 'USD' },
        { key: 'serials', label: 'Serials', type: 'list', list: { columns: [{ key: 'serial', label: 'Serial', type: 'text' }] } },
      ],
    },
  },
  { key: 'notes_list', label: 'Notes', type: 'list', list: { columns: [{ key: 'note', label: 'Note', type: 'text' }, { key: 'noted_on', label: 'Noted on', type: 'date' }] } },
] as any)

const TARGETS: DataEventTarget[] = [
  {
    kind: 'table', id: ORDERS, name: 'Orders',
    columns: [
      { key: 'id', label: 'ID', type: 'number' },
      { key: 'customer_name', label: 'Customer', type: 'text', required: true },
      { key: 'order_date', label: 'Order date', type: 'date' },
      { key: 'total', label: 'Total', type: 'number' },
      { key: 'owner', label: 'Owner', type: 'text' },
      { key: 'status', label: 'Status', type: 'select', options: ['New', 'Done'], required: true },
    ],
    child_relations: [{ table_id: LINES, lookup_column: 'order' }],
  },
  {
    kind: 'table', id: LINES, name: 'Order lines',
    columns: [
      { key: 'order', label: 'Order', type: 'lookup', lookup: { sourceTableId: ORDERS, sourceColumn: 'ID' } },
      { key: 'sku', label: 'SKU', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      { key: 'unit_price', label: 'Unit price', type: 'number' },
    ],
  },
  {
    kind: 'table', id: SERIALS, name: 'Serials',
    columns: [{ key: 'parent_row_id', label: 'Parent row', type: 'text' }, { key: 'serial', label: 'Serial', type: 'text' }],
  },
  { kind: 'reference', id: CRM_REF, name: 'Create CRM deal', columns: [{ key: 'name', label: 'name', type: 'string', required: true }, { key: 'amount', label: 'amount', type: 'number' }], writes: true },
]

const sources = dataEventSources(FIELDS, 'Order form')

function plan(destination: 'direct' | 'workflow', steps: DataEventStep[]): DataEventPlan {
  return { destination, steps }
}

const parentStep = (): DataEventStep => ({
  id: 'step_1', target: { kind: 'table', id: ORDERS, name: 'Orders' }, source: '',
  map: { customer_name: { kind: 'field', key: 'customer' }, total: { kind: 'field', key: 'total' }, status: { kind: 'text', value: 'New' } },
})
const lineStep = (): DataEventStep => ({
  id: 'step_2', target: { kind: 'table', id: LINES, name: 'Order lines' }, source: 'lines',
  map: { order: { kind: 'parent', step: 'step_1', path: 'row.id' }, sku: { kind: 'field', key: 'sku' }, quantity: { kind: 'field', key: 'qty' } },
})

describe('data event detection', () => {
  it('every server rule action but the table reads counts (new kinds count automatically)', () => {
    for (const type of SERVER_RULE_ACTIONS) {
      const read = type === 'table_read' || type === 'table_list'
      expect(isDataEventAction({ type }), type).toBe(!read)
    }
    expect(TABLE_ACTION_TYPES.filter((t) => isDataEventAction({ type: t }))).toEqual(['table_create', 'table_update', 'table_delete'])
    // A Data table row's "Save now" writes; the staged commit does not.
    expect(isDataEventAction({ type: 'commit_row', commit_mode: 'save_now' })).toBe(true)
    expect(isDataEventAction({ type: 'commit_row' })).toBe(false)
    for (const type of ['show_hide', 'set_values', 'message', 'run_lookup', 'refresh'] as const) expect(isDataEventAction({ type })).toBe(false)
  })

  it('a form without writes has none; reads, display rules and disabled rules do not count', () => {
    const layout = { rows: [], rules: [
      { id: 'r1', event: 'form_load', then: [{ type: 'table_read', table_id: ORDERS, row_id: '{{param.id}}' }] },
      { id: 'r2', event: 'value_change', target: 'customer', then: [{ type: 'set_values', assign: { total: '1' } }] },
      { id: 'r3', event: 'before_submit', disabled: true, then: [{ type: 'table_create', table_id: ORDERS, column_values: { customer_name: '{{customer}}' } }] },
    ] }
    expect(formDataEvents({ fields: FIELDS, layout })).toEqual([])
    expect(hasDataEvent({ fields: FIELDS, layout, buttons: null })).toBe(false)
  })

  it('rule writes, API calls, workflow starts (also inside on-success steps and question answers) count', () => {
    const cases: any[] = [
      { id: 'a', event: 'before_submit', then: [{ type: 'table_create', table_id: ORDERS, column_values: { a: '1' } }] },
      { id: 'b', event: 'button_click', target: 'x', then: [{ type: 'call_reference', reference_id: CRM_REF }] },
      { id: 'c', event: 'after_submit', then: [{ type: 'start_workflow', workflow_id: WORKFLOW }] },
      { id: 'd', event: 'form_load', then: [{ type: 'table_read', table_id: ORDERS, row_id: '1', on_success: [{ type: 'table_update', table_id: ORDERS, row_id: '{{result.row_id}}', column_values: { a: '1' } }] }] },
      { id: 'e', event: 'button_click', target: 'x', then: [{ type: 'prompt', text: 'Sure?', prompt: { display: 'dialog', preset: 'yes_no', buttons: [{ value: 'yes', label: 'Yes', then: [{ type: 'table_delete', table_id: ORDERS, row_id: '{{x}}' }] }, { value: 'no', label: 'No' }] } }] },
    ]
    for (const rule of cases) {
      const events = formDataEvents({ fields: FIELDS, layout: { rows: [], rules: [rule] } })
      expect(events.length, rule.id).toBe(1)
      expect(events[0].kind).toBe('rule')
    }
  })

  it('item rules of a repeating section, bar buttons, a saving data binding, a data target and a bound workflow count', () => {
    const fields = normalizeTaskFields([{ key: 'items', label: 'Items', type: 'repeating_section', repeating_section: { fields: [{ key: 'a', label: 'A', type: 'text' }], layout: { rows: [], rules: [{ id: 'ir', event: 'value_change', target: 'a', then: [{ type: 'call_reference', reference_id: CRM_REF }] }] } } }] as any)
    expect(formDataEvents({ fields }).map((e) => e.kind)).toEqual(['rule'])
    expect(formDataEvents({ fields: FIELDS, buttons: [{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary', actions: [{ type: 'start_workflow', workflow_id: WORKFLOW }] }] }).map((e) => e.kind)).toEqual(['button'])
    expect(formDataEvents({ fields: FIELDS, buttons: [{ id: 'submit', label: 'Submit', kind: 'submit', style: 'primary', actions: [{ type: 'message', text: 'Thanks' }] }] })).toEqual([])
    expect(formDataEvents({ fields: FIELDS, layout: { rows: [], data_binding: { kind: 'table', source_id: ORDERS, fields: { customer: 'customer_name' }, save: true } } }).map((e) => e.kind)).toEqual(['binding'])
    expect(formDataEvents({ fields: FIELDS, layout: { rows: [], data_binding: { kind: 'table', source_id: ORDERS, fields: { customer: 'customer_name' } } } })).toEqual([])
    expect(formDataEvents({ fields: FIELDS, layout: { rows: [], data_target: { extension: 'sharepoint', key: 'list_item', config: {} } } }).map((e) => e.kind)).toEqual(['target'])
    const bound = [{ workflow_id: WORKFLOW, workflow_name: 'Save orders', node_type: 'form_submitted' }, { workflow_id: 'w2', workflow_name: 'Approve', node_type: 'user_task' }]
    expect(formDataEvents({ fields: FIELDS }, { boundWorkflows: bound }).map((e) => e.label)).toEqual(['Workflow "Save orders" starts when the form is submitted'])
  })
})

describe('sources and type fit', () => {
  it('lists the form, each repeating section / List and nested Lists with their value fields', () => {
    expect(sources.map((s) => [s.key, s.kind, s.parent, s.depth])).toEqual([
      ['', 'form', null, 0], ['lines', 'repeating_section', '', 1], ['serials', 'list', 'lines', 2], ['notes_list', 'list', '', 1],
    ])
    expect(sources[0].fields.map((f) => f.key)).toEqual(['customer', 'order_date', 'total', 'owner', 'contract'])
    expect(sources[1].fields.map((f) => f.key)).toEqual(['sku', 'qty', 'unit_price'])
  })

  it('maps types sensibly and warns on mismatches', () => {
    expect(fieldColumnFit('number', 'number').level).toBe('ok')
    expect(fieldColumnFit('currency', 'number').level).toBe('ok')
    expect(fieldColumnFit('user', 'text').level).toBe('ok')
    expect(fieldColumnFit('attachments', 'file').level).toBe('ok')
    expect(fieldColumnFit('text', 'number')).toEqual({ level: 'warn', note: 'Must hold a number' })
    expect(fieldColumnFit('date', 'number').level).toBe('bad')
    expect(fieldColumnFit('text', 'file').level).toBe('bad')
    expect(fieldColumnFit('multi_choice', 'text').level).toBe('warn')
    expect(columnTypeFor('currency')).toBe('number')
    expect(columnTypeFor('user')).toBe('text')
    expect(columnTypeFor('attachments')).toBe('file')
    expect(columnTypeFor('choice')).toBe('select')
  })
})

describe('auto-mapping', () => {
  it('matches names and labels (exact first), never a value that cannot fit, each field once', () => {
    const map = autoMap(sources[0].fields, TARGETS[0].columns)
    expect(map).toEqual({
      customer_name: { kind: 'field', key: 'customer' }, // label "Customer" = column label
      order_date: { kind: 'field', key: 'order_date' },
      total: { kind: 'field', key: 'total' },
      owner: { kind: 'field', key: 'owner' },
    })
    // System columns and existing mappings are left alone.
    expect(autoMap(sources[0].fields, TARGETS[0].columns, { total: { kind: 'text', value: '0' } }).total).toEqual({ kind: 'text', value: '0' })
    expect(autoMap([{ key: 'id', label: 'ID', type: 'number', required: false }], TARGETS[0].columns)).toEqual({})
    // A date never lands in a number column even when the names match.
    expect(autoMap([{ key: 'total', label: 'Total', type: 'date', required: false }], TARGETS[0].columns)).toEqual({})
    // Item fields → the child table (label "Quantity" matches).
    expect(autoMap(sources[1].fields, TARGETS[1].columns)).toEqual({ sku: { kind: 'field', key: 'sku' }, quantity: { kind: 'field', key: 'qty' }, unit_price: { kind: 'field', key: 'unit_price' } })
  })

  it('links a child step to its parent through the child relation / lookup column, or a parent id column', () => {
    const child: DataEventStep = { id: 'step_2', target: { kind: 'table', id: LINES, name: 'Order lines' }, source: 'lines', map: {} }
    expect(suggestParentLink(child, parentStep(), TARGETS)).toEqual({ order: { kind: 'parent', step: 'step_1', path: 'row.id' } })
    const serial: DataEventStep = { id: 'step_3', target: { kind: 'table', id: SERIALS, name: 'Serials' }, source: 'serials', map: {} }
    expect(suggestParentLink(serial, child, TARGETS)).toEqual({ parent_row_id: { kind: 'parent', step: 'step_2', path: 'row_id' } })
  })
})

describe('order: parent before child, the parent id fed to the children', () => {
  it('autoOrder puts the parent first; problems flag a child before its parent', () => {
    const steps = [lineStep(), parentStep()]
    expect(planProblems(plan('direct', steps), sources, TARGETS).filter((p) => p.severity === 'error').map((p) => p.message)).toEqual(['Order lines must run after Orders (it reads that record\'s id)'])
    const ordered = autoOrder(steps, sources)
    expect(ordered.map((s) => s.id)).toEqual(['step_1', 'step_2'])
    expect(planProblems(plan('direct', ordered), sources, TARGETS).filter((p) => p.severity === 'error')).toEqual([])
    expect(moveStep(ordered, 'step_2', -1).map((s) => s.id)).toEqual(['step_2', 'step_1'])
    expect(moveStep(ordered, 'step_1', -1)).toBe(ordered)
    expect(idFeeds(ordered)).toEqual([{ from: 'step_1', to: 'step_2', column: 'order', path: 'row.id' }])
  })

  it('flags type mismatches, unknown fields, required columns and nested items in a rule', () => {
    const bad: DataEventStep = { ...parentStep(), map: { total: { kind: 'field', key: 'order_date' }, customer_name: { kind: 'field', key: 'sku' } } }
    const problems = planProblems(plan('direct', [bad]), sources, TARGETS)
    expect(problems.filter((p) => p.severity === 'error').map((p) => p.message)).toEqual([
      'Orders: Order date → Total: A number column cannot hold this value',
      'Orders: "sku" is not a field of the form',
    ])
    expect(problems.filter((p) => p.severity === 'warning').map((p) => p.message)).toContain('Orders: required column "Status" has no value')
    const nested: DataEventStep = { id: 'step_3', target: { kind: 'table', id: SERIALS, name: 'Serials' }, source: 'serials', map: { serial: { kind: 'field', key: 'serial' } } }
    expect(planProblems(plan('direct', [parentStep(), lineStep(), nested]), sources, TARGETS).some((p) => p.severity === 'error' && p.message.includes('nested'))).toBe(true)
    expect(planProblems(plan('workflow', [parentStep(), lineStep(), nested]), sources, TARGETS).some((p) => p.severity === 'error')).toBe(false)
    expect(planProblems(plan('direct', []), sources, TARGETS)[0].message).toBe('Pick at least one table or API reference')
  })

  it('normalizes a plan from the wire (unknown shapes dropped)', () => {
    const p = normalizeDataEventPlan({ destination: 'workflow', open_access: true, steps: [{ id: 'step_1', target: { kind: 'table', id: ORDERS, name: 'Orders' }, source: '', map: { a: { kind: 'field', key: 'customer' }, 'bad key!': { kind: 'field', key: 'x' }, b: { kind: 'evil' } } }, { target: { kind: 'nope', id: 'x' } }] })
    expect(p).toEqual({ destination: 'workflow', steps: [{ id: 'step_1', target: { kind: 'table', id: ORDERS, name: 'Orders' }, source: '', map: { a: { kind: 'field', key: 'customer' } } }] })
  })
})

describe('option 1: write directly (an After submit rule that writes on the server)', () => {
  const steps = [parentStep(), lineStep(), {
    id: 'step_3', target: { kind: 'reference', id: CRM_REF, name: 'Create CRM deal' }, source: '',
    map: { name: { kind: 'field', key: 'customer' }, amount: { kind: 'field', key: 'total' } },
  } as DataEventStep]
  const { rule, variables } = compileDirectRule(plan('direct', steps), sources, { ruleIds: [], variables: [], formName: 'Order form' })

  it('runs the steps in order after the submission is accepted, the parent id in a variable the child reads, once per item', () => {
    // After submit, on the server: a submission the browser or the server refuses never reaches the writes.
    expect(rule.event).toBe('after_submit')
    expect(rule.server_steps).toBe(true)
    expect(rule.then.map((a) => a.type)).toEqual(['table_create', 'table_create', 'call_reference'])
    expect(rule.then[0]).toMatchObject({ table_id: ORDERS, column_values: { customer_name: '{{form.customer}}', total: '{{form.total}}', status: 'New' }, outputs: [{ path: 'row.id', to: 'var.order_column_id' }] })
    expect(rule.then[1]).toMatchObject({ table_id: LINES, each_item: 'lines', column_values: { order: '{{var.order_column_id}}', sku: '{{row.sku}}', quantity: '{{row.qty}}' } })
    expect(rule.then[1].outputs).toBeUndefined()
    expect(rule.then[2]).toMatchObject({ type: 'call_reference', reference_id: CRM_REF, inputs: { name: '{{form.customer}}', amount: '{{form.total}}' } })
    expect(rule.description).toContain('once a submission is accepted')
    // Variables named like a person would (after the record, not the wizard's step numbers).
    expect(variables).toEqual([{ name: 'order_column_id', label: 'Orders id', type: 'text' }])
  })

  it('survives normalization and passes the designer\'s rule checks', () => {
    const [normalized] = normalizeFormRules([rule])
    expect(normalized).toEqual(rule)
    expect(normalized.then[1].each_item).toBe('lines')
    expect(normalized.then[0].outputs).toEqual([{ path: 'row.id', to: 'var.order_column_id' }])
    const def = normalizeFormDefinition({ fields: FIELDS, layout: { rows: [], rules: [rule], variables } })
    expect(designerRuleProblems(designerStateFrom(def))).toEqual({})
    expect(describeRuleAction(def as any, normalized.then[1])).toContain('for each item of Order lines')
    // each_item must name a repeating section or List.
    const known = { fieldKeys: new Set(['customer', 'lines']), valueKeys: new Set(['customer']), fieldTypes: new Map([['customer', 'text'], ['lines', 'list']]), pageIds: new Set<string>(), flags: new Set<string>(), variables: new Set(['order_column_id']) }
    expect(formRuleProblem({ ...normalized, then: [{ ...normalized.then[1], each_item: 'customer' }] }, known)).toContain('is not a repeating section, List or Data table')
    // The new form now has a data event (the option disappears).
    expect(hasDataEvent(def)).toBe(true)
  })

  it('a server_steps rule takes data writes only, results into variables only, no branches', () => {
    const known = { fieldKeys: new Set(['customer', 'lines']), valueKeys: new Set(['customer']), fieldTypes: new Map([['customer', 'text'], ['lines', 'list']]), pageIds: new Set<string>(), flags: new Set<string>(), variables: new Set(['order_column_id']) }
    expect(formRuleProblem(rule, known)).toBeNull()
    expect(formRuleProblem({ ...rule, then: [...rule.then, { type: 'message', text: 'Hi' }] }, known)).toMatch(/writes data after the submission is accepted/)
    expect(formRuleProblem({ ...rule, then: [{ ...rule.then[0], outputs: [{ path: 'row_id', to: 'customer' }] }] }, known)).toMatch(/only variables can take a result/)
    expect(formRuleProblem({ ...rule, then: [{ ...rule.then[0], on_success: [{ type: 'message', text: 'ok' }] }] }, known)).toMatch(/no on-success/)
    // The flag means nothing on other events (dropped), and a plain After submit rule is checked as before.
    expect(normalizeFormRules([{ ...rule, event: 'before_submit' }])[0].server_steps).toBeUndefined()
    expect(formRuleProblem({ ...rule, server_steps: undefined }, known)).toMatch(/After submit runs on the server/)
  })

  it('existing After submit rules behave exactly as before; only server_steps rules are picked for the writes', async () => {
    const { afterSubmitActions, submittedServerRules } = await import('@/lib/forms/form-rules')
    const plain = { id: 'r_plain', event: 'after_submit', then: [{ type: 'message', text: 'Thanks {{form.customer}}' }] }
    const layout = { rules: [plain, rule, { ...rule, id: 'r_off', disabled: true }, { ...rule, id: 'r_other_button', target: 'approve' }] }
    expect(afterSubmitActions(layout, 'submit', { customer: 'Acme' })).toEqual([{ type: 'message', text: 'Thanks Acme', tone: 'info' }])
    expect(submittedServerRules(layout, 'submit', { customer: 'Acme' }).map((r) => r.id)).toEqual([rule.id])
    expect(submittedServerRules(layout, 'approve', {}).map((r) => r.id)).toEqual([rule.id, 'r_other_button'])
    // A condition is judged on the stored values.
    const gated = { ...rule, id: 'r_gated', if: { match: 'all', conditions: [{ column: 'customer', operator: 'eq', value: 'Acme' }] } }
    expect(submittedServerRules({ rules: [gated] }, 'submit', { customer: 'Other' })).toEqual([])
    expect(submittedServerRules({ rules: [gated] }, 'submit', { customer: 'Acme' })).toHaveLength(1)
    expect(submittedServerRules({ rules: [plain] }, 'submit', {})).toEqual([])
    // The browser's rule-action endpoint can't reach these steps (they run only from an accepted submission).
    const { findServerRuleAction } = await import('@/lib/forms/form-rules')
    expect(findServerRuleAction({ rules: [rule] }, rule.id, 0)).toBeNull()
    expect(findServerRuleAction({ rules: [{ ...rule, event: 'before_submit', server_steps: undefined }] }, rule.id, 0)).not.toBeNull()
  })

  it('keeps clear of variables the form already declares; open access only when asked', () => {
    const again = compileDirectRule({ ...plan('direct', steps), open_access: true }, sources, { variables: ['order_column_id'] })
    expect(again.variables[0].name).toBe('order_column_id_2')
    expect(again.rule.then[1].column_values?.order).toBe('{{var.order_column_id_2}}')
    expect(again.rule.then[0].open_access).toBe(true)
    expect(rule.then[0].open_access).toBeUndefined()
  })

  it('each_item only on writes and API calls, and each_selected wins', () => {
    expect(normalizeFieldButtonAction({ type: 'table_read', table_id: ORDERS, row_id: '1', each_item: 'lines' }, { rule: true })?.each_item).toBeUndefined()
    expect(normalizeFieldButtonAction({ type: 'table_create', table_id: ORDERS, column_values: { a: '1' }, each_item: 'lines' }, { rule: true })?.each_item).toBe('lines')
    expect(normalizeFieldButtonAction({ type: 'table_delete', table_id: ORDERS, row_id: '{{row.row_id}}', each_item: 'lines', each_selected: 'lines' }, { rule: true })?.each_item).toBeUndefined()
    expect(normalizeFieldButtonAction({ type: 'call_reference', reference_id: CRM_REF, each_item: 'Bad Key' }, { rule: true })?.each_item).toBeUndefined()
  })

  it('a hand-built Before submit each_item step still runs once per item in the browser runner', async () => {
    const calls: Array<{ index: number; type: string; event: any }> = []
    let values: Record<string, unknown> = { customer: 'Acme', lines: [{ sku: 'A-1', qty: 2 }, { sku: 'B-2', qty: 5 }, { sku: 'C-3', qty: 1 }] }
    const host: FieldButtonHost = {
      values: () => values, state: () => ({}) as any, setValues: (patch: Record<string, unknown>) => { values = { ...values, ...patch } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, previous: () => true, validate: () => true, submit: async () => true, print: () => {}, openLink: () => {}, message: () => {},
      runExtra: async (index: number, action: any, _values: unknown, _branch: unknown, event: any) => { calls.push({ index, type: action.type, event }); return undefined },
    } as unknown as FieldButtonHost
    await runFieldButton({ actions: rule.then }, host)
    expect(calls.map((c) => [c.index, c.type, c.event?.index ?? null])).toEqual([[0, 'table_create', null], [1, 'table_create', 0], [1, 'table_create', 1], [1, 'table_create', 2], [2, 'call_reference', null]])
    expect(calls[2].event.row).toEqual({ sku: 'B-2', qty: 5 })
    calls.length = 0
    values = { customer: 'Acme', lines: [] }
    await runFieldButton({ actions: rule.then }, host)
    expect(calls.map((c) => c.index)).toEqual([0, 2])
  })
})

describe('option 2: send to a workflow', () => {
  const form = { id: FORM_ID, name: 'Order form', version: 3, fields: FIELDS }
  const serialStep: DataEventStep = { id: 'step_3', target: { kind: 'table', id: SERIALS, name: 'Serials' }, source: 'serials', map: { parent_row_id: { kind: 'parent', step: 'step_2', path: 'row_id' }, serial: { kind: 'field', key: 'serial' } } }
  const noteStep: DataEventStep = { id: 'step_4', target: { kind: 'reference', id: CRM_REF, name: 'Create CRM deal' }, source: 'notes_list', map: { name: { kind: 'field', key: 'note' }, amount: { kind: 'parent', step: 'step_1', path: 'row_id' } } }
  const steps = [parentStep(), lineStep(), serialStep, noteStep]
  const wf = buildDataEventWorkflow(plan('workflow', steps), form, sources, TARGETS)

  it('a form-submitted start bound to the form, inserts, a loop per section / List (nested inside its parent)', () => {
    expect(wf.trigger_type).toBe('form_submitted')
    expect(wf.nodes[0]).toMatchObject({ id: 'trigger', type: 'form_submitted', config: { form_id: FORM_ID, form_name: 'Order form', form_cached_version: 3 } })
    expect(wf.outline.map((l) => `${'  '.repeat(l.depth)}${l.text}`)).toEqual([
      'When "Order form" is submitted',
      'Add a row to Orders (3 columns)',
      'For each item of Order lines',
      '  Add a row to Order lines (3 columns)',
      '  For each item of Serials',
      '    Add a row to Serials (2 columns)',
      'For each item of Notes',
      '  Call Create CRM deal',
      'End',
    ])
    const node = (id: string) => wf.nodes.find((n) => n.id === id)!
    expect(node('step_1').config).toMatchObject({ operation: 'insert', column_values: { customer_name: '{{form.customer}}', status: 'New' }, output_row_id_var: 'order_id', output_row_var: 'order_row' })
    expect(node('loop_1').config.items).toBe('{{form.lines}}')
    expect(node('loop_2').config.items).toBe('{{item.serials}}')
    expect(node('loop_3').config.items).toBe('{{form.notes_list}}')
    expect(node('step_2').config.column_values).toEqual({ order: '{{order_row.id}}', sku: '{{item.sku}}', quantity: '{{item.qty}}' })
    expect(node('step_3').config.column_values).toEqual({ parent_row_id: '{{order_line_id}}', serial: '{{item.serial}}' })
    expect(node('step_4').config).toMatchObject({ reference_id: CRM_REF, input_mappings: { name: '{{item.note}}', amount: '{{order_id}}' } })
    const edge = (s: string, t: string) => wf.edges.find((e) => e.source === s && e.target === t)
    expect(edge('trigger', 'step_1')).toBeTruthy()
    expect(edge('step_1', 'loop_1')?.label).toBeUndefined()
    expect(edge('loop_1', 'step_2')?.label).toBe('Each Item')
    expect(edge('step_2', 'loop_2')?.label).toBeUndefined()
    expect(edge('loop_2', 'step_3')?.label).toBe('Each Item')
    expect(edge('loop_1', 'loop_3')?.label).toBe('Done')
    expect(edge('loop_3', 'step_4')?.label).toBe('Each Item')
    expect(edge('loop_3', 'done')?.label).toBe('Done')
    expect(wf.edges).toHaveLength(8)
  })

  it('validates with no errors and no wiring warnings', () => {
    expect(validateWorkflow(wf.nodes as any, wf.trigger_type)).toMatchObject({ valid: true, totalErrors: 0 })
    expect(validateWorkflowWiring({ nodes: wf.nodes, edges: wf.edges }).map(formatWiringWarning)).toEqual([])
    // The check is real: a field the form does not have, or an id nothing outputs, is reported.
    const broken = wf.nodes.map((n) => (n.id === 'step_2' ? { ...n, config: { ...n.config, column_values: { ...n.config.column_values, sku: '{{form.nope}}', order: '{{step_9_id}}' } } } : n))
    expect(validateWorkflowWiring({ nodes: broken, edges: wf.edges }).length).toBeGreaterThanOrEqual(2)
  })

  it('a reference whose id a later step reads is kept in a variable (Set variable)', () => {
    const ref: DataEventStep = { id: 'step_1', target: { kind: 'reference', id: CRM_REF, name: 'Create CRM deal' }, source: '', map: { name: { kind: 'field', key: 'customer' } }, id_path: 'deal.id' }
    const child: DataEventStep = { id: 'step_2', target: { kind: 'table', id: LINES, name: 'Order lines' }, source: 'lines', map: { sku: { kind: 'field', key: 'sku' }, order: { kind: 'parent', step: 'step_1' } } }
    const w = buildDataEventWorkflow(plan('workflow', [ref, child]), form, sources, TARGETS)
    expect(w.nodes.find((n) => n.id === 'step_1_keep')?.config).toEqual({ assignments: [{ name: 'crm_deal_id', expression: '{{response.deal.id}}' }] })
    expect(w.nodes.find((n) => n.id === 'step_2')?.config.column_values.order).toBe('{{crm_deal_id}}')
    expect(validateWorkflow(w.nodes as any, w.trigger_type).valid).toBe(true)
    expect(validateWorkflowWiring({ nodes: w.nodes, edges: w.edges }).map(formatWiringWarning)).toEqual([])
  })

  it('new tables proposed from the form structure map every field and link children to the parent row', () => {
    const parentTable = proposeTable(sources[0], 'Order form')
    const lineTable = proposeTable(sources[1], 'Order form')
    expect(parentTable).toMatchObject({ source: '', name: 'Order form submissions' })
    expect(parentTable.columns.map((c) => [c.key, c.type])).toEqual([['customer', 'text'], ['order_date', 'date'], ['total', 'number'], ['owner', 'text'], ['contract', 'file']])
    expect(lineTable.columns.map((c) => c.key)).toEqual(['parent_row_id', 'sku', 'qty', 'unit_price'])
    const p = proposedStep(parentTable, sources[0], 'step_1')
    const c = proposedStep(lineTable, sources[1], 'step_2', p)
    expect(c.map.parent_row_id).toEqual({ kind: 'parent', step: 'step_1', path: 'row_id' })
    const targets = [proposedTarget(parentTable), proposedTarget(lineTable)]
    expect(planProblems(plan('workflow', [p, c]), sources, targets)).toEqual([])
    const w = buildDataEventWorkflow(plan('workflow', [p, c]), form, sources, targets)
    expect(validateWorkflowWiring({ nodes: w.nodes, edges: w.edges }).map(formatWiringWarning)).toEqual([])
  })
})

describe('auto-mapping never guesses a lookup link', () => {
  it('a lookup column is left for the parent link (no "Order date" into "Order")', () => {
    expect(autoMap(sources[0].fields, TARGETS[1].columns)).toEqual({})
    const child: DataEventStep = { id: 'step_2', target: { kind: 'table', id: LINES, name: 'Order lines' }, source: 'lines', map: {} }
    const linked = suggestParentLink(child, parentStep(), TARGETS)
    expect(autoMap([...sources[1].fields, ...sources[0].fields], TARGETS[1].columns, linked).order).toEqual({ kind: 'parent', step: 'step_1', path: 'row.id' })
  })
})

describe('grids (editable Data tables) as child sources', () => {
  const PARTS_SOURCE = '0f000000-0000-4000-8000-0000000a0010'
  const PARTS = '0f000000-0000-4000-8000-0000000a0011'
  const GRID_FIELDS: TaskFieldDef[] = normalizeTaskFields([
    ...FIELDS,
    {
      key: 'parts', label: 'Parts', type: 'data_table',
      data_table: {
        source: 'table', table_id: PARTS_SOURCE, mode: 'edit', key_column: 'row_id', allow_add: true,
        columns: [{ key: 'part_no', label: 'Part no', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }, { key: 'stock', label: 'Stock', type: 'number', read_only: true }],
      },
    },
    { key: 'pick', label: 'Pick a vendor', type: 'data_table', data_table: { source: 'table', table_id: PARTS_SOURCE, mode: 'select', key_column: 'row_id', columns: [{ key: 'vendor', label: 'Vendor', type: 'text' }] } },
    { key: 'view', label: 'Read-only rows', type: 'data_table', data_table: { source: 'table', table_id: PARTS_SOURCE, mode: 'display', columns: [{ key: 'x', label: 'X', type: 'text' }] } },
  ] as any)
  const gridSources = dataEventSources(GRID_FIELDS, 'Order form')
  const PARTS_TARGET: DataEventTarget = { kind: 'table', id: PARTS, name: 'Order parts', columns: [{ key: 'parent_row_id', label: 'Parent row', type: 'text' }, { key: 'part_no', label: 'Part no', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }] }
  const targets = [...TARGETS, PARTS_TARGET]
  const partStep: DataEventStep = { id: 'step_3', target: { kind: 'table', id: PARTS, name: 'Order parts' }, source: 'parts', map: { parent_row_id: { kind: 'parent', step: 'step_1', path: 'row_id' }, part_no: { kind: 'field', key: 'part_no' }, qty: { kind: 'field', key: 'qty' } } }

  it('an editable table (rows added) and a Select table (rows selected) are sources; a read-only table is not', () => {
    const grid = gridSources.find((s) => s.key === 'parts')!
    expect(grid).toMatchObject({ kind: 'grid', rows: 'added', parent: '', depth: 1 })
    // The columns a person fills in when adding a row (a read-only column is not one).
    expect(grid.fields).toEqual([{ key: 'part_no', label: 'Part no', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number', required: false }])
    expect(gridSources.find((s) => s.key === 'pick')).toMatchObject({ kind: 'grid', rows: 'selected' })
    expect(gridSources.some((s) => s.key === 'view')).toBe(false)
    // Auto-mapping and type fit work on grid columns like on any field.
    expect(autoMap(grid.fields, PARTS_TARGET.columns)).toEqual({ part_no: { kind: 'field', key: 'part_no' }, qty: { kind: 'field', key: 'qty' } })
    expect(proposeTable(grid, 'Order form').columns.map((c) => [c.key, c.type])).toEqual([['parent_row_id', 'text'], ['part_no', 'text'], ['qty', 'number']])
  })

  it('Write directly: one row per added grid row, linked to the parent id, and the runner reads the added rows', async () => {
    const p = plan('direct', [parentStep(), lineStep(), partStep])
    expect(planProblems(p, gridSources, targets).filter((x) => x.severity === 'error')).toEqual([])
    const { rule } = compileDirectRule(p, gridSources, { formName: 'Order form' })
    expect(rule.then[2]).toMatchObject({ type: 'table_create', table_id: PARTS, each_item: 'parts', column_values: { parent_row_id: '{{var.order_id}}', part_no: '{{row.part_no}}', qty: '{{row.qty}}' } })
    expect(rule.description).toContain('for each row added to Parts')
    // The saved form takes it (each_item may name a Data table).
    const def = normalizeFormDefinition({ fields: GRID_FIELDS, layout: { rows: [], rules: [rule], variables: compileDirectRule(p, gridSources).variables } })
    expect(designerRuleProblems(designerStateFrom(def))).toEqual({})
    expect(describeRuleAction(def as any, rule.then[2])).toContain('for each row added to Parts')
    // The runner: one call per ADDED row (updated / deleted rows, and a rule's pending new row, are not new child records).
    const calls: any[] = []
    let values: Record<string, unknown> = {
      customer: 'Acme', lines: [],
      parts: { added: [{ part_no: 'P-1', qty: 2 }, { part_no: 'P-2', qty: 1 }, { part_no: 'P-3', __draft: 'new' }], updated: [{ key: 'r9', before: {}, after: { qty: 5 }, changed_fields: ['qty'] }], deleted: [] },
    }
    const grid = GRID_FIELDS.find((f) => f.key === 'parts')!
    const host = {
      values: () => values, state: () => ({}), setValues: (patch: Record<string, unknown>) => { values = { ...values, ...patch } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, previous: () => true, validate: () => true, submit: async () => true, print: () => {}, openLink: () => {}, message: () => {},
      field: (k: string) => (k === 'parts' ? grid : undefined),
      runExtra: async (index: number, action: any, _v: unknown, _b: unknown, event: any) => { calls.push({ index, each: action.each_item ?? null, row: event?.row ?? null }); return undefined },
    } as unknown as FieldButtonHost
    await runFieldButton({ actions: rule.then }, host)
    expect(calls.filter((c) => c.each === 'parts').map((c) => c.row)).toEqual([{ part_no: 'P-1', qty: 2 }, { part_no: 'P-2', qty: 1 }])
  })

  it('Send to a workflow: a loop over the grid\'s added rows, each linked to the parent id', () => {
    const wf = buildDataEventWorkflow(plan('workflow', [parentStep(), partStep]), { id: FORM_ID, name: 'Order form', fields: GRID_FIELDS }, gridSources, targets)
    const loop = wf.nodes.find((n) => n.type === 'loop')!
    expect(loop).toMatchObject({ label: 'For each row added to Parts', config: { items: '{{form.parts.added}}', item_var: 'item' } })
    expect(wf.nodes.find((n) => n.id === 'step_3')!.config.column_values).toEqual({ parent_row_id: '{{order_id}}', part_no: '{{item.part_no}}', qty: '{{item.qty}}' })
    expect(wf.outline.map((l) => l.text)).toContain('For each row added to Parts')
    expect(validateWorkflow(wf.nodes as any, wf.trigger_type).valid).toBe(true)
    expect(validateWorkflowWiring({ nodes: wf.nodes, edges: wf.edges }).map(formatWiringWarning)).toEqual([])
    // A Select table loops over its selected rows.
    const pickStep: DataEventStep = { ...partStep, source: 'pick', map: { parent_row_id: { kind: 'parent', step: 'step_1', path: 'row_id' }, part_no: { kind: 'field', key: 'vendor' } } }
    const w2 = buildDataEventWorkflow(plan('workflow', [parentStep(), pickStep]), { id: FORM_ID, name: 'Order form', fields: GRID_FIELDS }, gridSources, targets)
    expect(w2.nodes.find((n) => n.type === 'loop')!.config.items).toBe('{{form.pick}}')
  })
})

describe('Write directly refuses what a rule cannot link correctly', () => {
  it('a per-item step reading another per-item step\'s id is refused (a rule keeps only the last item\'s id); a workflow takes it', () => {
    const serial: DataEventStep = { id: 'step_3', target: { kind: 'table', id: SERIALS, name: 'Serials' }, source: 'lines', map: { parent_row_id: { kind: 'parent', step: 'step_2', path: 'row_id' }, serial: { kind: 'field', key: 'sku' } } }
    const direct = planProblems(plan('direct', [parentStep(), lineStep(), serial]), sources, TARGETS).filter((x) => x.severity === 'error')
    expect(direct).toHaveLength(1)
    expect(direct[0]).toMatchObject({ step: 'step_3', column: 'parent_row_id' })
    expect(direct[0].message).toMatch(/keeps only the last item's id — choose "Send to a workflow"/)
    expect(planProblems(plan('workflow', [parentStep(), lineStep(), serial]), sources, TARGETS).filter((x) => x.severity === 'error')).toEqual([])
  })

  it('a nested section / List points to Send to a workflow', () => {
    const serial: DataEventStep = { id: 'step_3', target: { kind: 'table', id: SERIALS, name: 'Serials' }, source: 'serials', map: { serial: { kind: 'field', key: 'serial' } } }
    const errors = planProblems(plan('direct', [parentStep(), lineStep(), serial]), sources, TARGETS).filter((x) => x.severity === 'error')
    expect(errors.map((e) => e.message)).toEqual([expect.stringMatching(/"Serials" sits inside "Order lines".*choose "Send to a workflow"/)])
  })
})

describe('the generated workflow looks hand-built', () => {
  const form = { id: FORM_ID, name: 'Order form', version: 3, fields: FIELDS }
  const serialStep: DataEventStep = { id: 'step_3', target: { kind: 'table', id: SERIALS, name: 'Serials' }, source: 'serials', map: { parent_row_id: { kind: 'parent', step: 'step_2', path: 'row_id' }, serial: { kind: 'field', key: 'serial' } } }
  const wf = buildDataEventWorkflow(plan('workflow', [parentStep(), lineStep(), serialStep]), form, sources, TARGETS)

  it('no two nodes overlap on the canvas, and the designer\'s Tidy leaves the layout as it is', async () => {
    const { nodeBox } = await import('@/lib/workflow-edge-routing')
    const { layoutWorkflow } = await import('@/lib/workflow-layout')
    const boxes = wf.nodes.map((n) => ({ id: n.id, ...nodeBox(n as any) }))
    for (const a of boxes) {
      for (const b of boxes) {
        if (a.id >= b.id) continue
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
        expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
      }
    }
    const again = layoutWorkflow({ nodes: wf.nodes as any, edges: wf.edges as any })
    for (const n of wf.nodes) expect(again.positions[n.id] ?? n.position, n.id).toEqual(n.position)
    // Everything on the 20 px grid, a loop's body to its right, Done straight down.
    for (const n of wf.nodes) { expect(n.position.x % 20).toBe(0); expect(n.position.y % 20).toBe(0) }
    const pos = (id: string) => wf.nodes.find((n) => n.id === id)!.position
    expect(pos('step_2').x).toBeGreaterThan(pos('loop_1').x)
    expect(pos('done').x).toBe(pos('loop_1').x)
    expect(pos('done').y).toBeGreaterThan(pos('step_3').y)
  })

  it('edges use the designer\'s branch labels; labels and variables read like a person wrote them', () => {
    expect(new Set(wf.edges.filter((e) => e.label).map((e) => e.label))).toEqual(new Set(['Each Item', 'Done']))
    expect(wf.nodes.map((n) => n.label)).toEqual(['"Order form" submitted', 'Add to Orders', 'For each item of Order lines', 'Add to Order lines', 'For each item of Serials', 'Add to Serials', 'Saved'])
    const vars = wf.nodes.flatMap((n) => [n.config.output_row_id_var, n.config.output_row_var].filter(Boolean))
    expect(vars).toEqual(['order_id', 'order_row', 'order_line_id', 'serial_id'])
  })

  it('names variables after the record, never colliding', async () => {
    const { nameStem, stepStems } = await import('@/lib/forms/data-event')
    expect(['Orders', 'Order lines', 'Create CRM deal', 'Status', 'Entries', 'Address', '123 Things', '!!!'].map(nameStem)).toEqual(['order', 'order_line', 'crm_deal', 'status', 'entry', 'address', 'thing', 'record'])
    expect([...stepStems([{ id: 'step_1', target: { kind: 'table', id: 'a', name: 'Orders' } }, { id: 'step_2', target: { kind: 'table', id: 'a', name: 'Orders' } }]).values()]).toEqual(['order', 'order_2'])
  })
})
