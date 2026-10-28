'use client'

import { use, useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { ChevronLeft, Search, GitBranch, ArrowRight, Clock, AlertCircle } from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'
import { RunStatusBadge } from '@/components/ui/status-badge'
import { StatCard } from '@/components/ui/stat-card'

const PAGE_SIZE = 25

type SortKey = 'started_at' | 'duration' | 'status'

export default function WorkflowRunsListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: workflowId } = use(params)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [sortKey, setSortKey] = useState<SortKey>('started_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(0)

  const { data: workflow } = useQuery({
    queryKey: ['workflow-meta', workflowId],
    queryFn: async () => (await serverRead('automations.workflowMeta', { id: workflowId })).data,
  })

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['workflow-runs-list', workflowId, statusFilter, sortKey, sortDir, page],
    queryFn: async () => (await serverRead('automations.workflowRuns', { workflowId, status: statusFilter || undefined, sortKey, sortDir, page })).data ?? { rows: [], total: 0 },
  })

  const { data: stats } = useQuery({
    queryKey: ['workflow-run-stats', workflowId],
    queryFn: async () => (await serverRead('automations.workflowRunStats', { workflowId })).data ?? { total: 0, completed: 0, failed: 0, running: 0, avgDuration: 0, successRate: 0 },
  })

  // Client-side search + computed duration for display
  const filtered = useMemo(() => {
    const rows = runsData?.rows ?? []
    const withDuration = rows.map((r: any) => ({
      ...r,
      _duration_ms: r.completed_at && r.started_at
        ? new Date(r.completed_at).getTime() - new Date(r.started_at).getTime()
        : null,
    }))
    if (!search.trim()) {
      // Apply local sort for duration if needed
      if (sortKey === 'duration') {
        return [...withDuration].sort((a, b) => {
          const aD = a._duration_ms ?? 0
          const bD = b._duration_ms ?? 0
          return sortDir === 'asc' ? aD - bD : bD - aD
        })
      }
      return withDuration
    }
    const q = search.toLowerCase()
    return withDuration.filter((r: any) =>
      String(r.title ?? '').toLowerCase().includes(q) ||
      String(r.error ?? '').toLowerCase().includes(q) ||
      String(r.id ?? '').toLowerCase().includes(q)
    )
  }, [runsData, search, sortKey, sortDir])

  const totalPages = runsData ? Math.max(1, Math.ceil(runsData.total / PAGE_SIZE)) : 1

  const slaSummary = useMemo(() => {
    const rows = (runsData?.rows ?? []) as any[]
    const warningCount = rows.filter((run) => run.sla_status === 'warning').length
    const breachedCount = rows.filter((run) => run.sla_status === 'breached').length
    const activeCount = rows.filter((run) => Boolean(run.sla_due_at)).length
    return { activeCount, warningCount, breachedCount }
  }, [runsData])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
    setPage(0)
  }

  return (
    <div className="space-y-4 page-transition">
      {/* Header */}
      <div>
        <Link href={`/automations/${workflowId}`} className="inline-flex items-center gap-1 text-xs mb-1 hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back to workflow
        </Link>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>
          {(workflow as any)?.name ?? 'Workflow'} — Runs
        </h1>
        <div className="flex items-center gap-3 mt-1 text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          <span>{runsData?.total ?? 0} total execution{(runsData?.total ?? 0) === 1 ? '' : 's'}</span>
          {(workflow as any)?.trigger_type && (
            <span className="capitalize">· {(workflow as any).trigger_type.replace(/_/g, ' ')}</span>
          )}
          <span>· {(workflow as any)?.is_active ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <StatCard label="Total" value={String(stats.total)} />
          <StatCard label="Completed" value={String(stats.completed)} accent="var(--theme-success)" />
          <StatCard label="Failed" value={String(stats.failed)} accent="var(--theme-danger)" />
          <StatCard label="Running" value={String(stats.running)} accent="var(--status-info)" />
          <StatCard label="Avg Duration" value={stats.avgDuration > 0 ? `${(stats.avgDuration / 1000).toFixed(1)}s` : '—'} />
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Runs With SLA" value={String(slaSummary.activeCount)} />
        <StatCard label="SLA Warning" value={String(slaSummary.warningCount)} accent="var(--theme-warning)" />
        <StatCard label="SLA Breached" value={String(slaSummary.breachedCount)} accent="var(--theme-danger)" />
      </div>

      {/* Toolbar */}
      <Card className="!p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, error, or run id..." className="pl-9" />
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
            <option value="processing">Processing</option>
            <option value="waiting_for_event">Waiting for event</option>
            <option value="paused">Paused</option>
            <option value="migrated">Migrated</option>
          </select>
          {(search || statusFilter) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setSearch(''); setStatusFilter(''); setPage(0) }}
            >
              Clear
            </Button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--theme-muted-text)' }}>Loading runs...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <GitBranch size={32} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)' }} />
            <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
              {search || statusFilter ? 'No runs match your filters' : 'No runs yet for this workflow'}
            </p>
          </div>
        ) : (
          <>
            {/* Header row */}
            <div className="grid text-[10px] font-semibold uppercase tracking-wider select-none px-4 py-2"
              style={{
                gridTemplateColumns: '90px 1fr 100px 130px 32px',
                backgroundColor: 'var(--theme-row-highlight)',
                color: 'var(--theme-muted-text)',
                borderBottom: '1px solid var(--theme-surface-border)',
              }}
            >
              <button
                onClick={() => toggleSort('status')}
                className="text-left transition-colors hover:text-[var(--theme-card-text)] cursor-pointer"
              >
                Status {sortKey === 'status' && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
              <div>Title / Error</div>
              <button
                onClick={() => toggleSort('duration')}
                className="text-left transition-colors hover:text-[var(--theme-card-text)] cursor-pointer"
              >
                Duration {sortKey === 'duration' && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
              <button
                onClick={() => toggleSort('started_at')}
                className="text-left transition-colors hover:text-[var(--theme-card-text)] cursor-pointer"
              >
                Started {sortKey === 'started_at' && (sortDir === 'asc' ? '↑' : '↓')}
              </button>
              <div />
            </div>

            {/* Rows */}
            {filtered.map((run: any) => (
              <Link
                key={run.id}
                href={`/automations/runs/${run.id}`}
                className="grid items-center px-4 py-3 text-xs transition-colors hover:bg-[var(--theme-row-highlight)]"
                style={{
                  gridTemplateColumns: '90px 1fr 100px 130px 32px',
                  borderBottom: '1px solid var(--theme-surface-border)',
                }}
              >
                <RunStatusBadge status={run.status} />
                <div className="min-w-0 pr-4">
                  <div className="truncate" style={{ color: 'var(--theme-card-text)' }}>
                    {run.title ?? <span className="font-mono text-[10px]" style={{ color: 'var(--theme-muted-text)' }}>{String(run.id).slice(0, 12)}</span>}
                  </div>
                  {run.sla_due_at && (
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
                      <SlaBadge status={run.sla_status} />
                      <span style={{ color: 'var(--theme-muted-text)' }}>
                        {(run.sla_label ?? 'SLA')} due {formatRelativeDate(run.sla_due_at)}
                      </span>
                    </div>
                  )}
                  {run.error && (
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] font-mono truncate" style={{ color: 'var(--theme-danger)' }}>
                      <AlertCircle size={10} className="shrink-0" />
                      <span className="truncate">{run.error}</span>
                    </div>
                  )}
                </div>
                <div className="font-mono" style={{ color: 'var(--theme-muted-text)' }}>
                  {run._duration_ms != null ? `${(run._duration_ms / 1000).toFixed(1)}s` : '—'}
                </div>
                <div style={{ color: 'var(--theme-muted-text)' }}>
                  {formatRelativeDate(run.started_at)}
                </div>
                <ArrowRight size={12} style={{ color: 'var(--theme-muted-text)' }} />
              </Link>
            ))}
          </>
        )}

        {/* Pagination */}
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

function SlaBadge({ status }: { status?: string | null }) {
  const normalized = status ?? 'on_track'
  const colorMap: Record<string, { bg: string; fg: string; label: string }> = {
    breached: { bg: 'var(--status-danger-bg)', fg: 'var(--theme-danger)', label: 'SLA breached' },
    warning: { bg: 'var(--status-warning-bg)', fg: 'var(--theme-warning)', label: 'SLA near' },
    on_track: { bg: 'var(--status-success-bg)', fg: 'var(--theme-success)', label: 'SLA on track' },
    none: { bg: 'var(--theme-surface)', fg: 'var(--theme-muted-text)', label: 'No SLA' },
  }
  const { bg, fg, label } = colorMap[normalized] ?? colorMap.on_track
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium"
      style={{ backgroundColor: bg, color: fg }}
    >
      <Clock size={10} />
      {label}
    </span>
  )
}
