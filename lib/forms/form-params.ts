/**
 * Form parameters and form variables.
 *
 *   Parameters  inputs a form is opened with: a URL query parameter on its
 *               page (/f/<id>?customer=ALFKI) or a value the embedding
 *               context passes (a task form: the User Task step's
 *               "Form parameters" mapping; a start form: the Run dialog).
 *               Typed (text, number, yes / no, date, list of text), with an
 *               optional default, required yes / no and validation (allowed
 *               values, a pattern, min / max).
 *   Variables   named values the form keeps while it is open: a type and an
 *               initial value (a constant, a parameter or a placeholder
 *               expression). Rules change them with "Set variable" (and an
 *               API reference's results); they can be cleared and reset.
 *
 * Both are declared on the layout — `layout.params` and `layout.variables`
 * (lib/forms/layout.ts) — so they travel wherever the grid goes: a node's
 * `form_layout`, task metadata, reusable forms and their versions, exports,
 * packages, the REST API, MCP and the CLI's config-as-code. Older readers
 * ignore the keys; a form without them behaves exactly as before.
 *
 * At run time they live in the form's values under two reserved keys —
 * FORM_PARAMS_KEY and FORM_VARS_KEY — like the in-form state
 * (FORM_STATE_KEY), so every surface keeps them with its values and every
 * placeholder resolver can read them: `{{param.<name>}}` and
 * `{{var.<name>}}` (formContextPath maps them onto the reserved keys).
 *
 * Security model: parameters and variables are user-controllable input,
 * exactly like field values. Never trusted:
 *  - the server re-parses them against the SAVED declarations
 *    (serverFormContext): unknown names are dropped, values are coerced to
 *    the declared type, validated (allowed values, pattern, min / max) and
 *    bounded in size; a task form's parameters come from the task (what the
 *    workflow passed when it created it), never from the browser;
 *  - they are only ever placeholder VALUES: a Data table's base filter,
 *    column projection and source, a lookup's source and an API reference
 *    come from the saved form; a value can only narrow a base filter (the
 *    filter is quoted and never dropped), and an API call reaches only the
 *    declared reference, with the value in the inputs the author mapped;
 *  - they are not stored unless the author marks one "Include in
 *    submission" (then it is stored beside the fields under its own name).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'

export const FORM_PARAMS_KEY = '__form_params'
export const FORM_VARS_KEY = '__form_vars'
/** The controls' live state ({{control.<key>.*}}, lib/forms/rule-variables.ts). */
export const CONTROLS_KEY = '__form_controls'

export type FormParamType = 'text' | 'number' | 'boolean' | 'date' | 'text_list'
export type FormVariableType = FormParamType | 'object'
export type FormParamSource = 'url' | 'context'

export const FORM_PARAM_TYPES: FormParamType[] = ['text', 'number', 'boolean', 'date', 'text_list']
export const FORM_VARIABLE_TYPES: FormVariableType[] = ['text', 'number', 'boolean', 'date', 'text_list', 'object']
export const FORM_PARAM_TYPE_LABELS: Record<FormVariableType, string> = {
  text: 'Text', number: 'Number', boolean: 'Yes / no', date: 'Date', text_list: 'List of text', object: 'Row / object',
}
export const FORM_PARAM_SOURCE_LABELS: Record<FormParamSource, string> = {
  url: 'URL query parameter',
  context: 'Passed by the embedding context (task step, Run dialog)',
}

export interface FormParam {
  /** `{{param.<name>}}`. */
  name: string
  label?: string
  description?: string
  type: FormParamType
  /** Used when the parameter is not given (text; a list is comma-separated). */
  default?: string
  required?: boolean
  source: FormParamSource
  /** URL source: the query parameter's name (default: the parameter's name). */
  query_name?: string
  /** Validation. */
  allowed?: string[]
  /** A regular expression the text (each list item) must match in full. */
  pattern?: string
  /** Number: the value; text: the length; list: the item count; date: YYYY-MM-DD. */
  min?: number | string
  max?: number | string
  /** Store the value with the submission (under its name) for the workflow. */
  include?: boolean
}

export type FormVariableInitialKind = 'none' | 'constant' | 'param' | 'expression'
export interface FormVariable {
  /** `{{var.<name>}}`. */
  name: string
  label?: string
  description?: string
  type: FormVariableType
  /** Initial value: a constant, a parameter's value or a placeholder expression ({{param.x}}, {{today}}, {{field}}). */
  initial?: { kind: Exclude<FormVariableInitialKind, 'none'>; value: string }
  /** Store the value with the submission (under its name) for the workflow. */
  include?: boolean
}

