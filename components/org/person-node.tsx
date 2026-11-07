'use client'

import { Users } from 'lucide-react'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { personName } from './types'

export interface PersonNodeData {
  id: string
  display_name: string | null
  email: string | null
  avatar_url: string | null
  job_title: string | null
  department: string | null
  direct_reports: number
  total_reports?: number
}

/** One person on the org chart: avatar, name, title, department, report count. */
export function PersonNode({ person, selected, isMe, onSelect }: { person: PersonNodeData; selected?: boolean; isMe?: boolean; onSelect: (id: string) => void }) {
  const name = personName(person)
  return (
    <button
      type="button"
      onClick={() => onSelect(person.id)}
      className={cn(
        'flex size-full items-center gap-2.5 rounded-lg border bg-panel px-3 text-left shadow-elev-1 transition-colors',
        'hover:border-border-strong',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border-subtle',
      )}
      aria-label={`${name}${person.job_title ? `, ${person.job_title}` : ''}${person.direct_reports ? `, ${person.direct_reports} direct reports` : ''}`}
      data-person-node={person.id}
    >
      <Avatar name={name} src={person.avatar_url} size="lg" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-fg">{name}</span>
          {isMe && <span className="shrink-0 rounded bg-primary-wash px-1 text-2xs font-medium text-primary-text">You</span>}
        </span>
        <span className="block truncate text-xs text-fg-muted">{person.job_title || '—'}</span>
        {person.department && <span className="block truncate text-2xs text-fg-subtle">{person.department}</span>}
      </span>
      {person.direct_reports > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 self-start pt-2 text-2xs tabular-nums text-fg-muted" title={`${person.direct_reports} direct · ${person.total_reports ?? person.direct_reports} total`}>
          <Users className="size-3" aria-hidden />{person.direct_reports}
        </span>
      )}
    </button>
  )
}
