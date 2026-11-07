import { createHash, timingSafeEqual } from 'node:crypto'
import { readEnv } from '@/lib/config/bootstrap'
import { SECRET_REF_PREFIX } from '@/lib/config/secret-refs'

/**
 * The instance admin token (INSTANCE_ADMIN_TOKEN): the bearer credential of
 * the instance-level REST operations (/api/v1/admin/*, e.g. creating a
 * workspace). It belongs to the operator of the installation, not to any
 * workspace, so no workspace API key, OAuth token or session can stand in
 * for it.
 *
 *  - Unset (the default) → the operations are off and answer 404.
 *  - Shorter than 32 characters → treated as unset (with a warning), so a
 *    weak value can't switch them on.
 *  - Compared in constant time (SHA-256 digests of both sides).
 */

export const INSTANCE_ADMIN_TOKEN_MIN_LENGTH = 32

let warnedShort = false

/** The configured token, or null when the operations are off. */
export function instanceAdminToken(): string | null {
  const value = readEnv('INSTANCE_ADMIN_TOKEN')?.trim()
  // A secret:// reference is not resolved here, and its text is no secret.
  if (!value || value.startsWith(SECRET_REF_PREFIX)) return null
  if (value.length < INSTANCE_ADMIN_TOKEN_MIN_LENGTH) {
    if (!warnedShort) {
      warnedShort = true
      console.warn(`[instance-admin] INSTANCE_ADMIN_TOKEN is shorter than ${INSTANCE_ADMIN_TOKEN_MIN_LENGTH} characters: the instance admin API stays off (generate one with: openssl rand -hex 32)`)
    }
    return null
  }
  return value
}

const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest()

/** Whether `presented` is the configured token (false when none is configured). */
export function isInstanceAdminToken(presented: string | null | undefined): boolean {
  const expected = instanceAdminToken()
  if (!expected || typeof presented !== 'string' || !presented) return false
  return timingSafeEqual(digest(expected), digest(presented))
}
