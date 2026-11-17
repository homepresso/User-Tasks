/**
 * Signatures that repeat: a Signature control inside a repeating section's
 * items, and a `signature` column of a List (any level — a List inside a
 * section, a List nested in a List). Each item / row holds the Signature
 * field's value (lib/forms/media-fields.ts SignatureValue) and is treated
 * exactly like a top-level signature: its PNG is an upload of the form
 * (lib/services/form-files.ts) re-read from the upload records on submit,
 * and its signer / time are stamped by the server
 * (lib/services/form-signatures.ts).
 *
 * Upload keys: an inner control of a section uploads under its own key
 * (inner keys are unique over the form); a List column under
 * `<list>.<column>` (`<list>.<child>.<column>` in nested Lists — listUploadKey).
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { findFieldDeep, innerFieldsDeep } from './repeating-section'
import { hasSignatureColumns, listSignatureColumns, listUploadKey, signatureColumnAt, type ListColumn, type ListFieldConfig } from './list-field'
import type { DataTableColumn, DataTableFieldConfig } from './data-table'

/* ── Data table signature cells (lib/grid/column-model.ts control `signature`) ── */

/** A Data table's signature columns (edit mode: each added / changed row signs its own cell). */
export function dataTableSignatureColumns(config: DataTableFieldConfig | undefined): DataTableColumn[] {
  if (!config || config.mode !== 'edit') return []
  return config.columns.filter((c) => c.control === 'signature' && !c.read_only && !c.hidden)
}

/** A Data table signature column as a Signature field (upload key `<table>.<column>`). */
export function signatureFieldForTableColumn(tableKey: string, column: DataTableColumn): TaskFieldDef {
  const field: TaskFieldDef = { key: `${tableKey}.${column.key}`, label: column.label, type: 'signature' }
  if (column.control_options?.signature) field.signature = column.control_options.signature
  if (column.required) field.required = true
  return field
}

/** A List signature column as a Signature field (its upload key, label, config) — what the upload pipeline and the checks read. */
export function signatureFieldForColumn(listKey: string, columnPath: string[], column: ListColumn): TaskFieldDef {
  const field: TaskFieldDef = { key: listUploadKey(listKey, columnPath), label: column.label, type: 'signature' }
  if (column.signature) field.signature = column.signature
  if (column.required) field.required = true
  return field
}

/**
 * The file control an upload key names: a form field, an inner control of a
 * repeating section (any level), or a List signature column
 * (`<list>.<column>`; the List at the top level or inside a section).
 * `repeated`: the control repeats (per item / row) — its uploads are not
 * capped per field. Null when the key names none.
 */
export function resolveFileControl(fields: TaskFieldDef[], key: string): { field: TaskFieldDef; repeated: boolean; list?: TaskFieldDef } | null {
  const raw = String(key ?? '')
  if (!raw.includes('.')) {
    const found = findFieldDeep(fields, raw)
    return found ? { field: found.field, repeated: found.sections.length > 0 } : null
  }
  const [listKey, ...path] = raw.split('.')
  const table = fields.find((f) => f.key === listKey && f.type === 'data_table')
  if (table) {
    const column = dataTableSignatureColumns(table.data_table).find((c) => c.key === path.join('.'))
    return column ? { field: signatureFieldForTableColumn(table.key, column), repeated: true, list: table } : null
  }
  if (!listKey || !path.length || path.some((p) => !/^[a-z][a-z0-9_]{0,63}$/.test(p))) return null
  const found = findFieldDeep(fields, listKey)
  if (!found || found.field.type !== 'list') return null
  const column = signatureColumnAt(found.field.list, path)
  if (!column) return null
  return { field: signatureFieldForColumn(listKey, path, column), repeated: true, list: found.field }
}

/** The upload key of every List signature column of a form (Lists at the top level and inside sections, any level). */
export function listSignatureUploadKeys(fields: TaskFieldDef[]): string[] {
  const lists = [...fields, ...innerFieldsDeep(fields).map((x) => x.field)].filter((f) => f.type === 'list')
  const tables = fields.filter((f) => f.type === 'data_table').flatMap((f) => dataTableSignatureColumns(f.data_table).map((c) => `${f.key}.${c.key}`))
  return [...lists.flatMap((f) => listSignatureColumns(f.list).map((c) => listUploadKey(f.key, c.path))), ...tables]
}

/** Whether a field holds repeating signatures: a section with a Signature inside, a List with a signature column (any level). */
export function holdsNestedSignatures(field: Pick<TaskFieldDef, 'type' | 'list' | 'repeating_section' | 'data_table'>): boolean {
  if (field.type === 'list') return hasSignatureColumns(field.list)
  if (field.type === 'data_table') return dataTableSignatureColumns(field.data_table).length > 0
  if (field.type === 'repeating_section') return (field.repeating_section?.fields ?? []).some((f) => f.type === 'signature' || holdsNestedSignatures(f))
  return false
}

