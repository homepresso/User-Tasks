import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { useEffect, useState } from 'react'
import { getCurrentTenantId } from '@/lib/get-user-id'
import { useDebounced, useRealtime } from '@/hooks/use-realtime'
import type { RealtimeFilter } from '@/lib/realtime/topics'

interface TaskFilters {
  status?: string[]
  priority?: string[]
  tenantId?: string | null
  dueRange?: 'overdue' | 'today' | 'week' | 'month' | null
  assigneeId?: string | null
  search?: string
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

/**
 * Due-range cutoff in the browser's local time (end of today/week/month),
 * as the list read's dueBefore (exclusive) / dueBy (inclusive) bound.
 */
function dueCutoff(dueRange: TaskFilters['dueRange']): { dueBefore?: string; dueBy?: string } {
  if (!dueRange) return {}
  const now = new Date()
  if (dueRange === 'overdue') return { dueBefore: now.toISOString() }
  if (dueRange === 'today') {
    const endOfDay = new Date(now)
    endOfDay.setHours(23, 59, 59, 999)
    return { dueBy: endOfDay.toISOString() }
  }
  if (dueRange === 'week') {
    const endOfWeek = new Date(now)
    endOfWeek.setDate(endOfWeek.getDate() + (7 - endOfWeek.getDay()))
    return { dueBy: endOfWeek.toISOString() }
  }
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  return { dueBy: endOfMonth.toISOString() }
}

export function useTasks(filters: TaskFilters) {
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<RealtimeFilter | null>(null)

  const query = useQuery({
    queryKey: ['tasks', filters],
    queryFn: () => serverQuery('tasks.list', {
      status: filters.status,
      priority: filters.priority,
      tenantId: filters.tenantId,
      ...dueCutoff(filters.dueRange),
      assigneeId: filters.assigneeId,
      search: filters.search,
      sortBy: filters.sortBy,
      sortDir: filters.sortDir,
    }),
  })

  // Scope to the current workspace — an unfiltered subscription refetched
  // this (often large) list for every task change in every tenant the
  // realtime policy exposes. Unified view (no current tenant): all of them.
  useEffect(() => {
    let cancelled = false
    getCurrentTenantId()
      .then((tenantId) => { if (!cancelled) setScope(tenantId ? { column: 'tenant_id', value: tenantId } : {}) })
      .catch(() => { /* tenant unknown → no subscription; polling covers it */ })
    return () => { cancelled = true }
  }, [])

  // Bursts (workflow runs touching many tasks) collapse into one refetch.
  const invalidate = useDebounced(() => queryClient.invalidateQueries({ queryKey: ['tasks'] }), 300)
  useRealtime('tasks', scope, invalidate)

  return query
}
