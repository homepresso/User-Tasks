'use client'

/**
 * Importers contributed by extensions (manifest contributes.importers) in
 * the Import menus of Automations (workflows) and Forms:
 *
 *   <ExtensionImporterMenuItems produces="form" onPick={setImporter} />   inside a DropdownMenuContent
 *   <ExtensionImportButton produces="workflow" />                          a stand-alone "Import from…" menu
 *   <ImporterDialog importer={…} open onOpenChange />                      pick files → analyse → import
 *
 * Entries are filtered by the extension being usable here, the importer's
 * licence feature and the person's permission. The dialog posts to
 * /api/internal/importers/<id> (nothing is stored between the two calls).
 * Nothing renders in a build without extension importers.
 */

import { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CheckCircle2, ChevronDown, Download, FileUp, Upload } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { BusyBar } from '@/components/ui/busy-bar'
import { Tag } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ImporterContribution } from '@/lib/extensions/manifest'
import type { ImportReport, ImportReportItem } from '@/lib/extensions/sdk'
import { getExtensionManifest } from '@/lib/extensions/registry'
import { useExtensionResolveContext } from './extensions-provider'
import { ExtIcon } from './ext-icon'
import { NintexImportDialog } from '@/components/importers/nintex-import-dialog'

export interface ResolvedImporter extends ImporterContribution {
  /** `ext.<extension>.<key>` */
  id: string
  extensionId: string
  extensionName: string
}

/** Default permissions of an importer: every kind it makes needs its create permission. */
function permitted(c: ImporterContribution, has: (p: string) => boolean): boolean {
  if (c.permission) return has(c.permission)
  return (!c.produces.includes('workflow') || has('workflows.create') || has('workflows.edit')) && (!c.produces.includes('form') || has('forms.edit'))
}

export function useExtensionImporters(produces: 'workflow' | 'form'): ResolvedImporter[] {
  const { state, subject } = useExtensionResolveContext()
  return useMemo(() => {
    const out: ResolvedImporter[] = []
    for (const ext of state.extensions) {
      const manifest = getExtensionManifest(ext.id)
      for (const c of manifest?.contributes.importers ?? []) {
        if (!c.produces.includes(produces)) continue
        if (c.feature && !ext.features.includes(c.feature)) continue
        if (!permitted(c, subject.has)) continue
        out.push({ ...c, id: `ext.${ext.id}.${c.key}`, extensionId: ext.id, extensionName: ext.name })
      }
    }
    return out
  }, [state, subject, produces])
}

/** Menu items for an existing Import DropdownMenuContent (with a separator before them). */
export function ExtensionImporterMenuItems({ produces, onPick, separator = true }: { produces: 'workflow' | 'form'; onPick: (importer: ResolvedImporter) => void; separator?: boolean }) {
  const importers = useExtensionImporters(produces)
  if (!importers.length) return null
  return (
    <>
      {separator && <DropdownMenuSeparator />}
      {importers.map((i) => (
        <DropdownMenuItem key={i.id} icon={<ExtIcon icon={i.icon ?? 'upload'} />} onSelect={() => onPick(i)} data-importer={i.id}>
          {i.label}{i.preview ? ' (preview)' : ''}
        </DropdownMenuItem>
      ))}
    </>
  )
}

/** A stand-alone "Import from…" menu of the extension importers (renders nothing without any). */
export function ExtensionImportButton({ produces, onImported, variant = 'outline' }: { produces: 'workflow' | 'form'; onImported?: () => void; variant?: 'outline' | 'secondary' }) {
  const importers = useExtensionImporters(produces)
  const { subject } = useExtensionResolveContext()
  const [picked, setPicked] = useState<ResolvedImporter | null>(null)
  // The core Nintex importer (everyone who may create workflows); ?import=nintex opens it with presets (SharePoint dashboard links).
  const params = useSearchParams()
  const deepLink = params?.get('import') === 'nintex'
  const [nintex, setNintex] = useState(deepLink)
  const nintexAllowed = subject.has('workflows.create') || subject.has('workflows.edit')
  const presets = deepLink ? { target: params?.get('target') ?? undefined, targetConfig: params?.get('target_config') ?? undefined, workflowId: params?.get('workflow_id') ?? undefined } : {}
  if (!importers.length && !nintexAllowed) return null
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant={variant} leadingIcon={<Upload />} trailingIcon={<ChevronDown />} data-testid="extension-import-menu">Import from…</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {nintexAllowed && <DropdownMenuItem icon={<Upload />} onSelect={() => setNintex(true)} data-importer="nintex">Nintex workflow (.nwf / .nwp)</DropdownMenuItem>}
          <ExtensionImporterMenuItems produces={produces} onPick={setPicked} separator={nintexAllowed} />
        </DropdownMenuContent>
      </DropdownMenu>
      {picked && <ImporterDialog importer={picked} open={Boolean(picked)} onOpenChange={(o) => { if (!o) setPicked(null) }} onImported={onImported} />}
      {nintex && nintexAllowed && <NintexImportDialog open={nintex} onOpenChange={setNintex} onImported={onImported} presets={presets} />}
    </>
  )
}

