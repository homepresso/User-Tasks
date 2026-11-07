/**
 * Form rules (lib/forms/form-rules.ts): the stored model and its limits,
 * conditions (AND / OR, cross-field, flags, event context), the unified list
 * over legacy rules with write-back (and the move into layout.rules when an
 * edit no longer fits), conflicts, the test panel's simulation, the runtime
 * runner (row click → fill fields + show a tab; before submit blocks), the
 * server's checks (Always hides decide what is required; validate rules
 * re-run at submit; forged state / events cannot hide required fields or
 * reach undeclared targets), after-submit actions, the layout round trip,
 * key renames, portability, and the accessibility warning.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */

import { describe, expect, it } from 'vitest'
import {
  afterSubmitActions, alwaysRuleEffects, collectFormRules, duplicateRule, findServerRuleAction, formRuleProblem, moveNativeRule, normalizeFormRules,
  removeUnifiedRule, renameRuleKey, ruleClaimGate, ruleConditionsMet, ruleConflicts, ruleValidationErrors, rulesForEvent, rulesHidingRequiredFields,
  serverVerifiable, simulateRuleEvent, writeUnifiedRule, type FormRule, type RulesDefinition,
} from '@/lib/forms/form-rules'
import { compactLayoutForSave, normalizeFormLayout, renameLayoutKey } from '@/lib/forms/layout'
import { runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { FORM_STATE_KEY, applyFlag, readFormState, sanitizeFormState, type FormUiState } from '@/lib/forms/form-state'
import { normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import { visiblePages } from '@/lib/forms/pages'
import { remapKnownIds, createEmptyAssetIdMaps } from '@/lib/portability/id-maps'
import { scanAssetReferences } from '@/lib/portability/dependencies'
import { STRUCTURAL_RULES } from '@/lib/forms/accessibility/rules'

const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const FIELDS = normalizeTaskFields([
  { key: 'customers', label: 'Customers', type: 'data_table', data_table: { source: 'table', table_id: u(10), mode: 'display', columns: [{ key: 'name', label: 'Name', type: 'text' }, { key: 'city', label: 'City', type: 'text' }] } },
  { key: 'customer_name', label: 'Customer name', type: 'text', required: true },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'start_date', label: 'Start', type: 'date' },
  { key: 'end_date', label: 'End', type: 'date' },
  { key: 'notes', label: 'Notes', type: 'textarea', visible_when: { field: 'city', operator: 'is_set' } },
  { key: 'secret', label: 'Secret', type: 'text', required: true },
  { key: 'go', label: 'Go', type: 'button', button: { style: 'primary', actions: [{ type: 'message', text: 'Hi' }] } },
])

const ROW_CLICK: FormRule = {
  id: 'r_fill', name: 'Fill customer', event: 'row_click', target: 'customers',
  then: [
    { type: 'copy_values', assign: { customer_name: '{{event.row.name}}', city: '{{event.row.city}}' } },
    { type: 'go_to_page', page: 'details' },
  ],
}
const DATES: FormRule = {
  id: 'r_dates', name: 'End after start', event: 'always',
  if: { match: 'all', conditions: [{ column: 'end_date', operator: 'is_set' }, { column: 'end_date', operator: 'lt', value: '{{start_date}}' }] },
  then: [{ type: 'field_error', field: 'end_date', text: 'End must be after {{start_date}}' }],
}
const BLOCK: FormRule = {
  id: 'r_block', name: 'Need a city', event: 'before_submit',
  if: { match: 'any', conditions: [{ column: 'city', operator: 'is_not_set' }, { column: 'city', operator: 'eq', value: 'Nowhere' }] },
  then: [{ type: 'block_submit', text: 'Pick a customer first' }],
}
const HIDE_SECRET: FormRule = {
  id: 'r_hide', name: 'Hide secret for Paris', event: 'value_change', target: 'city',
  if: { match: 'all', conditions: [{ column: 'city', operator: 'eq', value: 'Paris' }] },
  then: [{ type: 'show_hide', mode: 'hide', targets: ['field:secret'] }],
}

const LAYOUT = normalizeFormLayout({
  mode: 'tabs',
  pages: [
    { id: 'pick', title: 'Pick', rows: [{ columns: 1, cells: [{ field_key: 'customers', span: 1 }] }] },
    { id: 'details', title: 'Details', rows: [{ columns: 2, cells: [{ field_key: 'customer_name', span: 1 }, { field_key: 'city', span: 1 }] }] },
  ],
  rules: [ROW_CLICK, DATES, BLOCK, HIDE_SECRET],
}, FIELDS.map((f) => f.key))!

describe('stored model', () => {
  it('normalizes: unknown events / actions dropped, ids unique, names cleaned, limits applied; layouts keep rules', () => {
    const rules = normalizeFormRules([
      ROW_CLICK, { ...ROW_CLICK, name: '<b>dup</b>' }, { id: 'x', event: 'nope', then: [] },
      { event: 'value_change', target: 'city', then: [{ type: 'evil' }, { type: 'message', text: 'ok' }], if: { match: 'any', conditions: [{ column: 'bad column!', operator: 'eq' }, { column: 'city', operator: 'eq', value: 'x' }] } },
    ])
    expect(rules).toHaveLength(3)
    expect(rules[1].id).not.toBe('r_fill')
    expect(rules[1].name).toBe('bdup/b')
    expect(rules[2].then).toEqual([{ type: 'message', text: 'ok' }])
    expect(rules[2].if?.conditions).toEqual([{ column: 'city', operator: 'eq', value: 'x' }])
    expect(LAYOUT.rules?.map((r) => r.id)).toEqual(['r_fill', 'r_dates', 'r_block', 'r_hide'])
    expect(compactLayoutForSave(LAYOUT, FIELDS.map((f) => f.key))?.rules).toHaveLength(4)
    // A single-grid trivial layout with rules is still stored.
    const trivial = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'city', span: 1 }] }], rules: [BLOCK] }, ['city'])!
    expect(compactLayoutForSave(trivial, ['city'])?.rules).toHaveLength(1)
  })

  it('older forms without rules are unchanged', () => {
    const old = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'city', span: 1 }] }] }, ['city'])!
    expect(old.rules).toBeUndefined()
    expect(compactLayoutForSave(old, ['city'])).toBeNull()
  })

  it('renaming a key updates rules (targets, assignments, conditions)', () => {
    const renamed = renameLayoutKey(LAYOUT, 'city', 'town')
    const fill = renamed.rules!.find((r) => r.id === 'r_fill')!
    expect(fill.then[0].assign).toEqual({ customer_name: '{{event.row.name}}', town: '{{event.row.city}}' })
    expect(renamed.rules!.find((r) => r.id === 'r_hide')!.target).toBe('town')
    expect(renameRuleKey(BLOCK, 'city', 'town').if!.conditions).toEqual([{ column: 'town', operator: 'is_not_set' }, { column: 'town', operator: 'eq', value: 'Nowhere' }])
  })
})

