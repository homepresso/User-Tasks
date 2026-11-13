"use client"

import { ExtensionMenuItems } from '@/components/extensions/item-actions'
import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Globe, Tag as TagIcon, Map, Shield, Trash2, Power, PowerOff, LayoutGrid, List, AlertTriangle,
  ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown, ChevronUp, MoreHorizontal, Download, Link2, Workflow as WorkflowIcon, X,
} from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { SearchInput } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Popover } from "@/components/ui/popover"
import { Tooltip } from "@/components/ui/tooltip"
import { StatusPill, Tag } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, THead, TBody, TR, TH, TD, TDActions, TableDetailCell, TableSkeleton, type ColumnKind } from "@/components/ui/table"
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, floatingSurfaceClass,
} from "@/components/ui/dropdown-menu"
import { useWorkflowDependencies, WorkflowDependencyMapView } from './workflow-dependencies'
import { TagBadge, InlineTagEditor, TagFilterBar, type TagDefinition } from "@/components/ui/tag-manager"
import { cn } from "@/lib/utils"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { formatCount } from "@/lib/format/number"
import { plural } from "@/lib/format/plural"
import { serverQuery } from "@/lib/server-read"
import { updateWorkflowTags } from "@/app/actions/automations"
import { runInlineJob, useJobs } from "@/components/jobs/jobs-provider"
import { createTagDefinition, updateTagDefinitionColor } from "@/app/actions/tags"
import { useAppStore } from "@/stores/app-store"
import { BulkPermissionsDialog } from "@/components/governance/bulk-permissions-dialog"
import { InlineNotice } from "@/components/ui/inline-notice"
import { buildQueuedDeleteNotice, type DeleteNotice } from "@/lib/queued-delete-feedback"
import { usePermissions } from "@/lib/permissions-context"
import { RunWorkflowButton, RunWorkflowDialog, type RunnableWorkflow } from "./run-workflow-dialog"
import { FormLinksDialog } from "./workflow-form-links"
import { ExportAssetButton, ExportAssetDialog } from "@/components/shared/config-transfer"
import { Pagination } from "@/components/ui/list-controls"
import { useWorkflowListPage } from "./use-workflow-list-page"
import { WORKFLOW_PAGE_SIZES, WORKFLOW_TRIGGER_LABELS, type WorkflowListView, type WorkflowSortField, type WorkflowStatusFilter } from "@/lib/automations/workflow-list-page"

interface Workflow {
  id: string
  name: string
  is_active: boolean | null
  trigger_type: string
  node_count: number | null
  run_count: number | null
  last_run_at: string | null
  updated_at: string
  created_at: string
  tags: string[] | null
  [key: string]: any
}

const TRIGGER_LABELS = WORKFLOW_TRIGGER_LABELS

type SortField = WorkflowSortField

/** Above this many workflows the list opens as a table until the user picks a view. */
const LIST_VIEW_THRESHOLD = 12

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: "updated_at", label: "Updated" },
  { value: "name", label: "Name" },
  { value: "run_count", label: "Runs" },
  { value: "status", label: "Status" },
  { value: "trigger_type", label: "Trigger" },
  { value: "nodes", label: "Nodes" },
]

const WEBHOOK_TRIGGERS = ["webhook_received", "middleware_received"]

function TriggerTag({ trigger }: { trigger: string }) {
  return (
    <Tag>
      {WEBHOOK_TRIGGERS.includes(trigger) && <Globe size={12} aria-hidden="true" />}
      {TRIGGER_LABELS[trigger] ?? trigger}
    </Tag>
  )
}

function RelativeDate({ value, prefix }: { value: string; prefix?: string }) {
  return (
    <Tooltip content={formatAbsolute(value)}>
      <span className="num">{prefix}{formatRelative(value)}</span>
    </Tooltip>
  )
}

/**
 * The Workflows list (cards / rows): one page at a time from the server
 * (automations.listPage), with search, status / trigger / tag filters, sort,
 * page and page size in the URL (lib/automations/workflow-list-page).
 */
