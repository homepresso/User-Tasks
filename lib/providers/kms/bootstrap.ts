import { getProviderConfig } from '@/lib/config'
import { activeDataKeyId, dataKeyIds, hasDataKey, hasEncryptionKey } from '@/lib/secret-crypto'
import { kmsProviderFor } from './index'
import { activeRow, isMissingKmsSchema, loadDataKeys, resolverFor, serviceDbDataKeys, type DataKeySource } from './keyring'
import { kmsSeconds } from './options'
import { describeError, KmsError } from './types'

/**
 * Data-key bootstrap, run once at startup after the ENCRYPTION_KEY bootstrap
 * (instrumentation.ts, the worker, the admin CLI): read the wrapped data
 * keys, unwrap them with the configured KMS and install them, then keep
 * looking for new ones (`kms rotate` on another host) every
 * kms.refresh_seconds (default 60; a timer that never keeps a process alive).
 *
 *  - KMS_PROVIDER=env (default) and no data keys: nothing happens — secrets
 *    are enc:v1 with ENCRYPTION_KEY, as before. The tables not existing yet
 *    (migration not applied) or the database being unreachable is not
 *    fatal for env: the app starts as it always did.
 *  - Any other provider fails closed: the data keys must load, or the app
 *    refuses to start rather than write secrets it couldn't read back.
 *  - The active data key must unwrap; an older one that fails is a warning
 *    (only values still encrypted with it fail, with a clear error).
 */

export interface KmsBootstrapResult {
  provider: string
  keys: number[]
  active: number | null
}

let refreshTimer: ReturnType<typeof setInterval> | null = null

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function bootstrapKms(deps: { source?: DataKeySource; log?: (message: string) => void; refresh?: boolean; now?: () => number } = {}): Promise<KmsBootstrapResult> {
  const log = deps.log ?? ((message: string) => console.warn(`[kms] ${message}`))
  const config = await getProviderConfig('kms')
  const provider = kmsProviderFor(config.id, config.options)
  const source = deps.source ?? serviceDbDataKeys()
  const resolve = resolverFor(provider)
  const failClosed = config.id !== 'env'

  let rows
  try {
    rows = await withTimeout(source.list(), 15_000)
  } catch (error) {
    if (!failClosed) {
      if (!isMissingKmsSchema(error)) log(`data keys not loaded (${describeError(error)}); secrets use ENCRYPTION_KEY (enc:v1)`)
      return { provider: config.id, keys: [], active: null }
    }
    throw new KmsError(`KMS_PROVIDER=${config.id}: the data keys could not be read (${describeError(error)})`)
  }

  if (!rows.length) {
    if (failClosed && !hasEncryptionKey()) {
      throw new KmsError(`KMS_PROVIDER=${config.id} but there is no data key yet and no ENCRYPTION_KEY: create one with \`usertasks-admin kms rotate\``)
    }
    if (failClosed) log(`KMS_PROVIDER=${config.id} but there is no data key yet: secrets use ENCRYPTION_KEY (enc:v1) until \`usertasks-admin kms rotate\``)
  } else {
    const result = await loadDataKeys(rows, resolve)
    const now = (deps.now ?? Date.now)()
    const active = activeRow(rows, now) ?? rows[rows.length - 1]
    const activeFailure = result.failures.find((f) => f.id === active.id)
    if (activeFailure) throw new KmsError(`the active data key ${active.id} could not be unwrapped: ${activeFailure.error}`)
    for (const f of result.failures) log(`data key ${f.id} could not be unwrapped (values encrypted with it will fail to decrypt): ${f.error}`)
  }

  if (deps.refresh !== false && !refreshTimer) {
    const everyMs = Math.max(5, kmsSeconds(config.options, 'refresh_seconds', 60)) * 1000
    let lastWarning = 0
    refreshTimer = setInterval(() => {
      void (async () => {
        try {
          const latest = await source.list()
          const fresh = latest.filter((row) => !hasDataKey(row.id))
          if (!fresh.length) return
          const result = await loadDataKeys(fresh, resolve)
          for (const f of result.failures) throw new KmsError(`data key ${f.id}: ${f.error}`)
        } catch (error) {
          if (Date.now() - lastWarning > 10 * 60_000) {
            lastWarning = Date.now()
            log(`refreshing data keys failed: ${describeError(error)}`)
          }
        }
      })()
    }, everyMs)
    refreshTimer.unref?.()
  }

  return { provider: config.id, keys: dataKeyIds(), active: activeDataKeyId() }
}

/** Stop the refresh timer (tests, CLI). */
export function stopKmsRefresh(): void {
  if (refreshTimer) clearInterval(refreshTimer)
  refreshTimer = null
}
