"use client"

import { useEffect, useId, useRef, useState } from "react"
import Link from "next/link"
import * as Dialog from "@radix-ui/react-dialog"
import { Loader2, Play, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RunStatusBadge } from "@/components/ui/status-badge"
import { FormThemeScope } from "@/components/forms/form-theme-scope"
import type { FormThemeOverrides } from "@/lib/forms/form-theme"
import { getWorkflowRunInputs, runWorkflowNow } from "@/app/actions/workflow-start"
import { submitStandaloneForm } from "@/app/actions/forms"
import { serverRead } from "@/lib/server-read"
import { WorkflowStartFormView } from "@/components/forms/workflow-start-form-view"
import { planButtonEffects, type ButtonEffects, type FormButton } from "@/lib/forms/buttons"
import { formDefaultValues, formPagePath, startFormVariable, type WorkflowStartForm } from "@/lib/forms/workflow-start-form"
import { validateTaskFieldValues } from "@/lib/task-field-schema"
import type { StartWorkflowResult } from "@/lib/services/workflow-start"
import {
  initialFormValues,
  validateWorkflowInputs,
  type WorkflowInputError,
  type WorkflowInputField,
  type WorkflowInputSchema,
} from "@/lib/workflow-inputs"

/**
 * Manual run of a workflow: a "Run" button (workflow list rows, designer
 * header) and the dialog it opens. The dialog loads the workflow's input
 * parameters (published version), renders a form for them, and starts the
 * run through the same service as POST /api/v1/workflows/start — in the
 * background (queued) or waiting for the result.
 *
 * A workflow that starts from a form shows that form instead (the same view
 * as the Test runner, lib/forms/workflow-start-form):
 *  - "Form submitted" trigger → the linked form as its page draws it;
 *    submitting it is a REAL submission, exactly as /f/<id> (forms.submit,
 *    server-side validation, a form_submissions row, the button's
 *    behaviours, the form.submitted event) — which starts the workflow
 *    through its trigger (queued, attributed to the submitter).
 *  - designed start form → its grid and theme over the inputs; a normal
 *    manual run (workflows.activate; started by the user, via ui).
 * "Show as fields" keeps the plain inputs (and, for a form, a manual run).
 */

export interface RunnableWorkflow {
  id: string
  name: string
  is_active: boolean | null
  published_version_id?: string | null
}

/** Why a workflow cannot be run from the UI right now (null = it can). */
export function runDisabledReason(workflow: RunnableWorkflow): string | null {
  if (!workflow.published_version_id) return "Publish first: runs use the published version"
  if (!workflow.is_active) return "Activate the workflow first"
  return null
}

const fieldStyle = {
  borderColor: "var(--theme-surface-border)",
  backgroundColor: "var(--theme-topbar)",
  color: "var(--theme-topbar-text)",
}

type FormValues = Record<string, string | boolean>

/** The input form fields (stateless; the dialog owns the values). */
const SM_COLS = ["", "sm:grid-cols-1", "sm:grid-cols-2", "sm:grid-cols-3", "sm:grid-cols-4"]
const SM_SPAN = ["", "sm:col-span-1", "sm:col-span-2", "sm:col-span-3", "sm:col-span-4"]

