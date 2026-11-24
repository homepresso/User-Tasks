/**
 * Reserved keys are refused clearly instead of silently dropped:
 *  - a form field named `outcome` (the task's outcome) or another reserved name
 *    was dropped by normalizeTaskFields, so its value vanished on submit;
 *  - a repeating section's inner control named item / row / parent / index /
 *    form (the item scope's names) was dropped the same way;
 *  - a parameter / variable named with a reserved name was dropped too.
 * Saving (validateFormContent), the gallery validator and the designer say so.
 */
import { describe, expect, it } from 'vitest'
import { normalizeTaskFields, reservedFieldKeyProblems } from '@/lib/task-field-schema'
import { validateFormContent } from '@/lib/services/forms'
import { formIssues } from '@/lib/gallery/validate'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { designerProblems, designerStateFrom, keyProblemFor, newField, sectionView, takenKeys } from '@/lib/forms/designer-state'

const section = (inner: Array<Record<string, unknown>>) => ({ key: 'lines', label: 'Lines', type: 'repeating_section', repeating_section: { fields: inner } })

describe('a field named "outcome" (gap: silently emptied on submit)', () => {
  it('the normaliser drops it — which is why it must be refused on save', () => {
    expect(normalizeTaskFields([{ key: 'outcome', label: 'Outcome', type: 'text' }])).toEqual([])
  })

  it('reservedFieldKeyProblems names it with a plain reason', () => {
    const problems = reservedFieldKeyProblems([{ key: 'outcome', label: 'Outcome', type: 'choice', options: ['Won', 'Lost'] }, { key: 'note', label: 'Note', type: 'text' }])
    expect(Object.keys(problems)).toEqual(['outcome'])
    expect(problems.outcome).toMatch(/reserved for the task's outcome/)
    // A label that slugs to a reserved key counts too.
    expect(Object.keys(reservedFieldKeyProblems([{ label: 'ID', type: 'text' }]))).toEqual(['id'])
  })

  it('saving the form refuses it (validateFormContent)', () => {
    expect(() => validateFormContent({ fields: [{ key: 'outcome', label: 'Outcome', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }] })).toThrow(/Field "outcome": "outcome" is reserved/)
    expect(() => validateFormContent({ fields: [{ key: 'result', label: 'Outcome', type: 'text' }] })).not.toThrow()
  })

  it('a reserved parameter name is refused too', () => {
    expect(() => validateFormContent({ fields: [{ key: 'result', label: 'Result', type: 'text' }], layout: { rows: [], params: [{ name: 'outcome', type: 'text' }] } })).toThrow(/parameter "outcome" is reserved/)
  })

  it('the gallery validator reports it', () => {
    const raw = [{ key: 'outcome', label: 'Outcome', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }]
    const issues = formIssues(normalizeFormDefinition({ fields: raw }), new Map(), 'pkg/forms', null, raw)
    expect(issues.map((i) => i.message)).toContain('field "outcome": "outcome" is reserved for the task\'s outcome (the button pressed): rename the field, e.g. "outcome_choice"')
  })
})

describe('repeating-section inner keys item / row / parent / index / form (gap: silently dropped)', () => {
  it('the normaliser drops them inside a section (but not at the top level)', () => {
    const [lines] = normalizeTaskFields([section([{ key: 'item', label: 'Item', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }])])
    expect(lines.repeating_section?.fields.map((f) => f.key)).toEqual(['qty'])
    expect(normalizeTaskFields([{ key: 'item', label: 'Item', type: 'text' }]).map((f) => f.key)).toEqual(['item'])
  })

  it('every scope name is refused inside a section, at any level, with the section path', () => {
    for (const name of ['item', 'row', 'parent', 'index', 'form']) {
      const problems = reservedFieldKeyProblems([section([{ key: name, label: name, type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }])])
      expect(problems[`lines.${name}`]).toMatch(/can't be used inside a repeating section/)
    }
    const nested = reservedFieldKeyProblems([section([{ key: 'stops', label: 'Stops', type: 'repeating_section', repeating_section: { fields: [{ key: 'row', label: 'Row', type: 'text' }] } }])])
    expect(Object.keys(nested)).toEqual(['lines.stops.row'])
    // Top-level `item` is fine.
    expect(reservedFieldKeyProblems([{ key: 'item', label: 'Item', type: 'text' }])).toEqual({})
  })

  it('saving refuses it', () => {
    expect(() => validateFormContent({ fields: [section([{ key: 'item', label: 'Item', type: 'text' }, { key: 'qty', label: 'Qty', type: 'number' }])] })).toThrow(/Field "lines.item": "item" can't be used inside a repeating section/)
  })

  it('the designer: an inner key problem, auto keys avoid the scope names, the section reports it', () => {
    const state = designerStateFrom(normalizeFormDefinition({ fields: [section([{ key: "qty", label: "Qty", type: "number" }])] }))
    const sectionId = state.fields[0]._id
    const view = sectionView(state, sectionId)!
    // A new inner field labelled "Item" gets another key.
    expect(takenKeys(view)).toEqual(expect.arrayContaining(['item', 'row', 'parent', 'index', 'form']))
    const added = newField('text', takenKeys(view))
    expect(['item', 'row', 'parent', 'index', 'form']).not.toContain(added.key)
    // A key typed by hand is flagged.
    const typed = { ...view, fields: [...view.fields, { ...added, key: 'item' }] }
    expect(keyProblemFor(typed, added._id)).toMatch(/can't be used inside a repeating section/)
    // The top-level form keeps `item` usable.
    const top = { ...state, fields: [...state.fields, { ...newField('text', takenKeys(state)), key: 'item' }] }
    expect(keyProblemFor(top, top.fields[1]._id)).toBeNull()
    // The section itself reports an inner reserved key.
    const raw = { ...state, fields: state.fields.map((f) => (f._id === sectionId ? { ...f, repeating_section: { fields: [...f.repeating_section!.fields, { key: 'index', label: 'Index', type: 'number' } as any] } } : f)) }
    expect(designerProblems(raw)[sectionId]).toMatch(/"index" can't be used inside a repeating section/)
  })
})
