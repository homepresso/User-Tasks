"use client"

import { useState } from "react"
import Link from "next/link"
import * as RadixDialog from "@radix-ui/react-dialog"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Check, ChevronDown, ChevronUp, Clock, ClipboardList, ExternalLink, History, Loader2, MessageSquare, MoreHorizontal, Paperclip, Workflow, X,
} from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { StatusPill } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IconButton } from "@/components/ui/icon-button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { PriorityBadge } from "@/components/ui/priority-badge"
import { ProgressBar } from "@/components/ui/progress-bar"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip } from "@/components/ui/tooltip"
import { overlayClass } from "@/components/ui/dialog"
import { RelativeTime } from "@/components/activity/relative-time"
import { QueuedTaskActions } from "@/components/tasks/queued-task-actions"
import { outcomeLabel } from "@/components/tasks/task-outcome-dialog"
import { QUICK_ACTION_REFRESH_KEYS, TaskQuickActionsPanel, quickActionsQueryKey, runQuickAction } from "@/components/tasks/task-quick-actions"
import { TASK_PANEL_REFRESH_KEYS, formatMinutes, taskPanelQueryKey } from "@/components/tasks/task-detail-panel"
import { TimelineSheet } from "@/components/timeline/timeline-sheet"
import { useMarkTaskReadOnOpen } from "@/hooks/use-task-read-state"
import { serverQuery } from "@/lib/server-read"
import { formatAbsolute, formatDay, formatRelative } from "@/lib/format/date"
import { formatCount } from "@/lib/format/number"
import { plural } from "@/lib/format/plural"
import type { TaskPanelData } from "@/lib/services/task-panel"
import type { TaskQuickActionsInfo } from "@/lib/tasks/quick-actions"
import { cn } from "@/lib/utils"

/**
 * The task quick view opened from app task lists (task list, overdue list,
 * Kanban, calendar): one right-hand drawer laid out on one spacing scale —
 *
 *  - a sticky header: status and priority, the title (two lines, the whole
 *    title on hover / "Show full title"), then due (overdue in danger),
 *    assignee and requester with avatars, all on the title's left edge;
 *  - the body: the description ("Show more"), the task's form fields as a
 *    read-only preview, progress, subtasks, effort and the latest activity
 *    in tidy sections;
 *  - a sticky footer with the task's real actions — Claim / Accept for queued
 *    tasks, its configured outcomes (Approve / Reject…) or Complete, "Open
 *    form to complete" when its form must be filled — from the same server
 *    rules and actions as the task lists (tasks.quickActions, runQuickAction),
 *    "More actions" for hold / redirect / escalate / comment, and the links
 *    (Open task, Open form, Process view, Timeline, Attachments).
 *
 * Everything is read and acted on as the signed-in person; controls show
 * only when the server would accept them.
 */

