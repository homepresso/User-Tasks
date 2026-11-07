/**
 * Buttons anywhere & form state (lib/forms/field-buttons.ts, form-state.ts):
 * the Button field's schema and back-compat, every On click action against
 * a fake host, state flags in visible_when and the precedence of button
 * hides, the server's bound on a submitted state (it cannot hide a required
 * field the form's buttons cannot hide), Application mode, and the warning
 * when a task form has no way to submit.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormPagesProvider } from '@/components/forms/form-pages'
import { FormButtonBar } from '@/components/forms/form-shell'
import { compactLayoutForSave, normalizeFormLayout } from '@/lib/forms/layout'
import { setPageMode, visiblePages } from '@/lib/forms/pages'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { checkFormAccessibility } from '@/lib/forms/accessibility'
import { designerStateFrom, definitionFrom, designerProblems, removeField, updateField, addField } from '@/lib/forms/designer-state'
import {
  FORM_STATE_KEY, applyFlag, applyVisibility, initialFormState, isApplicationMode, isInformationPage, sanitizeFormState, stateHiddenFieldKeys,
  submitPathProblem, targetFieldKeys,
} from '@/lib/forms/form-state'
import { describeFieldButton, fieldButtonProblem, normalizeFieldButton, runFieldButton, type FieldButtonHost } from '@/lib/forms/field-buttons'
import { isDisplayField, mergeTaskFieldValues, normalizeTaskFields, validateTaskFieldValues, valueFields } from '@/lib/task-field-schema'

const FIELDS = normalizeTaskFields([
  { key: 'name', label: 'Full name', type: 'text', required: true },
  { key: 'details_heading', label: 'More details', type: 'heading' },
  { key: 'employer', label: 'Employer', type: 'text', required: true },
  { key: 'salary', label: 'Salary', type: 'number' },
  { key: 'other_heading', label: 'Other', type: 'heading' },
  { key: 'notes', label: 'Notes', type: 'textarea', required: true, visible_when: { field: 'state.show_notes', operator: 'equals', value: 'true' } },
  {
    key: 'more', label: 'Show more details', type: 'button',
    button: { style: 'secondary', icon: 'chevron-down', actions: [{ type: 'show_hide', mode: 'toggle', targets: ['section:details_heading', 'page:extra'] }] },
  },
  { key: 'notes_toggle', label: 'Add notes', type: 'button', button: { style: 'link', actions: [{ type: 'set_state', flag: 'show_notes', state_value: 'true' }] } },
  { key: 'send', label: 'Send application', type: 'button', button: { style: 'primary', actions: [{ type: 'validate' }, { type: 'submit', button: 'submit' }] } },
  { key: 'extra_q', label: 'Extra question', type: 'text', required: true },
])
const KEYS = FIELDS.map((f) => f.key)
const SINGLE = normalizeFormLayout({
  rows: [
    { columns: 1, cells: [{ field_key: 'name', span: 1 }] },
    { columns: 1, cells: [{ field_key: 'more', span: 1 }] },
    { columns: 1, cells: [{ field_key: 'details_heading', span: 1 }] },
    { columns: 2, cells: [{ field_key: 'employer', span: 1 }, { field_key: 'salary', span: 1 }] },
    { columns: 1, cells: [{ field_key: 'other_heading', span: 1 }] },
    { columns: 1, cells: [{ field_key: 'notes', span: 1 }, ] },
    { columns: 2, cells: [{ field_key: 'notes_toggle', span: 1 }, { field_key: 'send', span: 1 }] },
    { columns: 1, cells: [{ field_key: 'extra_q', span: 1 }] },
  ],
  state: { flags: [{ key: 'show_notes' }], hidden: ['section:details_heading', 'field:ghost'] },
  application_mode: true,
}, KEYS)!

const TABS = normalizeFormLayout({
  mode: 'tabs',
  pages: [
    { id: 'main', title: 'Application', rows: SINGLE.rows.slice(0, 7) },
    { id: 'extra', title: 'Extra', rows: [{ columns: 1, cells: [{ field_key: 'extra_q', span: 1 }] }] },
  ],
  state: { flags: [{ key: 'show_notes' }], hidden: ['section:details_heading', 'page:extra'] },
}, KEYS)!

describe('schema and back-compat', () => {
  it('a Button is a display field with a cleaned config; unknown actions / targets are dropped', () => {
    const more = FIELDS.find((f) => f.key === 'more')!
    expect(isDisplayField(more)).toBe(true)
    expect(valueFields(FIELDS).map((f) => f.key)).not.toContain('more')
    expect(more.button).toEqual({ style: 'secondary', icon: 'chevron-down', actions: [{ type: 'show_hide', mode: 'toggle', targets: ['section:details_heading', 'page:extra'] }] })
    const raw = normalizeFieldButton({ style: 'weird', size: 'xl', actions: [{ type: 'nope' }, { type: 'show_hide', targets: ['bad', 'field:x'] }, { type: 'set_state', flag: 'Show Details!', state_value: true }] })
    expect(raw).toEqual({ style: 'secondary', actions: [{ type: 'show_hide', mode: 'toggle', targets: ['field:x'] }, { type: 'set_state', flag: 'show_details', state_value: 'true' }] })
    const [b] = normalizeTaskFields([{ key: 'b', label: 'B', type: 'button', button: { actions: [], disabled_when: { field: 'state.Ready', operator: 'equals', value: 'false' } }, required: true }])
    expect(b.required).toBeUndefined()
    expect(b.button?.disabled_when).toEqual({ field: 'state.ready', operator: 'equals', value: 'false' })
  })

  it('layout keeps state flags, known start-hidden targets and application mode; old layouts are unchanged', () => {
    expect(SINGLE.state).toEqual({ flags: [{ key: 'show_notes' }], hidden: ['section:details_heading'] })
    expect(SINGLE.application_mode).toBe(true)
    expect(compactLayoutForSave(SINGLE, KEYS)).toMatchObject({ state: SINGLE.state, application_mode: true })
    const plain = normalizeFormLayout({ rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] }, ['name'])!
    expect(plain).toEqual({ rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] })
    expect(compactLayoutForSave(plain, ['name'])).toBeNull()
    // A trivial grid with Application mode on is still stored.
    expect(compactLayoutForSave({ ...plain, application_mode: true }, ['name'])).toEqual({ ...plain, application_mode: true })
    // A page rule on a declared flag is kept; on an undeclared flag dropped.
    const paged = normalizeFormLayout({ mode: 'steps', state: { flags: ['branch'] }, pages: [
      { id: 'a', title: 'A', rows: [{ columns: 1, cells: [{ field_key: 'name', span: 1 }] }] },
      { id: 'b', title: 'B', visible_when: { field: 'state.branch', operator: 'equals', value: 'true' }, rows: [] },
      { id: 'c', title: 'C', visible_when: { field: 'state.nope', operator: 'equals', value: 'true' }, rows: [] },
    ] }, ['name'])!
    expect(paged.pages![1].visible_when).toEqual({ field: 'state.branch', operator: 'equals', value: 'true' })
    expect(paged.pages![2].visible_when).toBeUndefined()
  })

  it('travels in a stored definition (versions, exports, packages read the same shape)', () => {
    const def = normalizeFormDefinition({ fields: FIELDS, layout: TABS })
    const again = normalizeFormDefinition(JSON.parse(JSON.stringify({ fields: def.fields, layout: def.layout })))
    expect(again).toEqual(def)
    expect(again.fields.find((f) => f.key === 'send')!.button!.actions.map((a) => a.type)).toEqual(['validate', 'submit'])
  })

  it('the designer round-trips buttons, renames keys inside actions and drops references to deleted fields', () => {
    const state = designerStateFrom(normalizeFormDefinition({ fields: FIELDS, layout: SINGLE }))
    expect(definitionFrom(state).layout).toEqual(SINGLE)
    const heading = state.fields.find((f) => f.key === 'details_heading')!
    const renamed = updateField(state, heading._id, { key: 'details' })
    expect(renamed.fields.find((f) => f.key === 'more')!.button!.actions[0].targets).toEqual(['section:details', 'page:extra'])
    expect(renamed.layout.state?.hidden).toEqual(['section:details'])
    const removed = removeField(renamed, renamed.fields.find((f) => f.key === 'details')!._id)
    expect(removed.fields.find((f) => f.key === 'more')!.button!.actions[0].targets).toEqual(['page:extra'])
    expect(removed.layout.state?.hidden).toBeUndefined()
    const { state: withButton, field } = addField(state, 'button')
    expect(field.button).toEqual({ style: 'secondary', actions: [] })
    // Grid edits on a single-page form keep the form state and Application mode.
    expect(withButton.layout.application_mode).toBe(true)
    expect(withButton.layout.state).toEqual(SINGLE.state)
    expect(setPageMode(setPageMode(withButton.layout, 'steps'), 'single')).toMatchObject({ application_mode: true, state: SINGLE.state })
    expect(designerProblems(withButton)[field._id]).toMatch(/at least one action/)
  })

  it('designer problems: unknown targets, undeclared flags, pages on a single form, bad links', () => {
    const known = { fieldKeys: new Set(KEYS), valueKeys: new Set(['name']), headingKeys: new Set(['details_heading']), pageIds: new Set<string>(), flags: new Set(['show_notes']), paged: false, policy: { appOrigin: 'https://app.example.com' } }
    expect(fieldButtonProblem({ style: 'primary', actions: [{ type: 'show_hide', targets: ['field:ghost'] }] }, known)).toMatch(/not on this form/)
    expect(fieldButtonProblem({ style: 'primary', actions: [{ type: 'show_hide', targets: ['section:name'] }] }, known)).toMatch(/Section heading/)
    expect(fieldButtonProblem({ style: 'primary', actions: [{ type: 'set_state', flag: 'other', state_value: 'toggle' }] }, known)).toMatch(/not declared/)
    expect(fieldButtonProblem({ style: 'primary', actions: [{ type: 'next_page' }] }, known)).toMatch(/steps/)
    expect(fieldButtonProblem({ style: 'primary', actions: [{ type: 'open_link', url: 'https://evil.example' }] }, known)).toMatch(/allowed/)
    expect(fieldButtonProblem({ style: 'primary', actions: [{ type: 'open_link', url: '/tasks' }, { type: 'set_values', assign: { name: '{{x}}' } }] }, known)).toBeNull()
    expect(describeFieldButton(FIELDS.find((f) => f.key === 'more')!.button)).toBe('Toggle 2 elements')
  })
})

/* ── Actions ─────────────────────────────────────────────────────────── */

