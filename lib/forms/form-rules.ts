/**
 * Form rules: one model for everything a form does on its own —
 *
 *   When [event]  →  If [conditions]  →  Then [actions]
 *
 * Stored on the layout as `layout.rules` (lib/forms/layout.ts), so rules
 * travel wherever the grid goes: a node's `form_layout`, task metadata,
 * reusable forms and their versions, exports, packages, the REST API, MCP
 * and the CLI's config-as-code. Older readers ignore the key.
 *
 * Backwards compatibility — nothing is migrated. The rules a form already
 * had stay where they live and keep running exactly as before:
 *
 *   field / button `visible_when`    a declarative "Always" rule (show while …)
 *   step / tab `visible_when`        the same, on a page
 *   button `disabled_when`           an "Always" rule (disable while …)
 *   an in-form Button's On click     a "Button clicked" rule
 *   the bar buttons' behaviours      an "After submit" rule
 *   targets that start hidden        a "Form loads" rule
 *
 * collectFormRules reads all of them (plus layout.rules) into one list for
 * the designer's Rules tab, each with the place it lives ("where it lives"
 * badge); writeUnifiedRule writes an edit back to that place — or, when the
 * edit no longer fits there (AND / OR groups on a visibility rule, a
 * condition on a button click), moves it into layout.rules. Editing in the
 * old places keeps working because both views read the same storage.
 *
 * Events: see FORM_RULE_EVENTS. Each exposes context to conditions and
 * actions as {{event.*}}: event.field, event.value, event.previous,
 * event.row.<column> (row events), event.column (cell edits), event.item
 * (autocomplete: value, label, fields.<field>), event.page, event.flag,
 * event.button. Conditions also read form values ({{field}}, `form.x`),
 * state flags (`state.<flag>`) and the current user (`user.id`, `user.email`,
 * `user.name`, and `user.roles` / `user.teams` — arrays of the person's
 * workspace role and team names and ids, so `user.roles contains "Manager"`
 * is "has the role" and `user.roles does not equal "Manager"` is "has not";
 * lib/services/form-rule-user.ts).
 *
 * Actions: the in-form Button action framework (lib/forms/field-buttons.ts)
 * plus rule-only actions, grouped in the designer as Show / hide, Validate,
 * Update values, Transfer data, Navigate and Integrations / workflow.
 *
 * Security model:
 *  - Client-side rules only change client state (values, flags, hidden /
 *    disabled targets, the current page, messages).
 *  - Server-effecting actions (call an API reference, start a workflow,
 *    apply table changes) run on the server only, looked up by rule id and
 *    action index in the SAVED form (POST /api/internal/forms/rule-action);
 *    targets are never taken from the request. Submit / save draft press the
 *    surface's own pipeline.
 *  - A submitted `__form_state` may only claim what the form's buttons and
 *    event rules can produce (sanitizeFormState). A rule's claim is accepted
 *    only when its condition holds for the submitted values — unless the
 *    condition reads the event, which the server cannot see (then it is
 *    trusted like a button click: a person could have done it). The user
 *    (`user.*`, roles and teams included) is the server's own view of the
 *    person, loaded at submit (lib/services/form-rule-user.ts) — never the
 *    browser's; anonymous visitors have no id and empty roles / teams.
 *  - "Always" rules (declarative show / hide / disable / field errors) are
 *    recomputed by the server from the submitted values: their hides decide
 *    which fields are required, their errors block the submission.
 *  - Validate rules (field errors, blocked submits) on Always / Before
 *    submit / Value changes / Loses focus run again on the server at submit
 *    (ruleValidationErrors), so skipping the browser does not skip them.
 *    A Before-submit rule aimed at one bar button runs for that button only
 *    — in the browser and on the server alike — and runs at submit only:
 *    not when a step's Next is pressed, unless the author ticked "Also check
 *    on this step" (`step_check`). A step's Next never blocks on an error
 *    of a field on another step.
 *  - Set / copy / clear values may write a read-only field (a rule fills a
 *    display value the person cannot edit). The server keeps such a value
 *    only when a rule of the saved form could have produced it
 *    (ruleWrittenReadOnlyValues): an enabled event rule assigning that
 *    field, passing the same gate as `__form_state` claims, and — when the
 *    server can compute the assignment — producing exactly that value.
 *  - Sections (lib/forms/sections.ts): `section:<key>` targets show / hide,
 *    enable / disable and collapse / expand a section; "Section added /
 *    removed" fires when the person adds or removes an optional section;
 *    conditions read `section.<key>.included` / `section.<key>.visible`.
 *  - Read only ("Make read only / editable", Show / hide group): targets a
 *    control (`field:<key>`), a section, a row, a step / tab (`page:<id>`)
 *    or the whole form (FORM_WHOLE_TARGET = `form:*`). A control is read
 *    only when it or anything containing it is. The value stays visible,
 *    is still submitted and read by rules; the person cannot change it
 *    (rules still can) and it is not required. The server recomputes
 *    Always rules' read-only targets and bounds event rules' claims like
 *    hides (sanitizeFormState) — for the required check only: like Enable /
 *    disable, it does not reject a changed value (Read-only on the field
 *    does). Buttons are not made read only (Enable / disable them).
 *  - Labels (lib/forms/label-field.ts): "Label changes" fires when a
 *    label's value settles on a new value (an expression, a rule, a
 *    parameter); the server judges such a rule's condition with the label's
 *    recomputed value as event.value, like a value change.
 *
 * Pure and isomorphic.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { pathValue } from './lookup'
import {
  DATA_TABLE_OPERATORS, DATA_TABLE_OPERATOR_LABELS, changeCount, isChangeSet, isConditionGroup, normalizeConditionGroup,
  type DataTableCondition, type DataTableConditionGroup, type DataTableOperator,
} from './data-table'
import {
  FIELD_BUTTON_ACTION_LABELS, isServerRuleAction, actionAt, actionStyle, allActions, listClearFields, listSourceField, normalizeFieldButtonAction,
  type ActionBranch, type FieldButtonAction, type FieldButtonActionType,
} from './field-buttons'
import { DISMISSED_RESPONSE, promptButton } from './form-messages'
import { FORM_STATE_KEY, FORM_WHOLE_TARGET, declaredSectionKeys, flagKey, parseTarget, sectionBoundaryKeys, stateRuleFlag, targetFieldKeys, type FormUiState } from './form-state'
import { CONTROLS_KEY, formContextPath } from './form-params'
import { sectionConditionValue } from './sections'
import { OPTIONS_KEY, readDeepPath } from './data-actions'
import { childListAt, listEditingRow, registerListRuleJudge, type ListFieldConfig } from './list-field'
import { describeStyle, mergeStyles, type ConditionalStyle } from './conditional-style'
import { ignoredOnExisting, isRowsField } from './row-rules'

/* ── Events ─────────────────────────────────────────────────────────── */

export type FormRuleEventType =
  | 'always' | 'form_load' | 'value_change' | 'focus' | 'blur' | 'button_click'
  | 'row_click' | 'row_select' | 'row_deselect' | 'row_double_click' | 'cell_edit' | 'row_add' | 'row_delete'
  | 'item_select' | 'page_change' | 'before_submit' | 'after_submit' | 'flag_change' | 'message_answered' | 'section_change'
  | 'label_change' | 'part_loaded' | 'list_row_button' | 'list_row_click' | 'list_row_select' | 'list_selection_change'
  | 'row_created' | 'row_values_changed' | 'row_committed' | 'row_commit_failed' | 'cell_change'

export const FORM_RULE_EVENTS: FormRuleEventType[] = [
  'always', 'form_load', 'value_change', 'focus', 'blur', 'button_click',
  'row_click', 'row_select', 'row_deselect', 'row_double_click', 'cell_edit', 'row_add', 'row_delete',
  'item_select', 'page_change', 'before_submit', 'after_submit', 'flag_change', 'message_answered', 'section_change',
  'label_change', 'part_loaded', 'list_row_button', 'list_row_click', 'list_row_select', 'list_selection_change',
  'row_created', 'row_values_changed', 'row_committed', 'row_commit_failed', 'cell_change',
]

export const FORM_RULE_EVENT_LABELS: Record<FormRuleEventType, string> = {
  always: 'Always (while the condition holds)',
  form_load: 'Form loads',
  value_change: 'Field value changes',
  focus: 'Field gets focus',
  blur: 'Field loses focus',
  button_click: 'Button clicked',
  row_click: 'Data table: row clicked',
  row_select: 'Data table: row selected',
  row_deselect: 'Data table: row deselected',
  row_double_click: 'Data table: row double-clicked',
  cell_edit: 'Data table: cell edited',
  row_add: 'Data table: row added',
  row_delete: 'Data table: row deleted',
  item_select: 'Autocomplete: item selected',
  page_change: 'Step / tab changed',
  before_submit: 'Before submit',
  after_submit: 'After submit',
  flag_change: 'A state flag changes',
  message_answered: 'A question is answered',
  section_change: 'Section added / removed',
  label_change: 'Label changes',
  part_loaded: 'Section / tab loaded',
  list_row_button: 'List: row button clicked',
  list_row_click: 'List: row clicked',
  list_row_select: 'List: row selected / unselected',
  list_selection_change: 'List: selection changed',
  row_created: 'Editable table: new row created',
  row_values_changed: 'Editable table: row values set',
  row_committed: 'Editable table: row committed',
  row_commit_failed: 'Editable table: row commit failed',
  cell_change: 'Editable table: cell changed',
}

/** What an event's target is (the field / button / table / lookup / page / flag it is about), or null. */
/** `rows`: a List or an editable Data table (the editable table rules — lib/forms/row-rules.ts). */
export type RuleEventTarget = 'field' | 'button' | 'table' | 'lookup' | 'page' | 'flag' | 'bar_button' | 'message' | 'section' | 'label' | 'part' | 'list' | 'rows' | null
export const EVENT_TARGET: Record<FormRuleEventType, RuleEventTarget> = {
  always: null, form_load: null, value_change: 'field', focus: 'field', blur: 'field', button_click: 'button',
  row_click: 'table', row_select: 'table', row_deselect: 'table', row_double_click: 'table', cell_edit: 'table', row_add: 'table', row_delete: 'table',
  item_select: 'lookup', page_change: 'page', before_submit: 'bar_button', after_submit: 'bar_button', flag_change: 'flag',
  message_answered: 'message',
  section_change: 'section',
  label_change: 'label',
  part_loaded: 'part',
  list_row_button: 'list',
  list_row_click: 'list',
  list_row_select: 'list',
  list_selection_change: 'list',
  row_created: 'rows',
  row_values_changed: 'rows',
  row_committed: 'rows',
  row_commit_failed: 'rows',
  cell_change: 'rows',
}

/** {{event.*}} paths each event provides (the designer's placeholders; the test panel's sample event). */
export const EVENT_CONTEXT: Record<FormRuleEventType, string[]> = {
  always: [],
  form_load: [],
  value_change: ['event.field', 'event.value', 'event.previous'],
  focus: ['event.field', 'event.value'],
  blur: ['event.field', 'event.value'],
  button_click: ['event.button'],
  row_click: ['event.field', 'event.row', 'event.key'],
  row_select: ['event.field', 'event.row', 'event.key', 'event.selected'],
  row_deselect: ['event.field', 'event.row', 'event.key'],
  row_double_click: ['event.field', 'event.row', 'event.key'],
  cell_edit: ['event.field', 'event.row', 'event.key', 'event.column', 'event.value', 'event.previous'],
  row_add: ['event.field', 'event.row'],
  row_delete: ['event.field', 'event.row', 'event.key'],
  item_select: ['event.field', 'event.value', 'event.item.label', 'event.item.fields'],
  page_change: ['event.page', 'event.previous'],
  before_submit: ['event.button'],
  after_submit: ['event.button'],
  flag_change: ['event.flag', 'event.value'],
  message_answered: ['event.message', 'event.response', 'event.label'],
  section_change: ['event.section', 'event.included'],
  label_change: ['event.field', 'event.value', 'event.previous'],
  part_loaded: ['event.part'],
  // A List's row button (list.row_buttons): which button, the row ({{row.<column>}} too) and its position.
  list_row_button: ['event.field', 'event.button', 'event.row', 'event.row_number', 'event.index', 'event.child', 'event.parent', 'event.parent_row_number'],
  list_row_click: ['event.field', 'event.row', 'event.row_number', 'event.index', 'event.child', 'event.parent', 'event.parent_row_number'],
  list_row_select: ['event.field', 'event.row', 'event.row_number', 'event.index', 'event.selected', 'event.child', 'event.parent', 'event.parent_row_number'],
  list_selection_change: ['event.field', 'event.selected', 'event.count'],
  // Editable table rules (lib/forms/row-rules.ts): the row, its number (Lists / new Data table rows) or key (existing Data table rows).
  row_created: ['event.field', 'event.row', 'event.row_number', 'event.key', 'event.child', 'event.parent', 'event.parent_row_number'],
  row_values_changed: ['event.field', 'event.row', 'event.row_number', 'event.key', 'event.columns', 'event.child', 'event.parent', 'event.parent_row_number'],
  row_committed: ['event.field', 'event.row', 'event.row_number', 'event.key', 'event.saved', 'event.result', 'event.child', 'event.parent', 'event.parent_row_number'],
  row_commit_failed: ['event.field', 'event.row', 'event.row_number', 'event.key', 'event.error', 'event.errors', 'event.child', 'event.parent', 'event.parent_row_number'],
  cell_change: ['event.field', 'event.row', 'event.row_number', 'event.key', 'event.column', 'event.value', 'event.previous', 'event.child', 'event.parent', 'event.parent_row_number'],
}

