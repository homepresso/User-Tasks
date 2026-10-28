/**
 * Connector anchors and orthogonal routing for workflow graphs.
 *
 * Pure geometry shared by the designer canvas (EdgeRenderer), the run
 * viewer, the test runner and the process overview so every surface draws
 * the same lines:
 *
 * - forward flow leaves the bottom-centre of the source (or its branch port)
 *   and enters the top of the target; several edges into one node get evenly
 *   spaced top ports sorted by where they come from, so they never stack;
 * - branch ports are evenly spaced along the bottom edge in branch order;
 * - back-edges (loops), goto jumps and error paths leave and enter from the
 *   right side and run up a free vertical corridor beside the nodes;
 * - a target beside the source (manual layouts) is entered from the facing side;
 * - every route is orthogonal with rounded corners, and ends exactly on the
 *   target border so the arrowhead tip touches it.
 */

import type { WorkflowEdge, WorkflowNode } from './workflow-schema'
import { branchIndexOf, getBranchLabels, isErrorEdge } from './workflow-branches'

export interface Point { x: number; y: number }
export interface Box { x: number; y: number; width: number; height: number }
export type Side = 'top' | 'bottom' | 'left' | 'right'
export type RouteKind = 'forward' | 'back' | 'side' | 'goto' | 'error'

export interface EdgeRoute {
  id: string
  source: string
  target: string
  kind: RouteKind
  points: Point[]
  path: string
  sourceSide: Side
  targetSide: Side
  /** Branch port index on the source (-1 when the edge leaves a plain output). */
  branchIndex: number
  /** Centre of the edge label: on the straight segment just below/after the source port. */
  labelX: number
  labelY: number
  /** Whether the label sits on a vertical run (plain-text labels go beside it) or a horizontal one (above it). */
  labelVertical: boolean
}

export const DEFAULT_NODE_WIDTH = 224
export const DEFAULT_NODE_HEIGHT = 88
export const COLLAPSED_NODE_WIDTH = 160
export const COLLAPSED_NODE_HEIGHT = 36
/** Branch chips sit this far below the card, CHIP_HEIGHT tall. */
export const CHIP_OFFSET = 8
export const CHIP_HEIGHT = 20
/** Extra height a branching node occupies below its card (the chip row). */
export const CHIP_AREA = CHIP_OFFSET + CHIP_HEIGHT
const SECTION_COLLAPSED_W = 240
const SECTION_HEADER_H = 40

const CORNER = 8
const STUB = 16 // first/last straight run out of a port
const CLEAR = 10 // clearance kept around nodes
const LANE_STEP = 14 // spacing between parallel corridor lanes

export type SizeMap = Record<string, { width: number; height: number } | undefined>

/** Box of a node on the canvas, using measured sizes when known. */
export function nodeBox(node: Pick<WorkflowNode, 'id' | 'type' | 'position' | 'collapsed' | 'config'>, sizes?: SizeMap): Box {
  if (node.type === 'section_group') {
    return node.collapsed
      ? { x: node.position.x, y: node.position.y, width: SECTION_COLLAPSED_W, height: SECTION_HEADER_H }
      : { x: node.position.x, y: node.position.y, width: node.config?.width ?? 500, height: node.config?.height ?? 300 }
  }
  const s = sizes?.[node.id]
  const width = s?.width ?? (node.collapsed ? COLLAPSED_NODE_WIDTH : DEFAULT_NODE_WIDTH)
  const height = s?.height ?? (node.collapsed ? COLLAPSED_NODE_HEIGHT : DEFAULT_NODE_HEIGHT)
  return { x: node.position.x, y: node.position.y, width, height }
}

/** Centre x offsets (relative to the node's left edge) of `count` evenly spaced branch ports. */
export function branchPortOffsets(width: number, count: number): number[] {
  if (count <= 0) return []
  const slot = width / count
  return Array.from({ length: count }, (_, i) => slot * (i + 0.5))
}

