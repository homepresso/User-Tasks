import net from 'node:net'
import type { InstanceConfig, ProviderConfig } from '@/lib/config'
import { DEFAULT_PROVIDERS, PROVIDER_AREAS, type ProviderArea } from '@/lib/config/schema'
import { runDoctor, worstStatus, type CheckStatus } from '@/lib/admin/doctor'
import { targetClientConfig, type TargetConnection } from '@/lib/admin/ops/target-connection'
import {
  PROFILE_AREAS, PROFILE_AREA_TO_PROVIDER, postgresUrl, supabaseAreas,
  type Profile, type ProfileArea,
} from './profile'

/**
 * Connectivity checks for an install profile, before anything is installed
 * or switched (server only). They reuse the `usertasks-admin doctor` checks
 * (lib/admin/doctor) wherever those don't need the app's own tables, against
 * a config built from the profile rather than the running one:
 *
 *  - database  connect, PostgreSQL 15+, may create schemas (or already migrated), TLS in use
 *  - supabase  Auth health and the REST API with the service-role key
 *  - auth      each SSO identity provider (OIDC discovery + signing keys, SAML metadata), LDAP reachable
 *  - storage   write, read back and delete a probe object (doctor)
 *  - email     configuration; with `emailTo`, a real test message (doctor)
 *  - scheduler pg_cron / pg_net available for pg_cron; the worker needs nothing
 *  - cache     redis / postgres round trip (doctor); secrets, kms (doctor)
 *
 * `guardHost` lets the setup wizard refuse hosts the egress policy blocks
 * (SSRF): it is called with every host a check is about to contact and
 * throws to stop it. The CLI runs on the server for its operator and passes
 * nothing.
 */

export interface ProfileCheck {
  area: ProfileArea | 'supabase'
  name: string
  status: CheckStatus
  detail: string
}

export interface ProfileCheckReport {
  checkedAt: string
  checks: ProfileCheck[]
  areas: Partial<Record<ProfileArea | 'supabase', CheckStatus>>
  ok: boolean
}

export interface ProfileCheckOptions {
  areas?: Array<ProfileArea | 'supabase'>
  /** Send a real test message to this address. */
  emailTo?: string
  timeoutMs?: number
  fetch?: typeof fetch
  guardHost?: (host: string) => Promise<unknown>
  /** Skip the storage write probe (read-only). */
  readOnly?: boolean
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A lib/config InstanceConfig for the profile (what the app would resolve with it applied). */
export function profileInstanceConfig(profile: Profile): InstanceConfig {
  const providers = Object.fromEntries(PROVIDER_AREAS.map((area) => {
    const profileArea = PROFILE_AREAS.find((a) => PROFILE_AREA_TO_PROVIDER[a] === area)!
    const block = profile[profileArea] as { provider: string; options?: Record<string, string> }
    const options: Record<string, unknown> = { ...(block.options ?? {}) }
    if (area === 'auth' && profile.auth.sso.length) options.sso_providers = JSON.stringify(profile.auth.sso)
    const config: ProviderConfig = { area, id: (block.provider ?? DEFAULT_PROVIDERS[area]) as never, source: 'settings', options }
    return [area, config]
  })) as InstanceConfig['providers']
  const db = profile.database
  return {
    bootstrap: {
      databaseUrl: db.provider === 'postgres' ? postgresUrl(db) : db.url,
      supabase: { url: profile.supabase?.url, anonKey: profile.supabase?.anonKey, serviceRoleKey: profile.supabase?.serviceRoleKey },
      jwtSecret: profile.supabase?.jwtSecret,
      encryptionKey: profile.app.encryptionKey,
      appUrl: profile.app.url,
      deploymentMode: 'self_hosted',
      processorSecret: profile.app.cronSecret,
      cronSecret: profile.app.cronSecret,
      ssoMicrosoft: false,
    },
    providers,
  }
}

async function timed<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms) })])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type Add = (area: ProfileCheck['area'], name: string, status: CheckStatus, detail: string) => void

/** Hosts a check will contact, for the egress guard. */
function hostOf(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, 'http:').replace(/^ldaps?:/i, 'http:').replace(/^rediss?:/i, 'http:')).hostname || null
  } catch {
    return null
  }
}

async function guard(opts: ProfileCheckOptions, hosts: Array<string | null | undefined>): Promise<void> {
  if (!opts.guardHost) return
  for (const host of hosts) if (host) await opts.guardHost(host)
}

