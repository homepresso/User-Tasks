import { describe, it, expect } from 'vitest'
import type { WorkflowEdge, WorkflowNode, NodeType } from '@/lib/workflow-schema'
import { layoutWorkflow, applyLayout, LAYOUT, type LayoutResult } from '@/lib/workflow-layout'
import { CHIP_AREA, DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, nodeBox, polylineClear, routeEdges, type EdgeRoute } from '@/lib/workflow-edge-routing'
import { getBranchLabels } from '@/lib/workflow-branches'

let counter = 0
function node(id: string, type: NodeType, config: Record<string, unknown> = {}, extra: Partial<WorkflowNode> = {}): WorkflowNode {
  counter++
  // Deliberately messy starting positions.
  return { id, type, label: id, config, position: { x: (counter * 337) % 900, y: type === 'task_created' ? 20 : 140 + ((counter * 211) % 700) }, ...extra }
}
function edge(source: string, target: string, label?: string, extra: Partial<WorkflowEdge> = {}): WorkflowEdge {
  return { id: `${source}->${target}:${label ?? ''}`, source, target, ...(label ? { label } : {}), ...extra }
}
const cond = (...labels: string[]) => ({ branches: labels.map((label) => ({ label })), has_else: true })

function footprint(n: WorkflowNode) {
  return DEFAULT_NODE_HEIGHT + (getBranchLabels(n).length > 0 ? CHIP_AREA : 0)
}

function check(nodes: WorkflowNode[], edges: WorkflowEdge[], result: LayoutResult) {
  const laid = applyLayout(nodes, result)
  const byId = new Map(laid.map((n) => [n.id, n]))
  const cards = laid.filter((n) => n.type !== 'section_group')
  // No overlaps (card + branch chips).
  for (let a = 0; a < cards.length; a++) {
    for (let b = a + 1; b < cards.length; b++) {
      const A = cards[a], B = cards[b]
      const overlap = A.position.x < B.position.x + DEFAULT_NODE_WIDTH && B.position.x < A.position.x + DEFAULT_NODE_WIDTH
        && A.position.y < B.position.y + footprint(B) && B.position.y < A.position.y + footprint(A)
      expect(overlap, `${A.id} overlaps ${B.id}`).toBe(false)
    }
  }
  // Grid.
  for (const n of cards) {
    expect(n.position.x % LAYOUT.GRID, `${n.id}.x on grid`).toBe(0)
    expect(n.position.y % LAYOUT.GRID, `${n.id}.y on grid`).toBe(0)
  }
  // Forward edges point down.
  const back = new Set(result.backEdges)
  for (const e of edges) {
    if (back.has(e.id)) continue
    const s = byId.get(e.source)!, t = byId.get(e.target)!
    expect(t.position.y, `${e.source} → ${e.target} goes down`).toBeGreaterThan(s.position.y)
  }
  return byId
}

const cxOf = (m: Map<string, WorkflowNode>, id: string) => m.get(id)!.position.x + DEFAULT_NODE_WIDTH / 2

