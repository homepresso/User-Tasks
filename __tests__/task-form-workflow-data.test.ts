import { describe, expect, it, vi } from 'vitest'

// An extension trigger that declares its record (as the SharePoint trigger does): `after` holds the item's columns.
vi.mock('@/lib/extensions/nodes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/extensions/nodes')>()
  const entry = {
    type: 'ext.sp.item_changed', label: 'Item changed', icon: 'Zap', category: 'trigger', color: '#22C55E', description: '', extensionId: 'sp', extensionName: 'SP', key: 'item_changed',
    inputs: [], outputs: [
      { name: 'item_id', type: 'integer', label: 'Item id' },
      { name: 'after', type: 'object', label: 'Values after' },
      { name: 'before', type: 'object', label: 'Values before' },
      { name: 'list_title', type: 'string', label: 'List title' },
    ],
    record: { variable: 'after', fieldsFrom: 'record_fields', label: 'List item', idFrom: ['list_id', 'item_id'] },
  }
  return { ...actual, extensionCatalogEntry: (type: string) => (type === entry.type ? entry : actual.extensionCatalogEntry(type)) }
})

import {
  allowedModes, bulkPrefillPlan, defaultMode, fieldBinding, fieldFromEntry, groupWorkflowData, matchName, modePatch, normalizeRecordFields, previewSamples,
  recordFieldControl, schemaControl, singleTokenPath, taskFieldControl, triggerRecordFor, withSaveTargetValue, workflowDataScope, type RecordField, type WorkflowDataEntry,
} from '@/lib/forms/workflow-data'
import { openingFieldDefaults } from '@/lib/forms/preview-inputs'
import type { TaskFieldDef } from '@/lib/task-field-schema'

const n = (id: string, type: string, label: string, config: Record<string, unknown> = {}) => ({ id, type, label, config })
const e = (source: string, target: string) => ({ id: `${source}-${target}`, source, target })

const SP_FIELDS: RecordField[] = normalizeRecordFields({ fields: [
  { key: 'Title', label: 'Title', typeLabel: 'Single line of text', fieldTypes: ['text', 'textarea'], required: true, group: 'columns' },
  { key: 'Notes', label: 'Notes', typeLabel: 'Multiple lines of text', fieldTypes: ['textarea', 'rich_text'], group: 'columns' },
  { key: 'Amount', label: 'Amount', typeLabel: 'Currency', fieldTypes: ['currency', 'number'], group: 'columns' },
  { key: 'Qty', label: 'Quantity', typeLabel: 'Number', fieldTypes: ['number'], group: 'columns' },
  { key: 'Due', label: 'Due date', typeLabel: 'Date', fieldTypes: ['date', 'datetime'], group: 'columns' },
  { key: 'Owner', label: 'Owner', typeLabel: 'Person or group', fieldTypes: ['user', 'text'], group: 'columns' },
  { key: 'Status', label: 'Status', typeLabel: 'Choice', fieldTypes: ['choice', 'text'], choices: ['New', 'Approved'], group: 'columns' },
  { key: 'Paid', label: 'Paid', typeLabel: 'Yes/No', fieldTypes: ['boolean'], group: 'columns' },
  { key: 'Dept', label: 'Department', typeLabel: 'Lookup', fieldTypes: ['choice', 'lookup'], group: 'lookups', valuePath: 'value', lookupSource: { extension: 'sp', provider: 'list', source: 'lookup:L1:Dept', value_field: 'id', label_field: 'Title' } },
  { key: 'Region', label: 'Region', typeLabel: 'Lookup', fieldTypes: ['choice'], group: 'lookups', valuePath: 'value' },
  { key: 'Created', label: 'Created', typeLabel: 'Date and time', fieldTypes: ['datetime'], readOnly: true, group: 'system' },
  { key: 'Attachments', label: 'Attachments', typeLabel: 'Attachments', fieldTypes: [], group: 'columns' },
  { key: 'Site_x0020_Code', label: 'Site Code', typeLabel: 'Single line of text', fieldTypes: ['text'], group: 'columns' },
  { key: 'api_token', label: 'API token', typeLabel: 'Single line of text', fieldTypes: ['text'] },
] })

