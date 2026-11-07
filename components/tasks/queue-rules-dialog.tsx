"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { IconButton } from "@/components/ui/icon-button"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { QueueRulesEditor, useQueueRuleOptions, type QueueRuleOptions } from "@/components/settings/queue-rules-editor"
import { useIsMobile } from "@/hooks/use-mobile"
import { NAV_COUNTS_QUERY_KEY } from "@/hooks/use-nav-counts"
import { serverQuery, serverRead } from "@/lib/server-read"
import {
  QUEUE_ASSIGNMENTS, QUEUE_ASSIGNMENT_LABELS, QUEUE_DECISION_LABELS, QUEUE_ORIGINS, QUEUE_ORIGIN_LABELS, QUEUE_PRIORITIES, QUEUE_PRIORITY_LABELS,
  describeRuleSet, type QueueRules,
} from "@/lib/tasks/queue-rules"
import { cn } from "@/lib/utils"

/**
 * The task lists' Queue rules button (a sliders icon next to Refresh): a
 * dialog (a bottom sheet on phones) with the person's own queue rules —
 * the same editor as Settings → Preferences — a live summary, "Test a task"
 * (the server evaluates the draft rules for a sample task, with the real
 * org context) and Save / Cancel. Saving refreshes the lists.
 */

export const MY_QUEUE_RULES_KEY = ["tasks", "my-queue-rules"] as const

type MyRules = { rules: QueueRules; saved: boolean; timeZone: string | null }

export function QueueRulesButton() {
  const [open, setOpen] = useState(false)
  const mobile = useIsMobile()
  return (
    <>
      <IconButton size="sm" label="Queue rules" icon={<SlidersHorizontal />} onClick={() => setOpen(true)} aria-haspopup="dialog" data-queue-rules-button />
      {open && <QueueRulesDialog open={open} onOpenChange={setOpen} mobile={mobile} />}
    </>
  )
}

export function QueueRulesDialog({ open, onOpenChange, mobile }: { open: boolean; onOpenChange: (open: boolean) => void; mobile: boolean }) {
  const queryClient = useQueryClient()
  const { data, isPending, isError } = useQuery({
    queryKey: MY_QUEUE_RULES_KEY,
    queryFn: async () => (await serverQuery("tasks.myQueueRules")) as MyRules | null,
  })
  const [draft, setDraft] = useState<QueueRules | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rules = draft ?? data?.rules ?? null
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(data?.rules)

  async function save() {
    if (!rules) return
    setSaving(true)
    setError(null)
    const { saveMyQueueRules } = await import("@/app/actions/profile")
    const result = await saveMyQueueRules(rules)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    queryClient.setQueryData(MY_QUEUE_RULES_KEY, { ...(data ?? { timeZone: null }), rules: result.rules ?? rules, saved: true })
    for (const queryKey of [["tasks"], ["home"], NAV_COUNTS_QUERY_KEY]) void queryClient.invalidateQueries({ queryKey: [...queryKey] })
    onOpenChange(false)
  }

  const body = (
    <QueueRulesDialogBody rules={rules} loading={isPending} failed={isError} onChange={(r) => { setDraft(r); setError(null) }} />
  )
  const footer = (
    <DialogFooter className="items-center">
      {error && <p role="alert" className="mr-auto text-xs text-danger">{error}</p>}
      <Button variant="secondary" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
      <Button size="sm" loading={saving} disabled={!rules || !dirty || saving} onClick={() => void save()} data-queue-rules-save>Save rules</Button>
    </DialogFooter>
  )
  const description = "Choose which new tasks wait for you to accept them and which go straight to your list."
  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" title="Queue rules" description={description}>
          <DialogBody className="overflow-y-auto">{body}</DialogBody>
          {footer}
        </SheetContent>
      </Sheet>
    )
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="xl" title="Queue rules" description={description}>
        <DialogBody className="max-h-[70vh] overflow-y-auto">{body}</DialogBody>
        {footer}
      </DialogContent>
    </Dialog>
  )
}