describe('layoutWorkflow', () => {
  it('lays a linear chain on one straight vertical spine with the trigger at the top', () => {
    const nodes = [node('t', 'task_created'), node('a', 'set_variable'), node('b', 'log'), node('c', 'end_workflow')]
    const edges = [edge('t', 'a'), edge('a', 'b'), edge('b', 'c')]
    const r = layoutWorkflow({ nodes, edges })
    const m = check(nodes, edges, r)
    expect(m.get('t')!.position.y).toBe(LAYOUT.TRIGGER_Y)
    expect(new Set(['t', 'a', 'b', 'c'].map((id) => m.get(id)!.position.x)).size).toBe(1)
    const ys = ['a', 'b', 'c'].map((id) => m.get(id)!.position.y)
    expect(ys[1] - ys[0]).toBe(ys[2] - ys[1]) // equal rhythm
    expect(ys[0]).toBeGreaterThanOrEqual(LAYOUT.FIRST_ROW_Y)
  })

  it('puts two condition branches side by side and centres the merge below the condition', () => {
    const nodes = [node('t', 'task_created'), node('c', 'condition', cond('Approved')), node('yes', 'log'), node('no', 'log'), node('j', 'send_email')]
    const edges = [edge('t', 'c'), edge('c', 'no', 'Else'), edge('c', 'yes', 'Approved'), edge('yes', 'j'), edge('no', 'j')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'yes')).toBeLessThan(cxOf(m, 'c'))
    expect(cxOf(m, 'no')).toBeGreaterThan(cxOf(m, 'c'))
    expect(cxOf(m, 'j')).toBe(cxOf(m, 'c'))
    expect(cxOf(m, 'c') - cxOf(m, 'yes')).toBe(cxOf(m, 'no') - cxOf(m, 'c')) // symmetric
    expect(m.get('yes')!.position.y).toBe(m.get('no')!.position.y)
    expect(cxOf(m, 'no') - cxOf(m, 'yes')).toBeGreaterThanOrEqual(DEFAULT_NODE_WIDTH + LAYOUT.GAP_X)
  })

  it('keeps an empty else on the spine and moves the non-empty branch aside', () => {
    const nodes = [node('t', 'task_created'), node('c', 'condition', cond('Yes')), node('yes', 'log'), node('j', 'log')]
    const edges = [edge('t', 'c'), edge('c', 'yes', 'Yes'), edge('c', 'j', 'Else'), edge('yes', 'j')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'j')).toBe(cxOf(m, 'c'))
    expect(cxOf(m, 'yes')).toBeLessThan(cxOf(m, 'c'))
  })

  it('orders four switch cases left to right by config, Default last', () => {
    const nodes = [node('t', 'task_created'), node('s', 'switch_case', { cases: ['Low', 'Medium', 'High'] }), node('d', 'log'), node('h', 'log'), node('mm', 'log'), node('l', 'log'), node('j', 'log')]
    const edges = [edge('t', 's'), edge('s', 'd', 'Default'), edge('s', 'h', 'High'), edge('s', 'mm', 'Medium'), edge('s', 'l', 'Low'), ...['d', 'h', 'mm', 'l'].map((x) => edge(x, 'j'))]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    const xs = ['l', 'mm', 'h', 'd'].map((id) => cxOf(m, id))
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    expect(cxOf(m, 'j')).toBe(cxOf(m, 's'))
    expect((xs[0] + xs[3]) / 2).toBe(cxOf(m, 's'))
  })

  it('nests conditions recursively without overlap', () => {
    const nodes = [
      node('t', 'task_created'), node('c1', 'condition', cond('A')), node('c2', 'condition', cond('B')),
      node('a', 'log'), node('b1', 'log'), node('b2', 'log'), node('j2', 'log'), node('j1', 'log'),
    ]
    const edges = [
      edge('t', 'c1'), edge('c1', 'a', 'A'), edge('c1', 'c2', 'Else'),
      edge('c2', 'b1', 'B'), edge('c2', 'b2', 'Else'), edge('b1', 'j2'), edge('b2', 'j2'),
      edge('a', 'j1'), edge('j2', 'j1'),
    ]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'a')).toBeLessThan(cxOf(m, 'c2'))
    expect(cxOf(m, 'b1')).toBeLessThan(cxOf(m, 'b2'))
    expect(cxOf(m, 'j2')).toBe(cxOf(m, 'c2'))
    expect(cxOf(m, 'j1')).toBe(cxOf(m, 'c1'))
    expect(m.get('j1')!.position.y).toBeGreaterThan(m.get('j2')!.position.y)
    // The A column stays clear down to j1 (its merge edge runs there).
    expect(m.get('b1')!.position.x).toBeGreaterThan(cxOf(m, 'a') + LAYOUT.CORRIDOR + LAYOUT.GAP_X / 2)
  })

  it('lays out a user task with three outcomes in outcome order', () => {
    const nodes = [node('t', 'task_created'), node('u', 'user_task', { outcomes: ['Approve', 'Reject', 'Escalate'] }), node('ap', 'log'), node('rj', 'log'), node('es', 'log')]
    const edges = [edge('t', 'u'), edge('u', 'es', 'Escalate'), edge('u', 'ap', 'Approve'), edge('u', 'rj', 'Reject')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'ap')).toBeLessThan(cxOf(m, 'rj'))
    expect(cxOf(m, 'rj')).toBeLessThan(cxOf(m, 'es'))
  })

  it('keeps the heaviest branch on the spine when branches never re-merge', () => {
    const nodes = [node('t', 'task_created'), node('u', 'user_task', { outcomes: ['Approved', 'Rejected'] }), node('a1', 'log'), node('a2', 'log'), node('a3', 'end_workflow'), node('r', 'end_workflow')]
    const edges = [edge('t', 'u'), edge('u', 'a1', 'Approved'), edge('u', 'r', 'Rejected'), edge('a1', 'a2'), edge('a2', 'a3')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'a1')).toBe(cxOf(m, 'u'))
    expect(cxOf(m, 'r')).toBeGreaterThan(cxOf(m, 'u'))
  })

  it('fans a parallel node out and back in', () => {
    const nodes = [node('t', 'task_created'), node('p', 'parallel', { branches: [{ label: 'Email' }, { label: 'Slack' }, { label: 'Archive' }] }), node('e', 'log'), node('s', 'log'), node('a', 'log'), node('a2', 'log'), node('j', 'log')]
    const edges = [edge('t', 'p'), edge('p', 'a', 'Archive'), edge('p', 's', 'Slack'), edge('p', 'e', 'Email'), edge('e', 'j'), edge('s', 'j'), edge('a', 'a2'), edge('a2', 'j')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'e')).toBeLessThan(cxOf(m, 's'))
    expect(cxOf(m, 's')).toBeLessThan(cxOf(m, 'a'))
    expect(cxOf(m, 's')).toBe(cxOf(m, 'p'))
    expect(cxOf(m, 'j')).toBe(cxOf(m, 'p'))
    expect(m.get('j')!.position.y).toBeGreaterThan(m.get('a2')!.position.y)
  })

  it('puts a loop body to the right and Done below the body; the back-edge is excluded from rows', () => {
    const nodes = [node('t', 'task_created'), node('l', 'loop', { items: '{{rows}}' }), node('b1', 'set_variable'), node('b2', 'log'), node('d', 'end_workflow')]
    const edges = [edge('t', 'l'), edge('l', 'b1', 'Each Item'), edge('b1', 'b2'), edge('b2', 'l'), edge('l', 'd', 'Done')]
    const r = layoutWorkflow({ nodes, edges })
    const m = check(nodes, edges, r)
    expect(r.backEdges).toContain('b2->l:')
    expect(cxOf(m, 'b1')).toBeGreaterThan(cxOf(m, 'l'))
    expect(cxOf(m, 'b2')).toBe(cxOf(m, 'b1'))
    expect(cxOf(m, 'd')).toBe(cxOf(m, 'l'))
    expect(m.get('d')!.position.y).toBeGreaterThan(m.get('b2')!.position.y)
  })

  it('treats a rework back-edge as a back-edge and keeps the flow downward', () => {
    const nodes = [node('t', 'task_created'), node('u', 'user_task', { outcomes: ['Approved', 'Rework'] }), node('fix', 'update_task'), node('ok', 'log')]
    const edges = [edge('t', 'u'), edge('u', 'ok', 'Approved'), edge('u', 'fix', 'Rework'), edge('fix', 'u')]
    const r = layoutWorkflow({ nodes, edges })
    check(nodes, edges, r)
    expect(r.backEdges).toEqual(['fix->u:'])
  })

  it('ignores goto jumps for layout (the target is not pulled up)', () => {
    const nodes = [node('t', 'task_created'), node('a', 'read_csv'), node('b', 'log'), node('g', 'goto_activity', { target_node_id: 'a' })]
    const edges = [edge('t', 'a'), edge('a', 'b'), edge('b', 'g')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(m.get('a')!.position.y).toBeLessThan(m.get('b')!.position.y)
    expect(m.get('g')!.position.y).toBeGreaterThan(m.get('b')!.position.y)
    expect(cxOf(m, 'g')).toBe(cxOf(m, 'a'))
  })

  it('places workflow_error handler flows in a lane to the right of the main flow', () => {
    const nodes = [node('err', 'workflow_error'), node('t', 'task_created'), node('a', 'log'), node('b', 'log'), node('e1', 'log'), node('e2', 'send_email')]
    nodes[0].position = { x: 0, y: 20 } // error trigger drawn left of the main trigger
    const edges = [edge('t', 'a'), edge('a', 'b'), edge('err', 'e1'), edge('e1', 'e2')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'err')).toBeGreaterThan(cxOf(m, 'a') + DEFAULT_NODE_WIDTH)
    expect(m.get('err')!.position.y).toBe(LAYOUT.TRIGGER_Y)
    expect(cxOf(m, 'e2')).toBe(cxOf(m, 'err'))
  })

  it('routes error-labelled edges to the rightmost column', () => {
    const nodes = [node('t', 'task_created'), node('h', 'http_request'), node('ok', 'log'), node('fail', 'log')]
    const edges = [edge('t', 'h'), edge('h', 'fail', 'Error'), edge('h', 'ok')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'fail')).toBeGreaterThan(cxOf(m, 'ok'))
  })

  it('sizes section containers around their members and reserves header room', () => {
    const nodes = [
      node('t', 'task_created'), node('a', 'log', {}, { sectionId: 's' }), node('b', 'log', {}, { sectionId: 's' }), node('c', 'log'),
      { id: 's', type: 'section_group', label: 'Prep', config: { width: 300, height: 200 }, position: { x: 900, y: 900 } } as WorkflowNode,
    ]
    const edges = [edge('t', 'a'), edge('a', 'b'), edge('b', 'c')]
    const r = layoutWorkflow({ nodes, edges })
    const m = check(nodes, edges, r)
    const box = r.sections.s
    expect(box).toBeDefined()
    for (const id of ['a', 'b']) {
      const n = m.get(id)!
      expect(n.position.x).toBeGreaterThanOrEqual(box.x)
      expect(n.position.x + DEFAULT_NODE_WIDTH).toBeLessThanOrEqual(box.x + box.width)
      expect(n.position.y).toBeGreaterThanOrEqual(box.y + 40)
      expect(n.position.y + DEFAULT_NODE_HEIGHT).toBeLessThanOrEqual(box.y + box.height)
    }
    // Trigger and next node outside the box.
    expect(m.get('t')!.position.y + DEFAULT_NODE_HEIGHT).toBeLessThanOrEqual(box.y)
    expect(m.get('c')!.position.y).toBeGreaterThanOrEqual(box.y + box.height)
  })

  it('lays a collapsed section out as one node and moves its hidden members with it', () => {
    const nodes = [
      node('t', 'task_created'),
      { id: 's', type: 'section_group', label: 'Prep', collapsed: true, config: {}, position: { x: 700, y: 700 } } as WorkflowNode,
      { ...node('a', 'log', {}, { sectionId: 's' }), position: { x: 720, y: 760 } },
      node('c', 'log'),
    ]
    const edges = [edge('t', 'a'), edge('a', 'c')]
    const r = layoutWorkflow({ nodes, edges })
    expect(r.positions.s).toBeDefined()
    expect(r.positions.a.x - r.positions.s.x).toBe(20)
    expect(r.positions.a.y - r.positions.s.y).toBe(60)
    expect(r.positions.c.y).toBeGreaterThan(r.positions.s.y)
  })

  it('places disconnected islands and lone nodes to the right without overlap', () => {
    const nodes = [node('t', 'task_created'), node('a', 'log'), node('b', 'log'), node('i1', 'delay'), node('i2', 'log'), node('lone1', 'placeholder'), node('lone2', 'placeholder')]
    const edges = [edge('t', 'a'), edge('a', 'b'), edge('i1', 'i2')]
    const m = check(nodes, edges, layoutWorkflow({ nodes, edges }))
    expect(cxOf(m, 'i1')).toBeGreaterThan(cxOf(m, 'a') + DEFAULT_NODE_WIDTH)
    expect(cxOf(m, 'lone1')).toBeGreaterThan(cxOf(m, 'i1'))
    expect(cxOf(m, 'lone1')).toBe(cxOf(m, 'lone2'))
    expect(m.get('i1')!.position.y).toBeGreaterThanOrEqual(LAYOUT.FIRST_ROW_Y)
  })

  it('keeps nodes in their swimlanes and refits the lanes in order', () => {
    const lanes = [{ id: 'L1', y: 140, height: 300 }, { id: 'L2', y: 460, height: 300 }]
    const nodes = [
      node('t', 'task_created'),
      { ...node('a', 'log'), position: { x: 0, y: 160 } },
      { ...node('b', 'log'), position: { x: 0, y: 500 } },
      { ...node('c', 'log'), position: { x: 400, y: 180 } },
    ]
    const edges = [edge('t', 'a'), edge('a', 'b'), edge('t', 'c')]
    const r = layoutWorkflow({ nodes, edges, swimlanes: lanes })
    check(nodes, edges, r)
    const [l1, l2] = r.swimlanes
    const inLane = (id: string, l: { y: number; height: number }) => r.positions[id].y >= l.y && r.positions[id].y + DEFAULT_NODE_HEIGHT <= l.y + l.height
    expect(inLane('a', l1)).toBe(true)
    expect(inLane('c', l1)).toBe(true)
    expect(inLane('b', l2)).toBe(true)
    expect(l2.y).toBeGreaterThanOrEqual(l1.y + l1.height)
  })

  it('uses measured node sizes for the vertical rhythm', () => {
    const nodes = [node('t', 'task_created'), node('a', 'log'), node('b', 'log')]
    const edges = [edge('t', 'a'), edge('a', 'b')]
    const r = layoutWorkflow({ nodes, edges, sizes: { a: { width: 224, height: 200 } } })
    expect(r.positions.b.y - r.positions.a.y).toBeGreaterThanOrEqual(200 + LAYOUT.GAP_Y)
  })

  it('does not change ids, configs or edges', () => {
    const nodes = [node('t', 'task_created'), node('c', 'condition', cond('A')), node('a', 'log'), node('b', 'log')]
    const edges = [edge('t', 'c'), edge('c', 'a', 'A'), edge('c', 'b', 'Else')]
    const before = JSON.stringify({ nodes, edges })
    const r = layoutWorkflow({ nodes, edges })
    expect(JSON.stringify({ nodes, edges })).toBe(before)
    const laid = applyLayout(nodes, r)
    expect(laid.map((n) => [n.id, n.config])).toEqual(nodes.map((n) => [n.id, n.config]))
  })

  it('lays out a 200-node random DAG quickly with no overlaps, downward edges and ordered branches', () => {
    let seed = 42
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const nodes: WorkflowNode[] = [node('n0', 'task_created')]
    const edges: WorkflowEdge[] = []
    for (let i = 1; i < 200; i++) {
      const branching = rand() < 0.2
      nodes.push(node(`n${i}`, branching ? 'condition' : 'log', branching ? cond('Yes') : {}))
    }
    for (let i = 1; i < 200; i++) {
      const p = Math.max(0, i - 1 - Math.floor(rand() * Math.min(i, 8)))
      const src = nodes[p]
      const label = src.type === 'condition' ? (edges.some((e) => e.source === src.id && e.label === 'Yes') ? 'Else' : 'Yes') : undefined
      edges.push(edge(src.id, `n${i}`, label))
      if (rand() < 0.15 && i > 3) edges.push(edge(`n${i - 3}`, `n${i}`))
    }
    const t0 = performance.now()
    const r = layoutWorkflow({ nodes, edges })
    const ms = performance.now() - t0
    expect(ms).toBeLessThan(300)
    const m = check(nodes, edges, r)
    // Branch columns ordered: Yes left of Else wherever both targets were laid out under the condition.
    for (const n of nodes.filter((x) => x.type === 'condition')) {
      const yes = edges.find((e) => e.source === n.id && e.label === 'Yes')
      const no = edges.find((e) => e.source === n.id && e.label === 'Else')
      if (!yes || !no) continue
      const ys = m.get(yes.target)!, ns = m.get(no.target)!
      if (ys.position.y === ns.position.y && Math.abs(ys.position.y - m.get(n.id)!.position.y) < 400) {
        expect(ys.position.x).toBeLessThanOrEqual(ns.position.x)
      }
    }
  })
})

