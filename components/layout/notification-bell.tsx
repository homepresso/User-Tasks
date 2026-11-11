"use client"

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import {
  AlarmClock, Bell, BellOff, CheckCheck, CheckCircle2, ClipboardList, Mail, MailOpen, MessageSquareWarning, Package, Sparkles, Square, CheckSquare, Trash2, TriangleAlert,
  TrendingUp, UsersRound, type LucideIcon,
} from "lucide-react"
import { useNotifications } from "@/hooks/use-notifications"
import { deleteNotifications, markAllNotificationsRead, setNotificationsRead } from "@/app/actions/notifications"
import { useQueryClient } from "@tanstack/react-query"
import { cn } from "@/lib/utils"
import { formatAbsolute, formatRelative, toDate } from "@/lib/format/date"
import { plural } from "@/lib/format/plural"
import { useRouter } from "next/navigation"
import { InlineNotice } from "@/components/ui/inline-notice"
import { IconButton } from "@/components/ui/icon-button"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { Tooltip } from "@/components/ui/tooltip"
import { floatingSurfaceClass } from "@/components/ui/dropdown-menu"
import { OPEN_JOBS_PANEL_EVENT } from "@/components/jobs/jobs-provider"
import { AGENT_OPEN_EVENT } from "@/lib/assistants/history"

/** The fields of a notification row this panel reads. */
interface Note { id: string; type: string; title: string; body?: string | null; is_read: boolean; created_at: string; task_id?: string | null; job_id?: string | null }

const TYPE_ICONS: Record<string, { icon: LucideIcon; className: string }> = {
  task_assigned: { icon: ClipboardList, className: "text-fg-muted" },
  task_completed: { icon: CheckCircle2, className: "text-success" },
  task_due_soon: { icon: AlarmClock, className: "text-warning" },
  task_escalated: { icon: TrendingUp, className: "text-danger" },
  team_invite: { icon: UsersRound, className: "text-fg-muted" },
  job_succeeded: { icon: Package, className: "text-success" },
  job_failed: { icon: TriangleAlert, className: "text-danger" },
  agent_done: { icon: Sparkles, className: "text-success" },
  agent_confirm: { icon: MessageSquareWarning, className: "text-warning" },
  agent_question: { icon: MessageSquareWarning, className: "text-primary-text" },
  agent_failed: { icon: TriangleAlert, className: "text-danger" },
}

/**
 * Resolve a notification to its navigation target. Tasks link to the
 * task detail; everything else has no navigation and stays as a plain item.
 */
function resolveHref(n: Note): string | null {
  if (n.task_id) return `/tasks/${n.task_id}`
  return null
}

/** "Today" / "Earlier" groups (newest first, as listed). */
export function groupNotificationsByDay<T extends { created_at: string }>(items: readonly T[], now = new Date()): Array<{ label: string; items: T[] }> {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  const today: T[] = []
  const earlier: T[] = []
  for (const n of items) (new Date(n.created_at) >= start ? today : earlier).push(n)
  return [{ label: "Today", items: today }, { label: "Earlier", items: earlier }].filter((g) => g.items.length > 0)
}

/**
 * The notifications bell (docs/design/ui-polish-spec.md §4.2): an IconButton
 * with a dot for unread (no red "9+" bubble) and a 400px panel grouped into
 * Today / Earlier. Select mode for bulk read / unread / delete.
 */
