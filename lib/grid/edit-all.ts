/**
 * "Edit all rows": the editing session shared by the Data grid
 * (components/data/data-grid.tsx) and the form Data table control
 * (components/forms/data-table-field.tsx). One click turns every row on the
 * page into editable cells; edits are kept here as DRAFTS until the person
 * saves (the grid: one batch through lib/services/data-table-views.ts
 * writeGridRows) or, on a form, are folded into the control's change set.
 *
 *  - base / versions: each row's values and updated_at as the session first
 *    saw them (dirty tracking, revert, the optimistic-concurrency check);
 *  - drafts: only the cells that differ from base (typing a value back to
 *    what it was un-dirties the cell);
 *  - added: new rows typed at the bottom (ids `new:<n>`);
 *  - errors: per cell (a paste that didn't fit, a server refusal);
 *  - conflicts: rows someone else changed since the session began ("keep
 *    mine / take theirs");
 *  - undo: snapshots of drafts + added rows, newest last (Ctrl/Cmd+Z).
 *
 * Pure and isomorphic: every function returns a new state.
 */

import { sameGridValue } from './column-model'

export const EDIT_ALL_LIMITS = {
  /** Undo steps kept per session. */
  undo: 100,
  /** New rows a session may add (a paste that runs past the last row adds rows up to this). */
  addedRows: 200,
} as const

export const NEW_ROW_PREFIX = 'new:'

export interface EditAllRow {
  key: string
  values: Record<string, unknown>
  /** The row's version (updated_at) as read; null when unknown. */
  version?: string | null
}

export interface CellChange { row: string; col: string; value: unknown }

export interface EditAllConflict {
  /** The row as it is on the server now. */
  theirs: Record<string, unknown>
  version: string | null
  message: string
}

interface Snapshot {
  drafts: Record<string, Record<string, unknown>>
  added: Array<{ id: string; values: Record<string, unknown> }>
}

export interface EditAllState {
  base: Record<string, Record<string, unknown>>
  versions: Record<string, string | null>
  drafts: Record<string, Record<string, unknown>>
  added: Array<{ id: string; values: Record<string, unknown> }>
  errors: Record<string, Record<string, string>>
  conflicts: Record<string, EditAllConflict>
  /** Rows the server would not let this person change (row access rules): read-only for the rest of the session, with the reason. */
  locked: Record<string, string>
  undo: Snapshot[]
  /** Next new-row number (ids stay unique after removals). */
  seq: number
}

export function isNewRow(key: string): boolean {
  return key.startsWith(NEW_ROW_PREFIX)
}

export function startEditAll(rows: EditAllRow[] = []): EditAllState {
  return registerRows({ base: {}, versions: {}, drafts: {}, added: [], errors: {}, conflicts: {}, locked: {}, undo: [], seq: 1 }, rows)
}

/**
 * Rows the session sees (a page loaded, the next page, a refresh). Unknown
 * rows join; a known row WITHOUT drafts takes the newer server values
 * silently; a row with drafts keeps the version it was edited against (the
 * save then reports a conflict if the server moved on). Returns the same
 * object when nothing changed.
 */
export function registerRows(state: EditAllState, rows: EditAllRow[]): EditAllState {
  let next: EditAllState | null = null
  for (const row of rows) {
    const known = Object.prototype.hasOwnProperty.call(state.base, row.key)
    const version = row.version ?? null
    if (known && (state.drafts[row.key] || state.conflicts[row.key] || state.versions[row.key] === version)) continue
    next ??= { ...state, base: { ...state.base }, versions: { ...state.versions } }
    next.base[row.key] = row.values
    next.versions[row.key] = version
  }
  return next ?? state
}

function addedRow(state: EditAllState, key: string) {
  return state.added.find((r) => r.id === key)
}

/** The cell's value in the session (draft, else base; a new row's own values). */
export function cellValue(state: EditAllState, row: string, col: string): unknown {
  if (isNewRow(row)) return addedRow(state, row)?.values[col] ?? null
  const draft = state.drafts[row]
  if (draft && Object.prototype.hasOwnProperty.call(draft, col)) return draft[col]
  return state.base[row]?.[col] ?? null
}

