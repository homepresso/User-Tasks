import { describe, expect, it } from 'vitest'
import {
  FORM_CLOSE_TARGET, SUBMITTED_PAGE_DEFAULTS, applySubmittedPage, defaultSubmittedPage, freshSubmissionValues, layoutSubmittedPage,
  normalizeSubmittedPage, planSubmittedPage, screenButtonOutcome, screenButtons, submittedPageProblem,
} from '@/lib/forms/submitted-page'
import { normalizeFormButtons, planButtonEffects, type ButtonEffects } from '@/lib/forms/buttons'
import { compactLayoutForSave, normalizeFormLayout, renameLayoutKey } from '@/lib/forms/layout'
import { setPageMode } from '@/lib/forms/pages'
import { normalizeFormDefinition } from '@/lib/forms/definition'
import { designerStateFrom, definitionFrom } from '@/lib/forms/designer-state'
import { checkFormAccessibility } from '@/lib/forms/accessibility'
import { normalizeFormAssetLikeImport } from '@/lib/portability/forms'
import { formPageKey, syncFormPageUpdate } from '@/lib/forms/form-page'
import { FORM_PARAMS_KEY, FORM_VARS_KEY } from '@/lib/forms/form-params'
import { NAV_ITEMS } from '@/lib/constants'

/* eslint-disable @typescript-eslint/no-explicit-any -- loose fixtures */

const TENANT = '11111111-2222-3333-4444-555555555555'
const IMAGE = `storage://task-files/form-headers/${TENANT}/party.png`
const fields = [
  { key: 'name', label: 'Your name', type: 'text' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'dietary', label: 'Dietary needs', type: 'text' },
  { key: 'newsletter', label: 'Newsletter', type: 'boolean' },
]
const keys = fields.map((f) => f.key)
const rows = keys.map((k) => ({ columns: 1, cells: [{ field_key: k, span: 1 }] }))
const PAGE = {
  enabled: true, icon: 'party', icon_color: 'primary',
  heading: 'You are registered, {{form.name}}',
  subheading: 'Ref REG-{{submission_id}} · run {{run_reference}} · {{param.region}} · seat {{var.seat}}',
  summary_fields: ['email', 'dietary', 'newsletter', 'ghost'],
  note: 'We emailed {{email}}.',
  submit_another: { enabled: true, label: 'Register someone else' },
  close: { enabled: true },
}
const submit = normalizeFormButtons(null)[0]
const scope = {
  values: { name: 'Nancy', email: 'nancy@example.com', dietary: '', newsletter: true, [FORM_PARAMS_KEY]: { region: 'Summit' }, [FORM_VARS_KEY]: { seat: 'B4' } },
  extras: { submission_id: 'ab12cd34', run_reference: 'ef56' },
}

