'use server'

import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSession, isServiceError } from '@/lib/services/context'
import * as views from '@/lib/services/data-table-views'

/**
 * The Data grid's server actions (components/data/data-grid.tsx): its views
 * (columns, controls, bindings, inline editing), inline cell writes and a
 * bound column's options. Everything is decided by lib/services/data-table-views
 * from the SAVED view — the browser only names the view, the column and the
 * values.
 */

export async function getGridViews(tableId: string) {
  return runAction('getGridViews', 'The views could not be loaded.', async () => views.getTableViews(await fromSession(), tableId))
}

export async function saveGridViews(tableId: string, list: unknown[]) {
  return runAction('saveGridViews', 'The views could not be saved.', async () => views.saveTableViews(await fromSession(), tableId, list))
}

export type GridCellWriteResult =
  | { ok: true; data: { row: Record<string, unknown>; updated_at: string; changed: string[] } }
  | { ok: false; error: string; conflict?: { row: Record<string, unknown> | null }; cells?: Record<string, string> }

/** One row's inline edit: a conflict carries the current row; a refused cell names the column. */
export async function writeGridCells(tableId: string, rowId: string, input: views.GridCellWriteInput): Promise<GridCellWriteResult> {
  try {
    return { ok: true, data: await views.writeGridCells(await fromSession(), tableId, rowId, input) }
  } catch (error) {
    if (isServiceError(error)) {
      const details = (error.details ?? {}) as { row?: Record<string, unknown>; cells?: Record<string, string> }
      if (error.code === 'conflict') return { ok: false, error: error.message, conflict: { row: details.row ?? null } }
      return { ok: false, error: error.message, ...(details.cells ? { cells: details.cells } : {}) }
    }
    console.error('[writeGridCells]', error)
    return { ok: false, error: 'The cell could not be saved — try again.' }
  }
}

export async function gridOptions(tableId: string, viewId: string, input: views.GridOptionsInput): Promise<ActionResult<Awaited<ReturnType<typeof views.gridColumnOptions>>>> {
  return runAction('gridOptions', 'The options are not available right now.', async () => views.gridColumnOptions(await fromSession(), tableId, viewId, input))
}

export type GridRowsWriteResult = ActionResult<Awaited<ReturnType<typeof views.writeGridRows>>>

/** "Edit all rows": one batch of edited and new rows — an outcome per row (saved rows are never re-sent). */
export async function writeGridRows(tableId: string, input: views.GridRowsWriteInput): Promise<GridRowsWriteResult> {
  return runAction('writeGridRows', 'The rows could not be saved — try again.', async () => views.writeGridRows(await fromSession(), tableId, input))
}
