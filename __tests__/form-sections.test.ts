import { describe, expect, it } from 'vitest'
import { compactLayoutForSave, moveRow, normalizeFormLayout, placeFieldInSection, setRowSection, type FormLayout } from '@/lib/forms/layout'
import { targetFieldKeys, sanitizeFormState, FORM_STATE_KEY, initialFormState, applyCollapsed } from '@/lib/forms/form-state'
import { excludedSectionFieldKeys, isSectionIncluded, sectionBlocks, sectionConditionValue, sectionInclusionPatch, sectionKeyProblem } from '@/lib/forms/sections'
import { mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import {
  FORM_ERROR_KEY, beforeSubmitApplies, formRuleProblem, normalizeFormRules, ruleValidationErrors, ruleValue, ruleWrittenReadOnlyValues, type RuleKnown,
} from '@/lib/forms/form-rules'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { validatePage } from '@/lib/forms/pages'
import { submissionButtonIds } from '@/lib/forms/buttons'
import { addSection, convertHeadingToSection, designerSectionProblems, designerStateFrom, removeSection, updateSection, definitionFrom } from '@/lib/forms/designer-state'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { normalizeFormAssetLikeImport } from '@/lib/portability/forms'

const fields: TaskFieldDef[] = normalizeTaskFields([
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'married', label: 'Married', type: 'boolean' },
  { key: 'spouse_name', label: 'Spouse name', type: 'text', required: true },
  { key: 'spouse_dob', label: 'Spouse date of birth', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
])
const keys = fields.map((f) => f.key)

function sectioned(extra: Partial<FormLayout> & { optional?: boolean } = {}): FormLayout {
  const { optional = true, ...rest } = extra
  return normalizeFormLayout({
    rows: [
      { columns: 1, cells: [{ field_key: 'name', span: 1 }] },
      { columns: 1, cells: [{ field_key: 'married', span: 1 }] },
      { columns: 2, cells: [{ field_key: 'spouse_name', span: 1 }, { field_key: 'spouse_dob', span: 1 }], section: 'spouse' },
      { columns: 1, cells: [{ field_key: 'notes', span: 1 }] },
    ],
    sections: [{ key: 'spouse', title: 'Spouse', optional, collapsible: true }],
    ...rest,
  }, keys)!
}

describe('section model', () => {
  it('keeps declared sections and row tags; drops tags on undeclared sections and sections clashing with field keys', () => {
    const layout = normalizeFormLayout({
      rows: [
        { columns: 1, cells: [{ field_key: 'name', span: 1 }], section: 'ghost' },
        { columns: 1, cells: [{ field_key: 'spouse_name', span: 1 }], section: 'spouse' },
        { columns: 1, cells: [{ field_key: 'notes', span: 1 }], section: 'notes' },
      ],
      sections: [{ key: 'spouse', title: 'Spouse' }, { key: 'notes', title: 'Clashes with a field' }, { key: 'BAD KEY', title: 'x' }],
    }, keys)!
    expect(layout.sections).toEqual([{ key: 'spouse', title: 'Spouse' }])
    expect(layout.rows[0].section).toBeUndefined()
    expect(layout.rows[1].section).toBe('spouse')
    expect(layout.rows[2].section).toBeUndefined()
  })

  it('gathers a section’s rows into one run and keeps it on one page', () => {
    const flat = normalizeFormLayout({
      rows: [
        { columns: 1, cells: [{ field_key: 'spouse_name', span: 1 }], section: 'spouse' },
        { columns: 1, cells: [{ field_key: 'name', span: 1 }] },
        { columns: 1, cells: [{ field_key: 'spouse_dob', span: 1 }], section: 'spouse' },
      ],
      sections: [{ key: 'spouse', title: 'Spouse' }],
    }, ['name', 'spouse_name', 'spouse_dob'])!
    expect(flat.rows.map((r) => r.cells[0].field_key)).toEqual(['spouse_name', 'spouse_dob', 'name'])
    const paged = normalizeFormLayout({
      mode: 'steps', rows: [],
      pages: [
        { id: 'a', title: 'A', rows: [{ columns: 1, cells: [{ field_key: 'spouse_name', span: 1 }], section: 'spouse' }] },
        { id: 'b', title: 'B', rows: [{ columns: 1, cells: [{ field_key: 'spouse_dob', span: 1 }], section: 'spouse' }] },
      ],
      sections: [{ key: 'spouse', title: 'Spouse' }],
    }, ['spouse_name', 'spouse_dob'])!
    expect(paged.pages![0].rows[0].section).toBe('spouse')
    expect(paged.pages![1].rows[0].section).toBeUndefined()
  })

  it('cleans section options and drops unused sections', () => {
    const layout = normalizeFormLayout({
      rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }], section: 's' }],
      sections: [
        { key: 's', title: '  <b>Hi</b> ', optional: true, collapsed: true, style: 'plain', add_label: 'Add it', visible_when: { field: 'married', operator: 'equals', value: 'true' } },
        { key: 'unused', title: 'Unused' },
      ],
    }, keys)!
    expect(layout.sections).toEqual([{ key: 's', title: 'bHi/b', optional: true, style: 'plain', add_label: 'Add it', visible_when: { field: 'married', operator: 'equals', value: 'true' } }])
  })

  it('keeps an empty section (one empty row) when compacting for save, and a sectioned layout is never "trivial"', () => {
    const layout = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }, { columns: 1, cells: [], section: 'empty' }, { columns: 1, cells: [], section: 'empty' }], sections: [{ key: 'empty', title: 'Empty' }] }, ['name'])!
    const saved = compactLayoutForSave(layout, ['name'])!
    expect(saved.rows).toEqual([{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }, { columns: 1, cells: [], section: 'empty' }])
    expect(saved.sections).toEqual([{ key: 'empty', title: 'Empty' }])
  })

  it('groups rows into blocks', () => {
    const blocks = sectionBlocks(sectioned().rows)
    expect(blocks.map((b) => b.section)).toEqual([null, null, 'spouse', null])
  })

  it('grid moves: a row crosses a section edge instead of swapping; setRowSection and placeFieldInSection', () => {
    const layout = sectioned()
    const into = moveRow({ rows: layout.rows }, 1, 1)
    expect(into.rows[1].section).toBe('spouse')
    expect(into.rows.map((r) => r.cells[0].field_key)).toEqual(['name', 'married', 'spouse_name', 'notes'])
    const out = moveRow({ rows: layout.rows }, 2, 1)
    // The only row left: an empty row keeps the section on the grid.
    expect(out.rows.filter((r) => r.section === 'spouse').every((r) => r.cells.length === 0)).toBe(true)
    const moved = setRowSection({ rows: layout.rows }, 0, 'spouse')
    expect(moved.rows.filter((r) => r.section === 'spouse').map((r) => r.cells[0].field_key)).toEqual(['name', 'spouse_name'])
    const placed = placeFieldInSection({ rows: layout.rows }, 'notes', 'spouse')
    expect(placed.rows.filter((r) => r.section === 'spouse').flatMap((r) => r.cells.map((c) => c.field_key))).toEqual(['spouse_name', 'spouse_dob', 'notes'])
  })
})

