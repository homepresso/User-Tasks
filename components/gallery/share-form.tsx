"use client"

import { useState } from "react"
import { CheckCircle2, Upload } from "lucide-react"
import { GALLERY_CATEGORIES } from "@/lib/gallery/types"

const LICENCES = ["Apache-2.0", "MIT", "BSD-3-Clause", "MPL-2.0", "CC-BY-4.0", "CC0-1.0", "GPL-3.0-only"]
const input = "w-full rounded-lg border border-[#1B1916]/15 bg-[#FFFFFF] px-3 py-2 text-sm text-[#1B1916] placeholder:text-[#9A9282] focus:border-[#8A6D45] focus:outline-none focus:ring-2 focus:ring-[#B08A54]/30"

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-medium text-[#33302A]">{label}</span>
      {children}
      {hint && <span className="text-xs leading-5 text-[#6E6759]">{hint}</span>}
    </label>
  )
}

/** "Share your solution": upload a .utpkg with its listing; validated at once, then queued for a moderator. */
export function ShareForm({ defaultAuthor }: { defaultAuthor: string }) {
  const [state, setState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string; issues?: Array<{ path: string; message: string }>; title?: string }>({ status: "idle" })

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
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
      <div className="rounded-2xl border border-[#4F7A5B]/30 bg-[#4F7A5B]/[0.07] p-6" role="status" data-testid="share-done">
        <p className="flex items-center gap-2 text-lg font-semibold text-[#2F5A3B]"><CheckCircle2 size={20} aria-hidden="true" /> Thanks: &ldquo;{state.title}&rdquo; is waiting for review</p>
        <p className="mt-2 text-sm leading-6 text-[#33302A]">It passed the automatic checks. A moderator reviews it next; nothing is public until it is approved, and we will email you the decision.</p>
        <button type="button" onClick={() => setState({ status: "idle" })} className="mt-4 text-sm font-semibold text-[#8A6D45] hover:underline">Share another</button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="grid gap-5 rounded-2xl border border-[#1B1916]/[0.09] bg-[#FFFFFF] p-6" data-testid="share-form">
      <Field label="Package file (.utpkg)" hint="Build it in Automations → Packages (or usertasks packages build). Up to 5 MB; secrets are never included in a package.">
        <input type="file" name="file" accept=".utpkg" required className={input} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Title"><input name="title" required minLength={3} maxLength={80} className={input} placeholder="Visitor sign-in" /></Field>
        <Field label="Category">
          <select name="category" required className={input} defaultValue="">
            <option value="" disabled>Choose a category</option>
            {GALLERY_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Summary" hint="One sentence for the card (40-200 characters)."><input name="summary" required minLength={40} maxLength={200} className={input} /></Field>
      <Field label="Description" hint="What it does, how it starts and what to adapt. Plain text; blank lines separate paragraphs."><textarea name="description" required minLength={100} maxLength={6000} rows={6} className={input} /></Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Tags" hint="Comma separated, up to 8."><input name="tags" required className={input} placeholder="visitors, reception, forms" /></Field>
        <Field label="Licence" hint="Apache-2.0 unless you choose otherwise.">
          <select name="licence" className={input} defaultValue="Apache-2.0">{LICENCES.map((l) => <option key={l} value={l}>{l}</option>)}</select>
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Author name (shown publicly)"><input name="author_name" required minLength={2} maxLength={60} defaultValue={defaultAuthor} className={input} /></Field>
        <Field label="Author link (optional)"><input name="author_url" type="url" maxLength={300} className={input} placeholder="https://" /></Field>
      </div>
      <Field label="Screenshots (optional)" hint="Up to 6 PNG, JPEG, WebP or SVG images, 2 MB each. SVGs are sanitised; use demo data only.">
        <input type="file" name="screenshots" accept="image/png,image/jpeg,image/webp,image/svg+xml" multiple className={input} />
      </Field>
      <details className="rounded-lg border border-[#1B1916]/[0.08] bg-[#FAF8F3] p-4">
        <summary className="cursor-pointer text-sm font-medium">Version notes and test run (optional)</summary>
        <div className="mt-4 grid gap-4">
          <Field label="What changed in this version"><input name="notes" maxLength={1000} className={input} placeholder="First release." /></Field>
          <Field label="Sample input (JSON)" hint="Inputs for the moderators' headless test run of the entry workflow (or the entry form's fields).">
            <textarea name="sample_input" rows={3} className={`${input} font-mono`} placeholder='{"visitor_name": "Grace Kim"}' />
          </Field>
          <Field label="A run with it reaches">
            <select name="expect" className={input} defaultValue=""><option value="">Not specified</option><option value="waiting">Its first task</option><option value="completed">The end (completed)</option></select>
          </Field>
        </div>
      </details>
      {state.status === "error" && (
        <div className="rounded-lg border border-[#A0533F]/30 bg-[#A0533F]/[0.06] p-4 text-sm text-[#7A3B2C]" role="alert" data-testid="share-error">
          <p className="font-semibold">{state.message}</p>
          {state.issues?.length ? <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{state.issues.slice(0, 12).map((i) => <li key={`${i.path}-${i.message}`}><span className="font-mono">{i.path}</span>: {i.message}</li>)}</ul> : null}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={state.status === "sending"} className="inline-flex items-center gap-2 rounded-lg bg-[#17150F] px-5 py-2.5 text-sm font-semibold text-[#FAF8F3] hover:bg-[#2E2A24] disabled:opacity-60" data-testid="share-submit">
          <Upload size={15} aria-hidden="true" /> {state.status === "sending" ? "Checking the package…" : "Submit for review"}
        </button>
        <span className="text-xs text-[#6E6759]">By submitting you confirm you may share it under the licence you chose.</span>
      </div>
    </form>
  )
}
