"use client"

import { useEffect, useState, useMemo } from "react"
import { Search, Plug, Plus, Trash2, Loader2, Grid3x3, List, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { ConnectorCard } from "./connector-card"
import { ConnectorSetupDialog } from "./connector-setup-dialog"
import { ConnectorDetail } from "./connector-detail"
import { CONNECTOR_CATALOG, CONNECTOR_CATEGORIES, getConnectorDefinition } from "@/lib/connectors/registry"
import type { ConnectorCategory } from "@/lib/connectors/registry"
import { useRouter } from "next/navigation"
import { deleteConnector } from "@/app/actions/connectors"
import { InlineNotice } from "@/components/ui/inline-notice"

interface TenantConnector {
  id: string
  connector_key: string
  display_name: string | null
  config: Record<string, any>
  credentials: Record<string, any>
  integration_id: string | null
  is_enabled: boolean
  last_tested_at: string | null
  last_test_status: string | null
  last_test_message: string | null
}

interface LiveReference {
  id: string
  integration_id: string
  name: string
  description: string | null
}

interface CatalogProps {
  connectors: TenantConnector[]
  references?: LiveReference[]
}

export function ConnectorsCatalog({ connectors, references = [] }: CatalogProps) {
  const [localConnectors, setLocalConnectors] = useState(connectors)
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState<ConnectorCategory | 'all'>('all')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [sortBy, setSortBy] = useState<'name' | 'category' | 'instances' | 'status'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [setupKey, setSetupKey] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const router = useRouter()

  useEffect(() => {
    setLocalConnectors(connectors)
  }, [connectors])

  // Group connectors by key — supports multiple instances per connector type
  const instancesMap = useMemo(() => {
    const map = new Map<string, TenantConnector[]>()
    localConnectors.forEach(c => {
      const list = map.get(c.connector_key) ?? []
      list.push(c)
      map.set(c.connector_key, list)
    })
    return map
  }, [localConnectors])

  const filtered = useMemo(() => {
    let list = CONNECTOR_CATALOG
    if (category !== 'all') list = list.filter(c => c.category === category)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q)
      )
    }
    return list
  }, [search, category])

  const sorted = useMemo(() => {
    function connectorStatus(defKey: string) {
      const instances = instancesMap.get(defKey) ?? []
      const activeInstances = instances.filter(i => i.is_enabled)
      if (instances.length === 0) return 0
      if (instances.some(i => i.last_test_status === 'error')) return 1
      if (instances.every(i => i.last_test_status === 'success')) return 3
      if (activeInstances.length > 0) return 2
      return 0
    }

    const next = [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortBy === 'name') cmp = a.name.localeCompare(b.name)
      else if (sortBy === 'category') cmp = a.category.localeCompare(b.category)
      else if (sortBy === 'instances') cmp = (instancesMap.get(a.key)?.length ?? 0) - (instancesMap.get(b.key)?.length ?? 0)
      else cmp = connectorStatus(a.key) - connectorStatus(b.key)
      return sortDir === 'asc' ? cmp : -cmp
    })
    return next
  }, [filtered, instancesMap, sortBy, sortDir])

  function toggleSort(field: 'name' | 'category' | 'instances' | 'status') {
    if (sortBy === field) {
      setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')
      return
    }
    setSortBy(field)
    setSortDir(field === 'name' || field === 'category' ? 'asc' : 'desc')
  }

  function SortIcon({ field }: { field: 'name' | 'category' | 'instances' | 'status' }) {
    if (sortBy !== field) return <ArrowUpDown size={12} />
    return sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  }

  function handleCardClick(connectorKey: string) {
    const instances = instancesMap.get(connectorKey) ?? []
    if (instances.length === 0) {
      // No instances — open setup
      setSetupKey(connectorKey)
    } else if (instances.length === 1) {
      // One instance — open detail
      setDetailId(instances[0].id)
    } else {
      // Multiple instances — expand to show list
      setExpandedKey(expandedKey === connectorKey ? null : connectorKey)
    }
  }

  async function handleDeleteInstance(id: string) {
    setDeletingId(id)
    const previous = localConnectors
    try {
      setLocalConnectors((current) => current.filter((connector) => connector.id !== id))
      await deleteConnector(id)
      setConfirmDeleteId(null)
      setNotice({ tone: 'success', message: 'Connector instance deleted.' })
      router.refresh()
    } catch (e: any) {
      setLocalConnectors(previous)
      setNotice({ tone: 'error', message: `Failed to delete: ${e.message}` })
    }
    setDeletingId(null)
  }

  function handleRefresh() {
    setSetupKey(null)
    setDetailId(null)
    setExpandedKey(null)
    setConfirmDeleteId(null)
    router.refresh()
  }

  const enabledCount = localConnectors.filter(c => c.is_enabled).length
  const setupDefinition = setupKey ? getConnectorDefinition(setupKey) : null
  const detailConnector = detailId ? connectors.find(c => c.id === detailId) : null
  const detailDefinition = detailConnector ? getConnectorDefinition(detailConnector.connector_key) : null

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {/* Stats bar */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <Plug size={14} style={{ color: 'var(--theme-primary-text)' }} />
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>
            {enabledCount} active
          </span>
          <span className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            · {localConnectors.length} instance{localConnectors.length !== 1 ? 's' : ''} across {CONNECTOR_CATALOG.length} connectors
          </span>
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search connectors..."
            className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setCategory('all')}
            className="text-[10px] font-medium px-2.5 py-1.5 rounded-full transition-colors"
            style={{
              backgroundColor: category === 'all' ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
              color: category === 'all' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
            }}
          >
            All
          </button>
          {CONNECTOR_CATEGORIES.map(cat => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className="text-[10px] font-medium px-2.5 py-1.5 rounded-full transition-colors"
              style={{
                backgroundColor: category === cat.value ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                color: category === cat.value ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'name' | 'category' | 'instances' | 'status')}
              className="rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            >
              <option value="name">Sort by name</option>
              <option value="category">Sort by category</option>
              <option value="instances">Sort by instances</option>
              <option value="status">Sort by status</option>
            </select>
            <button
              onClick={() => setSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}
              className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}
            >
              {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
              {sortDir === 'asc' ? 'Ascending' : 'Descending'}
            </button>
          </div>
          <div className="inline-flex items-center rounded-lg border p-1" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
            <button onClick={() => setViewMode('cards')} className="rounded-md p-1.5" style={viewMode === 'cards' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }} title="Card view"><Grid3x3 size={14} /></button>
            <button onClick={() => setViewMode('list')} className="rounded-md p-1.5" style={viewMode === 'list' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }} title="List view"><List size={14} /></button>
          </div>
        </div>
      </div>

      {/* Grid */}
      {sorted.length === 0 ? (
        <div className="text-center py-12">
          <Plug size={32} className="mx-auto mb-3" style={{ color: 'var(--theme-muted-text)', opacity: 0.4 }} />
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
            {search ? 'No connectors match your search' : 'No connectors in this category'}
          </p>
        </div>
      ) : (
        viewMode === 'cards' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {sorted.map(def => {
            const instances = instancesMap.get(def.key) ?? []
            const activeInstances = instances.filter(i => i.is_enabled)
            const hasAny = instances.length > 0

            // Determine overall status — worst status wins
            const status = !hasAny ? null :
              instances.some(i => i.last_test_status === 'error') ? 'error' as const :
              instances.every(i => i.last_test_status === 'success') ? 'connected' as const :
              activeInstances.length > 0 ? 'untested' as const : null

            return (
              <div key={def.key}>
                <ConnectorCard
                  name={def.name}
                  connectorKey={def.key}
                  description={instances.length > 1
                    ? `${instances.length} instances · ${def.description}`
                    : def.description}
                  icon={def.icon}
                  color={def.color}
                  category={def.category}
                  isEnabled={activeInstances.length > 0}
                  status={status}
                  onClick={() => handleCardClick(def.key)}
                />

                {/* Expanded instance list for multi-instance connectors */}
                {expandedKey === def.key && instances.length > 0 && (
                  <div className="mt-1 ml-4 space-y-1 rounded-lg border p-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                    {instances.map(inst => (
                      <div
                        key={inst.id}
                        className="flex items-center gap-2 rounded-lg px-3 py-2 hover:opacity-80 transition-opacity"
                        style={{ backgroundColor: 'var(--theme-card-bg)' }}
                      >
                        <button
                          type="button"
                          onClick={() => setDetailId(inst.id)}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{
                              backgroundColor: inst.is_enabled
                                ? (inst.last_test_status === 'success' ? 'var(--theme-success)' :
                                  inst.last_test_status === 'error' ? 'var(--theme-danger)' : 'var(--theme-warning)')
                                : 'var(--theme-muted-text)',
                            }}
                          />
                          <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--theme-card-text)' }}>
                            {inst.display_name || def.name}
                          </span>
                          <span className="text-[9px] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                            {inst.is_enabled ? 'Active' : 'Disabled'}
                          </span>
                        </button>
                        {confirmDeleteId === inst.id ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleDeleteInstance(inst.id)}
                              disabled={deletingId === inst.id}
                              className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-red-500 text-white hover:bg-red-600 disabled:opacity-50"
                            >
                              {deletingId === inst.id ? <Loader2 size={10} className="animate-spin" /> : 'Yes'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="text-[9px] font-medium px-1.5 py-0.5 rounded hover:opacity-70"
                              style={{ color: 'var(--theme-muted-text)' }}
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(inst.id) }}
                            className="shrink-0 hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--theme-muted-text)' }}
                            title="Delete instance and its references"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => { setExpandedKey(null); setSetupKey(def.key) }}
                      className="w-full flex items-center justify-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-medium hover:opacity-70"
                      style={{ color: def.color }}
                    >
                      <Plus size={10} /> Add another {def.name} instance
                    </button>
                  </div>
                )}

                {/* "Add another" shortcut for single-instance connectors */}
                {hasAny && instances.length === 1 && expandedKey !== def.key && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSetupKey(def.key) }}
                    className="mt-0.5 ml-4 flex items-center gap-1 text-[9px] font-medium hover:opacity-70"
                    style={{ color: 'var(--theme-muted-text)' }}
                  >
                    <Plus size={8} /> Add another instance
                  </button>
                )}
              </div>
            )
          })}
        </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div
              className="grid items-center text-[11px] font-semibold uppercase tracking-wide"
              style={{
                gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,0.8fr) 110px 110px 56px',
                backgroundColor: 'var(--theme-row-highlight-strong)',
                color: 'var(--theme-muted-text)',
                borderBottom: '1px solid var(--theme-surface-border)',
              }}
            >
              <button className="px-4 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('name')} style={{ color: sortBy === 'name' ? 'var(--theme-primary-text)' : undefined }}>Name <SortIcon field="name" /></button>
              <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('category')} style={{ color: sortBy === 'category' ? 'var(--theme-primary-text)' : undefined }}>Category <SortIcon field="category" /></button>
              <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('status')} style={{ color: sortBy === 'status' ? 'var(--theme-primary-text)' : undefined }}>Status <SortIcon field="status" /></button>
              <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleSort('instances')} style={{ color: sortBy === 'instances' ? 'var(--theme-primary-text)' : undefined }}>Instances <SortIcon field="instances" /></button>
              <div className="px-3 py-2 text-right">Open</div>
            </div>
            {sorted.map((def, index) => {
              const instances = instancesMap.get(def.key) ?? []
              const activeInstances = instances.filter(i => i.is_enabled)
              const hasAny = instances.length > 0
              const statusLabel = !hasAny ? 'Not configured' :
                instances.some(i => i.last_test_status === 'error') ? 'Error' :
                instances.every(i => i.last_test_status === 'success') ? 'Connected' :
                activeInstances.length > 0 ? 'Untested' : 'Disabled'

              return (
                <button
                  key={def.key}
                  type="button"
                  onClick={() => handleCardClick(def.key)}
                  className="grid w-full items-center text-left hover:opacity-90"
                  style={{
                    gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,0.8fr) 110px 110px 56px',
                    backgroundColor: index % 2 === 0 ? 'var(--theme-card-bg)' : 'var(--theme-surface)',
                    borderBottom: index < sorted.length - 1 ? '1px solid var(--theme-surface-border)' : undefined,
                  }}
                >
                  <div className="px-4 py-3 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--theme-card-text)' }}>{def.name}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{def.description}</div>
                  </div>
                  <div className="px-3 py-3 text-xs capitalize" style={{ color: 'var(--theme-muted-text)' }}>{def.category}</div>
                  <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{statusLabel}</div>
                  <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{instances.length}</div>
                  <div className="px-3 py-3 text-right text-xs" style={{ color: 'var(--theme-primary-text)' }}>
                    {hasAny ? 'Open' : 'Setup'}
                  </div>
                </button>
              )
            })}
          </div>
        )
      )}

      {/* Setup dialog */}
      {setupDefinition && (
        <ConnectorSetupDialog
          definition={setupDefinition}
          onClose={() => setSetupKey(null)}
          onEnabled={handleRefresh}
        />
      )}

      {/* Detail dialog */}
      {detailDefinition && detailConnector && (
        <ConnectorDetail
          definition={detailDefinition}
          connector={detailConnector}
          liveReferences={references.filter(r => r.integration_id === detailConnector.integration_id)}
          onClose={() => setDetailId(null)}
          onUpdated={handleRefresh}
          onAddInstance={() => { setDetailId(null); setSetupKey(detailConnector.connector_key) }}
        />
      )}
    </div>
  )
}
