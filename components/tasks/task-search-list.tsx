"use client"

/**
 * The Completed and All views of My tasks and Following: one server page at a
 * time from `tasks.search` (lib/services/task-search.ts — the same search the
 * embeddable task list uses), so thousands of completed tasks stay fast:
 * search (title, task id, workflow, requester), completed window (last
 * 7 / 30 / 90 days or custom), sort (completed date by default, due,
 * priority, created, updated, title) and keyset paging. Rows show the outcome
 * and the completed date; a row opens the task lists' quick panel
 * (read-only once the task is closed — the panel's own server flags).
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusPill } from "@/components/ui/badge"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { UnreadDot, unreadTitleClass } from "@/components/tasks/unread-dot"
import { serverQuery } from "@/lib/server-read"
import { formatDay } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { TaskTags } from "@/components/tasks/task-tags"

export type TaskSearchStatus = "open" | "completed" | "any"
type Sort = "completed" | "due" | "priority" | "created" | "updated" | "title"

const WINDOWS = [
  { value: "any", label: "Any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "custom", label: "Custom dates" },
] as const
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "completed", label: "Completed date" }, { value: "due", label: "Due date" }, { value: "priority", label: "Priority" },
  { value: "created", label: "Created" }, { value: "updated", label: "Updated" }, { value: "title", label: "Title" },
]

interface Row {
  id: string; title: string; status: string; priority: string | null; due_date: string | null; completed_at: string | null; outcome: string | null
  unread?: boolean; tags?: string[] | null; workflow?: { id: string; name: string } | null; assignee?: { display_name: string | null; email: string | null } | null
}
interface Page { tasks: Row[]; total: number; capped: boolean; nextCursor: string | null }

/** The status switch shown next to search on My tasks and Following. */
export const TASK_SEARCH_STATUS_OPTIONS = [
  { value: "open" as const, text: "Open" },
  { value: "completed" as const, text: "Completed" },
  { value: "any" as const, text: "All" },
]

