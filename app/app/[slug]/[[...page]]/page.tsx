import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { RESERVED_APP_SLUGS, SLUG_RE } from '@/lib/apps/schema'
import { appSignInRedirect, openHintedWorkspace } from '@/lib/apps/sign-in-server'
import { wantsEmbed, EMBED_PARAM } from '@/lib/forms/embed'
import { cleanOrgSlug, signInPageUrl } from '@/lib/forms/sign-in-page'
import { enforceHostWorkspace } from '@/lib/workspace-host'

/**
 * A friendly app link: /app/<slug>[/<page>] — the address to share with
 * people outside the builder team, as /form/<system name> is for forms.
 *
 *  - On a workspace address (acme.usertasks.com/app/<slug>) the slug
 *    resolves in that workspace only (enforceHostWorkspace switches a member
 *    to it). On the main address it resolves in the signed-in person's
 *    current workspace, as /form/<name> does; the share link of a workspace
 *    without its own address adds ?org=<workspace slug>, which names the
 *    workspace for the sign-in page and opens it after signing in (members
 *    only).
 *  - Signed in: on to the app (/apps/<slug>[/<page>], with the query), or
 *    with ?embed=1 the full-screen view (/embed/apps/…). The app's own
 *    audience check and published version apply there.
 *  - Signed out: the workspace sign-in page for apps (/sign-in), back here
 *    afterwards — whether or not the app exists, so slugs can't be probed.
 *  - Not a valid app address (reserved words, bad characters): 404.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'App', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>

function queryString(query: Query, drop: readonly string[] = []): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (drop.includes(key)) continue
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v)
  }
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

export default async function FriendlyAppPage({ params, searchParams }: { params: Promise<{ slug: string; page?: string[] }>; searchParams: Promise<Query> }) {
  const [{ slug, page }, query] = await Promise.all([params, searchParams])
  if (!SLUG_RE.test(slug) || RESERVED_APP_SLUGS.has(slug)) notFound()
  if (page && (page.length > 1 || !SLUG_RE.test(page[0]))) notFound()
  const pageSlug = page?.[0] ?? null
  const tail = `${slug}${pageSlug ? `/${pageSlug}` : ''}`
  const org = cleanOrgSlug(Array.isArray(query.org) ? query.org[0] : query.org)
  const embed = wantsEmbed(query)
  const self = `/app/${tail}${queryString(query)}`
  const target = `${embed ? '/embed/apps' : '/apps'}/${tail}${queryString(query, ['org', EMBED_PARAM])}`

  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'signed_out') redirect(signInPageUrl(self))
  if (host.kind === 'non_member') redirect('/no-access')
  if (host.kind === 'member') redirect(target)

  // The main address: the current workspace (or the ?org= one, for its members).
  const { getCachedUser } = await import('@/lib/supabase/server')
  const user = await getCachedUser()
  if (!user) redirect(appSignInRedirect(self, { org }))
  await openHintedWorkspace(user.id, org)
  redirect(target)
}
