import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { readEnv } from '@/lib/config/bootstrap'
import { secretOption, type SecretStoreOptions } from './options'
import { assertSecretName, type SecretStore } from './types'

/**
 * Environment variables (the default), plus mounted secret files:
 *  - the variable named exactly `name`, else its UPPER_SNAKE form
 *    (`smtp-password` → SMTP_PASSWORD);
 *  - `<VAR>_FILE`: a path to read the value from (the Docker / Kubernetes
 *    convention);
 *  - with files_dir (SECRETS_FILES_DIR, e.g. /run/secrets), the file
 *    `<files_dir>/<name>`.
 * Trailing newlines of file values are trimmed. Empty means unset.
 */

export function envName(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase()
}

async function readValueFile(file: string): Promise<string | undefined> {
  try {
    const value = (await readFile(file, 'utf8')).replace(/\r?\n$/, '')
    return value === '' ? undefined : value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export function createEnvSecretStore(options: SecretStoreOptions = {}): SecretStore {
  const filesDir = secretOption(options, 'files_dir')
  return {
    id: 'env',
    onPrem: true,
    async get(name) {
      for (const variable of [...new Set([name, envName(name)])]) {
        const value = readEnv(variable)
        if (value !== undefined && value !== '') return value
        const file = readEnv(`${variable}_FILE`)
        if (file) {
          const fromFile = await readValueFile(file)
          if (fromFile !== undefined) return fromFile
        }
      }
      if (filesDir) {
        assertSecretName(name)
        return readValueFile(path.join(filesDir, name))
      }
      return undefined
    },
  }
}

export const envSecretStore: SecretStore = createEnvSecretStore()
