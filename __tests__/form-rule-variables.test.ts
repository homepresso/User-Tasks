import { describe, expect, it } from 'vitest'
import {
  CONTROLS_KEY, controlState, controlVariables, enrichEventContext, eventVariables, reportControl, ruleVariables, serverControlEntries, withControlState,
} from '@/lib/forms/rule-variables'
import { FORM_RULE_EVENTS, resolveRuleTemplate, ruleConditionsMet, type FormRuleEventType } from '@/lib/forms/form-rules'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { buildTablePlan, normalizeDataTableConfig, normalizeUserQuery, resolveDataTableTemplate } from '@/lib/forms/data-table'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { FORM_VARS_KEY } from '@/lib/forms/form-params'

/**
 * Event and control variables (lib/forms/rule-variables.ts): what the
 * rules' placeholder menus list per event / control equals what the
 * runtime actually sets; control state is rebuilt on the server from
 * declared controls and columns only.
 */

const FIELDS = normalizeTaskFields([
  { key: 'orders', label: 'Orders', type: 'data_table', data_table: {
    source: 'table', table_id: '11111111-1111-4111-8111-111111111111', mode: 'select', key_column: 'order_id',
    columns: [{ key: 'order_id', label: 'Order', type: 'text' }, { key: 'total', label: 'Total', type: 'number' }, { key: 'shipped', label: 'Shipped', type: 'date' }],
  } },
  { key: 'lines', label: 'Lines', type: 'data_table', data_table: {
    source: 'table', table_id: '22222222-2222-4222-8222-222222222222', mode: 'edit', key_column: 'line_id', allow_add: true,
    columns: [{ key: 'line_id', label: 'Line', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }],
    base_filter: { match: 'all', conditions: [{ column: 'order_id', operator: 'eq', value: '{{control.orders.selected_row_id}}' }] },
  } },
  { key: 'customer', label: 'Customer', type: 'lookup', lookup: { source: 'table', table_id: '33333333-3333-4333-8333-333333333333', display_columns: ['name', 'city'] } },
  { key: 'note', label: 'Note', type: 'text' },
])
const PAGES = [{ id: 'pick', title: 'Pick' }, { id: 'review', title: 'Review' }]

/** What each component dispatches today (the contexts copied from data-table-field, lookup-field, form-renderer, field-button, form-pages). */
const DISPATCHED: Partial<Record<FormRuleEventType, { target: string; context: Record<string, unknown> }>> = {
  value_change: { target: 'note', context: { field: 'note', value: 'b', previous: 'a' } },
  focus: { target: 'note', context: { field: 'note', value: 'a' } },
  blur: { target: 'note', context: { field: 'note', value: 'a' } },
  button_click: { target: 'go', context: { button: 'go' } },
  row_click: { target: 'orders', context: { field: 'orders', row: { order_id: 'A1', total: 10, shipped: '2026-01-02' }, key: 'A1', column: 'total' } },
  row_double_click: { target: 'orders', context: { field: 'orders', row: { order_id: 'A1', total: 10, shipped: '2026-01-02' }, key: 'A1', column: 'total' } },
  row_select: { target: 'orders', context: { field: 'orders', row: { order_id: 'A1', total: 10, shipped: '2026-01-02' }, key: 'A1', selected: true } },
  row_deselect: { target: 'orders', context: { field: 'orders', row: { order_id: 'A1', total: 10, shipped: '2026-01-02' }, key: 'A1' } },
  cell_edit: { target: 'orders', context: { field: 'orders', row: { order_id: 'A1', total: 12, shipped: '2026-01-02' }, key: 'A1', column: 'total', value: 12, previous: 10 } },
  row_add: { target: 'orders', context: { field: 'orders', row: { order_id: '', total: null, shipped: null } } },
  row_delete: { target: 'orders', context: { field: 'orders', row: { order_id: 'A1', total: 10, shipped: '2026-01-02' }, key: 'A1' } },
  item_select: { target: 'customer', context: { field: 'customer', value: 'C1', item: { value: 'C1', label: 'Acme (Berlin)', fields: { name: 'Acme', city: 'Berlin', row_id: 'C1' } } } },
  page_change: { target: 'review', context: { page: 'review', previous: 'pick' } },
  before_submit: { target: 'submit', context: { button: 'submit' } },
  after_submit: { target: 'submit', context: { button: 'submit' } },
  flag_change: { target: 'open', context: { flag: 'open', value: true } },
  message_answered: { target: 'q1', context: { message: 'q1', response: 'yes', label: 'Yes' } },
}
/** Earlier names that still resolve but are not offered (the menus show the documented ones). */
const LEGACY = new Set(['event.key', 'event.previous', 'event.page', 'event.item.fields', 'event.item.value', 'event.item.label'])

function paths(obj: Record<string, unknown>, prefix = 'event'): string[] {
  const out: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    const p = `${prefix}.${k}`
    out.push(p)
    if ((p === 'event.row' || p === 'event.item') && v && typeof v === 'object') for (const sub of Object.keys(v)) out.push(`${p}.${sub}`)
  }
  return out
}