describe('config model', () => {
  it('old forms have none: null layout key → no page, effects unchanged', () => {
    expect(normalizeSubmittedPage(undefined)).toBeNull()
    expect(layoutSubmittedPage({ rows })).toBeNull()
    const effects = planButtonEffects(submit, scope)
    expect(applySubmittedPage(effects, { layout: { rows }, scope })).toBe(effects)
    // A stored-but-off page changes nothing either.
    expect(applySubmittedPage(effects, { layout: { rows, submitted_page: { ...PAGE, enabled: false } }, scope })).toBe(effects)
  })

  it('normalises: icons, colours, the upload address, buttons, summary keys, limits', () => {
    expect(normalizeSubmittedPage({ enabled: true, icon: 'skull', icon_color: 'red' })).toMatchObject({ icon: 'check_circle', icon_color: 'success', submit_another: { enabled: true }, close: { enabled: true } })
    expect(normalizeSubmittedPage({ enabled: true, icon: 'star', icon_color: '#ab12cd' })!.icon_color).toBe('#AB12CD')
    // An upload needs one of our own image addresses; otherwise the check icon.
    expect(normalizeSubmittedPage({ enabled: true, icon: 'upload', icon_url: 'https://evil.example/x.png', icon_alt: 'x' })).toMatchObject({ icon: 'check_circle' })
    expect(normalizeSubmittedPage({ enabled: true, icon: 'upload', icon_url: IMAGE, icon_alt: 'Confetti' })).toMatchObject({ icon: 'upload', icon_url: IMAGE, icon_alt: 'Confetti' })
    expect(normalizeSubmittedPage({ enabled: true, submit_another: false, close: { enabled: true, label: 'Done' } })).toMatchObject({ submit_another: { enabled: false }, close: { enabled: true, label: 'Done' } })
    expect(normalizeSubmittedPage(PAGE, keys)!.summary_fields).toEqual(['email', 'dietary', 'newsletter'])
    expect(normalizeSubmittedPage({ enabled: true, heading: '<b>Hi</b>' + 'x'.repeat(400) })!.heading!.length).toBe(160)
    expect(defaultSubmittedPage()).toMatchObject({ enabled: true, icon: 'check_circle', heading: SUBMITTED_PAGE_DEFAULTS.heading })
  })

  it('the layout keeps it: normalise, compact for save (a trivial grid is kept for it), page mode switch, designer round trip', () => {
    const layout = normalizeFormLayout({ rows, submitted_page: PAGE }, keys)!
    expect(layout.submitted_page).toMatchObject({ enabled: true, icon: 'party', summary_fields: ['email', 'dietary', 'newsletter'] })
    // Without the page this grid compacts to null; with it, the layout is stored.
    expect(compactLayoutForSave(normalizeFormLayout({ rows }, keys)!, keys)).toBeNull()
    expect(compactLayoutForSave(layout, keys)!.submitted_page).toEqual(layout.submitted_page)
    expect(setPageMode(layout, 'steps').submitted_page).toEqual(layout.submitted_page)
    // Renaming a field keeps it in the summary.
    expect(renameLayoutKey(layout, 'dietary', 'diet').submitted_page!.summary_fields).toEqual(['email', 'diet', 'newsletter'])
    expect(layout.submitted_page!.summary_fields).toEqual(['email', 'dietary', 'newsletter'])
    const def = normalizeFormDefinition({ fields, layout: { rows, submitted_page: PAGE } })
    expect(definitionFrom(designerStateFrom(def)).layout?.submitted_page).toEqual(def.layout!.submitted_page)
  })

  it('designer problems: a heading is needed; an upload needs its image', () => {
    expect(submittedPageProblem(normalizeSubmittedPage({ enabled: true }))).toMatch(/heading/)
    expect(submittedPageProblem(normalizeSubmittedPage(PAGE))).toBeNull()
    expect(submittedPageProblem({ ...defaultSubmittedPage(), icon: 'upload' })).toMatch(/Upload/)
    expect(submittedPageProblem(null)).toBeNull()
  })
})

describe('placeholders in the heading, subheading, summary and note', () => {
  it('fills {{form.x}}, {{param.x}}, {{var.x}}, the submission and run references', () => {
    const screen = planSubmittedPage(normalizeSubmittedPage(PAGE, keys)!, scope, fields)
    expect(screen.title).toBe('You are registered, Nancy')
    expect(screen.text).toBe('Ref REG-ab12cd34 · run ef56 · Summit · seat B4')
    expect(screen.note).toBe('We emailed nancy@example.com.')
    // Empty answers are left out; booleans read Yes / No; labels come from the fields.
    expect(screen.summary).toEqual([{ label: 'Email', value: 'nancy@example.com' }, { label: 'Newsletter', value: 'Yes' }])
    expect(screen.icon).toEqual({ kind: 'icon', name: 'party', color: 'primary' })
    expect(screen.source).toBe('form')
  })

  it('an empty heading after filling falls back; an uploaded image carries its alt text', () => {
    const screen = planSubmittedPage(normalizeSubmittedPage({ enabled: true, heading: '{{missing}}', icon: 'upload', icon_url: IMAGE, icon_alt: 'Confetti' })!, { values: {} })
    expect(screen.title).toBe('Submitted')
    expect(screen.icon).toEqual({ kind: 'image', url: IMAGE, alt: 'Confetti' })
    expect(planSubmittedPage(normalizeSubmittedPage({ enabled: true, icon: 'none' })!, { values: {} }).icon).toBeUndefined()
  })
})

