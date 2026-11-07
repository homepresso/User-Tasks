"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronDown, ChevronRight, Clock, ExternalLink, Loader2, UserCheck, Users } from "lucide-react"
import { serverQuery } from "@/lib/server-read"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge, StatusPill } from "@/components/ui/badge"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { StatCard, StatGrid } from "@/components/ui/stat-card"
import { Tooltip } from "@/components/ui/tooltip"
import { Table, TBody, TD, TH, THead, TR, TableEmpty, tdClass } from "@/components/ui/table"
import { ProgressBar } from "@/components/ui/progress-bar"
import { RelativeTime } from "@/components/activity/relative-time"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePermissions } from "@/lib/permissions-context"
import { cn } from "@/lib/utils"
import { formatCount } from "@/lib/format/number"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { plural } from "@/lib/format/plural"
import { FilterMenu } from "@/components/tasks/filter-menu"
import { StatusFilterControls } from "@/components/tasks/status-filter-controls"
import { SortableTH } from "@/components/tasks/sortable-header"
import { ListRefreshButton } from "@/components/tasks/list-refresh-button"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { ProcessViewIconLink, TaskQuickActions, TaskQuickActionsToggle } from "@/components/tasks/task-quick-actions"
import { useListSort, usePersistedChoice } from "@/hooks/use-list-sort"
import { TeamHierarchy } from "@/components/tasks/team-hierarchy"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { SearchInput } from "@/components/ui/input"
import { TeamTaskRow, TEAM_TASK_COLUMNS } from "@/components/tasks/team-task-row"
import { useStatusFilter } from "@/hooks/use-status-filter"
import { rowProgress, type TaskSortKey } from "@/lib/tasks/list-sort"

/**
 * My team — the manager view (lib/services/manager-tasks.ts): open tasks of
 * the signed-in user's reports, with workload per person. Open a task to
 * act on it on the assignee's behalf (with a note); reassign to another
 * report or to yourself. Rows open the shared task detail panel (progress,
 * effort, subtasks — what a manager may change, the server decides) and
 * the quick actions. Phones get reassign / act on behalf hidden.
 */

const STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
]
const OPEN_STATUSES = ["draft", "todo", "in_progress", "blocked"] as const
const SORT_KEYS: readonly TaskSortKey[] = ["title", "assignee", "status", "priority", "progress", "due", "updated", "created"]
const COLUMNS = TEAM_TASK_COLUMNS
/** Layouts: the reporting-line tree (default), grouped by person, or one flat list. */
type Layout = "tree" | "person" | "flat"
const LAYOUTS: readonly Layout[] = ["tree", "person", "flat"]
const REFRESH_KEYS = [["team-tasks"], ["tasks", "panel"]] as const
const PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
]

type Data = Awaited<ReturnType<typeof serverQuery<'tasks.reports'>>>
type Row = Data['tasks'][number]
type Workload = Data['reports'][number]

function nameOf(p: { display_name: string | null; email: string | null } | null | undefined) {
  return p?.display_name || p?.email || "Unknown"
}

