'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * A resizable, maximizable designer dialog (the form designer). The dialog
 * stays centred (its enter animation translates by -50 %), so dragging an
 * edge grows or shrinks it symmetrically: the right edge moved 10 px makes
 * it 20 px wider. Sizes are clamped between DESIGNER_MIN and the viewport.
 * Maximize goes edge to edge; double-clicking the header toggles it. Below
 * MOBILE_BREAKPOINT the dialog is always full screen. The size, the
 * maximized flag and the collapsed side panels are remembered in this
 * browser (localStorage, never fatal when storage is blocked).
 */

export const DESIGNER_SIZE_STORAGE_KEY = 'usertasks.form-designer.layout.v1'
export const DESIGNER_MIN = { width: 720, height: 480 } as const
export const DESIGNER_DEFAULT = { width: 1320, height: 900 } as const
export const MOBILE_BREAKPOINT = 768
/** Margin kept around a non-maximized dialog. */
const VIEWPORT_MARGIN = 8

export type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const RESIZE_EDGES: ResizeEdge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']

export interface DesignerSize { width: number; height: number }
export interface DesignerLayoutPrefs {
  width?: number
  height?: number
  maximized?: boolean
  paletteCollapsed?: boolean
  propertiesCollapsed?: boolean
}

/** A size within [min, viewport - margin] (the minimum wins on a tiny viewport). */
export function clampDesignerSize(size: DesignerSize, viewport: DesignerSize): DesignerSize {
  const maxW = Math.max(DESIGNER_MIN.width, viewport.width - VIEWPORT_MARGIN * 2)
  const maxH = Math.max(DESIGNER_MIN.height, viewport.height - VIEWPORT_MARGIN * 2)
  const w = Number.isFinite(size.width) ? size.width : DESIGNER_DEFAULT.width
  const h = Number.isFinite(size.height) ? size.height : DESIGNER_DEFAULT.height
  return {
    width: Math.round(Math.min(maxW, Math.max(DESIGNER_MIN.width, w))),
    height: Math.round(Math.min(maxH, Math.max(DESIGNER_MIN.height, h))),
  }
}

/** The opening size: the remembered one, else min(1320, 97vw) × min(900, 92vh) — as before. */
export function initialDesignerSize(prefs: DesignerLayoutPrefs, viewport: DesignerSize): DesignerSize {
  if (typeof prefs.width === 'number' && typeof prefs.height === 'number') return clampDesignerSize({ width: prefs.width, height: prefs.height }, viewport)
  return clampDesignerSize({ width: Math.min(DESIGNER_DEFAULT.width, viewport.width * 0.97), height: Math.min(DESIGNER_DEFAULT.height, viewport.height * 0.92) }, viewport)
}

/** The size after dragging `edge` by (dx, dy) from `start` (centred: each side moves by the delta). */
export function resizeBy(start: DesignerSize, edge: ResizeEdge, dx: number, dy: number, viewport: DesignerSize): DesignerSize {
  let { width, height } = start
  if (edge.includes('e')) width += dx * 2
  if (edge.includes('w')) width -= dx * 2
  if (edge.includes('s')) height += dy * 2
  if (edge.includes('n')) height -= dy * 2
  return clampDesignerSize({ width, height }, viewport)
}

