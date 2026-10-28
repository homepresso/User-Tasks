/**
 * Workflow report helpers shared by the report pages and their server route.
 *
 * Run rows on the report pages come from the workflow_run_summaries RPC
 * (supabase/migrations/20261028000000_perf_api_reports.sql): no
 * execution_trace/node_results, but trace-derived counts per run. The
 * per-node/edge heat map needs the traces, so it is computed on the server
 * (app/api/reports/workflows/[id]/flow-stats) with buildAggregateFlowStats.
 */

import { resolveVisibleGraph } from '@/lib/workflow-sections'

/* eslint-disable @typescript-eslint/no-explicit-any -- run/node JSON from the DB */

export type AggregateFlowStats = {
  nodeCounts: Record<string, number>
  edgeCounts: Record<string, number>
  maxNodeCount: number
  maxEdgeCount: number
  /** Per step, from node_results: runs with a result, errors, summed durations (heat overlay). */
  nodeStats?: Record<string, NodeRunStats>
}

export interface NodeRunStats {
  /** Runs with a result for the step. */
  runs: number
  /** Of those, results with status "error". */
  errors: number
  /** Sum / count of the results that report duration_ms. */
  durationTotalMs: number
  durationCount: number
}

/** Run row as returned by workflow_run_summaries (traces replaced by counts). */
export interface RunSummary {
  id: string
  workflow_id: string
  task_id?: string | null
  status: string
  started_at: string
  completed_at: string | null
  error?: string | null
  title?: string | null
  paused_at?: string | null
  paused_node_id?: string | null
  sla_label?: string | null
  sla_due_at?: string | null
  sla_warning_at?: string | null
  sla_status?: string | null
  trace_node_visits: number
  edge_traversals: number
  result_node_count: number
}

/**
 * Node visits for a run: traced node entries, else the nodes in node_results
 * (plus the paused node when `countPausedNode`, as the overview page does).
 */
export function runNodeVisits(run: Pick<RunSummary, 'trace_node_visits' | 'result_node_count' | 'paused_node_id'>, countPausedNode = false): number {
  if (run.trace_node_visits > 0) return run.trace_node_visits
  return run.result_node_count + (countPausedNode && run.paused_node_id ? 1 : 0)
}

export function runEdgeTraversals(run: Pick<RunSummary, 'edge_traversals'>): number {
  return run.edge_traversals ?? 0
}

/** Mean of `values` (0 for an empty list). */
export function average(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
  return value as T
}

