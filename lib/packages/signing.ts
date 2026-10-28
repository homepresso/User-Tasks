/**
 * The instance's package signing key (ed25519).
 *
 * Resolution: PACKAGE_SIGNING_KEY (PEM, from the operator's secret store) →
 * the package_signing_keys row (private key encrypted with ENCRYPTION_KEY) →
 * generated on first use and stored. Without ENCRYPTION_KEY and without
 * PACKAGE_SIGNING_KEY packages are built unsigned (with a warning).
 *
 * Trust on install: a signature is `instance` when it is this instance's key,
 * `trusted` when its fingerprint is listed in PACKAGE_TRUSTED_FINGERPRINTS
 * (comma-separated) or is the official gallery key pinned in
 * gallery/signing.json, otherwise `untrusted` (still installable — the UI and CLI
 * show the fingerprint so it can be checked out of band).
 */

import { generateKeyPairSync } from 'node:crypto'
import { decryptSecret, encryptSecret } from '@/lib/secret-crypto'
import type { AnySupabaseClient } from '@/lib/services/context'
import { keyFingerprint, publicKeyBase64 } from './format'
import { createPrivateKey } from 'node:crypto'
import gallerySigning from '@/gallery/signing.json'

/* eslint-disable @typescript-eslint/no-explicit-any -- untyped service-role client */

export interface SigningKey {
  privateKeyPem: string
  publicKey: string
  fingerprint: string
  source: 'env' | 'stored' | 'generated'
}

export type SignerTrust = 'instance' | 'trusted' | 'untrusted' | 'unsigned'

function fromPem(pem: string, source: SigningKey['source']): SigningKey {
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('PACKAGE_SIGNING_KEY must be an ed25519 private key (PEM)')
  const publicKey = publicKeyBase64(key)
  return { privateKeyPem: pem, publicKey, fingerprint: keyFingerprint(publicKey), source }
}

/** The signing key, or null (with the reason) when packages cannot be signed here. */
export async function getSigningKey(admin: AnySupabaseClient): Promise<{ key: SigningKey | null; warning?: string }> {
  const envPem = process.env.PACKAGE_SIGNING_KEY?.replace(/\\n/g, '\n').trim()
  if (envPem) return { key: fromPem(envPem, 'env') }
  if (!process.env.ENCRYPTION_KEY) {
    return { key: null, warning: 'Package not signed: set ENCRYPTION_KEY (or PACKAGE_SIGNING_KEY) to sign packages' }
  }
  const read = async () => {
    const { data, error } = await (admin as any).from('package_signing_keys').select('private_key_encrypted').eq('purpose', 'packages').maybeSingle()
    if (error) throw new Error(error.message)
    return data?.private_key_encrypted ? String(data.private_key_encrypted) : null
  }
  const stored = await read()
  if (stored) return { key: fromPem(decryptSecret(stored), 'stored') }

  const { privateKey } = generateKeyPairSync('ed25519')
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const generated = fromPem(pem, 'generated')
  // Concurrent first builds: the unique purpose wins once; everyone re-reads.
  const { error } = await (admin as any).from('package_signing_keys').upsert({
    purpose: 'packages', public_key: generated.publicKey, fingerprint: generated.fingerprint, private_key_encrypted: encryptSecret(pem),
  }, { onConflict: 'purpose', ignoreDuplicates: true })
  if (error) throw new Error(error.message)
  const winner = await read()
  return { key: winner ? fromPem(decryptSecret(winner), 'generated') : generated }
}

/** This instance's fingerprint without generating a key (null when none yet). */
export async function instanceFingerprint(admin: AnySupabaseClient): Promise<string | null> {
  const envPem = process.env.PACKAGE_SIGNING_KEY?.replace(/\\n/g, '\n').trim()
  if (envPem) {
    try { return fromPem(envPem, 'env').fingerprint } catch { return null }
  }
  const { data } = await (admin as any).from('package_signing_keys').select('fingerprint').eq('purpose', 'packages').maybeSingle()
  return data?.fingerprint ? String(data.fingerprint) : null
}

/** The official package gallery's key (gallery/signing.json; null until the maintainer pins it). */
export const GALLERY_FINGERPRINT: string | null = gallerySigning.fingerprint ? String(gallerySigning.fingerprint).toLowerCase() : null

export function trustedFingerprints(): string[] {
  const configured = String(process.env.PACKAGE_TRUSTED_FINGERPRINTS ?? '').split(',').map((f) => f.trim().toLowerCase()).filter(Boolean)
  return GALLERY_FINGERPRINT && !configured.includes(GALLERY_FINGERPRINT) ? [...configured, GALLERY_FINGERPRINT] : configured
}

export function signerTrust(fingerprint: string | null, instance: string | null): SignerTrust {
  if (!fingerprint) return 'unsigned'
  if (instance && fingerprint.toLowerCase() === instance.toLowerCase()) return 'instance'
  if (trustedFingerprints().includes(fingerprint.toLowerCase())) return 'trusted'
  return 'untrusted'
}
