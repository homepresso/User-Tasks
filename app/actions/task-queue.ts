'use server'

import { createClient, getCachedUser } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { kickQueueProcessor } from '@/lib/process-queue'
import { requirePermission } from '@/lib/permissions-server'
import { ensureTenantInvitation, INVITABLE_ROLES } from '@/lib/invitations'

export async function respondToTask(
  taskId: string,
  action: 'accepted' | 'held' | 'rejected',
  comment?: string
) {
  await requirePermission('tasks.complete')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  // Require comment for hold/reject
  if ((action === 'held' || action === 'rejected') && !comment?.trim()) {
    throw new Error('A comment is required when holding or rejecting a task')
  }

  // Get the task to verify ownership and get assigner info
  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, status, tenant_id, assigner_id, assignee_id, acceptance_status, assignment_mode')
    .eq('id', taskId)
    .single()

  if (!task) throw new Error('Task not found')

  const isCollaborative = (task as any).assignment_mode === 'collaborative'
  const now = new Date().toISOString()

  if (isCollaborative) {
    // Update the user's row in task_assignees. Verify membership first —
    // previously a non-member's response silently no-opped and still
    // reported success.
    const { data: membership } = await (supabase as any)
      .from('task_assignees')
      .select('id')
      .eq('task_id', taskId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) throw new Error('You are not an assignee on this task')

    await supabase
      .from('task_assignees' as any)
      .update({
        acceptance_status: action,
        acceptance_comment: comment?.trim() || null,
        accepted_at: action === 'accepted' ? now : null,
      })
      .eq('task_id', taskId)
      .eq('user_id', user.id)
  } else {
    // Verify ownership for single/individual tasks
    if ((task as any).assignee_id !== user.id) throw new Error('You are not the assignee')

    const updates: Record<string, any> = {
      acceptance_status: action,
      acceptance_comment: comment?.trim() || null,
    }
    if (action === 'accepted') {
      updates.accepted_at = now
      // Parity with the v1 API: accepting starts the task (never regress a
      // task that has already moved further along).
      const currentStatus = String((task as any).status ?? '')
      if (['todo', 'draft', 'blocked', ''].includes(currentStatus)) updates.status = 'in_progress'
    }
    if (action === 'rejected') updates.status = 'cancelled'

    await supabase.from('tasks').update(updates as any).eq('id', taskId)
  }

  // Record lifecycle event
  await supabase.from('lifecycle_events').insert({
    tenant_id: (task as any).tenant_id,
    task_id: taskId,
    event_type: `task_${action}`,
    actor_id: user.id,
    metadata: { action, comment: comment?.trim() || null },
  } as any)

  // Get user display name for notification
  const { data: profile } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', user.id)
    .single()
  const displayName = (profile as any)?.display_name || 'Someone'

  // Notify the assigner
  const assignerId = (task as any).assigner_id
  if (assignerId) {
    const actionLabel = action === 'accepted' ? 'accepted' : action === 'held' ? 'put on hold' : 'rejected'
    await supabase.from('notifications').insert({
      user_id: assignerId,
      tenant_id: (task as any).tenant_id,
      type: `task_${action}`,
      title: `Task ${actionLabel}`,
      body: `${displayName} has ${actionLabel} "${(task as any).title}"${comment ? `: "${comment.trim()}"` : ''}`,
      task_id: taskId,
    } as any)
  }

  revalidatePath('/tasks')
  revalidatePath('/tasks/assigned')
  revalidatePath('/tasks/queue')
  revalidatePath(`/tasks/${taskId}`)

  // Kick the workflow queue (acceptance changes may trigger task_submitted workflows)
  kickQueueProcessor()

  return { success: true }
}

