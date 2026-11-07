'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isPaged, type FormLayout, type FormPage } from '@/lib/forms/layout'
import {
  REVIEW_STEP_ID, firstPageWithError, pageErrorCounts, pageIdByField, pageSettings, resolveCurrentStep, stepProgress,
  validatePage, visiblePages, type ResolvedPageSettings, type StepProgress,
} from '@/lib/forms/pages'
import type { TaskFieldDef } from '@/lib/task-field-schema'
import { cn } from '@/lib/utils'
import { PageIcon } from './page-icons'
import { FormRuntimeProvider, useFormRuntime } from './form-runtime'
import { hasInFormNavigation, isApplicationMode } from '@/lib/forms/form-state'

/**
 * Steps (wizard) and tabs at runtime. `FormPagesProvider` owns which page
 * is showing for a form whose layout has pages; FormRenderer draws the
 * stepper / tab bar and the current page from it, and `FormStepActions`
 * wraps a surface's own buttons so they only show on the final step (with
 * Back / Next before it). Shared by every surface (task screen, /f/ pages,
 * start forms, the designer preview), so they all behave the same:
 *
 * - Next validates the step's visible fields (the same rules as the final
 *   submit, which still validates every visible field across pages).
 * - Hidden steps (page `visible_when`) don't count in the progress.
 * - After a failed submit (new `errors`), the form jumps to the first shown
 *   page with an error; tabs show a count badge on each tab with errors.
 * - `persistKey`: the current page is kept in this browser (a task draft
 *   or a resumable form page reopens on the step it was on).
 */

export interface FormPager {
  mode: 'steps' | 'tabs'
  layout: FormLayout
  settings: ResolvedPageSettings
  /** Shown pages (in order). */
  pages: FormPage[]
  /** The current page id, or REVIEW_STEP_ID. */
  currentId: string
  current: FormPage | null
  isReview: boolean
  /** The surface's own buttons show (steps: the last step / review; tabs: always). */
  isFinal: boolean
  isFirst: boolean
  progress: StepProgress
  /** Errors from the surface plus the per-step check. */
  errors: Record<string, string>
  errorCounts: Record<string, number>
  idPrefix: string
  canVisit: (id: string) => boolean
  goTo: (id: string, options?: { focus?: boolean }) => void
  /** Next step; false when the step has errors (shown) or there is none. */
  next: () => boolean
  back: () => void
  /** Check the current page (in-form Validate); true when valid. */
  validateCurrent: () => boolean
  clearError: (key: string) => void
  /** Application mode with in-form navigation buttons: the wizard's own Back / Next are not drawn. */
  customNav: boolean
  /** A FormStepActions is mounted (the renderer then leaves Back / Next to it). */
  hasActions: boolean
  registerActions: () => () => void
}

const PagerContext = createContext<FormPager | null>(null)

/** The pager of the enclosing paged form, or null. */
export function useFormPager(): FormPager | null {
  return useContext(PagerContext)
}

const STEP_STORAGE = 'usertasks.form-step.'

function readStoredStep(key: string | undefined): string | null {
  if (!key) return null
  try { return window.localStorage.getItem(STEP_STORAGE + key) } catch { return null }
}

function writeStoredStep(key: string | undefined, id: string | null) {
  if (!key) return
  try {
    if (id) window.localStorage.setItem(STEP_STORAGE + key, id)
    else window.localStorage.removeItem(STEP_STORAGE + key)
  } catch { /* storage unavailable: the step is not kept */ }
}

/** Forget a form's kept step (after a submit). */
export function clearStoredStep(key: string | undefined) {
  writeStoredStep(key, null)
}

export function FormPagesProvider({ fields, layout, values, errors, idPrefix = 'task-field-', persistKey, children }: {
  fields: TaskFieldDef[]
  layout: FormLayout | null | undefined
  values: Record<string, unknown>
  errors?: Record<string, string>
  idPrefix?: string
  persistKey?: string
  children: React.ReactNode
}) {
  // The runtime (bar registry, in-form Validate errors) is there with or without pages.
  const runtime = useFormRuntime()
  const inner = isPaged(layout)
    ? <PagerState fields={fields} layout={layout} values={values} errors={errors} idPrefix={idPrefix} persistKey={persistKey}>{children}</PagerState>
    : <>{children}</>
  if (runtime && runtime.idPrefix === idPrefix) return inner
  return <FormRuntimeProvider fields={fields} layout={layout} idPrefix={idPrefix}>{inner}</FormRuntimeProvider>
}

