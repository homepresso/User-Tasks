"use client"

import { useId, useRef, useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field } from "@/components/ui/field"
import { Input, controlClass } from "@/components/ui/input"
import { InlineNotice } from "@/components/ui/inline-notice"
import { Select } from "@/components/ui/select"
import { TaskDescriptionEditor } from "@/components/tasks/task-description"
import { cn } from "@/lib/utils"
import {
  effortInputText, parseEffortInput, SUBTASK_DESCRIPTION_MAX, SUBTASK_SUBTITLE_MAX, SUBTASK_TITLE_MAX, validateSubtaskInput, type SubtaskInput,
} from "@/lib/tasks/subtask-input"
import type { SubtaskRecord } from "@/lib/services/tasks"

/**
 * Add or edit a subtask — the task page's task tree and the task lists'
 * detail panel (Home, My tasks, the tracker) share it. Title first: Enter
 * adds it and keeps the form open for the next one; "More details" holds
 * the optional subtitle, description, estimate, due date, priority and tags.
 * "Add" adds and closes, "Add another" adds and clears for the next one.
 * Edit mode shows every field and saves the changes (updateSubtask).
 * Server rules: lib/services/tasks addSubtask / updateSubtask (validation in
 * lib/tasks/subtask-input, shared with this form).
 */

export const SUBTASK_PRIORITY_OPTIONS = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "none", label: "None" },
] as const

export interface SubtaskFormInitial {
  title?: string
  subtitle?: string | null
  description?: string | null
  estimated_effort_minutes?: number | null
  due_date?: string | null
  priority?: string | null
  tags?: string[] | null
}

interface Draft {
  title: string
  subtitle: string
  description: string
  effort: string
  due: string
  priority: string
  tags: string
}

function draftFrom(initial: SubtaskFormInitial | undefined, defaultPriority: string): Draft {
  return {
    title: initial?.title ?? "",
    subtitle: initial?.subtitle ?? "",
    description: initial?.description ?? "",
    effort: effortInputText(initial?.estimated_effort_minutes ?? null),
    due: initial?.due_date ? String(initial.due_date).slice(0, 10) : "",
    priority: initial?.priority ?? defaultPriority,
    tags: (initial?.tags ?? []).join(", "),
  }
}

/** The form's values → the service input (edit: only what changed). Error text when the estimate can't be read. */
export function subtaskInputFromDraft(draft: Draft, base?: Draft): { input: SubtaskInput } | { error: string } {
  const minutes = parseEffortInput(draft.effort)
  if (Number.isNaN(minutes)) return { error: "Estimate: hours (1.5) or hours and minutes (1h 30m)" }
  const full: Required<SubtaskInput> = {
    title: draft.title,
    subtitle: draft.subtitle.trim() || null,
    description: draft.description.trim() || null,
    estimated_effort_minutes: minutes,
    // Noon UTC keeps the chosen day in every time zone.
    due_date: draft.due ? `${draft.due}T12:00:00.000Z` : null,
    priority: draft.priority,
    tags: draft.tags.split(",").map((t) => t.trim()).filter(Boolean),
  }
  if (!base) return { input: full }
  const input: SubtaskInput = {}
  if (draft.title !== base.title) input.title = full.title
  if (draft.subtitle !== base.subtitle) input.subtitle = full.subtitle
  if (draft.description !== base.description) input.description = full.description
  if (draft.effort !== base.effort) input.estimated_effort_minutes = full.estimated_effort_minutes
  if (draft.due !== base.due) input.due_date = full.due_date
  if (draft.priority !== base.priority) input.priority = full.priority
  if (draft.tags !== base.tags) input.tags = full.tags
  return { input }
}

export interface SubtaskFormProps {
  /** The task the subtask goes under (create). */
  parentTaskId: string
  /** Edit this subtask instead of adding one. */
  subtaskId?: string
  initial?: SubtaskFormInitial
  /** New subtasks start with the parent's priority. */
  defaultPriority?: string | null
  /** Panel / phone: smaller controls, one column. */
  compact?: boolean
  onSaved?: (subtask: SubtaskRecord, options: { closed: boolean }) => void | Promise<void>
  onCancel?: () => void
  className?: string
}