export const FORM_PARAM_LIMITS = {
  params: 30, variables: 30, name: 40, label: 80, description: 300, text: 500, listItems: 50, listItem: 200,
  allowed: 100, pattern: 200, object: 20_000, total: 64_000, default: 500, queryName: 64,
} as const

const NAME_RE = /^[a-z][a-z0-9_]{0,39}$/
const QUERY_NAME_RE = /^[A-Za-z0-9_.~-]{1,64}$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
/** Names a parameter / variable may not use (they would shadow the values they are stored beside). */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'param', 'var', 'form', 'task', 'task_data', 'user', 'event', 'state', 'search', 'query', 'today', 'now', 'outcome', 'id'])

export function isFormContextName(name: unknown): name is string {
  return typeof name === 'string' && NAME_RE.test(name) && !RESERVED.has(name)
}

/** Why a parameter / variable name can't be used (the designer's name boxes), or null. */
export function formContextNameProblem(name: string, taken: Iterable<string> = []): string | null {
  if (!name) return 'Give it a name, e.g. customer_id'
  if (!/^[a-z]/.test(name)) return 'Start the name with a letter'
  if (!NAME_RE.test(name)) return 'Use lower-case letters, digits and _ (up to 40)'
  if (RESERVED.has(name)) return `"${name}" is reserved: choose another name`
  if (new Set(taken).has(name)) return `"${name}" is already a parameter or variable`
  return null
}

/** A free name for a new parameter / variable: `base`, `base_2`… (never a reserved one). */
export function freeFormContextName(base: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  const start = isFormContextName(base) ? base : `${base}_value`
  let name = start
  for (let i = 2; used.has(name) || !isFormContextName(name); i += 1) name = `${start}_${i}`
  return name
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return s ? s.slice(0, max) : undefined
}

function bound(raw: unknown, type: FormVariableType): number | string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined
  if (type === 'date') return typeof raw === 'string' && DATE_RE.test(raw.trim()) ? raw.trim() : undefined
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  return Number.isFinite(n) ? n : undefined
}

/** A safe author pattern (compiles, bounded), or undefined. */
export function compilePattern(pattern: string | undefined): RegExp | null {
  if (!pattern) return null
  try { return new RegExp(`^(?:${pattern})$`) } catch { return null }
}

/* ── Declarations ───────────────────────────────────────────────────── */

/** Clean stored / submitted parameter declarations (unknown props dropped, names unique and valid). */
export function normalizeFormParams(raw: unknown): FormParam[] {
  if (!Array.isArray(raw)) return []
  const out: FormParam[] = []
  const names = new Set<string>()
  for (const entry of raw) {
    if (out.length >= FORM_PARAM_LIMITS.params) break
    if (!isPlainObject(entry) || !isFormContextName(entry.name) || names.has(entry.name)) continue
    names.add(entry.name)
    const type = FORM_PARAM_TYPES.includes(entry.type as FormParamType) ? entry.type as FormParamType : 'text'
    const param: FormParam = { name: entry.name, type, source: entry.source === 'context' ? 'context' : 'url' }
    const label = str(entry.label, FORM_PARAM_LIMITS.label)
    if (label) param.label = label.replace(/[<>]/g, '')
    const description = str(entry.description, FORM_PARAM_LIMITS.description)
    if (description) param.description = description.replace(/[<>]/g, '')
    if (typeof entry.default === 'string' || typeof entry.default === 'number' || typeof entry.default === 'boolean') {
      const d = String(entry.default).slice(0, FORM_PARAM_LIMITS.default)
      if (d.trim()) param.default = d
    }
    if (entry.required === true) param.required = true
    if (param.source === 'url' && typeof entry.query_name === 'string' && QUERY_NAME_RE.test(entry.query_name) && entry.query_name !== entry.name) param.query_name = entry.query_name
    if (Array.isArray(entry.allowed)) {
      const allowed = [...new Set(entry.allowed.map((v) => str(typeof v === 'number' || typeof v === 'boolean' ? String(v) : v, FORM_PARAM_LIMITS.listItem)).filter((v): v is string => Boolean(v)))].slice(0, FORM_PARAM_LIMITS.allowed)
      if (allowed.length && type !== 'boolean') param.allowed = allowed
    }
    const pattern = typeof entry.pattern === 'string' ? entry.pattern.slice(0, FORM_PARAM_LIMITS.pattern) : ''
    if (pattern && (type === 'text' || type === 'text_list') && compilePattern(pattern)) param.pattern = pattern
    if (type !== 'boolean') {
      const min = bound(entry.min, type); const max = bound(entry.max, type)
      if (min !== undefined) param.min = min
      if (max !== undefined) param.max = max
    }
    if (entry.include === true) param.include = true
    out.push(param)
  }
  return out
}

