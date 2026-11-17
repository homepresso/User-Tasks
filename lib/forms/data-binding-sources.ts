/**
 * Data binding for core sources (lib/forms/data-binding.ts): a Data table's
 * columns and an API reference's response fields as the designer contract's
 * source fields (FormTargetSourceField — the same shape an extension's form
 * target `describe` returns), and the core side of `describe` / `bind`:
 *
 *  - describeCoreBinding  the binding as a FormTargetDescription (title,
 *                         facts, source fields, the mapping, notes);
 *  - bindCoreBinding      a mapping change / source fields added → the new
 *                         binding and the new form fields (bound, typed and
 *                         labelled from the source).
 *
 * So the designer's Data panel has one code path for every source: it lists
 * `sourceFields`, shows `mappings`, and calls bind({ add | mappings }).
 *
 * Pure and isomorphic (the server loads the table / reference row).
 */

import type { FormTargetDescription, FormTargetMapping, FormTargetSourceField } from '@/lib/extensions/sdk'
import { resultPathOptions } from './reference-results'
import { referenceResponseSchema, type SchemaNode } from '@/lib/response-schema'
import { runtimeView } from '@/lib/response-collections'
import { columnKey } from '@/lib/data-table-cells'
import { fieldKeyFromLabel, uniqueFieldKey, type TaskFieldDef, type TaskFieldType } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { bindingCapabilities, type FormDataBinding } from './data-binding'

/** A core source, ready for describe / bind. */
export interface CoreSource {
  /** "Data table "Customers"". */
  title: string
  label: string
  link?: { label: string; url: string } | null
  fields: FormTargetSourceField[]
  /** Extra field settings per source key (e.g. a lookup column's lookup config). */
  templates: Record<string, Partial<TaskFieldDef>>
}

export class DataBindingError extends Error {
  constructor(message: string, readonly fields: Record<string, string> = {}) {
    super(message)
    this.name = 'DataBindingError'
  }
}

/** "customer_name" / "customerName" / "data.billing.zip" → "Customer name" / "Billing zip". */
export function humanizeSourceKey(key: string): string {
  const parts = key.replace(/\[\d+\]/g, '').split('.').filter(Boolean)
  const leaf = parts.slice(-2).join(' ') || key
  const words = leaf.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.@$]+/g, ' ').trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : key
}

/* ── Data tables ───────────────────────────────────────────────────── */

const TABLE_TYPES: Record<string, { types: TaskFieldType[]; label: string }> = {
  text: { types: ['text', 'textarea', 'email', 'phone', 'url'], label: 'Text' },
  longtext: { types: ['textarea', 'rich_text', 'text'], label: 'Long text' },
  number: { types: ['number', 'currency'], label: 'Number' },
  date: { types: ['date', 'datetime'], label: 'Date' },
  datetime: { types: ['datetime', 'date'], label: 'Date and time' },
  boolean: { types: ['boolean'], label: 'Yes / no' },
  select: { types: ['choice', 'text'], label: 'Select' },
  choice: { types: ['choice', 'text'], label: 'Select' },
  lookup: { types: ['lookup', 'text'], label: 'Lookup' },
  file: { types: [], label: 'File' },
}

const TABLE_SYSTEM_COLUMNS: Record<string, { types: TaskFieldType[]; help: string }> = {
  id: { types: ['number', 'text'], help: 'The row\'s number (set by UserTasks).' },
  date_created: { types: ['date', 'text'], help: 'When the row was added (set by UserTasks).' },
}

