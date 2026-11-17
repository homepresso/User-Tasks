/**
 * Short-lived pull tokens for the usertasks.com registry front.
 *
 *   utpt1.<base64url(JSON payload)>.<base64url(HMAC-SHA256(secret, "utpt1." + payload))>
 *   payload: { v: 1, e: "<edition>", lid: "<licence id>", t: 0|1 (trial), iat, exp, jti }
 *
 * Stateless: the registry front (app/v2) checks the MAC and the expiry on
 * every request, without a database. The secret is EDITION_PULL_TOKEN_SECRET
 * (at least 32 characters; rotate it to invalidate every token at once). A
 * token names one edition, so it opens only that edition's repository, and
 * only for reading (the front serves GET / HEAD of manifests and blobs).
 *
 * The token is a bearer credential for 30 minutes: never logged, never
 * stored. The access log keeps its `jti` only.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const PULL_TOKEN_PREFIX = 'utpt1'
export const PULL_TOKEN_TTL_SECONDS = 30 * 60
/** Clock difference tolerated between the instances that mint and check. */
const SKEW_SECONDS = 60

export interface PullTokenPayload {
  v: 1
  /** Edition id (catalog). */
  e: string
  /** Licence id the token was issued for. */
  lid: string
  /** 1 when the licence is a trial. */
  t: 0 | 1
  iat: number
  exp: number
  jti: string
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(text: string): Buffer {
  return Buffer.from(text.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function mac(secret: string, data: string): Buffer {
  return createHmac('sha256', secret).update(data, 'utf8').digest()
}

export function assertSecret(secret: string | undefined): asserts secret is string {
  if (!secret || secret.length < 32) throw new Error('EDITION_PULL_TOKEN_SECRET must be set (at least 32 characters)')
}

export function mintPullToken(input: { edition: string; licenceId: string; trial: boolean; now: Date; ttlSeconds?: number }, secret: string): { token: string; payload: PullTokenPayload } {
  assertSecret(secret)
  const iat = Math.floor(input.now.getTime() / 1000)
  const payload: PullTokenPayload = {
    v: 1,
    e: input.edition,
    lid: input.licenceId,
    t: input.trial ? 1 : 0,
    iat,
    exp: iat + (input.ttlSeconds ?? PULL_TOKEN_TTL_SECONDS),
    jti: b64url(randomBytes(12)),
  }
  const body = `${PULL_TOKEN_PREFIX}.${b64url(Buffer.from(JSON.stringify(payload), 'utf8'))}`
  return { token: `${body}.${b64url(mac(secret, body))}`, payload }
}

export type PullTokenCheck =
  | { ok: true; payload: PullTokenPayload }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' | 'wrong_edition' }

/** Check a token for `edition` (MAC first, then the claims). */
export function verifyPullToken(token: string | null | undefined, edition: string, now: Date, secret: string): PullTokenCheck {
  if (!token || token.length > 2048) return { ok: false, reason: 'malformed' }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== PULL_TOKEN_PREFIX || !parts[1] || !parts[2]) return { ok: false, reason: 'malformed' }
  if (!secret || secret.length < 32) return { ok: false, reason: 'bad_signature' }
  const want = mac(secret, `${parts[0]}.${parts[1]}`)
  const got = fromB64url(parts[2])
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: 'bad_signature' }
  let payload: PullTokenPayload
  try {
    payload = JSON.parse(fromB64url(parts[1]).toString('utf8')) as PullTokenPayload
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (payload?.v !== 1 || typeof payload.exp !== 'number' || typeof payload.iat !== 'number' || typeof payload.e !== 'string') return { ok: false, reason: 'malformed' }
  const t = Math.floor(now.getTime() / 1000)
  if (payload.exp <= t || payload.iat > t + SKEW_SECONDS) return { ok: false, reason: 'expired' }
  if (payload.e !== edition) return { ok: false, reason: 'wrong_edition' }
  return { ok: true, payload }
}

/** The password of an HTTP Basic `Authorization` header (the username is ignored). */
export function basicPassword(header: string | null | undefined): string | null {
  if (!header) return null
  const m = /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header)
  if (m) {
    const decoded = Buffer.from(m[1], 'base64').toString('utf8')
    const at = decoded.indexOf(':')
    return at >= 0 ? decoded.slice(at + 1) : null
  }
  const b = /^Bearer\s+(\S+)\s*$/i.exec(header)
  return b ? b[1] : null
}
