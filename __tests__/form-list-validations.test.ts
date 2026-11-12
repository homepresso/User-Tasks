/**
 * List validations (lib/forms/list-field.ts — InfoPath's validation on
 * repeating fields): a column's `validations` (an error on the cell) and a
 * config's `row_validations` (an error on the row, or on a column), judged
 * by the form rules' condition evaluator with row.* / parent.* / form.* /
 * user.*; enforced in the browser (listRowErrors with a context) and on the
 * server (checkListValue → path errors, mergeTaskFieldValues), nested Lists
 * included. Also: cards display renders a small form per row.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  LIST_ROW_ERROR_KEY, checkListValue, hasListValidations, listConfigProblem, listRowErrors, listValuePathErrors, normalizeListConfig,
} from '@/lib/forms/list-field'
import { mergeTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import { FormRenderer } from '@/components/forms/form-renderer'

const cond = (column: string, operator: string, value?: string) => ({ match: 'all', conditions: [{ column, operator, ...(value !== undefined ? { value } : {}) }] })

const LINES = normalizeListConfig({
  columns: [
    { key: 'item', label: 'Item', type: 'text', required: true },
    {
      key: 'qty', label: 'Qty', type: 'number',
      validations: [
        { if: cond('row.qty', 'gt', '{{form.stock}}'), message: 'Only {{form.stock}} in stock' },
        { if: cond('row.qty', 'lte', '0'), message: 'Qty must be positive' },
      ],
    },
    { key: 'price', label: 'Price', type: 'currency', currency: 'USD' },
    { key: 'amount', label: 'Amount', type: 'calculated', formula: 'qty * price', currency: 'USD' },
  ],
  row_validations: [
    { if: cond('row.amount', 'gt', '5000'), message: 'Lines over $5,000 need a quote', column: 'price' },
    { if: { match: 'all', conditions: [{ column: 'row.item', operator: 'eq', value: 'Gift card' }, { column: 'user.roles', operator: 'neq', value: 'Finance' }] }, message: 'Only Finance may order gift cards' },
  ],
})

describe('List validations: config', () => {
  it('normalises column validations and row checks (condition + message; unknown row column dropped)', () => {
    const qty = LINES.columns.find((c) => c.key === 'qty')!
    expect(qty.validations).toHaveLength(2)
    expect(qty.validations![0]).toEqual({ if: { match: 'all', conditions: [{ column: 'row.qty', operator: 'gt', value: '{{form.stock}}' }] }, message: 'Only {{form.stock}} in stock' })
    expect(LINES.row_validations![0].column).toBe('price')
    expect(LINES.row_validations![1].column).toBeUndefined()
    expect(hasListValidations(LINES)).toBe(true)
    const dropped = normalizeListConfig({ columns: [{ key: 'a', type: 'text', validations: [{ if: cond('row.a', 'is_set'), message: '' }, { message: 'no condition' }] }], row_validations: [{ if: cond('row.a', 'is_set'), message: 'x', column: 'nope' }] })
    expect(dropped.columns[0].validations).toBeUndefined()
    expect(dropped.row_validations).toEqual([{ if: cond('row.a', 'is_set'), message: 'x' }])
    expect(listConfigProblem(LINES)).toBeNull()
  })

  it('the designer problem names a validation reading an unknown column, or parent.* on a top-level List', () => {
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'a', type: 'text', validations: [{ if: cond('row.zzz', 'is_set'), message: 'x' }] }] }))).toMatch(/unknown column "zzz"/)
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'a', type: 'text' }], row_validations: [{ if: cond('parent.a', 'is_set'), message: 'x' }] }))).toMatch(/parent\.\* is for nested lists/)
  })
})

describe('List validations: the browser check (listRowErrors with a context)', () => {
  it('puts a column validation on its cell, a row check on its column or the row', () => {
    const ctx = { form: { stock: 3 }, user: { roles: ['Manager', 'manager', 'r-1'] } }
    expect(listRowErrors(LINES, { item: 'Laptop', qty: 5, price: 10 }, ctx)).toEqual({ qty: 'Only 3 in stock' })
    expect(listRowErrors(LINES, { item: 'Laptop', qty: 2, price: 3000 }, ctx)).toEqual({ price: 'Lines over $5,000 need a quote' })
    expect(listRowErrors(LINES, { item: 'Gift card', qty: 1, price: 50 }, ctx)).toEqual({ [LIST_ROW_ERROR_KEY]: 'Only Finance may order gift cards' })
    // Finance may: user.roles "does not equal" Finance is false for them.
    expect(listRowErrors(LINES, { item: 'Gift card', qty: 1, price: 50 }, { ...ctx, user: { roles: ['Finance'] } })).toEqual({})
    // Nobody signed in (null): no roles. The user not known here (undefined — the browser's own pre-check): left to the server.
    expect(listRowErrors(LINES, { item: 'Gift card', qty: 1, price: 50 }, { ...ctx, user: null })).toEqual({ [LIST_ROW_ERROR_KEY]: 'Only Finance may order gift cards' })
    expect(listRowErrors(LINES, { item: 'Gift card', qty: 1, price: 50 }, { form: { stock: 3 } })).toEqual({})
  })

  it("a cell's own error wins; without a context validations do not run", () => {
    expect(listRowErrors(LINES, { item: '', qty: 'abc' }, { form: { stock: 3 } })).toMatchObject({ item: 'Item is required', qty: 'Qty must be a number' })
    expect(listRowErrors(LINES, { item: 'Laptop', qty: 50, price: 10 })).toEqual({})
  })
})

describe('List validations: the server check (checkListValue / mergeTaskFieldValues)', () => {
  it('reports path errors per cell and per row', () => {
    const rows = [{ item: 'Laptop', qty: 1, price: 10 }, { item: 'Laptop', qty: 9, price: 10 }, { item: 'Gift card', qty: 1, price: 10 }]
    expect(listValuePathErrors('lines', LINES, rows, false, { form: { stock: 3 }, user: { roles: [] } })).toEqual({
      'lines[1].qty': 'Only 3 in stock',
      'lines[2]': 'Only Finance may order gift cards',
    })
    const check = checkListValue(LINES, rows, false, 1, { form: { stock: 3 }, user: { roles: [] } })
    expect(check.errors).toEqual(['row 2: Only 3 in stock', 'row 3: Only Finance may order gift cards'])
  })

  it('recurses into nested Lists with parent.* and form.*', () => {
    const ORDERS = normalizeListConfig({
      columns: [
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'limit', label: 'Limit', type: 'number' },
        {
          key: 'lines', label: 'Lines', type: 'list',
          list: {
            columns: [
              { key: 'sku', label: 'SKU', type: 'text' },
              { key: 'qty', label: 'Qty', type: 'number', validations: [{ if: cond('row.qty', 'gt', '{{parent.limit}}'), message: 'Over the limit of {{parent.limit}} for {{parent.customer}}' }] },
            ],
            row_validations: [{ if: cond('row.sku', 'eq', '{{form.blocked_sku}}'), message: 'SKU {{row.sku}} is blocked', column: 'sku' }],
          },
        },
      ],
    })
    expect(listConfigProblem(ORDERS)).toBeNull()
    const value = [
      { customer: 'Acme', limit: 5, lines: [{ sku: 'A-1', qty: 2 }, { sku: 'A-2', qty: 9 }] },
      { customer: 'Globex', limit: 10, lines: [{ sku: 'X-9', qty: 1 }] },
    ]
    expect(listValuePathErrors('orders', ORDERS, value, false, { form: { blocked_sku: 'X-9' } })).toEqual({
      'orders[0].lines[1].qty': 'Over the limit of 5 for Acme',
      'orders[1].lines[0].sku': 'SKU X-9 is blocked',
    })
  })

  it('mergeTaskFieldValues refuses a submission whose rows fail, judged with the form values and the server user', () => {
    const fields = normalizeTaskFields([
      { key: 'stock', label: 'Stock', type: 'number' },
      { key: 'lines', label: 'Lines', type: 'list', list: LINES },
    ])
    const sent = { stock: 3, lines: [{ item: 'Laptop', qty: 4, price: 10 }] }
    expect(mergeTaskFieldValues({ fields }, sent).errors.lines).toBe('Lines: row 1: Only 3 in stock')
    expect(mergeTaskFieldValues({ fields }, { ...sent, lines: [{ item: 'Laptop', qty: 2, price: 10 }] }).errors).toEqual({})
    // The role check uses the server's user (ruleUser), never anything the browser sent.
    const gift = { stock: 3, lines: [{ item: 'Gift card', qty: 1, price: 10 }], user: { roles: ['Finance'] } }
    expect(mergeTaskFieldValues({ fields }, gift, { ruleUser: { roles: ['Staff'] } }).errors.lines).toMatch(/Only Finance/)
    expect(mergeTaskFieldValues({ fields }, gift, { ruleUser: { roles: ['Finance'] } }).errors).toEqual({})
  })
})

describe('List display: cards', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const rows = [{ item: 'Laptop', qty: 2, price: 1250 }, { item: 'Mouse', qty: 1, price: 25 }]
  it('an editable table with display: cards renders one card per row with the columns as a small form', () => {
    const fields = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'list', list: { ...LINES, entry_mode: 'inline', display: 'cards' } }])
    const html = wrap(createElement(FormRenderer, { fields, values: { lines: rows }, onChange: () => {} }))
    expect(html).toContain('data-list-cards')
    expect(html).not.toContain('data-list-table')
    expect((html.match(/<li /g) ?? []).length).toBe(2)
    // Each card: a labelled input per column.
    expect(html).toMatch(/<label for="[^"]*-r0-item-m"[^>]*>Item/)
    expect(html).toMatch(/<label for="[^"]*-r1-qty-m"[^>]*>Qty/)
  })

  it('the list view with display: cards shows each row as a card of label / value pairs (read-only too)', () => {
    const fields = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'list', list: { ...LINES, display: 'cards' } }])
    const html = wrap(createElement(FormRenderer, { fields, values: { lines: rows }, readOnly: true }))
    expect(html).toContain('data-list-cards')
    expect(html).not.toContain('data-list-table')
    expect(html).toContain('<dt class="text-xs text-fg-muted">Item</dt>')
    expect(html).toContain('Laptop')
  })
})
