"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, ClipboardList, Clock, ExternalLink, Loader2, MessageSquare, Paperclip, Plus, RotateCcw, Workflow } from "lucide-react"
import { StatusPill, statusLabel } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InlineNotice } from "@/components/ui/inline-notice"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Select } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip } from "@/components/ui/tooltip"
import { RelativeTime } from "@/components/activity/relative-time"
import { ManualEffortEntry } from "@/components/tasks/manual-effort-entry"
import { serverQuery } from "@/lib/server-read"
import { formatAbsolute, formatDay } from "@/lib/format/date"
import { plural } from "@/lib/format/plural"
import { cn } from "@/lib/utils"
import type { TaskPanelData, TaskPanelSubtask } from "@/lib/services/task-panel"

/**
 * The task lists' detail panel — one experience on the Task tracker, My
 * team, My tasks and Home: summary (status, priority, due, assignee,
 * requester), progress, effort (log time; logged vs estimate), subtasks
 * (tick, add), the latest comment / activity, attachments and the links
 * (Open task, Open form, Process view). Loaded when the row opens
 * (`tasks.panel`, lib/services/task-panel.ts); edit controls show only when
 * the server would accept the change (`can`), otherwise it reads only.
 * Quick actions (complete, hold, redirect…) stay on the row's Actions toggle.
 */

export function taskPanelQueryKey(taskId: string) {
  return ["tasks", "panel", taskId] as const
}

/** Everything a change from the panel can affect: the lists, Home, the task page. */
export const TASK_PANEL_REFRESH_KEYS = [["tasks"], ["assigned-tasks"], ["team-tasks"], ["home"], ["task-follows"], ["subtasks"], ["nav-counts"]] as const

/** 90 → "1.5h", 45 → "45m", 0 → "0h". */
export function formatMinutes(minutes: number): string {
  if (!minutes) return "0h"
  if (minutes < 60) return `${minutes}m`
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

/** The statuses a person can set from the panel (Completed goes through Complete). */
export const PANEL_STATUS_OPTIONS = [
  { value: "todo", label: "To do" },
  { value: "in_progress", label: "In progress" },
  { value: "blocked", label: "Blocked" },
] as const

export interface TaskDetailPanelProps {
  taskId: string
  title: string
  /** Region id (the row's toggle aria-controls it). */
  id?: string
  /** Home / phones: one column, fewer extras. */
  compact?: boolean
  /** Escape inside the panel (the row collapses and refocuses its toggle). */
  onClose?: () => void
  className?: string
}

export function TaskDetailPanel({ taskId, title, id, compact = false, onClose, className }: TaskDetailPanelProps) {
  const { data, isPending, isError, error } = useQuery({
    queryKey: taskPanelQueryKey(taskId),
    queryFn: async () => (await serverQuery("tasks.panel", { taskId })) as TaskPanelData | null,
    staleTime: 15_000,
  })

  return (
    <div
      id={id}
      role="region"
      aria-label={`Details: ${title}`}
      className={cn("text-ui", className)}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !onClose) return
        const target = e.target as HTMLElement
        if (target.closest("input, textarea, select, [role='dialog'], [role='listbox'], [role='menu']")) return
        e.stopPropagation()
        onClose()
      }}
      data-task-detail-panel={taskId}
    >
      {isPending ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading task details">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ) : isError ? (
        <p role="alert" className="text-xs text-danger">{(error as Error)?.message || "This task’s details couldn’t be loaded."}</p>
      ) : !data ? (
        <p className="text-xs text-fg-muted" data-task-panel-unavailable>This task’s details aren’t available to you. <Link href={`/tasks/${taskId}`} className="font-medium text-primary-text hover:underline">Open task</Link></p>
      ) : (
        <PanelBody data={data} compact={compact} />
      )}
    </div>
  )
}

function useRefresh(taskId: string) {
  const queryClient = useQueryClient()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...taskPanelQueryKey(taskId)] }),
      ...TASK_PANEL_REFRESH_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })),
      queryClient.invalidateQueries({ queryKey: ["task-detail", taskId] }),
      queryClient.invalidateQueries({ queryKey: ["task-tree", taskId] }),
    ])
  }
}

function PanelBody({ data, compact }: { data: TaskPanelData; compact: boolean }) {
  return (
    <div className="space-y-3" data-task-panel-body={data.id}>
      <Summary data={data} />
      {data.description && <p className={cn("max-w-[72ch] text-fg-muted", compact ? "line-clamp-2" : "line-clamp-3")}>{data.description}</p>}
      <div className={cn("grid gap-3", !compact && "@3xl:grid-cols-2 md:grid-cols-2")}>
        <ProgressSection data={data} />
        <EffortSection data={data} compact={compact} />
        <SubtasksSection data={data} compact={compact} />
        <LatestSection data={data} />
      </div>
      <Footer data={data} />
    </div>
  )
}

