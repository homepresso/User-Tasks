'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { normalizeTaskFieldValue, UPDATABLE_TASK_FIELDS, validateTaskFieldValue } from '@/lib/task-fields'
import { sanitizeTaskDescription } from '@/lib/html-sanitize'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { kickQueueProcessor } from '@/lib/process-queue'
import { requirePermission } from '@/lib/permissions-server'
import { writeLifecycleEvent } from '@/lib/lifecycle-events'
import { ensureTenantInvitation } from '@/lib/invitations'
import { getServiceDb } from '@/lib/providers/db'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import type { Json } from '@/lib/database.types'
import type { ActionResult } from '@/lib/action-result'
import { runAction } from '@/lib/actions/run-action'
import { fromSessionForTask } from '@/lib/actions/task-context'
import { fromSession } from '@/lib/services/context'
import * as tasksService from '@/lib/services/tasks'
import type { SubtaskRecord } from '@/lib/services/tasks'
import type { SubtaskInput } from '@/lib/tasks/subtask-input'
import { findRecentDuplicate } from '@/lib/recent-duplicate'
import { decideAcceptance, type QueueTaskFacts } from '@/lib/tasks/queue-rules'
import { decideAcceptanceForAssignees } from '@/lib/tasks/queue-rules-server'

export async function createTask(formData: FormData) {
  await requirePermission('tasks.create')
  const supabase = await createClient()

  const title = (formData.get('title') as string)?.trim()
  // Descriptions may be HTML: sanitised to the allowlist (lib/html-sanitize).
  const description = sanitizeTaskDescription(formData.get('description') as string | null)
  const priority = formData.get('priority') as string
  const dueDate = formData.get('due_date') as string
  const effort = formData.get('estimated_effort') as string
  const subtasksJson = formData.get('subtasks') as string
  const assigneeId = formData.get('assignee_id') as string
  const assigneeIdsJson = formData.get('assignee_ids') as string
  const assignmentMode = (formData.get('assignment_mode') as string) || 'single'
  const assignedTeamId = formData.get('assigned_team_id') as string
  const availableOutcomesJson = formData.get('available_outcomes') as string
  const allowRedirect = (formData.get('allow_redirect') as string) === 'true'
  const allowInviteOnRedirect = (formData.get('allow_invite_on_redirect') as string) === 'true'
  const redirectAssignmentMode = (formData.get('redirect_assignment_mode') as string) === 'many' ? 'many' : 'single'
  const redirectRecipientLimitMode = (formData.get('redirect_recipient_limit_mode') as string) === 'capped' ? 'capped' : 'unlimited'
  const redirectRecipientLimitRaw = formData.get('redirect_recipient_limit') as string

  if (!title) throw new Error('Title is required')

  // Parse client-supplied JSON up front with friendly errors (malformed
  // payloads previously threw opaque 500s mid-flow).
  const parseJson = (raw: string | null, label: string, fallback: any) => {
    if (!raw) return fallback
    try { return JSON.parse(raw) } catch { throw new Error(`Invalid ${label} payload`) }
  }
  const parsedSubtasks = parseJson(subtasksJson, 'subtasks', [])
  if (Array.isArray(parsedSubtasks)) {
    for (const subtask of parsedSubtasks) {
      if (subtask && typeof subtask.description === 'string') subtask.description = sanitizeTaskDescription(subtask.description)
    }
  }
  const parsedAvailableOutcomes = availableOutcomesJson ? parseJson(availableOutcomesJson, 'outcomes', null) : null

  // Ensure user has a current tenant set (required for RPC which uses get_current_tenant_id)
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  const { data: profile } = await supabase
    .from('users')
    .select('current_tenant_id, tenant_id, preferences')
    .eq('id', user.id)
    .single()

  // A repeated submit (double click, retry) opens the task this user just
  // created (create_task_with_subtasks sets assigner_id = auth.uid()).
  const createTenantId = profile?.current_tenant_id ?? profile?.tenant_id
  if (createTenantId) {
    const recent = await findRecentDuplicate<{ id: string }>(supabase, 'tasks', { tenant_id: createTenantId, assigner_id: user.id, title, parent_task_id: null })
    if (recent) redirect(`/tasks/${recent.id}`)
  }

  // If in unified view (current_tenant_id is null), temporarily set to home
  // tenant — the create RPC derives tenant from get_current_tenant_id().
  // Remember to restore it, otherwise the user is silently switched out of
  // unified view as a side effect of creating a task.
  const tenantWasSwapped = !profile?.current_tenant_id && Boolean(profile?.tenant_id)
  if (tenantWasSwapped) {
    await supabase.from('users').update({ current_tenant_id: profile!.tenant_id }).eq('id', user.id)
  }
  const restoreTenantView = async () => {
    if (tenantWasSwapped) {
      await supabase.from('users').update({ current_tenant_id: null }).eq('id', user.id).then(() => {}, () => {})
    }
  }

  const { data, error } = await supabase.rpc('create_task_with_subtasks', {
    p_title: title,
    p_description: description || undefined,
    p_priority: (priority as any) || 'medium',
    p_due_date: dueDate || undefined,
    p_estimated_effort: effort ? parseInt(effort) : undefined,
    p_assignee_id: assigneeId || undefined,
    p_subtasks: parsedSubtasks,
  })

  if (error) {
    await restoreTenantView()
    throw new Error(error.message ?? 'Failed to create task')
  }

  const taskData = data as any

  // Update task with outcome config and acceptance status
  const updates: Record<string, any> = {}
  const metadata: Record<string, any> = {}
  if (parsedAvailableOutcomes) {
    updates.available_outcomes = parsedAvailableOutcomes
  }
  updates.allow_reassign = allowRedirect
  if (allowRedirect) {
    metadata.task_actions = {
      allow_invite_on_redirect: allowInviteOnRedirect,
      redirect_assignment_mode: redirectAssignmentMode,
      redirect_recipient_limit_mode: redirectAssignmentMode === 'many' ? redirectRecipientLimitMode : 'unlimited',
      redirect_recipient_limit: redirectAssignmentMode === 'many' && redirectRecipientLimitMode === 'capped'
        ? Math.max(1, Number(redirectRecipientLimitRaw || '1'))
        : null,
    }
  }
  if (Object.keys(metadata).length > 0) {
    updates.metadata = metadata
  }

  // Resolve assignee list
  let assigneeIds: string[] = []
  if (assigneeIdsJson) {
    try { assigneeIds = JSON.parse(assigneeIdsJson) } catch { /* ignore */ }
  }
  // Fallback to single assignee_id
  if (assigneeIds.length === 0 && assigneeId) {
    assigneeIds = [assigneeId]
  }
  // If team selected but no explicit user list, resolve from team
  if (assigneeIds.length === 0 && assignedTeamId) {
    const { data: members } = await supabase
      .from('user_teams')
      .select('user_id')
      .eq('team_id', assignedTeamId)
    assigneeIds = members?.map((m: any) => m.user_id) ?? []
  }

  const tenantId = profile?.current_tenant_id ?? profile?.tenant_id
  // Queued (pending) or added (accepted): each assignee's own queue rules
  // decide (lib/tasks/queue-rules.ts); no assignee → the default rules.
  const queueFacts: QueueTaskFacts = {
    priority: priority || 'medium', source: 'manual', assigned_by_user_id: user.id, origins: ['manual', ...(assignedTeamId ? ['team'] : [])],
    form_id: null, workflow_id: null,
    assignment: assignmentMode === 'collaborative' ? 'collaborative' : assignedTeamId ? 'team' : 'individual',
    assigned_team_id: assignedTeamId || null,
    due_date: dueDate || null, title, description: description ?? null, has_attachments: false,
    is_subtask: Boolean(taskData?.task?.parent_task_id), tags: [],
  }
  const assigneeDecisions = await decideAcceptanceForAssignees(supabase, { tenantId, assigneeIds, facts: queueFacts })
  const acceptanceFor = (assignee: string | null | undefined) =>
    (assignee ? assigneeDecisions.get(assignee) : undefined) ?? decideAcceptance({ preferences: null, facts: queueFacts })
  const assignedBody = (assignee: string) =>
    acceptanceFor(assignee) === 'pending' ? `"${title}" needs your acceptance` : `"${title}" was added to your tasks`

  if (assignmentMode === 'individual' && assigneeIds.length > 1) {
    // ─── Individual mode: create copies ───
    const groupId = crypto.randomUUID()
    updates.assignment_mode = 'individual'
    updates.assignment_group_id = groupId
    if (assignedTeamId) updates.assigned_team_id = assignedTeamId

    // Update the original task as the first copy
    updates.assignee_id = assigneeIds[0]
    updates.acceptance_status = acceptanceFor(assigneeIds[0])
    await supabase.from('tasks').update(updates as any).eq('id', taskData.task.id)

    // Create copies for remaining assignees
    for (let i = 1; i < assigneeIds.length; i++) {
      const { data: copy } = await supabase.rpc('create_task_with_subtasks', {
        p_title: title,
        p_description: description || undefined,
        p_priority: (priority as any) || 'medium',
        p_due_date: dueDate || undefined,
        p_estimated_effort: effort ? parseInt(effort) : undefined,
        p_assignee_id: assigneeIds[i],
        p_subtasks: parsedSubtasks,
      })
      if (copy) {
        const copyTask = (copy as any).task
        const copyUpdates: Record<string, any> = {
          assignment_mode: 'individual',
          assignment_group_id: groupId,
          acceptance_status: acceptanceFor(assigneeIds[i]),
        }
        if (assignedTeamId) copyUpdates.assigned_team_id = assignedTeamId
        if (availableOutcomesJson) copyUpdates.available_outcomes = updates.available_outcomes
        // accepted_at set when user accepts from queue
        await supabase.from('tasks').update(copyUpdates as any).eq('id', copyTask.id)
      }
    }

    // Notify all assignees
    for (const aid of assigneeIds) {
      if (aid !== user.id) {
        await supabase.from('notifications').insert({
          user_id: aid, tenant_id: tenantId, type: 'task_assigned',
          title: 'New task assigned to you',
          body: assignedBody(aid),
          task_id: taskData.task.id,
        } as any)
      }
    }
  } else if (assignmentMode === 'collaborative' && assigneeIds.length > 1) {
    // ─── Collaborative mode: one task, multiple assignees ───
    updates.assignment_mode = 'collaborative'
    updates.assignee_id = assigneeIds[0]
    updates.acceptance_status = acceptanceFor(assigneeIds[0])
    if (assignedTeamId) updates.assigned_team_id = assignedTeamId
    await supabase.from('tasks').update(updates as any).eq('id', taskData.task.id)

    // Insert task_assignees rows
    const assigneeRows = assigneeIds.map((aid, i) => ({
      tenant_id: tenantId,
      task_id: taskData.task.id,
      user_id: aid,
      role: i === 0 ? 'lead' : 'collaborator',
      ...(acceptanceFor(aid) === 'accepted'
        ? { acceptance_status: 'accepted', accepted_at: new Date().toISOString() }
        : { acceptance_status: 'pending', accepted_at: null }),
    }))
    await (supabase as any).from('task_assignees').insert(assigneeRows)

    // Notify collaborators
    for (const aid of assigneeIds) {
      if (aid !== user.id) {
        await supabase.from('notifications').insert({
          user_id: aid, tenant_id: tenantId, type: 'task_assigned',
          title: 'Collaborative task assigned',
          body: `"${title}" — you've been added as a collaborator`,
          task_id: taskData.task.id,
        } as any)
      }
    }
  } else {
    // ─── Single assignment ───
    const singleAssignee = assigneeIds[0] || null
    updates.assignment_mode = 'single'
    updates.assignee_id = singleAssignee
    updates.acceptance_status = acceptanceFor(singleAssignee)
    if (assignedTeamId) updates.assigned_team_id = assignedTeamId
    if (Object.keys(updates).length > 0) {
      await supabase.from('tasks').update(updates as any).eq('id', taskData.task.id)
    }
    if (singleAssignee && singleAssignee !== user.id) {
      await supabase.from('notifications').insert({
        user_id: singleAssignee, tenant_id: tenantId, type: 'task_assigned',
        title: 'New task assigned to you',
        body: assignedBody(singleAssignee),
        task_id: taskData.task.id,
      } as any)
    }
  }

  // Auto-invite assignees who aren't members of this tenant
  if (assigneeIds.length > 0 && tenantId) {
    for (const aId of assigneeIds) {
      const { data: assigneeUser } = await supabase
        .from('users')
        .select('id, email, tenant_id')
        .eq('id', aId)
        .single()
      if (assigneeUser && assigneeUser.email && (assigneeUser as any).tenant_id !== tenantId) {
        inviteAssigneeAsViewer(assigneeUser.email, tenantId, user.id).catch(() => {})
      }
    }
  }

  await restoreTenantView()

  revalidatePath('/tasks')
  revalidatePath('/tasks/assigned')

  // Kick the workflow queue processor (non-blocking)
  kickQueueProcessor()


  redirect(`/tasks/${taskData.task.id}`)
}

