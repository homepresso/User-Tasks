'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ChevronUp, ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getReportValue } from '@/lib/report-sources'
import { Table, THead, TBody, TR, TH, TD, TableEmpty } from '@/components/ui/table'
import { Pagination } from '@/components/ui/list-controls'
import { formatDate } from '@/lib/format/date'

/* eslint-disable @typescript-eslint/no-explicit-any -- report rows are untyped records */

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
   */
  onRowClick?: (row: any) => string | void | Promise<void>
  /** Optional getter to compute an href per row for semantic Link rendering. */
  rowHref?: (row: any) => string | null
}

function formatCell(value: any, type?: string) {
  if (value == null || value === '') return '—'
  if (type === 'date') {
    const d = new Date(value)
    return isNaN(d.getTime()) ? String(value) : formatDate(d)
  }
  if (type === 'boolean') return value ? 'Yes' : 'No'
  if (type === 'number') return typeof value === 'number' ? new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value) : value
  return String(value)
}

export function ReportDataTable({ columns, data, pageSize = 10, title, onRowClick, rowHref }: ReportDataTableProps) {
  const clickable = !!(onRowClick || rowHref)
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(pageSize)

  const sorted = sortKey
    ? [...data].sort((a, b) => {
        const va = getReportValue(a, sortKey)
        const vb = getReportValue(b, sortKey)
        const cmp = typeof va === 'number' && typeof vb === 'number'
          ? va - vb
          : String(va ?? '').localeCompare(String(vb ?? ''))
        return sortDir === 'asc' ? cmp : -cmp
      })
    : data

  const paged = sorted.slice((page - 1) * size, page * size)

  function toggleSort(key: string) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
    setPage(1)
  }

  const colCount = columns.length + (clickable ? 1 : 0)
  const numeric = (c: Column) => c.type === 'number'
  const content = (row: any, col: Column) => col.render ? col.render(getReportValue(row, col.key), row) : formatCell(getReportValue(row, col.key), col.type)
  // Cells cut at 320px: the whole value in a native tooltip.
  const fullText = (row: any, col: Column) => { if (col.render) return undefined; const v = formatCell(getReportValue(row, col.key), col.type); return typeof v === 'string' ? v : undefined }

  return (
    <section className="space-y-2">
      {title && <h3 className="text-sm font-semibold text-fg">{title}</h3>}
      <Table label={title ?? 'Report results'} stickyFirstColumn>
        <THead>
          <tr>
            {columns.map((col, ci) => (
              <TH key={col.key} numeric={numeric(col)} col={ci === 0 ? 'name' : col.type === 'date' ? 'date' : numeric(col) ? 'number' : undefined} aria-sort={sortKey === col.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                <button type="button" onClick={() => toggleSort(col.key)} className={cn('inline-flex items-center gap-1 hover:text-fg', numeric(col) && 'flex-row-reverse')}>
                  {col.label}
                  {sortKey === col.key && (sortDir === 'asc' ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
                </button>
              </TH>
            ))}
            {clickable && <TH className="w-8"><span className="sr-only">Open</span></TH>}
          </tr>
        </THead>
        <TBody>
          {paged.length === 0 ? (
            <TableEmpty colSpan={colCount} title="No rows" description="Nothing matches this report's filters." />
          ) : paged.map((row, ri) => {
            const href = rowHref?.(row) ?? null
            if (href) {
              return (
                <TR key={ri} interactive>
                  {columns.map((col, ci) => (
                    <TD key={col.key} numeric={numeric(col)} className="max-w-[320px] truncate" title={fullText(row, col)}>
                      {ci === 0 ? <Link href={href} className="font-medium text-fg hover:underline">{content(row, col)}</Link> : content(row, col)}
                    </TD>
                  ))}
                  <TD className="w-8 text-right">
                    <Link href={href} aria-label="Open" className="inline-flex text-fg-muted hover:text-fg"><ChevronRight className="size-3.5" /></Link>
                  </TD>
                </TR>
              )
            }
            return (
              <TR key={ri} interactive={clickable} onClick={clickable && onRowClick ? () => onRowClick(row) : undefined}>
                {columns.map(col => (
                  <TD key={col.key} numeric={numeric(col)} className="max-w-[320px] truncate" title={fullText(row, col)}>{content(row, col)}</TD>
                ))}
                {clickable && <TD className="w-8 text-right"><ChevronRight className="inline size-3.5 text-fg-muted" /></TD>}
              </TR>
            )
          })}
        </TBody>
      </Table>
      {sorted.length > size && (
        <Pagination page={page} pageSize={size} total={sorted.length} onPageChange={setPage} onPageSizeChange={(n: number) => { setSize(n); setPage(1) }} noun="row" />
      )}
    </section>
  )
}
