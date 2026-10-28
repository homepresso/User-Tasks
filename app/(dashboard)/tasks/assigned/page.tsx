"use client"

import { useState, useEffect, useMemo } from "react"
import { useAssignedTasks } from "@/hooks/use-assigned-tasks"
import { AssignedTaskRow } from "@/components/tasks/assigned-task-row"
import { Pagination } from "@/components/ui/list-controls"
import { Input } from "@/components/ui/input"
import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { useQuery } from "@tanstack/react-query"
import { serverRead } from "@/lib/server-read"
import { Card } from "@/components/ui/card"

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

export default function AssignedTasksPage() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [priorityFilter, setPriorityFilter] = useState<string[]>([])
  const [scope, setScope] = useState<'assigned_by_me' | 'team_members' | 'all'>('assigned_by_me')
  const [groupBy, setGroupBy] = useState<'none' | 'person' | 'team'>('none')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [teamId, setTeamId] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  const { data: tasks, isLoading, isFetching } = useAssignedTasks({
    status: statusFilter,
    priority: priorityFilter,
    search: debouncedSearch || undefined,
    scope,
    teamId: teamId || undefined,
  })

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, priorityFilter, scope, teamId])

  const { data: teams } = useQuery({
    queryKey: ['assigned-task-teams'],
    queryFn: async () => (await serverRead('tasks.teams')).data ?? [],
  })

  // Compute aggregate stats
  const total = tasks?.length ?? 0
  const completed = tasks?.filter((t: any) => t.status === "completed").length ?? 0
  const overdue = tasks?.filter((t: any) =>
    t.due_date && new Date(t.due_date) < new Date() && t.status !== "completed"
  ).length ?? 0
  const blocked = tasks?.filter((t: any) => t.status === "blocked").length ?? 0
  const avgProgress = total > 0
    ? Math.round((tasks?.reduce((sum: number, t: any) => sum + (t.progress_pct ?? 0), 0) ?? 0) / total)
    : 0

  const groupedTasks = useMemo(() => {
    if (!tasks?.length || groupBy === 'none') return []
    const groups = new Map<string, any[]>()

    const addToGroup = (label: string, task: any) => {
      if (!groups.has(label)) groups.set(label, [])
      groups.get(label)!.push(task)
    }

    for (const task of tasks) {
      if (groupBy === 'person') {
        addToGroup(task.assignee?.display_name ?? 'Unassigned', task)
        continue
      }
      addToGroup(task.assigned_team?.name ?? 'No team', task)
    }

    return Array.from(groups.entries())
      .map(([label, rows]) => ({
        label,
        rows: [...rows].sort((a, b) => {
          const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
          const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
          if (dueA !== dueB) return dueA - dueB
          return String(a.title ?? '').localeCompare(String(b.title ?? ''))
        }),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [groupBy, tasks])

  useEffect(() => {
    if (groupBy === 'none') return
    setCollapsedGroups((prev) => {
      const next: Record<string, boolean> = {}
      for (const group of groupedTasks) next[group.label] = prev[group.label] ?? false
      return next
    })
  }, [groupBy, groupedTasks])

  if (isLoading && !tasks) {
    return <PageSkeleton variant="list" />
  }

  function toggleStatus(status: string) {
    setStatusFilter(prev =>
      prev.includes(status) ? prev.filter(s => s !== status) : [...prev, status]
    )
  }

  function togglePriority(priority: string) {
    setPriorityFilter(prev =>
      prev.includes(priority) ? prev.filter(p => p !== priority) : [...prev, priority]
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Task Tracker
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Track assigned work, team member work, or an all-up operational view
          </p>
        </div>
        <div className="min-w-[120px] text-right">
          {isFetching && tasks?.length ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--theme-primary-light)] px-2.5 py-1 text-[11px] font-medium text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-card-text)]">
              <Loader2 size={12} className="animate-spin" />
              Refreshing
            </span>
          ) : null}
        </div>
      </div>

      {/* Stats cards */}
      {!isLoading && total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Assigned" value={total} />
          <StatCard
            label="Avg Progress"
            value={`${avgProgress}%`}
            color={avgProgress >= 75 ? "text-[color:var(--theme-card-text)]" : avgProgress >= 40 ? "text-yellow-600" : "text-gray-600"}
          />
          <StatCard
            label="Overdue"
            value={overdue}
            color={overdue > 0 ? "text-red-600" : "text-gray-600"}
          />
          <StatCard
            label="Blocked"
            value={blocked}
            color={blocked > 0 ? "text-orange-600" : "text-gray-600"}
          />
        </div>
      )}

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search task name, ID, workflow, form, assignee, assigner, team, status, priority..."
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium text-gray-500 self-center mr-1">
            Scope:
          </span>
          {([
            { value: 'assigned_by_me', label: 'Assigned By Me' },
            { value: 'team_members', label: 'Team Members' },
            { value: 'all', label: 'All Tasks' },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => { setScope(opt.value); setPage(1) }}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                scope === opt.value
                  ? "bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium text-gray-500 self-center mr-1">
            Group by:
          </span>
          {([
            { value: 'none', label: 'None' },
            { value: 'person', label: 'People' },
            { value: 'team', label: 'Teams' },
          ] as const).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setGroupBy(opt.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                groupBy === opt.value
                  ? "bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {scope === 'team_members' && (
          <div className="flex flex-wrap gap-2">
            <select
              value={teamId}
              onChange={(e) => { setTeamId(e.target.value); setPage(1) }}
              className="h-9 rounded-lg border px-3 text-xs"
            >
              <option value="">All my teams</option>
              {(teams ?? []).map((team: any) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <span className="text-xs font-medium text-gray-500 self-center mr-1">
            Status:
          </span>
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => toggleStatus(opt.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                statusFilter.includes(opt.value)
                  ? "bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              )}
            >
              {opt.label}
            </button>
          ))}

          <span className="text-xs font-medium text-gray-500 self-center ml-3 mr-1">
            Priority:
          </span>
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => togglePriority(opt.value)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                priorityFilter.includes(opt.value)
                  ? "bg-[color:var(--theme-accent-light)] text-[color:var(--theme-card-text)] dark:bg-[color:var(--theme-accent-light)] dark:text-[color:var(--theme-primary-text)]"
                  : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Task list */}
      <Card className="!p-0 overflow-hidden relative">
        {isFetching && tasks?.length ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-[color:var(--theme-primary)] to-transparent animate-pulse" />
        ) : null}
        {isLoading ? null : !tasks?.length ? (
          <div className="px-4 py-8 text-center text-sm text-gray-500">
            No tasks assigned to others yet.{" "}
            <Link
              href="/tasks/new"
              className="text-[color:var(--theme-card-text)] hover:text-[color:var(--theme-card-text)]"
            >
              Create and assign a task
            </Link>
          </div>
        ) : groupBy !== 'none' ? (
          <div className={cn("transition-opacity duration-200 divide-y divide-[var(--theme-surface-border)]", isFetching ? "opacity-80" : "opacity-100")}>
            {groupedTasks.map((group) => (
              <div key={group.label}>
                <div
                  className="sticky top-0 z-[1] flex items-center justify-between gap-3 px-4 py-2 text-xs font-semibold cursor-pointer"
                  style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}
                  onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {collapsedGroups[group.label] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                    <span className="truncate">{group.label}</span>
                    <span>{group.rows.length} task{group.rows.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px]">
                    <span>{group.rows.filter((task: any) => task.status === 'blocked').length} blocked</span>
                    <span>{group.rows.filter((task: any) => task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed').length} overdue</span>
                    <span>
                      {Math.round(group.rows.reduce((sum: number, task: any) => sum + (task.progress_pct ?? 0), 0) / Math.max(group.rows.length, 1))}% avg
                    </span>
                  </div>
                </div>
                {!collapsedGroups[group.label] && (
                  <div>
                    {group.rows.map((task: any) => (
                      <AssignedTaskRow key={task.id} task={task} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={cn("transition-opacity duration-200", isFetching ? "opacity-80" : "opacity-100")}>
            {tasks.slice((page - 1) * pageSize, page * pageSize).map((task: any) => (
              <AssignedTaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </Card>
      {groupBy === 'none' && (
        <Pagination page={page} pageSize={pageSize} total={tasks?.length ?? 0} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={cn("text-xl font-semibold mt-0.5", color ?? "text-gray-900 dark:text-white")}>
        {value}
      </p>
    </div>
  )
}
