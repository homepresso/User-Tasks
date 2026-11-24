"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { CheckCircle2, FileText, Play, ShieldCheck } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/input"
import { formatRelative } from "@/lib/format/date"
import { formatCount } from "@/lib/format/number"
import type { AppWidget, WidgetConfig } from "@/lib/apps/schema"
import { cn } from "@/lib/utils"
import { Empty, WidgetError, WidgetSkeleton, isActive, useClickThrough, useWidgetData, type DataOf, type WidgetContext } from "./kit"

/** Team members, org chart, people directory and activity feed. */

export function TeamMembersWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const c = widget.config as WidgetConfig<"team_members">
  const query = useWidgetData(widget, context)
  const click = useClickThrough(context, c.click, "row_click", widget.id)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"team_members">
  if (!d.members.length) return <Empty text="No members to show." />
  return (
    <ul className="divide-y divide-border-subtle" data-widget-team-members aria-label={d.team ? `${d.team} members` : "Team members"}>
      {d.members.map((m) => {
        const body = (
          <>
            <span className="relative shrink-0">
              <Avatar name={m.name} src={m.avatar} size="md" />
              {c.show_presence && <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-[var(--theme-card-bg)]", m.online ? "bg-success" : "bg-fg-subtle/40")} aria-hidden />}
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm font-medium text-fg">{m.name}</span>
              <span className="block truncate text-xs text-fg-muted">{c.show_presence ? (m.online ? "Online" : m.last_seen ? `Seen ${formatRelative(m.last_seen)}` : "Not seen yet") : m.email}</span>
            </span>
            {c.show_workload && <span className="num shrink-0 text-xs text-fg-muted">{m.open} open{m.overdue ? <span className="text-danger"> · {m.overdue} late</span> : null}</span>}
          </>
        )
        return (
          <li key={m.id}>
            {click ? <button type="button" onClick={() => click(m.id)} aria-pressed={isActive(context, c.click, m.id)} className={cn("flex w-full items-center gap-2 py-1.5 hover:bg-subtle", isActive(context, c.click, m.id) && "bg-primary-wash")} data-click-value={m.id}>{body}</button>
              : <div className="flex items-center gap-2 py-1.5">{body}</div>}
          </li>
        )
      })}
    </ul>
  )
}

function PersonChip({ p, me = false }: { p: { name: string; avatar: string | null; job_title: string | null }; me?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5", me ? "border-primary bg-primary-wash" : "border-border bg-panel")}>
      <Avatar name={p.name} src={p.avatar} size="sm" />
      <span className="min-w-0"><span className="block truncate text-xs font-medium text-fg">{p.name}</span>{p.job_title && <span className="block truncate text-2xs text-fg-muted">{p.job_title}</span>}</span>
    </div>
  )
}

export function OrgChartWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const query = useWidgetData(widget, context)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"org_chart">
  return (
    <div className="flex h-full min-h-0 flex-col items-center gap-2 overflow-auto scrollbar-thin" data-widget-org-chart>
      {[...d.managers].reverse().map((m) => <div key={m.id} className="w-56"><PersonChip p={m} /></div>)}
      {d.managers.length > 0 && <span className="h-3 w-px bg-border" aria-hidden />}
      <div className="flex max-w-full flex-wrap justify-center gap-2">
        <div className="w-56"><PersonChip p={d.person} me /></div>
        {d.peers.slice(0, 4).map((p) => <div key={p.id} className="w-44 opacity-80"><PersonChip p={p} /></div>)}
      </div>
      {d.reports.length > 0 && <span className="h-3 w-px bg-border" aria-hidden />}
      <ul className="flex max-w-full flex-wrap justify-center gap-2" aria-label="Reports">
        {d.reports.map((r) => <li key={r.id} className="w-44" style={{ marginLeft: (r.depth - 1) * 8 }}><PersonChip p={r} /></li>)}
      </ul>
      {!d.reports.length && !d.managers.length && <p className="text-xs text-fg-muted">No manager or reports recorded.</p>}
    </div>
  )
}

export function PeopleDirectoryWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(0)
  useEffect(() => { const t = setTimeout(() => { setSearch(q); setPage(0) }, 300); return () => clearTimeout(t) }, [q])
  const query = useWidgetData(widget, context, { ...(search ? { q: search } : {}), page })
  const d = query.data as DataOf<"people_directory"> | undefined
  return (
    <div className="flex h-full min-h-0 flex-col gap-2" data-widget-people>
      <SearchInput value={q} onValueChange={setQ} placeholder="Search people…" size="sm" aria-label="Search people" />
      {query.isPending ? <WidgetSkeleton type="list" /> : query.error ? <WidgetError error={query.error} retry={() => void query.refetch()} /> : !d?.people.length ? <Empty text="No one matches." /> : (
        <ul className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] content-start gap-2 overflow-y-auto scrollbar-thin">
          {d.people.map((p) => (
            <li key={p.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <Avatar name={p.name} src={p.avatar} size="lg" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-fg">{p.name}</span>
                <span className="block truncate text-xs text-fg-muted">{[p.job_title, p.department].filter(Boolean).join(" · ") || p.email}</span>
                {p.email && <a href={`mailto:${p.email}`} className="block truncate text-2xs text-primary-text hover:underline">{p.email}</a>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {d && (d.next !== null || page > 0) && (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span>{formatCount(d.total)} people</span>
          <span className="flex gap-1"><Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</Button><Button size="sm" variant="ghost" disabled={d.next === null} onClick={() => setPage(page + 1)}>Next</Button></span>
        </div>
      )}
    </div>
  )
}

const FEED_ICON = { task: CheckCircle2, run: Play, submission: FileText, audit: ShieldCheck } as const

export function ActivityFeedWidget({ widget, context }: { widget: AppWidget; context: WidgetContext }) {
  const query = useWidgetData(widget, context)
  if (query.isPending) return <WidgetSkeleton type="list" />
  if (query.error) return <WidgetError error={query.error} retry={() => void query.refetch()} />
  const d = query.data as DataOf<"activity_feed">
  if (!d.items.length) return <Empty text="No recent activity." />
  return (
    <ol className="relative space-y-2 border-l border-border-subtle pl-4" data-widget-activity-feed>
      {d.items.map((i) => {
        const Icon = FEED_ICON[i.kind]
        return (
          <li key={i.id} className="relative">
            <span className="absolute -left-[1.4rem] top-0.5 flex size-4 items-center justify-center rounded-full bg-panel text-fg-muted"><Icon className="size-3.5" aria-hidden /></span>
            <div className="flex items-baseline justify-between gap-2">
              {i.href ? <Link href={i.href} target={context.embed ? "_blank" : undefined} className="truncate text-sm font-medium text-fg hover:underline">{i.title}</Link> : <span className="truncate text-sm font-medium text-fg">{i.title}</span>}
              <time className="shrink-0 text-2xs text-fg-muted" dateTime={i.at}>{formatRelative(i.at)}</time>
            </div>
            {i.subtitle && <p className="truncate text-xs text-fg-muted">{i.subtitle}</p>}
          </li>
        )
      })}
    </ol>
  )
}