/** Width available to one branch chip (so chips never overlap). */
export function branchChipMaxWidth(width: number, count: number): number {
  return Math.max(24, Math.floor(width / Math.max(1, count)) - 4)
}

/** Evenly spaced top-port x positions for `count` incoming edges on a node `width` wide, centred on `cx`. */
export function topPortXs(cx: number, width: number, count: number): number[] {
  if (count <= 1) return [cx]
  const spacing = Math.min(24, (width - 40) / (count - 1))
  return Array.from({ length: count }, (_, i) => cx + (i - (count - 1) / 2) * spacing)
}

/** SVG path through orthogonal points with rounded corners. */
export function roundedPath(points: Point[], radius = CORNER): string {
  if (points.length === 0) return ''
  const pts = simplify(points)
  let d = `M ${r1(pts[0].x)} ${r1(pts[0].y)}`
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1], p = pts[i], p1 = pts[i + 1]
    const inLen = Math.hypot(p.x - p0.x, p.y - p0.y)
    const outLen = Math.hypot(p1.x - p.x, p1.y - p.y)
    const r = Math.min(radius, inLen / 2, outLen / 2)
    const a = { x: p.x - ((p.x - p0.x) / (inLen || 1)) * r, y: p.y - ((p.y - p0.y) / (inLen || 1)) * r }
    const b = { x: p.x + ((p1.x - p.x) / (outLen || 1)) * r, y: p.y + ((p1.y - p.y) / (outLen || 1)) * r }
    d += ` L ${r1(a.x)} ${r1(a.y)} Q ${r1(p.x)} ${r1(p.y)} ${r1(b.x)} ${r1(b.y)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${r1(last.x)} ${r1(last.y)}`
  return d
}

const r1 = (v: number) => Math.round(v * 10) / 10

/** Drop duplicate and collinear points. */
export function simplify(points: Point[]): Point[] {
  const out: Point[] = []
  for (const p of points) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue
    out.push({ x: p.x, y: p.y })
    while (out.length >= 3) {
      const a = out[out.length - 3], b = out[out.length - 2], c = out[out.length - 1]
      const collinear = (Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)
      if (!collinear) break
      out.splice(out.length - 2, 1)
    }
  }
  return out
}

// ─── Obstacle geometry ───

function inflate(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 }
}

function vSegHits(x: number, y0: number, y1: number, b: Box): boolean {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1)
  return x > b.x && x < b.x + b.width && hi > b.y && lo < b.y + b.height
}

function hSegHits(y: number, x0: number, x1: number, b: Box): boolean {
  const lo = Math.min(x0, x1), hi = Math.max(x0, x1)
  return y > b.y && y < b.y + b.height && hi > b.x && lo < b.x + b.width
}

/** True when the orthogonal polyline crosses none of the boxes. */
export function polylineClear(points: Point[], boxes: Box[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    for (const box of boxes) {
      if (Math.abs(a.x - b.x) < 0.5) { if (vSegHits(a.x, a.y, b.y, box)) return false }
      else if (Math.abs(a.y - b.y) < 0.5) { if (hSegHits(a.y, a.x, b.x, box)) return false }
    }
  }
  return true
}

interface UsedLane { x: number; y0: number; y1: number }

/** First x at or beyond `start` (moving in `dir`) whose vertical run over [y0, y1] is free of boxes and other lanes. */
function findLane(start: number, dir: 1 | -1, y0: number, y1: number, boxes: Box[], used: UsedLane[]): number {
  const lo = Math.min(y0, y1), hi = Math.max(y0, y1)
  const band = boxes.filter((b) => b.y < hi && b.y + b.height > lo)
  let x = start
  for (let guard = 0; guard < 500; guard++) {
    let moved = false
    for (const b of band) {
      if (x > b.x - CLEAR && x < b.x + b.width + CLEAR) {
        x = dir > 0 ? b.x + b.width + CLEAR + STUB : b.x - CLEAR - STUB
        moved = true
      }
    }
    for (const l of used) {
      if (Math.abs(l.x - x) < LANE_STEP - 0.5 && l.y0 < hi && l.y1 > lo) {
        x = l.x + dir * LANE_STEP
        moved = true
      }
    }
    if (!moved) break
  }
  return x
}

