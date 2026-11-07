'use client'

import { useState } from 'react'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { getInitials } from '@/lib/utils'
import { X, Users, User, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { plural } from '@/lib/format/plural'

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
      <label className="block text-sm font-medium text-fg">
        Assign to
      </label>

      {/* Selected chips */}
      {selectedIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map(id => {
            const user = users?.find((u: any) => u.id === id)
            if (!user) return null
            return (
              <span key={id} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full bg-primary-wash text-primary-text">
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-2xs font-bold bg-primary text-primary-fg">
                  {getInitials((user as any).display_name || (user as any).email)}
                </span>
                {(user as any).display_name || (user as any).email}
                <button type="button" onClick={() => toggleUser(id)} aria-label={`Remove ${(user as any).display_name || (user as any).email}`} className="rounded-sm hover:bg-primary-wash"><X size={12} /></button>
              </span>
            )
          })}
        </div>
      )}

      {selectedTeamId && (
        <div className="flex items-center gap-2 text-xs px-2 py-1.5 rounded-md bg-primary-wash text-primary-text">
          <Users size={12} />
          <span className="font-medium">{teams?.find((t: any) => t.id === selectedTeamId)?.name ?? 'Team'}</span>
          {teamMembers && <span className="num">({plural(teamMembers.length, "member")})</span>}
          <button type="button" onClick={() => { onChangeTeam(null); onChangeIds([]) }} aria-label="Clear team" className="ml-auto rounded-sm"><X size={12} /></button>
        </div>
      )}

      {/* Tabs */}
      <SegmentedControl aria-label="Assign to" className="w-full [&>button]:flex-1" value={tab} onValueChange={(v) => setTab(v as typeof tab)}
        options={[{ value: "users", text: "Users", icon: <User /> }, { value: "team", text: "Team", icon: <Users /> }]} />

      {tab === 'users' && (
        <>
          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fg-muted" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search users…" aria-label="Search users"
              className="h-8 w-full rounded-md border border-input-border bg-input pl-7 pr-3 text-ui text-fg" />
          </div>
          <div className="max-h-40 overflow-y-auto space-y-0.5 rounded-lg border p-1 border-border">
            {filteredUsers.map((user: any) => {
              const isSelected = selectedIds.includes(user.id)
              return (
                <label key={user.id} className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-subtle">
                  <input type="checkbox" checked={isSelected} onChange={() => toggleUser(user.id)}
                    className="size-3.5 rounded-sm accent-[color:var(--theme-primary)]" />
                  <span className="w-5 h-5 rounded-full flex items-center justify-center text-2xs font-bold shrink-0 bg-subtle text-fg-muted">
                    {getInitials(user.display_name || user.email)}
                  </span>
                  <span className="text-xs flex-1 truncate">{user.display_name || user.email}</span>
                  {isSelected && <span className="text-2xs text-primary-text">Selected</span>}
                </label>
              )
            })}
          </div>
        </>
      )}

      {tab === 'team' && (
        <div className="space-y-1 max-h-40 overflow-y-auto rounded-lg border p-1 border-border">
          {teams?.map((team: any) => (
            <button key={team.id} type="button" onClick={() => selectTeam(team.id)} aria-pressed={selectedTeamId === team.id}
              className={cn("flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-ui transition-colors",
                selectedTeamId === team.id ? "bg-primary-wash" : "hover:bg-subtle"
              )}>
              <Users size={12} className={selectedTeamId === team.id ? "text-primary-text" : "text-fg-muted"} />
              <span className="font-medium">{team.name}</span>
            </button>
          ))}
          {!teams?.length && (
            <p className="text-xs py-2 text-center text-fg-muted">No teams created yet</p>
          )}
        </div>
      )}

      {/* Assignment mode */}
      {(selectedIds.length > 1 || selectedTeamId) && (
        <div>
          <label className="block text-xs font-medium mb-1.5 text-fg-muted">
            Assignment mode
          </label>
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Assignment mode">
            <button type="button" role="radio" aria-checked={effectiveMode === 'individual'} onClick={() => onChangeMode('individual')}
              className={cn("rounded-md border px-3 py-2 text-left text-ui transition-colors", effectiveMode === 'individual' ? "border-primary bg-primary-wash text-fg" : "border-border text-fg hover:bg-subtle")}>
              <p className="font-semibold">Individual</p>
              <p className="mt-0.5 text-xs text-fg-muted">Separate copy per person</p>
            </button>
            <button type="button" role="radio" aria-checked={effectiveMode === 'collaborative'} onClick={() => onChangeMode('collaborative')}
              className={cn("rounded-md border px-3 py-2 text-left text-ui transition-colors", effectiveMode === 'collaborative' ? "border-primary bg-primary-wash text-fg" : "border-border text-fg hover:bg-subtle")}>
              <p className="font-semibold">Collaborative</p>
              <p className="mt-0.5 text-xs text-fg-muted">All work on same task</p>
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
