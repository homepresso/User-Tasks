import { DEFAULT_PROVIDERS, type ProviderId } from '@/lib/config/schema'
import { pickProvider } from '../registry'
import { activeDbProvider, getServiceDb, type ServiceDb } from './index'
import { getSessionDb } from './session'

/**
 * DbProvider: where server code gets its database clients. Supabase (the
 * supabase-js service/cookie clients over PostgREST) or postgres (the same
 * clients, served in-process by @usertasks/pg-query over DATABASE_URL). The
 * switch itself happens inside getServiceDb / getSessionDb (DB_PROVIDER), so
 * both providers expose the same factories.
 */
export interface DbProvider {
  readonly id: ProviderId<'db'>
  /** Runs fully on-premises / air-gapped (plan: provider catalogue). */
  readonly onPrem: boolean
  /** Privileged client (bypasses RLS). */
  service(): ServiceDb
  /** Client bound to the current request's user (RLS applies). */
  session(): Promise<ServiceDb>
}

export const supabaseDbProvider: DbProvider = {
  id: 'supabase',
  onPrem: false,
  service: () => getServiceDb(),
  session: () => getSessionDb() as Promise<ServiceDb>,
}

export const postgresDbProvider: DbProvider = {
  id: 'postgres',
  onPrem: true,
  service: () => getServiceDb(),
  session: () => getSessionDb() as Promise<ServiceDb>,
}

export function resolveDbProvider(id: ProviderId<'db'> = DEFAULT_PROVIDERS.db): DbProvider {
  return pickProvider('db', id, { supabase: () => supabaseDbProvider, postgres: () => postgresDbProvider })
}

/** The provider getServiceDb / getSessionDb use: DB_PROVIDER only (see activeDbProvider). */
export async function getDbProvider(): Promise<DbProvider> {
  return resolveDbProvider(activeDbProvider())
}
