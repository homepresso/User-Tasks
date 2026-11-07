'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * FloatingLayer — the shared primitive for dropdowns, listboxes and pickers
 * anchored to a control (autocomplete / lookup suggestions, the select
 * replacement, the date-time picker). It renders the panel in a portal so
 * nothing clips or covers it: not the inputs below, grid rows, tab / step
 * panels, sticky headers, the Data table field's scroll frame, custom-control
 * iframes or a modal's `overflow: hidden`.
 *
 *  - Where: document.body; inside a modal dialog (role=dialog / alertdialog)
 *    the dialog's own element instead, so its focus trap and "click outside"
 *    handling treat the panel as part of the dialog (React events also bubble
 *    through the portal to the anchor's tree).
 *  - Position: `position: fixed`, placed below the anchor and flipped above
 *    it when there is more room there; the height is capped to the room left
 *    (the list scrolls inside), the width matches the anchor (at least
 *    `minWidth`, at most the visible area) and the panel is kept on screen.
 *    Re-measured on scroll (any scroller), resize and size changes.
 *  - Theme: the CSS custom properties scoped on the anchor's ancestors (a
 *    form's mini theme, the designer's light / dark preview) are copied onto
 *    the panel, with the anchor's color-scheme and font, so the panel looks
 *    like the control it belongs to.
 *  - Dismiss: a pointer down outside the anchor and the panel calls
 *    `onDismiss`; so does Escape when `closeOnEscape` (controls that keep
 *    focus in their own input handle Escape themselves).
 *
 * Accessibility stays with the caller: the combobox / listbox roles, ids and
 * aria-activedescendant are the caller's; focus is not moved by the layer.
 */

export interface FloatingLayerProps {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onDismiss?: () => void
  children: React.ReactNode
  /** Preferred maximum height (px); the panel shrinks to the room available. */
  maxHeight?: number
  /** Minimum width (px); default: the anchor's width. */
  minWidth?: number
  /** Fixed width (px) instead of the anchor's. */
  width?: number
  /** Gap between the anchor and the panel (px). */
  gap?: number
  closeOnEscape?: boolean
  className?: string
  style?: React.CSSProperties
  /** Forwarded to the panel element. */
  panelRef?: React.Ref<HTMLDivElement>
  id?: string
  role?: string
  'aria-label'?: string
  'data-testid'?: string
}

const MARGIN = 8
const Z_INDEX = 1000

export type FloatingPlacement = 'bottom' | 'top'

export interface FloatingBox {
  top: number
  left: number
  width: number
  maxHeight: number
  placement: FloatingPlacement
}

/**
 * Where the panel goes (pure, for tests): below the anchor unless the panel
 * does not fit there and there is more room above; height capped to the room
 * on the chosen side; width clamped to the boundary; left kept inside it.
 */
export function computeFloatingBox(
  anchor: { top: number; bottom: number; left: number; width: number },
  boundary: { top: number; bottom: number; left: number; right: number },
  panel: { height: number },
  opts: { maxHeight: number; minWidth?: number; width?: number; gap: number },
): FloatingBox {
  const below = boundary.bottom - anchor.bottom - opts.gap - MARGIN
  const above = anchor.top - boundary.top - opts.gap - MARGIN
  const wanted = Math.min(opts.maxHeight, panel.height || opts.maxHeight)
  const placement: FloatingPlacement = below >= wanted || below >= above ? 'bottom' : 'top'
  const room = Math.max(80, placement === 'bottom' ? below : above)
  const maxHeight = Math.min(opts.maxHeight, room)
  const avail = Math.max(120, boundary.right - boundary.left - MARGIN * 2)
  const width = Math.min(avail, opts.width ?? Math.max(anchor.width, opts.minWidth ?? 0))
  const left = Math.min(Math.max(boundary.left + MARGIN, anchor.left), boundary.right - MARGIN - width)
  const height = Math.min(maxHeight, panel.height || maxHeight)
  const top = placement === 'bottom' ? anchor.bottom + opts.gap : anchor.top - opts.gap - height
  return { top, left, width, maxHeight, placement }
}

/** The modal the anchor sits in (its element hosts the panel), or null. */
function hostDialog(anchor: HTMLElement): HTMLElement | null {
  return anchor.closest<HTMLElement>('[role="dialog"][aria-modal="true"], [role="dialog"][data-state="open"], [role="alertdialog"][aria-modal="true"]')
}

/** The element `position: fixed` is relative to (an ancestor with a transform / filter / containment), or null for the viewport. */
function fixedContainingBlock(from: HTMLElement | null): HTMLElement | null {
  for (let el = from; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el)
    // Tailwind v4 translates with the individual `translate` / `scale` / `rotate` properties: they make a containing block too.
    const individual = (['translate', 'scale', 'rotate'] as const).some((p) => { const v = cs.getPropertyValue(p); return Boolean(v) && v !== 'none' })
    if (individual || (cs.transform && cs.transform !== 'none') || (cs.filter && cs.filter !== 'none') || (cs.perspective && cs.perspective !== 'none')
      || /paint|layout|strict|content/.test(cs.contain || '') || /transform|filter|perspective/.test(cs.willChange || '')) return el
  }
  return null
}

