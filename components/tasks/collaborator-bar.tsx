'use client'

import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/avatar'
import { CheckCircle, Clock, PauseCircle, XCircle } from 'lucide-react'
import { useState } from 'react'

interface Collaborator {
  id: string
  user_id: string
  role: string
  acceptance_status: string
  user: { id: string; display_name: string; avatar_url: string | null; email: string }
}

interface CollaboratorBarProps {
  collaborators: Collaborator[]
  compact?: boolean
}

/** Acceptance → icon and semantic tone (text / dot classes). */
const statusConfig: Record<string, { icon: typeof CheckCircle; text: string; dot: string }> = {
  accepted: { icon: CheckCircle, text: 'text-success', dot: 'bg-success' },
  pending: { icon: Clock, text: 'text-warning', dot: 'bg-warning' },
  held: { icon: PauseCircle, text: 'text-warning', dot: 'bg-warning' },
  rejected: { icon: XCircle, text: 'text-danger', dot: 'bg-danger' },
}

export function CollaboratorBar({ collaborators, compact }: CollaboratorBarProps) {
  const [expanded, setExpanded] = useState(false)

  if (!collaborators.length) return null
  const shown = compact ? 3 : 5

  return (
    <div className="relative">
      {/* Avatar stack */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={`${collaborators.length} collaborators: ${collaborators.map((c) => `${c.user?.display_name || c.user?.email || ''} (${c.acceptance_status})`).join(', ')}`}
        className="flex items-center -space-x-1.5 transition-opacity hover:opacity-80"
      >
        {collaborators.slice(0, shown).map((c) => {
          const name = c.user?.display_name || c.user?.email || ''
          const status = statusConfig[c.acceptance_status] ?? statusConfig.pending
          return (
            <span key={c.user_id} className="relative">
              <Avatar name={name} src={c.user?.avatar_url ?? undefined} size="md" ring />
              <span aria-hidden className={cn('absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-panel', status.dot)} />
            </span>
          )
        })}
        {collaborators.length > shown && (
          <span className="num flex size-7 items-center justify-center rounded-full bg-muted text-2xs font-medium text-fg-muted ring-2 ring-panel">
            +{collaborators.length - shown}
          </span>
        )}
      </button>

      {/* Expanded list */}
      {expanded && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 max-w-[calc(100vw-2rem)] space-y-0.5 rounded-lg bg-elevated p-1.5 shadow-elev-2 max-md:left-0 max-md:right-auto">
          <p className="px-2 py-1 text-xs font-medium text-fg-muted">
            Collaborators <span className="num">({collaborators.length})</span>
          </p>
          {collaborators.map((c) => {
            const name = c.user?.display_name || c.user?.email || ''
            const status = statusConfig[c.acceptance_status] ?? statusConfig.pending
            const StatusIcon = status.icon
            return (
              <div key={c.user_id} className="flex items-center gap-2 rounded-md px-2 py-1.5">
                <Avatar name={name} src={c.user?.avatar_url ?? undefined} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ui font-medium text-fg">{name}</p>
                  <p className={cn('text-xs', status.text)}>
                    {c.role === 'lead' && '★ '}
                    {c.acceptance_status.charAt(0).toUpperCase() + c.acceptance_status.slice(1)}
                  </p>
                </div>
                <StatusIcon className={cn('size-3.5 shrink-0', status.text)} aria-hidden />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
