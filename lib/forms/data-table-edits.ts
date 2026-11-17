/**
 * Folding cell edits into an editable Data table's value (the change set,
 * lib/forms/data-table.ts) — what one cell edit does on the form, and what
 * an "Edit all rows" session (lib/grid/edit-all.ts) does with a whole batch
 * of edits in ONE value update. Existing rows keep `updated` entries with
 * only the cells that differ from the row as loaded (a cell typed back to
 * its loaded value drops out; a row with nothing left drops out); added rows
 * are found by their row id (ROW_ID_KEY). The "for each changed row" rules
 * (lib/forms/table-changes.ts) read the result as they read single edits.
 * Pure.
 */

import { changedFields, type DataTableChangeSet, type DataTableFieldConfig } from './data-table'
import { ROW_ID_KEY } from './row-markers'

export type TableEdit =
  | { kind: 'row'; key: string; before: Record<string, unknown>; col: string; value: unknown }
  | { kind: 'added'; rid: string; col: string; value: unknown }

/** Apply cell edits to a change set, in order; returns the new change set. */
export function applyTableEdits(config: DataTableFieldConfig, changes: DataTableChangeSet, edits: TableEdit[]): DataTableChangeSet {
  let added = changes.added
  let updated = changes.updated
  for (const edit of edits) {
    if (edit.kind === 'added') {
      added = added.map((r) => (String(r[ROW_ID_KEY] ?? '') === edit.rid ? { ...r, [edit.col]: edit.value } : r))
      continue
    }
    const existing = updated.find((u) => u.key === edit.key)
    const after = { ...(existing?.after ?? {}), [edit.col]: edit.value }
    const before = existing?.before ?? edit.before
    const changed = changedFields(config, before, after)
    const kept = Object.fromEntries(changed.map((k) => [k, after[k]]))
    const errors = { ...(existing?.errors ?? {}) }
    delete errors[edit.col]
    updated = updated.filter((u) => u.key !== edit.key)
    if (changed.length) updated = [...updated, { key: edit.key, before, after: kept, changed_fields: changed, ...(existing?.draft ? { draft: true } : {}), ...(Object.keys(errors).length ? { errors } : {}) }]
  }
  return { ...changes, added, updated }
}
