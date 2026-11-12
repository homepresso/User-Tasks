/**
 * Choice groups (lib/forms/sections.ts — InfoPath's choice group / choice
 * section): `layout.choice_groups: [{ key, label, sections, default?,
 * display? }]`. One alternative shows at a time; `<key>` holds the chosen
 * section key (validated); the others' fields are hidden, not required, not
 * validated and not kept; the server recomputes the active alternative;
 * rules read and set `{{form.<key>}}` and react to its changes. Also: the
 * optional-section behaviour choice groups build on.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { normalizeFormLayout, type FormLayout } from '@/lib/forms/layout'
import {
  activeChoiceSection, choiceGroupKeys, choiceGroupValueErrors, excludedSectionFieldKeys, inactiveChoiceFieldKeys, layoutChoiceGroups, sectionInclusionPatch, withChoiceDefaults,
} from '@/lib/forms/sections'
import { mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { ruleConditionsMet, ruleValidationErrors } from '@/lib/forms/form-rules'
import {
  addChoiceGroup, designerChoiceGroupProblems, designerRuleProblems, designerStateFrom, definitionFrom, removeChoiceGroup, removeSection, updateChoiceGroup, updateSection,
} from '@/lib/forms/designer-state'
import { storedValues } from '@/lib/services/form-submissions'
import { FormRenderer } from '@/components/forms/form-renderer'

const fields = normalizeTaskFields([
  { key: 'name', label: 'Name', type: 'text', required: true },
  { key: 'card_number', label: 'Card number', type: 'text', required: true },
  { key: 'card_expiry', label: 'Expiry', type: 'text' },
  { key: 'iban', label: 'IBAN', type: 'text', required: true },
  { key: 'cheque_payee', label: 'Payee', type: 'text', required: true },
  { key: 'gift', label: 'Gift message', type: 'textarea', required: true },
])
const keys = fields.map((f) => f.key)

function layoutWith(groups: unknown, extra: Record<string, unknown> = {}): FormLayout {
  return normalizeFormLayout({
    rows: [
      { columns: 1, cells: [{ field_key: 'name', span: 1 }] },
      { columns: 2, cells: [{ field_key: 'card_number', span: 1 }, { field_key: 'card_expiry', span: 1 }], section: 'card' },
      { columns: 1, cells: [{ field_key: 'iban', span: 1 }], section: 'bank' },
      { columns: 1, cells: [{ field_key: 'cheque_payee', span: 1 }], section: 'cheque' },
      { columns: 1, cells: [{ field_key: 'gift', span: 1 }], section: 'gift_wrap' },
    ],
    sections: [{ key: 'card', title: 'Card' }, { key: 'bank', title: 'Bank transfer' }, { key: 'cheque', title: 'Cheque' }, { key: 'gift_wrap', title: 'Gift wrap', optional: true }],
    choice_groups: groups,
    ...extra,
  }, keys)!
}

const PAY = { key: 'payment', label: 'How will you pay?', sections: ['card', 'bank', 'cheque'], default: 'bank' }
const layout = layoutWith([PAY])

describe('choice group model', () => {
  it('normalises: key free of fields / sections, 2–6 known sections each in one group, default one of them, display', () => {
    expect(layout.choice_groups).toEqual([{ key: 'payment', label: 'How will you pay?', sections: ['card', 'bank', 'cheque'], default: 'bank' }])
    expect(layoutWith([{ ...PAY, display: 'tabs' }]).choice_groups![0].display).toBe('tabs')
    expect(layoutWith([{ ...PAY, display: 'radio' }]).choice_groups![0].display).toBeUndefined()
    // Key clashes (a field, a section, an optional section's _included), unknown / repeated sections, too few, a bad default.
    expect(layoutWith([{ ...PAY, key: 'name' }]).choice_groups).toBeUndefined()
    expect(layoutWith([{ ...PAY, key: 'card' }]).choice_groups).toBeUndefined()
    expect(layoutWith([{ ...PAY, key: 'gift_wrap_included' }]).choice_groups).toBeUndefined()
    expect(layoutWith([{ key: 'p', label: 'P', sections: ['card', 'ghost', 'card'] }]).choice_groups).toBeUndefined()
    expect(layoutWith([{ ...PAY, default: 'ghost' }]).choice_groups![0].default).toBeUndefined()
    // A section joins one group only.
    expect(layoutWith([PAY, { key: 'other', label: 'Other', sections: ['card', 'gift_wrap'] }]).choice_groups!.map((g) => g.key)).toEqual(['payment'])
    // Alternatives live on one page: a later page's section is dropped.
    const paged = normalizeFormLayout({
      mode: 'steps',
      pages: [
        { id: 'one', title: 'One', rows: [{ columns: 1, cells: [{ field_key: 'card_number', span: 1 }], section: 'card' }, { columns: 1, cells: [{ field_key: 'iban', span: 1 }], section: 'bank' }] },
        { id: 'two', title: 'Two', rows: [{ columns: 1, cells: [{ field_key: 'cheque_payee', span: 1 }], section: 'cheque' }] },
      ],
      rows: [],
      sections: [{ key: 'card', title: 'Card' }, { key: 'bank', title: 'Bank' }, { key: 'cheque', title: 'Cheque' }],
      choice_groups: [{ key: 'payment', label: 'Pay', sections: ['card', 'bank', 'cheque'] }],
    }, keys)!
    expect(paged.choice_groups![0].sections).toEqual(['card', 'bank'])
  })

  it('the active alternative: the value when it names one, else the default, else the first', () => {
    const [group] = layoutChoiceGroups(layout)
    expect(activeChoiceSection(group, {})).toBe('bank')
    expect(activeChoiceSection(group, { payment: 'card' })).toBe('card')
    expect(activeChoiceSection(group, { payment: 'bogus' })).toBe('bank')
    expect(activeChoiceSection({ ...group, default: undefined }, {})).toBe('card')
    expect(choiceGroupKeys(layout)).toEqual(['payment'])
    expect(withChoiceDefaults(layout, { name: 'Ada' })).toEqual({ name: 'Ada', payment: 'bank' })
    expect(withChoiceDefaults(layout, { payment: 'bogus' })).toEqual({ payment: 'bogus' })
  })
})

describe('choice group: hidden, not required, not validated, not kept', () => {
  it('only the active alternative is required and checked', () => {
    expect([...inactiveChoiceFieldKeys(layout, { payment: 'card' })].sort()).toEqual(['cheque_payee', 'iban'])
    expect(excludedSectionFieldKeys(layout, { payment: 'card' }).has('iban')).toBe(true)
    const errors = validateTaskFieldValues(fields, { name: 'Ada', payment: 'card', gift_wrap_included: false }, { layout })
    expect(errors).toEqual({ card_number: 'Card number is required' })
    // The default (bank) when nothing was chosen.
    expect(validateTaskFieldValues(fields, { name: 'Ada' }, { layout })).toEqual({ iban: 'IBAN is required' })
  })

  it('a chosen value must be one of the group\'s sections', () => {
    expect(choiceGroupValueErrors(layout, { payment: 'paypal' })).toEqual({ payment: 'How will you pay?: choose one of card, bank, cheque' })
    expect(validateTaskFieldValues(fields, { name: 'Ada', payment: 'paypal', iban: 'X' }, { layout }).payment).toMatch(/choose one of/)
    expect(mergeTaskFieldValues({ fields, form_layout: layout }, { name: 'Ada', payment: 'paypal', iban: 'X' }).errors.payment).toMatch(/choose one of/)
  })

  it('the server recomputes the active alternative, stores <key> and blanks the others\' fields', () => {
    const sent = { name: 'Ada', payment: 'cheque', cheque_payee: 'Acme Inc', card_number: '4111', iban: 'GB00', card_expiry: '12/30' }
    const { errors, templateValues } = mergeTaskFieldValues({ fields, form_layout: layout }, sent)
    expect(errors).toEqual({})
    expect(templateValues).toMatchObject({ payment: 'cheque', cheque_payee: 'Acme Inc', card_number: null, card_expiry: null, iban: null })
    // Nothing chosen: the default is stored.
    const fallback = mergeTaskFieldValues({ fields, form_layout: layout }, { name: 'Ada', iban: 'GB00', card_number: '4111' })
    expect(fallback.templateValues).toMatchObject({ payment: 'bank', iban: 'GB00', card_number: null })
    expect(sectionInclusionPatch(layout, { payment: 'card' })).toEqual({ included: { gift_wrap_included: false, payment: 'card' }, blank: ['gift', 'iban', 'cheque_payee'] })
    // Drafts keep a valid choice only.
    expect(mergeTaskFieldValues({ fields, form_layout: layout }, { payment: 'card' }, { partial: true }).templateValues.payment).toBe('card')
    expect(mergeTaskFieldValues({ fields, form_layout: layout }, { payment: 'nope' }, { partial: true }).templateValues.payment).toBeUndefined()
    // A reusable form's stored values keep the choice.
    expect(storedValues(fields, { name: 'Ada', payment: 'card', junk: 1 }, layout)).toEqual({ name: 'Ada', payment: 'card' })
  })

  it('optional sections: fields hidden / not required until added, stored empty when left out', () => {
    expect(validateTaskFieldValues(fields, { name: 'Ada', iban: 'GB00' }, { layout })).toEqual({})
    expect(validateTaskFieldValues(fields, { name: 'Ada', iban: 'GB00', gift_wrap_included: true }, { layout })).toEqual({ gift: 'Gift message is required' })
    const { templateValues } = mergeTaskFieldValues({ fields, form_layout: layout }, { name: 'Ada', iban: 'GB00', gift: 'Happy birthday', gift_wrap_included: false })
    expect(templateValues).toMatchObject({ gift: null, gift_wrap_included: false })
  })
})

describe('choice group in rules', () => {
  const ruled = layoutWith([PAY], {
    rules: [
      // Read: a card payment over $1,000 needs the expiry (judged again on the server).
      { id: 'expiry', event: 'before_submit', if: { match: 'all', conditions: [{ column: 'form.payment', operator: 'eq', value: 'card' }, { column: 'card_expiry', operator: 'is_not_set' }] }, then: [{ type: 'field_error', field: 'card_expiry', text: 'Card payments need the expiry' }] },
      // React: the choice changed (value_change on the group key).
      { id: 'react', event: 'value_change', target: 'payment', if: { match: 'all', conditions: [{ column: 'event.value', operator: 'eq', value: 'cheque' }] }, then: [{ type: 'block_submit', field: 'cheque_payee', text: 'Cheques are paused' }] },
      // Set: a rule picks the alternative.
      { id: 'pick', event: 'form_load', then: [{ type: 'set_values', assign: { payment: 'card' } }] },
    ],
  })

  it('conditions read {{form.<key>}} (the default when nothing is chosen)', () => {
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'payment', operator: 'eq', value: 'bank' }] }, { values: withChoiceDefaults(ruled, {}) })).toBe(true)
    expect(ruleValidationErrors(ruled, { payment: 'card' })).toEqual({ card_expiry: 'Card payments need the expiry' })
    expect(ruleValidationErrors(ruled, { payment: 'cheque' })).toEqual({ cheque_payee: 'Cheques are paused' })
    // Server: the value-change rule sees the submitted choice as event.value.
    expect(mergeTaskFieldValues({ fields, form_layout: ruled }, { name: 'Ada', payment: 'cheque', cheque_payee: 'Acme' }).errors).toEqual({ cheque_payee: 'Cheques are paused' })
  })

  it('the designer accepts value_change on the group key and Set values into it', () => {
    const state = designerStateFrom({ fields, layout: ruled } as any)
    expect(state.layout.choice_groups).toHaveLength(1)
    expect(designerRuleProblems(state)).toEqual({})
  })
})

describe('choice group in the designer', () => {
  const base = designerStateFrom({ fields, layout: layoutWith(undefined) } as any)

  it('creates a group from sections, edits and removes it; section renames / removals follow', () => {
    const made = addChoiceGroup(base, ['card', 'bank', 'cheque'], 'Payment method')!
    expect(made.key).toBe('payment_method')
    expect(made.state.layout.choice_groups).toEqual([{ key: 'payment_method', label: 'Payment method', sections: ['card', 'bank', 'cheque'] }])
    expect(addChoiceGroup(made.state, ['card', 'gift_wrap'])).toBeNull()
    let state = updateChoiceGroup(made.state, 'payment_method', { display: 'tabs', default: 'cheque' })
    expect(state.layout.choice_groups![0]).toMatchObject({ display: 'tabs', default: 'cheque' })
    state = updateSection(state, 'cheque', { key: 'check' })
    expect(state.layout.choice_groups![0]).toMatchObject({ sections: ['card', 'bank', 'check'], default: 'check' })
    state = removeSection(state, 'check')
    expect(state.layout.choice_groups![0].sections).toEqual(['card', 'bank'])
    expect(state.layout.choice_groups![0].default).toBeUndefined()
    expect(designerChoiceGroupProblems(state)).toEqual({})
    expect(designerChoiceGroupProblems(updateChoiceGroup(state, 'payment_method', { key: 'name' }))).toEqual({ name: 'A field already uses the key "name"' })
    // Saved and read back.
    expect(normalizeFormLayout(definitionFrom(state).layout, keys)!.choice_groups).toEqual([{ key: 'payment_method', label: 'Payment method', sections: ['card', 'bank'], display: 'tabs' }])
    expect(removeChoiceGroup(state, 'payment_method').layout.choice_groups).toBeUndefined()
    expect(removeSection(state, 'bank').layout.choice_groups).toBeUndefined()
  })
})

describe('choice group in the renderer', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))

  it('radio (default): the switch above the active section; other alternatives not rendered', () => {
    const html = wrap(createElement(FormRenderer, { fields, layout, values: { payment: 'card' }, onChange: () => {} }))
    expect(html).toContain('data-choice-group="payment"')
    expect(html).toContain('<legend class="mb-1 text-xs font-semibold text-fg">How will you pay?</legend>')
    expect(html).toContain('checked="" value="card"')
    expect(html).toContain('data-form-section="card"')
    expect(html).not.toContain('data-form-section="bank"')
    expect(html).not.toContain('Payee')
    // Default when nothing is chosen.
    expect(wrap(createElement(FormRenderer, { fields, layout, values: {}, onChange: () => {} }))).toContain('data-form-section="bank"')
  })

  it('tabs and dropdown displays; read-only shows the choice as text', () => {
    const tabs = wrap(createElement(FormRenderer, { fields, layout: layoutWith([{ ...PAY, display: 'tabs' }]), values: { payment: 'cheque' }, onChange: () => {} }))
    expect(tabs).toContain('role="tablist"')
    expect(tabs).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Cheque</)
    expect(tabs).toContain('role="tabpanel"')
    const dropdown = wrap(createElement(FormRenderer, { fields, layout: layoutWith([{ ...PAY, display: 'dropdown' }]), values: {}, onChange: () => {} }))
    expect(dropdown).toContain('data-choice-select')
    expect(dropdown).toMatch(/<option value="bank" selected="">Bank transfer<\/option>/)
    const readOnly = wrap(createElement(FormRenderer, { fields, layout, values: { payment: 'card', card_number: '4111' }, readOnly: true }))
    expect(readOnly).toContain('data-choice-readonly')
    expect(readOnly).toContain('How will you pay?:</span> Card')
    expect(readOnly).not.toContain('type="radio"')
  })
})