/** Events whose rules' Validate actions the server re-checks at submit. */
const VALIDATED_EVENTS: ReadonlySet<FormRuleEventType> = new Set(['always', 'before_submit', 'value_change', 'blur'])

/* ── Actions ────────────────────────────────────────────────────────── */

export interface RuleActionGroup { label: string; types: FieldButtonActionType[] }

/** The "Then" catalog, grouped. */
export const RULE_ACTION_GROUPS: RuleActionGroup[] = [
  { label: 'Show / hide', types: ['show_hide', 'enable_disable', 'read_only', 'collapse_expand', 'load_part'] },
  { label: 'Style', types: ['set_style'] },
  { label: 'Validate', types: ['field_error', 'block_submit', 'validate'] },
  { label: 'Update values', types: ['set_values', 'clear_values', 'set_state', 'set_variable'] },
  { label: 'Transfer data', types: ['copy_values', 'add_list_row', 'edit_list_row', 'cancel_list_edit', 'update_list_row', 'remove_list_row', 'clear_list', 'run_lookup', 'refresh'] },
  { label: 'Editable tables', types: ['new_row', 'set_row_values', 'commit_row', 'discard_row', 'revert_row', 'delete_row', 'refresh_table', 'open_row_form'] },
  { label: 'Data tables', types: ['table_read', 'table_list', 'table_create', 'table_update', 'table_delete'] },
  { label: 'Messages', types: ['message', 'prompt'] },
  { label: 'Navigate', types: ['go_to_page', 'next_page', 'previous_page', 'open_link', 'submit', 'save_draft', 'print'] },
  { label: 'Integrations / workflow', types: ['call_reference', 'start_workflow', 'apply_table_changes'] },
]

export const RULE_ACTION_LABELS: Record<FieldButtonActionType, string> = {
  ...FIELD_BUTTON_ACTION_LABELS,
  show_hide: 'Show / hide fields, sections, steps',
  set_values: 'Set or calculate field values',
  set_state: 'Set or toggle a flag',
  go_to_page: 'Go to step / tab',
  message: 'Show a message',
  prompt: 'Ask a question (OK / Yes / No…)',
  validate: 'Validate the form / step',
  collapse_expand: 'Collapse / expand a section',
  load_part: 'Load section / tab',
  read_only: 'Make read only / editable',
}

/** "Always" rules are declarative: only these actions (applied while the condition holds, undone when it doesn't). */
export const ALWAYS_ACTIONS: ReadonlySet<FieldButtonActionType> = new Set(['show_hide', 'enable_disable', 'read_only', 'set_style', 'field_error', 'block_submit'])
/** Actions only "Always" rules take (a style follows a condition; it is not a one-off step). */
export const ALWAYS_ONLY_ACTIONS: ReadonlySet<FieldButtonActionType> = new Set(['set_style'])
/** After submit runs on the server with the submission: these actions only. */
export const AFTER_SUBMIT_ACTIONS: ReadonlySet<FieldButtonActionType> = new Set(['message', 'open_link', 'start_workflow', 'apply_table_changes'])

/* ── The model ──────────────────────────────────────────────────────── */

export interface FormRule {
  /** Stable id (the server looks a rule's server actions up by it). */
  id: string
  name?: string
  /** Notes about the rule (e.g. what an import could not convert, with the original expression). */
  description?: string
  /** Turned off (kept, not run). */
  disabled?: boolean
  event: FormRuleEventType
  /** The field / button / table / lookup / page / flag the event is about; empty = any. */
  target?: string
  /** Conditions (AND / OR groups, one nested level); empty = always. */
  if?: DataTableConditionGroup
  then: FieldButtonAction[]
  /** Before submit: also check it when a step's Next is pressed (default: at submit only). */
  step_check?: boolean
}

export const FORM_RULE_LIMITS = { rules: 100, actions: 12, name: 80, description: 2000 } as const
export const FORM_ERROR_KEY = '__form'

const RULE_ID_RE = /^[A-Za-z0-9_-]{1,40}$/
const TARGET_RE = /^[A-Za-z0-9_-]{1,64}$/
/** "Section / tab loaded" names its part as a target (`section:<key>` / `page:<id>`). */
const PART_TARGET_RE = /^(section|page):[A-Za-z0-9_-]{1,64}$/
const SUBJECT_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}(?:\.[A-Za-z0-9_$-]{1,64}){0,8}$/

/** A new rule id. */
export function newRuleId(taken: Iterable<string> = []): string {
  const used = new Set(taken)
  for (;;) {
    const id = `r_${Math.random().toString(36).slice(2, 10)}`
    if (!used.has(id)) return id
  }
}

function cleanGroup(raw: unknown): DataTableConditionGroup | undefined {
  const group = normalizeConditionGroup(raw)
  if (!group) return undefined
  const keep = (g: DataTableConditionGroup): DataTableConditionGroup | undefined => {
    const conditions = g.conditions
      .map((c) => (isConditionGroup(c) ? keep(c) : SUBJECT_RE.test(c.column) ? c : undefined))
      .filter((c): c is DataTableCondition | DataTableConditionGroup => Boolean(c))
    return conditions.length ? { match: g.match, conditions } : undefined
  }
  return keep(group)
}

/** Clean stored / submitted rules (unknown props dropped, ids unique, actions normalized; `known` drops rules on missing targets). */
export function normalizeFormRules(raw: unknown): FormRule[] {
  if (!Array.isArray(raw)) return []
  const out: FormRule[] = []
  const ids = new Set<string>()
  for (const entry of raw) {
    if (out.length >= FORM_RULE_LIMITS.rules) break
    if (!isPlainObject(entry)) continue
    const event = FORM_RULE_EVENTS.includes(entry.event as FormRuleEventType) ? entry.event as FormRuleEventType : null
    if (!event) continue
    let id = typeof entry.id === 'string' && RULE_ID_RE.test(entry.id) ? entry.id : newRuleId(ids)
    if (ids.has(id)) id = newRuleId(ids)
    ids.add(id)
    const rule: FormRule = { id, event, then: [] }
    const name = typeof entry.name === 'string' ? entry.name.replace(/[<>]/g, '').trim().slice(0, FORM_RULE_LIMITS.name) : ''
    if (name) rule.name = name
    // Plain text (rendered as text, never HTML): comparison operators in an original expression are kept.
    const description = typeof entry.description === 'string' ? entry.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, FORM_RULE_LIMITS.description) : ''
    if (description) rule.description = description
    if (entry.disabled === true) rule.disabled = true
    if (EVENT_TARGET[event] && typeof entry.target === 'string' && (event === 'part_loaded' ? PART_TARGET_RE : TARGET_RE).test(entry.target)) rule.target = event === 'flag_change' ? (flagKey(entry.target) || undefined) : entry.target
    if (!rule.target) delete rule.target
    const group = cleanGroup(entry.if)
    if (group) rule.if = group
    if (event === 'before_submit' && entry.step_check === true) rule.step_check = true
    const actions = Array.isArray(entry.then) ? entry.then : []
    rule.then = actions.map((a) => normalizeFieldButtonAction(a, { rule: true })).filter((a): a is FieldButtonAction => Boolean(a)).slice(0, FORM_RULE_LIMITS.actions)
    out.push(rule)
  }
  return out
}

/**
 * Inputs that only stage a List's rows: the fields an "Add row to list" rule
 * clears after adding (lib/forms/field-buttons.ts listClearFields). They are
 * empty in every submission, so summaries (submission tables, details) skip
 * them when empty.
 */
export function listStagingKeys(layout: unknown): Set<string> {
  const out = new Set<string>()
  for (const rule of layoutFormRules(layout)) for (const a of allActions(rule.then)) if (a.type === 'add_list_row') for (const k of listClearFields(a)) out.add(k)
  return out
}

/** The rules stored on a (stored or normalized) layout. */
export function layoutFormRules(layout: unknown): FormRule[] {
  return isPlainObject(layout) ? normalizeFormRules(layout.rules) : []
}

/** A rule with a field key renamed everywhere it names it (target, targets, assignments, fields, conditions). */
export function renameRuleKey(rule: FormRule, from: string, to: string): FormRule {
  const renameTarget = (t: string) => { const p = parseTarget(t); return p && p.kind !== 'page' && p.id === from ? `${p.kind}:${to}` : t }
  const renameGroup = (g: DataTableConditionGroup): DataTableConditionGroup => ({
    match: g.match,
    conditions: g.conditions.map((c) => (isConditionGroup(c) ? renameGroup(c) : c.column === from ? { ...c, column: to } : c.column.startsWith(`${from}.`) ? { ...c, column: `${to}${c.column.slice(from.length)}` } : c)),
  })
  const out: FormRule = { ...rule }
  if (out.target === from && EVENT_TARGET[out.event] !== 'page' && EVENT_TARGET[out.event] !== 'flag' && EVENT_TARGET[out.event] !== 'bar_button') out.target = to
  if (out.if) out.if = renameGroup(out.if)
  const renameAction = (a: FieldButtonAction): FieldButtonAction => {
    const next: FieldButtonAction = { ...a }
    if (a.targets) next.targets = a.targets.map(renameTarget)
    if (a.assign) next.assign = Object.fromEntries(Object.entries(a.assign).map(([k, v]) => [k === from ? to : k, v]))
    if (a.fields) next.fields = a.fields.map((k) => (k === from ? to : k))
    if (a.list_field === from) next.list_field = to
    if (a.outputs) next.outputs = a.outputs.map((o) => (o.to === from ? { ...o, to } : o))
    if (a.on_success) next.on_success = a.on_success.map(renameAction)
    if (a.on_failure) next.on_failure = a.on_failure.map(renameAction)
    if (a.clear_fields) next.clear_fields = a.clear_fields.map((k) => (k === from ? to : k))
    if (a.require) next.require = a.require.map((k) => (k === from ? to : k))
    if (a.values) next.values = Object.fromEntries(Object.entries(a.values).map(([c, v]) => [c, v.replace(new RegExp(`\\{\\{(\\s*(?:form\\.)?)${from}(\\s*)\\}\\}`, 'g'), `{{$1${to}$2}}`)]))
    if (a.field === from) next.field = to
    if (a.results) next.results = Object.fromEntries(Object.entries(a.results).map(([p, k]) => [p, k === from ? to : k]))
    if (a.prompt) next.prompt = { ...a.prompt, buttons: a.prompt.buttons.map((b) => (b.then ? { ...b, then: b.then.map(renameAction) } : b)) }
    return next
  }
  out.then = rule.then.map(renameAction)
  return out
}

/* ── Conditions ─────────────────────────────────────────────────────── */

export interface RuleScope {
  /** Form values (the state under FORM_STATE_KEY, or `state`). */
  values: Record<string, unknown>
  state?: FormUiState | null
  user?: Record<string, unknown> | null
  event?: Record<string, unknown> | null
  now?: Date
}

const TEMPLATE_RE = /\{\{\s*([\w.\-[\]$*]+)\s*\}\}/g

function stateOf(scope: RuleScope): FormUiState | null {
  if (scope.state) return scope.state
  const raw = scope.values?.[FORM_STATE_KEY]
  return isPlainObject(raw) ? raw as unknown as FormUiState : null
}

function isoDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** A subject / placeholder path's value in the scope. */
export function ruleValue(path: string, scope: RuleScope): unknown {
  if (path === 'today') return isoDay(scope.now ?? new Date())
  if (path === 'now') return (scope.now ?? new Date()).toISOString()
  // section.<key>.loaded / step.<id>.loaded (lib/forms/lazy-load.ts).
  if (path.endsWith('.loaded') && (path.startsWith('section.') || path.startsWith('step.'))) {
    const loaded = partLoadedValue(path, scope)
    if (loaded !== null) return loaded
  }
  // section.<key>.included / section.<key>.visible (lib/forms/sections.ts).
  if (path.startsWith('section.')) {
    const section = sectionConditionValue(path, { ...(scope.values ?? {}), ...(scope.state ? { [FORM_STATE_KEY]: scope.state } : {}) })
    if (section !== null) return section
  }
  const flag = stateRuleFlag(path)
  if (flag) return stateOf(scope)?.flags?.[flag] === true
  if (path === 'user' || path.startsWith('user.')) return path === 'user' ? scope.user : pathValue(scope.user ?? {}, path.slice(5))
  if (path === 'event' || path.startsWith('event.')) return path === 'event' ? scope.event : pathValue(scope.event ?? {}, path.slice(6))
  // {{row.*}} (a List row's button, a table row event), {{parent.*}} (a nested List row's parent row), {{result.*}} / {{error.*}} (a data / API step's own steps).
  for (const alias of ['row', 'parent', 'result', 'error'] as const) {
    if ((path === alias || path.startsWith(`${alias}.`) || path.startsWith(`${alias}[`)) && isPlainObject(scope.event) && alias in scope.event) {
      // [n] indexes and [*] (every item) as well: {{result[0].name}}, {{result[*].sku}}.
      return path === alias ? scope.event[alias] : readDeepPath(scope.event[alias], path.slice(alias.length).replace(/^\./, ''))
    }
  }
  // {{param.x}} / {{var.x}}: the form's parameters and variables (lib/forms/form-params.ts).
  const context = formContextPath(path)
  if (context) return pathValue(scope.values ?? {}, context)
  const m = /^(?:form|task_data|task\.data)\.(.+)$/.exec(path)
  return pathValue(scope.values ?? {}, m ? m[1] : path)
}

