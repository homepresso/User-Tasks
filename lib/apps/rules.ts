import { z } from 'zod'
import { INSTANCE_ACTIONS, INSTANCE_DATASETS } from '@/lib/instance-admin/schema'
import { DATA_TABLE_OPERATORS, isConditionGroup, type DataTableCondition, type DataTableConditionGroup } from '@/lib/forms/data-table'
import { ruleConditionsMet, ruleValue } from '@/lib/forms/form-rules'
import { LABEL_LIMITS } from '@/lib/forms/label-field'
import { paramMapSchema } from './params'
import { openModeSchema } from './schema-base'
import { VAR_NAME_RE, resolveTemplate, ruleScopeOf, templateRefs, withinBudget, type AppScope } from './variables'

/**
 * App rules (pure, isomorphic; __tests__/apps-rules.test.ts):
 *
 *   When [trigger]  →  If [conditions]  →  Then [actions, in order]
 *
 * The same shape as form rules (lib/forms/form-rules.ts): conditions are
 * the form rules' condition groups (AND / OR, one nested level) judged by
 * the same evaluator, values are the same templates ({{var.x}},
 * {{event.row.id}}) and expressions ({{= … }}, lib/forms/label-field.ts).
 *
 * Stored on a page's layout (`layout.rules`, page rules) and on the app
 * (`settings.rules`, app rules — they run on every page). Every id-bearing
 * slot uses the reference walker's key names (lib/apps/references.ts).
 *
 * Triggers (`RULE_TRIGGERS`) carry a payload read as {{event.*}}:
 *   page_loaded        event.page
 *   variable_changed   event.name, event.value, event.previous (when.variable: "var.x" / "param.x")
 *   filter_changed     event.filter, event.value, event.previous
 *   button_click       event.index, event.label (when.widget, when.button)
 *   row_click          event.value, event.row.<column> (event.row.id)
 *   card_click         event.value, event.card.<key> (also event.row)
 *   segment_click      event.value
 *   tab_changed        event.tab, event.label
 *   form_submitted     event.form_id, event.submission_id, event.values.<field> (when.form_id)
 *   panel_closed       event.kind, event.id
 *   timer              event.at (when.interval_s ≥ 30, only while the page is visible)
 *   reference_returned event.reference_id, event.result (after a "Call an API reference" action)
 *
 * Actions (`ACTION_TYPES`) run in order; each may store its result in a
 * variable (`result_var`), and later actions read the previous result as
 * {{result}} and every result as {{results.<n>}}. Browser actions run in the
 * page runtime; SERVER actions (call_reference, table_lookup, table_create,
 * table_update, start_workflow) go through one audited, rate-limited
 * endpoint (POST /api/v1/apps/{id}/actions — lib/services/app-rule-actions.ts),
 * which reads the action from the SAVED app by rule id and path and takes
 * only the values of its declared template slots from the browser
 * (`serverSlots`).
 *
 * Errors: per action `on_error` — stop (default: the rule stops), continue,
 * or run (the rule's `on_error_actions`, then stop); {{error.message}}.
 * Cascades (a variable change firing a rule that changes another…) nest at
 * most APP_RULE_LIMITS.chain deep.
 */

export const APP_RULE_LIMITS = { rules: 50, actions: 20, nested: 10, values: 10, chain: LABEL_LIMITS.chain, timerMin: 30, timerMax: 3600, timers: 5, conditions: 20, debug: 60 } as const

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Must be a UUID')
const slug = z.string().regex(/^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/)
const widgetId = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i)
const filterId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/)
const varName = z.string().regex(VAR_NAME_RE, 'A variable name')
/** A value: text with {{placeholders}}, or an expression {{= … }}. */
const tpl = z.string().max(2000)
const tplMap = (max: number) => z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/), tpl).refine((r) => Object.keys(r).length <= max, `At most ${max} values`)

/* ── Triggers ────────────────────────────────────────────────────────── */

