/**
 * Form buttons and their behaviours.
 *
 * Every form has a button bar: by default **Submit** (primary) and
 * **Cancel** (secondary). The designer renames them, picks a style, hides
 * Cancel, and adds buttons — **Save draft** (task forms) or **outcome**
 * buttons mapped to a task outcome (Approve / Reject). Placement (left,
 * right, full width) comes from the mini theme (`button_placement`).
 *
 * A submitting button (submit / outcome) runs an ordered list of actions
 * after the values pass validation:
 *   message          a toast / inline text ({{field}} placeholders)
 *   success_screen   replace the form with a title, text and a button
 *                    (submit another / close / a link)
 *   start_workflow   start a workflow with form values mapped to its inputs
 *                    (server-side, async; {{run_reference}} in later texts)
 *   redirect         go to an app page or an allowed URL
 *   close            close the form
 * Cancel can show a message, redirect or close. Effects (start_workflow)
 * run on the server, never in the browser; the rest is presentation, which
 * the server plans (planButtonEffects) so the designer preview, the task
 * screen, the standalone page and API clients see the same result.
 *
 * Forms without a stored button config get the defaults. Pure and
 * isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { pathValue } from './lookup'

export type FormButtonKind = 'submit' | 'cancel' | 'draft' | 'outcome'
export type FormButtonStyle = 'primary' | 'secondary' | 'danger'
export type FormActionType = 'message' | 'success_screen' | 'start_workflow' | 'redirect' | 'close'
export type ButtonPlacement = 'left' | 'right' | 'full'

export interface FormAction {
  type: FormActionType
  /** message: the text; success_screen: the body. */
  text?: string
  /** success_screen: the heading. */
  title?: string
  /** message: tone of the toast. */
  tone?: 'success' | 'info'
  /** success_screen: the button under the text. */
  screen_button?: 'submit_another' | 'close' | 'link' | 'none'
  screen_button_label?: string
  /** success_screen link / redirect target. */
  url?: string
  /** start_workflow: the workflow and its inputs (input name → template). */
  workflow_id?: string
  workflow_name?: string
  inputs?: Record<string, string>
  /**
   * start_workflow: this action was made by "Publish as form page" from the
   * workflow's start form (lib/forms/form-page.ts). `key` fingerprints the
   * fields / layout / theme / input mapping as last synced, so a later
   * change on either side is detected (never overwritten silently).
   */
  start_form_page?: { key: string }
}

export interface FormButton {
  id: string
  label: string
  kind: FormButtonKind
  style: FormButtonStyle
  /** outcome buttons: the task outcome they complete with. */
  outcome?: string
  hidden?: boolean
  actions?: FormAction[]
}

export const FORM_BUTTON_KINDS: FormButtonKind[] = ['submit', 'cancel', 'draft', 'outcome']
export const FORM_ACTION_TYPES: FormActionType[] = ['message', 'success_screen', 'start_workflow', 'redirect', 'close']
export const FORM_ACTION_LABELS: Record<FormActionType, string> = {
  message: 'Show message',
  success_screen: 'Show success screen',
  start_workflow: 'Start workflow',
  redirect: 'Redirect',
  close: 'Close form',
}

export const DEFAULT_FORM_BUTTONS: FormButton[] = [
  { id: 'submit', label: 'Submit', kind: 'submit', style: 'primary' },
  { id: 'cancel', label: 'Cancel', kind: 'cancel', style: 'secondary' },
]

export const BUTTON_LIMITS = { buttons: 8, actions: 8, label: 60, text: 1000, title: 120, inputs: 50, template: 500 } as const

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Which actions a button kind may run. */
export function allowedActions(kind: FormButtonKind): FormActionType[] {
  if (kind === 'cancel') return ['message', 'redirect', 'close']
  if (kind === 'draft') return ['message']
  return FORM_ACTION_TYPES
}