/**
 * Invite a task's assignee who isn't a member of this workspace, as a Viewer.
 * Not exported (not a callable server action): the workspace and the inviter
 * come from the signed-in session of the task being created, and the role is
 * always viewer (governance audit 2026-11: the exported action took the
 * tenant, inviter and role — Owner included — from its caller). Runs with the
 * service role because invitations are writable only with Invite members.
 */
async function inviteAssigneeAsViewer(email: string, tenantId: string, invitedBy: string) {
  await ensureTenantInvitation({ supabase: getServiceDb() as unknown as Parameters<typeof ensureTenantInvitation>[0]['supabase'], tenantId, email, invitedBy, role: 'viewer' })
}

export async function updateTaskField(
  taskId: string,
  field: string,
  value: any
) {
  await requirePermission('tasks.complete')
  // Allowlist — this action is callable with arbitrary arguments from the
  // client, so without it any column (tenant_id, assignee_id, metadata,
  // event_id, ...) was writable by anyone with tasks.complete.
  if (!UPDATABLE_TASK_FIELDS.has(field)) {
    throw new Error(`Field "${field}" cannot be updated`)
  }
  const valueError = validateTaskFieldValue(field, value)
  if (valueError) throw new Error(valueError)
  // Only a task the person can reach (governance audit 2026-11: any task by id before).
  const ctx = await fromSessionForTask(taskId)
  await tasksService.requireTaskReach(ctx, taskId)

  const supabase = await createClient()
  if (field === 'status') {
    const { data: current } = await supabase.from('tasks').select('is_workflow_task, event_id').eq('id', taskId).maybeSingle()
    // A workflow task's status follows its workflow step (complete through the task action).
    if ((current as any)?.is_workflow_task && (current as any)?.event_id) throw new Error('A workflow task completes through its workflow step')
    if (value === 'completed') throw new Error('Complete a task with its outcome (Complete) rather than by editing its status')
  }
  const { error } = await supabase
    .from('tasks')
    .update({ [field]: normalizeTaskFieldValue(field, value) } as any)
    .eq('id', taskId)
    .eq('tenant_id', ctx.tenantId)
    .select('tenant_id')
    .single()

  if (error) {
    throw new Error(error.message)
  }
  revalidatePath('/tasks')
  revalidatePath('/tasks/assigned')
  revalidatePath(`/tasks/${taskId}`)
  return { success: true }
}

