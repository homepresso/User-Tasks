'use client'

import { useState } from 'react'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { getInitials } from '@/lib/utils'
import { X, Users, User, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MultiAssigneePickerProps {
  selectedIds: string[]
  onChangeIds: (ids: string[]) => void
  assignmentMode: 'single' | 'individual' | 'collaborative'
  onChangeMode: (mode: 'single' | 'individual' | 'collaborative') => void
  selectedTeamId: string | null
  onChangeTeam: (teamId: string | null) => void
}

export function MultiAssigneePicker({
  selectedIds,
  onChangeIds,
  assignmentMode,
  onChangeMode,
  selectedTeamId,
  onChangeTeam,
}: MultiAssigneePickerProps) {
  const [tab, setTab] = useState<'users' | 'team'>('users')
  const [search, setSearch] = useState('')
  const { data: users } = useTenantUsers()

  const { data: teams } = useQuery({
    queryKey: ['teams-for-picker'],
    queryFn: async () => (await serverRead('tasks.teams')).data ?? [],
    staleTime: 5 * 60 * 1000,
  })

  const { data: teamMembers } = useQuery({
    queryKey: ['team-members', selectedTeamId],
    queryFn: async () => (await serverRead('tasks.teamMembers', { teamId: selectedTeamId! })).data ?? [],
    enabled: !!selectedTeamId,
  })

  const filteredUsers = users?.filter((u: any) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (u.display_name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)
  }) ?? []

  function toggleUser(userId: string) {
    if (selectedIds.includes(userId)) {
      onChangeIds(selectedIds.filter(id => id !== userId))
    } else {
      onChangeIds([...selectedIds, userId])
    }
  }

  function selectTeam(teamId: string) {
    onChangeTeam(teamId)
    // Team members will be resolved when form submits
  }

  // Auto-set mode based on selection count
  const effectiveMode = selectedIds.length <= 1 && !selectedTeamId ? 'single' : assignmentMode === 'single' ? 'individual' : assignmentMode

  return (
    <div className="space-y-3">
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
        Assign to
      </label>

      {/* Selected chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => {
            const user = users?.find((u: any) => u.id === id)
            if (!user) return null
            return (
              <span key={id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full"
                style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                  style={{ backgroundColor: 'var(--theme-primary)', color: 'var(--theme-on-primary)' }}>
                  {getInitials((user as any).display_name || (user as any).email)}
                </span>
                {(user as any).display_name || (user as any).email}
                <button onClick={() => toggleUser(id)} className="hover:opacity-70"><X size={10} /></button>
              </span>
            )
          })}
        </div>
      )}

      {selectedTeamId && (
        <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-lg"
          style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
          <Users size={12} />
          <span className="font-medium">{teams?.find((t: any) => t.id === selectedTeamId)?.name ?? 'Team'}</span>
          {teamMembers && <span>({teamMembers.length} members)</span>}
          <button onClick={() => { onChangeTeam(null); onChangeIds([]) }} className="ml-auto hover:opacity-70"><X size={10} /></button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <button onClick={() => setTab('users')} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 transition-colors"
          style={{ backgroundColor: tab === 'users' ? 'var(--theme-primary)' : 'var(--theme-surface)', color: tab === 'users' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
          <User size={12} /> Users
        </button>
        <button onClick={() => setTab('team')} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 transition-colors"
          style={{ backgroundColor: tab === 'team' ? 'var(--theme-primary)' : 'var(--theme-surface)', color: tab === 'team' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)' }}>
          <Users size={12} /> Team
        </button>
      </div>

      {tab === 'users' && (
        <>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users..."
              className="w-full rounded-lg border pl-7 pr-3 py-1.5 text-xs"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }} />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5 rounded-lg border p-1" style={{ borderColor: 'var(--theme-surface-border)' }}>
            {filteredUsers.map((user: any) => {
              const isSelected = selectedIds.includes(user.id)
              return (
                <label key={user.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:opacity-80">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleUser(user.id)}
                    className="rounded border-gray-300 text-[color:var(--theme-card-text)] w-3.5 h-3.5" />
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                    style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                    {getInitials(user.display_name || user.email)}
                  </span>
                  <span className="text-xs flex-1 truncate">{user.display_name || user.email}</span>
                  {isSelected && <span className="text-[9px]" style={{ color: 'var(--theme-primary-text)' }}>Selected</span>}
                </label>
              )
            })}
          </div>
        </>
      )}

      {tab === 'team' && (
        <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border p-1" style={{ borderColor: 'var(--theme-surface-border)' }}>
          {teams?.map((team: any) => (
            <button key={team.id} onClick={() => selectTeam(team.id)}
              className={cn("flex items-center gap-2 w-full text-left px-2 py-2 rounded text-xs transition-colors",
                selectedTeamId === team.id ? "" : "hover:opacity-80"
              )}
              style={{ backgroundColor: selectedTeamId === team.id ? 'var(--theme-primary-light)' : 'transparent' }}>
              <Users size={12} style={{ color: selectedTeamId === team.id ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }} />
              <span className="font-medium">{team.name}</span>
            </button>
          ))}
          {!teams?.length && (
            <p className="text-xs py-2 text-center" style={{ color: 'var(--theme-muted-text)' }}>No teams created yet</p>
          )}
        </div>
      )}

      {/* Assignment mode */}
      {(selectedIds.length > 1 || selectedTeamId) && (
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--theme-muted-text)' }}>
            Assignment Mode
          </label>
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <button onClick={() => onChangeMode('individual')}
              className="flex-1 text-xs font-medium py-2 px-3 transition-colors text-left"
              style={{
                backgroundColor: effectiveMode === 'individual' ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: effectiveMode === 'individual' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}>
              <p className="font-semibold">Individual</p>
              <p className="text-[9px] opacity-80 mt-0.5">Separate copy per person</p>
            </button>
            <button onClick={() => onChangeMode('collaborative')}
              className="flex-1 text-xs font-medium py-2 px-3 transition-colors text-left"
              style={{
                backgroundColor: effectiveMode === 'collaborative' ? 'var(--theme-primary)' : 'var(--theme-surface)',
                color: effectiveMode === 'collaborative' ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
              }}>
              <p className="font-semibold">Collaborative</p>
              <p className="text-[9px] opacity-80 mt-0.5">All work on same task</p>
            </button>
          </div>
        </div>
      )}

      {/* Hidden fields for form submission */}
      <input type="hidden" name="assignee_ids" value={JSON.stringify(selectedIds)} />
      <input type="hidden" name="assignment_mode" value={selectedIds.length <= 1 && !selectedTeamId ? 'single' : effectiveMode} />
      {selectedTeamId && <input type="hidden" name="assigned_team_id" value={selectedTeamId} />}
    </div>
  )
}