/** Clean stored / submitted variable declarations. Names must not repeat a parameter's. */
export function normalizeFormVariables(raw: unknown, paramNames: Iterable<string> = []): FormVariable[] {
  if (!Array.isArray(raw)) return []
  const out: FormVariable[] = []
  const names = new Set<string>(paramNames)
  for (const entry of raw) {
    if (out.length >= FORM_PARAM_LIMITS.variables) break
    if (!isPlainObject(entry) || !isFormContextName(entry.name) || names.has(entry.name)) continue
    names.add(entry.name)
    const type = FORM_VARIABLE_TYPES.includes(entry.type as FormVariableType) ? entry.type as FormVariableType : 'text'
    const variable: FormVariable = { name: entry.name, type }
    const label = str(entry.label, FORM_PARAM_LIMITS.label)
    if (label) variable.label = label.replace(/[<>]/g, '')
    const description = str(entry.description, FORM_PARAM_LIMITS.description)
    if (description) variable.description = description.replace(/[<>]/g, '')
    const initial = isPlainObject(entry.initial) ? entry.initial : null
    if (initial && (initial.kind === 'constant' || initial.kind === 'param' || initial.kind === 'expression')) {
      const value = typeof initial.value === 'string' || typeof initial.value === 'number' || typeof initial.value === 'boolean' ? String(initial.value).slice(0, FORM_PARAM_LIMITS.default) : ''
      if (initial.kind !== 'param' || isFormContextName(value)) {
        if (value.trim() || initial.kind === 'constant') variable.initial = { kind: initial.kind, value }
      }
    }
    if (entry.include === true) variable.include = true
    out.push(variable)
  }
  return out
}

/** The declarations on a (stored or normalized) layout. */
export function layoutFormParams(layout: unknown): FormParam[] {
  return isPlainObject(layout) ? normalizeFormParams(layout.params) : []
}

export function layoutFormVariables(layout: unknown): FormVariable[] {
  if (!isPlainObject(layout)) return []
  return normalizeFormVariables(layout.variables, layoutFormParams(layout).map((p) => p.name))
}

export function hasFormContext(layout: unknown): boolean {
  return isPlainObject(layout) && ((Array.isArray(layout.params) && layout.params.length > 0) || (Array.isArray(layout.variables) && layout.variables.length > 0))
}

/* ── Values: coercion and validation ────────────────────────────────── */

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, ' ')

