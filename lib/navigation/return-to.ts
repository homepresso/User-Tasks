/**
 * "Back to …" links into the designers from elsewhere (an extension page, a
 * SharePoint launch page): `?return_to=<app path>&return_label=<text>`.
 * Only same-origin app paths are accepted (no scheme, no `//host`, no
 * backslashes), so the link can never send someone to another site.
 */
export interface ReturnTo { href: string; label: string }

export function returnToFrom(get: (name: string) => string | null | undefined): ReturnTo | null {
  const href = String(get('return_to') ?? '').trim()
  if (!href || href.length > 2000 || !/^\/(?![/\\])/.test(href) || /[\\\r\n\t]/.test(href)) return null
  const label = String(get('return_label') ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return { href, label: label ? `Back to ${label}` : 'Back' }
}
