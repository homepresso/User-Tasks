'use client'

import { use, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill, type Tone } from '@/components/ui/badge'
import { formatDurationMs, formatDurationSeconds } from '@/lib/format/duration'
import { plural } from '@/lib/format/plural'
import { cn } from '@/lib/utils'
import { GitBranch, Bot, Network, Clock, AlertCircle } from 'lucide-react'

/**
 * Unified trace viewer. Takes a trace_id and stitches together every
 * entity that shared it:
 *   - workflow_runs (top of the chain)
 *   - agent_runs (spawned by workflow nodes)
 *   - integration_call_logs (made by nodes or agents)
 *
 * Renders as a chronologically ordered flame-graph-style timeline with
 * duration bars so operators can see the full call graph at a glance.
 */

interface TraceNode {
  id: string
  type: 'workflow_run' | 'agent_run' | 'integration_call'
  title: string
  subtitle?: string
  status?: string
  startedAt: number
  endedAt?: number
  durationMs?: number
  href: string
  error?: string
}

export default function TraceViewerPage({ params }: { params: Promise<{ traceId: string }> }) {
  const { traceId } = use(params)

  const { data, isLoading } = useQuery({
    queryKey: ['trace', traceId],
    queryFn: async () => {
      // Every entity sharing this trace_id, fetched in parallel server-side
      const { data: trace } = await serverRead('activity.trace', { traceId })

      const nodes: TraceNode[] = []

      for (const run of (trace?.workflowRuns ?? [])) {
        const started = new Date(run.started_at).getTime()
        const ended = run.completed_at ? new Date(run.completed_at).getTime() : undefined
        nodes.push({
          id: `wf-${run.id}`,
          type: 'workflow_run',
          title: run.workflow?.name ?? 'Workflow',
          subtitle: `Run ${String(run.id).slice(0, 8)}`,
          status: run.status,
          startedAt: started,
          endedAt: ended,
          durationMs: ended ? ended - started : undefined,
          href: `/automations/runs/${run.id}`,
          error: run.error,
        })
      }

      for (const run of (trace?.agentRuns ?? [])) {
        const started = new Date(run.started_at).getTime()
        const ended = run.completed_at ? new Date(run.completed_at).getTime() : undefined
        nodes.push({
          id: `ag-${run.id}`,
          type: 'agent_run',
          title: run.agent?.name ?? 'Agent',
          subtitle: `${run.total_tokens ?? 0} tokens`,
          status: run.status,
          startedAt: started,
          endedAt: ended,
          durationMs: run.duration_ms ?? undefined,
          href: `/agents/${run.agent_id}/runs/${run.id}`,
          error: run.error,
        })
      }

      for (const call of (trace?.integrationCalls ?? [])) {
        const started = new Date(call.started_at).getTime()
        const ended = call.completed_at ? new Date(call.completed_at).getTime() : undefined
        nodes.push({
          id: `ic-${call.id}`,
          type: 'integration_call',
          title: `${call.method} ${call.integration?.name ?? 'Integration'}`,
          subtitle: call.url?.slice(0, 80),
          status: call.response_status ? String(call.response_status) : 'error',
          startedAt: started,
          endedAt: ended,
          durationMs: call.duration_ms ?? undefined,
          href: `/integrations/${call.integration_id}/calls/${call.id}`,
          error: call.error,
        })
      }

      // Sort chronologically
      nodes.sort((a, b) => a.startedAt - b.startedAt)

      return nodes
    },
  })

  const { minTime, totalSpan } = useMemo(() => {
    if (!data || data.length === 0) return { minTime: 0, maxTime: 0, totalSpan: 1 }
    const min = Math.min(...data.map(n => n.startedAt))
    const max = Math.max(...data.map(n => n.endedAt ?? n.startedAt))
    return { minTime: min, maxTime: max, totalSpan: Math.max(1, max - min) }
  }, [data])

  if (isLoading && !data) {
    return <PageSkeleton variant="detail" />
  }

  return (
    <div className="space-y-4 page-transition">
      <PageHeader
        className="mb-2"
        breadcrumbs={[{ label: 'Activity', href: '/activity' }, { label: 'Trace' }]}
        title="Trace"
        description={(
          <>
            <span className="font-mono text-xs">{traceId}</span>
            {data && data.length > 0 && (
              <span className="num block text-xs">{plural(data.length, 'event')} · {formatDurationMs(totalSpan)} total</span>
            )}
          </>
        )}
      />

      {/* Trace timeline */}
      {!data || data.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel">
          <EmptyState icon={Clock} title="No events found for this trace ID"
            description="Trace IDs are assigned to runs and calls when Phase 1 instrumentation is active." />
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-panel">
          {data.map((node) => {
            const offsetPct = ((node.startedAt - minTime) / totalSpan) * 100
            const widthPct = node.durationMs ? Math.max(0.5, (node.durationMs / totalSpan) * 100) : 0.5
            return (
              <li key={node.id} className="border-b border-border-subtle last:border-b-0">
                <Link href={node.href} className="block px-4 py-3 transition-colors duration-[var(--ds-dur-fast)] hover:bg-subtle">
                  {/* Header row */}
                  <div className="mb-1.5 flex items-center gap-2">
                    <NodeIcon type={node.type} />
                    <span className="truncate text-ui font-medium text-fg">{node.title}</span>
                    {node.subtitle && <span className="truncate font-mono text-xs text-fg-muted">{node.subtitle}</span>}
                    <div className="num ml-auto flex shrink-0 items-center gap-2 text-xs text-fg-muted">
                      {node.status && <StatusPill status={node.status} tone={statusToneFor(node.status, !!node.error)} />}
                      <span>+{formatDurationSeconds((node.startedAt - minTime) / 1000)}</span>
                      {node.durationMs != null && <span>{formatDurationMs(node.durationMs)}</span>}
                    </div>
                  </div>
                  {/* Error */}
                  {node.error && (
                    <div className="mb-1.5 flex items-start gap-1 font-mono text-xs text-danger">
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                      <span className="truncate">{node.error}</span>
                    </div>
                  )}
                  {/* Duration bar (flame graph style) */}
                  <div className="relative h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('absolute h-full rounded-full', node.error ? 'bg-danger' : BAR_CLASS[node.type])}
                      style={{ left: `${offsetPct}%`, width: `${widthPct}%` }}
                    />
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

const BAR_CLASS: Record<TraceNode['type'], string> = {
  workflow_run: 'bg-primary',
  agent_run: 'bg-info',
  integration_call: 'bg-fg-subtle',
}

const ICON_CLASS: Record<TraceNode['type'], string> = {
  workflow_run: 'text-primary-text',
  agent_run: 'text-info',
  integration_call: 'text-fg-muted',
}

function NodeIcon({ type }: { type: TraceNode['type'] }) {
  const Icon = type === 'workflow_run' ? GitBranch
    : type === 'agent_run' ? Bot
    : Network
  return <Icon className={cn('size-4 shrink-0', ICON_CLASS[type])} aria-hidden />
}

/** HTTP codes and run statuses → a pill tone (4xx/5xx and errors danger, 2xx/3xx and completed success). */
function statusToneFor(status: string, hasError: boolean): Tone {
  const code = /^\d+$/.test(status) ? parseInt(status, 10) : null
  if (hasError || status === 'failed' || (code !== null && code >= 400)) return 'danger'
  if (status === 'completed' || status === 'submitted' || (code !== null && code >= 200 && code < 400)) return 'success'
  return 'neutral'
}

