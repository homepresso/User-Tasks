/**
 * Canvas navigation math for the workflow designer and the process viewer.
 *
 * The canvas is a scroll container (`overflow: auto`) holding a content div
 * scaled with `transform: scale(zoom)` from its top-left corner. A point in
 * canvas coordinates `c` therefore sits at `c * zoom - scroll` inside the
 * viewport (plus the container's border). Everything here is pure: the
 * components feed it DOM measurements and apply the results.
 *
 * Scroll offsets in a CanvasView are *virtual*: they may be negative (the
 * view reaches above / left of the canvas origin, e.g. when zooming out
 * around a point near the top-left or centring small content). A container
 * cannot scroll below 0, so the negative part is applied as a translate on
 * the content (see realiseView / contentTransform).
 */
import { isEditableTarget } from '@/lib/workflow-history'

export const MIN_ZOOM = 0.1
export const MAX_ZOOM = 3
/** Multiplicative step of the zoom buttons and keyboard shortcuts. */
export const ZOOM_STEP = 1.2
export const ZOOM_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2] as const
/** Fit-to-content never magnifies past 100%; zoom-to-selection may go to 200%. */
export const FIT_MAX_ZOOM = 1
export const SELECTION_MAX_ZOOM = 2
export const FIT_PADDING = 48
/**
 * Run previews never open below this zoom: fitting a large graph into a
 * dialog would make the cards unreadable, so the preview opens at this
 * zoom on the step that matters instead (see readableInitialView).
 */
export const MIN_READABLE_ZOOM = 0.7
/** Zoom-to-step magnifies to at least 100% (keeps a higher zoom). */
export const STEP_FOCUS_ZOOM = 1

export interface Point { x: number; y: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export interface Size { width: number; height: number }
/** Zoom plus the scroll offsets of the container (screen pixels). */
export interface CanvasView { zoom: number; scrollLeft: number; scrollTop: number }

export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
  if (!Number.isFinite(zoom)) return 1
  return Math.min(max, Math.max(min, zoom))
}

/** Round to 4 decimals so repeated ×1.2 steps don't accumulate float noise (1.2 * 1/1.2 = 1). */
function tidyZoom(z: number): number {
  return Math.round(z * 10000) / 10000
}

export function stepZoom(zoom: number, direction: 'in' | 'out'): number {
  const next = direction === 'in' ? zoom * ZOOM_STEP : zoom / ZOOM_STEP
  // Snap to 100% when a step crosses it, so the keyboard round-trips cleanly.
  if ((zoom < 1 && next > 1) || (zoom > 1 && next < 1)) return 1
  return clampZoom(tidyZoom(next))
}

/** Viewport point (relative to the container's padding box) → canvas coordinates. */
export function viewportToCanvas(p: Point, view: CanvasView): Point {
  return { x: (p.x + view.scrollLeft) / view.zoom, y: (p.y + view.scrollTop) / view.zoom }
}

/** Canvas coordinates → viewport point. */
export function canvasToViewport(c: Point, view: CanvasView): Point {
  return { x: c.x * view.zoom - view.scrollLeft, y: c.y * view.zoom - view.scrollTop }
}

/**
 * Client (page) coordinates → canvas coordinates. `rect` is the container's
 * bounding rect and `border` its client-left/top (border widths).
 */
export function clientToCanvas(
  client: Point,
  rect: { left: number; top: number },
  view: CanvasView,
  border: Point = { x: 0, y: 0 },
): Point {
  return viewportToCanvas({ x: client.x - rect.left - border.x, y: client.y - rect.top - border.y }, view)
}

/** A pointer delta in screen pixels → the same movement in canvas units. */
export function screenDeltaToCanvas(delta: Point, zoom: number): Point {
  const z = zoom > 0 ? zoom : 1
  return { x: delta.x / z, y: delta.y / z }
}

/**
 * Zoom to `nextZoom` keeping the canvas point under `anchor` (viewport
 * coordinates) fixed on screen. Scroll offsets are not clamped here; the
 * browser clamps them at 0 (the canvas has no negative space).
 */
export function zoomAroundPoint(view: CanvasView, nextZoom: number, anchor: Point): CanvasView {
  const zoom = clampZoom(nextZoom)
  const c = viewportToCanvas(anchor, view)
  return { zoom, scrollLeft: c.x * zoom - anchor.x, scrollTop: c.y * zoom - anchor.y }
}

