/**
 * Per-user queue rules: when a task is assigned to someone, does it wait in
 * their task list as Queued (acceptance_status 'pending', they accept or
 * decline it) or go straight in (acceptance_status 'accepted')?
 *
 * Stored in users.preferences.queue_rules (JSONB, no migration). Version 2:
 *
 *   { version: 2,
 *     default: 'queue' | 'add',
 *     working_hours?: { days: [1..5], start: '09:00', end: '17:00', time_zone?: 'Pacific/Auckland' },
 *     rules: [{ id, name?, enabled, match: 'all' | 'any',
 *               conditions: [{ field, op, value? }],
 *               then: 'queue' | 'add' }] }
 *
 * Rules run in order; the first enabled rule whose conditions match (all of
 * them, or any one with match 'any') wins; no match → default. A rule with
 * no conditions matches every task. Fields and operators: QUEUE_FIELD_SPECS.
 *
 * Back-compat, migrated on read (nothing rewritten in the database):
 *  - version 1, `{ default, rules: [{ when: { priority_at_least?, source?,
 *    workflow_id?, assigned_by_user_id? }, then }] }`, becomes one rule per
 *    entry with the same conditions (match all);
 *  - without queue_rules, the older single threshold
 *    users.preferences.queue_bypass_priority (default 'high') applies exactly
 *    as before: priority at or above it → add, anything else → queue.
 *
 * Facts a condition needs but the caller doesn't know (undefined) never
 * match, whatever the operator; org conditions (manager chain, reports,
 * teams / units / projects of the assigner) need the org context the server
 * loads once per batch (queue-rules-server.ts) — without it they don't match.
 *
 * A workflow User Task node can override the assignee's rules
 * (queue_behaviour 'queue' | 'add'; 'rules' or absent = follow them).
 *
 * Pure and client-safe: the workflow engine, task creation, redirects, the
 * settings editor and its "Test a task" preview all decide through here.
 */

import { z } from 'zod'
import { compileUserRegex, MAX_REGEX_INPUT_LENGTH } from '@/lib/safe-regex'

export type QueueDecision = 'queue' | 'add'
export type QueuePriority = 'critical' | 'high' | 'medium' | 'low' | 'none'
export type QueueTaskSource = 'workflow' | 'manual'
/** A User Task node's queue behaviour: follow the assignee's rules (default), always queue, always add. */
export type QueueBehaviour = 'rules' | 'queue' | 'add'

export const QUEUE_RULES_VERSION = 2
export const MAX_QUEUE_RULES = 50
export const MAX_RULE_CONDITIONS = 20
export const MAX_RULE_VALUES = 100

/* ── Facts ──────────────────────────────────────────────────────────── */

/** Where a task came from: each path that lands a task tags it with what it knows. */
export const QUEUE_ORIGINS = ['workflow', 'manual', 'form', 'api', 'mcp', 'agent', 'ingest', 'redirect', 'escalation', 'reassign', 'invite', 'aad_group', 'team'] as const
export type QueueOrigin = (typeof QUEUE_ORIGINS)[number]

/** How the task reached the person. */
export const QUEUE_ASSIGNMENTS = ['individual', 'team', 'aad_group', 'collaborative'] as const
export type QueueAssignment = (typeof QUEUE_ASSIGNMENTS)[number]

/** Who assigned it, relative to the person whose rules these are. */
export const QUEUE_RELATIONS = ['self', 'manager', 'manager_chain', 'direct_report', 'any_report', 'automation'] as const
export type QueueRelation = (typeof QUEUE_RELATIONS)[number]

/** What the rules can look at when a task is assigned (unknown = undefined: such conditions don't match). */
export interface QueueTaskFacts {
  priority?: string | null
  source: QueueTaskSource
  workflow_id?: string | null
  /** The person who assigned it; null = no person (a workflow, a schedule, an agent). */
  assigned_by_user_id?: string | null
  /** Extra origin tags (redirect, escalation, form, api, mcp, agent, ingest, aad_group, team…). `source` always counts. */
  origins?: readonly string[] | null
  form_id?: string | null
  assignment?: QueueAssignment | null
  assigned_team_id?: string | null
  due_date?: string | null
  title?: string | null
  description?: string | null
  has_attachments?: boolean | null
  is_subtask?: boolean | null
  tags?: readonly string[] | null
  /** Evaluation time (tests, previews); now when absent. */
  now?: Date | number | null
}

/**
 * Per-person context the server loads (once per batch): the assignee's
 * reporting lines and the assigner's teams / org units (with their parent
 * units) / projects. Missing → org conditions don't match.
 */
