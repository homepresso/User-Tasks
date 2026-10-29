/**
 * The workflow START form: the inputs a manual / API start fills in. They are
 * the workflow variables (user_variables, lib/workflow-inputs.ts); the form
 * designer edits them as fields and stores the grid and theme on the trigger
 * node's config as `start_form: { layout, theme }` (so it travels with the
 * published version, like every node config).
 *
 * Variables map to the field types workflow inputs support: text, number,
 * checkbox, date, date-time, email, URL, single select and attachments
 * (`{ type: 'array', format: 'attachments', attachments }`: a list of files). Object (JSON)
 * variables are left out of the designer and kept as they are. Variable
 * names are kept exactly (camelCase included) unless the author renames the
 * key in the designer. Pure.
 */

import { fieldKeyFromLabel, normalizeTaskFields, type TaskFieldDef, type TaskFieldType } from '@/lib/task-field-schema'
import { normalizeFormLayout, renameLayoutKey, type FormLayout } from './layout'
import { parseFormThemeRef, type FormThemeRef } from './form-theme'
import type { FormDefinition } from './definition'

/* eslint-disable @typescript-eslint/no-explicit-any -- user_variables and node config are loose JSON */

export const START_FORM_TYPES: TaskFieldType[] = ['text', 'number', 'boolean', 'date', 'datetime', 'email', 'url', 'choice', 'attachments']

export interface StartFormVariable {
  id?: string
  name: string
  type?: string
  defaultValue?: string
  description?: string
  required?: boolean
  format?: string
  options?: unknown
  label?: string
  [key: string]: unknown
}

export interface StartFormModel {
  def: FormDefinition
  /** Designer key → the variable name it came from. */
  nameByKey: Map<string, string>
}

function fieldTypeOf(variable: StartFormVariable): TaskFieldType | null {
  const type = String(variable.type ?? 'string').toLowerCase()
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'boolean') return 'boolean'
  if ((type === 'array' || type === 'attachments') && String(variable.format ?? '').toLowerCase() === 'attachments') return 'attachments'
  if (type === 'object' || type === 'array' || type === 'json') return null
  const format = String(variable.format ?? '').toLowerCase()
  if (format === 'date' || format === 'datetime' || format === 'email' || format === 'url') return format as TaskFieldType
  if (format === 'select') return 'choice'
  return 'text'
}

function optionsOf(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((o) => String((o as any)?.value ?? o ?? '').trim()).filter(Boolean)
  if (typeof raw === 'string') return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
  return []
}

/** The start form a workflow's variables (and trigger node) describe. */
export function startFormFromVariables(variables: StartFormVariable[] | null | undefined, triggerConfig: Record<string, any> | null | undefined): StartFormModel {
  const nameByKey = new Map<string, string>()
  const raw: Array<Record<string, unknown>> = []
  for (const variable of variables ?? []) {
    const name = String(variable?.name ?? '').trim()
    const type = fieldTypeOf(variable)
    if (!name || !type) continue
    const key = fieldKeyFromLabel(name) || name.toLowerCase()
    if (nameByKey.has(key)) continue
    nameByKey.set(key, name)
    raw.push({
      key,
      label: typeof variable.label === 'string' && variable.label.trim() ? variable.label : humanize(name),
      type,
      required: variable.required === true,
      help_text: variable.description,
      default: variable.defaultValue,
      placeholder: variable.placeholder,
      options: type === 'choice' ? optionsOf(variable.options) : undefined,
      attachments: type === 'attachments' ? variable.attachments : undefined,
    })
  }
  const fields = normalizeTaskFields(raw)
  const stored = triggerConfig?.start_form ?? {}
  // The stored layout references variable names: map them to designer keys.
  let layout: FormLayout | null = null
  if (stored.layout && Array.isArray(stored.layout.rows)) {
    let mapped: FormLayout = { rows: stored.layout.rows }
    for (const [key, name] of nameByKey) if (key !== name) mapped = renameLayoutKey(mapped, name, key)
    layout = normalizeFormLayout(mapped, fields.map((f) => f.key))
  }
  return { def: { fields, layout, theme: parseFormThemeRef(stored.theme) }, nameByKey }
}

function humanize(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim().toLowerCase()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name
}

/**
 * Variables after a start-form save: designed fields in grid order (existing
 * variables keep their id and any other settings), then the object
 * variables the designer doesn't show. Renamed keys rename the variable.
 */
export function variablesFromStartForm(def: FormDefinition, previous: StartFormVariable[], nameByKey: Map<string, string>, newId: () => string): StartFormVariable[] {
  const byName = new Map(previous.map((v) => [v.name, v]))
  const out: StartFormVariable[] = []
  for (const field of def.fields) {
    const name = nameByKey.get(field.key) ?? field.key
    const prev = byName.get(name)
    out.push(variableFor(field, name, prev, newId))
  }
  const kept = new Set(out.map((v) => v.name))
  for (const variable of previous) if (!fieldTypeOf(variable) && !kept.has(variable.name)) out.push(variable)
  return out
}

function variableFor(field: TaskFieldDef, name: string, prev: StartFormVariable | undefined, newId: () => string): StartFormVariable {
  const base: StartFormVariable = { ...(prev ?? {}), id: prev?.id ?? newId(), name }
  const typeInfo: Partial<StartFormVariable> =
    field.type === 'number' ? { type: 'number', format: undefined }
    : field.type === 'boolean' ? { type: 'boolean', format: undefined }
    : field.type === 'choice' ? { type: 'string', format: 'select', options: (field.options ?? []).join(', ') }
    : field.type === 'text' ? { type: 'string', format: prev?.format === 'text' ? 'text' : undefined }
    : field.type === 'attachments' ? { type: 'array', format: 'attachments', attachments: field.attachments ?? {} }
    : { type: 'string', format: field.type }
  const next: StartFormVariable = {
    ...base,
    ...typeInfo,
    label: field.label,
    description: field.help_text ?? '',
    defaultValue: field.default ?? '',
    required: field.required === true ? true : undefined,
  }
  if (field.type !== 'choice' && next.format !== 'select') delete next.options
  if (field.type !== 'attachments') delete next.attachments
  else next.defaultValue = ''
  if (field.placeholder) next.placeholder = field.placeholder
  else delete next.placeholder
  for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key]
  return next
}

/** The trigger node's `start_form` after a save: layout keyed by variable names; none when trivial. */
export function startFormConfig(def: FormDefinition, nameByKey: Map<string, string>): { layout?: FormLayout; theme?: FormThemeRef } | undefined {
  let layout = def.layout
  if (layout) {
    for (const field of def.fields) {
      const name = nameByKey.get(field.key) ?? field.key
      if (name !== field.key) layout = renameLayoutKey(layout, field.key, name)
    }
    const rows = layout.rows.filter((row) => row.cells.length)
    const trivial = rows.every((row) => row.columns === 1 && row.cells.length === 1)
    layout = trivial ? null : { rows }
  }
  const out: { layout?: FormLayout; theme?: FormThemeRef } = {}
  if (layout) out.layout = layout
  if (def.theme.source !== 'workspace') out.theme = def.theme
  return Object.keys(out).length ? out : undefined
}
