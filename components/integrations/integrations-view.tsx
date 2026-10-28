"use client"

import { useState, useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import {
  Network, Zap, Database, Globe, Check, Bookmark, Box,
  ChevronRight, Search, Tag, X, Plus, Play, Loader2,
  BarChart3, ExternalLink, ArrowRightLeft, Trash2,
  Map as MapIcon, Link2, Table, Grid3x3, List, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react"
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import * as Dialog from '@radix-ui/react-dialog'
import { useIntegrationDependencies, AssetDependencyDialog } from '@/components/shared/asset-dependencies'
import { InlineTagEditor, TagFilterBar, type TagDefinition } from "@/components/ui/tag-manager"
import { useRouter } from "next/navigation"
import { cn, formatRelativeDate } from "@/lib/utils"
import { ConnectorsCatalog } from "@/components/connectors/connectors-catalog"
import { ExportAssetButton } from "@/components/shared/config-transfer"
import { InlineNotice } from "@/components/ui/inline-notice"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { deleteIntegration } from "@/app/actions/integrations"
import { addMcpServer, deleteMcpServer } from "@/app/actions/mcp-servers"
import { createTagDefinition, setIntegrationTags, setReferenceTags, updateTagDefinitionColor } from "@/app/actions/tags"
import { bulkDeleteWithJob, runInlineJob, useJobs } from "@/components/jobs/jobs-provider"
import { createIntegrationObject, deleteIntegrationObject, generateIntegrationObjectReferences } from "@/app/actions/integration-objects"
import { resolveStorageUrl } from "@/lib/storage/refs"

const typeIcons: Record<string, any> = {
  rest_api: Globe,
  database: Database,
  graphql: Zap,
  webhook: Network,
  odata: ArrowRightLeft,
}
const typeLabels: Record<string, string> = {
  rest_api: "REST API",
  database: "Database",
  graphql: "GraphQL",
  webhook: "Webhook",
  odata: "OData",
}

interface IntegrationsViewProps {
  integrations: any[]
  references: any[]
  connectors?: any[]
  initialTagDefs?: TagDefinition[]
  mcpServers?: any[]
}

export function IntegrationsView({ integrations, references, connectors = [], initialTagDefs = [], mcpServers = [] }: IntegrationsViewProps) {
  const [search, setSearch] = useState("")
  const [activeTab, setActiveTab] = useState<"integrations" | "references" | "connectors" | "objects" | "mcp">("integrations")
  const [integrationViewMode, setIntegrationViewMode] = useState<'cards' | 'list'>('cards')
  const [integrationTypeFilter, setIntegrationTypeFilter] = useState<string>('all')
  const [integrationStatusFilter, setIntegrationStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [integrationSortBy, setIntegrationSortBy] = useState<'name' | 'type' | 'references' | 'updated_at'>('updated_at')
  const [integrationSortDir, setIntegrationSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [editingTags, setEditingTags] = useState<string | null>(null)
  const [newTag, setNewTag] = useState("")
  const [testingRefId, setTestingRefId] = useState<string | null>(null)
  const [testInputs, setTestInputs] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<any>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [usageRefId, setUsageRefId] = useState<string | null>(null)
  const [depsId, setDepsId] = useState<string | null>(null)
  const [depsName, setDepsName] = useState('')
  const { data: integrationDeps, isLoading: integrationDepsLoading } = useIntegrationDependencies(depsId ?? '')
  const [usageData, setUsageData] = useState<any>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [selectedRefs, setSelectedRefs] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [refIntegrationFilter, setRefIntegrationFilter] = useState<string | null>(null)
  const [tagDefs, setTagDefs] = useState<TagDefinition[]>(initialTagDefs)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [confirmState, setConfirmState] = useState<null | { title: string; description: string; destructive?: boolean; action: () => Promise<void> | void }>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const router = useRouter()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [integrationToDelete, setIntegrationToDelete] = useState<{ id: string; name: string } | null>(null)
  const [integrationDeleting, setIntegrationDeleting] = useState(false)

  async function createTagDef(name: string, color: string) {
    const result = await createTagDefinition('integrations', name, color)
    if (result.ok) setTagDefs(prev => [...prev, result.data])
    else setNotice({ tone: 'error', message: result.error })
  }

  async function updateTagDefColor(name: string, color: string) {
    const def = tagDefs.find(d => d.name === name)
    if (!def) return
    const result = await updateTagDefinitionColor('integrations', def.id, color)
    if (result.ok) setTagDefs(prev => prev.map(d => d.name === name ? { ...d, color } : d))
    else setNotice({ tone: 'error', message: result.error })
  }

  // Tags on an integration or a reference (integrations.edit / manage_references).
  function saveItemTags(table: "integrations" | "integration_references", id: string, tags: string[]) {
    return table === "integrations" ? setIntegrationTags(id, tags) : setReferenceTags(id, tags)
  }

  function openRefTest(ref: any) {
    const defaults: Record<string, string> = {}
    for (const inp of (ref.inputs as any[] ?? [])) defaults[inp.name] = inp.default_value ?? ''
    setTestInputs(defaults)
    setTestResult(null)
    setTestingRefId(ref.id)
  }

  async function runRefTest(ref: any) {
    setTestLoading(true)
    setTestResult(null)
    try {
      const resp = await fetch('/api/integrations/test-reference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reference_id: ref.id,
          inputs: testInputs,
          // A reference without a captured/spec response model gets one from this test.
          capture_schema: 'auto',
        }),
      })
      setTestResult(await resp.json())
    } catch (e: any) {
      setTestResult({ error: e.message })
    }
    setTestLoading(false)
  }

  async function openUsage(refId: string) {
    setUsageRefId(refId)
    setUsageData(null)
    setUsageLoading(true)
    try {
      const resp = await fetch(`/api/integrations/reference-usage?id=${refId}`)
      setUsageData(await resp.json())
    } catch {
      setUsageData({ error: 'Failed to load usage data' })
    }
    setUsageLoading(false)
  }

  // Collect all unique tags
  const allTags = useMemo(() => {
    const tags = new Set<string>()
    integrations.forEach((i) => (i.tags as string[] ?? []).forEach((t: string) => tags.add(t)))
    references.forEach((r) => (r.tags as string[] ?? []).forEach((t: string) => tags.add(t)))
    return [...tags].sort()
  }, [integrations, references])

  // Filter integrations (exclude databases — those are now in Connectors)
  const filteredIntegrations = useMemo(() => {
    return integrations.filter((i) => {
      if (i.type === 'database') return false
      const matchesSearch = !search ||
        i.name.toLowerCase().includes(search.toLowerCase()) ||
        (i.config as any)?.base_url?.toLowerCase().includes(search.toLowerCase())
      const matchesTag = !selectedTag || (i.tags as string[] ?? []).includes(selectedTag)
      const matchesType = integrationTypeFilter === 'all' || i.type === integrationTypeFilter
      const matchesStatus =
        integrationStatusFilter === 'all' ||
        (integrationStatusFilter === 'active' ? !!i.is_active : !i.is_active)
      return matchesSearch && matchesTag && matchesType && matchesStatus
    })
  }, [integrations, search, selectedTag, integrationTypeFilter, integrationStatusFilter])

  const sortedIntegrations = useMemo(() => {
    const refCounts = new Map<string, number>()
    references.forEach((ref) => {
      const integrationId = (ref.integration as any)?.id
      if (!integrationId) return
      refCounts.set(integrationId, (refCounts.get(integrationId) ?? 0) + 1)
    })

    const next = [...filteredIntegrations].sort((a, b) => {
      let cmp = 0
      if (integrationSortBy === 'name') cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
      else if (integrationSortBy === 'type') cmp = String(typeLabels[a.type] ?? a.type ?? '').localeCompare(String(typeLabels[b.type] ?? b.type ?? ''))
      else if (integrationSortBy === 'references') cmp = (refCounts.get(a.id) ?? 0) - (refCounts.get(b.id) ?? 0)
      else cmp = new Date(a.updated_at ?? a.created_at ?? 0).getTime() - new Date(b.updated_at ?? b.created_at ?? 0).getTime()
      return integrationSortDir === 'asc' ? cmp : -cmp
    })

    return next
  }, [filteredIntegrations, integrationSortBy, integrationSortDir, references])

  const integrationTypeOptions = useMemo(() => {
    const present = new Set<string>()
    integrations.forEach((integration) => {
      if (integration.type && integration.type !== 'database') present.add(integration.type)
    })
    return [...present].sort((a, b) => (typeLabels[a] ?? a).localeCompare(typeLabels[b] ?? b))
  }, [integrations])

  // Filter references
  const filteredReferences = useMemo(() => {
    return references.filter((r) => {
      const matchesSearch = !search ||
        r.name.toLowerCase().includes(search.toLowerCase()) ||
        (r.integration as any)?.name?.toLowerCase().includes(search.toLowerCase()) ||
        (r.request_config as any)?.path_template?.toLowerCase().includes(search.toLowerCase())
      const matchesTag = !selectedTag || (r.tags as string[] ?? []).includes(selectedTag)
      const matchesIntegration = !refIntegrationFilter || (r.integration as any)?.id === refIntegrationFilter
      return matchesSearch && matchesTag && matchesIntegration
    })
  }, [references, search, selectedTag, refIntegrationFilter])

  // Unique integrations for the filter
  const refIntegrations = useMemo(() => {
    const map = new Map<string, { id: string; name: string; type: string; count: number }>()
    for (const r of references) {
      const integ = r.integration as any
      if (integ?.id && !map.has(integ.id)) {
        map.set(integ.id, { id: integ.id, name: integ.name, type: integ.type, count: 0 })
      }
      if (integ?.id) map.get(integ.id)!.count++
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [references])

  async function addTagToItem(table: "integrations" | "integration_references", id: string, currentTags: string[], tag: string) {
    if (!tag.trim() || currentTags.includes(tag.trim())) return
    const updated = [...currentTags, tag.trim().toLowerCase()]
    const result = await saveItemTags(table, id, updated)
    if (!result.ok) setNotice({ tone: 'error', message: result.error })
    setNewTag("")
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
  }

  async function removeTagFromItem(table: "integrations" | "integration_references", id: string, currentTags: string[], tag: string) {
    const updated = currentTags.filter((t) => t !== tag)
    const result = await saveItemTags(table, id, updated)
    if (!result.ok) setNotice({ tone: 'error', message: result.error })
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
  }

  function ItemTagEditor({ id, tags, table }: { id: string; tags: string[]; table: "integrations" | "integration_references" }) {
    return (
      <div className="mt-1">
        <InlineTagEditor
          tags={tags ?? []}
          tagDefinitions={tagDefs}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          onAdd={(tag) => addTagToItem(table, id, tags ?? [], tag)}
          onRemove={(tag) => removeTagFromItem(table, id, tags ?? [], tag)}
          onCreateDefinition={createTagDef}
          onUpdateDefinitionColor={updateTagDefColor}
        />
      </div>
    )
  }

  function toggleIntegrationSort(field: 'name' | 'type' | 'references' | 'updated_at') {
    if (integrationSortBy === field) {
      setIntegrationSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')
      return
    }
    setIntegrationSortBy(field)
    setIntegrationSortDir(field === 'name' || field === 'type' ? 'asc' : 'desc')
  }

  function renderIntegrationSortIcon(field: 'name' | 'type' | 'references' | 'updated_at') {
    if (integrationSortBy !== field) return <ArrowUpDown size={12} />
    return integrationSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
  }

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {/* Search + Tabs + Tags */}
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--theme-muted-text)" }} />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search integrations and references..."
              className="pl-9"
            />
          </div>
          <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
            <button
              onClick={() => setActiveTab("integrations")}
              className="px-4 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === "integrations" ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: activeTab === "integrations" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
            >
              Integrations ({filteredIntegrations.length})
            </button>
            <button
              onClick={() => setActiveTab("references")}
              className="px-4 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === "references" ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: activeTab === "references" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
            >
              References ({filteredReferences.length})
            </button>
            <button
              onClick={() => setActiveTab("connectors")}
              className="px-4 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === "connectors" ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: activeTab === "connectors" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
            >
              Connectors
            </button>
            <button
              onClick={() => setActiveTab("objects")}
              className="px-4 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === "objects" ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: activeTab === "objects" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
            >
              Objects
            </button>
            <button
              onClick={() => setActiveTab("mcp")}
              className="px-4 py-2 text-xs font-medium transition-colors"
              style={{
                backgroundColor: activeTab === "mcp" ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: activeTab === "mcp" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}
            >
              MCP Servers{mcpServers.length > 0 ? ` (${mcpServers.length})` : ''}
            </button>
          </div>
        </div>

        {/* Tag filter pills */}
        <TagFilterBar tags={allTags} tagDefinitions={tagDefs} selectedTag={selectedTag} onSelectTag={setSelectedTag} />
      </div>

      {/* ─── Integrations Tab ─── */}
      {activeTab === "integrations" && (
        <>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={integrationTypeFilter}
                onChange={(e) => setIntegrationTypeFilter(e.target.value)}
                className="rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
              >
                <option value="all">All types</option>
                {integrationTypeOptions.map((type) => (
                  <option key={type} value={type}>{typeLabels[type] ?? type}</option>
                ))}
              </select>

              <select
                value={integrationStatusFilter}
                onChange={(e) => setIntegrationStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                className="rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>

              <select
                value={integrationSortBy}
                onChange={(e) => setIntegrationSortBy(e.target.value as 'name' | 'type' | 'references' | 'updated_at')}
                className="rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
              >
                <option value="updated_at">Sort by updated</option>
                <option value="name">Sort by name</option>
                <option value="type">Sort by type</option>
                <option value="references">Sort by references</option>
              </select>

              <button
                onClick={() => setIntegrationSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}
                className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium"
                style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}
              >
                {integrationSortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                {integrationSortDir === 'asc' ? 'Ascending' : 'Descending'}
              </button>
            </div>

            <div className="inline-flex items-center rounded-lg border p-1" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
              <button
                onClick={() => setIntegrationViewMode('cards')}
                className="rounded-md p-1.5"
                style={integrationViewMode === 'cards' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }}
                title="Card view"
              >
                <Grid3x3 size={14} />
              </button>
              <button
                onClick={() => setIntegrationViewMode('list')}
                className="rounded-md p-1.5"
                style={integrationViewMode === 'list' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }}
                title="List view"
              >
                <List size={14} />
              </button>
            </div>
          </div>

          {sortedIntegrations.length === 0 ? (
            <Card>
              <div className="text-center py-6">
                <Network size={32} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
                <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
                  {search || selectedTag ? "No integrations match your search." : "No integrations yet."}
                </p>
              </div>
            </Card>
          ) : integrationViewMode === 'cards' ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedIntegrations.map((integration) => {
                const Icon = typeIcons[integration.type] ?? Globe
                const config = integration.config as any
                const customIcon = resolveStorageUrl(config?.icon_url)
                const refCount = references.filter(
                  (r) => (r.integration as any)?.id === integration.id
                ).length
                const tags = (integration.tags as string[]) ?? []

                return (
                  <div key={integration.id} className="relative group">
                    <button
                      onClick={(e) => { e.preventDefault(); setIntegrationToDelete({ id: integration.id, name: integration.name }) }}
                      className="absolute right-2 top-2 z-10 hidden rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600 group-hover:block"
                      title="Delete integration and all its references"
                    >
                      <Trash2 size={13} />
                    </button>
                    {/* The title link is stretched over the card (::after
                        overlay) so the whole card navigates, while the tag
                        editor sits above the overlay as a sibling, not
                        inside the <a> — typing Enter in it must not follow
                        the link. */}
                    <Card className="relative hover:opacity-80 transition-opacity cursor-pointer h-full">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          {customIcon ? (
                            <img src={customIcon} alt="" className="w-5 h-5 object-contain shrink-0" />
                          ) : (
                            <Icon size={16} style={{ color: "var(--theme-primary-text)" }} />
                          )}
                          <h3 className="text-sm font-semibold">
                            <Link
                              href={`/integrations/${integration.id}`}
                              className="after:absolute after:inset-0 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-[var(--theme-primary)]"
                            >
                              {integration.name}
                            </Link>
                          </h3>
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                          integration.is_active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
                        }`}>
                          {integration.is_active ? <><Check size={8} /> Active</> : "Inactive"}
                        </span>
                      </div>
                      <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>
                        {typeLabels[integration.type] ?? integration.type}
                        {config?.base_url && <span className="font-mono"> · {config.base_url}</span>}
                      </p>
                      <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>
                        {refCount} references
                        {integration.last_test_status && (
                          <span className={integration.last_test_status === "success" ? " text-green-600" : " text-red-500"}>
                            {" · "}{integration.last_test_status === "success" ? "Connected" : "Error"}
                          </span>
                        )}
                      </p>
                      <div className="relative z-[1] cursor-default">
                        <ItemTagEditor id={integration.id} tags={tags} table="integrations" />
                      </div>
                    </Card>
                    <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDepsId(integration.id); setDepsName(integration.name) }}
                      className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity z-10"
                      style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }} title="Dependency map">
                      <MapIcon size={12} />
                    </button>
                    <div className="absolute top-2 right-9 z-10 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity">
                      <ExportAssetButton ids={[integration.id]} name={integration.name} iconOnly variant="ghost" className="!h-auto !p-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
              <div
                className="grid items-center text-[11px] font-semibold uppercase tracking-wide"
                style={{
                  gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,0.8fr) 110px 110px 130px 56px',
                  backgroundColor: 'var(--theme-row-highlight-strong)',
                  color: 'var(--theme-muted-text)',
                  borderBottom: '1px solid var(--theme-surface-border)',
                }}
              >
                <button className="px-4 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleIntegrationSort('name')} style={{ color: integrationSortBy === 'name' ? 'var(--theme-primary-text)' : undefined }}>
                  Name {renderIntegrationSortIcon('name')}
                </button>
                <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleIntegrationSort('type')} style={{ color: integrationSortBy === 'type' ? 'var(--theme-primary-text)' : undefined }}>
                  Type {renderIntegrationSortIcon('type')}
                </button>
                <div className="px-3 py-2">Status</div>
                <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleIntegrationSort('references')} style={{ color: integrationSortBy === 'references' ? 'var(--theme-primary-text)' : undefined }}>
                  Refs {renderIntegrationSortIcon('references')}
                </button>
                <button className="px-3 py-2 text-left flex items-center gap-1 hover:opacity-80" onClick={() => toggleIntegrationSort('updated_at')} style={{ color: integrationSortBy === 'updated_at' ? 'var(--theme-primary-text)' : undefined }}>
                  Updated {renderIntegrationSortIcon('updated_at')}
                </button>
                <div className="px-3 py-2 text-right">Open</div>
              </div>

              {sortedIntegrations.map((integration, index) => {
                const Icon = typeIcons[integration.type] ?? Globe
                const config = integration.config as any
                const customIcon = resolveStorageUrl(config?.icon_url)
                const refCount = references.filter(
                  (r) => (r.integration as any)?.id === integration.id
                ).length
                const tags = (integration.tags as string[]) ?? []

                return (
                  <div
                    key={integration.id}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,0.8fr) 110px 110px 130px 56px',
                      backgroundColor: index % 2 === 0 ? 'var(--theme-card-bg)' : 'var(--theme-surface)',
                      borderBottom: index < sortedIntegrations.length - 1 ? '1px solid var(--theme-surface-border)' : undefined,
                    }}
                  >
                    <div className="px-4 py-3 min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {customIcon ? (
                          <img src={customIcon} alt="" className="w-5 h-5 object-contain shrink-0" />
                        ) : (
                          <Icon size={16} className="shrink-0" style={{ color: 'var(--theme-primary-text)' }} />
                        )}
                        <div className="min-w-0">
                          <Link href={`/integrations/${integration.id}`} className="text-sm font-semibold hover:underline" style={{ color: 'var(--theme-card-text)' }}>
                            {integration.name}
                          </Link>
                          <div className="mt-0.5 text-[11px] truncate" style={{ color: 'var(--theme-muted-text)' }}>
                            {config?.base_url || 'No endpoint configured'}
                          </div>
                          {tags.length > 0 && (
                            <div className="mt-1">
                              <ItemTagEditor id={integration.id} tags={tags} table="integrations" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                      {typeLabels[integration.type] ?? integration.type}
                    </div>
                    <div className="px-3 py-3">
                      <span className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-medium',
                        integration.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                      )}>
                        {integration.is_active ? <><Check size={9} /> Active</> : 'Inactive'}
                      </span>
                    </div>
                    <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                      {refCount}
                    </div>
                    <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                      {formatRelativeDate(integration.updated_at ?? integration.created_at)}
                    </div>
                    <div className="px-3 py-3 flex items-center justify-end gap-1">
                      <button
                        onClick={() => { setDepsId(integration.id); setDepsName(integration.name) }}
                        className="rounded-lg p-1.5 hover:opacity-80"
                        style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                        title="Dependency map"
                      >
                        <MapIcon size={12} />
                      </button>
                      <ExportAssetButton ids={[integration.id]} name={integration.name} iconOnly variant="ghost" className="!h-auto !p-1.5 hover:opacity-80" style={{ color: 'var(--theme-muted-text)' }} />
                      <button
                        onClick={() => setIntegrationToDelete({ id: integration.id, name: integration.name })}
                        className="rounded-lg p-1.5 text-red-400 hover:bg-red-50 hover:text-red-600"
                        title="Delete integration and all its references"
                      >
                        <Trash2 size={13} />
                      </button>
                      <Link href={`/integrations/${integration.id}`} className="rounded-lg p-1.5 hover:opacity-80" style={{ color: 'var(--theme-muted-text)' }}>
                        <ChevronRight size={14} />
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={Boolean(integrationToDelete)}
        onOpenChange={(open) => { if (!open) setIntegrationToDelete(null) }}
        title="Delete Integration"
        description={`This permanently removes "${integrationToDelete?.name ?? ''}" and ALL of its API references. Workflows or forms still calling those references will fail until re-pointed.`}
        confirmLabel="Delete integration"
        destructive
        busy={integrationDeleting}
        onConfirm={async () => {
          if (!integrationToDelete) return
          setIntegrationDeleting(true)
          try {
            await deleteIntegration(integrationToDelete.id)
            setIntegrationToDelete(null)
            queryClient.invalidateQueries({ queryKey: ['integrations'] })
            router.refresh()
          } finally {
            setIntegrationDeleting(false)
          }
        }}
      />

      {/* ─── References Tab ─── */}
      {activeTab === "references" && (
        <>
          {filteredReferences.length === 0 ? (
            <Card>
              <div className="text-center py-6">
                <Bookmark size={32} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
                <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
                  {search || selectedTag ? "No references match your search." : "No references yet. Create them from an integration's setup wizard."}
                </p>
              </div>
            </Card>
          ) : (
            <div className="space-y-2">
              {/* Integration filter */}
              {refIntegrations.length > 1 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Source:</span>
                  <button onClick={() => setRefIntegrationFilter(null)}
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors"
                    style={{
                      backgroundColor: !refIntegrationFilter ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                      color: !refIntegrationFilter ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                    }}>
                    All ({references.length})
                  </button>
                  {refIntegrations.map(integ => {
                    const IntegIcon = typeIcons[integ.type] ?? Globe
                    return (
                      <button key={integ.id} onClick={() => setRefIntegrationFilter(refIntegrationFilter === integ.id ? null : integ.id)}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full transition-colors flex items-center gap-1"
                        style={{
                          backgroundColor: refIntegrationFilter === integ.id ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
                          color: refIntegrationFilter === integ.id ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
                        }}>
                        <IntegIcon size={9} />
                        {integ.name} ({integ.count})
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Bulk actions bar */}
              <div className="flex items-center gap-2">
                <input type="checkbox"
                  checked={filteredReferences.length > 0 && filteredReferences.every(r => selectedRefs.has(r.id))}
                  onChange={() => {
                    const allSelected = filteredReferences.every(r => selectedRefs.has(r.id))
                    setSelectedRefs(allSelected ? new Set() : new Set(filteredReferences.map(r => r.id)))
                  }}
                  className="rounded" />
                <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {selectedRefs.size > 0 ? `${selectedRefs.size} selected` : 'Select all'}
                </span>
                {selectedRefs.size > 0 && (
                  <>
                    <div className="flex-1" />
                    <div className="flex items-center gap-1">
                      <input value={bulkTagInput} onChange={e => setBulkTagInput(e.target.value)}
                        onKeyDown={async e => {
                          if (e.key === 'Enter' && bulkTagInput.trim()) {
                            const outcome = await runInlineJob(jobs, 'references.add_tag', { ids: [...selectedRefs], tag: bulkTagInput }, {
                              onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
                            })
                            if (outcome.status === 'failed') setNotice({ tone: 'error', message: outcome.error })
                            setBulkTagInput(''); setSelectedRefs(new Set())
                          }
                        }}
                        placeholder="Add tag..." className="rounded border px-2 py-0.5 text-[10px] w-24"
                        style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} />
                    </div>
                    <button onClick={() => {
                      setConfirmState({
                        title: 'Delete References',
                        description: `Delete ${selectedRefs.size} selected reference${selectedRefs.size !== 1 ? 's' : ''}?`,
                        destructive: true,
                        action: async () => {
                          // One `bulk.delete` job instead of one request per reference.
                          setBulkDeleting(true)
                          try {
                            const result = await bulkDeleteWithJob(jobs, 'reference', [...selectedRefs], () => queryClient.invalidateQueries({ queryKey: ['integrations'] }))
                            setSelectedRefs(new Set())
                            if (!result.background) setNotice({ tone: 'success', message: `${result.queued} reference${result.queued === 1 ? '' : 's'} deleted.` })
                          } catch (error) {
                            setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not delete the references' })
                          } finally {
                            setBulkDeleting(false)
                          }
                        },
                      })
                    }} disabled={bulkDeleting}
                      className="text-[10px] font-medium px-2 py-0.5 rounded hover:opacity-70 flex items-center gap-1"
                      style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}>
                      <Trash2 size={10} /> {bulkDeleting ? 'Deleting...' : `Delete (${selectedRefs.size})`}
                    </button>
                    <button onClick={() => setSelectedRefs(new Set())} className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>Clear</button>
                  </>
                )}
              </div>

              <div className="rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
                {filteredReferences.map((ref, i) => {
                  const integration = ref.integration as any
                  const Icon = typeIcons[integration?.type] ?? Globe
                  const refCustomIcon = resolveStorageUrl((integration?.config as any)?.icon_url || (ref.request_config as any)?.icon_url)
                  const inputs = (ref.inputs as any[]) ?? []
                  const outputs = (ref.outputs as any[]) ?? []
                  const reqConfig = (ref.request_config as any) ?? {}
                  const tags = (ref.tags as string[]) ?? []
                  const isSelected = selectedRefs.has(ref.id)

                  return (
                    <div
                      key={ref.id}
                      className="flex items-center gap-3 px-4 py-3 transition-colors cursor-pointer"
                      style={{
                        backgroundColor: isSelected ? "var(--theme-primary-light)" : "var(--theme-card-bg)",
                        borderBottom: i < filteredReferences.length - 1 ? "1px solid var(--theme-surface-border)" : undefined,
                      }}
                      onClick={() => openRefTest(ref)}
                    >
                      <input type="checkbox" checked={isSelected}
                        onChange={() => setSelectedRefs(prev => { const n = new Set(prev); n.has(ref.id) ? n.delete(ref.id) : n.add(ref.id); return n })}
                        onClick={e => e.stopPropagation()} className="rounded shrink-0" />
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                        style={{ backgroundColor: "var(--theme-primary-light)" }}
                      >
                        {refCustomIcon ? (
                          <img src={refCustomIcon} alt="" className="w-5 h-5 object-contain" />
                        ) : (
                          <Icon size={16} style={{ color: "var(--theme-primary-text)" }} />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{ref.name}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                            {integration?.name ?? "Unknown"}
                          </span>
                          {reqConfig.method && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-primary-text)" }}>
                              {reqConfig.method}
                            </span>
                          )}
                          {reqConfig.path_template && (
                            <span className="text-[10px] font-mono truncate" style={{ color: "var(--theme-muted-text)" }}>
                              {reqConfig.path_template.slice(0, 40)}{reqConfig.path_template.length > 40 ? "..." : ""}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Tags + badges */}
                      <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                        <ItemTagEditor id={ref.id} tags={tags} table="integration_references" />
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                          {inputs.length} in
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                          {outputs.length} out
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); openRefTest(ref) }}
                          className="p-1.5 rounded-lg hover:opacity-80 transition-colors shrink-0"
                          style={{ color: 'var(--theme-primary-text)', backgroundColor: 'var(--theme-primary-light)' }}
                          title="Test reference"
                        >
                          <Play size={12} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openUsage(ref.id) }}
                          className="p-1.5 rounded-lg hover:opacity-80 transition-colors shrink-0"
                          style={{ color: '#8B5CF6', backgroundColor: '#8B5CF615' }}
                          title="Usage & analytics"
                        >
                          <BarChart3 size={12} />
                        </button>
                        <Link href={`/integrations/${integration?.id}`} onClick={e => e.stopPropagation()}>
                          <ChevronRight size={14} style={{ color: "var(--theme-muted-text)" }} />
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Quick Test Dialog */}
          {testingRefId && (() => {
            const ref = references.find((r: any) => r.id === testingRefId)
            if (!ref) return null
            const inputs = (ref.inputs as any[]) ?? []
            const config = ref.request_config as any
            const integration = ref.integration as any
            const baseUrl = (integration?.config as any)?.base_url ?? ''
            const methodColors: Record<string, string> = { GET: '#22C55E', POST: '#3B82F6', PUT: '#F59E0B', DELETE: '#EF4444', PATCH: '#8B5CF6' }

            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                <div className="w-[90vw] max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                  <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                    <div className="flex items-center gap-2">
                      <Play size={14} style={{ color: 'var(--theme-primary-text)' }} />
                      <span className="text-sm font-semibold">Test: {ref.name}</span>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                        style={{ color: methodColors[config?.method] ?? '#6B7280', backgroundColor: `${methodColors[config?.method] ?? '#6B7280'}15` }}>
                        {config?.method ?? 'GET'}
                      </span>
                    </div>
                    <button onClick={() => setTestingRefId(null)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
                      <X size={16} />
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <div className="text-[10px] font-mono px-2.5 py-1.5 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                      {baseUrl}{config?.path_template ?? ''}
                    </div>
                    {inputs.length > 0 && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Inputs</h4>
                        {inputs.map((inp: any, idx: number) => (
                          <div key={inp.id ?? `${inp.name}-${idx}`}>
                            <label className="flex items-center gap-1 text-xs font-medium mb-1">
                              <code className="font-mono" style={{ color: 'var(--theme-primary-text)' }}>{inp.name}</code>
                              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>({inp.type})</span>
                              {inp.required && <span className="text-[10px] text-red-400">required</span>}
                            </label>
                            <Input
                              value={testInputs[inp.name] ?? ''}
                              onChange={e => setTestInputs(p => ({ ...p, [inp.name]: e.target.value }))}
                              placeholder={inp.default_value || inp.name}
                              className="!text-xs font-mono"
                            />
                          </div>
                        ))}
                      </div>
                    )}
                    <Button size="sm" onClick={() => runRefTest(ref)} disabled={testLoading} className="gap-1.5">
                      {testLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                      {testLoading ? 'Running...' : 'Execute'}
                    </Button>
                    {testResult && (
                      <div className="space-y-2">
                        <h4 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--theme-muted-text)' }}>
                          Response
                          {testResult.status && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                              style={{ backgroundColor: testResult.status < 300 ? '#22C55E15' : '#EF444415', color: testResult.status < 300 ? '#22C55E' : '#EF4444' }}>
                              {testResult.status}
                            </span>
                          )}
                        </h4>
                        {testResult.error ? (
                          <div className="text-xs p-3 rounded-lg" style={{ backgroundColor: '#EF444415', color: '#EF4444' }}>{testResult.error}</div>
                        ) : (
                          <pre className="text-[10px] font-mono p-3 rounded-lg overflow-auto max-h-[300px]"
                            style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}>
                            {JSON.stringify(testResult.data, null, 2)}
                          </pre>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Usage & Analytics Dialog */}
          {usageRefId && (() => {
            const ref = references.find((r: any) => r.id === usageRefId)
            if (!ref) return null

            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
                <div className="w-[90vw] max-w-xl max-h-[70vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
                  style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
                  <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                    <div className="flex items-center gap-2">
                      <BarChart3 size={14} style={{ color: '#8B5CF6' }} />
                      <span className="text-sm font-semibold">Usage: {ref.name}</span>
                    </div>
                    <button onClick={() => setUsageRefId(null)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
                      <X size={16} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {usageLoading ? (
                      <div className="flex flex-col items-center py-10">
                        <Loader2 size={24} className="animate-spin mb-2" style={{ color: 'var(--theme-primary-text)' }} />
                        <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>Loading usage data...</p>
                      </div>
                    ) : usageData?.error ? (
                      <p className="text-xs text-red-500">{usageData.error}</p>
                    ) : usageData ? (
                      <>
                        {/* Stats row */}
                        <div className="grid grid-cols-3 gap-3">
                          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--theme-surface)' }}>
                            <p className="text-2xl font-bold" style={{ color: 'var(--theme-primary-text)' }}>{usageData.workflow_count}</p>
                            <p className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Workflows</p>
                          </div>
                          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--theme-surface)' }}>
                            <p className="text-2xl font-bold" style={{ color: '#8B5CF6' }}>{usageData.total_executions}</p>
                            <p className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Executions</p>
                          </div>
                          <div className="rounded-lg p-3 text-center" style={{ backgroundColor: 'var(--theme-surface)' }}>
                            <p className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>
                              {usageData.last_executed_at ? formatRelativeDate(usageData.last_executed_at) : 'Never'}
                            </p>
                            <p className="text-[10px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Last Executed</p>
                          </div>
                        </div>

                        {/* Workflow list */}
                        <div>
                          <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
                            Used in Workflows
                          </h4>
                          {usageData.workflows.length === 0 ? (
                            <p className="text-xs py-4 text-center" style={{ color: 'var(--theme-muted-text)' }}>
                              Not used in any workflows yet
                            </p>
                          ) : (
                            <div className="space-y-1.5">
                              {usageData.workflows.map((w: any) => (
                                <div key={w.id} className="flex items-center gap-2 rounded-lg p-2.5"
                                  style={{ backgroundColor: 'var(--theme-surface)' }}>
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${w.is_active ? 'bg-green-500' : 'bg-gray-400'}`} />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-medium truncate">{w.name}</p>
                                    <div className="flex items-center gap-2 mt-0.5">
                                      <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                        {w.node_count} node{w.node_count !== 1 ? 's' : ''}
                                        {w.node_labels?.length > 0 && ` (${w.node_labels.join(', ')})`}
                                      </span>
                                      <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                        · {w.run_count} runs
                                      </span>
                                      {w.last_run_at && (
                                        <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                          · Last: {formatRelativeDate(w.last_run_at)}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <Link href={`/automations/${w.id}`} className="p-1 rounded hover:opacity-70 shrink-0" style={{ color: 'var(--theme-primary-text)' }}>
                                    <ExternalLink size={12} />
                                  </Link>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            )
          })()}
        </>
      )}

      {/* ─── Connectors Tab ─── */}
      {activeTab === "connectors" && (
        <ConnectorsCatalog connectors={connectors} references={references} />
      )}

      {activeTab === "objects" && (
        <ObjectsPanel references={references} />
      )}

      {activeTab === "mcp" && (
        <McpServersPanel servers={mcpServers} />
      )}

      <AssetDependencyDialog
        open={depsId !== null}
        onOpenChange={(open) => { if (!open) setDepsId(null) }}
        title={depsName}
        subtitle="Integration"
        deps={integrationDeps}
        loading={integrationDepsLoading}
      />
    </div>
  )
}

/* ─── MCP Servers Panel ─── */

function McpServersPanel({ servers }: { servers: any[] }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'tools' | 'created_at'>('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState('none')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  async function handleAdd() {
    if (!name.trim() || !url.trim()) return
    setSaving(true)
    try {
      // settings.edit; refuses private-network URLs; audited and synced.
      await addMcpServer({ name, url, authType: authType as 'none' | 'bearer' | 'api_key', token })
      setShowAdd(false)
      setName(''); setUrl(''); setToken('')
      queryClient.invalidateQueries({ queryKey: ['integrations'] })
    } catch (err: any) {
      setNotice({ tone: 'error', message: err?.message ?? 'Could not add the MCP server.' })
    }
    setSaving(false)
  }

  async function handleDelete(id: string) {
    try {
      await deleteMcpServer(id)
    } catch (err: any) {
      setNotice({ tone: 'error', message: err?.message ?? 'Could not delete the MCP server.' })
      return
    }
    queryClient.invalidateQueries({ queryKey: ['integrations'] })
    setNotice({ tone: 'success', message: 'MCP server deleted.' })
  }

  const filteredServers = useMemo(() => {
    return servers.filter((server: any) => {
      const matchesSearch = !search ||
        String(server.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        String(server.url ?? '').toLowerCase().includes(search.toLowerCase())
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'active' ? !!server.is_active : !server.is_active)
      return matchesSearch && matchesStatus
    })
  }, [servers, search, statusFilter])

  const sortedServers = useMemo(() => {
    const next = [...filteredServers].sort((a: any, b: any) => {
      let cmp = 0
      if (sortBy === 'name') cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
      else if (sortBy === 'tools') cmp = ((a.tools_cache?.length ?? 0) - (b.tools_cache?.length ?? 0))
      else cmp = new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime()
      return sortDir === 'asc' ? cmp : -cmp
    })
    return next
  }, [filteredServers, sortBy, sortDir])

  return (
    <div className="space-y-3">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
          Connect external MCP servers for use as AI agent tools
        </p>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus size={14} className="mr-1" /> Add Server
        </Button>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search MCP servers..." className="pl-9" />
          </div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
            <option value="created_at">Sort by created</option>
            <option value="name">Sort by name</option>
            <option value="tools">Sort by tools</option>
          </select>
          <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}>
            {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
        <div className="inline-flex items-center rounded-lg border p-1" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
          <button onClick={() => setViewMode('cards')} className="rounded-md p-1.5" style={viewMode === 'cards' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }} title="Card view"><Grid3x3 size={14} /></button>
          <button onClick={() => setViewMode('list')} className="rounded-md p-1.5" style={viewMode === 'list' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }} title="List view"><List size={14} /></button>
        </div>
      </div>

      {showAdd && (
        <Card className="p-4 space-y-3" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Server Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Slack MCP" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Server URL</label>
              <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..." />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Auth Type</label>
              <select value={authType} onChange={e => setAuthType(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <option value="none">None</option>
                <option value="bearer">Bearer Token</option>
                <option value="api_key">API Key Header</option>
              </select>
            </div>
            {authType !== 'none' && (
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--theme-muted-text)' }}>Token / Key</label>
                <Input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" />
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button size="sm" onClick={handleAdd} disabled={!name.trim() || !url.trim() || saving}>
              {saving ? 'Adding...' : 'Add Server'}
            </Button>
          </div>
        </Card>
      )}

      {sortedServers.length === 0 && !showAdd && (
        <Card className="p-8 text-center" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          <Network size={32} className="mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>No MCP servers configured</p>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>Add an external MCP server to give your AI agents access to additional tools</p>
        </Card>
      )}

      {viewMode === 'cards' ? (
        sortedServers.map((server: any) => (
          <Card key={server.id} className="p-4 flex items-center justify-between" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
            <div className="flex items-center gap-3">
              <div className={cn('w-2 h-2 rounded-full', server.is_active ? 'bg-green-500' : 'bg-gray-300')} />
              <div>
                <h3 className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{server.name}</h3>
                <p className="text-[11px] font-mono truncate max-w-[400px]" style={{ color: 'var(--theme-muted-text)' }}>{server.url}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {server.tools_cache?.length > 0 && (
                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                  {server.tools_cache.length} tools
                </span>
              )}
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                {server.auth_type !== 'none' ? server.auth_type : 'No auth'}
              </span>
              <ExportAssetButton ids={[server.id]} name={server.name} iconOnly variant="ghost" className="!h-auto !p-1.5" style={{ color: 'var(--theme-muted-text)' }} />
              <button onClick={() => setDeleteTarget(server.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600">
                <Trash2 size={13} />
              </button>
            </div>
          </Card>
        ))
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <div className="grid items-center text-[11px] font-semibold uppercase tracking-wide" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) 110px 110px 84px', backgroundColor: 'var(--theme-row-highlight-strong)', color: 'var(--theme-muted-text)', borderBottom: '1px solid var(--theme-surface-border)' }}>
            <div className="px-4 py-2">Name</div>
            <div className="px-3 py-2">URL</div>
            <div className="px-3 py-2">Auth</div>
            <div className="px-3 py-2">Tools</div>
            <div className="px-3 py-2 text-right">Actions</div>
          </div>
          {sortedServers.map((server: any, index: number) => (
            <div key={server.id} className="grid items-center" style={{ gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr) 110px 110px 84px', backgroundColor: index % 2 === 0 ? 'var(--theme-card-bg)' : 'var(--theme-surface)', borderBottom: index < sortedServers.length - 1 ? '1px solid var(--theme-surface-border)' : undefined }}>
              <div className="px-4 py-3 min-w-0">
                <div className="flex items-center gap-2">
                  <div className={cn('w-2 h-2 rounded-full shrink-0', server.is_active ? 'bg-green-500' : 'bg-gray-300')} />
                  <div className="text-sm font-medium truncate" style={{ color: 'var(--theme-card-text)' }}>{server.name}</div>
                </div>
              </div>
              <div className="px-3 py-3 text-[11px] font-mono truncate" style={{ color: 'var(--theme-muted-text)' }}>{server.url}</div>
              <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{server.auth_type !== 'none' ? server.auth_type : 'No auth'}</div>
              <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{server.tools_cache?.length ?? 0}</div>
              <div className="px-3 py-3 flex items-center justify-end gap-0.5">
                <ExportAssetButton ids={[server.id]} name={server.name} iconOnly variant="ghost" className="!h-auto !p-1.5" style={{ color: 'var(--theme-muted-text)' }} />
                <button onClick={() => setDeleteTarget(server.id)} className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600">
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete MCP Server"
        description="Delete this MCP server?"
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return
          try {
            await handleDelete(deleteTarget)
            setDeleteTarget(null)
          } catch (e: any) {
            setNotice({ tone: 'error', message: e?.message ?? 'Failed to delete MCP server' })
          }
        }}
      />
    </div>
  )
}

/* ─── Objects Panel ─── */
/* Objects combine multiple data tables and/or references into composite queryable entities with join config */

interface ObjectSource {
  id: string
  sourceType: 'table' | 'reference'
  tableId?: string
  referenceId?: string
  alias: string
  isPrimary: boolean
  joinType?: 'inner' | 'left' | 'right' | 'full'
  joinOnLocal?: string
  joinOnForeign?: string
  joinToAlias?: string
}

function ObjectsPanel({ references }: { references: any[] }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'tables' | 'mixed'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'sources' | 'updated_at'>('updated_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sources, setSources] = useState<ObjectSource[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const { data: objects = [], isLoading } = useQuery({
    queryKey: ['integration-objects'],
    queryFn: async () => (await serverRead('integrations.objects')).data ?? [],
  })

  const { data: tables = [] } = useQuery({
    queryKey: ['custom-tables-for-objects'],
    queryFn: async () => (await serverRead('integrations.objectTables')).data ?? [],
    enabled: showCreate,
  })

  function addSource(type: 'table' | 'reference') {
    setSources(prev => {
      const isPrimary = prev.length === 0
      const count = prev.filter(s => s.sourceType === type).length + 1
      return [...prev, {
        id: crypto.randomUUID(),
        sourceType: type,
        alias: type === 'table' ? `t${count}` : `r${count}`,
        isPrimary,
        joinType: isPrimary ? undefined : 'left',
      }]
    })
  }

  function removeSource(id: string) {
    setSources(prev => {
      const next = prev.filter(s => s.id !== id)
      if (next.length > 0 && !next.some(s => s.isPrimary)) next[0].isPrimary = true
      return next
    })
  }

  function updateSource(id: string, patch: Partial<ObjectSource>) {
    setSources(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s))
  }

  const sourcesValid = sources.length > 0 && sources.every(s =>
    (s.sourceType === 'table' && s.tableId) || (s.sourceType === 'reference' && s.referenceId)
  )

  async function handleCreate() {
    if (!name.trim() || !sourcesValid) return
    setSaving(true)
    try {
      // Creates the object, its sources and its generated reference (and
      // queues them for GitHub sync) in lib/services/objects.
      const result = await createIntegrationObject({ name: name.trim(), description: description.trim() || null, sources })
      if (!result.ok) throw new Error(result.error)

      queryClient.invalidateQueries({ queryKey: ['integration-objects'] })
      setShowCreate(false)
      setName(''); setDescription(''); setSources([])
    } catch (err: any) { setNotice({ tone: 'error', message: err.message }) }
    setSaving(false)
  }

  async function handleGenerateRefs(obj: any) {
    // The references are built from the object's stored sources (lib/services/objects).
    const result = await generateIntegrationObjectReferences(obj.id)
    if (!result.ok) {
      setNotice({ tone: 'error', message: `Failed: ${result.error}` })
      return
    }
    if (result.data.created === 0) {
      setNotice({ tone: 'warning', message: 'No references could be generated. Add at least one source with a valid table or reference.' })
      return
    }
    queryClient.invalidateQueries({ queryKey: ['integration-objects'] })
    queryClient.invalidateQueries({ queryKey: ['integration-references'] })
    setNotice({ tone: 'success', message: `Created ${result.data.created} reference${result.data.created !== 1 ? 's' : ''} for ${obj.name}` })
  }

  async function handleDelete(objectId: string) {
    // Deletes the object, its sources and its generated references (and
    // queues the deletions for GitHub sync) in lib/services/objects.
    const result = await deleteIntegrationObject(objectId)
    if (!result.ok) {
      setNotice({ tone: 'error', message: result.error })
      return
    }
    queryClient.invalidateQueries({ queryKey: ['integration-objects'] })
    queryClient.invalidateQueries({ queryKey: ['integration-references'] })
    setNotice({ tone: 'success', message: 'Object deleted.' })
  }

  const filteredObjects = useMemo(() => {
    return objects.filter((obj: any) => {
      const srcs = (obj.sources ?? []) as any[]
      const matchesSearch =
        !search ||
        String(obj.name ?? '').toLowerCase().includes(search.toLowerCase()) ||
        String(obj.description ?? '').toLowerCase().includes(search.toLowerCase()) ||
        srcs.some((s: any) => String(s.table?.name ?? s.reference?.name ?? s.alias ?? '').toLowerCase().includes(search.toLowerCase()))
      const sourceKind = srcs.every((s: any) => s.source_type === 'table') ? 'tables' : 'mixed'
      const matchesFilter = sourceFilter === 'all' || sourceFilter === sourceKind
      return matchesSearch && matchesFilter
    })
  }, [objects, search, sourceFilter])

  const sortedObjects = useMemo(() => {
    return [...filteredObjects].sort((a: any, b: any) => {
      let cmp = 0
      if (sortBy === 'name') cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
      else if (sortBy === 'sources') cmp = ((a.sources?.length ?? 0) - (b.sources?.length ?? 0))
      else cmp = new Date(a.updated_at ?? a.created_at ?? 0).getTime() - new Date(b.updated_at ?? b.created_at ?? 0).getTime()
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [filteredObjects, sortBy, sortDir])

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
          Objects join multiple data tables and API references into composite, queryable entities.
          Each object auto-generates a reference usable in workflows and forms.
        </p>
        <Button size="sm" onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus size={14} className="mr-1" /> New Object
        </Button>
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search objects..." className="pl-9" />
          </div>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as any)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
            <option value="all">All source types</option>
            <option value="tables">Tables only</option>
            <option value="mixed">Mixed sources</option>
          </select>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
            <option value="updated_at">Sort by updated</option>
            <option value="name">Sort by name</option>
            <option value="sources">Sort by sources</option>
          </select>
          <button onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-xs font-medium" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}>
            {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
            {sortDir === 'asc' ? 'Ascending' : 'Descending'}
          </button>
        </div>
        <div className="inline-flex items-center rounded-lg border p-1" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
          <button onClick={() => setViewMode('cards')} className="rounded-md p-1.5" style={viewMode === 'cards' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }} title="Card view"><Grid3x3 size={14} /></button>
          <button onClick={() => setViewMode('list')} className="rounded-md p-1.5" style={viewMode === 'list' ? { backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' } : { color: 'var(--theme-muted-text)' }} title="List view"><List size={14} /></button>
        </div>
      </div>

      {isLoading ? (
        <Card><p className="text-sm py-4 text-center" style={{ color: "var(--theme-muted-text)" }}>Loading...</p></Card>
      ) : sortedObjects.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <Box size={32} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
            <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>No objects yet.</p>
            <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>Create an object to join multiple data tables and references together.</p>
          </div>
        </Card>
      ) : (
        viewMode === 'cards' ? (
        <div className="space-y-3">
          {sortedObjects.map((obj: any) => {
            const srcs = (obj.sources ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)
            return (
              <Card key={obj.id}>
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <Box size={15} style={{ color: "var(--theme-primary-text)" }} />
                      <h4 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>{obj.name}</h4>
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                        {srcs.length} source{srcs.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    {obj.description && <p className="text-xs mb-2" style={{ color: "var(--theme-muted-text)" }}>{obj.description}</p>}
                    <div className="flex flex-wrap items-center gap-1.5">
                      {srcs.map((s: any, i: number) => (
                        <span key={s.id} className="flex items-center gap-1">
                          {i > 0 && (
                            <span className="text-[9px] font-mono px-1 py-0.5 rounded" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}>
                              {s.join_type?.toUpperCase() ?? 'LEFT'} JOIN
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full" style={{
                            backgroundColor: s.source_type === 'table' ? "var(--theme-primary-light)" : "var(--theme-surface)",
                            color: s.source_type === 'table' ? "var(--theme-primary-text)" : "var(--theme-muted-text)",
                          }}>
                            {s.source_type === 'table' ? <Table size={9} /> : <Link2 size={9} />}
                            {s.table?.name ?? s.reference?.name ?? s.alias}
                            {s.is_primary && <span className="text-[8px] font-bold ml-0.5">PRIMARY</span>}
                          </span>
                          {i > 0 && s.join_on_local && (
                            <span className="text-[8px] font-mono" style={{ color: "var(--theme-muted-text)" }}>
                              ON {s.alias}.{s.join_on_local} = {s.join_to_alias}.{s.join_on_foreign}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleGenerateRefs(obj)} className="!h-6 !text-[9px]">
                      <Plus size={10} className="mr-1" /> Generate References
                    </Button>
                    <button onClick={() => setDeleteTarget(obj.id)} className="p-1 rounded hover:opacity-70 self-end" style={{ color: "var(--theme-danger, #DC2626)" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="grid items-center text-[11px] font-semibold uppercase tracking-wide" style={{ gridTemplateColumns: 'minmax(0,1.2fr) 120px 120px 130px 120px', backgroundColor: 'var(--theme-row-highlight-strong)', color: 'var(--theme-muted-text)', borderBottom: '1px solid var(--theme-surface-border)' }}>
              <div className="px-4 py-2">Name</div>
              <div className="px-3 py-2">Sources</div>
              <div className="px-3 py-2">Type</div>
              <div className="px-3 py-2">Updated</div>
              <div className="px-3 py-2 text-right">Actions</div>
            </div>
            {sortedObjects.map((obj: any, index: number) => {
              const srcs = (obj.sources ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)
              const sourceKind = srcs.every((s: any) => s.source_type === 'table') ? 'Tables only' : 'Mixed'
              return (
                <div key={obj.id} className="grid items-center" style={{ gridTemplateColumns: 'minmax(0,1.2fr) 120px 120px 130px 120px', backgroundColor: index % 2 === 0 ? 'var(--theme-card-bg)' : 'var(--theme-surface)', borderBottom: index < sortedObjects.length - 1 ? '1px solid var(--theme-surface-border)' : undefined }}>
                  <div className="px-4 py-3 min-w-0">
                    <div className="text-sm font-semibold truncate" style={{ color: 'var(--theme-card-text)' }}>{obj.name}</div>
                    <div className="text-[11px] truncate" style={{ color: 'var(--theme-muted-text)' }}>{obj.description || 'No description'}</div>
                  </div>
                  <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{srcs.length}</div>
                  <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{sourceKind}</div>
                  <div className="px-3 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{formatRelativeDate(obj.updated_at ?? obj.created_at)}</div>
                  <div className="px-3 py-3 flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => handleGenerateRefs(obj)} className="!h-7 !text-[10px]">
                      <Plus size={10} className="mr-1" /> Generate
                    </Button>
                    <button onClick={() => setDeleteTarget(obj.id)} className="p-1 rounded hover:opacity-70" style={{ color: "var(--theme-danger, #DC2626)" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {/* Create Object Dialog */}
      <Dialog.Root open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setName(''); setDescription(''); setSources([]) } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(42rem,92vw)] rounded-xl p-6 shadow-xl dialog-content max-h-[85vh] overflow-y-auto" style={{ backgroundColor: "var(--theme-card-bg)" }}>
            <Dialog.Title className="text-lg font-semibold mb-1" style={{ color: "var(--theme-card-text)" }}>
              <Box size={18} className="inline mr-2" style={{ color: "var(--theme-primary-text)" }} />
              New Object
            </Dialog.Title>
            <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>
              Join multiple data tables and API references together. The first source is the primary; additional sources are joined to it.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "var(--theme-card-text)" }}>Name</label>
                  <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Customer Orders" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block" style={{ color: "var(--theme-card-text)" }}>Description</label>
                  <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this object represents..." />
                </div>
              </div>

              {/* Sources */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold" style={{ color: "var(--theme-card-text)" }}>Data Sources</label>
                  <div className="flex gap-1">
                    <Button size="sm" variant="outline" onClick={() => addSource('table')} className="!h-6 !text-[10px]">
                      <Table size={10} className="mr-1" /> Add Table
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => addSource('reference')} className="!h-6 !text-[10px]">
                      <Link2 size={10} className="mr-1" /> Add Reference
                    </Button>
                  </div>
                </div>

                {sources.length === 0 ? (
                  <div className="rounded-lg border p-4 text-center" style={{ borderColor: "var(--theme-surface-border)", borderStyle: 'dashed' }}>
                    <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>Add at least one data source (table or reference) to start.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sources.map((src, idx) => (
                      <div key={src.id} className="rounded-lg border p-3 space-y-2" style={{ borderColor: src.isPrimary ? "var(--theme-primary)" : "var(--theme-surface-border)", backgroundColor: "var(--theme-surface)" }}>
                        <div className="flex items-center gap-2">
                          {src.isPrimary && <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--theme-primary)", color: 'var(--theme-on-primary)' }}>PRIMARY</span>}
                          {!src.isPrimary && <span className="text-[8px] font-medium px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--theme-surface-border)", color: "var(--theme-muted-text)" }}>JOIN</span>}
                          <span className="text-[10px] font-medium" style={{ color: "var(--theme-card-text)" }}>
                            {src.sourceType === 'table' ? 'Data Table' : 'API Reference'}
                          </span>
                          <div className="flex-1" />
                          <Input value={src.alias} onChange={e => updateSource(src.id, { alias: e.target.value })} className="!h-6 !text-[10px] !w-20" placeholder="alias" />
                          <button onClick={() => removeSource(src.id)} className="p-0.5 rounded hover:opacity-70" style={{ color: "var(--theme-danger, #DC2626)" }}>
                            <X size={12} />
                          </button>
                        </div>

                        {/* Source selector */}
                        <select
                          value={src.sourceType === 'table' ? src.tableId ?? '' : src.referenceId ?? ''}
                          onChange={e => updateSource(src.id, src.sourceType === 'table' ? { tableId: e.target.value } : { referenceId: e.target.value })}
                          className="w-full rounded-lg border px-2 py-1.5 text-xs"
                          style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}
                        >
                          <option value="">Select {src.sourceType}...</option>
                          {src.sourceType === 'table'
                            ? tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                            : references.map(r => <option key={r.id} value={r.id}>{r.name}{r.integration ? ` (${r.integration.name})` : ''}</option>)
                          }
                        </select>

                        {/* Join config (not for primary) */}
                        {!src.isPrimary && (() => {
                          // Get columns for this source
                          const localCols = src.sourceType === 'table' && src.tableId
                            ? (tables.find(t => t.id === src.tableId)?.columns as any[] ?? []).map((c: any) => c.key ?? c.name)
                            : (references.find(r => r.id === src.referenceId)?.outputs ?? []).map((o: any) => o.name ?? o.path)
                          // Get columns for the target source
                          const targetSrc = sources.find(s => s.alias === src.joinToAlias)
                          const foreignCols = targetSrc
                            ? targetSrc.sourceType === 'table' && targetSrc.tableId
                              ? (tables.find(t => t.id === targetSrc.tableId)?.columns as any[] ?? []).map((c: any) => c.key ?? c.name)
                              : (references.find(r => r.id === targetSrc.referenceId)?.outputs ?? []).map((o: any) => o.name ?? o.path)
                            : []
                          return (
                            <div className="grid grid-cols-4 gap-2">
                              <select value={src.joinType ?? 'left'} onChange={e => updateSource(src.id, { joinType: e.target.value as any })}
                                className="rounded border px-2 py-1 text-[10px]"
                                style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
                                <option value="left">LEFT JOIN</option>
                                <option value="inner">INNER JOIN</option>
                                <option value="right">RIGHT JOIN</option>
                                <option value="full">FULL JOIN</option>
                              </select>
                              <select value={src.joinOnLocal ?? ''} onChange={e => updateSource(src.id, { joinOnLocal: e.target.value })}
                                className="rounded border px-2 py-1 text-[10px]"
                                style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
                                <option value="">This column...</option>
                                {localCols.map((c: string) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <select value={src.joinOnForeign ?? ''} onChange={e => updateSource(src.id, { joinOnForeign: e.target.value })}
                                className="rounded border px-2 py-1 text-[10px]"
                                style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
                                <option value="">= Target column...</option>
                                {foreignCols.map((c: string) => <option key={c} value={c}>{c}</option>)}
                              </select>
                              <select value={src.joinToAlias ?? ''} onChange={e => updateSource(src.id, { joinToAlias: e.target.value })}
                                className="rounded border px-2 py-1 text-[10px]"
                                style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
                                <option value="">Join to...</option>
                                {sources.filter(s => s.alias !== src.alias).map(s => <option key={s.alias} value={s.alias}>{s.alias} ({s.sourceType === 'table' ? tables.find(t => t.id === s.tableId)?.name : references.find(r => r.id === s.referenceId)?.name})</option>)}
                              </select>
                            </div>
                          )
                        })()}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Dialog.Close asChild><Button variant="outline" size="sm">Cancel</Button></Dialog.Close>
              <Button size="sm" onClick={handleCreate} disabled={!name.trim() || !sourcesValid || saving}>
                {saving ? 'Creating...' : 'Create Object'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete Object"
        description="Delete this object, its sources, and any auto-generated references?"
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!deleteTarget) return
          try {
            await handleDelete(deleteTarget)
            setDeleteTarget(null)
          } catch (e: any) {
            setNotice({ tone: 'error', message: e?.message ?? 'Failed to delete object' })
          }
        }}
      />
    </div>
  )
}