function fakeHost(values: Record<string, unknown> = {}, layout: unknown = SINGLE) {
  const log: string[] = []
  const store: Record<string, unknown> = { ...values }
  let state = initialFormState(layout)
  const host: FieldButtonHost & { store: typeof store; log: string[]; currentState: () => typeof state } = {
    store, log,
    currentState: () => state,
    values: () => ({ ...store, [FORM_STATE_KEY]: state }),
    state: () => state,
    setValues: (patch) => { Object.assign(store, patch); log.push(`set:${Object.keys(patch).join(',')}`) },
    setState: (next) => { state = next; log.push('state') },
    flush: async () => { log.push('flush') },
    goTo: (id) => { log.push(`goto:${id}`); return true },
    next: () => { log.push('next'); return store.step_ok !== false },
    back: () => { log.push('back'); return true },
    validate: (scope) => { log.push(`validate:${scope}`); return store.valid !== false },
    submit: (id) => { log.push(`submit:${id ?? ''}`); return store.no_bar !== true },
    saveDraft: () => { log.push('draft'); return true },
    print: () => { log.push('print') },
    openLink: (url, tab) => { log.push(`link:${url}:${tab}`); return url.startsWith('/') },
    message: (text, tone) => { log.push(`message:${tone}:${text}`) },
    editableKeys: new Set(['name', 'employer', 'salary', 'notes']),
    blank: (key) => (key === 'salary' ? null : ''),
  }
  return host
}