/**
 * Save a draft of a task's field values (User Task `fields`) without
 * completing it. Values are validated for type only (required fields are
 * checked on completion) and merged into metadata.template_values.
 */
export async function saveTaskFieldValues(
  taskId: string,
  values: Record<string, unknown>,
  options: { onBehalf?: boolean; onBehalfNote?: string | null } = {},
): Promise<{ success: true } | { success: false; errors: Record<string, string> }> {
  await requirePermission('tasks.complete')
  const supabase = await createClient()

  const { data: task, error: loadError } = await supabase
    .from('tasks')
    .select('id, tenant_id, status, metadata, is_workflow_task, event_id')
    .eq('id', taskId)
    .is('deleted_at', null)
    .maybeSingle()
  if (loadError) throw new Error(loadError.message)
  if (!task) throw new Error('Task not found')
  // Workflow tasks: assignee only (or a manager on behalf) — the shared rule.
  if (task.is_workflow_task && task.event_id) {
    const { saveWorkflowTaskDraft } = await import('./task-queue')
    return saveWorkflowTaskDraft(taskId, values, options)
  }
  // Standard tasks: only one the person can reach.
  await tasksService.requireTaskReach(await fromSessionForTask(taskId), taskId)
  if (task.status === 'completed' || task.status === 'cancelled') {
    throw new Error('This task is closed and can no longer be edited')
  }

  const metadata = (task.metadata ?? {}) as Record<string, unknown>
  const { errors, templateValues } = await mergeTaskFieldValuesChecked(supabase, task.tenant_id, metadata, values, { partial: true, taskId })
  if (Object.keys(errors).length > 0) return { success: false, errors }

  const { error } = await supabase
    .from('tasks')
    .update({ metadata: { ...metadata, template_values: templateValues } as Json })
    .eq('id', taskId)
  if (error) throw new Error(error.message)

  const user = await getCachedUser()
  await writeLifecycleEvent({ supabase, tenantId: task.tenant_id, taskId, eventType: 'task_data_saved', actorId: user?.id ?? null, metadata: { fields: Object.keys(values) } })

  revalidatePath(`/tasks/${taskId}`)
  return { success: true }
}

