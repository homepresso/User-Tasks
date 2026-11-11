"use client"

import { Suspense, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { Tabs } from '@/components/ui/tabs'
import { ActiveTasksTab } from '@/components/automations/active-tasks'
import { DEFAULT_ACTIVE_FILTERS, parseQueueTab, serializeQueueTab, type QueueTab } from '@/lib/automations/active-task-filters'
import { Inbox } from 'lucide-react'
import { QueueActions } from '@/components/automations/queue-actions'
import { QueueList } from '@/components/automations/queue-list'
import { QueueFiltersBar } from '@/components/automations/queue-filters-bar'
import { useQueuePage } from '@/components/automations/use-queue-page'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { PageHeader } from '@/components/ui/page-header'
import { StatCard, StatGrid } from '@/components/ui/stat-card'
import { EmptyState } from '@/components/ui/empty-state'
import { InlineNotice } from '@/components/ui/inline-notice'
import { Table, TBody, TableSkeleton } from '@/components/ui/table'
import { formatCount } from '@/lib/format/number'
import { cn } from '@/lib/utils'
import { usePermissions } from '@/lib/permissions-context'
import { clearQueueFilters, hasQueueFilters, viewForChip, type QueueView } from '@/lib/automations/queue-filters'

type StatTone = 'default' | 'success' | 'warning' | 'danger' | 'info'

/** Stat cards: a status chip, the effective statuses it counts, and its tone. */
const STAT_CARDS: ReadonlyArray<{ chip: string; label: string; statuses: string[]; tone: StatTone; hint?: string }> = [
  { chip: 'pending', label: 'Pending', statuses: ['pending'], tone: 'default' },
  { chip: 'processing', label: 'Running', statuses: ['processing', 'running'], tone: 'info' },
  { chip: 'waiting', label: 'Awaiting', statuses: ['waiting_for_event'], tone: 'warning', hint: 'Runs waiting for an event, a task or a timer' },
  { chip: 'paused', label: 'Paused', statuses: ['paused'], tone: 'warning' },
  { chip: 'failed', label: 'Failed', statuses: ['failed'], tone: 'danger' },
  { chip: 'dead', label: 'Dead', statuses: ['dead'], tone: 'danger' },
  { chip: 'completed', label: 'Completed', statuses: ['completed'], tone: 'success' },
]

const EMPTY_VIEW: Record<QueueView, { title: string; description: string }> = {
  active: { title: 'No active workflows', description: 'Nothing is pending, running, awaiting action or paused.' },
  attention: { title: 'Nothing needs attention', description: 'No failed or dead items, and no active run is past its SLA.' },
  completed: { title: 'No completed workflows', description: 'Completed, cancelled and migrated runs show here.' },
  all: { title: 'The queue is empty', description: 'Workflow runs show here once they start.' },
}

export default function QueuePage() {
  // The view and filters live in the URL (useSearchParams).
  return (
    <Suspense fallback={<PageSkeleton variant="list" />}>
      <QueuePageInner />
    </Suspense>
  )
}

function QueuePageInner() {
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const tab = parseQueueTab(searchParams)
  const setTab = (next: QueueTab) => {
    const qs = serializeQueueTab(next, DEFAULT_ACTIVE_FILTERS, new URLSearchParams(searchParams.toString()))
    window.history.pushState(null, '', qs ? `${pathname}?${qs}` : pathname)
  }
  const tabs = (
    <Tabs<QueueTab>
      aria-label="Queue"
      value={tab}
      onValueChange={setTab}
      items={[{ value: 'workflows', label: 'Workflows' }, { value: 'tasks', label: 'Active tasks' }]}
      className="mb-4"
    />
  )
  if (tab === 'tasks') {
    return (
      <div>
        <PageHeader title="Workflow queue" description="Open tasks waiting for people, and who can move them on" />
        {tabs}
        <ActiveTasksTab />
      </div>
    )
  }
  return <WorkflowsTab tabs={tabs} />
}

function WorkflowsTab({ tabs }: { tabs: React.ReactNode }) {
  const { can } = usePermissions()
  // Full queue for workflows.view_runs; the runs you're involved in (and granted workflows) otherwise.
  const allRuns = can('workflows.view_runs')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const queue = useQueuePage({ facets: advancedOpen })
  const { filters, update, data, facets } = queue

  const statusCounts = data?.statusCounts ?? {}
  const countOf = (statuses: string[]) => statuses.reduce((n, s) => n + (statusCounts[s] ?? 0), 0)
  const toneFor = (tone: StatTone, n: number): StatTone => (n > 0 ? tone : 'default')
  const selectedChip = filters.statuses.length === 1 ? filters.statuses[0] : null

  const filtered = hasQueueFilters(filters)
  const empty = filtered ? (
    <EmptyState
      variant="no-results"
      title="No jobs match your filters"
      description={filters.view !== 'all' ? 'Try another view, or clear the filters.' : 'Try a different search, or clear the filters.'}
      action={{ label: 'Clear filters', onClick: () => { queue.setSearchText(''); queue.replace(clearQueueFilters(filters)) } }}
      secondaryAction={filters.view !== 'all' && (data?.viewCounts.all ?? 0) > 0 ? { label: 'Search all items', onClick: () => update({ view: 'all' }) } : undefined}
    />
  ) : (
    <EmptyState
      icon={Inbox}
      title={EMPTY_VIEW[filters.view].title}
      description={EMPTY_VIEW[filters.view].description}
      action={filters.view !== 'all' ? { label: 'Show all →', onClick: () => update({ view: 'all' }) } : undefined}
    />
  )

  return (
    <div>
      <PageHeader
        title="Workflow queue"
        description={allRuns ? "Monitor and manage workflow executions" : "The workflow runs you're involved in, and every run of workflows shared with you"}
        actions={can('workflows.activate') ? <QueueActions /> : undefined}
      />
      {tabs}

      <div className="space-y-6">
        {/* Phones: three to a row (seven cards). */}
        <StatGrid className="max-sm:grid-cols-3">
          {STAT_CARDS.map((card) => {
            const n = countOf(card.statuses)
            const selected = selectedChip === card.chip
            return (
              <button
                key={card.chip}
                type="button"
                aria-pressed={selected}
                aria-label={`${card.label}: ${formatCount(n)}. ${selected ? 'Showing only these; select to show the whole view' : 'Show only these'}`}
                title={card.hint}
                onClick={() => (selected ? update({ statuses: [] }) : update({ view: viewForChip(card.chip), statuses: [card.chip] }))}
                className={cn('min-w-0 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-primary', selected && 'ring-2 ring-primary')}
              >
                <StatCard label={card.label} value={data ? formatCount(n) : '—'} tone={toneFor(card.tone, n)} className="h-full transition-colors hover:border-border-strong" />
              </button>
            )
          })}
        </StatGrid>

        <section aria-labelledby="queue-executions" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="queue-executions" className="text-base font-semibold text-fg">Executions</h2>
            {queue.isFetching && data && <span role="status" className="text-xs text-fg-muted">Updating…</span>}
          </div>

          <QueueFiltersBar
            filters={filters}
            update={update}
            replace={queue.replace}
            searchText={queue.searchText}
            setSearchText={queue.setSearchText}
            viewCounts={data?.viewCounts ?? null}
            facets={facets}
            advancedOpen={advancedOpen}
            setAdvancedOpen={setAdvancedOpen}
          />

          {data?.partial && (
            <InlineNotice tone="warning" message="Only the newest 200 items are searched until the latest database update is applied." />
          )}
          {queue.error && !data && <InlineNotice tone="error" message={queue.error.message || 'Could not load the queue.'} />}

          {!data ? (
            queue.error ? null : <Table label="Queue items"><TBody><TableSkeleton columns={6} /></TBody></Table>
          ) : (
            <QueueList
              rows={data.rows}
              page={filters.page}
              pageSize={filters.pageSize}
              total={data.total}
              onPageChange={(page) => update({ page })}
              onPageSizeChange={(pageSize) => update({ pageSize })}
              empty={empty}
            />
          )}
        </section>
      </div>
    </div>
  )
}
