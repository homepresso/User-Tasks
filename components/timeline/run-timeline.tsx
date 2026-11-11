"use client"

import { useMemo, useState, type ReactNode } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowRightLeft, Bell, Bot, Check, ChevronRight, CircleStop, Clock, Cog, Copy, Database, Eye, FileText, Flag, GitBranch,
  History, Hourglass, ListChecks, Mail, MessageSquare, Paperclip, Pause, Play, Plug, Printer, Save, Share2, Table2, Timer,
  TriangleAlert, UserRound, Workflow, X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { serverRead } from "@/lib/server-read"
import { Avatar } from "@/components/ui/avatar"
import { Badge, StatusPill, TONE_CLASSES } from "@/components/ui/badge"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/tooltip"
import { formatAbsolute, formatDay, formatRelative, formatTime, toDate } from "@/lib/format/date"
import { processViewPollMs } from "@/lib/automations/process-view-poll"
import {
  filterTimeline, formatGap, timelineAsText, TIMELINE_FILTERS,
  type RunTimeline as RunTimelineData, type TimelineCategory, type TimelineEvent, type TimelineIcon, type TimelineTarget,
} from "@/lib/run-timeline"

const SubmissionDialog = dynamic(() => import("@/components/home/submission-dialog").then((m) => m.SubmissionDialog))

const ICONS: Record<TimelineIcon, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  play: Play, form: FileText, user: UserRound, check: Check, x: X, message: MessageSquare, mail: Mail, database: Database,
  branch: GitBranch, clock: Clock, workflow: Workflow, alert: TriangleAlert, paperclip: Paperclip, list: ListChecks,
  share: Share2, flag: Flag, hourglass: Hourglass, bot: Bot, pause: Pause, arrow: ArrowRightLeft, cog: Cog, rules: Table2,
  bell: Bell, plug: Plug, save: Save, timer: Timer, stop: CircleStop,
}

export function timelineQueryKey(target: TimelineTarget) {
  return ["timeline", target.runId ? "run" : "task", target.runId ?? target.taskId] as const
}

