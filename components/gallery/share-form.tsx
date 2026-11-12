"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { AlertCircle, ArrowRight, CheckCircle2, Clock, Mail, Upload } from "lucide-react"
import { GALLERY_CATEGORIES } from "@/lib/gallery/types"
import { SHARE_FIELD_LABELS, shareValuesFrom, validateShareField, validateShareForm, type ShareField } from "@/lib/gallery/share-validation"

const LICENCES = ["Apache-2.0", "MIT", "BSD-3-Clause", "MPL-2.0", "CC-BY-4.0", "CC0-1.0", "GPL-3.0-only"]
const input = "w-full min-w-0 rounded-lg border bg-(color:--mkt-white) px-3 py-2 text-sm text-(color:--mkt-ink) placeholder:text-(color:--mkt-subtle) outline-none transition-colors focus:border-(color:--mkt-bronze) focus:ring-2 focus:ring-(color:--mkt-gold)/30 file:mr-3 file:rounded-md file:border-0 file:bg-(color:--mkt-sand) file:px-3 file:py-1 file:text-sm file:font-semibold file:text-(color:--mkt-ink-soft)"
const inputClass = (invalid: boolean) => `${input} ${invalid ? "border-[#A0533F]/70 bg-[#A0533F]/[0.03]" : "border-(color:--mkt-ink)/15"}`

type Errors = Partial<Record<ShareField, string>>

/** A labelled control with its hint and error linked by aria-describedby. */
function Field({ name, label, hint, optional, error, counter, children }: {
  name: string
  label: string
  hint?: ReactNode
  optional?: boolean
  error?: string
  counter?: ReactNode
  children: (props: { id: string; "aria-describedby"?: string; "aria-invalid"?: true; className: string }) => ReactNode
}) {
  const id = `share-${name}`
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="grid min-w-0 content-start gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-(color:--mkt-ink-soft)">{label}{optional && <span className="ml-1 font-normal text-(color:--mkt-muted)">(optional)</span>}</label>
        {counter}
      </div>
      {children({ id, "aria-describedby": describedBy, ...(error ? { "aria-invalid": true as const } : {}), className: inputClass(Boolean(error)) })}
      {hint && <p id={`${id}-hint`} className="text-xs leading-5 text-(color:--mkt-muted)">{hint}</p>}
      {error && <p id={`${id}-error`} className="flex items-start gap-1.5 text-xs font-medium leading-5 text-[#A0533F]" data-testid={`share-error-${name}`}><AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />{error}</p>}
    </div>
  )
}

function Counter({ n, min, max }: { n: number; min: number; max: number }) {
  const off = n > 0 && (n < min || n > max)
  return <span aria-hidden="true" className={`num text-2xs ${off ? "text-[#A0533F]" : "text-(color:--mkt-subtle)"}`}>{n}/{max}</span>
}

function Step({ n, title, intro, children }: { n: number; title: string; intro?: string; children: ReactNode }) {
  return (
    <fieldset className={`grid min-w-0 gap-5 ${n > 1 ? "border-t border-(color:--mkt-ink)/[0.07] pt-6" : ""}`}>
      <legend className="float-left flex w-full items-center gap-3 text-base font-semibold text-(color:--mkt-ink)">
        <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-(color:--mkt-primary) text-xs font-bold text-(color:--mkt-paper)">{n}</span>
        {title}
      </legend>
      {intro && <p className="clear-both -mt-2 text-sm leading-6 text-(color:--mkt-text)">{intro}</p>}
      <div className="clear-both grid min-w-0 gap-5">{children}</div>
    </fieldset>
  )
}