function PagerState({ fields, layout, values, errors, idPrefix, persistKey, children }: {
  fields: TaskFieldDef[]
  layout: FormLayout & { mode: 'steps' | 'tabs'; pages: FormPage[] }
  values: Record<string, unknown>
  errors?: Record<string, string>
  idPrefix: string
  persistKey?: string
  children: React.ReactNode
}) {
  const settings = pageSettings(layout)
  const steps = layout.mode === 'steps'
  const [requested, setRequested] = useState<string>(() => layout.pages[0]?.id ?? '')
  // Steps passed with Next (they may be revisited freely).
  const [reached, setReached] = useState<Set<string>>(() => new Set())
  const [stepErrors, setStepErrors] = useState<Record<string, string>>({})
  const [actions, setActions] = useState(0)
  const valuesRef = useRef(values)
  valuesRef.current = values
  const focusRef = useRef(false)

  const pages = useMemo(() => visiblePages(layout, values), [layout, values])
  // '' when every page is hidden (nothing to show; the surface's buttons stay available).
  const currentId = resolveCurrentStep(layout, values, requested) ?? ''
  const currentIdRef = useRef(currentId)
  currentIdRef.current = currentId
  const isReview = steps && currentId === REVIEW_STEP_ID
  const current = isReview ? null : (layout.pages.find((p) => p.id === currentId) ?? null)
  const progress = stepProgress(layout, values, currentId)
  const runtime = useFormRuntime()
  const runtimeErrors = runtime?.errors
  const merged = useMemo(() => ({ ...(errors ?? {}), ...(runtimeErrors ?? {}), ...stepErrors }), [errors, runtimeErrors, stepErrors])
  const errorCounts = useMemo(() => pageErrorCounts(layout, merged), [layout, merged])
  const isLastStep = progress.total === 0 || progress.index === progress.total - 1

  // Restore the kept step (after mount: the server render shows the first).
  // Until it shows (or the person moves), the first step is not written over it.
  const pendingRestore = useRef<string | null>(null)
  useEffect(() => {
    const stored = readStoredStep(persistKey)
    if (!stored) return
    const order = [...layout.pages.map((p) => p.id), REVIEW_STEP_ID]
    if (!order.includes(stored)) return
    pendingRestore.current = stored
    setRequested(stored)
    // Everything before the kept step counts as reached.
    setReached(new Set(order.slice(0, Math.max(0, order.indexOf(stored)))))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, [])

  useEffect(() => {
    if (pendingRestore.current) {
      if (pendingRestore.current !== currentId) return
      pendingRestore.current = null
    }
    writeStoredStep(persistKey, currentId)
  }, [persistKey, currentId])

  // Move focus to the page heading after a user-initiated change (screen readers hear the new step).
  useEffect(() => {
    if (!focusRef.current) return
    focusRef.current = false
    const el = typeof document !== 'undefined' ? document.getElementById(`${idPrefix}page-heading`) : null
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) }
  }, [currentId, idPrefix])

  const focusField = useCallback((key: string | undefined) => {
    if (!key) return
    requestAnimationFrame(() => {
      const el = document.getElementById(`${idPrefix}${key}`)
      if (el) { el.focus(); el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }) }
    })
  }, [idPrefix])

  // A failed submit (a new errors object): jump to the first shown page with
  // an error — not when the object only lost keys (an error cleared while typing).
  const seenErrors = useRef<Record<string, string>>({})
  useEffect(() => {
    const now = errors ?? {}
    const before = seenErrors.current
    seenErrors.current = now
    const keys = Object.keys(now).filter((key) => now[key])
    const onlyCleared = keys.length < Object.keys(before).length && keys.every((key) => before[key] === now[key])
    if (!keys.length || onlyCleared) return
    const target = firstPageWithError(layout, now, valuesRef.current)
    if (!target) return
    const fieldPages = pageIdByField(layout)
    const at = currentIdRef.current
    const here = at !== REVIEW_STEP_ID && Object.keys(now).some((key) => fieldPages.get(key) === at)
    if (!here) setRequested(target)
    focusField(fields.find((f) => now[f.key] && fieldPages.get(f.key) === (here ? at : target))?.key)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on each new errors object only
  }, [errors])

  const stepIds = progress.steps.map((s) => s.id)

  const canVisit = useCallback((id: string) => {
    if (!steps) return true
    const at = stepIds.indexOf(id)
    if (at < 0) return false
    if (at <= progress.index || settings.allow_skip) return true
    // Forward: every shown step before it was passed.
    return stepIds.slice(0, at).every((s) => s === currentId || reached.has(s))
  }, [steps, stepIds, progress.index, settings.allow_skip, reached, currentId])

  /** Check the current step; true when it may be left forwards. */
  const checkCurrent = useCallback((): boolean => {
    if (!current) return true
    const found = validatePage(fields, layout, current.id, valuesRef.current)
    const keys = Object.keys(found)
    // Errors of this page from an earlier check are replaced by the new ones.
    setStepErrors((prev) => {
      const next: Record<string, string> = {}
      const onPage = new Set(current.rows.flatMap((r) => r.cells.map((c) => c.field_key)))
      for (const [key, message] of Object.entries(prev)) if (!onPage.has(key)) next[key] = message
      return { ...next, ...found }
    })
    if (keys.length) {
      focusField(fields.find((f) => found[f.key])?.key)
      return false
    }
    return true
  }, [current, fields, layout, focusField])

  const goTo = useCallback((id: string, options: { focus?: boolean } = {}) => {
    if (id === currentId) return
    const forward = stepIds.indexOf(id) > progress.index
    if (steps && forward) {
      if (!settings.allow_skip && !canVisit(id)) return
      if (!settings.allow_skip && !checkCurrent()) return
      setReached((prev) => new Set(prev).add(currentId))
    }
    focusRef.current = options.focus !== false
    pendingRestore.current = null
    setRequested(id)
  }, [currentId, stepIds, progress.index, steps, settings.allow_skip, canVisit, checkCurrent])

  const next = useCallback((): boolean => {
    const target = stepIds[progress.index + 1]
    if (!target) return false
    if (!checkCurrent()) return false
    setReached((prev) => new Set(prev).add(currentId))
    focusRef.current = true
    pendingRestore.current = null
    setRequested(target)
    return true
  }, [stepIds, progress.index, checkCurrent, currentId])

  const back = useCallback(() => {
    const target = stepIds[progress.index - 1]
    if (!target) return
    focusRef.current = true
    pendingRestore.current = null
    setRequested(target)
  }, [stepIds, progress.index])

  const runtimeClear = runtime?.clearError
  const clearError = useCallback((key: string) => {
    runtimeClear?.(key)
    setStepErrors((prev) => {
      if (!prev[key]) return prev
      const out = { ...prev }
      delete out[key]
      return out
    })
  }, [runtimeClear])

  const registerActions = useCallback(() => {
    setActions((n) => n + 1)
    return () => setActions((n) => n - 1)
  }, [])

  const pager: FormPager = {
    mode: layout.mode,
    layout,
    settings,
    pages,
    currentId,
    current,
    isReview,
    isFinal: !steps || isLastStep,
    isFirst: progress.index === 0,
    progress,
    errors: merged,
    errorCounts,
    idPrefix,
    canVisit,
    goTo,
    next,
    back,
    validateCurrent: checkCurrent,
    clearError,
    hasActions: actions > 0,
    customNav: isApplicationMode(layout) && hasInFormNavigation(fields),
    registerActions,
  }
  return <PagerContext.Provider value={pager}>{children}</PagerContext.Provider>
}

