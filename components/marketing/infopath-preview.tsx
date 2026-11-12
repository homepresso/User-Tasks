"use client"

import { useRef, useState, type CSSProperties } from "react"
import dynamic from "next/dynamic"
import { AlertTriangle, ArrowRight, Check, FileUp, ListChecks, Loader2, Sparkles, Upload } from "lucide-react"
import type { PublicInfoPathSummary } from "@/lib/infopath/public-summary"
import { importerHref, savePendingInfoPath } from "@/lib/infopath/pending-file"

/**
 * The upload box on /infopath: drop an .xsn, get an instant, analyze-only
 * preview from /api/public/infopath/analyze (nothing stored), then "Create
 * these forms in UserTasks" — the importer when signed in, sign-up first
 * otherwise. The file is carried in this browser only (lib/infopath/pending-file).
 * The real form renderer is loaded only once there is something to preview.
 */

const FormPreview = dynamic(() => import("./infopath-form-preview").then((m) => m.InfoPathFormPreview), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-(color:--mkt-muted)">Loading the preview…</p>,
})

const MAX = 4 * 1024 * 1024
const LIGHT = {
  "--theme-card-bg": "var(--mkt-white)",
  "--theme-card-text": "var(--mkt-ink)",
  "--theme-muted-text": "var(--mkt-muted)",
  "--theme-surface": "var(--mkt-canvas)",
  "--theme-surface-border": "var(--mkt-line)",
  colorScheme: "light",
} as CSSProperties
/** Sample templates on this site, written for UserTasks (no personal data). */
const SAMPLES = [
  { file: "/samples/expense-report.xsn", name: "Expense Report.xsn", label: "expense report" },
  { file: "/samples/site-inspection.xsn", name: "Site Inspection.xsn", label: "site inspection" },
] as const

type State = { kind: "idle" } | { kind: "busy"; name: string } | { kind: "error"; message: string } | { kind: "done"; file: File; summary: PublicInfoPathSummary }

