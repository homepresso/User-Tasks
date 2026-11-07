/**
 * The QR code of a form page link (the `forms.qr` read): the absolute URL
 * (lib/forms/form-page-url — the public app URL) as SVG, plain and with the
 * form's name and the URL as a caption. Any signed-in member: the code only
 * encodes the link (the page itself checks forms.submit). The form is read
 * with the member's own client in their workspace: a form they can't see
 * (another workspace's) is not found.
 */

import { getDb, hasPerm, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { publicAppOrigin, publicFormPageUrl } from '@/lib/forms/form-page-url'
import { qrSvg } from '@/lib/forms/qr'
import { formUrlWithParams, layoutFormParams, type FormParam } from '@/lib/forms/form-params'
import { friendlyFormUrl } from '@/lib/workspace-address'
import { workspaceUrlFor } from './workspace-address'

/* eslint-disable @typescript-eslint/no-explicit-any -- forms is not in the generated Database types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FormLinkKind = 'friendly' | 'signed_in' | 'anonymous'

export interface FormQrCode {
  url: string
  /** Which link this code is: the friendly /form/<system name> link, /f/<id>, or the public /p/<token>. */
  kind: FormLinkKind
  /** The form's URL parameters (the link builder fills them in). */
  params: FormParam[]
  /** The form's name. */
  name: string
  svg: string
  /** With the name and the URL under the code. */
  captioned_svg: string
  /** The form has a live public (anonymous) link the caller may see (forms.view). */
  anonymous_available: boolean
  /** This code is the public (anonymous) link. */
  anonymous: boolean
  /** The form has a friendly link (the workspace has an address and the form a system name). */
  friendly_available: boolean
  /** Every link of the form, without parameters (the panel lists the others under the main one). */
  links: { friendly: string | null; signed_in: string; anonymous: string | null }
}

/**
 * `params`: values for the form's URL parameters (the link builder): only declared
 * URL parameters make it into the link, encoded by URLSearchParams.
 */
export async function getFormQrCode(ctx: ServiceContext, formId: string, params?: Record<string, string>, options: { anonymous?: boolean; kind?: FormLinkKind } = {}): Promise<FormQrCode> {
  if (!UUID_RE.test(formId)) throw ServiceError.validation('Not a form id')
  // The unified "All organizations" view has no current tenant: RLS keeps it to the member's workspaces.
  let query = (getDb(ctx) as any).from('forms').select('id, tenant_id, name, layout, system_name').eq('id', formId)
  if (ctx.tenantId) query = query.eq('tenant_id', ctx.tenantId)
  const { data, error } = await query.maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  const name = String(data.name ?? '')
  const declared = layoutFormParams(data.layout).filter((p) => p.source === 'url')
  const origin = publicAppOrigin() || appUrlOrLocalhost().replace(/\/+$/, '')
  // The public (anonymous) link: only people who can see the form's settings (forms.view) get its token.
  let anonymousPath: string | null = null
  if (hasPerm(ctx, 'forms.view') && ctx.tenantId) {
    const { getFormAnonymousAccess } = await import('./anonymous-forms')
    const access = await getFormAnonymousAccess(ctx, String(data.id)).catch(() => null)
    if (access?.live && access.path) anonymousPath = access.path
  }
  // The friendly link: https://<subdomain>.<base>/form/<system name> (the workspace's address).
  let friendly: string | null = null
  if (data.system_name) {
    const { data: tenant } = await (getDb(ctx) as any).from('tenants').select('subdomain').eq('id', data.tenant_id).maybeSingle()
    const workspaceUrl = workspaceUrlFor(tenant?.subdomain ?? null)
    if (workspaceUrl) friendly = friendlyFormUrl(workspaceUrl, String(data.system_name))
  }
  const kind: FormLinkKind = options.kind ?? (options.anonymous ? 'anonymous' : friendly ? 'friendly' : 'signed_in')
  if (kind === 'anonymous' && !anonymousPath) throw ServiceError.notFound('This form has no public link')
  if (kind === 'friendly' && !friendly) throw ServiceError.notFound('This form has no friendly link: the workspace needs an address')
  const links = { friendly, signed_in: publicFormPageUrl(String(data.id), origin), anonymous: anonymousPath ? `${origin}${anonymousPath}` : null }
  const base = kind === 'anonymous' ? links.anonymous! : kind === 'friendly' ? friendly! : links.signed_in
  const url = formUrlWithParams(base, declared, params ?? {})
  return {
    url,
    kind,
    friendly_available: Boolean(friendly),
    links,
    params: declared,
    name,
    svg: qrSvg(url),
    captioned_svg: qrSvg(url, { caption: { title: name, url } }),
    anonymous_available: Boolean(anonymousPath),
    anonymous: kind === 'anonymous',
  }
}
