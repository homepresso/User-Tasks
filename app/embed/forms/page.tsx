import type { Metadata } from 'next'
import { EmbedSignedOut, embedQueryString } from '@/components/embed/embed-signed-out'
import { EmbedFormPicker } from '@/components/embed/embed-form-picker'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { FormLinkNotice } from '@/components/forms/form-link-page'
import type { AvailableForm } from '@/lib/forms/available-forms'
import { enforceHostWorkspace } from '@/lib/workspace-host'

/**
 * Trusted embedding (lib/embedding.ts): /embed/forms is what a host shows
 * while its form setting is empty or wrong (host-agnostic: add-in part, SPFx
 * web part, any page builder):
 *   ?edit=1           the page is being edited → "Choose a form" (signed in; components/embed/embed-form-picker.tsx)
 *   (no edit)         a quiet notice: no form chosen yet
 *   ?problem=invalid  the setting isn't a form id or link
 *   ?problem=unavailable  the host's part can't be used here (e.g. not licensed): a plain notice, no sign-in
 *   ?paste_hint=…     the host's own words for where to paste the id (≤ 200 characters)
 */

export const dynamic = 'force-dynamic'

export const metadata: Metadata = { title: 'Choose a form', robots: { index: false, follow: false } }

type Query = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function EmbeddedFormPickerPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams
  const edit = /^(1|true|yes)$/i.test(one(query.edit) ?? '')
  const invalid = one(query.problem) === 'invalid'
  if (one(query.problem) === 'unavailable') {
    return <EmbedFrame embed><FormLinkNotice title="Not available" body="This UserTasks web part isn’t available on this installation. Ask your UserTasks administrator." /></EmbedFrame>
  }
  if (!edit) {
    return (
      <EmbedFrame embed>
        <FormLinkNotice
          title={invalid ? 'This form setting needs a look' : 'No form chosen yet'}
          body={invalid ? 'The form setting isn’t a UserTasks form id or form link. Edit the page to fix it.' : 'Edit the page to choose the UserTasks form shown here.'}
        />
      </EmbedFrame>
    )
  }
  const embedPath = `/embed/forms${embedQueryString(query)}`
  const host = await enforceHostWorkspace({ allowSignedOut: true })
  if (host.kind === 'non_member') {
    return <EmbedFrame embed><FormLinkNotice title="You can't choose a form here" body="You are signed in to UserTasks, but not as a member of this workspace." /></EmbedFrame>
  }
  let userId: string | null = host.kind === 'member' ? host.userId : null
  if (host.kind === 'none') {
    const { getCachedUser } = await import('@/lib/supabase/server')
    userId = (await getCachedUser())?.id ?? null
  }
  if (!userId) return <EmbedSignedOut embedPath={embedPath} appPath={embedPath} query={query} />

  const [{ fromSession, hasPerm }, svc] = await Promise.all([import('@/lib/services/context'), import('@/lib/services/forms')])
  const ctx = await fromSession()
  const byId = new Map<string, AvailableForm>()
  for (const f of await svc.listAvailableForms(ctx).catch(() => [])) byId.set(f.id, f)
  // People who see every form (forms.view: the form designers who build these pages) can pick any of them.
  if (hasPerm(ctx, 'forms.view')) {
    const all = await svc.listForms(ctx, {}, { limit: 300, offset: 0 }).catch(() => ({ forms: [] as Array<{ id: string; name: string; description: string | null; system_name: string | null; tags: string[] }> }))
    for (const f of all.forms) if (!byId.has(f.id)) byId.set(f.id, { id: f.id, name: f.name, description: f.description, system_name: f.system_name, tags: f.tags })
  }
  const forms = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  const hint = (one(query.paste_hint) ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200) || null
  return (
    <EmbedFrame embed>
      <EmbedFormPicker forms={forms} pasteHint={hint} />
    </EmbedFrame>
  )
}
