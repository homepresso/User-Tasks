import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  canvasToMinimap, canvasToViewport, centreOn, contentTransform, realiseView, clampZoom, clientToCanvas, fitView, formatZoom, MAX_ZOOM, MIN_ZOOM,
  minimapLayout, minimapToCanvas, parseView, pasteOffset, pinchStep, screenDeltaToCanvas, serializeView, stepZoom,
  unionBounds, viewportToCanvas, visibleCanvasRect, wheelAction, wheelZoomFactor, zoomAroundPoint, zoomShortcut,
  zoomShortcutHints, type CanvasView,
} from '@/lib/canvas-zoom'
import { scaledDragTransform } from '@/components/automations/use-canvas-zoom'

const view = (zoom: number, scrollLeft = 0, scrollTop = 0): CanvasView => ({ zoom, scrollLeft, scrollTop })
const key = (k: Partial<Parameters<typeof zoomShortcut>[0]>) =>
  zoomShortcut({ key: '', code: '', ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: null, ...k })
const el = (tagName: string, extra: Record<string, unknown> = {}) =>
  ({ tagName, isContentEditable: false, closest: () => null, ...extra }) as unknown as EventTarget

describe('zoom around a point', () => {
  it.each([
    [1, 2, { x: 300, y: 200 }, view(1, 0, 0)],
    [1, 0.5, { x: 120, y: 80 }, view(1, 400, 600)],
    [0.75, 2.4, { x: 10, y: 590 }, view(0.75, 1234, 77)],
    [2, 0.1, { x: 640, y: 360 }, view(2, 5000, 3000)],
  ])('keeps the canvas point under the anchor fixed (%s → %s)', (_from, to, anchor, start) => {
    const before = viewportToCanvas(anchor, start)
    const next = zoomAroundPoint(start, to, anchor)
    expect(next.zoom).toBeCloseTo(to)
    const after = canvasToViewport(before, next)
    expect(after.x).toBeCloseTo(anchor.x, 6)
    expect(after.y).toBeCloseTo(anchor.y, 6)
  })

  it('clamps to 10%–300%', () => {
    expect(zoomAroundPoint(view(1), 50, { x: 0, y: 0 }).zoom).toBe(MAX_ZOOM)
    expect(zoomAroundPoint(view(1), 0.001, { x: 0, y: 0 }).zoom).toBe(MIN_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(1)
    expect(MIN_ZOOM).toBe(0.1)
    expect(MAX_ZOOM).toBe(3)
  })

  it('steps ×1.2, snapping through 100% and clamping at the ends', () => {
    expect(stepZoom(1, 'in')).toBeCloseTo(1.2)
    expect(stepZoom(1, 'out')).toBeCloseTo(1 / 1.2, 3)
    expect(stepZoom(1.2, 'out')).toBe(1)
    expect(stepZoom(0.9, 'in')).toBe(1)
    expect(stepZoom(2.9, 'in')).toBe(3)
    expect(stepZoom(0.11, 'out')).toBe(0.1)
  })

  it('formats the label', () => {
    expect(formatZoom(1)).toBe('100%')
    expect(formatZoom(0.3333)).toBe('33%')
  })
})

describe('coordinate conversions at zoom ≠ 1 (drag / drop / connect)', () => {
  it('client → canvas accounts for container offset, border, scroll and zoom', () => {
    const rect = { left: 260, top: 120 }
    const c = clientToCanvas({ x: 260 + 1 + 150, y: 120 + 1 + 100 }, rect, view(0.5, 100, 50), { x: 1, y: 1 })
    expect(c).toEqual({ x: 500, y: 300 })
    const c2 = clientToCanvas({ x: 460, y: 320 }, rect, view(2, 0, 0))
    expect(c2).toEqual({ x: 100, y: 100 })
  })

  it('round-trips canvas ↔ viewport', () => {
    const v = view(1.5, 321, 654)
    const p = { x: 1000, y: 700 }
    const back = viewportToCanvas(canvasToViewport(p, v), v)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
  })

  it('a node drag of N screen px moves it N / zoom canvas units', () => {
    expect(screenDeltaToCanvas({ x: 100, y: -50 }, 0.5)).toEqual({ x: 200, y: -100 })
    expect(screenDeltaToCanvas({ x: 100, y: -50 }, 2)).toEqual({ x: 50, y: -25 })
    expect(screenDeltaToCanvas({ x: 10, y: 10 }, 0)).toEqual({ x: 10, y: 10 })
  })

  it('the live drag transform is divided by the zoom so the card follows the pointer', () => {
    expect(scaledDragTransform({ x: 100, y: 40 }, 2)).toBe('translate3d(50px, 20px, 0)')
    expect(scaledDragTransform({ x: 100, y: 40 }, 0.5)).toBe('translate3d(200px, 80px, 0)')
    expect(scaledDragTransform(null, 2)).toBeUndefined()
  })
})

describe('fit and selection bounds', () => {
  it('fits the bounds centred within the padded viewport', () => {
    const bounds = { x: 200, y: 1100, width: 1800, height: 900 }
    const size = { width: 1000, height: 600 }
    const v = fitView(bounds, size, { padding: 50 })
    expect(v.zoom).toBe(0.5)
    // Bounds centre (1100, 1550) lands at the viewport centre.
    const c = canvasToViewport({ x: 1100, y: 1550 }, v)
    expect(c.x).toBeCloseTo(500)
    expect(c.y).toBeCloseTo(300)
    // Entire box visible.
    const tl = canvasToViewport({ x: 200, y: 1100 }, v)
    const br = canvasToViewport({ x: 2000, y: 2000 }, v)
    expect(tl.x).toBeGreaterThanOrEqual(0)
    expect(br.x).toBeLessThanOrEqual(1000)
    expect(br.y).toBeLessThanOrEqual(600)
  })

  it('never magnifies beyond maxZoom; small content near the origin is centred via virtual (negative) scroll', () => {
    const v = fitView({ x: 10, y: 10, width: 100, height: 50 }, { width: 1200, height: 800 })
    expect(v.zoom).toBe(1)
    expect(canvasToViewport({ x: 60, y: 35 }, v)).toEqual({ x: 600, y: 400 })
    const real = realiseView(v, { width: 1200, height: 800 })
    expect(real).toEqual({ scrollLeft: 0, scrollTop: 0, offsetX: 540, offsetY: 365 })
    expect(fitView({ x: 2000, y: 2000, width: 100, height: 50 }, { width: 1200, height: 800 }, { maxZoom: 2 }).zoom).toBe(2)
  })

  it('clamps huge content to the minimum zoom', () => {
    expect(fitView({ x: 0, y: 0, width: 100000, height: 100000 }, { width: 800, height: 600 }).zoom).toBe(MIN_ZOOM)
  })

  it('unions boxes', () => {
    expect(unionBounds([])).toBeNull()
    expect(unionBounds([{ x: 10, y: 20, width: 100, height: 50 }, { x: -5, y: 100, width: 10, height: 10 }]))
      .toEqual({ x: -5, y: 20, width: 115, height: 90 })
  })

  it('visible rect and centring', () => {
    expect(visibleCanvasRect(view(2, 400, 200), { width: 800, height: 600 })).toEqual({ x: 200, y: 100, width: 400, height: 300 })
    const v = centreOn({ x: 1000, y: 1000 }, view(0.5), { width: 800, height: 600 })
    expect(canvasToViewport({ x: 1000, y: 1000 }, v)).toEqual({ x: 400, y: 300 })
  })

  it('pastes beside visible copies, else in the middle of the view', () => {
    const visible = { x: 0, y: 0, width: 1000, height: 800 }
    expect(pasteOffset({ x: 100, y: 100, width: 224, height: 88 }, visible)).toEqual({ x: 40, y: 40 })
    const off = pasteOffset({ x: 3000, y: 3000, width: 200, height: 100 }, visible)
    expect(3000 + off.x + 100).toBeCloseTo(500, -2)
    expect(Math.abs(off.x % 20)).toBe(0)
  })
})

describe('virtual scroll (zooming / panning past the top-left edge)', () => {
  it('zooming out around a point near the origin keeps it fixed via the content offset', () => {
    const start = view(1.5, 0, 0)
    const anchor = { x: 400, y: 300 }
    const c = viewportToCanvas(anchor, start)
    const next = zoomAroundPoint(start, 0.5, anchor)
    expect(next.scrollLeft).toBeLessThan(0)
    const real = realiseView(next, { width: 1200, height: 800 })
    // The DOM: content translated by the offset, container scrolled by the rest.
    const screenX = c.x * next.zoom + real.offsetX - real.scrollLeft
    const screenY = c.y * next.zoom + real.offsetY - real.scrollTop
    expect(screenX).toBeCloseTo(anchor.x)
    expect(screenY).toBeCloseTo(anchor.y)
  })

  it('positive scroll needs no offset; the overscroll is capped', () => {
    expect(realiseView(view(1, 30, 40))).toEqual({ scrollLeft: 30, scrollTop: 40, offsetX: 0, offsetY: 0 })
    expect(realiseView(view(1, -5000, 0), { width: 1000, height: 600 }).offsetX).toBe(900)
  })

  it('content transform', () => {
    expect(contentTransform(0.5)).toBe('scale(0.5)')
    expect(contentTransform(2, 10.123, 0)).toBe('translate(10.12px, 0px) scale(2)')
  })
})

describe('wheel handling', () => {
  const w = (o: Partial<Parameters<typeof wheelAction>[0]>) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, metaKey: false, ...o })

  it('Ctrl/⌘ + wheel (and trackpad pinch, which sets ctrlKey) zooms; plain wheel pans', () => {
    expect(wheelAction(w({ ctrlKey: true, deltaY: -3 }))).toBe('zoom')
    expect(wheelAction(w({ metaKey: true, deltaY: 100 }))).toBe('zoom')
    expect(wheelAction(w({ deltaY: 100 }))).toBe('pan')
    expect(wheelAction(w({ deltaX: 40 }))).toBe('pan')
  })

  it('a mouse notch is one ×1.2 step; pinch frames are small; direction is natural', () => {
    expect(wheelZoomFactor(w({ ctrlKey: true, deltaY: -100 }))).toBeCloseTo(1.2)
    expect(wheelZoomFactor(w({ ctrlKey: true, deltaY: 100 }))).toBeCloseTo(1 / 1.2)
    expect(wheelZoomFactor(w({ ctrlKey: true, deltaY: -1000 }))).toBeCloseTo(1.2) // clamped
    const pinch = wheelZoomFactor(w({ ctrlKey: true, deltaY: -4 }))
    expect(pinch).toBeGreaterThan(1)
    expect(pinch).toBeLessThan(1.01)
    expect(wheelZoomFactor(w({ ctrlKey: true, deltaY: -3, deltaMode: 1 }))).toBeGreaterThan(1.05) // line mode
  })

  it('two-finger pinch zooms around the midpoint and pans with it', () => {
    const start = view(1, 100, 100)
    const anchorCanvas = viewportToCanvas({ x: 200, y: 200 }, start)
    const next = pinchStep(start, { centre: { x: 200, y: 200 }, distance: 100 }, { centre: { x: 200, y: 200 }, distance: 200 })
    expect(next.zoom).toBe(2)
    expect(canvasToViewport(anchorCanvas, next).x).toBeCloseTo(200)
    const panned = pinchStep(start, { centre: { x: 200, y: 200 }, distance: 100 }, { centre: { x: 230, y: 180 }, distance: 100 })
    expect(panned).toEqual({ zoom: 1, scrollLeft: 70, scrollTop: 120 })
  })
})

