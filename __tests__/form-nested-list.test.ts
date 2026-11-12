/**
 * Nested Lists (lib/forms/list-field.ts — a List column of type `list`):
 * normalisation and the 3-level cap, coercion / validation recursing (required,
 * read-only when editing, min / max rows, calculated columns, paths such as
 * `orders[1].lines[0].qty`), the derived totals (per parent row and over all
 * parents), the List rule steps on a nested List (`child` / `parent_row`,
 * {{row.*}} / {{parent.*}}), nested workflow loops (item + parent_item), the
 * data picker / wiring check, and the "3 rows (7 lines)" summary.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ListField, ListValueView } from '@/components/forms/list-field'
import { formatFieldValue } from '@/components/forms/form-renderer'
import {
  LIST_LIMITS, LIST_MAX_DEPTH, checkListValue, childListAt, childListPaths, coerceListRows, describeListValue, formatListCell, keepReadOnlyListColumns,
  listConfigProblem, listDerivedKeys, listDerivedValues, listValuePathErrors, listValueText, nestedListKey, nestedRowsIn, normalizeListConfig, withNestedRows,
} from '@/lib/forms/list-field'
import { ROW_DRAFT_KEY } from '@/lib/forms/row-markers'
import { ROW_CURRENT_KEY } from '@/lib/forms/row-rules'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { describeRuleAction, formRuleProblem, normalizeFormRules, ruleValue } from '@/lib/forms/form-rules'
import { resolveInputTemplate } from '@/lib/forms/buttons'
import { coerceTaskFieldValues, normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'

const ORDERS = normalizeListConfig({
  columns: [
    { key: 'customer', label: 'Customer', type: 'text', required: true },
    { key: 'po', label: 'PO', type: 'text', read_only: true },
    {
      key: 'lines', label: 'Lines', type: 'list', required: true,
      list: {
        columns: [
          { key: 'sku', label: 'SKU', type: 'text', required: true, read_only: true },
          { key: 'qty', label: 'Qty', type: 'number', min: 1, default: '1' },
          { key: 'price', label: 'Price', type: 'currency', currency: 'USD' },
          { key: 'size', label: 'Size', type: 'choice', options: ['S', 'M', 'L'] },
          { key: 'amount', label: 'Amount', type: 'calculated', formula: 'qty * price', currency: 'USD' },
        ],
        totals: [{ column: 'amount', fn: 'sum' }],
        max_rows: 5,
        key_column: 'sku',
      },
    },
  ],
  totals: [{ column: 'lines', fn: 'count' }],
  key_column: 'po',
})

const VALUE = [
  { customer: 'Acme', po: 'P-1', lines: [{ sku: 'A-1', qty: 2, price: 1250 }, { sku: 'A-2', qty: 1, price: 99.5 }, { sku: '', qty: '', price: '' }] },
  { customer: 'Globex', po: 'P-2', lines: [{ sku: 'B-1', qty: 3, price: 10 }, { sku: 'B-2', qty: 1, price: 5 }, { sku: 'B-3', qty: 4, price: 2.5 }] },
  { customer: 'Initech', po: 'P-3', lines: [{ sku: 'C-1', qty: 1, price: 40 }, { sku: 'C-2', qty: 2, price: 30 }] },
]

describe('nested List config', () => {
  it('normalises a list column with its own config (child keeps columns / totals / limits only)', () => {
    const lines = ORDERS.columns.find((c) => c.key === 'lines')!
    expect(lines.type).toBe('list')
    expect(lines.list!.columns.map((c) => c.key)).toEqual(['sku', 'qty', 'price', 'size', 'amount'])
    expect(lines.list!.totals).toEqual([{ column: 'amount', fn: 'sum' }])
    expect(lines.list!.max_rows).toBe(5)
    const child = normalizeListConfig({ columns: [{ key: 'x', type: 'text' }], selectable: 'single', entry_mode: 'inline', row_click: true }, 2)
    expect(child).toEqual({ columns: [{ key: 'x', label: 'x', type: 'text' }] })
    expect(listConfigProblem(ORDERS)).toBeNull()
    expect(childListPaths(ORDERS)).toEqual([['lines']])
    expect(childListAt(ORDERS, 'lines')!.config.columns).toHaveLength(5)
  })

  it(`caps nesting at ${LIST_MAX_DEPTH} levels (and checks inner levels)`, () => {
    const level = (depth: number): Record<string, unknown> => ({ columns: [{ key: 'name', type: 'text' }, ...(depth > 1 ? [{ key: `l${depth}`, type: 'list', list: level(depth - 1) }] : [])] })
    expect(listConfigProblem(normalizeListConfig(level(3)))).toBeNull()
    expect(childListPaths(normalizeListConfig(level(3))).map((p) => p.join('.'))).toEqual(['l3', 'l3.l2'])
    expect(listConfigProblem(normalizeListConfig(level(4)))).toMatch(/nest at most 3 levels/)
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'a', type: 'text' }, { key: 'lines', type: 'list', list: { columns: [{ key: 'q', type: 'choice' }] } }] }))).toMatch(/Column "lines": column "q": add at least one option/i)
    // A sibling column taking a derived key (lines_count) is refused.
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'lines_count', type: 'number' }, { key: 'lines', type: 'list', list: { columns: [{ key: 'q', type: 'text' }] } }] }))).toMatch(/taken by a nested list/)
  })
})

describe('nested List values', () => {
  it('coerces recursively: blank child rows dropped, calculated cells, per-parent count / totals in the row', () => {
    const rows = coerceListRows(ORDERS, VALUE)
    expect(rows).toHaveLength(3)
    expect(rows[0].lines).toEqual([
      { sku: 'A-1', qty: 2, price: 1250, size: null, amount: 2500 },
      { sku: 'A-2', qty: 1, price: 99.5, size: null, amount: 99.5 },
    ])
    expect(rows[0].lines_count).toBe(2)
    expect(rows[0].lines_total_amount).toBe(2599.5)
    expect(rows[1].lines_total_amount).toBe(45)
  })

  it('validates recursively with paths (required child list, child columns, child max rows, choices)', () => {
    const bad = [
      { customer: 'Acme', lines: [{ sku: 'A-1', qty: 0 }, { sku: '', qty: 2 }] },
      { customer: 'Globex', lines: [] },
      { customer: 'Hooli', lines: [{ sku: 'X', size: 'XL' }] },
    ]
    const check = checkListValue(ORDERS, bad)
    expect(check.errors[0]).toBe('row 1: Lines: row 1: Qty must be at least 1')
    expect(listValuePathErrors('orders', ORDERS, bad)).toEqual({
      'orders[0].lines[0].qty': 'Qty must be at least 1',
      'orders[0].lines[1].sku': 'SKU is required',
      'orders[1].lines': 'add at least one row',
      'orders[2].lines[0].size': 'Size must be one of: S, M, L',
    })
    const tooMany = [{ customer: 'A', lines: Array.from({ length: 6 }, (_, i) => ({ sku: `S${i}` })) }]
    expect(listValuePathErrors('orders', ORDERS, tooMany)).toEqual({ 'orders[0].lines': 'at most 5 rows' })
    expect(checkListValue(ORDERS, VALUE).errors).toEqual([])
    // A pending child row blocks (the child's on_submit_pending default).
    expect(checkListValue(ORDERS, [{ customer: 'A', lines: [{ sku: 'Z', [ROW_DRAFT_KEY]: 'new' }] }]).errors[0]).toMatch(/commit or discard the pending row/)
  })

  it(`holds at most ${LIST_LIMITS.nestedRows} rows over every level`, () => {
    const config = normalizeListConfig({ columns: [{ key: 'n', type: 'text' }, { key: 'kids', type: 'list', list: { columns: [{ key: 'k', type: 'text' }] } }] })
    const big = Array.from({ length: 10 }, (_, i) => ({ n: `p${i}`, kids: Array.from({ length: 250 }, (_, j) => ({ k: `c${j}` })) }))
    expect(checkListValue(config, big).errors[0]).toMatch(/at most 2000 rows in all/)
    const kept = coerceListRows(config, big)
    expect(kept.reduce((n, r) => n + 1 + (r.kids as unknown[]).length, 0)).toBe(LIST_LIMITS.nestedRows)
  })

  it('keeps read-only child columns of a stored parent row (matched by both key columns)', () => {
    const stored = coerceListRows(ORDERS, VALUE)
    const submitted = [{ ...stored[0], po: 'P-1', lines: [{ sku: 'HACK', qty: 9, price: 1 }, { sku: 'A-2', qty: 5, price: 99.5 }] }]
    // The first line's key changed → a new line (its sku stays as sent); the second matched → its read-only sku kept.
    const kept = keepReadOnlyListColumns(ORDERS, submitted, stored)
    expect((kept.rows as any)[0].lines[1].sku).toBe('A-2')
    const renamed = keepReadOnlyListColumns(ORDERS, [{ ...stored[0], po: 'P-1', customer: 'Acme 2', lines: [{ ...(stored[0].lines as any)[0], sku: 'A-1' }] }], stored)
    expect(renamed.restored).toEqual([])
  })

  it('derives grand totals, counts and per-parent counts for the run', () => {
    expect(listDerivedKeys('orders', ORDERS)).toEqual(['orders_count', 'orders_count_lines', 'orders_lines_count', 'orders_lines_counts', 'orders_total_lines_amount'])
    expect(listDerivedValues('orders', ORDERS, VALUE)).toEqual({
      orders_count: 3, orders_count_lines: 3, orders_lines_count: 7, orders_lines_counts: [2, 3, 2], orders_total_lines_amount: 2599.5 + 45 + 100,
    })
  })

  it('summarises "3 rows (7 lines)" (config or not), cells and text', () => {
    expect(describeListValue(VALUE, ORDERS)).toBe('3 rows (7 lines)')
    expect(describeListValue(coerceListRows(ORDERS, VALUE))).toBe('3 rows (7 lines)')
    expect(describeListValue([{ customer: 'A', lines: [{ sku: 'x' }] }], ORDERS)).toBe('1 row (1 line)')
    expect(formatListCell(ORDERS.columns[2], VALUE[1].lines)).toBe('3 lines')
    expect(listValueText(ORDERS, coerceListRows(ORDERS, VALUE).slice(0, 1))).toContain('   Lines:\n   1. SKU: A-1')
  })

  it('validates and stores through the task field schema (submit)', () => {
    const fields = normalizeTaskFields([{ key: 'orders', label: 'Orders', type: 'list', list: ORDERS }])
    expect(validateTaskFieldValues(fields, { orders: VALUE })).toEqual({})
    expect(validateTaskFieldValues(fields, { orders: [{ customer: 'A', lines: [] }] }).orders).toMatch(/Orders: row 1: Lines: add at least one row/)
    const typed = coerceTaskFieldValues(fields, { orders: VALUE }) as Record<string, any>
    expect(typed.orders[2].lines_total_amount).toBe(100)
    expect(typed.orders[0].lines).toHaveLength(2)
  })

  it('addresses a nested List of a parent row (key, rows, replace)', () => {
    expect(nestedListKey('orders', [1], ['lines'])).toBe('orders.1.lines')
    expect(nestedListKey('orders', [1, 0], ['lines', 'serials'])).toBe('orders.1.lines.0.serials')
    expect(nestedRowsIn(VALUE, [2], ['lines'])).toHaveLength(2)
    const next = withNestedRows(VALUE, [2], ['lines'], [{ sku: 'Z' }])
    expect(next[2].lines).toEqual([{ sku: 'Z' }])
    expect(next[0]).toBe(VALUE[0])
  })
})

/* ── Rules on a nested List ─────────────────────────────────────────── */

