'use client'

import { formAnimation } from '@/lib/forms/motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { FormRenderer } from '@/components/forms/form-renderer'
import { FormThemeScope } from '@/components/forms/form-theme-scope'
import { FormLoading } from '@/components/forms/form-loading'
import { FormLookupProvider } from '@/components/forms/lookup-field'
import { FormButtonBar, FormHeaderBlock, FormMessages, FormSuccessScreen } from '@/components/forms/form-shell'
import { FormPagesProvider, FormStepActions, clearStoredStep } from '@/components/forms/form-pages'
import { DraftResumePrompt, FormHeaderActions, useFormDraft } from '@/components/forms/form-header-actions'
import { formCardWidth } from '@/lib/forms/form-width'
import { cn } from '@/lib/utils'
import { isPaged } from '@/lib/forms/layout'
import { pageSettings } from '@/lib/forms/pages'
import { serverRead } from '@/lib/server-read'
import { deleteStandaloneFormRecord, submitStandaloneForm } from '@/app/actions/forms'
import { planButtonEffects, type ButtonEffects, type FormButton } from '@/lib/forms/buttons'
import { freshSubmissionValues, screenButtonOutcome } from '@/lib/forms/submitted-page'
import { validateTaskFieldValues } from '@/lib/task-field-schema'
import { FORM_PARAMS_KEY, formParamsMessage, layoutFormParams, paramsFromQuery, parseFormParams, withFormContext } from '@/lib/forms/form-params'
import { openingFieldDefaults } from '@/lib/forms/preview-inputs'
import { VALUE_CONTROL_SELECTOR, isPersonEdit, personHasEntered, shouldOfferDraft, type EditEventLike } from '@/lib/forms/draft-offer'
import type { AnonymousFormPage } from '@/lib/services/anonymous-forms'
import type { FormLookupSource } from '@/components/forms/lookup-field'
import { AnonymousCaptcha, AnonymousHoneypot, submitAnonymous } from '@/components/forms/anonymous-form-parts'
import { useAssistantSurface } from '@/lib/assistants/client-registry'
import type { FormDataTargetState } from '@/lib/forms/data-target'
import { FORM_EVENT_MESSAGE_TYPE, formEventMessage, hostRedirectUrl, type FormEventMessage } from '@/lib/forms/embed'

const DRAFT_STORAGE = 'usertasks.form-draft.'

/** A resumable form's unsent answers in this browser (attachments are left out: their uploads expire). */
function readDraft(formId: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE + formId)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch { return null }
}

function writeDraft(formId: string, values: Record<string, unknown> | null) {
  try {
    if (values && Object.keys(values).length) window.localStorage.setItem(DRAFT_STORAGE + formId, JSON.stringify(values))
    else window.localStorage.removeItem(DRAFT_STORAGE + formId)
  } catch { /* storage unavailable: nothing is kept */ }
}

/** The page's URL query, bounded (the server reads only the form's declared URL parameters from it). */
function cleanQuery(query: Record<string, string | string[] | undefined> | undefined): Record<string, string | string[]> | null {
  if (!query) return null
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(query).slice(0, 50)) {
    if (key.length > 64 || value === undefined) continue
    out[key] = Array.isArray(value) ? value.slice(0, 50).map((v) => v.slice(0, 2000)) : value.slice(0, 2000)
  }
  return Object.keys(out).length ? out : null
}

/**
 * What a bound form shows about its record at run time. WYSIWYG: nothing the
 * designer doesn't show — no "Submitting creates a new record in …" style
 * captions. Only a provider's own notice (e.g. a field that can't be written)
 * and the record's files (a library document, attachments) appear.
 */
function DataTargetNotice({ target }: { target: FormDataTargetState }) {
  const files = target.files ?? []
  if (!target.notice && !files.length) return null
  return (
    <div className="mb-3 text-xs text-fg-muted" role="status" data-form-target={target.mode}>
      {target.notice && <span className="block">{target.notice}</span>}
      {files.length > 0 && (
        <span className="mt-1 block" data-form-target-files>
          Files:{' '}
          {files.map((file, i) => (
            <span key={`${file.url}-${i}`}>{i > 0 && ', '}<a className="underline text-primary-text" href={file.url} target="_blank" rel="noreferrer">{file.label}</a></span>
          ))}
        </span>
      )}
    </div>
  )
}

