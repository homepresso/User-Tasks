'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronDown, ChevronRight, Copy, ClipboardCheck, Crosshair } from 'lucide-react'
import Link from 'next/link'
import { type WorkflowEdge, type WorkflowNode } from '@/lib/workflow-schema'
import { formatRelativeDate } from '@/lib/utils'
import { average, parseJsonField } from '@/lib/report-flow-stats'
import { logStepId, RuntimeCanvas, StepChip } from './runtime-canvas'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'
import { normalizeDataTableNodes } from '@/lib/workflow-table-refs'

interface ProcessViewerProps {
  workflow: any
  run: any
  logs: any[]
  focus?: string | null
  compareRun?: any
}

function countNodeVisits(run: any) {
  const trace = parseJsonField<any[]>(run?.execution_trace, [])
  if (Array.isArray(trace) && trace.length > 0) {
    return trace.filter((entry) => entry?.type === 'node' && (entry?.phase === 'enter' || entry?.phase === 'resume')).length
  }
  return Object.keys((run?.node_results as Record<string, any>) ?? {}).length
}

function countEdgeTraversals(run: any) {
  const trace = parseJsonField<any[]>(run?.execution_trace, [])
  if (Array.isArray(trace) && trace.length > 0) {
    return trace.filter((entry) => entry?.type === 'edge').length
  }
  return 0
}

function computeRunDurationMs(run: any) {
  if (!run?.started_at) return null
  const started = new Date(run.started_at).getTime()
  const ended = run.completed_at ? new Date(run.completed_at).getTime() : Date.now()
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null
}

function formatDuration(ms: number | null) {
  if (ms == null) return '—'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) return `${(ms / 60_000).toFixed(1)}m`
  return `${(ms / 3_600_000).toFixed(1)}h`
}

