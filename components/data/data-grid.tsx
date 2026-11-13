'use client'

import { ExtensionToolbarActions } from '@/components/extensions/item-actions'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { insertRow, deleteRow } from '@/app/actions/data-store'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Tooltip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { TableEmpty, tdClass, thClass, trClass } from '@/components/ui/table'
import {
  Plus, Trash2, Upload, FileText, ExternalLink, Loader2, Check, X,
  PanelRightOpen, ArrowUp, ArrowDown, Type, Hash, Calendar, ToggleLeft,
  List, Paperclip, AlignLeft, Link2, Columns3,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { RowDetailDrawer, uploadRowFile } from './row-detail-drawer'
import { AddRowSheet } from './add-row-sheet'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'
import type { DataColumn } from './lookup-config'
import { columnKey, getCellValue, getCellByIdentifier } from '@/lib/data-table-cells'
import { useLookupOptions } from './use-lookup-options'

interface UserRef {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
}

interface DataRow {
  id: string
  table_id: string
  tenant_id: string
  data: Record<string, any>
  retention_policy_id?: string | null
  retention_applied_at?: string | null
  retention_policy?: {
    id: string
    name: string
    description?: string | null
    policy_mode: 'review' | 'purge_on' | 'purge_on_exact_date' | 'keep_forever'
    duration_value?: number | null
    duration_unit?: 'days' | 'months' | 'years' | null
    exact_date?: string | null
    applies_to?: string[] | null
  } | null
  created_at: string
  updated_at?: string | null
  created_by?: string | null
  updated_by?: string | null
  creator?: UserRef | null
  updater?: UserRef | null
}

interface DataGridProps {
  tableId: string
  tenantId: string
  columns: DataColumn[]
  rows: DataRow[]
}

/** 14px muted type icon in the column header. */
export const COLUMN_TYPE_ICON: Record<DataColumn['type'], typeof Type> = {
  text: Type,
  longtext: AlignLeft,
  number: Hash,
  date: Calendar,
  boolean: ToggleLeft,
  select: List,
  file: Paperclip,
  lookup: Link2,
}

const isNumeric = (col: DataColumn) => col.type === 'number'

/** Sticky left columns: the selection checkbox (40px) and the row ID. */
const STICKY_SELECT = 'sticky left-0 z-[2] w-10 min-w-10 pl-3 pr-0'
const STICKY_ID = 'sticky left-10 z-[2] w-24 min-w-24'

/** True when the key event comes from a text field (shortcuts must not fire). */
function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)
}

