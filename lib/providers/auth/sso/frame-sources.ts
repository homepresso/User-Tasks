/**
 * Where an automatic sign-in inside a trusted-embedding frame may navigate
 * its hidden frame (lib/providers/auth/sso/auto.ts,
 * components/embed/embed-sign-in.tsx): this instance's identity providers'
 * sign-in origins. Embeddable pages get `frame-src 'self' <these origins>`
 * (proxy.ts) instead of falling back to `default-src 'self'`, which would
 * block the hidden frame's redirect to the IdP. Every other page keeps no
 * frame-src (default-src 'self').
 *
 * Dependency-free: the server writes the list whenever it parses the SSO
 * providers (and at startup, instrumentation.ts); the proxy, bundled
 * separately, reads it from globalThis.
 */

const SLOT = Symbol.for('usertasks.ssoFrameSources')
const holder = globalThis as unknown as { [SLOT]?: { configured: string[]; discovered: string[] } }

/** `scheme://host[:port]` of a URL, or null (http / https only, no credentials). */
export function frameSourceOrigin(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    if (u.username || u.password) return null
    return u.origin
  } catch {
    return null
  }
}

const origins = (urls: Array<string | null | undefined>) => [...new Set(urls.map(frameSourceOrigin).filter((o): o is string => Boolean(o)))]

/**
 * The configured IdPs' origins (replaces the list). When the configured set
 * changes, origins learnt from discovery / metadata are forgotten too, so a
 * removed IdP doesn't stay allowed.
 */
export function writeSsoFrameSources(urls: Array<string | null | undefined>): void {
  const configured = origins(urls)
  const before = holder[SLOT]
  const same = before && before.configured.length === configured.length && before.configured.every((o) => configured.includes(o))
  holder[SLOT] = { configured, discovered: same ? before.discovered : [] }
}

/** Origins learnt at run time (a discovered authorization endpoint, a metadata sign-on URL). */
export function addSsoFrameSources(urls: Array<string | null | undefined>): void {
  const current = holder[SLOT] ?? { configured: [], discovered: [] }
  holder[SLOT] = { configured: current.configured, discovered: origins([...current.discovered, ...urls]) }
}

export function readSsoFrameSources(): string[] {
  const current = holder[SLOT]
  return current ? [...new Set([...current.configured, ...current.discovered])] : []
}

/** The frame-src directive value for an embeddable page. */
export function embedFrameSrc(list: string[] = readSsoFrameSources()): string {
  return ["'self'", ...list].join(' ')
}
