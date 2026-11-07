'use client'

import { useState, useRef, useEffect } from 'react'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import { SearchInput } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { floatingSurfaceClass, menuItemClass } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface UserPickerProps {
  onSelect: (userId: string) => void
  excludeIds?: string[]
  placeholder?: string
}

export function UserPicker({ onSelect, excludeIds = [], placeholder = 'Search users…' }: UserPickerProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { data: users } = useTenantUsers()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const filtered = users?.filter(u =>
    !excludeIds.includes(u.id) &&
    (u.display_name.toLowerCase().includes(search.toLowerCase()) ||
     u.email.toLowerCase().includes(search.toLowerCase()))
  ) ?? []

  return (
    <div ref={ref} className="relative">
      <SearchInput
        value={search}
        onValueChange={(v) => { setSearch(v); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        aria-label={placeholder.replace(/…$/, '')}
      />
      {open && filtered.length > 0 && (
        <div className={cn(floatingSurfaceClass, 'absolute z-10 mt-1 max-h-48 w-full overflow-y-auto p-1')} role="listbox">
          {filtered.map(user => (
            <button
              key={user.id}
              type="button"
              role="option"
              aria-selected={false}
              className={cn(menuItemClass, 'w-full cursor-pointer text-left hover:bg-subtle')}
              onClick={() => { onSelect(user.id); setSearch(''); setOpen(false) }}
            >
              <Avatar name={user.display_name} size="sm" />
              <span className="truncate font-medium">{user.display_name}</span>
              <span className="truncate text-xs text-fg-muted">{user.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
