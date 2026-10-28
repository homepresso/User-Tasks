'use client'

import { useState, useRef, useEffect } from 'react'
import { useTenantUsers } from '@/hooks/use-tenant-users'
import { Input } from '@/components/ui/input'
import { getInitials } from '@/lib/utils'

interface UserPickerProps {
  onSelect: (userId: string) => void
  excludeIds?: string[]
  placeholder?: string
}

export function UserPicker({ onSelect, excludeIds = [], placeholder = 'Search users...' }: UserPickerProps) {
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
      <Input
        value={search}
        onChange={(e) => { setSearch(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800 max-h-48 overflow-y-auto">
          {filtered.map(user => (
            <button
              key={user.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => { onSelect(user.id); setSearch(''); setOpen(false) }}
            >
              <span className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-[10px] font-bold">
                {getInitials(user.display_name)}
              </span>
              <span className="font-medium text-gray-900 dark:text-white">{user.display_name}</span>
              <span className="text-gray-400 text-xs">{user.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