async function checkDatabase(profile: Profile, opts: ProfileCheckOptions, add: Add): Promise<void> {
  const db = profile.database
  if (db.provider === 'supabase') {
    if (!db.url) { add('database', 'connection', 'ok', 'Supabase database (through the Supabase API; see Supabase below)'); return }
  }
  const url = db.provider === 'postgres' ? postgresUrl(db) : db.url!
  await guard(opts, [db.provider === 'postgres' ? db.host ?? hostOf(url) : hostOf(url)])
  const target: TargetConnection = {
    url,
    auth: db.provider === 'postgres' && db.auth !== 'password' ? db.auth : null,
    sslmode: db.provider === 'postgres' ? db.sslmode ?? null : null,
    ca: db.provider === 'postgres' ? db.caFile ?? null : null,
  }
  const pg = (await import('pg')).default
  const client = new pg.Client({ ...targetClientConfig(target, 'usertasks-install-check'), connectionTimeoutMillis: opts.timeoutMs ?? 10_000 })
  client.on('error', () => undefined)
  try {
    await timed(client.connect(), (opts.timeoutMs ?? 10_000) + 1_000, 'database connection')
  } catch (error) {
    add('database', 'connection', 'fail', `can't connect: ${message(error)}`)
    return
  }
  try {
    const { rows } = await client.query<{ version: number; db: string; user: string; superuser: boolean; can_create: boolean; ssl: boolean | null; migrated: boolean }>(
      `SELECT current_setting('server_version_num')::int AS version, current_database() AS db, current_user AS user,
              (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
              has_database_privilege(current_database(), 'CREATE') AS can_create,
              (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl,
              to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS migrated`,
    )
    const info = rows[0]
    const major = Math.floor(info.version / 10000)
    add('database', 'connection', 'ok', `PostgreSQL ${major}: database ${info.db} as ${info.user}${info.superuser ? ' (superuser)' : ''}`)
    add('database', 'version', major >= 15 ? 'ok' : 'fail', major >= 15 ? `PostgreSQL ${major} (15 or later needed)` : `PostgreSQL ${major} is too old: 15 or later is needed`)
    if (info.migrated) add('database', 'schema', 'ok', 'UserTasks tables present (upgrades run `usertasks-admin db migrate`)')
    else add('database', 'privileges', info.can_create || info.superuser ? 'ok' : 'fail', info.can_create || info.superuser
      ? `${info.user} may create the UserTasks schema`
      : `${info.user} may not create schemas in ${info.db}: run "ALTER DATABASE ${info.db} OWNER TO ${info.user}" (or GRANT CREATE ON DATABASE ${info.db} TO ${info.user}) as an administrator`)
    const remote = db.provider === 'postgres' && db.hosting !== 'bundled' && !/^(localhost|127\.|::1)/.test(hostOf(url) ?? '')
    if (info.ssl === false && remote) add('database', 'tls', 'warn', 'the connection is not encrypted: use sslmode=require (or verify-full) across a network')
    else if (info.ssl) add('database', 'tls', 'ok', 'encrypted (TLS)')
  } finally {
    await client.end().catch(() => undefined)
  }
}

async function checkSupabase(profile: Profile, opts: ProfileCheckOptions, add: Add): Promise<void> {
  const sb = profile.supabase
  if (!sb) { add('supabase', 'project', 'fail', 'no Supabase project given'); return }
  await guard(opts, [hostOf(sb.url)])
  const fetcher = opts.fetch ?? fetch
  const timeout = opts.timeoutMs ?? 10_000
  try {
    const health = await timed(fetcher(`${sb.url}/auth/v1/health`, { headers: { apikey: sb.anonKey } }), timeout, 'Supabase Auth health')
    add('supabase', 'auth', health.ok ? 'ok' : 'fail', health.ok ? 'Supabase Auth reachable' : `Supabase Auth health returned HTTP ${health.status} (check the URL and anon key)`)
    const rest = await timed(fetcher(`${sb.url}/rest/v1/`, { headers: { apikey: sb.serviceRoleKey, authorization: `Bearer ${sb.serviceRoleKey}` } }), timeout, 'Supabase REST')
    add('supabase', 'service key', rest.ok ? 'ok' : 'fail', rest.ok ? 'REST API accepts the service-role key' : `REST API returned HTTP ${rest.status} with the service-role key (check it)`)
  } catch (error) {
    add('supabase', 'project', 'fail', `can't reach ${sb.url}: ${message(error)}`)
  }
}