describe('This event: the picker lists exactly what the runtime sets', () => {
  for (const type of FORM_RULE_EVENTS) {
    const sample = DISPATCHED[type]
    if (!sample) continue
    it(type, () => {
      const offered = eventVariables(type, sample.target, FIELDS).map((v) => v.path)
      const set = paths(enrichEventContext(type, sample.context)).filter((p) => !LEGACY.has(p))
      expect(new Set(set)).toEqual(new Set(offered))
      // Every offered path resolves to something in the runtime context.
      const ctx = enrichEventContext(type, sample.context)
      for (const p of offered) expect(resolveRuleTemplate(`{{${p}}}`, { values: {}, event: ctx }), p).not.toBeUndefined()
    })
  }

  it('picker contents per event type (typed)', () => {
    const row = eventVariables('row_click', 'orders', FIELDS)
    expect(row.map((v) => `${v.path}:${v.type}`)).toEqual([
      'event.field:text', 'event.row_id:text', 'event.row:object', 'event.row.order_id:text', 'event.row.total:number', 'event.row.shipped:date', 'event.column:text',
    ])
    expect(eventVariables('cell_edit', 'orders', FIELDS).map((v) => v.path)).toEqual(expect.arrayContaining(['event.column', 'event.value', 'event.previous_value', 'event.row.total']))
    expect(eventVariables('item_select', 'customer', FIELDS).map((v) => v.path)).toEqual(['event.field', 'event.value', 'event.label', 'event.item', 'event.item.name', 'event.item.city', 'event.item.row_id'])
    expect(eventVariables('value_change', 'note', FIELDS).map((v) => v.path)).toEqual(['event.field', 'event.value', 'event.previous_value'])
    expect(eventVariables('message_answered', 'q1', FIELDS).map((v) => v.path)).toEqual(['event.message', 'event.response', 'event.label'])
    expect(eventVariables('page_change', 'review', FIELDS).map((v) => v.path)).toEqual(['event.to', 'event.from'])
    expect(eventVariables('form_load', undefined, FIELDS)).toEqual([])
    expect(eventVariables('always', undefined, FIELDS)).toEqual([])
  })
})

describe('Controls', () => {
  it('lists each control’s state, typed (tables, autocompletes, the current step)', () => {
    const vars = controlVariables(FIELDS, PAGES).map((v) => `${v.path}:${v.type}`)
    expect(vars).toEqual(expect.arrayContaining([
      'control.orders.selected_row_id:text', 'control.orders.selected_row.total:number', 'control.orders.selected_rows:list', 'control.orders.selected_count:number',
      'control.orders.last_clicked_row_id:text', 'control.orders.last_clicked_row.shipped:date', 'control.orders.row_count:number', 'control.orders.changes_count:number',
      'control.customer.value:text', 'control.customer.label:text', 'control.customer.item.city:any',
      'control.form.step_id:text', 'control.form.step_title:text',
    ]))
    expect(vars.some((v) => v.startsWith('control.note'))).toBe(false)
    expect(ruleVariables({ event: 'row_click', target: 'orders' }, FIELDS).filter((v) => v.group === 'This event').length).toBe(7)
  })

  it('the runtime state matches the list: derived from values, plus what the table reported', () => {
    let values: Record<string, unknown> = {
      orders: [{ order_id: 'A1', total: 10, shipped: '2026-01-02', secret: 'x' }],
      lines: { added: [{ line_id: 'n1', qty: 1 }], updated: [], deleted: [] },
      customer: 'C1', customer_label: 'Acme (Berlin)', customer_item: { name: 'Acme', city: 'Berlin', iban: 'LEAK' },
    }
    values = { ...values, [CONTROLS_KEY]: reportControl(values, 'orders', { last_clicked_row: { order_id: 'B2', total: 99, secret: 'x' }, last_clicked_row_id: 'B2', row_count: 7 }) }
    values[CONTROLS_KEY] = { ...(values[CONTROLS_KEY] as object), form: { step_id: 'review' } }
    const state = withControlState(FIELDS, values, PAGES)[CONTROLS_KEY] as Record<string, Record<string, unknown>>
    expect(state.orders).toEqual({
      selected_rows: [{ order_id: 'A1', total: 10, shipped: '2026-01-02' }], selected_count: 1, selected_row: { order_id: 'A1', total: 10, shipped: '2026-01-02' }, selected_row_id: 'A1',
      last_clicked_row: { order_id: 'B2', total: 99 }, last_clicked_row_id: 'B2', row_count: 7, changes_count: 0,
    })
    expect(state.lines.changes_count).toBe(1)
    expect(state.customer).toEqual({ value: 'C1', label: 'Acme (Berlin)', item: { name: 'Acme', city: 'Berlin' } })
    expect(state.form).toEqual({ step_id: 'review', step_title: 'Review', loaded: { pick: true, review: true } })
    // Every listed path resolves in that state.
    for (const v of controlVariables(FIELDS, PAGES)) {
      const resolved = resolveRuleTemplate(`{{${v.path}}}`, { values: { [CONTROLS_KEY]: state } })
      expect(resolved, v.path).not.toBeUndefined()
    }
  })

  it('row-click example: {{event.row_id}} into a variable, {{control.orders.selected_row.total}} in a condition and a message', async () => {
    const values = withControlState(FIELDS, { orders: [{ order_id: 'A1', total: 250, shipped: null }] })
    let current: Record<string, unknown> = values
    const messages: string[] = []
    const host = {
      values: () => current, state: () => ({ flags: {}, hidden: [] }) as never, setValues: (p: Record<string, unknown>) => { current = { ...current, ...p } }, setState: () => {},
      flush: async () => {}, goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {},
      openLink: () => true, message: (t: string) => { messages.push(t) }, editableKeys: new Set(['note']), blank: () => null,
    } as FieldButtonHost
    const event = enrichEventContext('row_click', DISPATCHED.row_click!.context)
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'control.orders.selected_row.total', operator: 'gt', value: '100' }] }, { values: current, event })).toBe(true)
    await runFieldButton({ actions: [
      normalizeFieldButtonAction({ type: 'set_variable', variable: 'picked', value: '{{event.row_id}}' }, { rule: true })!,
      normalizeFieldButtonAction({ type: 'set_values', assign: { note: 'Order {{event.row_id}}: {{control.orders.selected_row.total}}' } })!,
      normalizeFieldButtonAction({ type: 'message', text: 'Selected {{control.orders.selected_count}} worth {{control.orders.selected_row.total}}' })!,
    ] }, host, { extras: { event } })
    expect((current[FORM_VARS_KEY] as Record<string, unknown>).picked).toBe('A1')
    expect(current.note).toBe('Order A1: 250')
    expect(messages).toEqual(['Selected 1 worth 250'])
  })
})

