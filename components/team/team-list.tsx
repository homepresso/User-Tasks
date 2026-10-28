'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Users, Trash2 } from 'lucide-react'
import { TeamMembers } from './team-members'
import { deleteTeam } from '@/app/actions/teams'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { InlineNotice } from '@/components/ui/inline-notice'

interface Team {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  member_count: { count: number }[]
}

interface TeamListProps {
  teams: Team[]
  canManage: boolean
}

export function TeamList({ teams, canManage }: TeamListProps) {
  const [localTeams, setLocalTeams] = useState<Team[]>(teams)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<{ tone: 'success' | 'warning' | 'error'; message: string } | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    setLocalTeams(teams)
  }, [teams])

  function buildHierarchy(parentId: string | null): Team[] {
    return localTeams.filter(t => t.parent_id === parentId)
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedTeams)
    next.has(id) ? next.delete(id) : next.add(id)
    setExpandedTeams(next)
  }

  async function handleDelete(teamId: string) {
    if (!confirm('Delete this team? Members will be removed.')) return
    const previous = localTeams
    setLocalTeams((current) => current.filter((team) => team.id !== teamId && team.parent_id !== teamId))
    if (selectedTeamId === teamId) setSelectedTeamId(null)
    try {
      await deleteTeam(teamId)
      setNotice({ tone: 'success', message: 'Team deleted.' })
      queryClient.invalidateQueries({ queryKey: ['teams'] })
    } catch (error) {
      setLocalTeams(previous)
      setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'Failed to delete team' })
      throw error
    }
  }

  function renderTeam(team: Team, depth: number) {
    const children = buildHierarchy(team.id)
    const hasChildren = children.length > 0
    const isExpanded = expandedTeams.has(team.id)
    const isSelected = selectedTeamId === team.id
    const memberCount = team.member_count?.[0]?.count ?? 0

    return (
      <div key={team.id}>
        <button
          onClick={() => setSelectedTeamId(isSelected ? null : team.id)}
          className={cn(
            'flex w-full items-center gap-2 px-3 py-2.5 text-sm rounded-lg transition-colors',
            isSelected ? 'bg-[color:var(--theme-primary-light)] text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]' :
              'hover:bg-gray-50 dark:hover:bg-gray-800/50 text-gray-900 dark:text-white',
          )}
          style={{ paddingLeft: `${12 + depth * 20}px` }}
        >
          {hasChildren ? (
            <span onClick={(e) => { e.stopPropagation(); toggleExpand(team.id) }}
              className="w-4 h-4 text-gray-400 cursor-pointer">
              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          ) : <span className="w-4" />}
          <Users size={14} className="text-gray-400" />
          <span className="font-medium flex-1 text-left">{team.name}</span>
          <span className="text-xs text-gray-400">{memberCount} members</span>
          {canManage && (
            <span onClick={(e) => { e.stopPropagation(); handleDelete(team.id) }}
              className="text-gray-400 hover:text-red-500 p-1 cursor-pointer" role="button">
              <Trash2 size={12} />
            </span>
          )}
        </button>
        {isExpanded && children.map(child => renderTeam(child, depth + 1))}
      </div>
    )
  }

  const rootTeams = buildHierarchy(null)

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Teams</h3>
        </div>
        <div className="p-2">
          {rootTeams.length === 0 ? (
            <p className="text-sm text-gray-500 px-3 py-4 text-center">No teams yet. Create one to get started.</p>
          ) : rootTeams.map(t => renderTeam(t, 0))}
        </div>
      </div>

      {selectedTeamId && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <TeamMembers teamId={selectedTeamId} canManage={canManage} />
        </div>
      )}
      </div>
    </div>
  )
}
