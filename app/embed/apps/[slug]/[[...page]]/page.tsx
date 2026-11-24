import type { Metadata } from 'next'
import { EmbedSignedOut, embedQueryString } from '@/components/embed/embed-signed-out'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { FormLinkNotice } from '@/components/forms/form-link-page'
import { embedViewer } from '@/lib/apps/embed-viewer-server'
import { appSignInRedirect } from '@/lib/apps/sign-in-server'
import { LAUNCH_ORG_PARAM } from '@/lib/providers/auth/sso/auto'

/**
 * An app page without the UserTasks shell: /embed/apps/<slug>[/<page>] —
 * the "Full screen" view, and the URL a site the operator approved
 * (trusted embedding, lib/embedding.ts: frame-ancestors from
 * EMBED_FRAME_ANCESTORS / the workspace's list, set by proxy.ts for /embed/)
 * frames, e.g. the SharePoint web part (Phase 2). Signed-in members only:
 * signed out → the automatic sign-in of every embed page, else the
 * workspace sign-in page for apps (/sign-in; lib/apps/sign-in-server.ts —
 * in a frame from a new tab, back to this page); the app itself
 * is shown only to its audience and editors (lib/services/apps.ts).
 * ?menu=0 hides the app's own menu. For a member the app itself is drawn by
 * the layout (app/embed/apps/[slug]/layout.tsx), which stays mounted across
 * the app's pages; this page draws the notices for everyone else.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'App', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>

export default async function EmbeddedAppPage({ params, searchParams }: { params: Promise<{ slug: string; page?: string[] }>; searchParams: Promise<Query> }) {
  const [{ slug, page }, query] = await Promise.all([params, searchParams])
  const pageSlug = page?.[0] ?? null
  const embedPath = `/embed/apps/${encodeURIComponent(slug)}${pageSlug ? `/${encodeURIComponent(pageSlug)}` : ''}${embedQueryString(query)}`
  const viewer = await embedViewer()
  if (viewer.kind === 'non_member') {
    return <EmbedFrame embed><FormLinkNotice title="You can't see this app" body="You are signed in to UserTasks, but not as a member of this workspace." /></EmbedFrame>
  }
  if (viewer.kind === 'signed_out') {
    const orgParam = query.org ?? query[LAUNCH_ORG_PARAM]
    const signInHref = appSignInRedirect(embedPath, { onWorkspaceAddress: viewer.onWorkspaceAddress, org: Array.isArray(orgParam) ? orgParam[0] : orgParam })
    return <EmbedSignedOut embedPath={embedPath} appPath={embedPath} query={query} signInHref={signInHref} />
  }
  // A member: the app is drawn by the layout (app/embed/apps/[slug]/layout.tsx), which stays mounted across its pages.
  return null
}
