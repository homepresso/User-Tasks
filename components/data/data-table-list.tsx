'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { unwrapAction } from '@/lib/action-result'
import {
  Database, Map as MapIcon, Grid3x3, List as ListIcon, Search, Trash2, AlertTriangle, Shield,
  ChevronUp, ChevronDown, Columns as ColumnsIcon, FileText, Clock, User as UserIcon,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { useTableDependencies, AssetDependencyDialog } from '@/components/shared/asset-dependencies'
import { useAppStore } from '@/stores/app-store'
import { deleteCustomTable } from '@/app/actions/data-store'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { BulkPermissionsDialog } from '@/components/governance/bulk-permissions-dialog'
import { formatRelativeDate, getInitials, cn } from '@/lib/utils'
import * as Dialog from '@radix-ui/react-dialog'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ExportAssetButton } from '@/components/shared/config-transfer'
import { buildQueuedDeleteNotice, type DeleteNotice } from '@/lib/queued-delete-feedback'

interface DataTableListProps {
  tables: any[]
}

interface RowSearchMatch {
  id: string
  table_id: string
  data: Record<string, unknown>
  table_name: string
}

type SortField = 'name' | 'columns' | 'rows' | 'updated_at'
type SortDir = 'asc' | 'desc'

function renderSortIcon(activeField: SortField, field: SortField, direction: SortDir) {
  if (activeField !== field) return null
  return direction === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
}

function getSearchableValue(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (Array.isArray(value)) {
    return value.map(getSearchableValue).filter(Boolean).join(' ')
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    if (typeof record.name === 'string') return record.name
    if (typeof record.title === 'string') return record.title
    if (typeof record.label === 'string') return record.label
    if (typeof record.url === 'string') return record.url
    return Object.values(record).map(getSearchableValue).filter(Boolean).join(' ')
  }
  return String(value)
}

function getRowMatch(row: RowSearchMatch, query: string) {
  const lowerQuery = query.toLowerCase()
  for (const [key, value] of Object.entries(row.data ?? {})) {
    const display = getSearchableValue(value)
    if (display.toLowerCase().includes(lowerQuery)) {
      return {
        field: key,
        value: display.length > 72 ? `${display.slice(0, 72)}…` : display,
      }
    }
  }
  return null
}

/**
 * Redesigned data tables list. Two view modes:
 *
 *   - Grid: tall "document cards" showing icon, name, description,
 *     column/row counts, creator avatar, and last-updated timestamp.
 *     Feels like a document library (Notion / Google Drive vibe).
 *   - List: denser table row view with the same metadata columns
 *     visible inline.
 *
 * Users can search across table name + description, sort by any column,
 * bulk-select for delete or permissions, and drill into dependency maps.
 * Row-level search happens inside the detail page's DataGrid.
 */
