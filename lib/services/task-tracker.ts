/**
 * Task tracker rows (/tasks/assigned): the joined select, the enrichment
 * (subtasks, recent activity, collaborators, each assignee's queue rank,
 * progress) and the search over the enriched rows. Shared by the tracker's
 * scopes (ui-reads tasks.assigned) and its Following tab
 * (lib/services/task-follows.ts) so every tab shows the same row shape.
 */

import { htmlToPlainText } from '@/lib/html-sanitize'
import type { AnySupabaseClient } from './context'

/* eslint-disable @typescript-eslint/no-explicit-any -- rows as the browser reads them */

/** One query for the task and the names the row shows. */
export const TRACKER_TASK_SELECT = `
  *,
  tenant:tenants(id, name, slug, branding),
  assignee:users!tasks_assignee_id_fkey(id, display_name, avatar_url, email),
  assigner:users!tasks_assigner_id_fkey(id, display_name, email),
  assigned_team:teams!tasks_assigned_team_id_fkey(id, name),
  workflow_source:workflow_sources(id, display_name, engine_type)
`

function priorityWeight(priority: string | null | undefined) {
  switch (priority) {
    case 'critical': return 4
    case 'high': return 3
    case 'medium': return 2
    case 'low': return 1
    default: return 0
  }
}

function normalizeSearch(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

/**
 * Add subtasks, recent activity, collaborators, acceptance summary, each
 * assignee's queue rank and progress to tracker rows. `tenantId` narrows the
 * rank count to one workspace (needed on a service-role client; null on the
 * session client keeps RLS's member workspaces).
 */
export async function enrichTrackerTasks(db: AnySupabaseClient, tasks: any[], tenantId: string | null): Promise<any[]> {
  const taskIds = tasks.map((t) => t.id)
  if (taskIds.length === 0) return []
  const q = db as any

  const { data: subtasks } = await q
    .from('tasks')
    .select('id, parent_task_id, title, status, priority, due_date, assignee_id')
    .in('parent_task_id', taskIds)
    .is('deleted_at', null)
    .order('sequence', { ascending: true })

  const subtaskMap: Record<string, any[]> = {}
  for (const st of subtasks ?? []) {
    const pid = st.parent_task_id as string
    if (!pid) continue
    ;(subtaskMap[pid] ??= []).push(st)
  }

  const [activityResult, collaboratorResult] = await Promise.all([
    q.from('lifecycle_events')
      .select('id, task_id, event_type, created_at, metadata, actor:users!lifecycle_events_actor_id_fkey(id, display_name)')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .limit(Math.max(taskIds.length * 4, 20)),
    q.from('task_assignees')
      .select('id, task_id, user_id, role, acceptance_status, accepted_at, user:users(id, display_name, email)')
      .in('task_id', taskIds),
  ])

  const activityByTask: Record<string, any[]> = {}
  for (const event of activityResult.data ?? []) {
    const list = (activityByTask[event.task_id] ??= [])
    if (list.length < 5) list.push(event)
  }

  const collaboratorByTask: Record<string, any[]> = {}
  for (const row of collaboratorResult.data ?? []) {
    (collaboratorByTask[row.task_id] ??= []).push(row)
  }

  const assigneeIds = Array.from(new Set(tasks.map((task) => task.assignee_id).filter(Boolean)))
  const assigneeRankMap: Record<string, { position: number; total: number }> = {}
  if (assigneeIds.length > 0) {
    let rankQuery = q
      .from('tasks')
      .select('id, assignee_id, sequence, priority, due_date, created_at, status')
      .in('assignee_id', assigneeIds)
      .is('parent_task_id', null)
      .is('deleted_at', null)
      .not('status', 'in', '(completed,cancelled)')
    if (tenantId) rankQuery = rankQuery.eq('tenant_id', tenantId)
    const { data: assigneeTasks } = await rankQuery

    const byAssignee: Record<string, any[]> = {}
    for (const task of assigneeTasks ?? []) {
      if (!task.assignee_id) continue
      ;(byAssignee[task.assignee_id] ??= []).push(task)
    }
    for (const rows of Object.values(byAssignee)) {
      rows.sort((a: any, b: any) => {
        const seqA = a.sequence == null ? Number.MAX_SAFE_INTEGER : Number(a.sequence)
        const seqB = b.sequence == null ? Number.MAX_SAFE_INTEGER : Number(b.sequence)
        if (seqA !== seqB) return seqA - seqB
        const prio = priorityWeight(b.priority) - priorityWeight(a.priority)
        if (prio !== 0) return prio
        const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
        const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
        if (dueA !== dueB) return dueA - dueB
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      })
      rows.forEach((task: any, index: number) => {
        assigneeRankMap[task.id] = { position: index + 1, total: rows.length }
      })
    }
  }

  return tasks.map((task) => {
    const subs = subtaskMap[task.id] ?? []
    const completedSubs = subs.filter((s) => s.status === 'completed')
    const collaborators = collaboratorByTask[task.id] ?? []
    const acceptanceSummary = collaborators.length > 0
      ? {
          pending: collaborators.filter((row: any) => row.acceptance_status === 'pending').length,
          accepted: collaborators.filter((row: any) => row.acceptance_status === 'accepted').length,
          held: collaborators.filter((row: any) => row.acceptance_status === 'held').length,
          rejected: collaborators.filter((row: any) => row.acceptance_status === 'rejected').length,
        }
      : null
    const progressPct = subs.length > 0
      ? Math.round((completedSubs.length / subs.length) * 100)
      : task.status === 'completed' ? 100 : 0

    return {
      ...task,
      subtasks: subs,
      recent_activity: activityByTask[task.id] ?? [],
      collaborators,
      acceptance_summary: acceptanceSummary,
      assignee_rank: assigneeRankMap[task.id] ?? null,
      subtask_count: subs.length,
      completed_subtask_count: completedSubs.length,
      progress_pct: progressPct,
    }
  })
}

/** The tracker's search: task name, ID, description, workflow, people, team, status, priority, tags, subtasks, activity. */
export function searchTrackerTasks(tasks: any[], search: string | null | undefined): any[] {
  const searchNeedle = normalizeSearch(search)
  if (!searchNeedle) return tasks

  return tasks.filter((task: any) => {
    const haystack = [
      task.id,
      task.title,
      htmlToPlainText(task.description),
      task.status,
      task.priority,
      task.outcome,
      task.acceptance_status,
      task.assignee_rank ? `${task.assignee_rank.position}/${task.assignee_rank.total}` : null,
      task.assignee?.display_name,
      task.assignee?.email,
      task.assigner?.display_name,
      task.assigner?.email,
      task.assigned_team?.name,
      task.workflow_source?.display_name,
      ...(Array.isArray(task.recent_activity) ? task.recent_activity.flatMap((event: any) => [event.event_type, event.actor?.display_name]) : []),
      ...(Array.isArray(task.tags) ? task.tags : []),
      ...((task.subtasks ?? []).flatMap((sub: any) => [sub.title, sub.status, sub.priority])),
    ]
      .map(normalizeSearch)
      .filter(Boolean)
    return haystack.some((value) => value.includes(searchNeedle))
  })
}
