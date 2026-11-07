'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, ExternalLink, FileText, ScanSearch, Wand2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SubmitButton } from '@/components/ui/submit-button'
import { downloadJobFile, useJobs } from '@/components/jobs/jobs-provider'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { serverRead } from '@/lib/server-read'
import { formDefinitionKey, type FormDefinition } from '@/lib/forms/definition'
import type { DesignerState } from '@/lib/forms/designer-state'
import type { FormThemeOverrides } from '@/lib/forms/form-theme'
import {
  checkFormAccessibility, mergeFindings, SEVERITIES,
  type AccessibilityFinding, type AccessibilityFix, type AccessibilityResult, type Severity,
} from '@/lib/forms/accessibility'
import { applyFixToDesigner, designerIdForKey } from '@/lib/forms/accessibility/designer'
import { WCAG_CRITERIA, wcagUrl } from '@/lib/forms/accessibility/wcag'
import { DEFAULT_FORM_ACCESSIBILITY, type FormAccessibilitySettings } from '@/lib/forms/accessibility/settings'
import type { UserJobView } from '@/lib/user-jobs/types'
import type { ThemeMode } from '@/lib/theme/schema'

/**
 * The form designer's Accessibility tab: the WCAG 2.2 AA score of the form
 * being edited (lib/forms/accessibility, recomputed on every change), its
 * findings by severity with links to the WCAG "Understanding" pages, fixes
 * applied through the designer's history (undoable), an axe-core scan of
 * the live preview (light and dark) merged into the findings, and CSV / PDF
 * reports as a background job. The same score drives the save check
 * (workspace setting forms.accessibility: off / warn / block).
 */

const SEVERITY_LABEL: Record<Severity, string> = { critical: 'Critical', serious: 'Serious', moderate: 'Moderate', minor: 'Minor', review: 'Needs review' }
const SEVERITY_COLOR: Record<Severity, string> = {
  critical: 'var(--status-blocked)', serious: 'var(--status-blocked)', moderate: 'var(--theme-warning, var(--status-blocked))', minor: 'var(--theme-muted-text)', review: 'var(--theme-muted-text)',
}

export interface FormAccessibilityState {
  result: AccessibilityResult
  settings: FormAccessibilitySettings
  /** axe findings of the last scan (null = none, or out of date). */
  axe: AccessibilityFinding[] | null
  axeStale: boolean
  setAxe: (findings: AccessibilityFinding[] | null) => void
  /** The save check applies: the score is below the workspace minimum. */
  belowMinimum: boolean
}

/** Score, merged axe findings and the workspace setting for the designer's current definition. */
export function useFormAccessibility(definition: FormDefinition, overrides: FormThemeOverrides | null, surface?: 'task' | 'page'): FormAccessibilityState {
  const { theme } = useWorkspaceTheme()
  const { data: settings = DEFAULT_FORM_ACCESSIBILITY } = useQuery({
    queryKey: ['forms-accessibility-settings'],
    staleTime: 60_000,
    queryFn: async () => (await serverRead('forms.accessibilitySettings')).data ?? DEFAULT_FORM_ACCESSIBILITY,
  })
  const key = useMemo(() => formDefinitionKey(definition), [definition])
  const base = useMemo(() => checkFormAccessibility(definition, {
    theme: { light: theme.colors.light, dark: theme.colors.dark, overrides },
    language: typeof document !== 'undefined' ? document.documentElement.lang || null : 'en',
    surface,
  }), [definition, theme, overrides, surface])
  const [scan, setScan] = useState<{ key: string; findings: AccessibilityFinding[] } | null>(null)
  const fresh = scan && scan.key === key ? scan.findings : null
  const result = useMemo(() => (fresh ? mergeFindings(base, fresh) : base), [base, fresh])
  return {
    result,
    settings,
    axe: fresh,
    axeStale: Boolean(scan && scan.key !== key),
    setAxe: (findings) => setScan(findings ? { key, findings } : null),
    belowMinimum: settings.mode !== 'off' && result.score < settings.min_score,
  }
}

function scoreWord(score: number, min: number): string {
  if (score >= 95) return 'Excellent'
  if (score >= Math.max(min, 80)) return 'Good'
  if (score >= 50) return 'Needs work'
  return 'Poor'
}

