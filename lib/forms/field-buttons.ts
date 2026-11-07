/**
 * In-form buttons: the "Button" element (field type `button`) placed in any
 * grid cell on any page / tab / step. It holds no value. Its `button`
 * config: style, size, icon, full width, alignment, tooltip, a confirm
 * prompt, `disabled_when` (the field's own `visible_when` shows / hides it)
 * and an ordered list of actions run on click:
 *
 *   show_hide      show / hide / toggle fields, sections, rows, steps / tabs
 *   set_state      set / toggle a form state flag (read by rules as state.<flag>)
 *   go_to_page     go to a step / tab
 *   next_page      Next step (validates the step, like the wizard's Next)
 *   previous_page  Back
 *   set_values     set fields to a literal or a {{field}} template
 *   clear_values   clear fields
 *   validate       check the current page / the whole form; stops on errors
 *   submit         press one of the bar's submitting buttons (its own actions
 *                  run: message, success screen, start workflow, redirect, close)
 *   save_draft     press the bar's Save draft button (task forms)
 *   print          the browser's print dialog
 *   open_link      an app page or an allow-listed address (same rule as redirects)
 *   message        show a message: a banner at the top of the form or inline
 *                  under the button; tone, title and how long it stays
 *                  (lib/forms/form-messages.ts)
 *   prompt         ask a question (OK / Yes / No / custom buttons) as a banner
 *                  or a dialog; each response runs its own actions and says
 *                  whether the steps after the question run
 *
 * Show / hide and state flags are form UI state (lib/forms/form-state.ts),
 * judged again by the server on submit. Submit goes through the surface's
 * own pipeline, so validation and effects are exactly the bar button's.
 * Pure and isomorphic; runFieldButton drives a host the renderer provides.
 */

import { isPlainObject } from '@/lib/utils/guards'
import type { VisibleWhen } from '@/lib/task-field-schema'
import { interpolateButtonText, resolveInputTemplate, safeRedirectUrl, type RedirectPolicy } from './buttons'
import { normalizeTableChanges, tableChangesProblem, type TableChangesConfig } from './table-changes'
import {
  DISMISSED_RESPONSE, clampSeconds, escapeResponse, normalizePromptConfig, promptButton,
  type MessageDuration, type MessageStyle, type MessageTone, type PromptButtonStyle, type PromptConfig, type PromptDisplay,
} from './form-messages'
import {
  applyCollapsed, applyEnabled, applyFlag, applyLoaded, applyReadOnly, applyVisibility, flagKey, isReadOnlyTarget, parseTarget, type FormUiState,
} from './form-state'
import { FORM_VARS_KEY, setVariables } from './form-params'
import { isResultPath, normalizeResultPath } from './result-paths'

export type FieldButtonStyle = 'primary' | 'secondary' | 'outline' | 'link' | 'danger'
export type FieldButtonSize = 'sm' | 'md' | 'lg'
export type FieldButtonAlign = 'left' | 'center' | 'right'
export type FieldButtonActionType =
  | 'show_hide' | 'set_state' | 'go_to_page' | 'next_page' | 'previous_page' | 'set_values' | 'clear_values'
  | 'validate' | 'submit' | 'save_draft' | 'print' | 'open_link' | 'message' | 'prompt' | 'apply_table_changes'
  | RuleOnlyActionType

/**
 * Actions only form rules (lib/forms/form-rules.ts) offer — the same
 * framework, run by the same runner: enable / disable, a field error or a
 * blocked submit (Validate), copying values from the event (Transfer data),
 * refreshing a Data table / autocomplete, running a lookup, and the
 * server-side API call / workflow start.
 */
export type RuleOnlyActionType =
  | 'enable_disable' | 'field_error' | 'block_submit' | 'copy_values' | 'refresh' | 'run_lookup' | 'call_reference' | 'start_workflow'
  | 'set_variable' | 'collapse_expand' | 'load_part' | 'read_only'

export const RULE_ONLY_ACTION_TYPES: RuleOnlyActionType[] = ['enable_disable', 'field_error', 'block_submit', 'copy_values', 'refresh', 'run_lookup', 'call_reference', 'start_workflow']
// Form variables (lib/forms/form-params.ts).
RULE_ONLY_ACTION_TYPES.push('set_variable')
// Sections (lib/forms/sections.ts).
RULE_ONLY_ACTION_TYPES.push('collapse_expand')
// When to load (lib/forms/lazy-load.ts).
RULE_ONLY_ACTION_TYPES.push('load_part')
// Read only (lib/forms/form-state.ts applyReadOnly): controls, sections, steps / tabs or the whole form.
RULE_ONLY_ACTION_TYPES.push('read_only')
/** Rule actions that run on the server (targets from the saved form). */
export const SERVER_RULE_ACTIONS: ReadonlySet<FieldButtonActionType> = new Set(['call_reference', 'start_workflow', 'apply_table_changes'])

