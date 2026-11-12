'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { FloatingLayer } from './floating-layer'

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
  id,
  labelledBy,
  describedBy,
  invalid,
  buttonRef,
  onKeyDown,
  dataAttrs,
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
  /** Id of the trigger button (a form label's htmlFor). */
  id?: string
  /** Id of the visible label: the trigger is named "<label> <value>". */
  labelledBy?: string
  describedBy?: string
  invalid?: boolean
  /** The trigger button (focus management, e.g. a grid's cells). */
  buttonRef?: (el: HTMLButtonElement | null) => void
  /** Keys on the closed trigger (e.g. Enter to move to the next cell). */
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void
  /** data-* attributes for the trigger. */
  dataAttrs?: Record<`data-${string}`, string | undefined>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) =>
      o.label.toLowerCase().includes(q) || (o.hint ?? '').toLowerCase().includes(q),
    )
  }, [options, query])


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
        ref={buttonRef}
        type="button"
        id={id}
        {...dataAttrs}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={labelledBy && id ? `${labelledBy} ${id}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
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
              size={12} className="text-fg-muted"
              onClick={(event) => {
                event.stopPropagation()
                onChange('')
              }}
            />
          ) : null}
          <ChevronDown size={13} className="text-fg-muted" />
        </span>
      </button>

      <FloatingLayer
        anchorRef={rootRef}
        open={open}
        onDismiss={() => { setOpen(false); setQuery('') }}
        closeOnEscape
        minWidth={200}
        maxHeight={300}
        className="flex flex-col overflow-hidden rounded-lg border shadow-lg bg-panel border-border"
      >
          <div data-input-shell="" className="flex items-center gap-1.5 border-b px-2 py-1.5 border-border">
            <Search size={12} className="text-fg-muted" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={filtered[highlight] ? `${listId}-${highlight}` : undefined}
              aria-label="Filter options"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, filtered.length - 1)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
                else if (e.key === 'Enter') { e.preventDefault(); const o = filtered[highlight]; if (o) pick(o) }
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery('') }
              }}
              placeholder="Type to filter…"
              className="w-full bg-transparent text-xs outline-none text-fg"
            />
          </div>
          <div ref={listRef} id={listId} role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-fg-muted">{emptyLabel}</p>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  id={`${listId}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
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
                      <span className="block truncate text-2xs text-fg-muted">{option.hint}</span>
                    ) : null}
                  </span>
                  {option.value === value ? <Check size={12} className="shrink-0 text-primary-text" /> : null}
                </button>
              ))
            )}
          </div>
      </FloatingLayer>
    </div>
  )
}
