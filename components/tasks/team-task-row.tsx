"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ChevronDown, Clock, ExternalLink, UserCheck } from "lucide-react"
import type { serverQuery } from "@/lib/server-read"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Badge, StatusPill } from "@/components/ui/badge"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Tooltip } from "@/components/ui/tooltip"
import { TD, TR, TableDetailCell, Truncate, tdClass } from "@/components/ui/table"
import { ProgressBar } from "@/components/ui/progress-bar"
import { RelativeTime } from "@/components/activity/relative-time"
import { useIsMobile } from "@/hooks/use-mobile"
import { MobileTaskCard } from "@/components/tasks/mobile-task-card"
import { cn } from "@/lib/utils"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { rowProgress } from "@/lib/tasks/list-sort"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { ProcessViewIconLink, TaskQuickActions, TaskQuickActionsToggle } from "@/components/tasks/task-quick-actions"
import { TimelineIconButton } from "@/components/timeline/timeline-sheet"
import { AssignTaskDialog } from "@/components/tasks/assign-task"

/**
 * One task of a report (My team, and the reporting-line view on My team and
 * the Task tracker's Team members tab): a table row that opens the shared
 * task detail panel, with Process view, Open, the quick actions, Act on
 * behalf and Reassign (hidden on phones).
 */

export type TeamTaskRowData = Awaited<ReturnType<typeof serverQuery<'tasks.reports'>>>['tasks'][number]

/** Columns of the team task table (TeamTaskRow). */
export const TEAM_TASK_COLUMNS = 9

export function teamPersonName(p: { display_name: string | null; email: string | null } | null | undefined) {
  return p?.display_name || p?.email || "Unknown"
}

