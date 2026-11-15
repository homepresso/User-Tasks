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
import { dueBefore, taskRowActions, type TaskListOptions, type TaskRowAction } from '@/lib/embed/task-list'
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
}

export interface EmbedTaskList {
  tasks: EmbedTask[]
  total: number
  page: number
  size: number
  /** The caller may see every task (the "All" view lists the workspace). */
  view_all: boolean
}

/** Does a task form need filling before it can complete (a required value field, or its own button bar)? */
export function taskNeedsForm(fields: unknown, formButtons: unknown): boolean {
  if (Array.isArray(formButtons) && formButtons.length > 0) return true
  return valueFields(normalizeTaskFields(fields)).some((f) => (f as { required?: boolean }).required === true)
}

const inList = (ids: string[]) => ids.filter((id) => UUID_RE.test(id)).join(',')

export async function listEmbedTasks(ctx: ServiceContext, o: TaskListOptions): Promise<EmbedTaskList> {
  requirePerm(ctx, 'tasks.view_own')
  const me = ctx.actorId
  if (!me) throw ServiceError.forbidden('Sign in to see your tasks')
  const empty: EmbedTaskList = { tasks: [], total: 0, page: o.page, size: o.size, view_all: hasPerm(ctx, 'tasks.view_all') }
  if (o.workflowIds && o.workflowIds.length === 0) return empty
  const db = await serviceRoleClient(ctx)

  // Workflow scope: the ids given, narrowed by a tag.
  let workflowIds = o.workflowIds
  if (o.tag) {
    let wq = (db as any).from('workflows').select('id').eq('tenant_id', ctx.tenantId).contains('tags', [o.tag]).limit(200)
    if (workflowIds) wq = wq.in('id', workflowIds)
    const { data, error } = await wq
    if (error) throw dbError(error)
    workflowIds = ((data ?? []) as any[]).map((w) => String(w.id))
    if (!workflowIds.length) return empty
  }

  const [{ teams, collabIds, candidateIds }, { data: assigneeRows }] = await Promise.all([
    queueSources(db, ctx.tenantId, me),
    (db as any).from('task_assignees').select('task_id').eq('tenant_id', ctx.tenantId).eq('user_id', me).limit(500),
  ])
  const onTask = [...new Set(((assigneeRows ?? []) as any[]).map((r) => String(r.task_id ?? '')))]
  const mineParts = [`assignee_id.eq.${me}`, ...(inList(onTask) ? [`id.in.(${inList(onTask)})`] : [])]
  const groupParts = [
    `and(assignee_id.eq.${me},assigned_team_id.not.is.null)`,
    ...(inList(teams) ? [`and(assignee_id.is.null,assigned_team_id.in.(${inList(teams)}))`] : []),
    ...(inList(candidateIds) ? [`and(assignee_id.is.null,id.in.(${inList(candidateIds)}))`] : []),
  ]
  const parts = o.view === 'mine' ? mineParts : o.view === 'groups' ? groupParts : empty.view_all ? null : [...mineParts, ...groupParts]

  const columns = `${TASK_COLUMNS}, assignee_id, assignment_type, is_workflow_task, available_outcomes, outcome, completed_at, fields:metadata->fields, form_buttons:metadata->form_buttons`
  let query = (db as any).from('tasks').select(columns, { count: 'exact' })
    .eq('tenant_id', ctx.tenantId).is('deleted_at', null).is('parent_task_id', null)
  if (parts) query = query.or(parts.join(','))
  query = o.status === 'completed' ? query.eq('status', 'completed') : query.in('status', OPEN)
  const before = dueBefore(o)
  if (before) query = query.not('due_date', 'is', null).lte('due_date', before)
  if (o.q.trim()) query = query.ilike('title', `%${ilikeTerm(o.q)}%`)
  if (workflowIds) query = query.in('workflow_id', workflowIds)
  query = o.status === 'completed'
    ? query.order('completed_at', { ascending: false, nullsFirst: false })
    : query.order('due_date', { ascending: true, nullsFirst: false }).order('created_at', { ascending: false })
  const offset = (o.page - 1) * o.size
  const { data, count, error } = await query.order('id').range(offset, offset + o.size - 1)
  if (error) throw dbError(error)
  const rows = (data ?? []) as any[]
  const shaped = await shapeTasks(db, ctx.tenantId, rows)
  const scope: QueueScope = { userId: me, teamIds: new Set(teams), collabPendingIds: new Set(collabIds), claimCandidateIds: new Set(candidateIds) }
  const tasks = shaped.map((t, i): EmbedTask => {
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
    }
  })
  return { ...empty, tasks, total: count ?? tasks.length }
}