export default function MyTeamPage() {
  const { can } = usePermissions()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [indirect, setIndirect] = useState(false)
  const [person, setPerson] = useState<string>("")
  const statusFilter = useStatusFilter("team", OPEN_STATUSES)
  const { sort, toggle: toggleSort, sorted } = useListSort("team", SORT_KEYS)
  const [priority, setPriority] = useState<string[]>([])
  const [workflowId, setWorkflowId] = useState("")
  const [overdue, setOverdue] = useState(false)
  const [slaBreached, setSlaBreached] = useState(false)
  const [layout, setLayout] = usePersistedChoice<Layout>("team-layout", LAYOUTS, "tree")
  const groupByPerson = layout === "person"
  const [search, setSearch] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(timer)
  }, [search])
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [reassigning, setReassigning] = useState<string | null>(null)

  // Show completed: closed tasks too (no status list = every status).
  const filters = {
    indirect, person: person || null, status: statusFilter.statuses ?? undefined, includeClosed: statusFilter.showCompleted,
    priority, workflowId: workflowId || null, overdue, slaBreached, search: debouncedSearch.trim() || undefined,
  }
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["team-tasks", filters],
    queryFn: () => serverQuery("tasks.reports", filters),
    placeholderData: (prev) => prev,
  })
  // Unfiltered workload (cards and the person / workflow pickers).
  const { data: all } = useQuery({
    queryKey: ["team-tasks", { indirect }],
    queryFn: () => serverQuery("tasks.reports", { indirect }),
  })

  const workflows = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of all?.tasks ?? []) if (t.workflow_id) map.set(t.workflow_id, t.workflow_name ?? "Workflow")
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [all?.tasks])

  const groups = useMemo(() => {
    const byPerson = new Map<string, Row[]>()
    for (const t of data?.tasks ?? []) {
      const list = byPerson.get(t.assignee_id) ?? []
      list.push(t)
      byPerson.set(t.assignee_id, list)
    }
    return (data?.reports ?? [])
      .map((w) => ({ workload: w, rows: sorted(byPerson.get(w.user.id) ?? []) }))
      .filter((g) => g.rows.length > 0)
      .sort((a, b) => b.rows.length - a.rows.length || nameOf(a.workload.user).localeCompare(nameOf(b.workload.user)))
  }, [data, sorted])
  const rows = useMemo(() => sorted(data?.tasks ?? []), [data?.tasks, sorted])

  const header = (description: string, actions?: React.ReactNode) => (
    <PageHeader className="mb-2" title="My team" description={description} actions={actions} />
  )

  if (!can("tasks.view_own")) {
    return <EmptyState variant="error" title="Not authorized" description="You don’t have access to your team’s tasks." />
  }
  if (isLoading && !data) return <PageSkeleton variant="list" />
  if (error) {
    return (
      <div className="space-y-4">
        {header("Open tasks of the people who report to you.")}
        <EmptyState variant="error" title="Couldn’t load your team’s tasks" description={error instanceof Error ? error.message : undefined} />
      </div>
    )
  }

  const workload = all?.reports ?? []
  const totals = workload.reduce((acc, w) => ({ open: acc.open + w.open, overdue: acc.overdue + w.overdue, sla: acc.sla + w.sla_breached }), { open: 0, overdue: 0, sla: 0 })
  const reassignTargets = workload.map((w) => w.user)

  if (workload.length === 0) {
    return (
      <div className="space-y-4">
        {header("Open tasks of the people who report to you.")}
        <EmptyState icon={Users} title="Nobody reports to you"
          description="Reporting lines are set on the Team page (or synced from your directory)."
          action={can("team.view_members") ? { label: "Open Team", href: "/team" } : undefined} />
      </div>
    )
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["team-tasks"] })
  const rowProps = (t: Row) => ({
    task: t,
    readOnly: isMobile,
    reassigning: reassigning === t.id,
    onReassign: () => setReassigning(reassigning === t.id ? null : t.id),
    targets: reassignTargets,
    onDone: () => { setReassigning(null); void refresh() },
  })

  return (
    <div className="space-y-4" data-my-team>
      {header(
        "Open tasks of the people who report to you. Open a task to act on it on their behalf.",
        <>
          {isFetching && <Loader2 className="size-4 motion-safe:animate-spin text-fg-muted" aria-label="Refreshing" />}
          <ListRefreshButton queryKeys={REFRESH_KEYS} />
          <Switch checked={indirect} onCheckedChange={(v) => { setIndirect(v); setPerson("") }} label="Include indirect reports" />
        </>,
      )}

      {/* Phones: the three totals on one row; the workload a sideways strip and the filters one scrolling row, so the list starts on the first screen. */}
      <StatGrid className="max-sm:grid-cols-3">
        <StatCard label="Open tasks" value={formatCount(totals.open)} />
        <StatCard label="Overdue" value={formatCount(totals.overdue)} tone={totals.overdue > 0 ? "danger" : "default"} />
        <StatCard label="SLA breached" value={formatCount(totals.sla)} tone={totals.sla > 0 ? "danger" : "default"} />
      </StatGrid>

      {/* Workload per person */}
      <section aria-labelledby="team-workload">
        <h2 id="team-workload" className="mb-2 text-base font-semibold text-fg">Workload</h2>
        <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-3" data-workload>
          {workload.map((w: Workload) => {
            const active = person === w.user.id
            return (
              <button
                key={w.user.id}
                type="button"
                aria-pressed={active}
                onClick={() => setPerson(active ? "" : w.user.id)}
                className={cn(
                  "flex w-[min(15rem,72%)] shrink-0 snap-start items-center justify-between gap-3 rounded-lg border bg-panel px-3 py-2 text-left sm:w-auto transition-[border-color,box-shadow] duration-[var(--ds-dur-fast)]",
                  active ? "border-primary bg-primary-wash" : "border-border hover:border-border-strong hover:shadow-elev-1",
                )}
                data-workload-person={w.user.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-ui font-medium text-fg">{nameOf(w.user)}</p>
                  <p className="text-xs text-fg-muted">{w.depth === 1 ? "Direct report" : `Indirect (level ${w.depth})`}</p>
                </div>
                <div className="num flex shrink-0 items-center gap-3 text-xs text-fg-muted">
                  <span><strong className="text-base font-semibold text-fg">{formatCount(w.open)}</strong> open</span>
                  {w.overdue > 0 && <span className="inline-flex items-center gap-1 text-danger"><Clock className="size-3.5" aria-hidden />{formatCount(w.overdue)}<span className="sr-only"> overdue</span></span>}
                  {w.sla_breached > 0 && <span className="inline-flex items-center gap-1 text-danger"><AlertTriangle className="size-3.5" aria-hidden />{formatCount(w.sla_breached)}<span className="sr-only"> past SLA</span></span>}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      {/* Filters */}
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&>*]:shrink-0" role="toolbar" aria-label="Filters" data-team-filters>
        <Select size="sm" wrapperClassName="w-auto" value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {workload.map((w) => <option key={w.user.id} value={w.user.id}>{nameOf(w.user)}</option>)}
        </Select>
        <Select size="sm" wrapperClassName="w-auto" value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} aria-label="Workflow">
          <option value="">Any workflow</option>
          {workflows.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </Select>
        <FilterMenu label="Priority" options={PRIORITY_OPTIONS} selected={priority} onChange={setPriority} />
        <StatusFilterControls options={STATUS_OPTIONS} selected={statusFilter.selected} onSelectedChange={statusFilter.setSelected}
          showCompleted={statusFilter.showCompleted} onShowCompletedChange={statusFilter.setShowCompleted} />
        <Checkbox label="Overdue" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} />
        <Checkbox label="SLA breached" checked={slaBreached} onChange={(e) => setSlaBreached(e.target.checked)} className="whitespace-nowrap" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onValueChange={setSearch} aria-label="Search people and tasks"
          placeholder={layout === "tree" ? "Search people and tasks — matches open in the tree" : "Search tasks"} wrapperClassName="min-w-0 flex-1 sm:max-w-md" />
        <span className="inline-flex items-center gap-2 text-xs text-fg-muted max-sm:basis-full sm:ml-auto">
          Group by
          <SegmentedControl<Layout> aria-label="Group by" size="sm" value={layout} onValueChange={setLayout}
            options={[{ value: "tree", text: "Reporting line" }, { value: "person", text: "Person" }, { value: "flat", text: "None" }]} />
        </span>
      </div>

      {layout === "tree" ? (
        <TeamHierarchy list="team" readOnly={isMobile}
          filters={{ status: filters.status, includeClosed: filters.includeClosed, priority, search: debouncedSearch }} />
      ) : (
      <>
      <Table>
        <THead className={isMobile ? "hidden" : undefined}>
          <tr>
            <SortableTH sortKey="title" sort={sort} onSort={toggleSort}>Task</SortableTH>
            <SortableTH sortKey="assignee" sort={sort} onSort={toggleSort} className="w-36">Assignee</SortableTH>
            <SortableTH sortKey="status" sort={sort} onSort={toggleSort} className="w-32">Status</SortableTH>
            <SortableTH sortKey="priority" sort={sort} onSort={toggleSort} className="w-28">Priority</SortableTH>
            <SortableTH sortKey="progress" sort={sort} onSort={toggleSort} className="w-28">Progress</SortableTH>
            <SortableTH sortKey="due" sort={sort} onSort={toggleSort} numeric className="w-32">Due</SortableTH>
            <SortableTH sortKey="updated" sort={sort} onSort={toggleSort} numeric className="w-28">Updated</SortableTH>
            <TH className="w-px"><span className="sr-only">Open</span></TH>
            <TH className="w-px"><span className="sr-only">Actions</span></TH>
          </tr>
        </THead>
        <TBody>
          {!data?.tasks.length ? (
            <TableEmpty colSpan={COLUMNS} variant="no-results" title={statusFilter.showCompleted ? "No tasks match these filters" : "No open tasks match these filters"}
              description={statusFilter.showCompleted ? undefined : "Completed tasks are hidden — turn on Show completed to see them."} />
          ) : groupByPerson ? (
            groups.map(({ workload: w, rows }) => {
              const overdueCount = rows.filter((r) => r.is_overdue).length
              return (
                <Fragment key={w.user.id}>
                  <tr className="border-b border-border-subtle bg-subtle" data-team-group={w.user.id}>
                    <td colSpan={COLUMNS} className="p-0">
                      <button type="button" aria-expanded={!collapsed[w.user.id]}
                        className="flex h-8 w-full items-center justify-between gap-3 px-[var(--theme-density-cell-x)] text-xs font-medium text-fg-muted hover:text-fg"
                        onClick={() => setCollapsed((c) => ({ ...c, [w.user.id]: !c[w.user.id] }))}>
                        <span className="flex items-center gap-2">
                          {collapsed[w.user.id] ? <ChevronRight className="size-3.5" aria-hidden /> : <ChevronDown className="size-3.5" aria-hidden />}
                          <Users className="size-3.5" aria-hidden />{nameOf(w.user)}
                        </span>
                        <span className="num">{plural(rows.length, "task")}{overdueCount ? <span className="text-danger"> · {formatCount(overdueCount)} overdue</span> : null}</span>
                      </button>
                    </td>
                  </tr>
                  {!collapsed[w.user.id] && rows.map((t) => <TeamTaskRow key={t.id} {...rowProps(t)} />)}
                </Fragment>
              )
            })
          ) : (
            rows.map((t) => <TeamTaskRow key={t.id} {...rowProps(t)} />)
          )}
        </TBody>
      </Table>
      {data?.truncated && <InlineNotice tone="info" message="Showing the first 500 tasks — narrow the filters to see the rest." />}
      </>
      )}
    </div>
  )
}
