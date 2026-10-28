'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverQuery, serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ChevronLeft, Bot, MessageSquare, Wrench, GitBranch, Clock, Check, X, User, AlertCircle } from 'lucide-react'
import { RunStatusBadge } from '@/components/ui/status-badge'

type Tab = 'conversation' | 'tools' | 'related'

export default function AgentRunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id: agentId, runId } = use(params)
  const [tab, setTab] = useState<Tab>('conversation')

  const { data, isLoading } = useQuery({
    queryKey: ['agent-run-detail', runId],
    queryFn: () => serverQuery('agents.run', { agentId, runId }),
  })

  if (isLoading && !data) return <PageSkeleton variant="detail" />
  if (!data?.run) {
    return (
      <div className="page-transition">
        <Link href={`/agents/${agentId}/runs`} className="inline-flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back
        </Link>
        <p className="text-sm mt-4" style={{ color: 'var(--theme-muted-text)' }}>Run not found.</p>
      </div>
    )
  }

  const { run, agent } = data
  const toolCalls: any[] = Array.isArray(run.tool_calls) ? run.tool_calls : []

  return (
    <div className="space-y-4 page-transition">
      {/* Header */}
      <div>
        <Link href={`/agents/${agentId}/runs`} className="inline-flex items-center gap-1 text-xs mb-2 hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back to runs
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>
              Run
            </h1>
            <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
              {(agent as any)?.name ?? 'Agent'} · <span className="font-mono text-[11px]">{String(run.id).slice(0, 8)}</span>
            </p>
            <div className="flex items-center gap-3 mt-2 text-[11px]" style={{ color: 'var(--theme-muted-text)' }}>
              <RunStatusBadge status={run.status} />
              <span className="flex items-center gap-1">
                <Clock size={11} />
                {new Date(run.started_at ?? run.created_at).toLocaleString()}
              </span>
              {run.duration_ms != null && <span>{(run.duration_ms / 1000).toFixed(2)}s</span>}
              {run.total_tokens != null && <span>{run.total_tokens.toLocaleString()} tokens</span>}
              {run.model && <span className="font-mono">{run.model}</span>}
              {run.caller_type && <span className="capitalize">via {run.caller_type.replace('_', ' ')}</span>}
            </div>
          </div>
        </div>

        {/* Error banner */}
        {run.error && (
          <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ backgroundColor: 'var(--status-danger-bg)', color: 'var(--theme-danger)' }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Execution failed</div>
              <div className="font-mono mt-1">{run.error}</div>
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex rounded-lg overflow-hidden border w-fit" style={{ borderColor: 'var(--theme-surface-border)' }}>
        <TabButton active={tab === 'conversation'} onClick={() => setTab('conversation')} icon={MessageSquare}>Conversation</TabButton>
        <TabButton active={tab === 'tools'} onClick={() => setTab('tools')} icon={Wrench}>Tool Calls ({toolCalls.length})</TabButton>
        <TabButton active={tab === 'related'} onClick={() => setTab('related')} icon={GitBranch}>Related</TabButton>
      </div>

      {/* Tab content */}
      {tab === 'conversation' && <ConversationTab run={run} />}
      {tab === 'tools' && <ToolCallsTab toolCalls={toolCalls} />}
      {tab === 'related' && <RelatedTab run={run} />}
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

function ConversationTab({ run }: { run: any }) {
  return (
    <div className="space-y-3">
      {/* User message */}
      <Card className="!p-4">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-surface)' }}>
            <User size={12} style={{ color: 'var(--theme-muted-text)' }} />
          </div>
          <span className="text-xs font-semibold" style={{ color: 'var(--theme-muted-text)' }}>USER</span>
        </div>
        <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--theme-card-text)' }}>
          {run.input_message ?? <span style={{ color: 'var(--theme-muted-text)' }}>(no input)</span>}
        </div>
      </Card>

      {/* Agent response */}
      {run.output_response && (
        <Card className="!p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--theme-primary-light)' }}>
              <Bot size={12} style={{ color: 'var(--theme-primary-text)' }} />
            </div>
            <span className="text-xs font-semibold" style={{ color: 'var(--theme-primary-text)' }}>AGENT</span>
            {run.iterations > 0 && (
              <span className="text-[10px] ml-auto" style={{ color: 'var(--theme-muted-text)' }}>
                {run.iterations} iteration{run.iterations === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="text-sm whitespace-pre-wrap" style={{ color: 'var(--theme-card-text)' }}>
            {run.output_response}
          </div>
        </Card>
      )}

      {/* Token usage */}
      {run.total_tokens != null && (
        <Card className="!p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>Usage</p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Input tokens</p>
              <p className="font-mono font-semibold">{(run.input_tokens ?? 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Output tokens</p>
              <p className="font-mono font-semibold">{(run.output_tokens ?? 0).toLocaleString()}</p>
            </div>
            <div>
              <p className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>Total</p>
              <p className="font-mono font-semibold" style={{ color: 'var(--theme-primary-text)' }}>
                {run.total_tokens.toLocaleString()}
              </p>
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}

function ToolCallsTab({ toolCalls }: { toolCalls: any[] }) {
  if (toolCalls.length === 0) {
    return (
      <Card className="!p-6 text-center">
        <Wrench size={24} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)' }} />
        <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>No tool calls in this run</p>
      </Card>
    )
  }
  return (
    <div className="space-y-2">
      {toolCalls.map((tc, i) => (
        <ToolCallCard key={i} toolCall={tc} index={i} />
      ))}
    </div>
  )
}

function ToolCallCard({ toolCall, index }: { toolCall: any; index: number }) {
  const [expanded, setExpanded] = useState(false)
  const name = toolCall.name ?? toolCall.toolName ?? toolCall.tool ?? `Tool ${index + 1}`
  const error = toolCall.error
  return (
    <Card className={`!p-4 cursor-pointer transition-all ${expanded ? '' : 'hover:scale-[1.005]'}`}
      onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center gap-2">
        <Wrench size={14} style={{ color: error ? 'var(--theme-danger)' : 'var(--theme-primary-text)' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--theme-card-text)' }}>{name}</span>
        {toolCall.durationMs != null && (
          <span className="text-[10px] ml-auto" style={{ color: 'var(--theme-muted-text)' }}>
            {toolCall.durationMs}ms
          </span>
        )}
        {error ? (
          <X size={12} style={{ color: 'var(--theme-danger)' }} />
        ) : (
          <Check size={12} style={{ color: 'var(--theme-success)' }} />
        )}
      </div>
      {expanded && (
        <div className="mt-3 space-y-2" onClick={(e) => e.stopPropagation()}>
          {toolCall.input != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: 'var(--theme-muted-text)' }}>Input</p>
              <pre className="text-[10px] font-mono p-2 rounded overflow-auto max-h-48"
                style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}>
                {typeof toolCall.input === 'string' ? toolCall.input : JSON.stringify(toolCall.input, null, 2)}
              </pre>
            </div>
          )}
          {toolCall.output != null && (
            <div>
              <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: 'var(--theme-muted-text)' }}>Output</p>
              <pre className="text-[10px] font-mono p-2 rounded overflow-auto max-h-48"
                style={{ backgroundColor: 'var(--theme-surface)', color: 'var(--theme-card-text)' }}>
                {typeof toolCall.output === 'string' ? toolCall.output : JSON.stringify(toolCall.output, null, 2)}
              </pre>
            </div>
          )}
          {error && (
            <div>
              <p className="text-[10px] font-semibold uppercase mb-1" style={{ color: 'var(--theme-danger)' }}>Error</p>
              <pre className="text-[10px] font-mono p-2 rounded overflow-auto"
                style={{ backgroundColor: 'var(--status-danger-bg)', color: 'var(--theme-danger)' }}>
                {String(error)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function RelatedTab({ run }: { run: any }) {
  // Find the parent workflow run if this was called from one
  const { data: parentRun } = useQuery({
    queryKey: ['agent-parent-workflow', run.caller_id],
    queryFn: async () => {
      if (run.caller_type !== 'workflow_node' || !run.caller_id) return null
      return (await serverRead('agents.parentWorkflowRun', { runId: run.caller_id })).data
    },
    enabled: run.caller_type === 'workflow_node' && !!run.caller_id,
  })

  // Find integration calls made during this run (by trace_id)
  const { data: integrationCalls } = useQuery({
    queryKey: ['agent-run-integration-calls', run.trace_id],
    queryFn: async () => {
      if (!run.trace_id) return []
      return (await serverRead('agents.runIntegrationCalls', { traceId: run.trace_id })).data ?? []
    },
    enabled: !!run.trace_id,
  })

  return (
    <div className="space-y-3">
      {parentRun && (
        <Card className="!p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Triggered By
          </h3>
          <Link
            href={`/automations/runs/${parentRun.id}`}
            className="flex items-center gap-2 text-sm hover:underline"
            style={{ color: 'var(--theme-primary-text)' }}
          >
            <GitBranch size={14} />
            {parentRun.workflow?.name ?? 'Workflow run'}
            <span className="text-[10px] ml-auto capitalize" style={{ color: 'var(--theme-muted-text)' }}>
              {parentRun.status}
            </span>
          </Link>
        </Card>
      )}

      {(integrationCalls?.length ?? 0) > 0 && (
        <Card className="!p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--theme-muted-text)' }}>
            Integration Calls
          </h3>
          <div className="space-y-1">
            {(integrationCalls ?? []).map((call: any) => (
              <Link
                key={call.id}
                href={`/integrations/${call.integration_id}/calls/${call.id}`}
                className="flex items-center gap-2 text-xs p-2 rounded-lg transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{ color: 'var(--theme-card-text)' }}
              >
                <span className="font-mono font-semibold w-12 text-[10px]">{call.method}</span>
                <span className="flex-1 truncate font-mono text-[10px]">{call.url ?? '—'}</span>
                <span className={`text-[10px] font-semibold ${
                  call.response_status && call.response_status >= 400 ? '' : ''
                }`} style={{ color: call.response_status && call.response_status >= 400 ? 'var(--theme-danger)' : 'var(--theme-muted-text)' }}>
                  {call.response_status ?? 'err'}
                </span>
                <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
                  {call.duration_ms}ms
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {!parentRun && (integrationCalls?.length ?? 0) === 0 && (
        <Card className="!p-6 text-center">
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>No related records</p>
        </Card>
      )}
    </div>
  )
}
