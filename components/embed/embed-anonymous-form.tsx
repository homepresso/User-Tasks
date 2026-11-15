import { PublicThemeReset } from '@/components/layout/public-theme-reset'
import { AnonymousFormView } from '@/components/forms/anonymous-form-view'
import { FormLinkNotice } from '@/components/forms/form-link-page'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { EmbedFormHost } from '@/components/embed/embed-form-host'
import { parseEmbedFormOptions } from '@/lib/embed/form-options'

type Query = Record<string, string | string[] | undefined>

/**
 * A public (anonymous) form inside a trusted-embedding page: /embed/p/<token>,
 * and /embed/f/<id> for a visitor who is not signed in when the form takes
 * anonymous responses through its friendly link. Every /p/ rule applies
 * (resolveAnonymousForm: switch, limits, captcha, tickets); the host options
 * and events are the member form's. Server component.
 */
export async function EmbedAnonymousForm({ token, query }: { token: string; query: Query }) {
  const svc = await import('@/lib/services/anonymous-forms')
  const resolved = await svc.resolveAnonymousForm(token).catch(() => null)
  const page = resolved ? await svc.getAnonymousFormPage(resolved).catch(() => null) : null
  if (!page) return <EmbedFrame embed><FormLinkNotice title="This form isn't available" body="The form may have been closed or its public link turned off." /></EmbedFrame>
  return (
    <EmbedFrame embed>
      <div data-public-form-layout className="text-fg">
        <PublicThemeReset />
        <EmbedFormHost options={parseEmbedFormOptions(query)}>
          <AnonymousFormView token={token} page={page} query={query} embed trusted />
        </EmbedFormHost>
      </div>
    </EmbedFrame>
  )
}