/**
 * `section.<key>.loaded` / `step.<id>.loaded`: from the control state when
 * the values carry it (it knows which parts load on open), else from the
 * state's `loaded` list.
 */
function partLoadedValue(path: string, scope: RuleScope): boolean | null {
  const m = /^(section|step)\.([A-Za-z0-9_-]{1,64})\.loaded$/.exec(path)
  if (!m) return null
  const controls = isPlainObject(scope.values?.[CONTROLS_KEY]) ? scope.values[CONTROLS_KEY] as Record<string, unknown> : null
  const known = m[1] === 'section' ? pathValue(controls ?? {}, `${m[2]}.loaded`) : pathValue(controls ?? {}, `form.loaded.${m[2]}`)
  if (typeof known === 'boolean') return known
  const state = stateOf(scope)
  return Array.isArray(state?.loaded) && state.loaded.includes(`${m[1] === 'step' ? 'page' : 'section'}:${m[2]}`)
}

function textOf(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch { return '' } }
  return String(v)
}

/** A rule template: one placeholder → its raw value; mixed text → filled text. */
export function resolveRuleTemplate(text: string | undefined, scope: RuleScope): unknown {
  if (typeof text !== 'string' || !text.includes('{{')) return text ?? ''
  const whole = /^\{\{\s*([\w.\-[\]$*]+)\s*\}\}$/.exec(text.trim())
  if (whole) {
    const v = ruleValue(whole[1], scope)
    return v === undefined ? null : v
  }
  return text.replace(TEMPLATE_RE, (_m, path: string) => textOf(ruleValue(path, scope)))
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'string' && !v.trim())
}

const text = (v: unknown) => (typeof v === 'boolean' ? String(v) : String(v ?? '').trim().toLowerCase())
function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && /^\s*-?\d+(?:\.\d+)?\s*$/.test(v)) return Number(v)
  return null
}
function asTime(v: unknown): number | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v)
  return Number.isNaN(t) ? null : t
}
function order(a: unknown, b: unknown): number | null {
  const na = asNumber(a); const nb = asNumber(b)
  if (na !== null && nb !== null) return na - nb
  const ta = asTime(a); const tb = asTime(b)
  if (ta !== null && tb !== null) return ta - tb
  if (blank(a) || blank(b)) return null
  return text(a).localeCompare(text(b))
}
function equal(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean' || ['true', 'false'].includes(text(b))) {
    const bool = (v: unknown) => (typeof v === 'boolean' ? v : ['true', '1', 'yes', 'on'].includes(text(v)) ? true : ['false', '0', 'no', 'off', ''].includes(text(v)) ? false : null)
    return bool(a) === bool(b)
  }
  const na = asNumber(a); const nb = asNumber(b)
  if (na !== null && nb !== null) return na === nb
  return text(a) === text(b)
}

/** One condition: subject `column`, operator, right side (a literal or a template). */
export function ruleConditionMet(cond: DataTableCondition, scope: RuleScope): boolean {
  let left = ruleValue(cond.column, scope)
  if (isChangeSet(left)) left = changeCount(left) || null
  const right = resolveRuleTemplate(cond.value ?? '', scope)
  const list = Array.isArray(left) ? left : null
  switch (cond.operator) {
    case 'is_set': return !blank(left)
    case 'is_not_set': return blank(left)
    case 'eq': return list ? list.some((v) => equal(v, right)) : equal(left, right)
    case 'neq': return list ? !list.some((v) => equal(v, right)) : !equal(left, right)
    case 'contains': return list ? list.some((v) => equal(v, right)) : text(left).includes(text(right))
    case 'starts_with': return text(left).startsWith(text(right))
    case 'in': {
      const options = (Array.isArray(right) ? right : String(right ?? '').split(',')).map((v) => text(v)).filter(Boolean)
      return list ? list.some((v) => options.includes(text(v))) : options.includes(text(left))
    }
    case 'gt': case 'gte': case 'lt': case 'lte': {
      const o = order(left, right)
      if (o === null) return false
      return cond.operator === 'gt' ? o > 0 : cond.operator === 'gte' ? o >= 0 : cond.operator === 'lt' ? o < 0 : o <= 0
    }
    default: return false
  }
}

/** A condition group; none → true. */
export function ruleConditionsMet(group: DataTableConditionGroup | undefined, scope: RuleScope): boolean {
  if (!group || !group.conditions.length) return true
  const results = group.conditions.map((c) => (isConditionGroup(c) ? ruleConditionsMet(c, scope) : ruleConditionMet(c, scope)))
  return group.match === 'any' ? results.some(Boolean) : results.every(Boolean)
}

// List column / row validations (lib/forms/list-field.ts) judge their conditions with this same evaluator.
registerListRuleJudge({ conditionsMet: ruleConditionsMet, template: resolveRuleTemplate })

/** Every path a group reads (subjects and placeholders). */
export function conditionPaths(group: DataTableConditionGroup | undefined): string[] {
  const out = new Set<string>()
  const walk = (g: DataTableConditionGroup) => {
    for (const c of g.conditions) {
      if (isConditionGroup(c)) { walk(c); continue }
      out.add(c.column)
      for (const m of String(c.value ?? '').matchAll(TEMPLATE_RE)) out.add(m[1])
    }
  }
  if (group) walk(group)
  return [...out]
}

/** event.* paths the server can rebuild from the submitted values (value / blur / label rules: the field and its value). */
function serverEventPaths(rule: Pick<FormRule, 'event'>): string[] {
  return rule.event === 'value_change' || rule.event === 'blur' || rule.event === 'label_change' ? ['event.field', 'event.value'] : []
}

/**
 * Can the server judge this rule's condition from the submitted values (no
 * other event context; the user only when `userKnown` — the server's own
 * view of the person, lib/services/form-rule-user.ts)?
 */
export function serverVerifiable(rule: Pick<FormRule, 'event' | 'if'>, userKnown = false): boolean {
  const allowed = serverEventPaths(rule)
  return conditionPaths(rule.if).every((p) => !(((p === 'user' || p.startsWith('user.')) && !userKnown) || ((p === 'event' || p.startsWith('event.')) && !allowed.includes(p))))
}

/** The scope the server judges a rule in (value / blur rules see their field's submitted value as event.value; `user`: the server's own). */
function serverScope(rule: FormRule, values: Record<string, unknown>, state: FormUiState | null, user: Record<string, unknown> | null = null): RuleScope {
  const event = rule.target && (rule.event === 'value_change' || rule.event === 'blur' || rule.event === 'label_change') ? { field: rule.target, value: values[rule.target] } : null
  return { values, state, event, user }
}

/* ── Declarative ("Always") rules ───────────────────────────────────── */

export interface AlwaysEffects {
  /** Targets hidden by Always rules. */
  hidden: Set<string>
  /** Targets disabled by Always rules. */
  disabled: Set<string>
  /** Targets Always rules make read only (FORM_WHOLE_TARGET included). */
  readOnly: Set<string>
  /** Target (`field:<key>` / `section:<key>`) → its style (conditional styling; merged in rule order, later wins per property). */
  styles: Map<string, ConditionalStyle>
}

/**
 * What Always rules do for these values: a "Show" target is hidden while
 * the condition does NOT hold, a "Hide" / "Toggle" target while it does;
 * likewise Enable / Disable and Read only / Editable. `user` is optional: a rule that reads the user
 * is skipped without one (the server: hides nothing it cannot judge, so the
 * field stays required).
 */
export function alwaysRuleEffects(layout: unknown, values: Record<string, unknown>, options: { user?: Record<string, unknown> | null; state?: FormUiState | null; rules?: FormRule[] } = {}): AlwaysEffects {
  const out: AlwaysEffects = { hidden: new Set(), disabled: new Set(), readOnly: new Set(), styles: new Map() }
  const rules = (options.rules ?? layoutFormRules(layout)).filter((r) => r.event === 'always' && !r.disabled)
  for (const rule of rules) {
    if (!options.user && conditionPaths(rule.if).some((p) => p.startsWith('user.'))) continue
    const met = ruleConditionsMet(rule.if, { values, user: options.user ?? null, state: options.state ?? null })
    for (const action of rule.then) {
      if (action.type === 'show_hide') {
        const hide = action.mode === 'show' ? !met : met
        if (hide) for (const t of action.targets ?? []) out.hidden.add(t)
      } else if (action.type === 'enable_disable') {
        const off = action.mode === 'enable' ? !met : met
        if (off) for (const t of action.targets ?? []) out.disabled.add(t)
      } else if (action.type === 'read_only') {
        const locked = action.mode === 'editable' ? !met : met
        if (locked) for (const t of action.targets ?? []) out.readOnly.add(t)
      } else if (action.type === 'set_style' && met) {
        // Presentation only: applied while the condition holds, gone when it stops.
        const style = actionStyle(action)
        if (style) for (const t of action.targets ?? []) out.styles.set(t, mergeStyles(out.styles.get(t), style)!)
      }
    }
  }
  return out
}

/** Field keys Always rules hide for these values (sections, rows and pages expanded). */
export function ruleHiddenFieldKeys(layout: unknown, fields: Array<{ key: string; type: string }>, values: Record<string, unknown>, options: { user?: Record<string, unknown> | null } = {}): Set<string> {
  const out = new Set<string>()
  if (!isPlainObject(layout) || !Array.isArray(layout.rules) || !layout.rules.length) return out
  const { hidden } = alwaysRuleEffects(layout, values, options)
  const boundaries = sectionBoundaryKeys(fields)
  for (const target of hidden) for (const key of targetFieldKeys(layout, target, boundaries)) out.add(key)
  return out
}

/**
 * What conditional styling draws for these values: each field's style (its
 * own targets, and a legacy heading-made section's, merged in rule order) and
 * each declared section's (drawn on the section's block). Read-only views
 * use it too — the condition is computable from the values.
 */
export function ruleStyles(layout: unknown, fields: Array<{ key: string; type: string }>, values: Record<string, unknown>, options: { user?: Record<string, unknown> | null; styles?: ReadonlyMap<string, ConditionalStyle> } = {}): { fields: Map<string, ConditionalStyle>; sections: Map<string, ConditionalStyle> } {
  const out = { fields: new Map<string, ConditionalStyle>(), sections: new Map<string, ConditionalStyle>() }
  if (!options.styles && (!isPlainObject(layout) || !Array.isArray(layout.rules) || !layout.rules.some((r) => isPlainObject(r) && r.event === 'always'))) return out
  const styles = options.styles ?? alwaysRuleEffects(layout, values, { user: options.user ?? null }).styles
  if (!styles.size) return out
  const declared = declaredSectionKeys(layout)
  const boundaries = sectionBoundaryKeys(fields)
  for (const [target, style] of styles) {
    const t = parseTarget(target)
    if (t?.kind === 'section' && declared.has(t.id)) { out.sections.set(t.id, style); continue }
    for (const key of targetFieldKeys(layout, target, boundaries)) out.fields.set(key, mergeStyles(out.fields.get(key), style)!)
  }
  return out
}

/**
 * Each field's conditional style for a flat read-only view (a submission's
 * detail): a declared section's style under the field's own (ruleStyles).
 */
export function flatFieldStyles(layout: unknown, fields: Array<{ key: string; type: string }>, values: Record<string, unknown>): Map<string, ConditionalStyle> {
  const { fields: own, sections } = ruleStyles(layout, fields, values)
  if (!sections.size) return own
  const out = new Map<string, ConditionalStyle>()
  for (const [key, style] of sections) for (const k of targetFieldKeys(layout, `section:${key}`)) out.set(k, mergeStyles(out.get(k), style)!)
  for (const [k, style] of own) out.set(k, mergeStyles(out.get(k), style)!)
  return out
}

/** Field keys disabled by targets (Always rules' and the state's), sections / rows / pages expanded. */
export function disabledFieldKeys(layout: unknown, fields: Array<{ key: string; type: string }>, targets: Iterable<string>): Set<string> {
  const out = new Set<string>()
  const boundaries = sectionBoundaryKeys(fields)
  for (const target of targets) for (const key of targetFieldKeys(layout, target, boundaries)) out.add(key)
  return out
}

/**
 * Field keys read only by targets (Always rules' and the state's): a
 * control is read only when it, its row, its section, its step / tab or the
 * whole form (FORM_WHOLE_TARGET) is. Buttons and display elements are never
 * read only (they hold no value).
 */
export function readOnlyFieldKeys(layout: unknown, fields: Array<{ key: string; type: string }>, targets: Iterable<string>): Set<string> {
  const out = new Set<string>()
  const list = [...targets]
  if (!list.length) return out
  const valueKeys = new Set(fields.filter((f) => !READ_ONLY_EXEMPT.has(f.type)).map((f) => f.key))
  if (list.includes(FORM_WHOLE_TARGET)) return valueKeys
  const boundaries = sectionBoundaryKeys(fields)
  for (const target of list) for (const key of targetFieldKeys(layout, target, boundaries)) if (valueKeys.has(key)) out.add(key)
  return out
}

/** Field types a read-only target passes over: buttons (actions, not values) and display elements. */
const READ_ONLY_EXEMPT: ReadonlySet<string> = new Set(['button', 'heading', 'divider', 'display_image', 'label'])