/** The row's values in the session (base with its drafts on top). */
export function rowValues(state: EditAllState, row: string): Record<string, unknown> {
  if (isNewRow(row)) return addedRow(state, row)?.values ?? {}
  return { ...(state.base[row] ?? {}), ...(state.drafts[row] ?? {}) }
}

export function isCellChanged(state: EditAllState, row: string, col: string): boolean {
  if (isNewRow(row)) return !isBlank(addedRow(state, row)?.values[col])
  return Boolean(state.drafts[row] && Object.prototype.hasOwnProperty.call(state.drafts[row], col))
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === false
}

/** A new row with nothing typed in it (not saved, not counted). */
export function isBlankNewRow(values: Record<string, unknown>): boolean {
  return Object.values(values).every(isBlank)
}

/** Rows with changes: edited existing rows plus new rows with something typed. */
export function changedRowKeys(state: EditAllState): string[] {
  return [
    ...Object.keys(state.drafts).filter((k) => Object.keys(state.drafts[k]).length),
    ...state.added.filter((r) => !isBlankNewRow(r.values)).map((r) => r.id),
  ]
}

export function changedRowCount(state: EditAllState): number {
  return changedRowKeys(state).length
}

export function hasChanges(state: EditAllState): boolean {
  return changedRowCount(state) > 0
}

/** Cells with an error (paste, validation, server). */
export function errorCount(state: EditAllState): number {
  return Object.values(state.errors).reduce((n, cols) => n + Object.keys(cols).length, 0)
}

function snapshot(state: EditAllState): Snapshot {
  return { drafts: state.drafts, added: state.added }
}

function pushUndo(state: EditAllState): Snapshot[] {
  const undo = [...state.undo, snapshot(state)]
  return undo.length > EDIT_ALL_LIMITS.undo ? undo.slice(undo.length - EDIT_ALL_LIMITS.undo) : undo
}

function withoutErrors(errors: EditAllState['errors'], cells: Array<{ row: string; col: string }>): EditAllState['errors'] {
  let out: EditAllState['errors'] | null = null
  for (const { row, col } of cells) {
    if (!errors[row]?.[col]) continue
    out ??= { ...errors }
    const cols = { ...(out[row] ?? {}) }
    delete cols[col]
    if (Object.keys(cols).length) out[row] = cols
    else delete out[row]
  }
  return out ?? errors
}

/**
 * Apply cell changes as ONE undo step. A value equal to the row's base
 * clears the draft (the cell is no longer changed); the cells' errors go.
 */
export function applyChanges(state: EditAllState, input: CellChange[]): EditAllState {
  // Values that are already the cell's value are no step at all (their errors still go).
  const changes = input.filter((c) => !state.locked[c.row] && !sameGridValue(c.value, cellValue(state, c.row, c.col)))
  if (!changes.length) {
    const errors = withoutErrors(state.errors, input)
    return errors === state.errors ? state : { ...state, errors }
  }
  const drafts = { ...state.drafts }
  let added = state.added
  for (const { row, col, value } of changes) {
    if (isNewRow(row)) {
      added = added.map((r) => (r.id === row ? { ...r, values: { ...r.values, [col]: value } } : r))
      continue
    }
    if (!Object.prototype.hasOwnProperty.call(state.base, row)) continue
    const draft = { ...(drafts[row] ?? {}) }
    if (sameGridValue(value, state.base[row]?.[col])) delete draft[col]
    else draft[col] = value
    if (Object.keys(draft).length) drafts[row] = draft
    else delete drafts[row]
  }
  return { ...state, drafts, added, undo: pushUndo(state), errors: withoutErrors(state.errors, changes) }
}

