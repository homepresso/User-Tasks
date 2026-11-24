"use client"

import { useState, type CSSProperties } from "react"
import { metricUnitLabel } from "@/lib/apps/widgets"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ArrowDownRight, ArrowUpRight, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { RunWorkflowDialog } from "@/components/automations/run-workflow-dialog"
import { RunTimeline } from "@/components/timeline/run-timeline"
import { formatCompact, formatCount, formatCurrency, formatCurrencyHeadline, formatPercent } from "@/lib/format/number"
import { formatRelative } from "@/lib/format/date"
import type { AppWidget, WidgetConfig } from "@/lib/apps/schema"
import type { SurveyStat } from "@/lib/forms/survey-stats"
import { cn } from "@/lib/utils"
import { ACCENT_VAR } from "@/lib/apps/colors"
import { AppIconGlyph } from "../app-icon"
import { bucketRange, useBoxHeight } from "./chart-view"
import { Empty, KpiTile, Truncated, WidgetError, WidgetSkeleton, hoursText, isActive, useClickThrough, useWidgetData, type DataOf, type WidgetContext } from "./kit"

const TrendChart = dynamic(() => import("./chart-view").then((m) => m.TrendChart), { ssr: false, loading: () => <Skeleton className="h-full min-h-24 w-full" /> })
const SurveyStatChart = dynamic(() => import("@/components/forms/survey-charts/survey-charts").then((m) => m.SurveyStatChart), { ssr: false, loading: () => <Skeleton className="h-32 w-full" /> })

/**
 * SLA & performance, workflow, form and chart widgets (trends draw through
 * the reports' chart kit; gauge, goal and heatmap are small SVG / CSS
 * drawings on theme tokens).
 */

function useLoaded<T extends string>(widget: AppWidget, context: WidgetContext) {
  const q = useWidgetData(widget, context)
  const view = q.isPending ? <WidgetSkeleton type={widget.type} /> : q.error ? <WidgetError error={q.error} retry={() => void q.refetch()} /> : (q.data as { type: string }).type === "empty" ? <Empty text={(q.data as { reason?: string }).reason ?? "No data."} /> : null
  return { data: q.data as DataOf<T>, view }
}

function Trend({ rows, series, kind, onSelect }: { rows: Array<Record<string, unknown> & { name: string; key: string }>; series: Array<{ key: string; label: string; kind?: "bar" | "line" }>; kind?: "bar" | "line"; onSelect?: ((key: string) => void) | null }) {
  const { box, height } = useBoxHeight(100)
  return (
    <div ref={box} className="min-h-24 flex-1">
      <TrendChart rows={rows} series={series} height={height} kind={kind} onSelect={onSelect} />
      <table className="sr-only"><tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.name}</th>{series.map((s) => <td key={s.key}>{String(r[s.key] ?? "")}</td>)}</tr>)}</tbody></table>
    </div>
  )
}

export function SlaTrendWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"sla_trend">(widget, context)
  if (view) return view
  const done = data.points.reduce((a, p) => a + p.on_time + p.late, 0)
  if (!done) return <Empty text="Nothing finished in this period." />
  const onTime = data.points.reduce((a, p) => a + p.on_time, 0)
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-sla-trend>
      <p className="text-xs text-fg-muted"><span className="num text-lg font-semibold text-fg">{formatPercent(onTime / done)}</span> on time · {formatCount(done)} finished</p>
      <Trend rows={data.points.map((p) => ({ ...p, name: p.label, pct: p.pct }))} series={[{ key: "pct", label: "% on time" }]} />
      <Truncated show={data.truncated} />
    </div>
  )
}

