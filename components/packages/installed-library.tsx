'use client'

/**
 * Settings → Packages → Installed: the library with search, filters
 * (status, source, category, tags), sort, paging and a bulk Uninstall
 * (lib/packages/library.ts for the rules and the URL state). The rows
 * themselves (details, Complete setup, Upgrade, History, Uninstall) are the
 * caller's (`renderRow`).
 *
 * URL: read once after hydration and written with history.replaceState
 * (the page is a client page without a Suspense boundary for
 * useSearchParams; Next keeps the router in sync with replaceState).
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { CountBadge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Pagination } from '@/components/ui/list-controls'
import { TagFilterMenu } from '@/components/ui/list-tags'
import { Table, TBody, TH, THead } from '@/components/ui/table'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useJobs } from '@/components/jobs/jobs-provider'
import {
  clearLibraryFilters, DEFAULT_LIBRARY_FILTERS, hasLibraryFilters, LIBRARY_MAX, LIBRARY_PAGE_SIZES, LIBRARY_SORTS, LIBRARY_STATUSES, libraryFacets,
  nextLibraryFilters, parseLibraryFilters, queryLibrary, serializeLibraryFilters, type LibraryFilters, type LibraryRow,
} from '@/lib/packages/library'

/** A toolbar filter: checkboxes in a menu (any of them matches), like the tag filter. */
function CheckMenu<T extends string>({ label, options, selected, onChange, testId }: {
  label: string
  options: Array<{ value: T; label: string; count?: number; description?: string }>
  selected: T[]
  onChange: (next: T[]) => void
  testId: string
}) {
  if (!options.length && !selected.length) return null
  const active = selected.length > 0
  const one = active && selected.length === 1 ? options.find((o) => o.value === selected[0])?.label ?? selected[0] : null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" trailingIcon={<ChevronDown />} data-testid={testId} aria-label={active ? `${label}: ${selected.map((v) => options.find((o) => o.value === v)?.label ?? v).join(', ')}` : `Filter by ${label.toLowerCase()}`}>
          {one ? <span className="max-w-[11rem] truncate">{one}</span> : label}
          {active && selected.length > 1 && <CountBadge count={selected.length} tone="brand" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 min-w-[220px]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((option) => (
          <DropdownMenuCheckboxItem key={option.value} checked={selected.includes(option.value)} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(on) => onChange(on ? [...selected, option.value] : selected.filter((v) => v !== option.value))}>
            <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
              <span className="truncate" title={option.description}>{option.label}</span>
              {option.count !== undefined && <span className="num text-2xs text-fg-muted">{option.count}</span>}
            </span>
          </DropdownMenuCheckboxItem>
        ))}
        {active && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange([])}>Clear</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function InstalledLibrary<R extends LibraryRow & { name: string }>({ installs, capped, canInstall, columns, renderRow, onChanged, onNotice }: {
  installs: R[]
  capped: boolean
  canInstall: boolean
  /** Header cells after the selection column. */
  columns: ReactNode
  renderRow: (install: R, selection: { checked: boolean; onChange: (checked: boolean) => void } | null) => ReactNode
  onChanged: () => void
  onNotice: (notice: { tone: 'success' | 'warning' | 'error'; message: string }) => void
}) {
  const jobs = useJobs()
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmBulk, setConfirmBulk] = useState(false)
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the URL after hydration */
    setFilters(parseLibraryFilters(new URLSearchParams(window.location.search)))
  }, [])
  const update = (patch: Partial<LibraryFilters>) => {
    setFilters((current) => {
      const next = nextLibraryFilters(current, patch)
      const query = serializeLibraryFilters(next, window.location.search)
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
      return next
    })
  }

  const facets = useMemo(() => libraryFacets(installs), [installs])
  const result = useMemo(() => queryLibrary(installs, filters), [installs, filters])
  const filtered = hasLibraryFilters(filters)
  // Selections that are no longer in the list (uninstalled) drop out.
  const ids = new Set(installs.map((i) => i.id))
  const chosen = [...selected].filter((id) => ids.has(id))
  const pageIds = result.rows.map((r) => r.id)
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id))
  const toggle = (id: string, on: boolean) => setSelected((cur) => { const next = new Set(cur); if (on) next.add(id); else next.delete(id); return next })
  const sortDef = LIBRARY_SORTS.find((s) => s.value === filters.sort)!

  const bulkUninstall = async () => {
    setBulkBusy(true)
    const byId = new Map(installs.map((i) => [i.id, i]))
    const done: string[] = []
    const failed: string[] = []
    for (const id of chosen) {
      const install = byId.get(id)
      if (!install) continue
      try {
        // Safe defaults (as the dialog's): items changed here and tables with rows are kept; unfinished runs refuse.
        const job = await jobs.start('package.uninstall', { install_id: id, name: install.name, force: false, delete_data: false, cancel_runs: false }, { effect: 'change', quietIfInline: true })
        if (job?.status === 'failed') failed.push(`${install.name} (${job.error ?? 'failed'})`)
        else done.push(install.name)
      } catch (error) {
        failed.push(`${install.name} (${error instanceof Error ? error.message : 'could not start'})`)
      }
    }
    setBulkBusy(false)
    setConfirmBulk(false)
    setSelected(new Set())
    onNotice({
      tone: failed.length ? (done.length ? 'warning' : 'error') : 'success',
      message: `${done.length ? `Uninstalled ${done.length} package${done.length === 1 ? '' : 's'}.` : ''}${failed.length ? ` Not uninstalled: ${failed.join('; ')}.` : ''}`.trim(),
    })
    onChanged()
  }

  return (
    <div className="space-y-3" data-testid="installed-library">
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Installed packages">
        <SearchInput value={filters.q} onValueChange={(q) => update({ q })} placeholder="Search name, version, source, items…" aria-label="Search installed packages" wrapperClassName="w-full max-w-[16rem]" data-testid="library-search" />
        <CheckMenu label="Status" testId="library-status" selected={filters.status} onChange={(status) => update({ status })}
          options={LIBRARY_STATUSES.map((s) => ({ value: s.value, label: s.label, description: s.description, count: facets.status[s.value] }))} />
        <CheckMenu label="Source" testId="library-source" selected={filters.source} onChange={(source) => update({ source })} options={facets.sources} />
        <CheckMenu label="Category" testId="library-category" selected={filters.category} onChange={(category) => update({ category })} options={facets.categories} />
        <TagFilterMenu tags={facets.tags} selected={filters.tags} onChange={(tags) => update({ tags })} />
        <div className="ml-auto flex items-center gap-1.5">
          <Select aria-label="Sort by" wrapperClassName="w-36" size="sm" value={filters.sort} onChange={(e) => update({ sort: e.target.value as LibraryFilters['sort'] })}
            options={LIBRARY_SORTS.map((s) => ({ value: s.value, label: `Sort: ${s.label}` }))} data-testid="library-sort" />
          <Button variant="secondary" size="sm" onClick={() => update({ dir: filters.dir === 'asc' ? 'desc' : 'asc' })} data-testid="library-dir"
            aria-label={`${sortDef.label}: ${filters.dir === 'asc' ? 'ascending' : 'descending'} (switch)`}
            leadingIcon={filters.dir === 'asc' ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}>
            {filters.dir === 'asc' ? 'Asc' : 'Desc'}
          </Button>
        </div>
      </div>
      {(filtered || capped) && (
        <p className="num text-xs text-fg-muted" aria-live="polite" data-testid="library-count">
          {filtered ? `${result.total} of ${installs.length} packages` : ''}
          {capped ? `${filtered ? ' · ' : ''}Showing the ${LIBRARY_MAX} most recently installed packages` : ''}
          {filtered && <button type="button" className="ml-2 text-primary-text underline underline-offset-2" onClick={() => update(clearLibraryFilters(filters))}>Clear filters</button>}
        </p>
      )}
      {canInstall && chosen.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-subtle px-3 py-2 text-ui" data-testid="library-bulk">
          <span className="num font-medium text-fg">{chosen.length} selected</span>
          <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => setConfirmBulk(true)} data-testid="library-bulk-uninstall">Uninstall</Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}
      {result.total === 0 ? (
        <EmptyState size="sm" variant="no-results" title="No packages match" description="Try other words or fewer filters." action={{ label: 'Clear filters', onClick: () => update(clearLibraryFilters(filters)) }} />
      ) : (
        <Table label="Installed packages">
          <THead>
            <tr>
              {canInstall && (
                <TH className="w-8">
                  <Checkbox aria-label={allOnPage ? 'Deselect the packages on this page' : 'Select the packages on this page'} checked={allOnPage}
                    onChange={(e) => setSelected((cur) => { const next = new Set(cur); for (const id of pageIds) { if (e.target.checked) next.add(id); else next.delete(id) } return next })} />
                </TH>
              )}
              {columns}
            </tr>
          </THead>
          <TBody>
            {result.rows.map((install) => (
              <Fragment key={install.id}>{renderRow(install, canInstall ? { checked: selected.has(install.id), onChange: (on) => toggle(install.id, on) } : null)}</Fragment>
            ))}
          </TBody>
        </Table>
      )}
      <Pagination page={result.page} pageSize={filters.pageSize} total={result.total} noun="packages"
        onPageChange={(page) => update({ page })} onPageSizeChange={(pageSize) => update({ pageSize })}
        pageSizeOptions={LIBRARY_PAGE_SIZES} pageSizeResetsPage={false} />
      <ConfirmDialog open={confirmBulk} onOpenChange={(open) => { if (!bulkBusy) setConfirmBulk(open) }}
        title={`Uninstall ${chosen.length} package${chosen.length === 1 ? '' : 's'}?`}
        description={`Each package and its artifacts are removed, as with Uninstall on one package: ${installs.filter((i) => chosen.includes(i.id)).map((i) => i.name).join(', ')}. Items changed in this workspace since install and data tables that hold rows are kept; a package with unfinished workflow runs is not uninstalled (use Uninstall on that package to cancel them). Recorded in the package history.`}
        confirmLabel="Uninstall" destructive busy={bulkBusy} onConfirm={() => void bulkUninstall()} />
    </div>
  )
}