describe('section targets and back-compat for section:<heading>', () => {
  it('a declared section target covers its rows', () => {
    expect(targetFieldKeys(sectioned(), 'section:spouse')).toEqual(['spouse_name', 'spouse_dob'])
  })

  it('section:<heading key> still means the heading and the rows under it, up to the next heading / divider', () => {
    const legacyFields = normalizeTaskFields([
      { key: 'h1', label: 'About you', type: 'heading' }, { key: 'a', label: 'A', type: 'text' },
      { key: 'h2', label: 'More', type: 'heading' }, { key: 'b', label: 'B', type: 'text' },
    ])
    const layout = normalizeFormLayout({ rows: legacyFields.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] })) }, legacyFields.map((f) => f.key))
    const headings = new Set(['h1', 'h2'])
    expect(targetFieldKeys(layout, 'section:h1', headings)).toEqual(['h1', 'a'])
    expect(targetFieldKeys(layout, 'section:h2', headings)).toEqual(['h2', 'b'])
  })

  it('a start-hidden section target survives normalization', () => {
    const layout = sectioned({ state: { hidden: ['section:spouse', 'section:nope'] } })
    expect(layout.state?.hidden).toEqual(['section:spouse'])
  })
})

describe('optional sections: validation and submission shape', () => {
  const layout = sectioned()
  it('excluded: its required fields are not required, and they are not checked', () => {
    expect(isSectionIncluded(layout.sections![0], {})).toBe(false)
    expect(excludedSectionFieldKeys(layout, {})).toEqual(new Set(['spouse_name', 'spouse_dob']))
    const errors = validateTaskFieldValues(fields, { name: 'Ann', spouse_dob: 'not a date' }, { layout })
    expect(errors).toEqual({})
  })

  it('included: its fields are required and checked', () => {
    const errors = validateTaskFieldValues(fields, { name: 'Ann', spouse_included: true, spouse_dob: 'not a date' }, { layout })
    expect(Object.keys(errors).sort()).toEqual(['spouse_dob', 'spouse_name'])
  })

  it('submission: an excluded section is stored empty with <key>_included: false; an included one keeps its values', () => {
    const meta = { fields, form_layout: layout, template_values: {} }
    const out = mergeTaskFieldValues(meta, { name: 'Ann', spouse_name: 'Bob', spouse_dob: '2000-01-01' })
    expect(out.errors).toEqual({})
    expect(out.templateValues).toMatchObject({ name: 'Ann', spouse_name: null, spouse_dob: null, spouse_included: false })
    const kept = mergeTaskFieldValues(meta, { name: 'Ann', spouse_included: true, spouse_name: 'Bob', spouse_dob: '2000-01-01' })
    expect(kept.errors).toEqual({})
    expect(kept.templateValues).toMatchObject({ spouse_name: 'Bob', spouse_dob: '2000-01-01', spouse_included: true })
    expect(sectionInclusionPatch(layout, {})).toEqual({ included: { spouse_included: false }, blank: ['spouse_name', 'spouse_dob'] })
  })

  it('forgery: <key>_included: false on a non-optional section does not skip its required fields', () => {
    const plain = sectioned({ optional: false })
    const meta = { fields, form_layout: plain, template_values: {} }
    const out = mergeTaskFieldValues(meta, { name: 'Ann', spouse_included: false })
    expect(out.errors.spouse_name).toBe('Spouse name is required')
    expect(out.templateValues).not.toHaveProperty('spouse_included')
  })

  it('forgery: a claimed hidden section no button or rule can hide stays shown (its fields stay required)', () => {
    const plain = sectioned({ optional: false })
    const sent = { name: 'Ann', [FORM_STATE_KEY]: { flags: {}, hidden: ['section:spouse'] } }
    expect(sanitizeFormState(fields, plain, sent).hidden).toEqual([])
    expect(validateTaskFieldValues(fields, sent, { layout: plain }).spouse_name).toBe('Spouse name is required')
  })

  it('a section key problem: clashing with a field or its <key>_included', () => {
    expect(sectionKeyProblem('name', keys)).toMatch(/field already uses/)
    expect(sectionKeyProblem('spouse', [...keys, 'spouse_included'])).toMatch(/spouse_included/)
    expect(sectionKeyProblem('ok', keys)).toBeNull()
  })
})

