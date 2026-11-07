/**
 * Steps & tabs: the paged layout schema (back-compatible normalisation and
 * storage), the designer's page operations (add / move / duplicate /
 * delete with field reassignment, mode switches, field moves, renames),
 * the runtime arithmetic (progress with conditional steps and the review
 * step, per-step validation, error counts per tab) and validation across
 * pages on the client and the server (hidden pages' fields not required,
 * every visible field still checked).
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import {
  allRows, compactLayoutForSave, findCell, isPaged, layoutKeyOrder, normalizeFormLayout, removeFieldFromLayout, renameLayoutKey, setCellSpan,
  type FormLayout,
} from '@/lib/forms/layout'
import {
  REVIEW_STEP_ID, addPage, firstPageWithError, moveFieldToPage, movePage, movePageTo, pageErrorCounts, pageProblems, pageSettings, removePage,
  resolveCurrentStep, setPageMode, stepProgress, updatePage, updatePageSettings, validatePage, visiblePages, wizardSteps,
} from '@/lib/forms/pages'
import { addField, definitionFrom, deletePage, designerStateFrom, duplicatePage, removeField, updateField } from '@/lib/forms/designer-state'
import { normalizeFormDefinition, formDefinitionKey } from '@/lib/forms/definition'
import { startFormConfig, startFormFromVariables } from '@/lib/forms/start-form'
import { hiddenPageFieldKeys, mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'

const FIELDS = normalizeTaskFields([
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'email', label: 'Email', type: 'email', required: true },
  { key: 'kind', label: 'Kind', type: 'choice', options: ['Personal', 'Business'], required: true },
  { key: 'company', label: 'Company', type: 'text', required: true },
  { key: 'vat', label: 'VAT number', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'agree', label: 'I agree', type: 'boolean', required: true },
])
const KEYS = FIELDS.map((f) => f.key)

const RAW_STEPS = {
  mode: 'steps',
  rows: [],
  page_settings: { indicator: 'progress', review: true, next_label: 'Continue' },
  pages: [
    { id: 'you', title: 'About you', icon: 'user', rows: [{ columns: 2, cells: [{ field_key: 'name', span: 1 }, { field_key: 'email', span: 1 }] }, { columns: 1, cells: [{ field_key: 'kind', span: 1 }] }] },
    { id: 'biz', title: 'Your business', visible_when: { field: 'kind', operator: 'equals', value: 'Business' }, rows: [{ columns: 2, cells: [{ field_key: 'company', span: 1 }, { field_key: 'vat', span: 1 }] }] },
    { id: 'more', title: 'Anything else', description: 'Optional notes', rows: [{ columns: 1, cells: [{ field_key: 'notes', span: 1 }] }] },
    { id: 'confirm', title: 'Confirm', rows: [{ columns: 1, cells: [{ field_key: 'agree', span: 1 }] }] },
  ],
}

const steps = () => normalizeFormLayout(RAW_STEPS, KEYS)!

describe('paged layout schema', () => {
  it('a layout without pages normalises exactly as before', () => {
    const raw = { rows: [{ columns: 2, cells: [{ field_key: 'name', span: 1 }, { field_key: 'email', span: 1 }] }] }
    const layout = normalizeFormLayout(raw, KEYS)!
    expect(isPaged(layout)).toBe(false)
    expect(layout.mode).toBeUndefined()
    expect(layout.pages).toBeUndefined()
    expect(layout.rows[0].cells.map((c) => c.field_key)).toEqual(['name', 'email'])
    expect(layout.rows.length).toBe(1 + KEYS.length - 2)
    expect(normalizeFormLayout(null, KEYS)).toBeNull()
    expect(compactLayoutForSave({ rows: KEYS.map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] })) }, KEYS)).toBeNull()
  })

  it('keeps pages, settings, icons and rules; every field on exactly one page', () => {
    const layout = steps()
    expect(isPaged(layout)).toBe(true)
    expect(layout.mode).toBe('steps')
    expect(layout.rows).toEqual([])
    expect(layout.pages!.map((p) => p.id)).toEqual(['you', 'biz', 'more', 'confirm'])
    expect(layout.pages![0].icon).toBe('user')
    expect(layout.pages![1].visible_when).toEqual({ field: 'kind', operator: 'equals', value: 'Business' })
    expect(layout.pages![2].description).toBe('Optional notes')
    expect(layout.page_settings).toEqual({ indicator: 'progress', review: true, next_label: 'Continue' })
    expect(layoutKeyOrder(layout)).toEqual(KEYS)
    expect(allRows(layout).length).toBe(5)
  })

  it('unplaced fields land on the last page; duplicates, bad ids, unknown icons and rules on unknown fields are cleaned', () => {
    const layout = normalizeFormLayout({
      mode: 'tabs',
      pages: [
        { id: 'a b', title: '', icon: 'rocket', visible_when: { field: 'nope', operator: 'is_set' }, rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] },
        { id: 'x', title: '<b>Two</b>', rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }, { field_key: 'email', span: 1 }] }] },
        { id: 'x', title: 'Three', rows: [] },
      ],
    }, KEYS)!
    expect(layout.pages!.map((p) => p.id)).toEqual(['page_1', 'x', 'x_3'])
    expect(layout.pages![0].title).toBe('Tab 1')
    expect(layout.pages![0].icon).toBeUndefined()
    expect(layout.pages![0].visible_when).toBeUndefined()
    expect(layout.pages![1].title).toBe('bTwo/b')
    expect(layout.pages![1].rows[0].cells.map((c) => c.field_key)).toEqual(['email'])
    const last = layout.pages![2]
    expect(last.rows.flatMap((r) => r.cells.map((c) => c.field_key))).toEqual(['kind', 'company', 'vat', 'notes', 'agree'])
  })

  it('pages without a steps / tabs mode collapse into the single grid (nothing lost)', () => {
    const layout = normalizeFormLayout({ ...RAW_STEPS, mode: 'wizard' }, KEYS)!
    expect(isPaged(layout)).toBe(false)
    expect(layoutKeyOrder(layout)).toEqual(KEYS)
  })

  it('older readers (rows only) still place every field', () => {
    // What a reader that only knows `rows` does with a stored paged layout: one row per field.
    const stored = compactLayoutForSave(steps(), KEYS)!
    const legacy = normalizeFormLayout({ rows: stored.rows }, KEYS)!
    expect(layoutKeyOrder(legacy)).toEqual(KEYS)
  })

  it('stores compactly and round-trips through the form definition (versions, export, packages)', () => {
    const stored = compactLayoutForSave(steps(), KEYS)!
    expect(stored.mode).toBe('steps')
    expect(stored.pages).toHaveLength(4)
    expect(stored.pages![1].visible_when?.field).toBe('kind')
    const def = normalizeFormDefinition({ fields: FIELDS, layout: JSON.parse(JSON.stringify(stored)) })
    expect(def.layout).toEqual(steps())
    expect(formDefinitionKey(def)).toBe(formDefinitionKey(normalizeFormDefinition({ fields: FIELDS, layout: RAW_STEPS })))
    // Empty pages are kept (the author may be filling them in).
    const withEmpty = addPage(steps()).layout
    expect(compactLayoutForSave(withEmpty, KEYS)!.pages).toHaveLength(5)
  })

  it('a start form keeps its pages through the variable-name mapping', () => {
    const variables = [{ name: 'customerName', type: 'string' }, { name: 'rush', type: 'boolean' }]
    const config = { start_form: { layout: { mode: 'tabs', rows: [], pages: [{ id: 'one', title: 'Customer', rows: [{ columns: 1, cells: [{ field_key: 'customerName', span: 1 }] }] }, { id: 'two', title: 'Options', rows: [{ columns: 1, cells: [{ field_key: 'rush', span: 1 }] }] }] } } }
    const model = startFormFromVariables(variables as any, config)
    expect(isPaged(model.def.layout)).toBe(true)
    const key = [...model.nameByKey].find(([, name]) => name === 'customerName')![0]
    expect(model.def.layout!.pages![0].rows[0].cells[0].field_key).toBe(key)
    const saved = startFormConfig(model.def, model.nameByKey)!
    expect(saved.layout!.pages![0].rows[0].cells[0].field_key).toBe('customerName')
    expect(saved.layout!.mode).toBe('tabs')
  })
})

describe('page operations', () => {
  it('switches mode: single → steps (one page), steps ↔ tabs (default titles follow), → single (flattened)', () => {
    const single = normalizeFormLayout({ rows: [{ columns: 2, cells: [{ field_key: 'name', span: 1 }, { field_key: 'email', span: 1 }] }] }, KEYS)!
    const paged = setPageMode(single, 'steps')
    expect(paged.pages).toHaveLength(1)
    expect(paged.pages![0].title).toBe('Step 1')
    expect(layoutKeyOrder(paged)).toEqual(layoutKeyOrder(single))
    const more = addPage(paged).layout
    const tabs = setPageMode(updatePage(more, 'page_1', { title: 'Contact' }), 'tabs')
    expect(tabs.pages!.map((p) => p.title)).toEqual(['Contact', 'Tab 2'])
    const flat = setPageMode(steps(), 'single')
    expect(isPaged(flat)).toBe(false)
    expect(layoutKeyOrder(flat)).toEqual(KEYS)
  })

  it('adds, renames, reorders (drag and keyboard)', () => {
    const { layout, id } = addPage(steps(), { after: 'you' })
    expect(layout.pages!.map((p) => p.id)).toEqual(['you', id, 'biz', 'more', 'confirm'])
    expect(layout.pages![1].title).toBe('Step 5')
    expect(movePageTo(layout, 'confirm', 0).pages![0].id).toBe('confirm')
    expect(movePage(layout, 'you', -1)).toBe(layout)
    expect(movePage(layout, 'you', 1).pages!.map((p) => p.id).slice(0, 2)).toEqual([id, 'you'])
    const renamed = updatePage(layout, id, { title: 'Address', icon: 'map-pin', description: 'Where we deliver' })
    expect(renamed.pages![1]).toMatchObject({ title: 'Address', icon: 'map-pin', description: 'Where we deliver' })
    expect(updatePage(renamed, id, { icon: undefined }).pages![1].icon).toBeUndefined()
  })

  it('deletes a page moving its fields to another, or with its fields; never the last page', () => {
    const moved = removePage(steps(), 'biz', 'you')
    expect(moved.removedKeys).toEqual([])
    expect(moved.layout.pages!.map((p) => p.id)).toEqual(['you', 'more', 'confirm'])
    expect(moved.layout.pages![0].rows.flatMap((r) => r.cells.map((c) => c.field_key))).toEqual(['name', 'email', 'kind', 'company', 'vat'])
    const dropped = removePage(steps(), 'biz', null)
    expect(dropped.removedKeys).toEqual(['company', 'vat'])
    expect(layoutKeyOrder(dropped.layout)).not.toContain('company')
    const one = normalizeFormLayout({ mode: 'tabs', pages: [{ id: 'only', title: 'Only', rows: [] }] }, KEYS)!
    expect(removePage(one, 'only', null).layout).toBe(one)
  })

  it('moves a field to another page (a row it empties goes too)', () => {
    const layout = moveFieldToPage(steps(), 'kind', 'confirm')
    expect(layout.pages![0].rows).toHaveLength(1)
    expect(layout.pages![3].rows.flatMap((r) => r.cells.map((c) => c.field_key))).toEqual(['agree', 'kind'])
    expect(findCell(layout, 'kind')).toEqual({ row: 1, index: 0, page: 'confirm' })
    expect(moveFieldToPage(layout, 'kind', 'confirm')).toBe(layout)
  })

  it('renames and removals reach cells and page rules; spans work on any page', () => {
    const renamed = renameLayoutKey(steps(), 'kind', 'customer_type')
    expect(renamed.pages![1].visible_when?.field).toBe('customer_type')
    expect(renamed.pages![0].rows[1].cells[0].field_key).toBe('customer_type')
    const removed = removeFieldFromLayout(steps(), 'kind')
    expect(removed.pages![1].visible_when).toBeUndefined()
    expect(setCellSpan(steps(), 'company', 2).pages![1].rows[0].cells[0].span).toBe(1)
    const wide = setCellSpan(removeFieldFromLayout(steps(), 'vat'), 'company', 2)
    expect(wide.pages![1].rows[0].cells[0].span).toBe(2)
  })

  it('settings patch normalises (defaults dropped) and resolves defaults', () => {
    const layout = updatePageSettings(steps(), { next_label: '', allow_skip: true, indicator: 'dots' })
    expect(layout.page_settings).toEqual({ indicator: 'dots', review: true, allow_skip: true })
    expect(pageSettings(layout)).toMatchObject({ next_label: 'Next', back_label: 'Back', review_title: 'Review your answers', allow_skip: true })
  })

  it('problems: a page needs a title; a steps rule must use an earlier step', () => {
    const bad = updatePage(updatePage(steps(), 'more', { title: ' ' }), 'you', { visible_when: { field: 'agree', operator: 'is_set' } })
    const problems = pageProblems(bad)
    expect(problems.blocking.more).toMatch(/needs a title/)
    expect(problems.warnings.you).toMatch(/earlier step/)
    expect(problems.warnings.biz).toBeUndefined()
  })
})

describe('designer state with pages', () => {
  const state = () => designerStateFrom(normalizeFormDefinition({ fields: FIELDS, layout: RAW_STEPS }))

  it('adds a field to the active page, duplicates a page with its fields, deletes with reassignment', () => {
    const { state: added, field } = addField(state(), 'number', undefined, 'more')
    expect(findCell(added.layout, field.key)?.page).toBe('more')
    const dup = duplicatePage(added, 'biz')!
    const copyPage = dup.state.layout.pages!.find((p) => p.id === dup.id)!
    expect(dup.state.layout.pages!.map((p) => p.id).indexOf(dup.id)).toBe(2)
    expect(copyPage.title).toBe('Your business (copy)')
    expect(copyPage.visible_when?.field).toBe('kind')
    const copyKeys = copyPage.rows.flatMap((r) => r.cells.map((c) => c.field_key))
    expect(copyKeys).toEqual(['company_2', 'vat_2'])
    expect(dup.state.fields.find((f) => f.key === 'company_2')?.label).toBe('Company (copy)')
    const moved = deletePage(dup.state, dup.id, 'more')
    expect(moved.fields.some((f) => f.key === 'company_2')).toBe(true)
    expect(findCell(moved.layout, 'company_2')?.page).toBe('more')
    const gone = deletePage(dup.state, dup.id, null)
    expect(gone.fields.some((f) => f.key === 'company_2')).toBe(false)
  })

  it('a key rename and a field removal update page rules; the saved definition keeps page order', () => {
    const s = state()
    const kind = s.fields.find((f) => f.key === 'kind')!
    const renamed = updateField(s, kind._id, { key: 'customer_type' })
    expect(renamed.layout.pages![1].visible_when?.field).toBe('customer_type')
    const removed = removeField(s, kind._id)
    expect(removed.layout.pages![1].visible_when).toBeUndefined()
    const def = definitionFrom(s)
    expect(def.fields.map((f) => f.key)).toEqual(KEYS)
    expect(isPaged(def.layout)).toBe(true)
  })
})

describe('runtime: progress, conditional steps, validation', () => {
  it('hidden steps do not count; the review step does', () => {
    const layout = steps()
    expect(visiblePages(layout, { kind: 'Personal' }).map((p) => p.id)).toEqual(['you', 'more', 'confirm'])
    expect(wizardSteps(layout, { kind: 'Personal' }).map((s) => s.id)).toEqual(['you', 'more', 'confirm', REVIEW_STEP_ID])
    expect(stepProgress(layout, { kind: 'Personal' }, 'more')).toMatchObject({ index: 1, total: 4, percent: 50, label: 'Step 2 of 4' })
    expect(stepProgress(layout, { kind: 'Business' }, 'more')).toMatchObject({ index: 2, total: 5, percent: 60, label: 'Step 3 of 5' })
    expect(stepProgress(layout, { kind: 'Business' }, REVIEW_STEP_ID).percent).toBe(100)
    // Tabs never get a review step.
    expect(wizardSteps(setPageMode(layout, 'tabs'), {}).map((s) => s.id)).not.toContain(REVIEW_STEP_ID)
  })

  it('a step whose rule stops holding falls back to the nearest earlier shown step', () => {
    const layout = steps()
    expect(resolveCurrentStep(layout, { kind: 'Business' }, 'biz')).toBe('biz')
    expect(resolveCurrentStep(layout, { kind: 'Personal' }, 'biz')).toBe('you')
    expect(resolveCurrentStep(layout, {}, 'unknown')).toBe('you')
  })

  it('Next checks only the current step', () => {
    const layout = steps()
    expect(Object.keys(validatePage(FIELDS, layout, 'you', {}))).toEqual(['name', 'email', 'kind'])
    expect(validatePage(FIELDS, layout, 'you', { name: 'Ann', email: 'not-an-email', kind: 'Personal' })).toEqual({ email: expect.stringMatching(/email/i) })
    expect(validatePage(FIELDS, layout, 'more', {})).toEqual({})
    expect(Object.keys(validatePage(FIELDS, layout, 'biz', { kind: 'Business' }))).toEqual(['company'])
  })

  it('error badges per page and the first page with an error (shown pages only)', () => {
    const layout = setPageMode(steps(), 'tabs')
    const errors = { company: 'Company is required', agree: 'I agree is required', email: 'bad' }
    expect(pageErrorCounts(layout, errors)).toEqual({ you: 1, biz: 1, confirm: 1 })
    expect(firstPageWithError(layout, { company: 'x', agree: 'y' }, { kind: 'Business' })).toBe('biz')
    expect(firstPageWithError(layout, { company: 'x', agree: 'y' }, { kind: 'Personal' })).toBe('confirm')
    expect(firstPageWithError(layout, {}, {})).toBeNull()
  })
})

describe('validation across pages (client and server)', () => {
  const full = { name: 'Ann', email: 'ann@example.com', kind: 'Personal', agree: true }

  it('fields on a hidden page are not required; every visible field is still checked', () => {
    const layout = steps()
    expect(validateTaskFieldValues(FIELDS, full, { layout })).toEqual({})
    // Without the layout the hidden step's required field would block.
    expect(validateTaskFieldValues(FIELDS, full)).toHaveProperty('company')
    const business = validateTaskFieldValues(FIELDS, { ...full, kind: 'Business' }, { layout })
    expect(Object.keys(business)).toEqual(['company'])
    // Fields on other (visible) pages are validated too.
    expect(validateTaskFieldValues(FIELDS, { ...full, agree: false }, { layout })).toHaveProperty('agree')
    expect(hiddenPageFieldKeys(RAW_STEPS, { kind: 'Personal' })).toEqual(new Set(['company', 'vat']))
    // A rule on a field the form no longer has hides nothing.
    expect(hiddenPageFieldKeys({ ...RAW_STEPS, pages: [{ ...RAW_STEPS.pages[1], visible_when: { field: 'gone', operator: 'is_set' } }] }, {}, new Set(KEYS)).size).toBe(0)
  })

  it('the server path (task metadata form_layout) applies the same rule', () => {
    const metadata = { fields: FIELDS, form_layout: compactLayoutForSave(steps(), KEYS), template_values: {} }
    expect(mergeTaskFieldValues(metadata, full).errors).toEqual({})
    expect(Object.keys(mergeTaskFieldValues(metadata, { ...full, kind: 'Business' }).errors)).toEqual(['company'])
    expect(Object.keys(mergeTaskFieldValues({ ...metadata, form_layout: undefined }, full).errors)).toEqual(['company'])
  })

  it('a stored layout of another shape is ignored by the server check', () => {
    const odd: FormLayout = { rows: [] } as FormLayout
    expect(hiddenPageFieldKeys(odd, {}).size).toBe(0)
    expect(hiddenPageFieldKeys('nonsense', {}).size).toBe(0)
  })
})
