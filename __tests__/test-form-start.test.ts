/**
 * The designer's Test runner with a workflow that starts from a form
 * ("Form submitted" trigger or a designed start form): nothing runs until
 * the form's own button is pressed and its values pass the checks.
 *
 *  - the gate: loading (the form is still being read) blocks every run
 *    button; a form start makes "Run Selected" show / focus the form (no
 *    request) instead of running with whatever the case holds;
 *  - "Show as fields" (the explicit power-user view) still runs, checked;
 *  - Run All uses each case's SAVED submission (what the tester submitted
 *    last time) and skips cases that never had one ("Needs form input");
 *  - Enter in a start-form input never submits the Run dialog.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- fixtures */
import { describe, expect, it } from 'vitest'
import {
  formStartGate, isImplicitSubmitKey, rememberSubmission, runAllCaseDecision, runSelectedDecision,
} from '@/lib/automations/test-form-start'
import { normalizeFormButtons } from '@/lib/forms/buttons'
import { normalizeTaskFields } from '@/lib/task-field-schema'
import type { WorkflowStartForm } from '@/lib/forms/workflow-start-form'

const FORM: WorkflowStartForm = {
  kind: 'form', button_ids: [],
  form: {
    id: 'f1', name: 'Expense claim', description: null, version: 1, layout: null, theme_overrides: null, header: null,
    fields: normalizeTaskFields([{ key: 'name', label: 'Name', type: 'text', required: true }]),
    buttons: normalizeFormButtons([{ id: 'send', label: 'Send claim', kind: 'submit' }]),
  },
}
const START: WorkflowStartForm = {
  kind: 'start_form', layout: null, theme_overrides: null, name_by_key: { ref: 'claim_reference' },
  fields: normalizeTaskFields([{ key: 'ref', label: 'Reference', type: 'text', required: true }]),
}

describe('the form-start gate', () => {
  it('no form start → plain; still loading → loading; a form / start form; a form that cannot be shown → unavailable', () => {
    expect(formStartGate(null, undefined)).toEqual({ kind: 'none' })
    expect(formStartGate('form', undefined)).toEqual({ kind: 'loading' })
    expect(formStartGate('start_form', undefined)).toEqual({ kind: 'loading' })
    expect(formStartGate('form', FORM)).toEqual({ kind: 'form', submitLabel: 'Send claim' })
    expect(formStartGate('start_form', START)).toEqual({ kind: 'start_form', submitLabel: 'Start test run' })
    expect(formStartGate('form', { kind: 'none', reason: "Submitting the form needs the 'forms.submit' permission" }))
      .toEqual({ kind: 'unavailable', reason: "Submitting the form needs the 'forms.submit' permission" })
    // A start form with no fields: nothing to fill in, a plain run.
    expect(formStartGate('start_form', { kind: 'none' })).toEqual({ kind: 'none' })
  })
})

describe('Run Selected', () => {
  it('runs a workflow without a form start', () => {
    expect(runSelectedDecision({ kind: 'none' }, 'form')).toEqual({ action: 'run' })
  })

  it('never runs while the start form is still loading', () => {
    expect(runSelectedDecision({ kind: 'loading' }, 'form')).toMatchObject({ action: 'blocked' })
  })

  it('with a form start shows the form and waits for its button (no run)', () => {
    const d = runSelectedDecision(formStartGate('form', FORM), 'form')
    expect(d).toEqual({ action: 'show_form', message: 'Fill in the form and press “Send claim” to start the test run.' })
    expect(runSelectedDecision(formStartGate('start_form', START), 'form')).toMatchObject({ action: 'show_form' })
  })

  it('"Show as fields" is an explicit run of the values shown (the server still checks them)', () => {
    expect(runSelectedDecision(formStartGate('form', FORM), 'fields')).toEqual({ action: 'run' })
    expect(runSelectedDecision(formStartGate('start_form', START), 'fields')).toEqual({ action: 'run' })
  })

  it('a form that cannot be shown is reported, not run around', () => {
    expect(runSelectedDecision({ kind: 'unavailable', reason: 'No access' }, 'form')).toEqual({ action: 'blocked', message: 'No access' })
  })
})

describe('Run All', () => {
  const tc = (over: any = {}) => ({ values: { claim_reference: 'edited' }, formValues: { name: 'edited' }, ...over })

  it('runs every case of a workflow without a form start with its inputs', () => {
    expect(runAllCaseDecision({ kind: 'none' }, tc())).toEqual({ action: 'run', inputs: { values: { claim_reference: 'edited' }, formValues: { name: 'edited' } } })
  })

  it('with a form start runs each case with its SAVED submission, and skips cases with none', () => {
    const gate = formStartGate('form', FORM)
    expect(runAllCaseDecision(gate, tc())).toEqual({ action: 'skip', label: 'Needs form input' })
    const saved = rememberSubmission({ values: { claim_reference: 'R-1' }, formValues: { name: 'Nancy' }, buttonId: 'send' })
    expect(runAllCaseDecision(gate, tc({ submitted: saved }))).toEqual({
      action: 'run', inputs: { values: { claim_reference: 'R-1' }, formValues: { name: 'Nancy' }, buttonId: 'send' },
    })
    expect(runAllCaseDecision(formStartGate('start_form', START), tc())).toEqual({ action: 'skip', label: 'Needs form input' })
  })

  it('never runs while loading or when the form cannot be shown', () => {
    expect(runAllCaseDecision({ kind: 'loading' }, tc())).toMatchObject({ action: 'skip' })
    expect(runAllCaseDecision({ kind: 'unavailable', reason: 'x' }, tc())).toEqual({ action: 'skip', label: 'x' })
  })

  it('the saved submission is a copy: later edits to the case do not change it', () => {
    const inputs = { values: { a: '1' }, formValues: { nested: { x: 1 } } }
    const saved = rememberSubmission(inputs)
    inputs.values.a = '2'
    ;(inputs.formValues.nested as any).x = 2
    expect(saved).toEqual({ values: { a: '1' }, formValues: { nested: { x: 1 } } })
  })
})

describe('Enter in the Run dialog\'s start form', () => {
  it('is an implicit submission in a text input (blocked); not in a textarea, on a button, or with modifiers', () => {
    expect(isImplicitSubmitKey({ key: 'Enter', target: { tagName: 'INPUT', type: 'text' } })).toBe(true)
    expect(isImplicitSubmitKey({ key: 'Enter', target: { tagName: 'INPUT', type: 'number' } })).toBe(true)
    expect(isImplicitSubmitKey({ key: 'Enter', target: { tagName: 'TEXTAREA' } })).toBe(false)
    expect(isImplicitSubmitKey({ key: 'Enter', target: { tagName: 'BUTTON', type: 'submit' } })).toBe(false)
    expect(isImplicitSubmitKey({ key: 'Enter', target: { tagName: 'INPUT', type: 'submit' } })).toBe(false)
    expect(isImplicitSubmitKey({ key: 'a', target: { tagName: 'INPUT', type: 'text' } })).toBe(false)
    expect(isImplicitSubmitKey({ key: 'Enter', isComposing: true, target: { tagName: 'INPUT', type: 'text' } })).toBe(false)
  })
})
