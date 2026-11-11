"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronRight, ChevronsDownUp, ChevronsUpDown, Clock, Inbox, Users } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/tooltip"
import { Table, TBody, TH, THead, TableEmpty } from "@/components/ui/table"
import { SortableTH } from "@/components/tasks/sortable-header"
import { TeamTaskRow, TEAM_TASK_COLUMNS, type TeamTaskRowData } from "@/components/tasks/team-task-row"
import { useListSort } from "@/hooks/use-list-sort"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePermissions } from "@/lib/permissions-context"
import { serverQuery } from "@/lib/server-read"
import { formatCount } from "@/lib/format/number"
import { pathTo, readExpanded, storeExpanded, type HierarchyNode, type TeamHierarchy as TeamHierarchyData } from "@/lib/tasks/hierarchy"
import type { TaskSortKey } from "@/lib/tasks/list-sort"
import { cn } from "@/lib/utils"

/**
 * "Group by reporting line" (My team, and the Task tracker's Team members
 * tab): the viewer's org tree from reporting lines (`tasks.teamHierarchy`,
 * lib/services/team-hierarchy.ts). Level 1 is their direct reports; each
 * person shows their open / overdue / queued counts — their own and rolled
 * up over everyone below them — and opens (chevron, Enter / Space) to show
 * their own tasks (loaded then: `tasks.reports` for that person, with the
 * list's sort and status filter) and, beneath, their direct reports, level
 * by level. Expand all / Collapse all; the open people are remembered per
 * user in this browser; a search opens the path to each match and marks it.
 * Anyone with View all tasks can pick another person as the root.
 */

const SORT_KEYS: readonly TaskSortKey[] = ["title", "assignee", "status", "priority", "progress", "due", "updated", "created"]

export interface TeamHierarchyFilters {
  /** Status list for the reads (undefined = every status the read defaults to). */
  status?: string[]
  includeClosed: boolean
  priority?: string[]
  search?: string
}

export function TeamHierarchy({ list, filters, readOnly }: {
  /** Which list (remembered expansion and sort): "team" or "tracker". */
  list: string
  filters: TeamHierarchyFilters
  /** Phones: no Act on behalf / Reassign. */
  readOnly: boolean
}) {
  const { userId } = usePermissions()
  const mobile = useIsMobile()
  const [root, setRoot] = useState<string | null>(null)
  const search = filters.search?.trim() || undefined
  const { data, isPending, error } = useQuery({
    queryKey: ["team-tasks", "hierarchy", { root, search }],
    queryFn: () => serverQuery("tasks.teamHierarchy", { root, search }) as Promise<TeamHierarchyData>,
    placeholderData: (prev) => prev,
  })
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loadedFor, setLoadedFor] = useState<string | null | undefined>(undefined)
  const sort = useListSort(`${list}-tree`, SORT_KEYS)

  // Restore the remembered open people once the user is known.
  useEffect(() => {
    if (loadedFor === userId) return
    setExpanded(new Set(readExpanded(list, userId)))
    setLoadedFor(userId)
  }, [list, userId, loadedFor])

  function update(next: Set<string>) {
    setExpanded(next)
    storeExpanded(list, userId, next)
  }

  // A search opens the path to every match (not remembered).
  const searchOpen = useMemo(() => {
    const open = new Set<string>()
    if (!search || !data) return open
    for (const node of Object.values(data.nodes)) {
      if (!node.match) continue
      for (const id of pathTo(data.nodes, node.id)) open.add(id)
    }
    return open
  }, [search, data])

  if (isPending && !data) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading your reporting line">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </div>
    )
  }
  if (error) return <EmptyState size="sm" variant="error" title="Couldn’t load your reporting line" description={(error as Error).message} />
  if (!data) return null

  const allIds = Object.keys(data.nodes)
  const isOpen = (id: string) => expanded.has(id) || searchOpen.has(id)
  const toggle = (id: string) => {
    const next = new Set(expanded)
    if (isOpen(id)) next.delete(id)
    else next.add(id)
    update(next)
  }
  const matches = search ? Object.values(data.nodes).filter((n) => n.match).length : null

  return (
    <div className="space-y-2" data-team-hierarchy={list}>
      <div className="flex flex-wrap items-center gap-2">
        {data.rootOptions && (
          <Select size="sm" wrapperClassName="w-auto" aria-label="Start from" value={root ?? ""} onChange={(e) => setRoot(e.target.value || null)} data-team-hierarchy-root>
            <option value="">My reporting line</option>
            {data.rootOptions.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        )}
        <span className="text-xs text-fg-muted max-sm:order-last max-sm:basis-full">
          {root ? `${data.root.name}’s reporting line` : "Your reporting line"} · <span className="num">{formatCount(allIds.length)}</span> {allIds.length === 1 ? "person" : "people"}
          {matches !== null && <> · <span className="num">{formatCount(matches)}</span> matching</>}
        </span>
        {/* Phones: icon buttons beside the reporting-line picker (the count drops to the line below). */}
        <span className="ml-auto inline-flex items-center gap-1">
          {mobile ? (
            <>
              <Tooltip content="Expand all"><Button size="icon-sm" variant="ghost" aria-label="Expand all" onClick={() => update(new Set(allIds))} data-team-expand-all><ChevronsUpDown /></Button></Tooltip>
              <Tooltip content="Collapse all"><Button size="icon-sm" variant="ghost" aria-label="Collapse all" onClick={() => update(new Set())} data-team-collapse-all><ChevronsDownUp /></Button></Tooltip>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" leadingIcon={<ChevronsUpDown />} onClick={() => update(new Set(allIds))} data-team-expand-all>Expand all</Button>
              <Button size="sm" variant="ghost" leadingIcon={<ChevronsDownUp />} onClick={() => update(new Set())} data-team-collapse-all>Collapse all</Button>
            </>
          )}
        </span>
      </div>
      {data.truncated && <InlineNotice tone="info" message="Counts cover the first 10,000 open tasks." />}
      {data.top.length === 0 ? (
        <EmptyState size="sm" icon={Users} title="Nobody reports to you" description="Reporting lines are set on the Team page (or synced from your directory)." />
      ) : (
        <ul className="space-y-1" aria-label="Reporting line">
          {data.top.map((id) => (
            <PersonNode key={id} id={id} data={data} root={root} isOpen={isOpen} toggle={toggle} filters={filters} readOnly={readOnly} sort={sort} />
          ))}
        </ul>
      )}
    </div>
  )
}

