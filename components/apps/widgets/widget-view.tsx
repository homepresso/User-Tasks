"use client"

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { ChartNoAxesColumn, Download, ExternalLink, Loader2, Maximize2, MoreHorizontal, RefreshCw } from "lucide-react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Tooltip } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCompact, formatCount, formatCurrencyHeadline, formatPercent } from "@/lib/format/number"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { StatusPill } from "@/components/ui/badge"
import { autoHeightCap, catalogEntry, isBleed, isDataWidget, metricUnitLabel, widgetTitle } from "@/lib/apps/widgets"
import { widgetCsvRows } from "@/lib/apps/widget-csv"
import type { AppWidget, WidgetConfig } from "@/lib/apps/schema"
import type { WidgetData } from "@/lib/services/app-widgets"
import { cn } from "@/lib/utils"
import { ActionButtons } from "./action-buttons"
import { ReportWidget } from "./report-widget"
import {
  ContentBudgetContext, Empty, HeaderSlotContext, KpiTile, TaskRows, ViewAll, WidgetError, WidgetMetaContext, WidgetSkeleton, contentBudgetForRows, isActive, onListKeys, rowsToShow,
  toCsv, useClickThrough, useContentBudget, useWidgetData, type WidgetContext, type WidgetMeta,
} from "./kit"
import { ACCENT_VAR } from "@/lib/apps/colors"
import { bindingKeys, bindingValues, isTemplate, templateHtml, templateText, type AppScope } from "@/lib/apps/variables"
import { useAppRuntime } from "../runtime"
import { ValueColorsProvider, useAppStyle, widgetStyleCss } from "../widget-style"
import { AppIconGlyph } from "../app-icon"
import { KanbanWidget, MyWorkloadWidget, OverdueWidget, TaskCalendarWidget, TeamWorkloadWidget } from "./task-widgets"
import {
  BottleneckWidget, CycleTimeWidget, FieldAnalyticsWidget, GaugeWidget, GoalWidget, HeatmapWidget, KpiWidget, MySubmissionsWidget, PivotWidget,
  RecentFailuresWidget, RunStatusWidget, RunTimelineWidget, SlaBreakdownWidget, SlaTrendWidget, StartWorkflowWidget, SubmissionTrendWidget, ThroughputWidget,
} from "./insight-widgets"
import { CardViewWidget, DataGridWidget, FilteredListWidget, RecordCardWidget } from "./data-widgets"
import { ActivityFeedWidget, OrgChartWidget, PeopleDirectoryWidget, TeamMembersWidget } from "./people-widgets"
import {
  AgentChatWidget, AnnouncementWidget, DividerWidget, EmbedWidget, FormEmbedWidget, PageHeaderWidget, QuickSearchWidget, SectionWidget, TabsWidget, TilesWidget, VideoWidget,
  sanitizeWidgetHtml,
} from "./content-widgets"

export type { WidgetContext } from "./kit"
export { WidgetSkeleton, sanitizeWidgetHtml }

const ChartView = dynamic(() => import("./chart-view").then((m) => m.ChartView), { ssr: false, loading: () => <Skeleton className="h-full min-h-24 w-full" /> })

/**
 * One widget on an app page: its title and body, with loading, empty and
 * error states. Data widgets read through the ui-read apps.widget as the
 * viewer (lib/services/app-widgets.ts, app-widgets-more.ts); in the builder,
 * `preview` sends the unsaved config (editors only). Bleed widgets draw no
 * title bar (the grid draws no card for them either).
 */