export interface QueueOrgContext {
  /** The assignee's managers, nearest first. */
  managerChain: readonly string[]
  directReports: ReadonlySet<string>
  allReports: ReadonlySet<string>
  assignerTeams: ReadonlySet<string>
  assignerUnits: ReadonlySet<string>
  assignerProjects: ReadonlySet<string>
}

export interface QueueEvalContext {
  /** Whose rules these are (self-assigned, manager / report relations). */
  assigneeId?: string | null
  org?: QueueOrgContext | null
  /** The person's time zone (users.timezone) for day / working-hours conditions. */
  timeZone?: string | null
}

/* ── Conditions ─────────────────────────────────────────────────────── */

export const QUEUE_FIELDS = [
  'priority', 'source', 'workflow', 'form', 'assigned_by', 'assigned_by_relation', 'assigned_by_team', 'assigned_by_org_unit', 'assigned_by_project',
  'assignment', 'assigned_team', 'due', 'title', 'text', 'has_attachments', 'is_subtask', 'tags', 'day_of_week', 'working_hours',
] as const
export type QueueField = (typeof QUEUE_FIELDS)[number]

export const QUEUE_OPS = [
  'is', 'is_not', 'in', 'not_in', 'at_least', 'at_most', 'within', 'not_within', 'overdue', 'set', 'not_set',
  'contains', 'not_contains', 'matches', 'contains_any', 'contains_all', 'contains_none', 'inside', 'outside',
] as const
export type QueueOp = (typeof QUEUE_OPS)[number]

export interface QueueCondition {
  field: QueueField
  op: QueueOp
  value?: unknown
}

export interface QueueRule {
  id: string
  name?: string
  enabled: boolean
  match: 'all' | 'any'
  conditions: QueueCondition[]
  then: QueueDecision
}

export interface QueueWorkingHours {
  /** 0 = Sunday … 6 = Saturday. */
  days: number[]
  start: string
  end: string
  time_zone?: string
}

export interface QueueRules {
  version: 2
  default: QueueDecision
  rules: QueueRule[]
  working_hours?: QueueWorkingHours
}

/** The version 1 shape (still accepted on read and save). */
export interface LegacyQueueRuleCondition {
  priority_at_least?: QueuePriority
  source?: QueueTaskSource
  workflow_id?: string
  assigned_by_user_id?: string
}
export interface LegacyQueueRules {
  default: QueueDecision
  rules: Array<{ when: LegacyQueueRuleCondition; then: QueueDecision }>
}
/** @deprecated version 1 name. */
export type QueueRuleCondition = LegacyQueueRuleCondition

type ValueKind = 'none' | 'priority' | 'priorities' | 'ids' | 'origins' | 'assignments' | 'relations' | 'duration' | 'keywords' | 'pattern' | 'boolean' | 'days' | 'tags'

/** What each field can do: its operators and the value each operator takes. */
export const QUEUE_FIELD_SPECS: Record<QueueField, { ops: Partial<Record<QueueOp, ValueKind>>; org?: boolean }> = {
  priority: { ops: { at_least: 'priority', at_most: 'priority', is: 'priority', is_not: 'priority', in: 'priorities', not_in: 'priorities' } },
  source: { ops: { is: 'origins', is_not: 'origins', in: 'origins', not_in: 'origins' } },
  workflow: { ops: { is: 'ids', is_not: 'ids', in: 'ids', not_in: 'ids' } },
  form: { ops: { is: 'ids', is_not: 'ids', in: 'ids', not_in: 'ids' } },
  assigned_by: { ops: { is: 'ids', is_not: 'ids', in: 'ids', not_in: 'ids' } },
  assigned_by_relation: { ops: { is: 'relations', is_not: 'relations', in: 'relations', not_in: 'relations' } },
  assigned_by_team: { ops: { in: 'ids', not_in: 'ids' }, org: true },
  assigned_by_org_unit: { ops: { in: 'ids', not_in: 'ids' }, org: true },
  assigned_by_project: { ops: { in: 'ids', not_in: 'ids' }, org: true },
  assignment: { ops: { is: 'assignments', is_not: 'assignments', in: 'assignments', not_in: 'assignments' } },
  assigned_team: { ops: { in: 'ids', not_in: 'ids' } },
  due: { ops: { within: 'duration', not_within: 'duration', overdue: 'none', set: 'none', not_set: 'none' } },
  title: { ops: { contains: 'keywords', not_contains: 'keywords', matches: 'pattern' } },
  text: { ops: { contains: 'keywords', not_contains: 'keywords', matches: 'pattern' } },
  has_attachments: { ops: { is: 'boolean' } },
  is_subtask: { ops: { is: 'boolean' } },
  tags: { ops: { contains_any: 'tags', contains_all: 'tags', contains_none: 'tags' } },
  day_of_week: { ops: { in: 'days', not_in: 'days' } },
  working_hours: { ops: { inside: 'none', outside: 'none' } },
}