describe('server validation of control variables', () => {
  it('declared controls and declared columns only; ids and counts bounded; the rest dropped', () => {
    const entries = serverControlEntries({ rows: [], mode: 'steps', pages: PAGES.map((p) => ({ ...p, rows: [] })) }, FIELDS, {
      [CONTROLS_KEY]: {
        orders: { selected_rows: [{ order_id: 'A1', total: 5, secret: 'S', __proto__: { x: 1 } }], last_clicked_row: { order_id: 'Z', iban: 'LEAK' }, last_clicked_row_id: 'Z'.repeat(500), row_count: -4, injected: 'x' },
        ghost: { selected_row_id: 'x' },
        form: { step_id: 'not-a-page' },
      },
    })
    const state = entries[CONTROLS_KEY] as Record<string, Record<string, unknown>>
    expect(Object.keys(state).sort()).toEqual(['customer', 'form', 'lines', 'orders'])
    expect(state.orders.selected_rows).toEqual([{ order_id: 'A1', total: 5 }])
    expect(state.orders.last_clicked_row).toEqual({ order_id: 'Z' })
    expect(String(state.orders.last_clicked_row_id).length).toBe(200)
    expect(state.orders.row_count).toBeNull()
    expect(state.orders).not.toHaveProperty('injected')
    expect(state.form).toEqual({ step_id: null, step_title: null, loaded: { pick: true, review: true } })
    expect(JSON.stringify(state)).not.toMatch(/LEAK|secret|"S"/)
  })

  it('the table’s own value wins over what the request claims', () => {
    const state = controlState(FIELDS, { orders: [], [CONTROLS_KEY]: { orders: { selected_rows: [{ order_id: 'FORGED', total: 1 }] } } })
    expect(state.orders.selected_row_id).toBeNull()
  })

  it('a crafted control value only narrows a base filter (one quoted value), never widens it', () => {
    const config = normalizeDataTableConfig(FIELDS[1].data_table)!
    const crafted = 'x"),or(id.not.is.null'
    const scope = { values: serverControlEntries(null, FIELDS, { [CONTROLS_KEY]: { orders: { selected_rows: [{ order_id: crafted, total: 1 }] } } }) }
    expect(resolveDataTableTemplate('{{control.orders.selected_row_id}}', scope)).toBe(crafted)
    const plan = buildTablePlan(config, normalizeUserQuery(config, {}), scope)
    expect(plan.where).toBe('and(and(data->>order_id.eq."x\\"),or(id.not.is.null"))')
    // Nothing selected: the condition matches nothing, it is not dropped.
    expect(buildTablePlan(config, normalizeUserQuery(config, {}), { values: serverControlEntries(null, FIELDS, {}) }).where).toBe('and(and(data->>order_id.eq.""))')
  })

  it('forms without controls are unchanged', () => {
    const plain = normalizeTaskFields([{ key: 'a', label: 'A', type: 'text' }])
    const values = { a: 1 }
    expect(withControlState(plain, values)).toBe(values)
    expect(serverControlEntries(null, plain, values)).toEqual({})
  })
})