/**
 * Field keys the rules make read only for these values, as the server
 * judges it: Always rules recomputed, plus the (sanitized) state's targets.
 * Read-only fields are not required.
 */
export function ruleReadOnlyFieldKeys(layout: unknown, fields: Array<{ key: string; type: string }>, values: Record<string, unknown>, options: { user?: Record<string, unknown> | null; state?: FormUiState | null } = {}): Set<string> {
  const state = options.state ?? stateOf({ values })
  const fromState = state?.read_only ?? []
  const hasRules = isPlainObject(layout) && Array.isArray(layout.rules) && layout.rules.length > 0
  if (!hasRules && !fromState.length) return new Set()
  const always = hasRules ? alwaysRuleEffects(layout, values, { user: options.user ?? null }).readOnly : new Set<string>()
  return readOnlyFieldKeys(layout, fields, [...fromState, ...always])
}

/* ── Server checks ──────────────────────────────────────────────────── */

/**
 * The gate sanitizeFormState applies to event rules: a rule's hide / flag
 * claims count only when its condition holds for the submitted values (or
 * reads event / user context the server cannot rebuild — trusted like a
 * click).
 */
export function ruleClaimGate(values: Record<string, unknown>, state: FormUiState | null = null, user: Record<string, unknown> | null = null): (rule: { id?: string; event?: string; then?: unknown; if?: unknown }) => boolean {
  return (raw) => {
    const [rule] = normalizeFormRules([raw])
    if (!rule) return false
    // `user`: the server's own view of the person — a rule reading user.roles is then judged, not trusted.
    if (!serverVerifiable(rule, Boolean(user))) return true
    return ruleConditionsMet(rule.if, serverScope(rule, values, state, user))
  }
}

function interpolate(textValue: string | undefined, scope: RuleScope): string {
  const v = resolveRuleTemplate(textValue ?? '', scope)
  return Array.isArray(v) ? v.map(textOf).join(', ') : textOf(v)
}

export interface RuleValidationOptions {
  hiddenKeys?: ReadonlySet<string>
  state?: FormUiState | null
  user?: Record<string, unknown> | null
  /**
   * The bar buttons this submission counts as (the pressed one). A
   * Before-submit rule aimed at another button does not apply. Absent: not
   * known — every rule applies (the strict reading).
   */
  buttonIds?: readonly string[] | null
  /**
   * 'step': a step's Next — Before-submit rules only when they ask for it
   * (`step_check`), errors only on `stepKeys` (the step's fields), and a
   * form-level block only from such a rule. Default 'submit'.
   */
  phase?: 'submit' | 'step'
  stepKeys?: ReadonlySet<string>
}

/** Does a Before-submit rule apply to this press (its bar-button target; the step phase)? */
export function beforeSubmitApplies(rule: Pick<FormRule, 'event' | 'target' | 'step_check'>, options: Pick<RuleValidationOptions, 'buttonIds' | 'phase'>): boolean {
  if (rule.event !== 'before_submit') return true
  if (options.phase === 'step' && !rule.step_check) return false
  if (rule.target && options.buttonIds && !options.buttonIds.includes(rule.target)) return false
  return true
}

/**
 * The Validate rules the server re-checks at submit (and the browser's own
 * validation shows): for enabled rules on Always / Before submit / Value
 * changes / Loses focus whose condition the server can judge and holds, each
 * "Show an error on a field" puts its message on that field and each "Block
 * submit" on its field (else FORM_ERROR_KEY). Fields in `hiddenKeys` are
 * skipped (hidden fields are never checked). Before-submit rules respect
 * their bar-button target and the step phase (beforeSubmitApplies).
 */
export function ruleValidationErrors(layout: unknown, values: Record<string, unknown>, options: RuleValidationOptions = {}): Record<string, string> {
  const errors: Record<string, string> = {}
  const step = options.phase === 'step'
  for (const rule of layoutFormRules(layout)) {
    if (rule.disabled || !VALIDATED_EVENTS.has(rule.event)) continue
    if (!beforeSubmitApplies(rule, options)) continue
    const validates = rule.then.filter((a) => a.type === 'field_error' || a.type === 'block_submit')
    if (!validates.length) continue
    if (rule.target && options.hiddenKeys?.has(rule.target)) continue
    if (!serverVerifiable(rule, Boolean(options.user))) continue
    const scope = serverScope(rule, values, options.state ?? null, options.user ?? null)
    if (!ruleConditionsMet(rule.if, scope)) continue
    for (const action of validates) {
      const key = action.field ?? FORM_ERROR_KEY
      if (action.field && options.hiddenKeys?.has(action.field)) continue
      // A step's Next: only this step's fields; a form-level block only from a rule that asked to check the step.
      if (step && (action.field ? !options.stepKeys?.has(action.field) : !(rule.event === 'before_submit' && rule.step_check))) continue
      if (!errors[key]) errors[key] = interpolate(action.text, scope) || 'Check this value.'
    }
  }
  return errors
}

const sameValue = (a: unknown, b: unknown) => (blank(a) && blank(b)) || textOf(a) === textOf(b) || (Array.isArray(a) && Array.isArray(b) && a.map(textOf).join('\u0000') === b.map(textOf).join('\u0000'))

/** Can the server compute this assignment template itself (no event context, no expression; the user only when the server knows it)? */
function serverTemplate(template: string, rule: FormRule, userKnown = false): boolean {
  if (template.includes('{{=')) return false
  const allowed = serverEventPaths(rule)
  for (const m of template.matchAll(TEMPLATE_RE)) {
    const p = m[1]
    if (((p === 'user' || p.startsWith('user.')) && !userKnown) || ((p === 'event' || p.startsWith('event.')) && !allowed.includes(p))) return false
  }
  return true
}

/**
 * Read-only fields a rule may write (Set / Copy / Clear values): the
 * submitted values of `readOnlyKeys` the server accepts — a value equal to
 * the stored one, or one an enabled event rule of the saved form could have
 * produced: the rule assigns that field (in its actions or a question's
 * answers) and passes ruleClaimGate (its condition holds for the submitted
 * values, unless it reads context the server cannot rebuild). When the
 * server can compute the assignment it must produce exactly the sent value;
 * an assignment from the event / user / an expression is trusted like a
 * click — the same bound as `__form_state`. Anything else is dropped (the
 * stored value stays).
 */
export function ruleWrittenReadOnlyValues(layout: unknown, readOnlyKeys: readonly string[], values: Record<string, unknown>, stored: Record<string, unknown> = {}, state: FormUiState | null = null, user: Record<string, unknown> | null = null): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!readOnlyKeys.length) return out
  const gate = ruleClaimGate(values, state, user)
  const rules = layoutFormRules(layout).filter((r) => !r.disabled && r.event !== 'always' && r.event !== 'after_submit' && gate(r))
  for (const key of readOnlyKeys) {
    if (!Object.prototype.hasOwnProperty.call(values, key)) continue
    const sent = values[key]
    if (sameValue(sent, stored[key])) continue
    let trusted = false
    const candidates: unknown[] = []
    for (const rule of rules) {
      for (const a of allActions(rule.then)) {
        if ((a.type === 'set_values' || a.type === 'copy_values') && a.assign && Object.prototype.hasOwnProperty.call(a.assign, key)) {
          const template = a.assign[key]
          if (serverTemplate(template, rule, Boolean(user))) candidates.push(resolveRuleTemplate(template, serverScope(rule, values, state, user)))
          else trusted = true
        }
        if (a.type === 'clear_values' && a.fields?.includes(key)) candidates.push(null)
        // A read-only List filled by Add / Remove row rules: trusted like a click (the rows are checked like any value).
        if ((a.type === 'add_list_row' || a.type === 'remove_list_row' || a.type === 'clear_list' || a.type === 'update_list_row') && a.list_field === key) trusted = true
        // …and one the editable table rules fill (New row, Set row values, Commit, Discard, Delete).
        if ((a.type === 'new_row' || a.type === 'set_row_values' || a.type === 'commit_row' || a.type === 'discard_row' || a.type === 'revert_row' || a.type === 'delete_row') && a.field === key) trusted = true
        // …and one whose rows are edited in a pop-out a rule opens (a new row included).
        if (a.type === 'open_row_form' && a.field === key) trusted = true
        // A read-only field a data / API step's result fills (written by the server's mapping, sent back by the browser).
        if ((a.outputs ?? []).some((o) => o.to === key && o.as !== 'options') || Object.values(a.results ?? {}).includes(key)) trusted = true
        if (a.type === 'add_list_row' && (a.clear_fields ?? []).includes(key)) candidates.push(null)
      }
    }
    if (trusted || candidates.some((c) => sameValue(c, sent))) out[key] = sent
  }
  return out
}

/**
 * After submit: the actions of enabled After-submit rules (for this bar
 * button, or any) whose condition holds for the stored values, as bar-button
 * actions (message, redirect, start workflow, apply table changes) the
 * submission pipeline runs after its own (lib/services/form-submissions.ts).
 */
export function afterSubmitActions(layout: unknown, buttonId: string | null | undefined, values: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  for (const rule of layoutFormRules(layout)) {
    if (rule.disabled || rule.event !== 'after_submit') continue
    if (rule.target && rule.target !== buttonId) continue
    if (!serverVerifiable(rule) || !ruleConditionsMet(rule.if, { values })) continue
    for (const action of rule.then) {
      if (action.type === 'message') out.push({ type: 'message', text: interpolate(action.text, { values }), ...(action.tone === 'success' ? {} : { tone: 'info' }) })
      else if (action.type === 'open_link' && action.url) out.push({ type: 'redirect', url: action.url })
      else if (action.type === 'start_workflow' && action.workflow_id) out.push({ type: 'start_workflow', workflow_id: action.workflow_id, ...(action.workflow_name ? { workflow_name: action.workflow_name } : {}), ...(action.inputs ? { inputs: action.inputs } : {}), ...(action.allow_anonymous ? { allow_anonymous: true } : {}) })
      else if (action.type === 'apply_table_changes' && action.table_changes) out.push({ type: 'apply_table_changes', table_changes: action.table_changes, ...(action.allow_anonymous ? { allow_anonymous: true } : {}) })
    }
  }
  return out
}

/** Workflows the rules start (save-time permission check, dependencies). */
export function ruleWorkflowIds(layout: unknown): string[] {
  const out = new Set<string>()
  for (const rule of layoutFormRules(layout)) {
    for (const a of allActions(rule.then)) {
      if (a.type === 'start_workflow' && a.workflow_id) out.add(a.workflow_id)
      if (a.type === 'apply_table_changes' && a.table_changes?.target === 'workflow' && a.table_changes.workflow_id) out.add(a.table_changes.workflow_id)
    }
  }
  return [...out]
}

/**
 * A server action of a saved rule (POST /api/internal/forms/rule-action), or
 * null: by index, or — inside a question's response ("If Yes → …") — by the
 * question's index plus { response, index }. Only actions the saved form
 * declares are reachable; a forged response that is not one of the
 * question's buttons, or a step that is not a server step, reaches nothing.
 */
export function findServerRuleAction(layout: unknown, ruleId: string, index: number, branch?: ActionBranch | null): { rule: FormRule; action: FieldButtonAction } | null {
  const rule = layoutFormRules(layout).find((r) => r.id === ruleId && !r.disabled)
  const action = rule ? actionAt(rule.then, index, branch) : null
  if (!rule || !action || !isServerRuleAction(action)) return null
  return { rule, action }
}

/* ── Matching events (runtime) ──────────────────────────────────────── */

export interface RuleEvent {
  type: FormRuleEventType
  /** The field / button / table / lookup / page / flag it happened on. */
  target?: string
  /** {{event.*}} context. */
  context?: Record<string, unknown>
}

/** The enabled rules an event runs, in list order. */
export function rulesForEvent(rules: FormRule[], event: RuleEvent): FormRule[] {
  return rules.filter((r) => !r.disabled && r.event === event.type && (!r.target || r.target === event.target))
}

/* ── Problems (designer / save) ─────────────────────────────────────── */

export interface RuleKnown {
  fieldKeys: ReadonlySet<string>
  /** Value fields that may be set. */
  valueKeys: ReadonlySet<string>
  fieldTypes: ReadonlyMap<string, string>
  headingKeys?: ReadonlySet<string>
  pageIds: ReadonlySet<string>
  flags: ReadonlySet<string>
  barButtons?: Array<{ id: string; kind: string }> | null
  /** Declared form variables (Set a variable, API results into var.<name>). */
  variables?: ReadonlySet<string>
  /** Names of the form's questions (Ask a question → its name), for "A question is answered". */
  messageIds?: ReadonlySet<string>
  /** Declared sections (layout.sections). */
  sectionKeys?: ReadonlySet<string>
  /** Fields Set / Copy / Clear values may write (inputs plus read-only value fields); default valueKeys. */
  writableKeys?: ReadonlySet<string>
  /** Each List's nested List paths (`lines`, `lines.serials`): a step's `child` must be one. */
  listChildren?: ReadonlyMap<string, ReadonlySet<string>>
}

/** A nested List step's problem (null = fine): `child` on a List that has that nested List. */
function nestedStepProblem(a: FieldButtonAction, label: string, known: RuleKnown): string | null {
  if (!a.child) return null
  const list = a.list_field ?? a.field
  if (!list || known.fieldTypes.get(list) !== 'list') return `${label}: nested lists are for List fields`
  const paths = known.listChildren?.get(list)
  if (paths && !paths.has(a.child)) return `${label}: "${a.child}" is not a nested list of ${list}`
  return null
}

