import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'

/**
 * Process task escalations.
 * Finds overdue tasks with escalation config and reassigns/notifies.
 */
export async function processTaskEscalations(options: { supabase?: SupabaseClient } = {}) {
  const supabase = options.supabase ?? createServiceClient()

  const now = new Date()

  // Find unescalated escalation configs
  const { data: escalations, error } = await supabase
    .from("task_escalations")
    .select("*, task:tasks(id, title, assignee_id, assigned_team_id, tenant_id, due_date, status, acceptance_status)")
    .eq("is_escalated", false)

  if (error) throw new Error(error.message)

  let escalated = 0
  let skipped = 0

  for (const esc of escalations ?? []) {
    const task = esc.task as any
    if (!task || !task.due_date) { skipped++; continue }

    // Skip completed/cancelled tasks
    if (task.status === "completed" || task.status === "cancelled") {
      await supabase.from("task_escalations").update({ is_escalated: true, escalated_at: now.toISOString() }).eq("id", esc.id)
      skipped++
      continue
    }

    // Calculate escalation time = due_date + escalate_after_minutes
    const dueDate = new Date(task.due_date)
    const escalateTime = new Date(dueDate.getTime() + esc.escalate_after_minutes * 60000)

    if (now >= escalateTime) {
      // Time to escalate
      let escalateToUserId: string | null = null
      let escalateToTeamId: string | null = null
      let escalateLabel = ""

      if (esc.escalation_type === "individual" && esc.user_id) {
        escalateToUserId = esc.user_id
        const { data: u } = await supabase.from("users").select("display_name").eq("id", esc.user_id).single()
        escalateLabel = u?.display_name ?? "a user"
      } else if (esc.escalation_type === "team" && esc.team_id) {
        escalateToTeamId = esc.team_id
        const { data: t } = await supabase.from("teams").select("name").eq("id", esc.team_id).single()
        escalateLabel = t?.name ?? "a team"
      } else if (esc.escalation_type === "manager") {
        // Find assignee's manager
        if (task.assignee_id) {
          const { data: assignee } = await supabase.from("users").select("manager_id").eq("id", task.assignee_id).single()
          if (assignee?.manager_id) {
            escalateToUserId = assignee.manager_id
            const { data: mgr } = await supabase.from("users").select("display_name").eq("id", assignee.manager_id).single()
            escalateLabel = mgr?.display_name ?? "manager"
          }
        }
      }

      // Update task — reassign if we have a target
      const taskUpdates: Record<string, any> = { status: "todo", acceptance_status: "pending" }
      if (escalateToUserId) {
        taskUpdates.assignee_id = escalateToUserId
        taskUpdates.assigned_team_id = null
        taskUpdates.assignment_type = "individual"
      } else if (escalateToTeamId) {
        taskUpdates.assigned_team_id = escalateToTeamId
        taskUpdates.assignee_id = null
        taskUpdates.assignment_type = "team"
      }

      await supabase.from("tasks").update(taskUpdates).eq("id", task.id)

      // Notify the new assignee
      if (escalateToUserId) {
        await supabase.from("notifications").insert({
          user_id: escalateToUserId,
          tenant_id: task.tenant_id,
          type: "task_escalated",
          title: `Escalated: ${task.title}`,
          body: `This task was overdue and has been escalated to you.`,
          task_id: task.id,
        })
      }
      if (escalateToTeamId) {
        // Notify all team members
        const { data: members } = await supabase.from("user_teams").select("user_id").eq("team_id", escalateToTeamId)
        for (const m of members ?? []) {
          await supabase.from("notifications").insert({
            user_id: m.user_id,
            tenant_id: task.tenant_id,
            type: "task_escalated",
            title: `Escalated: ${task.title}`,
            body: `This task was overdue and has been escalated to your team.`,
            task_id: task.id,
          })
        }
      }

      // Notify original assignee that it was escalated
      if (task.assignee_id && task.assignee_id !== escalateToUserId) {
        await supabase.from("notifications").insert({
          user_id: task.assignee_id,
          tenant_id: task.tenant_id,
          type: "task_escalated",
          title: `Task escalated: ${task.title}`,
          body: `This task was overdue and has been escalated to ${escalateLabel}.`,
          task_id: task.id,
        })
      }

      // Record lifecycle event
      await supabase.from("lifecycle_events").insert({
        tenant_id: task.tenant_id,
        task_id: task.id,
        event_type: "task_escalated",
        metadata: {
          escalation_type: esc.escalation_type,
          escalated_to_user: escalateToUserId,
          escalated_to_team: escalateToTeamId,
          minutes_past_due: esc.escalate_after_minutes,
        },
      } as any)

      // Mark escalation as done
      await supabase.from("task_escalations").update({ is_escalated: true, escalated_at: now.toISOString() }).eq("id", esc.id)
      escalated++
    } else {
      skipped++
    }
  }

  return { ok: true as const, escalated, skipped, total: escalations?.length ?? 0 }
}