describe('keyboard shortcuts', () => {
  it('maps Ctrl/⌘ + = + − 0 and Shift + 1 / 2', () => {
    expect(key({ key: '=', code: 'Equal', ctrlKey: true })).toBe('in')
    expect(key({ key: '+', code: 'Equal', metaKey: true, shiftKey: true })).toBe('in')
    expect(key({ key: '-', code: 'Minus', ctrlKey: true })).toBe('out')
    expect(key({ key: '0', code: 'Digit0', metaKey: true })).toBe('reset')
    expect(key({ key: '!', code: 'Digit1', shiftKey: true })).toBe('fit')
    expect(key({ key: '@', code: 'Digit2', shiftKey: true })).toBe('selection')
  })

  it('ignores unrelated keys and Alt combos', () => {
    expect(key({ key: '1', code: 'Digit1' })).toBeNull()
    expect(key({ key: 'z', code: 'KeyZ', ctrlKey: true })).toBeNull()
    expect(key({ key: '=', code: 'Equal', ctrlKey: true, altKey: true })).toBeNull()
  })

  it('is ignored while typing in inputs, textareas, editors', () => {
    expect(key({ key: '=', code: 'Equal', ctrlKey: true, target: el('INPUT', { type: 'text' }) })).toBeNull()
    expect(key({ key: '!', code: 'Digit1', shiftKey: true, target: el('TEXTAREA') })).toBeNull()
    expect(key({ key: '0', code: 'Digit0', ctrlKey: true, target: el('DIV', { isContentEditable: true }) })).toBeNull()
    expect(key({ key: '0', code: 'Digit0', ctrlKey: true, target: el('DIV', { closest: () => ({}) }) })).toBeNull()
    expect(key({ key: '0', code: 'Digit0', ctrlKey: true, target: el('BUTTON') })).toBe('reset')
  })

  it('tooltip hints per platform', () => {
    expect(zoomShortcutHints(true)).toEqual({ in: '⌘=', out: '⌘−', reset: '⌘0', fit: '⇧1', selection: '⇧2', step: '⇧3' })
    expect(zoomShortcutHints(false).in).toBe('Ctrl+=')
  })
})

