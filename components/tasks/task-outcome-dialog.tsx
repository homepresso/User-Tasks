"use client"

import { useState } from "react"
import * as Dialog from "@radix-ui/react-dialog"
import { Button } from "@/components/ui/button"
import { serverRead } from "@/lib/server-read"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import {
  Check, X, ThumbsUp, ThumbsDown, Clock, ArrowRight,
  RotateCcw, AlertTriangle, Send, ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { validateTaskFieldValues, type TaskFieldDef } from "@/lib/task-field-schema"
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

const OUTCOME_COLORS: Record<string, string> = {
  completed: "var(--status-done)",
  approved: "var(--status-done)",
  rejected: "var(--status-blocked)",
  deferred: "var(--status-progress)",
  forwarded: "var(--status-info)",
  returned: "var(--status-todo)",
  escalated: "var(--status-blocked)",
}

// Rotating colors for custom outcomes that don't match built-in ones (theme text colours, legible on cards)
const CUSTOM_COLORS = ["var(--theme-accent-text)", "var(--status-done)", "var(--status-info)", "var(--status-blocked)", "var(--status-progress)", "var(--theme-primary-text)"]

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
  onComplete: () => void
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
  onComplete,
}: TaskOutcomeDialogProps) {
  const [open, setOpen] = useState(false)
  const [openBlockers, setOpenBlockers] = useState<Array<{ id: string; title: string }>>([])
  const [selectedOutcome, setSelectedOutcome] = useState<string | null>(null)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const router = useRouter()
  const queryClient = useQueryClient()
  const onBehalf = useOnBehalf()

  // If only "completed", show a simple button
  const hasCustomOutcomes =
    outcomes.length > 1 ||
    (outcomes.length === 1 && outcomes[0] !== "completed")

  const fieldErrors = validateTaskFieldValues(fields, fieldValues)
  const missingFields = fields.filter((f) => fieldErrors[f.key]).map((f) => f.label)
  const fieldsInvalid = missingFields.length > 0
  const fieldValuesToSend = fields.length > 0
    ? Object.fromEntries(fields.map((f) => [f.key, fieldValues[f.key] ?? null]))
    : undefined

  function flagFieldErrors() {
    if (fieldsInvalid) onFieldErrors?.(fieldErrors)
  }

  async function submitOutcome(outcome: string) {
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
    queryClient.invalidateQueries({ queryKey: ["task-queue"] })
    setSubmitting(false)
    setOpen(false)
    setSelectedOutcome(null)
    setNotes("")
    onComplete()
    router.refresh()
  }

  if (!onBehalf.canAct) return null

  if (!hasCustomOutcomes) {
    return (
      <div className="flex flex-col items-end gap-1">
        <Button
          size="sm"
          onClick={() => submitOutcome("completed")}
          disabled={submitting}
          title={fieldsInvalid ? `Fill in: ${missingFields.join(", ")}` : undefined}
        >
          <Check size={14} className="mr-1" />
          {submitting ? "Completing..." : onBehalf.onBehalf ? "Complete on their behalf" : "Complete"}
        </Button>
        {submitError && (
          <p className="text-[11px]" style={{ color: "var(--status-blocked)" }}>{submitError}</p>
        )}
      </div>
    )
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => {
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
      {/* Trigger: inline buttons for 2-3 outcomes, dropdown for 4+ */}
      {outcomes.length <= 3 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {outcomes.map((outcome, idx) => {
            const Icon = OUTCOME_ICONS[outcome] ?? Check
            const color = OUTCOME_COLORS[outcome] ?? CUSTOM_COLORS[idx % CUSTOM_COLORS.length]
            const label = outcome.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
            return (
              <Button
                key={outcome}
                size="sm"
                variant="outline"
                disabled={submitting}
                onClick={() => { setSelectedOutcome(outcome); setOpen(true); flagFieldErrors() }}
                style={{ borderColor: color, color }}
              >
                <Icon size={13} className="mr-1" />
                {label}
              </Button>
            )
          })}
        </div>
      ) : (
        <Dialog.Trigger asChild>
          <Button size="sm" onClick={() => setSelectedOutcome(null)}>
            <Send size={14} className="mr-1" />
            Submit
            <ChevronDown size={12} className="ml-1" />
          </Button>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[calc(100vw-2rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-xl p-6 shadow-xl"
          style={{ backgroundColor: "var(--theme-card-bg)" }}
        >
          <Dialog.Title className="text-lg font-semibold mb-1">
            {onBehalf.onBehalf ? 'Submit on behalf of the assignee' : 'Submit Response'}
          </Dialog.Title>
          <p
            className="text-xs mb-4"
            style={{ color: "var(--theme-muted-text)" }}
          >
            {taskTitle}
          </p>

          {openBlockers.length > 0 && (
            <div className="mb-4 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--status-progress)', backgroundColor: 'var(--status-progress-bg)', color: 'var(--status-progress)' }}>
              <p className="font-semibold">This task is blocked by {openBlockers.length} open task{openBlockers.length > 1 ? 's' : ''}:</p>
              <ul className="mt-1 list-inside list-disc">
                {openBlockers.slice(0, 4).map((b) => <li key={b.id} className="truncate">{b.title}</li>)}
              </ul>
              <p className="mt-1 opacity-80">You can still submit — this is a heads-up, not a hard stop.</p>
            </div>
          )}

          {/* Outcome buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            {outcomes.map((outcome, idx) => {
              const Icon = OUTCOME_ICONS[outcome] ?? Check
              const color = OUTCOME_COLORS[outcome] ?? CUSTOM_COLORS[idx % CUSTOM_COLORS.length]
              const isSelected = selectedOutcome === outcome
              const label = outcome
                .split("_")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ")

              return (
                <button
                  key={outcome}
                  onClick={() => setSelectedOutcome(outcome)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border-2 px-4 py-3 text-sm font-medium transition-all text-left"
                  )}
                  style={{
                    borderColor: isSelected ? color : "var(--theme-surface-border)",
                    backgroundColor: isSelected ? `color-mix(in srgb, ${color} 7%, transparent)` : "transparent",
                  }}
                >
                  <Icon
                    size={18}
                    style={{ color: isSelected ? color : "var(--theme-muted-text)" }}
                  />
                  {label}
                </button>
              )
            })}
          </div>

          {fieldsInvalid && (
            <div className="mb-4 rounded-lg border px-3 py-2 text-xs"
              style={{ borderColor: 'var(--status-blocked)', backgroundColor: 'var(--status-blocked-bg)', color: 'var(--status-blocked)' }}>
              Fill in the required task fields before submitting: {missingFields.join(", ")}
            </div>
          )}
          {submitError && (
            <p className="mb-4 text-xs" style={{ color: "var(--status-blocked)" }}>{submitError}</p>
          )}
          {onBehalf.onBehalf && (
            <p className="mb-4 rounded-lg border px-3 py-2 text-xs" data-on-behalf-note
              style={{ borderColor: 'var(--status-info)', color: 'var(--theme-card-text)' }}>
              {onBehalf.needsNote ? 'Add a reason in the banner above first.' : <>On behalf, with the reason: <em>{onBehalf.note}</em></>}
            </p>
          )}

          {/* Notes */}
          <div className="mb-4">
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--theme-muted-text)" }}
            >
              Notes{" "}
              <span style={{ color: "var(--theme-muted-text)" }}>
                (optional)
              </span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Add any comments or reason..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{
                backgroundColor: "var(--theme-card-bg)",
                borderColor: "var(--theme-surface-border)",
                color: "var(--theme-card-text)",
              }}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="outline" size="sm">
                Cancel
              </Button>
            </Dialog.Close>
            <Button
              size="sm"
              disabled={!selectedOutcome || submitting || fieldsInvalid || onBehalf.needsNote}
              onClick={() => selectedOutcome && submitOutcome(selectedOutcome)}
              style={
                selectedOutcome
                  ? {
                      backgroundColor:
                        OUTCOME_COLORS[selectedOutcome] ?? "var(--theme-primary)",
                    }
                  : undefined
              }
            >
              {submitting
                ? "Submitting..."
                : selectedOutcome
                  ? `Submit: ${selectedOutcome.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}`
                  : "Select an outcome"}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
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