function spWorkflow() {
  const nodes = [
    n('t', 'ext.sp.item_changed', 'Item changed', { list: 'L1' }),
    n('lk', 'http_request', 'Get customer', { _response_schema: { version: 1, source: 'sample', root: { type: 'object', fields: [{ name: 'name', type: 'string' }, { name: 'email', type: 'string' }] } } }),
    n('sv', 'set_variable', 'Set threshold', { name: 'threshold', expression: '500' }),
    n('a', 'user_task', 'Manager approval', { outcomes: ['Approve', 'Reject'], fields: [
      { key: 'comments', label: 'Comments', type: 'textarea' },
      { key: 'risk', label: 'Risk', type: 'choice', options: ['Low', 'High'] },
      { key: 'evidence', label: 'Evidence', type: 'attachments' },
    ] }),
    n('b', 'user_task', 'Finance review', {}),
    n('c', 'send_email', 'Notify', {}),
  ]
  const edges = [e('t', 'lk'), e('lk', 'sv'), e('sv', 'a'), e('a', 'b'), e('b', 'c')]
  return { nodes, edges }
}

describe('workflowDataScope: what a task step can use', () => {
  it('groups the list item, start inputs, variables and earlier steps for the step', () => {
    const { nodes, edges } = spWorkflow()
    const scope = workflowDataScope({ nodes, edges, nodeId: 'b', workflowVariables: [{ name: 'cost_centre', type: 'string', label: 'Cost centre' }], recordFields: SP_FIELDS })
    expect(scope.record).toMatchObject({ kind: 'extension', variable: 'after', label: 'List item', idFrom: ['list_id', 'item_id'] })
    const by = (path: string) => scope.entries.find((x) => x.path === path)
    expect(by('after.Title')).toMatchObject({ group: 'list', column: 'Title', label: 'Title', token: '{{after.Title}}' })
    expect(by('after.Created')).toMatchObject({ group: 'list', system: true, readOnly: true })
    // The trigger's other run variables: system values of the list item; its before values are not offered.
    expect(by('list_title')).toMatchObject({ group: 'list', system: true, readOnly: true })
    expect(by('before')).toBeUndefined()
    expect(by('cost_centre')).toMatchObject({ group: 'start', label: 'Cost centre' })
    expect(by('threshold')).toMatchObject({ group: 'variables' })
    expect(by('task_data.comments')).toMatchObject({ group: 'steps', control: { type: 'textarea' } })
    expect(by('task_data.risk')?.control).toMatchObject({ type: 'choice', options: ['Low', 'High'] })
    expect(by('outcome')).toMatchObject({ group: 'steps' })
    // HTTP results are expanded to their fields.
    expect(by('get_customer_response.email')).toMatchObject({ group: 'steps', control: { type: 'email' } })
    expect(groupWorkflowData(scope.entries).map((g) => g.key)).toEqual(['list', 'start', 'variables', 'steps'])
  })

  it('is scoped per step: only what runs before it', () => {
    const { nodes, edges } = spWorkflow()
    const atA = workflowDataScope({ nodes, edges, nodeId: 'a', recordFields: SP_FIELDS })
    expect(atA.entries.some((x) => x.path === 'task_data.comments')).toBe(false)
    expect(atA.entries.some((x) => x.path === 'threshold')).toBe(true)
    const atLookup = workflowDataScope({ nodes, edges, nodeId: 'lk', recordFields: SP_FIELDS })
    expect(atLookup.entries.some((x) => x.path === 'threshold')).toBe(false)
    expect(atLookup.entries.some((x) => x.path === 'after.Title')).toBe(true)
  })

  it('never offers credential-shaped columns', () => {
    const { nodes, edges } = spWorkflow()
    const scope = workflowDataScope({ nodes, edges, nodeId: 'b', recordFields: SP_FIELDS })
    expect(scope.entries.some((x) => /api_token/.test(x.path))).toBe(false)
    expect(normalizeRecordFields({ fields: [{ key: 'client_secret', label: 'Secret' }, { key: 'Title', label: 'Title' }] }).map((f) => f.key)).toEqual(['Title'])
  })

  it('reads a data table trigger row as the list item', () => {
    const nodes = [n('t', 'data_table_event', 'Row added', { table_id: 'T1', _table_columns: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'amount', label: 'Amount', type: 'number' }, { key: 'state', label: 'State', type: 'choice', options: ['Open', 'Closed'] }] }), n('a', 'user_task', 'Review', {})]
    const scope = workflowDataScope({ nodes, edges: [e('t', 'a')], nodeId: 'a' })
    expect(scope.record).toMatchObject({ kind: 'table', variable: 'row' })
    expect(scope.entries.filter((x) => x.group === 'list').map((x) => [x.path, x.control.type])).toEqual([['row.name', 'text'], ['row.amount', 'number'], ['row.state', 'choice']])
    expect(triggerRecordFor(nodes, [e('t', 'a')], 't')).toBeNull()
  })

  it('without the columns (not loaded yet) still lists the other data', () => {
    const { nodes, edges } = spWorkflow()
    const scope = workflowDataScope({ nodes, edges, nodeId: 'b' })
    expect(scope.entries.some((x) => x.path.startsWith('after.'))).toBe(false)
    expect(scope.entries.some((x) => x.path === 'item_id')).toBe(true)
  })
})

