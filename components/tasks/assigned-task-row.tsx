"use client"

import { useState } from "react"
import Link from "next/link"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { formatRelativeDate, cn } from "@/lib/utils"
import { CheckCircle2, Circle, AlertCircle, Clock3, ListOrdered, UserCheck } from "lucide-react"
import { InlineTaskWorkPlan } from "@/components/tasks/inline-task-work-plan"
import { TaskListRowSummary } from "@/components/tasks/task-list-row-summary"
import { TaskDescription } from "@/components/tasks/task-description"

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
    description?: string | null
    tenant_id?: string
    assigner_id?: string | null
    assignee_id?: string | null
    assignment_mode?: string | null
    estimated_effort_assigner?: number | null
    estimated_effort_assignee?: number | null
    actual_effort?: number | null
    estimated_completion?: string | null
    metadata?: Record<string, any> | null
    acceptance_status?: string | null
    recent_activity?: {
      id: string
      event_type: string
      created_at: string
      actor?: { display_name?: string | null } | null
    }[]
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
    collaborators?: {
      id: string
      acceptance_status: string
      user?: { display_name?: string | null; email?: string | null } | null
    }[]
    subtasks: {
      id: string
      title: string
      status: string
      priority: string
      due_date: string | null
    }[]
  }
}

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  completed: { label: "Done", icon: CheckCircle2, className: "text-[color:var(--theme-card-text)]" },
  in_progress: { label: "In Progress", icon: Circle, className: "text-[color:var(--status-info)]" },
  blocked: { label: "Blocked", icon: AlertCircle, className: "text-[color:var(--status-blocked)]" },
  todo: { label: "To Do", icon: Circle, className: "text-[color:var(--status-todo)]" },
  cancelled: { label: "Cancelled", icon: Circle, className: "text-[color:var(--status-todo)] line-through" },
}

const acceptanceConfig: Record<string, { label: string; className: string }> = {
  accepted: { label: "Accepted", className: "text-[color:var(--status-done)] bg-[color:var(--status-done-bg)] border-[color:var(--theme-surface-border)]" },
  pending: { label: "Pending", className: "text-[color:var(--status-progress)] bg-[color:var(--status-progress-bg)] border-[color:var(--theme-surface-border)]" },
  held: { label: "Held", className: "text-[color:var(--status-progress)] bg-[color:var(--status-progress-bg)] border-[color:var(--theme-surface-border)]" },
  rejected: { label: "Rejected", className: "text-[color:var(--status-blocked)] bg-[color:var(--status-blocked-bg)] border-[color:var(--theme-surface-border)]" },
}

