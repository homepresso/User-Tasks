/**
 * Inbound webhook secrets (workflow_webhooks): hashing and verification.
 *
 * Secrets are 256-bit random values (lib/services/webhooks newSecret), so —
 * like OAuth tokens (lib/oauth/tokens) — a SHA-256 at rest is enough: full
 * entropy cannot be brute-forced whatever the hash speed. bcrypt's cost
 * (~90 ms of CPU per compare on an M1, ~0.3 s on a Raspberry Pi 5, blocking
 * the event loop) only defends low-entropy passwords, and paying it on every
 * inbound request was a throughput and denial-of-service problem.
 *
 * Rows keep `api_key_hash` (bcrypt, NOT NULL; written on create and rotate so
 * an older release still verifies the secret after a rollback) and gain
 * `api_key_sha256` (migration 20270125090000_webhook_secret_sha256):
 *  - with `api_key_sha256`: SHA-256 of the presented token, constant-time
 *    compare. No bcrypt.
 *  - legacy rows (no `api_key_sha256` yet): one bcrypt compare; on success the
 *    caller writes the SHA-256 (lazy upgrade) so later requests skip bcrypt.
 *  - until that column exists (migration not applied) a legacy row cannot be
 *    upgraded: successful bcrypt verifications are remembered in a small
 *    in-process cache keyed by webhook id + SHA-256 of the token and bound to
 *    the bcrypt hash they matched, so a rotated secret never hits it.
 *    Failures are never cached. The secret itself is never stored or logged.
 */

import bcrypt from 'bcryptjs'
import { createHash, timingSafeEqual } from 'crypto'

export const VERIFIED_CACHE_TTL_MS = 5 * 60_000
export const VERIFIED_CACHE_MAX_ENTRIES = 500

/** Hex SHA-256 of the full secret. */
export function hashWebhookSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex')
}

/** Constant-time equality of two hex SHA-256 digests (false on any malformed input). */
export function sha256HexEqual(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== 64 || b.length !== 64) return false
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  if (left.length !== 32 || right.length !== 32) return false
  return timingSafeEqual(left, right)
}

interface CacheEntry { bcryptHash: string; expiresAt: number }
const verified = new Map<string, CacheEntry>()

function cacheGet(key: string, bcryptHash: string, now: number): boolean {
  const entry = verified.get(key)
  if (!entry) return false
  if (entry.expiresAt <= now || entry.bcryptHash !== bcryptHash) {
    verified.delete(key)
    return false
  }
  return true
}

function cacheSet(key: string, bcryptHash: string, now: number): void {
  verified.delete(key)
  verified.set(key, { bcryptHash, expiresAt: now + VERIFIED_CACHE_TTL_MS })
  while (verified.size > VERIFIED_CACHE_MAX_ENTRIES) {
    const oldest = verified.keys().next().value
    if (oldest === undefined) break
    verified.delete(oldest)
  }
}

export interface WebhookSecretRow {
  id: string
  api_key_hash?: string | null
  api_key_prefix?: string | null
  /** Undefined when the column does not exist yet (migration not applied). */
  api_key_sha256?: string | null
}

export interface WebhookSecretCheck {
  valid: boolean
  /** Which path decided: `sha256` (no bcrypt), `cache` or `bcrypt` (legacy row). */
  via: 'sha256' | 'cache' | 'bcrypt' | 'none'
  /** Set when a legacy row verified: the SHA-256 to store in api_key_sha256. */
  upgradeSha256?: string
}

/** Verify a presented webhook secret against its row. Never throws. */
export async function verifyWebhookSecret(row: WebhookSecretRow, token: string, now = Date.now()): Promise<WebhookSecretCheck> {
  if (typeof token !== 'string' || !token) return { valid: false, via: 'none' }
  const presented = hashWebhookSecret(token)

  if (row.api_key_sha256) {
    return { valid: sha256HexEqual(presented, row.api_key_sha256), via: 'sha256' }
  }

  const bcryptHash = row.api_key_hash
  if (!bcryptHash) return { valid: false, via: 'none' }
  // The prefix is public (shown in the UI); it only spares bcrypt for tokens that cannot match.
  if (row.api_key_prefix && !token.startsWith(row.api_key_prefix)) return { valid: false, via: 'none' }

  const cacheKey = `${row.id}:${presented}`
  if (cacheGet(cacheKey, bcryptHash, now)) return { valid: true, via: 'cache', upgradeSha256: presented }

  let valid = false
  try { valid = await bcrypt.compare(token, bcryptHash) } catch { /* malformed hash */ }
  if (!valid) return { valid: false, via: 'bcrypt' }
  cacheSet(cacheKey, bcryptHash, now)
  return { valid: true, via: 'bcrypt', upgradeSha256: presented }
}

/** The column missing (migration 20270125090000 not applied): PostgreSQL or PostgREST error. */
export function isMissingSha256Column(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42703' || error.code === 'PGRST204') return true
  return /api_key_sha256/.test(String(error.message ?? '')) && /does not exist|could not find/i.test(String(error.message ?? ''))
}

export function verifiedCacheSize(): number {
  return verified.size
}

/** Test helper. */
export function resetWebhookSecretCacheForTests(): void {
  verified.clear()
}