/** Relations that need the org context (self / automation don't). */
const ORG_RELATIONS: ReadonlySet<string> = new Set(['manager', 'manager_chain', 'direct_report', 'any_report'])

export const QUEUE_PRIORITIES: readonly QueuePriority[] = ['critical', 'high', 'medium', 'low', 'none']
export const QUEUE_BEHAVIOURS: readonly QueueBehaviour[] = ['rules', 'queue', 'add']

const PRIORITY_LEVELS: Record<QueuePriority, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 }
/** The legacy threshold when none is stored. */
export const DEFAULT_BYPASS_PRIORITY: QueuePriority = 'high'
export const DEFAULT_WORKING_HOURS: QueueWorkingHours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' }

/** A priority's level; unknown task priorities count as medium (as the engine always did). */
export function priorityLevel(priority: string | null | undefined): number {
  return priority && priority in PRIORITY_LEVELS ? PRIORITY_LEVELS[priority as QueuePriority] : PRIORITY_LEVELS.medium
}

/* ── Validation ─────────────────────────────────────────────────────── */

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Choose from the list.')
const priorityEnum = z.enum(['critical', 'high', 'medium', 'low', 'none'])
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM.')

function list<T extends z.ZodType>(item: T) {
  // One value or a list of them (is / is not take one; in / not in many — both accepted).
  return z.union([item, z.array(item).min(1).max(MAX_RULE_VALUES)])
}

const VALUE_SCHEMAS: Record<ValueKind, z.ZodType> = {
  none: z.undefined().or(z.null()),
  priority: priorityEnum,
  priorities: list(priorityEnum),
  ids: list(uuid),
  origins: list(z.enum(QUEUE_ORIGINS)),
  assignments: list(z.enum(QUEUE_ASSIGNMENTS)),
  relations: list(z.enum(QUEUE_RELATIONS)),
  duration: z.object({ amount: z.number().positive().max(100_000), unit: z.enum(['minutes', 'hours', 'days']) }).strict(),
  keywords: list(z.string().trim().min(1).max(200)),
  pattern: z.string().min(1).max(500).refine((p) => { try { compileUserRegex(p, 'i'); return true } catch { return false } }, 'That pattern isn’t allowed.'),
  boolean: z.boolean(),
  days: list(z.number().int().min(0).max(6)),
  tags: list(z.string().trim().min(1).max(100)),
}

const conditionSchema = z.object({
  field: z.enum(QUEUE_FIELDS),
  op: z.enum(QUEUE_OPS),
  value: z.unknown().optional(),
}).strict().superRefine((c, ctx) => {
  const kind = QUEUE_FIELD_SPECS[c.field].ops[c.op]
  if (!kind) { ctx.addIssue({ code: 'custom', message: `“${c.op}” doesn’t apply to ${c.field}.`, path: ['op'] }); return }
  const parsed = VALUE_SCHEMAS[kind].safeParse(c.value)
  if (!parsed.success) ctx.addIssue({ code: 'custom', message: parsed.error.issues[0]?.message ?? 'Invalid value.', path: ['value'] })
})

const ruleSchema = z.object({
  id: z.string().min(1).max(40),
  name: z.string().trim().max(80).optional(),
  enabled: z.boolean().default(true),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).max(MAX_RULE_CONDITIONS),
  then: z.enum(['queue', 'add']),
}).strict()

const workingHoursSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)).max(7),
  start: hhmm,
  end: hhmm,
  time_zone: z.string().max(64).refine(isTimeZone, 'Unknown time zone.').optional(),
}).strict()

export const queueRulesSchema = z.object({
  version: z.literal(2),
  default: z.enum(['queue', 'add']),
  rules: z.array(ruleSchema).max(MAX_QUEUE_RULES),
  working_hours: workingHoursSchema.optional(),
}).strict()

const legacyConditionSchema = z.object({
  priority_at_least: priorityEnum.optional(),
  source: z.enum(['workflow', 'manual']).optional(),
  workflow_id: uuid.optional(),
  assigned_by_user_id: uuid.optional(),
}).strict()

const legacyRulesSchema = z.object({
  default: z.enum(['queue', 'add']),
  rules: z.array(z.object({ when: legacyConditionSchema, then: z.enum(['queue', 'add']) }).strict()).max(MAX_QUEUE_RULES),
}).strict()

function isTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return true } catch { return false }
}

/** Drops empty (null / '') condition fields, so a cleared picker means "any". */
function compactLegacyCondition(when: unknown): unknown {
  if (!when || typeof when !== 'object' || Array.isArray(when)) return when
  return Object.fromEntries(Object.entries(when as Record<string, unknown>).filter(([, v]) => v !== null && v !== undefined && v !== ''))
}

