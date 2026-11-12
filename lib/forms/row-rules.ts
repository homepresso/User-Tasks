/**
 * Editable table rules: create a row, fill it, commit it — one model for the
 * List field (lib/forms/list-field.ts, its rows) and the editable Data table
 * field (lib/forms/data-table.ts, its change set { added, updated, deleted }).
 *
 *   New row          → a pending row with the columns' defaults; it becomes
 *                      the current row ({{form.<field>_current_row.<col>}},
 *                      {{form.<field>_current_index}}).
 *   Set row values   → column ← expression on the current / selected / a
 *                      numbered / a keyed row; the row turns pending.
 *   Commit row       → the row's checks; failing cells show their message and
 *                      the rule's "If it fails" steps run. Stage (default)
 *                      marks it ready; a Data table's "Save now" writes it on
 *                      the server at once (lib/services/form-rule-actions.ts).
 *   Discard / Revert → a new row goes / an edited row is put back.
 *   Delete row       → a List row goes; a Data table row is staged for
 *                      deletion (or deleted now).
 *   Refresh table    → a Data table re-reads its rows (pending kept, or ask).
 *
 * Read-only columns ("Read-only when editing"): an existing row keeps them —
 * a rule's values for them are ignored (and reported); a new row takes them
 * only before its first commit.
 *
 * Pure: the runner (lib/forms/field-buttons.ts) resolves templates and drives
 * the host; these functions compute the next value.
 */

import { isPlainObject } from '@/lib/utils/guards'
import {
  LIST_EDIT_KEY, coerceListRow, listColumnWritable, listEditingRow, withListEditing, listLabelKey, listRowErrors, listSelection, rawListRows, remapAfterRemoval, type ListFieldConfig,
} from './list-field'
import {
  addableColumns, changedFields, coerceCell, dataTableKeyColumn, editableColumns, emptyChangeSet, insertableColumns, isChangeSet,
  type DataTableChangeSet, type DataTableFieldConfig,
} from './data-table'
import { ROW_DRAFT_KEY, ROW_ERRORS_KEY, ROW_ID_KEY, ROW_ORIGINAL_KEY, rowDraftState, stripRowMarkers } from './row-markers'
import { CONTROLS_KEY } from './form-params'

/** Where each field's current row lives in the values ({ <field>: RowRef }); UI state, never stored. */
export const ROW_CURRENT_KEY = '__row_current'

/** A List row (index), a Data table's new row (its pending id) or an existing Data table row (key + its values as loaded). */
export type RowRef = { index: number } | { rid: string } | { key: string; row?: Record<string, unknown> }

export interface RowsField {
  key: string
  label?: string
  type: string
  list?: ListFieldConfig
  data_table?: DataTableFieldConfig
}

/** A field the row rules work on: a List, or a Data table in edit mode. */
export function isRowsField(field: RowsField | undefined | null): field is RowsField {
  return Boolean(field && ((field.type === 'list' && field.list) || (field.type === 'data_table' && field.data_table?.mode === 'edit')))
}

export function currentRowRef(values: Record<string, unknown> | null | undefined, field: string): RowRef | null {
  const all = values?.[ROW_CURRENT_KEY]
  const ref = isPlainObject(all) ? all[field] : undefined
  if (!isPlainObject(ref)) return null
  if (typeof ref.index === 'number' && Number.isInteger(ref.index) && ref.index >= 0) return { index: ref.index }
  if (typeof ref.rid === 'string' && ref.rid) return { rid: ref.rid }
  if (typeof ref.key === 'string' && ref.key) return { key: ref.key, ...(isPlainObject(ref.row) ? { row: ref.row } : {}) }
  return null
}

/** The current-row marker with one field's entry set (null removes it). */
export function withCurrentRow(values: Record<string, unknown> | null | undefined, field: string, ref: RowRef | null): Record<string, unknown> {
  const current = isPlainObject(values?.[ROW_CURRENT_KEY]) ? { ...(values![ROW_CURRENT_KEY] as Record<string, unknown>) } : {}
  if (ref) current[field] = ref
  else delete current[field]
  return current
}

/** A List's current row (0-based), or null. */
export function currentListIndex(values: Record<string, unknown> | null | undefined, field: string): number | null {
  const ref = currentRowRef(values, field)
  return ref && 'index' in ref ? ref.index : null
}

/** The column a New row asked to focus (new_row's focus_column), while that row is current. */
export function currentFocusColumn(values: Record<string, unknown> | null | undefined, field: string): string | undefined {
  const all = values?.[ROW_CURRENT_KEY]
  const ref = isPlainObject(all) ? all[field] : undefined
  return isPlainObject(ref) && typeof ref.focus === 'string' ? ref.focus : undefined
}

/** Keys rules read a field's current row under. */
export function rowCurrentKeys(field: string): string[] {
  return [`${field}_current_row`, `${field}_current_index`, `${field}_current_key`, `${field}_current_pending`, `${field}_pending_count`]
}

function changeSetOf(value: unknown): DataTableChangeSet {
  return isChangeSet(value) ? { added: value.added ?? [], updated: value.updated ?? [], deleted: value.deleted ?? [] } : emptyChangeSet()
}

