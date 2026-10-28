'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronUp, ChevronDown, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Column {
  key: string
  label: string
  type?: 'text' | 'number' | 'date' | 'boolean'
  render?: (value: any, row: any) => React.ReactNode
}

interface ReportDataTableProps {
  columns: Column[]
  data: any[]
  pageSize?: number
  title?: string
  /**
   * If provided, rows become clickable and this callback fires with the
   * row data. Use it to navigate to a detail page for the row.
   * The handler can return a string to be used as the href (for semantic
   * <a> rendering), or void/Promise for imperative navigation.
   */
  onRowClick?: (row: any) => string | void | Promise<void>
  /** Optional getter to compute an href per row for semantic Link rendering. */
  rowHref?: (row: any) => string | null
}

function getValue(row: any, key: string) {
  return key.split('.').reduce((o, k) => o?.[k], row)
}

function formatCell(value: any, type?: string) {
  if (value == null) return '—'
  if (type === 'date') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }
  if (type === 'boolean') return value ? 'Yes' : 'No'
  if (type === 'number') return typeof value === 'number' ? value.toLocaleString() : value
  return String(value)
}

export function ReportDataTable({ columns, data, pageSize = 10, title, onRowClick, rowHref }: ReportDataTableProps) {
  const clickable = !!(onRowClick || rowHref)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const va = getValue(a, sortKey)
        const vb = getValue(b, sortKey)
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va ?? '').localeCompare(String(vb ?? ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : data

  const totalPages = Math.ceil(sorted.length / pageSize)
  const paged = sorted.slice(page * pageSize, (page + 1) * pageSize)

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--theme-surface-border)' }}>
      {title && (
        <div className="px-4 py-3 border-b" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{title}</h3>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr style={{ backgroundColor: 'var(--theme-row-highlight)' }}>
              {columns.map(col => (
                <th
                  key={col.key}
                  className="px-4 py-2.5 text-left text-xs font-semibold cursor-pointer select-none whitespace-nowrap uppercase tracking-wider"
                  style={{ color: 'var(--theme-muted-text)' }}
                  onClick={() => toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
                  </span>
                </th>
              ))}
              {clickable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (clickable ? 1 : 0)} className="px-4 py-8 text-center text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                  No data
                </td>
              </tr>
            ) : paged.map((row, ri) => {
              const href = rowHref?.(row) ?? null
              const cells = (
                <>
                  {columns.map(col => (
                    <td key={col.key} className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--theme-card-text)' }}>
                      {col.render ? col.render(getValue(row, col.key), row) : formatCell(getValue(row, col.key), col.type)}
                    </td>
                  ))}
                  {clickable && (
                    <td className="px-2 py-2.5 w-8 text-right">
                      <ArrowRight size={12} style={{ color: 'var(--theme-muted-text)' }} />
                    </td>
                  )}
                </>
              )

              if (href) {
                // Native <Link> rendering for semantic navigation — fall back to
                // plain onClick when an href can't be computed but a click handler is present.
                return (
                  <tr
                    key={ri}
                    className="border-t transition-colors hover:bg-[var(--theme-row-highlight)] cursor-pointer"
                    style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
                    onClick={() => { /* Link inside tr — the first link handles it */ }}
                  >
                    {columns.map(col => (
                      <td key={col.key} className="px-4 py-2.5 text-xs whitespace-nowrap" style={{ color: 'var(--theme-card-text)' }}>
                        <Link href={href} className="block">
                          {col.render ? col.render(getValue(row, col.key), row) : formatCell(getValue(row, col.key), col.type)}
                        </Link>
                      </td>
                    ))}
                    <td className="px-2 py-2.5 w-8 text-right">
                      <Link href={href} className="inline-block">
                        <ArrowRight size={12} style={{ color: 'var(--theme-muted-text)' }} />
                      </Link>
                    </td>
                  </tr>
                )
              }

              return (
                <tr
                  key={ri}
                  className={cn(
                    'border-t transition-colors',
                    clickable ? 'cursor-pointer hover:bg-[var(--theme-row-highlight)]' : ''
                  )}
                  style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)' }}
                  onClick={clickable && onRowClick ? () => onRowClick(row) : undefined}
                >
                  {cells}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t text-xs" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)', backgroundColor: 'var(--theme-card-bg)' }}>
          <span>{sorted.length} row{sorted.length !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)} className="px-2 py-1 rounded hover:bg-[var(--theme-row-highlight)] disabled:opacity-30">Prev</button>
            <span>{page + 1} / {totalPages}</span>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)} className="px-2 py-1 rounded hover:bg-[var(--theme-row-highlight)] disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
