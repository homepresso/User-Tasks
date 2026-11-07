"use client"

import { TaskAttachmentsPanel } from "@/components/task-attachments/task-attachments-panel"
import { useTaskAttachmentCount as useCount } from "@/components/task-attachments/use-task-attachments"

/**
 * The task page's Attachments tab: the task-attachments panel
 * (components/task-attachments/). The panel checks add/delete rights on the
 * server; `canEdit` only hides the controls for people who can't act.
 */
export function TaskAttachmentsTab({ taskId, canEdit }: { taskId: string; tenantId: string; canEdit: boolean }) {
  return <TaskAttachmentsPanel taskId={taskId} canEdit={canEdit} />
}

/** Number of files on the task, or undefined while unknown (no badge). */
export function useTaskAttachmentCount(taskId: string): number | undefined {
  return useCount(taskId)
}
