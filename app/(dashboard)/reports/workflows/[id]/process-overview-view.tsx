'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import {
  Workflow as WorkflowIcon, Play, Pencil, ExternalLink,
  CheckCircle, Clock, AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown,
} from 'lucide-react'
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell,
} from 'recharts'
import { SearchInput } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/ui/page-header'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Badge, StatusPill, Tag } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { Table, THead, TBody, TR, TH, TD, TableEmpty } from '@/components/ui/table'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import {
  AXIS_TICK, BAND_GAP, BAR_MAX, BASE_AXIS, CURSOR_FILL, ChartFrame, ChartTooltip, GRID_PROPS, LEGEND_PROPS, VALUE_AXIS, useSeriesColors,
} from '@/components/reports/chart-kit'
import { formatRelative } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'
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
  /** Stored run variables by run id (only with workflows.view). */
  variablesByRunId?: Record<string, Record<string, unknown>>
}

/** A stored variable value as table text. */
function variableText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

type StatusFilter = 'all' | 'active' | 'completed' | 'failed' | 'paused' | 'spiking' | 'duration_spike' | 'traversal_spike'
type SortField = 'id' | 'originator' | 'workers' | 'status' | 'started' | 'finished' | 'duration' | 'durationSpike' | 'traversalSpike'
type SortDir = 'asc' | 'desc'
type ChartPeriod = 'day' | 'week' | 'month'


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


