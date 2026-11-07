"use client"

import { useEffect, useId, useRef, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, Bell, CheckCircle2, CheckSquare, ChevronDown, Inbox, Scale, XCircle, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { IconButton } from "@/components/ui/icon-button"
import { Skeleton } from "@/components/ui/skeleton"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import { formatCount, formatShare, humaniseDuration, type HomeTaskStats } from "@/lib/home/activity"
import type { HomeWidgetId } from "@/lib/home/layout"
import { cn } from "@/lib/utils"
import { HOME_QUERY_KEY } from "./shared"
import { useHome } from "./home-context"
import { useActivityStats } from "./activity/activity-section"
import { ChartDataTable, InfoTip, type ChartTable } from "./activity/chart-card"
import { APPROVAL_RULE, periodWords, useDecisionSegments } from "./activity/charts"
import { SegmentedBar, useSlots, type Segment } from "./activity/segmented-bar"
import { nextStableHeight } from "./activity/measure"

/**
 * The four top cards of Home (Dec 2026: the compact My decisions / On time /
 * My submissions row merged into them). Each is its own widget and loads on
 * its own (a slow or failing card never holds up the others; a failure shows
 * a dash). The value opens the card's tab in the task list; the chevron
 * shows the legend, the table and the notes, and the widget grows to fit.
 * Counts are "now"; the graphics follow the header's 7 / 30 / 90 days.
 *
 *  - My tasks: outstanding, overdue / past SLA, a completed-per-day
 *    sparkline and the on-time meter.
 *  - My decisions: approval rate and the outcome bar.
 *  - My submissions: in progress, the status bar and the median end-to-end time.
 *  - Following: active processes, updated today and an active / finished bar.
 */
export function MetricWidget({ which }: { which: "tasks" | "decisions" | "submissions" | "following" }) {
  if (which === "tasks") return <TasksCard />
  if (which === "decisions") return <DecisionsCard />
  if (which === "submissions") return <SubmissionsCard />
  return <FollowingCard />
}

/* ── Shell ───────────────────────────────────────────────────────────── */

interface TopCardProps {
  widget: HomeWidgetId
  testId: string
  icon: LucideIcon
  title: string
  info?: string
  value: ReactNode
  unit?: ReactNode
  /** Spoken form of the value ("14 outstanding"). */
  spoken: string
  loading?: boolean
  failed?: boolean
  refreshing?: boolean
  chips?: ReactNode
  graphic?: ReactNode
  meta?: ReactNode
  details?: ReactNode
  /** Opens the card's tab in the task list. */
  onOpen?: () => void
}

function TopCard({ widget, testId, icon: Icon, title, info, value, unit, spoken, loading, failed, refreshing, chips, graphic, meta, details, onOpen }: TopCardProps) {
  const { isExpanded, toggleExpanded, reportHeight } = useHome()
  const id = useId()
  const contentRef = useRef<HTMLDivElement>(null)
  const last = useRef<number | null>(null)
  const canExpand = !loading && !failed && details != null
  const open = canExpand && isExpanded(widget)

  // Only an expanded card reports its height (collapsed, the grid sizes it); sub-pixel wobble is ignored.
  useEffect(() => {
    const el = contentRef.current
    if (!el || !open) return
    const report = () => {
      const next = nextStableHeight(last.current, el.offsetHeight + 2)
      if (next === null) return
      last.current = next
      reportHeight(widget, next)
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => { ro.disconnect(); last.current = null }
  }, [open, reportHeight, widget])

  const headline = (
    <span className="flex min-w-0 items-baseline gap-1.5">
      {loading ? <Skeleton className="h-7 w-14" /> : <span className="num shrink-0 text-metric text-fg" data-metric-value>{failed ? "—" : value}</span>}
      {unit != null && <span className="truncate text-sm text-fg-muted">{unit}</span>}
    </span>
  )

  return (
    <section
      className={cn("h-full min-w-0 rounded-lg border border-border bg-panel text-fg transition-[opacity,border-color] duration-[var(--ds-dur-fast)] hover:border-border-strong", refreshing && "opacity-60")}
      aria-labelledby={`${id}-title`} aria-busy={refreshing || loading || undefined} data-testid={testId} data-compact-card data-expanded={open || undefined}
    >
      <div ref={contentRef} className={cn("flex min-w-0 flex-col gap-2 p-4", !open && "h-full")}>
        <header className="flex min-w-0 items-center justify-between gap-2">
          <h3 id={`${id}-title`} className="flex min-w-0 items-center gap-1.5 text-ui font-medium text-fg-muted">
            <Icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{title}</span>
            {info && <InfoTip text={info} label={`How ${title.toLowerCase()} is measured`} />}
          </h3>
          {canExpand && (
            <IconButton size="sm" onClick={() => toggleExpanded(widget)} aria-expanded={open} aria-controls={`${id}-details`}
              label={`${open ? "Hide" : "Show"} details: ${title}`} className="-my-1 -mr-1 shrink-0"
              icon={<ChevronDown className={cn("transition-transform duration-[var(--ds-dur-base)]", open && "rotate-180")} />} data-compact-toggle />
          )}
        </header>
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {onOpen ? (
            <button type="button" onClick={onOpen} className="-mx-1 min-w-0 rounded-md px-1 text-left hover:bg-subtle"
              aria-label={`${title}: ${loading ? "loading" : failed ? "unavailable" : spoken}. Show the list`} data-metric-open>
              {headline}
            </button>
          ) : headline}
          {chips}
        </div>
        {failed ? (
          <p className="text-xs text-fg-muted">Couldn’t load. Try again later.</p>
        ) : loading ? (
          <Skeleton className="h-2 w-full" />
        ) : graphic != null ? (
          <div className="min-w-0" data-metric-graphic>{graphic}</div>
        ) : null}
        {!failed && !loading && meta != null && <p className="mt-auto truncate text-xs text-fg-muted" data-metric-meta>{meta}</p>}
        {canExpand && (
          <div id={`${id}-details`} hidden={!open} className="space-y-2 pt-1" data-compact-details>{details}</div>
        )}
      </div>
    </section>
  )
}

function Details({ table, notes }: { table: ChartTable; notes?: ReactNode }) {
  const id = useId()
  return (
    <>
      <ChartDataTable id={id} table={table} />
      {notes ? <p className="text-xs text-fg-muted">{notes}</p> : null}
    </>
  )
}

/** Completed tasks per day / week as tiny columns (24px), with an accessible summary. */
function Sparkline({ values, color, label }: { values: number[]; color: string; label: string }) {
  const max = Math.max(1, ...values)
  const n = Math.max(values.length, 1)
  return (
    <svg viewBox={`0 0 ${n * 4} 24`} preserveAspectRatio="none" className="block h-6 w-full" role="img" aria-label={label} data-sparkline>
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(1.5, (v / max) * 24) : 0.75
        return <rect key={i} x={i * 4 + 0.5} y={24 - h} width={3} height={h} rx={0.75} fill={v > 0 ? color : "var(--ds-bg-muted)"} />
      })}
    </svg>
  )
}