export function TeamTaskRow({ task, readOnly, reassigning, onReassign, targets, onDone }: {
  task: TeamTaskRowData
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
  const [expanded, setExpanded] = useState(false)
  const [picking, setPicking] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const mobile = useIsMobile()
  const baseId = useId()
  const panelId = `${baseId}-panel`
  const actionsId = `${baseId}-actions`
  const toggleRef = useRef<HTMLButtonElement>(null)
  const closed = task.status === "completed" || task.status === "cancelled"
  // A manager can always reassign a report's task; the step's redirect setting is the assignee's own option.
  const canReassign = !closed
  const progress = rowProgress(task)

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

  const secondary = [task.workflow_name, task.child_count ? `${task.completed_child_count}/${task.child_count} subtasks` : null].filter(Boolean)
  const toggle = () => setExpanded((v) => !v)

  if (mobile) {
    // Phones: one card per task (read-only there: no Act on behalf / Reassign); tapping opens the task.
    return (
      <>
        <MobileTaskCard as="tr" colSpan={TEAM_TASK_COLUMNS} href={`/tasks/${task.id}`} title={task.title} done={closed}
          meta={[teamPersonName(task.assignee), ...secondary].join(" · ")}
          actions={(
            <>
              {task.workflow_run_id && <ProcessViewIconLink runId={task.workflow_run_id} title={task.title} />}
            {task.workflow_run_id && <TimelineIconButton target={{ taskId: task.id }} title={task.title} />}
              <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
            </>
          )}
          status={<StatusPill status={task.status} />}
          priority={task.priority ? <PriorityBadge priority={task.priority} /> : undefined}
          progress={progress > 0 ? (
            <span className="flex items-center gap-1.5">
              <ProgressBar value={progress} className="w-10 shrink-0" label={`${progress}% complete`} />
              <span className="num text-fg-muted">{progress}%</span>
            </span>
          ) : undefined}
          due={task.due_date ? (
            <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", task.is_overdue ? "text-danger" : "text-fg-muted")}>
              {task.is_overdue && <Clock className="size-3.5" aria-hidden />}
              {task.is_overdue && <span className="sr-only">Overdue: </span>}
              {formatRelative(task.due_date)}
            </span>
          ) : undefined}
          footer={task.sla_breached ? <Badge tone="danger"><AlertTriangle className="size-3" aria-hidden /> SLA</Badge> : undefined}
          data-team-task={task.id}
        />
        <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile taskId={task.id} title={task.title} />
      </>
    )
  }

  return (
    <>
      <TR className={cn("cursor-pointer", expanded && "border-b-0 bg-subtle")} onClick={toggle} data-team-task={task.id}>
        <TD className="max-w-0 py-2">
          <button ref={toggleRef} type="button" aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
            onClick={(e) => { e.stopPropagation(); toggle() }} className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left" data-task-toggle>
            <ChevronDown className={cn("size-3.5 shrink-0 text-fg-subtle transition-transform duration-[var(--ds-dur-fast)] motion-reduce:transition-none", !expanded && "-rotate-90")} aria-hidden />
            <span className={cn("truncate font-medium text-fg", closed && "text-fg-muted line-through")} title={task.title}>{task.title}</span>
            {task.sla_breached && <Badge tone="danger"><AlertTriangle className="size-3" aria-hidden /> SLA</Badge>}
          </button>
          {secondary.length > 0 && <p className="mt-0.5 truncate pl-[22px] text-xs text-fg-muted" title={secondary.join(" · ")}>{secondary.join(" · ")}</p>}
        </TD>
        <TD className="max-w-0 text-fg-muted"><Truncate text={teamPersonName(task.assignee)} /></TD>
        <TD className="whitespace-nowrap"><StatusPill status={task.status} /></TD>
        <TD className="whitespace-nowrap">{task.priority ? <PriorityBadge priority={task.priority} /> : <span className="text-fg-subtle">—</span>}</TD>
        <TD>
          <span className="flex items-center gap-2">
            <ProgressBar value={progress} className="w-12 shrink-0" label={`${progress}% complete`} />
            <span className="num text-xs text-fg-muted">{progress}%</span>
          </span>
        </TD>
        <TD numeric className={task.is_overdue ? "text-danger" : "text-fg-muted"}>
          {task.due_date ? (
            <Tooltip content={formatAbsolute(task.due_date)}>
              <span className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                {task.is_overdue && <Clock className="size-3.5" aria-hidden />}
                {task.is_overdue && <span className="sr-only">Overdue: </span>}
                {formatRelative(task.due_date)}
              </span>
            </Tooltip>
          ) : "—"}
        </TD>
        <TD numeric className="text-xs text-fg-muted">{task.updated_at ? <RelativeTime at={task.updated_at} /> : "—"}</TD>
        <td className={cn(tdClass, "w-px whitespace-nowrap px-1 text-right")} onClick={(e) => e.stopPropagation()}>
          <span className="inline-flex items-center gap-0.5">
            {task.workflow_run_id && <ProcessViewIconLink runId={task.workflow_run_id} title={task.title} />}
            {task.workflow_run_id && <TimelineIconButton target={{ taskId: task.id }} title={task.title} />}
            <Tooltip content="Open task">
              <Link href={`/tasks/${task.id}`} aria-label={`Open ${task.title}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg">
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </Tooltip>
          </span>
        </td>
        <td className={cn(tdClass, "w-px whitespace-nowrap text-right")} onClick={(e) => e.stopPropagation()}>
          <span className="inline-flex flex-nowrap items-center gap-1">
            <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
            {!readOnly && !closed && (
              <Button asChild size="sm" variant="ghost">
                <Link href={`/tasks/${task.id}`} data-act-on-behalf><UserCheck aria-hidden /> Act on behalf</Link>
              </Button>
            )}
            {!readOnly && canReassign && (
              <Button size="sm" variant="ghost" aria-expanded={reassigning} onClick={onReassign}>Reassign</Button>
            )}
          </span>
        </td>
      </TR>
      {expanded && (
        <tr className="border-b border-border-subtle bg-subtle last:border-b-0" data-team-task-panel={task.id}>
          <TableDetailCell colSpan={TEAM_TASK_COLUMNS} className="px-4 pb-4 pt-1 pl-9">
            <TaskDetailPanel id={panelId} taskId={task.id} title={task.title} onClose={() => { setExpanded(false); toggleRef.current?.focus() }} />
          </TableDetailCell>
        </tr>
      )}
      {mobile ? (
        <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile taskId={task.id} title={task.title} />
      ) : actionsOpen && (
        <tr className="border-b border-border-subtle" data-task-actions-row>
          <TableDetailCell colSpan={TEAM_TASK_COLUMNS}>
            <TaskQuickActions id={actionsId} open onOpenChange={setActionsOpen} mobile={false} taskId={task.id} title={task.title} />
          </TableDetailCell>
        </tr>
      )}
      {reassigning && !readOnly && (
        <tr className="border-b border-border-subtle bg-subtle last:border-b-0">
          <TableDetailCell colSpan={TEAM_TASK_COLUMNS} className="px-[var(--theme-density-cell-x)] py-2">
            <div className="flex flex-wrap items-center gap-2">
              {/* Anyone in the workspace (or a team): the same picker as the Active tasks tab; the server checks manager / admin rights. */}
              <Button size="sm" disabled={busy} onClick={() => setPicking(true)}>Reassign to…</Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reassign(true)}>Take it myself</Button>
              {message && <span role="alert" className="text-xs text-danger">{message}</span>}
            </div>
          </TableDetailCell>
        </tr>
      )}
      {picking && <AssignTaskDialog taskIds={[task.id]} open={picking} onOpenChange={setPicking} title={task.title} currentAssignee={teamPersonName(task.assignee)} onDone={() => { setPicking(false); onDone() }} />}
    </>
  )
}