export function DataGrid({ tableId, tenantId, columns, rows }: DataGridProps) {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  // Invalidate the page-level react-query that drives this grid so
  // insert/update/delete immediately re-render. router.refresh() alone
  // refreshes server components but does NOT refetch useQuery data.
  const refreshRows = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
    // Also refresh any page-embedded data_table component bindings.
    queryClient.invalidateQueries({ queryKey: ['binding-table', tableId] })
  }, [queryClient, tableId])
  const [localRows, setLocalRows] = useState<DataRow[]>(rows)
  const [newRow, setNewRow] = useState<Record<string, any>>({})
  const [inlineAdd, setInlineAdd] = useState(false)
  const [sheetAdd, setSheetAdd] = useState(false)
  const [uploading, setUploading] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [scroll, setScroll] = useState({ left: false, right: false })
  const scrollRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  // Synchronous guard: a double click on + must not insert the row twice.
  const addRowGuard = useSubmitGuard()

  useEffect(() => {
    setLocalRows(rows)
  }, [rows])

  // Shift+N toggles the inline "new row" entry under the header (the button opens the Sheet).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'N' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !isTyping(e)) {
        e.preventDefault()
        setInlineAdd((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Horizontal scroll shadows: left once scrolled, right while more is hidden.
  const updateScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const left = el.scrollLeft > 0
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setScroll((s) => (s.left === left && s.right === right ? s : { left, right }))
  }, [])
  useEffect(() => {
    updateScroll()
    window.addEventListener('resize', updateScroll)
    return () => window.removeEventListener('resize', updateScroll)
  }, [updateScroll, columns.length, localRows.length])

  // Currently selected row for the drawer (lookup against the fresh rows
  // list so the drawer sees live updates when the parent refetches).
  const detailRow = useMemo(
    () => localRows.find(r => r.id === detailRowId) ?? null,
    [localRows, detailRowId],
  )

  const allRowIds = localRows.map(r => r.id)
  const allSelected = allRowIds.length > 0 && allRowIds.every(id => selectedRows.has(id))
  const someSelected = !allSelected && allRowIds.some(id => selectedRows.has(id))

  function toggleRow(id: string) {
    setSelectedRows(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }

  function toggleAll() {
    if (allSelected) setSelectedRows(new Set())
    else setSelectedRows(new Set(allRowIds))
  }

  async function deleteSelected() {
    setDeleting(true)
    const ids = Array.from(selectedRows)
    const previous = localRows
    setLocalRows((current) => current.filter((row) => !selectedRows.has(row.id)))
    setSelectedRows(new Set())
    setConfirmBulk(false)
    if (detailRowId && ids.includes(detailRowId)) setDetailRowId(null)
    try {
      // A `bulk.delete` job: small selections finish here, large ones in the background.
      await bulkDeleteWithJob(jobs, 'data_row', ids, () => refreshRows())
    } catch (e: any) {
      setLocalRows(previous)
      setSelectedRows(new Set(ids))
      alert(`Failed to delete rows: ${e.message}`)
    }
    setDeleting(false)
  }

  async function handleAddRow() {
    await addRowGuard.run(async () => {
      try {
        await insertRow(tableId, tenantId, newRow)
        setNewRow({})
        refreshRows()
        router.refresh()
      } catch (e: any) {
        alert(`Failed to add row: ${e.message}`)
      }
    })
  }

  async function handleDelete(rowId: string) {
    setPendingDelete(null)
    const previous = localRows
    setLocalRows((current) => current.filter((row) => row.id !== rowId))
    setSelectedRows((current) => {
      const next = new Set(current)
      next.delete(rowId)
      return next
    })
    if (detailRowId === rowId) setDetailRowId(null)
    try {
      await deleteRow(rowId)
      refreshRows()
      router.refresh()
    } catch (e: any) {
      setLocalRows(previous)
      alert(`Failed to delete row: ${e.message}`)
    }
  }

  async function uploadNewRowFile(file: File, colKey: string) {
    setUploading(colKey)
    try {
      const fileData = await uploadRowFile(tableId, file)
      setNewRow(prev => ({ ...prev, [colKey]: fileData }))
    } catch (e: any) {
      alert(`Upload failed: ${e.message}`)
    }
    setUploading(null)
  }

  function copyId(id: string) {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500)
  }

  // Filter and sort rows. We hide system columns (ID, Date Created)
  // from the inline grid because they're shown explicitly in the
  // dedicated "Row" + "Last edited" columns and in the row detail
  // drawer's metadata block.
  const editableColumns = columns.filter(c => c.name !== 'ID' && c.name !== 'Date Created')
  // Key must be STABLE while typing — including the name remounted the row on
  // every keystroke, dropping input focus after one character.
  const getColumnKey = (col: DataColumn, index: number) => col.id || `col:${index}`

  const filteredRows = localRows.filter(row => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    // Match within row values (the common case), the auto-number "id"
    // field, the row's uuid, AND creator/updater display names so
    // people can find rows like "the one Andy edited last week".
    if (Object.values(row.data).some(v => String(v ?? '').toLowerCase().includes(q))) return true
    if (String((row.data as any)?.id ?? '').includes(q)) return true
    if (row.id.toLowerCase().includes(q)) return true
    const creatorName = (row.creator?.display_name ?? row.creator?.email ?? '').toLowerCase()
    if (creatorName.includes(q)) return true
    const updaterName = (row.updater?.display_name ?? row.updater?.email ?? '').toLowerCase()
    if (updaterName.includes(q)) return true
    return false
  })

  const sortedRows = [...filteredRows].sort((a, b) => {
    if (!sortCol) return 0
    let av: any
    let bv: any
    if (sortCol === '_row_id') { av = a.id; bv = b.id }
    else if (sortCol === '_updated_at') { av = a.updated_at ?? a.created_at; bv = b.updated_at ?? b.created_at }
    else if (sortCol === '_created_at') { av = a.created_at; bv = b.created_at }
    else { av = String(getCellByIdentifier(a.data, sortCol) ?? ''); bv = String(getCellByIdentifier(b.data, sortCol) ?? '') }
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true })
    return sortDir === 'desc' ? -cmp : cmp
  })

  function toggleSort(col: string) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  if (columns.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel">
        <EmptyState
          size="sm"
          icon={Columns3}
          title="This table has no columns yet"
          description="Add columns on the Schema tab, then come back to add rows."
        />
      </div>
    )
  }

  const colSpan = editableColumns.length + 4
  const stickyEdge = scroll.left && 'shadow-[6px_0_6px_-6px_var(--ds-border-strong)]'

  function sortHeader({ id, label, numeric, icon: Icon, className }: { id: string; label: string; numeric?: boolean; icon?: typeof Type; className?: string }) {
    const active = sortCol === id
    return (
      <th
        key={id}
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={cn(thClass, 'h-auto min-h-8 whitespace-normal py-1.5', numeric && 'text-right', className)}
      >
        <button
          type="button"
          onClick={() => toggleSort(id)}
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 text-left hover:text-fg',
            numeric && 'flex-row-reverse text-right',
            active && 'text-fg',
          )}
        >
          {Icon && <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />}
          <span className="line-clamp-2 break-words">{label}</span>
          {active && (sortDir === 'asc'
            ? <ArrowUp className="size-3.5 shrink-0" aria-hidden="true" />
            : <ArrowDown className="size-3.5 shrink-0" aria-hidden="true" />)}
        </button>
      </th>
    )
  }

  return (
    <div className="space-y-3">
      {/* Toolbar: search, match count / selection, add row */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search rows by any value, ID or creator…"
          aria-label="Search rows"
          wrapperClassName="w-full max-w-sm"
        />
        {search && (
          <span className="num text-xs text-fg-muted">
            {plural(filteredRows.length, 'match', 'matches')}
          </span>
        )}
        {selectedRows.size > 0 && (
          <div className="flex items-center gap-1 rounded-md bg-primary-wash py-0.5 pl-3 pr-1">
            <span className="num text-ui font-medium text-primary-text">{selectedRows.size} selected</span>
            {/* Bulk / toolbar actions contributed by extensions for data rows (the row's values plus id). */}
            <ExtensionToolbarActions objectType="data_row" items={localRows.filter((r) => selectedRows.has(r.id)).map((r) => ({ ...(r.data as Record<string, unknown>), id: r.id }))} />
            <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} onClick={() => setConfirmBulk(true)} disabled={deleting}>
              Delete
            </Button>
            <IconButton size="sm" label="Clear selection" icon={<X />} onClick={() => setSelectedRows(new Set())} />
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Tooltip content="Add a row in a panel" kbd="⇧N inline">
            <Button variant="secondary" size="sm" leadingIcon={<Plus />} onClick={() => setSheetAdd(true)}>
              Add row
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={updateScroll}
          // A focusable region: keyboard users scroll the grid with the arrow keys.
          role="region"
          aria-label="Table rows"
          tabIndex={0}
          data-table-scroll
          className="scrollbar-thin max-h-[calc(100vh-280px)] min-h-48 overflow-auto overscroll-x-contain rounded-lg border border-border bg-panel [-webkit-overflow-scrolling:touch]"
        >
          <table className="w-full border-separate border-spacing-0 text-left text-ui text-fg">
            <thead className="sticky top-0 z-[3]">
              <tr>
                <th scope="col" className={cn(thClass, STICKY_SELECT, 'z-[4]')}>
                  <Checkbox
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected }}
                    onChange={toggleAll}
                    aria-label="Select all rows"
                  />
                </th>
                {sortHeader({ id: '_row_id', label: 'Row', className: cn(STICKY_ID, 'z-[4]', stickyEdge) })}
                {editableColumns.map((col) => sortHeader({
                  id: columnKey(col),
                  label: col.name || 'Untitled',
                  numeric: isNumeric(col),
                  icon: COLUMN_TYPE_ICON[col.type] ?? Type,
                  className: cn('min-w-28 max-w-60', col.type === 'boolean' && 'text-center'),
                }))}
                {sortHeader({ id: '_updated_at', label: 'Last edited', className: 'min-w-44' })}
                <th scope="col" className={cn(thClass, 'w-px')}><span className="sr-only">Actions</span></th>
              </tr>
              {inlineAdd && (
                <tr className="bg-subtle">
                  <td className={cn(tdClass, STICKY_SELECT, 'border-b border-border bg-subtle')} />
                  <td className={cn(tdClass, STICKY_ID, 'border-b border-border bg-subtle text-xs text-fg-muted', stickyEdge)}>New</td>
                  {editableColumns.map((col, index) => (
                    <td key={getColumnKey(col, index)} className={cn(tdClass, 'min-w-28 border-b border-border px-1.5')}>
                      <InlineCellEditor
                        column={col}
                        value={newRow[columnKey(col)]}
                        onChange={(value) => setNewRow({ ...newRow, [columnKey(col)]: value })}
                        uploading={uploading === columnKey(col)}
                        onUpload={(file) => uploadNewRowFile(file, columnKey(col))}
                      />
                    </td>
                  ))}
                  <td className={cn(tdClass, 'border-b border-border text-xs text-fg-muted')}>
                    <span className="inline-flex items-center gap-1"><Kbd>⇧N</Kbd> to hide</span>
                  </td>
                  <td className={cn(tdClass, 'border-b border-border text-right')}>
                    <Button size="sm" onClick={handleAddRow} loading={addRowGuard.pending}>Add</Button>
                  </td>
                </tr>
              )}
            </thead>
            <tbody>
              {sortedRows.length === 0 && (
                search ? (
                  <TableEmpty
                    colSpan={colSpan}
                    variant="no-results"
                    title={`No rows match “${search}”`}
                    action={{ label: 'Clear search', onClick: () => setSearch('') }}
                  />
                ) : (
                  <TableEmpty
                    colSpan={colSpan}
                    icon={Plus}
                    title="No rows yet"
                    description="Add the first row, or import rows from a file."
                    action={{ label: 'Add row', onClick: () => setSheetAdd(true) }}
                  />
                )
              )}
              {sortedRows.map((row) => {
                const editor = row.updater ?? row.creator
                const editorName = editor?.display_name ?? editor?.email ?? null
                const selected = selectedRows.has(row.id)
                const edited = row.updated_at ?? row.created_at
                // Sticky cells need an opaque background that follows the row state.
                const stickyBg = selected
                  ? 'bg-panel bg-[image:linear-gradient(var(--theme-primary-light),var(--theme-primary-light))]'
                  : 'bg-panel group-hover/row:bg-subtle'
                return (
                  <tr
                    key={row.id}
                    data-selected={selected || undefined}
                    tabIndex={0}
                    onClick={() => setDetailRowId(row.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setDetailRowId(row.id) }}
                    className={cn(trClass, 'group/row cursor-pointer [&>td]:border-b [&>td]:border-border-subtle last:[&>td]:border-b-0')}
                  >
                    <td className={cn(tdClass, STICKY_SELECT, stickyBg)} onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={selected} onChange={() => toggleRow(row.id)} aria-label={`Select row ${row.id.slice(0, 8)}`} />
                    </td>
                    <td className={cn(tdClass, STICKY_ID, stickyBg, stickyEdge)}>
                      <Tooltip content={copiedId === row.id ? 'Copied' : 'Copy row ID'}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); copyId(row.id) }}
                          className="font-mono text-xs text-fg-muted hover:text-fg"
                          aria-label={`Copy row ID ${row.id}`}
                        >
                          {row.id.slice(0, 8)}
                        </button>
                      </Tooltip>
                    </td>
                    {editableColumns.map((col, index) => (
                      <td
                        key={getColumnKey(col, index)}
                        className={cn(
                          tdClass,
                          (isNumeric(col) || col.type === 'date') && 'num whitespace-nowrap',
                          isNumeric(col) && 'text-right',
                          col.type === 'boolean' && 'text-center',
                        )}
                      >
                        <CellValue column={col} value={getCellValue(row.data, col)} />
                      </td>
                    ))}
                    <td className={cn(tdClass, 'max-w-60')}>
                      <div className="flex min-w-0 items-center gap-2" title={formatAbsolute(edited)}>
                        {editorName && <Avatar name={editorName} size="sm" />}
                        <span className="truncate text-xs">
                          <span className="text-fg">{editorName ?? '—'}</span>
                          <span className="num text-fg-muted"> · {formatRelative(edited)}</span>
                        </span>
                      </div>
                    </td>
                    <td className={cn(tdClass, 'w-px whitespace-nowrap text-right')} onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--ds-dur-fast)] group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(pointer:coarse)]:opacity-100">
                        <IconButton size="sm" label="Open row" icon={<PanelRightOpen />} onClick={() => setDetailRowId(row.id)} />
                        <IconButton size="sm" variant="danger-ghost" label="Delete row" icon={<Trash2 />} onClick={() => setPendingDelete(row.id)} />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {scroll.right && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-px right-px w-6 rounded-r-lg bg-gradient-to-l from-[var(--ds-border-strong)] to-transparent opacity-40" />
        )}
      </div>

      {/* Detail sheet: opens on a row click */}
      <RowDetailDrawer
        open={detailRowId !== null}
        onOpenChange={(open) => { if (!open) setDetailRowId(null) }}
        row={detailRow as any}
        columns={editableColumns}
        tableId={tableId}
      />
      <AddRowSheet open={sheetAdd} onOpenChange={setSheetAdd} columns={editableColumns} tableId={tableId} tenantId={tenantId} />
      <ConfirmDialog
        open={confirmBulk}
        onOpenChange={setConfirmBulk}
        destructive
        title={`Delete ${plural(selectedRows.size, 'row')}?`}
        description="The selected rows are deleted permanently."
        confirmLabel="Delete rows"
        busy={deleting}
        onConfirm={deleteSelected}
      />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null) }}
        destructive
        title="Delete this row?"
        description="The row is deleted permanently."
        confirmLabel="Delete row"
        onConfirm={() => { if (pendingDelete) void handleDelete(pendingDelete) }}
      />
    </div>
  )
}