export const FIELD_BUTTON_STYLES: FieldButtonStyle[] = ['primary', 'secondary', 'outline', 'link', 'danger']
export const FIELD_BUTTON_SIZES: FieldButtonSize[] = ['sm', 'md', 'lg']
export const FIELD_BUTTON_ALIGNS: FieldButtonAlign[] = ['left', 'center', 'right']
/** Icons a button can show (lucide names; drawn by components/forms/field-button.tsx). */
export const FIELD_BUTTON_ICONS = [
  'chevron-right', 'chevron-left', 'arrow-right', 'arrow-left', 'chevron-down', 'chevron-up', 'eye', 'eye-off', 'check', 'send', 'save',
  'printer', 'external-link', 'plus', 'minus', 'rotate-ccw', 'info', 'x', 'pencil', 'list',
] as const
export type FieldButtonIcon = typeof FIELD_BUTTON_ICONS[number]

export const FIELD_BUTTON_ACTION_TYPES: FieldButtonActionType[] = [
  'show_hide', 'set_state', 'go_to_page', 'next_page', 'previous_page', 'set_values', 'clear_values', 'validate', 'submit', 'save_draft', 'print', 'open_link', 'message',
  'prompt', 'apply_table_changes',
]
export const FIELD_BUTTON_ACTION_LABELS: Record<FieldButtonActionType, string> = {
  show_hide: 'Show / hide',
  set_state: 'Set a state flag',
  go_to_page: 'Go to step / tab',
  next_page: 'Next step',
  previous_page: 'Back',
  set_values: 'Set field values',
  clear_values: 'Clear fields',
  validate: 'Validate',
  submit: 'Submit',
  save_draft: 'Save draft',
  print: 'Print',
  open_link: 'Open link',
  message: 'Show message',
  prompt: 'Ask a question',
  apply_table_changes: 'Apply table changes',
  enable_disable: 'Enable / disable',
  field_error: 'Show an error on a field',
  block_submit: 'Block submit with a message',
  copy_values: 'Copy values into fields',
  refresh: 'Refresh a Data table / autocomplete',
  run_lookup: 'Run a lookup',
  call_reference: 'Call an API reference',
  start_workflow: 'Start a workflow',
  set_variable: 'Set a variable',
  collapse_expand: 'Collapse / expand a section',
  load_part: 'Load section / tab',
  read_only: 'Make read only / editable',
}

export interface FieldButtonAction {
  type: FieldButtonActionType
  /** show_hide (show / hide / toggle); enable_disable (enable / disable / toggle); collapse_expand (collapse / expand / toggle); read_only (read_only / editable / toggle) */
  mode?: 'show' | 'hide' | 'toggle' | 'enable' | 'disable' | 'collapse' | 'expand' | 'read_only' | 'editable'
  targets?: string[]
  /** set_state */
  flag?: string
  state_value?: 'true' | 'false' | 'toggle'
  /** go_to_page */
  page?: string
  /** set_values: field key → literal or {{template}} */
  assign?: Record<string, string>
  /** clear_values */
  fields?: string[]
  /** validate */
  scope?: 'page' | 'form'
  /** submit: the bar button whose behaviour runs (default: the first submitting one) */
  button?: string
  /** open_link */
  url?: string
  new_tab?: boolean
  /** message / prompt (and field_error / block_submit) */
  text?: string
  /** message / prompt: info (absent) | success | warning | error */
  tone?: Exclude<MessageTone, 'info'>
  /** message / prompt: a heading above the text */
  title?: string
  /** message: banner at the top of the form, or inline (absent: the original inline message) */
  style?: MessageStyle
  /** message: how long it stays (absent: until dismissed) */
  duration?: Exclude<MessageDuration, 'dismiss'>
  /** message: seconds before an auto-hide (2–60) */
  seconds?: number
  /** prompt: display, responses and each response's actions */
  prompt?: PromptConfig<FieldButtonAction>
  /** apply_table_changes: the "for each changed row" rule (run on the server). */
  table_changes?: TableChangesConfig
  /** field_error / block_submit / refresh / run_lookup: the field it is about. */
  field?: string
  /** run_lookup: the search text (template). */
  query?: string
  /** call_reference: the API reference and its inputs (name → template). */
  integration_id?: string
  reference_id?: string
  /** call_reference / start_workflow: inputs (name → template). */
  inputs?: Record<string, string>
  /** call_reference: response path → form field or `var.<name>` (mapped on the server; only declared fields / variables are written). */
  results?: Record<string, string>
  /** call_reference: when the call fails — show a message (default) or leave the fields unchanged and go on with the rule. */
  on_error?: 'message' | 'ignore'
  /** call_reference: the message shown when it fails (default: the service's error). */
  error_text?: string
  /** start_workflow */
  workflow_id?: string
  workflow_name?: string
  /** set_variable: the variable, and set (to `value`, a literal or template), clear (empty) or reset (its initial value). */
  variable?: string
  variable_mode?: 'set' | 'clear' | 'reset'
  value?: string
  /** Server steps (call_reference, start_workflow, apply_table_changes): also run for anonymous visitors of a public form link. Off by default. */
  allow_anonymous?: boolean
}