describe('conditions', () => {
  it('AND / OR, cross-field date comparison, flags, user and event context', () => {
    expect(ruleConditionsMet(DATES.if, { values: { start_date: '2026-05-10', end_date: '2026-05-01' } })).toBe(true)
    expect(ruleConditionsMet(DATES.if, { values: { start_date: '2026-05-10', end_date: '2026-06-01' } })).toBe(false)
    expect(ruleConditionsMet(BLOCK.if, { values: { city: '' } })).toBe(true)
    expect(ruleConditionsMet(BLOCK.if, { values: { city: 'Nowhere' } })).toBe(true)
    expect(ruleConditionsMet(BLOCK.if, { values: { city: 'Berlin' } })).toBe(false)
    const flags = { match: 'all' as const, conditions: [{ column: 'state.vip', operator: 'eq' as const, value: 'true' }] }
    expect(ruleConditionsMet(flags, { values: { [FORM_STATE_KEY]: { flags: { vip: true }, hidden: [] } } })).toBe(true)
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'event.row.city', operator: 'in', value: 'Berlin, Paris' }] }, { values: {}, event: { row: { city: 'paris' } } })).toBe(true)
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'user.email', operator: 'contains', value: '@acme' }] }, { values: {}, user: { email: 'a@acme.test' } })).toBe(true)
    expect(ruleConditionsMet({ match: 'all', conditions: [{ column: 'amount', operator: 'gte', value: '10' }] }, { values: { amount: 9.5 } })).toBe(false)
  })

  it('only conditions on form values / flags (and a value rule\'s own value) are server-verifiable', () => {
    expect(serverVerifiable(DATES)).toBe(true)
    expect(serverVerifiable({ event: 'value_change', if: { match: 'all', conditions: [{ column: 'event.value', operator: 'eq', value: 'x' }] } })).toBe(true)
    expect(serverVerifiable({ event: 'row_click', if: { match: 'all', conditions: [{ column: 'event.row.city', operator: 'eq', value: 'x' }] } })).toBe(false)
    expect(serverVerifiable({ event: 'always', if: { match: 'all', conditions: [{ column: 'user.email', operator: 'is_set' }] } })).toBe(false)
  })
})

