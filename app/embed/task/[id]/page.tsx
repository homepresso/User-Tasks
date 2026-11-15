import type { Metadata } from 'next'
import { EmbedSignedOut, embedQueryString } from '@/components/embed/embed-signed-out'
import { EmbedTaskShell } from '@/components/embed/embed-task-shell'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { FormLinkNotice } from '@/components/forms/form-link-page'
import { loadExtensionUiState } from '@/lib/extensions/ui-server'
import { enforceHostWorkspace } from '@/lib/workspace-host'

/**
 * Trusted embedding (lib/embedding.ts): /embed/task/<id> is the app's task
 * page (/tasks/<id>) without the app shell — the same component, checks and
 * actions — for a frame or dialog on an approved site, e.g. the task list's
 * dialog (/embed/tasks) in a SharePoint add-in part. It posts
 * `usertasks:task` { event: 'completed' } when the task closes and its
 * height (usertasks:resize). Signed out → automatic sign-in.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Task', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>

export default async function EmbeddedTaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const query = await searchParams
  const embedPath = `/embed/task/${encodeURIComponent(id)}${embedQueryString(query)}`
  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'non_member') {
    return <EmbedFrame embed><FormLinkNotice title="You can't open this task" body="You are signed in to UserTasks, but not as a member of this workspace." /></EmbedFrame>
  }
  let userId: string | null = host.kind === 'member' ? host.userId : null
  if (host.kind === 'none') {
    const { getCachedUser } = await import('@/lib/supabase/server')
    userId = (await getCachedUser())?.id ?? null
  }
  if (!userId) return <EmbedSignedOut embedPath={embedPath} appPath={`/tasks/${encodeURIComponent(id)}`} query={query} />
  const extensions = await loadExtensionUiState()
  return (
    <EmbedFrame embed>
      <EmbedTaskShell taskId={id} extensions={extensions} />
    </EmbedFrame>
  )
}
