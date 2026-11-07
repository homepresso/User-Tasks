"use client"

import { useState } from "react"
import Link from "next/link"
import { ArrowRight, Clock, FileText } from "lucide-react"
import { Avatar } from "@/components/ui/avatar"
import { Badge, type Tone } from "@/components/ui/badge"
import { Tooltip } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatAbsolute, formatRelative } from "@/lib/format/date"
import {
  RUN_TASK_PERSON_STATUS_LABEL, runOutcomeLabel, runOutcomeTone, runTaskAllNames, runTaskWho,
  type RunTask, type RunTaskHistoryEntry, type RunTaskPerson,
} from "@/lib/run-tasks"

/*
 * The Process view's task links, people and step history (both surfaces:
 * the full run view and Home's run progress). Everything here is decided by
 * the server (lib/services/run-tasks.ts): a task only has an href / title /
 * outcomes / comments when the viewer may open it; the task page and its
 * actions re-check on every request.
 */

function Ago({ at }: { at: string | null | undefined }) {
  if (!at) return null
  return (
    <Tooltip content={formatAbsolute(at)}>
      <time dateTime={at} tabIndex={0} className="num whitespace-nowrap">{formatRelative(at)}</time>
    </Tooltip>
  )
}

/** "Open task — Approve invoice · assigned to Priya Nair" (+ the on-behalf hint). */
export function openTaskLabel(task: RunTask): string {
  const base = `Open task — ${task.title ?? task.step_name} · assigned to ${runTaskAllNames(task)}`
  if (task.can_act === "on_behalf" && task.on_behalf_of) return `${base} · you can act on behalf of ${task.on_behalf_of.name}`
  return base
}

/**
 * The form icon that opens a waiting task (form tab when it has a form), or
 * — for a viewer who may not open it (e.g. the run's requester) — a
 * non-actionable "Waiting for {name}".
 */
export function RunTaskOpenLink({ task, showWaitingText = true, className }: { task: RunTask; showWaitingText?: boolean; className?: string }) {
  if (!task.open) return null
  if (task.can_open && task.href) {
    const label = openTaskLabel(task)
    return (
      <Tooltip content={label}>
        <Link
          href={task.href}
          aria-label={label}
          data-open-task={task.id}
          data-can-act={task.can_act}
          onClick={(e) => e.stopPropagation()}
          className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-panel text-primary-text hover:bg-subtle focus-visible:outline-2 focus-visible:outline-primary", className)}
        >
          <FileText className="size-3.5" aria-hidden />
        </Link>
      </Tooltip>
    )
  }
  if (!showWaitingText) return null
  return (
    <span data-waiting-for={task.id} className={cn("inline-flex items-center gap-1 text-xs text-fg-muted", className)}>
      <Clock className="size-3.5" aria-hidden /> Waiting for {runTaskWho(task)}
    </span>
  )
}

const PERSON_TONE: Record<RunTaskPerson["status"], Tone> = {
  queued: "neutral", in_progress: "info", on_hold: "warning", done: "success", declined: "danger", closed: "neutral",
}

/** Avatars + "Priya Nair +2" (all names and statuses in the tooltip); the team or "Unassigned" when nobody. */
export function RunTaskPeople({ task, showStatus = true, size = "sm" }: { task: RunTask; showStatus?: boolean; size?: "sm" | "md" }) {
  if (!task.assignees.length) {
    return <span data-task-people={task.id} className="text-xs text-fg-muted">{task.team ?? "Unassigned"}</span>
  }
  const shown = task.assignees.slice(0, 3)
  const detail = task.assignees.map((a) => `${a.name}${a.role === "candidate" ? " (can claim)" : ""} — ${RUN_TASK_PERSON_STATUS_LABEL[a.status]}`).join("\n")
  const single = task.assignees.length === 1 ? task.assignees[0] : null
  return (
    <Tooltip content={<span className="whitespace-pre-line">{detail}</span>}>
      <span data-task-people={task.id} tabIndex={0} className="inline-flex min-w-0 items-center gap-1.5 text-xs">
        <span className="flex -space-x-1.5">
          {shown.map((a) => <Avatar key={a.id} name={a.name} src={a.avatar_url} size={size} ring />)}
        </span>
        <span className="truncate font-medium text-fg">{runTaskWho(task)}</span>
        {showStatus && single && (
          <Badge tone={PERSON_TONE[single.status]} pill className="shrink-0">{RUN_TASK_PERSON_STATUS_LABEL[single.status]}</Badge>
        )}
      </span>
    </Tooltip>
  )
}