describe('On click actions', () => {
  it('show / hide / toggle targets and set / toggle flags', async () => {
    const host = fakeHost()
    await runFieldButton({ style: 'primary', actions: [{ type: 'show_hide', mode: 'toggle', targets: ['section:details_heading'] }] }, host)
    expect(host.currentState().hidden).toEqual([])
    await runFieldButton({ style: 'primary', actions: [{ type: 'show_hide', mode: 'hide', targets: ['field:salary', 'row:name'] }, { type: 'set_state', flag: 'show_notes', state_value: 'toggle' }] }, host)
    expect(host.currentState()).toEqual({ flags: { show_notes: true }, hidden: ['field:salary', 'row:name'] })
    await runFieldButton({ style: 'primary', actions: [{ type: 'show_hide', mode: 'show', targets: ['field:salary'] }, { type: 'set_state', flag: 'show_notes', state_value: 'false' }] }, host)
    expect(host.currentState()).toEqual({ flags: { show_notes: false }, hidden: ['row:name'] })
    expect(applyFlag({ flags: {}, hidden: [] }, 'x', 'toggle').flags.x).toBe(true)
    expect(applyVisibility({ flags: {}, hidden: ['field:a'] }, 'toggle', ['field:a', 'page:b', 'junk']).hidden).toEqual(['page:b'])
  })

  it('set values (literal and {{template}}, editable fields only) and clear', async () => {
    const host = fakeHost({ name: 'Ada', salary: 5 })
    await runFieldButton({ style: 'primary', actions: [{ type: 'set_values', assign: { employer: 'Works of {{name}}', salary: '{{salary}}', send: 'x' } }, { type: 'clear_values', fields: ['name', 'extra_q'] }] }, host)
    expect(host.store).toMatchObject({ employer: 'Works of Ada', salary: 5, name: '' })
    expect(host.store.send).toBeUndefined()
    expect(host.store.extra_q).toBeUndefined()
  })

  it('navigation, validate (stops on errors), next (stops on step errors), print, link, message, draft', async () => {
    const host = fakeHost({ name: 'Ada' })
    const run = await runFieldButton({ style: 'primary', actions: [
      { type: 'set_state', flag: 'show_notes', state_value: 'true' }, { type: 'go_to_page', page: 'extra' }, { type: 'previous_page' }, { type: 'next_page' },
      { type: 'validate', scope: 'page' }, { type: 'print' }, { type: 'open_link', url: '/tasks', new_tab: true }, { type: 'message', text: 'Hi {{name}}', tone: 'success' }, { type: 'save_draft' },
    ] }, host)
    expect(run).toEqual({ ran: ['set_state', 'go_to_page', 'previous_page', 'next_page', 'validate', 'print', 'open_link', 'message', 'save_draft'] })
    // React applies the state change before anything reads the surface.
    expect(host.log).toEqual(['state', 'flush', 'goto:extra', 'back', 'next', 'validate:page', 'print', 'link:/tasks:true', 'message:success:Hi Ada', 'draft'])
    const invalid = fakeHost({ valid: false })
    expect(await runFieldButton({ style: 'primary', actions: [{ type: 'validate' }, { type: 'submit' }] }, invalid)).toEqual({ ran: ['validate'], stopped: 'invalid' })
    expect(invalid.log).toEqual(['validate:form'])
    const stuck = fakeHost({ step_ok: false })
    expect((await runFieldButton({ style: 'primary', actions: [{ type: 'next_page' }, { type: 'message', text: 'x' }] }, stuck)).stopped).toBe('step_invalid')
    const external = fakeHost()
    expect((await runFieldButton({ style: 'primary', actions: [{ type: 'open_link', url: 'https://evil.example' }] }, external)).stopped).toBe('link_not_allowed')
  })

  it('submit presses the chosen bar button and ends the click; unavailable without a bar', async () => {
    const host = fakeHost()
    expect(await runFieldButton({ style: 'primary', actions: [{ type: 'submit', button: 'approve' }, { type: 'message', text: 'never' }] }, host)).toEqual({ ran: ['submit'] })
    expect(host.log).toEqual(['submit:approve'])
    const none = fakeHost({ no_bar: true })
    expect((await runFieldButton({ style: 'primary', actions: [{ type: 'submit' }] }, none)).stopped).toBe('submit_unavailable')
  })
})