describe('the unified list (Rules tab)', () => {
  const def = (): RulesDefinition => ({
    fields: FIELDS as any,
    layout: { ...(LAYOUT as any), state: { hidden: ['field:secret'], flags: [{ key: 'vip' }] } },
    buttons: [{ id: 'submit', label: 'Send', kind: 'submit', actions: [{ type: 'message', text: 'Thanks' }] }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }],
  })

  it('lists native and legacy rules with where they live', () => {
    const list = collectFormRules(def())
    expect(list.map((u) => u.home.kind)).toEqual(['rules', 'rules', 'rules', 'rules', 'visible_when', 'button_click', 'start_hidden', 'bar_button'])
    expect(list.find((u) => u.home.kind === 'visible_when')).toMatchObject({ badge: 'Field: Notes · Visible when', rule: { event: 'always', then: [{ type: 'show_hide', mode: 'show', targets: ['field:notes'] }] } })
    expect(list.find((u) => u.home.kind === 'button_click')!.rule).toMatchObject({ event: 'button_click', target: 'go' })
    expect(list.find((u) => u.home.kind === 'bar_button')!.barActions).toEqual([{ type: 'message', text: 'Thanks' }])
  })

  it('edits write back to where a rule lives; an edit that no longer fits moves it into Rules', () => {
    const d = def()
    const vw = collectFormRules(d).find((u) => u.home.kind === 'visible_when')!
    // Same shape: stays a Visible when.
    const kept = writeUnifiedRule(d, vw.home, { ...vw.rule, if: { match: 'all', conditions: [{ column: 'city', operator: 'eq', value: 'Paris' }] } })
    expect(kept.home.kind).toBe('visible_when')
    expect(kept.def.fields.find((f) => f.key === 'notes')!.visible_when).toEqual({ field: 'city', operator: 'equals', value: 'Paris' })
    // AND / OR group: moves into layout.rules (the field's own rule is cleared — same behaviour, one place).
    const moved = writeUnifiedRule(d, vw.home, { ...vw.rule, if: { match: 'any', conditions: [{ column: 'city', operator: 'eq', value: 'Paris' }, { column: 'city', operator: 'eq', value: 'Rome' }] } })
    expect(moved.home.kind).toBe('rules')
    expect(moved.def.fields.find((f) => f.key === 'notes')!.visible_when).toBeUndefined()
    expect((moved.def.layout.rules as FormRule[]).at(-1)).toMatchObject({ event: 'always', then: [{ type: 'show_hide', mode: 'show', targets: ['field:notes'] }] })
    // A button's On click edited in Rules updates the button.
    const btn = collectFormRules(d).find((u) => u.home.kind === 'button_click')!
    const out = writeUnifiedRule(d, btn.home, { ...btn.rule, then: [{ type: 'message', text: 'Bye' }] })
    expect(out.def.fields.find((f) => f.key === 'go')!.button!.actions).toEqual([{ type: 'message', text: 'Bye' }])
    // …and edits in the old place show up in the list (same storage).
    const edited = { ...d, fields: d.fields.map((f) => (f.key === 'go' ? { ...f, button: { ...f.button!, actions: [{ type: 'print' as const }] } } : f)) }
    expect(collectFormRules(edited).find((u) => u.home.kind === 'button_click')!.rule.then).toEqual([{ type: 'print' }])
    // Turning a legacy rule off keeps it (as an own rule, disabled).
    const off = writeUnifiedRule(d, btn.home, { ...btn.rule, disabled: true })
    expect(off.home.kind).toBe('rules')
    expect((off.def.layout.rules as FormRule[]).at(-1)!.disabled).toBe(true)
  })

  it('remove, duplicate and reorder', () => {
    const d = def()
    const list = collectFormRules(d)
    expect(removeUnifiedRule(d, { kind: 'start_hidden' }).layout.state).toEqual({ flags: [{ key: 'vip' }] })
    const dup = duplicateRule(d, list[0])
    expect((dup.def.layout.rules as FormRule[])[1]).toMatchObject({ id: dup.id, name: 'Fill customer (copy)' })
    const moved = moveNativeRule(d, 'r_hide', 0)
    expect((moved.layout.rules as FormRule[]).map((r) => r.id)).toEqual(['r_hide', 'r_fill', 'r_dates', 'r_block'])
  })

  it('notes rules that set the same thing', () => {
    const d = def()
    d.layout.rules = [...(d.layout.rules as FormRule[]),
      { id: 'r_city2', name: 'Default city', event: 'row_click', target: 'customers', then: [{ type: 'set_values', assign: { city: 'Berlin' } }] },
      { id: 'r_city3', name: 'City on load', event: 'form_load', then: [{ type: 'set_values', assign: { city: 'Rome' } }] }]
    const list = collectFormRules(d)
    const notes = ruleConflicts(d, list)
    expect(notes.get('rules:r_fill')?.[0]).toMatch(/value of City on the same event.*Default city.*list order/)
    expect(notes.get('rules:r_city2')?.[0]).toMatch(/Fill customer/)
    // Another event setting the same field is not a conflict.
    expect(notes.get('rules:r_city3')).toBeUndefined()
  })

  it('the test panel simulates an event with a sample row', () => {
    const sim = simulateRuleEvent(def(), { type: 'row_click', target: 'customers', context: { row: { name: 'Alfreds', city: 'Berlin' } } }, { values: {} })
    const fill = sim.find((s) => s.key === 'rules:r_fill')!
    expect(fill).toMatchObject({ triggered: true, met: true })
    expect(fill.actions).toEqual(['Copy into Customer name = “Alfreds”, City = “Berlin”', 'Go to Details'])
    expect(sim.filter((s) => s.triggered).map((s) => s.key)).toEqual(['rules:r_fill'])
  })

  it('designer problems', () => {
    const known = {
      fieldKeys: new Set(FIELDS.map((f) => f.key)), valueKeys: new Set(['customer_name', 'city']), fieldTypes: new Map(FIELDS.map((f) => [f.key, f.type as string])),
      pageIds: new Set(['pick', 'details']), flags: new Set<string>(),
    }
    expect(formRuleProblem(ROW_CLICK, known)).toBeNull()
    expect(formRuleProblem({ ...ROW_CLICK, target: 'city' }, known)).toMatch(/not a Data table/)
    expect(formRuleProblem({ id: 'a', event: 'always', then: [{ type: 'message', text: 'x' }] }, known)).toMatch(/Always/)
    expect(formRuleProblem({ id: 'a', event: 'after_submit', then: [{ type: 'set_values', assign: { city: 'x' } }] }, known)).toMatch(/server/)
    expect(formRuleProblem({ id: 'a', event: 'form_load', then: [{ type: 'copy_values', assign: { secret: 'x' } }] }, known)).toMatch(/not an input/)
  })
})

