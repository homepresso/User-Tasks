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
 * Cancel can show a message, redirect or close. **Delete record** (forms
 * bound to an external record through a data target whose provider can
 * delete it, lib/forms/data-target.ts) asks for confirmation, has the
 * provider delete the record, then shows a message, redirects or closes.
 * A redirect may target `{{target.return_url}}`: the page the data target
 * names as "back" (e.g. the list the record lives in), vetted by the
 * provider — the only external URL a redirect accepts without the
 * allowlist. Effects (start_workflow)
 * run on the server, never in the browser; the rest is presentation, which
 * the server plans (planButtonEffects) so the designer preview, the task
 * screen, the standalone page and API clients see the same result.
 *
 * Forms without a stored button config get the defaults. Pure and
 * isomorphic.
 */

import { readDeepPath } from './data-actions'
// Cycle (both import this module): used only at call time.
import { FIELD_BUTTON_ICONS } from './field-buttons'
import { isRuleMet, normalizeVisibleWhen, type VisibleWhen } from '@/lib/task-field-schema'
import { isPlainObject } from '@/lib/utils/guards'
import { pathValue } from './lookup'
import { formContextPath } from './form-params'
import { normalizeTableChanges, tableChangesProblem, type TableChangesConfig } from './table-changes'

export type FormButtonKind = 'submit' | 'cancel' | 'draft' | 'outcome' | 'delete' | 'link'
export type FormButtonStyle = 'primary' | 'secondary' | 'outline' | 'danger'
export type FormButtonSize = 'sm' | 'md' | 'lg'
export const FORM_BUTTON_STYLES: FormButtonStyle[] = ['primary', 'secondary', 'outline', 'danger']
export const FORM_BUTTON_SIZES: FormButtonSize[] = ['sm', 'md', 'lg']
export type FormActionType = 'message' | 'success_screen' | 'start_workflow' | 'redirect' | 'close' | 'apply_table_changes' | 'save_target'
/** save_target: what it does with the record (provider-defined; unset = the provider's default for the form, e.g. create on New, update on Edit). */
export type SaveTargetOperation = 'create' | 'update'
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
  /** apply_table_changes: loop over a Data table's changes (lib/forms/table-changes.ts). */
  table_changes?: TableChangesConfig
  /** start_workflow / apply_table_changes: also run for anonymous submissions of a public form link. Off by default. */
  allow_anonymous?: boolean
  /** save_target: create a new record or update the one the form opened (unset: the provider's default). */
  operation?: SaveTargetOperation
  /** save_target: when the record changed since the form opened — refuse (default) or overwrite. */
  conflict?: 'refuse' | 'overwrite'
  /** save_target: source fields set from an expression (source field key → template: {{user.email}}, a fixed value, {{form.x}} …), besides the binding's field mapping. */
  values?: Record<string, string>
  /** save_target: provider options (e.g. upload: false — a library form keeps the file and updates the columns only). */
  options?: Record<string, string | boolean>
}

export interface FormButton {
  id: string
  label: string
  kind: FormButtonKind
  style: FormButtonStyle
  /** outcome buttons: the task outcome they complete with. */
  outcome?: string
  /** Not shown in the bar (any button; a Button on the form may still press it). */
  hidden?: boolean
  actions?: FormAction[]
  /** An icon (FIELD_BUTTON_ICONS, lib/forms/field-buttons.ts), before the label unless icon_after. */
  icon?: string
  icon_after?: boolean
  /** Button size (default md: the theme's). */
  size?: FormButtonSize
  /** Its own colour (#rrggbb): the fill (outline / secondary: the border and text); the text colour is picked for it. */
  color?: string
  /** Shown only while this holds (a field rule, like a field's "Visible when"). Like hidden, it only hides the button: a Button on the form may still press it. */
  visible_when?: VisibleWhen
}

export const FORM_BUTTON_KINDS: FormButtonKind[] = ['submit', 'cancel', 'draft', 'outcome', 'delete', 'link']

