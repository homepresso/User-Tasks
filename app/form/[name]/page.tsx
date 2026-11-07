import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { cache } from 'react'
import PublicFormLayout from '@/app/p/layout'
import { FormLinkLayout, FormLinkNotice, MemberFormPage } from '@/components/forms/form-link-page'
import { AnonymousFormView } from '@/components/forms/anonymous-form-view'
import { formLinkUser, formLinkVisitor } from '@/lib/forms/form-link-visitor'
import { formLoginUrl } from '@/lib/forms/sign-in-page'
import { isValidSystemName } from '@/lib/forms/system-name'

/**
 * A friendly form link: /form/<system name> (lib/services/form-links.ts).
 *
 * On a workspace address (acme.usertasks.com) the name resolves in that
 * workspace — and only there: workspace A's address never serves workspace
 * B's form. On the apex (and on self-hosted installs without workspace
 * addresses) it resolves in the signed-in person's current workspace; a
 * visitor who isn't signed in has no workspace there, so they sign in first.
 *
 *  - Members: the same page as /f/<id> (forms.submit) — the form on its own,
 *    no dashboard shell, embeddable (?embed=1). The URL stays /form/<name>.
 *  - Earlier names (the form was renamed): redirect to the current name.
 *  - Visitors who aren't signed in: the /p/<token> rendering (same allowlist,
 *    rate limits, captcha and tickets) only when the form takes anonymous
 *    responses AND allows its friendly public link; otherwise the form
 *    sign-in page (/form-login) — whether or not the name exists, so names
 *    can't be probed.
 *  - In a frame from another origin the visitor always counts as signed out
 *    (lib/forms/embed.ts).
 */

export const dynamic = 'force-dynamic'

type Query = Record<string, string | string[] | undefined>

function withQuery(path: string, query: Query): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v)
  }
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** The anonymous page of a friendly link, or null (deduped between metadata and the page). */
const loadAnonymous = cache(async (tenantId: string, name: string) => {
  const links = await import('@/lib/services/form-links')
  const resolved = await links.resolveFormLink(tenantId, name)
  if (!resolved) return null
  const token = await links.friendlyAnonymousToken(tenantId, resolved.id)
  if (!token) return null
  if (resolved.kind === 'moved') return { kind: 'moved', moved: resolved.system_name } as const
  const svc = await import('@/lib/services/anonymous-forms')
  const anonymous = await svc.resolveAnonymousForm(token)
  if (!anonymous || anonymous.tenantId !== tenantId || anonymous.formId !== resolved.id) return null
  return { kind: 'page', token, page: await svc.getAnonymousFormPage(anonymous) } as const
})

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }): Promise<Metadata> {
  const { name } = await params
  const host = await formLinkVisitor({}).then((v) => v.host).catch(() => null)
  if ((host?.kind === 'signed_out' || host?.kind === 'non_member') && isValidSystemName(name)) {
    const anon = await loadAnonymous(host.tenant.id, name).catch(() => null)
    if (anon?.kind === 'page') {
      const index = anon.page.options.allow_indexing === true
      return { title: anon.page.form.name, description: anon.page.form.description ?? undefined, robots: { index, follow: index }, referrer: 'no-referrer' }
    }
  }
  return { title: 'Form', robots: { index: false, follow: false } }
}

export default async function FriendlyFormPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: Promise<Query> }) {
  const { name } = await params
  const query = await searchParams
  const visitor = await formLinkVisitor(query)
  const { host } = visitor
  const user = host.kind === 'signed_out' || host.kind === 'non_member' ? null : await formLinkUser(visitor)

  // A visitor who isn't signed in (or isn't a member), on a workspace address.
  if (host.kind === 'signed_out' || host.kind === 'non_member') {
    const anon = isValidSystemName(name) ? await loadAnonymous(host.tenant.id, name) : null
    if (anon?.kind === 'moved') redirect(withQuery(`/form/${anon.moved}`, query))
    if (anon?.kind === 'page') {
      return (
        <PublicFormLayout>
          <AnonymousFormView token={anon.token} page={anon.page} query={query} embed={visitor.embed} />
        </PublicFormLayout>
      )
    }
    if (host.kind === 'non_member') redirect('/no-access')
    redirect(formLoginUrl(visitor.path, { embed: visitor.embed }))
  }

  // Signed in: the address's workspace (enforceHostWorkspace made it current), else the current one.
  if (!user) redirect(formLoginUrl(visitor.path, { embed: visitor.embed }))
  let tenantId: string | null = host.kind === 'member' ? host.tenant.id : null
  if (!tenantId) {
    const { storedWorkspaceOf } = await import('@/lib/services/workspace-address')
    const stored = await storedWorkspaceOf(user.id)
    tenantId = stored.current ?? stored.home
  }
  if (!tenantId || !isValidSystemName(name)) notFound()
  const { resolveFormLink } = await import('@/lib/services/form-links')
  const resolved = await resolveFormLink(tenantId, name)
  if (!resolved) {
    return (
      <FormLinkLayout>
        <FormLinkNotice title="This form is not available" body="The link may have changed. Ask whoever shared it for a new link." />
      </FormLinkLayout>
    )
  }
  if (resolved.kind === 'moved') redirect(withQuery(`/form/${resolved.system_name}`, query))
  return <MemberFormPage formId={resolved.id} query={query} embed={visitor.embed} userId={user.id} />
}
