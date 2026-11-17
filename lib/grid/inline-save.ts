/**
 * The Data grid's per-cell autosave (components/data/data-grid.tsx), as
 * pure steps so the optimistic update, rollback and conflict path are
 * testable: `optimisticRow` before the request, `settleSave` with the
 * server's answer (lib/services/data-table-views.ts writeGridCells).
 *
 *  - saved     → the server's row (its data and updated_at: the next edit's version);
 *  - conflict  → the CURRENT row from the server (someone else's change shown),
 *                a friendly warning, nothing of ours kept;
 *  - refused   → the row as it was (rollback) and the cell's error.
 */

export interface GridRowLike {
  id: string
  data: Record<string, unknown>
  updated_at?: string | null
  updated_by?: string | null
  created_at?: string | null
}

export type SaveAnswer =
  | { ok: true; data: { row: Partial<GridRowLike>; changed: string[] } }
  | { ok: false; error: string; conflict?: { row: Partial<GridRowLike> | null }; cells?: Record<string, string> }

export function optimisticRow<R extends GridRowLike>(row: R, cells: Record<string, unknown>): R {
  return { ...row, data: { ...row.data, ...cells } }
}

/** The version a write names (the row's updated_at, else created_at). */
export function expectedVersion(row: GridRowLike): string | null {
  return row.updated_at ?? row.created_at ?? null
}

function withServerRow<R extends GridRowLike>(row: R, server: Partial<GridRowLike>): R {
  return { ...row, data: server.data ?? row.data, updated_at: server.updated_at ?? row.updated_at, updated_by: server.updated_by ?? row.updated_by }
}

export function settleSave<R extends GridRowLike>(previous: R, column: { key: string; label: string }, answer: SaveAnswer): {
  row: R
  cellError?: string
  notice?: { tone: 'warning' | 'danger'; message: string }
  announce: string
} {
  if (answer.ok) return { row: withServerRow(previous, answer.data.row), announce: answer.data.changed.length ? `Saved ${column.label}` : `${column.label} unchanged` }
  if (answer.conflict) {
    return { row: answer.conflict.row ? withServerRow(previous, answer.conflict.row) : previous, notice: { tone: 'warning', message: answer.error }, announce: answer.error }
  }
  const message = answer.cells?.[column.key] ?? answer.error
  return { row: previous, cellError: message, announce: `${column.label} not saved: ${message}` }
}
