'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { serverQuery } from '@/lib/server-read'
import { usePermissions } from '@/lib/permissions-context'
import { useDebounced, useRealtime, useRealtimeUserId } from '@/hooks/use-realtime'
import type { NavCountsData } from '@/lib/nav-badges'

/** React Query key of the side menu's badge counts. */
export const NAV_COUNTS_QUERY_KEY = ['nav-counts'] as const

/**
 * The side menu's badge counts (one read: home.navCounts). Refetched on
 * window focus and every 60 s; `useNavCountsSync` (mounted once, in the
 * sidebar) also refreshes them on task changes.
 */
export function useNavCounts(): NavCountsData | null {
  const { can } = usePermissions()
  const enabled = can('tasks.view_own') || can('tasks.view_all')
  const { data } = useQuery({
    queryKey: NAV_COUNTS_QUERY_KEY,
    queryFn: async () => (await serverQuery('home.navCounts')) as NavCountsData,
    enabled,
    // Shown from the session cache straight away, then refreshed on every page load.
    staleTime: 0,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  })
  return enabled ? data ?? null : null
}

/** Query keys whose invalidation means a task was completed, claimed, accepted or changed. */
const TASK_KEYS: ReadonlySet<string> = new Set(['tasks', 'task-queue', 'task-detail', 'assigned-tasks', 'home', 'my-tasks', 'team-tasks'])

/**
 * Keeps the badges fresh (mount once): realtime changes to tasks assigned
 * to me or by me, and any invalidation of the task lists / Home (a task
 * completed, claimed or accepted anywhere in the app) refetch the counts.
 */
export function useNavCountsSync(): void {
  const queryClient = useQueryClient()
  const userId = useRealtimeUserId()
  const refresh = useDebounced(() => { void queryClient.invalidateQueries({ queryKey: NAV_COUNTS_QUERY_KEY }) }, 400)

  useRealtime('tasks', userId ? { column: 'assignee_id', value: userId } : null, refresh)
  useRealtime('tasks', userId ? { column: 'assigner_id', value: userId } : null, refresh)

  useEffect(() => queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'invalidate') return
    const head = event.query.queryKey[0]
    if (typeof head === 'string' && TASK_KEYS.has(head)) refresh()
  }), [queryClient, refresh])
}