export async function rerouteTask(
  taskId: string,
  action: 'redirect' | 'escalate',
  options: {
    targetUserId?: string
    targetUserIds?: string[]
    targetEmail?: string
    targetEmails?: string[]
    inviteIfNeeded?: boolean
    inviteRole?: (typeof INVITABLE_ROLES)[number]
    comment?: string
  } = {}
) {
  await requirePermission('tasks.complete')
  const supabase = await createClient()
  const user = await getCachedUser()
  if (!user) throw new Error('Not authenticated')

  const normalizedEmail = options.targetEmail?.toLowerCase().trim() || null
  const comment = options.comment?.trim() || null

  if (!options.targetUserId && !normalizedEmail) {
    throw new Error(action === 'redirect' ? 'Choose a user or enter an email to redirect this task' : 'Choose a user to escalate this task')
  }

  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, tenant_id, assigner_id, assignee_id, allow_reassign, allow_escalate, metadata, acceptance_status, assignment_mode')
    .eq('id', taskId)
    .single()

  if (!task) throw new Error('Task not found')
  const isCollaborative = (task as any).assignment_mode === 'collaborative'
  if (isCollaborative) {
    const { data: membership } = await (supabase as any)
      .from('task_assignees')
      .select('id')
      .eq('task_id', taskId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership?.id) throw new Error('You are not an assignee on this task')
  } else if ((task as any).assignee_id !== user.id) {
    throw new Error('You are not the assignee')
  }

  if (action === 'redirect' && (task as any).allow_reassign !== true) {
    throw new Error('Redirect is not enabled for this task')
  }
  if (action === 'escalate' && (task as any).allow_escalate === false) {
    throw new Error('Escalation is not enabled for this task')
  }

  const metadata = ((task as any).metadata ?? {}) as Record<string, any>
  const taskActions = ((metadata.task_actions ?? {}) as Record<string, any>)
  const allowInviteOnRedirect = action === 'redirect' && taskActions.allow_invite_on_redirect === true
  const inviteRole = options.inviteRole ?? taskActions.invite_role ?? 'viewer'
  const redirectAssignmentMode = taskActions.redirect_assignment_mode === 'many' ? 'many' : 'single'
  const redirectRecipientLimitMode = taskActions.redirect_recipient_limit_mode === 'capped' ? 'capped' : 'unlimited'
  const redirectRecipientLimit = redirectRecipientLimitMode === 'capped'
    ? Math.max(1, Number(taskActions.redirect_recipient_limit ?? 1))
    : null

  const targetUserIds = new Set<string>([
    ...(options.targetUserId ? [options.targetUserId] : []),
    ...(options.targetUserIds ?? []),
  ].filter(Boolean))
  const targetEmails = Array.from(new Set([
    ...(normalizedEmail ? [normalizedEmail] : []),
    ...((options.targetEmails ?? []).map((email) => email.toLowerCase().trim()).filter(Boolean)),
  ]))
  let targetUserId = options.targetUserId ?? null
  let targetEmail = normalizedEmail

  if (action === 'redirect' && redirectAssignmentMode === 'many') {
    const requestedRecipientCount = targetUserIds.size + targetEmails.length
    if (redirectRecipientLimitMode === 'capped' && redirectRecipientLimit !== null && requestedRecipientCount > redirectRecipientLimit) {
      throw new Error(`You can redirect this task to up to ${redirectRecipientLimit} people`)
    }

    const resolvedUsers: { id: string; email: string | null; display_name?: string | null }[] = []
    for (const userId of targetUserIds) {
      const lookup: any = (supabase as any)
        .from('users')
        .select('id, email, display_name')
        .eq('id', userId)
        .eq('tenant_id' as any, (task as any).tenant_id)
        .maybeSingle()
      const { data } = await lookup
      if (data?.id) resolvedUsers.push(data)
    }

    const inviteResults: Array<{ email: string; invitationId: string | null; emailSent: boolean; emailError: string | null }> = []
    for (const email of targetEmails) {
      const lookup: any = (supabase as any)
        .from('users')
        .select('id, email, display_name')
        .eq('tenant_id' as any, (task as any).tenant_id)
        .eq('email', email)
        .maybeSingle()
      const { data } = await lookup
      if (data?.id) {
        if (!resolvedUsers.some(u => u.id === data.id)) resolvedUsers.push(data)
        continue
      }
      if (allowInviteOnRedirect && options.inviteIfNeeded !== false) {
        const inviteResult = await ensureTenantInvitation({
          supabase,
          tenantId: (task as any).tenant_id,
          email,
          invitedBy: user.id,
          role: inviteRole,
        })
        inviteResults.push({
          email,
          invitationId: inviteResult.invitationId,
          emailSent: inviteResult.emailSent,
          emailError: inviteResult.emailError ?? null,
        })
      } else {
        throw new Error(`No tenant user found for ${email}`)
      }
    }

    if (resolvedUsers.length === 0) {
      return {
        success: true,
        invited: inviteResults.length > 0,
        redirected: false,
        message: 'Invitations sent. The task stays with you until at least one target user becomes available.',
        invitations: inviteResults,
      }
    }

    await supabase.from('tasks').update({
      assignment_mode: 'collaborative',
      assignee_id: resolvedUsers[0].id,
      acceptance_status: 'pending',
    } as any).eq('id', taskId)
    // Diff instead of delete-all: retained assignees keep their acceptance
    // state (the previous wipe reset everyone to pending on every redirect).
    const { data: existingAssignees } = await (supabase as any)
      .from('task_assignees')
      .select('user_id')
      .eq('task_id', taskId)
    const existingIds = new Set(((existingAssignees ?? []) as any[]).map((row) => String(row.user_id)))
    const nextIds = new Set(resolvedUsers.map((target) => String(target.id)))
    const removedIds = [...existingIds].filter((id) => !nextIds.has(id))
    if (removedIds.length > 0) {
      await (supabase as any).from('task_assignees').delete().eq('task_id', taskId).in('user_id', removedIds)
    }
    const newAssignees = resolvedUsers.filter((target) => !existingIds.has(String(target.id)))
    if (newAssignees.length > 0) {
      await (supabase as any).from('task_assignees').insert(
        newAssignees.map((target) => ({
          tenant_id: (task as any).tenant_id,
          task_id: taskId,
          user_id: target.id,
          role: existingIds.size === 0 && target.id === resolvedUsers[0].id ? 'lead' : 'collaborator',
          acceptance_status: 'pending',
          accepted_at: null,
        }))
      )
    }

    for (const target of resolvedUsers) {
      await supabase.from('notifications').insert({
        user_id: target.id,
        tenant_id: (task as any).tenant_id,
        type: 'task_assigned',
        title: `Redirected: ${(task as any).title}`,
        body: comment || 'You have been added to a redirected collaborative task.',
        task_id: taskId,
      } as any)
    }

    await supabase.from('lifecycle_events').insert({
      tenant_id: (task as any).tenant_id,
      task_id: taskId,
      actor_id: user.id,
      event_type: 'task_redirected',
      metadata: {
        redirect_assignment_mode: 'many',
        to_user_ids: resolvedUsers.map(u => u.id),
        invited_emails: inviteResults.map(i => i.email),
        comment,
      },
    } as any)

    revalidatePath('/tasks')
    revalidatePath('/tasks/assigned')
    revalidatePath('/tasks/queue')
    revalidatePath(`/tasks/${taskId}`)
    kickQueueProcessor()

    return {
      success: true,
      invited: inviteResults.length > 0,
      redirected: true,
      redirectAssignmentMode: 'many',
      redirectRecipientLimitMode,
      redirectRecipientLimit,
      targetUserIds: resolvedUsers.map(u => u.id),
      targetUserNames: resolvedUsers.map(u => u.display_name ?? u.email ?? u.id),
      invitations: inviteResults,
      message: inviteResults.length > 0
        ? 'Task redirected to multiple users and invitations sent where needed.'
        : 'Task redirected to multiple users.',
    }
  }

  if (!targetUserId && targetEmail) {
    const targetUserLookup: any = (supabase as any)
      .from('users')
      .select('id, email')
      .eq('tenant_id' as any, (task as any).tenant_id)
      .eq('email', targetEmail)
      .maybeSingle()
    const { data: existingUser } = await targetUserLookup

    if (existingUser?.id) {
      targetUserId = existingUser.id
      targetEmail = existingUser.email ?? targetEmail
    } else if (allowInviteOnRedirect && options.inviteIfNeeded !== false) {
      const inviteResult = await ensureTenantInvitation({
        supabase,
        tenantId: (task as any).tenant_id,
        email: targetEmail,
        invitedBy: user.id,
        role: inviteRole,
      })

      await supabase.from('lifecycle_events').insert({
        tenant_id: (task as any).tenant_id,
        task_id: taskId,
        event_type: 'comment_added',
        actor_id: user.id,
        metadata: {
          action: 'redirect_invite_sent',
          target_email: targetEmail,
          invite_role: inviteRole,
          invitation_id: inviteResult.invitationId,
          comment,
        },
      } as any)

      revalidatePath('/tasks')
      revalidatePath('/tasks/assigned')
      revalidatePath('/tasks/queue')
      revalidatePath(`/tasks/${taskId}`)

      return {
        success: true,
        invited: true,
        redirected: false,
        targetEmail,
        invitationId: inviteResult.invitationId,
        emailSent: inviteResult.emailSent,
        emailError: inviteResult.emailError ?? null,
        message: 'Invitation sent. The task stays with you until that person joins the organisation.',
      }
    } else {
      throw new Error('No tenant user found for that email')
    }
  }

  if (!targetUserId) {
    throw new Error(`A target user is required to ${action} this task`)
  }

  const targetUserByIdLookup: any = (supabase as any)
    .from('users')
    .select('id, email, display_name')
    .eq('id', targetUserId)
    .eq('tenant_id' as any, (task as any).tenant_id)
    .maybeSingle()
  const { data: targetUser } = await targetUserByIdLookup

  if (!targetUser?.id) throw new Error('Target user not found in this organisation')

  await supabase.from('tasks').update({
    assignee_id: targetUser.id,
    acceptance_status: 'pending',
  } as any).eq('id', taskId)

  await supabase.from('notifications').insert({
    user_id: targetUser.id,
    tenant_id: (task as any).tenant_id,
    type: action === 'escalate' ? 'task_escalated' : 'task_assigned',
    title: action === 'escalate' ? `Escalated: ${(task as any).title}` : `Redirected: ${(task as any).title}`,
    body: comment || `This task has been ${action === 'escalate' ? 'escalated' : 'redirected'} to you.`,
    task_id: taskId,
  } as any)

  await supabase.from('lifecycle_events').insert({
    tenant_id: (task as any).tenant_id,
    task_id: taskId,
    actor_id: user.id,
    event_type: action === 'escalate' ? 'task_escalated' : 'task_redirected',
    metadata: {
      to_user_id: targetUser.id,
      target_email: targetUser.email ?? targetEmail,
      comment,
    },
  } as any)

  revalidatePath('/tasks')
  revalidatePath('/tasks/assigned')
  revalidatePath('/tasks/queue')
  revalidatePath(`/tasks/${taskId}`)

  kickQueueProcessor()

  return {
    success: true,
    invited: false,
    redirected: true,
    targetUserId: targetUser.id,
    targetEmail: targetUser.email ?? targetEmail,
    targetUserName: targetUser.display_name ?? null,
  }
}

