/**
 * Headers for a workflow-built HTTP response (middleware / Respond to
 * webhook, app/api/webhooks/inbound). The workflow author chooses the status,
 * headers and body, but the response is served from the app's own origin, so
 * it must never be able to act as the app:
 *
 *  - no cookies (Set-Cookie could plant or overwrite the app's session
 *    cookies) and no security / transport headers (CSP, HSTS, framing,
 *    hop-by-hop, Content-Length — the server computes that);
 *  - every response is sandboxed (CSP `sandbox`: an opaque origin, no
 *    scripts) and never sniffed;
 *  - content a browser would run (HTML, XHTML, SVG, XML / XSL, or no type at
 *    all) is served as a download, so a cross-site form POST to a webhook
 *    cannot render an author's script on the app origin (stored XSS against
 *    whoever is lured to it, across workspaces).
 *
 * API callers (the reason middleware workflows exist) get the body unchanged.
 */

const BLOCKED = new Set([
  'set-cookie', 'set-cookie2',
  'content-security-policy', 'content-security-policy-report-only',
  'x-frame-options', 'x-content-type-options', 'strict-transport-security',
  'permissions-policy', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'cross-origin-resource-policy',
  'access-control-allow-credentials', 'clear-site-data', 'refresh', 'link',
  'connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length', 'te', 'trailer', 'proxy-authenticate',
])

/** Content types a browser renders as an active document. Empty = would be sniffed. */
export function isActiveContentType(contentType: string | null | undefined): boolean {
  const type = String(contentType ?? '').split(';')[0].trim().toLowerCase()
  if (!type) return true
  return type === 'text/html' || type === 'application/xhtml+xml' || type === 'image/svg+xml'
    || type === 'text/xml' || type === 'application/xml' || type === 'text/xsl' || type.endsWith('+xml')
    || type === 'multipart/x-mixed-replace'
}

export const WEBHOOK_RESPONSE_CSP = "sandbox; default-src 'none'; frame-ancestors 'none'"

export function safeWebhookResponseHeaders(input: Record<string, unknown> | null | undefined): Headers {
  const out = new Headers()
  for (const [key, value] of Object.entries(input ?? {})) {
    const name = String(key).trim()
    if (!name || BLOCKED.has(name.toLowerCase())) continue
    try {
      out.set(name, String(value ?? ''))
    } catch {
      // Invalid header name / value (CR, LF …): dropped, not a 500.
    }
  }
  out.set('Content-Security-Policy', WEBHOOK_RESPONSE_CSP)
  out.set('X-Content-Type-Options', 'nosniff')
  if (isActiveContentType(out.get('content-type'))) {
    const existing = out.get('content-disposition') ?? ''
    const filename = /filename\*?=[^;]+/i.exec(existing)?.[0]
    out.set('Content-Disposition', filename ? `attachment; ${filename}` : 'attachment')
  }
  return out
}

/** Largest accepted webhook body (env WEBHOOK_MAX_BODY_BYTES, default 5 MB). */
export function webhookMaxBodyBytes(): number {
  const value = Number(process.env.WEBHOOK_MAX_BODY_BYTES)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 5 * 1024 * 1024
}

/** Calls per webhook per minute (env WEBHOOK_RATE_LIMIT_PER_MINUTE, default 1200). */
export function webhookRateLimitPerMinute(): number {
  const value = Number(process.env.WEBHOOK_RATE_LIMIT_PER_MINUTE)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1200
}
