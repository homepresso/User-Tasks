/**
 * When to load (lib/forms/lazy-load.ts): the layout model and back-compat,
 * lazy mount gating (no control, no query before a part loads), the "Load
 * section / tab" action and the "Section / tab loaded" event, submit loading
 * what it must check, values and defaults of never-mounted parts, server
 * validation unchanged, and the portability round trip.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { compactLayoutForSave, normalizeFormLayout, type FormLayout } from '@/lib/forms/layout'
import { updatePage } from '@/lib/forms/pages'
import { FORM_STATE_KEY, applyLoaded, readFormState, sanitizeFormState, type FormUiState } from '@/lib/forms/form-state'
import {
  hasLazyParts, isPartLoaded, lazyLoadProblems, lazyParts, loadableTargets, loadedConditionValue, newlyLoaded, partsHoldingFields, partsToLoad,
  preloadFieldKeys, unloadedFieldKeys, estimatePartHeight,
} from '@/lib/forms/lazy-load'
import { defaultTaskFieldValues, hiddenFieldKeysForValues, normalizeTaskFields, validateTaskFieldValues } from '@/lib/task-field-schema'
import {
  EVENT_CONTEXT, EVENT_TARGET, FORM_RULE_EVENTS, describeRuleAction, formRuleProblem, normalizeFormRules, ruleValue, rulesForEvent, type RuleKnown,
} from '@/lib/forms/form-rules'
import { normalizeFieldButtonAction, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { controlState, controlVariables, eventVariables, layoutPages, layoutSectionControls, withControlState } from '@/lib/forms/rule-variables'
import { formVariableScope } from '@/lib/forms/variable-catalog'
import { designerStateFrom, definitionFrom, updateSection } from '@/lib/forms/designer-state'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { normalizeFormAssetLikeImport } from '@/lib/portability/forms'

const DT = { source: 'table', table_id: 't-orders', mode: 'display', page_size: 5, columns: [{ key: 'order', label: 'Order', type: 'text' }] }
const FIELDS = normalizeTaskFields([
  { key: 'name', label: 'Full name', type: 'text', required: true },
  { key: 'orders', label: 'Recent orders', type: 'data_table', data_table: DT },
  { key: 'region', label: 'Region', type: 'choice', options: ['EMEA', 'APAC'], default: 'EMEA', dynamic: { options: { kind: 'table', table_id: 't-regions', value: 'code', label: 'name' } } },
  { key: 'budget', label: 'Budget', type: 'number', required: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
  { key: 'approver', label: 'Approver email', type: 'email', required: true },
])
const KEYS = FIELDS.map((f) => f.key)

/** Tabs: Applicant (eager) · Orders (when first shown; a Data table, a bound property, a default) · Approval (a rule loads it; a lazy section inside). */
function tabs(extra: Record<string, unknown> = {}): FormLayout {
  return normalizeFormLayout({
    mode: 'tabs',
    pages: [
      { id: 'applicant', title: 'Applicant', rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] },
      { id: 'orders', title: 'Orders', load: 'visible', preload: true, rows: [{ columns: 1, cells: [{ field_key: 'orders', span: 1 }] }, { columns: 2, cells: [{ field_key: 'region', span: 1 }, { field_key: 'budget', span: 1 }] }] },
      { id: 'approval', title: 'Approval', load: 'rule', rows: [{ columns: 1, cells: [{ field_key: 'notes', span: 1 }] }, { columns: 1, cells: [{ field_key: 'approver', span: 1 }], section: 'signoff' }] },
    ],
    sections: [{ key: 'signoff', title: 'Sign-off', load: 'visible' }],
    ...extra,
  }, KEYS)!
}

