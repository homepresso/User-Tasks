import { useQueryClient } from '@tanstack/react-query'
import { useRealtime } from '@/hooks/use-realtime'

/** Live updates for one task: the task itself, its subtasks and its timeline. */
export function useTaskRealtime(taskId: string) {
  const queryClient = useQueryClient()
  const refreshTree = () => queryClient.invalidateQueries({ queryKey: ['task-tree', taskId] })

  useRealtime('tasks', { column: 'id', value: taskId }, refreshTree)
  useRealtime('tasks', { column: 'parent_task_id', value: taskId }, refreshTree)
  useRealtime('lifecycle_events', { column: 'task_id', value: taskId, event: 'INSERT' }, () =>
    queryClient.invalidateQueries({ queryKey: ['timeline', taskId] }))
}