/** Scroll offsets clamped to a real container's range (no virtual overscroll). */
export function clampScroll(view: CanvasView, max?: { left: number; top: number }): CanvasView {
  const left = Math.max(0, max ? Math.min(max.left, view.scrollLeft) : view.scrollLeft)
  const top = Math.max(0, max ? Math.min(max.top, view.scrollTop) : view.scrollTop)
  return { zoom: view.zoom, scrollLeft: left, scrollTop: top }
}

/**
 * The view that fits `bounds` (canvas coordinates) in a viewport of `size`,
 * centred, with `padding` screen pixels around it, never above `maxZoom`.
 */
export function fitView(bounds: Bounds, size: Size, opts: { padding?: number; maxZoom?: number; minZoom?: number } = {}): CanvasView {
  const padding = opts.padding ?? FIT_PADDING
  const w = Math.max(1, bounds.width)
  const h = Math.max(1, bounds.height)
  const availW = Math.max(1, size.width - padding * 2)
  const availH = Math.max(1, size.height - padding * 2)
  const raw = Math.min(availW / w, availH / h)
  // Floor to whole percent so the label reads cleanly and the content surely fits.
  const zoom = clampZoom(Math.floor(raw * 100) / 100, opts.minZoom ?? MIN_ZOOM, opts.maxZoom ?? FIT_MAX_ZOOM)
  const cx = bounds.x + bounds.width / 2
  const cy = bounds.y + bounds.height / 2
  return { zoom, scrollLeft: cx * zoom - size.width / 2, scrollTop: cy * zoom - size.height / 2 }
}

/**
 * Keep a view on the content: per axis, centre the content when it fits in
 * the viewport (with `padding`), otherwise clamp the scroll so the view
 * stays within the content plus padding (no wandering into empty canvas).
 */
export function clampViewToContent(view: CanvasView, content: Bounds, size: Size, padding = FIT_PADDING): CanvasView {
  const z = view.zoom
  const axis = (scroll: number, start: number, span: number, viewport: number) => {
    const lo = start * z - padding
    const hi = (start + span) * z + padding - viewport
    if (hi <= lo) return (start + span / 2) * z - viewport / 2 // fits: centre
    return Math.min(hi, Math.max(lo, scroll))
  }
  return {
    zoom: z,
    scrollLeft: axis(view.scrollLeft, content.x, content.width, size.width),
    scrollTop: axis(view.scrollTop, content.y, content.height, size.height),
  }
}

/** True when `content` fits in the viewport at `zoom` (with `padding` around it). */
export function contentFits(content: Bounds, size: Size, zoom: number, padding = FIT_PADDING): boolean {
  return content.width * zoom + padding * 2 <= size.width + 0.5 && content.height * zoom + padding * 2 <= size.height + 0.5
}

export interface ReadableViewOptions {
  /** Step to show when the graph doesn't fit (current / failed / start). */
  focus?: Bounds | null
  /** Floor of the opening zoom (default MIN_READABLE_ZOOM). */
  minZoom?: number
  /** Zoom remembered for this workflow's previews; used instead of fitting. */
  savedZoom?: number | null
  padding?: number
}

/**
 * Opening view of a run preview: fitted to the content, but never below a
 * readable zoom. When the graph doesn't fit at that zoom, the view centres
 * on the focus step (current / failed step, else the start) — kept within
 * the content — and `fits` is false (the caller shows the minimap). A
 * remembered zoom replaces the fit; the position is still derived.
 */
export function readableInitialView(content: Bounds, size: Size, opts: ReadableViewOptions = {}): { view: CanvasView; fits: boolean } {
  const padding = opts.padding ?? FIT_PADDING
  const minZoom = opts.minZoom ?? MIN_READABLE_ZOOM
  let zoom: number
  if (opts.savedZoom != null && Number.isFinite(opts.savedZoom)) {
    zoom = clampZoom(opts.savedZoom)
  } else {
    const fit = fitView(content, size, { padding })
    if (fit.zoom >= minZoom) return { view: fit, fits: true }
    zoom = clampZoom(minZoom)
  }
  if (contentFits(content, size, zoom, padding)) {
    return { view: clampViewToContent({ zoom, scrollLeft: 0, scrollTop: 0 }, content, size, padding), fits: true }
  }
  // Centre on the focus step; without one, show the top of the graph (where runs start).
  const f = opts.focus
  const target: CanvasView = f
    ? centreOn({ x: f.x + f.width / 2, y: f.y + f.height / 2 }, { zoom, scrollLeft: 0, scrollTop: 0 }, size)
    : { zoom, scrollLeft: (content.x + content.width / 2) * zoom - size.width / 2, scrollTop: content.y * zoom - padding }
  return { view: clampViewToContent(target, content, size, padding), fits: false }
}