/** A version 1 rule set as version 2 (same behaviour). */
export function migrateLegacyRules(legacy: LegacyQueueRules): QueueRules {
  return {
    version: 2,
    default: legacy.default,
    rules: legacy.rules.map((rule, index) => {
      const w = rule.when ?? {}
      const conditions: QueueCondition[] = []
      if (w.priority_at_least) conditions.push({ field: 'priority', op: 'at_least', value: w.priority_at_least })
      if (w.source) conditions.push({ field: 'source', op: 'is', value: w.source })
      if (w.workflow_id) conditions.push({ field: 'workflow', op: 'is', value: w.workflow_id })
      if (w.assigned_by_user_id) conditions.push({ field: 'assigned_by', op: 'is', value: w.assigned_by_user_id })
      return { id: `r${index + 1}`, enabled: true, match: 'all', conditions, then: rule.then }
    }),
  }
}

function isLegacyShape(raw: Record<string, unknown>): boolean {
  if (raw.version !== undefined) return false
  return Array.isArray(raw.rules) && raw.rules.every((r) => r && typeof r === 'object' && !('conditions' in (r as object)))
}

/** Drops values of operators that take none (the editor may leave one behind). */
function tidyV2(raw: Record<string, unknown>): unknown {
  if (!Array.isArray(raw.rules)) return raw
  return {
    ...raw,
    rules: raw.rules.map((r) => {
      if (!r || typeof r !== 'object' || !Array.isArray((r as Record<string, unknown>).conditions)) return r
      const rule = r as Record<string, unknown>
      return {
        ...rule,
        ...(typeof rule.name === 'string' && !rule.name.trim() ? { name: undefined } : {}),
        conditions: (rule.conditions as unknown[]).map((c) => {
          if (!c || typeof c !== 'object') return c
          const cond = c as Record<string, unknown>
          const spec = QUEUE_FIELD_SPECS[cond.field as QueueField]
          const kind = spec?.ops[cond.op as QueueOp]
          if (kind === 'none') { const { value: _drop, ...rest } = cond; void _drop; return rest }
          return cond
        }),
      }
    }),
  }
}

/**
 * Validate rules from the settings editor / an API: version 2, or version 1
 * (migrated). Empty version 1 condition fields are dropped.
 */
export function parseQueueRules(input: unknown): { ok: true; value: QueueRules } | { ok: false; error: string } {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : null
  if (!raw) return { ok: false, error: 'Some queue rules are incomplete. Check each rule and try again.' }
  const tooMany = (issues: ReadonlyArray<{ code: string; path: PropertyKey[] }>) => issues.some((i) => i.code === 'too_big' && i.path.length === 1 && i.path[0] === 'rules')
  if (isLegacyShape(raw)) {
    const prepared = { ...raw, rules: (raw.rules as unknown[]).map((r) => (r && typeof r === 'object' ? { ...(r as object), when: compactLegacyCondition((r as Record<string, unknown>).when ?? {}) } : r)) }
    const parsed = legacyRulesSchema.safeParse(prepared)
    if (!parsed.success) return { ok: false, error: tooMany(parsed.error.issues) ? `Keep to ${MAX_QUEUE_RULES} rules or fewer.` : 'Some queue rules are incomplete. Check each rule and try again.' }
    return { ok: true, value: migrateLegacyRules(parsed.data as LegacyQueueRules) }
  }
  const parsed = queueRulesSchema.safeParse(tidyV2(raw))
  if (!parsed.success) {
    if (tooMany(parsed.error.issues)) return { ok: false, error: `Keep to ${MAX_QUEUE_RULES} rules or fewer.` }
    const issue = parsed.error.issues[0]
    const ruleIndex = issue?.path[0] === 'rules' && typeof issue.path[1] === 'number' ? issue.path[1] : null
    if (ruleIndex !== null && issue?.code === 'too_big' && issue.path[2] === 'conditions') return { ok: false, error: `Rule ${ruleIndex + 1}: keep to ${MAX_RULE_CONDITIONS} conditions or fewer.` }
    if (ruleIndex !== null && issue?.code === 'custom') return { ok: false, error: `Rule ${ruleIndex + 1}: ${issue.message}` }
    return { ok: false, error: ruleIndex !== null ? `Rule ${ruleIndex + 1} is incomplete. Check it and try again.` : 'Some queue rules are incomplete. Check each rule and try again.' }
  }
  const ids = new Set<string>()
  for (const rule of parsed.data.rules) {
    if (ids.has(rule.id)) return { ok: false, error: 'Two rules have the same id.' }
    ids.add(rule.id)
  }
  return { ok: true, value: parsed.data as QueueRules }
}

