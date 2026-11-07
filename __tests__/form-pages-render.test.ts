/**
 * Steps & tabs in every surface's renderer: the stepper (numbered,
 * progress bar, dots) with Next and no final buttons on the first step,
 * the tab bar (ARIA tablist) with error badges and the buttons under every
 * tab, read-only views stacking every shown page under its title, and
 * forms without pages unchanged.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FormRenderer } from '@/components/forms/form-renderer'
import { WorkflowStartFormView } from '@/components/forms/workflow-start-form-view'
import { TaskFields } from '@/components/tasks/task-fields'
import { FormButtonBar } from '@/components/forms/form-shell'
import { normalizeFormLayout } from '@/lib/forms/layout'
import { setPageMode, updatePageSettings } from '@/lib/forms/pages'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeTaskFields } from '@/lib/task-field-schema'

const FIELDS = normalizeTaskFields([
  { key: 'name', label: 'Full name', type: 'text', required: true },
  { key: 'kind', label: 'Kind', type: 'choice', options: ['Personal', 'Business'] },
  { key: 'company', label: 'Company', type: 'text', required: true },
  { key: 'notes', label: 'Notes', type: 'textarea' },
])
const KEYS = FIELDS.map((f) => f.key)
const STEPS = normalizeFormLayout({
  mode: 'steps',
  pages: [
    { id: 'you', title: 'About you', rows: [{ columns: 2, cells: [{ field_key: 'name', span: 1 }, { field_key: 'kind', span: 1 }] }] },
    { id: 'biz', title: 'Business', icon: 'briefcase', visible_when: { field: 'kind', operator: 'equals', value: 'Business' }, rows: [{ columns: 1, cells: [{ field_key: 'company', span: 1 }] }] },
    { id: 'more', title: 'Anything else', description: 'Tell us more', rows: [{ columns: 1, cells: [{ field_key: 'notes', span: 1 }] }] },
  ],
}, KEYS)!
const TABS = setPageMode(STEPS, 'tabs')

const wrap = (el: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, el))
const renderer = (props: any) => wrap(createElement(FormRenderer, { fields: FIELDS, values: {}, onChange: () => {}, ...props }))

describe('steps', () => {
  it('numbered stepper, the first step only, Next (no Back)', () => {
    const html = renderer({ layout: STEPS, values: { kind: 'Business' } })
    expect(html).toContain('data-form-pages="steps"')
    expect(html).toContain('data-form-stepper="numbered"')
    expect(html).toContain('data-current-page="you"')
    expect(html).toContain('aria-current="step"')
    expect(html).toContain('About you')
    expect(html).toContain('Full name')
    expect(html).not.toContain('>Company<')
    expect(html).toContain('data-step-next')
    expect(html).not.toContain('data-step-back')
    // The conditional step is listed when it applies…
    expect(html).toContain('data-step="biz"')
    // …and left out (not counted) when it doesn't.
    expect(renderer({ layout: STEPS, values: { kind: 'Personal' } })).not.toContain('data-step="biz"')
  })

  it('progress bar ("Step 1 of 4", %) with a review step; dots; custom Next label; phone layout stacks', () => {
    const progress = updatePageSettings(STEPS, { indicator: 'progress', review: true, next_label: 'Continue' })
    const html = renderer({ layout: progress, values: { kind: 'Business' } })
    expect(html).toContain('data-form-stepper="progress"')
    expect(html).toContain('Step 1 of 4')
    expect(html).toContain('aria-valuenow="25"')
    expect(html).toContain('Continue')
    expect(renderer({ layout: updatePageSettings(STEPS, { indicator: 'dots' }) })).toContain('data-form-stepper="dots"')
    expect(renderer({ layout: STEPS, singleColumn: true })).toContain('data-vertical="true"')
  })

  it('a surface’s buttons wait for the final step (a start form / form page)', () => {
    const spec = {
      kind: 'form', button_ids: [],
      form: { id: 'f1', name: 'Signup', description: null, version: 1, layout: STEPS, theme_overrides: null, header: null, fields: FIELDS, buttons: normalizeFormButtons([{ id: 'submit', label: 'Send it', kind: 'submit' }]) },
    }
    const html = wrap(createElement(WorkflowStartFormView, { spec, values: {}, errors: {}, onChange: () => {}, onPress: () => {} } as any))
    expect(html).toContain('data-step-nav')
    expect(html).toContain('data-step-next')
    expect(html).not.toContain('data-form-button="submit"')
    // A single-step form shows its buttons straight away.
    const one = normalizeFormLayout({ mode: 'steps', pages: [{ id: 'only', title: 'Only', rows: [] }] }, KEYS)!
    const single = wrap(createElement(WorkflowStartFormView, { spec: { ...spec, form: { ...spec.form, layout: one } }, values: {}, errors: {}, onChange: () => {}, onPress: () => {} } as any))
    expect(single).toContain('data-form-button="submit"')
    expect(single).not.toContain('data-step-next')
  })

  it('Save draft stays available on every step of a task form (a draft keeps the step)', () => {
    const buttons = [{ id: 'approve', label: 'Approve', kind: 'submit' }, { id: 'draft', label: 'Save draft', kind: 'draft' }]
    const html = wrap(createElement(TaskFields, {
      fields: FIELDS, values: {}, layout: STEPS, onChange: () => {},
      footer: createElement(FormButtonBar, { buttons: normalizeFormButtons(buttons), onClick: () => {} }),
    } as any))
    expect(html).toContain('data-form-button="draft"')
    expect(html).not.toContain('data-form-button="approve"')
    expect(html).toContain('data-step-next')
  })
})

describe('tabs', () => {
  it('ARIA tablist, icons, the first tab panel, error badges, buttons under every tab', () => {
    const html = renderer({ layout: TABS, values: { kind: 'Business' }, errors: { company: 'Company is required', name: 'Full name is required' } })
    expect(html).toContain('role="tablist"')
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"/)
    expect(html).toContain('role="tabpanel"')
    expect(html).toContain('data-tab="biz"')
    expect(html).toContain('data-tab-errors="1"')
    expect(html.match(/data-tab-errors/g)).toHaveLength(2)
    expect(html).toContain('lucide-briefcase')
    expect(html).not.toContain('data-step-next')
    // Conditional tabs.
    expect(renderer({ layout: TABS, values: { kind: 'Personal' } })).not.toContain('data-tab="biz"')
    const spec = { kind: 'form', button_ids: [], form: { id: 'f1', name: 'Signup', description: null, version: 1, layout: TABS, theme_overrides: null, header: null, fields: FIELDS, buttons: normalizeFormButtons([{ id: 'submit', label: 'Send it', kind: 'submit' }]) } }
    expect(wrap(createElement(WorkflowStartFormView, { spec, values: {}, errors: {}, onChange: () => {}, onPress: () => {} } as any))).toContain('data-form-button="submit"')
  })
})

describe('read-only and classic', () => {
  it('read-only stacks every shown page under its title (completed tasks, phones)', () => {
    const html = renderer({ layout: STEPS, readOnly: true, values: { name: 'Ann', kind: 'Personal', notes: 'Hello' } })
    expect(html).toContain('data-form-pages="stacked"')
    expect(html).toContain('About you')
    expect(html).toContain('Anything else')
    expect(html).toContain('Hello')
    expect(html).not.toContain('Business</h3>')
    expect(html).not.toContain('data-step-next')
    const task = wrap(createElement(TaskFields, { fields: FIELDS, values: { name: 'Ann', kind: 'Business', company: 'Acme' }, layout: TABS, readOnly: true } as any))
    expect(task).toContain('data-form-pages="stacked"')
    expect(task).toContain('Acme')
    expect(task).not.toContain('role="tablist"')
  })

  it('a form without pages renders as before', () => {
    const html = renderer({ layout: normalizeFormLayout({ rows: [{ columns: 2, cells: [{ field_key: 'name', span: 1 }, { field_key: 'kind', span: 1 }] }] }, KEYS) })
    expect(html).toContain('data-form-layout="grid"')
    expect(html).not.toContain('data-form-pages')
  })
})
