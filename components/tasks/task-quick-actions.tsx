"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowUpRight, Check, ChevronDown, ClipboardList, CornerDownRight, ExternalLink, MessageSquare, Pause, Play, UserPlus, Workflow, Zap,
} from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field } from "@/components/ui/field"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Input, SearchInput } from "@/components/ui/input"
import { AutocompleteSelect } from "@/components/ui/autocomplete-select"
import { SegmentedControl } from "@/components/ui/segmented-control"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { DialogBody } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip } from "@/components/ui/tooltip"
import { useSubmitGuard } from "@/hooks/use-submit-guard"
import { TaskInviteControls } from "./invite-viewers"
import { usePermissions } from "@/lib/permissions-context"
import { serverQuery } from "@/lib/server-read"
import type { TaskQuickActionsInfo } from "@/lib/tasks/quick-actions"
import type { QueueAction } from "@/lib/tasks/unified-list"
import { cn } from "@/lib/utils"
import { outcomeLabel } from "./task-outcome-dialog"
import { QueuedTaskActions } from "./queued-task-actions"

/**
 * Quick actions on the task lists (Home My tasks, /tasks): a per-row
 * "Actions" toggle that opens an inline panel under the row (desktop) or a
 * bottom sheet (phones). The panel reads what this person may do
 * (`tasks.quickActions`, lib/tasks/quick-actions.ts — the server's own rules)
 * and calls the existing server actions: completeWorkflowTask /
 * completeTaskWithOutcome, respondToTask, rerouteTask (redirect, escalate)
 * and inviteToTask. Accept / Decline / Claim stay QueuedTaskActions.
 */

/** Query keys refreshed after an action: the task lists, Home, the task page and notifications. */
export const QUICK_ACTION_REFRESH_KEYS = [["tasks"], ["home"], ["task-detail"], ["task-tree"], ["notifications"]] as const

export function quickActionsQueryKey(taskId: string) {
  return ["tasks", "quick-actions", taskId] as const
}

/** "Process view": where a workflow task's request is in its process (the run). */
export function processViewHref(runId: string, canViewRuns: boolean): string {
  return canViewRuns ? `/automations/runs/${runId}` : `/home/runs/${runId}`
}

/** The row's small Process view icon (workflow tasks). */
export function ProcessViewIconLink({ runId, title }: { runId: string; title: string }) {
  const { can } = usePermissions()
  return (
    <Tooltip content="Process view — see where this request is in the process">
      <Link href={processViewHref(runId, can("workflows.view_runs"))} aria-label={`Process view: ${title}`}
        className={buttonVariants({ variant: "ghost", size: "icon-sm" })} data-process-view={runId}
        onClick={(e) => e.stopPropagation()}>
        <Workflow className="size-3.5" aria-hidden="true" />
      </Link>
    </Tooltip>
  )
}

/** The row's Actions toggle (aria-expanded / aria-controls the panel). */
export function TaskQuickActionsToggle({ open, onToggle, controls, title, className }: {
  open: boolean
  onToggle: () => void
  controls: string
  title: string
  className?: string
}) {
  return (
    <Button type="button" size="sm" variant={open ? "secondary" : "ghost"} aria-expanded={open} aria-controls={open ? controls : undefined}
      aria-label={`Actions: ${title}`} onClick={(e) => { e.stopPropagation(); onToggle() }} className={cn("gap-1 px-2", className)}
      leadingIcon={<Zap />} trailingIcon={<ChevronDown className={cn("transition-transform duration-[var(--ds-dur-fast)]", open && "rotate-180")} />}
      data-quick-actions-toggle>
      <span className="@max-2xl:sr-only">Actions</span>
    </Button>
  )
}

interface PanelProps {
  taskId: string
  title: string
  /** The list's queue action (Accept / Decline or Claim first). */
  queueAction?: QueueAction | null
  /** After a successful action: a status message for the list (the row may leave it). */
  onDone?: (message: string) => void
  /** Close the panel / sheet. */
  onClose?: () => void
}