/* ── Visibility and precedence ─────────────────────────────────────── */

describe('form state in rules and precedence', () => {
  it('targets resolve to fields: a section runs to the next heading, a row, a page', () => {
    const headings = new Set(['details_heading', 'other_heading'])
    expect(targetFieldKeys(SINGLE, 'section:details_heading', headings)).toEqual(['details_heading', 'employer', 'salary'])
    expect(targetFieldKeys(SINGLE, 'row:salary')).toEqual(['employer', 'salary'])
    expect(targetFieldKeys(TABS, 'page:extra')).toEqual(['extra_q'])
    expect(targetFieldKeys(SINGLE, 'page:extra')).toEqual([])
  })

  it('start-hidden targets hide; a state flag rule shows when the flag is on; a button hide wins over a rule', () => {
    const scope = { [FORM_STATE_KEY]: initialFormState(SINGLE) }
    expect([...stateHiddenFieldKeys(SINGLE, FIELDS, scope)]).toEqual(['details_heading', 'employer', 'salary'])
    // notes: required but its rule (state.show_notes) is off → not required; employer: start hidden → not required.
    expect(validateTaskFieldValues(FIELDS, { name: 'Ada', extra_q: 'x' }, { layout: SINGLE })).toEqual({})
    // The notes flag on (a button can set it) → notes required.
    expect(validateTaskFieldValues(FIELDS, { name: 'Ada', extra_q: 'x', [FORM_STATE_KEY]: { flags: { show_notes: true }, hidden: ['section:details_heading'] } }, { layout: SINGLE })).toEqual({ notes: 'Notes is required' })
    // Section shown (the toggle can show it) → employer required.
    expect(Object.keys(validateTaskFieldValues(FIELDS, { name: 'Ada', extra_q: 'x', [FORM_STATE_KEY]: { flags: {}, hidden: [] } }, { layout: SINGLE }))).toEqual(['employer'])
    // A field hidden by a button stays hidden even when its own rule says show.
    const layout = { ...SINGLE, state: { ...SINGLE.state, hidden: ['field:notes'] } }
    const fields = FIELDS.map((f) => (f.key === 'more' ? { ...f, button: { ...f.button!, actions: [{ type: 'show_hide' as const, mode: 'toggle' as const, targets: ['field:notes', 'section:details_heading'] }] } } : f))
    expect(validateTaskFieldValues(fields, { name: 'Ada', extra_q: 'x', [FORM_STATE_KEY]: { flags: { show_notes: true }, hidden: ['field:notes', 'section:details_heading'] } }, { layout })).toEqual({})
  })

  it('hidden tabs / steps leave the tab bar and the progress', () => {
    expect(visiblePages(TABS, {}).map((p) => p.id)).toEqual(['main'])
    expect(visiblePages(TABS, { [FORM_STATE_KEY]: { flags: {}, hidden: [] } }).map((p) => p.id)).toEqual(['main', 'extra'])
  })

  it('renders a real button with aria-expanded / aria-controls; hidden sections are not drawn; read-only views show answers', () => {
    const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
    const html = wrap(createElement(FormRenderer, { fields: FIELDS, layout: SINGLE, values: {}, onChange: () => {}, idPrefix: 'f-' }))
    expect(html).toMatch(/<button[^>]*id="f-more"[^>]*aria-expanded="false"[^>]*aria-controls="f-cell-details_heading f-cell-employer f-cell-salary"/)
    // Steps / tabs: a hidden page is controlled through its stepper item / tab.
    expect(wrap(createElement(FormRenderer, { fields: FIELDS, layout: TABS, values: {}, onChange: () => {}, idPrefix: 'f-' }))).toMatch(/aria-controls="[^"]*f-tab-extra"/)
    expect(html).toContain('Show more details')
    expect(html).not.toContain('>Employer<')
    expect(html).not.toContain('>Notes<')
    const open = wrap(createElement(FormRenderer, { fields: FIELDS, layout: SINGLE, values: { [FORM_STATE_KEY]: { flags: { show_notes: true }, hidden: [] } }, onChange: () => {}, idPrefix: 'f-' }))
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('>Employer<')
    expect(open).toContain('>Notes<')
    const readOnly = wrap(createElement(FormRenderer, { fields: FIELDS, layout: SINGLE, values: { employer: 'ACME', notes: 'Hi' }, readOnly: true }))
    expect(readOnly).toContain('ACME')
    expect(readOnly).toContain('Hi')
    expect(readOnly).not.toContain('Show more details')
  })
})

