'use client'

/**
 * The ⌘K command palette, loaded on first use (components/docs/docs-nav.tsx).
 * Fuzzy search (lib/docs/search.ts) over /docs/search-index.json, which is
 * statically generated and fetched once per session. Recent picks live in
 * localStorage (best effort: private windows and blocked storage just skip
 * them). ARIA combobox pattern: the input keeps focus and points at the
 * active option with aria-activedescendant.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, Clock, CornerDownLeft, FileText, Hash, Search, Sparkles, X } from 'lucide-react'
import type { SearchEntry } from '@/lib/docs/render'
import { highlightParts, searchDocs, type SearchResult } from '@/lib/docs/search'
import type { SearchSuggestion } from './docs-nav'

const RECENT_KEY = 'docs-recent-searches'
const RECENT_MAX = 6

let indexPromise: Promise<SearchEntry[]> | null = null
function loadIndex(): Promise<SearchEntry[]> {
  indexPromise ??= fetch('/docs/search-index.json')
    .then((response) => (response.ok ? response.json() : []))
    .catch(() => { indexPromise = null; return [] })
  return indexPromise
}

function readRecent(): SearchEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is SearchEntry => typeof entry?.t === 'string' && typeof entry?.h === 'string' && entry.h.startsWith('/docs')).slice(0, RECENT_MAX)
      : []
  } catch {
    return []
  }
}

function saveRecent(entry: SearchEntry) {
  try {
    const next = [{ t: entry.t, h: entry.h, s: entry.s }, ...readRecent().filter((item) => item.h !== entry.h)].slice(0, RECENT_MAX)
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch { /* storage unavailable */ }
}

function clearRecent() {
  try { localStorage.removeItem(RECENT_KEY) } catch { /* storage unavailable */ }
}

interface Row {
  key: string
  entry: SearchEntry
  ranges: SearchResult['ranges']
  group: string
}