export const RULE_TRIGGERS = [
  'page_loaded', 'variable_changed', 'filter_changed', 'button_click', 'row_click', 'card_click', 'segment_click', 'tab_changed',
  'form_submitted', 'panel_closed', 'timer', 'reference_returned', 'row_action',
] as const
export type RuleTrigger = (typeof RULE_TRIGGERS)[number]
export const TRIGGER_LABELS: Record<RuleTrigger, string> = {
  page_loaded: 'Page loaded', variable_changed: 'Parameter or variable changes', filter_changed: 'Filter changed', button_click: 'Button clicked',
  row_click: 'List / grid row clicked', card_click: 'Card clicked', segment_click: 'Chart segment clicked', tab_changed: 'Tab changed',
  form_submitted: 'Form submitted', panel_closed: 'Panel closed', timer: 'Timer (every …)', reference_returned: 'API reference returned',
  row_action: 'Grid row action (each selected row)',
}
/** What each trigger carries as {{event.*}} (builder hints, docs). */
export const TRIGGER_PAYLOAD: Record<RuleTrigger, string[]> = {
  page_loaded: ['event.page'], variable_changed: ['event.name', 'event.value', 'event.previous'], filter_changed: ['event.filter', 'event.value', 'event.previous'],
  button_click: ['event.widget', 'event.index', 'event.label'], row_click: ['event.widget', 'event.value', 'event.row.id', 'event.row.<column>'],
  card_click: ['event.widget', 'event.value', 'event.card.id', 'event.card.<key>'], segment_click: ['event.widget', 'event.value'], tab_changed: ['event.widget', 'event.tab', 'event.label'],
  form_submitted: ['event.form_id', 'event.submission_id', 'event.values.<field>'], panel_closed: ['event.kind', 'event.id'], timer: ['event.at'],
  reference_returned: ['event.reference_id', 'event.result'],
  row_action: ['event.widget', 'event.index', 'event.label', 'event.value', 'event.row.id', 'event.row.<column>', 'event.count', 'event.position'],
}

export const triggerSchema = z.object({
  type: z.enum(RULE_TRIGGERS),
  /** button / row / card / segment / tab / form widget: only this widget (empty: any). */
  widget: widgetId.nullable().optional(),
  /** button_click: only this button (index in the widget's buttons / tiles); row_action: only this grid row action. */
  button: z.number().int().min(0).max(23).nullable().optional(),
  /** variable_changed: "var.<name>" or "param.<name>". */
  variable: z.string().regex(/^(var|param)\.[A-Za-z_][A-Za-z0-9_]{0,39}$/).nullable().optional(),
  /** filter_changed: only this filter. */
  filter: filterId.nullable().optional(),
  /** form_submitted: only this form (any form the app opened, in any mode). */
  form_id: uuid.nullable().optional(),
  /** reference_returned: only this API reference. */
  reference_id: uuid.nullable().optional(),
  /** timer: every N seconds (30–3600), only while the page is visible. */
  interval_s: z.number().int().min(APP_RULE_LIMITS.timerMin).max(APP_RULE_LIMITS.timerMax).nullable().optional(),
}).strict()
export type RuleTriggerConfig = z.output<typeof triggerSchema>

/* ── Conditions (the form rules' condition groups) ───────────────────── */

const conditionSchema = z.object({ column: z.string().min(1).max(600), operator: z.enum(DATA_TABLE_OPERATORS as [string, ...string[]]), value: tpl.optional() }).strict()
const innerGroup = z.object({ match: z.enum(['all', 'any']), conditions: z.array(conditionSchema).max(APP_RULE_LIMITS.conditions) }).strict()
export const conditionGroupSchema = z.object({ match: z.enum(['all', 'any']).default('all'), conditions: z.array(z.union([conditionSchema, innerGroup])).max(APP_RULE_LIMITS.conditions) }).strict()

/* ── Actions ─────────────────────────────────────────────────────────── */

export const ON_ERROR = ['stop', 'continue', 'run'] as const
const common = {
  /** stop: the rule stops (default); continue: go on; run: the rule's on-error actions, then stop. */
  on_error: z.enum(ON_ERROR).optional(),
  /** Store this action's result in a variable (declared on the page or the app). */
  result_var: varName.nullable().optional(),
  note: z.string().max(200).nullable().optional(),
}

export const openTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('form'), form_id: uuid, params: paramMapSchema }).strict(),
  z.object({ kind: z.literal('page'), page_slug: slug, params: paramMapSchema, filters: tplMap(8).optional() }).strict(),
  z.object({ kind: z.literal('report'), report_id: uuid }).strict(),
  z.object({ kind: z.literal('record'), table_id: uuid, row_id: tpl.nullable().optional() }).strict(),
  z.object({ kind: z.literal('workflow'), workflow_id: uuid }).strict(),
  z.object({ kind: z.literal('url'), url: tpl }).strict(),
])
export type OpenTargetConfig = z.output<typeof openTargetSchema>

