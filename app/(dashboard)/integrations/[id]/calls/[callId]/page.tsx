'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ChevronLeft, Send, Download, Clock, AlertCircle, GitBranch, Bot, FileText } from 'lucide-react'

type Tab = 'request' | 'response' | 'related'

export default function IntegrationCallDetailPage({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const { id: integrationId, callId } = use(params)
  const [tab, setTab] = useState<Tab>('request')

  const { data, isLoading } = useQuery({
    queryKey: ['integration-call-detail', callId],
    queryFn: async () => (await serverRead('integrations.call', { integrationId, callId })).data ?? { call: null, integration: null, reference: null },
  })

  if (isLoading && !data) return <PageSkeleton variant="detail" />
  if (!data?.call) {
    return (
      <div className="page-transition">
        <Link href={`/integrations/${integrationId}/calls`} className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back
        </Link>
        <p className="text-sm mt-4" style={{ color: 'var(--theme-muted-text)' }}>Call not found.</p>
      </div>
    )
  }

  const { call, integration, reference } = data
  const isError = !call.response_status || call.response_status >= 400 || call.error

  return (
    <div className="space-y-4 page-transition">
      {/* Header */}
      <div>
        <Link href={`/integrations/${integrationId}/calls`} className="inline-flex items-center gap-1 text-xs mb-2 hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back to calls
        </Link>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>
              {call.method ?? '—'}
            </h1>
            <StatusBadge status={call.response_status} error={!!call.error} />
          </div>
          <p className="text-sm font-mono mt-1 break-all" style={{ color: 'var(--theme-muted-text)' }}>
            {call.url ?? '—'}
          </p>
          <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
            <span className="flex items-center gap-1">
              <Clock size={11} />
              {new Date(call.started_at).toLocaleString()}
            </span>
            {call.duration_ms != null && <span>{call.duration_ms}ms</span>}
            {(integration as any)?.name && <span>{(integration as any).name}</span>}
            {reference && <span>· {reference.name}</span>}
            {call.caller_type && <span>· via {call.caller_type.replace('_', ' ')}</span>}
          </div>
        </div>

        {/* Error banner */}
        {call.error && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ backgroundColor: 'var(--status-danger-bg)', color: 'var(--theme-danger)' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Call failed</div>
              <div className="font-mono mt-1">{call.error}</div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <TabButton active={tab === 'request'} onClick={() => setTab('request')} icon={Send}>Request</TabButton>
        <TabButton active={tab === 'response'} onClick={() => setTab('response')} icon={Download}>Response</TabButton>
        <TabButton active={tab === 'related'} onClick={() => setTab('related')} icon={GitBranch}>Related</TabButton>
      </div>

      {/* Tab content */}
      {tab === 'request' && <RequestTab call={call} />}
      {tab === 'response' && <ResponseTab call={call} />}
      {tab === 'related' && <RelatedTab call={call} />}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, children }: any) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-xs font-medium flex items-center gap-1.5 transition-colors"
      style={{
        backgroundColor: active ? 'var(--theme-primary)' : 'transparent',
        color: active ? 'var(--theme-on-primary)' : 'var(--theme-muted-text)',
      }}
    >
      <Icon size={13} /> {children}
    </button>
  )
}

function StatusBadge({ status, error }: { status: number | null; error: boolean }) {
  if (!status && error) {
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ backgroundColor: 'var(--status-danger-bg)', color: 'var(--theme-danger)' }}>FAILED</span>
  }
  if (!status) return null
  const isSuccess = status >= 200 && status < 400
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold font-mono"
      style={{
        backgroundColor: isSuccess ? 'var(--status-success-bg)' : 'var(--status-danger-bg)',
        color: isSuccess ? 'var(--theme-success)' : 'var(--theme-danger)',
      }}>
      {status}
    </span>
  )
}

function JsonBlock({ value }: { value: any }) {
  if (value == null) {
    return <p className="text-xs italic" style={{ color: 'var(--theme-muted-text)' }}>(empty)</p>
  }
  const pretty = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return (
    <pre className="text-[11px] font-mono p-3 rounded-lg overflow-auto max-h-96"
      style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}>
      {pretty}
    </pre>
  )
}

function RequestTab({ call }: { call: any }) {
  return (
    <div className="space-y-3">
      <Card className="!p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Headers</h3>
        <JsonBlock value={call.request_headers} />
      </Card>
      <Card className="!p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Body</h3>
        <JsonBlock value={call.request_body} />
      </Card>
    </div>
  )
}

