import crypto from 'node:crypto'
import { bootstrapKeyBytes } from '@/lib/secret-crypto'
import { KmsError, type KmsProvider } from './types'

/**
 * env (default): the key-encryption key is ENCRYPTION_KEY itself (from the
 * environment or the secret store, lib/providers/secrets/bootstrap). Data
 * keys are wrapped with AES-256-GCM, the data-key id as AAD. Without data
 * keys (nobody ran `usertasks-admin kms rotate`) nothing changes: secrets
 * are enc:v1 with ENCRYPTION_KEY, as before.
 *
 * The KEK reference is a check value of the key (an HMAC, not the key), so a
 * changed ENCRYPTION_KEY is reported as such instead of as a decrypt error.
 */

export function kekCheckValue(key: Buffer): string {
  return crypto.createHmac('sha256', key).update('usertasks:kek-check').digest('hex').slice(0, 16)
}

export function createEnvKmsProvider(deps: { key?: () => Buffer | null } = {}): KmsProvider {
  const kek = () => {
    const key = (deps.key ?? bootstrapKeyBytes)()
    if (!key) throw new KmsError('KMS_PROVIDER=env wraps data keys with ENCRYPTION_KEY, which is not set')
    return key
  }
  return {
    id: 'env',
    onPrem: true,
    describe() {
      const key = (deps.key ?? bootstrapKeyBytes)()
      return key ? `ENCRYPTION_KEY (check value ${kekCheckValue(key)})` : 'ENCRYPTION_KEY (not set)'
    },
    async wrap(dek, context) {
      const key = kek()
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
      cipher.setAAD(Buffer.from(context, 'utf8'))
      const ct = Buffer.concat([cipher.update(dek), cipher.final()])
      return { wrapped: `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`, kekRef: `env:${kekCheckValue(key)}` }
    },
    async unwrap({ wrapped, kekRef }, context) {
      const key = kek()
      if (kekRef !== `env:${kekCheckValue(key)}`) {
        throw new KmsError('this data key was wrapped with a different ENCRYPTION_KEY (check value mismatch)')
      }
      const [iv, tag, ct] = wrapped.split(':')
      if (!iv || !tag || !ct) throw new KmsError('malformed wrapped data key')
      try {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
        decipher.setAAD(Buffer.from(context, 'utf8'))
        decipher.setAuthTag(Buffer.from(tag, 'base64'))
        return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()])
      } catch {
        throw new KmsError('the wrapped data key failed authentication (wrong key id or tampered row)')
      }
    },
  }
}