/**
 * Redirect target: "back to where the record lives", as the form's data
 * target says (FormDataTargetState.return_url / the provider's submit or
 * delete result). Resolved when the button runs; never an open redirect —
 * the provider validates it, and core accepts only http(s) without
 * credentials.
 */
export const TARGET_RETURN_URL = '{{target.return_url}}'

/** `{{target.url.<name>}}`: a page the data target names for the record (e.g. `edit` — the record's edit form), provider-vetted. */
export const TARGET_URL_RE = /^\{\{target\.url\.([a-z][a-z0-9_]{0,40})\}\}$/

/** Is this a redirect address the data target fills in (return_url or url.<name>)? */
export function isTargetUrlToken(url: string | undefined | null): boolean {
  return url === TARGET_RETURN_URL || TARGET_URL_RE.test(String(url ?? ''))
}
export const FORM_ACTION_TYPES: FormActionType[] = ['save_target', 'message', 'success_screen', 'start_workflow', 'redirect', 'close', 'apply_table_changes']
export const FORM_ACTION_LABELS: Record<FormActionType, string> = {
  message: 'Show message',
  success_screen: 'Show success screen',
  start_workflow: 'Start workflow',
  redirect: 'Redirect',
  close: 'Close form',
  apply_table_changes: 'For each changed row',
  save_target: 'Save to the connected record',
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
  if (kind === 'cancel' || kind === 'delete') return ['message', 'redirect', 'close']
  if (kind === 'link') return ['redirect']
  if (kind === 'draft') return ['message']
  return FORM_ACTION_TYPES
}

export function isSubmittingButton(button: Pick<FormButton, 'kind'>): boolean {
  return button.kind === 'submit' || button.kind === 'outcome'
}

/**
 * The bar buttons a task submission counts as (Before-submit rules aimed at
 * a button apply to it only): the pressed button; without one (the task's
 * header outcome buttons, the API), the bar's submitting buttons completing
 * with `outcome` (an outcome button's outcome; a Submit button's: the
 * task's first outcome). Null when the task has no stored bar (every rule
 * applies).
 */
