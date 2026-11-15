import { readSettingsCacheStale } from './config/settings-cache'

/**
 * Trusted embedding: which other sites (e.g. an intranet portal or a
 * SharePoint farm) may show UserTasks pages in a frame or dialog.
 *
 *   EMBED_FRAME_ANCESTORS / instance.embed_frame_ancestors
 *     Origins, one per entry: `https://intranet.contoso.com`,
 *     `https://intranet.contoso.com:8443`, `https://*.contoso.com` (any
 *     subdomain), `http://sharepoint` (plain http only when listed so). No
 *     paths, no bare `*`, no schemes on their own, no CSP keywords.
 *
 * What it opens (and nothing else):
 *  - Embeddable routes only — the trusted-embedding pages under /embed/
 *    (extension pages a manifest declares `embeddable`, rendered without the
 *    app shell) — answer with `frame-ancestors 'self' <origins>` and no
 *    X-Frame-Options. Every other page keeps `frame-ancestors 'none'` +
 *    `X-Frame-Options: DENY` (the public form link pages keep their own
 *    policy, lib/forms/embed.ts).
 *  - Framed sessions: the session cookies are sent as `SameSite=None;
 *    Secure` (so a member signed in to UserTasks is signed in inside the
 *    frame too) — only when origins are configured AND cookies are Secure
 *    (the app runs on https). Because None would also attach the session to
 *    cross-site requests that SameSite=Lax used to keep it from, the proxy
 *    strips the session cookies from every cross-site request that Lax would
 *    not have carried them on (sessionCookiesAllowed below), except the
 *    framed GET navigation of an embeddable route itself. Cross-site POSTs,
 *    subresource loads and fetches therefore stay signed out exactly as
 *    before; server actions additionally keep Next's Origin check.
 *  - Automatic sign-in inside a frame (lib/providers/auth/sso/auto.ts,
 *    components/embed/embed-sign-in.tsx): a signed-out embeddable page runs
 *    a passive SSO round trip in a hidden frame. Its SSO flow-binding cookie
 *    is SameSite=None (Secure) so the frame can store and send it; that
 *    cookie is a random per-flow value checked against the flow's stored
 *    hash (login-CSRF protection), not a credential, and is not one of the
 *    session cookies stripped below. The session it ends with is issued like
 *    any other (SameSite=None under the rules above). The round trip ends on
 *    /embed/auth/sso-done, an embeddable route, which only tells its parent
 *    or opener (same origin, postMessage) "signed in: yes / no". Nothing in
 *    the frame — and nothing the embedding site sends — names the user: only
 *    the IdP's signed answer does.
 *    Embeddable pages carry `frame-src 'self' <IdP sign-in origins>`
 *    (lib/providers/auth/sso/frame-sources.ts) so that hidden frame may
 *    reach the identity provider; other pages keep default-src 'self'.
 *
 * The environment wins over the instance setting.
 *
 * Per-workspace lists (multi-tenant instances such as the cloud edition,
 * EMBED_WORKSPACE_ORIGINS=true): each workspace approves its own sites
 * (tenants.settings.embedding.frame_ancestors, Settings → Trusted
 * embedding). The proxy never reads the database for it: UserTasks sends
 * browsers to embeddable pages with a short-lived signed token listing that
 * workspace's origins, valid only on that workspace's own address
 * (lib/embedding-token.ts). With the switch on, framed sessions apply
 * instance-wide (the proxy cannot tell which workspaces embed), and so does
 * the cookie stripping below — which keeps the CSRF properties of SameSite=
 * Lax for every request, embedding or not.
 *
 * Dependency-free apart from the settings cache, so proxy.ts can import it.
 */

export const EMBED_FRAME_ANCESTORS_ENV = 'EMBED_FRAME_ANCESTORS'
export const EMBED_FRAME_ANCESTORS_SETTING = 'instance.embed_frame_ancestors'
/** Routes other (approved) sites may frame. */
export const EMBED_PATH_PREFIX = '/embed/'

export type EmbedListSource = 'env' | 'setting' | 'none'

