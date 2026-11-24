'use client'

import { AlertTriangle, Check, Loader2, Undo2, X } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The bar of an "Edit all rows" session (lib/grid/edit-all.ts), shared by
 * the Data grid and the form Data table control: how many rows changed,
 * cells needing attention, Undo, Cancel and Save / Done. It stays in view
 * above the rows (sticky) while the person scrolls a long page.
 */
export function EditAllBar({ changedRows, errors, conflicts, canUndo, saving, onUndo, onCancel, onSave, saveLabel = 'Save', saveHint, className, hint }: {
  changedRows: number
  errors: number
  conflicts: number
  canUndo: boolean
  saving?: boolean
  onUndo: () => void
  onCancel: () => void
  onSave: () => void
  /** "Save" (the grid writes the batch) or "Done" (a form keeps the changes in its value). */
  saveLabel?: string
  saveHint?: string
  hint?: string
  className?: string
}) {
  const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
  const mod = mac ? '⌘' : 'Ctrl+'
  return (
    <div role="toolbar" aria-label="Edit all rows" data-edit-all-bar data-agent-bar=""
      className={cn('sticky top-0 z-[5] flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-primary bg-primary-wash px-3 py-1.5 text-xs text-fg shadow-sm', className)}>
      <span className="font-semibold text-primary-text">Editing all rows</span>
      <span className="num" data-edit-all-count aria-live="polite">
        {changedRows === 0 ? 'No changes yet' : `${changedRows} row${changedRows === 1 ? '' : 's'} changed`}
      </span>
      {errors > 0 && (
        <span className="inline-flex items-center gap-1 text-(--status-blocked)" data-edit-all-errors>
          <AlertTriangle className="size-3.5" aria-hidden /> {errors} cell{errors === 1 ? '' : 's'} need{errors === 1 ? 's' : ''} attention
        </span>
      )}
      {conflicts > 0 && (
        <span className="inline-flex items-center gap-1 text-warning" data-edit-all-conflicts>
          <AlertTriangle className="size-3.5" aria-hidden /> {conflicts} row{conflicts === 1 ? '' : 's'} changed by someone else
        </span>
      )}
      {hint && <span className="hidden min-w-0 truncate text-2xs text-fg-muted 2xl:inline">{hint}</span>}
      <span className="ml-auto flex items-center gap-1">
        <button type="button" onClick={onUndo} disabled={!canUndo || saving} title={`Undo (${mod}Z)`} aria-keyshortcuts={mac ? 'Meta+Z' : 'Control+Z'}
          className="inline-flex h-7 items-center gap-1 rounded-md px-2 hover:bg-panel disabled:opacity-40" data-edit-all-undo>
          <Undo2 className="size-3.5" aria-hidden /> Undo
        </button>
        <button type="button" onClick={onCancel} disabled={saving}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-panel px-2 hover:bg-subtle disabled:opacity-40" data-edit-all-cancel>
          <X className="size-3.5" aria-hidden /> {changedRows === 0 ? 'Done' : 'Cancel'}
        </button>
        <button type="button" onClick={onSave} disabled={saving || changedRows === 0} title={saveHint ?? `${saveLabel} (${mod}S)`} aria-keyshortcuts={mac ? 'Meta+S' : 'Control+S'}
          className="inline-flex h-7 items-center gap-1 rounded-md bg-primary px-2.5 font-medium text-white hover:opacity-90 disabled:opacity-40" data-edit-all-save>
          {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <Check className="size-3.5" aria-hidden />}
          {saving ? 'Saving…' : changedRows > 0 ? `${saveLabel} ${changedRows} row${changedRows === 1 ? '' : 's'}` : saveLabel}
        </button>
      </span>
    </div>
  )
}

/** The look of an editable cell in an "Edit all rows" grid: a field box around the cell's display. */
export const EDIT_ALL_FIELD = 'flex min-h-7 w-full min-w-0 items-center rounded border border-border bg-panel px-1.5 py-0.5 hover:border-border-strong'
/** A read-only cell in an "Edit all rows" grid: flat and muted (with a lock). */
export const EDIT_ALL_READONLY = 'flex min-h-7 w-full min-w-0 items-center gap-1 rounded bg-subtle px-1.5 py-0.5 text-fg-muted'
/** A changed cell's wash. */
export const EDIT_ALL_CHANGED_WASH = 'color-mix(in srgb, var(--theme-primary) 12%, transparent)'
