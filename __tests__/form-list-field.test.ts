/**
 * List fields (field type `list`, lib/forms/list-field.ts): repeating rows
 * kept in the submission — normalisation, value coercion and validation on
 * the client and the server, the run's derived values, drafts, User Task
 * prefill, the "Add row to list" / "Remove row" / "Clear list" rule actions,
 * the designer's entry kit, the list view's markup, the data picker's item
 * fields, wiring without false warnings, and a form_submitted run whose loop
 * inserts the rows into a data table (in-memory Supabase).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import {
  checkListValue, coerceListRows, describeListValue, listConfigProblem, listDerivedValues, listEntryKit, normalizeListConfig, type ListFieldConfig,
} from '@/lib/forms/list-field'
import {
  coerceTaskFieldValues, defaultTaskFieldValues, fieldDefinitionProblems, fieldValueSchemaType, isRuleMet, mergeTaskFieldValues, normalizeTaskFields,
  stepFieldValues, validateTaskFieldValues,
} from '@/lib/task-field-schema'
import { runFieldButton, normalizeFieldButtonAction, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { describeRuleAction, formRuleProblem, normalizeFormRules, ruleWrittenReadOnlyValues } from '@/lib/forms/form-rules'
import { addListEntryKit, designerStateFrom, designerProblems, definitionFrom } from '@/lib/forms/designer-state'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { storedValues } from '@/lib/services/form-submissions'
import { buildDataTree } from '@/lib/workflow-data-picker'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { FormRenderer, formatFieldValue } from '@/components/forms/form-renderer'
import { executeWorkflow } from '@/lib/workflow-engine'
import { createFakeSupabase } from './helpers/fake-supabase'

const LINES: ListFieldConfig = normalizeListConfig({
  columns: [
    { key: 'item', label: 'Item', type: 'text', required: true },
    { key: 'qty', label: 'Qty', type: 'number', required: true, min: 1 },
    { key: 'unit_price', label: 'Unit price', type: 'currency', currency: 'NZD' },
    { key: 'needed_by', label: 'Needed by', type: 'date' },
    { key: 'urgent', label: 'Urgent', type: 'boolean' },
    { key: 'kind', label: 'Kind', type: 'select', options: ['Hardware', 'Software'] },
    { key: 'total', label: 'Total', type: 'calculated', formula: 'qty * unit_price' },
  ],
  min_rows: 1,
  max_rows: 3,
  totals: [{ column: 'total', fn: 'sum' }, { column: 'qty', fn: 'avg' }],
})

const FIELDS = normalizeTaskFields([
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'line_items_item', label: 'Item', type: 'text' },
  { key: 'line_items_qty', label: 'Qty', type: 'number' },
  { key: 'line_items_unit_price', label: 'Unit price', type: 'currency' },
  { key: 'line_items', label: 'Line items', type: 'list', required: true, list: LINES },
])

describe('normalisation', () => {
  it('keeps clean columns, maps select / checkbox / formula, drops bad keys and totals', () => {
    const config = normalizeListConfig({
      columns: [
        { label: 'Item name', type: 'text' },
        { key: 'item_name', label: 'Duplicate', type: 'text' },
        { key: '__proto__', label: 'Bad', type: 'text' }, // slugged to a harmless "proto"
        { key: 'ok', label: 'OK', type: 'checkbox', required: true },
        { key: 'calc', label: 'Calc', type: 'formula', expression: '2 * ok' },
        { key: 'what', label: 'What', type: 'mystery' },
      ],
      min_rows: -2, max_rows: 9999, entry_mode: 'form', add_label: 'Add it',
      totals: [{ column: 'missing', fn: 'sum' }, { column: 'calc', fn: 'sum' }, { column: 'calc', fn: 'sum' }],
    })
    expect(config.columns.map((c) => [c.key, c.type])).toEqual([['item_name', 'text'], ['proto', 'text'], ['ok', 'boolean'], ['calc', 'calculated'], ['what', 'text']])
    expect(config.columns[2].required).toBeUndefined()
    expect(config.columns[3].formula).toBe('2 * ok')
    expect(config.min_rows).toBeUndefined()
    expect(config.max_rows).toBe(500)
    expect(config.entry_mode).toBeUndefined()
    expect((config as any).add_label).toBeUndefined()
    expect(config.totals).toEqual([{ column: 'calc', fn: 'sum' }])
    expect(normalizeListConfig({ columns: [{ key: 'a', label: 'A' }], entry_mode: 'inline' }).entry_mode).toBe('inline')
  })

  it('the field keeps list config, help and visibility only; problems for bad configs and clashing keys', () => {
    const [field] = normalizeTaskFields([{ key: 'rows', label: 'Rows', type: 'list', list: LINES, placeholder: 'x', default: '[]', min: 2, help_text: 'Add rows' }])
    expect(field.list?.columns).toHaveLength(7)
    expect(field.placeholder).toBeUndefined()
    expect(field.default).toBeUndefined()
    expect(field.min).toBeUndefined()
    expect(field.help_text).toBe('Add rows')
    expect(fieldValueSchemaType('list')).toBe('array')
    expect(listConfigProblem(normalizeListConfig({ columns: [] }))).toMatch(/at least one column/)
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'c', label: 'C', type: 'choice' }] }))).toMatch(/option/)
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'a', label: 'A', type: 'number' }, { key: 't', label: 'T', type: 'calculated', formula: 'a * nope' }] }))).toMatch(/unknown column "nope"/)
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'a', label: 'A', type: 'text' }, { key: 't', label: 'T', type: 'calculated', formula: 'a *' }] }))).toMatch(/formula/)
    const clash = normalizeTaskFields([{ key: 'rows', label: 'Rows', type: 'list', list: LINES }, { key: 'rows_count', label: 'Count', type: 'number' }])
    expect(fieldDefinitionProblems(clash).rows).toMatch(/rows_count/)
  })
})

describe('values: coercion and validation (client and server)', () => {
  const rows = [
    { item: 'Laptop', qty: '2', unit_price: '1,250.50', needed_by: '2026-12-01T00:00:00Z', urgent: 'yes', kind: 'Hardware', total: 999999, extra: 'dropped' },
    { item: '', qty: '', unit_price: '', urgent: false },
    { item: 'Licence', qty: 1, unit_price: 99 },
  ]

  it('types every column, works out calculated columns (never as sent), drops blank rows and unknown keys', () => {
    expect(coerceListRows(LINES, rows)).toEqual([
      { item: 'Laptop', qty: 2, unit_price: 1250.5, needed_by: '2026-12-01', urgent: true, kind: 'Hardware', total: 2501 },
      { item: 'Licence', qty: 1, unit_price: 99, needed_by: null, urgent: false, kind: null, total: 99 },
    ])
    expect(coerceListRows(LINES, JSON.stringify(rows.slice(2)))).toHaveLength(1)
    expect(coerceListRows(LINES, 'not json')).toEqual([])
  })

  it('validates required columns, types, bounds, options, min / max rows and required = at least one row', () => {
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: rows })).toEqual({})
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: [] }).line_items).toMatch(/at least one row/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: [{ item: 'A' }] }).line_items).toMatch(/row 1: Qty is required/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: [{ item: 'A', qty: 0 }] }).line_items).toMatch(/Qty must be at least 1/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: [{ item: 'A', qty: 'two' }] }).line_items).toMatch(/must be a number/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: [{ item: 'A', qty: 1, kind: 'Food' }] }).line_items).toMatch(/Kind must be one of/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: [{ item: 'A', qty: 1, needed_by: 'soon' }] }).line_items).toMatch(/date/)
    const four = Array.from({ length: 4 }, (_, i) => ({ item: `I${i}`, qty: 1 }))
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: four }).line_items).toMatch(/at most 3 rows/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: { item: 'A' } }).line_items).toMatch(/invalid value/)
    expect(validateTaskFieldValues(FIELDS, { title: 'x', line_items: ['A'] }).line_items).toMatch(/invalid row/)
    // Hidden by a rule: not required.
    const hidden = normalizeTaskFields([{ key: 'show', label: 'Show', type: 'boolean' }, { key: 'rows', label: 'Rows', type: 'list', required: true, list: LINES, visible_when: { field: 'show', operator: 'equals', value: 'true' } }])
    expect(validateTaskFieldValues(hidden, { show: false, rows: [] })).toEqual({})
    expect(checkListValue(LINES, rows, true).count).toBe(2)
  })

  it('the server merge stores typed rows, the count and the totals (recomputed, never as sent)', () => {
    const { errors, templateValues } = mergeTaskFieldValues({ fields: FIELDS }, { title: 'PR', line_items: rows, line_items_count: 99, line_items_total_total: 1 })
    expect(errors).toEqual({})
    expect(templateValues.line_items).toHaveLength(2)
    expect(templateValues.line_items_count).toBe(2)
    expect(templateValues.line_items_total_total).toBe(2600)
    expect(templateValues.line_items_avg_qty).toBe(1.5)
    expect(mergeTaskFieldValues({ fields: FIELDS }, { title: 'PR', line_items: [] }).errors.line_items).toMatch(/at least one row/)
  })

  it('defaults to no rows; a User Task prefill takes an array (or JSON text) from a workflow variable', () => {
    expect(defaultTaskFieldValues(FIELDS).line_items).toEqual([])
    const resolve = (t: string) => (t === '{{lines}}' ? [{ item: 'Desk', qty: '1', unit_price: 300 }] : t === '{{json}}' ? '[{"item":"Chair","qty":2}]' : t)
    expect(stepFieldValues(FIELDS, { line_items: '{{lines}}' }, resolve).line_items).toEqual([{ item: 'Desk', qty: 1, unit_price: 300, needed_by: null, urgent: false, kind: null, total: 300 }])
    expect((stepFieldValues(FIELDS, { line_items: '{{json}}' }, resolve).line_items as any[])[0]).toMatchObject({ item: 'Chair', qty: 2, total: 0 })
    expect(coerceTaskFieldValues(FIELDS, { line_items: null }).line_items).toEqual([])
  })

  it('rules read a list as its row count; summaries say "3 rows"', () => {
    expect(isRuleMet({ field: 'rows', operator: 'is_set' }, { rows: [] })).toBe(false)
    expect(isRuleMet({ field: 'rows', operator: 'is_set' }, { rows: [{ a: 1 }] })).toBe(true)
    expect(isRuleMet({ field: 'rows', operator: 'equals', value: '2' }, { rows: [{ a: 1 }, { a: 2 }] })).toBe(true)
    expect(describeListValue([{}, {}, {}])).toBe('3 rows')
    expect(formatFieldValue(FIELDS[4], [{ item: 'A' }])).toBe('1 row')
    expect(listDerivedValues('x', LINES, rows)).toEqual({ x_count: 2, x_total_total: 2600, x_avg_qty: 1.5 })
  })

  it('drafts and submissions keep the rows (and the recomputed count)', () => {
    const kept = storedValues(FIELDS, { title: 'PR', line_items: rows.slice(0, 1), line_items_count: 42, stray: 1 })
    expect(kept.line_items).toEqual(rows.slice(0, 1))
    expect(kept.line_items_count).toBe(1)
    expect(kept.stray).toBeUndefined()
  })
})

describe('rule actions: Add row to list, Remove row, Clear list', () => {
  function host(initial: Record<string, unknown>) {
    let values = { ...initial }
    const errors: Record<string, string> = {}
    const messages: string[] = []
    const byKey = new Map(FIELDS.map((f) => [f.key, f]))
    const h: FieldButtonHost = {
      values: () => values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { values = { ...values, ...p } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
      message: (t) => { messages.push(t) }, fieldError: (f, t) => { errors[f] = t },
      editableKeys: new Set(FIELDS.map((f) => f.key)), blank: (k) => (byKey.get(k)?.type === 'list' ? [] : null), field: (k) => byKey.get(k),
    }
    return { h, get values() { return values }, errors, messages }
  }
  const add = normalizeFieldButtonAction({
    type: 'add_list_row', list_field: 'line_items',
    values: { item: '{{line_items_item}}', qty: '{{form.line_items_qty}}', unit_price: '{{line_items_unit_price}}', kind: 'Hardware' },
    require: ['line_items_item'],
  }, { rule: true })!

  it('normalises (rules only; a Button cannot carry it)', () => {
    expect(add).toMatchObject({ type: 'add_list_row', list_field: 'line_items', require: ['line_items_item'] })
    expect(normalizeFieldButtonAction({ type: 'add_list_row', list_field: 'x' })).toBeNull()
    expect(normalizeFieldButtonAction({ type: 'remove_list_row', list_field: 'line_items' }, { rule: true })).toMatchObject({ row: 'last' })
  })

  it('adds a typed row from the inputs, then clears the inputs it read', async () => {
    const t = host({ line_items_item: 'Monitor', line_items_qty: '2', line_items_unit_price: '300', line_items: [{ item: 'Desk', qty: 1, unit_price: 500 }] })
    const run = await runFieldButton({ actions: [add] }, t.h)
    expect(run.stopped).toBeUndefined()
    expect(t.values.line_items).toEqual([{ item: 'Desk', qty: 1, unit_price: 500 }, { item: 'Monitor', qty: 2, unit_price: 300, needed_by: null, urgent: false, kind: 'Hardware', total: 600 }])
    expect(t.values).toMatchObject({ line_items_item: null, line_items_qty: null, line_items_unit_price: null })
  })

  it('a missing required input shows its error and adds nothing; column errors land on the input they came from', async () => {
    const t = host({ line_items_item: '', line_items_qty: '2', line_items: [] })
    expect((await runFieldButton({ actions: [add] }, t.h)).stopped).toBe('row_invalid')
    expect(t.errors.line_items_item).toMatch(/Item is required/)
    expect(t.values.line_items).toEqual([])
    const u = host({ line_items_item: 'Pen', line_items_qty: '0', line_items: [] })
    expect((await runFieldButton({ actions: [add] }, u.h)).stopped).toBe('row_invalid')
    expect(u.errors.line_items_qty).toMatch(/Qty must be at least 1/)
    expect(u.values.line_items_item).toBe('Pen')
  })

  it('respects max_rows; Remove row (last / first / a number) and Clear list', async () => {
    const full = host({ line_items_item: 'X', line_items_qty: 1, line_items: [{ item: 'A' }, { item: 'B' }, { item: 'C' }] })
    expect((await runFieldButton({ actions: [add] }, full.h)).stopped).toBe('list_full')
    expect(full.messages[0]).toMatch(/at most 3 rows/)
    const t = host({ line_items: [{ item: 'A' }, { item: 'B' }, { item: 'C' }], pick: 2 })
    await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'remove_list_row', list_field: 'line_items', row: '{{pick}}' }, { rule: true })!] }, t.h)
    expect((t.values.line_items as any[]).map((r) => r.item)).toEqual(['A', 'C'])
    await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'remove_list_row', list_field: 'line_items' }, { rule: true })!] }, t.h)
    expect((t.values.line_items as any[]).map((r) => r.item)).toEqual(['A'])
    await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'clear_list', list_field: 'line_items' }, { rule: true })!] }, t.h)
    expect(t.values.line_items).toEqual([])
  })

  it('rule checks, descriptions and the server trusting a read-only list filled by such a rule', () => {
    const rule = normalizeFormRules([{ id: 'r1', event: 'button_click', target: 'add_btn', then: [add] }])[0]
    const known: any = { fieldKeys: new Set([...FIELDS.map((f) => f.key), 'add_btn']), valueKeys: new Set(FIELDS.map((f) => f.key)), pageIds: new Set(), flags: new Set(), fieldTypes: new Map<string, string>([...FIELDS.map((f) => [f.key, f.type] as [string, string]), ['add_btn', 'button']]) }
    expect(formRuleProblem(rule, known)).toBeNull()
    expect(formRuleProblem({ ...rule, then: [{ ...add, list_field: 'title' }] }, known)).toMatch(/choose the List field/)
    expect(formRuleProblem({ ...rule, then: [{ ...add, values: {} }] }, known)).toMatch(/map at least one column/)
    expect(describeRuleAction({ fields: FIELDS as any, layout: {} }, add)).toMatch(/^Add a row to Line items: item = \{\{line_items_item\}\}/)
    const kept = ruleWrittenReadOnlyValues({ rules: [rule] }, ['line_items'], { line_items: [{ item: 'A', qty: 1 }] }, {})
    expect(kept.line_items).toEqual([{ item: 'A', qty: 1 }])
  })
})

describe('the designer helper: inputs, an Add button and the rule', () => {
  it('listEntryKit builds one input per column, the button and a button-click rule', () => {
    const kit = listEntryKit('line_items', 'Line items', LINES, ['line_items_item'])
    expect(kit.fields.map((f) => [f.key, f.type])).toEqual([
      ['line_items_item_2', 'text'], ['line_items_qty', 'number'], ['line_items_unit_price', 'currency'], ['line_items_needed_by', 'date'],
      ['line_items_urgent', 'boolean'], ['line_items_kind', 'choice'], ['line_items_add', 'button'], ['line_items_cancel', 'button'],
    ])
    expect(kit.fields.find((f) => f.key === 'line_items_add')!.label).toBe('Add item')
    // Editing (default: an Edit button on each row): load the row into the inputs, Add updates it, Cancel resets.
    expect(kit.listPatch.row_buttons).toEqual([{ id: 'edit', label: 'Edit' }])
    expect(kit.flag).toBe('editing_line_items')
    expect(kit.editRules[0]).toMatchObject({ event: 'list_row_button', target: 'line_items', then: [{ type: 'edit_list_row', assign: { line_items_item_2: '{{row.item}}', line_items_qty: '{{row.qty}}' } }, { type: 'set_state', flag: 'editing_line_items', state_value: 'true' }] })
    expect(kit.editRules[1].then[0]).toMatchObject({ type: 'cancel_list_edit', list_field: 'line_items' })
    expect(kit.fields.at(-1)!.visible_when).toEqual({ field: 'state.editing_line_items', operator: 'equals', value: 'true' })
    expect(listEntryKit('line_items', 'Line items', LINES, [], { edit: 'row_click' }).listPatch).toEqual({ row_click: true })
    expect(listEntryKit('line_items', 'Line items', LINES, [], { edit: false }).editRules).toEqual([])
    expect(kit.rule).toMatchObject({ event: 'button_click', target: 'line_items_add' })
    expect(kit.rule.then[0]).toMatchObject({ type: 'add_list_row', list_field: 'line_items', require: ['line_items_item_2', 'line_items_qty'] })
  })

  it('addListEntryKit places the inputs and button above the list and saves cleanly', () => {
    const state = designerStateFrom({ fields: normalizeTaskFields([{ key: 'title', label: 'Title', type: 'text' }, { key: 'line_items', label: 'Line items', type: 'list', list: LINES }]), layout: null } as any)
    const listId = state.fields.find((f) => f.key === 'line_items')!._id
    const out = addListEntryKit(state, listId)!
    const order = out.state.layout.rows.map((r) => r.cells.map((c) => c.field_key))
    expect(order).toEqual([['title'], ['line_items_item', 'line_items_qty', 'line_items_unit_price'], ['line_items_needed_by', 'line_items_urgent', 'line_items_kind'], ['line_items_add', 'line_items_cancel'], ['line_items']])
    expect(out.state.layout.rules).toHaveLength(3)
    expect(out.state.layout.state?.flags).toEqual([{ key: 'editing_line_items' }])
    expect(designerProblems(out.state)).toEqual({})
    const def = definitionFrom(out.state)
    expect(def.fields.find((f) => f.key === 'line_items_add')?.type).toBe('button')
    expect((def.layout as any).rules[0].then[0].type).toBe('add_list_row')
  })
})

describe('renderer', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const rows = [{ item: 'Laptop', qty: 2, unit_price: 1250, total: 2500 }, { item: 'Mouse', qty: 1, unit_price: 25, total: 25 }]
  it('the list view: rows, Remove per row, totals, count; no built-in Add button', () => {
    const html = wrap(createElement(FormRenderer, { fields: FIELDS, values: { line_items: rows }, onChange: () => {} }))
    expect(html).toContain('data-list-mode="view"')
    expect(html).toContain('Laptop')
    expect(html).toContain('aria-label="Remove row 2"')
    expect(html).toContain('data-list-total="sum:total"')
    expect(html).toContain('2 rows')
    expect(html).not.toContain('data-list-add')
  })
  it('cards on a one-column form; read-only shows rows without actions; inline mode is an editable table', () => {
    const narrow = wrap(createElement(FormRenderer, { fields: FIELDS, values: { line_items: rows }, onChange: () => {}, singleColumn: true }))
    expect(narrow).toContain('data-list-cards')
    expect(narrow).not.toContain('data-list-table')
    const ro = wrap(createElement(FormRenderer, { fields: FIELDS, values: { line_items: rows }, readOnly: true }))
    expect(ro).toContain('data-list-view')
    expect(ro).not.toContain('Remove row')
    const inline = normalizeTaskFields([{ key: 'rows', label: 'Rows', type: 'list', list: { ...LINES, entry_mode: 'inline' } }])
    const html = wrap(createElement(FormRenderer, { fields: inline, values: { rows }, onChange: () => {} }))
    expect(html).toContain('data-list-mode="inline"')
    expect(html).toContain('data-list-input="item"')
    expect(html).toContain('data-list-add')
  })
})

/* ── Workflows ───────────────────────────────────────────────────────── */

