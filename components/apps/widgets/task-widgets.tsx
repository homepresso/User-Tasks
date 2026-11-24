"use client"

import { TaskTags } from "@/components/tasks/task-tags"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { ProgressBar } from "@/components/ui/progress-bar"
import { IconButton } from "@/components/ui/icon-button"
import { moveKanbanRow, moveKanbanTask } from "@/app/actions/apps"
import { formatCount, formatCurrency } from "@/lib/format/number"
import type { AppWidget, WidgetConfig } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"
import { DueChip, Empty, TONE, TaskDrawer, TaskRows, WidgetError, WidgetSkeleton, isActive, useClickThrough, useRefreshWidgets, useWidgetData, type DataOf, type WidgetContext } from "./kit"
import { useValueColors } from "../widget-style"
import { useOpenTarget } from "../panels"

/** Kanban, task calendar, my workload, overdue list and team workload. */

export function KanbanWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const query = useWidgetData(widget, context)
  const refresh = useRefreshWidgets(context.app)
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null)
  if (query.isPending) return <WidgetSkeleton type="kanban" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const data = query.data as DataOf<"kanban">
  if (data.type !== "kanban") return <Empty text={(query.data as { reason?: string }).reason ?? "No data."} />
  if (data.source === "table") return <TableBoard widget={widget} context={context} data={data} />
  const move = async (taskId: string, status: string) => {
    setError(null)
    if (context.preview) { setError("Moving cards works on the saved page, not in the builder."); return }
    const r = await moveKanbanTask({ app: context.app, page: context.page, widget_id: widget.id, task_id: taskId, status, ...(context.previewArgs ?? {}) })
    if (!r.ok) { setError(r.error); return }
    setMessage(`Moved to ${data.columns.find((c) => c.status === status)?.label ?? status}.`)
    await refresh()
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-kanban>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <p className="sr-only" aria-live="polite">{message}</p>
      <div className="grid min-h-0 flex-1 auto-cols-[minmax(12rem,1fr)] grid-flow-col gap-2 overflow-x-auto scrollbar-thin">
        {data.columns.map((col) => (
          <section key={col.status} aria-label={`${col.label} (${col.total})`} data-kanban-column={col.status}
            onDragOver={(e) => { if (data.can_drag && dragging) { e.preventDefault(); setOver(col.status) } }}
            onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/task"); if (id) void move(id, col.status) }}
            className={cn("flex min-h-0 flex-col rounded-lg bg-subtle p-1.5", over === col.status && "ring-2 ring-[var(--theme-primary)]")}>
            <h3 className="flex items-center justify-between px-1 pb-1 text-xs font-semibold text-fg">{col.label}<span className="num font-normal text-fg-muted">{formatCount(col.total)}</span></h3>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scrollbar-thin">
              {col.tasks.map((t) => (
                <li key={t.id} draggable={data.can_drag} data-kanban-card={t.id}
                  onDragStart={(e) => { e.dataTransfer.setData("text/task", t.id); e.dataTransfer.effectAllowed = "move"; setDragging(t.id) }}
                  onDragEnd={() => setDragging(null)}
                  className={cn("rounded-md border border-border bg-panel p-2 shadow-elev-1", data.can_drag && "cursor-grab", dragging === t.id && "opacity-50")}>
                  <button type="button" className="block w-full text-left text-sm font-medium text-fg hover:underline" onClick={() => setOpen({ id: t.id, title: t.title })}>{t.title || "Untitled task"}</button>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-2xs text-fg-muted">
                    {t.process && <span className="truncate">{t.process.name}</span>}
                    {col.status !== "completed" && col.status !== "cancelled" && <DueChip due={t.due_date} overdue={t.overdue} sla={t.sla_status} />}
                    <TaskTags tags={t.tags} max={3} />
                  </div>
                  {data.can_drag && (
                    <label className="mt-1 block">
                      <span className="sr-only">Move “{t.title}” to</span>
                      <select className="w-full rounded border border-border bg-panel px-1 py-0.5 text-2xs text-fg-muted" value={col.status} onChange={(e) => void move(t.id, e.target.value)} data-kanban-move>
                        {data.columns.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                      </select>
                    </label>
                  )}
                </li>
              ))}
              {!col.tasks.length && <li className="px-1 py-3 text-center text-2xs text-fg-subtle">Nothing here</li>}
            </ul>
          </section>
        ))}
      </div>
      <TaskDrawer task={open} onClose={() => { setOpen(null); void refresh() }} />
    </div>
  )
}

