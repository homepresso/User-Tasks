import type { Metadata } from 'next'
import { EmbedAnonymousForm } from '@/components/embed/embed-anonymous-form'

/**
 * Trusted embedding (lib/embedding.ts): /embed/p/<token> is a public form
 * link (/p/<token>) for a frame on an approved site, with the embedded form's
 * host options (lib/embed/form-options.ts) and events (usertasks:resize, the
 * add-in part message, usertasks:form). No sign-in, ever.
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Form', robots: { index: false, follow: false }, referrer: 'no-referrer' }

export default async function EmbeddedPublicFormPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { token } = await params
  return <EmbedAnonymousForm token={token} query={await searchParams} />
}
