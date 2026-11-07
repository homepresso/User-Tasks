import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { MemberFormPage } from '@/components/forms/form-link-page'
import { formLinkUser, formLinkVisitor } from '@/lib/forms/form-link-visitor'
import { formLoginUrl } from '@/lib/forms/sign-in-page'

/**
 * A form link: /f/<id>, the form on its own page — no dashboard shell, so it
 * can be shared and embedded in other sites (?embed=1; lib/forms/embed.ts).
 * Signed-in members with forms.submit fill it in; anyone else signs in on
 * the workspace's form sign-in page (/form-login) and comes straight back.
 * The query string carries the form's URL parameters (/f/<id>?customer=ALFKI).
 * The app's own menus open forms in the shell at /fill/<id>.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Form', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>

export default async function FormLinkPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const query = await searchParams
  const visitor = await formLinkVisitor(query)
  if (visitor.host.kind === 'non_member' && visitor.frame !== 'cross-origin-frame') redirect('/no-access')
  const user = visitor.host.kind === 'non_member' ? null : await formLinkUser(visitor)
  if (!user) redirect(formLoginUrl(visitor.path, { embed: visitor.embed }))
  return <MemberFormPage formId={id} query={query} embed={visitor.embed} userId={user.id} />
}