/** One page: a lazy section holding the Data table and the bound choice. */
function single(load: 'visible' | 'rule' = 'visible'): FormLayout {
  return normalizeFormLayout({
    rows: [
      { columns: 1, cells: [{ field_key: 'name', span: 1 }] },
      { columns: 1, cells: [{ field_key: 'orders', span: 1 }], section: 'history' },
      { columns: 2, cells: [{ field_key: 'region', span: 1 }, { field_key: 'budget', span: 1 }], section: 'history' },
      { columns: 1, cells: [{ field_key: 'notes', span: 1 }, { field_key: 'approver', span: 1 }] },
    ],
    sections: [{ key: 'history', title: 'Order history', load }],
  }, KEYS)!
}

const loadedState = (layout: unknown, targets: string[]): FormUiState => applyLoaded(readFormState(layout, {}), targets)

describe('layout model and back-compat', () => {
  it('keeps load / preload on pages and sections; eager is the default and not stored; preload needs a lazy part', () => {
    const layout = tabs()
    expect(layout.pages!.map((p) => [p.id, p.load ?? null, p.preload ?? null])).toEqual([['applicant', null, null], ['orders', 'visible', true], ['approval', 'rule', null]])
    expect(layout.sections).toEqual([{ key: 'signoff', title: 'Sign-off', load: 'visible' }])
    const odd = normalizeFormLayout({
      mode: 'tabs',
      pages: [{ id: 'a', title: 'A', load: 'eager', preload: true, rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] }, { id: 'b', title: 'B', load: 'later', rows: [] }],
      sections: [], rows: [],
    }, ['name'])!
    expect(odd.pages!.map((p) => ({ load: p.load, preload: p.preload }))).toEqual([{ load: undefined, preload: undefined }, { load: undefined, preload: undefined }])
  })

  it('old forms (no load anywhere) have no lazy part and load everything', () => {
    const old = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }], sections: [] }, KEYS)!
    expect(hasLazyParts(old)).toBe(false)
    expect(unloadedFieldKeys(old, {}).size).toBe(0)
    expect(hasLazyParts(null)).toBe(false)
  })

  it('lists the lazy parts with their fields; a field in a lazy section on a lazy page waits for both', () => {
    const layout = tabs()
    expect(lazyParts(layout).map((p) => [p.target, p.load, p.fieldKeys])).toEqual([
      ['page:orders', 'visible', ['orders', 'region', 'budget']],
      ['page:approval', 'rule', ['notes', 'approver']],
      ['section:signoff', 'visible', ['approver']],
    ])
    expect([...unloadedFieldKeys(layout, {})].sort()).toEqual(['approver', 'budget', 'notes', 'orders', 'region'])
    const pageLoaded = { [FORM_STATE_KEY]: loadedState(layout, ['page:approval']) }
    expect([...unloadedFieldKeys(layout, pageLoaded)].sort()).toEqual(['approver', 'budget', 'orders', 'region'])
    expect(isPartLoaded(layout, pageLoaded, 'page:approval')).toBe(true)
    expect(isPartLoaded(layout, pageLoaded, 'page:applicant')).toBe(true)
    expect(isPartLoaded(layout, pageLoaded, 'section:signoff')).toBe(false)
    // Read-only views load everything.
    expect(unloadedFieldKeys(layout, {}, true).size).toBe(0)
    // Preload: the opted-in part's fields, until it loads.
    expect([...preloadFieldKeys(layout, {})]).toEqual(['orders', 'region', 'budget'])
  })

  it('the designer sets and clears the mode (eager drops the keys)', () => {
    let layout = updatePage(tabs(), 'applicant', { load: 'rule', preload: true })
    expect(layout.pages![0]).toMatchObject({ load: 'rule', preload: true })
    layout = updatePage(layout, 'applicant', { load: undefined, preload: undefined })
    expect(layout.pages![0]).not.toHaveProperty('load')
    expect(layout.pages![0]).not.toHaveProperty('preload')
    const def = normalizeFormDefinition({ fields: FIELDS, layout: single() })
    let state = designerStateFrom(def)
    state = updateSection(state, 'history', { load: 'rule', preload: true })
    expect(state.layout.sections![0]).toMatchObject({ load: 'rule', preload: true })
    state = updateSection(state, 'history', { load: 'eager' })
    expect(state.layout.sections![0]).not.toHaveProperty('load')
    expect(state.layout.sections![0]).not.toHaveProperty('preload')
    expect(definitionFrom(updateSection(state, 'history', { load: 'visible' })).layout!.sections![0].load).toBe('visible')
  })

  it('the loaded list is presentation only: one-way, read leniently, never kept by the server', () => {
    const layout = tabs()
    const once = loadedState(layout, ['page:orders', 'field:name' as string, 'page:orders'])
    expect(once.loaded).toEqual(['page:orders'])
    expect(applyLoaded(once, ['page:orders'])).toBe(once)
    expect(readFormState(layout, { [FORM_STATE_KEY]: { flags: {}, hidden: [], loaded: ['page:orders', 'row:x', 42] } }).loaded).toEqual(['page:orders'])
    expect(sanitizeFormState(FIELDS, layout, { [FORM_STATE_KEY]: { flags: {}, hidden: [], loaded: ['page:orders'] } })).not.toHaveProperty('loaded')
  })
})

