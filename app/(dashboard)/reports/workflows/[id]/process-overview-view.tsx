'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Search, Workflow as WorkflowIcon, Play, Pencil, ExternalLink,
  CheckCircle, XCircle, Clock, Pause, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from 'recharts'
import { formatRelativeDate } from '@/lib/utils'
import type { WorkflowEdge, WorkflowNode } from '@/lib/workflow-schema'
import { normalizeDataTableNodes } from '@/lib/workflow-table-refs'
import { computeHeatOverlay } from '@/lib/workflow-heat-overlay'
import { RuntimeCanvas } from '@/components/automations/runtime-canvas'
import { average, runEdgeTraversals, runNodeVisits, type AggregateFlowStats } from '@/lib/report-flow-stats'
import { formatDuration } from '@/lib/format'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'
import type { ThemePalette } from '@/lib/theme/schema'

const EMPTY_FLOW_STATS: AggregateFlowStats = { nodeCounts: {}, edgeCounts: {}, maxNodeCount: 0, maxEdgeCount: 0 }

interface Props {
  workflow: any
  /** workflow_run_summaries rows (RunSummary: no traces, trace-derived counts). */
  runs: any[]
  /** Per-node/edge heat map, computed on the server; null while loading. */
  flowStats: AggregateFlowStats | null
  queueStats: any[]
  taskById: Record<string, any>
  agentRunsByRunId: Record<string, any[]>
  agentNameById: Record<string, string>
}

type StatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'paused' | 'spiking' | 'duration_spike' | 'traversal_spike'
type SortField = 'id' | 'originator' | 'workers' | 'status' | 'started' | 'finished' | 'duration' | 'durationSpike' | 'traversalSpike'
type SortDir = 'asc' | 'desc'
type ChartPeriod = 'day' | 'week' | 'month'

const STATUS_COLORS: Record<string, string> = {
  completed: 'var(--status-done)',
  failed: 'var(--status-blocked)',
  running: 'var(--status-info)',
  pending: 'var(--status-info)',
  waiting_for_event: 'var(--status-progress)',
  paused: 'var(--status-todo)',
  cancelled: 'var(--status-todo)',
  migrated: 'var(--status-info)',
}

/** Real colour strings for Recharts (which can't resolve CSS variables). */
function statusFill(status: string, palette: ThemePalette): string {
  switch (status) {
    case 'completed': return palette.status.done
    case 'failed': return palette.status.blocked
    case 'running':
    case 'pending':
    case 'migrated': return palette.status.info
    case 'waiting_for_event': return palette.status.progress
    case 'paused':
    case 'cancelled': return palette.status.todo
    default: return palette.mutedText
  }
}

function durationMs(run: any): number | null {
  if (!run.started_at) return null
  if (run.completed_at) return new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()
  if (run.status === 'running' || run.status === 'pending') {
    return Date.now() - new Date(run.started_at).getTime()
  }
  return null
}

