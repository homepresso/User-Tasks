import { randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * First-run setup code (self-hosted): the one-time secret that proves the
 * person on /setup can read the server's log (or run usertasks-admin), so a
 * fresh install reachable from the internet can't be claimed by a stranger.
 *
 * Twelve characters from a 32-letter alphabet without look-alikes (no I, O,
 * 0, 1): 60 bits, shown as XXXX-XXXX-XXXX. Only a salted scrypt hash is
 * stored (instance_settings `instance.setup_code`); comparison is constant
 * time. Pure: no I/O.
 */

export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const SETUP_CODE_ENV = 'USERTASKS_SETUP_CODE'
/** Shortest USERTASKS_SETUP_CODE accepted (after normalising). */
export const MIN_ENV_CODE_LENGTH = 8

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 } as const

export function generateSetupCode(): string {
  let raw = ''
  for (let i = 0; i < 12; i++) raw += SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)]
  return formatSetupCode(raw)
}

/** XXXX-XXXX-XXXX for a generated code (any other string is returned as is). */
export function formatSetupCode(code: string): string {
  const n = normalizeSetupCode(code)
  return /^[A-Z0-9]{12}$/.test(n) ? `${n.slice(0, 4)}-${n.slice(4, 8)}-${n.slice(8)}` : code
}

/** Case, spaces and dashes don't matter: "abcd efgh-jklm" = "ABCD-EFGH-JKLM". */
export function normalizeSetupCode(code: string): string {
  return String(code ?? '').toUpperCase().replace(/[\s-]+/g, '')
}

function derive(normalized: string, salt: Buffer): Buffer {
  return scryptSync(normalized, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p })
}

/** `scrypt$N$r$p$<salt b64>$<hash b64>` of the normalised code. */
export function hashSetupCode(code: string): string {
  const salt = randomBytes(16)
  const hash = derive(normalizeSetupCode(code), salt)
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** Constant-time check of `code` against a stored hash; false for anything malformed. */
export function verifySetupCode(code: string, stored: string | null | undefined): boolean {
  const normalized = normalizeSetupCode(code)
  if (!normalized || normalized.length > 128 || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [N, r, p] = parts.slice(1, 4).map(Number)
  if (N !== SCRYPT.N || r !== SCRYPT.r || p !== SCRYPT.p) return false
  const salt = Buffer.from(parts[4], 'base64')
  const expected = Buffer.from(parts[5], 'base64')
  if (salt.length < 8 || expected.length !== SCRYPT.keylen) return false
  return timingSafeEqual(derive(normalized, salt), expected)
}

/**
 * USERTASKS_SETUP_CODE, normalised; null when unset. `invalid` when it's set
 * but too short to be a secret (then the generated code is used instead).
 */
export function envSetupCode(env: Record<string, string | undefined> = process.env): { code: string } | { invalid: true } | null {
  const raw = env[SETUP_CODE_ENV]
  if (raw === undefined || raw.trim() === '') return null
  const code = normalizeSetupCode(raw)
  if (code.length < MIN_ENV_CODE_LENGTH || code.length > 128) return { invalid: true }
  return { code }
}

/** Constant-time comparison of two normalised codes (the env override). */
export function codesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(normalizeSetupCode(given))
  const b = Buffer.from(normalizeSetupCode(expected))
  // Compare equal-length buffers either way so the length isn't leaked by an early return.
  const same = timingSafeEqual(a.length === b.length ? a : b, b)
  return a.length === b.length && same && a.length > 0
}

/** The log line operators look for. */
export function setupCodeLogLine(code: string): string {
  return `UserTasks setup code: ${formatSetupCode(code)} (open /setup to create the admin account)`
}
