import type { Metadata } from 'next'
import { EmbedSignedOut, embedQueryString } from '@/components/embed/embed-signed-out'
import { EmbedTaskList } from '@/components/embed/embed-task-list'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { FormLinkNotice } from '@/components/forms/form-link-page'
import { parseTaskListOptions } from '@/lib/embed/task-list'
import { enforceHostWorkspace } from '@/lib/workspace-host'

/**
 * Trusted embedding (lib/embedding.ts): /embed/tasks is the signed-in
 * person's task list for a frame on an approved site (frame-ancestors from
 * EMBED_FRAME_ANCESTORS / the workspace's list, set by proxy.ts) — an
 * intranet page, a SharePoint add-in part, an SPFx web part: all frame this
 * URL with the same query options (lib/embed/task-list.ts) and get the same
 * messages (lib/embed/host-messages.ts: usertasks:resize, the add-in part
 * resize message when the URL has a SenderId, usertasks:task). Signed out →
 * automatic sign-in (components/embed/embed-signed-out.tsx). The first page
 * is rendered here, so the frame paints with the list.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'My tasks', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>

/** Host parameters carried along (never options): the workspace hint and the add-in part sender id. */
function hostParams(query: Query): Record<string, string> {
  const out: Record<string, string> = {}
  for (const key of ['ut_org', 'SenderId']) {
    const v = query[key]
    const value = Array.isArray(v) ? v[0] : v
    if (typeof value === 'string' && value.length <= 200) out[key] = value
  }
  return out
}

export default async function EmbeddedTasksPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams
  const embedPath = `/embed/tasks${embedQueryString(query)}`
  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'non_member') {
    return <EmbedFrame embed><FormLinkNotice title="You can't see these tasks" body="You are signed in to UserTasks, but not as a member of this workspace." /></EmbedFrame>
  }
  let userId: string | null = host.kind === 'member' ? host.userId : null
  if (host.kind === 'none') {
    const { getCachedUser } = await import('@/lib/supabase/server')
    userId = (await getCachedUser())?.id ?? null
  }
  if (!userId) return <EmbedSignedOut embedPath={embedPath} appPath={embedPath} query={query} />

  const options = parseTaskListOptions(query)
  const [{ fromSession }, svc] = await Promise.all([import('@/lib/services/context'), import('@/lib/services/embed-tasks')])
  const initial = await fromSession().then((ctx) => svc.listEmbedTab(ctx, options)).catch(() => null)
  return (
    <EmbedFrame embed>
      <div className="p-1">
        <EmbedTaskList initialOptions={options} initial={initial} keep={hostParams(query)} />
      </div>
    </EmbedFrame>
  )
}
