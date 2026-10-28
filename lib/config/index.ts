import { getBootstrapConfig, getEnvProviderOverrides, readEnv } from './bootstrap'
import { loadInstanceSettings } from './instance-settings'
import { STORAGE_OPTION_ENV } from '@/lib/providers/storage/options'
import { SCHEDULER_OPTION_ENV } from '@/lib/providers/scheduler/options'
import { EMAIL_OPTION_ENV } from '@/lib/providers/email/options'
import { SECRETS_OPTION_ENV } from '@/lib/providers/secrets/options'
import { AUTH_OPTION_ENV } from '@/lib/providers/auth/options'
import { CACHE_OPTION_ENV } from '@/lib/providers/cache/options'
import { KMS_OPTION_ENV } from '@/lib/providers/kms/options'
import { hasSecretRefs, resolveSecretRefs, secretTtlMs } from './secret-refs'
import {
  DEFAULT_PROVIDERS,
  PROVIDER_AREAS,
  providerIdSchema,
  type BootstrapConfig,
  type ProviderArea,
  type ProviderId,
} from './schema'

/**
 * Runtime instance config (server only).
 *
 * Precedence, highest first: environment variables → `instance_settings` rows
 * → defaults. With nothing configured the result is today's stack (Supabase
 * for db/auth/storage/realtime, pg_cron, Resend, env secrets).
 *
 * Synchronous bootstrap getters (Supabase URL/keys, APP_URL, processor
 * secrets) live in ./bootstrap; ./public is the browser-safe subset.
 */

export type ProviderSource = 'env' | 'settings' | 'default'

export interface ProviderConfig<A extends ProviderArea = ProviderArea> {
  area: A
  id: ProviderId<A>
  source: ProviderSource
  /** `<area>.<option>` settings for this area, env overrides applied. */
  options: Record<string, unknown>
}

export interface InstanceConfig {
  bootstrap: BootstrapConfig
  providers: { [A in ProviderArea]: ProviderConfig<A> }
}

/** Env variables that override a provider option (`<area>.<option>`). */
export const PROVIDER_OPTION_ENV: Partial<Record<ProviderArea, Record<string, string>>> = {
  auth: AUTH_OPTION_ENV,
  email: EMAIL_OPTION_ENV,
  storage: STORAGE_OPTION_ENV,
  scheduler: SCHEDULER_OPTION_ENV,
  secrets: SECRETS_OPTION_ENV,
  cache: CACHE_OPTION_ENV,
  kms: KMS_OPTION_ENV,
}

function resolveProvider<A extends ProviderArea>(
  area: A,
  envId: ProviderId<A> | undefined,
  settings: Map<string, unknown>,
): ProviderConfig<A> {
  const options: Record<string, unknown> = {}
  const prefix = `${area}.`
  for (const [key, value] of settings) {
    if (key.startsWith(prefix)) options[key.slice(prefix.length)] = value
  }
  for (const [option, name] of Object.entries(PROVIDER_OPTION_ENV[area] ?? {}) as Array<[string, string]>) {
    const value = readEnv(name)
    if (value !== undefined && value !== '') options[option] = value
  }

  if (envId) return { area, id: envId, source: 'env', options }
  const stored = providerIdSchema(area).safeParse(settings.get(`providers.${area}`))
  if (stored.success) return { area, id: stored.data as unknown as ProviderId<A>, source: 'settings', options }
  return { area, id: DEFAULT_PROVIDERS[area], source: 'default', options }
}

/**
 * Config from a given settings map (environment applied on top). getConfig()
 * passes the cached `instance_settings`; the admin CLI passes rows it read
 * over its own connection (or a snapshot it is about to write).
 */
export function resolveInstanceConfig(settings: Map<string, unknown>): InstanceConfig {
  const bootstrap = getBootstrapConfig()
  const env = getEnvProviderOverrides()
  const providers = Object.fromEntries(
    PROVIDER_AREAS.map((area) => [area, resolveProvider(area, env[area] as ProviderId<typeof area> | undefined, settings)]),
  ) as InstanceConfig['providers']
  return { bootstrap, providers }
}

export async function getConfig(): Promise<InstanceConfig> {
  return resolveInstanceConfig(await loadInstanceSettings())
}

/**
 * One area's provider config. `secret://` references in its options are
 * resolved from the configured secret store (lib/config/secret-refs.ts);
 * the secrets area's own options are used as given (the store must be
 * reachable before it can be asked anything). A reference that can't be
 * resolved throws ConfigError naming the option and the secret.
 */
export async function getProviderConfig<A extends ProviderArea>(area: A): Promise<ProviderConfig<A>> {
  return resolveProviderSecretRefs(await getConfig(), area)
}

/** One area of a resolved config, with its `secret://` option references resolved. */
export async function resolveProviderSecretRefs<A extends ProviderArea>(config: InstanceConfig, area: A): Promise<ProviderConfig<A>> {
  const own = config.providers[area] as ProviderConfig<A>
  if (area === 'secrets' || !hasSecretRefs(own.options)) return own
  const secrets = config.providers.secrets
  // Dynamic import: lib/providers/secrets reads its config through this module.
  const { secretStoreFor } = await import('@/lib/providers/secrets')
  const store = secretStoreFor(secrets.id, secrets.options)
  return { ...own, options: await resolveSecretRefs(area, own.options, store, secretTtlMs(secrets.options)) }
}
