"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeft, ExternalLink, Maximize2, Minimize2, X } from "lucide-react"
import { IconButton } from "@/components/ui/icon-button"
import { DialogAgentSlot } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { StandaloneForm } from "@/components/forms/standalone-form"
import { TaskDetailPanel } from "@/components/tasks/task-detail-panel"
import { RunWorkflowDialog } from "@/components/automations/run-workflow-dialog"
import { serverQuery } from "@/lib/server-read"
import {
  MAX_PANELS, breadcrumb, closePanel, decodePanels, defaultTitle, designSize, encodePanels, markDirty, motionFor, parseSavedSize, popPanel, pushPanel, sizeKey, sizePx,
  type Panel, type PanelTarget,
} from "@/lib/apps/panels"
import type { OpenMode } from "@/lib/apps/schema"
import { filterParam } from "@/lib/apps/widgets"
import { formAppPath } from "@/lib/forms/form-page-url"
import { cn } from "@/lib/utils"
import { ReportWidget } from "./widgets/report-widget"

/**
 * The app page's open-target host: modals, slide-in panels (right / left),
 * bottom sheets and full-screen overlays that STACK (lib/apps/panels.ts) —
 * opening a target from inside a panel slides a new one over; the previous
 * ones stay mounted and peek out, with a breadcrumb header. Esc closes the
 * top one (asking first when it holds an unsent form), focus returns to
 * what opened it, and the stack is mirrored in the URL (?panel=…) so a
 * refresh or a shared link restores it. On phones panels are full-width
 * bottom sheets; beyond MAX_PANELS a target opens by navigation instead.
 * Motion: slide / fade / scale (prefers-reduced-motion: none).
 */

/** What the opener hears back (app rules: form submitted, panel closed). */
export interface OpenHooks {
  onSubmitted?: (result: { form_id: string; submission_id: string | null; values: Record<string, unknown> }) => void
  onClosed?: (target: PanelTarget) => void
}

export interface OpenApi {
  open: (target: PanelTarget, mode: OpenMode, title?: string, hooks?: OpenHooks) => void
  /** Close the top panel, or every panel (app rules' Close panel). */
  close?: (all?: boolean) => void
  /** Inside a panel: its key (nested opens stack on top). */
  panelKey?: string
}

const OpenContext = createContext<OpenApi | null>(null)
export const useOpenTarget = () => useContext(OpenContext)

/** Renders an app page inside a panel (provided by the app page view, to avoid an import cycle). */
export type PageRenderer = (input: { slug: string; filters: Record<string, string>; params?: Record<string, string>; panelKey: string }) => ReactNode

function useMedia(query: string): boolean {
  const [match, setMatch] = useState(false)
  useEffect(() => {
    const m = window.matchMedia(query)
    const update = () => setMatch(m.matches)
    update()
    m.addEventListener("change", update)
    return () => m.removeEventListener("change", update)
  }, [query])
  return match
}