/**
 * What rules read: `<field>_current_row` (its values, markers left out),
 * `<field>_current_index` (a List: the row number, 1-based; a Data table's
 * new row: its number among the new rows), `<field>_current_key` (a Data
 * table's existing row) and `<field>_pending_count`. Only for fields with a
 * current row or pending rows — UI state, never submitted.
 */
export function rowCurrentEntries(fields: RowsField[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    if (!isRowsField(f)) continue
    const ref = currentRowRef(values, f.key)
    if (f.type === 'list') {
      const rows = rawListRows(values[f.key])
      const pending = rows.filter((r) => rowDraftState(r) !== null).length
      if (!ref && !pending) continue
      const at = ref && 'index' in ref && ref.index < rows.length ? ref.index : null
      out[`${f.key}_current_row`] = at === null ? null : stripRowMarkers(rows[at])
      out[`${f.key}_current_index`] = at === null ? null : at + 1
      out[`${f.key}_current_key`] = at !== null && f.list?.key_column ? rows[at][f.list.key_column] ?? null : null
      out[`${f.key}_current_pending`] = at !== null && rowDraftState(rows[at]) !== null
      out[`${f.key}_pending_count`] = pending
      continue
    }
    const changes = changeSetOf(values[f.key])
    const pending = changes.added.filter((r) => rowDraftState(r) !== null).length + changes.updated.filter((u) => u.draft).length
    if (!ref && !pending) continue
    const row = ref ? tableRowValues(f.data_table!, changes, ref) : null
    const addedAt = ref && 'rid' in ref ? changes.added.findIndex((r) => r[ROW_ID_KEY] === ref.rid) : -1
    out[`${f.key}_current_row`] = row
    out[`${f.key}_current_index`] = addedAt >= 0 ? addedAt + 1 : null
    out[`${f.key}_current_key`] = ref && 'key' in ref ? ref.key : null
    out[`${f.key}_current_pending`] = Boolean(ref && ('rid' in ref ? rowDraftState(changes.added.find((r) => r[ROW_ID_KEY] === ref.rid)) !== null : 'key' in ref && changes.updated.some((u) => u.key === ref.key && u.draft)))
    out[`${f.key}_pending_count`] = pending
  }
  return out
}

/** A Data table row as it shows now (an existing row with its edits; a new row) — markers left out. */
export function tableRowValues(config: DataTableFieldConfig, changes: DataTableChangeSet, ref: RowRef): Record<string, unknown> | null {
  if ('rid' in ref) {
    const row = changes.added.find((r) => r[ROW_ID_KEY] === ref.rid)
    return row ? stripRowMarkers(row) : null
  }
  if ('key' in ref) {
    const u = changes.updated.find((x) => x.key === ref.key)
    const base = u?.before ?? ref.row ?? {}
    return { ...base, ...(u?.after ?? {}), [dataTableKeyColumn(config)]: base[dataTableKeyColumn(config)] ?? ref.key }
  }
  return null
}

/* ── Targets ─────────────────────────────────────────────────────────── */

/** A row the rule aims at, resolved. */
export type RowTarget =
  | { kind: 'list'; index: number }
  | { kind: 'added'; rid: string; index: number }
  | { kind: 'existing'; key: string; row: Record<string, unknown> }

export interface TargetInput {
  /** current (default) | selected | all_pending | a 1-based number (already resolved from a template). */
  spec: string
  /** A Data table row's key (resolved), or a List row's key-column value. */
  key?: string | null
  /** A Data table's loaded rows (the page on screen): numbers and keys find existing rows here. */
  loaded?: Array<{ key: string; values: Record<string, unknown> }>
}

/** Give a Data table's new rows their pending ids (rows added inline have none yet). */
export function ensureRowIds(changes: DataTableChangeSet): DataTableChangeSet {
  if (changes.added.every((r) => typeof r[ROW_ID_KEY] === 'string')) return changes
  return { ...changes, added: changes.added.map((r) => (typeof r[ROW_ID_KEY] === 'string' ? r : { ...r, [ROW_ID_KEY]: newRowId() })) }
}

let ridCounter = 0
export function newRowId(): string {
  ridCounter = (ridCounter + 1) % 1_000_000
  return `n${Date.now().toString(36)}${ridCounter.toString(36)}`
}

