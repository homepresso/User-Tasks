"use client"

import { useState } from "react"
import { useTaskQueue } from "@/hooks/use-task-queue"
import { serverRead } from "@/lib/server-read"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { formatRelativeDate, cn } from "@/lib/utils"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { respondToTask, completeWorkflowTask } from "@/app/actions/task-queue"
import {
  Inbox, Pencil, Clock, Calendar, AlertTriangle, ChevronDown, ChevronUp,
  CheckCircle, PauseCircle, XCircle, Send, Workflow,
  CornerDownRight, ArrowUpRight, ExternalLink,
} from "lucide-react"
import Link from "next/link"
import { SubtaskList } from "@/components/tasks/subtask-list"
import { getTaskCode, getQueueBadge, EffortBadge } from "@/components/tasks/timesheet-helpers"
import { PageSkeleton } from "@/components/ui/page-skeleton"
import { Input } from "@/components/ui/input"
import { InlineTaskWorkPlan } from "@/components/tasks/inline-task-work-plan"
import { taskDescriptionExcerpt } from "@/components/tasks/task-description"

export default function TaskQueuePage() {
  const { data: queueData, isLoading, error } = useTaskQueue()
  const tasks = queueData?.tasks
  const hasMore = Boolean(queueData?.hasMore)

  if (isLoading && !queueData && !error) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: "var(--theme-card-text)" }}>
          Task Queue
        </h1>
        <p className="text-sm mt-0.5" style={{ color: "var(--theme-muted-text)" }}>
          Tasks assigned to you awaiting your response
        </p>
      </div>

      {/* Task list */}
      <div
        className="rounded-xl overflow-hidden border"
        style={{ borderColor: "var(--theme-surface-border)" }}
      >
        {error ? (
          <div className="p-4 text-sm text-red-600" style={{ backgroundColor: "var(--theme-card-bg)" }}>
            Error loading queue: {error.message}
          </div>
        ) : isLoading ? null : !tasks?.length ? (
          <div className="p-12 text-center" style={{ backgroundColor: "var(--theme-card-bg)" }}>
            <Inbox size={40} className="mx-auto mb-3" style={{ color: "var(--theme-surface-border)" }} />
            <p className="text-sm font-medium" style={{ color: "var(--theme-card-text)" }}>All caught up!</p>
            <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>No pending tasks in your queue</p>
          </div>
        ) : (
          <>
            {hasMore ? (
              <div className="px-4 py-2 text-xs" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)", borderBottom: "1px solid var(--theme-surface-border)" }}>
                Showing the first 100 items per category — action some to see the rest.
              </div>
            ) : null}
            <div className="px-4 py-2 text-xs" style={{ color: "var(--theme-muted-text)", backgroundColor: "var(--theme-surface)", borderBottom: "1px solid var(--theme-surface-border)" }}>
              {tasks.length} task{tasks.length !== 1 ? "s" : ""} pending your response
            </div>
            {tasks.map((task: any) => (
              <QueueRow key={task.id} task={task} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

/* ─── Queue Row ─── */

function QueueRow({ task }: { task: any }) {
  const [expanded, setExpanded] = useState(false)
  const [dialogAction, setDialogAction] = useState<"held" | "rejected" | "complete" | "redirect" | "escalate" | null>(null)
  const [redirectTargetMode, setRedirectTargetMode] = useState<"user" | "email">("user")
  const [comment, setComment] = useState("")
  const [outcome, setOutcome] = useState("")
  const [redirectUserId, setRedirectUserId] = useState("")
  const [redirectUserIds, setRedirectUserIds] = useState<string[]>([])
  const [targetEmail, setTargetEmail] = useState("")
  const [targetEmailsText, setTargetEmailsText] = useState("")
  const [users, setUsers] = useState<{ id: string; display_name: string; email: string }[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [responded, setResponded] = useState(false)
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const router = useRouter()
  const isWorkflowTask = task.is_workflow_task && task.event_id
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()
  const isDarkRow = !!isWorkflowTask
  const hasChildren = (task.child_count ?? 0) > 0
  const badge = getQueueBadge(task)
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

  async function handleAccept() {
    setSubmitting(true)
    setActionError(null)
    try {
      await respondToTask(task.id, "accepted")
      setResponded(true)
      queryClient.invalidateQueries({ queryKey: ["task-queue"] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
    } catch (err: any) {
      setActionError(err?.message ?? "Failed to accept task")
    }
    setSubmitting(false)
  }

  async function handleRedirectOrEscalate() {
    if (dialogAction !== "redirect" && dialogAction !== "escalate") return
    setSubmitting(true)
    setActionError(null)
    try {
      const { rerouteTask } = await import("@/app/actions/task-queue")
      const result = await rerouteTask(task.id, dialogAction, {
        targetUserId: dialogAction === "redirect" && redirectAssignmentMode === "many" ? undefined : (redirectTargetMode === "user" ? redirectUserId || undefined : undefined),
        targetUserIds: dialogAction === "redirect" && redirectAssignmentMode === "many" && redirectTargetMode === "user" ? redirectUserIds : undefined,
        targetEmail: dialogAction === "redirect" && redirectAssignmentMode === "single" && redirectTargetMode === "email" ? targetEmail || undefined : undefined,
        targetEmails: dialogAction === "redirect" && redirectAssignmentMode === "many" && redirectTargetMode === "email"
          ? targetEmailsText.split('\n').map(v => v.trim()).filter(Boolean)
          : undefined,
        inviteIfNeeded: dialogAction === "redirect" && redirectTargetMode === "email",
        comment,
      })
      setDialogAction(null)
      if (result.invited) {
        setWaitingMessage(result.message ?? `Invitation sent to ${result.targetEmail}.`)
      } else {
        setResponded(true)
      }
      setRedirectUserId("")
      setRedirectUserIds([])
      setTargetEmail("")
      setTargetEmailsText("")
      setComment("")
      queryClient.invalidateQueries({ queryKey: ["task-queue"] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
      router.refresh()
    } catch (err: any) {
      setActionError(err?.message ?? `Unable to ${dialogAction} task`)
    }
    setSubmitting(false)
  }

  async function handleSubmitAction() {
    if (!dialogAction) return
    setSubmitting(true)
    try {
      if (dialogAction === "complete" && isWorkflowTask) {
        const result = await completeWorkflowTask(task.id, outcome || "completed", comment || undefined)
        if (result.status === "waiting") {
          setWaitingMessage(`Response recorded. Waiting for more responses (${result.responses}/${result.needed}).`)
          setDialogAction(null)
          setSubmitting(false)
          queryClient.invalidateQueries({ queryKey: ["task-queue"] })
          return
        }
        if (result.status === "completed" && (result as any).workflowResumed === false) {
          setWaitingMessage(`Task completed, but the workflow could not resume: ${(result as any).workflowError ?? "unknown error"}. An administrator can resume it from the run history.`)
          setDialogAction(null)
          setSubmitting(false)
          queryClient.invalidateQueries({ queryKey: ["task-queue"] })
          return
        }
      } else if (dialogAction === "held" || dialogAction === "rejected") {
        if (!comment.trim()) return
        await respondToTask(task.id, dialogAction, comment.trim())
      }
      setResponded(true)
      setDialogAction(null)
      setComment("")
      setOutcome("")
      queryClient.invalidateQueries({ queryKey: ["task-queue"] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["notifications"] })
    } catch (err: any) {
      setActionError(err?.message ?? "Action failed")
    }
    setSubmitting(false)
  }

  if (responded) return null

  if (waitingMessage) {
    return (
      <div className="px-4 py-3 text-sm" style={{ borderBottom: "1px solid var(--theme-surface-border)", backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
        <p className="font-medium">{task.title}</p>
        <p className="text-xs mt-1" style={{ color: "var(--theme-muted-text)" }}>{waitingMessage}</p>
      </div>
    )
  }

  return (
    <div style={{ borderBottom: "1px solid var(--theme-surface-border)" }}>
      {/* Main row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-gray-50/50"
        style={{
          backgroundColor: isDarkRow ? "var(--theme-row-highlight-strong)" : "var(--theme-card-bg)",
          borderLeftWidth: 3,
          borderLeftColor: isOverdue ? "#EF4444" : "var(--theme-primary)",
        }}
        onClick={() => setExpanded(!expanded)}
        onDoubleClick={() => router.push(`/tasks/${task.id}`)}
      >
        {/* Icon */}
        <div className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-gray-400">
          {isWorkflowTask ? <Pencil size={14} /> : <Clock size={14} />}
        </div>

        {/* Task info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-gray-900 dark:text-white">
              {getTaskCode(task)}
            </span>
            <span className="text-sm truncate text-gray-700 dark:text-gray-300">
              · {task.title}
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {task.tenant && (
              <span className="text-xs text-gray-500">{task.tenant.name}</span>
            )}
            {task.tenant && task.assigner && (
              <span className="text-xs text-gray-400">·</span>
            )}
            {task.assigner && (
              <span className="text-xs text-gray-500">From {task.assigner.display_name}</span>
            )}
            {hasChildren && (
              <span className="text-[10px] text-gray-400">
                ({task.completed_child_count ?? 0}/{task.child_count} subtasks)
              </span>
            )}
          </div>
        </div>

        {/* Badge */}
        <EffortBadge config={badge} />

        {/* Priority */}
        <PriorityBadge priority={task.priority} />

        {/* Due date */}
        {task.due_date && (
          <span className={cn("text-xs whitespace-nowrap shrink-0", isOverdue ? "text-red-500 font-semibold" : "text-gray-500")}>
            {formatRelativeDate(task.due_date)}
          </span>
        )}

        {/* Chevron */}
        <span style={{ color: "var(--theme-muted-text)" }}>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="px-4 pb-4 pt-2 space-y-3" style={{ backgroundColor: "var(--theme-surface)" }}>
          {/* Meta */}
          <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--theme-muted-text)" }}>
            {task.due_date && (
              <span className={cn("flex items-center gap-1", isOverdue && "text-red-600 font-medium")}>
                <Calendar size={11} />
                {isOverdue && <AlertTriangle size={10} />}
                Due {formatRelativeDate(task.due_date)}
              </span>
            )}
            {task.estimated_effort_assigner && (
              <span className="flex items-center gap-1">
                <Clock size={11} /> Est. {(task.estimated_effort_assigner / 60).toFixed(1)}h
              </span>
            )}
            <span className="text-gray-400">
              {new Date(task.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </span>
            {isWorkflowTask && (
              <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "var(--theme-primary-light)", color: "var(--theme-primary-text)" }}>
                <Workflow size={10} /> Workflow Task
              </span>
            )}
            <Link href={`/tasks/${task.id}`} className="ml-auto flex items-center gap-1 hover:underline" style={{ color: "var(--theme-primary-text)" }}>
              <ExternalLink size={11} /> Open
            </Link>
          </div>

          {task.description && (
            <p className="text-xs line-clamp-3" style={{ color: "var(--theme-card-text)" }}>{taskDescriptionExcerpt(task.description)}</p>
          )}

          <InlineTaskWorkPlan
            task={{
              id: task.id,
              tenant_id: task.tenant?.id ?? task.tenant_id ?? null,
              assignee_id: task.assignee_id ?? null,
              assigner_id: task.assigner_id ?? task.assigner?.id ?? null,
              assignment_mode: task.assignment_mode ?? null,
              estimated_effort_assigner: task.estimated_effort_assigner ?? null,
              estimated_effort_assignee: task.estimated_effort_assignee ?? null,
              actual_effort: task.actual_effort ?? 0,
              estimated_completion: task.estimated_completion ?? null,
              metadata: task.metadata ?? null,
            }}
          />

          {/* Subtasks */}
          {hasChildren && (
            <SubtaskList parentTaskId={task.id} tenantId={task.tenant?.id} />
          )}

          {/* Inline action errors (accept happens outside the dialog) */}
          {actionError && !dialogAction ? (
            <p className="text-xs text-red-600">{actionError}</p>
          ) : null}

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {isWorkflowTask ? (
              <>
                <Button size="sm" className="max-md:h-11" onClick={() => { setDialogAction("complete"); setComment(""); setOutcome("") }} disabled={submitting}>
                  <Send size={14} className="mr-1.5" /> Action Task
                </Button>
                <Button size="sm" variant="outline" className="max-md:h-11" onClick={handleAccept} disabled={submitting}>
                  <CheckCircle size={14} className="mr-1.5" /> Accept
                </Button>
                {canRedirect && (
                  <Button size="sm" variant="outline" className="max-md:h-11" onClick={() => {
                    setDialogAction("redirect")
                    setRedirectTargetMode("user")
                    setComment("")
                    setRedirectUserId("")
                    setRedirectUserIds([])
                    setTargetEmail("")
                    setTargetEmailsText("")
                    setActionError(null)
                    loadUsers()
                  }} disabled={submitting}>
                    <CornerDownRight size={14} className="mr-1.5" /> Redirect
                  </Button>
                )}
                {canEscalate && (
                  <Button size="sm" variant="outline" className="max-md:h-11" onClick={() => {
                    setDialogAction("escalate")
                    setRedirectTargetMode("user")
                    setComment("")
                    setRedirectUserId("")
                    setTargetEmail("")
                    setActionError(null)
                    loadUsers()
                  }} disabled={submitting}>
                    <ArrowUpRight size={14} className="mr-1.5" /> Escalate
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => { setDialogAction("rejected"); setComment("") }} disabled={submitting} className="!text-red-600 hover:!bg-red-50 max-md:h-11">
                  <XCircle size={14} className="mr-1.5" /> Reject
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" className="max-md:h-11" onClick={handleAccept} disabled={submitting}>
                  <CheckCircle size={14} className="mr-1.5" /> Accept
                </Button>
                <Button size="sm" variant="outline" className="max-md:h-11" onClick={() => { setDialogAction("held"); setComment("") }} disabled={submitting}>
                  <PauseCircle size={14} className="mr-1.5" /> Hold
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setDialogAction("rejected"); setComment("") }} disabled={submitting} className="!text-red-600 hover:!bg-red-50 max-md:h-11">
                  <XCircle size={14} className="mr-1.5" /> Reject
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Action dialog */}
      <Dialog.Root open={dialogAction !== null} onOpenChange={(open) => { if (!open) setDialogAction(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-xl p-6 shadow-xl"
            style={{ backgroundColor: "var(--theme-card-bg)" }}
          >
            <Dialog.Title className="text-lg font-semibold mb-1">
              {dialogAction === "complete" ? "Action Task" : dialogAction === "redirect" ? "Redirect Task" : dialogAction === "escalate" ? "Escalate Task" : dialogAction === "held" ? "Hold Task" : "Reject Task"}
            </Dialog.Title>
            <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>{task.title}</p>

            {(dialogAction === "redirect" || dialogAction === "escalate") ? (
              <>
                <div className="mb-3">
                  <label className="text-sm font-medium mb-1 block" style={{ color: "var(--theme-card-text)" }}>
                    {dialogAction === "escalate" ? "Escalate to" : "Redirect to"}
                  </label>
                  {dialogAction === "redirect" && canInviteOnRedirect && (
                    <div className="inline-flex rounded-lg border overflow-hidden mb-2" style={{ borderColor: "var(--theme-surface-border)" }}>
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
                  {redirectTargetMode === "user" || dialogAction === "escalate" ? (
                    redirectAssignmentMode === 'many' && dialogAction === 'redirect' ? (
                      <select
                        multiple
                        value={redirectUserIds}
                        onChange={e => setRedirectUserIds(Array.from(e.target.selectedOptions).map(option => option.value))}
                        className="w-full rounded-lg border px-3 py-2 text-sm min-h-32"
                        style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>
                        {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
                      </select>
                    ) : (
                      <select value={redirectUserId} onChange={e => setRedirectUserId(e.target.value)}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>
                        <option value="">Select a user...</option>
                        {(users ?? []).map(u => <option key={u.id} value={u.id}>{u.display_name} ({u.email})</option>)}
                      </select>
                    )
                  ) : (
                    redirectAssignmentMode === 'many' ? (
                      <textarea
                        value={targetEmailsText}
                        onChange={e => setTargetEmailsText(e.target.value)}
                        rows={4}
                        placeholder={"name1@company.com\nname2@company.com"}
                        className="w-full rounded-lg border px-3 py-2 text-sm"
                        style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
                      />
                    ) : (
                      <Input
                        type="email"
                        value={targetEmail}
                        onChange={e => setTargetEmail(e.target.value)}
                        placeholder="name@company.com"
                      />
                    )
                  )}
                </div>
                <div className="mb-4">
                  <label className="text-sm font-medium mb-1 block" style={{ color: "var(--theme-card-text)" }}>Reason (optional)</label>
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={2}
                    placeholder={dialogAction === "escalate" ? "Reason for escalation..." : "Reason for redirect..."}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }} />
                </div>
                {dialogAction === "redirect" && redirectTargetMode === "email" && canInviteOnRedirect && (
                  <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>
                    If this email is not already in the organisation, we will send an invitation and keep the task in your queue until they join.
                  </p>
                )}
                {dialogAction === "redirect" && redirectAssignmentMode === "many" && redirectRecipientLimitMode === "capped" && redirectRecipientLimit !== null && (
                  <p className="text-xs mb-4" style={{ color: "var(--theme-muted-text)" }}>
                    You can redirect this task to up to {redirectRecipientLimit} people.
                  </p>
                )}
                {actionError && (
                  <p className="text-xs mb-4 text-red-600">{actionError}</p>
                )}
              </>
            ) : dialogAction === "complete" ? (
              <>
                <div className="mb-3">
                  <label className="text-sm font-medium mb-1 block" style={{ color: "var(--theme-card-text)" }}>Outcome</label>
                  {task.available_outcomes && (task.available_outcomes as string[]).length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {(task.available_outcomes as string[]).map((o: string, i: number) => (
                        <button key={i} type="button" onClick={() => setOutcome(o)}
                          className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all"
                          style={{
                            backgroundColor: outcome === o ? "var(--theme-primary)" : "var(--theme-surface)",
                            color: outcome === o ? 'var(--theme-on-primary)' : "var(--theme-card-text)",
                            border: `1.5px solid ${outcome === o ? "var(--theme-primary)" : "var(--theme-surface-border)"}`,
                          }}>
                          {o}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <input value={outcome} onChange={e => setOutcome(e.target.value)} placeholder="e.g. Approved, Rejected, Completed..."
                      autoFocus className="w-full rounded-lg border px-3 py-2 text-sm"
                      style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }} />
                  )}
                </div>
                <div className="mb-4">
                  <label className="text-sm font-medium mb-1 block" style={{ color: "var(--theme-card-text)" }}>Notes (optional)</label>
                  <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3} placeholder="Any additional comments..."
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }} />
                </div>
              </>
            ) : (
              <>
                <p className="text-sm mb-2" style={{ color: "var(--theme-card-text)" }}>
                  {dialogAction === "held" ? "Let the assigner know why you're putting this on hold:" : "Let the assigner know why you're rejecting this task:"}
                </p>
                <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
                  placeholder={dialogAction === "held" ? "e.g. I'm at capacity this week..." : "e.g. This should be assigned to the finance team..."}
                  autoFocus className="w-full rounded-lg border px-3 py-2 text-sm mb-4"
                  style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }} />
              </>
            )}

            <div className="flex justify-end gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" size="sm">Cancel</Button>
              </Dialog.Close>
              <Button size="sm"
                disabled={
                  (dialogAction === "redirect" || dialogAction === "escalate")
                    ? (
                      dialogAction === "escalate"
                        ? (!redirectUserId || submitting)
                        : ((redirectTargetMode === "user"
                          ? (redirectAssignmentMode === 'many' ? redirectUserIds.length === 0 : !redirectUserId)
                          : (redirectAssignmentMode === 'many' ? !targetEmailsText.trim() : !targetEmail.trim())) || submitting)
                    ) :
                  (dialogAction !== "complete" && !comment.trim()) || submitting
                }
                onClick={(dialogAction === "redirect" || dialogAction === "escalate") ? handleRedirectOrEscalate : handleSubmitAction}
                className={dialogAction === "rejected" ? "!bg-red-600 hover:!bg-red-700" : ""}>
                {submitting ? "Submitting..." :
                  dialogAction === "complete" ? "Complete Task" :
                  dialogAction === "redirect" ? (redirectTargetMode === "email" ? (redirectAssignmentMode === 'many' ? "Redirect / invite many" : "Invite and keep task") : (redirectAssignmentMode === 'many' ? "Redirect to many" : "Redirect")) :
                  dialogAction === "escalate" ? "Escalate" :
                  dialogAction === "held" ? "Put on Hold" : "Reject Task"}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
