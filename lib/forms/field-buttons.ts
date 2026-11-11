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
import {
  LIST_EDIT_KEY, LIST_SELECT_KEY, coerceListRow, isBlankListRow, listColumnWritable, listEditingRow, listLabelKey, listRowErrors, listSelection, rawListRows, remapAfterRemoval,
  withListEditing, withListSelected, type ListFieldConfig,
} from './list-field'
import { lookupLabelKey } from './lookup'
import {
  DATA_ACTION_LIMITS, TABLE_ACTION_TYPES, clampLimit, normalizeActionFilter, normalizeActionSort, normalizeOutputs,
  type ActionOutput, type TableActionType,
} from './data-actions'
import type { DataTableConditionGroup, DataTableFieldConfig, DataTableSort } from './data-table'
import {
  ROW_CURRENT_KEY, columnDefaults, currentRowRef, commitRow, deleteRows, discardRow, dropFromChangeSet, isRowsField, newRow, pendingCount, resolveRowTargets,
  afterListRemoval, setRowValues, tableSaveChange, targetNumber, targetRef, targetValues, withCurrentRow, type RowTarget, type RowsField,
} from './row-rules'

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
  | 'add_list_row' | 'remove_list_row' | 'clear_list' | 'update_list_row' | 'edit_list_row' | 'cancel_list_edit'
  | TableActionType
  | RowActionType

/** Editable table rules (lib/forms/row-rules.ts): on a List or an editable Data table. */
export type RowActionType = 'new_row' | 'set_row_values' | 'commit_row' | 'discard_row' | 'revert_row' | 'delete_row' | 'refresh_table'
export const ROW_ACTION_TYPES: RowActionType[] = ['new_row', 'set_row_values', 'commit_row', 'discard_row', 'revert_row', 'delete_row', 'refresh_table']

