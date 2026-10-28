import { describe, it, expect } from 'vitest'
import type { WorkflowEdge, WorkflowNode, NodeType } from '@/lib/workflow-schema'
import {
  routeEdges, branchPortOffsets, topPortXs, roundedPath, simplify, polylineClear, nodeBox,
  CHIP_AREA, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, GOTO_ROUTE_PREFIX, type EdgeRoute,
} from '@/lib/workflow-edge-routing'
import { getBranchLabels, orderOutgoingEdges } from '@/lib/workflow-branches'

const W = DEFAULT_NODE_WIDTH, H = DEFAULT_NODE_HEIGHT
function n(id: string, type: NodeType, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode {
  return { id, type, label: id, config, position: { x, y } }
}
const e = (source: string, target: string, label?: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge =>
  ({ id: `${source}-${target}${label ? `-${label}` : ''}`, source, target, ...(label ? { label } : {}), ...extra })
const byId = (routes: EdgeRoute[]) => new Map(routes.map((r) => [r.id, r]))
const first = (r: EdgeRoute) => r.points[0]
const last = (r: EdgeRoute) => r.points[r.points.length - 1]
const orthogonal = (r: EdgeRoute) => r.points.every((p, i) => i === 0 || p.x === r.points[i - 1].x || p.y === r.points[i - 1].y)
const boxes = (nodes: WorkflowNode[], except: string[]) => nodes.filter((x) => !except.includes(x.id)).map((x) => {
  const b = nodeBox(x)
  return getBranchLabels(x).length ? { ...b, height: b.height + CHIP_AREA } : b
})

describe('branch helpers', () => {
  it('orders outgoing edges by branch port, then side port, error paths last', () => {
    const cond = n('c', 'condition', 0, 0, { branches: [{ label: 'A' }, { label: 'B' }] })
    const out = [e('c', 'x', 'Else'), e('c', 'y', 'Error'), e('c', 'z', 'B'), e('c', 'w', 'A')]
    expect(orderOutgoingEdges(cond, out).map((x) => x.label)).toEqual(['A', 'B', 'Else', 'Error'])
    const plain = n('p', 'log', 0, 0)
    const sides = [e('p', 'r', undefined, { sourcePort: 'right' }), e('p', 'b'), e('p', 'l', undefined, { sourcePort: 'left' })]
    expect(orderOutgoingEdges(plain, sides).map((x) => x.target)).toEqual(['l', 'b', 'r'])
  })

  it('spaces branch ports evenly across the card in order', () => {
    expect(branchPortOffsets(224, 2)).toEqual([56, 168])
    expect(branchPortOffsets(224, 4)).toEqual([28, 84, 140, 196])
    expect(topPortXs(100, 224, 1)).toEqual([100])
    expect(topPortXs(100, 224, 3)).toEqual([76, 100, 124])
  })
})

describe('routeEdges', () => {
  it('connects a forward edge bottom-centre to top-centre with a straight line ending on the border', () => {
    const nodes = [n('a', 'log', 100, 100), n('b', 'log', 100, 300)]
    const [r] = routeEdges(nodes, [e('a', 'b')])
    expect(r.kind).toBe('forward')
    expect(first(r)).toEqual({ x: 100 + W / 2, y: 100 + H })
    expect(last(r)).toEqual({ x: 100 + W / 2, y: 300 })
    expect(r.points).toHaveLength(2)
    expect(r.sourceSide).toBe('bottom')
    expect(r.targetSide).toBe('top')
  })

  it('uses measured sizes for anchors', () => {
    const nodes = [n('a', 'log', 0, 0), n('b', 'log', 0, 400)]
    const [r] = routeEdges(nodes, [e('a', 'b')], { sizes: { a: { width: 224, height: 140 } } })
    expect(first(r).y).toBe(140)
  })

  it.each([2, 3, 4])('fans %i branches out from evenly spaced ports in branch order without overlapping at the source', (k) => {
    const labels = Array.from({ length: k - 1 }, (_, i) => `Case ${i + 1}`)
    const sw = n('s', 'switch_case', 400, 100, { cases: labels })
    const targets = [...labels, 'Default'].map((l, i) => n(`t${i}`, 'log', 400 + (i - (k - 1) / 2) * 320, 360))
    const edges = [...labels, 'Default'].map((l, i) => e('s', `t${i}`, l)).reverse()
    const routes = byId(routeEdges([sw, ...targets], edges))
    const xs = [...labels, 'Default'].map((l, i) => first(routes.get(`s-t${i}-${l}`)!).x)
    const offsets = branchPortOffsets(W, k).map((o) => 400 + o)
    expect(xs).toEqual(offsets)
    for (const [i, l] of [...labels, 'Default'].entries()) {
      const r = routes.get(`s-t${i}-${l}`)!
      expect(r.branchIndex).toBe(i)
      expect(first(r).y).toBe(100 + H + CHIP_AREA) // below the chip row
      expect(last(r)).toEqual({ x: targets[i].position.x + W / 2, y: 360 })
      expect(orthogonal(r)).toBe(true)
    }
  })

  it('places branch ports on the card edge when the surface draws no chips', () => {
    const c = n('c', 'condition', 0, 0, { branches: [{ label: 'Yes' }] })
    const routes = routeEdges([c, n('y', 'log', -200, 300), n('x', 'log', 200, 300)], [e('c', 'y', 'Yes'), e('c', 'x', 'Else')], { chips: false })
    expect(routes.every((r) => first(r).y === H)).toBe(true)
  })

  it('gives a join evenly spaced top ports sorted by where the edges come from', () => {
    const nodes = [n('l', 'log', 0, 100), n('m', 'log', 320, 100), n('r', 'log', 640, 100), n('j', 'log', 320, 400)]
    const routes = byId(routeEdges(nodes, [e('r', 'j'), e('l', 'j'), e('m', 'j')]))
    const ends = ['l', 'm', 'r'].map((s) => last(routes.get(`${s}-j`)!))
    const cx = 320 + W / 2
    expect(ends.map((p) => p.x)).toEqual(topPortXs(cx, W, 3))
    expect(ends.every((p) => p.y === 400)).toBe(true)
    // Merge edges drop down their own column and turn just above the join.
    const lr = routes.get('l-j')!
    expect(lr.points[1].x).toBe(W / 2)
    expect(lr.points[1].y).toBe(380)
  })

  it('loops a body back-edge from the neighbouring column straight across into the side of the loop', () => {
    const nodes = [n('loop', 'loop', 0, 100), n('b1', 'log', 320, 260), n('b2', 'log', 320, 420), n('d', 'log', 0, 580)]
    const [r] = routeEdges(nodes, [e('b2', 'loop')])
    expect(r.kind).toBe('side')
    expect(first(r)).toEqual({ x: 320, y: 420 + H / 2 })
    expect(last(r)).toEqual({ x: W, y: 100 + H / 2 })
    expect(r.targetSide).toBe('right')
    expect(polylineClear(r.points, boxes(nodes, ['b2', 'loop']))).toBe(true)
    expect(orthogonal(r)).toBe(true)
  })

  it('routes a back-edge in the same column out of the right side, up a free corridor, into the right side', () => {
    const nodes = [n('u', 'user_task', 0, 100), n('mid', 'log', 0, 300), n('fix', 'update_task', 0, 500)]
    const [r] = routeEdges(nodes, [e('fix', 'u')])
    expect(r.kind).toBe('back')
    expect(first(r)).toEqual({ x: W, y: 500 + H / 2 })
    expect(last(r)).toEqual({ x: W, y: 100 + H / 2 })
    expect(Math.max(...r.points.map((p) => p.x))).toBeGreaterThan(W)
    expect(polylineClear(r.points, boxes(nodes, ['fix', 'u']))).toBe(true)
  })

  it('enters a target to the lower left from the facing side when it is not far enough below', () => {
    const nodes = [n('c', 'condition', 300, 100, { branches: [{ label: 'Yes' }] }), n('y', 'log', 0, 200)]
    const [r] = routeEdges(nodes, [e('c', 'y', 'Yes')])
    expect(r.kind).toBe('side')
    expect(r.sourceSide).toBe('left')
    expect(r.targetSide).toBe('right')
  })

  it('draws goto jumps as side-routed synthetic routes that avoid nodes', () => {
    const nodes = [n('load', 'read_csv', 0, 100), n('mid', 'log', 0, 260), n('g', 'goto_activity', 0, 420, { target_node_id: 'load' })]
    const routes = routeEdges(nodes, [e('load', 'mid'), e('mid', 'g')])
    const jump = routes.find((r) => r.id === `${GOTO_ROUTE_PREFIX}g`)!
    expect(jump.kind).toBe('goto')
    expect(jump.sourceSide).toBe('right')
    expect(last(jump)).toEqual({ x: W, y: 100 + H / 2 })
    expect(polylineClear(jump.points, boxes(nodes, ['g', 'load']))).toBe(true)
    expect(routeEdges(nodes, [], { gotos: false })).toHaveLength(0)
  })

  it('leaves error edges from the right side into the error lane', () => {
    const nodes = [n('h', 'http_request', 0, 100), n('ok', 'log', 0, 300), n('fail', 'log', 340, 300)]
    const routes = byId(routeEdges(nodes, [e('h', 'ok'), e('h', 'fail', 'Error')]))
    const r = routes.get('h-fail-Error')!
    expect(r.kind).toBe('error')
    expect(first(r)).toEqual({ x: W, y: 100 + H / 2 })
    expect(last(r)).toEqual({ x: 340 + W / 2, y: 300 })
  })

  it('picks a sensible side for manual layouts: target beside → facing sides, target above → around the side', () => {
    const nodes = [n('a', 'log', 0, 200), n('b', 'log', 400, 210), n('c', 'log', -10, 0)]
    const routes = byId(routeEdges(nodes, [e('a', 'b'), e('a', 'c')]))
    const side = routes.get('a-b')!
    expect(side.kind).toBe('side')
    expect(first(side)).toEqual({ x: W, y: 200 + H / 2 })
    expect(last(side)).toEqual({ x: 400, y: 210 + H / 2 })
    const up = routes.get('a-c')!
    expect(up.kind).toBe('back')
    expect(up.targetSide).toBe('right')
    expect(polylineClear(up.points, boxes(nodes, ['a', 'c']))).toBe(true)
  })

  it('detours a forward edge around a node in the way', () => {
    const nodes = [n('a', 'log', 0, 0), n('block', 'log', 0, 200), n('b', 'log', 0, 400)]
    const [r] = routeEdges(nodes, [e('a', 'b')])
    expect(polylineClear(r.points, boxes(nodes, ['a', 'b']))).toBe(true)
    expect(last(r).y).toBe(400)
  })

  it('staggers horizontal runs so two connectors never run along the same line', () => {
    const u1 = n('u1', 'user_task', 0, 0, { outcomes: ['Approved', 'Rejected'] })
    const u2 = n('u2', 'user_task', 320, 0, { outcomes: ['Approved', 'Rejected'] })
    const nodes = [u1, u2, n('far', 'log', -400, 260), n('far2', 'log', -720, 260)]
    const routes = routeEdges(nodes, [e('u1', 'far', 'Approved'), e('u2', 'far2', 'Approved')])
    const runs = routes.flatMap((r) => r.points.slice(1).map((p, i) => ({ a: r.points[i], b: p, id: r.id })).filter(({ a, b }) => a.y === b.y && a.x !== b.x))
    for (const r1 of runs) for (const r2 of runs) {
      if (r1.id === r2.id || r1.a.y !== r2.a.y) continue
      const overlap = Math.min(Math.max(r1.a.x, r1.b.x), Math.max(r2.a.x, r2.b.x)) - Math.max(Math.min(r1.a.x, r1.b.x), Math.min(r2.a.x, r2.b.x))
      expect(overlap).toBeLessThanOrEqual(2)
    }
  })

  it('fans parallel back-edges into separate lanes', () => {
    const nodes = [n('top', 'log', 0, 0), n('x', 'log', 0, 200), n('y', 'log', 0, 400)]
    const routes = routeEdges(nodes, [e('x', 'top'), e('y', 'top')])
    const lanes = routes.map((r) => Math.max(...r.points.map((p) => p.x)))
    expect(new Set(lanes).size).toBe(2)
  })

  it('puts labels on the straight segment just below the source port, clear of the source card', () => {
    const nodes = [n('a', 'log', 0, 0), n('b', 'log', 300, 300)]
    const [r] = routeEdges(nodes, [e('a', 'b', 'Next')])
    expect(r.labelX).toBe(W / 2)
    expect(r.labelY).toBeGreaterThan(H + 8)
    expect(r.labelY).toBeLessThan(r.points[1].y)
  })
})

describe('path helpers', () => {
  it('simplifies collinear points and rounds corners', () => {
    expect(simplify([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 20 }, { x: 10, y: 20 }])).toEqual([{ x: 0, y: 0 }, { x: 0, y: 20 }, { x: 10, y: 20 }])
    const d = roundedPath([{ x: 0, y: 0 }, { x: 0, y: 40 }, { x: 40, y: 40 }])
    expect(d).toBe('M 0 0 L 0 32 Q 0 40 8 40 L 40 40')
  })
})
