import { createHash, timingSafeEqual } from 'node:crypto'
import { optionalPackageInstallHint } from '../../optional-drivers'

/**
 * KmsProvider: wraps and unwraps data-encryption keys (DEKs) with a
 * key-encryption key (KEK) that never leaves the KMS (envelope encryption).
 * Secrets at rest are encrypted with a DEK (lib/secret-crypto, `enc:v2:`);
 * only wrapped DEKs are stored (app_kms.data_keys). The provider never sees
 * the data, and nothing here logs or returns key material: errors carry the
 * KMS's reason and the key's name only.
 *
 * `context` binds a wrapped DEK to its data-key id: KMSs with additional
 * authenticated data (AWS encryption context, Cloud KMS AAD, AES-GCM) get it
 * natively; the others (Vault Transit, Key Vault RSA-OAEP) wrap it in with
 * the key (bindContext) and check it on unwrap.
 */

export interface WrappedKey {
  /** Provider-specific ciphertext of the DEK (text). */
  wrapped: string
  /** The KEK that wrapped it (key id / ARN / versioned key URL / Transit key), as unwrap needs it. */
  kekRef: string
}

export interface KmsProvider {
  readonly id: string
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  /** The configured KEK, for status output (no secrets). */
  describe(): string
  wrap(dek: Buffer, context: string): Promise<WrappedKey>
  unwrap(key: WrappedKey, context: string): Promise<Buffer>
}

export class KmsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KmsError'
  }
}

export const DEK_BYTES = 32

/** The wrap context of data key `id`. */
export function dataKeyContext(id: number): string {
  return `usertasks:data-key:${id}`
}

const contextTag = (context: string) => createHash('sha256').update(context).digest().subarray(0, 16)

/** For KMSs without AAD: 16-byte tag of the context, then the key. */
export function bindContext(dek: Buffer, context: string): Buffer {
  return Buffer.concat([contextTag(context), dek])
}

export function unbindContext(bound: Buffer, context: string): Buffer {
  const tag = contextTag(context)
  if (bound.length !== tag.length + DEK_BYTES || !timingSafeEqual(bound.subarray(0, tag.length), tag)) {
    throw new KmsError('the unwrapped data key does not belong to this key id (wrong key or tampered row)')
  }
  return Buffer.from(bound.subarray(tag.length))
}

export function describeError(error: unknown): string {
  const e = error as { message?: unknown; name?: unknown }
  const message = typeof e?.message === 'string' ? e.message : String(error)
  return message.split('\n')[0].slice(0, 300)
}

export async function loadKmsSdk<T>(pkg: string, provider: string, load: () => Promise<T>): Promise<T> {
  const { isMissingSdkError } = await import('../storage/optional-sdk')
  try {
    return await load()
  } catch (error) {
    if (isMissingSdkError(error, pkg)) {
      throw new KmsError(`KMS_PROVIDER=${provider} needs the optional package ${pkg}: ${optionalPackageInstallHint(pkg)}.`)
    }
    throw error
  }
}
