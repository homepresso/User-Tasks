/**
 * The trigger lane (lib/workflow-trigger-lane): the band behind the trigger
 * step(s) on the designer and every run viewer.
 *  - geometry: band height follows the tallest trigger card plus even padding;
 *  - clamping: triggers into the band, steps / sections below it, drags;
 *  - fitting saved workflows on open (positions only, nothing else changes);
 *  - auto-layout respects the band;
 *  - render: the edge-to-edge band layer and the run canvas drawing it.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkflowEdge, WorkflowNode } from '@/lib/workflow-schema'
import {
  centredTriggerY, clampDragDelta, clampTriggerPosition, fitTriggerLane, minContentY, TRIGGER_LANE, triggerLaneOf, triggerYRange,
} from '@/lib/workflow-trigger-lane'
import { DEFAULT_NODE_HEIGHT } from '@/lib/workflow-edge-routing'
import { applyLayout, layoutWorkflow } from '@/lib/workflow-layout'
import { CanvasBandsLayer } from '@/components/automations/canvas-sections'
import { RuntimeCanvas } from '@/components/automations/runtime-canvas'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const node = (id: string, type: string, x: number, y: number, extra: Partial<WorkflowNode> = {}): WorkflowNode =>
  ({ id, type, label: id, position: { x, y }, config: {}, ...extra }) as WorkflowNode
const { PAD, GAP } = TRIGGER_LANE

describe('trigger lane geometry', () => {
  it('has no band without a trigger', () => {
    expect(triggerLaneOf([node('a', 'log', 0, 200)])).toBeNull()
    expect(minContentY(null)).toBe(0)
  })

  it('band = padding + tallest trigger card + padding, from the top', () => {
    const lane = triggerLaneOf([node('t', 'webhook_received', 40, 20)])!
    expect(lane).toEqual({ top: 0, inner: DEFAULT_NODE_HEIGHT, height: DEFAULT_NODE_HEIGHT + 2 * PAD, bottom: DEFAULT_NODE_HEIGHT + 2 * PAD })
    // A long trigger description makes the card (and the band) taller.
    const tall = triggerLaneOf([node('t', 'webhook_received', 40, 20), node('t2', 'task_created', 300, 20)], { t2: { width: 224, height: 164 } })!
    expect(tall.inner).toBe(164)
    expect(tall.bottom).toBe(164 + 2 * PAD)
  })

  it('a lone trigger has exactly even padding; a shorter one has play inside the band', () => {
    const sizes = { tall: { width: 224, height: 160 }, short: { width: 224, height: 80 } }
    const lane = triggerLaneOf([node('tall', 'webhook_received', 0, 0), node('short', 'task_created', 300, 0)], sizes)!
    expect(triggerYRange(lane, 160)).toEqual({ min: PAD, max: PAD })
    expect(triggerYRange(lane, 80)).toEqual({ min: PAD, max: PAD + 80 })
    expect(centredTriggerY(lane, 80)).toBe(PAD + 40)
    expect(centredTriggerY(lane, 160)).toBe(PAD)
  })

  it('steps start on the grid at least GAP below the band', () => {
    const lane = triggerLaneOf([node('t', 'webhook_received', 0, 0)], { t: { width: 224, height: 130 } })!
    expect(lane.bottom).toBe(170)
    expect(minContentY(lane)).toBe(200) // 170 + 20 = 190 → next grid line
    expect(minContentY(lane) % TRIGGER_LANE.GRID).toBe(0)
  })
})

describe('clamping', () => {
  const lane = triggerLaneOf([node('t', 'webhook_received', 0, 0)])!

  it('clamps a trigger position into the band (horizontal is free, x >= 0)', () => {
    expect(clampTriggerPosition({ x: 500, y: 400 }, DEFAULT_NODE_HEIGHT, lane)).toEqual({ x: 500, y: PAD })
    expect(clampTriggerPosition({ x: -30, y: -50 }, DEFAULT_NODE_HEIGHT, lane)).toEqual({ x: 0, y: PAD })
  })

  it('limits a live drag: trigger within the band, step below it', () => {
    const t = node('t', 'webhook_received', 0, PAD)
    expect(clampDragDelta(t, 300, lane)).toBe(0)
    expect(clampDragDelta(t, -300, lane)).toBe(0)
    const shortT = node('s', 'webhook_received', 0, PAD)
    const tallLane = triggerLaneOf([t, shortT], { t: { width: 224, height: 160 }, s: { width: 224, height: 80 } })!
    expect(clampDragDelta(shortT, 50, tallLane, { s: { width: 224, height: 80 } })).toBe(50)
    expect(clampDragDelta(shortT, 500, tallLane, { s: { width: 224, height: 80 } })).toBe(80)
    const step = node('a', 'log', 0, 300)
    expect(clampDragDelta(step, -1000, lane)).toBe(minContentY(lane) - 300)
    expect(clampDragDelta(step, 40, lane)).toBe(40)
    expect(clampDragDelta(step, -1000, null)).toBe(-1000)
  })
})

describe('fitting a saved workflow', () => {
  it('leaves a workflow that already fits untouched (same arrays)', () => {
    const nodes = [node('t', 'webhook_received', 40, PAD), node('a', 'log', 40, 200)]
    const lanes = [{ id: 'l', label: 'Phase', color: '#3B82F6', y: 300, height: 200 }]
    const fit = fitTriggerLane(nodes, { swimlanes: lanes, shiftContent: true })
    expect(fit.changed).toBe(false)
    expect(fit.nodes).toBe(nodes)
    expect(fit.swimlanes).toBe(lanes)
  })

  it('clamps a trigger saved outside the band; only its position changes', () => {
    const t = node('t', 'webhook_received', 300, 420, { config: { path: 'hook' }, description: 'desc' } as Partial<WorkflowNode>)
    const a = node('a', 'log', 40, 560)
    const fit = fitTriggerLane([t, a], { shiftContent: true })
    expect(fit.changed).toBe(true)
    const moved = fit.nodes[0]
    expect(moved.position).toEqual({ x: 300, y: PAD })
    expect({ ...moved, position: t.position }).toEqual(t)
    expect(fit.nodes[1]).toBe(a)
  })

  it('on open, steps overlapping a (taller) band move down together, swimlanes too', () => {
    const sizes = { t: { width: 224, height: 150 } } // SharePoint-style trigger with a long description
    const nodes = [
      node('t', 'webhook_received', 40, PAD),
      node('a', 'log', 40, 160),
      node('b', 'log', 40, 300),
      node('s', 'section_group', 20, 400, { config: { width: 400, height: 200 } }),
      node('c', 'log', 40, 460, { sectionId: 's' } as Partial<WorkflowNode>),
    ]
    const lanes = [{ id: 'l', label: 'Phase', color: '#3B82F6', y: 280, height: 200 }]
    const fit = fitTriggerLane(nodes, { sizes, swimlanes: lanes, shiftContent: true })
    const floor = minContentY(fit.lane) // 150 + 40 + 20 = 210 → 220
    expect(floor).toBe(220)
    const y = Object.fromEntries(fit.nodes.map((n) => [n.id, n.position.y]))
    expect(y).toEqual({ t: PAD, a: 220, b: 360, s: 460, c: 520 })
    expect(fit.swimlanes[0]).toEqual({ ...lanes[0], y: 340 })
    // x, ids, configs and sections untouched
    expect(fit.nodes.map((n) => n.position.x)).toEqual(nodes.map((n) => n.position.x))
    expect(fit.nodes[4].sectionId).toBe('s')
  })

  it('without shiftContent only the overlapping step (or section with its members) is pushed below', () => {
    const nodes = [
      node('t', 'webhook_received', 40, PAD),
      node('a', 'log', 400, 60),
      node('b', 'log', 40, 300),
      node('s', 'section_group', 700, 40, { config: { width: 400, height: 200 } }),
      node('c', 'log', 720, 100, { sectionId: 's' } as Partial<WorkflowNode>),
    ]
    const fit = fitTriggerLane(nodes)
    const floor = minContentY(fit.lane)
    const y = Object.fromEntries(fit.nodes.map((n) => [n.id, n.position.y]))
    expect(y).toEqual({ t: PAD, a: floor, b: 300, s: floor, c: 100 + (floor - 40) })
    expect(fit.nodes[2]).toBe(nodes[2])
  })

  it('is idempotent', () => {
    const nodes = [node('t', 'webhook_received', 40, 900), node('a', 'log', 40, 10)]
    const once = fitTriggerLane(nodes, { shiftContent: true })
    const twice = fitTriggerLane(once.nodes, { shiftContent: true })
    expect(twice.changed).toBe(false)
  })
})

describe('auto-layout respects the band', () => {
  const edges: WorkflowEdge[] = [{ id: 'e1', source: 't', target: 'a' }, { id: 'e2', source: 'a', target: 'b' }] as WorkflowEdge[]

  it('centres triggers of different heights in the band and starts steps below it', () => {
    const nodes = [node('t', 'webhook_received', 0, 500), node('t2', 'task_created', 300, 700), node('a', 'log', 0, 30), node('b', 'log', 0, 60)]
    const sizes = { t: { width: 224, height: 160 }, t2: { width: 224, height: 88 } }
    const laid = applyLayout(nodes, layoutWorkflow({ nodes, edges, sizes }))
    const lane = triggerLaneOf(laid, sizes)!
    const at = Object.fromEntries(laid.map((n) => [n.id, n.position]))
    expect(at.t.y).toBe(PAD)
    expect(at.t2.y).toBe(PAD + (160 - 88) / 2)
    expect(at.a.y).toBeGreaterThanOrEqual(minContentY(lane))
    expect(at.b.y).toBeGreaterThan(at.a.y)
    // Already fitted: the designer's lane fit has nothing to do after Tidy.
    expect(fitTriggerLane(laid, { sizes }).changed).toBe(false)
  })

  it('lone steps stay below a tall band too', () => {
    const nodes = [node('t', 'webhook_received', 0, 0), node('x', 'log', 0, 0)]
    const sizes = { t: { width: 224, height: 200 } }
    const laid = applyLayout(nodes, layoutWorkflow({ nodes, edges: [], sizes }))
    expect(laid[1].position.y).toBeGreaterThanOrEqual(minContentY(triggerLaneOf(laid, sizes)))
  })
})

describe('render', () => {
  const getView = () => ({ zoom: 1, scrollLeft: 0, scrollTop: 0 })

  it('the band layer is a sticky, viewport-pinned row sized in canvas units', () => {
    const lane = triggerLaneOf([node('t', 'webhook_received', 0, PAD)])!
    const html = renderToStaticMarkup(createElement(CanvasBandsLayer, {
      getView, lane,
      swimlanes: [{ id: 'l1', label: 'Review', color: '#3B82F6', y: 40, height: 400 }],
    }))
    expect(html).toContain('data-canvas-bands')
    expect(html).toMatch(/class="[^"]*sticky left-0[^"]*"/)
    expect(html).toContain('data-trigger-zone')
    expect(html).toContain(`height:calc(${lane.height}px * var(--band-zoom, 1))`)
    expect(html).toContain('top:calc(var(--band-oy, 0px) + 0px * var(--band-zoom, 1))')
    expect(html).toMatch(/inset-x-0/)
    expect(html).toContain('Triggers')
    // A swimlane overlapping the trigger band is drawn from the band's bottom.
    expect(html).toContain(`top:calc(var(--band-oy, 0px) + ${lane.bottom}px * var(--band-zoom, 1))`)
    expect(html).toContain(`height:calc(${400 - (lane.bottom - 40)}px * var(--band-zoom, 1))`)
  })

  it('draws nothing without a trigger or swimlanes', () => {
    expect(renderToStaticMarkup(createElement(CanvasBandsLayer, { getView, lane: null, swimlanes: [] }))).toBe('')
  })

  it('the run canvas draws the band before the zoomed content and fits a trigger saved outside it', () => {
    const nodes = [node('t', 'webhook_received', 60, 400), node('a', 'log', 60, 140)]
    const html = renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(RuntimeCanvas, {
      nodes, edges: [{ id: 'e', source: 't', target: 'a' }] as WorkflowEdge[], lookups: {},
      overlay: { nodes: { t: { status: 'completed' }, a: { status: 'completed' } }, edges: {}, traversed: new Set(['t', 'a']) } as never,
    })))
    const bands = html.indexOf('data-canvas-bands')
    const content = html.indexOf('data-canvas-bg="true"')
    expect(bands).toBeGreaterThan(-1)
    expect(bands).toBeLessThan(content)
    const lane = triggerLaneOf(nodes)!
    expect(html).toContain(`data-lane-height="${lane.height}"`)
    // Trigger card inside the band, the step below it.
    expect(html).toMatch(new RegExp(`left:60px;top:${PAD}px`))
    expect(html).toMatch(new RegExp(`left:60px;top:${minContentY(lane)}px`))
  })

  it('the designer draws the shared band layer first in its scroll container and clamps drags', () => {
    const src = readFileSync(path.join(process.cwd(), 'components/automations/workflow-builder.tsx'), 'utf8')
    expect(src).toMatch(/<CanvasBandsLayer [^>]*lane=\{lane\}/)
    expect(src.indexOf('<CanvasBandsLayer')).toBeLessThan(src.indexOf('ref={canvasContentRef}'))
    expect(src).toContain('modifiers={[laneDragModifier]}')
    expect(src).toContain('fitTriggerLane(normalizeDataTableNodes(initialNodes)')
    expect(src).not.toContain('TRIGGER_ZONE_HEIGHT')
  })
})