const leafActions = [
  z.object({ type: z.literal('set_variable'), ...common, values: z.array(z.object({ name: varName, value: tpl }).strict()).min(1).max(APP_RULE_LIMITS.values) }).strict(),
  z.object({ type: z.literal('set_filter'), ...common, filter: filterId, value: tpl }).strict(),
  z.object({ type: z.literal('clear_filters'), ...common, filters: z.array(filterId).max(8).default([]) }).strict(),
  z.object({ type: z.literal('open_target'), ...common, target: openTargetSchema, open_mode: openModeSchema.nullable().optional(), title: tpl.nullable().optional() }).strict(),
  z.object({ type: z.literal('close_panel'), ...common, all: z.boolean().default(false) }).strict(),
  z.object({ type: z.literal('navigate'), ...common, page_slug: slug, params: paramMapSchema, filters: tplMap(8).optional() }).strict(),
  z.object({ type: z.literal('refresh'), ...common, widgets: z.array(widgetId).max(60).default([]) }).strict(),
  z.object({ type: z.literal('set_visibility'), ...common, widgets: z.array(widgetId).min(1).max(60), visible: z.enum(['show', 'hide', 'toggle']) }).strict(),
  z.object({ type: z.literal('set_enabled'), ...common, widget: widgetId, button: z.number().int().min(0).max(23).nullable().optional(), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal('message'), ...common, text: tpl.min(1), tone: z.enum(['info', 'success', 'warning', 'danger']).default('info') }).strict(),
  z.object({
    type: z.literal('call_reference'), ...common, reference_id: uuid,
    /** Declared reference inputs only: { input name → value template }. */
    inputs: tplMap(20).default({}),
    /** Path to the part of the response to keep (e.g. data.customer). */
    results_path: z.string().regex(/^[A-Za-z0-9_.[\]-]{0,200}$/).nullable().optional(),
    /** A designer with Manage references lets app viewers without integration access run it (audited). */
    allow_viewers: z.boolean().default(false),
  }).strict(),
  z.object({ type: z.literal('table_lookup'), ...common, table_id: uuid, row_id: tpl.nullable().optional(), filter: conditionGroupSchema.nullable().optional(), limit: z.number().int().min(1).max(50).default(1) }).strict(),
  z.object({ type: z.literal('table_create'), ...common, table_id: uuid, values: tplMap(50).default({}) }).strict(),
  z.object({ type: z.literal('table_update'), ...common, table_id: uuid, row_id: tpl.min(1), values: tplMap(50).default({}) }).strict(),
  z.object({ type: z.literal('start_workflow'), ...common, workflow_id: uuid, inputs: tplMap(30).default({}) }).strict(),
  /** The built-in "UserTasks instance" source: read a record or a list (instance admins only; others get an access message). */
  z.object({ type: z.literal('instance_read'), ...common, dataset: z.enum(INSTANCE_DATASETS), params: tplMap(10).default({}) }).strict(),
  /** An instance admin's on-behalf action (instance admins only; needs a reason; audited in both trails). */
  z.object({ type: z.literal('instance_action'), ...common, action: z.enum(INSTANCE_ACTIONS), inputs: tplMap(10).default({}) }).strict(),
  z.object({ type: z.literal('copy'), ...common, text: tpl.min(1) }).strict(),
  z.object({ type: z.literal('download_report'), ...common, report_id: uuid }).strict(),
  /** Placeholder the server sends instead of an action this viewer can't use (positions are kept); does nothing. */
  z.object({ type: z.literal('noop'), ...common }).strict(),
] as const

export const leafActionSchema = z.discriminatedUnion('type', [...leafActions])
export const confirmActionSchema = z.object({
  type: z.literal('confirm'), ...common,
  title: tpl.min(1), message: tpl.default(''), confirm_label: z.string().max(40).nullable().optional(),
  then: z.array(leafActionSchema).max(APP_RULE_LIMITS.nested).default([]),
  else: z.array(leafActionSchema).max(APP_RULE_LIMITS.nested).default([]),
}).strict()
export const ruleActionSchema = z.discriminatedUnion('type', [...leafActions, confirmActionSchema])
export type RuleAction = z.output<typeof ruleActionSchema>
export type LeafAction = z.output<typeof leafActionSchema>
export type RuleActionType = RuleAction['type']

