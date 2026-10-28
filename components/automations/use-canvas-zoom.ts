"use client"

import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import {
  centreOn, clampZoom, clientToCanvas, contentTransform, realiseView, FIT_MAX_ZOOM, fitView, MIN_READABLE_ZOOM, parseView, pinchStep, readableInitialView,
  SELECTION_MAX_ZOOM, serializeView, stepFocusView, stepZoom, touchCentre, touchDistance, viewportToCanvas, viewStorageKey, wheelAction, wheelZoomFactor, zoomAroundPoint,
  zoomShortcut, type Bounds, type CanvasView, type Point, type ZoomShortcut,
} from "@/lib/canvas-zoom"
import { isEditableTarget } from "@/lib/workflow-history"

/** Event dispatched on the scroll container whenever zoom or scroll changes (minimap listens). */
export const CANVAS_VIEW_EVENT = "canvas-view"

interface Options {
  scrollRef: React.RefObject<HTMLDivElement | null>
  contentRef: React.RefObject<HTMLDivElement | null>
  /** Element whose focus enables keyboard shortcuts (the designer / viewer root). */
  rootRef?: React.RefObject<HTMLElement | null>
  /** sessionStorage scope (e.g. `workflow:<id>`); no persistence when omitted. */
  storageScope?: string
  /** Bounds of everything on the canvas (canvas coordinates). */
  getContentBounds: () => Bounds | null
  /** Bounds of the current selection, if any. */
  getSelectionBounds?: () => Bounds | null
  /** Shortcuts are ignored while true (a dialog is open). */
  blocked?: boolean
  /** Open fitted to the content when there is no saved view (default true). */
  initialFit?: boolean
  /** Changes when the canvas element mounts / unmounts (e.g. a tab switch): listeners re-attach. */
  attachKey?: unknown
  /** The step a run preview focuses (current / failed / start): opening view and Shift+3. */
  getFocusBounds?: () => Bounds | null
  /**
   * Run preview: open fitted but never below `minZoom` (else centred on the
   * focus step), restore only the remembered zoom (the position follows the
   * run), and keep the centre when the viewport is resized (expand / full screen).
   */
  preview?: { minZoom?: number }
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

function isBackground(target: EventTarget | null, container: HTMLElement): boolean {
  const el = target as HTMLElement | null
  return !!el && (el === container || el.dataset?.canvasBg === "true")
}

/**
 * Canvas navigation shared by the workflow designer and the process viewer:
 * pointer-anchored Ctrl/⌘ + wheel and pinch zoom, buttons and shortcuts,
 * space / middle-mouse / background drag panning, two-finger touch, fit and
 * zoom-to-selection, and a per-scope view kept in sessionStorage.
 *
 * Live gestures write the transform and scroll offsets straight to the DOM
 * (one write per animation frame); React state `zoom` follows shortly after,
 * so a pinch does not re-render the whole designer on every frame.
 */
export function useCanvasZoom({ scrollRef, contentRef, rootRef, storageScope, getContentBounds, getSelectionBounds, blocked = false, initialFit = true, attachKey, getFocusBounds, preview }: Options) {
  const [zoom, setZoom] = useState(1)
  const zoomRef = useRef(1)
  /** Content translate for the view's negative (virtual) scroll; committed with `zoom`. */
  const offsetRef = useRef({ x: 0, y: 0 })
  const [transform, setTransform] = useState("scale(1)")
  const [panning, setPanning] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const spaceRef = useRef(false)
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animRef = useRef<number | null>(null)
  const hoverRef = useRef(false)
  const latest = useRef({ getContentBounds, getSelectionBounds, getFocusBounds, blocked })
  useEffect(() => { latest.current = { getContentBounds, getSelectionBounds, getFocusBounds, blocked } })
  const previewMinZoom = preview ? preview.minZoom ?? MIN_READABLE_ZOOM : null

  const getView = useCallback((): CanvasView => {
    const el = scrollRef.current
    // Virtual scroll: the real scroll minus the content's overscroll translate.
    return { zoom: zoomRef.current, scrollLeft: (el?.scrollLeft ?? 0) - offsetRef.current.x, scrollTop: (el?.scrollTop ?? 0) - offsetRef.current.y }
  }, [scrollRef])

  const viewportSize = useCallback(() => {
    const el = scrollRef.current
    return { width: el?.clientWidth ?? 0, height: el?.clientHeight ?? 0 }
  }, [scrollRef])

  const persist = useCallback(() => {
    if (!storageScope) return
    if (persistTimer.current) clearTimeout(persistTimer.current)
    persistTimer.current = setTimeout(() => {
      try { sessionStorage.setItem(viewStorageKey(storageScope), serializeView(getView())) } catch { /* storage unavailable */ }
    }, 200)
  }, [storageScope, getView])

  /** Write a view to the DOM now; `commit` = when React state follows (immediately or after the gesture). */
  const applyView = useCallback((view: CanvasView, commit: "now" | "later" = "now") => {
    const el = scrollRef.current
    const content = contentRef.current
    const z = clampZoom(view.zoom)
    zoomRef.current = z
    const real = realiseView({ ...view, zoom: z }, el ? { width: el.clientWidth, height: el.clientHeight } : undefined)
    offsetRef.current = { x: real.offsetX, y: real.offsetY }
    const t = contentTransform(z, real.offsetX, real.offsetY)
    if (content) content.style.transform = t
    if (el) {
      el.scrollLeft = real.scrollLeft
      el.scrollTop = real.scrollTop
      el.dispatchEvent(new Event(CANVAS_VIEW_EVENT))
    }
    if (commitTimer.current) clearTimeout(commitTimer.current)
    const commitNow = () => { setZoom(zoomRef.current); setTransform(contentTransform(zoomRef.current, offsetRef.current.x, offsetRef.current.y)) }
    if (commit === "now") commitNow()
    else commitTimer.current = setTimeout(commitNow, 120)
    persist()
  }, [scrollRef, contentRef, persist])

  const cancelAnimation = useCallback(() => {
    if (animRef.current != null) cancelAnimationFrame(animRef.current)
    animRef.current = null
  }, [])

  /** Animate to `target`: zoom interpolates geometrically, the canvas point at the viewport centre linearly. */
  const animateTo = useCallback((target: CanvasView, durationMs = 180) => {
    cancelAnimation()
    const size = viewportSize()
    const start = getView()
    if (prefersReducedMotion() || size.width === 0) { applyView(target); return }
    const centre = { x: size.width / 2, y: size.height / 2 }
    const c0 = viewportToCanvas(centre, start)
    const c1 = viewportToCanvas(centre, target)
    const t0 = performance.now()
    const ease = (t: number) => 1 - Math.pow(1 - t, 3)
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs)
      if (t >= 1) { animRef.current = null; applyView(target); return }
      const k = ease(t)
      const z = start.zoom * Math.pow(target.zoom / start.zoom, k)
      const c = { x: c0.x + (c1.x - c0.x) * k, y: c0.y + (c1.y - c0.y) * k }
      applyView({ zoom: z, scrollLeft: c.x * z - centre.x, scrollTop: c.y * z - centre.y }, "later")
      animRef.current = requestAnimationFrame(step)
    }
    animRef.current = requestAnimationFrame(step)
  }, [applyView, cancelAnimation, getView, viewportSize])

  /** Zoom to `z` around a viewport point (default: the viewport centre). */
  const zoomTo = useCallback((z: number, anchor?: Point, animate = true) => {
    const size = viewportSize()
    const a = anchor ?? { x: size.width / 2, y: size.height / 2 }
    const target = zoomAroundPoint(getView(), z, a)
    if (animate) animateTo(target)
    else applyView(target)
  }, [animateTo, applyView, getView, viewportSize])

  const zoomIn = useCallback(() => zoomTo(stepZoom(zoomRef.current, "in")), [zoomTo])
  const zoomOut = useCallback(() => zoomTo(stepZoom(zoomRef.current, "out")), [zoomTo])

  const fitBounds = useCallback((bounds: Bounds | null, maxZoom = FIT_MAX_ZOOM, animate = true) => {
    if (!bounds) return false
    const size = viewportSize()
    if (size.width === 0 || size.height === 0) return false
    const target = fitView(bounds, size, { maxZoom })
    if (animate) animateTo(target, 260)
    else applyView(target)
    return true
  }, [animateTo, applyView, viewportSize])

  const fitContent = useCallback((animate = true) => fitBounds(latest.current.getContentBounds(), FIT_MAX_ZOOM, animate), [fitBounds])
  const fitSelection = useCallback(() => fitBounds(latest.current.getSelectionBounds?.() ?? null, SELECTION_MAX_ZOOM), [fitBounds])

  /** Zoom to one step: centred, at least 100% (a run preview's step list / logs). */
  const focusBounds = useCallback((bounds: Bounds | null, animate = true) => {
    if (!bounds) return false
    const size = viewportSize()
    if (size.width === 0 || size.height === 0) return false
    const target = stepFocusView(bounds, getView(), size)
    if (animate) animateTo(target, 260)
    else applyView(target)
    return true
  }, [animateTo, applyView, getView, viewportSize])
  const fitFocus = useCallback(() => focusBounds(latest.current.getFocusBounds?.() ?? null), [focusBounds])

  /** Centre the viewport on a canvas point at the current zoom (minimap click). */
  const centreAt = useCallback((c: Point) => {
    animateTo(centreOn(c, getView(), viewportSize()))
  }, [animateTo, getView, viewportSize])

  const toCanvas = useCallback((client: Point): Point => {
    const el = scrollRef.current
    if (!el) return client
    return clientToCanvas(client, el.getBoundingClientRect(), getView(), { x: el.clientLeft, y: el.clientTop })
  }, [scrollRef, getView])

  const runShortcut = useCallback((s: ZoomShortcut) => {
    if (s === "in") zoomIn()
    else if (s === "out") zoomOut()
    else if (s === "reset") zoomTo(1)
    else if (s === "fit") fitContent()
    else if (s === "step") fitFocus()
    else fitSelection()
  }, [zoomIn, zoomOut, zoomTo, fitContent, fitSelection, fitFocus])

  // ─── Initial view: the saved one, else fitted to the content ───
  const restored = useRef<unknown>(Symbol("unset"))
  useLayoutEffect(() => {
    if (restored.current === attachKey || !scrollRef.current) return
    restored.current = attachKey
    let saved: CanvasView | null = null
    if (storageScope) { try { saved = parseView(sessionStorage.getItem(viewStorageKey(storageScope))) } catch { saved = null } }
    if (previewMinZoom != null) {
      const content = latest.current.getContentBounds()
      const size = viewportSize()
      if (!content || size.width === 0 || size.height === 0) return
      const { view } = readableInitialView(content, size, { focus: latest.current.getFocusBounds?.() ?? null, minZoom: previewMinZoom, savedZoom: saved?.zoom ?? null })
      applyView(view)
    } else if (saved) applyView(saved)
    else if (initialFit) fitContent(false)
  }, [scrollRef, storageScope, applyView, fitContent, initialFit, attachKey, previewMinZoom, viewportSize])

  // ─── Preview: keep the canvas point at the centre when the viewport resizes (expand / full screen / window) ───
  const isPreview = previewMinZoom != null
  useEffect(() => {
    const el = scrollRef.current
    if (!isPreview || !el || typeof ResizeObserver === "undefined") return
    let last = { width: el.clientWidth, height: el.clientHeight }
    const ro = new ResizeObserver(() => {
      const next = { width: el.clientWidth, height: el.clientHeight }
      if (next.width === last.width && next.height === last.height) return
      if (last.width > 0 && last.height > 0 && next.width > 0 && next.height > 0) {
        const view = getView()
        const c = viewportToCanvas({ x: last.width / 2, y: last.height / 2 }, view)
        applyView(centreOn(c, view, next))
      }
      last = next
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [isPreview, scrollRef, getView, applyView, attachKey])

  // ─── Wheel, touch, scroll (native listeners: wheel / touchmove must be non-passive) ───
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let pendingFactor = 1
    let pendingAnchor: Point | null = null
    let frame: number | null = null

    function onWheel(e: WheelEvent) {
      if (wheelAction(e) === "pan") return // native scrolling pans
      e.preventDefault() // no browser page zoom over the canvas
      cancelAnimation()
      const rect = el!.getBoundingClientRect()
      pendingAnchor = { x: e.clientX - rect.left - el!.clientLeft, y: e.clientY - rect.top - el!.clientTop }
      pendingFactor *= wheelZoomFactor(e)
      if (frame == null) {
        frame = requestAnimationFrame(() => {
          frame = null
          const view = getView()
          applyView(zoomAroundPoint(view, view.zoom * pendingFactor, pendingAnchor!), "later")
          pendingFactor = 1
        })
      }
    }

    let pinch: { centre: Point; distance: number } | null = null
    function touchState(e: TouchEvent) {
      const rect = el!.getBoundingClientRect()
      const c = touchCentre(e.touches[0], e.touches[1])
      return { centre: { x: c.x - rect.left, y: c.y - rect.top }, distance: touchDistance(e.touches[0], e.touches[1]) }
    }
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) { pinch = touchState(e); cancelAnimation() }
    }
    function onTouchMove(e: TouchEvent) {
      if (e.touches.length !== 2 || !pinch) return
      e.preventDefault()
      const next = touchState(e)
      applyView(pinchStep(getView(), pinch, next), "later")
      pinch = next
    }
    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinch = null
    }
    function onScroll() {
      el!.dispatchEvent(new Event(CANVAS_VIEW_EVENT))
      persist()
    }
    const enter = () => { hoverRef.current = true }
    const leave = () => { hoverRef.current = false }

    el.addEventListener("wheel", onWheel, { passive: false })
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: false })
    el.addEventListener("touchend", onTouchEnd)
    el.addEventListener("touchcancel", onTouchEnd)
    el.addEventListener("scroll", onScroll, { passive: true })
    el.addEventListener("pointerenter", enter)
    el.addEventListener("pointerleave", leave)
    return () => {
      if (frame != null) cancelAnimationFrame(frame)
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("touchend", onTouchEnd)
      el.removeEventListener("touchcancel", onTouchEnd)
      el.removeEventListener("scroll", onScroll)
      el.removeEventListener("pointerenter", enter)
      el.removeEventListener("pointerleave", leave)
    }
  }, [scrollRef, applyView, cancelAnimation, getView, persist, attachKey])

  // ─── Keyboard: zoom shortcuts + space-to-pan, only while the designer has focus ───
  useEffect(() => {
    function hasFocus(): boolean {
      const active = document.activeElement
      const root = rootRef?.current ?? scrollRef.current
      if (!root) return false
      if (active && active !== document.body && root.contains(active)) return true
      // Nothing focused (e.g. after clicking a non-focusable part): the pointer decides.
      return (!active || active === document.body) && hoverRef.current
    }
    /** A dialog over the canvas (not one the canvas itself lives in, e.g. a run preview dialog). */
    function inDialog(target: EventTarget | null) {
      const dialog = (target as HTMLElement | null)?.closest?.('[role="dialog"], [aria-modal="true"]')
      return !!dialog && !(scrollRef.current && dialog.contains(scrollRef.current))
    }
    function onKeyDown(e: KeyboardEvent) {
      if (latest.current.blocked || inDialog(e.target) || !hasFocus()) return
      if (e.code === "Space" && !e.repeat && !isEditableTarget(e.target) && !(e.target as HTMLElement)?.closest?.("button, a, [role='menuitem']")) {
        e.preventDefault()
        spaceRef.current = true
        setSpaceHeld(true)
        return
      }
      if (e.code === "Space" && spaceRef.current) { e.preventDefault(); return }
      const s = zoomShortcut(e)
      if (!s) return
      e.preventDefault() // overrides the browser's page zoom while the canvas has focus
      runShortcut(s)
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === "Space" && spaceRef.current) { spaceRef.current = false; setSpaceHeld(false) }
    }
    function onBlur() { spaceRef.current = false; setSpaceHeld(false) }
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    window.addEventListener("blur", onBlur)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
      window.removeEventListener("blur", onBlur)
    }
  }, [rootRef, scrollRef, runShortcut])

  useEffect(() => () => {
    cancelAnimation()
    if (commitTimer.current) clearTimeout(commitTimer.current)
    if (persistTimer.current) clearTimeout(persistTimer.current)
  }, [cancelAnimation])

  // ─── Drag panning: space + drag or middle mouse anywhere, left drag on the background ───
  const panStart = useRef<{ x: number; y: number; left: number; top: number; id: number } | null>(null)

  function beginPan(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current
    if (!el) return
    cancelAnimation()
    const v = getView()
    panStart.current = { x: e.clientX, y: e.clientY, left: v.scrollLeft, top: v.scrollTop, id: e.pointerId }
    try { el.setPointerCapture(e.pointerId) } catch { /* synthetic pointer */ }
    setPanning(true)
  }

  const canvasHandlers = {
    // Capture phase: space / middle-button drags pan even over nodes (the node's drag never starts).
    onPointerDownCapture(e: React.PointerEvent<HTMLDivElement>) {
      if (e.pointerType === "touch") return
      if (e.button === 1 || (e.button === 0 && spaceRef.current)) {
        e.preventDefault()
        e.stopPropagation()
        beginPan(e)
      }
    },
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.pointerType === "touch" || e.button !== 0 || panStart.current) return
      if (isBackground(e.target, e.currentTarget)) beginPan(e)
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const p = panStart.current
      const el = scrollRef.current
      if (!p || !el || e.pointerId !== p.id) return
      e.preventDefault()
      // Through the virtual view, so panning can reach past the top-left edge.
      applyView({ zoom: zoomRef.current, scrollLeft: p.left - (e.clientX - p.x), scrollTop: p.top - (e.clientY - p.y) }, "later")
    },
    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      if (!panStart.current || e.pointerId !== panStart.current.id) return
      panStart.current = null
      setPanning(false)
    },
    onPointerCancel() {
      panStart.current = null
      setPanning(false)
    },
    // Middle click: no autoscroll (Windows) or primary-selection paste (Linux).
    onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
      if (e.button === 1) e.preventDefault()
    },
  }

  return {
    zoom, zoomRef, getView, applyView,
    /** CSS transform for the content element (zoom + overscroll translate). */
    transform, zoomTo, zoomIn, zoomOut, fitBounds, fitContent, fitSelection, focusBounds, fitFocus, centreAt, toCanvas,
    panning, spaceHeld, canvasHandlers,
    /** Cursor class for the scroll container. */
    cursorClass: panning ? "cursor-grabbing" : spaceHeld ? "cursor-grab [&_*]:!cursor-grab" : "cursor-grab",
  }
}

/**
 * Committed canvas zoom for draggables inside the scaled content: dnd-kit
 * reports screen-pixel transforms, which must be divided by the zoom to
 * follow the pointer.
 */
export const CanvasZoomContext = createContext(1)

/** dnd-kit transform (screen px) → CSS translate inside the scaled canvas. */
export function scaledDragTransform(transform: { x: number; y: number } | null, zoom: number): string | undefined {
  if (!transform) return undefined
  const z = zoom > 0 ? zoom : 1
  return `translate3d(${transform.x / z}px, ${transform.y / z}px, 0)`
}