export function ProcessOverviewView({ workflow, runs, flowStats, queueStats, taskById, agentRunsByRunId, agentNameById, variablesByRunId }: Props) {
  const { palette } = useWorkspaceTheme()
  const [seriesA, seriesB] = useSeriesColors(2)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [chartPeriod, setChartPeriod] = useState<ChartPeriod>('day')
  const [sortField, setSortField] = useState<SortField>('started')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [page, setPage] = useState(1)
  const pageSize = 25

  const variableDefs: { name: string; type: string; defaultValue?: any }[] = Array.isArray(workflow.user_variables) ? workflow.user_variables : []
  // Up to three declared inputs shown on each instance (values stored when
  // the run completed, failed or paused).
  const shownVariables = variablesByRunId ? variableDefs.map((v) => v.name).filter(Boolean).slice(0, 3) : []

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
    const lastActivityText = lastActivity ? formatRelative(lastActivity) : '—'

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
        variables: variablesByRunId?.[r.id] ?? null,
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

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'originator' || field === 'id' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  const durationSpiking = anomalyInsights.durationSpikeRatio >= 1.25
  const traversalSpiking = anomalyInsights.traversalSpikeRatio >= 1.25

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Workflows', href: '/reports/workflows' }, { label: workflow.name }]}
        icon={<WorkflowIcon />}
        title={workflow.name}
        badge={!workflow.is_active ? <StatusPill status="inactive" /> : undefined}
        description={workflow.description || undefined}
        className="mb-0"
        actions={
          <>
            <Button asChild variant="secondary">
              <Link href={`/reports/workflows/compare?a=${workflow.id}`}>Compare</Link>
            </Button>
            <Button asChild variant="secondary" leadingIcon={<Pencil />}>
              <Link href={`/automations/${workflow.id}`}>Open in builder</Link>
            </Button>
          </>
        }
      />

      {/* KPI tiles */}
      <ReportMetricRow
        metrics={[
          { label: 'Instances', value: tiles.total },
          { label: 'Active', value: tiles.active, subtitle: 'running or queued' },
          { label: 'In error', value: tiles.errors, subtitle: tiles.errors > 0 ? 'need attention' : 'healthy', tone: tiles.errors > 0 ? 'danger' : undefined },
          { label: 'Avg duration', value: tiles.avgDuration, subtitle: `${tiles.paused} paused or waiting · last activity ${tiles.lastActivity}` },
        ]}
      />

      {durationSpiking || traversalSpiking ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {durationSpiking && (
            <SpikeCard
              title="Duration spike"
              subtitle="Recent runs compared with the prior window"
              metric={`${anomalyInsights.durationSpikeRatio.toFixed(1)}× slower`}
              tone="danger"
              stats={[['Recent avg', formatDuration(anomalyInsights.recentDurationAvg)], ['Baseline avg', formatDuration(anomalyInsights.baselineDurationAvg)]]}
            />
          )}
          {traversalSpiking && (
            <SpikeCard
              title="Traversal spike"
              subtitle="Recent traversal complexity compared with the prior window"
              metric={`${anomalyInsights.traversalSpikeRatio.toFixed(1)}× traversals`}
              tone="warning"
              stats={[['Recent avg', anomalyInsights.recentTraversalAvg.toFixed(1)], ['Baseline avg', anomalyInsights.baselineTraversalAvg.toFixed(1)]]}
            />
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-ui text-fg-muted" data-testid="no-anomalies">
          <CheckCircle className="size-4 text-success" aria-hidden />
          No anomalies: recent runs take as long and travel as far as the prior window
        </p>
      )}

      {/* Trend + status charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartFrame
          className="lg:col-span-2"
          title="Instances started"
          actions={
            <SegmentedControl
              aria-label="Group by"
              size="sm"
              value={chartPeriod}
              onValueChange={(v) => setChartPeriod(v as ChartPeriod)}
              options={[{ value: 'day', text: 'Day' }, { value: 'week', text: 'Week' }, { value: 'month', text: 'Month' }]}
            />
          }
          table={{ caption: `Instances started per ${chartPeriod}`, columns: [chartPeriod === 'day' ? 'Day' : chartPeriod === 'week' ? 'Week' : 'Month', 'Instances'], rows: trendData.map((d: { name: string; runs: number }) => [d.name, formatCount(d.runs)]) }}
        >
          {trendData.length === 0 ? (
            <EmptyState size="sm" variant="no-results" icon={Play} title="No runs yet" description="Runs appear here once the workflow starts." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} {...BASE_AXIS} />
                <YAxis tick={AXIS_TICK} allowDecimals={false} width={36} {...VALUE_AXIS} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--ds-border)' }} />
                <Area type="monotone" dataKey="runs" name="instances started" stroke={seriesA} strokeWidth={2} fill={seriesA} fillOpacity={0.12} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>

        <ChartFrame
          title="Status distribution"
          table={{ caption: 'Instances by status', columns: ['Status', 'Instances'], rows: statusDistribution.map((d: { name: string; value: number }) => [d.name, formatCount(d.value)]) }}
        >
          {statusDistribution.length === 0 ? (
            <EmptyState size="sm" variant="no-results" icon={Clock} title="No runs yet" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={statusDistribution} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }} barCategoryGap={BAND_GAP}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis type="number" tick={AXIS_TICK} allowDecimals={false} {...VALUE_AXIS} />
                <YAxis type="category" dataKey="name" tick={AXIS_TICK} width={90} {...BASE_AXIS} />
                <Tooltip content={<ChartTooltip />} cursor={CURSOR_FILL} />
                <Bar dataKey="value" name="instances" radius={[0, 4, 4, 0]} maxBarSize={BAR_MAX} isAnimationActive={false}>
                  {statusDistribution.map((entry: { fill: string }, i: number) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartFrame>
      </div>

      <ChartFrame
        title="Spike trend"
        description={`Average duration and traversals per ${chartPeriod}: whether a spike is a burst or a sustained pattern`}
        table={{ caption: `Average duration and traversals per ${chartPeriod}`, columns: ['Period', 'Avg duration', 'Avg traversals'], rows: spikeTrendData.map((d: { name: string; avgDurationMs: number; avgTraversals: number }) => [d.name, formatDuration(d.avgDurationMs), d.avgTraversals.toFixed(1)]) }}
      >
        {spikeTrendData.length === 0 ? (
          <EmptyState size="sm" variant="no-results" icon={Clock} title="Not enough runs to chart a trend yet" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={spikeTrendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={16} {...BASE_AXIS} />
              <YAxis yAxisId="duration" tick={AXIS_TICK} width={56} tickFormatter={(value) => formatDuration(Number(value))} {...VALUE_AXIS} />
              <YAxis yAxisId="traversals" orientation="right" tick={AXIS_TICK} width={36} {...VALUE_AXIS} />
              <Tooltip
                content={<ChartTooltip />}
                formatter={(value: unknown, name: unknown) => (name === 'Avg duration' ? formatDuration(Number(value)) : Number(value).toFixed(1))}
                cursor={{ stroke: 'var(--ds-border)' }}
              />
              <Legend {...LEGEND_PROPS} />
              <Line yAxisId="duration" type="monotone" dataKey="avgDurationMs" name="Avg duration" stroke={seriesA} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line yAxisId="traversals" type="monotone" dataKey="avgTraversals" name="Avg traversals" stroke={seriesB} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartFrame>

      {/* The workflow's variables (name + type): what inputs it expects. Run values are in the table below. */}
      {variableDefs.length > 0 && (
        <Card padding="md">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-fg">Workflow variables</h3>
            <span className="text-xs text-fg-muted">
              {plural(variableDefs.length, 'variable')} ·{' '}
              <Link href={`/reports/builder?source=workflow_runs&workflow_id=${encodeURIComponent(workflow.id)}`} className="text-primary-text hover:underline">
                report on their values
              </Link>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {variableDefs.map((v: { name: string; type?: string; defaultValue?: unknown }, i: number) => (
              <Tag key={i} mono>
                {v.name}
                <span className="text-fg-muted">: {v.type ?? 'text'}</span>
                {v.defaultValue != null && v.defaultValue !== '' && (
                  <span className="text-fg-muted"> = {String(v.defaultValue).slice(0, 20)}</span>
                )}
              </Tag>
            ))}
          </div>
        </Card>
      )}

      <AggregateProcessMap
        workflow={workflow}
        runs={runs}
        aggregateFlow={aggregateFlow}
        agentExecutionSummary={agentExecutionSummary}
        agentNameById={agentNameById}
      />

      {/* All instances */}
      <section className="space-y-3" aria-label="All instances">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onValueChange={(v) => { setSearch(v); setPage(1) }}
            placeholder="Search by instance ID, title, originator, agent, or error…"
            className="w-full max-w-md"
          />
          <Select
            aria-label="Status"
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as StatusFilter); setPage(1) }}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'active', label: 'Active' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed', label: 'Failed' },
              { value: 'paused', label: 'Paused / waiting' },
              { value: 'spiking', label: 'Any spike' },
              { value: 'duration_spike', label: 'Duration spike' },
              { value: 'traversal_spike', label: 'Traversal spike' },
            ]}
            wrapperClassName="w-40"
          />
          <span className="num ml-auto text-xs text-fg-muted">
            {formatCount(tableRows.length)} of {formatCount(runs.length)}
          </span>
        </div>

        <Table>
          <THead>
            <tr>
              <SortableHeader label="ID" field="id" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <TH>Title</TH>
              <SortableHeader label="Originator" field="originator" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Work done by" field="workers" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Status" field="status" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Started" field="started" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Finished" field="finished" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
              <SortableHeader label="Duration" field="duration" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <SortableHeader label="Duration spike" field="durationSpike" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <SortableHeader label="Traversal spike" field="traversalSpike" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <TH><span className="sr-only">View</span></TH>
            </tr>
          </THead>
          <TBody>
            {paginatedRows.length === 0 ? (
              <TableEmpty
                colSpan={11}
                variant={search || statusFilter !== 'all' ? 'no-results' : 'first-run'}
                icon={Play}
                title={search || statusFilter !== 'all' ? 'No instances match your filters' : 'No instances yet'}
              />
            ) : (
              paginatedRows.map(row => (
                <TR key={row.id}>
                  <TD>
                    <Link href={`/automations/runs/${row.id}`} className="font-mono text-xs text-fg-muted hover:text-fg hover:underline" title={row.id}>
                      {row.shortId}
                    </Link>
                  </TD>
                  <TD className="max-w-[280px] py-2">
                    <div className="truncate text-fg" title={row.title}>{row.title}</div>
                    <div className="num mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
                      <span>{formatCount(row.nodeVisits)} visits · {formatCount(row.edgeTraversals)} traversals</span>
                      {row.durationSpikeRatio >= 1.25 && <Badge tone="danger">{row.durationSpikeRatio.toFixed(1)}× duration</Badge>}
                      {row.traversalSpikeRatio >= 1.25 && <Badge tone="warning">{row.traversalSpikeRatio.toFixed(1)}× traversals</Badge>}
                    </div>
                    {shownVariables.length > 0 && row.variables && (
                      <div className="mt-1 flex flex-wrap gap-1" data-testid="run-variables">
                        {shownVariables.map((name) => (
                          <Tag key={name} mono className="max-w-[160px] truncate" title={`${name}: ${variableText(row.variables?.[name])}`}>
                            {name}: <span className="text-fg">{variableText(row.variables?.[name])}</span>
                          </Tag>
                        ))}
                      </div>
                    )}
                    {row.error && (
                      <div className="mt-0.5 flex items-center gap-1 truncate text-xs text-danger" title={row.error}>
                        <AlertTriangle className="size-3 shrink-0" aria-hidden />
                        {row.error.slice(0, 60)}
                      </div>
                    )}
                  </TD>
                  <TD className="text-fg-muted">{row.originator}</TD>
                  <TD className="text-fg-muted">
                    <div className="max-w-[220px] truncate" title={row.workers}>{row.workers}</div>
                    {row.workerCount > 0 && (
                      <div className="mt-0.5 text-xs text-fg-muted">{plural(row.workerCount, 'agent execution')}</div>
                    )}
                  </TD>
                  <TD><StatusPill status={row.status} /></TD>
                  <TD className="num whitespace-nowrap text-fg-muted">{row.startedAt ? formatRelative(row.startedAt) : '—'}</TD>
                  <TD className="num whitespace-nowrap text-fg-muted">{row.completedAt ? formatRelative(row.completedAt) : '—'}</TD>
                  <TD numeric>{row.durationMs != null ? formatDuration(row.durationMs) : '—'}</TD>
                  <TD numeric className={row.durationSpikeRatio >= 1.25 ? 'text-danger' : undefined}>
                    {row.durationSpikeRatio > 0 ? `${row.durationSpikeRatio.toFixed(1)}×` : '—'}
                  </TD>
                  <TD numeric className={row.traversalSpikeRatio >= 1.25 ? 'text-warning' : undefined}>
                    {row.traversalSpikeRatio > 0 ? `${row.traversalSpikeRatio.toFixed(1)}×` : '—'}
                  </TD>
                  <TD className="text-right">
                    <Link
                      href={`/automations/runs/${row.id}${row.durationSpikeRatio >= 1.25 ? '?focus=duration' : row.traversalSpikeRatio >= 1.25 ? '?focus=traversal' : ''}`}
                      className="inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium text-primary-text hover:underline"
                    >
                      View run <ExternalLink className="size-3" aria-hidden />
                    </Link>
                  </TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <Pagination page={page} pageSize={pageSize} total={tableRows.length} onPageChange={setPage} noun="instances" />
      </section>
    </div>
  )
}

/** A spike that is happening: title, the ratio in a toned badge, recent vs baseline. */
function SpikeCard({ title, subtitle, metric, tone, stats }: { title: string; subtitle: string; metric: string; tone: 'danger' | 'warning'; stats: Array<[string, string]> }) {
  return (
    <Card padding="md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
        </div>
        <Badge tone={tone} className="num shrink-0">{metric}</Badge>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 border-t border-border-subtle pt-3 text-xs">
        {stats.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2">
            <dt className="text-fg-muted">{k}</dt>
            <dd className="num text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
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
    <Card padding="md" className="space-y-4 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-fg">Process flow overview</h3>
          <p className="mt-0.5 max-w-2xl text-xs text-fg-muted">
            This view aggregates all workflow instances and highlights where most runs travel. Thicker, brighter connections indicate the most common paths; each step shows its visits, average duration and error rate.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Tag className="num">{plural(runs.length, 'run')}</Tag>
          <Tag className="num">{plural(agentExecutionSummary.totalExecutions, 'agent execution')}</Tag>
          <Tag className="num">{plural(agentExecutionSummary.runsWithAgents, 'run')} with agents</Tag>
          <Tag className="num">max edge volume {formatCount(aggregateFlow.maxEdgeCount)}</Tag>
          <Tag className="num">max node visits {formatCount(aggregateFlow.maxNodeCount)}</Tag>
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
  label, field, sortField, sortDir, onClick, numeric = false,
}: {
  label: string
  field: SortField
  sortField: SortField
  sortDir: SortDir
  onClick: (f: SortField) => void
  numeric?: boolean
}) {
  const active = sortField === field
  return (
    <TH numeric={numeric} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => onClick(field)} className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-fg', numeric && 'flex-row-reverse')}>
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </TH>
  )
}
