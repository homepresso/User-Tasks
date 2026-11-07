"use client"

import { useEffect, useId, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Bell, BellOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { SearchInput } from "@/components/ui/input"
import { StatusPill, type Tone } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/tooltip"
import { FloatingLayer } from "@/components/ui/floating-layer"
import { floatingSurfaceClass } from "@/components/ui/dropdown-menu"
import { setRunFollowed } from "@/app/actions/home"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import { formatCount } from "@/lib/format/number"
import { cn } from "@/lib/utils"
import type { ProgressStatus, RunStage } from "@/lib/home/progress"

/** React Query key prefix of every Home read (invalidated after follow / claim / star). */
export const HOME_QUERY_KEY = ["home"] as const

export function useDebounced<T>(value: T, ms = 250): T {
  const [out, setOut] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setOut(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return out
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <div className="w-full @xl:w-64">
      <SearchInput size="sm" value={value} onValueChange={onChange} placeholder={placeholder} aria-label={label} />
    </div>
  )
}

const STATUS_TONE: Record<ProgressStatus, Tone> = {
  queued: "neutral", running: "info", waiting: "warning", completed: "success", failed: "danger", cancelled: "neutral", none: "neutral",
}

const STATUS_WORD: Record<ProgressStatus, string> = {
  queued: "Starting", running: "Running", waiting: "Waiting", completed: "Completed", failed: "Failed", cancelled: "Cancelled", none: "No process",
}

export function ProgressPill({ status }: { status: ProgressStatus }) {
  return <StatusPill status={status} tone={STATUS_TONE[status] ?? "neutral"} label={STATUS_WORD[status] ?? status} data-progress-status={status} />
}

/** "View stage": the current step name(s); the popover says who has it and since when. */
export function StagePopover({ stages, fallback = "—" }: { stages: RunStage[]; fallback?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const anchorRef = useRef<HTMLButtonElement>(null)
  if (!stages.length) return <span className="text-fg-muted">{fallback}</span>
  const names = [...new Set(stages.map((s) => s.name))].join(", ")
  return (
    <div className="relative inline-block max-w-full">
      <button
        ref={anchorRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={`View stage: ${names}`}
        className="max-w-full truncate rounded-sm text-left text-ui font-medium text-primary-text underline decoration-dotted underline-offset-2 hover:decoration-solid"
        data-view-stage
      >
        {names}
      </button>
      {/* In a portal (FloatingLayer), so Home's scrolling widget frame never clips it. */}
      <FloatingLayer anchorRef={anchorRef} open={open} onDismiss={() => setOpen(false)} closeOnEscape width={288} maxHeight={360}
        id={id} role="dialog" aria-label="Current stage" className={cn(floatingSurfaceClass, "border border-border p-3 text-xs")}>
        <div data-stage-popover>
          <ul className="space-y-2">
            {stages.map((s, i) => (
              <li key={`${s.node_id ?? "x"}-${i}`}>
                <p className="font-medium text-fg">{s.name}</p>
                <p className="text-fg-muted">
                  With {s.assignees.length ? s.assignees.map((a) => a.name).join(", ") : s.team ? `the ${s.team} team` : "no one yet (an automatic step)"}
                </p>
                {s.since && <p className="text-fg-muted">Since {formatRelative(s.since)} · {formatAbsolute(s.since)}</p>}
                {s.due_date && <p className="text-fg-muted">Due {formatRelative(s.due_date)}</p>}
              </li>
            ))}
          </ul>
        </div>
      </FloatingLayer>
    </div>
  )
}

export function People({ names }: { names: string[] }) {
  if (!names.length) return <span className="text-fg-muted">—</span>
  const shown = names.slice(0, 2).join(", ")
  const text = <span className="truncate">{shown}{names.length > 2 ? ` +${names.length - 2}` : ""}</span>
  return names.length > 2 ? <Tooltip content={names.join(", ")}><span tabIndex={0} className="truncate">{text}</span></Tooltip> : text
}

/** A relative date ("5 min ago", "27 Oct") with the absolute one in a tooltip. */
export function When({ at }: { at: string | null | undefined }) {
  if (!at) return <span className="text-fg-muted">—</span>
  return (
    <Tooltip content={formatAbsolute(at)}>
      <time dateTime={at} tabIndex={0} className="num whitespace-nowrap">{formatRelative(at)}</time>
    </Tooltip>
  )
}

/** Follow / Unfollow a run (the run view, submissions, Following). */
export function FollowButton({ runId, following, size = "sm", onChange, compact = false }: {
  runId: string
  following: boolean
  size?: "sm" | "default"
  compact?: boolean
  onChange?: (following: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryClient = useQueryClient()
  async function toggle() {
    setBusy(true)
    setError(null)
    const result = await setRunFollowed(runId, !following)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    onChange?.(result.data.following)
    void queryClient.invalidateQueries({ queryKey: HOME_QUERY_KEY })
  }
  const icon = following ? <BellOff /> : <Bell />
  return (
    <span className="inline-flex items-center gap-1">
      {compact ? (
        <IconButton size="sm" variant="secondary" label={following ? "Unfollow this process" : "Follow this process on your Home page"} icon={icon}
          onClick={toggle} disabled={busy} aria-pressed={following} data-follow-button={following ? "following" : "not-following"} />
      ) : (
        <Button size={size === "default" ? "md" : "sm"} variant="secondary" onClick={toggle} disabled={busy} aria-pressed={following}
          leadingIcon={icon} data-follow-button={following ? "following" : "not-following"}>
          {following ? "Unfollow" : "Follow"}
        </Button>
      )}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  )
}

/** A placeholder row while a tab loads. */
export function RowsSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border-subtle" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-[var(--theme-density-row-height)] items-center gap-3 px-4">
          <Skeleton className="h-2.5 w-1/3" />
          <Skeleton className="h-2.5 w-1/5" />
          <Skeleton className="ml-auto h-2.5 w-16" />
        </div>
      ))}
    </div>
  )
}

/** Page through a list (25 a page). */
export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null
  const page = Math.floor(offset / limit) + 1
  const pages = Math.max(1, Math.ceil(total / limit))
  return (
    <div className="flex items-center justify-between border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">
      <span className="num">{formatCount(offset + 1)}–{formatCount(Math.min(offset + limit, total))} of {formatCount(total)}</span>
      <div className="flex items-center gap-1">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <span className="num px-1">{page} / {pages}</span>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  )
}

/** A responsive row: a grid of columns on wide screens, stacked on phones. */
export function rowClass(extra?: string) {
  return cn(
    "flex flex-col gap-1.5 px-4 py-2.5 text-ui text-fg transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle",
    "@2xl:grid @2xl:min-h-[var(--theme-density-row-height)] @2xl:items-center @2xl:gap-3 @2xl:py-1.5",
    extra,
  )
}