describe('runtime: a row click fills the customer fields and shows the Details tab', () => {
  it('runs copy_values with {{event.row.*}} and go_to_page through the action runner', async () => {
    let values: Record<string, unknown> = { [FORM_STATE_KEY]: { flags: {}, hidden: [] } }
    const went: string[] = []
    const host: FieldButtonHost = {
      values: () => values, state: () => readFormState(LAYOUT, values), setValues: (p) => { values = { ...values, ...p } }, setState: (s) => { values = { ...values, [FORM_STATE_KEY]: s } },
      flush: async () => {}, goTo: (id) => { went.push(id); return true }, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true,
      print: () => {}, openLink: () => true, message: () => {}, editableKeys: new Set(['customer_name', 'city']), blank: () => null,
    }
    const [rule] = rulesForEvent(LAYOUT.rules!, { type: 'row_click', target: 'customers' })
    const run = await runFieldButton({ actions: rule.then }, host, { extras: { event: { row: { name: 'Alfreds Futterkiste', city: 'Berlin' } } } })
    expect(run.stopped).toBeUndefined()
    expect(values).toMatchObject({ customer_name: 'Alfreds Futterkiste', city: 'Berlin' })
    expect(went).toEqual(['details'])
  })

  it('a blocking action stops the chain and reports its message (Before submit)', async () => {
    const messages: string[] = []
    const host = { values: () => ({}), state: () => ({ flags: {}, hidden: [] }), setValues: () => {}, setState: () => {}, flush: async () => {}, goTo: () => true, next: () => true, back: () => true, validate: () => true, submit: () => true, saveDraft: () => true, print: () => {}, openLink: () => true, message: (t: string) => messages.push(t), editableKeys: new Set<string>(), blank: () => null } satisfies FieldButtonHost
    const run = await runFieldButton({ actions: [...BLOCK.then, { type: 'message', text: 'never' }] }, host)
    expect(run.stopped).toBe('blocked')
    expect(run.blocked).toEqual([{ text: 'Pick a customer first' }])
    expect(messages).toEqual(['Pick a customer first'])
  })

  it('enable / disable is client state', () => {
    const effects = alwaysRuleEffects({ rules: [{ id: 'd', event: 'always', if: { match: 'all', conditions: [{ column: 'city', operator: 'is_not_set' }] }, then: [{ type: 'enable_disable', mode: 'disable', targets: ['field:notes'] }] }] }, { city: '' })
    expect([...effects.disabled]).toEqual(['field:notes'])
  })
})