/** A `section:<key>` / `page:<id>` target the form declares. */
function partKnown(target: string, known: RuleKnown): boolean {
  const t = parseTarget(target)
  return t?.kind === 'page' ? known.pageIds.has(t.id) : t?.kind === 'section' ? Boolean(known.sectionKeys?.has(t.id)) : false
}

/** Problems of a native rule (null = fine). */
export function formRuleProblem(rule: FormRule, known: RuleKnown): string | null {
  const kind = EVENT_TARGET[rule.event]
  if (rule.target) {
    const type = known.fieldTypes.get(rule.target)
    if (kind === 'field' && !known.valueKeys.has(rule.target) && !known.fieldKeys.has(rule.target)) return `When: "${rule.target}" is not a field of this form`
    if (kind === 'button' && type !== 'button') return `When: "${rule.target}" is not a button on this form`
    if (kind === 'table' && type !== 'data_table') return `When: "${rule.target}" is not a Data table on this form`
    if (kind === 'lookup' && type !== 'lookup') return `When: "${rule.target}" is not an autocomplete on this form`
    if (kind === 'page' && !known.pageIds.has(rule.target)) return `When: "${rule.target}" is not a step / tab of this form`
    if (kind === 'flag' && !known.flags.has(rule.target)) return `When: the state flag "${rule.target}" is not declared`
    if (kind === 'bar_button' && known.barButtons && !known.barButtons.some((b) => b.id === rule.target)) return `When: "${rule.target}" is not a button of the form's bar`
    if (kind === 'message' && known.messageIds && !known.messageIds.has(rule.target)) return `When: no question on this form is named "${rule.target}"`
    if (kind === 'section' && !known.sectionKeys?.has(rule.target)) return `When: "${rule.target}" is not a section of this form`
    if (kind === 'label' && type !== 'label') return `When: "${rule.target}" is not a Label on this form`
    if (kind === 'list' && type !== 'list') return `When: "${rule.target}" is not a List on this form`
    if (kind === 'rows' && type !== 'list' && type !== 'data_table') return `When: "${rule.target}" is not a List or Data table on this form`
    if (kind === 'part' && !partKnown(rule.target, known)) return `When: "${rule.target}" is not a section or step / tab of this form`
  } else if (kind === 'field' || kind === 'button' || kind === 'table' || kind === 'lookup' || kind === 'label' || kind === 'list' || kind === 'rows') {
    return `When: choose the ${kind === 'table' ? 'Data table' : kind === 'lookup' ? 'autocomplete' : kind === 'label' ? 'Label' : kind === 'list' ? 'List' : kind === 'rows' ? 'List or Data table' : kind}`
  }
  if (!rule.then.length) return 'Then: add at least one action'
  if (rule.event === 'always') {
    const bad = rule.then.find((a) => !ALWAYS_ACTIONS.has(a.type))
    if (bad) return `"Always" rules can only show / hide, enable / disable, make read only, style or show errors ("${RULE_ACTION_LABELS[bad.type]}" needs an event)`
    if (conditionPaths(rule.if).some((p) => p.startsWith('event.'))) return '"Always" rules have no event to read'
  }
  if (rule.event !== 'always') {
    const only = allActions(rule.then).find((a) => ALWAYS_ONLY_ACTIONS.has(a.type))
    if (only) return `"${RULE_ACTION_LABELS[only.type]}" works in "Always" rules (the style follows the condition, and goes when it stops)`
  }
  if (rule.event === 'after_submit') {
    const bad = rule.then.find((a) => !AFTER_SUBMIT_ACTIONS.has(a.type))
    if (bad) return `After submit runs on the server: "${RULE_ACTION_LABELS[bad.type]}" is not available there (use message, open link, start workflow or apply table changes)`
  }
  if (rule.event !== 'before_submit' && rule.event !== 'always' && rule.then.some((a) => a.type === 'block_submit') && !VALIDATED_EVENTS.has(rule.event)) return '"Block submit" belongs to Before submit, Always, Value changes or Loses focus rules'
  if (rule.event === 'before_submit' && allActions(rule.then).some((a) => a.type === 'submit')) return 'Before submit: a Submit action would submit again — let the answer continue instead (Yes / OK continues the submission)'
  for (const a of allActions(rule.then)) {
    switch (a.type) {
      case 'prompt':
        if (!a.text && !a.title) return 'Ask a question: write the question'
        break
      case 'show_hide':
      case 'enable_disable':
        if (!a.targets?.length) return `${RULE_ACTION_LABELS[a.type]}: choose what it applies to`
        for (const target of a.targets) {
          const t = parseTarget(target)!
          if (t.kind === 'section' && known.sectionKeys?.has(t.id)) continue
          if (t.kind === 'page' ? !known.pageIds.has(t.id) : !known.fieldKeys.has(t.id)) return `${RULE_ACTION_LABELS[a.type]}: "${t.id}" is not on this form`
          if (t.kind === 'section' && known.headingKeys && !known.headingKeys.has(t.id)) return `A section starts at a Section heading ("${t.id}" is not one)`
        }
        break
      case 'read_only':
        if (!a.targets?.length) return 'Make read only: choose what it applies to'
        for (const target of a.targets) {
          if (target === FORM_WHOLE_TARGET) continue
          const t = parseTarget(target)!
          if (t.kind === 'section' && known.sectionKeys?.has(t.id)) continue
          if (t.kind === 'page' ? !known.pageIds.has(t.id) : !known.fieldKeys.has(t.id)) return `Make read only: "${t.id}" is not on this form`
          if (t.kind === 'section' && known.headingKeys && !known.headingKeys.has(t.id)) return `A section starts at a Section heading ("${t.id}" is not one)`
          if (t.kind === 'field' && known.fieldTypes.get(t.id) === 'button') return `Make read only: "${t.id}" is a button — use Enable / disable for buttons`
          if (t.kind === 'field' && READ_ONLY_EXEMPT.has(known.fieldTypes.get(t.id) ?? '')) return `Make read only: "${t.id}" holds no value`
        }
        break
      case 'set_style':
        if (!a.targets?.length) return 'Style: choose the fields or sections it applies to'
        for (const target of a.targets) {
          const t = parseTarget(target)!
          if (t.kind === 'section' && known.sectionKeys?.has(t.id)) continue
          if (t.kind === 'section' && known.headingKeys ? !known.headingKeys.has(t.id) : !known.fieldKeys.has(t.id)) return t.kind === 'section' ? `Style: "${t.id}" is not a section of this form` : `Style: "${t.id}" is not on this form`
        }
        if (!actionStyle(a)) return 'Style: choose a colour or an emphasis (bold, italic…)'
        break
      case 'collapse_expand':
        if (!a.targets?.length) return 'Collapse / expand: choose the section'
        for (const target of a.targets) {
          const t = parseTarget(target)
          if (t?.kind !== 'section' || !known.sectionKeys?.has(t.id)) return `Collapse / expand: "${t?.id ?? target}" is not a section of this form`
        }
        break
      case 'load_part':
        if (!a.targets?.length) return 'Load section / tab: choose what it loads'
        for (const target of a.targets) if (!partKnown(target, known)) return `Load section / tab: "${parseTarget(target)?.id ?? target}" is not a section or step / tab of this form`
        break
      case 'set_state':
        if (!a.flag) return 'Set a flag: name the flag'
        if (!known.flags.has(a.flag)) return `The state flag "${a.flag}" is not declared (Buttons & header → Form state)`
        break
      case 'go_to_page':
        if (!a.page || !known.pageIds.has(a.page)) return 'Go to: choose the step / tab'
        break
      case 'set_values':
      case 'copy_values': {
        const keys = Object.keys(a.assign ?? {})
        if (!keys.length) return `${RULE_ACTION_LABELS[a.type]}: choose a field`
        const unknown = keys.find((k) => !(known.writableKeys ?? known.valueKeys).has(k))
        if (unknown) return `${RULE_ACTION_LABELS[a.type]}: "${unknown}" is not an input on this form`
        break
      }
      case 'clear_values': {
        if (!a.fields?.length) return 'Clear fields: choose the fields'
        const unknown = a.fields.find((k) => !(known.writableKeys ?? known.valueKeys).has(k))
        if (unknown) return `Clear fields: "${unknown}" is not an input on this form`
        break
      }
      case 'field_error':
        if (!a.field || !known.fieldKeys.has(a.field)) return 'Show an error: choose the field'
        break
      case 'refresh':
        if (!a.field || !['data_table', 'lookup'].includes(known.fieldTypes.get(a.field) ?? '')) return 'Refresh: choose a Data table or autocomplete'
        break
      case 'run_lookup':
        if (!a.field || known.fieldTypes.get(a.field) !== 'lookup') return 'Run a lookup: choose an autocomplete'
        break
      case 'call_reference':
        if (!a.reference_id) return 'Call an API reference: choose the reference'
        { const bad = outputTargetProblem(a, known); if (bad) return `${RULE_ACTION_LABELS[a.type]}: ${bad}` }
        if (a.wait === false && (a.outputs?.length || a.on_success?.length || Object.keys(a.results ?? {}).length)) return `${RULE_ACTION_LABELS[a.type]}: a call that doesn't wait has no response to map — turn waiting on, or remove the outputs / on-success steps`
        for (const key of Object.values(a.results ?? {})) {
          if (key.startsWith('var.') ? !known.variables?.has(key.slice(4)) : !known.valueKeys.has(key)) return `Call an API reference: "${key}" is not ${key.startsWith('var.') ? 'a variable of' : 'an input on'} this form`
          if (['data_table', 'attachments', 'image', 'signature'].includes(known.fieldTypes.get(key) ?? '')) return `Call an API reference: "${key}" can't take a value from the response`
        }
        break
      case 'start_workflow':
        if (!a.workflow_id) return 'Start a workflow: choose the workflow'
        break
      case 'set_variable':
        if (!a.variable) return 'Set a variable: choose the variable'
        if (!known.variables?.has(a.variable)) return `Set a variable: "${a.variable}" is not a variable of this form (Data → Variables)`
        break
      case 'apply_table_changes':
        if (!a.table_changes?.field || known.fieldTypes.get(a.table_changes.field) !== 'data_table') return 'Apply table changes: choose the editable Data table'
        break
      case 'table_read':
      case 'table_list':
      case 'table_create':
      case 'table_update':
      case 'table_delete': {
        const label = RULE_ACTION_LABELS[a.type]
        if (!a.table_id) return `${label}: choose the data table`
        if ((a.type === 'table_create' || a.type === 'table_update') && !Object.keys(a.column_values ?? {}).length) return `${label}: set at least one column`
        if ((a.type === 'table_read' || a.type === 'table_update') && !a.row_id && !a.filter) return `${label}: give a row id or a filter`
        if (a.type === 'table_delete' && !a.row_id) return `${label}: give the row id (e.g. {{row.row_id}})`
        const bad = outputTargetProblem(a, known)
        if (bad) return `${label}: ${bad}`
        break
      }
      case 'open_row_form': {
        const label = RULE_ACTION_LABELS[a.type]
        if (!a.field || known.fieldTypes.get(a.field) !== 'list') return `${label}: choose the List`
        { const nested = nestedStepProblem(a, label, known); if (nested) return nested }
        break
      }
      case 'new_row':
      case 'set_row_values':
      case 'commit_row':
      case 'discard_row':
      case 'revert_row':
      case 'delete_row':
      case 'refresh_table': {
        const label = RULE_ACTION_LABELS[a.type]
        const type = a.field ? known.fieldTypes.get(a.field) : undefined
        if (a.type === 'refresh_table') { if (type !== 'data_table') return `${label}: choose the Data table`; break }
        if (type !== 'list' && type !== 'data_table') return `${label}: choose the List or editable Data table`
        if (a.type === 'set_row_values' && !Object.keys(a.values ?? {}).length) return `${label}: set at least one column`
        if (a.commit_mode === 'save_now' && type !== 'data_table') return `${label}: "Save now" is for a Data table (a List's rows are saved with the submission)`
        { const nested = nestedStepProblem(a, label, known); if (nested) return nested }
        break
      }
      case 'add_list_row':
      case 'remove_list_row':
      case 'update_list_row':
      case 'edit_list_row':
      case 'cancel_list_edit':
      case 'clear_list': {
        const label = RULE_ACTION_LABELS[a.type]
        if (!a.list_field || known.fieldTypes.get(a.list_field) !== 'list') return `${label}: choose the List field`
        { const nested = nestedStepProblem(a, label, known); if (nested) return nested }
        if (a.type !== 'add_list_row') break
        if (!Object.keys(a.values ?? {}).length) return `${label}: map at least one column to a value`
        const bad = [...(a.require ?? []), ...(a.clear_fields ?? [])].find((k) => !known.valueKeys.has(k))
        if (bad) return `${label}: "${bad}" is not an input on this form`
        break
      }
      default:
        break
    }
  }
  return null
}

/* ── The unified list (Rules tab) ───────────────────────────────────── */