describe('the control chosen on drop', () => {
  const ctl = (key: string) => recordFieldControl(SP_FIELDS.find((f) => f.key === key)!)
  it('maps each column type to its control', () => {
    expect(ctl('Title').type).toBe('text')
    expect(ctl('Notes').type).toBe('textarea')
    expect(ctl('Amount')).toMatchObject({ type: 'currency', currency: 'USD' })
    expect(ctl('Qty').type).toBe('number')
    expect(ctl('Due').type).toBe('date')
    expect(ctl('Owner').type).toBe('user')
    expect(ctl('Status')).toMatchObject({ type: 'choice', options: ['New', 'Approved'] })
    expect(ctl('Paid').type).toBe('boolean')
    expect(ctl('Created').type).toBe('datetime')
  })
  it('makes a lookup an Autocomplete bound to its list, or a read-only value without one', () => {
    expect(ctl('Dept')).toMatchObject({ type: 'lookup', lookup: { source: 'extension', extension: 'sp', provider: 'list', source_id: 'lookup:L1:Dept', value_column: 'id', display_columns: ['Title'] } })
    expect(ctl('Region')).toMatchObject({ type: 'text', displayOnly: true })
  })
  it('shows files and attachments read-only', () => {
    expect(ctl('Attachments')).toMatchObject({ type: 'label', displayOnly: true })
    expect(recordFieldControl({ key: 'FileLeafRef', label: 'Name', typeLabel: 'File' })).toMatchObject({ type: 'label', displayOnly: true })
  })
  it('a choice column without choices becomes text; filter-field types are understood', () => {
    expect(recordFieldControl({ key: 'x', label: 'X', type: 'choice' }).type).toBe('text')
    expect(recordFieldControl({ key: 'x', label: 'X', type: 'multichoice', choices: ['a', 'b'] })).toMatchObject({ type: 'multi_choice', options: ['a', 'b'] })
    expect(recordFieldControl({ key: 'x', label: 'X', type: 'user' }).type).toBe('user')
  })
  it('copies an earlier form field and types step outputs by their model', () => {
    expect(taskFieldControl({ key: 'c', label: 'C', type: 'currency', currency: 'EUR' })).toMatchObject({ type: 'currency', currency: 'EUR' })
    expect(taskFieldControl({ key: 'r', label: 'R', type: 'repeating_section' })).toBeNull()
    expect(schemaControl({ type: 'boolean' }, 'ok')?.type).toBe('boolean')
    expect(schemaControl({ type: 'string', format: 'date' }, 'x')?.type).toBe('date')
    expect(schemaControl({ type: 'object', fields: [] }, 'x')).toBeNull()
  })
})

