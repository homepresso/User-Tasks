"use client"

import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart, Pie, PieChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from "recharts"
import { Table2 } from "lucide-react"
import { ChartTooltip } from "@/components/reports/chart-kit"
import { APP_CHART_COLORS, groupColors } from "@/lib/apps/colors"
import { useValueColors } from "../widget-style"
import type { DateRangeValue, WidgetConfig } from "@/lib/apps/schema"
import type { WidgetData } from "@/lib/services/app-widgets"
import { formatCompact, formatCount } from "@/lib/format/number"
import { cn } from "@/lib/utils"
import { useHeaderAction } from "./kit"

/**
 * App charts, drawn with recharts on the app palette (lib/apps/colors.ts:
 * vivid, light / dark aware; status groups in their status colours). Every
 * chart measures its box and fills it exactly — no overflow, axis labels
 * short and thinned (rotated when crowded) with room below. Donut / pie:
 * no slice labels; the total sits in the hole and the legend (with values)
 * goes beside the chart when wide, below when narrow. Bars / slices / points
 * raise click-through (`onSelect`). A table toggle sits in the widget header.
 */

type ChartData = Extract<WidgetData, { type: "chart" }>

/** Charts animate in once (bars grow, lines draw) unless the person asked for reduced motion. */
export function useChartMotion(): boolean {
  // Read once on the client (the first render already knows: no flash of animation for reduced motion).
  const [ok] = useState(() => typeof window !== "undefined" && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  return ok
}

export function useBoxSize(min = 100) {
  const box = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 300, height: 200 })
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const update = () => setSize({ width: Math.max(80, Math.floor(el.clientWidth)), height: Math.max(min, Math.floor(el.clientHeight)) })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [min])
  return { box, ...size }
}
/** Back-compat for the trend widgets. */
export function useBoxHeight(min = 120) {
  const { box, height } = useBoxSize(min)
  return { box, height }
}

/** A time bucket key → its date range (click-through to a date range filter). */
export function bucketRange(key: string, interval: string): DateRangeValue {
  const start = new Date(interval === "month" ? `${key}-01T00:00:00Z` : `${key}T00:00:00Z`)
  if (Number.isNaN(start.getTime())) return { preset: "all" }
  const end = new Date(start)
  if (interval === "month") end.setUTCMonth(end.getUTCMonth() + 1)
  else end.setUTCDate(end.getUTCDate() + (interval === "week" ? 7 : 1))
  end.setUTCDate(end.getUTCDate() - 1)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}