interface FieldShape {
  key: string
  label?: string
  type: string
  required?: boolean
  visible_when?: { field: string; operator: string; value?: string }
  button?: { actions?: FieldButtonAction[]; disabled_when?: { field: string; operator: string; value?: string } } & Record<string, unknown>
  /** List / Data table columns (the editable table rules' summaries and read-only warnings). */
  list?: ListFieldConfig
  data_table?: { mode?: string; columns?: Array<{ key: string; label?: string; read_only?: boolean; hidden?: boolean }> } & Record<string, unknown>
}
interface PageShape { id: string; title?: string; visible_when?: { field: string; operator: string; value?: string } }
interface BarButtonShape { id: string; label: string; kind: string; actions?: Array<Record<string, unknown>> }
export interface RulesDefinition {
  fields: FieldShape[]
  layout: Record<string, unknown> & { rules?: unknown; pages?: PageShape[]; mode?: string; state?: { hidden?: string[]; flags?: Array<{ key: string }> } }
  buttons?: BarButtonShape[] | null
}

export type RuleHome =
  | { kind: 'rules'; id: string }
  | { kind: 'visible_when'; field: string }
  | { kind: 'page_visible_when'; page: string }
  | { kind: 'disabled_when'; field: string }
  | { kind: 'button_click'; field: string }
  | { kind: 'bar_button'; button: string }
  | { kind: 'start_hidden' }

export interface UnifiedRule {
  key: string
  home: RuleHome
  /** Where it lives ("Rules", "Field: Email · Visible when"…). */
  badge: string
  rule: FormRule
  /** Bar-button behaviours (their own action types: success screen, redirect…), shown as is. */
  barActions?: Array<Record<string, unknown>>
}

const VW_TO_OP: Record<string, DataTableOperator> = { equals: 'eq', not_equals: 'neq', is_set: 'is_set', is_not_set: 'is_not_set', contains: 'contains' }
const OP_TO_VW: Partial<Record<DataTableOperator, string>> = { eq: 'equals', neq: 'not_equals', is_set: 'is_set', is_not_set: 'is_not_set', contains: 'contains' }

function vwGroup(vw: { field: string; operator: string; value?: string }): DataTableConditionGroup {
  const operator = VW_TO_OP[vw.operator] ?? 'eq'
  return { match: 'all', conditions: [{ column: vw.field, operator, ...(operator === 'is_set' || operator === 'is_not_set' ? {} : { value: vw.value ?? '' }) }] }
}

/** A group a single `visible_when` can hold, or null. */
function groupAsVisibleWhen(group: DataTableConditionGroup | undefined): { field: string; operator: string; value?: string } | null | undefined {
  if (!group || !group.conditions.length) return undefined
  if (group.conditions.length !== 1 || isConditionGroup(group.conditions[0])) return null
  const c = group.conditions[0]
  const operator = OP_TO_VW[c.operator]
  if (!operator || c.column.startsWith('event.') || c.column.startsWith('user.') || String(c.value ?? '').includes('{{')) return null
  if (c.column.includes('.') && !stateRuleFlag(c.column)) return null
  return { field: c.column, operator, ...(c.operator === 'is_set' || c.operator === 'is_not_set' ? {} : { value: c.value ?? '' }) }
}

function fieldName(def: RulesDefinition, key: string): string {
  const f = def.fields.find((x) => x.key === key)
  return f?.label || key
}

/** Every rule of the form — native and legacy — in one list. */
export function collectFormRules(def: RulesDefinition): UnifiedRule[] {
  const out: UnifiedRule[] = []
  for (const rule of normalizeFormRules(def.layout?.rules)) out.push({ key: `rules:${rule.id}`, home: { kind: 'rules', id: rule.id }, badge: 'Rules', rule })
  for (const f of def.fields) {
    if (f.visible_when) {
      out.push({
        key: `vw:${f.key}`, home: { kind: 'visible_when', field: f.key }, badge: `Field: ${f.label || f.key} · Visible when`,
        rule: { id: `vw_${f.key}`, name: `Show ${f.label || f.key}`, event: 'always', if: vwGroup(f.visible_when), then: [{ type: 'show_hide', mode: 'show', targets: [`field:${f.key}`] }] },
      })
    }
    if (f.type === 'button' && f.button?.disabled_when) {
      out.push({
        key: `dw:${f.key}`, home: { kind: 'disabled_when', field: f.key }, badge: `Button: ${f.label || f.key} · Disabled when`,
        rule: { id: `dw_${f.key}`, name: `Disable ${f.label || f.key}`, event: 'always', if: vwGroup(f.button.disabled_when), then: [{ type: 'enable_disable', mode: 'disable', targets: [`field:${f.key}`] }] },
      })
    }
    if (f.type === 'button' && f.button?.actions?.length) {
      out.push({
        key: `btn:${f.key}`, home: { kind: 'button_click', field: f.key }, badge: `Button: ${f.label || f.key} · On click`,
        rule: { id: `btn_${f.key}`, name: `${f.label || f.key} clicked`, event: 'button_click', target: f.key, then: f.button.actions },
      })
    }
  }
  for (const page of Array.isArray(def.layout?.pages) && (def.layout.mode === 'steps' || def.layout.mode === 'tabs') ? def.layout.pages : []) {
    if (!page.visible_when) continue
    out.push({
      key: `pvw:${page.id}`, home: { kind: 'page_visible_when', page: page.id }, badge: `${def.layout.mode === 'tabs' ? 'Tab' : 'Step'}: ${page.title || page.id} · Shown when`,
      rule: { id: `pvw_${page.id}`, name: `Show ${page.title || page.id}`, event: 'always', if: vwGroup(page.visible_when), then: [{ type: 'show_hide', mode: 'show', targets: [`page:${page.id}`] }] },
    })
  }
  const startHidden = def.layout?.state?.hidden ?? []
  if (startHidden.length) {
    out.push({
      key: 'start_hidden', home: { kind: 'start_hidden' }, badge: 'Form state · Starts hidden',
      rule: { id: 'start_hidden', name: 'Hidden when the form opens', event: 'form_load', then: [{ type: 'show_hide', mode: 'hide', targets: [...startHidden] }] },
    })
  }
  for (const b of def.buttons ?? []) {
    if ((b.kind !== 'submit' && b.kind !== 'outcome') || !b.actions?.length) continue
    out.push({
      key: `bar:${b.id}`, home: { kind: 'bar_button', button: b.id }, badge: `Buttons & header: ${b.label}`,
      rule: { id: `bar_${b.id}`, name: `After "${b.label}"`, event: 'after_submit', target: b.id, then: [] },
      barActions: b.actions,
    })
  }
  return out
}

function withoutKey<T extends object>(obj: T, key: string): T {
  const out = { ...obj } as Record<string, unknown>
  delete out[key]
  return out as T
}

/** Add / replace a native rule on the definition's layout. */
function putNative(def: RulesDefinition, rule: FormRule, replaceId?: string): RulesDefinition {
  const rules = normalizeFormRules(def.layout?.rules)
  const at = rules.findIndex((r) => r.id === (replaceId ?? rule.id))
  if (at >= 0) rules[at] = rule
  else rules.push(rule)
  return { ...def, layout: { ...def.layout, rules } }
}

/** Is this rule still expressible in its home? (Visibility: one plain condition, the same single target; clicks: no condition.) */
function fitsHome(home: RuleHome, rule: FormRule): boolean {
  const single = (type: string, mode: string, target: string) => rule.then.length === 1 && rule.then[0].type === type && rule.then[0].mode === mode && rule.then[0].targets?.length === 1 && rule.then[0].targets[0] === target
  switch (home.kind) {
    case 'rules': return true
    case 'visible_when': return rule.event === 'always' && !rule.disabled && groupAsVisibleWhen(rule.if) !== null && single('show_hide', 'show', `field:${home.field}`)
    case 'page_visible_when': return rule.event === 'always' && !rule.disabled && groupAsVisibleWhen(rule.if) !== null && single('show_hide', 'show', `page:${home.page}`)
    case 'disabled_when': return rule.event === 'always' && !rule.disabled && groupAsVisibleWhen(rule.if) !== null && single('enable_disable', 'disable', `field:${home.field}`)
    case 'button_click': return rule.event === 'button_click' && rule.target === home.field && !rule.if && !rule.disabled && allActions(rule.then).every((a) => !['enable_disable', 'read_only', 'field_error', 'block_submit', 'copy_values', 'refresh', 'run_lookup', 'call_reference', 'start_workflow'].includes(a.type))
    case 'start_hidden': return rule.event === 'form_load' && !rule.if && !rule.disabled && rule.then.length === 1 && rule.then[0].type === 'show_hide' && rule.then[0].mode === 'hide'
    case 'bar_button': return false
  }
}

/** Remove a rule from where it lives. */
export function removeUnifiedRule(def: RulesDefinition, home: RuleHome): RulesDefinition {
  switch (home.kind) {
    case 'rules':
      return { ...def, layout: { ...def.layout, rules: normalizeFormRules(def.layout?.rules).filter((r) => r.id !== home.id) } }
    case 'visible_when':
      return { ...def, fields: def.fields.map((f) => (f.key === home.field ? withoutKey(f, 'visible_when') : f)) }
    case 'page_visible_when':
      return { ...def, layout: { ...def.layout, pages: (def.layout.pages ?? []).map((p) => (p.id === home.page ? withoutKey(p, 'visible_when') : p)) } }
    case 'disabled_when':
      return { ...def, fields: def.fields.map((f) => (f.key === home.field && f.button ? { ...f, button: withoutKey(f.button, 'disabled_when') } : f)) }
    case 'button_click':
      return { ...def, fields: def.fields.map((f) => (f.key === home.field && f.button ? { ...f, button: { ...f.button, actions: [] } } : f)) }
    case 'start_hidden': {
      const state = withoutKey(def.layout.state ?? {}, 'hidden')
      return { ...def, layout: Object.keys(state).length ? { ...def.layout, state } : withoutKey(def.layout, 'state') }
    }
    case 'bar_button':
      return { ...def, buttons: (def.buttons ?? []).map((b) => (b.id === home.button ? withoutKey(b, 'actions') : b)) }
  }
}

/**
 * Write an edited rule back to where it lives. When it no longer fits
 * there (AND / OR groups or a template on a visibility rule, a condition on
 * a button click, another target…) it moves into layout.rules: the old
 * place is cleared and a native rule takes over — same behaviour, nothing
 * lost. Returns the definition and the rule's home afterwards.
 */
export function writeUnifiedRule(def: RulesDefinition, home: RuleHome, rule: FormRule): { def: RulesDefinition; home: RuleHome } {
  if (home.kind === 'rules') return { def: putNative(def, rule, home.id), home }
  if (!fitsHome(home, rule)) {
    const ids = normalizeFormRules(def.layout?.rules).map((r) => r.id)
    const moved: FormRule = { ...rule, id: newRuleId(ids) }
    return { def: putNative(removeUnifiedRule(def, home), moved), home: { kind: 'rules', id: moved.id } }
  }
  const vw = groupAsVisibleWhen(rule.if)
  switch (home.kind) {
    case 'visible_when':
      return { def: { ...def, fields: def.fields.map((f) => (f.key === home.field ? (vw ? { ...f, visible_when: vw } : withoutKey(f, 'visible_when')) : f)) }, home }
    case 'page_visible_when':
      return { def: { ...def, layout: { ...def.layout, pages: (def.layout.pages ?? []).map((p) => (p.id === home.page ? (vw ? { ...p, visible_when: vw } : withoutKey(p, 'visible_when')) : p)) } }, home }
    case 'disabled_when':
      return { def: { ...def, fields: def.fields.map((f) => (f.key === home.field && f.button ? { ...f, button: vw ? { ...f.button, disabled_when: vw } : withoutKey(f.button, 'disabled_when') } : f)) }, home }
    case 'button_click':
      return { def: { ...def, fields: def.fields.map((f) => (f.key === home.field && f.button ? { ...f, button: { ...f.button, actions: rule.then } } : f)) }, home }
    case 'start_hidden': {
      const hidden = [...new Set(rule.then[0].targets ?? [])]
      const state = { ...(def.layout.state ?? {}), hidden }
      return { def: { ...def, layout: { ...def.layout, state: hidden.length ? state : withoutKey(state, 'hidden') } }, home }
    }
    default:
      return { def, home }
  }
}

/** Move a native rule to another position (drag to reorder). */
export function moveNativeRule(def: RulesDefinition, id: string, toIndex: number): RulesDefinition {
  const rules = normalizeFormRules(def.layout?.rules)
  const from = rules.findIndex((r) => r.id === id)
  if (from < 0) return def
  const [rule] = rules.splice(from, 1)
  rules.splice(Math.max(0, Math.min(rules.length, toIndex)), 0, rule)
  return { ...def, layout: { ...def.layout, rules } }
}

/** A copy of any rule as a new native rule (right after the original when native). */
export function duplicateRule(def: RulesDefinition, unified: UnifiedRule): { def: RulesDefinition; id: string } {
  const rules = normalizeFormRules(def.layout?.rules)
  const id = newRuleId(rules.map((r) => r.id))
  const copy: FormRule = { ...JSON.parse(JSON.stringify(unified.rule)) as FormRule, id, name: `${unified.rule.name || 'Rule'} (copy)` }
  const at = unified.home.kind === 'rules' ? rules.findIndex((r) => r.id === (unified.home as { id: string }).id) + 1 : rules.length
  rules.splice(at, 0, copy)
  return { def: { ...def, layout: { ...def.layout, rules } }, id }
}

/* ── Conflicts and descriptions ─────────────────────────────────────── */

