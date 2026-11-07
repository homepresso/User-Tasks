"use client"

import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { TeamList } from '@/components/team/team-list'
import { CreateTeamDialog } from '@/components/team/create-team-dialog'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { usePermissions } from '@/lib/permissions-context'
import { ReportingLines } from '@/components/team/reporting-lines'

export default function TeamPage() {
  const { can, canAny } = usePermissions()

  const { data: teams, isLoading: isTeamsLoading, isError, error, refetch } = useQuery({
    queryKey: ['teams'],
    queryFn: () => serverQuery('settings.teams'),
    enabled: can('team.view_members'),
  })

  const canManage = canAny('team.invite', 'team.remove')

  if (!can('team.view_members')) {
    return <EmptyState variant="error" title="Not authorized" description="You don’t have access to the team directory." />
  }

  if (isTeamsLoading && !teams) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-2"
        title="Team"
        description="Teams group people for task routing; reporting lines give managers their team view."
        actions={canManage ? <CreateTeamDialog teams={teams ?? []} /> : undefined}
      />
      {isError ? (
        <EmptyState variant="error" title="Couldn’t load teams" description={error instanceof Error ? error.message : undefined}
          action={{ label: 'Try again', onClick: () => void refetch() }} />
      ) : (
        <TeamList teams={teams ?? []} canManage={canManage} />
      )}
      <ReportingLines canEdit={can('team.change_roles')} />
    </div>
  )
}