const wrap = (el: any, client = new QueryClient()) => renderToStaticMarkup(
  createElement(QueryClientProvider, { client }, createElement(FormLookupProvider as any, { source: { kind: 'form', formId: 'f-1' } }, el)),
)
const render = (props: any, client?: QueryClient) => wrap(createElement(FormRenderer, { fields: FIELDS, values: {}, onChange: () => {}, ...props }), client)
const dynamicQueries = (client: QueryClient) => client.getQueryCache().findAll({ queryKey: ['form-dynamic-value'] }).map((q) => q.queryKey[2])

describe('lazy mount gating', () => {
  it('a lazy section shows a placeholder with its title: no Data table, no bound-property query', () => {
    const client = new QueryClient()
    const html = render({ layout: single() }, client)
    expect(html).toContain('data-lazy-placeholder="section:history"')
    expect(html).toContain('Order history')
    expect(html).not.toContain('Recent orders')
    expect(html).not.toContain('Budget')
    // Fields outside the part render as usual.
    expect(html).toContain('Full name')
    expect(dynamicQueries(client)).toEqual([])
  })

  it('once loaded it mounts its controls and kicks off their queries', () => {
    const layout = single()
    const client = new QueryClient()
    const html = render({ layout, values: { [FORM_STATE_KEY]: loadedState(layout, ['section:history']) } }, client)
    expect(html).not.toContain('data-lazy-placeholder')
    expect(html).toContain('data-lazy-loaded="section:history"')
    expect(html).toContain('Recent orders')
    expect(html).toContain('Budget')
    expect(dynamicQueries(client)).toEqual(['region'])
  })

  it('tabs: the first tab mounts; a lazy tab neither mounts nor resolves its bound properties before it loads', () => {
    const layout = tabs()
    const client = new QueryClient()
    const html = render({ layout }, client)
    expect(html).toContain('data-current-page="applicant"')
    expect(html).toContain('Full name')
    expect(dynamicQueries(client)).toEqual([])
    // Today's behaviour for an eager tab: its bound properties resolve on open.
    const eager = normalizeFormLayout({ ...tabs(), pages: tabs().pages!.map((p) => ({ ...p, load: undefined, preload: undefined })) }, KEYS)
    const eagerClient = new QueryClient()
    render({ layout: eager }, eagerClient)
    expect(dynamicQueries(eagerClient)).toEqual(['region'])
  })

  it('a bound DEFAULT still resolves for an unloaded part (it is a value, not a control)', () => {
    const fields = FIELDS.map((f) => (f.key === 'region' ? { ...f, dynamic: { default: { kind: 'table', table_id: 't-regions', value: 'code', label: 'name' } } } as any : f))
    const client = new QueryClient()
    render({ fields, layout: single() }, client)
    expect(dynamicQueries(client)).toEqual(['region'])
  })

  it('the placeholder keeps about the controls\' height (a later section is not pulled into view)', () => {
    const byKey = new Map(FIELDS.map((f) => [f.key, f]))
    const rows = single().rows.filter((r) => r.section === 'history')
    // A 5-row Data table, then a row of two inputs.
    expect(estimatePartHeight(rows, byKey)).toBe((110 + 5 * 29) + 64 + 12)
    const html = render({ layout: single() })
    expect(/<div[^>]*data-lazy-placeholder="section:history"[^>]*>/.exec(html)?.[0]).toContain('min-height:331px')
  })

  it('read-only views (completed tasks, print) load everything', () => {
    const html = render({ layout: single(), readOnly: true, onChange: undefined, values: { budget: 12 } })
    expect(html).not.toContain('data-lazy-placeholder')
    expect(html).toContain('Recent orders')
    const stacked = render({ layout: tabs(), readOnly: true, onChange: undefined, values: { name: 'Ann', budget: 5, notes: 'n', approver: 'a@b.co' } })
    expect(stacked).toContain('data-form-pages="stacked"')
    expect(stacked).not.toContain('data-lazy-placeholder')
    expect(stacked).toContain('Approver email')
  })
})

