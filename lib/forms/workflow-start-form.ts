/**
 * The form a workflow STARTS from, as the Test runner and the Run dialog
 * draw it:
 *
 *  - `form`        the trigger is "Form submitted" on a reusable form: the
 *                  form exactly as its own page (/f/<id>) draws it (header,
 *                  grid, mini theme, lookups, buttons). The Run dialog
 *                  submits it for real (a form_submissions row, the button
 *                  behaviours, the trigger fires); the Test runner sends a
 *                  test submission (lib/services/form-submissions
 *                  planTestSubmission: same checks, nothing stored).
 *  - `start_form`  the workflow inputs designed as a start form (trigger
 *                  node `start_form`): grid + theme over the variables.
 *  - `none`        plain variable inputs (also the "Show as fields" view).
 *
 * A first step that is a User Task is not a start form: the run pauses
 * there and the task form appears as before. Pure and isomorphic.
 */

import type { FormButton } from './buttons'
import type { FormHeader } from './header'
import type { FormLayout } from './layout'
import type { FormThemeOverrides } from './form-theme'
import { defaultTaskFieldValues, valueFields, type TaskFieldDef } from '@/lib/task-field-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- nodes are loose JSON */

export interface SubmittableFormView {
  id: string
  name: string
  description: string | null
  version: number
  fields: TaskFieldDef[]
  layout: FormLayout | null
  theme_overrides: FormThemeOverrides | null
  buttons: FormButton[]
  header: FormHeader | null
}

export type WorkflowStartForm =
  | { kind: 'form'; form: SubmittableFormView; button_ids: string[] }
  | { kind: 'start_form'; fields: TaskFieldDef[]; layout: FormLayout | null; theme_overrides: FormThemeOverrides | null; name_by_key: Record<string, string> }
  | { kind: 'none'; reason?: string }

/** What a workflow's nodes start from (no database read): the trigger's form, a start form, or nothing. */
export function startFormKind(nodes: unknown): 'form' | 'start_form' | null {
  const list = Array.isArray(nodes) ? nodes : []
  if (list.some((n: any) => n?.type === 'form_submitted' && typeof n?.config?.form_id === 'string' && n.config.form_id)) return 'form'
  if (list.some((n: any) => n?.config?.start_form && typeof n.config.start_form === 'object')) return 'start_form'
  return null
}

/** The "Form submitted" trigger node (first one). */
export function formSubmittedTrigger(nodes: unknown): { id: string; config: Record<string, any> } | null {
  const node = (Array.isArray(nodes) ? nodes : []).find((n: any) => n?.type === 'form_submitted')
  return node ? { id: String(node.id ?? ''), config: (node.config ?? {}) as Record<string, any> } : null
}

/** The page a reusable form is filled in on. */
export function formPagePath(formId: string): string {
  return `/f/${encodeURIComponent(formId)}`
}

export function formPageUrl(origin: string, formId: string): string {
  return `${origin.replace(/\/+$/, '')}${formPagePath(formId)}`
}

/** A form's starting values (defaults; `{{…}}` defaults are left empty, as on /f/<id>). */
export function formDefaultValues(fields: TaskFieldDef[]): Record<string, unknown> {
  return defaultTaskFieldValues(fields, (v) => (/\{\{/.test(v) ? '' : v))
}

/* ── Start forms over the test case's string values (keyed by variable name) ── */

/** Variable strings → the start form's values (keyed by field key, booleans typed). */
export function startFormValues(spec: Extract<WorkflowStartForm, { kind: 'start_form' }>, variables: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of spec.fields) {
    const raw = variables[spec.name_by_key[field.key] ?? field.key]
    if (raw === undefined) continue
    out[field.key] = field.type === 'boolean' ? raw === 'true' : raw
  }
  return out
}

/** A start-form change → the variable name and the string the test case stores. */
export function startFormVariable(spec: Extract<WorkflowStartForm, { kind: 'start_form' }>, key: string, value: unknown): { name: string; value: string } {
  const name = spec.name_by_key[key] ?? key
  if (value === null || value === undefined) return { name, value: '' }
  if (typeof value === 'boolean') return { name, value: value ? 'true' : 'false' }
  if (typeof value === 'object') return { name, value: JSON.stringify(value) }
  return { name, value: String(value) }
}

/* ── The "Show as fields" view of a form's values ── */

/** One value as text in the plain inputs (objects / arrays as JSON). */
export function fieldText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Text from a plain input → the value (JSON objects / arrays parsed; the server coerces the rest). */
export function parseFieldText(text: string): unknown {
  const t = text.trim()
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try { return JSON.parse(t) } catch { return text }
  }
  return text
}

/** The keys a form's plain view shows (value fields; lookups' items are recomputed by the server). */
export function plainFieldKeys(fields: TaskFieldDef[]): Array<{ key: string; label: string; type: string }> {
  return valueFields(fields).map((f) => ({ key: f.key, label: f.label, type: f.type }))
}

/** Short `key=value` chips for a test case in the list. */
export function valueChips(values: Record<string, unknown>, keys: string[], max = 3): { chips: string[]; more: number } {
  const chips = keys.slice(0, max).map((k) => `${k}=${fieldText(values[k]) || '""'}`)
  return { chips, more: Math.max(0, keys.length - max) }
}

/* ── Test cases ── */

/** What a Test runner case stores: variable strings, and for a form its values and button. */
export interface StartFormCase {
  values: Record<string, string>
  formValues?: Record<string, unknown>
  buttonId?: string
}

/** The values a case's form shows (prefilled from the case; the form's defaults under them). */
export function caseFormValues(spec: WorkflowStartForm | null, tc: StartFormCase, defaults: Record<string, unknown> = spec?.kind === 'form' ? formDefaultValues(spec.form.fields) : {}): Record<string, unknown> {
  if (spec?.kind === 'form') return { ...defaults, ...(tc.formValues ?? {}) }
  if (spec?.kind === 'start_form') return startFormValues(spec, tc.values)
  return {}
}

/** A case after a form change: start forms store the variable string, linked forms the typed value. */
export function withCaseFormValue<T extends StartFormCase>(spec: WorkflowStartForm | null, tc: T, key: string, value: unknown): T {
  if (spec?.kind === 'start_form') {
    const v = startFormVariable(spec, key, value)
    return { ...tc, values: { ...tc.values, [v.name]: v.value } }
  }
  return { ...tc, formValues: { ...(tc.formValues ?? {}), [key]: value } }
}

/** A copy of a case's inputs (Duplicate): nothing shared with the original. */
export function copyCaseInputs(tc: StartFormCase): StartFormCase {
  return {
    values: { ...tc.values },
    ...(tc.formValues ? { formValues: JSON.parse(JSON.stringify(tc.formValues)) as Record<string, unknown> } : {}),
    ...(tc.buttonId ? { buttonId: tc.buttonId } : {}),
  }
}