/** One raw value (text from a URL, or a typed value) as the declared type; `{ error }` when it doesn't fit. */
export function coerceFormContextValue(type: FormVariableType, raw: unknown): { value: unknown } | { error: string } {
  if (raw === undefined || raw === null) return { value: null }
  switch (type) {
    case 'text': {
      if (typeof raw === 'object') return { error: 'expected text' }
      const s = clean(String(raw))
      if (s.length > FORM_PARAM_LIMITS.text) return { error: `at most ${FORM_PARAM_LIMITS.text} characters` }
      return { value: s.trim() ? s : null }
    }
    case 'number': {
      if (typeof raw === 'number') return Number.isFinite(raw) ? { value: raw } : { error: 'expected a number' }
      if (typeof raw !== 'string') return { error: 'expected a number' }
      const t = raw.trim()
      if (!t) return { value: null }
      if (!/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(t) || t.length > 40) return { error: 'expected a number' }
      return { value: Number(t) }
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw }
      const t = String(raw).trim().toLowerCase()
      if (!t) return { value: null }
      if (['true', '1', 'yes', 'on', 'y'].includes(t)) return { value: true }
      if (['false', '0', 'no', 'off', 'n'].includes(t)) return { value: false }
      return { error: 'expected yes or no' }
    }
    case 'date': {
      if (typeof raw !== 'string') return { error: 'expected a date (YYYY-MM-DD)' }
      const t = raw.trim()
      if (!t) return { value: null }
      const day = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(t) ? t.slice(0, 10) : ''
      if (!day || Number.isNaN(Date.parse(`${day}T00:00:00Z`)) || new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) return { error: 'expected a date (YYYY-MM-DD)' }
      return { value: day }
    }
    case 'text_list': {
      const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : null
      if (!items) return { error: 'expected a list of text' }
      if (items.length > FORM_PARAM_LIMITS.listItems) return { error: `at most ${FORM_PARAM_LIMITS.listItems} items` }
      const out: string[] = []
      for (const item of items) {
        if (item === null || item === undefined || typeof item === 'object') return { error: 'expected a list of text' }
        const s = clean(String(item)).trim()
        if (s.length > FORM_PARAM_LIMITS.listItem) return { error: `items have at most ${FORM_PARAM_LIMITS.listItem} characters` }
        if (s) out.push(s)
      }
      return { value: out.length ? out : null }
    }
    case 'object': {
      if (typeof raw !== 'object') return { error: 'expected an object' }
      try {
        const json = JSON.stringify(raw)
        if (json.length > FORM_PARAM_LIMITS.object) return { error: 'too large' }
        return { value: JSON.parse(json) }
      } catch { return { error: 'expected an object' } }
    }
  }
}

/** The declaration's validation (allowed values, pattern, min / max) of a coerced, non-empty value; an error message or null. */
export function formParamConstraintError(param: Pick<FormParam, 'type' | 'allowed' | 'pattern' | 'min' | 'max'>, value: unknown): string | null {
  if (value === null || value === undefined) return null
  const items = Array.isArray(value) ? value.map(String) : [String(value)]
  if (param.allowed?.length) {
    const allowed = new Set(param.allowed.map((v) => v.toLowerCase()))
    const bad = items.find((v) => !allowed.has(v.toLowerCase()))
    if (bad !== undefined) return `"${bad.slice(0, 40)}" is not one of the allowed values`
  }
  const re = compilePattern(param.pattern)
  if (re && (param.type === 'text' || param.type === 'text_list')) {
    const bad = items.find((v) => !re.test(v))
    if (bad !== undefined) return `"${bad.slice(0, 40)}" does not have the expected format`
  }
  const { min, max } = param
  if (param.type === 'number') {
    const n = Number(value)
    if (typeof min === 'number' && n < min) return `must be at least ${min}`
    if (typeof max === 'number' && n > max) return `must be at most ${max}`
  } else if (param.type === 'text') {
    const len = String(value).length
    if (typeof min === 'number' && len < min) return `must have at least ${min} characters`
    if (typeof max === 'number' && len > max) return `must have at most ${max} characters`
  } else if (param.type === 'text_list') {
    if (typeof min === 'number' && items.length < min) return `needs at least ${min} items`
    if (typeof max === 'number' && items.length > max) return `takes at most ${max} items`
  } else if (param.type === 'date') {
    if (typeof min === 'string' && String(value) < min) return `must be on or after ${min}`
    if (typeof max === 'string' && String(value) > max) return `must be on or before ${max}`
  }
  return null
}

export interface ParsedFormParams {
  /** name → typed value (defaults applied; null when absent). */
  values: Record<string, unknown>
  /** Required parameters with no value. */
  missing: string[]
  /** name → why the given value was refused. */
  errors: Record<string, string>
}

function paramDefault(param: FormParam): unknown {
  if (param.default === undefined) return null
  const r = coerceFormContextValue(param.type, param.default)
  if ('error' in r) return null
  return formParamConstraintError(param, r.value) ? null : r.value
}

/**
 * Parameters from raw values keyed by parameter name (typed values, text or
 * lists): unknown names ignored, each value coerced and validated, defaults
 * for absent ones. A refused value counts as absent (its default applies) and
 * is reported in `errors`.
 */
export function parseFormParams(params: FormParam[], raw: unknown): ParsedFormParams {
  const input = isPlainObject(raw) ? raw : {}
  const out: ParsedFormParams = { values: {}, missing: [], errors: {} }
  for (const param of params) {
    let value: unknown = null
    if (Object.prototype.hasOwnProperty.call(input, param.name)) {
      const r = coerceFormContextValue(param.type, input[param.name])
      if ('error' in r) out.errors[param.name] = r.error
      else {
        const problem = formParamConstraintError(param, r.value)
        if (problem) out.errors[param.name] = problem
        else value = r.value
      }
    }
    if (value === null) value = paramDefault(param)
    out.values[param.name] = value
    if (param.required && (value === null || value === undefined) && !out.errors[param.name]) out.missing.push(param.name)
  }
  return out
}

