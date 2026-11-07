/**
 * Join semantics of the Parallel / Sequential node — the pure parts (graph
 * analysis and the run state that is persisted with a paused run). The
 * engine (lib/workflow-engine.ts) drives the branches.
 *
 * A step that two or more branches of one Parallel node can reach is a join.
 * It runs once, after every branch that can reach it has finished (arrived
 * at it, or ended elsewhere, e.g. down a condition path that skips it), and
 * only when at least one branch arrived. A branch that cannot reach a join is
 * not waited for by it; the Parallel node itself (and so the run) still waits
 * for every branch.
 *
 * Variables: branches share the run's variables while they run (as before),
 * and every branch's writes are recorded. When a join runs, the writes of the
 * branches it joins are applied again in branch order, so on a conflict the
 * later branch (in the node's branch order) wins, whatever finished last.
 *
 * Waits (user tasks, server events, long delays) inside a branch end that
 * branch's path for now; the other branches carry on. The run pauses when
 * nothing else can run, waiting on one event at a time (the first wait that
 * started); the others are kept in the run state and waited for in turn, and
 * a completion that arrives for a wait the run is not currently waiting on is
 * kept and applied when the run gets to it.
 *
 * Done: edges from the Parallel node labelled "Done", or with no label, are
 * not branches. They run once, after every branch (and every join) of that
 * execution has finished, with all branches' variables applied in branch
 * order (like a join of every branch). If a branch is waiting (user task,
 * long delay), the frame keeps `done_edges` in the persisted run state and
 * the Done edges run when the last branch resumes and finishes. A failed
 * branch (error not set to continue) fails the run and Done never runs.
 */

/**
 * Edges from a Parallel node that run after all its branches: labelled
 * "Done" or unlabelled, and not the edge of a branch (a branch may itself be
 * called "Done"). Error-path labels are neither.
 */
export function parallelDoneEdges<E extends { label?: string | null }>(edges: E[], branchLabels: string[]): E[] {
  const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().trim()
  const branches = new Set(branchLabels.map(norm))
  return edges.filter((e) => {
    const label = norm(e.label)
    return (label === '' || label === 'done') && !branches.has(label)
  })
}

/** Branch labels of a Parallel node, in branch order ("A" or {label: "A", order}). */
export function parallelBranchLabels(branches: unknown): string[] {
  if (!Array.isArray(branches)) return []
  return branches
    .map((b) => (typeof b === 'string' ? b : b && typeof b === 'object' ? String((b as { label?: unknown }).label ?? '') : ''))
    .map((label) => label.trim())
    .filter(Boolean)
}

export interface ParallelGraph {
  /** Join candidates: nodes reachable from two or more branches. */
  stop: Set<string>
  /** Node → indexes of the branches that can reach it (ascending). */
  reach: Map<string, number[]>
}

/**
 * Which nodes each branch can reach (following edges forward, never back
 * through the Parallel node itself) and which of them are joins.
 */
export function computeParallelGraph(
  parallelNodeId: string,
  branchTargets: string[],
  outgoing: (nodeId: string) => Array<{ target: string }>,
): ParallelGraph {
  const reach = new Map<string, number[]>()
  branchTargets.forEach((target, index) => {
    const seen = new Set<string>()
    const stack = [target]
    while (stack.length > 0) {
      const id = stack.pop()!
      if (id === parallelNodeId || seen.has(id)) continue
      seen.add(id)
      const list = reach.get(id)
      if (list) list.push(index)
      else reach.set(id, [index])
      for (const edge of outgoing(id)) stack.push(edge.target)
    }
  })
  const stop = new Set<string>()
  for (const [id, branches] of reach) if (branches.length > 1) stop.add(id)
  return { stop, reach }
}

/* ── Run state (persisted under pause_variables._parallel) ── */

export const PARALLEL_STATE_KEY = '_parallel'

/**
 * Where a path of the run is: in which execution of a Parallel node (frame),
 * carrying which branches (its token — one branch, or several once they
 * joined), writing its variables into which record of the frame.
 */
export interface PathEntry {
  frame: string
  token: number[]
  record: number
}

/** Variables one path set (applied again at a join, see joinReplayOrder). */
export interface WriteRecord {
  token: number[]
  writes: Record<string, unknown>
  deleted: string[]
}

export interface BranchState {
  label: string
  target: string
  edge_id: string
  /** Sequential mode starts branches one at a time. */
  started: boolean
}

/** A path waiting at a join for the other branches that can still reach it. */
export interface ArrivalState {
  node_id: string
  token: number[]
  record: number
}

/** One execution of a Parallel node. */
export interface FrameState {
  id: string
  node_id: string
  mode: 'parallel' | 'sequential'
  /** The path the Parallel node itself ran on (outermost first). */
  parent_path: PathEntry[]
  branches: BranchState[]
  records: WriteRecord[]
  arrivals: ArrivalState[]
  /**
   * Done edges (ids) still to run when this execution finishes. Set only
   * when the Parallel node returned while a branch was waiting; the edges
   * then run on the frame's parent path once the frame completes.
   */
  done_edges?: string[]
}

