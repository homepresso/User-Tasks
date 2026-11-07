'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { unwrapAction } from '@/lib/action-result'
import { listAuditActivity } from '@/app/actions/activity'
import { SearchInput } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/ui/page-header'
import { PageSkeleton, ListSkeleton } from '@/components/ui/page-skeleton'
import { ActivityFeed, auditRowToActivityItem, type ActivityItem } from '@/components/activity/activity-feed'
import { usePermissions } from '@/lib/permissions-context'
import { AUDIT_ACTION_LABELS, AUDIT_OBJECT_TYPE_LABELS } from '@/lib/audit-labels'
import { formatCount } from '@/lib/format/number'
import { plural } from '@/lib/format/plural'

const PAGE_SIZE = 50

const OBJECT_TYPES = Object.keys(AUDIT_OBJECT_TYPE_LABELS)

const ACTIONS = Object.keys(AUDIT_ACTION_LABELS)

export default function GlobalActivityPage() {
  const { can } = usePermissions()
  const [search, setSearch] = useState('')
  const [objectTypeFilter, setObjectTypeFilter] = useState<string>('')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [page, setPage] = useState(0)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['global-activity', objectTypeFilter, actionFilter, page],
    // Read server-side (lib/services/activity, settings.view).
    queryFn: async () => unwrapAction(await listAuditActivity({ objectType: objectTypeFilter || null, action: actionFilter || null, page })),
    enabled: can('settings.view'),
  })

  const items = useMemo<ActivityItem[]>(() => {
    const rows: any[] = data?.rows ?? []
    const mapped: ActivityItem[] = rows.map((r) => auditRowToActivityItem(r))
    if (!search.trim()) return mapped
    const q = search.toLowerCase()
    return mapped.filter((item: ActivityItem) =>
      item.summary.toLowerCase().includes(q) ||
      item.objectType.toLowerCase().includes(q) ||
      (item.actor ?? '').toLowerCase().includes(q)
    )
  }, [data, search])

  if (!can('settings.view')) {
    return <EmptyState variant="error" title="Not authorized" description="You need settings access to see workspace activity." />
  }

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const filtered = Boolean(objectTypeFilter || actionFilter || search)

  if (isLoading && !data) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4 page-transition">
      <PageHeader
        className="mb-2"
        title="Activity"
        description="Every create, update, delete, publish and configuration change across the platform."
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filters">
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Search summary, entity, actor…"
          aria-label="Search activity"
          wrapperClassName="min-w-[240px] flex-1"
        />
        <Select
          wrapperClassName="w-auto"
          aria-label="Entity type"
          value={objectTypeFilter}
          onChange={(e) => { setObjectTypeFilter(e.target.value); setPage(0) }}
        >
          <option value="">All entity types</option>
          {OBJECT_TYPES.map(t => <option key={t} value={t}>{AUDIT_OBJECT_TYPE_LABELS[t]}</option>)}
        </Select>
        <Select
          wrapperClassName="w-auto"
          aria-label="Action"
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
        >
          <option value="">All actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{AUDIT_ACTION_LABELS[a]}</option>)}
        </Select>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setObjectTypeFilter(''); setActionFilter(''); setSearch(''); setPage(0) }}
          >
            Clear filters
          </Button>
        )}
      </div>

      {/* Feed */}
      {isError ? (
        <EmptyState variant="error" title="Couldn’t load activity" description={error instanceof Error ? error.message : undefined}
          action={{ label: 'Try again', onClick: () => void refetch() }} />
      ) : isLoading ? (
        <ListSkeleton rows={8} />
      ) : (
        <ActivityFeed
          items={items}
          emptyMessage={filtered
            ? 'No activity matches your filters'
            : 'No audit entries yet — they appear as people create, update, publish and delete things.'}
        />
      )}

      {/* Pagination */}
      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-fg-muted">
          <span className="num">Page {formatCount(page + 1)} of {formatCount(totalPages)} · {plural(data?.total ?? 0, 'event')}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