/** Widgets with their own component (they read their own data, if any). */
const OWN: Partial<Record<string, (p: { widget: AppWidget; context: WidgetContext }) => ReactNode>> = {
  kanban: KanbanWidget, task_calendar: TaskCalendarWidget, my_workload: MyWorkloadWidget, overdue_list: OverdueWidget, team_workload: TeamWorkloadWidget,
  sla_trend: SlaTrendWidget, sla_breakdown: SlaBreakdownWidget, cycle_time: CycleTimeWidget, bottleneck: BottleneckWidget, throughput: ThroughputWidget,
  run_status: RunStatusWidget, recent_failures: RecentFailuresWidget, run_timeline: RunTimelineWidget, start_workflow: StartWorkflowWidget,
  submission_trend: SubmissionTrendWidget, my_submissions: MySubmissionsWidget, field_analytics: FieldAnalyticsWidget, form_embed: FormEmbedWidget,
  data_grid: DataGridWidget, record_card: RecordCardWidget, filtered_list: FilteredListWidget, card_view: CardViewWidget, pivot: PivotWidget,
  kpi: KpiWidget, goal: GoalWidget, gauge: GaugeWidget, heatmap: HeatmapWidget,
  team_members: TeamMembersWidget, org_chart: OrgChartWidget, people_directory: PeopleDirectoryWidget, activity_feed: ActivityFeedWidget,
  announcement: AnnouncementWidget, embed: EmbedWidget, video: ({ widget }) => <VideoWidget widget={widget} />, divider: ({ widget }) => <DividerWidget widget={widget} />,
  spacer: () => <div aria-hidden className="h-full" />, tabs: TabsWidget, section: SectionWidget, tiles: TilesWidget, quick_search: QuickSearchWidget, agent_chat: AgentChatWidget,
}

/** Widgets that draw their own label (KPI-style tiles) or have no header. */
const NO_HEADER = new Set(["heading", "announcement", "divider", "spacer", "page_header", "section", "nav_bar", "metric", "kpi", "goal", "gauge"])

/**
 * The page grid's sizing service (RuntimeGrid): auto-height widgets report
 * their content height; every widget learns the grid's columns and the rows
 * it is drawn at. Absent inside containers, panels and full-screen views.
 */
export interface AppLayout {
  /** Columns the grid has now (1 on phones: cards take their content's height). */
  cols: number
  report: (id: string, px: number) => void
}
export const AppLayoutContext = createContext<AppLayout | null>(null)

/** HTML-escape a value placed into rich text. */
const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!)

/**
 * A widget with its texts filled from the app scope ({{var.x}}, {{sys.user.name}},
 * {{= expression}} in titles, headings, text, announcements, page header
 * subtitles) and buttons a rule disabled. Values placed in HTML are escaped.
 */
export function withScope(widget: AppWidget, scope: AppScope, disabled?: ReadonlySet<number> | "all"): AppWidget {
  const fill = (t: unknown) => (isTemplate(t) ? templateText(t, scope) : t)
  const fillHtml = (t: unknown) => (isTemplate(t) ? templateHtml(t, scope, esc) : t)
  const c = widget.config as Record<string, unknown>
  let config: Record<string, unknown> | null = null
  if (widget.type === "heading") config = { ...c, text: fill(c.text), subtitle: fill(c.subtitle) }
  else if (widget.type === "text" || widget.type === "announcement") config = { ...c, html: fillHtml(c.html) }
  else if (widget.type === "page_header") config = { ...c, subtitle: fill(c.subtitle) }
  else if (widget.type === "actions" && disabled) {
    const buttons = (c.buttons as Array<Record<string, unknown>>).map((b, i) => (disabled === "all" || disabled.has(i) ? { ...b, disabled_reason: (b.disabled_reason as string | null) || "Not available right now" } : b))
    config = { ...c, buttons }
  }
  const title = fill(widget.title) as string | null | undefined
  if (!config && title === widget.title) return widget
  return { ...widget, title, config: (config ?? c) as never }
}

