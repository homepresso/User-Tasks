/**
 * The embeddable task list (/embed/tasks, lib/embed/task-list.ts): the
 * signed-in person's tasks for a frame on an approved site. Reads only —
 * every action goes through the app's own services (task-actions,
 * home.claimTask / unclaimTask, the task page), so permissions and
 * validation are the app's.
 *
 * Who sees what (always the caller's own, ctx.actorId):
 *  - mine: assigned to me, or a collaborative task I am on (task_assignees);
 *  - groups: unclaimed tasks of my teams, my claim-candidate (AAD group)
 *    tasks, and team tasks I claimed;
 *  - all: both; with tasks.view_all, every task of the workspace.
 * Reads use the service-role client with explicit tenant / user filters
 * (as lib/services/home.ts does).
 */

import { dbError, ilikeTerm, serviceRoleClient } from './_shared'
import { hasPerm, requirePerm, ServiceError, type ServiceContext } from './context'
import { queueSources, shapeTasks, TASK_COLUMNS, type HomeTask } from './home'
import { doneWindow, dueWindow, taskRowActions, type TaskListOptions, type TaskRowAction, type TrackerScope } from '@/lib/embed/task-list'
import { withUnread } from './task-reads'
import { queueActionFor, type QueueScope } from '@/lib/tasks/unified-list'
import { normalizeTaskFields, valueFields } from '@/lib/task-field-schema'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPEN = ['todo', 'in_progress', 'blocked']

export interface EmbedTask extends HomeTask {
  outcome: string | null
  completed_at: string | null
  actions: TaskRowAction[]
  outcomes: string[]
  /** The task waits for someone of a team (unclaimed) or I hold it for my team. */
  team_task: boolean
  /** Not opened by me since it became mine (lib/tasks/unread.ts). */
  unread: boolean
  progress_pct: number
  subtasks: { total: number; done: number }
  /** Who holds it (Following / Task tracker rows show it). */
  assignee_name: string | null
}

export interface EmbedTaskFacets {
  workflows: Array<{ id: string; name: string }>
  assignees: Array<{ id: string; name: string }>
}

export interface EmbedTaskList {
  tasks: EmbedTask[]
  /** Matching tasks, at most COUNT_CAP counted (`capped`: COUNT_CAP or more — "1,000+"). */
  total: number
  capped: boolean
  /** The next page's keyset cursor (null: last page; the title sort pages by number). */
  nextCursor: string | null
  page: number
  size: number
  /** The caller may see every task (the "All" view lists the workspace). */
  view_all: boolean
  /** Task tracker: the scopes this person has (the app's own rules), and the one shown. */
  scopes?: TrackerScope[]
  scope?: TrackerScope | null
  /** Task tracker / Following: filter choices from the whole result (not just this page). */
  facets?: EmbedTaskFacets
}

/** Does a task form need filling before it can complete (a required value field, or its own button bar)? */
export function taskNeedsForm(fields: unknown, formButtons: unknown): boolean {
  if (Array.isArray(formButtons) && formButtons.length > 0) return true
  return valueFields(normalizeTaskFields(fields)).some((f) => (f as { required?: boolean }).required === true)
}

const inList = (ids: string[]) => ids.filter((id) => UUID_RE.test(id)).join(',')

/** The columns a row needs (the app's Home list columns + what the row actions and the richness use). */
const ROW_COLUMNS = `${TASK_COLUMNS}, assignee_id, assignment_type, is_workflow_task, available_outcomes, outcome, completed_at, progress_pct, child_count, completed_child_count, fields:metadata->fields, form_buttons:metadata->form_buttons`