/**
 * A display form's buttons (e.g. "Edit"): links the provider offers, in
 * place of the submit buttons. In a trusted-embedding frame a form path
 * (/f/<id>) stays in the frame (/embed/f/<id>).
 */
function DataTargetActions({ actions, trusted }: { actions: NonNullable<FormDataTargetState['actions']>; trusted: boolean }) {
  if (!actions.length) return null
  return (
    <div className="mt-4 flex flex-wrap gap-2" data-form-target-actions>
      {actions.map((action, i) => {
        const http = /^https?:/i.test(action.url)
        const target = action.target ?? (http ? 'blank' : 'self')
        const href = trusted && target === 'self' && /^\/f\//.test(action.url) ? `/embed${action.url}` : action.url
        return (
          <a key={`${action.url}-${i}`} href={href} className={buttonVariants({ variant: action.primary ? 'primary' : 'secondary', size: 'md' })}
            {...(target === 'blank' ? { target: '_blank', rel: 'noreferrer' } : target === 'top' ? { target: '_top' } : {})}>
            {action.label}
          </a>
        )
      })}
    </div>
  )
}

/** Tell the framing page what happened (no values or record data — just the event; lib/forms/embed.ts). */
function notifyHost(event: FormEventMessage['event'], redirect?: string | null) {
  if (typeof window === 'undefined') return
  // Same page too (components/embed/embed-form-host.tsx: what to do after a submit).
  window.dispatchEvent(new CustomEvent(FORM_EVENT_MESSAGE_TYPE, { detail: event }))
  if (window.parent === window) return
  // The button's own rule decides where the top window goes (lib/forms/embed.ts hostRedirectUrl).
  try { window.parent.postMessage(formEventMessage(event, hostRedirectUrl(redirect, window.location.origin)), '*') } catch { /* parent gone */ }
}

