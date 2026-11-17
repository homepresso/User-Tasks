/**
 * Data binding (lib/forms/data-binding.ts, lib/forms/data-binding-sources.ts,
 * lib/services/form-sources.ts): the layout.data_binding model and its
 * managed rules, source fields of tables and references (type mapping),
 * creating bound fields (drag / add), the save / load mapping, and the one
 * describe / bind path for core sources and extension targets.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindingCapabilities, bindingRules, BINDING_RULE_IDS, layoutDataBinding, normalizeDataBinding, renameBindingKey, type FormDataBinding } from '@/lib/forms/data-binding'
import { bindCoreBinding, DataBindingError, describeCoreBinding, fieldForSource, humanizeSourceKey, referenceSource, tableSource } from '@/lib/forms/data-binding-sources'
import { compactLayoutForSave, normalizeFormLayout, removeFieldFromLayout, renameLayoutKey, type FormLayout } from '@/lib/forms/layout'
import { addBoundFields, definitionFrom, designerRuleProblems, designerStateFrom, removeField, updateField, withSourceBinding } from '@/lib/forms/designer-state'
import { findServerRuleAction, normalizeFormRules } from '@/lib/forms/form-rules'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { bindFormSource, describeFormSource, formSourceDeps } from '@/lib/services/form-sources'
import { formTargetDeps } from '@/lib/services/form-targets'
import type { ServiceContext } from '@/lib/services/context'
import type { FormTarget } from '@/lib/extensions/sdk'
import type { TaskFieldDef } from '@/lib/task-field-schema'

const TABLE = '0f000000-0000-4000-8000-00000000d001'
const LOOKUP_TABLE = '0f000000-0000-4000-8000-00000000d002'
const REF = '0f000000-0000-4000-8000-00000000e001'
const INTEGRATION = '0f000000-0000-4000-8000-00000000e002'

const table = {
  id: TABLE,
  name: 'Customers',
  columns: [
    { id: 'c0', key: 'id', name: 'ID', type: 'number' },
    { id: 'c00', key: 'date_created', name: 'Date Created', type: 'date' },
    { id: 'c1', key: 'name', name: 'Name', type: 'text', required: true },
    { id: 'c2', key: 'notes', name: 'Notes', type: 'longtext' },
    { id: 'c3', key: 'credit', name: 'Credit limit', type: 'number' },
    { id: 'c4', key: 'since', name: 'Customer since', type: 'date' },
    { id: 'c5', key: 'active', name: 'Active', type: 'boolean' },
    { id: 'c6', key: 'tier', name: 'Tier', type: 'select', options: ['Gold', 'Silver'] },
    { id: 'c7', key: 'region', name: 'Region', type: 'lookup', lookup: { sourceTableId: LOOKUP_TABLE, sourceTableName: 'Regions', sourceColumn: 'code' } },
    { id: 'c8', key: 'contract', name: 'Contract', type: 'file' },
    { id: 'c9', name: 'Account Manager', type: 'text' },
  ],
}

const reference = {
  id: REF,
  name: 'Get customer',
  integration: { id: INTEGRATION, name: 'CRM' },
  request_config: {
    response_schema: {
      version: 1, source: 'sample',
      root: { type: 'object', fields: [
        { name: 'name', type: 'string', example: 'Acme' },
        { name: 'email', type: 'string', example: 'ap@acme.test' },
        { name: 'balance', type: 'number', example: 1200 },
        { name: 'vip', type: 'boolean' },
        { name: 'created_on', type: 'string', example: '2026-01-02' },
        { name: 'address', type: 'object', fields: [{ name: 'city', type: 'string', example: 'Denver' }] },
        { name: 'tags', type: 'array', items: { type: 'string' } },
      ] },
    },
  },
}

const tableBinding = (over: Partial<FormDataBinding> = {}): FormDataBinding => ({ kind: 'table', source_id: TABLE, label: 'Customers', fields: {}, ...over })

describe('the binding model (layout.data_binding)', () => {
  it('normalizes a stored binding and drops anything malformed', () => {
    expect(normalizeDataBinding({ kind: 'table', source_id: TABLE, fields: { name: 'name', 'Bad Key': 'x', credit: 'credit; drop' }, record_param: 'row_id', save: true, inputs: { a: 'b' } }))
      .toEqual({ kind: 'table', source_id: TABLE, fields: { name: 'name' }, record_param: 'row_id', save: true })
    expect(normalizeDataBinding({ kind: 'reference', source_id: REF, integration_id: INTEGRATION, fields: { email: 'data.email' }, inputs: { id: '{{param.customer_id}}', '': 'x' }, save: true }))
      .toEqual({ kind: 'reference', source_id: REF, integration_id: INTEGRATION, fields: { email: 'data.email' }, inputs: { id: '{{param.customer_id}}' } })
    expect(normalizeDataBinding({ kind: 'sql', source_id: TABLE })).toBeUndefined()
    expect(normalizeDataBinding({ kind: 'table', source_id: 'not-a-uuid' })).toBeUndefined()
    // Known keys only (a field the form no longer has loses its mapping).
    expect(normalizeDataBinding({ kind: 'table', source_id: TABLE, fields: { name: 'name', gone: 'credit' } }, ['name'])?.fields).toEqual({ name: 'name' })
  })

  it('an extension target wins: a form with data_target has no core binding', () => {
    expect(layoutDataBinding({ data_target: { extension: 'x', key: 'list', config: {} }, data_binding: tableBinding() })).toBeUndefined()
    const layout = normalizeFormLayout({ rows: [], data_target: { extension: 'sharepoint', key: 'list', config: {} }, data_binding: tableBinding({ fields: { a: 'name' } }) }, ['a'])
    expect(layout?.data_target).toBeTruthy()
    expect(layout?.data_binding).toBeUndefined()
  })

  it('existing forms are unchanged (no binding, no managed rules)', () => {
    const layout = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'a', span: 1 }] }] }, ['a'])
    expect(layout).toEqual({ rows: [{ columns: 1, cells: [{ field_key: 'a', span: 1 }] }] })
    expect(compactLayoutForSave(layout as FormLayout, ['a'])).toBeNull()
  })

  it('survives normalisation and compact saves; renames and removals follow the field', () => {
    const raw = { rows: [{ columns: 1, cells: [{ field_key: 'customer', span: 1 }] }, { columns: 1, cells: [{ field_key: 'limit', span: 1 }] }], data_binding: tableBinding({ fields: { customer: 'name', limit: 'credit' } }) }
    const layout = normalizeFormLayout(raw, ['customer', 'limit'])!
    expect(layout.data_binding?.fields).toEqual({ customer: 'name', limit: 'credit' })
    expect(compactLayoutForSave(layout, ['customer', 'limit'])?.data_binding?.fields).toEqual({ customer: 'name', limit: 'credit' })
    expect(renameLayoutKey(layout, 'customer', 'customer_name').data_binding?.fields).toEqual({ customer_name: 'name', limit: 'credit' })
    expect(removeFieldFromLayout(layout, 'limit').data_binding?.fields).toEqual({ customer: 'name' })
    expect(renameBindingKey(layout.data_binding!, 'x', 'y')).toBe(layout.data_binding)
  })
})

describe('managed rules: the runtime is the existing rule actions', () => {
  it('a table with a row parameter and saving: load, update and create rules', () => {
    const rules = bindingRules(tableBinding({ fields: { customer: 'name', limit: 'credit', rid: 'row_id' }, record_param: 'row_id', save: true }), { params: ['row_id'] })
    expect(rules.map((r) => r.id)).toEqual([BINDING_RULE_IDS.load, BINDING_RULE_IDS.update, BINDING_RULE_IDS.create])
    const [load, update, create] = rules
    expect(load).toMatchObject({ event: 'form_load', if: { conditions: [{ column: 'param.row_id', operator: 'is_set' }] } })
    expect(load.then[0]).toMatchObject({ type: 'table_read', table_id: TABLE, row_id: '{{param.row_id}}', outputs: [{ path: 'name', to: 'customer' }, { path: 'credit', to: 'limit' }, { path: 'row_id', to: 'rid' }] })
    // The row id is never written; values come from the bound fields.
    expect(update.then[0]).toMatchObject({ type: 'table_update', row_id: '{{param.row_id}}', column_values: { name: '{{customer}}', credit: '{{limit}}' } })
    expect(update).toMatchObject({ event: 'before_submit' })
    expect(create).toMatchObject({ event: 'before_submit', if: { conditions: [{ column: 'param.row_id', operator: 'is_not_set' }] } })
    expect(create.then[0]).toMatchObject({ type: 'table_create', column_values: { name: '{{customer}}', credit: '{{limit}}' } })
  })

  it('a table without saving is read only; without a declared row parameter nothing loads', () => {
    expect(bindingRules(tableBinding({ fields: { customer: 'name' }, record_param: 'row_id' }), { params: ['row_id'] }).map((r) => r.id)).toEqual([BINDING_RULE_IDS.load])
    expect(bindingRules(tableBinding({ fields: { customer: 'name' }, record_param: 'row_id' }), { params: [] })).toEqual([])
    expect(bindingRules(tableBinding({ fields: { customer: 'name' }, save: true }), { params: [] }).map((r) => r.then[0].type)).toEqual(['table_create'])
    expect(bindingRules(tableBinding(), { params: [] })).toEqual([])
  })

  it('a reference loads on open (guarded by the parameters its inputs read) and never saves', () => {
    const [load, ...rest] = bindingRules({ kind: 'reference', source_id: REF, integration_id: INTEGRATION, fields: { email: 'email', city: 'address.city' }, inputs: { id: '{{param.customer_id}}' } }, { params: ['customer_id'] })
    expect(rest).toEqual([])
    expect(load).toMatchObject({ event: 'form_load', if: { conditions: [{ column: 'param.customer_id', operator: 'is_set' }] } })
    expect(load.then[0]).toMatchObject({ type: 'call_reference', reference_id: REF, integration_id: INTEGRATION, inputs: { id: '{{param.customer_id}}' }, outputs: [{ path: 'email', to: 'email' }, { path: 'address.city', to: 'city' }], on_error: 'ignore' })
    expect(bindingCapabilities({ kind: 'reference' }).writable).toBe(false)
  })

  it('managed rules are regenerated on every normalisation, after the hand-made ones, and the server finds them in the saved form', () => {
    const def = normalizeFormDefinition({
      fields: [{ key: 'customer', label: 'Customer', type: 'text' }, { key: 'limit', label: 'Limit', type: 'number' }],
      layout: {
        rows: [{ columns: 1, cells: [{ field_key: 'customer', span: 1 }] }, { columns: 1, cells: [{ field_key: 'limit', span: 1 }] }],
        params: [{ name: 'row_id', type: 'text', source: 'url', query_name: 'row' }],
        rules: [
          { id: 'mine', event: 'form_load', then: [{ type: 'message', text: 'Hi' }] },
          // A stale managed rule (hand-edited) is replaced.
          { id: BINDING_RULE_IDS.load, event: 'form_load', then: [{ type: 'message', text: 'stale' }] },
        ],
        data_binding: tableBinding({ fields: { customer: 'name', limit: 'credit' }, record_param: 'row_id', save: true }),
      },
    } as any)
    const ids = (def.layout?.rules ?? []).map((r) => r.id)
    expect(ids).toEqual(['mine', BINDING_RULE_IDS.load, BINDING_RULE_IDS.update, BINDING_RULE_IDS.create])
    expect(normalizeFormRules(def.layout?.rules)).toEqual(def.layout?.rules)
    expect(findServerRuleAction(def.layout, BINDING_RULE_IDS.load, 0)?.action).toMatchObject({ type: 'table_read', table_id: TABLE })
    expect(findServerRuleAction(def.layout, BINDING_RULE_IDS.create, 0)?.action).toMatchObject({ type: 'table_create' })
    // The rules pass the designer's own rule checks.
    const state = designerStateFrom(def)
    expect(designerRuleProblems({ ...state, layout: def.layout! })).toEqual({})
  })

  it('the designer edits the binding, not its rules: they are stripped on open and regenerated on save', () => {
    const def = normalizeFormDefinition({
      fields: [{ key: 'customer', label: 'Customer', type: 'text' }],
      layout: { rows: [{ columns: 1, cells: [{ field_key: 'customer', span: 1 }] }], params: [{ name: 'row_id', type: 'text', source: 'url' }], data_binding: tableBinding({ fields: { customer: 'name' }, record_param: 'row_id' }) },
    } as any)
    const state = designerStateFrom(def)
    expect(state.layout.rules ?? []).toEqual([])
    expect(definitionFrom(state).layout?.rules?.map((r) => r.id)).toEqual([BINDING_RULE_IDS.load])
    // Renaming a bound field's key carries the mapping (and the regenerated rule) along.
    const renamed = updateField(state, state.fields[0]._id, { key: 'client' })
    expect(renamed.layout.data_binding?.fields).toEqual({ client: 'name' })
    expect(definitionFrom(renamed).layout?.rules?.[0].then[0].outputs).toEqual([{ path: 'name', to: 'client' }])
    // Removing it drops the mapping: no rule writes a field that is gone.
    const removed = removeField(state, state.fields[0]._id)
    expect(removed.layout.data_binding?.fields).toEqual({})
    expect(definitionFrom(removed).layout?.rules ?? []).toEqual([])
  })
})

describe('source fields: type mapping', () => {
  it('a data table: columns, lookups and the row id, each with the field types that can hold it', () => {
    const source = tableSource(table)
    const by = Object.fromEntries(source.fields.map((f) => [f.key, f]))
    expect(by.name).toMatchObject({ label: 'Name', fieldTypes: ['text', 'textarea', 'email', 'phone', 'url'], required: true, group: 'columns' })
    expect(by.notes.fieldTypes[0]).toBe('textarea')
    expect(by.credit.fieldTypes).toEqual(['number', 'currency'])
    expect(by.since.fieldTypes[0]).toBe('date')
    expect(by.active.fieldTypes).toEqual(['boolean'])
    expect(by.tier).toMatchObject({ fieldTypes: ['choice', 'text'], choices: ['Gold', 'Silver'] })
    expect(by.region).toMatchObject({ fieldTypes: ['lookup', 'text'], lookup: 'Regions', group: 'lookups' })
    expect(by.contract.fieldTypes).toEqual([])
    // A column made before keys existed: its slug.
    expect(by.account_manager.label).toBe('Account Manager')
    expect(by.row_id).toMatchObject({ readOnly: true, group: 'system' })
    // The table's own auto-number and creation date: system, read only.
    expect(by.id).toMatchObject({ readOnly: true, group: 'system', fieldTypes: ['number', 'text'] })
    expect(by.date_created).toMatchObject({ readOnly: true, group: 'system' })
    expect(source.templates.region).toEqual({ lookup: { source: 'table', table_id: LOOKUP_TABLE, search_columns: ['code'], display_columns: ['code'], value_column: 'code' } })
  })

  it('an API reference: its response model (fields, nested fields, lists), typed from formats, names and examples', () => {
    const source = referenceSource(reference)
    const by = Object.fromEntries(source.fields.map((f) => [f.key, f]))
    expect(source.title).toBe('API reference "Get customer" (CRM)')
    expect(by.name.fieldTypes[0]).toBe('text')
    expect(by.email.fieldTypes[0]).toBe('email')
    expect(by.balance.fieldTypes[0]).toBe('number')
    expect(by.vip.fieldTypes[0]).toBe('boolean')
    expect(by.created_on).toMatchObject({ typeLabel: 'Date', fieldTypes: ['date', 'text'] })
    expect(by.address.fieldTypes).toEqual([])
    expect(by['address.city']).toMatchObject({ label: 'Address city', group: 'nested', fieldTypes: ['text', 'textarea'] })
    expect(by.tags).toMatchObject({ fieldTypes: ['text_list'], multi: true })
    expect(humanizeSourceKey('data.customerName')).toBe('Data customer name')
  })

  it('a field for a source field: the suggested type, labelled, required / read-only / choices / lookup carried over', () => {
    const source = tableSource(table)
    const by = Object.fromEntries(source.fields.map((f) => [f.key, f]))
    expect(fieldForSource(by.name, [])).toEqual({ key: 'name', label: 'Name', type: 'text', required: true })
    expect(fieldForSource(by.tier, ['tier'])).toEqual({ key: 'tier_2', label: 'Tier', type: 'choice', options: ['Gold', 'Silver'] })
    expect(fieldForSource(by.credit, [], { type: 'currency' })).toMatchObject({ type: 'currency', currency: 'USD' })
    expect(fieldForSource(by.credit, [], { type: 'boolean' })?.type).toBe('number')
    expect(fieldForSource(by.row_id, [])).toMatchObject({ type: 'text', read_only: true })
    expect(fieldForSource(by.region, [], { template: source.templates.region })?.lookup).toMatchObject({ table_id: LOOKUP_TABLE, value_column: 'code' })
    expect(fieldForSource(by.contract, [])).toBeNull()
  })
})

describe('bind (core sources): drag / add creates a bound field; Bound to changes or clears', () => {
  const source = tableSource(table)

  it('adds bound fields with unique keys, skipping source fields already on the form and those that cannot be bound', () => {
    const out = bindCoreBinding(tableBinding({ fields: { name: 'name' } }), source, [{ key: 'name', type: 'text' }], { add: ['name', 'tier', 'credit', 'contract', 'nope'] })
    expect(out.fields.map((f) => [f.key, f.type])).toEqual([['tier', 'choice'], ['credit_limit', 'number']])
    expect(out.binding.fields).toEqual({ name: 'name', tier: 'tier', credit_limit: 'credit' })
  })

  it('maps, re-maps and clears; a source field the field type cannot hold is refused per field', () => {
    const fields = [{ key: 'who', type: 'text' as const }, { key: 'amount', type: 'number' as const }]
    let b = bindCoreBinding(tableBinding(), source, fields, { mappings: [{ field: 'who', source: 'name' }, { field: 'amount', source: 'credit' }] }).binding
    expect(b.fields).toEqual({ who: 'name', amount: 'credit' })
    b = bindCoreBinding(b, source, fields, { mappings: [{ field: 'who', source: null }] }).binding
    expect(b.fields).toEqual({ amount: 'credit' })
    expect(() => bindCoreBinding(b, source, fields, { mappings: [{ field: 'amount', source: 'active' }] })).toThrow(DataBindingError)
    try { bindCoreBinding(b, source, fields, { mappings: [{ field: 'amount', source: 'nope' }] }) } catch (e) { expect((e as DataBindingError).fields).toHaveProperty('amount') }
  })

  it('describe: the mapping, plain facts and notes (read only, required columns missing, gone columns)', () => {
    const d = describeCoreBinding(tableBinding({ fields: { amount: 'credit', old: 'removed' }, save: true }), source, [{ key: 'amount', label: 'Amount', type: 'number' }, { key: 'old', label: 'Old', type: 'text' }, { key: 'free', label: 'Free', type: 'text' }])
    expect(d.mappings).toEqual([{ field: 'amount', source: 'credit' }, { field: 'old', source: 'removed', note: '"removed" is no longer in the source' }, { field: 'free', source: null }])
    expect(d.notes?.map((n) => n.message).join(' ')).toMatch(/requires "Name"/)
    expect(d.notes?.map((n) => n.message).join(' ')).toMatch(/"Old" is bound to "removed"/)
    expect(d.facts?.find((f) => f.label === 'Saves')?.value).toMatch(/new row is added/)
    const r = describeCoreBinding({ kind: 'reference', source_id: REF, fields: {} }, referenceSource(reference), [])
    expect(r.notes?.some((n) => /Read only/.test(n.message))).toBe(true)
  })
})

describe('the designer: bound fields placed where they were dropped', () => {
  const base = designerStateFrom({ fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'text' }], layout: { rows: [{ columns: 2, cells: [{ field_key: 'a', span: 1 }, { field_key: 'b', span: 1 }] }] }, theme: { source: 'workspace' } } as any)
  const bound: TaskFieldDef[] = [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'a', label: 'Credit', type: 'number' }]

  it('the first at the drop position (a full row: a new row after it), the others in new rows after it; keys made unique', () => {
    const r = addBoundFields(base, bound, { at: { row: 0, index: 1 } })
    expect(r.renamed).toEqual({ a: 'a_2' })
    expect(r.state.layout.rows.map((row) => row.cells.map((c) => c.field_key))).toEqual([['a', 'b'], ['name'], ['a_2']])
    expect(r.fields.every((f) => f._id && f._keyLocked)).toBe(true)
  })

  it('at the end without a position, into a section when dropped on one', () => {
    expect(addBoundFields(base, bound.slice(0, 1)).state.layout.rows.map((row) => row.cells.map((c) => c.field_key))).toEqual([['a', 'b'], ['name']])
    const withSection = { ...base, layout: { ...base.layout, rows: [...base.layout.rows, { columns: 1, cells: [], section: 'details' }], sections: [{ key: 'details', title: 'Details' }] } } as any
    const r = addBoundFields(withSection, bound.slice(0, 1), { section: 'details' })
    expect(r.state.layout.rows.find((row) => row.cells.some((c) => c.field_key === 'name'))?.section).toBe('details')
  })

  it('withSourceBinding takes only the binding from a bind result (the designer keeps the rest of its layout)', () => {
    const next = withSourceBinding(base, { rows: [], data_binding: tableBinding({ fields: { a: 'name' } }) })
    expect(next.layout.rows).toBe(base.layout.rows)
    expect(next.layout.data_binding?.fields).toEqual({ a: 'name' })
  })
})

describe('describe / bind service: one path for core sources and extension targets', () => {
  const ctx = { tenantId: 't1', actorId: 'u1', permissions: new Set(['forms.edit', 'forms.view', 'integrations.view']), db: {} as any, supabase: {} as any, authKind: 'session', source: 'ui' } as unknown as ServiceContext
  afterEach(() => { vi.restoreAllMocks() })

  it('a data table form: described from the table, bound in core', async () => {
    vi.spyOn(formSourceDeps, 'table').mockResolvedValue(table)
    const form = { id: null, name: 'New', version: null, fields: [{ key: 'customer', label: 'Customer', type: 'text' as const }], layout: { rows: [], data_binding: tableBinding({ fields: { customer: 'name' } }) } }
    const state = await describeFormSource(ctx, form)
    expect(state).toMatchObject({ kind: 'table', label: 'Customers', bind: true, locked: false, writable: false })
    expect(state.description?.mappings).toEqual([{ field: 'customer', source: 'name' }])
    const bound = await bindFormSource(ctx, form, { add: ['credit'] })
    expect(bound.fields).toEqual([{ key: 'credit_limit', label: 'Credit limit', type: 'number' }])
    expect((bound.layout.data_binding as FormDataBinding).fields).toEqual({ customer: 'name', credit_limit: 'credit' })
    await expect(bindFormSource(ctx, form, { mappings: [{ field: 'customer', source: 'active' }] })).rejects.toMatchObject({ code: 'validation_error' })
  })

  it('a reference form needs integrations.view; a missing source is a clear error', async () => {
    const noIntegrations = { ...ctx, permissions: new Set(['forms.view']) } as unknown as ServiceContext
    const form = { id: null, name: 'New', version: null, fields: [], layout: { rows: [], data_binding: { kind: 'reference', source_id: REF, fields: {} } } }
    await expect(describeFormSource(noIntegrations, form)).rejects.toMatchObject({ code: 'forbidden' })
    vi.spyOn(formSourceDeps, 'reference').mockResolvedValue(null)
    await expect(describeFormSource(ctx, form)).rejects.toThrow(/no longer exists/)
  })

  it('an unbound form: nothing to describe, nothing to bind', async () => {
    const form = { id: null, name: 'New', version: null, fields: [], layout: { rows: [] } }
    expect(await describeFormSource(ctx, form)).toMatchObject({ kind: 'none', description: null })
    await expect(bindFormSource(ctx, form, { add: ['x'] })).rejects.toThrow(/no data source/)
  })

  it('an extension target (e.g. a SharePoint list, mocked here): its provider describes and binds, locked to that source', async () => {
    const binds: any[] = []
    const provider: FormTarget = {
      label: 'Mock list',
      submit: async () => ({ record: { id: '1' } }),
      identity: (config) => String(config.list_id),
      describe: async ({ form }) => ({
        title: 'Mock list "Requests"',
        sourceFields: [
          { key: 'Title', label: 'Title', typeLabel: 'Single line of text', fieldTypes: ['text'], required: true, group: 'columns' },
          { key: 'Budget', label: 'Budget', typeLabel: 'Currency', fieldTypes: ['currency', 'number'], group: 'columns', isNew: true },
          { key: 'Created', label: 'Created', typeLabel: 'Date and time', fieldTypes: ['datetime'], readOnly: true, group: 'system' },
        ],
        mappings: form.fields.map((f) => ({ field: f.key, source: String(form.config.fields ?? '').split(',').find((e) => e.startsWith(`${f.key}|`))?.split('|')[1] ?? null })),
      }),
      bind: async ({ form, add }) => {
        binds.push(add)
        const entries = String(form.config.fields ?? '').split(',').filter(Boolean)
        const fields = (add ?? []).map((s) => ({ key: s.toLowerCase(), label: s, type: 'currency' as const }))
        return { config: { ...form.config, fields: [...entries, ...fields.map((f, i) => `${f.key}|${add![i]}`)].join(',') }, fields }
      },
    }
    vi.spyOn(formTargetDeps, 'provider').mockResolvedValue(provider)
    vi.spyOn(formTargetDeps, 'assertAccess').mockResolvedValue()
    vi.spyOn(formTargetDeps, 'serviceDb').mockResolvedValue({} as any)
    vi.spyOn(formTargetDeps, 'context').mockResolvedValue({} as any)
    const form = { id: null, name: 'Requests', version: 1, fields: [{ key: 'title', label: 'Title', type: 'text' as const }], layout: { rows: [], data_target: { extension: 'mock', key: 'list', config: { list_id: 'L1', fields: 'title|Title' } } } }
    const state = await describeFormSource(ctx, form)
    expect(state).toMatchObject({ kind: 'target', locked: true, writable: true, bind: true })
    expect(state.description?.sourceFields.find((f) => f.key === 'Budget')).toMatchObject({ isNew: true, group: 'columns' })
    expect(state.description?.mappings).toEqual([{ field: 'title', source: 'Title' }])
    const bound = await bindFormSource(ctx, form, { add: ['Budget'] })
    expect(binds).toEqual([['Budget']])
    expect(bound.fields).toEqual([{ key: 'budget', label: 'Budget', type: 'currency' }])
    // Same identity (same list): an update of the binding, never an unbind.
    expect((bound.layout.data_target as any).config).toEqual({ list_id: 'L1', fields: 'title|Title,budget|Budget' })
  })
})
