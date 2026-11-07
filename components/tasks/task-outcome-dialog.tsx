"use client"

import { useState } from "react"
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Field } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip } from "@/components/ui/tooltip"
import { plural } from "@/lib/format/plural"
import { Button } from "@/components/ui/button"
import { serverRead } from "@/lib/server-read"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import {
  Check, ThumbsUp, ThumbsDown, Clock, ArrowRight,
  RotateCcw, AlertTriangle, Send, ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { isDisplayField, validateTaskFieldValues, type TaskFieldDef } from "@/lib/task-field-schema"
import { FORM_STATE_KEY } from "@/lib/forms/form-state"
import { FORM_VARS_KEY } from "@/lib/forms/form-params"
import { useOnBehalf } from "./on-behalf"

const OUTCOME_ICONS: Record<string, any> = {
  completed: Check,
  approved: ThumbsUp,
  rejected: ThumbsDown,
  deferred: Clock,
  forwarded: ArrowRight,
  returned: RotateCcw,
  escalated: AlertTriangle,
}

/** "need_more_information" → "Need more information" (sentence case). */
export function outcomeLabel(outcome: string): string {
  const s = outcome.replace(/_/g, " ").trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

interface TaskOutcomeDialogProps {
  taskId: string
  taskTitle: string
  outcomes: string[]
  isWorkflowTask?: boolean
  eventId?: string | null
  /** User Task fields — required ones must be filled before an outcome can be submitted. */
  fields?: TaskFieldDef[]
  fieldValues?: Record<string, unknown>
  /** Called with per-field errors when the server rejects the values. */
  onFieldErrors?: (errors: Record<string, string>) => void
  /** The form's grid (steps / tabs: fields on hidden pages are not required). */
  formLayout?: unknown
  /** After the action: `completed` with the outcome when the task closed (not when a multi-response task only recorded a response). */
  onComplete: (result?: { completed: boolean; outcome: string }) => void
}

export function TaskOutcomeDialog({
  taskId,
  taskTitle,
  outcomes,
  isWorkflowTask,
  eventId,
  fields = [],
  fieldValues = {},
  onFieldErrors,
  formLayout,
  onComplete,
}: TaskOutcomeDialogProps) {
  const [open, setOpen] = useState(false)
  const [openBlockers, setOpenBlockers] = useState<Array<{ id: string; title: string }>>([])
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  // Synchronous guard: two clicks in one frame would act on the task twice.
  const submitGuard = useSubmitGuard()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const router = useRouter()
  const queryClient = useQueryClient()
  const onBehalf = useOnBehalf()

  // If only "completed", show a simple button
  const hasCustomOutcomes =
    outcomes.length > 1 ||
    (outcomes.length === 1 && outcomes[0] !== "completed")

  const fieldErrors = validateTaskFieldValues(fields, fieldValues, { layout: formLayout })
  const missingFields = fields.filter((f) => fieldErrors[f.key]).map((f) => f.label)
  const fieldsInvalid = missingFields.length > 0
  // The in-form buttons' state rides along (the server judges it against the form's own buttons).
  const fieldValuesToSend = fields.length > 0
    ? { ...Object.fromEntries(fields.filter((f) => !isDisplayField(f)).map((f) => [f.key, fieldValues[f.key] ?? null])), ...(fieldValues[FORM_STATE_KEY] ? { [FORM_STATE_KEY]: fieldValues[FORM_STATE_KEY] } : {}), ...(fieldValues[FORM_VARS_KEY] ? { [FORM_VARS_KEY]: fieldValues[FORM_VARS_KEY] } : {}) }
    : undefined

  function flagFieldErrors() {
    if (fieldsInvalid) onFieldErrors?.(fieldErrors)
  }

  async function submitOutcome(outcome: string) {
    await submitGuard.run(async () => {
      if (fieldsInvalid) {
        onFieldErrors?.(fieldErrors)
        return
      }
      if (onBehalf.needsNote) {
        setSubmitError('Add a reason (above) before acting on their behalf')
        return
      }
      setSubmitting(true)
      setSubmitError(null)
      let closed = true

      if (isWorkflowTask && eventId) {
        // completeWorkflowTask records the response and resumes the paused run.
        const { completeWorkflowTask } = await import('@/app/actions/task-queue')
        const result = await completeWorkflowTask(taskId, outcome, notes || undefined, fieldValuesToSend, onBehalf.options)
        if (result.status === 'error') {
          setSubmitError(result.error)
          setSubmitting(false)
          return
        }
        if (result.status === 'invalid') {
          onFieldErrors?.(result.errors)
          setSubmitError('Some fields need attention')
          setSubmitting(false)
          return
        }
        if (result.status === 'waiting') closed = false
        if (result.status === 'completed' && !result.workflowResumed) {
          setSubmitError(`Task completed, but the workflow did not resume: ${result.workflowError ?? 'unknown error'}`)
        }
      } else {
        if (fieldValuesToSend) {
          const { saveTaskFieldValues } = await import('@/app/actions/tasks')
          const saved = await saveTaskFieldValues(taskId, fieldValuesToSend)
          if (!saved.success) {
            onFieldErrors?.(saved.errors)
            setSubmitError('Some fields need attention')
            setSubmitting(false)
            return
          }
        }
        // Standard task: records the outcome and a completed timeline event.
        const { completeTaskWithOutcome } = await import('@/app/actions/tasks')
        const completed = await completeTaskWithOutcome(taskId, outcome, notes || null)
        if (!completed.ok) {
          setSubmitError(completed.error)
          setSubmitting(false)
          return
        }
      }

      queryClient.invalidateQueries({ queryKey: ["task-tree", taskId] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
      queryClient.invalidateQueries({ queryKey: ["home"] })
      setSubmitting(false)
      setOpen(false)
      setSelectedOutcome(null)
      setNotes("")
      onComplete({ completed: closed, outcome })
      router.refresh()
    })
  }

  if (!onBehalf.canAct) return null

  if (!hasCustomOutcomes) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Tooltip content={`Fill in: ${missingFields.join(", ")}`} enabled={fieldsInvalid}>
          <Button size="sm" onClick={() => submitOutcome("completed")} loading={submitting} leadingIcon={<Check />} data-task-outcome="completed">
            {submitting ? "Completing…" : onBehalf.onBehalf ? "Complete on their behalf" : "Complete"}
          </Button>
        </Tooltip>
        {submitError && <p className="text-xs text-danger" role="alert">{submitError}</p>}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
      setOpen(next)
      setSubmitError(null)
      if (next) {
        flagFieldErrors()
        // Warn-with-override: completing while blockers are open is allowed,
        // but the dialog surfaces them so it's a deliberate choice.
        void serverRead('tasks.openBlockers', { taskId }).then(({ data }) => setOpenBlockers(data ?? []))
      } else {
        setOpenBlockers([])
      }
    }}>
      {/* Trigger: inline buttons for 2-3 outcomes (the first, the default, is the one primary), a Submit button for 4+ */}
      {outcomes.length <= 3 ? (
        <div className="flex flex-wrap items-center gap-2" data-task-outcomes>
          {outcomes.map((outcome, idx) => {
            const Icon = OUTCOME_ICONS[outcome] ?? Check
            return (
              <Button
                key={outcome}
                size="sm"
                variant={idx === 0 ? "primary" : "secondary"}
                disabled={submitting}
                leadingIcon={<Icon />}
                onClick={() => { setSelectedOutcome(outcome); setOpen(true); flagFieldErrors() }}
                data-task-outcome={outcome}
              >
                {outcomeLabel(outcome)}
              </Button>
            )
          })}
        </div>
      ) : (
        <DialogTrigger asChild>
          <Button size="sm" onClick={() => setSelectedOutcome(null)} leadingIcon={<Send />} trailingIcon={<ChevronDown />}>
            Submit
          </Button>
        </DialogTrigger>
      )}
      <DialogContent size="sm" title={onBehalf.onBehalf ? "Submit on behalf of the assignee" : "Submit response"} description={taskTitle}>
        <DialogBody className="space-y-4">
          {openBlockers.length > 0 && (
            <InlineNotice tone="warning" title={`This task is blocked by ${plural(openBlockers.length, "open task")}`}>
              <ul className="mt-1 list-inside list-disc">
                {openBlockers.slice(0, 4).map((b) => <li key={b.id} className="truncate">{b.title}</li>)}
              </ul>
              <p className="mt-1 text-fg-muted">You can still submit — this is a heads-up, not a hard stop.</p>
            </InlineNotice>
          )}

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Outcome">
            {outcomes.map((outcome) => {
              const Icon = OUTCOME_ICONS[outcome] ?? Check
              const isSelected = selectedOutcome === outcome
              return (
                <button
                  key={outcome}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => setSelectedOutcome(outcome)}
                  className={cn(
                    "flex items-center gap-2 rounded-md border px-3 py-2.5 text-left text-ui font-medium text-fg transition-colors duration-[var(--ds-dur-fast)]",
                    isSelected ? "border-primary bg-primary-wash" : "border-border hover:border-border-strong hover:bg-subtle",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", isSelected ? "text-primary-text" : "text-fg-muted")} aria-hidden />
                  {outcomeLabel(outcome)}
                </button>
              )
            })}
          </div>

          {fieldsInvalid && (
            <InlineNotice tone="danger">Fill in the required task fields before submitting: {missingFields.join(", ")}</InlineNotice>
          )}
          {submitError && <InlineNotice tone="danger">{submitError}</InlineNotice>}
          {onBehalf.onBehalf && (
            <div data-on-behalf-note>
              <InlineNotice tone="info">
                {onBehalf.needsNote ? "Add a reason in the banner above first." : <>On behalf, with the reason: <em>{onBehalf.note}</em></>}
              </InlineNotice>
            </div>
          )}

          <Field label="Notes" optional>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Add any comments or reason…" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" size="sm">Cancel</Button>
          </DialogClose>
          <Button
            size="sm"
            disabled={!selectedOutcome || fieldsInvalid || onBehalf.needsNote}
            loading={submitting}
            onClick={() => selectedOutcome && submitOutcome(selectedOutcome)}
          >
            {submitting ? "Submitting…" : selectedOutcome ? `Submit: ${outcomeLabel(selectedOutcome)}` : "Select an outcome"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Preset outcome sets for templates
export const OUTCOME_PRESETS = [
  {
    id: "complete",
    label: "Simple Complete",
    outcomes: ["completed"],
  },
  {
    id: "approve_reject",
    label: "Approve / Reject",
    outcomes: ["approved", "rejected"],
  },
  {
    id: "approve_reject_defer",
    label: "Approve / Reject / Defer",
    outcomes: ["approved", "rejected", "deferred"],
  },
  {
    id: "review",
    label: "Review Outcomes",
    outcomes: ["approved", "rejected", "returned", "escalated"],
  },
  {
    id: "forward",
    label: "Forward / Complete",
    outcomes: ["completed", "forwarded", "escalated"],
  },
]