/** The legacy single threshold as rules: priority at or above it → add, else queue. */
export function rulesFromBypassPriority(bypass: unknown): QueueRules {
  const threshold = typeof bypass === 'string' && bypass in PRIORITY_LEVELS ? bypass as QueuePriority : DEFAULT_BYPASS_PRIORITY
  return { version: 2, default: 'queue', rules: [{ id: 'r1', enabled: true, match: 'all', conditions: [{ field: 'priority', op: 'at_least', value: threshold }], then: 'add' }] }
}

/**
 * A person's effective rules from their users.preferences: queue_rules when
 * stored and valid (version 1 migrated), else derived from
 * queue_bypass_priority (default high).
 */
export function resolveQueueRules(preferences: unknown): QueueRules {
  const prefs = preferences && typeof preferences === 'object' ? preferences as Record<string, unknown> : {}
  if (prefs.queue_rules !== undefined && prefs.queue_rules !== null) {
    const parsed = parseQueueRules(prefs.queue_rules)
    if (parsed.ok) return parsed.value
  }
  return rulesFromBypassPriority(prefs.queue_bypass_priority)
}

/** Any rules (version 1 or 2) as version 2, without validating (callers pass parsed rules). */
function asV2(rules: QueueRules | LegacyQueueRules): QueueRules {
  return (rules as QueueRules).version === 2 ? rules as QueueRules : migrateLegacyRules(rules as LegacyQueueRules)
}

/* ── Evaluation ─────────────────────────────────────────────────────── */

const many = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null ? [] : [value])
const strings = (value: unknown): string[] => many(value).map((v) => String(v))

/** is / in: the fact is one of the values; is not / not in: none of them. Unknown facts don't match. */
function setMatch(op: QueueOp, fact: readonly string[] | null | undefined, wanted: string[]): boolean {
  if (fact === undefined) return false
  const have = fact ?? []
  const hit = wanted.some((w) => have.includes(w))
  if (op === 'is' || op === 'in') return hit
  if (op === 'is_not' || op === 'not_in') return !hit
  return false
}

function nowOf(facts: QueueTaskFacts): number {
  const n = facts.now
  return n instanceof Date ? n.getTime() : typeof n === 'number' ? n : Date.now()
}

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const

/** Weekday (0 = Sunday) and minutes past midnight in a time zone. */
function localClock(at: number, timeZone: string): { day: number; minutes: number } {
  let zone = timeZone
  if (!isTimeZone(zone)) zone = 'UTC'
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(at))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'))
  return { day: day < 0 ? 0 : day, minutes: Number(get('hour')) * 60 + Number(get('minute')) }
}

function minutesOf(hhmmText: string): number {
  const [h, m] = hhmmText.split(':').map(Number)
  return h * 60 + m
}

function textMatch(op: QueueOp, haystack: string | null | undefined, value: unknown): boolean {
  if (haystack === undefined) return false
  const text = (haystack ?? '').slice(0, MAX_REGEX_INPUT_LENGTH)
  if (op === 'matches') {
    try { return compileUserRegex(String(value), 'i').test(text) } catch { return false }
  }
  const lower = text.toLowerCase()
  const hit = strings(value).some((k) => k.trim() && lower.includes(k.trim().toLowerCase()))
  return op === 'contains' ? hit : op === 'not_contains' ? !hit : false
}

