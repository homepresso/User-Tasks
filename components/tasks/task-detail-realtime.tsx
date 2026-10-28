'use client'

import { useTaskRealtime } from '@/hooks/use-task-realtime'

export function TaskDetailRealtime({ taskId, children }: { taskId: string; children: React.ReactNode }) {
  useTaskRealtime(taskId)
  return <>{children}</>
}