export function DataTableList({ tables }: DataTableListProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [depsId, setDepsId] = useState<string | null>(null)
  const { layoutPreference, setLayoutPreference } = useAppStore()
  const viewMode = (layoutPreference.data === 'list' ? 'list' : 'grid') as 'grid' | 'list'
  const setViewMode = (v: 'grid' | 'list') => setLayoutPreference('data', v)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [showBulkPermissions, setShowBulkPermissions] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)
  const [localTables, setLocalTables] = useState<any[]>(tables)

  const depsTable = localTables.find(t => t.id === depsId)
  const { data: deps, isLoading: depsLoading } = useTableDependencies(depsId ?? '')
  const normalizedSearch = search.trim().toLowerCase()

  useEffect(() => {
    setLocalTables(tables)
  }, [tables])

  const { data: rowMatches = [] } = useQuery({
    queryKey: ['data-table-list-row-search', normalizedSearch],
    queryFn: async () => {
      const { searchDataTableRows } = await import('@/app/actions/search')
      return unwrapAction(await searchDataTableRows(search.trim(), 50)) as RowSearchMatch[]
    },
    enabled: normalizedSearch.length >= 2,
  })

  const rowMatchesByTable = useMemo(() => {
    const grouped = new Map<string, { count: number; preview: string[] }>()
    for (const row of rowMatches) {
      const match = getRowMatch(row, normalizedSearch)
      if (!match) continue
      const existing = grouped.get(row.table_id) ?? { count: 0, preview: [] }
      existing.count += 1
      const summary = `${match.field}: ${match.value}`
      if (!existing.preview.includes(summary) && existing.preview.length < 2) {
        existing.preview.push(summary)
      }
      grouped.set(row.table_id, existing)
    }
    return grouped
  }, [rowMatches, normalizedSearch])

  const filtered = useMemo(() => {
    const q = normalizedSearch
    return localTables.filter(t =>
      !q
      || (t.name ?? '').toLowerCase().includes(q)
      || (t.description ?? '').toLowerCase().includes(q)
      || (t.creator?.display_name ?? '').toLowerCase().includes(q)
      || rowMatchesByTable.has(t.id),
    )
  }, [localTables, normalizedSearch, rowMatchesByTable])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = (a.name ?? '').localeCompare(b.name ?? '')
      else if (sortBy === 'columns') cmp = ((a.columns as any[])?.length ?? 0) - ((b.columns as any[])?.length ?? 0)
      else if (sortBy === 'rows') cmp = (a.row_count?.[0]?.count ?? 0) - (b.row_count?.[0]?.count ?? 0)
      else cmp = new Date(a.updated_at ?? a.created_at).getTime() - new Date(b.updated_at ?? b.created_at).getTime()
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [filtered, sortBy, sortDir])

  function toggleSort(field: SortField) {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir(field === 'name' ? 'asc' : 'desc') }
  }

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }
  function toggleSelectAll() {
    if (selected.size === sorted.length) setSelected(new Set())
    else setSelected(new Set(sorted.map(t => t.id)))
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    setBulkDeleteNotice(null)
    const ids = Array.from(selected)
    const previous = localTables
    setLocalTables((current) => current.filter((table) => !selected.has(table.id)))
    setSelected(new Set())
    setShowBulkDelete(false)
    try {
      // A `bulk.delete` job: small selections finish here, large ones in the background.
      const result = await bulkDeleteWithJob(jobs, 'data_table', ids, () => queryClient.invalidateQueries({ queryKey: ['custom-tables'] }))
      if (!result.background) setBulkDeleteNotice(buildQueuedDeleteNotice({
        queued: result?.queued ?? 0,
        total: ids.length,
        singular: 'table',
        plural: 'tables',
      }))
    } catch (err: any) {
      setLocalTables(previous)
      setBulkDeleteNotice({ tone: 'error', message: err?.message ?? 'Failed to queue table deletions' })
      setSelected(new Set(ids))
    } finally {
      setBulkDeleting(false)
    }
  }

  return (
    <div className="space-y-3">
      {bulkDeleteNotice && (
        <InlineNotice
          tone={bulkDeleteNotice.tone}
          message={bulkDeleteNotice.message}
          onDismiss={() => setBulkDeleteNotice(null)}
        />
      )}

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg px-4 py-2 border"
          style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-text)' }}>
            {selected.size} selected
          </span>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="!h-7 !text-xs">
            Clear
          </Button>
          <div className="flex-1" />
          <ExportAssetButton ids={[...selected]} name={`${selected.size} table${selected.size === 1 ? '' : 's'}`} allowRows className="!h-7 !text-xs" />
          <Button size="sm" variant="outline" onClick={() => setShowBulkPermissions(true)} className="!h-7 !text-xs">
            <Shield size={12} className="mr-1" /> Permissions
          </Button>
          <Button size="sm" onClick={() => setShowBulkDelete(true)} className="!h-7 !text-xs !bg-red-600 hover:!bg-red-700 !text-white">
            <Trash2 size={12} className="mr-1" /> Delete {selected.size}
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex gap-3 items-center">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={sorted.length > 0 && selected.size === sorted.length}
            ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < sorted.length }}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
            title="Select all"
          />
        </div>
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tables, rows, files, and cell values…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1">
          {(['name', 'rows', 'columns', 'updated_at'] as SortField[]).map(f => (
            <button
              key={f}
              onClick={() => toggleSort(f)}
              className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-1 rounded transition-colors"
              style={{
                backgroundColor: sortBy === f ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                color: sortBy === f ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
              }}
            >
              {f === 'name' ? 'Name' : f === 'rows' ? 'Rows' : f === 'columns' ? 'Columns' : 'Updated'}
              {renderSortIcon(sortBy, f, sortDir)}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <button
            onClick={() => setViewMode('grid')}
            className="p-1.5"
            style={{
              backgroundColor: viewMode === 'grid' ? 'var(--theme-primary)' : 'transparent',
              color: viewMode === 'grid' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
            }}
          ><Grid3x3 size={14} /></button>
          <button
            onClick={() => setViewMode('list')}
            className="p-1.5"
            style={{
              backgroundColor: viewMode === 'list' ? 'var(--theme-primary)' : 'transparent',
              color: viewMode === 'list' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
            }}
          ><ListIcon size={14} /></button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <EmptyState icon={Database} title="No tables found" description="Create a data table to start storing and querying data." />
      ) : viewMode === 'grid' ? (
        /* ── GRID / DOCUMENT CARDS ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {sorted.map((table) => (
            <TableDocumentCard
              key={table.id}
              table={table}
              searchMatch={rowMatchesByTable.get(table.id)}
              selected={selected.has(table.id)}
              onToggleSelect={() => toggleSelect(table.id)}
              onOpenDeps={() => setDepsId(table.id)}
            />
          ))}
        </div>
      ) : (
        /* ── LIST / TABLE ROWS ── */
        <div
          className="rounded-xl border overflow-hidden"
          style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
        >
          <div
            className="grid text-[10px] font-semibold uppercase tracking-wider select-none"
            style={{
              gridTemplateColumns: '32px 2fr 70px 70px 170px 160px 64px',
              backgroundColor: 'var(--theme-surface)',
              color: 'var(--theme-muted-text)',
            }}
          >
            <div className="px-2 py-2 flex items-center">
              <input
                type="checkbox"
                checked={sorted.length > 0 && selected.size === sorted.length}
                ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < sorted.length }}
                onChange={toggleSelectAll}
                className="h-3.5 w-3.5 rounded border-gray-300 accent-[color:var(--theme-primary)]"
              />
            </div>
            <button
              className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80"
              onClick={() => toggleSort('name')}
              style={{ color: sortBy === 'name' ? 'var(--theme-primary-text)' : undefined }}
            >Name {renderSortIcon(sortBy, 'name', sortDir)}</button>
            <button
              className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80"
              onClick={() => toggleSort('columns')}
              style={{ color: sortBy === 'columns' ? 'var(--theme-primary-text)' : undefined }}
            >Columns {renderSortIcon(sortBy, 'columns', sortDir)}</button>
            <button
              className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80"
              onClick={() => toggleSort('rows')}
              style={{ color: sortBy === 'rows' ? 'var(--theme-primary-text)' : undefined }}
            >Rows {renderSortIcon(sortBy, 'rows', sortDir)}</button>
            <div className="px-2 py-2">Creator</div>
            <button
              className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80"
              onClick={() => toggleSort('updated_at')}
              style={{ color: sortBy === 'updated_at' ? 'var(--theme-primary-text)' : undefined }}
            >Last updated {renderSortIcon(sortBy, 'updated_at', sortDir)}</button>
            <div className="px-2 py-2" />
          </div>
          {sorted.map((table) => (
            <div
              key={table.id}
              className="grid items-center text-xs border-t transition-colors hover:bg-[var(--theme-row-highlight)]"
              style={{
                gridTemplateColumns: '32px 2fr 70px 70px 170px 160px 64px',
                borderColor: 'var(--theme-surface-border)',
                backgroundColor: selected.has(table.id) ? 'var(--theme-primary-light)' : undefined,
              }}
            >
              <div className="px-2 py-2.5 flex items-center">
                <input
                  type="checkbox"
                  checked={selected.has(table.id)}
                  onChange={() => toggleSelect(table.id)}
                  className="h-3.5 w-3.5 rounded border-gray-300 accent-[color:var(--theme-primary)]"
                />
              </div>
              <Link href={`/data/${table.id}`} className="flex items-center gap-2 px-3 py-2.5 min-w-0">
                <FileText size={13} style={{ color: 'var(--theme-primary-text)' }} />
                <div className="min-w-0">
                  <span className="font-medium truncate block" style={{ color: 'var(--theme-card-text)' }}>
                    {table.name}
                  </span>
                  {rowMatchesByTable.get(table.id)?.preview?.[0] ? (
                    <span className="text-[9px] truncate block" style={{ color: 'var(--theme-primary-text)' }}>
                      {rowMatchesByTable.get(table.id)?.preview?.[0]}
                    </span>
                  ) : table.description ? (
                    <span className="text-[9px] truncate block" style={{ color: 'var(--theme-muted-text)' }}>
                      {table.description}
                    </span>
                  ) : null}
                </div>
              </Link>
              <div className="px-2 py-2.5 font-mono text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                {(table.columns as any[])?.length ?? 0}
              </div>
              <div className="px-2 py-2.5 font-mono text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                {table.row_count?.[0]?.count ?? 0}
              </div>
              <div className="px-2 py-2.5">
                <CreatorChip user={table.creator} />
              </div>
              <div className="px-2 py-2.5 text-[10px] flex items-center gap-1" style={{ color: 'var(--theme-muted-text)' }}>
                {rowMatchesByTable.get(table.id)?.count ? (
                  <span style={{ color: 'var(--theme-primary-text)' }}>
                    {rowMatchesByTable.get(table.id)?.count} row match{rowMatchesByTable.get(table.id)?.count === 1 ? '' : 'es'}
                  </span>
                ) : (
                  <>
                    <Clock size={10} /> {formatRelativeDate(table.updated_at ?? table.created_at)}
                  </>
                )}
              </div>
              <div className="px-2 py-2.5 flex justify-end gap-0.5">
                <ExportAssetButton ids={[table.id]} name={table.name} allowRows iconOnly variant="ghost" className="!h-auto !p-1 hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }} />
                <button
                  onClick={() => setDepsId(table.id)}
                  className="p-1 rounded hover:opacity-70"
                  title="Dependency map"
                  style={{ color: 'var(--theme-muted-text)' }}
                ><MapIcon size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Bulk Delete Dialog */}
      <Dialog.Root open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(24rem,92vw)] rounded-xl p-6 shadow-xl dialog-content"
            style={{ backgroundColor: 'var(--theme-card-bg)' }}
          >
            <Dialog.Title className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>
              Delete {selected.size} Tables
            </Dialog.Title>
            <p className="text-sm mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Are you sure you want to delete {selected.size} selected table{selected.size !== 1 ? 's' : ''}?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--status-error)' }}>
              <AlertTriangle size={11} className="inline mr-1" /> This will permanently delete all selected tables and their rows.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowBulkDelete(false)}>Cancel</Button>
              <Button size="sm" onClick={handleBulkDelete} disabled={bulkDeleting} className="!bg-red-600 hover:!bg-red-700 !text-white">
                {bulkDeleting ? `Deleting (${selected.size})...` : `Delete ${selected.size}`}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <BulkPermissionsDialog
        open={showBulkPermissions}
        onOpenChange={setShowBulkPermissions}
        objectType="data_table"
        objectIds={[...selected]}
        showExecute={false}
      />

      <AssetDependencyDialog
        open={depsId !== null}
        onOpenChange={(open) => { if (!open) setDepsId(null) }}
        title={depsTable?.name ?? ''}
        subtitle="Data Table"
        deps={deps}
        loading={depsLoading}
        rowLabel="Rows"
      />
    </div>
  )
}