export function WorkflowInputFields({ fields, values, errors, onChange, idPrefix = "wf-input", layout }: {
  fields: readonly WorkflowInputField[]
  values: FormValues
  errors: readonly WorkflowInputError[]
  onChange: (key: string, value: string | boolean) => void
  idPrefix?: string
  /** The start form's grid (form designer); rows collapse to one column on phones. */
  layout?: NonNullable<WorkflowInputSchema["start_form"]>["layout"]
}) {
  if (fields.length === 0) {
    return <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>This workflow has no input parameters.</p>
  }
  const renderField = (field: WorkflowInputField) => {
        const id = `${idPrefix}-${field.key}`
        const error = errors.find((e) => e.field === field.key)?.message
        const help = field.description ? `${id}-help` : undefined
        const errorId = error ? `${id}-error` : undefined
        const describedBy = [help, errorId].filter(Boolean).join(" ") || undefined
        const value = values[field.key]
        const common = {
          id,
          name: field.key,
          "aria-invalid": error ? true : undefined,
          "aria-describedby": describedBy,
          "aria-required": field.required || undefined,
        } as const
        let control: React.ReactNode
        if (field.type === "boolean") {
          control = (
            <label htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: "var(--theme-card-text)" }}>
              <input {...common} type="checkbox" checked={value === true} onChange={(e) => onChange(field.key, e.target.checked)} className="h-4 w-4" />
              {field.label}
              {field.required && <span aria-hidden="true" style={{ color: "var(--theme-danger)" }}>*</span>}
            </label>
          )
        } else if (field.type === "select") {
          control = (
            <select {...common} value={String(value ?? "")} onChange={(e) => onChange(field.key, e.target.value)}
              className="flex h-10 w-full rounded-lg border px-3 text-sm" style={fieldStyle}>
              <option value="">{field.required ? "Choose…" : "(none)"}</option>
              {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )
        } else if (field.type === "json") {
          control = (
            <textarea {...common} value={String(value ?? "")} onChange={(e) => onChange(field.key, e.target.value)}
              rows={4} spellCheck={false} placeholder='{"key": "value"}'
              className="w-full rounded-lg border px-3 py-2 font-mono text-xs" style={fieldStyle} />
          )
        } else {
          const type = field.type === "number" ? "number"
            : field.type === "date" ? "date"
            : field.type === "datetime" ? "datetime-local"
            : field.type === "email" ? "email"
            : field.type === "url" ? "url"
            : "text"
          control = (
            <Input {...common} type={type} value={String(value ?? "")} step={type === "number" ? "any" : undefined}
              onChange={(e) => onChange(field.key, e.target.value)} />
          )
        }
        return (
          <div key={field.key} data-input-type={field.type}>
            {field.type !== "boolean" && (
              <label htmlFor={id} className="mb-1 flex items-baseline gap-1 text-xs font-medium" style={{ color: "var(--theme-card-text)" }}>
                {field.label}
                {field.required && <span aria-hidden="true" style={{ color: "var(--theme-danger)" }}>*</span>}
                {/* The key is left out on a designed grid (narrow cells); the label's title still shows it. */}
                {!layout?.rows?.length && <span className="font-mono text-[10px] font-normal" style={{ color: "var(--theme-muted-text)" }}>{field.key}</span>}
              </label>
            )}
            {control}
            {field.description && <p id={help} className="mt-1 text-[11px]" style={{ color: "var(--theme-muted-text)" }}>{field.description}</p>}
            {error && <p id={errorId} role="alert" className="mt-1 text-[11px]" style={{ color: "var(--theme-danger)" }}>{error}</p>}
          </div>
        )
  }
  if (layout?.rows?.length) {
    const byKey = new Map(fields.map((f) => [f.key, f]))
    return (
      <div className="space-y-3" data-form-layout="grid">
        {layout.rows.filter((row) => row.cells.some((c) => byKey.has(c.field_key))).map((row, r) => (
          <div key={r} className={`grid grid-cols-1 gap-3 ${SM_COLS[Math.min(4, Math.max(1, row.columns))]}`}>
            {row.cells.filter((c) => byKey.has(c.field_key)).map((c) => (
              <div key={c.field_key} className={`min-w-0 ${SM_SPAN[Math.min(row.columns, Math.max(1, c.span))]}`}>{renderField(byKey.get(c.field_key)!)}</div>
            ))}
          </div>
        ))}
      </div>
    )
  }
  return <div className="space-y-3">{fields.map(renderField)}</div>
}

type ActionError = { error: string; fieldErrors?: WorkflowInputError[] }
const isActionError = (value: unknown): value is ActionError => Boolean(value && typeof value === "object" && "error" in value && typeof (value as ActionError).error === "string" && !("mode" in value))

/** Datetime-local values carry no zone: send them as ISO with the browser's offset. */
function toSubmitValues(fields: readonly WorkflowInputField[], values: FormValues): FormValues {
  const out: FormValues = { ...values }
  for (const field of fields) {
    const value = out[field.key]
    if (field.type === "datetime" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) out[field.key] = date.toISOString()
    }
  }
  return out
}