export function SlaBreakdownWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"sla_breakdown">
  const { data, view } = useLoaded<"sla_breakdown">(widget, context)
  const click = useClickThrough(context, c.click, "row_click", widget.id)
  if (view) return view
  if (!data.rows.length) return <Empty text="No open items with a due date or SLA." />
  const by = { workflow: "Workflow", team: "Team", assignee: "Person", form: "Form" }[data.by] ?? "Group"
  return (
    <div className="min-h-0 overflow-auto scrollbar-thin" data-widget-sla-breakdown>
      <table className="w-full text-xs">
        <caption className="sr-only">SLA by {by.toLowerCase()}</caption>
        <thead><tr className="text-left text-fg-muted"><th className="py-1 font-medium">{by}</th><th className="py-1 text-right font-medium">On track</th><th className="py-1 text-right font-medium">At risk</th><th className="py-1 text-right font-medium">Breached</th><th className="w-1/4 py-1"><span className="sr-only">Share</span></th></tr></thead>
        <tbody>
          {data.rows.map((r) => {
            const n = r.on_track + r.at_risk + r.breached || 1
            return (
              <tr key={r.key} className={cn("border-t border-border-subtle", isActive(context, c.click, r.key) && "bg-primary-wash")}>
                <td className="max-w-0 truncate py-1 text-fg">{click && r.key !== "none" ? <button type="button" className="truncate hover:underline" onClick={() => click(r.key)} data-click-value={r.key}>{r.label}</button> : r.label}</td>
                <td className="num py-1 text-right">{r.on_track}</td>
                <td className="num py-1 text-right text-warning">{r.at_risk}</td>
                <td className="num py-1 text-right text-danger">{r.breached}</td>
                <td className="py-1 pl-2"><span className="flex h-1.5 overflow-hidden rounded-full bg-subtle" aria-hidden><span className="bg-success" style={{ width: `${(r.on_track / n) * 100}%` }} /><span className="bg-warning" style={{ width: `${(r.at_risk / n) * 100}%` }} /><span className="bg-danger" style={{ width: `${(r.breached / n) * 100}%` }} /></span></td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <Truncated show={data.truncated} />
    </div>
  )
}

export function CycleTimeWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"cycle_time">(widget, context)
  if (view) return view
  if (!data.count) return <Empty text="Nothing completed in this period." />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-cycle-time>
      <dl className="flex gap-4 text-xs text-fg-muted">
        <div><dd className="num text-lg font-semibold text-fg">{hoursText(data.median_h)}</dd><dt>Median</dt></div>
        <div><dd className="num text-lg font-semibold text-fg">{hoursText(data.p90_h)}</dd><dt>90th percentile</dt></div>
        <div><dd className="num text-lg font-semibold text-fg">{formatCount(data.count)}</dd><dt>Completed</dt></div>
      </dl>
      <Trend rows={data.points.map((p) => ({ ...p, name: p.label }))} series={[{ key: "median_h", label: "Median (h)" }, { key: "p90_h", label: "P90 (h)" }]} />
      <Truncated show={data.truncated} />
    </div>
  )
}

export function BottleneckWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"bottleneck">(widget, context)
  if (view) return view
  if (!data.rows.length) return <Empty text={data.runs_waiting ? `${data.runs_waiting} runs waiting, no open tasks.` : "Nothing is waiting."} />
  const max = Math.max(...data.rows.map((r) => r.waiting * r.avg_wait_h), 1)
  return (
    <div className="space-y-1.5" data-widget-bottleneck>
      <ul className="space-y-1.5">
        {data.rows.map((r) => (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate font-medium text-fg">{r.label}</span><span className="num shrink-0 text-xs text-fg-muted">{r.waiting} waiting · avg {hoursText(r.avg_wait_h)}</span></div>
            {r.workflow && <div className="truncate text-2xs text-fg-subtle">{r.workflow} · oldest {hoursText(r.oldest_h)}</div>}
            <span className="mt-0.5 block h-1.5 rounded-full bg-subtle" aria-hidden><span className="block h-full rounded-full bg-warning" style={{ width: `${((r.waiting * r.avg_wait_h) / max) * 100}%` }} /></span>
          </li>
        ))}
      </ul>
      {data.runs_waiting > 0 && <p className="text-2xs text-fg-subtle">{formatCount(data.runs_waiting)} runs paused or waiting for an event.</p>}
    </div>
  )
}

export function ThroughputWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"throughput">(widget, context)
  if (view) return view
  const created = data.points.reduce((a, p) => a + p.created, 0)
  const completed = data.points.reduce((a, p) => a + p.completed, 0)
  if (!created && !completed) return <Empty text="Nothing created or completed in this period." />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-throughput>
      <p className="text-xs text-fg-muted"><span className="num font-semibold text-fg">{formatCount(created)}</span> created · <span className="num font-semibold text-fg">{formatCount(completed)}</span> completed</p>
      <Trend rows={data.points.map((p) => ({ ...p, name: p.label }))} series={[{ key: "created", label: "Created", kind: "bar" }, { key: "completed", label: "Completed", kind: "line" }]} />
      <Truncated show={data.truncated} />
    </div>
  )
}