describe('precedence', () => {
  const layout = { rows, submitted_page: PAGE }
  const withActions = (actions: any[]) => normalizeFormButtons([{ id: 'submit', kind: 'submit', label: 'Go', actions }])[0]
  const apply = (effects: ButtonEffects, surface?: 'page' | 'task' | 'dialog') => applySubmittedPage(effects, { layout, fields, scope, surface })

  it('a plain Submit shows the page, messages kept', () => {
    const out = apply(planButtonEffects(withActions([{ type: 'message', text: 'Saved {{name}}' }]), scope))
    expect(out.messages).toEqual([{ text: 'Saved Nancy', tone: 'success' }])
    expect(out.success_screen).toMatchObject({ source: 'form', title: 'You are registered, Nancy', button: 'submit_another', button_label: 'Register someone else' })
    expect(out.success_screen!.buttons).toEqual([{ kind: 'submit_another', label: 'Register someone else' }, { kind: 'close', label: 'Close form' }])
  })

  it('a redirect wins; so does an explicit Close form and a button\'s own success screen', () => {
    const redirect = apply(planButtonEffects(withActions([{ type: 'redirect', url: '/tasks' }]), scope))
    expect(redirect.redirect).toBe('/tasks')
    expect(redirect.success_screen).toBeUndefined()
    const close = apply(planButtonEffects(withActions([{ type: 'close' }]), scope))
    expect(close).toMatchObject({ close: true })
    expect(close.success_screen).toBeUndefined()
    const own = apply(planButtonEffects(withActions([{ type: 'success_screen', title: 'Button screen' }]), scope))
    expect(own.success_screen).toMatchObject({ title: 'Button screen' })
    expect(own.success_screen!.source).toBeUndefined()
  })

  it('task forms never get the page (completing the task moves on); the Run dialog does', () => {
    const effects = planButtonEffects(submit, scope)
    expect(apply(effects, 'task')).toBe(effects)
    expect(apply(effects, 'dialog').success_screen?.source).toBe('form')
  })
})

describe('the buttons: Submit another and Close', () => {
  const screen = planSubmittedPage(normalizeSubmittedPage(PAGE)!, scope)

  it('Submit another resets to a fresh form and keeps the URL / embedding parameters', () => {
    expect(screenButtonOutcome(screenButtons(screen)[0], 'page')).toEqual({ kind: 'reset', keepParams: true })
    const before = { name: 'Nancy', email: 'n@x.io', [FORM_PARAMS_KEY]: { region: 'Summit' }, [FORM_VARS_KEY]: { seat: 'B4' }, __form_controls: { x: 1 } }
    expect(freshSubmissionValues(before)).toEqual({ [FORM_PARAMS_KEY]: { region: 'Summit' } })
    expect(freshSubmissionValues({ name: 'x' })).toEqual({})
  })

  it('Close goes to the dashboard on a form page (one constant); a dialog, pane or task closes itself', () => {
    const close = screenButtons(screen)[1]
    expect(close.kind).toBe('close')
    expect(screenButtonOutcome(close, 'page')).toEqual({ kind: 'navigate', href: FORM_CLOSE_TARGET })
    expect(screenButtonOutcome(close, 'dialog')).toEqual({ kind: 'close_surface' })
    expect(screenButtonOutcome(close, 'embedded')).toEqual({ kind: 'close_surface' })
    expect(screenButtonOutcome(close, 'task')).toEqual({ kind: 'close_surface' })
    // Home when the app has it, otherwise My Tasks.
    const hasHome = (NAV_ITEMS as ReadonlyArray<{ href: string }>).some((i) => i.href === '/home')
    expect(FORM_CLOSE_TARGET).toBe(hasHome ? '/home' : '/tasks')
  })

  it('buttons can be switched off or relabelled; older single-button screens still read', () => {
    const only = planSubmittedPage(normalizeSubmittedPage({ ...PAGE, submit_another: { enabled: false }, close: { enabled: true, label: 'Back to my dashboard' } })!, scope)
    expect(screenButtons(only)).toEqual([{ kind: 'close', label: 'Back to my dashboard' }])
    expect(planSubmittedPage(normalizeSubmittedPage({ ...PAGE, submit_another: false, close: false })!, scope).button).toBe('none')
    expect(screenButtons({ title: 'Old', button: 'submit_another' })).toEqual([{ kind: 'submit_another', label: 'Submit another' }])
    expect(screenButtons({ title: 'Old', button: 'link', url: '/tasks', button_label: 'Go' })).toEqual([{ kind: 'link', label: 'Go', url: '/tasks' }])
    expect(screenButtons({ title: 'Old', button: 'none' })).toEqual([])
  })
})

