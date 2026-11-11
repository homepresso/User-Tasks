'use client'

import { useState, useMemo, useEffect } from 'react'
import Link from 'next/link'
import {
  ArrowUpDown, ArrowUp, ArrowDown, Workflow as WorkflowIcon, CheckCircle, Activity,
} from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts'
import { SearchInput } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { Badge, StatusPill } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Pagination } from '@/components/ui/list-controls'
import { Table, THead, TBody, TR, TH, TD, TableEmpty, TableSkeleton, type ColumnKind } from '@/components/ui/table'
import { AXIS_TICK, BASE_AXIS, ChartFrame, ChartTooltip, GRID_PROPS, VALUE_AXIS, useSeriesColors } from '@/components/reports/chart-kit'
import { useRunDurationStats, useWorkflowHub } from '@/hooks/use-workflow-reports'
import { formatDuration } from '@/lib/format'
import { formatRelative } from '@/lib/format/date'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'

interface Props {
  /**
   * When true the hub is being rendered inside another page (the
   * /reports main page) rather than as a standalone route. We hide the
   * page-level header (back button + "Workflow Processes" title) in
   * that case so the parent's header is the only one on screen.
   */
  embedded?: boolean
  /** The period, when the parent page owns the selector (the /reports header). */
  range?: Range
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

export function ProcessesHubView({ embedded = false, range: rangeProp }: Props) {
  const { data: hub, isLoading } = useWorkflowHub()
  const [trendColor] = useSeriesColors(1)
  const workflows = useMemo(() => hub?.workflows ?? [], [hub])
  const daily = useMemo(() => hub?.daily ?? [], [hub])
  const queueStats = useMemo(() => hub?.queueStats ?? [], [hub])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [sortField, setSortField] = useState<SortField>('lastStarted')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [highlightWorkflowId, setHighlightWorkflowId] = useState<string | null>(null)
  const [ownRange, setOwnRange] = useState<Range>(90)
  const range: Range = rangeProp ?? ownRange
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

  const description = isLoading
    ? 'Loading…'
    : `${plural(workflows.length, 'workflow')} · ${plural(tiles.totalRuns, 'run')} in ${RANGE_LABELS[range].toLowerCase()}`

  return (
    <div className="space-y-6">
      {!embedded && (
        <PageHeader
          breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Workflows' }]}
          title="Workflow processes"
          description={description}
          actions={
            <>
              {workflows.length >= 2 && (
                <Button asChild variant="secondary">
                  <Link href={`/reports/workflows/compare?a=${workflows[0]?.id}&b=${workflows[1]?.id}`}>Compare workflows</Link>
                </Button>
              )}
              <Select
                aria-label="Period"
                value={String(range)}
                onChange={e => setOwnRange(Number(e.target.value) as Range)}
                options={Object.entries(RANGE_LABELS).map(([value, label]) => ({ value, label }))}
                wrapperClassName="w-36"
              />
            </>
          }
          className="mb-0"
        />
      )}

      {/* KPI tiles: the four that answer "is it healthy?". Node visits and edge traversals live on Compare. */}
      <StatGrid>
        <StatCard label="Runs" value={formatCount(tiles.totalRuns)}
          delta={{ label: `${RANGE_LABELS[range].toLowerCase()} · ${plural(tiles.totalWorkflows, 'workflow')}`, direction: 'flat' }} />
        <StatCard label="Active" value={formatCount(tiles.activeRuns)} hint="Runs that are running or queued right now"
          delta={{ label: 'running or queued', direction: 'flat' }} />
        <StatCard label="Errors" value={formatCount(tiles.errors)} tone={tiles.errors > 0 ? 'danger' : undefined}
          delta={{ label: tiles.errors > 0 ? 'need attention' : 'healthy', direction: 'flat' }} />
        <StatCard label="p50 duration" value={overallDurations?.p50_ms != null ? formatDuration(overallDurations.p50_ms) : '—'}
          hint="Median time from start to finish of completed runs"
          delta={{ label: `avg ${tiles.avgDuration}${overallDurations?.p95_ms != null ? ` · p95 ${formatDuration(overallDurations.p95_ms)}` : ''}`, direction: 'flat' }} />
      </StatGrid>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SpotlightCard
          title="Busiest workflow"
          subtitle="Highest run volume in range"
          row={spotlight.busiest}
          metric={spotlight.busiest ? plural(spotlight.busiest.total, 'run') : null}
          active={sortField === 'total' && highlightWorkflowId === spotlight.busiest?.id}
          onClick={() => applySpotlight('total', spotlight.busiest?.id ?? null)}
        />
        <SpotlightCard
          title="Slowest workflow"
          subtitle="Highest average duration"
          row={spotlight.slowest}
          metric={spotlight.slowest ? `${formatDuration(spotlight.slowest.avgDurationMs)} avg` : null}
          active={sortField === 'avgDuration' && highlightWorkflowId === spotlight.slowest?.id}
          onClick={() => applySpotlight('avgDuration', spotlight.slowest?.id ?? null)}
        />
        <SpotlightCard
          title="Most complex"
          subtitle="Highest average node visits"
          row={spotlight.mostComplex}
          metric={spotlight.mostComplex ? `${formatCount(spotlight.mostComplex.avgNodeVisits)} visits/run` : null}
          active={sortField === 'avgNodeVisits' && highlightWorkflowId === spotlight.mostComplex?.id}
          onClick={() => applySpotlight('avgNodeVisits', spotlight.mostComplex?.id ?? null)}
        />
        <SpotlightCard
          title="Most traversed"
          subtitle="Highest average edge traversals"
          row={spotlight.mostTraversed}
          metric={spotlight.mostTraversed ? `${formatCount(spotlight.mostTraversed.avgEdgeTraversals)} traversals/run` : null}
          active={sortField === 'avgEdgeTraversals' && highlightWorkflowId === spotlight.mostTraversed?.id}
          onClick={() => applySpotlight('avgEdgeTraversals', spotlight.mostTraversed?.id ?? null)}
        />
      </div>

      {anomalyInsights.durationSpike || anomalyInsights.traversalSpike ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {anomalyInsights.durationSpike && (
            <AnomalyCard
              title="Duration spike"
              subtitle="Recent average runtime vs the prior window"
              insight={anomalyInsights.durationSpike}
              metric={`${anomalyInsights.durationSpike.durationSpikeRatio.toFixed(1)}× slower`}
              onClick={() => applySpotlight('avgDuration', anomalyInsights.durationSpike?.id ?? null)}
            />
          )}
          {anomalyInsights.traversalSpike && (
            <AnomalyCard
              title="Traversal spike"
              subtitle="Recent edge traversals vs the prior window"
              insight={anomalyInsights.traversalSpike}
              metric={`${anomalyInsights.traversalSpike.traversalSpikeRatio.toFixed(1)}× more traversed`}
              onClick={() => applySpotlight('avgEdgeTraversals', anomalyInsights.traversalSpike?.id ?? null)}
            />
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-ui text-fg-muted" data-testid="no-anomalies">
          <CheckCircle className="size-4 text-success" aria-hidden />
          No anomalies in the last {range} days
        </p>
      )}

      {/* Processes started per day */}
      <ChartFrame
        title="Processes started"
        description={RANGE_LABELS[range]}
        table={{ caption: 'Processes started per day', columns: ['Day', 'Runs'], rows: trendData.map((d) => [d.name, formatCount(d.runs)]) }}
      >
        {trendData.every(d => d.runs === 0) ? (
          <EmptyState size="sm" variant="no-results" icon={Activity} title="No runs in this range" description="Pick a longer period or start a workflow." />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={trendData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis dataKey="name" tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={24} {...BASE_AXIS} />
              <YAxis tick={AXIS_TICK} allowDecimals={false} width={36} {...VALUE_AXIS} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: 'var(--ds-border)' }} />
              <Area type="monotone" dataKey="runs" name="runs started" stroke={trendColor} strokeWidth={2} fill={trendColor} fillOpacity={0.12} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartFrame>

      {/* All processes */}
      <section className="space-y-3" aria-label="All processes">
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search workflows by name or description…"
            className="w-full max-w-md"
          />
          <Select
            aria-label="Status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
            options={[{ value: 'all', label: 'All statuses' }, { value: 'active', label: 'Active only' }, { value: 'inactive', label: 'Inactive only' }]}
            wrapperClassName="w-36"
          />
          <span className="num ml-auto text-xs text-fg-muted">
            {formatCount(tableRows.length)} of {formatCount(workflows.length)}
          </span>
        </div>

        <Table label="Processes" stickyFirstColumn>
          <THead>
            <tr>
              <SortableHeader label="Process" field="name" sortField={sortField} sortDir={sortDir} onClick={toggleSort} col="title" />
              <SortableHeader label="Runs" field="total" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <SortableHeader label="Active" field="active" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <SortableHeader label="Last started" field="lastStarted" sortField={sortField} sortDir={sortDir} onClick={toggleSort} col="date" />
              <SortableHeader label="Last completed" field="lastCompleted" sortField={sortField} sortDir={sortDir} onClick={toggleSort} col="date" />
              <SortableHeader label="Avg duration" field="avgDuration" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <SortableHeader label="Avg visits" field="avgNodeVisits" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <SortableHeader label="Avg traversals" field="avgEdgeTraversals" sortField={sortField} sortDir={sortDir} onClick={toggleSort} numeric />
              <TH numeric>Variables</TH>
            </tr>
          </THead>
          <TBody>
            {isLoading ? (
              <TableSkeleton columns={9} />
            ) : tableRows.length === 0 ? (
              <TableEmpty
                colSpan={9}
                variant={search || statusFilter !== 'all' ? 'no-results' : 'first-run'}
                icon={WorkflowIcon}
                title={search || statusFilter !== 'all' ? 'No workflows match your filters' : 'No workflows yet'}
              />
            ) : (
              paginatedRows.map(row => (
                <TR key={row.id} selected={highlightWorkflowId === row.id}>
                  <TD className="max-w-[380px]">
                    <div className="flex min-w-0 items-center gap-2">
                      <Link href={`/reports/workflows/${row.id}`} className="truncate font-medium text-fg hover:underline" title={row.name}>
                        {row.name}
                      </Link>
                      {!row.isActive && <StatusPill status="inactive" />}
                      {row.durationSpikeRatio && row.durationSpikeRatio >= 1.25 && (
                        <Badge tone="danger">{row.durationSpikeRatio.toFixed(1)}× slower</Badge>
                      )}
                      {row.traversalSpikeRatio && row.traversalSpikeRatio >= 1.25 && (
                        <Badge tone="warning">{row.traversalSpikeRatio.toFixed(1)}× traversals</Badge>
                      )}
                    </div>
                  </TD>
                  <TD numeric>{formatCount(row.total)}</TD>
                  <TD numeric>
                    {row.active > 0 ? <Badge tone="info" className="num">{formatCount(row.active)}</Badge> : <span className="text-fg-muted">0</span>}
                  </TD>
                  <TD className="num whitespace-nowrap text-fg-muted">{row.lastStarted ? formatRelative(row.lastStarted) : '—'}</TD>
                  <TD className="num whitespace-nowrap text-fg-muted">{row.lastCompleted ? formatRelative(row.lastCompleted) : '—'}</TD>
                  <TD numeric>{row.total > 0 ? formatDuration(row.avgDurationMs) : '—'}</TD>
                  <TD numeric>{row.total > 0 ? formatCount(row.avgNodeVisits) : '—'}</TD>
                  <TD numeric>{row.total > 0 ? formatCount(row.avgEdgeTraversals) : '—'}</TD>
                  <TD numeric>{row.variableCount > 0 ? formatCount(row.variableCount) : <span className="text-fg-muted">—</span>}</TD>
                </TR>
              ))
            )}
          </TBody>
        </Table>

        <Pagination
          page={safePage}
          pageSize={pageSize}
          total={tableRows.length}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
          showPageNumbers
          noun="workflows"
        />
      </section>
    </div>
  )
}

function SortableHeader({
  label, field, sortField, sortDir, onClick, numeric = false, col,
}: {
  label: string
  field: SortField
  sortField: SortField
  sortDir: SortDir
  onClick: (f: SortField) => void
  numeric?: boolean
  col?: ColumnKind
}) {
  const active = sortField === field
  return (
    <TH numeric={numeric} col={col ?? (numeric ? 'number' : undefined)} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button type="button" onClick={() => onClick(field)} className={cn('inline-flex items-center gap-1 whitespace-nowrap hover:text-fg', numeric && 'flex-row-reverse')}>
        {label}
        {active ? (sortDir === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
      </button>
    </TH>
  )
}

interface SpotRow {
  id: string
  name: string
  description: string
  triggerType: string
  active: number
  errors: number
  lastStarted: string | null
}

/** A highlight: one consistent card, equal heights, the value in a neutral badge. Clicking sorts the table by it. */
function SpotlightCard({
  title, subtitle, row, metric, active = false, onClick,
}: {
  title: string
  subtitle: string
  row: SpotRow | null
  metric: string | null
  active?: boolean
  onClick?: () => void
}) {
  return (
    <Card
      variant="interactive"
      padding="md"
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
      className={cn('flex h-full min-w-0 flex-col text-left', active && 'border-border-strong bg-subtle')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
        </div>
        {metric && <Badge className="num shrink-0">{metric}</Badge>}
      </div>
      {row ? (
        <div className="mt-3 flex min-w-0 flex-1 flex-col gap-1">
          <Link href={`/reports/workflows/${row.id}`} onClick={(e) => e.stopPropagation()} className="truncate text-sm font-medium text-primary-text hover:underline" title={row.name}>
            {row.name}
          </Link>
          <p className="line-clamp-2 text-xs text-fg-muted">
            {row.description || (row.triggerType ? String(row.triggerType).replace(/_/g, ' ') : 'No description yet')}
          </p>
          <p className="num mt-auto pt-2 text-xs text-fg-muted">
            {formatCount(row.active)} active · {plural(row.errors, 'error')} · started {row.lastStarted ? formatRelative(row.lastStarted) : '—'}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs text-fg-muted">No workflows with runs in this range yet.</p>
      )}
    </Card>
  )
}

function AnomalyCard({
  title, subtitle, insight, metric, onClick,
}: {
  title: string
  subtitle: string
  insight: {
    id: string
    name: string
    triggerType: string
    recentRuns: number
    baselineRuns: number
    recentDurationAvg: number
    baselineDurationAvg: number
    recentTraversalAvg: number
    baselineTraversalAvg: number
  }
  metric: string
  onClick?: () => void
}) {
  const stats: Array<[string, string]> = [
    ['Recent duration', formatDuration(insight.recentDurationAvg)],
    ['Baseline duration', formatDuration(insight.baselineDurationAvg)],
    ['Recent traversals', insight.recentTraversalAvg.toFixed(1)],
    ['Baseline traversals', insight.baselineTraversalAvg.toFixed(1)],
  ]
  return (
    <Card
      variant="interactive"
      padding="md"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
      className="h-full text-left"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-fg">{title}</h3>
          <p className="mt-0.5 text-xs text-fg-muted">{subtitle}</p>
        </div>
        <Badge tone="warning" className="num shrink-0">{metric}</Badge>
      </div>
      <p className="mt-3 text-sm font-medium text-fg">{insight.name}</p>
      <p className="num mt-0.5 text-xs text-fg-muted">
        {plural(insight.recentRuns, 'recent run')} · {plural(insight.baselineRuns, 'baseline run')} · {String(insight.triggerType ?? 'manual').replace(/_/g, ' ')} trigger
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border-subtle pt-3 text-xs">
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
