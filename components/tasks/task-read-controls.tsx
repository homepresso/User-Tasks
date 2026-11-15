"use client"

import { useState } from "react"
import { CheckCheck, Circle, CircleDot } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useTaskReadActions } from "@/hooks/use-task-read-state"

/**
 * Unread tasks' controls (hooks/use-task-read-state): "Mark all as read" on
 * the task lists and "Mark as unread" / "Mark as read" on one task (the
 * row's actions, the task page).
 */

/** "Mark all as read" — shown while the list has unread rows. */
export function MarkAllReadButton({ unreadCount, onDone, className }: {
  unreadCount: number
  /** A status message for the list ("3 tasks marked as read."). */
  onDone?: (message: string) => void
  className?: string
}) {
  const { markAllRead } = useTaskReadActions()
  const [busy, setBusy] = useState(false)
  if (unreadCount <= 0 && !busy) return null
  return (
    <Button type="button" size="sm" variant="ghost" leadingIcon={<CheckCheck />} loading={busy} className={className}
      onClick={async () => {
        setBusy(true)
        const result = await markAllRead()
        setBusy(false)
        if (!result.ok) onDone?.(result.error ?? "Could not mark your tasks as read.")
        else onDone?.(result.marked === 1 ? "1 task marked as read." : `${result.marked} tasks marked as read.`)
      }}
      data-mark-all-read>
      <span className="max-sm:sr-only">Mark all as read</span>
    </Button>
  )
}

/** One task: "Mark as unread" while read, "Mark as read" while unread. */
export function TaskReadToggle({ taskId, unread, onDone, size = "sm", variant = "ghost", className }: {
  taskId: string
  unread: boolean
  onDone?: (state: { unread: boolean; error?: string }) => void
  size?: "sm" | "md"
  variant?: "ghost" | "secondary"
  className?: string
}) {
  const { setUnread } = useTaskReadActions()
  const [busy, setBusy] = useState(false)
  return (
    <Button type="button" size={size} variant={variant} leadingIcon={unread ? <Circle /> : <CircleDot />} loading={busy} className={className}
      onClick={async (e) => {
        e.stopPropagation()
        setBusy(true)
        const result = await setUnread(taskId, !unread)
        setBusy(false)
        onDone?.({ unread: result.unread, error: result.error })
      }}
      data-task-read-toggle={unread ? "read" : "unread"}>
      {unread ? "Mark as read" : "Mark as unread"}
    </Button>
  )
}

/**
 * The task page's toggle: opening the page marked the task read, so it
 * starts as "Mark as unread". A task I don't hold stays read (the server
 * says so); the button then explains instead of flipping.
 */
export function TaskPageReadToggle({ taskId }: { taskId: string }) {
  const [unread, setUnreadState] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <TaskReadToggle taskId={taskId} unread={unread} variant="secondary"
        onDone={(state) => {
          setUnreadState(state.unread)
          setNote(state.error ?? (!state.unread && !unread ? "Only tasks assigned to you can be unread." : null))
        }} />
      {note && <span role="status" className="text-xs text-fg-muted">{note}</span>}
    </span>
  )
}