describe('minimap', () => {
  it('maps canvas ↔ minimap both ways and includes the viewport', () => {
    const layout = minimapLayout({ x: 0, y: 0, width: 2000, height: 1000 }, { x: 1500, y: 0, width: 1000, height: 500 }, { width: 160, height: 100 })
    const p = { x: 1234, y: 567 }
    const back = minimapToCanvas(canvasToMinimap(p, layout), layout)
    expect(back.x).toBeCloseTo(p.x)
    expect(back.y).toBeCloseTo(p.y)
    const br = canvasToMinimap({ x: 2500, y: 1000 }, layout)
    expect(br.x).toBeLessThanOrEqual(160)
    expect(br.y).toBeLessThanOrEqual(100)
  })
})

describe('session persistence', () => {
  it('round-trips and rejects junk', () => {
    expect(parseView(serializeView(view(1.5, 300, 40)))).toEqual(view(1.5, 300, 40))
    expect(parseView(null)).toBeNull()
    expect(parseView('{')).toBeNull()
    expect(parseView('{"z":"a","l":0,"t":0}')).toBeNull()
    expect(parseView('{"z":99,"l":-5,"t":0}')).toEqual(view(MAX_ZOOM, -5, 0))
  })
})

describe('wiring guards', () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
  it('designer and viewer share the canvas navigation, view is not saved with the workflow', () => {
    for (const f of ['components/automations/workflow-builder.tsx', 'components/automations/runtime-canvas.tsx']) {
      const src = read(f)
      expect(src).toContain('useCanvasZoom(')
      expect(src).toContain('<CanvasZoomControls')
      expect(src).not.toMatch(/setZoom\(z => Math\.(max|min)/)
    }
    const builder = read('components/automations/workflow-builder.tsx')
    // Zoom is not part of the undo snapshot nor of saveWorkflow payloads.
    expect(builder).not.toMatch(/Snapshot = \{[^}]*zoom/)
    expect(builder).not.toMatch(/saveWorkflow\([^)]*zoom/)
    // Drops and drags convert screen pixels to canvas units.
    expect(builder).toContain('screenDeltaToCanvas(event.delta')
    expect(builder).toContain('canvasView.toCanvas(client)')
  })

  it('zoom controls use theme tokens only', () => {
    const src = read('components/automations/canvas-zoom-controls.tsx') + read('components/automations/canvas-minimap.tsx')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/rgba?\(/)
  })
})
