/**
 * Row selection in a List (list.selectable): the selection as UI state
 * (never submitted) and as rules read it, list actions aimed at the selected
 * rows (remove / edit / update; a table step per selected row), confirm
 * prompts, the empty-selection message, delete clearing the selection and
 * ending the editing, buttons enabled only with a selection, the kit's
 * wiring, rule summaries, the list view's selection UI and the Agent check.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  LIST_EDIT_KEY, LIST_SELECT_KEY, listDerivedKeys, listEditingRow, listEntryKit, listSelection, listSelectionEntries, normalizeListConfig, remapAfterRemoval, withListSelected,
} from '@/lib/forms/list-field'
import { fieldDefinitionProblems, mergeTaskFieldValues, normalizeTaskFields } from '@/lib/task-field-schema'
import { normalizeFieldButton, normalizeFieldButtonAction, runFieldButton, type FieldButtonHost, type PromptRequest } from '@/lib/forms/field-buttons'
import { describeRuleAction, normalizeFormRules, ruleConditionsMet } from '@/lib/forms/form-rules'
import { storedValues } from '@/lib/services/form-submissions'
import { addListEntryKit, designerProblems, designerStateFrom } from '@/lib/forms/designer-state'
import { FormRenderer } from '@/components/forms/form-renderer'
import { ListProperties } from '@/components/forms/designer/list-properties'
import { RowTargetEditor } from '@/components/forms/designer/list-action-editor'

const LIST = normalizeListConfig({ columns: [{ key: 'item', label: 'Item', type: 'text', required: true }, { key: 'qty', label: 'Qty', type: 'number' }], selectable: 'multiple' })
const FIELDS = normalizeTaskFields([
  { key: 'item_input', label: 'Item', type: 'text' },
  { key: 'qty_input', label: 'Qty', type: 'number', default: '1' },
  { key: 'lines', label: 'Line items', type: 'list', list: LIST },
  { key: 'delete_btn', label: 'Delete selected', type: 'button', button: { style: 'danger', actions: [], requires_selection: 'lines' } },
])
const ROWS = [{ item: 'A', qty: 1 }, { item: 'B', qty: 2 }, { item: 'C', qty: 3 }, { item: 'D', qty: 4 }]

function host(initial: Record<string, unknown>, answer: string | null = 'yes') {
  const state = { values: { ...initial } as Record<string, unknown>, messages: [] as string[], asked: [] as PromptRequest[], calls: [] as any[] }
  const byKey = new Map(FIELDS.map((f) => [f.key, f]))
  const h: FieldButtonHost = {
    values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
    goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
    message: (t) => { state.messages.push(t) }, editableKeys: new Set(FIELDS.map((f) => f.key)), blank: () => null, field: (k) => byKey.get(k),
    reset: (k) => (byKey.get(k)?.default ?? null),
    ...(answer === null ? {} : { ask: async (r: PromptRequest) => { state.asked.push(r); return answer } }),
    runExtra: async (_i, _a, _v, _b, event) => { state.calls.push(event); return {} },
  }
  return { h, state }
}
const act = (raw: Record<string, unknown>) => normalizeFieldButtonAction(raw, { rule: true })!

describe('selection state', () => {
  it('is kept per List (0-based, unique, ascending) and read by rules as row numbers, the first row and the count', () => {
    const values: Record<string, unknown> = { lines: ROWS, [LIST_SELECT_KEY]: withListSelected({}, 'lines', [2, 0, 2]) }
    expect(listSelection(values, 'lines')).toEqual([0, 2])
    expect(listSelectionEntries(FIELDS, values)).toEqual({ lines_selected: [1, 3], lines_selected_row: { item: 'A', qty: 1 }, lines_selected_count: 2 })
    expect(listSelectionEntries(FIELDS, { lines: ROWS })).toEqual({ lines_selected: [], lines_selected_row: null, lines_selected_count: 0 })
    expect(withListSelected(values, 'lines', [])).toEqual({})
    expect(remapAfterRemoval([0, 2, 3], new Set([1, 2]))).toEqual([0, 1])
    // A rule condition on the count (a button disabled until something is selected).
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'lines_selected_count', operator: 'gt', value: '0' }] }, { values: { ...values, ...listSelectionEntries(FIELDS, values) } })).toBe(true)
  })

  it('is never submitted, and owns its keys (a field can\'t use lines_selected)', () => {
    const sent = { lines: ROWS, [LIST_SELECT_KEY]: { lines: [1] }, lines_selected: [2], lines_selected_count: 1 }
    expect(Object.keys(storedValues(FIELDS, sent))).toEqual(['lines', 'lines_count'])
    expect(Object.keys(mergeTaskFieldValues({ fields: FIELDS }, sent).templateValues)).not.toContain(LIST_SELECT_KEY)
    expect(listDerivedKeys('lines', LIST)).toEqual(['lines_count', 'lines_selected', 'lines_selected_row', 'lines_selected_count'])
    expect(fieldDefinitionProblems(normalizeTaskFields([{ key: 'lines', label: 'L', type: 'list', list: LIST }, { key: 'lines_selected', label: 'X', type: 'text' }])).lines).toMatch(/lines_selected/)
  })
})

describe('list actions aimed at the selection', () => {
  it('remove: every selected row (after a confirmation with {{count}}); the selection clears; editing ends when its row went, else follows its row', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0, 2] }, [LIST_EDIT_KEY]: { lines: 3 } })
    await runFieldButton({ actions: [act({ type: 'remove_list_row', list_field: 'lines', row: 'selected', confirm_text: 'Delete {{count}} rows?' })] }, t.h)
    expect(t.state.asked[0].text).toBe('Delete 2 rows?')
    expect((t.state.values.lines as any[]).map((r) => r.item)).toEqual(['B', 'D'])
    expect(listSelection(t.state.values, 'lines')).toEqual([])
    expect(listEditingRow(t.state.values, 'lines')).toBe(1)
    const u = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [3] }, [LIST_EDIT_KEY]: { lines: 3 } })
    await runFieldButton({ actions: [act({ type: 'remove_list_row', list_field: 'lines', row: 'selected' })] }, u.h)
    expect(listEditingRow(u.state.values, 'lines')).toBeNull()
  })

  it('a No (or a closed question) keeps the rows and stops the rule; clear_list asks too', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0] } }, 'no')
    const run = await runFieldButton({ actions: [act({ type: 'remove_list_row', list_field: 'lines', row: 'selected', confirm_text: 'Delete?' }), act({ type: 'message', text: 'after' })] }, t.h)
    expect(run.stopped).toBe('prompt_stopped')
    expect(t.state.values.lines).toEqual(ROWS)
    expect(t.state.messages).toEqual([])
    const c = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [1] } })
    await runFieldButton({ actions: [act({ type: 'clear_list', list_field: 'lines', confirm_text: 'Clear all {{count}} rows?' })] }, c.h)
    expect(c.state.asked[0].text).toBe('Clear all 4 rows?')
    expect(c.state.values.lines).toEqual([])
    expect(listSelection(c.state.values, 'lines')).toEqual([])
  })

  it('nothing selected: the configured message, nothing changes, the rule stops', async () => {
    const t = host({ lines: ROWS })
    const run = await runFieldButton({ actions: [act({ type: 'remove_list_row', list_field: 'lines', row: 'selected', empty_text: 'Pick a line item first' }), act({ type: 'message', text: 'after' })] }, t.h)
    expect(run.stopped).toBe('selection_empty')
    expect(t.state.messages).toEqual(['Pick a line item first'])
    expect(t.state.values.lines).toEqual(ROWS)
    const d = host({ lines: ROWS })
    await runFieldButton({ actions: [act({ type: 'edit_list_row', list_field: 'lines', row: 'selected', assign: { item_input: '{{row.item}}' } })] }, d.h)
    expect(d.state.messages).toEqual(['Select a row first'])
  })

  it('edit: loads the selected row; with several, the first and a notice', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [2, 3] } })
    await runFieldButton({ actions: [act({ type: 'edit_list_row', list_field: 'lines', row: 'selected', assign: { item_input: '{{row.item}}', qty_input: '{{row.qty}}' } })] }, t.h)
    expect(t.state.values).toMatchObject({ item_input: 'C', qty_input: 3 })
    expect(listEditingRow(t.state.values, 'lines')).toBe(2)
    expect(t.state.messages).toEqual(['2 rows are selected: editing the first (row 3)'])
  })

  it('update: every selected row, each with its own {{row.*}}', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [0, 3] } })
    await runFieldButton({ actions: [act({ type: 'update_list_row', list_field: 'lines', row: 'selected', values: { qty: '{{=row.qty * 10}}' } })] }, t.h, {
      resolve: async (template, _v, ex: any) => (template === '{{=row.qty * 10}}' ? ex.row.qty * 10 : template),
    })
    expect((t.state.values.lines as any[]).map((r) => r.qty)).toEqual([10, 2, 3, 40])
  })

  it('a table step runs once per selected row with that row as {{row.*}} (each its own call)', async () => {
    const t = host({ lines: ROWS, [LIST_SELECT_KEY]: { lines: [1, 2] } })
    await runFieldButton({ actions: [act({ type: 'table_delete', table_id: 'eeeeeeee-0000-4000-8000-000000000001', row_id: '{{row.item}}', each_selected: 'lines' })] }, t.h)
    expect(t.state.calls.map((e) => [e.row.item, e.row_number])).toEqual([['B', 2], ['C', 3]])
    const none = host({ lines: ROWS })
    expect((await runFieldButton({ actions: [act({ type: 'table_delete', table_id: 'eeeeeeee-0000-4000-8000-000000000001', row_id: '{{row.item}}', each_selected: 'lines' })] }, none.h)).stopped).toBe('selection_empty')
  })
})

describe('buttons, the kit, summaries, the designer and the list view', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))

  it('a button "Enabled only when a row is selected" is disabled until the count is > 0', () => {
    expect(normalizeFieldButton({ style: 'danger', actions: [], requires_selection: 'lines' }).requires_selection).toBe('lines')
    const none = wrap(createElement(FormRenderer, { fields: FIELDS, values: { lines: ROWS }, onChange: () => {} }))
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*Delete selected|<button[^>]*disabled=""[^>]*data-field-button-style="danger"/)
    const some = wrap(createElement(FormRenderer, { fields: FIELDS, values: { lines: ROWS, [LIST_SELECT_KEY]: { lines: [1] } }, onChange: () => {} }))
    expect(some).not.toMatch(/<button[^>]*disabled=""[^>]*data-field-button-style="danger"/)
  })

  it('the list view: checkboxes and select-all (multiple); aria-selected rows; single mode selects by click', () => {
    const html = wrap(createElement(FormRenderer, { fields: FIELDS, values: { lines: ROWS, [LIST_SELECT_KEY]: { lines: [1] } }, onChange: () => {} }))
    expect(html).toContain('data-list-select-all')
    expect((html.match(/data-list-select-row=/g) ?? []).length).toBeGreaterThanOrEqual(4)
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('data-selected="true"')
    const single = normalizeTaskFields([{ key: 'lines', label: 'L', type: 'list', list: { ...LIST, selectable: 'single', row_click: true } }])
    const s = wrap(createElement(FormRenderer, { fields: single, values: { lines: ROWS }, onChange: () => {} }))
    expect(s).toContain('data-list-selectable="single"')
    expect(s).not.toContain('data-list-select-all')
    expect(s).not.toContain('data-list-row-click') // selection wins over row click
  })

  it('the kit with selection: Edit selected, Delete selected (asks first) and Clear list, disabled without a selection', () => {
    const kit = listEntryKit('lines', 'Line items', LIST, [], { selection: 'multiple' })
    expect(kit.listPatch).toEqual({ selectable: 'multiple' })
    expect(kit.fields.filter((f) => f.type === 'button').map((f) => [f.label, f.button?.requires_selection ?? null])).toEqual([
      ['Add item', null], ['Cancel editing', null], ['Edit selected item', 'lines'], ['Delete selected', 'lines'], ['Clear list', null],
    ])
    const [edit, , del, clear] = kit.editRules
    expect(edit.then[0]).toMatchObject({ type: 'edit_list_row', row: 'selected', assign: { lines_item: '{{row.item}}' } })
    expect(del.then[0]).toMatchObject({ type: 'remove_list_row', row: 'selected', confirm_text: 'Delete {{count}} selected row(s)?' })
    expect(clear.then[0]).toMatchObject({ type: 'clear_list', confirm_text: 'Clear all rows?' })
    const state = designerStateFrom({ fields: normalizeTaskFields([{ key: 'lines', label: 'Line items', type: 'list', list: { columns: LIST.columns } }]), layout: null } as any)
    const out = addListEntryKit(state, state.fields[0]._id, { selection: 'single' })!
    expect(out.state.fields.find((f) => f.key === 'lines')!.list?.selectable).toBe('single')
    expect(out.state.layout.rows.map((r) => r.cells.map((c) => c.field_key)).slice(-3)).toEqual([['lines_add', 'lines_cancel'], ['lines_edit_selected', 'lines_delete_selected', 'lines_clear'], ['lines']])
    expect(designerProblems(out.state)).toEqual({})
  })

  it('rule summaries read naturally', () => {
    const def: any = { fields: FIELDS, layout: {} }
    expect(describeRuleAction(def, act({ type: 'remove_list_row', list_field: 'lines', row: 'selected', confirm_text: 'x' }))).toBe('Delete the selected rows of Line items (asks first)')
    expect(describeRuleAction(def, act({ type: 'clear_list', list_field: 'lines' }))).toBe('Clear Line items')
    expect(describeRuleAction(def, act({ type: 'edit_list_row', list_field: 'lines', row: 'selected', assign: { item_input: '{{row.item}}' } }))).toBe('Edit the selected row of Line items: load Item')
    expect(describeRuleAction(def, act({ type: 'update_list_row', list_field: 'lines', row: 'selected', values: { qty: '0' } }))).toBe('Update the selected rows of Line items: qty = 0')
    expect(describeRuleAction(def, act({ type: 'table_delete', table_id: 'eeeeeeee-0000-4000-8000-000000000001', table_name: 'Lines', row_id: '{{row.item}}', each_selected: 'lines' }))).toMatch(/Delete a row of Lines for each selected row of Line items/)
  })

  it('designer: the selection setting, the kit choice, "Selected row(s)" as a target', () => {
    const html = wrap(createElement(ListProperties, { field: { _id: 'x', key: 'lines', label: 'Line items', type: 'list', list: LIST } as any, onPatch: () => {}, onAddEntryKit: () => {} }))
    expect(html).toContain('data-list-selectable')
    expect(html).toContain('data-list-kit-selection')
    const state: any = { fields: FIELDS, layout: { rows: [] } }
    const target = wrap(createElement(RowTargetEditor, { action: act({ type: 'remove_list_row', list_field: 'lines', row: 'selected' }), state, placeholders: [], onChange: () => {}, fallback: 'last' }))
    expect(target).toContain('Selected row(s)')
    expect(target).toContain('Message when nothing is selected')
  })

  it('the Agent\'s build_plan check: a selection target needs a selectable List', async () => {
    const { formRulesProblems } = await import('@/lib/assistants/tools/build-plan')
    const fields = normalizeTaskFields([{ key: 'lines', label: 'L', type: 'list', list: { columns: LIST.columns } }, { key: 'del', label: 'Del', type: 'button', button: { actions: [] } }, { key: 'item', label: 'Item', type: 'text' }])
    const layout = { rules: [
      { id: 'r_add', event: 'button_click', target: 'del', then: [{ type: 'add_list_row', list_field: 'lines', values: { item: '{{item}}' } }] },
      { id: 'r', event: 'button_click', target: 'del', then: [{ type: 'remove_list_row', list_field: 'lines', row: 'selected' }] },
    ] }
    expect(formRulesProblems(fields, layout).join(' | ')).toMatch(/has no row selection/)
    expect(normalizeFormRules(layout.rules)).toHaveLength(2)
  })
})