function Section({ title, children, aside, ...props }: { title: string; children: React.ReactNode; aside?: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section aria-label={title} className="min-w-0 space-y-1.5 rounded-md border border-border-subtle bg-panel p-3" {...props}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-fg-muted">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/* ── Summary ── */

function Summary({ data }: { data: TaskPanelData }) {
  const overdue = Boolean(data.due_date && !data.closed && new Date(data.due_date) < new Date())
  return (
    <dl className="flex flex-wrap items-start gap-x-6 gap-y-2" data-task-panel-summary>
      <Item label="Status"><StatusControl data={data} /></Item>
      <Item label="Priority">{data.priority ? <PriorityBadge priority={data.priority} /> : <span className="text-fg-subtle">—</span>}</Item>
      <Item label="Due">
        {data.due_date ? (
          <Tooltip content={formatAbsolute(data.due_date)}>
            <span tabIndex={0} className={cn("num inline-flex items-center gap-1", overdue ? "text-danger" : "text-fg")}>
              {overdue && <Clock className="size-3.5" aria-hidden="true" />}{formatDay(data.due_date)}{overdue && <span className="sr-only"> (overdue)</span>}
            </span>
          </Tooltip>
        ) : <span className="text-fg-subtle">No due date</span>}
      </Item>
      <Item label="Assignee">{data.assignee?.name ?? (data.team ? `${data.team} team` : "Unassigned")}</Item>
      <Item label="Requester">{data.requester?.name ?? "—"}</Item>
    </dl>
  )
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5 truncate font-medium text-fg">{children}</dd>
    </div>
  )
}

function StatusControl({ data }: { data: TaskPanelData }) {
  const refresh = useRefresh(data.id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!data.can.status) return <StatusPill status={data.status} />
  const options = PANEL_STATUS_OPTIONS.some((o) => o.value === data.status)
    ? PANEL_STATUS_OPTIONS
    : [{ value: data.status, label: statusLabel(data.status) }, ...PANEL_STATUS_OPTIONS]
  async function change(value: string) {
    if (value === data.status) return
    setBusy(true)
    setError(null)
    try {
      const { updateTaskField } = await import("@/app/actions/tasks")
      await updateTaskField(data.id, "status", value)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "The status couldn’t be changed")
    }
    setBusy(false)
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select size="sm" wrapperClassName="w-36" aria-label="Status" value={data.status} disabled={busy}
        onChange={(e) => void change(e.target.value)} options={options} data-task-panel-status />
      {busy && <Loader2 className="size-3.5 motion-safe:animate-spin text-fg-muted" aria-hidden="true" />}
      {error && <span role="alert" className="text-xs font-normal text-danger">{error}</span>}
    </span>
  )
}

/* ── Progress ── */

