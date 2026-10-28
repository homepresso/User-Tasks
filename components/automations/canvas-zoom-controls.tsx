"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Crosshair, Maximize, Minus, Plus } from "lucide-react"
import { formatZoom, MAX_ZOOM, MIN_ZOOM, ZOOM_PRESETS, zoomShortcutHints } from "@/lib/canvas-zoom"

interface CanvasZoomControlsProps {
  zoom: number
  isMac: boolean
  onZoomIn: () => void
  onZoomOut: () => void
  onZoomTo: (zoom: number) => void
  onFit: () => void
  /** Omit (viewer without selection) to hide "Zoom to selection". */
  onFitSelection?: () => void
  hasSelection?: boolean
  /** Run previews: jump to the current / failed step (or the start). */
  onFocusStep?: () => void
  /** Label of that command, e.g. "Zoom to failed step". */
  focusStepLabel?: string
  /** Where the bar sits: the menu opens away from the edge (default bottom). */
  placement?: "top" | "bottom"
  /** Extra buttons after Fit (e.g. full screen). */
  children?: React.ReactNode
  className?: string
}

/** Bottom-right canvas zoom bar: −, zoom % menu (presets, fit, selection), +, Fit. */
export function CanvasZoomControls({ zoom, isMac, onZoomIn, onZoomOut, onZoomTo, onFit, onFitSelection, hasSelection = false, onFocusStep, focusStepLabel = "Zoom to step", placement = "bottom", children, className }: CanvasZoomControlsProps) {
  const hints = zoomShortcutHints(isMac)
  const [open, setOpen] = useState(false)
  const menuId = useId()
  const wrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus()
    function onDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("pointerdown", onDown)
    return () => window.removeEventListener("pointerdown", onDown)
  }, [open])

  function choose(fn: () => void) {
    setOpen(false)
    triggerRef.current?.focus()
    fn()
  }

  function onMenuKey(e: React.KeyboardEvent) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus() }
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus() }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus() }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus() }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus() }
    else if (e.key === "Tab") setOpen(false)
  }

  const btn = "flex items-center justify-center h-7 min-w-7 px-1.5 transition-colors hover:bg-[var(--theme-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-40 disabled:cursor-not-allowed"
  const ring = { "--tw-ring-color": "var(--theme-focus-ring)" } as React.CSSProperties
  const item = "w-full flex items-center justify-between gap-4 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-surface)] focus:bg-[var(--theme-surface)] focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"

  return (
    <div
      ref={wrapRef}
      className={className ?? "absolute bottom-3 right-3 z-20"}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-canvas-zoom-controls=""
    >
      <div role="toolbar" aria-label="Canvas zoom" className="flex items-center gap-1">
        <div className="flex items-center rounded-lg border shadow-sm overflow-hidden"
          style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}>
          <button type="button" className={btn} style={ring} onClick={onZoomOut} disabled={zoom <= MIN_ZOOM + 1e-6}
            aria-label={`Zoom out (${hints.out})`} title={`Zoom out (${hints.out})`}>
            <Minus size={14} aria-hidden="true" />
          </button>
          <button
            ref={triggerRef}
            type="button"
            className={`${btn} gap-0.5 text-[11px] font-medium tabular-nums min-w-[58px]`}
            style={{ ...ring, borderLeft: "1px solid var(--theme-surface-border)", borderRight: "1px solid var(--theme-surface-border)" }}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-label={`Zoom level ${formatZoom(zoom)}, choose zoom`}
            title="Zoom level"
            onClick={() => setOpen((o) => !o)}
            onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true) } }}
          >
            {formatZoom(zoom)}
            <ChevronDown size={11} aria-hidden="true" style={{ color: "var(--theme-muted-text)" }} />
          </button>
          <button type="button" className={btn} style={ring} onClick={onZoomIn} disabled={zoom >= MAX_ZOOM - 1e-6}
            aria-label={`Zoom in (${hints.in})`} title={`Zoom in (${hints.in})`}>
            <Plus size={14} aria-hidden="true" />
          </button>
        </div>
        <button type="button"
          className={`${btn} rounded-lg border shadow-sm`}
          style={{ ...ring, backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
          onClick={onFit} aria-label={`Zoom to fit (${hints.fit})`} title={`Zoom to fit (${hints.fit})`}>
          <Maximize size={14} aria-hidden="true" />
        </button>
        {onFocusStep && (
          <button type="button"
            className={`${btn} rounded-lg border shadow-sm`}
            style={{ ...ring, backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
            onClick={onFocusStep} aria-label={`${focusStepLabel} (${hints.step})`} title={`${focusStepLabel} (${hints.step})`}>
            <Crosshair size={14} aria-hidden="true" />
          </button>
        )}
        {children}
      </div>

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Zoom"
          className={`absolute right-0 min-w-[200px] rounded-lg border shadow-lg py-1 z-30 ${placement === "top" ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}
          style={{ backgroundColor: "var(--theme-card-bg)", borderColor: "var(--theme-surface-border)", color: "var(--theme-card-text)" }}
          onKeyDown={onMenuKey}
        >
          {ZOOM_PRESETS.map((z) => (
            <button key={z} type="button" role="menuitem" className={item} onClick={() => choose(() => onZoomTo(z))}>
              <span>{formatZoom(z)}</span>
              {z === 1 && <kbd className="text-[10px] font-sans" style={{ color: "var(--theme-muted-text)" }}>{hints.reset}</kbd>}
            </button>
          ))}
          <div role="separator" className="my-1 h-px" style={{ backgroundColor: "var(--theme-surface-border)" }} />
          <button type="button" role="menuitem" className={item} onClick={() => choose(onFit)}>
            <span>Zoom to fit</span>
            <kbd className="text-[10px] font-sans" style={{ color: "var(--theme-muted-text)" }}>{hints.fit}</kbd>
          </button>
          {onFitSelection && (
            <button type="button" role="menuitem" className={item} disabled={!hasSelection} onClick={() => choose(onFitSelection)}
              title={hasSelection ? undefined : "Select steps or a connection first"}>
              <span>Zoom to selection</span>
              <kbd className="text-[10px] font-sans" style={{ color: "var(--theme-muted-text)" }}>{hints.selection}</kbd>
            </button>
          )}
          {onFocusStep && (
            <button type="button" role="menuitem" className={item} onClick={() => choose(onFocusStep)}>
              <span>{focusStepLabel}</span>
              <kbd className="text-[10px] font-sans" style={{ color: "var(--theme-muted-text)" }}>{hints.step}</kbd>
            </button>
          )}
        </div>
      )}

      {/* Announce the zoom level to screen readers (polite: after a gesture settles). */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">Zoom {formatZoom(zoom)}</span>
    </div>
  )
}