/** A long ISO-ish label → a short one ("2026-11-01" → "Nov 1"). */
export function shortLabel(label: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(label)
  if (!m) return label.length > 14 ? `${label.slice(0, 13)}…` : label
  const d = new Date(`${m[1]}-${m[2]}-${m[3] ?? "01"}T00:00:00Z`)
  return d.toLocaleDateString("en-US", m[3] ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", year: "2-digit", timeZone: "UTC" })
}

/** Axis layout for n categories across a width: rotate when crowded, keep a tick every k. */
export function axisLayout(n: number, width: number, longest: number): { angle: number; height: number; interval: number } {
  const per = width / Math.max(1, n)
  const need = Math.min(longest, 14) * 6.5 + 8
  if (per >= need) return { angle: 0, height: 24, interval: 0 }
  const rotatedNeed = 16
  const interval = per >= rotatedNeed ? 0 : Math.ceil(rotatedNeed / per) - 1
  return { angle: -35, height: Math.min(64, 18 + Math.min(longest, 14) * 4), interval }
}

const TICK = { fontSize: 11, fill: "var(--theme-muted-text)" } as const
const GRID = { stroke: "var(--ds-border-subtle, var(--color-border-subtle))", vertical: false } as const

export function ChartView({ data, config, onSelect, active }: { data: ChartData; config: WidgetConfig<"chart">; onSelect?: ((value: string | DateRangeValue) => void) | null; active?: string | null }) {
  const valueColors = useValueColors()
  const { box, width, height } = useBoxSize(110)
  const [table, setTable] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const animate = useChartMotion()
  const anim = { isAnimationActive: animate, animationDuration: 450, animationEasing: "ease-out" as const }
  const headerAction = useHeaderAction(
    <button type="button" onClick={() => setTable((t) => !t)} aria-pressed={table} aria-label={table ? "Show the chart" : "Show as a table"} title={table ? "Show the chart" : "Show as a table"}
      className={cn("inline-flex size-6 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg", table && "bg-subtle text-fg")} data-chart-table-toggle>
      <Table2 className="size-3.5" aria-hidden />
    </button>,
  )
  const rows = data.points.map((p) => ({ name: shortLabel(p.label), full: p.label, key: p.key, value: p.value, ...(p.values ?? {}) }))
  const select = onSelect ? (key: string | undefined) => { if (!key || key === "__other") return; onSelect(data.group_by === "time" ? bucketRange(key, data.interval) : key) } : null
  const byStatus = data.group_by === "status"
  const colors = data.group_by === "time" ? rows.map(() => APP_CHART_COLORS[0]) : groupColors(rows.map((r) => r.key), byStatus, { ...valueColors, ...Object.fromEntries(rows.filter((r) => valueColors[String(r.full).toLowerCase()]).map((r) => [String(r.key).toLowerCase(), valueColors[String(r.full).toLowerCase()]])) })
  // The active click-through value stays bright; hovering a clickable bar lifts it over the others.
  const dim = (key: string) => (active && active !== key ? 0.35 : hover && select && hover !== key ? 0.6 : 1)
  const longest = Math.max(...rows.map((r) => r.name.length), 1)
  const axis = axisLayout(rows.length, width - 40, longest)
  const yWidth = Math.min(56, 14 + String(formatCompact(Math.max(...rows.map((r) => r.value), 0))).length * 7)
  const click = (d: { payload?: { key?: string } }) => select?.(d?.payload?.key)
  const cursor = select ? "pointer" : undefined
  const margin = { top: 6, right: 8, bottom: 2, left: 0 }
  const xAxis = <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} interval={axis.interval} angle={axis.angle} textAnchor={axis.angle ? "end" : "middle"} height={axis.height} minTickGap={4} />
  const yAxis = <YAxis tick={TICK} tickLine={false} axisLine={false} width={yWidth} allowDecimals={false} tickFormatter={(v: number) => formatCompact(v)} />
  const tooltip = <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--ds-bg-subtle, var(--color-subtle))" }} labelFormatter={((_l: unknown, p: Array<{ payload?: { full?: string } }>) => p?.[0]?.payload?.full ?? "") as never} />

  let chart: ReactNode
  const kind = config.chart
  if (kind === "scatter") {
    chart = (
      <ScatterChart margin={margin}>
        <CartesianGrid {...GRID} />
        <XAxis type="number" dataKey="x" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} height={24} tickFormatter={(v: number) => formatCompact(v)} />
        <YAxis type="number" dataKey="y" tick={TICK} tickLine={false} axisLine={false} width={40} tickFormatter={(v: number) => formatCompact(v)} />
        <ZAxis range={[36, 36]} />
        <Tooltip content={<ChartTooltip />} />
        <Scatter data={data.scatter ?? []} fill={APP_CHART_COLORS[0]} fillOpacity={0.8} isAnimationActive={false} />
      </ScatterChart>
    )
  } else if (kind === "pie" || kind === "donut") {
    return <>{headerAction}<Donut box={box} width={width} height={height} rows={rows} colors={colors} donut={kind === "donut"} onSelect={select} active={active ?? null} label={data.value_label} table={table} truncated={data.truncated} motion={animate} /></>
  } else if ((kind === "stacked_bar" || kind === "combo") && data.series?.length) {
    const lineSeries = config.line_series ?? null
    const sc = groupColors(data.series.map((s) => s.key), data.series.some((s) => /^(todo|completed|in_progress|blocked|cancelled|running|failed)$/.test(s.key)), valueColors)
    chart = (
      <ComposedChart data={rows} margin={margin}>
        <CartesianGrid {...GRID} />{xAxis}{yAxis}{tooltip}
        {data.series.filter((s) => !(kind === "combo" && s.key === lineSeries)).map((s, i, bars) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId="s" fill={sc[data.series!.indexOf(s)]} maxBarSize={44} {...anim} onClick={click} cursor={cursor} radius={i === bars.length - 1 ? [3, 3, 0, 0] : undefined} />)}
        {kind === "combo" && lineSeries && data.series.some((s) => s.key === lineSeries)
          ? <Line type="monotone" dataKey={lineSeries} name={data.series.find((s) => s.key === lineSeries)?.label ?? lineSeries} stroke={sc[data.series.findIndex((s) => s.key === lineSeries)]} strokeWidth={2.5} dot={{ r: 2.5 }} {...anim} />
          : kind === "combo" && <Line type="monotone" dataKey="value" name="Total" stroke="var(--color-fg)" strokeWidth={2} dot={false} {...anim} />}
      </ComposedChart>
    )
  } else if (kind === "line" || kind === "area" || kind === "combo") {
    const C = kind === "area" ? AreaChart : kind === "combo" ? ComposedChart : LineChart
    chart = (
      <C data={rows} margin={margin}>
        <CartesianGrid {...GRID} />{xAxis}{yAxis}{tooltip}
        {kind === "combo" && <Bar dataKey="value" name={data.value_label} fill={APP_CHART_COLORS[0]} fillOpacity={0.35} maxBarSize={44} {...anim} onClick={click} cursor={cursor} />}
        {kind === "area"
          ? <Area type="monotone" dataKey="value" name={data.value_label} stroke={APP_CHART_COLORS[0]} fill={APP_CHART_COLORS[0]} fillOpacity={0.15} strokeWidth={2} {...anim} activeDot={{ r: 4 }} />
          : <Line type="monotone" dataKey="value" name={data.value_label} stroke={APP_CHART_COLORS[0]} strokeWidth={2} dot={rows.length <= 20 ? { r: 2.5 } : false} activeDot={{ r: 4.5 }} {...anim} />}
      </C>
    )
  } else {
    const horizontal = kind === "horizontal_bar" || kind === "funnel"
    const sorted = kind === "funnel" ? [...rows].sort((a, b) => b.value - a.value) : rows
    const hc = kind === "funnel" ? sorted.map((r) => colors[rows.indexOf(r)]) : colors
    chart = (
      <BarChart data={sorted} layout={horizontal ? "vertical" : "horizontal"} margin={{ ...margin, left: horizontal ? 4 : 0 }} barCategoryGap={kind === "funnel" ? 2 : "20%"}>
        <CartesianGrid {...GRID} vertical={horizontal} horizontal={!horizontal} />
        {horizontal
          ? <><XAxis type="number" tick={TICK} tickLine={false} axisLine={false} height={22} tickFormatter={(v: number) => formatCompact(v)} allowDecimals={false} /><YAxis type="category" dataKey="name" tick={TICK} tickLine={false} axisLine={false} width={Math.min(130, 16 + longest * 6.5)} /></>
          : <>{xAxis}{yAxis}</>}
        {tooltip}
        <Bar dataKey="value" name={data.value_label} {...anim} cursor={cursor} maxBarSize={horizontal ? 28 : 44} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} onClick={click}
          onMouseEnter={(d: { payload?: { key?: string } }) => setHover(d?.payload?.key ?? null)} onMouseLeave={() => setHover(null)}>
          {sorted.map((r, i) => <Cell key={r.key} fill={hc[i]} fillOpacity={dim(r.key)} data-chart-segment={r.key} />)}
        </Bar>
      </BarChart>
    )
  }
  const seriesLegend = (kind === "stacked_bar" || kind === "combo") && data.series?.length ? data.series : null
  const legendH = seriesLegend ? 22 : 0
  return (
    <div ref={box} className="relative h-full min-h-28 w-full" data-widget-chart={config.chart}>
      {headerAction}
      {table ? <DataTable rows={rows.map((r) => ({ name: r.full, value: r.value }))} label={data.value_label} /> : (
        <>
          {seriesLegend && (
            <ul className="flex h-[22px] flex-wrap items-center gap-x-3 overflow-hidden text-xs text-fg-muted" aria-label="Series">
              {seriesLegend.map((s, i) => {
                const sc = groupColors(seriesLegend.map((x) => x.key), seriesLegend.some((x) => /^(todo|completed|in_progress|blocked|cancelled|running|failed)$/.test(x.key)), valueColors)
                const total = data.points.reduce((a, p) => a + (p.values?.[s.key] ?? 0), 0)
                return <li key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: sc[i] }} aria-hidden /><span className="text-fg">{s.label}</span><span className="num">{formatCompact(total)}</span></li>
              })}
            </ul>
          )}
          <ResponsiveContainer width="100%" height={Math.max(80, height - legendH)}>{chart as React.ReactElement}</ResponsiveContainer>
          <table className="sr-only"><caption>{data.value_label}</caption><tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.full}</th><td>{r.value}</td></tr>)}</tbody></table>
        </>
      )}
      {data.truncated && <p className="absolute right-0 top-0 text-2xs text-fg-subtle">Newest 5,000 items</p>}
    </div>
  )
}