function statusLabel(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? 'var(--theme-muted-text)'
  const Icon = status === 'completed' ? CheckCircle
    : status === 'failed' ? XCircle
    : status === 'paused' || status === 'waiting_for_event' ? Pause
    : status === 'running' || status === 'pending' ? Play
    : Clock
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`, color }}
    >
      <Icon size={9} /> {statusLabel(status)}
    </span>
  )
}

export function ProcessOverviewView({ workflow, runs, flowStats, queueStats, taskById, agentRunsByRunId, agentNameById }: Props) {
  const { palette } = useWorkspaceTheme()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('day')
  const [sortField, setSortField] = useState<SortField>('started')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const variableDefs: { name: string; type: string; defaultValue?: any }[] = Array.isArray(workflow.user_variables) ? workflow.user_variables : []

  // KPI tiles
  const tiles = useMemo(() => {
    const total = runs.length
    const active = runs.filter(r => r.status === 'running' || r.status === 'pending' || r.status === 'waiting_for_event' || r.status === 'paused').length + queueStats.length
    const errors = runs.filter(r => r.status === 'failed').length
    const paused = runs.filter(r => r.status === 'paused' || r.status === 'waiting_for_event').length
    const completed = runs.filter(r => r.status === 'completed')
    const completionMs = completed
      .filter(r => r.started_at && r.completed_at)
      .map(r => new Date(r.completed_at).getTime() - new Date(r.started_at).getTime())
    const avgMs = completionMs.length > 0 ? completionMs.reduce((s, v) => s + v, 0) / completionMs.length : 0
    const avgNodeVisits = total > 0
      ? Math.round((runs.reduce((sum, run) => sum + runNodeVisits(run, true), 0) / total) * 10) / 10
      : 0
    const avgEdgeTraversals = total > 0
      ? Math.round((runs.reduce((sum, run) => sum + runEdgeTraversals(run), 0) / total) * 10) / 10
      : 0

    const lastActivity = runs[0]?.started_at ?? null
    const lastActivityText = lastActivity ? formatRelativeDate(lastActivity) : '—'

    return {
      total,
      active,
      errors,
      paused,
      avgDuration: formatDuration(avgMs),
      avgNodeVisits,
      avgEdgeTraversals,
      lastActivity: lastActivityText,
    }
  }, [runs, queueStats])

  // Instances Started trend — bucketed by the selected chart period.
  const trendData = useMemo(() => {
    const buckets = new Map<string, number>()
    for (const r of runs) {
      if (!r.started_at) continue
      const d = new Date(r.started_at)
      let key: string
      if (chartPeriod === 'day') {
        key = d.toISOString().split('T')[0]
      } else if (chartPeriod === 'week') {
        // ISO week (year-week) bucketing — keeps sorting trivial since
        // the string sorts lexicographically the same as chronologically.
        const jan1 = new Date(d.getFullYear(), 0, 1)
        const days = Math.floor((d.getTime() - jan1.getTime()) / 86_400_000)
        const week = Math.ceil((days + jan1.getDay() + 1) / 7)
        key = `${d.getFullYear()}-W${String(week).padStart(2, '0')}`
      } else {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      }
      buckets.set(key, (buckets.get(key) ?? 0) + 1)
    }
    return [...buckets.entries()].sort().map(([name, runs]) => ({ name, runs }))
  }, [runs, chartPeriod])

  // Status distribution for the second chart
  const statusDistribution = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of runs) counts.set(r.status, (counts.get(r.status) ?? 0) + 1)
    return [...counts.entries()].map(([status, count]) => ({
      name: statusLabel(status),
      value: count,
      fill: statusFill(status, palette),
    }))
  }, [runs, palette])

  const anomalyInsights = useMemo(() => {
    const windowMs = Math.max(1, Math.floor(90 * 86_400_000 / 2))
    const recentStart = Date.now() - windowMs
    const baselineStart = recentStart - windowMs
    const recentDurations: number[] = []
    const baselineDurations: number[] = []
    const recentTraversals: number[] = []
    const baselineTraversals: number[] = []

    for (const run of runs) {
      if (!run.started_at) continue
      const startedAt = new Date(run.started_at).getTime()
      const duration = durationMs(run)
      const traversals = runEdgeTraversals(run)

      if (startedAt >= recentStart) {
        if (duration && duration > 0) recentDurations.push(duration)
        recentTraversals.push(traversals)
      } else if (startedAt >= baselineStart) {
        if (duration && duration > 0) baselineDurations.push(duration)
        baselineTraversals.push(traversals)
      }
    }

    const recentDurationAvg = average(recentDurations)
    const baselineDurationAvg = average(baselineDurations)
    const recentTraversalAvg = average(recentTraversals)
    const baselineTraversalAvg = average(baselineTraversals)

    return {
      recentRunCount: recentDurations.length || recentTraversals.length,
      baselineRunCount: baselineDurations.length || baselineTraversals.length,
      recentDurationAvg,
      baselineDurationAvg,
      recentTraversalAvg,
      baselineTraversalAvg,
      durationSpikeRatio: baselineDurationAvg > 0 ? recentDurationAvg / baselineDurationAvg : 0,
      traversalSpikeRatio: baselineTraversalAvg > 0 ? recentTraversalAvg / baselineTraversalAvg : 0,
      recentStart,
    }
  }, [runs])

  const spikeTrendData = useMemo(() => {
    const buckets = new Map<string, { durations: number[]; traversals: number[] }>()

    for (const run of runs) {
      if (!run.started_at) continue
      const started = new Date(run.started_at)
      let key: string
      if (chartPeriod === 'day') {
        key = started.toISOString().split('T')[0]
      } else if (chartPeriod === 'week') {
        const jan1 = new Date(started.getFullYear(), 0, 1)
        const days = Math.floor((started.getTime() - jan1.getTime()) / 86_400_000)
        const week = Math.ceil((days + jan1.getDay() + 1) / 7)
        key = `${started.getFullYear()}-W${String(week).padStart(2, '0')}`
      } else {
        key = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}`
      }

      const bucket = buckets.get(key) ?? { durations: [], traversals: [] }
      const runDuration = durationMs(run)
      if (runDuration && runDuration > 0) bucket.durations.push(runDuration)
      bucket.traversals.push(runEdgeTraversals(run))
      buckets.set(key, bucket)
    }

    return [...buckets.entries()].sort().map(([name, bucket]) => ({
      name,
      avgDurationMs: Math.round(average(bucket.durations)),
      avgTraversals: Math.round(average(bucket.traversals) * 10) / 10,
    }))
  }, [runs, chartPeriod])

  // Filtered + sorted rows
  const tableRows = useMemo(() => {
    const filtered = runs.filter(r => {
      const agentRuns = agentRunsByRunId[r.id] ?? []
      const workerNames = [...new Set(
        agentRuns
          .map((run: any) => run.agent?.name ?? null)
          .filter(Boolean)
      )].join(', ')
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !(r.status === 'running' || r.status === 'pending')) return false
        if (statusFilter === 'completed' && r.status !== 'completed') return false
        if (statusFilter === 'failed' && r.status !== 'failed') return false
        if (statusFilter === 'paused' && !(r.status === 'paused' || r.status === 'waiting_for_event')) return false
        if (statusFilter === 'spiking') {
          const isDurationSpike = anomalyInsights.baselineDurationAvg > 0 && durationMs(r) != null
            ? (durationMs(r)! / anomalyInsights.baselineDurationAvg) >= 1.25
            : false
          const isTraversalSpike = anomalyInsights.baselineTraversalAvg > 0
            ? (runEdgeTraversals(r) / anomalyInsights.baselineTraversalAvg) >= 1.25
            : false
          if (!isDurationSpike && !isTraversalSpike) return false
        }
        if (statusFilter === 'duration_spike') {
          const isDurationSpike = anomalyInsights.baselineDurationAvg > 0 && durationMs(r) != null
            ? (durationMs(r)! / anomalyInsights.baselineDurationAvg) >= 1.25
            : false
          if (!isDurationSpike) return false
        }
        if (statusFilter === 'traversal_spike') {
          const isTraversalSpike = anomalyInsights.baselineTraversalAvg > 0
            ? (runEdgeTraversals(r) / anomalyInsights.baselineTraversalAvg) >= 1.25
            : false
          if (!isTraversalSpike) return false
        }
      }
      if (search) {
        const q = search.toLowerCase()
        const task = taskById[r.task_id]
        const originator = task?.creator?.display_name ?? task?.creator?.email ?? ''
        if (!r.id.toLowerCase().includes(q)
          && !(r.title ?? '').toLowerCase().includes(q)
          && !originator.toLowerCase().includes(q)
          && !workerNames.toLowerCase().includes(q)
          && !(r.error ?? '').toLowerCase().includes(q)) {
          return false
        }
      }
      return true
    })

    const rows = filtered.map(r => {
      const task = taskById[r.task_id]
      const originator = task?.creator?.display_name ?? task?.creator?.email ?? (r.task_id ? 'Unknown' : 'System')
      const agentRuns = agentRunsByRunId[r.id] ?? []
      const workerNames = [...new Set(
        agentRuns
          .map((run: any) => run.agent?.name ?? null)
          .filter(Boolean)
      )]
      const workerLabel = workerNames.length > 0
        ? workerNames.join(', ')
        : 'Workflow / Human'
      return {
        id: r.id,
        shortId: r.id.slice(0, 8),
        title: r.title ?? task?.title ?? '—',
        originator,
        workers: workerLabel,
        workerCount: agentRuns.length,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: durationMs(r),
        nodeVisits: runNodeVisits(r, true),
        edgeTraversals: runEdgeTraversals(r),
        durationSpikeRatio: anomalyInsights.baselineDurationAvg > 0 && durationMs(r) != null
          ? (durationMs(r)! / anomalyInsights.baselineDurationAvg)
          : 0,
        traversalSpikeRatio: anomalyInsights.baselineTraversalAvg > 0
          ? (runEdgeTraversals(r) / anomalyInsights.baselineTraversalAvg)
          : 0,
        error: r.error,
      }
    })

    rows.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'id': cmp = a.shortId.localeCompare(b.shortId); break
        case 'originator': cmp = a.originator.localeCompare(b.originator); break
        case 'workers': cmp = a.workers.localeCompare(b.workers); break
        case 'status': cmp = a.status.localeCompare(b.status); break
        case 'started':
          cmp = (a.startedAt ? new Date(a.startedAt).getTime() : 0) - (b.startedAt ? new Date(b.startedAt).getTime() : 0)
          break
        case 'finished':
          cmp = (a.completedAt ? new Date(a.completedAt).getTime() : 0) - (b.completedAt ? new Date(b.completedAt).getTime() : 0)
          break
        case 'duration':
          cmp = (a.durationMs ?? 0) - (b.durationMs ?? 0)
          break
        case 'durationSpike':
          cmp = a.durationSpikeRatio - b.durationSpikeRatio
          break
        case 'traversalSpike':
          cmp = a.traversalSpikeRatio - b.traversalSpikeRatio
          break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [runs, taskById, agentRunsByRunId, search, statusFilter, sortField, sortDir, anomalyInsights])

  const aggregateFlow = flowStats ?? EMPTY_FLOW_STATS
  const agentExecutionSummary = useMemo(() => {
    const allRuns = Object.values(agentRunsByRunId).flat()
    const runsWithAgents = runs.filter((run) => (agentRunsByRunId[run.id]?.length ?? 0) > 0).length
    const uniqueAgents = new Set(
      allRuns
        .map((run: any) => run.agent?.name ?? run.agent_id ?? null)
        .filter(Boolean)
    )
    return {
      totalExecutions: allRuns.length,
      runsWithAgents,
      uniqueAgents: uniqueAgents.size,
    }
  }, [agentRunsByRunId, runs])

  const paginatedRows = tableRows.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize))

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'originator' || field === 'id' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  return (
    <div className="space-y-6">
      {/* Header with breadcrumb */}
      <div>
        <div className="flex items-center gap-1.5 text-[11px] mb-2" style={{ color: 'var(--theme-muted-text)' }}>
          <Link href="/reports" className="hover:underline">Reports</Link>
          <span>›</span>
          <Link href="/reports/workflows" className="hover:underline">Workflow Processes</Link>
          <span>›</span>
          <span style={{ color: 'var(--theme-card-text)' }}>{workflow.name}</span>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/reports/workflows" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
              <ArrowLeft size={18} />
            </Link>
            <div>
              <div className="flex items-center gap-2">
                <WorkflowIcon size={18} style={{ color: 'var(--theme-primary-text)' }} />
                <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>{workflow.name}</h1>
                {!workflow.is_active && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                    inactive
                  </span>
                )}
              </div>
              {workflow.description && (
                <p className="text-xs mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>{workflow.description}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/reports/workflows/compare?a=${workflow.id}`}>
              <Button size="sm" variant="outline">Compare with another workflow</Button>
            </Link>
            <Link href={`/automations/${workflow.id}`}>
              <Button size="sm" variant="outline"><Pencil size={13} className="mr-1" /> Open in builder</Button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI tiles */}
      <ReportMetricRow
        metrics={[
          { label: 'Total Instances', value: tiles.total },
          { label: 'Active Instances', value: tiles.active, subtitle: 'running or queued' },
          { label: 'Instances in Error', value: tiles.errors, subtitle: tiles.errors > 0 ? 'needs attention' : 'healthy' },
          { label: 'Paused / Waiting', value: tiles.paused },
          { label: 'Avg Duration', value: tiles.avgDuration },
          { label: 'Avg Node Visits', value: tiles.avgNodeVisits, subtitle: 'per instance' },
          { label: 'Avg Edge Traversals', value: tiles.avgEdgeTraversals, subtitle: 'per instance' },
          { label: 'Last Activity', value: tiles.lastActivity },
        ]}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="!p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Duration Spike</h3>
              <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Recent runs compared with the immediately prior window for this workflow.
              </p>
            </div>
            <span
              className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold"
              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)', color: 'var(--theme-danger)' }}
            >
              {anomalyInsights.durationSpikeRatio >= 1.25 ? `${anomalyInsights.durationSpikeRatio.toFixed(1)}x slower` : 'stable'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
              <div style={{ color: 'var(--theme-muted-text)' }}>Recent avg</div>
              <div style={{ color: 'var(--theme-card-text)' }}>{formatDuration(anomalyInsights.recentDurationAvg)}</div>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
              <div style={{ color: 'var(--theme-muted-text)' }}>Baseline avg</div>
              <div style={{ color: 'var(--theme-card-text)' }}>{formatDuration(anomalyInsights.baselineDurationAvg)}</div>
            </div>
          </div>
        </Card>

        <Card className="!p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Traversal Spike</h3>
              <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Recent traversal complexity compared with the prior window.
              </p>
            </div>
            <span
              className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold"
              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}
            >
              {anomalyInsights.traversalSpikeRatio >= 1.25 ? `${anomalyInsights.traversalSpikeRatio.toFixed(1)}x traversals` : 'stable'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
              <div style={{ color: 'var(--theme-muted-text)' }}>Recent avg</div>
              <div style={{ color: 'var(--theme-card-text)' }}>{anomalyInsights.recentTraversalAvg.toFixed(1)}</div>
            </div>
            <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
              <div style={{ color: 'var(--theme-muted-text)' }}>Baseline avg</div>
              <div style={{ color: 'var(--theme-card-text)' }}>{anomalyInsights.baselineTraversalAvg.toFixed(1)}</div>
            </div>
          </div>
        </Card>
      </div>

      <Card className="!p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Spike Trend</h3>
            <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Average duration and traversal complexity over time to show whether the anomaly is a burst or a sustained pattern.
            </p>
          </div>
          <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
            grouped by {chartPeriod}
          </span>
        </div>
        {spikeTrendData.length === 0 ? (
          <p className="text-xs py-12 text-center" style={{ color: 'var(--theme-muted-text)' }}>Not enough runs yet to chart anomaly trends.</p>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={spikeTrendData}>
              <defs>
                <linearGradient id="wfDurationTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.danger} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={palette.danger} stopOpacity={0.04} />
                </linearGradient>
                <linearGradient id="wfTraversalTrend" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.warning} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={palette.warning} stopOpacity={0.03} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
              <YAxis
                yAxisId="duration"
                tick={{ fontSize: 10, fill: palette.danger }}
                tickFormatter={(value) => formatDuration(Number(value))}
              />
              <YAxis
                yAxisId="traversals"
                orientation="right"
                tick={{ fontSize: 10, fill: palette.warning }}
              />
              <Tooltip
                formatter={(value: string | number | readonly (string | number)[] | undefined, name: string | number | undefined) => {
                  const rawValue = Array.isArray(value) ? value[0] : value
                  const numericValue = typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0)
                  if (name === 'avgDurationMs') return [formatDuration(numericValue), 'Avg duration']
                  return [numericValue, 'Avg traversals']
                }}
                contentStyle={{
                  fontSize: 12,
                  borderRadius: 8,
                  backgroundColor: 'var(--theme-card-bg)',
                  border: '1px solid var(--theme-surface-border)',
                  color: 'var(--theme-card-text)',
                }}
              />
              <Area
                yAxisId="duration"
                type="monotone"
                dataKey="avgDurationMs"
                name="avgDurationMs"
                stroke={palette.danger}
                strokeWidth={2}
                fill="url(#wfDurationTrend)"
              />
              <Area
                yAxisId="traversals"
                type="monotone"
                dataKey="avgTraversals"
                name="avgTraversals"
                stroke={palette.warning}
                strokeWidth={2}
                fill="url(#wfTraversalTrend)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* Workflow variables display — only rendered if the workflow defines
          any user variables. Shows the schema (name + type) as a chip row
          and is a visual reminder for the reader of what inputs this
          workflow expects. Individual run values are shown in the detail
          view (ProcessViewer variables tab). */}
      {variableDefs.length > 0 && (
        <Card className="!p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Workflow Variables</h3>
            <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              {variableDefs.length} defined — open an instance to see values
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {variableDefs.map((v, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-mono"
                style={{ backgroundColor: 'var(--theme-surface)', border: '1px solid var(--theme-surface-border)' }}
              >
                <span style={{ color: 'var(--theme-card-text)' }}>{v.name}</span>
                <span className="text-[9px] px-1 rounded" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                  {v.type ?? 'text'}
                </span>
                {v.defaultValue != null && v.defaultValue !== '' && (
                  <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    = {String(v.defaultValue).slice(0, 20)}
                  </span>
                )}
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Trend + status charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="!p-4 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Instances Started</h3>
            <select
              value={chartPeriod}
              onChange={e => setChartPeriod(e.target.value as ChartPeriod)}
              className="rounded border px-2 py-0.5 text-[10px]"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            >
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </div>
          {trendData.length === 0 ? (
            <p className="text-xs py-12 text-center" style={{ color: 'var(--theme-muted-text)' }}>No runs yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="wfOverviewGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={palette.primary} stopOpacity={0.4} />
                    <stop offset="100%" stopColor={palette.primary} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12, borderRadius: 8,
                    backgroundColor: 'var(--theme-card-bg)',
                    border: '1px solid var(--theme-surface-border)',
                    color: 'var(--theme-card-text)',
                  }}
                />
                <Area type="monotone" dataKey="runs" stroke={palette.primary} strokeWidth={2} fill="url(#wfOverviewGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="!p-4">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-card-text)' }}>Status Distribution</h3>
          {statusDistribution.length === 0 ? (
            <p className="text-xs py-12 text-center" style={{ color: 'var(--theme-muted-text)' }}>No runs yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusDistribution} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
                <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} width={90} />
                <Tooltip
                  contentStyle={{
                    fontSize: 12, borderRadius: 8,
                    backgroundColor: 'var(--theme-card-bg)',
                    border: '1px solid var(--theme-surface-border)',
                    color: 'var(--theme-card-text)',
                  }}
                  cursor={{ fill: 'var(--theme-surface)' }}
                />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {statusDistribution.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <AggregateProcessMap
        workflow={workflow}
        runs={runs}
        aggregateFlow={aggregateFlow}
        agentExecutionSummary={agentExecutionSummary}
        agentNameById={agentNameById}
      />

      {/* All Instances table */}
      <Card className="!p-0 overflow-hidden">
        <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Search by instance ID, title, originator, agent, or error…"
              className="pl-8 !h-8 !text-xs"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as StatusFilter); setPage(1) }}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="paused">Paused / Waiting</option>
            <option value="spiking">Any spike</option>
            <option value="duration_spike">Duration spike</option>
            <option value="traversal_spike">Traversal spike</option>
          </select>
          <span className="text-[10px] ml-auto" style={{ color: 'var(--theme-muted-text)' }}>
            {tableRows.length} of {runs.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                <SortableHeader label="ID" field="id" sortField={sortField} sortDir={sortDir} onClick={toggleSort} className="pl-4" />
                <th className="text-left py-2 font-medium uppercase text-[10px] tracking-wider">Title</th>
                <SortableHeader label="Originator" field="originator" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Work Done By" field="workers" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Started" field="started" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Finished" field="finished" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Duration" field="duration" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Duration Spike" field="durationSpike" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Traversal Spike" field="traversalSpike" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <th className="text-right pr-4 py-2 font-medium uppercase text-[10px] tracking-wider">View</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.length === 0 ? (
                <tr><td colSpan={11} className="text-center py-12" style={{ color: 'var(--theme-muted-text)' }}>
                  {search || statusFilter !== 'all' ? 'No instances match your filters.' : 'No instances yet.'}
                </td></tr>
              ) : (
                paginatedRows.map(row => (
                  <tr
                    key={row.id}
                    className="border-t transition-colors hover:bg-[var(--theme-row-highlight)]"
                    style={{ borderColor: 'var(--theme-surface-border)' }}
                  >
                    <td className="pl-4 py-2.5">
                      <Link
                        href={`/automations/runs/${row.id}`}
                        className="font-mono text-[10px] hover:underline"
                        style={{ color: 'var(--theme-primary-text)' }}
                        title={row.id}
                      >
                        {row.shortId}
                      </Link>
                    </td>
                    <td className="py-2.5 max-w-[240px]" style={{ color: 'var(--theme-card-text)' }}>
                      <div className="truncate" title={row.title}>{row.title}</div>
                      <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>
                        {row.nodeVisits} visits · {row.edgeTraversals} traversals
                      </div>
                      {(row.durationSpikeRatio >= 1.25 || row.traversalSpikeRatio >= 1.25) && (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {row.durationSpikeRatio >= 1.25 && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)', color: 'var(--theme-danger)' }}
                            >
                              {row.durationSpikeRatio.toFixed(1)}x duration
                            </span>
                          )}
                          {row.traversalSpikeRatio >= 1.25 && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                              style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}
                            >
                              {row.traversalSpikeRatio.toFixed(1)}x traversals
                            </span>
                          )}
                        </div>
                      )}
                      {row.error && (
                        <div className="truncate text-[10px] mt-0.5" style={{ color: 'var(--theme-danger)' }} title={row.error}>
                          <AlertTriangle size={8} className="inline mr-1" />
                          {row.error.slice(0, 60)}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5" style={{ color: 'var(--theme-muted-text)' }}>{row.originator}</td>
                    <td className="py-2.5" style={{ color: 'var(--theme-muted-text)' }}>
                      <div className="max-w-[220px] truncate" title={row.workers}>{row.workers}</div>
                      {row.workerCount > 0 && (
                        <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-primary-text)' }}>
                          {row.workerCount === 1 ? '1 agent execution' : `${row.workerCount} agent executions`}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5"><StatusBadge status={row.status} /></td>
                    <td className="py-2.5" style={{ color: 'var(--theme-muted-text)' }}>
                      {row.startedAt ? formatRelativeDate(row.startedAt) : '—'}
                    </td>
                    <td className="py-2.5" style={{ color: 'var(--theme-muted-text)' }}>
                      {row.completedAt ? formatRelativeDate(row.completedAt) : '—'}
                    </td>
                    <td className="text-right py-2.5 font-mono text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
                      {row.durationMs != null ? formatDuration(row.durationMs) : '—'}
                    </td>
                    <td className="text-right py-2.5 font-mono text-[11px]" style={{ color: row.durationSpikeRatio >= 1.25 ? 'var(--theme-danger)' : 'var(--theme-card-text)' }}>
                      {row.durationSpikeRatio > 0 ? `${row.durationSpikeRatio.toFixed(1)}x` : '—'}
                    </td>
                    <td className="text-right py-2.5 font-mono text-[11px]" style={{ color: row.traversalSpikeRatio >= 1.25 ? 'var(--theme-warning)' : 'var(--theme-card-text)' }}>
                      {row.traversalSpikeRatio > 0 ? `${row.traversalSpikeRatio.toFixed(1)}x` : '—'}
                    </td>
                    <td className="pr-4 py-2.5 text-right">
                      <Link
                        href={`/automations/runs/${row.id}${row.durationSpikeRatio >= 1.25 ? '?focus=duration' : row.traversalSpikeRatio >= 1.25 ? '?focus=traversal' : ''}`}
                        className="inline-flex items-center gap-1 text-[10px] hover:underline"
                        style={{ color: 'var(--theme-primary-text)' }}
                      >
                        View / Compare Run <ExternalLink size={9} />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {tableRows.length > pageSize && (
          <div className="flex items-center justify-between p-3 border-t text-[11px]" style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}>
            <span>Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, tableRows.length)} of {tableRows.length}</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >
                ← Prev
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

function AggregateProcessMap({
  workflow,
  runs,
  aggregateFlow,
  agentExecutionSummary,
  agentNameById,
}: {
  workflow: any
  runs: any[]
  aggregateFlow: AggregateFlowStats
  agentExecutionSummary: { totalExecutions: number; runsWithAgents: number; uniqueAgents: number }
  agentNameById: Record<string, string>
}) {
  // Agent steps show the agent's current name (display only).
  const nodes = useMemo(() => (normalizeDataTableNodes((workflow.nodes as any[]) ?? []) as WorkflowNode[]).map((n) =>
    n.type === 'run_agent' && agentNameById[String(n.config?.agent_id ?? '')]
      ? { ...n, config: { ...(n.config ?? {}), agent_name: agentNameById[String(n.config?.agent_id)] } }
      : n), [workflow.nodes, agentNameById])
  const edges = useMemo(() => ((workflow.edges as any[]) ?? []) as WorkflowEdge[], [workflow.edges])
  const swimlanes = Array.isArray(workflow.swimlanes) ? workflow.swimlanes : []
  // The shared step cards with a heat overlay: visits, average duration, error rate.
  const heat = useMemo(() => computeHeatOverlay(aggregateFlow, nodes.map((n) => n.id)), [aggregateFlow, nodes])

  return (
    <Card className="!p-4 space-y-4 overflow-hidden">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Process Flow Overview</h3>
          <p className="text-[11px] mt-1 max-w-2xl" style={{ color: 'var(--theme-muted-text)' }}>
            This view aggregates all workflow instances and highlights where most runs travel. Thicker, brighter connections indicate the most common paths; each step shows its visits, average duration and error rate.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            {runs.length} total runs
          </span>
          <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 12%, transparent)', color: 'var(--theme-warning)' }}>
            {agentExecutionSummary.totalExecutions} agent executions
          </span>
          <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 12%, transparent)', color: 'var(--status-info)' }}>
            {agentExecutionSummary.runsWithAgents} runs with agents
          </span>
          <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'var(--theme-accent-light)', color: 'var(--theme-primary-text)' }}>
            max edge volume {aggregateFlow.maxEdgeCount}
          </span>
          <span className="px-2 py-1 rounded-full" style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 12%, transparent)', color: 'var(--status-info)' }}>
            max node visits {aggregateFlow.maxNodeCount}
          </span>
        </div>
      </div>

      <RuntimeCanvas
        nodes={nodes}
        edges={edges}
        swimlanes={swimlanes}
        heat={heat}
        workflowId={workflow.id}
        storageScope={workflow.id ? `heat:${workflow.id}` : undefined}
        markerPrefix="heat-arrow"
        label="Process flow heat map"
      />
    </Card>
  )
}

function SortableHeader({
  label, field, sortField, sortDir, onClick, align = 'left', className = '',
}: {
  label: string
  field: SortField
  sortField: SortField
  sortDir: SortDir
  onClick: (f: SortField) => void
  align?: 'left' | 'right'
  className?: string
}) {
  const active = sortField === field
  return (
    <th
      className={`py-2 font-medium uppercase text-[10px] tracking-wider cursor-pointer select-none hover:text-[var(--theme-card-text)] ${align === 'right' ? 'text-right' : 'text-left'} ${className}`}
      onClick={() => onClick(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />) : <ArrowUpDown size={10} className="opacity-40" />}
      </span>
    </th>
  )
}