export function PanelStackProvider({ appSlug, base, renderPage, children }: { appSlug: string; base: string; renderPage: PageRenderer; children: ReactNode }) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const mobile = useMedia("(max-width: 640px)")
  const reduced = useMedia("(prefers-reduced-motion: reduce)")
  const [stack, setStack] = useState<Panel[]>(() => decodePanels(params.get("panel")))
  const [confirm, setConfirm] = useState<{ key: string | null } | null>(null)
  const [workflow, setWorkflow] = useState<{ id: string; name: string } | null>(null)
  const openers = useRef(new Map<string, HTMLElement | null>())
  const hooks = useRef(new Map<string, OpenHooks>())
  // The app's view stays mounted across its pages (app/(dashboard)/apps/[slug]/layout.tsx): another page
  // (a link, Back / Forward) starts from that address's own ?panel=, not the previous page's panels.
  const [stackPath, setStackPath] = useState(pathname)
  if (stackPath !== pathname) {
    setStackPath(pathname)
    setStack(decodePanels(params.get("panel")))
  }

  // Mirror the stack in the URL (replace: panels aren't history entries).
  const encoded = encodePanels(stack)
  useEffect(() => {
    const current = params.get("panel")
    if ((current ?? null) === (encoded ?? null)) return
    const sp = new URLSearchParams(params.toString())
    if (encoded) sp.set("panel", encoded); else sp.delete("panel")
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [encoded]) // eslint-disable-line react-hooks/exhaustive-deps

  const navigate = useCallback((target: PanelTarget, newTab: boolean) => {
    const href = hrefOf(target, base, appSlug)
    if (!href) return
    if (newTab) window.open(href, "_blank", "noopener")
    // The app's view scrolls its own content to the top on a new page (AppPageView).
    else router.push(href, { scroll: false })
  }, [appSlug, base, router])

  const open = useCallback((target: PanelTarget, mode: OpenMode, title?: string, openHooks?: OpenHooks) => {
    if (target.t === "workflow") { setWorkflow({ id: target.id, name: title ?? "Start workflow" }); return }
    if (mode.mode === "navigate" || mode.mode === "tab") { navigate(target, mode.mode === "tab"); return }
    const panelMode = mode.mode === "inline" ? "modal" : mode.mode
    setStack((s) => {
      const next = pushPanel(s, { target, mode: panelMode, width: mode.width, motion: mode.motion, title: mode.title || title, titleFixed: !!mode.title || target.t === "page", size: designSize(mode), resizable: mode.resizable !== false }, { mobile })
      if (next.overflow) { queueMicrotask(() => navigate(target, false)); return s }
      const top = next.stack[next.stack.length - 1]
      if (top) openers.current.set(top.key, document.activeElement as HTMLElement | null)
      if (top && openHooks) hooks.current.set(top.key, openHooks)
      return next.stack
    })
  }, [mobile, navigate])

  const close = useCallback((key: string | null, force = false) => {
    setStack((s) => {
      const r = key ? closePanel(s, key, { force }) : popPanel(s, { force })
      if (r.confirm) { queueMicrotask(() => setConfirm({ key })); return s }
      const closed = s.filter((p) => !r.stack.includes(p))
      const closedKeys = closed.map((p) => p.key)
      const restore = closedKeys.length ? openers.current.get(closedKeys[0]) : null
      queueMicrotask(() => {
        restore?.focus?.()
        for (const p of closed) { const h = hooks.current.get(p.key); hooks.current.delete(p.key); h?.onClosed?.(p.target) }
      })
      return r.stack
    })
  }, [])

  useEffect(() => {
    if (!stack.length) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented) { e.preventDefault(); close(null) } }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [stack.length, close])

  const closeAll = useCallback((all?: boolean) => {
    setStack((s) => {
      if (!s.length) return s
      const keep = all ? [] : s.slice(0, -1)
      const closed = s.slice(keep.length)
      queueMicrotask(() => { for (const p of closed) { const h = hooks.current.get(p.key); hooks.current.delete(p.key); h?.onClosed?.(p.target) } })
      return keep
    })
  }, [])
  const api = useMemo<OpenApi>(() => ({ open, close: closeAll }), [open, closeAll])
  const crumbs = breadcrumb(stack)

  return (
    <OpenContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" && stack.length > 0 && createPortal(
        <div className="app-panels" data-app-panels={stack.length}>
          {stack.map((panel, i) => (
            <PanelFrame key={panel.key} panel={panel} depth={stack.length - 1 - i} index={i} crumbs={crumbs.slice(0, i + 1)}
              motion={motionFor(panel.mode, panel.motion, reduced)} onClose={() => close(panel.key)} onBack={i > 0 ? () => close(panel.key) : undefined}
              onCrumb={(j) => { const target = stack[j + 1]; if (target) close(target.key) }}
              popout={hrefOf(panel.target, base, appSlug)}>
              {(slot) => (
                <OpenContext.Provider value={{ open, close: closeAll, panelKey: panel.key }}>
                  <PanelBody panel={panel} renderPage={renderPage} actionsSlot={slot}
                    onSubmitted={(r) => { if (panel.target.t === "form") hooks.current.get(panel.key)?.onSubmitted?.({ form_id: panel.target.id, ...r }) }}
                    onTitle={(title) => setStack((s) => s.map((p) => (p.key === panel.key && !p.titleFixed ? { ...p, title } : p)))}
                    onDirty={(d) => setStack((s) => markDirty(s, panel.key, d))}
                    onDone={() => close(panel.key, true)} />
                </OpenContext.Provider>
              )}
            </PanelFrame>
          ))}
        </div>,
        document.body,
      )}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }} title="Discard the form you started?"
        description="It has answers that haven’t been sent." confirmLabel="Discard" destructive
        onConfirm={() => { const k = confirm?.key ?? null; setConfirm(null); close(k, true) }} />
      <RunWorkflowDialog workflow={workflow} open={!!workflow} onOpenChange={(o) => { if (!o) setWorkflow(null) }} />
    </OpenContext.Provider>
  )
}

