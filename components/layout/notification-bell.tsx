"use client"

import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react"
import { createPortal } from "react-dom"
import { Bell, Check, CheckCheck, Square, CheckSquare, Trash2, MailOpen, Mail } from "lucide-react"
import { useNotifications } from "@/hooks/use-notifications"
import { deleteNotifications, markAllNotificationsRead, setNotificationsRead } from "@/app/actions/notifications"
import { useQueryClient } from "@tanstack/react-query"
import { formatRelativeDate, cn } from "@/lib/utils"
import { useRouter } from "next/navigation"
import { InlineNotice } from "@/components/ui/inline-notice"
import { OPEN_JOBS_PANEL_EVENT } from "@/components/jobs/jobs-provider"

const typeIcons: Record<string, string> = {
  task_assigned: "📋",
  task_completed: "✅",
  task_due_soon: "⏰",
  task_escalated: "🔺",
  team_invite: "👥",
  job_succeeded: "📦",
  job_failed: "⚠️",
}

/**
 * Resolve a notification to its navigation target. Tasks link to the
 * task detail; everything else has no navigation and stays as a plain item.
 */
function resolveHref(n: any): string | null {
  if (n.task_id) return `/tasks/${n.task_id}`
  return null
}

export function NotificationBell() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [position, setPosition] = useState<{ top: number; right: number }>({ top: 0, right: 0 })
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const { data: notifications, unreadCount } = useNotifications()
  const queryClient = useQueryClient()

  useEffect(() => { setMounted(true) }, [])

  // Compute the dropdown's fixed position from the trigger button's
  // bounding rect. Using fixed + portal so the dropdown escapes the
  // dashboard shell's overflow-hidden clipping — previously it would
  // render "under" the first dashboard metric card because the flex
  // column it lived in clipped anything extending past its bottom.
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    function updatePosition() {
      const rect = ref.current!.getBoundingClientRect()
      setPosition({
        top: rect.bottom + 8,
        right: window.innerWidth - rect.right,
      })
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
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node
      if (
        ref.current && !ref.current.contains(target) &&
        dropdownRef.current && !dropdownRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Reset selection state when the dropdown closes so next open starts fresh.
  useEffect(() => {
    if (!open) {
      setSelectionMode(false)
      setSelectedIds(new Set())
      setActionError(null)
    }
  }, [open])

  async function markAsRead(ids: string[]) {
    if (ids.length === 0) return
    // One server action for read and unread (mark_notifications_read only
    // covers read), limited to the user's own notifications.
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
    if (!confirm(`Delete ${selectedIds.size} notification${selectedIds.size !== 1 ? 's' : ''}?`)) return
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
    if (!(notifications ?? []).some((n: any) => !n.is_read)) return
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

  function selectAll() {
    setSelectedIds(new Set((notifications ?? []).map((n: any) => n.id)))
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  // Derived counts for the bulk-action bar
  const allSelected = useMemo(
    () => (notifications?.length ?? 0) > 0 && selectedIds.size === notifications?.length,
    [notifications, selectedIds],
  )
  const selectedHasRead = useMemo(
    () => (notifications ?? []).some((n: any) => selectedIds.has(n.id) && n.is_read),
    [notifications, selectedIds],
  )
  const selectedHasUnread = useMemo(
    () => (notifications ?? []).some((n: any) => selectedIds.has(n.id) && !n.is_read),
    [notifications, selectedIds],
  )

  // When a notification row is clicked in NORMAL mode (not selection
  // mode), we mark it read and navigate. In selection mode, the click
  // instead toggles selection — matches email-app conventions.
  function handleRowClick(n: any) {
    if (selectionMode) {
      toggleSelect(n.id)
      return
    }
    if (!n.is_read) markAsRead([n.id])
    // Background job results (exports, imports, bulk actions): the Jobs panel
    // has the download / retry.
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

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 transition-colors hover:opacity-80"
        style={{ color: "var(--theme-topbar-text)" }}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold text-[color:var(--theme-on-danger)]"
            style={{ backgroundColor: "var(--theme-danger)" }}
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && mounted && createPortal(
        <div
          ref={dropdownRef}
          className="fixed w-[min(24rem,calc(100vw-1rem))] rounded-xl border shadow-xl overflow-hidden"
          style={{
            top: `${position.top}px`,
            right: `${position.right}px`,
            zIndex: 1000,
            backgroundColor: "var(--theme-card-bg)",
            borderColor: "var(--theme-surface-border)",
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between border-b px-4 py-3"
            style={{ borderColor: "var(--theme-surface-border)" }}
          >
            <h3 className="text-sm font-semibold" style={{ color: "var(--theme-card-text)" }}>
              Notifications
              {unreadCount > 0 && (
                <span
                  className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-bold"
                  style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                >
                  {unreadCount}
                </span>
              )}
            </h3>
            <div className="flex items-center gap-2">
              {!selectionMode && unreadCount > 0 && (
                <button
                  onClick={markAllRead}
                  className="flex items-center gap-1 text-[11px] font-medium transition-colors hover:opacity-80"
                  style={{ color: "var(--theme-primary-text)" }}
                  title="Mark all as read"
                >
                  <CheckCheck size={12} />
                  Mark all read
                </button>
              )}
              {(notifications?.length ?? 0) > 0 && (
                <button
                  onClick={() => {
                    setSelectionMode(v => !v)
                    setSelectedIds(new Set())
                  }}
                  className="text-[11px] font-medium transition-colors hover:opacity-80"
                  style={{ color: selectionMode ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
                  title={selectionMode ? 'Exit selection mode' : 'Enter selection mode'}
                >
                  {selectionMode ? 'Done' : 'Select'}
                </button>
              )}
            </div>
          </div>

          {/* Bulk action bar — only rendered in selection mode */}
          {selectionMode && (
            <div
              className="flex items-center justify-between border-b px-4 py-2 gap-2 flex-wrap"
              style={{ borderColor: "var(--theme-surface-border)", backgroundColor: 'var(--theme-surface)' }}
            >
              <button
                onClick={allSelected ? clearSelection : selectAll}
                className="flex items-center gap-1.5 text-[11px] font-medium hover:opacity-80"
                style={{ color: 'var(--theme-card-text)' }}
              >
                {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                {allSelected ? 'Clear all' : 'Select all'}
              </button>
              <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                {selectedIds.size} selected
              </span>
              <div className="flex items-center gap-1 ml-auto">
                {selectedHasUnread && (
                  <button
                    onClick={() => markAsRead([...selectedIds])}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-medium hover:opacity-80"
                    style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}
                    title="Mark selected as read"
                  >
                    <MailOpen size={10} /> Read
                  </button>
                )}
                {selectedHasRead && (
                  <button
                    onClick={() => markAsUnread([...selectedIds])}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-medium hover:opacity-80"
                    style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)', border: '1px solid var(--theme-surface-border)' }}
                    title="Mark selected as unread"
                  >
                    <Mail size={10} /> Unread
                  </button>
                )}
                {selectedIds.size > 0 && (
                  <button
                    onClick={deleteSelected}
                    className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-md font-medium hover:opacity-80"
                    style={{ backgroundColor: 'var(--status-error-bg)', color: 'var(--status-error)' }}
                    title="Delete selected"
                  >
                    <Trash2 size={10} /> Delete
                  </button>
                )}
              </div>
            </div>
          )}

          {actionError && (
            <InlineNotice
              tone="error"
              message={actionError}
              onDismiss={() => setActionError(null)}
              className="m-2"
            />
          )}

          {/* List */}
          <div className="max-h-[480px] overflow-y-auto">
            {!notifications?.length ? (
              <p
                className="px-4 py-8 text-center text-sm"
                style={{ color: "var(--theme-muted-text)" }}
              >
                No notifications yet
              </p>
            ) : (
              notifications.map((n: any) => {
                const isSelected = selectedIds.has(n.id)
                return (
                  <div
                    key={n.id}
                    className={cn(
                      "flex gap-3 px-4 py-3 transition-colors cursor-pointer border-b",
                      "hover:bg-[var(--theme-row-highlight)]",
                    )}
                    style={{
                      backgroundColor: isSelected
                        ? 'var(--theme-primary-light)'
                        : n.is_read
                          ? undefined
                          : "color-mix(in srgb, var(--theme-primary) 6%, transparent)",
                      borderColor: 'var(--theme-surface-border)',
                    }}
                    onClick={() => handleRowClick(n)}
                  >
                    {/* Selection checkbox — only rendered in selection mode */}
                    {selectionMode && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleSelect(n.id) }}
                        className="shrink-0 mt-0.5"
                        style={{ color: isSelected ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}
                      >
                        {isSelected ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                    )}
                    <span className="text-base shrink-0 mt-0.5">
                      {typeIcons[n.type] ?? "📌"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-sm font-medium truncate"
                        style={{ color: "var(--theme-card-text)" }}
                      >
                        {n.title}
                      </p>
                      {n.body && (
                        <p
                          className="text-xs mt-0.5 truncate"
                          style={{ color: "var(--theme-muted-text)" }}
                        >
                          {n.body}
                        </p>
                      )}
                      <p
                        className="text-[10px] mt-1"
                        style={{ color: "var(--theme-muted-text)" }}
                      >
                        {formatRelativeDate(n.created_at)}
                      </p>
                    </div>
                    {!n.is_read && !selectionMode && (
                      <span
                        className="mt-1.5 h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: "var(--theme-primary)" }}
                      />
                    )}
                    {/* Per-row quick toggle for mark-read / mark-unread */}
                    {!selectionMode && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          if (n.is_read) markAsUnread([n.id])
                          else markAsRead([n.id])
                        }}
                        className="p-1 rounded hover:bg-[var(--theme-surface)] shrink-0 opacity-40 hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--theme-muted-text)' }}
                        title={n.is_read ? 'Mark as unread' : 'Mark as read'}
                      >
                        {n.is_read ? <Mail size={11} /> : <MailOpen size={11} />}
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}