// ─── Routing ───

interface Prepared {
  edge: WorkflowEdge
  kind: RouteKind
  src: Box
  /** Source card plus its chip row. */
  foot: Box
  tgt: Box
  sx: number
  sy: number
  sourceSide: Side
  branchIndex: number
  hasLabel: boolean
}

export type RouteNode = Pick<WorkflowNode, 'id' | 'type' | 'position' | 'config' | 'collapsed'>

export interface RouteOptions {
  sizes?: SizeMap
  /** Also route goto_activity jumps (config.target_node_id) as dashed side edges. Default true. */
  gotos?: boolean
  /** When false, branch ports are ignored (all edges leave the bottom centre). Default true. */
  branchPorts?: boolean
  /**
   * Whether the surface draws branch chips under branching cards (the
   * designer does). Without chips (run viewer, previews) branch ports sit
   * on the card's bottom edge itself. Default true.
   */
  chips?: boolean
}

/** Edge-id prefix of the synthetic goto jump routes. */
export const GOTO_ROUTE_PREFIX = 'goto:'

/**
 * Route every edge (plus goto jumps). Edges whose endpoints are missing are skipped.
 * Deterministic: same input, same output.
 */
export function routeEdges(nodes: RouteNode[], edges: WorkflowEdge[], options: RouteOptions = {}): EdgeRoute[] {
  const { sizes, gotos = true, branchPorts = true, chips = true } = options
  const chipArea = chips ? CHIP_AREA : 0
  const byId = new Map<string, RouteNode>()
  const boxes = new Map<string, Box>()
  const feet = new Map<string, Box>() // card + chip row
  const labelsOf = new Map<string, string[]>()
  for (const n of nodes) {
    byId.set(n.id, n)
    const box = nodeBox(n, sizes)
    boxes.set(n.id, box)
    const labels = branchPorts && n.type !== 'section_group' ? getBranchLabels(n) : []
    labelsOf.set(n.id, labels)
    feet.set(n.id, labels.length > 0 ? { ...box, height: box.height + chipArea } : box)
  }
  // Expanded sections are containers, not obstacles.
  const obstacleIds = nodes.filter((n) => !(n.type === 'section_group' && !n.collapsed)).map((n) => n.id)
  const obstaclesExcept = (a: string, b: string) => obstacleIds.filter((id) => id !== a && id !== b).map((id) => inflate(feet.get(id)!, 4))

  const all: WorkflowEdge[] = [...edges]
  if (gotos) {
    for (const n of nodes) {
      const target = n.type === 'goto_activity' ? n.config?.target_node_id : null
      if (target && byId.has(target) && target !== n.id) {
        all.push({ id: `${GOTO_ROUTE_PREFIX}${n.id}`, source: n.id, target, label: 'Go to' })
      }
    }
  }

  // Pass 1 — source anchors and route kind.
  const prepared: Prepared[] = []
  for (const edge of all) {
    const s = byId.get(edge.source), t = byId.get(edge.target)
    if (!s || !t || s.id === t.id) continue
    const src = boxes.get(s.id)!, tgt = boxes.get(t.id)!
    const foot = feet.get(s.id)!
    const isGoto = edge.id.startsWith(GOTO_ROUTE_PREFIX)
    const labels = labelsOf.get(s.id)!
    const branchIndex = isGoto ? -1 : branchIndexOf(labels, edge, s.type)
    const hasLabel = !!edge.label && branchIndex < 0
    let kind: RouteKind
    let sx: number, sy: number, sourceSide: Side

    if (isGoto) {
      kind = 'goto'; sourceSide = 'right'; sx = src.x + src.width; sy = src.y + src.height / 2
    } else if (isErrorEdge(edge) || edge.sourcePort === 'right' || edge.sourcePort === 'left') {
      const left = edge.sourcePort === 'left'
      sourceSide = left ? 'left' : 'right'
      sx = left ? src.x : src.x + src.width
      sy = src.y + src.height / 2
      const below = tgt.y >= src.y + src.height + STUB
      kind = below ? (isErrorEdge(edge) ? 'error' : 'side') : (left ? (tgt.x + tgt.width < src.x ? 'side' : 'back') : (tgt.x > src.x + src.width ? 'side' : 'back'))
      if (kind === 'side' && below) kind = isErrorEdge(edge) ? 'error' : 'side'
    } else {
      sourceSide = 'bottom'
      if (branchIndex >= 0) {
        sx = src.x + branchPortOffsets(src.width, labels.length)[branchIndex]
        sy = src.y + src.height + chipArea
      } else {
        sx = src.x + src.width / 2
        sy = labels.length > 0 ? foot.y + foot.height : src.y + src.height
      }
      // Below → forward. Not below but clear to one side (beside, or up a
      // neighbouring column) → straight across between the facing sides.
      // Above in the same column → round the right side.
      if (tgt.y >= sy + STUB) kind = 'forward'
      else if (tgt.x > src.x + src.width + 24 || tgt.x + tgt.width < src.x - 24) kind = 'side'
      else kind = 'back'
      if (kind === 'side') {
        const right = tgt.x > src.x
        sourceSide = right ? 'right' : 'left'
        sx = right ? src.x + src.width : src.x
        sy = src.y + src.height / 2
      } else if (kind === 'back') {
        sourceSide = 'right'
        sx = src.x + src.width
        sy = src.y + src.height / 2
      }
    }
    prepared.push({ edge, kind, src, foot, tgt, sx, sy, sourceSide, branchIndex, hasLabel })
  }

  // Pass 2 — evenly spaced top ports for nodes with several incoming forward edges.
  const incoming = new Map<string, Prepared[]>()
  for (const p of prepared) {
    if (p.kind !== 'forward' && p.kind !== 'error') continue
    const list = incoming.get(p.edge.target) ?? []
    list.push(p)
    incoming.set(p.edge.target, list)
  }
  const topX = new Map<Prepared, number>()
  for (const [targetId, list] of incoming) {
    const tgt = boxes.get(targetId)!
    const sorted = [...list].sort((a, b) => a.sx - b.sx || a.sy - b.sy)
    const xs = topPortXs(tgt.x + tgt.width / 2, tgt.width, sorted.length)
    sorted.forEach((p, i) => topX.set(p, xs[i]))
  }

  // Pass 3 — routes. Corridor routes register their lanes so parallel ones fan out.
  const used: UsedLane[] = []
  const usedH: UsedRun[] = []
  const routes: EdgeRoute[] = []
  // Route short edges first so long corridor edges go around them.
  const order = [...prepared].sort((a, b) => kindRank(a.kind) - kindRank(b.kind))
  for (const p of order) {
    const obstacles = obstaclesExcept(p.edge.source, p.edge.target)
    let points: Point[]
    let targetSide: Side
    if (p.kind === 'forward') {
      targetSide = 'top'
      points = routeForward(p, topX.get(p) ?? p.tgt.x + p.tgt.width / 2, obstacles, usedH)
    } else if (p.kind === 'error') {
      targetSide = 'top'
      points = routeErrorDown(p, topX.get(p) ?? p.tgt.x + p.tgt.width / 2, obstacles)
    } else if (p.kind === 'side') {
      const intoLeft = p.sourceSide === 'right'
      targetSide = intoLeft ? 'left' : 'right'
      const tx = intoLeft ? p.tgt.x : p.tgt.x + p.tgt.width
      const ty = p.tgt.y + p.tgt.height / 2
      const midX = (p.sx + tx) / 2
      points = [{ x: p.sx, y: p.sy }, { x: midX, y: p.sy }, { x: midX, y: ty }, { x: tx, y: ty }]
      if (!polylineClear(points, obstacles)) {
        points = routeAround(p, obstacles, used)
        targetSide = 'right'
      }
    } else {
      targetSide = 'right'
      points = routeAround(p, obstacles, used)
    }
    points = simplify(points)
    const label = labelPoint(points, p)
    routes.push({
      id: p.edge.id,
      source: p.edge.source,
      target: p.edge.target,
      kind: p.kind,
      points,
      path: roundedPath(points),
      sourceSide: p.sourceSide,
      targetSide,
      branchIndex: p.branchIndex,
      labelX: label.x,
      labelY: label.y,
      labelVertical: label.vertical,
    })
  }
  // Keep the caller's edge order (render order) stable.
  const rank = new Map(all.map((e, i) => [e.id, i]))
  routes.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
  return routes
}