function formatEta(value: string | null | undefined) {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return `ETA ${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export function AssignedTaskRow({ task }: AssignedTaskRowProps) {
  const [expanded, setExpanded] = useState(false)

  const isOverdue =
    task.due_date &&
    new Date(task.due_date) < new Date() &&
    task.status !== "completed"
  const sourceLabel = task.workflow_source?.display_name
    ? `Workflow: ${task.workflow_source.display_name}`
    : task.assigned_team?.name
      ? `Team: ${task.assigned_team.name}`
      : null
  const assignerLabel = task.assigner?.display_name || task.assigner?.email || null
  const acceptance = task.acceptance_status ? acceptanceConfig[task.acceptance_status] : null
  const latestActivity = task.recent_activity?.[0] ?? null
  const etaLabel = formatEta(task.estimated_completion)

  return (
    <div className="border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
      <TaskListRowSummary
        task={task}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onOpen={() => {}}
        topMeta={
          <>
            {sourceLabel && <span>{sourceLabel}</span>}
            {assignerLabel && <span>Assigned by {assignerLabel}</span>}
          </>
        }
        bottomBadges={
          <>
            {acceptance && (
              <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", acceptance.className)}>
                {acceptance.label}
              </span>
            )}
            {task.assignee_rank && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{
                  borderColor: 'color-mix(in srgb, var(--theme-primary) 28%, var(--theme-surface-border))',
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, var(--theme-card-bg))',
                  color: 'color-mix(in srgb, var(--theme-primary-text) 90%, var(--theme-card-text))',
                }}
              >
                <ListOrdered size={10} />
                {task.assignee_rank.position}/{task.assignee_rank.total}
              </span>
            )}
            {etaLabel && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium"
                style={{
                  borderColor: 'color-mix(in srgb, var(--theme-primary) 36%, var(--theme-surface-border))',
                  backgroundColor: 'color-mix(in srgb, var(--theme-primary) 16%, var(--theme-card-bg))',
                  color: 'color-mix(in srgb, var(--theme-primary-text) 96%, var(--theme-card-text))',
                }}
              >
                <Clock3 size={10} />
                {etaLabel}
              </span>
            )}
          </>
        }
        rightMeta={
          task.assignee_rank ? (
            <span
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
              style={{
                borderColor: 'color-mix(in srgb, var(--theme-primary) 34%, var(--theme-surface-border))',
                backgroundColor: 'color-mix(in srgb, var(--theme-primary) 14%, var(--theme-card-bg))',
                color: 'color-mix(in srgb, var(--theme-primary-text) 94%, var(--theme-card-text))',
              }}
            >
              <ListOrdered size={10} />
              {task.assignee_rank.position}/{task.assignee_rank.total}
            </span>
          ) : null
        }
      />

      {expanded && (
        <div style={{ backgroundColor: 'var(--theme-surface)', borderTop: '1px solid var(--theme-surface-border)' }}>
          <div className="px-4 py-3 pl-14 space-y-3">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <p className="text-[11px] font-semibold text-gray-500">Queue / Acceptance</p>
                <div className="mt-1 space-y-1 text-xs text-gray-500">
                  <p>Current status: <span className="font-medium text-gray-700 dark:text-gray-300">{task.acceptance_status ?? "—"}</span></p>
                  {task.assignee_rank && (
                    <p>Assignee list order: <span className="font-medium text-gray-700 dark:text-gray-300">{task.assignee_rank.position}/{task.assignee_rank.total}</span></p>
                  )}
                  {task.acceptance_summary && (
                    <p>
                      Team acceptance:
                      <span className="ml-1 font-medium text-gray-700 dark:text-gray-300">
                        {task.acceptance_summary.accepted} accepted, {task.acceptance_summary.pending} pending
                      </span>
                    </p>
                  )}
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-500">Details</p>
                <div className="mt-1 space-y-1 text-xs text-gray-500">
                  <p>Priority: <span className="font-medium text-gray-700 dark:text-gray-300">{task.priority}</span></p>
                  <p>Status: <span className="font-medium text-gray-700 dark:text-gray-300">{task.status}</span></p>
                  <p>Assignee: <span className="font-medium text-gray-700 dark:text-gray-300">{task.assignee?.display_name ?? "Unassigned"}</span></p>
                  <p>ETA: <span className="font-medium text-gray-700 dark:text-gray-300">{task.estimated_completion ? new Date(task.estimated_completion).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : "—"}</span></p>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-semibold text-gray-500">Last Activity</p>
                <div className="mt-1 space-y-1 text-xs text-gray-500">
                  {latestActivity ? (
                    <>
                      <p className="font-medium text-gray-700 dark:text-gray-300">{latestActivity.event_type.replace(/_/g, " ")}</p>
                      <p>{latestActivity.actor?.display_name ?? "System"} • {formatRelativeDate(latestActivity.created_at)}</p>
                    </>
                  ) : (
                    <p>No activity yet</p>
                  )}
                </div>
              </div>
            </div>

            {task.description && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500">Task Details</p>
                <TaskDescription value={task.description} className="mt-1 text-sm text-gray-600 dark:text-gray-300" />
              </div>
            )}

            <InlineTaskWorkPlan
              task={{
                id: task.id,
                tenant_id: task.tenant_id ?? task.tenant?.id ?? null,
                assignee_id: task.assignee_id ?? task.assignee?.id ?? null,
                assigner_id: task.assigner_id ?? task.assigner?.id ?? null,
                assignment_mode: task.assignment_mode ?? null,
                estimated_effort_assigner: task.estimated_effort_assigner ?? null,
                estimated_effort_assignee: task.estimated_effort_assignee ?? null,
                actual_effort: task.actual_effort ?? 0,
                estimated_completion: task.estimated_completion ?? null,
                metadata: task.metadata ?? null,
              }}
            />

            {task.recent_activity && task.recent_activity.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Recent Activity</p>
                <div className="space-y-1.5">
                  {task.recent_activity.slice(0, 4).map((event) => (
                    <div key={event.id} className="flex items-center gap-2 text-xs text-gray-500">
                      <Clock3 size={12} className="shrink-0" />
                      <span className="font-medium text-gray-700 dark:text-gray-300">{event.event_type.replace(/_/g, " ")}</span>
                      <span>{event.actor?.display_name ?? "System"}</span>
                      <span>{formatRelativeDate(event.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {task.collaborators && task.collaborators.length > 0 && (
              <div>
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Collaborators</p>
                <div className="space-y-1.5">
                  {task.collaborators.map((collaborator) => (
                    <div key={collaborator.id} className="flex items-center gap-2 text-xs text-gray-500">
                      <UserCheck size={12} className="shrink-0" />
                      <span className="font-medium text-gray-700 dark:text-gray-300">
                        {collaborator.user?.display_name ?? collaborator.user?.email ?? "User"}
                      </span>
                      <span>{collaborator.acceptance_status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {task.subtasks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-gray-500 mb-1.5">Subtasks</p>
                <div className="space-y-1">
                  {task.subtasks.map((sub) => {
                    const cfg = statusConfig[sub.status] ?? statusConfig.todo
                    const Icon = cfg.icon
                    const subOverdue = sub.due_date &&
                      new Date(sub.due_date) < new Date() &&
                      sub.status !== "completed"

                    return (
                      <Link
                        key={sub.id}
                        href={`/tasks/${sub.id}`}
                        className="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-gray-100/60 dark:hover:bg-gray-800/40 transition-colors"
                      >
                        <Icon size={14} className={cfg.className} />
                        <span
                          className={cn(
                            "flex-1 text-sm truncate",
                            sub.status === "completed"
                              ? "line-through text-gray-400"
                              : "text-gray-700 dark:text-gray-300"
                          )}
                        >
                          {sub.title}
                        </span>
                        <PriorityBadge priority={sub.priority} />
                        {sub.due_date && (
                          <span className={cn(
                            "text-xs whitespace-nowrap",
                            subOverdue ? "text-red-600 font-medium" : "text-gray-400"
                          )}>
                            {formatRelativeDate(sub.due_date)}
                          </span>
                        )}
                      </Link>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