/** "Share your solution": upload a .utpkg with its listing; validated at once, then queued for a moderator. */
export function ShareForm({ defaultAuthor }: { defaultAuthor: string }) {
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string; issues?: Array<{ path: string; message: string }>; title?: string }>({ status: "idle" })
  const [errors, setErrors] = useState<Errors>({})
  const [summaryShown, setSummaryShown] = useState(false)
  const [lengths, setLengths] = useState({ summary: 0, description: 0 })
  const formRef = useRef<HTMLFormElement>(null)
  const summaryRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef<HTMLDivElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (state.status === "done") doneRef.current?.focus() }, [state.status])
  useEffect(() => { if (state.status === "error") errorRef.current?.focus() }, [state.status])

  /** Re-checks a field that already shows a message, as the person fixes it. */
  const recheck = (field: ShareField) => {
    if (!errors[field] || !formRef.current) return
    const message = validateShareField(field, shareValuesFrom(new FormData(formRef.current)))
    setErrors((prev) => {
      const next = { ...prev }
      if (message) next[field] = message
      else delete next[field]
      return next
    })
  }

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const found = validateShareForm(shareValuesFrom(form))
    setErrors(found)
    const first = Object.keys(found)[0] as ShareField | undefined
    if (first) {
      if (found.notes || found.sample_input) formRef.current?.querySelector("details")?.setAttribute("open", "")
      setSummaryShown(true)
      setState({ status: "idle" })
      requestAnimationFrame(() => summaryRef.current?.focus())
      return
    }
    setSummaryShown(false)
    const sample = String(form.get("sample_input") ?? "").trim()
    let sampleInput: unknown
    if (sample) {
      try { sampleInput = JSON.parse(sample) } catch { setState({ status: "error", message: "Sample input must be a JSON object" }); return }
    }
    const listing = {
      title: form.get("title"), summary: form.get("summary"), description: form.get("description"), category: form.get("category"),
      tags: String(form.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean), licence: form.get("licence") || "Apache-2.0",
      author_name: form.get("author_name"), author_url: String(form.get("author_url") ?? "").trim() || undefined,
      notes: String(form.get("notes") ?? "").trim() || undefined,
      ...(sampleInput ? { sample_input: sampleInput } : {}),
      ...(form.get("expect") ? { expect: form.get("expect") } : {}),
    }
    const body = new FormData()
    body.set("file", form.get("file") as File)
    body.set("listing", JSON.stringify(listing))
    for (const shot of form.getAll("screenshots")) if (shot instanceof File && shot.size) body.append("screenshots", shot)
    setState({ status: "sending" })
    const res = await fetch("/api/gallery/submissions", { method: "POST", body }).catch(() => null)
    const json = await res?.json().catch(() => null)
    if (res?.ok) setState({ status: "done", title: json?.submission?.title })
    else setState({ status: "error", message: json?.error ?? "The upload failed", issues: json?.details?.issues })
  }

  if (state.status === "done") {
    return (
      <div ref={doneRef} tabIndex={-1} className="mkt-ring p-6 outline-none sm:p-8" role="status" data-testid="share-done">
        <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-(color:--mkt-green)/[0.12] text-(color:--mkt-green)"><CheckCircle2 size={26} /></span>
        <p className="mt-4 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-(color:--mkt-ink)">Thanks: &ldquo;{state.title}&rdquo; is waiting for review</p>
        <p className="mt-2 max-w-xl text-sm leading-6 text-(color:--mkt-text)">It passed the automatic checks. A moderator reviews it next; nothing is public until it is approved, and we will email you the decision.</p>
        <ol className="mt-6 grid gap-3 text-sm sm:grid-cols-3">
          <li className="flex gap-2 rounded-xl bg-(color:--mkt-green)/[0.08] p-3"><CheckCircle2 size={16} className="mt-0.5 shrink-0 text-(color:--mkt-green)" aria-hidden="true" /><span><strong className="block font-semibold text-(color:--mkt-ink)">Checked</strong>Automatic validation passed</span></li>
          <li className="flex gap-2 rounded-xl bg-(color:--mkt-sand) p-3"><Clock size={16} className="mt-0.5 shrink-0 text-(color:--mkt-gold-deep)" aria-hidden="true" /><span><strong className="block font-semibold text-(color:--mkt-ink)">In review</strong>A moderator test-installs it</span></li>
          <li className="flex gap-2 rounded-xl bg-(color:--mkt-sand) p-3"><Mail size={16} className="mt-0.5 shrink-0 text-(color:--mkt-muted)" aria-hidden="true" /><span><strong className="block font-semibold text-(color:--mkt-ink)">Decision</strong>Emailed to you, listed if approved</span></li>
        </ol>
        <button type="button" onClick={() => { setErrors({}); setState({ status: "idle" }) }} className="mt-6 inline-flex items-center gap-1.5 rounded-lg text-sm font-semibold text-(color:--mkt-bronze) outline-none hover:underline focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)">Share another <ArrowRight size={14} aria-hidden="true" /></button>
      </div>
    )
  }

  const errorList = Object.entries(errors) as Array<[ShareField, string]>
  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} className="mkt-ring grid min-w-0 gap-8 p-5 sm:p-7" data-testid="share-form" aria-describedby="share-required-note">
      <p id="share-required-note" className="-mb-3 text-xs text-(color:--mkt-muted)">Every field is required unless it says optional.</p>
      {summaryShown && errorList.length > 0 && (
        <div ref={summaryRef} tabIndex={-1} role="alert" aria-labelledby="share-error-summary-title" className="rounded-xl border border-[#A0533F]/30 bg-[#A0533F]/[0.06] p-4 text-sm text-[#7A3B2C] outline-none focus-visible:ring-2 focus-visible:ring-[#A0533F]/40" data-testid="share-error-summary">
          <p id="share-error-summary-title" className="flex items-center gap-2 font-semibold"><AlertCircle size={16} aria-hidden="true" /> Fix {errorList.length === 1 ? "this" : `these ${errorList.length}`} before you submit</p>
          <ul className="mt-2 grid gap-1 pl-6">
            {errorList.map(([field, message]) => (
              <li key={field} className="list-disc"><a href={`#share-${field}`} onClick={(e) => { e.preventDefault(); const el = document.getElementById(`share-${field}`); if (el) { el.closest("details")?.setAttribute("open", ""); el.focus() } }} className="font-semibold underline underline-offset-2">{SHARE_FIELD_LABELS[field]}</a>: {message}</li>
            ))}
          </ul>
        </div>
      )}

      <Step n={1} title="Package" intro="The .utpkg you built in Automations → Packages (or with usertasks packages build). Up to 5 MB; secrets are never included in a package.">
        <Field name="file" label="Package file (.utpkg)" error={errors.file}>
          {(p) => <input {...p} type="file" name="file" accept=".utpkg" required onChange={() => recheck("file")} />}
        </Field>
      </Step>

      <Step n={2} title="Listing" intro="What people see on the card and the package page.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="title" label="Title" error={errors.title}>
            {(p) => <input {...p} name="title" required minLength={3} maxLength={80} placeholder="Visitor sign-in" onChange={() => recheck("title")} />}
          </Field>
          <Field name="category" label="Category" error={errors.category}>
            {(p) => (
              <select {...p} name="category" required defaultValue="" onChange={() => recheck("category")}>
                <option value="" disabled>Choose a category</option>
                {GALLERY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field name="summary" label="Summary" hint="One sentence for the card (40-200 characters)." error={errors.summary} counter={<Counter n={lengths.summary} min={40} max={200} />}>
          {(p) => <input {...p} name="summary" required minLength={40} maxLength={200} onChange={(e) => { setLengths((l) => ({ ...l, summary: e.target.value.trim().length })); recheck("summary") }} />}
        </Field>
        <Field name="description" label="Description" hint="What it does, how it starts and what to adapt. Plain text; blank lines separate paragraphs (at least 100 characters)." error={errors.description} counter={<Counter n={lengths.description} min={100} max={6000} />}>
          {(p) => <textarea {...p} name="description" required minLength={100} maxLength={6000} rows={6} onChange={(e) => { setLengths((l) => ({ ...l, description: e.target.value.trim().length })); recheck("description") }} />}
        </Field>
        <Field name="tags" label="Tags" hint="Comma separated, up to 8." error={errors.tags}>
          {(p) => <input {...p} name="tags" required placeholder="visitors, reception, forms" onChange={() => recheck("tags")} />}
        </Field>
      </Step>

      <Step n={3} title="Author and licence" intro="Shown publicly on the listing. Your name and link are not verified by UserTasks, and the listing says so.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field name="author_name" label="Author name (shown publicly)" error={errors.author_name}>
            {(p) => <input {...p} name="author_name" required minLength={2} maxLength={60} defaultValue={defaultAuthor} autoComplete="name" onChange={() => recheck("author_name")} />}
          </Field>
          <Field name="author_url" label="Author link" optional error={errors.author_url}>
            {(p) => <input {...p} name="author_url" type="url" maxLength={300} placeholder="https://" autoComplete="url" onChange={() => recheck("author_url")} />}
          </Field>
        </div>
        <Field name="licence" label="Licence" hint="Apache-2.0 unless you choose otherwise.">
          {(p) => <select {...p} name="licence" defaultValue="Apache-2.0">{LICENCES.map((l) => <option key={l} value={l}>{l}</option>)}</select>}
        </Field>
      </Step>

      <Step n={4} title="Screenshots and test run" intro="Optional, but they help people choose it and help the moderators test it.">
        <Field name="screenshots" label="Screenshots" optional hint="Up to 6 PNG, JPEG, WebP or SVG images, 2 MB each. SVGs are sanitised; use demo data only." error={errors.screenshots}>
          {(p) => <input {...p} type="file" name="screenshots" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple onChange={() => recheck("screenshots")} />}
        </Field>
        <details className="group rounded-xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-paper) p-4">
          <summary className="cursor-pointer rounded text-sm font-semibold text-(color:--mkt-ink-soft) outline-none focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)">Version notes and test run (optional)</summary>
          <div className="mt-4 grid gap-4">
            <Field name="notes" label="What changed in this version" optional error={errors.notes}>
              {(p) => <input {...p} name="notes" maxLength={1000} placeholder="First release." onChange={() => recheck("notes")} />}
            </Field>
            <Field name="sample_input" label="Sample input (JSON)" optional hint="Inputs for the moderators' headless test run of the entry workflow (or the entry form's fields)." error={errors.sample_input}>
              {(p) => <textarea {...p} name="sample_input" rows={3} className={`${p.className} font-mono`} placeholder='{"visitor_name": "Grace Kim"}' onChange={() => recheck("sample_input")} />}
            </Field>
            <Field name="expect" label="A run with it reaches" optional>
              {(p) => <select {...p} name="expect" defaultValue=""><option value="">Not specified</option><option value="waiting">Its first task</option><option value="completed">The end (completed)</option></select>}
            </Field>
          </div>
        </details>
      </Step>

      {state.status === "error" && (
        <div ref={errorRef} tabIndex={-1} className="rounded-xl border border-[#A0533F]/30 bg-[#A0533F]/[0.06] p-4 text-sm text-[#7A3B2C] outline-none" role="alert" data-testid="share-error">
          <p className="flex items-start gap-2 font-semibold"><AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />{state.message}</p>
          {state.issues?.length ? <ul className="mt-2 list-disc space-y-1 pl-6 text-xs">{state.issues.slice(0, 12).map((i) => <li key={`${i.path}-${i.message}`}><span className="break-all font-mono">{i.path}</span>: {i.message}</li>)}</ul> : null}
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-(color:--mkt-ink)/[0.07] pt-6 sm:flex-row sm:items-center">
        <button type="submit" disabled={state.status === "sending"} aria-busy={state.status === "sending" || undefined} className="mkt-btn-primary inline-flex items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) focus-visible:ring-offset-2 disabled:opacity-60" data-testid="share-submit">
          <Upload size={15} aria-hidden="true" /> {state.status === "sending" ? "Checking the package…" : "Submit for review"}
        </button>
        <span className="text-xs leading-5 text-(color:--mkt-muted)">By submitting you confirm you may share it under the licence you chose.</span>
      </div>
    </form>
  )
}