/** Desktop: the inline panel under a row. Phones: the same panel in a bottom sheet. */
export function TaskQuickActions({ id, open, onOpenChange, mobile, ...props }: PanelProps & {
  id: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Render as a bottom sheet (phones). */
  mobile: boolean
}) {
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" title="Actions" description={props.title} id={id} data-quick-actions-sheet>
          <DialogBody className="overflow-y-auto">
            <TaskQuickActionsPanel {...props} onClose={() => onOpenChange(false)} />
          </DialogBody>
        </SheetContent>
      </Sheet>
    )
  }
  if (!open) return null
  return (
    <div id={id} role="region" aria-label={`Actions: ${props.title}`} className="border-t border-border-subtle bg-subtle px-4 py-3"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("[role='dialog'], [role='listbox']")) onOpenChange(false) }}
      data-quick-actions-panel={props.taskId}>
      <TaskQuickActionsPanel {...props} onClose={() => onOpenChange(false)} />
    </div>
  )
}

type Mode = null | "hold" | "redirect" | "escalate" | "invite" | "comment"
type Person = { id: string; display_name: string | null; email: string | null }

/** Email addresses typed one per line (or comma / semicolon separated). */
export function parseEmails(text: string): string[] {
  return text.split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean)
}

/**
 * The open form's problem before sending, or null. Mirrors the server: a
 * hold needs a reason (respondToTask), redirect / escalate / invite need
 * someone, within the task's recipient cap.
 */
export function quickFormError({ mode, comment, chosen, limit }: { mode: Exclude<Mode, null>; comment: string; chosen: number; limit: number | null }): string | null {
  if (mode === "hold") return comment.trim() ? null : "Add a reason for putting this task on hold."
  if (mode === "comment") return comment.trim() ? null : "Write a comment first."
  if (!chosen) return mode === "escalate" ? "Choose who to escalate to." : "Choose someone first."
  if (limit !== null && chosen > limit) return `Choose up to ${limit} ${limit === 1 ? "person" : "people"}.`
  return null
}

export type QuickAction =
  | { kind: "outcome"; taskId: string; title: string; workflow: boolean; outcome: string; comment?: string }
  | { kind: "hold"; taskId: string; title: string; comment: string }
  | { kind: "resume"; taskId: string; title: string }
  | { kind: "escalate"; taskId: string; personId: string; personName?: string | null; comment?: string }
  | { kind: "invite"; taskId: string; userIds?: string[]; emails?: string[]; comment?: string }
  | { kind: "redirect"; taskId: string; many: boolean; personId?: string; personName?: string | null; userIds?: string[]; emails?: string[]; comment?: string }

export interface QuickActionResult {
  /** The action happened (refresh the lists); false: nothing changed (e.g. the form needs attention). */
  done: boolean
  tone: "success" | "info" | "warning"
  text: string
}

/**
 * Run one quick action through the existing server actions and describe the
 * result ("Redirected to Priya Nair", the multi-response waiting message…).
 * Throws the server's error.
 */