/** The rows a spec names on a field (0..n targets; ascending for Lists). */
export function resolveRowTargets(field: RowsField, values: Record<string, unknown>, input: TargetInput): RowTarget[] {
  const spec = String(input.spec ?? 'current').trim().toLowerCase() || 'current'
  const ref = currentRowRef(values, field.key)
  if (field.type === 'list') {
    const rows = rawListRows(values[field.key])
    const config = field.list
    if (input.key !== undefined && input.key !== null && input.key !== '' && config?.key_column) {
      const at = rows.findIndex((r) => String(r[config.key_column!] ?? '') === String(input.key))
      return at >= 0 ? [{ kind: 'list', index: at }] : []
    }
    if (spec === 'current') return ref && 'index' in ref && ref.index < rows.length ? [{ kind: 'list', index: ref.index }] : []
    if (spec === 'selected') return listSelection(values, field.key).filter((i) => i < rows.length).map((index) => ({ kind: 'list' as const, index }))
    if (spec === 'all_pending') return rows.map((r, index) => ({ r, index })).filter((x) => rowDraftState(x.r) !== null).map(({ index }) => ({ kind: 'list' as const, index }))
    if (spec === 'last') return rows.length ? [{ kind: 'list', index: rows.length - 1 }] : []
    if (spec === 'first') return rows.length ? [{ kind: 'list', index: 0 }] : []
    const n = Number(spec)
    return Number.isInteger(n) && n >= 1 && n <= rows.length ? [{ kind: 'list', index: n - 1 }] : []
  }
  const config = field.data_table!
  const changes = changeSetOf(values[field.key])
  const keyCol = dataTableKeyColumn(config)
  const loaded = input.loaded ?? []
  const added = (rid: string): RowTarget | null => {
    const index = changes.added.findIndex((r) => r[ROW_ID_KEY] === rid)
    return index >= 0 ? { kind: 'added', rid, index } : null
  }
  const existing = (key: string): RowTarget => {
    const hit = loaded.find((r) => r.key === key)
    const u = changes.updated.find((x) => x.key === key)
    const d = changes.deleted.find((x) => x.key === key)
    return { kind: 'existing', key, row: hit?.values ?? u?.before ?? d?.before ?? (ref && 'key' in ref && ref.key === key ? ref.row ?? {} : {}) }
  }
  if (input.key !== undefined && input.key !== null && input.key !== '') {
    const key = String(input.key)
    const pending = changes.added.find((r) => String(r[keyCol] ?? '') === key && typeof r[ROW_ID_KEY] === 'string')
    if (pending) return [added(String(pending[ROW_ID_KEY]))!]
    return [existing(key)]
  }
  if (spec === 'current') {
    if (!ref) return []
    if ('rid' in ref) { const t = added(ref.rid); return t ? [t] : [] }
    if ('key' in ref) return [existing(ref.key)]
    return []
  }
  if (spec === 'selected') {
    // An editable table's "selected" row is the one last clicked.
    const control = isPlainObject(values[CONTROLS_KEY]) ? (values[CONTROLS_KEY] as Record<string, unknown>)[field.key] : undefined
    const key = isPlainObject(control) ? control.last_clicked_row_id : undefined
    if (typeof key === 'string' && key) return [existing(key)]
    if (typeof key === 'number') return [existing(String(key))]
    return []
  }
  if (spec === 'all_pending') {
    return [
      ...changes.added.filter((r) => rowDraftState(r) !== null && typeof r[ROW_ID_KEY] === 'string').map((r) => added(String(r[ROW_ID_KEY]))!),
      ...changes.updated.filter((u) => u.draft).map((u) => existing(u.key)),
    ]
  }
  // A number: the n-th row as shown (new rows first, then the page's rows).
  const n = Number(spec)
  if (!Number.isInteger(n) || n < 1) return []
  if (n <= changes.added.length) {
    const rid = changes.added[n - 1][ROW_ID_KEY]
    return typeof rid === 'string' ? [added(rid)!] : []
  }
  const row = loaded[n - 1 - changes.added.length]
  return row ? [existing(row.key)] : []
}

/** A target's values as they show now. */
export function targetValues(field: RowsField, values: Record<string, unknown>, target: RowTarget): Record<string, unknown> {
  if (target.kind === 'list') return stripRowMarkers(rawListRows(values[field.key])[target.index] ?? {})
  const changes = changeSetOf(values[field.key])
  return tableRowValues(field.data_table!, changes, target.kind === 'added' ? { rid: target.rid } : { key: target.key, row: target.row }) ?? {}
}

/** A target as the current-row reference. */
export function targetRef(target: RowTarget): RowRef {
  return target.kind === 'list' ? { index: target.index } : target.kind === 'added' ? { rid: target.rid } : { key: target.key, row: target.row }
}

/** The 1-based row number a target shows at (event.row_number). */
export function targetNumber(target: RowTarget): number | null {
  return target.kind === 'list' || target.kind === 'added' ? target.index + 1 : null
}

/* ── New row ─────────────────────────────────────────────────────────── */

export type NewRowPosition = 'end' | 'start' | 'after_selected'

/**
 * A pending row with the defaults (column → value, already resolved),
 * placed at the end / start / after the (first) selected row. Returns the
 * field's next value, the new row's target and the markers to set.
 */