export const ACTION_TYPES: RuleActionType[] = ['set_variable', 'set_filter', 'clear_filters', 'open_target', 'close_panel', 'navigate', 'refresh', 'set_visibility', 'set_enabled', 'message', 'confirm', 'call_reference', 'table_lookup', 'table_create', 'table_update', 'start_workflow', 'instance_read', 'instance_action', 'copy', 'download_report']
export const ACTION_LABELS: Record<RuleActionType, string> = {
  set_variable: 'Set variable(s)', set_filter: 'Set a page filter', clear_filters: 'Clear filters', open_target: 'Open (form, page, report, record, workflow, URL)',
  close_panel: 'Close panel', navigate: 'Go to page', refresh: 'Refresh widgets', set_visibility: 'Show / hide widgets', set_enabled: 'Enable / disable a button',
  message: 'Show a message', confirm: 'Ask to confirm (then / otherwise)', call_reference: 'Call an API reference', table_lookup: 'Look up data table rows',
  table_create: 'Create a data table row', table_update: 'Update a data table row', start_workflow: 'Start a workflow', instance_read: 'Read UserTasks instance data (instance admins)', instance_action: 'Act on a workspace’s behalf (instance admins)', copy: 'Copy to clipboard', download_report: 'Download report (CSV)',
  noop: 'Not available',
}
export const ACTION_GROUPS: Array<{ label: string; types: RuleActionType[] }> = [
  { label: 'Values', types: ['set_variable', 'set_filter', 'clear_filters'] },
  { label: 'Open & navigate', types: ['open_target', 'close_panel', 'navigate'] },
  { label: 'Page', types: ['refresh', 'set_visibility', 'set_enabled', 'message', 'confirm', 'copy', 'download_report'] },
  { label: 'Data & integrations (server)', types: ['call_reference', 'table_lookup', 'table_create', 'table_update', 'start_workflow'] },
  { label: 'UserTasks instance (instance admins)', types: ['instance_read', 'instance_action'] },
]
export const SERVER_ACTIONS: ReadonlySet<RuleActionType> = new Set(['call_reference', 'table_lookup', 'table_create', 'table_update', 'start_workflow', 'instance_read', 'instance_action'])
export const isServerAction = (a: { type: string }) => SERVER_ACTIONS.has(a.type as RuleActionType)
/** Actions that change data or start work: contributors and editors only (viewers are read-only). */
export const WRITE_ACTIONS: ReadonlySet<RuleActionType> = new Set(['table_create', 'table_update', 'start_workflow', 'instance_action'])

export const appRuleSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  name: z.string().trim().max(80).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  enabled: z.boolean().default(true),
  when: triggerSchema,
  if: conditionGroupSchema.nullable().optional(),
  then: z.array(ruleActionSchema).max(APP_RULE_LIMITS.actions).default([]),
  /** Run when an action with on_error "run" fails. */
  on_error_actions: z.array(leafActionSchema).max(APP_RULE_LIMITS.nested).default([]),
}).strict()
export type AppRule = z.output<typeof appRuleSchema>
export type AppRuleInput = z.input<typeof appRuleSchema>

export const rulesSchema = z.array(appRuleSchema).max(APP_RULE_LIMITS.rules).superRefine((list, ctx) => {
  const seen = new Set<string>()
  for (const r of list) { if (seen.has(r.id)) ctx.addIssue({ code: 'custom', message: `Rule id ${r.id} appears more than once` }); seen.add(r.id) }
})

/** Stored rules → the valid ones (invalid / duplicate entries dropped, never thrown). */
export function normaliseRules(raw: unknown): AppRule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: AppRule[] = []
  for (const entry of raw.slice(0, APP_RULE_LIMITS.rules)) {
    const parsed = appRuleSchema.safeParse(entry)
    if (!parsed.success || seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    out.push(parsed.data)
  }
  return out
}

export function newRuleId(taken: Iterable<string> = []): string {
  const used = new Set(taken)
  for (let i = 1; i < 1000; i++) if (!used.has(`rule_${i}`)) return `rule_${i}`
  return `rule_${Date.now().toString(36)}`
}

/* ── Addressing actions (server endpoint) ────────────────────────────── */

/** An action's place in a rule: "then.3", "then.2.then.0", "then.2.else.1", "on_error.0". */
export const ACTION_PATH_RE = /^(then\.\d{1,2}(\.(then|else)\.\d{1,2})?|on_error\.\d{1,2})$/

export function actionAt(rule: AppRule, path: string): RuleAction | null {
  if (!ACTION_PATH_RE.test(path)) return null
  const parts = path.split('.')
  if (parts[0] === 'on_error') return rule.on_error_actions[Number(parts[1])] ?? null
  const top = rule.then[Number(parts[1])]
  if (!top) return null
  if (parts.length === 2) return top
  if (top.type !== 'confirm') return null
  return (parts[2] === 'then' ? top.then : top.else)[Number(parts[3])] ?? null
}

/** Every action of a rule with its path. */
export function ruleActions(rule: AppRule): Array<{ path: string; action: RuleAction }> {
  const out: Array<{ path: string; action: RuleAction }> = []
  rule.then.forEach((a, i) => {
    out.push({ path: `then.${i}`, action: a })
    if (a.type === 'confirm') {
      a.then.forEach((b, j) => out.push({ path: `then.${i}.then.${j}`, action: b }))
      a.else.forEach((b, j) => out.push({ path: `then.${i}.else.${j}`, action: b }))
    }
  })
  rule.on_error_actions.forEach((a, i) => out.push({ path: `on_error.${i}`, action: a }))
  return out
}

