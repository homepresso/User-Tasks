'use client'

import { useTeamMembers } from '@/hooks/use-team-members'
import { UserPicker } from './user-picker'
import { RoleBadge } from './role-badge'
import { addTeamMember, removeTeamMember } from '@/app/actions/teams'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Avatar } from '@/components/ui/avatar'
import { IconButton } from '@/components/ui/icon-button'
import { Skeleton } from '@/components/ui/skeleton'

interface TeamMembersProps {
  teamId: string
  canManage: boolean
}

export function TeamMembers({ teamId, canManage }: TeamMembersProps) {
  const { data: members, isLoading } = useTeamMembers(teamId)
  const queryClient = useQueryClient()

  async function handleAdd(userId: string) {
    await addTeamMember(teamId, userId)
    queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
    queryClient.invalidateQueries({ queryKey: ['teams'] })
  }

  async function handleRemove(userId: string) {
    await removeTeamMember(teamId, userId)
    queryClient.invalidateQueries({ queryKey: ['team-members', teamId] })
    queryClient.invalidateQueries({ queryKey: ['teams'] })
  }

  const memberIds = members?.map(m => m.user.id) ?? []

  return (
    <div className="space-y-3">
      {canManage && (
        <UserPicker onSelect={handleAdd} excludeIds={memberIds} placeholder="Add member…" />
      )}
      {isLoading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading members">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-6 w-2/3" />)}
        </div>
      ) : !members?.length ? (
        <p className="text-ui text-fg-muted">No members yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {members.map(m => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar name={m.user.display_name} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-ui font-medium text-fg">{m.user.display_name}</p>
                  <p className="truncate text-xs text-fg-muted">{m.user.email}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <RoleBadge role={m.role ?? 'member'} />
                {canManage && (
                  <IconButton size="sm" label={`Remove ${m.user.display_name}`} icon={<X />} onClick={() => handleRemove(m.user.id)} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