export function hrefOf(t: PanelTarget, base: string, appSlug: string): string | null {
  switch (t.t) {
    case "page": {
      const qs = new URLSearchParams([...Object.entries(t.filters ?? {}).map(([k, v]) => [filterParam(k), v]), ...Object.entries(t.params ?? {}).map(([k, v]) => [`p.${k}`, v])]).toString()
      return `${base}/${appSlug}/${t.slug}${qs ? `?${qs}` : ""}`
    }
    case "form": return formAppPath(t.id)
    case "report": return `/reports/${t.id}`
    case "record": return `/data/${t.table}`
    case "task": return `/tasks/${t.id}`
    case "workflow": return null
  }
}

function useViewport() {
  const [vp, setVp] = useState({ w: 1280, h: 800 })
  useEffect(() => {
    const update = () => setVp({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [])
  return vp
}

/**
 * One open panel: sized by the designer (percent of the window: modal
 * width × height, panels width, sheets height), resizable by the person
 * when allowed (edge / corner handles — also with the keyboard: focus a
 * handle and use the arrow keys — a maximise / restore button, double-click
 * the header), their size remembered per target. Header: breadcrumb, the
 * form's own actions (favourite, Save draft) in the same row, open in a new
 * tab, maximise, close.
 */
function PanelFrame({ panel, depth, index, crumbs, motion, onClose, onBack, onCrumb, popout, children }: {
  panel: Panel; depth: number; index: number; crumbs: string[]; motion: ReturnType<typeof motionFor>
  onClose: () => void; onBack?: () => void; onCrumb: (i: number) => void; popout: string | null; children: (actionsSlot: HTMLElement | null) => ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const vp = useViewport()
  const key = sizeKey(panel.target)
  const [size, setSize] = useState<{ w: number; h: number }>(() => (panel.resizable !== false && typeof window !== "undefined" ? parseSavedSize(window.localStorage.getItem(key)) : null) ?? panel.size ?? { w: 52, h: 70 })
  const [max, setMax] = useState(false)
  const save = (next: { w: number; h: number }) => { setSize(next); try { window.localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage unavailable */ } }
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    const first = ref.current?.querySelector<HTMLElement>("[data-panel-autofocus], [data-standalone-form] input, button, [href], input, select, textarea")
    first?.focus({ preventScroll: true })
    return () => cancelAnimationFrame(id)
  }, [])
  const top = depth === 0
  const side = panel.mode === "panel_right" || panel.mode === "panel_left"
  const full = panel.mode === "fullscreen" || max
  const px = sizePx(full ? { w: 100, h: 100 } : size, vp)
  const resizable = panel.resizable !== false && panel.mode !== "fullscreen"
  const drag = (edges: { x?: 1 | -1; y?: 1 | -1 }) => (e: React.PointerEvent) => {
    if (!resizable || e.button !== 0) return
    e.preventDefault()
    const startX = e.clientX, startY = e.clientY, start = { ...px }
    const centred = panel.mode === "modal" ? 2 : 1
    const move = (ev: PointerEvent) => {
      const w = edges.x ? start.w + edges.x * (ev.clientX - startX) * centred : start.w
      const h = edges.y ? start.h + edges.y * (ev.clientY - startY) * centred : start.h
      setSize({ w: Math.min(100, Math.max(10, (w / vp.w) * 100)), h: Math.min(100, Math.max(10, (h / vp.h) * 100)) })
      setMax(false)
    }
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up)
      setSize((s) => { const r = { w: Math.round(s.w), h: Math.round(s.h) }; try { window.localStorage.setItem(key, JSON.stringify(r)) } catch { /* unavailable */ } return r })
    }
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up)
  }
  const keyResize = (axis: "w" | "h", sign: 1 | -1) => (e: React.KeyboardEvent) => {
    const grow = axis === "w" ? (e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0) : (e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0)
    if (!grow) return
    e.preventDefault()
    save({ ...size, [axis]: Math.min(100, Math.max(20, size[axis] + grow * sign * 5)) })
  }
  // Panels underneath peek out by 24px per level.
  const offset = side && depth > 0 ? { [panel.mode === "panel_right" ? "right" : "left"]: `${Math.min(depth, 3) * 24}px` } : undefined
  const from = !shown ? (motion === "slide-right" ? "translate-x-full" : motion === "slide-left" ? "-translate-x-full" : motion === "slide-up" ? "translate-y-full" : motion === "fade" ? "opacity-0" : "") : ""
  const style: React.CSSProperties = panel.mode === "modal"
    ? { width: px.w, height: px.h, left: (vp.w - px.w) / 2, top: (vp.h - px.h) / 2 }
    : panel.mode === "sheet" ? { height: px.h } : side ? { width: full ? vp.w : px.w } : {}
  const box = panel.mode === "modal" ? cn("rounded-xl", full && "rounded-none")
    : panel.mode === "sheet" ? "inset-x-0 bottom-0 rounded-t-xl"
    : panel.mode === "fullscreen" ? "inset-0"
    : cn("inset-y-0", panel.mode === "panel_right" ? "right-0 border-l" : "left-0 border-r")
  const handle = "absolute z-10 touch-none focus-visible:bg-[var(--theme-primary)]/30 focus-visible:outline-none"
  return (
    <>
      {index === 0 && <div aria-hidden className={cn("fixed inset-0 z-[900] bg-black/40 transition-opacity duration-200 motion-reduce:transition-none", shown ? "opacity-100" : "opacity-0")} onClick={onClose} />}
      <div ref={ref} role="dialog" aria-modal={top} aria-label={crumbs[crumbs.length - 1]} data-app-panel={panel.mode} data-panel-depth={depth}
        style={{ zIndex: 901 + index, ...style, ...offset }}
        className={cn("fixed flex flex-col overflow-hidden border-border bg-elevated shadow-elev-3", box,
          motion !== "none" && "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
          panel.mode === "modal" && !shown && motion !== "none" ? (motion === "fade" ? "opacity-0" : "scale-95 opacity-0") : from,
          !top && "pointer-events-none brightness-95")}
        inert={!top || undefined}>
        <header className="flex h-11 shrink-0 items-center gap-1 border-b border-border px-2" onDoubleClick={() => resizable && setMax((m) => !m)}>
          {onBack && <IconButton size="sm" label="Back" icon={<ChevronLeft />} onClick={onBack} />}
          <nav aria-label="Open panels" className="min-w-0 flex-1 truncate px-1 text-sm">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="mx-1 text-fg-subtle" aria-hidden>›</span>}
                {i < crumbs.length - 1
                  ? <button type="button" className="text-fg-muted hover:underline" onClick={() => onCrumb(i)}>{c}</button>
                  : <span className="font-medium text-fg" aria-current="page">{c}</span>}
              </span>
            ))}
          </nav>
          <div ref={setSlot} className="flex shrink-0 items-center gap-0.5 empty:hidden" data-panel-actions />
          {popout && <IconButton size="sm" label="Open in a new tab" icon={<ExternalLink />} onClick={() => window.open(popout, "_blank", "noopener")} />}
          {resizable && <IconButton size="sm" label={max ? "Restore size" : "Maximise"} icon={max ? <Minimize2 /> : <Maximize2 />} onClick={() => setMax((m) => !m)} data-panel-maximise />}
          <DialogAgentSlot className="mt-0" />
          <IconButton size="sm" label="Close" icon={<X />} onClick={onClose} data-panel-close />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children(slot)}</div>
        {resizable && !max && (
          <>
            {(panel.mode === "modal" || panel.mode === "panel_left") && <div role="separator" aria-orientation="vertical" aria-label="Resize width" tabIndex={0} onKeyDown={keyResize("w", 1)} onPointerDown={drag({ x: 1 })} className={cn(handle, "inset-y-0 right-0 w-1.5 cursor-ew-resize")} />}
            {(panel.mode === "modal" || panel.mode === "panel_right") && <div role="separator" aria-orientation="vertical" aria-label="Resize width" tabIndex={0} onKeyDown={keyResize("w", -1)} onPointerDown={drag({ x: -1 })} className={cn(handle, "inset-y-0 left-0 w-1.5 cursor-ew-resize")} />}
            {panel.mode === "modal" && <div role="separator" aria-orientation="horizontal" aria-label="Resize height" tabIndex={0} onKeyDown={keyResize("h", 1)} onPointerDown={drag({ y: 1 })} className={cn(handle, "inset-x-0 bottom-0 h-1.5 cursor-ns-resize")} />}
            {panel.mode === "modal" && <div aria-hidden onPointerDown={drag({ x: 1, y: 1 })} className={cn(handle, "bottom-0 right-0 size-3 cursor-nwse-resize")} />}
            {panel.mode === "sheet" && <div role="separator" aria-orientation="horizontal" aria-label="Resize height" tabIndex={0} onKeyDown={keyResize("h", -1)} onPointerDown={drag({ y: -1 })} className={cn(handle, "inset-x-0 top-0 h-1.5 cursor-ns-resize")} />}
          </>
        )}
      </div>
    </>
  )
}