export function WidgetView({ widget: raw, context: rawContext, app, pageTitle, inline = false, chromeless = false }: { widget: AppWidget; context: WidgetContext; app?: Parameters<typeof PageHeaderWidget>[0]["app"]; pageTitle?: string; /** Drawn inside a container or panel (no grid card): the widget paints its own styled box. */ inline?: boolean; /** No title bar (the full-screen view has its own). */ chromeless?: boolean }) {
  const runtime = useAppRuntime()
  const appStyle = useAppStyle()
  const css = useMemo(() => widgetStyleCss(raw, appStyle), [raw, appStyle])
  const keys = useMemo(() => bindingKeys(raw.config), [raw.config])
  const bound = runtime && keys.length ? bindingValues(keys, runtime.scope) : null
  const boundKey = bound ? JSON.stringify(bound) : ""
  // eslint-disable-next-line react-hooks/exhaustive-deps -- boundKey stands for bound
  const context = useMemo(() => (bound ? { ...rawContext, filters: { ...rawContext.filters, ...bound } } : rawContext), [rawContext, boundKey])
  const widget = runtime ? withScope(raw, runtime.scope, runtime.disabled.get(raw.id)) : raw
  if (runtime?.hidden.has(raw.id)) return null
  const body = <WidgetBody widget={widget} context={context} app={app} pageTitle={pageTitle} inline={inline} chromeless={chromeless} />
  if (!css) return body
  return (
    <div className={cn("h-full min-h-0", inline && "rounded-lg border border-transparent")} style={{ ...css.vars, ...(inline ? css.box : {}) }} data-widget-styled={css.flags} data-widget-content>
      <ValueColorsProvider value={css.valueColors}>{body}</ValueColorsProvider>
    </div>
  )
}

/** Card padding and border (12px each side + 1px border) and the title bar (24px + 8px gap), in px. */
const CARD_CHROME_PX = 26
const TITLE_BAR_PX = 32

function WidgetBody({ widget, context, app, pageTitle, inline = false, chromeless = false }: { widget: AppWidget; context: WidgetContext; app?: Parameters<typeof PageHeaderWidget>[0]["app"]; pageTitle?: string; inline?: boolean; chromeless?: boolean }) {
  const bleed = isBleed(widget)
  const own = OWN[widget.type]
  const layout = useContext(AppLayoutContext)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const [meta, setMeta] = useState<WidgetMeta | null>(null)
  const metaApi = useMemo(() => ({ report: (m: WidgetMeta) => setMeta((cur) => (cur && cur.data === m.data && cur.updatedAt === m.updatedAt && cur.fetching === m.fetching ? cur : m)) }), [])
  const heading = widgetTitle(widget)
  const titled = !bleed && !chromeless && !NO_HEADER.has(widget.type) && !!heading
  const data = isDataWidget(widget.type)
  // Sizing: auto-height cards report their content; lists get the room they have (fixed / legacy cards: whole rows + "View all").
  const cap = layout && !inline && layout.cols > 1 ? autoHeightCap(widget) : null
  // Phones: cards take their content's height, so long lists stop at about eight rows (+ "View all").
  const budget = !layout || inline ? Number.POSITIVE_INFINITY
    : layout.cols <= 1 ? contentBudgetForRows(Math.min(Math.max(widget.max_h ?? widget.h, 5), 9), titled)
    : widget.height === "auto" ? Number.POSITIVE_INFINITY
    : contentBudgetForRows(cap ?? widget.h, titled)
  const natural = useRef<HTMLDivElement>(null)
  const ready = !data || !!meta?.data
  const report = layout?.report
  useLayoutEffect(() => {
    const el = natural.current
    if (cap === null || !el || !report || !ready) return
    const send = () => report(widget.id, Math.ceil(el.getBoundingClientRect().height) + CARD_CHROME_PX + (titled ? TITLE_BAR_PX : 0))
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    return () => ro.disconnect()
  }, [cap, report, ready, titled, widget.id])

  let body: ReactNode
  if (widget.type === "page_header") body = <PageHeaderWidget widget={widget} context={context} app={app} pageTitle={pageTitle} />
  // As an element (not a call): its hooks then run inside the providers below (meta, budget, header slot).
  else if (own) { const Own = own; body = <Own widget={widget} context={context} /> }
  else if (data) body = <DataWidget widget={widget} context={context} />
  else body = <StaticWidget widget={widget} context={context} />
  return (
    <section className={cn("flex h-full min-h-0 flex-col", !bleed && "gap-2")} aria-label={heading || catalogEntry(widget.type).title} data-app-widget={widget.type} data-bleed={bleed || undefined} data-auto-height={cap !== null || undefined}>
      {titled && (
        <header className="flex h-6 shrink-0 items-center gap-1.5" data-widget-header>
          <h2 className="min-w-0 truncate text-sm font-semibold text-fg" title={heading ?? undefined}>{heading}</h2>
          {meta?.fetching && meta.data && <Loader2 className="size-3.5 shrink-0 text-fg-subtle motion-safe:animate-spin" aria-label="Refreshing" />}
          <span className="flex-1" />
          <div ref={setSlot} className="flex shrink-0 items-center gap-0.5" />
          {data && !context.preview && <WidgetMenu widget={widget} context={context} title={heading ?? catalogEntry(widget.type).title} meta={meta} app={app} pageTitle={pageTitle} />}
        </header>
      )}
      <WidgetMetaContext.Provider value={metaApi}>
        <HeaderSlotContext.Provider value={slot}>
          <ContentBudgetContext.Provider value={budget}>
            <div className="@container min-h-0 flex-1">{cap !== null ? <div ref={natural} className="flow-root">{body}</div> : body}</div>
          </ContentBudgetContext.Provider>
        </HeaderSlotContext.Provider>
      </WidgetMetaContext.Provider>
    </section>
  )
}

