/**
 * Home (/home): the pure parts of run progress shared by the service
 * (lib/services/home.ts), the REST / MCP surfaces and the page — display
 * statuses, stages (where a run is and who it is with) and the
 * submitter-safe flow diagram (nodes stripped to what draws the card).
 *
 * The submitter-safe view never carries step configs, outputs, errors,
 * variables or form values: a node keeps its id, type, label, position,
 * section, collapsed flag, colour / icon and branch labels (so the ports and
 * edges still line up); edges keep their ends, label and port. Pure and
 * isomorphic.
 */

import { getBranchLabels } from '@/lib/workflow-branches'
import type { NodeRunOverlay, RunOverlay } from '@/lib/workflow-run-overlay'

/* eslint-disable @typescript-eslint/no-explicit-any -- definitions are loose JSON */

export const LIVE_RUN_STATUSES = ['running', 'waiting_for_event', 'paused'] as const
export const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'blocked'] as const

/** What Home shows for a run (or a submission's run). */
export type ProgressStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled' | 'none'

export function isLiveRunStatus(status: string | null | undefined): boolean {
  return (LIVE_RUN_STATUSES as readonly string[]).includes(String(status ?? ''))
}

/** A run status (workflow_runs.status) → Home's status. `queued`: a start is still on the queue. */
export function progressStatus(runStatus: string | null | undefined, queued = false): ProgressStatus {
  switch (runStatus) {
    case 'running': return 'running'
    case 'waiting_for_event':
    case 'paused': return 'waiting'
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled':
    case 'canceled': return 'cancelled'
    default: return queued ? 'queued' : 'none'
  }
}

/** One place a run is at: a step (usually a task) and who it is with since when. */
export interface RunStage {
  node_id: string | null
  /** The step's label in the designer (the task's step name). */
  name: string
  /** People it is with (assignee, or collaborators). */
  assignees: Array<{ id: string; name: string }>
  /** The team it is with when no one person has it. */
  team: string | null
  /** Since when (the task was created / the run paused). */
  since: string | null
  due_date: string | null
}

/** "Waiting on Manager approval", "Completed", … */
export function progressLabel(status: ProgressStatus, stages: readonly Pick<RunStage, 'name'>[] = []): string {
  switch (status) {
    case 'queued': return 'Starting'
    case 'running': return 'Running'
    case 'waiting': {
      const names = [...new Set(stages.map((s) => s.name).filter(Boolean))]
      return names.length ? `Waiting on ${names.join(', ')}` : 'Waiting'
    }
    case 'completed': return 'Completed'
    case 'failed': return 'Failed'
    case 'cancelled': return 'Cancelled'
    default: return 'No process'
  }
}

/** Everyone the run's current stages are with (names, unique, in order). */
export function peopleInvolved(stages: readonly RunStage[]): string[] {
  const out: string[] = []
  for (const stage of stages) {
    for (const a of stage.assignees) if (!out.includes(a.name)) out.push(a.name)
    if (stage.team && !stage.assignees.length && !out.includes(stage.team)) out.push(stage.team)
  }
  return out
}

/* ── Submitter-safe flow diagram ─────────────────────────────────────── */

/** Config keys that only style a card. */
export const SAFE_CONFIG_KEYS = ['node_color', 'node_icon_svg', 'node_icon_url', 'node_icon_lucide', 'node_icon_color'] as const

export interface SafeNode {
  id: string
  type: string
  label: string
  position: { x: number; y: number }
  sectionId?: string
  collapsed?: boolean
  config: Record<string, unknown> & { __safe: true; __branch_labels: string[] }
}

export interface SafeEdge { id: string; source: string; target: string; label?: string; sourcePort?: string }

function finite(n: unknown): number {
  const v = Number(n)
  return Number.isFinite(v) ? v : 0
}

/** A node as the submitter-safe view draws it (no config but colour / icon and branch labels). */
export function safeNode(node: any): SafeNode | null {
  if (!node || typeof node !== 'object' || typeof node.id !== 'string') return null
  const config = node.config && typeof node.config === 'object' ? node.config : {}
  const safe: SafeNode['config'] = { __safe: true, __branch_labels: getBranchLabels({ type: node.type, config }) }
  for (const key of SAFE_CONFIG_KEYS) if (typeof config[key] === 'string') safe[key] = config[key]
  // Custom activities show their activity's display name (the card would read it from the manifest).
  const manifestName = node.type === 'custom_activity' && typeof config.manifest?.display_name === 'string' ? config.manifest.display_name : null
  const out: SafeNode = {
    id: node.id,
    type: String(node.type ?? 'unknown'),
    label: String(manifestName || node.label || node.type || 'Step'),
    position: { x: finite(node.position?.x), y: finite(node.position?.y) },
    config: safe,
  }
  if (typeof node.sectionId === 'string') out.sectionId = node.sectionId
  if (node.collapsed === true) out.collapsed = true
  return out
}

export function safeEdge(edge: any): SafeEdge | null {
  if (!edge || typeof edge !== 'object' || typeof edge.source !== 'string' || typeof edge.target !== 'string') return null
  const out: SafeEdge = { id: String(edge.id ?? `${edge.source}-${edge.target}`), source: edge.source, target: edge.target }
  if (typeof edge.label === 'string') out.label = edge.label
  if (typeof edge.sourcePort === 'string') out.sourcePort = edge.sourcePort
  return out
}

/** Sections: layout boxes with a label only. */
export function safeSection(section: any): Record<string, unknown> | null {
  if (!section || typeof section !== 'object' || typeof section.id !== 'string') return null
  return {
    id: section.id,
    label: String(section.label ?? ''),
    color: typeof section.color === 'string' ? section.color : '#6B7280',
    position: { x: finite(section.position?.x), y: finite(section.position?.y) },
    width: finite(section.width),
    height: finite(section.height),
    collapsed: section.collapsed === true,
  }
}

/** A run overlay a browser can take: no step errors, `traversed` as a list. */
export interface SafeOverlay {
  nodes: Record<string, Omit<NodeRunOverlay, 'error'>>
  edges: RunOverlay['edges']
  traversed: string[]
}

export function safeOverlay(overlay: RunOverlay): SafeOverlay {
  const nodes: SafeOverlay['nodes'] = {}
  for (const [id, o] of Object.entries(overlay.nodes)) {
    const { error: _error, ...rest } = o
    nodes[id] = rest
  }
  return { nodes, edges: { ...overlay.edges }, traversed: [...overlay.traversed] }
}

/** The overlay back in the canvas's shape. */
export function overlayFromSafe(safe: SafeOverlay): RunOverlay {
  return { nodes: safe.nodes, edges: safe.edges, traversed: new Set(safe.traversed) }
}
