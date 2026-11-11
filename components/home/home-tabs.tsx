"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bell, CheckSquare, ChevronRight, Clock, ClipboardList, Eye, FileText, GitBranch, Inbox, ListChecks, Star } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { IconButton } from "@/components/ui/icon-button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Select } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs } from "@/components/ui/tabs"
import { Tooltip } from "@/components/ui/tooltip"
import { TableScroll } from "@/components/ui/table"
import { serverQuery } from "@/lib/server-read"
import { usePermissions } from "@/lib/permissions-context"
import { setHomePreferences } from "@/app/actions/home"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { FollowButton, HOME_QUERY_KEY, Pager, People, ProgressPill, RowsSkeleton, SearchBox, StagePopover, When, rowClass, useDebounced } from "./shared"
import { SubmissionDialog } from "./submission-dialog"
import { FavoriteStar, useFavoriteForms } from "./favorite-star"
import { taskFormPath } from "./task-row-details"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { SortButton } from "@/components/tasks/sortable-header"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { DialogBody } from "@/components/ui/dialog"
import { useListSort } from "@/hooks/use-list-sort"
import { usePersistedSwitch } from "@/hooks/use-status-filter"
import type { SortState } from "@/lib/tasks/list-sort"
import { favoriteFormsView } from "@/lib/home/favorites"
import { formHref } from "@/lib/forms/form-page-url"
import type { FollowedRun, HomeTask, MySubmission } from "@/lib/services/home"
import { QueuedTaskActions, TaskStatusPill } from "@/components/tasks/queued-task-actions"
import { ProcessViewIconLink, TaskQuickActions, TaskQuickActionsToggle } from "@/components/tasks/task-quick-actions"
import { TimelineIconButton } from "@/components/timeline/timeline-sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { ListRefreshButton } from "@/components/tasks/list-refresh-button"
import { QueueRulesButton } from "@/components/tasks/queue-rules-dialog"
import { QUEUED_STATUS } from "@/lib/tasks/unified-list"

export type HomeTab = "tasks" | "following" | "submissions" | "favorites"

const LIMIT = 25

export const HOME_TABS: Array<{ id: HomeTab; label: string; perm?: string }> = [
  { id: "tasks", label: "My tasks", perm: "tasks.view_own" },
  { id: "following", label: "Following" },
  { id: "submissions", label: "My submissions", perm: "forms.submit" },
  { id: "favorites", label: "Favourite forms", perm: "forms.submit" },
]

/** localStorage key of the person's chosen Home tab. */
export function homeTabKey(userId: string | null | undefined): string {
  return `usertasks.home.tab.${userId || "anon"}`
}

/**
 * A stored tab choice → a tab this person has, or null (keep the default).
 * The retired "queue" tab (its tasks are in My tasks now, status Queued)
 * opens My tasks.
 */
export function restoreHomeTab(saved: string | null | undefined, available: ReadonlyArray<{ id: HomeTab }>): HomeTab | null {
  const id = saved === "queue" ? "tasks" : saved
  return id && available.some((t) => t.id === id) ? id as HomeTab : null
}

/** Id base of the tab bar: tabs are `home-tab-<id>`, panels `home-panel-<id>`. */
export const HOME_TABS_ID = "home"

/** Underline tabs above the list, with optional counts. */
export function HomeTabBar({ tabs, value, onChange, counts }: {
  tabs: typeof HOME_TABS
  value: HomeTab
  onChange: (tab: HomeTab) => void
  counts?: Partial<Record<HomeTab, number>>
}) {
  return (
    <Tabs<HomeTab> aria-label="Home lists" idBase={HOME_TABS_ID} value={value} onValueChange={onChange}
      items={tabs.map((t) => ({ value: t.id, label: t.label, count: counts?.[t.id] }))} />
  )
}

