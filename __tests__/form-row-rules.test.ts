/**
 * Editable table rules (lib/forms/row-rules.ts): New row (defaults, the
 * current row and its variables), Set row values on every target, Commit
 * (stage; Save now through the host; the failure branch), Discard / Revert,
 * Delete (stage / now), Refresh, the events they fire, selection interplay,
 * pending rows at submit (block / exclude / commit), read-only columns
 * everywhere a row is edited (inline cells, Edit row inputs, rule actions,
 * the server's checks), the "New → fill → Save row" kit, the designer's
 * summaries and the Agent's checks.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  LIST_EDIT_KEY, LIST_SELECT_KEY, ROW_DRAFT_KEY, ROW_ERRORS_KEY, ROW_ORIGINAL_KEY, checkListValue, coerceListRows, keepReadOnlyListColumns, listColumnWritable, normalizeListConfig,
} from '@/lib/forms/list-field'
import { normalizeDataTableConfig, validateChangeSet } from '@/lib/forms/data-table'
import { ROW_ID_KEY } from '@/lib/forms/row-markers'
import {
  ROW_CURRENT_KEY, commitRow, currentRowRef, discardRow, newRow, resolveRowTargets, rowCommitKit, rowCurrentEntries, setRowValues, withCurrentRow,
} from '@/lib/forms/row-rules'
import { resolveInputTemplate } from '@/lib/forms/buttons'
import { CONTROLS_KEY } from '@/lib/forms/form-params'
import { mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { isServerRuleAction, normalizeFieldButtonAction, runFieldButton, type FieldButtonHost, type PromptRequest } from '@/lib/forms/field-buttons'
import { describeRuleAction, findServerRuleAction, formRuleProblem, listEditLockedInputs, normalizeFormRules } from '@/lib/forms/form-rules'
import { addRowCommitKit, designerStateFrom } from '@/lib/forms/designer-state'
import { ListField } from '@/components/forms/list-field'
import { formRulesProblems } from '@/lib/assistants/tools/build-plan'

const LIST = normalizeListConfig({
  columns: [
    { key: 'item', label: 'Item', type: 'text', required: true },
    { key: 'qty', label: 'Qty', type: 'number', default: '1', min: 1 },
    { key: 'code', label: 'Code', type: 'text', read_only: true, default: 'NEW' },
    { key: 'total', label: 'Total', type: 'calculated', formula: 'qty * 2' },
  ],
  selectable: 'multiple', key_column: 'item',
})
const TABLE = normalizeDataTableConfig({
  source: 'table', mode: 'edit', table_id: 'dddddddd-0000-4000-8000-000000000003', allow_add: true, allow_delete: true,
  columns: [
    { key: 'name', label: 'Name', type: 'text', required: true },
    { key: 'price', label: 'Price', type: 'number', min: 0 },
    { key: 'sku', label: 'SKU', type: 'text', read_only: true, default: 'SKU-{{form.prefix}}' },
    { key: 'owner', label: 'Owner', type: 'text', read_only: true },
  ],
})
const FIELDS = normalizeTaskFields([
  { key: 'prefix', label: 'Prefix', type: 'text' },
  { key: 'item_input', label: 'Item', type: 'text' },
  { key: 'code_input', label: 'Code', type: 'text' },
  { key: 'lines', label: 'Order lines', type: 'list', list: LIST },
  { key: 'products', label: 'Products', type: 'data_table', data_table: TABLE },
])
const ROWS = [{ item: 'A', qty: 1, code: 'C-A', total: 2 }, { item: 'B', qty: 2, code: 'C-B', total: 4 }]
const LOADED = [{ key: 'r1', values: { row_id: 'r1', name: 'Anvil', price: 30, sku: 'S-1', owner: 'ada' } }, { key: 'r2', values: { row_id: 'r2', name: 'Bolt', price: 50, sku: 'S-2', owner: 'bob' } }]

function host(initial: Record<string, unknown>, opts: { answer?: string; extra?: (action: any, event: any) => any } = {}) {
  const state = { values: { ...initial } as Record<string, unknown>, messages: [] as string[], asked: [] as PromptRequest[], calls: [] as any[], events: [] as Array<{ type: string; target: string; context: any }> }
  const byKey = new Map(FIELDS.map((f) => [f.key, f]))
  const h: FieldButtonHost = {
    values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
    goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
    message: (t) => { state.messages.push(t) }, editableKeys: new Set(FIELDS.map((f) => f.key)), blank: () => null, field: (k) => byKey.get(k) as any,
    ask: async (r) => { state.asked.push(r); return opts.answer ?? 'yes' },
    runExtra: async (_i, action, _v, _b, event) => { state.calls.push({ type: action.type, event }); return opts.extra?.(action, event) ?? {} },
    emit: (type, target, context) => { state.events.push({ type, target, context }) },
    tableRows: () => LOADED,
  }
  return { h, state }
}
const act = (raw: Record<string, unknown>) => normalizeFieldButtonAction(raw, { rule: true })!
const resolveWithForm = (template: string, values: Record<string, unknown>, extras: Record<string, unknown>) => resolveInputTemplate(template, { values, extras })

describe('New row', () => {
  it('a List: a pending row with the defaults (rule values over them), current, selected, the current-row variables', async () => {
    const t = host({ lines: ROWS, prefix: 'X' })
    await runFieldButton({ actions: [act({ type: 'new_row', field: 'lines', values: { item: 'Widget {{prefix}}' } })] }, t.h)
    const rows = t.state.values.lines as any[]
    expect(rows).toHaveLength(3)
    expect(rows[2]).toMatchObject({ item: 'Widget X', qty: 1, code: 'NEW', total: 2, [ROW_DRAFT_KEY]: 'new' })
    expect(currentRowRef(t.state.values, 'lines')).toEqual({ index: 2 })
    expect(t.state.values[LIST_SELECT_KEY]).toEqual({ lines: [2] })
    expect(rowCurrentEntries(FIELDS, t.state.values)).toMatchObject({ lines_current_row: { item: 'Widget X', qty: 1, code: 'NEW', total: 2 }, lines_current_index: 3, lines_current_key: 'Widget X', lines_current_pending: true, lines_pending_count: 1 })
    expect(t.state.events).toEqual([{ type: 'row_created', target: 'lines', context: expect.objectContaining({ field: 'lines', row_number: 3, row: expect.objectContaining({ item: 'Widget X' }) }) }])
  })

  it('at the top / after the selected row: the current row and the editing marker move with their rows; full lists refuse', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0] }, [LIST_EDIT_KEY]: { lines: 1 }, [ROW_CURRENT_KEY]: { lines: { index: 1 } } })
    const made = newRow(FIELDS[3] as any, t.state.values, { item: 'Z' }, 'after_selected')
    expect('value' in made && (made.value as any[]).map((r) => r.item)).toEqual(['A', 'Z', 'B'])
    expect('extra' in made && made.extra).toEqual({ [ROW_CURRENT_KEY]: { lines: { index: 2 } }, [LIST_EDIT_KEY]: { lines: 2 } })
    const full = { ...FIELDS[3], list: { ...LIST, max_rows: 2 } }
    expect(newRow(full as any, { lines: ROWS }, {})).toEqual({ error: 'Order lines is full (at most 2 rows)' })
  })

  it('a Data table: an uncommitted added row with the column defaults (templates resolved), read-only columns with a default included', async () => {
    const t = host({ prefix: 'P' })
    await runFieldButton({ actions: [act({ type: 'new_row', field: 'products', focus_column: 'price' })] }, t.h, { resolve: resolveWithForm })
    const cs = t.state.values.products as any
    expect(cs.added).toHaveLength(1)
    expect(cs.added[0]).toMatchObject({ name: null, price: null, sku: 'SKU-P', [ROW_DRAFT_KEY]: 'new' })
    expect(cs.added[0]).not.toHaveProperty('owner')
    const ref = (t.state.values[ROW_CURRENT_KEY] as any).products
    expect(ref).toEqual({ rid: cs.added[0][ROW_ID_KEY], focus: 'price' })
    expect(rowCurrentEntries(FIELDS, t.state.values)).toMatchObject({ products_current_index: 1, products_current_pending: true, products_pending_count: 1 })
    const noAdd = { ...FIELDS[4], data_table: { ...TABLE, allow_add: false } }
    expect(newRow(noAdd as any, {}, {})).toEqual({ error: 'Products does not allow new rows' })
  })
})

describe('Set row values', () => {
  it('on the current, selected, numbered, event and keyed rows of a List; the row turns Edited (its last commit kept for Revert)', async () => {
    const base = { lines: ROWS, [ROW_CURRENT_KEY]: { lines: { index: 0 } }, [LIST_SELECT_KEY]: { lines: [1] } }
    const field = FIELDS[3] as any
    expect(resolveRowTargets(field, base, { spec: 'current' })).toEqual([{ kind: 'list', index: 0 }])
    expect(resolveRowTargets(field, base, { spec: 'selected' })).toEqual([{ kind: 'list', index: 1 }])
    expect(resolveRowTargets(field, base, { spec: '2' })).toEqual([{ kind: 'list', index: 1 }])
    expect(resolveRowTargets(field, base, { spec: 'current', key: 'B' })).toEqual([{ kind: 'list', index: 1 }])
    expect(resolveRowTargets(field, base, { spec: '9' })).toEqual([])

    const t = host(base)
    await runFieldButton({ actions: [act({ type: 'set_row_values', field: 'lines', row: '{{event.row_number}}', values: { qty: '{{=1+2}}', item: '{{row.item}}!' } })] }, t.h, {
      extras: { event: { row_number: 2 } },
      resolve: async (tpl, values, extras) => (tpl === '{{=1+2}}' ? 3 : resolveWithForm(tpl, values, extras)),
    })
    const row = (t.state.values.lines as any[])[1]
    expect(row).toMatchObject({ item: 'B!', qty: 3, total: 6, [ROW_DRAFT_KEY]: 'edited', [ROW_ORIGINAL_KEY]: ROWS[1] })
    expect(t.state.events[0]).toMatchObject({ type: 'row_values_changed', target: 'lines', context: { row_number: 2, columns: ['qty', 'item'] } })
  })

  it('a Data table: an existing row gets a draft updated entry (before / after / changed fields); a new row is updated in place; a bad value stops the rule', async () => {
    const t = host({ [ROW_CURRENT_KEY]: { products: { key: 'r2', row: LOADED[1].values } } })
    await runFieldButton({ actions: [act({ type: 'set_row_values', field: 'products', values: { price: '55' } })] }, t.h)
    expect((t.state.values.products as any).updated).toEqual([{ key: 'r2', before: LOADED[1].values, after: { price: 55 }, changed_fields: ['price'], draft: true }])
    // By number: new rows first, then the page's rows; by key.
    const field = FIELDS[4] as any
    expect(resolveRowTargets(field, {}, { spec: '1', loaded: LOADED })).toEqual([{ kind: 'existing', key: 'r1', row: LOADED[0].values }])
    expect(resolveRowTargets(field, {}, { spec: 'current', key: 'r2', loaded: LOADED })).toEqual([{ kind: 'existing', key: 'r2', row: LOADED[1].values }])
    // "selected" in an editable table: the row last clicked.
    expect(resolveRowTargets(field, { [CONTROLS_KEY]: { products: { last_clicked_row_id: 'r1' } } }, { spec: 'selected', loaded: LOADED })).toHaveLength(1)

    const bad = host({ [ROW_CURRENT_KEY]: { products: { key: 'r1' } } })
    const res = await runFieldButton({ actions: [act({ type: 'set_row_values', field: 'products', values: { price: 'lots' } }), act({ type: 'message', text: 'after' })] }, bad.h)
    expect(res.stopped).toBe('row_invalid')
    expect(bad.state.messages).toEqual(['Products: Price must be a number'])
  })

  it('no current row: nothing happens (a dev note), the rule goes on; selected with nothing selected: the message and the rule stops', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const t = host({ lines: ROWS })
    const res = await runFieldButton({ actions: [act({ type: 'set_row_values', field: 'lines', values: { qty: '2' } }), act({ type: 'message', text: 'went on' })] }, t.h)
    expect(res.stopped).toBeUndefined()
    expect(t.state.messages).toEqual(['went on'])
    expect(info.mock.calls[0][0]).toMatch(/found no row/)
    const s = host({ lines: ROWS })
    const stopped = await runFieldButton({ actions: [act({ type: 'set_row_values', field: 'lines', row: 'selected', values: { qty: '2' }, empty_text: 'Pick a line' })] }, s.h)
    expect(stopped.stopped).toBe('selection_empty')
    expect(s.state.messages).toEqual(['Pick a line'])
    info.mockRestore()
  })
})

describe('Commit row', () => {
  it('stage: the checks pass → the row is no longer pending (row_committed), the on-success steps read {{result.row}}', async () => {
    const pending = [...ROWS, { item: 'C', qty: 3, code: 'NEW', total: 6, [ROW_DRAFT_KEY]: 'new' }]
    const t = host({ lines: pending, [ROW_CURRENT_KEY]: { lines: { index: 2 } } })
    await runFieldButton({ actions: [act({ type: 'commit_row', field: 'lines', on_success: [{ type: 'message', text: 'Committed {{result.row.item}}' }] })] }, t.h)
    expect((t.state.values.lines as any[])[2]).toEqual({ item: 'C', qty: 3, code: 'NEW', total: 6 })
    expect(t.state.events.map((e) => e.type)).toEqual(['row_committed'])
    expect(t.state.messages).toEqual(['Committed C'])
  })

  it('a failing row: its cells carry the messages, row_commit_failed fires, the If-it-fails steps run ({{error.errors.<column>}}) and the rule stops', async () => {
    const t = host({ lines: [{ item: '', qty: 0, code: 'NEW', [ROW_DRAFT_KEY]: 'new' }], [ROW_CURRENT_KEY]: { lines: { index: 0 } } })
    const res = await runFieldButton({ actions: [
      act({ type: 'commit_row', field: 'lines', on_failure: [{ type: 'message', text: 'Fix: {{error.errors.item}} / {{error.message}}' }] }),
      act({ type: 'message', text: 'never' }),
    ] }, t.h)
    expect(res.stopped).toBe('commit_row_failed')
    const row = (t.state.values.lines as any[])[0]
    expect(row[ROW_ERRORS_KEY]).toEqual({ item: 'Item is required', qty: 'Qty must be at least 1' })
    expect(row[ROW_DRAFT_KEY]).toBe('new')
    expect(t.state.events[0]).toMatchObject({ type: 'row_commit_failed', context: { error: 'Item is required' } })
    expect(t.state.messages).toEqual(['Fix: Item is required / Order lines row 1: Item is required'])
    // Without If-it-fails steps: the message.
    const u = host({ lines: [{ item: '', [ROW_DRAFT_KEY]: 'new' }], [ROW_CURRENT_KEY]: { lines: { index: 0 } } })
    await runFieldButton({ actions: [act({ type: 'commit_row', field: 'lines' })] }, u.h)
    expect(u.state.messages).toEqual(['Order lines row 1: Item is required'])
  })

  it('all pending rows at once (one failure reported for all)', async () => {
    const t = host({ lines: [{ item: 'A', qty: 1, [ROW_DRAFT_KEY]: 'new' }, { item: 'B', qty: 1 }, { item: 'C', qty: 2, [ROW_DRAFT_KEY]: 'edited', [ROW_ORIGINAL_KEY]: { item: 'C', qty: 1 } }] })
    await runFieldButton({ actions: [act({ type: 'commit_row', field: 'lines', row: 'all_pending' })] }, t.h)
    expect((t.state.values.lines as any[]).every((r) => !r[ROW_DRAFT_KEY])).toBe(true)
    expect(t.state.events.map((e) => e.context.row_number)).toEqual([1, 3])
  })

  it('a Data table, stage: the added row stays in the changes, ready (no draft marker); an existing row\'s entry loses its draft flag', () => {
    const values = { products: { added: [{ name: 'Nut', price: 2, sku: 'SKU', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n1' }], updated: [{ key: 'r1', before: LOADED[0].values, after: { price: 31 }, changed_fields: ['price'], draft: true }], deleted: [] } }
    const field = FIELDS[4] as any
    const a = commitRow(field, values, { kind: 'added', rid: 'n1', index: 0 })
    expect(a.ok && (a.value as any).added[0]).toEqual({ name: 'Nut', price: 2, sku: 'SKU', [ROW_ID_KEY]: 'n1' })
    const b = commitRow(field, values, { kind: 'existing', key: 'r1', row: LOADED[0].values })
    expect(b.ok && (b.value as any).updated[0]).toEqual({ key: 'r1', before: LOADED[0].values, after: { price: 31 }, changed_fields: ['price'] })
    // The checks: required, types.
    const bad = commitRow(field, { products: { added: [{ name: '', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n2' }], updated: [], deleted: [] } }, { kind: 'added', rid: 'n2', index: 0 })
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.errors).toEqual({ name: 'Name is required' })
  })

  it('a Data table, save now: the host writes it (the saved step by index, the row in event.commit), the row leaves the changes, the table refreshes, {{result.id}} and the current row is the stored row', async () => {
    const values = { products: { added: [{ name: 'Nut', price: 2, sku: 'SKU', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n1' }], updated: [], deleted: [] }, [ROW_CURRENT_KEY]: { products: { rid: 'n1' } } }
    const t = host(values, { extra: (a) => (a.type === 'commit_row' ? { result: { id: 'row-9', row: { name: 'Nut', price: 2, sku: 'SKU', row_id: 'row-9' } } } : {}) })
    await runFieldButton({ actions: [act({ type: 'commit_row', field: 'products', commit_mode: 'save_now', on_success: [{ type: 'message', text: 'Saved {{result.id}}' }] })] }, t.h)
    expect(t.state.calls[0]).toMatchObject({ type: 'commit_row', event: { commit: { added: { name: 'Nut', price: 2, sku: 'SKU' } } } })
    expect(t.state.calls[1].type).toBe('refresh_table')
    expect(t.state.values.products).toBeNull()
    expect(currentRowRef(t.state.values, 'products')).toEqual({ key: 'row-9', row: { name: 'Nut', price: 2, sku: 'SKU', row_id: 'row-9' } })
    expect(t.state.messages).toEqual(['Saved row-9'])
    expect(t.state.events[0]).toMatchObject({ type: 'row_committed', context: { saved: true, key: 'row-9' } })
  })

  it('save now failing (the server refuses): the row stays pending and the failure branch runs', async () => {
    const values = { products: { added: [{ name: 'Nut', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n1' }], updated: [], deleted: [] }, [ROW_CURRENT_KEY]: { products: { rid: 'n1' } } }
    const t = host(values, { extra: () => { throw new Error('Forbidden: data.manage_rows') } })
    const res = await runFieldButton({ actions: [act({ type: 'commit_row', field: 'products', commit_mode: 'save_now', on_failure: [{ type: 'message', text: 'No: {{error.message}}' }] })] }, t.h)
    expect(res.stopped).toBe('commit_row_failed')
    expect(t.state.messages).toEqual(['No: Forbidden: data.manage_rows'])
    expect((t.state.values.products as any).added).toHaveLength(1)
  })

  it('is a server step only in Save now mode (the saved form decides)', () => {
    expect(isServerRuleAction(act({ type: 'commit_row', field: 'products' }))).toBe(false)
    expect(isServerRuleAction(act({ type: 'commit_row', field: 'products', commit_mode: 'save_now' }))).toBe(true)
    const layout = { rules: normalizeFormRules([{ id: 'r1', event: 'button_click', target: 'b', then: [{ type: 'commit_row', field: 'products' }, { type: 'delete_row', field: 'products', commit_mode: 'save_now' }] }]) }
    expect(findServerRuleAction(layout, 'r1', 0)).toBeNull()
    expect(findServerRuleAction(layout, 'r1', 1)?.action.type).toBe('delete_row')
  })
})

describe('Discard / Revert / Delete / Refresh', () => {
  it('discard drops a new row and puts an edited one back; revert puts an edited one back and a new one back to its defaults', () => {
    const field = FIELDS[3] as any
    const values = { lines: [{ item: 'A', qty: 5, [ROW_DRAFT_KEY]: 'edited', [ROW_ORIGINAL_KEY]: { item: 'A', qty: 1 } }, { item: 'N', qty: 9, [ROW_DRAFT_KEY]: 'new' }], [ROW_CURRENT_KEY]: { lines: { index: 1 } } }
    expect(discardRow(field, values, { kind: 'list', index: 0 }, 'discard').value).toEqual([{ item: 'A', qty: 1 }, values.lines[1]])
    const gone = discardRow(field, values, { kind: 'list', index: 1 }, 'discard')
    expect(gone.value).toEqual([values.lines[0]])
    expect(gone.extra).toEqual({ [ROW_CURRENT_KEY]: {} })
    const reverted = discardRow(field, values, { kind: 'list', index: 1 }, 'revert', { qty: '1', code: 'NEW' })
    expect((reverted.value as any[])[1]).toMatchObject({ item: null, qty: 1, code: 'NEW', [ROW_DRAFT_KEY]: 'new' })
    // A Data table: the edit entry goes; a new row goes.
    const table = FIELDS[4] as any
    const cs = { products: { added: [{ name: 'X', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n1' }], updated: [{ key: 'r1', before: {}, after: { price: 1 }, changed_fields: ['price'], draft: true }], deleted: [] } }
    expect(discardRow(table, cs, { kind: 'existing', key: 'r1', row: {} }, 'discard').value).toEqual({ ...cs.products, updated: [] })
    expect(discardRow(table, cs, { kind: 'added', rid: 'n1', index: 0 }, 'discard').value).toEqual({ ...cs.products, added: [] })
  })

  it('runs through rules (highest List rows first)', async () => {
    const t = host({ lines: [{ item: 'A', [ROW_DRAFT_KEY]: 'new' }, { item: 'B' }, { item: 'C', [ROW_DRAFT_KEY]: 'new' }] })
    await runFieldButton({ actions: [act({ type: 'discard_row', field: 'lines', row: 'all_pending' })] }, t.h)
    expect(t.state.values.lines).toEqual([{ item: 'B' }])
  })

  it('delete: a List\'s selected rows go (asking first, the selection clears); a Data table stages the delete, or deletes now through the host', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0] } })
    await runFieldButton({ actions: [act({ type: 'delete_row', field: 'lines', confirm_text: 'Delete {{count}} line(s)?' })] }, t.h)
    expect(t.state.asked[0].text).toBe('Delete 1 line(s)?')
    expect(t.state.values.lines).toEqual([ROWS[1]])
    expect(t.state.values[LIST_SELECT_KEY]).toEqual({})

    const c = host({ [ROW_CURRENT_KEY]: { products: { key: 'r1', row: LOADED[0].values } } })
    await runFieldButton({ actions: [act({ type: 'delete_row', field: 'products', row: 'current' })] }, c.h)
    expect((c.state.values.products as any).deleted).toEqual([{ key: 'r1', before: LOADED[0].values }])
    expect(currentRowRef(c.state.values, 'products')).toBeNull()

    const n = host({ [ROW_CURRENT_KEY]: { products: { key: 'r2', row: LOADED[1].values } } })
    await runFieldButton({ actions: [act({ type: 'delete_row', field: 'products', row: 'current', commit_mode: 'save_now', on_success: [{ type: 'message', text: 'Deleted {{result.count}}' }] })] }, n.h)
    expect(n.state.calls.map((x) => x.type)).toEqual(['delete_row', 'refresh_table'])
    expect(n.state.calls[0].event.commit).toEqual({ deleted: { key: 'r2' } })
    expect(n.state.messages).toEqual(['Deleted 1'])
    // No: nothing is deleted.
    const no = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0] } }, { answer: 'no' })
    expect((await runFieldButton({ actions: [act({ type: 'delete_row', field: 'lines', confirm_text: 'Sure?' })] }, no.h)).stopped).toBe('prompt_stopped')
    expect(no.state.values.lines).toEqual(ROWS)
  })

  it('refresh: the table re-reads (pending rows kept); asked first, Yes drops them', async () => {
    const pendingSet = { added: [{ name: 'X', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n1' }], updated: [], deleted: [] }
    const keep = host({ products: pendingSet })
    await runFieldButton({ actions: [act({ type: 'refresh_table', field: 'products' })] }, keep.h)
    expect(keep.state.calls.map((x) => x.type)).toEqual(['refresh_table'])
    expect(keep.state.values.products).toEqual(pendingSet)
    const ask = host({ products: pendingSet })
    await runFieldButton({ actions: [act({ type: 'refresh_table', field: 'products', keep_pending: 'ask' })] }, ask.h)
    expect(ask.state.asked[0].text).toMatch(/Drop the pending row of Products/)
    expect(ask.state.values.products).toBeNull()
  })
})

describe('pending rows at submit', () => {
  const pending = [{ item: 'A', qty: 1 }, { item: 'B', qty: 3, [ROW_DRAFT_KEY]: 'edited', [ROW_ORIGINAL_KEY]: { item: 'B', qty: 2 } }, { item: 'N', qty: 1, [ROW_DRAFT_KEY]: 'new' }]
  it('block (default): the submission stops until they are committed or discarded', () => {
    expect(checkListValue(LIST, pending).errors).toContain('commit or discard the 2 pending rows first')
    expect(validateTaskFieldValues(FIELDS, { lines: pending }).lines).toMatch(/commit or discard the 2 pending rows first/)
  })
  it('exclude: new rows dropped, edited rows back to their last commit; commit: taken as they are (markers never stored)', () => {
    const exclude = { ...LIST, on_submit_pending: 'exclude' as const }
    expect(checkListValue(exclude, pending).errors).toEqual([])
    expect(coerceListRows(exclude, pending).map((r) => [r.item, r.qty])).toEqual([['A', 1], ['B', 2]])
    const commit = { ...LIST, on_submit_pending: 'commit' as const }
    expect(coerceListRows(commit, pending).map((r) => [r.item, r.qty])).toEqual([['A', 1], ['B', 3], ['N', 1]])
    expect(Object.keys(coerceListRows(commit, pending)[2])).not.toContain(ROW_DRAFT_KEY)
  })
  it('a Data table\'s changes the same way (block / exclude / commit)', () => {
    const cs = { added: [{ name: 'N', [ROW_DRAFT_KEY]: 'new' }, { name: 'Ready' }], updated: [{ key: 'r1', before: { name: 'Anvil' }, after: { name: 'Anvil 2' }, changed_fields: ['name'], draft: true }], deleted: [] }
    expect(validateChangeSet(TABLE, cs).errors).toContain('Commit or discard the 2 pending rows first')
    const ex = validateChangeSet({ ...TABLE, on_submit_pending: 'exclude' }, cs)
    expect(ex.errors).toEqual([])
    expect(ex.changes.added).toEqual([{ name: 'Ready' }])
    expect(ex.changes.updated).toEqual([])
    const all = validateChangeSet({ ...TABLE, on_submit_pending: 'commit' }, cs)
    expect(all.changes.added.map((r) => r.name)).toEqual(['N', 'Ready'])
    expect(all.changes.updated).toHaveLength(1)
  })
})

describe('read-only columns ("Read-only when editing")', () => {
  it('a List: writable on a new row before its first commit only; calculated never', () => {
    expect(listColumnWritable(LIST, 'code', { item: 'A' })).toBe(false)
    expect(listColumnWritable(LIST, 'code', { item: 'A', [ROW_DRAFT_KEY]: 'new' })).toBe(true)
    expect(listColumnWritable(LIST, 'code', { item: 'A', [ROW_DRAFT_KEY]: 'edited' })).toBe(false)
    expect(listColumnWritable(LIST, 'qty', { item: 'A' })).toBe(true)
    expect(listColumnWritable(LIST, 'total', null)).toBe(false)
  })

  it('inline cells: a read-only cell of an existing row shows its value (aria-readonly, no input); a new row\'s is an input', () => {
    const field = { ...FIELDS[3], list: { ...LIST, inline_edit: true, selectable: undefined } } as any
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ListField, {
      field, id: 'f-lines', onChange: () => {}, value: [{ item: 'A', qty: 1, code: 'C-A' }, { item: 'N', qty: 1, code: 'NEW', [ROW_DRAFT_KEY]: 'new' }],
    })))
    expect(html).toContain('data-list-readonly="code"')
    expect(html.match(/data-list-readonly="code"/g)).toHaveLength(1)
    expect(html).toMatch(/aria-readonly="true"[^>]*>C-A</)
    expect(html).toContain('id="f-lines-r1-code"')
    expect(html).toContain('data-row-badge="new"')
  })

  it('rule actions: Set row values and Update a row leave it alone on existing rows (a dev note); a New row\'s may be set', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const field = FIELDS[3] as any
    const done = setRowValues(field, { lines: ROWS }, { kind: 'list', index: 0 }, { code: 'HACK', qty: 4 })
    expect(done.ignored).toEqual(['code'])
    expect((done.value as any[])[0]).toMatchObject({ code: 'C-A', qty: 4 })
    const fresh = setRowValues(field, { lines: [{ item: 'N', code: 'NEW', [ROW_DRAFT_KEY]: 'new' }] }, { kind: 'list', index: 0 }, { code: 'SET' })
    expect((fresh.value as any[])[0]).toMatchObject({ code: 'SET', [ROW_DRAFT_KEY]: 'new' })
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0, 1] } })
    await runFieldButton({ actions: [act({ type: 'update_list_row', list_field: 'lines', row: 'selected', values: { code: 'X', qty: '7' } })] }, t.h)
    expect((t.state.values.lines as any[]).map((r) => [r.code, r.qty])).toEqual([['C-A', 7], ['C-B', 7]])
    expect(info.mock.calls.some((c) => /read-only column\(s\) code/.test(String(c[0])))).toBe(true)
    // A Data table: the read-only (and key) columns of an existing row are ignored; a new row takes a read-only column with a default.
    const table = FIELDS[4] as any
    const existing = setRowValues(table, {}, { kind: 'existing', key: 'r1', row: LOADED[0].values }, { owner: 'eve', sku: 'X', price: 1 })
    expect(existing.ignored).toEqual(['owner', 'sku'])
    expect((existing.value as any).updated[0].after).toEqual({ price: 1 })
    const added = setRowValues(table, { products: { added: [{ name: 'N', [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: 'n1' }], updated: [], deleted: [] } }, { kind: 'added', rid: 'n1', index: 0 }, { sku: 'S-9', owner: 'eve' })
    expect((added.value as any).added[0].sku).toBe('S-9')
    expect(added.ignored).toEqual(['owner'])
    info.mockRestore()
  })

  it('Edit row: the input mapped to a read-only column is locked while that row is edited; Add keeps the row\'s value', async () => {
    const rules = normalizeFormRules([
      { id: 'r_add', event: 'button_click', target: 'add', then: [{ type: 'add_list_row', list_field: 'lines', values: { item: '{{item_input}}', code: '{{code_input}}' } }] },
      { id: 'r_edit', event: 'list_row_button', target: 'lines', then: [{ type: 'edit_list_row', list_field: 'lines', row: '{{event.row_number}}', assign: { item_input: '{{row.item}}', code_input: '{{row.code}}' } }] },
    ])
    expect(listEditLockedInputs(rules, FIELDS, { lines: ROWS })).toEqual([])
    expect(listEditLockedInputs(rules, FIELDS, { lines: ROWS, [LIST_EDIT_KEY]: { lines: 0 } })).toEqual(['code_input'])
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const t = host({ lines: ROWS, [LIST_EDIT_KEY]: { lines: 0 }, item_input: 'A2', code_input: 'TAMPERED' })
    await runFieldButton({ actions: [rules[0].then[0]] }, t.h)
    expect((t.state.values.lines as any[])[0]).toMatchObject({ item: 'A2', code: 'C-A' })
    // A new row (not editing): the column takes the input.
    const n = host({ lines: ROWS, item_input: 'Z', code_input: 'Z-1' })
    await runFieldButton({ actions: [rules[0].then[0]] }, n.h)
    expect((n.state.values.lines as any[])[2]).toMatchObject({ item: 'Z', code: 'Z-1' })
    info.mockRestore()
  })

  it('server: a Data table change to a read-only column is dropped with a warning, refused when changed_fields names it; a new row keeps it only with a default', () => {
    const quiet = validateChangeSet(TABLE, { updated: [{ key: 'r1', before: { owner: 'ada', price: 1 }, after: { owner: 'eve', price: 2 }, changed_fields: ['price'] }] })
    expect(quiet.errors).toEqual([])
    expect(quiet.warnings).toEqual(['Row r1: a change to read-only column "owner" was ignored'])
    expect(quiet.changes.updated[0].after).toEqual({ price: 2 })
    const tamper = validateChangeSet(TABLE, { updated: [{ key: 'r1', before: { owner: 'ada' }, after: { owner: 'eve' }, changed_fields: ['owner'] }] })
    expect(tamper.errors).toEqual(['Row r1: Owner is read-only'])
    const added = validateChangeSet(TABLE, { added: [{ name: 'N', sku: 'S-1', owner: 'eve' }] })
    expect(added.changes.added).toEqual([{ name: 'N', sku: 'S-1' }])
    expect(added.warnings).toEqual(['New row 1: read-only column "owner" was ignored'])
  })

  it('server: List rows matched by the key column keep their stored read-only values (logged); new rows keep theirs', () => {
    const kept = keepReadOnlyListColumns(LIST, [{ item: 'A', qty: 2, code: 'HACK' }, { item: 'Z', qty: 1, code: 'Z-1' }], ROWS)
    expect(kept.restored).toEqual(['code'])
    expect(kept.rows).toEqual([{ item: 'A', qty: 2, code: 'C-A' }, { item: 'Z', qty: 1, code: 'Z-1' }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const merged = mergeTaskFieldValues({ fields: FIELDS, template_values: { lines: ROWS } }, { lines: [{ item: 'A', qty: 2, code: 'HACK' }, { item: 'B', qty: 2, code: 'C-B' }] })
    expect((merged.templateValues.lines as any[]).map((r) => r.code)).toEqual(['C-A', 'C-B'])
    expect(warn.mock.calls[0][0]).toMatch(/read-only column\(s\) code kept their stored values/)
    warn.mockRestore()
  })
})

describe('selection and events', () => {
  it('a commit through the List\'s ✓ (row_commit_controls) and pending badges render; withCurrentRow clears', () => {
    const field = { ...FIELDS[3], list: { ...LIST, row_commit_controls: true } } as any
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ListField, {
      field, id: 'f-lines', onChange: () => {}, value: [ROWS[0], { item: 'B', qty: 2, [ROW_DRAFT_KEY]: 'edited', [ROW_ERRORS_KEY]: { qty: 'Qty is wrong' } }], current: 1,
    })))
    expect(html).toContain('data-row-commit-controls')
    expect(html).toContain('aria-label="Commit row 2"')
    expect(html).toContain('data-row-badge="edited"')
    expect(html).toContain('data-list-cell-error="qty"')
    expect(html).toMatch(/data-current="true"/)
    expect(withCurrentRow({ [ROW_CURRENT_KEY]: { lines: { index: 1 } } }, 'lines', null)).toEqual({})
  })
})

describe('designer, kit and Agent', () => {
  it('summaries read like sentences and warn about read-only columns', () => {
    const def = { fields: FIELDS as any, layout: {} }
    expect(describeRuleAction(def, act({ type: 'new_row', field: 'lines' }))).toBe('Create a new row in Order lines')
    expect(describeRuleAction(def, act({ type: 'commit_row', field: 'products', commit_mode: 'save_now' }))).toBe('Commit the current row to Products (save now)')
    expect(describeRuleAction(def, act({ type: 'set_row_values', field: 'lines', values: { code: 'X' } }))).toMatch(/Code is read-only: ignored on existing rows/)
    expect(describeRuleAction(def, act({ type: 'delete_row', field: 'lines', confirm_text: 'Sure?' }))).toBe('Delete the selected rows of Order lines (asks first)')
  })

  it('problems: a List or editable Data table; Save now only on a Data table; values to set', () => {
    const known = { fieldKeys: new Set(['lines', 'products', 'prefix', 'b']), valueKeys: new Set(['lines', 'products', 'prefix']), fieldTypes: new Map([['lines', 'list'], ['products', 'data_table'], ['prefix', 'text'], ['b', 'button']]), pageIds: new Set<string>(), flags: new Set<string>() }
    const rule = (a: Record<string, unknown>) => normalizeFormRules([{ id: 'r', event: 'button_click', target: 'b', then: [a] }])[0]
    expect(formRuleProblem(rule({ type: 'new_row', field: 'prefix' }), known as any)).toMatch(/choose the List or editable Data table/)
    expect(formRuleProblem(rule({ type: 'commit_row', field: 'lines', commit_mode: 'save_now' }), known as any)).toMatch(/Save now" is for a Data table/)
    expect(formRuleProblem(rule({ type: 'set_row_values', field: 'lines' }), known as any)).toMatch(/set at least one column/)
    expect(formRuleProblem(normalizeFormRules([{ id: 'r', event: 'row_committed', target: 'prefix', then: [{ type: 'message', text: 'x' }] }])[0], known as any)).toMatch(/not a List or Data table/)
    expect(formRuleProblem(normalizeFormRules([{ id: 'r', event: 'cell_change', target: 'products', then: [{ type: 'message', text: 'x' }] }])[0], known as any)).toBeNull()
  })

  it('the kit: inputs for the columns people fill (read-only left out), New row / Save row buttons, fill-on-change rules guarded by the pending current row, commit clearing the inputs', () => {
    const kit = rowCommitKit(FIELDS[4] as any, ['products'], { save: 'save_now' })
    expect(kit.fields.map((f) => f.key)).toEqual(['products_name', 'products_price', 'products_new_row', 'products_save_row'])
    expect(kit.rules.map((r) => r.event)).toEqual(['button_click', 'value_change', 'value_change', 'button_click'])
    expect(kit.rules[1]).toMatchObject({ if: { conditions: [{ column: 'products_current_pending', value: 'true' }] }, then: [{ type: 'set_row_values', field: 'products', values: { name: '{{products_name}}' } }] })
    expect(kit.rules[3].then).toEqual([{ type: 'commit_row', field: 'products', row: 'current', commit_mode: 'save_now', on_success: [{ type: 'clear_values', fields: ['products_name', 'products_price'] }] }])
    const list = rowCommitKit(FIELDS[3] as any, ['lines'], { apply: 'button' })
    expect(list.fields.map((f) => f.key)).toEqual(['lines_item', 'lines_qty', 'lines_new_row', 'lines_apply', 'lines_save_row'])
    expect(list.rules.map((r) => (r.then as any[])[0].type)).toEqual(['new_row', 'set_row_values', 'set_row_values'])
    // In the designer: fields placed above the table, rules valid.
    const state = designerStateFrom({ fields: FIELDS, layout: { rows: FIELDS.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] })) } } as any)
    const target = state.fields.find((f) => f.key === 'products')!
    const added = addRowCommitKit(state, target._id, {})!
    expect(added.state.layout.rules).toHaveLength(4)
    const at = added.state.layout.rows.findIndex((r) => r.cells.some((c) => c.field_key === 'products'))
    expect(added.state.layout.rows[at - 1].cells.map((c) => c.field_key)).toEqual(['products_new_row', 'products_save_row'])
  })

  it('the Agent\'s plan check: unknown columns and read-only columns in Set row values / Update a row', () => {
    const fields = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'list', list: LIST }])
    const out = formRulesProblems(fields, { rules: [
      { id: 'r1', event: 'button_click', target: 'b', then: [{ type: 'new_row', field: 'lines', values: { nope: '1' } }] },
      { id: 'r2', event: 'button_click', target: 'b', then: [{ type: 'set_row_values', field: 'lines', values: { code: 'X' } }] },
    ] } as any)
    expect(out.join('\n')).toMatch(/has no column "nope"/)
    expect(out.join('\n')).toMatch(/code is read-only when editing/)
    expect(out.join('\n')).not.toMatch(/nothing adds rows/)
  })
})
