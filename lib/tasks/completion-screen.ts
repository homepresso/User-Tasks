/**
 * The Task completed screen: what replaces a task's form / page after the
 * person actions it (completes it with an outcome). Pure and isomorphic —
 * the settings model, the per-form override, the template rendering and the
 * "what happens next" line. The server side (the workspace setting, the next
 * step after completion, the next task) is lib/services/task-completion-screen.ts.
 *
 * Where the wording comes from, most specific first:
 *   1. the task form's per-outcome heading / subheading
 *      (layout.task_completed.outcomes["Reject"]);
 *   2. the task form's override (layout.task_completed: blank = inherit);
 *   3. the workspace default (tenants.settings.tasks.completion_screen;
 *      Settings → Workspace → Task completion);
 *   4. the built-in defaults below.
 *
 * Templates take {{task.title}}, {{outcome}}, {{next.step}},
 * {{next.assignee}}, {{user.name}} and {{process.name}}. A placeholder with
 * no value renders empty; dangling separators ("Approved: ") and empty
 * brackets are tidied away, and a template that renders empty falls back to
 * the built-in default.
 */

import { isPlainObject } from '@/lib/utils/guards'
import { classifyOutcome, type OutcomeKind } from '@/lib/home/activity'

/* ── Settings ────────────────────────────────────────────────────────── */

export type CompletionBackTarget = 'tasks' | 'home'

export interface TaskCompletionSettings {
  /** Show the screen after a task is actioned (off: the task page just refreshes, as before). */
  enabled: boolean
  heading: string
  subheading: string
  /** What happens next: the run moved on to someone. */
  next_assigned: string
  /** What happens next: the run finished. */
  next_complete: string
  /** What happens next: a timer, an event or a step with no one on it. */
  next_waiting: string
  show_next_task: boolean
  next_task_label: string
  show_back: boolean
  /** Blank: "Back to my tasks" / "Back to Home" by the target. */
  back_label: string
  back_target: CompletionBackTarget
  show_view_flow: boolean
  view_flow_label: string
}

export const DEFAULT_TASK_COMPLETION: TaskCompletionSettings = {
  enabled: true,
  heading: '{{outcome}}: {{task.title}}',
  subheading: 'Thanks, {{user.name}}. Your response is recorded.',
  next_assigned: 'Now with {{next.assignee}}',
  next_complete: 'Process complete',
  next_waiting: 'Waiting on {{next.step}}',
  show_next_task: true,
  next_task_label: 'Next task',
  show_back: true,
  back_label: '',
  back_target: 'tasks',
  show_view_flow: true,
  view_flow_label: 'Process view',
}

export const TASK_COMPLETION_LIMITS = { template: 300, label: 60, outcomes: 20, outcomeKey: 200 } as const

/** The text settings and their limits (the rest are switches and the back target). */
export const COMPLETION_TEXT_KEYS = ['heading', 'subheading', 'next_assigned', 'next_complete', 'next_waiting', 'next_task_label', 'back_label', 'view_flow_label'] as const
export type CompletionTextKey = typeof COMPLETION_TEXT_KEYS[number]
export const COMPLETION_SWITCH_KEYS = ['enabled', 'show_next_task', 'show_back', 'show_view_flow'] as const
export type CompletionSwitchKey = typeof COMPLETION_SWITCH_KEYS[number]

const LABEL_KEYS = new Set<CompletionTextKey>(['next_task_label', 'back_label', 'view_flow_label'])
export const completionTextLimit = (key: CompletionTextKey) => (LABEL_KEYS.has(key) ? TASK_COMPLETION_LIMITS.label : TASK_COMPLETION_LIMITS.template)

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max)
}

/** Stored workspace setting → the full settings (unknown / bad values take the defaults). Blank texts keep the default. */
export function parseTaskCompletionSettings(raw: unknown): TaskCompletionSettings {
  const out: TaskCompletionSettings = { ...DEFAULT_TASK_COMPLETION }
  if (!isPlainObject(raw)) return out
  for (const key of COMPLETION_SWITCH_KEYS) if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean
  for (const key of COMPLETION_TEXT_KEYS) {
    const text = cleanText(raw[key], completionTextLimit(key))
    // back_label may be blank on purpose (the target's own label); the rest fall back.
    if (text !== undefined && (text || key === 'back_label')) out[key] = text
  }
  if (raw.back_target === 'tasks' || raw.back_target === 'home') out.back_target = raw.back_target
  return out
}

