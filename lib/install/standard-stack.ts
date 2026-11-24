import type { ProviderArea } from '@/lib/config/schema'
import { FREE_EMAIL_PROVIDERS } from '@/lib/infrastructure/addon'
import { postgresUrl, PROFILE_AREA_LABELS, type Profile, type ProfileArea } from './profile'

/**
 * Standard stack or separated? (The Infrastructure add-on boundary; see
 * lib/infrastructure/addon.ts.)
 *
 *   supabase  a Supabase project holds the database, sign-in, files and live
 *             updates; background jobs on pg_cron or the built-in worker;
 *             cache in memory or the database; secrets in the environment,
 *             Supabase Vault or the database.
 *   bundled   everything installed with UserTasks on one machine / one
 *             Compose project: PostgreSQL (hosting "bundled"), built-in
 *             sign-in, a local files folder or the bundled MinIO, Server-Sent
 *             Events, the built-in worker, the cache in memory, the database
 *             or the bundled Valkey.
 *
 * Email (SMTP relay, Microsoft 365 / Exchange, Resend, log-only) and identity
 * providers on built-in sign-in are settings of either stack. Anything else —
 * your own or a managed PostgreSQL, an S3 / Azure Blob / GCS bucket, SSO-only
 * sign-in, an external scheduler or Redis, a cloud secret store or KMS, an
 * email API — is separation: writing it at install time needs an
 * Infrastructure licence (packages/admin/src/install-cli.ts).
 *
 * Pure (no node: imports).
 */

export type StandardStack = 'supabase' | 'bundled'

export interface SeparatedArea {
  area: ProfileArea
  provider: string
  /** Plain-language reason ("your own PostgreSQL server"). */
  detail: string
  /** Provider + endpoint: the same fingerprint in the running config means nothing new is being separated. */
  fingerprint: string
}

export interface StackClassification {
  /** The standard stack this profile is (null: separated). */
  stack: StandardStack | null
  separated: SeparatedArea[]
}

/** Hosts of services installed with UserTasks (Compose service names, this machine). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'pgbouncer', 'minio', 'valkey', 'redis', 'host.docker.internal'])

export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLocal(url: string | undefined | null): boolean {
  const host = hostOf(url)
  return host !== null && LOCAL_HOSTS.has(host)
}

function endpointPart(url: string | undefined | null): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    return `${u.hostname.toLowerCase()}:${u.port || ''}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return url.trim().toLowerCase()
  }
}

const SUPABASE_SCHEDULERS = ['pg_cron', 'worker']
const SUPABASE_SECRETS = ['env', 'supabase_vault', 'db']
const BUNDLED_SECRETS = ['env', 'db']
const LOCAL_CACHES = ['memory', 'postgres']

function databaseArea(profile: Profile): SeparatedArea | null {
  const db = profile.database
  if (db.provider === 'supabase') return null
  const url = postgresUrl(db)
  if (db.hosting === 'bundled' && isLocal(url)) return null
  const where = db.hosting === 'own' ? 'your own PostgreSQL server' : db.hosting === 'bundled' ? `PostgreSQL at ${hostOf(url) ?? 'another host'} (not the bundled one)` : `a managed PostgreSQL (${db.hosting})`
  return { area: 'database', provider: 'postgres', detail: where, fingerprint: `postgres:${endpointPart(url)}` }
}

/** Classify a validated profile. */
export function classifyProfile(profile: Profile): StackClassification {
  const separated: SeparatedArea[] = []
  const add = (area: ProfileArea, provider: string, detail: string, endpoint = '') => separated.push({ area, provider, detail, fingerprint: `${provider}:${endpoint}` })
  const onSupabase = profile.database.provider === 'supabase'
  const db = databaseArea(profile)
  if (db) separated.push(db)

  const auth = profile.auth.provider
  if (onSupabase ? auth !== 'supabase' : auth !== 'builtin') {
    add('auth', auth, auth === 'oidc' || auth === 'saml' ? `sign-in only through ${auth.toUpperCase()} identity providers` : `${auth} sign-in`)
  }

  const storage = profile.storage
  if (onSupabase ? storage.provider !== 'supabase' : !(storage.provider === 'local' || (storage.provider === 's3' && isLocal(storage.options.endpoint)))) {
    add('storage', storage.provider, storage.provider === 's3' ? `an S3-compatible bucket${storage.options.endpoint ? ` at ${hostOf(storage.options.endpoint) ?? storage.options.endpoint}` : ' (AWS S3)'}` : `${storage.provider} file storage`, endpointPart(storage.options.endpoint ?? storage.options.azure_endpoint ?? storage.options.gcs_endpoint ?? storage.options.bucket))
  }

  const realtime = profile.realtime.provider
  if (realtime !== (onSupabase ? 'supabase' : 'sse')) add('realtime', realtime, `${realtime} live updates`)

  const scheduler = profile.scheduler.provider
  if (onSupabase ? !SUPABASE_SCHEDULERS.includes(scheduler) : scheduler !== 'worker') add('scheduler', scheduler, scheduler === 'external' ? 'an external scheduler' : `${scheduler} background jobs`)

  const cache = profile.cache
  if (!(LOCAL_CACHES.includes(cache.provider) || (!onSupabase && cache.provider === 'redis' && isLocal(cache.options.redis_url)))) {
    add('cache', cache.provider, cache.provider === 'redis' ? `Redis at ${hostOf(cache.options.redis_url) ?? 'another host'}` : `${cache.provider} cache`, endpointPart(cache.options.redis_url))
  }

  const secrets = profile.secrets.provider
  if (!(onSupabase ? SUPABASE_SECRETS : BUNDLED_SECRETS).includes(secrets)) add('secrets', secrets, `the ${secrets} secret store`)

  if (profile.kms.provider !== 'env') add('kms', profile.kms.provider, `${profile.kms.provider} key management`)

  if (!FREE_EMAIL_PROVIDERS.includes(profile.email.provider)) add('email', profile.email.provider, `email through the ${profile.email.provider} API`)

  return { stack: separated.length ? null : onSupabase ? 'supabase' : 'bundled', separated }
}