/** What an action sets ("visibility:field:x", "value:x", "flag:x"…) — for conflict notes. */
function effectKeys(action: FieldButtonAction): string[] {
  switch (action.type) {
    case 'show_hide': return (action.targets ?? []).map((t) => `visibility:${t}`)
    case 'enable_disable': return (action.targets ?? []).map((t) => `enabled:${t}`)
    case 'collapse_expand': return (action.targets ?? []).map((t) => `collapsed:${t}`)
    case 'read_only': return (action.targets ?? []).map((t) => `readonly:${t}`)
    case 'set_style': return (action.targets ?? []).map((t) => `style:${t}`)
    case 'load_part': return []
    case 'set_values': case 'copy_values': return Object.keys(action.assign ?? {}).map((k) => `value:${k}`)
    case 'clear_values': return (action.fields ?? []).map((k) => `value:${k}`)
    case 'add_list_row': case 'remove_list_row': case 'clear_list': case 'update_list_row': return action.list_field ? [`rows:${action.list_field}`] : []
    case 'new_row': case 'set_row_values': case 'commit_row': case 'discard_row': case 'revert_row': case 'delete_row': return action.field ? [`rows:${action.field}`] : []
    case 'open_row_form': return action.field && String(action.row ?? '').trim().toLowerCase() === 'new' ? [`rows:${action.field}`] : []
    case 'edit_list_row': return Object.keys(action.assign ?? {}).map((k) => `value:${k}`)
    case 'cancel_list_edit': return (action.fields ?? []).map((k) => `value:${k}`)
    case 'call_reference': case 'table_read': case 'table_list': case 'table_create': case 'table_update': case 'table_delete':
      return (action.outputs ?? []).map((o) => (o.as === 'options' ? `options:${o.to}` : o.to.startsWith('var.') ? `var:${o.to.slice(4)}` : `value:${o.to}`))
    case 'set_state': return action.flag ? [`flag:${action.flag}`] : []
    default: return []
  }
}

function effectName(def: RulesDefinition, key: string): string {
  const [kind, ...rest] = key.split(':')
  const target = rest.join(':')
  if (kind === 'flag') return `the flag state.${target}`
  if (kind === 'value') return `the value of ${fieldName(def, target)}`
  if (kind === 'rows') return `the rows of ${fieldName(def, target)}`
  const t = parseTarget(target)
  const thing = target === FORM_WHOLE_TARGET ? 'the whole form' : t ? (t.kind === 'page' ? `step / tab ${(def.layout.pages ?? []).find((p) => p.id === t.id)?.title ?? t.id}` : t.kind === 'section' && sectionTitle(def, t.id) ? `section ${sectionTitle(def, t.id)}` : `${t.kind === 'field' ? '' : `${t.kind} of `}${fieldName(def, t.id)}`) : target
  if (kind === 'style') return `the style of ${thing}`
  return kind === 'visibility' ? `whether ${thing} shows` : kind === 'collapsed' ? `whether ${thing} is collapsed` : kind === 'readonly' ? `whether ${thing} is read only` : `whether ${thing} is enabled`
}

/**
 * Rule key → notes about other rules that set the same thing on the same
 * trigger (the same event and target; "Always" rules with each other), which
 * then run in list order and the later one wins. Rules on different events
 * (a row click filling a field, a button clearing it) are not a conflict.
 */
export function ruleConflicts(def: RulesDefinition, rules: UnifiedRule[]): Map<string, string[]> {
  const by = new Map<string, UnifiedRule[]>()
  for (const u of rules) {
    if (u.rule.disabled) continue
    const trigger = `${u.rule.event}:${u.rule.target ?? '*'}`
    for (const effect of new Set(u.rule.then.flatMap(effectKeys))) {
      const key = `${trigger}|${effect}`
      const list = by.get(key) ?? []
      list.push(u)
      by.set(key, list)
    }
  }
  const out = new Map<string, string[]>()
  for (const [key, list] of by) {
    if (list.length < 2) continue
    const effect = key.slice(key.indexOf('|') + 1)
    for (const u of list) {
      const others = list.filter((x) => x !== u).map((x) => `"${x.rule.name || FORM_RULE_EVENT_LABELS[x.rule.event]}"`)
      const notes = out.get(u.key) ?? []
      notes.push(`Also sets ${effectName(def, effect)} on the same event: ${others.join(', ')}. Rules run in list order — the last one to run wins.`)
      out.set(u.key, notes)
    }
  }
  return out
}

/** A declared section's title (layout.sections), or null. */
function sectionTitle(def: RulesDefinition, key: string): string | null {
  const list = Array.isArray(def.layout?.sections) ? def.layout.sections as Array<{ key?: string; title?: string }> : []
  const s = list.find((x) => x.key === key)
  return s ? (s.title || key) : null
}

/** A short "Then" line for one action (a nested List step: which nested List of which parent row). */
export function describeRuleAction(def: RulesDefinition, a: FieldButtonAction, sample?: RuleScope): string {
  const line = describeOneAction(def, a, sample)
  if (!a.child) return line
  const list = def.fields.find((x) => x.key === (a.list_field ?? a.field))
  const nested = list?.list ? childListAt(list.list, a.child) : null
  const name = nested ? nested.columns.map((c) => c.label).join(' › ') : a.child
  const parent = (a.parent_row ?? 'current').trim()
  const which = parent === 'current' ? 'the current row' : parent === 'selected' ? 'each selected row' : parent === '{{event.row_number}}' ? 'the row of the event' : `row ${parent}`
  return `${line} — in ${name} of ${which}`
}

function describeOneAction(def: RulesDefinition, a: FieldButtonAction, sample?: RuleScope): string {
  const shown = (template: string) => (sample && template.includes('{{') ? `“${textOf(resolveRuleTemplate(template, sample))}”` : template || '""')
  const targets = (list?: string[]) => (list ?? []).map((t) => { if (t === FORM_WHOLE_TARGET) return 'the whole form'; const p = parseTarget(t); return p ? (p.kind === 'page' ? ((def.layout.pages ?? []).find((x) => x.id === p.id)?.title ?? p.id) : p.kind === 'section' && sectionTitle(def, p.id) ? `section ${sectionTitle(def, p.id)}` : fieldName(def, p.id)) : t }).join(', ') || '…'
  switch (a.type) {
    case 'collapse_expand': return `${a.mode === 'collapse' ? 'Collapse' : a.mode === 'expand' ? 'Expand' : 'Toggle'} ${targets(a.targets)}`
    case 'load_part': return `Load ${targets(a.targets)}`
    case 'show_hide': return `${a.mode === 'show' ? 'Show' : a.mode === 'hide' ? 'Hide' : 'Toggle'} ${targets(a.targets)}`
    case 'enable_disable': return `${a.mode === 'enable' ? 'Enable' : a.mode === 'disable' ? 'Disable' : 'Toggle enabled'} ${targets(a.targets)}`
    case 'read_only': return `${a.mode === 'read_only' ? 'Make read only' : a.mode === 'editable' ? 'Make editable' : 'Toggle read only'} ${targets(a.targets)}`
    case 'set_style': return `Style ${targets(a.targets)} — ${describeStyle(actionStyle(a))}`
    case 'set_values': case 'copy_values': return `${a.type === 'copy_values' ? 'Copy into' : 'Set'} ${Object.entries(a.assign ?? {}).map(([k, v]) => `${fieldName(def, k)} = ${shown(v)}`).join(', ') || '…'}`
    case 'clear_values': return `Clear ${(a.fields ?? []).map((k) => fieldName(def, k)).join(', ') || '…'}`
    case 'add_list_row': return `Add a row to ${a.list_field ? fieldName(def, a.list_field) : '…'}: ${Object.entries(a.values ?? {}).map(([k, v]) => `${k} = ${shown(v)}`).join(', ') || '…'}`
    case 'remove_list_row': return `${a.row === 'selected' ? `Delete the selected rows of ${listName(def, a)}` : `Remove the ${a.row && a.row !== 'last' ? (a.row === 'first' ? 'first row' : a.row === '{{event.row_number}}' ? 'row of the event' : `row ${a.row}`) : 'last row'} of ${listName(def, a)}`}${a.confirm_text ? ' (asks first)' : ''}`
    case 'clear_list': return `Clear ${listName(def, a)}${a.confirm_text ? ' (asks first)' : ''}`
    case 'edit_list_row': return `Edit ${a.row === 'selected' ? 'the selected row' : a.row && a.row !== '{{event.row_number}}' ? `row ${a.row}` : 'the row'} of ${listName(def, a)}: load ${Object.keys(a.assign ?? {}).map((k) => fieldName(def, k)).join(', ') || '…'}`
    case 'cancel_list_edit': return `Cancel editing ${a.list_field ? fieldName(def, a.list_field) : '…'}${a.fields?.length ? `; reset ${a.fields.map((k) => fieldName(def, k)).join(', ')}` : ''}`
    case 'update_list_row': return `Update ${a.row === 'selected' ? 'the selected rows' : a.row && a.row !== 'last' ? `row ${a.row}` : 'the last row'} of ${listName(def, a)}: ${Object.entries(a.values ?? {}).map(([k, v]) => `${k} = ${shown(v)}`).join(', ') || '…'}`
    case 'table_read': case 'table_list': case 'table_create': case 'table_update': case 'table_delete': {
      const verb = { table_read: 'Read a row of', table_list: 'List rows of', table_create: 'Add a row to', table_update: 'Update rows of', table_delete: 'Delete a row of' }[a.type]
      const outs = (a.outputs ?? []).map((o) => (o.as === 'options' ? `options of ${fieldName(def, o.to)}` : o.to.startsWith('var.') ? `{{${o.to}}}` : fieldName(def, o.to)))
      return `${verb} ${a.table_name ?? 'a table'}${a.each_selected ? ` for each selected row of ${fieldName(def, a.each_selected)}` : ''}${outs.length ? ` → ${outs.join(', ')}` : ''} (server)${branchSummary(def, a, sample)}`
    }
    case 'set_state': return `${a.state_value === 'toggle' ? 'Toggle' : 'Set'} state.${a.flag || '?'}${a.state_value === 'toggle' ? '' : ` = ${a.state_value}`}`
    case 'set_variable': return a.variable_mode === 'clear' ? `Clear var.${a.variable ?? '?'}` : a.variable_mode === 'reset' ? `Reset var.${a.variable ?? '?'}` : `Set var.${a.variable ?? '?'} = ${shown(a.value ?? '')}`
    case 'go_to_page': return `Go to ${(def.layout.pages ?? []).find((p) => p.id === a.page)?.title ?? a.page ?? '…'}`
    case 'field_error': return `Error on ${a.field ? fieldName(def, a.field) : '…'}: “${a.text ?? ''}”`
    case 'block_submit': return `Block submit: “${a.text ?? ''}”`
    case 'message': return a.style ? `${a.style === 'banner' ? 'Banner' : 'Message'}${a.tone ? ` (${a.tone})` : ''}: “${a.title ? `${a.title} — ` : ''}${a.text ?? ''}”` : `Message: “${a.text ?? ''}”`
    case 'prompt': return describePrompt(def, a, sample)
    case 'refresh': return `Refresh ${a.field ? fieldName(def, a.field) : '…'}`
    case 'run_lookup': return `Run lookup ${a.field ? fieldName(def, a.field) : '…'}${a.query ? ` for ${a.query}` : ''}`
    case 'call_reference': {
      const outs = [...Object.values(a.results ?? {}).map((k) => fieldName(def, k)), ...(a.outputs ?? []).map((o) => (o.as === 'options' ? `options of ${fieldName(def, o.to)}` : o.to.startsWith('var.') ? `{{${o.to}}}` : fieldName(def, o.to)))]
      return `Call API reference${outs.length ? ` → ${outs.join(', ')}` : ''} (server${a.wait === false ? ', without waiting' : ''})${branchSummary(def, a, sample)}`
    }
    case 'start_workflow': return `Start workflow ${a.workflow_name ?? ''} (server)`.replace(/\s+/g, ' ')
    case 'apply_table_changes': return `For each changed row of ${a.table_changes?.field ? fieldName(def, a.table_changes.field) : '…'} (server)`
    case 'open_link': return `Open ${a.url ?? '…'}`
    case 'new_row': return `Create a new row in ${a.field ? fieldName(def, a.field) : '…'}${a.position === 'start' ? ' (at the top)' : a.position === 'after_selected' ? ' (after the selected row)' : ''}${Object.keys(a.values ?? {}).length ? `: ${Object.entries(a.values ?? {}).map(([k, v]) => `${columnName(def, a.field, k)} = ${shown(v)}`).join(', ')}` : ''}`
    case 'set_row_values': {
      const ignored = readOnlyWarning(def, a)
      return `Set ${Object.entries(a.values ?? {}).map(([k, v]) => `${columnName(def, a.field, k)} = ${shown(v)}`).join(', ') || '…'} on ${rowTargetName(a)} of ${a.field ? fieldName(def, a.field) : '…'}${ignored}`
    }
    case 'commit_row': return `Commit ${rowTargetName(a)} ${a.commit_mode === 'save_now' ? 'to' : 'of'} ${a.field ? fieldName(def, a.field) : '…'}${a.commit_mode === 'save_now' ? ' (save now)' : ''}${branchSummary(def, a, sample)}`
    case 'discard_row': return `Discard ${rowTargetName(a)} of ${a.field ? fieldName(def, a.field) : '…'} (a new row goes, an edited one is put back)`
    case 'revert_row': return `Revert ${rowTargetName(a)} of ${a.field ? fieldName(def, a.field) : '…'}`
    case 'delete_row': return `Delete ${rowTargetName(a, 'selected')} of ${a.field ? fieldName(def, a.field) : '…'}${a.commit_mode === 'save_now' ? ' (now)' : ''}${a.confirm_text ? ' (asks first)' : ''}${branchSummary(def, a, sample)}`
    case 'open_row_form': {
      const spec = (a.row ?? 'current').trim()
      const which = spec === 'new' ? 'a new row' : spec === 'first' ? 'the first row' : spec === 'last' ? 'the last row' : rowTargetName(a)
      return `Open ${which} of ${a.field ? fieldName(def, a.field) : '…'}${a.child ? ` → ${a.child}` : ''} in a pop-out form`
    }
    case 'refresh_table': return `Refresh ${a.field ? fieldName(def, a.field) : '…'}${a.keep_pending === 'ask' ? ' (asks before dropping pending rows)' : ' (pending rows kept)'}`
    default: return RULE_ACTION_LABELS[a.type]
  }
}

