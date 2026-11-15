'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { markAllTasksRead, markTaskRead, markTaskUnread } from '@/app/actions/task-reads'
import { NAV_COUNTS_QUERY_KEY } from '@/hooks/use-nav-counts'
import { patchUnreadInData } from '@/lib/tasks/unread'

/**
 * Unread tasks in the browser (lib/services/task-reads on the server):
 * opening a task marks it read, rows can be marked unread, lists marked all
 * read. The cached task lists are patched at once (the dot goes / comes
 * back without a refetch) and the side menu's counts refetch.
 */

/** The task lists that carry `unread` (My tasks, Home, the tracker, Following, the team view). */
const LIST_KEYS = [['tasks'], ['home'], ['assigned-tasks'], ['task-follows'], ['team-tasks'], ['my-tasks']] as const

function patchLists(queryClient: QueryClient, ids: ReadonlySet<string> | 'all', unread: boolean) {
  for (const queryKey of LIST_KEYS) {
    queryClient.setQueriesData({ queryKey }, (data: unknown) => patchUnreadInData(data, ids, unread))
  }
}

function refreshCounts(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: NAV_COUNTS_QUERY_KEY })
}

/**
 * Mark the task read once it is open (the task page, the inline panel). Runs
 * once per task id per mount; `enabled` false waits (e.g. until it loaded).
 */
export function useMarkTaskReadOnOpen(taskId: string | null | undefined, enabled = true): void {
  const queryClient = useQueryClient()
  const done = useRef<string | null>(null)
  useEffect(() => {
    if (!taskId || !enabled || done.current === taskId) return
    done.current = taskId
    patchLists(queryClient, new Set([taskId]), false)
    void markTaskRead(taskId).then((result) => { if (result.ok) refreshCounts(queryClient) }, () => { /* the list keeps the dot until the next read */ })
  }, [taskId, enabled, queryClient])
}

/** Mark as read / unread and Mark all as read, with the lists patched optimistically. */
export function useTaskReadActions() {
  const queryClient = useQueryClient()

  const setUnread = useCallback(async (taskId: string, unread: boolean): Promise<{ ok: boolean; unread: boolean; error?: string }> => {
    patchLists(queryClient, new Set([taskId]), unread)
    const result = unread ? await markTaskUnread(taskId) : await markTaskRead(taskId)
    // The server's answer wins (a task I don't hold, or a closed one, stays read).
    patchLists(queryClient, new Set([taskId]), result.ok ? result.data.unread : !unread)
    refreshCounts(queryClient)
    return result.ok ? { ok: true, unread: result.data.unread } : { ok: false, unread: !unread, error: result.error }
  }, [queryClient])

  const markAllRead = useCallback(async (): Promise<{ ok: boolean; marked: number; error?: string }> => {
    patchLists(queryClient, 'all', false)
    const result = await markAllTasksRead()
    refreshCounts(queryClient)
    if (!result.ok) {
      for (const queryKey of LIST_KEYS) void queryClient.invalidateQueries({ queryKey })
      return { ok: false, marked: 0, error: result.error }
    }
    return { ok: true, marked: result.data.marked }
  }, [queryClient])

  return { setUnread, markAllRead }
}