/** Session context in the task's own workspace (the unified view can open any of the user's tenants). */
async function sessionContextForTask(taskId: string) {
  const supabase = await createClient()
  const { data: task } = await supabase.from('tasks').select('id, tenant_id').eq('id', taskId).is('deleted_at', null).maybeSingle()
  if (!task) throw new Error('Task not found')
  const { fromSession } = await import('@/lib/services/context')
  return fromSession({ tenantId: String(task.tenant_id) })
}

function revalidateTask(taskId: string) {
  revalidatePath('/tasks')
  revalidatePath('/tasks/queue')
  revalidatePath('/tasks/assigned')
  revalidatePath('/tasks/team')
  revalidatePath(`/tasks/${taskId}`)
}

/**
 * Submit a response to a workflow-generated task (lib/services/task-actions.ts):
 * the assignee, or a manager acting on behalf with a note. For single-response
 * tasks this completes immediately; multi-response tasks record the response
 * and evaluate the completion rule.
 */
export async function completeWorkflowTask(
  taskId: string,
  outcome: string,
  outcomeNotes?: string,
  values?: Record<string, unknown>,
  options: { buttonId?: string | null; onBehalf?: boolean; onBehalfNote?: string | null } = {},
) {
  await requirePermission('tasks.complete')
  const ctx = await sessionContextForTask(taskId)
  const { completeWorkflowTaskAction } = await import('@/lib/services/task-actions')
  let result
  try {
    result = await completeWorkflowTaskAction(ctx, taskId, {
      outcome,
      notes: outcomeNotes ?? null,
      values: values ?? null,
      buttonId: options.buttonId ?? null,
      onBehalf: options.onBehalf === true,
      onBehalfNote: options.onBehalfNote ?? null,
    }, { via: 'ui', notifyAssigner: true })
  } catch (error) {
    const { isServiceError } = await import('@/lib/services/context')
    if (isServiceError(error)) return { success: false as const, status: 'error' as const, error: error.message, code: error.code }
    throw error
  }

  if (result.status === 'invalid') {
    return { success: false as const, status: 'invalid' as const, errors: result.errors }
  }
  revalidateTask(taskId)
  if (result.status === 'waiting') {
    return { success: true as const, status: 'waiting' as const, responses: result.responses, needed: result.needed, onBehalfOf: result.on_behalf_of }
  }
  // The task IS completed even when the resume fails — report both facts so
  // the UI can tell the user instead of silently succeeding.
  return {
    success: true as const, status: 'completed' as const, outcome: result.outcome, responses: result.responses,
    workflowResumed: result.workflow_resumed, workflowError: result.workflow_error, runId: result.run_id,
    resumed: result.workflow_resumed ? 'queued' as const : null, onBehalfOf: result.on_behalf_of,
  }
}

