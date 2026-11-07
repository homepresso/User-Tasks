'use client'

import { use, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverQuery, serverRead } from '@/lib/server-read'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { Tabs, TabPanel } from '@/components/ui/tabs'
import { StatusPill, Tag } from '@/components/ui/badge'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { InlineNotice } from '@/components/ui/inline-notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Tooltip } from '@/components/ui/tooltip'
import { Bot, MessageSquare, Wrench, GitBranch, Clock, Check, X, User, ListTree, ShieldCheck, Cpu, RotateCw, ChevronDown, ChevronRight } from 'lucide-react'
import { formatCost } from '@/lib/agents/pricing'
import { cn } from '@/lib/utils'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { formatDurationMs } from '@/lib/format/duration'
import { formatAbsolute, formatRelative } from '@/lib/format/date'

/** "$0.0123" for a priced run; "cost unknown" when the model had no price (or the run predates cost tracking). */
function runCost(run: any): string {
  return run?.cost_status === 'priced' ? formatCost(Number(run.cost_amount), run.cost_currency) : 'cost unknown'
}

type Tab = 'trace' | 'conversation' | 'tools' | 'related'

export default function AgentRunDetailPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id: agentId, runId } = use(params)
  const [tab, setTab] = useState<Tab>('trace')

  const { data, isLoading } = useQuery({
    queryKey: ['agent-run-detail', runId],
    queryFn: () => serverQuery('agents.run', { agentId, runId }),
  })

  if (isLoading && !data) return <PageSkeleton variant="detail" />
  if (!data?.run) {
    return (
      <div className="page-transition">
        <PageHeader
          breadcrumbs={[{ label: 'Agents', href: '/agents' }, { label: 'Runs', href: `/agents/${agentId}/runs` }, { label: 'Run' }]}
          title="Run"
        />
        <p className="text-sm text-fg-muted" data-testid="agent-run-denied">
          Run not found — or you can&apos;t see it. Agent runs (inputs, outputs and traces) need the agents.view permission, unless the run acted for you or you started it.
        </p>
      </div>
    )
  }

  const { run, agent } = data
  const toolCalls: any[] = Array.isArray(run.tool_calls) ? run.tool_calls : []
  const agentName = (agent as any)?.name ?? 'Agent'
  const started = run.started_at ?? run.created_at

  return (
    <div className="page-transition">
      {/* Header */}
      <PageHeader
        breadcrumbs={[
          { label: 'Agents', href: '/agents' },
          { label: agentName, href: `/agents/${agentId}` },
          { label: 'Runs', href: `/agents/${agentId}/runs` },
          { label: String(run.id).slice(0, 8) },
        ]}
        title={<>Run <span className="font-mono text-fg-muted">{String(run.id).slice(0, 8)}</span></>}
        badge={<StatusPill status={run.status} />}
        description={(
          <span className="num flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <Tooltip content={formatAbsolute(started)}>
              <span className="inline-flex items-center gap-1"><Clock size={14} aria-hidden="true" />{formatRelative(started)}</span>
            </Tooltip>
            {run.duration_ms != null && <span>{formatDurationMs(run.duration_ms)}</span>}
            {run.total_tokens != null && <span>{plural(run.total_tokens, 'token')}</span>}
            <Tooltip content={run.price ? `${run.price.model}: ${run.price.input_per_1m}/${run.price.output_per_1m}${run.price.cached_input_per_1m != null ? ` (cached ${run.price.cached_input_per_1m})` : ''} ${run.price.currency} per 1M tokens · ${run.price.source === 'default' ? `list price as of ${run.price.effective_date}` : `${run.price.source} price from ${run.price.effective_date}`}` : 'No price for this model — add one in Agents → Costs & budgets'}>
              <span data-testid="agent-run-cost">{runCost(run)}</span>
            </Tooltip>
            {run.agent_version != null && <span>agent v{run.agent_version}</span>}
            {run.model && <Tag mono>{run.model}</Tag>}
            {run.caller_type && <span>via {run.caller_type.replace('_', ' ')}</span>}
          </span>
        )}
      />

      <div className="space-y-4">
        {run.pending_approval && (
          <InlineNotice
            tone="info"
            title={`Waiting for approval to run ${run.pending_approval.tool}`}
            message={run.pending_approval.task_id ? <Link href={`/tasks/${run.pending_approval.task_id}`} className="text-primary-text underline">Open the approval task</Link> : undefined}
          />
        )}

        {/* Error banner */}
        {run.error && (
          <InlineNotice tone="danger" title="Execution failed" message={<span className="font-mono text-xs">{run.error}</span>} />
        )}

        {/* Tabs */}
        <Tabs
          aria-label="Run details"
          idBase="agent-run"
          value={tab}
          onValueChange={setTab}
          items={[
            { value: 'trace', label: 'Trace', icon: <ListTree />, count: Array.isArray(run.steps) ? run.steps.length : 0 },
            { value: 'conversation', label: 'Conversation', icon: <MessageSquare /> },
            { value: 'tools', label: 'Tool calls', icon: <Wrench />, count: toolCalls.length },
            { value: 'related', label: 'Related', icon: <GitBranch /> },
          ]}
        />

        {/* Tab content */}
        <TabPanel idBase="agent-run" value={tab}>
          {tab === 'trace' && <TraceTab run={run} />}
          {tab === 'conversation' && <ConversationTab run={run} />}
          {tab === 'tools' && <ToolCallsTab toolCalls={toolCalls} />}
          {tab === 'related' && <RelatedTab run={run} />}
        </TabPanel>
      </div>
    </div>
  )
}