function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`
}

/**
 * A reusable form on its own page (/f/<id>): header, fields (lookups
 * included), the button bar and what the button does (message, success
 * screen, redirect, close). Submitting goes to the server (validation,
 * workflows, the "Form submitted" trigger); one idempotency key per filled
 * form makes a double-click one submission. Cancel discards the values
 * (asking first when something was typed).
 *
 * Steps / tabs forms (components/forms/form-pages.tsx): the buttons show on
 * the final step; with "Resume later" on, unsent answers and the step are
 * kept in this browser until the form is submitted or discarded.
 */
export function StandaloneForm({ formId, query, anonymous, surface = 'app', embed = false, trusted = false, initialForm, onDone, hideHeader = false, fill = false, onDirtyChange, contextParams, onSubmitted, onTitle, actionsTarget }: {
  formId: string
  /**
   * `app`: inside the dashboard shell (/fill/<id>, opened from the app's own
   * Forms menu, Home or search). `standalone`: a form link page on its own
   * (/f/<id>, /form/<name>, /p/<token>) — no shell, the theme's page colour
   * over the whole viewport, and Close ends on the closed page (there is no
   * dashboard to go back to).
   */
  surface?: 'app' | 'standalone'
  /** Embedded in another site (?embed=1 or framed): no page canvas behind the card. */
  embed?: boolean
  /**
   * Trusted embedding (/embed/f/<id>, framed by an approved site such as a
   * SharePoint page hosting the form): after a submission or Cancel the
   * framing page is told (`{ type: 'usertasks:form', event }`) so it can go
   * back like the host system's own forms; form links stay in the frame.
   */
  trusted?: boolean
  /**
   * The form as the server already prepared it for this request (definition,
   * theme, the bound record's values — `getSubmittableForm`): the first paint
   * has the fields, with no client loading phase (trusted embedding).
   */
  initialForm?: AnonymousFormPage['form']
  /** The page's URL query: the form's URL parameters are read from it (lib/forms/form-params.ts); anything else is ignored. */
  query?: Record<string, string | string[] | undefined>
  /**
   * A public form link (/p/<token>, no one signed in): the form comes from
   * the server-rendered page, every server call goes to
   * /api/public/forms/<token>/…, no drafts / resume, a honeypot and the
   * optional captcha; "Close form" ends on a neutral page.
   */
  anonymous?: { token: string; page: AnonymousFormPage }
  /**
   * Opened in a dialog (an app page's "New submission" button,
   * components/apps/form-dialog.tsx): Cancel, Close and a submission that
   * closes the form call this instead of ending on the closed state.
   */
  onDone?: (event: 'submitted' | 'cancelled' | 'closed') => void
  /** App form widget: no form header (title block). */
  hideHeader?: boolean
  /** App form widget: fill the box edge to edge (the form's theme as the background), scrolling inside. */
  fill?: boolean
  /** Told when the form starts / stops holding unsent answers (app panels warn before closing). */
  onDirtyChange?: (dirty: boolean) => void
  /** Values for the form's declared parameters from the embedding app (any source); validated like URL ones. */
  contextParams?: Record<string, string> | null
  /** After a successful submission: its id and the values sent (app "form submitted" events). */
  onSubmitted?: (result: { submission_id: string | null; values: Record<string, unknown> }) => void
  /** Told the form's name once loaded (panel titles). */
  onTitle?: (title: string) => void
  /** With hideHeader: the favourite / Save draft icons go into this element (a panel's header row). */
  actionsTarget?: HTMLElement | null
}) {
  const router = useRouter()
  // isPending, not isLoading: on the first (server / hydration) render the query
  // hasn't started fetching, so isLoading is false and the page flashed
  // "This form is not available." before the form arrived.
  // The URL query goes to the server: a form bound to an external record (a data target, lib/forms/data-target.ts) loads the record its URL parameters name.
  const urlQuery = useMemo(() => cleanQuery(query), [query])
  const { data: form, error, isPending: isLoading, refetch } = useQuery({
    queryKey: ['form-submittable', formId, urlQuery],
    enabled: !anonymous,
    initialData: anonymous?.page.form ?? initialForm,
    // Server-prepared (trusted embedding): no refetch on mount, so the record is read once per page load.
    ...(initialForm ? { staleTime: 30_000 } : {}),
    queryFn: async () => {
      const { data, error: readError } = await serverRead('forms.submittable', { id: formId, ...(urlQuery ? { query: urlQuery } : {}) })
      if (readError) throw new Error(readError.message)
      return data
    },
  })
  // Loaded in the browser (not server-rendered): the form fades in from the loading state.
  const [loadedHere] = useState(isLoading)
  // The AI form assistant (shown only when available: components/assistants/assistant-host). Not for public or embedded forms.
  useAssistantSurface(!anonymous && !embed && form ? { kind: 'form', formId, title: form.name ?? null } : null)
  // Parameters: the URL's, typed and validated against the form's declarations (unknown ones ignored).
  const params = useMemo(() => {
    const declared = layoutFormParams(form?.layout)
    if (!declared.length) return null
    const given = { ...paramsFromQuery(declared, query), ...(contextParams ? Object.fromEntries(Object.entries(contextParams).filter(([k]) => declared.some((d) => d.name === k))) : {}) }
    const parsed = parseFormParams(declared, given)
    return { parsed, message: formParamsMessage(declared, parsed) }
  }, [form, query, contextParams])
  useEffect(() => { if (form?.name) onTitle?.(form.name) }, [form?.name]) // eslint-disable-line react-hooks/exhaustive-deps
  // Defaults: {{param.x}} filled in; other placeholders have nothing to fill them on a form page.
  const defaults = useMemo(() => (form ? openingFieldDefaults(form.fields, params?.parsed.values ?? null) : {}), [form, params])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const hasValues = Object.values(values).some((v) => v !== null && v !== undefined && v !== '' && !(Array.isArray(v) && !v.length))
  useEffect(() => { onDirtyChange?.(hasValues) }, [hasValues]) // eslint-disable-line react-hooks/exhaustive-deps
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  // Synchronous guard: two clicks in one frame both see busy === null.
  const pressGuard = useSubmitGuard()
  const [failure, setFailure] = useState<string | null>(null)
  const [effects, setEffects] = useState<ButtonEffects | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<FormButton | null>(null)
  const [closed, setClosed] = useState(false)
  const keyRef = useRef(newKey())
  // Anonymous visit: one upload key per page load (its uploads are only usable with it), the honeypot, the captcha answer.
  const [uploadKey] = useState(() => (newKey() + newKey()).replace(/[^A-Za-z0-9]/g, '').slice(0, 64))
  const [honeypot, setHoneypot] = useState('')
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [captchaRound, setCaptchaRound] = useState(0)
  const lookupSource = useMemo<FormLookupSource>(() => (anonymous ? { kind: 'form', formId, anonymous: { token: anonymous.token, uploadKey } } : { kind: 'form', formId }), [anonymous, formId, uploadKey])
  // A data target's record values sit between the defaults and what the person typed.
  const loaded = form?.target?.values ?? null
  const shown = params ? { ...defaults, ...loaded, ...values, [FORM_PARAMS_KEY]: params.parsed.values } : { ...defaults, ...loaded, ...values }
  // What the person entered — not what the form set by itself when it opened (bound defaults, Labels,
  // a repeating section's items, form-load rules): only their own edit events count (lib/forms/draft-offer.ts).
  const [edited, setEdited] = useState(false)
  const dirty = personHasEntered(values, edited)
  const noteEdit = (event: React.SyntheticEvent) => {
    if (edited) return
    const target = event.target as Element | null
    if (isPersonEdit(event.nativeEvent as unknown as EditEventLike, Boolean(target?.closest?.(VALUE_CONTROL_SELECTOR)))) setEdited(true)
  }
  // "Resume later" (steps / tabs forms): unsent answers and the step stay in this browser.
  const resumeKey = !anonymous && form && isPaged(form.layout) && pageSettings(form.layout).resume ? `form:${form.id}` : undefined
  const [resumed, setResumed] = useState(false)
  const restoredRef = useRef(false)
  useEffect(() => {
    if (!form || !resumeKey || restoredRef.current) return
    restoredRef.current = true
    const draft = readDraft(form.id)
    if (!draft) return
    const known = new Set(form.fields.filter((f) => f.type !== 'attachments' && f.type !== 'image' && f.type !== 'signature').map((f) => f.key))
    const kept = Object.fromEntries(Object.entries(draft).filter(([key]) => known.has(key)))
    if (Object.keys(kept).length) { setValues(kept); setResumed(true) }
  }, [form, resumeKey])
  useEffect(() => {
    if (!form || !resumeKey || !restoredRef.current) return
    const attachments = new Set(form.fields.filter((f) => f.type === 'attachments' || f.type === 'image' || f.type === 'signature').map((f) => f.key))
    writeDraft(form.id, Object.fromEntries(Object.entries(values).filter(([key]) => !attachments.has(key))))
  }, [form, resumeKey, values])
  // Save draft (top-right icon): the person's answers on the server, offered back as "Resume your draft from …?".
  // Public form links: no drafts, favourites or Home for anonymous visitors (null form id → nothing is read).
  const drafts = useFormDraft(anonymous ? null : form?.id ?? null, form?.layout)
  const [draftDecided, setDraftDecided] = useState(false)
  // A display form (data target mode `display`): the record read-only, no drafts or submit buttons.
  const displayOnly = form?.target?.mode === 'display'
  const offerDraft = shouldOfferDraft({ anonymous: Boolean(anonymous), displayOnly, hasDraft: Boolean(drafts.draft), decided: draftDecided, entered: dirty }) ? drafts.draft : null
  const standalone = surface === 'standalone' || Boolean(anonymous)
  // A form link page has no shell to title the tab: the form's name does.
  useEffect(() => {
    if (standalone && !anonymous && form?.name) document.title = form.name
  }, [standalone, anonymous, form?.name])

  if (isLoading) return <FormLoading compact={embed} />
  if (error || !form) {
    return (
      <div className="flex items-start gap-2 rounded-lg border p-4 text-sm border-border" role="alert">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-(--status-blocked)" aria-hidden />
        <span>{error instanceof Error ? error.message : 'This form is not available.'}</span>
      </div>
    )
  }

  if (params?.message) {
    return (
      <div className="mx-auto flex max-w-3xl items-start gap-2 rounded-lg border p-4 text-sm border-border" role="alert" data-form-params-missing>
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-(--status-blocked)" aria-hidden />
        <div>
          <p className="font-medium">{form.name} can&apos;t open yet</p>
          <p className="mt-1 text-fg-muted">{params.message} Open it from a link that includes {params.parsed.missing.length + Object.keys(params.parsed.errors).length === 1 ? 'it' : 'them'}, or ask whoever shared it for the full link.</p>
        </div>
      </div>
    )
  }

  /** Forget the kept answers and step (submitted / discarded). */
  function forgetDraft() {
    if (!resumeKey) return
    writeDraft(form!.id, null)
    clearStoredStep(resumeKey)
    setResumed(false)
  }

  function reset() {
    // A fresh form: the answers go, the URL parameters (read from the query) stay.
    setValues((prev) => freshSubmissionValues(prev)); setErrors({}); setEffects(null); setFailure(null); setConfirmCancel(false); setClosed(false); setEdited(false)
    forgetDraft()
    keyRef.current = newKey()
  }

  function finish(next: ButtonEffects) {
    if (next.redirect) {
      // An address on another site (e.g. {{target.return_url}}, the list a record lives in): a full page load.
      // In a trusted-embedding frame the host page goes there itself (it got the host event).
      if (/^https?:\/\//i.test(next.redirect)) { if (!trusted) window.location.assign(next.redirect); return }
      // Inside a trusted-embedding frame another form stays in the frame; other app pages open in the top window (the host was told).
      if (trusted && !/^\/f\//.test(next.redirect)) return
      router.push(trusted ? `/embed${next.redirect}` : next.redirect); return
    }
    if (next.close && !next.success_screen) {
      if (onDone) { onDone('submitted'); return }
      setClosed(true)
    }
    setEffects(next)
  }

  async function press(button: FormButton) {
    await pressGuard.run(async () => {
      setFailure(null)
      if (button.kind === 'cancel') {
        if (dirty && !confirmCancel) { setConfirmCancel(true); return }
        const planned = planButtonEffects(button, { values: shown, targetReturnUrl: form!.target?.return_url ?? null, targetUrls: form!.target?.urls ?? null })
        setValues({}); setErrors({}); setConfirmCancel(false); setEdited(false)
        forgetDraft()
        keyRef.current = newKey()
        if (trusted) notifyHost(displayOnly ? 'closed' : 'cancelled', planned.redirect)
        if (onDone) { onDone('cancelled'); return }
        finish(planned)
        return
      }
      if (button.kind === 'link') {
        // A link button (e.g. "Edit item" → {{target.url.edit}}): no submission, just its redirect.
        finish(planButtonEffects(button, { values: shown, targetReturnUrl: form!.target?.return_url ?? null, targetUrls: form!.target?.urls ?? null }))
        return
      }
      if (button.kind === 'delete') {
        // Delete record (data target): confirm, then the provider deletes it.
        if (confirmDelete?.id !== button.id) { setConfirmDelete(button); return }
        setConfirmDelete(null)
        setBusy(button.id)
        try {
          const result = await deleteStandaloneFormRecord(formId, { button_id: button.id, params: params?.parsed.values ?? null, target_version: form!.target?.version ?? null })
          if (!result.ok) { setFailure(result.error); return }
          setValues({}); setEdited(false); forgetDraft()
          const next = result.data.effects
          if (trusted) notifyHost('deleted', next.redirect)
          if (!next.redirect && !next.close && !next.success_screen) { setEffects({ ...next, messages: next.messages.length ? next.messages : [{ text: 'Deleted.', tone: 'success' }] }); setClosed(true); return }
          finish(next)
        } finally {
          setBusy(null)
        }
        return
      }
      const clientErrors = validateTaskFieldValues(form!.fields, shown, { layout: form!.layout, buttonIds: [button.id] })
      if (Object.keys(clientErrors).length) { setErrors(clientErrors); return }
      setBusy(button.id)
      try {
        const result = anonymous
          ? await submitAnonymous(anonymous.token, { values: shown, button_id: button.id, idempotency_key: keyRef.current, ticket: anonymous.page.ticket, captcha, upload_key: uploadKey, honeypot })
          : await submitStandaloneForm(formId, { values: shown, button_id: button.id, idempotency_key: keyRef.current, ...(form!.target?.version ? { target_version: form!.target.version } : {}) })
        if (!result.ok) {
          if (result.fields) setErrors(result.fields)
          setFailure(result.error)
          // A used / refused captcha answer can't be sent again.
          if (anonymous?.page.captcha) { setCaptcha(null); setCaptchaRound((n) => n + 1) }
          return
        }
        if (anonymous?.page.captcha) { setCaptcha(null); setCaptchaRound((n) => n + 1) }
        onSubmitted?.({ submission_id: ((result.data as { submission_id?: string; id?: string }).submission_id ?? (result.data as { id?: string }).id ?? null), values: shown })
        setErrors({})
        forgetDraft()
        if (!anonymous) drafts.submitted()
        setDraftDecided(true)
        if (trusted) notifyHost('submitted', result.data.effects.redirect)
        // A bound record changed: read it again (fresh values and version for the next save).
        if (form!.target) void refetch()
        if (!result.data.effects.success_screen && !result.data.effects.redirect && !result.data.effects.close) {
          // Stay on the form, cleared for the next submission (back on its first step), with the message(s).
          setValues({}); setEdited(false)
          keyRef.current = newKey()
          setEffects({ ...result.data.effects, messages: result.data.effects.messages.length ? result.data.effects.messages : [{ text: 'Submitted.', tone: 'success' }] })
          return
        }
        finish(result.data.effects)
      } finally {
        setBusy(null)
      }
    })
  }

  const overrides = form.header?.enabled && form.theme_overrides?.header ? { ...form.theme_overrides, header: undefined } : form.theme_overrides
  // Form width (lib/forms/form-width.ts): a share of the page content area for custom %.
  const width = formCardWidth(form.theme_overrides, form.fields)
  // The hand-off from the loading state: the form's own load animation when it has one, else a short fade.
  const motion = formAnimation(form.layout)
  return (
    <div className={cn(fill ? 'h-full w-full overflow-auto [&>[data-form-page]]:h-full [&>[data-form-page]>[data-form-theme]]:min-h-full' : 'mx-auto', !fill && width.className, loadedHere && motion.style === 'none' && 'form-reveal')} style={fill ? undefined : width.style as React.CSSProperties} data-standalone-form={form.id} data-form-width-mode={width.width} data-form-fill={fill || undefined}>
      <FormThemeScope overrides={overrides} page={standalone && !embed ? 'viewport' : true} motion={motion} className={fill ? 'min-h-full !rounded-none !border-0 !shadow-none' : undefined}>
        <div className={fill ? 'min-h-full' : undefined}>
          {/* The heart / Save draft icons sit in the header's top-right corner, on the title's row. */}
          {hideHeader && actionsTarget && !anonymous && !displayOnly && !trusted && !closed && createPortal(
            <FormHeaderActions form={form} drafts={drafts} inHeader onSave={() => { setDraftDecided(true); void drafts.save(values, params?.parsed.values ?? null) }} />,
            actionsTarget,
          )}
          {!hideHeader && <FormHeaderBlock header={form.header ?? (form.theme_overrides?.header?.enabled ? null : { enabled: true, image: 'none', title: form.name, align: 'left' })} values={withFormContext(form.layout, shown)} overrides={form.theme_overrides}
            actions={!anonymous && !displayOnly && !trusted && !closed && !effects?.success_screen ? (
              <FormHeaderActions form={form} drafts={drafts} inHeader
                onSave={() => { setDraftDecided(true); void drafts.save(values, params?.parsed.values ?? null) }} />
            ) : null} />}
          {closed ? (
            <div className="py-10 text-center text-sm text-fg-muted" role="status" data-form-closed>
              {anonymous ? 'Thank you — you can close this page now.' : 'This form is closed.'} <button type="button" className="underline" onClick={reset}>{anonymous ? 'Fill it in again' : 'Open it again'}</button>
            </div>
          ) : effects?.success_screen ? (
            <FormSuccessScreen screen={effects.success_screen} messages={effects.messages} onSubmitAnother={reset}
              onClose={() => {
                // Close form: back to the dashboard (lib/forms/submitted-page.ts); an older screen's Close keeps the page, closed.
                // A form link page (public or signed in) has no dashboard: Close ends on the neutral closed page.
                if (onDone) { onDone('closed'); return }
                const next = !standalone && effects.success_screen?.source === 'form' ? screenButtonOutcome({ kind: 'close', label: '' }, 'page') : null
                if (next?.kind === 'navigate') router.push(next.href)
                else { setEffects(null); setClosed(true) }
              }} />
          ) : (
            <FormLookupProvider source={lookupSource}>
              <FormPagesProvider key={keyRef.current} fields={form.fields} layout={form.layout} values={shown} errors={errors} idPrefix="form-field-" persistKey={resumeKey}>
              {offerDraft && (
                <DraftResumePrompt draft={offerDraft}
                  onResume={() => { setValues({ ...offerDraft.values }); setErrors({}); setDraftDecided(true); setResumed(false) }}
                  onFresh={() => { setDraftDecided(true); void drafts.discard() }} />
              )}
              {resumed && (
                <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs border-border text-fg-muted" role="status" data-form-resumed>
                  <span className="flex-1">We kept the answers you started earlier in this browser.</span>
                  <button type="button" className="font-medium underline text-primary-text" onClick={reset}>Start over</button>
                </div>
              )}
              {form.target && <DataTargetNotice target={form.target} />}
              <div className="contents" onInputCapture={noteEdit} onChangeCapture={noteEdit} onKeyDownCapture={noteEdit} onPasteCapture={noteEdit} onClickCapture={noteEdit} data-form-fields>
              <FormRenderer
                idPrefix="form-field-"
                fields={form.fields}
                layout={form.layout}
                values={shown}
                errors={errors}
                labelPosition={form.theme_overrides?.label_position}
                density={form.theme_overrides?.density}
                onChange={(key, value) => {
                  setValues((prev) => ({ ...prev, [key]: value }))
                  setErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
                  setConfirmCancel(false)
                }}
              />
              </div>
              {anonymous && <AnonymousHoneypot value={honeypot} onChange={setHoneypot} />}
              {anonymous?.page.captcha && <AnonymousCaptcha key={captchaRound} provider={anonymous.page.captcha.provider} siteKey={anonymous.page.captcha.site_key} onToken={setCaptcha} />}
              {failure && <p className="mt-3 text-sm text-(--status-blocked)" role="alert">{failure}</p>}
              {effects && <FormMessages messages={effects.messages} onDismiss={(i) => setEffects({ ...effects, messages: effects.messages.filter((_, j) => j !== i) })} />}
              <FormStepActions>
                {confirmCancel && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm border-border" role="alertdialog" aria-label="Discard your answers?">
                    <span className="flex-1">Discard what you&apos;ve entered?</span>
                    <Button size="sm" variant="outline" onClick={() => setConfirmCancel(false)}>Keep editing</Button>
                    <Button size="sm" variant="destructive" onClick={() => void press(form.buttons.find((b) => b.kind === 'cancel')!)} data-confirm-cancel>Discard</Button>
                  </div>
                )}
                {confirmDelete && (
                  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm border-border" role="alertdialog" aria-label="Delete this record?" data-confirm-delete-dialog>
                    <span className="flex-1">Delete {form.target?.record?.label ? `"${form.target.record.label}"` : 'this record'}{form.target?.label ? ` from ${form.target.label}` : ''}?</span>
                    <Button size="sm" variant="outline" onClick={() => setConfirmDelete(null)}>Keep it</Button>
                    <Button size="sm" variant="destructive" onClick={() => void press(confirmDelete)} data-confirm-delete>Delete</Button>
                  </div>
                )}
                {displayOnly && <DataTargetActions actions={form.target?.actions ?? []} trusted={trusted} />}
                {/* Delete shows only when the provider says the person may delete this record; a display form keeps Cancel (Close) and Delete. */}
                <FormButtonBar
                  buttons={form.buttons.filter((b) => b.kind !== 'draft' && (b.kind !== 'delete' || (form.target?.can_delete === true && form.target.mode !== 'create')) && (!displayOnly || b.kind === 'cancel' || b.kind === 'delete' || b.kind === 'link'))}
                  placement={form.theme_overrides?.button_placement} sticky={form.theme_overrides?.button_sticky === true} values={values} busy={busy} onClick={(b) => void press(b)} />
              </FormStepActions>
              </FormPagesProvider>
            </FormLookupProvider>
          )}
        </div>
      </FormThemeScope>
    </div>
  )
}