export function TaskQuickView({ task, onClose }: { task: { id: string; title: string; action?: "accept" | "claim" } | null; onClose: () => void }) {
  return (
    <RadixDialog.Root open={!!task} onOpenChange={(o) => { if (!o) onClose() }}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className={overlayClass} />
        <RadixDialog.Content aria-describedby={undefined}
          className="ds-sheet fixed inset-y-0 right-0 z-50 flex w-[min(100vw,600px)] max-w-full flex-col border-l border-border bg-elevated text-fg shadow-elev-3 outline-none"
          data-task-drawer>
          {task ? <QuickViewBody task={task} onClose={onClose} /> : <RadixDialog.Title className="sr-only">Task</RadixDialog.Title>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

const PAD = "px-5 max-sm:px-4"

function QuickViewBody({ task, onClose }: { task: { id: string; title: string; action?: "accept" | "claim" }; onClose: () => void }) {
  const panel = useQuery({
    queryKey: taskPanelQueryKey(task.id),
    queryFn: async () => (await serverQuery("tasks.panel", { taskId: task.id })) as TaskPanelData | null,
    staleTime: 15_000,
  })
  const actions = useQuery({
    queryKey: quickActionsQueryKey(task.id),
    queryFn: async () => (await serverQuery("tasks.quickActions", { taskId: task.id })) as TaskQuickActionsInfo | null,
    staleTime: 15_000,
  })
  useMarkTaskReadOnOpen(task.id, !!panel.data)
  const data = panel.data
  const title = data?.title || task.title || "Untitled task"
  return (
    <>
      <QuickViewHeader title={title} data={data ?? null} loading={panel.isPending} onClose={onClose} />
      <div className={cn("min-h-0 flex-1 overflow-y-auto py-4", PAD)} data-task-drawer-body>
        {panel.isPending ? (
          <div className="space-y-3" aria-busy aria-label="Loading task details">
            <Skeleton className="h-3.5 w-full" /><Skeleton className="h-3.5 w-5/6" /><Skeleton className="h-3.5 w-2/3" />
            <div className="grid grid-cols-2 gap-3 pt-2">{[0, 1, 2, 3].map((i) => <div key={i} className="space-y-1.5"><Skeleton className="h-2.5 w-16" /><Skeleton className="h-3.5 w-28" /></div>)}</div>
          </div>
        ) : panel.isError ? (
          <InlineNotice tone="danger">{(panel.error as Error)?.message || "This task’s details couldn’t be loaded."}</InlineNotice>
        ) : !data ? (
          <p className="text-ui text-fg-muted" data-task-panel-unavailable>This task’s details aren’t available to you.</p>
        ) : (
          <div className="space-y-5">
            {data.description && <Description text={data.description} />}
            {(data.fields?.length ?? 0) > 0 && <Fields fields={data.fields!} />}
            <Progress data={data} />
            {data.subtasks.total > 0 && <Subtasks data={data} />}
            <Activity data={data} />
            {data.readOnlyReason && <p className="text-xs text-fg-muted" data-task-panel-readonly>{data.readOnlyReason}</p>}
          </div>
        )}
      </div>
      <QuickViewFooter task={task} data={data ?? null} info={actions.data ?? null} loading={actions.isPending} />
    </>
  )
}

/* ── Header ──────────────────────────────────────────────────────────── */

function QuickViewHeader({ title, data, loading, onClose }: { title: string; data: TaskPanelData | null; loading: boolean; onClose: () => void }) {
  const [full, setFull] = useState(false)
  const long = title.length > 90
  const overdue = !!(data?.due_date && !data.closed && new Date(data.due_date) < new Date())
  const context = [data?.subtitle, data?.team ? `${data.team} team` : null].filter(Boolean).join(" · ")
  return (
    <header className={cn("shrink-0 space-y-3 border-b border-border-subtle pb-4 pt-4", PAD)} data-task-drawer-header>
      <div className="flex items-center gap-2">
        {data ? <StatusPill status={data.status} /> : loading ? <Skeleton className="h-5 w-20 rounded-full" /> : null}
        {data?.priority && data.priority !== "none" && <PriorityBadge priority={data.priority} />}
        <span className="flex-1" />
        {data && (
          <Tooltip content="Open the task page">
            <Link href={data.links.task} className="inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]" aria-label="Open the task page" data-task-drawer-open>
              <ExternalLink className="size-4" aria-hidden />
            </Link>
          </Tooltip>
        )}
        <RadixDialog.Close asChild><IconButton label="Close" icon={<X />} size="sm" noTooltip onClick={onClose} /></RadixDialog.Close>
      </div>
      <div className="space-y-1">
        <RadixDialog.Title className={cn("text-lg font-semibold leading-snug text-fg [overflow-wrap:anywhere]", !full && "line-clamp-2")} title={title} data-task-drawer-title>{title}</RadixDialog.Title>
        {long && <button type="button" onClick={() => setFull(!full)} className="text-xs font-medium text-primary-text hover:underline">{full ? "Show less" : "Show full title"}</button>}
        {context && <p className="truncate text-ui text-fg-muted">{context}</p>}
      </div>
      <dl className="grid grid-cols-3 gap-x-4 gap-y-2 max-sm:grid-cols-2" data-task-panel-summary>
        <Meta label="Due">
          {data?.due_date ? (
            <Tooltip content={formatAbsolute(data.due_date)}>
              <span tabIndex={0} className={cn("num inline-flex items-center gap-1 rounded outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-primary)]", overdue ? "font-semibold text-danger" : "text-fg")} data-task-drawer-due={overdue ? "overdue" : "ok"}>
                {overdue && <Clock className="size-3.5" aria-hidden />}{formatDay(data.due_date)}
                <span className={cn("font-normal", overdue ? "text-danger" : "text-fg-muted")}>· {formatRelative(data.due_date)}</span>
                {overdue && <span className="sr-only"> (overdue)</span>}
              </span>
            </Tooltip>
          ) : <span className="text-fg-subtle">{loading ? "…" : "No due date"}</span>}
        </Meta>
        <Meta label="Assignee"><Person name={data?.assignee?.name ?? (data?.team ? `${data.team} team` : null)} fallback={loading ? "…" : "Unassigned"} /></Meta>
        <Meta label="Requester"><Person name={data?.requester?.name ?? null} fallback={loading ? "…" : "—"} /></Meta>
      </dl>
    </header>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-1 min-w-0 truncate text-ui">{children}</dd>
    </div>
  )
}

function Person({ name, fallback }: { name: string | null; fallback: string }) {
  if (!name) return <span className="text-fg-subtle">{fallback}</span>
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5"><Avatar name={name} size="sm" /><span className="truncate text-fg" title={name}>{name}</span></span>
}

/* ── Body ────────────────────────────────────────────────────────────── */

function Section({ title, aside, children, ...props }: { title: string; aside?: React.ReactNode; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  return (
    <section aria-label={title} className="space-y-2" {...props}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Description({ text }: { text: string }) {
  const [more, setMore] = useState(false)
  const long = text.length > 320 || text.split("\n").length > 4
  return (
    <Section title="Summary" data-task-drawer-description>
      <p className={cn("max-w-[70ch] whitespace-pre-line text-ui leading-relaxed text-fg", !more && long && "line-clamp-4")}>{text}</p>
      {long && (
        <button type="button" onClick={() => setMore(!more)} className="inline-flex items-center gap-0.5 text-xs font-medium text-primary-text hover:underline" aria-expanded={more}>
          {more ? <>Show less <ChevronUp className="size-3.5" aria-hidden /></> : <>Show more <ChevronDown className="size-3.5" aria-hidden /></>}
        </button>
      )}
    </Section>
  )
}

function fieldValue(f: NonNullable<TaskPanelData["fields"]>[number]): string {
  const v = f.value
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (Array.isArray(v)) return v.join(", ")
  if (typeof v === "number") return formatCount(v, { maxFractionDigits: 2 })
  if ((f.type === "date" || f.type === "datetime") && !Number.isNaN(Date.parse(v))) return f.type === "date" ? formatDay(v) : formatAbsolute(v)
  if ((f.type === "number" || f.type === "currency") && v.trim() !== "" && Number.isFinite(Number(v))) return formatCount(Number(v), { maxFractionDigits: 2 })
  return v
}

function Fields({ fields }: { fields: NonNullable<TaskPanelData["fields"]> }) {
  return (
    <Section title="Details" data-task-drawer-fields>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border-subtle bg-panel p-3 max-sm:grid-cols-1">
        {fields.map((f) => {
          const value = fieldValue(f)
          const wide = f.type === "textarea" || value.length > 48
          return (
            <div key={f.key} className={cn("min-w-0", wide && "col-span-2 max-sm:col-span-1")}>
              <dt className="text-xs text-fg-muted">{f.label}</dt>
              <dd className={cn("mt-0.5 text-ui text-fg [overflow-wrap:anywhere]", (f.type === "number" || f.type === "currency") && "num")}>{value}</dd>
            </div>
          )
        })}
      </dl>
    </Section>
  )
}

function Progress({ data }: { data: TaskPanelData }) {
  const { loggedMinutes, estimateMinutes } = data.effort
  return (
    <Section title="Progress" aside={<span className="num text-xs text-fg-muted">{data.progress.pct}%</span>} data-task-panel-progress>
      <ProgressBar value={data.progress.pct} label="Task progress" />
      <p className="num text-xs text-fg-muted">
        {data.subtasks.total > 0 ? `${data.subtasks.completed} of ${plural(data.subtasks.total, "subtask")} done · ` : ""}
        {formatMinutes(loggedMinutes)} logged{estimateMinutes ? ` of ${formatMinutes(estimateMinutes)} estimated` : ""}
      </p>
    </Section>
  )
}

function Subtasks({ data }: { data: TaskPanelData }) {
  const items = data.subtasks.items.slice(0, 5)
  return (
    <Section title="Subtasks" aside={<span className="num text-xs text-fg-muted">{data.subtasks.completed}/{data.subtasks.total}</span>} data-task-panel-subtasks>
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {items.map((s) => (
          <li key={s.id} className="flex items-center gap-2 px-3 py-2">
            <StatusPill status={s.status} />
            <Link href={`/tasks/${s.id}`} className={cn("min-w-0 flex-1 truncate text-ui hover:underline", s.status === "completed" ? "text-fg-muted line-through" : "text-fg")} title={s.title}>{s.title || "Untitled task"}</Link>
            {s.due_date && <span className="num shrink-0 text-xs text-fg-muted">{formatDay(s.due_date)}</span>}
          </li>
        ))}
      </ul>
      {data.subtasks.total > items.length && <Link href={data.links.task} className="text-xs font-medium text-primary-text hover:underline">View all {data.subtasks.total} subtasks</Link>}
    </Section>
  )
}

function Activity({ data }: { data: TaskPanelData }) {
  return (
    <Section title={data.latest?.kind === "comment" ? "Latest comment" : "Activity"} data-task-panel-latest>
      {data.latest ? (
        <div className="flex items-start gap-2.5">
          <Avatar name={data.latest.by ?? "System"} size="sm" />
          <div className="min-w-0">
            <p className="text-ui text-fg"><span className="font-medium">{data.latest.by ?? "System"}</span> <span className="text-fg-muted">· <RelativeTime at={data.latest.at} /></span></p>
            <p className="line-clamp-3 text-ui text-fg-muted">{data.latest.text}</p>
          </div>
        </div>
      ) : <p className="text-ui text-fg-muted">No activity yet{data.created_at ? ` — created ${formatRelative(data.created_at)}` : ""}.</p>}
    </Section>
  )
}

/* ── Footer: the task's real actions ─────────────────────────────────── */

/** An outcome as a button verb: approved → Approve, rejected → Reject, sent_back → Send back. */
export function outcomeVerb(outcome: string): string {
  const o = outcome.toLowerCase()
  const known: Record<string, string> = { completed: "Complete", approved: "Approve", rejected: "Reject", declined: "Decline", denied: "Deny", returned: "Return", accepted: "Accept", cancelled: "Cancel", sent_back: "Send back", escalated: "Escalate", reviewed: "Mark reviewed", signed: "Sign" }
  return known[o] ?? outcomeLabel(outcome)
}

const NEGATIVE = /^(reject|rejected|decline|declined|deny|denied|return|returned|cancel|cancelled|send_back|sent_back)$/i

function QuickViewFooter({ task, data, info, loading }: { task: { id: string; title: string; action?: "accept" | "claim" }; data: TaskPanelData | null; info: TaskQuickActionsInfo | null; loading: boolean }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState("")
  const [noting, setNoting] = useState(false)
  const [more, setMore] = useState(false)
  const [message, setMessage] = useState<{ tone: "success" | "info" | "warning" | "danger"; text: string } | null>(null)
  const [timeline, setTimeline] = useState(false)
  const title = data?.title ?? task.title

  const refresh = async () => {
    await Promise.all([
      ...QUICK_ACTION_REFRESH_KEYS.map((k) => queryClient.invalidateQueries({ queryKey: [...k] })),
      ...TASK_PANEL_REFRESH_KEYS.map((k) => queryClient.invalidateQueries({ queryKey: [...k] })),
      queryClient.invalidateQueries({ queryKey: ["apps", "widget"] }),
      queryClient.invalidateQueries({ queryKey: ["apps", "badges"] }),
    ])
  }
  const outcome = async (o: string) => {
    if (!info) return
    setBusy(o); setMessage(null)
    try {
      const result = await runQuickAction({ kind: "outcome", taskId: task.id, title, workflow: info.workflow, outcome: o, comment: note })
      setMessage({ tone: result.tone, text: result.text })
      if (result.done) { setNote(""); setNoting(false); await refresh() }
    } catch (e) {
      setMessage({ tone: "danger", text: e instanceof Error ? e.message : "That didn’t work" })
    }
    setBusy(null)
  }

  const queued = task.action ?? null
  const claimFirst = queued === "claim"
  const primary = (() => {
    if (loading) return <div className="flex gap-2"><Skeleton className="h-8 w-28" /><Skeleton className="h-8 w-24" /></div>
    if (!info) return null
    if (info.closed) return <p className="text-ui text-fg-muted">This task is closed{data?.status ? ` (${data.status.replace(/_/g, " ")})` : ""}.</p>
    if (queued) return <QueuedTaskActions task={{ id: task.id, title }} action={queued} onDone={(m) => { setMessage({ tone: "success", text: m }); void refresh() }} />
    if (info.completeVia === "quick") {
      const ordered = [...info.outcomes].sort((a, b) => Number(NEGATIVE.test(a)) - Number(NEGATIVE.test(b)))
      return (
        <div className="flex flex-wrap items-center gap-2" data-task-drawer-outcomes>
          {ordered.map((o, i) => {
            const negative = NEGATIVE.test(o)
            return (
              <Button key={o} size="sm" variant={negative ? "secondary" : i === 0 ? "primary" : "secondary"} leadingIcon={negative ? <X /> : <Check />} loading={busy === o} disabled={busy !== null}
                onClick={() => void outcome(o)} data-quick-outcome={o}>
                {outcomeVerb(o)}
              </Button>
            )
          })}
          <Button size="sm" variant="ghost" leadingIcon={<MessageSquare />} aria-pressed={noting} onClick={() => setNoting(!noting)} data-task-drawer-note-toggle>{noting ? "No note" : "Add a note"}</Button>
        </div>
      )
    }
    if (info.completeVia === "form") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" leadingIcon={<ClipboardList />}><Link href={info.formHref}>Open form to complete</Link></Button>
          {info.completeNote && <span className="text-xs text-fg-muted">{info.completeNote}</span>}
        </div>
      )
    }
    if (info.completeVia === "task") {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" variant="secondary" leadingIcon={<ExternalLink />}><Link href={info.taskHref}>Open task to act</Link></Button>
          {info.completeNote && <span className="text-xs text-fg-muted">{info.completeNote}</span>}
        </div>
      )
    }
    return info.completeNote ? <p className="text-xs text-fg-muted">{info.completeNote}</p> : null
  })()

  return (
    <footer className={cn("shrink-0 space-y-3 border-t border-border-subtle bg-elevated pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3", PAD)} data-task-drawer-footer>
      {more && info && !info.closed && !claimFirst && (
        <div className="max-h-[45dvh] overflow-y-auto rounded-lg border border-border-subtle bg-subtle p-3" data-task-drawer-more>
          <TaskQuickActionsPanel taskId={task.id} title={title} onDone={(m) => { setMessage({ tone: "success", text: m }); void refresh() }} onClose={() => setMore(false)} />
        </div>
      )}
      {noting && <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note with your response (optional)" aria-label="Note with your response" autoFocus />}
      {message && <InlineNotice tone={message.tone} onDismiss={() => setMessage(null)}>{message.text}</InlineNotice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">{primary}</div>
        {info && !info.closed && !claimFirst && (
          <Button size="sm" variant="ghost" leadingIcon={more ? <ChevronDown /> : <MoreHorizontal />} aria-expanded={more} onClick={() => setMore(!more)} data-task-drawer-more-toggle>
            {more ? "Fewer actions" : "More actions"}
          </Button>
        )}
      </div>
      <nav aria-label="Task links" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs" data-task-panel-links>
        <FooterLink href={data?.links.task ?? `/tasks/${task.id}`} icon={<ExternalLink />} data-task-panel-open>Open task</FooterLink>
        {data?.links.form && <FooterLink href={data.links.form} icon={<ClipboardList />} data-task-panel-form>Open form</FooterLink>}
        {data?.links.process && <FooterLink href={data.links.process} icon={<Workflow />} data-task-panel-process>Process view</FooterLink>}
        {data?.links.process && (
          <button type="button" onClick={() => setTimeline(true)} className="inline-flex items-center gap-1 font-medium text-fg-muted hover:text-fg hover:underline [&_svg]:size-3.5" data-task-panel-timeline><History aria-hidden /> Timeline</button>
        )}
        {data && <FooterLink href={`${data.links.task}?tab=attachments`} icon={<Paperclip />} data-task-panel-attachments>{data.attachments ? plural(data.attachments, "attachment") : "Attachments"}</FooterLink>}
        {busy && <Loader2 className="size-3.5 text-fg-muted motion-safe:animate-spin" aria-hidden />}
      </nav>
      {timeline && <span className="contents" onClick={(e) => e.stopPropagation()}><TimelineSheet target={{ taskId: task.id }} open={timeline} onOpenChange={setTimeline} /></span>}
      <span className="sr-only" aria-live="polite">{message?.text ?? ""}</span>
    </footer>
  )
}

function FooterLink({ href, icon, children, ...props }: { href: string; icon: React.ReactNode; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 font-medium text-fg-muted hover:text-fg hover:underline [&_svg]:size-3.5" {...props}>
      {icon}{children}
    </Link>
  )
}
