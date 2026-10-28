'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface AutocompleteOption {
  value: string
  label: string
  /** Secondary line shown under the label (e.g. description, status). */
  hint?: string
  disabled?: boolean
}

/**
 * AutocompleteSelect — the platform-standard replacement for native
 * <select> dropdowns: type-to-filter, keyboard navigation, clearable,
 * theme-variable styling. Options are filtered client-side; for
 * server-searched entity pickers keep using SearchableEntityPicker.
 */
export function AutocompleteSelect({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  emptyLabel = 'No matches',
  clearable = false,
  disabled = false,
  className,
  size = 'sm',
}: {
  value: string | null | undefined
  onChange: (value: string) => void
  options: AutocompleteOption[]
  placeholder?: string
  emptyLabel?: string
  clearable?: boolean
  disabled?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, query])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open) {
      setHighlight(Math.max(0, filtered.findIndex((o) => o.value === value)))
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setHighlight(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.children[highlight] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function pick(option: AutocompleteOption) {
    if (option.disabled) return
    onChange(option.value)
    setOpen(false)
    setQuery('')
  }

  const heightClass = size === 'md' ? 'h-10 text-sm' : 'h-8 text-xs'

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex w-full items-center justify-between gap-2 rounded-md border px-2.5 text-left disabled:opacity-50',
          heightClass,
        )}
        style={{
          backgroundColor: 'var(--theme-card-bg)',
          borderColor: 'var(--theme-surface-border)',
          color: selected ? 'var(--theme-card-text)' : 'var(--theme-muted-text)',
        }}
      >
        <span className="min-w-0 truncate">{selected?.label ?? placeholder}</span>
        <span className="flex shrink-0 items-center gap-1">
          {clearable && selected ? (
            <X
              size={12}
              style={{ color: 'var(--theme-muted-text)' }}
              onClick={(event) => {
                event.stopPropagation()
                onChange('')
              }}
            />
          ) : null}
          <ChevronDown size={13} style={{ color: 'var(--theme-muted-text)' }} />
        </span>
      </button>

      {open && (
        <div
          className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border shadow-lg"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          <div className="flex items-center gap-1.5 border-b px-2 py-1.5" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <Search size={12} style={{ color: 'var(--theme-muted-text)' }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlight]; if (o) pick(o) }
                else if (e.key === 'Escape') { setOpen(false); setQuery('') }
              }}
              placeholder="Type to filter…"
              className="w-full bg-transparent text-xs outline-none"
              style={{ color: 'var(--theme-card-text)' }}
            />
          </div>
          <div ref={listRef} className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs" style={{ color: 'var(--theme-muted-text)' }}>{emptyLabel}</p>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={option.disabled}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => pick(option)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs disabled:opacity-40"
                  style={{
                    backgroundColor: index === highlight ? 'var(--theme-primary-light)' : 'transparent',
                    color: 'var(--theme-card-text)',
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{option.hint}</span>
                    ) : null}
                  </span>
                  {option.value === value ? <Check size={12} className="shrink-0" style={{ color: 'var(--theme-primary-text)' }} /> : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