/** A URL query (URLSearchParams or a record) → raw values by parameter name: URL-sourced parameters only, by their query name. */
export function paramsFromQuery(params: FormParam[], query: URLSearchParams | Record<string, string | string[] | undefined> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!query) return out
  const getAll = (name: string): string[] => {
    if (query instanceof URLSearchParams) return query.getAll(name)
    const v = (query as Record<string, string | string[] | undefined>)[name]
    return v === undefined ? [] : Array.isArray(v) ? v : [v]
  }
  for (const param of params) {
    if (param.source !== 'url') continue
    const values = getAll(param.query_name ?? param.name).slice(0, FORM_PARAM_LIMITS.listItems)
    if (!values.length) continue
    out[param.name] = param.type === 'text_list' ? values.flatMap((v) => v.split(',')) : values[0]
  }
  return out
}

/** Bounded, typed variables from raw values by name (unknown names dropped, refused values → null). */
export function parseFormVariables(variables: FormVariable[], raw: unknown): Record<string, unknown> {
  const input = isPlainObject(raw) ? raw : {}
  const out: Record<string, unknown> = {}
  let total = 0
  for (const variable of variables) {
    if (!Object.prototype.hasOwnProperty.call(input, variable.name)) continue
    const r = coerceFormContextValue(variable.type, input[variable.name])
    let value = 'error' in r ? null : r.value
    const size = value === null ? 4 : JSON.stringify(value).length
    if (total + size > FORM_PARAM_LIMITS.total) value = null
    total += value === null ? 4 : size
    out[variable.name] = value
  }
  return out
}

/* ── Placeholders ───────────────────────────────────────────────────── */

/** `param.x` → `__form_params.x`, `var.x` → `__form_vars.x`, `control.x` → `__form_controls.x` (the reserved keys in the values); other paths → null. */
export function formContextPath(path: string): string | null {
  if (path === 'param' || path.startsWith('param.')) return FORM_PARAMS_KEY + path.slice(5)
  if (path === 'var' || path.startsWith('var.')) return FORM_VARS_KEY + path.slice(3)
  if (path === 'control' || path.startsWith('control.')) return CONTROLS_KEY + path.slice(7)
  return null
}

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]$]+)\s*\}\}/g

