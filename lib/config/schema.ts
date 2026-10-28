import { z } from 'zod'

/**
 * Instance configuration schema.
 *
 * Two layers feed it (see lib/config/index.ts):
 *  - bootstrap: environment variables only. Everything needed to reach the
 *    database and decrypt secrets (Supabase URL/keys, DATABASE_URL,
 *    ENCRYPTION_KEY) plus values read synchronously on hot paths (APP_URL,
 *    processor secrets, deployment mode).
 *  - instance settings: the `instance_settings` table (service-role only),
 *    for provider choices and provider options that can change without a
 *    redeploy. Environment variables still override them.
 *
 * Every infrastructure area has a provider id; the defaults are today's
 * Supabase / pg_cron / Resend / env stack. Ids reserved for later phases
 * (auth) are rejected by lib/providers until they exist.
 */

export const PROVIDER_AREAS = ['db', 'auth', 'storage', 'realtime', 'scheduler', 'email', 'secrets', 'cache', 'kms'] as const
export type ProviderArea = (typeof PROVIDER_AREAS)[number]

export const PROVIDER_IDS = {
  db: ['supabase', 'postgres'],
  auth: ['supabase', 'builtin', 'oidc', 'saml'],
  storage: ['supabase', 's3', 'local', 'azure_blob', 'gcs'],
  realtime: ['supabase', 'sse'],
  scheduler: ['pg_cron', 'worker', 'external'],
  email: ['resend', 'smtp', 'ses', 'azure_communication', 'microsoft_graph', 'gmail', 'console'],
  secrets: ['env', 'db', 'supabase_vault', 'hashicorp_vault', 'azure_key_vault', 'gcp_secret_manager', 'aws_secrets_manager'],
  cache: ['memory', 'postgres', 'redis'],
  kms: ['env', 'vault_transit', 'aws_kms', 'azure_key_vault', 'gcp_kms'],
} as const satisfies Record<ProviderArea, readonly [string, ...string[]]>

export type ProviderId<A extends ProviderArea = ProviderArea> = (typeof PROVIDER_IDS)[A][number]

/** Today's stack. Production runs on these; they must stay the defaults. */
export const DEFAULT_PROVIDERS: { [A in ProviderArea]: ProviderId<A> } = {
  db: 'supabase',
  auth: 'supabase',
  storage: 'supabase',
  realtime: 'supabase',
  scheduler: 'pg_cron',
  email: 'resend',
  secrets: 'env',
  cache: 'memory',
  kms: 'env',
}

/** Environment variable that overrides each area's provider id. */
export const PROVIDER_ENV: Record<ProviderArea, string> = {
  db: 'DB_PROVIDER',
  auth: 'AUTH_PROVIDER',
  storage: 'STORAGE_PROVIDER',
  realtime: 'REALTIME_PROVIDER',
  scheduler: 'SCHEDULER_PROVIDER',
  email: 'EMAIL_PROVIDER',
  secrets: 'SECRETS_PROVIDER',
  cache: 'CACHE_PROVIDER',
  kms: 'KMS_PROVIDER',
}

export function providerIdSchema<A extends ProviderArea>(area: A) {
  return z.enum(PROVIDER_IDS[area] as unknown as [ProviderId<A>, ...ProviderId<A>[]])
}

export const DeploymentModeSchema = z.enum(['cloud', 'self_hosted'])

const optional = z.string().optional()

export const BootstrapConfigSchema = z.object({
  /** Direct Postgres connection (unused by the Supabase providers). */
  databaseUrl: optional,
  supabase: z.object({
    url: optional,
    anonKey: optional,
    serviceRoleKey: optional,
  }),
  /**
   * Shared JWT secret (SUPABASE_JWT_SECRET). Only the postgres db provider
   * uses it, to verify HS256 session tokens the way PostgREST does.
   */
  jwtSecret: optional,
  /** Raw ENCRYPTION_KEY (validated by lib/secret-crypto). Never serialised. */
  encryptionKey: optional,
  /** Configured public origin as given (callers trim / fall back as before). */
  appUrl: optional,
  deploymentMode: DeploymentModeSchema,
  /** WORKFLOW_PROCESSOR_SECRET ?? CRON_SECRET — exact `??` semantics. */
  processorSecret: optional,
  cronSecret: optional,
  /** Show "Sign in with Microsoft" (Supabase Azure provider configured). */
  ssoMicrosoft: z.boolean(),
})
export type BootstrapConfig = z.infer<typeof BootstrapConfigSchema>

/** Provider ids from the environment (only the areas that set one). */
export const ProviderOverridesSchema = z.object({
  db: providerIdSchema('db').optional(),
  auth: providerIdSchema('auth').optional(),
  storage: providerIdSchema('storage').optional(),
  realtime: providerIdSchema('realtime').optional(),
  scheduler: providerIdSchema('scheduler').optional(),
  email: providerIdSchema('email').optional(),
  secrets: providerIdSchema('secrets').optional(),
  cache: providerIdSchema('cache').optional(),
  kms: providerIdSchema('kms').optional(),
})
export type ProviderOverrides = z.infer<typeof ProviderOverridesSchema>

/**
 * Keys accepted in `instance_settings`. `providers.<area>` holds a provider
 * id; `<area>.<option>` holds that provider's options (secrets flagged and
 * encrypted at rest). Bootstrap values are deliberately not settable here:
 * the database can't hold the credentials needed to reach it.
 * `instance.<option>` holds instance-wide options that belong to no provider
 * (`instance.admin_emails`, migration 20261107000000); `housekeeping.<option>`
 * the system-table purge (lib/config/housekeeping.ts, migration 20261109500000).
 */
export const INSTANCE_SETTING_KEY = /^(?:providers\.(?:db|auth|storage|realtime|scheduler|email|secrets|cache|kms)|(?:db|auth|storage|realtime|scheduler|email|secrets|cache|kms|instance|housekeeping)\.[a-z][a-z0-9_]{0,62})$/

export const InstanceSettingKeySchema = z.string().regex(INSTANCE_SETTING_KEY, 'Unknown instance setting key')

export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}