/* ── My tasks ────────────────────────────────────────────────────────── */

const ON_TIME_RULE = "Tasks with a due date (or a process SLA) completed in the period: on time when completed at or before it. Tasks with neither are left out of the share."

function TasksCard() {
  const { can } = usePermissions()
  const { openTab } = useHome()
  const tasks = useQuery({ queryKey: [...HOME_QUERY_KEY, "metrics", "tasks"], queryFn: () => serverQuery("home.taskMetrics"), enabled: can("tasks.view_own"), staleTime: 30_000 })
  const stats = useActivityStats()
  const t = tasks.data
  const s = stats.data?.tasks ?? null
  const [spark, onColor, lateColor] = useSlots([{ role: "series", prefer: 0 }, { role: "success" }, { role: "danger" }])
  const o = s?.on_time
  const days = s?.period.days
  const chips = t ? (
    <>
      {t.overdue > 0 && <Badge tone="danger" data-metric-overdue>{formatCount(t.overdue)} overdue</Badge>}
      {t.sla_breached > 0 && <Badge tone="danger">{formatCount(t.sla_breached)} past SLA</Badge>}
    </>
  ) : null
  const graphic = s ? (
    <div className="space-y-2">
      <Sparkline values={s.completed.buckets.map((b) => b.count)} color={spark}
        label={`Tasks completed per ${s.period.unit} over ${periodWords(s.period.days)}: ${formatCount(s.completed.total)} in total`} />
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <SegmentedBar total={o!.with_deadline} label="Tasks on time and late" legend={false} segments={[
            { key: "on_time", label: "On time", value: o!.on_time, color: onColor, icon: <CheckCircle2 size={12} aria-hidden /> },
            { key: "late", label: "Late", value: o!.late, color: lateColor, icon: <AlertCircle size={12} aria-hidden /> },
          ]} />
        </div>
        <span className="num shrink-0 text-xs text-fg-muted" data-on-time>{o!.with_deadline ? `${formatShare(o!.rate)} on time` : "No deadlines"}</span>
      </div>
    </div>
  ) : null
  const completed = s ? s.completed.total : t?.completed_30d
  const meta = t ? [
    `${formatCount(completed ?? 0)} completed in ${periodWords(days ?? 30)}`,
    t.queue ? `${formatCount(t.queue)} queued for you` : null,
  ].filter(Boolean).join(" · ") : null
  return (
    <TopCard widget="metric.tasks" testId="metric-tasks" icon={CheckSquare} title="My tasks" info={ON_TIME_RULE}
      value={formatCount(t?.open ?? 0)} unit="outstanding" spoken={`${t?.open ?? 0} outstanding`}
      loading={tasks.isPending} failed={tasks.isError} refreshing={stats.isFetching && stats.isPlaceholderData}
      chips={chips} graphic={graphic} meta={meta} onOpen={() => openTab("tasks")}
      details={s && o ? (
        <Details table={{ caption: "Tasks by deadline", columns: ["", "Tasks"], rows: [
          ["On time", formatCount(o.on_time)], ["Late", formatCount(o.late)], ["No deadline", formatCount(o.no_deadline)],
          [`Completed in ${periodWords(s.period.days)}`, formatCount(s.completed.total)],
        ] }} notes={o.no_deadline ? `${formatCount(o.no_deadline)} without a due date or SLA (not in the on-time share).` : null} />
      ) : undefined} />
  )
}

