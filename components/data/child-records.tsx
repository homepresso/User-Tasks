'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InlineNotice } from '@/components/ui/inline-notice'
import { GridSurfaceProvider, GridLabelsProvider, usePageLabels, type GridSurface } from '@/components/grid/grid-context'
import { GridCellEditor, editorFloats } from '@/components/grid/cell-editor'
import { GridCellDisplay } from '@/components/grid/cell-display'
import { addChildRow, gridOptions, writeChildCells } from '@/app/actions/data-grid'
import { serverRead } from '@/lib/server-read'
import { getCellValue } from '@/lib/data-table-cells'
import { expectedVersion, optimisticRow, settleSave, type SaveAnswer } from '@/lib/grid/inline-save'
import { isColumnEditable, normalizeGridViews, pickView, schemaColumns, type GridColumnDef } from '@/lib/grid/column-model'
import { GROUPING_LIMITS, nextAncestors, type ChildRelation } from '@/lib/grid/grouping'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows are free-form jsonb */

export type RelationWithName = ChildRelation & { table_name: string }

/** Expanded child panels (`<rowId>:<relationId>`), remembered per user per view by the grid. */
export interface ChildExpandState {
  isOpen: (key: string) => boolean
  toggle: (key: string) => void
}

const PAGE = 50

/** The chevron + count that opens a row's child records of one relation. */
export function ChildToggle({ relation, count, open, onToggle, rowLabel }: { relation: RelationWithName; count: number | undefined; open: boolean; onToggle: () => void; rowLabel: string }) {
  const label = relation.label || relation.table_name || 'Children'
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onToggle() }} aria-expanded={open}
      aria-label={`${open ? 'Hide' : 'Show'} ${label} of row ${rowLabel}${count !== undefined ? ` (${count})` : ''}`}
      title={label}
      data-child-toggle={relation.id}
      className={cn('inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-xs hover:bg-subtle', count ? 'text-fg' : 'text-fg-muted')}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="num">{count ?? '…'}</span>
    </button>
  )
}

/**
 * A row's child records of one relation, drawn inline under the row: the
 * child table's own columns (its default view, without the link column),
 * cells edited in place, "Add child" (pre-linked to the parent on the
 * server), and — when the child rows have child relations of their own
 * (a same-table hierarchy, or a chain of tables) — nested levels, indented,
 * with a cycle guard. Loaded when expanded; 50 rows at a time.
 */
