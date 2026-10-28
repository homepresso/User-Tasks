/**
 * The absolute address of a form page (/f/<id>) for links people share and
 * QR codes: the instance's public app URL (getPublicConfig().appUrl — the
 * APP_URL / NEXT_PUBLIC_APP_URL the server was given), else the browser's
 * own origin. Isomorphic.
 */

import { getPublicConfig } from '@/lib/config/public'
import { formPageUrl } from './workflow-start-form'

/** The app's public origin, no trailing slash ('' on a server without APP_URL). */
export function publicAppOrigin(): string {
  let configured = ''
  try { configured = String(getPublicConfig().appUrl ?? '').trim() } catch { configured = '' }
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/+$/, '')
  return typeof window === 'undefined' ? '' : window.location.origin
}

/** The shareable URL of a form page. */
export function publicFormPageUrl(formId: string, origin: string = publicAppOrigin()): string {
  return formPageUrl(origin, formId)
}
