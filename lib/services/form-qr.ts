/**
 * The QR code of a form page link (the `forms.qr` read): the absolute URL
 * (lib/forms/form-page-url — the public app URL) as SVG, plain and with the
 * form's name and the URL as a caption. Any signed-in member: the code only
 * encodes the link (the page itself checks forms.submit). The form is read
 * with the member's own client in their workspace: a form they can't see
 * (another workspace's) is not found.
 */

import { getDb, ServiceError, type ServiceContext } from './context'
import { dbError } from './_shared'
import { appUrlOrLocalhost } from '@/lib/config/bootstrap'
import { publicAppOrigin, publicFormPageUrl } from '@/lib/forms/form-page-url'
import { qrSvg } from '@/lib/forms/qr'

/* eslint-disable @typescript-eslint/no-explicit-any -- forms is not in the generated Database types */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface FormQrCode {
  url: string
  /** The form's name. */
  name: string
  svg: string
  /** With the name and the URL under the code. */
  captioned_svg: string
}

export async function getFormQrCode(ctx: ServiceContext, formId: string): Promise<FormQrCode> {
  if (!UUID_RE.test(formId)) throw ServiceError.validation('Not a form id')
  // The unified "All organizations" view has no current tenant: RLS keeps it to the member's workspaces.
  let query = (getDb(ctx) as any).from('forms').select('id, name').eq('id', formId)
  if (ctx.tenantId) query = query.eq('tenant_id', ctx.tenantId)
  const { data, error } = await query.maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw ServiceError.notFound('Form not found')
  const name = String(data.name ?? '')
  const url = publicFormPageUrl(String(data.id), publicAppOrigin() || appUrlOrLocalhost().replace(/\/+$/, ''))
  return {
    url,
    name,
    svg: qrSvg(url),
    captioned_svg: qrSvg(url, { caption: { title: name, url } }),
  }
}
