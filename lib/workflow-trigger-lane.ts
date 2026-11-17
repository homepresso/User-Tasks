/**
 * The trigger lane: the horizontal band at the top of a workflow canvas that
 * holds the trigger step(s). Shared by the designer, auto-layout and every
 * run / process viewer, so the band and its steps line up everywhere.
 *
 * Geometry (canvas coordinates)
 * - The band starts at y = 0 and spans the whole canvas width (the viewers
 *   draw it edge to edge across the viewport; only its vertical bounds are
 *   canvas coordinates).
 * - Its height follows the tallest trigger card: PAD above, the card, PAD
 *   below. A lone trigger therefore sits vertically centred with even padding.
 * - A trigger may sit anywhere horizontally (x >= 0) and vertically only
 *   inside the band (a shorter trigger beside a taller one has some play).
 * - Non-trigger steps and sections stay at least GAP below the band.
 *
 * Pure: nodes (+ measured sizes) in, adjusted positions out. Only positions
 * (and swimlane y when content shifts) change; ids, configs, sections and
 * connections are never touched.
 */

import type { WorkflowNode } from './workflow-schema'
import { fullNodeCatalog } from './workflow-schema'
import { nodeBox, type SizeMap } from './workflow-edge-routing'

export const TRIGGER_LANE = {
  /** Top of the band (canvas y). */
  TOP: 0,
  /** Space above and below the tallest trigger card. */
  PAD: 20,
  /** Minimum free space between the band and the first non-trigger step. */
  GAP: 20,
  /** Snap grid of the designer (positions stay on it where possible). */
  GRID: 20,
} as const

export interface TriggerLane {
  top: number
  height: number
  bottom: number
  /** Height of the tallest trigger card. */
  inner: number
}

type NodeLike = Pick<WorkflowNode, 'id' | 'type' | 'position' | 'collapsed' | 'config'> & { sectionId?: string }

let triggerTypeCache: Set<string> | null = null
/** Node types of the trigger category (catalog order is irrelevant). */
export function triggerTypeSet(): Set<string> {
  if (!triggerTypeCache) triggerTypeCache = new Set(fullNodeCatalog().filter((n) => n.category === 'trigger').map((n) => n.type))
  return triggerTypeCache
}

export function isTriggerNode(node: Pick<WorkflowNode, 'type'>, triggers: Set<string> = triggerTypeSet()): boolean {
  return triggers.has(node.type)
}

const snapUp = (v: number) => Math.ceil(v / TRIGGER_LANE.GRID - 1e-9) * TRIGGER_LANE.GRID

/** The band for these nodes, or null when there is no trigger step. */
export function triggerLaneOf(nodes: readonly NodeLike[], sizes?: SizeMap, triggers: Set<string> = triggerTypeSet()): TriggerLane | null {
  let inner = 0
  let any = false
  for (const n of nodes) {
    if (!triggers.has(n.type)) continue
    any = true
    inner = Math.max(inner, nodeBox(n, sizes).height)
  }
  if (!any) return null
  const height = inner + TRIGGER_LANE.PAD * 2
  return { top: TRIGGER_LANE.TOP, height, bottom: TRIGGER_LANE.TOP + height, inner }
}

/** The y range a trigger card of `height` may take inside `lane`. */
export function triggerYRange(lane: TriggerLane, height: number): { min: number; max: number } {
  const min = lane.top + TRIGGER_LANE.PAD
  return { min, max: Math.max(min, lane.bottom - TRIGGER_LANE.PAD - height) }
}

/** Clamp a trigger card's position into the band (x only kept non-negative). */
export function clampTriggerPosition(pos: { x: number; y: number }, height: number, lane: TriggerLane): { x: number; y: number } {
  const { min, max } = triggerYRange(lane, height)
  return { x: Math.max(0, pos.x), y: Math.min(max, Math.max(min, pos.y)) }
}

/** Lowest top a non-trigger step or section may have, on the grid (no lane: anything goes). */
export function minContentY(lane: TriggerLane | null): number {
  return lane ? snapUp(lane.bottom + TRIGGER_LANE.GAP) : 0
}