export async function runQuickAction(action: QuickAction): Promise<QuickActionResult> {
  const note = action.kind !== "resume" ? (action.comment?.trim() || undefined) : undefined
  switch (action.kind) {
    case "outcome": {
      const { taskId, title, outcome } = action
      if (action.workflow) {
        const { completeWorkflowTask } = await import("@/app/actions/task-queue")
        const result = await completeWorkflowTask(taskId, outcome, note)
        if (result.status === "error") throw new Error(result.error)
        if (result.status === "invalid") return { done: false, tone: "warning", text: "Some of the task’s fields need attention — open the form to complete it." }
        if (result.status === "waiting") return { done: true, tone: "info", text: `Response recorded — waiting for more responses (${result.responses} of ${result.needed}).` }
        if (result.status === "completed" && result.workflowResumed === false) {
          return { done: true, tone: "warning", text: `“${title}” completed, but its process didn’t continue: ${result.workflowError ?? "unknown error"}. An administrator can resume it from the run.` }
        }
      } else {
        const { completeTaskWithOutcome } = await import("@/app/actions/tasks")
        const result = await completeTaskWithOutcome(taskId, outcome, note ?? null)
        if (!result.ok) throw new Error(result.error)
      }
      return { done: true, tone: "success", text: outcome === "completed" ? `Completed “${title}”.` : `“${title}”: ${outcomeLabel(outcome)}.` }
    }
    case "hold": {
      if (!action.comment.trim()) throw new Error("Add a reason for putting this task on hold.")
      const { respondToTask } = await import("@/app/actions/task-queue")
      const result = await respondToTask(action.taskId, "held", action.comment.trim())
      if (!result.success) throw new Error(result.error)
      return { done: true, tone: "success", text: `Put “${action.title}” on hold.` }
    }
    case "resume": {
      const { respondToTask } = await import("@/app/actions/task-queue")
      const result = await respondToTask(action.taskId, "accepted")
      if (!result.success) throw new Error(result.error)
      return { done: true, tone: "success", text: `Resumed “${action.title}”.` }
    }
    case "escalate": {
      const { rerouteTask } = await import("@/app/actions/task-queue")
      const result = await rerouteTask(action.taskId, "escalate", { targetUserId: action.personId, comment: note })
      const name = result.targetUserName ?? action.personName
      return { done: true, tone: "success", text: name ? `Escalated to ${name}.` : "Task escalated." }
    }
    case "invite": {
      const { inviteToTask } = await import("@/app/actions/task-queue")
      const result = await inviteToTask(action.taskId, action.emails?.length ? { emails: action.emails, comment: note } : { userIds: action.userIds ?? [], comment: note })
      return { done: true, tone: result.addedNames.length ? "success" : "info", text: result.message }
    }
    case "redirect": {
      const { rerouteTask } = await import("@/app/actions/task-queue")
      const byEmail = !!action.emails?.length
      const result = await rerouteTask(action.taskId, "redirect", action.many
        ? (byEmail ? { targetEmails: action.emails, inviteIfNeeded: true, comment: note } : { targetUserIds: action.userIds ?? [], comment: note })
        : (byEmail ? { targetEmail: action.emails![0], inviteIfNeeded: true, comment: note } : { targetUserId: action.personId, comment: note }))
      const r = result as { invited?: boolean; redirected?: boolean; message?: string; targetUserName?: string | null; targetUserNames?: string[] }
      if (r.invited && !r.redirected) return { done: true, tone: "info", text: r.message ?? "Invitation sent. The task stays with you until they join." }
      const names = r.targetUserNames?.length ? r.targetUserNames.join(", ") : r.targetUserName ?? (action.many ? null : action.personName)
      return { done: true, tone: "success", text: names ? `Redirected to ${names}.` : "Task redirected." }
    }
  }
}

