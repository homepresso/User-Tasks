/**
 * One "app replica" for __tests__/cache-provider.test.ts: a separate Node
 * process running the real app modules (lib/rate-limit, lib/api-auth-cache,
 * lib/config/instance-settings) against the configured cache store. Reads
 * one JSON command per stdin line and answers one JSON line on stdout.
 *
 *   { "op": "hit", "key", "max", "windowMs", "n" }   → { ok: <allowed count> }
 *   { "op": "cacheCredential", "key" }               → {}
 *   { "op": "cachedCredential", "key" }              → { cached: boolean }
 *   { "op": "invalidateCredentials" }                → {}
 *   { "op": "setting", "key" }                       → { value } (loadInstanceSettings)
 *   { "op": "setSetting", "key", "value" }           → {}
 *   { "op": "deleteSetting", "key" }                 → {}
 */
import { createInterface } from 'node:readline'
import { rateLimit } from '@/lib/rate-limit'
import {
  credentialCacheGeneration,
  getCachedCredential,
  invalidateCredentialCache,
  setCachedCredential,
  syncCredentialCache,
} from '@/lib/api-auth-cache'
import { deleteInstanceSetting, loadInstanceSettings, setInstanceSetting } from '@/lib/config/instance-settings'

type Command = { op: string; key?: string; max?: number; windowMs?: number; n?: number; value?: unknown }

async function handle(cmd: Command): Promise<Record<string, unknown>> {
  switch (cmd.op) {
    case 'hit': {
      const results = await Promise.all(Array.from({ length: cmd.n ?? 1 }, () => rateLimit(cmd.key!, { max: cmd.max!, windowMs: cmd.windowMs! })))
      return { ok: results.filter((r) => r.ok).length }
    }
    case 'cacheCredential':
      await syncCredentialCache()
      setCachedCredential(cmd.key!, { keyId: cmd.key }, { startedAt: credentialCacheGeneration() })
      return {}
    case 'cachedCredential':
      await syncCredentialCache()
      return { cached: getCachedCredential(cmd.key!) !== null }
    case 'invalidateCredentials':
      await invalidateCredentialCache()
      return {}
    case 'setting':
      return { value: (await loadInstanceSettings()).get(cmd.key!) ?? null }
    case 'setSetting':
      await setInstanceSetting(cmd.key!, cmd.value)
      return {}
    case 'deleteSetting':
      await deleteInstanceSetting(cmd.key!)
      return {}
    default:
      throw new Error(`unknown op ${cmd.op}`)
  }
}

const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let cmd: Command
  try {
    cmd = JSON.parse(line)
  } catch {
    return
  }
  handle(cmd).then(
    (result) => process.stdout.write(`${JSON.stringify({ ...result, done: true })}\n`),
    (error: Error) => process.stdout.write(`${JSON.stringify({ error: error.message, done: true })}\n`),
  )
})
rl.on('close', () => process.exit(0))
process.stdout.write(`${JSON.stringify({ ready: true })}\n`)
