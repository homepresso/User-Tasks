/**
 * Form layout: a simple grid of rows. Each row has 1–4 columns and an ordered
 * list of cells; each cell holds one field (by key) spanning 1..columns
 * columns. Cells flow left to right; a row's spans never exceed its column
 * count. On narrow screens every row collapses to one column.
 *
 * Stored beside the field list (node config `form_layout`, task metadata
 * `form_layout`, reusable forms' `layout`). Absent → the task screen renders
 * the fields as it always has. Every operation here is pure and returns a new
 * layout (the designer's undo history keeps the old ones).
 */

import { isPlainObject } from '@/lib/utils/guards'

export const MAX_FORM_COLUMNS = 4
export const MAX_FORM_ROWS = 200

export interface FormCell {
  field_key: string
  span: number
}

export interface FormRow {
  columns: number
  cells: FormCell[]
}

export interface FormLayout {
  rows: FormRow[]
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const int = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

export function rowUsed(row: FormRow): number {
  return row.cells.reduce((sum, cell) => sum + cell.span, 0)
}

export function rowFree(row: FormRow): number {
  return Math.max(0, row.columns - rowUsed(row))
}

/**
 * Clean a stored layout against the field keys: columns 1–4, spans
 * 1..columns, unknown / duplicate keys dropped, a row that overflows wraps
 * its extra cells onto a new row with the same column count. Fields not
 * placed anywhere are appended, one per full-width row, so nothing the
 * assignee must fill in is ever lost. Returns null when there is no layout.
 */
export function normalizeFormLayout(raw: unknown, fieldKeys: string[]): FormLayout | null {
  if (!isPlainObject(raw) || !Array.isArray(raw.rows)) return null
  const known = new Set(fieldKeys)
  const placed = new Set<string>()
  const rows: FormRow[] = []
  for (const rawRow of raw.rows.slice(0, MAX_FORM_ROWS)) {
    if (!isPlainObject(rawRow)) continue
    const columns = clamp(int(rawRow.columns, 1), 1, MAX_FORM_COLUMNS)
    let current: FormRow = { columns, cells: [] }
    const cells = Array.isArray(rawRow.cells) ? rawRow.cells : []
    for (const rawCell of cells) {
      if (!isPlainObject(rawCell)) continue
      const key = typeof rawCell.field_key === 'string' ? rawCell.field_key : ''
      if (!known.has(key) || placed.has(key)) continue
      placed.add(key)
      const span = clamp(int(rawCell.span, 1), 1, columns)
      if (rowUsed(current) + span > columns) {
        rows.push(current)
        current = { columns, cells: [] }
      }
      current.cells.push({ field_key: key, span })
    }
    rows.push(current)
  }
  for (const key of fieldKeys) {
    if (!placed.has(key)) rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
  }
  return { rows }
}

/** The layout fields have without one: one full-width row per field (the designer's starting grid). */
export function defaultFormLayout(fieldKeys: string[]): FormLayout {
  return { rows: fieldKeys.map((key) => ({ columns: 1, cells: [{ field_key: key, span: 1 }] })) }
}

/** Layout for rendering: rows without cells dropped. */
export function renderableRows(layout: FormLayout): FormRow[] {
  return layout.rows.filter((row) => row.cells.length > 0)
}

/** Field keys in reading order (row by row, left to right). */
export function layoutKeyOrder(layout: FormLayout): string[] {
  return layout.rows.flatMap((row) => row.cells.map((cell) => cell.field_key))
}

/** Where a field sits, or null. */
export function findCell(layout: FormLayout, key: string): { row: number; index: number } | null {
  for (let r = 0; r < layout.rows.length; r++) {
    const index = layout.rows[r].cells.findIndex((cell) => cell.field_key === key)
    if (index >= 0) return { row: r, index }
  }
  return null
}

function cloneRows(layout: FormLayout): FormRow[] {
  return layout.rows.map((row) => ({ columns: row.columns, cells: row.cells.map((cell) => ({ ...cell })) }))
}

/** Insert an empty row at `at` (default: the end). */
export function addRow(layout: FormLayout, columns = 1, at?: number): FormLayout {
  if (layout.rows.length >= MAX_FORM_ROWS) return layout
  const rows = cloneRows(layout)
  const index = at === undefined ? rows.length : clamp(at, 0, rows.length)
  rows.splice(index, 0, { columns: clamp(columns, 1, MAX_FORM_COLUMNS), cells: [] })
  return { rows }
}

/**
 * Remove a row. Its fields are returned (they leave the grid; the designer
 * either deletes them or puts them back in the palette's "unplaced" list).
 */
export function removeRow(layout: FormLayout, rowIndex: number): { layout: FormLayout; removedKeys: string[] } {
  const row = layout.rows[rowIndex]
  if (!row) return { layout, removedKeys: [] }
  const rows = cloneRows(layout)
  rows.splice(rowIndex, 1)
  return { layout: { rows }, removedKeys: row.cells.map((cell) => cell.field_key) }
}

export function moveRow(layout: FormLayout, rowIndex: number, delta: number): FormLayout {
  const target = rowIndex + delta
  if (!layout.rows[rowIndex] || target < 0 || target >= layout.rows.length) return layout
  const rows = cloneRows(layout)
  const [row] = rows.splice(rowIndex, 1)
  rows.splice(target, 0, row)
  return { rows }
}

/**
 * Change a row's column count. Spans shrink to fit; cells that no longer
 * fit wrap onto a new row inserted right after it (same column count).
 */
export function setRowColumns(layout: FormLayout, rowIndex: number, columns: number): FormLayout {
  const row = layout.rows[rowIndex]
  if (!row) return layout
  const cols = clamp(Math.floor(columns), 1, MAX_FORM_COLUMNS)
  const rows = cloneRows(layout)
  const wrapped: FormRow[] = []
  let current: FormRow = { columns: cols, cells: [] }
  for (const cell of row.cells) {
    const span = Math.min(cell.span, cols)
    if (rowUsed(current) + span > cols) {
      wrapped.push(current)
      current = { columns: cols, cells: [] }
    }
    current.cells.push({ field_key: cell.field_key, span })
  }
  wrapped.push(current)
  rows.splice(rowIndex, 1, ...wrapped)
  return { rows }
}

/** Set a cell's span (clamped to the row's free space plus its own span). */
export function setCellSpan(layout: FormLayout, key: string, span: number): FormLayout {
  const at = findCell(layout, key)
  if (!at) return layout
  const rows = cloneRows(layout)
  const row = rows[at.row]
  const cell = row.cells[at.index]
  const max = row.columns - (rowUsed(row) - cell.span)
  cell.span = clamp(Math.floor(span), 1, Math.max(1, max))
  return { rows }
}

/**
 * Put a field into row `rowIndex` at cell position `index` (removing it from
 * where it was). When the row has no room the field takes a new row inserted
 * right after the target row instead — a drop never silently overflows.
 * `rowIndex === rows.length` appends a new one-column row.
 */
export function placeField(layout: FormLayout, key: string, rowIndex: number, index: number, span = 1): FormLayout {
  const from = findCell(layout, key)
  const rows = cloneRows(layout)
  let keepSpan = span
  if (from) {
    keepSpan = rows[from.row].cells[from.index].span
    rows[from.row].cells.splice(from.index, 1)
  }
  if (rowIndex >= rows.length) {
    rows.push({ columns: 1, cells: [{ field_key: key, span: 1 }] })
    return { rows }
  }
  const target = rows[Math.max(0, rowIndex)]
  const fitSpan = Math.min(Math.max(1, keepSpan), target.columns)
  if (rowUsed(target) + fitSpan <= target.columns) {
    target.cells.splice(clamp(index, 0, target.cells.length), 0, { field_key: key, span: fitSpan })
  } else if (rowUsed(target) + 1 <= target.columns) {
    target.cells.splice(clamp(index, 0, target.cells.length), 0, { field_key: key, span: 1 })
  } else {
    rows.splice(Math.max(0, rowIndex) + 1, 0, { columns: target.columns, cells: [{ field_key: key, span: fitSpan }] })
  }
  return { rows }
}

/** Keyboard move: one cell left/right within the row, or to the previous/next row. */
export function nudgeField(layout: FormLayout, key: string, direction: 'left' | 'right' | 'up' | 'down'): FormLayout {
  const at = findCell(layout, key)
  if (!at) return layout
  const row = layout.rows[at.row]
  if (direction === 'left' || direction === 'right') {
    const target = at.index + (direction === 'left' ? -1 : 1)
    if (target < 0 || target >= row.cells.length) return layout
    const rows = cloneRows(layout)
    const cells = rows[at.row].cells
    ;[cells[at.index], cells[target]] = [cells[target], cells[at.index]]
    return { rows }
  }
  const targetRow = at.row + (direction === 'up' ? -1 : 1)
  if (targetRow < 0) return layout
  if (targetRow >= layout.rows.length) {
    if (row.cells.length === 1) return layout
    return placeField(layout, key, layout.rows.length, 0)
  }
  const index = direction === 'up' ? layout.rows[targetRow].cells.length : 0
  return placeField(layout, key, targetRow, index)
}

/** Remove a field from the grid (its row stays, possibly empty). */
export function removeFieldFromLayout(layout: FormLayout, key: string): FormLayout {
  return { rows: layout.rows.map((row) => ({ columns: row.columns, cells: row.cells.filter((cell) => cell.field_key !== key).map((cell) => ({ ...cell })) })) }
}

/** Rename a key everywhere in the layout. */
export function renameLayoutKey(layout: FormLayout, from: string, to: string): FormLayout {
  return { rows: layout.rows.map((row) => ({ columns: row.columns, cells: row.cells.map((cell) => (cell.field_key === from ? { ...cell, field_key: to } : { ...cell })) })) }
}

/** Compact stored form: rows without cells dropped; null when it is just one full-width row per field in field order. */
export function compactLayoutForSave(layout: FormLayout, fieldKeys: string[]): FormLayout | null {
  const rows = renderableRows(layout).map((row) => ({ columns: row.columns, cells: row.cells.map((cell) => ({ field_key: cell.field_key, span: cell.span })) }))
  const trivial = rows.length === fieldKeys.length && rows.every((row, i) => row.columns === 1 && row.cells.length === 1 && row.cells[0].field_key === fieldKeys[i])
  return trivial ? null : { rows }
}