/** The dialog's contents: summary, editor, Test a task (exported for tests). */
export function QueueRulesDialogBody({ rules, loading, failed, onChange, options }: {
  rules: QueueRules | null
  loading?: boolean
  failed?: boolean
  onChange: (rules: QueueRules) => void
  options?: QueueRuleOptions
}) {
  if (loading && !rules) {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading your queue rules"><Skeleton className="h-6 w-2/3" /><Skeleton className="h-24 w-full" /></div>
  }
  if (failed || !rules) return <InlineNotice tone="danger">Your queue rules couldn’t be loaded.</InlineNotice>
  return (
    <div className="space-y-4" data-queue-rules-dialog>
      <div data-queue-rules-summary><InlineNotice tone="info">{describeRuleSet(rules)}</InlineNotice></div>
      <QueueRulesEditor value={rules} onChange={onChange} options={options} />
      <QueueRulesPreview rules={rules} options={options} />
    </div>
  )
}

type Sample = {
  priority: string; origin: string; workflow_id: string; form_id: string; assigned_by_user_id: string
  assignment: string; assigned_team_id: string; due: string; title: string; has_attachments: boolean; is_subtask: boolean; tags: string; when: string
}

const DUE_SAMPLES = [
  { value: "none", label: "No due date" },
  { value: "2h", label: "Due in 2 hours" },
  { value: "1d", label: "Due tomorrow" },
  { value: "7d", label: "Due in a week" },
  { value: "overdue", label: "Already overdue" },
]

/** Sample attributes → the facts the preview read takes. */
export function sampleFacts(s: Sample, now = Date.now()) {
  const dueIn: Record<string, number | null> = { none: null, "2h": 2 * 3_600_000, "1d": 86_400_000, "7d": 7 * 86_400_000, overdue: -3_600_000 }
  const base = s.when ? Date.parse(s.when) : now
  const offset = dueIn[s.due] ?? null
  return {
    priority: s.priority as "medium",
    source: (s.origin === "workflow" || s.origin === "form" || s.origin === "aad_group" ? "workflow" : "manual") as "workflow" | "manual",
    origins: [s.origin],
    workflow_id: s.workflow_id || null,
    form_id: s.form_id || null,
    assigned_by_user_id: s.assigned_by_user_id || null,
    assignment: s.assignment as "individual",
    assigned_team_id: s.assigned_team_id || null,
    due_date: offset === null ? null : new Date((Number.isFinite(base) ? base : now) + offset).toISOString(),
    title: s.title,
    has_attachments: s.has_attachments,
    is_subtask: s.is_subtask,
    tags: s.tags.split(",").map((t) => t.trim()).filter(Boolean),
    ...(s.when && Number.isFinite(Date.parse(s.when)) ? { now: new Date(s.when).toISOString() } : {}),
  }
}

