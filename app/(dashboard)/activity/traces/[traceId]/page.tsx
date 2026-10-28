'use client'

import { use, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ChevronLeft, GitBranch, Bot, Network, Clock, AlertCircle } from 'lucide-react'

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

  const { minTime, maxTime, totalSpan } = useMemo(() => {
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
      {/* Header */}
      <div>
        <Link href="/activity" className="inline-flex items-center gap-1 text-xs mb-2 hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back to activity
        </Link>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Trace</h1>
        <p className="text-xs font-mono mt-1" style={{ color: 'var(--theme-muted-text)' }}>{traceId}</p>
        {data && data.length > 0 && (
          <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            {data.length} event{data.length === 1 ? '' : 's'} · {(totalSpan / 1000).toFixed(2)}s total
          </p>
        )}
      </div>

      {/* Trace timeline */}
      {!data || data.length === 0 ? (
        <Card className="!p-8 text-center">
          <Clock size={28} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)', opacity: 0.5 }} />
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
            No events found for this trace ID.
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Trace IDs are assigned to runs and calls when Phase 1 instrumentation is active.
          </p>
        </Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          {data.map((node, i) => {
            const offsetMs = node.startedAt - minTime
            const offsetPct = (offsetMs / totalSpan) * 100
            const widthPct = node.durationMs ? Math.max(0.5, (node.durationMs / totalSpan) * 100) : 0.5
            return (
              <Link key={node.id} href={node.href} className="block">
                <div className="px-5 py-3 transition-colors hover:bg-[var(--theme-row-highlight)]"
                  style={{ borderTop: i > 0 ? '1px solid var(--theme-surface-border)' : undefined }}
                >
                  {/* Header row */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <NodeIcon type={node.type} />
                    <span className="text-sm font-medium" style={{ color: 'var(--theme-card-text)' }}>{node.title}</span>
                    {node.subtitle && (
                      <span className="text-[10px] font-mono" style={{ color: 'var(--theme-muted-text)' }}>
                        {node.subtitle}
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-2 text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                      {node.status && <StatusChip status={node.status} hasError={!!node.error} />}
                      <span className="font-mono">+{((node.startedAt - minTime) / 1000).toFixed(2)}s</span>
                      {node.durationMs != null && <span className="font-mono">{node.durationMs}ms</span>}
                    </div>
                  </div>
                  {/* Error */}
                  {node.error && (
                    <div className="flex items-start gap-1 mb-1.5 text-[10px] font-mono" style={{ color: 'var(--theme-danger)' }}>
                      <AlertCircle size={10} className="mt-0.5 shrink-0" />
                      <span className="truncate">{node.error}</span>
                    </div>
                  )}
                  {/* Duration bar (flame graph style) */}
                  <div className="relative h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: 'var(--theme-surface)' }}>
                    <div
                      className="absolute h-full rounded-full"
                      style={{
                        left: `${offsetPct}%`,
                        width: `${widthPct}%`,
                        backgroundColor: node.error
                          ? 'var(--theme-danger)'
                          : colorForType(node.type),
                      }}
                    />
                  </div>
                </div>
              </Link>
            )
          })}
        </Card>
      )}
    </div>
  )
}

function NodeIcon({ type }: { type: TraceNode['type'] }) {
  const Icon = type === 'workflow_run' ? GitBranch
    : type === 'agent_run' ? Bot
    : Network
  return <Icon size={14} style={{ color: colorForType(type) }} />
}

function colorForType(type: TraceNode['type']): string {
  return type === 'workflow_run' ? 'var(--theme-primary)'
    : type === 'agent_run' ? 'var(--status-progress)'
    : 'var(--status-todo)'
}

function StatusChip({ status, hasError }: { status: string; hasError: boolean }) {
  const isError = hasError || status === 'failed' || (status.match(/^\d+$/) && parseInt(status) >= 400)
  const isSuccess = status === 'completed' || status === 'submitted' || (status.match(/^\d+$/) && parseInt(status) >= 200 && parseInt(status) < 400)
  return (
    <span className="px-1.5 py-0.5 rounded-full text-[9px] font-mono uppercase"
      style={{
        backgroundColor: isError ? 'var(--status-danger-bg)' : isSuccess ? 'var(--status-success-bg)' : 'var(--theme-row-highlight)',
        color: isError ? 'var(--theme-danger)' : isSuccess ? 'var(--theme-success)' : 'var(--theme-muted-text)',
      }}>
      {status}
    </span>
  )
}