/**
 * A Kanban board of data table rows (kanban source "table"): one lane per value
 * of the lane column with its count and total; dragging a card (or the
 * keyboard-friendly "Move to" menu) writes the lane column. Clicking a card
 * raises card_click (event.card.id is the row id) for app rules, else opens
 * the record in a side panel.
 */
function TableBoard({ widget, context, data }: { widget: AppWidget; context: WidgetContext; data: DataOf<"kanban"> }) {
  const refresh = useRefreshWidgets(context.app)
  const click = useClickThrough(context, null, "card_click", widget.id)
  const opener = useOpenTarget()
  const valueColors = useValueColors()
  const [dragging, setDragging] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const total = (n: number | null | undefined) => (n === null || n === undefined ? null : data.sum_format === "currency" ? formatCurrency(n, data.currency ?? "USD", { maxFractionDigits: 0 }) : formatCount(n))
  const move = async (rowId: string, lane: string) => {
    setError(null)
    if (context.preview) { setError("Moving cards works on the saved page, not in the builder."); return }
    const r = await moveKanbanRow({ app: context.app, page: context.page, widget_id: widget.id, row_id: rowId, lane, ...(context.previewArgs ?? {}) })
    if (!r.ok) { setError(r.error); return }
    setMessage(`Moved to ${lane}.`)
    await refresh()
  }
  const openCard = (card: NonNullable<(typeof data.columns)[number]["cards"]>[number]) => {
    if (click) { click(card.id, { ...card.values, id: card.id, title: card.title }); return }
    if (data.table_id) opener?.open({ t: "record", table: data.table_id, row: card.id }, { mode: "panel_right", width: "md", motion: "auto" }, card.title)
  }
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-kanban="table">
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <p className="sr-only" aria-live="polite">{message}</p>
      <div className="grid min-h-0 flex-1 auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-2 overflow-x-auto scrollbar-thin">
        {data.columns.map((col) => (
          <section key={col.status} aria-label={`${col.label} (${col.total})`} data-kanban-column={col.status}
            onDragOver={(e) => { if (data.can_drag && dragging) { e.preventDefault(); setOver(col.status) } }}
            onDragLeave={() => setOver((o) => (o === col.status ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/row"); if (id) void move(id, col.status) }}
            className={cn("flex min-h-0 flex-col rounded-lg bg-subtle p-1.5", over === col.status && "ring-2 ring-[var(--theme-primary)]")}>
            <h3 className="flex items-baseline justify-between gap-2 px-1 pb-1 text-xs font-semibold text-fg">
              <span className="truncate">{col.label}<span className="num ml-1.5 font-normal text-fg-muted">{formatCount(col.total)}</span></span>
              {total(col.sum) && <span className="num shrink-0 font-medium text-fg-muted">{total(col.sum)}</span>}
            </h3>
            <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto scrollbar-thin">
              {(col.cards ?? []).map((card) => {
                const tint = card.badge ? valueColors[card.badge.toLowerCase()] : undefined
                return (
                  <li key={card.id} draggable={data.can_drag} data-kanban-card={card.id}
                    onDragStart={(e) => { e.dataTransfer.setData("text/row", card.id); e.dataTransfer.effectAllowed = "move"; setDragging(card.id) }}
                    onDragEnd={() => setDragging(null)}
                    className={cn("rounded-md border border-border bg-panel p-2 shadow-elev-1", data.can_drag && "cursor-grab", dragging === card.id && "opacity-50")}>
                    <div className="flex items-start justify-between gap-2">
                      <button type="button" className="min-w-0 truncate text-left text-sm font-medium text-fg hover:underline" onClick={() => openCard(card)}>{card.title}</button>
                      {card.badge && <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-2xs font-medium", !tint && TONE[card.badge_tone])} style={tint ? { color: tint, background: `color-mix(in oklab, ${tint} 14%, transparent)` } : undefined}>{card.badge}</span>}
                    </div>
                    {card.subtitle && <p className="truncate text-xs text-fg-muted">{card.subtitle}</p>}
                    {card.fields.length > 0 && (
                      <dl className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-2xs">
                        {card.fields.map((f, i) => f.progress !== undefined
                          ? <div key={i} className="flex w-full min-w-0 items-center gap-1.5" data-card-progress><dt className="shrink-0 text-fg-muted">{f.label}</dt><dd className="flex min-w-0 flex-1 items-center gap-1.5"><ProgressBar value={f.progress * 100} size="sm" label={f.label} className="flex-1" /><span className="num shrink-0 font-medium text-fg">{f.value}</span></dd></div>
                          : <div key={i} className="flex min-w-0 gap-1"><dt className="text-fg-muted">{f.label}</dt><dd className="num truncate font-medium text-fg">{f.value}</dd></div>)}
                      </dl>
                    )}
                    {card.footer && <p className="mt-1 truncate text-2xs text-fg-subtle">{card.footer}</p>}
                    {data.can_drag && (
                      <label className="mt-1 block">
                        <span className="sr-only">Move “{card.title}” to</span>
                        <select className="w-full rounded border border-border bg-panel px-1 py-0.5 text-2xs text-fg-muted" value={col.status} onChange={(e) => void move(card.id, e.target.value)} data-kanban-move>
                          {data.columns.map((c) => <option key={c.status} value={c.status}>{c.label}</option>)}
                        </select>
                      </label>
                    )}
                  </li>
                )
              })}
              {!(col.cards ?? []).length && <li className="px-1 py-3 text-center text-2xs text-fg-subtle">Nothing here</li>}
              {col.total > (col.cards ?? []).length && <li className="px-1 text-center text-2xs text-fg-subtle">+{formatCount(col.total - (col.cards ?? []).length)} more</li>}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

/** Calendar days for a month grid (Monday first), as YYYY-MM-DD. */
export function calendarDays(month: string, view: "month" | "week", today = new Date()): string[] {
  const [y, m] = month.split("-").map(Number)
  if (view === "week") {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
    return Array.from({ length: 7 }, (_, i) => new Date(d.getTime() + i * 86_400_000).toISOString().slice(0, 10))
  }
  const first = new Date(Date.UTC(y, m - 1, 1))
  const start = new Date(first.getTime() - ((first.getUTCDay() + 6) % 7) * 86_400_000)
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10))
  // Drop a trailing week that's wholly next month.
  return days[35].slice(0, 7) !== month ? days.slice(0, 35) : days
}

export function TaskCalendarWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"task_calendar">
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7))
  const query = useWidgetData(widget, context, { month })
  const [open, setOpen] = useState<{ id: string; title: string } | null>(null)
  const days = useMemo(() => calendarDays(month, c.view), [month, c.view])
  const shift = (n: number) => { const [y, m] = month.split("-").map(Number); setMonth(new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)) }
  if (query.isPending) return <WidgetSkeleton type="calendar" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const data = query.data as DataOf<"task_calendar">
  const byDay = new Map<string, typeof data.tasks>()
  for (const t of data.tasks ?? []) { const k = t.due.slice(0, 10); byDay.set(k, [...(byDay.get(k) ?? []), t]) }
  const today = new Date().toISOString().slice(0, 10)
  const title = new Date(`${month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })
  return (
    <div className="flex h-full min-h-0 flex-col gap-1" data-widget-calendar>
      {c.view === "month" && (
        <div className="flex items-center justify-between">
          <IconButton size="sm" label="Previous month" icon={<ChevronLeft />} onClick={() => shift(-1)} />
          <span className="text-sm font-medium text-fg" aria-live="polite">{title}</span>
          <IconButton size="sm" label="Next month" icon={<ChevronRight />} onClick={() => shift(1)} />
        </div>
      )}
      <div className="grid grid-cols-7 text-center text-2xs font-medium text-fg-muted" aria-hidden>{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
      <ol className={cn("grid min-h-0 flex-1 grid-cols-7 gap-px overflow-y-auto rounded-md bg-border-subtle", c.view === "week" ? "auto-rows-fr" : "auto-rows-[minmax(3.5rem,1fr)]")}>
        {days.map((d) => {
          const list = byDay.get(d) ?? []
          return (
            <li key={d} className={cn("min-w-0 overflow-hidden bg-panel p-1", d.slice(0, 7) !== month && c.view === "month" && "bg-subtle/60")} aria-label={`${d}: ${list.length} task${list.length === 1 ? "" : "s"}`}>
              <span className={cn("num inline-flex size-5 items-center justify-center rounded-full text-2xs", d === today ? "bg-primary text-primary-fg" : "text-fg-muted")}>{Number(d.slice(8))}</span>
              <ul className="space-y-0.5">
                {list.slice(0, 2).map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => setOpen({ id: t.id, title: t.title })} title={t.title}
                      className={cn("block w-full truncate rounded px-1 text-left text-2xs", t.overdue ? "bg-danger-wash text-danger" : t.status === "completed" ? "bg-success-wash text-success line-through" : "bg-primary-wash text-primary-text")}>{t.title}</button>
                  </li>
                ))}
                {list.length > 2 && <li className="truncate px-1 text-2xs text-fg-muted">+{list.length - 2} more</li>}
              </ul>
            </li>
          )
        })}
      </ol>
      <TaskDrawer task={open} onClose={() => setOpen(null)} />
    </div>
  )
}

export function MyWorkloadWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const query = useWidgetData(widget, context)
  if (query.isPending) return <WidgetSkeleton type="metric" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"my_workload">
  const tiles: Array<[string, number, string]> = [
    ["Open", d.open, "text-fg"], ["Overdue", d.overdue, d.overdue ? "text-danger" : "text-fg"], ["Due today", d.due_today, "text-fg"],
    ["Due this week", d.due_week, "text-fg"], ["At risk", d.at_risk, d.at_risk ? "text-warning" : "text-fg"], ["Done this week", d.completed_week, "text-success"],
  ]
  return (
    <dl className="grid h-full grid-cols-3 gap-2 @max-[16rem]:grid-cols-2" data-widget-workload>
      {tiles.map(([label, value, tone]) => (
        <div key={label} className="rounded-md bg-subtle px-2 py-1.5">
          <dd className={cn("num text-xl font-semibold", tone)}>{formatCount(value)}</dd>
          <dt className="text-2xs text-fg-muted">{label}</dt>
        </div>
      ))}
    </dl>
  )
}

export function OverdueWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const query = useWidgetData(widget, context)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"task_list">
  if (!d.tasks?.length) return <Empty text="Nothing overdue." />
  return <TaskRows tasks={d.tasks} total={d.total} context={context} openIn={(widget.config as WidgetConfig<"overdue_list">).open_in} />
}

export function TeamWorkloadWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"team_workload">
  const query = useWidgetData(widget, context)
  const click = useClickThrough(context, c.click, "row_click", widget.id)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"team_workload">
  if (!d.rows.length) return <Empty text={d.unassigned ? `${d.unassigned} unassigned tasks, none assigned yet.` : "No open tasks for this team — none in its queue or assigned to its members."} />
  const max = Math.max(...d.rows.map((r) => r.open), 1)
  return (
    <div className="space-y-1" data-widget-team-workload>
      <ul className="space-y-1">
        {d.rows.map((r) => {
          const body = (
            <>
              <Avatar name={r.name} src={r.avatar} size="sm" />
              <span className="w-28 shrink-0 truncate text-left text-sm text-fg">{r.name}</span>
              <span className="relative h-2 flex-1 overflow-hidden rounded-full bg-subtle" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--theme-chart-1)]" style={{ width: `${(r.open / max) * 100}%` }} />
                <span className="absolute inset-y-0 left-0 rounded-full bg-danger" style={{ width: `${(r.overdue / max) * 100}%` }} />
              </span>
              <span className="num w-16 shrink-0 text-right text-xs text-fg-muted">{r.open}{r.overdue ? <span className="text-danger"> · {r.overdue}</span> : null}</span>
            </>
          )
          return (
            <li key={r.id}>
              {click
                ? <button type="button" onClick={() => click(r.id)} aria-pressed={isActive(context, c.click, r.id)} className={cn("flex w-full items-center gap-2 rounded px-1 py-0.5 hover:bg-subtle", isActive(context, c.click, r.id) && "bg-primary-wash")} data-click-value={r.id}>{body}</button>
                : <div className="flex items-center gap-2 px-1 py-0.5" aria-label={`${r.name}: ${r.open} open, ${r.overdue} overdue`}>{body}</div>}
            </li>
          )
        })}
      </ul>
      <p className="text-2xs text-fg-subtle">Open · <span className="text-danger">overdue</span>{d.unassigned ? ` · ${d.unassigned} unassigned` : ""}</p>
    </div>
  )
}
