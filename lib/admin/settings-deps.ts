import { databaseUrl } from '@/lib/config/bootstrap'
import { invalidateInstanceSettingsCache } from '@/lib/config/instance-settings'
import { rateLimit } from '@/lib/rate-limit'
import { clearInfrastructureHealthCache, viewerCanSeeInfrastructure } from './infrastructure'
import { NoDatabaseError, type InfrastructureSettingsDeps } from './infrastructure-settings'
import { connect, type SqlClient } from './ops/instance-db'
import { serviceSqlClient } from './ops/service-sql'
import type { SwitchAccess } from './switch-runtime'
import { uiSwitchingGateFor } from './switch/gate'

/**
 * The app process's dependencies for the settings actions (core) — a direct
 * connection per call (DATABASE_URL) or, on the Supabase provider without
 * one, the service-role API — and the base the Infrastructure add-on
 * extends for its switch actions.
 */

/** How this process reaches the instance for Settings → Infrastructure. */
export async function switchAccess(): Promise<SwitchAccess> {
  if (databaseUrl()) return 'direct'
  const { activeDbProvider, hasServiceDb } = await import('@/lib/providers/db')
  return activeDbProvider() === 'supabase' && hasServiceDb() ? 'api' : 'none'
}

export async function withInstanceDb<T>(fn: (db: SqlClient, dbUrl: string) => Promise<T>): Promise<T> {
  const url = databaseUrl()
  if (!url) {
    if ((await switchAccess()) !== 'api') throw new NoDatabaseError()
    const { getServiceDb } = await import('@/lib/providers/db')
    // No direct connection: the service-role API (dbUrl '' — nothing may dump or open second connections).
    return fn(serviceSqlClient(getServiceDb()), '')
  }
  const client = await connect(url, 'usertasks-infrastructure')
  try {
    return await fn(client, url)
  } finally {
    await client.end().catch(() => undefined)
  }
}

export const appSettingsDeps: InfrastructureSettingsDeps = {
  canView: viewerCanSeeInfrastructure,
  withDb: withInstanceDb,
  rateLimit: async (key, max) => (await rateLimit(key, { max, windowMs: 60_000 })).ok,
  gate: uiSwitchingGateFor,
  invalidate: () => {
    invalidateInstanceSettingsCache()
    clearInfrastructureHealthCache()
  },
  guardHosts: async (hosts) => {
    const { blockedMessage, checkHostsAllowed } = await import('@/lib/install/egress-server')
    const check = await checkHostsAllowed(hosts)
    return check.ok ? null : { error: blockedMessage(check), allowEntry: check.allowEntry }
  },
}
