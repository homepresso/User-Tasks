import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { useDebounced, useRealtime, useRealtimeUserId } from '@/hooks/use-realtime'

export interface TaskQueueResult {
  tasks: any[]
  /** True when any bucket hit its query cap (100) — there are more items than shown. */
  hasMore: boolean
}

export function useTaskQueue() {
  const queryClient = useQueryClient()
  const userId = useRealtimeUserId()

  const query = useQuery<TaskQueueResult>({
    queryKey: ['task-queue'],
    // Pending acceptance, workflow and team tasks for the signed-in user (bucketed server-side).
    queryFn: () => serverQuery('tasks.queue'),
  })

  // Debounce: bursts of task updates (workflow runs) collapse into one refetch.
  const invalidate = useDebounced(() => queryClient.invalidateQueries({ queryKey: ['task-queue'] }), 300)
  // Scoped to this user's tasks — an unfiltered subscription refetched the
  // queue on EVERY task change in the tenant.
  useRealtime('tasks', userId ? { column: 'assignee_id', value: userId } : null, invalidate)
  useRealtime('task_assignees', userId ? { column: 'user_id', value: userId } : null, invalidate)

  return query
}
