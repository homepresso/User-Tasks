import { describe, it, expect } from 'vitest'
import type { WorkflowEdge, WorkflowNode, NodeType } from '@/lib/workflow-schema'
import { routeEdges, deleteButtonPosition, distanceToRoute, DELETE_BUTTON_SIZE } from '@/lib/workflow-edge-routing'
import { describeChange } from '@/lib/workflow-history'

const n = (id: string, type: NodeType, x: number, y: number, config: Record<string, unknown> = {}): WorkflowNode =>
  ({ id, type, label: id, config, position: { x, y } })
const e = (source: string, target: string, label?: string): WorkflowEdge => ({ id: `${source}-${target}`, source, target, label })
const labelW = (label?: string) => (label ? Math.round(label.length * 5.6) + 14 : 0)

describe('selected connection delete button', () => {
  const cases: [string, WorkflowNode[], WorkflowEdge[]][] = [
    ['straight', [n('a', 'log', 0, 0), n('b', 'log', 0, 300)], [e('a', 'b')]],
    ['labelled elbow', [n('a', 'log', 0, 0), n('b', 'log', 400, 300)], [e('a', 'b', 'Approved')]],
    ['branch fan-out to the right', [n('c', 'condition', 0, 0, { branches: [{ label: 'Yes' }] }), n('y', 'log', -300, 300), n('x', 'log', 300, 300)], [e('c', 'x', 'Else')]],
    ['branch fan-out to the left', [n('c', 'condition', 0, 0, { branches: [{ label: 'Yes' }] }), n('y', 'log', -300, 300)], [e('c', 'y', 'Yes')]],
    ['back-edge', [n('top', 'log', 0, 0), n('bot', 'log', 0, 300)], [e('bot', 'top', 'Rework')]],
    ['side', [n('a', 'log', 0, 0), n('b', 'log', 400, 10)], [e('a', 'b')]],
  ]
  it.each(cases)('keeps a clear gap from the line (%s)', (_name, nodes, edges) => {
    const [route] = routeEdges(nodes, edges)
    const pos = deleteButtonPosition(route, labelW(edges[0].label))
    // The whole button (radius) plus a gap stays off every segment.
    expect(distanceToRoute(pos, route.points)).toBeGreaterThanOrEqual(DELETE_BUTTON_SIZE / 2 + 6)
    // …and close enough to the label to read as belonging to this connection.
    expect(Math.hypot(pos.x - route.labelX, pos.y - route.labelY)).toBeLessThan(80)
  })

  it('records deleting the selected connection as one undo entry', () => {
    const nodes = [n('a', 'log', 0, 0), n('b', 'log', 0, 300)]
    const edges = [e('a', 'b')]
    const before = { nodes, edges, userVariables: [], swimlanes: [] }
    const change = describeChange(before, { ...before, edges: [] })
    expect(change).toEqual({ label: "remove connection 'a' → 'b'" })
  })
})
