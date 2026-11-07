/**
 * "Call an API reference" (a form rule's server action): what the response
 * writes into the form — the "Then map the response" table.
 *
 *   results: { <response path>: <field key> | var.<name> }
 *
 * Paths read the response BODY (what Data tables, lookups and Loops read):
 * `name`, `data.address.city`, `[0].name` / `items[0].id` (an array's item),
 * `@odata.count` (a key with dots). Empty = the whole response.
 *
 * Security: the server does the mapping (lib/services/form-rule-actions.ts).
 * Only fields the saved rule maps, that are declared, editable value fields,
 * are written, each converted to the field's type; `var.<name>` only for a
 * declared variable, typed like any request's variables. A path the response
 * doesn't have writes nothing (the field keeps its value).
 *
 * Pure and isomorphic: the designer uses the same paths, types and checks.
 */

import { splitPath, valueAtPath, type SchemaNode } from '@/lib/response-schema'
import { unwrapExecutorResult } from '@/lib/response-collections'
import { coerceTaskFieldValues, isDisplayField, type TaskFieldDef, type TaskFieldType } from '@/lib/task-field-schema'
import { parseFormVariables, type FormVariable } from './form-params'
import type { FieldButtonAction } from './field-buttons'
import { FORBIDDEN_RESULT_SEGMENTS as FORBIDDEN, RESULT_SEGMENT_RE, isResultPath } from './result-paths'

export { RESULT_PATH_RE, isResultPath, normalizeResultPath } from './result-paths'

/** The value at a mapped path of a reference's response (the body), or undefined when it has none. */
export function readResultPath(data: unknown, path: string): unknown {
  if (!isResultPath(path)) return undefined
  const body = unwrapExecutorResult(data)
  if (!path) return body
  for (const segment of splitPath(path)) if (FORBIDDEN.has(segment)) return undefined
  return valueAtPath(body, path)
}

/** A response value as a form value: scalars as they are, objects / arrays as JSON (bounded). */
function boundedValue(v: unknown): unknown {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v === 'string') return v.slice(0, 5000)
  try {
    const json = JSON.stringify(v)
    return json !== undefined && json.length <= 20_000 ? JSON.parse(json) : null
  } catch { return null }
}

const SCALAR_TYPES: ReadonlySet<TaskFieldType> = new Set(['text', 'textarea', 'email', 'phone', 'url', 'choice', 'number', 'currency', 'date', 'datetime', 'rich_text', 'lookup'] as TaskFieldType[])

export interface MappedResults {
  /** Field values (declared, editable, mapped; typed). */
  values: Record<string, unknown>
  /** Variables (declared, mapped; typed). */
  vars: Record<string, unknown>
}

/**
 * Apply a rule's response mapping on the server: `results` from the SAVED
 * rule, `fields` the form's declared fields, `variables` its declared
 * variables. Read-only and display fields, undeclared keys and missing
 * paths write nothing.
 */
export function mapReferenceResults(data: unknown, results: Record<string, string> | undefined, fields: TaskFieldDef[], variables: FormVariable[]): MappedResults {
  const writable = new Map(fields.filter((f) => !f.read_only && !isDisplayField(f) && f.type !== 'data_table' && f.type !== 'attachments').map((f) => [f.key, f]))
  const raw: Record<string, unknown> = {}
  const rawVars: Record<string, unknown> = {}
  for (const [path, key] of Object.entries(results ?? {})) {
    const value = readResultPath(data, path)
    if (value === undefined) continue
    const bounded = boundedValue(value)
    if (key.startsWith('var.')) { if (variables.some((v) => v.name === key.slice(4))) rawVars[key.slice(4)] = bounded; continue }
    const field = writable.get(key)
    if (!field) continue
    // An object into a text-like field reads as its JSON text, not "[object Object]".
    raw[key] = bounded !== null && typeof bounded === 'object' && SCALAR_TYPES.has(field.type) && !(field.type === 'lookup' && field.lookup?.multiple) ? JSON.stringify(bounded) : bounded
  }
  const values = coerceTaskFieldValues([...writable.values()].filter((f) => f.key in raw), raw) as Record<string, unknown>
  const vars = Object.keys(rawVars).length ? parseFormVariables(variables, rawVars) : {}
  return { values, vars }
}

/* ── Designer: the response's paths, typed ─────────────────────────── */

export interface ResultPathOption {
  path: string
  type: SchemaNode['type']
  example?: unknown
  /** Nesting level (indent in the picker). */
  level: number
}

/**
 * The values a response model offers for mapping: every field at any depth
 * (objects walked, a list's first item as `[0]`), bounded. Lists and objects
 * are offered too (a variable of type Row / object, or a JSON text field).
 */