function PanelBody({ panel, renderPage, onDirty, onDone, actionsSlot, onTitle, onSubmitted }: { panel: Panel; renderPage: PageRenderer; onDirty: (d: boolean) => void; onDone: () => void; actionsSlot: HTMLElement | null; onTitle: (title: string) => void; onSubmitted?: (r: { submission_id: string | null; values: Record<string, unknown> }) => void }) {
  const t = panel.target
  switch (t.t) {
    case "page": return <div className="p-3">{renderPage({ slug: t.slug, filters: t.filters ?? {}, params: t.params, panelKey: panel.key })}</div>
    case "form": return <div className="h-full"><StandaloneForm formId={t.id} surface="app" fill hideHeader actionsTarget={actionsSlot} contextParams={t.params ?? null} query={t.params} onTitle={onTitle} onDirtyChange={onDirty} onSubmitted={onSubmitted} onDone={() => onDone()} /></div>
    case "report": return <div className="h-full p-3"><ReportWidget reportId={t.id} /></div>
    case "task": return <TaskDetailPanel taskId={t.id} title={panel.title ?? "Task"} compact onClose={onDone} />
    case "record": return <RecordPanel table={t.table} row={t.row ?? null} />
    default: return null
  }
}

/** A data table row, read-only (data.view), with a link to edit it in Data. */
function RecordPanel({ table, row }: { table: string; row: string | null }) {
  const meta = useQuery({ queryKey: ["data", "table", table], queryFn: () => serverQuery("data.table", { id: table }) })
  const data = useQuery({ queryKey: ["data", "rowData", row], enabled: !!row, queryFn: () => serverQuery("data.rowData", { id: row! }) })
  if (meta.isPending || (row && data.isPending)) return <div className="space-y-2 p-4"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-2/3" /></div>
  const columns = (((meta.data as { columns?: unknown } | null)?.columns ?? []) as Array<{ key: string; name?: string }>).filter((c) => c?.key)
  if (!meta.data) return <p className="p-4 text-sm text-fg-muted" role="alert">This data table isn’t available to you.</p>
  if (!row) return <p className="p-4 text-sm text-fg-muted">Add a new row in <a className="text-primary-text underline" href={`/data/${table}`}>{(meta.data as { name?: string }).name ?? "the data table"}</a>.</p>
  const values = (data.data ?? {}) as Record<string, unknown>
  return (
    <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-2 p-4 text-sm" data-record-panel>
      {columns.map((c) => (
        <div key={c.key} className="contents">
          <dt className="text-fg-muted">{c.name ?? c.key}</dt>
          <dd className="min-w-0 break-words text-fg">{cell(values[c.key])}</dd>
        </div>
      ))}
    </dl>
  )
}

function cell(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—"
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (Array.isArray(v)) return v.map(cell).join(", ")
  if (typeof v === "object") { const o = v as Record<string, unknown>; return String(o.label ?? o.name ?? o.display_name ?? o.value ?? JSON.stringify(v)) }
  return String(v)
}

export { MAX_PANELS, defaultTitle }
