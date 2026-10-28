import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { resolveProviderSecretRefs, type InstanceConfig } from '@/lib/config'
import { appUrlOrLocalhost, processorSecret, readEnv } from '@/lib/config/bootstrap'
import { PROVIDER_AREAS, type ProviderArea } from '@/lib/config/schema'
import { hasSecretRefs } from '@/lib/config/secret-refs'
import { hasEncryptionKey } from '@/lib/secret-crypto'
import { databaseAuthMode, describeDatabaseAuth, pgConnectionConfig } from '@/lib/providers/db/pg-auth'
import { SCHEDULER_LOCK_KEY } from '@/lib/scheduler/leader'
import { pgCronStatus, PG_CRON_JOBS } from '@/lib/providers/scheduler/pg-cron'
import { STORAGE_BUCKET_NAMES } from '@/lib/storage/buckets'
import { NOTIFY_CHANNEL } from '@/lib/realtime/events'
import { housekeepingFindings, HousekeepingUnavailableError, sqlHousekeeping } from './housekeeping'

/**
 * `usertasks-admin doctor` and the health column of Settings → Infrastructure:
 * connectivity and configuration checks per area. Every check reports
 * ok / warn / fail / skip with a one-line detail that never contains a
 * secret value (secret names and option names only).
 *
 * Inputs are explicit so the CLI can point the checks at any database:
 *  - config  the resolved instance config (lib/config resolveInstanceConfig)
 *  - sql     a direct Postgres connection to the app database, when there
 *            is one (DATABASE_URL). Without it the database / scheduler /
 *            built-in auth checks are skipped.
 *  - listenUrl  session connection for the realtime LISTEN round trip.
 */

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'skip'

export interface DoctorCheck {
  area: ProviderArea
  name: string
  status: CheckStatus
  detail: string
}

export interface DoctorReport {
  checkedAt: string
  checks: DoctorCheck[]
  /** Worst status per area. */
  areas: Record<ProviderArea, CheckStatus>
  ok: boolean
}

export interface SqlClient {
  query<R extends Record<string, unknown> = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[] }>
}

export interface DoctorOptions {
  config: InstanceConfig
  sql?: SqlClient | null
  /** Only these areas (default: all). */
  areas?: ProviderArea[]
  /** Write, read back and delete a probe object (default true; the page passes true too — the object is tiny and removed). */
  storageWriteProbe?: boolean
  /** Send a test email to this address. */
  emailTo?: string
  /** LISTEN/NOTIFY round trip connection (default REALTIME_DATABASE_URL / DATABASE_URL). */
  listenUrl?: string | null
  /** Migrations directory for the "up to date" check (default MIGRATIONS_DIR or ./supabase/migrations). */
  migrationsDir?: string
  /** Per-request network timeout. */
  timeoutMs?: number
  fetch?: typeof fetch
}

const RANK: Record<CheckStatus, number> = { skip: 0, ok: 1, warn: 2, fail: 3 }