/** "Test a task": pick sample attributes → Queue or Add, and which rule decided. */
export function QueueRulesPreview({ rules, options: given }: { rules: QueueRules; options?: QueueRuleOptions }) {
  const loaded = useQueueRuleOptions()
  const options = given ?? loaded
  const [open, setOpen] = useState(false)
  const [sample, setSample] = useState<Sample>({
    priority: "medium", origin: "workflow", workflow_id: "", form_id: "", assigned_by_user_id: "", assignment: "individual",
    assigned_team_id: "", due: "1d", title: "", has_attachments: false, is_subtask: false, tags: "", when: "",
  })
  const [result, setResult] = useState<{ decision?: string; ruleIndex?: number | null; ruleName?: string | null; error?: string } | null>(null)
  const set = (patch: Partial<Sample>) => setSample((s) => ({ ...s, ...patch }))

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const timer = setTimeout(() => {
      void serverRead("tasks.queueRulesPreview", { rules, facts: sampleFacts(sample) }).then(({ data, error }) => {
        if (cancelled) return
        if (error || !data) setResult({ error: error?.message ?? "Couldn’t test the rules." })
        else if (!data.ok) setResult({ error: data.error })
        else setResult({ decision: data.decision, ruleIndex: data.ruleIndex, ruleName: data.ruleName })
      })
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, rules, sample])

  const pick = (list: Array<{ id: string; label: string }>, none: string) => [{ value: "", label: none }, ...list.map((o) => ({ value: o.id, label: o.label }))]

  return (
    <section className="rounded-md border border-border-subtle" data-queue-rules-preview>
      <button type="button" className="flex w-full items-center justify-between px-3 py-2 text-left text-ui font-medium text-fg" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        Test a task
        <ChevronDown className={cn("size-4 text-fg-muted transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border-subtle p-3">
          <p className="text-xs text-fg-muted">Describe a task that might be assigned to you; the rules above (unsaved changes included) decide what happens to it.</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Select size="sm" aria-label="Sample priority" value={sample.priority} onChange={(e) => set({ priority: e.target.value })}
              options={QUEUE_PRIORITIES.map((p) => ({ value: p, label: `${QUEUE_PRIORITY_LABELS[p]} priority` }))} />
            <Select size="sm" aria-label="Sample came from" value={sample.origin} onChange={(e) => set({ origin: e.target.value })}
              options={QUEUE_ORIGINS.map((o) => ({ value: o, label: `From ${QUEUE_ORIGIN_LABELS[o].toLowerCase()}` }))} />
            <Select size="sm" aria-label="Sample assigned by" value={sample.assigned_by_user_id} onChange={(e) => set({ assigned_by_user_id: e.target.value })}
              options={pick(options.people, "Assigned by no person")} />
            <Select size="sm" aria-label="Sample workflow" value={sample.workflow_id} onChange={(e) => set({ workflow_id: e.target.value })}
              options={pick(options.workflows, "No workflow")} />
            <Select size="sm" aria-label="Sample form" value={sample.form_id} onChange={(e) => set({ form_id: e.target.value })}
              options={pick(options.forms, "No form")} />
            <Select size="sm" aria-label="Sample reached me" value={sample.assignment} onChange={(e) => set({ assignment: e.target.value })}
              options={QUEUE_ASSIGNMENTS.map((a) => ({ value: a, label: QUEUE_ASSIGNMENT_LABELS[a] }))} />
            <Select size="sm" aria-label="Sample team" value={sample.assigned_team_id} onChange={(e) => set({ assigned_team_id: e.target.value })}
              options={pick(options.teams, "Not through a team")} />
            <Select size="sm" aria-label="Sample due date" value={sample.due} onChange={(e) => set({ due: e.target.value })} options={DUE_SAMPLES} />
            <Input size="sm" aria-label="Sample title" placeholder="Title, e.g. Approve invoice 42" value={sample.title} onChange={(e) => set({ title: e.target.value })} />
            <Input size="sm" aria-label="Sample tags" placeholder="Tags, comma separated" value={sample.tags} onChange={(e) => set({ tags: e.target.value })} />
            <Input type="datetime-local" size="sm" aria-label="Sample arrival time" value={sample.when} onChange={(e) => set({ when: e.target.value })} />
            <span className="flex items-center gap-3">
              <Checkbox label="Has attachments" checked={sample.has_attachments} onChange={(e) => set({ has_attachments: e.target.checked })} />
              <Checkbox label="Subtask" checked={sample.is_subtask} onChange={(e) => set({ is_subtask: e.target.checked })} />
            </span>
          </div>
          <div role="status" aria-live="polite" data-queue-rules-preview-result={result?.decision ?? (result?.error ? "error" : "pending")}>
            {!result ? <p className="text-xs text-fg-muted">Testing…</p> : result.error ? (
              <InlineNotice tone="warning">{result.error}</InlineNotice>
            ) : (
              <InlineNotice tone={result.decision === "add" ? "success" : "neutral"}>
                <strong>{QUEUE_DECISION_LABELS[result.decision as "queue" | "add"]}</strong>
                {" — "}
                {result.ruleIndex === null || result.ruleIndex === undefined
                  ? "no rule matched, so your default applies."
                  : `rule ${result.ruleIndex + 1}${result.ruleName ? ` (“${result.ruleName}”)` : ""} matched.`}
              </InlineNotice>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
