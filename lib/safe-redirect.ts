/**
 * Only allow same-origin, path-style redirect targets. Anything absolute
 * (`https://evil.com`), protocol-relative (`//evil.com`), or backslash-tricky
 * (`/\evil.com`) collapses to the fallback. Used by the login page, the OAuth
 * authorize→login bounce, and the auth callback — the `?redirect=` parameter
 * is attacker-influenceable in all three.
 */
export function sanitizeRedirect(raw: string | null | undefined, fallback = '/home'): string {
  const candidate = String(raw ?? '').trim()
  if (!candidate) return fallback
  // Must start with a single '/' not followed by '/' or '\'
  if (!/^\/(?![/\\])/.test(candidate)) return fallback
  // Reject anything that could smuggle a scheme, a header (CRLF) or a host:
  // browsers drop tabs/newlines and read `\` as `/`, so `/\t/evil.com` or
  // `/\\evil.com` would become `//evil.com`. No control characters, no backslashes.
  if (/[\u0000-\u001f\u007f\\]/.test(candidate) || candidate.includes('://')) return fallback
  return candidate
}