function Comment({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const long = text.length > 140
  return (
    <p className="mt-0.5 whitespace-pre-line break-words text-xs text-fg-muted" data-history-comment>
      “{long && !expanded ? `${text.slice(0, 140).trimEnd()}…` : text}”
      {long && (
        <button type="button" className="ml-1 text-primary-text hover:underline" onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}>
          {expanded ? "Less" : "More"}
        </button>
      )}
    </p>
  )
}

function HistoryLine({ entry }: { entry: RunTaskHistoryEntry }) {
  const who = entry.actor?.name ?? "Someone"
  if (entry.kind === "redirected" || entry.kind === "reassigned" || entry.kind === "escalated") {
    const verb = entry.kind === "redirected" ? "Redirected" : entry.kind === "reassigned" ? "Reassigned" : "Escalated"
    return (
      <li className="text-xs text-fg-muted" data-history-kind={entry.kind}>
        <span className="inline-flex flex-wrap items-center gap-1">
          <ArrowRight className="size-3" aria-hidden />
          {verb}{entry.from.length ? <> from <span className="text-fg">{entry.from.join(", ")}</span></> : null}
          {entry.to.length ? <> to <span className="text-fg">{entry.to.join(", ")}</span></> : null}
          {entry.kind !== "redirected" && entry.actor ? <> by {who}</> : null}
          <span>· <Ago at={entry.at} /></span>
        </span>
        {entry.comment && <Comment text={entry.comment} />}
      </li>
    )
  }
  return (
    <li className="flex items-start gap-2" data-history-kind={entry.kind}>
      {entry.actor ? <Avatar name={entry.actor.name} src={entry.actor.avatar_url} size="sm" /> : <span className="size-6 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 text-xs">
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-medium text-fg">{who}</span>
          {entry.on_behalf_of && <span className="text-fg-muted">on behalf of {entry.on_behalf_of.name}</span>}
          {entry.kind === "declined"
            ? <Badge tone="danger" pill>Declined</Badge>
            : entry.outcome
              ? <Badge tone={runOutcomeTone(entry.outcome)} pill dot>{runOutcomeLabel(entry.outcome)}</Badge>
              : <span className="text-fg-muted">{entry.kind === "response" ? "responded" : "completed"}</span>}
          <span className="text-fg-muted">· <Ago at={entry.at} /></span>
        </p>
        {entry.comment && <Comment text={entry.comment} />}
      </div>
    </li>
  )
}

/** A step's history: every response (who, on behalf of whom, outcome, when, comment) and redirects / escalations. */
export function RunTaskHistory({ task }: { task: RunTask }) {
  if (!task.history.length) {
    if (task.status === "completed" && task.completed_by) {
      return (
        <p className="text-xs text-fg-muted" data-task-history={task.id}>
          Completed by <span className="font-medium text-fg">{task.completed_by.name}</span>
          {task.completed_on_behalf_of ? <> on behalf of {task.completed_on_behalf_of.name}</> : null} · <Ago at={task.completed_at} />
        </p>
      )
    }
    return null
  }
  return <ul className="space-y-1.5" data-task-history={task.id}>{task.history.map((h, i) => <HistoryLine key={i} entry={h} />)}</ul>
}

/** One task of a step: people (with status), the open link, and its history. */
export function RunTaskCard({ task, history = true }: { task: RunTask; history?: boolean }) {
  return (
    <div className="space-y-1.5" data-run-task={task.id} data-task-status={task.status}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1"><RunTaskPeople task={task} /></div>
        {task.open
          ? <RunTaskOpenLink task={task} showWaitingText={false} />
          : task.status === "cancelled" ? <Badge tone="neutral" pill>Closed</Badge> : null}
      </div>
      {task.open && task.waiting_since && (
        <p className="text-xs text-fg-muted">Waiting since <Ago at={task.waiting_since} />{!task.can_open ? <> · for {runTaskWho(task)}</> : null}</p>
      )}
      {history && <RunTaskHistory task={task} />}
    </div>
  )
}

/** Every task of one step (newest last), for step details panels. */
export function RunStepTasks({ tasks, nodeId }: { tasks: readonly RunTask[]; nodeId: string }) {
  const mine = tasks.filter((t) => t.node_id === nodeId)
  if (!mine.length) return null
  return (
    <div className="space-y-3" data-step-tasks={nodeId}>
      {mine.map((t) => <RunTaskCard key={t.id} task={t} />)}
    </div>
  )
}

/**
 * Compact line drawn above a User Task card on the run canvas: who has it
 * (or who completed it) and, while it waits, the open icon.
 */
export function RunStepBadge({ tasks }: { tasks: readonly RunTask[] }) {
  if (!tasks.length) return null
  const open = tasks.filter((t) => t.open)
  const latest = tasks[tasks.length - 1]
  const focus = open[0] ?? latest
  return (
    <div className="pointer-events-auto inline-flex max-w-[260px] items-center gap-1.5 rounded-full border border-border bg-panel px-1.5 py-0.5 shadow-elev-1" data-step-badge={focus.node_id ?? ""}>
      {open.length ? <RunTaskPeople task={focus} showStatus={false} /> : focus.completed_by ? (
        <span className="inline-flex min-w-0 items-center gap-1 text-xs">
          <Avatar name={focus.completed_by.name} src={focus.completed_by.avatar_url} size="sm" />
          <span className="truncate text-fg">{focus.completed_by.name}</span>
        </span>
      ) : <RunTaskPeople task={focus} showStatus={false} />}
      {open.map((t) => <RunTaskOpenLink key={t.id} task={t} showWaitingText={false} className="size-5" />)}
    </div>
  )
}

/** Node id → canvas adornment, for every step with tasks. */
export function runStepBadges(tasks: readonly RunTask[] | null | undefined): Record<string, React.ReactNode> {
  const byNode = new Map<string, RunTask[]>()
  for (const t of tasks ?? []) if (t.node_id) byNode.set(t.node_id, [...(byNode.get(t.node_id) ?? []), t])
  return Object.fromEntries([...byNode].map(([nodeId, list]) => [nodeId, <RunStepBadge key={nodeId} tasks={list} />]))
}

/** Header chip: "Waiting at: {step} · {who}" with the open icon (one per waiting task). */
export function RunWaitingChip({ tasks }: { tasks: readonly RunTask[] | null | undefined }) {
  const open = (tasks ?? []).filter((t) => t.open)
  if (!open.length) return null
  return (
    <div className="flex flex-wrap items-center gap-2" data-waiting-chip>
      {open.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-panel py-0.5 pl-2.5 pr-1 text-xs text-fg">
          <span>Waiting at: <span className="font-medium">{t.step_name}</span> · {runTaskWho(t)}</span>
          {t.can_open ? <RunTaskOpenLink task={t} className="size-5" /> : <Clock className="mr-1 size-3.5 text-fg-muted" aria-label={`Waiting for ${runTaskWho(t)}`} />}
        </span>
      ))}
    </div>
  )
}