/** Put a cell back to its base value (Esc on a cell). */
export function revertCell(state: EditAllState, row: string, col: string): EditAllState {
  if (isNewRow(row)) return applyChanges(state, [{ row, col, value: null }])
  if (!isCellChanged(state, row, col)) return state.errors[row]?.[col] ? { ...state, errors: withoutErrors(state.errors, [{ row, col }]) } : state
  return applyChanges(state, [{ row, col, value: state.base[row]?.[col] ?? null }])
}

/** Put a whole row back (a conflict's "take theirs", a row's revert). */
export function revertRow(state: EditAllState, row: string): EditAllState {
  if (!state.drafts[row]) return state
  const drafts = { ...state.drafts }
  delete drafts[row]
  const errors = { ...state.errors }
  delete errors[row]
  return { ...state, drafts, errors, undo: pushUndo(state) }
}

/** Set or clear a cell's error (not an undo step). */
export function setCellError(state: EditAllState, row: string, col: string, message: string | null): EditAllState {
  if (!message) return { ...state, errors: withoutErrors(state.errors, [{ row, col }]) }
  return { ...state, errors: { ...state.errors, [row]: { ...(state.errors[row] ?? {}), [col]: message } } }
}

/** Errors for many cells at once (a paste). */
export function setCellErrors(state: EditAllState, list: Array<{ row: string; col: string; message: string }>): EditAllState {
  if (!list.length) return state
  const errors = { ...state.errors }
  for (const { row, col, message } of list) errors[row] = { ...(errors[row] ?? {}), [col]: message }
  return { ...state, errors }
}

/** Add blank rows at the bottom (one undo step). */
export function addRows(state: EditAllState, blank: Record<string, unknown>, count = 1): EditAllState {
  const room = Math.max(0, EDIT_ALL_LIMITS.addedRows - state.added.length)
  const n = Math.min(count, room)
  if (!n) return state
  const rows = Array.from({ length: n }, (_, i) => ({ id: `${NEW_ROW_PREFIX}${state.seq + i}`, values: { ...blank } }))
  return { ...state, added: [...state.added, ...rows], seq: state.seq + n, undo: pushUndo(state) }
}

export function removeAddedRow(state: EditAllState, id: string): EditAllState {
  if (!addedRow(state, id)) return state
  const errors = { ...state.errors }
  delete errors[id]
  return { ...state, added: state.added.filter((r) => r.id !== id), errors, undo: pushUndo(state) }
}

export function canUndo(state: EditAllState): boolean {
  return state.undo.length > 0
}

/**
 * Undo the last step. `changed`: the cells whose value moved (a form folds
 * them into its change set), with their value after the undo.
 */
export function undo(state: EditAllState): { state: EditAllState; changed: CellChange[] } {
  const last = state.undo[state.undo.length - 1]
  if (!last) return { state, changed: [] }
  const next: EditAllState = { ...state, drafts: last.drafts, added: last.added, undo: state.undo.slice(0, -1) }
  return { state: next, changed: diffCells(state, next) }
}

/** Cells whose session value differs between two states (existing rows; new rows by id). */
export function diffCells(before: EditAllState, after: EditAllState): CellChange[] {
  const out: CellChange[] = []
  const rows = new Set([...Object.keys(before.drafts), ...Object.keys(after.drafts)])
  for (const row of rows) {
    const cols = new Set([...Object.keys(before.drafts[row] ?? {}), ...Object.keys(after.drafts[row] ?? {})])
    for (const col of cols) {
      const a = cellValue(before, row, col)
      const b = cellValue(after, row, col)
      if (!sameGridValue(a, b)) out.push({ row, col, value: b })
    }
  }
  const ids = new Set([...before.added.map((r) => r.id), ...after.added.map((r) => r.id)])
  for (const id of ids) {
    const a = addedRow(before, id)?.values ?? {}
    const b = addedRow(after, id)?.values ?? {}
    for (const col of new Set([...Object.keys(a), ...Object.keys(b)])) if (!sameGridValue(a[col], b[col])) out.push({ row: id, col, value: b[col] ?? null })
  }
  return out
}

/* ── Batch save (the Data grid) ───────────────────────────────────────── */