const RUN_TONES = { running: "text-info bg-info-wash", waiting: "text-warning bg-warning-wash", completed: "text-success bg-success-wash", failed: "text-danger bg-danger-wash" } as const
const RUN_FILTER: Record<string, string> = { running: "open", waiting: "open", completed: "completed", failed: "all" }

export function RunStatusWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"run_status">
  const { data, view } = useLoaded<"run_status">(widget, context)
  const click = useClickThrough(context, c.click, "row_click", widget.id)
  if (view) return view
  if (!data.total) return <Empty text="No workflow runs in this period." />
  return (
    <div className="grid grid-cols-4 content-start gap-2 @max-[20rem]:grid-cols-2" data-widget-run-status>
      {(Object.keys(RUN_TONES) as Array<keyof typeof RUN_TONES>).map((k) => {
        const body = <><span className="num block text-xl font-semibold">{formatCompact(data.counts[k])}</span><span className="block text-2xs capitalize text-fg-muted">{k}</span></>
        return click
          ? <button key={k} type="button" onClick={() => click(RUN_FILTER[k])} className={cn("rounded-md px-2 py-1.5 text-left", RUN_TONES[k])} data-click-value={k}>{body}</button>
          : <div key={k} className={cn("rounded-md px-2 py-1.5", RUN_TONES[k])}>{body}</div>
      })}
    </div>
  )
}

export function RecentFailuresWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"recent_failures">(widget, context)
  if (view) return view
  if (!data.items.length) return <Empty text="No failed runs." />
  return (
    <ul className="divide-y divide-border-subtle" data-widget-failures>
      {data.items.map((r) => (
        <li key={r.id} className="py-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/home/runs/${r.id}`} target={context.embed ? "_blank" : undefined} className="truncate text-sm font-medium text-fg hover:underline">{r.title}</Link>
            <time className="shrink-0 text-xs text-fg-muted" dateTime={r.at}>{formatRelative(r.at)}</time>
          </div>
          {r.error && <p className="line-clamp-2 text-xs text-danger">{r.error}</p>}
        </li>
      ))}
    </ul>
  )
}

export function RunTimelineWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"run_timeline">(widget, context)
  if (view) return view
  if (!data.run) return <Empty text="No runs yet." />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-run-timeline>
      <p className="truncate text-xs text-fg-muted"><span className="font-medium text-fg">{data.run.title}</span> · started {formatRelative(data.run.started_at)}</p>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin"><RunTimeline target={{ runId: data.run.id }} showHeader={false} showLinks={!context.embed} /></div>
    </div>
  )
}

export function StartWorkflowWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"start_workflow">
  const [open, setOpen] = useState(false)
  const id = typeof c.workflow_id === "string" ? c.workflow_id : null
  if (!id) return <Empty text="Choose a workflow in the widget settings." />
  return (
    <div className="flex h-full flex-col justify-center gap-2" data-widget-start-workflow>
      {c.description && <p className="text-sm text-fg-muted">{c.description}</p>}
      <div>
        <Button leadingIcon={<Play />} onClick={() => setOpen(true)} disabled={context.preview && false}
          className="bg-[var(--app-accent,var(--theme-primary))] text-[color:var(--app-accent-fg,var(--theme-on-primary))] hover:opacity-90" data-start-workflow>{c.button_label || "Start"}</Button>
      </div>
      <RunWorkflowDialog workflow={open ? { id, name: widget.title || c.button_label || "Workflow" } : null} open={open} onOpenChange={setOpen} />
    </div>
  )
}

export function SubmissionTrendWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"submission_trend">(widget, context)
  if (view) return view
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-submission-trend>
      <div className="flex items-baseline gap-2">
        <span className="num text-2xl font-semibold text-fg">{formatCount(data.total)}</span>
        <span className="text-xs text-fg-muted">submissions</span>
        <Change pct={data.change_pct} />
      </div>
      {data.total ? <Trend rows={data.points.map((p) => ({ ...p, name: p.label }))} series={[{ key: "value", label: "Submissions", kind: "bar" }]} /> : <Empty text="No submissions in this period." />}
      <Truncated show={data.truncated} />
    </div>
  )
}

function Change({ pct, invert = false }: { pct: number | null; invert?: boolean }) {
  if (pct === null || pct === undefined) return null
  const up = pct >= 0
  const good = invert ? !up : up
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium", good ? "text-success" : "text-danger")}>
      {up ? <ArrowUpRight className="size-3.5" aria-hidden /> : <ArrowDownRight className="size-3.5" aria-hidden />}{Math.abs(pct).toFixed(1)}%<span className="sr-only"> vs previous period</span>
    </span>
  )
}

