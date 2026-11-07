"use client"

/**
 * Live preview of an official form control on its gallery page: the real
 * sandboxed frame (/form-controls/frame/gallery/<slug>, same document and CSP
 * the app serves) driven through the real bridge checks
 * (lib/forms/custom-controls/bridge.ts). Host requests are answered from the
 * control's gallery.json fixtures (canned lookup suggestions, a sample
 * report, a sample file), so nothing leaves the page except the declared
 * network hosts (map tiles). Shows the value the control reports.
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Moon, RotateCcw, Sun } from "lucide-react"
import { acceptFrameMessage, clampFrameHeight, hostMessage, newChannelId } from "@/lib/forms/custom-controls/bridge"
import type { ControlCapability, ControlState, ControlTheme, FrameMessage } from "@/lib/forms/custom-controls/contract"
import type { GalleryControlFixtures } from "@/lib/gallery/types"

const THEMES: Record<"light" | "dark", ControlTheme> = {
  light: { mode: "light", tokens: { "ut-primary": "#8A6D45", "ut-on-primary": "#FFFFFF", "ut-primary-text": "#6F522B", "ut-primary-light": "#F3ECE0", "ut-text": "#1B1916", "ut-muted-text": "#6E6759", "ut-surface": "#F6F3EC", "ut-card": "#FFFFFF", "ut-border": "#D9D2C3", "ut-input-bg": "#FFFFFF", "ut-input-text": "#1B1916", "ut-focus-ring": "#8A6D45", "ut-error": "#B42318", "ut-success": "#2F7A4B", "ut-radius": "8px", "ut-font-family": "system-ui, -apple-system, 'Segoe UI', sans-serif", "ut-font-size": "14px" } },
  dark: { mode: "dark", tokens: { "ut-primary": "#D2B48A", "ut-on-primary": "#1B1916", "ut-primary-text": "#E3CBA6", "ut-primary-light": "#3A3226", "ut-text": "#EEEAE2", "ut-muted-text": "#B3AB9C", "ut-surface": "#1E1C18", "ut-card": "#26231E", "ut-border": "#4A4439", "ut-input-bg": "#1F1D19", "ut-input-text": "#EEEAE2", "ut-focus-ring": "#D2B48A", "ut-error": "#F97066", "ut-success": "#6FCF97", "ut-radius": "8px", "ut-font-family": "system-ui, -apple-system, 'Segoe UI', sans-serif", "ut-font-size": "14px" } },
}

function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export interface ControlPreviewProps {
  slug: string
  tag: string
  name: string
  label: string
  props: Record<string, unknown>
  value: unknown
  context: Record<string, unknown>
  fixtures: GalleryControlFixtures
  capabilities: ControlCapability[]
  size: { default_height?: number; min_height?: number; max_height?: number }
  note?: string | null
}

export function ControlPreview(preview: ControlPreviewProps) {
  const { slug, tag, name, label, props, context, fixtures, capabilities, size } = preview
  const iframe = useRef<HTMLIFrameElement>(null)
  // The frame is created on the client only, after the message listener exists (its "ready" must not be missed)
  // and with a random channel the server never renders.
  const [channel, setChannel] = useState<string | null>(null)
  useEffect(() => { setChannel(newChannelId()) }, [])
  const [mode, setMode] = useState<"light" | "dark">("light")
  const [readonly, setReadonly] = useState(false)
  const [value, setValue] = useState<unknown>(preview.value ?? null)
  const [validity, setValidity] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [height, setHeight] = useState(() => clampFrameHeight(size.default_height ?? 120, size))
  const initSent = useRef(false)
  const valueRef = useRef(value)
  useEffect(() => { valueRef.current = value })

  const state = useMemo<ControlState>(() => ({
    value: valueRef.current,
    disabled: false,
    readonly,
    required: false,
    invalid: false,
    error: null,
    props,
    theme: THEMES[mode],
    locale: typeof navigator !== "undefined" ? navigator.language : "en",
    context: { fields: context, field_key: "preview", form_id: null, task_id: null, workflow_id: null },
    label,
    description: "Live preview on usertasks.com",
    capabilities,
  }), [readonly, props, mode, context, label, capabilities])
  const stateRef = useRef(state)
  useEffect(() => { stateRef.current = state })

  const post = (message: Parameters<typeof hostMessage>[1]) => { if (channel) iframe.current?.contentWindow?.postMessage(hostMessage(channel, message), "*") }
  const postRef = useRef(post)
  useEffect(() => { postRef.current = post })

  useEffect(() => {
    async function answer(kind: string, payload: unknown): Promise<unknown> {
      if (kind === "lookup") {
        const query = String((payload as { query?: string })?.query ?? "").toLowerCase().trim()
        const items = fixtures.lookup?.items ?? []
        if (!items.length) throw new Error("The preview has no lookup data")
        const words = query.split(/\s+/).filter(Boolean)
        const matched = items.filter((item) => words.every((w) => `${item.label} ${item.description ?? ""}`.toLowerCase().includes(w)))
        return { items: matched.length ? matched : items, truncated: false }
      }
      if (kind === "tile") {
        const { z, x, y } = payload as { z: number; x: number; y: number }
        const res = await fetch(`/form-controls/tiles/gallery/${z}/${x}/${y}.png`)
        if (!res.ok) throw new Error("The map tile is not available")
        return { type: res.headers.get("content-type")?.split(";")[0] || "image/png", bytes: await res.arrayBuffer() }
      }
      if (kind === "report") {
        if (!fixtures.report) throw new Error("The preview has no report data")
        return fixtures.report
      }
      if (kind === "file") {
        const file = fixtures.file
        if (!file || (payload as { id?: string })?.id !== file.id) throw new Error("That file is not available to this control")
        const bytes = base64ToBuffer(file.__bytes)
        return { id: file.id, name: file.name, type: file.type, size: bytes.byteLength, bytes }
      }
      // upload: the preview keeps the file in the page only.
      const upload = payload as { name?: string; type?: string; bytes?: ArrayBuffer }
      return fixtures.upload ?? { id: "preview-upload", name: String(upload?.name ?? "file"), size: upload?.bytes?.byteLength ?? 0, type: String(upload?.type ?? "application/octet-stream") }
    }
    if (!channel) return
    initSent.current = false
    function onMessage(event: MessageEvent) {
      if (!channel) return
      const result = acceptFrameMessage({ source: event.source, origin: event.origin, data: event.data }, { frameWindow: iframe.current?.contentWindow, channel, capabilities })
      if (!result.ok) return
      const message: FrameMessage = result.message
      switch (message.type) {
        case "hello":
          // The runtime asks for its state before the element exists (first paint already styled).
          if (!initSent.current) { initSent.current = true; postRef.current({ type: "init", state: stateRef.current }) }
          break
        case "ready":
          setReady(true)
          setFailure(null)
          if (!initSent.current) { initSent.current = true; postRef.current({ type: "init", state: stateRef.current }) }
          break
        case "change":
          setValue(message.value)
          break
        case "validity":
          setValidity(message.valid ? null : message.message ?? "Check this value")
          break
        case "resize":
          setHeight(clampFrameHeight(message.height, size))
          break
        case "error":
          setFailure(message.message)
          break
        case "request":
          answer(message.kind, message.payload)
            .then((result) => postRef.current({ type: "response", request_id: message.request_id, ok: true, result }))
            .catch((error: unknown) => postRef.current({ type: "response", request_id: message.request_id, ok: false, error: error instanceof Error ? error.message : "Request failed" }))
          break
        default:
          break
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [channel, capabilities, fixtures, size])

  // Theme / read-only changes after the handshake.
  useEffect(() => {
    if (initSent.current) postRef.current({ type: "update", state: { theme: state.theme, readonly: state.readonly } })
  }, [ready, state.theme, state.readonly])

  const reset = () => {
    setReady(false)
    setValue(preview.value ?? null)
    valueRef.current = preview.value ?? null
    setValidity(null)
    setChannel(newChannelId())
  }

  const dark = mode === "dark"
  const shown = value === null || value === undefined ? "null" : JSON.stringify(value, null, 2)
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_300px]" data-testid="control-preview">
      <div className={`min-w-0 rounded-2xl border p-4 sm:p-5 ${dark ? "border-[#4A4439] bg-[#26231E] text-[#EEEAE2]" : "border-[#1B1916]/[0.09] bg-[#FFFFFF] text-[#1B1916]"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`text-sm font-semibold ${dark ? "text-[#EEEAE2]" : "text-[#33302A]"}`}>{label}</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Preview options">
            <button type="button" onClick={() => setMode(dark ? "light" : "dark")} aria-pressed={dark} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${dark ? "border-[#4A4439] text-[#EEEAE2]" : "border-[#1B1916]/15 text-[#4A463E]"}`}>
              {dark ? <Sun size={12} aria-hidden="true" /> : <Moon size={12} aria-hidden="true" />} {dark ? "Light" : "Dark"}
            </button>
            <button type="button" onClick={() => setReadonly(!readonly)} aria-pressed={readonly} className={`rounded-md border px-2 py-1 text-xs ${dark ? "border-[#4A4439] text-[#EEEAE2]" : "border-[#1B1916]/15 text-[#4A463E]"}`}>Read-only</button>
            <button type="button" onClick={reset} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${dark ? "border-[#4A4439] text-[#EEEAE2]" : "border-[#1B1916]/15 text-[#4A463E]"}`}><RotateCcw size={12} aria-hidden="true" /> Reset</button>
          </div>
        </div>
        <div className="relative mt-3">
          {channel && <iframe
            key={channel}
            ref={iframe}
            src={`/form-controls/frame/gallery/${encodeURIComponent(slug)}#c=${channel}&m=${mode}`}
            title={`${name} (live preview)`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            allow=""
            className="block w-full rounded-lg"
            style={{ height, border: 0, colorScheme: mode, background: "transparent", opacity: ready ? 1 : 0, transition: "opacity 120ms ease-out" }}
            data-control={tag}
          />}
          {!ready && !failure && <div className={`pointer-events-none absolute inset-1 rounded-lg border motion-safe:animate-pulse ${dark ? "border-[#4A4439] bg-[#1F1D19]" : "border-[#1B1916]/10 bg-[#FAF8F4]"}`} aria-hidden="true" data-control-skeleton />}
          {failure && <p role="alert" className="mt-2 text-xs text-[#B42318]">{failure}</p>}
        </div>
        {validity && <p className="mt-2 text-xs text-[#B42318]" role="status">{validity}</p>}
        {preview.note && <p className={`mt-3 text-xs ${dark ? "text-[#B3AB9C]" : "text-[#6E6759]"}`}>{preview.note}</p>}
      </div>
      <div className="min-w-0 rounded-2xl border border-[#1B1916]/[0.09] bg-[#17150F] p-4 text-[#EDE7DA]">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#D2B48A]">Value the form receives</p>
        <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5" aria-live="polite" data-testid="control-preview-value">{shown}</pre>
        <p className="mt-3 text-2xs leading-5 text-[#B9B09F]">Sandboxed frame (opaque origin, its own CSP), talking to this page only through the typed postMessage bridge — exactly as on a form.</p>
      </div>
    </div>
  )
}
