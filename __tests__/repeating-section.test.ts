/**
 * Repeating sections (lib/forms/repeating-section.ts, field type
 * `repeating_section`): normalisation (inner fields, inner grid, settings,
 * the 3-level cap, excluded types), definition problems (unique keys, derived
 * keys), the item helpers (add / remove / move / min / max / start items,
 * titles), validation recursing per item with path errors and per-item
 * rules, coercion and the derived values, dynamic bindings reading the item.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import {
  REPEATING_LIMITS, REPEATING_MAX_DEPTH, addItem, addItemLabel, asListField, canAddItem, canRemoveItem, describeRepeatingValue, findFieldDeep, innerFormLayout,
  itemScopeValues, itemTitle, moveItem, newItem, removeItem, repeatingDerivedKeys, repeatingDerivedValues, repeatingListConfig, sectionOfField, singularLabel, startItems,
} from '@/lib/forms/repeating-section'
import {
  coerceTaskFieldValues, defaultTaskFieldValues, fieldDefinitionProblems, fieldValueSchemaType, mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues,
} from '@/lib/task-field-schema'
import { bindingDependencies, bindingInputs, blankInputsBehaviour } from '@/lib/forms/dynamic-values'
import { resolveDataTableTemplate } from '@/lib/forms/data-table'
import { coerceListRow } from '@/lib/forms/list-field'

const EXPENSES = {
  key: 'expenses', label: 'Expenses', type: 'repeating_section',
  repeating_section: {
    fields: [
      { key: 'description', label: 'Description', type: 'text', required: true },
      { key: 'country', label: 'Country', type: 'choice', options: ['US', 'NZ'] },
      { key: 'category', label: 'Category', type: 'choice', options: [], dynamic: { options: { kind: 'table', table_id: '0e000000-0000-4000-8000-000000000001', value: 'name', base_filter: { match: 'all', conditions: [{ column: 'country', operator: 'eq', value: '{{item.country}}' }] } } } },
      { key: 'amount', label: 'Amount', type: 'currency', currency: 'USD', required: true, min: 0 },
      { key: 'spent_on', label: 'Date', type: 'date', default: '{{today}}' },
      { key: 'receipt_note', label: 'Receipt note', type: 'textarea' },
      { key: 'notes', label: 'Notes', type: 'rich_text' },
    ],
    layout: {
      rows: [
        { columns: 2, cells: [{ field_key: 'description', span: 2 }] },
        { columns: 3, cells: [{ field_key: 'category', span: 1 }, { field_key: 'amount', span: 1 }, { field_key: 'spent_on', span: 1 }] },
        { columns: 1, cells: [{ field_key: 'nope', span: 1 }] },
      ],
      rules: [
        // Per item: a receipt note is required over USD 75 (Always rule → required via field_error), hidden for small amounts.
        { id: 'r1', name: 'Receipt over 75', event: 'always', if: { match: 'all', conditions: [{ column: 'item.amount', operator: 'gt', value: '75' }, { column: 'item.receipt_note', operator: 'is_not_set' }] }, then: [{ type: 'field_error', field: 'receipt_note', text: 'Add a receipt note over USD 75' }] },
        { id: 'r2', name: 'Hide notes for small amounts', event: 'always', if: { match: 'all', conditions: [{ column: 'row.amount', operator: 'lt', value: '10' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['field:notes'] }] },
      ],
      pages: [{ id: 'x', title: 'ignored', rows: [] }],
    },
    add_label: 'Add expense',
    item_title: 'Expense {{index}}: {{item.description}}',
    min_items: 1, max_items: 5, start_items: 2,
    allow_reorder: false, confirm_remove: true,
    totals: [{ field: 'amount', fn: 'sum' }, { field: 'description', fn: 'count' }, { field: 'description', fn: 'sum' }],
  },
}

describe('normalisation', () => {
  const [field] = normalizeTaskFields([EXPENSES])

  it('keeps the inner fields, the grid (cleaned), the per-item rules and the settings', () => {
    const config = field.repeating_section!
    expect(config.fields.map((f) => f.key)).toEqual(['description', 'country', 'category', 'amount', 'spent_on', 'receipt_note', 'notes'])
    expect(config.fields.find((f) => f.key === 'category')!.dynamic!.options).toMatchObject({ kind: 'table' })
    // Unknown cells dropped; pages ignored; unplaced inner fields added as rows.
    expect(config.layout!.rows[0]).toEqual({ columns: 2, cells: [{ field_key: 'description', span: 2 }] })
    expect(config.layout!.rows.flatMap((r) => r.cells.map((c) => c.field_key))).not.toContain('nope')
    expect((config.layout as any).pages).toBeUndefined()
    expect(config.layout!.rules!.map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(config).toMatchObject({ add_label: 'Add expense', item_title: 'Expense {{index}}: {{item.description}}', min_items: 1, max_items: 5, start_items: 2, allow_reorder: false, confirm_remove: true })
    expect(config.allow_remove).toBeUndefined()
    // A sum over a text field is dropped; count over it is kept.
    expect(config.totals).toEqual([{ field: 'amount', fn: 'sum' }, { field: 'description', fn: 'count' }])
    expect(fieldValueSchemaType('repeating_section')).toBe('array')
  })

  it('clamps the item settings and drops excluded types / scope names', () => {
    const [f] = normalizeTaskFields([{ key: 's', label: 'S', type: 'repeating_section', repeating_section: {
      fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'table', label: 'T', type: 'data_table' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'c', label: 'C', type: 'custom' }],
      max_items: 9999, min_items: 500, start_items: -1,
    } }])
    expect(f.repeating_section!.fields.map((x) => x.key)).toEqual(['a'])
    expect(f.repeating_section!.max_items).toBe(REPEATING_LIMITS.items)
    expect(f.repeating_section!.min_items).toBe(REPEATING_LIMITS.items)
    expect(f.repeating_section!.start_items).toBeUndefined()
  })

  it(`nests sections and Lists down to ${REPEATING_MAX_DEPTH} levels`, () => {
    const level = (n: number): any => ({ key: `s${n}`, label: `S${n}`, type: 'repeating_section', repeating_section: { fields: [{ key: `t${n}`, label: 'T', type: 'text' }, { key: `l${n}`, label: 'L', type: 'list', list: { columns: [{ key: 'x', label: 'X', type: 'text' }] } }, ...(n < 5 ? [level(n + 1)] : [])] } })
    const [top] = normalizeTaskFields([level(1)])
    const s2 = top.repeating_section!.fields.find((f) => f.key === 's2')!
    const s3 = s2.repeating_section!.fields.find((f) => f.key === 's3')!
    expect(s3.repeating_section!.fields.map((f) => f.key)).toEqual(['t3'])
    expect(findFieldDeep([top], 't3')!.sections).toEqual(['s1', 's2', 's3'])
    expect(sectionOfField([top], 't3')!.key).toBe('s3')
    expect(findFieldDeep([top], 's4')).toBeNull()
  })

  it('flags problems: no controls, keys used twice on the form, derived keys taken, inner problems', () => {
    const fields = normalizeTaskFields([
      { key: 'description', label: 'Top description', type: 'text' },
      EXPENSES,
      { key: 'empty', label: 'Empty', type: 'repeating_section', repeating_section: { fields: [] } },
      { key: 'bad', label: 'Bad', type: 'repeating_section', repeating_section: { fields: [{ key: 'pick', label: 'Pick', type: 'choice', options: [] }] } },
      { key: 'clash', label: 'Clash', type: 'repeating_section', repeating_section: { fields: [{ key: 'x1', label: 'X', type: 'text' }] } },
      { key: 'clash_count', label: 'Clash count', type: 'number' },
    ])
    const problems = fieldDefinitionProblems(fields)
    expect(problems.expenses).toMatch(/"description" is used elsewhere/)
    expect(problems.empty).toMatch(/Add at least one control/)
    expect(problems.bad).toBe('Pick: Add at least one option')
    expect(problems.clash).toMatch(/clash_count/)
    expect(fieldDefinitionProblems(normalizeTaskFields([EXPENSES]))).toEqual({})
  })
})

describe('items', () => {
  const [field] = normalizeTaskFields([EXPENSES])
  const config = field.repeating_section!

  it('starts with start_items blank items (defaults resolved), adds up to max, removes down to min, never reorders when off', () => {
    const items = startItems(config, (t) => (t === '{{today}}' ? '2026-11-11' : t))
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({ description: null, amount: null, spent_on: '2026-11-11', notes: null })
    let list = items
    for (let i = 0; i < 10; i++) list = addItem(config, list, newItem(config))
    expect(list).toHaveLength(5)
    expect(canAddItem(config, 5)).toBe(false)
    list = removeItem(config, list, 0)
    expect(list).toHaveLength(4)
    expect(removeItem(config, [list[0]], 0)).toHaveLength(1)
    expect(canRemoveItem(config, 1)).toBe(false)
    expect(canRemoveItem({ ...config, min_items: undefined }, 1, true)).toBe(false)
    expect(moveItem(config, [{ a: 1 }, { a: 2 }], 0, 1)).toEqual([{ a: 1 }, { a: 2 }])
    expect(moveItem({ ...config, allow_reorder: undefined }, [{ a: 1 }, { a: 2 }, { a: 3 }], 0, 1)).toEqual([{ a: 2 }, { a: 1 }, { a: 3 }])
    expect(moveItem({ ...config, allow_reorder: undefined }, [{ a: 1 }, { a: 2 }], 1, 5)).toEqual([{ a: 1 }, { a: 2 }])
    expect(removeItem({ ...config, allow_remove: false }, list, 0)).toBe(list)
  })

  it('titles cards, labels the Add button and summarises', () => {
    expect(itemTitle(field, { description: 'Taxi' }, 0)).toBe('Expense 1: Taxi')
    expect(itemTitle(field, { description: null }, 2)).toBe('Expense 3')
    expect(itemTitle({ label: 'Trips', repeating_section: { fields: [] } }, {}, 1)).toBe('Trip 2')
    expect(addItemLabel(field)).toBe('Add expense')
    expect(addItemLabel({ label: 'Line items', repeating_section: { fields: [] } })).toBe('Add line item')
    expect(singularLabel('Receipts')).toBe('Receipt')
    expect(singularLabel('Addresses')).toBe('Address')
    expect(singularLabel('Categories')).toBe('Category')
    expect(describeRepeatingValue([{}, {}, {}], field)).toBe('3 expenses')
    expect(describeRepeatingValue([{}], field)).toBe('1 expense')
    expect(describeRepeatingValue([], field)).toBe('—')
  })

  it('the new form starts with the start items (defaultTaskFieldValues)', () => {
    const values = defaultTaskFieldValues([field], (t) => (t === '{{today}}' ? '2026-11-11' : t))
    expect(values.expenses).toHaveLength(2)
    expect((values.expenses as any[])[0]).toMatchObject({ spent_on: '2026-11-11', amount: null, description: null })
  })

  it('the item scope: form values, the item over them, item / row / parent; runtime keys left out', () => {
    const scope = itemScopeValues({ total: 5, description: 'top', __form_state: { x: 1 }, __form_params: { p: 1 } }, { description: 'Taxi' }, { trip: 'NYC' })
    expect(scope).toMatchObject({ total: 5, description: 'Taxi', item: { description: 'Taxi' }, row: { description: 'Taxi' }, parent: { trip: 'NYC' }, __form_params: { p: 1 } })
    expect(scope.__form_state).toBeUndefined()
  })
})

describe('validation recursing per item', () => {
  const fields = normalizeTaskFields([{ key: 'trip', label: 'Trip', type: 'text' }, EXPENSES])

  it('checks every item against the inner fields with path errors, min / max items and the per-item rules', () => {
    const errors = validateTaskFieldValues(fields, {
      trip: 'NYC',
      expenses: [
        { description: 'Taxi', amount: 42, spent_on: '2026-11-02' },
        { description: '', amount: 'abc' },
        { description: 'Hotel', amount: 480 },
        { description: 'Dinner', amount: 120, receipt_note: 'Client dinner' },
      ],
    })
    expect(errors['expenses[1].description']).toBe('Description is required')
    expect(errors['expenses[1].amount']).toBe('Amount must be a number')
    expect(errors['expenses[2].receipt_note']).toBe('Add a receipt note over USD 75')
    expect(errors['expenses[3].receipt_note']).toBeUndefined()
    expect(errors['expenses[0].amount']).toBeUndefined()
    expect(errors.expenses).toMatch(/^Expenses: item 2: /)
    expect(validateTaskFieldValues(fields, { expenses: [] }).expenses).toBe('Expenses: add at least one item')
    expect(validateTaskFieldValues(fields, { expenses: Array.from({ length: 6 }, () => ({ description: 'x', amount: 1 })) }).expenses).toBe('Expenses: at most 5 items')
    expect(validateTaskFieldValues(fields, { expenses: 'nope' }).expenses).toMatch(/invalid value/)
    expect(validateTaskFieldValues(fields, { expenses: [{ description: 'Taxi', amount: 4 }] })).toEqual({})
  })

  it('a hidden inner field (per-item rule) is not required; drafts skip required checks', () => {
    const withRequiredNotes = normalizeTaskFields([{ ...EXPENSES, repeating_section: { ...EXPENSES.repeating_section, fields: EXPENSES.repeating_section.fields.map((f) => (f.key === 'notes' ? { ...f, required: true } : f)) } }])
    const errors = validateTaskFieldValues(withRequiredNotes, { expenses: [{ description: 'Coffee', amount: 4 }, { description: 'Taxi', amount: 40 }] })
    expect(errors['expenses[0].notes']).toBeUndefined()
    expect(errors['expenses[1].notes']).toBe('Notes is required')
    expect(validateTaskFieldValues(withRequiredNotes, { expenses: [{ description: '' }] }, { partial: true })).toEqual({})
  })

  it('nested sections: their paths below the item, {{parent.*}} the outer item', () => {
    const nested = normalizeTaskFields([{
      key: 'trips', label: 'Trips', type: 'repeating_section', repeating_section: {
        fields: [
          { key: 'city', label: 'City', type: 'text', required: true },
          { key: 'legs', label: 'Legs', type: 'repeating_section', repeating_section: {
            fields: [{ key: 'from', label: 'From', type: 'text', required: true }, { key: 'to', label: 'To', type: 'text' }],
            layout: { rows: [], rules: [{ id: 'p1', event: 'always', if: { match: 'all', conditions: [{ column: 'parent.city', operator: 'eq', value: 'NYC' }, { column: 'item.to', operator: 'is_not_set' }] }, then: [{ type: 'field_error', field: 'to', text: 'NYC legs need a destination' }] }] },
          } },
        ],
      },
    }])
    const errors = validateTaskFieldValues(nested, { trips: [{ city: 'NYC', legs: [{ from: 'JFK' }, { from: '' , to: 'LGA' }] }, { city: 'Boston', legs: [{ from: 'BOS' }] }] })
    expect(errors['trips[0].legs[0].to']).toBe('NYC legs need a destination')
    expect(errors['trips[0].legs[1].from']).toBe('From is required')
    expect(errors['trips[0].legs']).toMatch(/^Legs: item 1/)
    expect(errors['trips[1].legs[0].to']).toBeUndefined()
    expect(errors.trips).toMatch(/^Trips: item 1/)
  })
})

describe('coercion and derived values', () => {
  const [field] = normalizeTaskFields([EXPENSES])

  it('types each item by the form engine: value fields only, missing → blank, rich text sanitised with its text', () => {
    const out = coerceTaskFieldValues([field], { expenses: [{ description: 'Taxi', amount: '42.50', spent_on: '2026-11-02T10:00:00Z', notes: '<p>Hi <script>x</script></p>', __iid: 'a', extra: 1 }] })
    expect(out.expenses).toEqual([{ description: 'Taxi', country: null, category: null, amount: 42.5, spent_on: '2026-11-02', receipt_note: null, notes: '<p>Hi </p>', notes_text: 'Hi' }])
  })

  it('stores the count and the totals beside the items (mergeTaskFieldValues)', () => {
    expect(repeatingDerivedKeys('expenses', field.repeating_section)).toEqual(['expenses_count', 'expenses_total_amount', 'expenses_count_description'])
    expect(repeatingDerivedValues('expenses', field.repeating_section, [{ amount: 42 }, { amount: 8, description: 'x' }])).toEqual({ expenses_count: 2, expenses_total_amount: 50, expenses_count_description: 1 })
    const { errors, templateValues } = mergeTaskFieldValues({ fields: [EXPENSES] }, { expenses: [{ description: 'Taxi', amount: 42 }, { description: 'Hotel', amount: 60 }] })
    expect(errors).toEqual({})
    expect(templateValues).toMatchObject({ expenses_count: 2, expenses_total_amount: 102 })
  })

  it('is a List for the List rules: simple types map to columns, everything else passes through', () => {
    const config = repeatingListConfig(field.repeating_section)
    expect(config.columns.map((c) => [c.key, c.type])).toEqual([['description', 'text'], ['country', 'choice'], ['category', 'choice'], ['amount', 'currency'], ['spent_on', 'date'], ['receipt_note', 'textarea'], ['notes', 'field']])
    expect(config.max_rows).toBe(5)
    expect(config.totals).toEqual([{ column: 'amount', fn: 'sum' }, { column: 'description', fn: 'count' }])
    expect(asListField(field)).toMatchObject({ type: 'list', list: { entry_mode: 'inline' } })
    // A pass-through column keeps its value as it is.
    expect(coerceListRow(config, { description: 'x', notes: '<p>keep</p>' }).notes).toBe('<p>keep</p>')
  })

  it('innerFormLayout: the stored grid, inner fields it misses on rows of their own', () => {
    const layout = innerFormLayout({ fields: [{ key: 'a', label: 'A', type: 'text' }, { key: 'b', label: 'B', type: 'text' }], layout: { rows: [{ columns: 2, cells: [{ field_key: 'a', span: 1 }] }] } })
    expect(layout.rows).toEqual([{ columns: 2, cells: [{ field_key: 'a', span: 1 }] }, { columns: 1, cells: [{ field_key: 'b', span: 1 }] }])
  })
})

describe('a bound cascading dropdown inside an item', () => {
  const [field] = normalizeTaskFields([EXPENSES])
  const category = field.repeating_section!.fields.find((f) => f.key === 'category')!
  const binding = category.dynamic!.options!

  it('depends on the same item (item.country) — re-queried when it changes, blank → no options', () => {
    expect(bindingDependencies(binding)).toEqual(['item.country'])
    const scope = itemScopeValues({ trip: 'NYC' }, { country: 'NZ' })
    expect(bindingInputs(binding, scope)).toEqual({ 'item.country': 'NZ' })
    expect(blankInputsBehaviour(binding, scope)).toBeNull()
    expect(blankInputsBehaviour(binding, itemScopeValues({}, { country: null }))).toBe('clear')
    // As sent to the server (flat), the same value reads back.
    expect(bindingInputs(binding, { 'item.country': 'US' })).toEqual({ 'item.country': 'US' })
  })

  it('the base filter reads the item (the server resolves {{item.*}} in the scope)', () => {
    expect(resolveDataTableTemplate('{{item.country}}', { values: itemScopeValues({}, { country: 'NZ' }) } as any)).toBe('NZ')
    expect(resolveDataTableTemplate('{{row.country}}-{{parent.region}}', { values: itemScopeValues({}, { country: 'US' }, { region: 'West' }) } as any)).toBe('US-West')
  })
})
