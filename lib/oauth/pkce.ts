import { createHash, timingSafeEqual } from 'crypto'

/**
 * PKCE (RFC 7636), S256 only. `plain` is rejected everywhere — it defeats the
 * point of PKCE for public clients.
 */

export function computeS256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url')
}

export function verifyPkce(codeVerifier: string, codeChallenge: string, method = 'S256'): boolean {
  if (method !== 'S256') return false
  // RFC 7636 verifier grammar: 43–128 chars of [A-Za-z0-9-._~]
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(codeVerifier)) return false
  const computed = Buffer.from(computeS256Challenge(codeVerifier), 'utf8')
  const expected = Buffer.from(codeChallenge, 'utf8')
  if (computed.length !== expected.length) return false
  return timingSafeEqual(computed, expected)
}