/** Run statuses in words people use (a run waiting on a task is still in progress for the submitter). */
const RUN_STATUS_LABEL: Record<string, string> = { running: "In progress", waiting: "In progress", waiting_for_event: "In progress", paused: "Paused", completed: "Completed", failed: "Failed", cancelled: "Cancelled" }

export function MySubmissionsWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"my_submissions">(widget, context)
  if (view) return view
  if (!data.items.length) return <Empty text="You haven’t submitted anything yet." />
  return (
    <ul className="divide-y divide-border-subtle" data-widget-my-submissions>
      {data.items.map((s) => (
        <li key={s.id} className="flex items-center gap-2 py-1.5">
          <div className="min-w-0 flex-1">
            {s.href ? <Link href={s.href} className="block truncate text-sm font-medium text-fg hover:underline">{s.title || s.form}</Link> : <span className="block truncate text-sm font-medium text-fg">{s.title || s.form}</span>}
            <span className="text-xs text-fg-muted">{s.title ? `${s.form} · ` : ""}<time dateTime={s.at}>{formatRelative(s.at)}</time></span>
          </div>
          {(s.status || s.outcome) && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs", s.status === "failed" ? "bg-danger-wash text-danger" : s.status === "completed" ? "bg-success-wash text-success" : "bg-subtle text-fg-muted")}>{s.status ? (RUN_STATUS_LABEL[s.status] ?? s.status.replace(/_/g, " ")) : (s.outcome ?? "").replace(/_/g, " ")}</span>}
        </li>
      ))}
    </ul>
  )
}

export function FieldAnalyticsWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"field_analytics">(widget, context)
  if (view) return view
  const stats = data.stats as SurveyStat[]
  if (!data.total) return <Empty text={`No answers to ${data.form.name} yet.`} />
  if (!stats.length) return <Empty text="This form has no choice, rating or number fields to chart." />
  return (
    <div className="min-h-0 space-y-3 overflow-y-auto scrollbar-thin" data-widget-field-analytics>
      <p className="text-xs text-fg-muted">{formatCount(data.total)} responses to {data.form.name}</p>
      {stats.map((s, i) => <SurveyStatChart key={i} stat={s} />)}
    </div>
  )
}

/* ── Charts: KPI, goal, gauge, heatmap, pivot ────────────────────────── */

function fmt(value: number | null, c: { format: string; currency: string }): string {
  if (value === null) return "—"
  if (c.format === "currency") return formatCurrencyHeadline(value, c.currency || "USD")
  if (c.format === "percent") return formatPercent(value, { fromPercent: true })
  return Math.abs(value) >= 10_000 ? formatCompact(value) : formatCount(value, { maxFractionDigits: 2 })
}

export function KpiWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"kpi">
  const { data, view } = useLoaded<"kpi">(widget, context)
  const click = useClickThrough(context, c.click, "segment_click", widget.id)
  if (view) return view
  const unit = metricUnitLabel(c, data.unit)
  return (
    <div className="h-full" data-widget-kpi>
      <KpiTile label={widget.title || (unit && unit !== "%" ? unit[0].toUpperCase() + unit.slice(1) : "Value")} icon={c.icon ? <AppIconGlyph name={c.icon} className="size-3.5" /> : null} accent={c.accent ? ACCENT_VAR[c.accent] : null}
        value={fmt(data.value, c)} change={data.change_pct} sub={typeof c.target === "number" ? `Target ${fmt(c.target, c)}` : null}
        spark={data.points.map((p) => p.value)} onClick={click ? () => click(null) : null} />
    </div>
  )
}

export function GoalWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"goal">
  const { data, view } = useLoaded<"goal">(widget, context)
  if (view) return view
  const pct = Math.max(0, Math.min(100, data.pct))
  return (
    <div className="flex h-full flex-col justify-center gap-1.5" data-widget-goal>
      <span className="truncate text-xs font-medium text-fg-muted">{widget.title || "Progress"}</span>
      <div className="flex items-baseline justify-between gap-2">
        <span className="num text-2xl font-semibold text-fg">{fmt(data.value, c)}</span>
        <span className="text-xs text-fg-muted">of {fmt(c.target, c)} {c.target_label || (c.format === "percent" || c.format === "currency" ? "" : metricUnitLabel(c, data.unit))}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} aria-label={`${Math.round(data.pct)}% of target`}>
        <div className={cn("h-full rounded-full", data.pct >= 100 ? "bg-success" : "bg-[var(--app-accent,var(--theme-primary))]")} style={{ width: `${pct}%` }} />
      </div>
      <span className="num text-xs text-fg-muted">{data.pct.toFixed(1)}% of target</span>
    </div>
  )
}