export function newRow(field: RowsField, values: Record<string, unknown>, defaults: Record<string, unknown>, position: NewRowPosition = 'end'):
  { value: unknown; target: RowTarget; extra: Record<string, unknown> } | { error: string } {
  if (field.type === 'list') {
    const config = field.list!
    const rows = rawListRows(values[field.key])
    if (config.max_rows !== undefined && rows.length >= config.max_rows) return { error: `${field.label ?? field.key} is full (at most ${config.max_rows} ${config.max_rows === 1 ? 'row' : 'rows'})` }
    const seed: Record<string, unknown> = {}
    for (const c of config.columns) if (c.type !== 'calculated') seed[c.key] = c.type === 'boolean' ? false : null
    Object.assign(seed, defaults)
    const row: Record<string, unknown> = { ...coerceListRow(config, seed), [ROW_DRAFT_KEY]: 'new' }
    const selected = listSelection(values, field.key).filter((i) => i < rows.length)
    const at = position === 'start' ? 0 : position === 'after_selected' && selected.length ? selected[selected.length - 1] + 1 : rows.length
    const next = [...rows.slice(0, at), row, ...rows.slice(at)]
    return { value: next, target: { kind: 'list', index: at }, extra: shiftListMarkers(values, field.key, at) }
  }
  const config = field.data_table!
  if (!config.allow_add) return { error: `${field.label ?? field.key} does not allow new rows` }
  const changes = ensureRowIds(changeSetOf(values[field.key]))
  const row: Record<string, unknown> = {}
  for (const c of insertableColumns(config)) row[c.key] = c.type === 'boolean' ? false : null
  for (const [k, v] of Object.entries(defaults)) {
    const col = config.columns.find((c) => c.key === k)
    if (!col) continue
    const typed = coerceCell(col, v)
    row[k] = 'error' in typed ? v : typed.value
  }
  const rid = newRowId()
  Object.assign(row, { [ROW_DRAFT_KEY]: 'new', [ROW_ID_KEY]: rid })
  const added = position === 'start' ? [row, ...changes.added] : [...changes.added, row]
  return { value: { ...changes, added }, target: { kind: 'added', rid, index: position === 'start' ? 0 : added.length - 1 }, extra: {} }
}

/** A row inserted at `at`: the List's selection / edit / current markers move with their rows. */
function shiftListMarkers(values: Record<string, unknown>, list: string, at: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const ref = currentRowRef(values, list)
  if (ref && 'index' in ref && ref.index >= at) out[ROW_CURRENT_KEY] = withCurrentRow(values, list, { index: ref.index + 1 })
  const editing = listEditingRow(values, list)
  if (editing !== null && editing >= at) out[LIST_EDIT_KEY] = withListEditing(values, list, editing + 1)
  return out
}

/** The defaults a new row starts with: each column's `default` (templates resolved by the caller), plus the rule's own values. */
export function columnDefaults(field: RowsField): Record<string, string> {
  const out: Record<string, string> = {}
  const columns = field.type === 'list' ? field.list?.columns ?? [] : field.data_table?.columns ?? []
  for (const c of columns as Array<{ key: string; default?: string }>) if (c.default !== undefined && c.default !== '') out[c.key] = c.default
  return out
}

/* ── Set row values ──────────────────────────────────────────────────── */

export interface SetResult {
  value: unknown
  /** Columns written. */
  changed: string[]
  /** Columns left alone: read-only on an existing row, or not a column the row can take. */
  ignored: string[]
  /** A value that doesn't fit its column (column → message): nothing is written. */
  errors: Record<string, string>
}

/**
 * Write column values (resolved) into a target row. Read-only columns are
 * ignored on an existing (committed) row; a new row not yet committed takes
 * them. The row turns pending: a committed List row becomes 'edited' (its
 * values kept for Revert); a Data table's existing row gets an `updated`
 * entry marked draft.
 */
