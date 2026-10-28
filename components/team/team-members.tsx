'use client'

import { useTeamMembers } from '@/hooks/use-team-members'
import { UserPicker } from './user-picker'
import { RoleBadge } from './role-badge'
import { addTeamMember, removeTeamMember } from '@/app/actions/teams'
import { getInitials } from '@/lib/utils'
import { X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'

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
    <div>
      <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Members</h4>
      {canManage && (
        <div className="mb-3">
          <UserPicker onSelect={handleAdd} excludeIds={memberIds} placeholder="Add member..." />
        </div>
      )}
      {isLoading ? (
        <p className="text-sm text-gray-500">Loading...</p>
      ) : !members?.length ? (
        <p className="text-sm text-gray-500">No members yet.</p>
      ) : (
        <div className="space-y-2">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-bold">
                  {getInitials(m.user.display_name)}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{m.user.display_name}</p>
                  <p className="text-xs text-gray-500">{m.user.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <RoleBadge role={m.role ?? 'member'} />
                {canManage && (
                  <button onClick={() => handleRemove(m.user.id)}
                    className="text-gray-400 hover:text-red-500 p-1">
                    <X size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
