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

/** Child-record relations of a table (table designer): checked against the child tables; data.edit_schema. */
export async function saveChildRelations(tableId: string, relations: unknown[]) {
  return runAction('saveChildRelations', 'The child records could not be saved.', async () => {
    const { updateDataTable } = await import('@/lib/services/data-tables')
    const table = await updateDataTable(await fromSession(), tableId, { child_relations: relations })
    return { child_relations: (table as { child_relations?: unknown[] }).child_relations ?? [] }
  })
}

/**
 * "Add child" under a row: a new row of the relation's child table whose
 * lookup cell holds the parent's link value — worked out on the server from
 * the saved relation and the parent row (the browser only names them).
 */
export async function addChildRow(parentTableId: string, parentRowId: string, relationId: string) {
  return runAction('addChildRow', 'The child row could not be added.', async () => {
    const ctx = await fromSession()
    const { loadChildRows } = await import('@/lib/services/data-table-grouping')
    const { upsertRows } = await import('@/lib/services/data-tables')
    const { ServiceError } = await import('@/lib/services/context')
    const child = await loadChildRows(ctx.supabase as never, parentTableId, parentRowId, relationId, { limit: 1, offset: 0 })
    if (child.link_value === null) throw ServiceError.validation('This row has no value in the column its children link to, so a child can\'t point at it yet')
    const [written] = await upsertRows(ctx, child.table.id, [{ data: { [child.lookup_column]: child.link_value } }])
    return { row_id: written.row_id, table_id: child.table.id }
  })
}

/** Inline edit of a child row (a child record panel): through the child table's view when it allows inline editing, else a validated cell merge. */
export async function writeChildCells(childTableId: string, rowId: string, input: { view_id: string; cells: Record<string, unknown>; expected_updated_at?: string | null }): Promise<GridCellWriteResult> {
  if (input.view_id !== 'default') return writeGridCells(childTableId, rowId, input)
  try {
    const { updateRow } = await import('@/lib/services/data-tables')
    const row = await updateRow(await fromSession(), childTableId, rowId, input.cells)
    return { ok: true, data: { row, updated_at: String(row.updated_at ?? ''), changed: Object.keys(input.cells) } }
  } catch (error) {
    if (isServiceError(error)) return { ok: false, error: error.message }
    console.error('[writeChildCells]', error)
    return { ok: false, error: 'The cell could not be saved — try again.' }
  }
}

/** Turn a table's field-change history on or off (data.edit_schema; migration 20270128090000). */
export async function saveTableAudit(tableId: string, enabled: boolean) {
  return runAction('saveTableAudit', 'The change history setting could not be saved.', async () => {
    const { updateDataTable } = await import('@/lib/services/data-tables')
    const table = await updateDataTable(await fromSession(), tableId, { audit_changes: enabled })
    return { audited: !!(table as { audit_changes?: boolean }).audit_changes }
  })
}
