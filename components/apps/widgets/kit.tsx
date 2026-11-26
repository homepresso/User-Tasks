"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ArrowRight, ExternalLink, Inbox, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { DialogBody } from "@/components/ui/dialog"
import { Tooltip } from "@/components/ui/tooltip"
import { TaskTags } from "@/components/tasks/task-tags"
import { TaskQuickView } from "../task-quick-view"
import { claimTask } from "@/app/actions/home"
import type { PreviewArgs } from "@/lib/apps/versions"
import { claimNextAppTask } from "@/app/actions/apps"
import { defaultActions, nextFilterValue, type AppAction, type AppEvent } from "@/lib/apps/events"
import { needsUser, resolveParams } from "@/lib/apps/params"
import { useOpenTarget } from "../panels"
import { useAppRuntime, type AppRuntime } from "../runtime"
import { serverQuery } from "@/lib/server-read"
import { formatCount } from "@/lib/format/number"
import { formatDurationParts } from "@/lib/format/duration"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { filterParam, type FilterValues } from "@/lib/apps/widgets"
import type { AppWidget, ClickTarget, DateRangeValue, PageFilter } from "@/lib/apps/schema"
import type { WidgetData, WidgetTask } from "@/lib/services/app-widgets"
import { cn } from "@/lib/utils"
import { rowsToShow } from "@/lib/apps/grid"
import { PriorityMark } from "@/components/ui/priority-badge"

/**
 * Shared pieces of the app widgets: the data read (ui-read apps.widget, as
 * the viewer; `params` for search / paging / month), loading / empty /
 * error states, click-through (set a page filter, or open another page with
 * that filter in the URL), task rows with the quick-view drawer, sparklines.
 */

export interface WidgetContext {
  app: string
  page: string
  filters: FilterValues
  /** Builder: read with this (unsaved) config. */
  preview?: boolean
  embed?: boolean
  /** The app's slug and the route base (/apps or /embed/apps), for links to pages. */
  appSlug?: string
  base?: string
  /** The page's filters (kinds, for click-through values). */
  filterDefs?: readonly PageFilter[]
  /** Set a page filter (click-through); absent in read-only previews. */
  setFilter?: (id: string, value: FilterValues[string]) => void
  /** Editors previewing the draft (and / or as a lower role): sent with every read and action so the server uses the same version. */
  previewArgs?: PreviewArgs
  /** The viewer's app role. */
  role?: "editor" | "contributor" | "viewer"
  /** Other widgets of the page by id (tabs / section containers draw their children). */
  widgets?: ReadonlyMap<string, AppWidget>
  /** Draws a child widget (containers). */
  renderChild?: (widget: AppWidget) => ReactNode
  /** Draws another page of the app in place (tab targets). */
  renderPage?: (slug: string, filters: Record<string, string>) => ReactNode
}

export type DataOf<T extends string> = Extract<WidgetData, { type: T }>
export interface Params { q?: string; page?: number; month?: string; row?: string; tab?: number; sort?: string; dir?: "asc" | "desc"; cols?: string[]; eq?: Array<{ column: string; value: string }> }

export function useWidgetData(widget: AppWidget, context: WidgetContext, params?: Params) {
  const query = useQuery({
    queryKey: ["apps", "widget", context.app, context.page, widget.id, context.filters, context.preview ? widget.config : null, params ?? null, context.previewArgs ?? null],
    queryFn: async () => (await serverQuery("apps.widget", {
      app: context.app, page: context.page, widget_id: widget.id, filters: context.filters as never,
      preview: context.preview ? { type: widget.type, config: widget.config } : null,
      ...(context.previewArgs ?? {}),
      ...(params && Object.keys(params).length ? { params } : {}),
    })) as WidgetData,
    staleTime: 30_000,
    retry: false,
    placeholderData: params ? keepPreviousData : undefined,
  })
  // The widget's header menu (Refresh, last updated, Download CSV) reads what the body loaded.
  const meta = useContext(WidgetMetaContext)
  const { data, dataUpdatedAt, refetch, isFetching } = query
  useEffect(() => { meta?.report({ data: data ?? null, updatedAt: dataUpdatedAt || null, refetch: () => void refetch(), fetching: isFetching }) }, [meta, data, dataUpdatedAt, refetch, isFetching])
  return query
}