function ProgressSection({ data }: { data: TaskPanelData }) {
  const refresh = useRefresh(data.id)
  const [value, setValue] = useState(data.progress.pct)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = useRef(false)
  useEffect(() => { if (!dirty.current) setValue(data.progress.pct) }, [data.progress.pct])

  async function save(pct: number | null) {
    dirty.current = false
    setSaving(true)
    setError(null)
    try {
      const { updateTaskField } = await import("@/app/actions/tasks")
      await updateTaskField(data.id, "progress_pct", pct)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Progress couldn’t be saved")
    }
    setSaving(false)
  }

  const hasSubtasks = data.subtasks.total > 0
  return (
    <Section title="Progress" data-task-panel-progress aside={(
      <span className="num text-xs text-fg-muted">
        {saving ? "Saving…" : hasSubtasks ? (data.progress.manual === null ? "From subtasks" : "Set manually") : null}
      </span>
    )}>
      {data.can.progress ? (
        <div className="flex items-center gap-2">
          <input
            type="range" min={0} max={100} step={5} value={value}
            onChange={(e) => { dirty.current = true; setValue(Number(e.target.value)) }}
            onPointerUp={() => { if (dirty.current) void save(value) }}
            onKeyUp={(e) => { if (dirty.current && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) void save(value) }}
            onBlur={() => { if (dirty.current) void save(value) }}
            aria-label="Progress"
            aria-valuetext={`${value}%`}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[color:var(--theme-primary)]"
            data-task-panel-progress-input
          />
          <span className="num w-10 text-right text-sm font-semibold text-fg">{value}%</span>
          {hasSubtasks && data.progress.manual !== null && (
            <Tooltip content="Follow subtask progress again">
              <Button size="icon-sm" variant="ghost" aria-label="Use subtask progress" onClick={() => void save(null)} disabled={saving}>
                <RotateCcw aria-hidden="true" />
              </Button>
            </Tooltip>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <ProgressBar value={data.progress.pct} className="flex-1" label="Task progress" />
          <span className="num w-10 text-right text-sm font-semibold text-fg">{data.progress.pct}%</span>
        </div>
      )}
      {hasSubtasks && <p className="num text-xs text-fg-muted">{data.subtasks.completed} of {plural(data.subtasks.total, "subtask")} done</p>}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </Section>
  )
}

/* ── Effort ── */

function EffortSection({ data, compact }: { data: TaskPanelData; compact: boolean }) {
  const refresh = useRefresh(data.id)
  const { loggedMinutes, estimateMinutes, entries } = data.effort
  const pct = estimateMinutes ? Math.round((loggedMinutes / estimateMinutes) * 100) : null
  return (
    <Section title="Effort" data-task-panel-effort aside={(
      <span className="num text-xs text-fg-muted" data-task-panel-effort-total>
        <strong className="font-semibold text-fg">{formatMinutes(loggedMinutes)}</strong> logged{estimateMinutes ? <> of {formatMinutes(estimateMinutes)} estimate</> : null}
      </span>
    )}>
      {pct !== null && (
        <div className="flex items-center gap-2">
          <ProgressBar value={Math.min(pct, 100)} size="sm" className="flex-1" label="Effort logged against the estimate" />
          <span className={cn("num w-10 text-right text-xs", pct > 100 ? "text-danger" : "text-fg-muted")}>{pct}%</span>
        </div>
      )}
      {!compact && entries.length > 0 && (
        <ul className="space-y-0.5" data-task-panel-effort-entries>
          {entries.map((e) => (
            <li key={e.id} className="flex items-center gap-2 text-xs text-fg-muted">
              <span className="num w-10 shrink-0 font-medium text-fg">{formatMinutes(e.minutes)}</span>
              <span className="min-w-0 flex-1 truncate">{e.notes || "Effort"}{e.by ? ` · ${e.by}` : ""}</span>
              <RelativeTime at={e.at} />
            </li>
          ))}
        </ul>
      )}
      {data.can.effort ? (
        <ManualEffortEntry taskId={data.id} onLogged={() => void refresh()} />
      ) : !entries.length && <p className="text-xs text-fg-muted">No effort logged yet.</p>}
    </Section>
  )
}

/* ── Subtasks ── */

function SubtasksSection({ data, compact }: { data: TaskPanelData; compact: boolean }) {
  const refresh = useRefresh(data.id)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [toggling, setToggling] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const items = compact ? data.subtasks.items.slice(0, 8) : data.subtasks.items

  async function toggle(sub: TaskPanelSubtask) {
    if (toggling) return
    const status = overrides[sub.id] ?? sub.status
    const done = status !== "completed"
    setToggling(sub.id)
    setError(null)
    setOverrides((o) => ({ ...o, [sub.id]: done ? "completed" : "todo" }))
    const { setSubtaskCompleted } = await import("@/app/actions/tasks")
    const result = await setSubtaskCompleted(sub.id, done, data.id)
    if (!result.ok) {
      setOverrides((o) => { const next = { ...o }; delete next[sub.id]; return next })
      setError(result.error)
    } else {
      await refresh()
      setOverrides((o) => { const next = { ...o }; delete next[sub.id]; return next })
    }
    setToggling(null)
  }

  async function add(e: React.FormEvent) {
    e.preventDefault()
    const text = title.trim()
    if (!text || busy) return
    setBusy(true)
    setError(null)
    const { addSubtask } = await import("@/app/actions/tasks")
    const result = await addSubtask(data.id, { title: text })
    if (!result.ok) setError(result.error)
    else {
      setTitle("")
      await refresh()
      inputRef.current?.focus()
    }
    setBusy(false)
  }

  return (
    <Section title="Subtasks" data-task-panel-subtasks aside={data.subtasks.total > 0 ? (
      <span className="num text-xs text-fg-muted">{data.subtasks.completed}/{data.subtasks.total} done</span>
    ) : undefined}>
      {items.length === 0 && !adding && <p className="text-xs text-fg-muted">No subtasks.</p>}
      {items.length > 0 && (
        <ul className="space-y-0.5">
          {items.map((sub) => {
            const status = overrides[sub.id] ?? sub.status
            const done = status === "completed"
            return (
              <li key={sub.id} className="-mx-1 flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-subtle" data-task-panel-subtask={sub.id}>
                {data.can.subtasks ? (
                  <button type="button" role="checkbox" aria-checked={done} aria-label={`${done ? "Reopen" : "Complete"} subtask: ${sub.title}`}
                    disabled={toggling === sub.id} onClick={() => void toggle(sub)}
                    className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors duration-[var(--ds-dur-fast)]",
                      done ? "border-primary bg-primary" : "border-border hover:border-border-strong", toggling === sub.id && "opacity-50")}
                    data-task-panel-subtask-toggle={sub.id}>
                    {toggling === sub.id ? <Loader2 className="size-2.5 motion-safe:animate-spin text-fg" aria-hidden="true" /> : done ? <Check className="size-2.5 text-primary-fg" aria-hidden="true" /> : null}
                  </button>
                ) : (
                  <StatusPill status={status} />
                )}
                <Link href={`/tasks/${sub.id}`} className={cn("min-w-0 flex-1 truncate text-xs hover:underline", done ? "text-fg-muted line-through" : "text-fg")}>{sub.title || "Untitled task"}</Link>
                {!compact && sub.assignee && <span className="hidden max-w-[8rem] truncate text-xs text-fg-muted sm:inline">{sub.assignee}</span>}
                {sub.due_date && <span className="num shrink-0 text-xs text-fg-muted">{formatDay(sub.due_date)}</span>}
              </li>
            )
          })}
        </ul>
      )}
      {data.subtasks.total > items.length && (
        <Link href={`/tasks/${data.id}`} className="block text-xs font-medium text-primary-text hover:underline">View all {data.subtasks.total} subtasks</Link>
      )}
      {data.can.addSubtask && (adding ? (
        <form onSubmit={(e) => void add(e)} className="flex items-center gap-1.5" data-task-panel-add-subtask-form>
          <Input ref={inputRef} size="sm" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Subtask title" aria-label="New subtask title" maxLength={500} autoFocus
            onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); setAdding(false); setTitle("") } }} className="min-w-0 flex-1" />
          <Button type="submit" size="sm" loading={busy} disabled={!title.trim()}>Add</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(false); setTitle("") }}>Cancel</Button>
        </form>
      ) : (
        <Button type="button" size="sm" variant="ghost" leadingIcon={<Plus />} onClick={() => setAdding(true)} data-task-panel-add-subtask>Add subtask</Button>
      ))}
      {error && <InlineNotice tone="danger" onDismiss={() => setError(null)}>{error}</InlineNotice>}
    </Section>
  )
}