/**
 * Zoom to one step (a click in the step list / logs): centre it, magnified
 * to at least STEP_FOCUS_ZOOM (a higher current zoom is kept).
 */
export function stepFocusView(step: Bounds, view: CanvasView, size: Size, minZoom = STEP_FOCUS_ZOOM): CanvasView {
  const zoom = clampZoom(Math.max(view.zoom, minZoom))
  return centreOn({ x: step.x + step.width / 2, y: step.y + step.height / 2 }, { ...view, zoom }, size)
}

/**
 * A virtual view → what the DOM takes: the container's scroll offsets (≥ 0)
 * and the content translate for the negative part. The overscroll is capped
 * at `maxOverscroll` (default: most of the viewport) so the drawing can't be
 * panned out of sight.
 */
export function realiseView(view: CanvasView, size?: Size): { scrollLeft: number; scrollTop: number; offsetX: number; offsetY: number } {
  const capX = size ? size.width * 0.9 : Infinity
  const capY = size ? size.height * 0.9 : Infinity
  const offsetX = view.scrollLeft < 0 ? Math.min(capX, -view.scrollLeft) : 0
  const offsetY = view.scrollTop < 0 ? Math.min(capY, -view.scrollTop) : 0
  return { scrollLeft: Math.max(0, view.scrollLeft), scrollTop: Math.max(0, view.scrollTop), offsetX, offsetY }
}

