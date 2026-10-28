import { readEnv } from '@/lib/config/bootstrap'
import { kmsOption, type KmsOptions } from './options'
import { describeError, KmsError, loadKmsSdk, type KmsProvider } from './types'

/**
 * aws_kms: AWS Key Management Service (@aws-sdk/client-kms, an optional
 * dependency) with the default credential chain (task / instance role,
 * IRSA, environment). Data keys are wrapped with Encrypt / Decrypt under
 * aws_kms_key_id (a symmetric key: id, ARN or alias), the data-key id as
 * encryption context, so a wrapped key can't be replayed under another id
 * and every use is attributable in CloudTrail. Automatic key rotation in
 * KMS needs nothing here: old key material keeps decrypting.
 *
 * The role needs kms:Encrypt and kms:Decrypt on the key. aws_endpoint points
 * at a VPC endpoint (or a local KMS for tests).
 */

type KmsClient = { send(command: unknown): Promise<{ CiphertextBlob?: Uint8Array; Plaintext?: Uint8Array; KeyId?: string }> }
type CommandCtor = new (input: Record<string, unknown>) => unknown

export interface AwsKmsDeps {
  client?: KmsClient
  EncryptCommand?: CommandCtor
  DecryptCommand?: CommandCtor
}

export function createAwsKmsProvider(options: KmsOptions, deps: AwsKmsDeps = {}): KmsProvider {
  const keyId = kmsOption(options, 'aws_kms_key_id')
  const region = kmsOption(options, 'aws_region') ?? readEnv('AWS_REGION')
  const endpoint = kmsOption(options, 'aws_endpoint')
  let client = deps.client
  let Encrypt = deps.EncryptCommand
  let Decrypt = deps.DecryptCommand

  async function sdk() {
    if (!client || !Encrypt || !Decrypt) {
      const mod = await loadKmsSdk('@aws-sdk/client-kms', 'aws_kms', () => import('@aws-sdk/client-kms'))
      client ??= new mod.KMSClient({ ...(region ? { region } : {}), ...(endpoint ? { endpoint } : {}) }) as unknown as KmsClient
      Encrypt ??= mod.EncryptCommand as unknown as CommandCtor
      Decrypt ??= mod.DecryptCommand as unknown as CommandCtor
    }
    return { client: client!, Encrypt: Encrypt!, Decrypt: Decrypt! }
  }

  return {
    id: 'aws_kms',
    onPrem: false,
    describe: () => `AWS KMS key ${keyId ?? '(AWS_KMS_KEY_ID not set)'}${region ? ` in ${region}` : ''}`,
    async wrap(dek, context) {
      if (!keyId) throw new KmsError('KMS_PROVIDER=aws_kms requires AWS_KMS_KEY_ID')
      const { client, Encrypt } = await sdk()
      try {
        const out = await client.send(new Encrypt({ KeyId: keyId, Plaintext: dek, EncryptionContext: { usertasks: context } }))
        if (!out.CiphertextBlob) throw new KmsError('AWS KMS returned no ciphertext')
        return { wrapped: Buffer.from(out.CiphertextBlob).toString('base64'), kekRef: out.KeyId ?? keyId }
      } catch (error) {
        if (error instanceof KmsError) throw error
        throw new KmsError(`AWS KMS Encrypt with ${keyId}: ${describeError(error)}`)
      }
    },
    async unwrap({ wrapped, kekRef }, context) {
      const { client, Decrypt } = await sdk()
      try {
        const out = await client.send(new Decrypt({ KeyId: kekRef, CiphertextBlob: Buffer.from(wrapped, 'base64'), EncryptionContext: { usertasks: context } }))
        if (!out.Plaintext) throw new KmsError('AWS KMS returned no plaintext')
        return Buffer.from(out.Plaintext)
      } catch (error) {
        if (error instanceof KmsError) throw error
        throw new KmsError(`AWS KMS Decrypt with ${kekRef}: ${describeError(error)}`)
      }
    },
  }
}
