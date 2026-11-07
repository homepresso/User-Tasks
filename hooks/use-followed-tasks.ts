import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { TASK_FOLLOWS_KEY } from '@/components/tasks/task-follow-button'

export interface FollowedTaskFilters {
  status?: string[]
  priority?: string[]
  search?: string
  hideCompleted?: boolean
}

/**
 * Task tracker → Following: my followed tasks in the tracker's row shape.
 * Toggling a bell invalidates TASK_FOLLOWS_KEY, so this and the count
 * refresh; window focus refreshes too (other people change these tasks).
 */
export function useFollowedTasks(filters: FollowedTaskFilters = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: [...TASK_FOLLOWS_KEY, 'list', filters],
    queryFn: async () => {
      const result = await serverRead('tasks.following', filters)
      if (result.error) throw new Error(result.error.message)
      return (result.data ?? []) as any[] // eslint-disable-line @typescript-eslint/no-explicit-any -- tracker rows
    },
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    enabled: options.enabled ?? true,
  })
}

/** The Following tab's badge: { total, open } (null until loaded). */
export function useFollowingCount() {
  return useQuery({
    queryKey: [...TASK_FOLLOWS_KEY, 'count'],
    queryFn: async () => {
      const result = await serverRead('tasks.followingCount')
      if (result.error) throw new Error(result.error.message)
      return result.data ?? { total: 0, open: 0 }
    },
    staleTime: 30_000,
  })
}
