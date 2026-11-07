'use client'

/**
 * The form wizard (/forms/wizard/new, /forms/wizard/<project id>): seven
 * plain-language steps over one WizardSpec — what you're building,
 * questions, look & feel, who fills it in, review & approval, results page,
 * review & create — with a live preview (the real form renderer), Back /
 * Next, a progress bar and the stepper, autosave (the person's draft on the
 * server, resumable from /forms/wizard) and, after Create, links to
 * everything that was made. Editing a created form reopens the same steps
 * and saves into the same objects.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowLeft, ArrowRight, Check, CheckCircle2, Copy, Eye, EyeOff, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ProgressBar } from '@/components/ui/progress-bar'
import { InlineNotice } from '@/components/ui/inline-notice'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { FormRenderer } from '@/components/forms/form-renderer'
import { cn } from '@/lib/utils'
import { WizardSpecSchema, type ApprovalMode, type WizardSpec, type WizardTemplate } from '@/lib/forms/wizard/spec'
import { specFromTemplate } from '@/lib/forms/wizard/templates'
import { assignWizardKeys, buildFormFields, buildFormLayout, wizardPlan, type WizardPlanItem } from '@/lib/forms/wizard/build'
import { alwaysRuleEffects } from '@/lib/forms/form-rules'
import type { WizardCreateResult, WizardOptions, WizardProject } from '@/lib/services/form-wizard'
import {
  createWizardForm, draftQuestionsWithAi, getWizardOptions, getWizardProject, saveWizardDraft, updateWizardForm,
} from '@/app/actions/form-wizard'
import { StepApproval, StepAudience, StepLook, StepQuestions, StepResults, StepReview, StepStart } from './wizard-steps'

export const WIZARD_STEPS = [
  { id: 'start', title: 'What are you building?', short: 'Start', paths: ['name', 'description', 'template'] },
  { id: 'questions', title: 'Questions', short: 'Questions', paths: ['questions'] },
  { id: 'look', title: 'Look & feel', short: 'Look', paths: ['look'] },
  { id: 'audience', title: 'Who fills it in', short: 'Who', paths: ['audience'] },
  { id: 'approval', title: 'Review & approval', short: 'Approval', paths: ['approval'] },
  { id: 'results', title: 'Results page', short: 'Results', paths: ['results'] },
  { id: 'review', title: 'Review & create', short: 'Create', paths: [] as string[] },
] as const

/**
 * Where a new form's draft can be reopened (a reload resumes it). It stays on
 * /forms/wizard/new: the App Router treats history.replaceState as a
 * navigation, and moving to /forms/wizard/<id> (another route) would remount
 * the wizard mid-edit — back to step 1, a second draft on the next save.
 */
export function wizardResumeUrl(id: string): string {
  return `/forms/wizard/new?draft=${encodeURIComponent(id)}`
}

const stepKey = (id: string) => `form-wizard-step:${id}`

/** Remember the step a draft is on, for this tab (a refresh reopens it). */
export function rememberStep(id: string, step: number): void {
  try { window.sessionStorage.setItem(stepKey(id), WIZARD_STEPS[step]?.id ?? 'start') } catch { /* storage off: start at step 1 */ }
}

/** The step to reopen a draft at (0 when unknown). */
export function recalledStep(id: string): number {
  try {
    const saved = window.sessionStorage.getItem(stepKey(id))
    return Math.max(0, WIZARD_STEPS.findIndex((s) => s.id === saved))
  } catch { return 0 }
}

/** The spec with every default filled (a valid shape to edit, even when half-finished). */
export function normalizeDraft(raw: unknown): WizardSpec {
  const base = specFromTemplate('blank').spec
  const input = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const merged = { ...base, ...input }
  const parsed = WizardSpecSchema.safeParse(merged)
  if (parsed.success) return parsed.data
  // Half-finished: keep what is there, defaults for the rest (validation runs per step).
  const lenient = WizardSpecSchema.safeParse({ ...merged, name: String(merged.name || 'Untitled form'), questions: Array.isArray(merged.questions) && merged.questions.length ? merged.questions : base.questions })
  return lenient.success ? { ...lenient.data, name: String(input.name ?? '') } : (WizardSpecSchema.parse(base) as WizardSpec)
}

