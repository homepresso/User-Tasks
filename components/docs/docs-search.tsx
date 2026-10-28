'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import type { SearchEntry } from '@/lib/docs/render'

function score(entry: SearchEntry, terms: string[]): number {
  const title = entry.t.toLowerCase()
  const rest = `${entry.s} ${entry.d ?? ''}`.toLowerCase()
  let total = 0
  for (const term of terms) {
    if (title === term) total += 12
    else if (title.startsWith(term)) total += 8
    else if (title.includes(term)) total += 5
    else if (rest.includes(term)) total += 1
    else return 0
  }
  // Pages rank above their headings for the same match.
  return total + (entry.h.includes('#') ? 0 : 1)
}

/**
 * Client-side search over page titles, descriptions and headings. The index
 * (/docs/search-index.json, statically generated) is fetched on first open.
 */
export function DocsSearch() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<SearchEntry[] | null>(null)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'k' && (event.metaKey || event.ctrlKey)) || (event.key === '/' && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement))) {
        event.preventDefault()
        setOpen(true)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    if (index) return
    fetch('/docs/search-index.json').then((response) => response.json()).then(setIndex).catch(() => setIndex([]))
  }, [open, index])

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!index || terms.length === 0) return []
    return index
      .map((entry) => ({ entry, score: score(entry, terms) }))
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((result) => result.entry)
  }, [index, query])

  const go = (entry: SearchEntry) => {
    setOpen(false)
    setQuery('')
    router.push(entry.h)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-[#1B1916]/[0.12] bg-[#FFFFFF]/70 px-3 py-1.5 text-sm text-[#6E6759] transition hover:border-[#1B1916]/25 sm:w-56"
        aria-label="Search documentation"
      >
        <Search size={15} aria-hidden="true" />
        <span className="hidden flex-1 text-left sm:inline">Search docs</span>
        <kbd className="hidden rounded border border-[#1B1916]/15 px-1.5 font-mono text-[10px] sm:inline">⌘K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search documentation">
          <button type="button" aria-label="Close search" className="absolute inset-0 bg-[#1B1916]/40" onClick={() => setOpen(false)} />
          <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[#1B1916]/10 bg-[#FAF8F3] shadow-2xl">
            <div className="flex items-center gap-3 border-b border-[#1B1916]/[0.08] px-4">
              <Search size={18} className="text-[#8A6D45]" aria-hidden="true" />
              <input
                ref={inputRef}
                value={query}
                onChange={(event) => { setQuery(event.target.value); setActive(0) }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => Math.min(value + 1, results.length - 1)) }
                  if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => Math.max(value - 1, 0)) }
                  if (event.key === 'Enter' && results[active]) go(results[active])
                }}
                placeholder="Search nodes, commands, functions, settings…"
                className="h-12 flex-1 bg-transparent text-[15px] text-[#1B1916] outline-none"
                aria-label="Search"
              />
              <button type="button" onClick={() => setOpen(false)} aria-label="Close search" className="text-[#6E6759]"><X size={16} /></button>
            </div>
            <ul className="max-h-[50vh] overflow-y-auto p-2" role="listbox">
              {query && results.length === 0 && <li className="px-3 py-6 text-center text-sm text-[#6E6759]">{index ? 'No results' : 'Loading…'}</li>}
              {results.map((entry, position) => (
                <li key={entry.h} role="option" aria-selected={position === active}>
                  <button
                    type="button"
                    onMouseEnter={() => setActive(position)}
                    onClick={() => go(entry)}
                    className={`w-full rounded-lg px-3 py-2 text-left ${position === active ? 'bg-[#17150F]/[0.07]' : ''}`}
                  >
                    <span className="block text-sm font-medium text-[#1B1916]">{entry.t}</span>
                    <span className="block text-xs text-[#6E6759]">{entry.s}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  )
}
