import { NextRequest } from 'next/server'
import { mergeTaskFieldValuesChecked } from '@/lib/forms/task-values'
import { validateApiKey, requireApiPermission, ok, err } from '@/lib/api-auth'
import { ensureTenantInvitation } from '@/lib/invitations'
import { kickQueueProcessor } from '@/lib/process-queue'
import { z } from 'zod'
import { canAccessTaskAsUser } from '@/lib/api-key-permissions'
import { taskActionBody as actionSchema } from '@/lib/api-schemas/tasks'
import { fromApiAuth, isServiceError } from '@/lib/services/context'
import { completeWorkflowTaskAction, respondToWorkflowTask } from '@/lib/services/task-actions'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await validateApiKey(request)
  if (!auth.success) return auth.response
  const forbidden = requireApiPermission(auth, 'tasks.complete')
  if (forbidden) return forbidden
  const { tenantId, supabase, createdBy, actingUserId } = auth
  const { id: taskId } = await params

  let body
  try {
    body = actionSchema.parse(await request.json())
  } catch (e) {
    const zodError = e as z.ZodError
    return err(`Validation failed: ${zodError.issues.map(i => i.message).join(', ')}`)
  }

  // Verify task exists and belongs to tenant
  const { data: task } = await supabase
    .from('tasks')
    .select('id, title, status, event_id, is_workflow_task, tenant_id, assignee_id, assigner_id, allow_reassign, allow_escalate, metadata')
    .eq('id', taskId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .single()

  if (!task) return err('Task not found', 404)

  // Workflow tasks: assignee only, or a manager / break-glass holder acting
  // on behalf (lib/task-authz.ts) — one service for every surface.
  const isWorkflow = Boolean(task.is_workflow_task && task.event_id)
  if (isWorkflow && ['accept', 'hold', 'reject', 'complete'].includes(body.action)) {
    const ctx = fromApiAuth(auth)
    try {
      if (body.action === 'complete') {
        const result = await completeWorkflowTaskAction(ctx, taskId, {
          outcome: body.outcome ?? 'completed',
          notes: body.outcome_notes ?? null,
          values: body.values ?? null,
          onBehalf: body.on_behalf === true,
          onBehalfNote: body.on_behalf_note ?? null,
        }, { via: 'api' })
        kickQueueProcessor()
        if (result.status === 'invalid') return err(`Invalid field values: ${Object.values(result.errors).join('; ')}`, 400)
        if (result.status === 'waiting') return ok({ action: 'waiting', responses: result.responses, needed: result.needed, acted_as: result.acted_as, on_behalf_of: result.on_behalf_of })
        return ok({
          action: 'completed', outcome: result.outcome, workflow_resumed: result.workflow_resumed,
          ...(result.workflow_resumed ? { workflow_status: 'queued', run_id: result.run_id, resumed: 'queued' } : { workflow_error: result.workflow_error }),
          acted_as: result.acted_as, on_behalf_of: result.on_behalf_of,
        })
      }
      if ((body.action === 'hold' || body.action === 'reject') && body.on_behalf && !body.comment?.trim() && !body.on_behalf_note?.trim()) {
        return err('A comment is required', 400)
      }
      const response = body.action === 'accept' ? 'accepted' : body.action === 'hold' ? 'held' : 'rejected'
      const result = await respondToWorkflowTask(ctx, taskId, response, { comment: body.comment ?? null, onBehalf: body.on_behalf === true, onBehalfNote: body.on_behalf_note ?? null, via: 'api' })
      kickQueueProcessor()
      return ok({ action: response, acted_as: result.acted_as, on_behalf_of: result.on_behalf_of })
    } catch (e) {
      if (isServiceError(e)) return err(e.message, e.status)
      throw e
    }
  }

  if (actingUserId && !(await canAccessTaskAsUser(supabase, tenantId, actingUserId, taskId))) {
    return err('This user-context API key cannot act on that task', 403)
  }

  switch (body.action) {
    case 'accept': {
      const acceptUpdates: Record<string, any> = {
        acceptance_status: 'accepted',
        accepted_at: new Date().toISOString(),
      }
      // Don't regress a task that is already further along.
      if (['todo', 'draft', 'blocked', null, ''].includes((task as any).status ?? '')) {
        acceptUpdates.status = 'in_progress'
      }
      await supabase.from('tasks').update(acceptUpdates as any).eq('id', taskId)

      await supabase.from('lifecycle_events').insert({
        tenant_id: tenantId,
        task_id: taskId,
        event_type: 'task_accepted',
        metadata: { via: 'api' },
      } as any)

      kickQueueProcessor()
      return ok({ action: 'accepted' })
    }

    case 'hold': {
      await supabase.from('tasks').update({
        acceptance_status: 'held',
      } as any).eq('id', taskId)

      await supabase.from('lifecycle_events').insert({
        tenant_id: tenantId,
        task_id: taskId,
        event_type: 'task_held',
        metadata: { comment: body.comment ?? null, via: 'api' },
      } as any)

      kickQueueProcessor()
      return ok({ action: 'held' })
    }

    case 'reject': {
      await supabase.from('tasks').update({
        acceptance_status: 'rejected',
        status: 'cancelled',
      } as any).eq('id', taskId)

      await supabase.from('lifecycle_events').insert({
        tenant_id: tenantId,
        task_id: taskId,
        event_type: 'task_rejected',
        metadata: { comment: body.comment ?? null, via: 'api' },
      } as any)

      kickQueueProcessor()
      return ok({ action: 'rejected' })
    }

    case 'complete': {
      const taskMetadata = (task.metadata ?? {}) as Record<string, unknown>
      const { errors: fieldErrors, templateValues } = await mergeTaskFieldValuesChecked(supabase, tenantId, taskMetadata, body.values, { taskId })
      if (Object.keys(fieldErrors).length > 0) {
        return err(`Invalid field values: ${Object.values(fieldErrors).join('; ')}`, 400)
      }

      await supabase.from('tasks').update({
        status: 'completed',
        outcome: body.outcome ?? null,
        outcome_notes: body.outcome_notes ?? null,
        completed_at: new Date().toISOString(),
        acceptance_status: 'accepted',
        ...(body.values ? { metadata: { ...taskMetadata, template_values: templateValues } } : {}),
      } as any).eq('id', taskId)

      await supabase.from('lifecycle_events').insert({
        tenant_id: tenantId,
        task_id: taskId,
        event_type: 'task_response',
        metadata: { outcome: body.outcome, outcome_notes: body.outcome_notes, via: 'api' },
      } as any)

      kickQueueProcessor()
      return ok({ action: 'completed' })
    }

    case 'escalate':
    case 'redirect': {
      const isEscalate = body.action === 'escalate'

      if (body.action === 'redirect' && task.allow_reassign !== true) {
        return err('Redirect is not enabled for this task', 403)
      }

      if (isEscalate && task.allow_escalate === false) {
        return err('Escalation is not enabled for this task', 403)
      }

      const metadata = ((task.metadata ?? {}) as Record<string, any>)
      const taskActions = ((metadata.task_actions ?? {}) as Record<string, any>)
      const allowInviteOnRedirect = taskActions.allow_invite_on_redirect === true
      const redirectAssignmentMode = taskActions.redirect_assignment_mode === 'many' ? 'many' : 'single'
      const redirectRecipientLimitMode = taskActions.redirect_recipient_limit_mode === 'capped' ? 'capped' : 'unlimited'
      const redirectRecipientLimit = redirectRecipientLimitMode === 'capped'
        ? Math.max(1, Number(taskActions.redirect_recipient_limit ?? 1))
        : null
      const inviteRole = body.invite_role ?? taskActions.invite_role ?? 'viewer'
      const targetEmail = body.target_email?.toLowerCase().trim()
      const targetEmails = (body.target_emails ?? []).map(email => email.toLowerCase().trim()).filter(Boolean)
      const targetUserIds = Array.from(new Set([...(body.target_user_ids ?? []), ...(body.target_user_id ? [body.target_user_id] : [])]))

      if (!targetUserIds.length && !targetEmail && !targetEmails.length) {
        return err(`target_user_id(s) or target_email(s) is required for ${body.action}`, 400)
      }

      if (body.action === 'redirect' && redirectAssignmentMode === 'many') {
        const requestedRecipientCount = targetUserIds.length + Array.from(new Set([...(targetEmail ? [targetEmail] : []), ...targetEmails])).length
        if (redirectRecipientLimitMode === 'capped' && redirectRecipientLimit !== null && requestedRecipientCount > redirectRecipientLimit) {
          return err(`You can redirect this task to up to ${redirectRecipientLimit} people`, 400)
        }

        const resolvedUsers: { id: string; email: string | null }[] = []
        for (const userId of targetUserIds) {
          const lookup: any = (supabase as any).from('users').select('id, email').eq('id', userId).eq('tenant_id' as any, tenantId).maybeSingle()
          const { data } = await lookup
          if (data?.id && !resolvedUsers.some(u => u.id === data.id)) resolvedUsers.push(data)
        }

        const inviteResults: Array<{ email: string; invitation_id: string | null; email_sent: boolean; email_error: string | null }> = []
        for (const email of Array.from(new Set([...(targetEmail ? [targetEmail] : []), ...targetEmails]))) {
          const lookup: any = (supabase as any).from('users').select('id, email').eq('tenant_id' as any, tenantId).eq('email', email).maybeSingle()
          const { data } = await lookup
          if (data?.id) {
            if (!resolvedUsers.some(u => u.id === data.id)) resolvedUsers.push(data)
            continue
          }
          if (allowInviteOnRedirect && body.invite_if_needed !== false) {
            const inviterId = actingUserId ?? createdBy ?? task.assigner_id ?? task.assignee_id
            if (!inviterId) return err('Unable to send redirect invite because no inviter context is available', 500)
            const inviteResult = await ensureTenantInvitation({
              supabase,
              tenantId,
              email,
              invitedBy: inviterId,
              role: inviteRole,
            })
            inviteResults.push({
              email,
              invitation_id: inviteResult.invitationId,
              email_sent: inviteResult.emailSent,
              email_error: inviteResult.emailError ?? null,
            })
          } else {
            return err(`No tenant user found for ${email}`, 404)
          }
        }

        if (resolvedUsers.length === 0) {
          return ok({
            action: body.action,
            invited: inviteResults.length > 0,
            redirected: false,
            redirect_assignment_mode: 'many',
            invitations: inviteResults,
            message: 'Invitations sent. The task remains with the current assignee until at least one target user becomes available.',
          })
        }

        await supabase.from('tasks').update({
          assignment_mode: 'collaborative',
          assignee_id: resolvedUsers[0].id,
          acceptance_status: 'pending',
        } as any).eq('id', taskId)
        // Diff instead of delete-all so retained assignees keep acceptance state.
        const { data: existingAssignees } = await (supabase as any)
          .from('task_assignees')
          .select('user_id')
          .eq('task_id', taskId)
        const existingIds = new Set(((existingAssignees ?? []) as any[]).map((row) => String(row.user_id)))
        const removedIds = [...existingIds].filter((id) => !resolvedUsers.some((target) => String(target.id) === id))
        if (removedIds.length > 0) {
          await (supabase as any).from('task_assignees').delete().eq('task_id', taskId).in('user_id', removedIds)
        }
        const newAssignees = resolvedUsers.filter((target) => !existingIds.has(String(target.id)))
        if (newAssignees.length > 0) {
          await (supabase as any).from('task_assignees').insert(
            newAssignees.map((target) => ({
              tenant_id: tenantId,
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
            tenant_id: tenantId,
            type: 'task_assigned',
            title: `Redirected: ${task.title}`,
            body: body.comment || 'You have been added to a redirected collaborative task.',
            task_id: taskId,
          } as any)
        }

        await supabase.from('lifecycle_events').insert({
          tenant_id: tenantId,
          task_id: taskId,
          event_type: 'task_redirected',
          metadata: {
            via: 'api',
            redirect_assignment_mode: 'many',
            to_user_ids: resolvedUsers.map(u => u.id),
            invited_emails: inviteResults.map(i => i.email),
            comment: body.comment ?? null,
          },
        } as any)

        kickQueueProcessor()
        return ok({
          action: body.action,
          invited: inviteResults.length > 0,
          redirected: true,
          redirect_assignment_mode: 'many',
          redirect_recipient_limit_mode: redirectRecipientLimitMode,
          redirect_recipient_limit: redirectRecipientLimit,
          target_user_ids: resolvedUsers.map(u => u.id),
          invitations: inviteResults,
        })
      }

      let targetUserId = body.target_user_id ?? null
      let resolvedTargetEmail: string | null = targetEmail ?? null
      let invited = false
      let inviteResult: Awaited<ReturnType<typeof ensureTenantInvitation>> | null = null

      if (!targetUserId && targetEmail) {
        const targetUserLookup: any = (supabase as any)
          .from('users')
          .select('id, email')
          .eq('tenant_id' as any, tenantId)
          .eq('email', targetEmail)
          .maybeSingle()
        const { data: targetUser } = await targetUserLookup

        if (targetUser?.id) {
          targetUserId = targetUser.id
          resolvedTargetEmail = targetUser.email ?? targetEmail
        } else if (body.action === 'redirect' && allowInviteOnRedirect && body.invite_if_needed !== false) {
          const inviterId = actingUserId ?? createdBy ?? task.assigner_id ?? task.assignee_id
          if (!inviterId) {
            return err('Unable to send redirect invite because no inviter context is available', 500)
          }

          inviteResult = await ensureTenantInvitation({
            supabase,
            tenantId,
            email: targetEmail,
            invitedBy: inviterId,
            role: inviteRole,
          })
          invited = true

          await supabase.from('lifecycle_events').insert({
            tenant_id: tenantId,
            task_id: taskId,
            event_type: 'comment_added',
            metadata: {
              via: 'api',
              action: 'redirect_invite_sent',
              target_email: targetEmail,
              invite_role: inviteRole,
              invitation_id: inviteResult.invitationId,
              comment: body.comment ?? null,
            },
          } as any)

          kickQueueProcessor()
          return ok({
            action: body.action,
            invited: true,
            redirected: false,
            target_email: targetEmail,
            invite_role: inviteRole,
            invitation_id: inviteResult.invitationId,
            invite_pending: inviteResult.alreadyPending,
            email_sent: inviteResult.emailSent,
            email_error: inviteResult.emailError ?? null,
            message: 'Invitation sent. The task remains with the current assignee until the invited user joins.',
          })
        } else {
          return err('No tenant user found for target_email', 404)
        }
      }

      if (!targetUserId) {
        return err(`target_user_id is required for ${body.action}`, 400)
      }

      const targetUserByIdLookup: any = (supabase as any)
        .from('users')
        .select('id, email')
        .eq('id', targetUserId)
        .eq('tenant_id' as any, tenantId)
        .maybeSingle()
      const { data: targetUserById } = await targetUserByIdLookup

      if (!targetUserById?.id) {
        return err('Target user not found in this tenant', 404)
      }

      await supabase.from('tasks').update({
        assignee_id: targetUserId,
        acceptance_status: 'pending',
      } as any).eq('id', taskId)

      resolvedTargetEmail = resolvedTargetEmail ?? targetUserById.email ?? null

      // Create notification for new assignee
      await supabase.from('notifications').insert({
        user_id: targetUserId,
        tenant_id: tenantId,
        type: isEscalate ? 'task_escalated' : 'task_assigned',
        title: isEscalate ? `Escalated: ${task.title}` : `Redirected: ${task.title}`,
        body: body.comment || `This task has been ${isEscalate ? 'escalated' : 'redirected'} to you.`,
        task_id: taskId,
      } as any)

      // Record lifecycle event
      await supabase.from('lifecycle_events').insert({
        tenant_id: tenantId,
        task_id: taskId,
        event_type: isEscalate ? 'task_escalated' : 'task_redirected',
        metadata: { to_user_id: targetUserId, target_email: resolvedTargetEmail, comment: body.comment ?? null, via: 'api' },
      } as any)

      kickQueueProcessor()
      return ok({
        action: body.action,
        target_user_id: targetUserId,
        target_email: resolvedTargetEmail,
        invited,
        invitation_id: null,
      })
    }
  }
}