/* ── Server bound on the submitted state ───────────────────────────── */

describe('the server judges the state against the form’s own buttons', () => {
  const meta = (layout: unknown) => ({ fields: FIELDS, template_values: {}, form_layout: layout })

  it('cannot hide a required field no button hides, nor set a flag value no button sets', () => {
    // `name` is required and no button hides it: a forged hide is ignored.
    const forged = mergeTaskFieldValues(meta(SINGLE), { extra_q: 'x', [FORM_STATE_KEY]: { flags: {}, hidden: ['field:name', 'row:name', 'section:details_heading'] } })
    expect(forged.errors).toEqual({ name: 'Full name is required' })
    // show_notes can only be set to true; false is its default → fine. An undeclared flag is dropped.
    expect(sanitizeFormState(FIELDS, SINGLE, { [FORM_STATE_KEY]: { flags: { show_notes: 'yes', other: true }, hidden: [] } })).toEqual({ flags: { show_notes: false }, hidden: [] })
    // A start-hidden target no button can show stays hidden even if the client says shown.
    const fields = FIELDS.filter((f) => f.key !== 'more')
    expect(sanitizeFormState(fields, SINGLE, { [FORM_STATE_KEY]: { flags: {}, hidden: [] } }).hidden).toEqual(['section:details_heading'])
    // Nothing sent (API clients) → the declared defaults.
    expect(sanitizeFormState(FIELDS, SINGLE, {})).toEqual({ flags: { show_notes: false }, hidden: ['section:details_heading'] })
  })

  it('a legitimate hide (reachable by a button) skips validation; the state is never stored', () => {
    const ok = mergeTaskFieldValues(meta(SINGLE), { name: 'Ada', extra_q: 'x', [FORM_STATE_KEY]: { flags: {}, hidden: ['section:details_heading'] } })
    expect(ok.errors).toEqual({})
    expect(ok.templateValues).not.toHaveProperty(FORM_STATE_KEY)
    const shown = mergeTaskFieldValues(meta(SINGLE), { name: 'Ada', extra_q: 'x', [FORM_STATE_KEY]: { flags: {}, hidden: [] } })
    expect(shown.errors).toEqual({ employer: 'Employer is required' })
    // A hidden tab (page target) on a tabs form: its required question is skipped only while hidden.
    expect(mergeTaskFieldValues(meta(TABS), { name: 'Ada' }).errors).toEqual({})
    expect(mergeTaskFieldValues(meta(TABS), { name: 'Ada', employer: 'A', [FORM_STATE_KEY]: { flags: {}, hidden: [] } }).errors).toEqual({ extra_q: 'Extra question is required' })
  })
})

