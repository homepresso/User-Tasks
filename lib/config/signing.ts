import { hkdfSync } from 'node:crypto'
import { encryptionKeyMaterial } from '@/lib/secret-crypto'
import { getBootstrapConfig, readEnv } from './bootstrap'
import { isSecretRef } from './secret-refs'

/**
 * The server's internal signing key: the HMAC key of payloads the server
 * signs for itself and verifies later (queued workflow resumes, the signed
 * initiator of queued starts). Never sent to a browser or a caller.
 *
 * Signing key, first that is set:
 *   1. WORKFLOW_SIGNING_SECRET — a dedicated secret (any length; 32+ random bytes);
 *   2. a key derived with HKDF-SHA256 from ENCRYPTION_KEY (fixed context
 *      label; a secret:// reference once resolved at startup), so every
 *      configured server has one without new config;
 *   3. SUPABASE_SERVICE_ROLE_KEY — legacy: what these payloads were signed
 *      with before this resolver (Supabase deployments without ENCRYPTION_KEY).
 *
 * Verification accepts any of the three that is configured, so payloads
 * queued before an upgrade (signed with the service-role key) — or before
 * WORKFLOW_SIGNING_SECRET was added — still verify. New payloads are always
 * signed with the first.
 *
 * Upgrade note: a Supabase deployment with ENCRYPTION_KEY signed with the
 * service-role key before and signs with the derived key now. New code
 * verifies both, so jobs queued by the old release run after the deploy;
 * a job queued by the new release and claimed by a still-running old
 * process (only during the switch-over) would be skipped by the old code.
 */

/** HKDF context label of the key derived from ENCRYPTION_KEY. Changing it invalidates queued payloads. */
export const SIGNING_KEY_INFO = 'usertasks:internal-signing:v1'

export type SigningKeySource = 'WORKFLOW_SIGNING_SECRET' | 'ENCRYPTION_KEY' | 'SUPABASE_SERVICE_ROLE_KEY'

export interface SigningKey {
  key: Buffer
  source: SigningKeySource
}

function deriveFromEncryptionKey(encryptionKey: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), SIGNING_KEY_INFO, 32))
}

/** Every configured signing key, signing key first (deduplicated). */
export function signingKeys(): SigningKey[] {
  const cfg = getBootstrapConfig()
  const out: SigningKey[] = []
  const dedicated = readEnv('WORKFLOW_SIGNING_SECRET')?.trim()
  // A secret:// reference is not resolved here; its text is no secret, so it is never used as a key.
  if (dedicated && !isSecretRef(dedicated)) out.push({ key: Buffer.from(dedicated, 'utf8'), source: 'WORKFLOW_SIGNING_SECRET' })
  const encryptionKey = encryptionKeyMaterial()
  if (encryptionKey) out.push({ key: deriveFromEncryptionKey(encryptionKey), source: 'ENCRYPTION_KEY' })
  if (cfg.supabase.serviceRoleKey) out.push({ key: Buffer.from(cfg.supabase.serviceRoleKey, 'utf8'), source: 'SUPABASE_SERVICE_ROLE_KEY' })
  return out.filter((entry, i) => out.findIndex((other) => other.key.equals(entry.key)) === i)
}

/** The key new payloads are signed with, or null when none is configured. */
export function currentSigningKey(): SigningKey | null {
  return signingKeys()[0] ?? null
}

export const SIGNING_KEY_MISSING =
  'No internal signing key: set WORKFLOW_SIGNING_SECRET (or ENCRYPTION_KEY) in the app environment'

/** The key new payloads are signed with; throws when none is configured. */
export function requireSigningKey(): Buffer {
  const current = currentSigningKey()
  if (!current) throw new Error(SIGNING_KEY_MISSING)
  return current.key
}