export interface EditAllBatch {
  rows: Array<{ row_id: string; cells: Record<string, unknown>; expected_updated_at: string | null }>
  inserts: Array<{ client_id: string; cells: Record<string, unknown> }>
}

/** What a save sends: the changed cells of each edited row (with the version it was edited against) and the new rows. */
export function buildBatch(state: EditAllState, options: { insertable?: (col: string) => boolean } = {}): EditAllBatch {
  const rows = Object.entries(state.drafts)
    .filter(([, cells]) => Object.keys(cells).length)
    .map(([row_id, cells]) => ({ row_id, cells, expected_updated_at: state.versions[row_id] ?? null }))
  const inserts = state.added
    .filter((r) => !isBlankNewRow(r.values))
    .map((r) => ({ client_id: r.id, cells: Object.fromEntries(Object.entries(r.values).filter(([k, v]) => v !== undefined && (!options.insertable || options.insertable(k)))) }))
  return { rows, inserts }
}

/** One row's outcome of a batch save (lib/services/data-table-views.ts writeGridRows). */
export type RowSaveOutcome =
  | { row_id: string; status: 'saved' | 'unchanged'; row: { data?: Record<string, unknown>; updated_at?: string | null; created_at?: string | null } }
  | { row_id: string; status: 'conflict'; error: string; current?: { data?: Record<string, unknown>; updated_at?: string | null; created_at?: string | null } | null }
  | { row_id: string; status: 'invalid' | 'not_found' | 'forbidden' | 'error'; error: string; cells?: Record<string, string> }

export type InsertSaveOutcome =
  | { client_id: string; status: 'saved'; row: { id: string; data?: Record<string, unknown>; updated_at?: string | null; created_at?: string | null } }
  | { client_id: string; status: 'invalid' | 'forbidden' | 'error'; error: string; cells?: Record<string, string> }

export interface BatchSaveResult {
  rows: RowSaveOutcome[]
  inserts: InsertSaveOutcome[]
}

const versionOf = (row: { updated_at?: string | null; created_at?: string | null } | null | undefined) => row?.updated_at ?? row?.created_at ?? null

/**
 * Fold a batch's outcome into the session: saved rows take the server's
 * values and version and lose their drafts (so a retry never re-sends
 * them); refused rows keep their drafts with the errors on their cells (a
 * row-level error on the row's first changed cell); conflicts keep the
 * drafts and remember the server's row for "keep mine / take theirs".
 * Saved new rows leave `added` (`inserted` lists them for the caller).
 */
export function applyBatchResult(state: EditAllState, result: BatchSaveResult): { state: EditAllState; saved: number; failed: number; conflicts: number; inserted: Array<{ client_id: string; row: { id: string; data?: Record<string, unknown>; updated_at?: string | null; created_at?: string | null } }> } {
  const base = { ...state.base }
  const versions = { ...state.versions }
  const drafts = { ...state.drafts }
  let errors = { ...state.errors }
  const conflicts = { ...state.conflicts }
  const locked = { ...state.locked }
  let added = state.added
  let saved = 0, failed = 0, nConflicts = 0
  const inserted: Array<{ client_id: string; row: { id: string; data?: Record<string, unknown>; updated_at?: string | null; created_at?: string | null } }> = []
  for (const outcome of result.rows) {
    const key = outcome.row_id
    if (outcome.status === 'saved' || outcome.status === 'unchanged') {
      base[key] = outcome.row.data ?? { ...(base[key] ?? {}), ...(drafts[key] ?? {}) }
      versions[key] = versionOf(outcome.row) ?? versions[key] ?? null
      delete drafts[key]
      delete errors[key]
      delete conflicts[key]
      saved++
      continue
    }
    if (outcome.status === 'conflict') {
      conflicts[key] = { theirs: outcome.current?.data ?? base[key] ?? {}, version: versionOf(outcome.current) ?? versions[key] ?? null, message: outcome.error }
      nConflicts++
      continue
    }
    failed++
    if (outcome.status === 'forbidden' || outcome.status === 'not_found') {
      // The row can't be changed by this person (or is gone): read-only from now on, its drafts dropped.
      locked[key] = outcome.error
      delete drafts[key]
      delete errors[key]
      continue
    }
    const refused = outcome as unknown as { error: string; cells?: Record<string, string> }
    const cellErrors = refused.cells && Object.keys(refused.cells).length ? refused.cells : { [Object.keys(drafts[key] ?? {})[0] ?? '_row']: refused.error }
    errors = { ...errors, [key]: { ...(errors[key] ?? {}), ...cellErrors } }
  }
  for (const outcome of result.inserts ?? []) {
    if (outcome.status === 'saved') {
      added = added.filter((r) => r.id !== outcome.client_id)
      delete errors[outcome.client_id]
      inserted.push({ client_id: outcome.client_id, row: outcome.row })
      saved++
      continue
    }
    failed++
    const first = Object.keys(added.find((r) => r.id === outcome.client_id)?.values ?? {})[0] ?? '_row'
    errors = { ...errors, [outcome.client_id]: { ...(errors[outcome.client_id] ?? {}), ...(outcome.cells && Object.keys(outcome.cells).length ? outcome.cells : { [first]: outcome.error }) } }
  }
  return { state: { ...state, base, versions, drafts, errors, conflicts, locked, added }, saved, failed, conflicts: nConflicts, inserted }
}

