import { isMissingSdkError } from '../storage/optional-sdk'
import { optionalPackageInstallHint } from '../../optional-drivers'

/**
 * A secret store returns the current value of a named secret, or undefined
 * when there is no such secret. Any other failure (store unreachable, access
 * denied) throws SecretStoreError — with a message that never contains a
 * secret value.
 */
export interface SecretStore {
  readonly id: string
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  get(name: string): Promise<string | undefined>
  /**
   * One field of a structured secret (Vault KV keys). Stores without native
   * fields leave it out; callers then parse the value as a JSON object.
   */
  getField?(name: string, field: string): Promise<string | undefined>
}

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretStoreError'
  }
}

/** Secret names: letters, digits and . _ - / (no traversal, no URL syntax). */
export function assertSecretName(name: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(name) || name.split('/').some((part) => part === '..' || part === '.' || part === '')) {
    throw new SecretStoreError(`Invalid secret name "${name.slice(0, 80)}"`)
  }
}

export async function loadSecretsSdk<T>(pkg: string, store: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load()
  } catch (error) {
    if (isMissingSdkError(error, pkg)) {
      throw new SecretStoreError(`SECRETS_PROVIDER=${store} needs the optional package ${pkg}: ${optionalPackageInstallHint(pkg)}.`)
    }
    throw error
  }
}

/** Error message from an SDK / HTTP failure, trimmed (SDK messages don't carry secret values). */
export function describeError(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown; statusCode?: unknown; name?: unknown }
  const message = typeof e?.message === 'string' ? e.message : String(error)
  return message.split('\n')[0].slice(0, 300)
}
