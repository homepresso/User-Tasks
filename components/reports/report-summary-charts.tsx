'use client'

/**
 * A report's summary charts (config.charts): number cards in a row, then
 * chart cards in a responsive grid (time series and heatmaps span the full
 * width), above the report's table. The series come from the server
 * (lib/report-charts-server.ts) — this only draws them. Load it through
 * components/reports/lazy-charts.tsx (recharts stays in the async chunk).
 *
 * Marks follow the shared report chart kit: one series hue per chart (no
 * legend for a single series), categorical slices in the theme's fixed order
 * with a legend, a sequential one-hue ramp for the heatmap, tooltips on every
 * mark and a Chart / Table toggle on every card.
 */

import { BarChart3 } from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { InlineNotice } from '@/components/ui/inline-notice'
import { cn } from '@/lib/utils'
import {
  AXIS_TICK, BAND_GAP, BAR_MAX, BASE_AXIS, CURSOR_FILL, ChartFrame, ChartTooltip, GRID_PROPS, VALUE_AXIS, useSeriesColors, type ChartTableData,
} from './chart-kit'
import type { ReportChartResult, ReportChartSpec } from '@/lib/report-charts'

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts label props */

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
/** Donut / pie slices at most; more categories draw as bars. */
const MAX_SLICES = 8

export function formatChartValue(value: number | null | undefined, fn?: string): string {
  if (value == null) return '—'
  const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)
  return fn === 'nps' && value > 0 ? `+${text}` : text
}

export interface ReportSummaryChartsProps {
  /** The report's chart specs (order, measure for formatting). */
  specs: ReportChartSpec[]
  /** The server's series, by chart id; missing = still loading. */
  results?: ReportChartResult[] | null
  loading?: boolean
  className?: string
}

export function ReportSummaryCharts({ specs, results, loading, className }: ReportSummaryChartsProps) {
  if (!specs.length) return null
  const byId = new Map((results ?? []).map((r) => [r.id, r]))
  const numbers = specs.filter((s) => s.type === 'number')
  const charts = specs.filter((s) => s.type !== 'number')
  const timezone = results?.find((r) => r.timezone)?.timezone
  const truncated = results?.some((r) => r.truncated)
  return (
    <section className={cn('space-y-4 print:break-inside-avoid', className)} aria-label="Summary charts" data-report-summary-charts>
      {numbers.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {numbers.map((spec) => <NumberCard key={spec.id} spec={spec} result={byId.get(spec.id)} loading={loading} />)}
        </div>
      )}
      {charts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {charts.map((spec) => (
            <div key={spec.id} className={cn('min-w-0 print:break-inside-avoid', (spec.type === 'line' || spec.type === 'area' || spec.type === 'heatmap') && 'md:col-span-2')}>
              <ChartCard spec={spec} result={byId.get(spec.id)} loading={loading} />
            </div>
          ))}
        </div>
      )}
      {(timezone || truncated) && (
        <p className="text-xs text-fg-muted">
          {truncated && 'Charts use the newest 10,000 rows. '}
          {timezone && charts.some((s) => s.dimension?.bucket || s.type === 'heatmap') && `Times are in ${timezone}.`}
        </p>
      )}
    </section>
  )
}

function NumberCard({ spec, result, loading }: { spec: ReportChartSpec; result?: ReportChartResult; loading?: boolean }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-panel p-4" data-chart-id={spec.id} data-chart-type="number">
      <p className="truncate text-xs font-medium text-fg-muted" title={spec.title}>{spec.title}</p>
      {result?.error ? (
        <p className="mt-1 text-xs text-danger">{result.error}</p>
      ) : !result && loading ? (
        <div className="mt-2 h-7 w-16 rounded bg-subtle" aria-busy="true" aria-label="Loading" />
      ) : (
        <p className="num mt-1 text-2xl font-semibold text-fg" data-chart-value>{formatChartValue(result?.value, spec.measure.fn)}</p>
      )}
      {spec.range_days ? <p className="mt-0.5 text-2xs text-fg-muted">Last {spec.range_days} days</p> : null}
    </div>
  )
}