/** tenants.settings → the workspace's Task completed screen settings (tenants.settings.tasks.completion_screen). */
export function taskCompletionFromTenantSettings(settings: unknown): TaskCompletionSettings {
  const tasks = isPlainObject(settings) && isPlainObject(settings.tasks) ? settings.tasks : null
  return parseTaskCompletionSettings(tasks?.completion_screen)
}

/** A partial update (API / MCP / the settings page) checked: the message says what is wrong, else null. */
export function taskCompletionInputProblem(input: Record<string, unknown>): string | null {
  for (const key of COMPLETION_SWITCH_KEYS) if (input[key] !== undefined && typeof input[key] !== 'boolean') return `${key} must be true or false`
  for (const key of COMPLETION_TEXT_KEYS) {
    if (input[key] === undefined) continue
    if (typeof input[key] !== 'string') return `${key} must be text`
    if ((input[key] as string).length > completionTextLimit(key)) return `${key} must be at most ${completionTextLimit(key)} characters`
  }
  if (input.back_target !== undefined && input.back_target !== 'tasks' && input.back_target !== 'home') return 'back_target must be tasks or home'
  return null
}

/* ── Per-form override (layout.task_completed) ───────────────────────── */

export interface TaskCompletedOutcomeOverride { heading?: string; subheading?: string }

/** The task form's own wording; anything absent inherits the workspace default. */
export type TaskCompletedOverride = Partial<TaskCompletionSettings> & {
  /** A heading / subheading per outcome, keyed by the outcome as the step names it ("Reject"). */
  outcomes?: Record<string, TaskCompletedOutcomeOverride>
}

/** Stored `layout.task_completed` → its clean form (null when it overrides nothing). Blank texts are dropped (= inherit). */
export function normalizeTaskCompletedOverride(raw: unknown): TaskCompletedOverride | null {
  if (!isPlainObject(raw)) return null
  const out: TaskCompletedOverride = {}
  for (const key of COMPLETION_SWITCH_KEYS) if (typeof raw[key] === 'boolean') out[key] = raw[key] as boolean
  for (const key of COMPLETION_TEXT_KEYS) {
    const text = cleanText(raw[key], completionTextLimit(key))
    if (text) out[key] = text
  }
  if (raw.back_target === 'tasks' || raw.back_target === 'home') out.back_target = raw.back_target
  if (isPlainObject(raw.outcomes)) {
    const outcomes: Record<string, TaskCompletedOutcomeOverride> = {}
    for (const [key, value] of Object.entries(raw.outcomes).slice(0, TASK_COMPLETION_LIMITS.outcomes)) {
      const name = key.trim().slice(0, TASK_COMPLETION_LIMITS.outcomeKey)
      if (!name || !isPlainObject(value)) continue
      const heading = cleanText(value.heading, TASK_COMPLETION_LIMITS.template)
      const subheading = cleanText(value.subheading, TASK_COMPLETION_LIMITS.template)
      if (heading || subheading) outcomes[name] = { ...(heading ? { heading } : {}), ...(subheading ? { subheading } : {}) }
    }
    if (Object.keys(outcomes).length) out.outcomes = outcomes
  }
  return Object.keys(out).length ? out : null
}

/** The task form's override, read from its layout. */
export function taskCompletedOverride(layout: unknown): TaskCompletedOverride | null {
  return isPlainObject(layout) ? normalizeTaskCompletedOverride(layout.task_completed) : null
}

/** The layout with its override set (null / empty: the key is dropped, so old forms stay unchanged). */
export function withTaskCompletedOverride<T extends { task_completed?: TaskCompletedOverride }>(layout: T, override: TaskCompletedOverride | null): T {
  const clean = normalizeTaskCompletedOverride(override)
  const out = { ...layout }
  if (clean) out.task_completed = clean
  else delete out.task_completed
  return out
}

/** The per-outcome wording for this outcome: exact key, else case-insensitive. */
function outcomeOverride(override: TaskCompletedOverride | null, outcome: string): TaskCompletedOutcomeOverride | null {
  const map = override?.outcomes
  if (!map) return null
  if (map[outcome]) return map[outcome]
  const lower = outcome.trim().toLowerCase()
  const key = Object.keys(map).find((k) => k.toLowerCase() === lower)
  return key ? map[key] : null
}