/** Save a workflow task's draft form values (assignee, or a manager on behalf). */
export async function saveWorkflowTaskDraft(taskId: string, values: Record<string, unknown>, options: { onBehalf?: boolean; onBehalfNote?: string | null } = {}) {
  await requirePermission('tasks.complete')
  const ctx = await sessionContextForTask(taskId)
  const { saveWorkflowTaskValues } = await import('@/lib/services/task-actions')
  const { isServiceError } = await import('@/lib/services/context')
  try {
    const saved = await saveWorkflowTaskValues(ctx, taskId, values, options)
    revalidatePath(`/tasks/${taskId}`)
    return saved
  } catch (error) {
    if (isServiceError(error)) return { success: false as const, errors: { _form: error.message } }
    throw error
  }
}

/**
 * Reassign a report's open task to another of the actor's reports or to
 * themselves (the manager view). lib/services/manager-tasks.ts.
 */
export async function reassignReportTask(taskId: string, targetUserId: string, comment?: string | null) {
  await requirePermission('tasks.assign')
  const ctx = await sessionContextForTask(taskId)
  const { reassignReportTask: reassign } = await import('@/lib/services/manager-tasks')
  const { isServiceError } = await import('@/lib/services/context')
  try {
    const result = await reassign(ctx, taskId, { target_user_id: targetUserId, comment: comment ?? null })
    revalidateTask(taskId)
    return { success: true as const, ...result }
  } catch (error) {
    if (isServiceError(error)) return { success: false as const, error: error.message }
    throw error
  }
}
/**
 * A task form's button (task metadata `form_buttons`, set when the step's
 * form has a button bar): Save draft saves the values; Submit / outcome
 * buttons complete the task (Submit with the step's first outcome, an
 * outcome button with its outcome) and then run the button's actions —
 * workflows started on the server for the assignee, the message / success
 * screen / redirect returned for the browser. The button is read from the
 * task, never from the request. A second click on a completed task is
 * refused without side effects.
 */