/** Where a value sits on a gauge: 0..1 of the arc, and its tone. */
export function gaugePosition(value: number | null, c: Pick<WidgetConfig<"gauge">, "min" | "max" | "warn_at" | "danger_at" | "higher_is_better">): { at: number; tone: "success" | "warning" | "danger" } {
  const v = value ?? c.min
  const span = c.max - c.min || 1
  const at = Math.max(0, Math.min(1, (v - c.min) / span))
  const past = (t: number | null | undefined) => typeof t === "number" && (c.higher_is_better ? v <= t : v >= t)
  return { at, tone: past(c.danger_at) ? "danger" : past(c.warn_at) ? "warning" : "success" }
}

export function GaugeWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"gauge">
  const { data, view } = useLoaded<"gauge">(widget, context)
  if (view) return view
  const { at, tone } = gaugePosition(data.value, c)
  const arc = (from: number, to: number) => {
    const p = (t: number) => [50 - 40 * Math.cos(Math.PI * t), 50 - 40 * Math.sin(Math.PI * t)]
    const [x1, y1] = p(from); const [x2, y2] = p(to)
    // A gauge spans at most half a turn (180°): never the large arc, or values past the middle draw the long way round.
    return `M ${x1} ${y1} A 40 40 0 0 1 ${x2} ${y2}`
  }
  const color = { success: "var(--color-success)", warning: "var(--color-warning)", danger: "var(--color-danger)" }[tone]
  return (
    <div className="flex h-full flex-col items-center justify-center" data-widget-gauge>
      <span className="w-full truncate text-xs font-medium text-fg-muted">{widget.title || metricUnitLabel(c, data.unit)}</span>
      <svg viewBox="0 0 100 58" className="w-full max-w-56" role="img" aria-label={`${fmt(data.value, c)} on a scale from ${c.min} to ${c.max}`}>
        <path d={arc(0, 1)} stroke="var(--ds-bg-subtle, var(--color-border))" strokeWidth={9} fill="none" strokeLinecap="round" />
        {at > 0.001 && <path d={arc(0, at)} stroke={color} strokeWidth={9} fill="none" strokeLinecap="round" />}
        <text x="50" y="48" textAnchor="middle" className="num" fontSize="13" fontWeight={600} fill="var(--theme-card-text)">{fmt(data.value, c)}</text>
      </svg>
      <div className="flex w-full max-w-56 justify-between text-2xs text-fg-muted"><span className="num">{fmt(c.min, c)}</span><span>{metricUnitLabel(c, data.unit)}</span><span className="num">{fmt(c.max, c)}</span></div>
    </div>
  )
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