/** "the current row", "the selected rows", "row 2", "the row keyed {{…}}", "all pending rows". */
function rowTargetName(a: FieldButtonAction, fallback = 'current'): string {
  if (a.row_key) return `the row keyed ${a.row_key}`
  const spec = (a.row ?? fallback).trim()
  if (spec === 'current') return 'the current row'
  if (spec === 'selected') return 'the selected rows'
  if (spec === 'all_pending') return 'all pending rows'
  if (spec === '{{event.row_number}}') return 'the row of the event'
  return `row ${spec}`
}

/** A List's / Data table's column by label. */
function columnName(def: RulesDefinition, field: string | undefined, column: string): string {
  const f = field ? def.fields.find((x) => x.key === field) : undefined
  const cols = (f?.list?.columns ?? f?.data_table?.columns ?? []) as Array<{ key: string; label?: string }>
  return cols.find((c) => c.key === column)?.label || column
}

/** " (Price is read-only: ignored on existing rows)" for Set row values (the designer's warning). */
export function readOnlyWarning(def: RulesDefinition, a: FieldButtonAction): string {
  const f = a.field ? def.fields.find((x) => x.key === a.field) : undefined
  if (!f || !isRowsField(f as never)) return ''
  const ignored = ignoredOnExisting(f as never, Object.keys(a.values ?? {}))
  if (!ignored.length) return ''
  return ` — ⚠ ${ignored.map((k) => columnName(def, a.field, k)).join(', ')} ${ignored.length === 1 ? 'is' : 'are'} read-only: ignored on existing rows (a new row takes ${ignored.length === 1 ? 'it' : 'them'} before its first commit)`
}

/**
 * Inputs locked while a List row is being edited ("Edit row" loaded it into
 * the inputs): the ones mapped to the List's read-only columns — by its
 * "Add row to list" values ({{form.<input>}}) or its "Edit row" loads
 * ({{row.<column>}}). The row keeps those values on update.
 */
export function listEditLockedInputs(rules: FormRule[], fields: Array<{ key: string; type: string; list?: ListFieldConfig }>, values: Record<string, unknown>): string[] {
  const out = new Set<string>()
  for (const f of fields) {
    if (f.type !== 'list' || !f.list || listEditingRow(values, f.key) === null) continue
    const locked = new Set(f.list.columns.filter((c) => c.read_only).map((c) => c.key))
    if (!locked.size) continue
    for (const rule of rules) {
      if (rule.disabled) continue
      for (const a of allActions(rule.then)) {
        if (a.type === 'add_list_row' && a.list_field === f.key) {
          for (const [column, template] of Object.entries(a.values ?? {})) { const input = listSourceField(template); if (input && locked.has(column)) out.add(input) }
        }
        if (a.type === 'edit_list_row' && a.list_field === f.key) {
          for (const [input, template] of Object.entries(a.assign ?? {})) { const column = /^\{\{\s*row\.([A-Za-z0-9_]+)\s*\}\}$/.exec(template.trim())?.[1]; if (column && locked.has(column)) out.add(input) }
        }
      }
    }
  }
  return [...out]
}

/** A List action's List by name ("Line items"). */
function listName(def: RulesDefinition, a: FieldButtonAction): string {
  return a.list_field ? fieldName(def, a.list_field) : '…'
}

/** " — then …; if it fails …" for a data / API step's own steps. */
function branchSummary(def: RulesDefinition, a: FieldButtonAction, sample?: RuleScope): string {
  const ok = (a.on_success ?? []).map((x) => describeRuleAction(def, x, sample))
  const failed = (a.on_failure ?? []).map((x) => describeRuleAction(def, x, sample))
  return `${ok.length ? `; then ${ok.join(', ')}` : ''}${failed.length ? `; if it fails ${failed.join(', ')}` : ''}`
}

/** An output aimed at something the form doesn't have (null = fine). */
function outputTargetProblem(a: FieldButtonAction, known: RuleKnown): string | null {
  for (const o of a.outputs ?? []) {
    if (o.to.startsWith('var.')) { if (known.variables && !known.variables.has(o.to.slice(4))) return `"${o.to}" is not a variable of this form`; continue }
    const type = known.fieldTypes.get(o.to)
    if (!type) return `"${o.to}" is not a field of this form`
    if (o.as === 'options' && type !== 'choice' && type !== 'multi_choice') return `options go into a single or multi-select ("${o.to}" is not one)`
    if (['button', 'heading', 'divider', 'display_image', 'data_table', 'attachments', 'image', 'signature', 'custom'].includes(type)) return `"${o.to}" can't take a value from a result`
  }
  return null
}

/** "Ask “Delete rows?” — Yes → Apply table changes; No → stop" (with `response`: only that answer's branch). */
export function describePrompt(def: RulesDefinition, a: FieldButtonAction, sample?: RuleScope, response?: string): string {
  const head = `Ask “${a.title || a.text || ''}”${a.prompt?.display === 'dialog' ? ' (dialog)' : ''}`
  const buttons = a.prompt?.buttons ?? []
  const branch = (b: { label: string; then?: FieldButtonAction[]; continue?: boolean }) => {
    const steps = (b.then ?? []).map((x) => describeRuleAction(def, x, sample))
    const tail = b.continue ? 'continue' : 'stop'
    return `${b.label} → ${[...steps, tail].join(', ')}`
  }
  if (response !== undefined) {
    const b = a.prompt ? promptButton(a.prompt, response) : null
    return `${head} — answered ${b ? branch(b) : `${response === DISMISSED_RESPONSE ? 'closed' : response} → stop`}`
  }
  return `${head} — ${buttons.map(branch).join('; ')}`
}

/** Names of the form's questions (rules and Buttons), for "A question is answered". */
export function promptIds(def: Pick<RulesDefinition, 'fields' | 'layout'>): string[] {
  const out = new Set<string>()
  const scan = (actions: FieldButtonAction[] | undefined) => { for (const a of actions ?? []) if (a.type === 'prompt' && a.prompt?.id) out.add(a.prompt.id) }
  for (const r of normalizeFormRules(def.layout?.rules)) scan(r.then)
  for (const f of def.fields) if (f.type === 'button') scan(f.button?.actions)
  return [...out]
}

/** A short "If" line. */
export function describeConditions(def: RulesDefinition, group: DataTableConditionGroup | undefined): string {
  if (!group || !group.conditions.length) return 'always'
  const one = (c: DataTableCondition | DataTableConditionGroup): string => {
    if (isConditionGroup(c)) return `(${c.conditions.map(one).join(c.match === 'any' ? ' or ' : ' and ')})`
    const sectionPath = /^section\.([a-z0-9_]+)\.(included|visible)$/.exec(c.column)
    const subject = sectionPath ? `section ${sectionTitle(def, sectionPath[1]) ?? sectionPath[1]} ${sectionPath[2]}` : c.column.startsWith('state.') || c.column.startsWith('event.') || c.column.startsWith('user.') ? c.column : fieldName(def, c.column)
    const op = DATA_TABLE_OPERATOR_LABELS[c.operator] ?? c.operator
    return c.operator === 'is_set' || c.operator === 'is_not_set' ? `${subject} ${op}` : `${subject} ${op} ${c.value ?? ''}`
  }
  return group.conditions.map(one).join(group.match === 'any' ? ' or ' : ' and ')
}

/* ── Test panel ─────────────────────────────────────────────────────── */

export interface SimulatedRule {
  key: string
  name: string
  badge: string
  /** The event matches this rule. */
  triggered: boolean
  /** Its conditions hold (for triggered rules). */
  met: boolean
  actions: string[]
}

/**
 * Which rules a (sample) event would run, and what they would do — the
 * designer's test panel. `response`: the simulated answer to the rules'
 * questions — the list then shows that answer's branch and stops where the
 * answer stops the rest.
 */
export function simulateRuleEvent(def: RulesDefinition, event: RuleEvent, scope: Omit<RuleScope, 'event'>, options: { response?: string } = {}): SimulatedRule[] {
  return collectFormRules(def).map((u) => {
    const r = u.rule
    const triggered = !r.disabled && (r.event === event.type || (event.type === 'form_load' && r.event === 'always')) && (!r.target || r.target === event.target)
    const met = triggered && ruleConditionsMet(r.if, { ...scope, event: event.context ?? {} })
    const sampleScope = { ...scope, event: event.context ?? {} }
    let actions: string[]
    if (u.barActions) actions = u.barActions.map((a) => String(a.type))
    else if (options.response === undefined || !met) actions = r.then.map((a) => describeRuleAction(def, a, met ? sampleScope : undefined))
    else {
      actions = []
      for (const a of r.then) {
        if (a.type !== 'prompt' || !a.prompt) { actions.push(describeRuleAction(def, a, sampleScope)); continue }
        actions.push(describePrompt(def, a, sampleScope, options.response))
        if (!promptButton(a.prompt, options.response)?.continue) { actions.push('(the rest stops here)'); break }
      }
    }
    return { key: u.key, name: r.name || FORM_RULE_EVENT_LABELS[r.event], badge: u.badge, triggered, met, actions }
  })
}

/* ── Accessibility ──────────────────────────────────────────────────── */

/**
 * Required fields a rule can hide with no rule, button or condition that
 * shows them again: an event rule that hides (or toggles) them while nothing
 * shows them. "Always" rules show again by themselves; start-hidden targets
 * need a Show somewhere.
 */
export function rulesHidingRequiredFields(def: RulesDefinition): Array<{ field: string; rule: string }> {
  const required = new Map(def.fields.filter((f) => f.required).map((f) => [f.key, f]))
  if (!required.size) return []
  const headings = sectionBoundaryKeys(def.fields)
  const unified = collectFormRules(def)
  const shows = new Set<string>()
  const hides: Array<{ target: string; rule: string }> = []
  for (const u of unified) {
    if (u.rule.disabled || u.rule.event === 'always') continue
    for (const a of u.rule.then) {
      if (a.type !== 'show_hide') continue
      for (const t of a.targets ?? []) {
        if (a.mode === 'hide') hides.push({ target: t, rule: u.rule.name || u.badge })
        else shows.add(t)
      }
    }
  }
  const out: Array<{ field: string; rule: string }> = []
  for (const h of hides) {
    if (shows.has(h.target)) continue
    for (const key of targetFieldKeys(def.layout, h.target, headings)) {
      if (required.has(key) && !out.some((o) => o.field === key)) out.push({ field: key, rule: h.rule })
    }
  }
  return out
}

/** Data table operators offered by the condition builder. */
export const RULE_OPERATORS: DataTableOperator[] = DATA_TABLE_OPERATORS

/**
 * Options a rule loads (a cascade: Country changes → load the States): when
 * a form opens with saved values (a draft, a task's prefill), the rules that
 * load options for a choice that already holds a value run again for their
 * field's saved value — so the choice offers (and keeps) its saved value
 * without a "Form loads" rule. Value-change rules only; a field whose
 * options are already loaded is left alone.
 */
export function resumeOptionEvents(rules: FormRule[], values: Record<string, unknown>): RuleEvent[] {
  const blankish = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)
  const loaded = isPlainObject(values[OPTIONS_KEY]) ? values[OPTIONS_KEY] as Record<string, unknown> : {}
  const out: RuleEvent[] = []
  for (const rule of rules) {
    if (rule.disabled || rule.event !== 'value_change' || !rule.target || blankish(values[rule.target])) continue
    const targets = allActions(rule.then).flatMap((a) => (a.outputs ?? []).filter((o) => o.as === 'options').map((o) => o.to))
    if (!targets.some((t) => !blankish(values[t]) && !Array.isArray(loaded[t]))) continue
    if (out.some((e) => e.target === rule.target)) continue
    out.push({ type: 'value_change', target: rule.target, context: { field: rule.target, value: values[rule.target], previous: null, resume: true } })
  }
  return out
}

/**
 * Rule chains (a rule's change firing another rule, a cascade of any depth):
 * runs nest at most `max` deep, so a rule that changes its own source — or
 * two rules that change each other — stop instead of looping.
 */
export class RuleChainGuard {
  private depth = 0
  constructor(private readonly max = 3) {}
  /** Enter a nested run; false = too deep (the run is skipped). */
  enter(): boolean {
    if (this.depth >= this.max) return false
    this.depth += 1
    return true
  }
  leave(): void { this.depth = Math.max(0, this.depth - 1) }
  get current(): number { return this.depth }
}
