"use client"

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
  MAX_PANELS, breadcrumb, closeKeyFor, closePanel, decodePanels, defaultTitle, designSize, encodePanels, historyPlan, markDirty, motionFor, panelHref, parseSavedSize, pushPanel,
  reconcileStack, sizeKey, sizePx, type Panel, type PanelCloseScope, type PanelTarget,
} from "@/lib/apps/panels"
import type { OpenMode } from "@/lib/apps/schema"
import { filterParam } from "@/lib/apps/widgets"
import { formAppPath } from "@/lib/forms/form-paths"
import { cn } from "@/lib/utils"
import { trapTabKey } from "@/lib/a11y/focus-trap"
import { ReportWidget } from "./widgets/report-widget"
// Panel motion, and dialogs opened over the panels lifted above them.
import "./apps.css"

/**
 * The app page's open-target host: modals, slide-in panels (right / left),
 * bottom sheets and full-screen overlays that STACK (lib/apps/panels.ts) —
 * opening a target from inside a panel slides a new one over; the previous
 * ones stay mounted and peek out, with a breadcrumb header. × and the
 * backdrop close the whole stack; the back chevron, a breadcrumb and Esc
 * close one level (or back to that level); closing asks first when a panel
 * holds an unsent form. Focus returns to what opened the closed panels, the
 * page behind doesn't scroll while panels are open, and the stack is mirrored
 * in the URL (?panel=…, one history entry per level: Back pops one) so a
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
  // The stack the handlers read and write synchronously (state follows it), so a close
  // decides on the panels on screen — not on a render that hasn't happened yet.
  const stackRef = useRef(stack)
  const [confirm, setConfirm] = useState<{ key: string } | null>(null)
  const [workflow, setWorkflow] = useState<{ id: string; name: string } | null>(null)
  const openers = useRef(new Map<string, HTMLElement | null>())
  const hooks = useRef(new Map<string, OpenHooks>())
  // Focus goes back here once the closed panels are gone (and the one below is no longer inert).
  const focusAfter = useRef<HTMLElement | null>(null)
  // History entries this session pushed for the stack's top levels (lib/apps/panels.ts historyPlan).
  const pushed = useRef(0)
  // While going back over our own entries: the ?panel= we are heading to (the address catches up later).
  const expected = useRef<{ value: string; until: number } | null>(null)
  // The app's view stays mounted across its pages (app/(dashboard)/apps/[slug]/layout.tsx): another page
  // (a link, Back / Forward) starts from that address's own ?panel=, not the previous page's panels.
  const [stackPath, setStackPath] = useState(pathname)
  if (stackPath !== pathname) {
    setStackPath(pathname)
    setStack(decodePanels(params.get("panel")))
  }
  useLayoutEffect(() => { stackRef.current = stack })
  useLayoutEffect(() => { pushed.current = 0; expected.current = null }, [pathname])

  /** Closed panels: their openers' focus comes back, their openers hear onClosed. */
  const settle = useCallback((prev: readonly Panel[], next: readonly Panel[]) => {
    const closed = prev.filter((p) => !next.some((n) => n.key === p.key))
    if (!closed.length) return
    const restore = openers.current.get(closed[0].key) ?? null
    if (restore) focusAfter.current = restore
    for (const p of closed) openers.current.delete(p.key)
    queueMicrotask(() => { for (const p of closed) { const h = hooks.current.get(p.key); hooks.current.delete(p.key); h?.onClosed?.(p.target) } })
  }, [])

  /** The address follows the stack: opening pushes an entry, closing goes back over ours (Back pops one level). */
  const writeHistory = useCallback((prev: readonly Panel[], next: readonly Panel[]) => {
    const before = encodePanels(prev) ?? ""
    const after = encodePanels(next) ?? ""
    const r = historyPlan(prev.length, next.length, pushed.current, before !== after)
    pushed.current = r.pushed
    const href = () => panelHref(window.location.pathname, window.location.search, stackRef.current)
    const { plan } = r
    if (plan.op === "push") window.history.pushState(null, "", href())
    else if (plan.op === "replace") window.history.replaceState(null, "", href())
    else if (plan.op === "back") {
      expected.current = { value: after, until: Date.now() + 1500 }
      if (plan.thenReplace) {
        const onPop = () => { window.removeEventListener("popstate", onPop); window.history.replaceState(null, "", href()) }
        window.addEventListener("popstate", onPop)
      }
      window.history.go(-plan.n)
    }
  }, [])

  const commit = useCallback((next: Panel[]) => {
    const prev = stackRef.current
    stackRef.current = next
    setStack(next)
    settle(prev, next)
    writeHistory(prev, next)
  }, [settle, writeHistory])

  // The browser's Back / Forward (or a link) changed ?panel=: the stack follows the address.
  const urlPanel = params.get("panel") ?? ""
  useEffect(() => {
    const exp = expected.current
    if (exp) {
      if (urlPanel === exp.value || Date.now() > exp.until) expected.current = null
      else return
    }
    const cur = stackRef.current
    if ((encodePanels(cur) ?? "") === urlPanel) return
    const r = reconcileStack(cur, decodePanels(urlPanel))
    pushed.current = Math.min(pushed.current, r.common) + (r.stack.length - r.common)
    stackRef.current = r.stack
    setStack(r.stack)
    settle(cur, r.stack)
  }, [urlPanel, settle])

  // Focus back to what opened the closed panels, once they're gone.
  useEffect(() => {
    const el = focusAfter.current
    if (!el) return
    focusAfter.current = null
    const id = requestAnimationFrame(() => { if (el.isConnected) el.focus({ preventScroll: true }) })
    return () => cancelAnimationFrame(id)
  }, [stack])

  // The page behind doesn't scroll while panels are open; it does again the moment they close.
  const anyOpen = stack.length > 0
  useEffect(() => (anyOpen ? lockPageScroll(document) : undefined), [anyOpen])

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
    const cur = stackRef.current
    const next = pushPanel(cur, { target, mode: panelMode, width: mode.width, motion: mode.motion, title: mode.title || title, titleFixed: !!mode.title || target.t === "page", size: designSize(mode), resizable: mode.resizable !== false }, { mobile })
    if (next.overflow) { navigate(target, false); return }
    const top = next.stack[next.stack.length - 1]
    if (top && !cur.some((p) => p.key === top.key)) openers.current.set(top.key, document.activeElement as HTMLElement | null)
    if (top && openHooks) hooks.current.set(top.key, openHooks)
    commit(next.stack)
  }, [mobile, navigate, commit])

  /** × and the backdrop: the whole stack; back and Esc: the top panel; a breadcrumb: the panels above it. */
  const close = useCallback((scope: PanelCloseScope | { key: string }, force = false) => {
    const cur = stackRef.current
    const key = typeof scope === "object" && "key" in scope ? scope.key : closeKeyFor(cur, scope)
    if (!key) return
    const r = closePanel(cur, key, { force })
    if (r.confirm) { setConfirm({ key }); return }
    commit(r.stack)
  }, [commit])

  useEffect(() => {
    if (!anyOpen || confirm) return
    // Radix layers (a menu, a picker, a dialog opened from a panel) handle their own Esc and mark it handled.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !e.defaultPrevented && !e.isComposing) { e.preventDefault(); close("top") } }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [anyOpen, confirm, close])

  // App rules' Close panel: the top one, or every panel.
  const closeApi = useCallback((all?: boolean) => close(all ? "all" : "top"), [close])
  const api = useMemo<OpenApi>(() => ({ open, close: closeApi }), [open, closeApi])
  const crumbs = breadcrumb(stack)

  return (
    <OpenContext.Provider value={api}>
      {children}
      {typeof document !== "undefined" && stack.length > 0 && createPortal(
        <div className="app-panels" data-app-panels={stack.length}>
          {stack.map((panel, i) => (
            <PanelFrame key={panel.key} panel={panel} depth={stack.length - 1 - i} index={i} crumbs={crumbs.slice(0, i + 1)}
              motion={motionFor(panel.mode, panel.motion, reduced)} onClose={() => close("all")} onBack={i > 0 ? () => close({ key: panel.key }) : undefined}
              onCrumb={(j) => close({ above: j })}
              popout={hrefOf(panel.target, base, appSlug)}>
              {(slot) => (
                <OpenContext.Provider value={{ open, close: closeApi, panelKey: panel.key }}>
                  <PanelBody panel={panel} renderPage={renderPage} actionsSlot={slot}
                    onSubmitted={(r) => { if (panel.target.t === "form") hooks.current.get(panel.key)?.onSubmitted?.({ form_id: panel.target.id, ...r }) }}
                    onTitle={(title) => { const next = stackRef.current.map((p) => (p.key === panel.key && !p.titleFixed ? { ...p, title } : p)); stackRef.current = next; setStack(next) }}
                    onDirty={(d) => { const next = markDirty(stackRef.current, panel.key, d); stackRef.current = next; setStack(next) }}
                    onDone={() => close({ key: panel.key }, true)} />
                </OpenContext.Provider>
              )}
            </PanelFrame>
          ))}
        </div>,
        document.body,
      )}
      {/* Above the panels (apps.css lifts any dialog opened while they're up). */}
      <ConfirmDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null) }} title="Discard the form you started?"
        description="It has answers that haven’t been sent." confirmLabel="Discard" destructive
        onConfirm={() => { const k = confirm?.key; setConfirm(null); if (k) close({ key: k }, true) }} />
      <RunWorkflowDialog workflow={workflow} open={!!workflow} onOpenChange={(o) => { if (!o) setWorkflow(null) }} />
    </OpenContext.Provider>
  )
}