describe('server checks', () => {
  const required = (vals: Record<string, unknown>, layout: unknown = LAYOUT) => validateTaskFieldValues(FIELDS, vals, { layout })

  it('validate rules run again at submit: cross-field errors and before-submit blocks', () => {
    const errors = required({ customer_name: 'A', secret: 's', city: '', start_date: '2026-05-10', end_date: '2026-05-01' })
    expect(errors.end_date).toBe('End must be after 2026-05-10')
    expect(errors.__form).toBe('Pick a customer first')
    expect(ruleValidationErrors(LAYOUT, { city: 'Berlin', start_date: '2026-05-01', end_date: '2026-05-02' })).toEqual({})
    // Drafts are not blocked.
    expect(validateTaskFieldValues(FIELDS, { city: '' }, { layout: LAYOUT, partial: true })).toEqual({})
  })

  it('a forged state cannot hide a required field: a rule\'s hide counts only when its condition holds', () => {
    const forged = { customer_name: 'A', city: 'Berlin', [FORM_STATE_KEY]: { flags: {}, hidden: ['field:secret'] } }
    expect(required(forged).secret).toBe('Secret is required')
    const real = { customer_name: 'A', city: 'Paris', [FORM_STATE_KEY]: { flags: {}, hidden: ['field:secret'] } }
    expect(required(real).secret).toBeUndefined()
    // Targets no button or rule can hide are never hidden.
    const stray = sanitizeFormState(FIELDS, LAYOUT, { [FORM_STATE_KEY]: { flags: {}, hidden: ['field:customer_name'] } }, ruleClaimGate({}))
    expect(stray.hidden).toEqual([])
  })

  it('flags a rule sets are bounded the same way', () => {
    const layout = normalizeFormLayout({ ...LAYOUT, state: { flags: [{ key: 'vip' }] }, rules: [{ id: 'f', event: 'value_change', target: 'city', if: { match: 'all', conditions: [{ column: 'city', operator: 'eq', value: 'VIP' }] }, then: [{ type: 'set_state', flag: 'vip', state_value: 'true' }] }] }, FIELDS.map((f) => f.key))!
    const state: FormUiState = applyFlag({ flags: { vip: false }, hidden: [] }, 'vip', true)
    expect(sanitizeFormState(FIELDS, layout, { city: 'Berlin', [FORM_STATE_KEY]: state }, ruleClaimGate({ city: 'Berlin' })).flags.vip).toBe(false)
    expect(sanitizeFormState(FIELDS, layout, { city: 'VIP', [FORM_STATE_KEY]: state }, ruleClaimGate({ city: 'VIP' })).flags.vip).toBe(true)
  })

  it('"Always" hides are recomputed (never trusted) and decide what is required; pages follow them', () => {
    const layout = normalizeFormLayout({ ...LAYOUT, rules: [{ id: 'a', event: 'always', if: { match: 'all', conditions: [{ column: 'city', operator: 'eq', value: 'Paris' }] }, then: [{ type: 'show_hide', mode: 'hide', targets: ['field:secret', 'page:details'] }] }] }, FIELDS.map((f) => f.key))!
    expect(required({ customer_name: 'A', city: 'Paris' }, layout).secret).toBeUndefined()
    expect(required({ customer_name: 'A', city: 'Rome' }, layout).secret).toBe('Secret is required')
    expect(visiblePages(layout, { city: 'Paris' }).map((p) => p.id)).toEqual(['pick'])
  })

  it('server actions are looked up in the saved form by rule id and index; client-only actions are not reachable', () => {
    const layout = { rules: [{ id: 'srv', event: 'row_click', target: 'customers', then: [{ type: 'message', text: 'x' }, { type: 'start_workflow', workflow_id: u(5) }] }] }
    expect(findServerRuleAction(layout, 'srv', 1)?.action).toMatchObject({ type: 'start_workflow', workflow_id: u(5) })
    expect(findServerRuleAction(layout, 'srv', 0)).toBeNull()
    expect(findServerRuleAction(layout, 'nope', 1)).toBeNull()
    expect(findServerRuleAction({ rules: [{ ...layout.rules[0], disabled: true }] }, 'srv', 1)).toBeNull()
  })

  it('after submit: matching rules add their actions (conditions judged on the stored values)', () => {
    const layout = { rules: [
      { id: 'a', event: 'after_submit', target: 'submit', if: { match: 'all', conditions: [{ column: 'city', operator: 'eq', value: 'Berlin' }] }, then: [{ type: 'message', text: 'Danke {{customer_name}}', tone: 'success' }, { type: 'start_workflow', workflow_id: u(5), inputs: { c: '{{city}}' } }] },
      { id: 'b', event: 'after_submit', target: 'other', then: [{ type: 'message', text: 'other' }] },
    ] }
    expect(afterSubmitActions(layout, 'submit', { city: 'Berlin', customer_name: 'Ana' })).toEqual([
      { type: 'message', text: 'Danke Ana' },
      { type: 'start_workflow', workflow_id: u(5), inputs: { c: '{{city}}' } },
    ])
    expect(afterSubmitActions(layout, 'submit', { city: 'Rome' })).toEqual([])
  })
})