export default function SearchPalette({ onClose, suggestions }: { onClose: () => void; suggestions: SearchSuggestion[] }) {
  const router = useRouter()
  const baseId = useId()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState<SearchEntry[] | null>(null)
  const [recent, setRecent] = useState<SearchEntry[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    setRecent(readRecent())
    let live = true
    void loadIndex().then((entries) => { if (live) setIndex(entries) })
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { live = false; document.body.style.overflow = previousOverflow }
  }, [])

  const rows: Row[] = useMemo(() => {
    if (query.trim()) {
      return searchDocs(index ?? [], query, 24).map((result) => ({
        key: result.entry.h,
        entry: result.entry,
        ranges: result.ranges,
        group: result.entry.h.includes('#') ? 'Sections' : 'Pages',
      })).sort((a, b) => (a.group === b.group ? 0 : a.group === 'Pages' ? -1 : 1))
    }
    const recentRows = recent.map((entry) => ({ key: `recent:${entry.h}`, entry, ranges: [], group: 'Recent' }))
    const suggested = suggestions
      .filter((item) => !recent.some((entry) => entry.h === item.href))
      .map((item) => ({ key: `suggested:${item.href}`, entry: { t: item.title, h: item.href, s: item.section }, ranges: [], group: 'Start here' }))
    return [...recentRows, ...suggested]
  }, [query, index, recent, suggestions])

  useEffect(() => { setActive(0) }, [query])

  // Keep the active option visible.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const go = (entry: SearchEntry, newTab = false) => {
    saveRecent(entry)
    if (newTab) { window.open(entry.h, '_blank', 'noopener'); return }
    onClose()
    router.push(entry.h)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive((value) => (rows.length ? (value + 1) % rows.length : 0)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((value) => (rows.length ? (value - 1 + rows.length) % rows.length : 0)) }
    else if (event.key === 'PageDown') { event.preventDefault(); setActive((value) => Math.min(rows.length - 1, value + 5)) }
    else if (event.key === 'PageUp') { event.preventDefault(); setActive((value) => Math.max(0, value - 5)) }
    else if (event.key === 'Enter') {
      const row = rows[active]
      if (row) { event.preventDefault(); go(row.entry, event.metaKey || event.ctrlKey) }
    } else if (event.key === 'Escape') { event.preventDefault(); onClose() }
    else if (event.key === 'Tab') { event.preventDefault() }
  }

  const listId = `${baseId}-list`
  const optionId = (position: number) => `${baseId}-opt-${position}`
  const searching = Boolean(query.trim())
  const loading = searching && index === null

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search documentation"
      onKeyDown={(event) => {
        // Focus lives in the input; Tab from anything else returns there, Escape closes.
        if (event.target === inputRef.current) return
        if (event.key === 'Tab') { event.preventDefault(); inputRef.current?.focus() }
        else if (event.key === 'Escape') { event.preventDefault(); onClose() }
      }}
    >
      <button type="button" tabIndex={-1} aria-label="Close search" className="docs-fade absolute inset-0 bg-[rgba(16,14,11,0.55)] backdrop-blur-[3px]" onClick={onClose} />
      <div className="docs-pop relative flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-paper) shadow-[0_30px_80px_-20px_rgba(16,14,11,0.55)]">
        <div className="flex items-center gap-3 border-b border-(color:--mkt-ink)/[0.08] px-4">
          <Search size={18} className="shrink-0 text-(color:--mkt-bronze)" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded={rows.length > 0}
            aria-controls={listId}
            aria-activedescendant={rows[active] ? optionId(active) : undefined}
            aria-autocomplete="list"
            aria-label="Search documentation"
            placeholder="Search guides, nodes, commands, settings…"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-14 min-w-0 flex-1 border-0 bg-transparent text-base focus-visible:shadow-none text-(color:--mkt-ink) outline-none placeholder:text-(color:--mkt-subtle)"
          />
          {query && (
            <button type="button" onClick={() => { setQuery(''); inputRef.current?.focus() }} className="rounded-md px-1.5 py-1 text-2xs font-medium text-(color:--mkt-muted) hover:bg-(color:--mkt-ink)/[0.05]">Clear</button>
          )}
          <button type="button" onClick={onClose} aria-label="Close search" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-(color:--mkt-muted) hover:bg-(color:--mkt-ink)/[0.05] sm:hidden">
            <X size={16} aria-hidden="true" />
          </button>
          <kbd className="hidden rounded-md border border-(color:--mkt-ink)/[0.12] px-1.5 py-0.5 font-sans text-2xs text-(color:--mkt-muted) sm:inline">Esc</kbd>
        </div>

        <div ref={listRef} id={listId} role="listbox" aria-label="Results" className="docs-scroll min-h-0 flex-1 overflow-y-auto p-2">
          {loading && <p className="px-3 py-10 text-center text-ui text-(color:--mkt-muted)">Loading the index…</p>}
          {searching && !loading && rows.length === 0 && (
            <div className="px-3 py-10 text-center">
              <p className="text-sm font-medium text-(color:--mkt-ink)">No results for “{query.trim()}”</p>
              <p className="mt-1 text-ui text-(color:--mkt-muted)">Try a node name, a CLI command, a setting or fewer words.</p>
            </div>
          )}
          {rows.map((row, position) => {
            const first = position === 0 || rows[position - 1].group !== row.group
            const isHeading = row.entry.h.includes('#')
            const Icon = row.group === 'Recent' ? Clock : row.group === 'Start here' ? Sparkles : isHeading ? Hash : FileText
            const selected = position === active
            return (
              <div key={row.key} role="presentation">
                {first && (
                  <div role="presentation" className="flex items-center justify-between px-3 pb-1 pt-3 text-2xs font-semibold uppercase tracking-[0.14em] text-(color:--mkt-bronze)">
                    <span>{row.group}</span>
                    {row.group === 'Recent' && (
                      <button type="button" tabIndex={-1} onClick={() => { clearRecent(); setRecent([]); inputRef.current?.focus() }} className="normal-case tracking-normal text-(color:--mkt-muted) hover:text-(color:--mkt-ink)">Clear</button>
                    )}
                  </div>
                )}
                <a
                  id={optionId(position)}
                  role="option"
                  aria-selected={selected}
                  data-index={position}
                  href={row.entry.h}
                  tabIndex={-1}
                  onMouseMove={() => { if (!selected) setActive(position) }}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) { saveRecent(row.entry); return }
                    event.preventDefault()
                    go(row.entry)
                  }}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${selected ? 'bg-(color:--mkt-bronze)/[0.12]' : ''}`}
                >
                  <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${selected ? 'border-(color:--mkt-bronze)/40 text-(color:--mkt-bronze)' : 'border-(color:--mkt-ink)/[0.08] text-(color:--mkt-muted)'} bg-(color:--mkt-white)`}>
                    <Icon size={15} aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-(color:--mkt-ink)">
                      {highlightParts(row.entry.t, row.ranges).map((part, partIndex) => (part.match ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>))}
                    </span>
                    <span className="block truncate text-xs text-(color:--mkt-muted)">
                      {isHeading ? `In ${row.entry.s}` : (row.entry.d ?? row.entry.s)}
                    </span>
                  </span>
                  {!isHeading && row.entry.s && (
                    <span className="hidden shrink-0 rounded-full border border-(color:--mkt-ink)/[0.1] px-2 py-0.5 text-2xs font-medium text-(color:--mkt-muted-strong) sm:inline">{row.entry.s}</span>
                  )}
                  <CornerDownLeft size={14} aria-hidden="true" className={`shrink-0 text-(color:--mkt-bronze) ${selected ? 'opacity-100' : 'opacity-0'}`} />
                </a>
              </div>
            )
          })}
        </div>

        <div className="hidden items-center gap-4 border-t border-(color:--mkt-ink)/[0.08] px-4 py-2 text-2xs text-(color:--mkt-muted) sm:flex">
          <span className="inline-flex items-center gap-1"><Kbd><ArrowUp size={10} aria-hidden="true" /></Kbd><Kbd><ArrowDown size={10} aria-hidden="true" /></Kbd> to move</span>
          <span className="inline-flex items-center gap-1"><Kbd><CornerDownLeft size={10} aria-hidden="true" /></Kbd> to open</span>
          <span className="inline-flex items-center gap-1"><Kbd>⌘</Kbd><Kbd><CornerDownLeft size={10} aria-hidden="true" /></Kbd> new tab</span>
          <span className="ml-auto" aria-live="polite">{searching && !loading ? `${rows.length} result${rows.length === 1 ? '' : 's'}` : ''}</span>
        </div>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded border border-(color:--mkt-ink)/[0.14] bg-(color:--mkt-white) px-1 font-sans">{children}</kbd>
}
