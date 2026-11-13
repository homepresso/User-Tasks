'use client'

import { permissionGroupsWithExtensions } from '@/lib/permissions'
import { Checkbox } from '@/components/ui/checkbox'

interface Props {
  selected: Set<string>
  onToggle: (key: string) => void
  onToggleGroup: (keys: string[]) => void
}

export function RolePermissionsGrid({ selected, onToggle, onToggleGroup }: Props) {
  return (
    <div className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border">
      {permissionGroupsWithExtensions().map(group => {
        const groupKeys = group.permissions.map(p => p.key)
        const selectedCount = groupKeys.filter(k => selected.has(k)).length
        const allSelected = selectedCount === groupKeys.length

        return (
          <fieldset key={group.key}>
            <legend className="sr-only">{group.label}</legend>
            {/* Group header */}
            <div className="flex items-center justify-between bg-subtle px-4 py-2">
              <Checkbox
                checked={allSelected}
                onChange={() => onToggleGroup(groupKeys)}
                ref={el => { if (el) el.indeterminate = selectedCount > 0 && !allSelected }}
                label={<span className="font-semibold">{group.label}</span>}
              />
              <span className="num text-xs text-fg-muted">
                {selectedCount} of {groupKeys.length}
              </span>
            </div>

            {/* Permission rows */}
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 bg-panel px-4 py-3 sm:grid-cols-2">
              {group.permissions.map(perm => (
                <Checkbox
                  key={perm.key}
                  checked={selected.has(perm.key)}
                  onChange={() => onToggle(perm.key)}
                  label={<span className="font-medium">{perm.label}</span>}
                  description={perm.description}
                  className="flex"
                />
              ))}
            </div>
          </fieldset>
        )
      })}
    </div>
  )
}
