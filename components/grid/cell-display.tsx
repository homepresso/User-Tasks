'use client'

import { Check, FileText, Minus } from 'lucide-react'
import { FormattedCellView } from '@/components/forms/data-table-cell'
import { formatCellValue, type CellFormat } from '@/lib/formatting/cell-format'
import { richTextPlainText } from '@/lib/forms/rich-text'
import { normalizePeopleValue } from '@/lib/forms/people-field'
import {
  calculatedValue, defaultControlFormat, normalizeFileValue, normalizeGridSignature, safeLink, type GridColumnDef,
} from '@/lib/grid/column-model'
import { cn } from '@/lib/utils'
import { useGridLabels, useGridSurface } from './grid-context'

/**
 * One cell for reading, by its control (lib/grid/column-model.ts): bound
 * values show their source's display label (resolved once per page —
 * usePageLabels), choices their label, people their names, a signature its
 * thumbnail, a file a link, rich text its plain text, a calculated column
 * its worked-out value, everything else the column's display format.
 */
export function GridCellDisplay({ col, value, row, locale }: { col: GridColumnDef; value: unknown; row?: Record<string, unknown>; locale?: string }) {
  const surface = useGridSurface()
  const labels = useGridLabels(col.key)
  const fmt = { locale: locale ?? surface?.locale }
  const format: CellFormat = col.format ?? { kind: defaultControlFormat(col.control), ...(col.control === 'currency' && col.control_options?.currency ? { currency: col.control_options.currency } : {}) }
  const empty = <span className="text-fg-muted"><span aria-hidden>—</span><span className="sr-only">empty</span></span>
  switch (col.control) {
    case 'boolean':
      return value === true
        ? <Check className="mx-auto size-4 text-fg" aria-label="Yes" />
        : <Minus className="mx-auto size-4 text-fg-subtle" aria-label="No" />
    case 'dropdown': case 'autocomplete': case 'lookup': case 'multiselect': {
      const list = (Array.isArray(value) ? value : value === null || value === undefined || value === '' ? [] : [value]).map(String)
      if (!list.length) return empty
      const labelOf = (v: string) => labels?.get(v) ?? col.control_options?.choices?.find((c) => c.value === v)?.label ?? v
      if (col.control === 'multiselect') {
        return (
          <span className="flex flex-wrap gap-1" data-grid-chips>
            {list.map((v) => <span key={v} className="inline-flex max-w-[10rem] truncate rounded-full border border-border bg-subtle px-2 py-0.5 text-2xs">{labelOf(v)}</span>)}
          </span>
        )
      }
      if (format.kind === 'badge') return <FormattedCellView cell={formatCellValue(labelOf(list[0]), format, fmt)} />
      return <span className="block max-w-80 truncate" title={labelOf(list[0])}>{labelOf(list[0])}</span>
    }
    case 'people': {
      const refs = normalizePeopleValue(value)
      if (!refs.length) return empty
      const nameOf = (id: string, name?: string) => name ?? surface?.people?.find((p) => p.id === id)?.display_name ?? surface?.people?.find((p) => p.id === id)?.email ?? 'Person'
      return <span className="block max-w-80 truncate">{refs.map((r) => nameOf(r.id, r.name)).join(', ')}</span>
    }
    case 'signature': {
      const sig = normalizeGridSignature(value)
      if (!sig) return empty
      const who = sig.user_name || sig.typed_name
      const src = sig.file.id && !sig.file.url.startsWith('http') ? `${sig.file.url}${sig.file.url.includes('?') ? '&' : '?'}inline=1` : sig.file.url
      return (
        <span className="inline-flex items-center gap-1" title={`Signed${who ? ` by ${who}` : ''}${sig.signed_at ? ` on ${new Date(sig.signed_at).toLocaleString(fmt.locale)}` : ''}`} data-grid-signature="signed">
          {/* eslint-disable-next-line @next/next/no-img-element -- authorised same-origin / storage signature image */}
          <img src={src} alt={`Signature${who ? ` of ${who}` : ''}`} className="h-8 max-w-[7rem] rounded border border-border bg-white object-contain" />
        </span>
      )
    }
    case 'file': {
      const file = normalizeFileValue(value)
      if (!file) return empty
      return (
        <a href={file.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex max-w-full items-center gap-1 text-primary-text hover:underline">
          <FileText className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{file.name}</span>
        </a>
      )
    }
    case 'link': {
      const href = typeof value === 'string' ? safeLink(value) : null
      if (!href) return value ? <span>{String(value)}</span> : empty
      return <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className="block max-w-80 truncate text-primary-text underline underline-offset-2">{String(value).replace(/^mailto:|^tel:/, '')}</a>
    }
    case 'rich_text': {
      const text = richTextPlainText(value)
      return text ? <span className="block max-w-80 truncate" title={text.length > 40 ? text : undefined}>{text}</span> : empty
    }
    case 'multiline': {
      const text = value === null || value === undefined ? '' : String(value)
      return text ? <span className="line-clamp-2 max-w-80 whitespace-pre-wrap break-words" title={text.length > 60 ? text : undefined}>{text}</span> : empty
    }
    case 'display': {
      const v = col.control_options?.formula ? calculatedValue(col, row ?? {}) : value
      const kind = col.format?.kind ?? (col.control_options?.formula ? 'number' : 'text')
      return <FormattedCellView cell={formatCellValue(v, { ...format, kind }, fmt)} />
    }
    default:
      return <span className={cn(col.control === 'number' || col.control === 'currency' ? 'num' : undefined)}><FormattedCellView cell={formatCellValue(value, format, fmt)} /></span>
  }
}
