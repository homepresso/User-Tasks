"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle, Hand, XCircle } from "lucide-react"
import { Badge, StatusPill } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useSubmitGuard } from "@/hooks/use-submit-guard"
import { usePermissions } from "@/lib/permissions-context"
import { QUEUED_STATUS, type QueueAction } from "@/lib/tasks/unified-list"
import { cn } from "@/lib/utils"

/**
 * Queued tasks in the unified task list (My tasks page, Home): the status
 * pill and the inline Accept / Decline (Claim for a team's unclaimed task)
 * buttons. Hold, redirect, escalate and completing stay on the task page.
 */

/** Query keys refreshed after a response: the task lists, Home, the task page and notifications (nav badges follow). */
const REFRESH_KEYS = [["tasks"], ["home"], ["task-detail"], ["task-tree"], ["notifications"]] as const

/** The list's status pill: Queued (warning, it waits for you) or the task's own status. */
export function TaskStatusPill({ status }: { status: string }) {
  return status === QUEUED_STATUS ? <StatusPill status={status} tone="warning" /> : <StatusPill status={status} />
}

/** "Team" marker for a team's unclaimed task. */
export function TeamTaskBadge({ team }: { team?: string | null }) {
  return <Badge tone="neutral">{team ? `${team} team` : "Team task"}</Badge>
}

export function QueuedTaskActions({ task, action, className, onDone }: {
  task: { id: string; title: string }
  action: QueueAction
  className?: string
  /** After a successful response (e.g. a status message); lists refresh on their own. */
  onDone?: (message: string) => void
}) {
  const { can } = usePermissions()
  const queryClient = useQueryClient()
  const guard = useSubmitGuard()
  const [busy, setBusy] = useState<"accept" | "claim" | "decline" | null>(null)
  const [declineOpen, setDeclineOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  if (!can("tasks.complete")) return null

  function refresh() {
    for (const queryKey of REFRESH_KEYS) void queryClient.invalidateQueries({ queryKey: [...queryKey] })
  }

  async function accept() {
    await guard.run(async () => {
      setBusy(action)
      setError(null)
      try {
        if (action === "claim") {
          const { claimTask } = await import("@/app/actions/home")
          const result = await claimTask(task.id)
          if (!result.ok) throw new Error(result.error)
          onDone?.(`Claimed “${task.title}”.`)
        } else {
          const { respondToTask } = await import("@/app/actions/task-queue")
          const result = await respondToTask(task.id, "accepted")
          if (!result.success) throw new Error(result.error)
          onDone?.(`Accepted “${task.title}”.`)
        }
        refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn’t work")
      }
      setBusy(null)
    })
  }

  async function decline() {
    await guard.run(async () => {
      if (!reason.trim()) return
      setBusy("decline")
      setError(null)
      try {
        const { respondToTask } = await import("@/app/actions/task-queue")
        const result = await respondToTask(task.id, "rejected", reason.trim())
        if (!result.success) throw new Error(result.error)
        setDeclineOpen(false)
        setReason("")
        onDone?.(`Declined “${task.title}”.`)
        refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : "That didn’t work")
      }
      setBusy(null)
    })
  }

  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5", className)} data-queued-actions={action} onClick={(e) => e.stopPropagation()}>
      <Button size="sm" variant="primary" leadingIcon={action === "claim" ? <Hand /> : <CheckCircle />}
        loading={busy === action} disabled={busy !== null} onClick={() => void accept()} data-queue-action={action}>
        {action === "claim" ? "Claim" : "Accept"}
      </Button>
      {action === "accept" && (
        <Button size="sm" variant="ghost" leadingIcon={<XCircle />} disabled={busy !== null}
          onClick={() => { setError(null); setDeclineOpen(true) }} data-queue-action="decline">
          Decline
        </Button>
      )}
      {error && !declineOpen && <span role="alert" className="text-xs text-danger">{error}</span>}

      <Dialog open={declineOpen} onOpenChange={(open) => { if (!open) setDeclineOpen(false) }}>
        <DialogContent size="sm" title="Decline task" description={task.title}>
          <DialogBody className="space-y-2">
            <label htmlFor={`decline-${task.id}`} className="block text-ui text-fg">Let the assigner know why you’re declining this task:</label>
            <Textarea id={`decline-${task.id}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus
              placeholder="e.g. This should go to the finance team…" />
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="sm">Cancel</Button>
            </DialogClose>
            <Button size="sm" variant="danger" loading={busy === "decline"} disabled={!reason.trim() || busy !== null} onClick={() => void decline()}>
              Decline task
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  )
}