const TENANT = '0e000000-0000-4000-8000-00000000020a'
const WF = '0e000000-0000-4000-8000-0000000002b1'
const PARENT = '0e000000-0000-4000-8000-0000000002c1'
const CHILD = '0e000000-0000-4000-8000-0000000002c2'
const FORM = '0e000000-0000-4000-8000-0000000002d1'

const formFields = normalizeTaskFields([
  { key: 'title', label: 'Title', type: 'text', required: true },
  { key: 'line_items', label: 'Line items', type: 'list', list: LINES },
])
const nodes = [
  { id: 'trigger', type: 'form_submitted', label: 'Purchase request submitted', position: { x: 0, y: 0 }, config: { form_id: FORM, form_name: 'Purchase request', fields: formFields } },
  { id: 'parent', type: 'update_data_table', label: 'Insert request', position: { x: 0, y: 100 }, config: { table_id: PARENT, table_name: 'Requests', operation: 'insert', column_values: { title: '{{form.title}}', total: '{{form.line_items_total_total}}', lines: '{{form.line_items_count}}' }, output_row_id_var: 'parent_id' } },
  { id: 'lines', type: 'loop', label: 'Each line item', position: { x: 0, y: 200 }, config: { items: '{{form.line_items}}', item_var: 'item', index_var: 'index' } },
  { id: 'child', type: 'update_data_table', label: 'Insert line', position: { x: 0, y: 300 }, config: { table_id: CHILD, table_name: 'Lines', operation: 'insert', column_values: { request: '{{parent_id}}', item: '{{item.item}}', qty: '{{item.qty}}', unit_price: '{{item.unit_price}}', line_total: '{{item.total}}', position: '{{index}}' }, output_row_id_var: 'line_id' } },
  { id: 'done', type: 'log', label: 'Done', position: { x: 0, y: 400 }, config: { message: 'Inserted {{form.line_items_count}} lines' } },
]
const edges = [
  { id: 'e1', source: 'trigger', target: 'parent' },
  { id: 'e2', source: 'parent', target: 'lines' },
  { id: 'e3', source: 'lines', target: 'child', label: 'Each Item' },
  { id: 'e4', source: 'lines', target: 'done', label: 'Done' },
]

