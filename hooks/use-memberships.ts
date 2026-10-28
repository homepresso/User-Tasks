import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { usableMemberships } from '@/lib/workspace-memberships'

/** The signed-in user's active workspaces; rows whose workspace isn't readable are dropped. */
export function useMemberships() {
  return useQuery({
    queryKey: ['memberships'],
    queryFn: () => serverQuery('settings.memberships'),
    select: usableMemberships,
  })
}