export function InfoPathPreview() {
  const input = useRef<HTMLInputElement>(null)
  const honeypot = useRef<HTMLInputElement>(null)
  const [state, setState] = useState<State>({ kind: "idle" })
  const [dragging, setDragging] = useState(false)
  const [tab, setTab] = useState<"preview" | "fields" | "attention">("preview")
  const [going, setGoing] = useState(false)

  const analyse = async (file: File) => {
    if (!/\.(xsn|zip)$/i.test(file.name)) { setState({ kind: "error", message: "Choose an InfoPath form template (.xsn), or a .zip of its source files." }); return }
    if (file.size > MAX) { setState({ kind: "error", message: "The file must be 4 MB or smaller. Export the source files from InfoPath Designer, zip them without the images and try the .zip." }); return }
    setState({ kind: "busy", name: file.name })
    const body = new FormData()
    body.append("file", file)
    body.append("website", honeypot.current?.value ?? "")
    try {
      const res = await fetch("/api/public/infopath/analyze", { method: "POST", body })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setState({ kind: "error", message: json.error ?? "This file could not be analysed." }); return }
      setTab("preview")
      setState({ kind: "done", file, summary: json.summary })
    } catch {
      setState({ kind: "error", message: "The upload failed. Check your connection and try again." })
    }
  }

  const trySample = async (sample: (typeof SAMPLES)[number]) => {
    const res = await fetch(sample.file)
    if (!res.ok) return
    await analyse(new File([await res.blob()], sample.name, { type: "application/vnd.ms-infopath" }))
  }

  const create = async () => {
    if (state.kind !== "done") return
    setGoing(true)
    await savePendingInfoPath(state.file)
    const signedIn = await fetch("/api/auth/session", { cache: "no-store" }).then((r) => r.ok).catch(() => false)
    window.location.href = importerHref(signedIn)
  }

  return (
    <div className="rounded-3xl border border-white/12 bg-[#fff]/[0.04] p-3 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)] sm:p-4" data-testid="infopath-preview-box">
      {/* Honeypot: people never see or fill it. */}
      <input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute left-[-9999px] h-px w-px opacity-0" />
      {state.kind !== "done" && (
        <div
          role="button"
          tabIndex={0}
          aria-label="Upload an InfoPath form template"
          data-testid="infopath-public-drop"
          onClick={() => state.kind !== "busy" && input.current?.click()}
          onKeyDown={(e) => { if ((e.key === "Enter" || e.key === " ") && state.kind !== "busy") { e.preventDefault(); input.current?.click() } }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) void analyse(f) }}
          className={`flex min-h-[300px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors sm:min-h-[360px] ${dragging ? "border-[#F0C27B] bg-[#F0C27B]/10" : "border-white/20 hover:border-white/40"}`}
        >
          {state.kind === "busy" ? (
            <>
              <Loader2 className="size-9 animate-spin text-[#F0C27B]" aria-hidden="true" />
              <p className="text-lg font-semibold text-white" aria-live="polite">Reading {state.name}…</p>
              <p className="max-w-md text-sm text-[#C9BFAE]">Unpacking the template, then its views, data source, rules and validation.</p>
            </>
          ) : (
            <>
              <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-[#F3C77F] to-[#D99A52] text-[#1B1406]"><Upload className="size-7" aria-hidden="true" /></span>
              <p className="text-lg font-semibold text-white">Drop your InfoPath form here</p>
              <p className="max-w-md text-sm leading-6 text-[#C9BFAE]">An .xsn form template, up to 4 MB. We read it to show you the result, then forget it: nothing is stored.</p>
              <span className="mt-1 inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold text-white"><FileUp className="size-4" aria-hidden="true" />Choose a file</span>
              <p className="text-sm text-[#C9BFAE]">No file to hand? Try a sample:{" "}
                {SAMPLES.map((sample, i) => (
                  <span key={sample.file}>{i > 0 && " or "}<button type="button" onClick={(e) => { e.stopPropagation(); void trySample(sample) }} className="font-semibold text-[#F0C27B] underline-offset-4 hover:underline" data-testid={i === 0 ? "infopath-sample" : `infopath-sample-${i + 1}`}>{sample.label}</button></span>
                ))}
              </p>
              {state.kind === "error" && <p role="alert" className="mt-2 flex max-w-md items-start gap-2 rounded-xl border border-[#E07A5F]/40 bg-[#E07A5F]/10 px-3 py-2 text-left text-sm text-[#F6C9BC]"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />{state.message}</p>}
            </>
          )}
          <input ref={input} type="file" accept=".xsn,.zip" className="hidden" data-testid="infopath-public-file" onChange={(e) => { const f = e.target.files?.[0]; if (f) void analyse(f); e.target.value = "" }} />
        </div>
      )}
      {state.kind === "done" && <Result summary={state.summary} fileName={state.file.name} tab={tab} setTab={setTab} onCreate={() => void create()} going={going} onReset={() => setState({ kind: "idle" })} />}
    </div>
  )
}

