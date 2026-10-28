"use client"

import { useState, useEffect, useId, useRef, useCallback } from "react"
import { useTasks } from "@/hooks/use-tasks"
import { useAppStore } from "@/stores/app-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { OrgBadge } from "@/components/ui/org-badge"
import {
  Plus, Search, X, Pencil, Clock, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  ExternalLink, CheckCircle, CornerDownRight, ArrowUpRight,
  Send, User, Calendar as CalendarIcon, GripVertical, List, CalendarDays,
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { formatRelativeDate } from "@/lib/utils"
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
import { serverRead } from "@/lib/server-read"
import {
  WeekNav,
  TimesheetTableHeader,
  getWeekRange,
  formatDateShort,
  getTaskCode,
  getEffortBadge,
  EffortBadge,
  getWeekDays,
} from "@/components/tasks/timesheet-helpers"
import { SubtaskList } from "@/components/tasks/subtask-list"
import { usePermissions } from "@/lib/permissions-context"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { TaskListRowSummary } from "@/components/tasks/task-list-row-summary"
import { TaskProgressStrip } from "@/components/tasks/task-progress-strip"
import { taskDescriptionExcerpt } from "@/components/tasks/task-description"

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
  { value: "completed", label: "Completed" },
]

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

const SORT_OPTIONS = [
  { value: "sequence", label: "Manual order" },
  { value: "due_date", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "created_at", label: "Created" },
  { value: "updated_at", label: "Updated" },
]