const KNOWN: RuleKnown = {
  fieldKeys: new Set(KEYS), valueKeys: new Set(KEYS), fieldTypes: new Map(FIELDS.map((f) => [f.key, f.type])),
  pageIds: new Set(['applicant', 'orders', 'approval']), flags: new Set(), sectionKeys: new Set(['signoff']),
}

describe('rules: Load section / tab, Section / tab loaded, .loaded conditions', () => {
  it('normalizes the action (sections and steps / tabs only) and the event (target section:/page:)', () => {
    expect(normalizeFieldButtonAction({ type: 'load_part', targets: ['section:signoff', 'page:approval', 'field:name', 'nope'] }, { rule: true }))
      .toEqual({ type: 'load_part', targets: ['section:signoff', 'page:approval'] })
    expect(FORM_RULE_EVENTS).toContain('part_loaded')
    expect(EVENT_TARGET.part_loaded).toBe('part')
    expect(EVENT_CONTEXT.part_loaded).toEqual(['event.part'])
    const [rule] = normalizeFormRules([{ id: 'r1', event: 'part_loaded', target: 'page:approval', then: [{ type: 'load_part', targets: ['section:signoff'] }] }])
    expect(rule).toMatchObject({ event: 'part_loaded', target: 'page:approval' })
    expect(normalizeFormRules([{ id: 'r2', event: 'part_loaded', target: 'bad target', then: [] }])[0].target).toBeUndefined()
    expect(eventVariables('part_loaded', undefined, []).map((v) => v.path)).toEqual(['event.part'])
  })

  it('checks targets against the form', () => {
    expect(formRuleProblem({ id: 'a', event: 'form_load', then: [{ type: 'load_part', targets: ['page:approval'] }] }, KNOWN)).toBeNull()
    expect(formRuleProblem({ id: 'b', event: 'form_load', then: [{ type: 'load_part', targets: [] }] }, KNOWN)).toMatch(/choose what it loads/)
    expect(formRuleProblem({ id: 'c', event: 'form_load', then: [{ type: 'load_part', targets: ['section:ghost'] }] }, KNOWN)).toMatch(/not a section or step/)
    expect(formRuleProblem({ id: 'd', event: 'part_loaded', target: 'page:ghost', then: [{ type: 'message', text: 'x' }] }, KNOWN)).toMatch(/not a section or step/)
    const def = { fields: FIELDS as any, layout: tabs() as any }
    expect(describeRuleAction(def, { type: 'load_part', targets: ['page:approval', 'section:signoff'] })).toBe('Load Approval, section Sign-off')
  })

  it('the action loads the part through the state (and only marks lazy-capable targets)', async () => {
    const layout = tabs()
    let state = readFormState(layout, {})
    const host = { state: () => state, setState: (s: FormUiState) => { state = s }, values: () => ({}), flush: async () => {} } as unknown as FieldButtonHost
    const run = await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'load_part', targets: ['page:approval', 'section:signoff'] }, { rule: true })!] }, host)
    expect(run.stopped).toBeUndefined()
    expect(state.loaded).toEqual(['page:approval', 'section:signoff'])
    expect(unloadedFieldKeys(layout, { [FORM_STATE_KEY]: state }).has('approver')).toBe(false)
  })

  it('"Section / tab loaded" runs for its part (or any part); newlyLoaded gives the parts to dispatch', () => {
    const rules = normalizeFormRules([
      { id: 'one', event: 'part_loaded', target: 'section:signoff', then: [{ type: 'message', text: 'Signed' }] },
      { id: 'any', event: 'part_loaded', then: [{ type: 'message', text: 'Any' }] },
    ])
    expect(rulesForEvent(rules, { type: 'part_loaded', target: 'section:signoff', context: { part: 'section:signoff' } }).map((r) => r.id)).toEqual(['one', 'any'])
    expect(rulesForEvent(rules, { type: 'part_loaded', target: 'page:orders' }).map((r) => r.id)).toEqual(['any'])
    expect(newlyLoaded(new Set(['page:orders']), new Set(['page:orders', 'section:signoff']))).toEqual(['section:signoff'])
  })

  it('conditions: section.<key>.loaded / step.<id>.loaded — eager parts are loaded, lazy ones once loaded', () => {
    const layout = tabs()
    const scopeFor = (targets: string[]) => {
      const values = withControlState(FIELDS as any, { [FORM_STATE_KEY]: loadedState(layout, targets) }, layoutPages(layout), layoutSectionControls(layout))
      return { values }
    }
    expect(ruleValue('step.applicant.loaded', scopeFor([]))).toBe(true)
    expect(ruleValue('step.approval.loaded', scopeFor([]))).toBe(false)
    expect(ruleValue('section.signoff.loaded', scopeFor([]))).toBe(false)
    expect(ruleValue('step.approval.loaded', scopeFor(['page:approval']))).toBe(true)
    expect(ruleValue('section.signoff.loaded', scopeFor(['section:signoff']))).toBe(true)
    // Without the control state: the loaded list.
    expect(ruleValue('section.signoff.loaded', { values: { [FORM_STATE_KEY]: { flags: {}, hidden: [], loaded: ['section:signoff'] } } })).toBe(true)
    expect(loadedConditionValue('step.approval.loaded', {}, layout)).toBe(false)
    expect(loadedConditionValue('step.applicant.loaded', {}, layout)).toBe(true)
    expect(loadedConditionValue('section.signoff.visible', {}, layout)).toBeNull()
  })

  it('controls: {{control.<section>.loaded}} and {{control.form.loaded.<page>}}, listed and derived; the picker has them', () => {
    const layout = tabs()
    const pages = layoutPages(layout)
    const sections = layoutSectionControls(layout)
    const paths = controlVariables(FIELDS as any, pages, sections).map((v) => v.path)
    expect(paths).toEqual(expect.arrayContaining(['control.signoff.loaded', 'control.form.loaded.applicant', 'control.form.loaded.approval']))
    const state = controlState(FIELDS as any, { [FORM_STATE_KEY]: loadedState(layout, ['page:orders']) }, pages, sections)
    expect(state.signoff.loaded).toBe(false)
    expect(state.form.loaded).toEqual({ applicant: true, orders: true, approval: false })
    const picker = formVariableScope({ fields: FIELDS as any, layout, values: {} }, { kind: 'rule', event: 'form_load', slot: 'condition' })
    const names = picker.items.map((v) => v.path)
    expect(names).toEqual(expect.arrayContaining(['control.signoff.loaded', 'control.form.loaded.orders', 'section.signoff.loaded']))
  })

  it('designer: a "when a rule loads it" part no rule loads gets a warning', () => {
    const layout = tabs()
    expect(Object.keys(lazyLoadProblems(layout, FIELDS as any))).toEqual(['page:approval'])
    const loadedByRule = tabs({ rules: [{ id: 'r', event: 'value_change', target: 'name', then: [{ type: 'load_part', targets: ['page:approval'] }] }] })
    expect(lazyLoadProblems(loadedByRule, FIELDS as any)).toEqual({})
    // A Button's steps count too.
    const button = { key: 'go', type: 'button', button: { actions: [{ type: 'load_part', targets: ['page:approval'] }] } }
    expect(lazyLoadProblems(layout, [button])).toEqual({})
    // A disabled rule does not.
    const off = tabs({ rules: [{ id: 'r', disabled: true, event: 'value_change', target: 'name', then: [{ type: 'load_part', targets: ['page:approval'] }] }] })
    expect(Object.keys(lazyLoadProblems(off, FIELDS as any))).toEqual(['page:approval'])
    expect(loadableTargets(layout).map((t) => `${t.target}:${t.load}`)).toEqual(['page:applicant:eager', 'page:orders:visible', 'page:approval:rule', 'section:signoff:visible'])
  })
})

