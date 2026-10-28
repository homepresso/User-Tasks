import { readEnv } from '@/lib/config/bootstrap'
import { secretOption, type SecretStoreOptions } from './options'
import { SecretStoreError, describeError, loadSecretsSdk, type SecretStore } from './types'

/**
 * AWS Secrets Manager (@aws-sdk/client-secrets-manager, an optional
 * dependency) with the AWS SDK's default credential chain (environment,
 * instance / task role, IRSA). A name is a secret name or ARN; JSON
 * key/value secrets take a field: secret://usertasks/smtp#password.
 */

type SmClient = { send(command: unknown): Promise<{ SecretString?: string; SecretBinary?: Uint8Array }> }

export interface AwsSecretsManagerDeps {
  client?: SmClient
  GetSecretValueCommand?: new (input: { SecretId: string }) => unknown
}

export function createAwsSecretsManagerStore(options: SecretStoreOptions, deps: AwsSecretsManagerDeps = {}): SecretStore {
  const region = secretOption(options, 'aws_region') ?? readEnv('AWS_REGION')
  const endpoint = secretOption(options, 'aws_endpoint')
  const prefix = secretOption(options, 'name_prefix') ?? ''
  let client = deps.client
  let Command = deps.GetSecretValueCommand
  return {
    id: 'aws_secrets_manager',
    onPrem: false,
    async get(name) {
      if (!client || !Command) {
        const mod = await loadSecretsSdk('@aws-sdk/client-secrets-manager', 'aws_secrets_manager', () => import('@aws-sdk/client-secrets-manager'))
        client = new mod.SecretsManagerClient({ ...(region ? { region } : {}), ...(endpoint ? { endpoint } : {}) }) as unknown as SmClient
        Command = mod.GetSecretValueCommand as unknown as AwsSecretsManagerDeps['GetSecretValueCommand']
      }
      try {
        const result = await client.send(new Command!({ SecretId: name.startsWith('arn:') ? name : `${prefix}${name}` }))
        const value = result.SecretString ?? (result.SecretBinary ? Buffer.from(result.SecretBinary).toString('utf8') : undefined)
        return value === '' ? undefined : value
      } catch (error) {
        const e = error as { name?: string }
        if (e.name === 'ResourceNotFoundException') return undefined
        throw new SecretStoreError(`AWS Secrets Manager: ${describeError(error)}`)
      }
    },
  }
}