export function setRowValues(field: RowsField, values: Record<string, unknown>, target: RowTarget, patch: Record<string, unknown>): SetResult {
  const ignored: string[] = []
  const errors: Record<string, string> = {}
  if (target.kind === 'list') {
    const config = field.list!
    const rows = rawListRows(values[field.key])
    const row = rows[target.index]
    if (!row) return { value: values[field.key], changed: [], ignored: Object.keys(patch), errors }
    const write: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(patch)) {
      if (listColumnWritable(config, k, row)) write[k] = v
      else if (k.endsWith('_label') && config.columns.some((c) => c.type === 'lookup' && listLabelKey(c.key) === k && listColumnWritable(config, c.key, row))) write[k] = v
      else ignored.push(k)
    }
    const changed = Object.keys(write).filter((k) => JSON.stringify(row[k] ?? null) !== JSON.stringify(write[k] ?? null))
    if (!Object.keys(write).length) return { value: values[field.key], changed: [], ignored, errors }
    const state = rowDraftState(row)
    const base = stripRowMarkers(row)
    const typed = coerceListRow(config, { ...base, ...write })
    // Keep the row's own extra keys (lookup labels) when the patch doesn't set them.
    const next: Record<string, unknown> = { ...base, ...typed }
    const cellErrors = { ...(isPlainObject(row[ROW_ERRORS_KEY]) ? row[ROW_ERRORS_KEY] as Record<string, string> : {}) }
    for (const k of Object.keys(write)) delete cellErrors[k]
    if (state === 'new') next[ROW_DRAFT_KEY] = 'new'
    else if (changed.length || state === 'edited') {
      next[ROW_DRAFT_KEY] = 'edited'
      next[ROW_ORIGINAL_KEY] = state === 'edited' && isPlainObject(row[ROW_ORIGINAL_KEY]) ? row[ROW_ORIGINAL_KEY] : base
    }
    if (Object.keys(cellErrors).length) next[ROW_ERRORS_KEY] = cellErrors
    return { value: rows.map((r, i) => (i === target.index ? next : r)), changed, ignored, errors }
  }
  const config = field.data_table!
  const changes = ensureRowIds(changeSetOf(values[field.key]))
  if (target.kind === 'added') {
    const row = changes.added.find((r) => r[ROW_ID_KEY] === target.rid)
    if (!row) return { value: values[field.key], changed: [], ignored: Object.keys(patch), errors }
    const isNew = rowDraftState(row) === 'new'
    const allowed = new Set((isNew ? insertableColumns(config) : addableColumns(config)).map((c) => c.key))
    const next: Record<string, unknown> = { ...row }
    const changed: string[] = []
    const cellErrors = { ...(isPlainObject(row[ROW_ERRORS_KEY]) ? row[ROW_ERRORS_KEY] as Record<string, string> : {}) }
    for (const [k, v] of Object.entries(patch)) {
      const col = config.columns.find((c) => c.key === k)
      if (!col || !allowed.has(k)) { ignored.push(k); continue }
      const typed = coerceCell(col, v)
      if ('error' in typed) { errors[k] = typed.error; continue }
      if (JSON.stringify(next[k] ?? null) !== JSON.stringify(typed.value ?? null)) changed.push(k)
      next[k] = typed.value
      delete cellErrors[k]
    }
    if (Object.keys(errors).length) return { value: values[field.key], changed: [], ignored, errors }
    if (!isNew && changed.length) next[ROW_DRAFT_KEY] = 'edited'
    if (Object.keys(cellErrors).length) next[ROW_ERRORS_KEY] = cellErrors
    else delete next[ROW_ERRORS_KEY]
    return { value: { ...changes, added: changes.added.map((r) => (r[ROW_ID_KEY] === target.rid ? next : r)) }, changed, ignored, errors }
  }
  // An existing row: editable columns only (read-only, hidden and the key never change).
  if (changes.deleted.some((d) => d.key === target.key)) return { value: values[field.key], changed: [], ignored: Object.keys(patch), errors: { _row: 'The row is marked for deletion' } }
  const editable = new Set(editableColumns(config).map((c) => c.key))
  const existing = changes.updated.find((u) => u.key === target.key)
  const before = existing?.before ?? target.row
  const after: Record<string, unknown> = { ...(existing?.after ?? {}) }
  const written: string[] = []
  for (const [k, v] of Object.entries(patch)) {
    const col = config.columns.find((c) => c.key === k)
    if (!col || !editable.has(k)) { ignored.push(k); continue }
    const typed = coerceCell(col, v)
    if ('error' in typed) { errors[k] = typed.error; continue }
    after[k] = typed.value
    written.push(k)
  }
  if (Object.keys(errors).length) return { value: values[field.key], changed: [], ignored, errors }
  const changedNow = changedFields(config, before, after)
  const kept = Object.fromEntries(changedNow.map((k) => [k, after[k]]))
  const updated = changes.updated.filter((u) => u.key !== target.key)
  const cellErrors = { ...(existing?.errors ?? {}) }
  for (const k of written) delete cellErrors[k]
  if (changedNow.length) updated.push({ key: target.key, before, after: kept, changed_fields: changedNow, draft: true, ...(Object.keys(cellErrors).length ? { errors: cellErrors } : {}) })
  const changed = written.filter((k) => JSON.stringify((existing?.after ?? before)[k] ?? null) !== JSON.stringify(after[k] ?? null))
  return { value: tidy({ ...changes, updated }), changed, ignored, errors }
}

function tidy(changes: DataTableChangeSet): DataTableChangeSet | null {
  return changes.added.length || changes.updated.length || changes.deleted.length ? changes : null
}

/* ── Commit / discard / revert / delete ──────────────────────────────── */

export type CommitOutcome =
  | { ok: true; value: unknown; row: Record<string, unknown> }
  | { ok: false; value: unknown; errors: Record<string, string>; row: Record<string, unknown> }

/** A row's checks (column → message): the List's column rules, a Data table's types / required. */
export function rowProblems(field: RowsField, values: Record<string, unknown>, target: RowTarget): Record<string, string> {
  const row = targetValues(field, values, target)
  if (target.kind === 'list') return listRowErrors(field.list!, row, { form: values })
  const config = field.data_table!
  const errors: Record<string, string> = {}
  const cols = target.kind === 'added' ? insertableColumns(config) : editableColumns(config)
  for (const col of cols) {
    const typed = coerceCell(col, row[col.key])
    if ('error' in typed) errors[col.key] = typed.error
    else if (col.required && (typed.value === null || typed.value === '')) errors[col.key] = `${col.label} is required`
  }
  return errors
}