describe('layout + routing', () => {
  const n = (id: string, type: NodeType, config: Record<string, unknown> = {}): WorkflowNode => ({ id, type, label: id, config, position: { x: 0, y: 0 } })
  const e = (source: string, target: string, label?: string): WorkflowEdge => ({ id: `${source}-${target}${label ? `-${label}` : ''}`, source, target, ...(label ? { label } : {}) })
  const orthogonal = (r: EdgeRoute) => r.points.every((p, i) => i === 0 || p.x === r.points[i - 1].x || p.y === r.points[i - 1].y)
  const boxes = (nodes: WorkflowNode[], except: string[]) => nodes.filter((x) => !except.includes(x.id)).map((x) => {
    const b = nodeBox(x)
    return getBranchLabels(x).length ? { ...b, height: b.height + CHIP_AREA } : b
  })

  it('routes every edge of a tidied workflow without crossing a node', () => {
    const nodes = [
      n('t', 'task_created'), n('c', 'condition', { branches: [{ label: 'Big' }] }),
      n('u', 'user_task', { outcomes: ['Approve', 'Reject', 'Info'] }), n('a', 'log'), n('r', 'log'),
      n('i', 'log'), n('small', 'log'), n('j', 'log'), n('end', 'end_workflow'),
    ]
    const edges = [e('t', 'c'), e('c', 'u', 'Big'), e('c', 'small', 'Else'), e('u', 'a', 'Approve'), e('u', 'r', 'Reject'), e('u', 'i', 'Info'), e('i', 'u'), e('a', 'j'), e('r', 'j'), e('small', 'j'), e('j', 'end')]
    const laid = applyLayout(nodes, layoutWorkflow({ nodes, edges }))
    for (const r of routeEdges(laid, edges)) {
      expect(polylineClear(r.points, boxes(laid, [r.source, r.target])), r.id).toBe(true)
      expect(orthogonal(r), r.id).toBe(true)
    }
  })
})