/** A Data table (custom_tables row: id, name, columns) → its columns as source fields (the table's own id / date columns and the row id as read-only system fields). */
export function tableSource(table: { id: string; name?: string | null; columns?: unknown }): CoreSource {
  const label = String(table.name ?? '').trim() || 'Data table'
  const raw = Array.isArray(table.columns) ? table.columns.filter(isPlainObject) : []
  const fields: FormTargetSourceField[] = []
  const templates: CoreSource['templates'] = {}
  for (const def of raw) {
    // Columns made before keys existed are stored under the slug of their name.
    const key = columnKey({ key: typeof def.key === 'string' ? def.key : undefined, name: String(def.name ?? def.label ?? '') } as never)
    if (!key) continue
    const col = { key, label: String(def.label ?? def.name ?? key), type: String(def.type ?? 'text') }
    const kind = TABLE_TYPES[col.type] ?? TABLE_TYPES.text
    const lookup = isPlainObject(def.lookup) ? def.lookup : null
    const choices = Array.isArray(def.options) ? def.options.filter((o): o is string => typeof o === 'string') : undefined
    // The table's own columns: the auto-number and the creation date (set by UserTasks, never written by a form).
    const system = TABLE_SYSTEM_COLUMNS[col.key]
    if (system) {
      fields.push({ key: col.key, label: col.label || system.help, typeLabel: kind.label, fieldTypes: system.types, readOnly: true, group: 'system', help: system.help })
      continue
    }
    fields.push({
      key: col.key, label: col.label || humanizeSourceKey(col.key), typeLabel: kind.label, fieldTypes: kind.types,
      group: lookup ? 'lookups' : 'columns',
      ...(def.required === true ? { required: true } : {}),
      ...(choices?.length ? { choices } : {}),
      ...(lookup ? { lookup: String(lookup.sourceTableName ?? 'another table') } : {}),
      ...(col.type === 'file' ? { help: 'File columns can\'t be bound to a form field yet.' } : {}),
    })
    if (lookup && typeof lookup.sourceTableId === 'string' && lookup.sourceColumn) {
      const column = String(lookup.sourceColumn)
      templates[col.key] = { lookup: { source: 'table', table_id: lookup.sourceTableId, search_columns: [column], display_columns: [column], value_column: column } }
    }
  }
  fields.push({ key: 'row_id', label: 'Row id', typeLabel: 'Row id', fieldTypes: ['text'], readOnly: true, group: 'system', help: 'The row\'s own id (set by UserTasks).' })
  return { title: `Data table "${label}"`, label, link: { label: 'Open the table', url: `/data/${table.id}` }, fields, templates }
}

/* ── API references ────────────────────────────────────────────────── */