/** Commit (stage): the row's checks pass → its pending marker goes; otherwise its cells carry the messages. */
export function commitRow(field: RowsField, values: Record<string, unknown>, target: RowTarget): CommitOutcome {
  const errors = rowProblems(field, values, target)
  const row = targetValues(field, values, target)
  const failed = Object.keys(errors).length > 0
  if (target.kind === 'list') {
    const rows = rawListRows(values[field.key])
    const current = rows[target.index]
    if (!current) return { ok: false, value: values[field.key], errors: { _row: 'The row is gone' }, row }
    const next = failed
      ? { ...current, [ROW_ERRORS_KEY]: errors }
      : stripRowMarkers({ ...current, ...coerceListRow(field.list!, stripRowMarkers(current)) })
    const value = rows.map((r, i) => (i === target.index ? next : r))
    return failed ? { ok: false, value, errors, row } : { ok: true, value, row: stripRowMarkers(next) }
  }
  const changes = changeSetOf(values[field.key])
  if (target.kind === 'added') {
    const added = changes.added.map((r) => {
      if (r[ROW_ID_KEY] !== target.rid) return r
      if (failed) return { ...r, [ROW_ERRORS_KEY]: errors }
      const out = { ...r }
      delete out[ROW_DRAFT_KEY]
      delete out[ROW_ERRORS_KEY]
      return out
    })
    const value = { ...changes, added }
    return failed ? { ok: false, value, errors, row } : { ok: true, value, row }
  }
  const updated = changes.updated.map((u) => {
    if (u.key !== target.key) return u
    if (failed) return { ...u, errors }
    const out = { ...u }
    delete out.draft
    delete out.errors
    return out
  })
  const value = tidy({ ...changes, updated })
  return failed ? { ok: false, value, errors, row } : { ok: true, value, row }
}

/** The change a Data table "Save now" commit writes (sent to the server, which checks it again). */
export function tableSaveChange(field: RowsField, values: Record<string, unknown>, target: RowTarget, kind: 'commit' | 'delete'): { added?: Record<string, unknown>; updated?: { key: string; after: Record<string, unknown> }; deleted?: { key: string } } | null {
  if (field.type !== 'data_table') return null
  const changes = changeSetOf(values[field.key])
  if (target.kind === 'added') {
    if (kind === 'delete') return null
    const row = changes.added.find((r) => r[ROW_ID_KEY] === target.rid)
    return row ? { added: stripRowMarkers(row) } : null
  }
  if (target.kind !== 'existing') return null
  if (kind === 'delete') return { deleted: { key: target.key } }
  const u = changes.updated.find((x) => x.key === target.key)
  return u ? { updated: { key: target.key, after: u.after } } : null
}

/** After a "Save now": the row leaves the change set (the table shows the stored row once it re-reads). */
export function dropFromChangeSet(field: RowsField, values: Record<string, unknown>, target: RowTarget): unknown {
  const changes = changeSetOf(values[field.key])
  if (target.kind === 'added') return tidy({ ...changes, added: changes.added.filter((r) => r[ROW_ID_KEY] !== target.rid) })
  if (target.kind === 'existing') return tidy({ ...changes, updated: changes.updated.filter((u) => u.key !== target.key), deleted: changes.deleted.filter((d) => d.key !== target.key) })
  return values[field.key]
}

/**
 * Discard: a new row goes; an edited row is put back as it was at its last
 * commit (a Data table row: its edits dropped). Revert: an edited row back;
 * a new row back to its defaults (`defaults`), still pending.
 */
export function discardRow(field: RowsField, values: Record<string, unknown>, target: RowTarget, mode: 'discard' | 'revert', defaults: Record<string, unknown> = {}): { value: unknown; removed: boolean; extra: Record<string, unknown> } {
  if (target.kind === 'list') {
    const rows = rawListRows(values[field.key])
    const row = rows[target.index]
    const state = rowDraftState(row)
    if (!row || !state) return { value: values[field.key], removed: false, extra: {} }
    if (state === 'new') {
      if (mode === 'revert') {
        const fresh = newRow({ ...field, list: { ...field.list!, max_rows: undefined } }, { ...values, [field.key]: [] }, defaults)
        if ('error' in fresh) return { value: values[field.key], removed: false, extra: {} }
        return { value: rows.map((r, i) => (i === target.index ? (fresh.value as Record<string, unknown>[])[0] : r)), removed: false, extra: {} }
      }
      return { value: rows.filter((_, i) => i !== target.index), removed: true, extra: afterListRemoval(values, field.key, new Set([target.index])) }
    }
    const original = isPlainObject(row[ROW_ORIGINAL_KEY]) ? row[ROW_ORIGINAL_KEY] as Record<string, unknown> : stripRowMarkers(row)
    return { value: rows.map((r, i) => (i === target.index ? original : r)), removed: false, extra: {} }
  }
  const changes = changeSetOf(values[field.key])
  if (target.kind === 'added') {
    const row = changes.added.find((r) => r[ROW_ID_KEY] === target.rid)
    if (!row) return { value: values[field.key], removed: false, extra: {} }
    if (mode === 'revert' && rowDraftState(row) === 'new') {
      const fresh = newRow({ ...field, data_table: { ...field.data_table!, allow_add: true } }, { ...values, [field.key]: null }, defaults)
      if ('error' in fresh) return { value: values[field.key], removed: false, extra: {} }
      const made = { ...(fresh.value as DataTableChangeSet).added[0], [ROW_ID_KEY]: target.rid }
      return { value: { ...changes, added: changes.added.map((r) => (r[ROW_ID_KEY] === target.rid ? made : r)) }, removed: false, extra: {} }
    }
    return { value: tidy({ ...changes, added: changes.added.filter((r) => r[ROW_ID_KEY] !== target.rid) }), removed: true, extra: { [ROW_CURRENT_KEY]: clearCurrentIf(values, field.key, (ref) => 'rid' in ref && ref.rid === target.rid) } }
  }
  return { value: tidy({ ...changes, updated: changes.updated.filter((u) => u.key !== target.key) }), removed: false, extra: {} }
}

