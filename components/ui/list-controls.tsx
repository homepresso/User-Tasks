'use client'

import { useState } from 'react'
import { Search, ChevronLeft, ChevronRight, Filter, X } from 'lucide-react'
import { Button } from './button'
import { Input } from './input'
import { cn } from '@/lib/utils'

// ─── Search Bar ───
interface SearchBarProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
}

export function SearchBar({ value, onChange, placeholder, className }: SearchBarProps) {
  return (
    <div className={cn('relative', className)}>
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search...'}
        className="w-full rounded-lg border pl-9 pr-3 py-2 text-sm"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)', color: 'var(--theme-card-text)' }}
      />
      {value && (
        <button onClick={() => onChange('')} className="absolute right-3 top-1/2 -translate-y-1/2 hover:opacity-70"
          style={{ color: 'var(--theme-muted-text)' }}>
          <X size={14} />
        </button>
      )}
    </div>
  )
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
      <span className="text-xs font-medium shrink-0" style={{ color: 'var(--theme-muted-text)' }}>{label}:</span>
      {options.map(opt => (
        <button key={opt.value} onClick={() => toggle(opt.value)}
          className="rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors"
          style={{
            backgroundColor: selected.includes(opt.value) ? 'var(--theme-primary-light)' : 'var(--theme-surface)',
            color: selected.includes(opt.value) ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)',
          }}>
          {opt.label}
        </button>
      ))}
      {selected.length > 0 && (
        <button onClick={() => onChange([])} className="text-[10px] hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
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
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  if (total <= pageSize) return null

  return (
    <div className="flex items-center justify-between pt-3 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
      <span>{start}–{end} of {total}</span>
      <div className="flex items-center gap-1">
        {onPageSizeChange && (
          <select value={pageSize} onChange={(e) => { onPageSizeChange(Number(e.target.value)); onPageChange(1) }}
            className="rounded border px-1.5 py-0.5 text-[10px] mr-2"
            style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        )}
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}
          className="p-1 rounded hover:opacity-70 disabled:opacity-30" style={{ color: 'var(--theme-card-text)' }}>
          <ChevronLeft size={14} />
        </button>
        <span className="px-2 font-medium">{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}
          className="p-1 rounded hover:opacity-70 disabled:opacity-30" style={{ color: 'var(--theme-card-text)' }}>
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
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
