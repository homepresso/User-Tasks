/**
 * Form links in other websites (iframes). Dependency-free: proxy.ts,
 * next.config.ts, server pages and the share dialog all import it.
 *
 * Framing policy (docs/changes/standalone-forms.md):
 *  - Frameable by any site: the form link pages — /f/<id>, /form/<system
 *    name>, /p/<token> — and their sign-in page /form-login
 *    (CSP `frame-ancestors *`, no X-Frame-Options). Every other route keeps
 *    `frame-ancestors 'none'` + `X-Frame-Options: DENY`.
 *  - A signed-in session is only ever used at the top level or in a
 *    same-origin frame. In a frame from another origin the page treats the
 *    visitor as signed out (Fetch Metadata: Sec-Fetch-Dest / Sec-Fetch-Site),
 *    so a third-party page can never get a member to submit a form as
 *    themselves (clickjacking). Session cookies are SameSite=Lax, so
 *    browsers don't send them to cross-site frames anyway; the server-side
 *    check also covers other workspace addresses (same site, other origin).
 *  - Public forms (anonymous links) therefore embed anywhere. A form that
 *    needs sign-in shows "Open the form in a new tab to sign in" inside a
 *    frame from another site.
 */

/** Does this path serve a form link page that other sites may frame? */
export function isFrameableFormPath(pathname: string): boolean {
  if (pathname === '/form-login' || pathname === '/form-login/') return true
  return /^\/(?:f|form|p)\/[^/]+\/?$/.test(pathname)
}

/** `frame-ancestors` for a path: `*` for form link pages, else `'none'`. */
export function frameAncestorsFor(pathname: string): string {
  return isFrameableFormPath(pathname) ? '*' : "'none'"
}

/** The query flag that asks for the embedded look (`?embed=1`). */
export const EMBED_PARAM = 'embed'

/** Did the URL ask for the embedded look? */
export function wantsEmbed(query: Record<string, string | string[] | undefined> | URLSearchParams | null | undefined): boolean {
  if (!query) return false
  const raw = query instanceof URLSearchParams ? query.get(EMBED_PARAM) : query[EMBED_PARAM]
  const value = Array.isArray(raw) ? raw[0] : raw
  return value === '1' || value === 'true'
}

export type FrameContext = 'top' | 'same-origin-frame' | 'cross-origin-frame'

const FRAME_DESTS = new Set(['iframe', 'frame', 'embed', 'object', 'fencedframe'])

/**
 * Where this request will be shown, from its Fetch Metadata headers. A
 * browser that sends no Sec-Fetch-Dest (very old ones) counts as top level;
 * those also predate SameSite cookies being enforced, and frame-ancestors
 * still applies.
 */
export function frameContext(get: (name: string) => string | null | undefined): FrameContext {
  const dest = (get('sec-fetch-dest') ?? '').toLowerCase()
  if (!FRAME_DESTS.has(dest)) return 'top'
  return (get('sec-fetch-site') ?? '').toLowerCase() === 'same-origin' ? 'same-origin-frame' : 'cross-origin-frame'
}

/* ── Auto-height ─────────────────────────────────────────────────────── */

/** The message an embedded form posts to its host page when its height changes. */
export const RESIZE_MESSAGE_TYPE = 'usertasks:resize'

export interface ResizeMessage {
  type: typeof RESIZE_MESSAGE_TYPE
  /** The page's full height in CSS pixels. */
  height: number
  /** The page's own path (so a host with several forms can tell them apart). */
  path: string
}

export function resizeMessage(height: number, path: string): ResizeMessage {
  return { type: RESIZE_MESSAGE_TYPE, height: Math.max(0, Math.ceil(Number.isFinite(height) ? height : 0)), path }
}

export function isResizeMessage(data: unknown): data is ResizeMessage {
  return Boolean(data) && typeof data === 'object' && (data as ResizeMessage).type === RESIZE_MESSAGE_TYPE
    && typeof (data as ResizeMessage).height === 'number' && Number.isFinite((data as ResizeMessage).height)
}

/** `url` with `?embed=1` added (kept once). */
export function embedUrl(url: string): string {
  try {
    const u = new URL(url)
    u.searchParams.set(EMBED_PARAM, '1')
    return u.toString()
  } catch {
    return `${url}${url.includes('?') ? '&' : '?'}${EMBED_PARAM}=1`
  }
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The iframe snippet for a form link (the share dialog's Embed tab). */
export function iframeSnippet(url: string, title: string, options: { height?: number } = {}): string {
  const height = Math.max(200, Math.min(Math.round(options.height ?? 720), 4000))
  return `<iframe src="${escapeAttr(embedUrl(url))}" title="${escapeAttr(title || 'Form')}" width="100%" height="${height}" style="border:0;width:100%;max-width:100%" loading="lazy" allow="clipboard-write" data-usertasks-form></iframe>`
}

/**
 * The optional host-page script: sizes every UserTasks form iframe to its
 * content. It only trusts messages from the form's own origin and frame.
 */
export function resizeScriptSnippet(origin: string): string {
  const o = JSON.stringify(origin.replace(/\/+$/, ''))
  return `<script>
window.addEventListener("message", function (e) {
  if (e.origin !== ${o} || !e.data || e.data.type !== "${RESIZE_MESSAGE_TYPE}") return;
  document.querySelectorAll("iframe[data-usertasks-form]").forEach(function (f) {
    if (f.contentWindow === e.source) f.style.height = Math.ceil(e.data.height) + "px";
  });
});
</script>`
}
