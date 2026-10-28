'use client'

import { Clock, Shield, UserPlus, UserMinus, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const ACTION_CONFIG: Record<string, { label: string; icon: typeof Clock; color: string }> = {
  role_created: { label: 'Role Created', icon: Shield, color: 'text-green-600' },
  role_updated: { label: 'Role Updated', icon: Pencil, color: 'text-blue-600' },
  role_deleted: { label: 'Role Deleted', icon: Trash2, color: 'text-red-600' },
  user_role_assigned: { label: 'Role Assigned', icon: UserPlus, color: 'text-[color:var(--theme-card-text)]' },
  user_role_removed: { label: 'Role Removed', icon: UserMinus, color: 'text-amber-600' },
}

interface Props {
  entries: any[]
}

export function AuditLogTable({ entries }: Props) {
  if (entries.length === 0) {
    return (
      <div className="text-center py-16">
        <Clock size={32} className="mx-auto mb-3 opacity-20" />
        <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>No audit log entries yet</p>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>Changes to roles and permissions will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>Audit Log</h2>

      <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--theme-surface)' }}>
              <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Action</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Actor</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>Details</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry: any) => {
              const config = ACTION_CONFIG[entry.action] ?? { label: entry.action, icon: Clock, color: 'text-gray-500' }
              const Icon = config.icon
              return (
                <tr key={entry.id} className="border-t" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
                  <td className="px-4 py-2.5">
                    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', config.color)}>
                      <Icon size={12} />
                      {config.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--theme-card-text)' }}>
                    {entry.actor?.display_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                    {entry.details?.name && <span>Role: {entry.details.name}</span>}
                    {entry.details?.permissions && (
                      <span className="ml-1">({entry.details.permissions.length} permissions)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right whitespace-nowrap" style={{ color: 'var(--theme-muted-text)' }}>
                    {new Date(entry.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}