/** Read the timeline; polls while the run moves (processViewPollMs). */
export function useTimeline(target: TimelineTarget, enabled = true) {
  return useQuery({
    queryKey: timelineQueryKey(target),
    enabled,
    queryFn: async () => {
      const result = await serverRead("automations.timeline", target.runId ? { runId: target.runId } : { taskId: target.taskId })
      if (result.error) throw new Error(result.error.status === 404 ? "This timeline isn’t available to you." : result.error.message)
      return result.data as RunTimelineData
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => {
      const data = query.state.data as RunTimelineData | undefined
      if (!data?.live) return false
      return data.kind === "run" ? processViewPollMs(data.header.status) : 30_000
    },
    meta: { persist: false },
  })
}

/** "Today", "Yesterday", "Mon 9 Nov". */
function dayLabel(iso: string | null, now = new Date()): string {
  const d = toDate(iso)
  if (!d) return "Earlier"
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(now) - start(d)) / 86_400_000)
  if (days === 0) return "Today"
  if (days === 1) return "Yesterday"
  return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${formatDay(d)}`
}

function groupByDay(events: TimelineEvent[]): Array<{ label: string; events: TimelineEvent[] }> {
  const out: Array<{ label: string; events: TimelineEvent[] }> = []
  let lastAt: string | null = null
  for (const e of events) {
    const at = e.at ?? lastAt
    const label = dayLabel(at)
    if (e.at) lastAt = e.at
    const group = out[out.length - 1]
    if (group && group.label === label) group.events.push(e)
    else out.push({ label, events: [e] })
  }
  return out
}

function When({ at, className }: { at: string | null; className?: string }) {
  if (!at) return null
  return (
    <Tooltip content={formatAbsolute(at)}>
      <time dateTime={at} className={cn("num shrink-0 text-xs text-fg-muted", className)}>
        {formatTime(at)} · {formatRelative(at)}
      </time>
    </Tooltip>
  )
}

function EventDot({ event }: { event: TimelineEvent }) {
  const Icon = ICONS[event.icon] ?? Cog
  const tone = TONE_CLASSES[event.tone] ?? TONE_CLASSES.neutral
  const small = event.category === "system" && event.kind !== "error" && event.kind !== "now"
  return (
    <span aria-hidden className={cn(
      "relative z-[1] flex shrink-0 items-center justify-center rounded-full ring-4 ring-panel print:ring-0",
      small ? "mt-0.5 size-6" : "size-7",
      tone.bg, tone.text,
      event.highlight && "ring-warning-wash",
    )}>
      <Icon className={small ? "size-3" : "size-3.5"} aria-hidden />
    </span>
  )
}

function EventRow({ event, onSubmission, depth = 0 }: { event: TimelineEvent; onSubmission: (s: NonNullable<TimelineEvent["submission"]>) => void; depth?: number }) {
  const [open, setOpen] = useState(false)
  const childId = `tl-children-${event.id.replace(/[^a-z0-9_-]/gi, "-")}`
  const isSystem = event.category === "system" && event.kind !== "error"
  const showActor = Boolean(event.actor) && !isSystem && event.kind !== "comment" && !event.title.includes(event.actor!.name)
  return (
    <li className={cn("relative flex gap-3", depth === 0 ? "pb-4" : "pb-2")} data-timeline-event={event.kind} data-timeline-id={event.id}>
      <EventDot event={event} />
      <div className={cn("min-w-0 flex-1", event.highlight && "rounded-md bg-warning-wash/60 px-3 py-2 -mt-1 -ml-1")}>
        {event.since_previous_ms != null && depth === 0 && (
          <p className="-mt-0.5 mb-0.5 text-[11px] font-medium uppercase tracking-wide text-fg-subtle" data-timeline-gap>{formatGap(event.since_previous_ms)} later</p>
        )}
        <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
          <div className="min-w-0 flex-1">
            <p className={cn("text-ui", isSystem ? "text-fg-muted" : "font-medium text-fg")}>
              {event.kind === "now" && <span className="mr-1.5 font-semibold text-warning">Now:</span>}
              {event.title}
              {event.badge && <Badge tone={event.badge.tone} pill dot className="ml-2 align-middle" data-timeline-outcome>{event.badge.label}</Badge>}
            </p>
            {(event.step || showActor || event.on_behalf_of || event.via) && (
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
                {showActor && event.actor && (
                  <span className="inline-flex items-center gap-1.5"><Avatar name={event.actor.name} src={event.actor.avatar_url} size="sm" className="!size-5 text-[9px]" />{event.actor.name}</span>
                )}
                {event.step && <span>{event.step}</span>}
                {event.on_behalf_of && <Badge tone="info" data-timeline-behalf>on behalf of {event.on_behalf_of.name}</Badge>}
                {event.via && <Badge tone="brand">via {event.via}</Badge>}
              </p>
            )}
          </div>
          {depth === 0 && <When at={event.at} className="pt-0.5" />}
        </div>
        {event.kind === "comment" && event.body ? (
          <div className="mt-1.5 flex items-start gap-2" data-timeline-comment>
            {event.actor && <Avatar name={event.actor.name} src={event.actor.avatar_url} size="sm" />}
            <p className="relative min-w-0 flex-1 whitespace-pre-wrap break-words rounded-lg rounded-tl-sm bg-subtle px-3 py-2 text-ui text-fg">{event.body}</p>
          </div>
        ) : event.body ? (
          <p className={cn("mt-1 whitespace-pre-wrap break-words text-ui", event.kind === "outcome" ? "rounded-md border-l-2 border-border bg-subtle px-3 py-1.5 text-fg" : event.kind === "error" ? "font-mono text-xs text-danger" : "text-fg-muted")}>{event.body}</p>
        ) : null}
        {event.note && <p className="mt-1 text-xs text-fg-muted">Reason: {event.note}</p>}
        {event.due_date && event.kind !== "outcome" && (() => {
          // Overdue only matters while it is still waiting (the Now line, or an open task's assignment).
          const overdue = (event.kind === "now" || event.tone === "warning") && (toDate(event.due_date)?.getTime() ?? Infinity) < Date.now()
          return (
            <p className={cn("mt-0.5 text-xs", overdue ? "font-medium text-danger" : "text-fg-muted")} data-timeline-due={overdue ? "overdue" : undefined}>
              {overdue ? "Overdue · due " : "Due "}<Tooltip content={formatAbsolute(event.due_date)}><time dateTime={event.due_date}>{lowerFirst(formatRelative(event.due_date))}</time></Tooltip>
            </p>
          )
        })()}
        {event.fields && event.fields.length > 0 && (
          <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 rounded-md bg-subtle px-3 py-2 text-xs" data-timeline-fields>
            {event.fields.map((f) => (<FieldRow key={f.label} label={f.label} value={f.value} />))}
          </dl>
        )}
        {(event.links?.length || event.submission) ? (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-xs print:hidden">
            {event.submission && (
              <button type="button" onClick={() => onSubmission(event.submission!)} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-timeline-submission>
                <Eye className="size-3.5" aria-hidden /> View submission
              </button>
            )}
            {event.links?.map((l) => (
              <Link key={l.href} href={l.href} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline">{l.label}<ChevronRight className="size-3" aria-hidden /></Link>
            ))}
          </div>
        ) : null}
        {event.children && event.children.length > 0 && (
          <div className="mt-1">
            <button type="button" aria-expanded={open} aria-controls={childId} onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded text-xs font-medium text-fg-muted hover:text-fg print:hidden" data-timeline-expand>
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} aria-hidden />
              {open ? "Hide steps" : event.kind === "subworkflow" ? `Show its ${event.children.length} step${event.children.length === 1 ? "" : "s"}` : "Show steps"}
            </button>
            <ol id={childId} hidden={!open} className="mt-2 border-l border-border-subtle pl-3 print:block" aria-label={`${event.title}: steps`}>
              {event.children.map((c) => <EventRow key={c.id} event={c} onSubmission={onSubmission} depth={depth + 1} />)}
            </ol>
          </div>
        )}
      </div>
    </li>
  )
}

const lowerFirst = (s: string) => (/^(Yesterday|Tomorrow|Just now)$/.test(s) ? s.toLowerCase() : s)

function FieldRow({ label, value }: { label: string; value: string }) {
  return (<><dt className="text-fg-muted">{label}</dt><dd className="min-w-0 truncate font-medium text-fg" title={value}>{value}</dd></>)
}

function TimelineHeaderCard({ data, actions }: { data: RunTimelineData; actions?: ReactNode }) {
  const h = data.header
  return (
    <div className="rounded-lg border border-border bg-panel p-4" data-timeline-header>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {h.workflow && <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">{h.workflow.name}{h.version ? ` · v${h.version}` : ""}</p>}
          <h2 className="mt-0.5 break-words text-base font-semibold text-fg">{h.title ?? h.workflow?.name ?? "Timeline"}</h2>
        </div>
        <StatusPill status={h.status === "waiting" ? "waiting_for_event" : h.status} label={h.status_label} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
        <div className="min-w-0">
          <dt className="text-fg-muted">Started by</dt>
          <dd className="mt-0.5 flex min-w-0 items-center gap-1.5 font-medium text-fg">
            {h.started_by ? <><Avatar name={h.started_by.name} src={h.started_by.avatar_url} size="sm" className="!size-5 text-[9px]" /><span className="truncate">{h.started_by.name}</span></> : <span className="truncate" title={h.started_how ?? undefined}>{h.started_how && /anonymously$/.test(h.started_how) ? "Anonymous" : h.started_how ?? "—"}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-fg-muted">Started</dt>
          <dd className="mt-0.5 font-medium text-fg">{h.started_at ? <Tooltip content={formatAbsolute(h.started_at)}><time dateTime={h.started_at}>{formatRelative(h.started_at)}</time></Tooltip> : "—"}</dd>
        </div>
        <div>
          <dt className="text-fg-muted">{data.live ? "Running for" : "Took"}</dt>
          <dd className="num mt-0.5 font-medium text-fg">{h.duration_ms != null ? formatGap(h.duration_ms) || "under 1 s" : "—"}</dd>
        </div>
        {h.reference && (
          <div>
            <dt className="text-fg-muted">Reference</dt>
            <dd className="mt-0.5 truncate font-mono font-medium text-fg">{h.reference}</dd>
          </div>
        )}
      </dl>
      {h.current && (
        <p className={cn("mt-3 rounded-md px-3 py-2 text-ui", data.live ? "bg-warning-wash text-fg" : "bg-subtle text-fg")} data-timeline-current>
          <span className="font-semibold">{data.live ? "Now: " : "Result: "}</span>{h.current}
        </p>
      )}
      {actions && <div className="mt-3 flex flex-wrap gap-2 print:hidden">{actions}</div>}
    </div>
  )
}

export interface RunTimelineProps {
  target: TimelineTarget
  /** Hide the summary card (a page that has its own header). */
  showHeader?: boolean
  /** Links to the process view / full page in the header. */
  showLinks?: boolean
  className?: string
}

/** The full timeline: header summary, filter chips, the day-grouped list. */
export function RunTimeline({ target, showHeader = true, showLinks = true, className }: RunTimelineProps) {
  const { data, isPending, error } = useTimeline(target)
  const [filter, setFilter] = useState<"all" | TimelineCategory>("all")
  const [copied, setCopied] = useState(false)
  const [submission, setSubmission] = useState<NonNullable<TimelineEvent["submission"]> | null>(null)
  const shown = useMemo(() => (data ? filterTimeline(data.events, filter) : []), [data, filter])
  const days = useMemo(() => groupByDay(shown), [shown])

  if (isPending) {
    return (
      <div className={cn("space-y-3", className)} aria-busy="true">
        <Skeleton className="h-28 w-full" />
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    )
  }
  if (error || !data) {
    return <EmptyState variant="error" size="sm" title="Timeline not available" description={(error as Error | null)?.message ?? "Not found"} />
  }

  const counts = Object.fromEntries(TIMELINE_FILTERS.map((f) => [f.value, f.value === "all" ? data.events.length : data.events.filter((e) => e.category === f.value).length]))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(timelineAsText(data, (iso) => formatAbsolute(iso)))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }
  const actions = (
    <>
      {showLinks && data.links.process && (
        <Link href={data.links.process} className={buttonVariants({ variant: "secondary", size: "sm" })}><Workflow className="size-3.5" aria-hidden /> Process view</Link>
      )}
      {showLinks && data.links.task && data.focus_task_id && (
        <Link href={data.links.task} className={buttonVariants({ variant: "ghost", size: "sm" })}>Open task</Link>
      )}
      <Button size="sm" variant="ghost" leadingIcon={copied ? <Check /> : <Copy />} onClick={() => { void copy() }} data-timeline-copy>{copied ? "Copied" : "Copy as text"}</Button>
      <Button size="sm" variant="ghost" leadingIcon={<Printer />} onClick={() => window.print()}>Print</Button>
    </>
  )

  return (
    <section className={cn("space-y-4", className)} aria-label="Timeline" data-timeline={data.run_id ?? data.task_id} data-timeline-detail={data.detail}>
      {showHeader ? <TimelineHeaderCard data={data} actions={actions} /> : <div className="flex flex-wrap justify-end gap-2 print:hidden">{actions}</div>}
      {data.kind === "task" && data.run_id && (
        <p className="text-xs text-fg-muted">This task’s own history. The rest of its process isn’t shared with you.</p>
      )}
      <div role="group" aria-label="Show" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] print:hidden" data-timeline-filters>
        {TIMELINE_FILTERS.map((f) => (
          <button key={f.value} type="button" aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}
            className={cn("h-7 shrink-0 rounded-full border px-3 text-xs font-medium transition-colors",
              filter === f.value ? "border-transparent bg-primary-wash text-primary-text" : "border-border bg-panel text-fg-muted hover:text-fg")}>
            {f.label}{f.value !== "all" && counts[f.value] ? <span className="num ml-1 opacity-70">{counts[f.value]}</span> : null}
          </button>
        ))}
      </div>
      {days.length === 0 ? (
        <p className="text-ui text-fg-muted">Nothing here for this filter.</p>
      ) : days.map((day, i) => (
        <div key={`${day.label}-${i}`}>
          <h3 className="mb-2 py-1 text-xs font-semibold uppercase tracking-wide text-fg-muted">{day.label}</h3>
          <ol className="relative before:absolute before:bottom-4 before:left-[13px] before:top-3 before:w-px before:bg-border" aria-label={day.label}>
            {day.events.map((e) => <EventRow key={e.id} event={e} onSubmission={setSubmission} />)}
          </ol>
        </div>
      ))}
      {submission && <SubmissionDialog submission={submission} onClose={() => setSubmission(null)} />}
    </section>
  )
}

/** Task page Details tab: the last few events and "View full timeline". */
export function RecentActivity({ target, limit = 3, onOpen }: { target: TimelineTarget; limit?: number; onOpen: () => void }) {
  const { data, isPending, error } = useTimeline(target)
  if (error) return null
  const recent = data ? data.events.filter((e) => e.kind !== "system_group" && e.category !== "system").slice(-limit).reverse() : []
  return (
    <div className="rounded-lg border border-border bg-panel p-4" data-timeline-recent>
      <div className="mb-3 flex items-center gap-2">
        <History className="size-4 text-fg-muted" aria-hidden />
        <h2 className="flex-1 text-base font-semibold text-fg">Recent activity</h2>
        <Button size="sm" variant="ghost" onClick={onOpen} data-timeline-open-full>View full timeline</Button>
      </div>
      {isPending ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
      ) : (
        <ol className="space-y-2.5">
          {recent.map((e) => {
            const Icon = ICONS[e.icon] ?? Cog
            return (
              <li key={e.id} className="flex items-start gap-2.5 text-ui">
                <span aria-hidden className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", TONE_CLASSES[e.tone].bg, TONE_CLASSES[e.tone].text)}><Icon className="size-3" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fg">{e.kind === "now" ? "Now: " : ""}{e.title}{e.badge ? <Badge tone={e.badge.tone} pill className="ml-1.5 align-middle">{e.badge.label}</Badge> : null}</p>
                  {e.kind === "comment" && e.body && <p className="truncate text-xs text-fg-muted">“{e.body}”</p>}
                </div>
                {e.at && <time dateTime={e.at} className="shrink-0 text-xs text-fg-muted">{formatRelative(e.at)}</time>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