async function tcpReachable(host: string, port: number, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host, port })
    const timer = setTimeout(() => { socket.destroy(); reject(new Error(`no answer from ${host}:${port} within ${timeoutMs} ms`)) }, timeoutMs)
    socket.once('connect', () => { clearTimeout(timer); socket.end(); resolve() })
    socket.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
}

async function checkAuth(profile: Profile, opts: ProfileCheckOptions, add: Add): Promise<void> {
  const auth = profile.auth
  if (auth.provider === 'supabase') { add('auth', 'provider', 'ok', 'Supabase sign-in (checked with the Supabase project)'); }
  else add('auth', 'provider', 'ok', auth.provider === 'builtin' ? 'built-in sign-in: accounts and passwords in your PostgreSQL' : `${auth.provider.toUpperCase()} sign-in only`)
  const fetcher = opts.fetch ?? fetch
  const { checkSsoProvider } = await import('@/lib/providers/auth/sso/check')
  const { oidcIssuer } = await import('@/lib/providers/auth/sso/config')
  for (const idp of auth.sso) {
    try {
      await guard(opts, [idp.type === 'oidc' ? hostOf(idp.discoveryUrl ?? oidcIssuer(idp)) : hostOf(idp.metadataUrl ?? idp.entryPoint)])
      const result = await timed(checkSsoProvider(idp, profile.app.url, fetcher), opts.timeoutMs ?? 10_000, `${idp.id} check`)
      add('auth', `${idp.type}:${idp.id}`, !result.ok ? 'fail' : result.warnings.length ? 'warn' : 'ok', [result.detail, ...result.warnings].join(' '))
    } catch (error) {
      add('auth', `${idp.type}:${idp.id}`, 'fail', message(error))
    }
  }
  if (auth.ldap) {
    const u = new URL(auth.ldap.url.replace(/^ldap/i, 'http'))
    const port = Number(u.port) || (/^ldaps:/i.test(auth.ldap.url) ? 636 : 389)
    try {
      await guard(opts, [u.hostname])
      await tcpReachable(u.hostname, port, opts.timeoutMs ?? 10_000)
      add('auth', 'ldap', 'ok', `directory server ${u.hostname}:${port} reachable (the bind is tested when you add the connection after setup)`)
    } catch (error) {
      add('auth', 'ldap', 'fail', `directory server ${u.hostname}:${port}: ${message(error)}`)
    }
  }
}

async function checkScheduler(profile: Profile, opts: ProfileCheckOptions, add: Add): Promise<void> {
  const id = profile.scheduler.provider
  if (id === 'worker') { add('scheduler', 'worker', 'ok', 'built-in worker: runs inside the app, nothing else to set up'); return }
  if (id === 'external') { add('scheduler', 'external', 'ok', `your scheduler calls ${profile.app.url}/api/cron/tick every minute with the cron secret`); return }
  if (profile.database.provider === 'supabase' && !profile.database.url) { add('scheduler', 'pg_cron', 'ok', 'Supabase includes pg_cron and pg_net'); return }
  const db = profile.database
  const url = db.provider === 'postgres' ? postgresUrl(db) : db.url!
  await guard(opts, [hostOf(url)])
  const pg = (await import('pg')).default
  const client = new pg.Client({ ...targetClientConfig({ url, auth: db.provider === 'postgres' && db.auth !== 'password' ? db.auth : null, sslmode: null, ca: db.provider === 'postgres' ? db.caFile ?? null : null }, 'usertasks-install-check'), connectionTimeoutMillis: opts.timeoutMs ?? 10_000 })
  client.on('error', () => undefined)
  try {
    await client.connect()
    const { rows } = await client.query<{ name: string }>(`SELECT name FROM pg_available_extensions WHERE name IN ('pg_cron', 'pg_net')`)
    const have = new Set(rows.map((r) => r.name))
    const missing = ['pg_cron', 'pg_net'].filter((n) => !have.has(n))
    add('scheduler', 'pg_cron', missing.length ? 'fail' : 'ok', missing.length ? `${missing.join(' and ')} not available in this PostgreSQL: use the built-in worker instead` : 'pg_cron and pg_net available')
  } catch (error) {
    add('scheduler', 'pg_cron', 'skip', `not checked: ${message(error)}`)
  } finally {
    await client.end().catch(() => undefined)
  }
}

