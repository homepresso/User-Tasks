import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Suspense, cache } from 'react'
import { AnonymousFormView } from '@/components/forms/anonymous-form-view'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { FormLoading } from '@/components/forms/form-loading'
import { requestFrameContext } from '@/lib/forms/form-link-visitor'
import { wantsEmbed } from '@/lib/forms/embed'

/**
 * A public form link: the form filled in by visitors who are not signed in
 * (anonymous forms — lib/services/anonymous-forms.ts). The token is the
 * only thing in the URL; every unavailable link (unknown, rotated, the form
 * or the workspace switched off) is the same 404. The page carries the form
 * and nothing else of the workspace (no users, navigation or settings).
 * noindex unless the designer allowed indexing; never cached.
 *
 * Loading: the token is checked first (so an unavailable link is still a
 * real 404 status — no route-level loading.tsx, which would start streaming
 * before notFound()), then the form streams in behind a skeleton of the
 * form card (components/forms/form-loading.tsx; a compact spinner when
 * embedded).
 */

export const dynamic = 'force-dynamic'

const resolve = cache(async (token: string) => {
  const svc = await import('@/lib/services/anonymous-forms')
  return svc.resolveAnonymousForm(token)
})

const load = cache(async (token: string) => {
  const resolved = await resolve(token)
  if (!resolved) return null
  const svc = await import('@/lib/services/anonymous-forms')
  return svc.getAnonymousFormPage(resolved)
})

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params
  const page = await load(token)
  const index = page?.options.allow_indexing === true
  return {
    title: page?.form.name ?? 'Form not available',
    description: page?.form.description ?? undefined,
    robots: { index, follow: index },
    referrer: 'no-referrer',
    openGraph: page && index ? { title: page.form.name, description: page.form.description ?? undefined } : undefined,
  }
}

type Query = Record<string, string | string[] | undefined>

/** The form itself, once its page is loaded (streams in behind the fallback). */
async function PublicFormBody({ token, query, embed }: { token: string; query: Query; embed: boolean }) {
  const page = await load(token)
  if (!page) notFound()
  return <AnonymousFormView token={token} page={page} query={query} embed={embed} />
}

export default async function PublicFormPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Query> }) {
  const { token } = await params
  if (!(await resolve(token))) notFound()
  const query = await searchParams
  // Embedded in another site (?embed=1, or opened in a frame): the embedded look (lib/forms/embed.ts).
  const embed = wantsEmbed(query) || (await requestFrameContext()) !== 'top'
  const fallback = embed
    ? <EmbedFrame embed><FormLoading compact /></EmbedFrame>
    : <div className="py-2"><FormLoading /></div>
  return (
    <Suspense fallback={fallback}>
      <PublicFormBody token={token} query={query} embed={embed} />
    </Suspense>
  )
}
