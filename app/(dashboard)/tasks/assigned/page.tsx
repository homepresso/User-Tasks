"use client"

import { Fragment, useState, useEffect, useMemo } from "react"
import { useAssignedTasks } from "@/hooks/use-assigned-tasks"
import { useFollowedTasks, useFollowingCount } from "@/hooks/use-followed-tasks"
import { useRealtimeUserId } from "@/hooks/use-realtime"
import { useFollowedTaskIds } from "@/components/tasks/task-follow-button"
import { ASSIGNED_TASK_COLUMNS, AssignedTaskRow } from "@/components/tasks/assigned-task-row"
import { Pagination } from "@/components/ui/list-controls"
import { SearchInput } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Bell, ChevronDown, ChevronRight, ListChecks, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Tabs } from "@/components/ui/tabs"
import { StatCard, StatGrid } from "@/components/ui/stat-card"
import { Table, TBody, TH, THead, TableEmpty, TableSkeleton } from "@/components/ui/table"
import { formatCount, formatPercent } from "@/lib/format/number"
import { plural } from "@/lib/format/plural"
import { useQuery } from "@tanstack/react-query"
import { serverRead } from "@/lib/server-read"
import { FilterMenu } from "@/components/tasks/filter-menu"
import { StatusFilterControls } from "@/components/tasks/status-filter-controls"
import { FollowPreferenceSwitch } from "@/components/tasks/follow-preferences"
import { SortableTH } from "@/components/tasks/sortable-header"
import { ListRefreshButton } from "@/components/tasks/list-refresh-button"
import { useListSort, usePersistedChoice } from "@/hooks/use-list-sort"
import { useIsMobile } from "@/hooks/use-mobile"
import { TeamHierarchy } from "@/components/tasks/team-hierarchy"
import { useStatusFilter } from "@/hooks/use-status-filter"
import { isStatusFiltered } from "@/lib/tasks/status-filter"
import type { TaskSortKey } from "@/lib/tasks/list-sort"
import { defaultTrackerTab, readStoredTrackerTab, storeTrackerTab, TRACKER_TABS, type TrackerTab } from "@/lib/tasks/tracker-tabs"

/** The Status menu: open statuses (Completed / Cancelled come back with "Show completed"). */
const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
]
/** Every open status (drafts too): what the list asks for by default. */
const OPEN_STATUSES = ["draft", "todo", "in_progress", "blocked"] as const

const SORT_KEYS: readonly TaskSortKey[] = ["title", "assignee", "status", "priority", "progress", "due", "updated", "created"]

/** Refresh: the tracker's lists (each tab) and the open rows' panels. */
const REFRESH_KEYS = [["assigned-tasks"], ["task-follows"], ["tasks", "panel"]] as const

const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

/** 'reporting': the reporting-line tree (Team members tab only, its default). */
type GroupBy = 'none' | 'person' | 'team' | 'reporting'
const TEAM_GROUP_BYS: readonly GroupBy[] = ['reporting', 'none', 'person', 'team']