export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { data: notifications, unreadCount } = useNotifications()
  const queryClient = useQueryClient()

  // eslint-disable-next-line react-hooks/set-state-in-effect -- portal target exists after mount
  useEffect(() => { setMounted(true) }, [])

  // Fixed + portal so the panel escapes the shell's overflow clipping.
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    function updatePosition() {
      const rect = ref.current!.getBoundingClientRect()
      // Keep the whole panel on screen: on phones it spans the width less 8px each side.
      const width = Math.min(400, window.innerWidth - 16)
      setPosition({ top: rect.bottom + 8, right: Math.max(8, Math.min(window.innerWidth - rect.right, window.innerWidth - width - 8)) })
    }
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (ref.current && !ref.current.contains(target) && dropdownRef.current && !dropdownRef.current.contains(target)) setOpen(false)
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener("mousedown", handleClickOutside)
    document.addEventListener("keydown", handleKey)
    // Focus moves into the panel so the keyboard can reach its actions.
    dropdownRef.current?.focus({ preventScroll: true })
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("keydown", handleKey)
    }
  }, [open])

  // Reset selection state when the panel closes so next open starts fresh.
  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on close
      setSelectionMode(false)
      setSelectedIds(new Set())
      setActionError(null)
    }
  }, [open])

  async function markAsRead(ids: string[]) {
    if (ids.length === 0) return
    // One server action for read and unread, limited to the user's own notifications.
    const result = await setNotificationsRead(ids, true)
    setActionError(result.ok ? null : `Could not mark as read: ${result.error}`)
    queryClient.invalidateQueries({ queryKey: ["notifications"] })
  }

  async function markAsUnread(ids: string[]) {
    if (ids.length === 0) return
    const result = await setNotificationsRead(ids, false)
    setActionError(result.ok ? null : `Could not mark as unread: ${result.error}`)
    queryClient.invalidateQueries({ queryKey: ["notifications"] })
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return
    if (!confirm(`Delete ${plural(selectedIds.size, 'notification')}?`)) return
    const ids = [...selectedIds]
    // RLS filters a delete silently (0 rows, no error), so the action returns
    // the deleted ids — a short list is a failure too.
    const result = await deleteNotifications(ids)
    queryClient.invalidateQueries({ queryKey: ["notifications"] })
    if (!result.ok) {
      setActionError(`Could not delete notifications: ${result.error}`)
      return
    }
    const deleted = new Set(result.data.ids)
    const remaining = ids.filter((id) => !deleted.has(id))
    if (remaining.length > 0) {
      setActionError(
        deleted.size === 0
          ? `Could not delete ${ids.length === 1 ? 'the notification' : 'the notifications'}.`
          : `Deleted ${deleted.size} of ${ids.length} notifications; the rest could not be deleted.`,
      )
      setSelectedIds(new Set(remaining))
      return
    }
    setActionError(null)
    setSelectedIds(new Set())
    setSelectionMode(false)
  }

  async function markAllRead() {
    if (!((notifications ?? []) as Note[]).some((n: Note) => !n.is_read)) return
    // Every unread notification of the user, not only the 30 listed.
    const result = await markAllNotificationsRead()
    setActionError(result.ok ? null : `Could not mark as read: ${result.error}`)
    queryClient.invalidateQueries({ queryKey: ["notifications"] })
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allSelected = useMemo(
    () => (notifications?.length ?? 0) > 0 && selectedIds.size === notifications?.length,
    [notifications, selectedIds],
  )
  const selectedHasRead = useMemo(() => ((notifications ?? []) as Note[]).some((n: Note) => selectedIds.has(n.id) && n.is_read), [notifications, selectedIds])
  const selectedHasUnread = useMemo(() => ((notifications ?? []) as Note[]).some((n: Note) => selectedIds.has(n.id) && !n.is_read), [notifications, selectedIds])
  const groups = useMemo(() => groupNotificationsByDay((notifications ?? []) as Note[]), [notifications])

  // Normal mode: a row click marks it read and opens it. Selection mode: toggles.
  function handleRowClick(n: Note) {
    if (selectionMode) { toggleSelect(n.id); return }
    if (!n.is_read) markAsRead([n.id])
    // Agent work that ran in the background: open the Agent with the result merged into the conversation.
    if (n.type.startsWith("agent_")) {
      window.dispatchEvent(new Event(AGENT_OPEN_EVENT))
      setOpen(false)
      return
    }
    // Background job results (exports, imports, bulk actions): the Jobs panel has the download / retry.
    if (n.job_id) {
      window.dispatchEvent(new Event(OPEN_JOBS_PANEL_EVENT))
      setOpen(false)
      return
    }
    const href = resolveHref(n)
    if (href) {
      router.push(href)
      setOpen(false)
    }
  }

  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"

  return (
    <div ref={ref} className="relative">
      <Tooltip content="Notifications" enabled={!open}>
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(!open)}
          data-tour="notification-bell"
          aria-label={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          className="relative inline-flex size-[max(2rem,var(--ds-touch-min))] items-center justify-center rounded-md text-fg-muted transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle hover:text-fg aria-expanded:bg-subtle aria-expanded:text-fg"
          data-notifications-trigger
        >
          <Bell className="size-4" aria-hidden />
          {unreadCount > 0 && (
            <span aria-hidden className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary ring-2 ring-[color:var(--theme-topbar)]" data-unread-dot />
          )}
        </button>
      </Tooltip>

      {open && mounted && createPortal(
        <div
          ref={dropdownRef}
          role="dialog"
          aria-label="Notifications"
          tabIndex={-1}
          className={cn("ds-pop fixed z-[1000] flex max-h-[min(560px,calc(100dvh-80px))] max-sm:max-h-[calc(100dvh-var(--theme-topbar-height)-5rem-env(safe-area-inset-bottom))] w-[min(400px,calc(100vw-16px))] flex-col overflow-hidden outline-none", floatingSurfaceClass)}
          style={{ top: position.top, right: position.right }}
          data-state="open"
        >
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border-subtle pl-4 pr-2">
            <h2 className="flex-1 text-sm font-semibold text-fg">Notifications</h2>
            {!selectionMode && unreadCount > 0 && (
              <Button variant="ghost" size="sm" leadingIcon={<CheckCheck />} onClick={markAllRead}>Mark all read</Button>
            )}
            {(notifications?.length ?? 0) > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setSelectionMode(v => !v); setSelectedIds(new Set()) }} aria-pressed={selectionMode}>
                {selectionMode ? "Done" : "Select"}
              </Button>
            )}
          </div>

          {selectionMode && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border-subtle bg-subtle px-3 py-1.5">
              <Button variant="ghost" size="sm" leadingIcon={allSelected ? <CheckSquare /> : <Square />}
                onClick={allSelected ? () => setSelectedIds(new Set()) : () => setSelectedIds(new Set(((notifications ?? []) as Note[]).map((n: Note) => n.id)))}>
                {allSelected ? "Clear all" : "Select all"}
              </Button>
              <span className="num text-xs text-fg-muted">{selectedIds.size} selected</span>
              <div className="ml-auto flex items-center gap-1">
                {selectedHasUnread && <IconButton size="sm" label="Mark selected as read" icon={<MailOpen />} onClick={() => markAsRead([...selectedIds])} />}
                {selectedHasRead && <IconButton size="sm" label="Mark selected as unread" icon={<Mail />} onClick={() => markAsUnread([...selectedIds])} />}
                {selectedIds.size > 0 && <IconButton size="sm" variant="danger-ghost" label="Delete selected" icon={<Trash2 />} onClick={deleteSelected} />}
              </div>
            </div>
          )}

          {actionError && (
            <InlineNotice tone="danger" message={actionError} onDismiss={() => setActionError(null)} className="m-2" />
          )}

          <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
            {!notifications?.length ? (
              <EmptyState size="sm" icon={BellOff} title="You're all caught up" description="Task assignments, due dates and finished jobs show up here." />
            ) : groups.map((group) => (
              <section key={group.label} aria-label={group.label}>
                <h3 className="sticky top-0 z-[1] bg-elevated px-4 pb-1 pt-3 text-2xs font-medium text-fg-muted">{group.label}</h3>
                <ul>
                  {group.items.map((n) => {
                    const isSelected = selectedIds.has(n.id)
                    const type = TYPE_ICONS[n.type] ?? { icon: Bell, className: "text-fg-muted" }
                    const Icon = type.icon
                    const created = toDate(n.created_at)
                    return (
                      <li
                        key={n.id}
                        className={cn(
                          "group/note relative flex cursor-pointer gap-3 px-4 py-2.5 transition-colors hover:bg-subtle",
                          isSelected && "bg-primary-wash hover:bg-primary-wash",
                        )}
                        onClick={() => handleRowClick(n)}
                        data-unread={!n.is_read || undefined}
                      >
                        {selectionMode && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleSelect(n.id) }}
                            className={cn("mt-0.5 shrink-0", isSelected ? "text-primary-text" : "text-fg-muted")}
                            aria-label={isSelected ? `Deselect ${n.title}` : `Select ${n.title}`}
                            aria-pressed={isSelected}
                          >
                            {isSelected ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                          </button>
                        )}
                        <Icon className={cn("mt-0.5 size-4 shrink-0", type.className)} aria-hidden />
                        <div className="min-w-0 flex-1">
                          {/* The row is clickable; this button is its keyboard / screen-reader way in. */}
                          <button type="button" className="block w-full truncate text-left text-ui font-medium text-fg" onClick={(e) => { e.stopPropagation(); handleRowClick(n) }}>
                            {n.title}
                          </button>
                          {n.body && <p className="mt-0.5 line-clamp-2 text-xs text-fg-muted">{n.body}</p>}
                          {created && (
                            <Tooltip content={formatAbsolute(created)}>
                              <time dateTime={created.toISOString()} className="mt-1 block w-fit text-xs text-fg-subtle">{formatRelative(created)}</time>
                            </Tooltip>
                          )}
                        </div>
                        {!selectionMode && (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            {!n.is_read && <span className="mt-1.5 size-2 rounded-full bg-primary" aria-label="Unread" />}
                            <IconButton
                              size="sm"
                              label={n.is_read ? "Mark as unread" : "Mark as read"}
                              icon={n.is_read ? <Mail /> : <MailOpen />}
                              onClick={(e) => { e.stopPropagation(); if (n.is_read) markAsUnread([n.id]); else markAsRead([n.id]) }}
                              className="opacity-0 focus-visible:opacity-100 group-hover/note:opacity-100 pointer-coarse:opacity-100"
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