export interface FieldButtonConfig {
  style: FieldButtonStyle
  size?: FieldButtonSize
  icon?: FieldButtonIcon
  /** The icon after the label (default before). */
  icon_after?: boolean
  full_width?: boolean
  align?: FieldButtonAlign
  tooltip?: string
  /** Ask before running the actions. */
  confirm?: string
  /** Greyed out while this rule holds. */
  disabled_when?: VisibleWhen
  actions: FieldButtonAction[]
}

export const FIELD_BUTTON_LIMITS = { actions: 12, targets: 30, assign: 30, text: 500, tooltip: 200, template: 500, inputs: 40 } as const

const KEY_RE = /^[a-z0-9_]{1,64}$/
const VAR_NAME_RE = /^[a-z][a-z0-9_]{0,39}$/
/** A call_reference result written to a form variable. */
export const VAR_TARGET_RE = /^var\.[a-z][a-z0-9_]{0,39}$/
const PAGE_RE = /^[A-Za-z0-9_-]{1,40}$/
const BAR_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/

function str(raw: unknown, max: number): string | undefined {
  if (typeof raw !== 'string') return undefined
  const s = raw.trim()
  return s ? s.slice(0, max) : undefined
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function templateMap(raw: unknown, keyRe: RegExp): Record<string, string> | undefined {
  if (!isPlainObject(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw).slice(0, FIELD_BUTTON_LIMITS.inputs)) {
    if (!keyRe.test(k) || k === '__proto__') continue
    const t = v === null || v === undefined ? '' : String(v).slice(0, FIELD_BUTTON_LIMITS.template)
    if (t) out[k] = t
  }
  return Object.keys(out).length ? out : undefined
}

/** Clean one action (a Button's; `rule: true` also allows the rule-only actions). */
export function normalizeFieldButtonAction(raw: unknown, options: { rule?: boolean } = {}): FieldButtonAction | null {
  return normalizeAction(raw, options.rule === true)
}

function normalizeAction(raw: unknown, rule = false): FieldButtonAction | null {
  if (!isPlainObject(raw)) return null
  const known = FIELD_BUTTON_ACTION_TYPES.includes(raw.type as FieldButtonActionType) || (rule && RULE_ONLY_ACTION_TYPES.includes(raw.type as RuleOnlyActionType))
  const type = known ? raw.type as FieldButtonActionType : null
  if (!type) return null
  const out: FieldButtonAction = { type }
  switch (type) {
    case 'show_hide': {
      out.mode = raw.mode === 'show' || raw.mode === 'hide' ? raw.mode : 'toggle'
      out.targets = Array.isArray(raw.targets) ? [...new Set(raw.targets.filter((t): t is string => Boolean(parseTarget(t))))].slice(0, FIELD_BUTTON_LIMITS.targets) : []
      break
    }
    case 'set_state': {
      out.flag = flagKey(raw.flag)
      out.state_value = raw.state_value === 'false' || raw.state_value === false ? 'false' : raw.state_value === 'true' || raw.state_value === true ? 'true' : 'toggle'
      break
    }
    case 'go_to_page': {
      if (typeof raw.page === 'string' && PAGE_RE.test(raw.page)) out.page = raw.page
      break
    }
    case 'set_values': {
      const assign: Record<string, string> = {}
      if (isPlainObject(raw.assign)) {
        for (const [k, v] of Object.entries(raw.assign).slice(0, FIELD_BUTTON_LIMITS.assign)) {
          if (!KEY_RE.test(k)) continue
          assign[k] = v === null || v === undefined ? '' : String(v).slice(0, FIELD_BUTTON_LIMITS.template)
        }
      }
      out.assign = assign
      break
    }
    case 'clear_values': {
      out.fields = Array.isArray(raw.fields) ? [...new Set(raw.fields.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))].slice(0, FIELD_BUTTON_LIMITS.assign) : []
      break
    }
    case 'validate':
      out.scope = raw.scope === 'page' ? 'page' : 'form'
      break
    case 'submit':
      if (typeof raw.button === 'string' && BAR_ID_RE.test(raw.button)) out.button = raw.button
      break
    case 'open_link': {
      const url = str(raw.url, 2000)
      if (url) out.url = url
      if (raw.new_tab === true) out.new_tab = true
      break
    }
    case 'message':
    case 'prompt': {
      out.text = str(raw.text, FIELD_BUTTON_LIMITS.text) ?? (type === 'message' ? 'Done.' : 'Are you sure?')
      if (raw.tone === 'success' || raw.tone === 'warning' || raw.tone === 'error') out.tone = raw.tone
      const title = str(raw.title, 120)
      if (title) out.title = title
      if (type === 'message') {
        // No style = a message saved before banners: it keeps its original inline look.
        if (raw.style === 'banner' || raw.style === 'inline') out.style = raw.style
        if (raw.duration === 'auto' || raw.duration === 'next_action' || raw.duration === 'sticky') out.duration = raw.duration
        if (out.duration === 'auto') out.seconds = clampSeconds(raw.seconds)
      } else {
        // One level: a response's actions cannot ask another question.
        out.prompt = normalizePromptConfig<FieldButtonAction>(raw.prompt, (list) => list.map((a) => normalizeAction(a, rule)).filter((a): a is FieldButtonAction => Boolean(a) && a!.type !== 'prompt'))
      }
      break
    }
    case 'apply_table_changes':
      out.table_changes = normalizeTableChanges(raw.table_changes)
      break
    case 'enable_disable': {
      out.mode = raw.mode === 'enable' || raw.mode === 'disable' ? raw.mode : 'toggle'
      out.targets = Array.isArray(raw.targets) ? [...new Set(raw.targets.filter((t): t is string => Boolean(parseTarget(t))))].slice(0, FIELD_BUTTON_LIMITS.targets) : []
      break
    }
    case 'read_only': {
      // Targets: fields, sections, rows, steps / tabs, or the whole form (`form:*`).
      out.mode = raw.mode === 'read_only' || raw.mode === 'editable' ? raw.mode : 'toggle'
      out.targets = Array.isArray(raw.targets) ? [...new Set(raw.targets.filter(isReadOnlyTarget))].slice(0, FIELD_BUTTON_LIMITS.targets) : []
      break
    }
    case 'collapse_expand': {
      out.mode = raw.mode === 'collapse' || raw.mode === 'expand' ? raw.mode : 'toggle'
      out.targets = Array.isArray(raw.targets) ? [...new Set(raw.targets.filter((t): t is string => parseTarget(t)?.kind === 'section'))].slice(0, FIELD_BUTTON_LIMITS.targets) : []
      break
    }
    case 'load_part': {
      out.targets = Array.isArray(raw.targets) ? [...new Set(raw.targets.filter((t): t is string => { const k = parseTarget(t)?.kind; return k === 'section' || k === 'page' }))].slice(0, FIELD_BUTTON_LIMITS.targets) : []
      break
    }
    case 'field_error':
    case 'block_submit':
      if (typeof raw.field === 'string' && KEY_RE.test(raw.field)) out.field = raw.field
      out.text = str(raw.text, FIELD_BUTTON_LIMITS.text) ?? (type === 'field_error' ? 'Check this value.' : 'The form cannot be submitted yet.')
      break
    case 'copy_values': {
      const assign: Record<string, string> = {}
      if (isPlainObject(raw.assign)) {
        for (const [k, v] of Object.entries(raw.assign).slice(0, FIELD_BUTTON_LIMITS.assign)) {
          if (!KEY_RE.test(k)) continue
          assign[k] = v === null || v === undefined ? '' : String(v).slice(0, FIELD_BUTTON_LIMITS.template)
        }
      }
      out.assign = assign
      break
    }
    case 'refresh':
      if (typeof raw.field === 'string' && KEY_RE.test(raw.field)) out.field = raw.field
      break
    case 'run_lookup': {
      if (typeof raw.field === 'string' && KEY_RE.test(raw.field)) out.field = raw.field
      const query = str(raw.query, FIELD_BUTTON_LIMITS.template)
      if (query) out.query = query
      break
    }
    case 'call_reference': {
      const integrationId = str(raw.integration_id, 64)
      const referenceId = str(raw.reference_id, 64)
      if (integrationId) out.integration_id = integrationId
      if (referenceId) out.reference_id = referenceId
      const inputs = templateMap(raw.inputs, /^[A-Za-z0-9_.$-]{1,100}$/)
      if (inputs) out.inputs = inputs
      // Response path (`data.name`, `[0].email`, `items[0].id`; '' = the whole response) → a field key or `var.<name>`.
      if (isPlainObject(raw.results)) {
        const clean: Record<string, string> = {}
        for (const [rawPath, key] of Object.entries(raw.results).slice(0, FIELD_BUTTON_LIMITS.inputs)) {
          const path = normalizeResultPath(rawPath)
          if (typeof key === 'string' && isResultPath(path) && (KEY_RE.test(key) || VAR_TARGET_RE.test(key))) clean[path] = key
        }
        if (Object.keys(clean).length) out.results = clean
      }
      // When the call fails: show a message (default; optionally the author's text) or leave the fields as they are and go on.
      if (raw.on_error === 'ignore') out.on_error = 'ignore'
      const errorText = raw.on_error === 'ignore' ? undefined : str(raw.error_text, FIELD_BUTTON_LIMITS.text)
      if (errorText) out.error_text = errorText.replace(/[<>]/g, '')
      break
    }
    case 'set_variable': {
      if (typeof raw.variable === 'string' && VAR_NAME_RE.test(raw.variable)) out.variable = raw.variable
      out.variable_mode = raw.variable_mode === 'clear' || raw.variable_mode === 'reset' ? raw.variable_mode : 'set'
      if (out.variable_mode === 'set') out.value = raw.value === null || raw.value === undefined ? '' : String(raw.value).slice(0, FIELD_BUTTON_LIMITS.template)
      break
    }
    case 'start_workflow': {
      if (typeof raw.workflow_id === 'string' && UUID_RE.test(raw.workflow_id)) out.workflow_id = raw.workflow_id
      const name = str(raw.workflow_name, 200)
      if (name) out.workflow_name = name
      const inputs = templateMap(raw.inputs, /^[A-Za-z_][A-Za-z0-9_]{0,99}$/)
      if (inputs) out.inputs = inputs
      break
    }
    default:
      break
  }
  if (raw.allow_anonymous === true && SERVER_RULE_ACTIONS.has(type)) out.allow_anonymous = true
  return out
}