function ResponseTab({ call }: { call: any }) {
  return (
    <div className="space-y-3">
      <Card className="!p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Status</h3>
        <p className="text-sm font-mono" style={{ color: 'var(--theme-card-text)' }}>
          {call.response_status ?? 'No response (failed before completion)'}
        </p>
      </Card>
      <Card className="!p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Headers</h3>
        <JsonBlock value={call.response_headers} />
      </Card>
      <Card className="!p-4">
        <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Body</h3>
        <JsonBlock value={call.response_body} />
      </Card>
    </div>
  )
}

function RelatedTab({ call }: { call: any }) {
  // Find the workflow run that triggered this call
  const { data: workflowRun } = useQuery({
    queryKey: ['call-related-workflow-run', call.caller_id],
    queryFn: async () => {
      if (call.caller_type !== 'workflow_node' || !call.caller_id) return null
      return (await serverRead('integrations.callWorkflowRun', { runId: call.caller_id })).data
    },
    enabled: call.caller_type === 'workflow_node' && !!call.caller_id,
  })

  // Find sibling calls from the same trace
  const { data: siblingCalls } = useQuery({
    queryKey: ['call-trace-siblings', call.trace_id],
    queryFn: async () => {
      if (!call.trace_id) return []
      return (await serverRead('integrations.callTraceSiblings', { traceId: call.trace_id, callId: call.id })).data ?? []
    },
    enabled: !!call.trace_id,
  })

  // Find agent runs in the same trace
  const { data: agentRuns } = useQuery({
    queryKey: ['call-trace-agents', call.trace_id],
    queryFn: async () => {
      if (!call.trace_id) return []
      return (await serverRead('integrations.callTraceAgentRuns', { traceId: call.trace_id })).data ?? []
    },
    enabled: !!call.trace_id,
  })

  return (
    <div className="space-y-3">
      {workflowRun && (
        <Card className="!p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Triggered By</h3>
          <Link href={`/automations/runs/${workflowRun.id}`}
            className="flex items-center gap-2 text-sm hover:underline"
            style={{ color: 'var(--theme-primary-text)' }}>
            <GitBranch size={14} />
            {workflowRun.workflow?.name ?? 'Workflow run'}
            <span className="text-[10px] ml-auto capitalize" style={{ color: 'var(--theme-muted-text)' }}>
              {workflowRun.status}
            </span>
          </Link>
          {call.caller_node_id && (
            <p className="text-[10px] mt-1 font-mono" style={{ color: 'var(--theme-muted-text)' }}>
              node: {call.caller_node_id}
            </p>
          )}
        </Card>
      )}

      {(agentRuns?.length ?? 0) > 0 && (
        <Card className="!p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Agent Runs in Trace</h3>
          <div className="space-y-1">
            {(agentRuns ?? []).map((run: any) => (
              <Link key={run.id} href={`/agents/${run.agent_id}/runs/${run.id}`}
                className="flex items-center gap-2 text-xs p-2 rounded-lg transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{ color: 'var(--theme-card-text)' }}>
                <Bot size={12} style={{ color: 'var(--theme-primary-text)' }} />
                <span>{run.agent?.name ?? 'Agent'}</span>
                <span className="text-[10px] ml-auto capitalize" style={{ color: 'var(--theme-muted-text)' }}>{run.status}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {(siblingCalls?.length ?? 0) > 0 && (
        <Card className="!p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Other Calls in Trace</h3>
          <div className="space-y-1">
            {(siblingCalls ?? []).map((sibling: any) => (
              <Link key={sibling.id} href={`/integrations/${sibling.integration_id}/calls/${sibling.id}`}
                className="flex items-center gap-2 text-xs p-2 rounded-lg transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{ color: 'var(--theme-card-text)' }}>
                <span className="font-mono font-semibold w-12 text-[10px]">{sibling.method}</span>
                <span className="flex-1 truncate font-mono text-[10px]">{sibling.url}</span>
                <span className="text-[10px] font-semibold"
                  style={{ color: sibling.response_status && sibling.response_status >= 400 ? 'var(--theme-danger)' : 'var(--theme-muted-text)' }}>
                  {sibling.response_status ?? 'err'}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {!workflowRun && (siblingCalls?.length ?? 0) === 0 && (agentRuns?.length ?? 0) === 0 && (
        <Card className="!p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>No related records</p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
            Related records require a trace ID to be propagated through the call chain.
          </p>
        </Card>
      )}
    </div>
  )
}