function ChartCard({ spec, result, loading }: { spec: ReportChartSpec; result?: ReportChartResult; loading?: boolean }) {
  const description = spec.range_days ? `Last ${spec.range_days} days` : undefined
  if (!result) {
    return (
      <ChartFrame title={spec.title} description={description}>
        <div className="h-[220px] w-full rounded-md bg-subtle" aria-busy={loading ? 'true' : undefined} aria-label="Loading chart" />
      </ChartFrame>
    )
  }
  if (result.error) {
    return (
      <ChartFrame title={spec.title}>
        <InlineNotice tone="danger" title="Couldn't draw this chart" message={result.error} />
      </ChartFrame>
    )
  }
  const empty = result.rows === 0
  const table = chartTable(spec, result)
  return (
    <div data-chart-id={spec.id} data-chart-type={spec.type}>
      <ChartFrame title={spec.title} description={description} table={empty ? null : table}>
        {empty ? (
          <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-center">
            <BarChart3 className="size-6 text-fg-muted opacity-40" aria-hidden />
            <p className="text-xs text-fg-muted">Nothing to chart yet</p>
          </div>
        ) : spec.type === 'heatmap' ? (
          <Heatmap result={result} fn={spec.measure.fn} />
        ) : (
          <SeriesChart spec={spec} result={result} />
        )}
      </ChartFrame>
    </div>
  )
}

function chartTable(spec: ReportChartSpec, result: ReportChartResult): ChartTableData {
  const valueHeader = spec.measure.fn === 'count' ? 'Count' : spec.measure.fn === 'nps' ? 'NPS' : spec.measure.fn === 'avg' ? 'Average' : spec.measure.fn === 'sum' ? 'Total' : spec.measure.fn === 'min' ? 'Lowest' : 'Highest'
  if (spec.type === 'heatmap') {
    return {
      caption: spec.title,
      columns: ['Day', ...Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))],
      rows: WEEKDAYS.map((day, dow) => [day, ...Array.from({ length: 24 }, (_, hour) => formatChartValue(result.cells?.find((c) => c.dow === dow && c.hour === hour)?.value ?? 0))]),
    }
  }
  return { caption: spec.title, columns: ['', valueHeader], rows: (result.points ?? []).map((p) => [p.label, formatChartValue(p.value, spec.measure.fn)]) }
}