export function worstStatus(statuses: CheckStatus[]): CheckStatus {
  return statuses.reduce<CheckStatus>((worst, s) => (RANK[s] > RANK[worst] ? s : worst), 'skip')
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function timed<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

type Add = (name: string, status: CheckStatus, detail: string) => void

// ── database ────────────────────────────────────────────────────────────────

function newestMigrationFile(dir: string): string | null {
  if (!existsSync(dir)) return null
  const versions = readdirSync(dir).map((f) => /^(\d+)_.*\.sql$/.exec(f)?.[1]).filter((v): v is string => Boolean(v)).sort()
  return versions.at(-1) ?? null
}

/** Token auth (DATABASE_AUTH=azure|gcp|aws): how the connection authenticates, and the RDS grant. Silent for passwords. */
async function checkDatabaseAuth(sql: SqlClient, add: Add): Promise<void> {
  let mode
  try {
    mode = databaseAuthMode()
  } catch (error) {
    add('auth', 'fail', message(error))
    return
  }
  if (mode === 'password') return
  let detail: string
  try {
    detail = describeDatabaseAuth(readEnv('DATABASE_URL') ?? null)
  } catch (error) {
    add('auth', 'fail', message(error))
    return
  }
  if (mode !== 'aws') { add('auth', 'ok', detail); return }
  // On RDS / Aurora the login role must be granted rds_iam; a plain PostgreSQL has no such role.
  const { rows } = await sql.query<{ has_role: boolean | null; ssl: boolean | null }>(
    `SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rds_iam') THEN pg_has_role(current_user, 'rds_iam', 'member') END AS has_role,
            (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl`,
  ).catch(() => ({ rows: [] as Array<{ has_role: boolean | null; ssl: boolean | null }> }))
  const info = rows[0]
  if (info?.has_role === false) add('auth', 'fail', `${detail}; but the database user is not a member of rds_iam (GRANT rds_iam TO <user>)`)
  else if (/TLS disabled/.test(detail) || info?.ssl === false) add('auth', 'warn', `${detail}; this connection is not encrypted (RDS requires TLS for IAM auth)`)
  else add('auth', 'ok', `${detail}${info?.has_role ? '; user granted rds_iam' : ''}`)
}

async function checkDatabase(opts: DoctorOptions, add: Add): Promise<void> {
  const { sql, config } = opts
  if (!sql) {
    add('connection', config.providers.db.id === 'postgres' ? 'fail' : 'skip', 'No direct connection: set DATABASE_URL to run the database checks')
    return
  }
  const { rows } = await sql.query<{ version: number; user: string; db: string; superuser: boolean }>(
    `SELECT current_setting('server_version_num')::int AS version, current_user AS user, current_database() AS db,
            (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser`,
  )
  const info = rows[0]
  const major = Math.floor(info.version / 10000)
  add('connection', 'ok', `PostgreSQL ${major} — database ${info.db} as ${info.user}${info.superuser ? ' (superuser)' : ''}`)
  add('version', major >= 15 ? 'ok' : 'fail', major >= 15 ? `PostgreSQL ${major} (15+ required)` : `PostgreSQL ${major} is too old: 15 or later is required`)
  await checkDatabaseAuth(sql, add)

  const { rows: roles } = await sql.query<{ rolname: string; member: boolean }>(
    `SELECT r.rolname, pg_has_role(current_user, r.oid, 'MEMBER') AS member
       FROM pg_roles r WHERE r.rolname = ANY($1::text[])`,
    [['anon', 'authenticated', 'service_role']],
  )
  const found = new Map(roles.map((r) => [r.rolname, r.member]))
  const missing = ['anon', 'authenticated', 'service_role'].filter((r) => !found.has(r))
  add('roles', missing.length ? 'fail' : 'ok', missing.length ? `Missing roles: ${missing.join(', ')} (apply the migrations: usertasks-admin db migrate)` : 'anon, authenticated, service_role present')
  if (config.providers.db.id === 'postgres') {
    const cannot = ['anon', 'authenticated', 'service_role'].filter((r) => found.has(r) && !found.get(r))
    add('privileges', cannot.length ? 'fail' : 'ok', cannot.length
      ? `${info.user} cannot SET ROLE ${cannot.join(', ')} (GRANT ${cannot.join(', ')} TO ${info.user})`
      : `${info.user} may switch to the RLS roles`)
  }

  const { rows: ext } = await sql.query<{ extname: string }>('SELECT extname FROM pg_extension ORDER BY extname')
  const extensions = new Set(ext.map((r) => r.extname))
  const wanted = ['pgcrypto', 'pg_trgm']
  const absent = wanted.filter((e) => !extensions.has(e))
  const optional = ['pg_cron', 'pg_net', 'supabase_vault'].filter((e) => extensions.has(e))
  add('extensions', absent.length ? 'warn' : 'ok', `${absent.length ? `missing ${absent.join(', ')}; ` : ''}installed: ${wanted.filter((e) => extensions.has(e)).join(', ') || 'none'}${optional.length ? `; optional: ${optional.join(', ')}` : ''}`)

  const { rows: shim } = await sql.query<{ uid: boolean }>(`SELECT to_regprocedure('auth.uid()') IS NOT NULL AS uid`)
  add('auth.uid()', shim[0]?.uid ? 'ok' : 'fail', shim[0]?.uid ? 'auth.uid() available for RLS policies' : 'auth.uid() missing: apply the compat migration (usertasks-admin db migrate)')

  const { rows: hist } = await sql.query<{ latest: string | null }>(
    `SELECT CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL
                 ELSE (SELECT max(version) FROM supabase_migrations.schema_migrations) END AS latest`,
  )
  const latest = hist[0]?.latest ?? null
  // Runtime path (the Docker image ships /app/supabase/migrations): not something to trace into the build.
  const dir = path.resolve(/*turbopackIgnore: true*/ opts.migrationsDir || readEnv('MIGRATIONS_DIR') || 'supabase/migrations')
  const newest = newestMigrationFile(dir)
  if (!latest) add('migrations', 'warn', 'No migration history found')
  else if (!newest) add('migrations', 'ok', `latest applied ${latest}`)
  else if (latest >= newest) add('migrations', 'ok', `up to date (${latest})`)
  else add('migrations', 'warn', `latest applied ${latest}, newest available ${newest}: run usertasks-admin db migrate`)
}

// ── storage ─────────────────────────────────────────────────────────────────

async function checkStorage(opts: DoctorOptions, add: Add): Promise<void> {
  const config = await resolveProviderSecretRefs(opts.config, 'storage')
  const { resolveStorageProvider } = await import('@/lib/providers/storage')
  const provider = resolveStorageProvider(config.id, config.options)
  add('config', 'ok', `${config.id} provider configured (${config.source})`)
  const bucket = STORAGE_BUCKET_NAMES[0]
  const timeout = opts.timeoutMs ?? 10_000
  if (opts.storageWriteProbe === false) {
    const page = await timed(provider.list(bucket, '', { limit: 1 }), timeout, 'list')
    add('read', 'ok', `listed bucket ${bucket} (${page.objects.length ? 'has objects' : 'empty'})`)
    return
  }
  const key = `_doctor/${randomUUID()}.txt`
  const body = new TextEncoder().encode(`usertasks doctor ${new Date().toISOString()}`)
  try {
    await timed(provider.put(bucket, key, body, { contentType: 'text/plain', upsert: true }), timeout, 'write')
    const object = await timed(provider.get(bucket, key), timeout, 'read')
    if (!object) throw new Error('probe object not found after writing it')
    const { readAll } = await import('@/lib/providers/storage/types')
    const back = await readAll(object.body)
    if (Buffer.compare(Buffer.from(back), Buffer.from(body)) !== 0) throw new Error('probe object read back differently')
    add('read/write', 'ok', `wrote, read back and deleted a probe object in ${bucket}`)
  } finally {
    await provider.delete(bucket, [key]).catch(() => undefined)
  }
}

// ── auth ────────────────────────────────────────────────────────────────────

async function checkAuth(opts: DoctorOptions, add: Add): Promise<void> {
  const config = await resolveProviderSecretRefs(opts.config, 'auth')
  const fetcher = opts.fetch ?? fetch
  const timeout = opts.timeoutMs ?? 10_000
  if (config.id === 'supabase') {
    const url = opts.config.bootstrap.supabase.url?.replace(/\/+$/, '')
    const key = opts.config.bootstrap.supabase.anonKey ?? opts.config.bootstrap.supabase.serviceRoleKey
    if (!url || !key) add('supabase', 'fail', 'SUPABASE_URL and an API key are required by the supabase auth provider')
    else {
      const res = await timed(fetcher(`${url}/auth/v1/health`, { headers: { apikey: key } }), timeout, 'Supabase Auth health')
      add('supabase', res.ok ? 'ok' : 'fail', res.ok ? 'Supabase Auth reachable' : `Supabase Auth health returned HTTP ${res.status}`)
    }
  } else if (opts.sql) {
    const { rows } = await opts.sql.query<{ ok: boolean; users: string | null }>(
      `SELECT to_regclass('app_auth.credentials') IS NOT NULL AS ok,
              CASE WHEN to_regclass('app_auth.credentials') IS NULL THEN NULL ELSE (SELECT count(*)::text FROM app_auth.credentials) END AS users`,
    )
    add('store', rows[0]?.ok ? 'ok' : 'fail', rows[0]?.ok ? `app_auth store present (${rows[0].users} accounts)` : 'app_auth.credentials missing: apply migration 20261106100000_builtin_auth')
  } else {
    add('store', 'fail', `The ${config.id} auth provider needs DATABASE_URL`)
  }

  const { parseSsoProviders, oidcIssuer } = await import('@/lib/providers/auth/sso/config')
  let idps: ReturnType<typeof parseSsoProviders> = []
  try {
    idps = parseSsoProviders(config.options.sso_providers)
  } catch (error) {
    add('sso config', 'fail', message(error))
    return
  }
  if ((config.id === 'oidc' || config.id === 'saml') && !idps.some((idp) => idp.type === config.id)) {
    add('sso config', 'fail', `AUTH_PROVIDER=${config.id} but no ${config.id.toUpperCase()} identity provider is configured (AUTH_SSO_PROVIDERS)`)
  }
  const origin = appUrlOrLocalhost().replace(/\/+$/, '')
  for (const idp of idps) {
    if (idp.type === 'oidc') {
      try {
        const issuer = oidcIssuer(idp).replace(/\/+$/, '')
        const res = await timed(fetcher(`${issuer}/.well-known/openid-configuration`), timeout, `${idp.id} discovery`)
        const doc = res.ok ? (await res.json()) as Record<string, unknown> : null
        const valid = Boolean(doc && typeof doc.issuer === 'string' && typeof doc.authorization_endpoint === 'string')
        add(`oidc:${idp.id}`, valid ? 'ok' : 'fail', valid
          ? `discovery OK (${issuer}); redirect URI ${origin}/auth/sso/${idp.id}/callback`
          : `discovery at ${issuer} failed (HTTP ${res.status})`)
      } catch (error) {
        add(`oidc:${idp.id}`, 'fail', message(error))
      }
    } else {
      add(`saml:${idp.id}`, 'ok', `configured; ACS ${origin}/auth/saml/${idp.id}/acs`)
    }
  }
}

// ── email ───────────────────────────────────────────────────────────────────

async function checkEmail(opts: DoctorOptions, add: Add): Promise<void> {
  const config = await resolveProviderSecretRefs(opts.config, 'email')
  const { resolveEmailProvider } = await import('@/lib/providers/email')
  const provider = resolveEmailProvider(config.id, config.options)
  const from = typeof config.options.from === 'string' && config.options.from ? config.options.from : null
  if (!from && config.id !== 'resend' && config.id !== 'console') add('config', 'fail', `EMAIL_FROM is required by the ${config.id} provider`)
  else add('config', 'ok', `${config.id} provider configured${from ? ` (from ${from})` : ''}`)
  if (!opts.emailTo) return
  const result = await timed(provider.send({
    from: from ?? 'UserTasks <noreply@usertasks.local>',
    to: [opts.emailTo],
    subject: 'UserTasks email test',
    html: '<p>This is a test message from <code>usertasks-admin doctor</code>.</p>',
  }), opts.timeoutMs ?? 20_000, 'test send')
  add('test send', 'ok', `sent to ${opts.emailTo}${result.id ? ` (id ${result.id})` : ''}`)
}

// ── scheduler ───────────────────────────────────────────────────────────────

async function checkScheduler(opts: DoctorOptions, add: Add): Promise<void> {
  const { id } = opts.config.providers.scheduler
  const { sql } = opts
  if (id === 'external' || id === 'pg_cron') {
    add('secret', processorSecret() ? 'ok' : 'fail', processorSecret() ? 'CRON_SECRET set' : 'CRON_SECRET (or WORKFLOW_PROCESSOR_SECRET) is required to call /api/cron/tick')
  }
  if (!sql) {
    add('database', 'skip', 'No direct connection: set DATABASE_URL to check jobs and the leader')
    return
  }
  const cron = await pgCronStatus(sql)
  if (id === 'pg_cron') {
    const names = new Set(cron.jobs.filter((j) => j.active).map((j) => j.jobname))
    const missing = PG_CRON_JOBS.map((j) => j.name).filter((n) => !names.has(n))
    add('pg_cron jobs', missing.length ? 'fail' : 'ok', missing.length
      ? `${cron.installed || cron.jobs.length ? 'missing' : 'not installed'}: ${missing.join(', ')} (usertasks-admin switch scheduler --to pg_cron)`
      : `${[...names].join(', ')} scheduled`)
    if (cron.vault) {
      const lacking = Object.entries(cron.vault).filter(([, set]) => !set).map(([name]) => name)
      add('vault', lacking.length ? 'warn' : 'ok', lacking.length ? `Vault secret(s) missing: ${lacking.join(', ')}` : 'app_base_url and cron_secret present')
    }
  } else if (cron.installed) {
    add('pg_cron jobs', 'warn', `provider is ${id} but pg_cron still schedules ${cron.jobs.map((j) => j.jobname).join(', ')}`)
  }
  if (id === 'worker') {
    const { rows } = await sql.query<{ pid: number | null }>(
      `SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND granted AND objsubid = 1
          AND ((classid::bigint << 32) | objid::bigint) = $1::bigint LIMIT 1`,
      [SCHEDULER_LOCK_KEY],
    )
    add('leader', rows[0] ? 'ok' : 'warn', rows[0] ? `a worker holds the leader lock (backend pid ${rows[0].pid})` : 'no worker holds the leader lock (is the app or `usertasks worker` running? lease mode shows no lock)')
  }
  const { rows: ticks } = await sql.query<{ acquired_at: Date | null; failing: string | null }>(
    `SELECT CASE WHEN to_regclass('app_cron.tick_lock') IS NULL THEN NULL ELSE (SELECT acquired_at FROM app_cron.tick_lock LIMIT 1) END AS acquired_at,
            CASE WHEN to_regclass('app_cron.tick_runs') IS NULL THEN NULL
                 ELSE (SELECT string_agg(job_name, ', ' ORDER BY job_name) FROM app_cron.tick_runs WHERE last_status = 'error') END AS failing`,
  )
  const last = ticks[0]?.acquired_at ? new Date(ticks[0].acquired_at) : null
  const ageMin = last ? (Date.now() - last.getTime()) / 60_000 : null
  add('last tick', !last ? 'warn' : ageMin! > 5 ? 'warn' : 'ok', !last ? 'no tick recorded yet' : `${last.toISOString()} (${Math.round(ageMin!)} min ago)`)
  if (ticks[0]?.failing) add('jobs', 'warn', `last run failed: ${ticks[0].failing}`)
  // System-table purge (any scheduler): last pass, and tables that grew or bloated.
  try {
    for (const finding of housekeepingFindings(await sqlHousekeeping(sql).status())) add(finding.name, finding.level, finding.detail)
  } catch (error) {
    add('housekeeping', 'warn', error instanceof HousekeepingUnavailableError ? error.message : `status unavailable: ${message(error)}`)
  }
}

// ── realtime ────────────────────────────────────────────────────────────────

async function checkRealtime(opts: DoctorOptions, add: Add): Promise<void> {
  const { id } = opts.config.providers.realtime
  const { sql } = opts
  if (id === 'supabase') {
    if (!sql) { add('publication', 'skip', 'No direct connection: set DATABASE_URL to check the supabase_realtime publication'); return }
    const { rows } = await sql.query<{ tables: string }>(
      `SELECT count(*)::text AS tables FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`,
    )
    const n = Number(rows[0]?.tables ?? 0)
    add('publication', n > 0 ? 'ok' : 'warn', n > 0 ? `supabase_realtime publishes ${n} tables` : 'supabase_realtime publication has no tables')
    return
  }
  const url = opts.listenUrl === undefined ? (readEnv('REALTIME_DATABASE_URL') || opts.config.bootstrap.databaseUrl) : opts.listenUrl
  if (!url) { add('listen', 'warn', 'No LISTEN connection (REALTIME_DATABASE_URL / DATABASE_URL): the SSE provider falls back to polling'); return }
  if (sql) {
    const { rows } = await sql.query<{ ok: boolean }>(`SELECT to_regprocedure('app_realtime.notify_changes()') IS NOT NULL AS ok`)
    add('triggers', rows[0]?.ok ? 'ok' : 'warn', rows[0]?.ok ? 'change NOTIFY triggers installed' : 'app_realtime.notify_changes() missing: polling only (apply 20261105000000)')
  }
  const listener = new pg.Client(pgConnectionConfig(url, { application_name: 'usertasks-doctor', connectionTimeoutMillis: opts.timeoutMs ?? 10_000 }))
  listener.on('error', () => undefined)
  const channel = `${NOTIFY_CHANNEL}_doctor_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  try {
    await listener.connect()
    const received = new Promise<void>((resolve) => listener.on('notification', (msg) => { if (msg.channel === channel) resolve() }))
    await listener.query(`LISTEN ${channel}`)
    await listener.query('SELECT pg_notify($1, $2)', [channel, 'ping'])
    await timed(received, 5_000, 'NOTIFY round trip')
    add('listen', 'ok', 'LISTEN/NOTIFY round trip OK (session-mode connection)')
  } catch (error) {
    add('listen', 'fail', `${message(error)} (a transaction-mode pooler does not deliver notifications)`)
  } finally {
    await listener.end().catch(() => undefined)
  }
}

// ── secrets ─────────────────────────────────────────────────────────────────

async function checkSecrets(opts: DoctorOptions, add: Add): Promise<void> {
  const secrets = opts.config.providers.secrets
  const { resolveSecretStore } = await import('@/lib/providers/secrets')
  resolveSecretStore(secrets.id, secrets.options)
  add('store', 'ok', `${secrets.id} secret store configured (${secrets.source})`)
  let refs = 0
  for (const area of PROVIDER_AREAS) {
    if (area === 'secrets' || !hasSecretRefs(opts.config.providers[area].options)) continue
    refs++
    try {
      await resolveProviderSecretRefs(opts.config, area)
      add(`${area} refs`, 'ok', `secret:// references in ${area} options resolve`)
    } catch (error) {
      add(`${area} refs`, 'fail', message(error))
    }
  }
  if (!refs) add('references', 'ok', 'no secret:// references in provider options')
  if (opts.sql) {
    const { rows } = await opts.sql.query<{ n: string }>(
      `SELECT CASE WHEN to_regclass('public.instance_settings') IS NULL THEN '0'
                   ELSE (SELECT count(*)::text FROM public.instance_settings WHERE secret) END AS n`,
    )
    const n = Number(rows[0]?.n ?? 0)
    if (n > 0 && !hasEncryptionKey()) add('encryption key', 'fail', `${n} encrypted instance setting(s) but ENCRYPTION_KEY is not set`)
    else add('encryption key', hasEncryptionKey() ? 'ok' : 'warn', hasEncryptionKey() ? 'ENCRYPTION_KEY set' : 'ENCRYPTION_KEY not set (needed to store secrets)')
  }
}