/** Whether one condition holds for the task. */
export function conditionMatches(cond: QueueCondition, facts: QueueTaskFacts, ctx: QueueEvalContext = {}, ruleSet?: Pick<QueueRules, 'working_hours'>): boolean {
  const { op, value } = cond
  const assigner = facts.assigned_by_user_id ?? null
  const org = ctx.org ?? null
  switch (cond.field) {
    case 'priority': {
      const level = priorityLevel(facts.priority)
      if (op === 'at_least') return level >= priorityLevel(String(value))
      if (op === 'at_most') return level <= priorityLevel(String(value))
      return setMatch(op, [QUEUE_PRIORITIES.find((p) => PRIORITY_LEVELS[p] === level) ?? 'medium'], strings(value))
    }
    case 'source':
      return setMatch(op, [...new Set([facts.source, ...(facts.origins ?? [])].filter(Boolean) as string[])], strings(value))
    case 'workflow':
      return setMatch(op, facts.workflow_id === undefined ? [] : facts.workflow_id ? [facts.workflow_id] : [], strings(value))
    case 'form':
      return setMatch(op, facts.form_id === undefined ? undefined : facts.form_id ? [facts.form_id] : [], strings(value))
    case 'assigned_by':
      return setMatch(op, assigner ? [assigner] : [], strings(value))
    case 'assigned_by_relation': {
      const wanted = strings(value)
      if (wanted.some((r) => ORG_RELATIONS.has(r)) && !org) return false
      const relations: string[] = []
      if (!assigner) relations.push('automation')
      else {
        if (ctx.assigneeId && assigner === ctx.assigneeId) relations.push('self')
        if (org) {
          if (org.managerChain[0] === assigner) relations.push('manager')
          if (org.managerChain.includes(assigner)) relations.push('manager_chain')
          if (org.directReports.has(assigner)) relations.push('direct_report')
          if (org.allReports.has(assigner)) relations.push('any_report')
        }
      }
      return setMatch(op, relations, wanted)
    }
    case 'assigned_by_team':
      return org ? setMatch(op, assigner ? [...org.assignerTeams] : [], strings(value)) : false
    case 'assigned_by_org_unit':
      return org ? setMatch(op, assigner ? [...org.assignerUnits] : [], strings(value)) : false
    case 'assigned_by_project':
      return org ? setMatch(op, assigner ? [...org.assignerProjects] : [], strings(value)) : false
    case 'assignment':
      return setMatch(op, facts.assignment === undefined ? undefined : facts.assignment ? [facts.assignment] : [], strings(value))
    case 'assigned_team':
      return setMatch(op, facts.assigned_team_id === undefined ? undefined : facts.assigned_team_id ? [facts.assigned_team_id] : [], strings(value))
    case 'due': {
      if (facts.due_date === undefined) return false
      const due = facts.due_date ? Date.parse(facts.due_date) : NaN
      const hasDue = Number.isFinite(due)
      if (op === 'set') return hasDue
      if (op === 'not_set') return !hasDue
      if (!hasDue) return false
      const now = nowOf(facts)
      if (op === 'overdue') return due < now
      const d = value as { amount: number; unit: keyof typeof UNIT_MS }
      const inWindow = due <= now + d.amount * UNIT_MS[d.unit]
      return op === 'within' ? inWindow : op === 'not_within' ? !inWindow : false
    }
    case 'title':
      return textMatch(op, facts.title, value)
    case 'text':
      return textMatch(op, facts.title === undefined && facts.description === undefined ? undefined : `${facts.title ?? ''}\n${facts.description ?? ''}`, value)
    case 'has_attachments':
      return facts.has_attachments === undefined || facts.has_attachments === null ? false : facts.has_attachments === value
    case 'is_subtask':
      return facts.is_subtask === undefined || facts.is_subtask === null ? false : facts.is_subtask === value
    case 'tags': {
      if (facts.tags === undefined) return false
      const have = (facts.tags ?? []).map((t) => t.toLowerCase())
      const wanted = strings(value).map((t) => t.toLowerCase())
      if (op === 'contains_any') return wanted.some((t) => have.includes(t))
      if (op === 'contains_all') return wanted.every((t) => have.includes(t))
      if (op === 'contains_none') return !wanted.some((t) => have.includes(t))
      return false
    }
    case 'day_of_week': {
      const hours = ruleSet?.working_hours
      const { day } = localClock(nowOf(facts), hours?.time_zone ?? ctx.timeZone ?? 'UTC')
      return setMatch(op, [String(day)], strings(value))
    }
    case 'working_hours': {
      const hours = ruleSet?.working_hours ?? DEFAULT_WORKING_HOURS
      const { day, minutes } = localClock(nowOf(facts), hours.time_zone ?? ctx.timeZone ?? 'UTC')
      const start = minutesOf(hours.start)
      const end = minutesOf(hours.end)
      const inTime = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end
      const inside = hours.days.includes(day) && inTime
      return op === 'inside' ? inside : op === 'outside' ? !inside : false
    }
  }
}

/** Whether a rule matches: enabled, and all (or any) of its conditions hold; no conditions = every task. */
export function ruleMatches(rule: QueueRule, facts: QueueTaskFacts, ctx: QueueEvalContext = {}, ruleSet?: Pick<QueueRules, 'working_hours'>): boolean {
  if (rule.enabled === false) return false
  if (!rule.conditions.length) return true
  const test = (c: QueueCondition) => conditionMatches(c, facts, ctx, ruleSet)
  return rule.match === 'any' ? rule.conditions.some(test) : rule.conditions.every(test)
}

export interface QueueExplanation {
  decision: QueueDecision
  /** The rule that decided (index in the list), or null: the default. */
  ruleIndex: number | null
  rule: QueueRule | null
}

/** The decision and which rule made it (the editor's "Test a task" preview). */
export function explainQueueRules(rules: QueueRules | LegacyQueueRules, facts: QueueTaskFacts, ctx: QueueEvalContext = {}): QueueExplanation {
  const set = asV2(rules)
  for (let i = 0; i < set.rules.length; i++) {
    if (ruleMatches(set.rules[i], facts, ctx, set)) return { decision: set.rules[i].then, ruleIndex: i, rule: set.rules[i] }
  }
  return { decision: set.default, ruleIndex: null, rule: null }
}

