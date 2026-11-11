'use client'

import { Clock, Shield, UserPlus, UserMinus, Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TableScroll } from '@/components/ui/table'

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
        <p className="text-sm text-fg-muted">No audit log entries yet</p>
        <p className="text-xs mt-1 text-fg-muted">Changes to roles and permissions will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-fg">Role changes</h2>

      <div className="rounded-xl border overflow-hidden border-border">
        <TableScroll bare label="Role changes" stickyFirstColumn>
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="bg-subtle">
              <th className="min-w-40 whitespace-nowrap text-left px-4 py-2.5 text-xs font-semibold text-fg-muted">Action</th>
              <th className="min-w-40 text-left px-4 py-2.5 text-xs font-semibold text-fg-muted">Actor</th>
              <th className="min-w-64 text-left px-4 py-2.5 text-xs font-semibold text-fg-muted">Details</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-fg-muted">When</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry: any) => {
              const config = ACTION_CONFIG[entry.action] ?? { label: entry.action, icon: Clock, color: 'text-gray-500' }
              const Icon = config.icon
              return (
                <tr key={entry.id} className="border-t border-border bg-panel">
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', config.color)}>
                      <Icon size={12} />
                      {config.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg">
                    {entry.actor?.display_name ?? '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg-muted">
                    {entry.details?.name && <span>Role: {entry.details.name}</span>}
                    {entry.details?.permissions && (
                      <span className="ml-1">({entry.details.permissions.length} permissions)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-right whitespace-nowrap text-fg-muted">
                    {new Date(entry.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </TableScroll>
      </div>
    </div>
  )
}