export function submissionButtonIds(rawButtons: unknown, input: { buttonId?: string | null; outcome?: string | null; outcomes?: string[] }): string[] | null {
  if (input.buttonId) return [input.buttonId]
  if (!Array.isArray(rawButtons)) return null
  const first = input.outcomes?.[0] ?? 'completed'
  return normalizeFormButtons(rawButtons)
    .filter((b) => isSubmittingButton(b) && (b.kind === 'outcome' ? (b.outcome ?? b.label) : first) === input.outcome)
    .map((b) => b.id)
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
    case 'apply_table_changes':
      out.table_changes = normalizeTableChanges(raw.table_changes)
      break
    case 'save_target': {
      if (raw.operation === 'create' || raw.operation === 'update') out.operation = raw.operation
      if (raw.conflict === 'overwrite') out.conflict = 'overwrite'
      if (isPlainObject(raw.values)) {
        const values: Record<string, string> = {}
        for (const [k, v] of Object.entries(raw.values).slice(0, 40)) if (/^[A-Za-z0-9_.:-]{1,200}$/.test(k) && typeof v === 'string' && v.trim()) values[k] = v.slice(0, 2000)
        if (Object.keys(values).length) out.values = values
      }
      if (isPlainObject(raw.options)) {
        const options: Record<string, string | boolean> = {}
        for (const [k, v] of Object.entries(raw.options).slice(0, 10)) if (/^[a-z][a-z0-9_]{0,40}$/.test(k) && (typeof v === 'boolean' || typeof v === 'string')) options[k] = typeof v === 'string' ? v.slice(0, 200) : v
        if (Object.keys(options).length) out.options = options
      }
      break
    }
  }
  if (raw.allow_anonymous === true && (type === 'start_workflow' || type === 'apply_table_changes')) out.allow_anonymous = true
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
    if ((kind === 'cancel' || kind === 'draft' || kind === 'delete') && out.some((b) => b.kind === kind)) continue
    let id = typeof entry.id === 'string' && ID_RE.test(entry.id) ? entry.id : kind
    for (let i = 2; ids.has(id); i++) id = `${kind}_${i}`
    ids.add(id)
    const style: FormButtonStyle = entry.style === 'secondary' || entry.style === 'danger' || entry.style === 'outline' ? entry.style : entry.style === 'primary' ? 'primary' : kind === 'cancel' || kind === 'draft' ? 'secondary' : kind === 'delete' ? 'danger' : 'primary'
    const button: FormButton = { id, label: str(entry.label, BUTTON_LIMITS.label) ?? defaultLabel(kind), kind, style }
    if (kind === 'outcome') {
      const outcome = str(entry.outcome, 200)
      button.outcome = outcome ?? button.label
    }
    if (entry.hidden === true) button.hidden = true
    if (typeof entry.icon === 'string' && (FIELD_BUTTON_ICONS as readonly string[]).includes(entry.icon)) {
      button.icon = entry.icon
      if (entry.icon_after === true) button.icon_after = true
    }
    if (entry.size === 'sm' || entry.size === 'lg') button.size = entry.size
    if (typeof entry.color === 'string' && /^#[0-9a-f]{6}$/i.test(entry.color)) button.color = entry.color.toLowerCase()
    const shownWhen = entry.visible_when ? normalizeVisibleWhen(entry.visible_when) : undefined
    if (shownWhen) button.visible_when = shownWhen
    if (Array.isArray(entry.actions)) {
      const actions = entry.actions.map((a) => normalizeAction(a, kind)).filter((a): a is FormAction => Boolean(a)).slice(0, BUTTON_LIMITS.actions)
      // "Save to …" runs first (the record is written before anything else happens): one, at the front.
      const save = actions.find((a) => a.type === 'save_target')
      const ordered = save ? [save, ...actions.filter((a) => a.type !== 'save_target')] : actions
      if (ordered.length) button.actions = ordered
    }
    out.push(button)
  }
  if (!out.some(isSubmittingButton)) out.unshift({ ...DEFAULT_FORM_BUTTONS[0], id: ids.has('submit') ? 'submit_main' : 'submit' })
  return out
}

/** Is a bar button shown for these values (not hidden, its "shown when" rule holds)? */
export function barButtonShown(button: Pick<FormButton, 'hidden' | 'visible_when'>, values: Record<string, unknown> | null | undefined): boolean {
  if (button.hidden) return false
  if (!button.visible_when) return true
  return isRuleMet(button.visible_when, values ?? {})
}

function defaultLabel(kind: FormButtonKind): string {
  return kind === 'cancel' ? 'Cancel' : kind === 'draft' ? 'Save draft' : kind === 'delete' ? 'Delete' : kind === 'link' ? 'Open' : 'Submit'
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
export function buttonProblems(buttons: FormButton[], options: { outcomes?: string[] | null; policy?: RedirectPolicy; editableTables?: ReadonlySet<string> } = {}): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const b of buttons) {
    if (!b.label.trim()) { problems[b.id] = 'Label is required'; continue }
    if (b.kind === 'outcome' && options.outcomes && options.outcomes.length && !options.outcomes.includes(b.outcome ?? '')) {
      problems[b.id] = `"${b.outcome}" is not one of this step's outcomes (${options.outcomes.join(', ')})`
      continue
    }
    for (const a of b.actions ?? []) {
      if (a.type === 'start_workflow' && !a.workflow_id) { problems[b.id] = 'Choose the workflow to start'; break }
      if (a.type === 'apply_table_changes' && options.editableTables) {
        const problem = tableChangesProblem(a.table_changes, options.editableTables)
        if (problem) { problems[b.id] = problem; break }
      }
      if (a.type === 'redirect' && !isTargetUrlToken(a.url) && !safeRedirectUrl(a.url, { ...options.policy, appOrigin: options.policy?.appOrigin ?? null })) {
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
  for (const b of buttons ?? []) {
    for (const a of b.actions ?? []) {
      if (a.type === 'start_workflow' && a.workflow_id) out.add(a.workflow_id)
      if (a.type === 'apply_table_changes' && a.table_changes?.target === 'workflow' && a.table_changes.workflow_id) out.add(a.table_changes.workflow_id)
    }
  }
  return [...out]
}

/* ── Placeholders ───────────────────────────────────────────────────── */

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]*]+)\s*\}\}/g