export function resultPathOptions(root: SchemaNode | null | undefined, limits: { depth?: number; max?: number } = {}): ResultPathOption[] {
  const depth = limits.depth ?? 5
  const max = limits.max ?? 150
  const out: ResultPathOption[] = []
  const walk = (node: SchemaNode, prefix: string, level: number) => {
    if (out.length >= max || level > depth) return
    if (node.type === 'array' && node.items && (node.items.type === 'object' || node.items.type === 'array')) {
      walk(node.items, `${prefix}[0]`, level)
      return
    }
    for (const field of node.type === 'object' ? node.fields ?? [] : []) {
      if (out.length >= max) return
      if (FORBIDDEN.has(field.name) || !RESULT_SEGMENT_RE.test(field.name)) continue
      const path = prefix ? `${prefix}.${field.name}` : field.name
      out.push({ path, type: field.type, level, ...(field.example !== undefined ? { example: field.example } : {}) })
      if (field.type === 'object' || field.type === 'array') walk(field, path, level + 1)
    }
  }
  if (root) walk(root, '', 0)
  return out
}

/** A designer note when a response value doesn't suit the target (null = fine). */
/** `target`: a field type, or `var:<variable type>`. */
export function resultTypeNote(source: SchemaNode['type'] | undefined, target: string | undefined): string | null {
  if (!source || !target || source === 'any' || source === 'null') return null
  const t = target.startsWith('var:') ? target.slice(4) : target
  const structured = source === 'object' || source === 'array'
  if (structured) {
    if (t === 'object' || t === 'text_list' || t === 'multi_choice' || t === 'json') return null
    return `a ${source === 'array' ? 'list' : 'object'} — it is written as JSON text`
  }
  if ((t === 'number' || t === 'currency') && source !== 'number' && source !== 'integer') return `a ${source} — it is converted to a number (empty when it isn't one)`
  if ((t === 'boolean') && source !== 'boolean') return `a ${source} — it is converted to yes / no`
  if ((t === 'date' || t === 'datetime') && source !== 'string') return `a ${source} — dates are read from text like 2026-11-04`
  if (t === 'object' || t === 'text_list') return `a ${source}, not a ${t === 'object' ? 'row / object' : 'list'}`
  return null
}

/** Problems with a call_reference action's response mapping (designer + save), given the form's declarations. */
export function resultMappingProblems(results: Record<string, string> | undefined, known: { fields: TaskFieldDef[]; variables: string[] }): string[] {
  const out: string[] = []
  const byKey = new Map(known.fields.map((f) => [f.key, f]))
  for (const [path, key] of Object.entries(results ?? {})) {
    if (!isResultPath(path)) out.push(`"${path}" is not a response path (e.g. data.name, items[0].id)`)
    if (key.startsWith('var.')) { if (!known.variables.includes(key.slice(4))) out.push(`"${key}" is not a variable of this form`); continue }
    const field = byKey.get(key)
    if (!field) out.push(`"${key}" is not a field of this form`)
    else if (isDisplayField(field) || field.type === 'data_table' || field.type === 'attachments') out.push(`"${field.label || key}" can't take an API value`)
  }
  return out
}

/** Suggested mappings: response fields whose name matches a form field / variable (`name` → `customer_name`, `email` → `email`). */
export function suggestResultMappings(options: ResultPathOption[], targets: Array<{ value: string; label: string }>, taken: Record<string, string> = {}): Record<string, string> {
  const used = new Set(Object.values(taken))
  const out: Record<string, string> = {}
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '')
  for (const option of options) {
    if (option.type === 'object' || option.type === 'array' || option.path in taken) continue
    const leaf = option.path.split('.').pop()!.replace(/\[\d+\]/g, '')
    const n = norm(leaf)
    if (!n) continue
    const target = targets.find((t) => {
      if (used.has(t.value)) return false
      const key = norm(t.value.replace(/^var\./, ''))
      return key === n || norm(t.label) === n || (key.endsWith(n) && n.length >= 4)
    })
    if (target) { out[option.path] = target.value; used.add(target.value) }
  }
  return out
}

/**
 * The "Prefill from a URL parameter via an API" rule template: When Form
 * loads, If param.<name> is not empty, Then Call an API reference (the
 * author picks the reference; an input of the same name is mapped to the
 * parameter) with a "couldn't find" message on failure.
 */
export function prefillRuleTemplate(param: { name: string; label?: string }, id: string) {
  return {
    id,
    name: `Prefill from ${param.label ?? param.name}`,
    event: 'form_load' as const,
    if: { match: 'all' as const, conditions: [{ column: `param.${param.name}`, operator: 'is_set' as const }] },
    then: [{ type: 'call_reference' as const, error_text: `We couldn't find {{param.${param.name}}}` }],
  }
}

/**
 * What the browser does when a rule's call fails (the action's "If the call
 * fails"): `ignore` — nothing shown, nothing written, the rule goes on;
 * otherwise the author's message (placeholders filled by `fill`) or the
 * service's own.
 */
export function callReferenceFailure(action: Pick<FieldButtonAction, 'on_error' | 'error_text'>, error: unknown, fill: (text: string) => unknown): { ignore: true } | { message: string } {
  if (action.on_error === 'ignore') return { ignore: true }
  if (action.error_text) {
    const text = fill(action.error_text)
    if (text !== null && text !== undefined && String(text).trim()) return { message: String(text) }
  }
  return { message: error instanceof Error && error.message ? error.message : 'That step could not run' }
}