function SeriesChart({ spec, result }: { spec: ReportChartSpec; result: ReportChartResult }) {
  const points = result.points ?? []
  const sliced = (spec.type === 'donut' || spec.type === 'pie') && points.length <= MAX_SLICES
  const colors = useSeriesColors(sliced ? points.length : 1)
  const data = points.map((p) => ({ name: p.label, value: p.value }))
  const fmt = (v: unknown) => formatChartValue(typeof v === 'number' ? v : null, spec.measure.fn)
  const tooltip = <Tooltip content={<ChartTooltip valueFormatter={fmt} />} cursor={CURSOR_FILL} />
  const margin = { top: 4, right: 8, bottom: 0, left: 0 }
  const seriesName = spec.measure.fn === 'count' ? 'Count' : spec.title

  if (sliced) {
    const total = points.reduce((a, p) => a + (p.value ?? 0), 0)
    return (
      <div className="flex flex-col items-center gap-4 sm:flex-row">
        <div className="h-[200px] w-full max-w-[220px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={spec.type === 'donut' ? 56 : 0} outerRadius={88} paddingAngle={data.length > 1 ? 1 : 0}
                stroke="var(--theme-card-bg)" strokeWidth={2} isAnimationActive={false}>
                {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
              </Pie>
              <Tooltip content={<ChartTooltip valueFormatter={fmt} />} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="w-full min-w-0 space-y-1.5 text-xs" aria-label={`${spec.title} legend`}>
          {points.map((p, i) => (
            <li key={p.key} className="flex items-center gap-2">
              <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
              <span className="min-w-0 flex-1 truncate text-fg" title={p.label}>{p.label}</span>
              <span className="num font-semibold text-fg">{fmt(p.value)}</span>
              {spec.measure.fn === 'count' && total > 0 && <span className="num w-10 text-right text-fg-muted">{Math.round(((p.value ?? 0) / total) * 100)}%</span>}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const horizontal = spec.type === 'bar' || spec.type === 'donut' || spec.type === 'pie'
  if (horizontal) {
    const height = Math.max(160, Math.min(420, points.length * 30 + 24))
    return (
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ ...margin, left: 4, right: 16 }} barCategoryGap={BAND_GAP}>
          <CartesianGrid {...GRID_PROPS} vertical horizontal={false} />
          <XAxis type="number" tick={AXIS_TICK} allowDecimals={spec.measure.fn !== 'count'} {...VALUE_AXIS} />
          <YAxis type="category" dataKey="name" tick={AXIS_TICK} width={110} interval={0} {...BASE_AXIS} />
          {tooltip}
          <Bar name={seriesName} dataKey="value" fill={colors[0]} radius={[0, 4, 4, 0]} maxBarSize={BAR_MAX / 2} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  const axes = (
    <>
      <CartesianGrid {...GRID_PROPS} />
      <XAxis dataKey="name" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={12} height={30} {...BASE_AXIS} />
      <YAxis tick={AXIS_TICK} width={40} allowDecimals={spec.measure.fn !== 'count'} {...VALUE_AXIS} />
      {tooltip}
    </>
  )
  if (spec.type === 'line') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={margin}>
          {axes}
          <Line name={seriesName} type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={2} dot={data.length <= 31 ? { r: 3 } : false} connectNulls isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    )
  }
  if (spec.type === 'area') {
    return (
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={margin}>
          {axes}
          <Area name={seriesName} type="monotone" dataKey="value" stroke={colors[0]} strokeWidth={2} fill={colors[0]} fillOpacity={0.15} connectNulls isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={margin} barCategoryGap={BAND_GAP}>
        {axes}
        <Bar name={seriesName} dataKey="value" fill={colors[0]} radius={[4, 4, 0, 0]} maxBarSize={BAR_MAX} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  )
}

/** Day of week × hour: a one-hue ramp (light → dark), every cell focusable with its value. */
function Heatmap({ result, fn }: { result: ReportChartResult; fn: string }) {
  const [hue] = useSeriesColors(1)
  const cells = result.cells ?? []
  const max = Math.max(0, ...cells.map((c) => c.value))
  const value = (dow: number, hour: number) => cells.find((c) => c.dow === dow && c.hour === hour)?.value ?? 0
  const shade = (v: number) => (v <= 0 || max <= 0 ? 'var(--ds-bg-subtle)' : `color-mix(in srgb, ${hue} ${Math.round(20 + (80 * v) / max)}%, var(--theme-card-bg))`)
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[480px] gap-[2px]" style={{ gridTemplateColumns: '2.5rem repeat(24, minmax(0, 1fr))' }} role="grid" aria-label="Day of the week by hour">
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="num text-center text-2xs text-fg-muted" aria-hidden>{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</div>
        ))}
        {WEEKDAYS.map((day, dow) => (
          <div key={day} className="contents" role="row">
            <div className="text-2xs leading-5 text-fg-muted" role="rowheader">{day}</div>
            {Array.from({ length: 24 }, (_, hour) => {
              const v = value(dow, hour)
              const label = `${day} ${String(hour).padStart(2, '0')}:00 — ${formatChartValue(v, fn)}`
              return <div key={hour} role="gridcell" tabIndex={0} title={label} aria-label={label} className="h-5 rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-primary" style={{ backgroundColor: shade(v) }} />
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
