"use client"

import { useEffect, useRef, useState } from "react"
import { canvasToMinimap, minimapLayout, minimapToCanvas, unionBounds, visibleCanvasRect, type Bounds, type CanvasView, type Point } from "@/lib/canvas-zoom"
import { CANVAS_VIEW_EVENT } from "./use-canvas-zoom"

export interface MinimapItem extends Bounds {
  id: string
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
}

/**
 * Overview of the canvas: one block per step plus the visible viewport.
 * Click or drag to move the viewport. Re-renders on scroll / zoom only
 * itself, not the designer.
 */
export function CanvasMinimap({ items, scrollRef, getView, onNavigate, width = 160, height = 100 }: CanvasMinimapProps) {
  const [viewport, setViewport] = useState<Bounds | null>(null)
  const dragging = useRef(false)

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

  return (
    <div
      className="absolute bottom-3 left-3 rounded-lg border overflow-hidden z-20 shadow-sm"
      style={{ width, height, backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-canvas-minimap=""
    >
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