describe('workflow: data picker, wiring, payload', () => {
  it('lists the field as an array with item fields, the count and totals; the loop item has the columns', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'child' } as any)
    const form = groups.find((g) => g.kind === 'form' || g.kind === 'trigger')!
    const list = form.roots.find((r) => r.path === 'form.line_items')!
    expect(list.schema?.type).toBe('array')
    expect(list.schema?.items?.fields?.map((f) => [f.name, f.type])).toEqual([
      ['item', 'string'], ['qty', 'number'], ['unit_price', 'number'], ['needed_by', 'string'], ['urgent', 'boolean'], ['kind', 'string'], ['total', 'number'],
    ])
    expect(form.roots.map((r) => r.path)).toEqual(expect.arrayContaining(['form.line_items_count', 'form.line_items_total_total', 'form.line_items_avg_qty']))
    const loop = groups.find((g) => g.kind === 'loop')!
    const item = loop.roots.find((r) => r.path === 'item')!
    expect(item.schema?.fields?.map((f) => f.name)).toContain('qty')
  })

  it('wiring: no warnings for {{form.<list>}}, the count / totals and {{item.*}} in the loop', () => {
    expect(validateWorkflowWiring({ nodes, edges })).toEqual([])
    const typo = validateWorkflowWiring({ nodes: nodes.map((n) => (n.id === 'done' ? { ...n, config: { message: '{{form.line_item_count}}' } } : n)), edges })
    expect(typo.map((w) => w.suggestion)).toContain('{{form.line_items_count}}')
  })

  it('the form_submitted payload carries typed rows, the count and the totals', () => {
    const payload = buildFormSubmittedPayload({
      form: { id: FORM, name: 'Purchase request', version: 1 }, fields: formFields,
      values: { title: 'Kit', line_items: [{ item: 'Laptop', qty: '2', unit_price: '1000' }] },
      submission: { id: 's1', created_at: '2026-11-11T00:00:00Z', source: 'standalone' }, submitter: { id: null },
    })
    expect((payload.form as any).line_items).toEqual([{ item: 'Laptop', qty: 2, unit_price: 1000, needed_by: null, urgent: false, kind: null, total: 2000 }])
    expect(payload.form).toMatchObject({ line_items_count: 1, line_items_total_total: 2000, line_items_avg_qty: 2 })
  })
})