describe('rules targeting sections', () => {
  it('an Always rule hiding a section: its fields are not required (client and server alike)', () => {
    const layout = sectioned({ optional: false, rules: normalizeFormRules([{ id: 'r1', event: 'always', if: { match: 'all', conditions: [{ column: 'married', operator: 'neq', value: 'true' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['section:spouse'] }] }]) })
    expect(validateTaskFieldValues(fields, { name: 'Ann', married: false }, { layout })).toEqual({})
    expect(validateTaskFieldValues(fields, { name: 'Ann', married: true }, { layout }).spouse_name).toBeTruthy()
  })

  it('a section’s own Visible when hides its fields', () => {
    const layout = sectioned({ optional: false })
    layout.sections![0].visible_when = { field: 'married', operator: 'equals', value: 'true' }
    expect(validateTaskFieldValues(fields, { name: 'Ann', married: false }, { layout })).toEqual({})
    expect(validateTaskFieldValues(fields, { name: 'Ann', married: true }, { layout }).spouse_name).toBeTruthy()
  })

  it('an event rule hiding a section is a valid claim once its condition holds', () => {
    const layout = sectioned({ optional: false, rules: normalizeFormRules([{ id: 'r1', event: 'value_change', target: 'married', if: { match: 'all', conditions: [{ column: 'married', operator: 'eq', value: 'false' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['section:spouse'] }] }]) })
    const claim = { [FORM_STATE_KEY]: { flags: {}, hidden: ['section:spouse'] } }
    expect(validateTaskFieldValues(fields, { name: 'Ann', married: false, ...claim }, { layout })).toEqual({})
    expect(validateTaskFieldValues(fields, { name: 'Ann', married: true, ...claim }, { layout }).spouse_name).toBeTruthy()
  })

  it('collapse / expand: normalized to section targets, applied to the state, start collapsed read from the layout', async () => {
    const action = normalizeFieldButtonAction({ type: 'collapse_expand', mode: 'collapse', targets: ['section:spouse', 'field:name'] }, { rule: true })!
    expect(action).toEqual({ type: 'collapse_expand', mode: 'collapse', targets: ['section:spouse'] })
    expect(normalizeFieldButtonAction({ type: 'collapse_expand', targets: [] })).toBeNull()
    let state = { flags: {}, hidden: [] as string[] }
    const host = { state: () => state, setState: (s: typeof state) => { state = s }, values: () => ({}), flush: async () => {} } as unknown as FieldButtonHost
    await runFieldButton({ actions: [action] }, host)
    expect((state as { collapsed?: string[] }).collapsed).toEqual(['section:spouse'])
    expect(applyCollapsed({ flags: {}, hidden: [], collapsed: ['section:spouse'] }, 'toggle', ['section:spouse']).collapsed).toEqual([])
    const startCollapsed = sectioned()
    startCollapsed.sections![0].collapsed = true
    expect(initialFormState(startCollapsed).collapsed).toEqual(['section:spouse'])
  })

  it('section_change event, section conditions and section target checks', () => {
    const [rule] = normalizeFormRules([{ id: 'r1', event: 'section_change', target: 'spouse', then: [{ type: 'collapse_expand', mode: 'expand', targets: ['section:spouse'] }] }])
    expect(rule.target).toBe('spouse')
    const known: RuleKnown = { fieldKeys: new Set(keys), valueKeys: new Set(keys), fieldTypes: new Map(), pageIds: new Set(), flags: new Set(), sectionKeys: new Set(['spouse']), headingKeys: new Set() }
    expect(formRuleProblem(rule, known)).toBeNull()
    expect(formRuleProblem({ ...rule, target: 'nope' }, known)).toMatch(/not a section/)
    expect(formRuleProblem({ id: 'x', event: 'value_change', target: 'name', then: [{ type: 'show_hide', mode: 'hide', targets: ['section:spouse'] }] }, known)).toBeNull()
    expect(formRuleProblem({ id: 'x', event: 'value_change', target: 'name', then: [{ type: 'collapse_expand', mode: 'hide' as never, targets: ['section:other'] }] }, known)).toMatch(/not a section/)
    expect(ruleValue('section.spouse.included', { values: { spouse_included: true } })).toBe(true)
    expect(ruleValue('section.spouse.included', { values: {} })).toBe(false)
    expect(ruleValue('section.spouse.visible', { values: {}, state: { flags: {}, hidden: ['section:spouse'] } })).toBe(false)
    expect(sectionConditionValue('section.spouse.visible', {})).toBe(true)
    expect(sectionConditionValue('section.x', {})).toBeNull()
  })
})

describe('designer section operations', () => {
  const def = () => normalizeFormDefinition({
    fields: [{ key: 'h', label: 'Contact', type: 'heading', help_text: 'How we reach you' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'phone', label: 'Phone', type: 'phone' }, { key: 'd', label: '', type: 'divider' }, { key: 'other', label: 'Other', type: 'text' }],
    layout: {
      rows: [
        { columns: 1, cells: [{ field_key: 'h', span: 1 }] }, { columns: 2, cells: [{ field_key: 'email', span: 1 }, { field_key: 'phone', span: 1 }] },
        { columns: 1, cells: [{ field_key: 'd', span: 1 }] }, { columns: 1, cells: [{ field_key: 'other', span: 1 }] },
      ],
      state: { hidden: ['section:h'] },
    },
  })

  it('converts a heading into a section: the rows up to the next divider, its targets rewritten', () => {
    const state = designerStateFrom(def())
    const heading = state.fields.find((f) => f.key === 'h')!
    const r = convertHeadingToSection(state, heading._id)!
    expect(r.key).toBe('contact')
    const out = definitionFrom(r.state)
    expect(out.fields.map((f) => f.key)).toEqual(['email', 'phone', 'd', 'other'])
    expect(out.layout!.sections).toEqual([{ key: 'contact', title: 'Contact', description: 'How we reach you' }])
    expect(out.layout!.rows.map((row) => row.section ?? null)).toEqual(['contact', null, null])
    expect(out.layout!.state?.hidden).toEqual(['section:contact'])
  })

  it('adds, renames (references follow) and removes a section', () => {
    let state = designerStateFrom(def())
    const added = addSection(state, null, { title: 'Extra' })
    state = added.state
    expect(added.key).toBe('extra')
    state = { ...state, layout: { ...state.layout, rules: normalizeFormRules([{ id: 'r', event: 'section_change', target: 'extra', if: { match: 'all', conditions: [{ column: 'section.extra.included', operator: 'eq', value: 'true' }] }, then: [{ type: 'show_hide', mode: 'show', targets: ['section:extra'] }] }]) } }
    state = updateSection(state, 'extra', { key: 'more', optional: true })
    expect(state.layout.sections?.map((s) => s.key)).toContain('more')
    expect(state.layout.rows.some((r) => r.section === 'more')).toBe(true)
    const rule = state.layout.rules![0]
    expect(rule.target).toBe('more')
    expect(rule.then[0].targets).toEqual(['section:more'])
    expect((rule.if!.conditions[0] as { column: string }).column).toBe('section.more.included')
    expect(designerSectionProblems(updateSection(state, 'more', { key: 'email' }))).toHaveProperty('email')
    state = removeSection(state, 'more')
    expect(state.layout.sections).toBeUndefined()
    expect(state.layout.rules![0].then[0].targets).toEqual([])
  })
})

describe('engine gaps', () => {
  const paged = (rules: unknown[]) => normalizeFormLayout({
    mode: 'steps', rows: [],
    pages: [
      { id: 'one', title: 'One', rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] },
      { id: 'two', title: 'Two', rows: [{ columns: 1, cells: [{ field_key: 'notes', span: 1 }] }] },
    ],
    rules,
  }, ['name', 'notes'])!
  const twoFields = normalizeTaskFields([{ key: 'name', label: 'Name', type: 'text' }, { key: 'notes', label: 'Notes', type: 'text' }])

  it('(a) a step’s Next ignores Before-submit rules (unless step_check) and errors on other steps’ fields', () => {
    const blockOther = { id: 'b1', event: 'before_submit', then: [{ type: 'field_error', field: 'notes', text: 'Notes needed' }] }
    const blockForm = { id: 'b2', event: 'before_submit', then: [{ type: 'block_submit', text: 'Not yet' }] }
    expect(validatePage(twoFields, paged([blockOther, blockForm]), 'one', { name: 'x' })).toEqual({})
    // At submit both apply.
    expect(validateTaskFieldValues(twoFields, { name: 'x' }, { layout: paged([blockOther, blockForm]) })).toEqual({ notes: 'Notes needed', [FORM_ERROR_KEY]: 'Not yet' })
    // "Also check on this step": a rule on this step's field blocks Next.
    const here = { id: 'b3', event: 'before_submit', step_check: true, then: [{ type: 'field_error', field: 'name', text: 'Check the name' }] }
    expect(validatePage(twoFields, paged([here]), 'one', { name: 'x' })).toEqual({ name: 'Check the name' })
    // An Always rule's error on another step's field never blocks Next.
    const always = { id: 'a1', event: 'always', if: { match: 'all', conditions: [{ column: 'name', operator: 'eq', value: 'x' }] }, then: [{ type: 'field_error', field: 'notes', text: 'No' }] }
    expect(validatePage(twoFields, paged([always]), 'one', { name: 'x' })).toEqual({})
    expect(normalizeFormRules([{ ...here }])[0].step_check).toBe(true)
    expect(normalizeFormRules([{ id: 'v', event: 'value_change', target: 'name', step_check: true, then: [] }])[0].step_check).toBeUndefined()
  })

  it('(b) the server respects a Before-submit rule’s bar-button target', () => {
    const layout = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }], rules: [{ id: 'r', event: 'before_submit', target: 'approve', then: [{ type: 'block_submit', text: 'Approve needs a name' }] }] }, ['name'])
    expect(ruleValidationErrors(layout, {}, { buttonIds: ['reject'] })).toEqual({})
    expect(ruleValidationErrors(layout, {}, { buttonIds: ['approve'] })).toEqual({ [FORM_ERROR_KEY]: 'Approve needs a name' })
    expect(ruleValidationErrors(layout, {}, {})).toEqual({ [FORM_ERROR_KEY]: 'Approve needs a name' })
    const meta = { fields: twoFields, form_layout: layout, template_values: {} }
    expect(mergeTaskFieldValues(meta, { name: '' }, { buttonIds: ['reject'] }).errors).toEqual({})
    expect(mergeTaskFieldValues(meta, { name: '' }, { buttonIds: ['approve'] }).errors).toEqual({ [FORM_ERROR_KEY]: 'Approve needs a name' })
    expect(beforeSubmitApplies({ event: 'before_submit', target: 'approve' }, { buttonIds: ['approve'], phase: 'step' })).toBe(false)
    const bar = [{ id: 'approve', kind: 'outcome', label: 'Approve', outcome: 'Approved' }, { id: 'reject', kind: 'outcome', label: 'Reject', outcome: 'Rejected' }]
    expect(submissionButtonIds(bar, { outcome: 'Rejected' })).toEqual(['reject'])
    expect(submissionButtonIds(bar, { buttonId: 'approve', outcome: 'Rejected' })).toEqual(['approve'])
    expect(submissionButtonIds(undefined, { outcome: 'Rejected' })).toBeNull()
  })

  it('(c) rules may write read-only fields; the server keeps only values a rule could produce', () => {
    const roFields = normalizeTaskFields([{ key: 'qty', label: 'Qty', type: 'number' }, { key: 'code', label: 'Code', type: 'text', read_only: true }, { key: 'picked', label: 'Picked', type: 'text', read_only: true }])
    const layout = normalizeFormLayout({
      rows: roFields.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] })),
      rules: [
        { id: 'set', event: 'value_change', target: 'qty', if: { match: 'all', conditions: [{ column: 'qty', operator: 'gt', value: '5' }] }, then: [{ type: 'set_values', assign: { code: 'BULK-{{qty}}' } }] },
        { id: 'row', event: 'row_click', target: 'tbl', then: [{ type: 'copy_values', assign: { picked: '{{event.row.name}}' } }] },
      ],
    }, roFields.map((f) => f.key))
    expect(ruleWrittenReadOnlyValues(layout, ['code'], { qty: 9, code: 'BULK-9' })).toEqual({ code: 'BULK-9' })
    expect(ruleWrittenReadOnlyValues(layout, ['code'], { qty: 9, code: 'FREE' })).toEqual({})
    expect(ruleWrittenReadOnlyValues(layout, ['code'], { qty: 2, code: 'BULK-2' })).toEqual({})
    // From the event (the server cannot rebuild it): trusted like a click — but only because a rule writes that field.
    expect(ruleWrittenReadOnlyValues(layout, ['picked'], { picked: 'Anything' })).toEqual({ picked: 'Anything' })
    const meta = { fields: roFields, form_layout: layout, template_values: { code: 'ORIG' } }
    expect(mergeTaskFieldValues(meta, { qty: 9, code: 'BULK-9' }).templateValues.code).toBe('BULK-9')
    expect(mergeTaskFieldValues(meta, { qty: 9, code: 'HACK' }).templateValues.code).toBe('ORIG')
    // Without any rule writing it, a read-only field is never taken from the client.
    const bare = { fields: roFields, form_layout: normalizeFormLayout({ rows: [] }, roFields.map((f) => f.key)), template_values: { code: 'ORIG' } }
    expect(mergeTaskFieldValues(bare, { code: 'HACK' }).templateValues.code).toBe('ORIG')
    // The designer accepts a read-only target for rules.
    const known: RuleKnown = { fieldKeys: new Set(['qty', 'code']), valueKeys: new Set(['qty']), writableKeys: new Set(['qty', 'code']), fieldTypes: new Map(), pageIds: new Set(), flags: new Set() }
    expect(formRuleProblem(normalizeFormRules([{ id: 's', event: 'value_change', target: 'qty', then: [{ type: 'set_values', assign: { code: '1' } }] }])[0], known)).toBeNull()
  })

  it('(d) headings and dividers keep Visible when, and hide like fields', () => {
    const list = normalizeTaskFields([
      { key: 'married', label: 'Married', type: 'boolean' },
      { key: 'h', label: 'Spouse', type: 'heading', visible_when: { field: 'married', operator: 'equals', value: 'true' } },
      { key: 'd', label: '', type: 'divider', visible_when: { field: 'married', operator: 'equals', value: 'true' } },
    ])
    expect(list[1].visible_when).toEqual({ field: 'married', operator: 'equals', value: 'true' })
    expect(list[2].visible_when).toEqual({ field: 'married', operator: 'equals', value: 'true' })
  })
})

