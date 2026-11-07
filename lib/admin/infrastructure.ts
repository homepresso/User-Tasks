import pg from 'pg'
import { getConfig, type ProviderSource } from '@/lib/config'
import { databaseUrl } from '@/lib/config/bootstrap'
import { getInstanceSetting } from '@/lib/config/instance-settings'
import { PROVIDER_AREAS, type ProviderArea } from '@/lib/config/schema'
import { activeDbProvider, getServiceDb, hasServiceDb } from '@/lib/providers/db'
import { pgConnectionConfig } from '@/lib/providers/db/pg-auth'
import { AREA_LABELS, areaName, catalogueBadges, catalogueEntry } from './catalogue'
import { runDoctor, type CheckStatus, type DoctorCheck, type DoctorReport } from './doctor'
import { canViewInfrastructure, INSTANCE_ADMINS_SETTING, type InfrastructureViewer } from './instance-admins'
import { rpcHousekeeping, type HousekeepingStatus } from './housekeeping'
import { recordView, type SwitchRecordView } from './infrastructure-switching'
import { areaActionStates, backgroundRuntime, type AreaActionStates, type BackgroundRuntime, type SwitchAccess, type SwitchingGate } from './switch-runtime'
import { hasSwitchLog, listRecords, switchRunning } from './switch/log'
import { uiSwitchingGateFor } from './switch/gate'
import { serviceSqlClient } from './ops/service-sql'
import { providerFields } from '@/lib/config/provider-forms'

/**
 * Server side of Settings → Infrastructure: the provider per area with
 * health, the switch log, housekeeping. Changing providers goes through
 * ./infrastructure-switching (the same engine as `usertasks-admin switch`).
 * Instance admins only — see ./instance-admins.
 */

export interface InfrastructureArea {
  area: ProviderArea
  /** CLI name (database, auth, …). */
  name: string
  label: string
  provider: string
  providerLabel: string
  source: ProviderSource
  badges: string[]
  health: CheckStatus
  checks: DoctorCheck[]
  docs: string
  /** Change… / Settings: always shown; disabled ones say why and what to do. */
  actions: AreaActionStates
}

export interface InfrastructureView {
  areas: InfrastructureArea[]
  checkedAt: string
  switches: SwitchRecordView[]
  /** Null when the switch log can't be read (migration 20261107000000 not applied). */
  switchLogError: string | null
  /** Whether providers can be changed from the page, and how. */
  switching: {
    gate: SwitchingGate
    runtime: BackgroundRuntime
    /** direct: DATABASE_URL; api: the Supabase service-role API (config-only changes); none: neither. */
    access: SwitchAccess
    /** The direct connection is configured but failed (the page fell back to the API, or nothing). */
    directError: string | null
    /** A switch is queued or running now. */
    busy: boolean
    /** Area of a provider switch made in the last 7 days (the page shows the rollback-window note). */
    recentSwitchArea: string | null
  }
  /** System-table purge settings, table sizes and recent passes (null: see housekeepingError). */
  housekeeping: HousekeepingStatus | null
  housekeepingError: string | null
  appVersion: string
}

/** Verified-email lookup per auth provider. */
async function emailVerified(user: InfrastructureViewer & { email: string }): Promise<boolean> {
  const config = await getConfig()
  if (config.providers.auth.id === 'supabase') {
    const { data, error } = await getServiceDb().auth.admin.getUserById(user.id)
    if (error || !data.user) return false
    return data.user.email?.toLowerCase() === user.email && Boolean(data.user.email_confirmed_at)
  }
  const { authDb } = await import('@/lib/providers/auth/builtin/db')
  const db = authDb()
  const { rows } = await db.query<{ email: string; email_confirmed_at: Date | null }>(
    'SELECT email, email_confirmed_at FROM app_auth.credentials WHERE user_id = $1',
    [user.id],
  )
  if (rows[0]) return rows[0].email.toLowerCase() === user.email && rows[0].email_confirmed_at !== null
  // SSO-only accounts: identities are linked only for IdP-verified addresses.
  const { rows: ids } = await db.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM app_auth.identities WHERE user_id = $1 AND lower(email) = $2',
    [user.id, user.email],
  )
  return (ids[0]?.n ?? 0) > 0
}

