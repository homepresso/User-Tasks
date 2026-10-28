import { useQuery } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'

export function useTeamMembers(teamId: string | null) {
  return useQuery({
    queryKey: ['team-members', teamId],
    queryFn: () => serverQuery('settings.teamMembers', { teamId: teamId! }),
    enabled: !!teamId,
  })
}
