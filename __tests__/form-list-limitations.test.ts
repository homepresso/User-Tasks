/**
 * The List field's second round (lib/forms/list-field.ts and friends):
 * lookup columns (value + label, cascades inside the row), Add row resetting
 * the inputs to their defaults, editing rows already in the list (Edit loads
 * the row, Add updates it, Cancel resets), inline cell editing, result paths
 * with [n] / [*] in a step's own steps, options a rule loads coming back on a
 * resumed draft, autocompletes re-checked when their parent changes, the
 * rule-chain loop guard, and the UI pieces as components (keyboard flow, row
 * button busy state, cascade loading state, designer editors).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  coerceListRow, formatListCell, listConfigProblem, listEditingRow, listEntryKit, normalizeListConfig, withListEditing, LIST_EDIT_KEY,
} from '@/lib/forms/list-field'
import { lookupDependencyKeys, lookupRowDependencies, recheckedSelection, resolveLookupTemplate } from '@/lib/forms/lookup'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { RuleChainGuard, normalizeFormRules, resumeOptionEvents, ruleValue } from '@/lib/forms/form-rules'
import { pathSegments, readDeepPath, resultProjection } from '@/lib/forms/data-actions'
import { interpolateButtonText, resolveInputTemplate } from '@/lib/forms/buttons'
import { listValueSchema } from '@/lib/workflow-data-picker'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { RowButtons, inlineEnterTarget, rowWithCell } from '@/components/forms/list-field'
import { resetFor } from '@/components/forms/action-host'
import { FormRenderer } from '@/components/forms/form-renderer'
import { ListProperties } from '@/components/forms/designer/list-properties'
import { OutputsEditor, TableActionEditor } from '@/components/forms/designer/data-action-editor'

const PRODUCTS = 'eeeeeeee-0000-4000-8000-000000000001'
const LINES = normalizeListConfig({
  columns: [
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'product', label: 'Product', type: 'lookup', required: true, lookup: { source: 'table', table_id: PRODUCTS, display_columns: ['name'], filters: [{ column: 'country', operator: 'eq', value: '{{row.country}}' }] } },
    { key: 'variant', label: 'Variant', type: 'lookup', lookup: { source: 'table', table_id: PRODUCTS, display_columns: ['name'], filters: [{ column: 'product', operator: 'eq', value: '{{row.product}}' }, { column: 'site', operator: 'eq', value: '{{task_data.site}}' }] } },
    { key: 'qty', label: 'Qty', type: 'number', default: '1' },
  ],
})
const FIELDS = normalizeTaskFields([
  { key: 'site', label: 'Site', type: 'text' },
  { key: 'lines_country', label: 'Country', type: 'text', default: 'NZ' },
  { key: 'lines_product', label: 'Product', type: 'lookup', lookup: { source: 'table', table_id: PRODUCTS, display_columns: ['name'] } },
  { key: 'lines_qty', label: 'Qty', type: 'number', default: '{{site_qty}}' },
  { key: 'site_qty', label: 'Default qty', type: 'number' },
  { key: 'lines', label: 'Lines', type: 'list', list: { ...LINES, row_buttons: [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', style: 'danger' }] } },
])

function host(initial: Record<string, unknown>) {
  const state = { values: { ...initial } as Record<string, unknown>, errors: {} as Record<string, string>, messages: [] as string[] }
  const byKey = new Map(FIELDS.map((f) => [f.key, f]))
  const h: FieldButtonHost = {
    values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
    goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
    message: (t) => { state.messages.push(t) }, fieldError: (f, t) => { state.errors[f] = t },
    editableKeys: new Set(FIELDS.map((f) => f.key)), blank: () => null, field: (k) => byKey.get(k), reset: (k) => resetFor(byKey.get(k), state.values),
  }
  return { h, state }
}

describe('lookup columns', () => {
  it('normalise (one value, no multiple), need a source, keep the label beside the value and show it', () => {
    expect(LINES.columns[1]).toMatchObject({ type: 'lookup', lookup: { source: 'table', table_id: PRODUCTS } })
    expect((normalizeListConfig({ columns: [{ key: 'p', label: 'P', type: 'lookup', lookup: { source: 'table', table_id: PRODUCTS, multiple: true } }] }).columns[0].lookup as any).multiple).toBeUndefined()
    expect(listConfigProblem(normalizeListConfig({ columns: [{ key: 'p', label: 'P', type: 'lookup', lookup: { source: 'table' } }] }))).toMatch(/choose the lookup's data table/)
    const row = coerceListRow(LINES, { country: 'NZ', product: 'r1', product_label: 'Laptop', variant: null, qty: '2', junk: 1 })
    expect(row).toEqual({ country: 'NZ', product: 'r1', qty: 2, variant: null, product_label: 'Laptop', variant_label: null })
    expect(formatListCell(LINES.columns[1], 'r1', row)).toBe('Laptop')
    expect(listValueSchema({ key: 'lines', label: 'Lines', type: 'list', list: LINES }).items!.fields!.map((f) => f.name)).toEqual(['country', 'product', 'product_label', 'variant', 'variant_label', 'qty'])
    const payload = buildFormSubmittedPayload({ form: { id: 'f', name: 'F', version: 1 }, fields: FIELDS, values: { lines: [row] }, submission: { id: 's', created_at: '2026-11-12T00:00:00Z', source: 'standalone' }, submitter: { id: null } })
    expect((payload.form as any).lines[0]).toMatchObject({ product: 'r1', product_label: 'Laptop' })
  })

  it('cascades inside the row: {{row.x}} reads the row; a changed parent cell clears its dependants (and theirs)', () => {
    expect(lookupRowDependencies(LINES.columns[2].lookup)).toEqual(['product'])
    expect(lookupDependencyKeys(LINES.columns[2].lookup)).toEqual(['site'])
    expect(resolveLookupTemplate('{{row.country}}', { search: '', values: { __row: { country: 'AU' } } })).toBe('AU')
    const row = { country: 'NZ', product: 'r1', product_label: 'Laptop', variant: 'v1', variant_label: '14"', qty: 1 }
    expect(rowWithCell(LINES, row, 'country', 'AU')).toEqual({ country: 'AU', product: null, product_label: null, variant: null, variant_label: null, qty: 1 })
    expect(rowWithCell(LINES, row, 'qty', 3)).toEqual({ ...row, qty: 3 })
  })
})

describe('Add row: the label of a lookup input, then the inputs back to their defaults', () => {
  it('copies `<input>_label` into `<column>_label`; resets each input to its default (templates resolved)', async () => {
    const t = host({ site_qty: 4, lines_country: 'AU', lines_product: 'r1', lines_product_label: 'Laptop', lines_qty: 2, lines: [] })
    const add = normalizeFieldButtonAction({ type: 'add_list_row', list_field: 'lines', values: { country: '{{lines_country}}', product: '{{lines_product}}', qty: '{{lines_qty}}' } }, { rule: true })!
    await runFieldButton({ actions: [add] }, t.h)
    expect(t.state.values.lines).toEqual([{ country: 'AU', product: 'r1', qty: 2, variant: null, product_label: 'Laptop', variant_label: null }])
    expect(t.state.values).toMatchObject({ lines_country: 'NZ', lines_product: null, lines_product_label: null, lines_qty: 4 })
    expect(resetFor(FIELDS[1], {})).toBe('NZ')
    expect(resetFor(FIELDS[2], {})).toBeNull()
  })
})

describe('editing rows already in the list', () => {
  const kit = listEntryKit('lines', 'Lines', LINES, [])
  const [add] = normalizeFormRules([kit.rule])
  const [edit, cancel] = normalizeFormRules(kit.editRules)

  it('Edit loads the row into the inputs (and the autocomplete\'s label); Add updates that row; the marker goes', async () => {
    const t = host({ lines: [{ country: 'NZ', product: 'r1', product_label: 'Laptop', qty: 1 }, { country: 'AU', product: 'r2', product_label: 'Monitor', qty: 3 }] })
    await runFieldButton({ actions: edit.then.slice(0, 1) }, t.h, { extras: { event: { row_number: 2, row: (t.state.values.lines as any[])[1], button: 'edit' } } })
    expect(listEditingRow(t.state.values, 'lines')).toBe(1)
    expect(t.state.values).toMatchObject({ lines_country: 'AU', lines_product: 'r2', lines_product_label: 'Monitor', lines_qty: 3 })
    t.state.values.lines_qty = 5
    await runFieldButton({ actions: add.then.slice(0, 1) }, t.h)
    expect((t.state.values.lines as any[]).map((r) => r.qty)).toEqual([1, 5])
    expect((t.state.values.lines as any[])).toHaveLength(2)
    expect(listEditingRow(t.state.values, 'lines')).toBeNull()
  })

  it('Cancel forgets the row and resets the inputs; removing the edited row ends the editing, an earlier one moves it', async () => {
    const t = host({ lines: [{ product: 'a' }, { product: 'b' }, { product: 'c' }], [LIST_EDIT_KEY]: { lines: 2 }, lines_qty: 9 })
    await runFieldButton({ actions: cancel.then.slice(0, 1) }, t.h)
    expect(listEditingRow(t.state.values, 'lines')).toBeNull()
    expect(t.state.values.lines_qty).toBeNull()
    const u = host({ lines: [{ product: 'a' }, { product: 'b' }, { product: 'c' }], [LIST_EDIT_KEY]: withListEditing({}, 'lines', 2) })
    await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'remove_list_row', list_field: 'lines', row: '1' }, { rule: true })!] }, u.h)
    expect(listEditingRow(u.state.values, 'lines')).toBe(1)
    await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'remove_list_row', list_field: 'lines', row: '2' }, { rule: true })!] }, u.h)
    expect(listEditingRow(u.state.values, 'lines')).toBeNull()
  })

  it('the kit wires Edit (row button or row click), Cancel and the state flag', () => {
    expect(kit.editRules[0].if).toEqual({ match: 'all', conditions: [{ column: 'event.button', operator: 'eq', value: 'edit' }] })
    expect(listEntryKit('lines', 'Lines', LINES, [], { edit: 'row_click' }).editRules[0]).toMatchObject({ event: 'list_row_click', target: 'lines' })
    expect(add.then.map((a) => a.type)).toEqual(['add_list_row', 'set_state'])
    // A lookup column's input reads the matching inputs instead of {{row.x}}.
    expect(JSON.stringify(kit.fields.find((f) => f.key === 'lines_variant')!.lookup)).toContain('{{task_data.lines_product}}')
  })
})

describe('result paths with [n] and [*] in a step\'s own steps', () => {
  const result = [{ name: 'Ada', tags: ['a', 'b'], secret: 'x' }, { name: 'Bo', tags: ['c'], secret: 'y' }]
  it('read, interpolate and project only what is read', () => {
    expect(pathSegments('items[0].tags[*]')).toEqual(['items', 0, 'tags', '*'])
    expect(readDeepPath(result, '[0].name')).toBe('Ada')
    expect(readDeepPath(result, '[*].name')).toEqual(['Ada', 'Bo'])
    expect(readDeepPath({ __proto__: 1 } as any, '__proto__')).toBeUndefined()
    expect(ruleValue('result[1].name', { values: {}, event: { result } })).toBe('Bo')
    expect(ruleValue('result[*].name', { values: {}, event: { result } })).toEqual(['Ada', 'Bo'])
    expect(interpolateButtonText('Hi {{result[0].name}} and {{result[1].tags[0]}}', { values: {}, extras: { result } })).toBe('Hi Ada and c')
    expect(resolveInputTemplate('{{result[*].name}}', { values: {}, extras: { result } })).toEqual(['Ada', 'Bo'])
    expect(resultProjection(result, ['{{result[0].name}}', '{{= COUNT(result[*].tags)}}'])).toEqual([{ name: 'Ada', tags: ['a', 'b'] }, { tags: ['c'] }])
    expect(JSON.stringify(resultProjection(result, ['{{result[1].name}}']))).not.toContain('secret')
  })
})

describe('options a rule loads come back on a resumed draft', () => {
  const rules = normalizeFormRules([
    { id: 'r_states', event: 'value_change', target: 'country', then: [{ type: 'call_reference', reference_id: 'ref', inputs: { c: '{{form.country}}' }, outputs: [{ path: '', to: 'state', as: 'options' }] }] },
    { id: 'r_cities', event: 'value_change', target: 'state', then: [{ type: 'call_reference', reference_id: 'ref2', inputs: { s: '{{form.state}}' }, outputs: [{ path: '', to: 'city', as: 'options' }] }] },
    { id: 'r_other', event: 'value_change', target: 'country', then: [{ type: 'message', text: 'x' }] },
  ])
  it('the loading rules run for the saved parents (top-down), not for empty ones or already-loaded options', () => {
    expect(resumeOptionEvents(rules, { country: 'NZ', state: 'WGN', city: 'Petone' }).map((e) => [e.target, (e.context as any).value])).toEqual([['country', 'NZ'], ['state', 'WGN']])
    expect(resumeOptionEvents(rules, { country: 'NZ', state: '', city: '' })).toEqual([])
    expect(resumeOptionEvents(rules, { country: 'NZ', state: 'WGN', __options: { state: [{ value: 'WGN', label: 'W' }] } }).map((e) => e.target)).toEqual([])
  })
})

describe('autocompletes re-checked when their parent changes', () => {
  it('keep the values the source still offers under the new parent, clear the rest', () => {
    expect(recheckedSelection(['r1'], ['r1', 'r2'])).toBeNull()
    expect(recheckedSelection(['r1'], [])).toEqual([])
    expect(recheckedSelection(['r1', 'r3'], ['r3'])).toEqual(['r3'])
  })
})

describe('loop guard for rule chains and cascades', () => {
  it('nests at most three runs; a rule that changes its own source stops instead of looping', async () => {
    const guard = new RuleChainGuard(3)
    let runs = 0
    // A value_change rule on `a` that sets `a` again: each change fires the rule again (the runtime's notifyChange → run).
    const fire = async (): Promise<void> => {
      if (!guard.enter()) return
      try {
        runs += 1
        await fire() // the rule's own write changes its source
      } finally {
        guard.leave()
      }
    }
    await fire()
    expect(runs).toBe(3)
    expect(guard.current).toBe(0)
    // A three-level cascade fits (country → state → city); a fourth level does not run.
    const chain: string[] = []
    const cascade = async (level: number): Promise<void> => {
      if (!guard.enter()) return
      try { chain.push(`level ${level}`); if (level < 5) await cascade(level + 1) } finally { guard.leave() }
    }
    await cascade(1)
    expect(chain).toEqual(['level 1', 'level 2', 'level 3'])
  })
})

describe('UI pieces as components', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))

  it('inline keyboard flow: Enter → next cell, next row, then a new row (only where rows can be added)', () => {
    expect(inlineEnterTarget(0, 0, 2, 3, true)).toEqual({ focus: [0, 1] })
    expect(inlineEnterTarget(0, 2, 2, 3, true)).toEqual({ focus: [1, 0] })
    expect(inlineEnterTarget(1, 2, 2, 3, true)).toEqual({ add: true })
    expect(inlineEnterTarget(1, 2, 2, 3, false)).toBeNull()
  })

  it('row buttons: the pressed one is busy with a spinner; the others wait', () => {
    const html = renderToStaticMarkup(createElement(RowButtons, { buttons: [{ id: 'edit', label: 'Edit' }, { id: 'delete', label: 'Delete', style: 'danger' }], index: 1, busy: 'delete:1', onPress: () => {} }))
    expect(html).toMatch(/data-list-row-button="delete"[^>]*aria-busy="true"|aria-busy="true"[^>]*data-list-row-button="delete"/)
    expect(html).toContain('animate-spin')
    expect((html.match(/disabled=""/g) ?? []).length).toBe(2)
    const idle = renderToStaticMarkup(createElement(RowButtons, { buttons: [{ id: 'edit', label: 'Edit' }], index: 0, busy: null, onPress: () => {} }))
    expect(idle).not.toContain('aria-busy')
  })

  it('the list view: the row being edited is marked; row click makes rows buttons; inline edit draws inputs without Add', () => {
    const rows = [{ country: 'NZ', product: 'r1', product_label: 'Laptop', qty: 1 }, { country: 'AU', product: 'r2', product_label: 'Monitor', qty: 3 }]
    const html = wrap(createElement(FormRenderer, { fields: FIELDS, values: { lines: rows, [LIST_EDIT_KEY]: { lines: 1 } }, onChange: () => {} }))
    expect(html).toContain('data-list-editing-badge')
    expect(html).toContain('Monitor')
    const clickable = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'list', list: { ...LINES, row_click: true } }])
    // Without a rules scope there is nothing to run: rows stay plain.
    expect(wrap(createElement(FormRenderer, { fields: clickable, values: { lines: rows }, onChange: () => {} }))).not.toContain('data-list-row-click')
    const inline = normalizeTaskFields([{ key: 'lines', label: 'Lines', type: 'list', list: { columns: [{ key: 'item', label: 'Item', type: 'text' }], inline_edit: true } }])
    const editHtml = wrap(createElement(FormRenderer, { fields: inline, values: { lines: [{ item: 'A' }] }, onChange: () => {} }))
    expect(editHtml).toContain('data-list-mode="inline-edit"')
    expect(editHtml).toContain('data-list-input="item"')
    expect(editHtml).not.toContain('data-list-add')
  })

  it('the cascade loading state: a choice whose options a step is loading says so and waits', () => {
    const fields = normalizeTaskFields([{ key: 'state', label: 'State', type: 'choice', options: ['A'] }])
    const html = wrap(createElement(FormRenderer, { fields, values: { __options: { __loading: ['state'] } }, onChange: () => {} }))
    expect(html).toContain('data-dynamic-options="loading"')
    expect(html).toContain('Loading options…')
    const loaded = wrap(createElement(FormRenderer, { fields, values: { __options: { state: [{ value: 'WGN', label: 'Wellington' }] } }, onChange: () => {} }))
    expect(loaded).not.toContain('Loading options…')
  })

  it('designer editors: the List panel (lookup column, edit kit, row click / inline edit); the table step (outputs, TOP 1 notice)', () => {
    const field: any = { _id: 'x', key: 'lines', label: 'Lines', type: 'list', list: LINES }
    const html = wrap(createElement(ListProperties, { field, onPatch: () => {}, onAddEntryKit: () => {}, renderLookup: () => createElement('span', { 'data-lookup-editor': '' }) }))
    expect(html).toContain('data-list-kit-edit')
    expect(html).toContain('data-list-row-click-toggle')
    expect(html).toContain('data-list-inline-edit-toggle')
    expect(html).toContain('Lookup (table / API)')
    const state: any = { fields: [{ _id: 'a', key: 'customer_name', label: 'Customer', type: 'text' }, { _id: 'b', key: 'lines', label: 'Lines', type: 'list', list: LINES }], layout: { rows: [] }, buttons: [], header: {}, theme: { source: 'workspace' } }
    const action: any = { type: 'table_list', table_id: PRODUCTS, outputs: [{ path: 'name', to: 'customer_name' }, { path: '', to: 'lines' }] }
    const outputs = wrap(createElement(OutputsEditor, { action, state, onChange: () => {}, resultIsList: true, onOpenFilter: () => {} }))
    expect((outputs.match(/data-top-one-notice/g) ?? []).length).toBe(1) // the single field warns, the List doesn't
    expect(outputs).toContain('data-open-filter')
    const table = wrap(createElement(TableActionEditor, { action, state, placeholders: [], onChange: () => {} }))
    expect(table).toContain('data-action-filter')
    expect(table).toContain('data-action-test')
  })
})
