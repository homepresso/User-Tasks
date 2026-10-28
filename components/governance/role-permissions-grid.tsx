'use client'

import { PERMISSION_GROUPS } from '@/lib/permissions'
import { cn } from '@/lib/utils'

interface Props {
  selected: Set<string>
  onToggle: (key: string) => void
  onToggleGroup: (keys: string[]) => void
}

export function RolePermissionsGrid({ selected, onToggle, onToggleGroup }: Props) {
  return (
    <div className="rounded-lg border divide-y max-h-[400px] overflow-y-auto" style={{ borderColor: 'var(--theme-surface-border)' }}>
      {PERMISSION_GROUPS.map(group => {
        const groupKeys = group.permissions.map(p => p.key)
        const selectedCount = groupKeys.filter(k => selected.has(k)).length
        const allSelected = selectedCount === groupKeys.length

        return (
          <div key={group.key}>
            {/* Group header */}
            <div
              className="flex items-center justify-between px-4 py-2.5 cursor-pointer hover:bg-gray-50/50"
              style={{ backgroundColor: 'var(--theme-surface)' }}
              onClick={() => onToggleGroup(groupKeys)}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() => onToggleGroup(groupKeys)}
                  className="rounded"
                  ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected }}
                />
                <span className="text-xs font-semibold" style={{ color: 'var(--theme-card-text)' }}>{group.label}</span>
              </div>
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                {selectedCount}/{groupKeys.length}
              </span>
            </div>

            {/* Permission rows */}
            <div className="px-4 py-1.5 grid grid-cols-1 sm:grid-cols-2 gap-0.5" style={{ backgroundColor: 'var(--theme-card-bg)' }}>
              {group.permissions.map(perm => (
                <label
                  key={perm.key}
                  className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(perm.key)}
                    onChange={() => onToggle(perm.key)}
                    className="rounded"
                  />
                  <div className="min-w-0">
                    <span className="text-xs font-medium block" style={{ color: 'var(--theme-card-text)' }}>{perm.label}</span>
                    <span className="text-[10px] block truncate" style={{ color: 'var(--theme-muted-text)' }}>{perm.description}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