export function TaskQuickActionsPanel({ taskId, title, queueAction = null, onDone, onClose }: PanelProps) {
  const queryClient = useQueryClient()
  const { userId } = usePermissions()
  const guard = useSubmitGuard()
  const { data: info, isPending, isError, error } = useQuery({
    queryKey: quickActionsQueryKey(taskId),
    queryFn: async () => (await serverQuery("tasks.quickActions", { taskId })) as TaskQuickActionsInfo | null,
    staleTime: 15_000,
  })
  const [mode, setMode] = useState<Mode>(null)
  const [comment, setComment] = useState("")
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "danger" | "warning"; text: string } | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  // People pickers (redirect / escalate / invite).
  const [target, setTarget] = useState<"user" | "email">("user")
  const [personId, setPersonId] = useState("")
  const [personIds, setPersonIds] = useState<string[]>([])
  const [emails, setEmails] = useState("")
  const [filter, setFilter] = useState("")
  const needsPeople = mode === "redirect" || mode === "escalate" || mode === "invite"
  const { data: people } = useQuery({
    queryKey: ["tasks", "redirect-users"],
    queryFn: async () => ((await serverQuery("tasks.redirectUsers")) ?? []) as Person[],
    enabled: needsPeople,
    staleTime: 60_000,
  })
  const candidates = useMemo(() => (people ?? []).filter((p) => p.id !== userId), [people, userId])

  function refresh() {
    for (const queryKey of QUICK_ACTION_REFRESH_KEYS) void queryClient.invalidateQueries({ queryKey: [...queryKey] })
  }

  function openMode(next: Mode) {
    setMode(mode === next ? null : next)
    setFormError(null)
    setNotice(null)
    setTarget("user")
    // Escalate: the person's manager is chosen to start with.
    setPersonId(next === "escalate" && info?.escalateTo ? info.escalateTo.id : "")
    setPersonIds([])
    setEmails("")
    setFilter("")
  }

  function succeed(text: string, tone: "success" | "info" | "warning" = "success") {
    setNotice({ tone, text })
    setMode(null)
    setComment("")
    onDone?.(text)
    refresh()
  }

  async function run(key: string, fn: () => Promise<void>) {
    await guard.run(async () => {
      setBusy(key)
      setFormError(null)
      setNotice(null)
      try {
        await fn()
      } catch (e) {
        setFormError(e instanceof Error ? e.message : "That didn’t work")
      }
      setBusy(null)
    })
  }

  async function act(key: string, action: QuickAction) {
    await run(key, async () => {
      const result = await runQuickAction(action)
      if (result.done) succeed(result.text, result.tone)
      else setNotice({ tone: result.tone, text: result.text })
    })
  }

  const emailList = parseEmails(emails)
  const many = (mode === "redirect" && info?.redirect?.mode === "many") || mode === "invite"
  const allowEmail = mode === "redirect" ? !!info?.redirect?.allowEmail : mode === "invite" ? !!info?.invite?.allowEmail : false
  const limit = mode === "redirect" ? info?.redirect?.limit ?? null : mode === "invite" ? info?.invite?.remaining ?? null : null
  const chosen = target === "email" ? emailList.length : many ? personIds.length : personId ? 1 : 0
  const overLimit = limit !== null && many && chosen > limit
  const nameOf = (id: string) => { const p = candidates.find((c) => c.id === id); return p?.display_name || p?.email || null }

  async function submitMode() {
    if (!mode) return
    const problem = quickFormError({ mode, comment, chosen, limit: many ? limit : null })
    if (problem) { setFormError(problem); return }
    const note = comment.trim() || undefined
    if (mode === "comment") {
      return run("comment", async () => {
        const { addTaskComment } = await import("@/app/actions/tasks")
        const result = await addTaskComment(taskId, comment.trim())
        if (!result.ok) throw new Error(result.error)
        succeed("Comment posted.")
      })
    }
    if (mode === "hold") return act("hold", { kind: "hold", taskId, title, comment })
    if (mode === "escalate") return act(mode, { kind: "escalate", taskId, personId, personName: nameOf(personId), comment: note })
    if (mode === "invite") return act(mode, target === "email" ? { kind: "invite", taskId, emails: emailList, comment: note } : { kind: "invite", taskId, userIds: personIds, comment: note })
    return act(mode, {
      kind: "redirect", taskId, many, comment: note,
      ...(target === "email" ? { emails: emailList } : many ? { userIds: personIds } : { personId, personName: nameOf(personId) }),
    })
  }

  if (isPending) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading actions">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-6 w-1/3" />
      </div>
    )
  }
  if (isError || !info) {
    return <p role="alert" className="text-xs text-danger">{(error as Error | null)?.message || "This task’s actions couldn’t be loaded."}</p>
  }

  const claimFirst = queueAction === "claim"
  const footer = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
      <Link href={info.taskHref} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-quick-open-task>
        <ExternalLink className="size-3.5" aria-hidden="true" /> Open task
      </Link>
      {info.processHref && (
        <Link href={info.processHref} className="inline-flex items-center gap-1 font-medium text-primary-text hover:underline" data-quick-process-view>
          <Workflow className="size-3.5" aria-hidden="true" /> Process view
        </Link>
      )}
    </div>
  )

  return (
    <div className="space-y-3 text-ui" data-quick-actions={taskId}>
      {queueAction && (
        <div className="flex flex-wrap items-center gap-2" data-quick-queued>
          <span className="text-xs text-fg-muted">{claimFirst ? "A team task — claim it to work on it:" : "Waiting for your response:"}</span>
          <QueuedTaskActions task={{ id: taskId, title }} action={queueAction} onDone={(m) => { onDone?.(m); setNotice({ tone: "success", text: m }) }} />
        </div>
      )}

      {info.closed ? (
        <p className="text-xs text-fg-muted">This task is closed.</p>
      ) : !claimFirst && (
        <>
          {/* Complete */}
          {info.completeVia === "quick" && (
            <div className="space-y-2" data-quick-outcomes>
              {!mode && (
                <Field label="Comment" optional>
                  <Textarea rows={1} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note with your response" className="max-w-xl" />
                </Field>
              )}
              <div className="flex flex-wrap items-center gap-2">
                {info.outcomes.map((o, i) => (
                  <Button key={o} size="sm" variant={i === 0 ? "primary" : "secondary"} leadingIcon={<Check />}
                    loading={busy === `outcome:${o}`} disabled={busy !== null} onClick={() => info && void act(`outcome:${o}`, { kind: "outcome", taskId, title, workflow: info.workflow, outcome: o, comment })} data-quick-outcome={o}>
                    {o === "completed" ? "Mark complete" : outcomeLabel(o)}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {info.completeVia === "form" && (
            <div className="flex flex-wrap items-center gap-2" data-quick-open-form>
              <Button asChild size="sm" leadingIcon={<ClipboardList />}>
                <Link href={info.formHref}>Open form to complete</Link>
              </Button>
              {info.completeNote && <span className="text-xs text-fg-muted">{info.completeNote}</span>}
            </div>
          )}
          {info.completeVia === "task" && (
            <div className="flex flex-wrap items-center gap-2" data-quick-open-task-to-act>
              <Button asChild size="sm" variant="secondary" leadingIcon={<ExternalLink />}>
                <Link href={info.taskHref}>Open task to act</Link>
              </Button>
              {info.completeNote && <span className="text-xs text-fg-muted">{info.completeNote}</span>}
            </div>
          )}
          {info.completeVia === "none" && info.completeNote && !queueAction && <p className="text-xs text-fg-muted">{info.completeNote}</p>}

          {/* Other actions */}
          {(
            <div className="flex flex-wrap items-center gap-2" data-quick-more>
              <Button size="sm" variant={mode === "comment" ? "secondary" : "ghost"} leadingIcon={<MessageSquare />} aria-pressed={mode === "comment"} disabled={busy !== null} onClick={() => openMode("comment")} data-quick-action="comment">Comment…</Button>
              {info.canResume && (
                <Button size="sm" variant="secondary" leadingIcon={<Play />} loading={busy === "resume"} disabled={busy !== null} onClick={() => void act("resume", { kind: "resume", taskId, title })} data-quick-action="resume">Resume</Button>
              )}
              {info.canHold && (
                <Button size="sm" variant={mode === "hold" ? "secondary" : "ghost"} leadingIcon={<Pause />} aria-pressed={mode === "hold"} disabled={busy !== null} onClick={() => openMode("hold")} data-quick-action="hold">Hold…</Button>
              )}
              {info.redirect && (
                <Button size="sm" variant={mode === "redirect" ? "secondary" : "ghost"} leadingIcon={<CornerDownRight />} aria-pressed={mode === "redirect"} disabled={busy !== null} onClick={() => openMode("redirect")} data-quick-action="redirect">Redirect…</Button>
              )}
              {info.invite && (
                <Button size="sm" variant={mode === "invite" ? "secondary" : "ghost"} leadingIcon={<UserPlus />} aria-pressed={mode === "invite"} disabled={busy !== null} onClick={() => openMode("invite")} data-quick-action="invite">Add collaborator…</Button>
              )}
              {/* Invite (read only): share with people, teams or roles — shown to those who may (components/tasks/invite-viewers). */}
              <TaskInviteControls taskId={taskId} showChip={false} label="Invite…" variant="ghost" />
              {info.canEscalate && (
                <Button size="sm" variant={mode === "escalate" ? "secondary" : "ghost"} leadingIcon={<ArrowUpRight />} aria-pressed={mode === "escalate"} disabled={busy !== null} onClick={() => openMode("escalate")} data-quick-action="escalate">Escalate…</Button>
              )}
            </div>
          )}

          {/* The chosen action's form */}
          {mode && (
            <div className="max-w-xl space-y-2 rounded-md border border-border-subtle bg-panel p-3" data-quick-form={mode}>
              <p className="font-medium text-fg">
                {mode === "comment" ? "Add a comment" : mode === "hold" ? "Put on hold" : mode === "redirect" ? "Redirect to" : mode === "invite" ? "Add collaborators (they work on this task)" : "Escalate to"}
              </p>
              {needsPeople && allowEmail && (
                <SegmentedControl aria-label="Recipient" size="sm" value={target} onValueChange={(v) => { setTarget(v); setFormError(null) }}
                  options={[{ value: "user", text: "Someone here" }, { value: "email", text: "Invite by email" }]} />
              )}
              {needsPeople && target === "user" && (many ? (
                <div className="space-y-1.5">
                  <SearchInput size="sm" value={filter} onValueChange={setFilter} placeholder="Find people" aria-label="Find people" />
                  <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-border-subtle p-2" role="group" aria-label="People">
                    {!people ? <Skeleton className="h-4 w-1/2" /> : candidates
                      .filter((p) => !filter.trim() || `${p.display_name ?? ""} ${p.email ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase()))
                      .slice(0, 100)
                      .map((p) => (
                        <Checkbox key={p.id} checked={personIds.includes(p.id)} label={p.display_name || p.email || p.id}
                          onChange={(e) => setPersonIds((ids) => e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id))} />
                      ))}
                  </div>
                </div>
              ) : (
                <Field label="Person" description={mode === "escalate" && info.escalateTo ? `Your manager, ${info.escalateTo.name}, is chosen — pick someone else if needed.` : undefined}>
                  <AutocompleteSelect value={personId} onChange={setPersonId} placeholder="Select a person"
                    options={candidates.map((p) => ({ value: p.id, label: p.display_name || p.email || p.id, hint: p.display_name ? p.email ?? undefined : undefined }))} />
                </Field>
              ))}
              {needsPeople && target === "email" && (many ? (
                <Textarea aria-label="Email addresses, one per line" rows={3} value={emails} onChange={(e) => setEmails(e.target.value)} placeholder={"name1@company.com\nname2@company.com"} />
              ) : (
                <Input type="email" size="sm" aria-label="Email address" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="name@company.com" />
              ))}
              {needsPeople && target === "email" && (
                <p className="text-xs text-fg-muted">People not yet in the organisation get an invitation{mode === "redirect" ? "; the task stays with you until they join" : ""}.</p>
              )}
              {needsPeople && many && limit !== null && (
                <p className={cn("text-xs", overLimit ? "text-danger" : "text-fg-muted")}>
                  {mode === "invite" ? `Room for ${limit} more ${limit === 1 ? "person" : "people"} on this task.` : `You can redirect this task to up to ${limit} ${limit === 1 ? "person" : "people"}.`}
                </p>
              )}
              <Field label={mode === "hold" ? "Reason" : "Comment"} optional={mode !== "hold" && mode !== "comment"}>
                <Textarea rows={2} value={comment} onChange={(e) => { setComment(e.target.value); setFormError(null) }}
                  placeholder={mode === "comment" ? "Write a comment for everyone on this task…" : mode === "hold" ? "Why are you putting this on hold?" : mode === "escalate" ? "Why are you escalating this task?" : mode === "invite" ? "What do you need from them?" : "Why are you redirecting this task?"} />
              </Field>
              {formError && <InlineNotice tone="danger">{formError}</InlineNotice>}
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => openMode(null)}>Cancel</Button>
                {mode === "comment" ? (
                  <Button size="sm" loading={busy === "comment"} disabled={busy !== null || !comment.trim()} onClick={() => void submitMode()} data-quick-submit="comment">Post comment</Button>
                ) : mode === "hold" ? (
                  <Button size="sm" loading={busy === "hold"} disabled={busy !== null || !comment.trim()} onClick={() => void submitMode()} data-quick-submit="hold">Put on hold</Button>
                ) : (
                  <Button size="sm" loading={busy === mode} disabled={busy !== null || !chosen || overLimit} onClick={() => void submitMode()} data-quick-submit={mode}>
                    {mode === "escalate" ? "Escalate" : mode === "invite" ? (target === "email" ? "Send invitations" : "Invite") : target === "email" ? "Invite and redirect" : "Redirect"}
                  </Button>
                )}
              </div>
            </div>
          )}

          {!mode && formError && <InlineNotice tone="danger" onDismiss={() => setFormError(null)}>{formError}</InlineNotice>}
        </>
      )}

      {notice && <InlineNotice tone={notice.tone} onDismiss={() => setNotice(null)}>{notice.text}</InlineNotice>}
      <div className="flex items-center justify-between gap-2">
        {footer}
        {onClose && <Button size="sm" variant="ghost" onClick={onClose} className="max-md:hidden">Close</Button>}
      </div>
    </div>
  )
}