function isTraceEntry(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLabel(value: unknown) {
  return String(value ?? '').trim().toLowerCase()
}

export function buildAggregateFlowStats(workflow: any, runs: any[]): AggregateFlowStats {
  const nodes = parseJsonField<any[]>(workflow.nodes, [])
  const edges = parseJsonField<any[]>(workflow.edges, [])
  const nodeCounts: Record<string, number> = {}
  const edgeCounts: Record<string, number> = {}
  const nodeStats: Record<string, NodeRunStats> = {}
  const { resolvedEdges } = resolveVisibleGraph(nodes, edges)
  const edgeKeyToResolvedId = new Map<string, string>(
    resolvedEdges.map((edge: any) => [`${edge.source}→${edge.target}`, edge.id])
  )

  for (const run of runs) {
    const executionTrace = parseJsonField<unknown[]>(run?.execution_trace, []).filter(isTraceEntry)
    const tracedNodeIds = new Set<string>()
    const tracedEdgeIds = new Set<string>()
    if (executionTrace.length > 0) {
      let tracedCount = 0

      for (const entry of executionTrace) {
        if (entry.type === 'node' && typeof entry.node_id === 'string') {
          tracedNodeIds.add(entry.node_id)
          nodeCounts[entry.node_id] = (nodeCounts[entry.node_id] ?? 0) + 1
          tracedCount += 1
        }

        if (entry.type === 'edge') {
          const edgeId = typeof entry.edge_id === 'string' ? entry.edge_id : null
          const source = typeof entry.source === 'string' ? entry.source : null
          const target = typeof entry.target === 'string' ? entry.target : null
          const resolvedId = edgeId
            ?? (source && target ? edgeKeyToResolvedId.get(`${source}→${target}`) ?? null : null)
          if (resolvedId) {
            tracedEdgeIds.add(resolvedId)
            edgeCounts[resolvedId] = (edgeCounts[resolvedId] ?? 0) + 1
            tracedCount += 1
          }
        }
      }

      for (const node of nodes) {
        if ((node as any).type !== 'section_group') continue
        const hasExecutedChild = nodes.some((child: any) => child.sectionId === (node as any).id && tracedNodeIds.has(child.id))
        if (hasExecutedChild) {
          nodeCounts[(node as any).id] = (nodeCounts[(node as any).id] ?? 0) + 1
        }
      }
      if (tracedCount > 0 && executionTrace.length > 0) {
        // Partial traces are common for some trigger / middleware flows.
        // Keep the trace-derived counts we have, but still use node_results
        // below to fill in missing downstream nodes and edges rather than
        // treating a sparse trace as the whole path.
      }
    }

    const nodeResults = parseJsonField<Record<string, any>>(run?.node_results, {})
    for (const [nodeId, result] of Object.entries(nodeResults)) {
      if (!result || typeof result !== 'object') continue
      const st = (nodeStats[nodeId] ??= { runs: 0, errors: 0, durationTotalMs: 0, durationCount: 0 })
      st.runs += 1
      if (result.status === 'error') st.errors += 1
      if (typeof result.duration_ms === 'number' && Number.isFinite(result.duration_ms)) {
        st.durationTotalMs += result.duration_ms
        st.durationCount += 1
      }
    }
    const executed = new Set<string>(Object.keys(nodeResults))
    if (run?.paused_node_id) executed.add(run.paused_node_id)
    if (executed.size === 0) continue

    const targetIds = new Set(edges.map((edge: any) => edge.target))
    const traversed = new Set<string>()

    for (const node of nodes) {
      if (executed.has(node.id) && !targetIds.has(node.id)) traversed.add(node.id)
    }
    if (traversed.size === 0) {
      for (const nodeId of executed) traversed.add(nodeId)
    } else {
      let changed = true
      while (changed) {
        changed = false
        for (const edge of edges) {
          if (traversed.has(edge.source) && executed.has(edge.target) && !traversed.has(edge.target)) {
            traversed.add(edge.target)
            changed = true
          }
        }
      }
    }

    const traversalIds = new Set<string>(traversed)
    if (run?.paused_node_id) traversalIds.add(run.paused_node_id)
    for (const node of nodes) {
      if ((node as any).type === 'section_group') {
        const hasExecutedChild = nodes.some((child: any) => child.sectionId === (node as any).id && traversalIds.has(child.id))
        if (hasExecutedChild) traversalIds.add((node as any).id)
      }
    }

    for (const nodeId of traversalIds) {
      if (!tracedNodeIds.has(nodeId)) {
        nodeCounts[nodeId] = (nodeCounts[nodeId] ?? 0) + 1
      }
    }

    for (const edge of edges) {
      if (!(traversalIds.has(edge.source) && traversalIds.has(edge.target))) continue

      const sourceResult = nodeResults[edge.source]
      const matchedBranches = Array.isArray(sourceResult?.output?.matched_branches)
        ? sourceResult.output.matched_branches.map(normalizeLabel)
        : null
      const matchedCase = sourceResult?.output?.matched_case ? normalizeLabel(sourceResult.output.matched_case) : null
      const edgeLabel = normalizeLabel(edge.label)

      let include = true
      if (matchedBranches && matchedBranches.length > 0) {
        include = edgeLabel.length === 0 || matchedBranches.includes(edgeLabel)
      } else if (matchedCase) {
        include = edgeLabel.length === 0 || edgeLabel === matchedCase
      }

      if (include) {
        const resolvedId = edgeKeyToResolvedId.get(`${edge.source}→${edge.target}`) ?? edge.id
        if (!tracedEdgeIds.has(resolvedId)) {
          edgeCounts[resolvedId] = (edgeCounts[resolvedId] ?? 0) + 1
        }
      }
    }
  }

  return {
    nodeCounts,
    edgeCounts,
    maxNodeCount: Math.max(0, ...Object.values(nodeCounts)),
    maxEdgeCount: Math.max(0, ...Object.values(edgeCounts)),
    nodeStats,
  }
}
