'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { SearchInput } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Checkbox } from '@/components/ui/checkbox'
import { Avatar } from '@/components/ui/avatar'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Table, THead, TBody, TR, TD, TDActions, TableEmpty, thClass } from '@/components/ui/table'
import { unwrapAction } from '@/lib/action-result'
import { serverQuery } from '@/lib/server-read'
import { Map as MapIcon, Trash2, Shield, ArrowUp, ArrowDown, X, Download } from 'lucide-react'
import { useTableDependencies, AssetDependencyDialog } from '@/components/shared/asset-dependencies'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { BulkPermissionsDialog } from '@/components/governance/bulk-permissions-dialog'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Pagination } from '@/components/ui/list-controls'
import { ExportAssetButton, ExportAssetDialog } from '@/components/shared/config-transfer'
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
 * Data tables list (§5.10): one Table — name (with description or the
 * matching row), rows and columns (right-aligned, tabular), retention policy,
 * creator and last update. Search covers table names, descriptions, creators
 * and cell values (row matches show under the name). Select rows for export,
 * permissions or delete; a row's actions export it or open its dependency map.
 */
export function DataTableList({ tables }: DataTableListProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [depsId, setDepsId] = useState<string | null>(null)
  const [exportId, setExportId] = useState<string | null>(null)
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

  // Policy names for the Retention column (the list carries only the id).
  const { data: policies = [] } = useQuery({
    queryKey: ['retention-policies', 'data_tables'],
    queryFn: async () => (await serverQuery('governance.retentionPolicies', { scope: 'data_tables' })) as Array<{ id: string; name: string }>,
  })
  const policyName = useMemo(() => new Map(policies.map((p) => [p.id, p.name])), [policies])

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

  // Paging: the filtered, sorted list a page at a time; a new search or sort starts at page 1.
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  useEffect(() => { setPage(1) }, [normalizedSearch, sortBy, sortDir])
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const paged = useMemo(() => sorted.slice((currentPage - 1) * pageSize, currentPage * pageSize), [sorted, currentPage, pageSize])

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

  function sortHeader(field: SortField, label: string, opts: { numeric?: boolean; className?: string } = {}) {
    const active = sortBy === field
    return (
      <th
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
        className={cn(thClass, opts.numeric && 'text-right', opts.className)}
      >
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className={cn('inline-flex items-center gap-1 hover:text-fg', opts.numeric && 'flex-row-reverse', active && 'text-fg')}
        >
          {label}
          {active && (sortDir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDown className="size-3.5" aria-hidden="true" />)}
        </button>
      </th>
    )
  }

  const allSelected = sorted.length > 0 && selected.size === sorted.length

  return (
    <div className="space-y-3">
      {bulkDeleteNotice && (
        <InlineNotice
          tone={bulkDeleteNotice.tone}
          message={bulkDeleteNotice.message}
          onDismiss={() => setBulkDeleteNotice(null)}
        />
      )}

      {/* Toolbar: search, then the selection actions */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search tables and cell values…"
          aria-label="Search tables"
          wrapperClassName="w-full max-w-sm"
        />
        <span className="num text-xs text-fg-muted">
          {normalizedSearch ? `${formatCount(sorted.length)} of ${plural(localTables.length, 'table')}` : plural(localTables.length, 'table')}
        </span>
        {selected.size > 0 && (
          <div className="ml-auto flex items-center gap-1 rounded-md bg-primary-wash py-0.5 pl-3 pr-1">
            <span className="num mr-1 text-ui font-medium text-primary-text">{selected.size} selected</span>
            <ExportAssetButton ids={[...selected]} name={plural(selected.size, 'table')} allowRows variant="ghost" size="sm" />
            <Button size="sm" variant="ghost" leadingIcon={<Shield />} onClick={() => setShowBulkPermissions(true)}>
              Permissions
            </Button>
            <Button size="sm" variant="danger-ghost" leadingIcon={<Trash2 />} onClick={() => setShowBulkDelete(true)}>
              Delete
            </Button>
            <IconButton size="sm" label="Clear selection" icon={<X />} onClick={() => setSelected(new Set())} />
          </div>
        )}
      </div>

      <Table>
        <THead>
          <tr>
            <th scope="col" className={cn(thClass, 'w-10 pr-0')}>
              <Checkbox
                checked={allSelected}
                ref={el => { if (el) el.indeterminate = selected.size > 0 && selected.size < sorted.length }}
                onChange={toggleSelectAll}
                aria-label="Select all tables"
              />
            </th>
            {sortHeader('name', 'Name')}
            {sortHeader('rows', 'Rows', { numeric: true, className: 'w-24' })}
            {sortHeader('columns', 'Columns', { numeric: true, className: 'w-24' })}
            <th scope="col" className={cn(thClass, 'w-48')}>Retention</th>
            <th scope="col" className={cn(thClass, 'w-48')}>Created by</th>
            {sortHeader('updated_at', 'Updated', { className: 'w-36' })}
            <th scope="col" className={cn(thClass, 'w-px')}><span className="sr-only">Actions</span></th>
          </tr>
        </THead>
        <TBody>
          {sorted.length === 0 && (
            <TableEmpty
              colSpan={8}
              variant="no-results"
              title={`No tables match “${search.trim()}”`}
              action={{ label: 'Clear search', onClick: () => setSearch('') }}
            />
          )}
          {paged.map((table) => {
            const match = rowMatchesByTable.get(table.id)
            const sub = match?.preview?.[0] ?? table.description
            const updated = table.updated_at ?? table.created_at
            const creatorName = table.creator?.display_name ?? table.creator?.email ?? null
            return (
              <TR
                key={table.id}
                interactive
                selected={selected.has(table.id)}
                onClick={() => router.push(`/data/${table.id}`)}
              >
                <TD className="pr-0" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(table.id)}
                    onChange={() => toggleSelect(table.id)}
                    aria-label={`Select ${table.name}`}
                  />
                </TD>
                <TD className="max-w-0 py-1.5">
                  <Link
                    href={`/data/${table.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-medium text-fg hover:underline"
                  >
                    {table.name}
                  </Link>
                  {sub && (
                    <span className={cn('block truncate text-xs', match ? 'text-primary-text' : 'text-fg-muted')}>
                      {match ? `${plural(match.count, 'row match', 'row matches')} · ${sub}` : sub}
                    </span>
                  )}
                </TD>
                <TD numeric>{formatCount(table.row_count?.[0]?.count ?? 0)}</TD>
                <TD numeric>{formatCount((table.columns as any[])?.length ?? 0)}</TD>
                <TD className="max-w-48 truncate text-fg-muted">
                  {table.retention_policy_id ? (policyName.get(table.retention_policy_id) ?? 'Policy assigned') : '—'}
                </TD>
                <TD>
                  {creatorName ? (
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar name={creatorName} size="sm" />
                      <span className="truncate text-fg-muted">{creatorName}</span>
                    </span>
                  ) : <span className="text-fg-subtle">—</span>}
                </TD>
                <TD className="num whitespace-nowrap text-fg-muted">
                  <span title={formatAbsolute(updated)}>{formatRelative(updated)}</span>
                </TD>
                <TDActions onClick={(e) => e.stopPropagation()}>
                  <IconButton size="sm" label="Export" icon={<Download />} onClick={() => setExportId(table.id)} />
                  <IconButton size="sm" label="Dependency map" icon={<MapIcon />} onClick={() => setDepsId(table.id)} />
                </TDActions>
              </TR>
            )
          })}
        </TBody>
      </Table>
      <Pagination page={currentPage} pageSize={pageSize} total={sorted.length} onPageChange={setPage}
        onPageSizeChange={setPageSize} pageSizeOptions={[25, 50, 100]} showPageNumbers noun="tables" />

      <ConfirmDialog
        open={showBulkDelete}
        onOpenChange={setShowBulkDelete}
        destructive
        title={`Delete ${plural(selected.size, 'table')}?`}
        description="The selected tables and all their rows are deleted permanently."
        confirmLabel={`Delete ${plural(selected.size, 'table')}`}
        busy={bulkDeleting}
        onConfirm={handleBulkDelete}
      />

      <BulkPermissionsDialog
        open={showBulkPermissions}
        onOpenChange={setShowBulkPermissions}
        objectType="data_table"
        objectIds={[...selected]}
        showExecute={false}
      />

      <ExportAssetDialog
        ids={exportId ? [exportId] : []}
        name={localTables.find((t) => t.id === exportId)?.name ?? ''}
        allowRows
        open={exportId !== null}
        onOpenChange={(open) => { if (!open) setExportId(null) }}
      />

      <AssetDependencyDialog
        open={depsId !== null}
        onOpenChange={(open) => { if (!open) setDepsId(null) }}
        title={depsTable?.name ?? ''}
        subtitle="Data table"
        deps={deps}
        loading={depsLoading}
        rowLabel="Rows"
      />
    </div>
  )
}
