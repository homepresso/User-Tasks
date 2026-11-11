/**
 * Pending-row markers shared by the List field (lib/forms/list-field.ts) and
 * the editable Data table field (lib/forms/data-table.ts) — the editable
 * table rules (lib/forms/row-rules.ts): New row, Set row values, Commit,
 * Discard / Revert.
 */

import { isPlainObject } from '@/lib/utils/guards'

/**
 * Row markers (kept in the row object while the form is open — drafts and
 * autosave keep them; the stored value never does: coerceListRow keeps the
 * columns only):
 *  - `__draft`: 'new' (made by "New row", never committed) or 'edited'
 *    (changed by "Set row values" since its last commit);
 *  - `__original`: an edited row's values at its last commit (Revert);
 *  - `__errors`: column → message from a failed "Commit row".
 */
export const ROW_DRAFT_KEY = '__draft'
export const ROW_ORIGINAL_KEY = '__original'
export const ROW_ERRORS_KEY = '__errors'
/** A Data table's new row: a stable id while it is pending (the current row follows it when rows are added before it). */
export const ROW_ID_KEY = '__rid'

export type RowDraftState = 'new' | 'edited'

/** A row's pending state (null: committed). */
export function rowDraftState(row: Record<string, unknown> | null | undefined): RowDraftState | null {
  const v = row?.[ROW_DRAFT_KEY]
  return v === 'new' || v === 'edited' ? v : null
}

/** A row's cell errors from a failed commit. */
export function rowCellErrors(row: Record<string, unknown> | null | undefined): Record<string, string> {
  const v = row?.[ROW_ERRORS_KEY]
  return isPlainObject(v) ? Object.fromEntries(Object.entries(v).filter(([, m]) => typeof m === 'string')) as Record<string, string> : {}
}

/** The row without its markers (what is committed). */
export function stripRowMarkers<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row }
  delete out[ROW_DRAFT_KEY]
  delete out[ROW_ORIGINAL_KEY]
  delete out[ROW_ERRORS_KEY]
  delete out[ROW_ID_KEY]
  return out
}