// ── cache ───────────────────────────────────────────────────────────────────

async function checkCache(opts: DoctorOptions, add: Add): Promise<void> {
  const config = await resolveProviderSecretRefs(opts.config, 'cache')
  const { resolveCacheStore } = await import('@/lib/providers/cache')
  const { pgCacheSql } = await import('@/lib/providers/cache/postgres')
  // A direct connection when the doctor has one (the CLI); the service client otherwise.
  const store = resolveCacheStore(config.id, config.options, opts.sql ? { sql: pgCacheSql(opts.sql) } : {})
  const timeout = opts.timeoutMs ?? 10_000
  try {
    if (!store.shared) {
      add('store', 'ok', 'in-process memory: limits and caches are per instance (use postgres or redis with several replicas)')
      return
    }
    add('connection', 'ok', await timed(store.ping(), timeout, `${config.id} ping`))
    const key = `doctor:${randomUUID()}`
    await timed(store.set(key, 'ok', 30_000), timeout, 'write')
    const back = await timed(store.get(key), timeout, 'read')
    const first = await timed(store.hit(`${key}:rl`, { max: 1, windowMs: 30_000 }), timeout, 'rate limit')
    const second = await timed(store.hit(`${key}:rl`, { max: 1, windowMs: 30_000 }), timeout, 'rate limit')
    await Promise.all([store.delete(key), store.delete(`${key}:rl`)]).catch(() => undefined)
    if (back !== 'ok') throw new Error('probe value read back differently')
    if (!first.ok || second.ok) throw new Error('rate-limit window did not count both hits')
    add('read/write', 'ok', `wrote, read back and deleted a probe key; a rate-limit window counted across calls (invalidation check every ${store.invalidationCheckMs} ms)`)
  } finally {
    await store.close?.().catch(() => undefined)
  }
}

