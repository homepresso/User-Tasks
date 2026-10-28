"use client"

import { useState } from "react"
import { Flag } from "lucide-react"
import { ABUSE_REASONS } from "@/lib/gallery/types"

/** "Report abuse" on a community package page: reason + details, posted to the moderators. */
export function ReportAbuse({ slug, version }: { slug: string; version: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [details, setDetails] = useState("")
  const [state, setState] = useState<{ status: "idle" | "sending" | "sent" | "error"; message?: string }>({ status: "idle" })

  const send = async () => {
    setState({ status: "sending" })
    const res = await fetch(`/api/gallery/community/${slug}/report`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, details, version }) }).catch(() => null)
    if (res?.ok) setState({ status: "sent" })
    else setState({ status: "error", message: (await res?.json().catch(() => null))?.error ?? "The report could not be sent" })
  }

  if (state.status === "sent") return <p className="text-sm text-[#4F7A5B]" role="status">Thank you. A moderator will look at it.</p>
  if (!open) return <button type="button" onClick={() => setOpen(true)} data-testid="report-abuse" className="inline-flex items-center gap-1.5 text-sm text-[#6E6759] underline-offset-2 hover:text-[#A0533F] hover:underline"><Flag size={13} aria-hidden="true" /> Report abuse</button>
  return (
    <div className="grid gap-3 rounded-xl border border-[#1B1916]/[0.1] bg-[#FFFFFF] p-4 text-sm">
      <p className="font-semibold">Report this package</p>
      <label className="grid gap-1">
        <span className="text-xs text-[#6E6759]">Reason</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)} className="rounded-lg border border-[#1B1916]/15 bg-[#FFFFFF] px-2 py-1.5">
          <option value="">Choose a reason</option>
          {Object.entries(ABUSE_REASONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="text-xs text-[#6E6759]">Details (optional)</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} className="rounded-lg border border-[#1B1916]/15 bg-[#FFFFFF] px-2 py-1.5" />
      </label>
      {state.status === "error" && <p className="text-xs text-[#A0533F]" role="alert">{state.message}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!reason || state.status === "sending"} onClick={() => void send()} className="rounded-lg bg-[#17150F] px-3 py-1.5 font-semibold text-[#FAF8F3] disabled:opacity-50">{state.status === "sending" ? "Sending…" : "Send report"}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-[#1B1916]/15 px-3 py-1.5">Cancel</button>
      </div>
    </div>
  )
}