function clearCurrentIf(values: Record<string, unknown>, field: string, test: (ref: RowRef) => boolean): Record<string, unknown> {
  const ref = currentRowRef(values, field)
  return withCurrentRow(values, field, ref && test(ref) ? null : ref)
}

/** List rows removed: the current row follows its row (or clears when it went). */
export function afterListRemoval(values: Record<string, unknown>, list: string, removed: ReadonlySet<number>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const ref = currentRowRef(values, list)
  if (ref && 'index' in ref) {
    const moved = remapAfterRemoval([ref.index], removed)
    out[ROW_CURRENT_KEY] = withCurrentRow(values, list, moved.length ? { index: moved[0] } : null)
  }
  const editing = listEditingRow(values, list)
  if (editing !== null) {
    const moved = remapAfterRemoval([editing], removed)
    out[LIST_EDIT_KEY] = withListEditing(values, list, moved.length ? moved[0] : null)
  }
  return out
}

/** Delete (stage): a List row goes; a Data table's new row goes, an existing one is marked deleted. */
export function deleteRows(field: RowsField, values: Record<string, unknown>, targets: RowTarget[]): { value: unknown; extra: Record<string, unknown>; refused?: string } {
  if (field.type === 'list') {
    const rows = rawListRows(values[field.key])
    const gone = new Set(targets.filter((t): t is { kind: 'list'; index: number } => t.kind === 'list').map((t) => t.index))
    return { value: rows.filter((_, i) => !gone.has(i)), extra: afterListRemoval(values, field.key, gone) }
  }
  const config = field.data_table!
  let changes = changeSetOf(values[field.key])
  const rids = new Set(targets.filter((t) => t.kind === 'added').map((t) => (t as { rid: string }).rid))
  const existing = targets.filter((t): t is Extract<RowTarget, { kind: 'existing' }> => t.kind === 'existing')
  if (existing.length && !config.allow_delete) return { value: values[field.key], extra: {}, refused: `${field.label ?? field.key} does not allow deleting rows` }
  changes = { ...changes, added: changes.added.filter((r) => !rids.has(String(r[ROW_ID_KEY] ?? ''))) }
  for (const t of existing) {
    if (changes.deleted.some((d) => d.key === t.key)) continue
    const u = changes.updated.find((x) => x.key === t.key)
    changes = { ...changes, updated: changes.updated.filter((x) => x.key !== t.key), deleted: [...changes.deleted, { key: t.key, before: u?.before ?? t.row }] }
  }
  const ref = currentRowRef(values, field.key)
  const clears = ref && (('rid' in ref && rids.has(ref.rid)) || ('key' in ref && existing.some((t) => t.key === ref.key)))
  return { value: tidy(changes), extra: clears ? { [ROW_CURRENT_KEY]: withCurrentRow(values, field.key, null) } : {} }
}

/** Pending rows on a field (new or changed, not committed). */
export function pendingCount(field: RowsField, values: Record<string, unknown>): number {
  if (field.type === 'list') return rawListRows(values[field.key]).filter((r) => rowDraftState(r) !== null).length
  const changes = changeSetOf(values[field.key])
  return changes.added.filter((r) => rowDraftState(r) !== null).length + changes.updated.filter((u) => u.draft).length
}

/** Read-only columns of a field (the designer's warning; the kit). */
export function readOnlyColumnKeys(field: RowsField): string[] {
  if (field.type === 'list') return (field.list?.columns ?? []).filter((c) => c.read_only).map((c) => c.key)
  return (field.data_table?.columns ?? []).filter((c) => c.read_only).map((c) => c.key)
}

/** A rule's Set row values columns that a read-only column ignores on existing rows (the designer's warning). */
export function ignoredOnExisting(field: RowsField, columns: string[]): string[] {
  const locked = new Set(readOnlyColumnKeys(field))
  if (field.type === 'data_table') {
    const config = field.data_table!
    locked.add(dataTableKeyColumn(config))
    for (const c of config.columns) if (c.hidden) locked.add(c.key)
  }
  return columns.filter((c) => locked.has(c))
}

/* ── The designer's "New → fill → Commit" kit ────────────────────────── */

export interface RowCommitKit {
  /** One input per column people fill (read-only, hidden and calculated columns left out), the New row / Apply / Save row buttons. */
  fields: Array<Record<string, unknown> & { key: string; label: string; type: string }>
  /** New row (button), the inputs → the current row (each input's change, or the Apply button), Save row (commit). */
  rules: Array<Record<string, unknown> & { id: string }>
}

const TABLE_KIT_TYPE: Record<string, string> = { text: 'text', number: 'number', date: 'date', datetime: 'datetime', choice: 'choice', boolean: 'boolean' }

