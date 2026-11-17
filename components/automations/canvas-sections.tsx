"use client"

import { useLayoutEffect, useRef } from "react"
import { ChevronRight } from "lucide-react"
import type { WorkflowNode } from "@/lib/workflow-schema"
import type { CanvasView } from "@/lib/canvas-zoom"
import type { TriggerLane } from "@/lib/workflow-trigger-lane"
import { CANVAS_VIEW_EVENT } from "./use-canvas-zoom"
import { cn } from "@/lib/utils"
import { getSectionDimensions, SECTION_COLLAPSED_WIDTH, SECTION_HEADER_HEIGHT } from "@/lib/workflow-sections"

function rgb(hex: string) {
  return {
    r: parseInt(hex.slice(1, 3), 16) || 0,
    g: parseInt(hex.slice(3, 5), 16) || 0,
    b: parseInt(hex.slice(5, 7), 16) || 0,
  }
}

interface Lane { id: string; label: string; color: string; y: number; height: number }

/** Below this zoom the band labels are hidden: the bands are too thin to hold them. */
const BAND_LABEL_MIN_ZOOM = 0.3

interface CanvasBandsLayerProps {
  /** Current (virtual) view of the canvas (useCanvasZoom().getView). */
  getView: () => CanvasView
  /** The trigger band (workflow-trigger-lane), or null without a trigger. */
  lane: TriggerLane | null
  swimlanes: Lane[]
}

/**
 * Trigger band and swimlanes behind the steps — the same on the designer and
 * the viewers. Render as the FIRST child of the scroll container, before the
 * zoomed content.
 *
 * Bands are rows: their vertical bounds are canvas coordinates, horizontally
 * they span the whole viewport at every zoom and scroll position. The layer is
 * a zero-size sticky box pinned to the viewport's left edge (so horizontal
 * scrolling needs no script and never lags) holding viewport-wide bands whose
 * top / height follow the zoom and the content's overscroll offset through two
 * CSS variables, updated whenever the view changes (CANVAS_VIEW_EVENT).
 */
