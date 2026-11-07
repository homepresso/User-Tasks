/**
 * Pure tree layout for the Organization charts (people, org units).
 * Client-safe, no React.
 *
 * Only expanded subtrees are laid out: a collapsed node's descendants cost
 * nothing, so a 2,000-person org renders as many nodes as are open. Layout:
 *  - a node with visible children that themselves have children is laid
 *    out "tree" style: children side by side, the parent centred above;
 *  - a node whose visible children are all leaves (the usual team of
 *    individual contributors) and that has GRID_MIN or more of them
 *    stacks them in a compact grid under the parent, so one manager with
 *    60 reports doesn't make the chart 15,000px wide.
 * Edges are orthogonal polylines (parent bottom → child top).
 */

export const NODE_W = 232
export const NODE_H = 76
export const H_GAP = 24
export const V_GAP = 56
export const ROOT_GAP = 48
export const GRID_MIN = 4
export const GRID_GAP_X = 20
export const GRID_GAP_Y = 24
export const GRID_INDENT = 28

export interface ChartTree {
  roots: readonly string[]
  childrenOf: ReadonlyMap<string, readonly string[]>
}

export interface PlacedNode {
  id: string
  x: number
  y: number
  depth: number
  parentId: string | null
}

export interface ChartEdge {
  from: string
  to: string
  points: Array<[number, number]>
}

export interface ChartLayout {
  nodes: PlacedNode[]
  byId: Map<string, PlacedNode>
  edges: ChartEdge[]
  width: number
  height: number
}

interface Size { w: number; h: number; mode: 'leaf' | 'tree' | 'grid'; cols: number; kids: string[] }

export function gridColumns(count: number): number {
  if (count <= 6) return 2
  if (count <= 15) return 3
  return 4
}

/** Lay out the visible part of the forest (expanded nodes show their children). */
export function layoutChart(tree: ChartTree, expanded: ReadonlySet<string>): ChartLayout {
  const sizes = new Map<string, Size>()
  const visibleKids = (id: string): string[] => (expanded.has(id) ? [...(tree.childrenOf.get(id) ?? [])] : [])

  // Post-order measure, iterative (deep chains must not overflow the stack), cycle-safe.
  const measure = (rootId: string) => {
    const stack: Array<{ id: string; done: boolean }> = [{ id: rootId, done: false }]
    const onPath = new Set<string>()
    while (stack.length) {
      const top = stack[stack.length - 1]
      if (sizes.has(top.id)) { stack.pop(); continue }
      if (!top.done) {
        top.done = true
        onPath.add(top.id)
        for (const kid of visibleKids(top.id)) if (!sizes.has(kid) && !onPath.has(kid)) stack.push({ id: kid, done: false })
        continue
      }
      stack.pop()
      onPath.delete(top.id)
      const kids = visibleKids(top.id).filter((k) => sizes.has(k))
      if (!kids.length) { sizes.set(top.id, { w: NODE_W, h: NODE_H, mode: 'leaf', cols: 0, kids }); continue }
      const allLeaves = kids.every((k) => sizes.get(k)!.mode === 'leaf')
      if (allLeaves && kids.length >= GRID_MIN) {
        const cols = gridColumns(kids.length)
        const rows = Math.ceil(kids.length / cols)
        const w = Math.max(NODE_W, GRID_INDENT + cols * NODE_W + (cols - 1) * GRID_GAP_X)
        const h = NODE_H + V_GAP / 2 + GRID_GAP_Y + rows * NODE_H + (rows - 1) * GRID_GAP_Y
        sizes.set(top.id, { w, h, mode: 'grid', cols, kids })
        continue
      }
      const childW = kids.reduce((sum, k) => sum + sizes.get(k)!.w, 0) + (kids.length - 1) * H_GAP
      const childH = Math.max(...kids.map((k) => sizes.get(k)!.h))
      sizes.set(top.id, { w: Math.max(NODE_W, childW), h: NODE_H + V_GAP + childH, mode: 'tree', cols: 0, kids })
    }
  }

  const nodes: PlacedNode[] = []
  const byId = new Map<string, PlacedNode>()
  const edges: ChartEdge[] = []
  const place = (rootId: string, left0: number) => {
    const stack: Array<{ id: string; left: number; top: number; depth: number; parentId: string | null }> = [{ id: rootId, left: left0, top: 0, depth: 0, parentId: null }]
    while (stack.length) {
      const { id, left, top, depth, parentId } = stack.pop()!
      if (byId.has(id)) continue
      const size = sizes.get(id)
      if (!size) continue
      const x = size.mode === 'grid' ? left + (size.w - NODE_W) / 2 : left + (size.w - NODE_W) / 2
      const node: PlacedNode = { id, x, y: top, depth, parentId }
      nodes.push(node)
      byId.set(id, node)
      const px = x + NODE_W / 2
      const pBottom = top + NODE_H
      if (size.mode === 'tree') {
        let cursor = left + (size.w - (size.kids.reduce((s, k) => s + sizes.get(k)!.w, 0) + (size.kids.length - 1) * H_GAP)) / 2
        const childTop = pBottom + V_GAP
        const midY = pBottom + V_GAP / 2
        for (const kid of size.kids) {
          const ks = sizes.get(kid)!
          const cx = cursor + ks.w / 2
          edges.push({ from: id, to: kid, points: [[px, pBottom], [px, midY], [cx, midY], [cx, childTop]] })
          stack.push({ id: kid, left: cursor, top: childTop, depth: depth + 1, parentId: id })
          cursor += ks.w + H_GAP
        }
      } else if (size.mode === 'grid') {
        const gridW = GRID_INDENT + size.cols * NODE_W + (size.cols - 1) * GRID_GAP_X
        const gridLeft = left + (size.w - gridW) / 2 + GRID_INDENT
        const spineX = gridLeft - GRID_INDENT / 2
        const gridTop = pBottom + V_GAP / 2 + GRID_GAP_Y
        size.kids.forEach((kid, i) => {
          const col = i % size.cols
          const row = Math.floor(i / size.cols)
          const kx = gridLeft + col * (NODE_W + GRID_GAP_X)
          const ky = gridTop + row * (NODE_H + GRID_GAP_Y)
          const busY = ky - GRID_GAP_Y / 2
          const cx = kx + NODE_W / 2
          edges.push({ from: id, to: kid, points: [[px, pBottom], [px, pBottom + V_GAP / 4], [spineX, pBottom + V_GAP / 4], [spineX, busY], [cx, busY], [cx, ky]] })
          stack.push({ id: kid, left: kx, top: ky, depth: depth + 1, parentId: id })
        })
      }
    }
  }

  let left = 0
  let height = 0
  for (const root of tree.roots) {
    if (sizes.has(root)) continue
    measure(root)
    const size = sizes.get(root)
    if (!size) continue
    place(root, left)
    left += size.w + ROOT_GAP
    height = Math.max(height, size.h)
  }
  return { nodes, byId, edges, width: Math.max(0, left - ROOT_GAP), height }
}