export interface EmbedPolicy {
  /** Normalised origins allowed to frame embeddable routes. */
  origins: string[]
  source: EmbedListSource
  /** Entries that didn't parse (ignored), for display. */
  invalid: string[]
}

const HOST_RE = /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/
const IPV6_RE = /^\[[0-9a-f:.]+\]$/

/**
 * One allowed frame ancestor, normalised to `scheme://host[:port]` (lower
 * case, default port dropped), or an error message.
 */
export function parseFrameAncestor(raw: string): { origin: string } | { error: string } {
  const entry = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!entry) return { error: 'empty entry' }
  if (/[\s;,'"]/.test(entry)) return { error: `"${entry}": spaces, quotes, commas and semicolons are not allowed` }
  const m = /^(https?):\/\/([^/?#@]+)$/i.exec(entry)
  if (!m) return { error: `"${entry}": use an origin such as https://intranet.example.com (scheme and host, no path)` }
  const scheme = m[1].toLowerCase()
  let hostPort = m[2].toLowerCase()
  let port = ''
  const portMatch = /^(.*):(\d{1,5})$/.exec(hostPort)
  if (portMatch && !hostPort.endsWith(']')) {
    hostPort = portMatch[1]
    port = portMatch[2]
    const n = Number(port)
    if (n < 1 || n > 65535) return { error: `"${entry}": invalid port` }
    if ((scheme === 'https' && n === 443) || (scheme === 'http' && n === 80)) port = ''
  }
  const host = hostPort
  if (host === '*' || host.startsWith('*') && !host.startsWith('*.')) return { error: `"${entry}": a bare * is not allowed (name the sites)` }
  if (!HOST_RE.test(host) && !IPV6_RE.test(host)) return { error: `"${entry}": invalid host name` }
  if (host.startsWith('*.') && host.split('.').length < 3) return { error: `"${entry}": a wildcard needs a domain with at least two labels (https://*.example.com)` }
  return { origin: `${scheme}://${host}${port ? `:${port}` : ''}` }
}

/** Entries of a raw value: a string (comma / whitespace separated) or a string array. */
export function embedListEntries(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim()).filter(Boolean)
  if (typeof value === 'string') return value.split(/[\s,]+/).map((v) => v.trim()).filter(Boolean)
  return []
}

/** Parse a list (lenient: bad entries are reported, not thrown). */
export function parseEmbedList(value: unknown): { origins: string[]; errors: string[] } {
  const origins: string[] = []
  const errors: string[] = []
  for (const entry of embedListEntries(value)) {
    const parsed = parseFrameAncestor(entry)
    if ('error' in parsed) errors.push(parsed.error)
    else if (!origins.includes(parsed.origin)) origins.push(parsed.origin)
  }
  return { origins, errors }
}

/** Normalise a list for storage; throws on the first invalid entry. */
export function normaliseEmbedList(value: unknown): string[] {
  const { origins, errors } = parseEmbedList(value)
  if (errors.length) throw new Error(errors[0])
  return origins
}

/** The policy from an environment and stored settings (pure). */
export function resolveEmbedPolicy(env: Record<string, string | undefined>, settings: Map<string, unknown> | null): EmbedPolicy {
  const fromEnv = env[EMBED_FRAME_ANCESTORS_ENV]
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    const { origins, errors } = parseEmbedList(fromEnv)
    return { origins, source: 'env', invalid: errors }
  }
  const stored = settings?.get(EMBED_FRAME_ANCESTORS_SETTING)
  if (embedListEntries(stored).length) {
    const { origins, errors } = parseEmbedList(stored)
    return { origins, source: 'setting', invalid: errors }
  }
  return { origins: [], source: 'none', invalid: [] }
}

export const EMBED_WORKSPACE_ORIGINS_ENV = 'EMBED_WORKSPACE_ORIGINS'

/** Per-workspace embedding is on for this instance (EMBED_WORKSPACE_ORIGINS=true). */
export function workspaceEmbeddingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env[EMBED_WORKSPACE_ORIGINS_ENV] ?? '').trim())
}