function stringTypes(path: string, node: Pick<SchemaNode, 'format' | 'example'>): TaskFieldType[] {
  const leaf = path.split('.').pop()?.toLowerCase() ?? ''
  const example = typeof node.example === 'string' ? node.example : ''
  if (node.format === 'email' || /e-?mail/.test(leaf)) return ['email', 'text']
  if (node.format === 'date-time' || /^\d{4}-\d{2}-\d{2}T/.test(example)) return ['datetime', 'date', 'text']
  if (node.format === 'date' || /(^|_)(date|dob|birthday)$|_on$/.test(leaf) || /^\d{4}-\d{2}-\d{2}$/.test(example)) return ['date', 'text']
  if (node.format === 'uri' || /(^|_)(url|link|website)$/.test(leaf) || /^https?:\/\//.test(example)) return ['url', 'text']
  if (/phone|mobile/.test(leaf)) return ['phone', 'text']
  if (/description|notes?|comments?|body$/.test(leaf)) return ['textarea', 'text']
  return ['text', 'textarea']
}

const STRING_LABELS: Partial<Record<TaskFieldType, string>> = { email: 'Email', date: 'Date', datetime: 'Date and time', url: 'Link', phone: 'Phone', textarea: 'Long text' }

/** An API reference (integration_references row) → its response fields (record schema or declared outputs) as source fields. */
export function referenceSource(ref: { id: string; name?: string | null; request_config?: unknown; outputs?: unknown; integration?: { name?: string | null } | null }): CoreSource {
  const label = String(ref.name ?? '').trim() || 'API reference'
  const model = referenceResponseSchema(ref as never)
  const root = model ? runtimeView(model).root : null
  const fields: FormTargetSourceField[] = []
  for (const option of resultPathOptions(root && root.type !== 'any' ? root : null, { depth: 4, max: 200 })) {
    let types: TaskFieldType[]
    let typeLabel: string
    switch (option.type) {
      case 'number': case 'integer': types = ['number', 'currency', 'text']; typeLabel = 'Number'; break
      case 'boolean': types = ['boolean', 'text']; typeLabel = 'Yes / no'; break
      case 'string': types = stringTypes(option.path, { example: option.example as SchemaNode['example'] }); typeLabel = STRING_LABELS[types[0]] ?? 'Text'; break
      case 'array': types = ['text_list']; typeLabel = 'List'; break
      case 'object': types = []; typeLabel = 'Object'; break
      default: types = ['text']; typeLabel = 'Value'
    }
    fields.push({
      key: option.path, label: humanizeSourceKey(option.path), typeLabel, fieldTypes: types,
      group: option.path.includes('.') || option.path.includes('[') ? 'nested' : 'fields',
      ...(option.type === 'object' ? { help: 'An object: bind its fields instead.' } : option.type === 'array' ? { multi: true } : {}),
      ...(option.example !== undefined && option.example !== null ? { help: `e.g. ${String(option.example).slice(0, 60)}` } : {}),
    })
  }
  return { title: `API reference "${label}"${ref.integration?.name ? ` (${ref.integration.name})` : ''}`, label, link: null, fields, templates: {} }
}

/* ── Fields from source fields ─────────────────────────────────────── */

/**
 * A new form field for a source field: the suggested type (or `type` when
 * the designer chose another the source accepts), labelled from the source,
 * required / read-only / choices / lookup carried over. Null when the source
 * field can't be bound.
 */
export function fieldForSource(source: FormTargetSourceField, taken: Iterable<string>, options: { type?: TaskFieldType; template?: Partial<TaskFieldDef> } = {}): TaskFieldDef | null {
  const type = options.type && source.fieldTypes.includes(options.type) ? options.type : source.fieldTypes[0]
  if (!type) return null
  const base = fieldKeyFromLabel(source.label) || fieldKeyFromLabel(humanizeSourceKey(source.key)) || 'field'
  const field: TaskFieldDef = { key: uniqueFieldKey(base, taken), label: source.label.slice(0, 200), type }
  if (source.readOnly) field.read_only = true
  else if (source.required) field.required = true
  if (source.help && !/^e\.g\. /.test(source.help)) field.help_text = source.help
  if ((type === 'choice' || type === 'multi_choice') && source.choices?.length) field.options = [...source.choices]
  else if (type === 'choice' || type === 'multi_choice') field.options = ['Option 1', 'Option 2']
  if (type === 'currency') field.currency = 'USD'
  if (type === 'lookup') field.lookup = { source: 'table' }
  if (options.template) Object.assign(field, structuredClone(options.template))
  if (type !== 'lookup') delete field.lookup
  return field
}

/* ── describe / bind for core sources ──────────────────────────────── */

/** The binding as the designer contract's description (one code path with extension targets). */
export function describeCoreBinding(binding: FormDataBinding, source: CoreSource, formFields: Array<Pick<TaskFieldDef, 'key' | 'label' | 'type'>>): FormTargetDescription {
  const byKey = new Map(source.fields.map((f) => [f.key, f]))
  const caps = bindingCapabilities(binding)
  const keys = new Set(formFields.map((f) => f.key))
  const mappings: FormTargetMapping[] = formFields.map((f) => {
    const mapped = binding.fields[f.key] ?? null
    const note = mapped && !byKey.has(mapped) ? `"${mapped}" is no longer in the source` : null
    return { field: f.key, source: mapped, ...(note ? { note } : {}) }
  })
  const notes: FormTargetDescription['notes'] = []
  for (const [key, mapped] of Object.entries(binding.fields)) {
    if (keys.has(key) && !byKey.has(mapped)) notes.push({ severity: 'warning', message: `"${formFields.find((f) => f.key === key)?.label || key}" is bound to "${mapped}", which ${binding.kind === 'table' ? 'the table no longer has' : 'the reference\'s response model no longer has'}.` })
  }
  if (binding.kind === 'reference') notes.push({ severity: 'info', message: 'Read only: the response prefills the bound fields; saving back to an API reference is not supported.' })
  if (binding.kind === 'reference' && !source.fields.length) notes.push({ severity: 'warning', message: 'This reference has no response model yet: load a sample on the reference (Integrations) to list its fields.' })
  if (binding.kind === 'table' && binding.save) {
    const missing = source.fields.filter((f) => f.required && !f.readOnly && !Object.values(binding.fields).includes(f.key))
    if (missing.length) notes.push({ severity: 'warning', message: `The table requires ${missing.map((f) => `"${f.label}"`).join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not on the form: new rows may fail.` })
  }
  return {
    title: source.title,
    link: source.link ?? null,
    facts: [
      { label: 'Loads', value: caps.loads },
      { label: 'Saves', value: caps.saves },
    ],
    sourceFields: source.fields,
    mappings,
    notes,
  }
}

export interface CoreBindInput {
  mappings?: Array<{ field: string; source: string | null }>
  add?: string[]
  /** add: the field type to create for each source key (when not the suggested one). */
  types?: Record<string, TaskFieldType>
}

/**
 * A mapping change and / or source fields added → the new binding and the
 * new fields (keys unique against the form's). A mapping to a source field
 * the form field's type can't hold is refused (per field).
 */
export function bindCoreBinding(binding: FormDataBinding, source: CoreSource, formFields: Array<Pick<TaskFieldDef, 'key' | 'type'>>, input: CoreBindInput): { binding: FormDataBinding; fields: TaskFieldDef[] } {
  const byKey = new Map(source.fields.map((f) => [f.key, f]))
  const formByKey = new Map(formFields.map((f) => [f.key, f]))
  const next: Record<string, string> = { ...binding.fields }
  const errors: Record<string, string> = {}
  for (const m of input.mappings ?? []) {
    const field = formByKey.get(m.field)
    if (!field) continue
    if (m.source === null || m.source === '') { delete next[m.field]; continue }
    const src = byKey.get(m.source)
    if (!src) { errors[m.field] = `"${m.source}" is not a field of ${source.label}`; continue }
    if (!src.fieldTypes.includes(field.type)) { errors[m.field] = src.fieldTypes.length ? `${src.label} (${src.typeLabel}) can't go in this field type: use ${src.fieldTypes.join(', ')}` : `${src.label} can't be bound`; continue }
    next[m.field] = src.key
  }
  if (Object.keys(errors).length) throw new DataBindingError(Object.values(errors)[0], errors)
  const taken = new Set(formFields.map((f) => f.key))
  const added: TaskFieldDef[] = []
  const already = new Set(Object.values(next))
  for (const key of input.add ?? []) {
    const src = byKey.get(key)
    if (!src || already.has(key)) continue
    const field = fieldForSource(src, taken, { type: input.types?.[key], template: source.templates[key] })
    if (!field) continue
    taken.add(field.key)
    already.add(key)
    next[field.key] = src.key
    added.push(field)
  }
  return { binding: { ...binding, fields: next }, fields: added }
}

/** A declared URL parameter that looks like a row id (`row_id` / `record_id`), for a table binding's loads. */
export function defaultRecordParam(layout: unknown): string | null {
  const params = isPlainObject(layout) && Array.isArray(layout.params) ? layout.params.filter(isPlainObject) : []
  const row = params.find((p) => p.name === 'row_id' || p.name === 'record_id')
  return row ? String(row.name) : null
}