/** Rows (ROW_COLUMNS) → list rows: the Home shape, the row actions, unread, progress, subtasks, assignee. */
async function shapeEmbedRows(ctx: ServiceContext, db: any, me: string, rows: any[], scope: QueueScope): Promise<EmbedTask[]> {
  const [shaped, unread, names] = await Promise.all([
    shapeTasks(db, ctx.tenantId, rows),
    withUnread(ctx, rows.map((r) => ({ id: String(r.id) }))),
    assigneeNames(db, rows.map((r) => r.assignee_id).filter(Boolean)),
  ])
  const unreadIds = new Set(unread.filter((r) => r.unread).map((r) => r.id))
  return shaped.map((t, i): EmbedTask => {
    const r = rows[i]
    const { actions, outcomes } = taskRowActions({
      status: r.status, assignee_id: r.assignee_id ?? null, assigned_team_id: r.assigned_team_id ?? null, assignment_type: r.assignment_type ?? null,
      acceptance_status: r.acceptance_status ?? null, is_workflow_task: r.is_workflow_task === true, event_id: r.event_id ?? null,
      available_outcomes: Array.isArray(r.available_outcomes) ? r.available_outcomes.map(String) : null,
      needsForm: taskNeedsForm(r.fields ?? r.metadata?.fields, r.form_buttons ?? r.metadata?.form_buttons), queueAction: queueActionFor(r, scope),
    }, me)
    return {
      ...t, outcome: r.outcome ?? null, completed_at: r.completed_at ?? null, actions, outcomes,
      overdue: t.overdue && OPEN.includes(r.status), team_task: Boolean(r.assigned_team_id),
      unread: unreadIds.has(String(r.id)),
      progress_pct: Math.max(0, Math.min(100, Math.round(Number(r.progress_pct) || 0))),
      subtasks: { total: Number(r.child_count ?? 0) || 0, done: Number(r.completed_child_count ?? 0) || 0 },
      assignee_name: r.assignee_id ? (names.get(String(r.assignee_id)) ?? null) : null,
    }
  })
}

async function assigneeNames(db: any, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.map(String))].filter((id) => UUID_RE.test(id))
  if (!unique.length) return new Map()
  const { data } = await db.from('users').select('id, display_name, email').in('id', unique)
  return new Map(((data ?? []) as any[]).map((u) => [String(u.id), String(u.display_name || u.email || 'Someone')]))
}

/** Task tracker scopes this person has (the shared search's rules). */
export async function trackerScopes(ctx: ServiceContext): Promise<TrackerScope[]> {
  const { searchScopes } = await import('./task-search')
  return searchScopes(ctx)
}

/**
 * One page of a tab: the shared server-side search (lib/services/task-search.ts —
 * the same one the app's Completed / All views use), shaped into list rows with
 * the row actions of the app's rules (a manager viewing a report's task gets
 * Open only; completed rows: Open only, read-only panel).
 */
export async function listEmbedTab(ctx: ServiceContext, o: TaskListOptions): Promise<EmbedTaskList> {
  const { searchTasks } = await import('./task-search')
  const r = await searchTasks(ctx, {
    tab: o.tab, view: o.view, scope: o.scope, status: o.status, q: o.q, priority: o.priority,
    due: dueWindow(o), completed: doneWindow(o), workflowIds: o.workflowIds, tag: o.tag, workflowId: o.wf,
    assigneeId: o.assignee, teamId: o.team, unread: o.unread, sort: o.sort, dir: o.dir, size: o.size,
    cursor: o.cursor, page: o.page, columns: ROW_COLUMNS,
  })
  const me = ctx.actorId as string
  const db = await serviceRoleClient(ctx)
  const qs: QueueScope = { userId: me, teamIds: new Set(r.queue.teams), collabPendingIds: new Set(r.queue.collabIds), claimCandidateIds: new Set(r.queue.candidateIds) }
  return {
    tasks: await shapeEmbedRows(ctx, db, me, r.rows, qs),
    total: r.total, capped: r.capped, nextCursor: r.nextCursor, page: o.page, size: o.size,
    view_all: hasPerm(ctx, 'tasks.view_all'),
    ...(o.tab === 'tracker' ? { scopes: r.scopes ?? [], scope: r.scope ?? null } : {}),
  }
}

/** Back-compat name (My tasks). */
export const listEmbedTasks = (ctx: ServiceContext, o: TaskListOptions) => listEmbedTab(ctx, { ...o, tab: 'mine' })

/** Filter choices for the list: the workspace's workflows and the people a tab may filter by (bounded). */
export async function embedTaskFacets(ctx: ServiceContext): Promise<EmbedTaskFacets> {
  requirePerm(ctx, 'tasks.view_own')
  const db = await serviceRoleClient(ctx)
  const [{ data: wfs }, { data: members }] = await Promise.all([
    (db as any).from('workflows').select('id, name').eq('tenant_id', ctx.tenantId).order('name').limit(300),
    (db as any).from('user_memberships').select('user_id').eq('tenant_id', ctx.tenantId).eq('is_active', true).limit(300),
  ])
  const names = await assigneeNames(db, ((members ?? []) as any[]).map((m) => String(m.user_id)))
  return {
    workflows: ((wfs ?? []) as any[]).map((w) => ({ id: String(w.id), name: String(w.name ?? 'Workflow') })),
    assignees: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  }
}