/** First matching rule wins; no match → the default. */
export function evaluateQueueRules(rules: QueueRules | LegacyQueueRules, facts: QueueTaskFacts, ctx: QueueEvalContext = {}): QueueDecision {
  return explainQueueRules(rules, facts, ctx).decision
}

/** Which org data the rules need (the server loads only that, once per batch). */
export function queueRulesOrgNeeds(rules: QueueRules): { reporting: boolean; teams: boolean; units: boolean; projects: boolean } {
  const needs = { reporting: false, teams: false, units: false, projects: false }
  for (const rule of rules.rules) {
    if (rule.enabled === false) continue
    for (const c of rule.conditions) {
      if (c.field === 'assigned_by_relation' && strings(c.value).some((r) => ORG_RELATIONS.has(r))) needs.reporting = true
      if (c.field === 'assigned_by_team') needs.teams = true
      if (c.field === 'assigned_by_org_unit') needs.units = true
      if (c.field === 'assigned_by_project') { needs.projects = true; needs.teams = true }
    }
  }
  return needs
}

/** Normalise a node's queue_behaviour config ('rules' when absent or unknown). */
export function normaliseQueueBehaviour(value: unknown): QueueBehaviour {
  return value === 'queue' || value === 'add' ? value : 'rules'
}

/**
 * The acceptance_status for a task landing with someone: 'pending' (Queued)
 * or 'accepted' (added to their list). A node override wins over the rules.
 */
export function decideAcceptance(input: {
  preferences: unknown
  facts: QueueTaskFacts
  override?: unknown
  context?: QueueEvalContext
}): 'pending' | 'accepted' {
  const behaviour = normaliseQueueBehaviour(input.override)
  const decision = behaviour === 'rules' ? evaluateQueueRules(resolveQueueRules(input.preferences), input.facts, input.context ?? {}) : behaviour
  return decision === 'queue' ? 'pending' : 'accepted'
}

/* ── Labels (settings editor, docs) ─────────────────────────────────── */

export const QUEUE_DECISION_LABELS: Record<QueueDecision, string> = {
  queue: 'Queue for me to accept',
  add: 'Add straight to my tasks',
}

export const QUEUE_BEHAVIOUR_LABELS: Record<QueueBehaviour, string> = {
  rules: "Follow the assignee's queue rules",
  queue: 'Always queue (assignee accepts or declines)',
  add: 'Always add straight to their tasks',
}

export const QUEUE_FIELD_LABELS: Record<QueueField, string> = {
  priority: 'Priority',
  source: 'Came from',
  workflow: 'Workflow',
  form: 'Form',
  assigned_by: 'Assigned by',
  assigned_by_relation: 'Assigned by (relationship)',
  assigned_by_team: 'Assigned by a member of team',
  assigned_by_org_unit: 'Assigned by someone in org unit',
  assigned_by_project: 'Assigned by someone on project',
  assignment: 'Reached me',
  assigned_team: 'Assigned through team',
  due: 'Due date',
  title: 'Title',
  text: 'Title or description',
  has_attachments: 'Has attachments',
  is_subtask: 'Is a subtask',
  tags: 'Tags',
  day_of_week: 'Day it arrives',
  working_hours: 'Time it arrives',
}

/** Field groups for the editor's picker. */
export const QUEUE_FIELD_GROUPS: Array<{ label: string; fields: QueueField[] }> = [
  { label: 'Who it’s from', fields: ['assigned_by', 'assigned_by_relation', 'assigned_by_team', 'assigned_by_org_unit', 'assigned_by_project'] },
  { label: 'Where it came from', fields: ['source', 'workflow', 'form', 'assignment', 'assigned_team'] },
  { label: 'What it is', fields: ['priority', 'due', 'title', 'text', 'has_attachments', 'is_subtask', 'tags'] },
  { label: 'When it arrives', fields: ['day_of_week', 'working_hours'] },
]

export const QUEUE_OP_LABELS: Record<QueueOp, string> = {
  is: 'is', is_not: 'is not', in: 'is any of', not_in: 'is none of', at_least: 'is at least', at_most: 'is at most',
  within: 'is within', not_within: 'is later than', overdue: 'is already past', set: 'is set', not_set: 'is not set',
  contains: 'contains any of', not_contains: 'contains none of', matches: 'matches pattern',
  contains_any: 'include any of', contains_all: 'include all of', contains_none: 'include none of',
  inside: 'is inside working hours', outside: 'is outside working hours',
}