/** Stored `button` config → clean config (disabled_when is cleaned by the field schema). */
export function normalizeFieldButton(raw: unknown): FieldButtonConfig {
  const r = isPlainObject(raw) ? raw : {}
  const out: FieldButtonConfig = {
    style: FIELD_BUTTON_STYLES.includes(r.style as FieldButtonStyle) ? r.style as FieldButtonStyle : 'secondary',
    actions: Array.isArray(r.actions) ? r.actions.map((a) => normalizeAction(a)).filter((a): a is FieldButtonAction => Boolean(a)).slice(0, FIELD_BUTTON_LIMITS.actions) : [],
  }
  if (r.size === 'sm' || r.size === 'lg') out.size = r.size
  if (FIELD_BUTTON_ICONS.includes(r.icon as FieldButtonIcon)) out.icon = r.icon as FieldButtonIcon
  if (out.icon && r.icon_after === true) out.icon_after = true
  if (r.full_width === true) out.full_width = true
  if (r.align === 'center' || r.align === 'right') out.align = r.align
  const tooltip = str(r.tooltip, FIELD_BUTTON_LIMITS.tooltip)
  if (tooltip) out.tooltip = tooltip
  const confirm = str(r.confirm, FIELD_BUTTON_LIMITS.text)
  if (confirm) out.confirm = confirm
  return out
}