/* ── Widget meta (header menu) and content budget ────────────────────── */

export interface WidgetMeta { data: WidgetData | null; updatedAt: number | null; refetch: () => void; fetching: boolean }
/** Set by WidgetBody: data widgets report what they loaded (for Refresh / Updated … / Download CSV in the header menu). */
export const WidgetMetaContext = createContext<{ report: (m: WidgetMeta) => void } | null>(null)

/**
 * How much room a list has before it must stop adding rows (px of content,
 * below the title bar): fixed and legacy cards show the rows that fit and a
 * "View all (n)" link — never a row cut in half; auto-height cards (and
 * phones, where cards take their content's height) show every row and the
 * card scrolls past its cap. Infinity = no limit.
 */
export const ContentBudgetContext = createContext<number>(Number.POSITIVE_INFINITY)
export function useContentBudget(): number { return useContext(ContentBudgetContext) }

export { LIST_ROW_PX, contentBudgetForRows, rowsToShow } from "@/lib/apps/grid"

export function useRefreshWidgets(app: string) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ["apps", "widget", app] })
}

/** The compact empty state every widget shares: an icon chip, one line, an optional action — sized to fit (no tall, sparse cards). */
export function Empty({ text, icon, action }: { text: string; icon?: ReactNode; action?: { label: string; onClick?: () => void; href?: string } }) {
  return (
    <div className="flex h-full min-h-12 items-center justify-center gap-2.5 px-2 py-2 text-left" data-widget-empty>
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-fg-subtle [&_svg]:size-4" aria-hidden>{icon ?? <Inbox />}</span>
      <p className="min-w-0 text-ui text-fg-muted">{text}</p>
      {action && (action.href
        ? <Link href={action.href} className="shrink-0 text-ui font-medium text-primary-text hover:underline">{action.label}</Link>
        : <Button size="sm" variant="ghost" onClick={action.onClick} className="shrink-0">{action.label}</Button>)}
    </div>
  )
}

export function WidgetError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex h-full min-h-12 flex-wrap items-center justify-center gap-2.5 px-2 py-2" role="alert" data-widget-error>
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-danger-wash text-danger" aria-hidden><AlertTriangle className="size-4" /></span>
      <p className="min-w-0 text-ui text-fg-muted">{error instanceof Error ? error.message : "This widget couldn’t load."}</p>
      <Button size="sm" variant="secondary" leadingIcon={<RefreshCw />} onClick={retry}>Try again</Button>
    </div>
  )
}

