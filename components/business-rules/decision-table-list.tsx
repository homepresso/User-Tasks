'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import {
  Search, GitBranch, Trash2, ChevronUp, ChevronDown, LayoutGrid, List,
  CheckSquare, Square, AlertTriangle,
} from 'lucide-react'
import { deleteDecisionTable } from '@/app/actions/business-rules'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { formatRelativeDate, cn } from '@/lib/utils'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ExportAssetButton } from '@/components/shared/config-transfer'
import { buildQueuedDeleteNotice, type DeleteNotice } from '@/lib/queued-delete-feedback'

type SortField = 'name' | 'inputs' | 'outputs' | 'updated_at'
type SortDir = 'asc' | 'desc'
type FilterMode = 'all' | 'ready' | 'needs_rules' | 'needs_structure'
type ViewMode = 'cards' | 'list'

const DEFAULT_PAGE_SIZE = 25

export function DecisionTableList({ tables }: { tables: any[] }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortField>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)
  const [localTables, setLocalTables] = useState<any[]>(tables)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const normalized = search.trim().toLowerCase()

  useEffect(() => {
    setLocalTables(tables)
  }, [tables])

  const filtered = useMemo(() => {
    return localTables.filter((table) => {
      const matchesSearch = !normalized || (
        String(table.name ?? '').toLowerCase().includes(normalized) ||
        String(table.description ?? '').toLowerCase().includes(normalized)
      )

      if (!matchesSearch) return false

      const inputCount = table.inputs?.length ?? 0
      const outputCount = table.outputs?.length ?? 0
      const ruleCount = table.rules?.length ?? 0

      if (filterMode === 'ready') return inputCount > 0 && outputCount > 0 && ruleCount > 0
      if (filterMode === 'needs_rules') return ruleCount === 0
      if (filterMode === 'needs_structure') return inputCount === 0 || outputCount === 0

      return true
    })
  }, [filterMode, localTables, normalized])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
      else if (sortBy === 'inputs') cmp = (a.inputs?.length ?? 0) - (b.inputs?.length ?? 0)
      else if (sortBy === 'outputs') cmp = (a.outputs?.length ?? 0) - (b.outputs?.length ?? 0)
      else cmp = new Date(a.updated_at ?? a.created_at).getTime() - new Date(b.updated_at ?? b.created_at).getTime()
      return sortDir === 'desc' ? -cmp : cmp
    })
  }, [filtered, sortBy, sortDir])

  // Reset pagination when the working set shifts so the user doesn't
  // end up on a phantom page after typing a search term.
  useEffect(() => { setPage(1) }, [search, filterMode, pageSize])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  )

  function toggleSort(field: SortField) {
    if (sortBy === field) setSortDir((current) => current === 'asc' ? 'desc' : 'asc')
    else {
      setSortBy(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // "Select all" targets the current page so bulk-select feels
  // predictable on long lists — otherwise selecting everything would
  // sweep in rows the user can't see.
  const allPageSelected = pageRows.length > 0 && pageRows.every((r) => selected.has(r.id))
  function toggleSelectPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const row of pageRows) next.delete(row.id)
      } else {
        for (const row of pageRows) next.add(row.id)
      }
      return next
    })
  }

  async function handleDelete(id: string, name: string) {
    try {
      setLocalTables((prev) => prev.filter((table) => table.id !== id))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      await deleteDecisionTable(id)
      queryClient.invalidateQueries({ queryKey: ['reports', 'business-rules'] })
      router.refresh()
    } catch (err: any) {
      setBulkDeleteNotice({ tone: 'error', message: err.message ?? 'Failed to delete business rule' })
    }
  }

  async function handleBulkDelete() {
    setBulkDeleting(true)
    setBulkDeleteNotice(null)
    const ids = Array.from(selected)
    const previous = localTables
    setLocalTables((prev) => prev.filter((table) => !ids.includes(table.id)))
    setSelected(new Set())
    setShowBulkDelete(false)
    try {
      const result = await bulkDeleteWithJob(jobs, 'decision_table', ids, () => queryClient.invalidateQueries({ queryKey: ['reports', 'business-rules'] }))
      if (!result.background) setBulkDeleteNotice(buildQueuedDeleteNotice({
        queued: result?.queued ?? 0,
        total: ids.length,
        singular: 'business rule',
        plural: 'business rules',
      }))
    } catch (err: any) {
      setLocalTables(previous)
      setSelected(new Set(ids))
      setBulkDeleteNotice({ tone: 'error', message: err?.message ?? 'Failed to delete selected business rules' })
    } finally {
      setBulkDeleting(false)
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortBy !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
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

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Business Rule"
        description={`Delete business rule "${deleteTarget?.name ?? 'this rule'}"?`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return
          await handleDelete(deleteTarget.id, deleteTarget.name)
          setDeleteTarget(null)
        }}
      />

      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search business rules…"
            className="pl-9"
          />
        </div>
        <select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as FilterMode)}
          className="rounded-lg border px-3 py-2 text-xs min-w-[160px]"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
        >
          <option value="all">All rules</option>
          <option value="ready">Ready to use</option>
          <option value="needs_rules">Needs rules</option>
          <option value="needs_structure">Needs inputs/outputs</option>
        </select>
        <div className="flex items-center gap-1">
          {(['name', 'inputs', 'outputs', 'updated_at'] as SortField[]).map((field) => (
            <button
              key={field}
              onClick={() => toggleSort(field)}
              className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-1 rounded transition-colors"
              style={{
                backgroundColor: sortBy === field ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                color: sortBy === field ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
              }}
            >
              {field === 'updated_at' ? 'Updated' : field.charAt(0).toUpperCase() + field.slice(1)}
              <SortIcon field={field} />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--theme-surface)' }}>
          <button
            onClick={() => setViewMode('list')}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              backgroundColor: viewMode === 'list' ? 'var(--theme-card-bg)' : 'transparent',
              color: viewMode === 'list' ? 'var(--theme-card-text)' : 'var(--theme-muted-text)',
            }}
          >
            <List size={12} /> List
          </button>
          <button
            onClick={() => setViewMode('cards')}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium"
            style={{
              backgroundColor: viewMode === 'cards' ? 'var(--theme-card-bg)' : 'transparent',
              color: viewMode === 'cards' ? 'var(--theme-card-text)' : 'var(--theme-muted-text)',
            }}
          >
            <LayoutGrid size={12} /> Cards
          </button>
        </div>
      </div>

      {/* Selection toolbar — only visible once something is ticked.
          Matches the template list pattern so bulk actions feel
          consistent across the app. */}
      {selected.size > 0 && (
        <div
          className="flex items-center gap-3 rounded-lg px-4 py-2 border"
          style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-text)' }}>
            {selected.size} selected
          </span>
          <button
            onClick={() => setSelected(new Set())}
            className="text-[11px] hover:underline"
            style={{ color: 'var(--theme-primary-text)' }}
          >
            Clear
          </button>
          <div className="flex-1" />
          <ExportAssetButton ids={[...selected]} name={`${selected.size} business rule${selected.size === 1 ? '' : 's'}`} className="!h-7 !text-[11px]" />
          <Button
            size="sm"
            onClick={() => setShowBulkDelete(true)}
            className="!bg-red-600 hover:!bg-red-700 !text-white h-7 text-[11px]"
          >
            <Trash2 size={12} className="mr-1" /> Delete {selected.size}
          </Button>
        </div>
      )}

      <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
        {sorted.length === tables.length
          ? `${tables.length} business rule${tables.length !== 1 ? 's' : ''}`
          : `${sorted.length} of ${tables.length} business rules match`}
      </p>

      {sorted.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title={search || filterMode !== 'all' ? 'No business rules found' : 'No business rules yet'}
          description={search || filterMode !== 'all' ? 'Try a different search term or filter.' : 'Create your first decision table to model approvals, routing logic, and policy rules.'}
        />
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pageRows.map((table) => {
            const isSelected = selected.has(table.id)
            return (
              <div
                key={table.id}
                className={cn('rounded-xl border p-4 space-y-3 relative', isSelected && 'ring-2')}
                style={{
                  borderColor: isSelected ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
                  backgroundColor: 'var(--theme-card-bg)',
                  ...(isSelected ? { boxShadow: '0 0 0 2px var(--theme-primary-light)' } : {}),
                }}
              >
                <button
                  onClick={() => toggleSelect(table.id)}
                  className="absolute top-3 left-3 z-10"
                  title={isSelected ? 'Deselect' : 'Select'}
                  style={{ color: isSelected ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
                >
                  {isSelected ? <CheckSquare size={15} /> : <Square size={15} />}
                </button>
                <div className="flex items-start justify-between gap-3 pl-7">
                  <div className="min-w-0">
                    <Link href={`/automations/rules/${table.id}`} className="text-sm font-semibold hover:underline" style={{ color: 'var(--theme-card-text)' }}>
                      {table.name}
                    </Link>
                    <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--theme-muted-text)' }}>
                      {table.description || 'No description yet.'}
                    </p>
                  </div>
                  <ExportAssetButton ids={[table.id]} name={table.name} iconOnly variant="ghost" className="!h-auto !p-1.5" style={{ color: 'var(--theme-muted-text)' }} />
                  <button
                    onClick={() => handleDelete(table.id, table.name)}
                    className="p-1.5 rounded hover:bg-red-50 transition-colors"
                    title="Delete business rule"
                  >
                    <Trash2 size={13} className="text-red-400" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center">
                  <MetricCard label="Inputs" value={table.inputs?.length ?? 0} />
                  <MetricCard label="Outputs" value={table.outputs?.length ?? 0} />
                  <MetricCard label="Rules" value={table.rules?.length ?? 0} />
                </div>

                <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                  <span>Updated {formatRelativeDate(table.updated_at ?? table.created_at)}</span>
                  <Button asChild size="sm" className="h-7 text-[11px] px-2.5">
                    <Link href={`/automations/rules/${table.id}`}>Open</Link>
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden max-lg:overflow-x-auto" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <div
            className="max-lg:min-w-[760px] grid grid-cols-[32px_minmax(0,2.3fr)_110px_110px_100px_150px_124px] gap-3 px-4 py-3 text-[11px] font-semibold uppercase tracking-wider"
            style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
          >
            <button
              onClick={toggleSelectPage}
              title={allPageSelected ? 'Deselect all on page' : 'Select all on page'}
              style={{ color: allPageSelected ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
            >
              {allPageSelected ? <CheckSquare size={13} /> : <Square size={13} />}
            </button>
            <div>Business Rule</div>
            <div>Inputs</div>
            <div>Outputs</div>
            <div>Rules</div>
            <div>Updated</div>
            <div>Actions</div>
          </div>
          {pageRows.map((table) => {
            const isSelected = selected.has(table.id)
            return (
              <div
                key={table.id}
                className="max-lg:min-w-[760px] grid grid-cols-[32px_minmax(0,2.3fr)_110px_110px_100px_150px_124px] gap-3 px-4 py-3 items-center border-t"
                style={{
                  borderColor: 'var(--theme-surface-border)',
                  backgroundColor: isSelected ? 'var(--theme-primary-light)' : undefined,
                }}
              >
                <button
                  onClick={() => toggleSelect(table.id)}
                  title={isSelected ? 'Deselect' : 'Select'}
                  style={{ color: isSelected ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
                >
                  {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                </button>
                <div className="min-w-0">
                  <Link href={`/automations/rules/${table.id}`} className="text-sm font-semibold hover:underline" style={{ color: 'var(--theme-card-text)' }}>
                    {table.name}
                  </Link>
                  <p className="text-xs mt-1 truncate" style={{ color: 'var(--theme-muted-text)' }}>
                    {table.description || 'No description yet.'}
                  </p>
                </div>
                <div className="text-sm" style={{ color: 'var(--theme-card-text)' }}>{table.inputs?.length ?? 0}</div>
                <div className="text-sm" style={{ color: 'var(--theme-card-text)' }}>{table.outputs?.length ?? 0}</div>
                <div className="text-sm" style={{ color: 'var(--theme-card-text)' }}>{table.rules?.length ?? 0}</div>
                <div className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  {formatRelativeDate(table.updated_at ?? table.created_at)}
                </div>
                <div className="flex items-center gap-2">
                  <Button asChild size="sm" variant="outline" className="h-7 text-[11px] px-2.5">
                    <Link href={`/automations/rules/${table.id}`}>Open</Link>
                  </Button>
                  <ExportAssetButton ids={[table.id]} name={table.name} iconOnly variant="ghost" className="!h-auto !p-1.5" style={{ color: 'var(--theme-muted-text)' }} />
                  <button
                    onClick={() => handleDelete(table.id, table.name)}
                    className="p-1.5 rounded hover:bg-red-50 transition-colors"
                    title="Delete business rule"
                  >
                    <Trash2 size={13} className="text-red-400" />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination footer */}
      {sorted.length > 0 && (
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg border text-[11px]"
          style={{
            borderColor: 'var(--theme-surface-border)',
            backgroundColor: 'var(--theme-card-bg)',
            color: 'var(--theme-muted-text)',
          }}
        >
          <div className="flex items-center gap-2">
            <span>
              Showing {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
            </span>
            <span>·</span>
            <label className="flex items-center gap-1">
              Rows per page
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                className="rounded border px-1.5 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--theme-surface-border)',
                  backgroundColor: 'var(--theme-card-bg)',
                  color: 'var(--theme-card-text)',
                }}
              >
                {[12, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >‹ Prev</button>
              <span className="px-2">Page {safePage} of {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >Next ›</button>
            </div>
          )}
        </div>
      )}

      {/* Bulk delete confirmation */}
      <Dialog.Root open={showBulkDelete} onOpenChange={(open) => { if (!open) { setShowBulkDelete(false) } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(24rem,92vw)] rounded-xl p-6 shadow-xl dialog-content"
            style={{ backgroundColor: 'var(--theme-card-bg)' }}
          >
            <Dialog.Title className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>
              Delete {selected.size} Business Rule{selected.size !== 1 ? 's' : ''}
            </Dialog.Title>
            <p className="text-sm mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Are you sure you want to delete {selected.size} selected business rule{selected.size !== 1 ? 's' : ''}?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--theme-danger, #DC2626)' }}>
              <AlertTriangle size={11} className="inline mr-1" /> This will permanently delete the decision tables and all their rules.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setShowBulkDelete(false) }}
              >Cancel</Button>
              <Button
                size="sm"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="!bg-red-600 hover:!bg-red-700 !text-white"
              >
                {bulkDeleting ? `Deleting (${selected.size})...` : `Delete ${selected.size}`}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg px-2 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
      <p className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{value}</p>
      <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{label}</p>
    </div>
  )
}
