import { describe, expect, it } from 'vitest'
import {
  coerceTaskFieldValues, fieldDefinitionProblems, fieldKeyFromLabel, fieldKeyProblem, isFieldVisible, mergeTaskFieldValues,
  normalizeTaskFields, uniqueFieldKey, validateTaskFieldValues, defaultTaskFieldValues, RESERVED_FIELD_KEYS,
} from '@/lib/task-field-schema'
import {
  addRow, compactLayoutForSave, defaultFormLayout, findCell, layoutKeyOrder, moveRow, normalizeFormLayout, nudgeField, placeField,
  removeRow, renameLayoutKey, rowUsed, setCellSpan, setRowColumns, type FormLayout,
} from '@/lib/forms/layout'
import {
  addField, definitionFrom, designerProblems, designerStateFrom, duplicateField, keyRenames, removeField, updateField,
} from '@/lib/forms/designer-state'
import { historyReducer, initialHistory } from '@/lib/forms/history'
import { findFieldReferences, renameFieldReferences, renameFieldReferencesInText } from '@/lib/forms/references'
import { formDefinitionKey, nodeFormPatch, pinFormVersions, readNodeForm, readNodeFormLink, unpinFormVersions } from '@/lib/forms/definition'
import {
  autoFixFormTheme, blockingFormThemeIssues, colorsForMode, formThemeContrast, formThemeVars, overridesFromPreset, parseFormThemeRef,
  FormThemeOverridesSchema,
} from '@/lib/forms/form-theme'
import { buildDataTree } from '@/lib/workflow-data-picker'
import { contrastRatio } from '@/lib/theme/colors'
import { defaultWorkspaceTheme } from '@/lib/theme/presets'

const keys = (layout: FormLayout | null) => (layout ? layout.rows.map((r) => `${r.columns}:${r.cells.map((c) => `${c.field_key}/${c.span}`).join(',')}`) : null)