/* ── My decisions ────────────────────────────────────────────────────── */

function DecisionsCard() {
  const stats = useActivityStats()
  const s = stats.data?.tasks ?? null
  if (!s) {
    return <TopCard widget="chart.decisions" testId="activity-decisions" icon={Scale} title="My decisions" value="—" spoken="loading"
      loading={stats.isPending} failed={stats.isError || (!stats.isPending && !s)} />
  }
  return <DecisionsCardBody stats={s} refreshing={stats.isFetching && stats.isPlaceholderData} />
}

function DecisionsCardBody({ stats, refreshing }: { stats: HomeTaskStats; refreshing: boolean }) {
  const { isExpanded } = useHome()
  const d = stats.decisions
  const segments = useDecisionSegments(d)
  const days = stats.period.days
  const nonDecision = d.non_decision > 0
    ? `Plus ${formatCount(d.non_decision)} completed without a decision${d.non_decision_labels.length ? ` (${d.non_decision_labels.join(", ")})` : ""}.`
    : null
  return (
    <TopCard widget="chart.decisions" testId="activity-decisions" icon={Scale} title="My decisions" info={APPROVAL_RULE} refreshing={refreshing}
      value={d.total ? formatShare(d.approval_rate) : "—"} unit="approved" spoken={d.total ? `${formatShare(d.approval_rate)} approved` : "no decisions"}
      graphic={d.total
        ? <SegmentedBar segments={segments} total={d.total} label="Decisions by outcome" legend={isExpanded("chart.decisions") ? true : "line"} />
        : <p className="truncate text-xs text-fg-muted" data-chart-empty>No decisions in {periodWords(days)}</p>}
      meta={d.total ? `${formatCount(d.total)} decision${d.total === 1 ? "" : "s"} in ${periodWords(days)}` : nonDecision}
      details={d.total ? (
        <Details table={{ caption: "Decisions by outcome", columns: ["Outcome", "Tasks", "Share"], rows: d.groups.map((g) => [g.label, formatCount(g.count), formatShare(d.total ? g.count / d.total : 0)]) }}
          notes={nonDecision} />
      ) : undefined} />
  )
}

/* ── My submissions ──────────────────────────────────────────────────── */

const SUBMISSIONS_RULE = "In progress: forms you submitted whose process is still running. The bar shows the forms you submitted in the period by the status of the process each one started; end-to-end time runs from submitting to that process completing."

