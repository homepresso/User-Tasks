import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/cron-auth'

/**
 * Process task reminders.
 * Finds reminders that should have fired (offset before due_date has passed) and creates notifications.
 */
export async function processTaskReminders(options: { supabase?: SupabaseClient } = {}) {
  const supabase = options.supabase ?? createServiceClient()

  const now = new Date()

  // Find unsent reminders where the reminder time has passed
  // reminder_time = task.due_date - offset_minutes
  const { data: reminders, error } = await supabase
    .from("task_reminders")
    .select("*, task:tasks(id, title, assignee_id, assigned_team_id, tenant_id, due_date, status)")
    .eq("is_sent", false)

  if (error) throw new Error(error.message)

  let sent = 0
  let skipped = 0

  for (const reminder of reminders ?? []) {
    const task = reminder.task as any
    if (!task || !task.due_date) { skipped++; continue }

    // Skip completed/cancelled tasks
    if (task.status === "completed" || task.status === "cancelled") {
      // Mark as sent so we don't process again
      await supabase.from("task_reminders").update({ is_sent: true, sent_at: now.toISOString() }).eq("id", reminder.id)
      skipped++
      continue
    }

    // Calculate when the reminder should fire
    const dueDate = new Date(task.due_date)
    const reminderTime = new Date(dueDate.getTime() - reminder.offset_minutes * 60000)

    if (now >= reminderTime) {
      // Time to send this reminder
      const hoursLeft = Math.max(0, Math.round((dueDate.getTime() - now.getTime()) / 3600000))
      const timeLabel = hoursLeft > 24 ? `${Math.round(hoursLeft / 24)} days` : `${hoursLeft} hours`

      // Determine who to notify
      const notifyUserIds: string[] = []
      if (task.assignee_id) {
        notifyUserIds.push(task.assignee_id)
      }
      if (task.assigned_team_id) {
        // Get all team members
        const { data: members } = await supabase
          .from("user_teams")
          .select("user_id")
          .eq("team_id", task.assigned_team_id)
        if (members) notifyUserIds.push(...members.map((m: any) => m.user_id))
      }

      // Create notifications
      for (const userId of notifyUserIds) {
        await supabase.from("notifications").insert({
          user_id: userId,
          tenant_id: task.tenant_id,
          type: "task_reminder",
          title: `Reminder: ${task.title}`,
          body: `Due in ${timeLabel}. Please action this task before the deadline.`,
          task_id: task.id,
        })
      }

      // Mark reminder as sent
      await supabase.from("task_reminders").update({ is_sent: true, sent_at: now.toISOString() }).eq("id", reminder.id)
      sent++
    } else {
      skipped++
    }
  }

  return { ok: true as const, sent, skipped, total: reminders?.length ?? 0 }
}