export interface Analysis { importer: string; report: ImportReport; markdown: string }
export interface Outcome extends Analysis { created: Array<{ kind: string; id: string; name: string; href: string | null }>; warnings: string[] }

export async function post(importer: string, files: File[], action: 'analyze' | 'import', options: Record<string, unknown>): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  const body = new FormData()
  for (const f of files) body.append('file', f)
  body.append('action', action)
  body.append('options', JSON.stringify(options))
  try {
    const res = await fetch(`/api/internal/importers/${encodeURIComponent(importer)}`, { method: 'POST', body })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: json.error ?? `The request failed (${res.status})` }
    return { ok: true, data: json }
  } catch {
    return { ok: false, error: 'The upload failed — check your connection and try again' }
  }
}

export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const STATUS_TONE: Record<ImportReportItem['status'], string> = { mapped: 'text-success', partial: 'text-warning', placeholder: 'text-danger', skipped: 'text-fg-muted', info: 'text-fg-muted' }
export const STATUS_TEXT: Record<ImportReportItem['status'], string> = { mapped: 'Mapped', partial: 'Review', placeholder: 'Placeholder', skipped: 'Skipped', info: 'Info' }
export const READINESS: Record<ImportReport['readiness'], string> = { auto: 'Ready to import', review: 'Import, then review', rebuild: 'Rebuild recommended' }

type Step = 'pick' | 'busy' | 'review' | 'done'

