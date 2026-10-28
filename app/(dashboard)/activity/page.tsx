'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { unwrapAction } from '@/lib/action-result'
import { listAuditActivity } from '@/app/actions/activity'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/page-skeleton'
import { Activity, Search, Filter } from 'lucide-react'
import { ActivityFeed, auditRowToActivityItem, type ActivityItem } from '@/components/activity/activity-feed'
import { usePermissions } from '@/lib/permissions-context'

const PAGE_SIZE = 50

const OBJECT_TYPES = [
  'workflow', 'agent', 'integration',
  'report', 'data_table', 'team', 'role', 'api_key',
]

const ACTIONS = [
  'create', 'update', 'delete', 'publish', 'unpublish', 'toggle',
  'execute', 'grant', 'revoke', 'duplicate', 'share',
]

export default function GlobalActivityPage() {
  const { can } = usePermissions()
  const [search, setSearch] = useState('')
  const [objectTypeFilter, setObjectTypeFilter] = useState<string>('')
  const [actionFilter, setActionFilter] = useState<string>('')
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery({
    queryKey: ['global-activity', objectTypeFilter, actionFilter, page],
    // Read server-side (lib/services/activity, settings.view).
    queryFn: async () => unwrapAction(await listAuditActivity({ objectType: objectTypeFilter || null, action: actionFilter || null, page })),
    enabled: can('settings.view'),
  })

  if (!can('settings.view')) {
    return <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Not authorized.</p>
  }

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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  if (isLoading && !data) {
    return <PageSkeleton variant="list" />
  }

  return (
    <div className="space-y-4 page-transition">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--theme-card-text)' }}>Activity</h1>
        <p className="text-xs mt-1" style={{ color: 'var(--theme-muted-text)' }}>
          Every create, update, delete, publish, and configuration change across the platform.
        </p>
      </div>

      {/* Filters */}
      <Card className="!p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--theme-muted-text)' }} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search summary, entity, actor..." className="pl-9" />
          </div>
          <select
            value={objectTypeFilter}
            onChange={(e) => { setObjectTypeFilter(e.target.value); setPage(0) }}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="">All entity types</option>
            {OBJECT_TYPES.map(t => <option key={t} value={t} className="capitalize">{t.replace(/_/g, ' ')}</option>)}
          </select>
          <select
            value={actionFilter}
            onChange={(e) => { setActionFilter(e.target.value); setPage(0) }}
            className="h-9 rounded-lg border px-3 text-xs"
            style={{ borderColor: 'var(--theme-surface-border)', backgroundColor: 'var(--theme-card-bg)', color: 'var(--theme-card-text)' }}
          >
            <option value="">All actions</option>
            {ACTIONS.map(a => <option key={a} value={a} className="capitalize">{a}</option>)}
          </select>
          {(objectTypeFilter || actionFilter || search) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => { setObjectTypeFilter(''); setActionFilter(''); setSearch(''); setPage(0) }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </Card>

      {/* Feed */}
      {isLoading ? (
        <Card className="!p-8 text-center">
          <p className="text-sm" style={{ color: 'var(--theme-muted-text)' }}>Loading activity...</p>
        </Card>
      ) : (
        <ActivityFeed
          items={items}
          emptyMessage={search || objectTypeFilter || actionFilter
            ? 'No activity matches your filters'
            : 'No audit entries recorded yet. Audit logging starts capturing events as users create, update, publish, and delete entities.'}
        />
      )}

      {/* Pagination */}
      {(data?.total ?? 0) > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--theme-muted-text)' }}>
          <span>Showing page {page + 1} of {totalPages} · {data?.total ?? 0} total events</span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={page + 1 >= totalPages} onClick={() => setPage(p => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