/**
 * The run's User Tasks step by step (oldest first): the step, its state,
 * who has it / who completed it, the open icon while it waits, and its
 * history. `onFocusStep` makes the step name show it on the canvas.
 */
export function RunTaskSteps({ tasks, onFocusStep }: { tasks: readonly RunTask[]; onFocusStep?: (nodeId: string) => void }) {
  const groups: Array<{ key: string; nodeId: string | null; name: string; tasks: RunTask[] }> = []
  for (const t of tasks) {
    const key = t.node_id ?? `task:${t.id}`
    const last = groups[groups.length - 1]
    // Consecutive tasks of the same step (multi-assignee, loops back) stay together.
    if (last && last.key === key) last.tasks.push(t)
    else groups.push({ key, nodeId: t.node_id, name: t.step_name, tasks: [t] })
  }
  return (
    <ol className="space-y-3" data-run-task-steps>
      {groups.map((g, i) => {
        const open = g.tasks.some((t) => t.open)
        const done = g.tasks.every((t) => t.status === "completed")
        return (
          <li key={`${g.key}-${i}`} className="rounded-md border border-border-subtle px-3 py-2" data-run-step={g.nodeId ?? ""}>
            <div className="mb-1.5 flex items-center gap-2">
              <span className={cn("inline-block size-2 shrink-0 rounded-full", open ? "bg-warning" : done ? "bg-success" : "bg-fg-subtle")} aria-hidden />
              {g.nodeId && onFocusStep
                ? <button type="button" className="truncate text-ui font-medium text-fg hover:underline" onClick={() => onFocusStep(g.nodeId!)}>{g.name}</button>
                : <span className="truncate text-ui font-medium text-fg">{g.name}</span>}
              <span className="text-xs text-fg-muted">{open ? "Waiting" : done ? "Completed" : "Closed"}</span>
            </div>
            <div className="space-y-2.5">
              {g.tasks.map((t) => <RunTaskCard key={t.id} task={t} />)}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
