"use client"

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, GitCompare, Shuffle, Workflow as WorkflowIcon } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { Button } from '@/components/ui/button'
import { average, parseJsonField, runEdgeTraversals, runNodeVisits } from '@/lib/report-flow-stats'
import { formatDuration } from '@/lib/format'

/** `nodeVisits`: per-node visits over these runs (workflow_node_visit_stats). */
function buildWorkflowSummary(workflow: any, runs: any[], queueStats: any[], nodeVisits: Record<string, number>) {
  const nodes = parseJsonField<any[]>(workflow?.nodes, [])
  const edges = parseJsonField<any[]>(workflow?.edges, [])
  const durations = runs
    .filter((run) => run.started_at && run.completed_at)
    .map((run) => new Date(run.completed_at).getTime() - new Date(run.started_at).getTime())
  const nodeVisitValues = runs.map((run) => runNodeVisits(run))
  const traversalValues = runs.map((run) => runEdgeTraversals(run))
  const hotNodes = nodes
    .filter((node: any) => node.type !== 'section_group')
    .map((node: any) => ({
      id: node.id,
      label: node.label,
      type: node.type,
      visits: nodeVisits[node.id] ?? 0,
    }))
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5)

  return {
    totalRuns: runs.length,
    activeRuns: runs.filter((run) => ['running', 'pending', 'paused', 'waiting_for_event'].includes(run.status)).length + queueStats.length,
    errors: runs.filter((run) => run.status === 'failed').length,
    avgDurationMs: average(durations),
    avgNodeVisits: Math.round(average(nodeVisitValues) * 10) / 10,
    avgEdgeTraversals: Math.round(average(traversalValues) * 10) / 10,
    triggerType: workflow?.trigger_type ?? 'manual',
    isActive: !!workflow?.is_active,
    variableCount: Array.isArray(workflow?.user_variables) ? workflow.user_variables.length : 0,
    nodeCount: nodes.filter((node: any) => node.type !== 'section_group').length,
    sectionCount: nodes.filter((node: any) => node.type === 'section_group').length,
    edgeCount: edges.length,
    hotNodes,
  }
}

function compareValueKind(a: number, b: number) {
  if (a === b) return 'equal'
  return a > b ? 'a' : 'b'
}

function deltaLabel(a: number, b: number, formatter?: (value: number) => string) {
  const delta = a - b
  if (delta === 0) return 'No difference'
  const value = formatter ? formatter(Math.abs(delta)) : String(Math.abs(delta))
  return `${delta > 0 ? '+' : '-'}${value}`
}

