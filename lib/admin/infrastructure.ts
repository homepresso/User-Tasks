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
import { backgroundRuntime, type BackgroundRuntime, type SwitchingGate } from './switch-runtime'
import { hasSwitchLog, listRecords, switchRunning } from './switch/log'
import type { SwitchRecordRow } from './switch/types'
import { uiSwitchingGateFor } from './switch/gate'

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
    /** A direct connection (DATABASE_URL): the page's switching needs one. */
    hasDb: boolean
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

/**
 * Why Change… / Settings are off without DATABASE_URL. Not a fault: the
 * health checks above run through the Supabase API; only switching (backups,
 * the switch lock, transactional config changes) needs a direct connection.
 */
export const NO_DIRECT_CONNECTION_REASON =
  'Provider changes run with usertasks-admin switch on this deployment: changing them from this page uses a direct PostgreSQL connection (DATABASE_URL), which the Supabase provider does not otherwise need. The health checks run through the Supabase API.'

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

async function recentSwitches(): Promise<{ rows: SwitchRecordView[]; error: string | null; busy: boolean; gate: SwitchingGate }> {
  const url = databaseUrl()
  let gate: SwitchingGate = { enabled: false, reason: NO_DIRECT_CONNECTION_REASON }
  if (url) {
    // A direct connection also tells whether a switch is running (the switch lock).
    let client: pg.Client | null = null
    let connected = false
    try {
      client = new pg.Client(pgConnectionConfig(url, { application_name: 'usertasks-infrastructure', connectionTimeoutMillis: 10_000 }))
      client.on('error', () => undefined)
      await client.connect()
      connected = true
      const gate = await uiSwitchingGateFor(client)
      if (!(await hasSwitchLog(client))) return { rows: [], error: 'migration 20261107000000 not applied', busy: false, gate }
      const running = await switchRunning(client)
      const rows = (await listRecords(client, 10)).map((r) => recordView(r, running))
      return { rows, error: null, busy: running || rows.some((r) => r.status === 'queued'), gate }
    } catch (error) {
      const failure = (error as Error).message
      if (connected || activeDbProvider() === 'postgres') return { rows: [], error: failure, busy: false, gate: { enabled: false, reason: failure } }
      // DATABASE_URL set but unreachable: say so, and read the log through the Supabase API below.
      gate = { enabled: false, reason: `Changing providers from this page uses the direct connection (DATABASE_URL), which failed: ${failure}` }
    } finally {
      await client?.end().catch(() => undefined)
    }
  }
  if (!hasServiceDb()) return { rows: [], error: noServiceDbReason(), busy: false, gate }
  const { data, error } = await getServiceDb()
    .from('instance_provider_switches')
    .select('id, kind, area, from_provider, to_provider, status, steps, actor, error, started_at, finished_at, env_changes, config_before, config_after')
    .order('started_at', { ascending: false })
    .limit(10)
  if (error) return { rows: [], error: error.message, busy: false, gate }
  const rows = ((data ?? []) as unknown as SwitchRecordRow[]).map((row) => recordView({ ...row, started_at: String(row.started_at) }, false))
  return { error: null, rows, busy: rows.some((r) => r.status === 'queued' || r.status === 'running'), gate }
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
      }
    }),
    checkedAt: report.checkedAt,
    switches: switches.rows,
    switchLogError: switches.error,
    switching: {
      gate: switches.gate, runtime: backgroundRuntime(), hasDb: Boolean(databaseUrl()), busy: switches.busy,
      recentSwitchArea: switches.rows.find((s) => s.kind === 'switch' && s.status === 'succeeded' && Date.now() - new Date(s.startedAt).getTime() < 7 * 86_400_000)?.area ?? null,
    },
    housekeeping: housekeeping.status,
    housekeepingError: housekeeping.error,
    appVersion: version,
  }
}
