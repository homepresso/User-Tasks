"use client"

import { useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import {
  TrendingUp, Play, Pause, Globe, Search, Tag, Map, Shield,
  SortAsc, SortDesc, Trash2, CheckSquare, Square, MinusSquare,
  Power, PowerOff, LayoutGrid, List, AlertTriangle,
} from "lucide-react"
import * as Dialog from '@radix-ui/react-dialog'
import { useWorkflowDependencies, WorkflowDependencyMapView, getWorkflowDependencyWarning } from './workflow-dependencies'
import { TagBadge, InlineTagEditor, TagFilterBar, type TagDefinition } from "@/components/ui/tag-manager"
import { formatRelativeDate, cn } from "@/lib/utils"
import { updateWorkflowTags } from "@/app/actions/automations"
import { runInlineJob, useJobs } from "@/components/jobs/jobs-provider"
import { createTagDefinition, updateTagDefinitionColor } from "@/app/actions/tags"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { useAppStore } from "@/stores/app-store"
import { BulkPermissionsDialog } from "@/components/governance/bulk-permissions-dialog"
import { InlineNotice } from "@/components/ui/inline-notice"
import { buildQueuedDeleteNotice, type DeleteNotice } from "@/lib/queued-delete-feedback"
import { usePermissions } from "@/lib/permissions-context"
import { RunWorkflowButton, RunWorkflowDialog, type RunnableWorkflow } from "./run-workflow-dialog"
import { WorkflowFormLinkButton } from "./workflow-form-links"
import { ExportAssetButton } from "@/components/shared/config-transfer"

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

const TRIGGER_LABELS: Record<string, string> = {
  task_created: "Task Created",
  task_received: "Task Received",
  task_submitted: "Task Submitted",
  task_updated: "Task Updated",
  data_table_event: "Data Table Event",
  form_submitted: "Form Submitted",
  middleware_received: "Middleware",
  task_completed: "Task Completed",
  task_rejected: "Task Rejected",
  workflow_error: "Error Handler",
  retention_policy_review: "Policy Review",
  retention_policy_executed: "Policy Executed",
  schedule: "Schedule",
  webhook_received: "Webhook",
}

type SortField = "name" | "updated_at" | "run_count" | "status" | "trigger_type" | "nodes"
type SortDir = "asc" | "desc"

export function WorkflowList({ workflows, initialTagDefs }: { workflows: Workflow[]; initialTagDefs: TagDefinition[] }) {
  const [localWorkflows, setLocalWorkflows] = useState<Workflow[]>(workflows)
  const [search, setSearch] = useState("")
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [selectedTrigger, setSelectedTrigger] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<"all" | "active" | "inactive">("all")
  const [sortField, setSortField] = useState<SortField>("updated_at")
  const [sortDir, setSortDir] = useState<SortDir>("desc")
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null)
  const [tagDefs, setTagDefs] = useState<TagDefinition[]>(initialTagDefs)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkLoading, setBulkLoading] = useState(false)
  const [showBulkDelete, setShowBulkDelete] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)
  const [showBulkPermissions, setShowBulkPermissions] = useState(false)
  const { layoutPreference, setLayoutPreference } = useAppStore()
  const viewMode = (layoutPreference.workflows === "list" ? "list" : "cards") as "cards" | "list"
  const setViewMode = (v: "cards" | "list") => setLayoutPreference("workflows", v)
  const [depsId, setDepsId] = useState<string | null>(null)
  const [runTarget, setRunTarget] = useState<RunnableWorkflow | null>(null)
  const { can } = usePermissions()
  const canRun = can('workflows.activate')
  const depsWorkflow = workflows.find(w => w.id === depsId)
  const { data: deps, isLoading: depsLoading } = useWorkflowDependencies(depsWorkflow?.id ?? '')
  const router = useRouter()
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

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    for (const wf of localWorkflows) {
      for (const tag of wf.tags ?? []) tagSet.add(tag)
    }
    return [...tagSet].sort()
  }, [localWorkflows])

  const triggerTypes = useMemo(() => {
    const set = new Set<string>()
    for (const wf of localWorkflows) set.add(wf.trigger_type)
    return [...set].sort()
  }, [localWorkflows])

  const filtered = useMemo(() => {
    let list = [...localWorkflows]
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(wf =>
        wf.name.toLowerCase().includes(q) ||
        (wf.tags ?? []).some(t => t.includes(q)) ||
        (TRIGGER_LABELS[wf.trigger_type] ?? wf.trigger_type).toLowerCase().includes(q)
      )
    }
    if (selectedTag) list = list.filter(wf => (wf.tags ?? []).includes(selectedTag))
    if (selectedTrigger) list = list.filter(wf => wf.trigger_type === selectedTrigger)
    if (selectedStatus === "active") list = list.filter(wf => wf.is_active)
    if (selectedStatus === "inactive") list = list.filter(wf => !wf.is_active)

    list.sort((a, b) => {
      let cmp = 0
      if (sortField === "name") cmp = a.name.localeCompare(b.name)
      else if (sortField === "updated_at") cmp = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()
      else if (sortField === "run_count") cmp = (a.run_count ?? 0) - (b.run_count ?? 0)
      else if (sortField === "status") cmp = (a.is_active ? 1 : 0) - (b.is_active ? 1 : 0)
      else if (sortField === "trigger_type") cmp = (TRIGGER_LABELS[a.trigger_type] ?? a.trigger_type).localeCompare(TRIGGER_LABELS[b.trigger_type] ?? b.trigger_type)
      else if (sortField === "nodes") cmp = (a.node_count ?? 0) - (b.node_count ?? 0)
      return sortDir === "desc" ? -cmp : cmp
    })
    return list
  }, [localWorkflows, search, selectedTag, selectedTrigger, selectedStatus, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === "asc" ? "desc" : "asc")
    else { setSortField(field); setSortDir("desc") }
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

  function toggleSelect(id: string, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
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

  return (
    <div className="space-y-4">
      {/* Search + Filters bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--theme-muted-text)" }} />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows, tags, triggers..."
            className="pl-9"
          />
        </div>

        {/* Status filter */}
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
          {(["all", "active", "inactive"] as const).map(s => (
            <button key={s} onClick={() => setSelectedStatus(s)}
              className="px-3 py-2 text-[10px] font-medium capitalize transition-colors"
              style={{
                backgroundColor: selectedStatus === s ? "var(--theme-primary)" : "var(--theme-card-bg)",
                color: selectedStatus === s ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
              }}>
              {s}
            </button>
          ))}
        </div>

        {/* Trigger filter */}
        {triggerTypes.length > 1 && (
          <select
            value={selectedTrigger ?? ""}
            onChange={e => setSelectedTrigger(e.target.value || null)}
            className="rounded-lg border px-2 py-2 text-[10px]"
            style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
          >
            <option value="">All Triggers</option>
            {triggerTypes.map(t => (
              <option key={t} value={t}>{TRIGGER_LABELS[t] ?? t}</option>
            ))}
          </select>
        )}

        {/* Sort */}
        <div className="flex items-center gap-1">
          {([
            { field: "updated_at" as SortField, label: "Updated" },
            { field: "name" as SortField, label: "Name" },
            { field: "run_count" as SortField, label: "Runs" },
          ]).map(({ field, label }) => (
            <button key={field} onClick={() => toggleSort(field)}
              className={cn("px-2 py-1.5 text-[10px] font-medium rounded transition-colors flex items-center gap-1")}
              style={{
                backgroundColor: sortField === field ? "var(--theme-primary-light)" : "transparent",
                color: sortField === field ? "var(--theme-primary-text)" : "var(--theme-muted-text)",
              }}
            >
              {label}
              {sortField === field && (sortDir === "desc" ? <SortDesc size={10} /> : <SortAsc size={10} />)}
            </button>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
          <button onClick={() => setViewMode("cards")}
            className="px-2 py-1.5 transition-colors"
            style={{
              backgroundColor: viewMode === "cards" ? "var(--theme-primary)" : "var(--theme-card-bg)",
              color: viewMode === "cards" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
            }}
            title="Card view"
          >
            <LayoutGrid size={13} />
          </button>
          <button onClick={() => setViewMode("list")}
            className="px-2 py-1.5 transition-colors"
            style={{
              backgroundColor: viewMode === "list" ? "var(--theme-primary)" : "var(--theme-card-bg)",
              color: viewMode === "list" ? 'var(--theme-on-primary)' : "var(--theme-muted-text)",
            }}
            title="List view"
          >
            <List size={13} />
          </button>
        </div>

        {hasFilters && (
          <button onClick={() => { setSearch(""); setSelectedTag(null); setSelectedTrigger(null); setSelectedStatus("all") }}
            className="text-[10px] px-2 py-1 rounded hover:opacity-70"
            style={{ color: "var(--theme-danger)" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Tag filter pills */}
      <TagFilterBar tags={allTags} tagDefinitions={tagDefs} selectedTag={selectedTag} onSelectTag={setSelectedTag} />

      {selectedCount > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border px-4 py-2" style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
          <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-text)' }}>{selectedCount} selected</span>
          <Button size="sm" variant="outline" onClick={clearSelection} className="!h-7 !text-xs">Clear</Button>
          <Button size="sm" variant="outline" onClick={handleBulkActivate} disabled={bulkLoading} className="!h-7 !text-xs">
            <Power size={12} className="mr-1" /> Activate
          </Button>
          <Button size="sm" variant="outline" onClick={handleBulkDeactivate} disabled={bulkLoading} className="!h-7 !text-xs">
            <PowerOff size={12} className="mr-1" /> Deactivate
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowBulkPermissions(true)} disabled={bulkLoading} className="!h-7 !text-xs">
            <Shield size={12} className="mr-1" /> Permissions
          </Button>
          <ExportAssetButton ids={[...selected]} name={`${selectedCount} workflow${selectedCount === 1 ? '' : 's'}`} className="!h-7 !text-xs" />
          <div className="flex-1" />
          <Button size="sm" onClick={() => { setBulkDeleteNotice(null); setShowBulkDelete(true) }} disabled={bulkLoading} className="!h-7 !text-xs !bg-red-600 hover:!bg-red-700 !text-white">
            <Trash2 size={12} className="mr-1" /> Delete {selectedCount}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {filtered.length > 0 && (
              <button
                onClick={selectAll}
                className="flex items-center gap-1.5 text-[10px] font-medium rounded px-2 py-1 transition-colors hover:opacity-80"
                style={{ color: "var(--theme-muted-text)" }}
                title={allFilteredSelected ? "Deselect all" : "Select all"}
              >
                {allFilteredSelected ? <CheckSquare size={14} /> : someFilteredSelected ? <MinusSquare size={14} /> : <Square size={14} />}
                {allFilteredSelected ? "Deselect all" : "Select all"}
              </button>
            )}

            <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
              {filtered.length} of {localWorkflows.length} workflow{localWorkflows.length !== 1 ? "s" : ""}
              {hasFilters && " (filtered)"}
            </p>
          </div>
        </div>
      )}

      {bulkDeleteNotice && (
        <InlineNotice
          tone={bulkDeleteNotice.tone}
          message={bulkDeleteNotice.message}
          onDismiss={() => setBulkDeleteNotice(null)}
        />
      )}

      {/* Workflow grid / list */}
      {filtered.length === 0 ? (
        <Card>
          <div className="text-center py-8">
            <TrendingUp size={32} className="mx-auto mb-2" style={{ color: "var(--theme-muted-text)" }} />
            <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>
              {localWorkflows.length === 0 ? "No workflows yet. Create one to get started." : "No workflows match your filters."}
            </p>
          </div>
        </Card>
      ) : viewMode === "list" ? (
        /* ── List View ── */
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
          {/* Header row */}
          <div
            className="grid items-center gap-3 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider select-none"
            style={{
              gridTemplateColumns: "28px 1fr 100px 120px 80px 60px 100px 104px",
              backgroundColor: "var(--theme-surface)",
              color: "var(--theme-muted-text)",
            }}
          >
            <button onClick={selectAll} className="flex items-center justify-center" title={allFilteredSelected ? "Deselect all" : "Select all"}>
              {allFilteredSelected ? <CheckSquare size={14} /> : someFilteredSelected ? <MinusSquare size={14} /> : <Square size={14} />}
            </button>
            {([
              { field: "name" as SortField, label: "Name" },
              { field: "status" as SortField, label: "Status" },
              { field: "trigger_type" as SortField, label: "Trigger" },
              { field: "nodes" as SortField, label: "Nodes" },
              { field: "run_count" as SortField, label: "Runs" },
              { field: "updated_at" as SortField, label: "Updated" },
            ]).map(({ field, label }) => (
              <button key={field} onClick={() => toggleSort(field)}
                className="flex items-center gap-1 hover:opacity-80 transition-opacity text-left"
                style={{ color: sortField === field ? "var(--theme-primary-text)" : undefined }}
              >
                {label}
                {sortField === field && (sortDir === "desc" ? <SortDesc size={10} /> : <SortAsc size={10} />)}
              </button>
            ))}
            <span />
          </div>

          {/* Rows */}
          {filtered.map(wf => {
            const isSelected = selected.has(wf.id)
            return (
              <div key={wf.id} className="relative group">
                <Link href={`/automations/${wf.id}`}>
                  <div
                    className="grid items-center gap-3 px-3 py-2.5 border-t transition-colors hover:opacity-80 cursor-pointer"
                    style={{
                      gridTemplateColumns: "28px 1fr 100px 120px 80px 60px 100px 104px",
                      borderColor: "var(--theme-surface-border)",
                      backgroundColor: isSelected ? "color-mix(in srgb, var(--theme-primary) 5%, var(--theme-card-bg))" : "var(--theme-card-bg)",
                    }}
                  >
                    {/* Checkbox */}
                    <button
                      onClick={(e) => toggleSelect(wf.id, e)}
                      className={cn(
                        "flex items-center justify-center transition-all",
                        isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-60",
                      )}
                      style={{ color: isSelected ? "var(--theme-primary-text)" : "var(--theme-muted-text)" }}
                    >
                      {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                    </button>

                    {/* Name + tags */}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate" style={{ color: "var(--theme-card-text)" }}>{wf.name}</p>
                      {(wf.tags ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {(wf.tags ?? []).map(tag => (
                            <TagBadge key={tag} tag={tag} color={tagDefs.find(d => d.name === tag)?.color}
                              selected={selectedTag === tag} onSelect={() => { setSelectedTag(selectedTag === tag ? null : tag) }} />
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Status */}
                    <span
                      className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full w-fit"
                      style={{
                        backgroundColor: wf.is_active ? 'color-mix(in srgb, var(--theme-success) 12%, transparent)' : 'var(--theme-surface)',
                        color: wf.is_active ? 'var(--theme-success)' : 'var(--theme-muted-text)',
                      }}
                    >
                      {wf.is_active ? <><Play size={8} /> Active</> : <><Pause size={8} /> Inactive</>}
                    </span>

                    {/* Trigger */}
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full w-fit"
                      style={{
                        backgroundColor: ["webhook_received", "middleware_received"].includes(wf.trigger_type) ? "var(--theme-primary-light)" : "var(--theme-surface)",
                        color: ["webhook_received", "middleware_received"].includes(wf.trigger_type) ? "var(--theme-primary-text)" : "var(--theme-muted-text)",
                      }}
                    >
                      {["webhook_received", "middleware_received"].includes(wf.trigger_type) && <Globe size={8} className="inline mr-0.5" />}
                      {TRIGGER_LABELS[wf.trigger_type] ?? wf.trigger_type}
                    </span>

                    {/* Nodes */}
                    <span className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                      {wf.node_count ?? 0}
                    </span>

                    {/* Runs */}
                    <span className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                      {wf.run_count ?? 0}
                    </span>

                    {/* Updated */}
                    <span className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                      {formatRelativeDate(wf.updated_at)}
                    </span>

                    {/* Actions */}
                    <div className="flex items-center justify-end gap-0.5">
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDepsId(wf.id) }}
                        className="p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        style={{ color: "var(--theme-muted-text)" }}
                        title="Dependency map"
                      >
                        <Map size={12} />
                      </button>
                      <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingTagsId(editingTagsId === wf.id ? null : wf.id) }}
                        className="p-1 rounded opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                        style={{ color: "var(--theme-muted-text)" }}
                        title="Edit tags"
                      >
                        <Tag size={12} />
                      </button>
                      <ExportAssetButton ids={[wf.id]} name={wf.name} iconOnly variant="ghost" className="!h-auto !p-1 opacity-0 group-hover:opacity-60 hover:!opacity-100" style={{ color: "var(--theme-muted-text)" }} />
                      {wf.trigger_type === "form_submitted" && <WorkflowFormLinkButton workflowId={wf.id} compact className="ml-1" />}
                      <RunWorkflowButton workflow={wf} canRun={canRun} onRun={setRunTarget} compact className="ml-1" />
                    </div>
                  </div>
                </Link>

                {/* Inline tag editor */}
                {editingTagsId === wf.id && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-lg border p-3 shadow-lg space-y-2"
                    style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-[10px] font-semibold" style={{ color: "var(--theme-muted-text)" }}>Tags</p>
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
                )}
              </div>
            )
          })}
        </div>
      ) : (
        /* ── Card View ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(wf => {
            const isSelected = selected.has(wf.id)
            return (
              <div key={wf.id} className="relative group">
                {/* Selection checkbox */}
                <button
                  onClick={(e) => toggleSelect(wf.id, e)}
                  className={cn(
                    "absolute top-2 left-2 z-10 p-0.5 rounded transition-all",
                    isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-60",
                  )}
                  style={{ color: isSelected ? "var(--theme-primary-text)" : "var(--theme-muted-text)" }}
                  title={isSelected ? "Deselect" : "Select"}
                >
                  {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>

                <Link href={`/automations/${wf.id}`}>
                  <Card
                    className={cn(
                      "hover:opacity-80 transition-all cursor-pointer h-full",
                      isSelected && "ring-2",
                    )}
                    style={isSelected ? { borderColor: "var(--theme-primary)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--theme-primary) 20%, transparent)" } : undefined}
                  >
                    <div className="flex items-start justify-between pl-5">
                      <h3 className="text-sm font-semibold pr-2">{wf.name}</h3>
                      <span
                        className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: wf.is_active ? 'color-mix(in srgb, var(--theme-success) 12%, transparent)' : 'var(--theme-surface)',
                          color: wf.is_active ? 'var(--theme-success)' : 'var(--theme-muted-text)',
                        }}
                      >
                        {wf.is_active ? <><Play size={8} /> Active</> : <><Pause size={8} /> Inactive</>}
                      </span>
                    </div>

                    {/* Trigger badge */}
                    <div className="flex items-center gap-2 mt-1 pl-5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                        style={{
                          backgroundColor: ["webhook_received", "middleware_received"].includes(wf.trigger_type) ? "var(--theme-primary-light)" : "var(--theme-surface)",
                          color: ["webhook_received", "middleware_received"].includes(wf.trigger_type) ? "var(--theme-primary-text)" : "var(--theme-muted-text)",
                        }}
                      >
                        {["webhook_received", "middleware_received"].includes(wf.trigger_type) && <Globe size={8} className="inline mr-0.5" />}
                        {TRIGGER_LABELS[wf.trigger_type] ?? wf.trigger_type}
                      </span>
                    </div>

                    {/* Tags */}
                    {(wf.tags ?? []).length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2 pl-5">
                        {(wf.tags ?? []).map(tag => (
                          <TagBadge key={tag} tag={tag} color={tagDefs.find(d => d.name === tag)?.color}
                            selected={selectedTag === tag} onSelect={() => setSelectedTag(selectedTag === tag ? null : tag)} />
                        ))}
                      </div>
                    )}

                    {/* Stats */}
                    <p className="text-xs mt-2 pl-5 pr-16" style={{ color: "var(--theme-muted-text)" }}>
                      {wf.node_count ?? 0} nodes · {wf.run_count ?? 0} runs
                      {wf.last_run_at && ` · Last: ${formatRelativeDate(wf.last_run_at)}`}
                    </p>
                  </Card>
                </Link>

                {/* Run button */}
                <div className="absolute bottom-3 right-3">
                  <div className="flex items-center gap-1">
                    {wf.trigger_type === "form_submitted" && <WorkflowFormLinkButton workflowId={wf.id} compact />}
                    <RunWorkflowButton workflow={wf} canRun={canRun} onRun={setRunTarget} compact />
                  </div>
                </div>

                {/* Map button */}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDepsId(wf.id) }}
                  className="absolute top-2 right-20 p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
                  title="Dependency map"
                >
                  <Map size={12} />
                </button>

                {/* Export button */}
                <div className="absolute top-2 right-28">
                  <ExportAssetButton ids={[wf.id]} name={wf.name} iconOnly variant="ghost" className="!h-auto !p-1 opacity-60 hover:opacity-100" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }} />
                </div>

                {/* Tag edit button (appears on hover) */}
                <button
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingTagsId(editingTagsId === wf.id ? null : wf.id) }}
                  className="absolute top-2 right-12 p-1 rounded opacity-60 hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
                  title="Edit tags"
                >
                  <Tag size={12} />
                </button>

                {/* Inline tag editor */}
                {editingTagsId === wf.id && (
                  <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border p-3 shadow-lg space-y-2"
                    style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
                    onClick={e => e.stopPropagation()}
                  >
                    <p className="text-[10px] font-semibold" style={{ color: "var(--theme-muted-text)" }}>Tags</p>
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
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Dependency Map Dialog */}
      <Dialog.Root open={depsId !== null} onOpenChange={(open) => { if (!open) setDepsId(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 dialog-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[min(28rem,92vw)] rounded-xl p-6 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <Dialog.Title className="text-lg font-semibold mb-1" style={{ color: 'var(--theme-card-text)' }}>
              <Map size={16} className="inline mr-2" style={{ color: 'var(--theme-primary-text)' }} />
              Dependency Map
            </Dialog.Title>
            <p className="text-xs mb-3" style={{ color: 'var(--theme-muted-text)' }}>
              Assets linked to <strong>{depsWorkflow?.name}</strong>
            </p>
            <WorkflowDependencyMapView deps={deps} loading={depsLoading} />
            <div className="flex justify-end mt-4">
              <Dialog.Close asChild><Button variant="outline" size="sm">Close</Button></Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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

      <Dialog.Root open={showBulkDelete} onOpenChange={(open) => { if (!bulkLoading) { setShowBulkDelete(open) } }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(24rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-xl p-6 shadow-xl dialog-content" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
            <Dialog.Title className="text-lg font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>Delete {selectedCount} Workflow{selectedCount !== 1 ? 's' : ''}</Dialog.Title>
            <p className="text-sm mb-1" style={{ color: 'var(--theme-muted-text)' }}>
              Queue deletion for {selectedCount} selected workflow{selectedCount !== 1 ? 's' : ''}?
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--theme-muted-text)' }}>
              {selectedNames.slice(0, 5).join(', ')}{selectedNames.length > 5 ? ` and ${selectedNames.length - 5} more` : ''}
            </p>
            <p className="text-xs mb-4" style={{ color: 'var(--theme-danger, #DC2626)' }}>
              <AlertTriangle size={11} className="inline mr-1" /> The workflows will disappear now and the permanent cleanup will continue in the background.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => { setShowBulkDelete(false) }} disabled={bulkLoading}>Cancel</Button>
              <Button size="sm" onClick={handleBulkDelete} disabled={bulkLoading} className="!bg-red-600 hover:!bg-red-700 !text-white">
                {bulkLoading ? 'Queueing...' : 'Delete'}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