export function WorkflowList({ initialTagDefs }: { initialTagDefs: TagDefinition[] }) {
  const router = useRouter()
  const { layoutPreference, setLayoutPreference } = useAppStore()
  const { can } = usePermissions()
  // The view the user chose is remembered; until they choose, more than
  // LIST_VIEW_THRESHOLD workflows open as a table (the facets give the total).
  const viewPreference = layoutPreference.workflows
  const totalQuery = useQuery({
    queryKey: ["workflows", "facets"],
    queryFn: () => serverQuery("automations.listFacets"),
    enabled: can('workflows.view') && viewPreference === undefined,
  })
  const viewDecided = viewPreference !== undefined || !totalQuery.isLoading
  const viewMode: WorkflowListView = viewPreference !== undefined
    ? (viewPreference === "list" ? "list" : "cards")
    : (totalQuery.data?.total ?? 0) > LIST_VIEW_THRESHOLD ? "list" : "cards"
  const setViewMode = (v: WorkflowListView) => setLayoutPreference("workflows", v)
  const listPage = useWorkflowListPage(viewMode, can('workflows.view') && viewDecided)
  const { state, update, facets } = listPage
  const workflows = listPage.rows as Workflow[]
  const [localWorkflows, setLocalWorkflows] = useState<Workflow[]>(workflows)
  const search = listPage.searchText
  const setSearch = listPage.setSearchText
  const selectedTag = state.tag
  const setSelectedTag = (tag: string | null) => update({ tag })
  const selectedTrigger = state.trigger
  const setSelectedTrigger = (trigger: string | null) => update({ trigger })
  const selectedStatus = state.status
  const setSelectedStatus = (status: WorkflowStatusFilter) => update({ status })
  const sortField = state.sort
  const sortDir = state.dir
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const [tagDefs, setTagDefs] = useState<TagDefinition[]>(initialTagDefs)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)
  const [showBulkPermissions, setShowBulkPermissions] = useState(false)
  const [depsId, setDepsId] = useState<string | null>(null)
  const [runTarget, setRunTarget] = useState<RunnableWorkflow | null>(null)
  const [exportTarget, setExportTarget] = useState<{ id: string; name: string } | null>(null)
  const [formLinkTarget, setFormLinkTarget] = useState<{ id: string; name: string } | null>(null)
  const canRun = can('workflows.activate')
  const depsWorkflow = localWorkflows.find(w => w.id === depsId)
  const { data: deps, isLoading: depsLoading } = useWorkflowDependencies(depsWorkflow?.id ?? '')
  const queryClient = useQueryClient()
  const jobs = useJobs()

  async function createTagDef(name: string, color: string) {
    const result = await createTagDefinition('workflows', name, color)
    if (result.ok) setTagDefs(prev => [...prev, result.data])
  }

  async function updateTagDefColor(name: string, color: string) {
    const def = tagDefs.find(d => d.name === name)
    if (!def) return
    const result = await updateTagDefinitionColor('workflows', def.id, color)
    if (result.ok) setTagDefs(prev => prev.map(d => d.name === name ? { ...d, color } : d))
  }

  useEffect(() => {
    setLocalWorkflows(workflows)
  }, [workflows])

  const allTags = facets.tags
  const triggerTypes = facets.triggers
  // The server filtered, sorted and paged the rows.
  const filtered = localWorkflows

  function toggleSort(field: SortField) {
    if (sortField === field) update({ dir: sortDir === "asc" ? "desc" : "asc" })
    else update({ sort: field, dir: "desc" })
  }

  async function addTag(workflowId: string, tag: string) {
    const wf = localWorkflows.find(w => w.id === workflowId)
    if (!wf) return
    const current = wf.tags ?? []
    const normalized = tag.trim().toLowerCase()
    if (!normalized || current.includes(normalized)) return
    await updateWorkflowTags(workflowId, [...current, normalized])
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
  }

  async function removeTag(workflowId: string, tag: string) {
    const wf = localWorkflows.find(w => w.id === workflowId)
    if (!wf) return
    await updateWorkflowTags(workflowId, (wf.tags ?? []).filter(t => t !== tag))
    queryClient.invalidateQueries({ queryKey: ['workflows'] })
  }

  // ── Selection helpers ──

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    const filteredIds = filtered.map(wf => wf.id)
    const allSelected = filteredIds.every(id => selected.has(id))
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(filteredIds))
    }
  }

  function clearSelection() {
    setSelected(new Set())
  }

  const selectedCount = selected.size
  const filteredIds = filtered.map(wf => wf.id)
  const allFilteredSelected = filteredIds.length > 0 && filteredIds.every(id => selected.has(id))
  const someFilteredSelected = filteredIds.some(id => selected.has(id))

  // ── Bulk actions ──

  async function handleBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    const nextWorkflows = localWorkflows.filter((workflow) => !selected.has(workflow.id))
    setBulkLoading(true)
    setBulkDeleteNotice(null)
    setShowBulkDelete(false)
    setLocalWorkflows(nextWorkflows)
    setSelected(new Set())
    // A background job (`bulk.delete`): small selections finish here.
    const outcome = await runInlineJob(jobs, 'bulk.delete', { type: 'workflow', ids }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    })
    setBulkLoading(false)
    if (outcome.status === 'failed') {
      setLocalWorkflows(localWorkflows)
      setSelected(new Set(ids))
      setBulkDeleteNotice({ tone: 'error', message: outcome.error || 'Failed to queue workflow deletion' })
      return
    }
    if (outcome.status === 'done') {
      setBulkDeleteNotice(buildQueuedDeleteNotice({
        queued: outcome.counts.queued ?? ids.length,
        total: ids.length,
        singular: 'workflow',
        plural: 'workflows',
      }))
    }
  }

  async function handleBulkActivate() {
    setBulkLoading(true)
    const outcome = await runInlineJob(jobs, 'workflows.set_active', { ids: [...selected], active: true }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    })
    setBulkLoading(false)
    if (outcome.status === 'failed') setBulkDeleteNotice({ tone: 'error', message: outcome.error })
    else setSelected(new Set())
  }

  async function handleBulkDeactivate() {
    setBulkLoading(true)
    const outcome = await runInlineJob(jobs, 'workflows.set_active', { ids: [...selected], active: false }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workflows'] }),
    })
    setBulkLoading(false)
    if (outcome.status === 'failed') setBulkDeleteNotice({ tone: 'error', message: outcome.error })
    else setSelected(new Set())
  }

  const hasFilters = search || selectedTag || selectedTrigger || selectedStatus !== "all"
  const selectedNames = localWorkflows.filter(w => selected.has(w.id)).map(w => w.name)
  const clearFilters = () => { setSearch(""); update({ q: "", tag: null, trigger: null, status: "all" }) }
  const loading = !viewDecided || listPage.loading
  const toggleEditTags = (id: string) => setEditingTagsId(editingTagsId === id ? null : id)

  function workflowMenu(wf: Workflow) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton size="sm" label={`More actions for ${wf.name}`} icon={<MoreHorizontal />} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {wf.trigger_type === "form_submitted" && (
            <DropdownMenuItem icon={<Link2 />} onSelect={() => setFormLinkTarget({ id: wf.id, name: wf.name })}>
              Form link
            </DropdownMenuItem>
          )}
          <DropdownMenuItem icon={<Download />} onSelect={() => setExportTarget({ id: wf.id, name: wf.name })}>
            Export…
          </DropdownMenuItem>
          <DropdownMenuItem icon={<Map />} onSelect={() => setDepsId(wf.id)}>
            Dependency map
          </DropdownMenuItem>
          <DropdownMenuItem icon={<TagIcon />} onSelect={() => toggleEditTags(wf.id)}>
            Edit tags
          </DropdownMenuItem>
          {/* Actions contributed by extensions for workflows. */}
          <ExtensionMenuItems objectType="workflow" items={[wf as unknown as Record<string, unknown>]} />
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  function tagEditor(wf: Workflow) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium text-fg-muted">Tags</p>
          <IconButton size="sm" label="Close tag editor" icon={<X />} onClick={() => setEditingTagsId(null)} noTooltip />
        </div>
        <InlineTagEditor
          tags={wf.tags ?? []}
          tagDefinitions={tagDefs}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          onAdd={(tag) => addTag(wf.id, tag)}
          onRemove={(tag) => removeTag(wf.id, tag)}
          onCreateDefinition={createTagDef}
          onUpdateDefinitionColor={updateTagDefColor}
        />
      </div>
    )
  }

  function tagBadges(wf: Workflow) {
    return (wf.tags ?? []).map(tag => (
      <TagBadge key={tag} tag={tag} color={tagDefs.find(d => d.name === tag)?.color}
        selected={selectedTag === tag} onSelect={() => setSelectedTag(selectedTag === tag ? null : tag)} />
    ))
  }

  function sortHeader(field: SortField, label: string, numeric = false, col?: ColumnKind) {
    const active = sortField === field
    return (
      <TH numeric={numeric} col={col ?? (numeric ? "number" : undefined)} aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
        <button
          type="button"
          onClick={() => toggleSort(field)}
          className={cn("inline-flex items-center gap-1 hover:text-fg", active && "text-fg")}
        >
          {label}
          {active && (sortDir === "asc" ? <ChevronUp size={12} aria-hidden="true" /> : <ChevronDown size={12} aria-hidden="true" />)}
        </button>
      </TH>
    )
  }

  const LIST_COLUMNS = 8

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search workflows, tags, triggers…"
          aria-label="Search workflows"
          wrapperClassName="min-w-[220px] max-w-[480px] flex-1"
        />

        <SegmentedControl
          aria-label="Status"
          value={selectedStatus}
          onValueChange={setSelectedStatus}
          options={[
            { value: "all", text: "All" },
            { value: "active", text: "Active" },
            { value: "inactive", text: "Inactive" },
          ]}
        />

        {triggerTypes.length > 1 && (
          <Select
            aria-label="Trigger"
            value={selectedTrigger ?? ""}
            onChange={e => setSelectedTrigger(e.target.value || null)}
            placeholder="All triggers"
            options={triggerTypes.map(t => ({ value: t, label: TRIGGER_LABELS[t] ?? t }))}
            wrapperClassName="w-auto max-w-[220px]"
          />
        )}

        {allTags.length > 0 && (
          <Popover
            aria-label="Filter by tag"
            width={320}
            trigger={(p) => (
              <Button variant="secondary" leadingIcon={<TagIcon />} trailingIcon={<ChevronDown />} {...p}>
                {selectedTag ? `Tag: ${selectedTag}` : "Tags"}
              </Button>
            )}
          >
            {(close) => (
              <TagFilterBar
                tags={allTags}
                tagDefinitions={tagDefs}
                selectedTag={selectedTag}
                onSelectTag={(tag) => { setSelectedTag(tag); close() }}
              />
            )}
          </Popover>
        )}

        {hasFilters && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}

        <div className="ml-auto flex items-center gap-2">
          <Select
            aria-label="Sort by"
            value={sortField}
            onChange={e => { const field = e.target.value as SortField; if (field !== sortField) toggleSort(field) }}
            options={SORT_OPTIONS}
            wrapperClassName="w-auto"
          />
          <IconButton
            variant="secondary"
            label={sortDir === "asc" ? "Ascending (switch to descending)" : "Descending (switch to ascending)"}
            icon={sortDir === "asc" ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
            onClick={() => toggleSort(sortField)}
          />
          <SegmentedControl
            aria-label="View"
            size="sm"
            value={viewMode}
            onValueChange={setViewMode}
            options={[
              { value: "cards", icon: <LayoutGrid />, label: "Card view" },
              { value: "list", icon: <List />, label: "List view" },
            ]}
          />
          <span className="num whitespace-nowrap text-xs text-fg-muted">
            {hasFilters
              ? `${formatCount(listPage.total)} of ${plural(facets.total, "workflow")}`
              : plural(listPage.total, "workflow")}
          </span>
        </div>
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-primary-wash px-3 py-2">
          <span className="num text-ui font-medium text-primary-text">{formatCount(selectedCount)} selected</span>
          <Button size="sm" variant="ghost" onClick={clearSelection}>Clear</Button>
          <Button size="sm" variant="secondary" onClick={handleBulkActivate} disabled={bulkLoading} leadingIcon={<Power />}>Activate</Button>
          <Button size="sm" variant="secondary" onClick={handleBulkDeactivate} disabled={bulkLoading} leadingIcon={<PowerOff />}>Deactivate</Button>
          <Button size="sm" variant="secondary" onClick={() => setShowBulkPermissions(true)} disabled={bulkLoading} leadingIcon={<Shield />}>Permissions</Button>
          <ExportAssetButton ids={[...selected]} name={plural(selectedCount, 'workflow')} />
          <div className="flex-1" />
          <Button size="sm" variant="danger" onClick={() => { setBulkDeleteNotice(null); setShowBulkDelete(true) }} disabled={bulkLoading} leadingIcon={<Trash2 />}>
            Delete {selectedCount}
          </Button>
        </div>
      ) : viewMode === "cards" && filtered.length > 0 ? (
        <Checkbox
          label={allFilteredSelected ? "Deselect all" : "Select all"}
          checked={allFilteredSelected}
          ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
          onChange={selectAll}
          className="text-xs text-fg-muted"
        />
      ) : null}

      {bulkDeleteNotice && (
        <InlineNotice
          tone={bulkDeleteNotice.tone}
          message={bulkDeleteNotice.message}
          onDismiss={() => setBulkDeleteNotice(null)}
        />
      )}

      {/* Workflow grid / list */}
      {loading && filtered.length === 0 ? (
        viewMode === "list" ? (
          <Table label="Workflows">
            <TBody><TableSkeleton columns={LIST_COLUMNS} /></TBody>
          </Table>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i} padding="md" className="space-y-3" aria-hidden="true">
                <Skeleton className="h-3 w-3/5" />
                <Skeleton className="h-2.5 w-2/5" />
                <Skeleton className="h-2.5 w-4/5" />
              </Card>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <Card padding="none">
          {hasFilters ? (
            <EmptyState
              size="sm"
              variant="no-results"
              title="No workflows match your filters"
              action={{ label: "Clear filters", onClick: clearFilters }}
            />
          ) : (
            <EmptyState
              icon={WorkflowIcon}
              title="No workflows yet"
              description="Workflows automate tasks with triggers, conditions and actions. Create one with New workflow."
            />
          )}
        </Card>
      ) : viewMode === "list" ? (
        /* ── List view ── */
        <Table label="Workflows" stickyFirstColumn stickyColumns={2}>
          <THead>
            <tr>
              <TH className="w-10">
                <Checkbox
                  aria-label="Select all"
                  checked={allFilteredSelected}
                  ref={el => { if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected }}
                  onChange={selectAll}
                />
              </TH>
              {sortHeader("name", "Name", false, "title")}
              {sortHeader("status", "Status", false, "status")}
              {sortHeader("trigger_type", "Trigger", false, "status")}
              {sortHeader("nodes", "Nodes", true)}
              {sortHeader("run_count", "Runs", true)}
              {sortHeader("updated_at", "Updated", false, "date")}
              <TH col="actions"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {filtered.map(wf => {
              const isSelected = selected.has(wf.id)
              const href = `/automations/${wf.id}`
              return [
                <TR key={wf.id} interactive selected={isSelected} onClick={() => router.push(href)}>
                  <TD onClick={e => e.stopPropagation()}>
                    <span className={cn("inline-flex transition-opacity", isSelected ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus-within:opacity-100")}>
                      <Checkbox aria-label={`Select ${wf.name}`} checked={isSelected} onChange={() => toggleSelect(wf.id)} />
                    </span>
                  </TD>
                  <TD className="w-[40%] max-w-0 py-1.5">
                    <Link href={href} onClick={e => e.stopPropagation()} className="block truncate font-medium text-fg hover:underline" title={wf.name}>
                      {wf.name}
                    </Link>
                    {(wf.tags ?? []).length > 0 && (
                      <div className="mt-0.5 flex flex-wrap gap-1" onClick={e => e.stopPropagation()}>{tagBadges(wf)}</div>
                    )}
                  </TD>
                  <TD><StatusPill status={wf.is_active ? "active" : "inactive"} /></TD>
                  <TD className="whitespace-nowrap"><TriggerTag trigger={wf.trigger_type} /></TD>
                  <TD numeric className="text-fg-muted">{formatCount(wf.node_count ?? 0)}</TD>
                  <TD numeric className="text-fg-muted">{formatCount(wf.run_count ?? 0)}</TD>
                  <TD className="whitespace-nowrap text-xs text-fg-muted"><RelativeDate value={wf.updated_at} /></TD>
                  <TDActions onClick={e => e.stopPropagation()}>
                    <RunWorkflowButton workflow={wf} canRun={canRun} onRun={setRunTarget} compact />
                    {workflowMenu(wf)}
                  </TDActions>
                </TR>,
                editingTagsId === wf.id && (
                  <tr key={`${wf.id}-tags`} className="border-b border-border-subtle bg-subtle">
                    <TableDetailCell colSpan={LIST_COLUMNS} className="px-[var(--theme-density-cell-x)] py-3">
                      <div className="max-w-md">{tagEditor(wf)}</div>
                    </TableDetailCell>
                  </tr>
                ),
              ]
            })}
          </TBody>
        </Table>
      ) : (
        /* ── Card view ── */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(wf => {
            const isSelected = selected.has(wf.id)
            return (
              <div key={wf.id} className="group relative">
                <Card
                  variant="interactive"
                  padding="md"
                  className={cn("relative flex h-full flex-col gap-2", isSelected && "border-primary hover:border-primary")}
                >
                  <div className="flex items-start gap-2">
                    <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold text-fg">
                      {/* Stretched link: the whole card opens the workflow; the controls sit above it. */}
                      <Link href={`/automations/${wf.id}`} className="after:absolute after:inset-0 after:rounded-lg">
                        {wf.name}
                      </Link>
                    </h3>
                    <StatusPill status={wf.is_active ? "active" : "inactive"} className="shrink-0" />
                  </div>

                  {(wf.tags ?? []).length > 0 && (
                    <div className="relative z-10 flex flex-wrap gap-1 self-start">{tagBadges(wf)}</div>
                  )}

                  <p className="num text-xs text-fg-muted">
                    {plural(wf.node_count ?? 0, "node")} · {plural(wf.run_count ?? 0, "run")}
                    {wf.last_run_at && (
                      <> · <span className="relative z-10"><RelativeDate value={wf.last_run_at} prefix="Last run " /></span></>
                    )}
                  </p>

                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <div className="min-w-0 flex-1"><TriggerTag trigger={wf.trigger_type} /></div>
                    <div className="relative z-10 -my-1 -mr-1 flex items-center gap-1">
                      <RunWorkflowButton workflow={wf} canRun={canRun} onRun={setRunTarget} compact />
                      {workflowMenu(wf)}
                    </div>
                  </div>
                </Card>

                {/* Select checkbox: on the card's corner on hover / focus, always while selected. */}
                <span
                  className={cn(
                    "absolute -left-1.5 -top-1.5 z-10 inline-flex rounded-sm bg-panel p-0.5 transition-opacity duration-[var(--ds-dur-fast)]",
                    isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                  )}
                >
                  <Checkbox aria-label={`Select ${wf.name}`} checked={isSelected} onChange={() => toggleSelect(wf.id)} />
                </span>

                {/* Inline tag editor */}
                {editingTagsId === wf.id && (
                  <div className={cn("absolute left-0 right-0 top-full z-20 mt-1 border border-border p-3", floatingSurfaceClass)}>
                    {tagEditor(wf)}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Pagination
        page={state.page}
        pageSize={state.size}
        total={listPage.total}
        onPageChange={(page) => update({ page })}
        onPageSizeChange={(size) => update({ size })}
        pageSizeOptions={WORKFLOW_PAGE_SIZES[viewMode]}
        pageSizeResetsPage={false}
        showPageNumbers
        noun={listPage.total === 1 ? "workflow" : "workflows"}
      />

      {/* Dependency map dialog */}
      <Dialog open={depsId !== null} onOpenChange={(open) => { if (!open) setDepsId(null) }}>
        <DialogContent
          size="md"
          title="Dependency map"
          description={<>Assets linked to <strong className="font-medium text-fg">{depsWorkflow?.name}</strong></>}
        >
          <DialogBody>
            <WorkflowDependencyMapView deps={deps} loading={depsLoading} />
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild><Button variant="secondary">Close</Button></DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormLinksDialog workflow={formLinkTarget} onOpenChange={(open) => { if (!open) setFormLinkTarget(null) }} />

      <ExportAssetDialog
        ids={exportTarget ? [exportTarget.id] : []}
        name={exportTarget?.name ?? ""}
        open={exportTarget !== null}
        onOpenChange={(open) => { if (!open) setExportTarget(null) }}
      />

      <RunWorkflowDialog
        workflow={runTarget}
        open={runTarget !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRunTarget(null)
            queryClient.invalidateQueries({ queryKey: ['workflows'] })
          }
        }}
      />

      <BulkPermissionsDialog
        open={showBulkPermissions}
        onOpenChange={setShowBulkPermissions}
        objectType="workflow"
        objectIds={[...selected]}
        showExecute={true}
      />

      <Dialog open={showBulkDelete} onOpenChange={(open) => { if (!bulkLoading) { setShowBulkDelete(open) } }}>
        <DialogContent size="sm" title={`Delete ${plural(selectedCount, 'workflow')}`}>
          <DialogBody className="space-y-2">
            <p>Queue deletion for {plural(selectedCount, 'selected workflow')}?</p>
            <p className="text-xs text-fg-muted">
              {selectedNames.slice(0, 5).join(', ')}{selectedNames.length > 5 ? ` and ${selectedNames.length - 5} more` : ''}
            </p>
            <p className="flex items-start gap-1.5 text-xs text-danger">
              <AlertTriangle size={14} className="mt-px shrink-0" aria-hidden="true" />
              The workflows will disappear now and the permanent cleanup will continue in the background.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => { setShowBulkDelete(false) }} disabled={bulkLoading}>Cancel</Button>
            <Button variant="danger" onClick={handleBulkDelete} loading={bulkLoading}>
              {bulkLoading ? 'Queueing…' : `Delete ${plural(selectedCount, 'workflow')}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
