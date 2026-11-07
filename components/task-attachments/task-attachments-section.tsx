"use client"

import { Card } from "@/components/ui/card"
import { TabPanel, Tabs } from "@/components/ui/tabs"
import { TaskAttachmentsPanel } from "./task-attachments-panel"
import { useTaskAttachmentCount } from "./use-task-attachments"

/**
 * The Attachments tab on today's task page (one line in
 * app/(dashboard)/tasks/[id]/page.tsx). The tabbed task page mounts
 * TaskAttachmentsPanel in its own Attachments tab instead, with
 * useTaskAttachmentCount() for the badge.
 */
export function TaskAttachmentsSection({ taskId, canEdit = true }: { taskId: string; canEdit?: boolean }) {
  const count = useTaskAttachmentCount(taskId)
  return (
    <Card padding="none" className="mt-5" data-task-attachments>
      <Tabs aria-label="Task" idBase={`task-${taskId}`} value="attachments" className="px-4"
        items={[{ value: "attachments", label: "Attachments", count }]} />
      <TabPanel idBase={`task-${taskId}`} value="attachments" className="p-4">
        <TaskAttachmentsPanel taskId={taskId} canEdit={canEdit} />
      </TabPanel>
    </Card>
  )
}