/** The settings the screen uses: workspace defaults, the form's override, then its per-outcome wording. */
export function resolveTaskCompletion(workspace: TaskCompletionSettings, override: TaskCompletedOverride | null, outcome?: string | null): TaskCompletionSettings {
  const out: TaskCompletionSettings = { ...workspace }
  if (override) {
    for (const key of COMPLETION_SWITCH_KEYS) if (typeof override[key] === 'boolean') out[key] = override[key] as boolean
    for (const key of COMPLETION_TEXT_KEYS) if (override[key]) out[key] = override[key] as string
    if (override.back_target) out.back_target = override.back_target
  }
  const perOutcome = outcome ? outcomeOverride(override, outcome) : null
  if (perOutcome?.heading) out.heading = perOutcome.heading
  if (perOutcome?.subheading) out.subheading = perOutcome.subheading
  return out
}

/* ── What happens next ───────────────────────────────────────────────── */

/**
 * Where the run is after the task (computed on the server, names and step
 * labels only):
 *  - assigned:   open task(s) — the step and who it is with;
 *  - waiting:    a timer, an event or a step no one has;
 *  - complete:   the run finished;
 *  - processing: the resume is still on the queue (ask again shortly);
 *  - stopped:    the run failed or was cancelled;
 *  - none:       the task is not part of a workflow;
 *  - unknown:    the caller may not see the run (or it is gone).
 */
export type TaskNextState = 'assigned' | 'waiting' | 'complete' | 'processing' | 'stopped' | 'none' | 'unknown'

export interface TaskNextStep {
  state: TaskNextState
  run_id: string | null
  /** Where the run is now: each step's label and who it is with (names only). */
  steps: Array<{ name: string; assignees: string[]; team: string | null }>
  /** The process (workflow) name, when the caller may see the run. */
  process: { name: string } | null
  /** Which run view the caller can open: full (/automations/runs/<id>), progress (/home/runs/<id>), or none. */
  run_view: 'full' | 'progress' | null
}

export const NO_NEXT_STEP: TaskNextStep = { state: 'none', run_id: null, steps: [], process: null, run_view: null }

/** "A", "A and B", "A, B and C". */
export function listText(items: string[]): string {
  const unique = [...new Set(items.filter(Boolean))]
  if (unique.length <= 1) return unique[0] ?? ''
  return `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`
}

/** {{next.step}} and {{next.assignee}}: "Finance review"; "Finance (Priya Shah)", "Priya Shah", or the team alone. */
export function nextVariables(next: TaskNextStep | null): { step: string; assignee: string } {
  const steps = next?.steps ?? []
  const who = steps.map((s) => {
    const people = listText(s.assignees)
    if (s.team && people) return `${s.team} (${people})`
    return people || s.team || ''
  })
  return { step: listText(steps.map((s) => s.name)), assignee: listText(who) }
}

/* ── Templates ───────────────────────────────────────────────────────── */

export interface CompletionTemplateValues {
  task_title?: string | null
  outcome?: string | null
  user_name?: string | null
  process_name?: string | null
  next?: TaskNextStep | null
}

/** The placeholders a template can use (the settings page and the designer list them in the picker). */
export const COMPLETION_VARIABLES: Array<{ name: string; group: string; label: string }> = [
  { name: 'task.title', group: 'Task completed screen', label: 'Task title' },
  { name: 'outcome', group: 'Task completed screen', label: 'Outcome chosen' },
  { name: 'next.step', group: 'Task completed screen', label: 'Next step' },
  { name: 'next.assignee', group: 'Task completed screen', label: 'Who it is with now' },
  { name: 'user.name', group: 'Task completed screen', label: 'Your name' },
  { name: 'process.name', group: 'Task completed screen', label: 'Process name' },
]

const TOKEN = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g

