'use client'

import { use, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { serverRead } from '@/lib/server-read'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Search, GitBranch, Clock, AlertCircle, ArrowDown, ArrowUp } from 'lucide-react'
import { Badge, StatusPill, Tag, type Tone } from '@/components/ui/badge'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { PageHeader } from '@/components/ui/page-header'
import { Table, TBody, TD, TH, THead, TR, TableEmpty, TableSkeleton } from '@/components/ui/table'
import { Tooltip } from '@/components/ui/tooltip'
import { formatCount } from '@/lib/format/number'
import { formatDurationMs } from '@/lib/format/duration'
import { formatAbsolute, formatRelative } from '@/lib/format/date'
import { plural } from '@/lib/format/plural'

const PAGE_SIZE = 25

type SortKey = 'started_at' | 'duration' | 'status'

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
  { value: 'processing', label: 'Processing' },
  { value: 'waiting_for_event', label: 'Waiting for event' },
  { value: 'paused', label: 'Paused' },
  { value: 'migrated', label: 'Migrated' },
]

/** How the run was started (workflow_runs.started_via); null = the workflow's own trigger. */
const STARTED_VIA_LABEL: Record<string, string> = {
  ui: 'Manual', api: 'API', cli: 'CLI', mcp: 'MCP', schedule: 'Schedule', test: 'Test', anonymous: 'Anonymous',
}