export function ChildRecords({ parentTableId, parentRowId, relation, depth, ancestors, expand, canManage }: {
  parentTableId: string
  parentRowId: string
  relation: RelationWithName
  depth: number
  /** Row ids above this panel (hierarchy cycle guard). */
  ancestors: string[]
  expand: ChildExpandState
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const [limit, setLimit] = useState(PAGE)
  const [editing, setEditing] = useState<{ row: string; col: string } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [local, setLocal] = useState<Record<string, any>>({})
  const queryKey = ['custom-table-rows', parentTableId, 'children', parentRowId, relation.id, limit]
  const { data, isLoading, error } = useQuery({
    queryKey,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await serverRead('data.childRows', { tableId: parentTableId, rowId: parentRowId, relationId: relation.id, limit, offset: 0 })
      if (res.error) throw new Error(res.error.message)
      return res.data as { rows: any[]; total: number; link_value: string | null; lookup_column: string; table: { id: string; name: string; columns: any[]; views: any[] } }
    },
  })
  // Optimistic edits until the next read.
  useEffect(() => { setLocal({}) }, [data])
  const childTableId = data?.table.id ?? relation.table_id
  const tableColumns = useMemo(() => schemaColumns(data?.table.columns ?? []), [data])
  const view = useMemo(() => pickView(normalizeGridViews(data?.table.views ?? [], tableColumns), null, tableColumns), [data, tableColumns])
  const cols = useMemo(() => view.columns.filter((c) => !c.hidden && c.key !== data?.lookup_column).slice(0, 12), [view, data])
  const inlineView = view.id !== 'default' && view.inline_edit === true
  const rows = useMemo(() => (data?.rows ?? []).map((r) => local[r.id] ?? r), [data, local])

  // Grandchildren: the child rows' own relations and counts (one read for the panel).
  const { data: nested } = useQuery({
    queryKey: ['data-child-counts', childTableId, rows.map((r) => r.id).join(',')],
    enabled: rows.length > 0 && depth + 1 < GROUPING_LIMITS.depth,
    staleTime: 15_000,
    queryFn: async () => ((await serverRead('data.childCounts', { tableId: childTableId, rowIds: rows.map((r) => r.id).slice(0, GROUPING_LIMITS.countParents) })).data ?? { relations: [], counts: {} }) as { relations: RelationWithName[]; counts: Record<string, Record<string, number>> },
  })

  const surface = useMemo<GridSurface>(() => ({
    scope: `grid:${childTableId}:${view.id}`,
    fetchOptions: async (req) => {
      const res = await gridOptions(childTableId, view.id, { column: req.column, query: req.query, resolve: req.resolve, row: req.row })
      if (!res.ok) throw new Error(res.error)
      return res.data
    },
    people: [],
  }), [childTableId, view.id])
  const labels = usePageLabels(cols, useMemo(() => rows.map((r) => r.data ?? {}), [rows]), surface)

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['custom-table-rows', parentTableId, 'children', parentRowId, relation.id] })
    queryClient.invalidateQueries({ queryKey: ['data-child-counts'] })
  }

  async function save(row: any, col: GridColumnDef, value: unknown) {
    setNotice(null)
    const previous = row
    setLocal((m) => ({ ...m, [row.id]: optimisticRow(row, { [col.key]: value }) }))
    const res = await writeChildCells(childTableId, row.id, { view_id: inlineView ? view.id : 'default', cells: { [col.key]: value }, expected_updated_at: expectedVersion(row) })
    const outcome = settleSave(previous, col, res as SaveAnswer)
    setLocal((m) => ({ ...m, [row.id]: outcome.row }))
    if (outcome.cellError || outcome.notice) setNotice(outcome.cellError ?? outcome.notice?.message ?? null)
  }

  async function addChild() {
    setAdding(true); setNotice(null)
    const res = await addChildRow(parentTableId, parentRowId, relation.id)
    setAdding(false)
    if (!res.ok) { setNotice(res.error); return }
    refresh()
  }

  const title = relation.label || relation.table_name || 'Child records'
  const total = data?.total ?? 0
  const editable = (col: GridColumnDef) => canManage && isColumnEditable(col) && !['id', 'date_created'].includes(col.key)

  return (
    <GridSurfaceProvider value={surface}>
    <GridLabelsProvider value={labels}>
      <div className="border-l-2 border-primary/30 py-2 pl-3" style={{ marginLeft: Math.min(depth, 5) * 16 }} data-child-records={relation.id} data-depth={depth} role="group" aria-label={`${title} of the row`}>
        <div className="mb-1.5 flex items-center gap-2 text-xs">
          <span className="font-medium text-fg">{title}</span>
          <span className="num text-fg-muted">{isLoading ? 'Loading…' : plural(total, 'row')}</span>
          {canManage && (
            <Button size="sm" variant="ghost" leadingIcon={<Plus />} onClick={addChild} loading={adding} disabled={!data || data.link_value === null}
              title={data && data.link_value === null ? 'Fill in the column the children link to first' : undefined} data-child-add={relation.id}>
              Add child
            </Button>
          )}
        </div>
        {error && <InlineNotice tone="danger" message={(error as Error).message} />}
        {notice && <InlineNotice tone="warning" message={notice} onDismiss={() => setNotice(null)} />}
        {data && rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border border-border-subtle bg-panel">
            <table className="w-full border-separate border-spacing-0 text-left text-xs">
              <thead>
                <tr>
                  {nested?.relations?.length ? <th className="w-px border-b border-border-subtle px-2 py-1" /> : null}
                  <th className="border-b border-border-subtle px-2 py-1 font-medium text-fg-muted">Row</th>
                  {cols.map((c) => <th key={c.key} className="border-b border-border-subtle px-2 py-1 font-medium text-fg-muted">{c.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const rowLabel = String(row.data?.id ?? row.id.slice(0, 8))
                  const childAncestors = nextAncestors(ancestors, row.id)
                  const openRels = (nested?.relations ?? []).filter((rel) => childAncestors && expand.isOpen(`${row.id}:${rel.id}`))
                  return (
                    <Fragment key={row.id}>
                      <tr className="hover:bg-subtle" data-child-row={row.id}>
                        {nested?.relations?.length ? (
                          <td className="whitespace-nowrap border-b border-border-subtle px-1 py-1">
                            {childAncestors ? nested.relations.map((rel) => (
                              <ChildToggle key={rel.id} relation={rel} count={nested.counts[rel.id]?.[row.id]} open={expand.isOpen(`${row.id}:${rel.id}`)}
                                onToggle={() => expand.toggle(`${row.id}:${rel.id}`)} rowLabel={rowLabel} />
                            )) : <span className="text-2xs text-fg-muted" title="This row is already shown above (a loop in the hierarchy), or the hierarchy is too deep">↺</span>}
                          </td>
                        ) : null}
                        <td className="border-b border-border-subtle px-2 py-1 font-mono text-fg-muted">{rowLabel}</td>
                        {cols.map((col) => {
                          const value = getCellValue(row.data, { key: col.key, name: col.label })
                          const isEditing = editing?.row === row.id && editing?.col === col.key
                          const canEdit = editable(col)
                          return (
                            <td key={col.key} data-col={col.key}
                              className={cn('border-b border-border-subtle px-2 py-1', canEdit && 'cursor-text', isEditing && editorFloats(col) && 'relative')}
                              onDoubleClick={canEdit ? () => setEditing({ row: row.id, col: col.key }) : undefined}
                              onKeyDown={canEdit ? (e) => { if ((e.key === 'Enter' || e.key === 'F2') && !isEditing) { e.preventDefault(); setEditing({ row: row.id, col: col.key }) } } : undefined}
                              tabIndex={canEdit ? 0 : undefined}>
                              {isEditing ? (
                                <GridCellEditor col={col} value={value} row={row.data ?? {}} label={`${col.label}, child row ${rowLabel}`}
                                  onCommit={(next) => { setEditing(null); void save(row, col, next) }}
                                  onCancel={() => setEditing(null)} />
                              ) : (
                                <GridCellDisplay col={col} value={value} row={row.data ?? {}} />
                              )}
                            </td>
                          )
                        })}
                      </tr>
                      {openRels.map((rel) => (
                        <tr key={rel.id}>
                          <td colSpan={cols.length + 2} className="border-b border-border-subtle p-0">
                            <ChildRecords parentTableId={childTableId} parentRowId={row.id} relation={rel} depth={depth + 1} ancestors={childAncestors!} expand={expand} canManage={canManage} />
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && rows.length === 0 && <p className="text-xs text-fg-muted">No {title.toLowerCase()} yet.</p>}
        {data && total > rows.length && (
          <Button size="sm" variant="ghost" className="mt-1" onClick={() => setLimit((l) => Math.min(GROUPING_LIMITS.childRows, l + PAGE))} disabled={limit >= GROUPING_LIMITS.childRows}>
            {limit >= GROUPING_LIMITS.childRows ? `Showing ${rows.length} of ${total}` : `Show more (${total - rows.length} more)`}
          </Button>
        )}
        {isLoading && <Loader2 className="size-3 animate-spin text-fg-muted" aria-hidden />}
      </div>
    </GridLabelsProvider>
    </GridSurfaceProvider>
  )
}