function ConversationTab({ run }: { run: any }) {
  return (
    <div className="space-y-3">
      {/* User message */}
      <Card padding="md">
        <div className="mb-2 flex items-center gap-2">
          <div className="flex size-6 items-center justify-center rounded-full bg-subtle text-fg-muted">
            <User size={14} />
          </div>
          <span className="text-xs font-medium text-fg-muted">User</span>
        </div>
        <div className="whitespace-pre-wrap text-sm text-fg">
          {run.input_message ?? <span className="text-fg-muted">(no input)</span>}
        </div>
      </Card>

      {/* Agent response */}
      {run.output_response && (
        <Card padding="md">
          <div className="mb-2 flex items-center gap-2">
            <div className="flex size-6 items-center justify-center rounded-full bg-primary-wash text-primary-text">
              <Bot size={14} />
            </div>
            <span className="text-xs font-medium text-primary-text">Agent</span>
            {run.iterations > 0 && (
              <span className="num ml-auto text-xs text-fg-muted">
                {plural(run.iterations, 'iteration')}
              </span>
            )}
          </div>
          <div className="whitespace-pre-wrap text-sm text-fg">
            {run.output_response}
          </div>
        </Card>
      )}

      {run.outputs && Object.keys(run.outputs).length > 0 && (
        <Card padding="none">
          <CardHeader title="Outputs" />
          <CardBody className="pt-0">
            <pre className="whitespace-pre-wrap rounded-md bg-subtle p-3 font-mono text-xs text-fg">{JSON.stringify(run.outputs, null, 2)}</pre>
          </CardBody>
        </Card>
      )}

      {Array.isArray(run.files) && run.files.length > 0 && (
        <Card padding="none">
          <CardHeader title="Files produced" />
          <CardBody className="space-y-1 pt-0">
            {run.files.map((f: any) => <a key={f.url} href={f.url} className="block text-ui text-primary-text underline">{f.name}</a>)}
          </CardBody>
        </Card>
      )}

      {/* Token usage */}
      {run.total_tokens != null && (
        <StatGrid>
          <StatCard label="Input tokens" value={formatCount(run.input_tokens ?? 0)} />
          <StatCard label="Output tokens" value={formatCount(run.output_tokens ?? 0)} />
          <StatCard label="Total tokens" value={formatCount(run.total_tokens)} />
          <StatCard label="Cost" value={runCost(run)}>
            {run.price?.source === 'default' ? <p className="text-xs text-fg-muted">List price as of {run.price.effective_date}</p> : null}
          </StatCard>
        </StatGrid>
      )}
    </div>
  )
}