export default function AssignedTasksPage() {
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const statusFilter = useStatusFilter("tracker", OPEN_STATUSES)
  const { sort, toggle: toggleSort, sorted } = useListSort("tracker", SORT_KEYS)
  const [priorityFilter, setPriorityFilter] = useState<string[]>([])
  const userId = useRealtimeUserId()
  // The tab picked on this visit; else the one remembered for this user in this browser.
  const [pickedTab, setPickedTab] = useState<TrackerTab | null>(null)
  const [userIdTimedOut, setUserIdTimedOut] = useState(false)
  const [pickedGroupBy, setPickedGroupBy] = useState<GroupBy>('none')
  const [teamGroupBy, setTeamGroupBy] = usePersistedChoice<GroupBy>('tracker-team-groupby', TEAM_GROUP_BYS, 'reporting')
  const isMobile = useIsMobile()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [teamId, setTeamId] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])

  // undefined = not known yet (the user id loads after mount); null = nothing remembered.
  const storedTab = useMemo(() => (userId ? readStoredTrackerTab(userId) : undefined), [userId])
  // Never wait on the user id for long (signed-out edge cases): fall back to the default tab.
  useEffect(() => {
    const timer = setTimeout(() => setUserIdTimedOut(true), 1500)
    return () => clearTimeout(timer)
  }, [])
  const rememberedTab = storedTab === undefined && userIdTimedOut ? null : storedTab

  const followingCount = useFollowingCount()
  // Following first: opened when remembered, or by default when the person follows something.
  const tab: TrackerTab | null = pickedTab
    ?? (rememberedTab === undefined
      ? null
      : rememberedTab ?? (followingCount.isPending ? null : defaultTrackerTab(null, followingCount.data?.total)))
  const onFollowing = tab === 'following'
  // Team members: the reporting-line tree by default (remembered); other tabs: None / People / Teams.
  const groupBy: GroupBy = tab === 'team_members' ? teamGroupBy : pickedGroupBy === 'reporting' ? 'none' : pickedGroupBy
  const setGroupBy = (next: GroupBy) => (tab === 'team_members' ? setTeamGroupBy(next) : setPickedGroupBy(next))
  const onTree = groupBy === 'reporting'

  const statuses = statusFilter.statuses ?? undefined
  const assigned = useAssignedTasks({
    status: statuses,
    priority: priorityFilter,
    search: debouncedSearch || undefined,
    scope: tab && tab !== 'following' ? tab : 'assigned_by_me',
    teamId: teamId || undefined,
  }, { enabled: tab !== null && !onFollowing && !onTree })
  // Following: the same status filter (its old "Hide completed" is "Show completed" off).
  const followed = useFollowedTasks({
    status: statuses,
    priority: priorityFilter,
    search: debouncedSearch || undefined,
    hideCompleted: !statusFilter.showCompleted,
  }, { enabled: onFollowing })
  const active = onFollowing ? followed : assigned
  // Sorted before paging (and within groups) so every page follows the sort.
  const tasks = useMemo(() => (active.data ? sorted(active.data as any[]) : active.data), [active.data, sorted])
  const isLoading = tab === null || active.isLoading
  const isFetching = active.isFetching

  function selectTab(next: TrackerTab) {
    setPickedTab(next)
    storeTrackerTab(userId, next)
    setPage(1)
  }

  const statusesKey = statuses?.join(",") ?? ""
  const sortKey = sort ? `${sort.key}:${sort.dir}` : ""
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusesKey, priorityFilter, tab, teamId, sortKey])

  const { data: teams } = useQuery({
    queryKey: ['assigned-task-teams'],
    queryFn: async () => (await serverRead('tasks.teams')).data ?? [],
  })

  // Compute aggregate stats
  const total = tasks?.length ?? 0
  const overdue = tasks?.filter((t: any) =>
    t.due_date && new Date(t.due_date) < new Date() && t.status !== "completed"
  ).length ?? 0
  const blocked = tasks?.filter((t: any) => t.status === "blocked").length ?? 0
  const avgProgress = total > 0
    ? Math.round((tasks?.reduce((sum: number, t: any) => sum + (t.progress_pct ?? 0), 0) ?? 0) / total)
    : 0

  const groupedTasks = useMemo(() => {
    if (!tasks?.length || groupBy === 'none' || groupBy === 'reporting') return []
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
        // A column sort applies inside each group; else due date, then title.
        rows: sort ? rows : [...rows].sort((a, b) => {
          const dueA = a.due_date ? new Date(a.due_date).getTime() : Number.MAX_SAFE_INTEGER
          const dueB = b.due_date ? new Date(b.due_date).getTime() : Number.MAX_SAFE_INTEGER
          if (dueA !== dueB) return dueA - dueB
          return String(a.title ?? '').localeCompare(String(b.title ?? ''))
        }),
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [groupBy, tasks, sort])

  // The bells' state: one read for the rows on screen (every row when grouped).
  const shownIds = useMemo(() => {
    const rows = (tasks ?? []) as Array<{ id: string }>
    const shown = groupBy === 'none' ? rows.slice((page - 1) * pageSize, page * pageSize) : rows
    return shown.map((task) => String(task.id))
  }, [tasks, groupBy, page, pageSize])
  const followedIds = useFollowedTaskIds(shownIds)
  const followingOf = (taskId: string) => (followedIds ? followedIds.has(taskId) : undefined)

  useEffect(() => {
    if (groupBy === 'none' || groupBy === 'reporting') return
    setCollapsedGroups((prev) => {
      const next: Record<string, boolean> = {}
      for (const group of groupedTasks) next[group.label] = prev[group.label] ?? false
      return next
    })
  }, [groupBy, groupedTasks])

  // First paint only: which tab opens isn't known yet. Switching tabs keeps the page and shows row skeletons.
  if (tab === null) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-2"
        title="Task tracker"
        description="Track assigned work, team member work, or an all-up operational view."
        actions={(
          <>
            {isFetching && tasks?.length ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted" role="status">
                <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden />
                Refreshing
              </span>
            ) : null}
            <ListRefreshButton queryKeys={REFRESH_KEYS} />
          </>
        )}
      />

      <Tabs<TrackerTab>
        aria-label="Task tracker views"
        value={tab ?? 'following'}
        onValueChange={selectTab}
        items={TRACKER_TABS.map((item) => item.value === 'following'
          ? { ...item, icon: <Bell />, count: followingCount.data?.total }
          : item)}
      />

      {/* Stats */}
      {!isLoading && total > 0 && (
        <StatGrid>
          <StatCard label={onFollowing ? "Total followed" : "Total assigned"} value={formatCount(total)} />
          <StatCard label="Average progress" value={formatPercent(avgProgress, { fromPercent: true })} />
          <StatCard label="Overdue" value={formatCount(overdue)} tone={overdue > 0 ? "danger" : "default"} />
          <StatCard label="Blocked" value={formatCount(blocked)} tone={blocked > 0 ? "warning" : "default"} />
        </StatGrid>
      )}

      {/* Toolbar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {tab === 'team_members' && !onTree && (
            <Select size="sm" wrapperClassName="w-auto" aria-label="Team" value={teamId} onChange={(e) => { setTeamId(e.target.value); setPage(1) }}>
              <option value="">All my teams</option>
              {(teams ?? []).map((team: any) => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </Select>
          )}
          <span className="ml-auto inline-flex items-center gap-2 text-xs text-fg-muted">
            Group by
            <SegmentedControl<GroupBy>
              aria-label="Group by"
              size="sm"
              value={groupBy}
              onValueChange={setGroupBy}
              options={[
                ...(tab === 'team_members' ? [{ value: 'reporting' as const, text: 'Reporting line' }] : []),
                { value: 'none', text: 'None' },
                { value: 'person', text: 'People' },
                { value: 'team', text: 'Teams' },
              ]}
            />
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search task name, ID, workflow, form, assignee, assigner, team, status, priority…"
            aria-label="Search tracked tasks"
            className="min-w-[16rem]"
            wrapperClassName="flex-1"
          />
          <FilterMenu label="Priority" options={PRIORITY_OPTIONS} selected={priorityFilter} onChange={setPriorityFilter} />
          {onFollowing && <FollowPreferenceSwitch name="auto_follow_acted_runs" />}
          <StatusFilterControls options={STATUS_OPTIONS} selected={statusFilter.selected} onSelectedChange={statusFilter.setSelected}
            showCompleted={statusFilter.showCompleted} onShowCompletedChange={statusFilter.setShowCompleted} />
        </div>
      </div>

      {/* Task list */}
      {onTree ? (
        <TeamHierarchy list="tracker" readOnly={isMobile}
          filters={{ status: statuses, includeClosed: statusFilter.showCompleted, priority: priorityFilter, search: debouncedSearch }} />
      ) : (
      <>
      <Table className={cn("transition-opacity duration-[var(--ds-dur-base)]", isFetching && tasks?.length ? "opacity-80" : "opacity-100")}>
        <THead className={isMobile ? "hidden" : undefined}>
          <tr>
            <TH className="w-8"><span className="sr-only">Follow</span></TH>
            <SortableTH sortKey="title" sort={sort} onSort={toggleSort}>Task</SortableTH>
            <SortableTH sortKey="assignee" sort={sort} onSort={toggleSort} className="w-36">Assignee</SortableTH>
            <SortableTH sortKey="status" sort={sort} onSort={toggleSort} className="w-32">Status</SortableTH>
            <SortableTH sortKey="priority" sort={sort} onSort={toggleSort} className="w-28">Priority</SortableTH>
            <SortableTH sortKey="progress" sort={sort} onSort={toggleSort} className="w-28">Progress</SortableTH>
            <SortableTH sortKey="due" sort={sort} onSort={toggleSort} numeric className="w-28">Due</SortableTH>
            <SortableTH sortKey="updated" sort={sort} onSort={toggleSort} numeric className="w-28">Updated</SortableTH>
            <TH className="w-16"><span className="sr-only">Open</span></TH>
            <TH className="w-24"><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {isLoading && !tasks ? (
            <TableSkeleton columns={ASSIGNED_TASK_COLUMNS} rows={5} />
          ) : !tasks?.length && onFollowing ? (
            <TableEmpty
              colSpan={ASSIGNED_TASK_COLUMNS}
              icon={Bell}
              title={debouncedSearch || isStatusFiltered(statusFilter.state) || priorityFilter.length ? "No followed tasks match these filters" : "You're not following any open tasks"}
              description="Click the bell on any task in the tracker (or Follow on a task's page) to follow it here. The open tasks of processes you follow — ones you started or acted on — show here too."
            />
          ) : !tasks?.length ? (
            <TableEmpty
              colSpan={ASSIGNED_TASK_COLUMNS}
              icon={ListChecks}
              title={debouncedSearch || statusFilter.selected.length || priorityFilter.length ? "No tasks match these filters" : statusFilter.showCompleted ? "No tasks assigned to others yet" : "No open tasks assigned to others"}
              description={statusFilter.showCompleted ? undefined : "Completed tasks are hidden — turn on Show completed to see them."}
              action={{ label: "Create and assign a task", href: "/tasks/new" }}
            />
          ) : groupBy !== 'none' ? (
            groupedTasks.map((group) => {
              const groupBlocked = group.rows.filter((task: any) => task.status === 'blocked').length
              const groupOverdue = group.rows.filter((task: any) => task.due_date && new Date(task.due_date) < new Date() && task.status !== 'completed').length
              const groupAvg = Math.round(group.rows.reduce((sum: number, task: any) => sum + (task.progress_pct ?? 0), 0) / Math.max(group.rows.length, 1))
              return (
                <Fragment key={group.label}>
                  <tr className="border-b border-border-subtle bg-subtle">
                    <td colSpan={ASSIGNED_TASK_COLUMNS} className="p-0">
                      <button
                        type="button"
                        aria-expanded={!collapsedGroups[group.label]}
                        className="flex h-8 w-full items-center justify-between gap-3 px-[var(--theme-density-cell-x)] text-xs font-medium text-fg-muted hover:text-fg"
                        onClick={() => setCollapsedGroups((prev) => ({ ...prev, [group.label]: !prev[group.label] }))}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {collapsedGroups[group.label] ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                          <span className="truncate text-fg">{group.label}</span>
                          <span className="num">{plural(group.rows.length, "task")}</span>
                        </span>
                        <span className="num flex items-center gap-3">
                          <span>{formatCount(groupBlocked)} blocked</span>
                          <span className={groupOverdue ? "text-danger" : undefined}>{formatCount(groupOverdue)} overdue</span>
                          <span>{formatPercent(groupAvg, { fromPercent: true })} avg</span>
                        </span>
                      </button>
                    </td>
                  </tr>
                  {!collapsedGroups[group.label] && group.rows.map((task: any) => (
                    <AssignedTaskRow key={task.id} task={task} following={followingOf(task.id)} />
                  ))}
                </Fragment>
              )
            })
          ) : (
            tasks.slice((page - 1) * pageSize, page * pageSize).map((task: any) => (
              <AssignedTaskRow key={task.id} task={task} following={followingOf(task.id)} />
            ))
          )}
        </TBody>
      </Table>
      {groupBy === 'none' && (
        <Pagination page={page} pageSize={pageSize} total={tasks?.length ?? 0} onPageChange={setPage} onPageSizeChange={setPageSize} />
      )}
      </>
      )}
    </div>
  )
}