export function HeatmapWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const { data, view } = useLoaded<"heatmap">(widget, context)
  if (view) return view
  if (!data.total) return <Empty text="Nothing in this period." />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1 overflow-auto" data-widget-heatmap>
      <table className="h-full max-h-full w-full table-fixed border-separate border-spacing-0.5 text-2xs">
        <caption className="sr-only">Count by day of week and hour (UTC)</caption>
        <thead><tr><th className="w-8" /><>{Array.from({ length: 24 }, (_, h) => <th key={h} scope="col" className="font-normal text-fg-subtle">{h % 3 === 0 ? h : <span className="sr-only">{h}</span>}</th>)}</></tr></thead>
        <tbody>
          {data.cells.map((row, d) => (
            <tr key={d}>
              <th scope="row" className="pr-1 text-right font-normal text-fg-muted">{DAYS[d]}</th>
              {row.map((v, h) => (
                <td key={h} title={`${DAYS[d]} ${h}:00 — ${v}`} className="h-4 rounded-sm" style={{ background: v ? `color-mix(in oklab, var(--app-chart-1) ${Math.round(15 + (v / data.max) * 85)}%, transparent)` : "var(--ds-bg-subtle)" }}>
                  <span className="sr-only">{v}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-2xs text-fg-subtle">{formatCount(data.total)} items · busiest hour {formatCount(data.max)} · times in UTC</p>
    </div>
  )
}

export function PivotWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"pivot">
  const { data, view } = useLoaded<"pivot">(widget, context)
  const click = useClickThrough(context, c.click, "row_click", widget.id)
  if (view) return view
  if (!data.total && !data.rows.length) return <Empty text="No data to summarise." />
  const two = !!data.col_label
  const totals = c.totals !== false
  // Sums and averages: a cell with no numbers is blank (—), not 0. Counts: a missing cell is 0.
  const blankIsDash = c.source === "table_rows" && c.aggregate !== "count"
  const cell = (n: number) => c.format === "currency" ? formatCurrency(n, c.currency ?? "USD", { maxFractionDigits: 0 }) : c.format === "percent" ? formatPercent(n, { fromPercent: true }) : formatCount(n, { maxFractionDigits: 2 })
  const num = (v: number | null | undefined) => (v === null || v === undefined ? (blankIsDash ? "—" : cell(0)) : cell(v))
  // Heat map: each cell tinted by where its value sits between the lowest and highest cell.
  const values = c.heat ? data.rows.flatMap((r) => (two ? data.cols.map((col) => data.cells[r.key]?.[col.key]) : [data.row_totals[r.key]])).filter((v): v is number => typeof v === "number") : []
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 0
  const heat = (v: number | null | undefined): CSSProperties | undefined => {
    if (!c.heat || typeof v !== "number") return undefined
    const t = hi > lo ? (v - lo) / (hi - lo) : 0.5
    return { background: `color-mix(in oklab, var(--app-accent, var(--theme-primary)) ${Math.round(8 + t * 52)}%, transparent)`, color: t > 0.6 ? "#fff" : undefined }
  }
  return (
    <div className="min-h-0 overflow-auto scrollbar-thin" data-widget-pivot data-pivot-heat={c.heat ? "" : undefined}>
      <table className={cn("w-full text-xs", c.heat && "border-separate border-spacing-0.5")}>
        <caption className="sr-only">{data.row_label}{two ? ` by ${data.col_label}` : ""}</caption>
        <thead className="sticky top-0 bg-panel">
          <tr className="text-left text-fg-muted">
            <th scope="col" className="py-1 pr-2 font-medium">{data.row_label}{two ? ` \\ ${data.col_label}` : ""}</th>
            {two ? data.cols.map((col) => <th key={col.key} scope="col" className={cn("num py-1 pl-2 font-medium", c.heat ? "text-center" : "text-right")}>{col.label}</th>) : <th scope="col" className="py-1 text-right font-medium">Value</th>}
            {two && totals && <th scope="col" className="py-1 pl-2 text-right font-medium">Total</th>}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.key} className={cn(!c.heat && "border-t border-border-subtle", isActive(context, c.click, r.key) && "bg-primary-wash")}>
              <th scope="row" className="max-w-0 truncate py-1 pr-2 text-left font-normal text-fg">
                {click && r.key !== "none" ? <button type="button" className="hover:underline" onClick={() => click(c.rows === "time" ? bucketRange(r.key, c.interval) : r.key)} data-click-value={r.key}>{r.label}</button> : r.label}
              </th>
              {two
                ? data.cols.map((col) => <td key={col.key} className={cn("num py-1 pl-2", c.heat ? "rounded px-2 py-1.5 text-center font-medium" : "text-right")} style={heat(data.cells[r.key]?.[col.key])}>{num(data.cells[r.key]?.[col.key])}</td>)
                : <td className={cn("num py-1", c.heat ? "rounded px-2 text-center font-medium" : "text-right")} style={heat(data.row_totals[r.key])}>{num(data.row_totals[r.key])}</td>}
              {two && totals && <td className="num py-1 pl-2 text-right font-medium">{num(data.row_totals[r.key])}</td>}
            </tr>
          ))}
        </tbody>
        {totals && (
          <tfoot>
            <tr className="border-t border-border font-medium">
              <th scope="row" className="py-1 text-left">Total</th>
              {two && data.cols.map((col) => <td key={col.key} className={cn("num py-1 pl-2", c.heat ? "text-center" : "text-right")}>{num(data.col_totals[col.key])}</td>)}
              <td className="num py-1 pl-2 text-right">{num(data.total)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <Truncated show={data.truncated} />
    </div>
  )
}
