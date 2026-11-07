"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { TaskAttachment } from "@/lib/task-attachments"

/** What GET /api/internal/tasks/<id>/attachments returns (lib/services/task-attachments.ts listTaskAttachments). */
export interface TaskAttachmentListData {
  task_id: string
  attachments: Array<TaskAttachment & { can_delete: boolean }>
  can_add: boolean
  legal_hold: boolean
  type_suggestions: string[]
  max_file_bytes: number
}

export const taskAttachmentsKey = (taskId: string) => ["task-attachments", taskId] as const

async function fetchList(taskId: string): Promise<TaskAttachmentListData> {
  const res = await fetch(`/api/internal/tasks/${encodeURIComponent(taskId)}/attachments`, { credentials: "same-origin", cache: "no-store" })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? "Couldn't load the attachments")
  return body as TaskAttachmentListData
}

/** The task's attachments (shared by the panel and the tab's count badge). */
export function useTaskAttachments(taskId: string, enabled = true) {
  return useQuery({ queryKey: taskAttachmentsKey(taskId), queryFn: () => fetchList(taskId), enabled: enabled && Boolean(taskId), staleTime: 15_000 })
}

/** Count for an "Attachments" tab badge (undefined while loading or when the task can't be read). */
export function useTaskAttachmentCount(taskId: string): number | undefined {
  return useTaskAttachments(taskId).data?.attachments.length
}

export function useInvalidateTaskAttachments(taskId: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: taskAttachmentsKey(taskId) })
}
