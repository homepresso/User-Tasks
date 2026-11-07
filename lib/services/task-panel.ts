/**
 * The task lists' detail panel (components/tasks/task-detail-panel.tsx):
 * one read when a row opens — Task tracker, My team, My tasks and Home all
 * use it. Summary, effort (logged vs estimate, latest entries), subtasks,
 * the latest comment / activity, attachments count, the links, and what the
 * signed-in person may change from the list.
 *
 * Visibility: a task the person can reach (lib/task-authz canReachTask — the
 * same rule every task write checks: assignee, collaborator, team member,
 * the assignee's manager, the assigner, or tasks.view_all); null otherwise.
 * `can` mirrors the server rules the panel's controls call:
 *  - progress / effort / subtasks (tick, add): tasks.complete on a task the
 *    person can reach (updateTaskField, logManualEffort, setSubtaskCompleted,
 *    addSubtask); progress and new subtasks only while the task is open;
 *  - status: as progress, and not a workflow task (its status follows its
 *    workflow step) — Completed always goes through Complete (quick actions).
 * The actions re-check everything; `can` only decides what is offered.
 */

import { getDb, hasPerm, type ServiceContext } from './context'
import { requireTaskReach } from './tasks'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped client rows */

export const PANEL_SUBTASK_LIMIT = 50
export const PANEL_EFFORT_ENTRIES = 3

export interface TaskPanelPerson { id: string; name: string }

export interface TaskPanelSubtask {
  id: string
  title: string
  status: string
  priority: string | null
  due_date: string | null
  assignee: string | null
}

export interface TaskPanelData {
  id: string
  title: string
  status: string
  priority: string | null
  due_date: string | null
  created_at: string | null
  updated_at: string | null
  description: string | null
  workflow: boolean
  closed: boolean
  assignee: TaskPanelPerson | null
  requester: TaskPanelPerson | null
  team: string | null
  progress: {
    /** What the list shows: subtasks done when it has any, else the task's own (manual) progress. */
    pct: number
    /** The manual progress (tasks.progress_pct), null = follows its subtasks. */
    manual: number | null
    fromSubtasks: boolean
  }
  effort: {
    loggedMinutes: number
    /** The working estimate (assignee's, else the assigner's), null when none. */
    estimateMinutes: number | null
    entries: Array<{ id: string; minutes: number; notes: string | null; at: string; by: string | null }>
  }
  subtasks: { items: TaskPanelSubtask[]; total: number; completed: number }
  latest: { kind: 'comment' | 'activity'; text: string; by: string | null; at: string } | null
  attachments: number
  links: { task: string; form: string | null; process: string | null }
  can: { progress: boolean; status: boolean; effort: boolean; subtasks: boolean; addSubtask: boolean }
  /** Why the controls are read-only, when they are. */
  readOnlyReason: string | null
}

