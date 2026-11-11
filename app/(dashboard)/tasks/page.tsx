"use client"

import { useState, useEffect, useId, useRef, useCallback } from "react"
import { useTasks } from "@/hooks/use-tasks"
import { useAppStore } from "@/stores/app-store"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { SearchInput } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Table, THead, TBody, TH, TR, TD, TableDetailCell, TableEmpty, TableSkeleton } from "@/components/ui/table"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Tooltip } from "@/components/ui/tooltip"
import { InlineNotice } from "@/components/ui/inline-notice"
import { EmptyState } from "@/components/ui/empty-state"
import { Card } from "@/components/ui/card"
import {
  Plus, Clock, ChevronLeft, ChevronRight, ChevronDown,
  ExternalLink,
  Calendar as CalendarIcon, GripVertical, List, CalendarDays, CheckSquare, ArrowUpDown,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { formatAbsolute, formatDay } from "@/lib/format/date"
import { Pagination } from "@/components/ui/list-controls"
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core"
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core"
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { reorderTasks, updateTaskField } from "@/app/actions/tasks"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { getWeekRange, getTaskCode } from "@/components/tasks/timesheet-helpers"
import { FilterMenu } from "@/components/tasks/filter-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { StatusFilterControls } from "@/components/tasks/status-filter-controls"
import { SortableTH } from "@/components/tasks/sortable-header"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { useListSort } from "@/hooks/use-list-sort"
import { explicitStatusList, explicitStatusView } from "@/lib/tasks/status-filter"
import type { TaskSortKey } from "@/lib/tasks/list-sort"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { taskDescriptionExcerpt } from "@/components/tasks/task-description"
import { QueuedTaskActions, TaskStatusPill, TeamTaskBadge } from "@/components/tasks/queued-task-actions"
import { ProcessViewIconLink, TaskQuickActions, TaskQuickActionsToggle } from "@/components/tasks/task-quick-actions"
import { TimelineIconButton } from "@/components/timeline/timeline-sheet"
import { useIsMobile } from "@/hooks/use-mobile"
import { MobileTaskCard } from "@/components/tasks/mobile-task-card"
import { ListRefreshButton } from "@/components/tasks/list-refresh-button"
import { QueueRulesButton } from "@/components/tasks/queue-rules-dialog"
import { QUEUED_STATUS, type QueueAction } from "@/lib/tasks/unified-list"
import { DEFAULT_TASK_STATUS_FILTER } from "@/stores/app-store"

/** The Status menu: Queued and the open statuses ("Show completed" brings the closed ones back). */
const STATUS_OPTIONS = [
  { value: QUEUED_STATUS, label: "Queued" },
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
]
const OPEN_VALUES = STATUS_OPTIONS.map((o) => o.value)
const SORT_KEYS: readonly TaskSortKey[] = ["title", "status", "priority", "due", "progress", "updated", "created"]

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

/** The store's default status filter (queued + open work); anything else counts as a filter for the empty state. */
const DEFAULT_STATUS: string[] = [...DEFAULT_TASK_STATUS_FILTER]
const STATUS_VALUES = new Set(STATUS_OPTIONS.map((o) => o.value))

/** Refresh: the task list (and quick actions, under "tasks") and the expanded rows' subtasks. */
const TASK_LIST_REFRESH_KEYS = [["tasks"], ["subtasks"]] as const

/** Columns of the list table (handle, task, status, priority, due, progress, notes, Process view / open / actions). */
const COLUMNS = 8

export default function TasksPage() {
  const { taskFilters, setTaskFilters, layoutPreference, setLayoutPreference } = useAppStore()
  const router = useRouter()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  // The last quick action's message (the row may leave the list after it).
  const [quickNotice, setQuickNotice] = useState<string | null>(null)
  const layout = (layoutPreference.tasks === "calendar" ? "calendar" : "list") as "calendar" | "list"
  const setLayout = (v: "calendar" | "list") => setLayoutPreference("tasks", v)
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const dndId = useId()
  const searchReady = useRef(false)
  // Column sort on the fetched list (before paging); none = the list's own order (manual order when dragged).
  const { sort, toggle: toggleSort, setSort, sorted } = useListSort("my-tasks", SORT_KEYS)
  const statusView = explicitStatusView(taskFilters.status, OPEN_VALUES)
  // Phones get a card list (no drag handles, no table) instead of the table.
  const mobile = useIsMobile()

  // ?q= seeds the search (links, back navigation); ?status= (e.g. queued, from
  // the retired /tasks/queue) seeds the status filter and is then dropped from
  // the URL. Read once from the URL, no Suspense bailout.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const q = params.get("q") ?? ""
    if (q) { setSearch(q); setDebouncedSearch(q) }
    const status = (params.get("status") ?? "").split(",").filter((s) => STATUS_VALUES.has(s))
    if (status.length) {
      setTaskFilters({ status })
      params.delete("status")
      const qs = params.toString()
      router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
    }
    searchReady.current = true
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after hydration
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Mirror the (debounced) query to ?q= so the URL can be shared and survives back navigation.
  useEffect(() => {
    if (!searchReady.current) return
    const params = new URLSearchParams(window.location.search)
    if ((params.get("q") ?? "") === debouncedSearch) return
    if (debouncedSearch) params.set("q", debouncedSearch)
    else params.delete("q")
    const qs = params.toString()
    router.replace(`${window.location.pathname}${qs ? `?${qs}` : ""}`, { scroll: false })
  }, [debouncedSearch, router])

  const { data: tasks, isLoading, error } = useTasks({
    status: taskFilters.status,
    priority: taskFilters.priority,
    sortBy: taskFilters.sortBy,
    search: debouncedSearch || undefined,
    // The unified list: my tasks plus the ones queued for me (status Queued).
    mine: true,
  })

  useEffect(() => { setLocalOrder(null) }, [tasks])

  // IMPORTANT: all hooks must run on every render — do not place any hook
  // call below an early return. Previously `useSensors` lived after the
  // loading-state return, which changed the hook count between renders
  // and triggered "Rendered more hooks than during the previous render".
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const orderedTasks = (() => {
    if (!tasks) return []
    if (!localOrder) return sorted(tasks)
    const taskMap = new Map(tasks.map((t: any) => [t.id, t]))
    return localOrder.map(id => taskMap.get(id)).filter(Boolean) as any[]
  })()

  if (isLoading && !tasks && !error) {
    return <PageSkeleton variant="list" />
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id || !tasks) return

    const oldIndex = orderedTasks.findIndex((t: any) => t.id === active.id)
    const newIndex = orderedTasks.findIndex((t: any) => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = [...orderedTasks.map((t: any) => t.id)]
    newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, active.id as string)
    setLocalOrder(newOrder)

    // Dragging sets a manual order: the column sort steps aside.
    if (sort) setSort(null)
    if (taskFilters.sortBy !== "sequence") {
      setTaskFilters({ sortBy: "sequence" })
    }
    reorderTasks(newOrder)
  }

  const filtered = Boolean(debouncedSearch) || taskFilters.priority.length > 0
    || taskFilters.status.length !== DEFAULT_STATUS.length || taskFilters.status.some((s) => !DEFAULT_STATUS.includes(s))
  function clearFilters() {
    setSearch("")
    setDebouncedSearch("")
    setTaskFilters({ status: DEFAULT_STATUS, priority: [] })
  }

  // This week (Monday → Sunday); the list is not scoped to it, it is context for the reader.
  const { start, end } = getWeekRange(new Date())
  const activeTask = activeId ? orderedTasks.find((t: any) => t.id === activeId) : null

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-2"
        inlineActions
        title="My tasks"
        description={(
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <CalendarIcon className="size-3.5 shrink-0" aria-hidden="true" />
            This week · <span className="num">{formatDay(start)} – {formatDay(end)}</span>
          </span>
        )}
        actions={(
          <>
            <SegmentedControl
              aria-label="View"
              size="sm"
              value={layout}
              onValueChange={setLayout}
              options={[
                // Icons only on phones (the text stays the accessible name).
                { value: "list", text: <span className="max-sm:sr-only">List</span>, icon: <List /> },
                { value: "calendar", text: <span className="max-sm:sr-only">Calendar</span>, icon: <CalendarDays /> },
              ]}
            />
            <Button asChild leadingIcon={<Plus />} className="max-sm:px-2.5">
              <Link href="/tasks/new"><span className="max-sm:hidden">Create task</span><span className="sm:hidden">New</span></Link>
            </Button>
          </>
        )}
      />

      {/* Toolbar. Phones: search with the rules + refresh buttons beside it,
          then the filters as one horizontally scrolling row. */}
      <div className="flex flex-wrap items-center gap-2" data-tasks-toolbar>
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search tasks…"
          aria-label="Search tasks"
          wrapperClassName="order-1 min-w-0 flex-1 sm:max-w-sm"
        />
        <div className="order-3 -mx-4 flex basis-full items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:order-2 sm:mx-0 sm:basis-auto sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0" data-tasks-filters>
          <FilterMenu label="Priority" options={PRIORITY_OPTIONS} selected={taskFilters.priority} onChange={(priority) => setTaskFilters({ priority })} />
          <StatusFilterControls options={STATUS_OPTIONS} selected={statusView.selected}
            onSelectedChange={(selected) => setTaskFilters({ status: explicitStatusList(selected, statusView.showCompleted, OPEN_VALUES) })}
            showCompleted={statusView.showCompleted}
            onShowCompletedChange={(on) => setTaskFilters({ status: explicitStatusList(statusView.selected, on, OPEN_VALUES) })} />
          {mobile && <MobileSortMenu sort={sort} onSort={setSort} />}
          {filtered && <Button variant="ghost" size="sm" onClick={clearFilters}>Clear filters</Button>}
        </div>
        <div className="order-2 flex shrink-0 items-center gap-1 sm:order-3 sm:gap-2">
          <QueueRulesButton />
          <ListRefreshButton queryKeys={TASK_LIST_REFRESH_KEYS} className="max-sm:[&>[role=status]]:hidden" />
        </div>
      </div>

      {quickNotice && layout === "list" && <InlineNotice tone="success" onDismiss={() => setQuickNotice(null)}>{quickNotice}</InlineNotice>}

      {/* Calendar view */}
      {layout === "calendar" && (
        <MonthCalendar
          tasks={orderedTasks}
          month={calMonth}
          onMonthChange={setCalMonth}
          isLoading={isLoading}
          error={error}
        />
      )}

      {/* List view */}
      {layout === "list" && (
        <>
          {error ? (
            <EmptyState variant="error" title="Couldn’t load your tasks" description={error.message} />
          ) : mobile ? (
            !orderedTasks.length ? (
              filtered ? (
                <EmptyState variant="no-results" title={debouncedSearch ? `No tasks match “${debouncedSearch}”` : "No tasks match these filters"}
                  description="Try another search, or clear the filters." action={{ label: "Clear filters", onClick: clearFilters }} />
              ) : (
                <EmptyState icon={CheckSquare} title="You’re all caught up"
                  description="Nothing is assigned to you right now." action={{ label: "Create task", href: "/tasks/new" }} />
              )
            ) : (
              <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-panel" data-tasks-cards data-tour="task-list">
                {orderedTasks.slice((page - 1) * pageSize, page * pageSize).map((task: any) => (
                  <TaskCard key={task.id} task={task} onNotice={setQuickNotice} />
                ))}
              </ul>
            )
          ) : (
            <DndContext
              id={dndId}
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              {/* Readable columns (col presets) that scroll sideways below the wide desktop; the
                  drag handle and the task's name stay in view while scrolling. */}
              <Table label="My tasks" stickyFirstColumn stickyColumns={2} data-tasks-table data-tour="task-list">
                <THead>
                  <tr>
                    <TH className="w-8"><span className="sr-only">Reorder</span></TH>
                    <SortableTH sortKey="title" sort={sort} onSort={toggleSort} col="title">Task</SortableTH>
                    <SortableTH sortKey="status" sort={sort} onSort={toggleSort} col="status" className="w-32">Status</SortableTH>
                    <SortableTH sortKey="priority" sort={sort} onSort={toggleSort} col="status" className="w-28">Priority</SortableTH>
                    <SortableTH sortKey="due" sort={sort} onSort={toggleSort} numeric col="date" className="w-24">Due</SortableTH>
                    <SortableTH sortKey="progress" sort={sort} onSort={toggleSort} className="w-28 min-w-28">Progress</SortableTH>
                    <TH col="text" className="w-[24%]">Notes</TH>
                    <TH col="actions"><span className="sr-only">Actions</span></TH>
                  </tr>
                </THead>
                <TBody>
                  {isLoading ? (
                    <TableSkeleton columns={COLUMNS} />
                  ) : !orderedTasks?.length ? (
                    filtered ? (
                      <TableEmpty colSpan={COLUMNS} variant="no-results" title={debouncedSearch ? `No tasks match “${debouncedSearch}”` : "No tasks match these filters"}
                        description="Try another search, or clear the filters." action={{ label: "Clear filters", onClick: clearFilters }} />
                    ) : (
                      <TableEmpty colSpan={COLUMNS} icon={CheckSquare} title="You’re all caught up"
                        description="Nothing is assigned to you right now." action={{ label: "Create task", href: "/tasks/new" }} />
                    )
                  ) : (
                    <SortableContext
                      items={orderedTasks.map((t: any) => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      {orderedTasks.slice((page - 1) * pageSize, page * pageSize).map((task: any) => (
                        <SortableTaskRow key={task.id} task={task} onNotice={setQuickNotice} />
                      ))}
                    </SortableContext>
                  )}
                </TBody>
              </Table>
              <DragOverlay>
                {activeTask && (
                  <Card padding="sm" className="flex items-center gap-2 border-border-strong shadow-elev-2">
                    <GripVertical className="size-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
                    <span className="shrink-0 font-mono text-xs text-fg-muted">{getTaskCode(activeTask)}</span>
                    <span className="truncate text-ui font-medium text-fg">{activeTask.title}</span>
                  </Card>
                )}
              </DragOverlay>
            </DndContext>
          )}

          <Pagination
            page={page}
            pageSize={pageSize}
            total={orderedTasks?.length ?? 0}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        </>
      )}
    </div>
  )
}

function isTaskDone(task: any) {
  return task.status === "completed" || task.status === "cancelled"
}

function taskProgress(task: any) {
  const hasChildren = (task.child_count ?? 0) > 0
  return hasChildren
    ? Math.round(((task.completed_child_count ?? 0) / Math.max(task.child_count ?? 1, 1)) * 100)
    : Math.round(Number(task.progress_pct ?? (isTaskDone(task) ? 100 : 0)) || 0)
}

/* ─── Sortable task row (+ its expanded panel) ─── */

function SortableTaskRow({ task, onNotice }: { task: any; onNotice: (message: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const mobile = useIsMobile()
  const router = useRouter()
  const panelId = useId()
  const actionsId = useId()
  const toggleRef = useRef<HTMLButtonElement>(null)

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  }

  const isDone = isTaskDone(task)
  const progress = taskProgress(task)
  const hasChildren = (task.child_count ?? 0) > 0
  const queueAction = (task.queue_action ?? null) as QueueAction | null
  const toggle = () => setExpanded((v) => !v)

  return (
    <>
      <TR
        ref={setNodeRef}
        style={style}
        className={cn("cursor-pointer", isDragging && "relative z-10 opacity-40", expanded && "border-b-0 bg-subtle")}
        onClick={toggle}
        onDoubleClick={() => router.push(`/tasks/${task.id}`)}
        data-task-row={task.id}
      >
        <TD className="w-8 pr-0">
          <Tooltip content="Drag to reorder priority">
            <button
              type="button"
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${task.title}`}
              className="inline-flex size-6 cursor-grab touch-none items-center justify-center rounded-sm text-fg-subtle opacity-60 transition-opacity hover:text-fg-muted group-hover/row:opacity-100 active:cursor-grabbing"
              onClick={(e) => e.stopPropagation()}
            >
              <GripVertical className="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        </TD>
        <TD className="max-w-0 py-1.5">
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={expanded}
            aria-controls={expanded ? panelId : undefined}
            onClick={(e) => { e.stopPropagation(); toggle() }}
            className="flex w-full min-w-0 flex-col items-start text-left"
            data-task-toggle
          >
            <span className="flex w-full min-w-0 items-center gap-2">
              <ChevronDown className={cn("size-3.5 shrink-0 text-fg-subtle transition-transform duration-[var(--ds-dur-fast)]", !expanded && "-rotate-90")} aria-hidden="true" />
              <span className="shrink-0 font-mono text-xs text-fg-muted">{getTaskCode(task)}</span>
              <span className={cn("truncate font-medium text-fg", isDone && "text-fg-muted line-through")} title={task.title}>{task.title}</span>
            </span>
            {(task.tenant || task.assignee || hasChildren) && (
              <span className="flex w-full min-w-0 items-center gap-1.5 pl-[22px] text-xs text-fg-muted">
                <span className="truncate">
                  {[task.tenant?.name, task.assignee?.display_name].filter(Boolean).join(" · ")}
                  {hasChildren && <>{task.tenant || task.assignee ? " · " : ""}<span className="num">{task.completed_child_count ?? 0}/{task.child_count ?? 0}</span> subtasks</>}
                </span>
              </span>
            )}
          </button>
        </TD>
        <TD className="whitespace-nowrap"><TaskStatusPill status={task.display_status ?? task.status} /></TD>
        <TD className="whitespace-nowrap"><PriorityBadge priority={task.priority} /></TD>
        <TD numeric><DueCell task={task} /></TD>
        {queueAction ? (
          // Queued: respond inline (progress and notes start once it's yours).
          <TD colSpan={2} onClick={(e) => e.stopPropagation()}>
            <span className="flex flex-wrap items-center gap-2">
              <QueuedTaskActions task={task} action={queueAction} />
              {queueAction === "claim" && <TeamTaskBadge />}
            </span>
          </TD>
        ) : (
          <>
            <TD>
              <span className="flex items-center gap-2">
                <ProgressBar value={progress} className="w-12 shrink-0" label={`${progress}% complete`} />
                <span className="num text-xs text-fg-muted">{progress}%</span>
              </span>
            </TD>
            <TD className="max-w-0" onClick={(e) => e.stopPropagation()}>
              <NotesCell task={task} />
            </TD>
          </>
        )}
        <TD col="actions" className="px-1" onClick={(e) => e.stopPropagation()}>
          <span className="flex flex-nowrap items-center justify-end gap-0.5">
            {task.workflow_run_id && <ProcessViewIconLink runId={task.workflow_run_id} title={task.title} />}
            {task.workflow_run_id && <TimelineIconButton target={{ taskId: task.id }} title={task.title} />}
            <Tooltip content="Open task">
              <Link href={`/tasks/${task.id}`} aria-label={`Open ${task.title}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg">
                <ExternalLink className="size-3.5" aria-hidden="true" />
              </Link>
            </Tooltip>
            <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
          </span>
        </TD>
      </TR>
      {expanded && (
        <tr className="border-b border-border-subtle bg-subtle" data-task-panel>
          <TableDetailCell colSpan={COLUMNS} className="px-[var(--theme-density-cell-x)] pb-4 pt-1">
            <TaskDetailPanel id={panelId} taskId={task.id} title={task.title} onClose={() => { setExpanded(false); toggleRef.current?.focus() }} className="pl-[30px]" />
          </TableDetailCell>
        </tr>
      )}
      {mobile ? (
        <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile
          taskId={task.id} title={task.title} queueAction={queueAction} onDone={onNotice} />
      ) : actionsOpen && (
        <tr className="border-b border-border-subtle" data-task-actions-row>
          <TableDetailCell colSpan={COLUMNS}>
            <TaskQuickActions id={actionsId} open onOpenChange={setActionsOpen} mobile={false}
              taskId={task.id} title={task.title} queueAction={queueAction} onDone={onNotice} />
          </TableDetailCell>
        </tr>
      )}
    </>
  )
}

/* ─── Phone card (the table row's content, stacked) ─── */

function TaskCard({ task, onNotice }: { task: any; onNotice: (message: string) => void }) {
  const [actionsOpen, setActionsOpen] = useState(false)
  const actionsId = useId()
  const isDone = isTaskDone(task)
  const progress = taskProgress(task)
  const hasChildren = (task.child_count ?? 0) > 0
  const queueAction = (task.queue_action ?? null) as QueueAction | null
  const meta = [task.tenant?.name, task.assignee?.display_name].filter(Boolean).join(" · ")

  return (
    <>
      <MobileTaskCard
        href={`/tasks/${task.id}`}
        title={task.title}
        done={isDone}
        code={getTaskCode(task)}
        meta={(meta || hasChildren) ? (
          <>
            {meta}
            {hasChildren && <>{meta ? " · " : ""}<span className="num">{task.completed_child_count ?? 0}/{task.child_count ?? 0}</span> subtasks</>}
          </>
        ) : undefined}
        actions={(
          <>
            {task.workflow_run_id && <ProcessViewIconLink runId={task.workflow_run_id} title={task.title} />}
            {task.workflow_run_id && <TimelineIconButton target={{ taskId: task.id }} title={task.title} />}
            <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
          </>
        )}
        status={<TaskStatusPill status={task.display_status ?? task.status} />}
        priority={<PriorityBadge priority={task.priority} />}
        progress={!queueAction && progress > 0 ? (
          <span className="flex items-center gap-1.5">
            <ProgressBar value={progress} className="w-10 shrink-0" label={`${progress}% complete`} />
            <span className="num text-fg-muted">{progress}%</span>
          </span>
        ) : undefined}
        due={<DueCell task={task} />}
        footer={queueAction ? (
          <>
            <QueuedTaskActions task={task} action={queueAction} />
            {queueAction === "claim" && <TeamTaskBadge />}
          </>
        ) : undefined}
        data-task-card={task.id}
      />
      <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile
        taskId={task.id} title={task.title} queueAction={queueAction} onDone={onNotice} />
    </>
  )
}

const MOBILE_SORTS: ReadonlyArray<{ value: string; label: string; sort: { key: TaskSortKey; dir: "asc" | "desc" } | null }> = [
  { value: "", label: "Default order", sort: null },
  { value: "due", label: "Due date", sort: { key: "due", dir: "asc" } },
  { value: "priority", label: "Priority", sort: { key: "priority", dir: "desc" } },
  { value: "status", label: "Status", sort: { key: "status", dir: "asc" } },
  { value: "title", label: "Title", sort: { key: "title", dir: "asc" } },
  { value: "updated", label: "Recently updated", sort: { key: "updated", dir: "desc" } },
]

/** Phones have no column headers: the sort is a menu in the filter row. */
function MobileSortMenu({ sort, onSort }: { sort: { key: TaskSortKey; dir: "asc" | "desc" } | null; onSort: (next: { key: TaskSortKey; dir: "asc" | "desc" } | null) => void }) {
  const current = MOBILE_SORTS.find((o) => o.sort?.key === sort?.key) ?? MOBILE_SORTS[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" leadingIcon={<ArrowUpDown />} trailingIcon={<ChevronDown />} data-mobile-sort>
          {current.sort ? current.label : "Sort"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={current.value} onValueChange={(v) => onSort(MOBILE_SORTS.find((o) => o.value === v)?.sort ?? null)}>
          {MOBILE_SORTS.map((o) => <DropdownMenuRadioItem key={o.value} value={o.value}>{o.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function DueCell({ task }: { task: any }) {
  if (!task.due_date) return <span className="text-fg-subtle">—</span>
  const due = new Date(task.due_date)
  const overdue = due < new Date() && task.status !== "completed"
  return (
    <Tooltip content={formatAbsolute(due)}>
      <span className={cn("inline-flex items-center justify-end gap-1 whitespace-nowrap", overdue ? "text-danger" : "text-fg")} data-overdue={overdue || undefined}>
        {overdue && <Clock className="size-3.5" aria-hidden="true" />}
        <time dateTime={task.due_date}>{formatDay(due)}</time>
        {overdue && <span className="sr-only">(overdue)</span>}
      </span>
    </Tooltip>
  )
}

/* ─── Notes (description) cell: click to edit inline ─── */

function NotesCell({ task }: { task: any }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(task.description ?? "")
  const queryClient = useQueryClient()

  const save = useCallback(async () => {
    setEditing(false)
    if (value !== (task.description ?? "")) {
      await updateTaskField(task.id, "description", value || null)
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    }
  }, [value, task.id, task.description, queryClient])

  useEffect(() => {
    setValue(task.description ?? "")
  }, [task.description])

  if (editing) {
    return (
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === "Escape") { setValue(task.description ?? ""); setEditing(false) } }}
        rows={2}
        autoFocus
        aria-label={`Notes for ${task.title}`}
        className="my-1 min-h-0 resize-none text-xs"
      />
    )
  }

  const excerpt = value ? taskDescriptionExcerpt(value) : ""
  return (
    <Tooltip content={excerpt || null}>
      <button
        type="button"
        onClick={() => setEditing(true)}
        aria-label={excerpt ? `Edit notes: ${excerpt}` : `Add notes to ${task.title}`}
        className="block w-full cursor-text truncate rounded-sm text-left text-xs decoration-dotted underline-offset-2 hover:underline"
      >
        {excerpt ? <span className="text-fg-muted">{excerpt}</span> : <span className="text-fg-subtle">Add note…</span>}
      </button>
    </Tooltip>
  )
}

/* ─── Month agenda (phones) ─── */

function MonthAgenda({ tasks, year, month, today }: { tasks: any[]; year: number; month: number; today: Date }) {
  const due = tasks
    .filter((t) => { if (!t.due_date) return false; const d = new Date(t.due_date); return d.getFullYear() === year && d.getMonth() === month })
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())
  if (!due.length) return <p className="text-sm text-fg-muted sm:hidden">Nothing due this month.</p>
  return (
    <ul className="divide-y divide-border-subtle overflow-hidden rounded-lg border border-border bg-panel sm:hidden" data-month-agenda>
      {due.map((task) => {
        const d = new Date(task.due_date)
        const overdue = d < today && !isTaskDone(task)
        return (
          <li key={task.id}>
            <Link href={`/tasks/${task.id}`} className="flex min-h-12 items-center gap-3 px-3 py-2 hover:bg-subtle">
              <span className={cn("num w-12 shrink-0 text-xs font-medium", overdue ? "text-danger" : "text-fg-muted")}>{formatDay(d)}</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm text-fg", isTaskDone(task) && "text-fg-muted line-through")}>{task.title}</span>
                <span className="block font-mono text-xs text-fg-muted">{getTaskCode(task)}</span>
              </span>
              <PriorityBadge priority={task.priority} />
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/* ─── Month Calendar View ─── */

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function MonthCalendar({
  tasks,
  month,
  onMonthChange,
  isLoading,
  error,
}: {
  tasks: any[]
  month: Date
  onMonthChange: (d: Date) => void
  isLoading: boolean
  error: any
}) {
  const router = useRouter()
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const year = month.getFullYear()
  const m = month.getMonth()

  // Build calendar grid — starts on Monday
  const firstDay = new Date(year, m, 1)
  const lastDay = new Date(year, m + 1, 0)
  const startDow = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1 // Mon=0
  const totalCells = Math.ceil((startDow + lastDay.getDate()) / 7) * 7

  const cells: { date: Date; inMonth: boolean }[] = []
  for (let i = 0; i < totalCells; i++) {
    const d = new Date(year, m, 1 - startDow + i)
    cells.push({ date: d, inMonth: d.getMonth() === m })
  }

  // Group tasks by date string
  const tasksByDate = new Map<string, any[]>()
  for (const task of tasks) {
    if (!task.due_date) continue
    const dd = new Date(task.due_date)
    const key = `${dd.getFullYear()}-${dd.getMonth()}-${dd.getDate()}`
    if (!tasksByDate.has(key)) tasksByDate.set(key, [])
    tasksByDate.get(key)!.push(task)
  }

  // Tasks with no due date
  const unscheduled = tasks.filter(t => !t.due_date)

  function prevMonth() {
    onMonthChange(new Date(year, m - 1, 1))
  }
  function nextMonth() {
    onMonthChange(new Date(year, m + 1, 1))
  }
  function goToday() {
    const n = new Date()
    onMonthChange(new Date(n.getFullYear(), n.getMonth(), 1))
  }

  const isSameDay = (a: Date, b: Date) =>
    a.getDate() === b.getDate() && a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()

  if (error) {
    return <EmptyState variant="error" title="Couldn’t load your tasks" description={error.message} />
  }
  if (isLoading) return null

  return (
    <div className="space-y-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <IconButton label="Previous month" icon={<ChevronLeft />} size="sm" onClick={prevMonth} />
          <span className="min-w-[160px] text-center text-sm font-semibold text-fg">
            {MONTH_NAMES[m]} {year}
          </span>
          <IconButton label="Next month" icon={<ChevronRight />} size="sm" onClick={nextMonth} />
        </div>
        <Button variant="ghost" size="sm" onClick={goToday}>Today</Button>
      </div>

      {/* Calendar grid */}
      <div className="overflow-hidden rounded-lg border border-border bg-panel max-lg:overflow-x-auto max-sm:overflow-x-hidden">
        {/* Inner min-width keeps calendar cells legible on tablets — the
            wrapper above scrolls horizontally below lg. Phones get a compact
            month (counts only) and the month's agenda under it. */}
        <div className="sm:max-lg:min-w-[640px]">
          {/* Day headers */}
          <div className="grid grid-cols-7 border-b border-border-subtle bg-subtle text-xs font-medium text-fg-muted">
            {DAY_LABELS.map(d => (
              <div key={d} className="px-2 py-2 text-center max-sm:px-0">{d}</div>
            ))}
          </div>

          {/* Date cells */}
          <div className="grid grid-cols-7">
            {cells.map((cell, i) => {
              const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
              const dayTasks = tasksByDate.get(key) ?? []
              const isToday = isSameDay(cell.date, today)
              const isPast = cell.date < today && !isToday

              return (
                <div
                  key={i}
                  className={cn(
                    "min-h-[100px] border-b border-r border-border-subtle p-1.5 max-sm:min-h-12 max-sm:p-1 [&:nth-child(7n)]:border-r-0",
                    isToday ? "bg-primary-wash" : "bg-panel",
                    !cell.inMonth && "bg-subtle",
                  )}
                  aria-current={isToday ? "date" : undefined}
                >
                  {/* Date number */}
                  <div className="mb-1 flex items-center justify-between max-sm:flex-col max-sm:gap-0.5">
                    <span
                      className={cn(
                        "num flex size-6 items-center justify-center rounded-full text-xs font-medium",
                        isToday ? "bg-primary text-primary-fg" : cell.inMonth ? "text-fg" : "text-fg-subtle",
                      )}
                    >
                      {cell.date.getDate()}
                    </span>
                    {dayTasks.length > 0 && (
                      <span className="num rounded-full bg-muted px-1.5 text-2xs font-medium text-fg-muted">
                        {dayTasks.length}
                      </span>
                    )}
                  </div>

                  {/* Task chips */}
                  <div className="space-y-0.5 max-sm:hidden">
                    {dayTasks.slice(0, 3).map(task => {
                      const isDone = isTaskDone(task)
                      const isOverdue = isPast && !isDone
                      const isUrgent = task.priority === "critical" || task.priority === "high"
                      return (
                        <Tooltip key={task.id} content={`${getTaskCode(task)} · ${task.title}`}>
                          <button
                            type="button"
                            onClick={() => router.push(`/tasks/${task.id}`)}
                            className={cn(
                              "block w-full truncate rounded-sm border-l-2 px-1.5 py-0.5 text-left text-2xs leading-tight transition-colors hover:brightness-95",
                              isOverdue ? "border-danger bg-danger-wash text-danger"
                                : isUrgent ? "border-warning bg-warning-wash text-warning"
                                : task.is_workflow_task ? "border-info bg-info-wash text-info"
                                : "border-primary bg-muted text-fg",
                              isDone && "line-through opacity-60",
                            )}
                          >
                            <span className="font-mono font-medium">{getTaskCode(task)}</span>{" "}
                            {task.title}
                          </button>
                        </Tooltip>
                      )
                    })}
                    {dayTasks.length > 3 && (
                      <span className="px-1.5 text-2xs text-fg-muted">
                        +{dayTasks.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Phones: this month's tasks as a list (the grid above shows counts only). */}
      <MonthAgenda tasks={tasks} year={year} month={m} today={today} />

      {/* Unscheduled tasks */}
      {unscheduled.length > 0 && (
        <Card padding="sm" className="space-y-2">
          <h3 className="text-xs font-medium text-fg-muted">
            No due date <span className="num">({unscheduled.length})</span>
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.slice(0, 12).map(task => (
              <Tooltip key={task.id} content={task.title}>
                <button
                  type="button"
                  onClick={() => router.push(`/tasks/${task.id}`)}
                  className="max-w-[200px] truncate rounded-sm bg-muted px-2 py-1 text-2xs text-fg transition-colors hover:bg-subtle"
                >
                  <span className="font-mono font-medium">{getTaskCode(task)}</span> {task.title}
                </button>
              </Tooltip>
            ))}
            {unscheduled.length > 12 && (
              <span className="self-center px-1 text-2xs text-fg-muted">
                +{unscheduled.length - 12} more
              </span>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