/**
 * The "New → fill → Commit" pattern for a List or an editable Data table:
 * a "New row" button (rule: New row), inputs mapped to the current row by
 * Set row values — on each input's change (only while the current row is
 * pending) or with an "Apply" button — and a "Save row" button (Commit
 * row; a Data table: stage or save now) that clears the inputs once it
 * worked. Read-only columns get no input: an existing row keeps them, a new
 * row takes their defaults.
 */
export function rowCommitKit(field: RowsField, taken: Iterable<string>, options: { apply?: 'change' | 'button'; save?: 'stage' | 'save_now'; ruleIds?: string[] } = {}): RowCommitKit {
  const used = new Set(taken)
  const unique = (base: string) => {
    let key = base.slice(0, 64)
    for (let i = 2; used.has(key); i++) key = `${base.slice(0, 60)}_${i}`
    used.add(key)
    return key
  }
  const ids = options.ruleIds ?? []
  let n = 0
  const ruleId = (fallback: string) => ids[n++] ?? fallback.slice(0, 40)
  const name = field.label || field.key
  const fields: RowCommitKit['fields'] = []
  const mapping: Record<string, string> = {}
  if (field.type === 'list') {
    for (const c of field.list?.columns ?? []) {
      if (c.type === 'calculated' || c.type === 'list' || c.hidden || c.read_only) continue
      const key = unique(`${field.key}_${c.key}`)
      const type = c.type === 'textarea' ? 'textarea' : c.type === 'currency' ? 'currency' : c.type === 'email' ? 'email' : c.type === 'lookup' ? 'lookup' : c.type
      const out: Record<string, unknown> & { key: string; label: string; type: string } = { key, label: c.label, type }
      if (c.options) out.options = c.options.map((v) => (c.option_labels?.[v] ? { value: v, label: c.option_labels[v] } : v))
      if (c.currency) out.currency = c.currency
      if (c.placeholder) out.placeholder = c.placeholder
      if (c.help_text) out.help_text = c.help_text
      if (c.lookup) out.lookup = c.lookup
      fields.push(out)
      mapping[c.key] = `{{${key}}}`
      if (c.type === 'lookup') mapping[listLabelKey(c.key)] = `{{${key}_label}}`
    }
  } else {
    const config = field.data_table!
    const keyCol = dataTableKeyColumn(config)
    for (const c of config.columns) {
      if (c.read_only || c.hidden || c.key === keyCol) continue
      const key = unique(`${field.key}_${c.key}`)
      const out: Record<string, unknown> & { key: string; label: string; type: string } = { key, label: c.label, type: TABLE_KIT_TYPE[c.type] ?? 'text' }
      if (c.options) out.options = c.options
      fields.push(out)
      mapping[c.key] = `{{${key}}}`
    }
  }
  const inputs = fields.map((f) => f.key)
  const newKey = unique(`${field.key}_new_row`)
  const saveKey = unique(`${field.key}_save_row`)
  fields.push({ key: newKey, label: 'New row', type: 'button', button: { style: 'secondary', icon: 'plus', actions: [] } })
  const rules: RowCommitKit['rules'] = [
    { id: ruleId(`r_new_${field.key}`), name: `New row in ${name}`, event: 'button_click', target: newKey, then: [{ type: 'new_row', field: field.key, position: 'end' }] },
  ]
  if (options.apply === 'button') {
    const applyKey = unique(`${field.key}_apply`)
    fields.push({ key: applyKey, label: 'Apply', type: 'button', button: { style: 'secondary', icon: 'check', actions: [] } })
    rules.push({ id: ruleId(`r_apply_${field.key}`), name: `Apply the inputs to the current row of ${name}`, event: 'button_click', target: applyKey, then: [{ type: 'set_row_values', field: field.key, row: 'current', values: mapping }] })
  } else {
    // Each input's change fills its column of the current row — only while that row is pending (a committed row isn't changed by clearing the inputs).
    for (const f of fields.filter((x) => x.type !== 'button')) {
      const columns = Object.entries(mapping).filter(([, t]) => t === `{{${f.key}}}` || t === `{{${f.key}_label}}`)
      rules.push({
        id: ruleId(`r_fill_${f.key}`), name: `${f.label} → the current row of ${name}`, event: 'value_change', target: f.key,
        if: { match: 'all', conditions: [{ column: `${field.key}_current_pending`, operator: 'eq', value: 'true' }] },
        then: [{ type: 'set_row_values', field: field.key, row: 'current', values: Object.fromEntries(columns) }],
      })
    }
  }
  fields.push({ key: saveKey, label: 'Save row', type: 'button', button: { style: 'primary', icon: 'save', actions: [] } })
  const commit: Record<string, unknown> = { type: 'commit_row', field: field.key, row: 'current', on_success: [{ type: 'clear_values', fields: inputs }] }
  if (field.type === 'data_table' && options.save === 'save_now') commit.commit_mode = 'save_now'
  rules.push({ id: ruleId(`r_save_${field.key}`), name: `Save the current row of ${name}`, event: 'button_click', target: saveKey, then: options.apply === 'button' ? [{ type: 'set_row_values', field: field.key, row: 'current', values: mapping }, commit] : [commit] })
  return { fields, rules }
}