const COLUMNS = 'id, tenant_id, title, description, status, priority, due_date, created_at, updated_at, progress_pct, is_workflow_task, event_id, workflow_run_id, assignee_id, assigner_id, assigned_team_id, estimated_effort_assigner, estimated_effort_assignee, actual_effort, metadata'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** Plain-text excerpt of a (possibly HTML) description. */
export function descriptionExcerpt(value: unknown, max = 400): string | null {
  if (typeof value !== 'string') return null
  const text = value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim()
  if (!text) return null
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const EVENT_LABELS: Record<string, string> = {
  created: 'Created', assigned: 'Assigned', started: 'Work logged', reassigned: 'Reassigned', escalated: 'Escalated',
  redirected: 'Redirected', delegated: 'Delegated', blocked: 'Blocked', unblocked: 'Unblocked', completed: 'Completed',
  cancelled: 'Cancelled', reopened: 'Reopened', comment_added: 'Comment', task_accepted: 'Accepted', task_held: 'Put on hold',
  task_rejected: 'Declined', task_redirected: 'Redirected', task_escalated: 'Escalated', task_response: 'Response recorded',
}

export function activityText(event: { event_type: string; metadata?: unknown }): string {
  const meta = record(event.metadata)
  if (event.event_type === 'started' && typeof meta.minutes === 'number') return `Logged ${(meta.minutes / 60).toFixed(1)}h`
  if (typeof meta.subtask_title === 'string' && meta.subtask_title) return `${EVENT_LABELS[event.event_type] ?? 'Updated'} subtask “${meta.subtask_title}”`
  return EVENT_LABELS[event.event_type] ?? event.event_type.replace(/_/g, ' ')
}

/** The panel's permissions (pure: the tests and the read share it). */
export function panelPermissions(input: { canComplete: boolean; reachable: boolean; closed: boolean; workflow: boolean }): { can: TaskPanelData['can']; readOnlyReason: string | null } {
  const edit = input.canComplete && input.reachable
  const open = edit && !input.closed
  const can = { progress: open, status: open && !input.workflow, effort: edit, subtasks: edit, addSubtask: open }
  const readOnlyReason = !input.canComplete ? 'Your role can view this task but not update it.'
    : !input.reachable ? 'Only people working on this task (or overseeing it) can update it.'
    : input.closed ? 'This task is closed.'
    : null
  return { can, readOnlyReason }
}

export async function getTaskPanel(ctx: ServiceContext, taskId: string): Promise<TaskPanelData | null> {
  const db = getDb(ctx) as any
  const { data: task } = await db.from('tasks').select(COLUMNS).eq('id', taskId).is('deleted_at', null).maybeSingle()
  if (!task) return null
  // The task's own workspace (the unified view lists tasks of every member workspace).
  const scoped: ServiceContext = { ...ctx, tenantId: String(task.tenant_id) }
  try { await requireTaskReach(scoped, taskId) } catch { return null }

  const tenantId = String(task.tenant_id)
  const people = [task.assignee_id, task.assigner_id].filter(Boolean)
  const [peopleResult, teamResult, subtasksResult, subtaskCountResult, eventsResult, effortResult, attachmentsResult] = await Promise.all([
    people.length ? db.from('users').select('id, display_name, email').in('id', people) : Promise.resolve({ data: [] }),
    task.assigned_team_id ? db.from('teams').select('name').eq('id', task.assigned_team_id).maybeSingle() : Promise.resolve({ data: null }),
    db.from('tasks').select('id, title, status, priority, due_date, assignee:users!tasks_assignee_id_fkey(display_name, email)')
      .eq('tenant_id', tenantId).eq('parent_task_id', taskId).is('deleted_at', null)
      .order('sequence', { ascending: true }).order('created_at', { ascending: true }).limit(PANEL_SUBTASK_LIMIT),
    db.from('tasks').select('status').eq('tenant_id', tenantId).eq('parent_task_id', taskId).is('deleted_at', null).limit(1000),
    db.from('lifecycle_events').select('event_type, metadata, created_at, actor:users!lifecycle_events_actor_id_fkey(display_name, email)')
      .eq('tenant_id', tenantId).eq('task_id', taskId).order('created_at', { ascending: false }).limit(10),
    db.from('effort_records').select('id, minutes, notes, created_at, user:users(display_name, email)')
      .eq('tenant_id', tenantId).eq('task_id', taskId).in('record_type', ['actual', 'timer_entry'])
      .order('created_at', { ascending: false }).limit(PANEL_EFFORT_ENTRIES),
    db.from('task_attachments').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('task_id', taskId).is('deleted_at', null),
  ])

  const nameOf = (p: any) => (p ? String(p.display_name || p.email || 'Someone') : null)
  const byId = new Map<string, any>(((peopleResult.data ?? []) as any[]).map((p) => [String(p.id), p]))
  const person = (id: unknown): TaskPanelPerson | null => (id ? { id: String(id), name: nameOf(byId.get(String(id))) ?? 'Someone' } : null)

  const allSubs = (subtaskCountResult.data ?? []) as Array<{ status: string }>
  const total = allSubs.length
  const completed = allSubs.filter((s) => s.status === 'completed').length
  const manual = task.progress_pct == null ? null : Math.round(Number(task.progress_pct) || 0)
  const closed = task.status === 'completed' || task.status === 'cancelled'
  const fromSubtasks = total > 0 && manual === null
  const pct = manual ?? (total > 0 ? Math.round((completed / total) * 100) : closed ? 100 : 0)

  const events = (eventsResult.data ?? []) as any[]
  const comment = events.find((e) => e.event_type === 'comment_added' && typeof record(e.metadata).message === 'string' && record(e.metadata).source !== 'subtask_added')
  const latestEvent = comment ?? events[0] ?? null
  const latest: TaskPanelData['latest'] = latestEvent
    ? {
        kind: latestEvent === comment ? 'comment' : 'activity',
        text: latestEvent === comment ? descriptionExcerpt(record(comment.metadata).message, 240) ?? '' : activityText(latestEvent),
        by: nameOf(latestEvent.actor),
        at: String(latestEvent.created_at),
      }
    : null

  const meta = record(task.metadata)
  const hasForm = Boolean(meta.form_url) || (Array.isArray(meta.fields) && meta.fields.length > 0)
  const workflow = Boolean(task.is_workflow_task && task.event_id)
  const runId = task.workflow_run_id ? String(task.workflow_run_id) : null
  const estimate = Number(task.estimated_effort_assignee || 0) || Number(task.estimated_effort_assigner || 0) || null
  const { can, readOnlyReason } = panelPermissions({ canComplete: hasPerm(ctx, 'tasks.complete'), reachable: true, closed, workflow })

  return {
    id: String(task.id),
    title: String(task.title ?? ''),
    status: String(task.status),
    priority: task.priority ?? null,
    due_date: task.due_date ?? null,
    created_at: task.created_at ?? null,
    updated_at: task.updated_at ?? null,
    description: descriptionExcerpt(task.description),
    workflow,
    closed,
    assignee: person(task.assignee_id),
    requester: person(task.assigner_id),
    team: teamResult.data?.name ?? null,
    progress: { pct, manual, fromSubtasks },
    effort: {
      loggedMinutes: Number(task.actual_effort ?? 0) || 0,
      estimateMinutes: estimate,
      entries: ((effortResult.data ?? []) as any[]).map((e) => ({ id: String(e.id), minutes: Number(e.minutes) || 0, notes: e.notes ?? null, at: String(e.created_at), by: nameOf(e.user) })),
    },
    subtasks: {
      items: ((subtasksResult.data ?? []) as any[]).map((s) => ({
        id: String(s.id), title: String(s.title ?? ''), status: String(s.status), priority: s.priority ?? null, due_date: s.due_date ?? null, assignee: nameOf(s.assignee),
      })),
      total,
      completed,
    },
    latest,
    attachments: attachmentsResult.count ?? 0,
    links: {
      task: `/tasks/${task.id}`,
      form: hasForm || workflow ? `/tasks/${task.id}?tab=form` : null,
      process: runId ? (hasPerm(ctx, 'workflows.view_runs') ? `/automations/runs/${runId}` : `/home/runs/${runId}`) : null,
    },
    can,
    readOnlyReason,
  }
}