/** The header's ⋯ menu on data widgets: Refresh (with when it last loaded), Open full screen, Download CSV. */
function WidgetMenu({ widget, context, title, meta, app, pageTitle }: { widget: AppWidget; context: WidgetContext; title: string; meta: WidgetMeta | null; app?: Parameters<typeof PageHeaderWidget>[0]["app"]; pageTitle?: string }) {
  const [full, setFull] = useState(false)
  const [, tick] = useState(0)
  const rows = useMemo(() => widgetCsvRows(meta?.data ?? null), [meta?.data])
  const download = useCallback(() => {
    if (!rows?.length) return
    const blob = new Blob([toCsv(rows as Array<Record<string, unknown>>)], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `${title.replace(/[^\w.\- ]+/g, "").trim() || "widget"}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [rows, title])
  return (
    <>
      <DropdownMenu onOpenChange={(o) => { if (o) tick((n) => n + 1) }}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`${title}: more`} className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle opacity-70 transition-opacity hover:bg-subtle hover:text-fg hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)] group-hover/widget:opacity-100 data-[state=open]:opacity-100" data-widget-menu={widget.id}>
            <MoreHorizontal className="size-4" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuLabel>{meta?.updatedAt ? `Updated ${formatRelative(new Date(meta.updatedAt).toISOString())}` : "Loading…"}</DropdownMenuLabel>
          <DropdownMenuItem icon={<RefreshCw />} onSelect={() => meta?.refetch()} disabled={!meta} data-widget-refresh>Refresh</DropdownMenuItem>
          <DropdownMenuItem icon={<Maximize2 />} onSelect={() => setFull(true)} data-widget-fullscreen>Open full screen</DropdownMenuItem>
          {rows && rows.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem icon={<Download />} onSelect={download} data-widget-csv>Download CSV</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {full && (
        <Dialog open={full} onOpenChange={setFull}>
          <DialogContent size="xl" title={title} className="h-[min(85dvh,900px)]">
            <div className="min-h-0 flex-1 overflow-auto px-6 pb-6 max-sm:px-4" data-widget-fullscreen-view>
              <div className="h-full min-h-80"><WidgetView widget={widget} context={context} app={app} pageTitle={pageTitle} inline chromeless /></div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function DataWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const query = useWidgetData(widget, context)
  const chartClick = useClickThrough(context, widget.type === "chart" || widget.type === "metric" ? (widget.config as { click?: WidgetConfig<"chart">["click"] }).click : null, "segment_click", widget.id)
  if (query.isPending) return <WidgetSkeleton type={widget.type} />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const data = query.data
  switch (data.type) {
    case "task_list": return <TaskRows tasks={data.tasks} total={data.total} context={context} openIn={(widget.config as WidgetConfig<"task_list">).open_in ?? "drawer"} note={data.note} scope={(widget.config as WidgetConfig<"task_list">).scope} title={widgetTitle(widget) ?? undefined} />
    case "sla": return <SlaBody data={data} />
    case "metric": return <MetricBody data={data} config={widget.config as WidgetConfig<"metric">} title={widget.title ?? null} onClick={chartClick ? () => chartClick((widget.config as WidgetConfig<"metric">).click_value ?? null) : null} />
    case "chart": {
      const c = widget.config as WidgetConfig<"chart">
      const active = c.click?.filter ? (typeof context.filters[c.click.filter] === "string" ? context.filters[c.click.filter] as string : null) : null
      const hasData = data.points.some((p) => p.value || Object.values(p.values ?? {}).some(Boolean)) || !!data.scatter?.length
      return hasData ? <ChartView data={data} config={c} onSelect={chartClick} active={active} /> : <Empty text="Nothing to chart for these filters yet." icon={<ChartNoAxesColumn />} />
    }
    case "table_view": return data.kind === "report" ? <ReportWidget reportId={data.report_id} /> : <TableBody data={data} />
    case "recent": return <RecentBody data={data} />
    case "empty": return <Empty text={data.reason} />
    default: return <Empty text="No data." />
  }
}

void isActive

/* ── SLA ─────────────────────────────────────────────────────────────── */

function SlaBody({ data }: { data: Extract<WidgetData, { type: "sla" }> }) {
  const open = data.on_track + data.at_risk + data.breached
  if (!data.total) return <Empty text={data.source === "runs" ? "No running workflows." : "No open tasks."} />
  const pct = (n: number) => (open ? (n / open) * 100 : 0)
  return (
    <div className="flex flex-col gap-3" data-widget-sla>
      <div className="grid grid-cols-3 gap-2">
        <SlaCount label="On track" value={data.on_track} tone="success" />
        <SlaCount label="At risk" value={data.at_risk} tone="warning" />
        <SlaCount label="Breached" value={data.breached} tone="danger" />
      </div>
      {open > 0 && (
        <div className="flex h-2 overflow-hidden rounded-full bg-subtle" role="img" aria-label={`${data.on_track} on track, ${data.at_risk} at risk, ${data.breached} breached`}>
          <span className="bg-success" style={{ width: `${pct(data.on_track)}%` }} />
          <span className="bg-warning" style={{ width: `${pct(data.at_risk)}%` }} />
          <span className="bg-danger" style={{ width: `${pct(data.breached)}%` }} />
        </div>
      )}
      {data.no_sla > 0 && <p className="text-xs text-fg-muted">{formatCount(data.no_sla)} without a due date or SLA</p>}
      {data.breakdown.length > 0 && (
        <table className="w-full text-xs">
          <caption className="sr-only">By workflow</caption>
          <thead><tr className="text-left text-fg-muted"><th className="py-1 font-medium">Workflow</th><th className="py-1 text-right font-medium">On track</th><th className="py-1 text-right font-medium">At risk</th><th className="py-1 text-right font-medium">Breached</th></tr></thead>
          <tbody>
            {data.breakdown.map((row) => (
              <tr key={row.label} className="border-t border-border-subtle">
                <td className="max-w-0 truncate py-1 text-fg">{row.label}</td>
                <td className="num py-1 text-right">{row.on_track}</td>
                <td className="num py-1 text-right text-warning">{row.at_risk}</td>
                <td className="num py-1 text-right text-danger">{row.breached}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.truncated && <p className="text-2xs text-fg-subtle">Counted from the newest items only.</p>}
    </div>
  )
}

function SlaCount({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "danger" }) {
  return (
    <div className={cn("rounded-md px-2 py-1.5", tone === "success" ? "bg-success-wash" : tone === "warning" ? "bg-warning-wash" : "bg-danger-wash")}>
      <div className={cn("num text-xl font-semibold", tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-danger")}>{formatCompact(value)}</div>
      <div className="text-xs text-fg-muted">{label}</div>
    </div>
  )
}

/* ── Metric ──────────────────────────────────────────────────────────── */

export function formatMetric(value: number | null, config: Pick<WidgetConfig<"metric">, "format" | "currency">): string {
  if (value === null) return "—"
  if (config.format === "currency") return formatCurrencyHeadline(value, config.currency || "USD")
  if (config.format === "percent") return formatPercent(value, { fromPercent: true })
  return Math.abs(value) >= 10_000 ? formatCompact(value) : formatCount(value, { maxFractionDigits: 2 })
}

function MetricBody({ data, config, title, onClick }: { data: Extract<WidgetData, { type: "metric" }>; config: WidgetConfig<"metric">; title: string | null; onClick?: (() => void) | null }) {
  const unit = metricUnitLabel(config, data.unit)
  const label = title || (unit && unit !== "%" ? unit[0].toUpperCase() + unit.slice(1) : "Value")
  const accent = config.accent ? ACCENT_VAR[config.accent] : null
  return (
    <div className="h-full" data-widget-metric>
      <KpiTile label={label} icon={config.icon ? <AppIconGlyph name={config.icon} className="size-3.5" /> : null} accent={accent} value={formatMetric(data.value, config)} change={data.change_pct}
        sub={data.change_pct === null && data.previous !== null ? `Previous period: ${formatMetric(data.previous, config)}` : config.compare_previous && data.change_pct !== null ? "vs previous period" : title && unit ? unit : null}
        onClick={onClick} />
    </div>
  )
}

/* ── Data table ──────────────────────────────────────────────────────── */

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.map(cellText).join(", ")
  if (typeof value === "object") {
    const v = value as Record<string, unknown>
    return String(v.label ?? v.name ?? v.display_name ?? v.email ?? v.value ?? "")
  }
  return String(value)
}

function TableBody({ data }: { data: Extract<WidgetData, { type: "table_view"; kind: "data_table" }> }) {
  if (!data.rows.length) return <Empty text={`No rows in ${data.table.name} yet.`} />
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-table>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
        <table className="w-full text-sm">
          <caption className="sr-only">{data.table.name}</caption>
          <thead className="sticky top-0 bg-panel">
            <tr>{data.columns.map((c) => <th key={c.key} scope="col" className="whitespace-nowrap border-b border-border px-2 py-1.5 text-left text-xs font-medium text-fg-muted">{c.label}</th>)}</tr>
          </thead>
          <tbody>
            {data.rows.map((row) => (
              <tr key={row.id} className="border-b border-border-subtle">
                {data.columns.map((c) => <td key={c.key} className={cn("max-w-64 truncate px-2 py-1.5 text-fg", (c.type === "number" || c.type === "currency") && "num text-right")}>{cellText(row.data[c.key])}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-fg-muted">
        <span>{formatCount(data.rows.length)} of {formatCount(data.total)} rows</span>
        <Link href={`/data/${data.table.id}`} className="inline-flex items-center gap-1 text-primary-text hover:underline">Open table <ExternalLink className="size-3" aria-hidden /></Link>
      </div>
    </div>
  )
}

/* ── Recent ──────────────────────────────────────────────────────────── */

function RecentBody({ data }: { data: Extract<WidgetData, { type: "recent" }> }) {
  const budget = useContentBudget()
  const [all, setAll] = useState(false)
  if (!data.items.length) return <Empty text={data.source === "runs" ? "No workflow runs yet." : "No submissions yet."} />
  const shown = all ? data.items.length : rowsToShow(data.items.length, budget)
  return (
    <div className="flex flex-col">
      <ul className="divide-y divide-border-subtle" onKeyDown={onListKeys} data-widget-recent>
        {data.items.slice(0, shown).map((item) => (
          <li key={item.id} className="relative -mx-1.5 flex h-13 items-center gap-2.5 rounded-md px-1.5 hover:bg-subtle focus-within:bg-subtle">
            <div className="min-w-0 flex-1">
              {item.href
                ? <Link href={item.href} title={item.title} className="block truncate text-ui font-medium text-fg outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-[var(--theme-primary)]" data-row-main>{item.title}</Link>
                : <span className="block truncate text-ui font-medium text-fg" title={item.title}>{item.title}</span>}
              {item.subtitle && <span className="block truncate text-xs text-fg-muted">{item.subtitle}</span>}
            </div>
            {item.status && <StatusPill status={item.status} />}
            <Tooltip content={formatAbsolute(item.at)}><time className="num shrink-0 text-xs text-fg-muted" dateTime={item.at}>{formatRelative(item.at)}</time></Tooltip>
          </li>
        ))}
      </ul>
      {shown < data.items.length && <ViewAll total={data.items.length} onClick={() => setAll(true)} />}
    </div>
  )
}

function StaticWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  switch (widget.type) {
    case "heading": {
      const c = widget.config as WidgetConfig<"heading">
      const Tag = (`h${c.level}`) as "h1" | "h2" | "h3"
      return (
        <div className="flex h-full flex-col justify-center" data-widget-heading>
          <Tag className={cn("font-semibold text-fg", c.level === 1 ? "text-2xl" : c.level === 2 ? "text-xl" : "text-lg")}>{c.text || widget.title || "Heading"}</Tag>
          {c.subtitle && <p className="text-sm text-fg-muted">{c.subtitle}</p>}
        </div>
      )
    }
    case "text": {
      const c = widget.config as WidgetConfig<"text">
      const html = sanitizeWidgetHtml(c.html)
      return html.trim()
        ? <div className="prose-app text-sm text-fg [&_a]:text-primary-text [&_a]:underline [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:ml-4 [&_ol]:list-decimal [&_p]:my-1.5 [&_ul]:list-disc" dangerouslySetInnerHTML={{ __html: html }} />
        : <Empty text="Add some text in the widget settings." />
    }
    case "image": {
      const c = widget.config as WidgetConfig<"image">
      if (!c.url) return <Empty text="Add an image address in the widget settings." />
      // eslint-disable-next-line @next/next/no-img-element -- builder-supplied https image of any size
      const img = <img src={c.url} alt={c.alt} className={cn("h-full w-full rounded-lg", c.fit === "cover" ? "object-cover" : "object-contain")} loading="lazy" referrerPolicy="no-referrer" />
      return c.link ? <a href={c.link} className="block h-full" target={c.link.startsWith("/") ? undefined : "_blank"} rel="noreferrer">{img}</a> : img
    }
    case "links": {
      const c = widget.config as WidgetConfig<"links">
      if (!c.links.length) return <Empty text="Add links in the widget settings." />
      return (
        <ul className="space-y-1" data-widget-links>
          {c.links.map((link, i) => (
            <li key={i}>
              <a href={link.url} target={link.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-subtle">
                <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" aria-hidden />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-primary-text group-hover:underline">{link.label}</span>
                  {link.description && <span className="block truncate text-xs text-fg-muted">{link.description}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )
    }
    case "actions":
      return <ActionButtons config={widget.config as WidgetConfig<"actions">} context={context} widgetId={widget.id} />
    default:
      return null
  }
}
