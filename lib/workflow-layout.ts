/**
 * Auto-layout ("Tidy") for workflow graphs — a top-down, business-analyst
 * readable flowchart.
 *
 * Pure: nodes + edges (+ measured node sizes, swimlanes) in, positions out.
 * Node ids, configs and edges are never touched.
 *
 * Rules
 * - Rows: longest-path layering on the forward graph (back-edges removed by a
 *   DFS from the triggers), so every forward edge points strictly downwards
 *   and a join sits below all of its branches. Triggers always form row 0
 *   (the trigger zone); rows share one vertical rhythm.
 * - Columns: a structured block layout. A chain of single-output steps stays
 *   on one vertical spine. A branching node (condition, switch, parallel,
 *   user task outcomes, any multi-output step) lays each branch out as its own
 *   column block below it, in branch-port order (config order, so "Yes /
 *   Approved" left, "Else / Default / Rejected" right, error paths last), and
 *   the branches re-merge at the branching node's immediate post-dominator,
 *   which is centred back on the spine. Nested branches recurse. Sibling
 *   blocks are packed with per-row contours so nothing overlaps and the
 *   vertical runs of merging edges stay clear.
 * - Loops: the "Each Item" body is laid out as a column to the right of the
 *   loop; "Done" continues straight down the spine below the whole body, so
 *   the back-edge has a free corridor on the right.
 * - goto_activity jumps and back-edges never affect rows.
 * - Components: the main flow first, workflow_error handler flows in a lane
 *   to the right, other islands further right, lone nodes stacked in a final
 *   column.
 * - Sections: member nodes are laid out with the flow, the container is
 *   resized around them (rows reserve room for the header); a collapsed
 *   section is laid out as one node and its hidden members move with it.
 * - Swimlanes (horizontal phase bands): a node keeps its lane; rows are
 *   grouped lane by lane and each lane band is re-fitted to its rows.
 * - Everything snaps to the 20 px canvas grid.
 */

import type { WorkflowEdge, WorkflowNode } from './workflow-schema'
import { NODE_CATALOG } from './workflow-schema'
import { branchIndexOf, getBranchLabels, orderOutgoingEdges } from './workflow-branches'
import { CHIP_AREA, DEFAULT_NODE_WIDTH, nodeBox, type SizeMap } from './workflow-edge-routing'
import { SECTION_HEADER_HEIGHT } from './workflow-sections'

export interface LayoutSwimlane {
  id: string
  y: number
  height: number
}

export interface LayoutInput {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  swimlanes?: LayoutSwimlane[]
  /** Measured card sizes (designer DOM); defaults are used for missing ids. */
  sizes?: SizeMap
}

export interface LayoutResult {
  /** New top-left position for every node that moves (all non-section nodes, collapsed sections, hidden members). */
  positions: Record<string, { x: number; y: number }>
  /** New box for every expanded section that has members. */
  sections: Record<string, { x: number; y: number; width: number; height: number }>
  /** Re-fitted swimlane bands (same ids and order as the input). */
  swimlanes: { id: string; y: number; height: number }[]
  /** Edge ids treated as back-edges (loops back up the flow). */
  backEdges: string[]
  bounds: { x: number; y: number; width: number; height: number }
}

export const LAYOUT = {
  GRID: 20,
  /** Horizontal gap between branch columns. Column pitch is rounded up to a multiple of 2 × GRID. */
  GAP_X: 80,
  /** Vertical gap between rows (below a node's card and branch chips). */
  GAP_Y: 60,
  COMPONENT_GAP: 160,
  LEFT: 40,
  TRIGGER_Y: 20,
  /** First non-trigger row starts at or below this y (trigger zone is 0–100). */
  FIRST_ROW_Y: 160,
  SECTION_PAD: 20,
  LANE_HEADER: 40,
  LANE_PAD: 20,
  /** Half-width kept free for an edge running through a row with no node. */
  CORRIDOR: 16,
  MIN_PITCH: 120,
} as const

