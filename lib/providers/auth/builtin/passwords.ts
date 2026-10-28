import bcrypt from 'bcryptjs'
import { AuthError } from '../types'

/**
 * Password hashing for built-in auth: bcrypt, cost 10 — the same format and
 * cost Supabase Auth (GoTrue) uses, so hashes copied from auth.users verify
 * unchanged. New hashes are `$2b$`; `$2a$` (GoTrue) and `$2y$` (PHP /
 * htpasswd exports) are accepted.
 */

export const BCRYPT_COST = 10
/** bcrypt only looks at the first 72 bytes; longer passwords are refused rather than silently truncated. */
export const MAX_PASSWORD_BYTES = 72

// Compared against when the account doesn't exist, so a miss costs the same
// time as a wrong password (no user enumeration by timing).
const DUMMY_HASH = '$2b$10$9ONinOO2bgB/Y2HgDt3.a.GTO5GwM0uykZS8HGWMTddvRC7f8m5oK'

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export function isBcryptHash(hash: string | null | undefined): hash is string {
  return typeof hash === 'string' && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)
}

/** Constant-work check; false for a missing / malformed hash. */
export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!isBcryptHash(hash)) {
    await bcrypt.compare(password, DUMMY_HASH).catch(() => false)
    return false
  }
  const normalized = hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash
  return bcrypt.compare(password, normalized).catch(() => false)
}

export function checkPasswordPolicy(password: string, minLength: number): void {
  if (typeof password !== 'string' || password.length < minLength) {
    throw new AuthError('weak_password', `Password should be at least ${minLength} characters.`)
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new AuthError('weak_password', `Password must be at most ${MAX_PASSWORD_BYTES} bytes.`)
  }
}