export function SubtaskForm({ parentTaskId, subtaskId, initial, defaultPriority, compact = false, onSaved, onCancel, className }: SubtaskFormProps) {
  const editing = Boolean(subtaskId)
  const priority0 = defaultPriority && SUBTASK_PRIORITY_OPTIONS.some((o) => o.value === defaultPriority) ? defaultPriority : "medium"
  const [base] = useState(() => draftFrom(initial, priority0))
  const [draft, setDraft] = useState<Draft>(base)
  const [details, setDetails] = useState(editing)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const uid = useId()
  const size = compact ? "sm" : "md"
  const set = (key: keyof Draft) => (value: string) => setDraft((d) => ({ ...d, [key]: value }))

  async function save(close: boolean) {
    if (busy) return
    const built = subtaskInputFromDraft(draft, editing ? base : undefined)
    if ("error" in built) { setError(built.error); setDetails(true); return }
    if (editing && Object.keys(built.input).length === 0) { onCancel?.(); return }
    const checked = validateSubtaskInput(built.input, { partial: editing })
    if (!checked.ok) {
      setError(Object.values(checked.errors).join(" "))
      if (Object.keys(checked.errors).some((k) => k !== "title")) setDetails(true)
      return
    }
    setBusy(true)
    setError(null)
    const actions = await import("@/app/actions/tasks")
    const result = editing ? await actions.updateSubtask(subtaskId!, built.input) : await actions.addSubtask(parentTaskId, built.input)
    setBusy(false)
    if (!result.ok) { setError(result.error); return }
    if (!editing && !close) {
      setDraft(draftFrom(undefined, priority0))
      setAdded((n) => n + 1)
      titleRef.current?.focus()
    }
    await onSaved?.(result.data, { closed: editing || close })
  }

  function cancel() {
    setDraft(base)
    setError(null)
    onCancel?.()
  }

  const textareaClass = cn(controlClass, "min-h-16 w-full px-2.5 py-2 leading-5")

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void save(editing) }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); cancel() } }}
      className={cn("space-y-2 rounded-md border border-border-subtle bg-subtle/40 p-2", className)}
      aria-label={editing ? "Edit subtask" : "Add subtask"}
      data-subtask-form={editing ? "edit" : "create"}
    >
      <Input
        ref={titleRef}
        size={size}
        value={draft.title}
        onChange={(e) => set("title")(e.target.value)}
        placeholder={editing ? "Subtask title" : "Subtask title — Enter to add"}
        aria-label={editing ? "Subtask title" : "New subtask title"}
        maxLength={SUBTASK_TITLE_MAX}
        autoFocus
        enterKeyHint={editing ? "done" : "enter"}
        // Enter quick-adds and stays open for the next one (edit: saves).
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void save(editing) } }}
        data-subtask-title
      />

      <button
        type="button"
        onClick={() => setDetails((d) => !d)}
        aria-expanded={details}
        aria-controls={`${uid}-details`}
        className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg"
        data-subtask-details-toggle
      >
        {details ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronRight className="size-3.5" aria-hidden="true" />}
        {details ? "Fewer details" : "More details"}
        {!details && <span className="font-normal">· subtitle, description, effort, due date, priority, tags</span>}
      </button>

      {details && (
        <div id={`${uid}-details`} className="space-y-2" data-subtask-details>
          <Field label="Subtitle" optional id={`${uid}-subtitle`}>
            <Input size={size} value={draft.subtitle} onChange={(e) => set("subtitle")(e.target.value)} maxLength={SUBTASK_SUBTITLE_MAX} placeholder="A short summary" data-subtask-subtitle />
          </Field>
          <div>
            <label htmlFor={`${uid}-description`} className="mb-1 block text-ui font-medium text-fg">Description <span className="ml-1 font-normal text-fg-muted">Optional</span></label>
            <TaskDescriptionEditor id={`${uid}-description`} value={draft.description} onChange={set("description")} rows={compact ? 2 : 3} className={textareaClass} placeholder="Details, links, acceptance notes…" />
            {draft.description.length > SUBTASK_DESCRIPTION_MAX && <p className="mt-1 text-xs text-danger">At most {SUBTASK_DESCRIPTION_MAX.toLocaleString("en")} characters</p>}
          </div>
          <div className={cn("grid gap-2", compact ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4")}>
            <Field label="Estimate (h)" id={`${uid}-effort`}>
              <Input size={size} value={draft.effort} onChange={(e) => set("effort")(e.target.value)} placeholder="1.5 or 1h 30m" inputMode="decimal" data-subtask-effort />
            </Field>
            <Field label="Due date" id={`${uid}-due`}>
              <Input size={size} type="date" value={draft.due} onChange={(e) => set("due")(e.target.value)} min="2000-01-01" max="2100-12-31" data-subtask-due />
            </Field>
            <Field label="Priority" id={`${uid}-priority`}>
              <Select size={size} value={draft.priority} onChange={(e) => set("priority")(e.target.value)} options={SUBTASK_PRIORITY_OPTIONS} data-subtask-priority />
            </Field>
            <Field label="Tags" id={`${uid}-tags`}>
              <Input size={size} value={draft.tags} onChange={(e) => set("tags")(e.target.value)} placeholder="Comma separated" data-subtask-tags />
            </Field>
          </div>
        </div>
      )}

      {error && <InlineNotice tone="danger" onDismiss={() => setError(null)}>{error}</InlineNotice>}

      <div className="flex flex-wrap items-center gap-1.5">
        {editing ? (
          <Button type="submit" size="sm" loading={busy} disabled={!draft.title.trim()} data-subtask-save>Save</Button>
        ) : (
          <>
            <Button type="button" size="sm" loading={busy} disabled={!draft.title.trim()} onClick={() => void save(true)} data-subtask-add>Add</Button>
            <Button type="button" size="sm" variant="secondary" disabled={busy || !draft.title.trim()} onClick={() => void save(false)} data-subtask-add-another>Add another</Button>
          </>
        )}
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>{!editing && added > 0 ? "Done" : "Cancel"}</Button>
        {!editing && added > 0 && <span role="status" className="text-xs text-fg-muted">{added} added</span>}
      </div>
    </form>
  )
}
