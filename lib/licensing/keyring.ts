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
  /**
   * `licence` (default): the main, offline licence key — anything it signs is
   * trusted. `trial`: a trial-only key held by the usertasks.com trial issuer;
   * licences it signs are accepted ONLY when they keep the trial rules
   * (./trial-policy.ts: trial: true, at most 30 days, an allowed SKU, bound to
   * exactly one farm). Anything else signed with it is rejected.
   */
  kind?: 'licence' | 'trial'
  /** Trial keys: the SKUs the key may sign trials for (default TRIAL_DEFAULT_SKUS). */
  trialSkus?: readonly string[]
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
  // Trial-only key (self-serve 30-day trials). The owner generates it with
  // `npx tsx scripts/licensing/new-trial-key.ts` and pastes the printed entry
  // here, e.g.:
  // { kid: 'trial-1', kind: 'trial', trialSkus: ['sharepoint-se'], public_key: '…', fingerprint: '…', note: 'Self-serve trial key (2026).' },
  // Until it is here, trials are unavailable (the issuer refuses and the site shows "Contact us").
]

/** The keyring's trial-only keys. */
export function trialKeys(keyring: readonly LicenceKey[] = LICENCE_KEYRING): LicenceKey[] {
  return keyring.filter((k) => k.kind === 'trial')
}