function kindRank(kind: RouteKind): number {
  return kind === 'forward' ? 0 : kind === 'error' ? 1 : kind === 'side' ? 2 : kind === 'back' ? 3 : 4
}

interface UsedRun { y: number; x0: number; x1: number }

const RUN_STEP = 8

function runOverlaps(y: number, xa: number, xb: number, runs: UsedRun[]): boolean {
  const lo = Math.min(xa, xb), hi = Math.max(xa, xb)
  if (hi - lo < 1) return false
  return runs.some((r) => Math.abs(r.y - y) < 3 && Math.min(hi, r.x1) - Math.max(lo, r.x0) > 2)
}

/** Register the horizontal runs of a route so later routes don't run along them. */
function addRuns(points: Point[], runs: UsedRun[]) {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i]
    if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) >= 1) runs.push({ y: a.y, x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x) })
  }
}

/** Bottom → top: down, across in the gap, down into the target's top port. */
function routeForward(p: Prepared, tx: number, obstacles: Box[], runs: UsedRun[]): Point[] {
  const pts = routeForwardRaw(p, tx, obstacles, runs)
  addRuns(pts, runs)
  return pts
}

function routeForwardRaw(p: Prepared, tx: number, obstacles: Box[], runs: UsedRun[]): Point[] {
  const { sx, sy } = p
  const ty = p.tgt.y
  if (Math.abs(sx - tx) < 1) {
    const straight = [{ x: sx, y: sy }, { x: tx, y: ty }]
    if (polylineClear(straight, obstacles)) return straight
  }
  let y1 = sy + (p.branchIndex >= 0 ? 20 : p.hasLabel ? 32 : STUB)
  let y2 = ty - 20
  if (y1 > y2) { y1 = y2 = Math.round((sy + ty) / 2) }
  const build = (cx: number, a = y1, b = y2): Point[] => [
    { x: sx, y: sy }, { x: sx, y: a }, { x: cx, y: a }, { x: cx, y: b }, { x: tx, y: b }, { x: tx, y: ty },
  ]
  // Shift a horizontal run off another route's run (same y, overlapping x) within the gap.
  const stagger = (cx: number): Point[] => {
    let a = y1, b = y2
    for (let k = 0; k < 4 && runOverlaps(a, sx, cx, runs) && a + RUN_STEP < b - RUN_STEP; k++) a += RUN_STEP
    for (let k = 0; k < 4 && runOverlaps(b, cx, tx, runs) && b - RUN_STEP > a + RUN_STEP; k++) b -= RUN_STEP
    const pts = build(cx, a, b)
    return polylineClear(pts, obstacles) ? pts : build(cx)
  }
  // Branch ports fan out right away (turn near the source); plain outputs run
  // down their own column and turn just above the target (a join).
  const preferred = p.branchIndex >= 0 ? [tx, sx] : [sx, tx]
  for (const cx of preferred) {
    const pts = build(cx)
    if (polylineClear(pts, obstacles)) return stagger(cx)
  }
  // Both direct columns are blocked: find a free corridor between them.
  const lo = Math.min(y1, y2), hi = Math.max(y1, y2)
  const mid = (sx + tx) / 2
  const candidates: number[] = []
  for (const b of obstacles) {
    if (b.y < hi && b.y + b.height > lo) candidates.push(b.x - CLEAR, b.x + b.width + CLEAR)
  }
  candidates.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))
  for (const cx of candidates) {
    const pts = build(cx)
    if (polylineClear(pts, obstacles)) return stagger(cx)
  }
  return build(preferred[0])
}