/** CSS transform of the canvas content for a zoom and overscroll offset. */
export function contentTransform(zoom: number, offsetX = 0, offsetY = 0): string {
  return offsetX || offsetY ? `translate(${round2(offsetX)}px, ${round2(offsetY)}px) scale(${zoom})` : `scale(${zoom})`
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

/** Union of boxes; null when there are none. */
export function unionBounds(boxes: Bounds[]): Bounds | null {
  if (boxes.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const b of boxes) {
    minX = Math.min(minX, b.x)
    minY = Math.min(minY, b.y)
    maxX = Math.max(maxX, b.x + b.width)
    maxY = Math.max(maxY, b.y + b.height)
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

/** The visible part of the canvas, in canvas coordinates. */
export function visibleCanvasRect(view: CanvasView, size: Size): Bounds {
  return { x: view.scrollLeft / view.zoom, y: view.scrollTop / view.zoom, width: size.width / view.zoom, height: size.height / view.zoom }
}

/** Scroll offsets that centre canvas point `c` in the viewport at the current zoom. */
export function centreOn(c: Point, view: CanvasView, size: Size): CanvasView {
  return { zoom: view.zoom, scrollLeft: c.x * view.zoom - size.width / 2, scrollTop: c.y * view.zoom - size.height / 2 }
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/**
 * Where pasted nodes go: offset 40px from the copied ones while those are in
 * view; otherwise centred in the visible area (so a paste after panning or
 * zooming elsewhere lands where the user is looking). Returns the canvas offset.
 */
export function pasteOffset(copied: Bounds, visible: Bounds, grid = 20): Point {
  if (intersects(copied, visible)) return { x: 40, y: 40 }
  const dx = visible.x + visible.width / 2 - (copied.x + copied.width / 2)
  const dy = visible.y + visible.height / 2 - (copied.y + copied.height / 2)
  return { x: Math.round(dx / grid) * grid, y: Math.round(dy / grid) * grid }
}

// ─── Wheel ───

export interface WheelLike {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  metaKey: boolean
}

/** Ctrl/⌘ + wheel and trackpad pinch (reported as wheel + ctrlKey) zoom; everything else pans. */
export function wheelAction(e: WheelLike): 'zoom' | 'pan' {
  return e.ctrlKey || e.metaKey ? 'zoom' : 'pan'
}

/** Normalise a wheel delta to pixels (line and page modes). */
export function wheelDeltaPixels(delta: number, deltaMode: number, pageSize = 800): number {
  if (deltaMode === 1) return delta * 16
  if (deltaMode === 2) return delta * pageSize
  return delta
}

/**
 * Zoom factor of one wheel event: a mouse notch (~100px) is one ×1.2 step,
 * a pinch frame (a few px) a small fraction, so pinching is smooth.
 */
export function wheelZoomFactor(e: WheelLike): number {
  const px = Math.max(-100, Math.min(100, wheelDeltaPixels(e.deltaY, e.deltaMode)))
  return Math.pow(ZOOM_STEP, -px / 100)
}

// ─── Keyboard ───

export type ZoomShortcut = 'in' | 'out' | 'reset' | 'fit' | 'selection' | 'step'

export interface KeyLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/**
 * Map a keydown to a zoom command, or null. Ctrl/⌘ + = / + (in), Ctrl/⌘ + −
 * (out), Ctrl/⌘ + 0 (100%), Shift + 1 (fit), Shift + 2 (selection), Shift + 3
 * (run previews: the current / failed step). Ignored
 * while typing in inputs, editors or contenteditable regions.
 */
export function zoomShortcut(e: KeyLike): ZoomShortcut | null {
  if (e.altKey) return null
  if (isEditableTarget(e.target)) return null
  const mod = e.ctrlKey || e.metaKey
  if (mod) {
    if (e.key === '=' || e.key === '+' || e.code === 'Equal' || e.code === 'NumpadAdd') return 'in'
    if (e.key === '-' || e.key === '_' || e.code === 'Minus' || e.code === 'NumpadSubtract') return 'out'
    if ((e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0') && !e.shiftKey) return 'reset'
    return null
  }
  if (e.shiftKey) {
    // Shift+1 types "!" on US layouts; the code is layout independent.
    if (e.code === 'Digit1' || e.key === '!') return 'fit'
    if (e.code === 'Digit2' || e.key === '@') return 'selection'
    if (e.code === 'Digit3' || e.key === '#') return 'step'
  }
  return null
}

export function zoomShortcutHints(isMac: boolean): Record<ZoomShortcut, string> {
  const mod = isMac ? '⌘' : 'Ctrl+'
  return { in: `${mod}=`, out: `${mod}−`, reset: `${mod}0`, fit: isMac ? '⇧1' : 'Shift+1', selection: isMac ? '⇧2' : 'Shift+2', step: isMac ? '⇧3' : 'Shift+3' }
}

export function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

// ─── Two-finger touch ───

export interface TouchPoint { clientX: number; clientY: number }

export function touchCentre(a: TouchPoint, b: TouchPoint): Point {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

export function touchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

/**
 * One step of a two-finger gesture: zoom by the pinch ratio around the
 * fingers' midpoint, then pan by how far the midpoint moved.
 */
export function pinchStep(view: CanvasView, prev: { centre: Point; distance: number }, next: { centre: Point; distance: number }): CanvasView {
  const ratio = prev.distance > 0 ? next.distance / prev.distance : 1
  const zoomed = zoomAroundPoint(view, view.zoom * ratio, next.centre)
  return {
    zoom: zoomed.zoom,
    scrollLeft: zoomed.scrollLeft - (next.centre.x - prev.centre.x),
    scrollTop: zoomed.scrollTop - (next.centre.y - prev.centre.y),
  }
}

// ─── Minimap ───

export interface MinimapLayout {
  /** Canvas → minimap: m = (c - origin) * scale + inset. */
  scale: number
  origin: Point
  inset: number
}

/** Fit `content ∪ viewport` (canvas coordinates) into a minimap of `size`. */
export function minimapLayout(content: Bounds, viewport: Bounds | null, size: Size, inset = 4): MinimapLayout {
  const all = unionBounds(viewport ? [content, viewport] : [content])!
  const scale = Math.min((size.width - inset * 2) / Math.max(1, all.width), (size.height - inset * 2) / Math.max(1, all.height))
  return { scale, origin: { x: all.x, y: all.y }, inset }
}

export function canvasToMinimap(c: Point, layout: MinimapLayout): Point {
  return { x: (c.x - layout.origin.x) * layout.scale + layout.inset, y: (c.y - layout.origin.y) * layout.scale + layout.inset }
}

export function minimapToCanvas(m: Point, layout: MinimapLayout): Point {
  return { x: (m.x - layout.inset) / layout.scale + layout.origin.x, y: (m.y - layout.inset) / layout.scale + layout.origin.y }
}

// ─── Session persistence ───

export function viewStorageKey(scope: string): string {
  return `usertasks:canvas-view:${scope}`
}

export function serializeView(view: CanvasView): string {
  return JSON.stringify({ z: Math.round(view.zoom * 10000) / 10000, l: Math.round(view.scrollLeft), t: Math.round(view.scrollTop) })
}

export function parseView(raw: string | null | undefined): CanvasView | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as { z?: unknown; l?: unknown; t?: unknown }
    if (typeof v.z !== 'number' || typeof v.l !== 'number' || typeof v.t !== 'number') return null
    if (![v.z, v.l, v.t].every(Number.isFinite)) return null
    return { zoom: clampZoom(v.z), scrollLeft: v.l, scrollTop: v.t }
  } catch {
    return null
  }
}
