'use client'

import { DataTableValueView } from './data-table-field'
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
import { AttachmentList } from './attachments-field'
import { lookupItemKey } from '@/lib/forms/lookup'
import { isSectionIncluded, layoutSections, sectionFieldKeys } from '@/lib/forms/sections'
import { formatRelativeDate } from '@/lib/utils'
import { SUBMISSION_SOURCE_LABELS, submissionSurface, type SubmissionSurface } from '@/lib/forms/submission-meta'

/* eslint-disable @typescript-eslint/no-explicit-any -- submission rows */

const PAGE = 50

/** Where it was submitted (the server's `submission.source`; older reads: the stored source). */
function sourceLabel(row: any): string {
  const source = (row.submission?.source ?? submissionSurface(row.source)) as SubmissionSurface
  return SUBMISSION_SOURCE_LABELS[source] ?? 'Form page'
}

/**
 * A form's submissions (Forms library → Submissions): newest first, filter
 * by where they were submitted, one submission's values and the workflows
 * its button started, and a CSV export (a background job — the Jobs popup
 * offers the file). Everyone sees their own; forms.edit sees all.
 */
export function FormSubmissionsPanel({ form, onClose }: { form: { id: string; name: string; fields?: unknown[] } | null; onClose: () => void }) {
  const jobs = useJobs()
  const [source, setSource] = useState<'' | 'standalone' | 'task' | 'api' | 'anonymous'>('')
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
  // Sections (lib/forms/sections.ts): the detail shows each one's title; one left out shows "Not included".
  const sections = layoutSections(full?.layout)
  const sectionByField = new Map(sections.flatMap((s) => sectionFieldKeys(full?.layout, s.key).map((k) => [k, s] as const)))
  const rows = (data?.submissions ?? []) as any[]
  const total = data?.total ?? 0

  return (
    <Dialog.Root open={Boolean(form)} onOpenChange={(open) => { if (!open) { setSelected(null); onClose() } }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex max-h-[88vh] w-[min(56rem,96vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl shadow-xl dialog-content bg-panel text-fg"
          data-testid="form-submissions">
          <div className="flex items-center gap-2 border-b px-4 py-3 border-border">
            {selected && <button type="button" onClick={() => setSelected(null)} aria-label="Back to the list" className="rounded p-1"><ArrowLeft size={14} /></button>}
            <Dialog.Title className="flex-1 truncate text-sm font-semibold">{selected ? 'Submission' : `Submissions — ${form?.name ?? ''}`}</Dialog.Title>
            {!selected && (
              <>
                <div className="w-40">
                  <AutocompleteSelect value={source} placeholder="Anywhere" clearable
                    options={[{ value: 'standalone', label: 'Form page' }, { value: 'task', label: 'Task form' }, { value: 'api', label: 'API / MCP' }, { value: 'anonymous', label: 'Public link (anonymous)' }]}
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
          {exportError && <p className="px-4 pt-2 text-xs text-danger" role="alert">{exportError}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-xs">
            {selected ? (
              <dl className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-[12rem_1fr]" data-testid="submission-detail">
                <dt className="text-fg-muted">Reference</dt><dd className="font-mono" data-submission-reference>{selected.submission?.reference ?? selected.id.slice(0, 8)}</dd>
                <dt className="text-fg-muted">Submitted</dt><dd>{new Date(selected.created_at).toLocaleString()} by {selected.submitted_by_name ?? 'unknown'}{selected.submission?.submitted_by.email && selected.submission.submitted_by.email !== selected.submitted_by_name ? ` (${selected.submission.submitted_by.email})` : ''}</dd>
                <dt className="text-fg-muted">Form version</dt><dd>{selected.form_version ?? '—'}</dd>
                <dt className="text-fg-muted">Where</dt><dd>{sourceLabel(selected)}{selected.button_id ? ` · button "${selected.button_id}"` : ''}{selected.outcome ? ` · ${selected.outcome}` : ''}</dd>
                {fields.map((f, i) => {
                  const section = sectionByField.get(f.key)
                  const first = section && sectionByField.get(fields[i - 1]?.key ?? '') !== section
                  const included = !section || isSectionIncluded(section, selected.values ?? {})
                  if (section && !included && !first) return null
                  return (
                  <div key={f.key} className="contents">
                    {first && (
                      <p className="pt-2 text-2xs font-semibold sm:col-span-2" data-submission-section={section.key}>
                        {section.title}{!included && <span className="ml-2 font-normal italic text-fg-muted">Not included</span>}
                      </p>
                    )}
                    {included && (<>
                    <dt className="text-fg-muted">{f.label}</dt>
                    <dd className="break-words">{f.type === 'data_table' ? <DataTableValueView field={f} value={selected.values?.[f.key]} /> : f.type === 'attachments' ? <AttachmentList value={selected.values?.[f.key]} /> : f.type === 'lookup' ? lookupDisplayValue(f, selected.values?.[f.key], selected.values?.[lookupItemKey(f.key)], selected.values?.[`${f.key}_label`]) : formatFieldValue(f, selected.values?.[f.key])}</dd>
                    </>)}
                  </div>
                  )
                })}
                {Array.isArray(selected.result?.runs) && selected.result.runs.length > 0 && (
                  <>
                    <dt className="text-fg-muted">Workflows started</dt>
                    <dd>{selected.result.runs.map((r: any) => `${r.workflow_name ?? r.workflow_id} (${r.status}${r.job_id ? ` · ${String(r.job_id).slice(0, 8)}` : ''})`).join(', ')}</dd>
                  </>
                )}
              </dl>
            ) : isLoading ? <p className="text-fg-muted">Loading…</p>
              : error ? <p className="text-danger" role="alert">{(error as Error).message}</p>
                : rows.length === 0 ? <p className="text-fg-muted">No submissions yet. Share the form&apos;s link (Open form) or link it to a User Task.</p>
                  : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left">
                        <thead>
                          <tr className="text-fg-muted">
                            <th className="py-1.5 pr-3 font-medium">Reference</th>
                            <th className="py-1.5 pr-3 font-medium">Submitted</th>
                            <th className="py-1.5 pr-3 font-medium">By</th>
                            <th className="py-1.5 pr-3 font-medium">Where</th>
                            {fields.slice(0, 3).map((f) => <th key={f.key} className="py-1.5 pr-3 font-medium">{f.label}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id} className="cursor-pointer border-t hover:opacity-80 border-border" onClick={() => setSelected(r)} data-submission-id={r.id}>
                              <td className="py-1.5 pr-3 font-mono">{r.submission?.reference ?? r.id.slice(0, 8)}</td>
                              <td className="py-1.5 pr-3 whitespace-nowrap">{formatRelativeDate(r.created_at)}</td>
                              <td className="py-1.5 pr-3">{r.submitted_by_name ?? '—'}</td>
                              <td className="py-1.5 pr-3">{sourceLabel(r)}{r.outcome ? ` · ${r.outcome}` : ''}</td>
                              {fields.slice(0, 3).map((f) => (
                                <td key={f.key} className="max-w-[14rem] truncate py-1.5 pr-3">{f.type === 'lookup' ? lookupDisplayValue(f, r.values?.[f.key], r.values?.[lookupItemKey(f.key)], r.values?.[`${f.key}_label`]) : formatFieldValue(f, r.values?.[f.key])}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
          </div>
          {!selected && total > PAGE && (
            <div className="flex items-center justify-end gap-2 border-t px-4 py-2 text-xs border-border">
              <span className="text-fg-muted">{page * PAGE + 1}–{Math.min(total, (page + 1) * PAGE)} of {total}</span>
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button>
              <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= total} onClick={() => setPage(page + 1)}>Next</Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