export function TaskSearchList({ tab, status, search }: { tab: "mine" | "following"; status: Exclude<TaskSearchStatus, "open">; search: string }) {
  const [windowValue, setWindowValue] = useState<(typeof WINDOWS)[number]["value"]>("any")
  const [from, setFrom] = useState<string | null>(null)
  const [to, setTo] = useState<string | null>(null)
  const [sort, setSort] = useState<Sort>("completed")
  const [dir, setDir] = useState<"asc" | "desc">("desc")
  const [size, setSize] = useState(25)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)

  // Any change of the query starts again at page 1.
  useEffect(() => { setCursors([null]); setPage(1); setOpen(null) }, [tab, status, search, windowValue, from, to, sort, dir, size])

  const completed = windowValue === "custom"
    ? { completedFrom: from ?? undefined, completedTo: to ?? undefined }
    : windowValue === "any" ? {} : { completedFrom: new Date(Date.now() - Number(windowValue) * 86_400_000).toISOString() }
  const args = { tab, status, search: search.trim() || undefined, sort, dir, size, cursor: sort === "title" ? null : cursors[page - 1] ?? null, page, ...completed }
  const { data, isPending, error, isFetching } = useQuery({
    queryKey: ["tasks", "search", args],
    queryFn: async () => (await serverQuery("tasks.search", args)) as Page,
    placeholderData: (prev) => prev,
  })

  const rows = data?.tasks ?? []
  const total = data?.total ?? 0
  const first = total ? (page - 1) * size + 1 : 0
  const last = Math.min(total, (page - 1) * size + rows.length)
  const hasNext = sort === "title" ? rows.length === size && (data?.capped || last < total) : Boolean(data?.nextCursor)

  return (
    <div className="space-y-2" data-task-search-list={tab} data-status={status}>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <label className="flex items-center gap-1">Completed
          <select className="h-8 rounded-md border border-border bg-panel px-2" value={windowValue} onChange={(e) => setWindowValue(e.target.value as typeof windowValue)} aria-label="Completed">
            {WINDOWS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
          </select>
        </label>
        {windowValue === "custom" && <>
          <input type="date" aria-label="Completed from" className="h-8 rounded-md border border-border bg-panel px-2" onChange={(e) => setFrom(e.target.value ? new Date(`${e.target.value}T00:00:00`).toISOString() : null)} />
          <input type="date" aria-label="Completed to" className="h-8 rounded-md border border-border bg-panel px-2" onChange={(e) => setTo(e.target.value ? new Date(new Date(`${e.target.value}T00:00:00`).getTime() + 86_400_000).toISOString() : null)} />
        </>}
        <select className="h-8 rounded-md border border-border bg-panel px-2" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort by">
          {SORTS.map((s) => <option key={s.value} value={s.value}>Sort: {s.label}</option>)}
        </select>
        <Button size="sm" variant="ghost" onClick={() => setDir((d) => (d === "asc" ? "desc" : "asc"))} aria-label={dir === "asc" ? "Ascending" : "Descending"}>{dir === "asc" ? "↑" : "↓"}</Button>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-danger">{(error as Error).message || "The tasks couldn’t be loaded."}</p>
      ) : isPending ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : (
        <ul className={cn("divide-y divide-border rounded-md border border-border transition-opacity", isFetching && "opacity-60")}>
          {rows.length === 0 && <li className="px-3 py-6 text-center text-sm text-fg-muted">{search ? `No ${status === "completed" ? "completed " : ""}tasks match “${search}”.` : status === "completed" ? "No completed tasks yet." : "No tasks."}</li>}
          {rows.map((t) => (
            <li key={t.id} data-task-search-row={t.id}>
              <div className="flex items-center gap-2 px-3 py-2">
                <button type="button" className="text-fg-muted" aria-expanded={open === t.id} aria-label={`Details: ${t.title}`} onClick={() => setOpen((o) => (o === t.id ? null : t.id))}>
                  {open === t.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                </button>
                <UnreadDot unread={t.unread} />
                <div className="min-w-0 flex-1">
                  <Link href={`/tasks/${t.id}`} className={cn("block truncate text-sm text-fg hover:underline", unreadTitleClass(t.unread) || "font-medium")}>{t.title || "Untitled task"}</Link>
                  <div className="flex flex-wrap items-center gap-x-3 text-xs text-fg-muted">
                    {t.workflow?.name && <span>{t.workflow.name}</span>}
                    {tab === "following" && <span>{t.assignee?.display_name || t.assignee?.email || "Unassigned"}</span>}
                    {t.completed_at ? <span data-completed-at>Completed {formatDay(t.completed_at)}{t.outcome ? ` · ${t.outcome.replace(/[_-]+/g, " ")}` : ""}</span>
                      : t.due_date ? <span>Due {formatDay(t.due_date)}</span> : null}
                    {t.priority && <PriorityBadge priority={t.priority} />}
                    <TaskTags tags={t.tags} max={3} />
                  </div>
                </div>
                <StatusPill status={t.status} />
              </div>
              {open === t.id && <div className="border-t border-border-subtle px-3 py-3"><TaskDetailPanel taskId={t.id} title={t.title} compact onClose={() => setOpen(null)} /></div>}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
        <span>{total ? `${first}–${last} of ${data?.capped ? "1,000+" : total.toLocaleString("en-US")}` : ""}</span>
        <div className="flex items-center gap-1">
          <select aria-label="Rows per page" className="h-7 rounded-md border border-border bg-panel px-1" value={size} onChange={(e) => setSize(Number(e.target.value))}>
            {[10, 25, 50].map((n) => <option key={n} value={n}>{n} per page</option>)}
          </select>
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
          <Button size="sm" variant="ghost" disabled={!hasNext} onClick={() => { if (data?.nextCursor) setCursors((cs) => [...cs.slice(0, page), data.nextCursor]); setPage((p) => p + 1) }}>Next</Button>
        </div>
      </div>
    </div>
  )
}
