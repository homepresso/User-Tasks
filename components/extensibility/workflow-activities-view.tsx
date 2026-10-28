'use client'

import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useQueryClient } from '@tanstack/react-query'
import { Blocks, Check, ChevronDown, ChevronUp, Code2, FileDown, FileUp, List, Pencil, Plus, Puzzle, Search, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import {
  deleteWorkflowActivity,
  exportWorkflowActivity,
  importWorkflowActivity,
  saveWorkflowActivity,
} from '@/app/actions/extensibility'
import {
  getWorkflowActivityDisplayName,
  getWorkflowActivityPresentation,
  getWorkflowActivityReadiness,
  getWorkflowActivitySummary,
  normalizeWorkflowActivityManifest,
  safeParseJson,
  type WorkflowActivitySourceKind,
  type WorkflowActivityStatus,
} from '@/lib/extensibility'
import { usePermissions } from '@/lib/permissions-context'
import { InlineNotice } from '@/components/ui/inline-notice'
import { buildQueuedDeleteNotice, type DeleteNotice } from '@/lib/queued-delete-feedback'
import { ImportConfigButton } from '@/components/shared/config-transfer'

interface WorkflowActivitiesViewProps {
  items: any[]
}

type EditorState = {
  id?: string
  name: string
  description: string
  key: string
  status: WorkflowActivityStatus
  sourceKind: WorkflowActivitySourceKind
  version: string
  iconName: string
  color: string
  sourceCode: string
  displayName: string
  purpose: string
  recommendedFor: string
  summaryText: string
  setupNotesText: string
  manifestText: string
  demoInputsText: string
  tagsText: string
  sourceFilename: string
}

function createEmptyState(): EditorState {
  return {
    name: '',
    description: '',
    key: '',
    status: 'active',
    sourceKind: 'inline',
    version: '1.0.0',
    iconName: 'Puzzle',
    color: '#0EA5E9',
    displayName: '',
    purpose: 'Use this step when you want to turn a score into friendly labels that can be reused later in the workflow.',
    recommendedFor: 'Workflow designers who want reusable scoring logic without rewriting it in every flow.',
    summaryText: 'Takes a score and returns a score band and label for later workflow steps.',
    setupNotesText: 'Map the score value from an earlier form, rule, or data step.\nUse the returned score band and label in messages, conditions, or updates.',
    sourceCode: `const score = Number(inputs.score ?? 0)\nconst band = score >= 80 ? 'green' : score >= 50 ? 'amber' : 'red'\nreturn {\n  outputs: {\n    score_band: band,\n    score_label: \`Score is \${score}\`,\n  },\n}`,
    manifestText: '{\n  "inputs": [\n    {\n      "name": "score",\n      "label": "Score",\n      "type": "number",\n      "required": true\n    }\n  ],\n  "outputs": [\n    {\n      "name": "score_band",\n      "label": "Score Band",\n      "type": "string"\n    },\n    {\n      "name": "score_label",\n      "label": "Score Label",\n      "type": "string"\n    }\n  ]\n}',
    demoInputsText: '{\n  "score": 72\n}',
    tagsText: '',
    sourceFilename: '',
  }
}

function parseTags(value: string) {
  return value.split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean)
}

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function toEditorState(item: any): EditorState {
  const presentation = getWorkflowActivityPresentation(item.manifest ?? {})
  return {
    id: item.id,
    name: item.name ?? '',
    description: item.description ?? '',
    key: item.key ?? '',
    status: item.status ?? 'active',
    sourceKind: item.source_kind ?? 'inline',
    version: item.version ?? '1.0.0',
    iconName: item.icon_name ?? 'Puzzle',
    color: item.color ?? '#0EA5E9',
    displayName: presentation.displayName ?? '',
    purpose: presentation.purpose ?? '',
    recommendedFor: presentation.recommendedFor ?? '',
    summaryText: presentation.summary ?? '',
    setupNotesText: presentation.setupNotes.join('\n'),
    sourceCode: item.source_code ?? '',
    manifestText: JSON.stringify(item.manifest ?? { inputs: [], outputs: [] }, null, 2),
    demoInputsText: JSON.stringify(item.demo_inputs ?? {}, null, 2),
    tagsText: Array.isArray(item.tags) ? item.tags.join(', ') : '',
    sourceFilename: item.source_filename ?? '',
  }
}

