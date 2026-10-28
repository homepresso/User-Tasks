/**
 * Runtime state drawn on top of the designer's node cards (Save & Test,
 * run detail viewer): which steps ran, failed, are running or waiting, and
 * which connections the run took. Pure — the viewers feed it a run's
 * node_results and get per-node / per-edge overlays back.
 */

export type NodeRunStatus = 'running' | 'completed' | 'failed' | 'waiting' | 'skipped' | 'not_run'
export type EdgeRunTone = 'success' | 'danger' | 'warning'

export interface NodeRunOverlay {
  status: NodeRunStatus
  durationMs?: number
  visits?: number
  error?: string
  /** Branch labels the step took (condition / switch / parallel). */
  takenBranches?: string[]
  /** The step the run is currently on (pulses). */
  current?: boolean
}

export interface RunNodeResult {
  status?: string
  duration_ms?: number
  error?: string
  output?: Record<string, unknown> | null
}

interface GraphNode { id: string; type: string; sectionId?: string | null }
interface GraphEdge { id: string; source: string; target: string }

export interface RunOverlayInput {
  nodes: GraphNode[]
  edges: GraphEdge[]
  nodeResults: Record<string, RunNodeResult | undefined>
  /** Node the run is paused on (waiting for a task / event). */
  pausedNodeId?: string | null
  /** True while the run is paused (waiting_for_event / paused). */
  runWaiting?: boolean
  /** Node executing right now (live Save & Test). */
  activeNodeId?: string | null
  /** Migration runs start mid-graph at this node. */
  entryNodeId?: string | null
  visits?: Record<string, number>
}

export interface RunOverlay {
  nodes: Record<string, NodeRunOverlay>
  edges: Record<string, EdgeRunTone>
  /** Steps on the run's path (reachable executed steps + the paused one). */
  traversed: Set<string>
}

/**
 * Steps the run reached: steps with a result that are start nodes (no
 * incoming edge) or the migration entry, then forward along edges to steps
 * that also have a result. Results of unreachable steps (stale entries from
 * a previous version) are ignored.
 */
export function executedNodeIds(input: Pick<RunOverlayInput, 'nodes' | 'edges' | 'nodeResults' | 'pausedNodeId' | 'entryNodeId'>): Set<string> {
  const { nodes, edges, nodeResults, pausedNodeId, entryNodeId } = input
  const has = (id: string) => !!nodeResults[id] || id === pausedNodeId
  const targets = new Set(edges.map((e) => e.target))
  const executed = new Set<string>()
  for (const n of nodes) if (has(n.id) && !targets.has(n.id)) executed.add(n.id)
  if (entryNodeId && has(entryNodeId)) executed.add(entryNodeId)
  let changed = true
  while (changed) {
    changed = false
    for (const e of edges) {
      if (executed.has(e.source) && has(e.target) && !executed.has(e.target)) {
        executed.add(e.target)
        changed = true
      }
    }
  }
  return executed
}

function takenBranchesOf(result: RunNodeResult | undefined): string[] | undefined {
  const out = result?.output
  if (!out) return undefined
  const branches: string[] = []
  if (Array.isArray(out.matched_branches)) branches.push(...(out.matched_branches as unknown[]).map(String))
  if (typeof out.matched_branch === 'string' && out.matched_branch) branches.push(out.matched_branch)
  if (typeof out.matched_case === 'string' && out.matched_case) branches.push(out.matched_case)
  if (typeof out.branch === 'string' && out.branch) branches.push(out.branch)
  if (typeof out.outcome === 'string' && out.outcome) branches.push(out.outcome)
  return branches.length > 0 ? [...new Set(branches)] : undefined
}

