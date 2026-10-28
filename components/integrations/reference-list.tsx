'use client'

import { useEffect, useState } from 'react'
import { createReference } from '@/app/actions/integration-references'
import { ReferenceBuilder } from './reference-builder'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, ChevronDown, ChevronRight, Bookmark, Play, Loader2, X, Trash2, Map as MapIcon } from 'lucide-react'
import { useReferenceDependencies, AssetDependencyDialog } from '@/components/shared/asset-dependencies'
import { deleteReference } from '@/app/actions/integration-references'
import { bulkDeleteWithJob, runInlineJob, useJobs } from '@/components/jobs/jobs-provider'
import { InlineNotice } from '@/components/ui/inline-notice'
import { buildQueuedDeleteNotice, type DeleteNotice } from '@/lib/queued-delete-feedback'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const DB_ICON_MAP: Record<string, { label: string; color: string; bg: string }> = {
  mssql: { label: 'SQL', color: '#CC2927', bg: '#CC292715' },
  postgres: { label: 'PG', color: '#336791', bg: '#33679115' },
  postgresql: { label: 'PG', color: '#336791', bg: '#33679115' },
  mysql: { label: 'MY', color: '#4479A1', bg: '#4479A115' },
  oracle: { label: 'OR', color: '#F80000', bg: '#F8000015' },
  mongodb: { label: 'MG', color: '#47A248', bg: '#47A24815' },
  snowflake: { label: 'SF', color: '#29B5E8', bg: '#29B5E815' },
}

function getDefaultIconForUrl(baseUrl: string): string | null {
  for (const key of Object.keys(DB_ICON_MAP)) {
    if (baseUrl.startsWith(`${key}://`)) return key
  }
  return null
}
import { useRouter } from 'next/navigation'
import { resolveStorageUrl } from "@/lib/storage/refs"

interface Reference {
  id: string
  name: string
  description: string | null
  inputs: any
  outputs: any
  request_config: any
  integration_id?: string
}

interface ReferenceListProps {
  integrationId: string
  integrationBaseUrl: string
  references: Reference[]
}

