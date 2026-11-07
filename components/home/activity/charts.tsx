"use client"

import { CheckCircle2, CornerUpLeft, XCircle } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import {
  bucketLabel, durationAxisUnit, formatCount, formatShare, humaniseDuration, OUTCOME_RULES,
  type HomeTaskStats,
} from "@/lib/home/activity"
import { ChartCard, LegendItem } from "./chart-card"
import { useSlots, useSlotsDetailed, type Segment } from "./segmented-bar"

/* eslint-disable @typescript-eslint/no-explicit-any -- recharts tooltip props */

const AXIS_TICK = { fontSize: 11, fill: "var(--theme-muted-text)" }
/**
 * Plots fill the card's bounded plot box (absolutely positioned, see
 * FullChartCard), so their size never feeds back into the layout. Resize
 * events are debounced and the container may shrink to 0 inside flex / grid.
 */
const PLOT = { width: "100%", height: "100%", minWidth: 0, debounce: 50 } as const

export function periodWords(days: number) {
  return `the last ${days} days`
}

/** Tooltip body: the value leads (strong), the series / bucket follows. */
function TipBox({ title, rows }: { title: string; rows: Array<{ color: string; label: string; value: string }> }) {
  return (
    <div className="rounded-md border border-border bg-elevated px-2.5 py-1.5 text-xs text-fg shadow-elev-2">
      <div className="mb-0.5 text-fg-muted">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ backgroundColor: r.color }} />
          <span className="num font-semibold">{r.value}</span>
          <span className="text-fg-muted">{r.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ── 1. Tasks completed over time ─────────────────────────────────────── */

export function CompletedChart({ stats, locale, refreshing }: { stats: HomeTaskStats; locale?: string; refreshing?: boolean }) {
  const [color] = useSlots([{ role: "series", prefer: 0 }])
  const { unit, days } = stats.period
  const buckets = stats.completed.buckets
  const total = stats.completed.total
  const data = buckets.map((b) => ({ key: b.start, label: bucketLabel(b.start, unit, locale), long: bucketLabel(b.start, unit, locale, "long"), count: b.count }))
  const busiest = buckets.reduce<(typeof buckets)[number] | null>((best, b) => (b.count > (best?.count ?? 0) ? b : best), null)
  const perDay = total / days
  return (
    <ChartCard testId="activity-completed" wide title="Tasks completed" refreshing={refreshing}
      info={`Tasks assigned to you (or team / shared tasks you responded to) that were completed, per ${unit === "week" ? "week (weeks start on Monday)" : "day"} in ${stats.period.timezone}.`}
      headline={formatCount(total, locale)}
      caption={total ? `in ${periodWords(days)} · ${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(unit === "week" ? perDay * 7 : perDay)} a ${unit}` : `in ${periodWords(days)}`}
      summary={total
        ? `Column chart of tasks you completed per ${unit} over ${periodWords(days)}: ${formatCount(total, locale)} in total${busiest ? `, most on ${bucketLabel(busiest.start, unit, locale, "long")} (${formatCount(busiest.count, locale)})` : ""}.`
        : `You completed no tasks in ${periodWords(days)}.`}
      empty={total ? null : `No completed tasks in ${periodWords(days)}`}
      table={{ caption: `Tasks completed per ${unit}`, columns: [unit === "week" ? "Week of" : "Day", "Completed"], rows: data.map((d) => [d.long, formatCount(d.count, locale)]) }}
      footer={busiest && busiest.count > 0 ? <>Busiest {unit}: <span className="text-fg">{bucketLabel(busiest.start, unit, locale, "long")}</span> ({formatCount(busiest.count, locale)})</> : null}>
      <ResponsiveContainer {...PLOT}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--theme-surface-border)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--theme-surface-border)" }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={36} tickFormatter={(v) => formatCount(v, locale)} />
          <Tooltip cursor={{ fill: "var(--ds-bg-subtle)" }}
            content={({ active, payload }: any) => active && payload?.length
              ? <TipBox title={payload[0].payload.long} rows={[{ color, label: payload[0].payload.count === 1 ? "task completed" : "tasks completed", value: formatCount(payload[0].payload.count, locale) }]} />
              : null} />
          <Bar dataKey="count" name="Completed" fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/* ── 2. My decisions (the bar on the top card) ──────────────────────────────────────────────────── */

export const APPROVAL_RULE = `Approval rate = approvals ÷ decisions. A decision is an outcome you chose: approve-like (${OUTCOME_RULES[1].matches}), reject-like (${OUTCOME_RULES[0].matches}), sent back (${OUTCOME_RULES[2].matches}), or any other label on a task that offered two or more outcomes. Plain completions (Done, Submitted…) are not decisions.`

/** My decisions as bar segments: approve / reject / send back, custom outcomes while they stay distinguishable, the rest folded into one grey part. */
export function useDecisionSegments(d: HomeTaskStats["decisions"]): Segment[] {
  // Custom outcomes get their own colour while one can be told apart from the
  // rest; the tail (and the SQL's own "Other decisions") folds into one grey part.
  const custom = d.groups.filter((g) => g.kind === "other" && g.label !== "Other decisions")
  const slots = useSlotsDetailed([
    { role: "success" }, { role: "danger" }, { role: "warning", semantic: false },
    ...custom.map((_, i) => ({ role: "series" as const, prefer: i + 2 })),
    { role: "neutral" },
  ])
  const firstFail = slots.slice(3, 3 + custom.length).findIndex((x) => !x.ok)
  const ownColour = firstFail === -1 ? custom.length : firstFail
  const segments: Segment[] = []
  let folded = 0
  for (const g of d.groups) {
    if (g.kind === "approve") segments.push({ key: "approve", label: g.label, value: g.count, color: slots[0].color, icon: <CheckCircle2 size={12} aria-hidden /> })
    else if (g.kind === "reject") segments.push({ key: "reject", label: g.label, value: g.count, color: slots[1].color, icon: <XCircle size={12} aria-hidden /> })
    else if (g.kind === "return") segments.push({ key: "return", label: g.label, value: g.count, color: slots[2].color, icon: <CornerUpLeft size={12} aria-hidden /> })
    else {
      const i = custom.indexOf(g)
      if (i >= 0 && i < ownColour) segments.push({ key: `other:${g.label}`, label: g.label, value: g.count, color: slots[3 + i].color })
      else folded += g.count
    }
  }
  if (folded) segments.push({ key: "other", label: "Other decisions", value: folded, color: slots[slots.length - 1].color })
  return segments
}

/* ── 3. Time to complete ──────────────────────────────────────────────── */

export function DurationChart({ stats, locale, refreshing }: { stats: HomeTaskStats; locale?: string; refreshing?: boolean }) {
  const [medianColor, p90Color] = useSlots([{ role: "series", prefer: 2 }, { role: "series", prefer: 0 }])
  const du = stats.durations
  const { unit, days } = stats.period
  const max = Math.max(0, ...stats.completed.buckets.map((b) => b.p90_s ?? 0))
  const axis = durationAxisUnit(max)
  const data = stats.completed.buckets.map((b) => ({
    label: bucketLabel(b.start, unit, locale), long: bucketLabel(b.start, unit, locale, "long"),
    median: b.median_s === null ? null : b.median_s / axis.divisor, p90: b.p90_s === null ? null : b.p90_s / axis.divisor,
    median_s: b.median_s, p90_s: b.p90_s, count: b.count,
  }))
  const pickup = du.pickup.count > 0 ? du.pickup : null
  return (
    <ChartCard testId="activity-duration" wide title="Time to complete" refreshing={refreshing}
      info="From when a task was assigned to you (created, or last reassigned) to when it was completed. Median: half took less. p90: nine in ten took less. Time to pick up runs from assigned to accepted or claimed, for tasks that needed accepting."
      headline={humaniseDuration(du.median_s, locale)}
      caption={du.count ? <>median · p90 <span className="text-fg">{humaniseDuration(du.p90_s, locale)}</span></> : "median"}
      summary={du.count
        ? `Line chart of the median and 90th-percentile time to complete per ${unit}. Overall median ${humaniseDuration(du.median_s, locale)}, p90 ${humaniseDuration(du.p90_s, locale)}${pickup ? `; time to pick up median ${humaniseDuration(pickup.median_s, locale)}` : ""}.`
        : `No completed tasks to time in ${periodWords(days)}.`}
      empty={du.count ? null : `No completed tasks in ${periodWords(days)}`}
      table={{ caption: `Time to complete per ${unit}`, columns: [unit === "week" ? "Week of" : "Day", "Tasks", "Median", "p90"],
        rows: data.filter((r) => r.count > 0).map((r) => [r.long, formatCount(r.count, locale), humaniseDuration(r.median_s, locale), humaniseDuration(r.p90_s, locale)]) }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ul className="flex gap-3" aria-hidden>
            <LegendItem mark="line" color={medianColor} label="Median" />
            <LegendItem mark="line" color={p90Color} label="90th percentile" />
          </ul>
          {pickup && <span data-pickup>Time to pick up: <span className="text-fg">{humaniseDuration(pickup.median_s, locale)}</span> median · {humaniseDuration(pickup.p90_s, locale)} p90 ({formatCount(pickup.count, locale)} tasks)</span>}
        </div>
      }>
      <ResponsiveContainer {...PLOT}>
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--theme-surface-border)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--theme-surface-border)" }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={44}
            tickFormatter={(v) => `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(v)} ${axis.unit}`} />
          <Tooltip cursor={{ stroke: "var(--theme-muted-text)", strokeWidth: 1 }}
            content={({ active, payload }: any) => {
              const row = active && payload?.length ? payload[0].payload : null
              if (!row || !row.count) return null
              return <TipBox title={`${row.long} · ${formatCount(row.count, locale)} task${row.count === 1 ? "" : "s"}`} rows={[
                { color: medianColor, label: "median", value: humaniseDuration(row.median_s, locale) },
                { color: p90Color, label: "p90", value: humaniseDuration(row.p90_s, locale) },
              ]} />
            }} />
          <Line type="monotone" dataKey="p90" name="90th percentile" stroke={p90Color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false}
            activeDot={{ r: 4, stroke: "var(--theme-card-bg)", strokeWidth: 2 }} />
          <Line type="monotone" dataKey="median" name="Median" stroke={medianColor} strokeWidth={2} dot={false} connectNulls isAnimationActive={false}
            activeDot={{ r: 4, stroke: "var(--theme-card-bg)", strokeWidth: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </ChartCard>
  )
}

/* ── 6. Processes I touch most ────────────────────────────────────────── */

export function TopProcessesChart({ stats, locale, refreshing }: { stats: HomeTaskStats; locale?: string; refreshing?: boolean }) {
  const [color] = useSlots([{ role: "series", prefer: 1 }])
  const rows = stats.top_processes
  const total = stats.completed.total
  const top = rows[0]
  const max = Math.max(1, ...rows.map((r) => r.count))
  const days = stats.period.days
  return (
    <ChartCard testId="activity-processes" wide title="Processes I work in most" refreshing={refreshing}
      info="The workflows your completed tasks in the period came from, most first (top five). Tasks outside a workflow are not listed."
      headline={top && total ? formatShare(top.count / total, locale) : "—"}
      caption={top ? <>of your tasks were <span className="text-fg">{top.name}</span></> : "of your tasks"}
      summary={rows.length ? `Bar chart of the processes your completed tasks came from: ${rows.map((r) => `${r.name} ${formatCount(r.count, locale)}`).join(", ")}.` : `None of your completed tasks in ${periodWords(days)} came from a workflow.`}
      empty={rows.length ? null : total ? `None of your tasks in ${periodWords(days)} came from a workflow` : `No completed tasks in ${periodWords(days)}`}
      table={{ caption: "Tasks completed by process", columns: ["Process", "Tasks"], rows: rows.map((r) => [r.name, formatCount(r.count, locale)]) }}>
      <ul className="space-y-2" aria-label="Tasks completed by process">
        {rows.map((r) => (
          <li key={r.workflow_id} className="grid min-w-0 grid-cols-[minmax(0,10rem)_minmax(0,1fr)] items-center gap-3 text-xs @md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]"
            aria-label={`${r.name}: ${formatCount(r.count, locale)} tasks`}>
            <span className="truncate">{r.name}</span>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="block h-3 rounded-r-sm" style={{ width: `${Math.max(2, (r.count / max) * 100)}%`, maxWidth: "calc(100% - 3rem)", backgroundColor: color }} />
              <span className="num">{formatCount(r.count, locale)}</span>
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}