/** A wait (user task / server event / timed pause) the run has open. */
export interface WaitState {
  event_id: string
  node_id: string
  path: PathEntry[]
  paused_at: string
  resume_at?: string
  output?: Record<string, unknown>
  /** Timed wait whose delay_resume job is enqueued. */
  scheduled?: boolean
  /** Test runs: the step's inline prompt event (shown again when the run waits on it). */
  prompt?: { node_label: string; data: Record<string, unknown> }
}

export interface ParallelState {
  v: 1
  seq: number
  /** Bumped on every persisted write (optimistic concurrency of early completions). */
  rev: number
  frames: FrameState[]
  waits: WaitState[]
  /** Event ids of the open waits (found with jsonb containment). */
  wait_events: string[]
  /** Completions that arrived for a wait the run was not waiting on at the time. */
  completed: Record<string, Record<string, unknown>>
}

export function emptyParallelState(): ParallelState {
  return { v: 1, seq: 0, rev: 0, frames: [], waits: [], wait_events: [], completed: {} }
}

/** The persisted state from pause_variables (a fresh one when absent or malformed). */
export function readParallelState(raw: unknown): ParallelState {
  const s = (raw ?? null) as Partial<ParallelState> | null
  if (!s || typeof s !== 'object' || s.v !== 1) return emptyParallelState()
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])
  return {
    v: 1,
    seq: Number(s.seq) || 0,
    rev: Number(s.rev) || 0,
    frames: arr<FrameState>(s.frames).map((f) => ({
      ...f,
      parent_path: arr<PathEntry>(f.parent_path),
      branches: arr<BranchState>(f.branches),
      records: arr<WriteRecord>(f.records).map((r) => ({ token: arr<number>(r.token), writes: r.writes ?? {}, deleted: arr<string>(r.deleted) })),
      arrivals: arr<ArrivalState>(f.arrivals),
    })),
    waits: arr<WaitState>(s.waits).map((w) => ({ ...w, path: arr<PathEntry>(w.path) })),
    wait_events: arr<unknown>(s.wait_events).map(String),
    completed: s.completed && typeof s.completed === 'object' ? { ...s.completed } : {},
  }
}

/** Worth persisting: open frames, or waits beyond the single root wait every pause has. */
export function parallelStateIsActive(state: ParallelState): boolean {
  return state.frames.length > 0 || state.waits.length > 1 || state.waits.some((w) => w.path.length > 0)
}

/**
 * Order in which the records of the paths a join merges are applied: by the
 * highest branch each path carries, then in the order the paths started. So a
 * later branch wins a conflict with an earlier one, and a path that continued
 * after an earlier join wins over the branches it joined.
 */
export function joinReplayOrder(records: WriteRecord[], token: number[]): number[] {
  const max = (t: number[]) => Math.max(-1, ...t)
  return records
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => r.token.length > 0 && r.token.every((b) => token.includes(b)))
    .sort((a, b) => max(a.r.token) - max(b.r.token) || a.index - b.index)
    .map(({ index }) => index)
}

/** Something of the run that may still reach a join: a running path (position unknown), a wait, an arrival, an unstarted branch. */
export interface LivePosition {
  token: number[]
  /** null: running, anywhere. */
  node: string | null
  /** An unstarted branch: `node` is its first step (reaching the join itself counts). */
  start?: boolean
}

/**
 * Branches a join at `nodeId` (with the paths of `token` arrived) must still
 * wait for: branches that can reach it and are still live at a position from
 * which it can be reached.
 */
export function joinBlockers(
  graph: ParallelGraph,
  nodeId: string,
  token: number[],
  live: LivePosition[],
  canReach: (from: string, to: string) => boolean,
): number[] {
  const others = (graph.reach.get(nodeId) ?? []).filter((b) => !token.includes(b))
  return others.filter((b) =>
    live.some((p) => p.token.includes(b) && (p.node === null || p.node === nodeId || canReach(p.node, nodeId))),
  )
}

/** Summary of a join still waiting, for the run canvas ("waiting for 1 of 2 branches"). */
export function joinWaitingSummary(frame: FrameState, nodeId: string, arrivedToken: number[], blockers: number[]) {
  return {
    parallel_node_id: frame.node_id,
    arrived: arrivedToken.length,
    expected: arrivedToken.length + blockers.length,
    waiting_for: blockers.map((b) => frame.branches[b]?.label ?? `Branch ${b + 1}`),
  }
}

/**
 * Order of the run's open waits, independent of when each wait opened: by
 * where they are — a wait outside any Parallel first, then by the Parallel
 * execution (frames in the order they started) and the lowest branch, level
 * by level. The run waits on the first; resumes and test prompts follow it.
 */
export function compareWaits(a: Pick<WaitState, 'path'>, b: Pick<WaitState, 'path'>): number {
  const seq = (frame: string) => Number(frame.slice(frame.lastIndexOf('#') + 1)) || 0
  for (let i = 0; i < Math.max(a.path.length, b.path.length); i++) {
    const x = a.path[i]
    const y = b.path[i]
    if (!x || !y) return x ? 1 : -1
    const diff =
      seq(x.frame) - seq(y.frame) ||
      Math.min(...x.token) - Math.min(...y.token) ||
      x.record - y.record
    if (diff !== 0) return diff
  }
  return 0
}
