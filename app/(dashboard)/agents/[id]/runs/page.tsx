'use client'

import { use, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { serverQuery, serverRead } from '@/lib/server-read'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Table, THead, TBody, TR, TH, TD, TableEmpty, TableSkeleton } from '@/components/ui/table'
import { StatusPill } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import { Pagination } from '@/components/ui/list-controls'
import { Bot, ChevronRight } from 'lucide-react'
import { formatCost } from '@/lib/agents/pricing'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'
import { formatDurationMs } from '@/lib/format/duration'
import { formatAbsolute, formatRelative } from '@/lib/format/date'

const PAGE_SIZE = 25

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
]

export default function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = use(params)
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(0)

  const { data: agent } = useQuery({
    queryKey: ['agent-meta', agentId],
    queryFn: async () => (await serverRead('agents.meta', { id: agentId })).data,
  })

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['agent-runs-list', agentId, statusFilter, page],
    queryFn: async () => (await serverRead('agents.runs', { agentId, status: statusFilter || undefined, page })).data ?? { rows: [], total: 0 },
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return runsData?.rows ?? []
    const q = search.toLowerCase()
    return (runsData?.rows ?? []).filter((r: any) =>
      String(r.input_message ?? '').toLowerCase().includes(q) ||
      String(r.error ?? '').toLowerCase().includes(q)
    )
  }, [runsData, search])

  // Quick stats
  const { data: stats } = useQuery({
    queryKey: ['agent-run-stats', agentId],
    queryFn: () => serverQuery('agents.runStats', { agentId }),
  })

  if (isLoading && !runsData && !agent && !stats) {
    return <PageSkeleton variant="list" />
  }

  const agentName = (agent as any)?.name ?? 'Agent'

  return (
    <div className="page-transition">
      <PageHeader
        breadcrumbs={[{ label: 'Agents', href: '/agents' }, { label: agentName, href: `/agents/${agentId}` }, { label: 'Runs' }]}
        title="Runs"
        description={<span className="num">{plural(runsData?.total ?? 0, 'execution')} of {agentName}</span>}
      />

      <div className="space-y-4">
        {/* Stats */}
        {stats && (
          <StatGrid>
            <StatCard label="Total runs" value={formatCount(stats.total)} />
            <StatCard label="Completed" value={formatCount(stats.completed)} tone="success" />
            <StatCard label="Failed" value={formatCount(stats.failed)} tone={stats.failed ? 'danger' : undefined} />
            <StatCard label="Avg duration" value={formatDurationMs(stats.avgDuration)} />
          </StatGrid>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search inputs or errors…" aria-label="Search runs" wrapperClassName="min-w-[220px] flex-1" />
          <Select
            aria-label="Status"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
            options={STATUS_OPTIONS}
            wrapperClassName="w-auto"
          />
        </div>

        {/* List */}
        <div>
          <Table>
            <THead>
              <tr>
                <TH>Status</TH>
                <TH>Input</TH>
                <TH numeric>Iterations</TH>
                <TH numeric>Tokens</TH>
                <TH numeric>Cost</TH>
                <TH numeric>Duration</TH>
                <TH>Started</TH>
                <TH className="w-8"><span className="sr-only">Open</span></TH>
              </tr>
            </THead>
            <TBody>
              {isLoading ? (
                <TableSkeleton columns={8} />
              ) : filtered.length === 0 ? (
                <TableEmpty
                  colSpan={8}
                  size="sm"
                  icon={Bot}
                  variant={search || statusFilter ? 'no-results' : 'first-run'}
                  title={search || statusFilter ? 'No runs match your filters' : 'No runs yet'}
                />
              ) : filtered.map((run: any) => {
                const started = run.started_at ?? run.created_at
                return (
                  <TR key={run.id} interactive onClick={() => router.push(`/agents/${agentId}/runs/${run.id}`)}>
                    <TD><StatusPill status={run.status} /></TD>
                    <TD className="max-w-0 w-[40%]">
                      <Link href={`/agents/${agentId}/runs/${run.id}`} className="block truncate text-fg hover:underline" onClick={(e) => e.stopPropagation()}>
                        {run.input_message?.slice(0, 120) ?? '—'}
                      </Link>
                    </TD>
                    <TD numeric className="text-fg-muted">{formatCount(run.iterations ?? 0)}</TD>
                    <TD numeric className="text-fg-muted">{formatCount(run.total_tokens ?? 0)}</TD>
                    <TD numeric className="text-fg-muted">
                      {run.cost_status === 'priced'
                        ? formatCost(Number(run.cost_amount), run.cost_currency)
                        : <Tooltip content="No price for this model"><span>—</span></Tooltip>}
                    </TD>
                    <TD numeric className="text-fg-muted">{run.duration_ms != null ? formatDurationMs(run.duration_ms) : '—'}</TD>
                    <TD className="text-xs text-fg-muted">
                      <Tooltip content={formatAbsolute(started)}>
                        <span className="num">{formatRelative(started)}</span>
                      </Tooltip>
                    </TD>
                    <TD className="text-fg-muted"><ChevronRight size={14} aria-hidden="true" /></TD>
                  </TR>
                )
              })}
            </TBody>
          </Table>

          <Pagination
            page={page + 1}
            pageSize={PAGE_SIZE}
            total={runsData?.total ?? 0}
            onPageChange={(p) => setPage(Math.max(0, p - 1))}
            noun="runs"
          />
        </div>
      </div>
    </div>
  )
}