function readPath(values: Record<string, unknown>, path: string): unknown {
  let cursor: unknown = values
  for (const seg of path.split('.')) {
    if (!seg) continue
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    if (seg === '__proto__' || seg === 'constructor' || seg === 'prototype') return undefined
    cursor = (cursor as Record<string, unknown>)[seg]
  }
  return cursor
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** A variable's initial expression: {{param.x}}, {{var.x}}, {{form.x}} / {{field}}, {{today}}, {{now}}; one placeholder keeps its raw value. */
function resolveInitial(text: string, values: Record<string, unknown>, now: Date): unknown {
  const lookup = (path: string): unknown => {
    if (path === 'today') return isoDay(now)
    if (path === 'now') return now.toISOString()
    const alias = formContextPath(path)
    if (alias) return readPath(values, alias)
    const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
    return readPath(values, m ? m[1] : path)
  }
  const whole = /^\{\{\s*([\w.\-[\]$]+)\s*\}\}$/.exec(text.trim())
  if (whole) { const v = lookup(whole[1]); return v === undefined ? null : v }
  if (!text.includes('{{')) return text
  return text.replace(TEMPLATE_RE, (_m, path: string) => {
    const v = lookup(path)
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}

/** A variable's initial value for these params / values (null when none or it doesn't fit the type). */
export function variableInitial(variable: FormVariable, params: Record<string, unknown>, values: Record<string, unknown> = {}, now: Date = new Date()): unknown {
  const initial = variable.initial
  if (!initial) return null
  let raw: unknown
  if (initial.kind === 'param') raw = params[initial.value] ?? null
  else if (initial.kind === 'constant') raw = variable.type === 'object' ? safeJson(initial.value) : initial.value
  else raw = resolveInitial(initial.value, { ...values, [FORM_PARAMS_KEY]: params }, now)
  if (variable.type === 'object' && typeof raw === 'string') raw = safeJson(raw)
  const r = coerceFormContextValue(variable.type, raw)
  return 'error' in r ? null : r.value
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text) } catch { return null }
}

/**
 * The values with the form's context filled in: FORM_PARAMS_KEY holds every
 * declared parameter (what the surface gave, re-parsed; defaults otherwise)
 * and FORM_VARS_KEY every declared variable (what rules set over the
 * initial values). Forms without declarations get the values back as they are.
 */
export function withFormContext(layout: unknown, values: Record<string, unknown>, now?: Date): Record<string, unknown> {
  const params = layoutFormParams(layout)
  const variables = layoutFormVariables(layout)
  if (!params.length && !variables.length) return values
  const parsed = parseFormParams(params, values?.[FORM_PARAMS_KEY])
  const set = isPlainObject(values?.[FORM_VARS_KEY]) ? values[FORM_VARS_KEY] as Record<string, unknown> : {}
  const typed = parseFormVariables(variables, set)
  const vars: Record<string, unknown> = {}
  for (const variable of variables) {
    vars[variable.name] = Object.prototype.hasOwnProperty.call(typed, variable.name) ? typed[variable.name] : variableInitial(variable, parsed.values, values, now)
  }
  return { ...values, [FORM_PARAMS_KEY]: parsed.values, [FORM_VARS_KEY]: vars }
}

/** `param` / `var` roots for formula scopes ({{=…}} expressions read param.x / var.x). */
export function formContextScope(values: Record<string, unknown>): { param: Record<string, unknown>; var: Record<string, unknown> } {
  const params = values?.[FORM_PARAMS_KEY]
  const vars = values?.[FORM_VARS_KEY]
  return { param: isPlainObject(params) ? params : {}, var: isPlainObject(vars) ? vars : {} }
}

/** The variables rules have set (stored under FORM_VARS_KEY), for "Set variable" to update. */
export function setVariables(values: Record<string, unknown>): Record<string, unknown> {
  const raw = values?.[FORM_VARS_KEY]
  return isPlainObject(raw) ? { ...raw } : {}
}

/* ── Server: the context of a request ───────────────────────────────── */

export interface ServerFormContext {
  params: Record<string, unknown>
  vars: Record<string, unknown>
  missing: string[]
  errors: Record<string, string>
  /** The reserved entries to put into the values the server resolves placeholders against. */
  entries: Record<string, unknown>
}

/**
 * The parameters and variables of a request, re-validated against the
 * SAVED layout. `storedParams` (a task: what the workflow passed when it
 * created the task) replaces whatever the request claims; otherwise the
 * request's `params` (or `values[FORM_PARAMS_KEY]`) are parsed. Variables
 * come from the request's `variables` (or `values[FORM_VARS_KEY]`), typed and
 * bounded, initial values for the rest.
 */
export function serverFormContext(layout: unknown, request: { values?: unknown; params?: unknown; variables?: unknown }, options: { storedParams?: unknown; now?: Date } = {}): ServerFormContext {
  const params = layoutFormParams(layout)
  const variables = layoutFormVariables(layout)
  const values = isPlainObject(request.values) ? request.values : {}
  const rawParams = options.storedParams !== undefined && options.storedParams !== null
    ? options.storedParams
    : isPlainObject(request.params) ? request.params : values[FORM_PARAMS_KEY]
  const parsed = parseFormParams(params, rawParams)
  const rawVars = isPlainObject(request.variables) ? request.variables : values[FORM_VARS_KEY]
  const typed = parseFormVariables(variables, rawVars)
  const vars: Record<string, unknown> = {}
  for (const variable of variables) vars[variable.name] = Object.prototype.hasOwnProperty.call(typed, variable.name) ? typed[variable.name] : variableInitial(variable, parsed.values, values, options.now)
  const entries: Record<string, unknown> = {}
  if (params.length) entries[FORM_PARAMS_KEY] = parsed.values
  if (variables.length) entries[FORM_VARS_KEY] = vars
  return { params: parsed.values, vars, missing: parsed.missing, errors: parsed.errors, entries }
}

/** Values without the reserved context keys (what is never stored as such). */
export function stripFormContext<T extends Record<string, unknown>>(values: T): T {
  if (!values || ![FORM_PARAMS_KEY, FORM_VARS_KEY, CONTROLS_KEY].some((k) => Object.prototype.hasOwnProperty.call(values, k))) return values
  const out = { ...values }
  delete out[FORM_PARAMS_KEY]
  delete out[FORM_VARS_KEY]
  delete out[CONTROLS_KEY]
  return out
}

/** The parameters / variables marked "Include in submission", by name (names that are field keys are skipped: the field wins). */
export function includedFormContext(layout: unknown, context: Pick<ServerFormContext, 'params' | 'vars'>, fieldKeys: Iterable<string> = []): Record<string, unknown> {
  const taken = new Set(fieldKeys)
  const out: Record<string, unknown> = {}
  for (const p of layoutFormParams(layout)) if (p.include && !taken.has(p.name)) out[p.name] = context.params[p.name] ?? null
  for (const v of layoutFormVariables(layout)) if (v.include && !taken.has(v.name)) out[v.name] = context.vars[v.name] ?? null
  return out
}

/** A friendly message for missing / refused parameters (null when fine). */
export function formParamsMessage(params: FormParam[], parsed: Pick<ParsedFormParams, 'missing' | 'errors'>): string | null {
  const label = (name: string) => params.find((p) => p.name === name)?.label ?? name
  const parts: string[] = []
  if (parsed.missing.length) parts.push(`This form needs ${parsed.missing.length === 1 ? 'the parameter' : 'the parameters'} ${parsed.missing.map((n) => `"${label(n)}"`).join(', ')}.`)
  for (const [name, error] of Object.entries(parsed.errors)) parts.push(`"${label(name)}": ${error}.`)
  return parts.length ? parts.join(' ') : null
}

/* ── Designer helpers ───────────────────────────────────────────────── */

/** The data type a parameter / variable has in the data picker. */
export function formContextSchemaType(type: FormVariableType): 'string' | 'number' | 'boolean' | 'array' | 'object' {
  if (type === 'number') return 'number'
  if (type === 'boolean') return 'boolean'
  if (type === 'text_list') return 'array'
  if (type === 'object') return 'object'
  return 'string'
}

export interface FormContextPlaceholder {
  group: 'Parameters' | 'Variables'
  token: string
  label: string
  type: FormVariableType
}

/** Placeholder menu entries: {{param.<name>}} and {{var.<name>}}, typed. */
export function formContextPlaceholders(layout: unknown): FormContextPlaceholder[] {
  return [
    ...layoutFormParams(layout).map((p) => ({ group: 'Parameters' as const, token: `{{param.${p.name}}}`, label: p.label ?? p.name, type: p.type as FormVariableType })),
    ...layoutFormVariables(layout).map((v) => ({ group: 'Variables' as const, token: `{{var.${v.name}}}`, label: v.label ?? v.name, type: v.type })),
  ]
}

/** Placeholder-menu options (VariableInput `extraVariables`): "Parameters" and "Variables" groups, typed. */
export function contextVariableOptions(layout: unknown, options: { variables?: boolean } = {}): Array<{ name: string; group: string; label: string }> {
  const type = (t: FormVariableType) => FORM_PARAM_TYPE_LABELS[t].toLowerCase()
  return [
    ...layoutFormParams(layout).map((p) => ({ name: `param.${p.name}`, group: 'Parameters', label: `${p.label ?? p.name} · ${type(p.type)}` })),
    ...(options.variables === false ? [] : layoutFormVariables(layout).map((v) => ({ name: `var.${v.name}`, group: 'Variables', label: `${v.label ?? v.name} · ${type(v.type)}` }))),
  ]
}

/** Workflow data picker entries for what a submission carries (included params / variables). */
export function includedContextSchema(layout: unknown, fieldKeys: Iterable<string> = []): Array<{ key: string; label: string; type: ReturnType<typeof formContextSchemaType>; kind: 'param' | 'var' }> {
  const taken = new Set(fieldKeys)
  return [
    ...layoutFormParams(layout).filter((p) => p.include && !taken.has(p.name)).map((p) => ({ key: p.name, label: p.label ?? p.name, type: formContextSchemaType(p.type), kind: 'param' as const })),
    ...layoutFormVariables(layout).filter((v) => v.include && !taken.has(v.name)).map((v) => ({ key: v.name, label: v.label ?? v.name, type: formContextSchemaType(v.type), kind: 'var' as const })),
  ]
}

/** Designer problems with the declarations (empty = fine). */
export function formContextProblems(layout: unknown, fieldKeys: Iterable<string>): string[] {
  const keys = new Set(fieldKeys)
  const params = layoutFormParams(layout)
  const variables = layoutFormVariables(layout)
  const out: string[] = []
  for (const p of params) {
    if (keys.has(p.name) && p.include) out.push(`Parameter "${p.name}" has the same name as a field: it is not included in the submission`)
    if (p.default !== undefined) {
      const r = coerceFormContextValue(p.type, p.default)
      const problem = 'error' in r ? r.error : formParamConstraintError(p, r.value)
      if (problem) out.push(`Parameter "${p.name}": the default ${problem}`)
    }
    if (typeof p.min === 'number' && typeof p.max === 'number' && p.min > p.max) out.push(`Parameter "${p.name}": minimum is greater than maximum`)
    if (typeof p.min === 'string' && typeof p.max === 'string' && p.min > p.max) out.push(`Parameter "${p.name}": earliest date is after the latest`)
  }
  for (const v of variables) {
    if (keys.has(v.name) && v.include) out.push(`Variable "${v.name}" has the same name as a field: it is not included in the submission`)
    if (v.initial?.kind === 'param' && !params.some((p) => p.name === v.initial!.value)) out.push(`Variable "${v.name}": its initial value names a parameter "${v.initial.value}" the form doesn't have`)
  }
  return out
}

/** Parameter / variable names a text reads ({{param.x}} → param:x, {{var.y}} → var:y). */
export function contextReferences(text: string | undefined): Array<{ kind: 'param' | 'var' | 'control'; name: string }> {
  const out: Array<{ kind: 'param' | 'var' | 'control'; name: string }> = []
  for (const m of String(text ?? '').matchAll(TEMPLATE_RE)) {
    const hit = /^(param|var|control)\.([a-z0-9_]+)/.exec(m[1])
    if (hit && !out.some((r) => r.kind === hit[1] && r.name === hit[2])) out.push({ kind: hit[1] as 'param' | 'var' | 'control', name: hit[2] })
  }
  return out
}

/* ── Links ──────────────────────────────────────────────────────────── */

/** A form page link with parameter values (URL parameters only; blanks left out; lists comma-joined). */
export function formUrlWithParams(base: string, params: FormParam[], values: Record<string, string>): string {
  const query = new URLSearchParams()
  for (const p of params) {
    if (p.source !== 'url') continue
    const v = String(values[p.name] ?? '').trim()
    if (v) query.set(p.query_name ?? p.name, v)
  }
  const qs = query.toString()
  if (!qs) return base
  return `${base}${base.includes('?') ? '&' : '?'}${qs}`
}

/** Required parameters with no default: a form with any can't be opened without them (e.g. from the Forms menu). */
export function requiredParamsWithoutDefault(layout: unknown): FormParam[] {
  return layoutFormParams(layout).filter((p) => p.required && paramDefault(p) === null)
}

/* ── Embedding contexts ─────────────────────────────────────────────── */

/**
 * A User Task step's "Form parameters" mapping (node config `form_params`:
 * parameter name → a workflow template such as `{{customer_id}}`), resolved
 * when the task is created and re-parsed against the form's declarations.
 * Stored on the task (`metadata.form_params`): the server's only source of
 * a task form's parameters.
 */
export function resolveContextParams(layout: unknown, mapping: unknown, resolve: (template: string) => unknown): Record<string, unknown> {
  const params = layoutFormParams(layout)
  if (!params.length) return {}
  const raw: Record<string, unknown> = {}
  if (isPlainObject(mapping)) {
    for (const p of params) {
      const template = mapping[p.name]
      if (typeof template !== 'string' || !template.trim()) continue
      const v = resolve(template)
      if (v !== undefined && v !== null && v !== '') raw[p.name] = typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v
    }
  }
  return parseFormParams(params, raw).values
}

/** `{{param.<name>}}` in a text replaced by the parameters' values (defaults at task creation; other placeholders kept). */
export function substituteParams(text: string, params: Record<string, unknown>): string {
  if (typeof text !== 'string' || !text.includes('{{')) return text
  return text.replace(/\{\{\s*param\.([a-z][a-z0-9_]*)\s*\}\}/g, (_m, name: string) => {
    const v = params[name]
    return v === undefined || v === null ? '' : Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  })
}
