'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Bot, Plus, Search, Grid3x3, List, Trash2, AlertTriangle,
  ChevronUp, ChevronDown, Sparkles, Loader2 } from 'lucide-react'
import { createAgent, deleteAgent } from '@/app/actions/agents'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import { useAppStore } from '@/stores/app-store'
import { InlineNotice } from '@/components/ui/inline-notice'
import { buildQueuedDeleteNotice } from '@/lib/queued-delete-feedback'
import { usePermissions } from '@/lib/permissions-context'
import { ExportAssetButton, ImportConfigButton } from '@/components/shared/config-transfer'

interface AgentListProps { agents: any[] }

type SortField = 'updated_at' | 'name' | 'model' | 'tools'
type StatusFilter = 'all' | 'active' | 'inactive'

const DEFAULT_PAGE_SIZE = 25

export function AgentList({ agents }: AgentListProps) {
  const router = useRouter()
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
  const [creating, setCreating] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [localAgents, setLocalAgents] = useState<any[]>(agents)

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
    setCreating(true); setActionError(null)
    try { await createAgent({ name: createName.trim(), description: createDesc.trim() || undefined }) }
    catch (err: any) { setActionError(err.message ?? 'Failed to create agent') }
    setCreating(false)
  }

  async function handleDelete() {
    if (!deleteId) return
    setDeleting(true); setActionError(null)
    const previous = localAgents
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
      const previous = localAgents
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

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortBy !== field) return null
    return sortDir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />
  }

  return (
    <div className="space-y-3">
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg px-4 py-2 border" style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-text)' }}>{selected.size} selected</span>
          <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="!h-7 !text-xs">Clear</Button>
          <div className="flex-1" />
          <ExportAssetButton ids={[...selected]} name={`${selected.size} agent${selected.size === 1 ? '' : 's'}`} className="!h-7 !text-xs" />
          <Button size="sm" onClick={() => setShowBulkDelete(true)} className="!h-7 !text-xs !bg-red-600 hover:!bg-red-700 !text-white">
            <Trash2 size={12} className="mr-1" /> Delete {selected.size}
          </Button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex gap-2 items-center flex-wrap">
        <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs shrink-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <input
            type="checkbox"
            checked={pageRows.length > 0 && pageRows.every(agent => selected.has(agent.id))}
            ref={el => { if (el) el.indeterminate = pageRows.some(agent => selected.has(agent.id)) && !pageRows.every(agent => selected.has(agent.id)) }}
            onChange={toggleSelectAllVisible}
            className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
          />
          Select visible
        </label>
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, description, or model…" className="pl-9" />
        </div>
        {/* Status filter — All / Active / Inactive. Segmented control
            keeps it compact and matches the BulkAssignUsersDialog
            "with / without role" chips. */}
        <div className="flex rounded-lg overflow-hidden border shrink-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {(['all', 'active', 'inactive'] as StatusFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className="px-2.5 py-1 text-[10px] font-medium capitalize transition-colors"
              style={{
                backgroundColor: statusFilter === f ? 'var(--theme-primary)' : 'transparent',
                color: statusFilter === f ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}
            >
              {f}
            </button>
          ))}
        </div>
        {/* Sort chips — only visible in grid mode. In list mode the
            column headers are clickable so these would be redundant. */}
        {viewMode === 'grid' && (
          <div className="flex items-center gap-1 shrink-0">
            {(['updated_at', 'name'] as SortField[]).map(f => (
              <button key={f} onClick={() => toggleSort(f)}
                className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-1 rounded"
                style={{ backgroundColor: sortBy === f ? 'var(--theme-primary-light)' : 'var(--theme-surface)', color: sortBy === f ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
                {f === 'updated_at' ? 'Updated' : 'Name'} <SortIcon field={f} />
              </button>
            ))}
          </div>
        )}
        <div className="flex rounded-lg overflow-hidden border shrink-0" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <button onClick={() => setViewMode('grid')} className="p-1.5" style={{ backgroundColor: viewMode === 'grid' ? 'var(--theme-primary)' : 'transparent', color: viewMode === 'grid' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}><Grid3x3 size={14} /></button>
          <button onClick={() => setViewMode('list')} className="p-1.5" style={{ backgroundColor: viewMode === 'list' ? 'var(--theme-primary)' : 'transparent', color: viewMode === 'list' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}><List size={14} /></button>
        </div>
        {can('agents.create') && <ImportConfigButton onImported={() => void queryClient.invalidateQueries({ queryKey: ['agents'] })} />}
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus size={14} className="mr-1" /> New Agent
        </Button>
      </div>

      <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
        {sorted.length === agents.length
          ? `${agents.length} agent${agents.length !== 1 ? 's' : ''}`
          : `${sorted.length} of ${agents.length} agents match`}
      </p>

      {actionError && (
        <InlineNotice tone="warning" message={actionError} onDismiss={() => setActionError(null)} />
      )}

      {sorted.length === 0 ? (
        <div className="rounded-xl border p-12 text-center" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <Bot size={36} className="mx-auto mb-3" style={{ color: 'var(--theme-muted-text)', opacity: 0.3 }} />
          <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
            {search ? 'No agents match your search' : 'No agents yet'}
          </p>
          {!search && <p className="text-xs mt-1 mb-3" style={{ color: 'var(--theme-muted-text)' }}>Create your first AI agent to get started.</p>}
          {!search && <Button size="sm" onClick={() => setShowCreate(true)}><Plus size={14} className="mr-1" /> New Agent</Button>}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {pageRows.map(agent => (
            <div key={agent.id} className="rounded-xl border overflow-hidden transition-all hover:shadow-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              <Link href={`/agents/${agent.id}`} className="block p-4">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(agent.id)}
                      onChange={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(agent.id) }}
                      className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)] shrink-0"
                    />
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                      <Bot size={16} />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{agent.name}</h3>
                      <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{agent.model}</p>
                    </div>
                  </div>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{
                    backgroundColor: agent.is_active ? '#10B98115' : '#6B728015',
                    color: agent.is_active ? '#10B981' : '#6B7280',
                  }}>{agent.is_active ? 'Active' : 'Inactive'}</span>
                </div>
                {agent.description && <p className="text-[11px] line-clamp-2 mt-1" style={{ color: 'var(--theme-muted-text)' }}>{agent.description}</p>}
                <p className="text-[10px] mt-2" style={{ color: 'var(--theme-muted-text)' }}>
                  {(agent.tools as any[])?.length ?? 0} tools · {agent.integration?.name ?? 'No provider'}
                </p>
              </Link>
              <div className="flex items-center gap-1 px-3 py-2 border-t" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                <div className="flex-1" />
                <ExportAssetButton ids={[agent.id]} name={agent.name} iconOnly variant="ghost" className="!h-auto !p-1" style={{ color: 'var(--theme-muted-text)' }} />
                <button onClick={() => setDeleteId(agent.id)} className="text-[9px] font-medium px-2 py-0.5 rounded hover:opacity-80" style={{ color: 'var(--theme-danger, #DC2626)' }}>
                  <Trash2 size={9} className="inline mr-0.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden max-lg:overflow-x-auto" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <div className="max-lg:min-w-[700px] grid text-[10px] font-semibold uppercase tracking-wider select-none" style={{ gridTemplateColumns: '1.6fr 140px 80px 80px 120px 60px', backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('name')} style={{ color: sortBy === 'name' ? 'var(--theme-primary-text)' : undefined }}>Name <SortIcon field="name" /></button>
            <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('model')} style={{ color: sortBy === 'model' ? 'var(--theme-primary-text)' : undefined }}>Model <SortIcon field="model" /></button>
            <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('tools')} style={{ color: sortBy === 'tools' ? 'var(--theme-primary-text)' : undefined }}>Tools <SortIcon field="tools" /></button>
            <div className="px-2 py-2">Status</div>
            <button className="px-2 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('updated_at')} style={{ color: sortBy === 'updated_at' ? 'var(--theme-primary-text)' : undefined }}>Updated <SortIcon field="updated_at" /></button>
            <div className="px-2 py-2" />
          </div>
          {pageRows.map(agent => (
            <div key={agent.id} className="max-lg:min-w-[700px] grid items-center text-xs border-t hover:bg-[var(--theme-surface)]" style={{ gridTemplateColumns: '1.6fr 140px 80px 80px 120px 60px', borderColor: 'var(--theme-surface-border)' }}>
              <Link href={`/agents/${agent.id}`} className="flex items-center gap-2 px-3 py-2.5 min-w-0">
                <input
                  type="checkbox"
                  checked={selected.has(agent.id)}
                  onChange={(e) => { e.preventDefault(); e.stopPropagation(); toggleSelect(agent.id) }}
                  className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)] shrink-0"
                />
                <Bot size={14} className="shrink-0" style={{ color: 'var(--theme-primary-text)' }} />
                <div className="min-w-0">
                  <div className="font-medium truncate" style={{ color: 'var(--theme-card-text)' }}>{agent.name}</div>
                  {agent.description && (
                    <div className="text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{agent.description}</div>
                  )}
                </div>
              </Link>
              <div className="px-2 py-2.5 text-[10px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{agent.model ?? '—'}</div>
              <div className="px-2 py-2.5" style={{ color: 'var(--theme-muted-text)' }}>{(agent.tools as any[])?.length ?? 0}</div>
              <div className="px-2 py-2.5">
                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full" style={{
                  backgroundColor: agent.is_active ? '#10B98115' : '#6B728015',
                  color: agent.is_active ? '#10B981' : '#6B7280',
                }}>{agent.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="px-2 py-2.5 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{new Date(agent.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</div>
              <div className="px-2 py-2.5 flex justify-end gap-0.5">
                <ExportAssetButton ids={[agent.id]} name={agent.name} iconOnly variant="ghost" className="!h-auto !p-1" style={{ color: 'var(--theme-muted-text)' }} />
                <button onClick={() => setDeleteId(agent.id)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-danger, #DC2626)' }}><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination footer — only shown when the working set is
          non-empty. Mirrors the pattern used in UserRoleAssignments
          so tenants with hundreds of agents don't load every card
          at once. Always visible on non-empty lists so users can
          switch "rows per page" even on short lists. */}
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
                onChange={e => setPageSize(Number(e.target.value))}
                className="rounded border px-1.5 py-0.5 text-[11px]"
                style={{
                  borderColor: 'var(--theme-surface-border)',
                  backgroundColor: 'var(--theme-card-bg)',
                  color: 'var(--theme-card-text)',
                }}
              >
                {[12, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
          </div>
          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safePage === 1}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >‹ Prev</button>
              <span className="px-2">Page {safePage} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safePage === totalPages}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >Next ›</button>
            </div>
          )}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog.Root open={showCreate} onOpenChange={setShowCreate}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-xl p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <Dialog.Title className="text-lg font-semibold mb-3" style={{ color: 'var(--theme-card-text)' }}>
              <Sparkles size={18} className="inline mr-2" style={{ color: 'var(--theme-primary-text)' }} /> New Agent
            </Dialog.Title>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Name</label>
                <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="e.g. Research Assistant" autoFocus />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Description <span className="font-normal">(optional)</span></label>
                <Input value={createDesc} onChange={e => setCreateDesc(e.target.value)} placeholder="What does this agent do?" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Dialog.Close asChild><Button variant="outline" size="sm">Cancel</Button></Dialog.Close>
              <Button size="sm" onClick={handleCreate} disabled={!createName.trim() || creating}>
                {creating ? (<><Loader2 size={14} className="mr-1.5 animate-spin" /> Creating…</>) : 'Create Agent'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Delete Dialog */}
      <Dialog.Root open={deleteId !== null} onOpenChange={open => { if (!open) setDeleteId(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(24rem,92vw)] rounded-xl p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <Dialog.Title className="text-lg font-semibold mb-2">Delete Agent</Dialog.Title>
            <p className="text-sm mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Delete <strong>{agents.find(a => a.id === deleteId)?.name}</strong>?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--theme-danger)' }}>
              <AlertTriangle size={11} className="inline mr-1" /> This will delete the agent and all its run history.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>Cancel</Button>
              <Button size="sm" onClick={handleDelete} disabled={deleting} className="!bg-red-600 hover:!bg-red-700 !text-white">
                {deleting ? 'Deleting...' : 'Delete'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={showBulkDelete} onOpenChange={setShowBulkDelete}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(24rem,92vw)] rounded-xl p-6 shadow-xl" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <Dialog.Title className="text-lg font-semibold mb-2">Delete Agents</Dialog.Title>
            <p className="text-sm mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Delete {selected.size} selected agent{selected.size !== 1 ? 's' : ''}?
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--theme-danger)' }}>
              <AlertTriangle size={11} className="inline mr-1" /> This will delete the selected agents and their run history.
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
    </div>
  )
}
