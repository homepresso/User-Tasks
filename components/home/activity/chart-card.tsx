"use client"

import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { ChevronDown, Info, Table2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table"
import { Tooltip } from "@/components/ui/tooltip"
import { nextStableHeight } from "./measure"

/**
 * The frame every My activity chart shares: title (with an optional rule
 * tooltip), the headline number, the chart, and a "Table" toggle that shows
 * the same values as a table. The chart graphic is described by `summary`
 * for screen readers; while the period's data reloads the previous render
 * stays at reduced opacity (no skeleton flash).
 */

export interface ChartTable {
  caption: string
  columns: string[]
  rows: Array<Array<string | number>>
}

/**
 * A compact Home widget's state (My decisions, On time, My submissions):
 * collapsed it shows the headline and the bar; expanded, the legend, the
 * table and the notes too. `onMeasure` gets the content's natural height
 * so the dashboard can grow the widget to fit.
 */
export interface CompactControl {
  expanded: boolean
  onToggle: () => void
  onMeasure: (px: number) => void
}

type ChartCardProps = {
  title: string
  /** How the metric is defined (the info tooltip). */
  info?: string
  headline: ReactNode
  caption?: ReactNode
  /** One-sentence description of what the chart shows, for screen readers. */
  summary: string
  table?: ChartTable | null
  /** Shown instead of the chart when there is nothing to plot. */
  empty?: string | null
  refreshing?: boolean
  /** Default width on Home is wider (lib/home/layout.ts); kept for callers. */
  wide?: boolean
  testId: string
  children?: ReactNode
  footer?: ReactNode
  /** Render as a compact, expandable widget. */
  compact?: CompactControl
}

export function ChartCard(props: ChartCardProps) {
  if (props.compact) return <CompactChartCard {...props} compact={props.compact} />
  return <FullChartCard {...props} />
}

const cardClass = "min-w-0 rounded-lg border border-border bg-panel text-fg transition-opacity duration-[var(--ds-dur-base)]"
const titleClass = "flex min-w-0 items-center gap-1.5 text-ui font-medium text-fg-muted"

/**
 * The full card fills its grid cell (the grid fixes its height in 40px rows).
 * The plot box is `relative flex-1 min-h-0` and the plot sits absolutely
 * inside it, so the chart can never size its own box: no overflow, no
 * scrollbar, nothing for ResponsiveContainer to feed back into.
 */
function FullChartCard({ title, info, headline, caption, summary, table, empty, refreshing, testId, children, footer }: ChartCardProps) {
  const [showTable, setShowTable] = useState(false)
  const summaryId = useId()
  const tableId = useId()
  return (
    <section
      className={cn(cardClass, "flex h-full flex-col overflow-hidden p-4", refreshing && "opacity-60")}
      aria-labelledby={`${summaryId}-title`} aria-busy={refreshing || undefined} data-testid={testId}
    >
      <header className="flex min-w-0 items-start justify-between gap-2">
        <h3 id={`${summaryId}-title`} className={titleClass}>
          <span className="truncate">{title}</span>
          {info && <InfoTip text={info} label={`How ${title.toLowerCase()} is measured`} />}
        </h3>
        {table && !empty && (
          <Button type="button" variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable} aria-controls={tableId}
            leadingIcon={<Table2 />} className="-my-1 -mr-1 shrink-0" data-chart-table-toggle>
            {showTable ? "Chart" : "Table"}
          </Button>
        )}
      </header>
      <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="num text-metric" data-chart-headline>{headline}</span>
        {caption && <span className="min-w-0 text-xs text-fg-muted">{caption}</span>}
      </div>
      <p id={summaryId} className="sr-only">{summary}</p>
      <div className="relative mt-3 min-h-0 min-w-0 flex-1" data-chart-plot>
        {empty ? (
          <div className="absolute inset-0 flex items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-fg-muted" data-chart-empty>
            {empty}
          </div>
        ) : showTable && table ? (
          <div className="absolute inset-0 overflow-auto scrollbar-thin">
            <ChartDataTable id={tableId} table={table} />
          </div>
        ) : (
          <div role="figure" className="absolute inset-0 overflow-hidden" aria-labelledby={`${summaryId}-title`} aria-describedby={summaryId}>{children}</div>
        )}
      </div>
      {footer && !empty && <div className="mt-3 min-w-0 text-xs text-fg-muted">{footer}</div>}
    </section>
  )
}

/**
 * The compact form: title with an expand chevron (aria-expanded, and
 * aria-controls on the details region), the headline on one line, then the
 * bar. The details (table and notes) stay in the DOM, hidden, while collapsed.
 * Only the expanded content's natural height is reported (collapsed, the box
 * is the widget's own size, so measuring it would echo the layout back), and
 * changes of a pixel or less are ignored (nextStableHeight).
 */
