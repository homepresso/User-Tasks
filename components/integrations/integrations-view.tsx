"use client"

import { useEffect, useState, useMemo, type ReactNode } from "react"
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button, buttonVariants } from "@/components/ui/button"
import Link from "next/link"
import {
  Network, Zap, Database, Globe, Bookmark, Box,
  ChevronRight, Tag as TagIcon, X, Plus, Play, Loader2,
  BarChart3, ExternalLink, ArrowRightLeft, Trash2, Download, MoreHorizontal, LayoutGrid,
  Map as MapIcon, Link2, Table, List, ArrowUpDown, ArrowUp, ArrowDown,
} from "lucide-react"
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { useIntegrationDependencies, AssetDependencyDialog } from '@/components/shared/asset-dependencies'
import { InlineTagEditor, TagFilterBar, type TagDefinition } from "@/components/ui/tag-manager"
import { useRouter, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { ConnectorsCatalog } from "@/components/connectors/connectors-catalog"
import { ExportAssetButton, ExportAssetDialog } from "@/components/shared/config-transfer"
import { PageHeader } from "@/components/ui/page-header"
import { Tabs } from "@/components/ui/tabs"
import { SearchInput } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { IconButton } from "@/components/ui/icon-button"
import { Badge, StatusPill, Tag } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { Dialog as UIDialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { JsonViewer } from "@/components/integrations/json-viewer"
import { formatCount } from "@/lib/format/number"
import { EmptyState } from "@/components/ui/empty-state"
import { Tooltip } from "@/components/ui/tooltip"
import { Table as DataTable, TableSkeleton, TBody, TD, TDActions, TH, THead, TR } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { plural } from "@/lib/format/plural"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { InlineNotice } from "@/components/ui/inline-notice"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { deleteIntegration } from "@/app/actions/integrations"
import { addMcpServer, deleteMcpServer } from "@/app/actions/mcp-servers"
import { createTagDefinition, setIntegrationTags, setReferenceTags, updateTagDefinitionColor } from "@/app/actions/tags"
import { bulkDeleteWithJob, runInlineJob, useJobs } from "@/components/jobs/jobs-provider"
import { createIntegrationObject, deleteIntegrationObject, generateIntegrationObjectReferences } from "@/app/actions/integration-objects"
import { resolveStorageUrl } from "@/lib/storage/refs"
import { isWriteReference } from "@/lib/custom-references/types"

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

/** "api.example.com:8443" from a base URL (the raw value when it isn't a URL). */
function hostOf(url: unknown): string {
  if (typeof url !== "string" || !url) return ""
  try { return new URL(url).host } catch { return url }
}

interface IntegrationsViewProps {
  /** PageHeader description and actions (the page owns the create / import buttons). */
  description?: ReactNode
  actions?: ReactNode
  integrations: any[]
  references: any[]
  connectors?: any[]
  initialTagDefs?: TagDefinition[]
  mcpServers?: any[]
}

export function IntegrationsView({ description, actions, integrations, references, connectors = [], initialTagDefs = [], mcpServers = [] }: IntegrationsViewProps) {
  // ?tab= and ?q= (header search box) pick the tab and filter it.
  const searchParams = useSearchParams()
  const linkedTab = (tab: string | null) => (["integrations", "references", "connectors", "objects", "mcp"] as const).find((t) => t === tab) ?? null
  const [search, setSearch] = useState(() => searchParams.get("q") ?? "")
  const [activeTab, setActiveTab] = useState<"integrations" | "references" | "connectors" | "objects" | "mcp">(() => linkedTab(searchParams.get("tab")) ?? "integrations")
  useEffect(() => {
    const tab = linkedTab(searchParams.get("tab"))
    if (tab) setActiveTab(tab)
    const q = searchParams.get("q")
    if (q !== null) setSearch(q)
  }, [searchParams])
  const [integrationViewMode, setIntegrationViewMode] = useState<'cards' | 'list'>('cards')
  const [integrationTypeFilter, setIntegrationTypeFilter] = useState<string>('all')
  const [integrationStatusFilter, setIntegrationStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [integrationSortBy, setIntegrationSortBy] = useState<'name' | 'type' | 'references' | 'updated_at'>('updated_at')
  const [integrationSortDir, setIntegrationSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [editingTags, setEditingTags] = useState<string | null>(null)
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
  const [exportTarget, setExportTarget] = useState<{ id: string; name: string } | null>(null)

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
    if (isWriteReference(ref) && !window.confirm(`"${ref.name}" writes data. Running the test sends it for real with the integration's credentials (recorded in the call log). Continue?`)) return
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
          capture_schema: isWriteReference(ref) ? undefined : 'auto',
          // A write reference changes real data: only after the person confirms.
          ...(isWriteReference(ref) ? { confirm_write: true } : {}),
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

  const refCountByIntegration = useMemo(() => {
    const refCounts = new Map<string, number>()
    references.forEach((ref) => {
      const integrationId = (ref.integration as any)?.id
      if (!integrationId) return
      refCounts.set(integrationId, (refCounts.get(integrationId) ?? 0) + 1)
    })
    return refCounts
  }, [references])

  const sortedIntegrations = useMemo(() => {
    const refCounts = refCountByIntegration

    const next = [...filteredIntegrations].sort((a, b) => {
      let cmp = 0
      if (integrationSortBy === 'name') cmp = String(a.name ?? '').localeCompare(String(b.name ?? ''))
      else if (integrationSortBy === 'type') cmp = String(typeLabels[a.type] ?? a.type ?? '').localeCompare(String(typeLabels[b.type] ?? b.type ?? ''))
      else if (integrationSortBy === 'references') cmp = (refCounts.get(a.id) ?? 0) - (refCounts.get(b.id) ?? 0)
      else cmp = new Date(a.updated_at ?? a.created_at ?? 0).getTime() - new Date(b.updated_at ?? b.created_at ?? 0).getTime()
      return integrationSortDir === 'asc' ? cmp : -cmp
    })

    return next
  }, [filteredIntegrations, integrationSortBy, integrationSortDir, refCountByIntegration])

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

  function sortTH(label: string, field: 'name' | 'type' | 'references' | 'updated_at', numeric = false) {
    const active = integrationSortBy === field
    const SortIcon = !active ? ArrowUpDown : integrationSortDir === 'asc' ? ArrowUp : ArrowDown
    return (
      <TH numeric={numeric} aria-sort={active ? (integrationSortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" onClick={() => toggleIntegrationSort(field)} className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}>
          {label} <SortIcon className="size-3" aria-hidden="true" />
        </button>
      </TH>
    )
  }

  function renderIntegrationMenu(integration: any) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" label={`Actions for ${integration.name}`} icon={<MoreHorizontal />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem icon={<ExternalLink />} onSelect={() => router.push(`/integrations/${integration.id}`)}>Open</DropdownMenuItem>
          <DropdownMenuItem icon={<TagIcon />} onSelect={() => setEditingTags(integration.id)}>Edit tags</DropdownMenuItem>
          <DropdownMenuItem icon={<MapIcon />} onSelect={() => { setDepsId(integration.id); setDepsName(integration.name) }}>Dependency map</DropdownMenuItem>
          <DropdownMenuItem icon={<Download />} onSelect={() => setExportTarget({ id: integration.id, name: integration.name })}>Export</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem danger icon={<Trash2 />} onSelect={() => setIntegrationToDelete({ id: integration.id, name: integration.name })}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }


  const tabItems = [
    { value: "integrations" as const, label: "Integrations", count: filteredIntegrations.length },
    { value: "references" as const, label: "References", count: filteredReferences.length },
    { value: "connectors" as const, label: "Connectors" },
    { value: "objects" as const, label: "Objects" },
    { value: "mcp" as const, label: "MCP servers", ...(mcpServers.length > 0 ? { count: mcpServers.length } : {}) },
  ]
  const showToolbar = activeTab === "integrations" || activeTab === "references"

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-2"
        title="Integrations"
        description={description}
        actions={actions}
        tabs={<Tabs aria-label="Integrations" value={activeTab} onValueChange={setActiveTab} items={tabItems} />}
      />

      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      {/* Search, filters and tags (integrations and references) */}
      {showToolbar && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput
              value={search}
              onValueChange={setSearch}
              placeholder={activeTab === "references" ? "Search references" : "Search integrations"}
              aria-label="Search integrations and references"
              wrapperClassName="w-full max-w-xs"
            />
            {activeTab === "integrations" && (
              <>
                <Select
                  aria-label="Type"
                  value={integrationTypeFilter}
                  onChange={(e) => setIntegrationTypeFilter(e.target.value)}
                  wrapperClassName="w-auto"
                  options={[{ value: "all", label: "All types" }, ...integrationTypeOptions.map((type) => ({ value: type, label: typeLabels[type] ?? type }))]}
                />
                <Select
                  aria-label="Status"
                  value={integrationStatusFilter}
                  onChange={(e) => setIntegrationStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
                  wrapperClassName="w-auto"
                  options={[{ value: "all", label: "All statuses" }, { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
                />
                <Select
                  aria-label="Sort by"
                  value={integrationSortBy}
                  onChange={(e) => setIntegrationSortBy(e.target.value as 'name' | 'type' | 'references' | 'updated_at')}
                  wrapperClassName="w-auto"
                  options={[
                    { value: "updated_at", label: "Sort by updated" },
                    { value: "name", label: "Sort by name" },
                    { value: "type", label: "Sort by type" },
                    { value: "references", label: "Sort by references" },
                  ]}
                />
                <IconButton
                  variant="secondary"
                  label={integrationSortDir === 'asc' ? 'Ascending (switch to descending)' : 'Descending (switch to ascending)'}
                  icon={integrationSortDir === 'asc' ? <ArrowUp /> : <ArrowDown />}
                  onClick={() => setIntegrationSortDir((dir) => dir === 'asc' ? 'desc' : 'asc')}
                />
                <SegmentedControl
                  aria-label="View"
                  size="sm"
                  className="ml-auto"
                  value={integrationViewMode}
                  onValueChange={setIntegrationViewMode}
                  options={[
                    { value: "cards", icon: <LayoutGrid />, label: "Cards" },
                    { value: "list", icon: <List />, label: "List" },
                  ]}
                />
              </>
            )}
          </div>
          <TagFilterBar tags={allTags} tagDefinitions={tagDefs} selectedTag={selectedTag} onSelectTag={setSelectedTag} />
        </div>
      )}

      {/* ─── Integrations Tab ─── */}
      {activeTab === "integrations" && (
        sortedIntegrations.length === 0 ? (
          search || selectedTag || integrationTypeFilter !== 'all' || integrationStatusFilter !== 'all' ? (
            <EmptyState
              size="sm"
              variant="no-results"
              title="No integrations match these filters"
              action={{ label: "Clear filters", onClick: () => { setSearch(""); setSelectedTag(null); setIntegrationTypeFilter('all'); setIntegrationStatusFilter('all') } }}
            />
          ) : (
            <EmptyState
              icon={Network}
              title="No integrations yet"
              description="An integration connects UserTasks to an external API or service. Create one, or import an OpenAPI spec to add its references in one go."
              secondaryAction={{ label: "How integrations work", href: "/docs/integrations" }}
            />
          )
        ) : integrationViewMode === 'cards' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sortedIntegrations.map((integration) => {
              const Icon = typeIcons[integration.type] ?? Globe
              const config = integration.config as any
              const customIcon = resolveStorageUrl(config?.icon_url)
              const refCount = refCountByIntegration.get(integration.id) ?? 0
              const tags = (integration.tags as string[]) ?? []
              const host = hostOf(config?.base_url)
              const showTags = editingTags === integration.id

              return (
                // The title link is stretched over the card (::after overlay) so
                // the whole card navigates; the ⋯ menu and the tag editor sit
                // above the overlay, outside the <a>.
                <Card key={integration.id} variant="interactive" padding="md" className="group relative flex flex-col gap-3" data-testid="integration-card">
                  <div className="flex items-start gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-subtle text-fg-muted" aria-hidden="true">
                      {customIcon ? <img src={customIcon} alt="" className="size-5 object-contain" /> : <Icon className="size-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-sm font-semibold text-fg">
                        <Link
                          href={`/integrations/${integration.id}`}
                          className="after:absolute after:inset-0 after:rounded-lg after:content-['']"
                        >
                          {integration.name}
                        </Link>
                      </h3>
                      <p className="truncate font-mono text-xs text-fg-muted" title={config?.base_url || undefined}>
                        {typeLabels[integration.type] ?? integration.type}{host ? ` · ${host}` : ""}
                      </p>
                    </div>
                    <StatusPill status={integration.is_active ? "active" : "inactive"} className="shrink-0" />
                  </div>
                  <div className="flex items-center gap-2 text-xs text-fg-muted">
                    <span className="num">{plural(refCount, "reference")}</span>
                    {integration.last_test_status && (
                      <span className={integration.last_test_status === "success" ? "text-success" : "text-danger"}>
                        · {integration.last_test_status === "success" ? "Connected" : "Connection error"}
                      </span>
                    )}
                    {tags.length > 0 && editingTags !== integration.id && (
                      <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                        {tags.slice(0, 2).map((t) => <Tag key={t} className="truncate">{t}</Tag>)}
                        {tags.length > 2 && <span className="num shrink-0">+{tags.length - 2}</span>}
                      </span>
                    )}
                    <span className="relative z-[1] ml-auto shrink-0">
                      {renderIntegrationMenu(integration)}
                    </span>
                  </div>
                  {showTags && (
                    <div className="relative z-[1] -mt-1 flex cursor-default items-start gap-2">
                      <div className="min-w-0 flex-1"><ItemTagEditor id={integration.id} tags={tags} table="integrations" /></div>
                      <Button size="sm" variant="ghost" onClick={() => setEditingTags(null)}>Done</Button>
                    </div>
                  )}
                </Card>
              )
            })}
          </div>
        ) : (
          <DataTable>
            <THead>
              <tr>
                {sortTH("Name", "name")}
                {sortTH("Type", "type")}
                <TH>Status</TH>
                {sortTH("References", "references", true)}
                {sortTH("Updated", "updated_at")}
                <TH><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {sortedIntegrations.map((integration) => {
                const Icon = typeIcons[integration.type] ?? Globe
                const config = integration.config as any
                const customIcon = resolveStorageUrl(config?.icon_url)
                const refCount = refCountByIntegration.get(integration.id) ?? 0
                const tags = (integration.tags as string[]) ?? []
                const updated = integration.updated_at ?? integration.created_at

                return (
                  <TR key={integration.id} interactive onClick={() => router.push(`/integrations/${integration.id}`)}>
                    <TD className="max-w-0 w-[40%]">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border-subtle bg-subtle text-fg-muted" aria-hidden="true">
                          {customIcon ? <img src={customIcon} alt="" className="size-4 object-contain" /> : <Icon className="size-3.5" />}
                        </span>
                        <div className="min-w-0">
                          <Link href={`/integrations/${integration.id}`} onClick={(e) => e.stopPropagation()} className="block truncate font-medium text-fg hover:underline">
                            {integration.name}
                          </Link>
                          <span className="block truncate font-mono text-xs text-fg-muted">{config?.base_url || 'No endpoint configured'}</span>
                        </div>
                        {tags.length > 0 && (
                          <span className="ml-auto hidden shrink-0 gap-1 lg:flex">
                            {tags.slice(0, 2).map((t) => <Tag key={t}>{t}</Tag>)}
                          </span>
                        )}
                      </div>
                    </TD>
                    <TD className="text-fg-muted">{typeLabels[integration.type] ?? integration.type}</TD>
                    <TD><StatusPill status={integration.is_active ? "active" : "inactive"} /></TD>
                    <TD numeric>{refCount}</TD>
                    <TD className="text-fg-muted">
                      <Tooltip content={formatAbsolute(updated)}><span className="num">{formatRelative(updated)}</span></Tooltip>
                    </TD>
                    <TDActions onClick={(e) => e.stopPropagation()}>{renderIntegrationMenu(integration)}</TDActions>
                  </TR>
                )
              })}
            </TBody>
          </DataTable>
        )
      )}

      {exportTarget && (
        <ExportAssetDialog
          ids={[exportTarget.id]}
          name={exportTarget.name}
          open
          onOpenChange={(open) => { if (!open) setExportTarget(null) }}
        />
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

      {/* Generic confirmation (bulk reference delete). */}
      <ConfirmDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => { if (!open && !confirmBusy) setConfirmState(null) }}
        title={confirmState?.title ?? ''}
        description={confirmState?.description ?? ''}
        confirmLabel={confirmState?.destructive ? 'Delete' : 'Confirm'}
        destructive={confirmState?.destructive}
        busy={confirmBusy}
        onConfirm={async () => {
          if (!confirmState) return
          setConfirmBusy(true)
          try { await confirmState.action() } finally { setConfirmBusy(false); setConfirmState(null) }
        }}
      />

      {/* ─── References Tab ─── */}
      {activeTab === "references" && (
        <>
          {filteredReferences.length === 0 ? (
            search || selectedTag || refIntegrationFilter ? (
              <EmptyState
                size="sm"
                variant="no-results"
                title="No references match these filters"
                action={{ label: "Clear filters", onClick: () => { setSearch(""); setSelectedTag(null); setRefIntegrationFilter(null) } }}
              />
            ) : (
              <EmptyState
                icon={Bookmark}
                title="No references yet"
                description="References are the reusable calls your workflows, forms and agents make. Add them from an integration's setup wizard."
              />
            )
          ) : (
            <div className="space-y-2">
              <div className="flex min-h-8 flex-wrap items-center gap-2">
                {refIntegrations.length > 1 && (
                  <Select
                    aria-label="Source integration"
                    size="sm"
                    wrapperClassName="w-auto"
                    value={refIntegrationFilter ?? ""}
                    onChange={(e) => setRefIntegrationFilter(e.target.value || null)}
                    options={[
                      { value: "", label: `All sources (${references.length})` },
                      ...refIntegrations.map((integ) => ({ value: integ.id, label: `${integ.name} (${integ.count})` })),
                    ]}
                  />
                )}
                {selectedRefs.size > 0 && (
                  <div className="ml-auto flex items-center gap-2" role="toolbar" aria-label="Selected references">
                    <span className="num text-xs text-fg-muted">{selectedRefs.size} selected</span>
                    <Input
                      size="sm"
                      aria-label="Add a tag to the selected references"
                      value={bulkTagInput}
                      onChange={e => setBulkTagInput(e.target.value)}
                      onKeyDown={async e => {
                        if (e.key === 'Enter' && bulkTagInput.trim()) {
                          const outcome = await runInlineJob(jobs, 'references.add_tag', { ids: [...selectedRefs], tag: bulkTagInput }, {
                            onSuccess: () => queryClient.invalidateQueries({ queryKey: ['integrations'] }),
                          })
                          if (outcome.status === 'failed') setNotice({ tone: 'error', message: outcome.error })
                          setBulkTagInput(''); setSelectedRefs(new Set())
                        }
                      }}
                      placeholder="Add tag…"
                      className="w-32"
                    />
                    <Button
                      size="sm"
                      variant="danger-ghost"
                      leadingIcon={<Trash2 />}
                      loading={bulkDeleting}
                      onClick={() => {
                        setConfirmState({
                          title: `Delete ${plural(selectedRefs.size, 'reference')}?`,
                          description: 'Workflows, forms or agents still calling them will fail until re-pointed.',
                          destructive: true,
                          action: async () => {
                            // One `bulk.delete` job instead of one request per reference.
                            setBulkDeleting(true)
                            try {
                              const result = await bulkDeleteWithJob(jobs, 'reference', [...selectedRefs], () => queryClient.invalidateQueries({ queryKey: ['integrations'] }))
                              setSelectedRefs(new Set())
                              if (!result.background) setNotice({ tone: 'success', message: `${plural(result.queued, 'reference')} deleted.` })
                            } catch (error) {
                              setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Could not delete the references' })
                            } finally {
                              setBulkDeleting(false)
                            }
                          },
                        })
                      }}
                    >
                      Delete
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedRefs(new Set())}>Clear</Button>
                  </div>
                )}
              </div>

              <DataTable>
                <THead>
                  <tr>
                    <TH className="w-10">
                      <Checkbox
                        aria-label="Select all references"
                        checked={filteredReferences.length > 0 && filteredReferences.every(r => selectedRefs.has(r.id))}
                        onChange={() => {
                          const allSelected = filteredReferences.every(r => selectedRefs.has(r.id))
                          setSelectedRefs(allSelected ? new Set() : new Set(filteredReferences.map(r => r.id)))
                        }}
                      />
                    </TH>
                    <TH>Reference</TH>
                    <TH>Request</TH>
                    <TH>Tags</TH>
                    <TH numeric>Inputs</TH>
                    <TH numeric>Outputs</TH>
                    <TH><span className="sr-only">Actions</span></TH>
                  </tr>
                </THead>
                <TBody>
                  {filteredReferences.map((ref) => {
                    const integration = ref.integration as any
                    const Icon = typeIcons[integration?.type] ?? Globe
                    const refCustomIcon = resolveStorageUrl((integration?.config as any)?.icon_url || (ref.request_config as any)?.icon_url)
                    const inputs = (ref.inputs as any[]) ?? []
                    const outputs = (ref.outputs as any[]) ?? []
                    const reqConfig = (ref.request_config as any) ?? {}
                    const tags = (ref.tags as string[]) ?? []
                    const isSelected = selectedRefs.has(ref.id)

                    return (
                      <TR key={ref.id} interactive selected={isSelected} onClick={() => openRefTest(ref)}>
                        <TD onClick={e => e.stopPropagation()}>
                          <Checkbox
                            aria-label={`Select ${ref.name}`}
                            checked={isSelected}
                            onChange={() => setSelectedRefs(prev => { const n = new Set(prev); if (n.has(ref.id)) n.delete(ref.id); else n.add(ref.id); return n })}
                          />
                        </TD>
                        <TD className="max-w-0 w-[34%]">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="flex size-6 shrink-0 items-center justify-center rounded border border-border-subtle bg-subtle text-fg-muted" aria-hidden="true">
                              {refCustomIcon ? <img src={refCustomIcon} alt="" className="size-4 object-contain" /> : <Icon className="size-3.5" />}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-fg">{ref.name}</p>
                              <p className="truncate text-xs text-fg-muted">{integration?.name ?? "Unknown integration"}</p>
                            </div>
                          </div>
                        </TD>
                        <TD className="max-w-0 w-[30%]">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {reqConfig.method && <Tag mono>{reqConfig.method}</Tag>}
                            {reqConfig.path_template && (
                              <span className="truncate font-mono text-xs text-fg-muted" title={reqConfig.path_template}>{reqConfig.path_template}</span>
                            )}
                          </div>
                        </TD>
                        <TD onClick={e => e.stopPropagation()} className="cursor-default">
                          {tags.length > 0 || editingTags === ref.id ? (
                            <ItemTagEditor id={ref.id} tags={tags} table="integration_references" />
                          ) : (
                            <Button size="sm" variant="ghost" className="opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100" onClick={() => setEditingTags(ref.id)}>Add tag</Button>
                          )}
                        </TD>
                        <TD numeric className="text-fg-muted">{inputs.length}</TD>
                        <TD numeric className="text-fg-muted">{outputs.length}</TD>
                        <TDActions onClick={e => e.stopPropagation()}>
                          <IconButton size="sm" label={`Test ${ref.name}`} icon={<Play />} onClick={() => openRefTest(ref)} />
                          <IconButton size="sm" label="Usage and analytics" icon={<BarChart3 />} onClick={() => openUsage(ref.id)} />
                          <IconButton size="sm" label={`Open ${integration?.name ?? 'integration'}`} icon={<ChevronRight />} onClick={() => router.push(`/integrations/${integration?.id}`)} />
                        </TDActions>
                      </TR>
                    )
                  })}
                </TBody>
              </DataTable>
            </div>
          )}

          {/* Quick test */}
          {(() => {
            const ref = testingRefId ? references.find((r: any) => r.id === testingRefId) : null
            const inputs = ((ref?.inputs as any[]) ?? [])
            const config = ref?.request_config as any
            const integration = ref?.integration as any
            const baseUrl = (integration?.config as any)?.base_url ?? ''
            return (
              <UIDialog open={Boolean(ref)} onOpenChange={(open) => { if (!open) setTestingRefId(null) }}>
                {ref && (
                  <DialogContent size="lg" title={`Test “${ref.name}”`} description={integration?.name}>
                    <DialogBody className="space-y-4">
                      <Card variant="inset" padding="sm" className="flex min-w-0 items-center gap-2">
                        <Tag mono>{config?.method ?? 'GET'}</Tag>
                        <code className="min-w-0 truncate font-mono text-xs text-fg">{baseUrl}{config?.path_template ?? ''}</code>
                      </Card>
                      {inputs.length > 0 && (
                        <div className="space-y-3">
                          <h3 className="text-ui font-medium text-fg">Inputs</h3>
                          {inputs.map((inp: any, idx: number) => (
                            <Field
                              key={inp.id ?? `${inp.name}-${idx}`}
                              label={<><code className="font-mono">{inp.name}</code> <span className="font-normal text-fg-muted">{inp.type}</span></>}
                              optional={!inp.required}
                            >
                              <Input
                                value={testInputs[inp.name] ?? ''}
                                onChange={e => setTestInputs(p => ({ ...p, [inp.name]: e.target.value }))}
                                placeholder={inp.default_value || inp.name}
                                className="font-mono"
                              />
                            </Field>
                          ))}
                        </div>
                      )}
                      {testResult && (
                        testResult.error ? (
                          <InlineNotice tone="danger" title={testResult.status ? `HTTP ${testResult.status}` : 'The test failed'} message={String(testResult.error)} />
                        ) : (
                          <JsonViewer
                            value={testResult.data}
                            meta={testResult.status ? <Badge tone={testResult.status < 300 ? 'success' : 'danger'} className="num">{testResult.status}</Badge> : null}
                          />
                        )
                      )}
                    </DialogBody>
                    <DialogFooter>
                      <Button variant="secondary" onClick={() => setTestingRefId(null)}>Close</Button>
                      <Button onClick={() => runRefTest(ref)} loading={testLoading} leadingIcon={<Play />}>
                        {testResult ? 'Run again' : 'Run test'}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                )}
              </UIDialog>
            )
          })()}

          {/* Usage and analytics */}
          {(() => {
            const ref = usageRefId ? references.find((r: any) => r.id === usageRefId) : null
            return (
              <UIDialog open={Boolean(ref)} onOpenChange={(open) => { if (!open) setUsageRefId(null) }}>
                {ref && (
                  <DialogContent size="md" title={`Usage of “${ref.name}”`}>
                    <DialogBody className="space-y-4">
                      {usageLoading ? (
                        <div className="flex items-center justify-center gap-2 py-10 text-ui text-fg-muted">
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Loading usage…
                        </div>
                      ) : usageData?.error ? (
                        <InlineNotice tone="danger" message={usageData.error} />
                      ) : usageData ? (
                        <>
                          <dl className="grid grid-cols-3 gap-2">
                            {[
                              { label: 'Workflows', value: formatCount(usageData.workflow_count) },
                              { label: 'Executions', value: formatCount(usageData.total_executions) },
                              { label: 'Last run', value: usageData.last_executed_at ? formatRelative(usageData.last_executed_at) : 'Never' },
                            ].map((stat) => (
                              <Card key={stat.label} variant="inset" padding="sm">
                                <dt className="text-xs text-fg-muted">{stat.label}</dt>
                                <dd className="num mt-0.5 text-lg font-semibold text-fg">{stat.value}</dd>
                              </Card>
                            ))}
                          </dl>
                          <div>
                            <h3 className="mb-2 text-ui font-medium text-fg">Used in workflows</h3>
                            {usageData.workflows.length === 0 ? (
                              <p className="py-4 text-center text-ui text-fg-muted">Not used in any workflow yet.</p>
                            ) : (
                              <ul className="divide-y divide-border-subtle rounded-md border border-border">
                                {usageData.workflows.map((w: any) => (
                                  <li key={w.id} className="flex items-center gap-2 px-3 py-2">
                                    <StatusPill status={w.is_active ? 'active' : 'inactive'} className="shrink-0" />
                                    <div className="min-w-0 flex-1">
                                      <p className="truncate text-ui font-medium">{w.name}</p>
                                      <p className="num truncate text-xs text-fg-muted">
                                        {plural(w.node_count, 'node')}
                                        {w.node_labels?.length > 0 && ` (${w.node_labels.join(', ')})`}
                                        {' · '}{plural(w.run_count, 'run')}
                                        {w.last_run_at && ` · last ${formatRelative(w.last_run_at)}`}
                                      </p>
                                    </div>
                                    <Link href={`/automations/${w.id}`} aria-label={`Open ${w.name}`} className={buttonVariants({ variant: 'ghost', size: 'icon-sm' })}>
                                      <ExternalLink className="size-3.5" aria-hidden="true" />
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </>
                      ) : null}
                    </DialogBody>
                  </DialogContent>
                )}
              </UIDialog>
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
  // Synchronous guard: two clicks in one frame both see saving === false.
  const addGuard = useSubmitGuard()
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  async function handleAdd() {
    await addGuard.run(async () => {
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
    })
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

  const authLabel = (t: string) => (t === 'bearer' ? 'Bearer token' : t === 'api_key' ? 'API key header' : 'No auth')
  const serverMenu = (server: any) => (
    <>
      <ExportAssetButton ids={[server.id]} name={server.name} iconOnly size="sm" />
      <IconButton size="sm" variant="danger-ghost" label={`Delete ${server.name}`} icon={<Trash2 />} onClick={() => setDeleteTarget(server.id)} />
    </>
  )

  return (
    <div className="space-y-3">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search MCP servers" aria-label="Search MCP servers" wrapperClassName="w-full max-w-xs" />
        <Select aria-label="Status" wrapperClassName="w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
          options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} />
        <Select aria-label="Sort by" wrapperClassName="w-auto" value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          options={[{ value: 'created_at', label: 'Sort by created' }, { value: 'name', label: 'Sort by name' }, { value: 'tools', label: 'Sort by tools' }]} />
        <IconButton variant="secondary" label={sortDir === 'asc' ? 'Ascending (switch to descending)' : 'Descending (switch to ascending)'}
          icon={sortDir === 'asc' ? <ArrowUp /> : <ArrowDown />} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} />
        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl aria-label="View" size="sm" value={viewMode} onValueChange={setViewMode}
            options={[{ value: 'cards', icon: <LayoutGrid />, label: 'Cards' }, { value: 'list', icon: <List />, label: 'List' }]} />
          <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setShowAdd(true)}>Add server</Button>
        </div>
      </div>

      <UIDialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent size="md" title="Add an MCP server" description="Its tools become available to your AI agents.">
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Slack MCP" />
              </Field>
              <Field label="Server URL">
                <Input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" className="font-mono" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Authentication">
                <Select value={authType} onChange={e => setAuthType(e.target.value)}
                  options={[{ value: 'none', label: 'None' }, { value: 'bearer', label: 'Bearer token' }, { value: 'api_key', label: 'API key header' }]} />
              </Field>
              {authType !== 'none' && (
                <Field label="Token or key">
                  <Input type="password" value={token} onChange={e => setToken(e.target.value)} placeholder="••••••••" autoComplete="off" />
                </Field>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} loading={saving} disabled={!name.trim() || !url.trim()}>Add server</Button>
          </DialogFooter>
        </DialogContent>
      </UIDialog>

      {sortedServers.length === 0 ? (
        search || statusFilter !== 'all' ? (
          <EmptyState size="sm" variant="no-results" title="No MCP servers match these filters" action={{ label: 'Clear filters', onClick: () => { setSearch(''); setStatusFilter('all') } }} />
        ) : (
          <EmptyState icon={Network} title="No MCP servers yet" description="Connect an external MCP server to give your AI agents more tools." action={{ label: 'Add server', onClick: () => setShowAdd(true) }} />
        )
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedServers.map((server: any) => (
            <Card key={server.id} padding="md" className="group flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-subtle text-fg-muted" aria-hidden="true">
                  <Network className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-semibold text-fg">{server.name}</h3>
                  <p className="truncate font-mono text-xs text-fg-muted" title={server.url}>{hostOf(server.url) || server.url}</p>
                </div>
                <StatusPill status={server.is_active ? 'active' : 'inactive'} className="shrink-0" />
              </div>
              <div className="flex items-center gap-2 text-xs text-fg-muted">
                <span className="num">{plural(server.tools_cache?.length ?? 0, 'tool')}</span>
                <span>· {authLabel(server.auth_type)}</span>
                <span className="ml-auto flex items-center gap-0.5">{serverMenu(server)}</span>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <DataTable>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH>URL</TH>
              <TH>Auth</TH>
              <TH numeric>Tools</TH>
              <TH><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {sortedServers.map((server: any) => (
              <TR key={server.id}>
                <TD className="font-medium">
                  <span className="flex items-center gap-2">
                    {server.name}
                    {!server.is_active && <StatusPill status="inactive" />}
                  </span>
                </TD>
                <TD className="max-w-0 w-[40%]"><span className="block truncate font-mono text-xs text-fg-muted">{server.url}</span></TD>
                <TD className="text-fg-muted">{authLabel(server.auth_type)}</TD>
                <TD numeric>{server.tools_cache?.length ?? 0}</TD>
                <TDActions>{serverMenu(server)}</TDActions>
              </TR>
            ))}
          </TBody>
        </DataTable>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete this MCP server?"
        description="Agents that use its tools lose access to them."
        confirmLabel="Delete server"
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
  // Synchronous guard: two clicks in one frame both see saving === false.
  const createGuard = useSubmitGuard()
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
    await createGuard.run(async () => {
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
    })
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

  const sourceName = (s: any) => s.table?.name ?? s.reference?.name ?? s.alias
  const objectActions = (obj: any) => (
    <>
      <Button size="sm" variant="secondary" leadingIcon={<Plus />} onClick={() => handleGenerateRefs(obj)}>Generate references</Button>
      <IconButton size="sm" variant="danger-ghost" label={`Delete ${obj.name}`} icon={<Trash2 />} onClick={() => setDeleteTarget(obj.id)} />
    </>
  )

  return (
    <div className="space-y-3">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <p className="max-w-[72ch] text-ui text-fg-muted">
        Objects join data tables and API references into one queryable entity. Each object generates a reference you can use in workflows and forms.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onValueChange={setSearch} placeholder="Search objects" aria-label="Search objects" wrapperClassName="w-full max-w-xs" />
        <Select aria-label="Source types" wrapperClassName="w-auto" value={sourceFilter} onChange={e => setSourceFilter(e.target.value as any)}
          options={[{ value: 'all', label: 'All source types' }, { value: 'tables', label: 'Tables only' }, { value: 'mixed', label: 'Mixed sources' }]} />
        <Select aria-label="Sort by" wrapperClassName="w-auto" value={sortBy} onChange={e => setSortBy(e.target.value as any)}
          options={[{ value: 'updated_at', label: 'Sort by updated' }, { value: 'name', label: 'Sort by name' }, { value: 'sources', label: 'Sort by sources' }]} />
        <IconButton variant="secondary" label={sortDir === 'asc' ? 'Ascending (switch to descending)' : 'Descending (switch to ascending)'}
          icon={sortDir === 'asc' ? <ArrowUp /> : <ArrowDown />} onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')} />
        <div className="ml-auto flex items-center gap-2">
          <SegmentedControl aria-label="View" size="sm" value={viewMode} onValueChange={setViewMode}
            options={[{ value: 'cards', icon: <LayoutGrid />, label: 'Cards' }, { value: 'list', icon: <List />, label: 'List' }]} />
          <Button variant="secondary" leadingIcon={<Plus />} onClick={() => setShowCreate(true)}>New object</Button>
        </div>
      </div>

      {isLoading ? (
        <DataTable><TBody><TableSkeleton columns={4} rows={3} /></TBody></DataTable>
      ) : sortedObjects.length === 0 ? (
        search || sourceFilter !== 'all' ? (
          <EmptyState size="sm" variant="no-results" title="No objects match these filters" action={{ label: 'Clear filters', onClick: () => { setSearch(''); setSourceFilter('all') } }} />
        ) : (
          <EmptyState icon={Box} title="No objects yet" description="Create an object to join data tables and references together." action={{ label: 'New object', onClick: () => setShowCreate(true) }} />
        )
      ) : viewMode === 'cards' ? (
        <div className="space-y-3">
          {sortedObjects.map((obj: any) => {
            const srcs = (obj.sources ?? []).sort((a: any, b: any) => a.sort_order - b.sort_order)
            return (
              <Card key={obj.id} padding="md" className="flex items-start gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-subtle text-fg-muted" aria-hidden="true">
                  <Box className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-fg">{obj.name}</h3>
                    <span className="num text-xs text-fg-muted">{plural(srcs.length, 'source')}</span>
                  </div>
                  {obj.description && <p className="mt-0.5 text-ui text-fg-muted">{obj.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {srcs.map((s: any, i: number) => (
                      <span key={s.id} className="flex items-center gap-1.5">
                        {i > 0 && <Tag mono>{s.join_type?.toUpperCase() ?? 'LEFT'} JOIN</Tag>}
                        <Tag className="gap-1">
                          {s.source_type === 'table' ? <Table className="size-3" aria-hidden="true" /> : <Link2 className="size-3" aria-hidden="true" />}
                          {sourceName(s)}
                          {s.is_primary && <span className="text-fg-muted">· primary</span>}
                        </Tag>
                        {i > 0 && s.join_on_local && (
                          <span className="font-mono text-xs text-fg-muted">
                            on {s.alias}.{s.join_on_local} = {s.join_to_alias}.{s.join_on_foreign}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">{objectActions(obj)}</div>
              </Card>
            )
          })}
        </div>
      ) : (
        <DataTable>
          <THead>
            <tr>
              <TH>Name</TH>
              <TH numeric>Sources</TH>
              <TH>Type</TH>
              <TH>Updated</TH>
              <TH><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {sortedObjects.map((obj: any) => {
              const srcs = obj.sources ?? []
              const sourceKind = srcs.every((s: any) => s.source_type === 'table') ? 'Tables only' : 'Mixed'
              const updated = obj.updated_at ?? obj.created_at
              return (
                <TR key={obj.id}>
                  <TD className="max-w-0 w-[45%]">
                    <p className="truncate font-medium text-fg">{obj.name}</p>
                    <p className="truncate text-xs text-fg-muted">{obj.description || 'No description'}</p>
                  </TD>
                  <TD numeric>{srcs.length}</TD>
                  <TD className="text-fg-muted">{sourceKind}</TD>
                  <TD className="text-fg-muted"><Tooltip content={formatAbsolute(updated)}><span className="num">{formatRelative(updated)}</span></Tooltip></TD>
                  <TDActions>{objectActions(obj)}</TDActions>
                </TR>
              )
            })}
          </TBody>
        </DataTable>
      )}

      {/* Create object */}
      <UIDialog open={showCreate} onOpenChange={(open) => { setShowCreate(open); if (!open) { setName(''); setDescription(''); setSources([]) } }}>
        <DialogContent size="lg" title="New object" description="Join data tables and API references. The first source is the primary; the others are joined to it.">
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Customer orders" />
              </Field>
              <Field label="Description" optional>
                <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="What this object represents" />
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-ui font-medium text-fg">Data sources</h3>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" leadingIcon={<Table />} onClick={() => addSource('table')}>Add table</Button>
                  <Button size="sm" variant="secondary" leadingIcon={<Link2 />} onClick={() => addSource('reference')}>Add reference</Button>
                </div>
              </div>

              {sources.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-ui text-fg-muted">
                  Add at least one data source (a table or a reference) to start.
                </div>
              ) : (
                <div className="space-y-2">
                  {sources.map((src) => {
                    const localCols = src.sourceType === 'table' && src.tableId
                      ? (tables.find(t => t.id === src.tableId)?.columns as any[] ?? []).map((c: any) => c.key ?? c.name)
                      : (references.find(r => r.id === src.referenceId)?.outputs ?? []).map((o: any) => o.name ?? o.path)
                    const targetSrc = sources.find(s => s.alias === src.joinToAlias)
                    const foreignCols = targetSrc
                      ? targetSrc.sourceType === 'table' && targetSrc.tableId
                        ? (tables.find(t => t.id === targetSrc.tableId)?.columns as any[] ?? []).map((c: any) => c.key ?? c.name)
                        : (references.find(r => r.id === targetSrc.referenceId)?.outputs ?? []).map((o: any) => o.name ?? o.path)
                      : []
                    return (
                      <div key={src.id} className={cn('space-y-2 rounded-lg border p-3', src.isPrimary ? 'border-primary bg-primary-wash' : 'border-border bg-subtle')}>
                        <div className="flex items-center gap-2">
                          <Badge tone={src.isPrimary ? 'brand' : 'neutral'}>{src.isPrimary ? 'Primary' : 'Join'}</Badge>
                          <span className="text-xs font-medium text-fg">{src.sourceType === 'table' ? 'Data table' : 'API reference'}</span>
                          <div className="flex-1" />
                          <Input size="sm" aria-label="Alias" value={src.alias} onChange={e => updateSource(src.id, { alias: e.target.value })} className="w-24 font-mono" placeholder="alias" />
                          <IconButton size="sm" variant="danger-ghost" label="Remove source" icon={<X />} onClick={() => removeSource(src.id)} />
                        </div>
                        <Select
                          size="sm"
                          aria-label={src.sourceType === 'table' ? 'Data table' : 'Reference'}
                          value={src.sourceType === 'table' ? src.tableId ?? '' : src.referenceId ?? ''}
                          onChange={e => updateSource(src.id, src.sourceType === 'table' ? { tableId: e.target.value } : { referenceId: e.target.value })}
                          placeholder={`Select a ${src.sourceType}…`}
                        >
                          {src.sourceType === 'table'
                            ? tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
                            : references.map(r => <option key={r.id} value={r.id}>{r.name}{r.integration ? ` (${r.integration.name})` : ''}</option>)}
                        </Select>
                        {!src.isPrimary && (
                          <div className="grid grid-cols-4 gap-2">
                            <Select size="sm" aria-label="Join type" value={src.joinType ?? 'left'} onChange={e => updateSource(src.id, { joinType: e.target.value as any })}
                              options={[{ value: 'left', label: 'Left join' }, { value: 'inner', label: 'Inner join' }, { value: 'right', label: 'Right join' }, { value: 'full', label: 'Full join' }]} />
                            <Select size="sm" aria-label="This column" value={src.joinOnLocal ?? ''} onChange={e => updateSource(src.id, { joinOnLocal: e.target.value })} placeholder="This column…">
                              {localCols.map((c: string) => <option key={c} value={c}>{c}</option>)}
                            </Select>
                            <Select size="sm" aria-label="Target column" value={src.joinOnForeign ?? ''} onChange={e => updateSource(src.id, { joinOnForeign: e.target.value })} placeholder="= Target column…">
                              {foreignCols.map((c: string) => <option key={c} value={c}>{c}</option>)}
                            </Select>
                            <Select size="sm" aria-label="Join to" value={src.joinToAlias ?? ''} onChange={e => updateSource(src.id, { joinToAlias: e.target.value })} placeholder="Join to…">
                              {sources.filter(s => s.alias !== src.alias).map(s => <option key={s.alias} value={s.alias}>{s.alias} ({s.sourceType === 'table' ? tables.find(t => t.id === s.tableId)?.name : references.find(r => r.id === s.referenceId)?.name})</option>)}
                            </Select>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={saving} disabled={!name.trim() || !sourcesValid}>Create object</Button>
          </DialogFooter>
        </DialogContent>
      </UIDialog>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
        title="Delete this object?"
        description="Its sources and any generated references are deleted too."
        confirmLabel="Delete object"
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
