/**
 * Cache store options (`cache.<option>` instance settings, or the
 * environment variables below, which win). Any option can be a secret
 * reference (`secret://<name>`).
 *
 * All stores:  key_prefix (shared stores; default "usertasks:"),
 *              invalidation_check_ms (how often other processes' cache
 *              invalidations are looked for; default 1000)
 * postgres:    none — the app database (UNLOGGED table app_cache.entries,
 *              migration 20261108000000), through the service database client
 * redis:       redis_url (redis:// or rediss:// for TLS; default REDIS_URL),
 *              redis_username, redis_password, redis_db,
 *              redis_auth (password (default) | entra | gcp_iam | aws_iam),
 *              redis_tls (force TLS), redis_tls_ca_file,
 *              redis_tls_servername, redis_tls_reject_unauthorized (default true),
 *              redis_entra_scope (default https://redis.azure.com/.default),
 *              redis_aws_cache_name, redis_aws_region (default AWS_REGION),
 *              redis_aws_service (elasticache (default) | memorydb),
 *              redis_aws_serverless (ElastiCache Serverless),
 *              redis_command_timeout_ms (default 2000)
 */

export const CACHE_OPTION_ENV: Record<string, string> = {
  key_prefix: 'CACHE_KEY_PREFIX',
  invalidation_check_ms: 'CACHE_INVALIDATION_CHECK_MS',
  redis_url: 'CACHE_REDIS_URL',
  redis_username: 'CACHE_REDIS_USERNAME',
  redis_password: 'CACHE_REDIS_PASSWORD',
  redis_db: 'CACHE_REDIS_DB',
  redis_auth: 'CACHE_REDIS_AUTH',
  redis_tls: 'CACHE_REDIS_TLS',
  redis_tls_ca_file: 'CACHE_REDIS_TLS_CA_FILE',
  redis_tls_servername: 'CACHE_REDIS_TLS_SERVERNAME',
  redis_tls_reject_unauthorized: 'CACHE_REDIS_TLS_REJECT_UNAUTHORIZED',
  redis_entra_scope: 'CACHE_REDIS_ENTRA_SCOPE',
  redis_aws_cache_name: 'CACHE_REDIS_AWS_CACHE_NAME',
  redis_aws_region: 'CACHE_REDIS_AWS_REGION',
  redis_aws_service: 'CACHE_REDIS_AWS_SERVICE',
  redis_aws_serverless: 'CACHE_REDIS_AWS_SERVERLESS',
  redis_command_timeout_ms: 'CACHE_REDIS_COMMAND_TIMEOUT_MS',
}

/** Credentials among the options: instance settings must store them encrypted. */
export const CACHE_SECRET_OPTIONS = new Set(['redis_password'])

export type CacheOptions = Record<string, unknown>

export const DEFAULT_KEY_PREFIX = 'usertasks:'
export const DEFAULT_INVALIDATION_CHECK_MS = 1000

export function cacheOption(options: CacheOptions, name: string): string | undefined {
  const value = options[name]
  if (value === undefined || value === null) return undefined
  const text = String(value).trim()
  return text === '' ? undefined : text
}

export function cacheNumberOption(options: CacheOptions, name: string, fallback: number): number {
  const raw = cacheOption(options, name)
  if (raw === undefined) return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : fallback
}

export function cacheBoolOption(options: CacheOptions, name: string): boolean | undefined {
  const raw = cacheOption(options, name)?.toLowerCase()
  if (raw === undefined) return undefined
  return raw === 'true' || raw === '1' || raw === 'yes'
}

export function keyPrefix(options: CacheOptions): string {
  return cacheOption(options, 'key_prefix') ?? DEFAULT_KEY_PREFIX
}