export async function reorderTasks(
  taskIds: string[]
) {
  await requirePermission('tasks.assign')
  const ids = Array.isArray(taskIds) ? taskIds.filter((id) => typeof id === 'string').slice(0, 500) : []
  const ctx = await fromSession()
  // Every task must be one the person can reach, in their workspace.
  for (const id of ids) await tasksService.requireTaskReach(ctx, id)
  const supabase = await createClient()

  // Update sequence for each task based on new order
  const updates = ids.map((id, index) =>
    supabase
      .from('tasks')
      .update({ sequence: index + 1 })
      .eq('id', id)
      .eq('tenant_id', ctx.tenantId)
  )

  await Promise.all(updates)
  revalidatePath('/tasks')
  revalidatePath('/tasks/assigned')
  return { success: true }
}

/*
 * Task status / comment actions for the task list and detail views (they
 * wrote to the tasks and lifecycle_events tables from the browser before).
 * They act in the task's own workspace and return { ok, error } so the UI
 * can show the failure.
 */

/** Complete a standard (non-workflow) task with an outcome and optional notes. */
export async function completeTaskWithOutcome(taskId: string, outcome: string, notes?: string | null): Promise<ActionResult<{ status: 'completed'; outcome: string }>> {
  return runAction('completeTaskWithOutcome', 'Failed to complete task', async () =>
    tasksService.completeStandardTask(await fromSessionForTask(taskId), taskId, { outcome, notes }))
}

