/**
 * Repeating sections on every surface: the designer state (palette default,
 * inner form as a designer state, moving fields in / out, copies with new
 * keys, the depth cap), the runtime and read-only renders, the form's List
 * rules and data / API outputs writing items, file controls inside items,
 * the data picker and a workflow Loop over the items saving each to a table.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient: createClientMock }))
vi.mock('@/lib/process-queue', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/process-queue')>()),
  kickQueueProcessor: () => {},
}))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormRenderer, RepeatingSectionValueView, formatFieldValue } from '@/components/forms/form-renderer'
import { normalizeTaskFields, type TaskFieldDef } from '@/lib/task-field-schema'
import {
  addField, definitionFrom, designerFieldPath, designerProblems, designerStateFrom, duplicateField, extractField, moveIntoSection, newField, scopedView, sectionView,
  takenKeys, updateField, withScopedView, withSectionView, type DesignerField,
} from '@/lib/forms/designer-state'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { resolveInputTemplate } from '@/lib/forms/buttons'
import { asListField } from '@/lib/forms/repeating-section'
import { mapActionOutputs, outputProblems } from '@/lib/forms/action-outputs'
import { buildFormSubmittedPayload } from '@/lib/forms/submitted-trigger'
import { buildDataTree, fieldSchema } from '@/lib/workflow-data-picker'
import { validateWorkflowWiring } from '@/lib/workflow-wiring'
import { executeWorkflow } from '@/lib/workflow-engine'
import { resolveAttachmentValues, attachmentIdsIn } from '@/lib/services/form-files'
import { createFakeSupabase } from './helpers/fake-supabase'

const TENANT = '0e000000-0000-4000-8000-00000000040a'
const WF = '0e000000-0000-4000-8000-0000000004b1'
const TABLE = '0e000000-0000-4000-8000-0000000004c2'
const FORM = '0e000000-0000-4000-8000-0000000004d1'

const FIELDS = normalizeTaskFields([
  { key: 'employee', label: 'Employee', type: 'text' },
  {
    key: 'expenses', label: 'Expenses', type: 'repeating_section', repeating_section: {
      fields: [
        { key: 'description', label: 'Description', type: 'text', required: true },
        { key: 'category', label: 'Category', type: 'choice', options: ['Airfare', 'Meals'] },
        { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD' },
        { key: 'spent_on', label: 'Date', type: 'date' },
        { key: 'receipts', label: 'Receipts', type: 'attachments' },
        { key: 'stops', label: 'Stops', type: 'repeating_section', repeating_section: { fields: [{ key: 'city', label: 'City', type: 'text' }, { key: 'nights', label: 'Nights', type: 'number' }], totals: [{ field: 'nights', fn: 'sum' }] } },
      ],
      layout: { rows: [{ columns: 2, cells: [{ field_key: 'description', span: 1 }, { field_key: 'amount', span: 1 }] }] },
      item_title: '{{item.description}}',
      totals: [{ field: 'amount', fn: 'sum' }],
    },
  },
])
const ITEMS = [
  { description: 'Flight', category: 'Airfare', amount: 412.6, spent_on: '2026-11-02', stops: [{ city: 'New York', nights: 2 }, { city: 'Boston', nights: 1 }] },
  { description: 'Dinner', category: 'Meals', amount: 68.4, spent_on: '2026-11-03', stops: [] },
]

describe('designer state', () => {
  it('a new repeating section starts with a description and an amount (USD) on its grid, keys unique over the form', () => {
    const f = newField('repeating_section', ['description'])
    expect(f.label).toBe('Items')
    expect(f.repeating_section!.fields.map((x) => [x.key, x.type])).toEqual([['description_2', 'text'], ['amount', 'currency']])
    expect(f.repeating_section!.layout!.rows[0].cells.map((c) => c.field_key)).toEqual(['description_2', 'amount'])
    expect((f.repeating_section!.fields[1] as TaskFieldDef).currency).toBe('USD')
  })

  it('the inner form is a designer state: edit, add, remove inside it and write it back; ids follow; saved without designer props', () => {
    let state = designerStateFrom({ fields: FIELDS, layout: null, theme: null } as any)
    const section = state.fields.find((f) => f.key === 'expenses')!
    const view = sectionView(state, section._id)!
    expect(view.fields.map((f) => f.key)).toEqual(['description', 'category', 'amount', 'spent_on', 'receipts', 'stops'])
    expect(view.fields.every((f) => typeof f._id === 'string')).toBe(true)
    // Rows the stored grid misses are added (one per field).
    expect(view.layout.rows).toHaveLength(5)
    expect(view.outerKeys).toEqual(expect.arrayContaining(['employee', 'expenses']))
    expect(view.outerKeys).not.toContain('description')
    // Add a control inside: its key avoids every key of the form.
    const { state: withNew, field } = addField({ ...view, outerKeys: [...view.outerKeys!, 'text'] }, 'text')
    expect(field.key).toBe('text_2')
    state = withSectionView(state, section._id, withNew)
    expect(designerFieldPath(state, field._id)).toEqual([section._id])
    // Rename it through the scoped view.
    const path = designerFieldPath(state, field._id)!
    state = withScopedView(state, path, updateField(scopedView(state, path)!, field._id, { label: 'Notes' }))
    expect(sectionView(state, section._id)!.fields.find((f) => f._id === field._id)!.label).toBe('Notes')
    const def = definitionFrom(state)
    const saved = def.fields.find((f) => f.key === 'expenses')!.repeating_section!
    expect(saved.fields.map((f) => f.key)).toContain('notes')
    expect(JSON.stringify(saved)).not.toMatch(/_id|_keyLocked/)
    expect(saved.layout!.rows.flatMap((r) => r.cells.map((c) => c.field_key))).toContain('notes')
    // Nested: the stops section's own view.
    const stopsId = sectionView(state, section._id)!.fields.find((f) => f.key === 'stops')!._id
    expect(scopedView(state, [section._id, stopsId])!.fields.map((f) => f.key)).toEqual(['city', 'nights'])
    expect(takenKeys(state)).toEqual(expect.arrayContaining(['city', 'nights', 'notes']))
  })

  it('moves a field in and out of a section; refuses what an item cannot hold', () => {
    const fields = normalizeTaskFields([
      { key: 'notes', label: 'Notes', type: 'textarea' },
      { key: 'grid', label: 'Grid', type: 'data_table', data_table: { source: 'table', mode: 'display', columns: [] } },
      { key: 'trips', label: 'Trips', type: 'repeating_section', repeating_section: { fields: [{ key: 'city', label: 'City', type: 'text' }] } },
    ])
    const state = designerStateFrom({ fields, layout: null, theme: null } as any)
    const trips = state.fields.find((f) => f.key === 'trips')!
    const moved = moveIntoSection(state, trips._id, 'notes', { row: 0, index: 1 })!
    expect(moved.fields.map((f) => f.key)).toEqual(['grid', 'trips'])
    expect(sectionView(moved, trips._id)!.fields.map((f) => f.key)).toEqual(['city', 'notes'])
    expect(sectionView(moved, trips._id)!.layout.rows.flatMap((r) => r.cells.map((c) => c.field_key))).toEqual(['city', 'notes'])
    expect(moveIntoSection(state, trips._id, 'grid', { row: 0, index: 0 })).toBeNull()
    expect(moveIntoSection(state, trips._id, 'trips', { row: 0, index: 0 })).toBeNull()
    // …and back out: extract from the section, the section keeps the rest.
    const out = extractField(moved, 'notes')!
    expect(out.field.key).toBe('notes')
    expect(sectionView(out.state, trips._id)!.fields.map((f) => f.key)).toEqual(['city'])
  })

  it('a copied section gets new inner keys (grid and totals follow); problems flag duplicate keys', () => {
    const state = designerStateFrom({ fields: FIELDS, layout: null, theme: null } as any)
    const section = state.fields.find((f) => f.key === 'expenses')!
    const copy = duplicateField(state, section._id)!
    const config = copy.field.repeating_section!
    expect(copy.field.key).toBe('expenses_2')
    expect(config.fields.map((f) => f.key)).toEqual(['description_2', 'category_2', 'amount_2', 'spent_on_2', 'receipts_2', 'stops_2'])
    expect(config.layout!.rows[0].cells.map((c) => c.field_key)).toEqual(['description_2', 'amount_2'])
    expect(config.totals).toEqual([{ field: 'amount_2', fn: 'sum' }])
    expect((config.fields[5] as DesignerField).repeating_section!.fields.map((f) => f.key)).toEqual(['city_2', 'nights_2'])
    expect(designerProblems(copy.state)).toEqual({})
    // A top-level field taking an inner key is flagged on the section.
    const clash = { ...state, fields: [...state.fields, { ...newField('text', []), key: 'amount', _keyLocked: true }] }
    expect(Object.values(designerProblems(clash)).join(' ')).toMatch(/"amount" is used elsewhere/)
  })
})

describe('render', () => {
  const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const render = (node: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: qc() }, node))

  it('editable: a card per item (fieldset, title, tools), the inner grid, Add and the totals', () => {
    const html = render(createElement(FormRenderer, { fields: FIELDS, layout: null, values: { expenses: ITEMS }, onChange: () => {} }))
    expect(html).toContain('data-repeating-section="expenses"')
    expect((html.match(/data-repeating-item="/g) ?? []).length).toBe(4) // 2 expenses + 2 stops in the first
    expect(html).toMatch(/<fieldset[^>]*data-repeating-item="0"/)
    expect(html).toContain('>Flight<')
    expect(html).toContain('Remove Flight')
    expect(html).toContain('Move Dinner up')
    expect(html).toContain('Add expense')
    expect(html).toContain('$481.00')
    expect(html).toContain('2 expenses')
    // Inner ids are unique per item.
    const ids = [...html.matchAll(/id="([^"]*-cell-description)"/g)].map((m) => m[1])
    expect(new Set(ids).size).toBe(2)
  })

  it('shows item errors at their paths', () => {
    const html = render(createElement(FormRenderer, { fields: FIELDS, layout: null, values: { expenses: ITEMS }, onChange: () => {}, errors: { 'expenses[1].description': 'Description is required', expenses: 'Expenses: item 2: Description is required' } }))
    expect(html).toContain('Description is required')
    expect(html).toContain('1 problem')
  })

  it('read only: no tools, the values, the summary; submission views start collapsed', () => {
    const html = render(createElement(FormRenderer, { fields: FIELDS, layout: null, values: { expenses: ITEMS }, readOnly: true }))
    expect(html).not.toContain('Add expense')
    expect(html).not.toContain('Remove Flight')
    expect(html).toContain('412.6')
    const view = render(createElement(RepeatingSectionValueView, { field: FIELDS[1], value: ITEMS }))
    expect(view).toContain('2 expenses')
    expect(view).toMatch(/hidden=""[^>]*data-repeating-item-body/)
    expect(formatFieldValue(FIELDS[1], ITEMS)).toBe('2 expenses')
  })
})

describe("the form's List rules and data / API outputs write items", () => {
  const act = (raw: Record<string, unknown>) => normalizeFieldButtonAction(raw, { rule: true })!
  const resolve = (template: string, values: Record<string, unknown>, extras: Record<string, unknown>) => resolveInputTemplate(template, { values, extras })
  function host(initial: Record<string, unknown>) {
    const state = { values: { ...initial } as Record<string, unknown> }
    const byKey = new Map(FIELDS.map((f) => [f.key, asListField(f)]))
    const h: FieldButtonHost = {
      values: () => state.values, state: () => ({ flags: {}, hidden: [] }), setValues: (p) => { state.values = { ...state.values, ...p } }, setState: () => {}, flush: async () => {},
      goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true,
      message: () => {}, editableKeys: new Set(FIELDS.map((f) => f.key)), blank: () => null, field: (k) => byKey.get(k) as any,
    }
    return { h, state }
  }

  it('Add row to list / Update a row / Remove a row / Clear list on a repeating section', async () => {
    const t = host({ expenses: ITEMS, d: 'Taxi' })
    await runFieldButton({ actions: [act({ type: 'add_list_row', list_field: 'expenses', values: { description: '{{d}}', amount: '24.5', category: 'Meals' } })] }, t.h, { resolve })
    let items = t.state.values.expenses as any[]
    expect(items).toHaveLength(3)
    expect(items[2]).toMatchObject({ description: 'Taxi', amount: 24.5, category: 'Meals' })
    // Controls the List columns don't model (files, nested sections as a nested List) keep their values.
    expect(items[0].stops).toEqual([{ city: 'New York', nights: 2 }, { city: 'Boston', nights: 1 }].map((s) => expect.objectContaining(s)))
    await runFieldButton({ actions: [act({ type: 'update_list_row', list_field: 'expenses', row: 'first', values: { amount: '400' } })] }, t.h, { resolve })
    items = t.state.values.expenses as any[]
    expect(items[0].amount).toBe(400)
    await runFieldButton({ actions: [act({ type: 'remove_list_row', list_field: 'expenses', row: 'last' })] }, t.h, { resolve })
    expect((t.state.values.expenses as any[]).map((i) => i.description)).toEqual(['Flight', 'Dinner'])
    await runFieldButton({ actions: [act({ type: 'clear_list', list_field: 'expenses' })] }, t.h, { resolve })
    expect(t.state.values.expenses).toEqual([])
  })

  it('a data / API step writes its rows as items (column mapping, append)', () => {
    const outputs = [{ path: '', to: 'expenses', columns: { description: 'name', amount: 'total' }, mode: 'append' as const }]
    const mapped = mapActionOutputs([{ name: 'Hotel', total: '210' }, { name: 'Parking', total: 18 }], outputs as any, FIELDS, [], { expenses: [ITEMS[1]] })
    expect((mapped.values.expenses as any[]).map((i) => [i.description, i.amount])).toEqual([['Dinner', 68.4], ['Hotel', 210], ['Parking', 18]])
    expect(outputProblems(outputs as any, { fields: FIELDS, variables: [] })).toEqual([])
    expect(outputProblems([{ path: '', to: 'expenses', columns: { nope: 'x' } }] as any, { fields: FIELDS, variables: [] })[0]).toMatch(/no column "nope"/)
  })
})

describe('file controls inside items', () => {
  const FILE = '0e000000-0000-4000-8000-0000000004f1'
  const row = { id: FILE, tenant_id: TENANT, field_key: 'receipts', status: 'pending', context_kind: 'form', form_id: FORM, uploaded_by: 'u1', name: 'taxi.pdf', mime_type: 'application/pdf', size_bytes: 1200, storage_key: 'k', created_at: '2026-11-11T00:00:00Z', checksum_sha256: 'x' }
  const db = (rows: any[]) => ({ from: () => ({ select: () => ({ eq: () => ({ in: async () => ({ data: rows, error: null }) }) }) }) })

  it('re-reads each item\'s files from the upload records; a forged one is refused at its path', async () => {
    const values = { expenses: [{ description: 'Taxi', receipts: [{ id: FILE, name: 'forged.exe' }] }, { description: 'None', receipts: [] }] }
    expect(attachmentIdsIn(FIELDS, values)).toEqual([FILE])
    const ok = await resolveAttachmentValues(db([row]) as any, TENANT, FIELDS, values, { kind: 'form', formId: FORM, actorId: 'u1' })
    expect(ok.errors).toEqual({})
    const items = ok.values.expenses as any[]
    expect(items[0].receipts[0]).toMatchObject({ id: FILE, name: 'taxi.pdf' })
    expect(items[0].receipts_count).toBe(1)
    const bad = await resolveAttachmentValues(db([{ ...row, uploaded_by: 'someone else' }]) as any, TENANT, FIELDS, values, { kind: 'form', formId: FORM, actorId: 'u1' })
    expect(bad.errors['expenses[0].receipts']).toMatch(/no longer available/)
    expect(bad.errors.expenses).toMatch(/^Expenses: item 1/)
    expect(bad.values.expenses).toBeUndefined()
  })
})

function graph() {
  const nodes = [
    { id: 'trigger', type: 'form_submitted', label: 'Claim submitted', position: { x: 0, y: 0 }, config: { form_id: FORM, form_name: 'Claim', fields: FIELDS } },
    { id: 'each', type: 'loop', label: 'Each expense', position: { x: 0, y: 100 }, config: { items: '{{form.expenses}}', item_var: 'item', index_var: 'index' } },
    { id: 'stops', type: 'loop', label: 'Each stop', position: { x: 0, y: 200 }, config: { items: '{{item.stops}}', item_var: 'stop', index_var: 'stop_index' } },
    { id: 'save_stop', type: 'update_data_table', label: 'Save stop', position: { x: 0, y: 300 }, config: { table_id: TABLE, table_name: 'Expenses', operation: 'insert', column_values: { description: '{{parent_item.description}} / {{stop.city}}', amount: '{{stop.nights}}', employee: '{{form.employee}}' } } },
    { id: 'save', type: 'update_data_table', label: 'Save expense', position: { x: 0, y: 400 }, config: { table_id: TABLE, table_name: 'Expenses', operation: 'insert', column_values: { description: '{{item.description}}', amount: '{{item.amount}}', employee: '{{form.employee}}', line: '{{index}}', total: '{{form.expenses_total_amount}}' } } },
  ]
  const edges = [
    { id: 'e1', source: 'trigger', target: 'each' },
    { id: 'e2', source: 'each', target: 'stops', label: 'Each Item' },
    { id: 'e3', source: 'stops', target: 'save_stop', label: 'Each Item' },
    { id: 'e4', source: 'stops', target: 'save', label: 'Done' },
  ]
  return { nodes, edges }
}

describe('workflows', () => {
  it('the data picker offers the items\' fields, the nested section, the count and totals', () => {
    const schema = fieldSchema(FIELDS[1])
    expect(schema.type).toBe('array')
    expect(schema.items?.fields?.map((f) => f.name)).toEqual(['description', 'category', 'amount', 'spent_on', 'receipts', 'stops', 'stops_count', 'stops_total_nights'])
    const { nodes, edges } = graph()
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'save' } as any)
    const form = groups.find((g) => g.kind === 'form')!
    expect(form.roots.map((r) => r.path)).toEqual(expect.arrayContaining(['form.expenses', 'form.expenses_count', 'form.expenses_total_amount']))
    expect(validateWorkflowWiring({ nodes, edges } as any)).toEqual([])
  })

  describe('engine', () => {
    beforeEach(() => {
      createClientMock.mockReset()
      createClientMock.mockImplementation(() => { throw new Error('engine must reuse the caller\'s client') })
      process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test'
      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network is disabled in this test') }))
    })
    afterEach(() => { vi.unstubAllGlobals() })

    it('a Loop over {{form.expenses}} saves each item to a table (and a nested Loop each stop with parent_item)', async () => {
      const { nodes, edges } = graph()
      const col = (key: string, type = 'text') => ({ id: `c_${key}`, key, name: key, type, required: false })
      const fake = createFakeSupabase({
        workflows: [{ id: WF, tenant_id: TENANT, name: 'Claims', trigger_type: 'form_submitted', nodes, edges, user_variables: [], run_count: 0, published_version_id: null }],
        custom_tables: [{ id: TABLE, tenant_id: TENANT, name: 'Expenses', columns: [col('description'), col('amount', 'number'), col('employee'), col('line', 'number'), col('total', 'number')] }],
        custom_table_rows: [],
      })
      fake.rpcs.record_workflow_run = () => ({})
      fake.rpcs.enqueue_workflow = () => ({ data: crypto.randomUUID() })
      const payload = buildFormSubmittedPayload({ form: { id: FORM, name: 'Claim', version: 1 }, fields: FIELDS, values: { employee: 'Ada Lovelace', expenses: ITEMS }, submission: { id: 's1', created_at: '2026-11-11T00:00:00Z', source: 'standalone' }, submitter: { id: null } } as any)
      expect(payload.form).toMatchObject({ expenses_count: 2, expenses_total_amount: 481 })
      expect((payload.form as any).expenses[0]).toMatchObject({ description: 'Flight', amount: 412.6, stops_count: 2, stops_total_nights: 3 })
      const result = await executeWorkflow(WF, undefined, false, payload, undefined, undefined, undefined, { supabase: fake.client, initiator: { userId: null, via: 'test' } })
      const run = fake.tables.workflow_runs.find((r) => r.id === result.run_id) as any
      expect(result.status, run?.error).toBe('completed')
      const rows = (fake.tables.custom_table_rows as any[]).map((r) => r.data)
      expect(rows.map((r) => [r.description, Number(r.amount), r.employee])).toEqual([
        ['Flight / New York', 2, 'Ada Lovelace'], ['Flight / Boston', 1, 'Ada Lovelace'], ['Flight', 412.6, 'Ada Lovelace'],
        ['Dinner', 68.4, 'Ada Lovelace'],
      ])
      expect(rows.filter((r) => r.line !== undefined && r.line !== null && r.line !== '').map((r) => Number(r.line))).toEqual([0, 1])
      expect(Number(rows[2].total)).toBe(481)
    }, 30_000)
  })
})