function useHomeList<T>(name: "home.myTasks" | "home.following" | "home.submissions", args: Record<string, unknown>) {
  return useQuery({
    queryKey: [...HOME_QUERY_KEY, name, args],
    queryFn: async () => (await serverQuery(name, args as never)) as unknown as { total: number } & T,
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

/**
 * A list's column tracks with a readable minimum each: `[min, fr]` grows
 * from `min` rem, a number is a fixed width in rem. Gives the grid template
 * and the narrowest the list gets (tracks + 0.75rem gaps + 1rem padding a
 * side) — below that it scrolls sideways instead of squashing its columns.
 */
export function listColumns(tracks: Array<number | [min: number, fr: number]>): { cols: string; minWidth: string } {
  const cols = tracks.map((t) => typeof t === "number" ? `${t}rem` : `minmax(${t[0]}rem,${t[1]}fr)`).join(" ")
  const min = tracks.reduce<number>((sum, t) => sum + (typeof t === "number" ? t : t[0]), 0) + 0.75 * (tracks.length - 1) + 2
  return { cols, minWidth: `${min}rem` }
}

/** States that span the list (loading, empty, error): stay in view while it scrolls. */
function Span({ children }: { children: React.ReactNode }) {
  return <div className="ds-table-detail">{children}</div>
}

/**
 * The list's frame. From md up the rows are a grid with readable column
 * minimums; when the space is narrower (sidebar, docked Agent, a small
 * window) the list scrolls sideways in its own region — the item name stays
 * in view — instead of squashing. Phones stack each row as a card.
 */
function ListFrame({ header, children, toolbar, footer, minWidth, label }: {
  header?: React.ReactNode
  children: React.ReactNode
  toolbar: React.ReactNode
  footer?: React.ReactNode
  minWidth: string
  label: string
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center @xl:justify-between">{toolbar}</div>
      {/* The View stage popover is portalled, so the scroll region never clips it. */}
      <div className="rounded-lg border border-border bg-panel text-fg">
        <TableScroll bare label={label} stickyFirstColumn frameClassName="rounded-[inherit]">
          <div className="md:min-w-[var(--list-min)]" style={{ "--list-min": minWidth } as React.CSSProperties} data-home-list>
            {header}
            {children}
          </div>
        </TableScroll>
        {footer}
      </div>
    </div>
  )
}

/**
 * The list's column header: a strong, theme-driven band (the primary fill
 * with the theme's on-primary text, held to AA by the theme's legibility
 * pass — lib/theme/contrast.ts onPrimary/primary). Hidden on phones, where
 * rows stack with their own labels.
 */
function HeaderRow<K extends string>({ cols, labels, sortKeys, sort, onSort }: {
  cols: string
  labels: string[]
  /** Sortable columns: the label index → its sort key (the others are plain labels). */
  sortKeys?: Partial<Record<number, K>>
  sort?: SortState<K> | null
  onSort?: (key: K) => void
}) {
  const sortable = Boolean(sortKeys && onSort)
  return (
    <div className="hidden h-8 items-center rounded-t-[calc(var(--ds-radius-md)-1px)] bg-primary px-4 text-xs font-medium text-primary-fg md:grid md:gap-3"
      style={{ gridTemplateColumns: cols }} aria-hidden={sortable ? undefined : true} role={sortable ? "group" : undefined}
      aria-label={sortable ? "Sort the list" : undefined} data-home-list-header>
      {labels.map((l, i) => {
        const key = sortKeys?.[i]
        // The first column stays in view while the list scrolls sideways.
        const first = i === 0 ? { "data-sticky-cell": "", className: cn("truncate", stickyCellClass, "flex items-center self-stretch bg-primary") } : { className: "truncate" }
        return key && onSort
          ? <span key={`${l}-${i}`} {...first}><SortButton sortKey={key} sort={sort ?? null} onSort={onSort} className="text-primary-fg hover:text-primary-fg">{l}</SortButton></span>
          : <span key={`${l}-${i}`} {...first} aria-hidden>{l}</span>
      })}
    </div>
  )
}

function Mobile({ label }: { label: string }) {
  return <span className="mr-1 text-fg-muted md:hidden">{label}:</span>
}

/**
 * The row's first cell, kept in view while the list scrolls sideways (md
 * up): it covers the row's left padding and takes the row's background.
 */
const stickyCellClass = "md:-my-1.5 md:-ml-4 md:py-1.5 md:pl-4 md:min-w-0"

function ErrorRow({ message }: { message: string }) {
  return <Span><EmptyState size="sm" variant="error" title="This list couldn’t be loaded" description={message} /></Span>
}

/* ── Task rows (My tasks) ───────────────────────────────────────────── */

function DueCell({ task }: { task: HomeTask }) {
  if (!task.due_date) return <span className="text-fg-muted">No due date</span>
  const late = task.overdue || task.sla_status === "breached"
  return (
    <Tooltip content={formatAbsolute(task.due_date)}>
      <span tabIndex={0} className={cn("num inline-flex items-center gap-1 whitespace-nowrap", late ? "text-danger" : "text-fg")}>
        {late && <Clock className="size-3.5 shrink-0" aria-hidden="true" />}
        {formatRelative(task.due_date)}
        {task.overdue && <span className="sr-only"> (overdue)</span>}
        {task.sla_status === "breached" ? " · SLA breached" : task.sla_status === "warning" ? " · SLA near" : ""}
      </span>
    </Tooltip>
  )
}

/** "Open task form": straight to the task page's form. A separate tab stop from the row's disclosure. */
function OpenFormButton({ task }: { task: HomeTask }) {
  return (
    <Tooltip content="Open task form">
      <Link href={taskFormPath(task.id)} aria-label={`Open task form: ${task.title}`}
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })} data-home-open-form={task.id}>
        <ClipboardList className="size-3.5" aria-hidden="true" />
      </Link>
    </Tooltip>
  )
}