describe('submit: load what must be checked, then validate', () => {
  it('a submit loads every shown, unloaded part holding a required field', () => {
    const layout = tabs()
    const required = new Set(FIELDS.filter((f) => f.required).map((f) => f.key))
    const hidden = hiddenFieldKeysForValues(FIELDS, {}, layout)
    expect(partsToLoad(layout, {}, (k) => hidden.has(k), (k) => required.has(k))).toEqual(['page:orders', 'page:approval', 'section:signoff'])
    // A part holding no required field stays unloaded.
    const notesOnly = normalizeFormLayout({ ...single(), sections: [{ key: 'history', title: 'History', load: 'rule' }] }, KEYS)!
    const noRequired = normalizeFormLayout({
      rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }, { field_key: 'budget', span: 1 }, { field_key: 'approver', span: 1 }] }, { columns: 1, cells: [{ field_key: 'notes', span: 1 }], section: 'extra' }],
      sections: [{ key: 'extra', title: 'Extra', load: 'visible' }],
    }, KEYS)!
    expect(partsToLoad(noRequired, {}, () => false, (k) => required.has(k))).toEqual([])
    expect(partsToLoad(notesOnly, {}, () => false, (k) => required.has(k))).toEqual(['section:history'])
    // Already loaded: nothing to do.
    expect(partsToLoad(layout, { [FORM_STATE_KEY]: loadedState(layout, ['page:orders', 'page:approval', 'section:signoff']) }, () => false, (k) => required.has(k))).toEqual([])
  })

  it('hidden parts follow the existing rules: a hidden tab or an excluded optional section is not loaded (its fields are not required)', () => {
    const layout = tabs({ state: { hidden: ['page:approval'] } })
    const required = new Set(FIELDS.filter((f) => f.required).map((f) => f.key))
    const hidden = hiddenFieldKeysForValues(FIELDS, {}, layout)
    expect(hidden.has('approver')).toBe(true)
    expect(partsToLoad(layout, {}, (k) => hidden.has(k), (k) => required.has(k))).toEqual(['page:orders'])
    const optional = normalizeFormLayout({ ...single(), sections: [{ key: 'history', title: 'History', load: 'visible', optional: true }] }, KEYS)!
    const hiddenOptional = hiddenFieldKeysForValues(FIELDS, {}, optional)
    expect(partsToLoad(optional, {}, (k) => hiddenOptional.has(k), (k) => required.has(k))).toEqual([])
    expect(validateTaskFieldValues(FIELDS, { name: 'Ann', approver: 'a@b.co' }, { layout: optional })).toEqual({})
  })

  it('validation is definition-based: a lazy part\'s required field is required whether or not it ever mounted; an error loads its part', () => {
    const layout = tabs()
    const errors = validateTaskFieldValues(FIELDS, { name: 'Ann' }, { layout })
    expect(Object.keys(errors).sort()).toEqual(['approver', 'budget'])
    expect(partsHoldingFields(layout, {}, Object.keys(errors))).toEqual(['page:orders', 'page:approval', 'section:signoff'])
    // The loaded list never changes what is required.
    const loaded = { name: 'Ann', [FORM_STATE_KEY]: loadedState(layout, ['page:orders', 'page:approval', 'section:signoff']) }
    expect(validateTaskFieldValues(FIELDS, loaded, { layout })).toEqual(errors)
  })
})

