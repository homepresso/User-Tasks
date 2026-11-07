'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input, SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Card } from '@/components/ui/card'
import { StatusPill, Tag } from '@/components/ui/badge'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs } from '@/components/ui/tabs'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { Tooltip } from '@/components/ui/tooltip'
import { Table, THead, TBody, TR, TH, TD, TDActions } from '@/components/ui/table'
import { Dialog, DialogContent, DialogBody, DialogFooter } from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import {
  Bot, Plus, LayoutGrid, List, Trash2, Download, MoreHorizontal, History,
  ChevronUp, ChevronDown } from 'lucide-react'
import { createAgent, deleteAgent } from '@/app/actions/agents'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { ignoreRedirect, isRedirectError } from '@/lib/submit-guard'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { useAppStore } from '@/stores/app-store'
import { InlineNotice } from '@/components/ui/inline-notice'
import { buildQueuedDeleteNotice } from '@/lib/queued-delete-feedback'
import { usePermissions } from '@/lib/permissions-context'
import { ExportAssetButton, ExportAssetDialog, ImportConfigButton } from '@/components/shared/config-transfer'
import { cn } from '@/lib/utils'
import { plural } from '@/lib/format/plural'
import { formatCount } from '@/lib/format/number'
import { formatAbsolute, formatRelative } from '@/lib/format/date'

interface AgentListProps { agents: any[] }

type SortField = 'updated_at' | 'name' | 'model' | 'tools'
type StatusFilter = 'all' | 'active' | 'inactive'

const DEFAULT_PAGE_SIZE = 25
const PAGE_SIZES = [12, 25, 50, 100] as const

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: 'updated_at:desc', label: 'Recently updated' },
  { value: 'updated_at:asc', label: 'Least recently updated' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'model:asc', label: 'Model A–Z' },
  { value: 'model:desc', label: 'Model Z–A' },
  { value: 'tools:desc', label: 'Most tools' },
  { value: 'tools:asc', label: 'Fewest tools' },
]

/** Agents | Costs & budgets: the page views of the Agents section. */
export function AgentsTabs({ value }: { value: 'agents' | 'costs' }) {
  return (
    <Tabs
      aria-label="Agents"
      value={value}
      linkAs={Link}
      items={[
        { value: 'agents', label: 'Agents', href: '/agents' },
        { value: 'costs', label: 'Costs & budgets', href: '/agents/costs' },
      ]}
    />
  )
}

export const AGENTS_DESCRIPTION = 'AI agents answer in chat and run from workflows, using only the tools and data you grant them.'

