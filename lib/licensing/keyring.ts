/**
 * The vendor's licence-signing PUBLIC keys, pinned by key id (`kid`).
 *
 * Only public keys live here. The private keys are held by the licence issuer
 * (offline / KMS) and are never committed: scripts/licence-issue.ts reads one
 * from a file or environment variable at run time.
 *
 * Rotation: add the new key with a new kid, start issuing with it, and keep
 * the old entry until every licence signed with it has expired. Retiring a key
 * (e.g. after a compromise) = remove its entry; licences signed with it then
 * fail verification with `unknown_key`.
 */

export interface LicenceKey {
  kid: string
  /** SPKI DER, base64 (lib/packages/format.ts publicKeyBase64). */
  public_key: string
  /** sha256 fingerprint of public_key (keyFingerprint), for out-of-band checks. */
  fingerprint?: string
  note?: string
}

export const LICENCE_KEYRING: readonly LicenceKey[] = [
  {
    kid: 'lic-2026-1',
    public_key: 'MCowBQYDK2VwAyEANqX67SGhI6zK+8mbj86CjQ+IOQFoQ8x8axnlt7S8fbU=',
    note: 'First UserTasks licence key (November 2026).',
  },
]
