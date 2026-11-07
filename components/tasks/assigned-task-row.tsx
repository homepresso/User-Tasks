"use client"

import { useId, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ChevronDown, Clock, Clock3, ExternalLink, ListOrdered, Pencil, UserCheck, Workflow } from "lucide-react"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { Badge, StatusPill, statusLabel, type Tone } from "@/components/ui/badge"
import { OrgBadge } from "@/components/ui/org-badge"
import { Tooltip } from "@/components/ui/tooltip"
import { TD, TR } from "@/components/ui/table"
import { RelativeTime } from "@/components/activity/relative-time"
import { formatDay } from "@/lib/format/date"
import { cn } from "@/lib/utils"
import { TaskDue, taskRowProgress } from "@/components/tasks/task-list-row-summary"
import { TaskProgressStrip } from "@/components/tasks/task-progress-strip"
import { getTaskCode } from "@/components/tasks/timesheet-helpers"
import { TaskFollowButton } from "@/components/tasks/task-follow-button"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { ProcessViewIconLink, TaskQuickActions, TaskQuickActionsToggle } from "@/components/tasks/task-quick-actions"
import { useIsMobile } from "@/hooks/use-mobile"
import { MobileTaskCard } from "@/components/tasks/mobile-task-card"

interface AssignedTaskRowProps {
  task: {
    id: string
    title: string
    status: string
    priority: string
    due_date: string | null
    progress_pct: number
    subtask_count: number
    completed_subtask_count: number
    created_at?: string | null
    updated_at?: string | null
    workflow_run_id?: string | null
    tenant: { id: string; name: string; slug: string; branding: any } | null
    assignee: {
      id: string
      display_name: string
      avatar_url: string | null
      email?: string | null
    } | null
    assigner?: {
      id: string
      display_name: string | null
      email: string | null
    } | null
    assigned_team?: {
      id: string
      name: string
    } | null
    workflow_source?: {
      id: string
      display_name: string
    } | null
    estimated_completion?: string | null
    acceptance_status?: string | null
    assignee_rank?: {
      position: number
      total: number
    } | null
    acceptance_summary?: {
      pending: number
      accepted: number
      held: number
      rejected: number
    } | null
    /** Following tab: listed because I follow its workflow run. */
    followed_via_run?: { run_id: string; workflow_name: string; run_status?: string | null } | null
    collaborators?: {
      id: string
      acceptance_status: string
      user?: { display_name?: string | null; email?: string | null } | null
    }[]
  }
  /** Do I follow this task (Following tab)? undefined while the page's follow state loads. */
  following?: boolean
}

/** Columns of the Task tracker table (AssignedTaskRow renders its rows). */
export const ASSIGNED_TASK_COLUMNS = 10

const acceptanceTone: Record<string, { label: string; tone: Tone }> = {
  accepted: { label: "Accepted", tone: "success" },
  pending: { label: "Pending", tone: "warning" },
  held: { label: "Held", tone: "warning" },
  rejected: { label: "Rejected", tone: "danger" },
}

/**
 * One tracked task: a table row; opening it shows the shared task detail
 * panel (status, progress, effort, subtasks, latest activity, links —
 * components/tasks/task-detail-panel.tsx) and, for team / collaborative
 * tasks, who has accepted. The Actions toggle opens the quick actions.
 */