export function AgentList({ agents }: AgentListProps) {
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const { can } = usePermissions()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const { layoutPreference, setLayoutPreference } = useAppStore()
  const viewMode = (layoutPreference.agents === 'list' ? 'list' : 'grid') as 'grid' | 'list'
  const setViewMode = (v: 'grid' | 'list') => setLayoutPreference('agents', v)
  const [sortBy, setSortBy] = useState<SortField>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE)
  const [showCreate, setShowCreate] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  // Synchronous guard so a double click can't create the agent twice.
  const createGuard = useSubmitGuard()
  const creating = createGuard.pending
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [localAgents, setLocalAgents] = useState<any[]>(agents)
  // The per-agent export dialog, opened from a card or row menu.
  const [exportTarget, setExportTarget] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    setLocalAgents(agents)
  }, [agents])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return localAgents.filter(a => {
      if (statusFilter === 'active' && !a.is_active) return false
      if (statusFilter === 'inactive' && a.is_active) return false
      if (!q) return true
      return (
        (a.name ?? '').toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q) ||
        (a.model ?? '').toLowerCase().includes(q)
      )
    })
  }, [localAgents, search, statusFilter])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    copy.sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = (a.name ?? '').localeCompare(b.name ?? '')
      else if (sortBy === 'model') cmp = (a.model ?? '').localeCompare(b.model ?? '')
      else if (sortBy === 'tools') cmp = ((a.tools as any[])?.length ?? 0) - ((b.tools as any[])?.length ?? 0)
      else cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      return sortDir === 'desc' ? -cmp : cmp
    })
    return copy
  }, [filtered, sortBy, sortDir])

  // Reset pagination whenever the working set changes so the user
  // doesn't end up stranded on an empty page after typing a search.
  useEffect(() => { setPage(1) }, [search, statusFilter, pageSize])
  useEffect(() => { setSelected(new Set()) }, [localAgents, search, statusFilter, sortBy, sortDir, viewMode, pageSize, page])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * pageSize, safePage * pageSize),
    [sorted, safePage, pageSize],
  )

  function toggleSort(field: SortField) {
    if (sortBy === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(field); setSortDir('desc') }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAllVisible() {
    const ids = pageRows.map(agent => agent.id)
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id))
    setSelected(prev => {
      const next = new Set(prev)
      if (allSelected) {
        ids.forEach(id => next.delete(id))
      } else {
        ids.forEach(id => next.add(id))
      }
      return next
    })
  }

  async function handleCreate() {
    if (!createName.trim()) return
    await createGuard.run(async () => {
      setActionError(null)
      try { await createAgent({ name: createName.trim(), description: createDesc.trim() || undefined }) }
      catch (err: any) {
        // A redirect means it worked: keep the guard locked while navigating.
        if (isRedirectError(err)) throw err
        setActionError(err.message ?? 'Failed to create agent')
      }
    }).catch(ignoreRedirect)
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true); setActionError(null)
    try {
      const currentDeleteId = deleteId
      setLocalAgents((prev) => prev.filter((agent) => agent.id !== currentDeleteId))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(currentDeleteId)
        return next
      })
      setDeleteId(null)
      await deleteAgent(currentDeleteId)
      queryClient.invalidateQueries({ queryKey: ['agents'] })
    }
    catch (err: any) { setActionError(err.message ?? 'Failed to delete agent') }
    finally { setDeleting(false) }
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    setBulkDeleting(true); setActionError(null)
    try {
      setLocalAgents((prev) => prev.filter((agent) => !ids.includes(agent.id)))
      setSelected(new Set())
      setShowBulkDelete(false)
      const result = await bulkDeleteWithJob(jobs, 'agent', ids, () => queryClient.invalidateQueries({ queryKey: ['agents'] }))
      if (!result.background) setActionError(buildQueuedDeleteNotice({
        queued: result?.queued ?? 0,
        total: ids.length,
        singular: 'agent',
        plural: 'agents',
      }).message)
    } catch (err: any) {
      setActionError(err.message ?? 'Failed to delete selected agents')
    }
    setBulkDeleting(false)
  }

  const allVisibleSelected = pageRows.length > 0 && pageRows.every(agent => selected.has(agent.id))
  const someVisibleSelected = pageRows.some(agent => selected.has(agent.id)) && !allVisibleSelected

  function sortHeader(field: SortField, label: string, numeric?: boolean) {
    const active = sortBy === field
    return (
      <TH numeric={numeric} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className={cn('inline-flex items-center gap-1 hover:text-fg', active && 'text-fg')}
        >
          {label}
          {active && (sortDir === 'asc' ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />)}
        </button>
      </TH>
    )
  }

  function agentMenu(agent: any) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" label={`More actions for ${agent.name}`} icon={<MoreHorizontal />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <Link href={`/agents/${agent.id}/runs`}>
              <History className="size-4 text-fg-muted" aria-hidden="true" /> View runs
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Download />} onSelect={() => setExportTarget({ id: agent.id, name: agent.name })}>
            Export…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setDeleteId(agent.id)}>
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const filtersActive = search.trim() !== '' || statusFilter !== 'all'

  return (
    <div>
      <PageHeader
        title="Agents"
        description={AGENTS_DESCRIPTION}
        actions={(
          <>
            {can('agents.create') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['agents'] })} />}
            <Button onClick={() => setShowCreate(true)} leadingIcon={<Plus />}>New agent</Button>
          </>
        )}
        tabs={<AgentsTabs value="agents" />}
      />

      <div className="space-y-3">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-primary-wash px-3 py-2">
            <span className="num text-ui font-medium text-primary-text">{formatCount(selected.size)} selected</span>
            <Button size="sm" variant="ghost" onClick={toggleSelectAllVisible}>
              {allVisibleSelected ? 'Deselect visible' : 'Select visible'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
            <div className="flex-1" />
            <ExportAssetButton ids={[...selected]} name={plural(selected.size, 'agent')} />
            <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => setShowBulkDelete(true)}>
              Delete {selected.size}
            </Button>
          </div>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search name, description, or model…"
            aria-label="Search agents"
            wrapperClassName="min-w-[220px] flex-1"
          />
          <SegmentedControl
            aria-label="Status"
            value={statusFilter}
            onValueChange={setStatusFilter}
            options={[
              { value: 'all', text: 'All' },
              { value: 'active', text: 'Active' },
              { value: 'inactive', text: 'Inactive' },
            ]}
          />
          <Select
            aria-label="Sort"
            value={`${sortBy}:${sortDir}`}
            onChange={e => {
              const [field, dir] = e.target.value.split(':') as [SortField, 'asc' | 'desc']
              setSortBy(field); setSortDir(dir)
            }}
            options={SORT_OPTIONS}
            wrapperClassName="w-auto"
          />
          <SegmentedControl
            aria-label="View"
            size="sm"
            value={viewMode}
            onValueChange={setViewMode}
            options={[
              { value: 'grid', icon: <LayoutGrid />, label: 'Grid' },
              { value: 'list', icon: <List />, label: 'List' },
            ]}
          />
          <span className="num ml-auto text-xs text-fg-muted">
            {sorted.length === agents.length
              ? plural(agents.length, 'agent')
              : `${formatCount(sorted.length)} of ${plural(agents.length, 'agent')} match`}
          </span>
        </div>

        {actionError && (
          <InlineNotice tone="warning" message={actionError} onDismiss={() => setActionError(null)} />
        )}

        {sorted.length === 0 ? (
          <Card padding="none">
            {filtersActive ? (
              <EmptyState
                size="sm"
                variant="no-results"
                icon={Bot}
                title={search ? 'No agents match your search' : 'No agents match this filter'}
                action={{ label: 'Clear filters', onClick: () => { setSearch(''); setStatusFilter('all') } }}
              />
            ) : (
              <EmptyState
                icon={Bot}
                title="No agents yet"
                description="Create your first AI agent to get started."
                action={{ label: 'New agent', onClick: () => setShowCreate(true) }}
              />
            )}
          </Card>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pageRows.map(agent => {
              const isSelected = selected.has(agent.id)
              const toolCount = (agent.tools as any[])?.length ?? 0
              return (
                <Card
                  key={agent.id}
                  variant="interactive"
                  padding="md"
                  className={cn('group relative flex flex-col gap-2', isSelected && 'border-primary hover:border-primary')}
                >
                  <div className="flex items-start gap-3">
                    {/* The icon tile turns into the select checkbox on hover / focus, and stays one while selected. */}
                    <div className="relative z-10 size-8 shrink-0">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'flex size-8 items-center justify-center rounded-md bg-primary-wash text-primary-text transition-opacity duration-[var(--ds-dur-fast)]',
                          isSelected ? 'opacity-0' : 'group-focus-within:opacity-0 group-hover:opacity-0',
                        )}
                      >
                        <Bot size={16} />
                      </span>
                      <span
                        className={cn(
                          'absolute inset-0 flex items-center justify-center transition-opacity duration-[var(--ds-dur-fast)]',
                          isSelected ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100',
                        )}
                      >
                        <Checkbox
                          aria-label={`Select ${agent.name}`}
                          checked={isSelected}
                          onChange={() => toggleSelect(agent.id)}
                        />
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="line-clamp-2 text-sm font-semibold text-fg">
                        {/* Stretched link: the whole card opens the agent; the checkbox and menu sit above it. */}
                        <Link href={`/agents/${agent.id}`} className="after:absolute after:inset-0 after:rounded-lg">
                          {agent.name}
                        </Link>
                      </h3>
                      {agent.model && <Tag mono className="mt-1 max-w-full">{agent.model}</Tag>}
                    </div>
                    <StatusPill status={agent.is_active ? 'active' : 'inactive'} className="shrink-0" />
                  </div>
                  {agent.description && <p className="line-clamp-2 text-xs text-fg-muted">{agent.description}</p>}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <p className="num min-w-0 flex-1 truncate text-xs text-fg-muted">
                      {plural(toolCount, 'tool')} · {agent.integration?.name ?? 'No provider'}
                    </p>
                    <div className="relative z-10 -my-1 -mr-1">{agentMenu(agent)}</div>
                  </div>
                </Card>
              )
            })}
          </div>
        ) : (
          <Table>
            <THead>
              <tr>
                <TH className="w-10">
                  <Checkbox
                    aria-label="Select visible"
                    checked={allVisibleSelected}
                    ref={el => { if (el) el.indeterminate = someVisibleSelected }}
                    onChange={toggleSelectAllVisible}
                  />
                </TH>
                {sortHeader('name', 'Name')}
                {sortHeader('model', 'Model')}
                {sortHeader('tools', 'Tools', true)}
                <TH>Status</TH>
                {sortHeader('updated_at', 'Updated')}
                <TH className="w-12"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {pageRows.map(agent => {
                const isSelected = selected.has(agent.id)
                return (
                  <TR key={agent.id} selected={isSelected} className="group">
                    <TD>
                      <span className={cn('inline-flex transition-opacity', isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100')}>
                        <Checkbox
                          aria-label={`Select ${agent.name}`}
                          checked={isSelected}
                          onChange={() => toggleSelect(agent.id)}
                        />
                      </span>
                    </TD>
                    <TD className="w-[40%] max-w-0">
                      <Link href={`/agents/${agent.id}`} className="flex min-w-0 items-center gap-2">
                        <Bot size={14} className="shrink-0 text-primary-text" aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg hover:underline">{agent.name}</span>
                          {agent.description && <span className="block truncate text-xs text-fg-muted">{agent.description}</span>}
                        </span>
                      </Link>
                    </TD>
                    <TD>{agent.model ? <Tag mono>{agent.model}</Tag> : <span className="text-fg-muted">—</span>}</TD>
                    <TD numeric className="text-fg-muted">{formatCount((agent.tools as any[])?.length ?? 0)}</TD>
                    <TD><StatusPill status={agent.is_active ? 'active' : 'inactive'} /></TD>
                    <TD className="text-xs text-fg-muted">
                      {agent.updated_at ? (
                        <Tooltip content={formatAbsolute(agent.updated_at)}>
                          <span className="num">{formatRelative(agent.updated_at)}</span>
                        </Tooltip>
                      ) : '—'}
                    </TD>
                    <TDActions>{agentMenu(agent)}</TDActions>
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
            pageSizeOptions={PAGE_SIZES}
            noun="agents"
          />
        )}
      </div>

      {exportTarget && (
        <ExportAssetDialog
          ids={[exportTarget.id]}
          name={exportTarget.name}
          open
          onOpenChange={(open) => { if (!open) setExportTarget(null) }}
        />
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent size="sm" title="New agent">
          <DialogBody className="space-y-3">
            <Field label="Name">
              <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Research Assistant" autoFocus />
            </Field>
            <Field label="Description" optional>
              <Input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="What does this agent do?" />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!createName.trim()} loading={creating}>
              {creating ? 'Creating…' : 'Create agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null) }}>
        <DialogContent size="sm" title="Delete agent">
          <DialogBody className="space-y-3">
            <p className="text-sm text-fg">
              Delete <strong className="font-semibold">{agents.find(a => a.id === deleteId)?.name}</strong>?
            </p>
            <InlineNotice tone="danger" message="This will delete the agent and all its run history." />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting}>
              {deleting ? 'Deleting…' : 'Delete agent'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <DialogContent size="sm" title="Delete agents">
          <DialogBody className="space-y-3">
            <p className="text-sm text-fg">Delete {plural(selected.size, 'selected agent')}?</p>
            <InlineNotice tone="danger" message="This will delete the selected agents and their run history." />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowBulkDelete(false)}>Cancel</Button>
            <Button variant="danger" onClick={handleBulkDelete} loading={bulkDeleting}>
              {bulkDeleting ? `Deleting (${selected.size})…` : `Delete ${selected.size}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