export async function viewerCanSeeInfrastructure(user: InfrastructureViewer | null | undefined): Promise<boolean> {
  return canViewInfrastructure(user, {
    adminSetting: () => getInstanceSetting(INSTANCE_ADMINS_SETTING),
    emailVerified,
  })
}

/** No DATABASE_URL and no service-role key: nothing on the page can read or change the instance settings. */
export const NO_DIRECT_CONNECTION_REASON =
  'This deployment has neither DATABASE_URL nor the Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY), so provider changes cannot be made from this page: add one to the app environment and redeploy.'

/** Why there is no service database client: the postgres provider needs DATABASE_URL, Supabase its service-role key. */
function noServiceDbReason(): string {
  return activeDbProvider() === 'postgres'
    ? 'the postgres database provider needs DATABASE_URL, which is not set'
    : 'SUPABASE_SERVICE_ROLE_KEY is not set'
}

// Health is cached per process: the checks touch every backend.
const HEALTH_TTL_MS = 5 * 60_000
let cachedHealth: { at: number; report: DoctorReport } | null = null

async function health(refresh: boolean): Promise<DoctorReport> {
  if (!refresh && cachedHealth && Date.now() - cachedHealth.at < HEALTH_TTL_MS) return cachedHealth.report
  const config = await getConfig()
  const url = databaseUrl()
  let client: pg.Client | null = null
  let sqlError: string | null = null
  try {
    if (url) {
      const direct = new pg.Client(pgConnectionConfig(url, { application_name: 'usertasks-infrastructure', connectionTimeoutMillis: 10_000 }))
      direct.on('error', () => undefined)
      try {
        await direct.connect()
        client = direct
      } catch (error) {
        // Reported by the database checks; the Supabase provider's checks then use its API.
        sqlError = (error as Error).message
        await direct.end().catch(() => undefined)
      }
    }
    // Supabase provider without (a working) DATABASE_URL: the checks go through the service-role API.
    const rpc = !client && activeDbProvider() === 'supabase' && hasServiceDb() ? getServiceDb() : null
    const report = await runDoctor({ config, sql: client, rpc, sqlError, timeoutMs: 8_000 })
    cachedHealth = { at: Date.now(), report }
    return report
  } finally {
    await client?.end().catch(() => undefined)
  }
}

export function clearInfrastructureHealthCache(): void {
  cachedHealth = null
}

interface SwitchesState {
  rows: SwitchRecordView[]
  error: string | null
  busy: boolean
  gate: SwitchingGate
  access: SwitchAccess
  directError: string | null
}

async function switchesFrom(client: Parameters<typeof uiSwitchingGateFor>[0], access: SwitchAccess, directError: string | null): Promise<SwitchesState> {
  const gate = await uiSwitchingGateFor(client)
  if (!(await hasSwitchLog(client))) return { rows: [], error: 'migration 20261107000000 not applied', busy: false, gate, access, directError }
  const running = await switchRunning(client)
  const rows = (await listRecords(client, 10)).map((r) => recordView(r, running))
  return { rows, error: null, busy: running || rows.some((r) => r.status === 'queued'), gate, access, directError }
}

/**
 * The switch log, the gate and how the page reaches the instance: over
 * DATABASE_URL when set (it also tells whether a switch runs: the switch
 * lock), else through the Supabase service-role API (no DATABASE_URL, or it
 * failed): config-only changes then run over the API too.
 */