describe('field schema extension', () => {
  it('keeps the classic five types exactly as before', () => {
    const legacy = [
      { key: 'amount', label: 'Amount', type: 'number', required: true, default: '{{amount}}' },
      { key: 'cost_centre', label: 'Cost centre', type: 'choice', options: ['CC-100', 'CC-200'] },
      { key: 'comment', label: 'Comment', type: 'text', placeholder: 'Why' },
      { key: 'urgent', label: 'Urgent', type: 'boolean' },
      { key: 'due', label: 'Due', type: 'date' },
    ]
    expect(normalizeTaskFields(legacy)).toEqual(legacy)
  })

  it('normalizes the new types and drops properties that do not apply', () => {
    const [money, notes, tags, person, heading] = normalizeTaskFields([
      { key: 'total', label: 'Total', type: 'currency', currency: 'eur', min: '0', max: 5000, min_length: 3, pattern: 'x' },
      { key: 'notes', label: 'Notes', type: 'textarea', max_length: 500, pattern: '^[A-Z]', pattern_message: 'Start with a capital', min: 3 },
      { key: 'tags', label: 'Tags', type: 'multi_choice', options: [{ value: 'a', label: 'Alpha' }, 'b', 'a'], max: 2 },
      { key: 'owner', label: 'Owner', type: 'user', read_only: true, help_text: ' Who owns it ' },
      { key: 'section', label: 'Section', type: 'heading', required: true, help_text: 'Intro' },
    ])
    expect(money).toEqual({ key: 'total', label: 'Total', type: 'currency', min: 0, max: 5000, currency: 'EUR' })
    expect(notes).toEqual({ key: 'notes', label: 'Notes', type: 'textarea', max_length: 500, pattern: '^[A-Z]', pattern_message: 'Start with a capital' })
    expect(tags).toEqual({ key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'], option_labels: { a: 'Alpha' }, max: 2 })
    expect(person).toEqual({ key: 'owner', label: 'Owner', type: 'user', read_only: true, help_text: 'Who owns it' })
    expect(heading).toEqual({ key: 'section', label: 'Section', type: 'heading', help_text: 'Intro' })
  })

  it('drops reserved keys and self-referencing visible_when', () => {
    const fields = normalizeTaskFields([
      { key: 'outcome', label: 'Outcome', type: 'text' },
      { key: '__proto__', label: 'x' },
      { key: 'a', label: 'A', visible_when: { field: 'a', operator: 'is_set' } },
      { key: 'b', label: 'B', visible_when: { field: 'a', operator: 'equals', value: 'yes' } },
    ])
    // '__proto__' slugs to the harmless 'proto'.
    expect(fields.map((f) => f.key)).toEqual(['proto', 'a', 'b'])
    expect(fields[1].visible_when).toBeUndefined()
    expect(fields[2].visible_when).toEqual({ field: 'a', operator: 'equals', value: 'yes' })
  })

  it('flags definition problems (empty choices, unsafe pattern, min > max, unknown visible_when)', () => {
    const problems = fieldDefinitionProblems(normalizeTaskFields([
      { key: 'c', label: 'C', type: 'choice', options: [] },
      { key: 'p', label: 'P', type: 'text', pattern: '(a+)+$' },
      { key: 'n', label: 'N', type: 'number', min: 5, max: 1 },
      { key: 'v', label: 'V', type: 'text', visible_when: { field: 'missing', operator: 'is_set' } },
      { key: 'src', label: 'Src', type: 'choice', options: [], options_source: { table_id: 't1', column: 'name' } },
    ]))
    expect(Object.keys(problems).sort()).toEqual(['c', 'n', 'p', 'v'])
  })
})

describe('keys', () => {
  it('generates snake_case keys from labels', () => {
    expect(fieldKeyFromLabel('Employee Name')).toBe('employee_name')
    expect(fieldKeyFromLabel('  Cost (€) / centre #2 ')).toBe('cost_centre_2')
  })

  it('makes keys unique and avoids reserved names', () => {
    expect(uniqueFieldKey('Amount', ['amount', 'amount_2'])).toBe('amount_3')
    expect(uniqueFieldKey('Outcome', [])).toBe('outcome_field')
    expect(uniqueFieldKey('', [])).toBe('field')
    expect(uniqueFieldKey('2nd step', [])).toBe('2nd_step')
  })

  it('validates keys', () => {
    expect(fieldKeyProblem('')).toMatch(/required/)
    expect(fieldKeyProblem('Bad Key')).toMatch(/lowercase/)
    expect(fieldKeyProblem('task_data')).toMatch(/reserved/)
    expect(fieldKeyProblem('amount', ['amount'])).toMatch(/used by another/)
    expect(fieldKeyProblem('amount', ['other'])).toBeNull()
    expect(RESERVED_FIELD_KEYS.has('outcome')).toBe(true)
  })
})

describe('layout', () => {
  const fieldKeys = ['a', 'b', 'c', 'd']

  it('is null without a stored layout (classic rendering) and keeps every field', () => {
    expect(normalizeFormLayout(undefined, fieldKeys)).toBeNull()
    const layout = normalizeFormLayout({ rows: [{ columns: 2, cells: [{ field_key: 'b', span: 1 }, { field_key: 'zzz', span: 1 }, { field_key: 'b', span: 1 }] }] }, fieldKeys)
    expect(keys(layout)).toEqual(['2:b/1', '1:a/1', '1:c/1', '1:d/1'])
  })

  it('clamps columns and spans and wraps overflowing rows', () => {
    const layout = normalizeFormLayout({ rows: [{ columns: 9, cells: [{ field_key: 'a', span: 3 }, { field_key: 'b', span: 2 }, { field_key: 'c', span: 7 }] }] }, ['a', 'b', 'c'])
    expect(keys(layout)).toEqual(['4:a/3', '4:b/2', '4:c/4'])
  })

  it('adds, moves and removes rows', () => {
    let layout = defaultFormLayout(['a', 'b'])
    layout = addRow(layout, 3, 1)
    expect(keys(layout)).toEqual(['1:a/1', '3:', '1:b/1'])
    layout = moveRow(layout, 2, -2)
    expect(keys(layout)).toEqual(['1:b/1', '1:a/1', '3:'])
    const removed = removeRow(layout, 0)
    expect(removed.removedKeys).toEqual(['b'])
    expect(keys(removed.layout)).toEqual(['1:a/1', '3:'])
  })

  it('changes a row’s columns, shrinking spans and wrapping what no longer fits', () => {
    const layout: FormLayout = { rows: [{ columns: 4, cells: [{ field_key: 'a', span: 2 }, { field_key: 'b', span: 1 }, { field_key: 'c', span: 1 }] }] }
    expect(keys(setRowColumns(layout, 0, 2))).toEqual(['2:a/2', '2:b/1,c/1'])
    expect(keys(setRowColumns(layout, 0, 1))).toEqual(['1:a/1', '1:b/1', '1:c/1'])
  })

  it('places and moves fields between cells; a full row spills into a new row', () => {
    let layout: FormLayout = { rows: [{ columns: 2, cells: [{ field_key: 'a', span: 1 }, { field_key: 'b', span: 1 }] }, { columns: 1, cells: [{ field_key: 'c', span: 1 }] }] }
    layout = placeField(layout, 'c', 0, 0)
    expect(keys(layout)).toEqual(['2:a/1,b/1', '2:c/1', '1:'])
    layout = placeField(layout, 'b', 1, 1)
    expect(keys(layout)).toEqual(['2:a/1', '2:c/1,b/1', '1:'])
    layout = placeField(layout, 'd', layout.rows.length, 0)
    expect(findCell(layout, 'd')).toEqual({ row: 3, index: 0 })
  })

  it('sets spans within the row’s free space', () => {
    const layout: FormLayout = { rows: [{ columns: 3, cells: [{ field_key: 'a', span: 1 }, { field_key: 'b', span: 1 }] }] }
    expect(keys(setCellSpan(layout, 'a', 3))).toEqual(['3:a/2,b/1'])
    expect(rowUsed(setCellSpan(layout, 'a', 0).rows[0])).toBe(2)
  })

  it('moves fields with the keyboard (left/right within a row, up/down between rows)', () => {
    let layout: FormLayout = { rows: [{ columns: 2, cells: [{ field_key: 'a', span: 1 }, { field_key: 'b', span: 1 }] }, { columns: 2, cells: [{ field_key: 'c', span: 1 }] }] }
    layout = nudgeField(layout, 'b', 'left')
    expect(layoutKeyOrder(layout)).toEqual(['b', 'a', 'c'])
    layout = nudgeField(layout, 'a', 'down')
    expect(keys(layout)).toEqual(['2:b/1', '2:a/1,c/1'])
    layout = nudgeField(layout, 'c', 'up')
    expect(keys(layout)).toEqual(['2:b/1,c/1', '2:a/1'])
    expect(nudgeField(layout, 'b', 'up')).toBe(layout)
  })

  it('renames keys and compacts the trivial layout away', () => {
    const layout = renameLayoutKey(defaultFormLayout(['a', 'b']), 'a', 'z')
    expect(layoutKeyOrder(layout)).toEqual(['z', 'b'])
    expect(compactLayoutForSave(layout, ['z', 'b'])).toBeNull()
    expect(compactLayoutForSave(addRow(layout, 2), ['z', 'b'])).toBeNull()
    expect(compactLayoutForSave({ rows: [{ columns: 2, cells: [{ field_key: 'z', span: 1 }, { field_key: 'b', span: 1 }] }] }, ['z', 'b'])).not.toBeNull()
  })
})

describe('designer state', () => {
  it('opens a legacy node form without layout and saves it back unchanged (not dirty)', () => {
    const def = readNodeForm({ fields: [{ key: 'amount', label: 'Amount', type: 'number' }, { key: 'note', label: 'Note', type: 'text' }] })
    const state = designerStateFrom(def)
    expect(state.layout.rows).toHaveLength(2)
    expect(formDefinitionKey(definitionFrom(state))).toBe(formDefinitionKey(def))
    expect(nodeFormPatch(definitionFrom(state), null)).toMatchObject({ form_layout: undefined, form_theme: undefined, form_id: undefined })
  })

  it('adds fields with unique keys, derives keys from labels until edited, and tracks renames', () => {
    let state = designerStateFrom({ fields: [], layout: null, theme: { source: 'workspace' } })
    const first = addField(state, 'text')
    state = first.state
    const second = addField(state, 'text')
    state = second.state
    expect(state.fields.map((f) => f.key)).toEqual(['text', 'text_2'])
    state = updateField(state, first.field._id, { label: 'Employee name' })
    expect(state.fields[0].key).toBe('employee_name')
    state = updateField(state, first.field._id, { key: 'employee' })
    state = updateField(state, first.field._id, { label: 'Employee full name' })
    expect(state.fields[0].key).toBe('employee')
    expect(designerProblems(state)).toEqual({})
    state = updateField(state, second.field._id, { key: 'employee' })
    expect(Object.values(designerProblems(state))[0]).toMatch(/used by another/)
  })

  it('carries a key rename into the layout and visible_when, and reports renames since opening', () => {
    const def = readNodeForm({ fields: [{ key: 'urgent', label: 'Urgent', type: 'boolean' }, { key: 'reason', label: 'Reason', type: 'text', visible_when: { field: 'urgent', operator: 'equals', value: 'true' } }] })
    let state = designerStateFrom(def)
    const initial = new Map(state.fields.map((f) => [f._id, f.key]))
    state = updateField(state, state.fields[0]._id, { key: 'is_urgent' })
    expect(layoutKeyOrder(state.layout)[0]).toBe('is_urgent')
    expect(state.fields[1].visible_when?.field).toBe('is_urgent')
    expect(keyRenames(initial, state)).toEqual([{ from: 'urgent', to: 'is_urgent' }])
  })

  it('duplicates and removes fields', () => {
    let state = addField(designerStateFrom({ fields: [], layout: null, theme: { source: 'workspace' } }), 'choice').state
    const dup = duplicateField(state, state.fields[0]._id)!
    state = dup.state
    expect(state.fields.map((f) => f.key)).toEqual(['single_select', 'single_select_2'])
    expect(state.fields[1].options).toEqual(['Option 1', 'Option 2'])
    state = removeField(state, state.fields[0]._id)
    expect(definitionFrom(state).fields.map((f) => f.key)).toEqual(['single_select_2'])
  })
})

describe('undo / redo', () => {
  it('pushes, coalesces tagged edits, undoes and redoes', () => {
    let h = initialHistory(0)
    h = historyReducer(h, { type: 'set', next: 1 })
    h = historyReducer(h, { type: 'set', next: 2, tag: 'label' })
    h = historyReducer(h, { type: 'set', next: 3, tag: 'label' })
    expect(h.past).toEqual([0, 1])
    h = historyReducer(h, { type: 'undo' })
    expect(h.present).toBe(1)
    h = historyReducer(h, { type: 'redo' })
    expect(h.present).toBe(3)
    h = historyReducer(h, { type: 'undo' })
    h = historyReducer(h, { type: 'set', next: 9 })
    expect(h.future).toEqual([])
  })
})

describe('server-side validation per type', () => {
  const fields = normalizeTaskFields([
    { key: 'name', label: 'Name', type: 'text', required: true, min_length: 2, max_length: 10, pattern: '^[A-Z]', pattern_message: 'start with a capital' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
    { key: 'total', label: 'Total', type: 'currency', min: 1, max: 1000 },
    { key: 'qty', label: 'Qty', type: 'number' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'phone', label: 'Phone', type: 'phone' },
    { key: 'site', label: 'Site', type: 'url' },
    { key: 'when', label: 'When', type: 'datetime', min_date: '2026-01-01' },
    { key: 'day', label: 'Day', type: 'date', max_date: '2026-12-31' },
    { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b', 'c'], min: 1, max: 2 },
    { key: 'owner', label: 'Owner', type: 'user' },
    { key: 'intro', label: 'Intro', type: 'heading' },
  ])

  it('accepts valid values and coerces them to typed values', () => {
    const values = { name: 'Ada', total: '1,250.50', qty: '3', email: 'a@b.co', phone: '+64 21 555 0100', site: 'https://example.com', when: '2026-10-28T09:30:00+13:00', day: '2026-10-28', tags: 'a, b', owner: '7dc90f00-ec7e-4904-8d87-40bd2d8dd6ea' }
    expect(validateTaskFieldValues(fields, { ...values, total: '250' })).toEqual({})
    const coerced = coerceTaskFieldValues(fields, { ...values, total: '250' })
    expect(coerced).toMatchObject({ total: 250, qty: 3, when: '2026-10-27T20:30:00.000Z', day: '2026-10-28', tags: ['a', 'b'] })
    expect(coerced).not.toHaveProperty('intro')
  })

  it('rejects each type’s invalid values', () => {
    const errors = validateTaskFieldValues(fields, {
      name: 'ada', total: '5000', qty: 'many', email: 'nope', phone: 'abc', site: 'ftp://x', when: '2025-06-01T00:00:00Z', day: '2027-01-01', tags: ['a', 'b', 'c'], owner: 'not-a-uuid',
    })
    expect(Object.keys(errors).sort()).toEqual(['day', 'email', 'name', 'owner', 'phone', 'qty', 'site', 'tags', 'total', 'when'])
    expect(errors.name).toContain('start with a capital')
    expect(validateTaskFieldValues(fields, { name: 'A' }).name).toMatch(/at least 2/)
    expect(validateTaskFieldValues(fields, { name: 'Abc', tags: [] }).tags).toBeUndefined()
    expect(validateTaskFieldValues(fields, { name: 'Abc', tags: ['zzz'] }).tags).toMatch(/must be from/)
  })

  it('skips hidden fields (visible_when) and read-only fields; read-only values are never taken from the client', () => {
    const conditional = normalizeTaskFields([
      { key: 'urgent', label: 'Urgent', type: 'boolean' },
      { key: 'reason', label: 'Reason', type: 'text', required: true, visible_when: { field: 'urgent', operator: 'equals', value: 'true' } },
      { key: 'ref', label: 'Ref', type: 'text', read_only: true, required: true },
    ])
    expect(isFieldVisible(conditional[1], { urgent: false })).toBe(false)
    expect(validateTaskFieldValues(conditional, { urgent: false })).toEqual({})
    expect(validateTaskFieldValues(conditional, { urgent: true })).toEqual({ reason: 'Reason is required' })
    const merged = mergeTaskFieldValues({ fields: conditional, template_values: { ref: 'R-1' } }, { urgent: false, ref: 'HACKED' })
    expect(merged.errors).toEqual({})
    expect(merged.templateValues.ref).toBe('R-1')
  })

  it('seeds multi-select defaults as arrays', () => {
    expect(defaultTaskFieldValues(normalizeTaskFields([{ key: 't', label: 'T', type: 'multi_choice', options: ['a', 'b'], default: 'a,b' }, { key: 'u', label: 'U', type: 'multi_choice', options: ['a'] }]))).toEqual({ t: ['a', 'b'], u: [] })
  })
})

describe('downstream variables', () => {
  const nodes = [
    { id: 't', type: 'webhook_received', label: 'Start', config: {} },
    { id: 'ut', type: 'user_task', label: 'Review', config: { fields: [
      { key: 'amount', label: 'Amount', type: 'currency', currency: 'NZD' },
      { key: 'urgent', label: 'Urgent', type: 'boolean' },
      { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a'] },
      { key: 'when', label: 'When', type: 'date' },
      { key: 'section', label: 'Section', type: 'heading' },
    ] } },
    { id: 'after', type: 'log', label: 'Log', config: {} },
  ]
  const edges = [{ source: 't', target: 'ut' }, { source: 'ut', target: 'after' }]

  it('exposes every value field of an upstream User Task as typed {{task_data.<key>}} with its label', () => {
    const groups = buildDataTree({ nodes, edges, currentNodeId: 'after' })
    const task = groups.find((g) => g.kind === 'form')!
    expect(task.label).toBe('Review › Form')
    expect(task.roots.map((r) => [r.path, r.label, r.schema?.type])).toEqual([
      ['task_data.amount', 'Amount', 'number'],
      ['task_data.urgent', 'Urgent', 'boolean'],
      ['task_data.tags', 'Tags', 'array'],
      ['task_data.when', 'When', 'string'],
    ])
    expect(task.roots[0].description).toContain('Currency')
    expect(buildDataTree({ nodes, edges, currentNodeId: 'ut' }).some((g) => g.kind === 'form')).toBe(false)
  })

  it('exposes a task trigger’s form as {{task.data.<key>}}', () => {
    const groups = buildDataTree({
      nodes: [{ id: 'trg', type: 'task_submitted', label: 'Task submitted', config: { fields: [{ key: 'po', label: 'PO number', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }] } }, { id: 'x', type: 'log', label: 'Log', config: {} }],
      edges: [{ source: 'trg', target: 'x' }],
      currentNodeId: 'x',
    })
    const trigger = groups.find((g) => g.kind === 'form')!
    expect(trigger.label).toBe('Task submitted › Task form')
    expect(trigger.roots.map((r) => [r.path, r.label, r.schema?.type])).toEqual([
      ['task.data.po', 'PO number', 'string'], ['task.data.qty', 'Qty', 'number'], ['task.data', 'All values (object)', 'object'],
    ])
    expect(trigger.roots[2].schema?.fields?.map((f) => [f.name, f.type])).toEqual([['po', 'string'], ['qty', 'number']])
  })
})

describe('renaming a key updates downstream references', () => {
  const nodes = [
    { id: 'ut', type: 'user_task', label: 'Review', config: { fields: [{ key: 'amount' }] } },
    { id: 'sv', type: 'set_variable', label: 'Total', config: { name: 'total', expression: '{{task_data.amount}} + {{task_data.amount_tax}}' } },
    { id: 'cond', type: 'condition', label: 'Big?', config: { branches: [{ rules: [{ field: '{{task.data.amount}}', operator: 'gt', value: '100' }] }] } },
    { id: 'log', type: 'log', label: 'Log', config: { message: 'nothing here' } },
  ]

  it('finds whole-segment references, skipping the form’s own node', () => {
    const refs = findFieldReferences(nodes, 'amount', 'ut')
    expect(refs.map((r) => [r.node_id, r.path, r.count])).toEqual([['sv', 'expression', 1], ['cond', 'branches.0.rules.0.field', 1]])
  })

  it('rewrites them and leaves other nodes untouched', () => {
    const next = renameFieldReferences(nodes, 'amount', 'total_amount', 'ut')
    expect(next[1].config.expression).toBe('{{task_data.total_amount}} + {{task_data.amount_tax}}')
    expect((next[2].config as any).branches[0].rules[0].field).toBe('{{task.data.total_amount}}')
    expect(next[3]).toBe(nodes[3])
    expect(next[0]).toBe(nodes[0])
    expect(renameFieldReferencesInText('{{=UPPER(task_data.amount)}}', 'amount', 'x')).toBe('{{=UPPER(task_data.x)}}')
  })
})

describe('linking and pinning', () => {
  it('reads the link, pins published snapshots and unpins on revert', () => {
    const nodes = [
      { id: 'a', type: 'user_task', config: { form_id: 'f1', form_name: 'Expense', form_cached_version: 2, fields: [] } },
      { id: 'b', type: 'user_task', config: { form_id: 'gone' } },
      { id: 'c', type: 'log', config: { form_id: 'f1' } },
    ]
    expect(readNodeFormLink(nodes[0].config)).toEqual({ form_id: 'f1', form_name: 'Expense', cached_version: 2 })
    const pinned = pinFormVersions(nodes, new Map([['f1', 3]]))
    expect((pinned[0].config as any).form_version).toBe(3)
    expect(pinned[1]).toBe(nodes[1])
    expect(pinned[2]).toBe(nodes[2])
    expect(readNodeFormLink(pinned[0].config)?.pinned_version).toBe(3)
    const reverted = unpinFormVersions(pinned, { a: 1 })
    expect((reverted.nodes as any)[0].config).not.toHaveProperty('form_version')
    expect(reverted.trigger_config).toEqual({ a: 1 })
  })

  it('detaching keeps the cached copy as the node’s own form', () => {
    const def = readNodeForm({ fields: [{ key: 'x', label: 'X' }], form_id: 'f1' })
    const patch = nodeFormPatch(def, null)
    expect(patch.form_id).toBeUndefined()
    expect(patch.fields).toEqual([{ key: 'x', label: 'X', type: 'text' }])
  })
})

describe('form mini themes', () => {
  const ws = defaultWorkspaceTheme()

  it('parses references strictly and falls back to the workspace theme', () => {
    expect(parseFormThemeRef(undefined)).toEqual({ source: 'workspace' })
    expect(parseFormThemeRef({ source: 'custom', overrides: { colors: { light: { accent: 'url(x)' } } } })).toEqual({ source: 'workspace' })
    expect(parseFormThemeRef({ source: 'saved', theme_id: '7dc90f00-ec7e-4904-8d87-40bd2d8dd6ea' }).source).toBe('saved')
    expect(FormThemeOverridesSchema.safeParse({ header: { enabled: true, title: '<script>' } }).success).toBe(false)
    expect(FormThemeOverridesSchema.safeParse({ font: { source: 'google', family: 'Comic Neue Fake' } }).success).toBe(false)
  })

  it('applies overrides per mode; without dark colours only the accent carries over', () => {
    const overrides = { colors: { light: { accent: '#7C3AED', background: '#FFF7ED', text: '#1F2937' } }, radius: 12 }
    expect(colorsForMode(overrides, 'dark')).toEqual({ accent: '#7C3AED' })
    const vars = formThemeVars(overrides, ws.colors.light, 'light')
    expect(vars['--theme-card-bg']).toBe('#FFF7ED')
    expect(vars['--theme-input-radius']).toBe('12px')
    expect(vars['--theme-topbar']).toBe(vars['--theme-input-bg'])
    expect(formThemeVars(null, ws.colors.light, 'light')).toEqual({})
  })

  it('never renders illegible text: the legibility pass raises low-contrast colours', () => {
    const overrides = { colors: { light: { background: '#FFFFFF', text: '#EEEEEE', accent: '#FFFF66' } } }
    const issues = formThemeContrast(overrides, ws.colors.light, 'light')
    expect(issues.map((i) => i.pair)).toEqual(expect.arrayContaining(['text/background', 'accent/background']))
    expect(issues.find((i) => i.pair === 'text/background')?.blocking).toBe(true)
    const vars = formThemeVars(overrides, ws.colors.light, 'light')
    expect(contrastRatio(vars['--theme-card-text'], vars['--theme-card-bg'])!).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(vars['--theme-on-primary'], vars['--theme-primary'])!).toBeGreaterThanOrEqual(4.5)
  })

  it('blocks saving a theme whose own text/background is below 3:1, and the auto-fix clears it', () => {
    const bad = { colors: { light: { background: '#FFFFFF', text: '#F0F0F0' } } }
    expect(blockingFormThemeIssues(bad)).toHaveLength(1)
    const fixed = autoFixFormTheme(bad, ws.colors)
    expect(blockingFormThemeIssues(fixed)).toEqual([])
    expect(formThemeContrast(fixed, ws.colors.light, 'light').filter((i) => i.pair === 'text/background' || i.pair === 'muted/background')).toEqual([])
  })

  it('starts from a built-in preset', () => {
    const preset = overridesFromPreset('gallery') ?? overridesFromPreset(ws.meta.basePreset ?? '')
    expect(preset?.colors?.light?.accent).toBeTruthy()
    expect(overridesFromPreset('no-such-preset')).toBeNull()
  })
})


describe('form theme on a dark background over a light workspace', () => {
  it('keeps light text light (judged against the form background, not the workspace surface)', () => {
    const ws = defaultWorkspaceTheme()
    const overrides = { colors: { dark: { accent: '#2DD4BF', background: '#042F2E', text: '#CCFBF1' } } }
    const vars = formThemeVars(overrides, ws.colors.light, 'dark')
    expect(vars['--theme-card-text']).toBe('#CCFBF1')
    expect(contrastRatio(vars['--theme-muted-text'], '#042F2E')!).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(vars['--theme-primary-text'], '#042F2E')!).toBeGreaterThanOrEqual(4.5)
  })
})
