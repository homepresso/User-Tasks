/**
 * Shape of secrets encrypted at rest (lib/secret-crypto): `enc:v1:` (AES-256-GCM
 * with ENCRYPTION_KEY) or `enc:v2:<data key id>:` (envelope encryption with a
 * KMS-wrapped data key). Dependency-free so browser code (edit forms) and the
 * export / package scrubbers can recognise ciphertext they must not touch.
 */

export const CIPHERTEXT_PATTERN = /^enc:v\d+:/

/** Whether `value` is encrypted-at-rest ciphertext (any version). */
export function isCiphertext(value: unknown): boolean {
  return typeof value === 'string' && CIPHERTEXT_PATTERN.test(value)
}

/** Whether `text` (a serialized document) contains ciphertext anywhere. */
export function containsCiphertext(text: string): boolean {
  return /enc:v\d+:/.test(text)
}