async function recentSwitches(): Promise<SwitchesState> {
  const url = databaseUrl()
  let directError: string | null = null
  if (url) {
    let client: pg.Client | null = null
    let connected = false
    try {
      client = new pg.Client(pgConnectionConfig(url, { application_name: 'usertasks-infrastructure', connectionTimeoutMillis: 10_000 }))
      client.on('error', () => undefined)
      await client.connect()
      connected = true
      return await switchesFrom(client, 'direct', null)
    } catch (error) {
      const failure = (error as Error).message
      const gate: SwitchingGate = { enabled: false, reason: `The direct connection (DATABASE_URL) failed: ${failure}`, code: 'unavailable' }
      if (connected || activeDbProvider() === 'postgres') return { rows: [], error: failure, busy: false, gate, access: 'direct', directError: failure }
      // DATABASE_URL set but unreachable: read through the Supabase API below. Changes use DATABASE_URL, so they stay off.
      directError = failure
    } finally {
      await client?.end().catch(() => undefined)
    }
  }
  const noAccess: SwitchingGate = { enabled: false, reason: NO_DIRECT_CONNECTION_REASON, code: 'unavailable' }
  if (activeDbProvider() !== 'supabase' || !hasServiceDb()) return { rows: [], error: noServiceDbReason(), busy: false, gate: noAccess, access: 'none', directError }
  try {
    const state = await switchesFrom(serviceSqlClient(getServiceDb()), 'api', directError)
    // Actions would use the failing DATABASE_URL: say so instead of offering them.
    if (directError) return { ...state, gate: { enabled: false, reason: `Changes from this page use DATABASE_URL, which failed: ${directError}`, code: 'unavailable' } }
    return state
  } catch (error) {
    return { rows: [], error: (error as Error).message, busy: false, gate: { enabled: false, reason: (error as Error).message, code: 'unavailable' }, access: 'api', directError }
  }
}

async function housekeepingStatus(): Promise<{ status: HousekeepingStatus | null; error: string | null }> {
  if (!hasServiceDb()) return { status: null, error: noServiceDbReason() }
  try {
    return { status: await rpcHousekeeping(getServiceDb()).status(), error: null }
  } catch (error) {
    return { status: null, error: (error as Error).message }
  }
}

export async function loadInfrastructureView(options: { refresh?: boolean } = {}): Promise<InfrastructureView> {
  const [config, report, switches, housekeeping] = await Promise.all([getConfig(), health(Boolean(options.refresh)), recentSwitches(), housekeepingStatus()])
  const { version } = (await import('@/package.json')).default as { version: string }
  return {
    areas: PROVIDER_AREAS.map((area) => {
      const provider = config.providers[area]
      const entry = catalogueEntry(area, provider.id)
      return {
        area,
        name: areaName(area),
        label: AREA_LABELS[area],
        provider: provider.id,
        providerLabel: entry?.label ?? provider.id,
        source: provider.source,
        badges: entry ? catalogueBadges(entry) : [],
        health: report.areas[area],
        checks: report.checks.filter((c) => c.area === area),
        docs: `/docs/self-hosting/infrastructure#${entry?.docs ?? area}`,
        actions: areaActionStates({
          area, label: AREA_LABELS[area], providerLabel: entry?.label ?? provider.id, hasSettings: providerFields(area, provider.id).length > 0,
          gate: switches.gate, access: switches.access,
        }),
      }
    }),
    checkedAt: report.checkedAt,
    switches: switches.rows,
    switchLogError: switches.error,
    switching: {
      gate: switches.gate, runtime: backgroundRuntime(), access: switches.access, directError: switches.directError, busy: switches.busy,
      recentSwitchArea: switches.rows.find((s) => s.kind === 'switch' && s.status === 'succeeded' && Date.now() - new Date(s.startedAt).getTime() < 7 * 86_400_000)?.area ?? null,
    },
    housekeeping: housekeeping.status,
    housekeepingError: housekeeping.error,
    appVersion: version,
  }
}
