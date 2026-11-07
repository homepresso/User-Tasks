"use client"

import { useEffect, useId, useRef, useState } from "react"
import { ChevronDown, Crosshair, Maximize, Minus, Plus } from "lucide-react"
import { formatZoom, MAX_ZOOM, MIN_ZOOM, ZOOM_PRESETS, zoomShortcutHints } from "@/lib/canvas-zoom"
import { cn } from "@/lib/utils"
import { Kbd } from "@/components/ui/kbd"
import { IconButton } from "@/components/ui/icon-button"
import { Tooltip } from "@/components/ui/tooltip"
import { floatingSurfaceClass } from "@/components/ui/dropdown-menu"

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
  /**
   * Horizontal bar (default) or a vertical column (designer, bottom-left):
   * +, zoom %, −, then Fit / step / children. A vertical bar's menu opens to its right.
   */
  orientation?: "horizontal" | "vertical"
  /** Extra buttons after Fit (e.g. full screen). */
  children?: React.ReactNode
  className?: string
}

/** Canvas zoom bar: −, zoom % menu (presets, fit, selection), +, Fit (or a vertical column). */
export function CanvasZoomControls({ zoom, isMac, onZoomIn, onZoomOut, onZoomTo, onFit, onFitSelection, hasSelection = false, onFocusStep, focusStepLabel = "Zoom to step", placement = "bottom", orientation = "horizontal", children, className }: CanvasZoomControlsProps) {
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

  const vertical = orientation === "vertical"
  const btn = "flex items-center justify-center h-7 min-w-7 px-1.5 text-fg transition-colors hover:bg-subtle disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
  const item = "w-full flex h-8 items-center justify-between gap-4 rounded-md px-2 text-left text-ui text-fg transition-colors hover:bg-subtle focus:bg-subtle outline-none disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-transparent"
  const surface = "rounded-lg border border-border bg-elevated shadow-elev-2"

  // Tooltips open away from the canvas edge the bar sits on.
  const tipSide = vertical ? "right" : placement === "top" ? "bottom" : "top"
  const iconBtn = cn("text-fg rounded-none", vertical && "w-full")
  const zoomOut = (
    <IconButton type="button" size="sm" className={iconBtn} tooltipSide={tipSide} onClick={onZoomOut} disabled={zoom <= MIN_ZOOM + 1e-6}
      label={`Zoom out (${hints.out})`} icon={<Minus />} />
  )
  const zoomIn = (
    <IconButton type="button" size="sm" className={iconBtn} tooltipSide={tipSide} onClick={onZoomIn} disabled={zoom >= MAX_ZOOM - 1e-6}
      label={`Zoom in (${hints.in})`} icon={<Plus />} />
  )
  const level = (
    <Tooltip content="Zoom level" side={tipSide}>
    <button
      ref={triggerRef}
      type="button"
      className={cn(btn, "num text-2xs font-medium", vertical ? "w-full h-7 px-0 border-y border-border-subtle" : "gap-0.5 min-w-[58px] border-x border-border-subtle")}
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuId : undefined}
      aria-label={`Zoom level ${formatZoom(zoom)}, choose zoom`}
      onClick={() => setOpen((o) => !o)}
      onKeyDown={(e) => { if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true) } }}
    >
      {formatZoom(zoom)}
      {!vertical && <ChevronDown size={12} aria-hidden="true" className="text-fg-muted" />}
    </button>
    </Tooltip>
  )
  // Standalone (horizontal) buttons sit on their own elevated tile.
  const tileBtn = vertical ? iconBtn : cn("text-fg", surface, "hover:bg-subtle")
  const fit = (
    <IconButton type="button" size="sm" className={tileBtn} tooltipSide={tipSide}
      onClick={onFit} label={`Zoom to fit (${hints.fit})`} icon={<Maximize />} />
  )
  const focus = onFocusStep && (
    <IconButton type="button" size="sm" className={tileBtn} tooltipSide={tipSide}
      onClick={onFocusStep} label={`${focusStepLabel} (${hints.step})`} icon={<Crosshair />} />
  )

  const menuPosition = vertical
    ? (placement === "top" ? "left-full top-0 ml-1.5" : "left-full bottom-0 ml-1.5")
    : (placement === "top" ? "right-0 top-full mt-1.5" : "right-0 bottom-full mb-1.5")

  return (
    <div
      ref={wrapRef}
      className={className ?? "absolute bottom-3 right-3 z-20"}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      data-canvas-zoom-controls=""
      data-orientation={orientation}
    >
      {vertical ? (
        <div role="toolbar" aria-label="Canvas zoom" aria-orientation="vertical"
          className={cn(surface, "relative flex w-8 flex-col items-stretch overflow-hidden")}>
          {zoomIn}
          {level}
          {zoomOut}
          <div role="separator" className="h-px bg-border-subtle" />
          {fit}
          {focus}
          {children}
        </div>
      ) : (
        <div role="toolbar" aria-label="Canvas zoom" className="flex items-center gap-1">
          <div className={cn(surface, "flex items-center overflow-hidden")}>
            {zoomOut}
            {level}
            {zoomIn}
          </div>
          {fit}
          {focus}
          {children}
        </div>
      )}

      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Zoom"
          className={cn("absolute min-w-[200px] p-1 z-30", floatingSurfaceClass, menuPosition)}
          onKeyDown={onMenuKey}
        >
          {ZOOM_PRESETS.map((z) => (
            <button key={z} type="button" role="menuitem" className={item} onClick={() => choose(() => onZoomTo(z))}>
              <span className="num">{formatZoom(z)}</span>
              {z === 1 && <Kbd>{hints.reset}</Kbd>}
            </button>
          ))}
          <div role="separator" className="-mx-1 my-1 h-px bg-border-subtle" />
          <button type="button" role="menuitem" className={item} onClick={() => choose(onFit)}>
            <span>Zoom to fit</span>
            <Kbd>{hints.fit}</Kbd>
          </button>
          {onFitSelection && (
            <button type="button" role="menuitem" className={item} disabled={!hasSelection} onClick={() => choose(onFitSelection)}
              title={hasSelection ? undefined : "Select steps or a connection first"}>
              <span>Zoom to selection</span>
              <Kbd>{hints.selection}</Kbd>
            </button>
          )}
          {onFocusStep && (
            <button type="button" role="menuitem" className={item} onClick={() => choose(onFocusStep)}>
              <span>{focusStepLabel}</span>
              <Kbd>{hints.step}</Kbd>
            </button>
          )}
        </div>
      )}

      {/* Announce the zoom level to screen readers (polite: after a gesture settles). */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">Zoom {formatZoom(zoom)}</span>
    </div>
  )
}