/**
 * Settle a conflict. 'theirs': the server's row becomes the base and our
 * drafts on it go. 'mine': the server's row becomes the base (its version
 * is the one the next save names) and our drafts stay — the next save
 * writes them over the newer row. Drafts equal to theirs drop out.
 */
export function resolveConflict(state: EditAllState, row: string, choice: 'mine' | 'theirs'): EditAllState {
  const conflict = state.conflicts[row]
  if (!conflict) return state
  const conflicts = { ...state.conflicts }
  delete conflicts[row]
  const base = { ...state.base, [row]: conflict.theirs }
  const versions = { ...state.versions, [row]: conflict.version }
  const drafts = { ...state.drafts }
  const errors = { ...state.errors }
  delete errors[row]
  if (choice === 'theirs') delete drafts[row]
  else if (drafts[row]) {
    const kept = Object.fromEntries(Object.entries(drafts[row]).filter(([col, v]) => !sameGridValue(v, conflict.theirs[col])))
    if (Object.keys(kept).length) drafts[row] = kept
    else delete drafts[row]
  }
  return { ...state, base, versions, drafts, errors, conflicts }
}

/* ── Selection, fill down ─────────────────────────────────────────────── */

export interface CellPos { r: number; c: number }
export interface CellRange { r1: number; c1: number; r2: number; c2: number }

/** The rectangle between an anchor and the focused cell (inclusive, ordered). */
export function rangeOf(anchor: CellPos, focus: CellPos): CellRange {
  return { r1: Math.min(anchor.r, focus.r), r2: Math.max(anchor.r, focus.r), c1: Math.min(anchor.c, focus.c), c2: Math.max(anchor.c, focus.c) }
}

export function inRange(range: CellRange | null, r: number, c: number): boolean {
  return Boolean(range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2)
}

/**
 * Fill down (Ctrl/Cmd+D), as in a spreadsheet: a range copies its top row
 * into the rows below; one row (or one cell) copies the row above into it.
 * Read-only targets are skipped.
 */
export function planFillDown(params: {
  range: CellRange
  rowKeys: string[]
  colKeys: string[]
  value: (row: string, col: string) => unknown
  canEdit: (row: string, col: string) => boolean
}): { changes: CellChange[]; skipped: number } {
  const { range, rowKeys, colKeys, value, canEdit } = params
  const sourceRow = range.r1 === range.r2 ? range.r1 - 1 : range.r1
  const firstTarget = range.r1 === range.r2 ? range.r1 : range.r1 + 1
  if (sourceRow < 0 || !rowKeys[sourceRow]) return { changes: [], skipped: 0 }
  const changes: CellChange[] = []
  let skipped = 0
  for (let r = firstTarget; r <= range.r2; r++) {
    const row = rowKeys[r]
    if (!row) continue
    for (let c = range.c1; c <= range.c2; c++) {
      const col = colKeys[c]
      if (!col) continue
      if (!canEdit(row, col)) { skipped++; continue }
      changes.push({ row, col, value: value(rowKeys[sourceRow], col) })
    }
  }
  return { changes, skipped }
}