/* ─── Document-card rendering for the grid view ─── */

function TableDocumentCard({
  table, searchMatch, selected, onToggleSelect, onOpenDeps,
}: {
  table: any
  searchMatch?: { count: number; preview: string[] }
  selected: boolean
  onToggleSelect: () => void
  onOpenDeps: () => void
}) {
  const colCount = (table.columns as any[])?.length ?? 0
  const rowCount = table.row_count?.[0]?.count ?? 0

  return (
    <div className="relative group">
      <div
        className={cn(
          'rounded-xl border overflow-hidden transition-all h-full flex flex-col',
          'hover:shadow-md hover:-translate-y-0.5',
        )}
        style={{
          borderColor: selected ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
          backgroundColor: 'var(--theme-card-bg)',
          boxShadow: selected ? '0 0 0 1px var(--theme-primary)' : undefined,
        }}
      >
        {/* Selection checkbox (top-left) + dep map (top-right) */}
        <div className="absolute top-2.5 left-2.5 z-10">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => { e.stopPropagation(); onToggleSelect() }}
            onClick={(e) => e.stopPropagation()}
            className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)] shrink-0"
          />
        </div>
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenDeps() }}
          className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity z-10"
          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
          title="Dependency map"
        >
          <MapIcon size={12} />
        </button>
        <div className="absolute top-2 right-9 z-10 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity">
          <ExportAssetButton ids={[table.id]} name={table.name} allowRows iconOnly variant="ghost" className="!h-auto !p-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }} />
        </div>

        <Link href={`/data/${table.id}`} className="flex-1 flex flex-col p-5 pt-10">
          {/* Document-style icon */}
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center mb-3"
            style={{ backgroundColor: 'var(--theme-primary-light)' }}
          >
            <FileText size={22} style={{ color: 'var(--theme-primary-text)' }} />
          </div>

          {/* Title + description */}
          <h3 className="text-sm font-semibold mb-1 line-clamp-1" style={{ color: 'var(--theme-card-text)' }}>
            {table.name}
          </h3>
          {table.description ? (
            <p className="text-[11px] line-clamp-2 mb-3" style={{ color: searchMatch ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
              {searchMatch?.preview?.[0] ?? table.description}
            </p>
          ) : (
            <p className="text-[11px] italic mb-3" style={{ color: 'var(--theme-muted-text)' }}>
              {searchMatch?.preview?.[0] ?? 'No description'}
            </p>
          )}

          {searchMatch && searchMatch.preview[1] && (
            <p className="mb-3 text-[10px] line-clamp-1" style={{ color: 'var(--theme-muted-text)' }}>
              {searchMatch.preview[1]}
            </p>
          )}

          {/* Stats row */}
          <div className="flex items-center gap-2 mb-3 text-[10px]">
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono"
              style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}
            >
              <ColumnsIcon size={9} /> {colCount} col{colCount !== 1 ? 's' : ''}
            </span>
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-mono"
              style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}
            >
              <Database size={9} /> {rowCount} row{rowCount !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Footer: creator + last updated */}
          <div className="mt-auto pt-3 border-t flex items-center justify-between gap-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <CreatorChip user={table.creator} compact />
            {searchMatch ? (
              <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-primary-text)' }}>
                {searchMatch.count} row match{searchMatch.count === 1 ? '' : 'es'}
              </span>
            ) : (
              <span
                className="text-[10px] flex items-center gap-1 shrink-0"
                style={{ color: 'var(--theme-muted-text)' }}
                title={`Updated ${new Date(table.updated_at ?? table.created_at).toLocaleString()}`}
              >
                <Clock size={9} /> {formatRelativeDate(table.updated_at ?? table.created_at)}
              </span>
            )}
          </div>
        </Link>
      </div>
    </div>
  )
}

/* ─── Creator/user chip rendering ─── */

function CreatorChip({ user, compact }: { user: any; compact?: boolean }) {
  if (!user) {
    return (
      <span
        className="text-[10px] italic"
        style={{ color: 'var(--theme-muted-text)' }}
      >
        {compact ? '—' : 'Unknown'}
      </span>
    )
  }
  const name = user.display_name ?? user.email ?? 'Unknown'
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0" title={name}>
      <span
        className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold"
        style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
      >
        {getInitials(name)}
      </span>
      <span
        className="text-[10px] truncate"
        style={{ color: 'var(--theme-muted-text)' }}
      >
        {compact ? name.split(' ')[0] : name}
      </span>
    </span>
  )
}
