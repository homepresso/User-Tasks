import { readFileSync } from 'fs'
import path from 'path'
import { describe, expect, it } from 'vitest'
import { buildAggregateFlowStats } from '@/lib/report-flow-stats'
import { computeHeatOverlay, edgeHeatColor, formatErrorRate, HEAT_EDGE_MAX_EXTRA, HEAT_EDGE_MIN_WIDTH, heatColor, heatSummary } from '@/lib/workflow-heat-overlay'

const workflow = {
  nodes: [
    { id: 'trg', type: 'webhook', position: { x: 0, y: 0 } },
    { id: 'get', type: 'call_reference', position: { x: 0, y: 140 } },
    { id: 'ok', type: 'log', position: { x: 0, y: 280 } },
  ],
  edges: [
    { id: 'e1', source: 'trg', target: 'get' },
    { id: 'e2', source: 'get', target: 'ok' },
  ],
}
const run = (results: Record<string, unknown>) => ({ id: Math.random().toString(36), node_results: results, execution_trace: [] })

describe('aggregate flow stats per step', () => {
  const runs = [
    run({ trg: { status: 'success', duration_ms: 2 }, get: { status: 'success', duration_ms: 100 }, ok: { status: 'success', duration_ms: 1 } }),
    run({ trg: { status: 'success', duration_ms: 4 }, get: { status: 'error', duration_ms: 300, error: 'timeout' } }),
    run({ trg: { status: 'success' }, get: { status: 'error', duration_ms: 200 } }),
    run({ trg: { status: 'success', duration_ms: 3 }, get: { status: 'success', duration_ms: 400 }, ok: { status: 'success', duration_ms: 1 } }),
  ]
  const stats = buildAggregateFlowStats(workflow, runs)

  it('counts runs, errors and durations from node_results', () => {
    expect(stats.nodeStats?.get).toEqual({ runs: 4, errors: 2, durationTotalMs: 1000, durationCount: 4 })
    expect(stats.nodeStats?.trg).toEqual({ runs: 4, errors: 0, durationTotalMs: 9, durationCount: 3 })
    expect(stats.nodeCounts.trg).toBe(4)
    expect(stats.edgeCounts.e2).toBe(2)
  })

  it('maps to the heat overlay: ratio, average duration, error rate, edge widths', () => {
    const heat = computeHeatOverlay(stats, ['trg', 'get', 'ok', 'never'])
    expect(heat.nodes.get).toEqual({ count: 4, ratio: 1, avgDurationMs: 250, errorRate: 0.5, errors: 2 })
    expect(heat.nodes.trg.avgDurationMs).toBe(3)
    expect(heat.nodes.ok.ratio).toBe(0.5)
    expect(heat.nodes.never).toEqual({ count: 0, ratio: 0, avgDurationMs: null, errorRate: null, errors: 0 })
    expect(heat.edges.e1.width).toBe(HEAT_EDGE_MIN_WIDTH + HEAT_EDGE_MAX_EXTRA)
    expect(heat.edges.e2.width).toBe(HEAT_EDGE_MIN_WIDTH + 0.5 * HEAT_EDGE_MAX_EXTRA)
  })

  it('older stats without nodeStats still map (counts only)', () => {
    const heat = computeHeatOverlay({ nodeCounts: { a: 2 }, edgeCounts: {}, maxNodeCount: 2, maxEdgeCount: 0 }, ['a'])
    expect(heat.nodes.a).toEqual({ count: 2, ratio: 1, avgDurationMs: null, errorRate: null, errors: 0 })
  })
})

describe('heat colours and labels', () => {
  it('uses theme tokens: primary by traffic, danger above 5% errors, muted when idle', () => {
    expect(heatColor({ count: 0, ratio: 0, errorRate: null })).toBe('var(--theme-muted-text)')
    expect(heatColor({ count: 5, ratio: 1, errorRate: 0 })).toBe('color-mix(in srgb, var(--theme-primary) 95%, transparent)')
    expect(heatColor({ count: 5, ratio: 0, errorRate: 0.02 })).toBe('color-mix(in srgb, var(--theme-primary) 35%, transparent)')
    expect(heatColor({ count: 5, ratio: 0.2, errorRate: 0.5 })).toBe('var(--theme-danger)')
    expect(edgeHeatColor(undefined)).toContain('--theme-muted-text')
    expect(edgeHeatColor({ count: 3, ratio: 1 })).toBe('color-mix(in srgb, var(--theme-primary) 95%, transparent)')
  })
  it('summaries', () => {
    expect(formatErrorRate(null)).toBeNull()
    expect(formatErrorRate(0)).toBe('0% errors')
    expect(formatErrorRate(0.004)).toBe('0.4% errors')
    expect(formatErrorRate(0.5)).toBe('50% errors')
    const fmt = (ms: number) => `${ms}ms`
    expect(heatSummary({ count: 4, ratio: 1, avgDurationMs: 250, errorRate: 0.5, errors: 2 }, fmt)).toBe('4 visits · avg 250ms · 50% errors')
    expect(heatSummary({ count: 1, ratio: 1, avgDurationMs: null, errorRate: 0, errors: 0 }, fmt)).toBe('1 visit')
  })
})

describe('the reports process map uses the shared cards', () => {
  const read = (f: string) => readFileSync(path.join(process.cwd(), f), 'utf8')
  it('RuntimeCanvas with a heat overlay, no bespoke heat cards or SVG', () => {
    const src = read('app/(dashboard)/reports/workflows/[id]/process-overview-view.tsx')
    expect(src).toContain('<RuntimeCanvas')
    expect(src).toContain('heat={heat}')
    expect(src).toContain('computeHeatOverlay(')
    expect(src).not.toContain('routeEdges(')
    expect(src).not.toContain('className="absolute w-56 rounded-2xl')
    const card = read('components/automations/workflow-node-card.tsx')
    expect(card).toContain('data-heat-badge')
    const edges = read('components/automations/edge-renderer.tsx')
    expect(edges).toContain('data-edge-heat')
  })
})