/* ── Keys on a focused cell (not editing) ─────────────────────────────── */

export type EditAllKeyAction =
  | { type: 'move'; dr: number; dc: number; extend: boolean }
  | { type: 'tab'; back: boolean }
  | { type: 'edge'; to: 'row-start' | 'row-end' | 'first' | 'last' }
  | { type: 'edit'; initial?: string }
  | { type: 'revert' }
  | { type: 'clear' }
  | { type: 'toggle' }
  | { type: 'undo' }
  | { type: 'fill-down' }
  | { type: 'save' }

export interface KeyLike { key: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; isComposing?: boolean }

/**
 * What a key does on a focused cell of an "Edit all rows" grid while no
 * cell editor is open: arrows move (Shift extends the selection), Tab /
 * Shift+Tab move sideways, Enter moves down when `enterEdits` is false (the
 * cell is a checkbox) and otherwise opens the editor, F2 edits, a printable
 * key starts editing with that character, Esc reverts the cell, Delete /
 * Backspace clears it, Space toggles a yes / no cell, Ctrl/Cmd+Z undoes,
 * Ctrl/Cmd+D fills down, Ctrl/Cmd+S (or Enter with Ctrl/Cmd) saves.
 */
export function editAllKeyAction(e: KeyLike, cell: { editable: boolean; boolean?: boolean }): EditAllKeyAction | null {
  if (e.isComposing) return null
  const mod = Boolean(e.ctrlKey || e.metaKey)
  const k = e.key
  if (mod && !e.altKey) {
    const lower = k.toLowerCase()
    if (lower === 'z' && !e.shiftKey) return { type: 'undo' }
    if (lower === 'd') return { type: 'fill-down' }
    if (lower === 's' || k === 'Enter') return { type: 'save' }
    if (k === 'Home') return { type: 'edge', to: 'first' }
    if (k === 'End') return { type: 'edge', to: 'last' }
    return null
  }
  switch (k) {
    case 'ArrowUp': return { type: 'move', dr: -1, dc: 0, extend: Boolean(e.shiftKey) }
    case 'ArrowDown': return { type: 'move', dr: 1, dc: 0, extend: Boolean(e.shiftKey) }
    case 'ArrowLeft': return { type: 'move', dr: 0, dc: -1, extend: Boolean(e.shiftKey) }
    case 'ArrowRight': return { type: 'move', dr: 0, dc: 1, extend: Boolean(e.shiftKey) }
    case 'PageDown': return { type: 'move', dr: 10, dc: 0, extend: Boolean(e.shiftKey) }
    case 'PageUp': return { type: 'move', dr: -10, dc: 0, extend: Boolean(e.shiftKey) }
    case 'Home': return { type: 'edge', to: 'row-start' }
    case 'End': return { type: 'edge', to: 'row-end' }
    case 'Tab': return { type: 'tab', back: Boolean(e.shiftKey) }
    case 'Escape': return cell.editable ? { type: 'revert' } : null
    case 'Enter': return cell.editable && !cell.boolean ? { type: 'edit' } : { type: 'move', dr: e.shiftKey ? -1 : 1, dc: 0, extend: false }
    case 'F2': return cell.editable && !cell.boolean ? { type: 'edit' } : null
    case 'Delete': case 'Backspace': return cell.editable ? { type: 'clear' } : null
    case ' ': return cell.editable && cell.boolean ? { type: 'toggle' } : cell.editable ? { type: 'edit', initial: ' ' } : null
  }
  if (k.length === 1 && !e.altKey && cell.editable && !cell.boolean) return { type: 'edit', initial: k }
  return null
}