/** Right side → across → down into the target top (error lane to the right). */
function routeErrorDown(p: Prepared, tx: number, obstacles: Box[]): Point[] {
  const { sx, sy } = p
  const ty = p.tgt.y
  const dir = p.sourceSide === 'left' ? -1 : 1
  if ((dir > 0 && tx > sx + STUB) || (dir < 0 && tx < sx - STUB)) {
    const pts = [{ x: sx, y: sy }, { x: tx, y: sy }, { x: tx, y: ty }]
    if (polylineClear(pts, obstacles)) return pts
  }
  const out = sx + dir * STUB
  const y2 = ty - 20
  const pts = [{ x: sx, y: sy }, { x: out, y: sy }, { x: out, y: y2 }, { x: tx, y: y2 }, { x: tx, y: ty }]
  if (polylineClear(pts, obstacles)) return pts
  const lane = findLane(out, dir as 1 | -1, sy, y2, obstacles, [])
  return [{ x: sx, y: sy }, { x: lane, y: sy }, { x: lane, y: y2 }, { x: tx, y: y2 }, { x: tx, y: ty }]
}

/**
 * Side corridor route (back-edges, gotos, blocked side edges): out of the
 * source's side, along a free vertical lane beside the nodes, into the
 * target's right side. When the straight run out of / into a side is
 * blocked (another node in the same row), detour through the row gap.
 */
