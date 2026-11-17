'use client'

import { useEffect, useState } from 'react'
import { Copy, Plus, Trash2 } from 'lucide-react'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { DialogBody, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { InlineNotice } from '@/components/ui/inline-notice'
import { GridColumnsEditor } from '@/components/grid/column-editor'
import { ColumnBindingEditor } from '@/components/data-sources/column-binding-editor'
import { clearGridOptionCache } from '@/components/grid/grid-context'
import {
  GRID_LIMITS, defaultGridColumns, gridViewProblem, newViewId, type GridViewConfig, type TableSchemaColumn,
} from '@/lib/grid/column-model'
import { saveGridViews } from '@/app/actions/data-grid'

/**
 * The Data grid's view settings (Sheet): the table's views (add, duplicate,
 * rename, delete, default), and per view the Columns editor of the shared
 * grid engine (components/grid/column-editor.tsx — control, options, data
 * binding, editable / read-only, required, width), the "Allow inline
 * editing (all rows)" switch, add / delete rows and the page size. Saved
 * with data.edit_schema; the server re-checks everything.
 */
export function GridViewSettings({ open, onOpenChange, tableId, tableColumns, views, viewId, onSaved }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  tableColumns: TableSchemaColumn[]
  views: GridViewConfig[]
  /** The view being looked at (edited first). */
  viewId: string
  onSaved: (views: GridViewConfig[], viewId: string) => void
}) {
  const [draft, setDraft] = useState<GridViewConfig[]>([])
  const [current, setCurrent] = useState(viewId)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const start = views.length ? views : [{ id: newViewId(), name: 'Main view', columns: defaultGridColumns(tableColumns), default: true }]
    setDraft(JSON.parse(JSON.stringify(start)))
    setCurrent(start.some((v) => v.id === viewId) ? viewId : start[0].id)
    setError(null)
  }, [open, views, viewId, tableColumns])

  const view = draft.find((v) => v.id === current) ?? draft[0]
  const patch = (p: Partial<GridViewConfig>) => setDraft((d) => d.map((v) => (v.id === view?.id ? { ...v, ...p } : v)))

  function addView(copy: boolean) {
    if (draft.length >= GRID_LIMITS.views) return
    const next: GridViewConfig = copy && view
      ? { ...JSON.parse(JSON.stringify(view)), id: newViewId(), name: `${view.name} copy`, default: undefined }
      : { id: newViewId(), name: `View ${draft.length + 1}`, columns: defaultGridColumns(tableColumns) }
    setDraft((d) => [...d, next])
    setCurrent(next.id)
  }

  async function save() {
    const problem = draft.map(gridViewProblem).find(Boolean)
    if (problem) { setError(problem); return }
    setSaving(true); setError(null)
    const res = await saveGridViews(tableId, draft)
    setSaving(false)
    if (!res.ok) { setError(res.error); return }
    clearGridOptionCache()
    onSaved(res.data.views, res.data.views.some((v) => v.id === current) ? current : res.data.views[0]?.id ?? 'default')
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent size="lg" title="View settings" description="Columns, how each cell is shown and edited, and inline editing for this view.">
        <DialogBody className="space-y-4" data-testid="grid-view-settings">
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs">
              <span className="mb-1 block font-medium text-fg-muted">View</span>
              <select className="h-8 w-full rounded border border-border bg-panel px-2 text-sm" value={view?.id ?? ''} onChange={(e) => setCurrent(e.target.value)} aria-label="View to edit">
                {draft.map((v) => <option key={v.id} value={v.id}>{v.name}{v.default ? ' (default)' : ''}</option>)}
              </select>
            </label>
            <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => addView(false)} disabled={draft.length >= GRID_LIMITS.views}>New view</Button>
            <Button size="sm" variant="secondary" leadingIcon={<Copy />} onClick={() => addView(true)} disabled={!view || draft.length >= GRID_LIMITS.views}>Duplicate</Button>
            <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} disabled={!view || draft.length <= 1}
              onClick={() => { setDraft((d) => d.filter((v) => v.id !== view!.id)); setCurrent(draft.find((v) => v.id !== view!.id)?.id ?? '') }}>Delete</Button>
          </div>

          {view && (
            <>
              <div className="grid grid-cols-[1fr_8rem] gap-2">
                <label className="text-xs"><span className="mb-1 block font-medium text-fg-muted">Name</span>
                  <input className="h-8 w-full rounded border border-border bg-panel px-2 text-sm" value={view.name} maxLength={GRID_LIMITS.viewName} onChange={(e) => patch({ name: e.target.value })} />
                </label>
                <label className="text-xs"><span className="mb-1 block font-medium text-fg-muted">Rows per page</span>
                  <input type="number" min={10} max={GRID_LIMITS.pageSize} className="h-8 w-full rounded border border-border bg-panel px-2 text-sm" value={view.page_size ?? GRID_LIMITS.defaultPageSize}
                    onChange={(e) => patch({ page_size: e.target.value ? Number(e.target.value) : undefined })} />
                </label>
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <Switch checked={view.inline_edit === true} onCheckedChange={(v) => patch(v ? { inline_edit: true } : { inline_edit: undefined, open_in_edit_mode: undefined })} label="Allow inline editing (all rows)" data-testid="grid-inline-edit" />
                <p className="text-2xs text-fg-muted">Cells of editable columns edit in place and save one cell at a time (Enter or F2 to edit, Tab and Enter to move on, Escape to cancel). Read-only, hidden and calculated columns can&apos;t be changed — the server refuses them. People need the Manage rows permission.</p>
                {view.inline_edit && (
                  <>
                    <Switch checked={view.open_in_edit_mode === true} onCheckedChange={(v) => patch({ open_in_edit_mode: v || undefined })} label="Always open in edit mode (all rows editable, saved together)" data-testid="grid-open-in-edit-mode" />
                    <p className="text-2xs text-fg-muted">Without it, people press <strong>Edit all</strong> (or Shift+E) to make every row on the page editable at once and save the changes in one go.</p>
                  </>
                )}
                <div className="flex flex-wrap gap-4">
                  <Switch checked={view.allow_add !== false && view.allow_add !== undefined} onCheckedChange={(v) => patch({ allow_add: v || undefined })} label="Add rows" />
                  <Switch checked={view.allow_delete === true} onCheckedChange={(v) => patch({ allow_delete: v || undefined })} label="Delete rows" />
                  <Switch checked={view.default === true} onCheckedChange={(v) => setDraft((d) => d.map((x) => ({ ...x, default: x.id === view.id ? (v || undefined) : undefined })))} label="Open on this view" />
                </div>
              </div>
              <div>
                <h3 className="mb-1 text-xs font-semibold text-fg">Columns</h3>
                <GridColumnsEditor columns={view.columns} tableColumns={tableColumns} onChange={(columns) => patch({ columns })}
                  renderBinding={(col, binding, onBinding) => (
                    // The same "Get the choices from…" editor as a form Data table column (the shared LookupConfig binding).
                    <ColumnBindingEditor binding={binding} onBinding={onBinding} state={{ fields: [], layout: {} as never }}
                      rowColumns={view.columns.filter((c) => c.key !== col.key).map((c) => ({ key: c.key, label: c.label }))}
                      fieldId={`grid-${view.id}-${col.key}`} fieldKey={col.key} label={col.label} />
                  )} />
              </div>
            </>
          )}
          {error && <InlineNotice tone="danger" message={error} onDismiss={() => setError(null)} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} loading={saving} data-testid="grid-save-views">Save views</Button>
        </DialogFooter>
      </SheetContent>
    </Sheet>
  )
}
