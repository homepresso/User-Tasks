/**
 * Test inputs for the form designer's Preview: values for the form's
 * parameters (as if the form were opened with them — /f/<id>?customer=ALFKI,
 * or a task step / Run dialog passing them) and overrides for its variables.
 *
 * The preview seeds its values exactly as the form page does
 * (components/forms/standalone-form.tsx): parameters parsed against the
 * declarations with parseFormParams (coerced, validated, defaults for absent
 * or refused ones), field defaults with {{param.x}} filled in
 * (openingFieldDefaults, shared with the form page), and the values carrying
 * the parameters under FORM_PARAMS_KEY — the renderer's withFormContext then
 * computes each variable's initial value from them. A variable override is
 * put under FORM_VARS_KEY, where "Set variable" puts what rules set.
 *
 * Test inputs are designer-only state (remembered per form in this browser);
 * they are never saved into the form definition. Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { defaultTaskFieldValues, type TaskFieldDef } from '@/lib/task-field-schema'
import {
  FORM_PARAMS_KEY, FORM_VARS_KEY, coerceFormContextValue, formParamsMessage, layoutFormParams, layoutFormVariables, parseFormParams, substituteParams,
  type FormVariable, type ParsedFormParams,
} from './form-params'

/** What the author typed: parameter text by parameter name (as in a URL), variable text by variable name. */
export interface PreviewTestInputs {
  params: Record<string, string>
  vars: Record<string, string>
}

export const EMPTY_PREVIEW_INPUTS: PreviewTestInputs = { params: {}, vars: {} }

/**
 * Field defaults when a form opens: `{{param.x}}` filled in from the
 * parameters; any other placeholder has nothing to fill it on a form page
 * (the field starts empty). The form page and the designer preview both use it.
 */
export function openingFieldDefaults(fields: TaskFieldDef[], params: Record<string, unknown> | null): Record<string, unknown> {
  return defaultTaskFieldValues(fields, (v) => {
    const s = params ? substituteParams(v, params) : v
    return /\{\{/.test(s) ? '' : s
  })
}

/** A variable override typed as text → the variable's type (`{ error }` when it doesn't fit). Blank = no value. */
export function parseVariableInput(variable: Pick<FormVariable, 'type'>, text: string): { value: unknown } | { error: string } {
  if (variable.type === 'object') {
    if (!text.trim()) return { value: null }
    try { return coerceFormContextValue('object', JSON.parse(text)) } catch { return { error: 'expected JSON, e.g. {"id": 1}' } }
  }
  return coerceFormContextValue(variable.type, text)
}

/** A live value as text for an input (lists comma-joined, objects as JSON). */
export function contextValueText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'object') { try { return JSON.stringify(value) } catch { return '' } }
  return String(value)
}

/** Stored inputs (localStorage) cleaned against the declarations: unknown names dropped, text only. */
export function normalizePreviewInputs(layout: unknown, raw: unknown): PreviewTestInputs {
  const src = isPlainObject(raw) ? raw : {}
  const pick = (names: string[], from: unknown) => {
    const obj = isPlainObject(from) ? from : {}
    const out: Record<string, string> = {}
    for (const name of names) if (typeof obj[name] === 'string') out[name] = (obj[name] as string).slice(0, 20_000)
    return out
  }
  return {
    params: pick(layoutFormParams(layout).map((p) => p.name), src.params),
    vars: pick(layoutFormVariables(layout).map((v) => v.name), src.vars),
  }
}

export interface PreviewSeed {
  /** The parameters as the form would see them (null: the form declares none). */
  params: ParsedFormParams | null
  /** What the form page would show instead of the form for these parameters (missing / refused), or null. */
  message: string | null
  /** Field defaults ({{param.x}} filled in). */
  defaults: Record<string, unknown>
  /** Typed variable overrides (valid ones only). */
  vars: Record<string, unknown>
  /** name → why a variable override was refused. */
  varErrors: Record<string, string>
  /** The preview's starting values (variable overrides under FORM_VARS_KEY). */
  initialValues: Record<string, unknown>
}

/** The preview's starting point for these test inputs: what the form page computes on open with them. */
export function previewSeed(fields: TaskFieldDef[], layout: unknown, inputs: PreviewTestInputs = EMPTY_PREVIEW_INPUTS): PreviewSeed {
  const declared = layoutFormParams(layout)
  const raw: Record<string, unknown> = {}
  // Blank = not given (the default applies), as a URL without the parameter.
  for (const p of declared) { const t = inputs.params[p.name]; if (typeof t === 'string' && t.trim()) raw[p.name] = t }
  const params = declared.length ? parseFormParams(declared, raw) : null
  const vars: Record<string, unknown> = {}
  const varErrors: Record<string, string> = {}
  for (const v of layoutFormVariables(layout)) {
    if (!Object.prototype.hasOwnProperty.call(inputs.vars, v.name)) continue
    const r = parseVariableInput(v, inputs.vars[v.name])
    if ('error' in r) varErrors[v.name] = r.error
    else vars[v.name] = r.value
  }
  return {
    params,
    message: params ? formParamsMessage(declared, params) : null,
    defaults: openingFieldDefaults(fields, params?.values ?? null),
    vars,
    varErrors,
    initialValues: Object.keys(vars).length ? { [FORM_VARS_KEY]: vars } : {},
  }
}

/** The values the preview renders: defaults, what was typed / set, and the parameters (as the form page passes them). */
export function previewShownValues(seed: PreviewSeed, values: Record<string, unknown>): Record<string, unknown> {
  return seed.params ? { ...seed.defaults, ...values, [FORM_PARAMS_KEY]: seed.params.values } : { ...seed.defaults, ...values }
}

/** localStorage key of a form's test inputs. */
export function previewInputsStorageKey(formKey: string): string {
  return `ut:designer-preview-inputs:${formKey}`
}