function ToolCallsTab({ toolCalls }: { toolCalls: any[] }) {
  if (toolCalls.length === 0) {
    return (
      <Card padding="none">
        <EmptyState size="sm" icon={Wrench} title="No tool calls in this run" />
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
  const input = toolCall.arguments ?? toolCall.input
  const output = toolCall.result ?? toolCall.output
  const durationMs = toolCall.duration_ms ?? toolCall.durationMs
  const error = toolCall.error ?? (output && typeof output === 'object' && 'error' in output ? output.error : null)
  return (
    <Card padding="none">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-lg p-4 text-left hover:bg-subtle">
        {expanded ? <ChevronDown size={14} className="shrink-0 text-fg-muted" aria-hidden="true" /> : <ChevronRight size={14} className="shrink-0 text-fg-muted" aria-hidden="true" />}
        <Wrench size={14} className={cn('shrink-0', error ? 'text-danger' : 'text-primary-text')} aria-hidden="true" />
        <span className="font-mono text-ui font-semibold text-fg">{name}</span>
        {toolCall.status && toolCall.status !== 'ok' && (
          <StatusPill status={toolCall.status} />
        )}
        {toolCall.approval && (
          <span className="text-xs text-fg-muted">{toolCall.approval.approved ? 'approved' : 'rejected'}{toolCall.approval.notes ? `: ${toolCall.approval.notes}` : ''}</span>
        )}
        {durationMs != null && (
          <span className="num ml-auto text-xs text-fg-muted">
            {formatDurationMs(durationMs)}
          </span>
        )}
        {error ? (
          <X size={14} className={cn('shrink-0 text-danger', durationMs == null && 'ml-auto')} aria-label="failed" />
        ) : (
          <Check size={14} className={cn('shrink-0 text-success', durationMs == null && 'ml-auto')} aria-label="succeeded" />
        )}
      </button>
      {expanded && (
        <div className="space-y-2 border-t border-border-subtle p-4">
          {input != null && <TracePre label="Input" value={input} />}
          {output != null && <TracePre label="Output" value={output} />}
          {error && (
            <div>
              <p className="mb-1 text-xs font-medium text-danger">Error</p>
              <pre className="overflow-auto rounded-md bg-danger-wash p-2 font-mono text-xs text-danger">
                {String(error)}
              </pre>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

/** The run's step trace: every model call and tool call, in order, with latency and tokens. */
function TraceTab({ run }: { run: any }) {
  const steps: any[] = Array.isArray(run.steps) ? run.steps : []
  if (steps.length === 0) {
    return (
      <Card padding="none">
        <EmptyState size="sm" icon={ListTree} title="No trace recorded for this run" description="Runs before step tracing only have their tool calls." />
      </Card>
    )
  }
  const start = new Date(steps[0]?.started_at ?? run.started_at).getTime()
  const total = Math.max(1, Number(run.duration_ms) || steps.reduce((m, st) => Math.max(m, new Date(st.started_at).getTime() - start + (st.duration_ms ?? 0)), 1))
  return (
    <Card padding="sm" data-testid="agent-run-trace">
      <ol className="space-y-0.5">
        {steps.map((step, i) => <TraceStep key={i} step={step} start={start} total={total} />)}
      </ol>
    </Card>
  )
}

function TraceStep({ step, start, total }: { step: any; start: number; total: number }) {
  const [open, setOpen] = useState(false)
  const offset = Math.max(0, new Date(step.started_at).getTime() - start)
  const width = Math.max(0.8, ((step.duration_ms ?? 0) / total) * 100)
  const left = Math.min(99, (offset / total) * 100)
  const failed = step.error || step.status === 'error' || step.status === 'rejected'
  const tone = failed ? 'danger' : step.type === 'llm' ? 'primary' : 'success'
  const label = step.type === 'llm'
    ? `Model call ${step.iteration}${step.tool_calls?.length ? ` → ${step.tool_calls.join(', ')}` : step.finish_reason ? ` (${step.finish_reason})` : ''}`
    : step.type === 'tool' ? `${step.tool}${step.status && step.status !== 'ok' ? ` · ${step.status}` : ''}${step.approval ? ` · ${step.approval.approved ? 'approved' : 'rejected'}` : ''}`
    : step.type === 'approval_requested' ? `Approval requested: ${step.tool}`
    : step.type === 'output_repair' ? 'Asked the model to fix its outputs' : step.type
  const Icon = step.type === 'llm' ? Cpu : step.type === 'tool' ? Wrench : step.type === 'approval_requested' ? ShieldCheck : RotateCw
  return (
    <li>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full rounded-md px-2 py-1.5 text-left hover:bg-subtle">
        <div className="flex items-center gap-2 text-xs">
          <Icon size={14} className={cn('shrink-0', tone === 'danger' ? 'text-danger' : tone === 'primary' ? 'text-primary-text' : 'text-success')} aria-hidden="true" />
          <span className="w-56 truncate font-mono text-fg">{label}</span>
          <div className="relative h-2 flex-1 rounded-sm bg-muted">
            <div className={cn('absolute top-0 h-2 rounded-sm opacity-85', tone === 'danger' ? 'bg-danger' : tone === 'primary' ? 'bg-primary' : 'bg-success')}
              style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
          </div>
          <span className="num w-16 text-right text-xs text-fg-muted">{step.duration_ms != null ? formatDurationMs(step.duration_ms) : ''}</span>
          <span className="num w-20 text-right text-xs text-fg-muted">{step.usage?.total_tokens != null ? `${formatCount(step.usage.total_tokens)} tok` : ''}</span>
          <span className="num w-16 text-right text-xs text-fg-muted">{step.cost?.amount != null ? formatCost(step.cost.amount, step.cost.currency) : ''}</span>
        </div>
      </button>
      {open && (
        <div className="mb-2 ml-8 mt-1 space-y-1">
          {step.attempts > 1 && <p className="text-xs text-fg-muted">{step.attempts} attempts (retried)</p>}
          {step.streamed && <p className="text-xs text-fg-muted">Streamed{step.first_token_ms != null ? ` · first token after ${formatDurationMs(step.first_token_ms)}` : ''}</p>}
          {step.error && <pre className="rounded-md bg-danger-wash p-2 font-mono text-xs text-danger">{step.error}</pre>}
          {step.errors && <pre className="rounded-md bg-subtle p-2 font-mono text-xs text-fg">{step.errors.join('\n')}</pre>}
          {step.arguments !== undefined && <TracePre label="Arguments" value={step.arguments} />}
          {step.result !== undefined && <TracePre label="Result" value={step.result} />}
          {step.usage && <p className="num font-mono text-xs text-fg-muted">prompt {step.usage.prompt_tokens} · completion {step.usage.completion_tokens}{step.usage.cached_tokens ? ` · cached ${step.usage.cached_tokens}` : ''}{step.usage.reasoning_tokens ? ` · reasoning ${step.usage.reasoning_tokens}` : ''}</p>}
        </div>
      )}
    </li>
  )
}

function TracePre({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-fg-muted">{label}</p>
      <pre className="max-h-48 overflow-auto rounded-md bg-subtle p-2 font-mono text-xs text-fg">
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
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
        <Card padding="none">
          <CardHeader title="Triggered by" />
          <CardBody className="pt-0">
            <Link
              href={`/automations/runs/${parentRun.id}`}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui text-primary-text hover:bg-subtle hover:underline"
            >
              <GitBranch size={14} aria-hidden="true" />
              {parentRun.workflow?.name ?? 'Workflow run'}
              <StatusPill status={parentRun.status} className="ml-auto" />
            </Link>
          </CardBody>
        </Card>
      )}

      {(integrationCalls?.length ?? 0) > 0 && (
        <Card padding="none">
          <CardHeader title="Integration calls" />
          <CardBody className="space-y-0.5 pt-0">
            {(integrationCalls ?? []).map((call: any) => (
              <Link
                key={call.id}
                href={`/integrations/${call.integration_id}/calls/${call.id}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-ui text-fg transition-colors hover:bg-subtle"
              >
                <span className="w-14 font-mono text-xs font-semibold">{call.method}</span>
                <span className="flex-1 truncate font-mono text-xs">{call.url ?? '—'}</span>
                <span className={cn('num text-xs font-semibold', call.response_status && call.response_status >= 400 ? 'text-danger' : 'text-fg-muted')}>
                  {call.response_status ?? 'err'}
                </span>
                <span className="num w-16 text-right text-xs text-fg-muted">
                  {formatDurationMs(call.duration_ms)}
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      {!parentRun && (integrationCalls?.length ?? 0) === 0 && (
        <Card padding="none">
          <EmptyState size="sm" icon={GitBranch} title="No related records" />
        </Card>
      )}
    </div>
  )
}
