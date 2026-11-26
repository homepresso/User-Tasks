/**
 * A form's own logo choice on its branded sign-in page (/form-login,
 * /sign-in for form links, embeds included). The workspace-wide setting
 * (Settings → Sign-in page, `logo_url`) stays the default; a form whose
 * header (lib/forms/header.ts) is on and names an image carries it over:
 *
 *   header off / absent, or image 'default'  → inherit (the workspace setting)
 *   image 'none'                             → no logo (the workspace name only)
 *   image 'upload' with its image            → that image
 *   image 'workspace_logo'                   → the workspace theme's logo (inherit when there is none)
 *
 * Pure and isomorphic.
 */

import { normalizeFormHeader } from './header'

export type FormSignInLogo = { kind: 'inherit' } | { kind: 'none' } | { kind: 'image'; url: string }

export function formSignInLogo(rawHeader: unknown, workspaceLogo: string | null | undefined): FormSignInLogo {
  const header = normalizeFormHeader(rawHeader)
  if (!header?.enabled) return { kind: 'inherit' }
  if (header.image === 'none') return { kind: 'none' }
  if (header.image === 'upload' && header.image_url) return { kind: 'image', url: header.image_url }
  if (header.image === 'workspace_logo' && workspaceLogo) return { kind: 'image', url: workspaceLogo }
  return { kind: 'inherit' }
}

/** The logo the page draws (an unresolved reference) and whether to hide every logo, given the workspace setting. */
export function signInLogoFor(choice: FormSignInLogo, workspaceSetting: string | null): { logo: string | null; noLogo: boolean } {
  if (choice.kind === 'none') return { logo: null, noLogo: true }
  if (choice.kind === 'image') return { logo: choice.url, noLogo: false }
  return { logo: workspaceSetting, noLogo: false }
}

/** The system name in a /form/<name> return path (friendly links), or null. */
export function formNameOfReturnPath(path: string | null): string | null {
  const m = /^\/form\/([A-Za-z0-9._~-]{1,120})(?:\?|$)/.exec(path ?? '')
  return m ? m[1] : null
}
