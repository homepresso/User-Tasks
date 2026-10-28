/**
 * Heat overlay of the reports' aggregate process map: per step the visit
 * count (relative to the busiest step), average duration and error rate;
 * per connection the traversal count and a stroke width. Drawn on the
 * shared WorkflowNodeCard / EdgeRenderer by RuntimeCanvas — the same cards
 * as the designer and the run previews. Pure; colours are theme tokens.
 */
import type { AggregateFlowStats } from './report-flow-stats'

export interface NodeHeat {
  /** Visits across the aggregated runs. */
  count: number
  /** count / busiest step's count (0..1). */
  ratio: number
  avgDurationMs: number | null
  /** Errors / runs with a result for the step (0..1), null without results. */
  errorRate: number | null
  errors: number
}

export interface EdgeHeat {
  count: number
  ratio: number
  /** Stroke width in canvas units (1.5 idle → 11.5 busiest). */
  width: number
}

export interface HeatOverlay {
  nodes: Record<string, NodeHeat>
  edges: Record<string, EdgeHeat>
  maxNodeCount: number
  maxEdgeCount: number
}

export const HEAT_EDGE_MIN_WIDTH = 1.5
export const HEAT_EDGE_MAX_EXTRA = 10

export function computeHeatOverlay(stats: AggregateFlowStats, nodeIds: string[]): HeatOverlay {
  const nodes: Record<string, NodeHeat> = {}
  for (const id of nodeIds) {
    const count = stats.nodeCounts[id] ?? 0
    const st = stats.nodeStats?.[id]
    nodes[id] = {
      count,
      ratio: stats.maxNodeCount > 0 ? count / stats.maxNodeCount : 0,
      avgDurationMs: st && st.durationCount > 0 ? st.durationTotalMs / st.durationCount : null,
      errorRate: st && st.runs > 0 ? st.errors / st.runs : null,
      errors: st?.errors ?? 0,
    }
  }
  const edges: Record<string, EdgeHeat> = {}
  for (const [id, count] of Object.entries(stats.edgeCounts)) {
    const ratio = stats.maxEdgeCount > 0 ? count / stats.maxEdgeCount : 0
    edges[id] = { count, ratio, width: count > 0 ? HEAT_EDGE_MIN_WIDTH + ratio * HEAT_EDGE_MAX_EXTRA : HEAT_EDGE_MIN_WIDTH }
  }
  return { nodes, edges, maxNodeCount: stats.maxNodeCount, maxEdgeCount: stats.maxEdgeCount }
}

/** Heat colour (theme tokens): primary, stronger with traffic; errors above 5% turn it toward danger. */
export function heatColor(heat: Pick<NodeHeat, 'ratio' | 'count' | 'errorRate'>): string {
  if (heat.count <= 0) return 'var(--theme-muted-text)'
  if ((heat.errorRate ?? 0) > 0.05) return 'var(--theme-danger)'
  return `color-mix(in srgb, var(--theme-primary) ${Math.round(Math.min(95, 35 + heat.ratio * 60))}%, transparent)`
}

export function edgeHeatColor(edge: Pick<EdgeHeat, 'ratio' | 'count'> | undefined): string {
  if (!edge || edge.count <= 0) return 'color-mix(in srgb, var(--theme-muted-text) 25%, transparent)'
  return `color-mix(in srgb, var(--theme-primary) ${Math.round(Math.min(95, 25 + edge.ratio * 70))}%, transparent)`
}

export function formatErrorRate(rate: number | null): string | null {
  if (rate == null) return null
  if (rate === 0) return '0% errors'
  const pct = rate * 100
  return `${pct < 1 ? pct.toFixed(1) : Math.round(pct)}% errors`
}

/** One-line summary for the card badge / title: "12 visits · avg 1.2s · 8% errors". */
export function heatSummary(heat: NodeHeat, formatDuration: (ms: number) => string): string {
  return [
    heat.count === 1 ? '1 visit' : `${heat.count} visits`,
    heat.avgDurationMs != null ? `avg ${formatDuration(heat.avgDurationMs)}` : null,
    heat.errors > 0 ? formatErrorRate(heat.errorRate) : null,
  ].filter(Boolean).join(' · ')
}
