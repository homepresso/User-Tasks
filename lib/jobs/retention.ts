import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import { executeWorkflow } from "@/lib/workflow-engine"
import {
  createRetentionExecutionEvent,
  ensureRetentionReviewEvent,
  findRetentionExecutionEvent,
  listDueFormSubmissionPurges,
  listDueRetentionExecutions,
  listDueRetentionReviews,
  listTenantAdminUserIds,
  type DueFormSubmissionPurge,
} from "@/lib/retention-review"
import { purgeFormSubmissions } from "@/lib/services/form-governance"
import { writeAudit } from "@/lib/audit-log"
import { purgeTaskAttachmentsForForm } from "@/lib/services/task-attachments"

/** Retention reviews / executions start with no user (workflow_started_by = the owner). */
const RETENTION_START = { initiator: { userId: null, via: "event" as const } }

/**
 * Daily retention pass: opens review events (admin tasks + notifications +
 * retention_policy_review workflows) for due reviews and executes due
 * retention actions (deleting data tables / rows, then firing
 * retention_policy_executed workflows). Each step is recorded on its event
 * row, so re-running the pass the same day does not repeat work.
 *
 * Forms: a form's purge policy deletes its submissions as they come due
 * (with the stored files only they hold), one execution event per form and
 * run that deleted something; forms on legal hold are skipped and counted.
 */