export function WidgetSkeleton({ type }: { type: string }) {
  if (["metric", "kpi", "goal", "gauge"].includes(type)) return <div className="flex h-full flex-col justify-between gap-2" role="status" aria-busy aria-label="Loading"><Skeleton className="h-3 w-20" /><Skeleton className="h-8 w-28" /><Skeleton className="h-3 w-16" /></div>
  if (["chart", "sla_trend", "cycle_time", "throughput", "submission_trend"].includes(type)) {
    return (
      <div className="flex h-full min-h-24 items-end gap-2 pb-5 pl-6" role="status" aria-busy aria-label="Loading">
        {[40, 65, 50, 80, 35, 70, 55, 90].map((h, i) => <Skeleton key={i} className="flex-1 rounded-b-none" style={{ height: `${h}%` }} />)}
      </div>
    )
  }
  if (type === "heatmap") return <Skeleton className="h-full min-h-24 w-full" aria-label="Loading" />
  // Lists: rows shaped like the real ones (title, meta line, a chip on the right).
  return (
    <div className="divide-y divide-border-subtle" role="status" aria-busy aria-label="Loading">
      {[72, 58, 66].map((w, i) => (
        <div key={i} className="flex h-13 items-center gap-3">
          <div className="min-w-0 flex-1 space-y-1.5"><Skeleton className="h-3.5" style={{ width: `${w}%` }} /><Skeleton className="h-2.5 w-1/3" /></div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function Truncated({ show }: { show: boolean }) {
  return show ? <p className="text-2xs text-fg-subtle">Counted from the newest 5,000 items.</p> : null
}

/* ── Events and actions (lib/apps/events.ts) ─────────────────────────── */

/**
 * The page runtime's dispatcher: a widget raises an event; the actions come
 * from lib/apps/events.ts (its own settings today, Phase 3 app rules later)
 * and run here — open a target in its mode (panel stack), set a filter,
 * navigate, open a link, copy a link, claim the next task, download a report.
 */
export function useAppDispatch(context: WidgetContext) {
  const router = useRouter()
  const opener = useOpenTarget()
  const refresh = useRefreshWidgets(context.app)
  const runtime = useAppRuntime()
  return async (event: AppEvent): Promise<{ note?: string }> => {
    const actions = defaultActions(event, { filters: context.filters })
    let note: string | undefined
    for (const action of actions) note = (await runAppAction(action, { context, router, opener, refresh, runtime })) ?? note
    // App rules (lib/apps/rules.ts) run after the widget's own actions.
    runtime?.raiseWidgetEvent(event)
    return { note }
  }
}

export async function runAppAction(action: AppAction, env: { context: WidgetContext; router: ReturnType<typeof useRouter>; opener: ReturnType<typeof useOpenTarget>; refresh: () => Promise<unknown>; runtime?: AppRuntime | null }): Promise<string | undefined> {
  const { context, router, opener } = env
  switch (action.kind) {
    case "open_target": {
      const mode = context.embed && action.mode.mode === "navigate" ? { ...action.mode, mode: "tab" as const } : action.mode
      let target = action.target
      if (target.t === "page" && action.params) {
        const scope = env.runtime?.getScope()
        const values = resolveParams(action.params, { filters: context.filters, app: context.appSlug, page: context.page, event: action.event, scope, query: typeof window === "undefined" ? {} : Object.fromEntries(new URLSearchParams(window.location.search)) })
        target = { ...target, ...(Object.keys(values).length ? { params: values } : {}) }
      }
      if (target.t === "form" && action.params) {
        const scope = env.runtime?.getScope()
        const user = !scope && needsUser(action.params) ? await serverQuery("tasks.myProfile").catch(() => null) : null
        const values = resolveParams(action.params, { filters: context.filters, app: context.appSlug, page: context.page, event: action.event, scope, user: { id: null, name: (user as { display_name?: string } | null)?.display_name ?? null },
          query: typeof window === "undefined" ? {} : Object.fromEntries(new URLSearchParams(window.location.search)) })
        target = { ...target, params: values }
      }
      opener?.open(target, mode, action.title, env.runtime?.openHooks)
      return
    }
    case "set_filter":
      context.setFilter?.(action.filter, nextFilterValue(action, context.filters[action.filter]))
      return
    case "navigate": {
      if (!context.appSlug) return
      const sp = new URLSearchParams(Object.entries(action.filters ?? {}).map(([k, v]) => [filterParam(k), v]))
      const qs = sp.toString()
      router.push(`${context.base ?? "/apps"}/${context.appSlug}/${action.page}${qs ? `?${qs}` : ""}`)
      return
    }
    case "open_url":
      if (action.new_tab || context.embed) window.open(action.url, "_blank", "noopener,noreferrer")
      else if (action.url.startsWith("/")) router.push(action.url)
      else window.location.assign(action.url)
      return
    case "copy_link": {
      const url = action.url === "this_page" ? window.location.href : new URL(action.url, window.location.origin).toString()
      try { await navigator.clipboard?.writeText(url) } catch { /* clipboard permission */ }
      return "Link copied."
    }
    case "claim_next": {
      if (context.preview) return "Claiming works on the saved page."
      const r = await claimNextAppTask({ app: context.app, page: context.page, widget_id: action.widget, index: action.index, ...(context.previewArgs ?? {}) })
      if (!r.ok) return r.error
      if (!r.data.claimed) return "Nothing waiting in your team queues."
      await env.refresh()
      opener?.open({ t: "task", id: r.data.claimed }, { mode: "panel_right", width: "lg", motion: "auto" }, "Claimed task")
      return
    }
    case "download_report":
      await downloadReportCsv(action.report, action.label)
      return
  }
}

/** CSV of rows (formula injection neutralised: risky leading characters get a quote). */
export function toCsv(rows: Array<Record<string, unknown>>): string {
  const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !k.startsWith("_"))
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v)
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  return [keys.map(cell).join(","), ...rows.map((r) => keys.map((k) => cell(r[k])).join(","))].join("\r\n")
}

/** A saved report as CSV, as the viewer may run it (reports.view and its sharing — the report page's preview). */
export async function downloadReportCsv(reportId: string, label: string) {
  const report = await serverQuery("reports.get", { id: reportId }) as { name?: string; config?: unknown } | null
  if (!report?.config) return
  const res = await fetch("/api/v1/reports/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(report.config) })
  if (!res.ok) return
  const json = await res.json()
  const blob = new Blob([toCsv((json.data ?? []) as Array<Record<string, unknown>>)], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${(report.name || label || "report").replace(/[^\w.\- ]+/g, "").trim() || "report"}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The click handler for a widget's click-through: raises a row / card /
 * segment click event (set the page filter, or open another page with it).
 * Null when nothing is set up.
 */
export function useClickThrough(context: WidgetContext, click: ClickTarget | undefined | null, kind: "row_click" | "card_click" | "segment_click" = "row_click", widget = "") {
  const dispatch = useAppDispatch(context)
  const runtime = useAppRuntime()
  // Clickable when click-through is set up, or an app rule listens for this click.
  if (!click?.filter && !click?.page && !runtime?.listens(kind, widget)) return null
  return (value: string | DateRangeValue | null, data?: Record<string, string>) => {
    void dispatch(kind === "row_click" ? { type: kind, widget, value, click: click ?? undefined, row: data } : kind === "card_click" ? { type: kind, widget, value, click: click ?? undefined, card: data } : { type: kind, widget, value, click: click ?? undefined })
  }
}

/** Is this value the active click-through filter value (highlight)? */
export function isActive(context: WidgetContext, click: ClickTarget | undefined | null, value: string): boolean {
  return !!click?.filter && !click.page && context.filters[click.filter] === value
}

/* ── Tasks ───────────────────────────────────────────────────────────── */

export function DueChip({ due, overdue, sla }: { due: string | null; overdue: boolean; sla: string | null }) {
  const breached = overdue || sla === "breached"
  const risk = !breached && sla === "warning"
  if (!due && !sla) return null
  const chip = (
    <span tabIndex={due ? 0 : undefined} className={cn(
      "num inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]",
      breached ? "bg-danger-wash text-danger" : risk ? "bg-warning-wash text-warning" : "bg-subtle text-fg-muted",
    )} data-due-chip={breached ? "overdue" : risk ? "risk" : "ok"}>
      {breached ? (due ? `Overdue · ${formatRelative(due)}` : "SLA breached") : risk ? (due ? `Due ${formatRelative(due)}` : "At risk") : due ? `Due ${formatRelative(due)}` : "On track"}
    </span>
  )
  return due ? <Tooltip content={formatAbsolute(due)}>{chip}</Tooltip> : chip
}

/** The task quick-view drawer (components/apps/task-quick-view.tsx): header, summary, fields, sections, and the task's real actions in a sticky footer. */
export function TaskDrawer({ task, onClose }: { task: { id: string; title: string; action?: "accept" | "claim" } | null; onClose: () => void }) {
  return <TaskQuickView task={task} onClose={onClose} />
}

/** Arrow keys move between the rows' main buttons (lists of tasks, submissions, activity). */
export function onListKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-row-main]")]
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (at < 0 && e.key !== "Home" && e.key !== "End") return
  e.preventDefault()
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : Math.min(items.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))
  items[next]?.focus()
}

/** A "View all (n)" footer link under a list that shows only the rows that fit. */
export function ViewAll({ total, onClick, href, label = "View all" }: { total: number; onClick?: () => void; href?: string; label?: string }) {
  const cls = "inline-flex h-7 items-center gap-1 rounded-md px-1 text-ui font-medium text-primary-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]"
  const inner = <>{label} <span className="num text-fg-muted">({formatCount(total)})</span><ArrowRight className="size-3.5" aria-hidden /></>
  return (
    <div className="flex shrink-0 justify-end pt-0.5" data-view-all>
      {href ? <Link href={href} className={cls}>{inner}</Link> : <button type="button" onClick={onClick} className={cls}>{inner}</button>}
    </div>
  )
}

const TASK_VIEW_OF: Record<string, string> = { mine: "mine", queue: "queue", team: "team", all: "all" }

export function TaskRows({ tasks, total, context, openIn = "drawer", note, scope, title }: { tasks: WidgetTask[]; total: number; context: WidgetContext; openIn?: "drawer" | "page"; note?: string; scope?: string; title?: string }) {
  const refresh = useRefreshWidgets(context.app)
  const budget = useContentBudget()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<{ id: string; title: string; action?: "accept" | "claim" } | null>(null)
  const [all, setAll] = useState(false)
  if (!tasks.length) return <Empty text="No tasks here right now." />
  const claim = async (id: string) => {
    setBusy(id); setError(null)
    const result = await claimTask(id)
    setBusy(null)
    if (!result.ok) { setError(result.error); return }
    await refresh()
  }
  const shown = rowsToShow(tasks.length, budget)
  const hidden = total > shown
  const rows = (list: WidgetTask[]) => (
    <ul className="divide-y divide-border-subtle" onKeyDown={onListKeys} data-widget-tasks>
      {list.map((task) => {
        const meta = [task.process?.name, task.stage, task.team].filter((x): x is string => !!x && x.trim().length > 0)
        const label = task.title || "Untitled task"
        return (
          <li key={task.id} className="group/row relative -mx-1.5 flex h-13 items-center gap-2.5 rounded-md px-1.5 transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle focus-within:bg-subtle" data-task-row={task.id}>
            <PriorityMark priority={task.priority} />
            <div className="min-w-0 flex-1">
              {openIn === "drawer" && !context.embed ? (
                <button type="button" title={label} className="block w-full truncate text-left text-ui font-medium text-fg outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-[var(--theme-primary)]"
                  onClick={() => setOpen({ id: task.id, title: task.title, action: task.action })} data-open-task={task.id} data-row-main>{label}</button>
              ) : (
                <Link href={`/tasks/${task.id}`} title={label} target={context.embed ? "_blank" : undefined} className="block truncate text-ui font-medium text-fg outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-[var(--theme-primary)]" data-row-main>{label}</Link>
              )}
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                {meta.length > 0 && <span className="truncate">{meta.join(" · ")}</span>}
                <TaskTags tags={task.tags} max={2} />
              </div>
            </div>
            <DueChip due={task.due_date} overdue={task.overdue} sla={task.sla_status} />
            {task.action === "claim" && (
              <Button size="sm" variant="secondary" className="relative z-10" loading={busy === task.id} onClick={() => void claim(task.id)} data-claim-task={task.id}>Claim</Button>
            )}
          </li>
        )
      })}
    </ul>
  )
  return (
    <div className="flex flex-col" data-task-rows>
      {error && <p role="alert" className="pb-1 text-xs text-danger">{error}</p>}
      {rows(tasks.slice(0, shown))}
      {hidden ? <ViewAll total={total} onClick={() => setAll(true)} /> : null}
      {note && <p className="pt-1 text-2xs text-fg-subtle">{note}</p>}
      <Sheet open={all} onOpenChange={setAll}>
        <SheetContent size="lg" title={title || "Tasks"} description={`${formatCount(tasks.length)}${total > tasks.length ? ` of ${formatCount(total)}` : ""} tasks`} data-view-all-sheet>
          <DialogBody className="px-5">{rows(tasks)}</DialogBody>
          <div className="flex shrink-0 justify-end border-t border-border-subtle px-5 py-3">
            <Link href={`/tasks?view=${TASK_VIEW_OF[scope ?? "mine"] ?? "mine"}`} className="inline-flex items-center gap-1 text-ui font-medium text-primary-text hover:underline">Open in Tasks <ExternalLink className="size-3.5" aria-hidden /></Link>
          </div>
        </SheetContent>
      </Sheet>
      <TaskDrawer task={open} onClose={() => { setOpen(null); void refresh() }} />
    </div>
  )
}

/* ── Small charts ────────────────────────────────────────────────────── */

export function Sparkline({ values, className, label }: { values: number[]; className?: string; label?: string }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${30 - ((v - min) / span) * 28 - 1}`).join(" ")
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-8 w-full", className)} role="img" aria-label={label ?? `Trend: ${values.join(", ")}`}>
      <polyline points={`0,30 ${pts} 100,30`} fill="var(--app-chart-1)" fillOpacity={0.14} stroke="none" />
      <polyline points={pts} fill="none" stroke="var(--app-chart-1)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** Hours as people read them: "45m", "3h 20m", "2d 4h". */
export function hoursText(h: number | null): string {
  if (h === null || !Number.isFinite(h)) return "—"
  return formatDurationParts(h * 3_600_000)
}

export const TONE: Record<string, string> = {
  neutral: "bg-subtle text-fg-muted", info: "bg-info-wash text-info", success: "bg-success-wash text-success",
  warning: "bg-warning-wash text-warning", danger: "bg-danger-wash text-danger", accent: "bg-[var(--app-accent-wash,var(--theme-primary-light))] text-primary-text",
}

/* ── Widget header slot ──────────────────────────────────────────────── */

/** The widget header's action area (right of the title): widgets portal small icon buttons into it (e.g. the chart's table toggle). */
export const HeaderSlotContext = createContext<HTMLElement | null>(null)

export function useHeaderAction(node: ReactNode): ReactNode {
  const slot = useContext(HeaderSlotContext)
  return slot ? createPortal(node, slot) : null
}

/* ── KPI tile ────────────────────────────────────────────────────────── */

/**
 * The KPI layout every number widget shares (metric, KPI): a small muted
 * label (with an optional icon chip in a soft accent tint) at the top, the
 * big number in tabular figures, a delta chip, and an optional sparkline —
 * vertically balanced, scaling with the tile (container queries).
 */
export function KpiTile({ label, icon, accent, value, sub, change, invert = false, spark, onClick }: {
  label: string; icon?: ReactNode; accent?: string | null; value: string; sub?: ReactNode; change?: number | null; invert?: boolean; spark?: number[]; onClick?: (() => void) | null
}) {
  const up = (change ?? 0) >= 0
  const good = invert ? !up : up
  const Tag = onClick ? "button" : "div"
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick ?? undefined} className={cn("@container flex h-full w-full min-w-0 flex-col justify-between gap-1 text-left", onClick && "rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]")} data-kpi-tile>
      <div className="flex min-w-0 items-center gap-2">
        {icon && <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md @[16rem]:size-7" style={{ background: `color-mix(in oklab, ${accent ?? "var(--app-chart-1)"} 16%, transparent)`, color: accent ?? "var(--app-chart-1)" }} aria-hidden>{icon}</span>}
        <span className="min-w-0 truncate text-xs font-medium text-fg-muted">{label}</span>
      </div>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="num truncate text-2xl font-semibold leading-none tracking-tight text-fg tabular-nums @[14rem]:text-3xl @[22rem]:text-4xl">{value}</span>
        {change !== null && change !== undefined && (
          <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-2xs font-semibold tabular-nums", good ? "bg-success-wash text-success" : "bg-danger-wash text-danger")}>
            {up ? "▲" : "▼"} {Math.abs(change).toFixed(1)}%<span className="sr-only"> vs previous period</span>
          </span>
        )}
      </div>
      {sub && <div className="min-w-0 truncate text-2xs text-fg-muted">{sub}</div>}
      {spark && spark.length > 1 && <Sparkline values={spark} className="h-7 @[16rem]:h-9" />}
    </Tag>
  )
}
