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
 *   tab        mine (default) | following | tracker — the tab shown first (the app's My tasks /
 *              Following / Task tracker)
 *   tabs       comma-separated tabs to offer (default: all three; one → no tab bar)
 *   scope      Task tracker scope: all (everything I may see: tasks.view_all) | assigned_by_me |
 *              team (my teams' members) | reports (my reporting line: managers). Default: the first
 *              one this person has
 *   priority   comma-separated priorities (Task tracker / Following)
 *   assignee   a user id (Task tracker)
 *   wf         a workflow id filter chosen in the Task tracker (not the host's `workflow` scope)
 *   sort       due (default) | priority | newest | title
 *
 * Pure and client-safe.
 */

export type TaskListView = 'mine' | 'groups' | 'all'
export type TaskListStatus = 'open' | 'completed' | 'any'
export type TaskListDue = 'any' | 'soon' | 'overdue' | 'today' | 'week' | 'custom'
export type TaskListTab = 'mine' | 'following' | 'tracker'
export type TrackerScope = 'all' | 'assigned_by_me' | 'team' | 'reports'
export type TaskListSort = 'due' | 'priority' | 'created' | 'updated' | 'completed' | 'title'
export type TaskListDone = 'any' | '7' | '30' | '90' | 'custom'

export const TASK_LIST_TABS: readonly TaskListTab[] = ['mine', 'following', 'tracker']
export const TRACKER_SCOPES: readonly TrackerScope[] = ['all', 'assigned_by_me', 'team', 'reports']
const PRIORITIES = ['critical', 'high', 'medium', 'low']

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
  tab: TaskListTab
  tabs: TaskListTab[]
  /** null: the first scope this person has (the server decides). */
  scope: TrackerScope | null
  priority: string[]
  assignee: string | null
  wf: string | null
  sort: TaskListSort
  dir: 'asc' | 'desc'
  /** due=today|week|custom: the window, computed by the browser in its own time zone (ISO). */
  dueFrom: string | null
  dueTo: string | null
  unread: boolean
  team: string | null
  /** Completed within the last 7 / 30 / 90 days, or a custom window (doneFrom / doneTo, ISO). */
  done: TaskListDone
  doneFrom: string | null
  doneTo: string | null
  /** Keyset position of the page (the server's nextCursor); null = the first page. */
  cursor: string | null
}

export const TASK_LIST_DEFAULTS: TaskListOptions = {
  view: 'mine', status: 'open', due: 'any', soonDays: 3, q: '', page: 1, size: 10,
  allowCompleted: true, filters: true, compact: false, workflowIds: null, tag: null, scopeLabel: null, title: null, open: 'dialog',
  tab: 'mine', tabs: [...TASK_LIST_TABS], scope: null, priority: [], assignee: null, wf: null, sort: 'due', dir: 'asc',
  dueFrom: null, dueTo: null, unread: false, team: null, done: 'any', doneFrom: null, doneTo: null, cursor: null,
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
    status: (status === 'completed' || status === 'any') && allowCompleted ? status : 'open',
    due: (['soon', 'overdue', 'today', 'week', 'custom'] as const).find((v) => v === due) ?? 'any',
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
    ...tabOptions(query),
    priority: [...new Set(String(first(query, 'priority') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => PRIORITIES.includes(s)))],
    assignee: UUID_RE.test(String(first(query, 'assignee') ?? '')) ? String(first(query, 'assignee')).toLowerCase() : null,
    wf: UUID_RE.test(String(first(query, 'wf') ?? '')) ? String(first(query, 'wf')).toLowerCase() : null,
    sort: (['priority', 'created', 'updated', 'completed', 'title'] as const).find((v) => v === first(query, 'sort')) ?? (first(query, 'sort') === 'newest' ? 'created' : 'due'),
    dir: first(query, 'dir') === 'desc' || (first(query, 'dir') === undefined && first(query, 'sort') === 'newest') ? 'desc' : 'asc',
    dueFrom: isoTime(first(query, 'due_from')),
    dueTo: isoTime(first(query, 'due_to')),
    unread: flag(first(query, 'unread'), false),
    team: UUID_RE.test(String(first(query, 'team') ?? '')) ? String(first(query, 'team')).toLowerCase() : null,
    done: (['7', '30', '90', 'custom'] as const).find((v) => v === first(query, 'done')) ?? 'any',
    doneFrom: isoTime(first(query, 'done_from')),
    doneTo: isoTime(first(query, 'done_to')),
    cursor: /^[A-Za-z0-9_-]{1,600}$/.test(String(first(query, 'cursor') ?? '')) ? String(first(query, 'cursor')) : null,
  }
}

