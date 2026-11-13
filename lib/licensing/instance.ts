import { randomBytes } from 'node:crypto'
import { configuredAppUrl } from '@/lib/config/bootstrap'
import type { InstanceIdentity } from './types'

/**
 * Instance identity: a stable id generated once per installation and kept in
 * instance_settings (`instance.id`), plus the hostname(s) the instance answers
 * on (the APP_URL / NEXT_PUBLIC_APP_URL host). Licences may be bound to
 * either; Settings → Licence, `usertasks-admin licence status` and
 * `licence request` show them.
 *
 * The id is created on first use (the app, the admin CLI or the migration
 * that seeds it — whichever runs first) with insert-if-absent, so concurrent
 * first reads agree on one value.
 */

export const INSTANCE_ID_SETTING = 'instance.id'
export const INSTANCE_ID_PATTERN = /^inst_[a-z0-9]{20,40}$/

export function generateInstanceId(): string {
  // 26 base32-ish characters (130 bits): readable, copyable, not guessable.
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(26)
  return `inst_${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`
}

/** The hostnames used for licence binding (APP_URL host, lower case, no port). */
export function instanceHostnames(appUrl: string | undefined = configuredAppUrl()): string[] {
  const raw = appUrl?.trim()
  if (!raw) return []
  try {
    return [new URL(raw.includes('://') ? raw : `https://${raw}`).hostname.toLowerCase()]
  } catch {
    return []
  }
}

export interface InstanceIdStore {
  read: () => Promise<unknown>
  /** Insert only when absent (never overwrite). */
  insertIfAbsent: (value: string) => Promise<void>
}

/** Read the instance id, creating it once when absent. Null when there is no store to keep it. */
export async function ensureInstanceId(store: InstanceIdStore | null): Promise<string | null> {
  if (!store) return null
  const existing = await store.read()
  if (typeof existing === 'string' && existing) return existing
  await store.insertIfAbsent(generateInstanceId())
  const winner = await store.read()
  return typeof winner === 'string' && winner ? winner : null
}

/** The app's instance id store (service-role instance_settings). */
export async function appInstanceIdStore(): Promise<InstanceIdStore | null> {
  const { hasServiceDb, getServiceDb } = await import('@/lib/providers/db')
  if (!hasServiceDb()) return null
  const { getInstanceSetting, invalidateInstanceSettingsCache } = await import('@/lib/config/instance-settings')
  return {
    read: () => getInstanceSetting(INSTANCE_ID_SETTING),
    insertIfAbsent: async (value) => {
      const { error } = await getServiceDb().from('instance_settings').upsert(
        { key: INSTANCE_ID_SETTING, value, secret: false, updated_at: new Date().toISOString() },
        { onConflict: 'key', ignoreDuplicates: true },
      )
      if (error) throw new Error(error.message)
      invalidateInstanceSettingsCache()
    },
  }
}

let memo: Promise<string | null> | null = null

/** This instance's identity (id created on first call). */
export async function getInstanceIdentity(): Promise<InstanceIdentity> {
  memo ??= appInstanceIdStore().then(ensureInstanceId).catch((error) => {
    memo = null
    console.warn(`[licensing] instance id unavailable: ${(error as Error).message}`)
    return null
  })
  const instanceId = await memo
  if (instanceId === null) memo = null
  return { instanceId, hostnames: instanceHostnames() }
}

/** Tests. */
export function resetInstanceIdentityMemo(): void {
  memo = null
}