export function isSubmittingButton(button: Pick<FormButton, 'kind'>): boolean {
  return button.kind === 'submit' || button.kind === 'outcome'
}

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

function normalizeAction(raw: unknown, kind: FormButtonKind): FormAction | null {
  if (!isPlainObject(raw)) return null
  const type = FORM_ACTION_TYPES.includes(raw.type as FormActionType) ? raw.type as FormActionType : null
  if (!type || !allowedActions(kind).includes(type)) return null
  const out: FormAction = { type }
  switch (type) {
    case 'message': {
      out.text = str(raw.text, BUTTON_LIMITS.text) ?? 'Thank you.'
      if (raw.tone === 'info') out.tone = 'info'
      break
    }
    case 'success_screen': {
      out.title = str(raw.title, BUTTON_LIMITS.title) ?? 'Thank you'
      const body = str(raw.text, BUTTON_LIMITS.text)
      if (body) out.text = body
      const sb = raw.screen_button
      out.screen_button = sb === 'close' || sb === 'link' || sb === 'none' ? sb : 'submit_another'
      const label = str(raw.screen_button_label, BUTTON_LIMITS.label)
      if (label) out.screen_button_label = label
      if (out.screen_button === 'link') {
        const url = str(raw.url, 2000)
        if (url) out.url = url
      }
      break
    }
    case 'start_workflow': {
      if (typeof raw.workflow_id === 'string' && UUID_RE.test(raw.workflow_id)) out.workflow_id = raw.workflow_id
      const name = str(raw.workflow_name, 200)
      if (name) out.workflow_name = name
      if (isPlainObject(raw.inputs)) {
        const inputs: Record<string, string> = {}
        for (const [k, v] of Object.entries(raw.inputs).slice(0, BUTTON_LIMITS.inputs)) {
          if (!/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(k)) continue
          const t = typeof v === 'string' ? v.slice(0, BUTTON_LIMITS.template) : v === null || v === undefined ? '' : String(v).slice(0, BUTTON_LIMITS.template)
          if (t) inputs[k] = t
        }
        if (Object.keys(inputs).length) out.inputs = inputs
      }
      if (isPlainObject(raw.start_form_page) && typeof raw.start_form_page.key === 'string' && /^[0-9a-f]{16}$/.test(raw.start_form_page.key)) {
        out.start_form_page = { key: raw.start_form_page.key }
      }
      break
    }
    case 'redirect': {
      const url = str(raw.url, 2000)
      if (url) out.url = url
      break
    }
    case 'close':
      break
  }
  return out
}

/**
 * Stored / submitted buttons → a clean list (null / empty → the defaults).
 * Ids are unique slugs; at least one submitting button is kept (a Submit is
 * added when none is left); at most one cancel and one draft button.
 */
export function normalizeFormButtons(raw: unknown): FormButton[] {
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_FORM_BUTTONS.map((b) => ({ ...b }))
  const out: FormButton[] = []
  const ids = new Set<string>()
  for (const entry of raw) {
    if (!isPlainObject(entry) || out.length >= BUTTON_LIMITS.buttons) continue
    const kind = FORM_BUTTON_KINDS.includes(entry.kind as FormButtonKind) ? entry.kind as FormButtonKind : 'submit'
    if ((kind === 'cancel' || kind === 'draft') && out.some((b) => b.kind === kind)) continue
    let id = typeof entry.id === 'string' && ID_RE.test(entry.id) ? entry.id : kind
    for (let i = 2; ids.has(id); i++) id = `${kind}_${i}`
    ids.add(id)
    const style: FormButtonStyle = entry.style === 'secondary' || entry.style === 'danger' ? entry.style : entry.style === 'primary' ? 'primary' : kind === 'cancel' || kind === 'draft' ? 'secondary' : 'primary'
    const button: FormButton = { id, label: str(entry.label, BUTTON_LIMITS.label) ?? defaultLabel(kind), kind, style }
    if (kind === 'outcome') {
      const outcome = str(entry.outcome, 200)
      button.outcome = outcome ?? button.label
    }
    if (entry.hidden === true && kind === 'cancel') button.hidden = true
    if (Array.isArray(entry.actions)) {
      const actions = entry.actions.map((a) => normalizeAction(a, kind)).filter((a): a is FormAction => Boolean(a)).slice(0, BUTTON_LIMITS.actions)
      if (actions.length) button.actions = actions
    }
    out.push(button)
  }
  if (!out.some(isSubmittingButton)) out.unshift({ ...DEFAULT_FORM_BUTTONS[0], id: ids.has('submit') ? 'submit_main' : 'submit' })
  return out
}