function routeAround(p: Prepared, obstacles: Box[], used: UsedLane[]): Point[] {
  const dir: 1 | -1 = p.sourceSide === 'left' ? -1 : 1
  const sx = p.sourceSide === 'left' ? p.src.x : p.src.x + p.src.width
  const sy = p.src.y + p.src.height / 2
  const tx = p.tgt.x + p.tgt.width
  const ty = p.tgt.y + p.tgt.height / 2

  // Exit: straight out, or (if a neighbour sits in the same row) via the gap below the source.
  const exitBelow = p.foot.y + p.foot.height + STUB
  // Entry: straight in, or via the gap above the target.
  const entryAbove = p.tgt.y - STUB

  const tryRoute = (exitVia: boolean, entryVia: boolean): Point[] | null => {
    const start: Point[] = exitVia
      ? [{ x: sx, y: sy }, { x: sx + dir * STUB, y: sy }, { x: sx + dir * STUB, y: exitBelow }]
      : [{ x: sx, y: sy }]
    const end: Point[] = entryVia
      ? [{ x: tx + STUB, y: entryAbove }, { x: tx + STUB, y: ty }, { x: tx, y: ty }]
      : [{ x: tx, y: ty }]
    const yA = start[start.length - 1].y
    const yB = end[0].y
    const laneStart = dir > 0
      ? Math.max(sx, tx) + STUB + 8
      : Math.min(sx, p.tgt.x) - STUB - 8
    const lane = findLane(laneStart, dir, Math.min(yA, yB, sy, ty), Math.max(yA, yB, sy, ty), obstacles, used)
    // A left-going lane still enters the target's right side; go round the target's top.
    const pts: Point[] = [...start, { x: lane, y: yA }, { x: lane, y: yB }, ...end]
    if (dir < 0 && !entryVia) {
      pts.splice(pts.length - 1, 1, { x: lane, y: entryAbove }, { x: tx + STUB, y: entryAbove }, { x: tx + STUB, y: ty }, { x: tx, y: ty })
    }
    if (!polylineClear(simplify(pts), obstacles)) return null
    used.push({ x: lane, y0: Math.min(yA, yB), y1: Math.max(yA, yB) })
    return pts
  }

  return tryRoute(false, false) ?? tryRoute(true, false) ?? tryRoute(false, true) ?? tryRoute(true, true) ?? (() => {
    const lane = findLane(Math.max(sx, tx) + STUB + 8, 1, Math.min(sy, ty), Math.max(sy, ty), obstacles, used)
    used.push({ x: lane, y0: Math.min(sy, ty), y1: Math.max(sy, ty) })
    return [{ x: sx, y: sy }, { x: lane, y: sy }, { x: lane, y: ty }, { x: tx, y: ty }]
  })()
}

