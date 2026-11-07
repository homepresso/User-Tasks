'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, ChevronDown, Users, Trash2, Pencil } from 'lucide-react'
import { TeamMembers } from './team-members'
import { deleteTeam } from '@/app/actions/teams'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from '@/lib/utils'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Card, CardHeader } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { IconButton } from '@/components/ui/icon-button'
import { Table, TBody, TD, TDActions, TH, THead, TR, TableEmpty } from '@/components/ui/table'
import { formatCount } from '@/lib/format/number'
import { EditTeamDialog, type EditableTeam } from './edit-team-dialog'

interface Team {
  id: string
  name: string
  description: string | null
  parent_id: string | null
  member_count: { count: number }[]
  lead_user_id?: string | null
  org_unit_id?: string | null
  colour?: string | null
  kind?: string | null
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
  const [confirming, setConfirming] = useState<Team | null>(null)
  const [editing, setEditing] = useState<EditableTeam | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    setLocalTeams(teams)
  }, [teams])

  function buildHierarchy(parentId: string | null): Team[] {
    return localTeams.filter(t => t.parent_id === parentId)
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedTeams)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setExpandedTeams(next)
  }

  async function handleDelete(teamId: string) {
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
    }
  }

  function renderTeam(team: Team, depth: number): React.ReactNode[] {
    const children = buildHierarchy(team.id)
    const hasChildren = children.length > 0
    const isExpanded = expandedTeams.has(team.id)
    const isSelected = selectedTeamId === team.id
    const memberCount = team.member_count?.[0]?.count ?? 0

    const row = (
      <TR key={team.id} interactive selected={isSelected} onClick={() => setSelectedTeamId(isSelected ? null : team.id)} data-team={team.id}>
        <TD className="max-w-0">
          <div className="flex min-w-0 items-center gap-2" style={{ paddingLeft: depth * 20 }}>
            {hasChildren ? (
              <button type="button" aria-expanded={isExpanded} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${team.name}`}
                className="inline-flex size-4 shrink-0 items-center justify-center text-fg-muted hover:text-fg"
                onClick={(e) => { e.stopPropagation(); toggleExpand(team.id) }}>
                {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
              </button>
            ) : <span className="w-4 shrink-0" />}
            {team.colour
              ? <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: team.colour }} />
              : <Users className="size-3.5 shrink-0 text-fg-muted" aria-hidden />}
            <span className="truncate font-medium text-fg">{team.name}</span>
            {team.kind && team.kind !== 'team' && <span className="shrink-0 rounded bg-muted px-1.5 text-2xs capitalize text-fg-muted">{team.kind}</span>}
          </div>
        </TD>
        <TD className="max-w-0 text-fg-muted max-md:hidden"><span className="block truncate">{team.description || '—'}</span></TD>
        <TD numeric className="w-24">{formatCount(memberCount)}</TD>
        {canManage ? (
          <TDActions>
            <IconButton size="sm" label={`Edit ${team.name}`} icon={<Pencil />} variant="ghost"
              onClick={(e) => { e.stopPropagation(); setEditing({ id: team.id, name: team.name, description: team.description, parent_id: team.parent_id, lead_user_id: team.lead_user_id ?? null, org_unit_id: team.org_unit_id ?? null, colour: team.colour ?? null, kind: team.kind ?? 'team' }) }} />
            <IconButton size="sm" label={`Delete ${team.name}`} icon={<Trash2 />} variant="danger-ghost"
              onClick={(e) => { e.stopPropagation(); setConfirming(team) }} />
          </TDActions>
        ) : <TD className="w-px" />}
      </TR>
    )
    return [row, ...(isExpanded ? children.flatMap(child => renderTeam(child, depth + 1)) : [])]
  }

  const rootTeams = buildHierarchy(null)
  const selectedTeam = localTeams.find((t) => t.id === selectedTeamId)

  return (
    <div className="space-y-4">
      {notice && (
        <InlineNotice tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} />
      )}

      <div className={cn('grid grid-cols-1 gap-4', selectedTeamId && 'lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]')}>
        <Table aria-label="Teams">
          <THead>
            <tr>
              <TH>Team</TH>
              <TH className="max-md:hidden">Description</TH>
              <TH numeric className="w-24">Members</TH>
              <TH className="w-px"><span className="sr-only">Actions</span></TH>
            </tr>
          </THead>
          <TBody>
            {rootTeams.length === 0 ? (
              <TableEmpty colSpan={4} icon={Users} title="No teams yet" description="Create a team to group people and route tasks to them." />
            ) : rootTeams.flatMap(t => renderTeam(t, 0))}
          </TBody>
        </Table>

        {selectedTeamId && (
          <Card padding="none" className="self-start">
            <CardHeader title={selectedTeam?.name ?? 'Team'} description="Members" />
            <div className="px-4 pb-4">
              <TeamMembers teamId={selectedTeamId} canManage={canManage} />
            </div>
          </Card>
        )}
      </div>

      <EditTeamDialog team={editing} teams={localTeams} onClose={() => setEditing(null)}
        onSaved={() => { setNotice({ tone: 'success', message: 'Team updated.' }); void queryClient.invalidateQueries({ queryKey: ['teams'] }); void queryClient.invalidateQueries({ queryKey: ['org'] }) }} />

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null) }}
        destructive
        title={`Delete ‘${confirming?.name ?? 'team'}’?`}
        description="Its members are removed from the team. People keep their accounts."
        confirmLabel="Delete team"
        onConfirm={async () => {
          const team = confirming
          setConfirming(null)
          if (team) await handleDelete(team.id)
        }}
      />
    </div>
  )
}
