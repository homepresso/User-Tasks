'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useQueryClient } from '@tanstack/react-query'
import { BadgeCheck, Blocks, Code2, FileDown, FileUp, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Puzzle, Search, Settings2, Trash2, Upload } from 'lucide-react'
import { ActionManageDialog } from './action-manage-dialog'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Card } from '@/components/ui/card'
import { Badge, StatusPill, Tag } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Table, THead, TBody, TR, TH, TD, TDActions } from '@/components/ui/table'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { bulkDeleteWithJob, useJobs } from '@/components/jobs/jobs-provider'
import {
  deleteWorkflowActivity,
  exportWorkflowActivity,
  importWorkflowActivity,
  saveWorkflowActivity,
  uploadWorkflowAction,
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
  // ?q= (header search box) filters the list.
  const searchParams = useSearchParams()
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  useEffect(() => { const q = searchParams.get('q'); if (q !== null) setSearch(q) }, [searchParams])
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  // Synchronous guard: two clicks in one frame both see saving === false.
  const saveGuard = useSubmitGuard()
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const [layout, setLayout] = useState<'grid' | 'list'>('grid')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusFilter, setStatusFilter] = useState<'all' | WorkflowActivityStatus>('all')
  const [sortBy, setSortBy] = useState<'updated' | 'name' | 'key'>('updated')
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteNotice, setBulkDeleteNotice] = useState<DeleteNotice | null>(null)
  const [manageId, setManageId] = useState<string | null>(() => searchParams.get('action'))
  const [uploadNotice, setUploadNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)

  async function handleUpload(files: FileList | null) {
    const list = Array.from(files ?? [])
    const pkg = list.find((f) => /\.(zip|m?js)$/i.test(f.name))
    if (!pkg) return
    const form = new FormData()
    form.set('file', pkg)
    const manifest = list.find((f) => /manifest\.json$/i.test(f.name))
    if (manifest) form.set('manifest', manifest)
    setUploading(true)
    const res = await uploadWorkflowAction(form)
    setUploading(false)
    if (uploadRef.current) uploadRef.current.value = ''
    if (!res.ok) { setUploadNotice({ kind: 'error', text: res.error }); return }
    const { workflow_activity: saved, outcome, version, warnings } = res.data
    setUploadNotice({ kind: 'ok', text: `${outcome === 'created' ? 'Added' : outcome === 'unchanged' ? 'Already installed:' : 'Added version'} ${saved.name} ${version}${warnings.length ? ` — ${warnings.join('; ')}` : ''}` })
    setLocalItems((prev) => [saved, ...prev.filter((item) => item.id !== saved.id)])
    await queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })
    if (outcome === 'created') setManageId(saved.id)
  }

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
    await saveGuard.run(async () => {
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
    })
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
      const res = await deleteWorkflowActivity(currentDeleteId)
      if (!res.ok) throw new Error(res.error)
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
    await saveGuard.run(async () => {
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
    })
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

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selected.has(item.id))
  const someVisibleSelected = filtered.some((item) => selected.has(item.id)) && !allVisibleSelected
  const canManage = can('extensibility.create') || can('extensibility.edit')

  // The action's own colour (user-chosen data) tints its icon tile.
  const tint = (color: string | null | undefined) => {
    const c = color || 'var(--theme-chart-3)'
    return { backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`, color: c }
  }

  const rowActions = (item: any) => (
    <>
      {can('extensibility.view') && <IconButton size="sm" label={`Manage ${item.name}`} icon={<Settings2 />} onClick={() => setManageId(item.id)} />}
      {can('extensibility.view') && <IconButton size="sm" label="Export" icon={<FileDown />} onClick={() => handleExport(item)} disabled={exportingId === item.id} />}
      {can('extensibility.edit') && item.runtime !== 'module' && <IconButton size="sm" label="Edit" icon={<Pencil />} onClick={() => setEditor(toEditorState(item))} />}
      {can('extensibility.delete') && <IconButton size="sm" variant="danger-ghost" label="Delete" icon={<Trash2 />} onClick={() => setDeleteId(item.id)} />}
    </>
  )

  const revealClass = 'transition-opacity opacity-0 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-[240px] flex-1 text-sm text-fg-muted">
          Custom workflow steps with typed inputs and outputs. They run in a WebAssembly sandbox with only the hosts, tables and secrets you approve.
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canManage && (
            <>
              <input ref={uploadRef} type="file" accept=".zip,.js,.mjs,.json" multiple className="hidden" aria-hidden="true" tabIndex={-1} onChange={(e) => void handleUpload(e.target.files)} data-testid="action-upload-input" />
              <Button variant="secondary" size="sm" leadingIcon={<Upload />} disabled={uploading} loading={uploading} onClick={() => uploadRef.current?.click()}>Upload action</Button>
            </>
          )}
          {can('extensibility.create') && <ImportConfigButton label="Import file" onImported={() => void queryClient.invalidateQueries({ queryKey: ['custom-workflow-activities'] })} />}
          {can('extensibility.create') && <Button size="sm" leadingIcon={<Plus />} onClick={() => setEditor(createEmptyState())}>New script activity</Button>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton variant="secondary" size="sm" label="More actions" icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {can('packages.install') && (
                <DropdownMenuItem asChild>
                  <a href="/packages?gallery=workflow-actions" data-testid="actions-browse-gallery"><LayoutGrid className="size-4 text-fg-muted" aria-hidden="true" />Browse gallery</a>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem asChild>
                <a href="/downloads/action-starter.zip" download><FileDown className="size-4 text-fg-muted" aria-hidden="true" />Starter kit</a>
              </DropdownMenuItem>
              {can('extensibility.create') && <DropdownMenuItem icon={<FileUp />} onSelect={() => setImportOpen(true)}>Import from JSON…</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {uploadNotice && <InlineNotice tone={uploadNotice.kind === 'ok' ? 'success' : 'error'} message={uploadNotice.text} onDismiss={() => setUploadNotice(null)} />}

      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search actions by name, key, description, or tags…"
          aria-label="Search workflow actions"
          leading={<Search />}
          className="min-w-[220px] flex-1"
        />
        <Select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as 'all' | WorkflowActivityStatus)}
          aria-label="Filter by status"
          wrapperClassName="w-auto min-w-[140px]"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </Select>
        <Select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value as 'updated' | 'name' | 'key')}
          aria-label="Sort by"
          wrapperClassName="w-auto min-w-[160px]"
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name A–Z</option>
          <option value="key">Key A–Z</option>
        </Select>
        <SegmentedControl
          aria-label="Layout"
          size="sm"
          value={layout}
          onValueChange={setLayout}
          options={[
            { value: 'grid', icon: <Blocks />, text: 'Grid' },
            { value: 'list', icon: <List />, text: 'List' },
          ]}
        />
      </div>

      <div className="flex min-h-7 items-center gap-3">
        <Checkbox
          label="Select all"
          checked={allVisibleSelected}
          ref={(el) => {
            if (el) el.indeterminate = someVisibleSelected
          }}
          onChange={toggleSelectAllVisible}
        />
        <span className="num text-xs text-fg-muted">{plural(filtered.length, 'action')}</span>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg bg-primary-wash px-4 py-2">
          <span className="num text-ui font-medium text-primary-text">{formatCount(selected.size)} selected</span>
          <Button size="sm" variant="link" onClick={() => setSelected(new Set())}>Clear</Button>
          <div className="flex-1" />
          {can('extensibility.delete') && (
            <Button size="sm" variant="danger" leadingIcon={<Trash2 />} onClick={() => setBulkDeleteOpen(true)}>
              Delete {selected.size}
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

      {filtered.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={Puzzle}
            title="No custom workflow activities yet"
            description="Start with one reusable code step, publish it as active, and it will become available in the workflow palette."
          />
        </Card>
      ) : layout === 'grid' ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
            const isSelected = selected.has(item.id)
            const operations: { id: string; label?: string }[] = Array.isArray(item.manifest?.operations) ? item.manifest.operations : []
            return (
              <Card
                key={item.id}
                padding="md"
                data-selected={isSelected || undefined}
                className={cn('group/card space-y-3 transition-colors hover:border-border-strong', isSelected && 'border-primary bg-primary-wash')}
              >
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <span className={cn('inline-flex size-8 items-center justify-center rounded-md', isSelected ? 'opacity-0' : 'group-hover/card:opacity-0 group-focus-within/card:opacity-0')} style={tint(item.color)} aria-hidden="true">
                      <Puzzle size={16} />
                    </span>
                    <span className={cn('absolute inset-0 flex items-center justify-center', !isSelected && 'opacity-0 group-hover/card:opacity-100 group-focus-within/card:opacity-100 [@media(pointer:coarse)]:opacity-100')}>
                      <Checkbox checked={isSelected} onChange={() => toggleSelect(item.id)} aria-label={`Select ${item.name}`} />
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-fg">{item.runtime === 'module' ? item.name : displayName}</p>
                    <p className="truncate font-mono text-2xs text-fg-muted">{item.key} · v{item.version}</p>
                  </div>
                  <div className="flex shrink-0 items-center">{rowActions(item)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <StatusPill status={item.status} />
                  {item.enabled === false && <Badge tone="warning">Disabled</Badge>}
                  {item.signature?.verified && <Badge tone="success"><BadgeCheck size={12} aria-hidden="true" className="-ml-0.5 mr-1 inline" />{item.signature.via === 'package' ? 'Signed package' : 'Signed'}</Badge>}
                  {item.runtime === 'module' && Array.isArray(item.manifest?.operations) && <Tag>{plural(item.manifest.operations.length, 'function')}</Tag>}
                </div>
                <p className="line-clamp-3 text-xs text-fg-muted">
                  {presentation.purpose || summary || item.description || 'No description yet.'}
                </p>
                {item.runtime === 'module' ? (
                  <div className="flex flex-wrap gap-1">
                    {operations.slice(0, 6).map((op) => (
                      <Tag key={op.id}>{op.label ?? op.id}</Tag>
                    ))}
                    {operations.length > 6 && <span className="px-1 text-xs text-fg-muted">+{operations.length - 6} more</span>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    <Tag>{plural(manifest.inputs.length, 'input')}</Tag>
                    <Tag>{plural(manifest.outputs.length, 'output')}</Tag>
                    <Tag mono>{item.version ?? '1.0.0'}</Tag>
                    <Badge tone={readiness.ready ? 'success' : 'warning'}>{readiness.score}/5 ready</Badge>
                    {presentation.recommendedFor && <Tag>{presentation.recommendedFor}</Tag>}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      ) : (
        <Table label="Custom actions" stickyFirstColumn stickyColumns={2}>
          <THead>
            <tr>
              <TH className="w-10"><span className="sr-only">Select</span></TH>
              <TH col="title">Action</TH>
              <TH col="status" className="w-28">Status</TH>
              <TH numeric col="number" className="w-24">Readiness</TH>
              <TH col="actions"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {filtered.map((item) => {
              const manifest = normalizeWorkflowActivityManifest(item.manifest ?? {})
              const displayName = getWorkflowActivityDisplayName(item.manifest ?? {}, item.name) ?? item.name
              const summary = getWorkflowActivitySummary(item.manifest ?? {})
              const readiness = getWorkflowActivityReadiness({
                manifest: item.manifest ?? {},
                name: item.name,
                key: item.key,
              })
              const isSelected = selected.has(item.id)
              return (
                <TR key={item.id} selected={isSelected}>
                  <TD className="w-10">
                    <Checkbox
                      checked={isSelected}
                      onChange={() => toggleSelect(item.id)}
                      aria-label={`Select ${item.name}`}
                      className={cn(!isSelected && cn(revealClass, 'group-hover/row:opacity-100'))}
                    />
                  </TD>
                  <TD className="max-w-0 py-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md" style={tint(item.color)} aria-hidden="true">
                        <Code2 size={14} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-fg" title={displayName}>{displayName}</p>
                        <p className="truncate text-xs text-fg-muted">{summary || `${item.key} · ${plural(manifest.inputs.length, 'input')} · ${plural(manifest.outputs.length, 'output')}`}</p>
                      </div>
                    </div>
                  </TD>
                  <TD><StatusPill status={item.status} /></TD>
                  <TD numeric>
                    <Badge tone={readiness.ready ? 'success' : 'warning'} className="num">{readiness.score}/5</Badge>
                  </TD>
                  <TDActions>{rowActions(item)}</TDActions>
                </TR>
              )
            })}
          </TBody>
        </Table>
      )}

      <ActionManageDialog activityId={manageId} canEdit={can('extensibility.edit')} onClose={() => {
        setManageId(null)
        if (searchParams.get('action')) {
          const url = new URL(window.location.href)
          url.searchParams.delete('action')
          window.history.replaceState(null, '', url)
        }
      }} />

      <Dialog open={!!editor} onOpenChange={(open) => !open && !saving && setEditor(null)}>
        <DialogContent
          size="xl"
          title={editor?.id ? 'Edit workflow activity' : 'Create workflow activity'}
          description="Write code that returns output values from mapped workflow inputs. The workflow engine executes this code as a reusable custom activity."
          className="max-h-[90vh]"
        >
          {editor && (
            <>
              <DialogBody className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Name">
                    <Input value={editor.name} onChange={(event) => setEditor((state) => state ? { ...state, name: event.target.value } : state)} />
                  </Field>
                  <Field label="Key">
                    <Input value={editor.key} onChange={(event) => setEditor((state) => state ? { ...state, key: event.target.value } : state)} placeholder="customer_score_card" className="font-mono" />
                  </Field>
                </div>

                <Field label="Description">
                  <Textarea value={editor.description} onChange={(event) => setEditor((state) => state ? { ...state, description: event.target.value } : state)} rows={3} />
                </Field>

                <Card variant="inset" padding="md" className="space-y-4">
                  <div>
                    <p className="text-base font-semibold text-fg">Friendly presentation</p>
                    <p className="mt-1 text-xs text-fg-muted">
                      These fields shape how the activity appears to non-technical workflow designers across Extensibility, the workflow picker, and the node configuration panel.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Display name">
                      <Input value={editor.displayName} onChange={(event) => setEditor((state) => state ? { ...state, displayName: event.target.value } : state)} placeholder="Score customer risk" />
                    </Field>
                    <Field label="Recommended for">
                      <Input value={editor.recommendedFor} onChange={(event) => setEditor((state) => state ? { ...state, recommendedFor: event.target.value } : state)} placeholder="Operations managers, HR coordinators" />
                    </Field>
                  </div>

                  <Field label="One-line purpose">
                    <Input value={editor.purpose} onChange={(event) => setEditor((state) => state ? { ...state, purpose: event.target.value } : state)} placeholder="Turn raw inputs into a friendly workflow decision or result." />
                  </Field>

                  <Field label="Summary shown in workflow">
                    <Textarea value={editor.summaryText} onChange={(event) => setEditor((state) => state ? { ...state, summaryText: event.target.value } : state)} rows={2} />
                  </Field>

                  <Field label="Setup notes" description="Enter one note per line. These appear in simple mode to guide first-time workflow designers.">
                    <Textarea value={editor.setupNotesText} onChange={(event) => setEditor((state) => state ? { ...state, setupNotesText: event.target.value } : state)} rows={4} />
                  </Field>

                  {editorQuality && (
                    <div className="space-y-3 border-t border-border-subtle pt-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-fg">Designer readiness</p>
                          <p className="mt-1 text-xs text-fg-muted">
                            Helpful nudges to make this activity easier for non-technical workflow designers to understand.
                          </p>
                        </div>
                        <Badge tone={editorQuality.score >= 4 ? 'success' : 'warning'} className="num">
                          {editorQuality.score}/5 ready
                        </Badge>
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
                    <div className="space-y-3 border-t border-border-subtle pt-4">
                      <div>
                        <p className="text-sm font-semibold text-fg">Live designer preview</p>
                        <p className="mt-1 text-xs text-fg-muted">
                          This is how the activity will read to workflow designers in the picker, on the canvas, and in simple mode.
                        </p>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-3">
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-fg-muted">Palette</p>
                          <div className="rounded-md border border-border bg-panel px-3 py-2">
                            <div className="flex items-start gap-2">
                              <div className="shrink-0 rounded-md p-1.5" style={tint(editor.color)}>
                                <Puzzle size={12} />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-fg">{editorPreview.displayName}</p>
                                <p className="line-clamp-3 text-2xs leading-tight text-fg-muted">
                                  {editorPreview.presentation.purpose || editorPreview.summary || editor.description || 'No helper text yet.'}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-medium text-fg-muted">Canvas node</p>
                          <div className="overflow-hidden rounded-lg border border-border bg-panel">
                            <div
                              className="flex items-center gap-2 px-3 py-2"
                              style={{
                                background: `linear-gradient(135deg, ${editor.color || 'var(--theme-chart-3)'}, color-mix(in srgb, ${editor.color || 'var(--theme-chart-3)'} 87%, transparent))`,
                                color: 'white',
                              }}
                            >
                              <Puzzle size={14} />
                              <span className="truncate text-xs font-medium">{editorPreview.displayName}</span>
                            </div>
                            <div className="space-y-1.5 px-3 py-2.5">
                              <p className="text-2xs text-fg-muted">
                                {editor.description || editorPreview.summary || 'No activity description yet.'}
                              </p>
                              <p className="font-mono text-2xs leading-tight text-fg">
                                {editorPreview.summary}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <p className="text-xs font-medium text-fg-muted">Simple mode</p>
                          <div className="space-y-2 rounded-md border border-border bg-panel p-3">
                            <p className="text-xs font-semibold text-fg">{editorPreview.displayName} · Simple mode</p>
                            <p className="text-2xs text-fg-muted">
                              {editorPreview.summary}
                            </p>
                            {editorPreview.presentation.recommendedFor && (
                              <p className="text-2xs text-fg-muted">
                                Recommended for: <span className="text-fg">{editorPreview.presentation.recommendedFor}</span>
                              </p>
                            )}
                            {editorPreview.presentation.setupNotes.length > 0 ? (
                              <div className="space-y-1">
                                {editorPreview.presentation.setupNotes.slice(0, 2).map((note: string, index: number) => (
                                  <p key={`preview-note-${index}`} className="text-2xs text-fg-muted">
                                    {index + 1}. {note}
                                  </p>
                                ))}
                              </div>
                            ) : (
                              <p className="text-2xs text-fg-muted">
                                Add setup notes to guide first-time designers here.
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>

                <div className="grid gap-4 md:grid-cols-4">
                  <Field label="Status">
                    <Select value={editor.status} onChange={(event) => setEditor((state) => state ? { ...state, status: event.target.value as WorkflowActivityStatus } : state)}>
                      <option value="draft">Draft</option>
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                    </Select>
                  </Field>
                  <Field label="Version">
                    <Input value={editor.version} onChange={(event) => setEditor((state) => state ? { ...state, version: event.target.value } : state)} className="font-mono" />
                  </Field>
                  <Field label="Icon name">
                    <Input value={editor.iconName} onChange={(event) => setEditor((state) => state ? { ...state, iconName: event.target.value } : state)} />
                  </Field>
                  <Field label="Colour">
                    <Input value={editor.color} onChange={(event) => setEditor((state) => state ? { ...state, color: event.target.value } : state)} className="font-mono" />
                  </Field>
                </div>

                <Field
                  label="Source code"
                  description={<>Available runtime variables: <code className="font-mono">inputs</code>, <code className="font-mono">context</code>, <code className="font-mono">helpers</code>. Return either <code className="font-mono">{'{ outputs: { ... } }'}</code> or a plain object of output values.</>}
                >
                  <Textarea value={editor.sourceCode} onChange={(event) => setEditor((state) => state ? { ...state, sourceCode: event.target.value } : state)} rows={16} className="font-mono text-xs" />
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Manifest">
                    <Textarea value={editor.manifestText} onChange={(event) => setEditor((state) => state ? { ...state, manifestText: event.target.value } : state)} rows={12} className="font-mono text-xs" />
                  </Field>
                  <Field label="Demo inputs">
                    <Textarea value={editor.demoInputsText} onChange={(event) => setEditor((state) => state ? { ...state, demoInputsText: event.target.value } : state)} rows={12} className="font-mono text-xs" />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Tags">
                    <Input value={editor.tagsText} onChange={(event) => setEditor((state) => state ? { ...state, tagsText: event.target.value } : state)} placeholder="scoring, enrichment, custom" />
                  </Field>
                  <Field label="Source filename">
                    <Input value={editor.sourceFilename} onChange={(event) => setEditor((state) => state ? { ...state, sourceFilename: event.target.value } : state)} />
                  </Field>
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="secondary" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
                <Button onClick={handleSave} disabled={saving} loading={saving}>{editor.id ? 'Save changes' : 'Create activity'}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={(open) => !importing && setImportOpen(open)}>
        <DialogContent size="lg" title="Import workflow activity" description="Paste a workflow activity export JSON to recreate it in this tenant.">
          <DialogBody>
            <Textarea value={importText} onChange={(event) => setImportText(event.target.value)} rows={16} aria-label="Workflow activity JSON" className="bg-subtle font-mono text-xs" />
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setImportOpen(false)} disabled={importing}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing || !importText.trim()} loading={importing}>Import activity</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => { if (!open) setDeleteId(null) }}
        title="Delete workflow activity"
        description="This will remove the activity from Extensibility. Existing workflow nodes that reference it will need to be reconfigured."
        confirmLabel="Delete"
        destructive
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Delete ${plural(selected.size, 'workflow activity', 'workflow activities')}`}
        description={`This will remove ${plural(selected.size, 'selected workflow activity', 'selected workflow activities')} from Extensibility.`}
        confirmLabel={`Delete ${selected.size}`}
        destructive
        onConfirm={handleBulkDelete}
      />
    </div>
  )
}