describe('portability and accessibility', () => {
  it('rule targets are dependencies and are remapped on import', () => {
    const form = { id: u(60), name: 'F', fields: [], layout: { rows: [], rules: [{ id: 'x', event: 'form_load', then: [{ type: 'call_reference', integration_id: u(70), reference_id: u(20) }, { type: 'start_workflow', workflow_id: u(5) }] }] } }
    const { refs } = scanAssetReferences(form)
    expect(refs).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'reference', id: u(20) }),
      expect.objectContaining({ type: 'integration', id: u(70) }),
      expect.objectContaining({ type: 'workflow', id: u(5) }),
    ]))
    const maps = createEmptyAssetIdMaps()
    maps.reference[u(20)] = u(21)
    maps.integration[u(70)] = u(71)
    maps.workflow[u(5)] = u(6)
    const out = remapKnownIds(form, maps) as any
    expect(out.layout.rules[0].then).toEqual([{ type: 'call_reference', integration_id: u(71), reference_id: u(21) }, { type: 'start_workflow', workflow_id: u(6) }])
  })

  it('warns about rules that hide a required field with no way back', () => {
    const def = { fields: FIELDS as any, layout: LAYOUT as any, buttons: null }
    expect(rulesHidingRequiredFields(def)).toEqual([{ field: 'secret', rule: 'Hide secret for Paris' }])
    const withShow = { ...def, layout: { ...def.layout, rules: [...LAYOUT.rules!, { id: 's', event: 'value_change', target: 'city', then: [{ type: 'show_hide', mode: 'show', targets: ['field:secret'] }] }] } }
    expect(rulesHidingRequiredFields(withShow)).toEqual([])
    const rule = STRUCTURAL_RULES.find((r) => r.info.rule === 'rule-hides-required')!
    const findings = rule.run({ def: { fields: FIELDS, layout: LAYOUT, theme: { source: 'workspace' }, buttons: null, header: null }, values: FIELDS, opts: {} } as any)
    expect(findings[0]).toMatchObject({ rule: 'rule-hides-required', field_key: 'secret', severity: 'serious' })
  })
})
