/**
 * "Make read only / editable" (lib/forms/form-rules.ts, form-state.ts,
 * field-buttons.ts): the action's normalisation and targets (controls,
 * sections, rows, steps / tabs, the whole form `form:*`), key renames and
 * the layout round trip, Always evaluation, inheritance (a section, step /
 * tab or the form covers its controls; buttons and display elements are
 * skipped), the runner and the state, the server's required check (Always
 * recomputed, event claims bounded like hides), designer problems and
 * descriptions, and the renderer's read-only controls.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  ALWAYS_ACTIONS, RULE_ACTION_GROUPS, alwaysRuleEffects, collectFormRules, describeRuleAction, formRuleProblem, normalizeFormRules, readOnlyFieldKeys,
  renameRuleKey, ruleClaimGate, ruleConflicts, ruleReadOnlyFieldKeys, type FormRule, type RulesDefinition,
} from '@/lib/forms/form-rules'
import { compactLayoutForSave, normalizeFormLayout, renameLayoutKey, type FormLayout } from '@/lib/forms/layout'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { FORM_STATE_KEY, FORM_WHOLE_TARGET, applyReadOnly, parseTarget, readFormState, sanitizeFormState } from '@/lib/forms/form-state'
import { normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { FormRenderer } from '@/components/forms/form-renderer'

const FIELDS = normalizeTaskFields([
  { key: 'status', label: 'Status', type: 'choice', options: ['Draft', 'Approved'] },
  { key: 'amount', label: 'Amount', type: 'number', required: true },
  { key: 'agree', label: 'Agree', type: 'boolean' },
  { key: 'size', label: 'Size', type: 'choice', display: 'radio', options: ['S', 'M'] },
  { key: 'tags', label: 'Tags', type: 'multi_choice', options: ['a', 'b'] },
  { key: 'street', label: 'Street', type: 'text', required: true },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'intro', label: 'Intro', type: 'heading' },
  { key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'message', text: 'Hi' }] } },
])
const KEYS = FIELDS.map((f) => f.key)
const ROWS = [
  { columns: 1, cells: [{ field_key: 'intro', span: 1 }] },
  { columns: 2, cells: [{ field_key: 'status', span: 1 }, { field_key: 'amount', span: 1 }] },
  { columns: 3, cells: [{ field_key: 'agree', span: 1 }, { field_key: 'size', span: 1 }, { field_key: 'tags', span: 1 }] },
  { columns: 2, cells: [{ field_key: 'street', span: 1 }, { field_key: 'city', span: 1 }], section: 'address' },
  { columns: 2, cells: [{ field_key: 'notes', span: 1 }, { field_key: 'go', span: 1 }] },
]
const layoutWith = (rules: unknown[], extra: Record<string, unknown> = {}): FormLayout =>
  normalizeFormLayout({ rows: ROWS, sections: [{ key: 'address', title: 'Address' }], rules, ...extra }, KEYS)!

const lock = (targets: string[], mode = 'read_only') => ({ type: 'read_only', mode, targets })
const approved = { match: 'all', conditions: [{ column: 'status', operator: 'eq', value: 'Approved' }] }

describe('the action', () => {
  it('is a Show / hide group action allowed on Always rules', () => {
    expect(RULE_ACTION_GROUPS.find((g) => g.label === 'Show / hide')!.types).toContain('read_only')
    expect(ALWAYS_ACTIONS.has('read_only')).toBe(true)
  })

  it('normalises modes and targets (fields, sections, rows, pages, the whole form); rule-only', () => {
    expect(normalizeFieldButtonAction({ type: 'read_only', mode: 'read_only', targets: ['field:amount', 'section:address', 'row:city', 'page:p1', 'form:*', 'form:all', 'nonsense', 'field:amount'] }, { rule: true }))
      .toEqual({ type: 'read_only', mode: 'read_only', targets: ['field:amount', 'section:address', 'row:city', 'page:p1', 'form:*'] })
    expect(normalizeFieldButtonAction({ type: 'read_only', mode: 'editable', targets: [] }, { rule: true })!.mode).toBe('editable')
    expect(normalizeFieldButtonAction({ type: 'read_only', mode: 'weird' }, { rule: true })).toEqual({ type: 'read_only', mode: 'toggle', targets: [] })
    // A Button's own actions don't take it.
    expect(normalizeFieldButtonAction({ type: 'read_only', mode: 'read_only', targets: ['form:*'] })).toBeNull()
    // The whole-form target is deliberately not a parseTarget target (show / hide etc. never see it).
    expect(parseTarget(FORM_WHOLE_TARGET)).toBeNull()
    expect(normalizeFieldButtonAction({ type: 'show_hide', mode: 'hide', targets: ['form:*'] }, { rule: true })!.targets).toEqual([])
  })

  it('renames follow a field key; the whole form and pages are untouched; the layout round-trips', () => {
    const rule = normalizeFormRules([{ id: 'r', event: 'always', if: approved, then: [lock(['field:amount', 'row:amount', 'section:address', 'page:amount', 'form:*'])] }])[0]
    expect(renameRuleKey(rule, 'amount', 'total').then[0].targets).toEqual(['field:total', 'row:total', 'section:address', 'page:amount', 'form:*'])
    const layout = layoutWith([rule])
    const renamed = renameLayoutKey(layout, 'amount', 'total')
    expect(renamed.rules![0].then[0].targets).toEqual(['field:total', 'row:total', 'section:address', 'page:amount', 'form:*'])
    const saved = compactLayoutForSave(layout, KEYS)!
    const reloaded = normalizeFormLayout(JSON.parse(JSON.stringify(saved)), KEYS)!
    expect(reloaded.rules).toEqual(layout.rules)
    expect(reloaded.rules![0].then[0]).toEqual({ type: 'read_only', mode: 'read_only', targets: ['field:amount', 'row:amount', 'section:address', 'page:amount', 'form:*'] })
  })
})

describe('Always rules and inheritance', () => {
  it('read only while the condition holds; Editable is the inverse', () => {
    const layout = layoutWith([
      { id: 'a', event: 'always', if: approved, then: [lock(['field:amount'])] },
      { id: 'b', event: 'always', if: approved, then: [lock(['field:city'], 'editable')] },
    ])
    expect([...alwaysRuleEffects(layout, { status: 'Approved' }).readOnly]).toEqual(['field:amount'])
    expect([...alwaysRuleEffects(layout, { status: 'Draft' }).readOnly]).toEqual(['field:city'])
  })

  it('a section, a row, a step / tab and the whole form cover their controls; buttons and display elements never', () => {
    const layout = layoutWith([])
    expect([...readOnlyFieldKeys(layout, FIELDS, ['section:address'])].sort()).toEqual(['city', 'street'])
    expect([...readOnlyFieldKeys(layout, FIELDS, ['row:notes'])]).toEqual(['notes'])
    expect([...readOnlyFieldKeys(layout, FIELDS, ['field:go', 'field:intro'])]).toEqual([])
    expect([...readOnlyFieldKeys(layout, FIELDS, [FORM_WHOLE_TARGET])].sort()).toEqual(['agree', 'amount', 'city', 'notes', 'size', 'status', 'street', 'tags'])
    // No layout: the whole form still covers every control.
    expect(readOnlyFieldKeys(null, FIELDS, [FORM_WHOLE_TARGET]).has('amount')).toBe(true)
    const paged = normalizeFormLayout({
      mode: 'tabs',
      pages: [
        { id: 'one', title: 'One', rows: ROWS.slice(0, 3) },
        { id: 'two', title: 'Two', rows: ROWS.slice(3) },
      ],
      sections: [{ key: 'address', title: 'Address' }],
    }, KEYS)!
    expect([...readOnlyFieldKeys(paged, FIELDS, ['page:two'])].sort()).toEqual(['city', 'notes', 'street'])
  })
})

describe('runtime state', () => {
  it('the runner applies read only / editable / toggle; the state reads it back', async () => {
    let values: Record<string, unknown> = { [FORM_STATE_KEY]: { flags: {}, hidden: [] } }
    const layout = layoutWith([])
    const host: FieldButtonHost = {
      values: () => values, state: () => readFormState(layout, values), setValues: (p) => { values = { ...values, ...p } }, setState: (s) => { values = { ...values, [FORM_STATE_KEY]: s } },
      flush: async () => {}, goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true,
      print: () => {}, openLink: () => true, message: () => {}, editableKeys: new Set(), blank: () => null,
    }
    await runFieldButton({ actions: [normalizeFieldButtonAction(lock(['section:address', 'form:*']), { rule: true })!] }, host)
    expect(readFormState(layout, values).read_only).toEqual(['section:address', 'form:*'])
    await runFieldButton({ actions: [normalizeFieldButtonAction(lock(['form:*'], 'editable'), { rule: true })!] }, host)
    expect(readFormState(layout, values).read_only).toEqual(['section:address'])
    const toggled = applyReadOnly(readFormState(layout, values), 'toggle', ['section:address', 'field:city', 'junk'])
    expect(toggled.read_only).toEqual(['field:city'])
  })
})

describe('server: read-only controls are not required', () => {
  it('Always read only is recomputed from the values', () => {
    const layout = layoutWith([{ id: 'a', event: 'always', if: approved, then: [lock(['field:amount', 'section:address'])] }])
    const check = (vals: Record<string, unknown>) => validateTaskFieldValues(FIELDS, vals, { layout })
    expect(check({ status: 'Draft' })).toMatchObject({ amount: 'Amount is required', street: 'Street is required' })
    expect(check({ status: 'Approved' })).toEqual({})
    // Other checks still run on a read-only field.
    expect(check({ status: 'Approved', amount: 'abc' }).amount).toBeTruthy()
  })

  it('an event rule\'s claim counts only when a rule of the saved form could make it (condition judged)', () => {
    const layout = layoutWith([{ id: 'e', event: 'value_change', target: 'status', if: approved, then: [lock(['form:*'])] }])
    const claim = { [FORM_STATE_KEY]: { flags: {}, hidden: [], read_only: ['form:*', 'field:street'] } }
    const check = (vals: Record<string, unknown>) => validateTaskFieldValues(FIELDS, { ...vals, ...claim }, { layout })
    expect(check({ status: 'Approved' })).toEqual({})
    expect(check({ status: 'Draft' })).toMatchObject({ amount: 'Amount is required', street: 'Street is required' })
    // A target no rule can make read only is never accepted.
    expect(sanitizeFormState(FIELDS, layout, { status: 'Approved', ...claim }, ruleClaimGate({ status: 'Approved' })).read_only).toEqual(['form:*'])
    // No rules: a forged claim reaches nothing.
    expect(sanitizeFormState(FIELDS, layoutWith([]), claim, ruleClaimGate({}))).toEqual({ flags: {}, hidden: [] })
    expect(validateTaskFieldValues(FIELDS, claim, { layout: layoutWith([]) })).toMatchObject({ amount: 'Amount is required' })
  })

  it('ruleReadOnlyFieldKeys combines Always rules and the (sanitized) state', () => {
    const layout = layoutWith([{ id: 'a', event: 'always', then: [lock(['field:amount'])] }])
    const keys = ruleReadOnlyFieldKeys(layout, FIELDS, { [FORM_STATE_KEY]: { flags: {}, hidden: [], read_only: ['row:notes'] } })
    expect([...keys].sort()).toEqual(['amount', 'notes'])
  })
})

describe('designer', () => {
  const known = {
    fieldKeys: new Set(KEYS), valueKeys: new Set(KEYS.filter((k) => k !== 'go' && k !== 'intro')), fieldTypes: new Map(FIELDS.map((f) => [f.key, f.type as string])),
    pageIds: new Set(['one']), flags: new Set<string>(), sectionKeys: new Set(['address']), headingKeys: new Set(['intro']),
  }
  const rule = (targets: string[], event: FormRule['event'] = 'always'): FormRule => ({ id: 'r', event, ...(event === 'value_change' ? { target: 'status' } : {}), then: [lock(targets) as any] })

  it('problems: targets required and known; buttons and display elements refused; every event allowed', () => {
    expect(formRuleProblem(rule(['form:*', 'section:address', 'page:one', 'field:amount', 'row:city', 'section:intro']), known)).toBeNull()
    expect(formRuleProblem(rule(['field:amount'], 'value_change'), known)).toBeNull()
    expect(formRuleProblem(rule([]), known)).toMatch(/choose what it applies to/)
    expect(formRuleProblem(rule(['field:ghost']), known)).toMatch(/not on this form/)
    expect(formRuleProblem(rule(['page:ghost']), known)).toMatch(/not on this form/)
    expect(formRuleProblem(rule(['field:go']), known)).toMatch(/Enable \/ disable/)
    expect(formRuleProblem(rule(['field:intro']), known)).toMatch(/holds no value/)
  })

  it('descriptions and conflict notes', () => {
    const def: RulesDefinition = { fields: FIELDS as any, layout: { ...layoutWith([]), pages: [] } as any }
    expect(describeRuleAction(def, lock(['form:*', 'field:amount', 'section:address']) as any)).toBe('Make read only the whole form, Amount, section Address')
    expect(describeRuleAction(def, lock(['field:city'], 'editable') as any)).toBe('Make editable City')
    expect(describeRuleAction(def, lock(['field:city'], 'toggle') as any)).toBe('Toggle read only City')
    const both: RulesDefinition = { ...def, layout: { ...def.layout, rules: [rule(['form:*']), { ...rule(['form:*']), id: 'r2' }] } }
    const notes = ruleConflicts(both, collectFormRules(both))
    expect([...notes.values()][0][0]).toMatch(/whether the whole form is read only/)
  })
})

describe('renderer', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const render = (layout: FormLayout, values: Record<string, unknown>) => wrap(createElement(FormRenderer, { fields: FIELDS, layout, values, onChange: () => {} }))
  const tagOf = (html: string, id: string) => new RegExp(`<(input|textarea)[^>]*id="task-field-${id}"[^>]*>`).exec(html)?.[0] ?? ''

  it('the whole form read only: read-only (not disabled) controls, aria-readonly, no asterisk; buttons unaffected', () => {
    const html = render(layoutWith([{ id: 'a', event: 'always', if: approved, then: [lock(['form:*'])] }]), { status: 'Approved', amount: 5, agree: true, size: 'M', tags: ['a'], street: 'High St' })
    for (const key of ['amount', 'street', 'city']) {
      const tag = tagOf(html, key)
      expect(tag).toContain('readOnly=""')
      expect(tag).toContain('aria-readonly="true"')
      expect(tag).not.toContain('disabled=""')
    }
    expect(tagOf(html, 'notes')).toContain('readOnly=""')
    // A dropdown shows its value in a read-only text box.
    expect(tagOf(html, 'status')).toMatch(/value="Approved"/)
    expect(tagOf(html, 'status')).toContain('readOnly=""')
    // Checkbox, radios and chips keep their state, read only, focusable (not disabled).
    expect(tagOf(html, 'agree')).toContain('aria-readonly="true"')
    expect(tagOf(html, 'agree')).not.toContain('disabled=""')
    expect(html).toMatch(/role="radiogroup"[^>]*aria-readonly="true"/)
    expect(html).toMatch(/role="checkbox" aria-checked="true" aria-readonly="true"/)
    // Required markers go.
    expect(html).not.toMatch(/Amount<span[^>]*>\*/)
    // The button still renders, enabled.
    expect(html).toMatch(/<button[^>]*>[^<]*(<[^>]+>)*Go/)
  })

  it('a section read only covers only its controls; the condition turning false makes them editable', () => {
    const layout = layoutWith([{ id: 'a', event: 'always', if: approved, then: [lock(['section:address'])] }])
    const on = render(layout, { status: 'Approved' })
    expect(tagOf(on, 'street')).toContain('readOnly=""')
    expect(tagOf(on, 'city')).toContain('readOnly=""')
    expect(tagOf(on, 'amount')).not.toContain('readOnly')
    expect(on).not.toMatch(/Street<span[^>]*aria-hidden="true">\*/)
    const off = render(layout, { status: 'Draft' })
    expect(tagOf(off, 'street')).not.toContain('readOnly')
    expect(off).toMatch(/Street<span[^>]*aria-hidden="true">\*/)
  })

  it('Enable / disable keeps its disabled look over read only', () => {
    const layout = layoutWith([{ id: 'a', event: 'always', then: [lock(['field:city']), { type: 'enable_disable', mode: 'disable', targets: ['field:city'] }] }])
    const tag = tagOf(render(layout, {}), 'city')
    expect(tag).toContain('disabled=""')
    expect(tag).not.toContain('aria-readonly')
  })

  it('an optional section made read only loses Add / Remove (its inclusion is a value too)', () => {
    const optional = (rules: unknown[]) => normalizeFormLayout({ rows: ROWS, sections: [{ key: 'address', title: 'Address', optional: true }], rules }, KEYS)!
    expect(render(optional([]), {})).toContain('data-section-add="address"')
    const locked = render(optional([{ id: 'a', event: 'always', then: [lock(['section:address'])] }]), {})
    expect(locked).not.toContain('data-section-add')
    expect(locked).toContain('data-section-not-included')
  })
})