export async function reopenTask(taskId: string): Promise<ActionResult<{ status: 'todo' }>> {
  return runAction('reopenTask', 'Failed to reopen task', async () =>
    tasksService.reopenTask(await fromSessionForTask(taskId), taskId))
}

/** Tick / untick a subtask; `logToTaskId` records the change on the root task's timeline. */
export async function setSubtaskCompleted(subtaskId: string, completed: boolean, logToTaskId?: string | null): Promise<ActionResult<{ status: string }>> {
  return runAction('setSubtaskCompleted', 'Failed to update subtask', async () =>
    tasksService.setSubtaskCompleted(await fromSessionForTask(subtaskId), subtaskId, completed, { logToTaskId }))
}

/**
 * Add a subtask to an open task — title plus optional subtitle, description,
 * estimate (minutes), due date, priority and tags. Anyone who can work on the
 * task (lib/services/tasks canAddSubtask: tasks.complete and a task the
 * person can reach), workflow tasks included.
 */
export async function addSubtask(parentTaskId: string, input: SubtaskInput): Promise<ActionResult<SubtaskRecord>> {
  return runAction('addSubtask', 'Failed to add the subtask', async () =>
    tasksService.addSubtask(await fromSessionForTask(parentTaskId), parentTaskId, input))
}

/** Edit a subtask's fields (same people as adding). */
export async function updateSubtask(subtaskId: string, input: SubtaskInput): Promise<ActionResult<SubtaskRecord>> {
  return runAction('updateSubtask', 'Failed to update the subtask', async () =>
    tasksService.updateSubtask(await fromSessionForTask(subtaskId), subtaskId, input))
}

export async function addTaskComment(taskId: string, message: string): Promise<ActionResult<{ message: string }>> {
  return runAction('addTaskComment', 'Failed to post comment', async () =>
    tasksService.addTaskComment(await fromSessionForTask(taskId), taskId, message))
}

/** Task with its subtask tree, or null when it doesn't exist / isn't visible. */
export async function getTaskTree(taskId: string): Promise<ActionResult<Awaited<ReturnType<typeof tasksService.getTaskTree>>>> {
  return runAction('getTaskTree', 'Failed to load task', async () => tasksService.getTaskTree(await fromSession(), taskId))
}