describe('portability', () => {
  it('a sectioned form survives export / import normalization and a JSON round trip', () => {
    const layout = sectioned({ rules: normalizeFormRules([{ id: 'r', event: 'section_change', target: 'spouse', then: [{ type: 'collapse_expand', mode: 'collapse', targets: ['section:spouse'] }] }]) })
    const asset = { name: 'Household', fields, layout: compactLayoutForSave(layout, keys), theme: { source: 'workspace' } }
    const exported = JSON.parse(JSON.stringify(normalizeFormAssetLikeImport(asset)))
    const imported = normalizeFormAssetLikeImport(exported)
    expect(imported.layout.sections).toEqual([{ key: 'spouse', title: 'Spouse', optional: true, collapsible: true }])
    expect(imported.layout.rows.find((r: { section?: string }) => r.section === 'spouse').cells.map((c: { field_key: string }) => c.field_key)).toEqual(['spouse_name', 'spouse_dob'])
    expect(imported.layout.rules[0]).toMatchObject({ event: 'section_change', target: 'spouse' })
    expect(imported).toEqual(normalizeFormAssetLikeImport(imported))
  })
})

describe('{{control.<section>.*}} (rule variables)', () => {
  it('lists section controls in the Controls group and derives their state; the server re-derives them from the sanitized state', async () => {
    const { controlVariables, controlState, serverControlEntries, layoutSectionControls } = await import('@/lib/forms/rule-variables')
    const { CONTROLS_KEY } = await import('@/lib/forms/form-params')
    const layout = sectioned()
    const sections = layoutSectionControls(layout)
    const vars = controlVariables(fields, [], sections).map((v) => v.path)
    expect(vars).toEqual(expect.arrayContaining(['control.spouse.included', 'control.spouse.visible']))
    expect(controlState(fields, { spouse_included: true }, [], sections).spouse).toEqual({ included: true, visible: true, loaded: true })
    expect(controlState(fields, { [FORM_STATE_KEY]: { flags: {}, hidden: ['section:spouse'] } }, [], sections).spouse).toEqual({ included: false, visible: false, loaded: true })
    expect(serverControlEntries(layout, fields, { spouse_included: true })).toEqual({ [CONTROLS_KEY]: { spouse: { included: true, visible: true, loaded: true } } })
    // A rule reading control.spouse.visible: a forged hide (nothing can hide the section) does not count on the server.
    const plain = sectioned({ optional: false, rules: normalizeFormRules([{ id: 'b', event: 'before_submit', if: { match: 'all', conditions: [{ column: 'control.spouse.visible', operator: 'eq', value: 'false' }] }, then: [{ type: 'block_submit', text: 'Hidden!' }] }]) })
    const forged = { name: 'Ann', spouse_name: 'Bob', [FORM_STATE_KEY]: { flags: {}, hidden: ['section:spouse'] }, [CONTROLS_KEY]: { spouse: { included: true, visible: false } } }
    expect(validateTaskFieldValues(fields, forged, { layout: plain })).toEqual({})
  })
})
