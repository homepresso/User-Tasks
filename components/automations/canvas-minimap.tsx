"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Map as MapIcon, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { IconButton } from "@/components/ui/icon-button"
import { canvasToMinimap, minimapLayout, minimapToCanvas, unionBounds, visibleCanvasRect, type Bounds, type CanvasView, type Point } from "@/lib/canvas-zoom"
import { CANVAS_VIEW_EVENT } from "./use-canvas-zoom"

/** localStorage key of the minimap's shown / hidden choice (shared by every canvas). */
const MINIMAP_STORAGE_KEY = "ut.canvas.minimap"

const minimapListeners = new Set<() => void>()

function readMinimapShown(): boolean {
  try { return window.localStorage.getItem(MINIMAP_STORAGE_KEY) !== "hidden" } catch { return true }
}

function subscribeMinimapShown(onChange: () => void) {
  minimapListeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => { minimapListeners.delete(onChange); window.removeEventListener("storage", onChange) }
}

function writeMinimapShown(shown: boolean) {
  try { window.localStorage.setItem(MINIMAP_STORAGE_KEY, shown ? "shown" : "hidden") } catch { /* private mode */ }
  minimapListeners.forEach((l) => l())
}

export interface MinimapItem extends Bounds {
  id: string
  /** Any CSS colour (hex, `var(--…)`, `color-mix(…)`); used as the block's fill as is. */
  color: string
  selected?: boolean
}

interface CanvasMinimapProps {
  items: MinimapItem[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** Current (virtual) view of the canvas. */
  getView: () => CanvasView
  /** Centre the canvas viewport on a canvas point. */
  onNavigate: (c: Point) => void
  width?: number
  height?: number
  /** Position classes of the frame (default bottom-right). */
  className?: string
}

/**
 * Overview of the canvas: one block per step plus the visible viewport.
 * Click or drag to move the viewport. Re-renders on scroll / zoom only
 * itself, not the designer.
 */
export function CanvasMinimap({ items, scrollRef, getView, onNavigate, width = 160, height = 100, className }: CanvasMinimapProps) {
  const [viewport, setViewport] = useState<Bounds | null>(null)
  const dragging = useRef(false)
  // Shown by default (and on the server); the stored choice applies after hydration.
  const shown = useSyncExternalStore(subscribeMinimapShown, readMinimapShown, () => true)
  const toggleShown = writeMinimapShown

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let frame: number | null = null
    const update = () => {
      if (frame != null) return
      frame = requestAnimationFrame(() => {
        frame = null
        setViewport(visibleCanvasRect(getView(), { width: el.clientWidth, height: el.clientHeight }))
      })
    }
    update()
    el.addEventListener(CANVAS_VIEW_EVENT, update)
    el.addEventListener("scroll", update, { passive: true })
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => {
      if (frame != null) cancelAnimationFrame(frame)
      el.removeEventListener(CANVAS_VIEW_EVENT, update)
      el.removeEventListener("scroll", update)
      ro?.disconnect()
    }
  }, [scrollRef, getView])

  const content = unionBounds(items)
  if (!content) return null
  const layout = minimapLayout(content, viewport, { width, height })

  function navigate(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    onNavigate(minimapToCanvas({ x: e.clientX - rect.left, y: e.clientY - rect.top }, layout))
  }

  const vp = viewport ? { a: canvasToMinimap(viewport, layout), w: viewport.width * layout.scale, h: viewport.height * layout.scale } : null

  // Hidden on phones by default: it would cover most of a small canvas.
  const position = className ?? "absolute bottom-3 right-3 z-20 max-sm:hidden"

  if (!shown) {
    return (
      <div className={position} onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()} data-canvas-minimap="" data-collapsed="">
        <IconButton type="button" size="sm" variant="secondary" label="Show minimap" icon={<MapIcon />} tooltipSide="left"
          className="bg-elevated shadow-elev-2" onClick={() => toggleShown(true)} />
      </div>
    )
  }

  return (
    <div
      className={cn(position, "group/minimap rounded-lg border border-border bg-elevated shadow-elev-2 overflow-hidden opacity-60 transition-opacity hover:opacity-100 focus-within:opacity-100")}
      style={{ width, height }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-canvas-minimap=""
    >
      <IconButton type="button" size="sm" label="Hide minimap" icon={<X />} tooltipSide="left"
        className="absolute top-0.5 right-0.5 z-10 size-6 min-h-0 min-w-0 bg-elevated opacity-0 group-hover/minimap:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
        onClick={() => toggleShown(false)} />
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Canvas overview: click to move the view"
        className="cursor-pointer touch-none"
        onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); navigate(e) }}
        onPointerMove={(e) => { if (dragging.current) navigate(e) }}
        onPointerUp={() => { dragging.current = false }}
        onPointerCancel={() => { dragging.current = false }}
      >
        {items.map((it) => {
          const p = canvasToMinimap(it, layout)
          return (
            <rect key={it.id} x={p.x} y={p.y} width={Math.max(2, it.width * layout.scale)} height={Math.max(2, it.height * layout.scale)} rx={1.5}
              style={{ fill: it.color }} opacity={it.selected ? 1 : 0.55}
              stroke={it.selected ? "var(--theme-focus-ring)" : "none"} strokeWidth={it.selected ? 1.5 : 0} />
          )
        })}
        {vp && (
          <rect data-minimap-viewport="" x={vp.a.x} y={vp.a.y} width={Math.max(4, vp.w)} height={Math.max(4, vp.h)} rx={2}
            style={{ fill: "color-mix(in srgb, var(--theme-focus-ring) 10%, transparent)", stroke: "var(--theme-focus-ring)" }} strokeWidth={1.5} />
        )}
      </svg>
    </div>
  )
}