describe('values and defaults of never-mounted parts', () => {
  it('defaults are in the form state from the start, whatever loads when', () => {
    const lazy = defaultTaskFieldValues(FIELDS)
    expect(lazy.region).toBe('EMEA')
    // The same initial values with or without lazy parts: values never depend on mounting.
    expect(unloadedFieldKeys(tabs(), lazy).has('region')).toBe(true)
  })

  it('a never-mounted part\'s values (defaults, prefilled, rule-set) validate and submit like any other', () => {
    const layout = tabs()
    const values = { ...defaultTaskFieldValues(FIELDS), name: 'Ann', budget: 1200, approver: 'boss@example.com', notes: 'set by a rule' }
    expect(unloadedFieldKeys(layout, values).size).toBe(5)
    expect(validateTaskFieldValues(FIELDS, values, { layout })).toEqual({})
  })

  it('a rule that sets a value in an unloaded part changes the values (the control shows it when it mounts)', async () => {
    const layout = single('rule')
    let values: Record<string, unknown> = { name: 'Ann' }
    let state = readFormState(layout, values)
    const host = {
      state: () => state, setState: (s: FormUiState) => { state = s }, values: () => values, flush: async () => {},
      editableKeys: new Set(KEYS), setValues: (patch: Record<string, unknown>) => { values = { ...values, ...patch } },
    } as unknown as FieldButtonHost
    await runFieldButton({ actions: [normalizeFieldButtonAction({ type: 'set_values', assign: { budget: '250' } }, { rule: true })!] }, host)
    expect(values.budget).toBe('250')
    expect(unloadedFieldKeys(layout, { ...values, [FORM_STATE_KEY]: state }).has('budget')).toBe(true)
    const html = render({ layout, values: { ...values, [FORM_STATE_KEY]: applyLoaded(state, ['section:history']) } })
    expect(html).toContain('value="250"')
  })
})

