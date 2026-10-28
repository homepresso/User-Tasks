'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Search, RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, Workflow as WorkflowIcon,
  CheckCircle, AlertTriangle, Clock, Activity, ExternalLink,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts'
import { formatRelativeDate } from '@/lib/utils'
import { useRunDurationStats, useWorkflowHub } from '@/hooks/use-workflow-reports'
import { formatDuration } from '@/lib/format'
import { useWorkspaceTheme } from '@/components/providers/theme-provider'

interface Props {
  /**
   * When true the hub is being rendered inside another page (the
   * /reports main page) rather than as a standalone route. We hide the
   * page-level header (back button + "Workflow Processes" title) in
   * that case so the parent's header is the only one on screen.
   */
  embedded?: boolean
}

type SortField = 'name' | 'total' | 'active' | 'lastStarted' | 'lastCompleted' | 'avgDuration' | 'avgNodeVisits' | 'avgEdgeTraversals'
type SortDir = 'asc' | 'desc'

type Range = 7 | 30 | 90 | 180

const RANGE_LABELS: Record<Range, string> = {
  7: 'Last 7 days',
  30: 'Last 30 days',
  90: 'Last 90 days',
  180: 'Last 180 days',
}

/** YYYY-MM-DD (UTC) of `ms`, the bucket key used by workflow_run_daily_stats. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** First UTC day of a window covering the last `days` days, today included. */
function windowStartDay(days: number): string {
  return utcDay(Date.now() - (days - 1) * 86_400_000)
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 250]