const FIELDS = normalizeTaskFields([
  { key: 'sku_input', label: 'SKU', type: 'text' },
  { key: 'orders', label: 'Orders', type: 'list', list: { ...ORDERS, selectable: 'multiple' } },
])

function host(initial: Record<string, unknown>) {
  const state = { values: { ...initial } as Record<string, unknown>, messages: [] as string[], events: [] as Array<{ type: string; target: string; context: any }> }
  const byKey = new Map(FIELDS.map((f) => [f.key, f]))
  const h: FieldButtonHost = {
    values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
    goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
    message: (t) => { state.messages.push(t) }, editableKeys: new Set(FIELDS.map((f) => f.key)), blank: () => null, field: (k) => byKey.get(k) as any,
    ask: async () => 'yes', emit: (type, target, context) => { state.events.push({ type, target, context }) },
  }
  return { h, state }
}
const act = (raw: Record<string, unknown>) => normalizeFieldButtonAction(raw, { rule: true })!
const resolve = (template: string, values: Record<string, unknown>, extras: Record<string, unknown>) => resolveInputTemplate(template, { values, extras })
const STORED = coerceListRows(ORDERS, VALUE)

describe('List steps on a nested List (child / parent_row)', () => {
  it('normalises child / parent_row (List steps only; current is the default)', () => {
    expect(act({ type: 'add_list_row', list_field: 'orders', child: 'lines', parent_row: '2', values: { sku: 'x' } })).toMatchObject({ child: 'lines', parent_row: '2' })
    expect(act({ type: 'new_row', field: 'orders', child: 'lines.serials', parent_row: 'current' })).toMatchObject({ child: 'lines.serials' })
    expect(act({ type: 'new_row', field: 'orders', child: 'lines', parent_row: 'current' }).parent_row).toBeUndefined()
    expect(act({ type: 'set_row_values', field: 'orders', child: 'Lines!', values: { a: '1' } }).child).toBeUndefined()
    expect(act({ type: 'set_values', child: 'lines', assign: {} }).child).toBeUndefined()
    expect(act({ type: 'remove_list_row', list_field: 'orders', child: 'lines', parent_row: 3 }).parent_row).toBe('3')
  })

  it('add_list_row appends to the parent row\'s nested List ({{parent.*}} resolves)', async () => {
    const t = host({ orders: STORED, sku_input: 'NEW-1' })
    await runFieldButton({ actions: [act({ type: 'add_list_row', list_field: 'orders', child: 'lines', parent_row: '3', values: { sku: '{{sku_input}}-{{parent.po}}', qty: '2', price: '7.5' } })] }, t.h, { resolve })
    const orders = t.state.values.orders as any[]
    expect(orders[2].lines.map((l: any) => l.sku)).toEqual(['C-1', 'C-2', 'NEW-1-P-3'])
    expect(orders[2].lines[2].amount).toBe(15)
    expect(orders[0]).toEqual(STORED[0])
    // Mixed templates don't clear their inputs (only a column mapped straight from an input does).
    expect(t.state.values.sku_input).toBe('NEW-1')
  })

  it('update / remove / clear a nested row (event parent row; {{row.*}} = the nested row)', async () => {
    const t = host({ orders: STORED })
    const event = { field: 'orders', row_number: 2, row: STORED[1] }
    await runFieldButton({ actions: [act({ type: 'update_list_row', list_field: 'orders', child: 'lines', row: 'first', values: { qty: '{{row.qty}}0' } })] }, t.h, { resolve, extras: { event } })
    expect((t.state.values.orders as any[])[1].lines[0].qty).toBe(30)
    await runFieldButton({ actions: [act({ type: 'remove_list_row', list_field: 'orders', child: 'lines', parent_row: '{{event.row_number}}', row: 'last' })] }, t.h, { resolve, extras: { event } })
    expect((t.state.values.orders as any[])[1].lines.map((l: any) => l.sku)).toEqual(['B-1', 'B-2'])
    await runFieldButton({ actions: [act({ type: 'clear_list', list_field: 'orders', child: 'lines', parent_row: '1' })] }, t.h, { resolve })
    expect((t.state.values.orders as any[])[0].lines).toEqual([])
    expect((t.state.values.orders as any[])[1].lines).toHaveLength(2)
  })

  it('new_row → set_row_values → commit_row on a nested List: current row kept under orders.<n>.lines; events name the List', async () => {
    const t = host({ orders: STORED })
    await runFieldButton({ actions: [
      act({ type: 'new_row', field: 'orders', child: 'lines', parent_row: 'last', values: { sku: 'N-{{parent.customer}}' } }),
      act({ type: 'set_row_values', field: 'orders', child: 'lines', parent_row: 'last', values: { qty: '5', price: '2' } }),
    ] }, t.h, { resolve })
    let lines = (t.state.values.orders as any[])[2].lines
    expect(lines[2]).toMatchObject({ sku: 'N-Initech', qty: 5, price: 2, amount: 10, [ROW_DRAFT_KEY]: 'new' })
    expect((t.state.values[ROW_CURRENT_KEY] as any)['orders.2.lines']).toEqual({ index: 2 })
    expect(t.state.events[0]).toMatchObject({ type: 'row_created', target: 'orders', context: { field: 'orders', child: 'lines', parent_row_number: 3, parent: { customer: 'Initech' }, row_number: 3 } })
    await runFieldButton({ actions: [act({ type: 'commit_row', field: 'orders', child: 'lines', parent_row: '3', on_success: [{ type: 'message', text: 'Saved {{result.row.sku}} on {{parent.po}}' }] })] }, t.h, { resolve })
    lines = (t.state.values.orders as any[])[2].lines
    expect(lines[2][ROW_DRAFT_KEY]).toBeUndefined()
    expect(t.state.messages).toEqual(['Saved N-Initech on P-3'])
  })

  it('selected parent rows: each one\'s nested List; delete_row / discard on the nested List', async () => {
    const t = host({ orders: STORED, __list_select: { orders: [0, 2] } })
    await runFieldButton({ actions: [act({ type: 'delete_row', field: 'orders', child: 'lines', parent_row: 'selected', row: 'first' })] }, t.h, { resolve })
    const orders = t.state.values.orders as any[]
    expect(orders.map((o) => o.lines.length)).toEqual([1, 3, 1])
    const none = host({ orders: STORED })
    const run = await runFieldButton({ actions: [act({ type: 'clear_list', list_field: 'orders', child: 'lines', parent_row: 'selected' })] }, none.h, { resolve })
    expect(run.stopped).toBe('selection_empty')
    expect(none.state.messages).toEqual(['Select a row first'])
  })

  it('a missing nested List or parent row does nothing harmful', async () => {
    const t = host({ orders: STORED })
    const bad = await runFieldButton({ actions: [act({ type: 'clear_list', list_field: 'orders', child: 'nope', parent_row: '1' })] }, t.h, { resolve })
    expect(bad.stopped).toBe('list_unavailable')
    const none = await runFieldButton({ actions: [act({ type: 'clear_list', list_field: 'orders', child: 'lines', parent_row: '9' })] }, t.h, { resolve })
    expect(none.stopped).toBeUndefined()
    expect(t.state.values.orders).toBe(STORED)
  })

  it('designer checks and summaries; {{parent.*}} in conditions', () => {
    const known = { fieldKeys: new Set(['orders', 'b']), valueKeys: new Set(['orders']), fieldTypes: new Map([['orders', 'list'], ['sku_input', 'text'], ['b', 'button']]), pageIds: new Set<string>(), flags: new Set<string>(), listChildren: new Map([['orders', new Set(['lines'])]]) }
    const [rule] = normalizeFormRules([{ id: 'r1', event: 'button_click', target: 'b', then: [{ type: 'clear_list', list_field: 'orders', child: 'lines', parent_row: '2' }] }])
    expect(formRuleProblem(rule, known as any)).toBeNull()
    const [bad] = normalizeFormRules([{ id: 'r2', event: 'button_click', target: 'b', then: [{ type: 'clear_list', list_field: 'orders', child: 'items' }] }])
    expect(formRuleProblem(bad, known as any)).toMatch(/"items" is not a nested list of orders/)
    expect(describeRuleAction({ fields: FIELDS as any, layout: {} } as any, rule.then[0])).toBe('Clear Orders — in Lines of row 2')
    expect(ruleValue('parent.customer', { values: {}, event: { parent: { customer: 'Acme' } } })).toBe('Acme')
  })
})