// ── kms ─────────────────────────────────────────────────────────────────────

async function checkKms(opts: DoctorOptions, add: Add): Promise<void> {
  const config = await resolveProviderSecretRefs(opts.config, 'kms')
  const { resolveKmsProvider, dataKeyContext } = await import('@/lib/providers/kms')
  const { resolverFor, unwrapDataKey, activeRow } = await import('@/lib/providers/kms/keyring')
  const provider = resolveKmsProvider(config.id, config.options)
  const timeout = opts.timeoutMs ?? 10_000
  let rows: Array<{ id: number; provider: string; kek_ref: string; wrapped_key: string; check_value: string; created_at: Date; activates_at: Date }> | null = null
  if (opts.sql) {
    const { rows: exists } = await opts.sql.query<{ ok: boolean }>(`SELECT to_regclass('app_kms.data_keys') IS NOT NULL AS ok`)
    rows = exists[0]?.ok
      ? (await opts.sql.query<{ id: number; provider: string; kek_ref: string; wrapped_key: string; check_value: string; created_at: Date; activates_at: Date }>(
          'SELECT id, provider, kek_ref, wrapped_key, check_value, created_at, activates_at FROM app_kms.data_keys ORDER BY id',
        )).rows.map((r) => ({ ...r, id: Number(r.id) }))
      : []
  }
  if (config.id === 'env' && rows !== null && !rows.length) {
    add('provider', hasEncryptionKey() ? 'ok' : 'warn', hasEncryptionKey()
      ? 'env: secrets are encrypted with ENCRYPTION_KEY (enc:v1); no data keys'
      : 'env: ENCRYPTION_KEY not set (stored secrets stay unencrypted)')
    return
  }
  // A probe key round trip through the KMS (never stored).
  const probe = randomBytes(32)
  try {
    const wrapped = await timed(provider.wrap(probe, dataKeyContext(0)), timeout, `${config.id} wrap`)
    const back = await timed(provider.unwrap(wrapped, dataKeyContext(0)), timeout, `${config.id} unwrap`)
    add('round trip', back.equals(probe) ? 'ok' : 'fail', back.equals(probe) ? `wrapped and unwrapped a probe key with ${provider.describe()}` : `${config.id} returned a different key on unwrap`)
    back.fill(0)
  } finally {
    probe.fill(0)
  }
  if (rows === null) { add('data keys', 'skip', 'No direct connection: set DATABASE_URL to check the data keys'); return }
  if (!rows.length) {
    add('data keys', hasEncryptionKey() ? 'warn' : 'fail', `no data key yet: run usertasks-admin kms rotate${hasEncryptionKey() ? ' (until then secrets use ENCRYPTION_KEY)' : ''}`)
    return
  }
  const resolve = resolverFor(provider)
  const failed: string[] = []
  for (const row of rows) {
    try {
      ;(await timed(unwrapDataKey(row, resolve), timeout, `data key ${row.id}`)).fill(0)
    } catch (error) {
      failed.push(`#${row.id}: ${message(error)}`)
    }
  }
  const active = activeRow(rows)
  add('data keys', failed.length ? 'fail' : 'ok', failed.length
    ? `${failed.length} of ${rows.length} data key(s) don't unwrap — ${failed.join('; ')}`
    : `${rows.length} data key(s) unwrap and verify; #${active?.id ?? rows[rows.length - 1].id} ${active ? 'encrypts new values' : 'activates soon'}`)
  const foreign = rows.filter((r) => r.provider !== config.id).map((r) => `#${r.id} (${r.provider})`)
  if (foreign.length) add('wrapping', 'warn', `wrapped by another provider: ${foreign.join(', ')} — run usertasks-admin kms rewrap-keys`)
}

const CHECKS: Record<ProviderArea, (opts: DoctorOptions, add: Add) => Promise<void>> = {
  db: checkDatabase,
  auth: checkAuth,
  storage: checkStorage,
  realtime: checkRealtime,
  scheduler: checkScheduler,
  email: checkEmail,
  secrets: checkSecrets,
  cache: checkCache,
  kms: checkKms,
}

export async function runDoctor(opts: DoctorOptions): Promise<DoctorReport> {
  const areas = opts.areas?.length ? opts.areas : [...PROVIDER_AREAS]
  const checks: DoctorCheck[] = []
  // One area at a time: the checks share one connection.
  for (const area of areas) {
    const add: Add = (name, status, detail) => checks.push({ area, name, status, detail })
    try {
      await CHECKS[area](opts, add)
    } catch (error) {
      add('error', 'fail', message(error))
    }
  }
  const byArea = Object.fromEntries(PROVIDER_AREAS.map((area) => [area, worstStatus(checks.filter((c) => c.area === area).map((c) => c.status))])) as Record<ProviderArea, CheckStatus>
  return { checkedAt: new Date().toISOString(), checks, areas: byArea, ok: !checks.some((c) => c.status === 'fail') }
}
