"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, ChevronDown, ChevronRight, Clock, Loader2, UserCheck, Users } from "lucide-react"
import { serverQuery } from "@/lib/server-read"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui/status-badge"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { useIsMobile } from "@/hooks/use-mobile"
import { usePermissions } from "@/lib/permissions-context"
import { cn, formatRelativeDate } from "@/lib/utils"

/**
 * My team — the manager view (lib/services/manager-tasks.ts): open tasks of
 * the signed-in user's reports, with workload per person. Open a task to
 * act on it on the assignee's behalf (with a note); reassign to another
 * report or to yourself. Phones get the list read-only.
 */

const STATUS_OPTIONS = [
  { value: "todo", label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked", label: "Blocked" },
]
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

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("rounded-full px-3 py-1 text-xs font-medium transition-colors")}
      style={active
        ? { backgroundColor: "var(--theme-accent-light)", color: "var(--theme-card-text)" }
        : { backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
    >
      {children}
    </button>
  )
}

export default function MyTeamPage() {
  const { can } = usePermissions()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()
  const [indirect, setIndirect] = useState(false)
  const [person, setPerson] = useState<string>("")
  const [status, setStatus] = useState<string[]>([])
  const [priority, setPriority] = useState<string[]>([])
  const [workflowId, setWorkflowId] = useState("")
  const [overdue, setOverdue] = useState(false)
  const [slaBreached, setSlaBreached] = useState(false)
  const [groupByPerson, setGroupByPerson] = useState(true)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [reassigning, setReassigning] = useState<string | null>(null)

  const filters = { indirect, person: person || null, status, priority, workflowId: workflowId || null, overdue, slaBreached }
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
      .map((w) => ({ workload: w, rows: byPerson.get(w.user.id) ?? [] }))
      .filter((g) => g.rows.length > 0)
      .sort((a, b) => b.rows.length - a.rows.length || nameOf(a.workload.user).localeCompare(nameOf(b.workload.user)))
  }, [data])

  if (!can("tasks.view_own")) return <p className="text-sm" style={{ color: "var(--theme-muted-text)" }}>Not authorized.</p>
  if (isLoading && !data) return <PageSkeleton variant="list" />
  if (error) return <p className="text-sm" style={{ color: "var(--status-blocked)" }}>{error instanceof Error ? error.message : "Could not load your team's tasks"}</p>

  const workload = all?.reports ?? []
  const totals = workload.reduce((acc, w) => ({ open: acc.open + w.open, overdue: acc.overdue + w.overdue, sla: acc.sla + w.sla_breached }), { open: 0, overdue: 0, sla: 0 })
  const reassignTargets = workload.map((w) => w.user)

  if (workload.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold" style={{ color: "var(--theme-card-text)" }}>My team</h1>
        <Card className="p-6 text-sm" style={{ color: "var(--theme-muted-text)" }}>
          Nobody reports to you in this workspace. Reporting lines are set on the Team page (or synced from your directory).
        </Card>
      </div>
    )
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["team-tasks"] })

  return (
    <div className="space-y-4" data-my-team>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "var(--theme-card-text)" }}>My team</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--theme-muted-text)" }}>
            Open tasks of the people who report to you. Open a task to act on it on their behalf.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isFetching && <Loader2 size={14} className="animate-spin" style={{ color: "var(--theme-muted-text)" }} />}
          <label className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: "var(--theme-card-text)" }}>
            <input type="checkbox" checked={indirect} onChange={(e) => { setIndirect(e.target.checked); setPerson("") }} />
            Include indirect reports
          </label>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Open tasks" value={totals.open} />
        <Stat label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? "var(--status-blocked)" : undefined} />
        <Stat label="SLA breached" value={totals.sla} tone={totals.sla > 0 ? "var(--status-blocked)" : undefined} />
      </div>

      {/* Workload per person */}
      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--theme-muted-text)" }}>Workload</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" data-workload>
          {workload.map((w: Workload) => {
            const active = person === w.user.id
            return (
              <button
                key={w.user.id}
                type="button"
                onClick={() => setPerson(active ? "" : w.user.id)}
                className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left"
                style={{ borderColor: active ? "var(--theme-primary)" : "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}
                data-workload-person={w.user.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium" style={{ color: "var(--theme-card-text)" }}>{nameOf(w.user)}</p>
                  <p className="text-[11px]" style={{ color: "var(--theme-muted-text)" }}>{w.depth === 1 ? "Direct report" : `Indirect (level ${w.depth})`}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 text-xs">
                  <span title="Open" style={{ color: "var(--theme-card-text)" }}><strong className="text-base">{w.open}</strong> open</span>
                  {w.overdue > 0 && <span title="Overdue" className="inline-flex items-center gap-1" style={{ color: "var(--status-blocked)" }}><Clock size={12} />{w.overdue}</span>}
                  {w.sla_breached > 0 && <span title="SLA breached" className="inline-flex items-center gap-1" style={{ color: "var(--status-blocked)" }}><AlertTriangle size={12} />{w.sla_breached}</span>}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select value={person} onChange={(e) => setPerson(e.target.value)} className="h-8 rounded-lg border px-2 text-xs" aria-label="Person"
            style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
            <option value="">Everyone</option>
            {workload.map((w) => <option key={w.user.id} value={w.user.id}>{nameOf(w.user)}</option>)}
          </select>
          <select value={workflowId} onChange={(e) => setWorkflowId(e.target.value)} className="h-8 rounded-lg border px-2 text-xs" aria-label="Workflow"
            style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
            <option value="">Any workflow</option>
            {workflows.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <Chip active={overdue} onClick={() => setOverdue(!overdue)}>Overdue</Chip>
          <Chip active={slaBreached} onClick={() => setSlaBreached(!slaBreached)}>SLA breached</Chip>
          <Chip active={groupByPerson} onClick={() => setGroupByPerson(!groupByPerson)}>Group by person</Chip>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium" style={{ color: "var(--theme-muted-text)" }}>Status:</span>
          {STATUS_OPTIONS.map((o) => <Chip key={o.value} active={status.includes(o.value)} onClick={() => setStatus((s) => s.includes(o.value) ? s.filter((x) => x !== o.value) : [...s, o.value])}>{o.label}</Chip>)}
          <span className="ml-2 text-xs font-medium" style={{ color: "var(--theme-muted-text)" }}>Priority:</span>
          {PRIORITY_OPTIONS.map((o) => <Chip key={o.value} active={priority.includes(o.value)} onClick={() => setPriority((s) => s.includes(o.value) ? s.filter((x) => x !== o.value) : [...s, o.value])}>{o.label}</Chip>)}
        </div>
      </div>

      <Card className="!p-0 overflow-hidden">
        {!data?.tasks.length ? (
          <p className="px-4 py-8 text-center text-sm" style={{ color: "var(--theme-muted-text)" }}>No open tasks match these filters.</p>
        ) : groupByPerson ? (
          <div className="divide-y" style={{ borderColor: "var(--theme-surface-border)" }}>
            {groups.map(({ workload: w, rows }) => (
              <div key={w.user.id} data-team-group={w.user.id}>
                <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2 text-xs font-semibold"
                  style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-muted-text)" }}
                  onClick={() => setCollapsed((c) => ({ ...c, [w.user.id]: !c[w.user.id] }))}>
                  <span className="flex items-center gap-2">{collapsed[w.user.id] ? <ChevronRight size={14} /> : <ChevronDown size={14} />}<Users size={12} />{nameOf(w.user)}</span>
                  <span>{rows.length} task{rows.length === 1 ? "" : "s"}{rows.some((r) => r.is_overdue) ? ` · ${rows.filter((r) => r.is_overdue).length} overdue` : ""}</span>
                </button>
                {!collapsed[w.user.id] && rows.map((t) => (
                  <TaskRow key={t.id} task={t} readOnly={isMobile} reassigning={reassigning === t.id} onReassign={() => setReassigning(reassigning === t.id ? null : t.id)} targets={reassignTargets} onDone={() => { setReassigning(null); void refresh() }} />
                ))}
              </div>
            ))}
          </div>
        ) : (
          data.tasks.map((t) => (
            <TaskRow key={t.id} task={t} showPerson readOnly={isMobile} reassigning={reassigning === t.id} onReassign={() => setReassigning(reassigning === t.id ? null : t.id)} targets={reassignTargets} onDone={() => { setReassigning(null); void refresh() }} />
          ))
        )}
      </Card>
      {data?.truncated && <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>Showing the first 500 tasks — narrow the filters to see the rest.</p>}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)" }}>
      <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>{label}</p>
      <p className="mt-0.5 text-xl font-semibold" style={{ color: tone ?? "var(--theme-card-text)" }}>{value}</p>
    </div>
  )
}

function TaskRow({ task, showPerson, readOnly, reassigning, onReassign, targets, onDone }: {
  task: Row
  showPerson?: boolean
  readOnly: boolean
  reassigning: boolean
  onReassign: () => void
  targets: Array<{ id: string; display_name: string | null; email: string | null }>
  onDone: () => void
}) {
  const [target, setTarget] = useState("")
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const canReassign = !(task.is_workflow_task && task.event_id) || task.allow_reassign

  async function reassign(toSelf: boolean) {
    setBusy(true)
    setMessage(null)
    try {
      const { reassignReportTask } = await import("@/app/actions/task-queue")
      const { getUserId } = await import("@/lib/get-user-id")
      const to = toSelf ? await getUserId() : target
      if (!to) { setMessage("Choose someone"); return }
      const result = await reassignReportTask(task.id, to, comment || null)
      if (!result.success) { setMessage(result.error); return }
      onDone()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t px-4 py-3" style={{ borderColor: "var(--theme-surface-border)" }} data-team-task={task.id}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={`/tasks/${task.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline" style={{ color: "var(--theme-card-text)" }}>
          {task.title}
        </Link>
        <StatusBadge status={task.status} />
        {task.priority && <PriorityBadge priority={task.priority} />}
        {task.sla_breached && (
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ backgroundColor: "var(--status-blocked-bg)", color: "var(--status-blocked)" }}>
            <AlertTriangle size={11} /> SLA
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--theme-muted-text)" }}>
        {showPerson && <span>{nameOf(task.assignee)}</span>}
        {task.workflow_name && <span>{task.workflow_name}</span>}
        {task.due_date && (
          <span style={task.is_overdue ? { color: "var(--status-blocked)", fontWeight: 600 } : undefined}>
            {task.is_overdue ? "Overdue · " : "Due "}{formatRelativeDate(task.due_date)}
          </span>
        )}
        {!readOnly && (
          <span className="ml-auto flex items-center gap-2">
            <Link href={`/tasks/${task.id}`} className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-medium"
              style={{ borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }} data-act-on-behalf>
              <UserCheck size={11} /> Act on behalf
            </Link>
            {canReassign && (
              <button type="button" onClick={onReassign} className="rounded-md border px-2 py-0.5 font-medium"
                style={{ borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>Reassign</button>
            )}
          </span>
        )}
      </div>
      {reassigning && !readOnly && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="h-8 rounded-lg border px-2 text-xs" aria-label="Reassign to"
            style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }}>
            <option value="">Reassign to…</option>
            {targets.filter((p) => p.id !== task.assignee_id).map((p) => <option key={p.id} value={p.id}>{nameOf(p)}</option>)}
          </select>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (optional)" className="h-8 min-w-[12rem] flex-1 rounded-lg border px-2 text-xs"
            style={{ borderColor: "var(--theme-surface-border)", backgroundColor: "var(--theme-card-bg)", color: "var(--theme-card-text)" }} />
          <Button size="sm" disabled={busy || !target} onClick={() => void reassign(false)}>Reassign</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void reassign(true)}>Take it myself</Button>
          {message && <span className="text-xs" style={{ color: "var(--status-blocked)" }}>{message}</span>}
        </div>
      )}
    </div>
  )
}