export async function completeTaskWithFormButton(
  taskId: string,
  buttonId: string,
  values?: Record<string, unknown>,
  outcomeNotes?: string,
  options: { onBehalf?: boolean; onBehalfNote?: string | null } = {},
) {
  await requirePermission('tasks.complete')
  const supabase = await createClient()
  const { data: task } = await supabase.from('tasks').select('id, tenant_id, status, available_outcomes, metadata').eq('id', taskId).maybeSingle()
  if (!task) throw new Error('Task not found')
  const meta = (task.metadata ?? {}) as Record<string, unknown>
  const { normalizeFormButtons, isSubmittingButton } = await import('@/lib/forms/buttons')
  if (!Array.isArray(meta.form_buttons)) return { success: false as const, error: 'This task has no form buttons' }
  const button = normalizeFormButtons(meta.form_buttons).find((b) => b.id === buttonId)
  if (!button) return { success: false as const, error: 'That button is not on this form' }
  if (task.status === 'completed' || task.status === 'cancelled') return { success: false as const, error: 'This task is already closed' }

  if (button.kind === 'draft') {
    const saved = await saveWorkflowTaskDraft(taskId, values ?? {}, options)
    if (!saved.success) return { success: false as const, status: 'invalid' as const, errors: saved.errors }
    const { planButtonEffects } = await import('@/lib/forms/buttons')
    return { success: true as const, status: 'saved' as const, effects: planButtonEffects(button, { values: values ?? {} }) }
  }
  if (!isSubmittingButton(button)) return { success: false as const, error: `"${button.label}" does not submit the form` }

  const outcomes = (task.available_outcomes ?? []) as string[]
  const outcome = button.kind === 'outcome' ? (button.outcome ?? button.label) : (outcomes[0] ?? 'completed')
  if (outcomes.length && !outcomes.includes(outcome)) return { success: false as const, error: `"${outcome}" is not an outcome of this task` }

  const result = await completeWorkflowTask(taskId, outcome, outcomeNotes, values, { buttonId: button.id, ...options })
  if (!result.success) return result

  // The button's actions run with the values as stored (validated) on the task.
  const [{ fromSession }, { createServiceClient }, { runButtonActions }] = await Promise.all([
    import('@/lib/services/context'),
    import('@/lib/cron-auth'),
    import('@/lib/services/form-submissions'),
  ])
  const db = createServiceClient()
  const { data: after } = await db.from('tasks').select('metadata').eq('id', taskId).eq('tenant_id', task.tenant_id).maybeSingle()
  const stored = (((after?.metadata ?? {}) as Record<string, unknown>).template_values ?? {}) as Record<string, unknown>
  const ctx = await fromSession({ tenantId: String(task.tenant_id) })
  const formRef = (meta.form_ref ?? {}) as { form_id?: string; name?: string }
  const { runs, effects } = await runButtonActions(ctx, db, {
    button,
    values: stored,
    form: { id: formRef.form_id ?? taskId, name: formRef.name ?? 'Task form' },
    submissionId: null,
    taskId,
  })
  return { ...result, effects, runs }
}