function DataTable({ rows, label }: { rows: Array<{ name: string; value: number }>; label: string }) {
  return (
    <div className="h-full overflow-auto" data-chart-table>
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-panel"><tr className="text-left text-fg-muted"><th className="py-1 font-medium">Group</th><th className="py-1 text-right font-medium">{label}</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.name} className="border-t border-border-subtle"><td className="py-1 text-fg">{r.name}</td><td className="num py-1 text-right">{formatCount(r.value, { maxFractionDigits: 2 })}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function Donut({ box, width, height, rows, colors, donut, onSelect, active, label, table, truncated, motion }: {
  box: React.RefObject<HTMLDivElement | null>; width: number; height: number; rows: Array<{ name: string; full: string; key: string; value: number }>; colors: string[]
  donut: boolean; onSelect: ((key: string | undefined) => void) | null; active: string | null; label: string; table: boolean; truncated: boolean; motion: boolean
}) {
  const total = rows.reduce((a, r) => a + r.value, 0)
  // Legend beside the donut or under it — whichever leaves the bigger donut (no wasted band above and below).
  const sideLegend = Math.min(200, width * 0.42)
  const belowLegend = Math.min(height * 0.45, 22 * Math.ceil(rows.length / 2) + 10)
  const sideR = Math.min(width - sideLegend, height) / 2
  const belowR = Math.min(width, height - belowLegend) / 2
  const wide = width >= 300 && sideR >= belowR
  const chartW = wide ? Math.min(width - sideLegend, height + 12) : width
  const chartH = wide ? height : height - belowLegend
  const radius = Math.max(30, Math.min(chartW, chartH) / 2 - 6)
  return (
    <div ref={box} className={cn("relative flex h-full min-h-28 w-full", wide ? "flex-row items-center justify-center" : "flex-col items-stretch")} data-widget-chart={donut ? "donut" : "pie"}>
      {table ? <DataTable rows={rows.map((r) => ({ name: r.full, value: r.value }))} label={label} /> : (
        <>
          <div className="relative shrink-0" style={{ width: chartW, height: chartH }}>
            <PieChart width={chartW} height={chartH}>
              <Pie data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={radius} innerRadius={donut ? radius * 0.62 : 0} paddingAngle={rows.length > 1 ? 1.5 : 0} stroke="var(--theme-card-bg)" strokeWidth={2}
                isAnimationActive={motion} animationDuration={500} label={false} labelLine={false} onClick={(d: { payload?: { key?: string } }) => onSelect?.(d?.payload?.key)} cursor={onSelect ? "pointer" : undefined}>
                {rows.map((r, i) => <Cell key={r.key} fill={colors[i]} fillOpacity={active && active !== r.key ? 0.35 : 1} data-chart-segment={r.key} />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} />
            </PieChart>
            {donut && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden>
                <span className="num text-xl font-semibold text-fg">{formatCompact(total)}</span>
                <span className="text-2xs text-fg-muted">{label}</span>
              </div>
            )}
          </div>
          <ul className={cn("min-w-0 space-y-1 overflow-y-auto text-xs", wide ? "flex-1 pl-3" : "mt-1 grid grid-cols-2 gap-x-3 space-y-0")} style={wide ? { maxHeight: height } : undefined} aria-label={`${label} by group`}>
            {rows.map((r, i) => (
              <li key={r.key}>
                <button type="button" disabled={!onSelect} onClick={() => onSelect?.(r.key)} className={cn("flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left", onSelect && "hover:bg-subtle", active === r.key && "bg-subtle")} data-legend-item={r.key}>
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ background: colors[i] }} aria-hidden />
                  <span className="min-w-0 flex-1 truncate capitalize text-fg">{r.full.replace(/_/g, " ")}</span>
                  <span className="num shrink-0 text-fg-muted">{formatCount(r.value)} · {total ? Math.round((r.value / total) * 100) : 0}%</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {truncated && <p className="absolute right-0 top-0 text-2xs text-fg-subtle">Newest 5,000 items</p>}
    </div>
  )
}

/** A small series chart for the Phase 2 trend widgets (SLA trend, cycle time, throughput, submissions). */
export function TrendChart({ rows, series, height, kind = "line", onSelect }: {
  rows: Array<Record<string, unknown> & { name: string; key: string }>
  series: Array<{ key: string; label: string; kind?: "bar" | "line" }>
  height: number
  kind?: "bar" | "line"
  onSelect?: ((key: string) => void) | null
}) {
  const { box, width } = useBoxSize(60)
  const shortRows = rows.map((r) => ({ ...r, full: r.name, name: shortLabel(String(r.name)) }))
  const axis = axisLayout(rows.length, width - 40, Math.max(...shortRows.map((r) => r.name.length), 1))
  const click = onSelect ? (d: { activePayload?: Array<{ payload?: { key?: string } }> }) => { const k = d?.activePayload?.[0]?.payload?.key; if (k) onSelect(k) } : undefined
  return (
    <div ref={box} className="h-full w-full">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={shortRows} margin={{ top: 6, right: 8, bottom: 2, left: 0 }} onClick={click as never}>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="name" tick={TICK} tickLine={false} axisLine={{ stroke: "var(--color-border)" }} interval={axis.interval} angle={axis.angle} textAnchor={axis.angle ? "end" : "middle"} height={axis.height} />
          <YAxis tick={TICK} tickLine={false} axisLine={false} width={36} tickFormatter={(v: number) => formatCompact(v)} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--ds-bg-subtle, var(--color-subtle))" }} />
          {series.map((s, i) => ((s.kind ?? kind) === "bar"
            ? <Bar key={s.key} dataKey={s.key} name={s.label} fill={APP_CHART_COLORS[i % 8]} isAnimationActive={false} maxBarSize={36} radius={[3, 3, 0, 0]} />
            : <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={APP_CHART_COLORS[i % 8]} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