export function computeRunOverlay(input: RunOverlayInput): RunOverlay {
  const { nodes, edges, nodeResults, pausedNodeId, runWaiting, activeNodeId, visits } = input
  const executed = executedNodeIds(input)
  const traversed = new Set<string>([...executed, ...(pausedNodeId ? [pausedNodeId] : [])])
  // A section counts as traversed when a step inside it was.
  for (const n of nodes) {
    if (n.type === 'section_group' && nodes.some((m) => m.sectionId === n.id && traversed.has(m.id))) traversed.add(n.id)
  }

  const overlay: Record<string, NodeRunOverlay> = {}
  for (const n of nodes) {
    if (n.type === 'section_group') continue
    const r = nodeResults[n.id]
    let status: NodeRunStatus
    if (activeNodeId === n.id) status = 'running'
    else if (runWaiting && pausedNodeId === n.id) status = 'waiting'
    else if (!r) status = 'not_run'
    else if (r.status === 'error') status = 'failed'
    else if (r.status === 'skipped') status = 'skipped'
    // Reached steps (a step that waited earlier and the run moved on counts as completed);
    // results of unreachable steps are stale and ignored.
    else status = executed.has(n.id) ? 'completed' : 'not_run'
    const o: NodeRunOverlay = { status }
    if (typeof r?.duration_ms === 'number' && status !== 'waiting' && status !== 'running') o.durationMs = r.duration_ms
    if (visits?.[n.id]) o.visits = visits[n.id]
    if (status === 'failed' && r?.error) o.error = String(r.error)
    const taken = takenBranchesOf(r)
    if (taken) o.takenBranches = taken
    if (status === 'running' || status === 'waiting') o.current = true
    overlay[n.id] = o
  }

  const edgeTones: Record<string, EdgeRunTone> = {}
  for (const e of edges) {
    if (!traversed.has(e.source) || !traversed.has(e.target)) continue
    const target = overlay[e.target]
    edgeTones[e.id] = target?.status === 'waiting' || target?.status === 'running' ? 'warning' : target?.status === 'failed' ? 'danger' : 'success'
  }
  return { nodes: overlay, edges: edgeTones, traversed }
}

export const RUN_STATUS_LABEL: Record<NodeRunStatus, string> = {
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  waiting: 'Waiting',
  skipped: 'Skipped',
  not_run: 'Not run',
}

/** Theme tokens (fill / text on the fill) of each status. */
export const RUN_STATUS_TOKENS: Record<NodeRunStatus, { fill: string; on: string }> = {
  running: { fill: 'var(--theme-info)', on: 'var(--theme-on-info)' },
  completed: { fill: 'var(--theme-success)', on: 'var(--theme-on-success)' },
  failed: { fill: 'var(--theme-danger)', on: 'var(--theme-on-danger)' },
  waiting: { fill: 'var(--theme-warning)', on: 'var(--theme-on-warning)' },
  skipped: { fill: 'var(--theme-surface)', on: 'var(--theme-muted-text)' },
  not_run: { fill: 'var(--theme-surface)', on: 'var(--theme-muted-text)' },
}

export const EDGE_TONE_TOKEN: Record<EdgeRunTone, string> = {
  success: 'var(--theme-success)',
  danger: 'var(--theme-danger)',
  warning: 'var(--theme-warning)',
}

export function formatRunDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export type FocusStepKind = 'failed' | 'current' | 'start'

/**
 * The step a run preview opens on (and "Zoom to step" jumps to) when the
 * graph doesn't fit: the failed step, else the step the run is on (running
 * / waiting), else the start (a step without incoming connections, the
 * top-most first). Ties go to the top-most, then left-most step.
 */
export function pickFocusStep(
  nodes: Array<GraphNode & { position?: { x: number; y: number } }>,
  edges: GraphEdge[],
  overlay: Pick<RunOverlay, 'nodes'>,
): { id: string; kind: FocusStepKind } | null {
  const steps = nodes.filter((n) => n.type !== 'section_group')
  const order = (a: typeof steps[number], b: typeof steps[number]) =>
    (a.position?.y ?? 0) - (b.position?.y ?? 0) || (a.position?.x ?? 0) - (b.position?.x ?? 0)
  const first = (pred: (n: typeof steps[number]) => boolean) => steps.filter(pred).sort(order)[0]
  const failed = first((n) => overlay.nodes[n.id]?.status === 'failed')
  if (failed) return { id: failed.id, kind: 'failed' }
  const current = first((n) => !!overlay.nodes[n.id]?.current)
  if (current) return { id: current.id, kind: 'current' }
  const targets = new Set(edges.map((e) => e.target))
  const start = first((n) => !targets.has(n.id)) ?? steps.slice().sort(order)[0]
  return start ? { id: start.id, kind: 'start' } : null
}

export const FOCUS_STEP_LABEL: Record<FocusStepKind, string> = {
  failed: 'Zoom to failed step',
  current: 'Zoom to current step',
  start: 'Zoom to start',
}