export interface ButtonScope {
  values: Record<string, unknown>
  /** submission id, run reference(s), submitter name… */
  extras?: Record<string, unknown>
  /** The data target's "back" page ({{target.return_url}}), provider-vetted. */
  targetReturnUrl?: string | null
  /** The data target's named pages ({{target.url.<name>}}): app paths or http(s), provider-vetted. */
  targetUrls?: Record<string, string> | null
}

/** A provider's named page → usable: an app path (one leading /) or http(s) without credentials, or null. */
export function cleanTargetUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return null
  if (raw.startsWith('/') && !raw.startsWith('//') && !raw.startsWith('/\\')) return /[\u0000-\u001f\s]/.test(raw) ? null : raw
  return cleanReturnUrl(raw)
}

/** A provider's return URL → usable (http(s), no credentials), or null. */
export function cleanReturnUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw || raw.length > 2000) return null
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
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
    // Nested extras: {{event.row.name}}, {{user.email}} (form rules).
    // Nested extras with [n] / [*] too: {{result[0].name}}, {{result[*].sku}}, {{row.item}}.
    const root = path.split(/[.[]/)[0]
    if (root !== path && Object.prototype.hasOwnProperty.call(extras, root)) return display(readDeepPath(extras[root], path.slice(root.length).replace(/^\./, '')))
    const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
    return display(pathValue(scope.values, formContextPath(path) ?? (m ? m[1] : path)))
  })
}

/**
 * Raw value of a start-workflow input template: one placeholder → the typed
 * value (numbers stay numbers, lookups' `_item` objects stay objects); mixed
 * text → interpolated text.
 */
export function resolveInputTemplate(template: string, scope: ButtonScope): unknown {
  const whole = /^\{\{\s*([\w.\-[\]*]+)\s*\}\}$/.exec(template.trim())
  if (whole) {
    const path = whole[1]
    const extras = scope.extras ?? {}
    if (Object.prototype.hasOwnProperty.call(extras, path)) return extras[path]
    const root = path.split(/[.[]/)[0]
    if (root !== path && Object.prototype.hasOwnProperty.call(extras, root)) {
      const nested = readDeepPath(extras[root], path.slice(root.length).replace(/^\./, ''))
      return nested === undefined ? null : nested
    }
    const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
    const v = pathValue(scope.values, formContextPath(path) ?? (m ? m[1] : path))
    return v === undefined ? null : v
  }
  return interpolateButtonText(template, scope)
}

/* ── What the user sees after a click ────────────────────────────────── */

export interface ButtonEffects {
  messages: Array<{ text: string; tone: 'success' | 'info' }>
  success_screen?: {
    title: string
    text?: string
    /** The first (older screens: the only) button; `buttons` lists them all when present. */
    button: 'submit_another' | 'close' | 'link' | 'none'
    button_label?: string
    url?: string
    /** Set by the form's Submitted page (lib/forms/submitted-page.ts); absent on a button's own screen. */
    source?: 'form'
    icon?: { kind: 'icon'; name: string; color: string } | { kind: 'image'; url: string; alt?: string }
    summary?: Array<{ label: string; value: string }>
    note?: string
    buttons?: Array<{ kind: 'submit_another' | 'close' | 'link'; label: string; url?: string }>
  }
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
      const named = TARGET_URL_RE.exec(String(action.url ?? ''))?.[1]
      const url = action.url === TARGET_RETURN_URL ? cleanReturnUrl(scope.targetReturnUrl)
        : named ? cleanTargetUrl(scope.targetUrls?.[named])
          : safeRedirectUrl(action.url, policy)
      if (url) out.redirect = url
    } else if (action.type === 'close') out.close = true
  }
  return out
}