/** A new button's config (the palette's "Button"): toggles a section once targets are chosen. */
export function defaultFieldButton(): FieldButtonConfig {
  return { style: 'secondary', actions: [] }
}

/** A short summary of what a button does ("Toggle 2 elements, then Next step"). */
export function describeFieldButton(config: FieldButtonConfig | undefined): string {
  const actions = config?.actions ?? []
  if (!actions.length) return 'Does nothing yet'
  return actions.map((a) => {
    if (a.type === 'show_hide') return `${a.mode === 'show' ? 'Show' : a.mode === 'hide' ? 'Hide' : 'Toggle'} ${a.targets?.length ?? 0} element${a.targets?.length === 1 ? '' : 's'}`
    if (a.type === 'set_state') return `${a.state_value === 'toggle' ? 'Toggle' : 'Set'} state.${a.flag || '?'}${a.state_value === 'toggle' ? '' : ` = ${a.state_value}`}`
    if (a.type === 'prompt') return `Ask “${a.title || a.text || ''}”`
    return FIELD_BUTTON_ACTION_LABELS[a.type]
  }).join(', then ')
}

/** The actions and, after each question, its responses' actions (one level) — for checks that must see every step. */
export function allActions(actions: FieldButtonAction[] | undefined): FieldButtonAction[] {
  const out: FieldButtonAction[] = []
  for (const a of actions ?? []) {
    out.push(a)
    if (a.type === 'prompt') for (const b of a.prompt?.buttons ?? []) out.push(...(b.then ?? []))
  }
  return out
}

/** A server step's address inside a list: a top-level index, or a response's step of the question at `index`. */
export interface ActionBranch { response: string; index: number }

/** The action at an address (top level, or a question's response step), or null. */
export function actionAt(actions: FieldButtonAction[] | undefined, index: number, branch?: ActionBranch | null): FieldButtonAction | null {
  const top = actions?.[index]
  if (!top) return null
  if (!branch) return top
  if (top.type !== 'prompt' || !top.prompt) return null
  return promptButton(top.prompt, branch.response)?.then?.[branch.index] ?? null
}

/** Does the button toggle something (aria-expanded)? Targets of its first show / hide toggle, else null. */
export function toggleTargets(config: FieldButtonConfig | undefined): string[] | null {
  const action = config?.actions.find((a) => a.type === 'show_hide' && a.mode === 'toggle' && a.targets?.length)
  return action?.targets ?? null
}

/** Flags its set_state toggles (aria-pressed / expanded for a flag toggle). */
export function toggledFlag(config: FieldButtonConfig | undefined): string | null {
  const action = config?.actions.find((a) => a.type === 'set_state' && a.state_value === 'toggle' && a.flag)
  return action?.flag ?? null
}

/**
 * Designer problems of a button (null = fine). `known`: the form's field
 * keys (value fields for set / clear), page ids, state flags and the bar's
 * button ids (submit / draft).
 */
