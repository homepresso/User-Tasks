/**
 * Only allow same-origin, path-style redirect targets. Anything absolute
 * (`https://evil.com`), protocol-relative (`//evil.com`), or backslash-tricky
 * (`/\evil.com`) collapses to the fallback. Used by the login page, the OAuth
 * authorize→login bounce, and the auth callback — the `?redirect=` parameter
 * is attacker-influenceable in all three.
 */
export function sanitizeRedirect(raw: string | null | undefined, fallback = '/tasks'): string {
  const candidate = String(raw ?? '').trim()
  if (!candidate) return fallback
  // Must start with a single '/' not followed by '/' or '\'
  if (!/^\/(?![/\\])/.test(candidate)) return fallback
  // Reject anything that could smuggle a scheme or CRLF
  if (/[\r\n]/.test(candidate) || candidate.includes('://')) return fallback
  return candidate
}
