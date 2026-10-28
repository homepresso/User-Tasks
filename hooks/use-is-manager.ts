'use client'

import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'

/** Does the signed-in user have direct reports in the current workspace? ("My team" nav.) */
export function useIsManager(enabled = true) {
  const { data } = useQuery({
    queryKey: ['is-manager'],
    queryFn: () => serverQuery('tasks.isManager'),
    enabled,
    staleTime: 5 * 60_000,
  })
  return data === true
}
