'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Download, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutocompleteSelect } from '@/components/ui/autocomplete-select'
import { useJobs } from '@/components/jobs/jobs-provider'
import { serverRead } from '@/lib/server-read'
import { normalizeTaskFields, valueFields } from '@/lib/task-field-schema'
import { formatFieldValue } from './form-renderer'
import { lookupDisplayValue } from './lookup-field'
import { lookupItemKey } from '@/lib/forms/lookup'
import { formatRelativeDate } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- submission rows */

const PAGE = 50

/**
 * A form's submissions (Forms library → Submissions): newest first, filter
 * by where they were submitted, one submission's values and the workflows
 * its button started, and a CSV export (a background job — the Jobs popup
 * offers the file). Everyone sees their own; forms.edit sees all.
 */
export function FormSubmissionsPanel({ form, onClose }: { form: { id: string; name: string; fields?: unknown[] } | null; onClose: () => void }) {
  const jobs = useJobs()
  const [source, setSource] = useState<'' | 'standalone' | 'task' | 'api'>('')
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<any | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['form-submissions', form?.id, source, page],
    enabled: Boolean(form),
    queryFn: async () => {
      const result = await serverRead('forms.submissions', { form_id: form!.id, ...(source ? { source } : {}), offset: page * PAGE })
      if (result.error) throw new Error(result.error.message)
      return result.data!
    },
  })
  const { data: full } = useQuery({
    queryKey: ['form', form?.id],
    enabled: Boolean(form),
    queryFn: async () => (await serverRead('forms.get', { id: form!.id })).data as any,
  })
  const fields = valueFields(normalizeTaskFields(full?.fields ?? form?.fields ?? []))
  const rows = (data?.submissions ?? []) as any[]
  const total = data?.total ?? 0

  return (
    <Dialog.Root open={Boolean(form)} onOpenChange={(open) => { if (!open) { setSelected(null); onClose() } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(56rem,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-xl dialog-content"
          style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }} data-testid="form-submissions">
          <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
            {selected && <button type="button" onClick={() => setSelected(null)} aria-label="Back to the list" className="rounded p-1"><ArrowLeft size={14} /></button>}
            <Dialog.Title className="flex-1 truncate text-sm font-semibold">{selected ? 'Submission' : `Submissions — ${form?.name ?? ''}`}</Dialog.Title>
            {!selected && (
              <>
                <div className="w-40">
                  <AutocompleteSelect value={source} placeholder="Anywhere" clearable
                    options={[{ value: 'standalone', label: 'Form page' }, { value: 'task', label: 'Task form' }, { value: 'api', label: 'API / MCP' }]}
                    onChange={(v) => { setPage(0); setSource((v || '') as typeof source) }} />
                </div>
                <Button size="sm" variant="outline" disabled={!total} data-testid="export-submissions" onClick={async () => {
                  setExportError(null)
                  try {
                    await jobs.start('form.submissions_csv', { form_id: form!.id, ...(source ? { source } : {}) }, { effect: 'download', pendingMessage: 'Preparing the submissions CSV…' })
                  } catch (e) { setExportError(e instanceof Error ? e.message : 'Could not start the export') }
                }}><Download size={12} /> Export CSV</Button>
              </>
            )}
            <Dialog.Close aria-label="Close" className="rounded p-1"><X size={14} /></Dialog.Close>
          </div>
          {exportError && <p className="px-4 pt-2 text-xs" role="alert" style={{ color: 'var(--status-blocked)' }}>{exportError}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
            {selected ? (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]" data-testid="submission-detail">
                <dt style={{ color: 'var(--theme-muted-text)' }}>Submitted</dt><dd>{new Date(selected.created_at).toLocaleString()} by {selected.submitted_by_name ?? 'unknown'}</dd>
                <dt style={{ color: 'var(--theme-muted-text)' }}>Where</dt><dd>{selected.source === 'task' ? 'Task form' : selected.source === 'api' ? 'API / MCP' : 'Form page'}{selected.button_id ? ` · button "${selected.button_id}"` : ''}{selected.outcome ? ` · ${selected.outcome}` : ''}</dd>
                {fields.map((f) => (
                  <div key={f.key} className="contents">
                    <dt style={{ color: 'var(--theme-muted-text)' }}>{f.label}</dt>
                    <dd className="break-words">{f.type === 'lookup' ? lookupDisplayValue(f, selected.values?.[f.key], selected.values?.[lookupItemKey(f.key)]) : formatFieldValue(f, selected.values?.[f.key])}</dd>
                  </div>
                ))}
                {Array.isArray(selected.result?.runs) && selected.result.runs.length > 0 && (
                  <>
                    <dt style={{ color: 'var(--theme-muted-text)' }}>Workflows started</dt>
                    <dd>{selected.result.runs.map((r: any) => `${r.workflow_name ?? r.workflow_id} (${r.status}${r.job_id ? ` · ${String(r.job_id).slice(0, 8)}` : ''})`).join(', ')}</dd>
                  </>
                )}
              </dl>
            ) : isLoading ? <p style={{ color: 'var(--theme-muted-text)' }}>Loading…</p>
              : error ? <p role="alert" style={{ color: 'var(--status-blocked)' }}>{(error as Error).message}</p>
                : rows.length === 0 ? <p style={{ color: 'var(--theme-muted-text)' }}>No submissions yet. Share the form&apos;s link (Open form) or link it to a User Task.</p>
                  : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr style={{ color: 'var(--theme-muted-text)' }}>
                            <th className="py-1.5 pr-3 font-medium">Submitted</th>
                            <th className="py-1.5 pr-3 font-medium">By</th>
                            <th className="py-1.5 pr-3 font-medium">Where</th>
                            {fields.slice(0, 3).map((f) => <th key={f.key} className="py-1.5 pr-3 font-medium">{f.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className="cursor-pointer border-t hover:opacity-80" style={{ borderColor: 'var(--theme-surface-border)' }} onClick={() => setSelected(r)} data-submission-id={r.id}>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{formatRelativeDate(r.created_at)}</td>
                              <td className="py-1.5 pr-3">{r.submitted_by_name ?? '—'}</td>
                              <td className="py-1.5 pr-3">{r.source === 'task' ? 'Task' : r.source === 'api' ? 'API' : 'Page'}{r.outcome ? ` · ${r.outcome}` : ''}</td>
                              {fields.slice(0, 3).map((f) => (
                                <td key={f.key} className="max-w-[14rem] truncate py-1.5 pr-3">{f.type === 'lookup' ? lookupDisplayValue(f, r.values?.[f.key], r.values?.[lookupItemKey(f.key)]) : formatFieldValue(f, r.values?.[f.key])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
          </div>
          {!selected && total > PAGE && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs" style={{ borderColor: 'var(--theme-surface-border)' }}>
              <span style={{ color: 'var(--theme-muted-text)' }}>{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
