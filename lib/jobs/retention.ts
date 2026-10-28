import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'
import { executeWorkflow } from "@/lib/workflow-engine"
import {
  createRetentionExecutionEvent,
  ensureRetentionReviewEvent,
  findRetentionExecutionEvent,
  listDueRetentionExecutions,
  listDueRetentionReviews,
  listTenantAdminUserIds,
} from "@/lib/retention-review"

/** Retention reviews / executions start with no user (workflow_started_by = the owner). */
const RETENTION_START = { initiator: { userId: null, via: "event" as const } }

/**
 * Daily retention pass: opens review events (admin tasks + notifications +
 * retention_policy_review workflows) for due reviews and executes due
 * retention actions (deleting data tables / rows, then firing
 * retention_policy_executed workflows). Each step is recorded on its event
 * row, so re-running the pass the same day does not repeat work.
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

  return { ok: true as const, due: dueReviews.length, dueExecutions: dueExecutions.length, createdEvents, createdTasks, triggeredWorkflows, executedPolicies }
}