describe('WCAG checker', () => {
  const def = (page: Record<string, unknown>) => normalizeFormDefinition({ fields: [{ key: 'reason', label: 'Reason', type: 'textarea' }], header: { enabled: true, image: 'none', title: 'Leave' }, layout: { rows: [{ columns: 1, cells: [{ field_key: 'reason', span: 1 }] }], submitted_page: page } } as any)
  const found = (page: Record<string, unknown>, surface?: 'task' | 'page') => checkFormAccessibility(def(page), { surface }).findings.filter((f) => f.rule === 'submitted-page').map((f) => f.id)

  it('flags a missing heading and an uploaded image without alt text', () => {
    expect(found({ enabled: true, icon: 'check_circle' })).toEqual(['submitted-page:heading'])
    expect(found({ enabled: true, heading: 'Thanks', icon: 'upload', icon_url: IMAGE })).toEqual(['submitted-page:image-alt'])
    expect(found({ enabled: true, heading: 'Thanks', icon: 'upload', icon_url: IMAGE, icon_alt: 'Confetti' })).toEqual([])
  })

  it('passes when off, and for task forms (not shown there)', () => {
    expect(found({ enabled: false })).toEqual([])
    expect(found({ enabled: true }, 'task')).toEqual([])
  })
})

describe('portability', () => {
  it('export / import (config as code, packages) carries the page; an uploaded image compares equal as bytes', () => {
    const local = { id: 'f1', name: 'Register', fields, layout: { rows, submitted_page: { ...PAGE, icon: 'upload', icon_url: IMAGE, icon_alt: 'Confetti' } } }
    const exported = { ...local, layout: { rows, submitted_page: { ...PAGE, icon: 'upload', icon_alt: 'Confetti', icon_data: { content_type: 'image/png', data_base64: 'AA==' } } } }
    const a = normalizeFormAssetLikeImport(local)
    const b = normalizeFormAssetLikeImport(exported)
    expect(a.layout.submitted_page).toMatchObject({ enabled: true, icon: 'upload', icon_alt: 'Confetti', heading: PAGE.heading })
    expect(a.layout).toEqual(b.layout)
    // Plain icons round-trip untouched.
    const plain = normalizeFormAssetLikeImport({ id: 'f2', name: 'x', fields, layout: { rows, submitted_page: PAGE } })
    expect(normalizeFormAssetLikeImport(JSON.parse(JSON.stringify(plain))).layout).toEqual(plain.layout)
    expect(plain.layout.submitted_page.summary_fields).toEqual(['email', 'dietary', 'newsletter'])
  })

  it('a published form page keeps its own Submitted page through a start-form sync, and the page is not "an edit of the copied parts"', () => {
    const content = { fields: fields as any, layout: { rows } as any, theme: { source: 'workspace' } as any, inputs: {} }
    expect(formPageKey({ ...content, layout: { rows, submitted_page: PAGE } as any })).toBe(formPageKey(content))
    const wf = '9b2f3c4d-0000-4000-8000-000000000001'
    const buttons = [{ id: 'submit', kind: 'submit', label: 'Submit', actions: [{ type: 'start_workflow', workflow_id: wf, start_form_page: { key: '0123456789abcdef' } }] }]
    const update = syncFormPageUpdate({ buttons, layout: { rows, submitted_page: PAGE } }, { id: wf, name: 'Wf' }, content)
    expect(update!.layout?.submitted_page).toEqual(PAGE)
  })
})