export type SignatureCellVisitor = (field: TaskFieldDef, value: unknown, at: { path: string; top: TaskFieldDef; index: number }) => unknown

function mapListRows(listKey: string, config: ListFieldConfig | undefined, value: unknown, prefix: string[], path: string, top: TaskFieldDef, visit: SignatureCellVisitor): unknown {
  if (!config || !Array.isArray(value)) return value
  return value.map((row, i) => {
    if (!isPlainObject(row)) return row
    let next: Record<string, unknown> | null = null
    for (const column of config.columns) {
      const at = `${path}[${i}].${column.key}`
      let changed: unknown
      if (column.type === 'signature') changed = visit(signatureFieldForColumn(listKey, [...prefix, column.key], column), row[column.key], { path: at, top, index: i })
      else if (column.type === 'list' && hasSignatureColumns(column.list)) changed = mapListRows(listKey, column.list, row[column.key], [...prefix, column.key], at, top, visit)
      else continue
      if (changed !== row[column.key]) { next ??= { ...row }; next[column.key] = changed }
    }
    return next ?? row
  })
}

function mapItems(section: TaskFieldDef, value: unknown, path: string, top: TaskFieldDef, visit: SignatureCellVisitor): unknown {
  if (!Array.isArray(value)) return value
  const inner = section.repeating_section?.fields ?? []
  return value.map((item, i) => {
    if (!isPlainObject(item)) return item
    let next: Record<string, unknown> | null = null
    for (const f of inner) {
      const at = `${path}[${i}].${f.key}`
      let changed: unknown
      if (f.type === 'signature') changed = visit(f, item[f.key], { path: at, top, index: i })
      else if (f.type === 'repeating_section' && holdsNestedSignatures(f)) changed = mapItems(f, item[f.key], at, top, visit)
      else if (f.type === 'list' && hasSignatureColumns(f.list)) changed = mapListRows(f.key, f.list, item[f.key], [], at, top, visit)
      else continue
      if (changed !== item[f.key]) { next ??= { ...item }; next[f.key] = changed }
    }
    return next ?? item
  })
}

/** A Data table change set's signature cells: new rows (`<key>.added[i].<col>`) and changed rows' new values (`<key>.updated[i].after.<col>`). */
function mapChangeSet(field: TaskFieldDef, value: unknown, visit: SignatureCellVisitor): unknown {
  const columns = dataTableSignatureColumns(field.data_table)
  if (!columns.length || !isPlainObject(value)) return value
  let changed = false
  const visitRow = (row: Record<string, unknown>, path: string, index: number): Record<string, unknown> => {
    let next: Record<string, unknown> | null = null
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column.key)) continue
      const out = visit(signatureFieldForTableColumn(field.key, column), row[column.key], { path: `${path}.${column.key}`, top: field, index })
      if (out !== row[column.key]) { next ??= { ...row }; next[column.key] = out }
    }
    if (next) changed = true
    return next ?? row
  }
  const added = Array.isArray(value.added) ? value.added.map((r, i) => (isPlainObject(r) ? visitRow(r, `${field.key}.added[${i}]`, i) : r)) : value.added
  const updated = Array.isArray(value.updated)
    ? value.updated.map((u, i) => (isPlainObject(u) && isPlainObject(u.after) ? (() => { const after = visitRow(u.after as Record<string, unknown>, `${field.key}.updated[${i}].after`, i); return after === u.after ? u : { ...u, after } })() : u))
    : value.updated
  return changed ? { ...value, added, updated } : value
}

/**
 * Every repeating signature of a field's value through `visit` (the field —
 * a section's inner Signature, or a List column as a Signature field — the
 * cell's value and its path, e.g. `approvals[1].signature`,
 * `trips[0].legs[2].signed`). Returns the value with the visitor's results
 * in place (the same object when nothing changed).
 */
export function mapNestedSignatures(field: TaskFieldDef, value: unknown, visit: SignatureCellVisitor): unknown {
  if (field.type === 'list') return mapListRows(field.key, field.list, value, [], field.key, field, visit)
  if (field.type === 'data_table') return mapChangeSet(field, value, visit)
  if (field.type === 'repeating_section') return mapItems(field, value, field.key, field, visit)
  return value
}

/** Every repeating signature value of a field's value with its control (read only). */
export function nestedSignatureCells(field: TaskFieldDef, value: unknown): Array<{ field: TaskFieldDef; value: unknown; path: string }> {
  const out: Array<{ field: TaskFieldDef; value: unknown; path: string }> = []
  mapNestedSignatures(field, value, (f, v, at) => { out.push({ field: f, value: v, path: at.path }); return v })
  return out
}
