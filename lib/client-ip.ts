/**
 * The client's IP address for rate limits, lockouts and audit — from the
 * proxy chain the deployment actually has, never the client-settable left
 * end of X-Forwarded-For.
 *
 * A reverse proxy that APPENDS (nginx `$proxy_add_x_forwarded_for`, Caddy,
 * Traefik — the self-hosting guide's setup) leaves whatever the client sent
 * on the left: taking the first entry let anyone pick a fresh "IP" per
 * request and never trip a per-IP limit (login, signup, password reset,
 * OAuth token, public forms, SCIM auth failures …).
 *
 * TRUSTED_PROXY_HOPS (default 1) is how many proxies in front of the app
 * append to X-Forwarded-For: the client is the entry that many places from
 * the right. Set 2 behind a CDN + nginx, 0 to ignore X-Forwarded-For and use
 * X-Real-IP only. On Vercel (which overwrites the header) the platform's
 * own x-vercel-forwarded-for / x-real-ip are used.
 */

type HeaderSource = { get(name: string): string | null }

export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS
  if (raw === undefined || raw.trim() === '') return 1
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 1
}

export function clientIpFrom(headers: HeaderSource): string | null {
  if (process.env.VERCEL) {
    const platform = headers.get('x-vercel-forwarded-for') ?? headers.get('x-real-ip') ?? headers.get('x-forwarded-for')
    const first = platform?.split(',')[0]?.trim()
    return first || null
  }
  const hops = trustedProxyHops()
  const chain = (headers.get('x-forwarded-for') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (hops > 0 && chain.length) {
    // Fewer entries than proxies: the left-most is the best we have.
    return chain[Math.max(0, chain.length - hops)] || null
  }
  return headers.get('x-real-ip')?.trim() || null
}

/** For a Request / NextRequest. */
export function clientIp(request: { headers: HeaderSource }): string | null {
  return clientIpFrom(request.headers)
}