/**
 * Lock the page behind the panels (the document and the shell's scrolling
 * <main>); returns the unlock, which puts back exactly what was there.
 */
export function lockPageScroll(doc: Document): () => void {
  const els = [doc.body, doc.getElementById("main")].filter((el): el is HTMLElement => !!el)
  const before = els.map((el) => el.style.overflow)
  for (const el of els) el.style.overflow = "hidden"
  doc.body.setAttribute("data-app-panels-open", "")
  return () => {
    els.forEach((el, i) => { el.style.overflow = before[i] })
    doc.body.removeAttribute("data-app-panels-open")
  }
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
    // Focus a form's first input, else the panel itself — not its first button (Back / a header icon):
    // that showed the button's tooltip, and the first Esc only closed the tooltip, not the panel.
    const first = ref.current?.querySelector<HTMLElement>("[data-panel-autofocus], [data-standalone-form] input")
    ;(first ?? ref.current)?.focus({ preventScroll: true })
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
      <div ref={ref} role="dialog" tabIndex={-1} aria-modal={top} aria-label={crumbs[crumbs.length - 1]} data-app-panel={panel.mode} data-panel-depth={depth}
        style={{ zIndex: 901 + index, ...style, ...offset }}
        className={cn("fixed flex flex-col overflow-hidden border-border bg-elevated shadow-elev-3 outline-none", box,
          motion !== "none" && "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
          panel.mode === "modal" && !shown && motion !== "none" ? (motion === "fade" ? "opacity-0" : "scale-95 opacity-0") : from,
          !top && "pointer-events-none brightness-95")}
        inert={!top || undefined}
        // Modal: Tab / Shift+Tab wrap inside the top panel instead of walking into the page behind the backdrop.
        onKeyDown={(e) => { if (top && ref.current) trapTabKey(ref.current, e) }}>
        {/* A size container: on a narrow panel the extras (new tab, maximise) go first, so × (and the Agent) always fit. */}
        <header className="@container flex h-11 shrink-0 items-center gap-1 border-b border-border px-2" onDoubleClick={() => resizable && setMax((m) => !m)} data-panel-header>
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
          {popout && <IconButton size="sm" label="Open in a new tab" icon={<ExternalLink />} onClick={() => window.open(popout, "_blank", "noopener")} className="shrink-0 @max-[26rem]:hidden" />}
          {resizable && <IconButton size="sm" label={max ? "Restore size" : "Maximise"} icon={max ? <Minimize2 /> : <Maximize2 />} onClick={() => setMax((m) => !m)} className="shrink-0 @max-[22rem]:hidden" data-panel-maximise />}
          <DialogAgentSlot className="mt-0" />
          {/* × closes the whole stack (back to the page); the back chevron and Esc close one level. */}
          <IconButton size="sm" label={depth === 0 && index > 0 ? "Close all panels" : "Close"} icon={<X />} onClick={onClose} className="shrink-0" data-panel-close />
        </header>
        <div className="min-h-0 flex-1 overflow-auto">{children(slot)}</div>
        {resizable && !max && (
          <>
            {(panel.mode === "modal" || panel.mode === "panel_left") && <div role="separator" aria-orientation="vertical" aria-label="Resize width" aria-valuenow={Math.round(size.w)} aria-valuemin={20} aria-valuemax={100} tabIndex={0} onKeyDown={keyResize("w", 1)} onPointerDown={drag({ x: 1 })} className={cn(handle, "inset-y-0 right-0 w-1.5 cursor-ew-resize")} />}
            {(panel.mode === "modal" || panel.mode === "panel_right") && <div role="separator" aria-orientation="vertical" aria-label="Resize width" aria-valuenow={Math.round(size.w)} aria-valuemin={20} aria-valuemax={100} tabIndex={0} onKeyDown={keyResize("w", -1)} onPointerDown={drag({ x: -1 })} className={cn(handle, "inset-y-0 left-0 w-1.5 cursor-ew-resize")} />}
            {panel.mode === "modal" && <div role="separator" aria-orientation="horizontal" aria-label="Resize height" aria-valuenow={Math.round(size.h)} aria-valuemin={20} aria-valuemax={100} tabIndex={0} onKeyDown={keyResize("h", 1)} onPointerDown={drag({ y: 1 })} className={cn(handle, "inset-x-0 bottom-0 h-1.5 cursor-ns-resize")} />}
            {panel.mode === "modal" && <div aria-hidden onPointerDown={drag({ x: 1, y: 1 })} className={cn(handle, "bottom-0 right-0 size-3 cursor-nwse-resize")} />}
            {panel.mode === "sheet" && <div role="separator" aria-orientation="horizontal" aria-label="Resize height" aria-valuenow={Math.round(size.h)} aria-valuemin={20} aria-valuemax={100} tabIndex={0} onKeyDown={keyResize("h", -1)} onPointerDown={drag({ y: -1 })} className={cn(handle, "inset-x-0 top-0 h-1.5 cursor-ns-resize")} />}
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
