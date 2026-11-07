'use client'

/**
 * How references are created with a new integration (connector catalogue,
 * OpenAPI import): generate all of them (the historic behaviour), start
 * empty and build custom references, or generate a searched selection.
 */

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'

export type ReferenceMode = 'all' | 'none' | 'selected'

export interface ReferenceModeOption { key: string; name: string; description?: string; method?: string; path?: string }

const muted = { color: 'var(--theme-muted-text)' }
const border = { borderColor: 'var(--theme-surface-border)' }

export function ReferenceModePicker({ options, mode, onModeChange, selected, onSelectedChange, noun = 'references' }: {
  options: ReferenceModeOption[]
  mode: ReferenceMode
  onModeChange: (mode: ReferenceMode) => void
  selected: Set<string>
  onSelectedChange: (selected: Set<string>) => void
  noun?: string
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const visible = useMemo(() => options.filter((o) => !q || `${o.name} ${o.description ?? ''} ${o.method ?? ''} ${o.path ?? ''}`.toLowerCase().includes(q)), [options, q])
  const choices: Array<{ value: ReferenceMode; title: string; hint: string }> = [
    { value: 'all', title: `Generate all ${options.length} ${noun}`, hint: 'One reference per operation, as before.' },
    { value: 'none', title: 'Start empty', hint: 'Build tidy custom references yourself: pick columns, filters, sort and inputs.' },
    { value: 'selected', title: 'Generate selected', hint: 'Pick the operations you need.' },
  ]
  const toggle = (key: string) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onSelectedChange(next)
  }
  return (
    <div className="space-y-2" data-testid="reference-mode-picker">
      <div className="grid gap-1.5" role="radiogroup" aria-label={`Create ${noun}`}>
        {choices.map((c) => (
          <label key={c.value} className="flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs" data-testid={`reference-mode-${c.value}`}
            style={{ ...border, ...(mode === c.value ? { borderColor: 'var(--theme-primary)', backgroundColor: 'var(--theme-primary-light)' } : {}) }}>
            <input type="radio" name="reference-mode" className="mt-0.5" checked={mode === c.value} onChange={() => onModeChange(c.value)} />
            <span>
              <span className="font-medium">{c.title}</span>
              <span className="block text-2xs text-fg-muted">{c.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'selected' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <label className="relative flex-1">
              <span className="sr-only">Search operations</span>
              <Search size={12} className="pointer-events-none absolute left-2 top-2 text-fg-muted" aria-hidden />
              <input className="h-7 w-full rounded border pl-7 pr-2 text-xs outline-none" style={{ ...border, backgroundColor: 'var(--theme-card-bg)' }} placeholder="Search operations…"
                value={query} onChange={(e) => setQuery(e.target.value)} data-testid="reference-mode-search" />
            </label>
            <button type="button" className="text-2xs font-medium text-primary-text" onClick={() => onSelectedChange(new Set([...selected, ...visible.map((o) => o.key)]))}>Select {q ? 'shown' : 'all'}</button>
            <button type="button" className="text-2xs font-medium text-fg-muted" onClick={() => onSelectedChange(new Set())}>Clear</button>
          </div>
          <ul className="max-h-56 space-y-1 overflow-y-auto">
            {visible.map((o) => (
              <li key={o.key}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-2 py-1 text-xs hover:bg-[var(--theme-row-highlight)]">
                  <input type="checkbox" className="mt-0.5" checked={selected.has(o.key)} onChange={() => toggle(o.key)} />
                  <span className="min-w-0">
                    {o.method && <span className="mr-1 font-mono text-2xs font-bold text-fg-muted">{o.method}</span>}
                    <span className="font-medium">{o.name}</span>
                    {o.description && <span className="block truncate text-2xs text-fg-muted">{o.description}</span>}
                  </span>
                </label>
              </li>
            ))}
            {!visible.length && <li className="px-2 text-2xs text-fg-muted">No operations match.</li>}
          </ul>
          <p className="text-2xs text-fg-muted">{selected.size} of {options.length} selected</p>
        </div>
      )}
    </div>
  )
}