/** The doctor's checks for one area against the profile's config. */
async function doctorArea(profile: Profile, area: ProfileArea, opts: ProfileCheckOptions, add: Add): Promise<void> {
  const config = profileInstanceConfig(profile)
  const providerArea = PROFILE_AREA_TO_PROVIDER[area] as ProviderArea
  const o = config.providers[providerArea].options as Record<string, string>
  const hosts: Array<string | null> = []
  if (area === 'storage') hosts.push(hostOf(o.endpoint), hostOf(o.azure_endpoint), hostOf(o.gcs_endpoint))
  if (area === 'email') hosts.push(o.smtp_host ?? null, hostOf(o.acs_endpoint), hostOf(o.graph_endpoint))
  if (area === 'cache') hosts.push(hostOf(o.redis_url))
  await guard(opts, hosts)
  const report = await runDoctor({ config, areas: [providerArea], sql: null, storageWriteProbe: !opts.readOnly, emailTo: area === 'email' ? opts.emailTo : undefined, timeoutMs: opts.timeoutMs ?? 10_000, fetch: opts.fetch })
  for (const check of report.checks) add(area, check.name, check.status, check.detail)
}

/** Which checks to run for an area (the others are covered by the database / Supabase checks or need the installed app). */
const CHECKS: Record<ProfileArea | 'supabase', (profile: Profile, opts: ProfileCheckOptions, add: Add) => Promise<void>> = {
  database: checkDatabase,
  supabase: checkSupabase,
  auth: checkAuth,
  storage: async (p, o, add) => {
    if (p.storage.provider === 'supabase') { add('storage', 'provider', 'ok', 'Supabase Storage (checked with the Supabase project)'); return }
    if (p.storage.provider === 'local') {
      const { mkdir } = await import('node:fs/promises')
      try { await mkdir(p.storage.options.local_root!, { recursive: true }) } catch (error) { add('storage', 'folder', 'fail', `can't create ${p.storage.options.local_root}: ${message(error)}`); return }
    }
    return doctorArea(p, 'storage', o, add)
  },
  email: (p, o, add) => doctorArea(p, 'email', o, add),
  scheduler: checkScheduler,
  realtime: async (p, _o, add) => {
    add('realtime', 'provider', 'ok', p.realtime.provider === 'sse' ? 'built-in live updates over the database connection' : 'Supabase Realtime (checked with the Supabase project)')
  },
  cache: async (p, o, add) => {
    if (p.cache.provider === 'postgres') { add('cache', 'provider', 'ok', 'shared cache in PostgreSQL (uses the database connection)'); return }
    return doctorArea(p, 'cache', o, add)
  },
  secrets: async (p, o, add) => {
    if (p.secrets.provider === 'env') { add('secrets', 'provider', 'ok', 'environment / mounted files'); return }
    return doctorArea(p, 'secrets', o, add)
  },
  kms: async (p, o, add) => {
    if (p.kms.provider === 'env') { add('kms', 'provider', 'ok', 'ENCRYPTION_KEY from the environment'); return }
    add('kms', 'provider', 'skip', 'checked after install: `usertasks-admin doctor --area kms` (data keys live in the database)')
    void o
  },
}

/** Run the checks for a validated profile. Never throws: failures are rows. */
export async function checkProfile(profile: Profile, opts: ProfileCheckOptions = {}): Promise<ProfileCheckReport> {
  const checks: ProfileCheck[] = []
  const add: Add = (area, name, status, detail) => checks.push({ area, name, status, detail })
  const wanted = opts.areas?.length ? opts.areas : [...(supabaseAreas(profile).length ? ['supabase' as const] : []), ...PROFILE_AREAS]
  for (const area of wanted) {
    try {
      await CHECKS[area](profile, opts, add)
    } catch (error) {
      add(area, 'error', 'fail', message(error))
    }
  }
  const areas: ProfileCheckReport['areas'] = {}
  for (const area of wanted) areas[area] = worstStatus(checks.filter((c) => c.area === area).map((c) => c.status))
  return { checkedAt: new Date().toISOString(), checks, areas, ok: !checks.some((c) => c.status === 'fail') }
}