/** ISO default → the datetime-local control's value. */
function toFormValues(fields: readonly WorkflowInputField[]): FormValues {
  const values = initialFormValues(fields)
  for (const field of fields) {
    const value = values[field.key]
    if (field.type === "datetime" && typeof value === "string" && value) {
      const date = new Date(value)
      if (!Number.isNaN(date.getTime())) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        values[field.key] = local.toISOString().slice(0, 16)
      }
    }
  }
  return values
}

function ResultSummary({ result }: { result: StartWorkflowResult }) {
  if (result.mode === "async") {
    return (
      <div className="space-y-2 text-sm" role="status">
        <p style={{ color: "var(--theme-card-text)" }}>
          {result.run_id ? "Run started in the background." : "Run queued in the background."}
        </p>
        {result.run_id
          ? <Link href={`/automations/runs/${result.run_id}`} className="text-sm font-medium hover:underline" style={{ color: "var(--theme-primary-text)" }}>Open run →</Link>
          : <Link href="/automations/queue" className="text-sm font-medium hover:underline" style={{ color: "var(--theme-primary-text)" }}>View queue →</Link>}
      </div>
    )
  }
  const steps = Object.entries(result.node_results ?? {})
  const outputs = JSON.stringify(result.node_results ?? {}, null, 2)
  return (
    <div className="space-y-2 text-sm" role="status">
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--theme-card-text)" }}>Finished with status</span>
        <RunStatusBadge status={result.status} />
      </div>
      {result.error && <p className="text-xs" style={{ color: "var(--theme-danger)" }}>{result.error}</p>}
      <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>{steps.length} step{steps.length === 1 ? "" : "s"} ran.</p>
      {steps.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs" style={{ color: "var(--theme-muted-text)" }}>Outputs</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg p-2 text-[11px]" style={{ backgroundColor: "var(--theme-surface)", color: "var(--theme-card-text)" }}>
            {outputs.length > 6000 ? `${outputs.slice(0, 6000)}\n…` : outputs}
          </pre>
        </details>
      )}
      {result.run_id && (
        <Link href={`/automations/runs/${result.run_id}`} className="text-sm font-medium hover:underline" style={{ color: "var(--theme-primary-text)" }}>Open run →</Link>
      )}
    </div>
  )
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`
}

export function RunWorkflowDialog({ workflow, open, onOpenChange }: {
  workflow: { id: string; name: string } | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const idPrefix = useId()
  const [schema, setSchema] = useState<WorkflowInputSchema | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [values, setValues] = useState<FormValues>({})
  const [errors, setErrors] = useState<WorkflowInputError[]>([])
  const [mode, setMode] = useState<"async" | "sync">("async")
  const [priority, setPriority] = useState("50")
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [result, setResult] = useState<StartWorkflowResult | null>(null)
  // The form the workflow starts from (null until loaded / none).
  const [startForm, setStartForm] = useState<Exclude<WorkflowStartForm, { kind: "none" }> | null>(null)
  const [view, setView] = useState<"form" | "fields">("form")
  const [startFormLoaded, setStartFormLoaded] = useState(false)
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [formBusy, setFormBusy] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<{ effects: ButtonEffects; started: boolean } | null>(null)
  const keyRef = useRef(newKey())

  const workflowId = workflow?.id ?? null
  useEffect(() => {
    if (!open || !workflowId) return
    let cancelled = false
    setSchema(null); setLoadError(null); setErrors([]); setSubmitError(null); setResult(null); setMode("async"); setPriority("50")
    setStartForm(null); setStartFormLoaded(false); setView("form"); setFormValues({}); setFormErrors({}); setSubmitted(null); keyRef.current = newKey()
    void serverRead("automations.startForm", { workflow_id: workflowId }).then(({ data }) => {
      if (cancelled) return
      const spec = data as WorkflowStartForm | null
      if (spec && spec.kind !== "none") setStartForm(spec)
      setStartFormLoaded(true)
    })
    getWorkflowRunInputs(workflowId).then((res) => {
      if (cancelled) return
      if (isActionError(res)) { setLoadError(res.error); return }
      setSchema(res)
      setValues(toFormValues(res.fields))
    })
    return () => { cancelled = true }
  }, [open, workflowId])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!schema || !workflowId || submitting) return
    if (startForm?.kind === "start_form" && view === "form") {
      const formCheck = validateTaskFieldValues(startForm.fields, startFormShown())
      if (Object.keys(formCheck).length) { setFormErrors(formCheck); return }
      setFormErrors({})
    }
    const submitted = toSubmitValues(schema.fields, values)
    const checked = validateWorkflowInputs(schema.fields, submitted)
    const priorityNumber = Number(priority)
    const priorityError = !Number.isInteger(priorityNumber) || priorityNumber < 0 || priorityNumber > 100
    if (!checked.ok || priorityError) {
      setErrors(checked.errors)
      setSubmitError(priorityError ? "Priority must be a whole number from 0 to 100." : null)
      document.getElementById(`${idPrefix}-${checked.errors[0]?.field}`)?.focus()
      return
    }
    setErrors([]); setSubmitError(null); setSubmitting(true)
    try {
      const res = await runWorkflowNow({ workflowId, variables: checked.values, async: mode === "async", priority: priorityNumber })
      if (isActionError(res)) {
        setSubmitError(res.error)
        if (res.fieldErrors) setErrors(res.fieldErrors)
      } else {
        setResult(res)
      }
    } catch {
      setSubmitError("Could not start the workflow.")
    } finally {
      setSubmitting(false)
    }
  }

  const version = schema?.version_number ? `v${schema.version_number}` : null

  /** The start form's values (keyed by field key) over the input values (keyed by variable). */
  function startFormShown(): Record<string, unknown> {
    if (startForm?.kind !== "start_form") return {}
    const out: Record<string, unknown> = {}
    for (const field of startForm.fields) {
      const v = values[startForm.name_by_key[field.key] ?? field.key]
      if (v !== undefined) out[field.key] = field.type === "boolean" ? v === true || v === "true" : v
    }
    return out
  }

  const formShown = startForm?.kind === "form" ? { ...formDefaultValues(startForm.form.fields), ...formValues } : startFormShown()

  /** A button of the linked form: a real submission, as on /f/<id>. */
  async function pressFormButton(button: FormButton) {
    if (startForm?.kind !== "form" || formBusy) return
    setSubmitError(null)
    if (button.kind === "cancel") {
      const planned = planButtonEffects(button, { values: formShown })
      setFormValues({}); setFormErrors({})
      if (planned.close || planned.redirect || !planned.messages.length) onOpenChange(false)
      return
    }
    const clientErrors = validateTaskFieldValues(startForm.form.fields, formShown)
    if (Object.keys(clientErrors).length) { setFormErrors(clientErrors); return }
    setFormBusy(button.id)
    try {
      const res = await submitStandaloneForm(startForm.form.id, { values: formShown, button_id: button.id, idempotency_key: keyRef.current })
      if (!res.ok) {
        if (res.fields) setFormErrors(res.fields)
        setSubmitError(res.error)
        return
      }
      setFormErrors({})
      const listens = !startForm.button_ids.length || startForm.button_ids.some((b) => b === button.id || (button.outcome && b.toLowerCase() === button.outcome.toLowerCase()))
      setSubmitted({ effects: res.data.effects, started: listens })
    } catch {
      setSubmitError("Could not submit the form.")
    } finally {
      setFormBusy(null)
    }
  }

  const showForm = Boolean(startForm) && view === "form"

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 dialog-overlay" />
        <Dialog.Content
          className={`fixed left-1/2 top-1/2 z-50 flex max-h-[90vh] ${showForm ? "w-[min(48rem,96vw)]" : "w-[min(34rem,94vw)]"} -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl shadow-xl dialog-content`}
          style={{ backgroundColor: "var(--theme-card-bg)" }}
          aria-describedby={undefined}
        >
          <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "var(--theme-surface-border)" }}>
            <div className="min-w-0">
              <Dialog.Title className="flex items-center gap-2 text-lg font-semibold" style={{ color: "var(--theme-card-text)" }}>
                <Play size={16} style={{ color: "var(--theme-primary-text)" }} /> Run workflow
              </Dialog.Title>
              <p className="truncate text-xs" style={{ color: "var(--theme-muted-text)" }}>
                {workflow?.name}{version ? ` · ${version}` : ""}
              </p>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="rounded p-1 hover:opacity-70" style={{ color: "var(--theme-muted-text)" }} disabled={submitting}>
                <X size={16} />
              </button>
            </Dialog.Close>
          </div>

          {submitted && startForm?.kind === "form" ? (
            <div className="space-y-4 overflow-y-auto px-5 py-4" data-run-form-submitted>
              <WorkflowStartFormView spec={startForm} values={formShown} errors={{}} onChange={() => {}} onPress={() => {}}
                messages={submitted.effects.messages} successScreen={submitted.effects.success_screen ?? { title: "Submitted", button: "none" }}
                onSubmitAnother={() => { setSubmitted(null); setFormValues({}); keyRef.current = newKey() }} />
              <p className="text-xs" role="status" style={{ color: "var(--theme-muted-text)" }}>
                {submitted.started
                  ? "The submission was recorded and this workflow was queued from its Form submitted trigger (started by you)."
                  : "The submission was recorded, but this button does not start this workflow (the trigger listens to other buttons)."}
              </p>
              <div className="flex justify-end gap-2">
                <Link href="/automations/queue" className="text-sm font-medium hover:underline self-center" style={{ color: "var(--theme-primary-text)" }}>View queue →</Link>
                <Dialog.Close asChild><Button type="button" size="sm">Done</Button></Dialog.Close>
              </div>
            </div>
          ) : result ? (
            <div className="space-y-4 overflow-y-auto px-5 py-4">
              <ResultSummary result={result} />
              {result.warnings?.map((w) => <p key={w} className="text-[11px]" style={{ color: "var(--theme-muted-text)" }}>{w}</p>)}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setResult(null)}>Run again</Button>
                <Dialog.Close asChild><Button type="button" size="sm">Done</Button></Dialog.Close>
              </div>
            </div>
          ) : loadError ? (
            <p className="px-5 py-4 text-sm" style={{ color: "var(--theme-danger)" }}>{loadError}</p>
          ) : !schema || !startFormLoaded ? (
            <div className="flex items-center gap-2 px-5 py-6 text-sm" style={{ color: "var(--theme-muted-text)" }}>
              <Loader2 size={14} className="animate-spin" /> Loading inputs…
            </div>
          ) : showForm && startForm?.kind === "form" ? (
            <div className="space-y-3 overflow-y-auto px-5 py-4" data-run-start-form="form">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs" style={{ color: "var(--theme-muted-text)" }}>
                  This workflow starts when <Link href={formPagePath(startForm.form.id)} className="font-medium hover:underline" style={{ color: "var(--theme-primary-text)" }}>{startForm.form.name}</Link> is submitted. Submitting here is a real submission.
                </p>
                <RunViewToggle view={view} onChange={setView} />
              </div>
              <WorkflowStartFormView spec={startForm} idPrefix={`${idPrefix}-form-`} values={formShown} errors={formErrors}
                onChange={(key, value) => { setFormValues((prev) => ({ ...prev, [key]: value })); setFormErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next }) }}
                onPress={(b) => void pressFormButton(b)} busy={formBusy} failure={submitError} />
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="flex min-h-0 flex-col">
              <div className="space-y-4 overflow-y-auto px-5 py-4">
                {!schema.published && (
                  <p className="text-xs" style={{ color: "var(--theme-warning)" }}>This workflow has not been published: the run uses the draft.</p>
                )}
                <fieldset>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <legend className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>Inputs</legend>
                    {startForm && <RunViewToggle view={view} onChange={setView} />}
                  </div>
                  {showForm && startForm?.kind === "start_form" ? (
                    <WorkflowStartFormView spec={startForm} idPrefix={`${idPrefix}-sf-`} values={startFormShown()} hideButtons
                      errors={{ ...Object.fromEntries(errors.map((e) => [Object.entries(startForm.name_by_key).find(([, n]) => n === e.field)?.[0] ?? e.field, e.message])), ...formErrors }}
                      onChange={(key, value) => {
                        const v = startFormVariable(startForm, key, value)
                        setValues((prev) => ({ ...prev, [v.name]: typeof value === "boolean" ? value : v.value }))
                        setFormErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
                      }}
                      onPress={() => {}} />
                  ) : (
                    <FormThemeScope overrides={(schema.start_form?.theme ?? null) as FormThemeOverrides | null}>
                      <WorkflowInputFields fields={schema.fields} values={values} errors={errors} idPrefix={idPrefix} layout={schema.start_form?.layout ?? null}
                        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))} />
                    </FormThemeScope>
                  )}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--theme-muted-text)" }}>Options</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Run mode">
                    {([
                      ["async", "Run in background", "Queue it and continue"],
                      ["sync", "Wait for result", "Run now and show the outcome"],
                    ] as const).map(([value, label, hint]) => (
                      <label key={value} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-sm"
                        // Option cards keep sentence case even when the theme uppercases labels.
                        style={{ borderColor: mode === value ? "var(--theme-primary)" : "var(--theme-surface-border)", color: "var(--theme-card-text)", textTransform: "none", letterSpacing: "normal" }}>
                        <input type="radio" name={`${idPrefix}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1" />
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span className="block text-[11px]" style={{ color: "var(--theme-muted-text)" }}>{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {mode === "async" && (
                    <div className="flex items-center gap-2">
                      <label htmlFor={`${idPrefix}-priority`} className="text-xs" style={{ color: "var(--theme-card-text)" }}>Queue priority</label>
                      <Input id={`${idPrefix}-priority`} type="number" min={0} max={100} step={1} value={priority}
                        onChange={(e) => setPriority(e.target.value)} className="!h-8 !w-20 !text-xs" />
                      <span className="text-[11px]" style={{ color: "var(--theme-muted-text)" }}>0–100, higher runs first</span>
                    </div>
                  )}
                </fieldset>

                {submitError && <p role="alert" className="text-xs" style={{ color: "var(--theme-danger)" }}>{submitError}</p>}
              </div>
              <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--theme-surface-border)" }}>
                <Dialog.Close asChild><Button type="button" variant="outline" size="sm" disabled={submitting}>Cancel</Button></Dialog.Close>
                <Button type="submit" size="sm" disabled={submitting}>
                  {submitting ? <><Loader2 size={13} className="animate-spin" /> {mode === "sync" ? "Running…" : "Starting…"}</> : <><Play size={13} /> Run</>}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** "Show as fields" / "Show as form". */
