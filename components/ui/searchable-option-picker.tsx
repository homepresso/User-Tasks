'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import { Command } from 'cmdk'

const RECENT_OPTION_LIMIT = 6

export type SearchableOption = {
  value: string
  label: string
  subtitle?: string
  keywords?: string[]
  group?: string
  badges?: string[]
}

interface SearchableOptionPickerProps {
  options: SearchableOption[]
  value: string
  placeholder: string
  searchPlaceholder?: string
  emptyLabel?: string
  onChange: (value: string) => void
  disabled?: boolean
  recentStorageKey?: string
}

type SearchableOptionSection = {
  key: string
  label: string
  options: SearchableOption[]
}

function renderHighlightedText(text: string, query: string): ReactNode {
  if (!query) return text
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return text

  const content = text ?? ''
  const lowered = content.toLowerCase()
  const parts: ReactNode[] = []
  let startIndex = 0
  let matchIndex = lowered.indexOf(normalizedQuery)

  while (matchIndex !== -1) {
    if (matchIndex > startIndex) {
      parts.push(content.slice(startIndex, matchIndex))
    }

    const endIndex = matchIndex + normalizedQuery.length
    parts.push(
      <mark
        key={`${matchIndex}-${endIndex}`}
        className="rounded px-0.5"
        style={{
          backgroundColor: 'color-mix(in srgb, var(--theme-primary-light) 78%, white 22%)',
          color: 'var(--theme-card-text)',
        }}
      >
        {content.slice(matchIndex, endIndex)}
      </mark>,
    )
    startIndex = endIndex
    matchIndex = lowered.indexOf(normalizedQuery, startIndex)
  }

  if (startIndex < content.length) {
    parts.push(content.slice(startIndex))
  }

  return parts
}

export function SearchableOptionPicker({
  options,
  value,
  placeholder,
  searchPlaceholder = 'Search...',
  emptyLabel = 'No options found.',
  onChange,
  disabled = false,
  recentStorageKey,
}: SearchableOptionPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [recentValues, setRecentValues] = useState<string[]>([])

  const selected = useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  )

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return options.slice(0, 100)
    return options
      .filter((option) => {
        const haystack = [
          option.label,
          option.value,
          option.subtitle,
          ...(option.keywords ?? []),
        ]
        return haystack.some((entry) => String(entry ?? '').toLowerCase().includes(needle))
      })
      .slice(0, 100)
  }, [options, search])

  const recentOptions = useMemo(() => {
    if (!recentStorageKey || recentValues.length === 0) return []
    const optionsByValue = new Map(options.map((option) => [option.value, option]))
    return recentValues
      .map((recentValue) => optionsByValue.get(recentValue))
      .filter((option): option is SearchableOption => Boolean(option))
      .filter((option) => filtered.some((candidate) => candidate.value === option.value))
      .slice(0, RECENT_OPTION_LIMIT)
  }, [filtered, options, recentStorageKey, recentValues])

  const sections = useMemo<SearchableOptionSection[]>(() => {
    const nextSections: SearchableOptionSection[] = []
    const renderedValues = new Set<string>()

    if (recentOptions.length > 0) {
      nextSections.push({
        key: 'recent',
        label: 'Recently used',
        options: recentOptions,
      })
      for (const option of recentOptions) {
        renderedValues.add(option.value)
      }
    }

    const grouped = new Map<string, SearchableOption[]>()
    for (const option of filtered) {
      if (renderedValues.has(option.value)) continue
      const group = option.group?.trim() || 'Options'
      const bucket = grouped.get(group)
      if (bucket) {
        bucket.push(option)
      } else {
        grouped.set(group, [option])
      }
    }

    for (const [groupLabel, groupedOptions] of grouped.entries()) {
      nextSections.push({
        key: groupLabel,
        label: groupLabel,
        options: groupedOptions,
      })
    }

    return nextSections
  }, [filtered, recentOptions])

  useEffect(() => {
    if (!recentStorageKey) {
      setRecentValues([])
      return
    }

    try {
      const raw = window.localStorage.getItem(recentStorageKey)
      if (!raw) {
        setRecentValues([])
        return
      }
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        setRecentValues([])
        return
      }
      setRecentValues(parsed.filter((entry): entry is string => typeof entry === 'string'))
    } catch {
      setRecentValues([])
    }
  }, [recentStorageKey])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [open])

  const persistRecentValue = (nextValue: string) => {
    if (!recentStorageKey) return
    try {
      const deduped = [
        nextValue,
        ...recentValues.filter((recentValue) => recentValue !== nextValue),
      ].slice(0, RECENT_OPTION_LIMIT)
      setRecentValues(deduped)
      window.localStorage.setItem(recentStorageKey, JSON.stringify(deduped))
    } catch {
      // Ignore localStorage failures; the picker should still work normally.
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs"
        style={{
          borderColor: 'var(--theme-surface-border)',
          backgroundColor: 'var(--theme-card-bg)',
          color: 'var(--theme-card-text)',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label || placeholder}
        </span>
        <ChevronDown size={13} style={{ color: 'var(--theme-muted-text)' }} />
      </button>

      {open && !disabled ? (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border shadow-lg"
          style={{
            backgroundColor: 'var(--theme-card-bg)',
            borderColor: 'var(--theme-surface-border)',
          }}
        >
          <Command shouldFilter={false} loop>
            <div className="flex items-center gap-2 border-b px-2 py-2" style={{ borderColor: 'var(--theme-surface-border)' }}>
              <Search size={12} style={{ color: 'var(--theme-muted-text)' }} />
              <Command.Input
                value={search}
                onValueChange={setSearch}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-xs outline-none"
              />
            </div>
            <Command.List className="max-h-64 overflow-y-auto p-1">
              {sections.length === 0 ? (
                <div className="px-2 py-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  {emptyLabel}
                </div>
              ) : (
                sections.map((section) => (
                  <div key={section.key} className="pb-1">
                    <div
                      className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]"
                      style={{ color: 'var(--theme-muted-text)' }}
                    >
                      {section.label}
                    </div>
                    {section.options.map((option) => (
                      <Command.Item
                        key={option.value || '__empty__'}
                        value={`${option.label} ${option.value} ${(option.keywords ?? []).join(' ')}`}
                        onSelect={() => {
                          onChange(option.value)
                          persistRecentValue(option.value)
                          setSearch('')
                          setOpen(false)
                        }}
                        className="flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-left text-xs outline-none data-[selected=true]:bg-[var(--theme-primary-light)]"
                      >
                        <span className="mt-0.5 shrink-0">
                          {option.value === value ? (
                            <Check size={12} style={{ color: 'var(--theme-primary-text)' }} />
                          ) : (
                            <span className="block h-3 w-3" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate" style={{ color: 'var(--theme-card-text)' }}>
                            {renderHighlightedText(option.label, search)}
                          </span>
                          {option.badges && option.badges.length > 0 ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {option.badges.map((badge) => (
                                <span
                                  key={badge}
                                  className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-medium"
                                  style={{
                                    backgroundColor: 'var(--theme-surface)',
                                    color: 'var(--theme-muted-text)',
                                  }}
                                >
                                  {renderHighlightedText(badge, search)}
                                </span>
                              ))}
                            </span>
                          ) : null}
                          {option.subtitle ? (
                            <span className="mt-1 block truncate text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                              {renderHighlightedText(option.subtitle, search)}
                            </span>
                          ) : null}
                        </span>
                      </Command.Item>
                    ))}
                  </div>
                ))
              )}
            </Command.List>
          </Command>
        </div>
      ) : null}
    </div>
  )
}
