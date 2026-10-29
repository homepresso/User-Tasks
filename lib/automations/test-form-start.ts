/**
 * The designer's Test runner when the workflow starts from a form (its
 * "Form submitted" trigger's form, or a designed start form): nothing runs
 * until the tester presses the form's own button and its values pass the
 * checks (the client's, then the server's — app/api/workflows/execute-stream
 * refuses a form-start test without them).
 *
 *  - Run Selected shows / focuses the selected case's form and waits for
 *    its button (in "Show as fields", the explicit power-user view, it runs
 *    the values shown — still checked by the server).
 *  - Run All runs each case with its SAVED submission (what the tester last
 *    submitted for that case, copied when the server accepted it); a case
 *    that was never submitted is skipped as "Needs form input".
 *  - Nothing runs while the start form is still loading.
 *  - Enter in a start-form input never submits the Run dialog
 *    (isImplicitSubmitKey); its Run button does.
 *
 * Pure.
 */

import type { StartFormCase, WorkflowStartForm } from '@/lib/forms/workflow-start-form'

export type FormStartGate =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'form' | 'start_form'; submitLabel: string }
  | { kind: 'unavailable'; reason: string }

/** The start form's button label in the Test runner. */
export const TEST_START_LABEL = 'Start test run'

/** What the Test runner's run buttons may do (`spec` undefined = still loading). */
export function formStartGate(startKind: 'form' | 'start_form' | null, spec: WorkflowStartForm | undefined): FormStartGate {
  if (!startKind) return { kind: 'none' }
  if (!spec) return { kind: 'loading' }
  if (spec.kind === 'form') {
    const button = spec.form.buttons.find((b) => b.kind === 'submit' && !b.hidden)
    return { kind: 'form', submitLabel: button?.label ?? 'Submit' }
  }
  if (spec.kind === 'start_form') return { kind: 'start_form', submitLabel: TEST_START_LABEL }
  // A start form without fields has nothing to fill in; a trigger form that
  // cannot be shown (deleted, no forms.submit) cannot be submitted either.
  if (startKind === 'start_form') return { kind: 'none' }
  return { kind: 'unavailable', reason: spec.reason ?? 'The form this workflow starts from cannot be shown' }
}

export type RunSelectedDecision =
  | { action: 'run' }
  | { action: 'show_form'; message: string }
  | { action: 'blocked'; message: string }

export function runSelectedDecision(gate: FormStartGate, view: 'form' | 'fields'): RunSelectedDecision {
  switch (gate.kind) {
    case 'none': return { action: 'run' }
    case 'loading': return { action: 'blocked', message: 'Loading the start form…' }
    case 'unavailable': return { action: 'blocked', message: gate.reason }
    default:
      if (view === 'fields') return { action: 'run' }
      return { action: 'show_form', message: `Fill in the form and press “${gate.submitLabel}” to start the test run.` }
  }
}

/** A case's inputs as they were submitted (a deep copy). */
export function rememberSubmission(inputs: StartFormCase): StartFormCase {
  return JSON.parse(JSON.stringify({
    values: inputs.values ?? {},
    ...(inputs.formValues ? { formValues: inputs.formValues } : {}),
    ...(inputs.buttonId ? { buttonId: inputs.buttonId } : {}),
  })) as StartFormCase
}

export const NEEDS_FORM_INPUT = 'Needs form input'

export type RunAllCaseDecision =
  | { action: 'run'; inputs: StartFormCase }
  | { action: 'skip'; label: string }

export function runAllCaseDecision(gate: FormStartGate, tc: StartFormCase & { submitted?: StartFormCase }): RunAllCaseDecision {
  switch (gate.kind) {
    case 'none':
      return { action: 'run', inputs: { values: tc.values, ...(tc.formValues ? { formValues: tc.formValues } : {}), ...(tc.buttonId ? { buttonId: tc.buttonId } : {}) } }
    case 'loading': return { action: 'skip', label: 'Loading the start form' }
    case 'unavailable': return { action: 'skip', label: gate.reason }
    default:
      return tc.submitted ? { action: 'run', inputs: rememberSubmission(tc.submitted) } : { action: 'skip', label: NEEDS_FORM_INPUT }
  }
}

/** Enter in a single-line input of a form: the browser's implicit submission. */
export function isImplicitSubmitKey(event: { key: string; isComposing?: boolean; target: { tagName?: string; type?: string } | null }): boolean {
  if (event.key !== 'Enter' || event.isComposing) return false
  const tag = String(event.target?.tagName ?? '').toUpperCase()
  if (tag !== 'INPUT') return false
  const type = String(event.target?.type ?? 'text').toLowerCase()
  return !['submit', 'button', 'reset', 'image', 'checkbox', 'radio', 'file'].includes(type)
}