export const RULE_ONLY_ACTION_TYPES: RuleOnlyActionType[] = ['enable_disable', 'field_error', 'block_submit', 'copy_values', 'refresh', 'run_lookup', 'call_reference', 'start_workflow']
// Form variables (lib/forms/form-params.ts).
RULE_ONLY_ACTION_TYPES.push('set_variable')
// Sections (lib/forms/sections.ts).
RULE_ONLY_ACTION_TYPES.push('collapse_expand')
// When to load (lib/forms/lazy-load.ts).
RULE_ONLY_ACTION_TYPES.push('load_part')
// Read only (lib/forms/form-state.ts applyReadOnly): controls, sections, steps / tabs or the whole form.
RULE_ONLY_ACTION_TYPES.push('read_only')
// List fields (lib/forms/list-field.ts): rows added from the form's inputs, removed, cleared.
RULE_ONLY_ACTION_TYPES.push('add_list_row', 'remove_list_row', 'clear_list', 'update_list_row', 'edit_list_row', 'cancel_list_edit')
// Data table actions (lib/forms/data-actions.ts): read, list, create, update, delete — on the server.
RULE_ONLY_ACTION_TYPES.push(...TABLE_ACTION_TYPES)
// Editable table rules (lib/forms/row-rules.ts): new / fill / commit / discard / revert / delete rows, refresh a table.
RULE_ONLY_ACTION_TYPES.push(...ROW_ACTION_TYPES)
/** Rule actions that run on the server (targets from the saved form). */
export const SERVER_RULE_ACTIONS: ReadonlySet<FieldButtonActionType> = new Set(['call_reference', 'start_workflow', 'apply_table_changes', ...TABLE_ACTION_TYPES])
/** Whether a step runs on the server: the server actions, and a Data table row's "Save now" commit / delete. */
export function isServerRuleAction(action: Pick<FieldButtonAction, 'type' | 'commit_mode'>): boolean {
  return SERVER_RULE_ACTIONS.has(action.type) || ((action.type === 'commit_row' || action.type === 'delete_row') && action.commit_mode === 'save_now')
}
/** Steps with on-success / on-failure steps of their own (server steps, and Commit / Delete row). */
export const BRANCHING_ACTIONS: ReadonlySet<FieldButtonActionType> = new Set(['call_reference', ...TABLE_ACTION_TYPES, 'commit_row', 'delete_row'])
/** The branch names a server step's own steps are addressed by (ActionBranch.response). */
export const SUCCESS_BRANCH = '__success'
export const FAILURE_BRANCH = '__failure'

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
  add_list_row: 'Add row to list',
  remove_list_row: 'Remove row from list',
  clear_list: 'Clear list',
  update_list_row: 'Update a row of a list',
  edit_list_row: 'Edit a row (load it into the inputs)',
  cancel_list_edit: 'Cancel editing a row',
  table_read: 'Read a table row',
  table_list: 'List table rows',
  table_create: 'Create a table row',
  table_update: 'Update table rows',
  table_delete: 'Delete a table row',
  new_row: 'New row (List / Data table)',
  set_row_values: 'Set row values',
  commit_row: 'Commit row',
  discard_row: 'Discard a pending row',
  revert_row: 'Revert a row',
  delete_row: 'Delete row(s)',
  refresh_table: 'Refresh a table (keep pending rows)',
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
  /** add_list_row / remove_list_row / clear_list: the List field. */
  list_field?: string
  /** add_list_row: list column key → literal or {{template}} (usually {{form.<input>}}). */
  values?: Record<string, string>
  /** add_list_row: inputs cleared after the row is added (absent: the fields the values read). */
  clear_fields?: string[]
  /** add_list_row: inputs that must be filled (errors show on them and no row is added). */
  require?: string[]
  /** remove_list_row / update_list_row: which row — "last" (default), "first", or a 1-based number / {{template}} (e.g. {{event.row_number}}). */
  row?: string
  /** table_*: the data table (remapped on import like every table id). */
  table_id?: string
  table_name?: string
  /** table_read / table_update / table_delete: the row's id (template; {{row.row_id}}, {{event.row.row_id}}, a field). */
  row_id?: string
  /** table_read / table_list / table_update: AND / OR conditions (values are templates); call_reference: a filter on the rows at rows_path. */
  filter?: DataTableConditionGroup
  /** table_list (and call_reference's rows): sort, offset and limit. */
  sort?: DataTableSort[]
  limit?: number
  offset?: number
  /** table_create / table_update: column → template. */
  column_values?: Record<string, string>
  /** table_*: people who fill in the form may read / write through this step without data permissions (the author allows it). */
  open_access?: boolean
  /** table_delete / remove_list_row / clear_list: ask before deleting (the question's text; {{count}} = rows). */
  confirm_text?: string
  /** List actions aimed at the selection (row "selected"): the message when nothing is selected. */
  empty_text?: string
  /** table_*: run once per selected row of this List ({{row.<column>}} = that row). */
  each_selected?: string
  /** call_reference: false = fire and forget (queued; the form doesn't wait). Default true. */
  wait?: boolean
  /** call_reference: give up after this many milliseconds (1–30 s; default 10 s). */
  timeout_ms?: number
  /** call_reference: the array in the response the filter / sort / limit apply to ('' = the response itself). */
  rows_path?: string
  /** table_* / call_reference: what the result writes — fields, Labels, Lists, options, variables (lib/forms/data-actions.ts). */
  outputs?: ActionOutput[]
  /** table_* / call_reference: steps after it worked ({{result.*}}) / after it failed ({{error.message}}). One level. */
  on_success?: FieldButtonAction[]
  on_failure?: FieldButtonAction[]
  /** Server steps (call_reference, start_workflow, apply_table_changes): also run for anonymous visitors of a public form link. Off by default. */
  allow_anonymous?: boolean
  /** new_row: where the row goes (default end). */
  position?: 'end' | 'start' | 'after_selected'
  /** new_row: the column whose cell gets the focus. */
  focus_column?: string
  /** set_row_values / commit_row / discard_row / revert_row / delete_row: a row by key (a Data table's key column / a List's key column; template). */
  row_key?: string
  /** commit_row / delete_row on a Data table: stage in the change set (default) or save to the table now. */
  commit_mode?: 'stage' | 'save_now'
  /** refresh_table: pending rows are kept (default) or the person is asked whether to drop them. */
  keep_pending?: 'keep' | 'ask'
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
  /** Enabled only when a row of this List is selected ({{form.<list>_selected_count}} > 0). */
  requires_selection?: string
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
      // Fire and forget (queued); a timeout; a local filter / sort / limit on the rows at rows_path.
      if (raw.wait === false) out.wait = false
      if (raw.timeout_ms !== undefined && raw.timeout_ms !== null && raw.timeout_ms !== '') {
        const ms = Math.floor(Number(raw.timeout_ms))
        if (Number.isFinite(ms)) out.timeout_ms = Math.min(DATA_ACTION_LIMITS.timeoutMaxMs, Math.max(DATA_ACTION_LIMITS.timeoutMinMs, ms))
      }
      if (typeof raw.rows_path === 'string' && isResultPath(normalizeResultPath(raw.rows_path))) out.rows_path = normalizeResultPath(raw.rows_path)
      { const filter = normalizeActionFilter(raw.filter); if (filter) out.filter = filter }
      { const sort = normalizeActionSort(raw.sort); if (sort) out.sort = sort }
      if (raw.limit !== undefined && raw.limit !== null && raw.limit !== '') out.limit = clampLimit(raw.limit, DATA_ACTION_LIMITS.listRows, 1000)
      break
    }
    case 'add_list_row':
    case 'remove_list_row':
    case 'update_list_row':
    case 'edit_list_row':
    case 'cancel_list_edit':
    case 'clear_list': {
      if (typeof raw.list_field === 'string' && KEY_RE.test(raw.list_field)) out.list_field = raw.list_field
      if (type === 'update_list_row') {
        out.values = templateMap(raw.values, KEY_RE) ?? {}
        out.row = str(raw.row, FIELD_BUTTON_LIMITS.template) ?? 'last'
      }
      if (type === 'edit_list_row') {
        // Input field → template over the row ({{row.<column>}}).
        out.assign = templateMap(raw.assign, KEY_RE) ?? {}
        out.row = str(raw.row, FIELD_BUTTON_LIMITS.template) ?? '{{event.row_number}}'
      }
      if (type === 'cancel_list_edit') {
        out.fields = Array.isArray(raw.fields) ? [...new Set(raw.fields.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))].slice(0, FIELD_BUTTON_LIMITS.assign) : []
      }
      if (type === 'add_list_row') {
        out.values = templateMap(raw.values, KEY_RE) ?? {}
        const keys = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === 'string' && KEY_RE.test(k)))].slice(0, FIELD_BUTTON_LIMITS.assign) : undefined)
        const clear = keys(raw.clear_fields)
        if (clear) out.clear_fields = clear
        const require = keys(raw.require)
        if (require?.length) out.require = require
      }
      if (type === 'remove_list_row') out.row = str(raw.row, FIELD_BUTTON_LIMITS.template) ?? 'last'
      // A question before deleting / clearing ({{count}} = the rows it removes); the message when nothing is selected.
      if (type === 'remove_list_row' || type === 'clear_list') { const confirm = str(raw.confirm_text, FIELD_BUTTON_LIMITS.text); if (confirm) out.confirm_text = confirm }
      if (type !== 'add_list_row' && type !== 'clear_list' && type !== 'cancel_list_edit') { const empty = str(raw.empty_text, FIELD_BUTTON_LIMITS.text); if (empty) out.empty_text = empty }
      break
    }
    case 'table_read':
    case 'table_list':
    case 'table_create':
    case 'table_update':
    case 'table_delete': {
      if (typeof raw.table_id === 'string' && UUID_RE.test(raw.table_id)) out.table_id = raw.table_id
      const name = str(raw.table_name, 200)
      if (name) out.table_name = name
      if (type !== 'table_create' && type !== 'table_list') { const rowId = str(raw.row_id, FIELD_BUTTON_LIMITS.template); if (rowId) out.row_id = rowId }
      if (type === 'table_read' || type === 'table_list' || type === 'table_update') { const filter = normalizeActionFilter(raw.filter); if (filter) out.filter = filter }
      if (type === 'table_list' || type === 'table_read') { const sort = normalizeActionSort(raw.sort); if (sort) out.sort = sort }
      if (type === 'table_list') {
        out.limit = clampLimit(raw.limit, 50, DATA_ACTION_LIMITS.listRows)
        const offset = Math.floor(Number(raw.offset))
        if (Number.isFinite(offset) && offset > 0) out.offset = Math.min(offset, 10_000)
      }
      if (type === 'table_create' || type === 'table_update') out.column_values = templateMap(raw.column_values, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/) ?? {}
      if (type === 'table_delete') { const confirm = str(raw.confirm_text, FIELD_BUTTON_LIMITS.text); if (confirm) out.confirm_text = confirm }
      if (typeof raw.each_selected === 'string' && KEY_RE.test(raw.each_selected)) out.each_selected = raw.each_selected
      { const empty = str(raw.empty_text, FIELD_BUTTON_LIMITS.text); if (empty && out.each_selected) out.empty_text = empty }
      if (raw.open_access === true) out.open_access = true
      break
    }
    case 'new_row':
    case 'set_row_values':
    case 'commit_row':
    case 'discard_row':
    case 'revert_row':
    case 'delete_row':
    case 'refresh_table': {
      if (typeof raw.field === 'string' && KEY_RE.test(raw.field)) out.field = raw.field
      if (type === 'new_row') {
        out.position = raw.position === 'start' || raw.position === 'after_selected' ? raw.position : 'end'
        if (typeof raw.focus_column === 'string' && KEY_RE.test(raw.focus_column)) out.focus_column = raw.focus_column
        const values = templateMap(raw.values, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
        if (values && Object.keys(values).length) out.values = values
      }
      if (type === 'set_row_values') out.values = templateMap(raw.values, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/) ?? {}
      if (type !== 'new_row' && type !== 'refresh_table') {
        out.row = str(raw.row, FIELD_BUTTON_LIMITS.template) ?? (type === 'delete_row' ? 'selected' : 'current')
        const key = str(raw.row_key, FIELD_BUTTON_LIMITS.template)
        if (key) out.row_key = key
        const empty = str(raw.empty_text, FIELD_BUTTON_LIMITS.text)
        if (empty) out.empty_text = empty
      }
      if (type === 'commit_row' || type === 'delete_row') {
        if (raw.commit_mode === 'save_now') out.commit_mode = 'save_now'
        if (raw.open_access === true && out.commit_mode === 'save_now') out.open_access = true
      }
      if (type === 'delete_row') { const confirm = str(raw.confirm_text, FIELD_BUTTON_LIMITS.text); if (confirm) out.confirm_text = confirm }
      if (type === 'refresh_table' && raw.keep_pending === 'ask') out.keep_pending = 'ask'
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
  if (raw.allow_anonymous === true && isServerRuleAction(out)) out.allow_anonymous = true
  if (rule && BRANCHING_ACTIONS.has(type)) {
    const outputs = normalizeOutputs(raw.outputs)
    if (outputs) out.outputs = outputs
    // One level: a branch's steps have no branches (or questions) of their own.
    const branch = (list: unknown) => (Array.isArray(list)
      ? list.slice(0, FIELD_BUTTON_LIMITS.actions).map((a) => normalizeAction(isPlainObject(a) ? { ...a, on_success: undefined, on_failure: undefined } : a, true)).filter((a): a is FieldButtonAction => Boolean(a) && a!.type !== 'prompt')
      : [])
    const ok = branch(raw.on_success)
    const failed = branch(raw.on_failure)
    if (ok.length) out.on_success = ok
    if (failed.length) out.on_failure = failed
  }
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
  if (typeof r.requires_selection === 'string' && KEY_RE.test(r.requires_selection)) out.requires_selection = r.requires_selection
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
    out.push(...(a.on_success ?? []), ...(a.on_failure ?? []))
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
  // A server step's own on-success / on-failure steps.
  if (branch.response === SUCCESS_BRANCH) return top.on_success?.[branch.index] ?? null
  if (branch.response === FAILURE_BRANCH) return top.on_failure?.[branch.index] ?? null
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
  runExtra?(index: number, action: FieldButtonAction, values: Record<string, unknown>, branch?: ActionBranch, event?: Record<string, unknown>): Promise<{ values?: Record<string, unknown>; message?: { text: string; tone: 'success' | 'info' }; stop?: string; result?: unknown; kept?: boolean } | void>
  /** Editable value fields (set / clear only touch these; a rule's host adds read-only value fields — the server bounds them). */
  editableKeys: ReadonlySet<string>
  /** Empty value per field key (clear). */
  blank(key: string): unknown
  /** The value a field goes back to after "Add row" / "Cancel editing": its default (templates resolved), else blank. */
  reset?(key: string): unknown
  /** A field's definition (label, type, a List's columns) — the List actions validate rows with it. */
  field?(key: string): { key: string; label: string; type: string; list?: ListFieldConfig; data_table?: DataTableFieldConfig; required?: boolean } | undefined
  /** Form rules: an event the steps caused (row_created, row_values_changed, row_committed, row_commit_failed) — its rules run next. */
  emit?(type: string, target: string, context: Record<string, unknown>): void
  /** An editable Data table's rows on screen (key + values): row rules find rows by number / key here. */
  tableRows?(field: string): Array<{ key: string; values: Record<string, unknown> }>
}

const RULE_ROW_LABEL = 'this row step'

/** {{today}} / {{now}} in a column's default (New row), beside the rule's own scope. */
function withDates(extras: Record<string, unknown>): Record<string, unknown> {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return { today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`, now: now.toISOString(), ...extras }
}

/** A note for the form's author in the browser console (development builds only): what a step left alone and why. */
export function devNote(text: string): void {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'production') return
  if (typeof console !== 'undefined') console.info(`[form rules] ${text}`)
}

const SOURCE_RE = /^\{\{\s*(?:form\.)?([a-z0-9_]{1,64})\s*\}\}$/

/** The input a list column's template reads directly ({{qty}} / {{form.qty}}), or null. */
export function listSourceField(template: string | undefined): string | null {
  const m = SOURCE_RE.exec(String(template ?? '').trim())
  return m ? m[1] : null
}

/** The inputs an Add row action clears afterwards: its own list, else the fields its values read directly. */
export function listClearFields(action: Pick<FieldButtonAction, 'values' | 'clear_fields'>): string[] {
  if (action.clear_fields) return action.clear_fields
  return [...new Set(Object.values(action.values ?? {}).map(listSourceField).filter((k): k is string => Boolean(k)))]
}

function blankValue(v: unknown): boolean {
  return v === undefined || v === null || v === false || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length)
}

/** remove_list_row: the 0-based row a "row" setting names (null: none). */
export function listRowIndex(row: unknown, count: number): number | null {
  if (!count) return null
  const s = String(row ?? 'last').trim().toLowerCase()
  if (s === 'last' || s === '') return count - 1
  if (s === 'first') return 0
  const n = Number(s)
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : null
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
  const baseExtras = options.extras ?? {}
  const resolve = options.resolve ?? ((template: string, values: Record<string, unknown>, ex: Record<string, unknown>) => resolveInputTemplate(template, { values, extras: ex }))
  let state = host.state()
  let values = host.values()
  let pending = false

  /**
   * The rows a list action aims at: `selected` = every selected row (none →
   * the action's empty-selection message, and the rule stops: 'empty'), else
   * one row (last, first, a number or a template). 0-based, ascending.
   */
  async function targetRows(action: FieldButtonAction, count: number, fallback: string): Promise<number[] | 'empty'> {
    const spec = String(action.row ?? fallback).trim()
    if (spec.toLowerCase() === 'selected') {
      const picked = listSelection(values, action.list_field ?? '').filter((i) => i < count)
      if (!picked.length) { host.message(action.empty_text ? interpolateButtonText(action.empty_text, { values, extras: baseExtras }) : 'Select a row first', 'info'); return 'empty' }
      return picked
    }
    const at = listRowIndex(await resolve(spec, values, baseExtras), count)
    return at === null ? [] : [at]
  }

  function apply(patch: Record<string, unknown>) {
    values = { ...values, ...patch }
    host.setValues(patch)
    pending = true
  }

  /** A List / editable Data table a row step works on (null: not on this form, or not editable here). */
  function rowsFieldOf(action: FieldButtonAction): RowsField | null {
    const f = action.field ? host.field?.(action.field) : undefined
    return f && isRowsField(f) && host.editableKeys.has(f.key) ? f : null
  }

  /** The rows a row step aims at ('empty': the selection is empty — the message shown). */
  async function rowTargetsOf(action: FieldButtonAction, f: RowsField, extras: Record<string, unknown>): Promise<RowTarget[] | 'empty'> {
    const spec = String(await resolve(action.row ?? 'current', values, extras) ?? 'current')
    const key = action.row_key ? await resolve(action.row_key, values, extras) : undefined
    const targets = resolveRowTargets(f, values, { spec, key: key === undefined || key === null ? undefined : String(key), loaded: host.tableRows?.(f.key) })
    if (!targets.length && spec.trim().toLowerCase() === 'selected') {
      host.message(action.empty_text ? interpolateButtonText(action.empty_text, { values, extras }) : 'Select a row first', 'info')
      return 'empty'
    }
    if (!targets.length && action.empty_text) { host.message(interpolateButtonText(action.empty_text, { values, extras }), 'info'); return 'empty' }
    return targets
  }

  const rowEvent = (f: RowsField, target: RowTarget, extra: Record<string, unknown> = {}) => ({
    field: f.key, row: targetValues(f, values, target), row_number: targetNumber(target), ...(target.kind === 'existing' ? { key: target.key } : {}), ...extra,
  })

  /** Ask before deleting / dropping (No / closed: false). */
  async function confirmed(text: string, yes: string): Promise<boolean> {
    return host.ask
      ? (await host.ask({ text, tone: 'warning', display: 'dialog', buttons: [{ value: 'yes', label: yes, style: 'danger' }, { value: 'no', label: 'Cancel' }], escape: 'no' })) === 'yes'
      : typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true
  }

  /**
   * Editable table rules (lib/forms/row-rules.ts). Returns: undefined (go on),
   * a stop reason, 'branched' (its own on-success steps ran; go on) or
   * 'ended' (its branch ended the run).
   */
  async function rowAction(action: FieldButtonAction, index: number, branch: ActionBranch | undefined, extras: Record<string, unknown>, at: { index: number; response: string } | null): Promise<string | 'branched' | 'ended' | undefined> {
    const f = rowsFieldOf(action)
    if (!f) { devNote(`${action.field ?? '(no field)'}: ${RULE_ROW_LABEL} needs a List or an editable Data table that can be changed here`); return 'rows_unavailable' }
    const name = f.label || f.key
    const branchOk = async (result: unknown): Promise<'branched' | 'ended' | undefined> => {
      if (at || !action.on_success?.length) return undefined
      run.ran.push(action.type)
      if (pending) { await host.flush(); pending = false; values = { ...host.values(), ...values } }
      return (await runList(action.on_success, { index, response: SUCCESS_BRANCH }, { ...extras, result, event: { ...(isPlainObject(extras.event) ? extras.event : {}), result } })) ? 'ended' : 'branched'
    }
    const branchFailed = async (message: string, errors: Record<string, string> = {}): Promise<string | 'ended'> => {
      if (!at && action.on_failure?.length) {
        run.ran.push(action.type)
        if (pending) { await host.flush(); pending = false; values = { ...host.values(), ...values } }
        const failed = { message, errors }
        await runList(action.on_failure, { index, response: FAILURE_BRANCH }, { ...extras, error: failed, event: { ...(isPlainObject(extras.event) ? extras.event : {}), error: failed } })
        run.stopped = `${action.type}_failed`
        return 'ended'
      }
      host.message(message, 'info')
      return `${action.type}_failed`
    }
    switch (action.type) {
      case 'new_row': {
        const defaults: Record<string, unknown> = {}
        for (const [column, template] of Object.entries({ ...columnDefaults(f), ...(action.values ?? {}) })) defaults[column] = await resolve(template, values, withDates(extras))
        const made = newRow(f, values, defaults, action.position ?? 'end')
        if ('error' in made) { host.message(made.error, 'info'); return 'row_unavailable' }
        const next = { ...values, ...made.extra, [f.key]: made.value }
        const ref = { ...targetRef(made.target), ...(action.focus_column ? { focus: action.focus_column } : {}) }
        const patch: Record<string, unknown> = { [f.key]: made.value, ...made.extra, [ROW_CURRENT_KEY]: withCurrentRow(next, f.key, ref as never) }
        // The new row is the selected one too (a List with selection on).
        if (f.type === 'list' && f.list?.selectable) patch[LIST_SELECT_KEY] = withListSelected(values, f.key, [(made.target as { index: number }).index])
        apply(patch)
        host.emit?.('row_created', f.key, rowEvent(f, made.target))
        return undefined
      }
      case 'set_row_values': {
        const targets = await rowTargetsOf(action, f, extras)
        if (targets === 'empty') return 'selection_empty'
        if (!targets.length) { devNote(`${name}: Set row values found no row (${action.row ?? 'current'}) — create one with New row, or choose another row`); return undefined }
        for (const target of targets) {
          const rowExtras = { ...extras, row: targetValues(f, values, target) }
          const patch: Record<string, unknown> = {}
          for (const [column, template] of Object.entries(action.values ?? {})) patch[column] = await resolve(template, values, rowExtras)
          const done = setRowValues(f, values, target, patch)
          if (done.ignored.length) devNote(`${name}${targetNumber(target) ? ` row ${targetNumber(target)}` : ''}: ${done.ignored.join(', ')} left as they are (read-only on an existing row, or not a column)`)
          if (Object.keys(done.errors).length) { host.message(done.errors._row ?? `${name}: ${Object.values(done.errors)[0]}`, 'info'); return 'row_invalid' }
          if (done.value !== values[f.key]) apply({ [f.key]: done.value })
          if (done.changed.length) host.emit?.('row_values_changed', f.key, rowEvent(f, target, { columns: done.changed }))
        }
        return undefined
      }
      case 'commit_row': {
        const targets = await rowTargetsOf(action, f, extras)
        if (targets === 'empty') return 'selection_empty'
        if (!targets.length) { devNote(`${name}: Commit row found no row (${action.row ?? 'current'})`); return undefined }
        let last: unknown = null
        const problems: Array<{ errors: Record<string, string>; target: RowTarget }> = []
        for (const target of targets) {
          const staged = commitRow(f, values, target)
          if (staged.value !== values[f.key]) apply({ [f.key]: staged.value })
          if (!staged.ok) {
            problems.push({ errors: staged.errors, target })
            host.emit?.('row_commit_failed', f.key, rowEvent(f, target, { errors: staged.errors, error: Object.values(staged.errors)[0] ?? null }))
            continue
          }
          // Save now (a Data table): written on the server at once; the row leaves the change set, the table re-reads.
          if (action.commit_mode === 'save_now' && f.type === 'data_table') {
            const change = tableSaveChange(f, values, target, 'commit')
            if (change) {
              if (!host.runExtra) return 'commit_row_unavailable'
              let outcome: Awaited<ReturnType<NonNullable<FieldButtonHost['runExtra']>>>
              try {
                outcome = await host.runExtra(index, action, values, branch, { ...(isPlainObject(extras.event) ? extras.event : {}), ...rowEvent(f, target), commit: change })
              } catch (error) {
                const message = error instanceof Error && error.message ? error.message : 'The row could not be saved'
                host.emit?.('row_commit_failed', f.key, rowEvent(f, target, { error: message, errors: {} }))
                return branchFailed(message)
              }
              if (outcome?.stop) return outcome.stop
              // The server's own note ("Saved to …") unless the author's on-success steps say it.
              if (outcome?.message && (outcome.kept || !action.on_success?.length)) host.message(outcome.message.text, outcome.message.tone)
              // Nothing written (the designer's preview): the row stays staged.
              if (outcome?.kept) { last = { row: staged.row }; host.emit?.('row_committed', f.key, rowEvent(f, target, { saved: false })); continue }
              const result = isPlainObject(outcome?.result) ? outcome!.result as Record<string, unknown> : {}
              const saved = isPlainObject(result.row) ? result.row as Record<string, unknown> : targetValues(f, values, target)
              const id = typeof result.id === 'string' ? result.id : target.kind === 'existing' ? target.key : null
              apply({ [f.key]: dropFromChangeSet(f, values, target), [ROW_CURRENT_KEY]: withCurrentRow(values, f.key, id ? { key: id, row: saved } : null) })
              await host.runExtra(index, { type: 'refresh_table', field: f.key }, values).catch(() => undefined)
              last = { ...result, row: saved }
              host.emit?.('row_committed', f.key, { field: f.key, row: saved, key: id, saved: true, result: last })
              continue
            }
          }
          last = { row: staged.row }
          host.emit?.('row_committed', f.key, rowEvent(f, target, { saved: false }))
        }
        if (problems.length) {
          const first = problems[0]
          const n = targetNumber(first.target)
          const text = `${name}${n ? ` row ${n}` : ''}: ${Object.values(first.errors)[0] ?? 'check the row'}`
          return branchFailed(problems.length > 1 ? `${problems.length} rows of ${name} need attention — ${text}` : text, first.errors)
        }
        return branchOk(last)
      }
      case 'discard_row':
      case 'revert_row': {
        const targets = await rowTargetsOf(action, f, extras)
        if (targets === 'empty') return 'selection_empty'
        const defaults: Record<string, unknown> = {}
        if (action.type === 'revert_row') for (const [column, template] of Object.entries(columnDefaults(f))) defaults[column] = await resolve(template, values, withDates(extras))
        // Highest List rows first: removing one doesn't move the others.
        for (const target of [...targets].sort((a, b) => (b.kind === 'list' && a.kind === 'list' ? b.index - a.index : 0))) {
          const done = discardRow(f, values, target, action.type === 'revert_row' ? 'revert' : 'discard', defaults)
          if (done.value !== values[f.key] || Object.keys(done.extra).length) apply({ [f.key]: done.value, ...done.extra })
        }
        return undefined
      }
      case 'delete_row': {
        const targets = await rowTargetsOf(action, f, extras)
        if (targets === 'empty') return 'selection_empty'
        if (!targets.length) return undefined
        if (action.confirm_text && !(await confirmed(interpolateButtonText(action.confirm_text, { values, extras: { ...extras, count: targets.length } }), 'Delete'))) return 'prompt_stopped'
        if (action.commit_mode === 'save_now' && f.type === 'data_table') {
          if (!host.runExtra) return 'delete_row_unavailable'
          const ids: string[] = []
          for (const target of targets) {
            if (target.kind === 'existing') {
              try {
                const outcome = await host.runExtra(index, action, values, branch, { ...(isPlainObject(extras.event) ? extras.event : {}), ...rowEvent(f, target), commit: { deleted: { key: target.key } } })
                if (outcome?.message) host.message(outcome.message.text, outcome.message.tone)
                if (outcome?.kept) { apply({ [f.key]: deleteRows(f, values, [target]).value }); continue }
              } catch (error) {
                return branchFailed(error instanceof Error && error.message ? error.message : 'The row could not be deleted')
              }
              ids.push(target.key)
            }
            apply({ [f.key]: dropFromChangeSet(f, values, target) })
          }
          const ref = currentRowRef(values, f.key)
          if (ref && targets.some((t) => (t.kind === 'added' && 'rid' in ref && ref.rid === t.rid) || (t.kind === 'existing' && 'key' in ref && ref.key === t.key))) apply({ [ROW_CURRENT_KEY]: withCurrentRow(values, f.key, null) })
          await host.runExtra(index, { type: 'refresh_table', field: f.key }, values).catch(() => undefined)
          return branchOk({ count: ids.length, row_ids: ids })
        }
        const done = deleteRows(f, values, targets)
        if (done.refused) return branchFailed(done.refused)
        apply({ [f.key]: done.value, ...done.extra, ...(f.type === 'list' ? { [LIST_SELECT_KEY]: withListSelected(values, f.key, []) } : {}) })
        return branchOk({ count: targets.length })
      }
      case 'refresh_table': {
        if (f.type !== 'data_table') return undefined
        const waiting = pendingCount(f, values)
        if (action.keep_pending === 'ask' && waiting) {
          if (await confirmed(`Drop the ${waiting === 1 ? 'pending row' : `${waiting} pending rows`} of ${name} and reload it?`, 'Drop and reload')) apply({ [f.key]: null, [ROW_CURRENT_KEY]: withCurrentRow(values, f.key, null) })
        }
        if (pending) { await host.flush(); pending = false }
        await host.runExtra?.(index, action, values, branch)
        return undefined
      }
    }
    return undefined
  }

  /** Run a list; true = the run ended (stopped, or a submit took over). `at`: the question a response's list belongs to. */
  async function runList(actions: FieldButtonAction[], at: { index: number; response: string } | null, extras: Record<string, unknown> = baseExtras): Promise<boolean> {
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
        case 'add_list_row': {
          // A row from the form's inputs (lib/forms/list-field.ts): required inputs, column checks, max rows; then the inputs clear.
          const list = action.list_field ? host.field?.(action.list_field) : undefined
          if (!list?.list || !action.list_field || !host.editableKeys.has(action.list_field)) return stop('list_unavailable')
          const config = list.list
          const missing = (action.require ?? []).filter((k) => blankValue(values[k]))
          if (missing.length) {
            for (const k of missing) host.fieldError?.(k, `${host.field?.(k)?.label ?? k} is required`)
            if (!host.fieldError) host.message(`Fill in ${missing.map((k) => host.field?.(k)?.label ?? k).join(', ')} first`, 'info')
            return stop('row_invalid')
          }
          const draft: Record<string, unknown> = {}
          for (const [column, template] of Object.entries(action.values ?? {})) draft[column] = await resolve(template, values, extras)
          const problems = listRowErrors(config, draft)
          if (Object.keys(problems).length) {
            let shown = false
            for (const [column, text] of Object.entries(problems)) {
              const source = listSourceField(action.values?.[column])
              if (source && host.fieldError && host.field?.(source)) { host.fieldError(source, text); shown = true }
            }
            if (!shown) host.message(Object.values(problems)[0], 'info')
            return stop('row_invalid')
          }
          if (isBlankListRow(config, draft)) { host.message('Fill in the row first', 'info'); return stop('row_invalid') }
          // A lookup column mapped from an autocomplete input takes its display label too (`<input>_label` → `<column>_label`).
          for (const column of config.columns) {
            if (column.type !== 'lookup') continue
            const source = listSourceField(action.values?.[column.key])
            if (source && values[lookupLabelKey(source)] !== undefined) draft[listLabelKey(column.key)] = values[lookupLabelKey(source)]
          }
          const rows = rawListRows(values[action.list_field])
          // Editing a row already in the list ("Edit" loaded it into the inputs): update it instead of appending.
          const editing = listEditingRow(values, action.list_field)
          const replacing = editing !== null && editing < rows.length
          if (!replacing && config.max_rows !== undefined && rows.length >= config.max_rows) {
            host.message(`${list.label} is full (at most ${config.max_rows} ${config.max_rows === 1 ? 'row' : 'rows'})`, 'info')
            return stop('list_full')
          }
          const typed: Record<string, unknown> = coerceListRow(config, draft)
          // Editing a row already in the list: its read-only columns keep their values, whatever the inputs hold.
          if (replacing) {
            const kept = config.columns.filter((c) => c.read_only)
            for (const c of kept) {
              typed[c.key] = rows[editing][c.key] ?? null
              if (c.type === 'lookup') typed[listLabelKey(c.key)] = rows[editing][listLabelKey(c.key)] ?? null
            }
            if (kept.length) Object.assign(typed, coerceListRow(config, typed))
            if (kept.some((c) => Object.prototype.hasOwnProperty.call(action.values ?? {}, c.key))) devNote(`${list.label}: read-only column(s) ${kept.map((c) => c.label).join(', ')} kept the row's values`)
          }
          const patch: Record<string, unknown> = { [action.list_field]: replacing ? rows.map((r, i) => (i === editing ? { ...r, ...typed } : r)) : [...rows, typed] }
          if (editing !== null) patch[LIST_EDIT_KEY] = withListEditing(values, action.list_field, null)
          for (const k of listClearFields(action)) {
            if (k === action.list_field || !host.editableKeys.has(k)) continue
            patch[k] = host.reset ? host.reset(k) : host.blank(k)
            if (host.field?.(k)?.type === 'lookup') { patch[lookupLabelKey(k)] = null; patch[`${k}_item`] = null }
          }
          values = { ...values, ...patch }
          host.setValues(patch)
          pending = true
          break
        }
        case 'edit_list_row': {
          // Load a row back into the inputs and remember it: the next "Add row to list" updates it.
          if (!action.list_field) break
          const rows = rawListRows(values[action.list_field])
          const targets = await targetRows(action, rows.length, '{{event.row_number}}')
          if (targets === 'empty') return stop('selection_empty')
          if (!targets.length) break
          const at = targets[0]
          if (targets.length > 1) host.message(`${targets.length} rows are selected: editing the first (row ${at + 1})`, 'info')
          const row = rows[at]
          const rowExtras = { ...extras, row, event: { ...(isPlainObject(extras.event) ? extras.event : {}), row } }
          const patch: Record<string, unknown> = { [LIST_EDIT_KEY]: withListEditing(values, action.list_field, at) }
          for (const [key, template] of Object.entries(action.assign ?? {})) {
            if (!host.editableKeys.has(key)) continue
            patch[key] = await resolve(template, values, rowExtras)
            // An autocomplete input shows the row's label for its value.
            const column = /^\{\{\s*row\.([A-Za-z0-9_]+)\s*\}\}$/.exec(template.trim())?.[1]
            if (column && host.field?.(key)?.type === 'lookup' && row[listLabelKey(column)] !== undefined) patch[lookupLabelKey(key)] = row[listLabelKey(column)]
          }
          values = { ...values, ...patch }
          host.setValues(patch)
          pending = true
          break
        }
        case 'cancel_list_edit': {
          // Forget the row being edited and put the inputs back to their defaults.
          if (!action.list_field) break
          const patch: Record<string, unknown> = { [LIST_EDIT_KEY]: withListEditing(values, action.list_field, null) }
          for (const k of action.fields ?? []) {
            if (!host.editableKeys.has(k)) continue
            patch[k] = host.reset ? host.reset(k) : host.blank(k)
            if (host.field?.(k)?.type === 'lookup') { patch[lookupLabelKey(k)] = null; patch[`${k}_item`] = null }
          }
          values = { ...values, ...patch }
          host.setValues(patch)
          pending = true
          break
        }
        case 'update_list_row': {
          // Change some columns of the targeted rows (one, or every selected row), checked like an added row.
          const list = action.list_field ? host.field?.(action.list_field) : undefined
          if (!list?.list || !action.list_field || !host.editableKeys.has(action.list_field)) return stop('list_unavailable')
          const rows = rawListRows(values[action.list_field])
          const targets = await targetRows(action, rows.length, 'last')
          if (targets === 'empty') return stop('selection_empty')
          if (!targets.length) break
          const next = [...rows]
          for (const at of targets) {
            // {{row.*}} is the row being changed; {{event.*}} stays the event's (a row button's row, for one).
            const rowExtras = { ...extras, row: rows[at] }
            const patch: Record<string, unknown> = {}
            const skipped: string[] = []
            for (const [column, template] of Object.entries(action.values ?? {})) {
              // Read-only columns: an existing row keeps them (a new row not yet committed may take them).
              if (!listColumnWritable(list.list, column, rows[at])) { skipped.push(column); continue }
              patch[column] = await resolve(template, values, rowExtras)
            }
            if (skipped.length) devNote(`${list.label} row ${at + 1}: read-only column(s) ${skipped.join(', ')} left as they are`)
            const merged = { ...rows[at], ...patch }
            const problems = listRowErrors(list.list, merged)
            if (Object.keys(problems).length) { host.message(`Row ${at + 1}: ${Object.values(problems)[0]}`, 'info'); return stop('row_invalid') }
            next[at] = coerceListRow(list.list, merged)
          }
          values = { ...values, [action.list_field]: next }
          host.setValues({ [action.list_field]: next })
          pending = true
          break
        }
        case 'remove_list_row':
        case 'clear_list': {
          if (!action.list_field || !host.editableKeys.has(action.list_field)) break
          const rows = rawListRows(values[action.list_field])
          let removed: number[] = rows.map((_, i) => i)
          if (action.type === 'remove_list_row') {
            const targets = await targetRows(action, rows.length, 'last')
            if (targets === 'empty') return stop('selection_empty')
            if (!targets.length) break
            removed = targets
          }
          if (!removed.length) break
          // "Delete 2 rows?" / "Clear all rows?": the author's question first (No / closed stops the rule).
          if (action.confirm_text) {
            const text = interpolateButtonText(action.confirm_text, { values, extras: { ...extras, count: removed.length } })
            const ok = host.ask
              ? (await host.ask({ text, tone: 'warning', display: 'dialog', buttons: [{ value: 'yes', label: action.type === 'clear_list' ? 'Clear' : 'Delete', style: 'danger' }, { value: 'no', label: 'Cancel' }], escape: 'no' })) === 'yes'
              : typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true
            if (!ok) return stop('prompt_stopped')
          }
          const gone = new Set(removed)
          const next = rows.filter((_, i) => !gone.has(i))
          // The selection clears (its rows are gone or moved); editing ends when its row went, else follows its row.
          const marker: Record<string, unknown> = { [LIST_SELECT_KEY]: withListSelected(values, action.list_field, []), ...afterListRemoval(values, action.list_field, gone) }
          const editing = listEditingRow(values, action.list_field)
          if (editing !== null) {
            const moved = remapAfterRemoval([editing], gone)
            marker[LIST_EDIT_KEY] = withListEditing(values, action.list_field, moved.length ? moved[0] : null)
          }
          values = { ...values, [action.list_field]: next, ...marker }
          host.setValues({ [action.list_field]: next, ...marker })
          pending = true
          break
        }
        case 'new_row':
        case 'set_row_values':
        case 'commit_row':
        case 'discard_row':
        case 'revert_row':
        case 'delete_row':
        case 'refresh_table': {
          const outcome = await rowAction(action, index, branch, extras, at)
          if (outcome === 'ended') return true
          if (typeof outcome === 'string') return stop(outcome)
          if (outcome === 'branched') continue
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
          if (button?.then?.length && await runList(button.then, { index, response }, extras)) return true
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
        case 'start_workflow':
        case 'table_read':
        case 'table_list':
        case 'table_create':
        case 'table_update':
        case 'table_delete': {
          if (!host.runExtra) return stop(`${action.type}_unavailable`)
          // Delete: the author's confirmation question first (No / closed stops the rule).
          if (action.type === 'table_delete' && action.confirm_text) {
            const text = interpolateButtonText(action.confirm_text, { values, extras })
            const ok = host.ask
              ? (await host.ask({ text, tone: 'warning', display: 'dialog', buttons: [{ value: 'yes', label: 'Delete', style: 'danger' }, { value: 'no', label: 'Cancel' }], escape: 'no' })) === 'yes'
              : typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm(text) : true
            if (!ok) return stop('prompt_stopped')
          }
          let outcome: Awaited<ReturnType<NonNullable<FieldButtonHost['runExtra']>>> = undefined
          try {
            if (action.each_selected && action.type.startsWith('table_')) {
              // Once per selected row of a List: {{row.<column>}} is that row (e.g. delete each selected row's table row).
              const rows = rawListRows(values[action.each_selected])
              const picked = listSelection(values, action.each_selected).filter((i) => i < rows.length)
              if (!picked.length) { host.message(action.empty_text ? interpolateButtonText(action.empty_text, { values, extras }) : 'Select a row first', 'info'); return stop('selection_empty') }
              const base = isPlainObject(extras.event) ? extras.event : {}
              for (const i of picked) outcome = await host.runExtra(index, action, values, branch, { ...base, row: rows[i], row_number: i + 1, index: i })
            } else {
              outcome = await host.runExtra(index, action, values, branch)
            }
          } catch (error) {
            const message = error instanceof Error && error.message ? error.message : 'That step could not run'
            // On failure: its own steps ({{error.message}}), then the rule stops; without any, the message.
            if (!at && action.on_failure?.length) {
              run.ran.push(action.type)
              const failed = { message }
              await runList(action.on_failure, { index, response: FAILURE_BRANCH }, { ...extras, error: failed, event: { ...(isPlainObject(extras.event) ? extras.event : {}), error: failed } })
              run.stopped = `${action.type}_failed`
              return true
            }
            host.message(message, 'info')
            return stop(`${action.type}_failed`)
          }
          if (outcome?.values && Object.keys(outcome.values).length) {
            values = { ...values, ...outcome.values }
            host.setValues(outcome.values)
            pending = true
          }
          if (outcome?.message) host.message(outcome.message.text, outcome.message.tone)
          if (outcome?.stop) return stop(outcome.stop)
          if (!at && action.on_success?.length) {
            run.ran.push(action.type)
            if (pending) { await host.flush(); pending = false; values = { ...host.values(), ...values } }
            const result = outcome?.result ?? null
            if (await runList(action.on_success, { index, response: SUCCESS_BRANCH }, { ...extras, result, event: { ...(isPlainObject(extras.event) ? extras.event : {}), result } })) return true
            continue
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