/** Vertically centred y of a trigger card of `height` in `lane` (auto-layout). */
export function centredTriggerY(lane: TriggerLane, height: number): number {
  return lane.top + TRIGGER_LANE.PAD + (lane.inner - height) / 2
}

/**
 * Clamp a drag of one step by `dy` (canvas units): a trigger stays inside the
 * band, a step or section stays below it. Returns the allowed dy.
 */
export function clampDragDelta(node: NodeLike, dy: number, lane: TriggerLane | null, sizes?: SizeMap, triggers: Set<string> = triggerTypeSet()): number {
  if (!lane) return dy
  const y = node.position.y + dy
  if (triggers.has(node.type)) {
    const { min, max } = triggerYRange(lane, nodeBox(node, sizes).height)
    return Math.min(max, Math.max(min, y)) - node.position.y
  }
  const floor = minContentY(lane)
  return y < floor ? floor - node.position.y : dy
}

export interface FitOptions<L extends { y: number }> {
  sizes?: SizeMap
  swimlanes?: L[]
  /**
   * Move all non-trigger content down together when any of it overlaps the
   * band (on open, and when the band grows): keeps the drawing's shape.
   * Otherwise only the overlapping steps / sections are pushed below it.
   */
  shiftContent?: boolean
  triggers?: Set<string>
}

export interface FitResult<N, L> {
  nodes: N[]
  swimlanes: L[]
  lane: TriggerLane | null
  /** True when any position changed (the arrays are new only then). */
  changed: boolean
}

/**
 * Bring a workflow in line with its trigger lane: triggers clamped into the
 * band; non-trigger steps and sections below it (all content shifted together
 * with `shiftContent`, else per step). Unchanged nodes keep their identity.
 */
export function fitTriggerLane<N extends NodeLike, L extends { y: number }>(nodes: N[], opts: FitOptions<L> = {}): FitResult<N, L> {
  const triggers = opts.triggers ?? triggerTypeSet()
  const swimlanes = opts.swimlanes ?? []
  const lane = triggerLaneOf(nodes, opts.sizes, triggers)
  if (!lane) return { nodes, swimlanes, lane, changed: false }

  const floor = minContentY(lane)
  const moved = new Map<string, { x: number; y: number }>()
  const pos = (n: N) => moved.get(n.id) ?? n.position

  // 1. Triggers into the band.
  for (const n of nodes) {
    if (!triggers.has(n.type)) continue
    const p = clampTriggerPosition(n.position, nodeBox(n, opts.sizes).height, lane)
    if (p.x !== n.position.x || p.y !== n.position.y) moved.set(n.id, p)
  }

  const content = nodes.filter((n) => !triggers.has(n.type))
  let shift = 0
  if (opts.shiftContent && content.length > 0) {
    const top = Math.min(...content.map((n) => n.position.y))
    if (top < floor) shift = snapUp(floor - top)
  }
  let lanesOut = swimlanes
  if (shift > 0) {
    for (const n of content) moved.set(n.id, { x: n.position.x, y: n.position.y + shift })
    lanesOut = swimlanes.map((l) => ({ ...l, y: l.y + shift }))
  } else {
    // 2. Sections first (their members move with them), then loose steps.
    for (const s of content) {
      if (s.type !== 'section_group' || s.position.y >= floor) continue
      const dy = floor - s.position.y
      moved.set(s.id, { x: s.position.x, y: floor })
      for (const m of content) if (m.sectionId === s.id && m.id !== s.id) moved.set(m.id, { x: m.position.x, y: m.position.y + dy })
    }
    for (const n of content) {
      if (n.type === 'section_group') continue
      const p = pos(n)
      if (p.y < floor) moved.set(n.id, { x: p.x, y: floor })
    }
  }

  if (moved.size === 0 && lanesOut === swimlanes) return { nodes, swimlanes, lane, changed: false }
  return {
    nodes: nodes.map((n) => {
      const p = moved.get(n.id)
      return p && (p.x !== n.position.x || p.y !== n.position.y) ? { ...n, position: p } : n
    }),
    swimlanes: lanesOut,
    lane,
    changed: true,
  }
}
