/**
 * Host options of the embedded form (/embed/f/<id>), host-agnostic — an
 * add-in part, an SPFx web part or any page that frames it:
 *
 *   after         form (default: what the form itself does) | message | reset | redirect
 *   done_text     the thank-you text for `message` (≤ 300 characters)
 *   redirect_url  where `redirect` goes (http / https only), in the top window
 *   hide_title    1: no form header
 *   resize        0: fixed height (no resize messages; lib/embed/host-messages.ts)
 *
 * Pure and client-safe.
 */

export type AfterSubmit = 'form' | 'message' | 'reset' | 'redirect'

export interface EmbedFormOptions {
  after: AfterSubmit
  doneText: string | null
  redirectUrl: string | null
  hideTitle: boolean
}

type Query = Record<string, string | string[] | undefined> | URLSearchParams
const one = (q: Query, k: string) => (q instanceof URLSearchParams ? q.get(k) ?? undefined : Array.isArray(q[k]) ? (q[k] as string[])[0] : (q[k] as string | undefined))

/** An absolute http(s) URL without credentials, or null. */
export function safeRedirectUrl(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim()
  if (!value || value.length > 2000) return null
  try {
    const u = new URL(value)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password) return null
    return u.toString()
  } catch { return null }
}

export function parseEmbedFormOptions(query: Query): EmbedFormOptions {
  const after = one(query, 'after')
  const redirectUrl = safeRedirectUrl(one(query, 'redirect_url'))
  const doneText = String(one(query, 'done_text') ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 300) || null
  return {
    after: after === 'message' || after === 'reset' ? after : after === 'redirect' && redirectUrl ? 'redirect' : 'form',
    doneText,
    redirectUrl,
    hideTitle: /^(1|true|yes)$/i.test(one(query, 'hide_title') ?? ''),
  }
}