function scoreColor(score: number, min: number): string {
  if (score >= Math.max(min, 80)) return 'var(--theme-success, var(--theme-primary))'
  if (score >= 50) return 'var(--theme-warning, var(--status-blocked))'
  return 'var(--status-blocked)'
}

export function ScoreRing({ score, min, size = 64 }: { score: number; min: number; size?: number }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="shrink-0">
      <circle className="stroke-border" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={6} strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} style={{ stroke: scoreColor(score, min) }} />
      <text className="fill-fg" x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.3} fontWeight={600}>{score}</text>
    </svg>
  )
}

/** Wait for React to paint the preview after a view / mode switch. */
const nextPaint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120))))

export function AccessibilityPanel({ a11y, state, definition, formName, formId, view, setView, previewMode, setPreviewMode, onChange, onSelectField }: {
  a11y: FormAccessibilityState
  state: DesignerState
  definition: FormDefinition
  formName: string
  /** The reusable form being edited, if any (report title / file only). */
  formId?: string | null
  view: 'design' | 'preview'
  setView: (view: 'design' | 'preview') => void
  previewMode: ThemeMode
  setPreviewMode: (mode: ThemeMode) => void
  onChange: (next: DesignerState, tag?: string) => void
  onSelectField: (designerId: string) => void
}) {
  const { result, settings } = a11y
  const rootRef = useRef<HTMLDivElement>(null)
  const scanGuard = useSubmitGuard()
  const exportGuard = useSubmitGuard()
  const jobs = useJobs()
  const [scanError, setScanError] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ finding: AccessibilityFinding; value: string } | null>(null)
  const [report, setReport] = useState<{ format: 'csv' | 'pdf'; job: UserJobView | null; error?: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const lastScore = useRef(result.score)

  // Announce score changes (politely, once the edits settle).
  useEffect(() => {
    if (lastScore.current === result.score) return
    const timer = setTimeout(() => {
      setAnnouncement(`Accessibility score ${result.score} out of 100, ${result.summary.total} finding${result.summary.total === 1 ? '' : 's'}`)
      lastScore.current = result.score
    }, 600)
    return () => clearTimeout(timer)
  }, [result.score, result.summary.total])

  const groups = useMemo(() => SEVERITIES.map((s) => ({ severity: s, items: result.findings.filter((f) => f.severity === s) })).filter((g) => g.items.length), [result.findings])

  function apply(fix: AccessibilityFix, answer?: string) {
    onChange(applyFixToDesigner(state, fix, answer), `a11y-${fix.kind}-${fix.field_key ?? fix.button_id ?? ''}-${Date.now()}`)
  }

  function select(f: AccessibilityFinding) {
    const id = designerIdForKey(state, f.field_key)
    if (!id) return
    setView('design')
    onSelectField(id)
    requestAnimationFrame(() => document.getElementById(`form-cell-${id}`)?.focus())
  }

  async function scan() {
    await scanGuard.run(async () => {
      setScanError(null)
      const before = { view, mode: previewMode }
      // No colour transitions while switching light / dark: axe would measure half-way colours.
      const still = document.createElement('style')
      still.textContent = '[data-preview-mode] *, [data-preview-mode] *::before, [data-preview-mode] *::after { transition: none !important; animation: none !important }'
      document.head.appendChild(still)
      try {
        const { runAxeScan } = await import('@/lib/forms/accessibility/axe')
        const designer = rootRef.current?.closest('[data-testid="form-designer"]') ?? document
        if (view !== 'preview') setView('preview')
        const found: AccessibilityFinding[] = []
        for (const mode of ['light', 'dark'] as const) {
          setPreviewMode(mode)
          await nextPaint()
          const el = designer.querySelector('[data-preview-mode]')
          if (!el) throw new Error('The preview did not render')
          found.push(...await runAxeScan(el, { mode, idPrefix: 'preview-', fieldKeys: definition.fields.map((f) => f.key) }))
        }
        a11y.setAxe(found)
        setAnnouncement(`axe scan finished: ${found.length} issue${found.length === 1 ? '' : 's'} in the preview`)
      } catch (e) {
        setScanError(e instanceof Error ? e.message : 'The scan failed')
      } finally {
        still.remove()
        setPreviewMode(before.mode)
        if (before.view !== 'preview') setView(before.view)
      }
    })
  }

  async function exportReport(format: 'csv' | 'pdf') {
    await exportGuard.run(async () => {
      setReport({ format, job: null })
      try {
        const job = await jobs.start('form.accessibility_report', { format, name: formName || 'Form', ...(formId ? { form_id: formId } : {}) }, {
          effect: 'download',
          quietIfInline: true,
          pendingMessage: `Preparing the accessibility report (${format.toUpperCase()})…`,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omitted from the rest
          input: { text: JSON.stringify({ definition, extra_findings: (a11y.axe ?? []).map(({ fix: _fix, ...f }) => ({ ...f, source: 'axe' })) }) },
        })
        if (!job) throw new Error('Could not start the report')
        setReport({ format, job })
        const done = job.status === 'queued' || job.status === 'running' ? await jobs.wait(job.id) : job
        setReport({ format, job: done, ...(done.status !== 'succeeded' ? { error: done.error ?? `The report ${done.status}` } : {}) })
      } catch (e) {
        setReport({ format, job: null, error: e instanceof Error ? e.message : 'Could not start the report' })
      }
    })
  }

  const policy = settings.mode === 'off' ? 'No check when saving.' : `Saving ${settings.mode === 'block' ? 'is blocked' : 'warns'} below ${settings.min_score}.`

  return (
    <div ref={rootRef} role="tabpanel" aria-labelledby="designer-tab-a11y" className="space-y-3 text-xs" data-testid="accessibility-panel">
      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>
      <div className="flex items-center gap-3">
        <ScoreRing score={result.score} min={settings.min_score} />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Accessibility</h2>
          <p data-testid="a11y-score"><span className="font-semibold">{result.score}/100</span> · {scoreWord(result.score, settings.min_score)}</p>
          <p className="text-fg-muted">WCAG 2.2 AA. {policy}</p>
        </div>
      </div>
      <p className="sr-only">
        {result.summary.critical} critical, {result.summary.serious} serious, {result.summary.moderate} moderate, {result.summary.minor} minor, {result.summary.review} to review.
      </p>

      <div className="flex flex-wrap gap-1.5">
        <SubmitButton type="button" size="sm" variant="outline" onClick={() => void scan()} pending={scanGuard.pending} pendingLabel="Scanning…" data-testid="a11y-scan">
          <ScanSearch size={12} aria-hidden /> Scan preview with axe
        </SubmitButton>
        <SubmitButton type="button" size="sm" variant="ghost" onClick={() => void exportReport('csv')} pending={exportGuard.pending && report?.format === 'csv'} disabled={exportGuard.pending} pendingLabel="Exporting…" data-testid="a11y-export-csv">
          <FileText size={12} aria-hidden /> Export CSV
        </SubmitButton>
        <SubmitButton type="button" size="sm" variant="ghost" onClick={() => void exportReport('pdf')} pending={exportGuard.pending && report?.format === 'pdf'} disabled={exportGuard.pending} pendingLabel="Exporting…" data-testid="a11y-export-pdf">
          <FileText size={12} aria-hidden /> Export PDF
        </SubmitButton>
      </div>
      {a11y.axe && <p className="text-fg-muted">axe scan: {a11y.axe.length} issue{a11y.axe.length === 1 ? '' : 's'} in the preview (light and dark), merged below.</p>}
      {a11y.axeStale && <p className="text-fg-muted">The form changed since the last axe scan; scan again to include it.</p>}
      {scanError && <p className="text-danger" role="alert">{scanError}</p>}
      {report && (
        <div role="status" className="flex items-center gap-2" data-testid="a11y-report-status">
          {report.error ? <span className="text-danger">{report.error}</span>
            : report.job?.status === 'succeeded' && report.job.download_url ? (
              <Button size="sm" variant="outline" onClick={() => downloadJobFile(report.job!)} data-testid="a11y-report-download">
                <Download size={12} aria-hidden /> Download {report.job.result?.file?.filename ?? report.format.toUpperCase()}
              </Button>
            ) : <span className="text-fg-muted">Preparing the {report.format.toUpperCase()} report…</span>}
        </div>
      )}

      {groups.length === 0 && <p className="rounded-md border p-3 border-border">No findings.{a11y.axe ? '' : ' Run the axe scan to check the rendered preview too.'}</p>}

      {groups.map((group) => (
        <section key={group.severity} aria-labelledby={`a11y-group-${group.severity}`}>
          <h3 id={`a11y-group-${group.severity}`} className="mb-1 flex items-center gap-1.5 text-2xs font-semibold">
            <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: SEVERITY_COLOR[group.severity] }} />
            {SEVERITY_LABEL[group.severity]} ({group.items.length})
          </h3>
          <ul className="space-y-1.5">
            {group.items.map((f) => {
              const selectable = Boolean(designerIdForKey(state, f.field_key))
              return (
                <li key={f.id} className="rounded-md border p-2 border-border" data-finding={f.id}>
                  {selectable ? (
                    <button type="button" onClick={() => select(f)} className="text-left font-medium underline-offset-2 hover:underline" aria-label={`${f.message} Select the field.`}>{f.message}</button>
                  ) : <p className="font-medium">{f.message}</p>}
                  <p className="mt-0.5 text-fg-muted">{f.help}</p>
                  <p className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-2xs text-fg-muted">
                    {f.wcag.map((sc) => {
                      const url = wcagUrl(sc)
                      const title = WCAG_CRITERIA[sc]?.title
                      return url ? (
                        <a key={sc} href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline text-primary-text">
                          {sc}{title ? ` ${title}` : ''}<ExternalLink size={9} aria-hidden /><span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      ) : <span key={sc}>{sc}</span>
                    })}
                    <span>Level {f.level}</span>
                    {f.mode && <span>{f.mode} mode</span>}
                    {f.source === 'axe' && <span>axe</span>}
                  </p>
                  {f.fix && prompt?.finding.id !== f.id && (
                    <Button type="button" size="sm" variant="outline" className="mt-1.5 h-7" data-fix={f.id}
                      onClick={() => (f.fix!.prompt ? setPrompt({ finding: f, value: f.fix!.prompt.suggestion ?? '' }) : apply(f.fix!))}>
                      <Wand2 size={11} aria-hidden /> {f.fix.label}
                    </Button>
                  )}
                  {prompt?.finding.id === f.id && f.fix?.prompt && (
                    <form className="mt-1.5 space-y-1" onSubmit={(e) => { e.preventDefault(); if (!prompt.value.trim()) return; apply(f.fix!, prompt.value.trim()); setPrompt(null) }}>
                      <label htmlFor={`a11y-prompt-${f.id}`} className="block text-2xs font-medium">{f.fix.prompt.question}</label>
                      <input id={`a11y-prompt-${f.id}`} autoFocus className="h-7 w-full rounded-md border px-2 border-border bg-input text-fg" value={prompt.value} onChange={(e) => setPrompt({ ...prompt, value: e.target.value })}
                        data-testid="a11y-prompt-input" />
                      <div className="flex gap-1">
                        <SubmitButton size="sm" className="h-7" disabled={!prompt.value.trim()}>{f.fix.label}</SubmitButton>
                        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setPrompt(null)}>Cancel</Button>
                      </div>
                    </form>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {result.passed.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">Passed checks ({result.passed.length})</summary>
          <ul className="mt-1 space-y-0.5 text-fg-muted">
            {result.passed.map((r) => <li key={r.rule}>{r.title} · {r.wcag.join(', ')}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

/** The save check: score below the workspace minimum (warn: Save anyway; block: refuse). */
export function AccessibilitySaveCheck({ a11y, onReview, onCancel, onSaveAnyway }: {
  a11y: FormAccessibilityState
  onReview: () => void
  onCancel: () => void
  onSaveAnyway: () => void
}) {
  const { result, settings } = a11y
  const block = settings.mode === 'block'
  const top = result.findings.filter((f) => f.severity !== 'review').slice(0, 5)
  return (
    <div data-testid="a11y-save-check">
      <div className="flex items-center gap-3">
        <ScoreRing score={result.score} min={settings.min_score} size={48} />
        <div>
          <p className="text-sm font-semibold">{block ? 'This form can’t be saved yet' : 'This form has accessibility problems'}</p>
          <p className="mt-0.5 text-xs text-fg-muted">
            Its accessibility score is {result.score}; this workspace {block ? 'requires' : 'expects'} at least {settings.min_score}.
          </p>
        </div>
      </div>
      {top.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
          {top.map((f) => <li key={f.id}><span className="font-medium">{SEVERITY_LABEL[f.severity]}:</span> {f.message}</li>)}
        </ul>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant={block ? 'default' : 'outline'} onClick={onReview} data-action="a11y-review">Review findings</Button>
        {!block && <Button size="sm" onClick={onSaveAnyway} data-action="a11y-save-anyway">Save anyway</Button>}
      </div>
    </div>
  )
}