export function ReferenceList({ integrationId, integrationBaseUrl, references }: ReferenceListProps) {
  const [localReferences, setLocalReferences] = useState(references)
  const [adding, setAdding] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [refDepsId, setRefDepsId] = useState<string | null>(null)
  const refDepsRef = references.find(r => r.id === refDepsId)
  const { data: refDeps, isLoading: refDepsLoading } = useReferenceDependencies(refDepsId ?? '')
  const [testingRef, setTestingRef] = useState<string | null>(null)
  const [testInputs, setTestInputs] = useState<Record<string, string>>({})
  const [testResult, setTestResult] = useState<any>(null)
  const [testLoading, setTestLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkTagInput, setBulkTagInput] = useState('')
  const [deleteNotice, setDeleteNotice] = useState<DeleteNotice | null>(null)
  const [confirmState, setConfirmState] = useState<null | { title: string; description: string; action: () => Promise<void> | void }>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const router = useRouter()
  const jobs = useJobs()

  useEffect(() => {
    setLocalReferences(references)
  }, [references])

  const allSelected = localReferences.length > 0 && localReferences.every(r => selected.has(r.id))

  function toggleSelect(id: string) {
    setSelected(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set())
    else setSelected(new Set(localReferences.map(r => r.id)))
  }

  async function bulkDelete() {
    setConfirmState({
      title: 'Delete References',
      description: `Delete ${selected.size} reference${selected.size !== 1 ? 's' : ''}? This cannot be undone.`,
      action: async () => {
        setBulkDeleting(true)
        const ids = Array.from(selected)
        const previous = localReferences
        setLocalReferences((current) => current.filter((ref) => !ids.includes(ref.id)))
        setSelected(new Set())
        try {
          const result = await bulkDeleteWithJob(jobs, 'reference', ids, () => router.refresh())
          if (!result.background) setDeleteNotice(buildQueuedDeleteNotice({
            queued: result.queued,
            total: ids.length,
            singular: 'reference',
            plural: 'references',
          }))
          router.refresh()
        } catch (error) {
          setLocalReferences(previous)
          setSelected(new Set(ids))
          setDeleteNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to delete selected references' })
          throw error
        } finally {
          setBulkDeleting(false)
        }
      },
    })
  }

  async function bulkAddTag() {
    const tag = bulkTagInput.trim().toLowerCase()
    if (!tag) return
    const outcome = await runInlineJob(jobs, 'references.add_tag', { ids: [...selected], tag }, { onSuccess: () => router.refresh() })
    if (outcome.status === 'failed') {
      setDeleteNotice({ tone: 'error', message: outcome.error })
      return
    }
    setBulkTagInput('')
    setSelected(new Set())
    router.refresh()
  }

  function openTest(ref: Reference) {
    const defaults: Record<string, string> = {}
    for (const inp of (ref.inputs as any[] ?? [])) {
      defaults[inp.name] = inp.default_value ?? ''
    }
    setTestInputs(defaults)
    setTestResult(null)
    setTestingRef(ref.id)
  }

  async function runTest(ref: Reference) {
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
      const result = await resp.json()
      setTestResult(result)
    } catch (e: any) {
      setTestResult({ error: e.message })
    }
    setTestLoading(false)
  }

  async function handleDelete(refId: string, refName: string) {
    setConfirmState({
      title: 'Delete Reference',
      description: `Delete reference "${refName}"? This cannot be undone.`,
      action: async () => {
        const previous = localReferences
        setLocalReferences((current) => current.filter((ref) => ref.id !== refId))
        try {
          await deleteReference(refId)
          setDeleteNotice({ tone: 'success', message: `Reference "${refName}" deleted.` })
          router.refresh()
        } catch (error) {
          setLocalReferences(previous)
          setDeleteNotice({ tone: 'error', message: error instanceof Error ? error.message : `Failed to delete reference "${refName}"` })
          throw error
        }
      },
    })
  }

  async function handleAdd(formData: FormData) {
    formData.set('integration_id', integrationId)
    await createReference(formData)
    setAdding(false)
    router.refresh()
  }

  return (
    <div className="space-y-2">
      {deleteNotice && (
        <InlineNotice
          tone={deleteNotice.tone}
          message={deleteNotice.message}
          onDismiss={() => setDeleteNotice(null)}
        />
      )}

      <ConfirmDialog
        open={Boolean(confirmState)}
        onOpenChange={(open) => { if (!open && !confirmBusy) setConfirmState(null) }}
        title={confirmState?.title ?? 'Confirm'}
        description={confirmState?.description ?? ''}
        confirmLabel="Delete"
        destructive
        busy={confirmBusy}
        onConfirm={async () => {
          if (!confirmState) return
          setConfirmBusy(true)
          try {
            await confirmState.action()
            setConfirmState(null)
          } catch {}
          finally {
            setConfirmBusy(false)
          }
        }}
      />

      {/* Bulk actions bar */}
      {localReferences.length > 0 && (
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
          <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
          </span>
          {selected.size > 0 && (
            <>
              <div className="flex-1" />
              {/* Bulk tag */}
              <div className="flex items-center gap-1">
                <input value={bulkTagInput} onChange={e => setBulkTagInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') bulkAddTag() }}
                  placeholder="Add tag..."
                  className="rounded border px-2 py-0.5 text-[10px] w-24"
                  style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }} />
                <button onClick={bulkAddTag} disabled={!bulkTagInput.trim()}
                  className="text-[10px] font-medium px-2 py-0.5 rounded hover:opacity-70 disabled:opacity-30"
                  style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                  Tag
                </button>
              </div>
              {/* Bulk delete */}
              <button onClick={bulkDelete} disabled={bulkDeleting}
                className="text-[10px] font-medium px-2 py-0.5 rounded hover:opacity-70 flex items-center gap-1"
                style={{ backgroundColor: 'var(--status-danger-bg)', color: 'var(--theme-danger)' }}>
                <Trash2 size={10} /> {bulkDeleting ? 'Deleting...' : `Delete (${selected.size})`}
              </button>
              <button onClick={() => setSelected(new Set())} className="text-[10px] hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {localReferences.map((ref) => {
        const rc = ref.request_config as any
        const sql = (rc?.path_template ?? '').trim()
        const method = (rc?.method ?? '').toUpperCase()
        const refIcon = resolveStorageUrl(rc?.icon_url) || getDefaultIconForUrl(integrationBaseUrl)
        const dbType = method === 'EXEC' || /^\s*EXEC\b/i.test(sql) ? 'procedure'
          : /^\s*(SELECT|INSERT|UPDATE|DELETE)\b/i.test(sql) ? 'table'
          : null
        const badgeConfig: Record<string, { label: string; color: string; bg: string }> = {
          procedure: { label: 'Stored Proc', color: 'var(--theme-chart-6-text)', bg: 'color-mix(in srgb, var(--theme-chart-6) 10%, transparent)' },
          table: { label: 'Table', color: 'var(--theme-chart-3-text)', bg: 'color-mix(in srgb, var(--theme-chart-3) 10%, transparent)' },
        }
        const badge = dbType ? badgeConfig[dbType] : null

        return (
        <div key={ref.id} className="rounded-lg border" style={{
          borderColor: selected.has(ref.id) ? 'var(--theme-primary)' : 'var(--theme-surface-border)',
          backgroundColor: selected.has(ref.id) ? 'var(--theme-primary-light)' : undefined,
        }}>
          <div className="flex items-center gap-2 px-3 py-2.5 text-sm">
            <input type="checkbox" checked={selected.has(ref.id)} onChange={() => toggleSelect(ref.id)}
              onClick={e => e.stopPropagation()} className="rounded shrink-0" />
            <button
              className="flex items-center gap-2 flex-1 text-left"
              onClick={() => setExpandedId(expandedId === ref.id ? null : ref.id)}
            >
              {expandedId === ref.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              {rc?.icon_url ? (
                <img src={resolveStorageUrl(rc.icon_url)} alt="" className="w-5 h-5 rounded object-contain shrink-0" />
              ) : refIcon && DB_ICON_MAP[refIcon] ? (
                <span className="w-5 h-5 rounded flex items-center justify-center text-[7px] font-bold shrink-0"
                  style={{ backgroundColor: DB_ICON_MAP[refIcon].bg, color: DB_ICON_MAP[refIcon].color }}>
                  {DB_ICON_MAP[refIcon].label}
                </span>
              ) : (
                <Bookmark size={14} style={{ color: 'var(--theme-primary-text)' }} />
              )}
              <span className="font-medium flex-1">{ref.name}</span>
              {badge && (
                <span className="text-[8px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                  style={{ backgroundColor: badge.bg, color: badge.color }}>
                  {badge.label}
                </span>
              )}
              <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                {(ref.inputs as any[])?.length ?? 0} in · {(ref.outputs as any[])?.length ?? 0} out
              </span>
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); openTest(ref) }}
              className="p-1.5 rounded-lg hover:opacity-80 transition-colors shrink-0"
              style={{ color: 'var(--theme-primary-text)', backgroundColor: 'var(--theme-primary-light)' }}
              title="Test reference"
            >
              <Play size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setRefDepsId(ref.id) }}
              className="p-1.5 rounded-lg hover:opacity-80 transition-colors shrink-0"
              style={{ color: 'var(--theme-muted-text)' }}
              title="Dependency map"
            >
              <MapIcon size={12} />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(ref.id, ref.name) }}
              className="p-1.5 rounded-lg hover:opacity-80 transition-colors shrink-0 hover:text-[color:var(--theme-danger)]"
              style={{ color: 'var(--theme-muted-text)' }}
              title="Delete reference"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {expandedId === ref.id && (
            <div className="px-3 pb-3" style={{ borderTop: '1px solid var(--theme-surface-border)' }}>
              <ReferenceBuilder reference={{ ...ref, integration_id: integrationId }} integrationBaseUrl={integrationBaseUrl} />
            </div>
          )}
        </div>
        )
      })}

      {/* Quick Test Dialog */}
      {testingRef && (() => {
        const ref = localReferences.find(r => r.id === testingRef)
        if (!ref) return null
        const inputs = (ref.inputs as any[]) ?? []
        const config = ref.request_config as any
        const methodColors: Record<string, string> = { GET: 'var(--theme-success)', POST: 'var(--status-info)', PUT: 'var(--theme-warning)', DELETE: 'var(--theme-danger)', PATCH: 'var(--theme-chart-6)' }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--theme-overlay)' }}>
            <div className="w-[90vw] max-w-2xl max-h-[80vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--theme-surface-border)' }}>
                <div className="flex items-center gap-2">
                  <Play size={14} style={{ color: 'var(--theme-primary-text)' }} />
                  <span className="text-sm font-semibold">Test: {ref.name}</span>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ color: methodColors[config?.method] ?? 'var(--theme-muted-text)', backgroundColor: `color-mix(in srgb, ${methodColors[config?.method] ?? 'var(--theme-muted-text)'} 8%, transparent)` }}>
                    {config?.method ?? 'GET'}
                  </span>
                </div>
                <button onClick={() => setTestingRef(null)} className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
                  <X size={16} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-4">
                {/* URL preview */}
                <div className="text-[10px] font-mono px-2.5 py-1.5 rounded-lg overflow-x-auto" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                  {integrationBaseUrl}{config?.path_template ?? ''}
                </div>

                {/* Inputs */}
                {inputs.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--theme-muted-text)' }}>Inputs</h4>
                    {inputs.map((inp: any, idx: number) => (
                      <div key={inp.id ?? `${inp.name}-${idx}`}>
                        <label className="flex items-center gap-1 text-xs font-medium mb-1">
                          <code className="font-mono" style={{ color: 'var(--theme-primary-text)' }}>{inp.name}</code>
                          <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>({inp.type})</span>
                          {inp.required && <span className="text-[10px] text-[color:var(--theme-danger)]">required</span>}
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

                {/* Run button */}
                <Button size="sm" onClick={() => runTest(ref)} disabled={testLoading} className="gap-1.5">
                  {testLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  {testLoading ? 'Running...' : 'Execute'}
                </Button>

                {/* Result */}
                {testResult && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--theme-muted-text)' }}>
                      Response
                      {testResult.status && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: testResult.status < 300 ? 'color-mix(in srgb, var(--theme-success) 8%, transparent)' : 'color-mix(in srgb, var(--theme-danger) 8%, transparent)',
                            color: testResult.status < 300 ? 'var(--theme-success)' : 'var(--theme-danger)',
                          }}>
                          {testResult.status}
                        </span>
                      )}
                    </h4>
                    {testResult.error ? (
                      <div className="text-xs p-3 rounded-lg" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 8%, transparent)', color: 'var(--theme-danger)' }}>
                        {testResult.error}
                      </div>
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

      {adding ? (
        <form action={handleAdd} className="flex gap-2 p-2 rounded-lg" style={{ border: '1px dashed var(--theme-surface-border)' }}>
          <Input name="name" required placeholder="Reference name" className="flex-1" />
          <Input name="description" placeholder="Description" className="flex-1" />
          <Button type="submit" size="sm">Create</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
        </form>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)} className="w-full">
          <Plus size={14} className="mr-1" /> Add Reference
        </Button>
      )}

      <AssetDependencyDialog
        open={refDepsId !== null}
        onOpenChange={(open) => { if (!open) setRefDepsId(null) }}
        title={refDepsRef?.name ?? ''}
        subtitle="API Reference"
        deps={refDeps}
        loading={refDepsLoading}
      />
    </div>
  )
}