/** One line per separated area, for refusals and installer output. */
export function describeSeparation(separated: SeparatedArea[]): string {
  return separated.map((s) => `${PROFILE_AREA_LABELS[s.area].toLowerCase()} (${s.detail})`).join(', ')
}

// ── The running configuration (for re-runs) ─────────────────────────────────

const AREA_ENV: Record<Exclude<ProfileArea, 'database'>, { provider: string; endpoint?: string[] }> = {
  auth: { provider: 'AUTH_PROVIDER' },
  storage: { provider: 'STORAGE_PROVIDER', endpoint: ['S3_ENDPOINT', 'AZURE_STORAGE_BLOB_ENDPOINT', 'GCS_API_ENDPOINT', 'STORAGE_BUCKET'] },
  email: { provider: 'EMAIL_PROVIDER' },
  scheduler: { provider: 'SCHEDULER_PROVIDER' },
  realtime: { provider: 'REALTIME_PROVIDER' },
  cache: { provider: 'CACHE_PROVIDER', endpoint: ['CACHE_REDIS_URL'] },
  secrets: { provider: 'SECRETS_PROVIDER' },
  kms: { provider: 'KMS_PROVIDER' },
}

/** The fingerprint of an area in an existing env file (an install being re-run), or null when the area is not set there. */
export function envFingerprint(area: ProfileArea, env: Record<string, string>): string | null {
  if (area === 'database') {
    if ((env.DB_PROVIDER ?? '').trim() !== 'postgres' || !env.DATABASE_URL) return null
    return `postgres:${endpointPart(env.DATABASE_URL)}`
  }
  const spec = AREA_ENV[area]
  const provider = (env[spec.provider] ?? '').trim().toLowerCase()
  if (!provider) return null
  const endpoint = (spec.endpoint ?? []).map((name) => env[name]).find((v) => v && v.trim()) ?? ''
  return `${provider}:${endpoint ? endpointPart(endpoint) : ''}`
}

/** Instance settings form of the same fingerprint (`providers.<area>`, `<area>.<option>`), for `install profile apply`. */
export function settingsFingerprint(area: ProfileArea, settings: Map<string, unknown>): string | null {
  const providerArea: ProviderArea = area === 'database' ? 'db' : area
  const provider = settings.get(`providers.${providerArea}`)
  if (typeof provider !== 'string' || !provider) return null
  const option = area === 'storage' ? ['endpoint', 'azure_endpoint', 'gcs_endpoint', 'bucket'] : area === 'cache' ? ['redis_url'] : []
  const endpoint = option.map((o) => settings.get(`${providerArea}.${o}`)).find((v) => typeof v === 'string' && v.trim()) as string | undefined
  return `${provider}:${endpoint ? endpointPart(endpoint) : ''}`
}

/**
 * The separated areas a re-run would ADD or CHANGE compared with the running
 * configuration (`existing` fingerprints by area). An install separated with
 * an earlier release that re-runs with the same answers adds nothing: no
 * licence is needed to keep running what already runs.
 */
export function newSeparation(classification: StackClassification, existing: (area: ProfileArea) => string | null): SeparatedArea[] {
  return classification.separated.filter((s) => existing(s.area) !== s.fingerprint)
}