/** Synchronous: environment + the last loaded instance settings. */
export function getEmbedPolicy(): EmbedPolicy {
  return resolveEmbedPolicy(process.env, readSettingsCacheStale())
}

/** Is this an embeddable (trusted-embedding) route? */
export function isEmbedPath(pathname: string): boolean {
  return pathname.startsWith(EMBED_PATH_PREFIX)
}

/**
 * `frame-ancestors` for an embeddable route: `'self'` + the instance origins
 * and the workspace's (from a verified token), or `'none'` when there are none.
 */
export function embedFrameAncestors(policy: EmbedPolicy = getEmbedPolicy(), workspaceOrigins: string[] = []): string {
  const all = [...policy.origins, ...workspaceOrigins.filter((o) => !policy.origins.includes(o))]
  return all.length ? `'self' ${all.join(' ')}` : "'none'"
}

/**
 * Session cookies are SameSite=None (framed sessions) when trusted
 * embedding is configured (instance origins, or per-workspace lists on) and
 * the cookies are Secure.
 */
export function framedSessionsEnabled(secure: boolean, policy: EmbedPolicy = getEmbedPolicy(), env: Record<string, string | undefined> = process.env): boolean {
  return secure && (policy.origins.length > 0 || workspaceEmbeddingEnabled(env))
}

const SAFE_METHODS = new Set(['GET', 'HEAD'])
const FRAME_DESTS = new Set(['iframe', 'frame'])

export interface CookieGuardRequest {
  method: string
  pathname: string
  /** Header lookup (case-insensitive names). */
  get(name: string): string | null | undefined
}

/**
 * With framed sessions on (SameSite=None session cookies): may this request
 * carry the session cookies? Returns false where SameSite=Lax would have
 * kept them back, so the proxy strips them — the CSRF protection Lax gave
 * stays the same:
 *  - same-origin, same-site and user-initiated (Sec-Fetch-Site: none)
 *    requests: yes (as with Lax);
 *  - cross-site top-level GET navigations: yes (as with Lax);
 *  - a cross-site framed GET navigation of an embeddable route: yes — the
 *    one thing trusted embedding adds (frame-ancestors limits who can frame
 *    it);
 *  - every other cross-site request (POST forms, fetch, images, scripts,
 *    frames of other routes): no.
 * Browsers without Fetch Metadata: unsafe methods whose Origin is another
 * host lose the cookies; everything else keeps them.
 */
export function sessionCookiesAllowed(req: CookieGuardRequest): boolean {
  const method = req.method.toUpperCase()
  const site = (req.get('sec-fetch-site') ?? '').toLowerCase()
  if (site) {
    if (site !== 'cross-site') return true
    if (!SAFE_METHODS.has(method)) return false
    if ((req.get('sec-fetch-mode') ?? '').toLowerCase() !== 'navigate') return false
    const dest = (req.get('sec-fetch-dest') ?? '').toLowerCase()
    if (dest === 'document') return true
    return FRAME_DESTS.has(dest) && isEmbedPath(req.pathname)
  }
  if (SAFE_METHODS.has(method)) return true
  const origin = req.get('origin')
  if (!origin || origin === 'null') return origin !== 'null'
  try {
    const host = (req.get('x-forwarded-host') ?? req.get('host') ?? '').split(',')[0].trim().toLowerCase()
    return new URL(origin).host.toLowerCase() === host
  } catch {
    return false
  }
}

/** Validation hook for instance_settings writes: a normalised origin list. */
export function validateEmbedSetting(key: string, value: unknown): void {
  if (key !== EMBED_FRAME_ANCESTORS_SETTING) return
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${key} must be a list of origins (https://intranet.example.com)`)
  }
  let normalised: string[]
  try {
    normalised = normaliseEmbedList(value)
  } catch (error) {
    throw new Error(`${key}: ${(error as Error).message}`)
  }
  if (JSON.stringify(normalised) !== JSON.stringify(value)) throw new Error(`${key}: store ${JSON.stringify(normalised)}, not ${JSON.stringify(value)}`)
}