export const QUEUE_ORIGIN_LABELS: Record<QueueOrigin, string> = {
  workflow: 'A workflow', manual: 'Created by a person', form: 'A form submission', api: 'The API', mcp: 'An MCP client',
  agent: 'An AI agent', ingest: 'Another system (ingest)', redirect: 'A redirect', escalation: 'An escalation',
  reassign: 'A manager’s reassignment', invite: 'An invitation to collaborate', aad_group: 'An AAD group', team: 'A team pool',
}

export const QUEUE_ASSIGNMENT_LABELS: Record<QueueAssignment, string> = {
  individual: 'Directly to me', team: 'Through a team', aad_group: 'Through an AAD group', collaborative: 'With other people (collaborative)',
}

export const QUEUE_RELATION_LABELS: Record<QueueRelation, string> = {
  self: 'Myself', manager: 'My manager', manager_chain: 'Anyone above me (manager chain)', direct_report: 'One of my direct reports',
  any_report: 'Anyone I manage (any level)', automation: 'No person (a workflow, schedule or agent)',
}

export const QUEUE_DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export const QUEUE_PRIORITY_LABELS: Record<QueuePriority, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', none: 'None' }

/** A new rule's id (unique in the list). */
export function newRuleId(existing: ReadonlyArray<{ id: string }>): string {
  const used = new Set(existing.map((r) => r.id))
  let n = existing.length + 1
  while (used.has(`r${n}`)) n++
  return `r${n}`
}

/** The default value for a field + operator (the editor's starting point). */
export function defaultConditionValue(field: QueueField, op: QueueOp): unknown {
  const kind = QUEUE_FIELD_SPECS[field].ops[op]
  switch (kind) {
    case 'priority': return 'high'
    case 'priorities': return ['high']
    case 'origins': return op === 'is' || op === 'is_not' ? 'workflow' : ['workflow']
    case 'assignments': return op === 'is' || op === 'is_not' ? 'individual' : ['individual']
    case 'relations': return op === 'is' || op === 'is_not' ? 'manager' : ['manager']
    case 'duration': return { amount: 1, unit: 'days' }
    case 'boolean': return true
    case 'days': return [6, 0]
    case 'keywords': case 'tags': case 'ids': return []
    case 'pattern': return ''
    default: return undefined
  }
}

/** One plain-language line for a rule (summary, preview). */
export function describeRuleSet(rules: QueueRules): string {
  const enabled = rules.rules.filter((r) => r.enabled !== false).length
  const base = rules.default === 'queue' ? 'New tasks are queued for you to accept' : 'New tasks go straight to your list'
  return enabled ? `${base}, except where ${enabled === 1 ? 'your rule says' : `one of your ${enabled} rules says`} otherwise.` : `${base}.`
}

/** Task columns queueFactsFromTask reads (redirect / escalate / reassign paths). */
export const QUEUE_TASK_COLUMNS = 'priority, is_workflow_task, workflow_id, metadata, assignment_type, assignment_mode, assigned_team_id, due_date, title, description, parent_task_id, tags'

/** The rules' facts for an existing task landing with someone new (a redirect, escalation, reassignment…). */
export function queueFactsFromTask(task: Record<string, unknown> | null | undefined, input: { assignedBy: string | null; origins: readonly string[]; hasAttachments?: boolean | null }): QueueTaskFacts {
  const t = task ?? {}
  const meta = (t.metadata && typeof t.metadata === 'object' ? t.metadata : {}) as Record<string, unknown>
  const formRef = (meta.form_ref && typeof meta.form_ref === 'object' ? meta.form_ref : {}) as Record<string, unknown>
  const workflow = Boolean(t.is_workflow_task)
  const type = typeof t.assignment_type === 'string' ? t.assignment_type : null
  return {
    priority: typeof t.priority === 'string' ? t.priority : null,
    source: workflow ? 'workflow' : 'manual',
    workflow_id: typeof t.workflow_id === 'string' ? t.workflow_id : null,
    assigned_by_user_id: input.assignedBy,
    origins: [...input.origins, ...(typeof formRef.form_id === 'string' ? ['form'] : [])],
    form_id: typeof formRef.form_id === 'string' ? formRef.form_id : null,
    assignment: t.assignment_mode === 'collaborative' ? 'collaborative' : 'individual',
    assigned_team_id: typeof t.assigned_team_id === 'string' && (type === 'team' || type === 'aad_group') ? t.assigned_team_id : null,
    due_date: typeof t.due_date === 'string' ? t.due_date : null,
    title: typeof t.title === 'string' ? t.title : null,
    description: typeof t.description === 'string' ? t.description : null,
    has_attachments: input.hasAttachments,
    is_subtask: task ? Boolean(t.parent_task_id) : undefined,
    tags: Array.isArray(t.tags) ? (t.tags as unknown[]).map(String) : [],
  }
}