/* ── Application mode ───────────────────────────────────────────────── */

describe('Application mode', () => {
  const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
  const bar = (layout: any) => wrap(createElement(FormPagesProvider, { fields: FIELDS, layout, values: {}, children: createElement(FormButtonBar, { buttons: normalizeFormButtons(null), onClick: () => {} }) } as any))

  it('hides Submit and Cancel on every surface (the bar draws nothing); off by default', () => {
    expect(bar({ ...SINGLE, application_mode: undefined })).toContain('data-form-button="submit"')
    expect(bar({ ...SINGLE, application_mode: undefined })).toContain('data-form-button="cancel"')
    expect(bar(SINGLE)).toBe('')
    expect(isApplicationMode(SINGLE)).toBe(true)
    expect(isApplicationMode(TABS)).toBe(false)
  })

  it('no in-form Submit: a form page is an information page; a task form gets a warning (designer + a11y)', () => {
    const noSubmit = FIELDS.filter((f) => f.key !== 'send')
    expect(isInformationPage(noSubmit, SINGLE)).toBe(true)
    expect(isInformationPage(FIELDS, SINGLE)).toBe(false)
    expect(submitPathProblem(noSubmit, SINGLE, 'any')).toBeNull()
    expect(submitPathProblem(noSubmit, SINGLE, 'task')).toMatch(/outcome buttons/)
    expect(submitPathProblem(FIELDS, SINGLE, 'task')).toBeNull()
    // An information page validates nothing it would not submit anyway — and nothing is required to view it.
    const def = normalizeFormDefinition({ fields: noSubmit, layout: SINGLE })
    expect(checkFormAccessibility(def, { surface: 'task', structuralOnly: true }).findings.map((f) => f.rule)).toContain('submit-path')
    expect(checkFormAccessibility(def, { structuralOnly: true }).findings.map((f) => f.rule)).not.toContain('submit-path')
  })
})