/** Problems per step, from the spec schema (paths → step). */
export function problemsByStep(spec: WizardSpec): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const parsed = WizardSpecSchema.safeParse(spec)
  if (parsed.success) return out
  for (const issue of parsed.error.issues) {
    const head = String(issue.path[0] ?? '')
    const step = WIZARD_STEPS.find((s) => (s.paths as readonly string[]).includes(head))?.id ?? 'review'
    let where = ''
    if (head === 'questions' && typeof issue.path[1] === 'number') {
      const q = spec.questions[issue.path[1]]
      where = q ? `Question ${issue.path[1] + 1}${q.label ? ` ("${q.label.slice(0, 40)}")` : ''}: ` : ''
    }
    ;(out[step] ??= []).push(`${where}${issue.message}`)
  }
  return out
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The wizard for one draft / form: `projectId` on /forms/wizard/<id>, the
 * ?draft=<id> search param on /forms/wizard/new. The session restarts only
 * when the URL moves to a different draft than the one being edited (a
 * "Build a form" link, "Build another form"), not when it catches up with
 * the draft this session just saved.
 */
export function FormWizard({ projectId }: { projectId?: string | null }) {
  const draftParam = useSearchParams()?.get('draft') ?? null
  const wanted = projectId ?? (draftParam && UUID.test(draftParam) ? draftParam : null)
  const [seen, setSeen] = useState<string | null>(wanted)
  const [editingId, setEditingId] = useState<string | null>(wanted)
  const [openedWith, setOpenedWith] = useState<string | null>(wanted)
  const [session, setSession] = useState(0)
  if (wanted !== seen) {
    setSeen(wanted)
    if (wanted !== editingId) {
      setEditingId(wanted)
      setOpenedWith(wanted)
      setSession((n) => n + 1)
    }
  }
  return <WizardSession key={session} projectId={openedWith} onSaved={setEditingId} />
}

