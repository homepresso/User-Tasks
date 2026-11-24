"use client"

import { useRef, useState } from "react"
import dynamic from "next/dynamic"
import { AlertTriangle, ArrowRight, Check, FileUp, Loader2, Upload } from "lucide-react"
import type { PublicPdfSummary } from "@/lib/importers/pdf/public-summary"
import { pdfImporterHref, savePendingInfoPath } from "@/lib/infopath/pending-file"

/**
 * "Try a PDF form" on /forms: drop a fillable PDF, get an analyze-only
 * preview from /api/public/pdf/analyze (nothing stored, no AI), then
 * "Create this form in UserTasks" — the importer when signed in, sign-up
 * first otherwise. The file stays in this browser (lib/infopath/pending-file).
 */

const FormPreview = dynamic(() => import("./pdf-form-preview").then((m) => m.PdfFormPreview), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-(color:--mkt-muted)">Loading the preview…</p>,
})

const MAX = 4 * 1024 * 1024
type State = { kind: "idle" } | { kind: "busy"; name: string } | { kind: "error"; message: string } | { kind: "done"; file: File; summary: PublicPdfSummary }

export function PdfPreview() {
  const input = useRef<HTMLInputElement>(null)
  const honeypot = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: "idle" })
  const [tab, setTab] = useState<"preview" | "fields" | "attention">("preview")
  const [going, setGoing] = useState(false)

  const analyse = async (file: File) => {
    if (!/\.pdf$/i.test(file.name)) { setState({ kind: "error", message: "Choose a PDF form (.pdf)." }); return }
    if (file.size > MAX) { setState({ kind: "error", message: "The PDF must be 4 MB or smaller." }); return }
    setState({ kind: "busy", name: file.name })
    const body = new FormData()
    body.append("file", file)
    body.append("website", honeypot.current?.value ?? "")
    try {
      const res = await fetch("/api/public/pdf/analyze", { method: "POST", body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setState({ kind: "error", message: json.error ?? "This PDF could not be analysed." }); return }
      setTab("preview")
      setState({ kind: "done", file, summary: json.summary })
    } catch {
      setState({ kind: "error", message: "The upload failed. Check your connection and try again." })
    }
  }

  const create = async () => {
    if (state.kind !== "done") return
    setGoing(true)
    await savePendingInfoPath(state.file)
    const signedIn = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.ok).catch(() => false)
    window.location.href = pdfImporterHref(signedIn)
  }

  return (
    <div className="rounded-2xl border border-(color:--mkt-ink)/[0.08] bg-(color:--mkt-white) p-3 sm:p-4" data-testid="pdf-preview-box">
      <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-px w-px opacity-0" />
      {state.kind !== "done" ? (
        <div
          role="button" tabIndex={0} aria-label="Upload a PDF form" data-testid="pdf-public-drop"
          onClick={() => state.kind !== "busy" && input.current?.click()}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && state.kind !== "busy") { e.preventDefault(); input.current?.click() } }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) void analyse(f) }}
          className="flex min-h-[220px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-(color:--mkt-ink)/20 px-6 py-8 text-center hover:border-(color:--mkt-bronze)"
        >
          {state.kind === "busy" ? (
            <><Loader2 className="size-8 animate-spin text-(color:--mkt-bronze)" aria-hidden="true" /><p className="font-semibold" aria-live="polite">Reading {state.name}…</p></>
          ) : (
            <>
              <Upload className="size-8 text-(color:--mkt-bronze)" aria-hidden="true" />
              <p className="font-semibold">Drop a fillable PDF form here</p>
              <p className="max-w-md text-sm text-(color:--mkt-muted)">Up to 4 MB. We read it to show you the form it becomes, then forget it: nothing is stored, and scripts in it are never run.</p>
              {state.kind === "error" && <p role="alert" className="mt-2 flex max-w-md items-start gap-2 text-left text-sm text-(color:--mkt-coral)"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.message}</p>}
            </>
          )}
          <input ref={input} type="file" accept=".pdf,application/pdf" className="hidden" data-testid="pdf-public-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyse(f); e.target.value = "" }} />
        </div>
      ) : (
        <div className="space-y-3" data-testid="pdf-public-result">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="flex items-center gap-2"><FileUp className="size-4" aria-hidden="true" /><strong>{state.file.name}</strong> · {state.summary.name}</p>
            <button type="button" onClick={() => setState({ kind: "idle" })} className="font-semibold text-(color:--mkt-bronze) hover:underline">Try another PDF</button>
          </div>
          {state.summary.counts.fields === 0 ? (
            <p className="rounded-xl bg-(color:--mkt-gold)/15 px-3 py-2 text-sm">
              <strong>This PDF has no fillable fields</strong> ({state.summary.kind === "scanned" ? "it looks scanned" : "a flat, print-only form"}). In UserTasks you can let your own AI provider read its questions, or build the form in the designer.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Tile label="Fields" value={String(state.summary.counts.fields)} hint={`${state.summary.pages} page${state.summary.pages === 1 ? "" : "s"}`} />
                <Tile label="Required" value={String(state.summary.counts.required)} />
                <Tile label="Rules" value={`${state.summary.counts.rules_enabled} of ${state.summary.counts.rules}`} hint="ready to use" />
                <Tile label="Merged boxes" value={String(state.summary.counts.merged)} hint="dates, Yes / No pairs" />
              </dl>
              <p className="text-sm"><Check className="mr-1 inline size-4 align-[-3px] text-(color:--mkt-bronze)" aria-hidden="true" />{state.summary.attention.length ? `${state.summary.attention.length} item${state.summary.attention.length === 1 ? " needs" : "s need"} a person afterwards — kept as notes, never dropped.` : "Everything converts."}</p>
              <div role="tablist" aria-label="Preview" className="flex gap-1 rounded-xl bg-(color:--mkt-canvas) p-1 text-sm">
                {([["preview", "Preview"], ["fields", "Fields"], ["attention", `Needs a person (${state.summary.attention.length})`]] as const).map(([id, label]) => (
                  <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-lg px-3 py-1.5 font-semibold ${tab === id ? "bg-(color:--mkt-white) shadow-sm" : "text-(color:--mkt-muted)"}`}>{label}</button>
                ))}
              </div>
              <div className="max-h-[420px] overflow-auto rounded-xl border border-(color:--mkt-ink)/[0.08]">
                {tab === "preview" && (state.summary.preview ? <FormPreview preview={state.summary.preview} name={state.summary.name} /> : <p className="p-6 text-sm">Nothing to preview.</p>)}
                {tab === "fields" && <ul className="grid gap-1 p-4 text-sm sm:grid-cols-2">{state.summary.fields.map((f, i) => <li key={i} className="flex justify-between gap-2 border-b border-(color:--mkt-ink)/[0.06] py-1"><span>{f.label}{f.required && <span className="text-(color:--mkt-coral)"> *</span>}</span><span className="shrink-0 text-(color:--mkt-muted)">{f.type}</span></li>)}</ul>}
                {tab === "attention" && <ul className="space-y-2 p-4 text-sm">{state.summary.attention.length ? state.summary.attention.map((a, i) => <li key={i}><strong>{a.name}</strong> <span className="text-(color:--mkt-muted)">— {a.detail}</span></li>) : <li>Nothing needs a person.</li>}</ul>}
              </div>
            </>
          )}
          <button type="button" onClick={() => void create()} disabled={going} className="mkt-btn-ember inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold disabled:opacity-70" data-testid="pdf-public-create">
            {going ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Create this form in UserTasks <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-(color:--mkt-ink)/[0.08] px-3 py-2">
      <dt className="text-2xs uppercase tracking-wider text-(color:--mkt-muted)">{label}</dt>
      <dd className="font-display text-2xl font-bold">{value}</dd>
      {hint && <dd className="text-xs text-(color:--mkt-muted)">{hint}</dd>}
    </div>
  )
}