type Sort = ReturnType<typeof useListSort<TaskSortKey>>

function PersonNode({ id, data, root, isOpen, toggle, filters, readOnly, sort }: {
  id: string
  data: TeamHierarchyData
  root: string | null
  isOpen: (id: string) => boolean
  toggle: (id: string) => void
  filters: TeamHierarchyFilters
  readOnly: boolean
  sort: Sort
}) {
  const node = data.nodes[id]
  if (!node) return null
  const open = isOpen(id)
  const panelId = `team-node-${id}`
  return (
    <li className="min-w-0" data-team-node={id} data-team-node-depth={node.depth}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => toggle(id)}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-md border bg-panel px-3 py-2 text-left transition-colors duration-[var(--ds-dur-fast)] hover:border-border-strong motion-reduce:transition-none",
          node.match ? "border-primary" : "border-border",
        )}
        data-team-node-toggle={id}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-fg-muted transition-transform duration-[var(--ds-dur-fast)] motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
        <Avatar name={node.name} src={node.avatar_url} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ui font-medium text-fg">
            {node.match ? <mark className="rounded-sm bg-warning-wash px-0.5 text-fg" data-team-node-match>{node.name}</mark> : node.name}
          </span>
          <span className="block truncate text-xs text-fg-muted">
            {[node.job_title, node.reports.length ? `${node.reports.length} direct report${node.reports.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ") || " "}
          </span>
        </span>
        <Counts node={node} />
      </button>
      {open && (
        <div id={panelId} className="ml-4 mt-1 space-y-1 border-l border-border-subtle pl-3 max-sm:ml-2 max-sm:pl-2">
          <PersonTasks node={node} root={root} filters={filters} readOnly={readOnly} sort={sort} targets={Object.values(data.nodes)} />
          {node.reports.length > 0 && (
            <ul className="space-y-1" aria-label={`${node.name}’s reports`}>
              {node.reports.map((child) => (
                <PersonNode key={child} id={child} data={data} root={root} isOpen={isOpen} toggle={toggle} filters={filters} readOnly={readOnly} sort={sort} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  )
}

/** Own and rolled-up counts: "3 open (12 in team)", overdue and queued when any. */
function Counts({ node }: { node: HierarchyNode }) {
  const team = node.reports.length > 0
  return (
    <span className="num flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-0.5 text-xs text-fg-muted" data-team-node-counts>
      <span title="Open tasks: their own, and with everyone below them">
        <strong className="text-sm font-semibold text-fg">{formatCount(node.own.open)}</strong> open
        {team && <> · <span data-team-rollup-open>{formatCount(node.rollup.open)}</span> in team</>}
      </span>
      {node.rollup.overdue > 0 && (
        <span className="inline-flex items-center gap-1 text-danger" title="Overdue: own (with everyone below)">
          <Clock className="size-3.5" aria-hidden />{formatCount(node.own.overdue)}{team && node.rollup.overdue !== node.own.overdue ? ` (${formatCount(node.rollup.overdue)})` : ""}<span className="sr-only"> overdue</span>
        </span>
      )}
      {node.rollup.queued > 0 && (
        <span className="inline-flex items-center gap-1" title="Queued (waiting for acceptance): own (with everyone below)">
          <Inbox className="size-3.5" aria-hidden />{formatCount(node.own.queued)}{team && node.rollup.queued !== node.own.queued ? ` (${formatCount(node.rollup.queued)})` : ""}<span className="sr-only"> queued</span>
        </span>
      )}
    </span>
  )
}

/** A person's own tasks, read when their node opens. */
function PersonTasks({ node, root, filters, readOnly, sort, targets }: {
  node: HierarchyNode
  root: string | null
  filters: TeamHierarchyFilters
  readOnly: boolean
  sort: Sort
  targets: HierarchyNode[]
}) {
  const queryClient = useQueryClient()
  const mobile = useIsMobile()
  const [reassigning, setReassigning] = useState<string | null>(null)
  const args = {
    indirect: true, person: node.id, root, status: filters.status, includeClosed: filters.includeClosed,
    priority: filters.priority, search: filters.search?.trim() || undefined,
  }
  const { data, isPending, error } = useQuery({
    queryKey: ["team-tasks", "person", args],
    queryFn: () => serverQuery("tasks.reports", args),
  })
  if (isPending) return <Skeleton className="h-8 w-full" aria-label={`Loading ${node.name}’s tasks`} />
  if (error) return <p role="alert" className="text-xs text-danger">{(error as Error).message}</p>
  const rows = sort.sorted((data?.tasks ?? []) as TeamTaskRowData[])
  if (!rows.length) {
    return <p className="px-1 text-xs text-fg-muted" data-team-node-no-tasks>{filters.includeClosed ? "No tasks of their own match." : "No open tasks of their own."}</p>
  }
  const people = targets.map((t) => ({ id: t.id, display_name: t.name, email: t.email }))
  return (
    // Phones: task cards (TeamTaskRow), no header row. Wider: readable columns (col presets) that scroll sideways.
    <Table data-team-node-tasks={node.id} label={`${node.name}’s tasks`} stickyFirstColumn>
      <THead className={mobile ? "hidden" : undefined}>
        <tr>
          <SortableTH sortKey="title" sort={sort.sort} onSort={sort.toggle} col="title">Task</SortableTH>
          <SortableTH sortKey="assignee" sort={sort.sort} onSort={sort.toggle} col="people" className="w-36">Assignee</SortableTH>
          <SortableTH sortKey="status" sort={sort.sort} onSort={sort.toggle} col="status" className="w-32">Status</SortableTH>
          <SortableTH sortKey="priority" sort={sort.sort} onSort={sort.toggle} col="status" className="w-28">Priority</SortableTH>
          <SortableTH sortKey="progress" sort={sort.sort} onSort={sort.toggle} className="w-28 min-w-28">Progress</SortableTH>
          <SortableTH sortKey="due" sort={sort.sort} onSort={sort.toggle} numeric col="date" className="w-32">Due</SortableTH>
          <SortableTH sortKey="updated" sort={sort.sort} onSort={sort.toggle} numeric col="date" className="w-28">Updated</SortableTH>
          <TH col="actions"><span className="sr-only">Open</span></TH>
          <TH col="actions"><span className="sr-only">Actions</span></TH>
        </tr>
      </THead>
      <TBody>
        {rows.length === 0 ? <TableEmpty colSpan={TEAM_TASK_COLUMNS} title="No tasks" /> : rows.map((t) => (
          <TeamTaskRow key={t.id} task={t} readOnly={readOnly} reassigning={reassigning === t.id}
            onReassign={() => setReassigning(reassigning === t.id ? null : t.id)} targets={people}
            onDone={() => { setReassigning(null); void queryClient.invalidateQueries({ queryKey: ["team-tasks"] }) }} />
        ))}
      </TBody>
      {data?.truncated && (
        <tfoot><tr><td colSpan={TEAM_TASK_COLUMNS} className="px-3 py-1.5 text-xs text-fg-muted"><AlertTriangle className="mr-1 inline size-3.5" aria-hidden />Showing the first 500 tasks.</td></tr></tfoot>
      )}
    </Table>
  )
}
