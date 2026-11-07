"use client"

import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Shuffle, Workflow as WorkflowIcon } from 'lucide-react'
import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { ReportMetricRow } from '@/components/reports/report-metric-row'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Field } from '@/components/ui/field'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'
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
      <PageHeader
        breadcrumbs={[{ label: 'Reports', href: '/reports' }, { label: 'Workflows', href: '/reports/workflows' }, { label: 'Compare' }]}
        title="Compare workflows"
        description="Side-by-side runs, duration, node visits, edge traversals and definition shape for two workflows."
        className="mb-0"
      />

      <Card padding="md">
        <form action="/reports/workflows/compare" className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Workflow A">
            <Select name="a" defaultValue={workflowAId ?? ''} placeholder="Select workflow…"
              options={(workflowOptions ?? []).map((workflow: any) => ({ value: workflow.id, label: workflow.name }))} />
          </Field>
          <Field label="Workflow B">
            <Select name="b" defaultValue={workflowBId ?? ''} placeholder="Select workflow…"
              options={(workflowOptions ?? []).map((workflow: any) => ({ value: workflow.id, label: workflow.name }))} />
          </Field>
          <Button type="submit">Compare</Button>
        </form>
      </Card>

      {(!workflowAId || !workflowBId) && (
        <Card padding="lg">
          <p className="text-sm text-fg">
            {workflowAOption
              ? `Choose a second workflow to compare against ${workflowAOption.name}.`
              : 'Choose two workflows above to open a side-by-side comparison.'}
          </p>
          <p className="text-xs mt-1 text-fg-muted">
            This compares operational metrics like runs, duration, visits, and traversals, along with definition shape like trigger, nodes, sections, and edges.
          </p>
          {workflowAOption && suggestedComparisons.length > 0 && (
            <div className="mt-4 space-y-2">
              <div className="text-xs font-medium text-fg-muted">Quick compare suggestions</div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {suggestedComparisons.map((workflow: any) => (
                  <Link key={workflow.id} href={`/reports/workflows/compare?a=${workflowAOption.id}&b=${workflow.id}`}>
                    <div className="rounded-md border border-border px-3 py-2.5 transition-colors hover:border-border-strong hover:bg-subtle">
                      <div className="text-sm font-medium text-fg">{workflow.name}</div>
                      <div className="text-2xs mt-1 text-fg-muted">
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
        <Card padding="md">
          <p className="text-sm text-fg">Pick two different workflows to compare.</p>
          <p className="text-xs mt-1 text-fg-muted">
            Comparing the same workflow on both sides won’t surface any meaningful differences.
          </p>
        </Card>
      )}

      {workflowAId && workflowBId && workflowAId !== workflowBId && isLoading && (
        <Card padding="lg">
          <p className="text-sm text-fg">Loading workflow comparison…</p>
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
            <Card padding="md">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-fg">Comparison snapshot</h3>
                  <p className="text-xs mt-1 text-fg-muted">
                    Compare operational behavior and definition shape side-by-side, then jump into either workflow report for deeper investigation.
                  </p>
                </div>
                <Button asChild size="sm" variant="secondary" leadingIcon={<Shuffle />}>
                  <Link href={`/reports/workflows/compare?a=${data.workflowB.id}&b=${data.workflowA.id}`}>Swap sides</Link>
                </Button>
              </div>
            </Card>

            <div className="grid gap-4 xl:grid-cols-2">
              {[{ workflow: data.workflowA, summary: summaryA }, { workflow: data.workflowB, summary: summaryB }].map(({ workflow, summary }) => (
                <Card key={workflow.id} padding="md" className="space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <WorkflowIcon className="size-4 text-fg-muted" aria-hidden />
                        <h2 className="text-base font-semibold text-fg">{workflow.name}</h2>
                      </div>
                      {workflow.description && (
                        <p className="text-xs mt-1 text-fg-muted">{workflow.description}</p>
                      )}
                    </div>
                    <Link href={`/reports/workflows/${workflow.id}`} className="shrink-0 text-xs font-medium text-primary-text hover:underline">
                      Open report
                    </Link>
                  </div>

                  <ReportMetricRow
                    metrics={[
                      { label: 'Runs', value: summary.totalRuns },
                      { label: 'Active', value: summary.activeRuns },
                      { label: 'Errors', value: summary.errors, tone: summary.errors > 0 ? 'danger' : undefined },
                      { label: 'Avg duration', value: formatDuration(summary.avgDurationMs) },
                      { label: 'Avg node visits', value: summary.avgNodeVisits, subtitle: 'per run' },
                      { label: 'Avg edge traversals', value: summary.avgEdgeTraversals, subtitle: 'per run' },
                    ]}
                  />

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-border-subtle pt-3 md:grid-cols-3">
                    <DefinitionStat label="Trigger" value={String(summary.triggerType).replace(/_/g, ' ')} />
                    <DefinitionStat label="Status" value={summary.isActive ? 'Active' : 'Inactive'} />
                    <DefinitionStat label="Variables" value={summary.variableCount} />
                    <DefinitionStat label="Nodes" value={summary.nodeCount} />
                    <DefinitionStat label="Sections" value={summary.sectionCount} />
                    <DefinitionStat label="Edges" value={summary.edgeCount} />
                  </dl>

                  <div>
                    <h3 className="mb-2 text-sm font-semibold text-fg">Hot path</h3>
                    {summary.hotNodes.length === 0 ? (
                      <p className="text-xs text-fg-muted">No node traffic yet.</p>
                    ) : (
                      <ul className="divide-y divide-border-subtle rounded-md border border-border">
                        {summary.hotNodes.map((node) => (
                          <li key={node.id} className="flex items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0">
                              <div className="truncate text-ui font-medium text-fg">{node.label}</div>
                              <div className="text-xs text-fg-muted">{node.type}</div>
                            </div>
                            <Badge className="num shrink-0">{node.visits} visits</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>
              ))}
            </div>

            <div className="grid gap-4 xl:grid-cols-2">
              <Card padding="md">
                <h3 className="mb-3 text-sm font-semibold text-fg">Operational comparison</h3>
                <div className="divide-y divide-border-subtle">
                  {comparisonRows.map((row) => {
                    const format = row.format ?? ((value: number) => String(value))
                    return (
                      <div key={row.label} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-fg">{row.label}</div>
                            <div className="mt-0.5 text-xs text-fg-muted">{row.description}</div>
                          </div>
                          <Badge tone={row.winner === 'equal' ? 'neutral' : 'info'} className="num shrink-0">{row.delta}</Badge>
                        </div>
                        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
                          <ValuePill label={data.workflowA.name} value={format(row.a)} active={row.winner === 'a'} />
                          <div className="text-center text-xs text-fg-muted">vs</div>
                          <ValuePill label={data.workflowB.name} value={format(row.b)} active={row.winner === 'b'} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </Card>

              <Card padding="md">
                <h3 className="mb-3 text-sm font-semibold text-fg">Definition comparison</h3>
                <div className="divide-y divide-border-subtle">
                  {definitionRows.map((row) => (
                    <div key={row.label} className="py-3 first:pt-0 last:pb-0">
                      <div className="text-sm font-medium text-fg">{row.label}</div>
                      <div className="mt-0.5 text-xs text-fg-muted">{row.description}</div>
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
    <div className="min-w-0">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="num truncate text-ui font-medium capitalize text-fg">{value}</dd>
    </div>
  )
}

function ValuePill({ label, value, active }: { label: string; value: string; active?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-md border px-3 py-2', active ? 'border-border-strong bg-subtle' : 'border-border bg-panel')}>
      <div className="truncate text-xs text-fg-muted">{label}</div>
      <div className="num mt-0.5 text-sm font-semibold text-fg">{value}</div>
    </div>
  )
}
