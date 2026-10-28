import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import {
  canvasToViewport, clampViewToContent, contentFits, fitView, MIN_READABLE_ZOOM, readableInitialView, stepFocusView, STEP_FOCUS_ZOOM,
  zoomShortcut, type Bounds,
} from '@/lib/canvas-zoom'
import { computeRunOverlay, FOCUS_STEP_LABEL, pickFocusStep } from '@/lib/workflow-run-overlay'
import { logStepId } from '@/components/automations/runtime-canvas'

const size = { width: 900, height: 540 }
const centreOf = (b: Bounds) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
const onScreen = (b: Bounds, view: { zoom: number; scrollLeft: number; scrollTop: number }) => canvasToViewport(centreOf(b), view)

describe('readable opening view of a run preview', () => {
  it('fits a small graph (fit zoom at or above the readable minimum)', () => {
    const content = { x: 400, y: 20, width: 220, height: 300 }
    const { view, fits } = readableInitialView(content, size)
    expect(fits).toBe(true)
    expect(view).toEqual(fitView(content, size))
    expect(view.zoom).toBe(1) // fit never magnifies past 100%
  })

  it('never opens below the readable zoom: a tall graph opens at the minimum on the focus step', () => {
    const content = { x: 160, y: 20, width: 700, height: 1800 }
    expect(fitView(content, size).zoom).toBeLessThan(MIN_READABLE_ZOOM)
    const failed = { x: 400, y: 900, width: 220, height: 90 }
    const { view, fits } = readableInitialView(content, size, { focus: failed })
    expect(fits).toBe(false)
    expect(view.zoom).toBe(MIN_READABLE_ZOOM)
    const p = onScreen(failed, view)
    expect(p.x).toBeCloseTo(size.width / 2, 6)
    expect(p.y).toBeCloseTo(size.height / 2, 6)
  })

  it('keeps the view on the content when the focus step is near an edge', () => {
    const content = { x: 160, y: 20, width: 700, height: 1800 }
    const top = { x: 400, y: 20, width: 220, height: 90 }
    const { view } = readableInitialView(content, size, { focus: top })
    // Clamped: the graph's top sits one padding below the viewport top, not half a screen down.
    expect(view.scrollTop).toBeCloseTo(20 * MIN_READABLE_ZOOM - 48, 6)
  })

  it('without a focus step opens on the top of the graph (the start)', () => {
    const content = { x: 0, y: 0, width: 600, height: 2400 }
    const { view, fits } = readableInitialView(content, size)
    expect(fits).toBe(false)
    expect(view.zoom).toBe(MIN_READABLE_ZOOM)
    expect(view.scrollTop).toBeCloseTo(-48, 6)
  })

  it('honours a remembered zoom (per workflow) and centres when the graph fits at it', () => {
    const content = { x: 100, y: 100, width: 1200, height: 600 }
    const { view, fits } = readableInitialView(content, size, { savedZoom: 0.4 })
    expect(view.zoom).toBe(0.4)
    expect(fits).toBe(true)
    const c = canvasToViewport(centreOf(content), view)
    expect(c.x).toBeCloseTo(size.width / 2, 6)
    expect(c.y).toBeCloseTo(size.height / 2, 6)
    // A remembered 150% on a big graph: no fit, centred on the focus step.
    const focus = { x: 700, y: 500, width: 220, height: 90 }
    const zoomed = readableInitialView(content, size, { savedZoom: 1.5, focus })
    expect(zoomed.view.zoom).toBe(1.5)
    expect(zoomed.fits).toBe(false)
    expect(onScreen(focus, zoomed.view).x).toBeCloseTo(size.width / 2, 6)
  })

  it('a custom minimum applies', () => {
    const content = { x: 0, y: 0, width: 600, height: 2400 }
    expect(readableInitialView(content, size, { minZoom: 0.5 }).view.zoom).toBe(0.5)
  })

  it('contentFits / clampViewToContent per axis', () => {
    const content = { x: 0, y: 0, width: 400, height: 2000 }
    expect(contentFits(content, size, 1)).toBe(false)
    expect(contentFits(content, size, 0.2)).toBe(true)
    const v = clampViewToContent({ zoom: 1, scrollLeft: 999, scrollTop: 99999 }, content, size)
    expect(v.scrollLeft).toBeCloseTo(200 - 450, 6) // x fits: centred
    expect(v.scrollTop).toBeCloseTo(2000 + 48 - 540, 6) // y clamped to the bottom edge
  })
})

