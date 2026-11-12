"use client"

import { useEffect, useId, useRef, useState } from "react"
import { CheckCircle2, Flag } from "lucide-react"
import { ABUSE_REASONS } from "@/lib/gallery/types"

const control = "w-full rounded-lg border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-3 py-2 text-sm text-(color:--mkt-ink) outline-none focus:border-(color:--mkt-bronze) focus:ring-2 focus:ring-(color:--mkt-gold)/30"

/** "Report abuse" on a community package page: reason + details, posted to the moderators. */
export function ReportAbuse({ slug, version }: { slug: string; version: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; message?: string }>({ status: "idle" })
  const id = useId()
  const reasonRef = useRef<HTMLSelectElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { if (open) reasonRef.current?.focus() }, [open])

  const send = async () => {
    setState({ status: "sending" })
    const res = await fetch(`/api/gallery/community/${slug}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, details, version }) }).catch(() => null)
    if (res?.ok) setState({ status: "sent" })
    else setState({ status: "error", message: (await res?.json().catch(() => null))?.error ?? "The report could not be sent" })
  }

  const cancel = () => {
    setOpen(false)
    requestAnimationFrame(() => toggleRef.current?.focus())
  }

  if (state.status === "sent") return <p className="inline-flex items-center gap-1.5 text-sm font-medium text-(color:--mkt-green)" role="status"><CheckCircle2 size={15} aria-hidden="true" /> Thank you. A moderator will look at it.</p>
  if (!open) {
    return (
      <button ref={toggleRef} type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={`${id}-panel`} data-testid="report-abuse"
        className="inline-flex items-center gap-1.5 rounded-lg border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-3 py-2 text-sm font-medium text-(color:--mkt-ink-soft) outline-none transition-colors hover:border-[#A0533F]/40 hover:text-[#A0533F] focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)">
        <Flag size={13} aria-hidden="true" /> Report abuse
      </button>
    )
  }
  return (
    <form id={`${id}-panel`} aria-labelledby={`${id}-title`} onSubmit={(e) => { e.preventDefault(); if (reason) void send() }} onKeyDown={(e) => { if (e.key === "Escape") cancel() }}
      className="grid w-full gap-3 rounded-xl border border-(color:--mkt-ink)/[0.1] bg-(color:--mkt-white) p-4 text-sm sm:max-w-md">
      <p id={`${id}-title`} className="flex items-center gap-1.5 font-semibold text-(color:--mkt-ink)"><Flag size={14} className="text-[#A0533F]" aria-hidden="true" /> Report this package</p>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-reason`} className="text-xs font-medium text-(color:--mkt-muted-strong)">Reason</label>
        <select ref={reasonRef} id={`${id}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required aria-describedby={state.status === "error" ? `${id}-error` : undefined} className={control}>
          <option value="">Choose a reason</option>
          {Object.entries(ABUSE_REASONS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-details`} className="text-xs font-medium text-(color:--mkt-muted-strong)">Details (optional)</label>
        <textarea id={`${id}-details`} value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} className={control} />
      </div>
      {state.status === "error" && <p id={`${id}-error`} className="text-xs font-medium text-[#A0533F]" role="alert">{state.message}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!reason || state.status === "sending"} className="mkt-btn-primary rounded-lg px-4 py-2 font-semibold outline-none focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze) focus-visible:ring-offset-2 disabled:opacity-50">{state.status === "sending" ? "Sending…" : "Send report"}</button>
        <button type="button" onClick={cancel} className="rounded-lg border border-(color:--mkt-ink)/15 bg-(color:--mkt-white) px-4 py-2 font-medium text-(color:--mkt-ink-soft) outline-none hover:border-(color:--mkt-ink)/30 focus-visible:ring-2 focus-visible:ring-(color:--mkt-bronze)">Cancel</button>
      </div>
    </form>
  )
}
