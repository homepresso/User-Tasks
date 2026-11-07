'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { SearchInput } from './input'
import { cn } from '@/lib/utils'
import { pageNumbers } from '@/lib/page-numbers'

// ─── Search Bar ───
interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

export function SearchBar({ value, onChange, placeholder, className }: SearchBarProps) {
  return <SearchInput value={value} onValueChange={onChange} placeholder={placeholder ?? 'Search…'} wrapperClassName={className} aria-label={placeholder ?? 'Search'} />
}

// ─── Filter Chips ───
interface FilterChipsProps {
  label: string
  options: { value: string; label: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
}

export function FilterChips({ label, options, selected, onChange }: FilterChipsProps) {
  function toggle(val: string) {
    onChange(selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val])
  }
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <span className="shrink-0 text-xs font-medium text-fg-muted">{label}:</span>
      {options.map(opt => (
        <button key={opt.value} type="button" onClick={() => toggle(opt.value)} aria-pressed={selected.includes(opt.value)}
          className={cn('h-6 rounded-full border px-2.5 text-xs font-medium transition-colors',
            selected.includes(opt.value) ? 'border-transparent bg-primary-wash text-primary-text' : 'border-border bg-panel text-fg-muted hover:text-fg')}>
          {opt.label}
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" onClick={() => onChange([])} className="text-xs text-fg-muted hover:text-fg hover:underline">
          Clear
        </button>
      )}
    </div>
  )
}

// ─── Pagination ───
interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange?: (size: number) => void
  /** The page size selector's options (default 10 / 25 / 50 / 100). */
  pageSizeOptions?: readonly number[]
  /**
   * Numbered page buttons (first, last and around the current one) instead
   * of "2 / 5"; the bar also stays while a smaller page size would still page.
   */
  showPageNumbers?: boolean
  /** Calls onPageChange(1) after a size change (default). Off when onPageSizeChange already resets the page. */
  pageSizeResetsPage?: boolean
  /** What the total counts: "1–24 of 130 workflows". */
  noun?: string
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100] as const

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions = DEFAULT_PAGE_SIZES, showPageNumbers = false, pageSizeResetsPage = true, noun }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  if (total <= (showPageNumbers && onPageSizeChange ? Math.min(pageSize, ...pageSizeOptions) : pageSize)) return null

  return (
    <nav aria-label="Pagination" className="flex items-center justify-between pt-3 text-xs text-fg-muted">
      <span data-testid="pagination-summary" className="num">{start}–{end} of {total}{noun ? ` ${noun}` : ''}</span>
      <div className="flex items-center gap-1">
        {onPageSizeChange && (
          <label className="mr-2 flex items-center gap-1.5">
            {showPageNumbers && <span>Per page</span>}
            <select value={pageSize} aria-label="Page size" onChange={(e) => { onPageSizeChange(Number(e.target.value)); if (pageSizeResetsPage) onPageChange(1) }}
              className="num h-7 rounded-md border border-input-border bg-input px-1.5 text-xs text-fg hover:border-border-strong">
              {pageSizeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page"
          className="inline-flex size-7 items-center justify-center rounded-md text-fg hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45">
          <ChevronLeft size={14} />
        </button>
        {showPageNumbers ? pageNumbers(page, totalPages).map((p, i) => p === null
          ? <span key={`gap-${i}`} className="px-1">…</span>
          : (
            <button key={p} onClick={() => onPageChange(p)} aria-current={p === page ? 'page' : undefined} aria-label={`Page ${p}`}
              className={cn('num h-7 min-w-7 rounded-md px-1.5 font-medium', p === page ? 'bg-muted text-fg' : 'text-fg-muted hover:bg-subtle hover:text-fg')}>
              {p}
            </button>
          ))
          : <span className="num px-2 font-medium">{page} / {totalPages}</span>}
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page"
          className="inline-flex size-7 items-center justify-center rounded-md text-fg hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-45">
          <ChevronRight size={14} />
        </button>
      </div>
    </nav>
  )
}

// ─── Helper: client-side search + filter + paginate ───
export function useListControls<T>(
  items: T[],
  searchFn: (item: T, query: string) => boolean,
  defaultPageSize = 25,
) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(defaultPageSize)

  const filtered = search ? items.filter(item => searchFn(item, search.toLowerCase())) : items
  const total = filtered.length
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize)

  // Reset to page 1 when search changes
  const setSearchAndReset = (v: string) => { setSearch(v); setPage(1) }

  return {
    search, setSearch: setSearchAndReset,
    page, setPage,
    pageSize, setPageSize,
    filtered, paginated, total,
  }
}
