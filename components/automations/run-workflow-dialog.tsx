"use client"

import { formAnimation } from "@/lib/forms/motion"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { useSubmitGuard } from '@/hooks/use-submit-guard'
import Link from "next/link"
import { Loader2, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog"
import { plural } from "@/lib/format/plural"
import { RunStatusBadge } from "@/components/ui/status-badge"
import { FormThemeScope } from "@/components/forms/form-theme-scope"
import type { FormThemeOverrides } from "@/lib/forms/form-theme"
import { getWorkflowRunInputs, runWorkflowNow } from "@/app/actions/workflow-start"
import { submitRunDialogForm } from "@/app/actions/forms"
import { serverRead } from "@/lib/server-read"
import { WorkflowStartFormView } from "@/components/forms/workflow-start-form-view"
import { DraftResumePrompt, FormHeaderActions, useFormDraft } from "@/components/forms/form-header-actions"
import { AttachmentsField, FormAttachmentsProvider } from "@/components/forms/attachments-field"
import { planButtonEffects, type ButtonEffects, type FormButton } from "@/lib/forms/buttons"
import { freshSubmissionValues } from "@/lib/forms/submitted-page"
import { formAppPath } from "@/lib/forms/form-page-url"
import { formDefaultValues, startFormVariable, type WorkflowStartForm } from "@/lib/forms/workflow-start-form"
import { validateTaskFieldValues } from "@/lib/task-field-schema"
import { isImplicitSubmitKey } from "@/lib/automations/test-form-start"
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
    return <p className="text-xs text-fg-muted">This workflow has no input parameters.</p>
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
            <label htmlFor={id} className="flex cursor-pointer items-center gap-2 text-ui text-fg">
              <Checkbox {...common} checked={value === true} onChange={(e) => onChange(field.key, e.target.checked)} />
              {field.label}
              {field.required && <span aria-hidden="true" className="text-danger">*</span>}
            </label>
          )
        } else if (field.type === "select") {
          control = (
            <Select {...common} value={String(value ?? "")} onChange={(e) => onChange(field.key, e.target.value)}>
              <option value="">{field.required ? "Choose…" : "(none)"}</option>
              {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          )
        } else if (field.type === "attachments") {
          // Uploaded into the workflow's start context; the value is the file list (JSON text in the form state).
          control = (
            <AttachmentsField
              field={{ key: field.key, label: field.label, type: "attachments", ...(field.required ? { required: true } : {}), ...(field.attachments ? { attachments: field.attachments } : {}) }}
              value={value}
              onChange={(files) => onChange(field.key, files.length ? JSON.stringify(files) : "")}
              id={id}
              describedBy={describedBy}
              invalid={Boolean(error)}
            />
          )
        } else if (field.type === "json") {
          control = (
            <Textarea {...common} value={String(value ?? "")} onChange={(e) => onChange(field.key, e.target.value)}
              rows={4} spellCheck={false} placeholder='{"key": "value"}'
              className="font-mono text-xs" />
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
              <label htmlFor={id} className="mb-1.5 flex items-baseline gap-1 text-ui font-medium text-fg">
                {field.label}
                {field.required && <span aria-hidden="true" className="text-danger">*</span>}
                {/* The key is left out on a designed grid (narrow cells); the label's title still shows it. */}
                {!layout?.rows?.length && <span className="font-mono text-2xs font-normal text-fg-muted">{field.key}</span>}
              </label>
            )}
            {control}
            {field.description && <p id={help} className="mt-1 text-xs text-fg-muted">{field.description}</p>}
            {error && <p id={errorId} role="alert" className="mt-1 text-xs text-danger">{error}</p>}
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
        <p className="text-fg">
          {result.run_id ? "Run started in the background." : "Run queued in the background."}
        </p>
        {result.run_id
          ? <Link href={`/automations/runs/${result.run_id}`} className="text-sm font-medium text-primary-text hover:underline">Open run →</Link>
          : <Link href="/automations/queue" className="text-sm font-medium text-primary-text hover:underline">View queue →</Link>}
      </div>
    )
  }
  const steps = Object.entries(result.node_results ?? {})
  const outputs = JSON.stringify(result.node_results ?? {}, null, 2)
  return (
    <div className="space-y-2 text-sm" role="status">
      <div className="flex items-center gap-2">
        <span className="text-fg">Finished with status</span>
        <RunStatusBadge status={result.status} />
      </div>
      {result.error && <p className="text-xs text-danger">{result.error}</p>}
      <p className="text-xs text-fg-muted">{plural(steps.length, "step")} ran.</p>
      {steps.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-fg-muted">Outputs</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border-subtle bg-subtle p-2 font-mono text-2xs text-fg">
            {outputs.length > 6000 ? `${outputs.slice(0, 6000)}\n…` : outputs}
          </pre>
        </details>
      )}
      {result.run_id && (
        <Link href={`/automations/runs/${result.run_id}`} className="text-sm font-medium text-primary-text hover:underline">Open run →</Link>
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
  // Synchronous guard: two clicks / Enters in one frame would start two runs.
  const runGuard = useSubmitGuard()
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
  // A workflow that starts from a reusable form: its favourite heart and Save draft icons, as on /f/<id>.
  const linkedForm = startForm?.kind === "form" ? startForm.form : null
  const drafts = useFormDraft(open ? linkedForm?.id ?? null : null, linkedForm?.layout)
  const [draftDecided, setDraftDecided] = useState(false)
  const offerDraft = drafts.draft && !draftDecided && !Object.keys(formValues).length ? drafts.draft : null

  const workflowId = workflow?.id ?? null
  useEffect(() => {
    if (!open || !workflowId) return
    let cancelled = false
    setSchema(null); setLoadError(null); setErrors([]); setSubmitError(null); setResult(null); setMode("async"); setPriority("50")
    setStartForm(null); setStartFormLoaded(false); setView("form"); setFormValues({}); setFormErrors({}); setSubmitted(null); setDraftDecided(false); keyRef.current = newKey()
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
    await runGuard.run(async () => {
      if (!schema || !workflowId || submitting) return
      if (startForm?.kind === "start_form" && view === "form") {
        const formCheck = validateTaskFieldValues(startForm.fields, startFormShown(), { layout: startForm.layout })
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
    })
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

  // One object per change (a steps start form jumps to the first error when it gets new errors).
  const startFormErrors = useMemo(() => (startForm?.kind === "start_form"
    ? { ...Object.fromEntries(errors.map((e) => [Object.entries(startForm.name_by_key).find(([, n]) => n === e.field)?.[0] ?? e.field, e.message])), ...formErrors }
    : formErrors), [startForm, errors, formErrors])

  const formShown = startForm?.kind === "form" ? { ...formDefaultValues(startForm.form.fields), ...formValues } : startFormShown()

  /** A button of the linked form: a real submission, as on /f/<id>. */
  async function pressFormButton(button: FormButton) {
    await runGuard.run(async () => {
      if (startForm?.kind !== "form" || formBusy) return
      setSubmitError(null)
      if (button.kind === "cancel") {
        const planned = planButtonEffects(button, { values: formShown })
        setFormValues({}); setFormErrors({})
        if (planned.close || planned.redirect || !planned.messages.length) onOpenChange(false)
        return
      }
      const clientErrors = validateTaskFieldValues(startForm.form.fields, formShown, { layout: startForm.form.layout })
      if (Object.keys(clientErrors).length) { setFormErrors(clientErrors); return }
      setFormBusy(button.id)
      try {
        const res = await submitRunDialogForm(startForm.form.id, { values: formShown, button_id: button.id, idempotency_key: keyRef.current })
        if (!res.ok) {
          if (res.fields) setFormErrors(res.fields)
          setSubmitError(res.error)
          return
        }
        setFormErrors({})
        drafts.submitted()
        setDraftDecided(true)
        const listens = !startForm.button_ids.length || startForm.button_ids.some((b) => b === button.id || (button.outcome && b.toLowerCase() === button.outcome.toLowerCase()))
        setSubmitted({ effects: res.data.effects, started: listens })
      } catch {
        setSubmitError("Could not submit the form.")
      } finally {
        setFormBusy(null)
      }
    })
  }

  const showForm = Boolean(startForm) && view === "form"

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent
        size={showForm ? "lg" : "md"}
        className="max-h-[90vh]"
        title={<span className="flex items-center gap-2"><Play size={16} className="text-primary-text" aria-hidden="true" /> Run workflow</span>}
        description={<span className="block truncate">{workflow?.name}{version ? ` · ${version}` : ""}</span>}
      >
          {submitted && startForm?.kind === "form" ? (
            <>
              <DialogBody className="space-y-4" data-run-form-submitted>
                <WorkflowStartFormView sized spec={startForm} values={formShown} errors={{}} onChange={() => {}} onPress={() => {}}
                  messages={submitted.effects.messages} successScreen={submitted.effects.success_screen ?? { title: "Submitted", button: "none" }}
                  onSubmitAnother={() => { setSubmitted(null); setFormValues(freshSubmissionValues(formValues)); keyRef.current = newKey() }}
                  onClose={() => onOpenChange(false)} />
                <p className="text-xs text-fg-muted" role="status">
                  {submitted.started
                    ? "The submission was recorded and this workflow was queued from its Form submitted trigger (started by you)."
                    : "The submission was recorded, but this button does not start this workflow (the trigger listens to other buttons)."}
                </p>
              </DialogBody>
              <DialogFooter>
                <Button asChild variant="link" size="sm"><Link href="/automations/queue">View queue →</Link></Button>
                <DialogClose asChild><Button type="button" size="sm">Done</Button></DialogClose>
              </DialogFooter>
            </>
          ) : result ? (
            <>
              <DialogBody className="space-y-4">
                <ResultSummary result={result} />
                {result.warnings?.map((w) => <p key={w} className="text-xs text-fg-muted">{w}</p>)}
              </DialogBody>
              <DialogFooter>
                <Button type="button" variant="secondary" size="sm" onClick={() => setResult(null)}>Run again</Button>
                <DialogClose asChild><Button type="button" size="sm">Done</Button></DialogClose>
              </DialogFooter>
            </>
          ) : loadError ? (
            <DialogBody><p className="text-sm text-danger">{loadError}</p></DialogBody>
          ) : !schema || !startFormLoaded ? (
            <DialogBody className="flex items-center gap-2 py-6 text-fg-muted">
              <Loader2 size={14} className="animate-spin" /> Loading inputs…
            </DialogBody>
          ) : showForm && startForm?.kind === "form" ? (
            <DialogBody className="space-y-3" data-run-start-form="form">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-fg-muted">
                  This workflow starts when <Link href={formAppPath(startForm.form.id)} className="font-medium text-primary-text hover:underline">{startForm.form.name}</Link> is submitted. Submitting here is a real submission.
                </p>
                <RunViewToggle view={view} onChange={setView} />
              </div>
              <FormHeaderActions form={startForm.form} drafts={drafts} onSave={() => { setDraftDecided(true); void drafts.save(formValues) }} />
              {offerDraft && (
                <DraftResumePrompt draft={offerDraft}
                  onResume={() => { setFormValues({ ...offerDraft.values }); setFormErrors({}); setDraftDecided(true) }}
                  onFresh={() => { setDraftDecided(true); void drafts.discard() }} />
              )}
              <WorkflowStartFormView sized spec={startForm} idPrefix={`${idPrefix}-form-`} values={formShown} errors={formErrors}
                onChange={(key, value) => { setFormValues((prev) => ({ ...prev, [key]: value })); setFormErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next }) }}
                onPress={(b) => void pressFormButton(b)} busy={formBusy} failure={submitError} />
            </DialogBody>
          ) : (
            <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col"
              // A workflow that starts from a form runs from the Run button only:
              // Enter while filling the form in never starts it.
              onKeyDown={(e) => { if (startForm && isImplicitSubmitKey({ key: e.key, isComposing: e.nativeEvent.isComposing, target: e.target as HTMLInputElement })) e.preventDefault() }}>
              <DialogBody className="space-y-5">
                {!schema.published && (
                  <p className="text-xs text-warning">This workflow has not been published: the run uses the draft.</p>
                )}
                <fieldset>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <legend className="text-sm font-semibold text-fg">Inputs</legend>
                    {startForm && <RunViewToggle view={view} onChange={setView} />}
                  </div>
                  <FormAttachmentsProvider source={workflowId ? { kind: "start", workflowId } : null}>
                  {showForm && startForm?.kind === "start_form" ? (
                    <WorkflowStartFormView sized spec={startForm} idPrefix={`${idPrefix}-sf-`} values={startFormShown()} hideButtons
                      errors={startFormErrors}
                      onChange={(key, value) => {
                        const v = startFormVariable(startForm, key, value)
                        setValues((prev) => ({ ...prev, [v.name]: typeof value === "boolean" ? value : v.value }))
                        setFormErrors((prev) => { if (!prev[key]) return prev; const next = { ...prev }; delete next[key]; return next })
                      }}
                      onPress={() => {}} />
                  ) : (
                    <FormThemeScope overrides={(schema.start_form?.theme ?? null) as FormThemeOverrides | null} motion={formAnimation(schema.start_form?.layout ?? null)}>
                      <WorkflowInputFields fields={schema.fields} values={values} errors={errors} idPrefix={idPrefix} layout={schema.start_form?.layout ?? null}
                        onChange={(key, value) => setValues((prev) => ({ ...prev, [key]: value }))} />
                    </FormThemeScope>
                  )}
                  </FormAttachmentsProvider>
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-2 text-sm font-semibold text-fg">Options</legend>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Run mode">
                    {([
                      ["async", "Run in background", "Queue it and continue"],
                      ["sync", "Wait for result", "Run now and show the outcome"],
                    ] as const).map(([value, label, hint]) => (
                      <label key={value}
                        // Option cards keep sentence case even when the theme uppercases labels.
                        className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-ui text-fg normal-case tracking-normal transition-colors duration-[var(--ds-dur-fast)] ${mode === value ? "border-primary bg-primary-wash" : "border-border hover:border-border-strong"}`}>
                        <input type="radio" name={`${idPrefix}-mode`} value={value} checked={mode === value} onChange={() => setMode(value)} className="mt-1 accent-primary" />
                        <span>
                          <span className="block font-medium">{label}</span>
                          <span className="block text-xs text-fg-muted">{hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {mode === "async" && (
                    <div className="flex items-center gap-2 pt-1">
                      <label htmlFor={`${idPrefix}-priority`} className="text-ui text-fg">Queue priority</label>
                      <Input id={`${idPrefix}-priority`} size="sm" type="number" min={0} max={100} step={1} value={priority}
                        onChange={(e) => setPriority(e.target.value)} className="w-20" />
                      <span className="text-xs text-fg-muted">0–100, higher runs first</span>
                    </div>
                  )}
                </fieldset>

                {submitError && <p role="alert" className="text-xs text-danger">{submitError}</p>}
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild><Button type="button" variant="secondary" disabled={submitting}>Cancel</Button></DialogClose>
                <Button type="submit" disabled={submitting} loading={submitting} leadingIcon={submitting ? undefined : <Play size={14} />}>
                  {submitting ? (mode === "sync" ? "Running…" : "Starting…") : "Run"}
                </Button>
              </DialogFooter>
            </form>
          )}
      </DialogContent>
    </Dialog>
  )
}

/** "Show as fields" / "Show as form". */
function RunViewToggle({ view, onChange }: { view: "form" | "fields"; onChange: (view: "form" | "fields") => void }) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={() => onChange(view === "form" ? "fields" : "form")} data-run-form-view={view}>
      {view === "form" ? "Show as fields" : "Show as form"}
    </Button>
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
      variant="secondary"
      size="sm"
      aria-disabled={reason ? true : undefined}
      aria-label={compact ? label : undefined}
      title={reason ?? "Run this workflow now"}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (!reason) onRun(workflow)
      }}
      leadingIcon={<Play />}
      className={`${compact ? "px-2" : ""} ${className ?? ""}`}
    >
      Run
    </Button>
  )
}
