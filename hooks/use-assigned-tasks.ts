import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { useRealtime, useRealtimeUserId } from '@/hooks/use-realtime'

interface AssignedTaskFilters {
  status?: string[]
  priority?: string[]
  search?: string
  sortBy?: string
  scope?: 'assigned_by_me' | 'team_members' | 'all'
  teamId?: string
}

/** `enabled` false: the tracker is on its Following tab (useFollowedTasks loads that). */
export function useAssignedTasks(filters: AssignedTaskFilters = {}, options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient()
  const userId = useRealtimeUserId()

  const query = useQuery({
    queryKey: ['assigned-tasks', filters],
    // Enriched (subtasks, activity, collaborators, queue rank) and searched server-side.
    queryFn: async () => (await serverRead('tasks.assigned', filters)).data ?? [],
    placeholderData: (previousData) => previousData,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: options.enabled ?? true,
  })

  // Scoped to tasks this user assigned — an unfiltered subscription made
  // every idle tab refetch (and re-persist the query cache) on ANY task
  // change anywhere in the tenant.
  useRealtime('tasks', userId ? { column: 'assigner_id', value: userId } : null, () =>
    queryClient.invalidateQueries({ queryKey: ['assigned-tasks'] }))

  return query
}
