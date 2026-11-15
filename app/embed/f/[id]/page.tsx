import type { Metadata } from 'next'
import { unstable_rethrow } from 'next/navigation'
import { EmbedAnonymousForm } from '@/components/embed/embed-anonymous-form'
import { EmbedFormHost } from '@/components/embed/embed-form-host'
import { EmbedSignedOut } from '@/components/embed/embed-signed-out'
import { EmbedFrame } from '@/components/forms/embed-frame'
import { FormLinkNotice, MemberFormPage } from '@/components/forms/form-link-page'
import { parseEmbedFormOptions } from '@/lib/embed/form-options'
import { enforceHostWorkspace } from '@/lib/workspace-host'

/**
 * Trusted embedding of a form (lib/embedding.ts): /embed/f/<id> is the
 * form link page /f/<id> for a frame on a site the operator approved
 * (EMBED_FRAME_ANCESTORS → frame-ancestors, set by proxy.ts) — e.g. a
 * SharePoint page that hosts the form for one of its lists, an add-in part
 * or an SPFx web part. Unlike /f/<id> in a frame from another site (always
 * signed out, lib/forms/embed.ts), the member's own session is used here,
 * because only approved sites can frame it. The embedded look (transparent,
 * auto-height via `usertasks:resize`, the add-in part message with a
 * SenderId) and the host events (`usertasks:form`, see StandaloneForm) are
 * always on, with the host options of lib/embed/form-options.ts (after
 * submit, hide title, resize).
 *
 * Seamless inside the host page:
 *  - the form is prepared on the server in this request (definition, theme
 *    and the bound record's values — getSubmittableForm), so the first paint
 *    already has the fields: no client loading phase, no waterfall;
 *  - its height is reported on first paint, before hydration, and the page
 *    never scrolls itself while the host sizes the frame (resize ≠ 0);
 *  - light theme from the first byte (the host is a light page);
 *  - signed out: a form that takes anonymous responses (friendly link
 *    allowed) opens without sign-in; otherwise the workspace's automatic
 *    sign-in runs silently with nothing drawn (components/embed/embed-signed-out.tsx);
 *  - a real failure (no access, the form or the record is gone) is a short
 *    message with a link back (`Source`, the page the host came from).
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

/** The /p/ token of a form that allows anonymous responses through its friendly link, or null. */
async function anonymousTokenFor(formId: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(formId)) return null
  try {
    const [{ getServiceDb }, links] = await Promise.all([import('@/lib/providers/db'), import('@/lib/services/form-links')])
    const { data } = await (getServiceDb() as any).from('forms').select('tenant_id').eq('id', formId).maybeSingle() // eslint-disable-line @typescript-eslint/no-explicit-any
    return data?.tenant_id ? await links.friendlyAnonymousToken(String(data.tenant_id), formId) : null
  } catch { return null }
}

/** The page the host came from (`Source`), as a link back — http(s) only. */
function backLink(query: Query): string | null {
  const raw = Array.isArray(query.Source) ? query.Source[0] : query.Source
  if (!raw) return null
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

/** The host sizes the frame (resize ≠ 0): the page then never scrolls itself (no scrollbar flash). */
function hostSizes(query: Query): boolean {
  const raw = Array.isArray(query.resize) ? query.resize[0] : query.resize
  return raw !== '0'
}

/** Light theme from the first byte inside a host page (no dark flash from a stored app preference). */
const LIGHT = "try{document.documentElement.setAttribute('data-theme-mode','light')}catch(e){}"

/**
 * The page's height on first paint, before hydration (the server-rendered
 * fields are already there and the stylesheets applied): the host sizes the
 * frame at once. EmbedFrame keeps reporting every change after hydration.
 */
const FIRST_HEIGHT = "try{if(window.parent!==window){var b=document.querySelector('[data-embed-frame]');var h=Math.ceil(b?b.getBoundingClientRect().height:document.documentElement.scrollHeight);if(h>0)window.parent.postMessage({type:'usertasks:resize',height:h,path:location.pathname},'*')}}catch(e){}"

function Problem({ title, body, back }: { title: string; body: string; back: string | null }) {
  return (
    <EmbedFrame embed trusted>
      <div className="mx-auto max-w-xl px-1 py-4 text-sm" role="alert" data-embed-problem style={{ fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-muted-foreground">{body}</p>
        {back && <p className="mt-3"><a className="underline text-primary-text" href={back} target="_top">Back to the list</a></p>}
      </div>
    </EmbedFrame>
  )
}

export default async function EmbeddedFormPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Query> }) {
  const { id } = await params
  const query = await searchParams
  const appPath = `/f/${encodeURIComponent(id)}${queryString(query)}`
  const back = backLink(query)
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
    // A form that takes anonymous responses through its friendly link: no sign-in at all.
    const token = await anonymousTokenFor(id)
    if (token) return <EmbedAnonymousForm token={token} query={query} />
    // Otherwise automatic sign-in, silent and without drawing anything; else sign in in a new tab.
    return (
      <>
        <script dangerouslySetInnerHTML={{ __html: LIGHT }} />
        <EmbedSignedOut embedPath={`/embed${appPath}`} appPath={appPath} query={query} quiet />
      </>
    )
  }
  // The form for this request, prepared on the server (the record included): the first paint has the fields.
  let initialForm
  try {
    const [{ fromSession }, { getSubmittableForm }] = await Promise.all([import('@/lib/services/context'), import('@/lib/services/form-submissions')])
    initialForm = await getSubmittableForm(await fromSession(), id, { query })
  } catch (error) {
    unstable_rethrow(error)
    const status = (error as { status?: number })?.status
    const code = (error as { code?: string })?.code
    if (code === 'forbidden' || status === 403) return <Problem title="You can't open this form" body="Your access in UserTasks doesn't include this form. Ask whoever manages it." back={back} />
    if (code === 'not_found' || status === 404) return <Problem title="This form isn't available" body="It may have been deleted, or the item it opens no longer exists." back={back} />
    return <Problem title="The form could not open" body={error instanceof Error && error.message.length < 300 ? error.message : 'Something went wrong. Try again in a moment.'} back={back} />
  }
  // The outer EmbedFrame keeps the page transparent and sized when the host wrapper replaces the form (thank-you message).
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: LIGHT }} />
      <EmbedFrame embed trusted={hostSizes(query)}>
        <EmbedFormHost options={parseEmbedFormOptions(query)}>
          <MemberFormPage formId={id} query={query} embed trusted userId={userId} initialForm={initialForm} />
        </EmbedFormHost>
      </EmbedFrame>
      <script dangerouslySetInnerHTML={{ __html: FIRST_HEIGHT }} />
    </>
  )
}