export async function processRetentionPolicies(options: { supabase?: SupabaseClient } = {}) {
  const supabase = options.supabase ?? createServiceClient()

  const dueReviews = await listDueRetentionReviews(supabase)
  const dueExecutions = await listDueRetentionExecutions(supabase)
  let createdEvents = 0
  let createdTasks = 0
  let triggeredWorkflows = 0
  let executedPolicies = 0

  for (const review of dueReviews) {
    const event = await ensureRetentionReviewEvent(supabase, review)
    if (event.created_at === event.updated_at) createdEvents += 1

    if (!event.admin_tasks_created_at) {
      const adminUserIds = await listTenantAdminUserIds(supabase, review.tenant_id)
      const taskIds: string[] = []
      for (const userId of adminUserIds) {
        const { data: task, error } = await supabase
          .from('tasks')
          .insert({
            tenant_id: review.tenant_id,
            title: `Retention review: ${review.retention_policy_name}`,
            description: `Review ${review.asset_name} (${review.target_type}) for policy ${review.retention_policy_name}. Due ${review.review_date}.`,
            priority: 'medium',
            assignee_id: userId,
            status: 'todo',
            acceptance_status: 'pending',
            metadata: {
              retention_review_event_id: event.id,
              retention_policy_id: review.retention_policy_id,
              retention_target_type: review.target_type,
              retention_target_id: review.target_id,
              retention_review_date: review.review_date,
            },
          } as any)
          .select('id')
          .single()
        if (!error && task?.id) {
          taskIds.push(task.id)
          createdTasks += 1
          await supabase.from('notifications').insert({
            user_id: userId,
            tenant_id: review.tenant_id,
            type: 'task_assigned',
            title: `Retention review due: ${review.retention_policy_name}`,
            body: `Please review ${review.asset_name} by ${review.review_date}.`,
            task_id: task.id,
          } as any)
        }
      }

      await (supabase as any)
        .from('retention_review_events')
        .update({
          admin_tasks_created_at: new Date().toISOString(),
          task_ids: taskIds,
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id)
    }

    if (!event.workflow_triggered_at) {
      const { data: workflows } = await (supabase as any)
        .from('workflows')
        .select('id, is_active')
        .eq('tenant_id', review.tenant_id)
        .eq('trigger_type', 'retention_policy_review')
        .eq('is_active', true)

      for (const workflow of workflows ?? []) {
        await executeWorkflow(workflow.id, undefined, false, {
          retention_review_event_id: event.id,
          retention_policy_id: review.retention_policy_id,
          retention_policy_name: review.retention_policy_name,
          retention_policy_mode: review.policy_mode,
          retention_review_date: review.review_date,
          retention_target_type: review.target_type,
          retention_target_id: review.target_id,
          retention_asset_name: review.asset_name,
        }, undefined, undefined, undefined, RETENTION_START)
        triggeredWorkflows += 1
      }

      await (supabase as any)
        .from('retention_review_events')
        .update({
          workflow_triggered_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', event.id)
    }
  }

  for (const execution of dueExecutions) {
    const existingExecutionEvent = await findRetentionExecutionEvent(supabase, execution)
    if (existingExecutionEvent) {
      if (!existingExecutionEvent.workflow_triggered_at) {
        const { data: workflows } = await (supabase as any)
          .from('workflows')
          .select('id, is_active')
          .eq('tenant_id', execution.tenant_id)
          .eq('trigger_type', 'retention_policy_executed')
          .eq('is_active', true)

        for (const workflow of workflows ?? []) {
          await executeWorkflow(workflow.id, undefined, false, {
            retention_execution_event_id: existingExecutionEvent.id,
            retention_policy_id: execution.retention_policy_id,
            retention_policy_name: execution.retention_policy_name,
            retention_policy_mode: execution.policy_mode,
            retention_action_type: execution.action_type,
            retention_execution_date: execution.execution_date,
            retention_target_type: execution.target_type,
            retention_target_id: execution.target_id,
            retention_asset_name: execution.asset_name,
          }, undefined, undefined, undefined, RETENTION_START)
          triggeredWorkflows += 1
        }

        await (supabase as any)
          .from('retention_execution_events')
          .update({
            workflow_triggered_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', existingExecutionEvent.id)
      }
      continue
    }

    if (execution.target_type === 'data_table') {
      await supabase.from('custom_table_rows').delete().eq('tenant_id', execution.tenant_id).eq('table_id', execution.target_id)
      await supabase.from('custom_tables').delete().eq('tenant_id', execution.tenant_id).eq('id', execution.target_id)
    } else if (execution.target_type === 'data_row') {
      await supabase.from('custom_table_rows').delete().eq('tenant_id', execution.tenant_id).eq('id', execution.target_id)
    }

    const event = await createRetentionExecutionEvent(supabase, execution)
    executedPolicies += 1

    const { data: workflows } = await (supabase as any)
      .from('workflows')
      .select('id, is_active')
      .eq('tenant_id', execution.tenant_id)
      .eq('trigger_type', 'retention_policy_executed')
      .eq('is_active', true)

    for (const workflow of workflows ?? []) {
      await executeWorkflow(workflow.id, undefined, false, {
        retention_execution_event_id: event.id,
        retention_policy_id: execution.retention_policy_id,
        retention_policy_name: execution.retention_policy_name,
        retention_policy_mode: execution.policy_mode,
        retention_action_type: execution.action_type,
        retention_execution_date: execution.execution_date,
        retention_target_type: execution.target_type,
        retention_target_id: execution.target_id,
        retention_asset_name: execution.asset_name,
      }, undefined, undefined, undefined, RETENTION_START)
      triggeredWorkflows += 1
    }

    await (supabase as any)
      .from('retention_execution_events')
      .update({
        workflow_triggered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', event.id)
  }

  const forms = await processFormSubmissionPurges(supabase, await listDueFormSubmissionPurges(supabase))
  executedPolicies += forms.executedPolicies
  triggeredWorkflows += forms.triggeredWorkflows

  return {
    ok: true as const, due: dueReviews.length, dueExecutions: dueExecutions.length, createdEvents, createdTasks, triggeredWorkflows, executedPolicies,
    purgedFormSubmissions: forms.submissions, purgedFormFiles: forms.files, purgedTaskAttachments: forms.taskAttachments, formsOnLegalHold: forms.held,
  }
}

/** Purge due form submissions (legal hold respected), record and announce each purge. */
export async function processFormSubmissionPurges(supabase: SupabaseClient, due: DueFormSubmissionPurge[], now = new Date()) {
  const totals = { submissions: 0, files: 0, taskAttachments: 0, held: 0, executedPolicies: 0, triggeredWorkflows: 0 }
  for (const purge of due) {
    if (purge.legal_hold) { totals.held += 1; continue }
    const result = await purgeFormSubmissions(supabase as any, {
      tenantId: purge.tenant_id, formId: purge.form_id, before: purge.cutoff,
      reason: `Retention policy "${purge.retention_policy_name}": purged`,
      metadata: { retention_policy_id: purge.retention_policy_id, policy_mode: purge.policy_mode },
    })
    if (result.held) { totals.held += 1; continue }
    // Attachments on the form's closed tasks follow the same policy and hold.
    const attachments = await purgeTaskAttachmentsForForm(supabase as any, { tenantId: purge.tenant_id, formId: purge.form_id, before: purge.cutoff })
    if (attachments.attachments) {
      await writeAudit({
        supabase: supabase as any, tenantId: purge.tenant_id, actorId: null, objectType: "form", objectId: purge.form_id, action: "purge",
        summary: `Retention policy "${purge.retention_policy_name}": purged ${attachments.attachments} task attachment${attachments.attachments === 1 ? "" : "s"} of form "${purge.form_name}"`,
        metadata: { task_attachments: attachments.attachments, before: purge.cutoff, retention_policy_id: purge.retention_policy_id },
      })
    }
    totals.taskAttachments += attachments.attachments
    if (!result.submissions && !attachments.attachments) continue
    totals.submissions += result.submissions
    totals.files += result.files
    const execution = {
      tenant_id: purge.tenant_id, retention_policy_id: purge.retention_policy_id, retention_policy_name: purge.retention_policy_name,
      policy_mode: purge.policy_mode, action_type: 'purge' as const, execution_date: now.toISOString().slice(0, 10),
      target_type: 'form' as const, target_id: purge.form_id, asset_name: purge.form_name,
    }
    const event = await createRetentionExecutionEvent(supabase, execution, { submissions: result.submissions, files: result.files, cutoff: purge.cutoff })
    totals.executedPolicies += 1
    const { data: workflows } = await (supabase as any)
      .from('workflows').select('id, is_active')
      .eq('tenant_id', purge.tenant_id).eq('trigger_type', 'retention_policy_executed').eq('is_active', true)
    for (const workflow of workflows ?? []) {
      await executeWorkflow(workflow.id, undefined, false, {
        retention_execution_event_id: event.id,
        retention_policy_id: purge.retention_policy_id,
        retention_policy_name: purge.retention_policy_name,
        retention_policy_mode: purge.policy_mode,
        retention_action_type: 'purge',
        retention_execution_date: execution.execution_date,
        retention_target_type: 'form',
        retention_target_id: purge.form_id,
        retention_asset_name: purge.form_name,
        retention_purged_count: result.submissions,
      }, undefined, undefined, undefined, RETENTION_START)
      totals.triggeredWorkflows += 1
    }
    await (supabase as any).from('retention_execution_events')
      .update({ workflow_triggered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', event.id)
  }
  return totals
}
