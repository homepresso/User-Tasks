/**
 * The start-form panel (Test runner / Run dialog): a linked form draws as
 * its page does (header, fields, its buttons, the test note), a start form
 * with its one start button (or none: the Run dialog's footer); test cases
 * store the form's values, prefill the form and duplicate independently.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WorkflowStartFormView } from '@/components/forms/workflow-start-form-view'
import { caseFormValues, copyCaseInputs, withCaseFormValue, type WorkflowStartForm } from '@/lib/forms/workflow-start-form'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeTaskFields } from '@/lib/task-field-schema'

const FORM: WorkflowStartForm = {
  kind: 'form',
  button_ids: [],
  form: {
    id: 'f1', name: 'Equipment request', description: null, version: 2, layout: null, theme_overrides: null,
    header: { enabled: true, image: 'none', title: 'Equipment request', align: 'left' } as any,
    fields: normalizeTaskFields([{ key: 'item', label: 'Item', type: 'text', required: true, default: 'Laptop' }, { key: 'qty', label: 'Quantity', type: 'number' }]),
    buttons: normalizeFormButtons([{ id: 'submit', label: 'Request it', kind: 'submit' }, { id: 'save', label: 'Save draft', kind: 'draft' }, { id: 'cancel', label: 'Cancel', kind: 'cancel' }]),
  },
}
const START: WorkflowStartForm = {
  kind: 'start_form', layout: null, theme_overrides: null, name_by_key: { customer: 'customerName', rush: 'rush' },
  fields: normalizeTaskFields([{ key: 'customer', label: 'Customer', type: 'text' }, { key: 'rush', label: 'Rush', type: 'boolean' }]),
}

const render = (props: any) => renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(WorkflowStartFormView, { values: {}, errors: {}, onChange: () => {}, onPress: () => {}, ...props })))

describe('WorkflowStartFormView', () => {
  it('a linked form: header, fields, its buttons (no draft), the note', () => {
    const html = render({ spec: FORM, values: { item: 'Monitor' }, note: createElement('p', null, 'Test submission note') })
    expect(html).toContain('data-start-form="form"')
    expect(html).toContain('data-form-header')
    expect(html).toContain('Equipment request')
    expect(html).toContain('Quantity')
    expect(html).toContain('value="Monitor"')
    expect(html).toContain('data-form-button="submit"')
    expect(html).toContain('Request it')
    expect(html).toContain('data-form-button="cancel"')
    expect(html).not.toContain('Save draft')
    expect(html).toContain('Test submission note')
    expect(html).toContain('data-form-page')
  })

  it('field errors and the success screen', () => {
    expect(render({ spec: FORM, errors: { item: 'Item is required' } })).toContain('Item is required')
    const done = render({ spec: FORM, successScreen: { title: 'Request sent', button: 'none' } })
    expect(done).toContain('Request sent')
    expect(done).not.toContain('data-form-button')
  })

  it('a start form: its fields and the start button (hidden in the Run dialog)', () => {
    const html = render({ spec: START, startLabel: 'Start test run' })
    expect(html).toContain('data-start-form="start_form"')
    expect(html).toContain('Customer')
    expect(html).toContain('Start test run')
    expect(render({ spec: START, hideButtons: true })).not.toContain('data-form-button')
  })
})

describe('test cases over the form', () => {
  it('a case stores the form values and prefills the form (defaults under them)', () => {
    let tc: any = { values: {} }
    expect(caseFormValues(FORM, tc)).toEqual({ item: 'Laptop', qty: null })
    tc = withCaseFormValue(FORM, tc, 'qty', 3)
    tc = withCaseFormValue(FORM, tc, 'item', 'Dock')
    expect(tc.formValues).toEqual({ qty: 3, item: 'Dock' })
    expect(caseFormValues(FORM, tc)).toEqual({ item: 'Dock', qty: 3 })
  })

  it('a start form stores variable strings (the plain fields view shares them)', () => {
    let tc: any = { values: { customerName: '', rush: 'false' } }
    tc = withCaseFormValue(START, tc, 'customer', 'Alfreds')
    tc = withCaseFormValue(START, tc, 'rush', true)
    expect(tc.values).toEqual({ customerName: 'Alfreds', rush: 'true' })
    expect(caseFormValues(START, tc)).toEqual({ customer: 'Alfreds', rush: true })
    expect(caseFormValues(null, tc)).toEqual({})
  })

  it('Duplicate copies the values and the button; editing the copy leaves the original', () => {
    const original: any = { values: { a: '1' }, formValues: { item: 'Dock', tags: ['x'] }, buttonId: 'submit' }
    const copy: any = copyCaseInputs(original)
    expect(copy).toEqual(original)
    copy.formValues.tags.push('y')
    copy.values.a = '2'
    expect(original.formValues.tags).toEqual(['x'])
    expect(original.values.a).toBe('1')
  })
})
