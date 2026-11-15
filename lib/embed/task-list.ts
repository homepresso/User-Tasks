/**
 * The embeddable task list (/embed/tasks, lib/embedding.ts): its query
 * options and the per-row actions. Host-agnostic — an intranet page, a
 * SharePoint add-in part or a future SPFx web part frames the same URL with
 * the same options and listens for the same messages (lib/embed/host-messages.ts).
 *
 *   view       mine (default) | groups | all
 *                mine   — assigned to me, plus collaborations waiting for my answer
 *                groups — tasks of my teams / groups: unclaimed (Claim) and the ones I claimed (Unclaim)
 *                all    — everything above; with tasks.view_all, every task of the workspace
 *   status     open (default) | completed
 *   due        any (default) | soon (due within `soon_days`, overdue included) | overdue
 *   soon_days  1–60 (default 3)
 *   q          search in the title
 *   page       1-based page (default 1)
 *   size       rows per page, 1–50 (default 10)
 *   completed  1 / true: offer the Completed filter (default: shown)
 *   filters    0: hide the filter bar (the host fixed the view)
 *   compact    1: one line per task
 *   workflow   comma-separated workflow ids: only their tasks; `none` matches
 *              nothing (a host scope that resolved to no workflow)
 *   tag        only tasks of workflows carrying this tag
 *   scope_label  a name for the scope, shown in the empty state ("No open tasks for Expense claims")
 *   title      a heading above the list (empty: none)
 *   open       dialog (default) | tab — how a task's form opens
 *
 * Pure and client-safe.
 */

export type TaskListView = 'mine' | 'groups' | 'all'
export type TaskListStatus = 'open' | 'completed'
export type TaskListDue = 'any' | 'soon' | 'overdue'

export interface TaskListOptions {
  view: TaskListView
  status: TaskListStatus
  due: TaskListDue
  soonDays: number
  q: string
  page: number
  size: number
  allowCompleted: boolean
  filters: boolean
  compact: boolean
  /** null: no workflow scope; [] : the scope matched nothing. */
  workflowIds: string[] | null
  tag: string | null
  scopeLabel: string | null
  title: string | null
  open: 'dialog' | 'tab'
}

export const TASK_LIST_DEFAULTS: TaskListOptions = {
  view: 'mine', status: 'open', due: 'any', soonDays: 3, q: '', page: 1, size: 10,
  allowCompleted: true, filters: true, compact: false, workflowIds: null, tag: null, scopeLabel: null, title: null, open: 'dialog',
}

export const TASK_LIST_LIMITS = { size: 50, soonDays: 60, q: 120, workflows: 50, tag: 60, label: 80, title: 120 } as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Query = Record<string, string | string[] | undefined> | URLSearchParams