function WizardSession({ projectId, onSaved }: { projectId: string | null; onSaved: (id: string) => void }) {
  const router = useRouter()
  const [options, setOptions] = useState<WizardOptions | null>(null)
  const [project, setProject] = useState<(WizardProject & { links?: WizardCreateResult['links'] | null }) | null>(null)
  const [spec, setSpec] = useState<WizardSpec | null>(null)
  const [suggested, setSuggested] = useState<ApprovalMode | null>(null)
  const [step, setStep] = useState(0)
  const [visited, setVisited] = useState<Set<string>>(new Set())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const [aiBusy, setAiBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<WizardCreateResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const draftId = useRef<string | null>(projectId ?? null)
  const dirty = useRef(false)
  const errorRef = useRef<HTMLDivElement>(null)
  // A refused Create / Save shows under the step: bring it into view (on a phone it sits behind the sticky footer).
  useEffect(() => { if (error) errorRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }) }, [error])

  // The step being shown, kept for this tab so a refresh reopens it (not step 1).
  const stepRef = useRef(step)
  const loaded = useRef(false)
  useEffect(() => { stepRef.current = step; if (loaded.current && draftId.current) rememberStep(draftId.current, step) }, [step])

  // Load the options and the project (resume a draft / edit a created form).
  useEffect(() => {
    let live = true
    ;(async () => {
      const [opts, proj] = await Promise.all([getWizardOptions(), projectId ? getWizardProject(projectId) : Promise.resolve(null)])
      if (!live) return
      if (!opts.ok) { setLoadError(opts.error); return }
      setOptions(opts.data)
      loaded.current = true // from here the step shown is remembered (not the 0 of the first render)
      if (proj && !proj.ok) { setLoadError(proj.error); return }
      if (proj?.ok) {
        setProject(proj.data)
        setSpec(normalizeDraft(proj.data.draft ?? proj.data.spec))
        if (proj.data.status === 'created') setVisited(new Set(WIZARD_STEPS.map((s) => s.id)))
        const resumeAt = proj.data.status === 'draft' ? recalledStep(proj.data.id) : 0
        if (resumeAt > 0) {
          setStep(resumeAt)
          setVisited((v) => new Set([...v, ...WIZARD_STEPS.slice(0, resumeAt).map((s) => s.id)]))
        }
      } else {
        const fresh = specFromTemplate('request')
        setSpec(normalizeDraft(fresh.spec))
        setSuggested(fresh.suggestedApproval)
      }
    })()
    return () => { live = false }
  }, [projectId])

  // Autosave: the working copy goes to the person's draft a moment after each change.
  useEffect(() => {
    if (!spec || !dirty.current || done) return
    const timer = setTimeout(async () => {
      setSaveState('saving')
      const res = await saveWizardDraft({ id: draftId.current, draft: spec })
      if (res.ok) {
        if (!draftId.current) {
          draftId.current = res.data.id
          rememberStep(res.data.id, stepRef.current)
          onSaved(res.data.id)
          window.history.replaceState(null, '', wizardResumeUrl(res.data.id))
        }
        setSaveState('saved')
      } else setSaveState('error')
    }, 1200)
    return () => clearTimeout(timer)
  }, [spec, done])

  const change = useCallback((next: WizardSpec) => { dirty.current = true; setSpec(next) }, [])
  const editing = project?.status === 'created'
  const quiz = spec?.template === 'quiz' || Boolean(spec?.questions.some((q) => q.score))
  const problems = useMemo(() => (spec ? problemsByStep(spec) : {}), [spec])
  const plan = useMemo<WizardPlanItem[] | null>(() => {
    if (!spec) return null
    const parsed = WizardSpecSchema.safeParse(spec)
    return parsed.success ? wizardPlan(parsed.data) : null
  }, [spec])

  if (loadError) return <InlineNotice tone="danger" title="The wizard could not open" message={loadError} />
  if (!options || !spec) return <PageSkeleton variant="detail" />

  const current = WIZARD_STEPS[step]
  const stepProblems = visited.has(current.id) ? problems[current.id] ?? [] : []
  const goTo = (n: number) => { setVisited((v) => new Set([...v, current.id])); setStep(Math.max(0, Math.min(WIZARD_STEPS.length - 1, n))); setError(null); window.scrollTo?.({ top: 0 }) }
  const next = () => {
    setVisited((v) => new Set([...v, current.id]))
    if ((problems[current.id] ?? []).length) return
    goTo(step + 1)
  }

  const pickTemplate = (template: WizardTemplate) => {
    const fresh = specFromTemplate(template, spec.name && spec.name !== specFromTemplate(spec.template).spec.name ? spec.name : undefined)
    change(normalizeDraft({ ...fresh.spec, description: spec.description }))
    setSuggested(fresh.suggestedApproval)
  }

  const draftWithAi = async (description: string): Promise<string | null> => {
    setAiBusy(true)
    const res = await draftQuestionsWithAi({ description, template: spec.template })
    setAiBusy(false)
    if (!res.ok) return res.error
    change({ ...spec, name: spec.name || res.data.name || spec.name, questions: res.data.questions })
    return `${res.data.questions.length} questions drafted: check them on the next step.`
  }

  const submit = async () => {
    setVisited(new Set(WIZARD_STEPS.map((s) => s.id)))
    const firstBad = WIZARD_STEPS.findIndex((s) => (problems[s.id] ?? []).length)
    if (firstBad >= 0) { setStep(firstBad); return }
    setBusy(true)
    setError(null)
    const res = editing ? await updateWizardForm(project!.id, spec) : await createWizardForm(spec, draftId.current)
    setBusy(false)
    if (!res.ok) { setError(res.error); return }
    dirty.current = false
    setDone(res.data)
    if (!projectId) { onSaved(res.data.project.id); window.history.replaceState(null, '', wizardResumeUrl(res.data.project.id)) }
  }

  if (done) return <WizardDone result={done} options={options} editing={editing} onAgain={() => router.push('/forms/wizard/new')} />

  return (
    <div className="space-y-4" data-testid="form-wizard">
      <PageHeader
        title={editing ? `Edit "${project?.name}"` : 'Build a form'}
        description={editing ? 'Change anything and save: the form, its data table, workflow and results page are updated together.' : 'A few simple steps: we create the form, a table for the responses, any approvals and a results page.'}
        breadcrumbs={[{ label: 'My forms', href: '/forms/wizard' }, { label: editing ? 'Edit' : 'New' }]}
        actions={<span className="text-xs text-fg-muted" role="status" aria-live="polite" data-testid="wizard-save-state">{saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Progress saved' : saveState === 'error' ? 'Could not save progress' : ''}</span>}
      />
      <Stepper step={step} problems={problems} visited={visited} onPick={goTo} />
      <div className={cn('grid gap-4', current.id === 'questions' || current.id === 'look' ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]' : '')}>
        <Card padding="lg" className="min-w-0">
          {current.id === 'start' && <StepStart spec={spec} onChange={change} options={options} problems={stepProblems} onPickTemplate={pickTemplate} onDraftWithAi={draftWithAi} aiBusy={aiBusy} />}
          {current.id === 'questions' && <StepQuestions spec={spec} onChange={change} options={options} problems={stepProblems} quiz={quiz} />}
          {current.id === 'look' && <StepLook spec={spec} onChange={change} options={options} problems={stepProblems} />}
          {current.id === 'audience' && <StepAudience spec={spec} onChange={change} options={options} problems={stepProblems} />}
          {current.id === 'approval' && <StepApproval spec={spec} onChange={change} options={options} problems={stepProblems} suggested={suggested} />}
          {current.id === 'results' && <StepResults spec={spec} onChange={change} options={options} problems={stepProblems} />}
          {current.id === 'review' && <StepReview plan={plan} editing={editing} problems={Object.values(problems).flat()} />}
          {error && <div ref={errorRef} role="alert" className="mt-4"><InlineNotice tone="danger" title={editing ? 'Not saved' : 'Not created'} message={error} /></div>}
        </Card>
        {(current.id === 'questions' || current.id === 'look') && (
          <div className="min-w-0">
            <Button variant="ghost" size="sm" className="mb-2 lg:hidden" leadingIcon={showPreview ? <EyeOff /> : <Eye />} onClick={() => setShowPreview((v) => !v)} aria-expanded={showPreview}>{showPreview ? 'Hide preview' : 'Show preview'}</Button>
            <div className={cn(showPreview ? 'block' : 'hidden', 'lg:sticky lg:top-4 lg:block')}><WizardPreview spec={spec} /></div>
          </div>
        )}
      </div>
      <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-between gap-2 border-t border-border bg-canvas/95 px-1 py-3 backdrop-blur">
        <Button variant="secondary" leadingIcon={<ArrowLeft />} onClick={() => goTo(step - 1)} disabled={step === 0} data-testid="wizard-back">Back</Button>
        <span className="text-xs text-fg-muted sm:hidden">Step {step + 1} of {WIZARD_STEPS.length}</span>
        {current.id === 'review'
          ? <Button onClick={submit} loading={busy} leadingIcon={<Check />} data-testid="wizard-create">{editing ? 'Save changes' : 'Create'}</Button>
          : <Button onClick={next} trailingIcon={<ArrowRight />} data-testid="wizard-next">Next</Button>}
      </div>
    </div>
  )
}

function Stepper({ step, problems, visited, onPick }: { step: number; problems: Record<string, string[]>; visited: Set<string>; onPick: (n: number) => void }) {
  return (
    <nav aria-label="Wizard steps" className="space-y-2">
      <ProgressBar value={((step + 1) / WIZARD_STEPS.length) * 100} label={`Step ${step + 1} of ${WIZARD_STEPS.length}`} />
      <ol className="hidden gap-1 sm:flex">
        {WIZARD_STEPS.map((s, i) => {
          const bad = visited.has(s.id) && (problems[s.id] ?? []).length > 0
          return (
            <li key={s.id} className="min-w-0 flex-1">
              <button type="button" onClick={() => onPick(i)} aria-current={i === step ? 'step' : undefined}
                className={cn('flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-subtle',
                  i === step ? 'bg-primary-wash font-medium text-primary-text' : 'text-fg-muted')}>
                <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border text-[11px]',
                  bad ? 'border-danger text-danger' : i < step ? 'border-success bg-success text-success-fg' : i === step ? 'border-primary' : 'border-border')}>
                  {i < step && !bad ? <Check className="size-3" aria-hidden /> : i + 1}
                </span>
                <span className="truncate">{s.short}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <h2 className="text-base font-semibold text-fg">{WIZARD_STEPS[step].title}</h2>
    </nav>
  )
}

/** The real form renderer over the built fields (conditions applied to the preview's own answers). */
function WizardPreview({ spec }: { spec: WizardSpec }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  const built = useMemo(() => {
    try {
      const keyed = assignWizardKeys({ ...spec, questions: spec.questions.filter((q) => q.label.trim() || q.kind === 'page_break').map((q) => ({ ...q, options: q.options?.filter(Boolean) })) })
      const layout = buildFormLayout({ ...keyed, look: { ...keyed.look, layout: 'single' } })
      return { fields: buildFormFields(keyed), layout }
    } catch { return null }
  }, [spec])
  if (!built) return null
  const hidden = alwaysRuleEffects(built.layout, values).hidden
  const fields = built.fields.filter((f) => !hidden.has(`field:${f.key}`))
  const accent = spec.look.theme.kind === 'accent' ? spec.look.theme.color : undefined
  return (
    <Card padding="md" className="space-y-3" aria-label="Preview" data-testid="wizard-preview">
      <div className="flex items-center justify-between"><span className="text-xs font-medium uppercase tracking-wide text-fg-muted">Preview</span>{accent && <span className="size-3 rounded-full" style={{ backgroundColor: accent }} aria-hidden />}</div>
      {spec.look.header.show && (
        <div className="border-b border-border pb-2 text-center">
          <div className="text-base font-semibold text-fg">{spec.look.header.title || spec.name || 'Untitled form'}</div>
          {(spec.look.header.subtitle || spec.description) && <div className="text-xs text-fg-muted">{spec.look.header.subtitle || spec.description}</div>}
        </div>
      )}
      <FormRenderer fields={fields} layout={{ rows: fields.map((f) => ({ columns: 1, cells: [{ field_key: f.key, span: 1 }] })) }} values={values} onChange={(k, v) => setValues((prev) => ({ ...prev, [k]: v }))} compact singleColumn idPrefix="wizard-preview" />
      <Button size="sm" className="w-full" disabled>Submit</Button>
    </Card>
  )
}

function WizardDone({ result, options, editing, onAgain }: { result: WizardCreateResult; options: WizardOptions; editing: boolean; onAgain: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const share = result.links.public ? `${origin}${result.links.public}` : `${origin}${result.links.share}`
  const embed = result.links.public ? `<iframe src="${origin}${result.links.public}?embed=1" title="${result.project.name.replace(/"/g, '&quot;')}" style="width:100%;min-height:640px;border:0"></iframe>` : null
  const [copied, setCopied] = useState<string | null>(null)
  const copy = async (what: string, text: string) => { try { await navigator.clipboard.writeText(text); setCopied(what) } catch { setCopied(null) } }
  return (
    <div className="mx-auto max-w-2xl space-y-4" data-testid="wizard-done">
      <Card padding="lg" className="space-y-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-success" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold text-fg">{editing ? 'Changes saved' : 'Your form is ready'}</h1>
          <p className="text-sm text-fg-muted">&ldquo;{result.project.name}&rdquo;{editing ? ' and everything it uses were updated.' : ' is live: responses are saved and appear on the results page.'}</p>
        </div>
        {result.warnings.map((w) => <InlineNotice key={w} tone="warning" message={w} />)}
        <div className="flex flex-wrap justify-center gap-2">
          <Button asChild><Link href={result.links.form}>Open the form</Link></Button>
          <Button asChild variant="secondary"><Link href={result.links.results}>View results</Link></Button>
          <Button asChild variant="secondary"><Link href={result.links.edit}>Edit with the wizard</Link></Button>
        </div>
      </Card>
      <Card padding="lg" className="space-y-3">
        <h2 className="text-sm font-semibold">Share it</h2>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-subtle px-2 py-1.5 text-xs">{share}</code>
          <Button size="sm" variant="secondary" leadingIcon={<Copy />} onClick={() => copy('link', share)}>{copied === 'link' ? 'Copied' : 'Copy link'}</Button>
        </div>
        {embed ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-subtle px-2 py-1.5 text-xs">{embed}</code>
            <Button size="sm" variant="secondary" leadingIcon={<Copy />} onClick={() => copy('embed', embed)}>{copied === 'embed' ? 'Copied' : 'Copy embed code'}</Button>
          </div>
        ) : <p className="text-xs text-fg-muted">People sign in to fill it in. To embed it on a website, turn on a public link (Who fills it in).</p>}
      </Card>
      {(options.designers.form || options.designers.workflow || options.designers.table || options.designers.reports) && (
        <Card padding="lg" className="space-y-2">
          <h2 className="text-sm font-semibold">Open in the designers</h2>
          <p className="text-xs text-fg-muted">Everything the wizard made is an ordinary form, data table and workflow you can change in full.</p>
          <div className="flex flex-wrap gap-2">
            {options.designers.form && <Button asChild size="sm" variant="ghost" trailingIcon={<ExternalLink />}><Link href={result.links.form_designer}>Form</Link></Button>}
            {options.designers.workflow && result.links.workflow_designer && <Button asChild size="sm" variant="ghost" trailingIcon={<ExternalLink />}><Link href={result.links.workflow_designer}>Workflow</Link></Button>}
            {options.designers.table && <Button asChild size="sm" variant="ghost" trailingIcon={<ExternalLink />}><Link href={result.links.table}>Data table</Link></Button>}
            {options.designers.reports && result.links.reports[0] && <Button asChild size="sm" variant="ghost" trailingIcon={<ExternalLink />}><Link href={result.links.reports[0]}>Reports</Link></Button>}
          </div>
        </Card>
      )}
      <div className="text-center"><Button variant="link" onClick={onAgain}>Build another form</Button></div>
    </div>
  )
}
