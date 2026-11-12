/**
 * What a form rule's data / API action writes into the form (its saved
 * `outputs`; lib/forms/data-actions.ts): fields, Labels, read-only fields a
 * rule fills, List fields (rows from an array, per-column paths, replace or
 * append), a choice's options and form variables — on the server.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { valueAtPath } from '@/lib/response-schema'
import { DATA_TABLE_LIMITS } from './data-table'
import { coerceListRows, rawListRows, type ListFieldConfig } from './list-field'
import { coerceTaskFieldValues, isDisplayField, type TaskFieldDef } from '@/lib/task-field-schema'
import { parseFormVariables, type FormVariable } from './form-params'
import { DATA_ACTION_LIMITS, readActionResult, type ActionOutput, type RuleOption } from './data-actions'
import { asListField } from './repeating-section'

function bounded(v: unknown, max = 20_000): unknown {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v ?? null
  if (typeof v === 'string') return v.slice(0, 5000)
  try {
    const json = JSON.stringify(v)
    return json !== undefined && json.length <= max ? JSON.parse(json) : null
  } catch { return null }
}

export interface MappedOutputs {
  /** Field values (declared fields; typed). Lists: the rows. */
  values: Record<string, unknown>
  /** Variables (declared; typed). */
  vars: Record<string, unknown>
  /** Choice options loaded into fields. */
  options: Record<string, RuleOption[]>
}

/** Rows for a List from an array of items: each column from its path (default: the same name), typed by the list. */
export function itemsToListRows(config: ListFieldConfig, items: unknown, columns?: Record<string, string>): Record<string, unknown>[] {
  const list = Array.isArray(items) ? items : isPlainObject(items) ? [items] : []
  const rows = list.slice(0, DATA_ACTION_LIMITS.listRows).map((item) => {
    const row: Record<string, unknown> = {}
    for (const column of config.columns) {
      if (column.type === 'calculated') continue
      const path = columns?.[column.key] ?? column.key
      const v = isPlainObject(item) || Array.isArray(item) ? valueAtPath(item, path) : column === config.columns[0] ? item : undefined
      if (v !== undefined) row[column.key] = v
    }
    return row
  })
  return coerceListRows(config, rows)
}

/** Options from an array: each item's value / label path (default: the item itself, or value / label / name / id). */
export function itemsToOptions(items: unknown, valuePath?: string, labelPath?: string): RuleOption[] {
  const list = Array.isArray(items) ? items : []
  const out: RuleOption[] = []
  for (const item of list.slice(0, DATA_TABLE_LIMITS.options)) {
    const pick = (path: string | undefined, fallbacks: string[]) => {
      if (path) return valueAtPath(item, path)
      if (!isPlainObject(item)) return item
      for (const f of fallbacks) if (item[f] !== undefined && item[f] !== null) return item[f]
      return undefined
    }
    const value = pick(valuePath, ['value', 'id', 'row_id', 'key', 'name'])
    if (value === undefined || value === null || value === '' || typeof value === 'object') continue
    const label = pick(labelPath, ['label', 'name', 'title'])
    const v = String(value).slice(0, 200)
    if (out.some((o) => o.value === v)) continue
    out.push({ value: v, label: label === undefined || label === null || typeof label === 'object' ? v : String(label).slice(0, 200) })
  }
  return out
}

/**
 * Apply an action's outputs to its result — on the server, from the SAVED
 * action. Writes only declared fields (inputs, Labels, read-only fields a
 * rule fills, Lists) and declared variables, each typed; options only into
 * choice / multi-select fields. `current`: the form's values (append mode).
 */
export function mapActionOutputs(result: unknown, outputs: ActionOutput[] | undefined, fields: TaskFieldDef[], variables: FormVariable[], current: Record<string, unknown> = {}): MappedOutputs {
  // A repeating section takes rows like a List (lib/forms/repeating-section.ts asListField: its items).
  const byKey = new Map(fields.map(asListField).filter((f) => !isDisplayField(f) && f.type !== 'data_table' && f.type !== 'attachments' && f.type !== 'image' && f.type !== 'signature' && f.type !== 'custom').map((f) => [f.key, f]))
  const raw: Record<string, unknown> = {}
  const rawVars: Record<string, unknown> = {}
  const options: Record<string, RuleOption[]> = {}
  const listValues: Record<string, unknown> = {}
  for (const o of outputs ?? []) {
    let value = readActionResult(result, o.path)
    // A list result read by a row's field (`name` of the rows): the first row's (TOP 1 — filters and sort pick it).
    if (value === undefined && Array.isArray(result) && o.path && !o.path.startsWith('[')) value = readActionResult(result[0], o.path)
    if (value === undefined) continue
    if (o.to.startsWith('var.')) { if (variables.some((v) => v.name === o.to.slice(4))) rawVars[o.to.slice(4)] = bounded(value); continue }
    const field = byKey.get(o.to)
    if (!field) continue
    if (o.as === 'options') {
      if (field.type === 'choice' || field.type === 'multi_choice') options[field.key] = itemsToOptions(value, o.value_path, o.label_path)
      continue
    }
    if (field.type === 'list' && field.list) {
      const rows = itemsToListRows(field.list, value, o.columns)
      const base = o.mode === 'append' ? coerceListRows(field.list, current[field.key] ?? listValues[field.key]) : []
      const limit = field.list.max_rows ?? 500
      listValues[field.key] = [...rawListRows(base), ...rows].slice(0, limit)
      continue
    }
    // A single-value target given a list: its first item (TOP 1).
    if (Array.isArray(value) && field.type !== 'multi_choice' && !(field.type === 'lookup' && field.lookup?.multiple)) value = value[0] ?? null
    const b = bounded(value)
    raw[field.key] = b !== null && typeof b === 'object' && field.type !== 'multi_choice' && !(field.type === 'lookup' && field.lookup?.multiple) ? JSON.stringify(b) : b
  }
  const values = { ...coerceTaskFieldValues([...byKey.values()].filter((f) => f.key in raw), raw) as Record<string, unknown>, ...listValues }
  const vars = Object.keys(rawVars).length ? parseFormVariables(variables, rawVars) : {}
  return { values, vars, options }
}

/** Designer / save problems of an action's outputs. */
export function outputProblems(outputs: ActionOutput[] | undefined, known: { fields: TaskFieldDef[]; variables: string[] }): string[] {
  const out: string[] = []
  const byKey = new Map(known.fields.map((f) => [f.key, asListField(f)]))
  for (const o of outputs ?? []) {
    if (o.to.startsWith('var.')) { if (!known.variables.includes(o.to.slice(4))) out.push(`"${o.to}" is not a variable of this form`); continue }
    const field = byKey.get(o.to)
    if (!field) { out.push(`"${o.to}" is not a field of this form`); continue }
    if (o.as === 'options' && field.type !== 'choice' && field.type !== 'multi_choice') out.push(`options go into a single or multi-select ("${field.label || o.to}" is not one)`)
    else if (isDisplayField(field) || field.type === 'data_table' || field.type === 'attachments' || field.type === 'image' || field.type === 'signature' || field.type === 'custom') out.push(`"${field.label || o.to}" can't take a value from a result`)
    else if (field.type === 'list') {
      const columns = new Set((field.list?.columns ?? []).map((c) => c.key))
      const bad = Object.keys(o.columns ?? {}).find((c) => !columns.has(c))
      if (bad) out.push(`the List "${field.label || o.to}" has no column "${bad}"`)
    }
  }
  return out
}