function humanize(value: string): string {
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export default function WorkflowRunsListPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: workflowId } = use(params)
  const router = useRouter()
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

  const wf = workflow as any
  const workflowName: string = wf?.name ?? 'Workflow'
  const triggerLabel = wf?.trigger_type ? humanize(String(wf.trigger_type)) : null

  const sortProps = { sortKey, sortDir, onSort: toggleSort }

  return (
    <div className="page-transition">
      <PageHeader
        breadcrumbs={[
          { label: 'Workflows', href: '/automations' },
          { label: workflowName, href: `/automations/${workflowId}` },
          { label: 'Runs' },
        ]}
        title="Runs"
        badge={wf ? <StatusPill status={wf.is_active ? 'active' : 'inactive'} /> : undefined}
        description={
          <>
            {plural(runsData?.total ?? 0, 'execution')}
            {stats && <> · {formatCount(stats.running)} running</>}
            {triggerLabel && <> · {triggerLabel}</>}
          </>
        }
      />

      <div className="space-y-4">
        {/* Stats row */}
        {stats && (
          <StatGrid>
            <StatCard label="Total" value={formatCount(stats.total)} />
            <StatCard label="Completed" value={formatCount(stats.completed)} tone="success" />
            <StatCard label="Failed" value={formatCount(stats.failed)} tone={stats.failed > 0 ? 'danger' : undefined} />
            <StatCard label="Avg duration" value={stats.avgDuration > 0 ? formatDurationMs(stats.avgDuration) : '—'} />
          </StatGrid>
        )}

        {slaSummary.activeCount > 0 && (
          <StatGrid>
            <StatCard label="Runs with SLA" value={formatCount(slaSummary.activeCount)} hint="Runs on this page that have an SLA" />
            <StatCard label="SLA warning" value={formatCount(slaSummary.warningCount)} tone={slaSummary.warningCount > 0 ? 'warning' : undefined} />
            <StatCard label="SLA breached" value={formatCount(slaSummary.breachedCount)} tone={slaSummary.breachedCount > 0 ? 'danger' : undefined} />
          </StatGrid>
        )}

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, error or run ID…"
            aria-label="Search runs"
            leading={<Search />}
            wrapperClassName="min-w-[240px] flex-1"
          />
          <Select
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(0) }}
            aria-label="Status"
            placeholder="All statuses"
            options={STATUS_OPTIONS}
            wrapperClassName="w-48"
          />
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

        {/* Table */}
        <div>
          <Table>
            <THead>
              <tr>
                <SortHeader {...sortProps} k="status" label="Status" />
                <TH>Run</TH>
                <TH>Trigger</TH>
                <SortHeader {...sortProps} k="started_at" label="Started" />
                <SortHeader {...sortProps} k="duration" label="Duration" numeric />
              </tr>
            </THead>
            <TBody>
              {isLoading ? (
                <TableSkeleton columns={5} />
              ) : filtered.length === 0 ? (
                <TableEmpty
                  colSpan={5}
                  icon={GitBranch}
                  variant={search || statusFilter ? 'no-results' : 'first-run'}
                  title={search || statusFilter ? 'No runs match your filters' : 'No runs yet for this workflow'}
                  action={search || statusFilter ? { label: 'Clear filters', onClick: () => { setSearch(''); setStatusFilter(''); setPage(0) } } : undefined}
                />
              ) : (
                filtered.map((run: any) => {
                  const href = `/automations/runs/${run.id}`
                  const via = run.started_via ? (STARTED_VIA_LABEL[run.started_via] ?? humanize(String(run.started_via))) : triggerLabel
                  return (
                    <TR key={run.id} interactive onClick={() => router.push(href)}>
                      <TD className="w-px whitespace-nowrap"><StatusPill status={run.status} /></TD>
                      <TD className="max-w-0 py-2">
                        <Link href={href} onClick={(e) => e.stopPropagation()} className="block truncate text-ui text-fg hover:underline">
                          {run.title ?? <span className="font-mono text-xs text-fg-muted">{String(run.id).slice(0, 12)}</span>}
                        </Link>
                        {run.sla_due_at && (
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                            <SlaBadge status={run.sla_status} />
                            <Tooltip content={formatAbsolute(run.sla_due_at)}>
                              <span className="text-fg-muted">
                                {(run.sla_label ?? 'SLA')} due {lowerFirst(formatRelative(run.sla_due_at))}
                              </span>
                            </Tooltip>
                          </div>
                        )}
                        {run.error && (
                          <div className="mt-0.5 flex items-center gap-1 truncate font-mono text-2xs text-danger">
                            <AlertCircle size={12} className="shrink-0" aria-hidden="true" />
                            <span className="truncate">{run.error}</span>
                          </div>
                        )}
                      </TD>
                      <TD className="whitespace-nowrap text-ui text-fg-muted">
                        {/* Started by an anonymous visitor of a public form link (no user). */}
                        {run.started_via === 'anonymous' ? (
                          <Tooltip content="Started by an anonymous submission of a public form link">
                            <Tag data-run-started-via="anonymous">Anonymous</Tag>
                          </Tooltip>
                        ) : (via ?? '—')}
                      </TD>
                      <TD className="whitespace-nowrap text-ui text-fg-muted">
                        <Tooltip content={formatAbsolute(run.started_at)}>
                          <span>{formatRelative(run.started_at)}</span>
                        </Tooltip>
                      </TD>
                      <TD numeric className="whitespace-nowrap text-ui text-fg-muted">
                        {run._duration_ms != null ? formatDurationMs(run._duration_ms) : '—'}
                      </TD>
                    </TR>
                  )
                })
              )}
            </TBody>
          </Table>

          {/* Pagination */}
          {(runsData?.total ?? 0) > PAGE_SIZE && (
            <div className="flex items-center justify-between px-1 pt-3">
              <span className="num text-xs text-fg-muted">
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SortHeader({ k, label, numeric, sortKey, sortDir, onSort }: { k: SortKey; label: string; numeric?: boolean; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (key: SortKey) => void }) {
  const active = sortKey === k
  return (
    <TH numeric={numeric} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 hover:text-fg ${active ? 'text-fg' : ''}`}
      >
        {label}
        {active && (sortDir === 'asc' ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />)}
      </button>
    </TH>
  )
}

/** "Yesterday" → "yesterday" mid-sentence (dates like "27 Oct" are unchanged). */
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1)

const SLA_BADGE: Record<string, { tone: Tone; label: string }> = {
  breached: { tone: 'danger', label: 'SLA breached' },
  warning: { tone: 'warning', label: 'SLA near' },
  on_track: { tone: 'success', label: 'SLA on track' },
  none: { tone: 'neutral', label: 'No SLA' },
}

function SlaBadge({ status }: { status?: string | null }) {
  const { tone, label } = SLA_BADGE[status ?? 'on_track'] ?? SLA_BADGE.on_track
  return (
    <Badge tone={tone} pill>
      <Clock size={12} aria-hidden="true" />
      {label}
    </Badge>
  )
}