describe('binding modes', () => {
  const entries = workflowDataScope({ ...spWorkflow(), nodeId: 'b', recordFields: SP_FIELDS }).entries
  const entry = (path: string) => entries.find((x) => x.path === path) as WorkflowDataEntry

  it('prefills list columns by default and creates a labelled field of the type', () => {
    expect(defaultMode(entry('after.Title'))).toBe('prefill')
    expect(fieldFromEntry(entry('after.Status'), 'prefill')).toEqual({ key: 'status', label: 'Status', type: 'choice', options: ['New', 'Approved'], default: '{{after.Status}}' })
  })
  it('shows read-only columns read-only and never prefills them editable', () => {
    expect(allowedModes(entry('after.Created'))).toEqual(['read_only', 'empty'])
    expect(fieldFromEntry(entry('after.Created'), 'prefill')).toMatchObject({ type: 'datetime', read_only: true, default: '{{after.Created}}' })
  })
  it('empty creates only the type and label', () => {
    expect(fieldFromEntry(entry('after.Amount'), 'empty')).toEqual({ key: 'amount', label: 'Amount', type: 'currency', currency: 'USD' })
  })
  it('reads the binding back from the field, and changes it', () => {
    const field = { key: 'title', label: 'Title', type: 'text' as const, default: '{{after.Title}}' }
    expect(fieldBinding(field, entries)).toMatchObject({ mode: 'prefill', entry: { path: 'after.Title' } })
    expect(fieldBinding({ ...field, read_only: true }, entries)?.mode).toBe('read_only')
    expect(fieldBinding({ ...field, default: 'Hello {{after.Title}}' }, entries)).toBeNull()
    expect(modePatch(field, entry('after.Title'), 'read_only')).toEqual({ default: '{{after.Title}}', read_only: true })
    expect(modePatch(field, null, 'empty')).toEqual({ default: undefined, read_only: undefined })
    expect(singleTokenPath(' {{ after.Title }} ')).toBe('after.Title')
  })
  it('previews sample values for bound tokens (WYSIWYG)', () => {
    const samples = previewSamples(entries)
    const values = openingFieldDefaults([{ key: 'amount', label: 'Amount', type: 'currency', default: '{{after.Amount}}' }, { key: 'other', label: 'Other', type: 'text', default: '{{unknown.x}}' }], null, samples)
    expect(values.amount).toBe(1250)
    expect(values.other).toBeNull()
  })
})

describe('Prefill all fields from list data', () => {
  const entries = workflowDataScope({ ...spWorkflow(), nodeId: 'b', recordFields: SP_FIELDS }).entries
  it('matches fields by key or label (case, spaces and SharePoint escapes ignored) and skips fields with a default or the wrong type', () => {
    const fields: TaskFieldDef[] = [
      { key: 'title', label: 'Request title', type: 'text' },
      { key: 'site_code', label: 'Code', type: 'text' },
      { key: 'due', label: 'Due Date', type: 'date' },
      { key: 'amount', label: 'Amount', type: 'text', default: 'fixed' },
      { key: 'paid', label: 'Paid', type: 'number' },
      { key: 'quantity', label: 'Qty', type: 'number' },
      { key: 'heading', label: 'Status', type: 'heading' },
    ]
    const plan = bulkPrefillPlan(fields, entries)
    expect(plan.map((p) => [p.fieldKey, p.entry.path])).toEqual([['title', 'after.Title'], ['site_code', 'after.Site_x0020_Code'], ['due', 'after.Due'], ['quantity', 'after.Qty']])
    expect(matchName('Site_x0020_Code')).toBe('sitecode')
  })
})

describe('saving back to the list (Save to … step)', () => {
  it('maps a prefilled field to its column on a save_target step, once', () => {
    const buttons = [{ id: 'save', actions: [{ type: 'save_target', values: { Status: 'Done' } }] }, { id: 'cancel', actions: [{ type: 'close' }] }]
    const out = withSaveTargetValue(buttons, 'Title', 'title')
    expect(out.changed).toBe(true)
    expect((out.buttons[0] as any).actions[0].values).toEqual({ Status: 'Done', Title: '{{form.title}}' })
    expect(withSaveTargetValue(out.buttons, 'Title', 'other').changed).toBe(false)
    expect(withSaveTargetValue([{ id: 'x', actions: [{ type: 'message' }] }], 'Title', 'title')).toMatchObject({ changed: false })
  })
})

describe('the form page opened from a step', () => {
  it('reads ?workflow=&step= and refuses anything else', async () => {
    const { stepFromQuery } = await import('@/lib/forms/designer-step')
    expect(stepFromQuery({ workflow: '11111111-1111-4111-8111-111111111111', step: 'node_1' })).toEqual({ workflowId: '11111111-1111-4111-8111-111111111111', stepId: 'node_1' })
    expect(stepFromQuery({ workflow: 'x', step: 'node_1' })).toBeNull()
    expect(stepFromQuery({ workflow: '11111111-1111-4111-8111-111111111111', step: '../x' })).toBeNull()
  })
})
