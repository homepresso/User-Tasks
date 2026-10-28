'use client'

import { useEffect, useState, useRef, useMemo } from 'react'
import { insertRow, updateRow, deleteRow } from '@/app/actions/data-store'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { serverRead } from '@/lib/server-read'
import { uploadDataTableFile } from '@/app/actions/uploads'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Plus, Trash2, Save, Upload, FileText, ExternalLink, Loader2,
  Eye, Search, Clock, User as UserIcon,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { RowDetailDrawer } from './row-detail-drawer'
import { formatRelativeDate, getInitials } from '@/lib/utils'
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

export function DataGrid({ tableId, tenantId, columns, rows }: DataGridProps) {
  const jobs = useJobs()
  const queryClient = useQueryClient()
  // Invalidate the page-level react-query that drives this grid so
  // insert/update/delete immediately re-render. router.refresh() alone
  // refreshes server components but does NOT refetch useQuery data.
  const refreshRows = () => {
    queryClient.invalidateQueries({ queryKey: ['custom-table-rows', tableId] })
    // Also refresh any page-embedded data_table component bindings.
    queryClient.invalidateQueries({ queryKey: ['binding-table', tableId] })
  }
  const [localRows, setLocalRows] = useState<DataRow[]>(rows)
  const [newRow, setNewRow] = useState<Record<string, any>>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editData, setEditData] = useState<Record<string, any>>({})
  const [uploading, setUploading] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [search, setSearch] = useState('')
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [detailRowId, setDetailRowId] = useState<string | null>(null)
  const router = useRouter()

  useEffect(() => {
    setLocalRows(rows)
  }, [rows])

  // Currently selected row for the drawer (lookup against the fresh rows
  // list so the drawer sees live updates when the parent refetches).
  const detailRow = useMemo(
    () => localRows.find(r => r.id === detailRowId) ?? null,
    [localRows, detailRowId],
  )

  const allRowIds = localRows.map(r => r.id)
  const allSelected = allRowIds.length > 0 && allRowIds.every(id => selectedRows.has(id))

  function toggleRow(id: string) {
    setSelectedRows(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleAll() {
    if (allSelected) setSelectedRows(new Set())
    else setSelectedRows(new Set(allRowIds))
  }

  async function deleteSelected() {
    if (!confirm(`Delete ${selectedRows.size} row(s)?`)) return
    setDeleting(true)
    const ids = Array.from(selectedRows)
    const previous = localRows
    setLocalRows((current) => current.filter((row) => !selectedRows.has(row.id)))
    setSelectedRows(new Set())
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
    try {
      await insertRow(tableId, tenantId, newRow)
      setNewRow({})
      refreshRows()
      router.refresh()
    } catch (e: any) {
      alert(`Failed to add row: ${e.message}`)
    }
  }

  async function handleSaveEdit(rowId: string) {
    try {
      await updateRow(rowId, editData)
      setEditingId(null)
      refreshRows()
      router.refresh()
    } catch (e: any) {
      alert(`Failed to save: ${e.message}`)
    }
  }

  async function handleDelete(rowId: string) {
    if (!confirm('Delete this row?')) return
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

  async function uploadFile(file: File, colKey: string, target: 'new' | 'edit', rowId?: string) {
    setUploading(colKey)
    try {
      // Stored server-side (data.manage_rows) in task-files/data-tables/<table>/.
      const body = new FormData()
      body.set('file', file)
      body.set('table_id', tableId)
      const uploaded = await uploadDataTableFile(body)
      if (!uploaded.ok) throw new Error(uploaded.error)
      const { name, url, size, path, ref } = uploaded.data
      const fileData = { name, url, size, path, ...(ref ? { ref } : {}) }

      if (target === 'new') {
        setNewRow(prev => ({ ...prev, [colKey]: fileData }))
      } else if (rowId) {
        const { data: currentRowData } = await serverRead('data.rowData', { id: rowId })
        const currentData = (currentRowData ?? {}) as Record<string, any>
        const merged = { ...currentData, [colKey]: fileData }
        await updateRow(rowId, merged)
        setEditData(prev => ({ ...prev, [colKey]: fileData }))
        router.refresh()
      }
    } catch (e: any) {
      alert(`Upload failed: ${e.message}`)
    }
    setUploading(null)
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
      <div className="rounded-lg border p-6 text-center" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
          Add columns above to start adding data.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search rows by any value, ID, or creator…"
          className="w-full rounded-lg border pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-1"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
            color: 'var(--theme-card-text)',
            // @ts-expect-error — ring-color via CSS var
            '--tw-ring-color': 'var(--theme-primary)',
          }}
        />
        {search && (
          <span
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
            style={{ color: 'var(--theme-muted-text)' }}
          >
            {filteredRows.length} match{filteredRows.length !== 1 ? 'es' : ''}
          </span>
        )}
      </div>

      {selectedRows.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg" style={{ backgroundColor: 'var(--theme-primary-light)', border: '1px solid var(--theme-primary)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-primary-text)' }}>
            {selectedRows.size} row{selectedRows.size !== 1 ? 's' : ''} selected
          </span>
          <div className="flex-1" />
          <Button size="sm" variant="outline" className="!text-[10px] !h-6 !text-red-600" onClick={deleteSelected} disabled={deleting}>
            <Trash2 size={10} className="mr-1" /> {deleting ? 'Deleting...' : 'Delete Selected'}
          </Button>
          <button onClick={() => setSelectedRows(new Set())} className="text-[10px] underline" style={{ color: 'var(--theme-muted-text)' }}>Clear</button>
        </div>
      )}
    <div className="rounded-lg border overflow-x-auto" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
      <table className="w-full text-sm">
        <thead>
          <tr style={{ backgroundColor: 'var(--theme-surface)' }}>
            <th className="px-2 py-2 w-8">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
            </th>
            <th
              className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider w-20 cursor-pointer select-none"
              style={{ color: sortCol === '_row_id' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
              onClick={() => toggleSort('_row_id')}
            >
              Row {sortCol === '_row_id' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            {editableColumns.map((col, index) => (
              <th
                key={getColumnKey(col, index)}
                className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none"
                style={{ color: sortCol === columnKey(col) ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
                onClick={() => toggleSort(columnKey(col))}
              >
                {col.name || 'Untitled'} {sortCol === columnKey(col) && (sortDir === 'asc' ? '↑' : '↓')}
              </th>
            ))}
            <th
              className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider w-40 cursor-pointer select-none"
              style={{ color: sortCol === '_updated_at' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
              onClick={() => toggleSort('_updated_at')}
            >
              Last edited {sortCol === '_updated_at' && (sortDir === 'asc' ? '↑' : '↓')}
            </th>
            <th className="px-3 py-2 w-24"></th>
          </tr>
        </thead>
        <tbody>
          {/* Add new row */}
          <tr style={{ borderTop: '1px solid var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
            <td className="px-2 py-1.5"></td>
            <td className="px-3 py-1.5 text-[10px] italic" style={{ color: 'var(--theme-muted-text)' }}>New</td>
            {editableColumns.map((col, index) => (
              <td key={getColumnKey(col, index)} className="px-2 py-1.5">
                {col.type === 'boolean' ? (
                  <input type="checkbox" checked={!!newRow[columnKey(col)]} onChange={(e) => setNewRow({ ...newRow, [columnKey(col)]: e.target.checked })} />
                ) : col.type === 'longtext' ? (
                  <textarea
                    value={newRow[columnKey(col)] ?? ''}
                    onChange={(e) => setNewRow({ ...newRow, [columnKey(col)]: e.target.value })}
                    placeholder="..."
                    rows={2}
                    className="w-full rounded border px-2 py-1 text-xs"
                    style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                  />
                ) : col.type === 'file' ? (
                  <FileCell
                    value={newRow[columnKey(col)]}
                    uploading={uploading === columnKey(col)}
                    onUpload={(file) => uploadFile(file, columnKey(col), 'new')}
                    onClear={() => setNewRow(prev => ({ ...prev, [columnKey(col)]: null }))}
                  />
                ) : col.type === 'select' ? (
                  <select
                    value={newRow[columnKey(col)] ?? ''}
                    onChange={(e) => setNewRow({ ...newRow, [columnKey(col)]: e.target.value })}
                    className="w-full rounded border px-2 py-1 text-xs h-7"
                    style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
                  >
                    <option value="">Select...</option>
                    {(col.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                ) : col.type === 'lookup' ? (
                  <LookupCellEditor
                    column={col}
                    value={newRow[columnKey(col)]}
                    onChange={(value) => setNewRow({ ...newRow, [columnKey(col)]: value })}
                  />
                ) : (
                  <Input
                    type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                    value={newRow[columnKey(col)] ?? ''}
                    onChange={(e) => setNewRow({ ...newRow, [columnKey(col)]: e.target.value })}
                    placeholder="..."
                    className="!h-7 !text-xs"
                  />
                )}
              </td>
            ))}
            <td className="px-2 py-1.5">
              <Button size="sm" variant="ghost" onClick={handleAddRow}>
                <Plus size={12} />
              </Button>
            </td>
          </tr>

          {/* Existing rows */}
          {sortedRows.map((row) => {
            const isEditing = editingId === row.id
            const editor = row.updater ?? row.creator
            return (
              <tr
                key={row.id}
                className="transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{
                  borderTop: '1px solid var(--theme-surface-border)',
                  backgroundColor: selectedRows.has(row.id) ? 'var(--theme-primary-light)' : undefined,
                }}
              >
                <td className="px-2 py-2">
                  <input
                    type="checkbox"
                    checked={selectedRows.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    className="rounded"
                  />
                </td>
                <td
                  className="px-3 py-2 text-[10px] font-mono cursor-pointer"
                  style={{ color: 'var(--theme-muted-text)' }}
                  title={`Click to copy: ${row.id}`}
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(row.id) }}
                >
                  {row.id.slice(0, 8)}
                </td>
                {editableColumns.map((col, index) => (
                  <td key={getColumnKey(col, index)} className="px-3 py-2">
                    {isEditing ? (
                      col.type === 'file' ? (
                        <FileCell
                          value={editData[columnKey(col)]}
                          uploading={uploading === columnKey(col)}
                          onUpload={(file) => uploadFile(file, columnKey(col), 'edit', row.id)}
                          onClear={() => setEditData(prev => ({ ...prev, [columnKey(col)]: null }))}
                        />
                      ) : col.type === 'boolean' ? (
                        <input type="checkbox" checked={!!editData[columnKey(col)]} onChange={(e) => setEditData({ ...editData, [columnKey(col)]: e.target.checked })} />
                      ) : col.type === 'lookup' ? (
                        <LookupCellEditor
                          column={col}
                          value={editData[columnKey(col)]}
                          onChange={(value) => setEditData({ ...editData, [columnKey(col)]: value })}
                        />
                      ) : (
                        <Input
                          type={col.type === 'number' ? 'number' : col.type === 'date' ? 'date' : 'text'}
                          value={editData[columnKey(col)] ?? ''}
                          onChange={(e) => setEditData({ ...editData, [columnKey(col)]: e.target.value })}
                          className="!h-7 !text-xs"
                        />
                      )
                    ) : col.type === 'file' ? (
                      <FileDisplay value={getCellValue(row.data, col)} />
                    ) : col.type === 'boolean' ? (
                      <span>{getCellValue(row.data, col) ? '✓' : '—'}</span>
                    ) : (
                      <span className="text-sm">{String(getCellValue(row.data, col) ?? '')}</span>
                    )}
                  </td>
                ))}
                {/* Last edited — avatar + relative timestamp. Falls back
                    to "created by" if the row was never updated. */}
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    {editor && (
                      <span
                        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                        style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                        title={editor.display_name ?? editor.email ?? 'Unknown'}
                      >
                        {getInitials(editor.display_name ?? editor.email ?? '?')}
                      </span>
                    )}
                    <div className="min-w-0">
                      <p
                        className="text-[10px] truncate"
                        style={{ color: 'var(--theme-card-text)' }}
                      >
                        {editor?.display_name ?? editor?.email ?? '—'}
                      </p>
                      <p
                        className="text-[9px]"
                        style={{ color: 'var(--theme-muted-text)' }}
                        title={new Date(row.updated_at ?? row.created_at).toLocaleString()}
                      >
                        {formatRelativeDate(row.updated_at ?? row.created_at)}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  <div className="flex items-center gap-1 justify-end">
                    {isEditing ? (
                      <Button size="sm" variant="ghost" onClick={() => handleSaveEdit(row.id)} title="Save inline edit">
                        <Save size={12} />
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDetailRowId(row.id)}
                        title="Open row detail"
                      >
                        <Eye size={12} />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(row.id)}
                      className="hover:text-red-500"
                      title="Delete row"
                    >
                      <Trash2 size={12} />
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>

    {/* Detail drawer — portalled, opens on Eye-icon click */}
    <RowDetailDrawer
      open={detailRowId !== null}
      onOpenChange={(open) => { if (!open) setDetailRowId(null) }}
      row={detailRow as any}
      columns={editableColumns}
      tableId={tableId}
    />
    </div>
  )
}

// ─── File upload cell ───
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
      <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--theme-primary-text)' }}>
        <Loader2 size={12} className="animate-spin" /> Uploading...
      </div>
    )
  }

  if (fileData?.url) {
    return (
      <div className="flex items-center gap-1">
        <FileText size={12} style={{ color: 'var(--theme-primary-text)' }} />
        <span className="text-[10px] truncate max-w-24">{fileData.name ?? 'File'}</span>
        <button onClick={onClear} className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>×</button>
      </div>
    )
  }

  return (
    <>
      <button onClick={() => inputRef.current?.click()}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded hover:opacity-70"
        style={{ color: 'var(--theme-primary-text)', backgroundColor: 'var(--theme-primary-light)' }}>
        <Upload size={10} /> Upload
      </button>
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
    return <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>—</span>
  }
  return (
    <a href={fileData.url} target="_blank" rel="noopener noreferrer"
      className="flex items-center gap-1 text-[10px] hover:underline" style={{ color: 'var(--theme-primary-text)' }}>
      <FileText size={12} />
      <span className="truncate max-w-32">{fileData.name ?? 'File'}</span>
      <ExternalLink size={10} />
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
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded border px-2 py-1 text-xs h-7"
      style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      disabled={isLoading}
    >
      <option value="">{isLoading ? 'Loading…' : 'Select…'}</option>
      {options.map((option) => (
        <option key={`${column.id}:${option.value}`} value={option.value}>{option.label}</option>
      ))}
    </select>
  )
}
