'use client'

import { useId, useMemo, useState } from 'react'
import { SearchInput } from '@/components/ui/input'
import { Avatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { personName, type PersonLike } from './types'

/** Combobox over people (name, email, title, department): pick one to focus it. */
export function PersonSearch({ people, onPick, className, placeholder = 'Find a person' }: {
  people: readonly PersonLike[]
  onPick: (id: string) => void
  className?: string
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = useId()
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people.filter((p) => `${p.display_name ?? ''} ${p.email ?? ''} ${p.job_title ?? ''} ${p.department ?? ''}`.toLowerCase().includes(q)).slice(0, 8)
  }, [people, query])

  const pick = (id: string) => {
    onPick(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div className={cn('relative', className)}>
      <SearchInput
        size="sm"
        value={query}
        onValueChange={(v) => { setQuery(v); setOpen(true); setActive(0) }}
        placeholder={placeholder}
        aria-label={placeholder}
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (!matches.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(matches.length - 1, a + 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          if (e.key === 'Enter') { e.preventDefault(); pick(matches[active]?.id ?? matches[0].id) }
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {open && matches.length > 0 && (
        <ul id={listId} role="listbox" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-panel py-1 shadow-elev-2">
          {matches.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(p.id)}
                className={cn('flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-subtle', i === active && 'bg-subtle')}>
                <Avatar name={personName(p)} src={p.avatar_url ?? null} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-fg">{personName(p)}</span>
                  <span className="block truncate text-xs text-fg-muted">{[p.job_title, p.department].filter(Boolean).join(' · ') || p.email}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