const TRIGGER_TYPES = new Set<string>(NODE_CATALOG.filter((n) => n.category === 'trigger').map((n) => n.type))

const snap = (v: number) => Math.round(v / LAYOUT.GRID) * LAYOUT.GRID
const snapUp = (v: number, step: number = LAYOUT.GRID) => Math.ceil(v / step - 1e-9) * step
const snapDown = (v: number) => Math.floor(v / LAYOUT.GRID + 1e-9) * LAYOUT.GRID

// ─── Blocks with per-row contours ───

interface Block {
  items: { i: number; dx: number }[]
  contour: Map<number, [number, number]>
  empty: boolean
}

const newBlock = (empty = false): Block => ({ items: [], contour: new Map(), empty })

function reserve(b: Block, row: number, l: number, r: number) {
  const c = b.contour.get(row)
  if (c) { c[0] = Math.min(c[0], l); c[1] = Math.max(c[1], r) }
  else b.contour.set(row, [l, r])
}

function merge(dst: Block, src: Block, shift: number) {
  for (const it of src.items) dst.items.push({ i: it.i, dx: it.dx + shift })
  for (const [row, [l, r]] of src.contour) reserve(dst, row, l + shift, r + shift)
}

/** Left-to-right shifts for sibling blocks so that no two overlap on any row. */
function pack(blocks: Block[], gap: number, minPitch: number = LAYOUT.MIN_PITCH): number[] {
  const shifts: number[] = []
  const union = newBlock()
  blocks.forEach((b, k) => {
    if (k === 0) { shifts.push(0); merge(union, b, 0); return }
    let s = shifts[k - 1] + minPitch
    for (const [row, [l]] of b.contour) {
      const u = union.contour.get(row)
      if (u) s = Math.max(s, u[1] - l + gap)
    }
    s = snapUp(s, LAYOUT.GRID * 2)
    shifts.push(s)
    merge(union, b, s)
  })
  return shifts
}

// ─── Main entry ───