function defaultLabel(kind: FormButtonKind): string {
  return kind === 'cancel' ? 'Cancel' : kind === 'draft' ? 'Save draft' : 'Submit'
}

/** Is a stored button list just the defaults (so it needn't be stored)? */
export function isDefaultButtons(buttons: FormButton[]): boolean {
  return JSON.stringify(normalizeFormButtons(buttons)) === JSON.stringify(normalizeFormButtons(null))
}

export interface RedirectPolicy {
  /** The app's origin (https://app.example.com); relative paths are always same-origin. */
  appOrigin?: string | null
  /** Other hosts redirects may go to (FORM_REDIRECT_ALLOWLIST, comma-separated). */
  allowedHosts?: string[]
}

/**
 * A redirect / link target, or null when not allowed: an app path
 * (`/tasks`, not `//host`), the app's own origin, or an allow-listed host —
 * http(s) only, no credentials in the URL.
 */
export function safeRedirectUrl(raw: string | undefined | null, policy: RedirectPolicy = {}): string | null {
  const url = String(raw ?? '').trim()
  if (!url) return null
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) {
    return /[\u0000-\u001f\s]/.test(url) ? null : url
  }
  let parsed: URL
  try { parsed = new URL(url) } catch { return null }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  if (parsed.username || parsed.password) return null
  const host = parsed.host.toLowerCase()
  let appHost: string | null = null
  try { appHost = policy.appOrigin ? new URL(policy.appOrigin).host.toLowerCase() : null } catch { appHost = null }
  if (appHost && host === appHost) return parsed.toString()
  const allowed = (policy.allowedHosts ?? []).map((h) => h.trim().toLowerCase()).filter(Boolean)
  if (allowed.some((h) => host === h || (h.startsWith('*.') && host.endsWith(h.slice(1))))) return parsed.toString()
  return null
}

/** Allowed redirect hosts from the environment (server side). */
export function redirectAllowlistFromEnv(env: Record<string, string | undefined> = typeof process !== 'undefined' ? process.env : {}): string[] {
  return String(env.FORM_REDIRECT_ALLOWLIST ?? '').split(',').map((h) => h.trim()).filter(Boolean)
}

/** Problems the designer flags (button id → message). */
export function buttonProblems(buttons: FormButton[], options: { outcomes?: string[] | null; policy?: RedirectPolicy } = {}): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const b of buttons) {
    if (!b.label.trim()) { problems[b.id] = 'Label is required'; continue }
    if (b.kind === 'outcome' && options.outcomes && options.outcomes.length && !options.outcomes.includes(b.outcome ?? '')) {
      problems[b.id] = `"${b.outcome}" is not one of this step's outcomes (${options.outcomes.join(', ')})`
      continue
    }
    for (const a of b.actions ?? []) {
      if (a.type === 'start_workflow' && !a.workflow_id) { problems[b.id] = 'Choose the workflow to start'; break }
      if (a.type === 'redirect' && !safeRedirectUrl(a.url, { ...options.policy, appOrigin: options.policy?.appOrigin ?? null })) {
        problems[b.id] = 'Redirect to an app page (/…) or an allowed address'
        break
      }
      if (a.type === 'success_screen' && a.screen_button === 'link' && !safeRedirectUrl(a.url, options.policy)) {
        problems[b.id] = 'The success screen link must be an app page (/…) or an allowed address'
        break
      }
    }
  }
  return problems
}