/**
 * A server action's template slots: the only values the browser resolves
 * and sends (the server takes nothing else from the request). Condition
 * values of a lookup filter are addressed by position ("filter.0",
 * "filter.1.0").
 */
export function serverSlots(action: RuleAction): Array<{ slot: string; template: string }> {
  const out: Array<{ slot: string; template: string }> = []
  const map = (prefix: string, m: Record<string, string> | undefined) => { for (const [k, v] of Object.entries(m ?? {})) out.push({ slot: `${prefix}.${k}`, template: v }) }
  switch (action.type) {
    case 'call_reference': map('inputs', action.inputs); break
    case 'start_workflow': map('inputs', action.inputs); break
    case 'instance_read': map('params', action.params); break
    case 'instance_action': map('inputs', action.inputs); break
    case 'table_create': map('values', action.values); break
    case 'table_update': out.push({ slot: 'row_id', template: action.row_id }); map('values', action.values); break
    case 'table_lookup':
      if (action.row_id) out.push({ slot: 'row_id', template: action.row_id })
      action.filter?.conditions.forEach((c, i) => {
        if (isConditionGroup(c as DataTableCondition | DataTableConditionGroup)) (c as DataTableConditionGroup).conditions.forEach((d, j) => { if ((d as DataTableCondition).value !== undefined) out.push({ slot: `filter.${i}.${j}`, template: (d as DataTableCondition).value! }) })
        else if ((c as DataTableCondition).value !== undefined) out.push({ slot: `filter.${i}`, template: (c as DataTableCondition).value! })
      })
      break
    default: break
  }
  return out
}

/** The slot values for a request: each template resolved, as text (≤ 2000 chars; objects as JSON). */
export function resolveSlots(action: RuleAction, scope: AppScope): Record<string, string> {
  const out: Record<string, string> = {}
  for (const { slot, template } of serverSlots(action)) {
    const v = resolveTemplate(template, scope)
    out[slot] = (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)).slice(0, 2000)
  }
  return out
}

/* ── Matching ────────────────────────────────────────────────────────── */

export interface RuleEvent {
  type: RuleTrigger
  widget?: string | null
  button?: number | null
  /** variable_changed: "var.x" / "param.x". */
  variable?: string | null
  filter?: string | null
  form_id?: string | null
  reference_id?: string | null
  /** {{event.*}} */
  payload: Record<string, unknown>
}

export function ruleMatches(rule: AppRule, e: RuleEvent): boolean {
  if (!rule.enabled || rule.when.type !== e.type) return false
  const w = rule.when
  if (w.widget && e.widget !== w.widget) return false
  if ((e.type === 'button_click' || e.type === 'row_action') && w.button !== null && w.button !== undefined && e.button !== w.button) return false
  if (e.type === 'variable_changed' && w.variable && e.variable !== w.variable) return false
  if (e.type === 'filter_changed' && w.filter && e.filter !== w.filter) return false
  if (e.type === 'form_submitted' && w.form_id && e.form_id !== w.form_id) return false
  if (e.type === 'reference_returned' && w.reference_id && e.reference_id !== w.reference_id) return false
  return true
}

/** Does any rule listen to this trigger (for this widget)? Widgets raise click events only when something listens. */
export function listens(rules: readonly AppRule[], type: RuleTrigger, widget?: string | null): boolean {
  return rules.some((r) => r.enabled && r.when.type === type && (!r.when.widget || !widget || r.when.widget === widget))
}

/** Timer rules (bounded: at most APP_RULE_LIMITS.timers per page, each ≥ 30 s). */
export function timerRules(rules: readonly AppRule[]): Array<{ rule: AppRule; ms: number }> {
  return rules.filter((r) => r.enabled && r.when.type === 'timer').slice(0, APP_RULE_LIMITS.timers)
    .map((rule) => ({ rule, ms: Math.max(APP_RULE_LIMITS.timerMin, rule.when.interval_s ?? 60) * 1000 }))
}

