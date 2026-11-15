'use client'

/**
 * The app's task page (app/(dashboard)/tasks/[id]) without the app shell,
 * for /embed/task/<id>: the same component, permissions and actions as in
 * the app — nothing re-implemented — inside the pieces of the shell it
 * needs (session, permissions, extensions, breadcrumbs, jobs). Tells the
 * page that frames it when the task closes (`usertasks:task` completed, from
 * the task's own query data), and keeps links to other app pages out of the
 * frame (they refuse to be framed): they open in a new tab.
 */

import { useEffect, useMemo, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import TaskDetailPage from '@/app/(dashboard)/tasks/[id]/page'
import { ExtensionsProvider } from '@/components/extensions/extensions-provider'
import { JobsProvider } from '@/components/jobs/jobs-provider'
import { DashboardAuthProvider, useDashboardAuth } from '@/lib/dashboard-auth-context'
import { BreadcrumbsProvider } from '@/lib/breadcrumbs-context'
import { PermissionsProvider } from '@/lib/permissions-context'
import { postToHost, taskEventMessage } from '@/lib/embed/host-messages'
import type { ExtensionUiState } from '@/lib/extensions/ui'

const CLOSED = new Set(['completed', 'cancelled'])

function useTaskClosedReporter(taskId: string) {
  const queryClient = useQueryClient()
  const wasOpen = useRef<boolean | null>(null)
  useEffect(() => {
    const read = () => {
      const data = queryClient.getQueryData<{ treeData?: { task?: { status?: string } } }>(['task-detail', taskId])
      const status = data?.treeData?.task?.status
      if (!status) return
      const open = !CLOSED.has(status)
      if (wasOpen.current === true && !open) postToHost(taskEventMessage('completed', taskId))
      wasOpen.current = open
    }
    read()
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === 'task-detail' && event.query.queryKey[1] === taskId) read()
    })
  }, [queryClient, taskId])
}

/** Links to app pages (not /embed/…) open in a new tab: those pages can't show in a frame. */
function useLinksOutOfFrame() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      const a = (event.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      let url: URL
      try { url = new URL(a.href, window.location.href) } catch { return }
      if (url.origin !== window.location.origin || url.pathname.startsWith('/embed/') || url.pathname.startsWith('/api/') || url.pathname.startsWith('/attachments/') || url.pathname.startsWith('/files/')) return
      event.preventDefault()
      window.open(url.toString(), '_blank', 'noopener')
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [])
}

function Inner({ taskId }: { taskId: string }) {
  const { profile, userId, permissions } = useDashboardAuth()
  useTaskClosedReporter(taskId)
  useLinksOutOfFrame()
  const params = useMemo(() => Promise.resolve({ id: taskId }), [taskId])
  // First paint before the session is confirmed: an empty, reserved area (no spinner).
  if (!profile || !userId) return <div className="min-h-[480px]" aria-hidden />
  return (
    <PermissionsProvider permissions={permissions} userId={userId}>
      <BreadcrumbsProvider resetKey={`/embed/task/${taskId}`}>
        <JobsProvider>
          <div className="p-3 md:p-4">
            <TaskDetailPage params={params} />
          </div>
        </JobsProvider>
      </BreadcrumbsProvider>
    </PermissionsProvider>
  )
}

export function EmbedTaskShell({ taskId, extensions }: { taskId: string; extensions: ExtensionUiState }) {
  return (
    <DashboardAuthProvider>
      <ExtensionsProvider initial={extensions}>
        <Inner taskId={taskId} />
      </ExtensionsProvider>
    </DashboardAuthProvider>
  )
}