export default function TasksPage() {
  const { taskFilters, setTaskFilters, layoutPreference, setLayoutPreference } = useAppStore()
  const { userId: currentUserId } = usePermissions()
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [localOrder, setLocalOrder] = useState<string[] | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const weekOffset = 0
  const viewMode: "day" | "week" = "day"
  const effortMode = true
  const layout = (layoutPreference.tasks === "calendar" ? "calendar" : "list") as "calendar" | "list"
  const setLayout = (v: "calendar" | "list") => setLayoutPreference("tasks", v)
  const [calMonth, setCalMonth] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1) })
  const dndId = useId()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data: tasks, isLoading, error } = useTasks({
    status: taskFilters.status,
    priority: taskFilters.priority,
    sortBy: taskFilters.sortBy,
    search: debouncedSearch || undefined,
    assigneeId: currentUserId,
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
    if (!localOrder) return tasks
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

    if (taskFilters.sortBy !== "sequence") {
      setTaskFilters({ sortBy: "sequence" })
    }
    reorderTasks(newOrder)
  }

  function toggleStatus(status: string) {
    const current = taskFilters.status
    const next = current.includes(status) ? current.filter((s) => s !== status) : [...current, status]
    setTaskFilters({ status: next })
  }

  function togglePriority(priority: string) {
    const current = taskFilters.priority
    const next = current.includes(priority) ? current.filter((p) => p !== priority) : [...current, priority]
    setTaskFilters({ priority: next })
  }

  // Week calculation
  const today = new Date()
  const refDate = new Date(today)
  refDate.setDate(refDate.getDate() + weekOffset * 7)
  const { start, end } = getWeekRange(refDate)
  const weekDays = getWeekDays(start)

  const gridCols = "minmax(280px, 2fr) 120px minmax(180px, 1fr) 36px"

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--theme-card-text)" }}>
          My Tasks
          {layout === "list" && (
            <span className="text-base font-normal ml-2" style={{ color: "var(--theme-muted-text)" }}>
              {formatDateShort(start)} – {formatDateShort(end)} {end.getFullYear()}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2">
          {/* Layout toggle */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--theme-surface-border)" }}>
            <button
              onClick={() => setLayout("list")}
              className="px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors hover:bg-[var(--theme-row-highlight)]"
              style={layout === "list" ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-on-primary)" } : { color: "var(--theme-muted-text)" }}
              title="List view"
            >
              <List size={14} /> List
            </button>
            <button
              onClick={() => setLayout("calendar")}
              className="px-2.5 py-1.5 flex items-center gap-1.5 text-xs font-medium transition-colors hover:bg-[var(--theme-row-highlight)]"
              style={layout === "calendar" ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-on-primary)" } : { color: "var(--theme-muted-text)" }}
              title="Calendar view"
            >
              <CalendarDays size={14} /> Calendar
            </button>
          </div>

          <Link href="/tasks/new">
            <Button size="sm">
              <Plus size={16} className="mr-1" />
              Create Task
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tasks..."
              className="pl-9"
            />
          </div>
          <select
            value={taskFilters.sortBy}
            onChange={(e) => setTaskFilters({ sortBy: e.target.value })}
            className="rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium self-center mr-1" style={{ color: "var(--theme-muted-text)" }}>Status:</span>
          {STATUS_OPTIONS.map((opt) => {
            const active = taskFilters.status.includes(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => toggleStatus(opt.value)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                style={active
                  ? { backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }
                  : { backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
              >
                {opt.label}
              </button>
            )
          })}

          <span className="text-xs font-medium self-center ml-3 mr-1" style={{ color: "var(--theme-muted-text)" }}>Priority:</span>
          {PRIORITY_OPTIONS.map((opt) => {
            const active = taskFilters.priority.includes(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => togglePriority(opt.value)}
                className="rounded-full px-3 py-1 text-xs font-medium transition-colors"
                style={active
                  ? { backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }
                  : { backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
              >
                {opt.label}
              </button>
            )
          })}

          {taskFilters.priority.length > 0 && (
            <button
              onClick={() => setTaskFilters({ priority: [] })}
              className="rounded-full px-2 py-1 text-xs font-medium flex items-center gap-1 ml-1 hover:opacity-80 transition-opacity"
              style={{ backgroundColor: "var(--status-danger-bg)", color: "var(--theme-danger)" }}
            >
              <X size={10} /> Clear
            </button>
          )}
        </div>

        <p className="text-xs text-gray-400 flex items-center gap-1">
          <GripVertical size={12} /> Drag tasks to reorder priority
        </p>
      </div>

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
          <div
            className="rounded-xl overflow-hidden max-lg:overflow-x-auto border"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            {/* Inner min-width keeps the timesheet grid usable on phones —
                the wrapper above scrolls horizontally below md. */}
            <div className="max-lg:min-w-[640px]">
            <TimesheetTableHeader
              dateLabel={formatDateShort(today)}
              viewMode={viewMode}
              weekDays={undefined}
            />

            {error ? (
              <div className="px-4 py-8 text-center text-sm text-red-500">
                Error loading tasks: {error.message}
              </div>
            ) : isLoading ? null : !orderedTasks?.length ? (
              <div className="px-4 py-8 text-center text-sm text-gray-500">
                No tasks found.{" "}
                <Link href="/tasks/new" className="text-[color:var(--theme-card-text)] hover:text-[color:var(--theme-card-text)]">Create one</Link>
              </div>
            ) : (
              <DndContext
                id={dndId}
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={orderedTasks.map((t: any) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedTasks.slice((page - 1) * pageSize, page * pageSize).map((task: any) => (
                    <SortableTimesheetRow
                      key={task.id}
                      task={task}
                      gridCols={gridCols}
                      viewMode={viewMode}
                      weekDays={weekDays}
                      effortMode={effortMode}
                    />
                  ))}
                </SortableContext>
                <DragOverlay>
                  {activeId && orderedTasks.find((t: any) => t.id === activeId) && (
                    <div
                      className="shadow-lg rounded-lg border opacity-90 grid items-center"
                      style={{
                        gridTemplateColumns: gridCols,
                        backgroundColor: "var(--theme-card-bg)",
                        borderColor: "var(--theme-primary)",
                      }}
                    >
                      <TimesheetRowContent
                        task={orderedTasks.find((t: any) => t.id === activeId)}
                        viewMode={viewMode}
                        weekDays={weekDays}
                        effortMode={effortMode}
                      />
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
            </div>
          </div>

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

/* ─── Sortable Timesheet Row ─── */

function SortableTimesheetRow({
  task,
  gridCols,
  viewMode,
  weekDays,
  effortMode,
}: {
  task: any
  gridCols: string
  viewMode: "day" | "week"
  weekDays: { label: string; date: Date }[]
  effortMode: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [actionFailure, setActionFailure] = useState<string | null>(null)
  const [redirectMode, setRedirectMode] = useState<"redirect" | "escalate" | null>(null)
  const [redirectTargetMode, setRedirectTargetMode] = useState<"user" | "email">("user")
  const [users, setUsers] = useState<{ id: string; display_name: string; email: string }[] | null>(null)
  const [selectedUserId, setSelectedUserId] = useState("")
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [targetEmail, setTargetEmail] = useState("")
  const [targetEmailsText, setTargetEmailsText] = useState("")
  const [comment, setComment] = useState("")
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()

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
    transform: CSS.Transform.toString(transform),
    transition,
  }

  const isDone = task.status === "completed" || task.status === "cancelled"
  const isDarkRow = task.is_workflow_task || task.priority === "critical"
  const outcomes = (task.available_outcomes as string[]) ?? ["completed"]
  const taskActions = (task.metadata?.task_actions ?? {}) as Record<string, any>
  const canRedirect = task.allow_reassign === true
  const canInviteOnRedirect = canRedirect && taskActions.allow_invite_on_redirect === true
  const canEscalate = task.allow_escalate !== false
  const redirectAssignmentMode = taskActions.redirect_assignment_mode === 'many' ? 'many' : 'single'
  const redirectRecipientLimitMode = taskActions.redirect_recipient_limit_mode === 'capped' ? 'capped' : 'unlimited'
  const redirectRecipientLimit = redirectRecipientLimitMode === 'capped' ? Math.max(1, Number(taskActions.redirect_recipient_limit ?? 1)) : null

  async function loadUsers() {
    if (users) return
    const { data } = await serverRead("tasks.redirectUsers")
    setUsers((data ?? []) as any)
  }

  async function handleComplete(outcome: string) {
    setActionLoading(outcome)
    try {
      if (task.is_workflow_task && task.event_id) {
        const { completeWorkflowTask } = await import("@/app/actions/task-queue")
        // completeWorkflowTask resumes the workflow itself — the extra
        // unauthenticated /api/events/complete call it used to make here was
        // rejected by the endpoint anyway.
        const result = await completeWorkflowTask(task.id, outcome)
        if (result.status === "completed" && (result as any).workflowResumed === false) {
          setActionFailure(`Task completed, but the workflow could not resume: ${(result as any).workflowError ?? "unknown error"}`)
        }
      } else {
        const { completeTaskWithOutcome } = await import("@/app/actions/tasks")
        const result = await completeTaskWithOutcome(task.id, outcome)
        if (!result.ok) throw new Error(result.error)
      }
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    } catch (err: any) {
      setActionFailure(err?.message ?? "Failed to complete task")
    }
    setActionLoading(null)
  }

  async function handleRedirectOrEscalate() {
    if (!redirectMode) return
    setActionLoading(redirectMode)
    setActionError(null)
    setActionMessage(null)
    try {
      const { rerouteTask } = await import("@/app/actions/task-queue")
      const result = await rerouteTask(task.id, redirectMode, {
        targetUserId: redirectMode === "redirect" && redirectAssignmentMode === "many" ? undefined : (redirectTargetMode === "user" ? selectedUserId || undefined : undefined),
        targetUserIds: redirectMode === "redirect" && redirectAssignmentMode === "many" && redirectTargetMode === "user" ? selectedUserIds : undefined,
        targetEmail: redirectMode === "redirect" && redirectAssignmentMode === "single" && redirectTargetMode === "email" ? targetEmail || undefined : undefined,
        targetEmails: redirectMode === "redirect" && redirectAssignmentMode === "many" && redirectTargetMode === "email"
          ? targetEmailsText.split('\n').map(v => v.trim()).filter(Boolean)
          : undefined,
        inviteIfNeeded: redirectMode === "redirect" && redirectTargetMode === "email",
        comment,
      })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["task-queue"] })
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      router.refresh()
      if (result.invited) {
        setActionMessage(result.message ?? `Invitation sent to ${result.targetEmail}.`)
      } else {
        setActionMessage(redirectMode === "escalate" ? "Task escalated." : "Task redirected.")
        setRedirectMode(null)
      }
      setSelectedUserId("")
      setSelectedUserIds([])
      setTargetEmail("")
      setTargetEmailsText("")
      setComment("")
    } catch (err: any) {
      setActionError(err?.message ?? `Unable to ${redirectMode} task`)
    }
    setActionLoading(null)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "border-b transition-colors",
        isDragging && "opacity-30",
      )}
      {...({ style: { ...style, borderColor: "var(--theme-surface-border)" } } as any)}
    >
      {/* Main row */}
      <div
        className="grid items-center cursor-pointer transition-colors group"
        style={{
          gridTemplateColumns: gridCols,
          backgroundColor: isDarkRow ? "var(--theme-row-highlight-strong)" : "var(--theme-card-bg)",
        }}
        onClick={() => setExpanded(!expanded)}
        onDoubleClick={() => router.push(`/tasks/${task.id}`)}
      >
        <div className="flex items-center gap-2 px-3 py-3">
          <button
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className={cn(
              "shrink-0 text-gray-300 hover:text-gray-500 cursor-grab active:cursor-grabbing touch-none"
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </button>
          <TimesheetTaskCell task={task} />
        </div>
        <TimesheetBadgeCells task={task} viewMode={viewMode} weekDays={weekDays} effortMode={effortMode} />
        <TimesheetNotesCell task={task} isDarkRow={isDarkRow} />
        <Link href={`/tasks/${task.id}`} onClick={e => e.stopPropagation()}
          className="shrink-0 pr-3 py-3 hover:opacity-70 transition-opacity" style={{ color: 'var(--theme-primary-text)' }} title="Open task">
          <ExternalLink size={13} />
        </Link>
      </div>

      {/* Expand chevron indicator */}
      {expanded && (
        <div
          className="px-4 pb-4 pt-2 space-y-3"
          style={{ backgroundColor: "var(--theme-surface)" }}
        >
          {/* Meta details */}
          <div className="flex flex-wrap gap-4 text-xs" style={{ color: "var(--theme-muted-text)" }}>
            {task.assigner && (
              <span className="flex items-center gap-1"><User size={11} /> From {task.assigner.display_name}</span>
            )}
            {task.due_date && (
              <span className={cn("flex items-center gap-1", task.due_date && new Date(task.due_date) < new Date() && task.status !== "completed" && "text-red-600")}>
                <CalendarIcon size={11} /> Due {formatRelativeDate(task.due_date)}
              </span>
            )}
            {task.created_at && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> {new Date(task.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
              </span>
            )}
            <span className="capitalize">{task.status.replace(/_/g, " ")}</span>
            <Link href={`/tasks/${task.id}`} className="ml-auto flex items-center gap-1 hover:underline" style={{ color: "var(--theme-primary-text)" }}>
              <ExternalLink size={11} /> Open
            </Link>
          </div>

          {task.description && (
            <p className="text-xs line-clamp-3" style={{ color: "var(--theme-card-text)" }}>{taskDescriptionExcerpt(task.description)}</p>
          )}

          {/* Subtasks */}
          {(task.child_count ?? 0) > 0 && (
            <SubtaskList parentTaskId={task.id} tenantId={task.tenant?.id} />
          )}

          {/* Quick actions */}
          {actionFailure && (
            <p className="text-[10px] text-red-600">{actionFailure}</p>
          )}
          {!isDone && (
            <div className="flex items-center gap-2 flex-wrap">
              {outcomes.length <= 3 ? (
                outcomes.map(o => (
                  <Button key={o} size="sm" variant={outcomes.length === 1 ? "default" : "outline"} disabled={!!actionLoading} onClick={() => handleComplete(o)}>
                    {actionLoading === o ? "..." : <><CheckCircle size={12} className="mr-1" />{o.charAt(0).toUpperCase() + o.slice(1)}</>}
                  </Button>
                ))
              ) : (
                <Button size="sm" onClick={() => handleComplete(outcomes[0])} disabled={!!actionLoading}>
                  <Send size={12} className="mr-1" /> Action
                </Button>
              )}
              {canRedirect && (
                <Button size="sm" variant="outline" onClick={() => {
                    setRedirectMode("redirect")
                    setRedirectTargetMode("user")
                    setActionError(null)
                    setActionMessage(null)
                    setSelectedUserIds([])
                    setTargetEmailsText("")
                    loadUsers()
                  }} disabled={!!actionLoading}>
                  <CornerDownRight size={12} className="mr-1" /> Redirect
                </Button>
              )}
              {canEscalate && (
                <Button size="sm" variant="outline" onClick={() => {
                  setRedirectMode("escalate")
                  setRedirectTargetMode("user")
                  setActionError(null)
                  setActionMessage(null)
                  loadUsers()
                }} disabled={!!actionLoading}>
                  <ArrowUpRight size={12} className="mr-1" /> Escalate
                </Button>
              )}
            </div>
          )}

          {actionMessage && (
            <div className="rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
              {actionMessage}
            </div>
          )}

          {/* Redirect/Escalate form */}
          {redirectMode && (
            <div className="rounded-lg p-3 space-y-2" style={{ backgroundColor: "var(--theme-card-bg)", border: "1px solid var(--theme-surface-border)" }}>
              <label className="text-xs font-medium block">{redirectMode === "escalate" ? "Escalate to" : "Redirect to"}</label>
              {redirectMode === "redirect" && canInviteOnRedirect && (
                <div className="inline-flex rounded-lg border overflow-hidden" style={{ borderColor: "var(--theme-surface-border)" }}>
                  <button
                    type="button"
                    onClick={() => setRedirectTargetMode("user")}
                    className="px-3 py-1.5 text-[11px] font-medium"
                    style={redirectTargetMode === "user" ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-on-primary)" } : { backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
                  >
                    Existing user
                  </button>
                  <button
                    type="button"
                    onClick={() => setRedirectTargetMode("email")}
                    className="px-3 py-1.5 text-[11px] font-medium"
                    style={redirectTargetMode === "email" ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-on-primary)" } : { backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
                  >
                    Invite by email
                  </button>
                </div>
              )}
              {redirectMode === "redirect" && redirectAssignmentMode === "many" && redirectTargetMode === "user" ? (
                <select
                  multiple
                  value={selectedUserIds}
                  onChange={e => setSelectedUserIds(Array.from(e.target.selectedOptions).map(option => option.value))}
                  className="w-full rounded-lg border px-2 py-1.5 text-xs min-h-28"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
                >
                  {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
                </select>
              ) : redirectTargetMode === "user" || redirectMode === "escalate" ? (
                <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1.5 text-xs"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>
                  <option value="">Select a user...</option>
                  {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
                </select>
              ) : (
                redirectAssignmentMode === "many" ? (
                  <textarea
                    value={targetEmailsText}
                    onChange={e => setTargetEmailsText(e.target.value)}
                    rows={4}
                    placeholder={"name1@company.com\nname2@company.com"}
                    className="w-full rounded-lg border px-2 py-1.5 text-xs"
                    style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
                  />
                ) : (
                  <Input
                    type="email"
                    value={targetEmail}
                    onChange={e => setTargetEmail(e.target.value)}
                    placeholder="name@company.com"
                    className="text-xs"
                  />
                )
              )}
              <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2} placeholder="Reason (optional)..."
                className="w-full rounded-lg border px-2 py-1.5 text-xs"
                style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }} />
              {redirectMode === "redirect" && redirectTargetMode === "email" && canInviteOnRedirect && (
                <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                  If this email is not already in the organisation, we will send an invitation and keep the task with you until they join.
                </p>
              )}
              {redirectMode === "redirect" && redirectAssignmentMode === "many" && redirectRecipientLimitMode === "capped" && redirectRecipientLimit !== null && (
                <p className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>
                  You can redirect this task to up to {redirectRecipientLimit} people.
                </p>
              )}
              {actionError && (
                <p className="text-[10px] text-red-600">{actionError}</p>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={handleRedirectOrEscalate}
                  disabled={redirectMode === "escalate"
                    ? (!selectedUserId || !!actionLoading)
                    : (redirectTargetMode === "user"
                      ? (redirectAssignmentMode === "many" ? selectedUserIds.length === 0 : !selectedUserId)
                      : (redirectAssignmentMode === "many" ? !targetEmailsText.trim() : !targetEmail.trim())) || !!actionLoading}
                >
                  {actionLoading ? "..." : redirectMode === "escalate" ? "Escalate" : redirectTargetMode === "email" ? (redirectAssignmentMode === "many" ? "Redirect / invite many" : "Invite and keep task") : (redirectAssignmentMode === "many" ? "Redirect to many" : "Redirect")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => {
                  setRedirectMode(null)
                  setSelectedUserId("")
                  setSelectedUserIds([])
                  setTargetEmail("")
                  setTargetEmailsText("")
                  setComment("")
                  setActionError(null)
                }}>Cancel</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── Row content sub-components ─── */

function TimesheetRowContent({
  task,
  viewMode,
  weekDays,
  effortMode,
}: {
  task: any
  viewMode: "day" | "week"
  weekDays: { label: string; date: Date }[]
  effortMode: boolean
}) {
  const isDarkRow = task.is_workflow_task || task.priority === "critical"
  return (
    <>
      <div className="flex items-center gap-2 px-3 py-3">
        <TimesheetTaskCell task={task} />
      </div>
      <TimesheetBadgeCells task={task} viewMode={viewMode} weekDays={weekDays} effortMode={effortMode} />
      <TimesheetNotesCell task={task} isDarkRow={isDarkRow} />
    </>
  )
}

function TimesheetTaskCell({ task }: { task: any }) {
  const isDone = task.status === "completed" || task.status === "cancelled"
  const hasChildren = (task.child_count ?? 0) > 0
  const progressPct = hasChildren
    ? Math.round(((task.completed_child_count ?? 0) / Math.max(task.child_count ?? 1, 1)) * 100)
    : (task.progress_pct ?? (isDone ? 100 : 0))

  return (
    <div className="flex items-center gap-3 min-w-0">
      {/* Icon */}
      <div className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400">
        {task.is_workflow_task ? <Pencil size={14} /> : <Clock size={14} />}
      </div>

      {/* Task info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn(
            "font-bold text-sm",
            "text-gray-900 dark:text-white",
            isDone && "line-through opacity-60",
          )}>
            {getTaskCode(task)}
          </span>
          <span className={cn(
            "text-sm truncate",
            "text-gray-700 dark:text-gray-300",
            isDone && "line-through opacity-60",
          )}>
            · {task.title}
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {task.tenant && (
            <span className="text-xs text-gray-500">
              {task.tenant.name}
            </span>
          )}
          {task.tenant && task.assignee && (
            <span className="text-xs text-gray-400">·</span>
          )}
          {task.assignee && (
            <span className="text-xs text-gray-500">
              {task.assignee.display_name}
            </span>
          )}
        </div>
        <div className="mt-1">
          <TaskProgressStrip
            value={progressPct}
            label={hasChildren ? `${task.completed_child_count ?? 0}/${task.child_count ?? 0} subtasks` : null}
            className="max-w-[220px]"
          />
        </div>
      </div>
    </div>
  )
}

function TimesheetBadgeCells({
  task,
  viewMode,
  weekDays,
  effortMode,
}: {
  task: any
  viewMode: "day" | "week"
  weekDays: { label: string; date: Date }[]
  effortMode: boolean
}) {
  const badge = getEffortBadge(task.status, task.priority)
  const dueDate = task.due_date ? new Date(task.due_date) : null
  const isOverdue = dueDate && dueDate < new Date() && task.status !== "completed"

  if (viewMode === "week") {
    return (
      <>
        {weekDays.map((d, i) => {
          const isMatch = dueDate
            ? dueDate.getDate() === d.date.getDate() && dueDate.getMonth() === d.date.getMonth()
            : false
          return (
            <div key={i} className="flex items-center justify-center px-1 py-3">
              {isMatch ? <EffortBadge config={badge} /> : null}
            </div>
          )
        })}
      </>
    )
  }

  // Day view — show due date
  return (
    <div className="flex items-center justify-center px-2 py-3">
      {dueDate ? (
        <span className={cn("text-[10px] font-medium whitespace-nowrap", isOverdue ? "text-red-500 font-semibold" : "text-gray-600")}>
          {dueDate.toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
        </span>
      ) : (
        <span className="text-[10px]" style={{ color: "var(--theme-muted-text)" }}>—</span>
      )}
    </div>
  )
}

function TimesheetNotesCell({ task, isDarkRow }: { task: any; isDarkRow: boolean }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(task.description ?? "")
  const queryClient = useQueryClient()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
      <div className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === "Escape") { setValue(task.description ?? ""); setEditing(false) } }}
          rows={2}
          autoFocus
          className="w-full text-xs rounded border px-2 py-1.5 resize-none focus:outline-none focus:ring-1"
          style={{
            backgroundColor: "var(--theme-card-bg)",
            borderColor: "var(--theme-primary)",
            color: "var(--theme-card-text)",
            boxShadow: "0 0 0 1px var(--theme-primary)",
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="px-3 py-3 text-xs truncate cursor-text min-h-[48px] flex items-center"
      style={{ backgroundColor: isDarkRow ? "var(--theme-row-highlight-strong)" : "var(--theme-row-highlight)" }}
      onClick={(e) => {
        e.stopPropagation()
        setEditing(true)
      }}
    >
      {value ? (
        <span className="truncate text-gray-700">
          {taskDescriptionExcerpt(value)}
        </span>
      ) : (
        <span className="text-gray-400">
          Add note...
        </span>
      )}
    </div>
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
    return <div className="px-4 py-8 text-center text-sm text-red-500">Error loading tasks: {error.message}</div>
  }
  if (isLoading) return null

  return (
    <div className="space-y-3">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-[var(--theme-row-highlight)] transition-colors" style={{ color: "var(--theme-muted-text)" }}>
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-semibold min-w-[180px] text-center" style={{ color: "var(--theme-card-text)" }}>
            {MONTH_NAMES[m]} {year}
          </span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-[var(--theme-row-highlight)] transition-colors" style={{ color: "var(--theme-muted-text)" }}>
            <ChevronRight size={18} />
          </button>
        </div>
        <button onClick={goToday} className="px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-[var(--theme-row-highlight)] transition-colors" style={{ color: "var(--theme-muted-text)" }}>
          Today
        </button>
      </div>

      {/* Calendar grid */}
      <div className="rounded-xl overflow-hidden max-lg:overflow-x-auto border" style={{ borderColor: "var(--theme-surface-border)" }}>
        {/* Inner min-width keeps calendar cells legible on phones —
            the wrapper above scrolls horizontally below md. */}
        <div className="max-lg:min-w-[640px]">
        {/* Day headers */}
        <div className="grid grid-cols-7 text-xs font-semibold uppercase tracking-wider" style={{ backgroundColor: "var(--theme-row-highlight-strong)", color: "var(--theme-muted-text)" }}>
          {DAY_LABELS.map(d => (
            <div key={d} className="px-2 py-2.5 text-center">{d}</div>
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
                  "min-h-[100px] border-b border-r p-1.5 transition-colors",
                  !cell.inMonth && "opacity-40",
                  isToday && "ring-2 ring-inset",
                )}
                style={{
                  borderColor: "var(--theme-surface-border)",
                  backgroundColor: isToday ? "var(--theme-primary-light)" : "var(--theme-card-bg)",
                  ...(isToday ? { ringColor: "var(--theme-primary)" } as any : {}),
                }}
              >
                {/* Date number */}
                <div className="flex items-center justify-between mb-1">
                  <span
                    className="text-xs font-medium w-6 h-6 flex items-center justify-center rounded-full"
                    style={isToday
                      ? { backgroundColor: "var(--theme-primary)", color: "var(--theme-on-primary)" }
                      : { color: cell.inMonth ? "var(--theme-card-text)" : "var(--theme-muted-text)" }}
                  >
                    {cell.date.getDate()}
                  </span>
                  {dayTasks.length > 0 && (
                    <span className="text-[9px] font-medium rounded-full px-1.5 py-0.5" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)" }}>
                      {dayTasks.length}
                    </span>
                  )}
                </div>

                {/* Task pills */}
                <div className="space-y-0.5">
                  {dayTasks.slice(0, 3).map(task => {
                    const isDone = task.status === "completed" || task.status === "cancelled"
                    const isOverdue = isPast && !isDone
                    const isCritical = task.priority === "critical" || task.priority === "high"
                    return (
                      <button
                        key={task.id}
                        onClick={() => router.push(`/tasks/${task.id}`)}
                        className={cn(
                          "w-full text-left rounded px-1.5 py-0.5 text-[10px] leading-tight truncate transition-colors hover:opacity-80",
                          isDone && "line-through opacity-50",
                        )}
                        style={{
                          backgroundColor: isOverdue
                            ? "var(--status-danger-bg)"
                            : isCritical
                            ? "var(--status-warning-bg)"
                            : task.is_workflow_task
                            ? "var(--status-info-bg)"
                            : "var(--theme-surface)",
                          color: isOverdue
                            ? "var(--theme-danger)"
                            : isCritical
                            ? "var(--theme-warning)"
                            : "var(--theme-card-text)",
                          borderLeft: `2px solid ${
                            isOverdue ? "var(--theme-danger)" : isCritical ? "var(--status-progress)" : task.is_workflow_task ? "var(--status-info)" : "var(--theme-primary)"
                          }`,
                        }}
                        title={`${getTaskCode(task)} · ${task.title}`}
                      >
                        <span className="font-semibold">{getTaskCode(task)}</span>{" "}
                        {task.title}
                      </button>
                    )
                  })}
                  {dayTasks.length > 3 && (
                    <span className="text-[9px] px-1.5" style={{ color: "var(--theme-muted-text)" }}>
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

      {/* Unscheduled tasks */}
      {unscheduled.length > 0 && (
        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}>
          <h3 className="text-xs font-semibold" style={{ color: "var(--theme-muted-text)" }}>
            No due date ({unscheduled.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {unscheduled.slice(0, 12).map(task => (
              <button
                key={task.id}
                onClick={() => router.push(`/tasks/${task.id}`)}
                className="rounded px-2 py-1 text-[10px] truncate max-w-[200px] hover:opacity-80 transition-colors"
                style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-card-text)" }}
                title={task.title}
              >
                <span className="font-semibold">{getTaskCode(task)}</span> {task.title}
              </button>
            ))}
            {unscheduled.length > 12 && (
              <span className="text-[10px] self-center px-1" style={{ color: "var(--theme-muted-text)" }}>
                +{unscheduled.length - 12} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── All Tasks Row (flat list mode) ─── */

function AllTasksRow({
  task,
  isDarkRow,
  expanded,
  onToggle,
  onOpen,
  dragRef,
  dragAttributes,
  dragListeners,
}: {
  task: any
  isDarkRow: boolean
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
  dragRef: (node: HTMLElement | null) => void
  dragAttributes: any
  dragListeners: any
}) {
  const isDone = task.status === "completed" || task.status === "cancelled"

  return (
    <TaskListRowSummary
      task={task}
      expanded={expanded}
      onToggle={onToggle}
      onOpen={onOpen}
      dragHandle={{
        ref: dragRef,
        attributes: dragAttributes,
        listeners: dragListeners,
      }}
    />
  )
}
