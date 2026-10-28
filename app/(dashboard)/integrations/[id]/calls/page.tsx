'use client'

import { use, useState, useMemo } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { serverQuery, serverRead } from '@/lib/server-read'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { ChevronLeft, Search, Network, ArrowRight, Clock } from 'lucide-react'
import { formatRelativeDate } from '@/lib/utils'
import { StatCard } from '@/components/ui/stat-card'

const PAGE_SIZE = 30

export default function IntegrationCallsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: integrationId } = use(params)
  const [search, setSearch] = useState('')
  const [methodFilter, setMethodFilter] = useState<string>('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [page, setPage] = useState(0)

  const { data: integration } = useQuery({
    queryKey: ['integration-meta', integrationId],
    queryFn: async () => (await serverRead('integrations.meta', { id: integrationId })).data,
  })

  const { data: callsData, isLoading } = useQuery({
    queryKey: ['integration-calls', integrationId, methodFilter, statusFilter, page],
    queryFn: async () => (await serverRead('integrations.calls', {
      integrationId,
      method: methodFilter || undefined,
      status: statusFilter === 'success' || statusFilter === 'error' ? statusFilter : undefined,
      page,
    })).data ?? { rows: [], total: 0 },
  })

  const { data: stats } = useQuery({
    queryKey: ['integration-call-stats', integrationId],
    queryFn: () => serverQuery('integrations.callStats', { integrationId }),
  })

  const filtered = useMemo(() => {
    if (!search.trim()) return callsData?.rows ?? []
    const q = search.toLowerCase()
    return (callsData?.rows ?? []).filter((r: any) =>
      String(r.url ?? '').toLowerCase().includes(q) ||
      String(r.error ?? '').toLowerCase().includes(q)
    )
  }, [callsData, search])

  const totalPages = callsData ? Math.max(1, Math.ceil(callsData.total / PAGE_SIZE)) : 1

  if (isLoading && !callsData && !integration && !stats) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4 page-transition">
      <div>
        <Link href={`/integrations/${integrationId}`} className="inline-flex items-center gap-1 text-xs mb-1 hover:underline" style={{ color: 'var(--theme-muted-text)' }}>
          <ChevronLeft size={12} /> Back to integration
        </Link>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>
          {(integration as any)?.name ?? 'Integration'} — Calls
        </h1>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          {callsData?.total ?? 0} total API call{(callsData?.total ?? 0) === 1 ? '' : 's'}
        </p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Total Calls" value={String(stats.total)} />
          <StatCard label="Success" value={String(stats.success)} accent="var(--theme-success)" />
          <StatCard label="Errors" value={String(stats.errors)} accent="var(--theme-danger)" />
          <StatCard label="Avg Latency" value={`${stats.avgDuration}ms`} />
        </div>
      )}

      <Card className="!p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search URL or error..." className="pl-9" />
          </div>
          <select
            value={methodFilter}
            onChange={(e) => { setMethodFilter(e.target.value); setPage(0) }}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="">All methods</option>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="">All statuses</option>
            <option value="success">Success (2xx/3xx)</option>
            <option value="error">Error (4xx/5xx/failed)</option>
          </select>
        </div>
      </Card>

      <Card className="!p-0 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-sm" style={{ color: 'var(--theme-muted-text)' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <Network size={32} className="mx-auto mb-2" style={{ color: 'var(--theme-muted-text)' }} />
            <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>
              {search || methodFilter || statusFilter ? 'No calls match your filters' : 'No API calls recorded yet'}
            </p>
            <p className="text-[10px] mt-1" style={{ color: 'var(--theme-muted-text)' }}>
              Calls are logged from the moment observability was enabled.
            </p>
          </div>
        ) : (
          <>
            <div className="grid text-[10px] font-semibold uppercase tracking-wider select-none px-4 py-2"
              style={{
                gridTemplateColumns: '60px 1fr 60px 80px 110px 120px 32px',
                backgroundColor: 'var(--theme-row-highlight)',
                color: 'var(--theme-muted-text)',
                borderBottom: '1px solid var(--theme-surface-border)',
              }}
            >
              <div>Method</div>
              <div>URL</div>
              <div>Status</div>
              <div>Duration</div>
              <div>Caller</div>
              <div>Started</div>
              <div />
            </div>
            {filtered.map((call: any) => {
              const isError = !call.response_status || call.response_status >= 400 || call.error
              return (
                <Link
                  key={call.id}
                  href={`/integrations/${integrationId}/calls/${call.id}`}
                  className="grid items-center px-4 py-3 text-xs transition-colors hover:bg-[var(--theme-row-highlight)]"
                  style={{
                    gridTemplateColumns: '60px 1fr 60px 80px 110px 120px 32px',
                    borderBottom: '1px solid var(--theme-surface-border)',
                  }}
                >
                  <div className="font-mono font-semibold" style={{ color: 'var(--theme-muted-text)' }}>
                    {call.method ?? '—'}
                  </div>
                  <div className="truncate pr-4 font-mono text-[10px]" style={{ color: 'var(--theme-card-text)' }}>
                    {call.url ?? <span style={{ color: 'var(--theme-danger)' }}>{call.error?.slice(0, 80) ?? '(error)'}</span>}
                  </div>
                  <div className="font-mono font-semibold text-[11px]"
                    style={{ color: isError ? 'var(--theme-danger)' : 'var(--theme-success)' }}>
                    {call.response_status ?? 'err'}
                  </div>
                  <div className="font-mono" style={{ color: 'var(--theme-muted-text)' }}>
                    {call.duration_ms != null ? `${call.duration_ms}ms` : '—'}
                  </div>
                  <div className="truncate capitalize" style={{ color: 'var(--theme-muted-text)' }}>
                    {call.caller_type?.replace('_', ' ') ?? '—'}
                  </div>
                  <div style={{ color: 'var(--theme-muted-text)' }}>
                    {formatRelativeDate(call.started_at)}
                  </div>
                  <ArrowRight size={12} style={{ color: 'var(--theme-muted-text)' }} />
                </Link>
              )
            })}
          </>
        )}

        {(callsData?.total ?? 0) > PAGE_SIZE && (
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

