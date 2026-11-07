'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tooltip } from '@/components/ui/tooltip'
import { Pagination } from '@/components/ui/list-controls'
import { Table, THead, TBody, TR, TH, TD, TDActions } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Search, GitBranch, Trash2, ChevronUp, ChevronDown, LayoutGrid, List } from 'lucide-react'
import { deleteDecisionTable } from '@/app/actions/business-rules'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { cn } from '@/lib/utils'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { InlineNotice } from '@/components/ui/inline-notice'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ExportAssetButton } from '@/components/shared/config-transfer'
import { buildQueuedDeleteNotice, type DeleteNotice } from '@/lib/queued-delete-feedback'

type SortField = 'name' | 'inputs' | 'outputs' | 'updated_at'
type SortDir = 'asc' | 'desc'
type FilterMode = 'all' | 'ready' | 'needs_rules' | 'needs_structure'
type ViewMode = 'cards' | 'list'

const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZE_OPTIONS = [12, 25, 50, 100] as const

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
    return sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
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
        title="Delete business rule"
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
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search business rules…"
          aria-label="Search business rules"
          leading={<Search />}
          className="min-w-[200px] flex-1"
        />
        <Select
          value={filterMode}
          onChange={(e) => setFilterMode(e.target.value as FilterMode)}
          aria-label="Filter business rules"
          wrapperClassName="w-auto min-w-[160px]"
        >
          <option value="all">All rules</option>
          <option value="ready">Ready to use</option>
          <option value="needs_rules">Needs rules</option>
          <option value="needs_structure">Needs inputs/outputs</option>
        </Select>
        <div className="flex items-center gap-0.5" role="group" aria-label="Sort by">
          {(['name', 'inputs', 'outputs', 'updated_at'] as SortField[]).map((field) => (
            <Button
              key={field}
              size="sm"
              variant="ghost"
              onClick={() => toggleSort(field)}
              aria-pressed={sortBy === field}
              className={cn('gap-0.5', sortBy === field ? 'bg-muted text-fg' : 'text-fg-muted')}
            >
              {SORT_LABELS[field]}
              <SortIcon field={field} />
            </Button>
          ))}
        </div>
        <SegmentedControl
          aria-label="View"
          size="sm"
          value={viewMode}
          onValueChange={setViewMode}
          options={[
            { value: 'list', icon: <List />, text: 'List' },
            { value: 'cards', icon: <LayoutGrid />, text: 'Cards' },
          ]}
        />
      </div>

      {/* Selection toolbar — only visible once something is ticked.
          Matches the template list pattern so bulk actions feel
          consistent across the app. */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-primary-wash px-4 py-2">
          <span className="num text-ui font-medium text-primary-text">
            {formatCount(selected.size)} selected
          </span>
          <Button variant="link" size="sm" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <div className="flex-1" />
          <ExportAssetButton ids={[...selected]} name={plural(selected.size, 'business rule')} />
          <Button
            size="sm"
            variant="danger"
            leadingIcon={<Trash2 />}
            onClick={() => setShowBulkDelete(true)}
          >
            Delete {selected.size}
          </Button>
        </div>
      )}

      <p className="num text-xs text-fg-muted">
        {sorted.length === tables.length
          ? plural(tables.length, 'business rule')
          : `${formatCount(sorted.length)} of ${plural(tables.length, 'business rule')} match`}
      </p>

      {sorted.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          variant={search || filterMode !== 'all' ? 'no-results' : 'first-run'}
          title={search || filterMode !== 'all' ? 'No business rules found' : 'No business rules yet'}
          description={search || filterMode !== 'all' ? 'Try a different search term or filter.' : 'Create your first decision table to model approvals, routing logic, and policy rules.'}
        />
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pageRows.map((table) => {
            const isSelected = selected.has(table.id)
            return (
              <Card
                key={table.id}
                padding="md"
                data-selected={isSelected || undefined}
                className={cn('group/card relative space-y-3 transition-colors hover:border-border-strong', isSelected && 'border-primary bg-primary-wash')}
              >
                <div className="flex items-start gap-3">
                  <Checkbox
                    checked={isSelected}
                    onChange={() => toggleSelect(table.id)}
                    aria-label={isSelected ? 'Deselect' : 'Select'}
                    className={cn('mt-0.5 transition-opacity', !isSelected && 'opacity-0 focus-visible:opacity-100 group-hover/card:opacity-100 [@media(pointer:coarse)]:opacity-100')}
                  />
                  <div className="min-w-0 flex-1">
                    <Link href={`/automations/rules/${table.id}`} className="block truncate text-sm font-semibold text-fg hover:underline">
                      {table.name}
                    </Link>
                    <p className="mt-1 line-clamp-2 text-xs text-fg-muted">
                      {table.description || 'No description yet.'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <ExportAssetButton ids={[table.id]} name={table.name} iconOnly variant="ghost" size="icon" className="size-7 text-fg-muted" />
                    <IconButton
                      size="sm"
                      variant="danger-ghost"
                      label="Delete business rule"
                      icon={<Trash2 />}
                      onClick={() => handleDelete(table.id, table.name)}
                    />
                  </div>
                </div>

                <Card variant="inset" padding="sm" className="grid grid-cols-3 gap-2 text-center">
                  <Metric label="Inputs" value={table.inputs?.length ?? 0} />
                  <Metric label="Outputs" value={table.outputs?.length ?? 0} />
                  <Metric label="Rules" value={table.rules?.length ?? 0} />
                </Card>

                <div className="flex items-center justify-between text-xs text-fg-muted">
                  <span>Updated <UpdatedAt value={table.updated_at ?? table.created_at} /></span>
                  <Button asChild size="sm" variant="secondary">
                    <Link href={`/automations/rules/${table.id}`}>Open</Link>
                  </Button>
                </div>
              </Card>
            )
          })}
        </div>
      ) : (
        <Table className="min-w-[760px]">
          <THead>
            <tr>
              <TH className="w-10">
                <Checkbox
                  checked={allPageSelected}
                  onChange={toggleSelectPage}
                  aria-label={allPageSelected ? 'Deselect all on page' : 'Select all on page'}
                />
              </TH>
              <TH>Business rule</TH>
              <TH numeric className="w-24">Inputs</TH>
              <TH numeric className="w-24">Outputs</TH>
              <TH numeric className="w-24">Rules</TH>
              <TH className="w-36">Updated</TH>
              <TH className="w-px"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {pageRows.map((table) => {
              const isSelected = selected.has(table.id)
              return (
                <TR key={table.id} selected={isSelected}>
                  <TD className="w-10">
                    <Checkbox
                      checked={isSelected}
                      onChange={() => toggleSelect(table.id)}
                      aria-label={isSelected ? 'Deselect' : 'Select'}
                      className={cn('transition-opacity', !isSelected && 'opacity-0 focus-visible:opacity-100 group-hover/row:opacity-100 [@media(pointer:coarse)]:opacity-100')}
                    />
                  </TD>
                  <TD className="max-w-0 py-2">
                    <Link href={`/automations/rules/${table.id}`} className="block truncate font-medium text-fg hover:underline">
                      {table.name}
                    </Link>
                    <p className="truncate text-xs text-fg-muted">
                      {table.description || 'No description yet.'}
                    </p>
                  </TD>
                  <TD numeric>{table.inputs?.length ?? 0}</TD>
                  <TD numeric>{table.outputs?.length ?? 0}</TD>
                  <TD numeric>{table.rules?.length ?? 0}</TD>
                  <TD className="text-xs text-fg-muted">
                    <UpdatedAt value={table.updated_at ?? table.created_at} />
                  </TD>
                  <TDActions>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/automations/rules/${table.id}`}>Open</Link>
                    </Button>
                    <ExportAssetButton ids={[table.id]} name={table.name} iconOnly variant="ghost" size="icon" className="size-7 text-fg-muted" />
                    <IconButton
                      size="sm"
                      variant="danger-ghost"
                      label="Delete business rule"
                      icon={<Trash2 />}
                      onClick={() => handleDelete(table.id, table.name)}
                    />
                  </TDActions>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      {sorted.length > 0 && (
        <Pagination
          page={safePage}
          pageSize={pageSize}
          total={sorted.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          showPageNumbers
          noun="business rules"
        />
      )}

      {/* Bulk delete confirmation */}
      <Dialog open={showBulkDelete} onOpenChange={(open) => { if (!open) { setShowBulkDelete(false) } }}>
        <DialogContent
          size="sm"
          title={`Delete ${plural(selected.size, 'business rule')}`}
          description={`Are you sure you want to delete ${plural(selected.size, 'selected business rule')}?`}
        >
          <DialogBody>
            <InlineNotice tone="danger" message="This will permanently delete the decision tables and all their rules." />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setShowBulkDelete(false) }}>Cancel</Button>
            <Button variant="danger" onClick={handleBulkDelete} disabled={bulkDeleting} loading={bulkDeleting}>
              Delete {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const SORT_LABELS: Record<SortField, string> = { name: 'Name', inputs: 'Inputs', outputs: 'Outputs', updated_at: 'Updated' }

function UpdatedAt({ value }: { value: string }) {
  return (
    <Tooltip content={formatAbsolute(value)}>
      <span className="num">{formatRelative(value)}</span>
    </Tooltip>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="num text-sm font-semibold text-fg">{value}</p>
      <p className="text-2xs text-fg-muted">{label}</p>
    </div>
  )
}