/* ── Display ────────────────────────────────────────────────────────── */

describe('nested Lists on screen', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const field = FIELDS.find((f) => f.key === 'orders')!

  it('summaries read "3 rows (7 lines)" (tables, reports, the timeline)', () => {
    expect(formatFieldValue(field, STORED)).toBe('3 rows (7 lines)')
  })

  it('read-only rows: an expand button per row, the nested count per cell, the grand total under the list', () => {
    const html = wrap(createElement(ListValueView, { field, value: STORED }))
    expect(html).toContain('data-list-expand')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('3 lines')
    expect(html).toContain('data-list-nested-open="lines"')
    expect(html).toMatch(/data-list-grand-total="lines:sum:amount"[^>]*>\$2,744\.50/)
  })

  it('an editable table: the nested-list cell is a toggle button (aria-expanded), not an input', () => {
    const inline = normalizeTaskFields([{ key: 'orders', label: 'Orders', type: 'list', list: { ...ORDERS, entry_mode: 'inline' } }])[0]
    const html = wrap(createElement(ListField, { field: inline, value: STORED, onChange: () => {}, id: 'f-orders' }))
    expect(html).toContain('data-list-nested-toggle="lines"')
    expect(html).toContain('aria-controls="f-orders-r0-nested"')
    expect(html).not.toContain('data-list-input="lines"')
  })
})