export function ImporterDialog({ importer, open, onOpenChange, onImported }: {
  importer: Pick<ResolvedImporter, 'id' | 'label' | 'description' | 'accepts' | 'multiple' | 'preview' | 'options' | 'produces' | 'filesOptional'>
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (result: Outcome) => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [busyText, setBusyText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [values, setValues] = useState<Record<string, unknown>>(() => Object.fromEntries(importer.options.filter((o) => o.default !== undefined).map((o) => [o.name, o.default])))
  const [showAll, setShowAll] = useState(false)
  const needsFiles = importer.accepts.length > 0

  const analyse = async (picked: File[]) => {
    setError(null)
    if (needsFiles && !importer.filesOptional && !picked.length) { setError('Choose the files to import.'); return }
    setFiles(picked)
    setBusyText('Analysing…')
    setStep('busy')
    const res = await post(importer.id, picked, 'analyze', values)
    if (!res.ok) { setError(res.error); setStep(analysis ? 'review' : 'pick'); return }
    setAnalysis(res.data as Analysis)
    setStep('review')
  }

  const doImport = async () => {
    setBusyText('Importing…')
    setStep('busy')
    setError(null)
    const res = await post(importer.id, files, 'import', values)
    if (!res.ok) { setError(res.error); setStep('review'); return }
    const data = res.data as Outcome
    setOutcome(data)
    setStep('done')
    onImported?.(data)
  }

  const report = analysis?.report
  const shown = report ? (showAll ? report.items : report.items.filter((i) => i.status !== 'mapped' && i.status !== 'info')) : []
  const first = outcome?.created.find((c) => c.href)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (step !== 'busy') onOpenChange(o) }}>
      <DialogContent size="xl" title={`Import: ${importer.label}`} description={importer.description ?? undefined} data-testid="importer-dialog">
        <DialogBody className="space-y-4">
          {importer.preview && <InlineNotice tone="warning" message="Preview importer: its mapping follows the product's documented format and has not been verified on real exports yet. Review everything it makes." />}
          {error && <InlineNotice tone="danger" message={error} />}
          {(step === 'pick' || step === 'review') && importer.options.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {importer.options.map((o) => (
                <OptionField key={o.name} option={o} value={values[o.name]} onChange={(v) => setValues((prev) => ({ ...prev, [o.name]: v }))} />
              ))}
            </div>
          )}
          {step === 'pick' && (needsFiles ? (
            <div
              role="button" tabIndex={0} aria-label="Choose files"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void analyse(Array.from(e.dataTransfer.files ?? [])) }}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center hover:border-primary/60"
              data-testid="importer-drop"
            >
              <Upload className="size-8 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Drop {importer.multiple ? 'the files' : 'a file'} here, or click to browse</p>
              <p className="max-w-md text-xs text-fg-muted">{importer.accepts.join(', ')}. The files are only read for this import: they are not stored.</p>
              <input ref={inputRef} type="file" multiple={importer.multiple} accept={importer.accepts.join(',')} className="hidden" data-testid="importer-file" onChange={(e) => { void analyse(Array.from(e.target.files ?? [])); e.target.value = '' }} />
            </div>
          ) : <Button onClick={() => void analyse([])} data-testid="importer-analyse">Analyse</Button>)}
          {step === 'pick' && needsFiles && importer.filesOptional && (
            <p className="text-xs text-fg-muted">Or fill in the options above and <button type="button" className="underline" onClick={() => void analyse([])}>analyse without files</button> (the importer reads its source itself).</p>
          )}
          {step === 'busy' && (
            <div className="space-y-3 py-8 text-center" aria-live="polite">
              <BusyBar label={busyText} />
              <p className="text-sm font-medium">{busyText}</p>
            </div>
          )}
          {step === 'review' && report && (
            <div className="space-y-4" data-testid="importer-review">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <FileUp className="size-4 text-fg-muted" aria-hidden /><span className="font-semibold">{report.title}</span>
                <Tag>{report.source}</Tag>
                <Tag>{READINESS[report.readiness]}</Tag>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Coverage" value={`${report.coverage.percent}%`} hint={`${report.coverage.mapped} of ${report.coverage.total} mapped`} />
                <Stat label="To review" value={String(report.coverage.partial)} />
                <Stat label="Placeholders" value={String(report.coverage.placeholder)} hint={report.coverage.skipped ? `${report.coverage.skipped} skipped` : undefined} />
                <Stat label="Complexity" value={`${report.complexity.score}/100`} hint={report.complexity.level} />
              </div>
              {report.summary && <p className="text-sm">{report.summary}</p>}
              {report.outputs.length > 0 && (
                <p className="text-xs text-fg-muted">Makes: {report.outputs.map((o) => `${o.kind} “${o.name}”`).join(', ')} (workflows as inactive drafts).</p>
              )}
              {report.warnings.slice(0, 6).map((w, i) => <p key={i} className="flex gap-1 text-xs text-fg-muted"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{w}</p>)}
              <div className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <p className="flex-1 text-sm font-semibold">{showAll ? `All items (${report.items.length})` : `Needs attention (${shown.length})`}</p>
                  <Checkbox checked={showAll} onChange={(e) => setShowAll(e.target.checked)} label="Show all" />
                  {analysis && <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download('import-report.md', analysis.markdown, 'text/markdown')}>Markdown</Button>}
                  <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download('import-report.json', JSON.stringify(report, null, 2), 'application/json')}>JSON</Button>
                </div>
                <ul className="max-h-80 space-y-1 overflow-auto border-t border-border px-3 py-2" data-testid="importer-items">
                  {shown.length === 0 && <li className="text-xs text-fg-muted">Nothing needs attention.</li>}
                  {shown.slice(0, 500).map((i, n) => (
                    <li key={n} className="text-xs">
                      <span className={cn('font-semibold', STATUS_TONE[i.status])}>{STATUS_TEXT[i.status]}</span> · <span className="text-fg-muted">{i.kind}</span> {i.name}{i.location ? <span className="text-fg-muted"> ({i.location})</span> : null}
                      {i.mappedTo ? <> → {i.mappedTo}</> : null}{i.detail ? <span className="text-fg-muted">: {i.detail}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {step === 'done' && outcome && (
            <div className="space-y-3" data-testid="importer-done">
              <InlineNotice tone="success" message={`Imported: ${outcome.created.length} created (coverage ${outcome.report.coverage.percent}%). Workflows are drafts: review and publish them.`} />
              <ul className="space-y-1 text-sm">
                {outcome.created.map((c) => <li key={c.id} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" aria-hidden />{c.href ? <a className="underline" href={c.href}>{c.name}</a> : c.name} <span className="text-xs text-fg-muted">({c.kind})</span></li>)}
              </ul>
              {outcome.warnings.map((w, i) => <p key={i} className="text-xs text-fg-muted">{w}</p>)}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="sm:pr-32">
          {step === 'done' ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
              {first?.href && <Button onClick={() => { onOpenChange(false); router.push(first.href!) }}>Open in the designer</Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={step === 'busy'}>Cancel</Button>
              {step === 'review' && <Button variant="ghost" onClick={() => void analyse(files)}>Analyse again</Button>}
              {step === 'review' && <Button onClick={() => void doImport()} disabled={!report || report.outputs.length === 0} data-testid="importer-import">Import</Button>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OptionField({ option, value, onChange }: { option: ImporterContribution['options'][number]; value: unknown; onChange: (v: unknown) => void }) {
  const label = option.label ?? option.name
  if (option.type === 'boolean') return <Checkbox checked={value === true} onChange={(e) => onChange(e.target.checked)} label={label} description={option.description} />
  if (option.type === 'select' && option.options?.length) {
    return (
      <Field label={label} optional={!option.required} description={option.description}>
        <select className="h-9 w-full rounded-md border border-border bg-surface px-2 text-sm" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {!option.required && <option value="">—</option>}
          {option.options.map((o) => <option key={o.value} value={o.value}>{o.label ?? o.value}</option>)}
        </select>
      </Field>
    )
  }
  return (
    <Field label={label} optional={!option.required} description={option.description}>
      <Input value={String(value ?? '')} placeholder={option.placeholder} type={option.type === 'number' || option.type === 'integer' ? 'number' : 'text'} onChange={(e) => onChange(option.type === 'number' || option.type === 'integer' ? (e.target.value === '' ? undefined : Number(e.target.value)) : e.target.value)} />
    </Field>
  )
}

export function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-3 py-2">
      <p className="text-2xs uppercase tracking-wide text-fg-muted">{label}</p>
      <p className="num text-lg font-semibold">{value}</p>
      {hint && <p className="text-2xs text-fg-muted">{hint}</p>}
    </div>
  )
}
