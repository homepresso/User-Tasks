'use client'

import { useState } from 'react'
import { X, Users } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { plural } from '@/lib/format/plural'
import { AssigneeSearch, assigneeKey, type AssigneePick } from '@/components/tasks/assignee-search'
import { TeamOriginBadge } from '@/components/teams/team-origin-badge'

export type AssignmentMode = 'single' | 'individual' | 'collaborative' | 'team'

interface MultiAssigneePickerProps {
  selectedIds: string[]
  onChangeIds: (ids: string[]) => void
  assignmentMode: AssignmentMode
  onChangeMode: (mode: AssignmentMode) => void
  selectedTeamId: string | null
  onChangeTeam: (teamId: string | null) => void
}

type PickedTeam = Extract<AssigneePick, { kind: 'team' }>

/**
 * Create task's "Assign to": one search over people and teams
 * (components/tasks/assignee-search). People add up (several people: a copy
 * each, or one shared task); a team replaces the people and becomes a team
 * task by default (one task, a member claims it), or a copy per member, or
 * one task for all of them.
 */
export function MultiAssigneePicker({
  selectedIds,
  onChangeIds,
  assignmentMode,
  onChangeMode,
  selectedTeamId,
  onChangeTeam,
}: MultiAssigneePickerProps) {
  // Names of what was picked (the search results come and go).
  const [people, setPeople] = useState<Record<string, string>>({})
  const [team, setTeam] = useState<PickedTeam | null>(null)

  function onPick(pick: AssigneePick) {
    if (pick.kind === 'person') {
      if (selectedIds.includes(pick.id)) { onChangeIds(selectedIds.filter((id) => id !== pick.id)); return }
      setPeople((prev) => ({ ...prev, [pick.id]: pick.name }))
      if (selectedTeamId) { onChangeTeam(null); setTeam(null); if (assignmentMode === 'team') onChangeMode('single') }
      onChangeIds([...(selectedTeamId ? [] : selectedIds), pick.id])
      return
    }
    if (selectedTeamId === pick.id) { clearTeam(); return }
    setTeam(pick)
    onChangeIds([])
    onChangeTeam(pick.id)
    onChangeMode('team')
  }

  function clearTeam() {
    setTeam(null)
    onChangeTeam(null)
    onChangeIds([])
    if (assignmentMode === 'team') onChangeMode('single')
  }

  const teamPicked = Boolean(selectedTeamId)
  const effectiveMode: AssignmentMode = teamPicked
    ? (assignmentMode === 'single' ? 'team' : assignmentMode)
    : selectedIds.length <= 1 ? 'single' : assignmentMode === 'single' || assignmentMode === 'team' ? 'individual' : assignmentMode
  const selectedKeys = [...selectedIds.map((id) => assigneeKey('person', id)), ...(selectedTeamId ? [assigneeKey('team', selectedTeamId)] : [])]

  const modes: Array<{ value: AssignmentMode; title: string; hint: string }> = teamPicked
    ? [
        { value: 'team', title: 'Team task', hint: 'One task; a member claims it' },
        { value: 'individual', title: 'Individual', hint: 'A copy for each member' },
        { value: 'collaborative', title: 'Collaborative', hint: 'All members on one task' },
      ]
    : [
        { value: 'individual', title: 'Individual', hint: 'Separate copy per person' },
        { value: 'collaborative', title: 'Collaborative', hint: 'All work on same task' },
      ]

  return (
    <div className="space-y-3" data-assignee-picker="">
      <span className="block text-sm font-medium text-fg" id="assign-to-label">Assign to</span>

      {(selectedIds.length > 0 || team) && (
        <div className="flex flex-wrap gap-1.5" aria-label="Assigned" role="list">
          {selectedIds.map((id) => {
            const name = people[id] ?? 'Person'
            return (
              <span key={id} role="listitem" className="inline-flex items-center gap-1 rounded-full bg-primary-wash px-2 py-1 text-xs text-primary-text">
                <span aria-hidden className="flex size-4 items-center justify-center rounded-full bg-primary text-2xs font-bold text-primary-fg">{getInitials(name)}</span>
                {name}
                <button type="button" onClick={() => onChangeIds(selectedIds.filter((x) => x !== id))} aria-label={`Remove ${name}`} className="rounded-sm hover:bg-primary-wash"><X size={12} /></button>
              </span>
            )
          })}
          {team && selectedTeamId === team.id && (
            <span role="listitem" data-picked-team={team.id} className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-primary-wash px-2 py-1 text-xs text-primary-text">
              <Users aria-hidden size={12} />
              <span className="truncate font-medium">{team.name}</span>
              <span className="num shrink-0">({plural(team.member_count, 'member')})</span>
              <TeamOriginBadge origin={team.origin} compact />
              <button type="button" onClick={clearTeam} aria-label={`Remove team ${team.name}`} className="ml-0.5 rounded-sm"><X size={12} /></button>
            </span>
          )}
        </div>
      )}

      <AssigneeSearch onPick={onPick} selectedKeys={selectedKeys} label="Search people and teams to assign" />

      {(selectedIds.length > 1 || teamPicked) && (
        <div>
          <span className="mb-1.5 block text-xs font-medium text-fg-muted" id="assignment-mode-label">Assignment mode</span>
          <div className={cn('grid gap-2', teamPicked ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2')} role="radiogroup" aria-labelledby="assignment-mode-label">
            {modes.map((m) => (
              <button key={m.value} type="button" role="radio" aria-checked={effectiveMode === m.value} onClick={() => onChangeMode(m.value)} data-assignment-mode={m.value}
                className={cn('rounded-md border px-3 py-2 text-left text-ui transition-colors', effectiveMode === m.value ? 'border-primary bg-primary-wash text-fg' : 'border-border text-fg hover:bg-subtle')}>
                <p className="font-semibold">{m.title}</p>
                <p className="mt-0.5 text-xs text-fg-muted">{m.hint}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Hidden fields for form submission */}
      <input type="hidden" name="assignee_ids" value={JSON.stringify(selectedIds)} />
      <input type="hidden" name="assignment_mode" value={!teamPicked && selectedIds.length <= 1 ? 'single' : effectiveMode} />
      {selectedTeamId && <input type="hidden" name="assigned_team_id" value={selectedTeamId} />}
    </div>
  )
}