/**
 * The row's title cell: a disclosure button (Enter / Space toggle) that
 * expands the row; the task's own link sits in the expanded details.
 */
function Disclosure({ open, onToggle, controls, title, ref }: { open: boolean; onToggle: () => void; controls: string; title: string; ref?: React.Ref<HTMLButtonElement> }) {
  return (
    <span data-sticky-cell className={cn("flex min-w-0 items-center self-stretch", stickyCellClass)}>
      <button ref={ref} type="button" onClick={onToggle} aria-expanded={open} aria-controls={open ? controls : undefined}
        className="flex min-w-0 items-center gap-1.5 rounded-sm text-left font-medium text-fg" data-home-task-toggle title={title}>
        <ChevronRight className={cn("size-3.5 shrink-0 text-fg-muted transition-transform duration-[var(--ds-dur-fast)]", open && "rotate-90")} aria-hidden="true" />
        <span className="truncate">{title}</span>
      </button>
    </span>
  )
}

/**
 * One expandable task row: the whole row toggles the details; inner controls
 * keep their own clicks. The row's last cell holds Process view (workflow
 * tasks), Open task form and the Actions toggle — quick actions open under
 * the row (a bottom sheet on phones), separate from the details.
 */
function TaskRow({ task, cols, children, rowAttr, onNotice }: { task: HomeTask; cols: string; children: React.ReactNode; rowAttr: Record<string, string>; onNotice: (message: string) => void }) {
  const [open, setOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const mobile = useIsMobile()
  const baseId = useId()
  const detailsId = `${baseId}-details`
  const actionsId = `${baseId}-actions`
  const toggleRef = useRef<HTMLButtonElement>(null)
  return (
    <li {...rowAttr} data-expanded={open || undefined}>
      <div className={rowClass("cursor-pointer")} style={{ gridTemplateColumns: cols }}
        onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button, input, select, [role='dialog']")) setOpen((v) => !v) }}>
        <Disclosure ref={toggleRef} open={open} onToggle={() => setOpen((v) => !v)} controls={detailsId} title={task.title} />
        {children}
        <span className="flex flex-nowrap items-center gap-0.5 md:justify-end">
          {task.run_id && <ProcessViewIconLink runId={task.run_id} title={task.title} />}
          {task.run_id && <TimelineIconButton target={{ taskId: task.id }} title={task.title} />}
          <OpenFormButton task={task} />
          <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
        </span>
      </div>
      {mobile ? (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" title={task.title} description="Task details" data-home-task-sheet>
            <DialogBody className="overflow-y-auto">
              <TaskDetailPanel id={detailsId} taskId={task.id} title={task.title} compact />
            </DialogBody>
          </SheetContent>
        </Sheet>
      ) : open && (
        <div className="border-t border-border-subtle bg-subtle" data-home-task-details={task.id}>
          <div className="ds-table-detail px-4 py-3">
            <TaskDetailPanel id={detailsId} taskId={task.id} title={task.title} compact
              onClose={() => { setOpen(false); toggleRef.current?.focus() }} />
          </div>
        </div>
      )}
      <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile={mobile}
        taskId={task.id} title={task.title} queueAction={task.action ?? null} onDone={onNotice} />
    </li>
  )
}

/* ── My tasks (queued included) ──────────────────────────────────────── */

// Task, Process, Stage / team, Due / SLA, Priority, Status, Assigned, actions.
const TASK_LIST = listColumns([[16, 2.2], [10, 1.2], [9, 1.1], [8, 1], 6, [9, 1.7], [7, 0.8], 7.5])
const TASK_COLS = TASK_LIST.cols

/**
 * My tasks: everything assigned to me plus what waits for my response —
 * shown with status Queued and inline Accept / Decline (Claim for a team's
 * unclaimed task). The Task queue tab it replaced is gone.
 */
type HomeSortKey = "title" | "status" | "priority" | "due" | "assigned"
const HOME_SORT_KEYS: readonly HomeSortKey[] = ["title", "status", "priority", "due", "assigned"]
/** Header label index → sort key (Task, Due, Priority, Status, Assigned). */
const HOME_SORT_COLUMNS: Partial<Record<number, HomeSortKey>> = { 0: "title", 3: "due", 4: "priority", 5: "status", 6: "assigned" }
const HOME_SORT_OPTIONS = [
  { value: "", label: "Due date (default)" },
  { value: "due", label: "Due date ↑" }, { value: "-due", label: "Due date ↓" },
  { value: "priority", label: "Priority" }, { value: "status", label: "Status" },
  { value: "title", label: "Task A–Z" }, { value: "-assigned", label: "Newest" },
]

export function MyTasksTab() {
  const [search, setSearch] = useState("")
  // Column sort (headers on wide lists, a select on narrow ones); paging follows it (server-side).
  const { sort, toggle: toggleSort, setSort } = useListSort<HomeSortKey>("home-my-tasks", HOME_SORT_KEYS)
  const [show, setShow] = useState<"all" | "queued">("all")
  // Completed tasks hidden by default; "Show completed" brings them back (remembered per user).
  const [showCompleted, setShowCompleted] = usePersistedSwitch("home-my-tasks:show-completed")
  const [offset, setOffset] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const q = useDebounced(search)
  useEffect(() => setOffset(0), [q, sort?.key, sort?.dir, show, showCompleted])
  const { data, isPending, isError, error } = useHomeList<{ tasks: HomeTask[] }>("home.myTasks", {
    search: q || undefined, limit: LIMIT, offset, includeQueued: true, ...(show === "queued" ? { queuedOnly: true } : {}),
    ...(sort ? { columnSort: sort } : {}), ...(showCompleted && show === "all" ? { includeClosed: true } : {}),
  })
  return (
    <ListFrame minWidth={TASK_LIST.minWidth} label="My tasks"
      footer={data && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
      toolbar={<>
        <SearchBox value={search} onChange={setSearch} placeholder="Search my tasks" label="Search my tasks" />
        {notice && <p role="status" className="text-xs text-success">{notice}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <QueueRulesButton />
          <ListRefreshButton queryKeys={[[...HOME_QUERY_KEY, "home.myTasks"]]} />
          <label className="flex items-center gap-2 text-xs text-fg-muted">
            Show
            <Select size="sm" wrapperClassName="w-32" value={show} onChange={(e) => setShow(e.target.value as typeof show)}
              options={[{ value: "all", label: "All" }, { value: "queued", label: "Queued" }]} />
          </label>
          {show === "all" && (
            <Switch size="sm" checked={showCompleted} onCheckedChange={setShowCompleted} data-show-completed
              label={<span className="whitespace-nowrap text-xs text-fg-muted">Show completed</span>} />
          )}
          {show === "all" && (
            <label className="flex items-center gap-2 text-xs text-fg-muted md:hidden">
              Sort
              <Select size="sm" wrapperClassName="w-40" value={sort ? `${sort.dir === "desc" ? "-" : ""}${sort.key}` : ""}
                onChange={(e) => { const v = e.target.value; setSort(v ? { key: v.replace(/^-/, "") as HomeSortKey, dir: v.startsWith("-") ? "desc" : "asc" } : null) }}
                options={HOME_SORT_OPTIONS} />
            </label>
          )}
        </div>
      </>}
      header={<HeaderRow cols={TASK_COLS} labels={["Task", "Process", "Stage / team", "Due / SLA", "Priority", "Status", "Assigned", ""]}
        sortKeys={show === "all" ? HOME_SORT_COLUMNS : undefined} sort={sort} onSort={toggleSort} />}>
      {isPending ? <Span><RowsSkeleton /></Span> : isError ? <ErrorRow message={(error as Error).message} /> : !data?.tasks.length ? (
        q ? (
          <Span><EmptyState size="sm" variant="no-results" title={`No tasks match “${q}”`} description="Try another search."
            action={{ label: "Clear search", onClick: () => setSearch("") }} /></Span>
        ) : show === "queued" ? (
          <Span><EmptyState size="sm" variant="first-run" icon={ListChecks} title="Nothing queued for you"
            description="Tasks sent to you for acceptance, and unclaimed tasks of your teams, show here with status Queued."
            action={{ label: "Show all my tasks", onClick: () => setShow("all") }} /></Span>
        ) : (
          <Span><EmptyState size="sm" variant="first-run" icon={CheckSquare} title="You’re all caught up"
            description="Nothing is assigned to you right now. Tasks waiting for you to accept or claim show here too, with status Queued."
            action={{ label: "Open all tasks", href: "/tasks" }} /></Span>
        )
      ) : (
        <ul className="divide-y divide-border-subtle">
          {data.tasks.map((t) => (
            <TaskRow key={t.id} task={t} cols={TASK_COLS} onNotice={setNotice} rowAttr={{ "data-home-task": t.id, ...(t.action ? { "data-home-queued": t.action } : {}) }}>
              <span className="truncate" title={t.process?.name}><Mobile label="Process" />{t.process?.name ?? <span className="text-fg-muted">—</span>}</span>
              <span className="truncate"><Mobile label="Stage" />{[t.stage, t.team ? `${t.team} team` : null].filter(Boolean).join(" · ") || <span className="text-fg-muted">—</span>}</span>
              <span className="whitespace-nowrap"><Mobile label="Due" /><DueCell task={t} /></span>
              <span><PriorityBadge priority={t.priority} /></span>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                <TaskStatusPill status={t.action ? QUEUED_STATUS : t.status} />
                {t.action && <QueuedTaskActions task={t} action={t.action} onDone={setNotice} />}
              </span>
              <span className="whitespace-nowrap"><Mobile label="Assigned" /><When at={t.assigned_at} /></span>
            </TaskRow>
          ))}
        </ul>
      )}
    </ListFrame>
  )
}

/* ── Following / My submissions: shared bits ─────────────────────────── */

type StatusFilter = "all" | "active" | "completed" | "failed"

function StatusFilterSelect({ value, onChange }: { value: StatusFilter; onChange: (v: StatusFilter) => void }) {
  return (
    <Select size="sm" wrapperClassName="@xl:w-44" value={value} onChange={(e) => onChange(e.target.value as StatusFilter)} aria-label="Status"
      options={[{ value: "all", label: "All" }, { value: "active", label: "In progress" }, { value: "completed", label: "Completed" }, { value: "failed", label: "Failed or cancelled" }]} />
  )
}

function FlowLink({ runId }: { runId: string }) {
  return (
    <Button size="sm" variant="secondary" asChild>
      <Link href={`/home/runs/${runId}`} data-view-flow={runId}><GitBranch className="size-3.5" aria-hidden /> Process view</Link>
    </Button>
  )
}

/* ── Following ───────────────────────────────────────────────────────── */

// Process, Current stage, Status, Started, Updated, People involved, actions.
const FOLLOW_LIST = listColumns([[15, 1.8], [11, 1.4], 7.5, [6.5, 0.9], [6.5, 0.9], [9, 1.1], 12])
const FOLLOW_COLS = FOLLOW_LIST.cols

function AutoFollowToggle() {
  const queryClient = useQueryClient()
  const { data } = useQuery({ queryKey: [...HOME_QUERY_KEY, "preferences"], queryFn: () => serverQuery("home.preferences"), staleTime: 60_000 })
  const [saving, setSaving] = useState(false)
  if (!data) return null
  return (
    <Switch size="sm" checked={data.auto_follow_runs} disabled={saving} data-auto-follow label={<span className="text-xs text-fg-muted">Auto-follow processes I start</span>}
      onCheckedChange={async (next) => {
        setSaving(true)
        const result = await setHomePreferences({ auto_follow_runs: next })
        setSaving(false)
        if (result.ok) queryClient.setQueryData([...HOME_QUERY_KEY, "preferences"], result.data)
      }} />
  )
}

export function FollowingTab() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [offset, setOffset] = useState(0)
  const q = useDebounced(search)
  useEffect(() => setOffset(0), [q, status])
  const { data, isPending, isError, error } = useHomeList<{ runs: FollowedRun[] }>("home.following", { search: q || undefined, status, limit: LIMIT, offset })
  const filtered = !!q || status !== "all"
  return (
    <ListFrame minWidth={FOLLOW_LIST.minWidth} label="Followed processes"
      footer={data && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
      toolbar={<>
        <div className="flex flex-col gap-2 @xl:flex-row @xl:items-center">
          <SearchBox value={search} onChange={setSearch} placeholder="Search processes" label="Search followed processes" />
          <StatusFilterSelect value={status} onChange={setStatus} />
          <ListRefreshButton queryKeys={[[...HOME_QUERY_KEY, "home.following"]]} />
        </div>
        <AutoFollowToggle />
      </>}
      header={<HeaderRow cols={FOLLOW_COLS} labels={["Process", "Current stage", "Status", "Started", "Updated", "People involved", ""]} />}>
      {isPending ? <Span><RowsSkeleton /></Span> : isError ? <ErrorRow message={(error as Error).message} /> : !data?.runs.length ? (
        <Span><EmptyState size="sm" variant={filtered ? "no-results" : "first-run"} icon={filtered ? undefined : Bell} title={filtered ? "Nothing matches" : "You’re not following any processes"}
          description={filtered ? "Try another search or status." : "Processes you start — including the ones your form submissions start — are followed automatically. You can also follow a run from its page."}
          action={filtered ? { label: "Clear filters", onClick: () => { setSearch(""); setStatus("all") } } : undefined} /></Span>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {data.runs.map((r) => (
            <li key={r.run_id} className={rowClass()} style={{ gridTemplateColumns: FOLLOW_COLS }} data-home-followed={r.run_id}>
              <span data-sticky-cell className={cn("min-w-0 self-stretch md:flex md:flex-col md:justify-center", stickyCellClass)}>
                <Link href={`/home/runs/${r.run_id}`} className="block truncate font-medium text-fg hover:underline" title={r.process.name}>{r.process.name}</Link>
                {r.title && <span className="block truncate text-xs text-fg-muted" title={r.title}>{r.title}</span>}
              </span>
              <span className="min-w-0"><Mobile label="Stage" /><StagePopover stages={r.stages} fallback={r.status === "running" ? "Running" : "—"} /></span>
              <span><ProgressPill status={r.status} /></span>
              <span className="whitespace-nowrap"><Mobile label="Started" /><When at={r.started_at} /></span>
              <span className="whitespace-nowrap"><Mobile label="Updated" /><When at={r.updated_at} /></span>
              <span className="min-w-0 truncate"><Mobile label="With" /><People names={r.people} /></span>
              <span className="flex flex-nowrap items-center gap-1 md:justify-end">
                <FlowLink runId={r.run_id} />
                <TimelineIconButton target={{ runId: r.run_id }} title={r.title ?? r.process.name} />
                <FollowButton runId={r.run_id} following compact />
              </span>
            </li>
          ))}
        </ul>
      )}
    </ListFrame>
  )
}

/* ── My submissions ──────────────────────────────────────────────────── */

// Form, Submitted, Process, Status, Current stage, People involved, Updated, actions.
const SUB_LIST = listColumns([[14, 1.5], [7, 0.8], [11, 1.3], 7.5, [11, 1.3], [10, 1], [7, 0.8], 14.5])
const SUB_COLS = SUB_LIST.cols

export function SubmissionsTab() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [offset, setOffset] = useState(0)
  const [viewing, setViewing] = useState<{ id: string; form_id: string; form_name: string } | null>(null)
  const q = useDebounced(search)
  useEffect(() => setOffset(0), [q, status])
  const { data, isPending, isError, error } = useHomeList<{ submissions: MySubmission[] }>("home.submissions", { search: q || undefined, status, limit: LIMIT, offset })
  const filtered = !!q || status !== "all"
  return (
    <ListFrame minWidth={SUB_LIST.minWidth} label="My submissions"
      footer={<>
        {data && <Pager offset={offset} limit={LIMIT} total={data.total} onChange={setOffset} />}
        <SubmissionDialog submission={viewing} onClose={() => setViewing(null)} />
      </>}
      toolbar={<div className="flex flex-col gap-2 @xl:flex-row @xl:items-center">
        <SearchBox value={search} onChange={setSearch} placeholder="Search forms or processes" label="Search my submissions" />
        <StatusFilterSelect value={status} onChange={setStatus} />
        <ListRefreshButton queryKeys={[[...HOME_QUERY_KEY, "home.submissions"]]} />
      </div>}
      header={<HeaderRow cols={SUB_COLS} labels={["Form", "Submitted", "Process", "Status", "Current stage", "People involved", "Updated", ""]} />}>
      {isPending ? <Span><RowsSkeleton /></Span> : isError ? <ErrorRow message={(error as Error).message} /> : !data?.submissions.length ? (
        <Span><EmptyState size="sm" variant={filtered ? "no-results" : "first-run"} icon={filtered ? undefined : Inbox} title={filtered ? "Nothing matches" : "No submissions yet"}
          description={filtered ? "Try another search or status." : "When you submit a form, it shows up here with the process it started and where that process is now."}
          action={filtered ? { label: "Clear filters", onClick: () => { setSearch(""); setStatus("all") } } : undefined} /></Span>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {data.submissions.map((s) => (
            <li key={s.submission_id} className={rowClass()} style={{ gridTemplateColumns: SUB_COLS }} data-home-submission={s.submission_id}>
              <span data-sticky-cell className={cn("flex min-w-0 items-center self-stretch font-medium", stickyCellClass)}><span className="truncate" title={s.form.name}>{s.form.name}</span></span>
              <span className="whitespace-nowrap"><Mobile label="Submitted" /><When at={s.submitted_at} /></span>
              <span className="truncate"><Mobile label="Process" />{s.process?.name ?? <span className="text-fg-muted">{s.status === "queued" ? "Starting…" : "None"}</span>}{s.run_count > 1 ? <span className="num text-fg-muted"> +{s.run_count - 1}</span> : null}</span>
              <span><Tooltip content={s.status_label}><span tabIndex={0} className="inline-flex"><ProgressPill status={s.status} /></span></Tooltip></span>
              <span className="min-w-0"><Mobile label="Stage" /><StagePopover stages={s.stages} fallback={s.status === "waiting" ? "Waiting" : "—"} /></span>
              <span className="min-w-0 truncate"><Mobile label="With" /><People names={s.people} /></span>
              <span className="whitespace-nowrap"><Mobile label="Updated" /><When at={s.updated_at} /></span>
              <span className="flex flex-nowrap items-center gap-1 md:justify-end">
                <IconButton size="sm" label={`View submission of ${s.form.name}`} icon={<Eye />} onClick={() => setViewing({ id: s.submission_id, form_id: s.form.id, form_name: s.form.name })} data-view-submission />
                {s.run_id && <FlowLink runId={s.run_id} />}
                {s.run_id && <TimelineIconButton target={{ runId: s.run_id }} title={s.form.name} />}
                {s.run_id && <FollowButton runId={s.run_id} following={s.following} compact />}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ListFrame>
  )
}

/* ── Favourite forms ─────────────────────────────────────────────────── */

// Form, Description, actions.
const FAV_LIST = listColumns([[14, 1.4], [16, 2], 8])
const FAV_COLS = FAV_LIST.cols

/** My starred forms, alphabetical: name, description, Open and unstar; a search box past ten. */
export function FavoritesTab() {
  const { forms, loading, error } = useFavoriteForms()
  const { can } = usePermissions()
  const [search, setSearch] = useState("")
  const [notice, setNotice] = useState<string | null>(null)
  const view = favoriteFormsView(forms, search)
  return (
    <ListFrame minWidth={FAV_LIST.minWidth} label="Favourite forms"
      toolbar={<>
        {view.searchable ? <SearchBox value={search} onChange={setSearch} placeholder="Search favourite forms" label="Search favourite forms" /> : <span />}
        {notice && <InlineNotice tone="danger" message={notice} onDismiss={() => setNotice(null)} />}
      </>}
      header={view.forms.length ? <HeaderRow cols={FAV_COLS} labels={["Form", "Description", ""]} /> : undefined}>
      {loading ? <Span><RowsSkeleton rows={3} /></Span> : error ? <ErrorRow message="Your favourite forms couldn’t be loaded." /> : view.empty === "none" ? (
        <div data-home-favorites-empty>
          <Span><EmptyState size="sm" icon={Star} title="No favourite forms yet"
            description="Star a form (☆) in the Forms menu or the Forms list, or use the heart (♡) at the top right of a form’s page, and it shows up here with an Open button."
            action={can("forms.view") ? { label: "Browse forms", href: "/automations/forms" } : undefined} /></Span>
        </div>
      ) : view.empty === "no-match" ? (
        <Span><EmptyState size="sm" variant="no-results" title={`No favourites match “${search}”`} description="Try another search." action={{ label: "Clear search", onClick: () => setSearch("") }} /></Span>
      ) : (
        <ul className="divide-y divide-border-subtle" data-home-favorites>
          {view.forms.map((f) => (
            <li key={f.id} className={rowClass()} style={{ gridTemplateColumns: FAV_COLS }} data-favorite-form={f.id}>
              <span data-sticky-cell className={cn("flex min-w-0 items-center gap-2 self-stretch", stickyCellClass)}>
                <FileText className="size-3.5 shrink-0 text-primary-text" aria-hidden />
                <Link href={formHref(f)} className="truncate font-medium text-fg hover:underline" title={f.name}>{f.name}</Link>
              </span>
              <span className="line-clamp-2 min-w-0 text-fg-muted">{f.description || "—"}</span>
              <span className="flex flex-nowrap items-center gap-1 md:justify-end">
                <Button size="sm" variant="secondary" asChild>
                  <Link href={formHref(f)} aria-label={`Open ${f.name}`} data-favorite-open={f.id}>Open</Link>
                </Button>
                <FavoriteStar formId={f.id} name={f.name} description={f.description} onError={setNotice} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </ListFrame>
  )
}