/**
 * The starting set of expanded nodes: the roots, then breadth-first down to
 * `levels` levels, stopping once about `maxVisible` nodes would show.
 */
export function defaultExpanded(tree: ChartTree, options: { levels?: number; maxVisible?: number } = {}): Set<string> {
  const levels = options.levels ?? 2
  const maxVisible = options.maxVisible ?? 150
  const expanded = new Set<string>()
  let visible = tree.roots.length
  let frontier = [...tree.roots]
  for (let level = 0; level < levels && frontier.length; level++) {
    const next: string[] = []
    for (const id of frontier) {
      const kids = tree.childrenOf.get(id) ?? []
      if (!kids.length) continue
      if (visible + kids.length > maxVisible && expanded.size > 0) return expanded
      expanded.add(id)
      visible += kids.length
      next.push(...kids)
    }
    frontier = next
  }
  return expanded
}

/** Expand every ancestor of `id` so it becomes visible (parentOf: child → parent). */
export function expandPathTo(expanded: ReadonlySet<string>, parentOf: ReadonlyMap<string, string>, id: string): Set<string> {
  const next = new Set(expanded)
  const seen = new Set<string>([id])
  let current = parentOf.get(id)
  while (current && !seen.has(current)) {
    next.add(current)
    seen.add(current)
    current = parentOf.get(current)
  }
  return next
}

export interface Viewport { x: number; y: number; k: number }

/** Nodes inside the visible rectangle (plus a margin). A zero-sized container shows everything (SSR, tests). */
export function visibleNodes(layout: ChartLayout, view: Viewport, size: { width: number; height: number }, margin = 200): PlacedNode[] {
  if (!size.width || !size.height) return layout.nodes
  const minX = (-view.x - margin) / view.k
  const minY = (-view.y - margin) / view.k
  const maxX = (size.width - view.x + margin) / view.k
  const maxY = (size.height - view.y + margin) / view.k
  return layout.nodes.filter((n) => n.x + NODE_W >= minX && n.x <= maxX && n.y + NODE_H >= minY && n.y <= maxY)
}

/** A transform that fits the whole layout in the container (zoom capped at 1). */
export function fitView(layout: Pick<ChartLayout, 'width' | 'height'>, size: { width: number; height: number }, padding = 32): Viewport {
  if (!size.width || !size.height || !layout.width) return { x: padding, y: padding, k: 1 }
  const k = Math.max(MIN_ZOOM, Math.min(1, (size.width - padding * 2) / layout.width, (size.height - padding * 2) / layout.height))
  return { k, x: (size.width - layout.width * k) / 2, y: padding }
}

/** A transform with node `id` in the centre at zoom `k`. */
export function centreOn(layout: ChartLayout, id: string, size: { width: number; height: number }, k = 1): Viewport | null {
  const node = layout.byId.get(id)
  if (!node) return null
  return { k, x: size.width / 2 - (node.x + NODE_W / 2) * k, y: size.height / 3 - (node.y + NODE_H / 2) * k }
}

export const MIN_ZOOM = 0.15
export const MAX_ZOOM = 2

export function clampZoom(k: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k))
}

/** Zoom by `factor` keeping the point (px, py) (container coordinates) still. */
export function zoomAt(view: Viewport, factor: number, px: number, py: number): Viewport {
  const k = clampZoom(view.k * factor)
  const ratio = k / view.k
  return { k, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio }
}

/** SVG path data for an edge polyline. */
export function edgePath(points: ReadonlyArray<[number, number]>): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${Math.round(x)},${Math.round(y)}`).join(' ')
}