/** Custom properties scoped on the anchor's ancestors (nearest wins) plus its color-scheme and font. */
export function inheritedThemeStyle(anchor: HTMLElement): React.CSSProperties {
  const out: Record<string, string> = {}
  for (let el: HTMLElement | null = anchor; el && el !== document.body; el = el.parentElement) {
    const style = el.style
    for (let i = 0; i < style.length; i++) {
      const name = style[i]
      if (name.startsWith('--') && !(name in out)) out[name] = style.getPropertyValue(name)
    }
  }
  const cs = getComputedStyle(anchor)
  if (cs.colorScheme && cs.colorScheme !== 'normal') out.colorScheme = cs.colorScheme
  if (cs.fontFamily) out.fontFamily = cs.fontFamily
  return out as React.CSSProperties
}

export function FloatingLayer({
  anchorRef, open, onDismiss, children, maxHeight = 288, minWidth, width, gap = 4, closeOnEscape = false,
  className, style, panelRef, id, role, ...rest
}: FloatingLayerProps) {
  const ownRef = useRef<HTMLDivElement | null>(null)
  const [box, setBox] = useState<FloatingBox | null>(null)
  const [host, setHost] = useState<{ container: HTMLElement; offset: HTMLElement | null; theme: React.CSSProperties } | null>(null)
  const dismissRef = useRef(onDismiss)
  useLayoutEffect(() => { dismissRef.current = onDismiss })

  const setPanel = useCallback((el: HTMLDivElement | null) => {
    ownRef.current = el
    if (typeof panelRef === 'function') panelRef(el)
    else if (panelRef) (panelRef as React.MutableRefObject<HTMLDivElement | null>).current = el
  }, [panelRef])

  // Where the panel lives (and the theme it inherits) — per opening.
  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!open || !anchor) { setHost(null); return }
    const dialog = hostDialog(anchor)
    const container = dialog ?? document.body
    setHost({ container, offset: fixedContainingBlock(container === document.body ? null : container), theme: inheritedThemeStyle(anchor) })
  }, [open, anchorRef])

  useLayoutEffect(() => {
    if (!open || !host) { setBox(null); return }
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const anchor = anchorRef.current
        if (!anchor) return
        const a = anchor.getBoundingClientRect()
        let boundary = { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
        if (host.container !== document.body) {
          const c = host.container.getBoundingClientRect()
          boundary = { top: Math.max(0, c.top), left: Math.max(0, c.left), right: Math.min(window.innerWidth, c.right), bottom: Math.min(window.innerHeight, c.bottom) }
        }
        const next = computeFloatingBox(a, boundary, { height: ownRef.current?.scrollHeight ?? 0 }, { maxHeight, minWidth, width, gap })
        if (host.offset) {
          const o = host.offset.getBoundingClientRect()
          next.top -= o.top
          next.left -= o.left
        }
        setBox((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.maxHeight === next.maxHeight && prev.placement === next.placement ? prev : next))
      })
    }
    measure()
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    if (anchorRef.current) ro?.observe(anchorRef.current)
    if (ownRef.current) ro?.observe(ownRef.current)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', measure, true)
      window.removeEventListener('resize', measure)
      ro?.disconnect()
    }
  }, [open, host, anchorRef, maxHeight, minWidth, width, gap])

  useLayoutEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (anchorRef.current?.contains(target) || ownRef.current?.contains(target)) return
      dismissRef.current?.()
    }
    // Escape closes the panel, not the dialog around it: marked handled on the window (capture) — before a
    // modal's own document-level Escape handling, which skips handled events — and left to the control
    // (which keeps focus in its input) unless `closeOnEscape`.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (closeOnEscape) dismissRef.current?.()
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchorRef, closeOnEscape])

  if (!open || !host) return null
  return createPortal(
    <div
      ref={setPanel}
      id={id}
      role={role}
      aria-label={rest['aria-label']}
      data-testid={rest['data-testid']}
      data-floating-layer
      data-placement={box?.placement ?? 'bottom'}
      className={className}
      style={{
        ...host.theme,
        position: 'fixed',
        zIndex: Z_INDEX,
        pointerEvents: 'auto',
        top: box?.top ?? -9999,
        left: box?.left ?? -9999,
        width: box?.width,
        maxHeight: box?.maxHeight ?? maxHeight,
        visibility: box ? 'visible' : 'hidden',
        ...style,
      }}
    >
      {children}
    </div>,
    host.container,
  )
}