/* ── Latest comment / activity ── */

function LatestSection({ data }: { data: TaskPanelData }) {
  return (
    <Section title={data.latest?.kind === "comment" ? "Latest comment" : "Latest activity"} data-task-panel-latest>
      {data.latest ? (
        <p className="flex items-start gap-2 text-xs text-fg-muted">
          <MessageSquare className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="line-clamp-2 text-fg">{data.latest.text}</span>
            <span>{data.latest.by ?? "System"} · <RelativeTime at={data.latest.at} /></span>
          </span>
        </p>
      ) : <p className="text-xs text-fg-muted">No activity yet.</p>}
    </Section>
  )
}

/* ── Links ── */

function Footer({ data }: { data: TaskPanelData }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-task-panel-links>
      <Link href={data.links.task} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-task-panel-open>
        <ExternalLink className="size-3.5" aria-hidden="true" /> Open task
      </Link>
      {data.links.form && (
        <Link href={data.links.form} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-task-panel-form>
          <ClipboardList className="size-3.5" aria-hidden="true" /> Open form
        </Link>
      )}
      {data.links.process && (
        <Link href={data.links.process} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-task-panel-process>
          <Workflow className="size-3.5" aria-hidden="true" /> Process view
        </Link>
      )}
      <Link href={`${data.links.task}?tab=attachments`} className="inline-flex items-center gap-1 text-fg-muted hover:text-fg hover:underline" data-task-panel-attachments>
        <Paperclip className="size-3.5" aria-hidden="true" /> {plural(data.attachments, "attachment")}
      </Link>
      {data.readOnlyReason && <span className="text-fg-muted" data-task-panel-readonly>{data.readOnlyReason}</span>}
    </div>
  )
}
