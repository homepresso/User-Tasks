'use client'

/**
 * Import from Nintex (.nwf / .nwp / zip): the core Nintex importer's dialog.
 *
 *   1 Upload      the files (read for this import only, never stored)
 *   2 Preview     what maps: coverage, workflows, items needing attention, forms
 *   3 Where       a new workflow (manual / API or schedule), a target an
 *                 extension offers (e.g. a connected SharePoint list + events),
 *                 or replace an existing workflow (and form) as a new draft
 *   4 Confirm     the analysis for that target (what is replaced, event
 *                 conflicts and the choice for them), then Import
 *
 * In a workflow's designer (`workflowId`, e.g. the designer embedded in
 * SharePoint) the default target is the one that workflow is bound to
 * ("Connect to this SharePoint list": its list and event, imported as a new
 * draft of THIS workflow, trigger kept); the other targets stay available.
 * Targets with a column check show it on Confirm (matched / type mismatch /
 * missing, and "Add these columns to <list>?"). "Create a SharePoint list for
 * this workflow" (an extension's createTarget) makes a list from the columns
 * the workflow uses and, when asked, binds the import to it.
 *
 * Posts to /api/internal/importers/nintex; targets from GET on the same path.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react'
import { Dialog, DialogBody, DialogContent, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InlineNotice } from '@/components/ui/inline-notice'
import { BusyBar } from '@/components/ui/busy-bar'
import { Tag } from '@/components/ui/badge'
import { serverRead } from '@/lib/server-read'
import { cn } from '@/lib/utils'
import { download, post, READINESS, Stat, STATUS_TEXT, STATUS_TONE, type Analysis, type Outcome } from '@/components/extensions/importers'
import { NintexColumnCheck, type ColumnCheckView } from './nintex-column-check'
import { NintexCreateList, type CreatedTarget, type CreateTargetInfo, type NeededColumn } from './nintex-create-list'

interface TargetField { name: string; label: string; type: 'select' | 'multiselect' | 'text' | 'boolean'; options?: Array<{ value: string; label: string }>; required?: boolean; default?: string | string[] | boolean; description?: string }
interface Target { id: string; label: string; description: string | null; extension: string | null; fields: TargetField[] }
interface Bound { id: string; label: string; description: string | null; extension: string; config: Record<string, unknown>; workflow: { id: string; name: string } }
interface Details {
  workflows: Array<{ name: string; file: string; format: string; workflowType: string; start: { manual: boolean; onCreate: boolean; onChange: boolean }; trigger: { label: string } | null; actions: number; steps: number; tasks: number; placeholders: number; coverage: number; replacing: { name: string; unpublishedChanges: boolean } | null; columns?: ColumnCheckView | null; startParameters?: Array<{ name: string; label: string; type: string; required: boolean }>; columnsNeeded?: NeededColumn[]; suggestedTarget?: { name: string; kind: string } }>
  conflicts: Array<{ workflowId: string; name: string; detail: string }>
  forms: Array<{ name: string; kind: string; fields: number; skipped: number; rules: number }>
  needsConfirm: boolean
  assignees?: Array<{ name: string; tasks: number; resolved: { kind: string; label: string; origin?: string } | null }>
}

type Step = 'upload' | 'busy' | 'preview' | 'newlist' | 'where' | 'confirm' | 'done'

const SELECT = 'h-9 w-full rounded-md border border-border bg-surface px-2 text-sm'

export function NintexImportDialog({ open, onOpenChange, onImported, presets = {}, designer = null, onOpenResult }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (result: Outcome) => void
  /** From a deep link (?import=nintex&target=…&target_config=…&workflow_id=…). */
  presets?: { target?: string; targetConfig?: string; workflowId?: string }
  /** Opened from a workflow's designer (e.g. embedded in SharePoint): its id and whether it has unsaved changes. */
  designer?: { workflowId: string; dirty: boolean } | null
  /** Open an imported workflow (default: the router); `same`: it is the designer's own workflow (reload it). */
  onOpenResult?: (href: string, same: boolean) => void
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('upload')
  const [busyText, setBusyText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<Analysis | null>(null)
  const [plan, setPlan] = useState<Analysis | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [targets, setTargets] = useState<Target[]>([])
  const [target, setTarget] = useState(presets.target ?? 'new')
  const [targetConfig, setTargetConfig] = useState<Record<string, unknown>>(() => { try { return presets.targetConfig ? JSON.parse(presets.targetConfig) : {} } catch { return {} } })
  const [trigger, setTrigger] = useState('auto')
  const [name, setName] = useState('')
  const [workflowId, setWorkflowId] = useState(presets.workflowId ?? '')
  const [replaceExisting, setReplaceExisting] = useState(Boolean(presets.workflowId))
  const [whichWorkflow, setWhichWorkflow] = useState('')
  const [formsMode, setFormsMode] = useState<'new' | 'skip' | 'replace'>('new')
  const [formId, setFormId] = useState('')
  const [conflicts, setConflicts] = useState<'keep_both' | 'remove_from_other'>('keep_both')
  const [confirmed, setConfirmed] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([])
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([])
  const [people, setPeople] = useState<Array<{ id: string; label: string }>>([])
  const [teams, setTeams] = useState<Array<{ id: string; label: string }>>([])
  const [assigneeMap, setAssigneeMap] = useState<Record<string, string>>({})
  const [bound, setBound] = useState<Bound | null>(null)
  const [keepTrigger, setKeepTrigger] = useState(false)
  const [moreTargets, setMoreTargets] = useState(false)
  const [createInfo, setCreateInfo] = useState<CreateTargetInfo | null>(null)
  const [wantList, setWantList] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [madeList, setMadeList] = useState<CreatedTarget | null>(null)

  useEffect(() => {
    if (!open) return
    const q = designer?.workflowId ? `?workflow_id=${encodeURIComponent(designer.workflowId)}` : ''
    void fetch(`/api/internal/importers/nintex${q}`).then((r) => r.json()).then((j) => {
      setTargets(Array.isArray(j?.targets) ? j.targets : [])
      // The designer's own target first: "Connect to this SharePoint list" (a new draft of this workflow, its trigger kept).
      const b = j?.bound as Bound | null
      if (b && !presets.target) {
        setBound(b); setTarget(b.id); setTargetConfig(b.config ?? {}); setWorkflowId(b.workflow.id); setReplaceExisting(true); setKeepTrigger(true); setFormsMode('skip')
      }
    }).catch(() => undefined)
    void fetch(`/api/internal/importers/nintex/create-target${q}`).then((r) => (r.ok ? r.json() : null)).then((j) => setCreateInfo((j?.info as CreateTargetInfo | null) ?? null)).catch(() => undefined)
    void serverRead('automations.list').then((r) => setWorkflows(((r.data ?? []) as Array<{ id: string; name: string }>).map((w) => ({ id: w.id, name: w.name })))).catch(() => undefined)
    void serverRead('automations.userOptions').then((r) => setPeople(((r.data ?? []) as Array<{ id: string; display_name?: string; email?: string }>).map((u) => ({ id: u.id, label: u.display_name ? `${u.display_name} (${u.email})` : String(u.email) })))).catch(() => undefined)
    void serverRead('automations.teamOptions').then((r) => setTeams(((r.data ?? []) as Array<{ id: string; name: string; origin?: string }>).map((t) => ({ id: t.id, label: t.origin && t.origin !== 'internal' ? `${t.name} · ${t.origin}` : t.name })))).catch(() => undefined)
    void serverRead('forms.list').then((r) => { const d = r.data as unknown; const rows = Array.isArray(d) ? d : (d as { forms?: unknown[] })?.forms ?? []; setForms((rows as Array<{ id: string; name: string }>).map((f) => ({ id: f.id, name: f.name }))) }).catch(() => undefined)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps -- once per opening

  const chosen = targets.find((t) => t.id === target)
  const usingBound = Boolean(bound) && target === bound!.id && keepTrigger
  const replacing = target === 'replace' || (target.startsWith('ext.') && replaceExisting)
  const intoDesigner = Boolean(designer) && replacing && workflowId === designer!.workflowId
  const options = () => ({
    target, trigger, name: name || undefined,
    ...(replacing && workflowId ? { workflow_id: workflowId } : {}),
    ...(whichWorkflow ? { workflow: whichWorkflow } : {}),
    ...(target.startsWith('ext.') ? { target_config: JSON.stringify(targetConfig) } : {}),
    forms: formsMode, ...(formsMode === 'replace' && formId ? { form_id: formId } : {}),
    conflicts, confirm: confirmed, ...(usingBound ? { keep_trigger: true } : {}),
    ...(Object.keys(assigneeMap).length ? { assignee_map: JSON.stringify(assigneeMap) } : {}),
  })

  const run = async (action: 'analyze' | 'import', opts: Record<string, unknown>, text: string, from: Step) => {
    setError(null); setBusyText(text); setStep('busy')
    const res = await post('nintex', files, action, opts)
    if (!res.ok) { setError(res.error); setStep(from); return null }
    return res.data
  }
  const analysePreview = async (picked: File[]) => {
    if (!picked.length) { setError('Choose the Nintex files.'); return }
    setFiles(picked)
    setError(null); setBusyText('Reading the Nintex files…'); setStep('busy')
    const res = await post('nintex', picked, 'analyze', { target: 'new', forms: 'new' })
    if (!res.ok) { setError(res.error); setStep('upload'); return }
    setPreview(res.data as Analysis)
    setStep(wantList && createInfo ? 'newlist' : 'preview')
  }
  const analysePlan = async () => {
    if (replacing && !workflowId) { setError('Pick the workflow to replace.'); return }
    if (formsMode === 'replace' && !formId) { setError('Pick the form to replace.'); return }
    const data = await run('analyze', options(), 'Checking the target…', 'where')
    if (data) { setPlan(data as Analysis); setConfirmed(false); setStep('confirm') }
  }
  /** After columns were added: analyse the same target again. */
  const recheck = async (message: string) => {
    setNotice(message)
    const data = await run('analyze', options(), 'Checking the columns again…', 'confirm')
    if (data) { setPlan(data as Analysis); setStep('confirm') }
  }
  /** A list was made for the workflow; `bind`: it becomes the import target (a new workflow on it, events from Nintex). */
  const listCreated = async (made: CreatedTarget, bind: boolean) => {
    setMadeList(made)
    setNotice(`${made.existing ? 'Using the existing list' : 'Created the list'} "${made.title}"${made.created.length ? ` with ${made.created.length} column(s)` : ''}.${made.failed.length ? ` Not added: ${made.failed.map((f) => `${f.label} (${f.reason})`).join('; ')}.` : ''}${made.notes.length ? ` ${made.notes.join(' ')}` : ''}`)
    if (!bind) { setStep('preview'); return }
    setTarget(made.id); setTargetConfig(made.config); setReplaceExisting(false); setKeepTrigger(false); setWorkflowId(''); setFormsMode('skip')
    const opts = { ...options(), target: made.id, target_config: JSON.stringify(made.config), keep_trigger: undefined, workflow_id: undefined, forms: 'skip' }
    const data = await run('analyze', opts, 'Checking the new list…', 'preview')
    if (data) { setPlan(data as Analysis); setConfirmed(false); setStep('confirm') }
  }
  const doImport = async () => {
    const data = await run('import', { ...options(), confirm: confirmed }, 'Importing…', 'confirm')
    if (!data) return
    setOutcome(data as Outcome); setStep('done'); onImported?.(data as Outcome)
  }

  const report = (step === 'confirm' ? plan : preview)?.report
  const details = report?.details as unknown as Details | undefined
  const previewDetails = preview?.report.details as unknown as Details | undefined
  const shown = report ? (showAll ? report.items : report.items.filter((i) => i.status !== 'mapped' && i.status !== 'info')) : []
  const first = outcome?.created.find((c) => c.href)
  const needsConfirm = Boolean(details?.needsConfirm)

  return (
    <Dialog open={open} onOpenChange={(o) => { if (step !== 'busy') onOpenChange(o) }}>
      <DialogContent size="xl" title="Import from Nintex" description="Nintex for SharePoint workflow exports (.nwf), Nintex for Office 365 packages (.nwp, with their Nintex Forms) or a zip of them." data-testid="nintex-import-dialog">
        <DialogBody className="space-y-4">
          <ol className="flex flex-wrap gap-3 text-xs text-fg-muted" aria-label="Steps">
            {(['Upload', 'Preview', 'Where should this go?', 'Confirm'] as const).map((label, i) => {
              const at = { upload: 0, busy: -1, preview: 1, newlist: 1, where: 2, confirm: 3, done: 4 }[step]
              return <li key={label} className={cn(at === i && 'font-semibold text-fg')}>{i + 1}. {label}</li>
            })}
          </ol>
          {error && <InlineNotice tone="danger" message={error} />}
          {notice && step !== 'done' && <InlineNotice tone="success" message={notice} />}
          {bound && step === 'upload' && <InlineNotice tone="info" message={`${bound.label}: ${bound.description ?? bound.workflow.name}. The import becomes a new draft of this workflow, ready to review and publish.`} />}

          {step === 'upload' && (
            <div
              role="button" tabIndex={0} aria-label="Choose Nintex files"
              onClick={() => inputRef.current?.click()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click() } }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); void analysePreview(Array.from(e.dataTransfer.files ?? [])) }}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-10 text-center hover:border-primary/60"
              data-testid="nintex-drop"
            >
              <Upload className="size-8 text-primary" aria-hidden />
              <p className="text-sm font-semibold">Drop the Nintex files here, or click to browse</p>
              <p className="max-w-md text-xs text-fg-muted">.nwf, .nwp or .zip. The files are only read for this import: they are not stored.</p>
              <input ref={inputRef} type="file" multiple accept=".nwf,.nwp,.zip,.xml" className="hidden" data-testid="nintex-file" onChange={(e) => { void analysePreview(Array.from(e.target.files ?? [])); e.target.value = '' }} />
            </div>
          )}
          {step === 'upload' && createInfo && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
              <Button size="sm" variant="secondary" onClick={() => { setWantList(true); inputRef.current?.click() }} data-testid="nintex-create-list-start">{createInfo.label}</Button>
              <span>Choose the Nintex files: the list is proposed from the columns the workflow uses.</span>
            </div>
          )}

          {step === 'newlist' && createInfo && (
            <NintexCreateList
              info={createInfo}
              defaults={{ name: previewDetails?.workflows[0]?.suggestedTarget?.name ?? 'Workflow items', kind: previewDetails?.workflows[0]?.suggestedTarget?.kind ?? 'list' }}
              columns={previewDetails?.workflows[0]?.columnsNeeded ?? []}
              onCancel={() => { setWantList(false); setStep('preview') }}
              onCreated={(made, bind) => { setWantList(false); void listCreated(made, bind) }}
            />
          )}

          {step === 'busy' && (
            <div className="space-y-3 py-8 text-center" aria-live="polite"><BusyBar label={busyText} /><p className="text-sm font-medium">{busyText}</p></div>
          )}

          {(step === 'preview' || step === 'confirm') && report && (
            <div className="space-y-4" data-testid={`nintex-${step}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold">{report.title}</span><Tag>{READINESS[report.readiness]}</Tag></div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Coverage" value={`${report.coverage.percent}%`} hint={`${report.coverage.mapped} of ${report.coverage.total} mapped`} />
                <Stat label="To review" value={String(report.coverage.partial)} />
                <Stat label="Placeholders" value={String(report.coverage.placeholder)} />
                <Stat label="Complexity" value={`${report.complexity.score}/100`} hint={report.complexity.level} />
              </div>
              {report.summary && <p className="text-sm">{report.summary}</p>}
              {details && details.workflows.length > 0 && (
                <ul className="space-y-1 text-xs" data-testid="nintex-workflows">
                  {details.workflows.map((w) => (
                    <li key={w.file + w.name}><span className="font-semibold">{w.name}</span> <span className="text-fg-muted">({w.file}, {w.format}{w.workflowType !== 'List' ? `, ${w.workflowType.toLowerCase()} workflow` : ''})</span>: {w.actions} actions → {w.steps} steps, {w.tasks} task(s), {w.placeholders} to rebuild, {w.coverage}% mapped. Nintex start: {[w.start.manual && 'manual', w.start.onCreate && 'on create', w.start.onChange && 'on change'].filter(Boolean).join(', ') || 'none'}{w.trigger ? ` → ${w.trigger.label}` : ''}{w.replacing ? ` · replaces “${w.replacing.name}” (new draft)` : ''}</li>
                  ))}
                </ul>
              )}
              {details && details.forms.length > 0 && <p className="text-xs text-fg-muted">Nintex Forms: {details.forms.map((f) => `${f.name} (${f.fields} fields${f.skipped ? `, ${f.skipped} controls not converted` : ''})`).join('; ')}</p>}
              {report.warnings.slice(0, 8).map((w, i) => <p key={i} className="flex gap-1 text-xs text-fg-muted"><AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />{w}</p>)}
              {step === 'confirm' && details?.workflows.map((w) => w.columns ? (
                <NintexColumnCheck key={`${w.file}:${w.name}:${JSON.stringify(w.columns.counts)}`} check={w.columns} target={target} targetConfig={targetConfig} onAdded={(m) => void recheck(m)} />
              ) : null)}
              {step === 'confirm' && details?.workflows.some((w) => w.startParameters?.length) && (
                <p className="text-xs text-fg-muted" data-testid="nintex-start-parameters">Start form → start parameters: {details.workflows.flatMap((w) => w.startParameters ?? []).map((x) => `${x.label}${x.required ? ' (required)' : ''}`).join(', ')}</p>
              )}
              {step === 'confirm' && intoDesigner && designer?.dirty && <InlineNotice tone="warning" message="This workflow has unsaved changes in the designer: save them first, or they are replaced by the import." />}
              {step === 'confirm' && details && details.conflicts.length > 0 && (
                <Field label="Other workflows already run on these events">
                  <select className={SELECT} value={conflicts} onChange={(e) => setConflicts(e.target.value as typeof conflicts)} data-testid="nintex-conflicts">
                    <option value="keep_both">Keep both</option>
                    <option value="remove_from_other">Remove the events from the other workflow{details.conflicts.length > 1 ? 's' : ''}</option>
                  </select>
                </Field>
              )}
              {step === 'confirm' && needsConfirm && (
                <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label="Replace the draft" description="The workflow (or form) keeps its id, name, versions and run history; the import becomes its new draft. The published version keeps running until you publish." data-testid="nintex-confirm" />
              )}
              <div className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <p className="flex-1 text-sm font-semibold">{showAll ? `All items (${report.items.length})` : `Needs attention (${shown.length})`}</p>
                  <Checkbox checked={showAll} onChange={(e) => setShowAll(e.target.checked)} label="Show all" />
                  <Button size="sm" variant="ghost" leadingIcon={<Download />} onClick={() => download('nintex-import-report.json', JSON.stringify(report, null, 2), 'application/json')}>JSON</Button>
                </div>
                <ul className="max-h-64 space-y-1 overflow-auto border-t border-border px-3 py-2">
                  {shown.length === 0 && <li className="text-xs text-fg-muted">Nothing needs attention.</li>}
                  {shown.slice(0, 500).map((i, n) => (
                    <li key={n} className="text-xs"><span className={cn('font-semibold', STATUS_TONE[i.status])}>{STATUS_TEXT[i.status]}</span> · {i.name}{i.location ? <span className="text-fg-muted"> ({i.location})</span> : null}{i.mappedTo ? <> → {i.mappedTo}</> : null}{i.detail ? <span className="text-fg-muted">: {i.detail}</span> : null}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step === 'where' && (
            <div className="space-y-3" data-testid="nintex-where">
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">Where should this go?</legend>
                {bound && (
                  <label className="flex cursor-pointer gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary" data-testid="nintex-target-bound">
                    <input type="radio" name="nintex-target" value="bound" checked={usingBound} onChange={() => { setTarget(bound.id); setTargetConfig(bound.config ?? {}); setWorkflowId(bound.workflow.id); setReplaceExisting(true); setKeepTrigger(true) }} />
                    <span><span className="font-semibold">{bound.label}</span> <span className="text-xs text-fg-muted">· recommended</span><span className="block text-xs text-fg-muted">{bound.description ?? ''}{bound.description ? '. ' : ''}Checks the list&apos;s columns, wires the steps to its items and becomes a new draft of “{bound.workflow.name}”.</span></span>
                  </label>
                )}
                {bound && !moreTargets && <Button size="sm" variant="ghost" onClick={() => setMoreTargets(true)}>Other options</Button>}
                {(!bound || moreTargets) && (targets.length ? targets : [{ id: 'new', label: 'A new workflow', description: null, extension: null, fields: [] }, { id: 'replace', label: 'Replace an existing workflow', description: null, extension: null, fields: [] }] as Target[]).map((t) => (
                  <label key={t.id} className="flex cursor-pointer gap-2 rounded-lg border border-border px-3 py-2 text-sm has-[:checked]:border-primary">
                    <input type="radio" name="nintex-target" value={t.id} checked={target === t.id && !usingBound} onChange={() => { setTarget(t.id); setKeepTrigger(false); if (t.id === 'new') setReplaceExisting(false) }} />
                    <span><span className="font-semibold">{t.label}</span>{t.extension ? <span className="text-xs text-fg-muted"> · {t.extension}</span> : null}{t.description ? <span className="block text-xs text-fg-muted">{t.description}</span> : null}</span>
                  </label>
                ))}
              </fieldset>
              {target === 'new' && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Starts">
                    <select className={SELECT} value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                      <option value="auto">As in Nintex (site workflows: on a schedule)</option>
                      <option value="manual">Manually / by API</option>
                      <option value="schedule">On a schedule</option>
                    </select>
                  </Field>
                  {previewDetails?.workflows.length === 1 && <Field label="Name" optional><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={previewDetails!.workflows[0].name} /></Field>}
                </div>
              )}
              {!usingBound && chosen?.fields.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {chosen.fields.map((f) => (
                    <Field key={f.name} label={f.label} optional={!f.required} description={f.description}>
                      {f.type === 'select' ? (
                        <select className={SELECT} value={String(targetConfig[f.name] ?? f.default ?? '')} onChange={(e) => setTargetConfig((c) => ({ ...c, [f.name]: e.target.value }))}>
                          <option value="">—</option>
                          {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      ) : f.type === 'multiselect' ? (
                        <div className="flex flex-wrap gap-3">
                          {(f.options ?? []).map((o) => {
                            const cur = (targetConfig[f.name] ?? f.default ?? []) as string[]
                            return <Checkbox key={o.value} checked={cur.includes(o.value)} label={o.label} onChange={(e) => setTargetConfig((c) => ({ ...c, [f.name]: e.target.checked ? [...cur, o.value] : cur.filter((x) => x !== o.value) }))} />
                          })}
                        </div>
                      ) : f.type === 'boolean' ? (
                        <Checkbox checked={Boolean(targetConfig[f.name] ?? f.default)} label={f.label} onChange={(e) => setTargetConfig((c) => ({ ...c, [f.name]: e.target.checked }))} />
                      ) : (
                        <Input value={String(targetConfig[f.name] ?? f.default ?? '')} onChange={(e) => setTargetConfig((c) => ({ ...c, [f.name]: e.target.value }))} />
                      )}
                    </Field>
                  ))}
                </div>
              ) : null}
              {target.startsWith('ext.') && !usingBound && <Checkbox checked={replaceExisting} onChange={(e) => setReplaceExisting(e.target.checked)} label="Replace an existing workflow instead of making a new one" />}
              {replacing && !usingBound && (
                <Field label="Workflow to replace" description="It gets the import as its new draft; review, then publish.">
                  <select className={SELECT} value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} data-testid="nintex-workflow-picker">
                    <option value="">—</option>
                    {workflows.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </Field>
              )}
              {replacing && (previewDetails?.workflows.length ?? 0) > 1 && (
                <Field label="Which workflow of the upload">
                  <select className={SELECT} value={whichWorkflow} onChange={(e) => setWhichWorkflow(e.target.value)}>
                    {previewDetails!.workflows.map((w) => <option key={w.file + w.name} value={w.name}>{w.name}</option>)}
                  </select>
                </Field>
              )}
              {(previewDetails?.assignees ?? []).length > 0 && (
                <div className="space-y-2" data-testid="nintex-assignees">
                  <p className="text-sm font-semibold">Task assignees</p>
                  <p className="text-xs text-fg-muted">Nintex people and groups matched to this workspace by e-mail, login or team name. Pick someone for the rest (or leave them to choose later in the designer).</p>
                  {previewDetails!.assignees!.map((a) => (
                    <div key={a.name} className="grid items-center gap-2 sm:grid-cols-2">
                      <span className="text-xs"><span className="font-semibold">{a.name}</span> <span className="text-fg-muted">({a.tasks} task{a.tasks === 1 ? '' : 's'}){a.resolved && !assigneeMap[a.name] ? ` → ${a.resolved.label}${a.resolved.origin ? ` · ${a.resolved.origin}` : ''}` : ''}</span></span>
                      <select className={SELECT} value={assigneeMap[a.name] ?? ''} onChange={(e) => setAssigneeMap((m) => { const next = { ...m }; if (e.target.value) next[a.name] = e.target.value; else delete next[a.name]; return next })} aria-label={`Assignee for ${a.name}`}>
                        <option value="">{a.resolved ? 'As matched' : '— choose later —'}</option>
                        <option value="initiator">The person who started the workflow</option>
                        <option value="manager">Their manager</option>
                        <optgroup label="Teams">{teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.label}</option>)}</optgroup>
                        <optgroup label="People">{people.map((u) => <option key={u.id} value={`user:${u.id}`}>{u.label}</option>)}</optgroup>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              {(previewDetails?.forms.length ?? 0) > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Nintex Forms">
                    <select className={SELECT} value={formsMode} onChange={(e) => setFormsMode(e.target.value as typeof formsMode)}>
                      <option value="new">New forms</option>
                      <option value="skip">Do not import</option>
                      <option value="replace">Replace an existing form (new draft)</option>
                    </select>
                  </Field>
                  {formsMode === 'replace' && (
                    <Field label="Form to replace">
                      <select className={SELECT} value={formId} onChange={(e) => setFormId(e.target.value)}>
                        <option value="">—</option>
                        {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </Field>
                  )}
                </div>
              )}
            </div>
          )}

          {step === 'done' && outcome && (
            <div className="space-y-3" data-testid="nintex-done">
              <InlineNotice tone="success" message={`Imported: ${outcome.created.length} (coverage ${outcome.report.coverage.percent}%). Workflows are drafts: review and publish them.`} />
              <ul className="space-y-1 text-sm">{outcome.created.map((c) => <li key={c.id} className="flex items-center gap-1.5"><CheckCircle2 className="size-4 text-success" aria-hidden />{c.href ? <a className="underline" href={c.href}>{c.name}</a> : c.name} <span className="text-xs text-fg-muted">({c.kind})</span></li>)}</ul>
              {outcome.warnings.map((w, i) => <p key={i} className="text-xs text-fg-muted">{w}</p>)}
            </div>
          )}
        </DialogBody>
        <DialogFooter className="sm:pr-32">
          {step === 'done' ? (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)}>Close</Button>
              {first?.href && <Button onClick={() => { onOpenChange(false); const same = Boolean(designer) && first.id === designer!.workflowId; if (onOpenResult) onOpenResult(first.href!, same); else router.push(first.href!) }} data-testid="nintex-open-result">{designer && first.id === designer.workflowId ? 'Open the new draft' : 'Open in the designer'}</Button>}
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={step === 'busy'}>Cancel</Button>
              {step === 'preview' && createInfo && !madeList && <Button variant="secondary" onClick={() => setStep('newlist')} data-testid="nintex-create-list-open">{createInfo.label}</Button>}
              {step === 'preview' && <Button onClick={() => setStep('where')} data-testid="nintex-next">Next: where should this go?</Button>}
              {step === 'where' && <><Button variant="ghost" onClick={() => setStep('preview')}>Back</Button><Button onClick={() => void analysePlan()} data-testid="nintex-check">Check</Button></>}
              {step === 'confirm' && <><Button variant="ghost" onClick={() => setStep('where')}>Back</Button><Button onClick={() => void doImport()} disabled={needsConfirm && !confirmed} data-testid="nintex-import">Import</Button></>}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
