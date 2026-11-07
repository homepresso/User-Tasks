/**
 * The absolute address of a form page (/f/<id>) for links people share and
 * QR codes: the instance's public app URL (getPublicConfig().appUrl — the
 * APP_URL / NEXT_PUBLIC_APP_URL the server was given), else the browser's
 * own origin. Isomorphic.
 */

import { getPublicConfig } from '@/lib/config/public'
import { classifyHost } from '@/lib/workspace-address'
import { formPagePath, formPageUrl } from './workflow-start-form'

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

/**
 * Whether this page is on a workspace address (acme.usertasks.com). Browser
 * only (false on the server, so links render as /f/<id> there).
 */
export function onWorkspaceAddress(): boolean {
  if (typeof window === 'undefined') return false
  let base: string | undefined
  try { base = getPublicConfig().baseDomain } catch { base = undefined }
  return classifyHost(window.location.host, base ?? null).kind === 'workspace'
}

/** The in-app page of a form: inside the dashboard shell (/fill/<id>). */
export function formAppPath(formId: string): string {
  return `/fill/${encodeURIComponent(formId)}`
}

/**
 * Where an in-app link to a form goes (the Forms menu, Home favourites,
 * search): the form inside the app, /fill/<id>. Links people share
 * (/f/<id>, /form/<system name>) open the form on its own page, without the
 * shell (docs/changes/standalone-forms.md).
 */
export function formHref(form: { id: string; system_name?: string | null }): string {
  return formAppPath(form.id)
}