export function AssignedTaskRow({ task, following }: AssignedTaskRowProps) {
  const [expanded, setExpanded] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const mobile = useIsMobile()
  const router = useRouter()
  const baseId = useId()
  const panelId = `${baseId}-panel`
  const actionsId = `${baseId}-actions`
  const toggleRef = useRef<HTMLButtonElement>(null)

  const sourceLabel = task.workflow_source?.display_name
    ? `Workflow: ${task.workflow_source.display_name}`
    : task.assigned_team?.name
      ? `Team: ${task.assigned_team.name}`
      : null
  const assignerLabel = task.assigner?.display_name || task.assigner?.email || null
  const acceptance = task.acceptance_status ? acceptanceTone[task.acceptance_status] : null
  const isDone = task.status === "completed" || task.status === "cancelled"
  const progress = taskRowProgress(task)
  const secondary = [
    progress.hasChildren ? `${progress.completed}/${progress.total} subtasks` : null,
    sourceLabel,
    assignerLabel ? `Assigned by ${assignerLabel}` : null,
  ].filter(Boolean)
  const toggle = () => setExpanded((v) => !v)
  const close = () => { setExpanded(false); toggleRef.current?.focus() }
  const assigneeLabel = task.assignee?.display_name ?? (task.assigned_team ? `${task.assigned_team.name} team` : "Unassigned")

  if (mobile) {
    // Phones: one card per task (the table header is hidden); tapping opens the task.
    return (
      <>
        <MobileTaskCard as="tr" colSpan={ASSIGNED_TASK_COLUMNS} href={`/tasks/${task.id}`} title={task.title} done={isDone}
          code={getTaskCode(task)} meta={[assigneeLabel, ...secondary].join(" · ")}
          leading={<TaskFollowButton taskId={task.id} following={following} />}
          actions={(
            <>
              {task.workflow_run_id && <ProcessViewIconLink runId={task.workflow_run_id} title={task.title} />}
              <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
            </>
          )}
          status={<StatusPill status={task.status} />}
          priority={<PriorityBadge priority={task.priority} />}
          progress={progress.pct > 0 ? <TaskProgressStrip value={progress.pct} /> : undefined}
          due={<TaskDue task={task} />}
          footer={(task.followed_via_run || acceptance || task.assignee_rank) ? (
            <>
              {task.followed_via_run && (
                <Badge tone="info" data-followed-via-run={task.followed_via_run.run_id}>
                  <Workflow className="mr-1 inline size-3 align-[-2px]" aria-hidden />Via {task.followed_via_run.workflow_name}
                </Badge>
              )}
              {acceptance && <Badge tone={acceptance.tone}>{acceptance.label}</Badge>}
              {task.assignee_rank && (
                <Badge tone="brand"><ListOrdered className="mr-1 inline size-3 align-[-2px]" aria-hidden /><span className="num">{task.assignee_rank.position}/{task.assignee_rank.total}</span></Badge>
              )}
            </>
          ) : undefined}
          data-assigned-task={task.id}
        />
        <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile taskId={task.id} title={task.title} />
      </>
    )
  }

  return (
    <>
      <TR className={cn("cursor-pointer", expanded && "border-b-0 bg-subtle")} onClick={toggle} onDoubleClick={() => router.push(`/tasks/${task.id}`)} data-assigned-task={task.id}>
        <TD className="w-8 px-0">
          <TaskFollowButton taskId={task.id} following={following} />
        </TD>
        <TD className="max-w-0 py-2">
          <button
            ref={toggleRef}
            type="button"
            aria-expanded={expanded}
            aria-controls={expanded ? panelId : undefined}
            onClick={(e) => { e.stopPropagation(); toggle() }}
            className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left"
            data-task-toggle
          >
            <ChevronDown className={cn("size-3.5 shrink-0 text-fg-subtle transition-transform duration-[var(--ds-dur-fast)] motion-reduce:transition-none", !expanded && "-rotate-90")} aria-hidden />
            <span className="shrink-0 text-fg-subtle" aria-hidden>
              {task.workflow_source ? <Pencil className="size-3.5" /> : <Clock className="size-3.5" />}
            </span>
            <span className={cn("shrink-0 font-mono text-xs text-fg-muted", isDone && "line-through")}>{getTaskCode(task)}</span>
            <span className={cn("truncate font-medium text-fg", isDone && "text-fg-muted line-through")}>{task.title}</span>
            {task.tenant && (
              <OrgBadge name={task.tenant.name} slug={task.tenant.slug} color={task.tenant.branding?.primary_color} size="sm" />
            )}
          </button>
          {(secondary.length > 0 || acceptance || task.assignee_rank || task.estimated_completion || task.followed_via_run) && (
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 pl-[22px] text-xs text-fg-muted">
              {task.followed_via_run && (
                <Badge tone="info" data-followed-via-run={task.followed_via_run.run_id}>
                  <Workflow className="mr-1 inline size-3 align-[-2px]" aria-hidden />Via {task.followed_via_run.workflow_name} · <span className="font-mono">{task.followed_via_run.run_id.slice(0, 8)}</span>
                </Badge>
              )}
              {secondary.length > 0 && <span className="truncate">{secondary.join(" · ")}</span>}
              {acceptance && <Badge tone={acceptance.tone}>{acceptance.label}</Badge>}
              {task.assignee_rank && (
                <Badge tone="brand"><ListOrdered className="mr-1 inline size-3 align-[-2px]" aria-hidden /><span className="num">{task.assignee_rank.position}/{task.assignee_rank.total}</span></Badge>
              )}
              {task.estimated_completion && (
                <Badge><Clock3 className="mr-1 inline size-3 align-[-2px]" aria-hidden />ETA {formatDay(task.estimated_completion)}</Badge>
              )}
            </div>
          )}
        </TD>
        <TD className="max-w-0 truncate text-fg-muted">{assigneeLabel}</TD>
        <TD><StatusPill status={task.status} /></TD>
        <TD><PriorityBadge priority={task.priority} /></TD>
        <TD className="w-28"><TaskProgressStrip value={progress.pct} /></TD>
        <TD numeric><TaskDue task={task} /></TD>
        <TD numeric className="text-xs text-fg-muted">{task.updated_at ? <RelativeTime at={task.updated_at} /> : "—"}</TD>
        <TD className="px-1" onClick={(e) => e.stopPropagation()}>
          <span className="flex items-center justify-end gap-0.5">
            {task.workflow_run_id && <ProcessViewIconLink runId={task.workflow_run_id} title={task.title} />}
            <Tooltip content="Open task">
              <Link href={`/tasks/${task.id}`} aria-label={`Open ${task.title}`}
                className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-muted hover:text-fg">
                <ExternalLink className="size-3.5" aria-hidden />
              </Link>
            </Tooltip>
          </span>
        </TD>
        <TD className="px-1" onClick={(e) => e.stopPropagation()}>
          <TaskQuickActionsToggle open={actionsOpen} onToggle={() => setActionsOpen((v) => !v)} controls={actionsId} title={task.title} />
        </TD>
      </TR>

      {expanded && (
        <tr className="border-b border-border-subtle bg-subtle last:border-b-0" data-assigned-task-panel={task.id}>
          <td colSpan={ASSIGNED_TASK_COLUMNS} className="space-y-3 px-4 pb-4 pt-1 pl-12">
            <TaskDetailPanel id={panelId} taskId={task.id} title={task.title} onClose={close} />
            <QueueSummary task={task} />
          </td>
        </tr>
      )}
      {mobile ? (
        <TaskQuickActions id={actionsId} open={actionsOpen} onOpenChange={setActionsOpen} mobile taskId={task.id} title={task.title} />
      ) : actionsOpen && (
        <tr className="border-b border-border-subtle" data-task-actions-row>
          <td colSpan={ASSIGNED_TASK_COLUMNS} className="p-0">
            <TaskQuickActions id={actionsId} open onOpenChange={setActionsOpen} mobile={false} taskId={task.id} title={task.title} />
          </td>
        </tr>
      )}
    </>
  )
}

/** Team / collaborative tasks: list order and who has accepted (the tracker's own facts). */
function QueueSummary({ task }: { task: AssignedTaskRowProps["task"] }) {
  const collaborators = task.collaborators ?? []
  if (!task.acceptance_summary && !collaborators.length && !task.assignee_rank) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" data-assigned-task-queue>
      {task.assignee_rank && <span>Assignee list order: <span className="num font-medium text-fg">{task.assignee_rank.position}/{task.assignee_rank.total}</span></span>}
      {task.acceptance_summary && (
        <span>Team acceptance: <span className="font-medium text-fg">{task.acceptance_summary.accepted} accepted, {task.acceptance_summary.pending} pending</span></span>
      )}
      {collaborators.map((c) => (
        <span key={c.id} className="inline-flex items-center gap-1">
          <UserCheck className="size-3.5" aria-hidden />
          <span className="font-medium text-fg">{c.user?.display_name ?? c.user?.email ?? "User"}</span> {statusLabel(c.acceptance_status)}
        </span>
      ))}
    </div>
  )
}
