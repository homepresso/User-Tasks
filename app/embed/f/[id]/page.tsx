import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { EmbedAutoSignIn, EmbedSignIn } from '@/components/embed/embed-sign-in'
import { autoSsoPath, cleanOrgHint, LAUNCH_ORG_PARAM, SSO_DONE_PATH } from '@/lib/providers/auth/sso/auto'
import { resolveAutoSso } from '@/lib/providers/auth/sso/auto-server'
import { FormLinkNotice, MemberFormPage } from '@/components/forms/form-link-page'
import { frameContext } from '@/lib/forms/embed'
import { enforceHostWorkspace } from '@/lib/workspace-host'

/**
 * Trusted embedding of a form (lib/embedding.ts): /embed/f/<id> is the
 * form link page /f/<id> for a frame on a site the operator approved
 * (EMBED_FRAME_ANCESTORS → frame-ancestors, set by proxy.ts) — e.g. a
 * SharePoint page that hosts the form for one of its lists. Unlike /f/<id>
 * in a frame from another site (always signed out, lib/forms/embed.ts), the
 * member's own session is used here, because only approved sites can frame
 * it. The embedded look (transparent, auto-height via `usertasks:resize`)
 * and the host events (`usertasks:form` submitted / cancelled, see
 * StandaloneForm) are always on. Signed out: at the top level → sign-in and
 * back to /f/<id>; in a frame → open UserTasks in a new tab.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Form', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>

function queryString(query: Query): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) for (const value of Array.isArray(v) ? v : v === undefined ? [] : [v]) q.append(k, value)
  const s = q.toString()
  return s ? `?${s}` : ''
}

export default async function EmbeddedFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const query = await searchParams
  const appPath = `/f/${encodeURIComponent(id)}${queryString(query)}`
  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'non_member') {
    return <FormLinkNotice title="You can't open this form" body="You are signed in to UserTasks, but not as a member of this workspace." />
  }
  let userId: string | null = host.kind === 'member' ? host.userId : null
  if (host.kind === 'none') {
    const { getCachedUser } = await import('@/lib/supabase/server')
    userId = (await getCachedUser())?.id ?? null
  }
  if (!userId) {
    const h = await headers()
    const where = frameContext((name) => h.get(name))
    // Automatic sign-in with the workspace's IdP (lib/providers/auth/sso/auto.ts), as /embed/x and the
    // embedded designers do: no UserTasks sign-in page when the IdP can sign the person in by itself.
    const auto = await resolveAutoSso({ org: cleanOrgHint(query[LAUNCH_ORG_PARAM]), purpose: 'launch' })
    if (where === 'top') redirect(auto ? autoSsoPath({ redirect: `/embed${appPath}`, org: auto.org }) : `/login?redirect=${encodeURIComponent(appPath)}`)
    const loginHref = auto ? autoSsoPath({ redirect: appPath, org: auto.org }) : `/login?redirect=${encodeURIComponent(appPath)}`
    if (auto) {
      return (
        <EmbedAutoSignIn
          idpName={auto.idpName}
          silentUrl={autoSsoPath({ redirect: SSO_DONE_PATH, org: auto.org, mode: 'frame' })}
          popupUrl={autoSsoPath({ redirect: SSO_DONE_PATH, org: auto.org, mode: 'popup' })}
          newTabHref={loginHref}
          reloadHref={`/embed${appPath}`}
        />
      )
    }
    return <EmbedSignIn loginHref={loginHref} reloadHref={`/embed${appPath}`} />
  }
  return <MemberFormPage formId={id} query={query} embed trusted userId={userId} />
}
