import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'

export function useSubtasks(parentTaskId: string | null) {
  return useQuery({
    queryKey: ['subtasks', parentTaskId],
    enabled: !!parentTaskId,
    queryFn: () => serverQuery('tasks.subtasks', { parentTaskId: parentTaskId! }),
  })
}