/** Workflows the buttons start (design-time permission check, dependencies). */
export function startedWorkflowIds(buttons: FormButton[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const b of buttons ?? []) for (const a of b.actions ?? []) if (a.type === 'start_workflow' && a.workflow_id) out.add(a.workflow_id)
  return [...out]
}

/* ── Placeholders ───────────────────────────────────────────────────── */

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]]+)\s*\}\}/g

export interface ButtonScope {
  values: Record<string, unknown>
  /** submission id, run reference(s), submitter name… */
  extras?: Record<string, unknown>
}

function display(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(display).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    const first = o.name ?? o.label ?? o.title ?? Object.values(o).find((x) => typeof x === 'string')
    return typeof first === 'string' ? first : ''
  }
  return String(v)
}

/** {{field}}, {{form.field}}, {{task_data.field}}, {{run_reference}}, {{submission_id}} → text. */
export function interpolateButtonText(template: string | undefined, scope: ButtonScope): string {
  if (!template) return ''
  return template.replace(TEMPLATE_RE, (_m, path: string) => {
    const extras = scope.extras ?? {}
    if (Object.prototype.hasOwnProperty.call(extras, path)) return display(extras[path])
    const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
    return display(pathValue(scope.values, m ? m[1] : path))
  })
}

/**
 * Raw value of a start-workflow input template: one placeholder → the typed
 * value (numbers stay numbers, lookups' `_item` objects stay objects); mixed
 * text → interpolated text.
 */
export function resolveInputTemplate(template: string, scope: ButtonScope): unknown {
  const whole = /^\{\{\s*([\w.\-[\]]+)\s*\}\}$/.exec(template.trim())
  if (whole) {
    const path = whole[1]
    const extras = scope.extras ?? {}
    if (Object.prototype.hasOwnProperty.call(extras, path)) return extras[path]
    const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
    const v = pathValue(scope.values, m ? m[1] : path)
    return v === undefined ? null : v
  }
  return interpolateButtonText(template, scope)
}

/* ── What the user sees after a click ────────────────────────────────── */

export interface ButtonEffects {
  messages: Array<{ text: string; tone: 'success' | 'info' }>
  success_screen?: { title: string; text?: string; button: 'submit_another' | 'close' | 'link' | 'none'; button_label?: string; url?: string }
  redirect?: string
  close?: boolean
}

/**
 * The presentation of a button's actions, in order, with placeholders
 * filled. A redirect that isn't allowed is dropped. Start-workflow actions
 * contribute only through {{run_reference}} (the caller runs them first).
 */
export function planButtonEffects(button: FormButton, scope: ButtonScope, policy: RedirectPolicy = {}): ButtonEffects {
  const out: ButtonEffects = { messages: [] }
  for (const action of button.actions ?? []) {
    if (action.type === 'message') out.messages.push({ text: interpolateButtonText(action.text, scope), tone: action.tone === 'info' ? 'info' : 'success' })
    else if (action.type === 'success_screen') {
      const screen: NonNullable<ButtonEffects['success_screen']> = {
        title: interpolateButtonText(action.title, scope),
        button: action.screen_button ?? 'submit_another',
      }
      const text = interpolateButtonText(action.text, scope)
      if (text) screen.text = text
      if (action.screen_button_label) screen.button_label = action.screen_button_label
      if (screen.button === 'link') {
        const url = safeRedirectUrl(action.url, policy)
        if (url) screen.url = url
        else screen.button = 'none'
      }
      out.success_screen = screen
    } else if (action.type === 'redirect') {
      const url = safeRedirectUrl(action.url, policy)
      if (url) out.redirect = url
    } else if (action.type === 'close') out.close = true
  }
  return out
}
