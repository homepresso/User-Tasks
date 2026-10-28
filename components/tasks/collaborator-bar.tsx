'use client'

import { getInitials, cn } from '@/lib/utils'
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

const statusConfig: Record<string, { icon: any; color: string }> = {
  accepted: { icon: CheckCircle, color: '#22C55E' },
  pending: { icon: Clock, color: '#F59E0B' },
  held: { icon: PauseCircle, color: '#F97316' },
  rejected: { icon: XCircle, color: '#EF4444' },
}

export function CollaboratorBar({ collaborators, compact }: CollaboratorBarProps) {
  const [expanded, setExpanded] = useState(false)

  if (!collaborators.length) return null

  return (
    <div className="relative">
      {/* Avatar stack */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center -space-x-1.5 hover:opacity-80 transition-opacity"
      >
        {collaborators.slice(0, compact ? 3 : 5).map((c) => {
          const name = c.user?.display_name || c.user?.email || ''
          const status = statusConfig[c.acceptance_status] ?? statusConfig.pending
          return (
            <div key={c.user_id} className="relative" title={`${name} (${c.acceptance_status})`}>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold border-2"
                style={{
                  backgroundColor: 'var(--theme-surface)',
                  color: 'var(--theme-card-text)',
                  borderColor: 'var(--theme-card-bg)',
                }}
              >
                {getInitials(name)}
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border"
                style={{ backgroundColor: status.color, borderColor: 'var(--theme-card-bg)' }} />
            </div>
          )
        })}
        {collaborators.length > (compact ? 3 : 5) && (
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-[9px] font-bold border-2"
            style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)', borderColor: 'var(--theme-card-bg)' }}>
            +{collaborators.length - (compact ? 3 : 5)}
          </div>
        )}
      </button>

      {/* Expanded dropdown */}
      {expanded && (
        <div
          className="absolute top-full mt-1 right-0 max-md:left-0 max-md:right-auto z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border shadow-xl p-2 space-y-1"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider px-2 py-1" style={{ color: 'var(--theme-muted-text)' }}>
            Collaborators ({collaborators.length})
          </p>
          {collaborators.map((c) => {
            const name = c.user?.display_name || c.user?.email || ''
            const status = statusConfig[c.acceptance_status] ?? statusConfig.pending
            const StatusIcon = status.icon
            return (
              <div key={c.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0"
                  style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                  {getInitials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{name}</p>
                  <p className="text-[9px] capitalize" style={{ color: status.color }}>
                    {c.role === 'lead' && '★ '}
                    {c.acceptance_status}
                  </p>
                </div>
                <StatusIcon size={12} style={{ color: status.color }} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
