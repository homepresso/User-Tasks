'use client'

import { useId, useState, type ReactNode } from 'react'
import { Table2, BarChart3 } from 'lucide-react'
import { CHART_PALETTES } from '@/lib/report-sources'
import { useSlots } from '@/components/home/activity/segmented-bar'
import { cn } from '@/lib/utils'

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts tooltip / legend props */

/**
 * Shared chart styling for every report chart, matching the Home dataviz
 * approach (components/home/activity): theme chart colours through the
 * chart-palette resolver, horizontal hairline gridlines only, 11px muted
 * tabular ticks, a baseline but no other axis lines, tooltips on the
 * elevated surface, a 12px dot + label legend top left, and a Table toggle.
 */

/** Bars never get wider than this, so one category is a bar, not a slab. */
export const BAR_MAX = 48
/** Gap between category bands (≥ 30% of the band). */
export const BAND_GAP = '32%'

export const AXIS_TICK = { fontSize: 11, fill: 'var(--theme-muted-text)', className: 'num' } as const
export const AXIS_LABEL = { fontSize: 11, fill: 'var(--theme-muted-text)', textAnchor: 'middle' as const }
/** Props for <CartesianGrid>: horizontal lines only, subtle, solid. */
export const GRID_PROPS = { vertical: false, stroke: 'var(--ds-border-subtle)' } as const
/** Props for the category / baseline axis. */
export const BASE_AXIS = { tickLine: false, axisLine: { stroke: 'var(--ds-border)' } } as const
/** Props for the value axis: no line, no ticks. */
export const VALUE_AXIS = { tickLine: false, axisLine: false } as const
export const CURSOR_FILL = { fill: 'var(--ds-bg-subtle)' }

/** Stored report palettes that mean "the old default" and so follow the theme instead. */
const OLD_DEFAULT_BLUES = new Set(['#3b82f6', '#2563eb', '#1d4ed8', '#60a5fa'])
const DEFAULT_PALETTE = CHART_PALETTES[0].colors.map((c) => c.toLowerCase())

/** A report's own `style.colors`, unless it is the old default blue (or the default palette). */
export function customReportColors(colors: string[] | undefined | null): string[] | null {
  if (!colors || colors.length === 0) return null
  const lower = colors.map((c) => c.toLowerCase())
  if (lower.every((c) => OLD_DEFAULT_BLUES.has(c))) return null
  if (lower.length === DEFAULT_PALETTE.length && lower.every((c, i) => c === DEFAULT_PALETTE[i])) return null
  return colors
}

/** `count` series colours from the workspace theme via the chart-palette resolver. */
export function useSeriesColors(count: number, override?: string[] | null): string[] {
  const n = Math.max(1, Math.min(count, 10))
  const resolved = useSlots(Array.from({ length: n }, (_, i) => ({ role: 'series' as const, prefer: i })))
  const custom = customReportColors(override)
  return custom ?? resolved
}

/** Tooltip body on the elevated surface: the bucket, then value + series rows. */
export function ChartTooltip({ active, payload, label, valueFormatter, formatter }: any & { valueFormatter?: (v: unknown) => string }) {
  if (!active || !payload?.length) return null
  const title = label ?? payload[0]?.payload?.name
  // A <Tooltip formatter> may return [value, name] (recharts style) or the value.
  const fmt = valueFormatter ?? (formatter ? (v: unknown, n?: unknown) => { const r = formatter(v, n); return Array.isArray(r) ? r[0] : r } : null)
  return (
    <div className="rounded-md bg-elevated px-2.5 py-1.5 text-xs text-fg shadow-elev-2">
      {title != null && title !== '' && <div className="mb-0.5 text-fg-muted">{String(title)}</div>}
      {payload.map((p: any, i: number) => (
        <div key={`${p.dataKey ?? p.name}-${i}`} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: p.color ?? p.payload?.fill }} />
          <span className="num font-semibold">{fmt ? fmt(p.value, p.name) : formatValue(p.value)}</span>
          <span className="text-fg-muted">{p.name}</span>
        </div>
      ))}
    </div>
  )
}

function formatValue(v: unknown): string {
  if (typeof v === 'number') return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(v)
  return v == null ? '—' : String(v)
}

/** Recharts <Legend content> renderer: 12px dot + label, top left. */
export function ChartLegend({ payload }: any) {
  if (!payload?.length) return null
  return (
    <ul className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg">
      {payload.map((p: any, i: number) => (
        <li key={`${p.value}-${i}`} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block size-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span>{p.value}</span>
        </li>
      ))}
    </ul>
  )
}
/** Props to spread on <Legend>. */
export const LEGEND_PROPS = { verticalAlign: 'top' as const, align: 'left' as const, content: ChartLegend }

export interface ChartTableData {
  caption: string
  columns: string[]
  rows: Array<Array<ReactNode>>
}

/**
 * The frame every report chart shares: optional title and actions, the plot,
 * and a Chart / Table toggle that shows the same values as a table.
 */
export function ChartFrame({
  title, description, actions, table, children, className, bare = false,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  table?: ChartTableData | null
  children: ReactNode
  className?: string
  /** No card chrome (the caller already sits in a card). */
  bare?: boolean
}) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()
  return (
    <section className={cn('min-w-0', !bare && 'rounded-lg border border-border bg-panel p-4', className)} aria-labelledby={title ? `${id}-t` : undefined}>
      {(title || table || actions) && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h3 id={`${id}-t`} className="text-sm font-semibold text-fg">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-fg-muted">{description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            {table && (
              <button
                type="button"
                onClick={() => setShowTable((v) => !v)}
                aria-expanded={showTable}
                aria-controls={`${id}-table`}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-fg-muted hover:bg-subtle hover:text-fg"
                data-chart-table-toggle
              >
                {showTable ? <BarChart3 className="size-3.5" aria-hidden /> : <Table2 className="size-3.5" aria-hidden />}
                {showTable ? 'Chart' : 'Table'}
              </button>
            )}
          </div>
        </header>
      )}
      {showTable && table ? <ChartDataTable id={`${id}-table`} table={table} /> : <div role="figure" aria-labelledby={title ? `${id}-t` : undefined}>{children}</div>}
    </section>
  )
}

function ChartDataTable({ id, table }: { id: string; table: ChartTableData }) {
  return (
    <div id={id} className="max-h-80 overflow-auto rounded-md border border-border-subtle">
      <table className="w-full text-ui">
        <caption className="sr-only">{table.caption}</caption>
        <thead className="sticky top-0 bg-subtle">
          <tr>
            {table.columns.map((c, i) => (
              <th key={`${c}-${i}`} scope="col" className={cn('h-8 px-3 text-xs font-medium text-fg-muted', i === 0 ? 'text-left' : 'text-right')}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r} className="border-t border-border-subtle">
              {row.map((cell, i) => i === 0
                ? <th key={i} scope="row" className="h-8 px-3 text-left font-normal text-fg">{cell}</th>
                : <td key={i} className="num h-8 px-3 text-right text-fg">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