export function ProcessesHubView({ embedded = false }: Props) {
  const { data: hub, isLoading } = useWorkflowHub()
  const { palette } = useWorkspaceTheme()
  const workflows = useMemo(() => hub?.workflows ?? [], [hub])
  const daily = useMemo(() => hub?.daily ?? [], [hub])
  const queueStats = useMemo(() => hub?.queueStats ?? [], [hub])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortField, setSortField] = useState<SortField>('lastStarted')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [highlightWorkflowId, setHighlightWorkflowId] = useState<string | null>(null)
  const [range, setRange] = useState<Range>(90)
  const { data: durationStats } = useRunDurationStats(range)
  const overallDurations = durationStats?.find((row) => row.workflow_id === null) ?? null
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Per-workflow aggregates over the selected range, summed from the daily
  // SQL buckets (workflow_run_daily_stats).
  const perWorkflow = useMemo(() => {
    const startDay = windowStartDay(range)

    const byWf = new Map<string, {
      total: number
      active: number
      errors: number
      lastStarted: string | null
      lastCompleted: string | null
      completed: number
      completedMs: number
      nodeVisits: number
      edgeTraversals: number
    }>()

    for (const wf of workflows) {
      byWf.set(wf.id, {
        total: 0, active: 0, errors: 0,
        lastStarted: null, lastCompleted: null,
        completed: 0, completedMs: 0,
        nodeVisits: 0,
        edgeTraversals: 0,
      })
    }

    for (const d of daily) {
      const agg = byWf.get(d.workflow_id)
      if (!agg || d.day < startDay) continue
      agg.total += d.runs
      agg.active += d.active
      agg.errors += d.errors
      agg.nodeVisits += Number(d.node_visits)
      agg.edgeTraversals += Number(d.edge_traversals)
      agg.completed += d.completed
      agg.completedMs += d.completed_ms
      if (d.last_started_at && (!agg.lastStarted || d.last_started_at > agg.lastStarted)) agg.lastStarted = d.last_started_at
      if (d.last_completed_at && (!agg.lastCompleted || d.last_completed_at > agg.lastCompleted)) agg.lastCompleted = d.last_completed_at
    }

    // Merge queue stats into "active" — queue runs not yet promoted to
    // workflow_runs still count as active work for the tile totals.
    for (const q of queueStats) {
      const agg = byWf.get(q.workflow_id)
      if (agg) agg.active++
    }

    return byWf
  }, [workflows, daily, queueStats, range])

  // KPI tile values
  const tiles = useMemo(() => {
    let totalRuns = 0, activeRuns = 0, errors = 0, totalNodeVisits = 0, totalEdgeTraversals = 0
    let completed = 0, completedMs = 0
    for (const agg of perWorkflow.values()) {
      totalRuns += agg.total
      activeRuns += agg.active
      errors += agg.errors
      totalNodeVisits += agg.nodeVisits
      totalEdgeTraversals += agg.edgeTraversals
      completed += agg.completed
      completedMs += agg.completedMs
    }
    const avgMs = completed > 0 ? completedMs / completed : 0
    const avgNodeVisits = totalRuns > 0 ? Math.round((totalNodeVisits / totalRuns) * 10) / 10 : 0
    const avgEdgeTraversals = totalRuns > 0 ? Math.round((totalEdgeTraversals / totalRuns) * 10) / 10 : 0
    return {
      totalWorkflows: workflows.length,
      totalRuns,
      activeRuns,
      errors,
      avgDuration: formatDuration(avgMs),
      avgNodeVisits,
      avgEdgeTraversals,
    }
  }, [perWorkflow, workflows.length])

  // Daily trend — runs started per day bucketed over the selected range
  const trendData = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of daily) map.set(d.day, (map.get(d.day) ?? 0) + d.runs)
    // Ensure every day in the range has a bucket (0 if empty) so the chart
    // shows gaps instead of omitting them — otherwise the x-axis compresses
    // quiet periods and misleads readers.
    const result: { name: string; runs: number }[] = []
    for (let i = range - 1; i >= 0; i--) {
      const key = utcDay(Date.now() - i * 86_400_000)
      result.push({ name: key.slice(5), runs: map.get(key) ?? 0 })
    }
    return result
  }, [daily, range])

  const anomalyInsights = useMemo(() => {
    // Recent half of the range vs the half before it, at day granularity.
    const recentStartDay = windowStartDay(Math.max(1, Math.ceil(range / 2)))
    const baselineStartDay = windowStartDay(range)
    const perWorkflowSamples = new Map<string, {
      recentTimed: number
      recentTimedMs: number
      baselineTimed: number
      baselineTimedMs: number
      recentTraversals: number
      baselineTraversals: number
      recentRuns: number
      baselineRuns: number
    }>()

    for (const workflow of workflows) {
      perWorkflowSamples.set(workflow.id, {
        recentTimed: 0, recentTimedMs: 0, baselineTimed: 0, baselineTimedMs: 0,
        recentTraversals: 0, baselineTraversals: 0, recentRuns: 0, baselineRuns: 0,
      })
    }

    for (const d of daily) {
      const sample = perWorkflowSamples.get(d.workflow_id)
      if (!sample) continue
      if (d.day >= recentStartDay) {
        sample.recentRuns += d.runs
        sample.recentTimed += d.timed
        sample.recentTimedMs += d.timed_ms
        sample.recentTraversals += Number(d.edge_traversals)
      } else if (d.day >= baselineStartDay) {
        sample.baselineRuns += d.runs
        sample.baselineTimed += d.timed
        sample.baselineTimedMs += d.timed_ms
        sample.baselineTraversals += Number(d.edge_traversals)
      }
    }

    const candidates = workflows.map((workflow) => {
      const sample = perWorkflowSamples.get(workflow.id)
      if (!sample) return null
      const recentDurationAvg = sample.recentTimed > 0 ? sample.recentTimedMs / sample.recentTimed : 0
      const baselineDurationAvg = sample.baselineTimed > 0 ? sample.baselineTimedMs / sample.baselineTimed : 0
      const recentTraversalAvg = sample.recentRuns > 0 ? sample.recentTraversals / sample.recentRuns : 0
      const baselineTraversalAvg = sample.baselineRuns > 0 ? sample.baselineTraversals / sample.baselineRuns : 0

      if (sample.recentRuns < 2 || sample.baselineRuns < 2) return null

      return {
        id: workflow.id,
        name: workflow.name ?? 'Untitled',
        description: workflow.description ?? '',
        triggerType: workflow.trigger_type,
        recentRuns: sample.recentRuns,
        baselineRuns: sample.baselineRuns,
        durationSpikeRatio: baselineDurationAvg > 0 ? recentDurationAvg / baselineDurationAvg : 0,
        traversalSpikeRatio: baselineTraversalAvg > 0 ? recentTraversalAvg / baselineTraversalAvg : 0,
        recentDurationAvg,
        baselineDurationAvg,
        recentTraversalAvg,
        baselineTraversalAvg,
      }
    }).filter(Boolean) as Array<{
      id: string
      name: string
      description: string
      triggerType: string
      recentRuns: number
      baselineRuns: number
      durationSpikeRatio: number
      traversalSpikeRatio: number
      recentDurationAvg: number
      baselineDurationAvg: number
      recentTraversalAvg: number
      baselineTraversalAvg: number
    }>

    const durationSpike = [...candidates]
      .filter((candidate) => candidate.durationSpikeRatio >= 1.25)
      .sort((a, b) => b.durationSpikeRatio - a.durationSpikeRatio)[0] ?? null
    const traversalSpike = [...candidates]
      .filter((candidate) => candidate.traversalSpikeRatio >= 1.25)
      .sort((a, b) => b.traversalSpikeRatio - a.traversalSpikeRatio)[0] ?? null

    return { durationSpike, traversalSpike }
  }, [daily, workflows, range])

  // Filtered + sorted workflow table
  const tableRows = useMemo(() => {
    const filtered = workflows.filter(wf => {
      if (statusFilter === 'active' && !wf.is_active) return false
      if (statusFilter === 'inactive' && wf.is_active) return false
      if (search && !wf.name?.toLowerCase().includes(search.toLowerCase()) && !wf.description?.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })

    const rows = filtered.map(wf => {
      const agg = perWorkflow.get(wf.id)!
      const avgMs = agg.completed > 0
        ? agg.completedMs / agg.completed
        : 0
      return {
        id: wf.id,
        name: wf.name ?? 'Untitled',
        description: wf.description ?? '',
        triggerType: wf.trigger_type,
        isActive: wf.is_active,
        variableCount: Array.isArray(wf.user_variables) ? wf.user_variables.length : 0,
        total: agg.total,
        active: agg.active,
        errors: agg.errors,
        avgNodeVisits: agg.total > 0 ? Math.round((agg.nodeVisits / agg.total) * 10) / 10 : 0,
        avgEdgeTraversals: agg.total > 0 ? Math.round((agg.edgeTraversals / agg.total) * 10) / 10 : 0,
        durationSpikeRatio: anomalyInsights.durationSpike?.id === wf.id ? anomalyInsights.durationSpike.durationSpikeRatio : null,
        traversalSpikeRatio: anomalyInsights.traversalSpike?.id === wf.id ? anomalyInsights.traversalSpike.traversalSpikeRatio : null,
        lastStarted: agg.lastStarted,
        lastCompleted: agg.lastCompleted,
        avgDurationMs: avgMs,
      }
    })

    rows.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'name': cmp = a.name.localeCompare(b.name); break
        case 'total': cmp = a.total - b.total; break
        case 'active': cmp = a.active - b.active; break
        case 'lastStarted':
          cmp = (a.lastStarted ? new Date(a.lastStarted).getTime() : 0) - (b.lastStarted ? new Date(b.lastStarted).getTime() : 0)
          break
        case 'lastCompleted':
          cmp = (a.lastCompleted ? new Date(a.lastCompleted).getTime() : 0) - (b.lastCompleted ? new Date(b.lastCompleted).getTime() : 0)
          break
        case 'avgDuration': cmp = a.avgDurationMs - b.avgDurationMs; break
        case 'avgNodeVisits': cmp = a.avgNodeVisits - b.avgNodeVisits; break
        case 'avgEdgeTraversals': cmp = a.avgEdgeTraversals - b.avgEdgeTraversals; break
      }
      return sortDir === 'asc' ? cmp : -cmp
    })

    return rows
  }, [workflows, perWorkflow, search, statusFilter, sortField, sortDir, anomalyInsights])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir(field === 'name' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  function applySpotlight(sort: SortField, workflowId: string | null) {
    setSortField(sort)
    setSortDir('desc')
    setHighlightWorkflowId(workflowId)
    setPage(1)
  }

  // Reset to page 1 whenever the filter/sort changes so users don't get
  // stuck on an empty page 3 after searching. Also clamp the current page
  // if the row count shrinks below the current page's offset.
  useEffect(() => { setPage(1) }, [search, statusFilter, range, pageSize])

  const totalPages = Math.max(1, Math.ceil(tableRows.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const paginatedRows = tableRows.slice((safePage - 1) * pageSize, safePage * pageSize)
  const spotlight = useMemo(() => {
    const withRuns = tableRows.filter((row) => row.total > 0)
    const busiest = [...withRuns].sort((a, b) => b.total - a.total)[0] ?? null
    const slowest = [...withRuns].sort((a, b) => b.avgDurationMs - a.avgDurationMs)[0] ?? null
    const mostComplex = [...withRuns].sort((a, b) => b.avgNodeVisits - a.avgNodeVisits)[0] ?? null
    const mostTraversed = [...withRuns].sort((a, b) => b.avgEdgeTraversals - a.avgEdgeTraversals)[0] ?? null
    return { busiest, slowest, mostComplex, mostTraversed }
  }, [tableRows])

  return (
    <div className={embedded ? 'space-y-4' : 'space-y-6'}>
      {/* Header — hidden when embedded inside another page (e.g. the
          /reports main page) so we don't double up on titles / back
          buttons. Embedded mode still shows the date range picker inline. */}
      {!embedded ? (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/reports" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Workflow Processes</h1>
              <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
                {isLoading ? 'Loading…' : `${workflows.length} workflow${workflows.length !== 1 ? 's' : ''} · ${tiles.totalRuns} run${tiles.totalRuns !== 1 ? 's' : ''} in ${RANGE_LABELS[range].toLowerCase()}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {workflows.length >= 2 && (
              <Link href={`/reports/workflows/compare?a=${workflows[0]?.id}&b=${workflows[1]?.id}`}>
                <Button size="sm" variant="outline">Compare workflows</Button>
              </Link>
            )}
            <select
              value={range}
              onChange={e => setRange(Number(e.target.value) as Range)}
              className="rounded-lg border px-3 py-1.5 text-xs"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            >
              {Object.entries(RANGE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-end">
          <select
            value={range}
            onChange={e => setRange(Number(e.target.value) as Range)}
            className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            {Object.entries(RANGE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
      )}

      {/* KPI tiles */}
      <ReportMetricRow
        metrics={[
          { label: 'Total Workflows', value: tiles.totalWorkflows },
          { label: 'Active Instances', value: tiles.activeRuns, subtitle: 'running or queued' },
          { label: 'Process Errors', value: tiles.errors, subtitle: tiles.errors > 0 ? 'needs attention' : 'healthy' },
          { label: 'Total Runs', value: tiles.totalRuns, subtitle: RANGE_LABELS[range].toLowerCase() },
          {
            label: 'Avg Duration',
            value: tiles.avgDuration,
            subtitle: overallDurations?.p50_ms != null
              ? `p50 ${formatDuration(overallDurations.p50_ms)} · p95 ${formatDuration(overallDurations.p95_ms ?? 0)}`
              : undefined,
          },
          { label: 'Avg Node Visits', value: tiles.avgNodeVisits, subtitle: 'per run' },
          { label: 'Avg Edge Traversals', value: tiles.avgEdgeTraversals, subtitle: 'per run' },
        ]}
      />

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
        <SpotlightCard
          title="Busiest Workflow"
          subtitle="Highest run volume in range"
          row={spotlight.busiest}
          accent={{ background: 'color-mix(in srgb, var(--status-info) 10%, transparent)', color: 'var(--status-info)' }}
          metricLabel="runs"
          metricValue={spotlight.busiest?.total ?? 0}
          active={sortField === 'total' && highlightWorkflowId === spotlight.busiest?.id}
          onClick={() => applySpotlight('total', spotlight.busiest?.id ?? null)}
        />
        <SpotlightCard
          title="Slowest Workflow"
          subtitle="Highest average duration"
          row={spotlight.slowest}
          accent={{ background: 'color-mix(in srgb, var(--theme-warning) 12%, transparent)', color: 'var(--theme-warning)' }}
          metricLabel="avg duration"
          metricValue={spotlight.slowest ? formatDuration(spotlight.slowest.avgDurationMs) : '—'}
          active={sortField === 'avgDuration' && highlightWorkflowId === spotlight.slowest?.id}
          onClick={() => applySpotlight('avgDuration', spotlight.slowest?.id ?? null)}
        />
        <SpotlightCard
          title="Most Complex"
          subtitle="Highest average node visits"
          row={spotlight.mostComplex}
          accent={{ background: 'color-mix(in srgb, var(--theme-chart-3) 12%, transparent)', color: 'var(--theme-chart-3-text)' }}
          metricLabel="visits/run"
          metricValue={spotlight.mostComplex?.avgNodeVisits ?? 0}
          active={sortField === 'avgNodeVisits' && highlightWorkflowId === spotlight.mostComplex?.id}
          onClick={() => applySpotlight('avgNodeVisits', spotlight.mostComplex?.id ?? null)}
        />
        <SpotlightCard
          title="Most Traversed"
          subtitle="Highest average edge traversals"
          row={spotlight.mostTraversed}
          accent={{ background: 'color-mix(in srgb, var(--theme-primary) 12%, transparent)', color: 'var(--theme-primary-text)' }}
          metricLabel="traversals/run"
          metricValue={spotlight.mostTraversed?.avgEdgeTraversals ?? 0}
          active={sortField === 'avgEdgeTraversals' && highlightWorkflowId === spotlight.mostTraversed?.id}
          onClick={() => applySpotlight('avgEdgeTraversals', spotlight.mostTraversed?.id ?? null)}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <AnomalyCard
          title="Duration Spike"
          subtitle="Recent average runtime vs prior window"
          insight={anomalyInsights.durationSpike}
          accent={{ background: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)', color: 'var(--theme-danger)' }}
          metricLabel="slower"
          metricValue={anomalyInsights.durationSpike ? `${anomalyInsights.durationSpike.durationSpikeRatio.toFixed(1)}x` : '—'}
          onClick={() => applySpotlight('avgDuration', anomalyInsights.durationSpike?.id ?? null)}
        />
        <AnomalyCard
          title="Traversal Spike"
          subtitle="Recent edge traversals vs prior window"
          insight={anomalyInsights.traversalSpike}
          accent={{ background: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}
          metricLabel="more traversed"
          metricValue={anomalyInsights.traversalSpike ? `${anomalyInsights.traversalSpike.traversalSpikeRatio.toFixed(1)}x` : '—'}
          onClick={() => applySpotlight('avgEdgeTraversals', anomalyInsights.traversalSpike?.id ?? null)}
        />
      </div>

      {/* Processes Started trend chart */}
      <Card className="!p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Processes Started</h3>
          <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{RANGE_LABELS[range]}</span>
        </div>
        {trendData.every(d => d.runs === 0) ? (
          <p className="text-xs py-12 text-center" style={{ color: 'var(--theme-muted-text)' }}>No runs in this range</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="wfHubGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={palette.primary} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={palette.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--theme-surface-border)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10, fill: 'var(--theme-muted-text)' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  fontSize: 12, borderRadius: 8,
                  backgroundColor: 'var(--theme-card-bg)',
                  border: '1px solid var(--theme-surface-border)',
                  color: 'var(--theme-card-text)',
                }}
              />
              <Area type="monotone" dataKey="runs" stroke={palette.primary} strokeWidth={2} fill="url(#wfHubGradient)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Card>

      {/* All Processes table */}
      <Card className="!p-0 overflow-hidden">
        {/* Filter bar */}
        <div className="flex items-center gap-2 p-3 border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="relative flex-1 max-w-md">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search workflows by name or description…"
              className="pl-8 !h-8 !text-xs"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as any)}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <span className="text-[10px] ml-auto" style={{ color: 'var(--theme-muted-text)' }}>
            {tableRows.length} of {workflows.length}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                <SortableHeader label="Process Name" field="name" sortField={sortField} sortDir={sortDir} onClick={toggleSort} className="pl-4" />
                <SortableHeader label="Total" field="total" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Active" field="active" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Last Started" field="lastStarted" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Last Completed" field="lastCompleted" sortField={sortField} sortDir={sortDir} onClick={toggleSort} />
                <SortableHeader label="Avg Duration" field="avgDuration" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Avg Visits" field="avgNodeVisits" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <SortableHeader label="Avg Traversals" field="avgEdgeTraversals" sortField={sortField} sortDir={sortDir} onClick={toggleSort} align="right" />
                <th className="text-right pr-4 py-2 font-medium uppercase text-[10px] tracking-wider">Variables</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={9} className="text-center py-12" style={{ color: 'var(--theme-muted-text)' }}>Loading workflows…</td></tr>
              ) : tableRows.length === 0 ? (
                <tr><td colSpan={9} className="text-center py-12" style={{ color: 'var(--theme-muted-text)' }}>
                  {search || statusFilter !== 'all' ? 'No workflows match your filters.' : 'No workflows yet.'}
                </td></tr>
              ) : (
                paginatedRows.map(row => (
                  <tr
                    key={row.id}
                    className="border-t transition-colors hover:bg-[var(--theme-row-highlight)]"
                    style={{
                      borderColor: 'var(--theme-surface-border)',
                      backgroundColor: highlightWorkflowId === row.id ? 'var(--theme-row-highlight)' : undefined,
                    }}
                  >
                    <td className="pl-4 py-2.5">
                      <Link
                        href={`/reports/workflows/${row.id}`}
                        className="flex items-center gap-2 font-medium hover:underline"
                        style={{ color: 'var(--theme-primary-text)' }}
                      >
                        <WorkflowIcon size={12} />
                        <span className="truncate max-w-[280px]" title={row.name}>{row.name}</span>
                        {!row.isActive && (
                          <span className="text-[8px] px-1 rounded" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                            inactive
                          </span>
                        )}
                      </Link>
                      {row.description && (
                        <p className="text-[10px] mt-0.5 max-w-[380px] truncate" style={{ color: 'var(--theme-muted-text)' }} title={row.description}>
                          {row.description}
                        </p>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{ backgroundColor: 'color-mix(in srgb, var(--status-info) 10%, transparent)', color: 'var(--status-info)' }}
                        >
                          {row.avgNodeVisits} visits/run
                        </span>
                        <span
                          className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                          style={{ backgroundColor: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)', color: 'var(--theme-primary-text)' }}
                        >
                          {row.avgEdgeTraversals} traversals/run
                        </span>
                        {row.durationSpikeRatio && row.durationSpikeRatio >= 1.25 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)', color: 'var(--theme-danger)' }}
                          >
                            {row.durationSpikeRatio.toFixed(1)}x slower
                          </span>
                        )}
                        {row.traversalSpikeRatio && row.traversalSpikeRatio >= 1.25 && (
                          <span
                            className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', color: 'var(--theme-warning)' }}
                          >
                            {row.traversalSpikeRatio.toFixed(1)}x traversals
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="text-right py-2.5" style={{ color: 'var(--theme-card-text)' }}>{row.total}</td>
                    <td className="text-right py-2.5">
                      {row.active > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium" style={{ backgroundColor: 'var(--status-info-bg)', color: 'var(--status-info)' }}>
                          <Activity size={9} /> {row.active}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--theme-muted-text)' }}>0</span>
                      )}
                    </td>
                    <td className="py-2.5" style={{ color: 'var(--theme-muted-text)' }}>
                      {row.lastStarted ? formatRelativeDate(row.lastStarted) : '—'}
                    </td>
                    <td className="py-2.5" style={{ color: 'var(--theme-muted-text)' }}>
                      {row.lastCompleted ? formatRelativeDate(row.lastCompleted) : '—'}
                    </td>
                    <td className="text-right py-2.5 font-mono text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
                      {row.total > 0 ? formatDuration(row.avgDurationMs) : '—'}
                    </td>
                    <td className="text-right py-2.5 font-mono text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
                      {row.total > 0 ? row.avgNodeVisits : '—'}
                    </td>
                    <td className="text-right py-2.5 font-mono text-[11px]" style={{ color: 'var(--theme-card-text)' }}>
                      {row.total > 0 ? row.avgEdgeTraversals : '—'}
                    </td>
                    <td className="pr-4 py-2.5 text-right">
                      {row.variableCount > 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                          {row.variableCount}
                        </span>
                      ) : (
                        <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer — only rendered when the filtered result set
            exceeds the page size. We use the unrendered-when-unnecessary
            pattern so short lists don't get decorative chrome they don't
            need. The page-size selector stays visible always so users can
            still switch it when the list is short. */}
        {tableRows.length > 0 && (
          <div
            className="flex items-center justify-between p-3 border-t text-[11px]"
            style={{ borderColor: 'var(--theme-surface-border)', color: 'var(--theme-muted-text)' }}
          >
            <div className="flex items-center gap-2">
              <span>
                Showing {tableRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1}
                –{Math.min(safePage * pageSize, tableRows.length)} of {tableRows.length}
              </span>
              <span>·</span>
              <label className="flex items-center gap-1">
                Rows per page
                <select
                  value={pageSize}
                  onChange={e => setPageSize(Number(e.target.value))}
                  className="rounded border px-1.5 py-0.5 text-[11px]"
                  style={{
                    borderColor: 'var(--theme-surface-border)',
                    backgroundColor: 'var(--theme-card-bg)',
                    color: 'var(--theme-card-text)',
                  }}
                >
                  {PAGE_SIZE_OPTIONS.map(n => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPage(1)}
                  disabled={safePage === 1}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                  title="First page"
                >
                  «
                </button>
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                  title="Previous page"
                >
                  ‹ Prev
                </button>
                <span className="px-2">Page {safePage} of {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                  title="Next page"
                >
                  Next ›
                </button>
                <button
                  onClick={() => setPage(totalPages)}
                  disabled={safePage === totalPages}
                  className="px-2 py-1 rounded disabled:opacity-30 hover:bg-[var(--theme-surface)]"
                  title="Last page"
                >
                  »
                </button>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
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

function SpotlightCard({
  title,
  subtitle,
  row,
  metricLabel,
  metricValue,
  accent,
  active = false,
  onClick,
}: {
  title: string
  subtitle: string
  row: any | null
  metricLabel: string
  metricValue: string | number
  accent: { background: string; color: string }
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left"
      style={{ width: '100%' }}
    >
      <Card
        className="!p-4 transition-all"
        style={{
          borderColor: active ? accent.color : undefined,
          boxShadow: active ? `0 0 0 1px ${accent.color}33` : undefined,
        }}
      >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{title}</h3>
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{subtitle}</p>
        </div>
        <span
          className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold"
          style={{ backgroundColor: accent.background, color: accent.color }}
        >
          {metricValue} {metricLabel}
        </span>
      </div>

      {row ? (
        <div className="mt-4 space-y-2">
          <Link
            href={`/reports/workflows/${row.id}`}
            className="block text-sm font-medium hover:underline"
            style={{ color: 'var(--theme-primary-text)' }}
            title={row.name}
          >
            {row.name}
          </Link>
          {row.description ? (
            <p className="text-[11px] line-clamp-2" style={{ color: 'var(--theme-muted-text)' }}>
              {row.description}
            </p>
          ) : (
            <p className="text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              {row.triggerType ? `${String(row.triggerType).replace(/_/g, ' ')}` : 'No description yet'}
            </p>
          )}
          <div className="flex flex-wrap gap-1.5 text-[10px]">
            <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              {row.active} active
            </span>
            <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              {row.errors} errors
            </span>
            <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
              last started {row.lastStarted ? formatRelativeDate(row.lastStarted) : '—'}
            </span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
          No workflows with runs in this range yet.
        </p>
      )}
      </Card>
    </button>
  )
}

function AnomalyCard({
  title,
  subtitle,
  insight,
  metricLabel,
  metricValue,
  accent,
  onClick,
}: {
  title: string
  subtitle: string
  insight: {
    id: string
    name: string
    description: string
    triggerType: string
    recentRuns: number
    baselineRuns: number
    recentDurationAvg: number
    baselineDurationAvg: number
    recentTraversalAvg: number
    baselineTraversalAvg: number
  } | null
  metricLabel: string
  metricValue: string | number
  accent: { background: string; color: string }
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left"
      style={{ width: '100%' }}
    >
      <Card className="!p-4 transition-all">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{title}</h3>
            <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{subtitle}</p>
          </div>
          <span
            className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold"
            style={{ backgroundColor: accent.background, color: accent.color }}
          >
            {metricValue} {metricLabel}
          </span>
        </div>

        {insight ? (
          <div className="mt-4 space-y-2">
            <div className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>
              {insight.name}
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                recent {insight.recentRuns} runs
              </span>
              <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                baseline {insight.baselineRuns} runs
              </span>
              <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                trigger {String(insight.triggerType ?? 'manual').replace(/_/g, ' ')}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <div style={{ color: 'var(--theme-muted-text)' }}>Recent duration</div>
                <div style={{ color: 'var(--theme-card-text)' }}>{formatDuration(insight.recentDurationAvg)}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <div style={{ color: 'var(--theme-muted-text)' }}>Baseline duration</div>
                <div style={{ color: 'var(--theme-card-text)' }}>{formatDuration(insight.baselineDurationAvg)}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <div style={{ color: 'var(--theme-muted-text)' }}>Recent traversals</div>
                <div style={{ color: 'var(--theme-card-text)' }}>{insight.recentTraversalAvg.toFixed(1)}</div>
              </div>
              <div className="rounded-lg px-3 py-2" style={{ backgroundColor: 'var(--theme-surface)' }}>
                <div style={{ color: 'var(--theme-muted-text)' }}>Baseline traversals</div>
                <div style={{ color: 'var(--theme-card-text)' }}>{insight.baselineTraversalAvg.toFixed(1)}</div>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
            No strong anomaly detected yet. We show spikes once a workflow has enough recent and baseline runs to compare.
          </p>
        )}
      </Card>
    </button>
  )
}