function SubmissionsCard() {
  const { can } = usePermissions()
  const { openTab, isExpanded } = useHome()
  const subs = useQuery({ queryKey: [...HOME_QUERY_KEY, "metrics", "submissions"], queryFn: () => serverQuery("home.submissionMetrics"), enabled: can("forms.submit"), staleTime: 30_000 })
  const stats = useActivityStats()
  const s = stats.data?.submissions ?? null
  const [done, failed, live, cancelled] = useSlots([{ role: "success" }, { role: "danger" }, { role: "series", prefer: 0 }, { role: "neutral" }])
  const segments: Segment[] = s ? [
    { key: "completed", label: "Completed", value: s.completed, color: done, icon: <CheckCircle2 size={12} aria-hidden /> },
    { key: "in_progress", label: "In progress", value: s.in_progress, color: live },
    { key: "failed", label: "Failed", value: s.failed, color: failed, icon: <XCircle size={12} aria-hidden /> },
    { key: "cancelled", label: "Cancelled", value: s.cancelled, color: cancelled },
  ] : []
  const withProcess = s ? s.completed + s.in_progress + s.failed + s.cancelled : 0
  const meta = s ? [
    `${formatCount(s.total)} submitted in ${periodWords(s.days)}`,
    s.median_s !== null ? `median ${humaniseDuration(s.median_s)} end to end` : null,
  ].filter(Boolean).join(" · ") : subs.data ? `${formatCount(subs.data.completed_30d)} completed in the last 30 days` : null
  return (
    <TopCard widget="metric.submissions" testId="metric-submissions" icon={Inbox} title="My submissions" info={SUBMISSIONS_RULE}
      value={formatCount(subs.data?.in_progress ?? 0)} unit="in progress" spoken={`${subs.data?.in_progress ?? 0} in progress`}
      loading={subs.isPending} failed={subs.isError} refreshing={stats.isFetching && stats.isPlaceholderData}
      graphic={s ? (withProcess > 0
        ? <SegmentedBar segments={segments} total={withProcess} label="Submissions by process status" legend={isExpanded("metric.submissions") ? true : "line"} />
        : <p className="truncate text-xs text-fg-muted" data-chart-empty>{s.total ? "None of these started a process" : `No form submissions in ${periodWords(s.days)}`}</p>) : null}
      meta={meta} onOpen={() => openTab("submissions")}
      details={s && s.total ? (
        <Details table={{ caption: "Submissions by process status", columns: ["Status", "Submissions"], rows: [...segments.map((x) => [x.label, formatCount(x.value)]), ["No process", formatCount(s.no_process)]] }}
          notes={s.median_s !== null ? `p90 end to end ${humaniseDuration(s.p90_s)}.` : null} />
      ) : undefined} />
  )
}

/* ── Following ───────────────────────────────────────────────────────── */

function FollowingCard() {
  const { openTab, isExpanded } = useHome()
  const follow = useQuery({ queryKey: [...HOME_QUERY_KEY, "metrics", "following"], queryFn: () => serverQuery("home.followMetrics"), staleTime: 30_000 })
  const f = follow.data
  const [activeColor, finishedColor] = useSlots([{ role: "series", prefer: 1 }, { role: "neutral" }])
  const finished = f ? Math.max(0, f.total - f.active) : 0
  const segments: Segment[] = f ? [
    { key: "active", label: "Active", value: f.active, color: activeColor },
    { key: "finished", label: "Finished", value: finished, color: finishedColor },
  ] : []
  return (
    <TopCard widget="metric.following" testId="metric-following" icon={Bell} title="Following"
      value={formatCount(f?.active ?? 0)} unit="active processes" spoken={`${f?.active ?? 0} active processes`}
      loading={follow.isPending} failed={follow.isError}
      chips={f && f.updated_today > 0 ? <Badge tone="info">{formatCount(f.updated_today)} updated today</Badge> : null}
      graphic={f ? (f.total > 0
        ? <SegmentedBar segments={segments} total={f.total} label="Followed processes by status" legend={isExpanded("metric.following") ? true : "line"} />
        : <p className="truncate text-xs text-fg-muted">You’re not following any processes</p>) : null}
      meta={f ? `${formatCount(f.total)} followed · ${formatCount(f.updated_today)} updated today` : null}
      onOpen={() => openTab("following")}
      details={f && f.total > 0 ? (
        <Details table={{ caption: "Followed processes", columns: ["", "Processes"], rows: [["Active", formatCount(f.active)], ["Finished", formatCount(finished)], ["Updated today", formatCount(f.updated_today)]] }} />
      ) : undefined} />
  )
}