/** "need_more_information" → "Need more information"; other labels as they are. */
export function outcomeText(outcome: string | null | undefined): string {
  const s = String(outcome ?? '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function valueOf(path: string, values: CompletionTemplateValues): string {
  const next = nextVariables(values.next ?? null)
  switch (path) {
    case 'task.title': return values.task_title?.trim() ?? ''
    case 'outcome': return outcomeText(values.outcome)
    case 'next.step': return next.step
    case 'next.assignee': return next.assignee
    case 'user.name': return values.user_name?.trim() ?? ''
    case 'process.name': return values.process_name?.trim() || values.next?.process?.name?.trim() || ''
    default: return ''
  }
}

/** Tidy what empty placeholders leave behind: "()", doubled spaces, a separator at either end, " ." / " ,". */
function tidy(text: string): string {
  return text
    .replace(/\(\s*\)|\[\s*\]/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/([,;:])(?=[.,;:!?])/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/^[\s:,;·–—-]+/, '')
    .replace(/[\s:,;·–—-]+$/, '')
    .trim()
}

/** A template with its placeholders filled in (unknown ones empty) and tidied. */
export function renderCompletionTemplate(template: string, values: CompletionTemplateValues): string {
  return tidy(String(template ?? '').replace(TOKEN, (_, path: string) => valueOf(path, values)))
}

/** A template, else (rendering empty) the built-in default for that text. */
function renderWithFallback(key: CompletionTextKey, settings: TaskCompletionSettings, values: CompletionTemplateValues): string {
  return renderCompletionTemplate(settings[key], values) || renderCompletionTemplate(DEFAULT_TASK_COMPLETION[key], values)
}

/* ── Outcome tone ────────────────────────────────────────────────────── */

export type CompletionTone = 'success' | 'neutral' | 'warning'

/**
 * The icon and tone follow the outcome (public.home_outcome_kind's mapping,
 * classifyOutcome in lib/home/activity.ts): approve-like and plain
 * completions are success, reject / send back are warning, any other
 * choice ("Escalate") is neutral.
 */
export function completionTone(kind: OutcomeKind): CompletionTone {
  if (kind === 'approve' || kind === 'completion') return 'success'
  if (kind === 'reject' || kind === 'return') return 'warning'
  return 'neutral'
}

/* ── The screen's texts ──────────────────────────────────────────────── */

export interface CompletionScreenText {
  kind: OutcomeKind
  tone: CompletionTone
  heading: string
  subheading: string
  outcome: string
  /** What happens next (null: not part of a process). */
  next_line: string | null
  /** The next line is provisional (the queue is still processing). */
  next_pending: boolean
  back_label: string
  next_task_label: string
  view_flow_label: string
}

/** Everything the screen shows, from the resolved settings and the values. */
export function completionScreenText(settings: TaskCompletionSettings, values: CompletionTemplateValues & { available_outcomes?: string[] | null }): CompletionScreenText {
  const kind = classifyOutcome(values.outcome, values.available_outcomes ?? [])
  const next = values.next ?? null
  const vars = nextVariables(next)
  let nextLine: string | null = null
  switch (next?.state) {
    case 'assigned':
      nextLine = vars.assignee ? renderWithFallback('next_assigned', settings, values) : renderWithFallback('next_waiting', settings, values)
      break
    case 'waiting': nextLine = renderWithFallback('next_waiting', settings, values); break
    case 'complete': nextLine = renderWithFallback('next_complete', settings, values); break
    case 'processing': nextLine = 'Processing…'; break
    case 'stopped': nextLine = 'The process has stopped'; break
    case 'unknown': nextLine = 'The process continues'; break
    default: nextLine = null
  }
  const back = renderCompletionTemplate(settings.back_label, values)
  return {
    kind,
    tone: completionTone(kind),
    heading: renderWithFallback('heading', settings, values),
    subheading: renderCompletionTemplate(settings.subheading, values),
    outcome: outcomeText(values.outcome) || 'Completed',
    next_line: nextLine,
    next_pending: next?.state === 'processing',
    back_label: back || (settings.back_target === 'home' ? 'Back to Home' : 'Back to my tasks'),
    next_task_label: renderWithFallback('next_task_label', settings, values),
    view_flow_label: renderWithFallback('view_flow_label', settings, values),
  }
}

/** Where Back goes. */
export function backHref(target: CompletionBackTarget): string {
  return target === 'home' ? '/home' : '/tasks'
}

/** The run view link for Process view (null: no workflow, or the caller can't open either view). */
export function runViewHref(next: TaskNextStep | null): string | null {
  if (!next?.run_id || !next.run_view) return null
  return next.run_view === 'full' ? `/automations/runs/${next.run_id}` : `/home/runs/${next.run_id}`
}

/** The next task, by the Home "My tasks" order (soonest due first): the first one that isn't this task. */
export function pickNextTask<T extends { id: string }>(tasks: readonly T[], currentTaskId: string): T | null {
  return tasks.find((t) => t.id !== currentTaskId) ?? null
}

/** Sample values for the settings / designer preview. */
export const COMPLETION_PREVIEW_VALUES: CompletionTemplateValues & { available_outcomes: string[] } = {
  task_title: 'Invoice #1042',
  outcome: 'Approved',
  user_name: 'Alex Morgan',
  process_name: 'Invoice approval',
  available_outcomes: ['Approved', 'Rejected'],
  next: {
    state: 'assigned', run_id: null, process: { name: 'Invoice approval' }, run_view: 'progress',
    steps: [{ name: 'Finance review', assignees: ['Priya Shah'], team: 'Finance' }],
  },
}