export function CanvasBandsLayer({ getView, lane, swimlanes }: CanvasBandsLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const visible = !!lane || swimlanes.length > 0

  useLayoutEffect(() => {
    const layer = layerRef.current
    // The scroll container is the sticky box's parent (read from the DOM: the
    // parent's ref is not attached yet when this layout effect first runs).
    const el = layer?.parentElement?.parentElement
    if (!el || !layer) return
    const update = () => {
      const view = getView()
      layer.style.width = `${el.clientWidth}px`
      layer.style.setProperty("--band-zoom", String(view.zoom))
      // Real minus virtual scroll = the content's overscroll translate.
      layer.style.setProperty("--band-oy", `${el.scrollTop - view.scrollTop}px`)
      layer.toggleAttribute("data-compact", view.zoom < BAND_LABEL_MIN_ZOOM)
    }
    update()
    el.addEventListener(CANVAS_VIEW_EVENT, update)
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null
    resize?.observe(el)
    return () => {
      el.removeEventListener(CANVAS_VIEW_EVENT, update)
      resize?.disconnect()
    }
  }, [getView, visible])

  if (!visible) return null
  const band = (y: number, height: number) => ({
    top: `calc(var(--band-oy, 0px) + ${y}px * var(--band-zoom, 1))`,
    height: `calc(${height}px * var(--band-zoom, 1))`,
  })
  return (
    <div aria-hidden="true" className="pointer-events-none sticky left-0 h-0 w-0" data-canvas-bands="">
      <div ref={layerRef} className="group/bands absolute left-0 top-0 h-0">
        {lane && (
          <div
            // The trigger category's green; a stronger wash on dark canvases (it reads as faint as the swimlanes there).
            className={cn(
              "absolute inset-x-0 border-b border-dashed",
              "bg-[color-mix(in_srgb,var(--theme-chart-2)_9%,transparent)] border-[color-mix(in_srgb,var(--theme-chart-2)_45%,transparent)]",
              "dark:bg-[color-mix(in_srgb,var(--theme-chart-2)_20%,transparent)] dark:border-[color-mix(in_srgb,var(--theme-chart-2)_70%,transparent)]",
            )}
            style={band(lane.top, lane.height)}
            data-trigger-zone=""
            data-lane-top={lane.top}
            data-lane-height={lane.height}
          >
            <span className="absolute top-1 left-3 text-2xs font-medium text-fg-muted group-data-[compact]/bands:hidden">
              Triggers
            </span>
          </div>
        )}
        {swimlanes.map((l) => {
          // A swimlane never draws over the trigger band.
          const top = lane ? Math.max(l.y, lane.bottom) : l.y
          const height = l.height - (top - l.y)
          if (height <= 0) return null
          const { r, g, b } = rgb(l.color)
          return (
            <div
              key={l.id}
              className="absolute inset-x-0"
              data-swimlane={l.id}
              style={{
                ...band(top, height),
                backgroundColor: `rgba(${r}, ${g}, ${b}, 0.05)`,
                borderTop: `1px dashed rgba(${r}, ${g}, ${b}, 0.3)`,
                borderBottom: `1px dashed rgba(${r}, ${g}, ${b}, 0.3)`,
              }}
            >
              <span className="absolute top-1 left-3 text-2xs font-medium group-data-[compact]/bands:hidden" style={{ color: `rgba(${r}, ${g}, ${b}, 0.85)` }}>
                {l.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface SectionFrameProps {
  section: WorkflowNode
  collapsed: boolean
  nodeCount: number
  onToggle: () => void
  /** Designer: an editable title input; viewers: the label. */
  title?: React.ReactNode
  /** Runtime tint of the count badge (a step inside failed / all completed). */
  tone?: 'danger' | 'success'
  /** Designer: wraps the header in its drag handle. */
  wrapHeader?: (header: React.ReactNode) => React.ReactNode
  /** Designer: resize handle (expanded only). */
  resizeHandle?: React.ReactNode
  interactive?: boolean
}

/** A section_group container: frame + header (toggle, title, step count). */
export function SectionFrame({ section, collapsed, nodeCount, onToggle, title, tone, wrapHeader, resizeHandle, interactive = false }: SectionFrameProps) {
  const { width, height, color } = getSectionDimensions(section)
  const { r, g, b } = rgb(color)
  const header = (
    <div
      className="flex items-center gap-2 px-3 rounded-t-[10px] select-none pointer-events-auto"
      style={{
        height: SECTION_HEADER_HEIGHT,
        cursor: interactive ? "grab" : "pointer",
        backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)`,
        borderBottom: collapsed ? 'none' : `1px solid rgba(${r}, ${g}, ${b}, 0.15)`,
      }}
      onDoubleClick={interactive ? onToggle : undefined}
      onClick={interactive ? undefined : onToggle}
    >
      <button
        type="button"
        className="w-5 h-5 flex items-center justify-center rounded-sm hover:opacity-70 shrink-0"
        style={{ color }}
        aria-expanded={!collapsed}
        aria-label={collapsed ? `Expand section ${section.label}` : `Collapse section ${section.label}`}
        onClick={(e) => { e.stopPropagation(); onToggle() }}
      >
        <ChevronRight size={14} aria-hidden="true" className={cn("transition-transform", !collapsed && "rotate-90")} />
      </button>
      {title ?? <span className="text-xs font-semibold flex-1 min-w-0 truncate" style={{ color }}>{section.label}</span>}
      <span className={cn("num text-2xs font-medium shrink-0 px-1.5 py-0.5 rounded-full",
          tone === 'danger' && "bg-danger-wash text-danger",
          tone === 'success' && "bg-success-wash text-success")}
        style={tone ? undefined : { backgroundColor: `rgba(${r}, ${g}, ${b}, 0.15)`, color }}>
        {nodeCount} node{nodeCount !== 1 ? 's' : ''}
      </span>
    </div>
  )
  return (
    <div
      className="absolute rounded-xl border-2 transition-all pointer-events-none"
      data-section-id={section.id}
      style={{
        left: section.position.x,
        top: section.position.y,
        width: collapsed ? SECTION_COLLAPSED_WIDTH : width,
        height: collapsed ? SECTION_HEADER_HEIGHT : height,
        borderColor: `rgba(${r}, ${g}, ${b}, 0.4)`,
        backgroundColor: collapsed ? `rgba(${r}, ${g}, ${b}, 0.08)` : `rgba(${r}, ${g}, ${b}, 0.03)`,
        zIndex: 0,
      }}
    >
      {wrapHeader ? wrapHeader(header) : header}
      {!collapsed && resizeHandle}
    </div>
  )
}

/** Frame colour of a section (for the designer's resize handle). */
export function sectionRgb(section: WorkflowNode) {
  return rgb(getSectionDimensions(section).color)
}