/** A condition's evaluation, for the debug panel. */
export function explainConditions(group: AppRule['if'], scope: AppScope): Array<{ subject: string; operator: string; left: unknown; right: unknown; met: boolean }> {
  if (!group) return []
  const rs = ruleScopeOf(scope)
  const flat: DataTableCondition[] = []
  for (const c of group.conditions) {
    if (isConditionGroup(c as DataTableCondition | DataTableConditionGroup)) flat.push(...((c as DataTableConditionGroup).conditions as DataTableCondition[]))
    else flat.push(c as DataTableCondition)
  }
  return flat.map((c) => ({
    subject: c.column, operator: c.operator, left: ruleValue(c.column, rs), right: c.value !== undefined ? resolveTemplate(c.value, scope) : null,
    met: ruleConditionsMet({ match: 'all', conditions: [c] }, rs),
  }))
}

export function conditionsMet(group: AppRule['if'], scope: AppScope): boolean {
  return ruleConditionsMet((group ?? undefined) as DataTableConditionGroup | undefined, ruleScopeOf(scope))
}

/* ── The engine ──────────────────────────────────────────────────────── */

export interface DebugEntry {
  at: string
  depth: number
  kind: 'event' | 'condition' | 'action' | 'error' | 'skipped'
  rule?: string
  path?: string
  text: string
  data?: unknown
}

export interface EngineEnv {
  /** The current scope (params, variables, system variables, filters, widget state). */
  scope: () => AppScope
  /** Set a variable (page first, then app); `changed` when the value differs. Unknown names: { changed: false, error }. */
  setVariable: (name: string, value: unknown) => { changed: boolean; previous?: unknown; error?: string }
  /** A browser action; confirm resolves to true / false. */
  runClient: (action: LeafAction | Extract<RuleAction, { type: 'confirm' }>, scope: AppScope, rule: AppRule) => Promise<unknown>
  /** A server action through the app actions endpoint. */
  runServer: (rule: AppRule, path: string, slots: Record<string, string>) => Promise<unknown>
  log?: (entry: DebugEntry) => void
  now?: () => Date
}

export class RuleError extends Error {}

/**
 * Run every matching rule for an event, in order. Variable changes and API
 * results raise their own events (nested runs, bounded by
 * APP_RULE_LIMITS.chain). Never throws; returns the number of rules run.
 */
export async function runRules(rules: readonly AppRule[], event: RuleEvent, env: EngineEnv, depth = 0): Promise<number> {
  const log = (e: Omit<DebugEntry, 'at' | 'depth'>) => env.log?.({ at: (env.now?.() ?? new Date()).toISOString(), depth, ...e })
  const matching = rules.filter((r) => ruleMatches(r, event))
  if (!matching.length) return 0
  if (depth >= APP_RULE_LIMITS.chain) {
    log({ kind: 'skipped', text: `Stopped: rules triggering rules more than ${APP_RULE_LIMITS.chain} levels deep (${event.type})` })
    return 0
  }
  log({ kind: 'event', text: `${TRIGGER_LABELS[event.type]}${event.widget ? ` (${event.widget})` : ''}${event.variable ? ` (${event.variable})` : ''}`, data: event.payload })
  let ran = 0
  for (const rule of matching) {
    const base = () => ({ ...env.scope(), event: event.payload })
    const scope0 = base()
    const met = conditionsMet(rule.if, scope0)
    log({ kind: 'condition', rule: rule.id, text: `${rule.name || rule.id}: ${rule.if?.conditions.length ? (met ? 'conditions met' : 'conditions not met') : 'no conditions'}`, data: explainConditions(rule.if, scope0) })
    if (!met) continue
    ran++
    const results: unknown[] = []
    let last: unknown
    const nested: RuleEvent[] = []
    const runList = async (list: readonly RuleAction[], prefix: string, errorScope?: Record<string, unknown>): Promise<'ok' | 'stop' | 'error'> => {
      for (const [i, action] of list.entries()) {
        const path = `${prefix}.${i}`
        const scope: AppScope = { ...base(), result: last, results, ...(errorScope ? { event: { ...event.payload, error: errorScope } } : {}) }
        try {
          let result: unknown
          if (action.type === 'set_variable') {
            const set: Record<string, unknown> = {}
            for (const { name, value } of action.values) {
              const v = resolveTemplate(value, scope)
              const r = env.setVariable(name, v)
              if (r.error) throw new RuleError(r.error)
              set[name] = v
              if (r.changed) nested.push({ type: 'variable_changed', variable: `var.${name}`, payload: { name, value: v, previous: r.previous ?? null } })
            }
            result = set
          } else if (action.type === 'confirm') {
            const ok = await env.runClient(action, scope, rule)
            log({ kind: 'action', rule: rule.id, path, text: `${ACTION_LABELS.confirm}: ${ok ? 'confirmed' : 'declined'}` })
            const outcome = await runList(ok ? action.then : action.else, `${path}.${ok ? 'then' : 'else'}`, errorScope)
            result = ok
            if (outcome !== 'ok') return outcome
          } else if (isServerAction(action)) {
            result = await env.runServer(rule, path, resolveSlots(action, scope))
            if (action.type === 'call_reference') nested.push({ type: 'reference_returned', reference_id: action.reference_id, payload: { reference_id: action.reference_id, result } })
          } else {
            result = await env.runClient(action as LeafAction, scope, rule)
          }
          if (action.result_var) {
            if (!withinBudget(result)) throw new RuleError('The result is too large to keep in a variable')
            const r = env.setVariable(action.result_var, result)
            if (r.error) throw new RuleError(r.error)
            if (r.changed) nested.push({ type: 'variable_changed', variable: `var.${action.result_var}`, payload: { name: action.result_var, value: result, previous: r.previous ?? null } })
          }
          last = result
          if (prefix === 'then') results[i] = result
          if (action.type !== 'confirm') log({ kind: 'action', rule: rule.id, path, text: ACTION_LABELS[action.type], data: result })
          // Nested events run right after the action that raised them, so a chain reads in order.
          while (nested.length) await runRules(rules, nested.shift()!, env, depth + 1)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log({ kind: 'error', rule: rule.id, path, text: `${ACTION_LABELS[action.type]} failed: ${message}` })
          const mode = action.on_error ?? 'stop'
          if (mode === 'continue') { last = { error: message }; continue }
          if (mode === 'run' && !errorScope && rule.on_error_actions.length) await runList(rule.on_error_actions, 'on_error', { message, path })
          return 'error'
        }
      }
      return 'ok'
    }
    await runList(rule.then, 'then')
  }
  return ran
}

