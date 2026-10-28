"use client"

import { use } from 'react'
import { serverQuery } from '@/lib/server-read'
import { useQuery } from '@tanstack/react-query'
import { ProcessOverviewView } from '@/components/reports/lazy-charts'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import type { AggregateFlowStats } from '@/lib/report-flow-stats'

/**
 * Level 2 of the workflow reports drill-down — the "Process Overview".
 *
 * Shows KPI tiles for a single workflow (total instances, active, errors,
 * active tasks, escalations, last-activity), an "Instances Started" trend
 * chart with a period picker, and a searchable/sortable table of every
 * run (instance) with id, originator, status, started, finished, duration,
 * and a link to the Process Instance Detail view.
 *
 * Drill path: /reports/workflows → /reports/workflows/[id] → per-run detail.
 */
export default function WorkflowProcessOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'workflows', 'overview', id],
    // Definition, run rows (no traces), live queue, originators and agent
    // runs — one server read.
    queryFn: () => serverQuery('reports.workflowOverview', { id }),
  })

  // Per-node/edge heat map needs execution traces — aggregated on the server
  // so they never reach the browser.
  const { data: flowStats } = useQuery({
    queryKey: ['reports', 'workflows', 'flow-stats', id],
    queryFn: async () => {
      const res = await fetch(`/api/reports/workflows/${encodeURIComponent(id)}/flow-stats`)
      if (!res.ok) throw new Error(`flow stats: ${res.status}`)
      return (await res.json()) as AggregateFlowStats
    },
  })

  if (isLoading) return <PageSkeleton variant="list" />
  if (!data?.workflow) {
    return (
      <div className="text-center py-16 text-sm" style={{ color: 'var(--theme-muted-text)' }}>
        Workflow not found.
      </div>
    )
  }

  return (
    <ProcessOverviewView
      workflow={data.workflow}
      runs={data.runs}
      flowStats={flowStats ?? null}
      queueStats={data.queueStats}
      taskById={data.taskById}
      agentRunsByRunId={data.agentRunsByRunId}
      agentNameById={data.agentNameById}
    />
  )
}