describe('zoom to step', () => {
  const step = { x: 640, y: 1200, width: 220, height: 90 }
  it('centres the step at 100% when zoomed out', () => {
    const v = stepFocusView(step, { zoom: 0.4, scrollLeft: 0, scrollTop: 0 }, size)
    expect(v.zoom).toBe(STEP_FOCUS_ZOOM)
    const p = onScreen(step, v)
    expect(p.x).toBeCloseTo(450, 6)
    expect(p.y).toBeCloseTo(270, 6)
  })
  it('keeps a higher zoom', () => {
    const v = stepFocusView(step, { zoom: 1.8, scrollLeft: 0, scrollTop: 0 }, size)
    expect(v.zoom).toBe(1.8)
    expect(onScreen(step, v).y).toBeCloseTo(270, 6)
  })
  it('Shift+3 is the step shortcut, ignored while typing', () => {
    const base = { key: '#', code: 'Digit3', ctrlKey: false, metaKey: false, shiftKey: true, altKey: false }
    expect(zoomShortcut({ ...base, target: null })).toBe('step')
    const input = { tagName: 'INPUT', isContentEditable: false, closest: () => null } as unknown as EventTarget
    expect(zoomShortcut({ ...base, target: input })).toBeNull()
  })
})

describe('focus step of a run', () => {
  const nodes = [
    { id: 'trg', type: 'webhook', position: { x: 400, y: 20 } },
    { id: 'a', type: 'set_title', position: { x: 400, y: 160 } },
    { id: 'b', type: 'call_reference', position: { x: 400, y: 300 } },
    { id: 'c', type: 'user_task', position: { x: 400, y: 440 } },
    { id: 'sec', type: 'section_group', position: { x: 0, y: 0 } },
  ]
  const edges = [
    { id: 'e1', source: 'trg', target: 'a' },
    { id: 'e2', source: 'a', target: 'b' },
    { id: 'e3', source: 'b', target: 'c' },
  ]
  it('failed step first', () => {
    const overlay = computeRunOverlay({ nodes, edges, nodeResults: { trg: { status: 'success' }, a: { status: 'success' }, b: { status: 'error', error: 'x' } } })
    expect(pickFocusStep(nodes, edges, overlay)).toEqual({ id: 'b', kind: 'failed' })
    expect(FOCUS_STEP_LABEL.failed).toBe('Zoom to failed step')
  })
  it('then the step the run is on', () => {
    const overlay = computeRunOverlay({ nodes, edges, nodeResults: { trg: { status: 'success' }, a: { status: 'success' }, b: { status: 'success' } }, pausedNodeId: 'c', runWaiting: true })
    expect(pickFocusStep(nodes, edges, overlay)).toEqual({ id: 'c', kind: 'current' })
    const live = computeRunOverlay({ nodes, edges, nodeResults: { trg: { status: 'success' } }, activeNodeId: 'a' })
    expect(pickFocusStep(nodes, edges, live)).toEqual({ id: 'a', kind: 'current' })
  })
  it('else the start (no incoming connection; sections ignored)', () => {
    const overlay = computeRunOverlay({ nodes, edges, nodeResults: {} })
    expect(pickFocusStep(nodes, edges, overlay)).toEqual({ id: 'trg', kind: 'start' })
    expect(pickFocusStep([], [], overlay)).toBeNull()
  })
})

describe('log lines resolve their step', () => {
  const nodes = [{ id: 'n1', label: 'Get vendor' }, { id: 'n2', label: 'Log' }, { id: 'n3', label: 'Log' }]
  it('by node id, else a unique label', () => {
    expect(logStepId({ node_id: 'n2', node_label: 'Log' }, nodes)).toBe('n2')
    expect(logStepId({ node_label: 'Get vendor' }, nodes)).toBe('n1')
    expect(logStepId({ node_label: 'Log' }, nodes)).toBeNull() // ambiguous
    expect(logStepId({ node_id: 'gone', node_label: 'Nope' }, nodes)).toBeNull()
  })
})

describe('every execution preview uses the shared run canvas', () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
  it('Save & Test, run detail, run compare and the migration preview', () => {
    const runner = read('components/automations/test-runner.tsx')
    expect(runner).toContain('<RuntimeCanvas')
    expect(runner).toMatch(/<RuntimeCanvas[\s\S]*?\bfill\b[\s\S]*?\/>/) // fills the dialog: controls can't be clipped
    expect(runner).toContain('workflowId={workflowId}')
    expect(runner).toContain('focusRequest={focusRequest}')
    expect(runner).toContain("'Expand to the full window'")
    const viewer = read('components/automations/process-viewer.tsx')
    expect(viewer.match(/<RuntimeCanvas/g)?.length).toBe(2) // process view + compare
    expect(viewer.match(/workflowId=\{workflow\.id\}/g)?.length).toBe(2)
    expect(viewer).toContain('<StepChip')
    const live = read('components/automations/live-instances.tsx')
    expect(live).toContain('<RuntimeCanvas')
    expect(live).not.toMatch(/<svg viewBox/)
    for (const src of [runner, viewer, live]) expect(src).not.toMatch(/maxHeight=/) // no fixed viewport-calc heights
  })
  it('the run canvas: readable opening view, zoom to step, full screen, controls on top', () => {
    const src = read('components/automations/runtime-canvas.tsx')
    expect(src).toContain('preview: {}')
    expect(src).toContain('getFocusBounds')
    expect(src).toContain('onFocusStep=')
    expect(src).toContain('placement="top"')
    expect(src).toContain('data-canvas-expand')
    expect(src).toContain('<CanvasMinimap')
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(src).not.toMatch(/rgba?\(/)
  })
})