/* ── Validation ──────────────────────────────────────────────────────── */

export interface RuleKnown {
  params: readonly string[]
  vars: readonly string[]
  filters: readonly string[]
  widgets: ReadonlyMap<string, { type: string; buttons?: number }>
  pages: readonly string[]
  /** Required parameters per page slug (for "required parameter not passed"). */
  pageParams?: ReadonlyMap<string, ReadonlyArray<{ name: string; required: boolean; hasDefault: boolean }>>
}

export interface RuleProblem { rule: string; path?: string; message: string; level: 'error' | 'warning' }

/** Problems in rules: unknown variables / parameters / widgets / filters / pages, required page parameters not passed, timers. */
export function ruleProblems(rules: readonly AppRule[], known: RuleKnown): RuleProblem[] {
  const out: RuleProblem[] = []
  const vars = new Set(known.vars)
  const params = new Set(known.params)
  for (const rule of rules) {
    const add = (message: string, path?: string, level: RuleProblem['level'] = 'warning') => out.push({ rule: rule.id, ...(path ? { path } : {}), message, level })
    const w = rule.when
    if (w.widget && !known.widgets.has(w.widget)) add(`The trigger’s widget “${w.widget}” is not on this page`)
    if (w.filter && !known.filters.includes(w.filter)) add(`The trigger’s filter “${w.filter}” is not on this page`)
    if (w.variable) {
      const [kind, n] = w.variable.split('.')
      if (kind === 'var' && !vars.has(n)) add(`Unknown variable “${n}” in the trigger`)
      if (kind === 'param' && !params.has(n)) add(`Unknown parameter “${n}” in the trigger`)
    }
    if (w.type === 'timer' && !w.interval_s) add('Set how often the timer runs (at least every 30 seconds)', undefined, 'error')
    if (!rule.then.length) add('This rule has no actions')
    const refs = (text: string | null | undefined, path: string) => {
      if (!text) return
      const r = templateRefs(text)
      for (const v of r.vars) if (!vars.has(v)) add(`Unknown variable “${v}”`, path)
      for (const p of r.params) if (!params.has(p)) add(`Unknown parameter “${p}”`, path)
    }
    const condRefs = (g: AppRule['if'], path: string) => {
      for (const c of g?.conditions ?? []) {
        const list = isConditionGroup(c as DataTableCondition | DataTableConditionGroup) ? (c as DataTableConditionGroup).conditions as DataTableCondition[] : [c as DataTableCondition]
        for (const d of list) { refs(`{{${d.column}}}`, path); refs(d.value, path) }
      }
    }
    condRefs(rule.if, 'if')
    for (const { path, action: a } of ruleActions(rule)) {
      if (a.result_var && !vars.has(a.result_var)) add(`The result goes to “${a.result_var}”, which isn’t a declared variable`, path)
      for (const s of serverSlots(a)) refs(s.template, path)
      switch (a.type) {
        case 'set_variable':
          for (const v of a.values) { if (!vars.has(v.name)) add(`Unknown variable “${v.name}”`, path, 'error'); refs(v.value, path) }
          break
        case 'set_filter': if (!known.filters.includes(a.filter)) add(`The filter “${a.filter}” is not on this page`, path); refs(a.value, path); break
        case 'refresh': case 'set_visibility':
          for (const id of a.widgets) if (!known.widgets.has(id)) add(`The widget “${id}” is not on this page`, path)
          break
        case 'set_enabled': {
          const wd = known.widgets.get(a.widget)
          if (!wd) add(`The widget “${a.widget}” is not on this page`, path)
          else if (wd.type !== 'actions') add(`“${a.widget}” is not a Buttons widget`, path)
          break
        }
        case 'message': case 'copy': refs(a.text, path); break
        case 'navigate': case 'open_target': {
          const page = a.type === 'navigate' ? a.page_slug : a.target.kind === 'page' ? a.target.page_slug : null
          const map = a.type === 'navigate' ? a.params : a.target.kind === 'page' || a.target.kind === 'form' ? a.target.params : undefined
          if (page && !known.pages.includes(page)) add(`The page “${page}” is not in this app`, path, 'error')
          if (page) for (const p of known.pageParams?.get(page) ?? []) if (p.required && !p.hasDefault && !map?.[p.name]) add(`The page “${page}” needs the parameter “${p.name}”`, path)
          for (const s of Object.values(map ?? {})) {
            if (s.from === 'variable' && !vars.has(s.name)) add(`Unknown variable “${s.name}”`, path)
            if (s.from === 'param' && !params.has(s.name)) add(`Unknown parameter “${s.name}”`, path)
            if (s.from === 'expression') refs(s.expr, path)
          }
          if (a.type === 'open_target' && a.target.kind === 'url') {
            refs(a.target.url, path)
            if (!/^(https:\/\/|mailto:|\/(?!\/)|\{\{)/i.test(a.target.url.trim())) add('Use an https:// address, mailto: or a path starting with /', path, 'error')
          }
          break
        }
        default: break
      }
    }
  }
  return out
}

/* ── Descriptions (builder list, debug panel, docs) ──────────────────── */

export function describeTrigger(w: RuleTriggerConfig): string {
  const base = TRIGGER_LABELS[w.type]
  const bits: string[] = []
  if (w.widget) bits.push(`widget ${w.widget}`)
  if (w.type === 'button_click' && w.button !== null && w.button !== undefined) bits.push(`button ${w.button + 1}`)
  if (w.type === 'row_action' && w.button !== null && w.button !== undefined) bits.push(`action ${w.button + 1}`)
  if (w.variable) bits.push(w.variable)
  if (w.filter) bits.push(`filter ${w.filter}`)
  if (w.type === 'timer' && w.interval_s) bits.push(`every ${w.interval_s}s`)
  return bits.length ? `${base} (${bits.join(', ')})` : base
}

export function describeAction(a: RuleAction): string {
  switch (a.type) {
    case 'set_variable': return `Set ${a.values.map((v) => `${v.name} = ${v.value}`).join(', ')}`
    case 'set_filter': return `Set filter ${a.filter} = ${a.value}`
    case 'clear_filters': return a.filters.length ? `Clear ${a.filters.join(', ')}` : 'Clear all filters'
    case 'open_target': return `Open ${a.target.kind}${a.open_mode ? ` in ${a.open_mode.mode.replace('_', ' ')}` : ''}`
    case 'navigate': return `Go to ${a.page_slug}`
    case 'refresh': return a.widgets.length ? `Refresh ${a.widgets.join(', ')}` : 'Refresh every widget'
    case 'set_visibility': return `${a.visible === 'show' ? 'Show' : a.visible === 'hide' ? 'Hide' : 'Toggle'} ${a.widgets.join(', ')}`
    case 'set_enabled': return `${a.enabled ? 'Enable' : 'Disable'} ${a.widget}${a.button !== null && a.button !== undefined ? ` button ${a.button + 1}` : ''}`
    case 'message': return `Message: ${a.text}`
    case 'confirm': return `Confirm: ${a.title}`
    case 'call_reference': return `Call API reference${a.result_var ? ` → ${a.result_var}` : ''}`
    case 'table_lookup': return `Look up rows${a.result_var ? ` → ${a.result_var}` : ''}`
    case 'table_create': return `Create a row${a.result_var ? ` → ${a.result_var}` : ''}`
    case 'table_update': return `Update row ${a.row_id}`
    case 'start_workflow': return 'Start a workflow'
    default: return ACTION_LABELS[a.type]
  }
}