// ─── Read-only cell: one line, truncated, with the full value on hover ───
function CellValue({ column, value }: { column: DataColumn; value: any }) {
  if (column.type === 'file') return <FileDisplay value={value} />
  if (column.type === 'boolean') {
    return value
      ? <Check className="mx-auto size-4 text-fg" aria-label="Yes" />
      : <span className="text-fg-subtle" aria-label="No">—</span>
  }
  const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  if (!text) return <span className="text-fg-subtle">—</span>
  return <span className="block max-w-80 truncate" title={text.length > 24 ? text : undefined}>{text}</span>
}

// ─── Inline new-row editor (Shift+N) ───
function InlineCellEditor({ column, value, onChange, uploading, onUpload }: {
  column: DataColumn
  value: any
  onChange: (value: any) => void
  uploading: boolean
  onUpload: (file: File) => void
}) {
  const label = column.name || 'Untitled'
  if (column.type === 'boolean') {
    return <div className="text-center"><Checkbox checked={!!value} onChange={(e) => onChange(e.target.checked)} aria-label={label} /></div>
  }
  if (column.type === 'file') {
    return <FileCell value={value} uploading={uploading} onUpload={onUpload} onClear={() => onChange(null)} />
  }
  if (column.type === 'select') {
    return (
      <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={label}
        placeholder="Select…" options={(column.options ?? []).map(o => ({ value: o, label: o }))} />
    )
  }
  if (column.type === 'lookup') return <LookupCellEditor column={column} value={value} onChange={onChange} />
  return (
    <Input
      size="sm"
      type={column.type === 'number' ? 'number' : column.type === 'date' ? 'date' : 'text'}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className={cn(column.type === 'number' && 'num text-right')}
    />
  )
}

