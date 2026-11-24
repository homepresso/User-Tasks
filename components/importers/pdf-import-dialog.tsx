'use client'

/**
 * The PDF form importer (Forms → Import → PDF form), the InfoPath
 * importer's flow on the generic importer endpoint (/api/internal/
 * importers/pdf):
 *
 *   1. pick     drop / browse a .pdf (≤ 4 MB hosted; nothing is stored)
 *   2. analyse  action analyze — the report, a working preview of each form
 *   3. review   counts, warnings, "This PDF has no fillable fields" for flat /
 *               scanned PDFs, the opt-in "Use AI for the hard parts" (off by
 *               default; disabled with a link when no provider / not allowed;
 *               a consent step says the content goes to the workspace's
 *               provider before anything is sent), the full report with
 *               "AI — review" marks (download as Markdown / JSON)
 *               tables of boxes found in the PDF: "Turn tables into repeating
 *               lists" (on by default) with a switch per table and the rows a
 *               list allows (as in the PDF / unlimited) — each change analyses
 *               again so the preview shows what will be imported
 *               "Bring in styling and images" (on by default): the logo and
 *               pictures, a theme from the PDF's colours and fonts (or the
 *               workspace theme), headings / instructions / dividers, page
 *               backgrounds (off) and the footer once (off) — the preview
 *               shows the form in that theme with its header
 *   4. import   the same file again with the options (and the AI answer the
 *               analysis returned, so the provider is not called twice)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileUp, Sparkles, Upload } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { BusyBar } from '@/components/ui/busy-bar'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Tag } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { FormLayout } from '@/lib/forms/layout'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import type { ImportReport, ImportReportItem } from '@/lib/extensions/sdk'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import { PdfStyledPreview, type StyledPreviewHeader } from './pdf-styled-preview'
import { download, post, READINESS, Stat, STATUS_TEXT, STATUS_TONE, type Outcome } from '@/components/extensions/importers'

const MAX_BYTES = 4 * 1024 * 1024

interface AiAvailability { available: boolean; reason: string | null; configured: boolean; settings_href: string; provider: string | null; model: string | null }
interface PdfDetails {
  kind: 'acroform' | 'hybrid' | 'xfa' | 'flat' | 'scanned'
  pages: number
  ai_availability: AiAvailability
  ai: { used: boolean; answer?: unknown; info?: { provider: string; model: string; images: number; ocr_pages: number; tokens: number }; error?: string | null }
  forms: Array<{ name: string; counts: { fields: number; rules: number; disabled_rules: number; ai: number }; display?: { headings: number; texts: number; dividers: number; images: number }; definition: { fields: TaskFieldDef[]; layout: FormLayout; header?: StyledPreviewHeader; theme?: FormThemeOverrides } }>
  tables?: PdfTableInfo[]
  styling?: StylingInfo
}
interface StylingInfo {
  on: boolean
  read?: boolean
  counts?: { headings: number; sections: number; texts: number; dividers: number; images: number } | null
  theme?: FormThemeOverrides | null
  found?: { images: number; texts: number; rules: number; theme: boolean } | null
}
interface StyleState { on: boolean; images: boolean; theme: 'new' | 'workspace'; text: boolean; backgrounds: boolean; footer: boolean }
const DEFAULT_STYLE: StyleState = { on: true, images: true, theme: 'new', text: true, backgrounds: false, footer: false }
interface PdfTableInfo { id: string; name: string; page: number; pages: number[]; rows: number; max_rows: number | null; columns: string[]; fields: number; converted: boolean; key: string | null }
interface Analysis { importer: string; report: ImportReport & { details?: PdfDetails }; markdown: string }

type Step = 'pick' | 'analysing' | 'review' | 'importing' | 'done'

const PROVIDER_NAMES: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', azure_openai: 'Azure OpenAI', gemini: 'Google Gemini', bedrock: 'Amazon Bedrock', mistral: 'Mistral', ollama: 'Ollama', other: 'your OpenAI-compatible server' }

export function PdfImportDialog({ open, onOpenChange, initialFile, onImported }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A file to start with (the public preview's hand-off). */
  initialFile?: File | null
  onImported?: (result: Outcome) => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [dragging, setDragging] = useState(false)
  const [name, setName] = useState('')
  const [pages, setPages] = useState<'steps' | 'single'>('steps')
  const [tablesOn, setTablesOn] = useState(true)
  const [keepTables, setKeepTables] = useState<string[]>([])
  const [tableRows, setTableRows] = useState<'pdf' | 'unlimited'>('pdf')
  const [style, setStyle] = useState<StyleState>(DEFAULT_STYLE)
  const [available, setAvailable] = useState(false)
  const [aiOn, setAiOn] = useState(false)
  const [aiConsent, setAiConsent] = useState(false)
  const [aiStatus, setAiStatus] = useState<AiAvailability | null>(null)
  const [showReport, setShowReport] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [previewIndex, setPreviewIndex] = useState(0)
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({})

  const reset = () => {
    setStep('pick'); setFile(null); setError(null); setAnalysis(null); setOutcome(null); setName(''); setPages('steps'); setAvailable(false)
    setTablesOn(true); setKeepTables([]); setTableRows('pdf'); setStyle(DEFAULT_STYLE)
    setAiOn(false); setAiConsent(false); setShowReport(false); setShowAll(false); setPreviewIndex(0); setPreviewValues({})
  }

  useEffect(() => {
    if (!open) { reset(); return }
    let live = true
    if (initialFile) void analyse(initialFile, {})
    fetch('/api/internal/importers/pdf').then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j?.ai) setAiStatus(j.ai as AiAvailability) }).catch(() => undefined)
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [open, initialFile])

  const details = analysis?.report.details
  const ai = details?.ai_availability ?? aiStatus
  const aiUsed = Boolean(details?.ai.used)

  const options = useCallback((extra: Record<string, unknown> = {}) => ({
    pages, ...(name.trim() ? { name: name.trim() } : {}), available_in_menu: available,
    tables: tablesOn, keep_tables: keepTables.join(','), table_rows: tableRows,
    styling: style.on, styling_images: style.images, styling_theme: style.theme, styling_text: style.text, styling_backgrounds: style.backgrounds, styling_footer: style.footer,
    ...extra,
  }), [pages, name, available, tablesOn, keepTables, tableRows, style])

  const analyse = async (f: File, opts: Record<string, unknown> = {}) => {
    setError(null)
    if (!/\.pdf$/i.test(f.name)) { setError('Choose a PDF form (.pdf).'); return }
    if (f.size > MAX_BYTES) { setError('The PDF is larger than 4 MB. Remove scanned attachments or images from it and try again.'); return }
    setFile(f)
    setStep('analysing')
    const res = await post('pdf', [f], 'analyze', opts)
    if (!res.ok) { setError(res.error); setStep(analysis ? 'review' : 'pick'); return }
    setAnalysis(res.data as Analysis)
    setPreviewIndex(0)
    setPreviewValues({})
    setStep('review')
  }

  const analyseWithAi = () => { if (file) void analyse(file, options({ ai: true, ai_consent: true })) }
  /** Analyse again with changed options (the AI answer, when there is one, is reused — never a second call). */
  const reanalyse = (extra: Record<string, unknown>) => {
    if (file) void analyse(file, options({ ...extra, ...(aiUsed && details?.ai.answer ? { ai: true, ai_consent: true, ai_result: details.ai.answer } : {}) }))
  }

  const doImport = async () => {
    if (!file) return
    setStep('importing')
    setError(null)
    const extra = aiUsed && details?.ai.answer ? { ai: true, ai_consent: true, ai_result: details.ai.answer } : {}
    const res = await post('pdf', [file], 'import', options(extra))
    if (!res.ok) { setError(res.error); setStep('review'); return }
    const data = res.data as Outcome
    setOutcome(data)
    setStep('done')
    onImported?.(data)
  }

  const report = analysis?.report
  const preview = details?.forms[previewIndex]
  const noFields = details ? details.forms.every((f) => !f.counts.fields) : false
  const aiItems = useMemo(() => (report?.items ?? []).filter((i) => i.origin === 'ai').length, [report])
  const shown = report ? (showAll ? report.items : report.items.filter((i) => i.status !== 'mapped' && i.status !== 'info')) : []
  const first = outcome?.created.find((c) => c.href)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (step !== 'importing' && step !== 'analysing') onOpenChange(o) }}>
      <DialogContent size="xl" title="Import a PDF form" description="Upload a fillable PDF: its fields, labels, choices, required fields, formats and show / hide behaviour become a UserTasks form you can review before saving." data-testid="pdf-import">
        <DialogBody className="space-y-4">
          {error && <InlineNotice tone="danger" message={error} />}
          {step === 'pick' && (
            <div
              role="button" tabIndex={0} aria-label="Choose a PDF form" data-testid="pdf-drop"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void analyse(f, options()) }}
              className={cn('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors', dragging ? 'border-primary bg-primary-wash' : 'border-border hover:border-primary/60')}
            >
              <Upload className="size-8 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Drop a PDF form here, or click to browse</p>
              <p className="max-w-md text-xs text-fg-muted">A fillable PDF (AcroForm or XFA). Up to 4 MB. The file is only read to build your form: it is not stored, and scripts in it are never run.</p>
              <input ref={inputRef} type="file" accept=".pdf,application/pdf" className="hidden" data-testid="pdf-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyse(f, options()); e.target.value = '' }} />
            </div>
          )}
          {(step === 'analysing' || step === 'importing') && (
            <div className="space-y-3 py-8 text-center" aria-live="polite">
              <BusyBar label={step === 'analysing' ? 'Analysing' : 'Importing'} />
              <p className="text-sm font-medium">{step === 'analysing' ? `Analysing ${file?.name ?? 'the PDF'}…` : 'Creating your form…'}</p>
              <p className="text-xs text-fg-muted">{step === 'analysing' ? (aiOn && aiConsent ? `Reading the fields, then asking ${PROVIDER_NAMES[ai?.provider ?? ''] ?? 'your AI provider'} about the hard parts — this can take a minute.` : 'Reading the fields, labels, scripts and printed instructions.') : 'Saving the form with its rules and steps.'}</p>
            </div>
          )}
          {step === 'review' && report && details && (
            <div className="space-y-4" data-testid="pdf-review">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileUp className="size-4 text-fg-muted" aria-hidden /><span className="font-semibold">{file?.name}</span>
                <Tag>{report.title}</Tag>
                <Tag>{READINESS[report.readiness]}</Tag>
                {aiUsed && <Tag><Sparkles className="mr-1 inline size-3" aria-hidden />AI assisted</Tag>}
              </div>
              {noFields && (
                <InlineNotice tone="warning" title="This PDF has no fillable fields" message={details.kind === 'scanned'
                  ? 'It looks scanned (pictures of pages, no text). The importer reads fillable PDFs; use the AI assist below to read the questions, or build the form by hand.'
                  : 'It is a flat, print-only PDF. The importer reads fillable PDFs; use the AI assist below to read its questions, or build the form by hand.'} />
              )}
              {!noFields && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="pdf-counts">
                  <Stat label="Fields" value={String(details.forms.reduce((n, f) => n + f.counts.fields, 0))} hint={`${details.pages} page${details.pages === 1 ? '' : 's'}`} />
                  <Stat label="Rules" value={String(details.forms.reduce((n, f) => n + f.counts.rules, 0))} hint={details.forms.some((f) => f.counts.disabled_rules) ? `${details.forms.reduce((n, f) => n + f.counts.disabled_rules, 0)} turned off for review` : undefined} />
                  <Stat label="Coverage" value={`${report.coverage.percent}%`} hint={`${report.coverage.partial} to review`} />
                  <Stat label="Forms" value={String(details.forms.filter((f) => f.counts.fields).length)} hint={details.forms.length > 1 ? 'split: 200 fields per form' : undefined} />
                </div>
              )}
              {report.summary && <p className="text-sm">{report.summary}</p>}
              <AiPanel ai={ai} used={aiUsed} aiItems={aiItems} info={details.ai.info} on={aiOn} consent={aiConsent} noFields={noFields}
                onToggle={(v) => { setAiOn(v); if (!v) setAiConsent(false) }} onConsent={setAiConsent} onRun={analyseWithAi} />
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                <div className="space-y-4">
                  <Field label="Form name"><Input value={name} placeholder={report.title} onChange={(e) => setName(e.target.value)} maxLength={100} data-testid="pdf-name" /></Field>
                  {details.pages > 1 && (
                    <Field label="Pages">
                      <SegmentedControl aria-label="Pages" size="sm" value={pages} onValueChange={(v) => { setPages(v as 'steps' | 'single'); if (file) void analyse(file, options({ pages: v, ...(aiUsed && details.ai.answer ? { ai: true, ai_consent: true, ai_result: details.ai.answer } : {}) })) }}
                        options={[{ value: 'steps', text: 'Each PDF page is a step' }, { value: 'single', text: 'One page' }]} />
                    </Field>
                  )}
                  {(details.tables?.length ?? 0) > 0 && (
                    <TablesPanel tables={details.tables!} on={tablesOn} keep={keepTables} rows={tableRows}
                      onToggle={(v) => { setTablesOn(v); reanalyse({ tables: v }) }}
                      onKeep={(id, keepIt) => { const next = keepIt ? [...keepTables, id] : keepTables.filter((x) => x !== id); setKeepTables(next); reanalyse({ keep_tables: next.join(',') }) }}
                      onRows={(v) => { setTableRows(v); reanalyse({ table_rows: v }) }} />
                  )}
                  {!noFields && details.kind !== 'xfa' && (
                    <StylePanel style={style} info={details.styling} onChange={(next) => {
                      setStyle(next)
                      reanalyse({ styling: next.on, styling_images: next.images, styling_theme: next.theme, styling_text: next.text, styling_backgrounds: next.backgrounds, styling_footer: next.footer })
                    }} />
                  )}
                  <Checkbox checked={available} onChange={(e) => setAvailable(e.target.checked)} label="Show in the Forms menu" description="For people you give access to the form." />
                  {report.warnings.slice(0, 4).map((w, i) => <p key={i} className="flex gap-1 text-xs text-fg-muted"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{w}</p>)}
                </div>
                <div className="min-w-0 space-y-2">
                  {details.forms.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {details.forms.map((f, i) => (
                        <button key={i} type="button" onClick={() => { setPreviewIndex(i); setPreviewValues({}) }} className={cn('rounded-full border px-2.5 py-1 text-xs', i === previewIndex ? 'border-primary bg-primary-wash font-semibold' : 'border-border')}>Part {i + 1}</button>
                      ))}
                    </div>
                  )}
                  {preview && preview.counts.fields > 0 && (
                    <div className="max-h-[420px] overflow-auto rounded-lg border border-border bg-surface p-3" data-testid="pdf-preview">
                      <p className="mb-2 text-xs text-fg-muted">Preview — try it, nothing is saved · {preview.counts.fields} fields · {preview.counts.rules} rules{preview.counts.disabled_rules ? ` (${preview.counts.disabled_rules} turned off)` : ''}</p>
                      <PdfStyledPreview key={`${previewIndex}-${aiUsed}`} idPrefix={`pdf-${previewIndex}-`} fields={preview.definition.fields} layout={preview.definition.layout} header={preview.definition.header} theme={preview.definition.theme} values={previewValues} onChange={(k, v) => setPreviewValues((prev) => ({ ...prev, [k]: v }))} />
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-1 px-3 py-1.5">
                  <button type="button" className="flex flex-1 items-center gap-1 py-0.5 text-left text-sm font-semibold" aria-expanded={showReport} onClick={() => setShowReport(!showReport)} data-testid="pdf-report-toggle">
                    {showReport ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />} Mapping report ({report.items.length} items{aiItems ? `, ${aiItems} AI — review` : ''})
                  </button>
                  {showReport && <Checkbox checked={showAll} onChange={(e) => setShowAll(e.target.checked)} label="Show all" />}
                  <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download(`${(file?.name ?? 'form').replace(/\.pdf$/i, '')}-import-report.md`, analysis!.markdown, 'text/markdown')}>Markdown</Button>
                  <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download(`${(file?.name ?? 'form').replace(/\.pdf$/i, '')}-import-report.json`, JSON.stringify(report, null, 2), 'application/json')}>JSON</Button>
                </div>
                {showReport && <ReportItems items={shown} />}
              </div>
            </div>
          )}
          {step === 'done' && outcome && (
            <div className="space-y-3" data-testid="pdf-done">
              <InlineNotice tone="success" message={`Imported: ${outcome.created.length} form${outcome.created.length === 1 ? '' : 's'} created. Review ${aiUsed ? 'the items marked “AI — review”, ' : ''}the turned-off rules and the labels in the designer.`} />
              <ul className="space-y-1 text-sm">
                {outcome.created.map((c) => <li key={c.id} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" aria-hidden />{c.href ? <a className="underline" href={c.href}>{c.name}</a> : c.name}</li>)}
              </ul>
              {outcome.warnings.map((w, i) => <p key={i} className="text-xs text-fg-muted">{w}</p>)}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="sm:pr-32">
          {step === 'done' ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
              {first?.href && <Button onClick={() => { onOpenChange(false); router.push(first.href!) }} data-testid="pdf-open">Open in the designer</Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={step === 'importing' || step === 'analysing'}>Cancel</Button>
              {step === 'review' && <Button variant="ghost" onClick={reset}>Choose another file</Button>}
              {(step === 'review' || step === 'importing') && (
                <Button onClick={() => void doImport()} loading={step === 'importing'} disabled={noFields} data-testid="pdf-import-button">
                  {details && details.forms.filter((f) => f.counts.fields).length > 1 ? `Import ${details.forms.filter((f) => f.counts.fields).length} forms` : 'Import as a form'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AiPanel({ ai, used, aiItems, info, on, consent, noFields, onToggle, onConsent, onRun }: {
  ai: AiAvailability | null | undefined
  used: boolean
  aiItems: number
  info?: { provider: string; model: string; images: number; ocr_pages: number; tokens: number }
  on: boolean
  consent: boolean
  noFields: boolean
  onToggle: (on: boolean) => void
  onConsent: (on: boolean) => void
  onRun: () => void
}) {
  const provider = PROVIDER_NAMES[ai?.provider ?? ''] ?? ai?.provider ?? 'your AI provider'
  if (used) {
    const who = info ? `${PROVIDER_NAMES[info.provider] ?? info.provider} (${info.model})` : provider
    return (
      <InlineNotice tone="info" title="AI assist used" message={`${who.charAt(0).toUpperCase()}${who.slice(1)} read this PDF${info?.images ? ` including ${info.images} page image${info.images === 1 ? '' : 's'}` : info?.ocr_pages ? ` with OCR text of ${info.ocr_pages} page${info.ocr_pages === 1 ? '' : 's'}` : ''}. ${aiItems} item${aiItems === 1 ? '' : 's'} came from it: they are marked “AI — review”. This was recorded in the audit log.`} />
    )
  }
  return (
    <fieldset className={cn('space-y-2 rounded-lg border p-3', noFields ? 'border-primary/50' : 'border-border')} data-testid="pdf-ai">
      <legend className="px-1 text-xs font-semibold"><Sparkles className="mr-1 inline size-3" aria-hidden />AI assist (optional)</legend>
      <Checkbox checked={on} disabled={!ai?.available} onChange={(e) => onToggle(e.target.checked)} data-testid="pdf-ai-toggle"
        label="Use AI for the hard parts"
        description={noFields ? 'Reads the questions of a flat or scanned PDF.' : 'Unclear labels, Yes / No grids and printed instructions the importer could not turn into rules.'} />
      {!ai?.available && (
        <p className="text-xs text-fg-muted" data-testid="pdf-ai-unavailable">
          {ai?.reason ?? 'Checking whether an AI provider is set up…'}{' '}
          {ai && <Link className="underline" href={ai.settings_href}>Settings → Agent</Link>}
        </p>
      )}
      {on && ai?.available && (
        <div className="space-y-2 rounded-md bg-surface-sunken p-2">
          <p className="text-xs">The PDF&apos;s text and field list{noFields ? ' (and, for scanned pages, page images when the model can see them)' : ''} will be sent to <strong>{provider}</strong>{ai.model ? ` (${ai.model})` : ''} — your workspace&apos;s own AI provider and key. Its usage counts towards the Agent&apos;s limits and the send is recorded in the audit log. Nothing is sent unless you continue.</p>
          <Checkbox checked={consent} onChange={(e) => onConsent(e.target.checked)} label="I understand — send this PDF's content to the provider" data-testid="pdf-ai-consent" />
          <Button size="sm" leadingIcon={<Sparkles />} disabled={!consent} onClick={onRun} data-testid="pdf-ai-run">Analyse with AI</Button>
        </div>
      )}
    </fieldset>
  )
}

/** "Bring in styling and images": the switch, its parts and what was found. */
function StylePanel({ style, info, onChange }: { style: StyleState; info?: StylingInfo; onChange: (next: StyleState) => void }) {
  const set = (patch: Partial<StyleState>) => onChange({ ...style, ...patch })
  const c = info?.counts
  const theme = info?.theme?.colors?.light
  const found = c ? [
    c.images ? `${c.images} image${c.images === 1 ? '' : 's'}` : '',
    c.sections ? `${c.sections} section${c.sections === 1 ? '' : 's'}` : '',
    c.headings ? `${c.headings} heading${c.headings === 1 ? '' : 's'}` : '',
    c.texts ? `${c.texts} text block${c.texts === 1 ? '' : 's'}` : '',
    c.dividers ? `${c.dividers} divider${c.dividers === 1 ? '' : 's'}` : '',
  ].filter(Boolean).join(' · ') : ''
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3" data-testid="pdf-styling">
      <legend className="px-1 text-xs font-semibold">Styling</legend>
      <Checkbox checked={style.on} onChange={(e) => set({ on: e.target.checked })} data-testid="pdf-styling-toggle"
        label="Bring in styling and images"
        description="The logo and pictures, headings, instructions and dividers where the PDF has them, and a theme from its colours and fonts." />
      {style.on && (
        <div className="space-y-1.5 pl-1">
          <Checkbox checked={style.images} onChange={(e) => set({ images: e.target.checked })} label="Logo and pictures" data-testid="pdf-styling-images" />
          <Checkbox checked={style.text} onChange={(e) => set({ text: e.target.checked })} label="Headings, instructions and dividers" description="Printed text that isn't a field's label becomes read-only text; styled headings become sections." data-testid="pdf-styling-text" />
          <Checkbox checked={style.backgrounds} disabled={!style.images} onChange={(e) => set({ backgrounds: e.target.checked })} label="Page backgrounds and watermarks" description="Off: full-page and faint pictures are left out." data-testid="pdf-styling-backgrounds" />
          <Checkbox checked={style.footer} disabled={!style.text} onChange={(e) => set({ footer: e.target.checked })} label="Keep the page footer once" description="Repeated page headers, footers and page numbers are left out." data-testid="pdf-styling-footer" />
          <Field label="Theme">
            <SegmentedControl aria-label="Theme" size="sm" value={style.theme} onValueChange={(v) => set({ theme: v as 'new' | 'workspace' })}
              options={[{ value: 'new', text: 'New theme from the PDF' }, { value: 'workspace', text: 'Workspace theme' }]} />
          </Field>
          {(found || theme) && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-fg-muted" data-testid="pdf-styling-found">
              {theme?.accent && <span className="inline-block size-3 rounded-sm border border-border" style={{ backgroundColor: theme.accent }} aria-hidden />}
              {found ? `Brought in: ${found}` : ''}{theme?.accent ? `${found ? ' · ' : ''}accent ${theme.accent}` : ''}{info?.theme?.font ? ` · ${info.theme.font.family}` : ''}
            </p>
          )}
          {info?.read === false && <p className="text-xs text-fg-muted">The PDF&apos;s styling could not be read: see the warnings.</p>}
        </div>
      )}
    </fieldset>
  )
}

/** Tables of boxes found in the PDF: repeating lists (default) or separate fields, per table. */
function TablesPanel({ tables, on, keep, rows, onToggle, onKeep, onRows }: {
  tables: PdfTableInfo[]
  on: boolean
  keep: string[]
  rows: 'pdf' | 'unlimited'
  onToggle: (on: boolean) => void
  onKeep: (id: string, keep: boolean) => void
  onRows: (rows: 'pdf' | 'unlimited') => void
}) {
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3" data-testid="pdf-tables">
      <legend className="px-1 text-xs font-semibold">Tables ({tables.length})</legend>
      <Checkbox checked={on} onChange={(e) => onToggle(e.target.checked)} data-testid="pdf-tables-toggle"
        label="Turn tables into repeating lists"
        description="Rows of the same boxes become one list people add rows to, instead of a field per box." />
      {on && (
        <>
          <ul className="space-y-1.5 pl-1">
            {tables.map((t) => (
              <li key={t.id}>
                <Checkbox checked={!keep.includes(t.id)} onChange={(e) => onKeep(t.id, !e.target.checked)} data-testid={`pdf-table-${t.id}`}
                  label={`${t.name} — ${t.columns.length} column${t.columns.length === 1 ? '' : 's'}, ${t.rows} row${t.rows === 1 ? '' : 's'}`}
                  description={`Page${t.pages.length > 1 ? 's' : ''} ${t.pages.join(', ')} · ${t.columns.slice(0, 6).join(', ')}${t.columns.length > 6 ? ' …' : ''} · replaces ${t.fields} field${t.fields === 1 ? '' : 's'}`} />
              </li>
            ))}
          </ul>
          <Field label="Rows a list allows">
            <SegmentedControl aria-label="Rows a list allows" size="sm" value={rows} onValueChange={(v) => onRows(v as 'pdf' | 'unlimited')}
              options={[{ value: 'pdf', text: 'As many as the PDF has' }, { value: 'unlimited', text: 'No limit (up to 200)' }]} />
          </Field>
        </>
      )}
    </fieldset>
  )
}

function ReportItems({ items }: { items: ImportReportItem[] }) {
  return (
    <ul className="max-h-80 space-y-1 overflow-auto border-t border-border px-3 py-2" data-testid="pdf-report">
      {items.length === 0 && <li className="text-xs text-fg-muted">Nothing needs attention.</li>}
      {items.slice(0, 600).map((i, n) => (
        <li key={n} className="text-xs">
          {i.origin === 'ai'
            ? <span className="font-semibold text-primary">AI — review</span>
            : <span className={cn('font-semibold', STATUS_TONE[i.status])}>{STATUS_TEXT[i.status]}</span>}
          {' '}· <span className="text-fg-muted">{i.kind}</span> {i.name}{i.location ? <span className="text-fg-muted"> ({i.location})</span> : null}
          {i.mappedTo ? <> → {i.mappedTo}</> : null}{i.detail ? <span className="text-fg-muted">: {i.detail}</span> : null}
        </li>
      ))}
    </ul>
  )
}