function CompactChartCard({ title, info, headline, caption, summary, table, empty, refreshing, testId, children, footer, compact }: ChartCardProps & { compact: CompactControl }) {
  const id = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const last = useRef<number | null>(null)
  const { expanded, onToggle, onMeasure } = compact
  const canExpand = !empty && (!!table || !!footer)
  const open = canExpand && expanded

  useEffect(() => {
    const el = contentRef.current
    if (!el || !open) return
    const report = () => {
      const next = nextStableHeight(last.current, el.offsetHeight + 2) // + the section's 1px borders
      if (next === null) return
      last.current = next
      onMeasure(next)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [onMeasure, open])

  return (
    <section
      className={cn(cardClass, "h-full", refreshing && "opacity-60")}
      aria-labelledby={`${id}-title`} aria-busy={refreshing || undefined} data-testid={testId} data-compact-card data-expanded={open || undefined}
    >
      <div ref={contentRef} className={cn("flex min-w-0 flex-col gap-2.5 p-4", !open && "h-full justify-between")}>
        <header className="flex min-w-0 items-center justify-between gap-2">
          <h3 id={`${id}-title`} className={titleClass}>
            <span className="truncate">{title}</span>
            {info && <InfoTip text={info} label={`How ${title.toLowerCase()} is measured`} />}
          </h3>
          {canExpand && (
            <IconButton size="sm" onClick={onToggle} aria-expanded={open} aria-controls={`${id}-details`}
              label={`${open ? "Hide" : "Show"} details: ${title}`} className="-my-1 -mr-1 shrink-0"
              icon={<ChevronDown className={cn("transition-transform duration-[var(--ds-dur-base)]", open && "rotate-180")} />} data-compact-toggle />
          )}
        </header>
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="num shrink-0 text-metric" data-chart-headline>{headline}</span>
          {caption && <span className="truncate text-xs text-fg-muted">{caption}</span>}
        </div>
        <p id={id} className="sr-only">{summary}</p>
        {empty ? (
          <Tooltip content={empty}>
            <p className="truncate text-xs text-fg-muted" data-chart-empty>{empty}</p>
          </Tooltip>
        ) : (
          <div role="figure" className="min-w-0" aria-labelledby={`${id}-title`} aria-describedby={id}>{children}</div>
        )}
        {canExpand && (
          <div id={`${id}-details`} hidden={!open} className="space-y-2" data-compact-details>
            {table && <ChartDataTable id={`${id}-table`} table={table} />}
            {footer && <div className="text-xs text-fg-muted">{footer}</div>}
          </div>
        )}
      </div>
    </section>
  )
}

export function ChartDataTable({ id, table }: { id: string; table: ChartTable }) {
  return (
    <div id={id}>
      <Table className="text-xs">
        <caption className="sr-only">{table.caption}</caption>
        <THead>
          <tr>
            {table.columns.map((c, i) => <TH key={`${c}-${i}`} numeric={i > 0}>{c}</TH>)}
          </tr>
        </THead>
        <TBody>
          {table.rows.map((row, r) => (
            <TR key={r}>
              {row.map((cell, i) => i === 0
                ? <th key={i} scope="row" className="h-8 px-[var(--theme-density-cell-x)] text-left font-normal">{cell}</th>
                : <TD key={i} numeric className="h-8">{cell}</TD>)}
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

/** A small (i) with the metric's rule, on hover and on keyboard focus. */
export function InfoTip({ text, label }: { text: string; label: string }) {
  return (
    <Tooltip content={<span className="block font-normal leading-snug">{text}</span>} className="max-w-64">
      <button type="button" aria-label={label} className="inline-flex shrink-0 rounded-full text-fg-subtle hover:text-fg-muted">
        <Info className="size-3.5" aria-hidden />
      </button>
    </Tooltip>
  )
}

/** Legend entry: a swatch shaped like the mark (bar = dot, line = stroke), then the name in text ink. */
export function LegendItem({ color, label, value, mark = "rect", icon }: { color: string; label: string; value?: string; mark?: "rect" | "line"; icon?: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-1.5 text-xs">
      {/* Series colours are data-driven (theme palette resolver), so they stay inline. */}
      {mark === "line"
        ? <span aria-hidden className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        : <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
      {icon}
      <span className="truncate">{label}</span>
      {value && <span className="num text-fg-muted">{value}</span>}
    </li>
  )
}

/** Skeleton for one chart widget while the first load runs. */
export function ChartSkeleton({ compact = false }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className={cn(cardClass, "flex h-full flex-col justify-between gap-2.5 p-4")} aria-hidden data-activity-skeleton>
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-2 w-full" />
      </div>
    )
  }
  return (
    <div className={cn(cardClass, "flex h-full flex-col p-4")} aria-hidden data-activity-skeleton>
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-3 h-8 w-20" />
      <Skeleton className="mt-4 min-h-24 w-full flex-1" />
    </div>
  )
}