function RunViewToggle({ view, onChange }: { view: "form" | "fields"; onChange: (view: "form" | "fields") => void }) {
  return (
    <button type="button" onClick={() => onChange(view === "form" ? "fields" : "form")} data-run-form-view={view}
      className="shrink-0 rounded px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
      style={{ color: "var(--theme-primary-text)", backgroundColor: "var(--theme-primary-light)" }}>
      {view === "form" ? "Show as fields" : "Show as form"}
    </button>
  )
}

/**
 * The Run button. Hidden without workflows.activate (`canRun`); disabled with
 * the reason as tooltip while the workflow is unpublished or inactive. It
 * stays focusable when disabled so keyboard users can read the reason.
 */
export function RunWorkflowButton({ workflow, canRun, onRun, compact = false, className }: {
  workflow: RunnableWorkflow
  canRun: boolean
  onRun: (workflow: RunnableWorkflow) => void
  compact?: boolean
  className?: string
}) {
  if (!canRun) return null
  const reason = runDisabledReason(workflow)
  const label = reason ?? `Run ${workflow.name}`
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      aria-disabled={reason ? true : undefined}
      aria-label={compact ? label : undefined}
      title={reason ?? "Run this workflow now"}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!reason) onRun(workflow)
      }}
      className={`${compact ? "!h-7 !px-2 !text-[11px]" : "!h-7 !text-xs"} ${reason ? "opacity-50 cursor-not-allowed" : ""} ${className ?? ""}`}
    >
      <Play size={12} /> Run
    </Button>
  )
}
