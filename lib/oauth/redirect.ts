import { configuredAppUrl } from '@/lib/config/bootstrap'
/**
 * redirect_uri handling for the OAuth provider. Mismatches must render an
 * error page, never redirect (open-redirect prevention).
 *
 * Matching is an EXACT string match against the client's registered
 * allowlist, with one relaxation from RFC 8252 §7.3 for native apps: a
 * registered `http` loopback URI (127.0.0.1, [::1] or localhost) also matches
 * the same URI on ANY port, so a CLI can listen on an ephemeral port. Scheme,
 * host, path and query must still match exactly; `localhost` is not
 * interchangeable with `127.0.0.1`; https and non-loopback hosts are never
 * relaxed. The token endpoint keeps an exact match against the redirect_uri
 * used at /authorize (stored on the authorization code).
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])

function parseCanonical(value: string): URL | null {
  try {
    const url = new URL(value)
    // Only canonical spellings: no `0x7f.1`, `127.1`, default `:80`, case
    // tricks or dot segments — what we redirect to is exactly what was matched.
    if (url.href !== value) return null
    return url
  } catch {
    return null
  }
}

function loopbackMatch(registered: string, candidate: URL): boolean {
  const reg = parseCanonical(registered)
  if (!reg || reg.protocol !== 'http:' || !LOOPBACK_HOSTS.has(reg.hostname)) return false
  return (
    candidate.protocol === 'http:'
    && candidate.hostname === reg.hostname
    && candidate.pathname === reg.pathname
    && candidate.search === reg.search
    && !candidate.hash
    && !candidate.username
    && !candidate.password
  )
}

export function isAllowedRedirect(registered: string[], candidate: string): boolean {
  const value = String(candidate ?? '')
  if (!value) return false
  if (registered.some((uri) => uri === value)) return true
  const parsed = parseCanonical(value)
  if (!parsed || parsed.protocol !== 'http:' || !LOOPBACK_HOSTS.has(parsed.hostname)) return false
  return registered.some((uri) => loopbackMatch(uri, parsed))
}

/** Absolute app URL, trailing-newline/slash safe (env gotcha bites otherwise). */
export function appBaseUrl(): string {
  const raw = (configuredAppUrl() ?? '').trim().replace(/\/+$/, '')
  return raw || 'http://localhost:3000'
}

/** Validate a client-supplied redirect URI shape at registration time. */
export function isRegistrableRedirectUri(uri: string): boolean {
  try {
    const parsed = new URL(uri)
    if (parsed.hash) return false
    // https required except loopback (RFC 8252 native-app loopback exception).
    if (parsed.protocol === 'https:') return true
    if (parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname)) return true
    return false
  } catch {
    return false
  }
}