export default function WorkflowComparePage() {
  const searchParams = useSearchParams()
  const workflowAId = searchParams.get('a')
  const workflowBId = searchParams.get('b')

  const { data: workflowOptions } = useQuery({
    queryKey: ['reports', 'workflows', 'compare-options'],
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: () => serverQuery('reports.workflowOptions'),
  })

  const workflowAOption = (workflowOptions ?? []).find((workflow: any) => workflow.id === workflowAId) ?? null
  const workflowBOption = (workflowOptions ?? []).find((workflow: any) => workflow.id === workflowBId) ?? null
  const suggestedComparisons = (workflowOptions ?? [])
    .filter((workflow: any) => workflow.id !== workflowAId)
    .slice(0, 8)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'workflows', 'compare', workflowAId, workflowBId],
    enabled: !!workflowAId && !!workflowBId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const since = new Date()
      since.setDate(since.getDate() - 180)
      // Run rows without traces plus SQL per-node visit counts (same newest
      // 5000 runs), split per workflow server-side — traces never reach the browser.
      return serverQuery('reports.workflowCompare', { a: workflowAId as string, b: workflowBId as string, since: since.toISOString() })
    },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/reports/workflows" className="p-1.5 rounded-lg hover:bg-[var(--theme-surface)] transition-colors" style={{ color: 'var(--theme-muted-text)' }}>
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <GitCompare size={18} style={{ color: 'var(--theme-primary-text)' }} />
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Compare Workflows</h1>
          </div>
          <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>
            Side-by-side definition and operational comparison for two workflows.
          </p>
        </div>
      </div>

      <Card className="!p-4">
        <form action="/reports/workflows/compare" className="grid gap-3 md:grid-cols-[1fr_1fr_auto] items-end">
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Workflow A</label>
            <select
              name="a"
              defaultValue={workflowAId ?? ''}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            >
              <option value="">Select workflow…</option>
              {(workflowOptions ?? []).map((workflow: any) => (
                <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--theme-muted-text)' }}>Workflow B</label>
            <select
              name="b"
              defaultValue={workflowBId ?? ''}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
            >
              <option value="">Select workflow…</option>
              {(workflowOptions ?? []).map((workflow: any) => (
                <option key={workflow.id} value={workflow.id}>{workflow.name}</option>
              ))}
            </select>
          </div>
          <Button type="submit" size="sm">Compare</Button>
        </form>
      </Card>

      {(!workflowAId || !workflowBId) && (
        <Card className="!p-6">
          <p className="text-sm" style={{ color: 'var(--theme-card-text)' }}>
            {workflowAOption
              ? `Choose a second workflow to compare against ${workflowAOption.name}.`
              : 'Choose two workflows above to open a side-by-side comparison.'}
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            This compares operational metrics like runs, duration, visits, and traversals, along with definition shape like trigger, nodes, sections, and edges.
          </p>
          {workflowAOption && suggestedComparisons.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>Quick compare suggestions</div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {suggestedComparisons.map((workflow: any) => (
                  <Link key={workflow.id} href={`/reports/workflows/compare?a=${workflowAOption.id}&b=${workflow.id}`}>
                    <div className="rounded-lg border px-3 py-3 transition-colors hover:bg-[var(--theme-surface)]" style={{ borderColor: 'var(--theme-surface-border)' }}>
                      <div className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{workflow.name}</div>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                        Compare against {workflowAOption.name}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {workflowAId && workflowBId && workflowAId === workflowBId && (
        <Card className="!p-4">
          <p className="text-sm" style={{ color: 'var(--theme-card-text)' }}>Pick two different workflows to compare.</p>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Comparing the same workflow on both sides won’t surface any meaningful differences.
          </p>
        </Card>
      )}

      {workflowAId && workflowBId && workflowAId !== workflowBId && isLoading && (
        <Card className="!p-6">
          <p className="text-sm" style={{ color: 'var(--theme-card-text)' }}>Loading workflow comparison…</p>
        </Card>
      )}

      {workflowAId && workflowBId && workflowAId !== workflowBId && data?.workflowA && data?.workflowB && (() => {
      const summaryA = buildWorkflowSummary(data.workflowA, data.runsA, data.queueA, data.visitsA)
      const summaryB = buildWorkflowSummary(data.workflowB, data.runsB, data.queueB, data.visitsB)
      const comparisonRows = [
        {
          label: 'Total runs',
          description: 'Operational volume in the recent comparison window.',
          a: summaryA.totalRuns,
          b: summaryB.totalRuns,
          delta: deltaLabel(summaryA.totalRuns, summaryB.totalRuns),
          winner: compareValueKind(summaryA.totalRuns, summaryB.totalRuns),
        },
        {
          label: 'Active runs',
          description: 'Running, queued, paused, or waiting work right now.',
          a: summaryA.activeRuns,
          b: summaryB.activeRuns,
          delta: deltaLabel(summaryA.activeRuns, summaryB.activeRuns),
          winner: compareValueKind(summaryA.activeRuns, summaryB.activeRuns),
        },
        {
          label: 'Errors',
          description: 'Failed instances in the comparison window.',
          a: summaryA.errors,
          b: summaryB.errors,
          delta: deltaLabel(summaryA.errors, summaryB.errors),
          winner: compareValueKind(summaryA.errors, summaryB.errors),
        },
        {
          label: 'Avg duration',
          description: 'Average completion time for finished runs.',
          a: summaryA.avgDurationMs,
          b: summaryB.avgDurationMs,
          delta: deltaLabel(summaryA.avgDurationMs, summaryB.avgDurationMs, formatDuration),
          winner: compareValueKind(summaryA.avgDurationMs, summaryB.avgDurationMs),
          format: formatDuration,
        },
        {
          label: 'Avg node visits',
          description: 'Average workflow path depth per run.',
          a: summaryA.avgNodeVisits,
          b: summaryB.avgNodeVisits,
          delta: deltaLabel(summaryA.avgNodeVisits, summaryB.avgNodeVisits, (value) => value.toFixed(1)),
          winner: compareValueKind(summaryA.avgNodeVisits, summaryB.avgNodeVisits),
          format: (value: number) => value.toFixed(1),
        },
        {
          label: 'Avg edge traversals',
          description: 'Average connection traversals per run.',
          a: summaryA.avgEdgeTraversals,
          b: summaryB.avgEdgeTraversals,
          delta: deltaLabel(summaryA.avgEdgeTraversals, summaryB.avgEdgeTraversals, (value) => value.toFixed(1)),
          winner: compareValueKind(summaryA.avgEdgeTraversals, summaryB.avgEdgeTraversals),
          format: (value: number) => value.toFixed(1),
        },
      ]
      const definitionRows = [
        {
          label: 'Trigger type',
          description: 'How each workflow starts.',
          a: String(summaryA.triggerType).replace(/_/g, ' '),
          b: String(summaryB.triggerType).replace(/_/g, ' '),
        },
        {
          label: 'Status',
          description: 'Whether the workflow is currently active.',
          a: summaryA.isActive ? 'Active' : 'Inactive',
          b: summaryB.isActive ? 'Active' : 'Inactive',
        },
        {
          label: 'Variables',
          description: 'Workflow-scoped variables declared on the definition.',
          a: summaryA.variableCount,
          b: summaryB.variableCount,
        },
        {
          label: 'Nodes',
          description: 'Non-section nodes in the graph.',
          a: summaryA.nodeCount,
          b: summaryB.nodeCount,
        },
        {
          label: 'Sections',
          description: 'Workflow sections/swimlanes in the definition.',
          a: summaryA.sectionCount,
          b: summaryB.sectionCount,
        },
        {
          label: 'Edges',
          description: 'Connections between nodes.',
          a: summaryA.edgeCount,
          b: summaryB.edgeCount,
        },
      ]
      return (
          <>
            <Card className="!p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>Comparison Snapshot</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
                    Compare operational behavior and definition shape side-by-side, then jump into either workflow report for deeper investigation.
                  </p>
                </div>
                <Link href={`/reports/workflows/compare?a=${data.workflowB.id}&b=${data.workflowA.id}`}>
                  <Button size="sm" variant="outline">
                    <Shuffle size={13} className="mr-1" />
                    Swap sides
                  </Button>
                </Link>
              </div>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              {[{ workflow: data.workflowA, summary: summaryA }, { workflow: data.workflowB, summary: summaryB }].map(({ workflow, summary }) => (
                <Card key={workflow.id} className="!p-4 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <WorkflowIcon size={16} style={{ color: 'var(--theme-primary-text)' }} />
                        <h2 className="text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>{workflow.name}</h2>
                      </div>
                      {workflow.description && (
                        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>{workflow.description}</p>
                      )}
                    </div>
                    <Link href={`/reports/workflows/${workflow.id}`} className="text-[10px] font-medium hover:underline" style={{ color: 'var(--theme-primary-text)' }}>
                      Open report
                    </Link>
                  </div>

                  <ReportMetricRow
                    metrics={[
                      { label: 'Total Runs', value: summary.totalRuns },
                      { label: 'Active', value: summary.activeRuns },
                      { label: 'Errors', value: summary.errors },
                      { label: 'Avg Duration', value: formatDuration(summary.avgDurationMs) },
                      { label: 'Avg Node Visits', value: summary.avgNodeVisits },
                      { label: 'Avg Traversals', value: summary.avgEdgeTraversals },
                    ]}
                  />

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <DefinitionStat label="Trigger" value={String(summary.triggerType).replace(/_/g, ' ')} />
                    <DefinitionStat label="Status" value={summary.isActive ? 'Active' : 'Inactive'} />
                    <DefinitionStat label="Variables" value={summary.variableCount} />
                    <DefinitionStat label="Nodes" value={summary.nodeCount} />
                    <DefinitionStat label="Sections" value={summary.sectionCount} />
                    <DefinitionStat label="Edges" value={summary.edgeCount} />
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--theme-card-text)' }}>Hot Path Snapshot</h3>
                    <div className="space-y-2">
                      {summary.hotNodes.length === 0 ? (
                        <p className="text-xs" style={{ color: 'var(--theme-muted-text)' }}>No node traffic yet.</p>
                      ) : (
                        summary.hotNodes.map((node) => (
                          <div key={node.id} className="flex items-center justify-between rounded-lg border px-3 py-2" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                            <div>
                              <div className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{node.label}</div>
                              <div className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{node.type}</div>
                            </div>
                            <span className="rounded-full px-2 py-1 text-[10px]" style={{ backgroundColor: 'rgba(59,130,246,0.10)', color: '#1D4ED8' }}>
                              {node.visits} visits
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card className="!p-4">
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-card-text)' }}>Operational Comparison</h3>
                <div className="space-y-3">
                  {comparisonRows.map((row) => {
                    const format = row.format ?? ((value: number) => String(value))
                    return (
                      <div key={row.label} className="rounded-lg border px-3 py-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{row.label}</div>
                            <div className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{row.description}</div>
                          </div>
                          <span
                            className="rounded-full px-2 py-1 text-[10px] font-medium"
                            style={{
                              backgroundColor: row.winner === 'equal' ? 'rgba(148,163,184,0.14)' : 'rgba(59,130,246,0.10)',
                              color: row.winner === 'equal' ? 'var(--theme-muted-text)' : '#1D4ED8',
                            }}
                          >
                            {row.delta}
                          </span>
                        </div>
                        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                          <ValuePill label={data.workflowA.name} value={format(row.a)} active={row.winner === 'a'} />
                          <div className="text-[10px] uppercase tracking-wide text-center" style={{ color: 'var(--theme-muted-text)' }}>vs</div>
                          <ValuePill label={data.workflowB.name} value={format(row.b)} active={row.winner === 'b'} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>

              <Card className="!p-4">
                <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--theme-card-text)' }}>Definition Comparison</h3>
                <div className="space-y-3">
                  {definitionRows.map((row) => (
                    <div key={row.label} className="rounded-lg border px-3 py-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
                      <div className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{row.label}</div>
                      <div className="text-[11px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>{row.description}</div>
                      <div className="mt-3 grid gap-2 md:grid-cols-2">
                        <ValuePill label={data.workflowA.name} value={String(row.a)} active={row.a !== row.b} />
                        <ValuePill label={data.workflowB.name} value={String(row.b)} active={row.a !== row.b} />
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )
      })()}
    </div>
  )
}

function DefinitionStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border px-3 py-3" style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-surface)' }}>
      <div className="text-[11px] font-medium" style={{ color: 'var(--theme-muted-text)' }}>{label}</div>
      <div className="mt-1 text-lg font-semibold" style={{ color: 'var(--theme-card-text)' }}>{value}</div>
    </div>
  )
}

function ValuePill({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{
        borderColor: active ? 'rgba(59,130,246,0.30)' : 'var(--theme-surface-border)',
        backgroundColor: active ? 'rgba(59,130,246,0.06)' : 'var(--theme-card-bg)',
      }}
    >
      <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--theme-muted-text)' }}>{label}</div>
      <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{value}</div>
    </div>
  )
}
