'use client'

/**
 * The InfoPath importer (Forms → Import → InfoPath form): drop an .xsn,
 * see what it holds and how it maps, choose the options, import.
 *
 *   1. pick     drag and drop / browse (.xsn, or a .zip of its source files; ≤ 4 MB)
 *   2. analyse  POST /api/internal/forms/infopath (action analyze) — nothing is stored
 *   3. review   views (one form each, ticked), counts, "N of M rules converted",
 *               warnings, a read-only preview of each form, the full report
 *               (download as Markdown / JSON)
 *   4. import   the same file again with the options (action import); opens
 *               the first form in the designer
 * Re-importing a file made earlier offers to update those forms.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileUp, Upload } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox, Radio } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { BusyBar } from '@/components/ui/busy-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tag } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { FormLayout } from '@/lib/forms/layout'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { ImportReport, ReportItem, ReportStatus } from '@/lib/infopath/generate'
import { FormRenderer } from './form-renderer'

export const INFOPATH_ACCEPT = '.xsn,.zip,application/vnd.ms-infopath,application/zip'
const MAX_BYTES = 4 * 1024 * 1024

interface FormPreview {
  name: string
  view: string | null
  counts: { fields: number; lists: number; rules: number; disabled_rules: number }
  updates?: { id: string; name: string } | null
  definition?: { fields: TaskFieldDef[]; layout: FormLayout }
}

interface Analysis {
  file_name: string
  hash: string
  report: ImportReport
  forms: FormPreview[]
  existing: Array<{ id: string; name: string; view: string | null; same_file: boolean; imported_at: string | null }>
  markdown: string
}

interface ImportResult extends Analysis {
  created: Array<{ id: string; name: string; href: string }>
  updated: Array<{ id: string; name: string; href: string }>
  table?: { id: string; name: string }
  workflow?: { id: string; name: string } | null
  warnings: string[]
}

type Step = 'pick' | 'analysing' | 'review' | 'importing' | 'done'

const STATUS_TONE: Record<ReportStatus, string> = {
  converted: 'text-success', partial: 'text-warning', manual: 'text-danger', skipped: 'text-fg-muted',
}
const STATUS_TEXT: Record<ReportStatus, string> = { converted: 'Converted', partial: 'Partly', manual: 'Needs attention', skipped: 'Not converted' }

async function post(file: File, action: 'analyze' | 'import', options: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const body = new FormData()
  body.append('file', file)
  body.append('action', action)
  body.append('options', JSON.stringify(options))
  try {
    const res = await fetch('/api/internal/forms/infopath', { method: 'POST', body })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error ?? `The request failed (${res.status})` }
    return { ok: true, data: json }
  } catch {
    return { ok: false, error: 'The upload failed — check your connection and try again' }
  }
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function InfoPathImportDialog({ open, onOpenChange, initialFile, onImported }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A file to start with (the Agent panel, the marketing page hand-off). */
  initialFile?: File | null
  onImported?: (result: ImportResult) => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const [views, setViews] = useState<string[]>([])
  const [mode, setMode] = useState<'per_view' | 'combined'>('per_view')
  const [name, setName] = useState('')
  const [tag, setTag] = useState('')
  const [existing, setExisting] = useState<'new' | 'update'>('new')
  const [createTable, setCreateTable] = useState(false)
  const [available, setAvailable] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  /** The preview is a working form (try the rules); nothing is submitted. */
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({})

  const reset = () => {
    setStep('pick'); setFile(null); setError(null); setAnalysis(null); setResult(null)
    setViews([]); setMode('per_view'); setName(''); setTag(''); setExisting('new'); setCreateTable(false); setAvailable(false); setShowReport(false); setPreviewIndex(0); setPreviewValues({})
  }

  const analyse = useCallback(async (f: File, opts: Record<string, unknown> = {}) => {
    setError(null)
    if (!/\.(xsn|zip)$/i.test(f.name)) { setError('Choose an InfoPath form template (.xsn), or a .zip of its source files.'); return }
    if (f.size > MAX_BYTES) { setError('The file is larger than 4 MB. In InfoPath Designer use File → Publish → Export Source Files, zip the folder and upload the .zip (images are what make templates large).'); return }
    setFile(f)
    setStep('analysing')
    const res = await post(f, 'analyze', opts)
    if (!res.ok) { setError(res.error); setStep('pick'); return }
    const data = res.data as Analysis
    setAnalysis(data)
    if (!Object.keys(opts).length) {
      setViews(data.report.form.views.map((v) => v.name))
      setName(data.report.form.name)
      if (data.forms.some((f) => data.existing.some((e) => e.view === f.view))) setExisting('update')
    }
    setPreviewIndex(0)
    setStep('review')
  }, [])

  useEffect(() => {
    if (open && initialFile) { reset(); void analyse(initialFile) }
    if (!open) reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, initialFile])

  const options = () => ({ mode, views, ...(name.trim() && name.trim() !== analysis?.report.form.name ? { name: name.trim() } : {}), ...(tag.trim() ? { tag: tag.trim() } : {}), existing, create_table: createTable, available_in_menu: available })

  // Options that change what is made: analyse again for the preview / counts.
  const reanalyse = async (patch: { mode?: 'per_view' | 'combined'; views?: string[] }) => {
    if (!file) return
    const next = { ...options(), ...patch }
    if (patch.mode) setMode(patch.mode)
    if (patch.views) setViews(patch.views)
    setStep('analysing')
    const res = await post(file, 'analyze', next)
    if (!res.ok) { setError(res.error); setStep('review'); return }
    setAnalysis(res.data as Analysis)
    setPreviewIndex(0)
    setStep('review')
  }

  const doImport = async () => {
    if (!file || !views.length) return
    setStep('importing')
    setError(null)
    const res = await post(file, 'import', options())
    if (!res.ok) { setError(res.error); setStep('review'); return }
    const data = res.data as ImportResult
    setResult(data)
    setStep('done')
    onImported?.(data)
  }

  const summary = analysis?.report.summary
  const attention = useMemo(() => (analysis?.report.items ?? []).filter((i) => i.status === 'manual'), [analysis])
  const preview = analysis?.forms[previewIndex]
  /** Forms an earlier import made that this import would update (same view). */
  const matches = analysis ? analysis.existing.filter((e) => analysis.forms.some((f) => f.view === e.view)) : []
  const first = result ? [...result.created, ...result.updated][0] : null

  return (
    <Dialog open={open} onOpenChange={(o) => { if (step !== 'importing') onOpenChange(o) }}>
      <DialogContent size="xl" title="Import an InfoPath form" description="Upload an InfoPath form template (.xsn): each view becomes a UserTasks form, with its rules and validation where they translate." data-testid="infopath-import">
        <DialogBody className="space-y-4">
          {error && <InlineNotice tone="danger" message={error} />}
          {step === 'pick' && (
            <div
              role="button"
              tabIndex={0}
              aria-label="Choose an InfoPath form template"
              data-testid="infopath-drop"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void analyse(f) }}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors', dragging ? 'border-primary bg-primary-wash' : 'border-border hover:border-primary/60')}
            >
              <Upload className="size-8 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Drop an InfoPath form here, or click to browse</p>
              <p className="max-w-md text-xs text-fg-muted">An .xsn form template (InfoPath 2007–2013), or a .zip of its source files. Up to 4 MB. The file is only read to build your forms: it is not stored.</p>
              <input ref={inputRef} type="file" accept={INFOPATH_ACCEPT} className="hidden" data-testid="infopath-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyse(f); e.target.value = '' }} />
            </div>
          )}
          {(step === 'analysing' || step === 'importing') && (
            <div className="space-y-3 py-8 text-center" aria-live="polite">
              <BusyBar label={step === 'analysing' ? 'Analysing' : 'Importing'} />
              <p className="text-sm font-medium">{step === 'analysing' ? `Analysing ${file?.name ?? 'the form'}…` : 'Creating your forms…'}</p>
              <p className="text-xs text-fg-muted">{step === 'analysing' ? 'Unpacking the template, reading its views, data source, rules and validation.' : 'Saving each form with its rules and layout.'}</p>
            </div>
          )}
          {step === 'review' && analysis && summary && (
            <div className="space-y-4" data-testid="infopath-review">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileUp className="size-4 text-fg-muted" aria-hidden /><span className="font-semibold">{analysis.file_name}</span>
                {analysis.report.form.browser_enabled && <Tag>Browser-enabled</Tag>}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="infopath-counts">
                <Stat label="Views → forms" value={`${summary.views} → ${analysis.forms.length}`} />
                <Stat label="Fields" value={String(summary.fields)} hint={summary.repeating ? `${summary.repeating} repeating → Lists` : undefined} />
                <Stat label="Rules converted" value={`${summary.rules.converted} of ${summary.rules.total}`} hint={summary.rules.partial ? `${summary.rules.partial} in part` : undefined} />
                <Stat label="Validation · formulas" value={`${summary.validations.converted + summary.calculations.converted} of ${summary.validations.total + summary.calculations.total}`} hint={summary.formatting.total ? `${summary.formatting.converted} of ${summary.formatting.total} formatting` : undefined} />
              </div>
              {matches.length > 0 && (
                <fieldset className="space-y-1.5 rounded-lg border border-border p-3">
                  <legend className="px-1 text-xs font-semibold">You imported this form before</legend>
                  <div className="flex flex-col gap-2">
                  <Radio name="ip-existing" checked={existing === 'update'} onChange={() => setExisting('update')} label={`Update the ${matches.length} form${matches.length === 1 ? '' : 's'} made then`} description={matches.map((e) => e.name).join(', ')} />
                  <Radio name="ip-existing" checked={existing === 'new'} onChange={() => setExisting('new')} label="Create new forms" />
                  </div>
                </fieldset>
              )}
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="space-y-4">
                  <fieldset className="space-y-1.5">
                    <legend className="mb-1 text-xs font-semibold">Views ({mode === 'per_view' ? 'each becomes a form' : 'each becomes a step'})</legend>
                    {analysis.report.form.views.map((v) => (
                      <Checkbox key={v.name} checked={views.includes(v.name)} data-testid={`infopath-view-${v.name}`}
                        onChange={(e) => void reanalyse({ views: e.target.checked ? [...views, v.name] : views.filter((x) => x !== v.name) })}
                        label={v.caption || v.name}
                        description={`${v.controls} controls${v.default ? ' · default view' : ''}${v.hidden ? ' · hidden in InfoPath' : ''}`} />
                    ))}
                  </fieldset>
                  <Field label="Make">
                    <SegmentedControl aria-label="Forms to make" size="sm" value={mode} onValueChange={(m) => void reanalyse({ mode: m })}
                      options={[{ value: 'per_view', text: 'One form per view' }, { value: 'combined', text: 'One form, views as steps' }]} />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Form name"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></Field>
                    <Field label="Extra tag" optional><Input value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder="e.g. finance" /></Field>
                  </div>
                  <Checkbox checked={createTable} onChange={(e) => setCreateTable(e.target.checked)} data-testid="infopath-create-table"
                    label="Create a data table for the submissions"
                    description="A table with a column per field (and a child table per repeating table), plus a draft “save submissions” workflow to review and publish." />
                  <Checkbox checked={available} onChange={(e) => setAvailable(e.target.checked)} label="Show in the Forms menu" description="For people you give access to the forms." />
                  {attention.length > 0 && (
                    <InlineNotice tone="warning" message={`${attention.length} item${attention.length === 1 ? '' : 's'} need${attention.length === 1 ? 's' : ''} attention after the import: kept as turned-off rules with the original expression in their notes.`} />
                  )}
                  {analysis.report.warnings.slice(0, 3).map((w, i) => <p key={i} className="flex gap-1 text-xs text-fg-muted"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{w}</p>)}
                </div>
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {analysis.forms.map((f, i) => (
                      <button key={i} type="button" onClick={() => { setPreviewIndex(i); setPreviewValues({}) }} className={cn('rounded-full border px-2.5 py-1 text-xs', i === previewIndex ? 'border-primary bg-primary-wash font-semibold' : 'border-border')}>
                        {f.view ?? f.name}{f.updates ? ' · update' : ''}
                      </button>
                    ))}
                  </div>
                  {preview && (
                    <div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-surface p-3" data-testid="infopath-preview">
                      <p className="mb-2 text-xs text-fg-muted">Preview — try it, nothing is saved · {preview.name} · {preview.counts.fields} fields · {preview.counts.rules} rules{preview.counts.disabled_rules ? ` (${preview.counts.disabled_rules} turned off)` : ''}</p>
                      {preview.definition && <FormRenderer key={previewIndex} idPrefix={`ip-${previewIndex}-`} fields={preview.definition.fields} layout={preview.definition.layout} values={previewValues} onChange={(k, v) => setPreviewValues((prev) => ({ ...prev, [k]: v }))} compact />}
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border">
                <div className="flex items-center gap-1 px-3 py-1.5">
                  <button type="button" className="flex flex-1 items-center gap-1 py-0.5 text-left text-sm font-semibold" aria-expanded={showReport} onClick={() => setShowReport(!showReport)} data-testid="infopath-report-toggle">
                    {showReport ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />} Full report ({analysis.report.items.length} items)
                  </button>
                  <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download(`${analysis.file_name.replace(/\.\w+$/, '')}-import-report.md`, analysis.markdown, 'text/markdown')}>Markdown</Button>
                  <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download(`${analysis.file_name.replace(/\.\w+$/, '')}-import-report.json`, JSON.stringify(analysis.report, null, 2), 'application/json')}>JSON</Button>
                </div>
                {showReport && <ReportList items={analysis.report.items} />}
              </div>
            </div>
          )}
          {step === 'done' && result && (
            <div className="space-y-3" data-testid="infopath-done">
              <InlineNotice tone="success" message={`Imported: ${result.created.length} form${result.created.length === 1 ? '' : 's'} created${result.updated.length ? `, ${result.updated.length} updated` : ''}.`} />
              <ul className="space-y-1 text-sm">
                {[...result.created, ...result.updated].map((f) => <li key={f.id} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" aria-hidden /><a className="underline" href={f.href}>{f.name}</a></li>)}
                {result.table && <li className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" aria-hidden />Data table: {result.table.name}</li>}
                {result.workflow && <li className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" aria-hidden />Draft workflow: {result.workflow.name}</li>}
              </ul>
              {result.warnings.map((w, i) => <p key={i} className="text-xs text-fg-muted">{w}</p>)}
            </div>
          )}
        </DialogBody>
        {/* Room on the right for the Agent's in-dialog button. */}
        <DialogFooter className="sm:pr-32">
          {step === 'done' ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
              {first && <Button onClick={() => { onOpenChange(false); router.push(first.href) }} data-testid="infopath-open">Open in the designer</Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={step === 'importing'}>Cancel</Button>
              {step === 'review' && <Button variant="ghost" onClick={reset}>Choose another file</Button>}
              {(step === 'review' || step === 'importing') && (
                <Button onClick={() => void doImport()} loading={step === 'importing'} disabled={!views.length || !analysis?.forms.length} data-testid="infopath-import-button">
                  {existing === 'update' && matches.length ? (matches.length < (analysis?.forms.length ?? 0) ? `Update ${matches.length}, create ${(analysis?.forms.length ?? 0) - matches.length}` : 'Update forms') : `Import ${analysis?.forms.length ?? 0} form${analysis?.forms.length === 1 ? '' : 's'}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-2xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="num text-lg font-semibold">{value}</p>
      {hint && <p className="text-2xs text-fg-muted">{hint}</p>}
    </div>
  )
}

const AREA_TITLES: Record<string, string> = {
  repeating: 'Repeating tables', field: 'Fields', rule: 'Rules', validation: 'Validation', calculation: 'Calculations', formatting: 'Conditional formatting',
  connection: 'Data connections', button: 'Buttons', submit: 'Submit', role: 'Roles', code: 'Code', view: 'Views', limit: 'Limits',
}

function ReportList({ items }: { items: ReportItem[] }) {
  const groups = Object.keys(AREA_TITLES).map((area) => [area, items.filter((i) => i.area === area)] as const).filter(([, list]) => list.length)
  return (
    <div className="max-h-80 space-y-3 overflow-auto border-t border-border px-3 py-2" data-testid="infopath-report">
      {groups.map(([area, list]) => (
        <section key={area}>
          <h4 className="mb-1 text-xs font-semibold">{AREA_TITLES[area]}</h4>
          <ul className="space-y-1">
            {list.map((i, n) => (
              <li key={n} className="text-xs">
                <span className={cn('font-semibold', STATUS_TONE[i.status])}>{STATUS_TEXT[i.status]}</span> · {i.name}{i.view ? <span className="text-fg-muted"> ({i.view})</span> : null}: <span className="text-fg-muted">{i.detail}</span>
                {i.original && <code className="mt-0.5 block truncate text-2xs text-fg-subtle" title={i.original}>{i.original}</code>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