function Result({ summary, fileName, tab, setTab, onCreate, going, onReset }: {
  summary: PublicInfoPathSummary
  fileName: string
  tab: "preview" | "fields" | "attention"
  setTab: (t: "preview" | "fields" | "attention") => void
  onCreate: () => void
  going: boolean
  onReset: () => void
}) {
  const c = summary.counts
  const behaviour = c.rules.total + c.validations.total + c.calculations.total + c.formatting.total
  const converted = c.rules.converted + c.validations.converted + c.calculations.converted + c.formatting.converted
  return (
    <div className="space-y-4 p-1 sm:p-2" data-testid="infopath-public-result">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm text-[#C9BFAE]"><FileUp className="size-4" aria-hidden="true" /><span className="font-semibold text-white">{fileName}</span> · {summary.name}</p>
        <button type="button" onClick={onReset} className="text-sm font-semibold text-[#F0C27B] hover:underline">Try another file</button>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="Views → forms" value={`${c.views} → ${summary.views.length}`} />
        <Tile label="Fields" value={String(c.fields)} hint={c.repeating ? `${c.repeating} repeating table${c.repeating === 1 ? "" : "s"} or section${c.repeating === 1 ? "" : "s"}` : undefined} />
        <Tile label="Rules" value={`${c.rules.converted} of ${c.rules.total}`} hint={c.rules.partial ? `${c.rules.partial} in part` : "convert automatically"} />
        <Tile label="Validation & formulas" value={`${c.validations.converted + c.calculations.converted} of ${c.validations.total + c.calculations.total}`} hint={c.formatting.total ? `${c.formatting.converted} of ${c.formatting.total} formatting rules` : undefined} />
      </dl>
      <p className="rounded-xl bg-[#7FA98A]/15 px-3 py-2 text-sm text-[#CFE3D3]" data-testid="infopath-public-headline">
        <Check className="mr-1.5 inline size-4 align-[-3px]" aria-hidden="true" /><strong className="text-white">{converted} of {behaviour}</strong> rules, validations, formulas and formatting rules convert automatically.{summary.attention.length ? ` ${summary.attention.length} item${summary.attention.length === 1 ? " needs" : "s need"} a person afterwards — kept as notes, never dropped.` : ""}
      </p>
      {summary.features.length > 0 && (
        <div data-testid="infopath-public-features">
          <p className="text-2xs uppercase tracking-wider text-[#A89E8C]">What converts</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
            {summary.features.map((f) => (
              <li key={f.key} className="rounded-full border border-white/12 bg-white/[0.05] px-2.5 py-1 text-[#E6DDCC]" title={f.items?.join(", ")}>
                <strong className="text-white">{f.count}</strong> {f.label}{f.items?.length ? <span className="text-[#A89E8C]"> ({f.items.join(", ")})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div role="tablist" aria-label="Preview" className="flex gap-1 rounded-xl bg-white/[0.06] p-1 text-sm">
        {([["preview", "Preview"], ["fields", "Fields per view"], ["attention", `Needs a person (${summary.attention.length})`]] as const).map(([id, label]) => (
          <button key={id} role="tab" type="button" aria-selected={tab === id} onClick={() => setTab(id)} className={`flex-1 rounded-lg px-3 py-1.5 font-semibold ${tab === id ? "bg-[#F4EFE4] text-[#1B1406]" : "text-[#D9D0BF] hover:text-white"}`}>{label}</button>
        ))}
      </div>
      {/* A light card inside the dark hero: the app's theme variables reset to the paper palette. */}
      <div className="max-h-[440px] overflow-auto rounded-2xl bg-(color:--mkt-white) text-(color:--mkt-ink)" style={LIGHT}>
        {tab === "preview" && (summary.preview ? <FormPreview preview={summary.preview} /> : <p className="p-6 text-sm">This view has no fields to preview.</p>)}
        {tab === "fields" && (
          <div className="space-y-5 p-5">
            {summary.views.map((v) => (
              <section key={v.name}>
                <h3 className="flex items-center gap-2 text-sm font-semibold"><ListChecks className="size-4 text-(color:--mkt-bronze)" aria-hidden="true" />{v.name}{v.default && <span className="rounded-full bg-(color:--mkt-gold)/20 px-2 text-2xs font-semibold">default view</span>}</h3>
                <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  {v.fields.map((f, i) => <li key={i} className="flex justify-between gap-2 border-b border-(color:--mkt-ink)/[0.06] py-1"><span>{f.label}{f.required && <span className="text-(color:--mkt-coral)"> *</span>}{f.columns && <span className="text-(color:--mkt-muted)"> ({f.columns.join(", ")})</span>}</span><span className="shrink-0 text-(color:--mkt-muted)">{f.type_label ?? f.type}</span></li>)}
                </ul>
              </section>
            ))}
          </div>
        )}
        {tab === "attention" && (
          <ul className="space-y-2 p-5 text-sm">
            {summary.attention.length ? summary.attention.map((a, i) => <li key={i}><strong>{a.name}</strong> <span className="text-(color:--mkt-muted)">— {a.detail}</span></li>) : <li>Everything converts. Nice form.</li>}
          </ul>
        )}
      </div>
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-center gap-2 text-xs text-[#A89E8C]"><Sparkles className="size-3.5" aria-hidden="true" />Your file stays in this browser until you import it.</p>
        <button type="button" onClick={onCreate} disabled={going} className="mkt-btn-ember inline-flex items-center gap-2 rounded-xl px-5 py-3 font-semibold disabled:opacity-70" data-testid="infopath-public-create">
          {going ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Create these forms in UserTasks <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2">
      <dt className="text-2xs uppercase tracking-wider text-[#A89E8C]">{label}</dt>
      <dd className="font-display text-2xl font-bold text-white">{value}</dd>
      {hint && <dd className="text-xs text-[#C9BFAE]">{hint}</dd>}
    </div>
  )
}