export function fieldButtonProblem(config: FieldButtonConfig | undefined, known: {
  fieldKeys: ReadonlySet<string>
  valueKeys: ReadonlySet<string>
  headingKeys?: ReadonlySet<string>
  /** Declared sections (layout.sections). */
  sectionKeys?: ReadonlySet<string>
  pageIds: ReadonlySet<string>
  flags: ReadonlySet<string>
  barButtons?: Array<{ id: string; kind: string }> | null
  paged: boolean
  policy?: RedirectPolicy
  /** Editable Data table field keys (Apply table changes). */
  editableTables?: ReadonlySet<string>
}): string | null {
  if (!config) return 'The button is not configured'
  if (!config.actions.length) return 'Add at least one action (On click)'
  for (const a of allActions(config.actions)) {
    switch (a.type) {
      case 'prompt':
        if (!a.text && !a.title) return 'Ask a question: write the question'
        break
      case 'show_hide': {
        if (!a.targets?.length) return 'Show / hide: choose what it shows or hides'
        for (const target of a.targets) {
          const t = parseTarget(target)!
          if (t.kind === 'section' && known.sectionKeys?.has(t.id)) continue
          if (t.kind === 'page' ? !known.pageIds.has(t.id) : !known.fieldKeys.has(t.id)) return `Show / hide: "${t.id}" is not on this form`
          if (t.kind === 'section' && known.headingKeys && !known.headingKeys.has(t.id)) return `Show / hide: a section starts at a Section heading ("${t.id}" is not one)`
        }
        break
      }
      case 'set_state':
        if (!a.flag) return 'Set a state flag: name the flag'
        if (!known.flags.has(a.flag)) return `The state flag "${a.flag}" is not declared (Buttons & header → Form state)`
        break
      case 'go_to_page':
        if (!known.paged) return 'Go to step / tab needs a form with steps or tabs'
        if (!a.page || !known.pageIds.has(a.page)) return 'Go to: choose the step / tab'
        break
      case 'next_page':
      case 'previous_page':
        if (!known.paged) return `${FIELD_BUTTON_ACTION_LABELS[a.type]} needs a form with steps`
        break
      case 'set_values': {
        const keys = Object.keys(a.assign ?? {})
        if (!keys.length) return 'Set field values: choose a field'
        const unknown = keys.find((k) => !known.valueKeys.has(k))
        if (unknown) return `Set field values: "${unknown}" is not an input on this form`
        break
      }
      case 'clear_values': {
        if (!a.fields?.length) return 'Clear fields: choose the fields'
        const unknown = a.fields.find((k) => !known.valueKeys.has(k))
        if (unknown) return `Clear fields: "${unknown}" is not an input on this form`
        break
      }
      case 'submit':
        if (known.barButtons && a.button && !known.barButtons.some((b) => b.id === a.button && (b.kind === 'submit' || b.kind === 'outcome'))) return `Submit: "${a.button}" is not a submitting button of this form`
        break
      case 'open_link':
        if (!safeRedirectUrl(a.url, known.policy)) return 'Open link: an app page (/…) or an allowed address'
        break
      case 'apply_table_changes': {
        const problem = tableChangesProblem(a.table_changes, known.editableTables ?? new Set())
        if (problem) return problem
        break
      }
      default:
        break
    }
  }
  return null
}

/* ── Running a click ────────────────────────────────────────────────── */


/** What runFieldButton drives (the renderer's adapter to the surface, pager and state). */
export interface FieldButtonHost {
  /** Current values (state included under FORM_STATE_KEY). */
  values(): Record<string, unknown>
  state(): FormUiState
  setValues(patch: Record<string, unknown>): void
  setState(next: FormUiState): void
  /** Let React apply the changes so far (surfaces read their own state). */
  flush(): Promise<void>
  goTo(pageId: string): boolean
  next(): boolean
  back(): boolean
  /** Show errors and return true when valid. */
  validate(scope: 'page' | 'form'): boolean
  /** Press a bar button (false: not available on this surface). */
  submit(buttonId?: string): boolean
  saveDraft(): boolean
  print(): void
  openLink(url: string, newTab: boolean): Promise<boolean> | boolean
  /** Show a message; `display` set = the banner / inline options of "Show a message" (absent: the original inline message). */
  message(text: string, tone: MessageTone, display?: MessageDisplay): void
  /** Ask a question; resolves with the response value (DISMISSED_RESPONSE when closed). Absent: not available here. */
  ask?(request: PromptRequest): Promise<string>
  /** A question was answered ("Message answered" rules). */
  answered?(answer: { id?: string; response: string; label: string }): void
  /**
   * Run the button's `index`-th action (Apply table changes) on the server;
   * resolves with the summary text, or rejects with an error message.
   * Absent: not available on this surface.
   */
  applyTableChanges?(index: number, action: FieldButtonAction, branch?: ActionBranch): Promise<{ text: string; failed: number }>
  /** Form rules: show an error on a field (Validate → "Show an error on a field"). */
  fieldError?(field: string, text: string): void
  /**
   * Form rules: the actions that need the surface or the server — refresh,
   * run a lookup, call an API reference, start a workflow. Resolves with
   * values to set (declared fields only) and an optional message.
   */
  runExtra?(index: number, action: FieldButtonAction, values: Record<string, unknown>, branch?: ActionBranch): Promise<{ values?: Record<string, unknown>; message?: { text: string; tone: 'success' | 'info' }; stop?: string } | void>
  /** Editable value fields (set / clear only touch these; a rule's host adds read-only value fields — the server bounds them). */
  editableKeys: ReadonlySet<string>
  /** Empty value per field key (clear). */
  blank(key: string): unknown
}