/**
 * Label centre: on the straight segment just after the source port; for
 * corridor routes on the corridor, for side routes on their longest run
 * (between the two cards rather than over either). `vertical` tells
 * surfaces drawing plain text which way the segment runs.
 */
function labelPoint(points: Point[], p: Prepared): Point & { vertical: boolean } {
  if (points.length < 2) return { ...(points[0] ?? { x: 0, y: 0 }), vertical: true }
  const longest = (verticalOnly: boolean) => {
    let best = 1, bestLen = -1
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i]
      const vertical = Math.abs(a.x - b.x) < 0.5
      if (verticalOnly && !vertical) continue
      const len = Math.abs(a.y - b.y) + Math.abs(a.x - b.x)
      if (len > bestLen) { bestLen = len; best = i }
    }
    const a = points[best - 1], b = points[best]
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, vertical: Math.abs(a.x - b.x) < 0.5 }
  }
  if (p.kind === 'back' || p.kind === 'goto') return longest(true)
  if (p.kind === 'side' || p.kind === 'error') return longest(false)
  const a = points[0], b = points[1]
  if (Math.abs(a.x - b.x) < 0.5) {
    const len = Math.abs(b.y - a.y)
    return { x: a.x, y: a.y + Math.sign(b.y - a.y || 1) * Math.min(16, len / 2), vertical: true }
  }
  const len = Math.abs(b.x - a.x)
  return { x: a.x + Math.sign(b.x - a.x || 1) * Math.min(40, len / 2), y: a.y, vertical: false }
}

// ─── Selection UI ───

export const DELETE_BUTTON_SIZE = 22
const DELETE_GAP = 6

/** Distance from point p to segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Smallest distance from p to any segment of the route. */
export function distanceToRoute(p: Point, points: Point[]): number {
  let d = Infinity
  for (let i = 1; i < points.length; i++) d = Math.min(d, distanceToSegment(p, points[i - 1], points[i]))
  return d
}

/**
 * Where the delete button of a selected connection goes: beside the label
 * badge (or the label point), with a clear gap from every segment of the
 * line so clicking the line never hits the button.
 */
export function deleteButtonPosition(route: EdgeRoute, labelW: number, size: number = DELETE_BUTTON_SIZE): Point {
  const { labelX: x, labelY: y, points } = route
  const r = size / 2
  const half = Math.max(labelW / 2, 4)
  const halfH = labelW > 0 ? 8 : 4
  const candidates: Point[] = [
    { x: x + half + DELETE_GAP + r, y },
    { x: x - half - DELETE_GAP - r, y },
    { x, y: y + halfH + DELETE_GAP + r },
    { x, y: y - halfH - DELETE_GAP - r },
    { x: x + half + DELETE_GAP + r, y: y + halfH + DELETE_GAP + r },
    { x: x + half + DELETE_GAP + r, y: y - halfH - DELETE_GAP - r },
  ]
  const clearance = r + DELETE_GAP
  return candidates.find((c) => distanceToRoute(c, points) >= clearance)
    ?? candidates.reduce((best, c) => (distanceToRoute(c, points) > distanceToRoute(best, points) ? c : best))
}