function isoTime(value: string | undefined): string | null {
  if (!value || value.length > 40) return null
  const t = Date.parse(value)
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

function tabOptions(query: Query): { tab: TaskListTab; tabs: TaskListTab[]; scope: TrackerScope | null } {
  const raw = first(query, 'tabs')
  const listed = raw === undefined || raw.trim() === '' ? [...TASK_LIST_TABS] : TASK_LIST_TABS.filter((t) => raw.split(/[\s,;]+/).map((s) => s.toLowerCase()).includes(t))
  const tabs = listed.length ? listed : ['mine' as const]
  const wanted = first(query, 'tab') as TaskListTab | undefined
  const scope = first(query, 'scope') as TrackerScope | undefined
  return { tabs, tab: wanted && tabs.includes(wanted) ? wanted : tabs[0], scope: scope && TRACKER_SCOPES.includes(scope) ? scope : null }
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
  set('tabs', o.tabs.length === TASK_LIST_TABS.length ? null : o.tabs.join(','))
  set('tab', o.tab, o.tabs[0])
  set('scope', o.scope)
  set('priority', o.priority.length ? o.priority.join(',') : null)
  set('assignee', o.assignee)
  set('wf', o.wf)
  set('sort', o.sort, d.sort)
  set('dir', o.dir, d.dir)
  set('due_from', o.due === 'any' || o.due === 'overdue' || o.due === 'soon' ? null : o.dueFrom)
  set('due_to', o.due === 'any' || o.due === 'overdue' || o.due === 'soon' ? null : o.dueTo)
  set('unread', o.unread ? '1' : null)
  set('team', o.team)
  set('done', o.done, 'any')
  set('done_from', o.done === 'custom' ? o.doneFrom : null)
  set('done_to', o.done === 'custom' ? o.doneTo : null)
  set('cursor', o.cursor)
  return q.toString()
}

/** The due-date window: tasks due before this instant (null: no due filter). */
export function dueBefore(o: Pick<TaskListOptions, 'due' | 'soonDays'>, now = new Date()): string | null {
  if (o.due === 'overdue') return now.toISOString()
  if (o.due === 'soon') return new Date(now.getTime() + o.soonDays * 86_400_000).toISOString()
  return null
}

/** The due window [from, to) for a filter (from: null = open start). */
export function dueWindow(o: Pick<TaskListOptions, 'due' | 'soonDays' | 'dueFrom' | 'dueTo'>, now = new Date()): { from: string | null; to: string | null } | null {
  if (o.due === 'overdue' || o.due === 'soon') return { from: null, to: dueBefore(o, now) }
  if (o.due === 'today' || o.due === 'week' || o.due === 'custom') return o.dueFrom || o.dueTo ? { from: o.dueFrom, to: o.dueTo } : null
  return null
}

/** Browser-side: today / this week in the person's own time zone (Monday start). */
export function localDueRange(due: 'today' | 'week', now = new Date()): { dueFrom: string; dueTo: string } {
  const start = new Date(now); start.setHours(0, 0, 0, 0)
  if (due === 'week') start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
  const end = new Date(start); end.setDate(end.getDate() + (due === 'week' ? 7 : 1))
  return { dueFrom: start.toISOString(), dueTo: end.toISOString() }
}

/** The completed window [from, to) for a filter. */
export function doneWindow(o: Pick<TaskListOptions, 'done' | 'doneFrom' | 'doneTo'>, now = new Date()): { from: string | null; to: string | null } | null {
  if (o.done === '7' || o.done === '30' || o.done === '90') return { from: new Date(now.getTime() - Number(o.done) * 86_400_000).toISOString(), to: null }
  if (o.done === 'custom' && (o.doneFrom || o.doneTo)) return { from: o.doneFrom, to: o.doneTo }
  return null
}

/** Page sizes the list offers. */
export const PAGE_SIZES = [10, 25, 50] as const

/** Counts above this show as "1,000+" (an exact count over thousands of rows isn't worth its cost). */
export const COUNT_CAP = 1000

export function countLabel(total: number, capped: boolean): string {
  return capped ? `${COUNT_CAP.toLocaleString('en-US')}+` : total.toLocaleString('en-US')
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
/** Outcomes are listed in the row's Actions menu (all of a task's outcomes; bounded only against bad data). */
const MAX_MENU_OUTCOMES = 50

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
    ? (Array.isArray(t.available_outcomes) && t.available_outcomes.length ? t.available_outcomes : ['completed']).slice(0, MAX_MENU_OUTCOMES)
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