/** How a "Show a message" shows (lib/forms/form-messages.ts). */
export interface MessageDisplay {
  style: MessageStyle
  title?: string
  duration: MessageDuration
  seconds?: number
}

/** A question for the host to ask. */
export interface PromptRequest {
  id?: string
  text: string
  title?: string
  tone: MessageTone
  display: PromptDisplay
  buttons: Array<{ value: string; label: string; style?: PromptButtonStyle }>
  /** The response Escape / closing gives. */
  escape: string
}

/** A message action's display options (undefined: a message saved before banners — the original inline look). */
export function messageDisplay(action: FieldButtonAction, title?: string): MessageDisplay | undefined {
  if (!action.style) return undefined
  return { style: action.style, ...(title ? { title } : {}), duration: action.duration ?? 'dismiss', ...(action.duration === 'auto' ? { seconds: action.seconds ?? 6 } : {}) }
}

export interface FieldButtonRun {
  /** Actions that ran, in order. */
  ran: FieldButtonActionType[]
  /** Why it stopped early (validation errors, a submit / link that is not available, a rule's block). */
  stopped?: string
  /** block_submit / field_error: the messages (a before-submit rule blocks the submission with them). */
  blocked?: Array<{ field?: string; text: string }>
  /** Questions answered, in order. */
  answers?: Array<{ id?: string; response: string }>
}

export interface RunOptions {
  /** Extra template scope: {{event.row.name}}, {{user.email}}… (form rules). */
  extras?: Record<string, unknown>
  /** Resolve a set / copy template (default: placeholders only); rules pass one that also evaluates {{=…}} expressions. */
  resolve?: (template: string, values: Record<string, unknown>, extras: Record<string, unknown>) => unknown | Promise<unknown>
}

const NEEDS_FLUSH: ReadonlySet<FieldButtonActionType> = new Set(['prompt', 'go_to_page', 'next_page', 'previous_page', 'validate', 'submit', 'save_draft', 'print', 'apply_table_changes', 'run_lookup', 'call_reference', 'start_workflow', 'refresh'])

/**
 * Run a button's (or a form rule's) actions in order against `host`. A
 * question ("Ask a question") waits for the answer, runs that response's
 * actions, then goes on with the rest only when the response continues
 * (OK / Yes by default) — otherwise the run stops with `prompt_stopped`.
 */
