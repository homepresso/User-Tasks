'use client'

import { use, useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverQuery, serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ChevronLeft, Search, Bot, ArrowRight, Check, X, Clock } from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'
import { RunStatusBadge } from '@/components/ui/status-badge'
import { StatCard } from '@/components/ui/stat-card'

const PAGE_SIZE = 25

export default function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: agentId } = use(params)
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

  const totalPages = runsData ? Math.max(1, Math.ceil(runsData.total / PAGE_SIZE)) : 1

  // Quick stats
  const { data: stats } = useQuery({
    queryKey: ['agent-run-stats', agentId],
    queryFn: () => serverQuery('agents.runStats', { agentId }),
  })

  if (isLoading && !runsData && !agent && !stats) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4 page-transition">
      <div>
        <Link href={`/agents/${agentId}`} className="inline-flex items-center gap-1 text-xs mb-1 hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back to agent
        </Link>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>
          {(agent as any)?.name ?? 'Agent'} — Runs
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          {runsData?.total ?? 0} total execution{(runsData?.total ?? 0) === 1 ? '' : 's'}
        </p>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Runs" value={String(stats.total)} />
          <StatCard label="Completed" value={String(stats.completed)} accent="var(--theme-success)" />
          <StatCard label="Failed" value={String(stats.failed)} accent="var(--theme-danger)" />
          <StatCard label="Avg Duration" value={`${(stats.avgDuration / 1000).toFixed(1)}s`} />
        </div>
      )}

      {/* Toolbar */}
      <Card className="!p-4">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search inputs or errors..." className="pl-9" />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="">All statuses</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
            <option value="running">Running</option>
          </select>
        </div>
      </Card>

      {/* List */}
      <Card className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--theme-muted-text)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Bot size={32} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)' }} />
            <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
              {search || statusFilter ? 'No runs match your filters' : 'No runs yet'}
            </p>
          </div>
        ) : (
          <>
            <div className="grid text-[10px] font-semibold uppercase tracking-wider select-none px-4 py-2"
              style={{
                gridTemplateColumns: '90px 1fr 80px 100px 80px 100px 32px',
                backgroundColor: 'var(--theme-row-highlight)',
                color: 'var(--theme-muted-text)',
                borderBottom: '1px solid var(--theme-surface-border)',
              }}
            >
              <div>Status</div>
              <div>Input</div>
              <div>Iter</div>
              <div>Tokens</div>
              <div>Time</div>
              <div>Started</div>
              <div />
            </div>
            {filtered.map((run: any) => (
              <Link
                key={run.id}
                href={`/agents/${agentId}/runs/${run.id}`}
                className="grid items-center px-4 py-3 text-xs transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{
                  gridTemplateColumns: '90px 1fr 80px 100px 80px 100px 32px',
                  borderBottom: '1px solid var(--theme-surface-border)',
                }}
              >
                <RunStatusBadge status={run.status} />
                <div className="truncate pr-4" style={{ color: 'var(--theme-card-text)' }}>
                  {run.input_message?.slice(0, 120) ?? '—'}
                </div>
                <div style={{ color: 'var(--theme-muted-text)' }}>{run.iterations ?? 0}</div>
                <div className="font-mono" style={{ color: 'var(--theme-muted-text)' }}>
                  {(run.total_tokens ?? 0).toLocaleString()}
                </div>
                <div className="font-mono" style={{ color: 'var(--theme-muted-text)' }}>
                  {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                </div>
                <div style={{ color: 'var(--theme-muted-text)' }}>
                  {formatRelativeDate(run.started_at ?? run.created_at)}
                </div>
                <ArrowRight size={12} style={{ color: 'var(--theme-muted-text)' }} />
              </Link>
            ))}
          </>
        )}

        {(runsData?.total ?? 0) > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-2 border-t" style={{ borderColor: 'var(--theme-surface-border)' }}>
            <span className="text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>
              Page {page + 1} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
              <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