export function ProcessViewer({ workflow, run, logs, focus, compareRun }: ProcessViewerProps) {
  const [expandedLog, setExpandedLog] = useState<string | null>(null)
  const [tab, setTab] = useState<'canvas' | 'compare' | 'logs' | 'variables'>('canvas')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [selectedSuspectNodeId, setSelectedSuspectNodeId] = useState<string | null>(null)
  const [showSuspectLogsOnly, setShowSuspectLogsOnly] = useState(false)

  // Pan + zoom: the same canvas navigation as the designer (use-canvas-zoom).
  const viewerRootRef = useRef<HTMLDivElement | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ nodeId: string; nonce: number } | null>(null)

  function formatLogLine(log: any) {
    const time = new Date(log.created_at).toLocaleTimeString()
    const dur = log.duration_ms != null ? ` (${log.duration_ms}ms)` : ''
    const node = log.node_label ? ` [${log.node_label}]` : ''
    const meta = log.metadata ? `\n  ${JSON.stringify(log.metadata, null, 2).replace(/\n/g, '\n  ')}` : ''
    return `${time} ${log.level.toUpperCase()}${node} ${log.message}${dur}${meta}`
  }

  function copyLogLine(e: React.MouseEvent, log: any) {
    e.stopPropagation()
    navigator.clipboard.writeText(formatLogLine(log))
    setCopiedId(log.id)
    setTimeout(() => setCopiedId(null), 1500)
  }

  function copyAllLogs() {
    const text = logs.map(formatLogLine).join('\n')
    navigator.clipboard.writeText(text)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 1500)
  }
  const nodes = useMemo(() => normalizeDataTableNodes((workflow.nodes as any[]) ?? []), [workflow.nodes])
  const edges = useMemo(() => (workflow.edges as any[]) ?? [], [workflow.edges])
  const workflowSwimlanes = ((workflow as any).swimlanes as { id: string; label: string; color: string; y: number; height: number }[] | undefined) ?? []
  const nodeResults = useMemo(() => (run?.node_results as Record<string, any>) ?? {}, [run?.node_results])
  // A live instance migration starts mid-graph, at the node its first trace entry names.
  const migrationEntry = parseJsonField<Array<{ type?: string; node_id?: unknown }>>(run?.execution_trace, []).find((entry) => entry?.type === 'migrated')
  const pausedId: string | null = (run?.status === 'waiting_for_event' || run?.status === 'paused') ? (run as any)?.paused_node_id ?? null : null

  const variableDefs: any[] = Array.isArray(workflow.user_variables) ? workflow.user_variables : []
  const variableCount = variableDefs.length
  const executionMetrics = run ? {
    durationMs: computeRunDurationMs(run),
    nodeVisits: countNodeVisits(run),
    edgeTraversals: countEdgeTraversals(run),
    executedNodes: Object.keys(nodeResults).length,
  } : null
  const compareMetrics = compareRun ? {
    durationMs: computeRunDurationMs(compareRun),
    nodeVisits: countNodeVisits(compareRun),
    edgeTraversals: countEdgeTraversals(compareRun),
    executedNodes: Object.keys((compareRun?.node_results as Record<string, any>) ?? {}).length,
  } : null
  const traceEntries = parseJsonField<any[]>(run?.execution_trace, [])
  const nodeVisitMap = useMemo(() => {
    const visitMap: Record<string, number> = {}
    for (const entry of traceEntries) {
      if (entry?.type === 'node' && typeof entry?.node_id === 'string' && (entry?.phase === 'enter' || entry?.phase === 'resume')) {
        visitMap[entry.node_id] = (visitMap[entry.node_id] ?? 0) + 1
      }
    }
    return visitMap
  }, [traceEntries])
  const runOverlay = useMemo(() => computeRunOverlay({
    nodes: nodes as WorkflowNode[],
    edges: edges as WorkflowEdge[],
    nodeResults,
    pausedNodeId: pausedId,
    runWaiting: !!pausedId,
    entryNodeId: migrationEntry?.node_id ? String(migrationEntry.node_id) : null,
    visits: nodeVisitMap,
  }), [nodes, edges, nodeResults, pausedId, migrationEntry?.node_id, nodeVisitMap])
  const nodeDurationValues = Object.values(nodeResults)
    .map((result: any) => (typeof result?.duration_ms === 'number' ? result.duration_ms : null))
    .filter((value): value is number => value != null && value >= 0)
  const avgNodeDuration = average(nodeDurationValues)
  const avgNodeVisitCount = average(Object.values(nodeVisitMap))
  const culpritNodeIds = new Set(
    nodes
      .filter((node: any) => {
        const result = nodeResults[node.id]
        const duration = typeof result?.duration_ms === 'number' ? result.duration_ms : 0
        const visits = nodeVisitMap[node.id] ?? 0
        if (focus === 'duration') return avgNodeDuration > 0 && duration >= avgNodeDuration * 1.5
        if (focus === 'traversal') return avgNodeVisitCount > 0 && visits >= Math.max(2, avgNodeVisitCount * 1.5)
        if (focus === 'spike') {
          const durationCulprit = avgNodeDuration > 0 && duration >= avgNodeDuration * 1.5
          const traversalCulprit = avgNodeVisitCount > 0 && visits >= Math.max(2, avgNodeVisitCount * 1.5)
          return durationCulprit || traversalCulprit
        }
        return false
      })
      .map((node: any) => node.id)
  )
  const suspectNodes = useMemo(() => {
    if (!focus) return []

    return nodes
      .filter((node: any) => culpritNodeIds.has(node.id))
      .map((node: any) => {
        const result = nodeResults[node.id]
        const duration = typeof result?.duration_ms === 'number' ? result.duration_ms : 0
        const visits = nodeVisitMap[node.id] ?? 0
        const durationRatio = avgNodeDuration > 0 ? duration / avgNodeDuration : 0
        const traversalRatio = avgNodeVisitCount > 0 ? visits / avgNodeVisitCount : 0
        const score = focus === 'duration'
          ? durationRatio
          : focus === 'traversal'
            ? traversalRatio
            : Math.max(durationRatio, traversalRatio)

        return {
          id: node.id,
          label: node.label,
          type: node.type,
          duration,
          visits,
          durationRatio,
          traversalRatio,
          score,
        }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
  }, [focus, nodes, culpritNodeIds, nodeResults, nodeVisitMap, avgNodeDuration, avgNodeVisitCount])
  const focusContext = (() => {
    if (!focus) return null
    if (focus === 'duration') {
      return {
        title: 'Duration Spike Focus',
        description: 'This run was opened from a duration anomaly, so start by checking the longest steps and the logs around elapsed time.',
        color: 'var(--theme-danger)',
        background: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)',
      }
    }
    if (focus === 'traversal') {
      return {
        title: 'Traversal Spike Focus',
        description: 'This run was opened from a traversal anomaly, so focus on extra branches, loops, and unexpected path depth through the workflow.',
        color: 'var(--theme-warning)',
        background: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)',
      }
    }
    if (focus === 'spike') {
      return {
        title: 'Anomaly Focus',
        description: 'This run was flagged as anomalous in the workflow report. Review both path complexity and runtime in the canvas and logs.',
        color: 'var(--theme-chart-6-text)',
        background: 'color-mix(in srgb, var(--theme-chart-6) 10%, transparent)',
      }
    }
    return null
  })()
  const suspectNodeLabels = useMemo(() => new Set(suspectNodes.map((node) => node.label)), [suspectNodes])
  const visibleLogs = useMemo(() => {
    if (!showSuspectLogsOnly || suspectNodeLabels.size === 0) return logs
    return logs.filter((log: any) => log?.node_label && suspectNodeLabels.has(log.node_label))
  }, [logs, showSuspectLogsOnly, suspectNodeLabels])

  useEffect(() => {
    setSelectedSuspectNodeId((current) => current && suspectNodes.some((node) => node.id === current) ? current : (suspectNodes[0]?.id ?? null))
  }, [suspectNodes])

  useEffect(() => {
    if (!focusContext) setShowSuspectLogsOnly(false)
  }, [focusContext])

  /** Show a step on the run canvas: switch tab, zoom to it and open its details. */
  function focusNodeInCanvas(nodeId: string) {
    setTab('canvas')
    setSelectedSuspectNodeId(nodeId)
    setFocusRequest({ nodeId, nonce: Date.now() })
  }

  return (
    <div ref={viewerRootRef}>
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link href="/automations/queue" className="p-1 rounded hover:opacity-70" style={{ color: 'var(--theme-muted-text)' }}>
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{workflow.name}</h1>
          <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            {run ? `Run ${run.id.slice(0, 8)} · ${formatRelativeDate(run.started_at)}` : 'No run data'}
          </p>
        </div>
        {run && (
          <span className="text-xs font-medium px-2.5 py-1 rounded-full capitalize"
            style={{
              backgroundColor: run.status === 'completed' ? 'color-mix(in srgb, var(--theme-success) 8%, transparent)' : run.status === 'failed' ? 'color-mix(in srgb, var(--theme-danger) 8%, transparent)' : 'color-mix(in srgb, var(--status-info) 8%, transparent)',
              color: run.status === 'completed' ? 'var(--theme-success)' : run.status === 'failed' ? 'var(--theme-danger)' : 'var(--status-info)',
            }}>
            {run.status}
          </span>
        )}
      </div>

      {executionMetrics && (
        <div className="grid gap-3 mb-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Duration', value: formatDuration(executionMetrics.durationMs) },
            { label: 'Executed Nodes', value: executionMetrics.executedNodes },
            { label: 'Node Visits', value: executionMetrics.nodeVisits },
            { label: 'Edge Traversals', value: executionMetrics.edgeTraversals },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-xl border px-4 py-3"
              style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
            >
              <p className="text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{metric.label}</p>
              <p className="mt-1 text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>{metric.value}</p>
            </div>
          ))}
        </div>
      )}

      {focusContext && (
        <div
          className="mb-4 rounded-xl border px-4 py-3"
          style={{
            backgroundColor: focusContext.background,
            borderColor: `color-mix(in srgb, ${focusContext.color} 20%, transparent)`,
          }}
        >
          <div className="text-sm font-semibold" style={{ color: focusContext.color }}>{focusContext.title}</div>
          <div className="mt-1 text-xs" style={{ color: 'var(--theme-card-text)' }}>{focusContext.description}</div>
        </div>
      )}

      {executionMetrics && compareMetrics && (
        <div
          className="mb-4 rounded-xl border px-4 py-3"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Compared With Typical Run</h3>
              <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Side-by-side with a recent completed run of the same workflow to show what changed.
              </p>
            </div>
            <Link
              href={`/automations/runs/${compareRun.id}`}
              className="text-[10px] font-medium hover:underline"
              style={{ color: 'var(--theme-primary-text)' }}
            >
              Open baseline run
            </Link>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: 'Duration',
                current: formatDuration(executionMetrics.durationMs),
                baseline: formatDuration(compareMetrics.durationMs),
                delta: (executionMetrics.durationMs ?? 0) - (compareMetrics.durationMs ?? 0),
                formatter: (value: number) => `${value >= 0 ? '+' : ''}${formatDuration(Math.abs(value))}`,
              },
              {
                label: 'Executed Nodes',
                current: executionMetrics.executedNodes,
                baseline: compareMetrics.executedNodes,
                delta: executionMetrics.executedNodes - compareMetrics.executedNodes,
                formatter: (value: number) => `${value >= 0 ? '+' : ''}${value}`,
              },
              {
                label: 'Node Visits',
                current: executionMetrics.nodeVisits,
                baseline: compareMetrics.nodeVisits,
                delta: executionMetrics.nodeVisits - compareMetrics.nodeVisits,
                formatter: (value: number) => `${value >= 0 ? '+' : ''}${value}`,
              },
              {
                label: 'Edge Traversals',
                current: executionMetrics.edgeTraversals,
                baseline: compareMetrics.edgeTraversals,
                delta: executionMetrics.edgeTraversals - compareMetrics.edgeTraversals,
                formatter: (value: number) => `${value >= 0 ? '+' : ''}${value}`,
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border px-3 py-3"
                style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-surface-border)' }}
              >
                <div className="text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{metric.label}</div>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>{metric.current}</div>
                    <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>current</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{metric.baseline}</div>
                    <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>baseline</div>
                  </div>
                </div>
                <div
                  className="mt-2 text-[10px] font-semibold"
                  style={{ color: metric.delta > 0 ? 'var(--theme-danger)' : metric.delta < 0 ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}
                >
                  {metric.formatter(metric.delta)} vs baseline
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {focusContext && suspectNodes.length > 0 && (
        <div
          className="mb-4 rounded-xl border px-4 py-3"
          style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
        >
          <div className="flex items-center justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Top Suspect Nodes</h3>
              <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Ranked by likely contribution to this run&apos;s {focus === 'duration' ? 'duration spike' : focus === 'traversal' ? 'traversal spike' : 'anomalous behavior'}.
              </p>
            </div>
            <span
              className="inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold"
              style={{ backgroundColor: focusContext.background, color: focusContext.color }}
            >
              {suspectNodes.length} suspect{suspectNodes.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {suspectNodes.map((node, index) => (
              <button
                key={node.id}
                type="button"
                onClick={() => focusNodeInCanvas(node.id)}
                className="rounded-lg border px-3 py-2"
                style={{
                  borderColor: node.id === selectedSuspectNodeId ? focusContext.color : `color-mix(in srgb, ${focusContext.color} 13%, transparent)`,
                  backgroundColor: 'var(--theme-surface)',
                  boxShadow: node.id === selectedSuspectNodeId ? `0 0 0 1px color-mix(in srgb, ${focusContext.color} 20%, transparent)` : undefined,
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: focusContext.color }}>
                      #{index + 1} suspect
                    </div>
                    <div className="truncate text-sm font-medium" style={{ color: 'var(--theme-card-text)' }} title={node.label}>
                      {node.label}
                    </div>
                  </div>
                  <span
                    className="rounded-full px-2 py-1 text-[10px] font-semibold shrink-0"
                    style={{ backgroundColor: focusContext.background, color: focusContext.color }}
                  >
                    {node.score.toFixed(1)}x
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
                  <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}>
                    {node.type}
                  </span>
                  {node.duration > 0 && (
                    <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}>
                      {node.duration}ms
                    </span>
                  )}
                  {node.visits > 0 && (
                    <span className="rounded-full px-2 py-1" style={{ backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-muted-text)' }}>
                      {node.visits} visits
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b mb-4" style={{ borderColor: 'var(--theme-surface-border)' }}>
        {[
          { id: 'canvas' as const, label: 'Process View' },
          ...(compareRun ? [{ id: 'compare' as const, label: 'Compare' }] : []),
          { id: 'variables' as const, label: `Variables${variableCount > 0 ? ` (${variableCount})` : ''}` },
          { id: 'logs' as const, label: `Logs (${visibleLogs.length}${visibleLogs.length !== logs.length ? `/${logs.length}` : ''})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2 text-sm font-medium transition-colors relative"
            style={{ color: tab === t.id ? 'var(--theme-primary-text)' : 'var(--theme-muted-text)' }}>
            {t.label}
            {tab === t.id && <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full" style={{ backgroundColor: 'var(--theme-primary)' }} />}
          </button>
        ))}
      </div>

      {/* Variables tab — shows every workflow-level variable defined on
          the workflow (workflow.user_variables) merged with the ACTUAL
          values observed in this run. Values come from three sources in
          priority order:
            1. pause_variables (if the run is paused, this is the most
               authoritative snapshot of the variable state)
            2. node_results[*].output — we walk node results looking for
               variable updates that match a defined variable name
            3. The variable's defaultValue
          This lets users see "what values did this instance actually run
          with" which was the key ask from the reports work. */}
      {tab === 'variables' && (
        <VariablesTab workflow={workflow} run={run} />
      )}

      {tab === 'compare' && compareRun && (
        <CompareTab workflow={workflow} run={run} compareRun={compareRun} />
      )}

      {/* Canvas tab — the designer's cards with the run as an overlay */}
      {tab === 'canvas' && (
        <RuntimeCanvas
          nodes={nodes as WorkflowNode[]}
          edges={edges as WorkflowEdge[]}
          swimlanes={workflowSwimlanes}
          overlay={runOverlay}
          nodeResults={nodeResults}
          workflowActive={!!workflow.is_active}
          workflowId={workflow.id}
          focusRequest={focusRequest}
          rootRef={viewerRootRef}
          outlines={Object.fromEntries((nodes as WorkflowNode[]).map((n) => [n.id,
            selectedSuspectNodeId === n.id ? 'var(--theme-primary)'
              : culpritNodeIds.has(n.id) ? (focus === 'duration' ? 'var(--theme-danger)' : focus === 'traversal' ? 'var(--theme-warning)' : 'var(--theme-chart-6)')
              : undefined]))}
          markerPrefix="pv-arrow"
          label="Run canvas"
        />
      )}

      {/* Logs tab */}
      {tab === 'logs' && (
        <div className="rounded-xl border overflow-hidden" style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}>
          {visibleLogs.length === 0 ? (
            <p className="px-4 py-6 text-xs text-center" style={{ color: 'var(--theme-muted-text)' }}>No logs available</p>
          ) : (
            <>
              {/* Copy All bar */}
              <div className="flex items-center justify-between gap-3 px-4 py-2 border-b" style={{ borderColor: 'var(--theme-surface-border)' }}>
                <div className="flex items-center gap-2">
                  {focusContext && suspectNodes.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowSuspectLogsOnly((current) => !current)}
                      className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors hover:opacity-80"
                      style={{
                        backgroundColor: showSuspectLogsOnly ? focusContext.background : 'var(--theme-surface)',
                        color: showSuspectLogsOnly ? focusContext.color : 'var(--theme-muted-text)',
                      }}
                    >
                      {showSuspectLogsOnly ? 'Showing suspect logs' : 'Show suspect logs only'}
                    </button>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                    {visibleLogs.length} log{visibleLogs.length !== 1 ? 's' : ''}
                  </span>
                </div>
                <button
                  onClick={copyAllLogs}
                  className="flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: copiedAll ? 'color-mix(in srgb, var(--theme-success) 8%, transparent)' : 'var(--theme-surface)',
                    color: copiedAll ? 'var(--theme-success)' : 'var(--theme-muted-text)',
                  }}
                >
                  {copiedAll ? <ClipboardCheck size={12} /> : <Copy size={12} />}
                  {copiedAll ? 'Copied!' : 'Copy All'}
                </button>
              </div>
              <div className="divide-y" style={{ borderColor: 'var(--theme-surface-border)' }}>
                {visibleLogs.map((log: any) => {
                  const isExpanded = expandedLog === log.id
                  const isCopied = copiedId === log.id
                  const colors: Record<string, string> = { info: 'var(--status-info)', warn: 'var(--theme-warning)', error: 'var(--theme-danger)', debug: 'var(--theme-muted-text)' }
                  const color = colors[log.level] ?? 'var(--theme-muted-text)'
                  const isSuspectLog = !!(log.node_label && suspectNodeLabels.has(log.node_label))
                  return (
                    <div key={log.id} className="px-4 py-2 cursor-pointer hover:opacity-90 group"
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}>
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                        <span className="text-[10px] font-mono w-10 shrink-0 uppercase" style={{ color }}>{log.level}</span>
                        {log.node_label && (() => {
                          const stepId = logStepId(log, nodes as WorkflowNode[])
                          return <StepChip label={log.node_label} onFocus={stepId ? () => focusNodeInCanvas(stepId) : undefined} />
                        })()}
                        {isSuspectLog && (
                          <span
                            className="text-[10px] px-1 py-0.5 rounded shrink-0"
                            style={{ backgroundColor: focusContext?.background ?? 'color-mix(in srgb, var(--theme-chart-6) 10%, transparent)', color: focusContext?.color ?? 'var(--theme-chart-6-text)' }}
                          >
                            suspect
                          </span>
                        )}
                        <span className="text-xs flex-1 truncate">{log.message}</span>
                        {log.duration_ms != null && (
                          <span className="text-[10px] font-mono shrink-0" style={{ color: 'var(--theme-muted-text)' }}>{log.duration_ms}ms</span>
                        )}
                        <span className="text-[10px] shrink-0" style={{ color: 'var(--theme-muted-text)' }}>
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                        <button
                          onClick={(e) => copyLogLine(e, log)}
                          className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:opacity-80"
                          style={{ color: isCopied ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}
                          title="Copy log entry"
                        >
                          {isCopied ? <ClipboardCheck size={12} /> : <Copy size={12} />}
                        </button>
                        {log.metadata && (isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
                      </div>
                      {isExpanded && log.metadata && (
                        <pre className="mt-1 text-[10px] font-mono p-2 rounded overflow-x-auto"
                          style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Renders the "Variables" tab of ProcessViewer.
 *
 * Surfaces every workflow-level user variable with the value that was
 * actually observed in this run. Value resolution is priority-ordered:
 *   1. run.pause_variables — if present this is the canonical snapshot
 *      taken when the run paused for an event
 *   2. Most recent workflow_variables.set result emitted by any node in
 *      run.node_results (we walk them to find updates)
 *   3. The variable's defaultValue from the workflow definition
 *
 * When no workflow variables are defined we render a friendly empty
 * state. When a variable has a value that's an object or array we
 * pretty-print it as JSON; primitives render inline.
 */
function VariablesTab({ workflow, run }: { workflow: any; run: any }) {
  const variableDefs: { name: string; type?: string; defaultValue?: any; description?: string }[] =
    Array.isArray(workflow.user_variables) ? workflow.user_variables : []

  // Build the observed-values map once per render. We merge the default
  // values first, then apply pause_variables (if any), then walk
  // node_results looking for entries where the node output directly set
  // a user-variable key. Workflow nodes that mutate variables conventionally
  // write them at the top level of their output object.
  const values: Record<string, any> = {}
  for (const v of variableDefs) {
    if (v.defaultValue !== undefined) values[v.name] = v.defaultValue
  }
  if (run?.pause_variables && typeof run.pause_variables === 'object') {
    for (const [k, v] of Object.entries(run.pause_variables)) {
      values[k] = v
    }
  }
  if (run?.node_results && typeof run.node_results === 'object') {
    for (const nodeResult of Object.values(run.node_results as Record<string, any>)) {
      const output = nodeResult?.output
      if (output && typeof output === 'object') {
        for (const v of variableDefs) {
          if (Object.prototype.hasOwnProperty.call(output, v.name)) {
            values[v.name] = output[v.name]
          }
        }
      }
    }
  }

  function renderValue(val: any): React.ReactNode {
    if (val == null || val === '') {
      return <span className="italic" style={{ color: 'var(--theme-muted-text)' }}>(empty)</span>
    }
    if (typeof val === 'boolean') {
      return <span className="font-mono" style={{ color: val ? 'var(--status-success)' : 'var(--status-error)' }}>{String(val)}</span>
    }
    if (typeof val === 'number') {
      return <span className="font-mono" style={{ color: 'var(--status-info)' }}>{val}</span>
    }
    if (typeof val === 'string') {
      return <span className="font-mono break-all" style={{ color: 'var(--theme-card-text)' }}>{val}</span>
    }
    // Defensive stringify — workflow node output can contain objects with
    // circular refs (e.g. a response body that includes the request it
    // came from). JSON.stringify throws in that case, which would crash
    // the whole Variables tab. Fall back to a placeholder instead.
    let serialized: string
    try {
      serialized = JSON.stringify(val, null, 2)
    } catch {
      serialized = '[Unserializable value — contains circular refs or non-JSON data]'
    }
    return (
      <pre
        className="font-mono text-[10px] whitespace-pre-wrap break-all rounded p-2 max-h-40 overflow-auto"
        style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}
      >
        {serialized}
      </pre>
    )
  }

  if (variableDefs.length === 0) {
    return (
      <div
        className="rounded-xl border p-12 text-center"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      >
        <p className="text-sm mb-1" style={{ color: 'var(--theme-card-text)' }}>No workflow variables defined</p>
        <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          Add user variables to the workflow definition to see their runtime values here.
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl border overflow-hidden"
      style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
    >
      <table className="w-full text-xs">
        <thead>
          <tr style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
            <th className="text-left pl-4 py-2 font-medium uppercase text-[10px] tracking-wider w-1/4">Variable</th>
            <th className="text-left py-2 font-medium uppercase text-[10px] tracking-wider w-16">Type</th>
            <th className="text-left py-2 font-medium uppercase text-[10px] tracking-wider">Value</th>
            <th className="text-left pr-4 py-2 font-medium uppercase text-[10px] tracking-wider w-24">Source</th>
          </tr>
        </thead>
        <tbody>
          {variableDefs.map((v, i) => {
            const hasValue = values[v.name] !== undefined
            // Determine where the displayed value came from — useful for
            // debugging "why does this variable show the default?"
            const fromPause = run?.pause_variables && Object.prototype.hasOwnProperty.call(run.pause_variables, v.name)
            const fromNodeResult = !fromPause && run?.node_results && Object.values(run.node_results as Record<string, any>).some(
              (nr: any) => nr?.output && typeof nr.output === 'object' && Object.prototype.hasOwnProperty.call(nr.output, v.name)
            )
            const source = fromPause ? 'pause' : fromNodeResult ? 'node' : hasValue ? 'default' : 'unset'
            const sourceColor = source === 'pause' ? 'var(--status-warning)'
              : source === 'node' ? 'var(--status-success)'
              : source === 'default' ? 'var(--theme-muted-text)'
              : 'var(--theme-muted-text)'
            return (
              <tr
                key={i}
                className="border-t"
                style={{ borderColor: 'var(--theme-surface-border)' }}
              >
                <td className="pl-4 py-2.5 align-top">
                  <div className="font-mono font-semibold" style={{ color: 'var(--theme-card-text)' }}>{v.name}</div>
                  {v.description && (
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--theme-muted-text)' }}>{v.description}</div>
                  )}
                </td>
                <td className="py-2.5 align-top">
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-mono" style={{ backgroundColor: 'var(--theme-primary-light)', color: 'var(--theme-primary-text)' }}>
                    {v.type ?? 'text'}
                  </span>
                </td>
                <td className="py-2.5 align-top">{renderValue(values[v.name])}</td>
                <td className="pr-4 py-2.5 align-top">
                  <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: sourceColor }}>
                    {source}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function CompareTab({ workflow, run, compareRun }: { workflow: any; run: any; compareRun: any }) {
  const [compareFocus, setCompareFocus] = useState<{ nodeId: string; nonce: number } | null>(null)
  const nodes = normalizeDataTableNodes(Array.isArray(workflow.nodes) ? workflow.nodes : [])
  const currentNodeResults = (run?.node_results as Record<string, any>) ?? {}
  const baselineNodeResults = (compareRun?.node_results as Record<string, any>) ?? {}
  const currentTrace = parseJsonField<any[]>(run?.execution_trace, [])
  const baselineTrace = parseJsonField<any[]>(compareRun?.execution_trace, [])

  const visitMapFor = (trace: any[]) => {
    const visits: Record<string, number> = {}
    for (const entry of trace) {
      if (entry?.type === 'node' && typeof entry?.node_id === 'string' && (entry?.phase === 'enter' || entry?.phase === 'resume')) {
        visits[entry.node_id] = (visits[entry.node_id] ?? 0) + 1
      }
    }
    return visits
  }

  const currentVisitMap = visitMapFor(currentTrace)
  const baselineVisitMap = visitMapFor(baselineTrace)

  const normalize = (value: unknown) => {
    try {
      return JSON.stringify(value ?? null)
    } catch {
      return '[unserializable]'
    }
  }

  type CompareRow = {
    id: string
    label: string
    type: string
    currentStatus: string
    baselineStatus: string
    currentDuration: number
    baselineDuration: number
    currentVisits: number
    baselineVisits: number
    outputChanged: boolean
    changed: boolean
    diffKind: 'added' | 'removed' | 'status' | 'duration' | 'visits' | 'output'
  }

  const rows: CompareRow[] = nodes
    .filter((node: any) => node.type !== 'section_group')
    .map((node: any) => {
      const current = currentNodeResults[node.id]
      const baseline = baselineNodeResults[node.id]
      const currentDuration = typeof current?.duration_ms === 'number' ? current.duration_ms : 0
      const baselineDuration = typeof baseline?.duration_ms === 'number' ? baseline.duration_ms : 0
      const currentVisits = currentVisitMap[node.id] ?? (current ? 1 : 0)
      const baselineVisits = baselineVisitMap[node.id] ?? (baseline ? 1 : 0)
      const currentOutput = normalize(current?.output)
      const baselineOutput = normalize(baseline?.output)
      const changed =
        (!!current) !== (!!baseline)
        || current?.status !== baseline?.status
        || currentDuration !== baselineDuration
        || currentVisits !== baselineVisits
        || currentOutput !== baselineOutput
      const diffKind: CompareRow['diffKind'] =
        current && !baseline ? 'added'
          : !current && baseline ? 'removed'
            : current?.status !== baseline?.status ? 'status'
              : currentDuration !== baselineDuration ? 'duration'
                : currentVisits !== baselineVisits ? 'visits'
                  : 'output'

      return {
        id: node.id,
        label: node.label,
        type: node.type,
        currentStatus: current?.status ?? 'not_run',
        baselineStatus: baseline?.status ?? 'not_run',
        currentDuration,
        baselineDuration,
        currentVisits,
        baselineVisits,
        outputChanged: currentOutput !== baselineOutput,
        changed,
        diffKind,
      }
    })
    .filter((row: CompareRow) => row.changed)
    .sort((a: CompareRow, b: CompareRow) => {
      const aScore = Math.abs(a.currentDuration - a.baselineDuration) + Math.abs(a.currentVisits - a.baselineVisits) * 100
      const bScore = Math.abs(b.currentDuration - b.baselineDuration) + Math.abs(b.currentVisits - b.baselineVisits) * 100
      return bScore - aScore
    })

  const summary = {
    changedNodes: rows.length,
    addedNodes: rows.filter((row: CompareRow) => row.currentStatus !== 'not_run' && row.baselineStatus === 'not_run').length,
    removedNodes: rows.filter((row: CompareRow) => row.currentStatus === 'not_run' && row.baselineStatus !== 'not_run').length,
    outputChanges: rows.filter((row: CompareRow) => row.outputChanged).length,
  }
  const rowsById = new Map(rows.map((row) => [row.id, row] as const))
  // Same cards as the designer: the current run as the overlay, diffs as outlines.
  const compareEdges: WorkflowEdge[] = Array.isArray(workflow.edges) ? workflow.edges : []
  const currentOverlay = computeRunOverlay({ nodes: nodes as WorkflowNode[], edges: compareEdges, nodeResults: currentNodeResults, visits: currentVisitMap })
  const diffStyle = (kind: CompareRow['diffKind']) => {
    switch (kind) {
      case 'added':
        return { color: 'var(--status-info)', background: 'color-mix(in srgb, var(--status-info) 10%, transparent)', border: 'var(--status-info)' }
      case 'removed':
        return { color: 'var(--theme-muted-text)', background: 'color-mix(in srgb, var(--theme-muted-text) 12%, transparent)', border: 'var(--theme-muted-text)' }
      case 'status':
        return { color: 'var(--theme-chart-6-text)', background: 'color-mix(in srgb, var(--theme-chart-6) 10%, transparent)', border: 'var(--theme-chart-6)' }
      case 'duration':
        return { color: 'var(--theme-danger)', background: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)', border: 'var(--theme-danger)' }
      case 'visits':
        return { color: 'var(--theme-warning)', background: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)', border: 'var(--theme-warning)' }
      case 'output':
      default:
        return { color: 'var(--theme-primary-hover)', background: 'color-mix(in srgb, var(--theme-primary) 10%, transparent)', border: 'var(--theme-primary-hover)' }
    }
  }

  return (
    <div className="space-y-4">
      <div
        className="rounded-xl border px-4 py-3"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Run Comparison</h3>
            <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Comparing this run against baseline run {compareRun?.id?.slice?.(0, 8) ?? '—'} to show node-level execution differences.
            </p>
          </div>
          <Link
            href={`/automations/runs/${compareRun.id}`}
            className="text-[10px] font-medium hover:underline"
            style={{ color: 'var(--theme-primary-text)' }}
          >
            Open baseline
          </Link>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[
            { label: 'Changed Nodes', value: summary.changedNodes },
            { label: 'New In Current', value: summary.addedNodes },
            { label: 'Missing Vs Baseline', value: summary.removedNodes },
            { label: 'Output Changes', value: summary.outputChanges },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border px-3 py-3"
              style={{ backgroundColor: 'var(--theme-surface)', borderColor: 'var(--theme-surface-border)' }}
            >
              <div className="text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{metric.label}</div>
              <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>{metric.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="rounded-xl border overflow-hidden"
        style={{ backgroundColor: 'var(--theme-card-bg)', borderColor: 'var(--theme-surface-border)' }}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: 'var(--theme-surface-border)' }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h4 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Compare Canvas</h4>
              <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                Visual node diff between the current run and the baseline run.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[10px]">
              {([
                ['added', 'Added'],
                ['removed', 'Missing'],
                ['status', 'Status'],
                ['duration', 'Duration'],
                ['visits', 'Visits'],
                ['output', 'Output'],
              ] as Array<[CompareRow['diffKind'], string]>).map(([kind, label]) => {
                const style = diffStyle(kind)
                return (
                  <span
                    key={kind}
                    className="rounded-full px-2 py-1"
                    style={{ backgroundColor: style.background, color: style.color }}
                  >
                    {label}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
        <div className="p-3">
          <RuntimeCanvas
            nodes={nodes as WorkflowNode[]}
            edges={compareEdges}
            swimlanes={Array.isArray(workflow.swimlanes) ? workflow.swimlanes : []}
            overlay={currentOverlay}
            nodeResults={currentNodeResults}
            workflowActive={!!workflow.is_active}
            workflowId={workflow.id}
            focusRequest={compareFocus}
            outlines={Object.fromEntries(rows.map((row) => [row.id, diffStyle(row.diffKind).color]))}
            renderDetails={(node) => {
              const row = rowsById.get(node.id)
              return (
                <div className="mx-3 mb-2 rounded-lg px-2 py-1.5 text-[11px] space-y-0.5" style={{ backgroundColor: 'var(--theme-surface)' }}>
                  {row ? (<>
                    <div><span style={{ color: 'var(--theme-muted-text)' }}>Diff:</span> <span style={{ color: diffStyle(row.diffKind).color }}>{row.diffKind}</span></div>
                    <div><span style={{ color: 'var(--theme-muted-text)' }}>Current:</span> {row.currentStatus}</div>
                    <div><span style={{ color: 'var(--theme-muted-text)' }}>Baseline:</span> {row.baselineStatus}</div>
                  </>) : <div style={{ color: 'var(--theme-muted-text)' }}>No meaningful diff</div>}
                </div>
              )
            }}
            markerPrefix="cmp-arrow"
            label="Compare canvas"
          />
        </div>

        {rows.length === 0 ? (
          <p className="px-4 py-10 text-center text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            No meaningful node differences found between the current run and the selected baseline.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-muted-text)' }}>
                  <th className="text-left px-4 py-2 font-medium uppercase text-[10px] tracking-wider">Node</th>
                  <th className="text-left py-2 font-medium uppercase text-[10px] tracking-wider">Current</th>
                  <th className="text-left py-2 font-medium uppercase text-[10px] tracking-wider">Baseline</th>
                  <th className="text-right py-2 font-medium uppercase text-[10px] tracking-wider">Duration Δ</th>
                  <th className="text-right py-2 font-medium uppercase text-[10px] tracking-wider">Visits Δ</th>
                  <th className="text-right pr-4 py-2 font-medium uppercase text-[10px] tracking-wider">Output</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row: CompareRow) => (
                  <tr key={row.id} className="border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
                    <td className="px-4 py-2.5">
                      <button type="button" className="font-medium text-left hover:underline inline-flex items-center gap-1" style={{ color: 'var(--theme-card-text)' }}
                        onClick={() => setCompareFocus({ nodeId: row.id, nonce: Date.now() })} title={`Show ${row.label} on the compare canvas`} data-step-chip="">
                        <Crosshair size={11} aria-hidden="true" style={{ color: 'var(--theme-muted-text)' }} />{row.label}
                      </button>
                      <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{row.type}</div>
                    </td>
                    <td className="py-2.5">
                      <div style={{ color: 'var(--theme-card-text)' }}>{row.currentStatus}</div>
                      <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                        {row.currentDuration ? `${row.currentDuration}ms` : '—'} · {row.currentVisits} visit{row.currentVisits !== 1 ? 's' : ''}
                      </div>
                    </td>
                    <td className="py-2.5">
                      <div style={{ color: 'var(--theme-card-text)' }}>{row.baselineStatus}</div>
                      <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                        {row.baselineDuration ? `${row.baselineDuration}ms` : '—'} · {row.baselineVisits} visit{row.baselineVisits !== 1 ? 's' : ''}
                      </div>
                    </td>
                    <td className="text-right py-2.5 font-mono" style={{ color: row.currentDuration - row.baselineDuration > 0 ? 'var(--theme-danger)' : row.currentDuration - row.baselineDuration < 0 ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}>
                      {row.currentDuration - row.baselineDuration >= 0 ? '+' : ''}{row.currentDuration - row.baselineDuration}ms
                    </td>
                    <td className="text-right py-2.5 font-mono" style={{ color: row.currentVisits - row.baselineVisits > 0 ? 'var(--theme-warning)' : row.currentVisits - row.baselineVisits < 0 ? 'var(--theme-success)' : 'var(--theme-muted-text)' }}>
                      {row.currentVisits - row.baselineVisits >= 0 ? '+' : ''}{row.currentVisits - row.baselineVisits}
                    </td>
                    <td className="text-right pr-4 py-2.5">
                      {row.outputChanged ? (
                        <span className="rounded-full px-2 py-1 text-[10px]" style={{ backgroundColor: 'color-mix(in srgb, var(--theme-chart-6) 10%, transparent)', color: 'var(--theme-chart-6-text)' }}>
                          changed
                        </span>
                      ) : (
                        <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>same</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