describe('portability round trip', () => {
  it('load / preload survive export / import normalization, a JSON round trip and save compaction', () => {
    const layout = tabs({ rules: [{ id: 'r', event: 'part_loaded', target: 'page:orders', then: [{ type: 'load_part', targets: ['page:approval'] }] }] })
    const asset = { name: 'Purchase request', fields: FIELDS, layout: compactLayoutForSave(layout, KEYS), theme: { source: 'workspace' } }
    const exported = JSON.parse(JSON.stringify(normalizeFormAssetLikeImport(asset)))
    const imported = normalizeFormAssetLikeImport(exported)
    expect(imported.layout.pages.map((p: any) => [p.id, p.load ?? null, p.preload ?? null])).toEqual([['applicant', null, null], ['orders', 'visible', true], ['approval', 'rule', null]])
    expect(imported.layout.sections).toEqual([{ key: 'signoff', title: 'Sign-off', load: 'visible' }])
    expect(imported.layout.rules[0]).toMatchObject({ event: 'part_loaded', target: 'page:orders', then: [{ type: 'load_part', targets: ['page:approval'] }] })
    expect(imported).toEqual(normalizeFormAssetLikeImport(imported))
    // The definition the API, versions and packages store.
    const def = normalizeFormDefinition({ fields: FIELDS, layout: imported.layout })
    expect(def.layout!.pages![1]).toMatchObject({ load: 'visible', preload: true })
  })
})
