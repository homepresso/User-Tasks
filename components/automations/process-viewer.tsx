'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Copy, ClipboardCheck, Crosshair } from 'lucide-react'
import Link from 'next/link'
import { type WorkflowEdge, type WorkflowNode } from '@/lib/workflow-schema'
import { cn } from '@/lib/utils'
import { formatCount } from '@/lib/format/number'
import { formatDurationDelta, formatDurationMs } from '@/lib/format/duration'
import { plural } from '@/lib/format/plural'
import { StatCard, StatGrid, type StatDelta } from '@/components/ui/stat-card'
import { Tabs } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge, StatusPill, Tag } from '@/components/ui/badge'
import { InlineNotice } from '@/components/ui/inline-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { average, parseJsonField } from '@/lib/report-flow-stats'
import { logStepId, RuntimeCanvas, StepChip } from './runtime-canvas'
import { computeRunOverlay } from '@/lib/workflow-run-overlay'
import { normalizeDataTableNodes } from '@/lib/workflow-table-refs'
import type { RunTask } from '@/lib/run-tasks'
import { RunStepTasks, RunTaskSteps, runStepBadges } from './run-task-links'

interface ProcessViewerProps {
  workflow: any
  run: any
  logs: any[]
  focus?: string | null
  compareRun?: any
  /** The run's User Tasks with the viewer's access (automations.processView). */
  tasks?: RunTask[]
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

const LOG_LEVEL_TONE: Record<string, { text: string; dot: string }> = {
  info: { text: 'text-info', dot: 'bg-info' },
  warn: { text: 'text-warning', dot: 'bg-warning' },
  error: { text: 'text-danger', dot: 'bg-danger' },
  debug: { text: 'text-fg-muted', dot: 'bg-fg-subtle' },
}

export function ProcessViewer({ workflow, run, logs, focus, compareRun, tasks = [] }: ProcessViewerProps) {
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
        title: 'Duration spike focus',
        tone: 'danger' as const,
        description: 'This run was opened from a duration anomaly, so start by checking the longest steps and the logs around elapsed time.',
        color: 'var(--theme-danger)',
        background: 'color-mix(in srgb, var(--theme-danger) 10%, transparent)',
      }
    }
    if (focus === 'traversal') {
      return {
        title: 'Traversal spike focus',
        tone: 'warning' as const,
        description: 'This run was opened from a traversal anomaly, so focus on extra branches, loops, and unexpected path depth through the workflow.',
        color: 'var(--theme-warning)',
        background: 'color-mix(in srgb, var(--theme-warning) 10%, transparent)',
      }
    }
    if (focus === 'spike') {
      return {
        title: 'Anomaly focus',
        tone: 'info' as const,
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

  const metricDelta = (current: number | null, baseline: number | null, format: (value: number) => string): StatDelta | undefined => {
    if (!compareMetrics) return undefined
    const delta = (current ?? 0) - (baseline ?? 0)
    return { label: format(delta), direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat', goodWhen: 'down', caption: 'vs typical run' }
  }
  const countDelta = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatCount(Math.abs(value))}`

  return (
    <div ref={viewerRootRef}>
      {executionMetrics && (
        <div className="mb-4">
          <StatGrid>
            <StatCard
              label="Duration"
              value={formatDurationMs(executionMetrics.durationMs)}
              delta={metricDelta(executionMetrics.durationMs, compareMetrics?.durationMs ?? null, formatDurationDelta)}
              hint={compareMetrics ? `Typical run: ${formatDurationMs(compareMetrics.durationMs)}` : undefined}
            />
            <StatCard
              label="Executed nodes"
              value={formatCount(executionMetrics.executedNodes)}
              delta={metricDelta(executionMetrics.executedNodes, compareMetrics?.executedNodes ?? null, countDelta)}
              hint={compareMetrics ? `Typical run: ${formatCount(compareMetrics.executedNodes)}` : undefined}
            />
            <StatCard
              label="Node visits"
              value={formatCount(executionMetrics.nodeVisits)}
              delta={metricDelta(executionMetrics.nodeVisits, compareMetrics?.nodeVisits ?? null, countDelta)}
              hint={compareMetrics ? `Typical run: ${formatCount(compareMetrics.nodeVisits)}` : undefined}
            />
            <StatCard
              label="Edge traversals"
              value={formatCount(executionMetrics.edgeTraversals)}
              delta={metricDelta(executionMetrics.edgeTraversals, compareMetrics?.edgeTraversals ?? null, countDelta)}
              hint={compareMetrics ? `Typical run: ${formatCount(compareMetrics.edgeTraversals)}` : undefined}
            />
          </StatGrid>
          {compareMetrics && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-fg-muted">
              <span>Compared with a recent completed run of the same workflow to show what changed.</span>
              <Button asChild variant="link" size="sm">
                <Link href={`/automations/runs/${compareRun.id}`}>Open baseline run</Link>
              </Button>
            </div>
          )}
        </div>
      )}

      {focusContext && (
        <InlineNotice tone={focusContext.tone} title={focusContext.title} className="mb-4">
          <p className="mt-0.5 text-xs">{focusContext.description}</p>
        </InlineNotice>
      )}

      {focusContext && suspectNodes.length > 0 && (
        <Card padding="none" className="mb-4">
          <CardHeader
            title="Top suspect nodes"
            description={`Ranked by likely contribution to this run's ${focus === 'duration' ? 'duration spike' : focus === 'traversal' ? 'traversal spike' : 'anomalous behavior'}.`}
            actions={<Badge tone={focusContext.tone === 'info' ? 'neutral' : focusContext.tone}>{plural(suspectNodes.length, 'suspect')}</Badge>}
          />
          <CardBody>
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {suspectNodes.map((node, index) => (
                <button
                  key={node.id}
                  type="button"
                  onClick={() => focusNodeInCanvas(node.id)}
                  aria-pressed={node.id === selectedSuspectNodeId}
                  className={cn(
                    'rounded-md border bg-subtle px-3 py-2 text-left transition-colors hover:border-border-strong',
                    node.id === selectedSuspectNodeId ? 'border-primary bg-primary-wash' : 'border-border-subtle',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-2xs font-medium" style={{ color: focusContext.color }}>
                        Suspect #{index + 1}
                      </div>
                      <div className="truncate text-ui font-medium text-fg" title={node.label}>
                        {node.label}
                      </div>
                    </div>
                    <span className="num shrink-0 text-xs font-semibold" style={{ color: focusContext.color }}>
                      {node.score.toFixed(1)}×
                    </span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Tag mono>{node.type}</Tag>
                    {node.duration > 0 && <Tag className="num">{formatDurationMs(node.duration)}</Tag>}
                    {node.visits > 0 && <Tag className="num">{plural(node.visits, 'visit')}</Tag>}
                  </div>
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Tabs */}
      <Tabs
        aria-label="Run views"
        idBase="run-view"
        className="mb-4"
        value={tab}
        onValueChange={setTab}
        items={[
          { value: 'canvas' as const, label: 'Process view' },
          ...(compareRun ? [{ value: 'compare' as const, label: 'Compare' }] : []),
          { value: 'variables' as const, label: 'Variables', count: variableCount > 0 ? variableCount : undefined },
          { value: 'logs' as const, label: visibleLogs.length !== logs.length ? `Logs (${visibleLogs.length}/${logs.length})` : 'Logs', count: visibleLogs.length !== logs.length ? undefined : logs.length },
        ]}
      />

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
          nodeAdornments={runStepBadges(tasks)}
          renderDetails={(node) => <RunStepTasks tasks={tasks} nodeId={node.id} />}
        />
      )}
      {tab === 'canvas' && tasks.length > 0 && (
        <Card padding="md" className="mt-4">
          <h2 className="mb-3 text-base font-semibold text-fg">User Tasks</h2>
          <RunTaskSteps tasks={tasks} onFocusStep={focusNodeInCanvas} />
        </Card>
      )}

      {/* Logs tab */}
      {tab === 'logs' && (
        <div className="overflow-hidden rounded-lg border border-border bg-panel">
          {visibleLogs.length === 0 ? (
            <EmptyState size="sm" title="No logs for this run" description="Steps write log entries as they run." />
          ) : (
            <>
              {/* Copy All bar */}
              <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2">
                <div className="flex items-center gap-2">
                  {focusContext && suspectNodes.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant={showSuspectLogsOnly ? 'secondary' : 'ghost'}
                      aria-pressed={showSuspectLogsOnly}
                      onClick={() => setShowSuspectLogsOnly((current) => !current)}
                    >
                      {showSuspectLogsOnly ? 'Showing suspect logs' : 'Show suspect logs only'}
                    </Button>
                  )}
                  <span className="num text-xs text-fg-muted">
                    {plural(visibleLogs.length, 'log')}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={copyAllLogs}
                  leadingIcon={copiedAll ? <ClipboardCheck className="text-success" /> : <Copy />}
                >
                  {copiedAll ? 'Copied' : 'Copy all'}
                </Button>
              </div>
              <div className="divide-y divide-border-subtle">
                {visibleLogs.map((log: any) => {
                  const isExpanded = expandedLog === log.id
                  const isCopied = copiedId === log.id
                  const tone = LOG_LEVEL_TONE[log.level] ?? LOG_LEVEL_TONE.debug
                  const isSuspectLog = !!(log.node_label && suspectNodeLabels.has(log.node_label))
                  return (
                    <div key={log.id} className="group cursor-pointer px-4 py-2 hover:bg-subtle"
                      onClick={() => setExpandedLog(isExpanded ? null : log.id)}>
                      <div className="flex items-center gap-2">
                        <span className={cn('size-1.5 shrink-0 rounded-full', tone.dot)} aria-hidden="true" />
                        <span className={cn('w-10 shrink-0 font-mono text-2xs', tone.text)}>{log.level}</span>
                        {log.node_label && (() => {
                          const stepId = logStepId(log, nodes as WorkflowNode[])
                          return <StepChip label={log.node_label} onFocus={stepId ? () => focusNodeInCanvas(stepId) : undefined} />
                        })()}
                        {isSuspectLog && (
                          <Badge tone={focusContext ? (focusContext.tone === 'info' ? 'neutral' : focusContext.tone) : 'neutral'} className="shrink-0">
                            Suspect
                          </Badge>
                        )}
                        <span className="flex-1 truncate text-ui text-fg">{log.message}</span>
                        {log.duration_ms != null && (
                          <span className="num shrink-0 font-mono text-2xs text-fg-muted">{formatDurationMs(log.duration_ms)}</span>
                        )}
                        <span className="num shrink-0 text-2xs text-fg-muted">
                          {new Date(log.created_at).toLocaleTimeString()}
                        </span>
                        <IconButton
                          size="sm"
                          label={isCopied ? 'Copied' : 'Copy log entry'}
                          icon={isCopied ? <ClipboardCheck className="text-success" /> : <Copy />}
                          onClick={(e) => copyLogLine(e, log)}
                          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        />
                        {log.metadata && (isExpanded ? <ChevronDown size={14} className="text-fg-muted" aria-hidden="true" /> : <ChevronRight size={14} className="text-fg-muted" aria-hidden="true" />)}
                      </div>
                      {isExpanded && log.metadata && (
                        <pre className="mt-1 overflow-x-auto rounded-md bg-subtle p-2 font-mono text-2xs text-fg-muted">
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
      return <span className="italic text-fg-muted">(empty)</span>
    }
    if (typeof val === 'boolean') {
      return <span className={cn('font-mono', val ? 'text-success' : 'text-danger')}>{String(val)}</span>
    }
    if (typeof val === 'number') {
      return <span className="num font-mono text-info">{val}</span>
    }
    if (typeof val === 'string') {
      return <span className="break-all font-mono text-fg">{val}</span>
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
      <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md bg-subtle p-2 font-mono text-2xs text-fg">
        {serialized}
      </pre>
    )
  }

  if (variableDefs.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-panel">
        <EmptyState
          size="sm"
          title="No workflow variables defined"
          description="Add user variables to the workflow definition to see their runtime values here."
        />
      </div>
    )
  }

  return (
    <Table>
      <THead>
        <tr>
          <TH className="w-1/4">Variable</TH>
          <TH className="w-24">Type</TH>
          <TH>Value</TH>
          <TH className="w-24">Source</TH>
        </tr>
      </THead>
      <TBody>
        {variableDefs.map((v, i) => {
          const hasValue = values[v.name] !== undefined
          // Determine where the displayed value came from — useful for
          // debugging "why does this variable show the default?"
          const fromPause = run?.pause_variables && Object.prototype.hasOwnProperty.call(run.pause_variables, v.name)
          const fromNodeResult = !fromPause && run?.node_results && Object.values(run.node_results as Record<string, any>).some(
            (nr: any) => nr?.output && typeof nr.output === 'object' && Object.prototype.hasOwnProperty.call(nr.output, v.name)
          )
          const source = fromPause ? 'pause' : fromNodeResult ? 'node' : hasValue ? 'default' : 'unset'
          const sourceTone = source === 'pause' ? 'warning' as const : source === 'node' ? 'success' as const : 'neutral' as const
          return (
            <TR key={i}>
              <TD className="py-2 align-top">
                <div className="font-mono text-ui font-medium text-fg">{v.name}</div>
                {v.description && (
                  <div className="mt-0.5 text-xs text-fg-muted">{v.description}</div>
                )}
              </TD>
              <TD className="py-2 align-top">
                <Tag mono>{v.type ?? 'text'}</Tag>
              </TD>
              <TD className="py-2 align-top text-ui">{renderValue(values[v.name])}</TD>
              <TD className="py-2 align-top">
                <Badge tone={sourceTone}>{source}</Badge>
              </TD>
            </TR>
          )
        })}
      </TBody>
    </Table>
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

  const signed = (value: number, format: (abs: number) => string) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-fg-muted">
            Comparing this run against baseline run <span className="font-mono">{compareRun?.id?.slice?.(0, 8) ?? '—'}</span> to show node-level execution differences.
          </p>
          <Button asChild variant="link" size="sm">
            <Link href={`/automations/runs/${compareRun.id}`}>Open baseline</Link>
          </Button>
        </div>
        <StatGrid>
          <StatCard label="Changed nodes" value={formatCount(summary.changedNodes)} />
          <StatCard label="New in current" value={formatCount(summary.addedNodes)} />
          <StatCard label="Missing vs baseline" value={formatCount(summary.removedNodes)} />
          <StatCard label="Output changes" value={formatCount(summary.outputChanges)} />
        </StatGrid>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-panel">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-subtle px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-fg">Compare canvas</h3>
            <p className="mt-0.5 text-xs text-fg-muted">
              Visual node diff between the current run and the baseline run.
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 text-2xs">
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
                  className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium"
                  style={{ backgroundColor: style.background, color: style.color }}
                >
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: style.border }} aria-hidden="true" />
                  {label}
                </span>
              )
            })}
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
                <div className="mx-3 mb-2 space-y-0.5 rounded-md bg-subtle px-2 py-1.5 text-xs">
                  {row ? (<>
                    <div><span className="text-fg-muted">Diff:</span> <span style={{ color: diffStyle(row.diffKind).color }}>{row.diffKind}</span></div>
                    <div><span className="text-fg-muted">Current:</span> {row.currentStatus}</div>
                    <div><span className="text-fg-muted">Baseline:</span> {row.baselineStatus}</div>
                  </>) : <div className="text-fg-muted">No meaningful diff</div>}
                </div>
              )
            }}
            markerPrefix="cmp-arrow"
            label="Compare canvas"
          />
        </div>

        {rows.length === 0 ? (
          <div className="border-t border-border-subtle">
            <EmptyState
              size="sm"
              title="No node differences"
              description="No meaningful node differences found between the current run and the selected baseline."
            />
          </div>
        ) : (
          <div className="border-t border-border-subtle">
            <Table bare>
              <THead>
                <tr>
                  <TH>Node</TH>
                  <TH>Current</TH>
                  <TH>Baseline</TH>
                  <TH numeric>Duration Δ</TH>
                  <TH numeric>Visits Δ</TH>
                  <TH numeric>Output</TH>
                </tr>
              </THead>
              <TBody>
                {rows.map((row: CompareRow) => {
                  const durationDelta = row.currentDuration - row.baselineDuration
                  const visitsDelta = row.currentVisits - row.baselineVisits
                  return (
                    <TR key={row.id}>
                      <TD className="py-2">
                        <button type="button" className="inline-flex items-center gap-1 text-left text-ui font-medium text-fg hover:underline"
                          onClick={() => setCompareFocus({ nodeId: row.id, nonce: Date.now() })} title={`Show ${row.label} on the compare canvas`} data-step-chip="">
                          <Crosshair size={12} aria-hidden="true" className="text-fg-muted" />{row.label}
                        </button>
                        <div className="font-mono text-2xs text-fg-muted">{row.type}</div>
                      </TD>
                      <TD className="py-2">
                        <StatusPill status={row.currentStatus} />
                        <div className="num mt-0.5 text-xs text-fg-muted">
                          {row.currentDuration ? formatDurationMs(row.currentDuration) : '—'} · {plural(row.currentVisits, 'visit')}
                        </div>
                      </TD>
                      <TD className="py-2">
                        <StatusPill status={row.baselineStatus} />
                        <div className="num mt-0.5 text-xs text-fg-muted">
                          {row.baselineDuration ? formatDurationMs(row.baselineDuration) : '—'} · {plural(row.baselineVisits, 'visit')}
                        </div>
                      </TD>
                      <TD numeric className={cn('font-mono text-ui', durationDelta > 0 ? 'text-danger' : durationDelta < 0 ? 'text-success' : 'text-fg-muted')}>
                        {durationDelta === 0 ? '0 ms' : formatDurationDelta(durationDelta)}
                      </TD>
                      <TD numeric className={cn('font-mono text-ui', visitsDelta > 0 ? 'text-warning' : visitsDelta < 0 ? 'text-success' : 'text-fg-muted')}>
                        {signed(visitsDelta, formatCount)}
                      </TD>
                      <TD numeric>
                        {row.outputChanged ? (
                          <Badge tone="brand">Changed</Badge>
                        ) : (
                          <span className="text-xs text-fg-muted">Same</span>
                        )}
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  )
}
