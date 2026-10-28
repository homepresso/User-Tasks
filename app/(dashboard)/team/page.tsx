"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { TeamList } from '@/components/team/team-list'
import { CreateTeamDialog } from '@/components/team/create-team-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { usePermissions } from '@/lib/permissions-context'
import { ReportingLines } from '@/components/team/reporting-lines'

export default function TeamPage() {
  const { can, canAny } = usePermissions()

  const { data: teams, isLoading: isTeamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: () => serverQuery('settings.teams'),
    enabled: can('team.view_members'),
  })

  const canManage = canAny('team.invite', 'team.remove')

  if (!can('team.view_members')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

  if (isTeamsLoading && !teams) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Team</h1>
        {canManage && <CreateTeamDialog teams={teams ?? []} />}
      </div>
      <TeamList teams={teams ?? []} canManage={canManage} />
      <ReportingLines canEdit={can('team.change_roles')} />
    </div>
  )
}