describe('workflow: a form_submitted run loops over the list and inserts the child rows', () => {
  beforeEach(() => {
    createClientMock.mockReset()
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is disabled in this test') }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('inserts the parent, then one linked child row per list row', async () => {
    const col = (key: string, type = 'text') => ({ id: `c_${key}`, key, name: key, type, required: false })
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'PR', trigger_type: 'form_submitted', nodes, edges, user_variables: [], run_count: 0, published_version_id: null }],
      custom_tables: [
        { id: PARENT, tenant_id: TENANT, name: 'Requests', columns: [col('title'), col('total', 'number'), col('lines', 'number')] },
        { id: CHILD, tenant_id: TENANT, name: 'Lines', columns: [col('request'), col('item'), col('qty', 'number'), col('unit_price', 'number'), col('line_total', 'number'), col('position', 'number')] },
      ],
      custom_table_rows: [],
    })
    fake.rpcs.record_workflow_run = () => ({})
    fake.rpcs.enqueue_workflow = () => ({ data: crypto.randomUUID() })
    const payload = buildFormSubmittedPayload({
      form: { id: FORM, name: 'Purchase request', version: 1 }, fields: formFields,
      values: { title: 'New starter kit', line_items: [{ item: 'Laptop', qty: 2, unit_price: 1000 }, { item: 'Mouse', qty: 3, unit_price: 20 }, { item: 'Bag', qty: 1, unit_price: 80 }] },
      submission: { id: 's1', created_at: '2026-11-11T00:00:00Z', source: 'standalone' }, submitter: { id: null },
    })
    const result = await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
    const run = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as any
    expect(result.status, run?.error).toBe('completed')
    const rows = fake.tables.custom_table_rows as any[]
    const parent = rows.find((r) => r.table_id === PARENT)
    expect(parent.data).toMatchObject({ title: 'New starter kit', total: 2140, lines: 3 })
    const children = rows.filter((r) => r.table_id === CHILD)
    expect(children.map((r) => [r.data.item, Number(r.data.qty), Number(r.data.line_total), Number(r.data.position)])).toEqual([['Laptop', 2, 2000, 0], ['Mouse', 3, 60, 1], ['Bag', 1, 80, 2]])
    expect(children.every((r) => r.data.request === parent.id)).toBe(true)
  }, 30_000)
})