// ─── File upload cell (inline new row) ───
function FileCell({ value, uploading, onUpload, onClear }: {
  value: any
  uploading: boolean
  onUpload: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const fileData = value && typeof value === 'object' ? value : null

  if (uploading) {
    return (
      <div className="flex items-center gap-1 text-xs text-fg-muted">
        <Loader2 className="size-3.5 animate-spin" /> Uploading…
      </div>
    )
  }

  if (fileData?.url) {
    return (
      <div className="flex min-w-0 items-center gap-1">
        <FileText className="size-3.5 shrink-0 text-fg-muted" />
        <span className="truncate text-xs">{fileData.name ?? 'File'}</span>
        <IconButton size="sm" label="Remove file" icon={<X />} onClick={onClear} />
      </div>
    )
  }

  return (
    <>
      <Button size="sm" variant="ghost" leadingIcon={<Upload />} onClick={() => inputRef.current?.click()}>
        Upload
      </Button>
      <input ref={inputRef} type="file" className="hidden" onChange={(e) => {
        const file = e.target.files?.[0]
        if (file) onUpload(file)
        e.target.value = ''
      }} />
    </>
  )
}

// ─── File display (read-only) ───
function FileDisplay({ value }: { value: any }) {
  const fileData = value && typeof value === 'object' ? value : null
  if (!fileData?.url) {
    return <span className="text-fg-subtle">—</span>
  }
  return (
    <a href={fileData.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
      className="inline-flex max-w-full items-center gap-1 text-primary-text hover:underline">
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{fileData.name ?? 'File'}</span>
      <ExternalLink className="size-3 shrink-0" />
    </a>
  )
}

function LookupCellEditor({
  column,
  value,
  onChange,
}: {
  column: DataColumn
  value: any
  onChange: (value: string) => void
}) {
  const { data: options = [], isLoading } = useLookupOptions(column.lookup, true)

  return (
    <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value)} disabled={isLoading} aria-label={column.name || 'Lookup'}>
      <option value="">{isLoading ? 'Loading…' : 'Select…'}</option>
      {options.map((option) => (
        <option key={`${column.id}:${option.value}`} value={option.value}>{option.label}</option>
      ))}
    </Select>
  )
}
