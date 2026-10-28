'use client'

import { useMemo, useState } from 'react'

interface SearchableEntityPickerProps {
  items: { id: string; name: string; subtitle?: string; archived?: boolean }[]
  selectedId: string
  placeholder: string
  emptyLabel: string
  onSelect: (id: string, name: string) => void
}

export function SearchableEntityPicker({
  items,
  selectedId,
  placeholder,
  emptyLabel,
  onSelect,
}: SearchableEntityPickerProps) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)

  const selected = items.find((item) => item.id === selectedId)
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return items.slice(0, 40)
    return items
      .filter((item) =>
        item.name.toLowerCase().includes(needle) ||
        (item.subtitle ?? '').toLowerCase().includes(needle),
      )
      .slice(0, 40)
  }, [items, search])

  if (selectedId && selected && !open) {
    return (
      <div
        className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs cursor-pointer hover:opacity-80"
        style={{ borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' }}
        onClick={() => setOpen(true)}
      >
        <span className="min-w-0 flex-1" style={{ color: 'var(--theme-primary-text)' }}>
          <span className="block truncate">{selected.name}</span>
          {selected.subtitle ? (
            <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              {selected.subtitle}
            </span>
          ) : null}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onSelect('', '')
          }}
          className="text-[9px] underline"
          style={{ color: 'var(--theme-muted-text)' }}
        >
          Clear
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <input
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="w-full rounded-md border px-3 py-2 text-xs outline-none"
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-surface-border)',
          color: 'var(--theme-card-text)',
        }}
      />
      {open ? (
        filtered.length > 0 ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-lg border shadow-lg"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
          >
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-start px-3 py-2 text-left text-xs hover:opacity-80"
                style={{ backgroundColor: item.id === selectedId ? 'var(--theme-primary-light)' : 'var(--theme-card-bg)' }}
                onClick={() => {
                  onSelect(item.id, item.name)
                  setSearch('')
                  setOpen(false)
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate" style={{ color: 'var(--theme-card-text)' }}>
                    {item.name}
                    {item.archived ? ' (archived)' : ''}
                  </span>
                  {item.subtitle ? (
                    <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {item.subtitle}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border px-3 py-2 text-xs shadow-lg"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
          >
            {emptyLabel}
          </div>
        )
      ) : null}
    </div>
  )
}