function buildWorkflowActivityManifestFromEditor(editor: EditorState) {
  const parsed = safeParseJson(editor.manifestText, { inputs: [], outputs: [] })
  const setupNotes = editor.setupNotesText
    .split('\n')
    .map((note) => note.trim())
    .filter(Boolean)
  return normalizeWorkflowActivityManifest({
    ...parsed,
    display_name: editor.displayName,
    purpose: editor.purpose,
    recommended_for: editor.recommendedFor,
    summary: editor.summaryText,
    setup_notes: setupNotes,
  })
}

export function WorkflowActivitiesView({ items }: WorkflowActivitiesViewProps) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const jobs = useJobs()
  const [localItems, setLocalItems] = useState<any[]>(items)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<'all' | WorkflowActivityStatus>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'key'>('updated')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)

  useEffect(() => {
    setSelected(new Set())
  }, [localItems, search, layout, statusFilter, sortBy])

  useEffect(() => {
    setLocalItems(items)
  }, [items])

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return localItems
      .filter((item) => {
        if (statusFilter !== 'all' && item.status !== statusFilter) return false
        if (!needle) return true
        return [item.name, item.description, item.key, ...(item.tags ?? [])]
          .some((value) => String(value ?? '').toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        if (sortBy === 'name') return String(a.name ?? '').localeCompare(String(b.name ?? ''))
        if (sortBy === 'key') return String(a.key ?? '').localeCompare(String(b.key ?? ''))
        return new Date(b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.updated_at ?? a.created_at ?? 0).getTime()
      })
  }, [localItems, search, sortBy, statusFilter])

  const editorPreview = useMemo(() => {
    if (!editor) return null
    const manifest = buildWorkflowActivityManifestFromEditor(editor)
    const presentation = getWorkflowActivityPresentation(manifest)
    const displayName = getWorkflowActivityDisplayName(manifest, editor.name || 'Untitled activity') ?? (editor.name || 'Untitled activity')
    const summary = getWorkflowActivitySummary(manifest)
    return {
      manifest,
      presentation,
      displayName,
      summary,
    }
  }, [editor])

  const editorQuality = useMemo(() => {
    if (!editor || !editorPreview) return null
    return getWorkflowActivityReadiness({
      manifest: editorPreview.manifest,
      name: editor.name,
      key: editor.key,
    })
  }, [editor, editorPreview])

  async function handleSave() {
    if (!editor) return
    setSaving(true)
    try {
      await saveWorkflowActivity({
        id: editor.id,
        name: editor.name,
        description: editor.description,
        key: editor.key,
        status: editor.status,
        sourceKind: editor.sourceKind,
        version: editor.version,
        iconName: editor.iconName,
        color: editor.color,
        sourceCode: editor.sourceCode,
        manifest: buildWorkflowActivityManifestFromEditor(editor),
        demoInputs: safeParseJson(editor.demoInputsText, {}),
        tags: parseTags(editor.tagsText),
        sourceFilename: editor.sourceFilename,
      })
      await queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })
      setEditor(null)
    } catch (error: any) {
      alert(error?.message ?? 'Failed to save workflow activity')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    const currentDeleteId = deleteId
    const previousItems = localItems
    try {
      setLocalItems((prev) => prev.filter((item) => item.id !== currentDeleteId))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(currentDeleteId)
        return next
      })
      setDeleteId(null)
      await deleteWorkflowActivity(currentDeleteId)
      await queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })
    } catch (error: any) {
      setLocalItems(previousItems)
      alert(error?.message ?? 'Failed to delete workflow activity')
    }
  }

  async function handleExport(item: any) {
    setExportingId(item.id)
    try {
      const payload = await exportWorkflowActivity(item.id)
      downloadJson(`${item.key || item.name || 'workflow-activity'}.json`, payload)
    } catch (error: any) {
      alert(error?.message ?? 'Failed to export workflow activity')
    } finally {
      setExportingId(null)
    }
  }

  async function handleImport() {
    setImporting(true)
    try {
      await importWorkflowActivity(importText)
      await queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })
      setImportText('')
      setImportOpen(false)
    } catch (error: any) {
      alert(error?.message ?? 'Failed to import workflow activity')
    } finally {
      setImporting(false)
    }
  }

  async function handleBulkDelete() {
    const ids = [...selected]
    if (ids.length === 0) return
    const previousItems = localItems
    try {
      setBulkDeleteNotice(null)
      setBulkDeleteOpen(false)
      setLocalItems((prev) => prev.filter((item) => !selected.has(item.id)))
      setSelected(new Set())
      const result = await bulkDeleteWithJob(jobs, 'workflow_activity', ids, () => queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] }))
      if (!result.background) setBulkDeleteNotice(buildQueuedDeleteNotice({
        queued: result.queued,
        total: ids.length,
        singular: 'workflow activity',
        plural: 'workflow activities',
      }))
    } catch (error: any) {
      setLocalItems(previousItems)
      setSelected(new Set(ids))
      setBulkDeleteNotice({ tone: 'error', message: error?.message ?? 'Failed to delete selected workflow activities' })
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

  function toggleSelectAllVisible() {
    const visibleIds = filtered.map((item) => item.id)
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const id of visibleIds) next.delete(id)
      } else {
        for (const id of visibleIds) next.add(id)
      }
      return next
    })
  }

  const SortIcon = ({ field }: { field: 'updated' | 'name' | 'key' }) => {
    if (sortBy !== field || field === 'updated') return null
    return <Check size={10} />
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="rounded-xl p-2" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)', color: 'var(--theme-primary-text)' }}>
              <Puzzle size={16} />
            </div>
            <div>
              <p className="text-sm font-semibold">Custom Workflow Activities</p>
              <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
                Upload or paste code-backed workflow steps with typed inputs and outputs that appear like native activities in the builder.
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => setLayout('grid')} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: layout === 'grid' ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)', color: layout === 'grid' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
              <Blocks size={12} className="inline mr-1" /> Grid
            </button>
            <button type="button" onClick={() => setLayout('list')} className="rounded-lg border px-2 py-1 text-xs" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: layout === 'list' ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)', color: layout === 'list' ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
              <List size={12} className="inline mr-1" /> List
            </button>
            <Button asChild variant="outline" size="sm">
              <a href="/downloads/workflow-activity-template.zip" download>
                <FileDown size={14} className="mr-1" />
                Sample Zip
              </a>
            </Button>
            {can('extensibility.create') && <Button variant="outline" size="sm" onClick={() => setImportOpen(true)} title="Paste an activity JSON export"><FileUp size={14} className="mr-1" />Import</Button>}
            {can('extensibility.create') && <ImportConfigButton label="Import file" onImported={() => void queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })} />}
            {can('extensibility.create') && <Button size="sm" onClick={() => setEditor(createEmptyState())}><Plus size={14} className="mr-1" />New Activity</Button>}
          </div>
        </div>

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activities by name, key, description, or tags..." className="pl-9" />
        </div>

        {selected.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg border px-4 py-2" style={{ backgroundColor: 'var(--theme-primary-light)', borderColor: 'var(--theme-primary)' }}>
            <span className="text-sm font-medium" style={{ color: 'var(--theme-primary-text)' }}>{selected.size} selected</span>
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} className="!h-7 !text-xs">Clear</Button>
            <div className="flex-1" />
            {can('extensibility.delete') && (
              <Button size="sm" onClick={() => setBulkDeleteOpen(true)} className="!h-7 !text-xs !bg-red-600 hover:!bg-red-700 !text-white">
                <Trash2 size={12} className="mr-1" /> Delete {selected.size}
              </Button>
            )}
          </div>
        )}

        {bulkDeleteNotice && (
          <InlineNotice
            tone={bulkDeleteNotice.tone}
            message={bulkDeleteNotice.message}
            onDismiss={() => setBulkDeleteNotice(null)}
          />
        )}

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <input
              type="checkbox"
              checked={filtered.length > 0 && filtered.every((item) => selected.has(item.id))}
              ref={(el) => {
                if (el) el.indeterminate = filtered.some((item) => selected.has(item.id)) && !filtered.every((item) => selected.has(item.id))
              }}
              onChange={toggleSelectAllVisible}
              className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
            />
            Select all
          </label>

          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as 'all' | WorkflowActivityStatus)}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>

          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as 'updated' | 'name' | 'key')}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="updated">Recently updated</option>
            <option value="name">Name A-Z</option>
            <option value="key">Key A-Z</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border p-8 text-center" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <Puzzle size={18} className="mx-auto mb-3" style={{ color: 'var(--theme-muted-text)' }} />
          <p className="text-sm font-medium">No custom workflow activities yet</p>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Start with one reusable code step, publish it as active, and it will become available in the workflow palette.
          </p>
        </div>
      ) : layout === 'grid' ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((item) => {
            const manifest = normalizeWorkflowActivityManifest(item.manifest ?? {})
            const displayName = getWorkflowActivityDisplayName(item.manifest ?? {}, item.name) ?? item.name
            const summary = getWorkflowActivitySummary(item.manifest ?? {})
            const presentation = getWorkflowActivityPresentation(item.manifest ?? {})
            const readiness = getWorkflowActivityReadiness({
              manifest: item.manifest ?? {},
              name: item.name,
              key: item.key,
            })
            return (
              <div key={item.id} className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[10px] font-semibold" style={{ backgroundColor: `${item.color ?? '#0EA5E9'}18`, color: item.color ?? '#0EA5E9' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="h-3.5 w-3.5 rounded border-gray-300 accent-[color:var(--theme-primary)]"
                      />
                      <Puzzle size={11} />
                      {item.status}
                    </div>
                    <p className="mt-2 text-sm font-semibold truncate">{displayName}</p>
                    <p className="text-[11px] font-mono" style={{ color: 'var(--theme-muted-text)' }}>{item.key}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {can('extensibility.view') && <Button variant="ghost" size="sm" onClick={() => handleExport(item)} disabled={exportingId === item.id} className="!h-7 !px-2"><FileDown size={12} /></Button>}
                    {can('extensibility.edit') && <Button variant="ghost" size="sm" onClick={() => setEditor(toEditorState(item))} className="!h-7 !px-2"><Pencil size={12} /></Button>}
                    {can('extensibility.delete') && <Button variant="ghost" size="sm" onClick={() => setDeleteId(item.id)} className="!h-7 !px-2 !text-red-500"><Trash2 size={12} /></Button>}
                  </div>
                </div>
                <p className="text-xs line-clamp-3" style={{ color: 'var(--theme-muted-text)' }}>
                  {presentation.purpose || summary || item.description || 'No description yet.'}
                </p>
                <div className="flex flex-wrap gap-2 text-[10px]">
                  <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{manifest.inputs.length} inputs</span>
                  <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{manifest.outputs.length} outputs</span>
                  <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>{item.version ?? '1.0.0'}</span>
                  <span
                    className="rounded-full px-2 py-1"
                    style={{
                      backgroundColor: readiness.ready ? 'rgba(34, 197, 94, 0.12)' : 'rgba(249, 115, 22, 0.12)',
                      color: readiness.ready ? '#15803D' : '#C2410C',
                    }}
                  >
                    {readiness.score}/5 ready
                  </span>
                  {presentation.recommendedFor && (
                    <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                      {presentation.recommendedFor}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          {filtered.map((item, index) => {
            const manifest = normalizeWorkflowActivityManifest(item.manifest ?? {})
            const displayName = getWorkflowActivityDisplayName(item.manifest ?? {}, item.name) ?? item.name
            const summary = getWorkflowActivitySummary(item.manifest ?? {})
            const readiness = getWorkflowActivityReadiness({
              manifest: item.manifest ?? {},
              name: item.name,
              key: item.key,
            })
            return (
              <div key={item.id} className="flex items-center gap-3 px-4 py-3" style={{ borderTop: index === 0 ? 'none' : '1px solid var(--theme-surface-border)' }}>
                <input
                  type="checkbox"
                  checked={selected.has(item.id)}
                  onChange={() => toggleSelect(item.id)}
                  className="h-4 w-4 rounded border-gray-300 accent-[color:var(--theme-primary)]"
                />
                <div className="rounded-xl p-2" style={{ backgroundColor: `${item.color ?? '#0EA5E9'}18`, color: item.color ?? '#0EA5E9' }}>
                  <Code2 size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{displayName}</p>
                  <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>{summary || `${item.key} · ${manifest.inputs.length} inputs · ${manifest.outputs.length} outputs`}</p>
                </div>
                <span
                  className="rounded-full px-2 py-1 text-[10px] font-semibold"
                  style={{
                    backgroundColor: readiness.ready ? 'rgba(34, 197, 94, 0.12)' : 'rgba(249, 115, 22, 0.12)',
                    color: readiness.ready ? '#15803D' : '#C2410C',
                  }}
                >
                  {readiness.score}/5
                </span>
                <div className="flex items-center gap-1">
                  {can('extensibility.view') && <Button variant="ghost" size="sm" onClick={() => handleExport(item)} disabled={exportingId === item.id} className="!h-7 !px-2"><FileDown size={12} /></Button>}
                  {can('extensibility.edit') && <Button variant="ghost" size="sm" onClick={() => setEditor(toEditorState(item))} className="!h-7 !px-2"><Pencil size={12} /></Button>}
                  {can('extensibility.delete') && <Button variant="ghost" size="sm" onClick={() => setDeleteId(item.id)} className="!h-7 !px-2 !text-red-500"><Trash2 size={12} /></Button>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Dialog.Root open={!!editor} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(980px,92vw)] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border p-5 shadow-2xl" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            {editor && (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <Dialog.Title className="text-lg font-semibold">{editor.id ? 'Edit Workflow Activity' : 'Create Workflow Activity'}</Dialog.Title>
                    <Dialog.Description className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                      Write code that returns output values from mapped workflow inputs. The workflow engine executes this code as a reusable custom activity.
                    </Dialog.Description>
                  </div>
                  <Dialog.Close asChild>
                    <button type="button" className="rounded-lg p-2 hover:opacity-80"><X size={16} /></button>
                  </Dialog.Close>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Name</label>
                    <Input value={editor.name} onChange={(event) => setEditor((state) => state ? { ...state, name: event.target.value } : state)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Key</label>
                    <Input value={editor.key} onChange={(event) => setEditor((state) => state ? { ...state, key: event.target.value } : state)} placeholder="customer_score_card" className="font-mono" />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium">Description</label>
                  <textarea value={editor.description} onChange={(event) => setEditor((state) => state ? { ...state, description: event.target.value } : state)} rows={3} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
                </div>

                <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                  <div>
                    <p className="text-sm font-semibold">Friendly Presentation</p>
                    <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                      These fields shape how the activity appears to non-technical workflow designers across Extensibility, the workflow picker, and the node configuration panel.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Display Name</label>
                      <Input value={editor.displayName} onChange={(event) => setEditor((state) => state ? { ...state, displayName: event.target.value } : state)} placeholder="Score Customer Risk" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-medium">Recommended For</label>
                      <Input value={editor.recommendedFor} onChange={(event) => setEditor((state) => state ? { ...state, recommendedFor: event.target.value } : state)} placeholder="Operations managers, HR coordinators" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium">One-Line Purpose</label>
                    <Input value={editor.purpose} onChange={(event) => setEditor((state) => state ? { ...state, purpose: event.target.value } : state)} placeholder="Turn raw inputs into a friendly workflow decision or result." />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium">Summary Shown In Workflow</label>
                    <textarea value={editor.summaryText} onChange={(event) => setEditor((state) => state ? { ...state, summaryText: event.target.value } : state)} rows={2} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium">Setup Notes</label>
                    <textarea value={editor.setupNotesText} onChange={(event) => setEditor((state) => state ? { ...state, setupNotesText: event.target.value } : state)} rows={4} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
                    <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      Enter one note per line. These appear in simple mode to guide first-time workflow designers.
                    </p>
                  </div>

                  {editorQuality && (
                    <div className="rounded-2xl border p-4 space-y-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Designer Readiness</p>
                          <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                            Helpful nudges to make this activity easier for non-technical workflow designers to understand.
                          </p>
                        </div>
                        <span
                          className="rounded-full px-2.5 py-1 text-[10px] font-semibold"
                          style={{
                            backgroundColor: editorQuality.score >= 4 ? 'rgba(34, 197, 94, 0.12)' : 'rgba(249, 115, 22, 0.12)',
                            color: editorQuality.score >= 4 ? '#15803D' : '#C2410C',
                          }}
                        >
                          {editorQuality.score}/5 ready
                        </span>
                      </div>

                      {editorQuality.findings.length === 0 ? (
                        <InlineNotice tone="success" message="This activity is reading clearly for designers. The friendly metadata is in strong shape." />
                      ) : (
                        <div className="space-y-2">
                          {editorQuality.findings.map((finding, index) => (
                            <InlineNotice key={`quality-${index}`} tone={finding.severity === 'warning' ? 'warning' : 'warning'} message={finding.message} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {editorPreview && (
                    <div className="rounded-2xl border p-4 space-y-4" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                      <div>
                        <p className="text-sm font-semibold">Live Designer Preview</p>
                        <p className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                          This is how the activity will read to workflow designers in the picker, on the canvas, and in simple mode.
                        </p>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Palette</p>
                          <div className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                            <div className="flex items-start gap-2">
                              <div className="rounded-md p-1.5 shrink-0" style={{ backgroundColor: `${editor.color || '#0EA5E9'}18`, color: editor.color || '#0EA5E9' }}>
                                <Puzzle size={12} />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-medium truncate">{editorPreview.displayName}</p>
                                <p className="text-[10px] leading-tight line-clamp-3" style={{ color: 'var(--theme-muted-text)' }}>
                                  {editorPreview.presentation.purpose || editorPreview.summary || editor.description || 'No helper text yet.'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Canvas Node</p>
                          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                            <div className="flex items-center gap-2 px-3 py-2 text-white" style={{ background: `linear-gradient(135deg, ${editor.color || '#0EA5E9'}, ${(editor.color || '#0EA5E9')}DD)` }}>
                              <Puzzle size={13} />
                              <span className="text-xs font-medium truncate">{editorPreview.displayName}</span>
                            </div>
                            <div className="px-3 py-2.5 space-y-1.5">
                              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                {editor.description || editorPreview.summary || 'No activity description yet.'}
                              </p>
                              <p className="text-[9px] font-mono leading-tight" style={{ color: 'var(--theme-card-text)', opacity: 0.85 }}>
                                {editorPreview.summary}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Simple Mode</p>
                          <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                            <p className="text-xs font-semibold">{editorPreview.displayName} · Simple Mode</p>
                            <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                              {editorPreview.summary}
                            </p>
                            {editorPreview.presentation.recommendedFor && (
                              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                Recommended for: <span style={{ color: 'var(--theme-card-text)' }}>{editorPreview.presentation.recommendedFor}</span>
                              </p>
                            )}
                            {editorPreview.presentation.setupNotes.length > 0 ? (
                              <div className="space-y-1">
                                {editorPreview.presentation.setupNotes.slice(0, 2).map((note: string, index: number) => (
                                  <p key={`preview-note-${index}`} className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                    {index + 1}. {note}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                                Add setup notes to guide first-time designers here.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Status</label>
                    <select value={editor.status} onChange={(event) => setEditor((state) => state ? { ...state, status: event.target.value as WorkflowActivityStatus } : state)} className="w-full rounded-xl border px-3 py-2 text-sm" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}>
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Version</label>
                    <Input value={editor.version} onChange={(event) => setEditor((state) => state ? { ...state, version: event.target.value } : state)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Icon Name</label>
                    <Input value={editor.iconName} onChange={(event) => setEditor((state) => state ? { ...state, iconName: event.target.value } : state)} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Color</label>
                    <Input value={editor.color} onChange={(event) => setEditor((state) => state ? { ...state, color: event.target.value } : state)} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium">Source Code</label>
                  <textarea value={editor.sourceCode} onChange={(event) => setEditor((state) => state ? { ...state, sourceCode: event.target.value } : state)} rows={16} className="w-full rounded-xl border px-3 py-2 text-xs font-mono" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
                  <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    Available runtime variables: <code>inputs</code>, <code>context</code>, <code>helpers</code>. Return either <code>{'{ outputs: { ... } }'}</code> or a plain object of output values.
                  </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Manifest</label>
                    <textarea value={editor.manifestText} onChange={(event) => setEditor((state) => state ? { ...state, manifestText: event.target.value } : state)} rows={12} className="w-full rounded-xl border px-3 py-2 text-xs font-mono" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Demo Inputs</label>
                    <textarea value={editor.demoInputsText} onChange={(event) => setEditor((state) => state ? { ...state, demoInputsText: event.target.value } : state)} rows={12} className="w-full rounded-xl border px-3 py-2 text-xs font-mono" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Tags</label>
                    <Input value={editor.tagsText} onChange={(event) => setEditor((state) => state ? { ...state, tagsText: event.target.value } : state)} placeholder="scoring, enrichment, custom" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-medium">Source Filename</label>
                    <Input value={editor.sourceFilename} onChange={(event) => setEditor((state) => state ? { ...state, sourceFilename: event.target.value } : state)} />
                  </div>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
                  <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editor.id ? 'Save Changes' : 'Create Activity'}</Button>
                </div>
              </div>
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={importOpen} onOpenChange={(open) => !importing && setImportOpen(open)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(720px,92vw)] max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-2xl border p-5 shadow-2xl" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Dialog.Title className="text-lg font-semibold">Import Workflow Activity</Dialog.Title>
                  <Dialog.Description className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                    Paste a workflow activity export JSON to recreate it in this tenant.
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild>
                  <button type="button" className="rounded-lg p-2 hover:opacity-80"><X size={16} /></button>
                </Dialog.Close>
              </div>
              <textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={16} className="w-full rounded-xl border px-3 py-2 text-xs font-mono" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setImportOpen(false)} disabled={importing}>Cancel</Button>
                <Button onClick={handleImport} disabled={importing || !importText.trim()}>{importing ? 'Importing...' : 'Import Activity'}</Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="space-y-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">Delete Workflow Activity</Dialog.Title>
                <Dialog.Description className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                  This will remove the activity from Extensibility. Existing workflow nodes that reference it will need to be reconfigured.
                </Dialog.Description>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
                <Button variant="destructive" onClick={handleDelete}>Delete</Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(420px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-5 shadow-2xl" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
            <div className="space-y-4">
              <div>
                <Dialog.Title className="text-lg font-semibold">Delete Workflow Activities</Dialog.Title>
                <Dialog.Description className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                  This will remove {selected.size} selected workflow activit{selected.size === 1 ? 'y' : 'ies'} from Extensibility.
                </Dialog.Description>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setBulkDeleteOpen(false)}>Cancel</Button>
                <Button variant="destructive" onClick={handleBulkDelete}>Delete {selected.size}</Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