/* ── Stepper / progress ─────────────────────────────────────────────── */

const bubble = 'flex shrink-0 items-center justify-center rounded-full border text-xs font-semibold'

/**
 * The wizard's progress: a numbered stepper with labels, a progress bar
 * ("Step 2 of 4", 50 %) or dots. `vertical` (phones in the designer
 * preview, compact layouts) stacks the numbered stepper; on real phones it
 * stacks below the `sm` breakpoint.
 */
export function StepIndicator({ pager, vertical }: { pager: FormPager; vertical?: boolean }) {
  const { progress, settings } = pager
  if (progress.total <= 1 && !settings.review) return null
  if (settings.indicator === 'progress') {
    const step = progress.steps[progress.index]
    return (
      <div className="mb-5" data-form-stepper="progress">
        <p className="mb-2 text-xs text-fg-muted">{progress.label}{step ? ` · ${step.title}` : ''}</p>
        <div className="h-1 overflow-hidden rounded-full bg-primary-wash"
          role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} aria-valuetext={`${progress.label}${step ? `: ${step.title}` : ''}`}>
          {/* Fills with a transform (no layout per frame), at the form's step timing (app/form-motion.css). */}
          <div className="h-full w-full origin-left rounded-full bg-primary transition-transform duration-[var(--fm-page-dur,var(--ds-dur-slow))] ease-[var(--ds-ease-standard)]" style={{ transform: `scaleX(${progress.percent / 100})` }} data-fm-progress />
        </div>
      </div>
    )
  }
  if (settings.indicator === 'dots') {
    const step = progress.steps[progress.index]
    return (
      <nav className="mb-4 flex flex-col items-center gap-1.5" aria-label="Form steps" data-form-stepper="dots">
        <ol className="flex items-center gap-2">
          {progress.steps.map((s, i) => {
            const active = i === progress.index
            const visit = pager.canVisit(s.id)
            const dot = (
              <span className={cn('block rounded-full transition-all', active ? 'h-2.5 w-6' : 'h-2.5 w-2.5', i <= progress.index ? 'bg-primary' : 'bg-border')}
                style={pager.errorCounts[s.id] ? { outline: '2px solid var(--theme-danger)', outlineOffset: 2 } : undefined} />
            )
            return (
              <li key={s.id} id={`${pager.idPrefix}step-${s.id}`}>
                {visit && !active
                  ? <button type="button" className="flex h-5 items-center rounded-full" aria-label={`Go to step ${i + 1}: ${s.title}`} onClick={() => pager.goTo(s.id)}>{dot}</button>
                  : <span className="flex h-5 items-center" aria-current={active ? 'step' : undefined} aria-label={`Step ${i + 1}: ${s.title}`}>{dot}</span>}
              </li>
            )
          })}
        </ol>
        <p className="text-xs text-fg-muted">{progress.label}{step ? ` · ${step.title}` : ''}</p>
      </nav>
    )
  }
  return (
    <nav className="mb-5" aria-label="Form steps" data-form-stepper="numbered" data-vertical={vertical ? 'true' : undefined}>
      <ol className={cn('flex', vertical ? 'flex-col gap-1' : 'flex-col gap-1 sm:flex-row sm:items-center sm:gap-0')}>
        {progress.steps.map((s, i) => {
          const active = i === progress.index
          const done = i < progress.index
          const hasError = Boolean(pager.errorCounts[s.id])
          const visit = pager.canVisit(s.id) && !active
          const inner = (
            <>
              <span className={cn(bubble, vertical ? 'h-6 w-6' : 'h-6 w-6 sm:h-7 sm:w-7', active ? 'bg-primary' : hasError ? '' : done ? 'bg-primary-wash' : '', active ? 'border-primary' : hasError ? 'border-danger' : done ? 'border-primary' : 'border-border', active ? 'text-primary-fg' : hasError ? 'text-danger' : done ? 'text-primary-text' : 'text-fg-muted')}>
                {hasError ? <AlertCircle size={14} aria-hidden /> : done ? <Check size={14} aria-hidden /> : i + 1}
              </span>
              <span className={cn('min-w-0 text-xs leading-tight', active ? 'font-semibold' : 'font-medium', !vertical && 'sm:line-clamp-2 sm:max-w-[9rem]', active ? 'text-fg' : 'text-fg-muted')}>
                {s.title}
                <span className="sr-only">{active ? ' (current step)' : done ? ' (completed)' : ''}{hasError ? ' (has errors)' : ''}</span>
              </span>
            </>
          )
          return (
            <li key={s.id} id={`${pager.idPrefix}step-${s.id}`} className={cn('flex min-w-0 items-center', !vertical && 'sm:flex-1 sm:last:flex-none')} data-step={s.id} data-step-state={active ? 'current' : done ? 'done' : 'upcoming'}>
              {visit
                ? <button type="button" onClick={() => pager.goTo(s.id)} className="flex min-w-0 items-center gap-2 rounded-md text-left" aria-label={`Go to step ${i + 1}: ${s.title}`}>{inner}</button>
                : <span className="flex min-w-0 items-center gap-2" aria-current={active ? 'step' : undefined}>{inner}</span>}
              {i < progress.steps.length - 1 && !vertical && (
                <span className={cn('mx-2 hidden h-px min-w-4 flex-1 sm:block', done ? 'bg-primary' : 'bg-border')} aria-hidden />
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */

/** The tab bar (ARIA tablist; arrows / Home / End move between tabs; scrolls sideways on phones). */
export function FormTabBar({ pager }: { pager: FormPager }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const ids = pager.pages.map((p) => p.id)
  function onKey(e: React.KeyboardEvent) {
    const focused = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]')?.dataset.tab
    const at = ids.indexOf(focused && ids.includes(focused) ? focused : pager.currentId)
    const target = e.key === 'ArrowRight' ? ids[(at + 1) % ids.length]
      : e.key === 'ArrowLeft' ? ids[(at - 1 + ids.length) % ids.length]
        : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : null
    if (!target) return
    e.preventDefault()
    pager.goTo(target, { focus: false })
    refs.current[target]?.focus()
  }
  return (
    <div className="-mx-1 mb-4 overflow-x-auto px-1" data-form-tabs>
      <div role="tablist" aria-label="Form sections" className="flex min-w-max gap-1 border-b border-border" onKeyDown={onKey}>
        {pager.pages.map((page) => {
          const active = page.id === pager.currentId
          const count = pager.errorCounts[page.id] ?? 0
          return (
            <button
              key={page.id}
              ref={(el) => { refs.current[page.id] = el }}
              type="button"
              role="tab"
              id={`${pager.idPrefix}tab-${page.id}`}
              aria-selected={active}
              aria-controls={`${pager.idPrefix}panel-${page.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => pager.goTo(page.id, { focus: false })}
              className={cn('-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium', active ? 'border-primary' : 'border-transparent', active ? 'text-primary-text' : 'text-fg-muted')}
              data-tab={page.id}
            >
              <PageIcon icon={page.icon} />
              {page.title}
              {count > 0 && (
                <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-2xs font-semibold bg-danger text-danger-fg"
                  data-tab-errors={count}>
                  {count}<span className="sr-only"> {count === 1 ? 'error' : 'errors'}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/* ── Navigation ───────────────────────────────────────────────────────── */

/**
 * Whether the enclosing FormStepActions is on a step before the last: a
 * button bar then shows only its Save draft buttons (FormButtonBar).
 */
const StepPhaseContext = createContext<'step' | 'final'>('final')
export function useStepPhase(): 'step' | 'final' {
  return useContext(StepPhaseContext)
}

/**
 * Back / Next (steps). On the final step Back sits beside `children` (the
 * surface's buttons); before it, `children` (its Save draft buttons) sit
 * between Back and Next.
 */
export function StepNav({ pager, children }: { pager: FormPager; children?: React.ReactNode }) {
  if (pager.mode !== 'steps' || pager.customNav) return <>{children}</>
  const back = !pager.isFirst ? (
    <Button type="button" variant="secondary" leadingIcon={<ChevronLeft />} onClick={pager.back} data-step-back>
      {pager.settings.back_label}
    </Button>
  ) : null
  if (pager.isFinal) {
    if (!back) return <>{children}</>
    return (
      <div className="flex flex-wrap items-end gap-2" data-step-nav="final">
        <div className="mt-5">{back}</div>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    )
  }
  return (
    <div className="flex flex-wrap items-end gap-2" data-step-nav>
      {back && <div className="mt-5">{back}</div>}
      <div className="min-w-0 flex-1">{children}</div>
      <div className="mt-5">
        <Button type="button" trailingIcon={<ChevronRight />} onClick={() => { pager.next() }} data-step-next>
          {pager.settings.next_label}
        </Button>
      </div>
    </div>
  )
}

/**
 * Wraps a surface's buttons (its button bar, its messages): on a steps form
 * they show on the final step (the review, when on) with Back beside them;
 * before it, Back / Next with only the Save draft buttons (a draft keeps
 * the step). Outside a paged form it renders the buttons.
 */
export function FormStepActions({ children }: { children: React.ReactNode }) {
  const pager = useFormPager()
  const register = pager?.registerActions
  useEffect(() => (register ? register() : undefined), [register])
  if (!pager || pager.mode !== 'steps') return <>{children}</>
  return (
    <StepPhaseContext.Provider value={pager.isFinal ? 'final' : 'step'}>
      <StepNav pager={pager}>{children}</StepNav>
    </StepPhaseContext.Provider>
  )
}