export async function runFieldButton(config: Pick<FieldButtonConfig, 'actions'> & Partial<FieldButtonConfig>, host: FieldButtonHost, options: RunOptions = {}): Promise<FieldButtonRun> {
  const run: FieldButtonRun = { ran: [] }
  const extras = options.extras ?? {}
  const resolve = options.resolve ?? ((template: string, values: Record<string, unknown>) => resolveInputTemplate(template, { values, extras }))
  let state = host.state()
  let values = host.values()
  let pending = false

  /** Run a list; true = the run ended (stopped, or a submit took over). `at`: the question a response's list belongs to. */
  async function runList(actions: FieldButtonAction[], at: { index: number; response: string } | null): Promise<boolean> {
    for (const [i, action] of actions.entries()) {
      const index = at ? at.index : i
      const branch: ActionBranch | undefined = at ? { response: at.response, index: i } : undefined
      if (pending && NEEDS_FLUSH.has(action.type)) { await host.flush(); pending = false }
      const stop = (reason: string) => { run.ran.push(action.type); run.stopped = reason; return true }
      switch (action.type) {
        case 'show_hide':
          state = applyVisibility(state, action.mode === 'show' || action.mode === 'hide' ? action.mode : 'toggle', action.targets ?? [])
          host.setState(state)
          pending = true
          break
        case 'enable_disable':
          state = applyEnabled(state, action.mode === 'enable' || action.mode === 'disable' ? action.mode : 'toggle', action.targets ?? [])
          host.setState(state)
          pending = true
          break
        case 'read_only':
          state = applyReadOnly(state, action.mode === 'read_only' || action.mode === 'editable' ? action.mode : 'toggle', action.targets ?? [])
          host.setState(state)
          pending = true
          break
        case 'collapse_expand':
          state = applyCollapsed(state, action.mode === 'collapse' || action.mode === 'expand' ? action.mode : 'toggle', action.targets ?? [])
          host.setState(state)
          pending = true
          break
        case 'load_part':
          state = applyLoaded(state, action.targets ?? [])
          host.setState(state)
          pending = true
          break
        case 'set_state':
          if (action.flag) {
            state = applyFlag(state, action.flag, action.state_value === 'toggle' ? 'toggle' : action.state_value === 'true')
            host.setState(state)
            pending = true
          }
          break
        case 'set_values':
        case 'copy_values': {
          const patch: Record<string, unknown> = {}
          for (const [key, template] of Object.entries(action.assign ?? {})) {
            if (!host.editableKeys.has(key)) continue
            patch[key] = await resolve(template, values, extras)
          }
          if (Object.keys(patch).length) {
            values = { ...values, ...patch }
            host.setValues(patch)
            pending = true
          }
          break
        }
        case 'clear_values': {
          const patch: Record<string, unknown> = {}
          for (const key of action.fields ?? []) if (host.editableKeys.has(key)) patch[key] = host.blank(key)
          if (Object.keys(patch).length) {
            values = { ...values, ...patch }
            host.setValues(patch)
            pending = true
          }
          break
        }
        case 'set_variable': {
          // Form variables live in the values under FORM_VARS_KEY (lib/forms/form-params.ts): what rules set over the initial values.
          if (!action.variable) break
          const vars = setVariables(values)
          if (action.variable_mode === 'reset') delete vars[action.variable]
          else vars[action.variable] = action.variable_mode === 'clear' ? null : await resolve(action.value ?? '', values, extras)
          values = { ...values, [FORM_VARS_KEY]: vars }
          host.setValues({ [FORM_VARS_KEY]: vars })
          pending = true
          break
        }
        case 'go_to_page':
          if (action.page) host.goTo(action.page)
          break
        case 'next_page':
          if (!host.next()) return stop('step_invalid')
          break
        case 'previous_page':
          host.back()
          break
        case 'validate':
          if (!host.validate(action.scope ?? 'form')) return stop('invalid')
          break
        case 'field_error':
        case 'block_submit': {
          const text = interpolateButtonText(action.text, { values, extras })
          if (action.type === 'field_error' && action.field) host.fieldError?.(action.field, text)
          else if (action.field && host.fieldError) host.fieldError(action.field, text)
          else host.message(text, 'info')
          run.blocked = [...(run.blocked ?? []), { ...(action.field ? { field: action.field } : {}), text }]
          return stop('blocked')
        }
        case 'submit':
          run.ran.push(action.type)
          if (!host.submit(action.button)) run.stopped = 'submit_unavailable'
          // The bar button's pipeline owns what happens next.
          return true
        case 'save_draft':
          if (!host.saveDraft()) return stop('draft_unavailable')
          break
        case 'print':
          host.print()
          break
        case 'open_link':
          if (!action.url || !(await host.openLink(action.url, action.new_tab === true))) return stop('link_not_allowed')
          break
        case 'message': {
          const title = action.title ? interpolateButtonText(action.title, { values, extras }) : undefined
          const text = interpolateButtonText(action.text, { values, extras })
          const display = messageDisplay(action, title)
          if (display) host.message(text, action.tone ?? 'info', display)
          else host.message(text, action.tone === 'success' ? 'success' : 'info')
          break
        }
        case 'prompt': {
          const prompt = action.prompt
          if (at || !prompt) break
          if (!host.ask) return stop('prompt_unavailable')
          const response = await host.ask({
            ...(prompt.id ? { id: prompt.id } : {}),
            text: interpolateButtonText(action.text, { values, extras }),
            ...(action.title ? { title: interpolateButtonText(action.title, { values, extras }) } : {}),
            tone: action.tone ?? 'info',
            display: prompt.display,
            buttons: prompt.buttons.map((b) => ({ value: b.value, label: b.label, ...(b.style ? { style: b.style } : {}) })),
            escape: escapeResponse(prompt),
          })
          const button = promptButton(prompt, response)
          run.answers = [...(run.answers ?? []), { ...(prompt.id ? { id: prompt.id } : {}), response }]
          run.ran.push(action.type)
          host.answered?.({ ...(prompt.id ? { id: prompt.id } : {}), response, label: button?.label ?? (response === DISMISSED_RESPONSE ? 'Closed' : response) })
          // The person may have changed things while the question was open.
          state = host.state()
          values = host.values()
          if (button?.then?.length && await runList(button.then, { index, response })) return true
          if (!button?.continue) { run.stopped = 'prompt_stopped'; return true }
          continue
        }
        case 'apply_table_changes': {
          if (!host.applyTableChanges) return stop('table_changes_unavailable')
          try {
            const result = await host.applyTableChanges(index, action, branch)
            if (action.table_changes?.show_summary !== false) host.message(result.text, result.failed ? 'info' : 'success')
            values = host.values()
            if (result.failed && action.table_changes?.on_error !== 'continue') return stop('table_changes_failed')
          } catch (error) {
            host.message(error instanceof Error ? error.message : 'The table changes could not be applied', 'info')
            return stop('table_changes_failed')
          }
          break
        }
        case 'refresh':
        case 'run_lookup':
        case 'call_reference':
        case 'start_workflow': {
          if (!host.runExtra) return stop(`${action.type}_unavailable`)
          try {
            const result = await host.runExtra(index, action, values, branch)
            if (result?.values && Object.keys(result.values).length) {
              values = { ...values, ...result.values }
              host.setValues(result.values)
              pending = true
            }
            if (result?.message) host.message(result.message.text, result.message.tone)
            if (result?.stop) return stop(result.stop)
          } catch (error) {
            host.message(error instanceof Error ? error.message : 'That step could not run', 'info')
            return stop(`${action.type}_failed`)
          }
          break
        }
      }
      run.ran.push(action.type)
    }
    return false
  }

  await runList(config.actions, null)
  return run
}
