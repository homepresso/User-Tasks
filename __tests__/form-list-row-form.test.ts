/**
 * The List row pop-out (lib/forms/list-row-form.ts, components/forms/list-row-dialog.tsx):
 * settings, the 768px layout switch, the edit session (open / change / save /
 * cancel, validations, read-only columns, nested Lists), the open_row_form
 * rule step, the read-only formatter per column type and the "View row" /
 * "Open row" icons in the renderers.
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import '@/lib/forms/form-rules'
import { describeRuleAction, formRuleProblem, normalizeFormRules } from '@/lib/forms/form-rules'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { resolveInputTemplate } from '@/lib/forms/buttons'
import { LIST_SELECT_KEY, ROW_DRAFT_KEY, normalizeListConfig, type ListColumn, type ListFieldConfig } from '@/lib/forms/list-field'
import {
  ROW_FORM_BREAKPOINT, cancelRowForm, formatRowValue, isWideRowFormColumn, openRowForm, rowEditingModes, rowFormBlocks, rowFormDirty, rowFormLayout, rowFormRequest,
  rowFormTitle, rowPositionText, saveRowForm, setRowFormCell, showsViewIcon, type RowFormRequest,
} from '@/lib/forms/list-row-form'
import { ROW_CURRENT_KEY } from '@/lib/forms/row-rules'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { FormRenderer } from '@/components/forms/form-renderer'
import { ListValueView } from '@/components/forms/list-field'
import { RowFormFields } from '@/components/forms/list-row-dialog'

const EXPENSES: ListFieldConfig = normalizeListConfig({
  entry_mode: 'inline',
  row_form: { title: 'Expense: {{row.description}}', layout: [{ section: 'What' }, { column: 'description' }, { column: 'category' }, { section: 'Cost' }, { column: 'amount' }, { column: 'total' }] },
  columns: [
    { key: 'description', label: 'Description', type: 'text', required: true, help_text: 'What it was for' },
    { key: 'category', label: 'Category', type: 'choice', required: true, options: [{ value: 'travel', label: 'Travel' }, { value: 'meals', label: 'Meals' }] },
    { key: 'spent_on', label: 'Date', type: 'date' },
    { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true, min: 0, validations: [{ if: { conditions: [{ column: 'row.amount', operator: 'gt', value: '5000' }] }, message: 'Over USD 5,000 needs a manager' }] },
    { key: 'tax', label: 'Tax', type: 'currency', currency: 'USD', default: '0' },
    { key: 'total', label: 'Total', type: 'calculated', formula: 'amount + tax', currency: 'USD' },
    { key: 'code', label: 'Code', type: 'text', read_only: true, default: 'EXP' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'link_id', label: 'Link', type: 'text', hidden: true },
  ],
  row_validations: [{ if: { match: 'all', conditions: [{ column: 'row.category', operator: 'eq', value: 'meals' }, { column: 'row.amount', operator: 'gt', value: '200' }] }, message: 'Meals over USD 200 need receipts' }],
})

const col = (config: ListFieldConfig, key: string) => config.columns.find((c) => c.key === key)!

describe('settings', () => {
  it('row_editing and row_form normalise: known values, known columns once, headings kept, empty dropped', () => {
    const c = normalizeListConfig({
      row_editing: 'popout',
      row_form: { title: '  Expense {{row.description}} ', hide_view_icon: true, layout: [{ section: 'What' }, 'description', { column: 'description' }, { column: 'nope' }, { section: '' }, { column: 'amount' }, 42] },
      columns: [{ key: 'description', label: 'Description', type: 'text' }, { key: 'amount', label: 'Amount', type: 'currency' }],
    })
    expect(c.row_editing).toBe('popout')
    expect(c.row_form).toEqual({ title: 'Expense {{row.description}}', hide_view_icon: true, layout: [{ section: 'What' }, { column: 'description' }, { column: 'amount' }] })
    expect(normalizeListConfig({ row_editing: 'both', row_form: { layout: [{ column: 'x' }] }, columns: [{ key: 'a', label: 'A' }] })).toEqual({ columns: [{ key: 'a', label: 'A', type: 'text' }] })
    expect(normalizeListConfig({ row_editing: 'sideways', columns: [] }).row_editing).toBeUndefined()
    // A nested List keeps its own pop-out settings.
    const nested = normalizeListConfig({ columns: [{ key: 'lines', label: 'Lines', type: 'list', list: { row_editing: 'inline', row_form: { title: 'Line {{row_number}}' }, columns: [{ key: 'sku', label: 'SKU' }] } }] })
    expect(col(nested, 'lines').list).toMatchObject({ row_editing: 'inline', row_form: { title: 'Line {{row_number}}' } })
  })

  it('task fields keep them (the schema normalises the List)', () => {
    const [f] = normalizeTaskFields([{ key: 'expenses', label: 'Expenses', type: 'list', list: { row_editing: 'inline', row_form: { hide_view_icon: true }, columns: [{ key: 'a', label: 'A' }] } }])
    expect(f.list).toMatchObject({ row_editing: 'inline', row_form: { hide_view_icon: true } })
  })

  it('editing modes: both by default (phones: the pop-out), inline only, pop-out only; the view icon unless hidden', () => {
    expect(rowEditingModes(EXPENSES)).toEqual({ inline: true, popout: true })
    expect(rowEditingModes(EXPENSES, true)).toEqual({ inline: false, popout: true })
    expect(rowEditingModes({ ...EXPENSES, row_editing: 'inline' }, true)).toEqual({ inline: true, popout: false })
    expect(rowEditingModes({ ...EXPENSES, row_editing: 'popout' })).toEqual({ inline: false, popout: true })
    expect(showsViewIcon(EXPENSES)).toBe(true)
    expect(showsViewIcon({ ...EXPENSES, row_form: { hide_view_icon: true } })).toBe(false)
  })
})

describe('layout', () => {
  it('one column in a full-screen sheet below 768px, two columns in a dialog from 768px', () => {
    expect(ROW_FORM_BREAKPOINT).toBe(768)
    expect(rowFormLayout(390)).toEqual({ columns: 1, sheet: true })
    expect(rowFormLayout(767)).toEqual({ columns: 1, sheet: true })
    expect(rowFormLayout(768)).toEqual({ columns: 2, sheet: false })
    expect(rowFormLayout(1440)).toEqual({ columns: 2, sheet: false })
    expect(rowFormLayout(Number.NaN)).toEqual({ columns: 1, sheet: true })
  })

  it('blocks follow row_form.layout, then the columns it left out; hidden columns never; wide types span', () => {
    const blocks = rowFormBlocks(EXPENSES)
    expect(blocks.map((b) => (b.kind === 'section' ? `# ${b.title}` : b.column.key))).toEqual(['# What', 'description', 'category', '# Cost', 'amount', 'total', 'spent_on', 'tax', 'code', 'notes'])
    expect(blocks.find((b) => b.kind === 'column' && b.column.key === 'notes')).toMatchObject({ wide: true })
    expect(blocks.find((b) => b.kind === 'column' && b.column.key === 'amount')).toMatchObject({ wide: false })
    expect(isWideRowFormColumn({ type: 'list' })).toBe(true)
    // A heading with nothing after it goes.
    const two = normalizeListConfig({ columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] })
    expect(rowFormBlocks({ ...two, row_form: { layout: [{ column: 'a' }, { column: 'b' }, { section: 'Empty' }] } }).some((b) => b.kind === 'section')).toBe(false)
    // …while columns the layout left out follow the last heading.
    expect(rowFormBlocks({ ...two, row_form: { layout: [{ column: 'a' }, { section: 'More' }] } }).map((b) => (b.kind === 'section' ? '#' : b.column.key))).toEqual(['a', '#', 'b'])
  })

  it('title: the template with {{row.*}} formatted and {{row_number}}; a default otherwise', () => {
    expect(rowFormTitle(EXPENSES, { description: 'Flight to Denver' }, 2, 'Expenses')).toBe('Expense: Flight to Denver')
    expect(rowFormTitle({ ...EXPENSES, row_form: { title: '{{row.category}} · {{row.amount}} (#{{row_number}})' } }, { category: 'meals', amount: 186.4 }, 1, 'Expenses')).toBe('Meals · $186.40 (#2)')
    expect(rowFormTitle(EXPENSES, { description: '' }, 0, 'Expenses', true)).toBe('Expense')
    expect(rowFormTitle({ columns: EXPENSES.columns }, {}, 2, 'Expenses')).toBe('Expenses · Row 3')
    expect(rowFormTitle({ columns: EXPENSES.columns }, {}, 3, 'Expenses', true)).toBe('Expenses · New row')
    expect(rowPositionText(2, 12)).toBe('Row 3 of 12')
  })
})

describe('editing a row in the pop-out', () => {
  const rows = [{ description: 'Flight', category: 'travel', amount: 412.8, tax: 32.1, total: 444.9, code: 'EXP-1', notes: null }]
  const ctx = { form: {}, user: null }

  it('a new row: the defaults, pending until saved; Save checks required / bounds / validations and commits', () => {
    const opened = openRowForm(EXPENSES, rows, 'new')
    if ('error' in opened) throw new Error(opened.error)
    expect(opened.session).toMatchObject({ index: 1, isNew: true })
    expect(opened.rows[1]).toMatchObject({ tax: 0, code: 'EXP', [ROW_DRAFT_KEY]: 'new' })
    expect(rowFormDirty(EXPENSES, opened.rows, opened.session)).toBe(false)
    const failed = saveRowForm(EXPENSES, opened.rows, opened.session, ctx)
    expect(failed.ok).toBe(false)
    expect(!failed.ok && failed.errors).toMatchObject({ description: 'Description is required', category: 'Category is required', amount: 'Amount is required' })
    let value: unknown = opened.rows
    for (const [k, v] of Object.entries({ description: 'Hotel', category: 'meals', amount: '6000' })) value = setRowFormCell(EXPENSES, value, opened.session, k, v)
    // A read-only column on a new row (before its first commit) may still be set.
    value = setRowFormCell(EXPENSES, value, opened.session, 'code', 'EXP-2')
    expect(rowFormDirty(EXPENSES, value, opened.session)).toBe(true)
    const invalid = saveRowForm(EXPENSES, value, opened.session, ctx)
    expect(!invalid.ok && invalid.errors).toEqual({ amount: 'Over USD 5,000 needs a manager', _row: 'Meals over USD 200 need receipts' })
    value = setRowFormCell(EXPENSES, value, opened.session, 'amount', '150')
    const saved = saveRowForm(EXPENSES, value, opened.session, ctx)
    expect(saved.ok).toBe(true)
    if (!saved.ok) return
    expect(saved.row).toMatchObject({ description: 'Hotel', amount: 150, tax: 0, total: 150, code: 'EXP-2' })
    expect(saved.row[ROW_DRAFT_KEY]).toBeUndefined()
    expect(saved.rows).toHaveLength(2)
  })

  it('an existing row: read-only and calculated columns stay; Cancel puts the row back; a new row goes', () => {
    const opened = openRowForm(EXPENSES, rows, 0)
    if ('error' in opened) throw new Error(opened.error)
    expect(opened.session).toMatchObject({ index: 0, isNew: false })
    let value: unknown = setRowFormCell(EXPENSES, rows, opened.session, 'code', 'HACKED')
    expect((value as any[])[0].code).toBe('EXP-1')
    expect((setRowFormCell(EXPENSES, rows, opened.session, 'total', 1) as any[])[0].total).toBe(444.9)
    value = setRowFormCell(EXPENSES, value, opened.session, 'description', 'Flight to Denver')
    expect(rowFormDirty(EXPENSES, value, opened.session)).toBe(true)
    expect(cancelRowForm(value, opened.session)).toEqual(rows)
    const added = openRowForm(EXPENSES, rows, 'new')
    if ('error' in added) throw new Error(added.error)
    expect(cancelRowForm(added.rows, added.session)).toEqual(rows)
    // Typed the same: "412.8" and 412.8 are no change.
    expect(rowFormDirty(EXPENSES, [{ ...rows[0], amount: '412.8' }], opened.session)).toBe(false)
  })

  it('a full List refuses a new row; a row that is not there cannot open', () => {
    expect(openRowForm({ ...EXPENSES, max_rows: 1 }, rows, 'new')).toEqual({ error: 'At most 1 row' })
    expect(openRowForm(EXPENSES, rows, 5)).toEqual({ error: 'That row is not in the list' })
  })

  it('a row a rule added (open_row_form "new") opens as new: Cancel removes it', () => {
    const value = [...rows, { description: null, [ROW_DRAFT_KEY]: 'new' }]
    const opened = openRowForm(EXPENSES, value, 1, { isNew: true })
    if ('error' in opened) throw new Error(opened.error)
    expect(opened.session.isNew).toBe(true)
    expect(cancelRowForm(value, opened.session)).toEqual(rows)
  })

  it('a nested List inside the parent row: its rows are checked with the row and committed typed', () => {
    const orders = normalizeListConfig({ columns: [
      { key: 'customer', label: 'Customer', type: 'text', required: true },
      { key: 'lines', label: 'Lines', type: 'list', required: true, list: { columns: [{ key: 'sku', label: 'SKU', required: true }, { key: 'qty', label: 'Qty', type: 'number', default: '1' }, { key: 'price', label: 'Price', type: 'currency' }, { key: 'amount', label: 'Amount', type: 'calculated', formula: 'qty * price' }], totals: [{ column: 'amount', fn: 'sum' }] } },
    ] })
    const opened = openRowForm(orders, [], 'new')
    if ('error' in opened) throw new Error(opened.error)
    let value: unknown = setRowFormCell(orders, opened.rows, opened.session, 'customer', 'Acme Corp')
    const empty = saveRowForm(orders, value, opened.session, { form: {}, user: null })
    expect(!empty.ok && empty.errors.lines).toBe('Lines: add at least one row')
    value = setRowFormCell(orders, value, opened.session, 'lines', [{ sku: '', qty: '2', price: '1250' }])
    const missing = saveRowForm(orders, value, opened.session, { form: {}, user: null })
    expect(!missing.ok && missing.errors.lines).toBe('Lines: row 1: SKU is required')
    value = setRowFormCell(orders, value, opened.session, 'lines', [{ sku: 'LAP-14', qty: '2', price: '1250' }])
    const saved = saveRowForm(orders, value, opened.session, { form: {}, user: null })
    expect(saved.ok && saved.row).toMatchObject({ customer: 'Acme Corp', lines: [{ sku: 'LAP-14', qty: 2, price: 1250, amount: 2500 }], lines_count: 1, lines_total_amount: 2500 })
  })
})

describe('open_row_form (rule step)', () => {
  const FIELDS = [
    { key: 'expenses', label: 'Expenses', type: 'list', list: EXPENSES },
    { key: 'orders', label: 'Orders', type: 'list', list: normalizeListConfig({ columns: [{ key: 'customer', label: 'Customer' }, { key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'sku', label: 'SKU' }] } }] }) },
    { key: 'note', label: 'Note', type: 'text' },
  ]
  const ROWS = [{ description: 'Flight', category: 'travel', amount: 412.8 }, { description: 'Dinner', category: 'meals', amount: 186.4 }]
  const ORDERS = [{ customer: 'Acme', lines: [{ sku: 'A-1' }] }, { customer: 'Globex', lines: [{ sku: 'B-1' }, { sku: 'B-2' }] }]
  const act = (raw: Record<string, unknown>) => normalizeFieldButtonAction(raw, { rule: true })!
  function host(values: Record<string, unknown>, opts: { editable?: string[]; noOpener?: boolean } = {}) {
    const state = { values: { ...values }, messages: [] as string[], opened: [] as RowFormRequest[], events: [] as string[] }
    const byKey = new Map(FIELDS.map((f) => [f.key, f]))
    const h: FieldButtonHost = {
      values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
      message: (t) => { state.messages.push(t) }, editableKeys: new Set(opts.editable ?? FIELDS.map((f) => f.key)), blank: () => null, field: (k) => byKey.get(k) as any,
      emit: (type) => { state.events.push(type) },
      ...(opts.noOpener ? {} : { openRowForm: (r: RowFormRequest) => { state.opened.push(r); return true } }),
    }
    return { h, state }
  }
  const resolve = (template: string, values: Record<string, unknown>, extras: Record<string, unknown>) => resolveInputTemplate(template, { values, extras })

  it('normalises: the List, the row (number → text, default current), the empty-row message; nested child / parent row', () => {
    expect(act({ type: 'open_row_form', field: 'expenses', row: 3 })).toEqual({ type: 'open_row_form', field: 'expenses', row: '3' })
    expect(act({ type: 'open_row_form', field: 'Bad Key!' })).toEqual({ type: 'open_row_form', row: 'current' })
    expect(act({ type: 'open_row_form', field: 'orders', row: 'new', child: 'lines', parent_row: 2, empty_text: 'Pick one' })).toEqual({ type: 'open_row_form', field: 'orders', row: 'new', child: 'lines', parent_row: '2', empty_text: 'Pick one' })
  })

  it('is in the rules catalog: problems, description, rules keep it', () => {
    const def = { fields: FIELDS as any, layout: { rows: [] } } as any
    expect(describeRuleAction(def, act({ type: 'open_row_form', field: 'expenses', row: 'new' }))).toBe('Open a new row of Expenses in a pop-out form')
    expect(describeRuleAction(def, act({ type: 'open_row_form', field: 'expenses', row: 'selected' }))).toBe('Open the selected rows of Expenses in a pop-out form')
    const known = { fieldTypes: new Map([['expenses', 'list'], ['note', 'text']]), pageIds: new Set<string>(), flags: new Set<string>() } as any
    const rule = (a: Record<string, unknown>) => normalizeFormRules([{ id: 'r1', event: 'form_load', then: [a] }])[0]
    expect(rule({ type: 'open_row_form', field: 'expenses' }).then[0]).toMatchObject({ type: 'open_row_form', field: 'expenses', row: 'current' })
    expect(formRuleProblem(rule({ type: 'open_row_form', field: 'note' }), known)).toMatch(/choose the List/)
    expect(formRuleProblem(rule({ type: 'open_row_form', field: 'expenses' }), known)).toBeNull()
  })

  it('opens the current row (else the row of the event), a number or a template', async () => {
    const t = host({ expenses: ROWS, [ROW_CURRENT_KEY]: { expenses: { index: 1 } } })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses' })] }, t.h, { resolve })
    expect(t.state.opened).toEqual([{ field: 'expenses', path: [1], steps: [] }])
    const e = host({ expenses: ROWS })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses' })] }, e.h, { resolve, extras: { event: { field: 'expenses', row_number: 1 } } })
    expect(e.state.opened).toEqual([{ field: 'expenses', path: [0], steps: [] }])
    const n = host({ expenses: ROWS, which: 2 })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: '{{which}}' })] }, n.h, { resolve })
    expect(n.state.opened).toEqual([{ field: 'expenses', path: [1], steps: [] }])
  })

  it('the selected row; none selected: the message and the rule stops', async () => {
    const t = host({ expenses: ROWS, [LIST_SELECT_KEY]: { expenses: [1] } })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: 'selected' })] }, t.h, { resolve })
    expect(t.state.opened[0].path).toEqual([1])
    const none = host({ expenses: ROWS })
    const run = await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: 'selected' }), act({ type: 'clear_values', fields: ['note'] })] }, none.h, { resolve })
    expect(none.state.messages).toEqual(['Select a row first'])
    expect(run.stopped).toBe('selection_empty')
    expect(none.state.opened).toEqual([])
  })

  it('a new row: added pending with the defaults, current, then opened as new (Cancel removes it)', async () => {
    const t = host({ expenses: ROWS })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: 'new' })] }, t.h, { resolve })
    const rows = t.state.values.expenses as any[]
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ tax: 0, code: 'EXP', [ROW_DRAFT_KEY]: 'new' })
    expect(t.state.values[ROW_CURRENT_KEY]).toEqual({ expenses: { index: 2 } })
    expect(t.state.events).toEqual(['row_created'])
    expect(t.state.opened).toEqual([{ field: 'expenses', path: [2], steps: [], isNew: true }])
  })

  it('a read-only List still opens a row (to read); a new row needs an editable List', async () => {
    const t = host({ expenses: ROWS }, { editable: [] })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: 'first' })] }, t.h, { resolve })
    expect(t.state.opened).toEqual([{ field: 'expenses', path: [0], steps: [] }])
    const n = host({ expenses: ROWS }, { editable: [] })
    const run = await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: 'new' })] }, n.h, { resolve })
    expect(run.stopped).toBe('list_unavailable')
    expect((n.state.values.expenses as any[]).length).toBe(2)
  })

  it('a nested List row: the parent row and the child row, as one request for the field', async () => {
    const t = host({ orders: ORDERS })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'orders', child: 'lines', parent_row: '2', row: 'last' })] }, t.h, { resolve })
    expect(t.state.opened).toEqual([{ field: 'orders', path: [1, 1], steps: ['lines'] }])
    const n = host({ orders: ORDERS })
    await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'orders', child: 'lines', parent_row: '1', row: 'new' })] }, n.h, { resolve })
    expect((n.state.values.orders as any[])[0].lines).toHaveLength(2)
    expect(n.state.opened).toEqual([{ field: 'orders', path: [0, 1], steps: ['lines'], isNew: true }])
  })

  it('a surface without pop-outs (the server): nothing happens, the rule goes on', async () => {
    const t = host({ expenses: ROWS, note: 'x' }, { noOpener: true })
    const run = await runFieldButton({ actions: [act({ type: 'open_row_form', field: 'expenses', row: '1' }), act({ type: 'clear_values', fields: ['note'] })] }, t.h, { resolve })
    expect(run.stopped).toBeUndefined()
    expect(t.state.values.note).toBeNull()
  })

  it('request keys: a nested List key becomes the field, the parent rows and the steps', () => {
    expect(rowFormRequest('orders', 2)).toEqual({ field: 'orders', path: [2], steps: [] })
    expect(rowFormRequest('orders.1.lines', 0, true)).toEqual({ field: 'orders', path: [1, 0], steps: ['lines'], isNew: true })
    expect(rowFormRequest('orders.1.lines.0.serials', 3)).toEqual({ field: 'orders', path: [1, 0, 3], steps: ['lines', 'serials'] })
    expect(rowFormRequest('orders.x.lines', 0)).toBeNull()
    expect(rowFormRequest('orders.1', 0)).toBeNull()
  })
})

describe('reading a row: one formatter per column type', () => {
  const c = (raw: Record<string, unknown>): ListColumn => normalizeListConfig({ columns: [{ key: 'v', label: 'Value', ...raw }] }).columns[0]
  it('currency in its currency, numbers, dates, choice labels, Yes / No, lookups by their label', () => {
    expect(formatRowValue(c({ type: 'currency', currency: 'USD' }), 1250)).toEqual({ kind: 'text', text: '$1,250.00', numeric: true })
    expect(formatRowValue(c({ type: 'calculated', formula: 'v', currency: 'USD' }), 444.9)).toMatchObject({ text: '$444.90' })
    expect(formatRowValue(c({ type: 'number' }), 1234.5)).toMatchObject({ text: '1,234.5', numeric: true })
    expect(formatRowValue(c({ type: 'date' }), '2026-11-03', null, { locale: 'en-US' })).toEqual({ kind: 'text', text: 'Nov 3, 2026' })
    expect(formatRowValue(c({ type: 'date' }), '2026-11-03', null, { locale: 'en-GB' })).toEqual({ kind: 'text', text: '3 Nov 2026' })
    expect(formatRowValue(c({ type: 'choice', options: [{ value: 'meals', label: 'Meals' }] }), 'meals')).toEqual({ kind: 'text', text: 'Meals' })
    expect(formatRowValue(c({ type: 'boolean' }), true)).toEqual({ kind: 'text', text: 'Yes' })
    expect(formatRowValue(c({ type: 'boolean' }), false)).toEqual({ kind: 'text', text: 'No' })
    expect(formatRowValue(c({ type: 'lookup' }), 'p1', { v_label: 'Laptop 14"' })).toEqual({ kind: 'text', text: 'Laptop 14"' })
  })

  it('links: web addresses, emails, a URL link value with its text; unsafe schemes stay text', () => {
    expect(formatRowValue(c({ type: 'text' }), 'https://example.com/receipts/1.pdf')).toEqual({ kind: 'link', href: 'https://example.com/receipts/1.pdf', text: 'https://example.com/receipts/1.pdf', external: true })
    expect(formatRowValue(c({ type: 'email' }), 'ada@example.com')).toEqual({ kind: 'link', href: 'mailto:ada@example.com', text: 'ada@example.com', external: false })
    expect(formatRowValue(c({ type: 'text' }), JSON.stringify({ url: 'https://example.com/r/9', text: 'Receipt 9' }))).toMatchObject({ kind: 'link', href: 'https://example.com/r/9', text: 'Receipt 9' })
    expect(formatRowValue(c({ type: 'text' }), 'javascript:alert(1)')).toEqual({ kind: 'text', text: 'javascript:alert(1)' })
  })

  it('pictures: an Image value as a thumbnail (full size beside it), a stored image URL', () => {
    const file = { id: '11111111-1111-4111-8111-111111111111', name: 'receipt.png', size: 2048, mime_type: 'image/png', url: '/attachments/11111111-1111-4111-8111-111111111111', storage_ref: 'storage://form-files/t/receipt.png', uploaded_by: null, uploaded_at: '2026-11-03T10:00:00Z' }
    const image = formatRowValue(c({ type: 'text' }), JSON.stringify(file))
    expect(image).toMatchObject({ kind: 'image', name: 'receipt.png', alt: 'Value: receipt.png' })
    expect(image.kind === 'image' && image.src).toMatch(/\/attachments\/11111111-1111-4111-8111-111111111111\?inline=1$/)
    expect(formatRowValue(c({ type: 'text' }), 'https://cdn.example.com/a/receipt.jpg')).toMatchObject({ kind: 'image', src: 'https://cdn.example.com/a/receipt.jpg' })
  })

  it('a signature: the image, the signer and when', () => {
    const sig = { file: { id: '22222222-2222-4222-8222-222222222222', name: 'signature.png', size: 900, mime_type: 'image/png', url: '/attachments/22222222-2222-4222-8222-222222222222', storage_ref: 'storage://form-files/t/s.png', uploaded_by: null, uploaded_at: '2026-11-03T10:00:00Z' }, method: 'draw', signed_at: '2026-11-03T10:00:00Z', user_name: 'Ada Lovelace' }
    const view = formatRowValue(c({ type: 'text' }), JSON.stringify(sig))
    expect(view).toMatchObject({ kind: 'signature', signer: 'Ada Lovelace' })
    expect(view.kind === 'signature' && view.text).toMatch(/^Signed by Ada Lovelace on /)
    expect(view.kind === 'signature' && view.src).toMatch(/22222222-2222-4222-8222-222222222222\?inline=1$/)
  })

  it('long text keeps its lines; rich text is sanitised; nothing is "—"; a nested List counts its rows', () => {
    expect(formatRowValue(c({ type: 'textarea' }), 'Economy, return.\r\nBooked by the travel desk.')).toEqual({ kind: 'multiline', text: 'Economy, return.\nBooked by the travel desk.' })
    expect(formatRowValue(c({ type: 'text' }), 'one\ntwo')).toMatchObject({ kind: 'multiline' })
    const rich = formatRowValue(c({ type: 'textarea' }), '<p>Hi <b>there</b></p><script>alert(1)</script>')
    expect(rich.kind).toBe('rich')
    expect(rich.kind === 'rich' && rich.html).toContain('<b>there</b>')
    expect(rich.kind === 'rich' && rich.html).not.toContain('script')
    for (const v of [null, undefined, '', '   ']) expect(formatRowValue(c({ type: 'text' }), v)).toEqual({ kind: 'empty', text: '—' })
    expect(formatRowValue(c({ type: 'currency' }), null)).toEqual({ kind: 'empty', text: '—' })
    expect(formatRowValue(c({ type: 'list', label: 'Lines', list: { columns: [{ key: 'sku', label: 'SKU' }] } }), [{ sku: 'A' }, { sku: 'B' }])).toEqual({ kind: 'rows', count: 2, text: '2 lines' })
  })
})

describe('renderers', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const field = { key: 'expenses', label: 'Expenses', type: 'list', list: EXPENSES } as any
  const rows = [{ description: 'Flight', category: 'travel', amount: 412.8, tax: 32.1 }, { description: 'Dinner', category: 'meals', amount: 186.4, tax: 14.9 }]

  it('read-only rows (submission / task views): "View row" per row, no inputs; hide_view_icon hides it', () => {
    const html = wrap(createElement(ListValueView, { field, value: rows, narrow: true }))
    expect(html).toContain('data-row-form-open="view"')
    expect(html).toContain('aria-label="View row 2"')
    expect(html).not.toMatch(/<(input|select|textarea)\b/)
    const hidden = wrap(createElement(ListValueView, { field: { ...field, list: { ...EXPENSES, row_form: { hide_view_icon: true } } }, value: rows }))
    expect(hidden).not.toContain('data-row-form-open')
  })

  it('a read-only form (FormRenderer readOnly) and a List read only on a step: View row; an editable List: Open row + Add in form', () => {
    const fields = normalizeTaskFields([{ key: 'expenses', label: 'Expenses', type: 'list', list: EXPENSES }])
    const ro = wrap(createElement(FormRenderer, { fields, values: { expenses: rows }, readOnly: true }))
    expect(ro).toContain('data-row-form-open="view"')
    expect(ro).not.toContain('data-row-form-open="edit"')
    const locked = normalizeTaskFields([{ key: 'expenses', label: 'Expenses', type: 'list', read_only: true, list: EXPENSES }])
    expect(wrap(createElement(FormRenderer, { fields: locked, values: { expenses: rows }, onChange: () => {} }))).toContain('data-row-form-open="view"')
    const edit = wrap(createElement(FormRenderer, { fields, values: { expenses: rows }, onChange: () => {} }))
    expect(edit).toContain('data-row-form-open="edit"')
    expect(edit).toContain('aria-label="Open row 1"')
    expect(edit).toContain('data-list-add-form')
    expect(edit).toContain('data-list-input="description"')
  })

  it('row_editing inline: no pop-out; popout: rows read-only with Open row, Add row opens the form', () => {
    const inline = normalizeTaskFields([{ key: 'expenses', label: 'Expenses', type: 'list', list: { ...EXPENSES, row_editing: 'inline' } }])
    const a = wrap(createElement(FormRenderer, { fields: inline, values: { expenses: rows }, onChange: () => {} }))
    expect(a).not.toContain('data-row-form-open')
    expect(a).not.toContain('data-list-add-form')
    const popout = normalizeTaskFields([{ key: 'expenses', label: 'Expenses', type: 'list', list: { ...EXPENSES, row_editing: 'popout' } }])
    const b = wrap(createElement(FormRenderer, { fields: popout, values: { expenses: rows }, onChange: () => {} }))
    expect(b).toContain('data-row-editing="popout"')
    expect(b).toContain('data-row-form-open="edit"')
    expect(b).not.toContain('data-list-input=')
    expect(b).toContain('data-list-add')
  })

  it('the form inside the dialog: view mode shows formatted values and no inputs; edit mode labels, help, required, errors', () => {
    const view = renderToStaticMarkup(createElement(RowFormFields, { mode: 'view', config: EXPENSES, row: { description: 'Flight', category: 'travel', amount: 412.8, tax: 32.1, notes: 'Line one\nLine two' }, columns: 2, idBase: 'x' }))
    expect(view).not.toMatch(/<(input|select|textarea)\b/)
    expect(view).toContain('Travel')
    expect(view).toContain('$412.80')
    expect(view).toContain('$444.90')
    expect(view).toContain('data-row-form-grid="2"')
    expect(view).toContain('data-row-form-section')
    expect(view).toMatch(/class="[^"]*col-span-2[^"]*" data-row-form-value="notes"/)
    expect(view).toContain('data-row-value="empty"')
    const edit = renderToStaticMarkup(createElement(RowFormFields, { mode: 'edit', config: EXPENSES, row: {}, columns: 1, idBase: 'x', errors: { description: 'Description is required' },
      renderInput: (column: ListColumn, id: string) => createElement('input', { id, 'data-list-input': column.key }) }))
    expect(edit).toContain('data-row-form-grid="1"')
    expect(edit).toContain('<label for="x-f-description"')
    expect(edit).toContain('What it was for')
    expect(edit).toContain('(required)')
    expect(edit).toContain('data-row-form-error="description"')
    expect(edit).not.toContain('col-span-2')
  })
})