/** Stored prefs, or {} (bad JSON, blocked storage, server). */
export function readDesignerPrefs(storage: Pick<Storage, 'getItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null): DesignerLayoutPrefs {
  try {
    const raw = storage?.getItem(DESIGNER_SIZE_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const p = parsed as Record<string, unknown>
    const out: DesignerLayoutPrefs = {}
    if (typeof p.width === 'number' && Number.isFinite(p.width)) out.width = p.width
    if (typeof p.height === 'number' && Number.isFinite(p.height)) out.height = p.height
    if (p.maximized === true) out.maximized = true
    if (p.paletteCollapsed === true) out.paletteCollapsed = true
    if (p.propertiesCollapsed === true) out.propertiesCollapsed = true
    return out
  } catch {
    return {}
  }
}

/** Remember prefs; false when storage refused them. */
export function writeDesignerPrefs(prefs: DesignerLayoutPrefs, storage: Pick<Storage, 'setItem'> | null | undefined = typeof window !== 'undefined' ? window.localStorage : null): boolean {
  try {
    if (!storage) return false
    storage.setItem(DESIGNER_SIZE_STORAGE_KEY, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

function viewportSize(): DesignerSize {
  return typeof window === 'undefined' ? { width: 1440, height: 900 } : { width: window.innerWidth, height: window.innerHeight }
}

const EDGE_STYLE: Record<ResizeEdge, React.CSSProperties> = {
  n: { top: -3, left: 12, right: 12, height: 8, cursor: 'ns-resize' },
  s: { bottom: -3, left: 12, right: 12, height: 8, cursor: 'ns-resize' },
  e: { right: -3, top: 12, bottom: 12, width: 8, cursor: 'ew-resize' },
  w: { left: -3, top: 12, bottom: 12, width: 8, cursor: 'ew-resize' },
  ne: { top: -3, right: -3, width: 14, height: 14, cursor: 'nesw-resize' },
  sw: { bottom: -3, left: -3, width: 14, height: 14, cursor: 'nesw-resize' },
  nw: { top: -3, left: -3, width: 14, height: 14, cursor: 'nwse-resize' },
  se: { bottom: -3, right: -3, width: 14, height: 14, cursor: 'nwse-resize' },
}

export function useResizableDialog() {
  const [prefs, setPrefs] = useState<DesignerLayoutPrefs>(() => readDesignerPrefs())
  const [viewport, setViewport] = useState<DesignerSize>(viewportSize)
  const [size, setSize] = useState<DesignerSize>(() => initialDesignerSize(prefs, viewportSize()))
  const [resizing, setResizing] = useState(false)
  const drag = useRef<{ edge: ResizeEdge; x: number; y: number; start: DesignerSize } | null>(null)

  useEffect(() => {
    const onResize = () => {
      const vp = viewportSize()
      setViewport(vp)
      setSize((s) => clampDesignerSize(s, vp))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const update = useCallback((patch: DesignerLayoutPrefs) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      writeDesignerPrefs(next)
      return next
    })
  }, [])

  const mobile = viewport.width < MOBILE_BREAKPOINT
  const maximized = Boolean(prefs.maximized)
  const fullScreen = mobile || maximized

  const toggleMaximized = useCallback(() => update({ maximized: !prefs.maximized }), [prefs.maximized, update])

  const onPointerDown = useCallback((edge: ResizeEdge) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    drag.current = { edge, x: e.clientX, y: e.clientY, start: size }
    setResizing(true)
  }, [size])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    setSize(resizeBy(d.start, d.edge, e.clientX - d.x, e.clientY - d.y, viewportSize()))
  }, [])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    drag.current = null
    setResizing(false)
    setSize((s) => { update({ width: s.width, height: s.height }); return s })
  }, [update])

  /** Style for Dialog.Content (it keeps left/top 50 % and the -50 % translate unless full screen; Tailwind v4's translate-* set the `translate` property, so both it and transform are cleared). */
  const contentStyle: React.CSSProperties = fullScreen
    ? { left: 0, top: 0, width: '100vw', height: '100dvh', transform: 'none', translate: 'none', borderRadius: 0, animation: 'none' }
    : { width: size.width, height: size.height }

  /** Pointer-only resize handles (aria-hidden, not focusable: keyboard users use Maximize). */
  const handles = fullScreen ? [] : RESIZE_EDGES.map((edge) => ({
    key: edge,
    'aria-hidden': true as const,
    'data-designer-resize': edge,
    style: { position: 'absolute' as const, zIndex: 20, touchAction: 'none' as const, ...EDGE_STYLE[edge] },
    onPointerDown: onPointerDown(edge),
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  }))

  return {
    size, maximized, mobile, fullScreen, resizing, contentStyle, handles, toggleMaximized,
    paletteCollapsed: Boolean(prefs.paletteCollapsed),
    propertiesCollapsed: Boolean(prefs.propertiesCollapsed),
    togglePalette: () => update({ paletteCollapsed: !prefs.paletteCollapsed }),
    toggleProperties: () => update({ propertiesCollapsed: !prefs.propertiesCollapsed }),
  }
}