function first(query: Query, key: string): string | undefined {
  if (query instanceof URLSearchParams) return query.get(key) ?? undefined
  const v = query[key]
  return Array.isArray(v) ? v[0] : v
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback
  if (/^(1|true|yes|on)$/i.test(value)) return true
  if (/^(0|false|no|off)$/i.test(value)) return false
  return fallback
}

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function text(value: string | undefined, max: number): string | null {
  const t = String(value ?? '').replace(/[\u0000-\u001f]/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/** Options from a query (lenient: unknown values fall back to the defaults). */
export function parseTaskListOptions(query: Query): TaskListOptions {
  const d = TASK_LIST_DEFAULTS
  const view = first(query, 'view')
  const status = first(query, 'status')
  const due = first(query, 'due')
  const allowCompleted = flag(first(query, 'completed'), d.allowCompleted)
  const rawWorkflow = first(query, 'workflow')
  let workflowIds: string[] | null = null
  if (rawWorkflow !== undefined && rawWorkflow.trim() !== '') {
    workflowIds = rawWorkflow.trim().toLowerCase() === 'none'
      ? []
      : [...new Set(rawWorkflow.split(/[\s,;]+/).map((s) => s.replace(/[{}]/g, '').toLowerCase()).filter((s) => UUID_RE.test(s)))].slice(0, TASK_LIST_LIMITS.workflows)
  }
  const tag = text(first(query, 'tag'), TASK_LIST_LIMITS.tag)?.toLowerCase() ?? null
  return {
    view: view === 'groups' || view === 'all' ? view : 'mine',
    status: status === 'completed' && allowCompleted ? 'completed' : 'open',
    due: due === 'soon' || due === 'overdue' ? due : 'any',
    soonDays: int(first(query, 'soon_days'), d.soonDays, 1, TASK_LIST_LIMITS.soonDays),
    q: text(first(query, 'q'), TASK_LIST_LIMITS.q) ?? '',
    page: int(first(query, 'page'), 1, 1, 10_000),
    size: int(first(query, 'size'), d.size, 1, TASK_LIST_LIMITS.size),
    allowCompleted,
    filters: flag(first(query, 'filters'), d.filters),
    compact: flag(first(query, 'compact'), d.compact),
    workflowIds,
    tag,
    scopeLabel: text(first(query, 'scope_label'), TASK_LIST_LIMITS.label),
    title: text(first(query, 'title'), TASK_LIST_LIMITS.title),
    open: first(query, 'open') === 'tab' ? 'tab' : 'dialog',
  }
}

/** The query for these options (defaults left out), keeping the host's own parameters in `keep`. */
export function taskListQuery(o: TaskListOptions, keep: Record<string, string> = {}): string {
  const d = TASK_LIST_DEFAULTS
  const q = new URLSearchParams(keep)
  const set = (k: string, v: string | null | undefined, def?: string) => { if (v && v !== def) q.set(k, v); else q.delete(k) }
  set('view', o.view, d.view)
  set('status', o.status, d.status)
  set('due', o.due, d.due)
  set('soon_days', String(o.soonDays), String(d.soonDays))
  set('q', o.q)
  set('page', String(o.page), '1')
  set('size', String(o.size), String(d.size))
  set('completed', o.allowCompleted ? null : '0')
  set('filters', o.filters ? null : '0')
  set('compact', o.compact ? '1' : null)
  set('workflow', o.workflowIds === null ? null : o.workflowIds.length ? o.workflowIds.join(',') : 'none')
  set('tag', o.tag)
  set('scope_label', o.scopeLabel)
  set('title', o.title)
  set('open', o.open, d.open)
  return q.toString()
}

/** The due-date window: tasks due before this instant (null: no due filter). */
export function dueBefore(o: Pick<TaskListOptions, 'due' | 'soonDays'>, now = new Date()): string | null {
  if (o.due === 'overdue') return now.toISOString()
  if (o.due === 'soon') return new Date(now.getTime() + o.soonDays * 86_400_000).toISOString()
  return null
}

/* ── per-row actions ─────────────────────────────────────────────────── */

export type TaskRowAction = 'accept' | 'decline' | 'claim' | 'unclaim' | 'outcome' | 'open'

export interface TaskRowFacts {
  status: string
  assignee_id: string | null
  assigned_team_id: string | null
  assignment_type?: string | null
  acceptance_status: string | null
  is_workflow_task: boolean
  event_id: string | null
  available_outcomes: string[] | null
  /** The task form has a value field that must be filled, or a configured button bar. */
  needsForm: boolean
  /** Queue action from lib/tasks/unified-list (accept / claim), if any. */
  queueAction: 'accept' | 'claim' | null
}

const OPEN = new Set(['todo', 'in_progress', 'blocked'])

/**
 * What the list offers on a row. Only offers — every action runs through the
 * same server checks as the app (lib/services/task-actions, home.claimTask …):
 *  - queued for me → Accept / Decline (pending) or Claim (unclaimed team / group task);
 *  - a team task I claimed → Unclaim;
 *  - a workflow task I hold with no form to fill → its outcome buttons;
 *  - anything else open (a form to fill, a standard task) → Open.
 */
export function taskRowActions(t: TaskRowFacts, me: string): { actions: TaskRowAction[]; outcomes: string[] } {
  if (!OPEN.has(t.status)) return { actions: ['open'], outcomes: [] }
  if (t.queueAction === 'accept') return { actions: ['accept', 'decline', 'open'], outcomes: [] }
  if (t.queueAction === 'claim') return { actions: ['claim', 'open'], outcomes: [] }
  const actions: TaskRowAction[] = []
  const mine = t.assignee_id === me
  if (mine && t.assigned_team_id && t.assignment_type !== 'aad_group') actions.push('unclaim')
  const workflow = t.is_workflow_task && Boolean(t.event_id)
  const outcomes = workflow && mine && t.acceptance_status !== 'pending' && !t.needsForm
    ? (Array.isArray(t.available_outcomes) && t.available_outcomes.length ? t.available_outcomes : ['completed']).slice(0, 4)
    : []
  if (outcomes.length) actions.push('outcome')
  actions.push('open')
  return { actions, outcomes }
}

/** A friendly label for an outcome key (approved → Approve). */
export function outcomeButtonLabel(outcome: string): string {
  const known: Record<string, string> = {
    approved: 'Approve', rejected: 'Reject', completed: 'Complete', deferred: 'Defer', returned: 'Return', escalated: 'Escalate',
  }
  if (known[outcome]) return known[outcome]
  const t = outcome.replace(/[_-]+/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Complete'
}

/** Outcomes that usually call for a reason: the comment box opens first (it stays optional unless the server says otherwise). */
export function outcomeAsksComment(outcome: string): boolean {
  return /^(rejected|reject|returned|deferred|declined)$/i.test(outcome)
}
