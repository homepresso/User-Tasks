'use client'

import { badgeStyle, type FormattedCell } from '@/lib/formatting/cell-format'
import { cn } from '@/lib/utils'

/**
 * One formatted cell (lib/formatting/cell-format.ts): text, a safe link
 * (http(s) / mailto / tel), a thumbnail from an allowed source, a status
 * badge with a theme-safe colour, or pretty JSON. Empty / invalid values
 * show the placeholder with "empty" for screen readers.
 */
export function FormattedCellView({ cell, wrap }: { cell: FormattedCell; wrap?: boolean }) {
  if (cell.empty) {
    return <span className="text-fg-muted"><span aria-hidden>{cell.text}</span><span className="sr-only">empty</span></span>
  }
  switch (cell.as) {
    case 'link':
      return (
        <a href={cell.href} target={cell.href?.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer nofollow"
          className="underline underline-offset-2 text-primary-text" onClick={(e) => e.stopPropagation()}>
          {cell.text}
        </a>
      )
    case 'image':
      // eslint-disable-next-line @next/next/no-img-element -- thumbnails from allowed sources, any size
      return <img src={cell.src} alt={cell.text} loading="lazy" referrerPolicy="no-referrer" className="h-8 w-8 rounded object-cover" />
    case 'badge':
      return <span className="inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-2xs font-medium" style={badgeStyle(cell.color ?? 'gray')} data-badge-color={cell.color}>{cell.text}</span>
    case 'json':
      return <pre className="max-h-32 max-w-xs overflow-auto whitespace-pre-wrap break-words text-2xs" style={{ fontFamily: 'var(--font-mono, monospace)' }}>{cell.text}</pre>
    default:
      return <span className={cn(wrap ? 'whitespace-pre-wrap break-words' : undefined, cell.negative ? 'text-(--status-blocked)' : '')}>{cell.text}</span>
  }
}