export function layoutWorkflow(input: LayoutInput): LayoutResult {
  const { nodes, edges, swimlanes = [], sizes } = input

  // Visible layout nodes: collapsed sections stand in for their hidden members.
  const collapsedSections = new Set(nodes.filter((n) => n.type === 'section_group' && n.collapsed).map((n) => n.id))
  const repOf = new Map<string, string>()
  for (const n of nodes) {
    if (n.type !== 'section_group' && n.sectionId && collapsedSections.has(n.sectionId)) repOf.set(n.id, n.sectionId)
  }
  const L = nodes.filter((n) => (n.type === 'section_group' ? n.collapsed : !repOf.has(n.id)))
  const N = L.length
  const index = new Map(L.map((n, i) => [n.id, i]))
  const W: number[] = []
  const H: number[] = [] // footprint height (card + branch chips)
  for (const n of L) {
    const box = nodeBox(n, sizes)
    W.push(box.width)
    const chips = n.type !== 'section_group' && getBranchLabels(n).length > 0
    H.push(box.height + (chips ? CHIP_AREA : 0))
  }
  const isTrigger = L.map((n) => TRIGGER_TYPES.has(n.type))

  // Resolve edges onto layout nodes.
  const outEdges: WorkflowEdge[][] = L.map(() => [])
  const seenPair = new Set<string>()
  for (const e of edges) {
    const s = repOf.get(e.source) ?? e.source
    const t = repOf.get(e.target) ?? e.target
    const si = index.get(s), ti = index.get(t)
    if (si === undefined || ti === undefined || si === ti) continue
    const key = `${si}>${ti}>${(e.label ?? '').toLowerCase()}`
    if (seenPair.has(key)) continue
    seenPair.add(key)
    outEdges[si].push(s === e.source && t === e.target ? e : { ...e, source: s, target: t })
  }
  for (let i = 0; i < N; i++) outEdges[i] = orderOutgoingEdges(L[i], outEdges[i])

  // ─── DFS: back-edges and roots ───
  const hasIncoming = new Array(N).fill(false)
  for (let i = 0; i < N; i++) for (const e of outEdges[i]) hasIncoming[index.get(e.target)!] = true
  const byPos = (a: number, b: number) => L[a].position.y - L[b].position.y || L[a].position.x - L[b].position.x
  const triggerIdx = L.map((_, i) => i).filter((i) => isTrigger[i])
  const isErrorTrigger = (i: number) => L[i].type === 'workflow_error'
  triggerIdx.sort((a, b) => Number(isErrorTrigger(a)) - Number(isErrorTrigger(b)) || L[a].position.x - L[b].position.x)
  const rootOrder = [
    ...triggerIdx,
    ...L.map((_, i) => i).filter((i) => !isTrigger[i] && !hasIncoming[i]).sort(byPos),
    ...L.map((_, i) => i).filter((i) => !isTrigger[i]).sort(byPos),
  ]
  const state = new Uint8Array(N) // 0 new, 1 on stack, 2 done
  const back = new Set<string>()
  const dfsRoots: number[] = []
  for (const root of rootOrder) {
    if (state[root]) continue
    dfsRoots.push(root)
    const stack: [number, number][] = [[root, 0]]
    state[root] = 1
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [v, k] = top
      if (k >= outEdges[v].length) { state[v] = 2; stack.pop(); continue }
      top[1]++
      const e = outEdges[v][k]
      const t = index.get(e.target)!
      if (isTrigger[t] || state[t] === 1) { back.add(e.id); continue }
      if (state[t] === 0) { state[t] = 1; stack.push([t, 0]) }
    }
  }

  // Forward successors (deduped, in port order) and predecessors.
  const succ: number[][] = L.map(() => [])
  for (let i = 0; i < N; i++) {
    for (const e of outEdges[i]) {
      if (back.has(e.id)) continue
      const t = index.get(e.target)!
      if (!succ[i].includes(t)) succ[i].push(t)
    }
  }

  // ─── Loops: body beside the loop, Done below the body ───
  interface LoopInfo { body: number[]; done: number[] }
  const loops = new Map<number, LoopInfo>()
  const extra: number[][] = L.map(() => []) // rank-only constraint edges
  for (let i = 0; i < N; i++) {
    const n = L[i]
    if (n.type !== 'loop' && n.type !== 'loop_n_times') continue
    const labels = getBranchLabels(n)
    const body: number[] = [], done: number[] = []
    for (const e of outEdges[i]) {
      if (back.has(e.id)) continue
      const t = index.get(e.target)!
      const b = branchIndexOf(labels, e, n.type)
      if (b === 0) { if (!done.includes(t)) done.push(t) }
      else if (!body.includes(t)) body.push(t)
    }
    if (body.length === 0 || done.length === 0) continue
    const doneSet = new Set(done)
    const inBody = new Set<number>()
    const queue = body.filter((t) => !doneSet.has(t))
    while (queue.length) {
      const v = queue.pop()!
      if (inBody.has(v) || v === i || doneSet.has(v)) continue
      inBody.add(v)
      for (const t of succ[v]) queue.push(t)
    }
    loops.set(i, { body: body.filter((t) => !doneSet.has(t)), done })
    for (const v of inBody) for (const d of done) extra[v].push(d)
  }

  // ─── Topological order (forward + constraints; constraints dropped if they cycle) ───
  const topo = (withExtra: boolean): number[] | null => {
    const indeg = new Array(N).fill(0)
    const adj = (i: number) => (withExtra ? [...succ[i], ...extra[i]] : succ[i])
    for (let i = 0; i < N; i++) for (const t of adj(i)) indeg[t]++
    const ready = L.map((_, i) => i).filter((i) => indeg[i] === 0)
    const out: number[] = []
    while (ready.length) {
      const v = ready.shift()!
      out.push(v)
      for (const t of adj(v)) if (--indeg[t] === 0) ready.push(t)
    }
    return out.length === N ? out : null
  }
  let order = topo(true)
  if (!order) { for (const x of extra) x.length = 0; loops.clear(); order = topo(false)! }
  const preds: number[][] = L.map(() => [])
  for (let i = 0; i < N; i++) for (const t of [...succ[i], ...extra[i]]) preds[t].push(i)

  // ─── Swimlane segments ───
  const lanes = [...swimlanes].sort((a, b) => a.y - b.y)
  const seg = L.map((n, i) => {
    if (isTrigger[i] || lanes.length === 0) return 0
    const cy = n.position.y + H[i] / 2
    let s = -1
    lanes.forEach((lane, k) => { if (lane.y <= cy) s = k })
    return s
  })

  // ─── Components (weak connectivity over all edges) ───
  const parent = L.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (let i = 0; i < N; i++) for (const e of outEdges[i]) parent[find(i)] = find(index.get(e.target)!)
  const compMembers = new Map<number, number[]>()
  for (let i = 0; i < N; i++) {
    const r = find(i)
    if (!compMembers.has(r)) compMembers.set(r, [])
    compMembers.get(r)!.push(i)
  }
  const singleton = new Array(N).fill(false)
  for (const members of compMembers.values()) if (members.length === 1 && !isTrigger[members[0]]) singleton[members[0]] = true

  // ─── Ranks (longest path, lane by lane) ───
  const rank = new Array(N).fill(0)
  const segValues = [...new Set(seg.filter((_, i) => !isTrigger[i] && !singleton[i]))].sort((a, b) => a - b)
  let laneStart = 1
  const segRows = new Map<number, [number, number]>()
  for (const s of segValues) {
    let maxRank = laneStart
    for (const v of order) {
      if (isTrigger[v] || singleton[v] || seg[v] !== s) continue
      let r = laneStart
      for (const p of preds[v]) {
        if (isTrigger[p] || seg[p] === s) r = Math.max(r, rank[p] + 1)
      }
      rank[v] = r
      maxRank = Math.max(maxRank, r)
    }
    segRows.set(s, [laneStart, maxRank])
    laneStart = maxRank + 1
  }
  for (let i = 0; i < N; i++) if (isTrigger[i]) rank[i] = 0

  // ─── Immediate post-dominators on the forward DAG (join points) ───
  const fwdOrder = topo(false)!
  const ipdom = new Array(N).fill(-1)
  const depth = new Array(N).fill(0)
  const depthOf = (v: number) => (v < 0 ? 0 : depth[v])
  const intersect = (a: number, b: number) => {
    while (a !== b) {
      if (depthOf(a) > depthOf(b)) a = ipdom[a]
      else if (depthOf(b) > depthOf(a)) b = ipdom[b]
      else { a = a < 0 ? a : ipdom[a]; b = b < 0 ? b : ipdom[b] }
    }
    return a
  }
  for (let k = fwdOrder.length - 1; k >= 0; k--) {
    const v = fwdOrder[k]
    if (succ[v].length === 0) { ipdom[v] = -1; depth[v] = 1; continue }
    let c = succ[v][0]
    for (let j = 1; j < succ[v].length; j++) c = intersect(c, succ[v][j])
    ipdom[v] = c
    depth[v] = depthOf(c) + 1
  }

  // ─── Column blocks ───
  const placed = new Array(N).fill(false)
  const place = (b: Block, i: number, dx: number) => {
    placed[i] = true
    b.items.push({ i, dx })
    reserve(b, rank[i], dx - W[i] / 2, dx + W[i] / 2)
  }
  const corridor = (b: Block, fromRow: number, toRow: number, dx = 0) => {
    for (let r = fromRow; r <= toRow; r++) reserve(b, r, dx - LAYOUT.CORRIDOR, dx + LAYOUT.CORRIDOR)
  }
  const maxRankOf = (b: Block, fallback: number) => b.items.reduce((m, it) => Math.max(m, rank[it.i]), fallback)

  const chain = (entry: number, stops: Set<number>): Block => {
    const b = newBlock()
    let cur = entry
    let lastRow = rank[entry] - 1
    while (cur >= 0 && !stops.has(cur) && !placed[cur]) {
      place(b, cur, 0)
      lastRow = rank[cur]
      const loop = loops.get(cur)
      if (loop) {
        const inner = new Set(stops)
        inner.add(cur)
        for (const d of loop.done) inner.add(d)
        const bodies: Block[] = []
        for (const t of loop.body) if (!placed[t] && !inner.has(t)) bodies.push(chain(t, inner))
        const bodyMax = bodies.reduce((m, bl) => maxRankOf(bl, m), rank[cur])
        // Keep the spine column free for the "Done" edge; the body sits to its right.
        const spine = newBlock()
        for (let r = rank[cur] + 1; r <= bodyMax; r++) reserve(spine, r, -DEFAULT_NODE_WIDTH / 2, DEFAULT_NODE_WIDTH / 2)
        const shifts = pack([spine, ...bodies], LAYOUT.GAP_X)
        bodies.forEach((bl, k) => merge(b, bl, shifts[k + 1]))
        merge(b, spine, 0)
        lastRow = bodyMax
        const next = loop.done.find((d) => !placed[d])
        cur = next ?? loop.done[0]
        continue
      }
      const out = succ[cur]
      if (out.length === 0) { cur = -1; break }
      if (out.length === 1) { cur = out[0]; continue }

      const join = ipdom[cur]
      const inner = new Set(stops)
      if (join >= 0) inner.add(join)
      const blocks: Block[] = out.map((s) => {
        if (s === join || inner.has(s) || placed[s]) {
          const e = newBlock(true)
          corridor(e, rank[cur] + 1, rank[s] - 1)
          if (e.contour.size === 0) reserve(e, rank[cur] + 1, -LAYOUT.CORRIDOR, LAYOUT.CORRIDOR)
          return e
        }
        return chain(s, inner)
      })
      const shifts = pack(blocks, LAYOUT.GAP_X)
      let anchor: number
      const emptyIdx = blocks.findIndex((bl) => bl.empty)
      if (emptyIdx >= 0) anchor = shifts[emptyIdx]
      else if (join >= 0) anchor = snap((shifts[0] + shifts[shifts.length - 1]) / 2)
      else {
        // No re-merge: keep the heaviest branch on the spine.
        let best = 0
        blocks.forEach((bl, k) => { if (bl.items.length > blocks[best].items.length) best = k })
        anchor = shifts[best]
      }
      blocks.forEach((bl, k) => merge(b, bl, shifts[k] - anchor))
      lastRow = rank[cur]
      cur = join
    }
    // The edge into the enclosing join runs down this column: keep it clear.
    if (cur >= 0 && stops.has(cur)) corridor(b, lastRow + 1, rank[cur] - 1)
    return b
  }

  // Components in reading order: main flow, error-handler flows, islands.
  const comps = [...compMembers.values()].filter((m) => !(m.length === 1 && singleton[m[0]]))
  const compKey = (m: number[]) => {
    const trig = m.filter((i) => isTrigger[i])
    if (trig.some((i) => !isErrorTrigger(i))) return [0, Math.min(...trig.filter((i) => !isErrorTrigger(i)).map((i) => L[i].position.x))]
    if (trig.length > 0) return [1, Math.min(...trig.map((i) => L[i].position.x))]
    return [2, Math.min(...m.map((i) => L[i].position.y * 10000 + L[i].position.x))]
  }
  comps.sort((a, b) => { const ka = compKey(a), kb = compKey(b); return ka[0] - kb[0] || ka[1] - kb[1] })

  const compBlocks: Block[] = []
  for (const members of comps) {
    const memberSet = new Set(members)
    const roots = [...dfsRoots.filter((r) => memberSet.has(r)), ...members]
    let cb = newBlock()
    for (const r of roots) {
      if (placed[r]) continue
      const bl = chain(r, new Set())
      if (cb.items.length === 0) { cb = bl; continue }
      const [, s] = pack([cb, bl], LAYOUT.GAP_X)
      merge(cb, bl, s)
    }
    compBlocks.push(cb)
  }
  const compShifts = pack(compBlocks, LAYOUT.COMPONENT_GAP, 0)
  const cx = new Array(N).fill(0)
  compBlocks.forEach((cb, k) => { for (const it of cb.items) cx[it.i] = it.dx + compShifts[k] })

  // ─── Rows → y ───
  const maxRank = Math.max(0, ...rank.filter((_, i) => !singleton[i]))
  const rowH = new Array(maxRank + 1).fill(0)
  for (let i = 0; i < N; i++) if (!singleton[i]) rowH[rank[i]] = Math.max(rowH[rank[i]], H[i])
  const before = new Array(maxRank + 2).fill(0)
  const after = new Array(maxRank + 2).fill(0)
  const sectionRows = new Map<string, [number, number]>()
  for (let i = 0; i < N; i++) {
    const sid = L[i].sectionId
    if (!sid || singleton[i] || L[i].type === 'section_group') continue
    const cur = sectionRows.get(sid)
    sectionRows.set(sid, cur ? [Math.min(cur[0], rank[i]), Math.max(cur[1], rank[i])] : [rank[i], rank[i]])
  }
  const expandedSections = nodes.filter((n) => n.type === 'section_group' && !n.collapsed)
  for (const s of expandedSections) {
    const rows = sectionRows.get(s.id)
    if (!rows) continue
    before[rows[0]] = Math.max(before[rows[0]], SECTION_HEADER_HEIGHT + LAYOUT.SECTION_PAD)
    after[rows[1]] = Math.max(after[rows[1]], LAYOUT.SECTION_PAD)
  }
  if (lanes.length > 0) {
    for (const [s, [a, b]] of segRows) {
      if (s < 0) continue
      before[a] = Math.max(before[a], LAYOUT.LANE_HEADER)
      after[b] = Math.max(after[b], LAYOUT.LANE_PAD)
    }
  }
  const rowTop = new Array(maxRank + 1).fill(0)
  rowTop[0] = LAYOUT.TRIGGER_Y
  for (let r = 1; r <= maxRank; r++) {
    let y = rowTop[r - 1] + rowH[r - 1] + after[r - 1] + (rowH[r - 1] > 0 || r === 1 ? LAYOUT.GAP_Y : 0) + before[r]
    if (r === 1) y = Math.max(y, LAYOUT.FIRST_ROW_Y + before[r])
    rowTop[r] = snapUp(y)
  }

  // ─── Absolute positions ───
  const placedIdx = L.map((_, i) => i).filter((i) => !singleton[i])
  const minLeft = placedIdx.length ? Math.min(...placedIdx.map((i) => cx[i] - W[i] / 2)) : 0
  const offset = snapUp(LAYOUT.LEFT - minLeft)
  const positions: Record<string, { x: number; y: number }> = {}
  const boxes: { x: number; y: number; w: number; h: number }[] = []
  for (const i of placedIdx) {
    const base = cx[i] + offset
    const x = snap(base - DEFAULT_NODE_WIDTH / 2) + (DEFAULT_NODE_WIDTH - W[i]) / 2
    const y = rowTop[rank[i]]
    positions[L[i].id] = { x, y }
    boxes.push({ x, y, w: W[i], h: H[i] })
  }
  // Lone nodes: a column to the right of everything.
  const lone = L.map((_, i) => i).filter((i) => singleton[i]).sort(byPos)
  if (lone.length) {
    const right = boxes.length ? Math.max(...boxes.map((b) => b.x + b.w)) : LAYOUT.LEFT - LAYOUT.COMPONENT_GAP
    const x0 = snapUp(right + LAYOUT.COMPONENT_GAP)
    let y = rowTop.length > 1 ? rowTop[1] : LAYOUT.FIRST_ROW_Y
    for (const i of lone) {
      positions[L[i].id] = { x: x0 + (DEFAULT_NODE_WIDTH - W[i]) / 2, y }
      boxes.push({ x: x0, y, w: W[i], h: H[i] })
      y = snapUp(y + H[i] + LAYOUT.GAP_Y / 2)
    }
  }

  // Hidden members of collapsed sections move with their section.
  for (const n of nodes) {
    const sid = repOf.get(n.id)
    if (!sid) continue
    const section = nodes.find((s) => s.id === sid)
    const to = positions[sid]
    if (!section || !to) continue
    positions[n.id] = { x: n.position.x + (to.x - section.position.x), y: n.position.y + (to.y - section.position.y) }
  }

  // ─── Section containers ───
  const sections: LayoutResult['sections'] = {}
  for (const s of expandedSections) {
    const members = L.map((_, i) => i).filter((i) => L[i].sectionId === s.id && L[i].type !== 'section_group')
    if (members.length === 0) continue
    const xs = members.map((i) => positions[L[i].id].x)
    const ys = members.map((i) => positions[L[i].id].y)
    const minX = Math.min(...xs), minY = Math.min(...ys)
    const maxX = Math.max(...members.map((i) => positions[L[i].id].x + W[i]))
    const maxY = Math.max(...members.map((i) => positions[L[i].id].y + H[i]))
    const x = snapDown(minX - LAYOUT.SECTION_PAD)
    const y = snapDown(minY - SECTION_HEADER_HEIGHT - LAYOUT.SECTION_PAD / 2)
    sections[s.id] = { x, y, width: snapUp(maxX + LAYOUT.SECTION_PAD - x), height: snapUp(maxY + LAYOUT.SECTION_PAD - y) }
  }

  // ─── Swimlanes re-fitted to their rows ───
  const laneOut: LayoutResult['swimlanes'] = []
  let prevBottom = rowTop.length > 1 ? rowTop[1] - LAYOUT.LANE_HEADER : LAYOUT.FIRST_ROW_Y - LAYOUT.LANE_HEADER
  lanes.forEach((lane, k) => {
    const rows = segRows.get(k)
    if (rows && rows[0] <= maxRank) {
      const y = snapDown(rowTop[rows[0]] - LAYOUT.LANE_HEADER + 4)
      const bottom = rowTop[rows[1]] + rowH[rows[1]] + LAYOUT.LANE_PAD
      laneOut.push({ id: lane.id, y, height: snapUp(bottom - y) })
      prevBottom = y + snapUp(bottom - y)
    } else {
      const y = snapUp(prevBottom + LAYOUT.GRID)
      laneOut.push({ id: lane.id, y, height: lane.height })
      prevBottom = y + lane.height
    }
  })
  // Keep caller's lane order.
  const laneById = new Map(laneOut.map((l) => [l.id, l]))
  const swimOut = swimlanes.map((l) => laneById.get(l.id)!).filter(Boolean)

  const allBoxes = [...boxes, ...Object.values(sections).map((s) => ({ x: s.x, y: s.y, w: s.width, h: s.height }))]
  const bx = allBoxes.length ? Math.min(...allBoxes.map((b) => b.x)) : 0
  const by = allBoxes.length ? Math.min(...allBoxes.map((b) => b.y)) : 0
  const bw = allBoxes.length ? Math.max(...allBoxes.map((b) => b.x + b.w)) - bx : 0
  const bh = allBoxes.length ? Math.max(...allBoxes.map((b) => b.y + b.h)) - by : 0

  return { positions, sections, swimlanes: swimOut, backEdges: [...back], bounds: { x: bx, y: by, width: bw, height: bh } }
}

/** Convenience for tests and callers: apply a layout result to a node list (positions + section sizes). */
export function applyLayout(nodes: WorkflowNode[], result: LayoutResult): WorkflowNode[] {
  return nodes.map((n) => {
    const box = result.sections[n.id]
    if (box) return { ...n, position: { x: box.x, y: box.y }, config: { ...n.config, width: box.width, height: box.height } }
    const p = result.positions[n.id]
    return p ? { ...n, position: p } : n
  })
}