describe('several Lists on one form', () => {
  const TWO = normalizeTaskFields([
    { key: 'item', label: 'Item', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'person', label: 'Person', type: 'text' }, { key: 'email', label: 'Email', type: 'email' },
    { key: 'line_items', label: 'Line items', type: 'list', list: { columns: [{ key: 'item', label: 'Item', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }], totals: [{ column: 'qty', fn: 'sum' }] } },
    { key: 'attendees', label: 'Attendees', type: 'list', list: { columns: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email' }, { key: 'line_ref', label: 'Line', type: 'text', hidden: true }] } },
  ])
  const RULES = normalizeFormRules([
    { id: 'r_line', event: 'button_click', target: 'add_line', then: [{ type: 'add_list_row', list_field: 'line_items', values: { item: '{{item}}', qty: '{{qty}}' } }] },
    { id: 'r_person', event: 'button_click', target: 'add_person', then: [{ type: 'add_list_row', list_field: 'attendees', values: { name: '{{person}}', email: '{{email}}', line_ref: '{{item}}' }, clear_fields: ['person', 'email'] }] },
  ])

  it('each List has its own rule, rows, count and totals; a hidden link key relates them', async () => {
    let values: Record<string, unknown> = { item: 'Laptop', qty: '2', person: 'Ada', email: 'ada@example.com', line_items: [], attendees: [] }
    const h: FieldButtonHost = {
      values: () => values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { values = { ...values, ...p } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
      message: () => {}, editableKeys: new Set(TWO.map((f) => f.key)), blank: () => null, field: (k) => TWO.find((f) => f.key === k),
    }
    await runFieldButton({ actions: RULES[1].then }, h) // the attendee first: it links to the current item
    await runFieldButton({ actions: RULES[0].then }, h)
    expect(values.line_items).toEqual([{ item: 'Laptop', qty: 2 }])
    expect(values.attendees).toEqual([{ name: 'Ada', email: 'ada@example.com', line_ref: 'Laptop' }])
    const payload = buildFormSubmittedPayload({ form: { id: FORM, name: 'Two lists', version: 1 }, fields: TWO, values, submission: { id: 's2', created_at: '2026-11-11T00:00:00Z', source: 'standalone' }, submitter: { id: null } })
    expect(payload.form).toMatchObject({ line_items_count: 1, line_items_total_qty: 2, attendees_count: 1 })
    // The list view leaves the hidden link key out.
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(FormRenderer, { fields: TWO, values, readOnly: true })))
    expect(html).toContain('ada@example.com')
    expect(html).not.toContain('>Line<')
  })

  it('a workflow loops over both Lists', async () => {
    const twoNodes = [
      { id: 'trigger', type: 'form_submitted', label: 'Submitted', position: { x: 0, y: 0 }, config: { form_id: FORM, form_name: 'Two lists', fields: TWO } },
      { id: 'lines', type: 'loop', label: 'Each line', position: { x: 0, y: 100 }, config: { items: '{{form.line_items}}', item_var: 'item', index_var: 'index' } },
      { id: 'add_line', type: 'update_data_table', label: 'Add line', position: { x: 0, y: 200 }, config: { table_id: CHILD, table_name: 'Lines', operation: 'insert', column_values: { item: '{{item.item}}', qty: '{{item.qty}}' } } },
      { id: 'people', type: 'loop', label: 'Each attendee', position: { x: 0, y: 300 }, config: { items: '{{form.attendees}}', item_var: 'person', index_var: 'person_index' } },
      { id: 'add_person', type: 'update_data_table', label: 'Add attendee', position: { x: 0, y: 400 }, config: { table_id: PARENT, table_name: 'People', operation: 'insert', column_values: { title: '{{person.name}}', total: '{{person_index}}' } } },
    ]
    const twoEdges = [
      { id: 'a', source: 'trigger', target: 'lines' }, { id: 'b', source: 'lines', target: 'add_line', label: 'Each Item' }, { id: 'c', source: 'lines', target: 'people', label: 'Done' },
      { id: 'd', source: 'people', target: 'add_person', label: 'Each Item' },
    ]
    expect(validateWorkflowWiring({ nodes: twoNodes, edges: twoEdges })).toEqual([])
    createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
    const col = (key: string, type = 'text') => ({ id: `c_${key}`, key, name: key, type, required: false })
    const fake = createFakeSupabase({
      workflows: [{ id: WF, tenant_id: TENANT, name: 'Two', trigger_type: 'form_submitted', nodes: twoNodes, edges: twoEdges, user_variables: [], run_count: 0, published_version_id: null }],
      custom_tables: [
        { id: PARENT, tenant_id: TENANT, name: 'People', columns: [col('title'), col('total', 'number')] },
        { id: CHILD, tenant_id: TENANT, name: 'Lines', columns: [col('item'), col('qty', 'number')] },
      ],
      custom_table_rows: [],
    })
    fake.rpcs.record_workflow_run = () => ({})
    fake.rpcs.enqueue_workflow = () => ({ data: crypto.randomUUID() })
    const payload = buildFormSubmittedPayload({
      form: { id: FORM, name: 'Two lists', version: 1 }, fields: TWO,
      values: { line_items: [{ item: 'Laptop', qty: 1 }, { item: 'Mouse', qty: 2 }], attendees: [{ name: 'Ada' }, { name: 'Bo' }, { name: 'Cy' }] },
      submission: { id: 's3', created_at: '2026-11-11T00:00:00Z', source: 'standalone' }, submitter: { id: null },
    })
    const result = await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
    expect(result.status).toBe('completed')
    const rows = fake.tables.custom_table_rows as any[]
    expect(rows.filter((r) => r.table_id === CHILD).map((r) => r.data.item)).toEqual(['Laptop', 'Mouse'])
    expect(rows.filter((r) => r.table_id === PARENT).map((r) => r.data.title)).toEqual(['Ada', 'Bo', 'Cy'])
  }, 30_000)
})
